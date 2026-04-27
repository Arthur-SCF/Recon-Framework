/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
  build: {
    // Never expose source maps in production — they reveal full TypeScript source
    // to anyone with network access to the app.
    sourcemap: false,
    // Disable modulepreload polyfill — it injects an inline <script> that violates
    // script-src 'self' CSP. Modern browsers support modulepreload natively.
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});
