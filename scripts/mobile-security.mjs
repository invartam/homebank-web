import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { root } from "./packaging-utils.mjs";

export function configureMobileSecurity(platform, directory = root) {
  if (platform !== "android") return;
  const app = path.join(directory, "native/android/app/src/main");
  const manifest = path.join(app, "AndroidManifest.xml");
  const document = new DOMParser().parseFromString(readFileSync(manifest, "utf8"), "application/xml");
  const application = document.getElementsByTagName("application")[0];
  if (!application) throw new Error("Application absente du manifeste Android.");
  const namespace = "http://schemas.android.com/apk/res/android";
  application.setAttributeNS(namespace, "android:allowBackup", "false");
  application.setAttributeNS(namespace, "android:fullBackupContent", "@xml/homebank_backup_rules");
  application.setAttributeNS(namespace, "android:dataExtractionRules", "@xml/homebank_data_extraction_rules");
  application.setAttributeNS(namespace, "android:usesCleartextTraffic", "false");
  writeFileSync(manifest, new XMLSerializer().serializeToString(document));
  mkdirSync(path.join(app, "res/xml"), { recursive: true });
  for (const name of ["homebank_backup_rules", "homebank_data_extraction_rules"]) {
    cpSync(path.join(directory, "build", name + ".xml"), path.join(app, "res/xml", name + ".xml"));
  }
}
