import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 开发期：Vite 跑前端(5173)，把 /api 与 /_run 代理到本地 Node 后端(8787)。
// 打包期：vite build → dist/，由 server.mjs 或 Tauri 托管。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787",
      "/_run": "http://localhost:8787",
    },
  },
  build: { outDir: "dist", target: "es2020" },
});
