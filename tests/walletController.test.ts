import { describe, expect, it, vi } from "vitest";
import { WalletController, type WalletPorts } from "../src/lib/walletController";
import type { WalletSession } from "../src/lib/storage";
import { newTransaction, withTransactionType } from "../src/lib/wallet";
import { sampleWallet } from "./fixtures";
import { DriveApiError, DriveAuthorizationError, DriveFileUnavailableError } from "../src/lib/googleDrive";

const session = (pendingDriveSave = false): WalletSession => ({
  wallet: sampleWallet(), driveFile: { id: "file-1", name: "test.xhb" }, pendingDriveSave,
});

function harness(stored: WalletSession | undefined = session()) {
  let persisted = stored;
  const ports: WalletPorts = {
    load: vi.fn(async () => persisted),
    save: vi.fn(async (next) => { persisted = structuredClone(next); }),
    driveConfigured: () => true,
    authorize: vi.fn(async () => "token"),
    pick: vi.fn(async () => ({ file: { id: "file-2", name: "other.xhb" }, accessToken: "token" })),
    verify: vi.fn(async () => undefined),
    download: vi.fn(async () => sampleWallet()),
    upload: vi.fn(async () => undefined),
  };
  const controller = new WalletController(ports);
  return { controller, ports, persisted: () => persisted };
}

describe("wallet persistence and Drive ordering", () => {
  it.each([false, true])("suspends missing-file restoration and preserves the cached session (pending=%s)", async (pending) => {
    const stored = session(pending);
    const { controller, ports, persisted } = harness(stored);
    vi.mocked(ports.verify).mockRejectedValue(new DriveFileUnavailableError());
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ ...stored, driveConnection: "file-missing", driveRetryAt: 0 });
    expect(persisted()).toEqual(stored);
    expect(ports.download).not.toHaveBeenCalled();
    expect(ports.upload).not.toHaveBeenCalled();
    controller.setOnline(false);
    controller.setOnline(true);
    await controller.resumeDrive(true);
    await controller.commit(newTransaction(1), "Local only");
    expect(ports.verify).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "file-missing", pendingDriveSave: true });
    expect(ports.upload).not.toHaveBeenCalled();
  });

  it("revalidates before every upload and periodically without replacing the wallet", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100000);
    const { controller, ports } = harness();
    await controller.initialize();
    await controller.resumeDrive();
    expect(ports.verify).toHaveBeenCalledTimes(1);
    now.mockReturnValue(160000);
    await controller.resumeDrive();
    expect(ports.verify).toHaveBeenCalledTimes(2);
    expect(ports.download).toHaveBeenCalledTimes(1);
    vi.mocked(ports.verify).mockRejectedValueOnce(new DriveFileUnavailableError("Dans la corbeille"));
    await controller.commit(newTransaction(1), "After removal");
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "file-missing", pendingDriveSave: true });
    expect(controller.getSnapshot().wallet.transactions).toHaveLength(6);
    expect(ports.upload).not.toHaveBeenCalled();
  });

  it.each(["download", "upload"] as const)("handles a file disappearing between verification and %s", async (operation) => {
    const { controller, ports } = harness();
    if (operation === "download") vi.mocked(ports.download).mockRejectedValueOnce(new DriveFileUnavailableError());
    await controller.initialize();
    if (operation === "upload") {
      vi.mocked(ports.upload).mockRejectedValueOnce(new DriveFileUnavailableError());
      await controller.commit(newTransaction(1), "Pending");
    }
    expect(controller.getSnapshot().driveConnection).toBe("file-missing");
    await controller.resumeDrive(true);
    expect(ports.verify).toHaveBeenCalledTimes(operation === "download" ? 1 : 2);
  });

  it.each([401, 403, 503])("does not label HTTP %s verification errors as a missing file", async (status) => {
    const { controller, ports } = harness();
    vi.mocked(ports.verify).mockRejectedValueOnce(new DriveApiError("API failed", status, status === 503));
    await controller.initialize();
    expect(controller.getSnapshot().driveConnection).not.toBe("file-missing");
    expect(ports.download).not.toHaveBeenCalled();
  });

  it("requires explicit approval to replace unsynced edits and never uploads them to the replacement", async () => {
    const { controller, ports, persisted } = harness(session(true));
    vi.mocked(ports.verify).mockRejectedValueOnce(new DriveFileUnavailableError());
    await controller.initialize();
    expect(await controller.chooseDriveFile()).toBe(false);
    expect(ports.pick).not.toHaveBeenCalled();
    const replacement = sampleWallet();
    replacement.owner = "Replacement";
    vi.mocked(ports.download).mockResolvedValueOnce(replacement);
    expect(await controller.chooseDriveFile(true)).toBe(true);
    expect(persisted()).toMatchObject({ wallet: replacement, driveFile: { id: "file-2", name: "other.xhb" }, pendingDriveSave: false });
    expect(controller.getSnapshot().driveConnection).toBe("connected");
    expect(ports.upload).not.toHaveBeenCalled();
  });

  it.each(["pick", "verify", "download", "save"] as const)("keeps the old wallet, reference and pending edits when replacement fails at %s", async (operation) => {
    const stored = session(true);
    const { controller, ports, persisted } = harness(stored);
    vi.mocked(ports.verify).mockRejectedValueOnce(new DriveFileUnavailableError());
    await controller.initialize();
    vi.mocked(ports[operation]).mockRejectedValueOnce(new Error("Cancelled or invalid replacement"));
    expect(await controller.chooseDriveFile(true)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ ...stored, driveConnection: "file-missing" });
    expect(persisted()).toEqual(stored);
    expect(ports.upload).not.toHaveBeenCalled();
  });

  it("saves and uploads both sides of a transfer in one snapshot and one revision", async () => {
    const { controller, ports, persisted } = harness();
    await controller.initialize();
    vi.mocked(ports.save).mockClear();
    const transfer = withTransactionType({ ...newTransaction(1), destinationAccountKey: 2 }, "transfer", 50);
    expect(await controller.commit(transfer, "")).toBe(true);
    expect(ports.upload).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(ports.upload).mock.calls[0][0];
    expect(uploaded.transactions.slice(-2).map((item) => item.amount)).toEqual([-50, 50]);
    expect(ports.save).toHaveBeenCalledTimes(2);
    expect(persisted()?.wallet.transactions).toHaveLength(7);
    ports.save = vi.fn(async () => { throw new Error("Storage full"); });
    expect(await controller.commit(withTransactionType({ ...newTransaction(1), destinationAccountKey: 2 }, "transfer", 20), "")).toBe(false);
    expect(controller.getSnapshot().wallet.transactions).toHaveLength(7);
    expect(ports.upload).toHaveBeenCalledTimes(1);
  });
  it("initializes only once even with React StrictMode", async () => {
    const { controller, ports } = harness();
    await Promise.all([controller.initialize(), controller.initialize()]);
    expect(ports.load).toHaveBeenCalledTimes(1);
    expect(ports.download).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ hydrated: true, busy: false });
  });

  it("preserves unsynced edits across reload and uploads them on reconnect without downloading", async () => {
    const pending = session(true);
    pending.wallet.owner = "Offline edits";
    const { controller, ports, persisted } = harness(pending);
    vi.mocked(ports.authorize).mockRejectedValueOnce(new DriveAuthorizationError("login_required"));
    await controller.initialize();
    expect(ports.authorize).toHaveBeenCalledWith(false);
    expect(ports.download).not.toHaveBeenCalled();
    await controller.connectDrive();
    expect(ports.upload).toHaveBeenCalledWith(pending.wallet, pending.driveFile, "token");
    expect(ports.download).not.toHaveBeenCalled();
    expect(persisted()?.pendingDriveSave).toBe(false);
    expect(controller.getSnapshot().wallet.owner).toBe("Offline edits");
  });

  it("persists a pending snapshot before uploading and retains it after network failure", async () => {
    const { controller, ports, persisted } = harness();
    await controller.initialize();
    ports.upload = vi.fn(async () => {
      expect(persisted()?.pendingDriveSave).toBe(true);
      throw new Error("Network offline");
    });
    await controller.commit(newTransaction(1), "");
    expect(persisted()?.wallet.transactions).toHaveLength(6);
    expect(persisted()?.pendingDriveSave).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ busy: false, driveSaving: false, pendingDriveSave: true });
    expect(controller.getSnapshot().message).toContain("conservees localement");
  });

  it("serializes concurrent modifications without lost transactions or overlapping uploads", async () => {
    const { controller, ports } = harness();
    await controller.initialize();
    let finishFirst: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const waiting = new Promise<void>((resolve) => { finishFirst = resolve; });
    const amounts: number[] = [];
    ports.upload = vi.fn(async (wallet) => {
      amounts.push(wallet.transactions.length);
      if (amounts.length === 1) { entered(); await waiting; }
    });
    const first = controller.commit(newTransaction(1), "First");
    await started;
    const second = controller.commit(newTransaction(1), "Second");
    expect(ports.upload).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, second]);
    expect(amounts).toEqual([6, 7]);
    expect(controller.getSnapshot().wallet.payees).toHaveLength(3);
    expect(controller.getSnapshot()).toMatchObject({ pendingDriveSave: false, busy: false });
  });

  it("does not upload or discard the form draft when local persistence fails", async () => {
    const { controller, ports } = harness();
    await controller.initialize();
    ports.save = vi.fn(async () => { throw new Error("Storage full"); });
    expect(await controller.commit(newTransaction(1), "")).toBe(false);
    expect(ports.upload).not.toHaveBeenCalled();
    expect(controller.getSnapshot().wallet.transactions).toHaveLength(5);
  });

  it("does not overwrite local storage after a restore failure", async () => {
    const { controller, ports } = harness();
    ports.load = vi.fn(async () => { throw new Error("Storage unavailable"); });
    await controller.initialize();
    expect(ports.save).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ hydrated: true, busy: false, message: "Storage unavailable" });
  });

  it("preserves the reconnect message when silent authentication is refused", async () => {
    const { controller, ports } = harness();
    ports.authorize = vi.fn(async () => { throw new Error("Login required"); });
    await controller.initialize();
    expect(controller.getSnapshot().wallet.transactions).toHaveLength(5);
    expect(controller.getSnapshot().message).toContain("Reconnecte Drive");
    expect(ports.save).not.toHaveBeenCalled();
  });

  it("detaches Drive atomically on local import and clears pending state on reset", async () => {
    const { controller, ports, persisted } = harness(session(true));
    await controller.initialize();
    vi.mocked(ports.upload).mockClear();
    await controller.importWallet(sampleWallet());
    expect(persisted()).toMatchObject({ driveFile: null, pendingDriveSave: false });
    await controller.commit(newTransaction(1), "");
    expect(ports.upload).not.toHaveBeenCalled();
    await controller.reset();
    expect(persisted()?.wallet.transactions).toHaveLength(0);
    expect(controller.getSnapshot().busy).toBe(false);
  });
});

describe("automatic Drive recovery", () => {
  it("uploads pending changes on restore instead of downloading over them", async () => {
    const pending = session(true);
    pending.wallet.owner = "Local changes";
    const { controller, ports, persisted } = harness(pending);
    await controller.initialize();
    expect(ports.download).not.toHaveBeenCalled();
    expect(ports.upload).toHaveBeenCalledExactlyOnceWith(pending.wallet, pending.driveFile, "token");
    expect(persisted()?.pendingDriveSave).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "connected", driveError: "" });
    await controller.resumeDrive();
    expect(ports.authorize).toHaveBeenCalledTimes(1);
    expect(ports.upload).toHaveBeenCalledTimes(1);
  });

  it("keeps offline edits local and resumes with the newest wallet when online", async () => {
    const { controller, ports, persisted } = harness();
    controller.setOnline(false);
    await controller.initialize();
    expect(controller.getSnapshot()).toMatchObject({ hydrated: true, driveConnection: "offline", busy: false });
    expect(ports.authorize).not.toHaveBeenCalled();
    expect(await controller.commit(newTransaction(1), "Offline")).toBe(true);
    expect(persisted()?.pendingDriveSave).toBe(true);
    expect(await controller.resumeDrive(true)).toBe(false);
    expect(ports.upload).not.toHaveBeenCalled();
    controller.setOnline(true);
    expect(await controller.resumeDrive(true)).toBe(true);
    expect(ports.download).not.toHaveBeenCalled();
    expect(vi.mocked(ports.upload).mock.calls[0][0].transactions).toHaveLength(6);
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "connected", pendingDriveSave: false });
  });

  it("backs off transient errors and retries with the same valid token", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100000);
    const { controller, ports } = harness();
    await controller.initialize();
    vi.mocked(ports.upload).mockRejectedValueOnce(new DriveApiError("Unavailable", 503, true)).mockRejectedValueOnce(new TypeError("Network error"));
    await controller.commit(newTransaction(1), "");
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "disconnected", driveRetryAt: 105000, pendingDriveSave: true });
    await controller.resumeDrive();
    expect(ports.upload).toHaveBeenCalledTimes(1);
    now.mockReturnValue(105000);
    expect(await controller.resumeDrive()).toBe(false);
    expect(controller.getSnapshot().driveRetryAt).toBe(115000);
    now.mockReturnValue(115000);
    expect(await controller.resumeDrive()).toBe(true);
    expect(ports.authorize).toHaveBeenCalledTimes(1);
    expect(ports.upload).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot()).toMatchObject({ pendingDriveSave: false, driveRetryAt: 0 });
  });

  it("reauthorizes after a 401 and uploads the newest queued changes without downloading", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100000);
    const { controller, ports } = harness();
    vi.mocked(ports.authorize).mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    await controller.initialize();
    vi.mocked(ports.upload).mockRejectedValueOnce(new DriveApiError("Token expired", 401, false));
    await controller.commit(newTransaction(1), "First");
    await controller.commit(newTransaction(1), "Second");
    expect(ports.upload).toHaveBeenCalledTimes(1);
    now.mockReturnValue(105000);
    expect(await controller.resumeDrive()).toBe(true);
    expect(ports.authorize).toHaveBeenLastCalledWith(false);
    expect(vi.mocked(ports.upload).mock.calls[1][0].transactions).toHaveLength(7);
    expect(vi.mocked(ports.upload).mock.calls[1][2]).toBe("new");
    expect(ports.download).toHaveBeenCalledTimes(1);
  });

  it("detects token expiry and stops silent attempts when a user gesture is required", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100000);
    const { controller, ports } = harness();
    ports.tokenExpiresAt = () => Date.now() + 1000;
    await controller.initialize();
    vi.mocked(ports.authorize).mockRejectedValueOnce(new DriveAuthorizationError("popup_failed_to_open"));
    now.mockReturnValue(101001);
    expect(await controller.resumeDrive()).toBe(false);
    expect(controller.getSnapshot().driveConnection).toBe("auth-required");
    for (let i = 0; i < 3; i++) {
      controller.setOnline(false);
      controller.setOnline(true);
      await controller.resumeDrive(true);
    }
    expect(ports.authorize).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().driveConnection).toBe("auth-required");
    await controller.commit(newTransaction(1), "Pending");
    expect(ports.upload).not.toHaveBeenCalled();
    expect(await controller.connectDrive()).toBe(true);
    expect(ports.authorize).toHaveBeenLastCalledWith(true);
    expect(ports.upload).toHaveBeenCalledTimes(1);
    expect(ports.download).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().driveConnection).toBe("connected");
  });

  it("does not retry permanent permissions failures automatically", async () => {
    const { controller, ports } = harness();
    await controller.initialize();
    vi.mocked(ports.upload).mockRejectedValueOnce(new DriveApiError("Permission denied", 403, false));
    await controller.commit(newTransaction(1), "");
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "error", pendingDriveSave: true });
    await controller.resumeDrive(true);
    controller.setOnline(false);
    controller.setOnline(true);
    await controller.commit(newTransaction(1), "More edits");
    expect(ports.upload).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().driveConnection).toBe("error");
  });

  it("uses a single background attempt and serializes foreground edits behind it", async () => {
    const { controller, ports } = harness(session(true));
    controller.setOnline(false);
    await controller.initialize();
    let finish: (token: string) => void = () => undefined;
    ports.authorize = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    controller.setOnline(true);
    const first = controller.resumeDrive(true);
    const second = controller.resumeDrive(true);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(controller.getSnapshot()).toMatchObject({ busy: false, driveConnection: "reconnecting" });
    const edit = controller.commit(newTransaction(1), "Queued");
    expect(controller.getSnapshot().busy).toBe(true);
    finish("token");
    await Promise.all([first, edit]);
    expect(ports.authorize).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ports.upload).mock.calls.map(([wallet]) => wallet.transactions.length)).toEqual([5, 6]);
    expect(controller.getSnapshot()).toMatchObject({ busy: false, pendingDriveSave: false });
  });

  it("does not upload duplicate revisions when local acknowledgement fails", async () => {
    const { controller, ports } = harness();
    await controller.initialize();
    const save = ports.save;
    ports.save = vi.fn((next) => save(next)).mockImplementationOnce((next) => save(next)).mockRejectedValueOnce(new Error("Storage full"));
    await controller.commit(newTransaction(1), "");
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "error", pendingDriveSave: true });
    await controller.resumeDrive(true);
    expect(ports.upload).toHaveBeenCalledTimes(1);
    expect(await controller.connectDrive()).toBe(true);
    expect(ports.upload).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "connected", pendingDriveSave: false });
  });

  it("does not reconnect a detached local file", async () => {
    const { controller, ports } = harness();
    await controller.initialize();
    await controller.importWallet(sampleWallet());
    await controller.resumeDrive(true);
    controller.setOnline(false);
    controller.setOnline(true);
    expect(controller.getSnapshot()).toMatchObject({ driveConnection: "local", driveFile: null });
    expect(ports.authorize).toHaveBeenCalledTimes(1);
    expect(ports.upload).not.toHaveBeenCalled();
  });
});
