# ECutAuto — 后端 API 蓝图（逆向重建）

> 来源：`ECutAuto` 主程序中的 serde 结构体元数据、`ecutauto_lib::*` 模块路径、Tauri 命令标识符、ACL 权限表。
> 用途：照此可直接搭出一套等价的 Tauri 后端骨架。字段名为二进制中原样出现者；标 *(推断)* 的为按语义补全。

---

## 1. 分层架构

```
前端 (Vite WebView)
   │  invoke(cmd, payload)  /  listen(event)
   ▼
ecutauto_lib::services::api::commands     ← Tauri #[command] 入口层
   ├── modules::creative::*               ← 业务逻辑（混剪/改写/特效）
   ├── services::providers::*             ← AI 能力（本地 ASR / 场景检测 / 云 LLM·TTS）
   ├── ffmpeg::{executor,probe,streamer,concat}  ← FFmpeg 子进程驱动
   └── security::{auth_state,work_dir}    ← 授权/许可/工作目录
```

## 2. 源码模块结构（从符号还原）

```
ecutauto_lib
├── ffmpeg
│   ├── executor        # spawn ffmpeg，捕获 stderr
│   ├── probe           # ffprobe 探测时长/分辨率/码率
│   ├── streamer        # 解析进度、推送事件
│   └── concat          # 拼接（concat=n / demuxer）
├── modules::creative
│   ├── text_rewrite::processor          # 文案改写（调 LLM）
│   └── video_effects::effects::lut_filter  # LUT/风格滤镜
├── services
│   ├── api::commands   # 所有 Tauri 命令
│   └── providers
│       ├── local_asr                    # sherpa-onnx 本地语音识别
│       └── scene_detect::detector       # TransNetV2 场景切分
├── security
│   ├── auth_state      # 登录/授权态
│   └── work_dir        # 许可证、工作目录、设备指纹
└── utils::fonts        # 字幕/水印字体
```

---

## 3. Tauri 命令面（原样提取的命令名）

按功能分组。命令遵循 `<域>_<动作>` 命名；长任务统一带 `_progress`（事件）和 `_cancel`。

### 3.1 视频混剪
| 命令 | 载荷 | 说明 |
|------|------|------|
| `video_mixing_process` | `MixProcessRequest`(16) | 启动批量混剪 |
| `video_mixing_cancel` | — | 取消 |
| `video_mixing_progress` | *(event)* | 进度事件 |
| `video_mixing_rewrite_text` | `RewriteRequest`(3) | 改写解说文案 |

### 3.2 分类混剪
`category_mix_process` (`CategoryMixRequest` 20) / `category_mix_cancel` / `category_mix_progress` / `category_mix_rewrite_text`

### 3.3 智能混剪
`smart_mix_progress` / `smart_mix_rewrite_text`（载荷 `SmartClipParams`）

### 3.4 直播切片
| 命令 | 载荷 |
|------|------|
| `live_clip_export` | `LiveClipExportRequest`(14) |
| `live_clip_export_progress` / `live_clip_export_cancel` | — |
| `live_clip_ai_analyze` | `AiAnalyzeRequest`(6) → `AiAnalysisResult` |
| `live_clip_asr_analyze` / `cancel-live-clip-asr` | `AsrAnalyzeRequest`(1) |

### 3.5 解说/口播
`narration_export` / `narration_export_progress` / `narration_asr_analyze`（`NarrationScriptItem` 6）

### 3.6 字幕/ASR
| 命令 | 载荷 |
|------|------|
| `subtitle_recognize` | `RecognizeRequest`(1) → `SubtitleFrame[]` |
| `subtitle_recognize_progress` / `cancel-subtitle-recognize` | — |
| *(内部事件)* `asr_audio_recognizing` | — |

### 3.7 重命名/标注/输出
`save_relabel_ipairs` / `save_relabel_opairs`（`RenameRequest`/`RenameItem`）、`split_output`

### 3.8 授权（security::auth_state）
| 命令 | 载荷 |
|------|------|
| 注册 | `RegisterPayload`(3) → `AuthResponse`(5) |
| 卡密兑换 | `RedeemCardPayload`(3) |
| 设备换绑 | `RebindDevicePayload`(2) |
| 改密 | `ChangePasswordPayload`(3) |
| 校验 | `VerifyPayload`(2) |

---

## 4. 数据模型（结构体 → 字段）

> 全部结构体清单（带字段数）见文末附录。下面给出**已知真实字段**的核心结构。

### 4.1 混剪请求（核心）
```rust
// MixProcessRequest (16) — 主混剪入口
struct MixProcessRequest {
    folder_path: String,
    material_paths: Vec<String>,
    clip_params: ClipParams,
    selection_mode: String,        // 选材模式
    allow_material_reuse: bool,    // 素材可否复用
    material_count: u32,           // 每条用几个素材
    output_count: u32,             // 出几条
    groups: Vec<...>,
    audio_paths: Vec<String>,
    audio_srt_paths: Vec<String>,
    bgm: BgmConfig,
    video_volume: f32,
    image_watermark: ImageWatermarkConfig,
    text_watermarks: Vec<TextWatermarkConfig>,
    canvas_mode: String,           // 画布模式（横/竖/方）
    fill_mode: String,             // 填充模式（虚化/纯色）
    export_mode: String,           // 直接出片 / 剪映草稿
    jianying_draft_dir: String,    // 剪映草稿输出目录
    // ... output_paths, failed_tasks
}

// ClipParams (12)
struct ClipParams {
    clip_start_sec: f32,
    clip_end_sec: f32,
    min_duration: f32,
    max_duration: f32,
    zoom_mode: String,
    // 各类特效参数引用 ...
}
```

### 4.2 去重/特效参数（全部带 min/max 随机区间，见 01 文档）
```rust
struct PictureAdjustParams {  // 16
    min_sharpen, max_sharpen, min_brightness, max_brightness,
    min_denoise, max_denoise, min_color_temp, max_color_temp,
    min_contrast, max_contrast, min_saturation, max_saturation,
    style_primary, style_vignette, style_film_grain, style_glow,
}
struct AudioSettingsParams {
    min_volume, max_volume, enable_fade, intelligent_adjust,
    background_music, min_background_volume, max_background_volume,
    background_loop, background_fade,
    min_pitch_cents, max_pitch_cents, min_noise_level, max_noise_level,
    min_eq_gain_db, max_eq_gain_db,
}
struct SpeedParams(5)       // 变速
struct RotateFlipParams(5)  // 翻转旋转
struct CropParams(5)
struct ZoomPanParams(5)     // 运镜
struct FramerateParams(7)
struct PixelBlendParams(4)
struct FadeEffectParams(3)
struct LutFilterParams(2)
struct SceneSplitParams(7)  // 场景切分阈值
```

### 4.3 水印/贴纸
```rust
struct TextWatermarkConfig(16)  { content, font_family, font_size, font_weight,
    opacity, outline_color, outline_width, second_outline_color,
    glow_color, shadow_depth, shadow_color, style_type, /*x,y,...*/ }
struct ImageWatermarkConfig(7)
struct StickerOverlayParams     // 贴纸（亮度抠像）
struct WatermarkParams(7)
struct RemoveWatermarkConfig(5) { regions: Vec<DelogoRegion>, method, ... }
struct DelogoRegion(4) { x, y, w, h }
struct Region(4)
```

### 4.4 字幕/ASR
```rust
struct SubtitleConfig(15)   // 样式：font/size/color/outline/position/burn...
struct SubtitleInput(4)
struct SubtitleFrame(4)  { start, end, text, /*conf*/ }
struct WordTimestamp(3)  { word, start, end }   // 词级时间戳
struct WordItem(4)
struct SentenceInfo(2)
// 导出：export_srt / export_word_srt / export_txt / burn_subtitle
// 多语言：multi_language_{mode,list,main,current}, ai_translate
// 关键词：subtitle_keywords_config
```

### 4.5 AI / LLM（OpenAI 兼容客户端）
```rust
struct ChatMessage(2)   { role, content: Vec<MessagePart> }
enum  MessagePart { Text(String), ImageUrl(ImageUrlContent) }  // 支持视觉
struct ChatResponse(6) / ChatChoice(3) / ChunkResponse(6) / ChatUsage(3) / UsageInfo(1)
struct AiAnalyzeRequest(6) → AiAnalysisResult / AiAnalysisGroup(2) / AiScriptItem(4)
struct RewriteRequest(3) → RewriteOutput(1) / VariantOutput(2)
```

### 4.6 配音 TTS
```rust
struct VoiceConfig(6)  { voice_types: Vec<String>, random_voice: bool, /*speed,pitch,vol*/ }
struct NarrationScriptItem(6)
```

### 4.7 剪映(CapCut)草稿导出
```rust
// 产出 draft_content.json / draft_info.json / draft_meta_info.json
// 字段：draft_root_path, draft_timeline_materials, keyframe_graph_list, keyframes,
//       free_render_index_mode_on, group_container, tm_draft_{create,modified,...},
//       attachment_info, combination_max_index, sticker_max_index ...
```

### 4.8 授权
```rust
struct AuthResponse(5)
struct RegisterPayload(3) / RedeemCardPayload(3) / RebindDevicePayload(2)
struct ChangePasswordPayload(3) / VerifyPayload(2) / Message(6)
// security::work_dir 持有设备指纹 + 许可证
```

---

## 5. 云服务集成

| 能力 | Endpoint | 协议 |
|------|----------|------|
| 文案/视觉分析 LLM | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | OpenAI 兼容（火山方舟/豆包），支持流式 + 图片 |
| 配音 TTS | `https://openspeech.bytedance.com/api/v3/tts/unidirectional` | 字节火山语音，单向流式 |
| 授权服务 | 自有（`services::api::auth`） | 注册/卡密/换绑/校验 |

HTTP 栈：`reqwest 0.12` + `reqwest-middleware` + `reqwest-retry`（带重试中间件）。

---

## 6. 进度/事件模式

长任务一律：命令立即返回 → 后台线程跑 → 通过 Tauri Event（`*_progress`）推送，前端 `listen` 接收；`*_cancel` 命令置取消标志。
进度结构含：`output_index / output_total / group_index / group_count / group_total / stage_percent / stage_*`。

---

## 7. 需要申请的 Tauri 能力（ACL）

从权限表看，复刻需开启：
- `fs`: 读视频/音频/字体/缓存 + 写输出（`allow-video-read/meta, allow-audio-read/meta, allow-write-file, $APPLOCALDATA/**`）
- `dialog`: open/save（选素材/选导出目录）
- `path`, `event`, `window`, `webview`, `image`, `menu`, `tray`, `opener`
- `single-instance`（防多开）

---

## 附录：完整结构体清单（名 + 字段数）

```
请求/任务: MixProcessRequest(16) CategoryMixRequest(20) ProcessRequest(15)
  LiveClipExportRequest(14) ExportRequest(16) ConvertRequest(9) AiAnalyzeRequest(6)
  AsrAnalyzeRequest(1) RecognizeRequest(1) RewriteRequest(3) FolderMixTask(7)
  FolderTask(9) CategoryGroupTask(4) SliceGroupTask(4) VideoExportGroup(3)
  VideoExportEntry(4) SavePosterRequest(7) RenameRequest(2)
特效参数: ClipParams(12) ClipSegment(4) PictureAdjustParams(16) SpeedParams(5)
  CropParams(5) RotateFlipParams(5) ZoomPanParams(5) ZoomPanConfig(6) FramerateParams(7)
  PixelBlendParams(4) FadeEffectParams(3) LutFilterParams(2) WatermarkParams(7)
  TextWatermarkConfig(16) ImageWatermarkConfig(7) RemoveWatermarkParams(4)
  RemoveWatermarkConfig(5) DelogoRegion(4) Region(4) StylePreset(9) Effect(3)
  SceneSplitParams(7) ProcessingOptions(9) CropConfig(5) HslConfig(4) BgmConfig(3)
字幕/ASR: SubtitleConfig(15) SubtitleInput(4) SubtitleFrame(4) WordTimestamp(3)
  WordItem(4) SentenceInfo(2)
AI/LLM: ChatMessage(2) ChatChoice(3) ChatResponse(6) ChunkResponse(6) ChatUsage(3)
  UsageInfo(1) MessagePart::{Text,ImageUrl} ImageUrlContent(1) AiAnalysisResult(1/2)
  AiAnalysisGroup(2) AiScriptItem(4) ScriptItem(2) RewriteOutput(1) VariantOutput(2)
  MaterialDescription(3) NarrationScriptItem(6)
配音: VoiceConfig(6)
导出/输出: OutputConfig(2) CoverParams CroupParams
授权: AuthResponse(5) RegisterPayload(3) RedeemCardPayload(3) RebindDevicePayload(2)
  ChangePasswordPayload(3) VerifyPayload(2) Message(6) UsageInfo(1)
对话框: OpenDialogOptions(9) SaveDialogOptions(4) DialogFilter(2)
```
