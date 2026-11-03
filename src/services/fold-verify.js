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
    // Apple 首款折叠屏 iPhone Duo (2026, 横向内折); 用 iphone 前缀限定, 避免误伤其他 duo 命名
    "iphone\\s*duo",
    "fold",
    "折叠",
    "大折",
    "三折"
  ].join("|"),
  "i"
);

const weakHorizontalFoldHintPattern = /book.?style|横向内折|横向折叠|内折|对折/i;
// razr 用负向前瞻排除 "razr fold" 组合: Motorola 2026 年的 Razr Fold 是横向大折,
// 不能被 razr 关键词误杀; 其余 razr 系列 (razr 40/50 等) 仍按竖向小折扣分
const clamshellFoldPattern = /flip|razr(?!\s*fold)|folder|pocket|贝壳|小折|竖向外折|竖向/i;
const obviousNonFoldPattern =
  /ipad|tablet|tab\b|watch|band|router|earbuds|notebook|laptop|pc\b|computer|matebook|tv|smart.?display/i;

const brandFamilies = [
  // 三星心系天下 W20~W26 (中国电信定制横向大折, 名称不含 fold), 单独给足 3 分收录;
  // 不能用通用关键词: 华为平板型号后缀 -W20 会被误伤, 故限定三星品牌;
  // 模式 w2\d 覆盖 W20~W29 (每年 10 月迭代一代, W27 已于 2026-10 发布),
  // \b 边界排除 W2013~W2019 老式翻盖双屏机; W2x Flip 竖折版会被 flip 扣分压回
  { brand: /samsung|三星/i, model: /\bw2\d\b/i, score: 3 },
  // 华为: Mate X / Xs / XT 系列（x[ts]?\b 中 [ts] 为字符类，匹配 x、xs、xt；
  // 原写法 [t|s] 把竖线当成了字面量，属笔误，行为上碰巧无差异）
  // 注: Pura X / Pura X Max 为 16:10 阔折叠, 暂不纳入识别目标,
  // 当前仅命中品牌家族 +2 分 (<3 阈值), 不会被误收
  { brand: /huawei|华为/i, model: /mate\s*x|x[ts]?\b/i, score: 2 },
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
