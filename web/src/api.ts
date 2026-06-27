// api.ts — 后端抽象层（与 vanilla 版同契约）。★ 唯一随打包方式切换的文件。
// web 阶段: fetch 本地 Node 后端；Tauri 阶段: invoke + event。页面组件对此无感。

export interface MixParams {
  inputs?: string;
  canvas: string;
  fillMode?: "blur" | "black";
  out: number;
  fps: number;
  shuffle?: boolean;
  allowMaterialReuse?: boolean;
  materialCount?: number;
  clipStartSec?: number;
  clipEndSec?: number;
  videoVolume?: number;
  bgmEnabled?: boolean;
  bgmPath?: string;
  bgmVolume?: number;
  subtitleMode?: SubtitleMode;
  subtitleStyle?: SubtitleStyleParams | null;
  subtitle?: SubtitleOverlayParams | null;
  textOverlays?: TextOverlayParams[];
  videoProcessing?: VideoProcessingParams;
  copyMode?: boolean;
  copyItems?: CopyMixItem[];
  copyVoice?: CopyVoiceParams | null;
  copyVariants?: number;
  copySubtitleEnabled?: boolean;
  copySubtitleStyle?: SubtitleStyleParams | null;
  audioMode?: boolean;
  audioItems?: AudioMixItem[];
  audioVariants?: number;
  audioSubtitleEnabled?: boolean;
  audioSubtitleStyle?: SubtitleStyleParams | null;
  voiceVolume?: number;
  fixedFirstEnabled?: boolean;
  fixedFirstPath?: string;
  fixedFirstStartSec?: number;
  fixedFirstEndSec?: number;
  materialPaths?: string[];
  outputDir?: string;
}

export type SubtitleMode = "auto" | "off";

export type MotionMode = "zoomIn" | "zoomOut" | "drift";
export type WatermarkRemovalMode = "blur" | "pixelate" | "solid";
export type WatermarkMediaType = "image" | "video";

export interface PercentRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VideoProcessingParams {
  watermarkRemoval?: {
    enabled: boolean;
    mode: WatermarkRemovalMode;
    regions: PercentRect[];
  };
  watermarkOverlay?: {
    enabled: boolean;
    path: string;
    mediaType: WatermarkMediaType;
    opacity: number;
    rect: PercentRect;
  };
  color?: {
    enabled: boolean;
    hue: number;
    saturation: number;
    brightness: number;
    contrast: number;
    temperature: number;
    sharpen: number;
  };
  motion?: {
    enabled: boolean;
    mode: MotionMode;
    intensity: number;
    speed: number;
  };
}

export interface MaterialClip {
  name: string;
  path: string;
  url?: string;
}

export interface MaterialFolderInfo {
  valid: boolean;
  path: string;
  name: string;
  count: number;
  clips: MaterialClip[];
  msg?: string;
}

export interface TtsParams {
  text: string;
  speaker: string;
  resourceId?: string;
  format?: "mp3";
  sampleRate?: number;
}

export interface TtsResult {
  path: string;
  url: string;
  bytes: number;
  format: string;
  sampleRate: number;
  logid?: string;
  usage?: unknown;
  sentences?: unknown[];
}

export interface CopyMixItem {
  id: string;
  text: string;
}

export interface CopyVoiceParams {
  speaker: string;
  resourceId?: string;
  name?: string;
}

export interface AudioMixItem {
  id: string;
  path: string;
  text?: string;
  name?: string;
}

export interface SubtitleOverlayParams {
  text: string;
  frames?: SubtitleFrame[];
  x: number;
  y: number;
  fontSize: number;
  fontFile?: string;
  fontFamily?: string;
  opacity: number;
  outlineWidth: number;
  color?: string;
  outlineColor?: string;
}

export interface SubtitleStyleParams {
  x: number;
  y: number;
  fontSize: number;
  fontFile?: string;
  fontFamily?: string;
  opacity: number;
  outlineWidth: number;
  color?: string;
  outlineColor?: string;
}

export interface TextOverlayParams extends SubtitleStyleParams {
  text: string;
}

export interface SubtitleFrame {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface DedupParams {
  hflip: boolean;
  vflip: boolean;
  cropScale: number;
  brightness: number;
  contrast: number;
  saturation: number;
  noise: number;
  vignette: number;
  tempo: number;
}

export type MixEvent =
  | { type: "start"; clips: string[]; w: number; h: number; out: number }
  | { type: "segment"; output: number; total: number; seg: number; params: DedupParams; filter?: string }
  | { type: "output_done"; output: number; total: number; path: string }
  | { type: "log"; msg: string }
  | { type: "error"; msg: string }
  | { type: "done"; outputs: string[]; exportDir?: string; manifest?: string };

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function readJson<T>(resp: Response, emptyMsg: string): Promise<T> {
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(text.trim() || `请求失败：HTTP ${resp.status}`);
  }
  if (!text.trim()) {
    throw new Error(emptyMsg);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`后端返回格式异常：${text.slice(0, 80)}`);
  }
}

export async function inspectMaterials(inputs: string): Promise<MaterialFolderInfo> {
  if (inputs === "__TEST__") {
    return {
      valid: true,
      path: inputs,
      name: "测试素材",
      count: 3,
      clips: [
        { name: "clipA.mp4", path: "" },
        { name: "clipB.mp4", path: "" },
        { name: "clipC.mp4", path: "" },
      ],
    };
  }
  let resp: Response;
  try {
    resp = await fetch("/api/materials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  const data = await readJson<MaterialFolderInfo>(resp, "本地后端未返回数据，请确认 `node server.mjs` 正在运行");
  if (!data.valid) throw new Error(data.msg ?? "无法读取素材目录");
  return data;
}

export async function mix(params: MixParams, onEvent: (e: MixEvent) => void): Promise<void> {
  if (isTauri && window.__TAURI__) {
    // —— 打包阶段：调用 Rust commands::video_mixing_process ——
    const { invoke } = window.__TAURI__.core;
    const { listen } = window.__TAURI__.event;
    const un = await listen("video_mixing_progress", (e) => onEvent(e.payload as MixEvent));
    try {
      const res = await invoke("video_mixing_process", { req: toRustReq(params) });
      onEvent({ type: "done", outputs: res.outputs });
    } finally {
      un();
    }
    return;
  }
  // —— web 阶段：流式读取本地后端的 NDJSON 进度 ——
  let resp: Response;
  try {
    resp = await fetch("/api/mix", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text.trim() || "混剪接口无响应，请确认 `node server.mjs` 正在运行");
  }
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as MixEvent);
    }
  }
}

export async function rewriteCopy(text: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch("/api/rewrite-copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  const data = await readJson<{ text: string }>(resp, "AI改写接口未返回数据");
  return data.text;
}

export async function synthesizeSpeech(params: TtsParams): Promise<TtsResult> {
  let resp: Response;
  try {
    resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<TtsResult>(resp, "语音合成接口未返回数据");
}

function toRustReq(p: MixParams) {
  const [w, h] = p.canvas.split("x").map(Number);
  return {
    material_paths: p.materialPaths ?? [],
    output_dir: p.outputDir ?? "",
    canvas_w: w,
    canvas_h: h,
    output_count: p.out,
    fps: p.fps,
    allow_material_reuse: p.allowMaterialReuse ?? true,
  };
}
