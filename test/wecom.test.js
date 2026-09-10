import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveWebhookUrl,
  isWecomEnabled,
  sendWecomText
} from "../src/services/wecom.js";

const WEBHOOK_URL =
  "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key";

function mockFetchOnce(handler) {
  // vi.stubGlobal 不返回 mock 本身，需先创建再 stub 才能拿到 spy
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function wecomOkResponse() {
  return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), {
    headers: { "content-type": "application/json" }
  });
}

describe("resolveWebhookUrl", () => {
  it("should return null for empty or missing config", () => {
    expect(resolveWebhookUrl(undefined)).toBeNull();
    expect(resolveWebhookUrl("")).toBeNull();
    expect(resolveWebhookUrl("   ")).toBeNull();
  });

  it("should keep full URL as-is", () => {
    expect(resolveWebhookUrl(WEBHOOK_URL)).toBe(WEBHOOK_URL);
  });

  it("should build URL from a bare key", () => {
    expect(resolveWebhookUrl("my-key")).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=my-key"
    );
  });
});

describe("isWecomEnabled", () => {
  it("should reflect whether WECOM_WEBHOOK is configured", () => {
    expect(isWecomEnabled({})).toBe(false);
    expect(isWecomEnabled({ WECOM_WEBHOOK: "key" })).toBe(true);
  });
});

describe("sendWecomText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should skip silently when webhook is not configured", async () => {
    const fetchMock = mockFetchOnce(async () => wecomOkResponse());

    const result = await sendWecomText({}, "hello");

    expect(result).toEqual({ skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should POST a text message to the webhook URL", async () => {
    const fetchMock = mockFetchOnce(async () => wecomOkResponse());

    const result = await sendWecomText(
      { WECOM_WEBHOOK: WEBHOOK_URL },
      "sync done"
    );

    expect(result).toEqual({ skipped: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      msgtype: "text",
      text: { content: "sync done" }
    });
  });

  it("should build webhook URL from bare key", async () => {
    const fetchMock = mockFetchOnce(async () => wecomOkResponse());

    await sendWecomText({ WECOM_WEBHOOK: "my-key" }, "hi");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=my-key"
    );
  });

  it("should throw when wecom returns non-zero errcode", async () => {
    mockFetchOnce(
      async () =>
        new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid webhook" }), {
          headers: { "content-type": "application/json" }
        })
    );

    await expect(
      sendWecomText({ WECOM_WEBHOOK: WEBHOOK_URL }, "hi")
    ).rejects.toThrow("errcode=93000");
  });

  it("should throw when response is not ok or not JSON", async () => {
    mockFetchOnce(async () => new Response("bad gateway", { status: 502 }));

    await expect(
      sendWecomText({ WECOM_WEBHOOK: WEBHOOK_URL }, "hi")
    ).rejects.toThrow("wecom webhook failed");
  });
});
