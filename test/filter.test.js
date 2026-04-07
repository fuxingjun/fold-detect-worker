import {
  splitKeywords,
  isFoldModel,
  buildFoldModels
} from "../src/services/filter.js";

describe("filter service", () => {
  it("splitKeywords should split query string", () => {
    const keywords = splitKeywords("Mate X,Magic V, Galaxy Z Fold");
    expect(keywords).toEqual(["Mate X", "Magic V", "Galaxy Z Fold"]);
  });

  it("isFoldModel should match fold model", () => {
    const matched = isFoldModel(
      { brand_title: "华为", model_name: "Mate X5", ver_name: "典藏版" },
      ["Mate X", "Magic V"]
    );

    const unmatched = isFoldModel(
      { brand_title: "苹果", model_name: "iPhone 15", ver_name: "" },
      ["Mate X", "Magic V"]
    );

    expect(matched).toBe(true);
    expect(unmatched).toBe(false);
  });

  it("buildFoldModels should return formatted fold list", () => {
    const rows = [
      { model: "a", brand_title: "华为", model_name: "Mate X5", ver_name: "典藏版" },
      { model: "b", brand_title: "苹果", model_name: "iPhone 15", ver_name: "" }
    ];

    const result = buildFoldModels(rows, ["Mate X"]);
    expect(result).toEqual([
      {
        model: "a",
        brandTitle: "华为",
        modelName: "Mate X5",
        versionName: "典藏版"
      }
    ]);
  });
});
