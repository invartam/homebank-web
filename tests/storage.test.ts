import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSession, saveSession } from "../src/lib/storage";
import { sampleWallet } from "./fixtures";

const deleteDb = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase("homebank-web-mvp");
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
});

describe("IndexedDB session", () => {
  beforeEach(deleteDb);

  it("persists wallet, Drive file and pending state together", async () => {
    const session = { wallet: sampleWallet(), driveFile: { id: "1", name: "test.xhb" }, pendingDriveSave: true };
    const revision = await saveSession(session);
    expect(await loadSession()).toEqual({ ...session, revision });
    await saveSession({ ...session, revision, driveFile: null, pendingDriveSave: false });
    expect(await loadSession()).toMatchObject({ driveFile: null, pendingDriveSave: false });
  });

  it("reads existing MVP databases without a migration or pending flag", async () => {
    await saveSession({ wallet: sampleWallet(), driveFile: null, pendingDriveSave: false });
    const request = indexedDB.open("homebank-web-mvp", 1);
    await new Promise<void>((resolve) => { request.onsuccess = () => resolve(); });
    const transaction = request.result.transaction("wallet", "readwrite");
    transaction.objectStore("wallet").delete("drive-pending");
    transaction.objectStore("wallet").delete("session-revision");
    await new Promise<void>((resolve) => { transaction.oncomplete = () => { request.result.close(); resolve(); }; });
    expect((await loadSession())?.pendingDriveSave).toBe(false);
    expect((await loadSession())?.revision).toBe(0);
  });

  it("rolls back earlier writes when a later value cannot be stored", async () => {
    const initial = { wallet: sampleWallet(), driveFile: null, pendingDriveSave: false };
    const revision = await saveSession(initial);
    const invalidFile = { id: "1", name: "test.xhb", invalid: () => undefined };
    await expect(saveSession({ wallet: { ...initial.wallet, owner: "Must roll back" }, revision, driveFile: invalidFile, pendingDriveSave: true })).rejects.toThrow();
    expect(await loadSession()).toEqual({ ...initial, revision });
  });

  it("prevents stale windows from overwriting a newer session atomically", async () => {
    await saveSession({ wallet: sampleWallet(), driveFile: null, pendingDriveSave: false });
    const first = (await loadSession())!;
    const stale = (await loadSession())!;
    await saveSession({ ...first, wallet: { ...first.wallet, owner: "New owner" } });
    await expect(saveSession({ ...stale, wallet: { ...stale.wallet, owner: "Stale owner" } })).rejects.toThrow("autre fenetre");
    expect((await loadSession())?.wallet.owner).toBe("New owner");
  });

  it("allows only one of two competing writes to the same revision", async () => {
    const session = { wallet: sampleWallet(), driveFile: null, pendingDriveSave: false };
    const results = await Promise.allSettled([saveSession(session), saveSession(session)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await loadSession())?.revision).toBe(1);
  });
});
