import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4174", locale: "fr-FR", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "compact", use: { ...devices["iPhone SE"], defaultBrowserType: "chromium" } },
  ],
  webServer: {
    command: process.env.E2E_PREVIEW === "1"
      ? "npm run build:e2e && npm run preview -- --mode e2e --host 127.0.0.1 --port 4174 --strictPort"
      : "npm run dev -- --mode e2e --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
