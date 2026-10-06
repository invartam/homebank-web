import { listPackage } from "@electron/asar";
import { readdirSync } from "node:fs";
import path from "node:path";
import { root } from "./packaging-utils.mjs";

export function allowedDesktopFile(file) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) || /\.local\.json$/i.test(file) || /\.(xhb|p12|pfx|jks|keystore|mobileprovision|pem|key)$/i.test(file)) return false;
  return file === "/package.json" || file === "/electron" || file.startsWith("/electron/") || file === "/dist-native" || file.startsWith("/dist-native/");
}
export function verifyDesktopPackages(directory = path.join(root, "release/desktop")) {
  const walk = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(folder, entry.name)) : entry.name === "app.asar" ? [path.join(folder, entry.name)] : []);
  const archives = walk(directory);
  if (!archives.length) throw new Error("Aucune archive Electron a verifier.");
  for (const archive of archives) {
    const files = listPackage(archive).map((file) => file.replaceAll("\\", "/"));
    const unexpected = files.filter((file) => !allowedDesktopFile(file));
    if (unexpected.length) throw new Error(`Fichiers non autorises dans le paquet : ${unexpected.slice(0, 5).join(", ")}`);
    console.log(`Archive Electron verifiee : ${files.length} entrees, aucune dependance Node ou fichier prive.`);
  }
}
