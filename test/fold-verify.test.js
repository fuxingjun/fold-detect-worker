import { verifyFoldable, pickFoldableModels } from "../src/services/fold-verify.js";

describe("fold verify service", () => {
  it("verifyFoldable should score horizontal fold model", () => {
    const verdict = verifyFoldable({
      brand_title: "华为",
      model_name: "Mate X5",
      ver_name: "典藏版",
      model: "ALT-AL00"
    });

    expect(verdict.likelyFold).toBe(true);
    expect(verdict.score).toBeGreaterThanOrEqual(3);
  });

  it("verifyFoldable should reject obvious non fold model", () => {
    const verdict = verifyFoldable({
      brand_title: "苹果",
      model_name: "iPad Pro",
      ver_name: "11英寸",
      model: "A2837"
    });

    expect(verdict.likelyFold).toBe(false);
    expect(verdict.confidence).toBe("reject");
  });

  it("pickFoldableModels should deduplicate by model with higher score", () => {
    const rows = [
      {
        model: "SM-F9460",
        brand_title: "三星",
        model_name: "Galaxy Z Fold5",
        ver_name: "标准版"
      },
      {
        model: "sm-f9460",
        brand_title: "三星",
        model_name: "Galaxy Fold",
        ver_name: "旧命名"
      }
    ];

    const result = pickFoldableModels(rows);

    expect(result).toHaveLength(1);
    expect(result[0].model.toUpperCase()).toBe("SM-F9460");
  });
});
