import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveApiError, DriveAuthorizationError, DriveFileUnavailableError, downloadDriveFile, driveAccessTokenExpiresAt, googleDriveConfigured, pickDriveHomeBankFile, requestDriveAccessToken, saveWalletToDrive, verifyDriveFile } from "../src/lib/googleDrive";
import { sampleWallet } from "./fixtures";

describe("Google Drive adapter", () => {
  it("checks uncached metadata without downloading the wallet", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "file/1", trashed: false })));
    vi.stubGlobal("fetch", fetch);
    await verifyDriveFile({ id: "file/1", name: "test.xhb" }, "token");
    expect(fetch).toHaveBeenCalledWith("https://www.googleapis.com/drive/v3/files/file%2F1?fields=id%2Ctrashed", expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer token" } }));
  });

  it("reports missing and trashed files but not network or authorization errors as unavailable", async () => {
    const file = { id: "file", name: "test.xhb" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "file", trashed: true }))));
    await expect(verifyDriveFile(file, "token")).rejects.toThrow("corbeille");
    for (const status of [404, 401, 403, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      try { await verifyDriveFile(file, "token"); expect.fail("Expected verification to fail"); }
      catch (error) {
        expect(error).toBeInstanceOf(DriveApiError);
        expect(error instanceof DriveFileUnavailableError).toBe(status === 404);
      }
    }
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Network failed"); }));
    await expect(verifyDriveFile(file, "token")).rejects.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "wrong-file" }))));
    await expect(verifyDriveFile(file, "token")).rejects.toThrow("invalide");
  });

  beforeEach(() => {
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client");
    vi.stubEnv("VITE_GOOGLE_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete window.google;
    delete window.homebankDrive;
    vi.useRealTimers();
  });

  it("routes Electron Drive through the restricted bridge without renderer tokens or network calls", async () => {
    vi.stubEnv("VITE_NATIVE_APP", true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const expiresAt = Date.now() + 3600000;
    window.homebankDrive = {
      configured: true,
      authorize: vi.fn(async () => ({ ok: true as const, value: { expiresAt } })),
      pick: vi.fn(async () => ({ ok: true as const, value: { file: { id: "desktop-file", name: "demo.xhb" }, expiresAt } })),
      verify: vi.fn(async () => ({ ok: true as const, value: undefined })),
      download: vi.fn(async () => ({ ok: true as const, value: "<homebank/>" })),
      save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    };
    expect(googleDriveConfigured()).toBe(true);
    const token = await requestDriveAccessToken("none");
    expect(token).toBe("electron-drive-session");
    expect(driveAccessTokenExpiresAt(token)).toBe(expiresAt);
    const picked = await pickDriveHomeBankFile();
    expect(picked.file.id).toBe("desktop-file");
    await verifyDriveFile(picked.file, token);
    expect(await downloadDriveFile(picked.file.id, token)).toBe("<homebank/>");
    await saveWalletToDrive(sampleWallet(), picked.file, token);
    expect(window.homebankDrive.save).toHaveBeenCalledWith("desktop-file", expect.stringContaining("<homebank"));
    expect(fetch).not.toHaveBeenCalled();
  });
  it("maps desktop errors to the existing recovery types and keeps mobile Drive disabled", async () => {
    vi.stubEnv("VITE_NATIVE_APP", true);
    expect(googleDriveConfigured()).toBe(false);
    const fail = vi.fn(async () => ({ ok: false as const, error: { kind: "api" as const, message: "Missing", status: 404, retryable: false } }));
    window.homebankDrive = { configured: true, verify: fail } as unknown as Window["homebankDrive"];
    await expect(verifyDriveFile({ id: "file", name: "demo" }, "session")).rejects.toBeInstanceOf(DriveFileUnavailableError);
    window.homebankDrive!.authorize = vi.fn(async () => ({ ok: false, error: { kind: "authorization", message: "Reconnect", requiresInteraction: true } }));
    await expect(requestDriveAccessToken("none")).rejects.toBeInstanceOf(DriveAuthorizationError);
  });

  it("settles authentication when a popup is closed", async () => {
    window.google = { accounts: { oauth2: { initTokenClient: (options) => ({
      requestAccessToken: () => options.error_callback({ type: "popup_closed" }),
    }) } } };
    await expect(requestDriveAccessToken("consent")).rejects.toThrow("annulee");
  });

  it("uses the silent prompt on restore and returns the issued token", async () => {
    const request = vi.fn();
    window.google = { accounts: { oauth2: { initTokenClient: (options) => ({
      requestAccessToken: (config) => { request(config); options.callback({ access_token: "token" }); },
    }) } } };
    await expect(requestDriveAccessToken("none")).resolves.toBe("token");
    expect(request).toHaveBeenCalledWith({ prompt: "none" });
  });

  it("remembers token expiry only in memory and ignores late authorization responses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    let callback: (response: { access_token?: string; expires_in?: number }) => void = () => undefined;
    window.google = { accounts: { oauth2: { initTokenClient: (options) => {
      callback = options.callback;
      return { requestAccessToken: () => undefined };
    } } } };
    const expired = expect(requestDriveAccessToken("none")).rejects.toBeInstanceOf(DriveAuthorizationError);
    await vi.advanceTimersByTimeAsync(10001);
    await expired;
    callback({ access_token: "late-token", expires_in: 60 });
    expect(driveAccessTokenExpiresAt("late-token")).toBeUndefined();
    const issued = requestDriveAccessToken("");
    await Promise.resolve();
    callback({ access_token: "fresh-token", expires_in: 60 });
    expect(await issued).toBe("fresh-token");
    expect(driveAccessTokenExpiresAt("fresh-token")).toBe(Date.now() + 60000);
    expect(driveAccessTokenExpiresAt("other-token")).toBeUndefined();
  });

  it("classifies HTTP errors without treating permission failures as token expiry", async () => {
    for (const [status, reason, retryable] of [[401, "authError", false], [403, "insufficientPermissions", false], [403, "rateLimitExceeded", true], [429, "", true], [503, "", true], [404, "notFound", false]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { errors: [{ reason }] } }), { status })));
      await expect(downloadDriveFile("file", "token")).rejects.toMatchObject({ status, retryable });
      await expect(saveWalletToDrive(sampleWallet(), { id: "file", name: "test.xhb" }, "token")).rejects.toBeInstanceOf(DriveApiError);
    }
  });

  it("bypasses cached downloads and writes XML with PATCH to the selected file", async () => {
    const fetch = vi.fn(async () => ({ ok: true, text: async () => "<homebank/>" }));
    vi.stubGlobal("fetch", fetch);
    expect(await downloadDriveFile("file/1", "token")).toBe("<homebank/>");
    expect(fetch).toHaveBeenNthCalledWith(1, "https://www.googleapis.com/drive/v3/files/file%2F1?alt=media", expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer token" } }));
    await saveWalletToDrive(sampleWallet(), { id: "file/1", name: "test.xhb" }, "token");
    expect(fetch).toHaveBeenNthCalledWith(2, "https://www.googleapis.com/upload/drive/v3/files/file%2F1?uploadType=media", expect.objectContaining({ method: "PATCH", body: expect.stringContaining("<homebank") }));
  });
});
