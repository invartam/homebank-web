const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("homebankDrive", Object.freeze({
  configured: process.argv.includes("--homebank-drive-configured"),
  authorize: (prompt) => ipcRenderer.invoke("homebank:drive", "authorize", prompt),
  pick: () => ipcRenderer.invoke("homebank:drive", "pick"),
  verify: (fileId) => ipcRenderer.invoke("homebank:drive", "verify", fileId),
  download: (fileId) => ipcRenderer.invoke("homebank:drive", "download", fileId),
  save: (fileId, xml) => ipcRenderer.invoke("homebank:drive", "save", { fileId, xml }),
}));
