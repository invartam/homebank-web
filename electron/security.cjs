const path = require("node:path");

const APP_ORIGIN = "homebank://app";
function assetPath(root, address) {
  try {
    const url = new URL(address);
    if (url.protocol !== "homebank:" || url.hostname !== "app" || url.port || url.username || url.password) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\\") || pathname.includes("\0")) return null;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    return file.startsWith(path.resolve(root) + path.sep) ? file : null;
  } catch { return null; }
}
function trustedDriveSender(event, window) {
  return Boolean(window && event.senderFrame && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame &&
    event.senderFrame.url.split(/[?#]/)[0] === `${APP_ORIGIN}/index.html`);
}
module.exports = { APP_ORIGIN, assetPath, trustedDriveSender };
