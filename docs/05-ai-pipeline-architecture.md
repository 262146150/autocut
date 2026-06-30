# AI Pipeline Architecture

本文档记录 AI 智能混剪相关的核心技术选型和模块边界。

## Final Stack

### Speech: sherpa-onnx

字幕识别和人声检测主线切换到 `sherpa-onnx`：

- VAD：检测人声、静音和可切分音频区间。
- ASR：优先使用 FunASR / Paraformer 类中文模型生成字幕文本和时间轴。
- 用途：自定义模式自动字幕、音频模式字幕、人声切段、去静音、后续智能粗剪。

`Whisper.cpp` 暂不作为主线继续扩展，可保留为历史兼容或 fallback。

### Scene Detection: TransNetV2

视频切镜头确认使用 `TransNetV2` ONNX：

- 检测镜头边界和转场时间点。
- 将长视频素材拆成可复用的镜头片段。
- 为 AI 智能混剪提供更细粒度的候选素材。

切割后的片段应进入统一素材索引，而不是只作为一次性导出结果。

当前 MVP 已落地统一片段库、缓存 manifest、独立智能分割入口和 AI 智能混剪复用链路；镜头检测主线使用 TransNetV2 ONNX。FFmpeg scene detection 仅作为模型缺失时的临时降级。

切点语音保护已接入 `sherpa-onnx` + Silero VAD：TransNetV2 产生画面切点后，VAD 检测人声区间，并在附近有人声边界时移动切点，减少“说话被切断”。如果直播、口播、访谈等素材长时间连续说话，系统仍会按目标时长和最大时长强制拆分，避免整段无法进入混剪素材库。

### Text-Image Matching: CLIP ONNX

文案匹配画面继续使用当前 Chinese-CLIP / CLIP ONNX 路线：

- 输入：文案文本、音频转写文本或用户填写的音频描述。
- 输入：TransNetV2 切出的镜头片段关键帧。
- 输出：按语义相关度排序的候选片段。

匹配链路采用“两阶段”：

- 快速匹配：ONNX / 本地索引直接排序。
- 深度匹配：先用 ONNX / 本地索引召回 Top 候选，再用 LLM 根据文案重排候选素材卡片。

后续优化方向是 tokenizer、批量推理、缓存、片段级索引和更丰富的素材语义卡片，不更换主模型方向。

### Rendering: FFmpeg

FFmpeg 继续负责最终合成：

- 裁剪、拼接、比例填充、混音、字幕烧录。
- 水印、去水印、调色、动态缩放等画面处理。
- 按模式输出到批次目录和分组目录。

导出分辨率默认使用 1080P 固定画布：竖屏 `1080x1920`，横屏 `1920x1080`。轻量模式可使用 720P：竖屏 `720x1280`，横屏 `1280x720`。不默认跟随原素材分辨率，因为批量混剪会混用不同尺寸素材，成片需要统一画布。

编码器 MVP 阶段使用 `libx264`，保证 Windows、macOS Intel 和 macOS Apple Silicon 都能稳定导出。导出画质按档位调整 `crf/preset`：

- 标准：`crf 23`，`preset veryfast`
- 高清：`crf 20`，`preset fast`
- 高质量：`crf 18`，`preset medium`

后续 TODO：增加“导出加速”选项，自动探测硬件编码并失败回退 `libx264`：

- macOS Intel / Apple Silicon：`h264_videotoolbox`
- Windows NVIDIA：`h264_nvenc`
- Windows Intel 核显：`h264_qsv`
- Windows AMD：`h264_amf`

## Target Flow

```text
原始素材
  -> TransNetV2 检测镜头边界
  -> FFmpeg 切成镜头片段
  -> 抽关键帧并建立 CLIP 向量索引
  -> 文案/音频文本匹配镜头片段
  -> sherpa-onnx 生成或校准字幕
  -> FFmpeg 合成导出
```

## Product Boundary

`智能分割` 应作为独立能力保留，同时被 `AI 智能混剪` 内部复用：

- 独立入口：用户手动把素材库预处理成镜头片段，可检查、删除、重命名和复用。
- 智能混剪入口：首次生成时自动触发分割和索引，减少用户操作。

实现上只维护一套分割服务和片段索引，避免两个模块生成不同格式的素材。

## Implementation Order

1. 接入 TransNetV2，输出镜头边界和片段清单。
2. 用 FFmpeg 按边界切片，并建立片段级素材索引。
3. 将 AI 智能混剪从“视频级匹配”切换为“片段级匹配”。
4. 接入 sherpa-onnx VAD + ASR，替换现有字幕识别主线。
5. 优化缓存、批量推理和模型下载管理。
