# ECutAuto-Clone

ECutAuto（1.3.6，Tauri/Rust 混剪软件）的**逆向分析文档 + 架构复刻脚手架**。
全部内容由对 `/Applications/ECutAuto.app` 主程序的静态分析（`strings`/`otool`/`nm`）还原。

## 目录

```
docs/
  01-ffmpeg-filters.md   ← 任务1：全套 FFmpeg 滤镜配方（去重/虚化/转场/抠像/音频…）
  02-api-blueprint.md    ← 任务2：后端 API 蓝图（模块结构/命令面/数据模型/云端集成）
web/                     ← Web 版工作台：浏览器跑，本地 Node 后端（推荐先用这个开发）
poc/                     ← CLI 验证：Node + 系统 ffmpeg，混剪/去重核心管线（共享 pipeline.mjs）
app/                     ← 完整 Tauri 2 脚手架（交付时打包）
_raw/                    ← 提取的原始字符串证据
```

## 原软件架构速览（结论）

| 组件 | 真实身份 |
|------|---------|
| 主程序 (Tauri 2.10.3 / Rust) | 调度 + WebView 前端，静态链接 sherpa-onnx |
| `FFmpeg/macOS/{arm64,x86_64}/` | 视频引擎，CLI 子进程调用 |
| `models/model.1.onnx` | 本地 ASR 模型（FunASR/Paraformer 系） |
| `models/model.3.dylib` | **其实是 libonnxruntime 1.25.1**（改名伪装） |
| 云端 | 火山方舟 LLM（文案/视觉）+ 字节火山 TTS（配音）+ 自有授权服务 |

三条流水线：**FFmpeg**（编解码/特效/去重）、**本地 ONNX**（语音转字幕/场景切分）、**云 AI**（文案/配音）。

---

## 路线 0：Web 版工作台（Vite + React + TS，推荐先用这个开发）

浏览器里跑完整 UI（首页 + 模块页），本地 Node 后端做实际处理。视觉已按原版还原。

```bash
cd web
pnpm install
# 开发（热更新）：两个终端
node server.mjs      # 终端1：后端 :8787
pnpm dev             # 终端2：前端 :5173 → 开 http://localhost:5173
# 或预览构建：
pnpm build && node server.mjs   # 访问 :8787
```

详见 `web/README.md`。交付时这套 React 前端原样塞进 Tauri，只换 `src/api.ts` 的后端适配（已写好分支）。

---

## 路线 A：CLI 跑核心管线（无需 Rust）

```bash
cd poc
node mix.mjs                              # 自动造测试素材，出 3 条竖屏成片
node mix.mjs --canvas 1920x1080 --out 5   # 横屏，出 5 条
node mix.mjs --inputs /你的/素材目录 --out 10
```

产出在 `poc/_run/output/`。每条成片的去重参数（翻转/亮度/噪点/变速…）独立随机 →
**解码后像素 MD5 各不相同**，即指纹各异。这就是"批量出 N 条不重复"的本质：参数随机化，不是 AI。

实测（本机已验证）：3 条 1080×1920 成片，视频流 MD5 三者互不相同 ✓

---

## 路线 B：完整 Tauri 应用

前置：Rust（`rustup`）、Node、pnpm。

```bash
# 1) 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2) 放置二进制资源（复用 ECutAuto 的，或自备）
mkdir -p app/src-tauri/Resources
cp -R "/Applications/ECutAuto.app/Contents/Resources/Resources/FFmpeg" app/src-tauri/Resources/

# 3) 跑起来
cd app
pnpm install
pnpm tauri dev
```

### 后端模块结构（忠实对齐原 `ecutauto_lib`）

```
src-tauri/src/
├── lib.rs / main.rs        # Tauri 入口，注册命令与插件
├── commands.rs             # video_mixing_process / _cancel / subtitle_recognize
├── dedup.rs                # 去重参数随机区间采样
├── ffmpeg/
│   ├── executor.rs         # spawn ffmpeg + 进度解析 + 取消
│   ├── probe.rs            # ffprobe 探测
│   ├── filters.rs          # 滤镜构造器（= docs/01 配方）
│   └── mod.rs              # process_segment / concat_segments
└── providers/
    └── local_asr.rs        # sherpa-onnx 本地 ASR（--features asr 启用）
```

### 启用本地 ASR（语音转字幕）

```bash
# 放置模型（与 ECutAuto 同源，从 ModelScope 下载 FunASR/Paraformer onnx）
#   app/src-tauri/Resources/models/model.1.onnx + tokens.txt
pnpm tauri dev --features asr
```

---

## 复刻进度对照

| 模块 | docs | poc | app |
|------|:----:|:---:|:---:|
| 背景虚化/画布适配 | ✅ | ✅ 已跑通 | ✅ |
| 去重/过原创（随机化） | ✅ | ✅ 已跑通 | ✅ |
| 多段拼接 | ✅ | ✅ 已跑通 | ✅ |
| 进度/取消 | — | — | ✅ |
| 转场 / 水印 / 贴纸抠像 / delogo / 运镜 | ✅ 配方齐 | ⬜ | ⬜ 待接 |
| 本地 ASR 字幕 | ✅ | — | 🔶 骨架 |
| 剪映草稿导出 | ✅ 字段 | — | ⬜ |
| 云 LLM 文案 / TTS 配音 | ✅ 端点 | — | ⬜ |
| 授权系统 | ✅ 结构 | — | ⬜ |

✅完成 🔶骨架 ⬜待实现

下一步把 docs/01 里的转场/水印/抠像/delogo/运镜配方按同样方式补进 `ffmpeg/filters.rs` 即可，
数据结构照 docs/02 的蓝图定义。

---

## 合规

复刻用于学习与自有视频处理工具开发。"去重/过原创"属内容平台查重规避，软件本身合法，
落地时请遵守目标平台规则与素材版权。
