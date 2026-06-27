const ARK_RESPONSES_URL = "https://ark.cn-beijing.volces.com/api/v3/responses";
const DEFAULT_MODEL = "doubao-seed-2-0-mini-260428";

function apiKey() {
  return process.env.ARK_API_KEY || process.env.VOLCENGINE_ARK_API_KEY || "";
}

function outputTextFromResponse(data) {
  const chunks = [];
  for (const item of data?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, "").replace(/[，。！？,.!?~～]/g, "").trim();
}

function rewritePrompt(source, retry = false) {
  return [
    "你是短视频混剪文案改写助手。",
    "请在不改变核心意思、事实和口吻方向的前提下，改写下面这段文案。",
    "要求：更自然、更适合口播；避免夸张营销腔；不要解释；只输出改写后的文案。",
    "如果原文只是一个词或短语，不要原样返回，要扩写成一句 20-60 字的自然短视频口播文案。",
    retry ? "重要：上一次输出与原文太接近，这次必须明显改写，不能原样返回。" : "",
    "",
    source,
  ].filter(Boolean).join("\n");
}

async function requestRewrite(source, key, options = {}, retry = false) {
  const resp = await fetch(ARK_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || process.env.ARK_MODEL || DEFAULT_MODEL,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: rewritePrompt(source, retry) }],
        },
      ],
    }),
  });
  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(raw.trim() || `AI改写失败：HTTP ${resp.status}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`AI返回格式异常：${raw.slice(0, 120)}`);
  }
  const rewritten = outputTextFromResponse(data);
  if (!rewritten) throw new Error("AI未返回改写文案");
  return rewritten;
}

export async function rewriteCopy(text, options = {}) {
  const source = String(text || "").trim();
  if (!source) throw new Error("文案不能为空");
  const key = apiKey();
  if (!key) throw new Error("未配置 ARK_API_KEY");
  const first = await requestRewrite(source, key, options);
  if (normalizedText(first) !== normalizedText(source)) return first;
  const second = await requestRewrite(source, key, options, true);
  if (normalizedText(second) !== normalizedText(source)) return second;
  return `关于${source}，今天用一句话讲清楚它的实用价值，帮你快速判断到底适不适合自己。`;
}
