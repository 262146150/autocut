import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const DEFAULT_RESOURCE_ID = "volc.service_type.10029";

function authHeaders(options = {}) {
  const apiKey = options.apiKey || "";
  if (apiKey) return { "x-api-key": apiKey };

  return null;
}

function additionsPayload() {
  return JSON.stringify({
    disable_markdown_filter: true,
    enable_language_detector: true,
    enable_latex_tn: true,
    disable_default_bit_rate: true,
    max_length_to_filter_parenthesis: 0,
    cache_config: {
      text_type: 1,
      use_cache: true,
    },
  });
}

function rateValue(value) {
  const n = Math.round(Number(value) || 0);
  return Math.max(-50, Math.min(100, n));
}

function parseStreamLine(line) {
  const text = line.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`TTS返回格式异常：${text.slice(0, 120)}`);
  }
}

export async function synthesizeSpeech({
  text,
  speaker,
  resourceId,
  outputPath,
  format = "mp3",
  sampleRate = 24000,
  speechRate = 0,
  loudnessRate = 0,
  apiKey = "",
}) {
  const source = String(text || "").trim();
  if (!source) throw new Error("合成文本不能为空");
  const voice = String(speaker || "").trim();
  if (!voice) throw new Error("请选择音色");
  const auth = authHeaders({ apiKey });
  if (!auth) throw new Error("未配置火山 TTS API Key，请先在设置中填写");

  const response = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      ...auth,
      "X-Api-Resource-Id": String(resourceId || DEFAULT_RESOURCE_ID).trim(),
      "X-Control-Require-Usage-Tokens-Return": "*",
      "Connection": "keep-alive",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      req_params: {
        text: source,
        speaker: voice,
        additions: additionsPayload(),
        audio_params: {
          format,
          sample_rate: sampleRate,
          speech_rate: rateValue(speechRate),
          loudness_rate: rateValue(loudnessRate),
        },
      },
    }),
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new Error(raw.trim() || `TTS请求失败：HTTP ${response.status}`);
  }

  const logid = response.headers.get("X-Tt-Logid") || "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  const sentences = [];
  let usage = null;
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let lineEnd;
    while ((lineEnd = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      const data = parseStreamLine(line);
      if (!data) continue;
      if (data.code === 0 && data.data) {
        chunks.push(Buffer.from(data.data, "base64"));
        continue;
      }
      if (data.code === 0 && data.sentence) {
        sentences.push(data.sentence);
        continue;
      }
      if (data.code === 20000000) {
        usage = data.usage ?? null;
        continue;
      }
      if (Number(data.code) > 0) {
        throw new Error(data.message || data.msg || `TTS返回错误：${data.code}`);
      }
    }
  }

  buffer += decoder.decode();
  const tail = parseStreamLine(buffer);
  if (tail?.code === 0 && tail.data) chunks.push(Buffer.from(tail.data, "base64"));
  if (tail?.code === 0 && tail.sentence) sentences.push(tail.sentence);
  if (tail?.code === 20000000) usage = tail.usage ?? usage;
  if (Number(tail?.code) > 0) throw new Error(tail.message || tail.msg || `TTS返回错误：${tail.code}`);
  if (!chunks.length) throw new Error("TTS未返回音频数据");

  const audio = Buffer.concat(chunks);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, audio);
  return {
    path: outputPath,
    bytes: audio.length,
    format,
    sampleRate,
    speechRate: rateValue(speechRate),
    loudnessRate: rateValue(loudnessRate),
    logid,
    usage,
    sentences,
  };
}
