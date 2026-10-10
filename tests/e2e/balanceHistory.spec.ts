import { test, expect, type Page } from "@playwright/test";
import { Temporal } from "@js-temporal/polyfill";
import { hbDateToIso, isoToHbDate } from "../../src/lib/homebank";
import { todayHbDate } from "../../src/lib/wallet";

const today = todayHbDate(), year = Number(hbDateToIso(today).slice(0, 4));
const movements: string[] = [];
for (let y = year - 4; y <= year; y++) for (let month = 1; month <= 12; month++) {
  const date = isoToHbDate(`${y}-${String(month).padStart(2, "0")}-05`);
  if (date + 3 > today) continue;
  movements.push(`<ope date="${date}" account="1" amount="3000" st="2" category="3"/><ope date="${date + 2}" account="1" amount="-1200" st="2" category="2"/><ope date="${date + 3}" account="1" amount="-600" st="2" category="4"/>`);
}
const xml = `<homebank v="1.6"><properties title="Graphique fictif" curr="1"/><cur key="1" iso="EUR" frac="2"/>
  <account key="1" name="Banque principale" type="1" curr="1" initial="500"/><account key="2" name="Livret" type="7" curr="1" initial="4000"/>
  <account key="3" name="Compte clos" type="1" flags="2" curr="1" initial="999999"/>
  <cat key="1" name="Maison"/><cat key="2" parent="1" name="Courses"/><cat key="3" name="Revenus"/><cat key="4" name="Transport"/>
  ${movements.join("\n")}<ope date="${today - 10}" account="2" amount="200" st="2" category="3"/>
  <ope date="${today + 15}" account="1" amount="-50" st="0" category="2"/>
  <fav key="10" account="1" amount="-100" recflg="3" limit="2" nextdate="${today + 1}" every="1" unit="2" wording="Abonnement planifie"/></homebank>`;

async function importFixture(page: Page, content = xml) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "graphique-fictif.xhb", mimeType: "application/xml", buffer: Buffer.from(content) });
  await expect(page.getByRole("status")).toContainText("importe");
  await page.locator(".balance-history").scrollIntoViewIfNeeded();
  await expect(page.locator('.history-plot[data-ready="true"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test("renders a balance curve, scopes and themes without mobile overflow", async ({ page }, testInfo) => {
  await importFixture(page);
  const scope = page.getByLabel("Perimetre du graphique", { exact: true });
  await expect(scope.locator("option")).not.toContainText(["Compte clos"]);
  await expect(page.getByLabel("Couches par categorie", { exact: true })).toHaveCount(0);
  await expect(page.locator(".history-legend")).toHaveText("Solde comptableSolde pr\u00e9visionnel");
  await page.getByRole("button", { name: "Periode Tout", exact: true }).click();
  const coloredPixels = await page.locator(".history-plot canvas").first().evaluate((element) => {
    const canvas = element as HTMLCanvasElement, ctx = canvas.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let y = Math.round(height * 0.15); y < height * 0.65; y += 4) for (let x = Math.round(width * 0.2); x < width * 0.9; x += 4) {
      const i = (y * width + x) * 4;
      if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 20) count++;
    }
    return count;
  });
  expect(coloredPixels).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const screenshotStyle = ".topbar, .bottom-nav { visibility: hidden !important; }";
  await page.locator(".balance-history").screenshot({ path: testInfo.outputPath("balance-light.png"), style: screenshotStyle });
  await page.getByRole("switch", { name: "Theme sombre" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".balance-history").screenshot({ path: testInfo.outputPath("balance-dark.png"), style: screenshotStyle });
  await scope.selectOption("savings");
  await expect(page.getByTestId("history-closing-balance")).toContainText("4 200,00".replace(" ", "\u202f"));
  await scope.selectOption("account:2");
  await expect(page.getByTestId("history-closing-balance")).toContainText("200,00");
  await expect(page.getByLabel("Afficher Revenus", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("zooms from several years down to daily detail and resets", async ({ page }) => {
  await importFixture(page);
  await page.getByRole("button", { name: "Periode Tout", exact: true }).click();
  const from = page.getByLabel("Du", { exact: true }), to = page.getByLabel("Au", { exact: true });
  const originalFrom = await from.inputValue(), originalTo = await to.inputValue();
  const span = async () => isoToHbDate(await to.inputValue()) - isoToHbDate(await from.inputValue());
  expect(await span()).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "Zoomer le graphique", exact: true }).click();
  expect(await span()).toBeLessThan(isoToHbDate(originalTo) - isoToHbDate(originalFrom));
  for (let i = 0; i < 12 && await span() > 1; i++) await page.getByRole("button", { name: "Zoomer le graphique", exact: true }).click();
  expect(await span()).toBe(1);
  await expect(page.getByRole("button", { name: "Zoomer le graphique", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Dezoomer le graphique", exact: true }).click();
  expect(await span()).toBe(2);
  await page.getByRole("button", { name: "Reinitialiser le graphique", exact: true }).click();
  await expect(from).toHaveValue(originalFrom); await expect(to).toHaveValue(originalTo);
  await from.fill(hbDateToIso(today - 2)); await to.fill(hbDateToIso(today));
  expect(await span()).toBe(2);
});

test("projects recurring and posted future movements with selectable horizons and daily dates", async ({ page }) => {
  await importFixture(page);
  const baseline = await page.getByTestId("history-closing-balance").innerText();
  const from = page.getByLabel("Du", { exact: true }), to = page.getByLabel("Au", { exact: true });
  await expect(to).toHaveValue(hbDateToIso(today));
  await page.getByRole("button", { name: "Periode Previsions", exact: true }).click();
  await expect(from).toHaveValue(hbDateToIso(today));
  const yearEnd = Temporal.PlainDate.from(hbDateToIso(today)).add({ years: 1 }).toString();
  await expect(to).toHaveValue(yearEnd);
  const money = (text: string) => Number(text.replace(/[^0-9,-]/g, "").replace(",", "."));
  const expected = money(baseline) - 250; // two planned installments and posted -50
  await expect.poll(async () => money(await page.getByTestId("history-closing-balance").innerText())).toBe(expected);
  await expect(page.getByText(`Solde previsionnel au`, { exact: false })).toBeVisible();
  await to.fill(hbDateToIso(today + 1));
  await expect.poll(async () => money(await page.getByTestId("history-closing-balance").innerText())).toBe(money(baseline) - 100);
  await page.getByLabel("Horizon des previsions", { exact: true }).selectOption("60");
  await expect(to).toHaveValue(Temporal.PlainDate.from(hbDateToIso(today)).add({ years: 5 }).toString());
  await expect.poll(async () => money(await page.getByTestId("history-closing-balance").innerText())).toBe(expected);
  await page.getByLabel("Horizon des previsions", { exact: true }).selectOption("3");
  await expect(to).toHaveValue(Temporal.PlainDate.from(hbDateToIso(today)).add({ months: 3 }).toString());
  await expect(page.getByRole("status")).toContainText("importe");
});

test("warns when a recurring forecast cannot be calculated", async ({ page }) => {
  await importFixture(page, xml.replace('every="1" unit="2"', 'every="0" unit="2"'));
  await expect(page.locator(".history-warning")).toContainText("Prevision incomplete");
  await expect(page.locator(".history-warning")).toContainText("Abonnement planifie");
});

test("fills the balance area and draws an individual account overdraft line in both themes and forecasts", async ({ page }, testInfo) => {
  const content = `<homebank v="1.6"><properties curr="1"/><cur key="1" iso="EUR" frac="2"/>
    <account key="1" name="Compte couleur" type="1" curr="1" initial="200" minimum="-350"/>
    <ope date="${today - 20}" account="1" amount="-700" st="2"/>
    <ope date="${today - 15}" account="1" amount="2000" st="2"/>
    <ope date="${today - 8}" account="1" amount="-1700" st="1"/>
    <ope date="${today - 2}" account="1" amount="-400" st="0"/>
    <ope date="${today + 1}" account="1" amount="-100" st="0"/>
    <fav key="10" account="1" amount="1500" recflg="3" limit="1" nextdate="${today + 5}" every="1" unit="2"/>
  </homebank>`;
  await importFixture(page, content);
  await expect(page.getByTestId("history-overdraft")).toHaveCount(0); // no synthetic group limit
  const closing = await page.getByTestId("history-closing-balance").innerText();
  await page.getByLabel("Perimetre du graphique", { exact: true }).selectOption("account:1");
  await expect(page.getByTestId("history-overdraft")).toContainText("-350,00");
  await expect(page.getByTestId("history-closing-balance")).toHaveText(closing);
  await page.getByLabel("Au", { exact: true }).fill(hbDateToIso(today + 15));
  const pixels = () => page.locator(".history-plot canvas").first().evaluate((element) => {
    const canvas = element as HTMLCanvasElement, ctx = canvas.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0, blue = 0;
    for (let y = 0; y < height * 0.75; y += 2) for (let x = width * 0.15 | 0; x < width * 0.95; x += 2) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 150 && r - g > 30 && r - b > 30) red++;
      if (b - r > 10 && b - g > 4) blue++;
    }
    return { red, blue };
  });
  for (const dark of [false, true]) {
    if (dark) await page.getByRole("switch", { name: "Theme sombre" }).check();
    await expect.poll(async () => (await pixels()).red).toBeGreaterThan(30);
    await expect.poll(async () => (await pixels()).blue).toBeGreaterThan(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".balance-history").screenshot({ path: testInfo.outputPath(`balance-overdraft-${dark ? "dark" : "light"}.png`), style: ".topbar, .bottom-nav { visibility: hidden !important; }" });
  }
  await page.getByRole("button", { name: "Periode Previsions", exact: true }).click();
  await expect.poll(async () => (await pixels()).red).toBeGreaterThan(30); // historic segment now outside the viewport
  await page.getByRole("button", { name: "Zoomer le graphique", exact: true }).click();
  await expect.poll(async () => (await pixels()).red).toBeGreaterThan(30);
  await page.getByLabel("Perimetre du graphique", { exact: true }).selectOption("bank");
  await expect(page.getByTestId("history-overdraft")).toHaveCount(0);
  await expect.poll(async () => (await pixels()).red).toBe(0);
});

test("keeps currencies separate and restores the chart after an empty account perimeter", async ({ page }) => {
  const multi = xml.replace("</homebank>", `<cur key="2" iso="USD" frac="2"/><account key="4" name="Dollars" type="1" curr="2" initial="123"/></homebank>`);
  await importFixture(page, multi);
  await page.getByLabel("Devise du graphique", { exact: true }).selectOption("2");
  await expect(page.getByTestId("history-closing-balance")).toContainText("123,00");
  await expect(page.getByTestId("history-closing-balance")).toContainText("$US");
  await page.getByLabel("Perimetre du graphique", { exact: true }).selectOption("account:4");
  await expect(page.getByLabel("Devise du graphique", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("history-closing-balance")).toContainText("123,00");
  const savingsOnly = `<homebank v="1.6"><cur key="1" iso="EUR" frac="2"/><account key="2" name="Livret seul" type="7" curr="1" initial="500"/></homebank>`;
  await page.locator('input[type="file"]').setInputFiles({ name: "livret.xhb", mimeType: "application/xml", buffer: Buffer.from(savingsOnly) });
  await page.getByLabel("Perimetre du graphique", { exact: true }).selectOption("bank");
  await expect(page.getByText("Aucun compte ouvert dans ce perimetre.", { exact: true })).toBeVisible();
  await page.getByLabel("Perimetre du graphique", { exact: true }).selectOption("savings");
  await expect(page.locator('.history-plot[data-ready="true"]')).toBeVisible();
  await expect(page.getByTestId("history-closing-balance")).toContainText("500,00");
});

test("accepts native chart wheel or touch zoom without changing wallet data", async ({ page }, testInfo) => {
  await importFixture(page);
  await page.getByRole("button", { name: "Periode Tout", exact: true }).click();
  const span = async () => isoToHbDate(await page.getByLabel("Au", { exact: true }).inputValue()) - isoToHbDate(await page.getByLabel("Du", { exact: true }).inputValue());
  const before = await span();
  await page.locator(".history-plot").scrollIntoViewIfNeeded();
  const box = (await page.locator(".history-plot").boundingBox())!;
  const x = box.x + box.width * 0.6, y = box.y + box.height * 0.4;
  if (testInfo.project.name === "desktop") {
    await page.mouse.move(x, y); await page.keyboard.down("Control");
    await page.mouse.wheel(0, -300); await page.keyboard.up("Control");
  } else {
    const session = await page.context().newCDPSession(page);
    const touches = (distance: number) => [
      { x: x - distance, y, id: 0 }, { x: x + distance, y, id: 1 },
    ];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touches(20) });
    for (const distance of [30, 40, 50, 60]) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touches(distance) });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach();
  }
  await expect.poll(span).toBeLessThan(before);
  await expect(page.getByRole("status")).toContainText("importe");
});
