import { schemaSql } from "./schema.js";

export async function ensureSchema(db) {
  await db.exec(schemaSql);
}

export async function getSyncMeta(db) {
  const row = await db
    .prepare("SELECT value, updated_at FROM sync_meta WHERE key = 'last_sync_count'")
    .first();

  return {
    lastSyncCount: row ? Number(row.value) : 0,
    lastSyncAt: row ? row.updated_at : null
  };
}

export async function queryMobileModels(
  db,
  {
    brand,
    brandMatch = "fuzzy",
    model,
    modelMatch = "fuzzy",
    limit = 100
  } = {}
) {
  const where = [];
  const params = [];

  if (brand) {
    if (brandMatch === "exact") {
      where.push("brand_title = ?");
      params.push(brand);
    } else {
      where.push("brand_title LIKE ?");
      params.push(`%${brand}%`);
    }
  }

  if (model) {
    if (modelMatch === "exact") {
      where.push("model_name = ?");
      params.push(model);
    } else {
      where.push("model_name LIKE ?");
      params.push(`%${model}%`);
    }
  }

  const sql = `
    SELECT model, brand_title, model_name, ver_name
    FROM mobile_models
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY brand_title ASC, model_name ASC
    LIMIT ?
  `;

  const stmt = db.prepare(sql).bind(...params, limit);
  const { results } = await stmt.all();
  return results || [];
}
