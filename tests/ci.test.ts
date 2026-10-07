// @vitest-environment node
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import viteConfig from "../vite.config";
import playwrightConfig from "../playwright.config";

afterEach(() => vi.unstubAllEnvs());

describe("CI environment isolation", () => {
  it("builds browser tests with dummy Google configuration, ignoring local files and process credentials", () => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "must-not-be-used");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "must-not-be-used");
    const config = viteConfig({ mode: "e2e", command: "build" });
    expect(config.envDir).toBe(false);
    expect(config.envPrefix).toBe("E2E_UNUSED_");
    expect(config.build.outDir).toBe("dist-e2e");
    expect(config.define).toMatchObject({
      "import.meta.env.VITE_NATIVE_APP": "false",
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify("123456789-e2e.apps.googleusercontent.com"),
      "import.meta.env.VITE_GOOGLE_API_KEY": JSON.stringify("e2e-not-a-google-api-key"),
      "import.meta.env.VITE_GOOGLE_APP_ID": JSON.stringify("123456789"),
    });
  });

  it("does not inject test credentials or test output into production and native builds", () => {
    for (const mode of ["production", "native"]) {
      const config = viteConfig({ mode, command: "build" });
      expect(config.build.outDir).toBe(mode === "native" ? "dist-native" : "dist");
      for (const name of ["CLIENT_ID", "API_KEY", "APP_ID"]) {
        expect(Object.keys(config.define)).not.toContain("import.meta.env.VITE_GOOGLE_" + name);
      }
    }
    expect(viteConfig({ mode: "production", command: "build" }).envDir).toBeUndefined();
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts.build).toBe("tsc && vite build");
    expect(scripts["build:e2e"]).toBe("tsc && vite build --mode e2e");
  });

  it("starts Playwright in isolated e2e mode for both development and preview", async () => {
    expect(playwrightConfig.webServer.command).toContain("--mode e2e");
    expect(playwrightConfig.webServer.reuseExistingServer).toBe(false);
    vi.stubEnv("E2E_PREVIEW", "1");
    vi.resetModules();
    const preview = (await import("../playwright.config")).default;
    expect(preview.webServer.command).toBe("npm run build:e2e && npm run preview -- --mode e2e --host 127.0.0.1 --port 4174 --strictPort");
    vi.stubEnv("E2E_PREVIEW", "0");
    vi.resetModules();
    const dev = (await import("../playwright.config")).default;
    expect(dev.webServer.command).toBe("npm run dev -- --mode e2e --host 127.0.0.1 --port 4174 --strictPort");
  });

  for (const [name, webJob] of [["ci", "web"], ["release", "validate"]]) {
    it(`${name}: initializes SDK 36 and its licenses before building Android`, () => {
      const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
      const steps = workflow.jobs.android.steps;
      const setupIndex = steps.findIndex((step: any) => step.uses?.startsWith("android-actions/setup-android@"));
      const javaIndex = steps.findIndex((step: any) => step.uses?.startsWith("actions/setup-java@"));
      const buildIndex = steps.findIndex((step: any) => step.run?.includes("npm run android:"));
      expect(setupIndex).toBeGreaterThan(javaIndex);
      expect(buildIndex).toBeGreaterThan(setupIndex);
      expect(steps[javaIndex].with["java-version"]).toBe("21");
      expect(steps[setupIndex].with).toEqual({
        "cmdline-tools-version": "15859902",
        "accept-android-sdk-licenses": true,
        "log-accepted-android-sdk-licenses": false,
        packages: "platform-tools platforms;android-36 build-tools;36.0.0",
      });
      for (const step of steps) expect(step.run ?? "").not.toContain("yes | sdkmanager");
    });

    it(`${name}: runs the preview tests without Google secrets`, () => {
      const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
      const steps = workflow.jobs[webJob].steps;
      const tests = steps.find((step: any) => step.run === "npm run test:e2e");
      expect(tests.env).toEqual({ E2E_PREVIEW: "1" });
      expect(steps.some((step: any) => step.run === "npm run build")).toBe(true);
    });
  }
});
