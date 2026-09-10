import { vi, afterEach } from "vitest";
import worker from "../src/worker.js";

function createMockDb(rows = [], { syncHash = "3", syncCount = "3" } = {}) {
  return {
    exec: async () => { },
    prepare(sql) {
      if (sql.includes("last_sync_hash")) {
        return {
          first: async () => ({ value: syncHash })
        };
      }

      if (sql.includes("FROM sync_meta")) {
        return {
          first: async () => ({ value: syncCount, updated_at: "2026-04-07 10:00:00" })
        };
      }

      if (sql.includes("FROM mobile_models")) {
        let bindParams = [];
        return {
          bind(...params) {
            bindParams = params;
            return this;
          },
          all: async () => {
            if (!sql.includes("WHERE") || bindParams.length === 0) {
              return { results: rows };
            }

            let filtered = [...rows];
            let idx = 0;

            if (sql.includes("brand_title = ?")) {
              const brand = bindParams[idx++];
              filtered = filtered.filter((row) => row.brand_title === brand);
            } else if (sql.includes("brand_title LIKE ?")) {
              const brandLike = String(bindParams[idx++] || "").replaceAll("%", "");
              filtered = filtered.filter((row) => row.brand_title.includes(brandLike));
            }

            if (sql.includes("model_name = ?")) {
              const model = bindParams[idx++];
              filtered = filtered.filter((row) => row.model_name === model);
            } else if (sql.includes("model_name LIKE ?")) {
              const modelLike = String(bindParams[idx++] || "").replaceAll("%", "");
              filtered = filtered.filter((row) => row.model_name.includes(modelLike));
            }

            const limit = Number(bindParams[bindParams.length - 1] || filtered.length);
            return { results: filtered.slice(0, limit) };
          }
        };
      }

      return {
        bind() {
          return this;
        },
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
        first: async () => null
      };
    }
  };
}

describe("worker fetch", () => {
  const sampleRows = [
    { model: "x1", brand_title: "华为", model_name: "Mate X5", ver_name: "典藏版" },
    { model: "x2", brand_title: "荣耀", model_name: "Magic V3", ver_name: "标准版" },
    { model: "x3", brand_title: "苹果", model_name: "iPhone 15", ver_name: "" }
  ];

  it("GET /api/health should return sync info", async () => {
    const env = { DB: createMockDb() };
    const request = new Request("https://example.com/api/health");

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.lastSyncCount).toBe(3);
  });

  it("GET /api/fold-models should return filtered data", async () => {
    const env = {
      DB: createMockDb(sampleRows)
    };

    const request = new Request(
      "https://example.com/api/fold-models?keywords=Mate%20X"
    );

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.data[0].modelName).toBe("Mate X5");
  });

  it("GET /api/models should support fuzzy query", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request(
      "https://example.com/api/models?brand=华&brand_match=fuzzy&model=Mate&model_match=fuzzy"
    );

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.data[0].brandTitle).toBe("华为");
    expect(data.data[0].modelName).toBe("Mate X5");
  });

  it("GET /api/models should support exact query", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request(
      "https://example.com/api/models?brand=荣耀&brand_match=exact&model=Magic%20V3&model_match=exact"
    );

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.data[0].model).toBe("x2");
  });

  it("GET /api/models should return 400 when brand/model missing", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request("https://example.com/api/models");

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("bad request");
  });

  it("GET / should return detailed text docs", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request("https://example.com/");

    const response = await worker.fetch(request, env);
    const data = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(data).toContain("fold-detect-worker");
    expect(data).toContain("GET /api/fold-models/verify");
    expect(data).toContain("POST /api/sync");
    expect(data).toContain("brand 和 model 至少传一个");
  });

  it("GET /api/fold-models/verify should return test-model scoring result", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request("https://example.com/api/fold-models/verify");

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.strategy).toBe("test-model-scoring");
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.data[0]).toHaveProperty("confidence");
    expect(data.data[0]).toHaveProperty("score");
    expect(data.data[0]).toHaveProperty("reasons");
  });

  it("GET /api/fold-models/verify?min=true should return min fields", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request("https://example.com/api/fold-models/verify?min=true");

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.strategy).toBe("test-model-scoring");
    expect(data.min).toBe(true);
    expect(data.total).toBeGreaterThanOrEqual(1);
    expect(data.data[0]).toHaveProperty("model");
    expect(data.data[0]).toHaveProperty("brand");
    expect(data.data[0]).toHaveProperty("modelName");
    expect(data.data[0]).not.toHaveProperty("verName");
    expect(data.data[0]).not.toHaveProperty("confidence");
    expect(data.data[0]).not.toHaveProperty("score");
    expect(data.data[0]).not.toHaveProperty("reasons");
  });

  it("POST /api/sync should check token", async () => {
    const env = {
      DB: createMockDb(),
      SYNC_TOKEN: "secret"
    };

    const request = new Request("https://example.com/api/sync", {
      method: "POST"
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(401);
  });
});

describe("POST /api/sync wecom notification", () => {
  const datasetCsv = `model,dtype,brand,brand_title,code,code_alias,model_name,ver_name
m1,手机,华为,华为,HW1,,Mate X5,典藏版
`;

  const syncedRow = {
    model: "m1", dtype: "手机", brand: "华为", brand_title: "华为",
    code: "HW1", code_alias: "", model_name: "Mate X5", ver_name: "典藏版"
  };

  // 与 sync.js 中 hashContent 的算法保持一致
  async function sha256Hex(content) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(content)
    );
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function mockFetchByRoute(csv, wecomCalls) {
    // vi.stubGlobal 不返回 mock 本身，需先创建再 stub 才能拿到 spy
    const mock = vi.fn(async (url) => {
      if (String(url).includes("qyapi.weixin.qq.com")) {
        wecomCalls.push(url);
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(csv);
    });
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should send wecom notification after a successful sync with changes", async () => {
    const wecomCalls = [];
    const fetchMock = mockFetchByRoute(datasetCsv, wecomCalls);
    const env = {
      DB: createMockDb(),
      WECOM_WEBHOOK: "test-key"
    };

    const request = new Request("https://example.com/api/sync", {
      method: "POST"
    });

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.synced).toBe(1);
    expect(wecomCalls).toHaveLength(1);

    const wecomCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("qyapi.weixin.qq.com")
    );
    expect(wecomCall[0]).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key"
    );
    expect(JSON.parse(wecomCall[1].body).text.content).toContain("数据同步完成");
  });

  it("should not send wecom notification when dataset is unchanged", async () => {
    const contentHash = await sha256Hex(datasetCsv);
    const wecomCalls = [];
    mockFetchByRoute(datasetCsv, wecomCalls);
    const env = {
      DB: createMockDb([syncedRow], { syncHash: contentHash }),
      WECOM_WEBHOOK: "test-key"
    };

    const request = new Request("https://example.com/api/sync", {
      method: "POST"
    });

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.skipped).toBe(true);
    expect(wecomCalls).toHaveLength(0);
  });

  it("should send failure notification and return 500 when sync fails", async () => {
    const wecomCalls = [];
    const fetchMock = mockFetchByRoute(datasetCsv, wecomCalls);
    // 让数据集下载失败: fetch 到非 wecom 地址时抛错
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("qyapi.weixin.qq.com")) {
        wecomCalls.push(url);
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("boom", { status: 500 });
    });

    const env = {
      DB: createMockDb(),
      WECOM_WEBHOOK: "test-key"
    };

    const request = new Request("https://example.com/api/sync", {
      method: "POST"
    });

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("sync failed");
    expect(wecomCalls).toHaveLength(1);

    const wecomCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("qyapi.weixin.qq.com")
    );
    expect(JSON.parse(wecomCall[1].body).text.content).toContain("数据同步失败");
  });
});
