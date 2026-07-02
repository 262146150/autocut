import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { FFMPEG, probeDuration, run } from "../poc/pipeline.mjs";
import { subtitleGraph } from "../poc/filters.mjs";

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function encodeArgs(quality = "high") {
  const presets = {
    standard: { preset: "veryfast", crf: "23" },
    high: { preset: "fast", crf: "20" },
    best: { preset: "medium", crf: "18" },
  };
  const resolved = presets[quality] ?? presets.high;
  return ["-c:v", "libx264", "-preset", resolved.preset, "-crf", resolved.crf];
}

function imageSceneFilter({ w, h, fps, durationSec, fillMode, motionMode, fade }) {
  const duration = Math.max(0.5, Number(durationSec) || 3);
  const base = fillMode === "black"
    ? `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const progress = `min(max(t/${duration.toFixed(3)}\\,0)\\,1)`;
  let motion = "";
  if (motionMode === "zoomOut") {
    motion = `scale=w='trunc(iw*(1.08-0.08*${progress})/2)*2':h='trunc(ih*(1.08-0.08*${progress})/2)*2':eval=frame,crop=${w}:${h}:x='(iw-ow)/2':y='(ih-oh)/2'`;
  } else if (motionMode === "drift") {
    motion = `scale=${Math.ceil(w * 1.1 / 2) * 2}:${Math.ceil(h * 1.1 / 2) * 2},crop=${w}:${h}:x='(iw-ow)*(0.5+0.5*sin(t*0.55))':y='(ih-oh)*(0.5+0.5*cos(t*0.41))'`;
  } else {
    motion = `scale=w='trunc(iw*(1+0.08*${progress})/2)*2':h='trunc(ih*(1+0.08*${progress})/2)*2':eval=frame,crop=${w}:${h}:x='(iw-ow)/2':y='(ih-oh)/2'`;
  }
  const fadeDur = fade ? Math.min(0.35, duration / 4) : 0;
  const fadeParts = fadeDur > 0
    ? [`fade=t=in:st=0:d=${fadeDur.toFixed(2)}`, `fade=t=out:st=${Math.max(0, duration - fadeDur).toFixed(2)}:d=${fadeDur.toFixed(2)}`]
    : [];
  return [base, motion, ...fadeParts, `fps=${fps}`, "setsar=1", "format=yuv420p"].join(",");
}

async function makeImageSegment(image, output, options) {
  const { durationSec, w, h, fps } = options;
  const filter = imageSceneFilter(options);
  await run(FFMPEG, [
    "-y",
    "-loop", "1",
    "-t", String(durationSec),
    "-i", image,
    "-f", "lavfi",
    "-t", String(durationSec),
    "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-vf", filter,
    "-map", "0:v",
    "-map", "1:a",
    ...encodeArgs(options.exportQuality),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ac", "2",
    "-ar", "48000",
    "-shortest",
    "-f", "mpegts",
    output,
  ]);
}

async function applySubtitle(input, output, subtitle, w, h, fps, exportQuality) {
  const filter = subtitleGraph("0:v", "outv", { ...subtitle, canvasW: w, canvasH: h });
  await run(FFMPEG, [
    "-y",
    "-i", input,
    "-filter_complex", filter,
    "-map", "[outv]",
    "-map", "0:a?",
    ...encodeArgs(exportQuality),
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
}

async function muxAudio(input, output, options = {}) {
  const audioPath = String(options.audioPath || "");
  const bgmPath = String(options.bgmPath || "");
  const voiceVolume = Math.max(0, Number(options.voiceVolume ?? 100) / 100);
  const bgmVolume = Math.max(0, Number(options.bgmVolume ?? 30) / 100);
  if (audioPath && bgmPath) {
    const filter = [
      `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${voiceVolume.toFixed(3)},asetpts=PTS-STARTPTS[voicea]`,
      `[2:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${bgmVolume.toFixed(3)},asetpts=PTS-STARTPTS[bgma]`,
      "[voicea][bgma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
    ].join(";");
    await run(FFMPEG, [
      "-y", "-i", input, "-i", audioPath, "-stream_loop", "-1", "-i", bgmPath,
      "-filter_complex", filter,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      "-ar", "48000",
      "-movflags", "+faststart",
      "-shortest",
      output,
    ]);
    return;
  }
  if (audioPath) {
    await run(FFMPEG, [
      "-y", "-i", input, "-i", audioPath,
      "-filter_complex", `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${voiceVolume.toFixed(3)},asetpts=PTS-STARTPTS[aout]`,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      "-ar", "48000",
      "-movflags", "+faststart",
      "-shortest",
      output,
    ]);
    return;
  }
  if (bgmPath) {
    await run(FFMPEG, [
      "-y", "-i", input, "-stream_loop", "-1", "-i", bgmPath,
      "-filter_complex", `[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${bgmVolume.toFixed(3)},asetpts=PTS-STARTPTS[bgma]`,
      "-map", "0:v",
      "-map", "[bgma]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      "-ar", "48000",
      "-movflags", "+faststart",
      "-shortest",
      output,
    ]);
    return;
  }
  await run(FFMPEG, ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output]);
}

export async function runImageVideo({
  images,
  output,
  workDir,
  w,
  h,
  fps = 30,
  durationSec = 0,
  sceneDurationSec = 3,
  fillMode = "blur",
  motionMode = "zoomIn",
  transition = "fade",
  finalSubtitle = null,
  audioPath = "",
  bgmEnabled = false,
  bgmPath = "",
  bgmVolume = 30,
  voiceVolume = 100,
  exportQuality = "high",
  onEvent = () => {},
}) {
  if (!Array.isArray(images) || !images.length) throw new Error("没有可用图片素材");
  if (audioPath && !existsSync(audioPath)) throw new Error("音频文件不存在");
  if (bgmEnabled && bgmPath && !existsSync(bgmPath)) throw new Error("背景音乐文件不存在");
  await mkdir(workDir, { recursive: true });
  const targetDuration = durationSec > 0 ? durationSec : Math.max(1, images.length) * sceneDurationSec;
  const perScene = Math.max(0.8, targetDuration / images.length);
  const segments = [];
  for (let i = 0; i < images.length; i++) {
    const seg = path.join(workDir, `image_${String(i + 1).padStart(3, "0")}.ts`);
    await makeImageSegment(images[i], seg, {
      durationSec: perScene,
      w,
      h,
      fps,
      fillMode,
      motionMode,
      fade: transition === "fade",
      exportQuality,
    });
    segments.push(seg);
    onEvent({ type: "image_done", index: i + 1, total: images.length, path: images[i] });
  }
  const listFile = path.join(workDir, "concat_list.txt");
  await writeFile(listFile, segments.map((file) => `file '${file}'`).join("\n"));
  const joined = path.join(workDir, "joined.mp4");
  await run(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", joined]);
  let videoForAudio = joined;
  if (finalSubtitle?.text || finalSubtitle?.frames?.length) {
    const subtitled = path.join(workDir, "subtitled.mp4");
    await applySubtitle(joined, subtitled, finalSubtitle, w, h, fps, exportQuality);
    videoForAudio = subtitled;
  }
  await muxAudio(videoForAudio, output, {
    audioPath,
    bgmPath: bgmEnabled ? bgmPath : "",
    bgmVolume,
    voiceVolume,
  });
  return output;
}

export async function audioDuration(file) {
  return file ? await probeDuration(file) : 0;
}

export function normalizeSceneDuration(value) {
  return clamp(value, 1, 12, 3);
}
