# 用户注册与远程授权服务

本文记录 MVP 阶段的用户体系设计。核心原则是：桌面端不负责发放激活码，只调用远程授权服务校验账号和授权。

## 架构边界

- `auth-service/`：独立授权服务，后续部署到远程服务器。
- `web/server.mjs`：桌面本地后端，只保存设备 ID、登录 token 和授权缓存。
- `web/src/*`：前端显示注册、登录、激活和过期处理。

桌面端通过 `AUTH_SERVICE_URL` 指向授权服务，本地开发默认是 `http://localhost:8899`。

## 授权服务数据表

授权服务使用 MySQL，表名前缀由 `DB_PREFIX` 控制，默认 `r_`：

- `r_users`：用户账号、密码哈希、昵称、状态。
- `r_activation_codes`：激活码哈希、完整码密文、类型、有效期、发放状态。
- `r_user_licenses`：用户激活后的授权记录、设备 ID、到期时间。

`r_activation_codes.code_preview` 只保存脱敏预览，例如 `ECFD-EC2...-02D`。完整激活码保存在 `code_cipher`，由 `AUTH_CODE_SECRET` 或 `AUTH_JWT_SECRET` 加密。后台接口和脚本可以解密显示完整码，但数据库不是直接明文。

激活码分两类：

- `trial`：试用码，默认可用于短期体验。
- `official`：正式码，购买后由后台或运营系统分配。

两类激活码都有授权时长，激活后写入用户授权到期时间。

激活码状态：

- `available`：库存码，未发放，可用于下一批发码。
- `issued`：已发放但未激活，不应再次发放。
- `used`：已激活。
- `revoked`：已作废。

## 桌面端流程

1. 启动时请求本地 `/api/auth/status`。
2. 本地后端用缓存 token 请求远程 `/api/license/status`。
3. 未登录时，用户先注册或登录。
4. 用户输入激活码，本地后端转发到远程 `/api/license/activate`。
5. 激活成功后，本地缓存账号、授权类型、到期时间。

激活码默认绑定当前设备 ID。换设备登录同一账号时，如果没有在新设备重新激活，授权服务会返回 `device_mismatch`。

核心功能接口会强制请求远程授权服务校验，不只相信本地 SQLite 缓存。授权过期、设备不匹配或授权服务不可达时，混剪、分割、高光切片、AI 改写和语音合成会被阻断。系统设置和产出记录仍可查看。

## 使用数据上报

桌面端通过公共事件服务上报产品使用事件，授权服务写入 `r_client_events`。新增功能只需要调用桌面本地后端的 `trackClientEvent()`，不要各自实现上报。

当前采集：

- 授权：注册、登录、激活成功/失败。
- 素材：导入成功/失败、素材数量和比例统计。
- 生成：混剪、智能分割、高光切片的 start/success/fail。
- AI 能力：AI 改写、TTS 成功/失败。

不采集：

- 本地完整文件路径。
- 原始视频、音频、图片内容。
- 文案全文、提示词全文。
- API Key、Token、激活码完整码。

授权服务不可达时，桌面端会先写入本机 `client_event_queue`，后续事件成功上报时自动补发。

新增模块接入规则：

- 统一调用 `web/server.mjs` 中的 `trackClientEvent(event, options)`。
- 事件名使用 `模块_动作_结果`，例如 `highlight_success`、`tts_fail`。
- `module` 使用稳定英文标识，例如 `video_mix`、`smart_segment`。
- `meta` 只放数量、模式、耗时、布尔开关、清晰度等统计字段。
- 不要在 `meta` 中放路径、文件名、文案、提示词、模型名、API Key 或激活码。

桌面端和授权服务端都会对 `meta` 做脱敏过滤，授权服务是最终写库入口。

## 本地开发

授权服务环境变量示例见 `auth-service/.env.example`。不要把真实数据库密码提交到仓库。
`AUTH_CODE_SECRET` 用于解密后台展示的完整激活码，正式环境上线后不要随意更换，否则旧激活码仍可校验但无法还原显示完整码。

```bash
cd auth-service
pnpm install
AUTH_PORT=8899 DB_HOST=127.0.0.1 DB_PORT=3306 DB_DATABASE=autocut DB_USERNAME=root DB_PASSWORD=*** DB_PREFIX=r_ pnpm dev
```

后台管理：

```bash
cd auth-service
pnpm admin:dev
```

开发期访问 `http://localhost:8900/admin/`，输入 `.env` 中的 `AUTH_ADMIN_TOKEN`。部署时先执行：

```bash
pnpm admin:build
pnpm start
```

构建后可通过授权服务访问 `http://localhost:8899/admin`。

生成激活码：

```bash
cd auth-service
pnpm codes:generate -- --type trial --days 7 --count 20
pnpm codes:generate -- --type official --days 365 --count 100
```

生成命令默认只放入库存，状态为 `available`。真正发给用户时，从库存里取码并改为 `issued`：

```bash
pnpm codes:issue -- --type trial --count 5 --to "渠道A-202607" --out ./issued-trial.txt
pnpm codes:issue -- --type official --count 1 --assigned user@example.com --out ./issued-user.txt
```

查看状态：

```bash
pnpm codes:list -- --status available --limit 50
pnpm codes:list -- --status issued --limit 50
pnpm codes:list -- --status used --limit 50
```

常用参数：

- `--type trial|official`：试用码或正式码。
- `--days 365`：激活后的授权天数。
- `--count 100`：本次生成数量。
- `--expires 2026-12-31`：激活码自身过期时间，可选。
- `--assigned user@example.com`：只允许指定账号激活，可选。
- `--to 渠道或客户名`：记录发放对象，可选。
- `--source-note 批次备注`：只从指定批次库存中取码，可选。
- `--out ./codes.txt`：保存完整激活码到文件。
- `--json`：按 JSON 格式输出。

## 正式版待补

- 后台管理页面：用户、订单、激活码、封禁和续期。
- 激活码购买后自动分配，不再手动调用管理接口。
- token 和本地授权缓存增加签名与离线宽限期。
- 设备数量限制、解绑和异常登录处理。
