import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requiredEnv, root, run } from "./packaging-utils.mjs";

const directory = path.join(root, ".packaging/signing");
const keychain = path.join(directory, "ios-build.keychain-db");
try {
  if (process.argv[2] === "cleanup") {
    if (existsSync(keychain)) run("security", ["delete-keychain", keychain]);
    rmSync(directory, { force: true, recursive: true });
  } else if (process.argv[2] === "install") {
    if (!process.env.CI) throw new Error("Installation automatique des certificats reservee a la CI. En local, utiliser le Trousseau et IOS_PROFILE_PATH.");
    requiredEnv(["IOS_CERTIFICATE_BASE64", "IOS_CERTIFICATE_PASSWORD", "IOS_PROFILE_BASE64"]);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const certificate = path.join(directory, "distribution.p12");
    writeFileSync(certificate, Buffer.from(process.env.IOS_CERTIFICATE_BASE64, "base64"), { mode: 0o600 });
    writeFileSync(path.join(directory, "adhoc.mobileprovision"), Buffer.from(process.env.IOS_PROFILE_BASE64, "base64"), { mode: 0o600 });
    const password = randomBytes(24).toString("hex");
    run("security", ["create-keychain", "-p", password, keychain]);
    run("security", ["set-keychain-settings", "-lut", "21600", keychain]);
    run("security", ["unlock-keychain", "-p", password, keychain]);
    run("security", ["import", certificate, "-P", process.env.IOS_CERTIFICATE_PASSWORD, "-k", keychain, "-t", "cert", "-f", "pkcs12", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"]);
    run("security", ["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", password, keychain]);
    run("security", ["list-keychains", "-d", "user", "-s", keychain, path.join(process.env.HOME, "Library/Keychains/login.keychain-db")]);
    rmSync(certificate);
  } else throw new Error("Commande : install ou cleanup.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
