// @vitest-environment node
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { authorizationRequest, browserAuthorization } = require("../electron/oauth.cjs");
const { createDriveService, configured } = require("../electron/drive.cjs");
const { trustedDriveSender } = require("../electron/security.cjs");
const config = { clientId: "desktop-test.apps.googleusercontent.com", clientSecret: "desktop-public-value" };
const folders: string[] = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
async function fixture(overrides = {}) {
  const userData = await mkdtemp(path.join(tmpdir(), "homebank-drive-test-"));
  folders.push(userData);
  const safeStorage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value).toString("base64")),
    decryptStringAsync: vi.fn(async (value: Buffer) => ({ result: Buffer.from(value.toString(), "base64").toString() })),
  };
  const authorize = vi.fn(async () => ({ code: "test-code", verifier: "test-verifier", redirectUri: "http://127.0.0.1:1234/oauth/callback", fileId: "selected-file" }));
  const fetchImpl = vi.fn(async (url: string, options: any) => {
    if (url.includes("/token")) return json({ access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: 3600 });
    if (url.includes("alt=media")) return new Response("<homebank/>");
    if (options.method === "PATCH") return json({});
    return json({ id: "selected-file", name: "demo.xhb", trashed: false });
  });
  const dependencies = { config, userData, safeStorage, openExternal: vi.fn(), authorize, fetchImpl, ...overrides };
  return { ...dependencies, service: createDriveService(dependencies) };
}
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

describe("Electron OAuth and native Drive", () => {
  it("constructs offline, single-file OAuth with state and S256 PKCE", () => {
    const result = authorizationRequest(config.clientId, "http://127.0.0.1:1234/oauth/callback", true);
    const query = new URL(result.url).searchParams;
    expect(query.get("state")).toBe(result.state);
    expect(result.verifier.length).toBeGreaterThanOrEqual(43);
    expect(query.get("code_challenge")).toBe(createHash("sha256").update(result.verifier).digest("base64url"));
    expect(query.get("code_challenge_method")).toBe("S256");
    expect(query.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(query.get("access_type")).toBe("offline");
    expect(query.get("trigger_onepick")).toBe("true");
    expect(query.get("allow_multiple")).toBe("false");
    expect(query.has("client_secret")).toBe(false);
    expect(authorizationRequest(config.clientId, "http://127.0.0.1:1234", false).url).not.toContain("trigger_onepick");
  });
  it("accepts only a matching callback and closes the ephemeral listener", async () => {
    let redirect = "";
    const result = await browserAuthorization({ clientId: config.clientId, pick: true,
      openExternal: async (address: string) => {
        const query = new URL(address).searchParams;
        redirect = query.get("redirect_uri")!;
        expect(new URL(redirect).hostname).toBe("127.0.0.1");
        const invalid = await fetch(`${redirect}?state=foreign&code=bad`);
        expect(invalid.status).toBe(400);
        const callback = new URL(redirect);
        callback.search = new URLSearchParams({ state: query.get("state")!, code: "valid-code", picked_file_ids: "selected-file" }).toString();
        const response = await fetch(callback);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
      },
    });
    expect(result).toMatchObject({ code: "valid-code", redirectUri: redirect, fileId: "selected-file" });
    await expect(fetch(redirect)).rejects.toThrow();
  });
  it("handles cancelled consent, missing selection, timeout and browser failure", async () => {
    for (const parameters of [{ error: "access_denied" }, { code: "code" }, { code: "code", picked_file_ids: "one,two" }]) {
      await expect(browserAuthorization({ clientId: config.clientId, pick: true,
        openExternal: async (address: string) => {
          const query = new URL(address).searchParams;
          const callback = new URL(query.get("redirect_uri")!);
          callback.search = new URLSearchParams({ state: query.get("state")!, ...parameters }).toString();
          await fetch(callback);
        },
      })).rejects.toThrow();
    }
    await expect(browserAuthorization({ clientId: config.clientId, openExternal: async () => {}, timeoutMs: 10 })).rejects.toThrow("expiree");
    await expect(browserAuthorization({ clientId: config.clientId, openExternal: async () => { throw Error("Browser failed"); } })).rejects.toThrow("Browser failed");
    const abort = new AbortController();
    await expect(browserAuthorization({ clientId: config.clientId, signal: abort.signal, openExternal: async () => abort.abort() })).rejects.toThrow("annulee");
  });
  it("does not silently open a browser when no saved authorization exists", async () => {
    const { service, authorize } = await fixture();
    expect(await service.handle("authorize", "none")).toMatchObject({ ok: false, error: { kind: "authorization", requiresInteraction: true } });
    expect(authorize).not.toHaveBeenCalled();
    expect(configured({ clientId: "web-invalid" })).toBe(false);
  });
  it("picks a file and persists only an encrypted, client-bound refresh token", async () => {
    const { service, safeStorage, userData, authorize, fetchImpl } = await fixture();
    const result = await service.handle("pick");
    expect(result).toMatchObject({ ok: true, value: { file: { id: "selected-file", name: "demo.xhb" } } });
    expect(JSON.stringify(result)).not.toContain("token");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ pick: true, clientId: config.clientId }));
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledWith(JSON.stringify({ clientId: config.clientId, refreshToken: "private-refresh-token" }));
    const stored = await readFile(path.join(userData, "google-drive-token.enc"), "utf8");
    expect(stored).not.toContain("private-refresh-token");
    expect(stored).not.toContain("private-access-token");
    expect(new URLSearchParams(fetchImpl.mock.calls[0][1].body).get("code_verifier")).toBe("test-verifier");
  });
  it("restores and renews a saved authorization after a process restart without browser interaction", async () => {
    const dependencies = await fixture();
    await dependencies.service.handle("pick");
    dependencies.authorize.mockClear();
    const restored = createDriveService(dependencies);
    expect(await restored.handle("authorize", "none")).toMatchObject({ ok: true, value: { expiresAt: expect.any(Number) } });
    expect(dependencies.authorize).not.toHaveBeenCalled();
    const call = dependencies.fetchImpl.mock.calls.at(-1)!;
    expect(new URLSearchParams(call[1].body).get("grant_type")).toBe("refresh_token");
    const differentClient = createDriveService({ ...dependencies, config: { ...config, clientId: "different.apps.googleusercontent.com" } });
    expect(await differentClient.handle("authorize", "none")).toMatchObject({ ok: false, error: { requiresInteraction: true } });
  });
  it("verifies, downloads and saves via fixed Drive endpoints outside the renderer", async () => {
    const { service, fetchImpl } = await fixture();
    await service.handle("pick");
    expect(await service.handle("verify", "selected-file")).toEqual({ ok: true, value: undefined });
    expect(await service.handle("download", "selected-file")).toEqual({ ok: true, value: "<homebank/>" });
    expect(await service.handle("save", { fileId: "selected-file", xml: "<homebank/>" })).toEqual({ ok: true, value: undefined });
    expect(fetchImpl).toHaveBeenLastCalledWith("https://www.googleapis.com/upload/drive/v3/files/selected-file?uploadType=media", expect.objectContaining({ method: "PATCH", body: "<homebank/>", headers: expect.objectContaining({ Authorization: "Bearer private-access-token" }) }));
    fetchImpl.mockClear();
    for (const command of ["download", "verify"]) expect(await service.handle(command, "../secrets")).toMatchObject({ ok: false });
    expect(await service.handle("save", { fileId: "selected-file", xml: 42 })).toMatchObject({ ok: false });
    expect(await service.handle("arbitrary-fetch", "https://evil.test")).toMatchObject({ ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("preserves HTTP recovery semantics and removes revoked refresh tokens", async () => {
    const { service, fetchImpl, userData } = await fixture();
    await service.handle("pick");
    for (const [status, reason, retryable] of [[404, "notFound", false], [403, "insufficientPermissions", false], [403, "rateLimitExceeded", true], [429, "", true], [503, "", true]] as const) {
      fetchImpl.mockImplementationOnce(async () => json({ error: { errors: [{ reason }] } }, status));
      expect(await service.handle("download", "selected-file")).toMatchObject({ ok: false, error: { kind: "api", status, retryable } });
    }
    fetchImpl.mockImplementationOnce(async () => json({ error: "invalid_grant" }, 400));
    expect(await service.handle("authorize", "none")).toMatchObject({ ok: false, error: { requiresInteraction: true } });
    await expect(readFile(path.join(userData, "google-drive-token.enc"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses plaintext storage and does not expose transport error details", async () => {
    const dependencies = await fixture();
    dependencies.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(false);
    expect(await dependencies.service.handle("pick")).toMatchObject({ ok: false, error: { requiresInteraction: false } });
    expect(dependencies.authorize).not.toHaveBeenCalled();
    dependencies.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true);
    dependencies.fetchImpl.mockImplementationOnce(async () => { throw new TypeError("private token or URL"); });
    const result = await dependencies.service.handle("pick");
    expect(result).toMatchObject({ ok: false, error: { requiresInteraction: false } });
    expect(JSON.stringify(result)).not.toContain("private token");
  });
  it("rejects foreign frames and windows at the IPC boundary", () => {
    const mainFrame = { url: "homebank://app/index.html" };
    const contents = { mainFrame };
    const event = { sender: contents, senderFrame: mainFrame };
    expect(trustedDriveSender(event, { webContents: contents })).toBe(true);
    expect(trustedDriveSender(event, null)).toBe(false);
    expect(trustedDriveSender(event, { webContents: {} })).toBe(false);
    expect(trustedDriveSender({ ...event, senderFrame: { ...mainFrame } }, { webContents: contents })).toBe(false);
    mainFrame.url = "https://evil.test/index.html";
    expect(trustedDriveSender(event, { webContents: contents })).toBe(false);
  });
});
