import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersion, root, run, versionInfo } from "./packaging-utils.mjs";

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : entry.isFile() ? [path.join(directory, entry.name)] : []);
}
export function releaseArtifacts(directory, version) {
  const all = files(directory);
  const artifacts = all.filter((file) => /\.(dmg|exe|zip|apk|aab|ipa)$/.test(file));
  if (all.some((file) => !artifacts.includes(file) && file !== path.join(directory, "SHA256SUMS"))) throw new Error("Fichier inattendu dans release : publication refusee.");
  if (!artifacts.length) throw new Error("Aucun package a publier.");
  for (const file of artifacts) if (!path.basename(file).startsWith("HomeBankWeb-" + version + "-")) throw new Error("Artefact d'une autre version : " + path.basename(file));
  if (new Set(artifacts.map((file) => path.basename(file))).size !== artifacts.length) throw new Error("Noms de packages dupliques.");
  return artifacts;
}
if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) try {
  const [command = "check", argument] = process.argv.slice(2);
  if (command === "prepare") {
    versionInfo(argument);
    if (!argument) throw new Error("Indiquer une version : npm run release:prepare -- 0.2.0");
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Executer cette commande avec npm run release:prepare.");
    run(process.execPath, [npmCli, "version", argument, "--no-git-tag-version", "--ignore-scripts"]);
  } else {
    const info = checkVersion(argument);
    console.log(`Version validee : ${info.version} (build ${info.buildNumber})`);
    if (command === "manifest") {
      const artifacts = releaseArtifacts(path.join(root, "release"), info.version);
      writeFileSync(path.join(root, "release/SHA256SUMS"), artifacts.sort().map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${path.basename(file)}`).join("\n") + "\n");
    } else if (command !== "check") throw new Error("Commande : check, prepare ou manifest.");
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
