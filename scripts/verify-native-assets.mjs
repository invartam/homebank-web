import { readdirSync } from "node:fs";
import path from "node:path";

export function verifyNativeAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name.startsWith(".") || /\.local\.json$/i.test(entry.name) || entry.isSymbolicLink()) {
      throw new Error("Ressource native privee ou lien symbolique interdit : " + entry.name);
    }
    if (entry.isDirectory()) verifyNativeAssets(file);
    else if (!/\.(html|js|css|svg|png|jpe?g|webp|ico|woff2?|ttf|webmanifest)$/i.test(entry.name)) {
      throw new Error("Ressource native non autorisee : " + entry.name);
    }
  }
}
