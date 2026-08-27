import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname, "tencent-web"),
  publicDir: path.resolve(__dirname, "public"),
  base: "/love-diary/",
  plugins: [
    {
      name: "love-diary-demo-mode",
      transformIndexHtml(html) {
        return html.replace(
          '<meta name="love-diary-api-base" content="" />',
          '<meta name="love-diary-api-base" content="" />\n    <meta name="love-diary-demo-mode" content="true" />',
        );
      },
    },
    react(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  css: {
    postcss: path.resolve(__dirname, "postcss.config.mjs"),
  },
  build: {
    outDir: path.resolve(__dirname, "dist-pages"),
    emptyOutDir: true,
  },
});
