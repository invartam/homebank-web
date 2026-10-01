import type { Wallet } from "./homebank";
import type { DriveFileRef } from "./googleDrive";

const DB_NAME = "homebank-web-mvp";
const STORE_NAME = "wallet";
const WALLET_KEY = "current";
const DRIVE_FILE_KEY = "drive-file";
const PENDING_DRIVE_KEY = "drive-pending";

export interface WalletSession {
  wallet: Wallet;
  driveFile: DriveFileRef | null;
  pendingDriveSave: boolean;
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => () => T) => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    let result: () => T;
    transaction.oncomplete = () => {
      db.close();
      resolve(result());
    };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Transaction IndexedDB interrompue."));
    };
    try {
      result = run(transaction.objectStore(STORE_NAME));
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
  return (): WalletSession | undefined => wallet.result ? {
    wallet: wallet.result as Wallet,
    driveFile: (file.result as DriveFileRef | undefined) ?? null,
    pendingDriveSave: pending.result === true,
  } : undefined;
});

export const saveSession = (session: WalletSession) => withStore("readwrite", (store) => {
  store.put(session.wallet, WALLET_KEY);
  if (session.driveFile) store.put(session.driveFile, DRIVE_FILE_KEY);
  else store.delete(DRIVE_FILE_KEY);
  store.put(session.pendingDriveSave, PENDING_DRIVE_KEY);
  return () => undefined;
});
