import { useState } from "react";
import type { ModuleDef } from "../data/modules";
import {
  generateImageVideo,
  inspectImageMaterials,
  rewriteCopy,
  saveImageAnnotation,
  type ImageAnnotation,
  type ImageVideoEvent,
  type ImageMaterialItem,
  type MaterialLibraryItem,
  type MaterialLibraryRoot,
  type SmartMatchItem,
  type SubtitleStyleParams,
} from "../api";
import { ExportTaskDrawer, type ExportTaskItem } from "../components/ExportTaskDrawer";
import { MaterialSourcePicker } from "../components/MaterialSourcePicker";
import {
  BgmSettings,
  CanvasToolbar,
  ExportQualitySettings,
  MotionSettings,
  OutputSettings,
  SmartMatchSettings,
  SubtitlePreviewOverlay,
  SUBTITLE_FONTS,
  TextSubtitleStyleSettings,
  VOICE_SPEAKERS,
  VoicePickerModal,
  VoiceSynthesisSettings,
  type AspectRatio,
  type ExportQuality,
  type FillMode,
  type Resolution,
} from "../components/settings";

type ImageMode = "copy" | "audio";

const DEFAULT_SUBTITLE: SubtitleStyleParams = {
  x: 50,
  y: 82,
  fontSize: 44,
  fontFamily: "PingFang SC",
  fontFile: "/System/Library/Fonts/PingFang.ttc",
  opacity: 1,
  outlineWidth: 0,
  color: "#ffffff",
  outlineColor: "#111111",
};

function basename(filePath: string) {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function canvasFor(aspect: AspectRatio, resolution: Resolution) {
  if (aspect === "16:9") return resolution === "720p" ? "1280x720" : "1920x1080";
  return resolution === "720p" ? "720x1280" : "1080x1920";
}

function imageItems(root: MaterialLibraryRoot | null): MaterialLibraryItem[] {
  return root?.items.filter((item) => item.kind === "image") ?? [];
}

function normalizeRootImages(root: MaterialLibraryRoot): ImageMaterialItem[] {
  return imageItems(root).map((item) => ({
    name: item.name,
    path: item.path,
    url: item.url,
    width: item.width,
    height: item.height,
    orientation: item.orientation === "audio" ? "unknown" : item.orientation,
    annotation: item.annotation ?? null,
  }));
}

function publicMessage(message: string) {
  if (/失败|错误|不存在|不足|请选择|请先|无法/.test(message)) return message;
  if (/配音|语音/.test(message)) return "正在生成配音";
  if (/索引|匹配|ONNX|模型|engine|引擎/i.test(message)) return "正在分析图片并匹配文案";
  return message;
}

function matchMeta(matches: SmartMatchItem[]) {
  if (!matches.length) return "暂无匹配结果";
  return matches.slice(0, 3).map((item) => `${item.name} ${Math.round(item.score * 100)}%`).join(" · ");
}

function previewSubtitleText(mode: ImageMode, copyText: string, audioText: string) {
  const source = subtitleDisplayText(mode === "copy" ? copyText : audioText);
  if (!source) return "字幕样式预览";
  const firstSentence = source.split(/[。！？!?；;]/u).find(Boolean)?.trim() || source;
  return firstSentence.length > 42 ? `${firstSentence.slice(0, 42)}...` : firstSentence;
}

function subtitleDisplayText(value: string) {
  return String(value || "")
    .replace(/[，。！？、；：“”‘’（）《》【】…,.!?;:"'()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function annotationFilled(annotation?: ImageAnnotation | null) {
  return Boolean(annotation && [annotation.keywords, annotation.description, annotation.usageHint].some((item) => item.trim()));
}

function annotationSummary(annotation?: ImageAnnotation | null) {
  if (!annotationFilled(annotation)) return "";
  return annotation?.keywords || annotation?.description || annotation?.usageHint || "";
}

export default function ImageToVideo({ mod }: { mod: ModuleDef }) {
  const [sourcePath, setSourcePath] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceImages, setSourceImages] = useState<ImageMaterialItem[]>([]);
  const [selectedImagePath, setSelectedImagePath] = useState("");
  const [sourceRoot, setSourceRoot] = useState<MaterialLibraryRoot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<ImageMode>("copy");
  const [copyText, setCopyText] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [audioText, setAudioText] = useState("");
  const [variants, setVariants] = useState(1);
  const [imageCount, setImageCount] = useState(0);
  const [sceneDuration, setSceneDuration] = useState(3);
  const [allowReuse, setAllowReuse] = useState(true);
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const [resolution, setResolution] = useState<Resolution>("1080p");
  const [fillMode, setFillMode] = useState<FillMode>("blur");
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleFontIndex, setSubtitleFontIndex] = useState(0);
  const [subtitleFontSize, setSubtitleFontSize] = useState(44);
  const [subtitleOpacity, setSubtitleOpacity] = useState(100);
  const [subtitleOutlineWidth, setSubtitleOutlineWidth] = useState(0);
  const [subtitleColor, setSubtitleColor] = useState("#ffffff");
  const [subtitleOutlineColor, setSubtitleOutlineColor] = useState("#111111");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [selectedVoiceType, setSelectedVoiceType] = useState(VOICE_SPEAKERS[0]?.VoiceType ?? "");
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [copyVoiceSpeechRate, setCopyVoiceSpeechRate] = useState(0);
  const [copyVoiceLoudnessRate, setCopyVoiceLoudnessRate] = useState(0);
  const [bgmEnabled, setBgmEnabled] = useState(false);
  const [bgmPath, setBgmPath] = useState("");
  const [bgmVolume, setBgmVolume] = useState(30);
  const [exportQuality, setExportQuality] = useState<ExportQuality>("high");
  const [smartRerank, setSmartRerank] = useState(false);
  const [status, setStatus] = useState("请选择图片素材来源");
  const [running, setRunning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportDir, setExportDir] = useState("");
  const [manifest, setManifest] = useState("");
  const [taskItems, setTaskItems] = useState<ExportTaskItem[]>([]);
  const [selectedOutputUrl, setSelectedOutputUrl] = useState("");
  const [matches, setMatches] = useState<SmartMatchItem[]>([]);
  const [rewriting, setRewriting] = useState(false);
  const [annotationsByPath, setAnnotationsByPath] = useState<Record<string, ImageAnnotation>>({});
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationPath, setAnnotationPath] = useState("");
  const [annotationKeywords, setAnnotationKeywords] = useState("");
  const [annotationDescription, setAnnotationDescription] = useState("");
  const [annotationUsageHint, setAnnotationUsageHint] = useState("");
  const [annotationSaving, setAnnotationSaving] = useState(false);

  const canvas = canvasFor(aspect, resolution);
  const selectedVoice = VOICE_SPEAKERS.find((voice) => voice.VoiceType === selectedVoiceType) ?? VOICE_SPEAKERS[0] ?? null;
  const subtitleFont = SUBTITLE_FONTS[subtitleFontIndex] ?? SUBTITLE_FONTS[0];
  const subtitleStyle: SubtitleStyleParams = {
    ...DEFAULT_SUBTITLE,
    fontSize: subtitleFontSize,
    fontFamily: subtitleFont.family,
    fontFile: subtitleFont.file,
    opacity: subtitleOpacity / 100,
    outlineWidth: subtitleOutlineWidth,
    color: subtitleColor,
    outlineColor: subtitleOutlineColor,
  };
  const previewSubtitle = previewSubtitleText(mode, copyText, audioText);
  const currentSubtitleText = mode === "copy" ? copyText : audioText;
  const setCurrentSubtitleText = mode === "copy" ? setCopyText : setAudioText;
  const annotatedCount = sourceImages.filter((image) => annotationFilled(annotationsByPath[image.path] ?? image.annotation)).length;
  const canGenerate = Boolean(sourcePath.trim()) && !running && (
    mode === "copy" ? Boolean(copyText.trim()) : Boolean(audioPath.trim())
  );

  const applySourceImages = (images: ImageMaterialItem[]) => {
    setSourceImages(images);
    const nextAnnotations: Record<string, ImageAnnotation> = {};
    for (const image of images) {
      if (image.annotation) nextAnnotations[image.path] = image.annotation;
    }
    setAnnotationsByPath(nextAnnotations);
  };

  const chooseRoot = (root: MaterialLibraryRoot) => {
    const nextImages = normalizeRootImages(root);
    setSourceRoot(root);
    setSourcePath(root.path);
    setSourceName(root.name);
    applySourceImages(nextImages);
    setSelectedImagePath(nextImages[0]?.path ?? "");
    setPickerOpen(false);
    const count = root.imageCount ?? nextImages.length;
    setStatus(`已选择 ${count} 张图片`);
    setTaskItems([]);
    setMatches([]);
  };

  const importManual = async () => {
    const next = prompt("输入图片素材文件夹或单张图片路径", sourcePath);
    if (next === null) return;
    const value = next.trim();
    if (!value) return;
    setStatus("正在读取图片素材…");
    setSourcePath(value);
    setSourceName(basename(value));
    setSourceRoot(null);
    applySourceImages([]);
    setSelectedImagePath("");
    setTaskItems([]);
    setMatches([]);
    try {
      const info = await inspectImageMaterials(value);
      setSourceName(info.name || basename(value));
      applySourceImages(info.images);
      setSelectedImagePath(info.images[0]?.path ?? "");
      setStatus(`已导入 ${info.count} 张图片`);
    } catch (err) {
      setStatus("导入失败：" + (err as Error).message);
    }
  };

  const chooseAudio = () => {
    const next = prompt("输入音频文件路径", audioPath);
    if (next === null) return;
    setAudioPath(next.trim());
  };

  const chooseBgm = () => {
    const next = prompt("输入背景音乐文件路径", bgmPath);
    if (next === null) return;
    const value = next.trim();
    setBgmPath(value);
    if (value) setBgmEnabled(true);
  };

  const clearWorkspace = () => {
    setSourcePath("");
    setSourceName("");
    applySourceImages([]);
    setSelectedImagePath("");
    setSourceRoot(null);
    setCopyText("");
    setAudioPath("");
    setAudioText("");
    setStatus("请选择图片素材来源");
    setTaskItems([]);
    setSelectedOutputUrl("");
    setMatches([]);
    setExportDir("");
    setManifest("");
    setProgress(0);
  };

  const rewriteCurrentText = async () => {
    const source = currentSubtitleText.trim();
    if (!source) {
      setStatus(mode === "copy" ? "请先输入文案" : "请先填写音频对应文案");
      return;
    }
    if (rewriting) return;
    setRewriting(true);
    setStatus("AI改写中…");
    try {
      const rewritten = await rewriteCopy(source);
      setCurrentSubtitleText(rewritten);
      setStatus("AI改写完成");
    } catch (err) {
      setStatus("AI改写失败：" + (err as Error).message);
    } finally {
      setRewriting(false);
    }
  };

  const loadAnnotationForm = (path: string) => {
    const current = annotationsByPath[path] ?? sourceImages.find((image) => image.path === path)?.annotation ?? null;
    setAnnotationPath(path);
    setAnnotationKeywords(current?.keywords ?? "");
    setAnnotationDescription(current?.description ?? "");
    setAnnotationUsageHint(current?.usageHint ?? "");
  };

  const openAnnotations = () => {
    const first = selectedImagePath || sourceImages[0]?.path || "";
    if (!first) {
      setStatus("请先导入图片素材");
      return;
    }
    loadAnnotationForm(first);
    setAnnotationOpen(true);
  };

  const persistAnnotation = async (goNext = false) => {
    if (!annotationPath || annotationSaving) return;
    setAnnotationSaving(true);
    try {
      const saved = await saveImageAnnotation({
        path: annotationPath,
        keywords: annotationKeywords,
        description: annotationDescription,
        usageHint: annotationUsageHint,
      });
      setAnnotationsByPath((current) => ({ ...current, [saved.path]: saved }));
      setSourceImages((images) => images.map((image) => image.path === saved.path ? { ...image, annotation: saved } : image));
      setStatus("图片描述已保存，生成时会优先参与匹配");
      if (goNext) {
        const index = sourceImages.findIndex((image) => image.path === saved.path);
        const next = sourceImages[index + 1] ?? null;
        if (next) {
          setSelectedImagePath(next.path);
          const current = annotationsByPath[next.path] ?? next.annotation ?? null;
          setAnnotationPath(next.path);
          setAnnotationKeywords(current?.keywords ?? "");
          setAnnotationDescription(current?.description ?? "");
          setAnnotationUsageHint(current?.usageHint ?? "");
        }
      }
    } catch (err) {
      setStatus("保存图片描述失败：" + (err as Error).message);
    } finally {
      setAnnotationSaving(false);
    }
  };

  const openConfirm = () => {
    if (!canGenerate) {
      setStatus(mode === "copy" ? "请先选择图片素材并填写文案" : "请先选择图片素材并添加音频");
      return;
    }
    setDrawerOpen(true);
    setProgress(0);
    setTaskItems([]);
    setSelectedOutputUrl("");
    setExportDir("");
    setManifest("");
  };

  const startGenerate = async () => {
    if (!canGenerate || running) return;
    setRunning(true);
    setProgress(1);
    setStatus("准备生成图片视频");
    setTaskItems([]);
    setSelectedOutputUrl("");
    setMatches([]);
    try {
      await generateImageVideo({
        inputs: sourcePath,
        canvas,
        fillMode,
        fps: 30,
        mode,
        copyItems: mode === "copy" ? [{ id: "copy-1", text: copyText }] : [],
        audioItems: mode === "audio" ? [{ id: "audio-1", path: audioPath, text: audioText, name: basename(audioPath) }] : [],
        variants,
        imageCount,
        sceneDurationSec: sceneDuration,
        allowImageReuse: allowReuse,
        motionMode: "none",
        transition: "none",
        subtitleEnabled,
        subtitleStyle,
        voiceEnabled,
        copyVoiceSpeechRate,
        copyVoiceLoudnessRate,
        voice: selectedVoice ? {
          speaker: selectedVoice.VoiceType,
          resourceId: selectedVoice.ResourceID,
          name: selectedVoice.Name,
        } : null,
        bgmEnabled,
        bgmPath,
        bgmVolume,
        exportQuality,
        smartRerank,
        smartRerankTopK: 24,
      }, (event: ImageVideoEvent) => {
        if (event.type === "start") {
          setStatus(`开始处理 ${event.images} 张图片`);
          setProgress(5);
        } else if (event.type === "log") {
          setStatus(publicMessage(event.msg));
        } else if (event.type === "image_index") {
          setStatus(`图片分析完成：${event.indexedImages} 张`);
          setProgress(18);
        } else if (event.type === "image_match") {
          setMatches(event.matches);
          setStatus("已匹配图片：" + matchMeta(event.matches));
          setProgress(32);
        } else if (event.type === "image_done") {
          setStatus(`正在生成画面 ${event.index}/${event.total}`);
          setProgress((old) => Math.max(old, Math.min(88, 32 + Math.round((event.index / Math.max(1, event.total)) * 45))));
        } else if (event.type === "output_done") {
          const url = `/api/media?path=${encodeURIComponent(event.path)}`;
          setSelectedOutputUrl((current) => current || url);
          setTaskItems((items) => [...items, {
            id: `image-video-${event.output}`,
            name: basename(event.path),
            status: "done",
            path: event.path,
            url,
            meta: `${event.output}/${event.total}`,
          }]);
          setProgress(Math.min(96, 80 + Math.round((event.output / Math.max(1, event.total)) * 16)));
        } else if (event.type === "done") {
          setExportDir(event.exportDir ?? "");
          setManifest(event.manifest ?? "");
          setStatus(`生成完成，共 ${event.outputs.length} 个视频`);
          setProgress(100);
        } else if (event.type === "error") {
          setStatus("生成失败：" + event.msg);
        }
      });
    } catch (err) {
      setStatus("生成失败：" + (err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modwrap image-video-wrap">
      <div className="modbar">
        <div className="mod-title">
          <b>{mod.name}</b>
          <span>文案/音频匹配图片 · 自动运镜成片</span>
        </div>
      </div>

      <div className="image-video-page">
        <section className="image-video-left box">
          <div className="box-h">
            <button className="import-btn" type="button" onClick={importManual}>导入图片</button>
            <button className="icon-btn text-btn" type="button" onClick={() => setPickerOpen(true)}>素材仓库</button>
            <button className="icon-btn text-btn" type="button" onClick={openAnnotations} disabled={!sourceImages.length}>描述图片</button>
            <button className="icon-btn text-btn" type="button" onClick={clearWorkspace} disabled={running || (!sourcePath && !copyText && !audioPath)}>清空</button>
          </div>
          {!sourcePath ? (
            <div className="empty">
              <div className="t">暂无图片来源</div>
              <div className="s">选择图片文件夹，或从素材仓库选择图片素材源</div>
            </div>
          ) : (
            <div className="folder-tree">
              <div className="folder-row">
                <button className="folder-open" type="button">⌄</button>
                <strong title={sourceName || sourcePath}>{sourceName || basename(sourcePath)}</strong>
                <span className="folder-count">{sourceImages.length || "…"}</span>
              </div>
              {sourceImages.length ? (
                <div className="image-annotation-stat">
                  <span>{annotatedCount} 张已描述</span>
                  <button type="button" onClick={openAnnotations}>继续描述</button>
                </div>
              ) : null}
              <div className="clip-list">
                {!sourceImages.length ? (
                  <div className="clip-row muted">正在读取图片素材…</div>
                ) : (
                  sourceImages.map((image) => {
                    const annotation = annotationsByPath[image.path] ?? image.annotation;
                    return (
                      <button
                        className={`clip-row ${selectedImagePath === image.path ? "active" : ""} ${annotationFilled(annotation) ? "has-annotation" : ""}`}
                        key={image.path}
                        title={annotationSummary(annotation) || image.name}
                        type="button"
                        onClick={() => setSelectedImagePath(image.path)}
                        onDoubleClick={openAnnotations}
                      >
                        <span>{annotationFilled(annotation) ? "标" : "▣"}</span>
                        <b>{image.name}</b>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="folder-path">{sourcePath}</div>
            </div>
          )}
        </section>

        <section className="image-video-main">
          <CanvasToolbar
            aspect={aspect}
            fillMode={fillMode}
            onAspectChange={setAspect}
            onFillModeChange={setFillMode}
          />
          <div className="preview image-video-preview">
            <div className={`preview-stage ratio-${aspect.replace(":", "-")} fill-${fillMode}`}>
              {selectedOutputUrl ? (
                <video key={selectedOutputUrl} src={selectedOutputUrl} controls preload="metadata" />
              ) : (
                <div className="preview-empty">
                  <div>生成后在此预览成片</div>
                  <span>{canvas} · {fillMode === "blur" ? "铺满" : "黑边"}</span>
                </div>
              )}
              <SubtitlePreviewOverlay
                color={subtitleColor}
                enabled={subtitleEnabled}
                fontIndex={subtitleFontIndex}
                fontSize={subtitleFontSize}
                opacity={subtitleOpacity}
                outlineColor={subtitleOutlineColor}
                outlineWidth={subtitleOutlineWidth}
                text={previewSubtitle}
              />
            </div>
          </div>

          <div className="box image-input-box">
            <div className="box-h">
              <span>内容来源</span>
              <div className="image-input-actions">
                <div className="mini-seg compact">
                  <button className={mode === "copy" ? "active" : ""} type="button" onClick={() => setMode("copy")}>文案</button>
                  <button className={mode === "audio" ? "active" : ""} type="button" onClick={() => setMode("audio")}>音频</button>
                </div>
                <button
                  className="icon-btn text-btn"
                  type="button"
                  onClick={rewriteCurrentText}
                  disabled={rewriting || !currentSubtitleText.trim()}
                >
                  {rewriting ? "改写中" : "AI 改写"}
                </button>
              </div>
            </div>
            {mode === "copy" ? (
              <textarea
                className="image-copy-input"
                value={copyText}
                onChange={(e) => setCopyText(e.target.value)}
                placeholder="输入文案，系统会按语义匹配图片并生成配音、字幕"
              />
            ) : (
              <div className="image-audio-input">
                <button className="import-btn" type="button" onClick={chooseAudio}>{audioPath ? "更换音频" : "选择音频"}</button>
                <b title={audioPath}>{audioPath ? basename(audioPath) : "未选择音频"}</b>
                <textarea
                  className="image-copy-input small"
                  value={audioText}
                  onChange={(e) => setAudioText(e.target.value)}
                  placeholder="可选：填写音频对应文案，用于匹配图片和生成字幕"
                />
              </div>
            )}
          </div>

          <div className="box image-result-box">
            <div className="box-h">
              <span>生成状态</span>
              <span className="muted">{status}</span>
            </div>
            {matches.length ? (
              <div className="image-match-list">
                {matches.map((item, index) => (
                  <div className="image-match-row" key={`${item.name}-${item.score}-${index}`}>
                    <div>
                      <b>{item.name}</b>
                      {item.tags?.length ? <em>{item.tags.slice(0, 4).join(" · ")}</em> : null}
                    </div>
                    <span>{Math.round(item.score * 100)}%</span>
                  </div>
                ))}
                {taskItems.length ? (
                  <div className="image-output-list">
                    {taskItems.map((item) => (
                      <button
                        className={selectedOutputUrl === item.url ? "active" : ""}
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedOutputUrl(item.url || "")}
                      >
                        <b>{item.name}</b>
                        <span>{item.meta}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="preview-empty">生成后显示图片匹配结果和产出视频</div>
            )}
          </div>
        </section>

        <aside className="image-video-settings settings">
          <div className="set-scroll image-video-set-scroll">
            <OutputSettings
              allowReuse={allowReuse}
              duration={sceneDuration}
              durationLabel="单图时长"
              materialCount={imageCount}
              materialCountLabel="单条图片数"
              variants={variants}
              onAllowReuseChange={setAllowReuse}
              onDurationChange={setSceneDuration}
              onMaterialCountChange={setImageCount}
              onVariantsChange={setVariants}
            />

            <MotionSettings
              resolution={resolution}
              onResolutionChange={setResolution}
            />

            {mode === "copy" ? (
              <VoiceSynthesisSettings
                enabled={voiceEnabled}
                enabledHint="开始生成时会按每条文案自动合成语音"
                disabledHint="关闭后不合成配音，仅按文案估算时长生成视频"
                loudnessRate={copyVoiceLoudnessRate}
                selectedVoice={selectedVoice}
                showRateControls
                speechRate={copyVoiceSpeechRate}
                voiceCardVariant="compact"
                onEnabledChange={setVoiceEnabled}
                onLoudnessRateChange={setCopyVoiceLoudnessRate}
                onOpenVoicePicker={() => setVoicePickerOpen(true)}
                onSpeechRateChange={setCopyVoiceSpeechRate}
              />
            ) : null}

            <TextSubtitleStyleSettings
              activeTextLabel="字幕样式"
              color={subtitleColor}
              enabled={subtitleEnabled}
              fontIndex={subtitleFontIndex}
              fontSize={subtitleFontSize}
              opacity={subtitleOpacity}
              outlineColor={subtitleOutlineColor}
              outlineWidth={subtitleOutlineWidth}
              text={currentSubtitleText}
              onColorChange={setSubtitleColor}
              onEnabledChange={setSubtitleEnabled}
              onFontIndexChange={setSubtitleFontIndex}
              onFontSizeChange={setSubtitleFontSize}
              onOpacityChange={setSubtitleOpacity}
              onOutlineColorChange={setSubtitleOutlineColor}
              onOutlineWidthChange={setSubtitleOutlineWidth}
              onTextChange={setCurrentSubtitleText}
            />

            <BgmSettings
              enabled={bgmEnabled}
              path={bgmPath}
              volume={bgmVolume}
              onChoose={chooseBgm}
              onClear={() => {
                setBgmPath("");
                setBgmEnabled(false);
              }}
              onEnabledChange={setBgmEnabled}
              onPathChange={setBgmPath}
              onVolumeChange={setBgmVolume}
            />

            <SmartMatchSettings
              enabled={smartRerank}
              hint="启用后会调用 AI 对候选图片重排，会产生接口消耗。"
              onEnabledChange={setSmartRerank}
            />

            <ExportQualitySettings value={exportQuality} onChange={setExportQuality} />

            <button className="cta ready image-video-generate" type="button" disabled={!canGenerate} onClick={openConfirm}>开始生成</button>
          </div>
        </aside>
      </div>

      <MaterialSourcePicker
        open={pickerOpen}
        title="选择图片素材来源"
        defaultCategory="image"
        kind="image"
        onSelect={chooseRoot}
        onClose={() => setPickerOpen(false)}
      />
      {annotationOpen ? (
        <div className="copy-modal-backdrop" onMouseDown={() => setAnnotationOpen(false)}>
          <div className="image-annotation-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="copy-modal-h">
              <div>
                <b>描述图片</b>
                <span>补充关键词后，图片匹配会优先使用这些描述</span>
              </div>
              <button className="icon-btn" type="button" onClick={() => setAnnotationOpen(false)}>×</button>
            </div>
            <div className="image-annotation-body">
              <div className="image-annotation-list">
                {sourceImages.map((image, index) => {
                  const annotation = annotationsByPath[image.path] ?? image.annotation;
                  return (
                    <button
                      className={annotationPath === image.path ? "active" : ""}
                      key={image.path}
                      type="button"
                      title={annotationSummary(annotation) || image.name}
                      onClick={() => {
                        setSelectedImagePath(image.path);
                        loadAnnotationForm(image.path);
                      }}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <b>{image.name}</b>
                      {annotationFilled(annotation) ? <em>已描述</em> : null}
                    </button>
                  );
                })}
              </div>
              <div className="image-annotation-preview">
                {annotationPath ? (
                  <img src={`/api/media?path=${encodeURIComponent(annotationPath)}`} alt="" />
                ) : (
                  <div className="preview-empty">选择图片</div>
                )}
              </div>
              <div className="image-annotation-form">
                <label>
                  <span>关键词</span>
                  <input
                    className="inp"
                    value={annotationKeywords}
                    onChange={(e) => setAnnotationKeywords(e.target.value)}
                    placeholder="电饭煲、厨房、懒人做饭"
                  />
                </label>
                <label>
                  <span>画面描述</span>
                  <textarea
                    className="image-copy-input small"
                    value={annotationDescription}
                    onChange={(e) => setAnnotationDescription(e.target.value)}
                    placeholder="白色电饭煲放在厨房台面上，突出产品细节"
                  />
                </label>
                <label>
                  <span>适合文案</span>
                  <textarea
                    className="image-copy-input small"
                    value={annotationUsageHint}
                    onChange={(e) => setAnnotationUsageHint(e.target.value)}
                    placeholder="下班快速做饭、小家电推荐、厨房效率"
                  />
                </label>
                <div className="image-annotation-actions">
                  <button className="icon-btn text-btn" type="button" onClick={() => persistAnnotation(false)} disabled={annotationSaving}>
                    {annotationSaving ? "保存中" : "保存"}
                  </button>
                  <button className="import-btn" type="button" onClick={() => persistAnnotation(true)} disabled={annotationSaving}>
                    保存并下一张
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {voicePickerOpen ? (
        <VoicePickerModal
          voices={VOICE_SPEAKERS}
          selectedVoiceType={selectedVoiceType}
          onSelect={(voice) => {
            setSelectedVoiceType(voice.VoiceType);
            setVoicePickerOpen(false);
          }}
          onClose={() => setVoicePickerOpen(false)}
        />
      ) : null}
      <ExportTaskDrawer
        open={drawerOpen}
        title="图片转视频"
        status={status}
        progress={progress}
        running={running}
        exportDir={exportDir}
        manifest={manifest}
        items={taskItems}
        summary={[
          { label: "来源", value: sourceRoot?.name || basename(sourcePath) },
          { label: "模式", value: mode === "copy" ? "文案模式" : "音频模式" },
          { label: "导出数量", value: `${variants} 个` },
          { label: "画布", value: `${canvas} · ${fillMode === "blur" ? "铺满" : "黑边"}` },
        ]}
        confirmLabel="确认生成"
        onConfirm={startGenerate}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
