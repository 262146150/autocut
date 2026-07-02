import { Field, Group } from "../controls";
import { SettingSegment } from "./SettingControls";

export function SmartMatchSettings({
  enabled,
  onEnabledChange,
  title = "智能匹配",
  label = "深度匹配",
  hint = "启用后会调用 AI 对候选素材重排，会产生接口消耗。",
}: {
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  title?: string;
  label?: string;
  hint?: string;
}) {
  return (
    <Group title={title}>
      <Field label={label}>
        <SettingSegment
          value={enabled ? "enabled" : "disabled"}
          onChange={(value) => onEnabledChange(value === "enabled")}
          options={[
            { value: "enabled", label: "启用" },
            { value: "disabled", label: "不启用" },
          ]}
        />
      </Field>
      <Field>
        <em className="setting-hint">{hint}</em>
      </Field>
    </Group>
  );
}
