import { Field, Group } from "../controls";
import { ControlledSlider, NumberSettingInput, SettingSegment } from "./SettingControls";

export function BgmSettings({
  title = "背景音乐",
  enabled,
  onEnabledChange,
  path,
  onPathChange,
  volume,
  onVolumeChange,
  onChoose,
  onClear,
  onTogglePreview,
  canPreview = false,
  previewPlaying = false,
  volumeControl = "number",
}: {
  title?: string;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  path: string;
  onPathChange: (value: string) => void;
  volume: number;
  onVolumeChange: (value: number) => void;
  onChoose?: () => void;
  onClear?: () => void;
  onTogglePreview?: () => void;
  canPreview?: boolean;
  previewPlaying?: boolean;
  volumeControl?: "number" | "slider";
}) {
  return (
    <Group title={title}>
      <Field label="启用">
        <SettingSegment
          value={enabled ? "enabled" : "disabled"}
          onChange={(value) => onEnabledChange(value === "enabled")}
          options={[
            { value: "enabled", label: "启用" },
            { value: "disabled", label: "不启用" },
          ]}
        />
      </Field>
      {enabled ? (
        <>
          <Field label="BGM路径">
            <input className="inp" value={path} onChange={(event) => onPathChange(event.target.value)} placeholder="输入音频文件路径" />
            {onChoose ? <button className="icon-btn text-btn" type="button" onClick={onChoose}>选择</button> : null}
            {onTogglePreview ? (
              <button className="icon-btn" disabled={!canPreview} type="button" onClick={onTogglePreview}>
                {previewPlaying ? "❚❚" : "▶"}
              </button>
            ) : null}
            {onClear ? <button className="icon-btn" type="button" onClick={onClear}>×</button> : null}
          </Field>
          <Field label="BGM音量">
            {volumeControl === "slider" ? (
              <ControlledSlider max={100} value={volume} onChange={onVolumeChange} />
            ) : (
              <NumberSettingInput min={0} max={100} value={volume} onChange={onVolumeChange} />
            )}
          </Field>
        </>
      ) : null}
    </Group>
  );
}
