import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : []),
      ...(process.env.REPLIT_DOMAINS ? process.env.REPLIT_DOMAINS.split(",").map((domain) => domain.trim()).filter(Boolean) : [])
    ],
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist"
  }
});