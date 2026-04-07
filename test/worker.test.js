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
        return {
          all: async () => ({ results: rows })
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
      DB: createMockDb([
        { model: "x1", brand_title: "华为", model_name: "Mate X5", ver_name: "典藏版" },
        { model: "x2", brand_title: "苹果", model_name: "iPhone 15", ver_name: "" }
      ])
    };

    const request = new Request(
      "https://example.com/api/fold-models?keywords=Mate%20X,Magic%20V"
    );

    const response = await worker.fetch(request, env);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.data[0].modelName).toBe("Mate X5");
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
