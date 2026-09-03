// 企业微信群机器人 webhook 地址
const WECOM_WEBHOOK_BASE = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send";

// 解析 webhook 配置，支持两种形式:
// - 完整 URL: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
// - 纯 key: xxx
export function resolveWebhookUrl(rawWebhook) {
  const value = String(rawWebhook || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `${WECOM_WEBHOOK_BASE}?key=${value}`;
}

export function isWecomEnabled(env) {
  return resolveWebhookUrl(env && env.WECOM_WEBHOOK) !== null;
}

// 发送文本消息到企业微信群机器人。
// 未配置 WECOM_WEBHOOK 时静默跳过，返回 { skipped: true }；
// 请求失败或企业微信返回非 0 errcode 时抛出异常，由调用方决定处理方式。
export async function sendWecomText(env, content) {
  const webhookUrl = resolveWebhookUrl(env && env.WECOM_WEBHOOK);
  if (!webhookUrl) return { skipped: true };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msgtype: "text",
      text: { content: String(content || "") }
    })
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // 响应体不是 JSON 时保持 null，走下方统一错误处理
  }

  if (!response.ok || !data || data.errcode !== 0) {
    const errcode = data ? data.errcode : "n/a";
    const errmsg = data ? data.errmsg : "invalid response";
    throw new Error(
      `wecom webhook failed, status=${response.status}, errcode=${errcode}, errmsg=${errmsg}`
    );
  }

  return { skipped: false };
}
