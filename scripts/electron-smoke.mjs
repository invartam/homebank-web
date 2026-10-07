import { _electron, expect } from "@playwright/test";
import { mkdirSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareDesktop } from "./native-build.mjs";
import { root } from "./packaging-utils.mjs";

prepareDesktop();
const profile = realpathSync(await mkdtemp(path.join(tmpdir(), "homebank-electron-test-")));
let application;
try {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ args: [path.join(root, ".packaging/desktop"), `--user-data-dir=${profile}`,
    ...(process.platform === "linux" && process.env.CI ? ["--no-sandbox"] : [])], env, timeout: 30000 });
  expect(realpathSync(await application.evaluate(({ app }) => app.getPath("userData")))).toBe(profile);
  const page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "Mes comptes" })).toBeVisible();
  const expectedDesign = process.platform === "darwin" ? "apple" : process.platform === "win32" ? "fluent" : "material";
  await expect(page.locator("html")).toHaveAttribute("data-design", expectedDesign);
  await expect(page.locator("html")).toHaveAttribute("data-runtime", "electron");
  expect(await page.evaluate(() => window.homebankPlatform.platform)).toBe(process.platform);
  const preferences = await page.evaluate(() => window.homebankPlatform.getAccessibility());
  expect(typeof preferences.reducedTransparency).toBe("boolean");
  expect(typeof preferences.highContrast).toBe("boolean");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  expect(await page.evaluate(() => typeof globalThis.process)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.homebankDrive?.authorize)).toBe("function");
  const driveConfigured = await page.evaluate(() => window.homebankDrive.configured);
  const denied = await page.evaluate(() => window.homebankDrive.download("../private"));
  expect(denied.ok).toBe(false);
  expect(await page.locator('script[src*="google"]').count()).toBe(0);
  expect(await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return 0;
    try { return (await navigator.serviceWorker.getRegistrations()).length; }
    catch (error) { if (error.name === "InvalidStateError") return 0; throw error; }
  })).toBe(0);
  await page.locator('input[type="file"]').setInputFiles({ name: "demo.xhb", mimeType: "application/xml", buffer: Buffer.from(`<?xml version="1.0"?><homebank v="1.6000000000000001" d="51003"><properties title="Demo" curr="1"/><cur key="1" iso="EUR" frac="2"/><account key="1" name="Compte de demonstration" type="1" curr="1" initial="100"/></homebank>`) });
  await expect(page.getByRole("button", { name: /Compte de demonstration/ })).toBeVisible();
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  if (driveConfigured) await expect(page.getByRole("button", { name: "Ouvrir Drive" })).toBeEnabled();
  else await expect(page.getByRole("button", { name: "Ouvrir Drive" })).toBeDisabled();
  await page.getByRole("button", { name: "Comptes", exact: true }).click();
  mkdirSync(path.join(root, ".packaging/screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(root, ".packaging/screenshots/electron.png") });
  await page.reload();
  await expect(page.getByRole("button", { name: /Compte de demonstration/ })).toBeVisible();
  console.log(`Electron : affichage, import, restauration, isolation Node, pont Drive et bouton ${driveConfigured ? "active" : "desactive"} verifies (sans connexion Google).`);
} finally {
  await application?.close();
  await rm(profile, { force: true, recursive: true });
}
