import { test, expect, type Page } from "@playwright/test";
import { sampleXml } from "../fixtures";
import { originalHomeBankXml } from "../fixtures";
import { todayHbDate } from "../../src/lib/wallet";
import { readFileSync } from "node:fs";

const today = todayHbDate();
const xml = sampleXml.replace(/<ope[^>]*\/>/g, "").replace("</homebank>", [
  ...Array.from({ length: 14 }, (_, i) => `<ope date="${today - 7 + i}" account="1" amount="-5" wording="Operation de test ${i} avec un libelle tres long pour verifier la mise en page mobile"/>`),
  "</homebank>",
].join("\n"));

async function importWallet(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "test.xhb", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("status")).toContainText("importe");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") return route.abort();
    return route.continue();
  });
});

test("imports and restores an original HomeBank double-precision version header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "original.xhb", mimeType: "application/xml", buffer: Buffer.from(originalHomeBankXml) });
  await expect(page.getByRole("status")).toContainText("importe");
  await expect(page.locator(".account-card").filter({ hasText: "Banque" })).toContainText("80,00");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("local restaure");
  await expect(page.locator(".account-card").filter({ hasText: "Banque" })).toContainText("80,00");
});

test("paginates large operation lists and resets the page when searching", async ({ page }) => {
  await importWallet(page);
  const many = sampleXml.replace(/<ope[^>]*\/>/g, "").replace("</homebank>",
    Array.from({ length: 125 }, (_, index) => '<ope account="1" date="' + today + '" amount="-1" wording="Lot ' + index + '"/>').join("\n") + "</homebank>");
  await page.locator('input[type="file"]').setInputFiles({ name: "many.xhb", mimeType: "application/xml", buffer: Buffer.from(many) });
  await expect(page.getByRole("status")).toContainText("125 operations");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.locator(".transaction-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Page suivante", exact: true }).click();
  await expect(page.locator(".transaction-row").first()).toContainText("Lot 50");
  await page.getByLabel("Rechercher", { exact: true }).fill("Lot 124");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await expect(page.locator(".transaction-row")).toContainText("Lot 124");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("separates euro and dollar totals on accounts and operations", async ({ page }) => {
  await importWallet(page);
  const currencies = sampleXml.replace("</homebank>", '<cur key="2" iso="USD" frac="2"/></homebank>')
    .replace('name="Epargne" type="7" curr="1"', 'name="Epargne" type="7" curr="2"');
  await page.locator('input[type="file"]').setInputFiles({ name: "currencies.xhb", mimeType: "application/xml", buffer: Buffer.from(currencies) });
  await expect(page.locator(".balance-primary .balance-value")).toHaveCount(2);
  await expect(page.locator(".balance-primary .balance-value").first()).toContainText("80,00");
  await expect(page.locator(".balance-primary .balance-value").nth(1)).toContainText("240,00");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.locator(".balance-strip dd")).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("asks for confirmation before clearing the local wallet", async ({ page }) => {
  await importWallet(page);
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  await page.getByRole("button", { name: "Nouveau local", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Remplacer le portefeuille local ?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exporter .xhb", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Nouveau local", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirmer le remplacement", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Donnees locales effacees");
});

test("rejects stale writes from a second tab without overwriting the first tab", async ({ page }) => {
  await importWallet(page);
  const other = await page.context().newPage();
  try {
    await other.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
    await other.goto("/");
    await expect(other.getByRole("status")).toContainText("local restaure");
    for (const tab of [page, other]) await tab.getByRole("button", { name: "Operations", exact: true }).click();
    const first = page.locator(".transaction-row").filter({ hasText: "Operation de test 13 " });
    const stale = other.locator(".transaction-row").filter({ hasText: "Operation de test 13 " });
    await first.getByRole("button", { name: "Pointer", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Operation pointee");
    await stale.getByRole("button", { name: "Pointer", exact: true }).click();
    await expect(other.getByRole("status")).toContainText("autre fenetre");
    await other.reload();
    await expect(other.getByRole("status")).toContainText("local restaure");
    await other.getByRole("button", { name: "Operations", exact: true }).click();
    await expect(stale.getByRole("button", { name: "Pointer", exact: true })).toHaveCount(0);
  } finally { await other.close(); }
});

test("detects the system theme and follows changes until a manual choice", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Theme sombre" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toBeChecked();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#202326");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("homebank-theme"))).toBeNull();
});

test("switches themes, remembers the choice and renders dark views without overflow", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await importWallet(page);
  const toggle = page.getByRole("switch", { name: "Theme sombre" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".account-card").first()).toHaveCSS("background-color", "rgb(32, 35, 38)");
  await expect(page.locator(".balance-value.positive").first()).toHaveCSS("color", "rgb(124, 215, 167)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dark-dashboard.png"), fullPage: true, animations: "disabled" });
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByLabel("Tiers", { exact: true })).toBeVisible();
  await expect(page.locator(".form-grid .MuiInputBase-root").first()).toHaveCSS("background-color", "rgb(32, 35, 38)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("dark-form.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.locator(".transaction-row.future").first()).toHaveCSS("background-color", "rgb(40, 44, 48)");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("dark-transactions.png"), fullPage: true, animations: "disabled" });
  await toggle.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");
  expect(await page.evaluate(() => localStorage.getItem("homebank-theme"))).toBe("light");
});

test("keeps the theme switch usable when preference storage is denied", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "homebank-theme") throw new DOMException("Storage denied", "SecurityError");
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "homebank-theme") throw new DOMException("Storage denied", "SecurityError");
      return setItem.call(this, key, value);
    };
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Theme sombre" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("imports active accounts and displays five past and five future operations without overlap", async ({ page }, testInfo) => {
  await importWallet(page);
  await expect(page.getByRole("heading", { name: "Banque", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Epargne", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ferme/ })).toHaveCount(0);
  const groups = page.locator(".mini-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator(".mini-row")).toHaveCount(5);
  await expect(groups.nth(1).locator(".mini-row.future")).toHaveCount(5);
  const layout = await page.locator(".mini-row").evaluateAll((rows) => rows.every((row) => {
    const dateElement = row.querySelector("span")!;
    const date = dateElement.getBoundingClientRect();
    const name = row.querySelector("strong")!.getBoundingClientRect();
    return date.right <= name.left && dateElement.scrollWidth <= dateElement.clientWidth;
  }));
  expect(layout).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true, animations: "disabled" });
});

test("adds, edits and reconciles an operation, then restores it after refresh", async ({ page }, testInfo) => {
  await importWallet(page);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ajouter une operation" })).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("");
  await expect(page.getByLabel("Date", { exact: true })).toBeVisible();
  await page.getByLabel("Date", { exact: true }).fill("2026-10-01");
  await page.getByLabel("Montant", { exact: true }).fill("12.34");
  await page.getByLabel("Tiers", { exact: true }).fill("Supermarche mobile");
  await page.getByLabel("Numero", { exact: true }).fill("PAY-42");
  await page.getByLabel("Memo", { exact: true }).fill("Courses du jeudi");
  await page.getByRole("combobox", { name: "Categorie", exact: true }).selectOption({ label: "Maison:Courses" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("form.png"), fullPage: true, animations: "disabled" });
  const labelsClear = await page.locator(".form-grid .MuiFormControl-root").evaluateAll((fields) => fields.every((field) => {
    const label = field.querySelector("label")!.getBoundingClientRect();
    const input = field.querySelector(".MuiInputBase-root")!.getBoundingClientRect();
    return label.bottom <= input.top + 12;
  }));
  expect(labelsClear).toBe(true);
  await page.locator(".form-actions").getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { name: "Tous les comptes" })).toBeVisible();
  const row = page.locator(".transaction-row").filter({ hasText: "Supermarche mobile" });
  await expect(row).toContainText("Maison:Courses");
  await row.locator(".transaction-main").click();
  await expect(page.getByLabel("Numero", { exact: true })).toHaveValue("PAY-42");
  await expect(page.getByLabel("Memo", { exact: true })).toHaveValue("Courses du jeudi");
  await page.getByLabel("Memo", { exact: true }).fill("Memo modifie");
  await page.locator(".form-actions").getByRole("button", { name: "Enregistrer" }).click();
  await row.getByRole("button", { name: "Pointer", exact: true }).click();
  await expect(row.getByRole("button", { name: "Pointer", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Rapprocher", exact: true }).click();
  await expect(row).toContainText("Rapprochee");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("transactions.png"), fullPage: true, animations: "disabled" });
  await page.reload();
  await expect(page.getByRole("status")).toContainText("local restaure");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(row).toContainText("Rapprochee");
  await row.locator(".transaction-main").click();
  await expect(page.getByLabel("Numero", { exact: true })).toHaveValue("PAY-42");
  await expect(page.getByLabel("Memo", { exact: true })).toHaveValue("Memo modifie");
});

test("creates expense, income and a linked internal transfer, then edits and exports it", async ({ page }, testInfo) => {
  await importWallet(page);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByRole("button", { name: "Revenu", exact: true }).click();
  await page.getByLabel("Montant", { exact: true }).fill("1250");
  await page.getByLabel("Tiers", { exact: true }).fill("Employeur");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".transaction-row").filter({ hasText: "Employeur" }).locator(".amount.positive")).toContainText(/1.*250,00/);

  await page.locator(".fab").click();
  await expect(page.getByRole("button", { name: "D\u00e9pense", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Montant", { exact: true }).fill("12.34");
  await page.getByLabel("Memo", { exact: true }).fill("Frais bancaires");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".transaction-row").filter({ hasText: "Frais bancaires" }).locator(".amount.negative")).toContainText("-12,34");

  await page.locator(".fab").click();
  await page.getByRole("button", { name: "Virement interne", exact: true }).click();
  await expect(page.getByLabel("Tiers", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Moyen", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Compte debite", exact: true })).toHaveValue("1");
  await expect(page.getByRole("combobox", { name: "Compte credite", exact: true }).locator("option")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Compte credite", exact: true }).selectOption("2");
  await page.getByLabel("Montant", { exact: true }).fill("50");
  await page.getByLabel("Memo", { exact: true }).fill("Epargne automatique");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const typeButtonsFit = await page.locator(".operation-type button").evaluateAll((buttons) => buttons.every((button) => button.scrollWidth <= button.clientWidth));
  expect(typeButtonsFit).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("transfer-form-light.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await page.screenshot({ path: testInfo.outputPath("transfer-form-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const rows = page.locator(".transaction-row").filter({ hasText: "Epargne automatique" });
  await expect(rows).toHaveCount(2);
  const debit = rows.filter({ hasText: "Vers Epargne" });
  const credit = rows.filter({ hasText: "Depuis Banque" });
  await expect(debit.locator(".amount.negative")).toContainText("-50,00");
  await expect(credit.locator(".amount.positive")).toContainText("50,00");
  await debit.getByRole("button", { name: "Rapprocher", exact: true }).click();
  await expect(debit).toContainText("Rapprochee");
  await expect(credit.getByRole("button", { name: "Pointer", exact: true })).toBeVisible();

  await credit.locator(".transaction-main").click();
  await expect(page.getByRole("combobox", { name: "Compte credite", exact: true })).toHaveValue("2");
  await expect(page.getByRole("combobox", { name: "Compte debite", exact: true })).toHaveValue("1");
  await page.getByLabel("Montant", { exact: true }).fill("60");
  await page.getByLabel("Numero", { exact: true }).fill("XFER-42");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(debit.locator(".amount.negative")).toContainText("-60,00");
  await expect(credit.locator(".amount.positive")).toContainText("60,00");
  await expect(debit).toContainText("Rapprochee");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("local restaure");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(rows).toHaveCount(2);
  await expect(debit).toContainText("Rapprochee");
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter .xhb", exact: true }).click();
  const download = await downloadPromise;
  const exported = readFileSync((await download.path())!, "utf8");
  const transferAttributes = await page.evaluate((content) => Array.from(new DOMParser().parseFromString(content, "application/xml").querySelectorAll('ope[wording="Epargne automatique"]'))
    .map((element) => Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]))), exported);
  expect(transferAttributes).toHaveLength(2);
  expect(transferAttributes[0]).toMatchObject({ account: "1", dst_account: "2", amount: "-60", flags: "8", paymode: "0", st: "2", info: "XFER-42" });
  expect(transferAttributes[1]).toMatchObject({ account: "2", dst_account: "1", amount: "60", flags: "10", paymode: "0", st: "0", info: "XFER-42" });
  expect(transferAttributes[0].kxfer).toBe(transferAttributes[1].kxfer);
  await page.locator('input[type="file"]').setInputFiles({ name: "exported.xhb", mimeType: "application/xml", buffer: Buffer.from(exported) });
  await expect(page.getByRole("status")).toContainText("importe");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(rows).toHaveCount(2);
});
