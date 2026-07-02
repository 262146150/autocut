import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dir,
  base: "/admin/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8899",
    },
  },
  build: {
    outDir: path.resolve(__dir, "../admin-dist"),
    emptyOutDir: true,
  },
});
