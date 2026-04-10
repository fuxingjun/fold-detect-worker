function parseCsvRows(csvContent) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvContent.length; i += 1) {
    const ch = csvContent[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = csvContent[i + 1];
        if (next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch === "\r") {
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((item) => String(item || "").trim().length > 0));
}

function stripBom(input) {
  if (!input) return "";
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function normalizeHeaders(headers) {
  return headers.map((header) => stripBom(String(header || "")).trim());
}

export function parseCsv(csvContent) {
  const rows = parseCsvRows(String(csvContent || ""));
  if (rows.length === 0) {
    return [];
  }

  const headers = normalizeHeaders(rows[0]);
  const records = rows.slice(1).map((values) => {
    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      record[headers[i]] = values[i] || "";
    }

    return {
      model: record.model || "",
      dtype: record.dtype || "",
      brand: record.brand || "",
      brand_title: record.brand_title || "",
      code: record.code || "",
      code_alias: record.code_alias || "",
      model_name: record.model_name || "",
      ver_name: record.ver_name || ""
    };
  });

  return records;
}
