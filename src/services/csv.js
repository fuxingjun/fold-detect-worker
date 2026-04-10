import { parse } from "csv-parse/sync";

export function parseCsv(csvContent) {
  const records = parse(csvContent, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return records.map((record) => ({
    model: record.model || "",
    dtype: record.dtype || "",
    brand: record.brand || "",
    brand_title: record.brand_title || "",
    code: record.code || "",
    code_alias: record.code_alias || "",
    model_name: record.model_name || "",
    ver_name: record.ver_name || ""
  }));
}
