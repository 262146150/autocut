# AivoClaw 对比与整合分析

本文记录对本机 `AivoClaw 容剪 IP口播智能体.app` 的静态分析结果，以及它与本项目 `ECutAuto-Clone` 的关系。分析以应用包结构、`app.asar`、Go 服务日志、发布引擎资源和本项目源码为依据，不把未确认的云端实现当作本地功能。

## 1. 产品边界

两者都处理视频、字幕、ASR、TTS 和自动剪辑，但核心定位不同：

```text
AivoClaw
  云端 AI 内容生产平台 + 本地视频工具

ECutAuto-Clone
  本地优先的视频智能处理引擎 + 可选云端能力
```

AivoClaw 的数字人、声音训练、Seedance/Qwen 生成、云端字幕任务、会员积分和部分审核能力主要依赖 `api.aivo.video`。本地 Go 服务负责代理、任务编排、FFmpeg 处理以及部分媒体能力。

ECutAuto-Clone 的主要处理链路在本机完成：

```text
本地素材
  -> TransNetV2 场景检测
  -> sherpa-onnx / Whisper ASR 与 VAD
  -> CLIP ONNX 素材匹配
  -> FFmpeg 混剪、字幕、水印和导出
  -> 本地 SQLite 素材库
```

## 2. 共同点

- FFmpeg/FFprobe 音视频处理
- ASR、字幕时间轴和字幕烧录
- 场景检测与视频切片
- 文案驱动的视频混剪
- TTS 配音和背景音乐
- 批量任务、进度、取消和导出
- 本地素材管理
- 可选云端 LLM/TTS 能力

本项目的 `segmenter.mjs`、`transnetv2_detector.mjs`、`sherpa_vad.mjs`、`smart_match.mjs` 和 `poc/filters.mjs`，已经覆盖了 AivoClaw 本地视频能力中最值得复用的基础方向。

## 3. AivoClaw 中可以借鉴的功能设计

### 本地媒体工具

- 视频信息读取、切分和比例转换
- 添加图片/视频背景
- 音频提取、混音和保留原音
- 字幕烧录、贴纸和水印
- 封面抽帧、转码和批量导出
- 静音过滤、场景拆解和片段导出

### 生产工作流

- 文案 -> 分镜 -> 配音 -> 字幕 -> 成片
- 视频下载 -> ASR 提取文案
- 视频下载 -> 场景拆解
- 片段评分 -> 标题生成 -> 高光导出
- 多素材组合 -> 多版本成片

### 工程化设计

- 统一任务 ID、状态、进度和日志
- 本地项目和导出历史
- 可恢复的长任务
- 硬件编码探测和并发限制
- Provider 适配层，用于替换不同云端模型

不建议直接复制 AivoClaw 的专有 JS、Go/Python 二进制、云端鉴权、密钥、签名证书或平台自动化代理。应复用开源组件、已确认的产品流程和重新实现的接口契约。

## 4. AivoClaw 发布器逻辑

发布引擎位于应用包的 `Resources/extraResources/publisher-engine`，由两层组成：

```text
Node.js 调度层
  index.js / scheduler.js / groups.js
       |
       | stdin JSON
       v
Python 3.12 + PyInstaller 代理
  Playwright + Chromium
```

已确认的平台：

- 抖音：`creator.douyin.com`
- 小红书：`creator.xiaohongshu.com`
- 视频号：`channels.weixin.qq.com`
- 快手：`cp.kuaishou.com`

Node 层可见的能力包括登录、登录状态检查、视频发布、任务取消、账号组、多平台串行发布、定时发布、任务落盘和日志。Python 层的模块名、平台 URL、Playwright 选择器和事件名仍保留在 PyInstaller 归档中，但原始 Python 源码没有随包提供。

如果为本项目增加发布能力，建议做成独立插件：

```text
PublisherManager
  -> DouyinAdapter
  -> XiaohongshuAdapter
  -> WechatChannelsAdapter
  -> KuaishouAdapter
```

核心应用只依赖统一的 `login/status/publish/schedule` 契约，平台选择器和浏览器自动化放在独立进程，并注意平台服务条款、登录态保护和风控风险。

## 5. AivoClaw 的云端后台与阿里云

`https://api.aivo.video` 是 AivoClaw 的远程业务后台，承担账号、会员、AI 任务、数字人、声音、字幕和产品配置等能力。本地 Go 服务通常以用户 Bearer Token 代理请求。

当前最明确的阿里云用途是 AI 视频字幕擦除。Go 二进制包含：

```text
github.com/alibabacloud-go/videoenhan-20200320/v3
videoenhan.cn-shanghai.aliyuncs.com
EraseVideoSubtitles
EraseVideoSubtitlesAdvance
GetAsyncJobResult
```

本地接口对应：

```text
/api/tools/erase-subtitle/video-info
/api/tools/erase-subtitle/preview
/api/tools/erase-subtitle/export
/api/tools/erase-subtitle/progress
/api/tools/erase-subtitle/task-list
```

流程是本地准备视频 -> 调用阿里云异步擦字幕 -> 轮询任务 -> 下载结果 -> 本地 FFmpeg 预览/导出。SDK 中还包含 Logo 擦除、画质增强、降噪和插帧接口，但当前包内只明确确认了 `RemoveSubtitles` 的实际调用。

阿里云配置由 Aivo 后台动态下发：

```text
https://api.aivo.video/api/client/tools/aliyun-config
```

安装包中没有发现可直接复用的固定用户 Token；不要把日志中的 Token、AccessKey 片段或签名相关文件当作项目凭据使用。

## 6. 本地视频处理技术比较

### AivoClaw 更强的方面

- 当前商业版工具覆盖更广
- Go 服务适合长任务和后台运行
- 字幕项目、模板、贴纸、BGM 和擦字幕更产品化
- FFmpeg 校验、硬件编码探测和任务进度更成熟
- 已有 ZGL/SWK、AutoClip 等批量工作流

### ECutAuto-Clone 更强的方面

- 源码完整可修改
- TransNetV2 场景检测比简单 FFmpeg scene threshold 更可控
- sherpa-onnx VAD 能保护口播语音边界
- CLIP ONNX + LLM 重排支持文案到画面的语义匹配
- SQLite 素材库和片段索引更适合本地复用
- 本地优先，素材隐私和成本更可控

结论：AivoClaw 的本地媒体工程化更成熟，ECutAuto-Clone 的本地算法透明度、素材理解和扩展性更好。

## 7. 推荐整合路线

以 ECutAuto-Clone 为主工程，吸收 AivoClaw 的产品流程和工程设计：

1. 保留 React/TypeScript、TransNetV2、sherpa-onnx、CLIP ONNX、SQLite 和现有 FFmpeg 管线。
2. 把 `server.mjs` 中的重任务逐步拆成任务中心、媒体服务、AI Provider 和素材服务。
3. 统一所有长任务的任务模型、进度、日志、取消和恢复机制。
4. 把字幕升级为可持久化项目，而不是一次性 FFmpeg 参数。
5. 增加可选的 TTS、LLM、数字人和生图/生视频 Provider，不把云端服务写死在核心层。
6. 把平台发布放到独立进程和插件目录，避免平台变化影响本地剪辑核心。
7. 最后再考虑 Tauri/Rust 交付壳和会员/授权服务。

建议产品定位：

> 本地优先、AI 辅助、批量生产、素材不出机器的视频智能工作台。
