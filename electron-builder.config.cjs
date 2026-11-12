const metadata = require("./packaging.config.json");

module.exports = {
  appId: metadata.appId,
  productName: metadata.productName,
  directories: { app: ".packaging/desktop", output: "release/desktop", buildResources: ".packaging/icons" },
  files: ["dist-native/**/*", "electron/**/*", "package.json", "!node_modules{,/**/*}"],
  asar: true,
  npmRebuild: false,
  electronFuses: {
    resetAdHocDarwinSignature: process.platform === "darwin" && !process.env.CSC_LINK && !process.env.CSC_NAME,
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
    grantFileProtocolExtraPrivileges: false,
  },
  publish: null,
  artifactName: "HomeBankWeb-${version}-${os}-${arch}.${ext}",
  mac: { target: ["dmg", "zip"], icon: "icon.png", category: "public.app-category.finance", hardenedRuntime: true, notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID && process.env.CSC_LINK) },
  win: { target: ["nsis", "zip"], icon: "icon.png" },
  linux: {
    target: ["deb", "rpm"], icon: "icon.png", category: "Office",
    maintainer: "HomeBank Web <invartam@users.noreply.github.com>",
    executableName: "homebank-wallet",
  },
  // Preserve electron-builder defaults and include Electron's audio/GBM libraries.
  deb: { depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0", "libgbm1", "libasound2t64 | libasound2"] },
  rpm: { depends: ["gtk3", "libnotify", "nss", "libXScrnSaver", "(libXtst or libXtst6)", "xdg-utils", "at-spi2-core", "(libuuid or libuuid1)", "libsecret", "mesa-libgbm", "alsa-lib"] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
};
