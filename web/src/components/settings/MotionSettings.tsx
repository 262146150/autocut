import { Field, Group } from "../controls";
import { SettingSegment } from "./SettingControls";
import type { MotionMode, Resolution, TransitionMode } from "./types";

export function MotionSettings({
  title = "镜头设置",
  resolution,
  onResolutionChange,
  motionMode,
  onMotionModeChange,
  transition,
  onTransitionChange,
}: {
  title?: string;
  resolution: Resolution;
  onResolutionChange: (value: Resolution) => void;
  motionMode: MotionMode;
  onMotionModeChange: (value: MotionMode) => void;
  transition: TransitionMode;
  onTransitionChange: (value: TransitionMode) => void;
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
      <Field label="运镜">
        <SettingSegment
          value={motionMode}
          onChange={onMotionModeChange}
          options={[
            { value: "zoomIn", label: "放大" },
            { value: "zoomOut", label: "缩小" },
            { value: "drift", label: "平移" },
          ]}
        />
      </Field>
      <Field label="转场">
        <SettingSegment
          value={transition}
          onChange={onTransitionChange}
          options={[
            { value: "fade", label: "淡入淡出" },
            { value: "none", label: "无" },
          ]}
        />
      </Field>
    </Group>
  );
}
