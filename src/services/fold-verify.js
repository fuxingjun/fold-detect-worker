function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildHaystack(row) {
  return normalizeText(
    [row.brand_title, row.model_name, row.ver_name, row.model].filter(Boolean).join(" ")
  );
}

const horizontalFoldNamePattern = new RegExp(
  [
    "mate\\s*x",
    "mate\\s*xt",
    "magic\\s*v",
    "galaxy\\s*z\\s*fold",
    "find\\s*n",
    "mix\\s*fold",
    "x\\s*fold",
    "pixel\\s*fold",
    "oneplus\\s*open",
    "open",
    "phantom\\s*v\\s*fold",
    "tri\\s*fold",
    "fold",
    "折叠",
    "大折",
    "三折"
  ].join("|"),
  "i"
);

const weakHorizontalFoldHintPattern = /book.?style|横向内折|横向折叠|内折|对折/i;
const clamshellFoldPattern = /flip|razr|folder|pocket|贝壳|小折|竖向外折|竖向/i;
const obviousNonFoldPattern =
  /ipad|tablet|tab\b|watch|band|router|earbuds|notebook|laptop|pc\b|computer|matebook|tv|smart.?display/i;

const brandFamilies = [
  { brand: /huawei|华为/i, model: /mate\s*x|x[t|s]?\b/i, score: 2 },
  { brand: /honor|荣耀/i, model: /magic\s*v|vs\b/i, score: 2 },
  { brand: /samsung|三星/i, model: /z\s*fold|w\d{2}/i, score: 2 },
  { brand: /xiaomi|小米|redmi/i, model: /mix\s*fold/i, score: 2 },
  { brand: /vivo/i, model: /x\s*fold/i, score: 2 },
  { brand: /oppo|oneplus/i, model: /find\s*n|open/i, score: 2 },
  { brand: /google/i, model: /pixel\s*fold/i, score: 2 },
  { brand: /tecno/i, model: /phantom\s*v\s*fold/i, score: 2 }
];

export function verifyFoldable(row) {
  const haystack = buildHaystack(row);
  let score = 0;
  const reasons = [];

  if (horizontalFoldNamePattern.test(haystack)) {
    score += 3;
    reasons.push("命中横向大折关键词");
  } else if (weakHorizontalFoldHintPattern.test(haystack)) {
    score += 1;
    reasons.push("命中横向大折弱关键词");
  }

  if (clamshellFoldPattern.test(haystack)) {
    score -= 4;
    reasons.push("命中竖向小折关键词");
  }

  for (const family of brandFamilies) {
    if (family.brand.test(haystack) && family.model.test(haystack)) {
      score += family.score;
      reasons.push("命中品牌家族");
      break;
    }
  }

  if (obviousNonFoldPattern.test(haystack)) {
    score -= 4;
    reasons.push("命中非手机或非折叠设备关键词");
  }

  return {
    likelyFold: score >= 3,
    score,
    confidence: score >= 5 ? "high" : score >= 3 ? "medium" : score >= 1 ? "low" : "reject",
    reasons
  };
}

export function pickFoldableModels(rows = []) {
  const filtered = [];

  for (const row of rows) {
    const verdict = verifyFoldable(row);
    if (!verdict.likelyFold) {
      continue;
    }

    filtered.push({
      model: row.model,
      brand: row.brand_title,
      modelName: row.model_name,
      verName: row.ver_name || "",
      confidence: verdict.confidence,
      score: verdict.score,
      reasons: verdict.reasons
    });
  }

  const uniqueByModel = new Map();
  for (const item of filtered) {
    const key = String(item.model || "").trim().toUpperCase();
    if (!key) {
      continue;
    }

    const existing = uniqueByModel.get(key);
    if (!existing || item.score > existing.score) {
      uniqueByModel.set(key, item);
    }
  }

  return [...uniqueByModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}
