import { test, expect, type Page } from "@playwright/test";
import { isoToHbDate } from "../../src/lib/homebank";
import { scheduledXml } from "../fixtures";

test.use({ timezoneId: "Europe/Paris" });
const xml = scheduledXml.replace("</homebank>", `
  <ope date="${isoToHbDate("2026-09-15")}" account="3" amount="-100" st="2" wording="Historique clos"/>
  <ope date="${isoToHbDate("2026-10-08")}" account="3" amount="-75" st="0" wording="Operation close postee"/>
  <fav key="40" account="3" amount="-25" recflg="1" nextdate="${isoToHbDate("2026-10-08")}" every="1" unit="2" wording="Prevision compte clos"/>
  <fav key="41" account="1" dst_account="3" flags="8" amount="-50" recflg="1" nextdate="${isoToHbDate("2026-10-08")}" every="1" unit="2" wording="Virement vers compte clos"/>
</homebank>`);
const toggle = (page: Page) => page.getByRole("switch", { name: "Inclure les comptes clos" });
const account = (page: Page) => page.getByRole("combobox", { name: "Compte", exact: true });
const fits = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-01T12:00:00+02:00") });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "closed.xhb", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("status")).toContainText("importe");
});

test("optionally browses closed accounts without changing the accounts page or new-operation accounts", async ({ page }, testInfo) => {
  const dashboardBalances = await page.locator(".dashboard .balance-value").allTextContents();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(toggle(page)).not.toBeChecked();
  await expect(account(page).locator("option")).toHaveCount(3);
  await expect(page.locator(".transaction-row").filter({ hasText: "Ferme" })).toHaveCount(0);
  await toggle(page).check();
  await expect(account(page).locator('option[value="3"]')).toHaveText("Ferme (clos)");
  await account(page).selectOption("3");
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  await expect(page.locator(".transaction-row").first()).toContainText("Operation close postee");
  await expect(page.locator(".transaction-row .transaction-main").first()).toBeDisabled();
  await expect(page.locator(".transaction-row").getByRole("button", { name: "Pointer" })).toHaveCount(0);
  await expect(page.locator(".transaction-row").getByRole("button", { name: "Rapprocher" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Historique");
  await expect(page.locator(".transaction-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("");
  await fits(page);
  await page.screenshot({ path: testInfo.outputPath("closed-operations.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Comptes", exact: true }).click();
  await expect(page.locator(".dashboard .balance-value")).toHaveText(dashboardBalances);
  await expect(page.locator(".accounts-layout")).not.toContainText("Ferme");
  await expect(page.locator(".mini-list")).not.toContainText("Historique clos");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(account(page)).toHaveValue("3");
  await page.locator(".section-header").getByRole("button", { name: "Ajouter une operation" }).click();
  await expect(account(page).locator("option")).toHaveCount(2);
  await expect(account(page).locator('option[value="3"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await toggle(page).uncheck();
  await expect(account(page)).toHaveValue("0");
  await expect(page.locator(".transaction-row").filter({ hasText: "Ferme" })).toHaveCount(0);
});

test("includes closed account history, posted future and forecasts in the calendar but not recurrences", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await toggle(page).check();
  await account(page).selectOption("3");
  await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
  await expect(toggle(page)).not.toBeChecked();
  await expect(account(page)).toHaveValue("0");
  await expect(account(page).locator('option[value="3"]')).toHaveCount(0);
  await toggle(page).check();
  await account(page).selectOption("3");
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText("100,00");
  const day = page.locator('.calendar-month-grid button[data-date="2026-10-08"]');
  await expect(day.locator(".calendar-transfer-in")).toContainText("+50,00");
  await expect(day).toContainText("3 op.");
  await day.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".calendar-agenda-row")).toHaveCount(3);
  await expect(dialog).toContainText("Operation close postee");
  await expect(dialog).toContainText("Prevision compte clos");
  await expect(dialog).toContainText("Depuis Banque");
  await fits(page);
  await page.screenshot({ path: testInfo.outputPath("closed-calendar-agenda.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("button", { name: "Mois precedent", exact: true }).click();
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText("100,00");
  await expect(page.locator(".calendar-legend")).toContainText("0 planifi");
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await expect(page.locator('.calendar-year-grid button[data-date="2026-09-01"]')).toContainText("-100,00");
  await expect(page.locator('.calendar-year-grid button[data-date="2026-10-01"]')).toContainText("-100,00");
  await fits(page);
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(toggle(page)).toHaveCount(0);
  await expect(account(page)).toHaveValue("0");
  await expect(account(page).locator('option[value="3"]')).toHaveCount(0);
  await expect(page.locator(".schedule-groups")).not.toContainText("Prevision compte clos");
  await page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true }).click();
  await expect(toggle(page)).toBeChecked();
  await account(page).selectOption("3");
  await toggle(page).uncheck();
  await expect(account(page)).toHaveValue("0");
  await expect(account(page).locator('option[value="3"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(toggle(page)).toBeChecked();
  await page.reload();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(toggle(page)).not.toBeChecked();
});
