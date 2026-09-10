import { DATASET_URL } from "../constants.js";
import { parseCsv } from "./csv.js";
import { ensureSchema, getSyncHash, getSyncMeta } from "../db.js";

// 每批提交的语句数上限，与 D1 batch 限制保持安全余量
const BATCH_CHUNK_SIZE = 200;

// mobile_models 表的全部业务字段（不含主键时用于对比，含主键时用于绑定）
const COLUMNS = [
  "model",
  "dtype",
  "brand",
  "brand_title",
  "code",
  "code_alias",
  "model_name",
  "ver_name"
];

export async function fetchDataset(url = DATASET_URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download dataset failed, status=${response.status}`);
  }

  return response.text();
}

// 计算 CSV 内容的 SHA-256 哈希，用于判断数据集是否有变化
async function hashContent(content) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// DB 行与 CSV 记录逐字段对比（DB 中的 NULL 归一化为空串再比较）
function isSameRecord(row, record) {
  return COLUMNS.every((col) => (row[col] ?? "") === (record[col] ?? ""));
}

// 数据集存在同一 model 的多条记录（多代号/多来源等），而 mobile_models 以 model 为主键
// 只能保留一行。这里按 CSV 出现顺序去重、后者覆盖前者，与 INSERT OR REPLACE 的最终结果一致，
// 避免同一 model 的多个变体各自触发一次覆盖写（曾导致单次同步虚增数千条变更）。
function dedupeByModel(records) {
  const byModel = new Map();
  for (const record of records) {
    byModel.set(record.model, record);
  }
  return [...byModel.values()];
}

// 分批提交语句，兼容不支持 batch 的环境
async function runStatements(db, statements) {
  for (let i = 0; i < statements.length; i += BATCH_CHUNK_SIZE) {
    const chunk = statements.slice(i, i + BATCH_CHUNK_SIZE);

    if (typeof db.batch === "function") {
      await db.batch(chunk);
    } else {
      for (const statement of chunk) {
        await statement.run();
      }
    }
  }
}

export async function syncModels(env, url = DATASET_URL) {
  const datasetUrl = env.DATASET_URL || url;
  await ensureSchema(env.DB);

  const csvContent = await fetchDataset(datasetUrl);
  const contentHash = await hashContent(csvContent);

  // 第一层节省：数据集内容未变化时直接跳过，不产生任何写入。
  // 否则定时任务每天 4 次全量重写约 2.4 万行/次，会超出 D1 每日写入限额。
  if ((await getSyncHash(env.DB)) === contentHash) {
    const meta = await getSyncMeta(env.DB);
    return { count: meta.lastSyncCount, skipped: true };
  }

  const validRecords = dedupeByModel(
    parseCsv(csvContent).filter((record) => record.model)
  );

  // 第二层节省：读全表做逐行 diff，只写入新增/变更/删除的行。
  // D1 读限额（免费版 500 万行/天）远宽于写限额，全表读不构成压力。
  const { results } = await env.DB.prepare(
    `
    SELECT model, dtype, brand, brand_title, code, code_alias, model_name, ver_name
    FROM mobile_models
    `
  ).all();
  const existing = new Map(
    (results || []).map((row) => [row.model, row])
  );

  const insertStmt = env.DB.prepare(`
    INSERT OR REPLACE INTO mobile_models (
      model, dtype, brand, brand_title, code, code_alias, model_name, ver_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteStmt = env.DB.prepare("DELETE FROM mobile_models WHERE model = ?");

  const csvModels = new Set();
  const statements = [];

  for (const record of validRecords) {
    csvModels.add(record.model);
    const row = existing.get(record.model);
    // 已存在且字段完全一致则跳过，不产生写入
    if (row && isSameRecord(row, record)) continue;
    statements.push(insertStmt.bind(...COLUMNS.map((col) => record[col])));
  }

  // DB 中存在但数据集已移除的机型，需要删除以免残留脏数据
  for (const model of existing.keys()) {
    if (!csvModels.has(model)) {
      statements.push(deleteStmt.bind(model));
    }
  }

  await runStatements(env.DB, statements);

  // 同步成功后同时记录行数与数据集哈希，下次内容未变化时即可跳过写入
  const metaUpsert = (key, value) => env.DB.prepare(
    `
    INSERT INTO sync_meta (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `
  ).bind(key, value);

  await runStatements(env.DB, [
    metaUpsert("last_sync_count", String(validRecords.length)),
    metaUpsert("last_sync_hash", contentHash)
  ]);

  return { count: validRecords.length, changed: statements.length };
}
