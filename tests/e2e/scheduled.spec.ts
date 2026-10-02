import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { nextMonthScheduledXml, scheduledXml, sampleXml } from "../fixtures";

test.use({ timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-01T12:00:00+02:00") });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

async function openSchedules(page: Page, xml = scheduledXml) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "scheduled.xhb", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("status")).toContainText("importe");
  await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Mes planifications" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true })).toHaveAttribute("aria-selected", "true");
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const rows = (page: Page) => page.locator("#schedule-content > .schedule-groups .schedule-row");

test("shows the forecast by account, treats transfers separately and renders light and dark mobile views", async ({ page }, testInfo) => {
  await openSchedules(page);
  const totals = page.locator(".schedule-summary dd");
  await expect(totals.nth(0)).toContainText(/2.*005,00/);
  await expect(totals.nth(1)).toContainText("735,00");
  await expect(totals.nth(2)).toContainText(/1.*270,00/);
  await expect(page.locator(".schedule-transfers")).toContainText("100,00");
  await expect(rows(page)).toHaveCount(11);
  await expect(page.locator(".schedule-period")).toContainText("Du 01/10/2026 au 31/10/2026");
  await expect(page.getByRole("button", { name: "Voir les planifications de Ferme" })).toHaveCount(0);
  await expect(page.locator(".schedule-row").filter({ hasText: "Modele sans recurrence" })).toHaveCount(0);
  await expect(page.locator(".schedule-row").filter({ hasText: "Electricite" })).toContainText("09/10/2026");
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scheduled-light.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await page.screenshot({ path: testInfo.outputPath("scheduled-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Voir les planifications de Epargne", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Compte", exact: true })).toHaveValue("2");
  await expect(totals.nth(0)).toContainText("5,00");
  await expect(totals.nth(1)).toContainText("0,00");
  await expect(totals.nth(2)).toContainText("105,00");
  await expect(page.locator(".schedule-group")).toHaveCount(1);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator(".schedule-row").filter({ hasText: "Epargne automatique" })).toContainText("Depuis Banque");
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scheduled-account.png"), fullPage: true, animations: "disabled" });
});

test("filters schedules, exposes late dates and details, and preserves recurrence XML after consultation and export", async ({ page }, testInfo) => {
  await openSchedules(page);
  await page.getByRole("combobox", { name: "P\u00e9riode", exact: true }).selectOption("90");
  await expect(page.locator(".schedule-summary dd").nth(0)).toContainText(/6.*015,00/);
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText(/2.*145,00/);
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("income");
  await expect(page.locator(".schedule-row")).toHaveCount(6);
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("all");
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(page.locator(".schedule-row")).toHaveCount(9);
  await expect(page.locator(".schedule-period")).toContainText("9 \u00e9ch\u00e9ances");
  await expect(page.locator(".schedule-summary dd").nth(0)).toContainText(/2.*005,00/);
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText("715,00");
  await expect(page.locator(".schedule-summary dd").nth(2)).toContainText(/1.*290,00/);
  await expect(page.locator(".schedule-row").filter({ hasText: "Assurance en retard" })).toContainText("En retard");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Salaire");
  await expect(page.locator(".schedule-row")).toHaveCount(1);
  await expect(page.locator(".schedule-summary dd").nth(0)).toContainText(/2.*000,00/);
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText("0,00");
  await expect(page.locator(".schedule-period")).toContainText("1 \u00e9ch\u00e9ance");
  await page.locator(".schedule-row").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Chaque mois");
  await expect(dialog).toContainText("02/10/2026");
  await expect(dialog).toContainText("SAL-42");
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scheduled-details.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("");
  await page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "P\u00e9riode", exact: true })).toHaveValue("90");
  await expect(page.locator(".schedule-summary dd").nth(1)).toContainText(/2.*145,00/);
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter .xhb", exact: true }).click();
  const exported = readFileSync((await (await downloadPromise).path())!, "utf8");
  const unchanged = await page.evaluate(({ original, exported }) => {
    const read = (xml: string) => Array.from(new DOMParser().parseFromString(xml, "application/xml").querySelectorAll("fav"))
      .map((element) => Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])));
    return JSON.stringify(read(original)) === JSON.stringify(read(exported));
  }, { original: scheduledXml, exported });
  expect(unchanged).toBe(true);
  expect((exported.match(/<ope /g) ?? []).length).toBe(5);
  await page.reload();
  await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
  await expect(rows(page)).toHaveCount(11);
});

test("totals the listed recurrences outside the current month without changing the calendar forecast", async ({ page }, testInfo) => {
  await openSchedules(page, nextMonthScheduledXml);
  const totals = page.locator(".schedule-summary dd");
  await expect(totals.nth(1)).toContainText("0,00");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".schedule-period")).toContainText("0 \u00e9ch\u00e9ances");
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "P\u00e9riode", exact: true })).toHaveCount(0);
  await expect(page.locator(".schedule-period")).toContainText("Prochaines \u00e9ch\u00e9ances");
  await expect(page.locator(".schedule-period")).toContainText("7 \u00e9ch\u00e9ances");
  await expect(rows(page)).toHaveCount(7);
  await expect(totals.nth(0)).toContainText("0,00");
  await expect(totals.nth(1)).toContainText("129,99");
  await expect(totals.nth(2)).toContainText("-129,99");
  await expect(page.locator(".schedule-transfers")).toContainText(/\+19,55.*-19,55/);
  const bank = page.getByRole("button", { name: "Voir les planifications de Banque", exact: true });
  await expect(bank).toContainText("5 \u00e9ch\u00e9ances");
  await expect(bank).toContainText("129,99");
  await expect(bank).toContainText("-149,54");
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("recurrences-next-month.png"), fullPage: true, animations: "disabled" });
  await bank.click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator(".schedule-period")).toContainText("5 \u00e9ch\u00e9ances");
  await expect(totals.nth(1)).toContainText("129,99");
  await expect(totals.nth(2)).toContainText("-149,54");
  await expect(page.locator(".schedule-transfers")).toContainText(/\+0,00.*-19,55/);
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  expect(await noOverflow(page)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("recurrences-next-month-account-dark.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("expense");
  await expect(rows(page)).toHaveCount(3);
  await expect(totals.nth(1)).toContainText("129,99");
  await expect(totals.nth(2)).toContainText("-129,99");
  await expect(page.locator(".schedule-transfers")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Telephone");
  await expect(rows(page)).toHaveCount(1);
  await expect(totals.nth(1)).toContainText("20,99");
  await expect(page.locator(".schedule-period")).toContainText("1 \u00e9ch\u00e9ance");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Introuvable");
  await expect(rows(page)).toHaveCount(0);
  await expect(totals.nth(1)).toContainText("0,00");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("all");
  await page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "P\u00e9riode", exact: true })).toHaveValue("month");
  await expect(totals.nth(1)).toContainText("0,00");
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole("combobox", { name: "P\u00e9riode", exact: true }).selectOption("90");
  await expect(rows(page)).toHaveCount(10);
  await expect(totals.nth(1)).toContainText("259,98");
});

test("shows a useful empty state and keeps navigation usable on narrow screens", async ({ page }) => {
  await openSchedules(page, sampleXml);
  await expect(page.getByText("Aucune operation planifiee active dans ce fichier.")).toBeVisible();
  await expect(page.locator(".schedule-summary dd").nth(0)).toContainText("0,00");
  expect(await noOverflow(page)).toBe(true);
  expect(await page.locator(".bottom-nav .nav-button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && button.scrollWidth <= button.clientWidth;
  }))).toBe(true);
});

test("opens scheduled operations offline without a deferred module download", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "scheduled.xhb", mimeType: "application/xml", buffer: Buffer.from(scheduledXml) });
  await expect(page.getByRole("status")).toContainText("importe");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
  await expect(rows(page)).toHaveCount(11);
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(rows(page)).toHaveCount(9);
  await rows(page).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
