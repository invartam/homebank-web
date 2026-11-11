import { defineConfig, devices } from "@playwright/test";

const base = `${process.env.PAGES_BASE_PATH ?? "/homebank-web"}/`;
export default defineConfig({
  testDir: "./tests/pages",
  use: { baseURL: `http://127.0.0.1:4175${base}`, locale: "fr-FR", trace: "retain-on-failure" },
  projects: [{ name: "pages", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run preview -- --mode pages --base ${base} --port 4175 --strictPort`,
    url: `http://127.0.0.1:4175${base}`,
    reuseExistingServer: false,
  },
});
