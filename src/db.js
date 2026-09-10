import { schemaStatements, migrationStatements } from "./schema.js";

// 判断是否为「列已存在」类的可忽略错误：不同 SQLite 方言下文案略有差异
function isIgnorableMigrationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name|already exists/i.test(message);
}

export async function ensureSchema(db) {
  for (const statement of schemaStatements) {
    const sql = `${statement.trim().replace(/;\s*$/, "")};`;
    await db.prepare(sql).run();
  }

  // 迁移仅需执行一次，失败(如列已存在)可安全忽略，不影响主流程
  for (const statement of migrationStatements) {
    const sql = `${statement.trim().replace(/;\s*$/, "")};`;
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!isIgnorableMigrationError(error)) {
        console.warn("schema migration failed:", statement, error);
      }
    }
  }
}

// 读取上次同步时记录的数据集内容哈希，用于判断数据集是否发生变化
export async function getSyncHash(db) {
  const row = await db
    .prepare("SELECT value FROM sync_meta WHERE key = 'last_sync_hash'")
    .first();

  return row ? row.value : null;
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
    SELECT model, brand_title, model_name, ver_name, sources
    FROM mobile_models
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY brand_title ASC, model_name ASC
    LIMIT ?
  `;

  const stmt = db.prepare(sql).bind(...params, limit);
  const { results } = await stmt.all();
  return results || [];
}
