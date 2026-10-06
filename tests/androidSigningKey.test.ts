// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateSigningKey, signingKeyInfo, signingOptions } from "../scripts/android-signing-key.mjs";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "homebank-signing-test-"));
  directories.push(directory);
  return { directory, options: { keystore: path.join(directory, "release.keystore"), alias: "homebank", dname: "CN=Test" } };
}
const env = { ANDROID_KEYSTORE_PASSWORD: "test-password-only", JAVA_HOME: "/test/jdk" };
function successfulKeytool(_command: string, args: string[]) {
  writeFileSync(args[args.indexOf("-keystore") + 1], "fake-test-keystore");
  return { status: 0 };
}
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Android distribution signing key", () => {
  it("uses defaults, environment overrides and explicit options, without password flags", () => {
    expect(signingOptions([], {}).keystore).toMatch(/\.signing[/\\]homebank-release\.keystore$/);
    expect(signingOptions([], {}).alias).toBe("homebank");
    expect(signingOptions(["info", "--alias", "explicit"], { ANDROID_KEY_ALIAS: "env", ANDROID_KEYSTORE_PATH: "/keys/store" }))
      .toMatchObject({ command: "info", alias: "explicit", keystore: path.resolve("/keys/store") });
    expect(signingOptions(["--help"], {}).help).toBe(true);
    for (const argv of [["--password", "secret"], ["remove"], ["generate", "info"], ["--alias", "-bad"], ["--keystore", ""]]) {
      expect(() => signingOptions(argv, {})).toThrow();
    }
  });
  it("generates a protected PKCS12 keystore with no password in process arguments", () => {
    const { directory, options } = fixture();
    const execute = vi.fn(successfulKeytool);
    expect(generateSigningKey(options, { env, execute, interactive: false })).toEqual({ keystore: options.keystore, alias: "homebank" });
    const [command, args, spawnOptions] = execute.mock.calls[0] as any;
    expect(command).toBe(path.join(env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool"));
    expect(args).toEqual(expect.arrayContaining(["PKCS12", "RSA", "4096", "SHA256withRSA", "10000", "-storepass:env", "ANDROID_KEYSTORE_PASSWORD"]));
    expect(args).not.toContain(env.ANDROID_KEYSTORE_PASSWORD);
    expect(spawnOptions.stdio).toBe("inherit");
    expect(readdirSync(directory)).toEqual(["release.keystore"]);
    if (process.platform !== "win32") expect(statSync(options.keystore).mode & 0o777).toBe(0o600);
  });
  it("never replaces an existing keystore", () => {
    const { options } = fixture();
    writeFileSync(options.keystore, "existing-important-key");
    const execute = vi.fn();
    expect(() => generateSigningKey(options, { env, execute })).toThrow("jamais ecrase");
    expect(readFileSync(options.keystore, "utf8")).toBe("existing-important-key");
    expect(execute).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === "win32")("rejects a dangling symlink as well", () => {
    const { directory, options } = fixture();
    symlinkSync(path.join(directory, "absent"), options.keystore);
    expect(() => generateSigningKey(options, { env, execute: vi.fn() })).toThrow("jamais ecrase");
  });
  it("refuses an overwrite even if a file appears while keytool runs", () => {
    const { directory, options } = fixture();
    const execute = (_command: string, args: string[]) => {
      successfulKeytool(_command, args);
      writeFileSync(options.keystore, "concurrent-key");
      return { status: 0 };
    };
    expect(() => generateSigningKey(options, { env, execute })).toThrow();
    expect(readFileSync(options.keystore, "utf8")).toBe("concurrent-key");
    expect(readdirSync(directory)).toEqual(["release.keystore"]);
  });
  it("cleans temporary keys after failure, cancellation or a missing JDK", () => {
    for (const result of [{ status: 1 }, { status: 0 }, { error: new Error("ENOENT"), status: null }]) {
      const { directory, options } = fixture();
      expect(() => generateSigningKey(options, { env, execute: () => result, interactive: false })).toThrow();
      expect(readdirSync(directory)).toEqual([]);
    }
    const { directory, options } = fixture();
    expect(() => generateSigningKey(options, { env, execute: (_command: string, args: string[]) => {
      successfulKeytool(_command, args);
      return { status: 1 };
    } })).toThrow();
    expect(readdirSync(directory)).toEqual([]);
  });
  it("requires noninteractive credentials, identity and consistent PKCS12 passwords", () => {
    const { options } = fixture();
    const execute = vi.fn();
    expect(() => generateSigningKey(options, { env: {}, execute, interactive: false })).toThrow("terminal interactif");
    expect(() => generateSigningKey(options, { env: { ANDROID_KEYSTORE_PASSWORD: "short" }, execute })).toThrow("6 caracteres");
    expect(() => generateSigningKey({ ...options, dname: undefined }, { env, execute, interactive: false })).toThrow("--dname");
    expect(() => generateSigningKey(options, { env: { ...env, ANDROID_KEY_PASSWORD: "other-password" }, execute })).toThrow("identique");
    expect(execute).not.toHaveBeenCalled();
  });
  it("lets keytool prompt interactively without passing a password", () => {
    const { options } = fixture();
    const execute = vi.fn(successfulKeytool);
    generateSigningKey({ ...options, dname: undefined }, { env: {}, execute, interactive: true });
    expect(execute.mock.calls[0][1]).not.toContain("-storepass:env");
    expect(execute.mock.calls[0][1]).not.toContain("-dname");
  });
  it("displays only the certificate information without modifying the key", () => {
    const { options } = fixture();
    const execute = vi.fn((_command: string, _args: string[]) => ({ status: 0 }));
    expect(() => signingKeyInfo(options, { env, execute })).toThrow("absent");
    writeFileSync(options.keystore, "existing-key");
    signingKeyInfo(options, { env, execute });
    expect(execute.mock.calls[0][1]).toEqual(["-list", "-v", "-keystore", options.keystore, "-alias", "homebank", "-storepass:env", "ANDROID_KEYSTORE_PASSWORD"]);
    expect(readFileSync(options.keystore, "utf8")).toBe("existing-key");
  });
  it("keeps generated keys out of git and wires the npm / Make commands", () => {
    expect(readFileSync(".gitignore", "utf8").split("\n")).toContain(".signing/");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["android:key:generate"]).toBe("node scripts/android-signing-key.mjs generate");
    expect(pkg.scripts["android:key:info"]).toBe("node scripts/android-signing-key.mjs info");
    expect(readFileSync("Makefile", "utf8")).toContain("android-key:\n\tnpm run android:key:generate");
  });
});
