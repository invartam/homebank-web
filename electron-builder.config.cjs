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
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, perMachine: false },
};
