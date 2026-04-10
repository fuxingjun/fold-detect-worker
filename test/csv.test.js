import { parseCsv } from "../src/services/csv.js";

describe("csv parser", () => {
  it("parseCsv should parse expected fields", () => {
    const csv = [
      "model,dtype,brand,brand_title,code,code_alias,model_name,ver_name",
      "x1,mob,huawei,华为,,,Mate X5,典藏版"
    ].join("\n");

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      model: "x1",
      dtype: "mob",
      brand: "huawei",
      brand_title: "华为",
      code: "",
      code_alias: "",
      model_name: "Mate X5",
      ver_name: "典藏版"
    });
  });

  it("parseCsv should handle UTF-8 BOM header", () => {
    const csv = [
      "\ufeffmodel,dtype,brand,brand_title,code,code_alias,model_name,ver_name",
      "SM-F9000,mob,samsung,三星,,,Galaxy Fold,国行"
    ].join("\n");

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe("SM-F9000");
    expect(rows[0].model_name).toBe("Galaxy Fold");
  });
});
