import { describe, it, expect } from "vitest";
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

  it("verifyFoldable should include iPhone Duo (Apple first foldable, 2026)", () => {
    const verdict = verifyFoldable({
      brand_title: "Apple",
      model_name: "iPhone Duo",
      ver_name: "中国大陆",
      model: "A3721"
    });

    expect(verdict.likelyFold).toBe(true);
    expect(verdict.reasons).toContain("命中横向大折关键词");
  });

  it("verifyFoldable should include Motorola Razr Fold (book-style, not clamshell)", () => {
    const verdict = verifyFoldable({
      brand_title: "Motorola",
      model_name: "Motorola Razr Fold",
      ver_name: "",
      model: "XT3000-1"
    });

    // razr 前瞻排除: 不应触发竖向小折扣分
    expect(verdict.reasons).not.toContain("命中竖向小折关键词");
    expect(verdict.likelyFold).toBe(true);
  });

  it("verifyFoldable should still reject clamshell razr series", () => {
    const verdict = verifyFoldable({
      brand_title: "Motorola",
      model_name: "moto razr 60 Ultra",
      ver_name: "",
      model: "XT2550-1"
    });

    expect(verdict.likelyFold).toBe(false);
    expect(verdict.reasons).toContain("命中竖向小折关键词");
  });

  it("verifyFoldable should exclude HUAWEI Pura X wide-fold (out of scope)", () => {
    const verdict = verifyFoldable({
      brand_title: "华为",
      model_name: "HUAWEI Pura X Max",
      ver_name: "典藏版",
      model: "HOP-AL00"
    });

    // 阔折叠暂不纳入目标: 仅品牌家族 +2, 低于 3 分阈值
    expect(verdict.likelyFold).toBe(false);
    expect(verdict.score).toBe(2);
  });

  it("verifyFoldable should include Samsung W20-W27 China Telecom fold series", () => {
    // W27: 2026-10-29 发布 (基于 Galaxy Z Fold8 Ultra 打造)
    const verdict = verifyFoldable({
      brand_title: "三星",
      model_name: "三星 W27",
      ver_name: "",
      model: "SM-W9027"
    });

    // 心系天下 W 系列为横向大折, 名称不含 fold, 靠三星专属品牌家族规则 (+3) 收录
    expect(verdict.likelyFold).toBe(true);
    expect(verdict.reasons).toContain("命中品牌家族");
  });

  it("verifyFoldable should reject Samsung W2x Flip clamshell variants", () => {
    const verdict = verifyFoldable({
      brand_title: "三星",
      model_name: "三星 W25 Flip",
      ver_name: "",
      model: "SM-W7025"
    });

    expect(verdict.likelyFold).toBe(false);
  });

  it("verifyFoldable should reject legacy Samsung W2013-W2019 flip phones", () => {
    const verdict = verifyFoldable({
      brand_title: "三星",
      model_name: "三星 W2019",
      ver_name: "",
      model: "SM-W2019"
    });

    // 老式翻盖双屏机, 非现代折叠屏; \b 边界保证 W2019 不被 W2x 规则命中
    expect(verdict.reasons).not.toContain("命中横向大折关键词");
    expect(verdict.likelyFold).toBe(false);
  });

  it("verifyFoldable should reject Huawei tablets with -W20 model code suffix", () => {
    const verdict = verifyFoldable({
      brand_title: "华为",
      model_name: "HUAWEI MatePad Air",
      ver_name: "",
      model: "BKY-W20"
    });

    // 华为平板型号后缀 -W20 不应触发 W 系列规则 (该规则限定三星品牌)
    expect(verdict.likelyFold).toBe(false);
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
