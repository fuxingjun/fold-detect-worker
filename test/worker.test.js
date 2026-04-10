import worker from "../src/worker.js";

function createMockDb(rows = []) {
  return {
    exec: async () => { },
    prepare(sql) {
      if (sql.includes("FROM sync_meta")) {
        return {
          first: async () => ({ value: "3", updated_at: "2026-04-07 10:00:00" })
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

  it("GET / should include feature and api docs", async () => {
    const env = { DB: createMockDb(sampleRows) };
    const request = new Request("https://example.com/");

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(data.features)).toBe(true);
    expect(data.features).toContain("test-model 打分判定接口");
    expect(data.apis.foldVerify).toContain("GET /api/fold-models/verify");
    expect(data.apis.modelSearch).toContain("GET /api/models");
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
