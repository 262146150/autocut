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
  copyVoiceEnabled?: boolean;
  copyVoiceSpeechRate?: number;
  copyVoiceLoudnessRate?: number;
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
  fixedLastEnabled?: boolean;
  fixedLastPath?: string;
  fixedLastStartSec?: number;
  fixedLastEndSec?: number;
  smartMix?: boolean;
  smartMaterialMode?: "raw" | "segments";
  smartRerank?: boolean;
  smartRerankTopK?: number;
  groupOutputs?: boolean;
  materialPaths?: string[];
  outputDir?: string;
  exportQuality?: "standard" | "high" | "best";
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
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "square" | "unknown";
}

export interface ImageMaterialItem {
  name: string;
  path: string;
  url: string;
  width?: number;
  height?: number;
  orientation?: "portrait" | "landscape" | "square" | "unknown";
}

export interface ImageMaterialInfo {
  valid: boolean;
  path: string;
  name: string;
  count: number;
  images: ImageMaterialItem[];
  msg?: string;
}

export interface MaterialFolderInfo {
  valid: boolean;
  path: string;
  name: string;
  count: number;
  clips: MaterialClip[];
  orientation?: {
    portrait: number;
    landscape: number;
    square: number;
    unknown: number;
    resolved: "9:16" | "16:9";
  };
  msg?: string;
}

export interface TtsParams {
  text: string;
  speaker: string;
  resourceId?: string;
  format?: "mp3";
  sampleRate?: number;
  speechRate?: number;
  loudnessRate?: number;
}

export interface TtsResult {
  path: string;
  url: string;
  bytes: number;
  format: string;
  sampleRate: number;
  speechRate?: number;
  loudnessRate?: number;
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

export interface SmartMatchItem {
  name: string;
  score: number;
  reason: string;
  lexicalScore?: number;
  vectorScore?: number;
  rerankScore?: number;
  rerankReason?: string;
  durationSec?: number;
}

export interface SegmentClip {
  id: string;
  name: string;
  path: string;
  url: string;
  sourcePath: string;
  sourceName: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface ExportVideoItem {
  name: string;
  path: string;
  url: string;
  size: number;
  modifiedAt: string;
}

export interface ExportEntryItem {
  name: string;
  path: string;
  kind: "dir" | "video";
  videoCount: number;
  url?: string;
  size?: number;
  modifiedAt?: string;
  children?: ExportEntryItem[];
}

export interface ExportBatchItem {
  name: string;
  dir: string;
  createdAt: string;
  modifiedAt: string;
  mode: string;
  modeLabel: string;
  manifest: string;
  videoCount: number;
  videos: ExportVideoItem[];
  entries?: ExportEntryItem[];
}

export interface ExportDateGroup {
  date: string;
  dir: string;
  root: string;
  rootName: string;
  count: number;
  batches: ExportBatchItem[];
}

export interface ExportLibrary {
  root: string;
  roots: string[];
  dates: ExportDateGroup[];
}

export interface GenerationTaskRecord {
  id: string;
  mode: string;
  modeLabel: string;
  taskName: string;
  status: "running" | "success" | "failed" | string;
  inputPath: string;
  outputDir: string;
  manifestPath: string;
  outputCount: number;
  error: string;
  startedAt: string;
  endedAt: string;
  durationMs: number | null;
}

export interface GenerationTaskData {
  tasks: GenerationTaskRecord[];
  totals: {
    count: number;
    running: number;
    failed: number;
  };
}

export interface AuthStatus {
  registered: boolean;
  active: boolean;
  expired: boolean;
  reason: "unauthenticated" | "inactive" | "expired" | "active" | "cached" | "device_mismatch" | string;
  user: null | {
    id: number | null;
    account: string;
    name: string;
  };
  license: null | {
    type?: "trial" | "official" | string;
    active?: boolean;
    expired?: boolean;
    deviceMismatch?: boolean;
    deviceId?: string;
    boundDeviceId?: string;
    expiresAt: string;
    daysRemaining: number;
  };
  serviceUrl?: string;
  lastCheckedAt?: string;
  warning?: string;
}

export interface AuthActionResult {
  status: AuthStatus;
}

export type MaterialLibraryCategory = "raw" | "segments" | "reuse" | "audio" | "image";
export type MaterialLibraryKind = "video" | "audio" | "image";
export type MaterialLibraryOrientation = "portrait" | "landscape" | "square" | "unknown" | "audio";

export interface MaterialLibraryItem {
  name: string;
  path: string;
  url: string;
  rootPath: string;
  category: MaterialLibraryCategory;
  categoryLabel: string;
  kind: MaterialLibraryKind;
  size?: number;
  modifiedAt?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  orientation?: MaterialLibraryOrientation;
  hasAudio?: boolean;
  valid: boolean;
}

export interface MaterialLibraryRoot {
  path: string;
  name: string;
  category: MaterialLibraryCategory;
  categoryLabel: string;
  addedAt: string;
  exists: boolean;
  count: number;
  videoCount: number;
  audioCount: number;
  imageCount?: number;
  durationSec: number;
  items: MaterialLibraryItem[];
}

export interface MaterialLibraryData {
  roots: MaterialLibraryRoot[];
  items: MaterialLibraryItem[];
  totals: {
    roots: number;
    validRoots: number;
    items: number;
    videos: number;
    audios: number;
    images?: number;
    durationSec: number;
  };
}

export interface ImageVideoCopyItem {
  id: string;
  text: string;
}

export interface ImageVideoAudioItem {
  id: string;
  path: string;
  text?: string;
  name?: string;
}

export interface ImageVideoParams {
  inputs: string;
  canvas: string;
  fillMode?: "blur" | "black";
  fps?: number;
  mode: "copy" | "audio";
  copyItems?: ImageVideoCopyItem[];
  audioItems?: ImageVideoAudioItem[];
  variants?: number;
  imageCount?: number;
  sceneDurationSec?: number;
  allowImageReuse?: boolean;
  motionMode?: "zoomIn" | "zoomOut" | "drift";
  transition?: "fade" | "none";
  subtitleEnabled?: boolean;
  subtitleStyle?: SubtitleStyleParams | null;
  voiceEnabled?: boolean;
  copyVoiceSpeechRate?: number;
  copyVoiceLoudnessRate?: number;
  voice?: CopyVoiceParams | null;
  voiceVolume?: number;
  bgmEnabled?: boolean;
  bgmPath?: string;
  bgmVolume?: number;
  exportQuality?: "standard" | "high" | "best";
  smartRerank?: boolean;
  smartRerankTopK?: number;
  outputDir?: string;
}

export type ImageVideoEvent =
  | { type: "start"; total: number; images: number }
  | { type: "log"; msg: string }
  | { type: "image_index"; available: boolean; reused: boolean; indexedImages: number; reason?: string }
  | { type: "image_match"; index: number; matches: SmartMatchItem[] }
  | { type: "image_done"; index: number; total: number; output?: number; path: string }
  | { type: "output_done"; output: number; total: number; path: string }
  | { type: "error"; msg: string }
  | { type: "done"; outputs: string[]; exportDir?: string; manifest?: string };

export interface VolcengineSettings {
  userId: number;
  ark: {
    configured: boolean;
    masked: string;
    source: "db" | "none";
    model: string;
  };
  tts: {
    configured: boolean;
    masked: string;
    source: "db" | "none";
    resourceId: string;
  };
}

export interface SaveVolcengineSettingsParams {
  arkApiKey?: string;
  arkModel?: string;
  ttsApiKey?: string;
  ttsResourceId?: string;
  clearArkApiKey?: boolean;
  clearTtsApiKey?: boolean;
}

export interface TestVolcengineSettingsParams {
  target: "ark" | "tts";
}

export interface TestVolcengineSettingsResult {
  target?: "ark" | "tts";
  ok: boolean;
  message: string;
  text?: string;
  bytes?: number;
  usage?: unknown;
}

export type SegmentEvent =
  | { type: "start"; clips: string[]; total: number }
  | { type: "segment_log"; msg: string }
  | { type: "segment_file"; index: number; total: number; name: string; durationSec: number }
  | { type: "segment_done"; index: number; name: string; sourceName: string; startSec: number; endSec: number; durationSec: number; path: string }
  | { type: "error"; msg: string }
  | {
    type: "done";
    engine: string;
    targetEngine?: string;
    reused: boolean;
    manifest: string;
    exportDir?: string;
    materialLibraryPath?: string;
    segments: SegmentClip[];
  };

export interface HighlightClipItem {
  id: string;
  name: string;
  title: string;
  reason: string;
  score: number;
  sourcePath: string;
  sourceName: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  timeRange?: string;
  path: string;
  url: string;
}

export interface HighlightCollectionItem {
  id: string;
  name: string;
  title: string;
  summary: string;
  clipIds: string[];
  path: string;
  items?: Array<{
    id: string;
    title: string;
    path: string;
    score?: number;
    timeRange?: string;
  }>;
}

export type HighlightEvent =
  | { type: "start"; total: number; settings: unknown }
  | { type: "file"; index: number; total: number; name: string; path: string }
  | { type: "log"; msg: string }
  | { type: "analysis"; msg: string; video?: string }
  | { type: "timeline"; msg: string; video?: string; outlines?: number }
  | { type: "score"; msg: string; video?: string }
  | { type: "clip"; name: string; sourceName: string; startSec: number; endSec: number; score: number }
  | { type: "clip_done"; index: number; name: string; path: string; title: string; sourceName: string; startSec: number; endSec: number; durationSec: number; score: number }
  | { type: "collection"; title: string; count: number }
  | { type: "collection_done"; index: number; title: string; name: string; path: string; count: number }
  | { type: "error"; msg: string }
  | {
    type: "done";
    exportDir: string;
    manifest: string;
    materialLibraryPath?: string;
    clips: HighlightClipItem[];
    collections: HighlightCollectionItem[];
  };

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
  | {
    type: "smart_index";
    engine: string;
    available: boolean;
    reused: boolean;
    indexedClips: number;
    reason?: string;
  }
  | {
    type: "smart_match";
    itemType: "copy" | "audio";
    index: number;
    engine: string;
    matches: SmartMatchItem[];
  }
  | {
    type: "segment_library";
    engine: string;
    targetEngine?: string;
    reused: boolean;
    sourceClips: number;
    segments: number;
    manifest: string;
  }
  | { type: "error"; msg: string }
  | { type: "done"; outputs: string[]; exportDir?: string; manifest?: string };

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function readJson<T>(resp: Response, emptyMsg: string): Promise<T> {
  const text = await resp.text();
  if (!resp.ok) {
    try {
      const data = JSON.parse(text) as { message?: string; msg?: string; error?: string };
      throw new Error(data.message || data.msg || data.error || `请求失败：HTTP ${resp.status}`);
    } catch (err) {
      if (err instanceof Error && !err.message.startsWith("Unexpected")) throw err;
      throw new Error(text.trim() || `请求失败：HTTP ${resp.status}`);
    }
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
      orientation: {
        portrait: 1,
        landscape: 2,
        square: 0,
        unknown: 0,
        resolved: "16:9",
      },
      clips: [
        { name: "clipA.mp4", path: "", width: 1280, height: 720, orientation: "landscape" },
        { name: "clipB.mp4", path: "", width: 720, height: 1280, orientation: "portrait" },
        { name: "clipC.mp4", path: "", width: 1920, height: 1080, orientation: "landscape" },
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

export async function inspectImageMaterials(inputs: string): Promise<ImageMaterialInfo> {
  let resp: Response;
  try {
    resp = await fetch("/api/image-materials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  const data = await readJson<ImageMaterialInfo>(resp, "图片素材接口未返回数据");
  if (!data.valid) throw new Error(data.msg ?? "无法读取图片素材");
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

export async function segmentMaterials(
  params: {
    inputs: string;
    threshold?: number;
    minDurationSec?: number;
    targetSegmentSec?: number;
    maxSegmentSec?: number;
    detectFps?: number;
    cutPaddingSec?: number;
    speechProtection?: boolean;
    segmentMode?: "material" | "reuse";
    speechPadSec?: number;
    speechMaxShiftSec?: number;
    force?: boolean;
    outputDir?: string;
  },
  onEvent: (e: SegmentEvent) => void,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/api/segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text.trim() || "智能分割接口无响应，请确认 `node server.mjs` 正在运行");
  }
  const reader = resp.body.getReader();
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
      if (line) onEvent(JSON.parse(line) as SegmentEvent);
    }
  }
}

export async function generateHighlightClips(
  params: {
    inputs: string;
    srtPath?: string;
    minDurationSec?: number;
    maxDurationSec?: number;
    minScore?: number;
    maxClips?: number;
    maxCollections?: number;
    enableAsr?: boolean;
    addToLibrary?: boolean;
    exportQuality?: "standard" | "high" | "best";
    outputDir?: string;
  },
  onEvent: (e: HighlightEvent) => void,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/api/highlight-clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text.trim() || "高光切片接口无响应，请确认 `node server.mjs` 正在运行");
  }
  const reader = resp.body.getReader();
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
      if (line) onEvent(JSON.parse(line) as HighlightEvent);
    }
  }
}

export async function generateImageVideo(
  params: ImageVideoParams,
  onEvent: (e: ImageVideoEvent) => void,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch("/api/image-video", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text.trim() || "图片转视频接口无响应，请确认 `node server.mjs` 正在运行");
  }
  const reader = resp.body.getReader();
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
      if (line) onEvent(JSON.parse(line) as ImageVideoEvent);
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

export async function listExports(): Promise<ExportLibrary> {
  let resp: Response;
  try {
    resp = await fetch("/api/exports");
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<ExportLibrary>(resp, "导出目录接口未返回数据");
}

export async function listGenerationTasks(limit = 20): Promise<GenerationTaskData> {
  let resp: Response;
  try {
    resp = await fetch(`/api/tasks?limit=${encodeURIComponent(String(limit))}`);
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<GenerationTaskData>(resp, "任务记录接口未返回数据");
}

export async function getAuthStatus(): Promise<AuthStatus> {
  let resp: Response;
  try {
    resp = await fetch("/api/auth/status");
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<AuthStatus>(resp, "授权状态接口未返回数据");
}

export async function registerUser(params: { account: string; password: string; name?: string }): Promise<AuthActionResult> {
  let resp: Response;
  try {
    resp = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<AuthActionResult>(resp, "注册接口未返回数据");
}

export async function loginUser(params: { account: string; password: string }): Promise<AuthActionResult> {
  let resp: Response;
  try {
    resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<AuthActionResult>(resp, "登录接口未返回数据");
}

export async function activateLicense(code: string): Promise<AuthStatus> {
  let resp: Response;
  try {
    resp = await fetch("/api/auth/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<AuthStatus>(resp, "激活接口未返回数据");
}

export async function logoutUser(): Promise<AuthStatus> {
  let resp: Response;
  try {
    resp = await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<AuthStatus>(resp, "退出登录接口未返回数据");
}

export async function listMaterialLibrary(): Promise<MaterialLibraryData> {
  let resp: Response;
  try {
    resp = await fetch("/api/material-library");
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<MaterialLibraryData>(resp, "素材仓库接口未返回数据");
}

export async function saveMaterialSource(
  path: string,
  category: MaterialLibraryCategory = "raw",
  remove = false,
): Promise<MaterialLibraryData> {
  let resp: Response;
  try {
    resp = await fetch("/api/material-library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, category, remove }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<MaterialLibraryData>(resp, "素材仓库保存接口未返回数据");
}

export async function refreshMaterialLibrary(path = ""): Promise<MaterialLibraryData> {
  let resp: Response;
  try {
    resp = await fetch("/api/material-library", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, refresh: true }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<MaterialLibraryData>(resp, "素材仓库刷新接口未返回数据");
}

export async function getVolcengineSettings(): Promise<VolcengineSettings> {
  let resp: Response;
  try {
    resp = await fetch("/api/settings/volcengine");
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<VolcengineSettings>(resp, "火山引擎设置接口未返回数据");
}

export async function saveVolcengineSettings(params: SaveVolcengineSettingsParams): Promise<VolcengineSettings> {
  let resp: Response;
  try {
    resp = await fetch("/api/settings/volcengine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<VolcengineSettings>(resp, "火山引擎设置保存接口未返回数据");
}

export async function testVolcengineSettings(params: TestVolcengineSettingsParams): Promise<TestVolcengineSettingsResult> {
  let resp: Response;
  try {
    resp = await fetch("/api/settings/volcengine/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  const text = await resp.text();
  if (!text.trim()) throw new Error("火山引擎测试接口未返回数据");
  let data: TestVolcengineSettingsResult;
  try {
    data = JSON.parse(text) as TestVolcengineSettingsResult;
  } catch {
    throw new Error(text.slice(0, 120));
  }
  if (!resp.ok || !data.ok) throw new Error(data.message || `测试失败：HTTP ${resp.status}`);
  return data;
}

export async function saveExportRoot(path: string, remove = false): Promise<{ roots: string[] }> {
  let resp: Response;
  try {
    resp = await fetch("/api/export-roots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, remove }),
    });
  } catch {
    throw new Error("无法连接本地后端，请先在 web 目录运行 `node server.mjs`");
  }
  return readJson<{ roots: string[] }>(resp, "导出目录保存接口未返回数据");
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
