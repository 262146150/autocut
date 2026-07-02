import { Field, Group } from "../controls";
import { SettingSegment } from "./SettingControls";
import type { ExportQuality } from "./types";

export function ExportQualitySettings({
  value,
  onChange,
  title = "导出画质",
}: {
  value: ExportQuality;
  onChange: (value: ExportQuality) => void;
  title?: string;
}) {
  return (
    <Group title={title}>
      <Field label="画质">
        <SettingSegment
          value={value}
          onChange={onChange}
          options={[
            { value: "standard", label: "标准" },
            { value: "high", label: "高清" },
            { value: "best", label: "高质量" },
          ]}
        />
      </Field>
    </Group>
  );
}
