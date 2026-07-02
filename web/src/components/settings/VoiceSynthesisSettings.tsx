import { Field, Group } from "../controls";
import { ControlledSlider, rateLabel, SettingSegment } from "./SettingControls";
import { voiceCategories, type VoiceSpeaker } from "./voices";

export function VoiceSynthesisSettings({
  title = "语音合成",
  enabled,
  onEnabledChange,
  selectedVoice,
  onOpenVoicePicker,
  enabledHint = "开始生成时会自动合成语音",
  disabledHint = "关闭后不合成配音，仅按内容估算时长生成。",
  showRateControls = false,
  speechRate = 0,
  onSpeechRateChange,
  loudnessRate = 0,
  onLoudnessRateChange,
  voiceCardVariant = "card",
}: {
  title?: string;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
  selectedVoice: VoiceSpeaker | null;
  onOpenVoicePicker: () => void;
  enabledHint?: string;
  disabledHint?: string;
  showRateControls?: boolean;
  speechRate?: number;
  onSpeechRateChange?: (value: number) => void;
  loudnessRate?: number;
  onLoudnessRateChange?: (value: number) => void;
  voiceCardVariant?: "card" | "compact";
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
      <Field>
        <span className="muted">{enabled ? enabledHint : disabledHint}</span>
      </Field>
      {enabled ? (
        <Field label="音色库">
          {voiceCardVariant === "compact" ? (
            <>
              <div className="voice-avatar-small">
                {selectedVoice?.Avatar ? <img src={selectedVoice.Avatar} alt="" /> : <span>{selectedVoice?.Name?.slice(0, 1) ?? "音"}</span>}
              </div>
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink)" }}>{selectedVoice?.Name ?? "未选择音色"}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {selectedVoice ? `${selectedVoice.Gender ?? "未知"} ${selectedVoice.Age ?? ""} · ${voiceCategories(selectedVoice)}` : "请选择音色"}
                </div>
              </div>
              <button className="icon-btn" type="button" style={{ marginLeft: "auto" }} onClick={onOpenVoicePicker}>⇄</button>
            </>
          ) : (
            <button className="image-voice-card" type="button" onClick={onOpenVoicePicker}>
              <b>{selectedVoice?.Name ?? "选择音色"}</b>
              <em>{selectedVoice ? `${selectedVoice.Gender ?? "未知"} ${selectedVoice.Age ?? ""} · ${voiceCategories(selectedVoice)}` : "从音色库选择"}</em>
            </button>
          )}
        </Field>
      ) : null}
      {showRateControls && onLoudnessRateChange ? (
        <Field label="音量调整">
          <ControlledSlider
            disabled={!enabled}
            display={rateLabel(loudnessRate)}
            max={100}
            min={-50}
            unit=""
            value={loudnessRate}
            onChange={onLoudnessRateChange}
          />
        </Field>
      ) : null}
      {showRateControls && onSpeechRateChange ? (
        <Field label="语速调整">
          <ControlledSlider
            disabled={!enabled}
            display={rateLabel(speechRate)}
            max={100}
            min={-50}
            unit=""
            value={speechRate}
            onChange={onSpeechRateChange}
          />
        </Field>
      ) : null}
    </Group>
  );
}
