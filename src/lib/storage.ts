import type { Wallet } from "./homebank";
import type { DriveFileRef } from "./googleDrive";

const DB_NAME = "homebank-web-mvp";
const STORE_NAME = "wallet";
const WALLET_KEY = "current";
const DRIVE_FILE_KEY = "drive-file";
const PENDING_DRIVE_KEY = "drive-pending";
const REVISION_KEY = "session-revision";

export class SessionConflictError extends Error {
  constructor() { super("Le portefeuille a change dans une autre fenetre. Exportez votre copie puis rechargez avant de modifier."); }
}

export interface WalletSession {
  wallet: Wallet;
  driveFile: DriveFileRef | null;
  pendingDriveSave: boolean;
  revision?: number;
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let blocked = false;

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Stockage local bloque par une autre fenetre.")); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, abort: (error: unknown) => void) => () => T) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    let result: () => T;
    let failure: unknown;
    transaction.oncomplete = () => {
      db.close();
      resolve(result());
    };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(failure ?? transaction.error ?? new Error("Transaction IndexedDB interrompue."));
    };
    try {
      result = run(transaction.objectStore(STORE_NAME), (error) => { failure = error; transaction.abort(); });
    } catch (error) {
      transaction.abort();
      db.close();
      reject(error);
    }
  });
};

export const loadSession = () => withStore("readonly", (store) => {
  const wallet = store.get(WALLET_KEY);
  const file = store.get(DRIVE_FILE_KEY);
  const pending = store.get(PENDING_DRIVE_KEY);
  const revision = store.get(REVISION_KEY);
  return (): WalletSession | undefined => wallet.result ? {
    wallet: wallet.result as Wallet,
    driveFile: (file.result as DriveFileRef | undefined) ?? null,
    pendingDriveSave: pending.result === true,
    revision: (revision.result as number | undefined) ?? 0,
  } : undefined;
});

export const saveSession = (session: WalletSession) => withStore("readwrite", (store, abort) => {
  let revision = 0;
  const current = store.get(REVISION_KEY);
  current.onsuccess = () => {
    if ((current.result ?? 0) !== (session.revision ?? 0)) { abort(new SessionConflictError()); return; }
    try {
      revision = (current.result ?? 0) + 1;
      store.put(session.wallet, WALLET_KEY);
      if (session.driveFile) store.put(session.driveFile, DRIVE_FILE_KEY);
      else store.delete(DRIVE_FILE_KEY);
      store.put(session.pendingDriveSave, PENDING_DRIVE_KEY);
      store.put(revision, REVISION_KEY);
    } catch (error) { abort(error); }
  };
  return () => revision;
});
