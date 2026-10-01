import { useEffect, useState, useSyncExternalStore } from "react";
import { parseHomeBankXml } from "../lib/homebank";
import { downloadDriveFile, driveAccessTokenExpiresAt, googleDriveConfigured, pickDriveHomeBankFile, requestDriveAccessToken, saveWalletToDrive, verifyDriveFile } from "../lib/googleDrive";
import { loadSession, saveSession } from "../lib/storage";
import { WalletController } from "../lib/walletController";

export function useWallet() {
  const [controller] = useState(() => new WalletController({
    load: loadSession,
    save: saveSession,
    driveConfigured: googleDriveConfigured,
    authorize: (interactive) => requestDriveAccessToken(interactive ? "" : "none"),
    tokenExpiresAt: driveAccessTokenExpiresAt,
    pick: pickDriveHomeBankFile,
    verify: verifyDriveFile,
    download: async (file, token) => parseHomeBankXml(await downloadDriveFile(file.id, token), file.name),
    upload: saveWalletToDrive,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    const resume = (force = false) => {
      controller.setOnline(navigator.onLine);
      if (document.visibilityState === "visible") void controller.resumeDrive(force);
    };
    const online = () => resume(true);
    const offline = () => controller.setOnline(false);
    const visible = () => resume();
    controller.setOnline(navigator.onLine);
    void controller.initialize();
    const timer = window.setInterval(visible, 5000);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [controller]);
  return { ...state, controller };
}
