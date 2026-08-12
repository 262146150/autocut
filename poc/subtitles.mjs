import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { recognizeClipWithWhisper } from "./asr.mjs";
import { parseSrt, subtitleTextFromFrames } from "./srt.mjs";

const DEFAULT_STYLE = {
  x: 50,
  y: 82,
  fontSize: 30,
  opacity: 1,
  outlineWidth: 4,
  maxWidthRatio: 0.82,
  color: "white",
  outlineColor: "black",
};

async function loadSidecarSubtitle(input) {
  const ext = path.extname(input);
  const base = input.slice(0, ext ? -ext.length : undefined);
  const candidates = [".srt", ".SRT", ".txt", ".TXT"].map((suffix) => `${base}${suffix}`);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = (await readFile(file, "utf8")).trim();
    if (!text) continue;
    if (path.extname(file).toLowerCase() === ".srt") {
      const frames = parseSrt(text);
      if (frames.length) return { text: subtitleTextFromFrames(frames), frames };
      continue;
    }
    return { text };
  }
  return null;
}

export async function resolveSubtitleForClip(input, options = {}) {
  if (options.subtitleMode === "auto") {
    const sidecar = await loadSidecarSubtitle(input);
    const recognized = sidecar ?? await recognizeClipWithWhisper(input, options);
    return {
      ...DEFAULT_STYLE,
      ...(options.subtitleStyle ?? {}),
      ...recognized,
      stripPunctuation: true,
      maxWidthRatio: Number(options.subtitleStyle?.maxWidthRatio) || DEFAULT_STYLE.maxWidthRatio,
    };
  }
  if (options.subtitle?.text || options.subtitle?.frames?.length) {
    return { ...DEFAULT_STYLE, ...options.subtitle };
  }
  return null;
}
