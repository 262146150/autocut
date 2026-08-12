// SmartMix.tsx — AI 智能混剪三栏页（按截图复刻 + 接后端混剪管线）
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ModuleDef } from "../data/modules";
import { inspectMaterials, mix, rewriteCopy, synthesizeSpeech, type MaterialClip, type MaterialFolderInfo, type MaterialLibraryRoot, type MixParams, type PercentRect, type SmartMatchItem, type SubtitleMode, type SubtitleStyleParams, type TextOverlayParams } from "../api";
import { Group, Field } from "../components/controls";
import { DEFAULT_VIDEO_PROCESSING, VideoProcessingSettings } from "../components/VideoProcessingSettings";
import { ExportTaskDrawer, type ExportTaskItem } from "../components/ExportTaskDrawer";
import { MaterialSourcePicker } from "../components/MaterialSourcePicker";
import {
  BgmSettings,
  SUBTITLE_FONTS,
  SubtitlePreviewOverlay,
  TextSubtitleStyleSettings,
  VOICE_SPEAKERS,
  VoicePickerModal,
  VoiceSynthesisSettings,
  type VoiceSpeaker,
} from "../components/settings";

const BOX_CORNERS = ["nw", "ne", "sw", "se"] as const;
type TextLayerKind = "subtitle" | "custom";
type MixMode = "custom" | "copy" | "audio";
type SmartMaterialMode = "raw" | "segments";
type AspectRatioMode = "auto" | "9:16" | "16:9";
type ExportResolution = "1080p" | "720p";
type ExportQuality = "standard" | "high" | "best";
type DraggingTextLayer = { kind: "subtitle" } | { kind: "custom"; id: string };
type BoxTarget = { kind: "remove"; id: string } | { kind: "watermark" };
type BoxDrag = {
  target: BoxTarget;
  action: "move" | "resize";
  corner?: "nw" | "ne" | "sw" | "se";
  offsetX: number;
  offsetY: number;
};
type CustomTextLayer = {
  id: string;
  text: string;
  fontIndex: number;
  fontSize: number;
  opacity: number;
  outlineWidth: number;
  color: string;
  outlineColor: string;
  pos: { x: number; y: number };
};
type CopyItem = {
  id: string;
  text: string;
  audioUrl?: string;
  audioPath?: string;
  audioBytes?: number;
  audioSpeaker?: string;
  audioSpeakerName?: string;
};
type AudioItem = {
  id: string;
  path: string;
  text: string;
  name: string;
};
type SmartIndexState = {
  engine: string;
  available: boolean;
  reused: boolean;
  indexedClips: number;
  reason?: string;
};
type SmartMatchState = {
  key: string;
  label: string;
  engine: string;
  matches: SmartMatchItem[];
};
type SegmentLibraryState = {
  engine: string;
  targetEngine?: string;
  reused: boolean;
  sourceClips: number;
  segments: number;
  manifest: string;
};
function ControlledSlider({
  value,
  onChange,
  max = 100,
  min = 0,
  unit = "%",
  display,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  min?: number;
  unit?: string;
  display?: string;
  disabled?: boolean;
}) {
  return (
    <>
      <input type="range" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      <span className="val">{display ?? `${value}${unit}`}</span>
    </>
  );
}

function localMediaUrl(filePath: string) {
  return `/api/media?path=${encodeURIComponent(filePath)}`;
}

function basename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function outputNameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const raw = parsed.searchParams.get("path") || parsed.pathname;
    return basename(decodeURIComponent(raw)) || fallback;
  } catch {
    return fallback;
  }
}

function publicTaskMessage(message: string) {
  if (/失败|错误|不存在|不足|请选择|请先|无法|读取失败/.test(message)) return message;
  if (/合成文案|语音合成/.test(message)) return "正在生成配音";
  if (/智能分割|片段库|分割/.test(message)) return "正在整理视频片段";
  if (/智能索引|ONNX|clip|模型|engine|引擎|匹配/.test(message)) return "正在分析素材并匹配画面";
  if (/输出目录/.test(message)) return "输出目录已准备";
  if (/开始混剪|生成/.test(message)) return "正在生成视频";
  return message.replace(/transnetv2-onnx|chinese-clip-vit-base-patch16-onnx|ONNX|onnx|引擎|engine/gi, "").trim();
}

function taskModeLabel(mode: MixMode) {
  if (mode === "copy") return "文案模式";
  if (mode === "audio") return "音频模式";
  return "自定义模式";
}

function resolveAspectRatio(mode: AspectRatioMode, folderInfo: MaterialFolderInfo | null): "9:16" | "16:9" {
  if (mode !== "auto") return mode;
  return folderInfo?.orientation?.resolved ?? "9:16";
}

function aspectRatioDisplay(mode: AspectRatioMode, resolved: "9:16" | "16:9") {
  return mode === "auto" ? `跟随素材方向（${resolved}）` : resolved;
}

function exportCanvas(resolvedAspectRatio: "9:16" | "16:9", resolution: ExportResolution) {
  if (resolvedAspectRatio === "16:9") return resolution === "720p" ? "1280x720" : "1920x1080";
  return resolution === "720p" ? "720x1280" : "1080x1920";
}

function exportResolutionLabel(resolution: ExportResolution, canvas: string) {
  return `${resolution === "720p" ? "720P 轻量" : "1080P 高清"}（${canvas}）`;
}

function exportQualityLabel(quality: ExportQuality) {
  if (quality === "best") return "高质量";
  if (quality === "standard") return "标准";
  return "高清";
}

function previewVolume(value: number) {
  return Math.max(0, Math.min(1, value / 100));
}

function BaseSettings({
  videoVolume,
  setVideoVolume,
  bgmEnabled,
  setBgmEnabled,
  bgmPath,
  setBgmPath,
  bgmVolume,
  setBgmVolume,
  bgmCanPreview,
  bgmPreviewPlaying,
  onToggleBgmPreview,
  mixMode,
  selectedVoice,
  copyVoiceEnabled,
  setCopyVoiceEnabled,
  copyVoiceSpeechRate,
  setCopyVoiceSpeechRate,
  copyVoiceLoudnessRate,
  setCopyVoiceLoudnessRate,
  onOpenVoicePicker,
  activeTextLabel,
  subtitleText,
  setSubtitleText,
  subtitleFontIndex,
  setSubtitleFontIndex,
  subtitleFontSize,
  setSubtitleFontSize,
  subtitleOpacity,
  setSubtitleOpacity,
  subtitleOutlineWidth,
  setSubtitleOutlineWidth,
  subtitleColor,
  setSubtitleColor,
  subtitleOutlineColor,
  setSubtitleOutlineColor,
}: {
  videoVolume: number;
  setVideoVolume: (value: number) => void;
  bgmEnabled: boolean;
  setBgmEnabled: (value: boolean) => void;
  bgmPath: string;
  setBgmPath: (value: string) => void;
  bgmVolume: number;
  setBgmVolume: (value: number) => void;
  bgmCanPreview: boolean;
  bgmPreviewPlaying: boolean;
  onToggleBgmPreview: () => void;
  mixMode: MixMode;
  selectedVoice: VoiceSpeaker | null;
  copyVoiceEnabled: boolean;
  setCopyVoiceEnabled: (value: boolean) => void;
  copyVoiceSpeechRate: number;
  setCopyVoiceSpeechRate: (value: number) => void;
  copyVoiceLoudnessRate: number;
  setCopyVoiceLoudnessRate: (value: number) => void;
  onOpenVoicePicker: () => void;
  activeTextLabel: string;
  subtitleText: string;
  setSubtitleText: (value: string) => void;
  subtitleFontIndex: number;
  setSubtitleFontIndex: (value: number) => void;
  subtitleFontSize: number;
  setSubtitleFontSize: (value: number) => void;
  subtitleOpacity: number;
  setSubtitleOpacity: (value: number) => void;
  subtitleOutlineWidth: number;
  setSubtitleOutlineWidth: (value: number) => void;
  subtitleColor: string;
  setSubtitleColor: (value: string) => void;
  subtitleOutlineColor: string;
  setSubtitleOutlineColor: (value: string) => void;
}) {
  const chooseBgm = () => {
    const next = prompt("输入背景音乐文件路径", bgmPath);
    if (next === null) return;
    const value = next.trim();
    setBgmPath(value);
    if (value) setBgmEnabled(true);
  };

  return (
    <>
      <Group title="原视频音量">
        <Field label="音量"><ControlledSlider value={videoVolume} max={100} onChange={setVideoVolume} /></Field>
      </Group>
      <BgmSettings
        enabled={bgmEnabled}
        path={bgmPath}
        previewPlaying={bgmPreviewPlaying}
        canPreview={bgmCanPreview}
        volume={bgmVolume}
        volumeControl="slider"
        onChoose={chooseBgm}
        onClear={() => {
          setBgmPath("");
          setBgmEnabled(false);
        }}
        onEnabledChange={setBgmEnabled}
        onPathChange={setBgmPath}
        onTogglePreview={onToggleBgmPreview}
        onVolumeChange={setBgmVolume}
      />
      {mixMode === "audio" ? (
        <Group title="主音频">
          <Field>
            <span className="muted">音频模式使用导入音频作为主音轨</span>
          </Field>
        </Group>
      ) : mixMode === "copy" ? (
        <VoiceSynthesisSettings
          enabled={copyVoiceEnabled}
          enabledHint="开始生成时会按每条文案自动合成语音"
          disabledHint="关闭后不合成配音，仅按文案估算时长生成视频"
          loudnessRate={copyVoiceLoudnessRate}
          selectedVoice={selectedVoice}
          showRateControls
          speechRate={copyVoiceSpeechRate}
          voiceCardVariant="compact"
          onEnabledChange={setCopyVoiceEnabled}
          onLoudnessRateChange={setCopyVoiceLoudnessRate}
          onOpenVoicePicker={onOpenVoicePicker}
          onSpeechRateChange={setCopyVoiceSpeechRate}
        />
      ) : null}
      <TextSubtitleStyleSettings
        activeTextLabel={activeTextLabel}
        color={subtitleColor}
        fontIndex={subtitleFontIndex}
        fontSize={subtitleFontSize}
        opacity={subtitleOpacity}
        outlineColor={subtitleOutlineColor}
        outlineWidth={subtitleOutlineWidth}
        text={subtitleText}
        onColorChange={setSubtitleColor}
        onFontIndexChange={setSubtitleFontIndex}
        onFontSizeChange={setSubtitleFontSize}
        onOpacityChange={setSubtitleOpacity}
        onOutlineColorChange={setSubtitleOutlineColor}
        onOutlineWidthChange={setSubtitleOutlineWidth}
        onTextChange={setSubtitleText}
      />
    </>
  );
}

function TogglePill({ active, children, onClick }: { active?: boolean; children: string; onClick?: () => void }) {
  return (
    <button className={active ? "active" : ""} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function MiniNumber({
  value,
  onChange,
  min = 0,
  max = 30,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <span className="mini-num">
      <input
        min={min}
        max={max}
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      />
    </span>
  );
}

function FolderMixSettings({
  mixMode,
  setMixMode,
  outCount,
  setOutCount,
  materialCount,
  setMaterialCount,
  clipStartSec,
  setClipStartSec,
  clipEndSec,
  setClipEndSec,
  shuffle,
  setShuffle,
  allowReuse,
  setAllowReuse,
  subtitleMode,
  setSubtitleMode,
  copySubtitleEnabled,
  setCopySubtitleEnabled,
  audioSubtitleEnabled,
  setAudioSubtitleEnabled,
  groupOutputs,
  setGroupOutputs,
  fixedFirstEnabled,
  setFixedFirstEnabled,
  fixedFirstPath,
  setFixedFirstPath,
  fixedFirstStartSec,
  setFixedFirstStartSec,
  fixedFirstEndSec,
  setFixedFirstEndSec,
  fixedLastEnabled,
  setFixedLastEnabled,
  fixedLastPath,
  setFixedLastPath,
  fixedLastStartSec,
  setFixedLastStartSec,
  fixedLastEndSec,
  setFixedLastEndSec,
  smartMaterialMode,
  setSmartMaterialMode,
  smartDeepMatch,
  setSmartDeepMatch,
  smartOnly = false,
}: {
  mixMode: MixMode;
  setMixMode: (value: MixMode) => void;
  outCount: number;
  setOutCount: (value: number) => void;
  materialCount: number;
  setMaterialCount: (value: number) => void;
  clipStartSec: number;
  setClipStartSec: (value: number) => void;
  clipEndSec: number;
  setClipEndSec: (value: number) => void;
  shuffle: boolean;
  setShuffle: (value: boolean) => void;
  allowReuse: boolean;
  setAllowReuse: (value: boolean) => void;
  subtitleMode: SubtitleMode;
  setSubtitleMode: (value: SubtitleMode) => void;
  copySubtitleEnabled: boolean;
  setCopySubtitleEnabled: (value: boolean) => void;
  audioSubtitleEnabled: boolean;
  setAudioSubtitleEnabled: (value: boolean) => void;
  groupOutputs: boolean;
  setGroupOutputs: (value: boolean) => void;
  fixedFirstEnabled: boolean;
  setFixedFirstEnabled: (value: boolean) => void;
  fixedFirstPath: string;
  setFixedFirstPath: (value: string) => void;
  fixedFirstStartSec: number;
  setFixedFirstStartSec: (value: number) => void;
  fixedFirstEndSec: number;
  setFixedFirstEndSec: (value: number) => void;
  fixedLastEnabled: boolean;
  setFixedLastEnabled: (value: boolean) => void;
  fixedLastPath: string;
  setFixedLastPath: (value: string) => void;
  fixedLastStartSec: number;
  setFixedLastStartSec: (value: number) => void;
  fixedLastEndSec: number;
  setFixedLastEndSec: (value: number) => void;
  smartMaterialMode: SmartMaterialMode;
  setSmartMaterialMode: (value: SmartMaterialMode) => void;
  smartDeepMatch: boolean;
  setSmartDeepMatch: (value: boolean) => void;
  smartOnly?: boolean;
}) {
  const chooseFixedFirst = () => {
    const next = prompt("输入固定首素材视频路径", fixedFirstPath);
    if (next === null) return;
    const value = next.trim();
    setFixedFirstPath(value);
    if (value) setFixedFirstEnabled(true);
  };
  const chooseFixedLast = () => {
    const next = prompt("输入固定末素材视频路径", fixedLastPath);
    if (next === null) return;
    const value = next.trim();
    setFixedLastPath(value);
    if (value) setFixedLastEnabled(true);
  };

  return (
    <div className="folder-settings">
      <div className="folder-setting-row">
        <span>混剪模式</span>
        <div className="mini-seg">
          {!smartOnly ? <TogglePill active={mixMode === "custom"} onClick={() => setMixMode("custom")}>自定义</TogglePill> : null}
          <TogglePill active={mixMode === "copy"} onClick={() => setMixMode("copy")}>文案模式</TogglePill>
          <TogglePill active={mixMode === "audio"} onClick={() => setMixMode("audio")}>音频模式</TogglePill>
        </div>
      </div>
      {smartOnly ? (
        <div className="folder-setting-row">
          <span>素材类型</span>
          <div className="mini-seg compact">
            <TogglePill active={smartMaterialMode === "segments"} onClick={() => setSmartMaterialMode("segments")}>已分割片段</TogglePill>
            <TogglePill active={smartMaterialMode === "raw"} onClick={() => setSmartMaterialMode("raw")}>原始长视频</TogglePill>
          </div>
        </div>
      ) : null}
      {smartOnly ? (
        <div className="folder-setting-row">
          <span>匹配方式</span>
          <div className="mini-seg compact">
            <TogglePill active={!smartDeepMatch} onClick={() => setSmartDeepMatch(false)}>快速匹配</TogglePill>
            <TogglePill active={smartDeepMatch} onClick={() => setSmartDeepMatch(true)}>深度匹配</TogglePill>
          </div>
        </div>
      ) : null}
      <div className="folder-setting-row">
        <span>视频字幕</span>
        {mixMode === "copy" ? (
          <div className="mini-seg compact">
            <TogglePill active={copySubtitleEnabled} onClick={() => setCopySubtitleEnabled(true)}>文案字幕</TogglePill>
            <TogglePill active={!copySubtitleEnabled} onClick={() => setCopySubtitleEnabled(false)}>不启用</TogglePill>
          </div>
        ) : mixMode === "audio" ? (
          <div className="mini-seg compact">
            <TogglePill active={audioSubtitleEnabled} onClick={() => setAudioSubtitleEnabled(true)}>手动字幕</TogglePill>
            <TogglePill active={!audioSubtitleEnabled} onClick={() => setAudioSubtitleEnabled(false)}>不启用</TogglePill>
          </div>
        ) : (
          <div className="mini-seg compact">
            <TogglePill active={subtitleMode === "auto"} onClick={() => setSubtitleMode("auto")}>自动识别</TogglePill>
            <TogglePill active={subtitleMode === "off"} onClick={() => setSubtitleMode("off")}>不启用</TogglePill>
          </div>
        )}
      </div>
      <div className="folder-setting-row">
        <span>素材截取范围</span>
        <div className="range-inline">
          <MiniNumber value={clipStartSec} onChange={setClipStartSec} max={36000} />
          ~
          <MiniNumber value={clipEndSec} onChange={setClipEndSec} max={36000} />
          秒
        </div>
      </div>
      <div className="folder-setting-row">
        <span>使用素材数量</span>
        {mixMode === "copy" || mixMode === "audio" ? (
          <div className="range-inline muted">根据音频时长自动计算</div>
        ) : (
          <div className="range-inline">
            <MiniNumber value={materialCount} onChange={setMaterialCount} max={999} />
            <button className="mini-chip" type="button" onClick={() => setMaterialCount(0)}>全部</button>
          </div>
        )}
      </div>
      <div className="folder-setting-row">
        <span>{mixMode === "copy" ? "每个文案裂变" : mixMode === "audio" ? "每个音频裂变" : "混剪导出数量"}</span>
        <div className="range-inline"><MiniNumber value={outCount} onChange={setOutCount} min={1} />个</div>
      </div>
      <div className="folder-setting-row">
        <span>允许素材重复</span>
        <div className="mini-seg compact">
          <TogglePill active={allowReuse} onClick={() => setAllowReuse(true)}>允许</TogglePill>
          <TogglePill active={!allowReuse} onClick={() => setAllowReuse(false)}>不允许</TogglePill>
        </div>
      </div>
      <div className="folder-setting-row">
        <span>素材抽取方式</span>
        <div className="mini-seg compact">
          <TogglePill active={shuffle} onClick={() => setShuffle(true)}>随机抽取</TogglePill>
          <TogglePill active={!shuffle} onClick={() => setShuffle(false)}>顺序抽取</TogglePill>
        </div>
      </div>
      <div className="folder-setting-row">
        <span>视频输出方式</span>
        {mixMode === "copy" || mixMode === "audio" ? (
          <div className="mini-seg compact">
            <TogglePill active={groupOutputs} onClick={() => setGroupOutputs(true)}>
              {mixMode === "copy" ? "按文案分类" : "按音频分类"}
            </TogglePill>
            <TogglePill active={!groupOutputs} onClick={() => setGroupOutputs(false)}>不分类</TogglePill>
          </div>
        ) : (
          <div className="range-inline muted">按任务批次输出</div>
        )}
      </div>
      <div className="fixed-material">
        <div className="folder-setting-row">
          <span>固定首素材</span>
          <div className="mini-seg compact">
            <TogglePill active={fixedFirstEnabled} onClick={() => setFixedFirstEnabled(true)}>启用</TogglePill>
            <TogglePill active={!fixedFirstEnabled} onClick={() => setFixedFirstEnabled(false)}>关闭</TogglePill>
          </div>
        </div>
        <div className="fixed-picker">
          <span title={fixedFirstPath}>{fixedFirstPath ? basename(fixedFirstPath) : "未选择"}</span>
          <button className="icon-btn text-btn" type="button" onClick={chooseFixedFirst}>选择</button>
          <button className="icon-btn" type="button" onClick={() => { setFixedFirstPath(""); setFixedFirstEnabled(false); }}>×</button>
        </div>
        <div className={`folder-setting-row ${fixedFirstEnabled ? "" : "disabled"}`}>
          <span>首素材截取</span>
          <div className="range-inline">
            <MiniNumber value={fixedFirstStartSec} onChange={setFixedFirstStartSec} max={36000} />
            ~
            <MiniNumber value={fixedFirstEndSec} onChange={setFixedFirstEndSec} max={36000} />
            秒
          </div>
        </div>
      </div>
      <div className="fixed-material">
        <div className="folder-setting-row">
          <span>固定末素材</span>
          <div className="mini-seg compact">
            <TogglePill active={fixedLastEnabled} onClick={() => setFixedLastEnabled(true)}>启用</TogglePill>
            <TogglePill active={!fixedLastEnabled} onClick={() => setFixedLastEnabled(false)}>关闭</TogglePill>
          </div>
        </div>
        <div className="fixed-picker">
          <span title={fixedLastPath}>{fixedLastPath ? basename(fixedLastPath) : "未选择"}</span>
          <button className="icon-btn text-btn" type="button" onClick={chooseFixedLast}>选择</button>
          <button className="icon-btn" type="button" onClick={() => { setFixedLastPath(""); setFixedLastEnabled(false); }}>×</button>
        </div>
        <div className={`folder-setting-row ${fixedLastEnabled ? "" : "disabled"}`}>
          <span>末素材截取</span>
          <div className="range-inline">
            <MiniNumber value={fixedLastStartSec} onChange={setFixedLastStartSec} max={36000} />
            ~
            <MiniNumber value={fixedLastEndSec} onChange={setFixedLastEndSec} max={36000} />
            秒
          </div>
        </div>
      </div>
    </div>
  );
}

function SmartMatchStatusPanel({
  segmentLibrary,
  index,
  matches,
}: {
  segmentLibrary: SegmentLibraryState | null;
  index: SmartIndexState | null;
  matches: SmartMatchState[];
}) {
  const topMatches = matches.slice(-3).reverse();
  return (
    <div className="smart-status-panel">
      <div className="smart-status-h">
        <b>智能匹配</b>
        <span className={index?.available ? "ok" : "warn"}>
          {index ? "素材分析完成" : "等待生成"}
        </span>
      </div>
      {segmentLibrary ? (
        <div className="smart-status-meta">
          <span title={segmentLibrary.manifest}>片段库 {segmentLibrary.segments} 个</span>
          <span>{segmentLibrary.reused ? "已复用" : "已整理"}</span>
        </div>
      ) : null}
      {index ? (
        <div className="smart-status-meta">
          <span>{index.reused ? "已分析" : "分析完成"}</span>
          <span>{index.indexedClips} 个素材</span>
        </div>
      ) : (
        <div className="smart-status-meta">
          <span>开始生成后会分析素材并按文案/音频匹配画面</span>
        </div>
      )}
      {topMatches.length ? (
        <div className="smart-match-list">
          {topMatches.map((group) => (
            <div className="smart-match-group" key={group.key}>
              <div className="smart-match-title">
                <span>{group.label}</span>
                <em>匹配完成</em>
              </div>
              <div className="smart-match-items">
                {group.matches.slice(0, 3).map((match) => {
                  const tags = match.tags?.slice(0, 3).join(" · ") || "";
                  const detail = match.scene
                    ? `匹配：${match.scene}${tags ? ` · ${tags}` : ""}`
                    : tags || "画面相关";
                  return (
                    <div className="smart-match-item" key={`${group.key}-${match.name}-${match.scene || ""}`}>
                      <span title={match.name}>{match.name}</span>
                      <strong>推荐</strong>
                      <i title={detail}>{detail}</i>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SmartMix({ mod }: { mod: ModuleDef }) {
  const isSmartMixModule = mod.id === "ai-smart-mix";
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewBgmRef = useRef<HTMLAudioElement | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const [tab, setTab] = useState<"generate" | "base" | "pic">("generate");
  const [folder, setFolder] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<MaterialFolderInfo | null>(null);
  const [selectedClip, setSelectedClip] = useState<MaterialClip | null>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [outputs, setOutputs] = useState<string[]>([]);
  const [exportDir, setExportDir] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [awaitingExportConfirm, setAwaitingExportConfirm] = useState(false);
  const [taskItems, setTaskItems] = useState<ExportTaskItem[]>([]);
  const [segmentLibraryState, setSegmentLibraryState] = useState<SegmentLibraryState | null>(null);
  const [smartIndexState, setSmartIndexState] = useState<SmartIndexState | null>(null);
  const [smartMatchStates, setSmartMatchStates] = useState<SmartMatchState[]>([]);
  const [mixMode, setMixMode] = useState<MixMode>(isSmartMixModule ? "copy" : "custom");
  const [copyAudioEditorOpen, setCopyAudioEditorOpen] = useState(false);
  const [copyItems, setCopyItems] = useState<CopyItem[]>([{ id: "copy-1", text: "" }]);
  const [activeCopyId, setActiveCopyId] = useState("copy-1");
  const [audioItems, setAudioItems] = useState<AudioItem[]>([]);
  const [activeAudioId, setActiveAudioId] = useState("");
  const [rewritingCopyId, setRewritingCopyId] = useState<string | null>(null);
  const [synthesizingCopyId, setSynthesizingCopyId] = useState<string | null>(null);
  const [copyRewriteRevision, setCopyRewriteRevision] = useState(0);
  const [outCount, setOutCount] = useState(1);
  const [smartMaterialMode, setSmartMaterialMode] = useState<SmartMaterialMode>("segments");
  const [smartDeepMatch, setSmartDeepMatch] = useState(false);
  const [materialCount, setMaterialCount] = useState(0);
  const [clipStartSec, setClipStartSec] = useState(0);
  const [clipEndSec, setClipEndSec] = useState(0);
  const [fixedFirstEnabled, setFixedFirstEnabled] = useState(false);
  const [fixedFirstPath, setFixedFirstPath] = useState("");
  const [fixedFirstStartSec, setFixedFirstStartSec] = useState(0);
  const [fixedFirstEndSec, setFixedFirstEndSec] = useState(0);
  const [fixedLastEnabled, setFixedLastEnabled] = useState(false);
  const [fixedLastPath, setFixedLastPath] = useState("");
  const [fixedLastStartSec, setFixedLastStartSec] = useState(0);
  const [fixedLastEndSec, setFixedLastEndSec] = useState(0);
  const [shuffle, setShuffle] = useState(true);
  const [allowReuse, setAllowReuse] = useState(false);
  const [groupOutputs, setGroupOutputs] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioMode>("auto");
  const [exportResolution, setExportResolution] = useState<ExportResolution>("1080p");
  const [exportQuality, setExportQuality] = useState<ExportQuality>("high");
  const [fillMode, setFillMode] = useState<"blur" | "black">("blur");
  const [videoProcessing, setVideoProcessing] = useState(DEFAULT_VIDEO_PROCESSING);
  const [videoVolume, setVideoVolume] = useState(100);
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmPath, setBgmPath] = useState("");
  const [bgmVolume, setBgmVolume] = useState(30);
  const [bgmPreviewPlaying, setBgmPreviewPlaying] = useState(false);
  const [selectedVoiceType, setSelectedVoiceType] = useState(VOICE_SPEAKERS[0]?.VoiceType ?? "");
  const [copyVoiceEnabled, setCopyVoiceEnabled] = useState(true);
  const [copyVoiceSpeechRate, setCopyVoiceSpeechRate] = useState(0);
  const [copyVoiceLoudnessRate, setCopyVoiceLoudnessRate] = useState(0);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("off");
  const [copySubtitleEnabled, setCopySubtitleEnabled] = useState(true);
  const [audioSubtitleEnabled, setAudioSubtitleEnabled] = useState(true);
  const [subtitleText, setSubtitleText] = useState("字幕样式预览");
  const [subtitleFontIndex, setSubtitleFontIndex] = useState(0);
  const [subtitleFontSize, setSubtitleFontSize] = useState(56);
  const [subtitleOpacity, setSubtitleOpacity] = useState(100);
  const [subtitleOutlineWidth, setSubtitleOutlineWidth] = useState(0);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState("#000000");
  const [subtitlePos, setSubtitlePos] = useState({ x: 50, y: 86 });
  const [customTextLayers, setCustomTextLayers] = useState<CustomTextLayer[]>([]);
  const [activeTextLayer, setActiveTextLayer] = useState<TextLayerKind>("subtitle");
  const [activeCustomTextId, setActiveCustomTextId] = useState<string | null>(null);
  const [draggingLayer, setDraggingLayer] = useState<DraggingTextLayer | null>(null);
  const [activeBox, setActiveBox] = useState<BoxTarget | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDrag | null>(null);

  const bgmMediaUrl = bgmPath.trim() ? localMediaUrl(bgmPath.trim()) : "";
  const bgmPreviewUrl = bgmEnabled ? bgmMediaUrl : "";
  const resolvedAspectRatio = resolveAspectRatio(aspectRatio, folderInfo);
  const canvas = exportCanvas(resolvedAspectRatio, exportResolution);
  const aspectRatioSummary = aspectRatioDisplay(aspectRatio, resolvedAspectRatio);
  const exportResolutionSummary = exportResolutionLabel(exportResolution, canvas);
  const exportQualitySummary = exportQualityLabel(exportQuality);
  const addTaskLog = (message: string) => {
    void message;
  };

  useEffect(() => {
    if (isSmartMixModule && mixMode === "custom") setMixMode("copy");
  }, [isSmartMixModule, mixMode]);

  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.volume = previewVolume(videoVolume);
  }, [videoVolume, selectedClip?.url]);

  useEffect(() => {
    const bgm = previewBgmRef.current;
    if (!bgm) return;
    bgm.volume = previewVolume(bgmVolume);
  }, [bgmVolume, bgmMediaUrl]);

  useEffect(() => {
    setBgmPreviewPlaying(false);
  }, [bgmMediaUrl]);

  useEffect(() => {
    const video = previewVideoRef.current;
    const bgm = previewBgmRef.current;
    if (!video || !bgm || !bgmPreviewUrl || video.paused) return;
    bgm.play().catch(() => undefined);
  }, [bgmPreviewUrl]);

  const syncBgmTime = () => {
    const video = previewVideoRef.current;
    const bgm = previewBgmRef.current;
    if (!video || !bgm || !Number.isFinite(bgm.duration) || bgm.duration <= 0) return;
    bgm.currentTime = video.currentTime % bgm.duration;
  };

  const playPreviewBgm = () => {
    const bgm = previewBgmRef.current;
    if (!bgm || !bgmPreviewUrl) return;
    syncBgmTime();
    bgm.play().catch(() => undefined);
  };

  const pausePreviewBgm = () => {
    previewBgmRef.current?.pause();
  };

  const toggleBgmPreview = () => {
    const bgm = previewBgmRef.current;
    if (!bgm || !bgmMediaUrl) {
      setStatus("请先选择背景音乐文件");
      return;
    }
    if (bgm.paused) {
      bgm.play().catch(() => setStatus("BGM预览失败：请确认音频路径可读取"));
    } else {
      bgm.pause();
    }
  };

  const importFolder = async (nextFolder: string, statusLabel = "素材文件夹") => {
    setFolder(nextFolder);
    setFolderInfo(null);
    setSelectedClip(null);
    setOutputs([]);
    setProgress(0);
    setSegmentLibraryState(null);
    setSmartIndexState(null);
    setSmartMatchStates([]);
    setStatus(`正在读取${statusLabel}…`);
    try {
      const info = await inspectMaterials(nextFolder);
      setFolderInfo(info);
      setSelectedClip(info.clips[0] ?? null);
      setStatus(info.count ? `已导入 ${info.count} 个视频素材` : "该目录没有视频素材");
    } catch (err) {
      setFolder(null);
      setStatus("导入失败：" + (err as Error).message);
    }
  };

  const onImport = async () => {
    const p = prompt("输入素材文件夹的本机路径（留空用测试素材）", "");
    if (p === null) return;
    await importFolder(p.trim() || "__TEST__");
  };

  const openMaterialPicker = async () => {
    setMaterialPickerOpen(true);
  };

  const chooseMaterialRoot = async (root: MaterialLibraryRoot) => {
    setMaterialPickerOpen(false);
    await importFolder(root.path, root.categoryLabel);
  };

  const onClearFolder = () => {
    if (running || (!folder && !folderInfo)) return;
    setFolder(null);
    setFolderInfo(null);
    setSelectedClip(null);
    setOutputs([]);
    setExportDir("");
    setProgress(0);
    setTaskItems([]);
    setAwaitingExportConfirm(false);
    setSegmentLibraryState(null);
    setSmartIndexState(null);
    setSmartMatchStates([]);
    setStatus("");
  };

  const updateCustomTextLayer = (id: string, patch: Partial<CustomTextLayer>) => {
    setCustomTextLayers((layers) => layers.map((layer) => layer.id === id ? { ...layer, ...patch } : layer));
  };

  const updateTextPosition = (layer: DraggingTextLayer, clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    const next = { x: Math.round(x), y: Math.round(y) };
    if (layer.kind === "subtitle") setSubtitlePos(next);
    else updateCustomTextLayer(layer.id, { pos: next });
  };

  const pointerPercent = (clientX: number, clientY: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  };

  const currentRemoval = { ...DEFAULT_VIDEO_PROCESSING.watermarkRemoval!, ...videoProcessing.watermarkRemoval };
  const currentWatermark = { ...DEFAULT_VIDEO_PROCESSING.watermarkOverlay!, ...videoProcessing.watermarkOverlay };

  const updateRemovalRegion = (id: string, patch: Partial<PercentRect>) => {
    setVideoProcessing((current) => {
      const watermarkRemoval = { ...DEFAULT_VIDEO_PROCESSING.watermarkRemoval!, ...current.watermarkRemoval };
      return {
        ...current,
        watermarkRemoval: {
          ...watermarkRemoval,
          regions: watermarkRemoval.regions.map((region) => region.id === id ? { ...region, ...patch } : region),
        },
      };
    });
  };

  const updateWatermarkRect = (patch: Partial<PercentRect>) => {
    setVideoProcessing((current) => {
      const watermarkOverlay = { ...DEFAULT_VIDEO_PROCESSING.watermarkOverlay!, ...current.watermarkOverlay };
      return {
        ...current,
        watermarkOverlay: {
          ...watermarkOverlay,
          rect: { ...watermarkOverlay.rect, ...patch },
        },
      };
    });
  };

  const getBoxRect = (target: BoxTarget): PercentRect | null => {
    if (target.kind === "watermark") return currentWatermark.rect;
    return currentRemoval.regions.find((region) => region.id === target.id) ?? null;
  };

  const updateBoxRect = (target: BoxTarget, rect: PercentRect) => {
    if (target.kind === "watermark") updateWatermarkRect(rect);
    else updateRemovalRegion(target.id, rect);
  };

  const resizeRect = (rect: PercentRect, point: { x: number; y: number }, corner: NonNullable<BoxDrag["corner"]>) => {
    const minW = 4;
    const minH = 4;
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    let x = rect.x;
    let y = rect.y;
    let w = rect.w;
    let h = rect.h;
    if (corner.includes("w")) {
      x = Math.max(0, Math.min(point.x, right - minW));
      w = right - x;
    }
    if (corner.includes("e")) {
      w = Math.max(minW, Math.min(100 - rect.x, point.x - rect.x));
    }
    if (corner.includes("n")) {
      y = Math.max(0, Math.min(point.y, bottom - minH));
      h = bottom - y;
    }
    if (corner.includes("s")) {
      h = Math.max(minH, Math.min(100 - rect.y, point.y - rect.y));
    }
    return { ...rect, x, y, w, h };
  };

  const updateBoxDrag = (clientX: number, clientY: number, target: HTMLElement) => {
    if (!boxDrag) return;
    const rect = getBoxRect(boxDrag.target);
    if (!rect) return;
    const point = pointerPercent(clientX, clientY, target);
    if (boxDrag.action === "move") {
      updateBoxRect(boxDrag.target, {
        ...rect,
        x: Math.max(0, Math.min(100 - rect.w, point.x - boxDrag.offsetX)),
        y: Math.max(0, Math.min(100 - rect.h, point.y - boxDrag.offsetY)),
      });
      return;
    }
    if (boxDrag.corner) updateBoxRect(boxDrag.target, resizeRect(rect, point, boxDrag.corner));
  };

  const startBoxDrag = (boxTarget: BoxTarget, action: BoxDrag["action"], clientX: number, clientY: number, target: HTMLElement, corner?: BoxDrag["corner"]) => {
    const rect = getBoxRect(boxTarget);
    if (!rect) return;
    const point = pointerPercent(clientX, clientY, target);
    setActiveBox(boxTarget);
    setTab("pic");
    setBoxDrag({
      target: boxTarget,
      action,
      corner,
      offsetX: point.x - rect.x,
      offsetY: point.y - rect.y,
    });
  };

  const onAddCustomText = () => {
    const id = `text-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const layer: CustomTextLayer = {
      id,
      text: "添加文字",
      fontIndex: subtitleFontIndex,
      fontSize: subtitleFontSize,
      opacity: subtitleOpacity,
      outlineWidth: subtitleOutlineWidth,
      color: subtitleColor,
      outlineColor: subtitleOutlineColor,
      pos: { x: 50, y: 28 + (customTextLayers.length % 5) * 8 },
    };
    setCustomTextLayers((layers) => [...layers, layer]);
    setActiveTextLayer("custom");
    setActiveCustomTextId(id);
    setTab("base");
  };

  const onDeleteCustomText = (id: string) => {
    const next = customTextLayers.filter((layer) => layer.id !== id);
    setCustomTextLayers(next);
    if (activeCustomTextId === id) {
      const fallback = next[next.length - 1];
      setActiveCustomTextId(fallback?.id ?? null);
      setActiveTextLayer(fallback ? "custom" : "subtitle");
    }
    setDraggingLayer(null);
  };

  const addCopyItem = () => {
    const id = `copy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCopyItems((items) => [...items, { id, text: "" }]);
    setActiveCopyId(id);
    setMixMode("copy");
  };

  const updateCopyItem = (id: string, text: string) => {
    setCopyItems((items) => items.map((item) => item.id === id ? {
      ...item,
      text,
      audioUrl: undefined,
      audioPath: undefined,
      audioBytes: undefined,
      audioSpeaker: undefined,
      audioSpeakerName: undefined,
    } : item));
  };

  const deleteCopyItem = (id: string) => {
    setCopyItems((items) => {
      if (items.length <= 1) {
        setActiveCopyId(items[0]?.id ?? "copy-1");
        return [{ ...(items[0] ?? { id: "copy-1", text: "" }), text: "" }];
      }
      const index = items.findIndex((item) => item.id === id);
      const next = items.filter((item) => item.id !== id);
      if (activeCopyId === id) setActiveCopyId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
      return next;
    });
  };

  const addAudioItem = () => {
    const next = prompt("输入本机音频文件路径", "");
    if (next === null) return;
    const audioPath = next.trim();
    if (!audioPath) {
      setStatus("请填写音频文件路径");
      return;
    }
    const id = `audio-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setAudioItems((items) => [...items, { id, path: audioPath, name: basename(audioPath), text: "" }]);
    setActiveAudioId(id);
    setMixMode("audio");
  };

  const updateAudioItem = (id: string, patch: Partial<AudioItem>) => {
    setAudioItems((items) => items.map((item) => item.id === id ? {
      ...item,
      ...patch,
      name: patch.path !== undefined && patch.name === undefined ? basename(patch.path) : (patch.name ?? item.name),
    } : item));
  };

  const chooseAudioPath = (id: string, currentPath: string) => {
    const next = prompt("输入本机音频文件路径", currentPath);
    if (next === null) return;
    const audioPath = next.trim();
    updateAudioItem(id, { path: audioPath, name: basename(audioPath) });
  };

  const deleteAudioItem = (id: string) => {
    setAudioItems((items) => {
      const index = items.findIndex((item) => item.id === id);
      const next = items.filter((item) => item.id !== id);
      if (activeAudioId === id) setActiveAudioId(next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? "");
      return next;
    });
  };

  const onRewriteCopy = async (item: CopyItem) => {
    const source = item.text.trim();
    if (!source) {
      setStatus("请先输入文案");
      return;
    }
    if (rewritingCopyId) return;
    setRewritingCopyId(item.id);
    setStatus("AI改写中…");
    try {
      const rewritten = await rewriteCopy(source);
      setCopyItems((items) => items.map((copy) => copy.id === item.id ? {
        ...copy,
        text: rewritten,
        audioUrl: undefined,
        audioPath: undefined,
        audioBytes: undefined,
        audioSpeaker: undefined,
        audioSpeakerName: undefined,
      } : copy));
      setActiveCopyId(item.id);
      setCopyRewriteRevision((revision) => revision + 1);
      setStatus("AI改写完成");
    } catch (err) {
      setStatus("AI改写失败：" + (err as Error).message);
    } finally {
      setRewritingCopyId(null);
    }
  };

  const onSynthesizeCopy = async (item: CopyItem) => {
    const source = item.text.trim();
    if (!source) {
      setStatus("请先输入文案");
      return;
    }
    const voice = VOICE_SPEAKERS.find((speaker) => speaker.VoiceType === selectedVoiceType) ?? VOICE_SPEAKERS[0] ?? null;
    if (!voice) {
      setStatus("请先选择音色");
      return;
    }
    if (synthesizingCopyId) return;
    speechAudioRef.current?.pause();
    setSynthesizingCopyId(item.id);
    setStatus(`语音合成中：${voice.Name}`);
    try {
      const result = await synthesizeSpeech({
        text: source,
        speaker: voice.VoiceType,
        resourceId: voice.ResourceID,
        format: "mp3",
        sampleRate: 24000,
        speechRate: copyVoiceSpeechRate,
        loudnessRate: copyVoiceLoudnessRate,
      });
      setCopyItems((items) => items.map((copy) => copy.id === item.id ? {
        ...copy,
        audioUrl: result.url,
        audioPath: result.path,
        audioBytes: result.bytes,
        audioSpeaker: voice.VoiceType,
        audioSpeakerName: voice.Name,
      } : copy));
      setStatus(`语音合成完成：${Math.max(1, Math.round(result.bytes / 1024))} KB`);
    } catch (err) {
      setStatus("语音合成失败：" + (err as Error).message);
    } finally {
      setSynthesizingCopyId(null);
    }
  };

  const onSpeechAudioPlay = (audio: HTMLAudioElement) => {
    if (speechAudioRef.current && speechAudioRef.current !== audio) speechAudioRef.current.pause();
    speechAudioRef.current = audio;
  };

  const validateGenerate = () => {
    if (!folder || running) return;
    if (folderInfo && folderInfo.count === 0) {
      setStatus("该目录没有视频素材");
      return false;
    }
    const validCopyItems = copyItems.filter((item) => item.text.trim());
    if (mixMode === "copy" && !validCopyItems.length) {
      setStatus("请先添加文案");
      return false;
    }
    const validAudioItems = audioItems.filter((item) => item.path.trim());
    if (mixMode === "audio" && !validAudioItems.length) {
      setStatus("请先添加音频");
      return false;
    }
    if (fixedFirstEnabled && !fixedFirstPath.trim()) {
      setStatus("请先选择固定首素材");
      return false;
    }
    if (fixedLastEnabled && !fixedLastPath.trim()) {
      setStatus("请先选择固定末素材");
      return false;
    }
    return true;
  };

  const requestGenerateConfirm = () => {
    if (running) return;
    if (!validateGenerate()) return;
    setAwaitingExportConfirm(true);
    setTaskOpen(true);
    setStatus("请确认生成设置");
  };

  const onGenerate = async () => {
    if (!validateGenerate()) return;
    const inputFolder = folder;
    if (!inputFolder) return;
    const validCopyItems = copyItems.filter((item) => item.text.trim());
    const validAudioItems = audioItems.filter((item) => item.path.trim());
    setAwaitingExportConfirm(false);
    setRunning(true);
    setOutputs([]);
    setExportDir("");
    setProgress(0);
    setTaskOpen(true);
    setTaskItems([]);
    addTaskLog(`任务创建：${taskModeLabel(mixMode)}`);
    setSegmentLibraryState(null);
    setSmartIndexState(null);
    setSmartMatchStates([]);
    setStatus(mixMode === "copy" ? (copyVoiceEnabled ? "自动合成语音并生成中…" : "按文案时长生成中…") : mixMode === "audio" ? "按音频时长生成中…" : "生成中…");
    let clipsPerOutput = Math.max(folderInfo?.count ?? 1, 1);
    const subtitleFont = SUBTITLE_FONTS[subtitleFontIndex] ?? SUBTITLE_FONTS[0];
    const textStyle: SubtitleStyleParams = {
      x: subtitlePos.x,
      y: subtitlePos.y,
      fontSize: subtitleFontSize,
      fontFile: subtitleFont.file,
      fontFamily: subtitleFont.family,
      opacity: subtitleOpacity / 100,
      outlineWidth: subtitleOutlineWidth,
      color: subtitleColor,
      outlineColor: subtitleOutlineColor,
    };
    const subtitleStyle: SubtitleStyleParams | null = subtitleMode === "auto" && mixMode === "custom" ? textStyle : null;
    const textOverlays: TextOverlayParams[] = customTextLayers
      .filter((layer) => layer.text.trim())
      .map((layer) => {
        const font = SUBTITLE_FONTS[layer.fontIndex] ?? SUBTITLE_FONTS[0];
        return {
          text: layer.text.trim(),
          x: layer.pos.x,
          y: layer.pos.y,
          fontSize: layer.fontSize,
          fontFile: font.file,
          fontFamily: font.family,
          opacity: layer.opacity / 100,
          outlineWidth: layer.outlineWidth,
          color: layer.color,
          outlineColor: layer.outlineColor,
        };
      });
    const copyVoice = VOICE_SPEAKERS.find((voice) => voice.VoiceType === selectedVoiceType) ?? VOICE_SPEAKERS[0] ?? null;
    const params: MixParams = {
      inputs: inputFolder === "__TEST__" ? undefined : inputFolder,
      canvas,
      exportQuality,
      fillMode,
      out: mixMode === "copy"
        ? Math.max(1, validCopyItems.length * outCount)
        : mixMode === "audio"
          ? Math.max(1, validAudioItems.length * outCount)
          : outCount,
      fps: 30,
      shuffle,
      allowMaterialReuse: allowReuse,
      materialCount: mixMode === "copy" || mixMode === "audio" ? 0 : materialCount,
      clipStartSec,
      clipEndSec,
      videoVolume,
      bgmEnabled: bgmEnabled && Boolean(bgmPath.trim()),
      bgmPath: bgmPath.trim(),
      bgmVolume,
      subtitleMode: mixMode === "copy" || mixMode === "audio" ? "off" : subtitleMode,
      subtitleStyle,
      copyMode: mixMode === "copy",
      copyItems: mixMode === "copy" ? validCopyItems.map((item) => ({ id: item.id, text: item.text.trim() })) : undefined,
      copyVoice: mixMode === "copy" && copyVoiceEnabled && copyVoice ? {
        speaker: copyVoice.VoiceType,
        resourceId: copyVoice.ResourceID,
        name: copyVoice.Name,
      } : null,
      copyVoiceEnabled,
      copyVoiceSpeechRate,
      copyVoiceLoudnessRate,
      copyVariants: outCount,
      copySubtitleEnabled,
      copySubtitleStyle: mixMode === "copy" && copySubtitleEnabled ? textStyle : null,
      audioMode: mixMode === "audio",
      audioItems: mixMode === "audio" ? validAudioItems.map((item) => ({
        id: item.id,
        path: item.path.trim(),
        text: item.text.trim(),
        name: item.name,
      })) : undefined,
      audioVariants: outCount,
      audioSubtitleEnabled,
      audioSubtitleStyle: mixMode === "audio" && audioSubtitleEnabled ? textStyle : null,
      fixedFirstEnabled: fixedFirstEnabled && Boolean(fixedFirstPath.trim()),
      fixedFirstPath: fixedFirstPath.trim(),
      fixedFirstStartSec,
      fixedFirstEndSec,
      fixedLastEnabled: fixedLastEnabled && Boolean(fixedLastPath.trim()),
      fixedLastPath: fixedLastPath.trim(),
      fixedLastStartSec,
      fixedLastEndSec,
      textOverlays,
      videoProcessing,
      smartMix: isSmartMixModule,
      smartMaterialMode: isSmartMixModule ? smartMaterialMode : undefined,
      smartRerank: isSmartMixModule ? smartDeepMatch : undefined,
      smartRerankTopK: isSmartMixModule && smartDeepMatch ? 24 : undefined,
      groupOutputs,
    };
    try {
      await mix(params, (e) => {
        if (e.type === "start") {
          clipsPerOutput = Math.max(e.clips.length, 1);
          setStatus(`已准备 ${e.clips.length} 个素材，预计生成 ${e.out} 个视频`);
          addTaskLog(`已准备 ${e.clips.length} 个素材，预计生成 ${e.out} 个视频`);
          setTaskItems(Array.from({ length: Math.max(1, e.out) }, (_, index) => ({
            id: `out-${index + 1}`,
            name: `成片_${String(index + 1).padStart(2, "0")}.mp4`,
            status: index === 0 ? "running" : "waiting",
          })));
        } else if (e.type === "segment") {
          const done = (e.output - 1) * clipsPerOutput + e.seg + 1;
          setProgress(Math.min(99, Math.round((done / (e.total * clipsPerOutput)) * 100)));
          setTaskItems((items) => items.map((item, index) => index === e.output - 1 && item.status !== "done" ? { ...item, status: "running" } : item));
        }
        else if (e.type === "output_done") {
          setStatus(`已完成 ${e.output}/${e.total}`);
          addTaskLog(`已完成 ${e.output}/${e.total}：${basename(e.path)}`);
          setTaskItems((items) => items.map((item, index) => {
            if (index === e.output - 1) {
              return { ...item, name: basename(e.path), status: "done", path: e.path, url: localMediaUrl(e.path) };
            }
            if (index === e.output && item.status === "waiting") return { ...item, status: "running" };
            return item;
          }));
        }
        else if (e.type === "log") {
          const msg = publicTaskMessage(e.msg);
          if (msg) {
            setStatus(msg);
            addTaskLog(msg);
          }
        }
        else if (e.type === "segment_library") {
          setSegmentLibraryState({
            engine: e.engine,
            targetEngine: e.targetEngine,
            reused: e.reused,
            sourceClips: e.sourceClips,
            segments: e.segments,
            manifest: e.manifest,
          });
          const msg = `素材片段整理完成：${e.segments} 个片段`;
          setStatus(msg);
          addTaskLog(msg);
        }
        else if (e.type === "smart_index") {
          setSmartIndexState({
            engine: e.engine,
            available: e.available,
            reused: e.reused,
            indexedClips: e.indexedClips,
            reason: e.reason,
          });
          const msg = `素材分析完成：${e.indexedClips} 个素材`;
          setStatus(msg);
          addTaskLog(msg);
        }
        else if (e.type === "smart_match") {
          const key = `${e.itemType}-${e.index}`;
          const label = `${e.itemType === "copy" ? "文案" : "音频"} ${e.index}`;
          setStatus(`${label} 已完成画面匹配`);
          setSmartMatchStates((items) => {
            const next = items.filter((item) => item.key !== key);
            return [...next, { key, label, engine: e.engine, matches: e.matches }];
          });
        }
        else if (e.type === "error") {
          setAwaitingExportConfirm(false);
          setStatus("失败：" + e.msg);
          addTaskLog("失败：" + e.msg);
          setTaskItems((items) => items.map((item) => item.status === "running" ? { ...item, status: "error" } : item));
        }
        else if (e.type === "done") {
          setAwaitingExportConfirm(false);
          setProgress(100);
          setStatus(`完成，共 ${e.outputs.length} 条`);
          setOutputs(e.outputs);
          setExportDir(e.exportDir ?? "");
          addTaskLog(`导出完成，共 ${e.outputs.length} 条`);
          setTaskItems((items) => {
            if (!items.length) {
              return e.outputs.map((url, index) => ({
                id: `out-${index + 1}`,
                name: outputNameFromUrl(url, `成片_${String(index + 1).padStart(2, "0")}.mp4`),
                status: "done",
                url,
              }));
            }
            return items.map((item, index) => ({
              ...item,
              status: "done",
              url: item.url || e.outputs[index],
              name: item.name || outputNameFromUrl(e.outputs[index], `成片_${String(index + 1).padStart(2, "0")}.mp4`),
            }));
          });
        }
      });
    } catch (err) {
      setAwaitingExportConfirm(false);
      setStatus("失败：" + (err as Error).message);
      addTaskLog("失败：" + (err as Error).message);
      setTaskItems((items) => items.map((item) => item.status === "running" ? { ...item, status: "error" } : item));
    }
    setRunning(false);
  };

  const canGenerate = !!folder && (!folderInfo || folderInfo.count > 0);
  const validCopyCount = copyItems.filter((item) => item.text.trim()).length;
  const validAudioCount = audioItems.filter((item) => item.path.trim()).length;
  const plannedOutputs = mixMode === "copy"
    ? Math.max(1, validCopyCount * outCount)
    : mixMode === "audio"
      ? Math.max(1, validAudioCount * outCount)
      : outCount;
  const exportSummary = [
    { label: "生成模式", value: isSmartMixModule ? `AI 智能混剪 · ${taskModeLabel(mixMode)}` : taskModeLabel(mixMode) },
    { label: "素材来源", value: folderInfo?.name || (folder ? basename(folder) : "未导入") },
    { label: "素材数量", value: `${folderInfo?.count ?? 0} 个视频` },
    { label: "视频比例", value: aspectRatioSummary },
    ...(isSmartMixModule ? [{ label: "素材类型", value: smartMaterialMode === "segments" ? "已分割片段" : "原始长视频" }] : []),
    ...(isSmartMixModule ? [{ label: "匹配方式", value: smartDeepMatch ? "深度匹配" : "快速匹配" }] : []),
    ...(mixMode === "copy" ? [{ label: "文案数量", value: `${validCopyCount} 条` }] : []),
    ...(mixMode === "audio" ? [{ label: "音频数量", value: `${validAudioCount} 个` }] : []),
    ...(fixedFirstEnabled && fixedFirstPath.trim() ? [{ label: "固定首素材", value: basename(fixedFirstPath) }] : []),
    ...(fixedLastEnabled && fixedLastPath.trim() ? [{ label: "固定末素材", value: basename(fixedLastPath) }] : []),
    { label: "预计产出", value: `${plannedOutputs} 个视频` },
    { label: "输出方式", value: mixMode === "copy" ? (groupOutputs ? "按文案分类" : "不分类") : mixMode === "audio" ? (groupOutputs ? "按音频分类" : "不分类") : "按任务批次输出" },
  ];
  const exportConfirmControls = (
    <div className="drawer-export-settings">
      <div className="drawer-setting-row">
        <div>
          <span>导出分辨率</span>
          <b>{exportResolutionSummary}</b>
        </div>
        <div className="mini-seg compact">
          <button className={exportResolution === "1080p" ? "active" : ""} type="button" onClick={() => setExportResolution("1080p")}>1080P</button>
          <button className={exportResolution === "720p" ? "active" : ""} type="button" onClick={() => setExportResolution("720p")}>720P</button>
        </div>
      </div>
      <div className="drawer-setting-row">
        <div>
          <span>导出画质</span>
          <b>{exportQualitySummary}</b>
        </div>
        <div className="mini-seg compact">
          <button className={exportQuality === "standard" ? "active" : ""} type="button" onClick={() => setExportQuality("standard")}>标准</button>
          <button className={exportQuality === "high" ? "active" : ""} type="button" onClick={() => setExportQuality("high")}>高清</button>
          <button className={exportQuality === "best" ? "active" : ""} type="button" onClick={() => setExportQuality("best")}>高质量</button>
        </div>
      </div>
    </div>
  );
  const folderName = folderInfo?.name ?? (folder ? folder.split("/").pop() || folder : "");
  const subtitlePreviewEnabled = (mixMode === "custom" && subtitleMode === "auto")
    || (mixMode === "copy" && copySubtitleEnabled)
    || (mixMode === "audio" && audioSubtitleEnabled);
  const activeCustomTextLayer = customTextLayers.find((layer) => layer.id === activeCustomTextId) ?? null;
  const controlsCustomText = activeTextLayer === "custom" && activeCustomTextLayer;
  const activeTextLabel = controlsCustomText ? "添加文字" : "字幕样式";
  const activeTextValue = controlsCustomText ? activeCustomTextLayer.text : subtitleText;
  const setActiveTextValue = (value: string) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { text: value });
    else setSubtitleText(value);
  };
  const activeFontIndex = controlsCustomText ? activeCustomTextLayer.fontIndex : subtitleFontIndex;
  const setActiveFontIndex = (value: number) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { fontIndex: value });
    else setSubtitleFontIndex(value);
  };
  const activeFontSize = controlsCustomText ? activeCustomTextLayer.fontSize : subtitleFontSize;
  const setActiveFontSize = (value: number) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { fontSize: value });
    else setSubtitleFontSize(value);
  };
  const activeOpacity = controlsCustomText ? activeCustomTextLayer.opacity : subtitleOpacity;
  const setActiveOpacity = (value: number) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { opacity: value });
    else setSubtitleOpacity(value);
  };
  const activeOutlineWidth = controlsCustomText ? activeCustomTextLayer.outlineWidth : subtitleOutlineWidth;
  const setActiveOutlineWidth = (value: number) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { outlineWidth: value });
    else setSubtitleOutlineWidth(value);
  };
  const activeTextColor = controlsCustomText ? activeCustomTextLayer.color : subtitleColor;
  const setActiveTextColor = (value: string) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { color: value });
    else setSubtitleColor(value);
  };
  const activeOutlineColor = controlsCustomText ? activeCustomTextLayer.outlineColor : subtitleOutlineColor;
  const setActiveOutlineColor = (value: string) => {
    if (controlsCustomText) updateCustomTextLayer(activeCustomTextLayer.id, { outlineColor: value });
    else setSubtitleOutlineColor(value);
  };
  const previewColor = { ...DEFAULT_VIDEO_PROCESSING.color!, ...videoProcessing.color };
  const previewMotion = { ...DEFAULT_VIDEO_PROCESSING.motion!, ...videoProcessing.motion };
  const previewVideoStyle: CSSProperties & Record<string, string | number | undefined> = {};
  if (previewColor.enabled) {
    const brightness = Math.max(0.4, 1 + previewColor.brightness / 200);
    previewVideoStyle.filter = [
      `hue-rotate(${previewColor.hue}deg)`,
      `saturate(${previewColor.saturation}%)`,
      `brightness(${brightness.toFixed(2)})`,
      `contrast(${previewColor.contrast}%)`,
    ].join(" ");
  }
  if (previewMotion.enabled && previewMotion.intensity > 0) {
    previewVideoStyle["--motion-scale"] = (1 + previewMotion.intensity / 100).toFixed(3);
    previewVideoStyle["--motion-drift"] = `${Math.min(10, previewMotion.intensity * 0.45)}%`;
    previewVideoStyle["--motion-duration"] = `${Math.max(4, 18 - previewMotion.speed * 0.12).toFixed(1)}s`;
  }
  const previewMotionClass = previewMotion.enabled && previewMotion.intensity > 0
    ? `preview-motion preview-motion-${previewMotion.mode}`
    : "";
  const watermarkMediaUrl = currentWatermark.path.trim() ? localMediaUrl(currentWatermark.path.trim()) : "";
  const isActiveBox = (target: BoxTarget) => activeBox?.kind === target.kind && (target.kind === "watermark" || (activeBox.kind === "remove" && activeBox.id === target.id));
  const activeCopyItem = copyItems.find((item) => item.id === activeCopyId) ?? copyItems[0];
  const activeCopyIndex = Math.max(0, copyItems.findIndex((item) => item.id === activeCopyItem?.id));
  const activeAudioItem = audioItems.find((item) => item.id === activeAudioId) ?? audioItems[0] ?? null;
  const activeAudioIndex = activeAudioItem ? Math.max(0, audioItems.findIndex((item) => item.id === activeAudioItem.id)) : 0;
  const selectedVoice = VOICE_SPEAKERS.find((voice) => voice.VoiceType === selectedVoiceType) ?? VOICE_SPEAKERS[0] ?? null;

  return (
    <div className="modwrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>{isSmartMixModule ? "智能匹配 · " : ""}{mixMode === "copy" ? "文案模式" : mixMode === "audio" ? "音频模式" : "自定义模式"}</span>
        </div>
      </div>
      <div className="mod">
        {/* 左：素材 */}
        <div className="col">
          <div className="box" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="box-h">
              <button className="import-btn" onClick={onImport}>导入文件夹</button>
              <button className="icon-btn text-btn" type="button" onClick={openMaterialPicker}>素材仓库</button>
              <div className="r">
                <button className="icon-btn text-btn" type="button" onClick={onClearFolder} disabled={running || (!folder && !folderInfo)}>清空</button>
              </div>
            </div>
            {!folder ? (
              <div className="empty">
                <div className="t">暂无文件夹</div>
                <div className="s">点击导入按钮或拖拽添加素材文件夹</div>
              </div>
            ) : (
              <div className="folder-tree">
                <div className="folder-row">
                  <button className="folder-open" type="button">⌄</button>
                  <strong title={folderName}>{folderName}</strong>
                  <span className="folder-count">{folderInfo ? folderInfo.count : "…"}</span>
                </div>
                <div className="clip-list">
                  {!folderInfo ? (
                    <div className="clip-row muted">正在读取素材…</div>
                  ) : folderInfo.clips.length ? (
                    folderInfo.clips.map((clip) => (
                      <button
                        className={`clip-row ${selectedClip?.path === clip.path ? "active" : ""}`}
                        key={clip.path || clip.name}
                        title={clip.name}
                        type="button"
                        onClick={() => setSelectedClip(clip)}
                      >
                        <span>▻</span>
                        <b>{clip.name}</b>
                      </button>
                    ))
                  ) : (
                    <div className="clip-row muted">该目录没有视频素材</div>
                  )}
                </div>
                <div className="folder-path">{folder === "__TEST__" ? "（使用内置测试素材）" : folder}</div>
              </div>
            )}
          </div>
        </div>

        {/* 中：预览 + 文案/结果 */}
        <div className="col">
          <div className="preview-h" aria-label="视频预览设置">
            <div className="preview-tools">
              <button className="mini-chip preview-add-text" type="button" onClick={onAddCustomText}>添加文字</button>
              <div className="preview-tool-group">
                <span className="preview-tool-label">比例</span>
                <div className="mini-seg compact">
                  <button className={aspectRatio === "auto" ? "active" : ""} type="button" onClick={() => setAspectRatio("auto")}>跟随素材</button>
                  <button className={aspectRatio === "9:16" ? "active" : ""} type="button" onClick={() => setAspectRatio("9:16")}>9:16</button>
                  <button className={aspectRatio === "16:9" ? "active" : ""} type="button" onClick={() => setAspectRatio("16:9")}>16:9</button>
                </div>
                {aspectRatio === "auto" ? <span className="ratio-hint">按多数 {resolvedAspectRatio}</span> : null}
              </div>
              <div className="preview-tool-group">
                <span className="preview-tool-label">填充</span>
                <div className="mini-seg compact">
                  <button className={fillMode === "blur" ? "active" : ""} type="button" onClick={() => setFillMode("blur")}>虚化</button>
                  <button className={fillMode === "black" ? "active" : ""} type="button" onClick={() => setFillMode("black")}>纯黑</button>
                </div>
              </div>
            </div>
          </div>
          <div
            className="preview"
            onPointerUp={() => { setDraggingLayer(null); setBoxDrag(null); }}
            onPointerLeave={() => { setDraggingLayer(null); setBoxDrag(null); }}
          >
            <div
              className={`preview-stage ratio-${resolvedAspectRatio.replace(":", "-")} fill-${fillMode}`}
              onPointerMove={(e) => {
                if (boxDrag) updateBoxDrag(e.clientX, e.clientY, e.currentTarget);
                if (draggingLayer) updateTextPosition(draggingLayer, e.clientX, e.clientY, e.currentTarget);
              }}
            >
              {selectedClip?.url ? (
                <>
                  <video
                    className={previewMotionClass}
                    key={selectedClip.url}
                    ref={previewVideoRef}
                    src={selectedClip.url}
                    controls
                    style={previewVideoStyle}
                    onLoadedMetadata={(e) => {
                      e.currentTarget.volume = previewVolume(videoVolume);
                    }}
                    onPlay={playPreviewBgm}
                    onPause={pausePreviewBgm}
                    onEnded={pausePreviewBgm}
                    onSeeking={syncBgmTime}
                    onSeeked={syncBgmTime}
                  />
                  {bgmMediaUrl ? (
                    <audio
                      key={bgmMediaUrl}
                      ref={previewBgmRef}
                      src={bgmMediaUrl}
                      loop
                      preload="auto"
                      onLoadedMetadata={() => {
                        if (previewBgmRef.current) previewBgmRef.current.volume = previewVolume(bgmVolume);
                      }}
                      onPlay={() => setBgmPreviewPlaying(true)}
                      onPause={() => setBgmPreviewPlaying(false)}
                      onError={() => setStatus("BGM预览失败：请确认音频路径可读取")}
                    />
                  ) : null}
                  {currentRemoval.enabled ? currentRemoval.regions.map((region, index) => {
                    const target: BoxTarget = { kind: "remove", id: region.id };
                    const active = isActiveBox(target);
                    return (
                      <div
                        className={`region-box remove-region ${active ? "active" : ""}`}
                        key={region.id}
                        style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          startBoxDrag(target, "move", e.clientX, e.clientY, e.currentTarget.parentElement as HTMLElement);
                        }}
                      >
                        <span className="region-label">区域 {index + 1}</span>
                        {active ? BOX_CORNERS.map((corner) => (
                          <button
                            className={`resize-handle ${corner}`}
                            key={corner}
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              startBoxDrag(target, "resize", e.clientX, e.clientY, e.currentTarget.closest(".preview-stage") as HTMLElement, corner);
                            }}
                          />
                        )) : null}
                      </div>
                    );
                  }) : null}
                  {currentWatermark.enabled ? (
                    <div
                      className={`region-box watermark-region ${isActiveBox({ kind: "watermark" }) ? "active" : ""}`}
                      style={{
                        left: `${currentWatermark.rect.x}%`,
                        top: `${currentWatermark.rect.y}%`,
                        width: `${currentWatermark.rect.w}%`,
                        height: `${currentWatermark.rect.h}%`,
                        opacity: currentWatermark.opacity / 100,
                      }}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startBoxDrag({ kind: "watermark" }, "move", e.clientX, e.clientY, e.currentTarget.parentElement as HTMLElement);
                      }}
                    >
                      {watermarkMediaUrl ? (
                        currentWatermark.mediaType === "video" ? (
                          <video className="watermark-media" src={watermarkMediaUrl} autoPlay loop muted playsInline />
                        ) : (
                          <img className="watermark-media" src={watermarkMediaUrl} alt="" />
                        )
                      ) : (
                        <span className="watermark-placeholder">水印</span>
                      )}
                      {isActiveBox({ kind: "watermark" }) ? BOX_CORNERS.map((corner) => (
                        <button
                          className={`resize-handle ${corner}`}
                          key={corner}
                          type="button"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            startBoxDrag({ kind: "watermark" }, "resize", e.clientX, e.clientY, e.currentTarget.closest(".preview-stage") as HTMLElement, corner);
                          }}
                        />
                      )) : null}
                    </div>
                  ) : null}
                  <SubtitlePreviewOverlay
                    active={activeTextLayer === "subtitle"}
                    color={subtitleColor}
                    enabled={subtitlePreviewEnabled}
                    fontIndex={subtitleFontIndex}
                    fontSize={subtitleFontSize}
                    opacity={subtitleOpacity}
                    outlineColor={subtitleOutlineColor}
                    outlineWidth={subtitleOutlineWidth}
                    text={subtitleText}
                    x={subtitlePos.x}
                    y={subtitlePos.y}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveTextLayer("subtitle");
                      setTab("base");
                      setDraggingLayer({ kind: "subtitle" });
                      updateTextPosition({ kind: "subtitle" }, e.clientX, e.clientY, e.currentTarget.parentElement as HTMLElement);
                    }}
                  />
                  {customTextLayers.map((layer) => {
                    const font = SUBTITLE_FONTS[layer.fontIndex] ?? SUBTITLE_FONTS[0];
                    const previewFontSize = Math.max(18, Math.round(layer.fontSize * 0.46));
                    const previewOutlineWidth = layer.outlineWidth <= 0 ? 0 : Math.max(1, Math.round(layer.outlineWidth * 0.65));
                    const active = activeTextLayer === "custom" && activeCustomTextId === layer.id;
                    return (
                      <div
                        className={`subtitle-preview text-overlay custom-text-overlay ${active ? "active" : ""}`}
                        key={layer.id}
                        style={{
                          left: `${layer.pos.x}%`,
                          top: `${layer.pos.y}%`,
                          fontFamily: `"${font.family}", sans-serif`,
                          fontSize: previewFontSize,
                          color: layer.color,
                          opacity: layer.opacity / 100,
                          WebkitTextStroke: `${previewOutlineWidth}px ${layer.outlineColor}`,
                          textShadow: layer.outlineWidth > 0 ? `0 1px 2px ${layer.outlineColor}` : "none",
                        }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setActiveTextLayer("custom");
                          setActiveCustomTextId(layer.id);
                          setTab("base");
                          if ((e.target as HTMLElement).closest(".text-editable, .text-delete")) return;
                          e.preventDefault();
                          setDraggingLayer({ kind: "custom", id: layer.id });
                          updateTextPosition({ kind: "custom", id: layer.id }, e.clientX, e.clientY, e.currentTarget.parentElement as HTMLElement);
                        }}
                      >
                        {active ? (
                          <button
                            className="text-drag"
                            type="button"
                            title="拖动文字"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setActiveTextLayer("custom");
                              setActiveCustomTextId(layer.id);
                              setTab("base");
                              setDraggingLayer({ kind: "custom", id: layer.id });
                            }}
                          >
                            ↕
                          </button>
                        ) : null}
                        {active ? (
                          <button
                            className="text-delete"
                            type="button"
                            title="删除文字"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteCustomText(layer.id);
                            }}
                          >
                            ×
                          </button>
                        ) : null}
                        <div
                          className="text-editable"
                          contentEditable
                          data-placeholder="输入文字"
                          suppressContentEditableWarning
                          onFocus={() => {
                            setActiveTextLayer("custom");
                            setActiveCustomTextId(layer.id);
                            setTab("base");
                          }}
                          onInput={(e) => updateCustomTextLayer(layer.id, { text: e.currentTarget.textContent ?? "" })}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            setDraggingLayer(null);
                            setActiveTextLayer("custom");
                            setActiveCustomTextId(layer.id);
                            setTab("base");
                          }}
                        >
                          {layer.text}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="preview-empty">
                  <div>{selectedClip ? "该素材暂不支持浏览器预览" : "选择素材后在此预览"}</div>
                </div>
              )}
            </div>
          </div>
          <div className="box copybox">
            <div className="box-h">
              {mixMode === "copy" ? "文案列表" : mixMode === "audio" ? "音频列表" : "视频文案"}
            </div>
            {mixMode === "copy" ? (
              <div className="copy-summary">
                <div className="copy-summary-top">
                  <div>
                    <b>{copyItems.length} 条文案</b>
                    <span>{copySubtitleEnabled ? "生成时会按文案配音并生成字幕" : "生成时会按文案配音"}</span>
                  </div>
                  <button className="import-btn" type="button" onClick={() => setCopyAudioEditorOpen(true)}>编辑文案</button>
                </div>
                <div className="copy-summary-list">
                  {copyItems.slice(0, 4).map((item, index) => (
                    <button className={item.id === activeCopyItem?.id ? "active" : ""} key={item.id} type="button" onClick={() => {
                      setActiveCopyId(item.id);
                      setCopyAudioEditorOpen(true);
                    }}>
                      <b>文案 {index + 1}</b>
                      <span>{item.text.trim() || "未填写"}</span>
                    </button>
                  ))}
                </div>
                {copyItems.length > 4 ? <div className="copy-summary-more">还有 {copyItems.length - 4} 条，打开弹层查看</div> : null}
                {outputs.length ? <div className="copy-summary-done">已生成 {outputs.length} 个视频，可在右下角任务或产出记录中查看。</div> : null}
              </div>
            ) : mixMode === "audio" ? (
              <div className="copy-summary">
                <div className="copy-summary-top">
                  <div>
                    <b>{audioItems.length} 个音频</b>
                    <span>{audioSubtitleEnabled ? "按音频时长生成，可填写字幕文案" : "按音频时长生成"}</span>
                  </div>
                  <button className="import-btn" type="button" onClick={() => {
                    if (!audioItems.length) addAudioItem();
                    setCopyAudioEditorOpen(true);
                  }}>编辑音频</button>
                </div>
                {audioItems.length ? (
                  <div className="copy-summary-list">
                    {audioItems.slice(0, 4).map((item, index) => (
                      <button className={item.id === activeAudioItem?.id ? "active" : ""} key={item.id} type="button" onClick={() => {
                        setActiveAudioId(item.id);
                        setCopyAudioEditorOpen(true);
                      }}>
                        <b>音频 {index + 1}</b>
                        <span>{item.name || (item.path ? basename(item.path) : "未选择")}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!audioItems.length ? <div className="copy-summary-empty">还没有音频，点击编辑音频添加。</div> : null}
                {audioItems.length > 4 ? <div className="copy-summary-more">还有 {audioItems.length - 4} 个，打开弹层查看</div> : null}
                {outputs.length ? <div className="copy-summary-done">已生成 {outputs.length} 个视频，可在右下角任务或产出记录中查看。</div> : null}
              </div>
            ) : (
              <div className="body">
                <div>请在左侧选择一个文件夹</div>
                <div className="s muted">选中文件夹后即可输入文案或添加音频</div>
              </div>
            )}
          </div>
        </div>

        {/* 右：设置 */}
        <div className="col settings">
          <div className="tabs">
            <button className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}>生成设置</button>
            <button className={tab === "base" ? "active" : ""} onClick={() => setTab("base")}>基础设置</button>
            <button className={tab === "pic" ? "active" : ""} onClick={() => setTab("pic")}>画面处理</button>
          </div>
          <div className="set-scroll">{tab === "generate" ? (
            <div className="box right-settings-card">
              <div className="box-h">生成设置</div>
              <div className="right-settings-body">
                <FolderMixSettings
                  mixMode={mixMode}
                  setMixMode={setMixMode}
                  outCount={outCount}
                  setOutCount={setOutCount}
                  materialCount={materialCount}
                  setMaterialCount={setMaterialCount}
                  clipStartSec={clipStartSec}
                  setClipStartSec={setClipStartSec}
                  clipEndSec={clipEndSec}
                  setClipEndSec={setClipEndSec}
                  shuffle={shuffle}
                  setShuffle={setShuffle}
                  allowReuse={allowReuse}
                  setAllowReuse={setAllowReuse}
                  subtitleMode={subtitleMode}
                  setSubtitleMode={setSubtitleMode}
                  copySubtitleEnabled={copySubtitleEnabled}
                  setCopySubtitleEnabled={setCopySubtitleEnabled}
                  audioSubtitleEnabled={audioSubtitleEnabled}
                  setAudioSubtitleEnabled={setAudioSubtitleEnabled}
                  groupOutputs={groupOutputs}
                  setGroupOutputs={setGroupOutputs}
                  fixedFirstEnabled={fixedFirstEnabled}
                  setFixedFirstEnabled={setFixedFirstEnabled}
                  fixedFirstPath={fixedFirstPath}
                  setFixedFirstPath={setFixedFirstPath}
                  fixedFirstStartSec={fixedFirstStartSec}
                  setFixedFirstStartSec={setFixedFirstStartSec}
                  fixedFirstEndSec={fixedFirstEndSec}
                  setFixedFirstEndSec={setFixedFirstEndSec}
                  fixedLastEnabled={fixedLastEnabled}
                  setFixedLastEnabled={setFixedLastEnabled}
                  fixedLastPath={fixedLastPath}
                  setFixedLastPath={setFixedLastPath}
                  fixedLastStartSec={fixedLastStartSec}
                  setFixedLastStartSec={setFixedLastStartSec}
                  fixedLastEndSec={fixedLastEndSec}
                  setFixedLastEndSec={setFixedLastEndSec}
                  smartMaterialMode={smartMaterialMode}
                  setSmartMaterialMode={setSmartMaterialMode}
                  smartDeepMatch={smartDeepMatch}
                  setSmartDeepMatch={setSmartDeepMatch}
                  smartOnly={isSmartMixModule}
                />
              </div>
            </div>
          ) : tab === "base" ? (
            <BaseSettings
              videoVolume={videoVolume}
              setVideoVolume={setVideoVolume}
              bgmEnabled={bgmEnabled}
              setBgmEnabled={setBgmEnabled}
              bgmPath={bgmPath}
              setBgmPath={setBgmPath}
              bgmVolume={bgmVolume}
              setBgmVolume={setBgmVolume}
              bgmCanPreview={Boolean(bgmMediaUrl)}
              bgmPreviewPlaying={bgmPreviewPlaying}
              onToggleBgmPreview={toggleBgmPreview}
              mixMode={mixMode}
              selectedVoice={selectedVoice}
              copyVoiceEnabled={copyVoiceEnabled}
              setCopyVoiceEnabled={setCopyVoiceEnabled}
              copyVoiceSpeechRate={copyVoiceSpeechRate}
              setCopyVoiceSpeechRate={setCopyVoiceSpeechRate}
              copyVoiceLoudnessRate={copyVoiceLoudnessRate}
              setCopyVoiceLoudnessRate={setCopyVoiceLoudnessRate}
              onOpenVoicePicker={() => setVoicePickerOpen(true)}
              activeTextLabel={activeTextLabel}
              subtitleText={activeTextValue}
              setSubtitleText={setActiveTextValue}
              subtitleFontIndex={activeFontIndex}
              setSubtitleFontIndex={setActiveFontIndex}
              subtitleFontSize={activeFontSize}
              setSubtitleFontSize={setActiveFontSize}
              subtitleOpacity={activeOpacity}
              setSubtitleOpacity={setActiveOpacity}
              subtitleOutlineWidth={activeOutlineWidth}
              setSubtitleOutlineWidth={setActiveOutlineWidth}
              subtitleColor={activeTextColor}
              setSubtitleColor={setActiveTextColor}
              subtitleOutlineColor={activeOutlineColor}
              setSubtitleOutlineColor={setActiveOutlineColor}
            />
          ) : <VideoProcessingSettings value={videoProcessing} onChange={setVideoProcessing} />}</div>
          {isSmartMixModule ? <SmartMatchStatusPanel segmentLibrary={segmentLibraryState} index={smartIndexState} matches={smartMatchStates} /> : null}
          <div
            className={`cta ${canGenerate ? (running ? "disabled" : "ready") : "disabled"}`}
            onClick={requestGenerateConfirm}
          >
            {!folder ? "请先导入视频素材" : running ? "生成中…" : folderInfo?.count === 0 ? "该文件夹没有视频素材" : "开始生成"}
          </div>
          {running || progress > 0 || status ? (
            <button className="task-mini" type="button" onClick={() => setTaskOpen(true)}>
              <span>{running ? "导出中" : progress >= 100 ? "导出完成" : "任务状态"}</span>
              <b>{progress}%</b>
              <em>{status || "查看导出任务"}</em>
            </button>
          ) : null}
        </div>
      </div>
      {copyAudioEditorOpen && (mixMode === "copy" || mixMode === "audio") ? (
        <div className="copy-modal-backdrop" onMouseDown={() => setCopyAudioEditorOpen(false)}>
          <div className="copy-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="copy-modal-h">
              <div>
                <b>{mixMode === "copy" ? "编辑文案" : "编辑音频"}</b>
                <span>{mixMode === "copy" ? "每条文案会生成对应配音和视频" : "每个音频会生成对应视频"}</span>
              </div>
              <button className="icon-btn" type="button" onClick={() => setCopyAudioEditorOpen(false)}>×</button>
            </div>
            {mixMode === "copy" ? (
              <div className="copy-editor modal">
                <div className="copy-editor-h">
                  <span className="muted">{copySubtitleEnabled ? "生成时按文案生成字幕" : "字幕已关闭"}</span>
                  <button className="mini-chip" type="button" onClick={addCopyItem}>添加文案</button>
                </div>
                <div className="copy-tabs" role="tablist">
                  {copyItems.map((item, index) => (
                    <button
                      className={`copy-tab ${item.id === activeCopyItem?.id ? "active" : ""}`}
                      key={item.id}
                      type="button"
                      onClick={() => setActiveCopyId(item.id)}
                      role="tab"
                    >
                      <span>文案 {index + 1}</span>
                      {item.text.trim() ? <i /> : null}
                    </button>
                  ))}
                </div>
                {activeCopyItem ? (
                  <div className="copy-item" role="tabpanel">
                    <div className="copy-item-h">
                      <b>文案 {activeCopyIndex + 1}</b>
                      <button
                        className="mini-chip"
                        type="button"
                        disabled={rewritingCopyId === activeCopyItem.id}
                        onClick={() => onRewriteCopy(activeCopyItem)}
                      >
                        {rewritingCopyId === activeCopyItem.id ? "改写中" : "AI改写"}
                      </button>
                      <button
                        className="mini-chip"
                        type="button"
                        disabled={synthesizingCopyId === activeCopyItem.id}
                        onClick={() => onSynthesizeCopy(activeCopyItem)}
                      >
                        {synthesizingCopyId === activeCopyItem.id ? "合成中" : "试听合成"}
                      </button>
                      <button className="icon-btn" type="button" onClick={() => deleteCopyItem(activeCopyItem.id)}>×</button>
                    </div>
                    <textarea
                      key={`${activeCopyItem.id}-${copyRewriteRevision}`}
                      value={activeCopyItem.text}
                      onChange={(e) => updateCopyItem(activeCopyItem.id, e.target.value)}
                      placeholder="输入要合成语音的文案"
                    />
                    {activeCopyItem.audioUrl ? (
                      <div className="copy-audio">
                        <div>
                          <b>{activeCopyItem.audioSpeakerName ?? "已合成语音"}</b>
                          <span>{Math.max(1, Math.round((activeCopyItem.audioBytes ?? 0) / 1024))} KB</span>
                        </div>
                        <audio
                          src={activeCopyItem.audioUrl}
                          controls
                          preload="metadata"
                          onPlay={(e) => onSpeechAudioPlay(e.currentTarget)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="copy-editor modal">
                <div className="copy-editor-h">
                  <span className="muted">{audioSubtitleEnabled ? "可为音频填写字幕文案" : "字幕已关闭"}</span>
                  <button className="mini-chip" type="button" onClick={addAudioItem}>添加音频</button>
                </div>
                {audioItems.length ? (
                  <div className="copy-tabs" role="tablist">
                    {audioItems.map((item, index) => (
                      <button
                        className={`copy-tab ${item.id === activeAudioItem?.id ? "active" : ""}`}
                        key={item.id}
                        type="button"
                        onClick={() => setActiveAudioId(item.id)}
                        role="tab"
                      >
                        <span>音频 {index + 1}</span>
                        {item.path.trim() ? <i /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {activeAudioItem ? (
                  <div className="copy-item" role="tabpanel">
                    <div className="copy-item-h">
                      <b>音频 {activeAudioIndex + 1}</b>
                      <button className="mini-chip" type="button" onClick={() => chooseAudioPath(activeAudioItem.id, activeAudioItem.path)}>选择音频</button>
                      <button className="icon-btn" type="button" onClick={() => deleteAudioItem(activeAudioItem.id)}>×</button>
                    </div>
                    <div className="audio-path-row">
                      <input
                        className="inp"
                        value={activeAudioItem.path}
                        onChange={(e) => updateAudioItem(activeAudioItem.id, { path: e.target.value })}
                        placeholder="输入本机音频文件路径"
                      />
                    </div>
                    {activeAudioItem.path.trim() ? (
                      <div className="copy-audio">
                        <div>
                          <b>{activeAudioItem.name || basename(activeAudioItem.path)}</b>
                          <span>主音轨</span>
                        </div>
                        <audio
                          src={localMediaUrl(activeAudioItem.path.trim())}
                          controls
                          preload="metadata"
                          onPlay={(e) => onSpeechAudioPlay(e.currentTarget)}
                        />
                      </div>
                    ) : null}
                    <textarea
                      value={activeAudioItem.text}
                      onChange={(e) => updateAudioItem(activeAudioItem.id, { text: e.target.value })}
                      placeholder={audioSubtitleEnabled ? "可选：输入要烧录到视频中的字幕文案，留空则不生成字幕" : "音频字幕已关闭，可在右侧生成设置中启用"}
                    />
                  </div>
                ) : (
                  <div className="body">
                    <div>请添加一个音频文件</div>
                    <div className="s muted">音频将作为主音轨，并决定视频时长</div>
                  </div>
                )}
              </div>
            )}
            <div className="copy-modal-actions">
              <button className="import-btn" type="button" onClick={() => setCopyAudioEditorOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      ) : null}
      <MaterialSourcePicker
        open={materialPickerOpen}
        defaultCategory={isSmartMixModule ? "segments" : "all"}
        onSelect={chooseMaterialRoot}
        onClose={() => setMaterialPickerOpen(false)}
      />
      <ExportTaskDrawer
        open={taskOpen}
        title={isSmartMixModule ? "AI 智能混剪导出" : "视频混剪导出"}
        status={status}
        progress={progress}
        running={running}
        exportDir={exportDir}
        items={taskItems}
        summary={awaitingExportConfirm ? exportSummary : undefined}
        confirmControls={awaitingExportConfirm ? exportConfirmControls : undefined}
        confirmLabel="确认生成"
        onConfirm={awaitingExportConfirm ? onGenerate : undefined}
        onClose={() => setTaskOpen(false)}
      />
      {voicePickerOpen ? (
        <VoicePickerModal
          voices={VOICE_SPEAKERS}
          selectedVoiceType={selectedVoiceType}
          onSelect={(voice) => {
            setSelectedVoiceType(voice.VoiceType);
            setVoicePickerOpen(false);
          }}
          onClose={() => setVoicePickerOpen(false)}
        />
      ) : null}
    </div>
  );
}
