import type { CapacitorConfig } from "@capacitor/cli";
import metadata from "./packaging.config.json";
import { mobileDriveConfig } from "./scripts/mobile-drive-config.mjs";

const config: CapacitorConfig = {
  appId: metadata.appId,
  appName: metadata.productName,
  webDir: "dist-native",
  android: { path: "native/android" },
  ios: { path: "native/ios" },
  plugins: { HomeBankDrive: mobileDriveConfig() },
};

export default config;
