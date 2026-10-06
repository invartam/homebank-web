import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkVersion, metadata, nodeTool, packageInfo, requirePlatform, root } from "./packaging-utils.mjs";
import { desktopIcon, mobileIcons } from "./icons.mjs";
import { verifyDesktopPackages } from "./verify-desktop.mjs";
import { configureMobileDrive } from "./mobile-drive-config.mjs";
import { configureMobileSecurity } from "./mobile-security.mjs";
import { verifyNativeAssets } from "./verify-native-assets.mjs";

export function buildNativeWeb() {
  nodeTool("typescript/bin/tsc");
  nodeTool("vite/bin/vite.js", ["build", "--mode", "native"]);
  renameSync(path.join(root, "dist-native/native.html"), path.join(root, "dist-native/index.html"));
  verifyNativeAssets(path.join(root, "dist-native"));
}
export function prepareDesktop() {
  desktopIcon();
  const destination = path.join(root, ".packaging/desktop");
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(path.join(root, "dist-native"), path.join(destination, "dist-native"), { recursive: true });
  cpSync(path.join(root, "electron"), path.join(destination, "electron"), { recursive: true });
  const localConfig = path.join(root, "electron-drive.local.json");
  const drive = process.env.ELECTRON_GOOGLE_CLIENT_ID !== undefined && process.env.ELECTRON_GOOGLE_CLIENT_SECRET !== undefined
    ? {} : JSON.parse(readFileSync(existsSync(localConfig) ? localConfig : path.join(root, "electron/drive.config.json"), "utf8"));
  // Only native public-client credentials are packaged, never web .env files or user tokens.
  const config = { clientId: process.env.ELECTRON_GOOGLE_CLIENT_ID ?? drive.clientId ?? "",
    clientSecret: process.env.ELECTRON_GOOGLE_CLIENT_SECRET ?? drive.clientSecret ?? "" };
  if (typeof config.clientId !== "string" || typeof config.clientSecret !== "string") throw new Error("Configuration OAuth Electron invalide.");
  writeFileSync(path.join(destination, "electron/drive.config.json"), JSON.stringify(config, null, 2));
  const pkg = packageInfo();
  writeFileSync(path.join(destination, "package.json"), JSON.stringify({
    name: "homebank-web-desktop", version: pkg.version, description: "Gestion bancaire personnelle HomeBank",
    productName: metadata.productName, author: "HomeBank Web", main: "electron/main.cjs", private: true, dependencies: {},
  }, null, 2));
}
export function syncMobile(platform) {
  if (!["ios", "android"].includes(platform)) throw new Error("Cible mobile invalide.");
  if (platform === "ios") requirePlatform("darwin");
  const destination = path.join(root, "native", platform);
  const identity = path.join(destination, ".homebank-app-id");
  if (!existsSync(destination)) {
    nodeTool("@capacitor/cli/bin/capacitor", ["add", platform]);
    writeFileSync(identity, metadata.appId);
  } else if (!existsSync(identity) || readFileSync(identity, "utf8") !== metadata.appId) {
    throw new Error(`Projet ${platform} existant ou APP_ID modifie : conserver vos modifications puis regenerer native/${platform}. Voir README_PACKAGING.md.`);
  }
  nodeTool("@capacitor/cli/bin/capacitor", ["sync", platform]);
  configureMobileDrive(platform);
  configureMobileSecurity(platform);
  mobileIcons(platform);
}
export function desktopPackage(target, arch = process.arch) {
  if (!["arm64", "x64"].includes(arch)) throw new Error("ARCH doit etre arm64 ou x64.");
  if (!["mac", "windows", "dir", "start"].includes(target)) throw new Error("Cible desktop invalide.");
  if (target === "mac") requirePlatform("darwin");
  if (target === "windows") requirePlatform("win32");
  prepareDesktop();
  if (target === "start") {
    const electron = JSON.parse(readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8"));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    nodeTool(`electron/${electron.bin.electron}`, [".packaging/desktop"], { env });
    return;
  }
  nodeTool("electron-builder/cli.js", ["--config", "electron-builder.config.cjs", "--publish", "never", `--${arch}`,
    ...(target === "dir" ? ["--dir"] : [target === "mac" ? "--mac" : "--win"])], {
      env: { ...process.env, ...(!process.env.CSC_LINK && !process.env.CSC_NAME ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" } : {}) },
    });
  verifyDesktopPackages();
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    checkVersion();
    const [command = "web", target, arch] = process.argv.slice(2);
    if (command === "desktop" && target === "mac") requirePlatform("darwin");
    if (command === "desktop" && target === "windows") requirePlatform("win32");
    buildNativeWeb();
    if (command === "desktop") desktopPackage(target ?? "dir", arch);
    else if (command === "sync") syncMobile(target);
    else if (command !== "web") throw new Error("Commande inconnue.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
