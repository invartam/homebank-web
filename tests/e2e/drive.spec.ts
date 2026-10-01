import { test, expect, type Page } from "@playwright/test";
import { sampleXml } from "../fixtures";

async function mockDrive(page: Page, requiresInteraction = false, missing = false) {
  const requests = { downloads: 0, uploads: [] as string[], checks: 0, missing };
  await page.addInitScript((requiresInteraction) => {
    const state = { requiresInteraction, attempts: [] as string[], cancelPicker: false };
    Object.assign(window, { driveTest: state });
    window.google = { accounts: { oauth2: { initTokenClient: (options) => ({
      requestAccessToken: ({ prompt }) => {
        state.attempts.push(prompt);
        if (prompt === "none" && state.requiresInteraction) options.callback({ error: "login_required" });
        else options.callback({ access_token: "fake-drive-token", expires_in: 3600 });
      },
    }) } }, picker: {
      ViewId: { DOCS: "docs" }, Action: { CANCEL: "cancel", PICKED: "picked" }, Document: { NAME: "name" },
      DocsView: class {
        setIncludeFolders() { return this; }
        setSelectFolderEnabled() { return this; }
      },
      PickerBuilder: class {
        callback = (_data: { action: string; docs?: Array<{ id: string; name: string }> }) => undefined;
        setOAuthToken() { return this; }
        setDeveloperKey() { return this; }
        setAppId() { return this; }
        setTitle() { return this; }
        addView() { return this; }
        setCallback(callback: typeof this.callback) { this.callback = callback; return this; }
        build() { return { setVisible: () => this.callback(state.cancelPicker ? { action: "cancel" } : { action: "picked", docs: [{ id: "drive-new", name: "replacement.xhb" }] }) }; }
      },
    } };
    window.gapi = { load: (_module, options) => options.callback() };
  }, requiresInteraction);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname === "www.googleapis.com" && /\/files\/drive-(test|new)$/.test(url.pathname)) {
      const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,PATCH,OPTIONS", "access-control-allow-headers": "Authorization,Content-Type" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (route.request().method() === "PATCH") {
        requests.uploads.push(route.request().postData() ?? "");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}", headers });
      }
      if (url.searchParams.get("alt") !== "media") {
        requests.checks++;
        const replacement = url.pathname.endsWith("drive-new");
        return route.fulfill({ status: !replacement && requests.missing ? 404 : 200, contentType: "application/json",
          body: JSON.stringify({ id: replacement ? "drive-new" : "drive-test", trashed: false }), headers });
      }
      requests.downloads++;
      return route.fulfill({ status: 200, contentType: "application/xml", body: url.pathname.endsWith("drive-new") ? sampleXml.replace('title="Test"', 'title="Remplacement"') : sampleXml, headers });
    }
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "test.xhb", mimeType: "application/xml", buffer: Buffer.from(sampleXml) });
  await expect(page.getByRole("status")).toContainText("importe");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("homebank-web-mvp", 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("wallet", "readwrite");
      transaction.objectStore("wallet").put({ id: "drive-test", name: "test.xhb" }, "drive-file");
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }));
  await page.reload();
  return requests;
}

test("prompts for a missing file and protects unsynced edits until a confirmed replacement succeeds", async ({ page }, testInfo) => {
  await page.clock.install();
  const requests = await mockDrive(page, false, true);
  const indicator = page.locator(".drive-indicator");
  const alert = page.locator(".drive-file-alert");
  await expect(indicator).toHaveAttribute("data-state", "file-missing");
  await expect(alert).toContainText("Fichier Drive indisponible");
  expect(requests.downloads).toBe(0);
  await page.clock.runFor(16000);
  expect(requests.checks).toBe(1);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Montant", { exact: true }).fill("18");
  await page.getByLabel("Tiers", { exact: true }).fill("Operation locale conservee");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(indicator).toHaveAttribute("data-pending", "true");
  const transaction = page.locator(".transaction-row").filter({ hasText: "Operation locale conservee" });
  await expect(transaction).toBeVisible();
  await alert.getByRole("button", { name: "Choisir un autre fichier Drive", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Modifications locales non synchronis");
  expect(await dialog.locator('[role="alert"]').evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const content = element.closest(".MuiDialogContent-root")!.getBoundingClientRect();
    return bounds.top >= content.top && bounds.bottom <= content.bottom;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("drive-missing-confirm.png"), fullPage: true, animations: "disabled" });
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Exporter la copie locale" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("test-web.xhb");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(transaction).toBeVisible();
  await page.evaluate(() => { (window as typeof window & { driveTest: { cancelPicker: boolean } }).driveTest.cancelPicker = true; });
  await indicator.click();
  await dialog.getByRole("button", { name: "Choisir le fichier", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("annulee");
  await expect(transaction).toBeVisible();
  await expect(indicator).toHaveAttribute("data-pending", "true");
  await page.evaluate(() => { (window as typeof window & { driveTest: { cancelPicker: boolean } }).driveTest.cancelPicker = false; });
  await indicator.click();
  await dialog.getByRole("button", { name: "Choisir le fichier", exact: true }).click();
  await expect(indicator).toHaveAttribute("data-state", "connected");
  await expect(indicator).toHaveAttribute("data-pending", "false");
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("replacement.xhb charge");
  expect(requests.uploads).toHaveLength(0);
  expect(requests.downloads).toBe(1);
  await page.reload();
  await expect(indicator).toHaveAttribute("data-state", "connected");
  await expect(page.getByRole("status")).toContainText("replacement.xhb");
});

test("detects a file removed while the page stays open without reloading its contents", async ({ page }, testInfo) => {
  await page.clock.install();
  const requests = await mockDrive(page);
  const indicator = page.locator(".drive-indicator");
  await expect(indicator).toHaveAttribute("data-state", "connected");
  requests.missing = true;
  await page.clock.runFor(65000);
  await expect(indicator).toHaveAttribute("data-state", "file-missing");
  await expect(page.locator(".drive-file-alert")).toBeVisible();
  expect(requests.downloads).toBe(1);
  expect(requests.uploads).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("drive-missing.png"), fullPage: true, animations: "disabled" });
});

test("shows the offline indicator and automatically saves local edits when the network returns", async ({ page, context }, testInfo) => {
  const requests = await mockDrive(page);
  const indicator = page.locator(".drive-indicator");
  await expect(indicator).toHaveAttribute("data-state", "connected");
  await context.setOffline(true);
  await expect(indicator).toHaveAttribute("data-state", "offline");
  await expect(indicator).toBeVisible();
  await expect(indicator).toBeDisabled();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Montant", { exact: true }).fill("12");
  await page.getByLabel("Tiers", { exact: true }).fill("Achat hors ligne");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".transaction-row").filter({ hasText: "Achat hors ligne" })).toBeVisible();
  await expect(indicator).toHaveAttribute("data-pending", "true");
  expect(requests.uploads).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("drive-offline.png"), fullPage: true, animations: "disabled" });
  await context.setOffline(false);
  await expect(indicator).toHaveAttribute("data-state", "connected");
  await expect(indicator).toHaveAttribute("data-pending", "false");
  expect(requests.uploads).toHaveLength(1);
  expect(requests.uploads[0]).toContain("Achat hors ligne");
  expect(requests.downloads).toBe(1);
});

test("stops automatic OAuth attempts and reconnects in one click without discarding the form draft", async ({ page }, testInfo) => {
  await page.clock.install();
  const requests = await mockDrive(page, true);
  const indicator = page.getByRole("button", { name: "Reconnecter Google Drive", exact: true });
  await expect(indicator).toHaveAttribute("data-state", "auth-required");
  await expect(indicator).toBeVisible();
  await page.clock.runFor(16000);
  const attempts = () => page.evaluate(() => (window as typeof window & { driveTest: { attempts: string[] } }).driveTest.attempts);
  expect(await attempts()).toEqual(["none"]);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Montant", { exact: true }).fill("15");
  await page.getByLabel("Tiers", { exact: true }).fill("Achat en attente");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".transaction-row").filter({ hasText: "Achat en attente" })).toBeVisible();
  await page.locator(".fab").click();
  await page.getByLabel("Memo", { exact: true }).fill("Brouillon conserve");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("drive-auth-required.png"), fullPage: true, animations: "disabled" });
  await indicator.click();
  await expect(page.locator(".drive-indicator")).toHaveAttribute("data-state", "connected");
  await expect(page.locator(".drive-indicator")).toHaveAttribute("data-pending", "false");
  await expect(page.getByLabel("Memo", { exact: true })).toHaveValue("Brouillon conserve");
  expect(await attempts()).toEqual(["none", ""]);
  expect(requests.uploads).toHaveLength(1);
  expect(requests.uploads[0]).toContain("Achat en attente");
  expect(requests.downloads).toBe(0);
});
