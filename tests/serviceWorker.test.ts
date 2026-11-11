import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw.js", "utf8");

function worker(base = "/") {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = { match: vi.fn(async () => undefined as unknown), put: vi.fn(async () => undefined), addAll: vi.fn(async () => undefined) };
  const fetch = vi.fn(async () => ({ ok: true, type: "basic", clone: () => "fresh-copy" }));
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["homebank-web-mvp-v9", "another-app", "homebank-web-mvp-v20", "homebank-web-mvp-v21", "homebank-web-mvp-v22", "homebank-web-mvp-v23", currentCache]), delete: vi.fn(async () => true) };
  const self = { location: { origin: "https://local.test", href: `https://local.test${base}sw.js` }, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), clients: { claim: vi.fn(async () => undefined) } };
  const currentCache = runInNewContext(source + "\nCACHE_NAME;", { URL, self, caches, fetch }) as string;
  return { cache, fetch, caches, self, listeners, currentCache };
}

describe("PWA cache", () => {
  it("scopes the shell, cache cleanup and offline fallback to the Pages directory", async () => {
    const { listeners, caches, cache, fetch, currentCache } = worker("/homebank-web/");
    let completion: Promise<unknown> = Promise.resolve();
    const waitUntil = (value: Promise<unknown>) => { completion = value; };
    listeners.get("install")!({ waitUntil });
    await completion;
    expect(cache.addAll).toHaveBeenCalledWith([
      "https://local.test/homebank-web/", "https://local.test/homebank-web/index.html",
      "https://local.test/homebank-web/manifest.webmanifest", "https://local.test/homebank-web/icon.svg",
    ]);
    const previousCache = currentCache.replace(/v\d+$/, "v25");
    caches.keys.mockResolvedValue(["homebank-web-mvp-v25", "homebank-web-mvp-scope-%2Fother%2F-v25", currentCache, previousCache]);
    listeners.get("activate")!({ waitUntil });
    await completion;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith(previousCache);
    fetch.mockRejectedValue(new Error("offline"));
    cache.match.mockResolvedValueOnce(undefined).mockResolvedValueOnce("cached-index");
    listeners.get("fetch")!({ request: { method: "GET", url: "https://local.test/homebank-web/", headers: { has: () => false }, mode: "navigate" }, respondWith: waitUntil });
    expect(await completion).toBe("cached-index");
    expect(cache.match).toHaveBeenLastCalledWith("https://local.test/homebank-web/index.html");
    for (const url of ["https://local.test/icon.svg", "https://local.test/homebank-web-other/assets/main.js"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", url, headers: { has: () => false }, destination: "script" }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it("never intercepts Google Drive, authenticated requests or local data files", () => {
    const { listeners } = worker();
    for (const [url, authenticated, destination] of [
      ["https://www.googleapis.com/drive/v3/files/1?alt=media", false, ""],
      ["https://local.test/private", true, "script"],
      ["https://local.test/bank.xhb", false, ""],
    ] as const) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", url, headers: { has: () => authenticated }, destination }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it("refreshes HTML online and serves its cached copy offline", async () => {
    const { listeners, cache, fetch } = worker();
    const cached = { source: "cached" };
    cache.match.mockResolvedValue(cached);
    const request = { method: "GET", url: "https://local.test/", headers: { has: () => false }, mode: "navigate" };
    let response: Promise<unknown> = Promise.resolve();
    const respondWith = (value: Promise<unknown>) => { response = value; };
    listeners.get("fetch")!({ request, respondWith });
    expect(await response).not.toBe(cached);
    expect(cache.put).toHaveBeenCalledWith(request, "fresh-copy");
    fetch.mockRejectedValueOnce(new Error("offline"));
    listeners.get("fetch")!({ request, respondWith });
    expect(await response).toBe(cached);
  });

  it("only removes older HomeBank caches on activation", async () => {
    const { listeners, caches, self, currentCache } = worker();
    let completion: Promise<unknown> = Promise.resolve();
    listeners.get("activate")!({ waitUntil: (value: Promise<unknown>) => { completion = value; } });
    await completion;
    expect(caches.delete).toHaveBeenCalledWith("homebank-web-mvp-v9");
    expect(caches.delete).toHaveBeenCalledWith("homebank-web-mvp-v20");
    expect(caches.delete).toHaveBeenCalledWith("homebank-web-mvp-v21");
    expect(caches.delete).toHaveBeenCalledWith("homebank-web-mvp-v22");
    expect(caches.delete).toHaveBeenCalledWith("homebank-web-mvp-v23");
    expect(caches.delete).not.toHaveBeenCalledWith(currentCache);
    expect(caches.delete).not.toHaveBeenCalledWith("another-app");
    expect(caches.delete).toHaveBeenCalledTimes(5);
    expect(self.clients.claim).toHaveBeenCalledOnce();
  });

  it("returns network responses even when the cache is full", async () => {
    const { listeners, cache } = worker();
    cache.put.mockRejectedValueOnce(new Error("QuotaExceededError"));
    let response: Promise<any> = Promise.resolve();
    listeners.get("fetch")!({ request: { method: "GET", url: "https://local.test/", headers: { has: () => false }, mode: "navigate" },
      respondWith: (value: Promise<any>) => { response = value; } });
    expect((await response).ok).toBe(true);
  });

  it("never caches data-file navigations or arbitrary same-origin pages", () => {
    const { listeners } = worker();
    for (const name of ["bank.xhb", "bank.xml", "bank.csv", "private.json", "another-page"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", url: "https://local.test/" + name, headers: { has: () => false }, mode: "navigate" }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
});
