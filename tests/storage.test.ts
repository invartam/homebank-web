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
    await saveSession(session);
    expect(await loadSession()).toEqual(session);
    await saveSession({ ...session, driveFile: null, pendingDriveSave: false });
    expect(await loadSession()).toMatchObject({ driveFile: null, pendingDriveSave: false });
  });

  it("reads existing MVP databases without a migration or pending flag", async () => {
    await saveSession({ wallet: sampleWallet(), driveFile: null, pendingDriveSave: false });
    const request = indexedDB.open("homebank-web-mvp", 1);
    await new Promise<void>((resolve) => { request.onsuccess = () => resolve(); });
    const transaction = request.result.transaction("wallet", "readwrite");
    transaction.objectStore("wallet").delete("drive-pending");
    await new Promise<void>((resolve) => { transaction.oncomplete = () => { request.result.close(); resolve(); }; });
    expect((await loadSession())?.pendingDriveSave).toBe(false);
  });

  it("rolls back earlier writes when a later value cannot be stored", async () => {
    const initial = { wallet: sampleWallet(), driveFile: null, pendingDriveSave: false };
    await saveSession(initial);
    const invalidFile = { id: "1", name: "test.xhb", invalid: () => undefined };
    await expect(saveSession({ wallet: { ...initial.wallet, owner: "Must roll back" }, driveFile: invalidFile, pendingDriveSave: true })).rejects.toThrow();
    expect(await loadSession()).toEqual(initial);
  });
});
