// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { MAX_WALLET_BYTES, readWalletResponse } from "../src/lib/fileLimits";
import { configureMobileSecurity } from "../scripts/mobile-security.mjs";
import { verifyNativeAssets } from "../scripts/verify-native-assets.mjs";
import { releaseArtifacts } from "../scripts/release.mjs";
const require = createRequire(import.meta.url);
const { readLimitedResponse } = require("../electron/http.cjs");
const folders: string[] = [];
function folder() {
  const directory = mkdtempSync(path.join(tmpdir(), "homebank-security-review-"));
  folders.push(directory); return directory;
}
afterEach(() => folders.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

describe("security review regressions", () => {
  it("bounds streamed responses even without a Content-Length", async () => {
    for (const read of [readWalletResponse, (response: Response) => readLimitedResponse(response, MAX_WALLET_BYTES)]) {
      expect(await read(new Response("<homebank/>"))).toBe("<homebank/>");
      await expect(read(new Response("small", { headers: { "content-length": String(MAX_WALLET_BYTES + 1) } }))).rejects.toThrow();
      let cancelled = false;
      const stream = new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(MAX_WALLET_BYTES / 4)); },
        cancel() { cancelled = true; },
      });
      await expect(read(new Response(stream))).rejects.toThrow("volumineux");
      expect(cancelled).toBe(true);
    }
    expect(await readLimitedResponse(new Response("a\u{1F600}b"), 6)).toBe("a\u{1F600}b");
    await expect(readLimitedResponse(new Response("a\u{1F600}b"), 5)).rejects.toMatchObject({ kind: "api", status: 413, retryable: false });
  });
  it("preserves UTF-8 decoder state across chunks", async () => {
    const bytes = new TextEncoder().encode("a\u{1F600}b");
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 3)); controller.enqueue(bytes.slice(3)); controller.close();
    } });
    expect(await readWalletResponse(new Response(stream))).toBe("a\u{1F600}b");
  });
  it("sets Android backup exclusions idempotently without changing activities", () => {
    const directory = folder();
    const main = path.join(directory, "native/android/app/src/main");
    mkdirSync(main, { recursive: true }); mkdirSync(path.join(directory, "build"));
    for (const file of ["homebank_backup_rules.xml", "homebank_data_extraction_rules.xml"]) cpSync(path.join("build", file), path.join(directory, "build", file));
    const file = path.join(main, "AndroidManifest.xml");
    writeFileSync(file, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:allowBackup="true"><activity android:name=".MainActivity"/></application></manifest>');
    configureMobileSecurity("android", directory);
    const result = readFileSync(file, "utf8"); configureMobileSecurity("android", directory);
    expect(readFileSync(file, "utf8")).toBe(result);
    for (const value of ['android:allowBackup="false"', 'android:usesCleartextTraffic="false"', 'android:fullBackupContent="@xml/homebank_backup_rules"', 'android:dataExtractionRules="@xml/homebank_data_extraction_rules"', 'android:name=".MainActivity"']) expect(result).toContain(value);
    const rules = readFileSync(path.join(main, "res/xml/homebank_data_extraction_rules.xml"), "utf8");
    expect(rules).toContain("<cloud-backup>"); expect(rules).toContain("<device-transfer>");
    expect(rules).toContain('domain="database" path="."');
  });
  it("rejects private files from native assets and release publication", () => {
    const directory = folder();
    writeFileSync(path.join(directory, "index.html"), "<html/>");
    expect(() => verifyNativeAssets(directory)).not.toThrow();
    for (const name of ["bank.xhb", ".env.local", "mobile-drive.local.json", "signing.keystore"]) {
      const file = path.join(directory, name); writeFileSync(file, "fictitious-test-data");
      expect(() => verifyNativeAssets(directory)).toThrow(); rmSync(file);
    }
    rmSync(path.join(directory, "index.html"));
    const apk = path.join(directory, "HomeBankWeb-0.1.0-android-release.apk");
    writeFileSync(apk, "test-package");
    expect(releaseArtifacts(directory, "0.1.0")).toEqual([apk]);
    writeFileSync(path.join(directory, "private.keystore"), "fictitious-test-data");
    expect(() => releaseArtifacts(directory, "0.1.0")).toThrow("publication refusee");
  });
  it("hardens Electron fuses and pins all GitHub Actions to commits", () => {
    expect(require("../electron-builder.config.cjs").electronFuses).toMatchObject({ runAsNode: false, enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true, enableEmbeddedAsarIntegrityValidation: true });
    for (const name of ["ci", "release"]) {
      const workflow = parse(readFileSync(".github/workflows/" + name + ".yml", "utf8"));
      for (const job of Object.values(workflow.jobs) as any[]) {
        for (const step of job.steps ?? []) if (step.uses) expect(step.uses).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
      }
    }
  });
  it("keeps the proxy bootstrap API compatible without sprintf-js", () => {
    const result = spawnSync(process.execPath, ["-e", 'const agent = require("global-agent"); if (typeof agent.bootstrap !== "function") process.exit(1); agent.bootstrap(); if (!global.GLOBAL_AGENT) process.exit(2);'], {
      env: { ...process.env, GLOBAL_AGENT_HTTP_PROXY: "", GLOBAL_AGENT_HTTPS_PROXY: "", GLOBAL_AGENT_NO_PROXY: "" }, encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(Object.keys(lock.packages)).not.toContain("node_modules/sprintf-js");
  });
});
