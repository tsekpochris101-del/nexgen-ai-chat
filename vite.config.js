import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.PORT || 5173);

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext"
    }
  },
  server: {
    host: "0.0.0.0",
    port,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_SERVER_URL || "http://127.0.0.1:8080",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port,
    allowedHosts: true
  },
  build: {
    outDir: "dist",
    target: "esnext"
  }
});