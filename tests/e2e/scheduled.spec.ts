import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isoToHbDate } from "../../src/lib/homebank";
import { calendarHistoryXml, nextMonthScheduledXml, scheduledXml, sampleXml } from "../fixtures";

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
const totals = (page: Page) => page.locator(".schedule-summary dd");
const day = (page: Page, iso: string) => page.locator('.calendar-month-grid button[data-date="' + iso + '"]');
const rows = (page: Page) => page.locator("#schedule-content > .schedule-groups .schedule-row");
const closeAgenda = (page: Page) => page.getByRole("dialog").getByRole("button", { name: "Fermer", exact: true }).click();

async function layoutFits(page: Page) {
  expect(await noOverflow(page)).toBe(true);
  expect(await page.locator(".calendar-cell-button, .calendar-currency-totals > span").evaluateAll((elements) =>
    elements.every((element) => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
}

test("renders a Monday-first month, daily totals and a read-only agenda on desktop and mobile", async ({ page }, testInfo) => {
  await openSchedules(page);
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("Octobre 2026");
  await expect(page.locator(".calendar-month-grid .calendar-cell")).toHaveCount(42);
  await expect(page.getByRole("columnheader").first()).toHaveAccessibleName("Lundi");
  await expect(day(page, "2026-10-01")).toHaveAttribute("aria-current", "date");
  await expect(totals(page).nth(0)).toContainText(/2.*045,00/);
  await expect(totals(page).nth(1)).toContainText("770,00");
  await expect(totals(page).nth(2)).toContainText(/1.*275,00/);
  await expect(page.locator(".calendar-legend")).toContainText("4 saisies");
  await expect(page.locator(".calendar-legend")).toContainText("11 planifi");
  await expect(page.locator(".schedule-transfers")).toContainText("100,00");
  await expect(day(page, "2026-10-09")).toContainText("-60,00");
  await expect(day(page, "2026-10-02").locator(".calendar-expenses")).not.toContainText("-0");
  await day(page, "2026-10-01").focus();
  await page.keyboard.press("ArrowRight");
  await expect(day(page, "2026-10-02")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(day(page, "2026-10-09")).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Compte", exact: true }).locator("option")).toHaveCount(3);
  await layoutFits(page);
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.locator(".calendar-month-grid").evaluate((grid) => grid.getBoundingClientRect().top < innerHeight - 104)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("calendar-month-light.png"), fullPage: testInfo.project.name === "desktop", animations: "disabled" });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("calendar-month-dark.png"), fullPage: testInfo.project.name === "desktop", animations: "disabled" });
  await day(page, "2026-10-09").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Operations du 09/10/2026");
  await expect(dialog.locator(".calendar-agenda-row")).toHaveCount(1);
  await expect(dialog).toContainText("Electricite");
  await expect(dialog).toContainText("Planifi\u00e9e");
  await expect(dialog.getByRole("button", { name: "Enregistrer" })).toHaveCount(0);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("calendar-day-dark.png"), animations: "disabled" });
  await closeAgenda(page);
  await page.getByRole("combobox", { name: "Compte", exact: true }).selectOption("2");
  await expect(totals(page).nth(0)).toContainText("45,00");
  await expect(totals(page).nth(1)).toContainText("0,00");
  await expect(totals(page).nth(2)).toContainText("145,00");
  await day(page, "2026-10-08").click();
  await expect(page.getByRole("dialog")).toContainText("Depuis Banque");
  await expect(page.getByRole("dialog").locator(".calendar-agenda-row")).toHaveCount(1);
});

test("combines future posted operations and forecasts while keeping the past recorded only", async ({ page }) => {
  await openSchedules(page, calendarHistoryXml);
  await expect(totals(page).nth(0)).toContainText(/1.*040,00/);
  await expect(totals(page).nth(1)).toContainText(/1.*223,00/);
  await expect(page.locator(".calendar-legend")).toContainText("6 saisies");
  await expect(page.locator(".calendar-legend")).toContainText("31 planifi");
  await day(page, "2026-10-01").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".calendar-agenda-row")).toHaveCount(2);
  await expect(dialog).toContainText("Versement du jour");
  await expect(dialog).not.toContainText("Planifi\u00e9e");
  await closeAgenda(page);
  await day(page, "2026-10-05").click();
  await expect(dialog.locator(".calendar-agenda-row")).toHaveCount(2);
  await expect(dialog).toContainText("Prelevement quotidien");
  await expect(dialog).toContainText("Operation future postee");
  await expect(dialog.locator(".calendar-entry-source.recorded")).toHaveCount(1);
  await expect(dialog.locator(".calendar-entry-source.scheduled")).toHaveCount(1);
  await closeAgenda(page);
  await page.getByRole("button", { name: "Mois precedent", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("Septembre 2026");
  await expect(totals(page).nth(0)).toContainText(/1.*000,00/);
  await expect(totals(page).nth(1)).toContainText("0,00");
  await expect(page.locator(".calendar-legend")).toContainText("0 planifi");
  await day(page, "2026-09-15").click();
  await expect(dialog).toContainText("Salaire historique");
  await expect(dialog).not.toContainText("Planifi\u00e9e");
  await closeAgenda(page);
  await page.getByRole("button", { name: "Aujourd'hui", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("Octobre 2026");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Prelevement");
  await expect(totals(page).nth(0)).toContainText("0,00");
  await expect(totals(page).nth(1)).toContainText("300,00");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("income");
  await expect(totals(page).nth(1)).toContainText("0,00");
  await day(page, "2026-10-05").click();
  await expect(dialog).toContainText("Aucune op\u00e9ration pour ces filtres.");
  await layoutFits(page);
});

test("aggregates the year by month, opens the month agenda and drills down without losing filters", async ({ page }, testInfo) => {
  await openSchedules(page, calendarHistoryXml);
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("2026");
  await expect(page.locator(".calendar-year-grid .calendar-cell")).toHaveCount(12);
  await expect(page.locator('.calendar-year-grid button[data-date="2026-01-01"]')).toContainText("0,00");
  await page.locator('.calendar-year-grid button[data-date="2026-01-01"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.calendar-year-grid button[data-date="2026-02-01"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const down = (page.viewportSize()?.width ?? 1280) <= 600 ? "2026-04-01" : "2026-05-01";
  await expect(page.locator('.calendar-year-grid button[data-date="' + down + '"]')).toBeFocused();
  await expect(totals(page).nth(0)).toContainText(/3.*640,00/);
  await expect(totals(page).nth(1)).toContainText(/1.*833,00/);
  const september = page.locator('.calendar-year-grid button[data-date="2026-09-01"]');
  const october = page.locator('.calendar-year-grid button[data-date="2026-10-01"]');
  const november = page.locator('.calendar-year-grid button[data-date="2026-11-01"]');
  await expect(september).toContainText("Saisi");
  await expect(september).toContainText(/1.*000,00/);
  await expect(october).toContainText("En cours");
  await expect(october).toContainText(/-1.*223,00/);
  await expect(november).toContainText("Pr\u00e9vu");
  await expect(november).toContainText("-300,00");
  await layoutFits(page);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("calendar-year-light.png"), animations: "disabled" });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("calendar-year-dark.png"), animations: "disabled" });
  await september.click();
  await expect(page.getByRole("dialog")).toContainText("Salaire historique");
  await expect(page.getByRole("dialog")).not.toContainText("Planifi\u00e9e");
  await closeAgenda(page);
  await november.click();
  await expect(page.getByRole("dialog").locator(".calendar-agenda-row")).toHaveCount(31);
  await expect(page.getByRole("dialog")).not.toContainText("Operation future postee");
  await page.getByRole("dialog").getByRole("button", { name: "Voir le mois", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("Novembre 2026");
  await expect(page.getByRole("button", { name: "Mois", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Compte", exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await expect(totals(page).nth(0)).toContainText("0,00");
  await page.getByRole("button", { name: "Annee precedente", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("2025");
  await expect(page.locator(".calendar-legend")).toContainText("0 planifi");
  await page.getByRole("button", { name: "Annee suivante", exact: true }).click();
  await page.getByRole("combobox", { name: "Compte", exact: true }).selectOption("0");
  await page.getByRole("button", { name: "Annee suivante", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("2027");
  await expect(page.locator(".calendar-legend")).toContainText("0 saisie");
  await expect(totals(page).nth(0)).toContainText(/9.*600,00/);
  await expect(totals(page).nth(1)).toContainText(/3.*650,00/);
  await page.getByRole("button", { name: "Aujourd'hui", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("2026");
});

test("keeps recurrences, filters and details intact and preserves the exported XML", async ({ page }) => {
  await openSchedules(page);
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(rows(page)).toHaveCount(9);
  await expect(page.locator(".schedule-period")).toContainText("9 \u00e9ch\u00e9ances");
  await expect(totals(page).nth(0)).toContainText(/2.*005,00/);
  await expect(totals(page).nth(1)).toContainText("715,00");
  await expect(totals(page).nth(2)).toContainText(/1.*290,00/);
  await expect(rows(page).filter({ hasText: "Assurance en retard" })).toContainText("En retard");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Salaire");
  await expect(rows(page)).toHaveCount(1);
  await expect(totals(page).nth(0)).toContainText(/2.*000,00/);
  await rows(page).click();
  await expect(page.getByRole("dialog")).toContainText("Chaque mois");
  await expect(page.getByRole("dialog")).toContainText("SAL-42");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Enregistrer", exact: true })).toHaveCount(0);
  await closeAgenda(page);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("");
  await page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ann\u00e9e", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter .xhb", exact: true }).click();
  const exported = readFileSync((await (await downloadPromise).path())!, "utf8");
  const unchanged = await page.evaluate(({ original, exported }) => {
    const read = (xml: string) => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      return ["fav", "ope"].map((name) => Array.from(doc.querySelectorAll(name)).map((element) =>
        Object.fromEntries(Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]))));
    };
    return JSON.stringify(read(original)[0]) === JSON.stringify(read(exported)[0])
      && read(original)[1].length === read(exported)[1].length;
  }, { original: scheduledXml, exported });
  expect(unchanged).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
  await expect(page.locator(".calendar-month-grid .calendar-cell")).toHaveCount(42);
});

test("includes next-month expenses in recurrences and only in the selected calendar month", async ({ page }) => {
  await openSchedules(page, nextMonthScheduledXml);
  await expect(totals(page).nth(1)).toContainText("35,00");
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(rows(page)).toHaveCount(7);
  await expect(totals(page).nth(1)).toContainText("129,99");
  await expect(totals(page).nth(2)).toContainText("-129,99");
  await expect(page.locator(".schedule-transfers")).toContainText(/\+19,55.*-19,55/);
  await page.getByRole("button", { name: "Voir les planifications de Banque", exact: true }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(totals(page).nth(2)).toContainText("-149,54");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("expense");
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator(".schedule-transfers")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Telephone");
  await expect(totals(page).nth(1)).toContainText("20,99");
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("");
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption("all");
  await page.getByRole("tab", { name: "\u00c9ch\u00e9ancier", exact: true }).click();
  await expect(totals(page).nth(1)).toContainText("35,00");
  await page.getByRole("button", { name: "Mois suivant", exact: true }).click();
  await expect(page.locator(".calendar-toolbar h3")).toHaveText("Novembre 2026");
  await expect(totals(page).nth(1)).toContainText("129,99");
  await expect(totals(page).nth(2)).toContainText("-149,54");
});

test("shows empty days without hiding the calendar and remains usable on narrow screens", async ({ page }) => {
  await openSchedules(page, sampleXml);
  await day(page, "2026-10-05").click();
  await expect(page.getByRole("dialog")).toContainText("Aucune op\u00e9ration pour ces filtres.");
  await closeAgenda(page);
  await page.getByRole("textbox", { name: "Rechercher", exact: true }).fill("Introuvable");
  await expect(totals(page).nth(1)).toContainText("0,00");
  await expect(page.locator(".calendar-month-grid .calendar-cell")).toHaveCount(42);
  await layoutFits(page);
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(page.getByText("Aucune operation planifiee active dans ce fichier.")).toBeVisible();
  expect(await page.locator(".bottom-nav .nav-button").evaluateAll((buttons) => buttons.every((button) => {
    const bounds = button.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && button.scrollWidth <= button.clientWidth;
  }))).toBe(true);
});

test("opens both calendar views and agendas offline without deferred module downloads", async ({ page, context }) => {
  await openSchedules(page);
  await context.setOffline(true);
  await day(page, "2026-10-02").click();
  await expect(page.getByRole("dialog")).toContainText("Salaire mensuel");
  await closeAgenda(page);
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await expect(page.locator(".calendar-year-grid .calendar-cell")).toHaveCount(12);
  await page.getByRole("tab", { name: "R\u00e9currences", exact: true }).click();
  await expect(rows(page)).toHaveCount(9);
  await rows(page).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("keeps currencies separate in daily and yearly cells and transfer agendas", async ({ page }) => {
  const xml = await page.evaluate((original) => {
    const doc = new DOMParser().parseFromString(original, "application/xml");
    const currency = doc.querySelector("cur")!.cloneNode(true) as Element;
    currency.setAttribute("key", "2");
    currency.setAttribute("iso", "USD");
    doc.documentElement.append(currency);
    doc.querySelector('account[key="2"]')!.setAttribute("curr", "2");
    doc.querySelector('fav[key="14"]')!.setAttribute("damt", "90");
    return new XMLSerializer().serializeToString(doc);
  }, scheduledXml);
  await openSchedules(page, xml);
  await expect(page.locator(".schedule-currency-summary")).toHaveCount(2);
  const transfer = day(page, "2026-10-08");
  await expect(transfer.locator(".calendar-cell-currency")).toHaveCount(2);
  await expect(transfer).toContainText("EUR");
  await expect(transfer).toContainText("USD");
  await layoutFits(page);
  await transfer.click();
  await expect(page.getByRole("dialog").locator(".calendar-agenda-row")).toHaveCount(2);
  await expect(page.getByRole("dialog").locator(".calendar-agenda-summary")).toHaveCount(2);
  await expect(page.getByRole("dialog")).toContainText("90,00");
  await closeAgenda(page);
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  await expect(page.locator('.calendar-year-grid button[data-date="2026-01-01"] .calendar-cell-currency')).toHaveCount(2);
  await layoutFits(page);
});

test("shows incoming and outgoing transfer sums instead of cancelling posted and planned transfers", async ({ page }) => {
  const xml = scheduledXml.replace("</homebank>", `
    <ope date="${isoToHbDate("2026-10-08")}" account="1" dst_account="2" flags="8" amount="-35" st="2" wording="Virement deja poste"/>
    <ope date="${isoToHbDate("2026-10-08")}" account="2" dst_account="1" flags="8" amount="35" st="2" wording="Virement deja poste"/>
  </homebank>`);
  await openSchedules(page, xml);
  const transferDay = day(page, "2026-10-08");
  await expect(transferDay.locator(".calendar-transfer-in")).toContainText("+135,00");
  await expect(transferDay.locator(".calendar-transfer-out")).toContainText("-135,00");
  await expect(transferDay).toHaveAccessibleName(/virements entrants 135,00.*virements sortants 135,00/);
  await layoutFits(page);
  await transferDay.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".calendar-agenda-row")).toHaveCount(4);
  await expect(dialog.locator(".calendar-entry-source.recorded")).toHaveCount(2);
  await expect(dialog.locator(".calendar-entry-source.scheduled")).toHaveCount(2);
  await expect(dialog.locator(".calendar-agenda-transfers")).toContainText(/\+135,00.*-135,00/);
  await closeAgenda(page);
  await page.getByRole("button", { name: "Ann\u00e9e", exact: true }).click();
  const october = page.locator('.calendar-year-grid button[data-date="2026-10-01"]');
  await expect(october.locator(".calendar-transfer-in")).toContainText("+135,00");
  await expect(october.locator(".calendar-transfer-out")).toContainText("-135,00");
  await layoutFits(page);
  await page.getByRole("combobox", { name: "Compte", exact: true }).selectOption("1");
  await expect(october.locator(".calendar-transfer-in")).toHaveCount(0);
  await expect(october.locator(".calendar-transfer-out")).toContainText("-135,00");
  await page.getByRole("combobox", { name: "Compte", exact: true }).selectOption("2");
  await expect(october.locator(".calendar-transfer-in")).toContainText("+135,00");
  await expect(october.locator(".calendar-transfer-out")).toHaveCount(0);
});
