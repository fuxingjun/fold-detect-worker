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

// 首页 GET / 由静态资源 public/index.html 直接服务（见 wrangler.toml [assets]），不经过 Worker

async function handleHealth(env) {
  const meta = await getSyncMeta(env.DB);
  return json({ ok: true, ...meta });
}

// 折叠屏相关接口共用: 读取全表机型数据（数据量约 1.3 万行，D1 读限额内可承受）
async function fetchAllMobileRows(env) {
  const { results } = await env.DB.prepare(
    `
    SELECT model, brand_title, model_name, ver_name
    FROM mobile_models
    ORDER BY brand_title ASC, model_name ASC
    `
  ).all();

  return results || [];
}

async function handleFoldModels(request, env) {
  const { searchParams } = new URL(request.url);
  const keywords = splitKeywords(searchParams.get("keywords"), DEFAULT_FOLD_KEYWORDS);

  const rows = await fetchAllMobileRows(env);
  const data = buildFoldModels(rows, keywords);
  return json({ keywords, total: data.length, data });
}

function parseMinMode(rawMin) {
  const value = String(rawMin || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function handleFoldVerify(request, env) {
  const { searchParams } = new URL(request.url);
  const min = parseMinMode(searchParams.get("min"));

  const rows = await fetchAllMobileRows(env);
  const fullData = pickFoldableModels(rows);
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

// 下载接口: 动态生成与 fold-models.min.json 同构的文件（仅 model/brand/modelName 字段），
// 相比仓库里的静态快照始终与最新同步数据保持一致
async function handleFoldDownload(env) {
  const rows = await fetchAllMobileRows(env);
  const data = pickFoldableModels(rows).map(({ model, brand, modelName }) => ({
    model,
    brand,
    modelName
  }));

  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="fold-models.min.json"'
    }
  });
}

function normalizeMatchMode(rawMode) {
  return rawMode === "exact" ? "exact" : "fuzzy";
}

// DB 中的 sources 为 JSON 数组字符串，对外返回时解析为数组；异常/空值统一回落为空数组
function parseSources(rawSources) {
  if (!rawSources) return [];
  try {
    const parsed = JSON.parse(rawSources);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    versionName: row.ver_name || "",
    sources: parseSources(row.sources)
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

// 通知面向中文用户，统一展示东八区时间
function formatNowBeijing() {
  return (
    new Date(Date.now() + 8 * 3600 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19) + " (UTC+8)"
  );
}

function buildSyncSuccessMessage(result) {
  return [
    "【fold-detect-worker】数据同步完成",
    `总机型数: ${result.count}`,
    `本次变更: ${result.changed ?? 0} 条`,
    `时间: ${formatNowBeijing()}`
  ].join("\n");
}

function buildSyncFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "【fold-detect-worker】数据同步失败",
    `错误: ${message}`,
    `时间: ${formatNowBeijing()}`
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

    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models") {
      return handleFoldModels(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models/verify") {
      return handleFoldVerify(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models/download") {
      return handleFoldDownload(env);
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
