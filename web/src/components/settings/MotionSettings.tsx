import { Field, Group } from "../controls";
import { SettingSegment } from "./SettingControls";
import type { Resolution } from "./types";

export function MotionSettings({
  title = "规格设置",
  resolution,
  onResolutionChange,
}: {
  title?: string;
  resolution: Resolution;
  onResolutionChange: (value: Resolution) => void;
}) {
  return (
    <Group title={title}>
      <Field label="分辨率">
        <SettingSegment
          value={resolution}
          onChange={onResolutionChange}
          options={[
            { value: "1080p", label: "1080P" },
            { value: "720p", label: "720P" },
          ]}
        />
      </Field>
    </Group>
  );
}
