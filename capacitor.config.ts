import type { CapacitorConfig } from "@capacitor/cli";
import metadata from "./packaging.config.json";

const config: CapacitorConfig = {
  appId: metadata.appId,
  appName: metadata.productName,
  webDir: "dist-native",
  android: { path: "native/android" },
  ios: { path: "native/ios" },
};

export default config;
