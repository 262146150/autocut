# 参与贡献

感谢你参与 AutoCut。项目当前优先完善本地视频工作台、批量任务、素材理解和可替换 Provider。

## 开发环境

1. 安装 Node.js 22-26、pnpm 9+、FFmpeg 和 FFprobe。
2. 在 `web/` 目录运行 `pnpm install`。
3. 运行 `../start-dev.sh` 启动前后端。
4. 提交前在 `web/` 目录运行 `pnpm build`。

## 提交建议

- 一个 Pull Request 只解决一个明确问题。
- 优先沿用现有 React/TypeScript、Node、FFmpeg、ONNX 和 SQLite 实现。
- 云端 AI 与平台发布功能应通过独立 Provider、Adapter 或插件接入。
- 新增长任务时，应考虑进度、日志、取消、失败恢复和批量执行。
- 涉及用户媒体时，默认采用本地处理，不要静默上传文件。
- 为行为变更补充必要文档或测试，并在 PR 中说明验证方式。

## 不应提交的内容

- API Key、Token、Cookie、证书、授权码和真实 `.env` 文件
- 用户媒体、导出文件、SQLite 数据库、缓存与日志
- ONNX 模型、FFmpeg 二进制或其他大体积运行资源
- ECutAuto、AivoClaw 或其他第三方产品的专有代码、二进制和凭据

## Issue 与 Pull Request

报告问题时请提供操作系统、Node/FFmpeg 版本、复现步骤和已脱敏日志。不要上传包含个人信息或无权分享的媒体样本。

提交 Pull Request 时请保持现有工作区中的无关改动不变，并使用清晰的提交信息，例如 `feat: add export retry` 或 `fix: preserve subtitle position`。
