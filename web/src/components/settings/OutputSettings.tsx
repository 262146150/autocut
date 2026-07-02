import { Field, Group } from "../controls";
import { NumberSettingInput, SettingSegment } from "./SettingControls";

export function OutputSettings({
  title = "生成设置",
  variants,
  onVariantsChange,
  materialCount,
  onMaterialCountChange,
  materialCountLabel = "单条素材数",
  materialAutoHint = "0 为自动",
  duration,
  onDurationChange,
  durationLabel = "单素材时长",
  durationUnit = "秒",
  allowReuse,
  onAllowReuseChange,
  reuseLabel = "素材重复",
}: {
  title?: string;
  variants: number;
  onVariantsChange: (value: number) => void;
  materialCount: number;
  onMaterialCountChange: (value: number) => void;
  materialCountLabel?: string;
  materialAutoHint?: string;
  duration: number;
  onDurationChange: (value: number) => void;
  durationLabel?: string;
  durationUnit?: string;
  allowReuse: boolean;
  onAllowReuseChange: (value: boolean) => void;
  reuseLabel?: string;
}) {
  return (
    <Group title={title}>
      <Field label="导出数量">
        <NumberSettingInput min={1} max={20} value={variants} onChange={onVariantsChange} />
      </Field>
      <Field label={materialCountLabel}>
        <NumberSettingInput min={0} max={80} value={materialCount} onChange={onMaterialCountChange} />
        <span className="muted">{materialAutoHint}</span>
      </Field>
      <Field label={durationLabel}>
        <NumberSettingInput min={1} max={12} value={duration} onChange={onDurationChange} />
        <span className="muted">{durationUnit}</span>
      </Field>
      <Field label={reuseLabel}>
        <SettingSegment
          value={allowReuse ? "yes" : "no"}
          onChange={(value) => onAllowReuseChange(value === "yes")}
          options={[
            { value: "yes", label: "允许" },
            { value: "no", label: "不允许" },
          ]}
        />
      </Field>
    </Group>
  );
}
