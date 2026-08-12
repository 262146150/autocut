# AutoCut

AutoCut 是一个本地优先的视频智能处理工作台，面向素材整理、智能切片、文案匹配、批量混剪、图片转视频和字幕处理等生产流程。

项目优先在用户设备上使用 FFmpeg、ONNX Runtime、SQLite 和本地模型完成媒体处理；LLM、TTS 等云端能力为可选配置，平台发布与易变的第三方集成将通过独立适配器或插件接入。

> 当前项目仍处于积极开发阶段，建议先使用 Web 工作台体验和参与开发。

## 核心能力

- 本地素材库：目录导入、SQLite 索引、片段复用和导出记录
- 智能切片：TransNetV2 场景检测与 sherpa-onnx VAD 边界保护
- 智能匹配：CLIP ONNX 本地向量匹配，可选 LLM 重排
- 批量生产：文案或音频驱动的多素材组合、多版本导出
- 视频处理：FFmpeg 画布适配、裁剪、拼接、字幕、配乐和画面效果
- 图片转视频：图片序列、运镜、配音、字幕和背景音乐组合
- 高光切片：ASR、片段评分、标题生成与合集导出
- 可选云服务：火山方舟 LLM 和火山引擎 TTS 配置

## 技术架构

```text
React + TypeScript + Vite
          |
          v
本地 Node 服务
  |-- FFmpeg / FFprobe
  |-- ONNX Runtime / CLIP / TransNetV2
  |-- sherpa-onnx VAD
  |-- SQLite 素材索引
  `-- 可选 LLM / TTS Provider

Tauri + Rust 交付壳（持续完善中）
```

媒体、缓存、模型和导出文件默认保留在本机，不会提交到仓库。云端 Provider 只有在用户主动配置后才会启用。

## 快速开始

### 环境要求

- Node.js 22-26
- pnpm 9 或更高版本
- FFmpeg 与 FFprobe（需要可从命令行直接调用）

### 启动 Web 工作台

```bash
git clone https://github.com/262146150/autocut.git
cd autocut/web
pnpm install
pnpm build
node server.mjs
```

打开 <http://localhost:8787>。

开发模式可以在项目根目录运行：

```bash
./start-dev.sh
```

脚本会同时启动本地后端和 Vite 开发服务器，并在终端输出实际访问地址。

### 下载可选本地模型

以下模型不是启动基础界面的必需项，只在对应智能功能中使用：

```bash
cd web
pnpm models:smart     # 中文 CLIP 素材匹配
pnpm models:transnet  # TransNetV2 场景检测
pnpm models:vad       # sherpa-onnx VAD
```

模型文件体积较大，已通过 `.gitignore` 排除。模型来源、许可证与配置说明见 [智能匹配文档](docs/04-smart-match-onnx.md) 和 [ASR 文档](docs/03-asr-setup.md)。

## 项目结构

```text
web/           React/TypeScript 工作台与本地 Node 服务
poc/           可独立运行的 FFmpeg 核心管线验证
app/           Tauri 2 / Rust 桌面交付壳
auth-service/  可选授权服务与管理端
docs/          架构、算法、接口与操作文档
```

详细的 Web 开发说明见 [web/README.md](web/README.md)。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| 素材库与导出记录 | 可用 |
| 智能切片与高光切片 | 可用，部分能力需要本地模型或云配置 |
| AI 智能混剪 | 可用 |
| 图片转视频 | 可用，持续完善交互与效果 |
| 本地 ASR / VAD / CLIP | 已接入，模型需单独下载 |
| Tauri 桌面打包 | 基础脚手架，持续完善 |
| 平台发布插件 | 规划中 |

## 设计原则

1. 本地优先：用户媒体默认不离开设备。
2. 云端可选：LLM、TTS 等 Provider 可以替换或关闭。
3. 批量生产：长任务统一进度、日志、取消和导出管理。
4. 开放实现：不依赖或分发第三方产品的专有二进制、证书和凭据。
5. 隔离变化：平台发布和云服务放在独立适配层中。

相关设计背景见 [AivoClaw 对比与整合分析](docs/09-aivoclaw-integration-analysis.md)。

## 参与贡献

提交 Issue 或 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 中的方式报告，不要在公开 Issue 中附带密钥、Token、个人媒体或数据库文件。

## 合规说明

本项目用于合法的视频处理、学习和自有内容生产。请确保你对输入素材、音乐、字体、模型和输出内容拥有必要权利，并遵守所使用平台及云服务的条款。

AutoCut 是独立开源实现，与 ECutAuto、AivoClaw 及其厂商不存在隶属或授权关系。仓库不应包含上述产品的专有二进制、模型、签名证书或访问凭据。

## 许可证

代码以 [MIT License](LICENSE) 开源。第三方依赖、模型和媒体素材遵循各自许可证。
