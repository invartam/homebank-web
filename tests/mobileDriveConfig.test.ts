// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import plist from "plist";
import { parse } from "yaml";
import { mobileDriveConfig, configureMobileDrive } from "../scripts/mobile-drive-config.mjs";

const folders: string[] = [];
function folder() { const value = mkdtempSync(path.join(tmpdir(), "homebank-mobile-config-")); folders.push(value); return value; }
afterEach(() => folders.splice(0).forEach(directory => rmSync(directory, { force: true, recursive: true })));
describe("mobile Drive packaging", () => {
  it("requires separate native clients and never imports Electron or web secrets", () => {
    const directory = folder();
    expect(mobileDriveConfig(directory, {})).toEqual({ iosClientId: "", androidClientId: "", androidDebugClientId: "" });
    writeFileSync(path.join(directory, "electron-drive.local.json"), JSON.stringify({ clientId: "desktop.apps.googleusercontent.com", clientSecret: "not-mobile" }));
    writeFileSync(path.join(directory, "mobile-drive.local.json"), JSON.stringify({ iosClientId: "ios.apps.googleusercontent.com" }));
    const config = mobileDriveConfig(directory, { VITE_GOOGLE_CLIENT_ID: "web", MOBILE_GOOGLE_ANDROID_CLIENT_ID: "android.apps.googleusercontent.com" });
    expect(config).toEqual({ iosClientId: "ios.apps.googleusercontent.com", androidClientId: "android.apps.googleusercontent.com", androidDebugClientId: "" });
    expect(() => mobileDriveConfig(directory, { MOBILE_GOOGLE_IOS_CLIENT_ID: "invalid" })).toThrow("invalide");
    writeFileSync(path.join(directory, "mobile-drive.local.json"), JSON.stringify({ clientSecret: "never-package-me" }));
    expect(() => mobileDriveConfig(directory, {})).toThrow("aucun secret");
  });
  it("sets the iOS return scheme idempotently and preserves unrelated URL registrations", () => {
    const directory = folder(); const target = path.join(directory, "native/ios/App/App"); mkdirSync(target, { recursive: true });
    const file = path.join(target, "Info.plist");
    writeFileSync(file, plist.build({ CFBundleDisplayName: "HomeBank", CFBundleURLTypes: [{ CFBundleURLName: "other", CFBundleURLSchemes: ["other-app"] }] }));
    const config = { iosClientId: "123-ios.apps.googleusercontent.com", androidClientId: "", androidDebugClientId: "" };
    configureMobileDrive("ios", config, directory); configureMobileDrive("ios", config, directory);
    const info = plist.parse(readFileSync(file, "utf8")) as any;
    expect(info.CFBundleURLTypes).toEqual([{ CFBundleURLName: "other", CFBundleURLSchemes: ["other-app"] }, { CFBundleURLName: "homebank-google-drive", CFBundleURLSchemes: ["com.googleusercontent.apps.123-ios"] }]);
    configureMobileDrive("ios", { ...config, iosClientId: "" }, directory);
    expect((plist.parse(readFileSync(file, "utf8")) as any).CFBundleURLTypes).toHaveLength(1);
  });
  it("keeps native credentials out of JavaScript and enables platform-specific CI configuration", () => {
    const swift = readFileSync("native-plugins/homebank-drive/ios/Sources/HomeBankDrivePlugin/HomeBankDrivePlugin.swift", "utf8");
    const java = readFileSync("native-plugins/homebank-drive/android/src/main/java/io/homebank/drive/HomeBankDrivePlugin.java", "utf8");
    expect(swift).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(swift).toContain("OIDAuthState.authState");
    expect(java).toContain("PICKER_OAUTH_TRIGGER");
    expect(java).toContain("setOptOutIncludingGrantedScopes(true)");
    expect(java).not.toContain('putString("token"');
    expect(readFileSync("native-plugins/homebank-drive/Package.swift", "utf8")).toContain('.library(name: "HomebankCapacitorDrive"');
    const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
    expect(workflow.jobs.ios.env.MOBILE_GOOGLE_IOS_CLIENT_ID).toContain("vars.MOBILE_GOOGLE_IOS_CLIENT_ID");
    expect(workflow.jobs.android.env.MOBILE_GOOGLE_ANDROID_DEBUG_CLIENT_ID).toContain("vars.MOBILE_GOOGLE_ANDROID_DEBUG_CLIENT_ID");
  });
});
