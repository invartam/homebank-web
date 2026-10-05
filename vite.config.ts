import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react],
  envDir: mode === "native" ? false : undefined,
  envPrefix: mode === "native" ? "NATIVE_UNUSED_" : "VITE_",
  define: { "import.meta.env.VITE_NATIVE_APP": JSON.stringify(mode === "native") },
  build: {
    outDir: mode === "native" ? "dist-native" : "dist",
    rollupOptions: {
      input: mode === "native" ? "native.html" : "index.html",
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes('"use client"') && warning.id?.includes("/node_modules/@mui/")) return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@mui/") || id.includes("/node_modules/@emotion/")) return "material";
          if (/\/node_modules\/(react|react-dom|react-is|scheduler)\//.test(id)) return "react";
        },
      },
    },
  },
}));
