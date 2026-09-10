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
function createTrackingDb({ storedHash = null, rows = [], storedCount } = {}) {
  const state = { storedHash };
  // 默认与表内行数一致；不一致场景用于验证「脏哈希兜底」
  const metaCount = storedCount === undefined ? rows.length : storedCount;
  const writes = { inserts: [], insertRecords: [], deletes: [], metaUpserts: [] };

  const db = {
    exec: async () => { },
    batch: async (statements) => {
      for (const stmt of statements) {
        // 模拟语句执行：按 SQL 类型归类记录
        if (stmt.sql.includes("INSERT OR REPLACE")) {
          writes.inserts.push(stmt.bindParams[0]);
          writes.insertRecords.push(stmt.bindParams);
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
              : { value: String(metaCount), updated_at: "2026-09-01 10:00:00" }
        };
      }

      // 行数一致性校验 (SELECT COUNT(*) AS total FROM mobile_models)
      if (sql.includes("COUNT(*)")) {
        return {
          first: async () => ({ total: rows.length })
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
  // vi.stubGlobal 不返回 mock 本身，需先创建再 stub 才能拿到 spy;
  // fetch 会被多次读取(下载数据集 + 同步内可能的重试)，必须始终返回同一内容
  let cached;
  const mock = vi.fn(async () => {
    cached ??= new Response(content);
    return cached;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("syncModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should skip all writes when dataset hash is unchanged", async () => {
    mockFetchCsv(sampleCsv);
    const hash = await sha256Hex(sampleCsv);
    const rows = [
      { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版", sources: "[]" },
      { model: "m2", dtype: "手机", brand: "荣耀", brand_title: "荣耀", code: "HY1", code_alias: "", model_name: "Magic V3", ver_name: "标准版", sources: "[]" }
    ];
    const { db, writes } = createTrackingDb({ storedHash: hash, rows });

    const result = await syncModels({ DB: db });

    expect(result.skipped).toBe(true);
    expect(result.count).toBe(2);
    expect(writes.inserts).toHaveLength(0);
    expect(writes.deletes).toHaveLength(0);
    expect(writes.metaUpserts).toHaveLength(0);
  });

  it("should force full sync when hash matches but stored row count mismatches", async () => {
    // 兜底保护: 哈希失真(如 CDN 缓存写入错误哈希)时不应被永久锁死同步。
    // 构造 storedHash 与内容一致、但 sync_meta 记录行数(999)与表内实际行数(0)不符的场景。
    mockFetchCsv(sampleCsv);
    const hash = await sha256Hex(sampleCsv);
    const { db, writes } = createTrackingDb({
      storedHash: hash,
      rows: [],
      storedCount: 999
    });

    const result = await syncModels({ DB: db });

    // 未跳过, 走全量 diff 补齐数据
    expect(result.skipped).toBeUndefined();
    expect(result.changed).toBe(2);
    expect(writes.inserts).toEqual(["m1", "m2"]);
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
    // 备注: m1/m2/m4 均带有 sources（等价于升级后已补齐的现状），避免引入额外变更
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版", sources: "[]" },
        { model: "m2", dtype: "手机", brand: "荣耀", brand_title: "荣耀", code: "HY1", code_alias: "", model_name: "Magic V3", ver_name: "标准版", sources: "[]" },
        { model: "m4", dtype: "手机", brand: "小米", brand_title: "小米", code: "MI1", code_alias: "", model_name: "MIX Fold 4", ver_name: "", sources: "[]" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.count).toBe(3);
    // m2 变更 + m3 新增 + m4 删除 = 3 条写入；m1 未变化被跳过
    expect(result.changed).toBe(3);
    expect(writes.inserts).toEqual(["m2", "m3"]);
    expect(writes.deletes).toEqual(["m4"]);
  });

  it("should collapse duplicate model rows to a single write", async () => {
    // 数据集改版后同一 model 会出现多条记录（多代号/多来源），
    // DB 以 model 为主键只能存一行，应只写一次且以最后一条为准
    const duplicatedCsv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name,source_file
m1,手机,华为,华为,HW1,,Mate X5,典藏版,huawei_cn
m1,手机,华为,华为,HW2,,Mate X5,标准版,huawei_global_en
m2,手机,荣耀,荣耀,HY1,,Magic V3,标准版,honor_cn
`;
    mockFetchCsv(duplicatedCsv);
    const { db, writes } = createTrackingDb({ storedHash: "old-hash", rows: [] });

    const result = await syncModels({ DB: db });

    // 去重后仅剩 2 个唯一机型，且 m1 只写一次
    expect(result.count).toBe(2);
    expect(result.changed).toBe(2);
    expect(writes.inserts).toEqual(["m1", "m2"]);
    expect(writes.deletes).toHaveLength(0);
    // 以 CSV 中靠后的记录为准，与 INSERT OR REPLACE 的最终结果一致
    const m1Record = writes.insertRecords.find((params) => params[0] === "m1");
    expect(m1Record[4]).toBe("HW2");
    // 末位为聚合后的 sources JSON 数组
    expect(m1Record[8]).toBe('["huawei_cn","huawei_global_en"]');
  });

  it("should aggregate source_file of duplicate models into sources", async () => {
    const csv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name,source_file
m1,手机,苹果,苹果,X1,,iPhone 15,,apple_all
m1,手机,苹果,苹果,X1,,iPhone 15,,apple_cn
m1,手机,苹果,苹果,X1,,iPhone 15,,apple_all_en
`;
    mockFetchCsv(csv);
    const { db, writes } = createTrackingDb({ storedHash: "old-hash", rows: [] });

    await syncModels({ DB: db });

    expect(writes.inserts).toEqual(["m1"]);
    // 去重 + 来源降序排序，保证结果稳定
    expect(writes.insertRecords[0][8]).toBe(
      '["apple_all","apple_all_en","apple_cn"]'
    );
  });

  it("should not rewrite when only ordering of records changed", async () => {
    // sources 已按序固化，CSV 行序变化不应触发无谓写入
    const csv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name,source_file
m1,手机,华为,华为,HW1,,Mate X5,典藏版,huawei_cn
m1,手机,华为,华为,HW1,,Mate X5,典藏版,huawei_global_en
`;
    mockFetchCsv(csv);
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版", sources: '["huawei_cn","huawei_global_en"]' }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.changed).toBe(0);
    expect(writes.inserts).toHaveLength(0);
  });

  it("should treat missing sources column on old rows as empty array", async () => {
    // 兼容升级前的历史数据: DB 行没有 sources 字段时应视为空，从而触发一次补齐
    const csv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name,source_file
m1,手机,华为,华为,HW1,,Mate X5,典藏版,huawei_cn
`;
    mockFetchCsv(csv);
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.changed).toBe(1);
    expect(writes.inserts).toEqual(["m1"]);
    // 历史行无 sources，补齐为带来源的数组
    expect(writes.insertRecords[0][8]).toBe('["huawei_cn"]');
  });

  it("should not rewrite unchanged rows when dataset has duplicate models", async () => {
    // 回归: 曾因重复主键导致每次同步重复覆盖写数千行
    const duplicatedCsv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name
m1,手机,华为,华为,HW1,,Mate X5,典藏版
m1,手机,华为,华为,HW1,,Mate X5,典藏版
`;
    mockFetchCsv(duplicatedCsv);
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版", sources: "[]" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.count).toBe(1);
    expect(result.changed).toBe(0);
    expect(writes.inserts).toHaveLength(0);
    expect(writes.deletes).toHaveLength(0);
  });

  it("should fetch dataset with cache disabled to avoid stale CDN content", async () => {
    const fetchMock = mockFetchCsv(sampleCsv);
    const { db } = createTrackingDb({ storedHash: "old-hash", rows: [] });

    await syncModels({ DB: db });

    const [url, init] = fetchMock.mock.calls[0];
    // 禁用缓存 + 时间戳非参, 规避边缘缓存返回旧版本内容
    expect(init.cache).toBe("no-store");
    expect(init.headers["cache-control"]).toBe("no-cache");
    expect(String(url)).toMatch(/[?&]_ts=\d+/);
  });

  it("should normalize DB NULL to empty string when comparing", async () => {
    mockFetchCsv(sampleCsv);
    // m1 的 code_alias 为 NULL，CSV 中为空串，应视为一致而跳过
    const { db, writes } = createTrackingDb({
      storedHash: "old-hash",
      rows: [
        { model: "m1", dtype: "手机", brand: "华为", brand_title: "华为", code: "HW1", code_alias: null, model_name: "Mate X5", ver_name: "典藏版", sources: "[]" },
        { model: "m2", dtype: "手机", brand: "荣耀", brand_title: "荣耀", code: "HY1", code_alias: "", model_name: "Magic V3", ver_name: "标准版", sources: "[]" }
      ]
    });

    const result = await syncModels({ DB: db });

    expect(result.changed).toBe(0);
    expect(writes.inserts).toHaveLength(0);
    expect(writes.deletes).toHaveLength(0);
  });
});
