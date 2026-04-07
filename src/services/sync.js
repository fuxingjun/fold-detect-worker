import { DATASET_URL } from "../constants.js";
import { parseCsv } from "./csv.js";
import { ensureSchema } from "../db.js";

export async function fetchDataset(url = DATASET_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download dataset failed, status=${response.status}`);
  }

  return response.text();
}

export async function syncModels(env, url = DATASET_URL) {
  const datasetUrl = env.DATASET_URL || url;
  await ensureSchema(env.DB);

  const csvContent = await fetchDataset(datasetUrl);
  const records = parseCsv(csvContent);

  await env.DB.exec("BEGIN TRANSACTION");
  try {
    await env.DB.exec("DELETE FROM mobile_models");

    const insertStmt = env.DB.prepare(`
      INSERT OR REPLACE INTO mobile_models (
        model, dtype, brand, brand_title, code, code_alias, model_name, ver_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const record of records) {
      if (!record.model) {
        continue;
      }

      await insertStmt
        .bind(
          record.model,
          record.dtype,
          record.brand,
          record.brand_title,
          record.code,
          record.code_alias,
          record.model_name,
          record.ver_name
        )
        .run();
    }

    await env.DB.prepare(
      `
      INSERT INTO sync_meta (key, value, updated_at)
      VALUES ('last_sync_count', ?, datetime('now'))
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `
    )
      .bind(String(records.length))
      .run();

    await env.DB.exec("COMMIT");
  } catch (error) {
    await env.DB.exec("ROLLBACK");
    throw error;
  }

  return { count: records.length };
}
