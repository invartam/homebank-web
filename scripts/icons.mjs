import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root } from "./packaging-utils.mjs";

const master = readFileSync(path.join(root, "assets/branding/homebank-modern.png"));
const image = `data:image/png;base64,${master.toString("base64")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image href="${image}" width="1024" height="1024"/></svg>`;
const desktop = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><clipPath id="tile"><rect x="48" y="48" width="928" height="928" rx="204"/></clipPath></defs><image href="${image}" x="48" y="48" width="928" height="928" clip-path="url(#tile)"/></svg>`;
// The dedicated master has extra safe-area padding and a continuous blue background.
const maskableMaster = readFileSync(path.join(root, "assets/branding/homebank-maskable.png"));
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><image href="data:image/png;base64,${maskableMaster.toString("base64")}" width="1024" height="1024"/></svg>`;
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><image href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" x="32" y="32" width="128" height="128"/></svg>`;
function png(file, size, source = svg, opaque = false) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, new Resvg(source, { fitTo: { mode: "width", value: size }, ...(opaque ? { background: "#185abc" } : {}) }).render().asPng());
}
export function webIcons() {
  for (const size of [192, 512]) png(path.join(root, `public/icons/app-${size}.png`), size);
  for (const size of [16, 32]) png(path.join(root, `public/icons/favicon-${size}.png`), size, desktop);
  png(path.join(root, "public/icons/apple-touch-icon.png"), 180);
  png(path.join(root, "public/icons/maskable-512.png"), 512, maskable);
  png(path.join(root, "public/icons/desktop-512.png"), 512, desktop);
}
export function desktopIcon() { png(path.join(root, ".packaging/icons/icon.png"), 1024, desktop); }
export function mobileIcons(platform) {
  if (platform === "ios") {
    const directory = path.join(root, "native/ios/App/App/Assets.xcassets/AppIcon.appiconset");
    const contents = JSON.parse(readFileSync(path.join(directory, "Contents.json"), "utf8"));
    contents.images.forEach((image, index) => {
      const size = Math.round(Number((image.size ?? "1024x1024").split("x")[0]) * Number((image.scale ?? "1x").replace("x", "")));
      image.filename = `homebank-${index}.png`;
      png(path.join(directory, image.filename), size, svg, true);
    });
    writeFileSync(path.join(directory, "Contents.json"), JSON.stringify(contents, null, 2));
  } else {
    const res = path.join(root, "native/android/app/src/main/res");
    for (const [density, factor] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
      const directory = path.join(res, `mipmap-${density}`);
      png(path.join(directory, "ic_launcher.png"), Math.round(48 * factor));
      png(path.join(directory, "ic_launcher_round.png"), Math.round(48 * factor));
      png(path.join(directory, "homebank_foreground.png"), Math.round(108 * factor), foreground);
    }
    const directory = path.join(res, "mipmap-anydpi-v26");
    mkdirSync(directory, { recursive: true });
    for (const name of ["ic_launcher", "ic_launcher_round"]) writeFileSync(path.join(directory, `${name}.xml`),
      '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@android:color/white"/><foreground android:drawable="@mipmap/homebank_foreground"/></adaptive-icon>');
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  if (process.argv[2] && process.argv[2] !== "web") throw new Error("Usage: node scripts/icons.mjs [web]");
  webIcons();
}
