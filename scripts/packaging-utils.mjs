import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import semver from "semver";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const metadata = JSON.parse(readFileSync(path.join(root, "packaging.config.json"), "utf8"));
export const packageInfo = () => JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
export function versionInfo(version = packageInfo().version, buildNumber = process.env.BUILD_NUMBER) {
  const parsed = semver.parse(version);
  if (!parsed || parsed.version !== version || parsed.build.length) throw new Error("Version SemVer invalide : utiliser X.Y.Z ou X.Y.Z-rc.N, sans metadonnees.");
  const code = Number(buildNumber ?? (parsed.major * 1000000 + parsed.minor * 1000 + parsed.patch + 1));
  if (!Number.isSafeInteger(code) || code < 1 || code > 2100000000 || (!buildNumber && (parsed.minor > 999 || parsed.patch > 999))) throw new Error("BUILD_NUMBER doit etre un entier entre 1 et 2100000000.");
  return { version, marketingVersion: `${parsed.major}.${parsed.minor}.${parsed.patch}`, buildNumber: code, prerelease: parsed.prerelease.length > 0 };
}
export function checkVersion(tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined) {
  const info = versionInfo();
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (lock.version !== info.version || lock.packages[""].version !== info.version) throw new Error("package-lock.json et package.json n'ont pas la meme version.");
  if (tag && tag !== `v${info.version}`) throw new Error(`Le tag ${tag} ne correspond pas a v${info.version}.`);
  return info;
}
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} a echoue (code ${result.status}).`);
  return result.stdout;
}
export const nodeTool = (file, args = [], options) => run(process.execPath, [path.join(root, "node_modules", file), ...args], options);
export function requirePlatform(platform) {
  if (process.platform !== platform) throw new Error(`Cette cible exige ${platform}. Utiliser la pipeline GitHub pour les autres plateformes.`);
}
export function requiredEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Configuration manquante : ${missing.join(", ")}. Voir README_PACKAGING.md.`);
}
export function requireFile(file) {
  if (!existsSync(file)) throw new Error(`Fichier absent : ${file}`);
  return file;
}
