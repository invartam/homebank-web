import { expect, test } from "@playwright/test";

test("imports a wallet and restores it offline under the Pages path", async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(/https:\/\/(accounts\.google\.com|apis\.google\.com)\//, (route) => route.abort());
  await page.goto(baseURL!);
  await expect(page.getByRole("button", { name: "Importer un fichier .xhb" })).toBeEnabled();
  const manifestURL = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(new URL(manifestURL!, baseURL).pathname).toBe(new URL("manifest.webmanifest", baseURL).pathname);
  const manifest = await (await page.request.get(new URL(manifestURL!, baseURL).href)).json();
  expect(new URL(manifest.start_url, new URL(manifestURL!, baseURL)).href).toBe(baseURL);
  expect((await page.request.get(new URL(manifest.icons[0].src, new URL(manifestURL!, baseURL)).href)).ok()).toBe(true);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(baseURL);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.locator('input[type="file"]').setInputFiles({
    name: "pages-fictif.xhb", mimeType: "application/xml",
    buffer: Buffer.from('<homebank v="1.6"><properties curr="1"/><cur key="1" iso="EUR" frac="2"/><account key="1" name="Compte Pages fictif" curr="1" initial="500"/></homebank>'),
  });
  await expect(page.getByRole("button", { name: /Compte Pages fictif, solde rapproche/ })).toBeVisible();
  // Reload once under worker control so every requested application asset is cached.
  await page.reload({ waitUntil: "networkidle" });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: /Compte Pages fictif, solde rapproche/ })).toBeVisible();
  expect(errors).toEqual([]);
});
