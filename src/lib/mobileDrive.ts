import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DesktopDriveResult } from "./electronDrive";
import type { DriveFileRef } from "./googleDrive";

interface MobileDrivePlugin {
  getConfiguration: () => Promise<{ configured: boolean }>;
  authorize: (options: { prompt: "" | "consent" | "none" }) => Promise<DesktopDriveResult<{ expiresAt: number }>>;
  pick: () => Promise<DesktopDriveResult<{ file: DriveFileRef; expiresAt: number }>>;
  verify: (options: { fileId: string }) => Promise<DesktopDriveResult<void>>;
  download: (options: { fileId: string }) => Promise<DesktopDriveResult<string>>;
  save: (options: { fileId: string; xml: string }) => Promise<DesktopDriveResult<void>>;
}
const plugin = registerPlugin<MobileDrivePlugin>("HomeBankDrive");
let bridge: Window["homebankDrive"];
let initialization: Promise<void> | undefined;

export const mobileDrive = () => bridge;
export function initializeMobileDrive(): Promise<void> {
  if (!import.meta.env.VITE_NATIVE_APP || !Capacitor.isNativePlatform() || !["ios", "android"].includes(Capacitor.getPlatform())) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout>;
  initialization ??= Promise.race([plugin.getConfiguration(), new Promise<{ configured: boolean }>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Native Drive configuration timed out")), 5000);
  })]).then(({ configured }) => {
    bridge = Object.freeze({
      configured,
      authorize: (prompt: "" | "consent" | "none") => plugin.authorize({ prompt }),
      pick: () => plugin.pick(),
      verify: (fileId: string) => plugin.verify({ fileId }),
      download: (fileId: string) => plugin.download({ fileId }),
      save: (fileId: string, xml: string) => plugin.save({ fileId, xml }),
    });
  }).catch(() => {
    // A missing native plugin must not prevent local wallets from opening.
    console.warn("Plugin Google Drive mobile indisponible. Reconstruire l'application native.");
  }).finally(() => clearTimeout(timer));
  return initialization;
}
