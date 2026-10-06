import { constants, chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { root } from "./packaging-utils.mjs";

export function signingOptions(argv, env = process.env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, keystore: { type: "string" },
    alias: { type: "string" }, dname: { type: "string" },
  } });
  const command = positionals[0] ?? "generate";
  if (positionals.length > 1 || !["generate", "info"].includes(command)) throw new Error("Commande : generate ou info.");
  const alias = values.alias ?? env.ANDROID_KEY_ALIAS ?? "homebank";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias)) throw new Error("Alias invalide : lettres ASCII, chiffres, points, tirets et underscores uniquement.");
  const keystore = values.keystore ?? env.ANDROID_KEYSTORE_PATH ?? path.join(root, ".signing/homebank-release.keystore");
  if (!keystore) throw new Error("Chemin du keystore vide.");
  return { command, help: values.help ?? false, keystore: path.resolve(keystore), alias, dname: values.dname };
}

function passwordArgs(env, interactive) {
  if (env.ANDROID_KEYSTORE_PASSWORD) {
    if (env.ANDROID_KEYSTORE_PASSWORD.length < 6) throw new Error("Le mot de passe du keystore doit contenir au moins 6 caracteres.");
    // Pass the variable name, never the password itself, in the process arguments.
    return ["-storepass:env", "ANDROID_KEYSTORE_PASSWORD"];
  }
  if (!interactive) throw new Error("Utiliser un terminal interactif ou definir ANDROID_KEYSTORE_PASSWORD dans l'environnement.");
  return [];
}

function keytool(args, { env, execute }) {
  const command = env.JAVA_HOME ? path.join(env.JAVA_HOME, "bin", process.platform === "win32" ? "keytool.exe" : "keytool") : "keytool";
  const result = execute(command, args, { stdio: "inherit", env });
  if (result.error) throw new Error("Impossible de lancer keytool. Installer un JDK et verifier JAVA_HOME / PATH.");
  if (result.status !== 0) throw new Error("keytool a echoue ou a ete annule.");
}

function exists(file) {
  try { lstatSync(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export function generateSigningKey(options, { env = process.env, execute = spawnSync,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) } = {}) {
  if (exists(options.keystore)) throw new Error("Le keystore existe deja : il ne sera jamais ecrase. Utiliser la commande info pour consulter son certificat.");
  const password = passwordArgs(env, interactive);
  if (env.ANDROID_KEY_PASSWORD && env.ANDROID_KEY_PASSWORD !== env.ANDROID_KEYSTORE_PASSWORD) {
    throw new Error("Pour le nouveau keystore PKCS12, ANDROID_KEY_PASSWORD doit etre absent ou identique a ANDROID_KEYSTORE_PASSWORD.");
  }
  if (!interactive && !options.dname) throw new Error("Hors terminal interactif, fournir --dname, par exemple 'CN=HomeBank Wallet'.");
  mkdirSync(path.dirname(options.keystore), { recursive: true, mode: 0o700 });
  const temporary = mkdtempSync(path.join(path.dirname(options.keystore), ".homebank-key-"));
  if (process.platform !== "win32") chmodSync(temporary, 0o700);
  try {
    const generated = path.join(temporary, "signing.keystore");
    keytool(["-genkeypair", "-v", "-keystore", generated, "-storetype", "PKCS12",
      "-alias", options.alias, "-keyalg", "RSA", "-keysize", "4096", "-sigalg", "SHA256withRSA",
      "-validity", "10000", ...password, ...(options.dname ? ["-dname", options.dname] : [])], { env, execute });
    if (!exists(generated) || !statSync(generated).isFile() || statSync(generated).size === 0) {
      throw new Error("Generation annulee : aucun keystore cree.");
    }
    if (process.platform !== "win32") chmodSync(generated, 0o600);
    // Publish only a completed keystore, without overwriting a concurrent creation.
    copyFileSync(generated, options.keystore, constants.COPYFILE_EXCL);
    if (process.platform !== "win32") chmodSync(options.keystore, 0o600);
    return { keystore: options.keystore, alias: options.alias };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function signingKeyInfo(options, { env = process.env, execute = spawnSync,
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) } = {}) {
  if (!exists(options.keystore)) throw new Error("Keystore absent. Creer la cle avec npm run android:key:generate.");
  keytool(["-list", "-v", "-keystore", options.keystore, "-alias", options.alias,
    ...passwordArgs(env, interactive)], { env, execute });
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const options = signingOptions(process.argv.slice(2));
    if (options.help) {
      console.log("Usage : node scripts/android-signing-key.mjs [generate|info] [--keystore CHEMIN] [--alias NOM] [--dname DN]\n" +
        "Par defaut : .signing/homebank-release.keystore, alias homebank.\n" +
        "keytool demande le mot de passe sans affichage et l'identite du certificat.\n" +
        "Automatisation : ANDROID_KEYSTORE_PASSWORD et --dname (jamais de mot de passe en argument).\n" +
        "Conserver cette cle et son mot de passe pour toutes les mises a jour de l'APK.");
    } else if (options.command === "info") signingKeyInfo(options);
    else {
      const result = generateSigningKey(options);
      console.log("\nCle de distribution creee : " + result.keystore + "\nAlias : " + result.alias + "\n" +
        "Format PKCS12 : le mot de passe de la cle est celui du keystore.\n" +
        "Sauvegarder ce fichier et son mot de passe hors du depot, dans un stockage securise.\n" +
        "Empreintes SHA-1/SHA-256 : npm run android:key:info (reprendre les memes --keystore / --alias si personnalises).\n" +
        "Pour compiler un APK signe, suivre la section Signature Android de README_PACKAGING.md.");
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
