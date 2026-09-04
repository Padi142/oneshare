import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative assets work from Electron's file:// URL and Capacitor's WebView.
  base: "./",
  envPrefix: ["VITE_", "CONVEX_"],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/android/**", "**/dist-electron/**", "**/release/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
});
