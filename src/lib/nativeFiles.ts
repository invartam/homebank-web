import { Capacitor } from "@capacitor/core";

export async function shareNativeFile(name: string, xml: string) {
  if (!Capacitor.isNativePlatform()) return false;
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"), import("@capacitor/share"),
  ]);
  const file = await Filesystem.writeFile({ path: `homebank-export/${name}`, data: xml, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  // The receiving app may read the file after the chooser has closed.
  await Share.share({ title: name, files: [file.uri], dialogTitle: "Exporter le fichier HomeBank" });
  return true;
}
