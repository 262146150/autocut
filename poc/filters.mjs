// filters.mjs — 从逆向文档 01 提取的 FFmpeg 滤镜构造器（忠实还原 ECutAuto 配方）
// 产出可直接用于 -filter_complex 的带标签子图。

/** 去重线性链（doc01 §2）。作用在 split 之前。返回逗号链。 */
export function dedupVideoChain(p) {
  const parts = [];
  if (p.hflip) parts.push("hflip");
  if (p.vflip) parts.push("vflip");
  if (p.cropScale && p.cropScale < 1)
    parts.push(`crop=iw*${p.cropScale.toFixed(4)}:ih*${p.cropScale.toFixed(4)}`);
  parts.push(
    `eq=brightness=${p.brightness.toFixed(4)}:contrast=${p.contrast.toFixed(3)}:saturation=${p.saturation.toFixed(3)}`
  );
  parts.push(`noise=alls=${p.noise}:allf=t`);     // 招牌：逐帧噪点
  parts.push(`vignette=PI/${p.vignette}`);          // 轻暗角
  return parts.join(",");
}

/**
 * 画布适配 / 背景虚化填充（doc01 §1，原样参数）。
 * 从 inLabel 读入，写出到 outLabel。包含完整 split/gblur/overlay 子图。
 */
export function blurFillGraph(inLabel, outLabel, w, h, fps) {
  const [pw, ph] = w >= h ? [320, 180] : [180, 320];
  return [
    `[${inLabel}]split[original][copy]`,
    `[copy]scale=${pw}:${ph}:force_original_aspect_ratio=increase:flags=fast_bilinear,` +
      `gblur=sigma=40,scale=${w}:${h}:flags=fast_bilinear[blurred]`,
    `[original]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[scaled]`,
    `[blurred][scaled]overlay=floor((main_w-overlay_w)/2/2)*2:floor((main_h-overlay_h)/2/2)*2,` +
      `setsar=1,fps=${fps},format=yuv420p,` +
      `setparams=colorspace=bt709:color_trc=bt709:color_primaries=bt709[${outLabel}]`,
  ].join(";");
}

/** 纯黑填充：原图等比缩放居中，其余区域黑底。 */
export function blackFillGraph(inLabel, outLabel, w, h, fps) {
  return [
    `[${inLabel}]scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos[scaled]`,
    `color=c=black:s=${w}x${h}:r=${fps}[blackbg]`,
    `[blackbg][scaled]overlay=floor((main_w-overlay_w)/2/2)*2:floor((main_h-overlay_h)/2/2)*2:shortest=1,` +
      `setsar=1,fps=${fps},format=yuv420p,` +
      `setparams=colorspace=bt709:color_trc=bt709:color_primaries=bt709[${outLabel}]`,
  ].join(";");
}

function escapeDrawtextText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function escapeDrawtextValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:");
}

function normalizeDrawtextColor(value, fallback) {
  const raw = String(value || fallback).trim();
  const shortHex = raw.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return "0x" + shortHex[1].split("").map((c) => c + c).join("");
  }
  const hex = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex) return `0x${hex[1]}`;
  return escapeDrawtextValue(raw || fallback);
}

function charWidthUnit(char) {
  if (/\s/.test(char)) return 0.35;
  if (/[\u0000-\u007f]/.test(char)) return 0.56;
  if (/[\u3000-\u303f\uff00-\uffef]/.test(char)) return 1;
  if (/[\u4e00-\u9fff]/.test(char)) return 1;
  return 0.9;
}

function wrapSubtitleText(value, subtitle) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const fontSize = Math.max(12, Math.min(120, Number(subtitle.fontSize ?? 30)));
  const canvasW = Math.max(320, Number(subtitle.canvasW ?? 1080));
  const maxWidthRatio = Math.max(0.5, Math.min(0.96, Number(subtitle.maxWidthRatio ?? 0.86)));
  const outlineWidth = Math.max(0, Math.min(12, Number(subtitle.outlineWidth ?? 4)));
  const maxUnits = Math.max(4, ((canvasW * maxWidthRatio) - outlineWidth * 4) / fontSize);

  const wrapped = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    let units = 0;
    for (const char of paragraph) {
      const nextUnits = charWidthUnit(char);
      if (line && units + nextUnits > maxUnits) {
        wrapped.push(line.trim());
        line = char.trimStart();
        units = Array.from(line).reduce((sum, c) => sum + charWidthUnit(c), 0);
      } else {
        line += char;
        units += nextUnits;
      }
    }
    if (line.trim()) wrapped.push(line.trim());
  }
  return wrapped.join("\n");
}

/** 字幕/文本叠加。坐标使用百分比，便于和前端拖拽预览共用。 */
function drawtextGraph(inLabel, outLabel, subtitle, rawText, frame = null) {
  const text = escapeDrawtextText(wrapSubtitleText(rawText, subtitle));
  const xPct = Math.max(0, Math.min(100, Number(subtitle.x ?? 50)));
  const yPct = Math.max(0, Math.min(100, Number(subtitle.y ?? 82)));
  const fontSize = Math.max(12, Math.min(120, Number(subtitle.fontSize ?? 30)));
  const opacity = Math.max(0, Math.min(1, Number(subtitle.opacity ?? 1)));
  const outlineWidth = Math.max(0, Math.min(12, Number(subtitle.outlineWidth ?? 4)));
  const fontColor = normalizeDrawtextColor(subtitle.color, "white");
  const outlineColor = normalizeDrawtextColor(subtitle.outlineColor, "black");
  const fontFile = subtitle.fontFile ? `fontfile='${escapeDrawtextValue(subtitle.fontFile)}':` : "";
  const lineSpacing = Math.round(fontSize * 0.16);
  const timing = frame ? `:enable='between(t,${frame.start.toFixed(3)},${frame.end.toFixed(3)})'` : "";
  return `[${inLabel}]drawtext=${fontFile}text='${text}':x='(w-text_w)*${xPct / 100}':y='(h-text_h)*${yPct / 100}':` +
    `fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:borderw=${outlineWidth}:bordercolor=${outlineColor}@${opacity}:` +
    `line_spacing=${lineSpacing}:fix_bounds=1${timing}[${outLabel}]`;
}

function subtitleFrames(subtitle) {
  if (!Array.isArray(subtitle.frames)) return [];
  return subtitle.frames
    .map((frame) => ({
      start: Math.max(0, Number(frame.start ?? 0)),
      end: Math.max(0, Number(frame.end ?? 0)),
      text: String(frame.text ?? "").trim(),
    }))
    .filter((frame) => frame.text && frame.end > frame.start);
}

function hasSubtitlePayload(subtitle) {
  return Boolean(String(subtitle?.text ?? "").trim()) || subtitleFrames(subtitle ?? {}).length > 0;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function colorProcessingParts(processing = {}) {
  const color = processing.color ?? {};
  if (!color.enabled) return [];
  const hue = clampNumber(color.hue, -180, 180, 0);
  const saturation = clampNumber(color.saturation, 0, 300, 100) / 100;
  const brightness = clampNumber(color.brightness, -100, 100, 0) / 200;
  const contrast = clampNumber(color.contrast, 0, 300, 100) / 100;
  const temperature = clampNumber(color.temperature, -100, 100, 0) / 100;
  const sharpen = clampNumber(color.sharpen, 0, 100, 0) / 100;
  const parts = [
    `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`,
  ];
  if (hue !== 0) parts.push(`hue=h=${hue.toFixed(1)}`);
  if (temperature !== 0) {
    const warm = temperature * 0.18;
    const cool = -warm;
    parts.push(`colorbalance=rs=${warm.toFixed(3)}:rm=${(warm * 0.55).toFixed(3)}:bs=${cool.toFixed(3)}:bm=${(cool * 0.55).toFixed(3)}`);
  }
  if (sharpen > 0) parts.push(`unsharp=5:5:${(sharpen * 1.2).toFixed(3)}:5:5:0`);
  return parts;
}

function motionProcessingPart(processing = {}, w, h) {
  const motion = processing.motion ?? {};
  if (!motion.enabled) return "";
  const intensity = clampNumber(motion.intensity, 0, 30, 0) / 100;
  if (intensity <= 0) return "";
  const speed = clampNumber(motion.speed, 0, 100, 50);
  const ratePerFrame = 0.002 + (speed / 100) * 0.01;
  const driftRate = 0.012 + (speed / 100) * 0.05;
  if (motion.mode === "zoomOut") {
    const zoom = `1+${intensity.toFixed(4)}*(1-min(n*${ratePerFrame.toFixed(5)}\\,1))`;
    return `scale=w='trunc(${w}*(${zoom})/2)*2':h='trunc(${h}*(${zoom})/2)*2':eval=frame,crop=${w}:${h}:x='(iw-ow)/2':y='(ih-oh)/2'`;
  }
  if (motion.mode === "drift") {
    const zoom = 1 + intensity;
    const sw = Math.ceil((w * zoom) / 2) * 2;
    const sh = Math.ceil((h * zoom) / 2) * 2;
    return `scale=${sw}:${sh},crop=${w}:${h}:x='(iw-ow)*(0.5+0.5*sin(n*${driftRate.toFixed(5)}))':y='(ih-oh)*(0.5+0.5*cos(n*${(driftRate * 0.73).toFixed(5)}))'`;
  }
  const zoom = `1+${intensity.toFixed(4)}*min(n*${ratePerFrame.toFixed(5)}\\,1)`;
  return `scale=w='trunc(${w}*(${zoom})/2)*2':h='trunc(${h}*(${zoom})/2)*2':eval=frame,crop=${w}:${h}:x='(iw-ow)/2':y='(ih-oh)/2'`;
}

function videoProcessingParts(processing, w, h) {
  if (!processing) return [];
  return [
    ...colorProcessingParts(processing),
    motionProcessingPart(processing, w, h),
  ].filter(Boolean);
}

function videoProcessingGraph(inLabel, outLabel, processing, w, h) {
  const parts = videoProcessingParts(processing, w, h);
  if (!parts.length) return "";
  return `[${inLabel}]${parts.join(",")}[${outLabel}]`;
}

function rectPixels(rect, canvasW, canvasH) {
  const xPct = clampNumber(rect.x, 0, 100, 0);
  const yPct = clampNumber(rect.y, 0, 100, 0);
  const wPct = clampNumber(rect.w, 1, 100, 10);
  const hPct = clampNumber(rect.h, 1, 100, 10);
  const x = Math.max(0, Math.min(canvasW - 2, Math.round((xPct / 100) * canvasW)));
  const y = Math.max(0, Math.min(canvasH - 2, Math.round((yPct / 100) * canvasH)));
  const w = Math.max(2, Math.min(canvasW - x, Math.round((wPct / 100) * canvasW)));
  const h = Math.max(2, Math.min(canvasH - y, Math.round((hPct / 100) * canvasH)));
  return { x, y, w, h };
}

function watermarkRemovalRegions(processing = {}) {
  const removal = processing.watermarkRemoval ?? {};
  if (!removal.enabled || !Array.isArray(removal.regions)) return [];
  return removal.regions.filter((region) => Number(region.w) > 0 && Number(region.h) > 0);
}

function watermarkRemovalGraph(inLabel, outLabel, processing, canvasW, canvasH) {
  const regions = watermarkRemovalRegions(processing);
  const mode = processing.watermarkRemoval?.mode === "pixelate"
    ? "pixelate"
    : processing.watermarkRemoval?.mode === "solid"
      ? "solid"
      : "blur";
  const chains = [];
  let current = inLabel;
  regions.forEach((region, index) => {
    const next = index === regions.length - 1 ? outLabel : `rmv${index}`;
    const { x, y, w, h } = rectPixels(region, canvasW, canvasH);
    if (mode === "solid") {
      chains.push(`[${current}]drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black@1:t=fill[${next}]`);
    } else {
      const base = `rmb${index}`;
      const cropSource = `rms${index}`;
      const patch = `rmp${index}`;
      const filter = mode === "pixelate"
        ? `crop=${w}:${h}:${x}:${y},scale=${Math.max(2, Math.round(w / 14))}:${Math.max(2, Math.round(h / 14))}:flags=neighbor,scale=${w}:${h}:flags=neighbor`
        : `crop=${w}:${h}:${x}:${y},boxblur=18:1`;
      chains.push(`[${current}]split[${base}][${cropSource}]`);
      chains.push(`[${cropSource}]${filter}[${patch}]`);
      chains.push(`[${base}][${patch}]overlay=${x}:${y}[${next}]`);
    }
    current = next;
  });
  return chains.join(";");
}

function hasWatermarkOverlay(processing = {}, options = {}) {
  const overlay = processing.watermarkOverlay ?? {};
  return Boolean(overlay.enabled && overlay.path && options.watermarkInputLabel);
}

function watermarkOverlayGraph(inLabel, outLabel, processing, inputLabel, canvasW, canvasH) {
  const overlay = processing.watermarkOverlay ?? {};
  const { x, y, w, h } = rectPixels(overlay.rect ?? {}, canvasW, canvasH);
  const opacity = clampNumber(overlay.opacity, 0, 100, 80) / 100;
  return [
    `[${inputLabel}]scale=${w}:${h}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[wmv]`,
    `[${inLabel}][wmv]overlay=${x}:${y}:shortest=1[${outLabel}]`,
  ].join(";");
}

export function subtitleGraph(inLabel, outLabel, subtitle) {
  const drawSubtitle = { ...subtitle, maxWidthRatio: subtitle.maxWidthRatio ?? 0.86 };
  const frames = subtitleFrames(drawSubtitle);
  if (!frames.length) return drawtextGraph(inLabel, outLabel, drawSubtitle, drawSubtitle.text);
  const chains = [];
  let current = inLabel;
  frames.forEach((frame, index) => {
    const next = index === frames.length - 1 ? outLabel : `subv${index}`;
    chains.push(drawtextGraph(current, next, drawSubtitle, frame.text, frame));
    current = next;
  });
  return chains.join(";");
}

/** 音频链：变速 + 统一格式（doc01 §10）。 */
export function audioGraph(inLabel, outLabel, p, options = {}) {
  const parts = [`aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`];
  const volume = Number.isFinite(options.videoVolume) ? Math.max(0, options.videoVolume / 100) : 1;
  if (volume !== 1) parts.push(`volume=${volume.toFixed(3)}`);
  if (p.tempo && p.tempo !== 1) parts.push(`atempo=${p.tempo.toFixed(3)}`);
  parts.push(`asetpts=PTS-STARTPTS`);
  return `[${inLabel}]${parts.join(",")}[${outLabel}]`;
}

export function bgmAudioGraph(inLabel, outLabel, options = {}) {
  const volume = Number.isFinite(options.bgmVolume) ? Math.max(0, options.bgmVolume / 100) : 0.3;
  return `[${inLabel}]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
    `volume=${volume.toFixed(3)},asetpts=PTS-STARTPTS[${outLabel}]`;
}

/**
 * 组装单个素材的完整 filter_complex：去重 → 画布虚化 → 收尾，外加音频链。
 * 返回 { filter, vmap, amap }，配合 ffmpeg -filter_complex 使用。
 */
export function buildClipFilterComplex(p, w, h, fps, hasAudio, options = {}) {
  const chains = [];
  chains.push(`[0:v]${dedupVideoChain(p)}[pre]`);          // 去重
  const subtitle = hasSubtitlePayload(options.subtitle) ? options.subtitle : null;
  const textOverlays = Array.isArray(options.textOverlays)
    ? options.textOverlays.filter((overlay) => hasSubtitlePayload(overlay))
    : [];
  const drawableOverlays = [
    ...(subtitle ? [subtitle] : []),
    ...textOverlays,
  ].map((overlay) => ({ ...overlay, canvasW: w, canvasH: h }));
  const processingParts = videoProcessingParts(options.videoProcessing, w, h);
  const hasVideoProcessing = processingParts.length > 0;
  const hasRemoval = watermarkRemovalRegions(options.videoProcessing).length > 0;
  const hasOverlay = hasWatermarkOverlay(options.videoProcessing, options);
  const postStepCount = (hasVideoProcessing ? 1 : 0) + (hasRemoval ? 1 : 0) + (hasOverlay ? 1 : 0) + drawableOverlays.length;
  const canvasOut = postStepCount ? "canvasv" : "outv";
  const fillMode = options.fillMode === "black" ? "black" : "blur";
  chains.push(fillMode === "black"
    ? blackFillGraph("pre", canvasOut, w, h, fps)
    : blurFillGraph("pre", canvasOut, w, h, fps));     // 画布
  let currentVideo = canvasOut;
  let completedSteps = 0;
  const nextVideoLabel = () => {
    completedSteps += 1;
    return completedSteps === postStepCount ? "outv" : `postv${completedSteps}`;
  };
  if (hasVideoProcessing) {
    const processedOut = nextVideoLabel();
    chains.push(`[${currentVideo}]${processingParts.join(",")}[${processedOut}]`);
    currentVideo = processedOut;
  }
  if (hasRemoval) {
    const removedOut = nextVideoLabel();
    chains.push(watermarkRemovalGraph(currentVideo, removedOut, options.videoProcessing, w, h));
    currentVideo = removedOut;
  }
  if (hasOverlay) {
    const watermarkedOut = nextVideoLabel();
    chains.push(watermarkOverlayGraph(currentVideo, watermarkedOut, options.videoProcessing, options.watermarkInputLabel, w, h));
    currentVideo = watermarkedOut;
  }
  drawableOverlays.forEach((overlay, index) => {
    const nextVideo = nextVideoLabel();
    chains.push(subtitleGraph(currentVideo, nextVideo, overlay));
    currentVideo = nextVideo;
  });
  let amap = null;
  if (hasAudio) {
    const hasBgm = Boolean(options.bgmInputLabel);
    chains.push(audioGraph(options.audioInputLabel ?? "0:a", hasBgm ? "maina" : "outa", p, options));
    if (hasBgm) {
      chains.push(bgmAudioGraph(options.bgmInputLabel, "bgma", options));
      chains.push("[maina][bgma]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]");
    }
    amap = "[outa]";
  }
  return { filter: chains.join(";"), vmap: "[outv]", amap };
}
