import { Field, Group, Slider } from "../controls";
import { ControlledSlider, hexColor, SettingSegment } from "./SettingControls";
import { SUBTITLE_FONTS } from "./types";

const PRESET_COLORS = ["random", "#fff", "#f2c14e", "#ef5777", "#3b82f6", "#22c55e", "#111", "#f97316", "#10b981", "#ec4899", "#60a5fa", "#84cc16"];

function randomPresetColor() {
  const colors = PRESET_COLORS.filter((color) => color.startsWith("#"));
  return colors[Math.floor(Math.random() * colors.length)] ?? "#ffffff";
}

function ColorSwatch({
  value,
  onChange,
  title,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  disabled?: boolean;
}) {
  return (
    <label className="color-swatch" title={title}>
      <span className="swatch" style={{ background: value }} />
      <input disabled={disabled} type="color" value={hexColor(value)} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function TextSubtitleStyleSettings({
  title = "文本/字幕样式",
  activeTextLabel,
  enabled,
  onEnabledChange,
  enableLabels = ["启用", "不启用"],
  showTextInput = true,
  text,
  onTextChange,
  fontIndex,
  onFontIndexChange,
  fontSize,
  onFontSizeChange,
  opacity,
  onOpacityChange,
  outlineWidth,
  onOutlineWidthChange,
  color,
  onColorChange,
  outlineColor,
  onOutlineColorChange,
}: {
  title?: string;
  activeTextLabel?: string;
  enabled?: boolean;
  onEnabledChange?: (value: boolean) => void;
  enableLabels?: [string, string];
  showTextInput?: boolean;
  text: string;
  onTextChange: (value: string) => void;
  fontIndex: number;
  onFontIndexChange: (value: number) => void;
  fontSize: number;
  onFontSizeChange: (value: number) => void;
  opacity: number;
  onOpacityChange: (value: number) => void;
  outlineWidth: number;
  onOutlineWidthChange: (value: number) => void;
  color: string;
  onColorChange: (value: string) => void;
  outlineColor: string;
  onOutlineColorChange: (value: string) => void;
}) {
  const disabled = enabled === false;

  return (
    <Group title={title} badge={activeTextLabel}>
      {typeof enabled === "boolean" && onEnabledChange ? (
        <Field label="字幕">
          <SettingSegment
            value={enabled ? "enabled" : "disabled"}
            onChange={(value) => onEnabledChange(value === "enabled")}
            options={[
              { value: "enabled", label: enableLabels[0] },
              { value: "disabled", label: enableLabels[1] },
            ]}
          />
        </Field>
      ) : null}
      {showTextInput ? (
        <Field label="文字内容">
          <input className="inp" disabled={disabled} value={text} onChange={(event) => onTextChange(event.target.value)} />
        </Field>
      ) : null}
      <Field label="选择字体">
        <select className="inp" disabled={disabled} value={fontIndex} onChange={(event) => onFontIndexChange(Number(event.target.value))}>
          {SUBTITLE_FONTS.map((font, index) => (
            <option key={font.file} value={index}>{font.label}</option>
          ))}
        </select>
      </Field>
      <Field label="字号大小"><ControlledSlider disabled={disabled} value={fontSize} max={120} unit="" onChange={onFontSizeChange} /></Field>
      <Field label="字体粗细"><Slider value={700} max={900} unit="" /></Field>
      <Field label="描边粗细"><ControlledSlider disabled={disabled} value={outlineWidth} max={10} unit="" onChange={onOutlineWidthChange} /></Field>
      <Field label="字体透明"><ControlledSlider disabled={disabled} value={opacity} onChange={onOpacityChange} /></Field>
      <Field label="字体颜色">
        <div className="color-row">
          <ColorSwatch disabled={disabled} value={color} onChange={onColorChange} title="字体颜色" />
          <label>描边颜色</label>
          <ColorSwatch disabled={disabled} value={outlineColor} onChange={onOutlineColorChange} title="描边颜色" />
        </div>
      </Field>
      <div className="presets">
        {PRESET_COLORS.map((preset, index) => (
          <button
            className="p"
            key={preset}
            type="button"
            disabled={disabled}
            style={index === 0 ? {} : { color: preset === "#fff" || preset === "#111" ? "#888" : preset }}
            onClick={() => onColorChange(index === 0 ? randomPresetColor() : preset)}
          >
            {index === 0 ? "R" : "A"}
          </button>
        ))}
      </div>
      <Field><button className="icon-btn" style={{ margin: "0 auto" }}>展开全部 ▾</button></Field>
    </Group>
  );
}
