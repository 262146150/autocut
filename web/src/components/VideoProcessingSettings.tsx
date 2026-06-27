import type { MotionMode, PercentRect, VideoProcessingParams, WatermarkMediaType, WatermarkRemovalMode } from "../api";
import { Field, Group } from "./controls";

export const DEFAULT_VIDEO_PROCESSING: VideoProcessingParams = {
  watermarkRemoval: {
    enabled: false,
    mode: "blur",
    regions: [],
  },
  watermarkOverlay: {
    enabled: false,
    path: "",
    mediaType: "image",
    opacity: 80,
    rect: { id: "watermark", x: 64, y: 72, w: 24, h: 14 },
  },
  color: {
    enabled: false,
    hue: 0,
    saturation: 100,
    brightness: 0,
    contrast: 100,
    temperature: 0,
    sharpen: 0,
  },
  motion: {
    enabled: false,
    mode: "zoomIn",
    intensity: 6,
    speed: 50,
  },
};

function setNested<T extends keyof VideoProcessingParams>(
  value: VideoProcessingParams,
  key: T,
  patch: Partial<NonNullable<VideoProcessingParams[T]>>
): VideoProcessingParams {
  return { ...value, [key]: { ...DEFAULT_VIDEO_PROCESSING[key], ...value[key], ...patch } };
}

function makeRegion(index: number): PercentRect {
  return { id: `remove-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`, x: 20 + (index % 3) * 16, y: 18 + (index % 4) * 12, w: 22, h: 10 };
}

function resizeRegions(regions: PercentRect[], count: number) {
  const nextCount = Math.max(0, Math.min(8, Math.floor(count) || 0));
  if (regions.length === nextCount) return regions;
  if (regions.length > nextCount) return regions.slice(0, nextCount);
  const next = [...regions];
  while (next.length < nextCount) next.push(makeRegion(next.length));
  return next;
}

function ControlledSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  unit = "%",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  return (
    <>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span className="val">{value}{unit}</span>
    </>
  );
}

function ControlledNumber({
  value,
  onChange,
  min = 0,
  max = 100,
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

function ToggleButtons({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="mini-seg compact" style={{ marginLeft: "auto" }}>
      <button className={enabled ? "active" : ""} type="button" onClick={() => onChange(true)}>启用</button>
      <button className={!enabled ? "active" : ""} type="button" onClick={() => onChange(false)}>不启用</button>
    </div>
  );
}

function MotionModeButtons({
  value,
  onChange,
}: {
  value: MotionMode;
  onChange: (value: MotionMode) => void;
}) {
  const options: Array<{ label: string; value: MotionMode }> = [
    { label: "推近", value: "zoomIn" },
    { label: "拉远", value: "zoomOut" },
    { label: "漂移", value: "drift" },
  ];
  return (
    <div className="mini-seg compact">
      {options.map((item) => (
        <button
          className={value === item.value ? "active" : ""}
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function RemovalModeButtons({
  value,
  onChange,
}: {
  value: WatermarkRemovalMode;
  onChange: (value: WatermarkRemovalMode) => void;
}) {
  const options: Array<{ label: string; value: WatermarkRemovalMode }> = [
    { label: "模糊", value: "blur" },
    { label: "马赛克", value: "pixelate" },
    { label: "纯色", value: "solid" },
  ];
  return (
    <div className="mini-seg compact">
      {options.map((item) => (
        <button className={value === item.value ? "active" : ""} key={item.value} type="button" onClick={() => onChange(item.value)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function MediaTypeButtons({
  value,
  onChange,
}: {
  value: WatermarkMediaType;
  onChange: (value: WatermarkMediaType) => void;
}) {
  return (
    <div className="mini-seg compact">
      <button className={value === "image" ? "active" : ""} type="button" onClick={() => onChange("image")}>图片</button>
      <button className={value === "video" ? "active" : ""} type="button" onClick={() => onChange("video")}>视频</button>
    </div>
  );
}

function inferWatermarkMediaType(filePath: string): WatermarkMediaType {
  return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(filePath) ? "video" : "image";
}

export function VideoProcessingSettings({
  value,
  onChange,
}: {
  value: VideoProcessingParams;
  onChange: (value: VideoProcessingParams) => void;
}) {
  const watermarkRemoval = { ...DEFAULT_VIDEO_PROCESSING.watermarkRemoval!, ...value.watermarkRemoval };
  const watermarkOverlay = { ...DEFAULT_VIDEO_PROCESSING.watermarkOverlay!, ...value.watermarkOverlay };
  const color = { ...DEFAULT_VIDEO_PROCESSING.color!, ...value.color };
  const motion = { ...DEFAULT_VIDEO_PROCESSING.motion!, ...value.motion };
  const chooseWatermark = () => {
    const next = prompt("输入图片或视频水印文件路径", watermarkOverlay.path);
    if (next === null) return;
    const path = next.trim();
    const mediaType = inferWatermarkMediaType(path);
    onChange(setNested(value, "watermarkOverlay", { path, mediaType, enabled: Boolean(path) }));
  };

  return (
    <>
      <Group title="去除水印">
        <Field label="状态">
          <ToggleButtons enabled={watermarkRemoval.enabled} onChange={(enabled) => onChange(setNested(value, "watermarkRemoval", { enabled }))} />
        </Field>
        <Field label="方式"><RemovalModeButtons value={watermarkRemoval.mode} onChange={(mode) => onChange(setNested(value, "watermarkRemoval", { mode }))} /></Field>
        <Field label="区域数">
          <ControlledNumber
            value={watermarkRemoval.regions.length}
            max={8}
            onChange={(count) => onChange(setNested(value, "watermarkRemoval", { regions: resizeRegions(watermarkRemoval.regions, count), enabled: count > 0 }))}
          />
        </Field>
      </Group>
      <Group title="图片/视频水印">
        <Field label="状态">
          <ToggleButtons enabled={watermarkOverlay.enabled} onChange={(enabled) => onChange(setNested(value, "watermarkOverlay", { enabled }))} />
        </Field>
        <Field label="类型"><MediaTypeButtons value={watermarkOverlay.mediaType} onChange={(mediaType) => onChange(setNested(value, "watermarkOverlay", { mediaType }))} /></Field>
        <Field label="素材">
          <input
            className="inp"
            placeholder="输入本机图片或视频路径"
            value={watermarkOverlay.path}
            onChange={(e) => {
              const path = e.target.value;
              onChange(setNested(value, "watermarkOverlay", { path, mediaType: inferWatermarkMediaType(path), enabled: Boolean(path.trim()) }));
            }}
          />
          <button className="icon-btn" type="button" onClick={chooseWatermark}>📄</button>
          <button className="icon-btn" type="button" onClick={() => onChange(setNested(value, "watermarkOverlay", { path: "", enabled: false }))}>×</button>
        </Field>
        <Field label="透明度"><ControlledSlider value={watermarkOverlay.opacity} onChange={(opacity) => onChange(setNested(value, "watermarkOverlay", { opacity }))} /></Field>
      </Group>
      <Group title="HSL 调色">
        <Field label="状态">
          <ToggleButtons enabled={color.enabled} onChange={(enabled) => onChange(setNested(value, "color", { enabled }))} />
        </Field>
        <Field label="色相"><ControlledSlider value={color.hue} min={-180} max={180} unit="°" onChange={(hue) => onChange(setNested(value, "color", { hue }))} /></Field>
        <Field label="饱和度"><ControlledSlider value={color.saturation} max={200} onChange={(saturation) => onChange(setNested(value, "color", { saturation }))} /></Field>
        <Field label="亮度"><ControlledSlider value={color.brightness} min={-100} max={100} unit="" onChange={(brightness) => onChange(setNested(value, "color", { brightness }))} /></Field>
        <Field label="对比度"><ControlledSlider value={color.contrast} max={200} onChange={(contrast) => onChange(setNested(value, "color", { contrast }))} /></Field>
        <Field label="色温"><ControlledSlider value={color.temperature} min={-100} max={100} unit="" onChange={(temperature) => onChange(setNested(value, "color", { temperature }))} /></Field>
        <Field label="锐化"><ControlledSlider value={color.sharpen} max={100} onChange={(sharpen) => onChange(setNested(value, "color", { sharpen }))} /></Field>
      </Group>
      <Group title="动态缩放">
        <Field label="状态">
          <ToggleButtons enabled={motion.enabled} onChange={(enabled) => onChange(setNested(value, "motion", { enabled }))} />
        </Field>
        <Field label="模式"><MotionModeButtons value={motion.mode} onChange={(mode) => onChange(setNested(value, "motion", { mode }))} /></Field>
        <Field label="强度"><ControlledSlider value={motion.intensity} max={20} unit="" onChange={(intensity) => onChange(setNested(value, "motion", { intensity }))} /></Field>
        <Field label="速度"><ControlledSlider value={motion.speed} max={100} onChange={(speed) => onChange(setNested(value, "motion", { speed }))} /></Field>
      </Group>
    </>
  );
}
