import { DEFAULT_FOLD_KEYWORDS } from "./constants.js";
import { ensureSchema, getSyncMeta, queryMobileModels } from "./db.js";
import { pickFoldableModels } from "./services/fold-verify.js";
import { splitKeywords, buildFoldModels } from "./services/filter.js";
import { syncModels } from "./services/sync.js";
import { sendWecomText } from "./services/wecom.js";

// Per-worker-instance initialization flag. We call `ensureSchema` once
// on the first incoming request or scheduled event so table creation
// happens in code using the D1 binding (env.DB).
let initialized = false;

async function ensureInitialized(env) {
  if (initialized) return;
  if (!env || !env.DB) return;
  await ensureSchema(env.DB);
  initialized = true;
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

function text(data, init = {}) {
  return new Response(data, {
    ...init,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

async function handleHealth(env) {
  const meta = await getSyncMeta(env.DB);
  return json({ ok: true, ...meta });
}

async function handleFoldModels(request, env) {
  const { searchParams } = new URL(request.url);
  const keywords = splitKeywords(searchParams.get("keywords"), DEFAULT_FOLD_KEYWORDS);

  const { results } = await env.DB.prepare(
    `
    SELECT model, brand_title, model_name, ver_name
    FROM mobile_models
    ORDER BY brand_title ASC, model_name ASC
    `
  ).all();

  const data = buildFoldModels(results || [], keywords);
  return json({ keywords, total: data.length, data });
}

function parseMinMode(rawMin) {
  const value = String(rawMin || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function handleFoldVerify(request, env) {
  const { searchParams } = new URL(request.url);
  const min = parseMinMode(searchParams.get("min"));

  const { results } = await env.DB.prepare(
    `
    SELECT model, brand_title, model_name, ver_name
    FROM mobile_models
    ORDER BY brand_title ASC, model_name ASC
    `
  ).all();

  const fullData = pickFoldableModels(results || []);
  const data = min
    ? fullData.map(({ model, brand, modelName }) => ({ model, brand, modelName }))
    : fullData;

  return json({
    strategy: "test-model-scoring",
    min,
    total: data.length,
    data
  });
}

function normalizeMatchMode(rawMode) {
  return rawMode === "exact" ? "exact" : "fuzzy";
}

function parseLimit(rawLimit) {
  const parsed = Number(rawLimit || 100);
  if (!Number.isFinite(parsed) || parsed < 1) return 100;
  return Math.min(Math.floor(parsed), 500);
}

async function handleModelSearch(request, env) {
  const { searchParams } = new URL(request.url);
  const brand = (searchParams.get("brand") || "").trim();
  const model = (searchParams.get("model") || "").trim();
  const brandMatch = normalizeMatchMode(searchParams.get("brand_match"));
  const modelMatch = normalizeMatchMode(searchParams.get("model_match"));
  const limit = parseLimit(searchParams.get("limit"));

  if (!brand && !model) {
    return json(
      {
        error: "bad request",
        message: "at least one query param is required: brand or model"
      },
      { status: 400 }
    );
  }

  const rows = await queryMobileModels(env.DB, {
    brand,
    brandMatch,
    model,
    modelMatch,
    limit
  });

  const data = rows.map((row) => ({
    model: row.model,
    brandTitle: row.brand_title,
    modelName: row.model_name,
    versionName: row.ver_name || ""
  }));

  return json({
    query: {
      brand: brand || null,
      brandMatch,
      model: model || null,
      modelMatch,
      limit
    },
    total: data.length,
    data
  });
}

function buildSyncSuccessMessage(result) {
  return [
    "【fold-detect-worker】数据同步完成",
    `总机型数: ${result.count}`,
    `本次变更: ${result.changed ?? 0} 条`,
    `时间: ${new Date().toISOString()}`
  ].join("\n");
}

function buildSyncFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "【fold-detect-worker】数据同步失败",
    `错误: ${message}`,
    `时间: ${new Date().toISOString()}`
  ].join("\n");
}

// 通知仅作辅助提醒，发送失败不影响同步主流程
async function notifyQuietly(env, content) {
  try {
    await sendWecomText(env, content);
  } catch (error) {
    console.error(
      "wecom notify failed:",
      error instanceof Error ? error.message : error
    );
  }
}

// 统一同步入口: 完成后按结果发送企业微信通知。
// - 成功且有变更: 发送成功通知
// - 成功但数据集无变化(skipped): 不发送, 避免定时任务频繁打扰
// - 失败: 发送失败通知后继续抛出原始错误
async function runSync(env) {
  let result;
  try {
    result = await syncModels(env);
  } catch (error) {
    await notifyQuietly(env, buildSyncFailureMessage(error));
    throw error;
  }

  if (!result.skipped) {
    await notifyQuietly(env, buildSyncSuccessMessage(result));
  }
  return result;
}

async function handleSync(request, env) {
  const requiredToken = env.SYNC_TOKEN;
  const token = request.headers.get("x-sync-token");

  if (requiredToken && token !== requiredToken) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runSync(env);
    // skipped=true 表示数据集未变化；changed 为本次实际写入的行数（新增/变更/删除）
    return json({
      ok: true,
      synced: result.count,
      skipped: result.skipped === true,
      changed: result.changed ?? 0
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sync failed";
    return json({ error: "sync failed", message }, { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    await ensureInitialized(env);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return text(
        [
          "fold-detect-worker",
          "",
          "Service: 折叠屏机型检索与同步服务",
          "Storage: Cloudflare D1",
          "Dataset: models.csv, 定时同步到 mobile_models 表",
          "",
          "Endpoints:",
          "1) GET /api/health",
          "   - 用途: 查看最近同步状态",
          "   - 返回: ok, lastSyncCount, lastSyncAt",
          "",
          "2) GET /api/fold-models?keywords=Mate X,Magic V",
          "   - 用途: 关键词匹配折叠机型",
          "   - 参数: keywords 可选, 逗号分隔",
          "   - 返回: keywords, total, data[]",
          "",
          "3) GET /api/fold-models/verify",
          "   - 用途: 使用 test-model 打分策略筛选横向大折",
          "   - 参数: min 可选, 1|true|yes 时返回精简字段",
          "   - 返回: strategy, total, data[]",
          "   - min=true 时 data 字段: model, brand, modelName",
          "   - data 字段: model, brand, modelName, verName, confidence, score, reasons",
          "",
          "4) GET /api/models",
          "   - 用途: 按品牌或型号查询",
          "   - 参数:",
          "     brand, brand_match=fuzzy|exact",
          "     model, model_match=fuzzy|exact",
          "     limit=1~500",
          "   - 约束: brand 和 model 至少传一个",
          "",
          "5) POST /api/sync",
          "   - 用途: 手动触发数据同步",
          "   - 鉴权: 配置 SYNC_TOKEN 时, 需要请求头 x-sync-token",
          "   - 返回: ok, synced",
          "",
          "Notify:",
          "- 同步完成后通过企业微信群机器人发送通知 (配置 WECOM_WEBHOOK)",
          "- 数据有变更或同步失败时通知, 无变化时不打扰",
          "",
          "Quick Start:",
          "- GET /api/health",
          "- GET /api/fold-models/verify",
          "- POST /api/sync"
        ].join("\n")
      );
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models") {
      return handleFoldModels(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models/verify") {
      return handleFoldVerify(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/sync") {
      return handleSync(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      return handleModelSearch(request, env);
    }

    return json({ error: "not found" }, { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    await ensureInitialized(env);
    ctx.waitUntil(runSync(env));
  }
};
