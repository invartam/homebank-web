import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import plist from "plist";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNativeWeb, syncMobile } from "./native-build.mjs";
import { checkVersion, metadata, requireFile, requirePlatform, requiredEnv, root, run } from "./packaging-utils.mjs";

function android(mode, info) {
  if (!["debug", "release"].includes(mode)) throw new Error("Mode Android : debug ou release.");
  requiredEnv(["JAVA_HOME"]);
  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) throw new Error("Configurer ANDROID_HOME vers le SDK Android.");
  if (mode === "release") {
    requiredEnv(["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]);
    requireFile(process.env.ANDROID_KEYSTORE_PATH);
  }
  syncMobile("android");
  const cwd = path.join(root, "native/android");
  const gradle = path.join(cwd, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const args = ["--no-daemon", "--init-script", path.join(root, "build/android-release.gradle"),
    ...(mode === "debug" ? ["assembleDebug"] : ["assembleRelease", "bundleRelease"])];
  run(gradle, args, { cwd, shell: process.platform === "win32", env: { ...process.env, APP_VERSION: info.version, BUILD_NUMBER: String(info.buildNumber) } });
  const output = path.join(root, "release/android");
  mkdirSync(output, { recursive: true });
  copyFileSync(requireFile(path.join(cwd, `app/build/outputs/apk/${mode}/app-${mode}.apk`)), path.join(output, `HomeBankWeb-${info.version}-android-${mode}.apk`));
  if (mode === "release") copyFileSync(requireFile(path.join(cwd, "app/build/outputs/bundle/release/app-release.aab")), path.join(output, `HomeBankWeb-${info.version}-android-release.aab`));
}

export function readProfile(file) {
  const xml = run("security", ["cms", "-D", "-i", requireFile(file)], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  return plist.parse(xml);
}
export function validateProfile(profile, appId, teamId, now = new Date()) {
  if (profile.TeamIdentifier?.[0] !== teamId || profile.Entitlements?.["application-identifier"] !== `${teamId}.${appId}`) throw new Error("Le profil Ad Hoc ne correspond pas a APP_ID / IOS_TEAM_ID.");
  if (!profile.UUID || !profile.ProvisionedDevices?.length || profile.Entitlements?.["get-task-allow"] !== false || profile.ProvisionsAllDevices) throw new Error("Un profil de distribution Ad Hoc avec appareils enregistres est requis.");
  if (new Date(profile.ExpirationDate) <= now || !Number.isFinite(Date.parse(profile.ExpirationDate))) throw new Error("Profil Ad Hoc expire ou invalide.");
  return profile.UUID;
}
function ios(mode, info) {
  requirePlatform("darwin");
  if (!["simulator", "adhoc"].includes(mode)) throw new Error("Mode iOS : simulator ou adhoc.");
  let uuid;
  if (mode === "adhoc") {
    requiredEnv(["IOS_TEAM_ID", "IOS_PROFILE_PATH"]);
    uuid = validateProfile(readProfile(process.env.IOS_PROFILE_PATH), metadata.appId, process.env.IOS_TEAM_ID);
    const profiles = path.join(process.env.HOME, "Library/MobileDevice/Provisioning Profiles");
    mkdirSync(profiles, { recursive: true });
    copyFileSync(process.env.IOS_PROFILE_PATH, path.join(profiles, `${uuid}.mobileprovision`));
  }
  syncMobile("ios");
  const output = path.join(root, "release/ios");
  mkdirSync(output, { recursive: true });
  const common = ["-project", "native/ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release",
    `MARKETING_VERSION=${info.marketingVersion}`, `CURRENT_PROJECT_VERSION=${info.buildNumber}`];
  if (mode === "simulator") {
    const derived = path.join(root, ".packaging/ios-simulator");
    run("xcodebuild", [...common, "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, "CODE_SIGNING_ALLOWED=NO", "build"]);
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", requireFile(path.join(derived, "Build/Products/Release-iphonesimulator/App.app")), path.join(output, `HomeBankWeb-${info.version}-ios-simulator.zip`)]);
    return;
  }
  const archive = path.join(root, ".packaging/ios/App.xcarchive");
  const signing = ["CODE_SIGN_STYLE=Manual", "CODE_SIGN_IDENTITY=Apple Distribution", `DEVELOPMENT_TEAM=${process.env.IOS_TEAM_ID}`, `PROVISIONING_PROFILE_SPECIFIER=${uuid}`];
  if (process.env.IOS_KEYCHAIN_PATH) signing.push(`OTHER_CODE_SIGN_FLAGS=--keychain ${process.env.IOS_KEYCHAIN_PATH}`);
  run("xcodebuild", [...common, "-destination", "generic/platform=iOS", "-archivePath", archive, ...signing, "archive"]);
  const options = path.join(root, ".packaging/ios/ExportOptions.plist");
  writeFileSync(options, plist.build({ method: "release-testing", teamID: process.env.IOS_TEAM_ID,
    signingStyle: "manual", signingCertificate: "Apple Distribution", provisioningProfiles: { [metadata.appId]: uuid }, manageAppVersionAndBuildNumber: false }));
  const exported = path.join(root, ".packaging/ios/export");
  run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", exported, "-exportOptionsPlist", options]);
  copyFileSync(requireFile(path.join(exported, "App.ipa")), path.join(output, `HomeBankWeb-${info.version}-ios-adhoc.ipa`));
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const info = checkVersion();
    const [platform, mode] = process.argv.slice(2);
    if (platform === "ios") requirePlatform("darwin");
    if (!["android", "ios"].includes(platform)) throw new Error("Cible mobile invalide.");
    buildNativeWeb();
    if (platform === "android") android(mode ?? "debug", info);
    else ios(mode ?? "simulator", info);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
