import { test, expect, type Page } from "@playwright/test";
import { originalHomeBankXml } from "../fixtures";

const variants = [
  { name: "material", platform: "Android", agent: "Mozilla/5.0 (Linux; Android 16) Chrome/140.0", font: "Roboto" },
  { name: "apple", platform: "MacIntel", agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15", font: "-apple-system" },
  { name: "fluent", platform: "Win32", agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0", font: "Segoe UI" },
] as const;

async function setPlatform(page: Page, platform: string, agent: string) {
  await page.addInitScript(({ platform, agent }) => {
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform } });
    Object.defineProperty(navigator, "platform", { configurable: true, value: platform });
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: agent });
  }, { platform, agent });
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
}
async function importFixture(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({ name: "demo.xhb", mimeType: "application/xml", buffer: Buffer.from(originalHomeBankXml) });
  await expect(page.getByRole("status")).toContainText("importe");
}
async function checkLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const fits = await page.locator(".account-identity > span, .balance-value, .operation-type button").evaluateAll((nodes) =>
    nodes.every((node) => node.scrollWidth <= node.clientWidth + 1));
  expect(fits).toBe(true);
}

for (const viewport of [{ name: "wide", width: 1280, height: 900 }, { name: "phone", width: 375, height: 812 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.name === "phone", hasTouch: viewport.name === "phone" });
    for (const variant of variants) for (const mode of ["light", "dark"] as const) {
      test(variant.name + " " + mode + " banking workflow", async ({ page }, info) => {
        await setPlatform(page, variant.platform, variant.agent);
        await page.emulateMedia({ colorScheme: mode, reducedMotion: "reduce", contrast: "no-preference" });
        await importFixture(page);
        await expect(page.locator("html")).toHaveAttribute("data-design", variant.name);
        await expect(page.locator("html")).toHaveAttribute("data-runtime", "web");
        await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
        expect(await page.locator("body").evaluate((body) => getComputedStyle(body).fontFamily)).toContain(variant.font);
        const surface = await page.locator(".account-card").first().evaluate((node) => getComputedStyle(node).backgroundColor);
        expect(surface.startsWith("rgb(")).toBe(true);
        await checkLayout(page);
        await page.screenshot({ path: info.outputPath(variant.name + "-" + mode + "-accounts.png"), fullPage: true, animations: "disabled" });

        await page.getByRole("button", { name: "Operations", exact: true }).click();
        await checkLayout(page);
        await page.screenshot({ path: info.outputPath(variant.name + "-" + mode + "-operations.png"), fullPage: true, animations: "disabled" });
        await page.locator(".fab").click();
        await page.getByLabel("Date", { exact: true }).fill("2026-10-07");
        await page.getByLabel("Montant", { exact: true }).fill("37.20");
        await page.getByLabel("Tiers", { exact: true }).fill("Exemple bancaire");
        await page.getByLabel("Memo", { exact: true }).fill("Operation de demonstration");
        const labelsFit = await page.locator(".form-grid .MuiFormControl-root").evaluateAll((nodes) => nodes.every((node) => {
          const label = node.querySelector("label")!.getBoundingClientRect();
          const input = node.querySelector(".MuiInputBase-root")!.getBoundingClientRect();
          return label.bottom <= input.top + 12;
        }));
        expect(labelsFit).toBe(true);
        await checkLayout(page);
        if (viewport.name === "phone") {
          const target = await page.getByRole("button", { name: "Enregistrer", exact: true }).boundingBox();
          const details = await page.getByRole("button", { name: "Enregistrer", exact: true }).evaluate((button) => ({
            coarse: matchMedia("(pointer: coarse)").matches, touch: navigator.maxTouchPoints,
            viewport: innerWidth, minHeight: getComputedStyle(button).minHeight, classes: button.className,
          }));
          expect(target!.height, JSON.stringify(details)).toBeGreaterThanOrEqual(48);
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(variant.name + "-" + mode + "-form.png"), fullPage: true, animations: "disabled" });
        await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
        await expect(page.locator(".transaction-row").filter({ hasText: "Exemple bancaire" })).toContainText("-37,20");
        await page.getByRole("button", { name: "Planifi\u00e9es", exact: true }).click();
        await expect(page.getByRole("grid")).toBeVisible();
        await checkLayout(page);
        await page.screenshot({ path: info.outputPath(variant.name + "-" + mode + "-calendar.png"), fullPage: true, animations: "disabled" });
      });
    }
  });
}

test("reduces glass on demand, remembers the choice and respects system contrast", async ({ page }) => {
  await setPlatform(page, "MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)");
  await importFixture(page);
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Reduire la transparence" });
  await toggle.check();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-transparency", "true");
  await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-reduced-transparency", "true");
  await page.emulateMedia({ contrast: "more" });
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await page.getByRole("button", { name: "Fichier", exact: true }).click();
  await expect(toggle).toBeDisabled();
});

test("shows an honest empty search state without asking to replace the wallet", async ({ page }) => {
  await importFixture(page);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await page.getByLabel("Rechercher", { exact: true }).fill("Absent-du-portefeuille");
  await expect(page.locator(".empty-state")).toContainText("Aucune operation pour ces filtres.");
  await expect(page.locator(".empty-state").getByRole("button", { name: "Importer", exact: true })).toHaveCount(0);
});

test("renders opaque navigation in forced-colors mode", async ({ page }) => {
  await setPlatform(page, "Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
  await page.emulateMedia({ forcedColors: "active" });
  await importFixture(page);
  await expect(page.locator("html")).toHaveAttribute("data-high-contrast", "true");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-transparency", "true");
  await expect(page.locator(".topbar")).toHaveCSS("backdrop-filter", "none");
});
