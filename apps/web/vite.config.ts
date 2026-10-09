import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pdfTextAssets } from "./pdf-assets-plugin.ts";

export default defineConfig({
  plugins: [react(), pdfTextAssets()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:41823",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
