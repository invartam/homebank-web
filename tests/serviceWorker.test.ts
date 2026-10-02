import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw.js", "utf8");

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const cache = { match: vi.fn(async () => undefined as unknown), put: vi.fn(async () => undefined), addAll: vi.fn(async () => undefined) };
  const fetch = vi.fn(async () => ({ ok: true, type: "basic", clone: () => "fresh-copy" }));
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ["homebank-web-mvp-v9", "another-app", "homebank-web-mvp-v17"]), delete: vi.fn(async () => true) };
  const self = { location: { origin: "https://local.test" }, addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn), clients: { claim: vi.fn(async () => undefined) } };
  runInNewContext(source, { URL, self, caches, fetch });
  return { cache, fetch, caches, self, listeners };
}

describe("PWA cache", () => {
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
    const { listeners, caches, self } = worker();
    let completion: Promise<unknown> = Promise.resolve();
    listeners.get("activate")!({ waitUntil: (value: Promise<unknown>) => { completion = value; } });
    await completion;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith("homebank-web-mvp-v9");
    expect(self.clients.claim).toHaveBeenCalledOnce();
  });
});
