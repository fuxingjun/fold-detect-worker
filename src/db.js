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
