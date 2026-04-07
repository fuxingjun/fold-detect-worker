function normalizeText(input) {
  return (input || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function splitKeywords(rawKeywords, fallbackKeywords = []) {
  if (!rawKeywords) {
    return fallbackKeywords;
  }

  return rawKeywords
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isFoldModel(model, keywords) {
  const haystack = normalizeText(
    [model.brand_title, model.model_name, model.ver_name].filter(Boolean).join(" ")
  );

  return keywords.some((keyword) => haystack.includes(normalizeText(keyword)));
}

export function buildFoldModels(rows, keywords) {
  return rows.filter((row) => isFoldModel(row, keywords)).map((row) => ({
    model: row.model,
    brandTitle: row.brand_title,
    modelName: row.model_name,
    versionName: row.ver_name || ""
  }));
}
