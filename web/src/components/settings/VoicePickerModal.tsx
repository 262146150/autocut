import { useRef, useState } from "react";
import { uniqueOptions, voiceCategories, voiceCategoryList, type VoiceSpeaker } from "./voices";

export function VoicePickerModal({
  voices,
  selectedVoiceType,
  onSelect,
  onClose,
}: {
  voices: VoiceSpeaker[];
  selectedVoiceType: string;
  onSelect: (voice: VoiceSpeaker) => void;
  onClose: () => void;
}) {
  const [genderFilter, setGenderFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [playingVoiceType, setPlayingVoiceType] = useState("");
  const trialAudioRef = useRef<HTMLAudioElement | null>(null);
  const genders = uniqueOptions(voices.map((voice) => voice.Gender));
  const ages = uniqueOptions(voices.map((voice) => voice.Age));
  const categories = uniqueOptions(voices.flatMap((voice) => voiceCategoryList(voice)));
  const filtered = voices.filter((voice) => {
    if (genderFilter && voice.Gender !== genderFilter) return false;
    if (ageFilter && voice.Age !== ageFilter) return false;
    if (categoryFilter && !voiceCategoryList(voice).includes(categoryFilter)) return false;
    return true;
  });

  const close = () => {
    trialAudioRef.current?.pause();
    onClose();
  };

  const playTrial = (voice: VoiceSpeaker) => {
    if (!voice.TrialURL) return;
    trialAudioRef.current?.pause();
    trialAudioRef.current = new Audio(voice.TrialURL);
    setPlayingVoiceType(voice.VoiceType);
    trialAudioRef.current.onended = () => setPlayingVoiceType("");
    trialAudioRef.current.onpause = () => setPlayingVoiceType("");
    trialAudioRef.current.play().catch(() => undefined);
  };

  const renderChips = (label: string, values: string[], selected: string, setSelected: (value: string) => void) => (
    <div className="voice-filter-row">
      <span>{label}</span>
      <div className="voice-filter-chips">
        <button className={!selected ? "active" : ""} type="button" onClick={() => setSelected("")}>全部</button>
        {values.map((value) => (
          <button className={selected === value ? "active" : ""} key={value} type="button" onClick={() => setSelected(value)}>{value}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="voice-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="voice-modal-h">
          <div>
            <b>选择音色</b>
            <span className="muted">匹配 {filtered.length} / {voices.length} 个音色</span>
          </div>
          <button className="icon-btn" type="button" onClick={close}>×</button>
        </div>
        <div className="voice-filters">
          {renderChips("性别", genders, genderFilter, setGenderFilter)}
          {renderChips("年龄", ages, ageFilter, setAgeFilter)}
          {renderChips("分类", categories, categoryFilter, setCategoryFilter)}
        </div>
        <div className="voice-grid">
          {filtered.map((voice) => (
            <div
              className={`voice-card ${voice.VoiceType === selectedVoiceType ? "active" : ""}`}
              key={voice.ID || voice.VoiceType}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(voice)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(voice);
              }}
            >
              <div className="voice-card-avatar">
                {voice.Avatar ? <img src={voice.Avatar} alt="" /> : <span>{voice.Name.slice(0, 1)}</span>}
              </div>
              <div className="voice-card-main">
                <div className="voice-card-name">{voice.Name}</div>
                <div className="muted">{voice.Gender ?? "未知"} {voice.Age ?? ""} · {voiceCategories(voice)}</div>
                <p>{voice.Description || voice.Languages?.[0]?.Text || "暂无描述"}</p>
              </div>
              <button
                className="mini-chip"
                disabled={!voice.TrialURL}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  playTrial(voice);
                }}
              >
                {playingVoiceType === voice.VoiceType ? "播放中" : "试听"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
