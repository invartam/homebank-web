const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("homebankPlatform", Object.freeze({
  platform: process.platform,
  accessibility: Object.freeze({
    reducedTransparency: process.argv.includes("--homebank-reduced-transparency"),
    highContrast: process.argv.includes("--homebank-high-contrast"),
  }),
  getAccessibility: () => ipcRenderer.invoke("homebank:appearance"),
  onAccessibilityChange: (callback) => {
    if (typeof callback !== "function") throw new TypeError("Callback d'apparence invalide.");
    const listener = (_event, preferences) => callback(preferences);
    ipcRenderer.on("homebank:appearance-changed", listener);
    return () => ipcRenderer.removeListener("homebank:appearance-changed", listener);
  },
}));

contextBridge.exposeInMainWorld("homebankDrive", Object.freeze({
  configured: process.argv.includes("--homebank-drive-configured"),
  authorize: (prompt) => ipcRenderer.invoke("homebank:drive", "authorize", prompt),
  pick: () => ipcRenderer.invoke("homebank:drive", "pick"),
  verify: (fileId) => ipcRenderer.invoke("homebank:drive", "verify", fileId),
  download: (fileId) => ipcRenderer.invoke("homebank:drive", "download", fileId),
  save: (fileId, xml) => ipcRenderer.invoke("homebank:drive", "save", { fileId, xml }),
}));
