import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  native: true, platform: "ios", configured: true,
  configuration: vi.fn(), authorize: vi.fn(), pick: vi.fn(), verify: vi.fn(), download: vi.fn(), save: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform },
  registerPlugin: () => ({ getConfiguration: mock.configuration, authorize: mock.authorize, pick: mock.pick,
    verify: mock.verify, download: mock.download, save: mock.save }),
}));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("VITE_NATIVE_APP", true);
  mock.native = true; mock.platform = "ios"; mock.configured = true;
  mock.configuration.mockImplementation(async () => ({ configured: mock.configured }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("mobile Google Drive adapter", () => {
  it.each(["ios", "android"])("initializes %s before restoration and reuses the native contract without bearer tokens", async platform => {
    mock.platform = platform;
    const { initializeMobileDrive } = await import("../src/lib/mobileDrive");
    await Promise.all([initializeMobileDrive(), initializeMobileDrive()]);
    expect(mock.configuration).toHaveBeenCalledTimes(1);
    const drive = await import("../src/lib/googleDrive");
    expect(drive.googleDriveConfigured()).toBe(true);
    const expiresAt = Date.now() + 3600000;
    mock.authorize.mockResolvedValue({ ok: true, value: { expiresAt } });
    const token = await drive.requestDriveAccessToken("none");
    expect(drive.driveAccessTokenExpiresAt(token)).toBe(expiresAt);
    expect(mock.authorize).toHaveBeenCalledWith({ prompt: "none" });
    mock.pick.mockResolvedValue({ ok: true, value: { file: { id: "file", name: "demo.xhb" }, expiresAt } });
    expect((await drive.pickDriveHomeBankFile()).file.name).toBe("demo.xhb");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mock.verify.mockResolvedValue({ ok: true, value: null });
    await drive.verifyDriveFile({ id: "file", name: "demo.xhb" }, token);
    mock.download.mockResolvedValue({ ok: true, value: "<homebank/>" });
    expect(await drive.downloadDriveFile("file", token)).toBe("<homebank/>");
    mock.save.mockResolvedValue({ ok: true, value: null });
    const { sampleWallet } = await import("./fixtures");
    await drive.saveWalletToDrive(sampleWallet(), { id: "file", name: "demo.xhb" }, token);
    expect(mock.save).toHaveBeenCalledWith({ fileId: "file", xml: expect.stringContaining("<homebank") });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps unsupported, web and desktop runtimes away from mobile authorization", async () => {
    for (const platform of ["web", "electron"]) {
      mock.platform = platform;
      const { initializeMobileDrive, mobileDrive } = await import("../src/lib/mobileDrive");
      await initializeMobileDrive();
      expect(mobileDrive()).toBeUndefined();
    }
    mock.platform = "ios"; mock.native = false;
    await (await import("../src/lib/mobileDrive")).initializeMobileDrive();
    expect(mock.configuration).not.toHaveBeenCalled();
  });
  it("leaves Drive disabled when the platform's OAuth client is absent", async () => {
    mock.configured = false;
    await (await import("../src/lib/mobileDrive")).initializeMobileDrive();
    expect((await import("../src/lib/googleDrive")).googleDriveConfigured()).toBe(false);
  });
  it("does not prevent local startup if the native plugin is unavailable", async () => {
    mock.configuration.mockRejectedValue(new Error("Not implemented"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initializeMobileDrive, mobileDrive } = await import("../src/lib/mobileDrive");
    await initializeMobileDrive();
    expect(mobileDrive()).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });
  it("does not leave the app blank if the native bridge fails to respond", async () => {
    vi.useFakeTimers();
    mock.configuration.mockImplementation(() => new Promise(() => {}));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { initializeMobileDrive, mobileDrive } = await import("../src/lib/mobileDrive");
    const initializing = initializeMobileDrive();
    await vi.advanceTimersByTimeAsync(5001);
    await initializing;
    expect(mobileDrive()).toBeUndefined();
    warning.mockRestore();
  });
  it("preserves authorization, missing-file and retryable API errors for wallet recovery", async () => {
    await (await import("../src/lib/mobileDrive")).initializeMobileDrive();
    const drive = await import("../src/lib/googleDrive");
    mock.authorize.mockResolvedValue({ ok: false, error: { kind: "authorization", message: "Reconnect", requiresInteraction: true } });
    await expect(drive.requestDriveAccessToken("none")).rejects.toBeInstanceOf(drive.DriveAuthorizationError);
    for (const [status, retryable] of [[404, false], [403, false], [429, true], [503, true]]) {
      mock.download.mockResolvedValue({ ok: false, error: { kind: "api", message: "Unavailable", status, retryable } });
      await expect(drive.downloadDriveFile("file", "session")).rejects.toMatchObject({ status, retryable });
    }
  });
});
