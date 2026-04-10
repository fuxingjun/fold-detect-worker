import { DEFAULT_FOLD_KEYWORDS } from "./constants.js";
import { ensureSchema, getSyncMeta, queryMobileModels } from "./db.js";
import { pickFoldableModels } from "./services/fold-verify.js";
import { splitKeywords, buildFoldModels } from "./services/filter.js";
import { syncModels } from "./services/sync.js";

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

async function handleFoldVerify(env) {
  const { results } = await env.DB.prepare(
    `
    SELECT model, brand_title, model_name, ver_name
    FROM mobile_models
    ORDER BY brand_title ASC, model_name ASC
    `
  ).all();

  const data = pickFoldableModels(results || []);
  return json({
    strategy: "test-model-scoring",
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

async function handleSync(request, env) {
  const requiredToken = env.SYNC_TOKEN;
  const token = request.headers.get("x-sync-token");

  if (requiredToken && token !== requiredToken) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncModels(env);
    return json({ ok: true, synced: result.count });
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
      return json({
        service: "fold-detect-worker",
        features: [
          "定时同步 models.csv 到 D1",
          "折叠屏关键词查询",
          "test-model 打分判定接口",
          "品牌/型号精确或模糊查询",
          "手动触发同步"
        ],
        apis: {
          health: "GET /api/health",
          foldModels: "GET /api/fold-models?keywords=Mate X,Magic V",
          foldVerify: "GET /api/fold-models/verify",
          modelSearch:
            "GET /api/models?brand=华为&brand_match=fuzzy&model=Mate&model_match=fuzzy&limit=100",
          sync: "POST /api/sync"
        }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models") {
      return handleFoldModels(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models/verify") {
      return handleFoldVerify(env);
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
    ctx.waitUntil(syncModels(env));
  }
};
