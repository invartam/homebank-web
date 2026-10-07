import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react],
  envDir: mode === "native" || mode === "e2e" ? false : undefined,
  envPrefix: mode === "native" ? "NATIVE_UNUSED_" : mode === "e2e" ? "E2E_UNUSED_" : "VITE_",
  define: {
    "import.meta.env.VITE_NATIVE_APP": JSON.stringify(mode === "native"),
    // OAuth and Drive are mocked in Playwright, independently of local credentials.
    ...(mode === "e2e" ? {
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify("123456789-e2e.apps.googleusercontent.com"),
      "import.meta.env.VITE_GOOGLE_API_KEY": JSON.stringify("e2e-not-a-google-api-key"),
      "import.meta.env.VITE_GOOGLE_APP_ID": JSON.stringify("123456789"),
    } : {}),
  },
  build: {
    outDir: mode === "native" ? "dist-native" : mode === "e2e" ? "dist-e2e" : "dist",
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
