import { describe, it, expect, vi, afterEach } from "vitest";
import { syncModels } from "../src/services/sync.js";

const sampleCsv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name
m1,手机,华为,华为,HW1,,Mate X5,典藏版
m2,手机,荣耀,荣耀,HY1,,Magic V3,标准版
`;

// 与 sampleCsv 相比: m2 的 ver_name 变化, m3 为新增
const changedCsv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name
m1,手机,华为,华为,HW1,,Mate X5,典藏版
m2,手机,荣耀,荣耀,HY1,,Magic V3,旗舰版
m3,手机,苹果,苹果,AP1,,iPhone 16,
`;

// 计算 SHA-256 十六进制哈希，与 sync.js 中 hashContent 的算法保持一致
async function sha256Hex(content) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// 构造可跟踪写入语句的 mock DB
function createTrackingDb({ storedHash = null, rows = [] } = {}) {
  const state = { storedHash };
  const writes = { inserts: [], deletes: [], metaUpserts: [] };

  const db = {
    batch: async (statements) => {
      for (const stmt of statements) {
        // 模拟语句执行：按 SQL 类型归类记录
        if (stmt.sql.includes("INSERT OR REPLACE")) {
          writes.inserts.push(stmt.bindParams[0]);
        } else if (stmt.sql.trim().startsWith("DELETE")) {
          writes.deletes.push(stmt.bindParams[0]);
        } else if (stmt.sql.includes("ON CONFLICT")) {
          writes.metaUpserts.push({ key: stmt.bindParams[0], value: stmt.bindParams[1] });
          if (stmt.bindParams[0] === "last_sync_hash") {
            state.storedHash = stmt.bindParams[1];
          }
        }
      }
    },
    prepare(sql) {
      if (sql.includes("FROM sync_meta")) {
        return {
          first: async () =>
            sql.includes("last_sync_hash")
              ? { value: state.storedHash }
              : { value: "2", updated_at: "2026-09-01 10:00:00" }
        };
      }

      // 仅 SELECT 全表查询走此分支（DELETE ... WHERE model = ? 也含表名）
      if (sql.trim().startsWith("SELECT") && sql.includes("FROM mobile_models")) {
        return {
          all: async () => ({ results: rows })
        };
      }

      return {
        sql,
        // 每次绑定返回新对象，避免多条语句共享同一 bindParams 被覆盖
        bind(...params) {
          return {
            sql,
            bindParams: params,
            run: async () => ({ success: true }),
            all: async () => ({ results: [] })
          };
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] })
      };
    }
  };

  return { db, writes, state };
}

function mockFetchCsv(content) {
  return vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(content))
  );
}

describe("syncModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should skip all writes when dataset hash is unchanged", async () => {
    mockFetchCsv(sampleCsv);
    const hash = await sha256Hex(sampleCsv);
    const { db, writes } = createTrackingDb({ storedHash: hash });

    const result = await syncModels({ DB: db });

    expect(result.skipped).toBe(true);
    expect(result.count).toBe(2);
    expect(writes.inserts).toHaveLength(0);
    expect(writes.deletes).toHaveLength(0);
    expect(writes.metaUpserts).toHaveLength(0);
  });

  it("should insert all rows into an empty database", async () => {
    mockFetchCsv(sampleCsv);
    const { db, writes, state } = createTrackingDb({
      storedHash: "old-hash",
      rows: []
    });

    const result = await syncModels({ DB: db });

    expect(result.count).toBe(2);
    expect(result.changed).toBe(2);
    expect(writes.inserts).toEqual(["m1", "m2"]);
    expect(writes.deletes).toHaveLength(0);
    expect(state.storedHash).toBe(await sha256Hex(sampleCsv));
  });

  it("should only write changed/new rows and delete stale rows", async () => {
    mockFetchCsv(changedCsv);
    // DB 中已有 m1（与 CSV 一致）、m2（ver_name 不同）、m4（CSV 已移除）
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版" },
        { model: "m2", dtype: "手机", brand: "荣耀", brand_title: "荣耀", code: "HY1", code_alias: "", model_name: "Magic V3", ver_name: "标准版" },
        { model: "m4", dtype: "手机", brand: "小米", brand_title: "小米", code: "MI1", code_alias: "", model_name: "MIX Fold 4", ver_name: "" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.count).toBe(3);
    // m2 变更 + m3 新增 + m4 删除 = 3 条写入；m1 未变化被跳过
    expect(result.changed).toBe(3);
    expect(writes.inserts).toEqual(["m2", "m3"]);
    expect(writes.deletes).toEqual(["m4"]);
  });

  it("should normalize DB NULL to empty string when comparing", async () => {
    mockFetchCsv(sampleCsv);
    // m1 的 code_alias 为 NULL，CSV 中为空串，应视为一致而跳过
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: null, model_name: "Mate X5", ver_name: "典藏版" },
        { model: "m2", dtype: "手机", brand: "荣耀", brand_title: "荣耀", code: "HY1", code_alias: "", model_name: "Magic V3", ver_name: "标准版" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.changed).toBe(0);
    expect(writes.inserts).toHaveLength(0);
    expect(writes.deletes).toHaveLength(0);
  });
});
