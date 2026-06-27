import { defineConfig } from "vite";

// Tauri 期望固定端口 1420
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", outDir: "dist" },
});
