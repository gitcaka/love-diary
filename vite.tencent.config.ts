import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname, "tencent-web"),
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.mjs"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist-tencent"),
    emptyOutDir: true,
  },
});
