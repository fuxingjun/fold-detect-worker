export const schemaStatements = [
  `
  CREATE TABLE IF NOT EXISTS mobile_models (
    model TEXT PRIMARY KEY,
    dtype TEXT,
    brand TEXT,
    brand_title TEXT,
    code TEXT,
    code_alias TEXT,
    model_name TEXT,
    ver_name TEXT
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_mobile_models_brand_title
  ON mobile_models(brand_title)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_mobile_models_model_name
  ON mobile_models(model_name)
  `,
  `
  CREATE TABLE IF NOT EXISTS sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )
  `
];
