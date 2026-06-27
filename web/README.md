# ECutAuto-Clone · Web（Vite + React + TS）

浏览器里跑的混剪工作台。前端 = Vite + React + TypeScript SPA；重活交给本地 Node 后端（复用 `../poc` 已验证的管线）。
**打包成 Tauri 时前端一行不用改**——只把 `src/api.ts` 从 `fetch` 切到 `invoke`（文件里已写好两条分支，按 `window.__TAURI_INTERNALS__` 自动判断）。

## 开发模式（热更新）

两个终端：
```bash
# 终端 1：本地后端（ffmpeg 处理 + 出片预览）
node server.mjs            # :8787

# 终端 2：Vite 前端（自动把 /api、/_run 代理到 8787）
pnpm dev                   # :5173  → 浏览器开 http://localhost:5173
```

## 预览构建产物（单进程）

```bash
pnpm build                 # tsc 类型检查 + vite 打包 → dist/
node server.mjs            # 托管 dist/ + API，访问 http://localhost:8787
```

## 结构

```
web/
├── server.mjs            # 本地后端：POST /api/mix(NDJSON 流式) + 托管 dist/ + /_run 预览
├── index.html           # Vite 入口
├── vite.config.ts       # react 插件 + 开发代理(/api,/_run → 8787)
├── src/
│   ├── main.tsx         # React 挂载 + HashRouter
│   ├── App.tsx          # 路由：/ 首页，/:id 模块
│   ├── api.ts           # ★ 后端抽象层：web=fetch / Tauri=invoke（同契约）
│   ├── styles.css       # 设计系统（薄荷浅色主题，从原版扒色还原）
│   ├── data/modules.ts  # 模块清单(对应原版 Vite chunk) + 首页分类数据
│   ├── components/
│   │   ├── Icons.tsx     # 内联 SVG 图标
│   │   └── controls.tsx  # Switch / Slider / Seg / NumStepper / Group / Field
│   └── pages/
│       ├── Home.tsx      # 首页：分类 Tab + 模块卡片
│       ├── SmartMix.tsx  # AI智能混剪三栏（基础设置/画面处理）
│       └── Stub.tsx      # 占位模块
└── _legacy/             # 早期 vanilla 版留档（可删）
```

## web → Tauri 迁移

| 阶段 | 前端 | 后端 | 说明 |
|------|------|------|------|
| Web（现在） | `src/`(React) → `dist/` | `server.mjs`(Node) | Vite 代理或 server 托管 |
| Tauri（交付） | **同一份 React 代码** | `../app/src-tauri`(Rust) | `tauri.conf.json` 的 `frontendDist` 指向 `web/dist`；`api.ts` 走 `invoke` |

Rust 端已在 `../app` 备好同名命令（`video_mixing_process` 等）。`api.ts` 检测到 `window.__TAURI_INTERNALS__` 自动切换，无需改组件。

## 模块状态

可用（复用混剪三栏 + 接后端）：AI 智能混剪、视频效果处理、视频混剪、分类混剪、视频内容提炼
占位（结构就位待接）：字幕识别、文案改写、图片转视频、文件重命名、封面设计、AI 解说口播
接入所需的滤镜配方见 `../docs/01`，数据模型见 `../docs/02`。
