const { app, BrowserWindow, Menu, protocol, session, ipcMain, safeStorage, shell, nativeTheme } = require("electron");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { APP_ORIGIN, assetPath, trustedDriveSender } = require("./security.cjs");
const { createDriveService, configured } = require("./drive.cjs");
const driveConfig = require("./drive.config.json");

protocol.registerSchemesAsPrivileged([{ scheme: "homebank", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window;
let drive;
const accessibilityPreferences = () => ({
  reducedTransparency: nativeTheme.prefersReducedTransparency,
  highContrast: nativeTheme.shouldUseHighContrastColors,
});

function createWindow() {
  window = new BrowserWindow({
    title: "HomeBank Web", width: 1280, height: 900, minWidth: 360, minHeight: 560,
    show: false, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: path.join(__dirname, "preload.cjs"), additionalArguments: [
        ...(configured(driveConfig) ? ["--homebank-drive-configured"] : []),
        ...(nativeTheme.prefersReducedTransparency ? ["--homebank-reduced-transparency"] : []),
        ...(nativeTheme.shouldUseHighContrastColors ? ["--homebank-high-contrast"] : []),
      ] },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!assetPath(path.join(app.getAppPath(), "dist-native"), url)) event.preventDefault();
  });
  window.on("closed", () => { drive?.cancel(); window = undefined; });
  void window.loadURL(`${APP_ORIGIN}/index.html`);
}

if (locked) app.whenReady().then(() => {
  ipcMain.handle("homebank:appearance", (event) => {
    if (!trustedDriveSender(event, window)) throw new Error("Acces a l'apparence refuse.");
    return accessibilityPreferences();
  });
  nativeTheme.on("updated", () => {
    if (window && !window.isDestroyed()) window.webContents.send("homebank:appearance-changed", accessibilityPreferences());
  });
  drive = createDriveService({ config: driveConfig, userData: app.getPath("userData"), safeStorage,
    openExternal: (url) => shell.openExternal(url) });
  ipcMain.handle("homebank:drive", (event, command, payload) => {
    if (!trustedDriveSender(event, window)) throw new Error("Acces Drive refuse.");
    return drive.handle(command, payload);
  });
  const root = path.join(app.getAppPath(), "dist-native");
  protocol.handle("homebank", async (request) => {
    const file = assetPath(root, request.url);
    if (!file || !["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json" };
    try { return new Response(request.method === "HEAD" ? null : await readFile(file), { headers: { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" } }); }
    catch { return new Response("Not found", { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${APP_ORIGIN}/`) && !details.url.startsWith("blob:") && !details.url.startsWith("data:") });
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({
    responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    ] },
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" }, { role: "editMenu" },
    { label: "Affichage", submenu: [{ role: "reload" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
  ]));
  createWindow();
});
app.on("second-instance", () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0 && locked) createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => drive?.cancel());
