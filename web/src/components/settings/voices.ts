import voiceRaw from "../../../voice.json?raw";

export type VoiceSpeaker = {
  ID: string;
  VoiceType: string;
  ResourceID?: string;
  Name: string;
  Avatar?: string;
  Gender?: string;
  Age?: string;
  Description?: string;
  TrialURL?: string;
  Languages?: Array<{ Language?: string; Text?: string; Flag?: string }>;
  Categories?: Array<{ Categories?: string[] }>;
};

export function loadVoiceSpeakers(): VoiceSpeaker[] {
  try {
    const data = JSON.parse(voiceRaw) as { Result?: { Speakers?: VoiceSpeaker[] } };
    return data.Result?.Speakers ?? [];
  } catch {
    return [];
  }
}

export const VOICE_SPEAKERS = loadVoiceSpeakers();

export function voiceCategoryList(voice: VoiceSpeaker) {
  return voice.Categories?.flatMap((item) => item.Categories ?? []).filter(Boolean) ?? [];
}

export function voiceCategories(voice: VoiceSpeaker) {
  return voiceCategoryList(voice).join(" / ") || "通用场景";
}

export function uniqueOptions(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}
