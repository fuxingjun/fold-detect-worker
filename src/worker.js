import { DEFAULT_FOLD_KEYWORDS } from "./constants.js";
import { ensureSchema, getSyncMeta } from "./db.js";
import { splitKeywords, buildFoldModels } from "./services/filter.js";
import { syncModels } from "./services/sync.js";

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
  await ensureSchema(env.DB);
  const meta = await getSyncMeta(env.DB);
  return json({ ok: true, ...meta });
}

async function handleFoldModels(request, env) {
  await ensureSchema(env.DB);

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

async function handleSync(request, env) {
  const requiredToken = env.SYNC_TOKEN;
  const token = request.headers.get("x-sync-token");

  if (requiredToken && token !== requiredToken) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await syncModels(env);
  return json({ ok: true, synced: result.count });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "fold-detect-worker",
        endpoints: [
          "GET /api/health",
          "GET /api/fold-models",
          "POST /api/sync"
        ]
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(env);
    }

    if (request.method === "GET" && url.pathname === "/api/fold-models") {
      return handleFoldModels(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/sync") {
      return handleSync(request, env);
    }

    return json({ error: "not found" }, { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncModels(env));
  }
};
