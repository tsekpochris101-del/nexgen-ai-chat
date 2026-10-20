import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "react-dom/client", replacement: path.join(root, "src/vendor/react-dom-client.js") },
      { find: "react-dom", replacement: path.join(root, "src/vendor/react-dom.js") },
      { find: "react/jsx-runtime", replacement: path.join(root, "src/vendor/react-jsx-runtime.js") },
      { find: "react/jsx-dev-runtime", replacement: path.join(root, "src/vendor/react-jsx-dev-runtime.js") },
      { find: "react", replacement: path.join(root, "src/vendor/react.js") }
    ]
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      "localhost",
      "127.0.0.1"
    ],
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks(id) {
          const marker = "/node_modules/";
          const index = id.indexOf(marker);
          if (index === -1) return undefined;
          const packagePath = id.slice(index + marker.length).split("/");
          const packageName = packagePath[0].startsWith("@")
            ? packagePath.slice(0, 2).join("-")
            : packagePath[0];
          return `vendor-${packageName.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        }
      }
    }
  }
});