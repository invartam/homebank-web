import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import plist from "plist";
import { root } from "./packaging-utils.mjs";

export function mobileDriveConfig(directory = root, env = process.env) {
  const file = path.join(directory, "mobile-drive.local.json");
  const local = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (Object.keys(local).some(key => !["iosClientId", "androidClientId", "androidDebugClientId"].includes(key))) {
    throw new Error("mobile-drive.local.json doit contenir seulement les CLIENT_ID mobiles, aucun secret ni identifiant Electron/Web.");
  }
  const config = {
    iosClientId: env.MOBILE_GOOGLE_IOS_CLIENT_ID ?? local.iosClientId ?? "",
    androidClientId: env.MOBILE_GOOGLE_ANDROID_CLIENT_ID ?? local.androidClientId ?? "",
    androidDebugClientId: env.MOBILE_GOOGLE_ANDROID_DEBUG_CLIENT_ID ?? local.androidDebugClientId ?? "",
  };
  for (const value of Object.values(config)) {
    if (typeof value !== "string" || (value !== "" && !/^[A-Za-z0-9_.-]+\.apps\.googleusercontent\.com$/.test(value))) throw new Error("CLIENT_ID mobile Google invalide.");
  }
  return config;
}
export function configureMobileDrive(platform, config = mobileDriveConfig(), directory = root) {
  if (platform !== "ios") return;
  const file = path.join(directory, "native/ios/App/App/Info.plist");
  const info = plist.parse(readFileSync(file, "utf8"));
  const urls = (info.CFBundleURLTypes ?? []).filter(entry => entry.CFBundleURLName !== "homebank-google-drive");
  if (config.iosClientId) urls.push({ CFBundleURLName: "homebank-google-drive", CFBundleURLSchemes: [config.iosClientId.split(".").reverse().join(".")] });
  if (urls.length) info.CFBundleURLTypes = urls;
  else delete info.CFBundleURLTypes;
  writeFileSync(file, plist.build(info));
}
