import { DATASET_URL } from "../constants.js";
import { parseCsv } from "./csv.js";
import { ensureSchema } from "../db.js";

const INSERT_CHUNK_SIZE = 200;

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

  await env.DB.prepare("DELETE FROM mobile_models").run();

  const insertStmt = env.DB.prepare(`
    INSERT OR REPLACE INTO mobile_models (
      model, dtype, brand, brand_title, code, code_alias, model_name, ver_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const validRecords = records.filter((record) => record.model);

  for (let i = 0; i < validRecords.length; i += INSERT_CHUNK_SIZE) {
    const chunk = validRecords.slice(i, i + INSERT_CHUNK_SIZE);
    const statements = chunk.map((record) =>
      insertStmt.bind(
        record.model,
        record.dtype,
        record.brand,
        record.brand_title,
        record.code,
        record.code_alias,
        record.model_name,
        record.ver_name
      )
    );

    if (typeof env.DB.batch === "function") {
      await env.DB.batch(statements);
    } else {
      for (const statement of statements) {
        await statement.run();
      }
    }
  }

  await env.DB.prepare(
    `
    INSERT INTO sync_meta (key, value, updated_at)
    VALUES ('last_sync_count', ?, datetime('now'))
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
  )
    .bind(String(validRecords.length))
    .run();

  return { count: validRecords.length };
}
