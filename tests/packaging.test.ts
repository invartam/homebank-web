// @vitest-environment node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkVersion, versionInfo } from "../scripts/packaging-utils.mjs";
import { validateProfile } from "../scripts/mobile-build.mjs";
import viteConfig from "../vite.config";
import { allowedDesktopFile } from "../scripts/verify-desktop.mjs";

const require = createRequire(import.meta.url);
const { assetPath } = require("../electron/security.cjs");
describe("packaging and release contracts", () => {
  it("validates the version against package-lock and the exact release tag", () => {
    const info = checkVersion();
    expect(checkVersion(`v${info.version}`).version).toBe(info.version);
    expect(() => checkVersion("v999.0.0")).toThrow("ne correspond pas");
  });
  it("maps stable and prerelease versions into native version fields", () => {
    expect(versionInfo("1.2.3", "42")).toEqual({ version: "1.2.3", marketingVersion: "1.2.3", buildNumber: 42, prerelease: false });
    expect(versionInfo("1.2.3-rc.1", "43")).toMatchObject({ marketingVersion: "1.2.3", buildNumber: 43, prerelease: true });
    expect(versionInfo("0.1.0", null).buildNumber).toBe(1001);
  });
  it("rejects invalid versions and native build numbers", () => {
    for (const version of ["v1.2.3", "1.2", "1.2.3+private", "01.2.3", "1.2.3;echo bad"]) expect(() => versionInfo(version)).toThrow();
    for (const number of ["0", "-1", "1.5", "NaN", "2100000001"]) expect(() => versionInfo("1.2.3", number)).toThrow();
    expect(() => versionInfo("1.1000.0", null)).toThrow();
  });
  it("only serves assets inside the packaged application and rejects foreign origins", () => {
    const root = path.resolve(".packaging/test-assets");
    expect(assetPath(root, "homebank://app/")).toBe(path.join(root, "index.html"));
    expect(assetPath(root, "homebank://app/assets/app.js?v=1")).toBe(path.join(root, "assets/app.js"));
    for (const url of ["https://app/index.html", "homebank://evil/index.html", "homebank://user@app/index.html", "homebank://app:99/index.html", "homebank://app/%2e%2e%2fsecret", "homebank://app/%5csecret", "homebank://app/%00", "homebank://app/%zz"]) expect(assetPath(root, url)).toBeNull();
  });
  it("isolates native builds from local web env files and Google scripts", () => {
    const config = viteConfig({ mode: "native", command: "build" });
    expect(config.envDir).toBe(false);
    expect(config.envPrefix).toBe("NATIVE_UNUSED_");
    expect(config.define["import.meta.env.VITE_NATIVE_APP"]).toBe("true");
    expect(readFileSync("native.html", "utf8")).not.toContain("google.com");
  });
  it("isolates Pages from local env files and publishes only the tested dist with deployment permissions", () => {
    const config = viteConfig({ mode: "pages", command: "build" });
    expect(config.envDir).toBe(false);
    expect(config.define["import.meta.env.VITE_NATIVE_APP"]).toBe("false");
    const workflow = parse(readFileSync(".github/workflows/pages.yml", "utf8"));
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
    expect(workflow.jobs.deploy.needs).toBe("build");
    const steps = workflow.jobs.build.steps;
    expect(steps.some((step: any) => step.run === "npm test")).toBe(true);
    expect(steps.some((step: any) => step.run === "npm run test:pages")).toBe(true);
    expect(steps.find((step: any) => step.uses?.startsWith("actions/upload-pages-artifact@")).with.path).toBe("dist");
  });
  it("rejects dependencies, local env files and wallets in the desktop package", () => {
    for (const file of ["/package.json", "/electron/main.cjs", "/dist-native/index.html"]) expect(allowedDesktopFile(file)).toBe(true);
    for (const file of ["/.env.local", "/node_modules/react/index.js", "/wallet.xhb", "/src/App.tsx", "/dist-native/private.xhb", "/dist-native/.env.local", "/electron/certificate.p12"]) expect(allowedDesktopFile(file)).toBe(false);
  });
  const profile = { UUID: "uuid", TeamIdentifier: ["TEAM"], Entitlements: { "application-identifier": "TEAM.io.example.app", "get-task-allow": false }, ProvisionedDevices: ["device"], ExpirationDate: "2099-01-01" };
  it("accepts a valid matching Ad Hoc distribution profile", () => {
    expect(validateProfile(profile, "io.example.app", "TEAM")).toBe("uuid");
  });
  it("rejects development, App Store, enterprise, expired and mismatched profiles", () => {
    for (const invalid of [
      { ...profile, Entitlements: { ...profile.Entitlements, "get-task-allow": true } },
      { ...profile, ProvisionedDevices: [] }, { ...profile, ProvisionsAllDevices: true },
      { ...profile, ExpirationDate: "2000-01-01" }, { ...profile, TeamIdentifier: ["OTHER"] },
      { ...profile, Entitlements: { ...profile.Entitlements, "application-identifier": "TEAM.other.app" } },
    ]) expect(() => validateProfile(invalid, "io.example.app", "TEAM")).toThrow();
  });
  it("publishes only successful desktop builds, allows omitted mobiles and rejects failed or cancelled builds", () => {
    const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.permissions.contents).toBe("read");
    expect(workflow.jobs.publish.permissions.contents).toBe("write");
    expect(workflow.jobs.assemble.needs).toEqual(["validate", "desktop", "android", "ios"]);
    expect(workflow.jobs.publish.needs).toBe("assemble");
    expect(workflow.jobs.publish.if).toBe("github.ref_type == 'tag'");
    const assemble = new Function("needs", "cancelled", `return (${workflow.jobs.assemble.if});`);
    const results = (validate = "success", desktop = "success", android = "skipped", ios = "skipped") => ({
      validate: { result: validate }, desktop: { result: desktop }, android: { result: android }, ios: { result: ios },
    });
    expect(assemble(results(), () => false)).toBe(true);
    expect(assemble(results("success", "success", "success", "success"), () => false)).toBe(true);
    expect(assemble(results(), () => true)).toBe(false);
    for (const failed of ["failure", "cancelled"]) {
      for (const index of [0, 1, 2, 3]) {
        const statuses = ["success", "success", "skipped", "skipped"];
        statuses[index] = failed;
        expect(assemble(results(...statuses), () => false)).toBe(false);
      }
    }
    for (const name of ["desktop", "android", "ios"]) expect(workflow.jobs[name].needs).toBe("validate");
    const artifacts = Object.values(workflow.jobs).flatMap((job: any) => job.steps ?? []).filter((step: any) => step.uses?.startsWith("actions/upload-artifact"));
    for (const step of artifacts) expect(step.with.path).not.toMatch(/\.packaging|\.p12|\.jks|\.mobileprovision/);
    expect(workflow.on.workflow_dispatch.inputs.include_mobile.default).toBe(false);
    for (const name of ["android", "ios"]) expect(workflow.jobs[name].if).toContain("INCLUDE_MOBILE_RELEASES");
    expect(workflow.jobs.desktop.strategy.matrix.include.map((item: any) => `${item.target}-${item.arch}`))
      .toEqual(["mac-arm64", "mac-x64", "windows-x64", "linux-x64"]);
    const targets = require("../electron-builder.config.cjs");
    expect(targets.linux.target).toEqual(["deb", "rpm"]);
    expect(targets.deb.depends).toEqual(expect.arrayContaining(["libsecret-1-0", "libgbm1", "libasound2t64 | libasound2"]));
    expect(targets.rpm.depends).toEqual(expect.arrayContaining(["libsecret", "mesa-libgbm", "alsa-lib"]));
    expect(targets.mac.target).toContain("dmg");
    expect(targets.win.target).toContain("nsis");
  });
});
