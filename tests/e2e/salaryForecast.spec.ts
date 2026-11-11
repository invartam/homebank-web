import { test, expect, type Page } from "@playwright/test";
import { hbDateToIso } from "../../src/lib/homebank";
import { todayHbDate } from "../../src/lib/wallet";

const today = todayHbDate();
const xml = `<homebank v="1.6"><properties curr="1"/><cur key="1" iso="EUR" frac="2"/>
  <account key="1" name="Compte salarial fictif" curr="1" initial="1000"/>
  <account key="2" name="Compte libre fictif" curr="1" initial="500"/>
  <cat key="1" name="Revenus"/><cat key="2" name="Salaires" parent="1"/>
  <ope account="1" date="${today - 1}" amount="-50" st="2"/>
  <ope account="1" date="${today + 20}" amount="2000"/>
  <ope account="1" date="${today + 21}" amount="-100"/>
  <fav account="1" amount="2000" recflg="1" unit="2" nextdate="${today + 20}" category="2" wording="Employeur fictif"/>
  <fav account="1" amount="-100" recflg="1" unit="2" nextdate="${today + 2}"/>
  <ope account="2" date="${today + 1}" amount="-50"/><ope account="2" date="${today + 5}" amount="-100"/>
  <fav account="2" amount="-25" recflg="1" unit="2" nextdate="${today + 3}"/>
</homebank>`;

async function load(page: Page) {
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "previsions-fictives.xhb", mimeType: "application/xml", buffer: Buffer.from(xml) });
  await expect(page.getByRole("status")).toContainText("importe");
}
const future = (page: Page) => page.locator(".balance-strip > div").filter({ has: page.getByText("Futur", { exact: true }) }).locator("dd");

test("automatically shows the balance strictly before salary without changing reconciled balances", async ({ page }, testInfo) => {
  await load(page);
  const card = page.getByRole("button", { name: /Compte salarial fictif, solde rapproche/ });
  await expect(card).toContainText("950,00"); await expect(card).toContainText("850,00");
  await expect(card).toContainText("Avant le");
  await card.click();
  await expect(future(page)).toContainText("850,00");
  await expect(page.getByLabel("Pr\u00e9vision \u00e0 date choisie")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("main .panel").first().screenshot({ path: testInfo.outputPath("salary-balance.png"), style: ".topbar, .bottom-nav { visibility: hidden !important; }" });
});

test("offers an opt-in date horizon only on an eligible individual account", async ({ page }, testInfo) => {
  await load(page);
  await page.getByRole("button", { name: /Compte libre fictif, solde rapproche/ }).click();
  await expect(future(page)).toContainText("350,00");
  const toggle = page.getByLabel("Pr\u00e9vision \u00e0 date choisie");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByLabel("Date de pr\u00e9vision").fill(hbDateToIso(today + 3));
  await expect(future(page)).toContainText("425,00");
  await expect(future(page)).toContainText("Au");
  await expect(page.locator(".transaction-row")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("main .panel").first().screenshot({ path: testInfo.outputPath("manual-balance-light.png"), style: ".topbar, .bottom-nav { visibility: hidden !important; }" });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await page.locator("main .panel").first().screenshot({ path: testInfo.outputPath("manual-balance-dark.png"), style: ".topbar, .bottom-nav { visibility: hidden !important; }" });
  await toggle.uncheck();
  await expect(future(page)).toContainText("350,00");
  await page.getByLabel("Compte", { exact: true }).selectOption("0");
  await expect(toggle).toHaveCount(0);
});
