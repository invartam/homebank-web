import { type Transaction, type Wallet, emptyWallet } from "./homebank";
import { commitTransaction, setTransactionStatus } from "./wallet";
import { DriveApiError, DriveAuthorizationError, DriveFileUnavailableError, type DriveFileRef } from "./googleDrive";
import type { WalletSession } from "./storage";

export interface WalletPorts {
  load: () => Promise<WalletSession | undefined>;
  save: (session: WalletSession) => Promise<unknown>;
  driveConfigured: () => boolean;
  authorize: (interactive: boolean) => Promise<string>;
  pick: () => Promise<{ file: DriveFileRef; accessToken: string }>;
  verify: (file: DriveFileRef, token: string) => Promise<void>;
  download: (file: DriveFileRef, token: string) => Promise<Wallet>;
  upload: (wallet: Wallet, file: DriveFileRef, token: string) => Promise<void>;
  tokenExpiresAt?: (token: string) => number | undefined;
}

export type DriveConnection = "local" | "connected" | "reconnecting" | "disconnected" | "offline" | "auth-required" | "file-missing" | "error";

export interface WalletState extends WalletSession {
  message: string;
  busy: boolean;
  hydrated: boolean;
  driveSaving: boolean;
  driveConnection: DriveConnection;
  driveError: string;
  driveRetryAt: number;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Operation impossible.";

export class WalletController {
  private state: WalletState = {
    wallet: emptyWallet(), driveFile: null, pendingDriveSave: false,
    message: "Chargement du portefeuille...", busy: false, hydrated: false, driveSaving: false,
    driveConnection: "local", driveError: "", driveRetryAt: 0,
  };
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<boolean>;
  private token = "";
  private tokenExpiry = 0;
  private jobs = 0;
  private foregroundJobs = 0;
  private online = true;
  private retryCount = 0;
  private reconnecting?: Promise<boolean>;
  private refreshNeeded = false;
  private blockedConnection?: "auth-required" | "file-missing" | "error";
  private verifiedAt?: number;
  private uploadedWallet?: Wallet;

  constructor(private ports: WalletPorts) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<WalletState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private session(): WalletSession {
    const { wallet, driveFile, pendingDriveSave } = this.state;
    return { wallet, driveFile, pendingDriveSave };
  }

  private run(action: () => Promise<void | boolean>, background = false): Promise<boolean> {
    this.jobs++;
    if (!background) {
      this.foregroundJobs++;
      this.publish({ busy: true });
    }
    const job = this.queue.then(async () => {
      try {
        return await action() !== false;
      } catch (error) {
        this.publish({ message: errorMessage(error) });
        return false;
      } finally {
        this.jobs--;
        if (!background) this.foregroundJobs--;
        this.publish({ busy: this.foregroundJobs > 0 });
      }
    });
    this.queue = job;
    return job;
  }

  initialize = () => {
    this.initialization ??= this.run(async () => {
      try {
        const stored = await this.ports.load();
        if (!stored) {
          this.publish({ message: "Aucun fichier charge." });
          return;
        }
        this.publish({ ...stored, message: `Portefeuille local restaure : ${stored.wallet.sourceFileName ?? "sans nom"}.` });
        if (!stored.driveFile) return;
        this.refreshNeeded = !stored.pendingDriveSave;
        this.publish({ driveConnection: this.online ? "disconnected" : "offline" });
        if (!this.ports.driveConfigured()) {
          this.blockedConnection = "error";
          this.publish({ driveConnection: "error", driveError: "Configuration Google Drive manquante." });
          return;
        }
        await this.recoverDrive(false);
      } finally {
        this.publish({ hydrated: true });
      }
    });
    return this.initialization;
  };

  private async replace(session: WalletSession) {
    await this.ports.save(session);
    this.publish(session);
  }

  private acceptToken(token: string) {
    this.token = token;
    this.tokenExpiry = this.ports.tokenExpiresAt?.(token) ?? Date.now() + 3600000;
  }

  private connected() {
    this.retryCount = 0;
    this.blockedConnection = undefined;
    this.publish({ driveConnection: this.online ? "connected" : "offline", driveError: "", driveRetryAt: 0 });
  }

  private interrupted(error: unknown) {
    const missing = error instanceof DriveFileUnavailableError || (error instanceof DriveApiError && error.status === 404);
    const needsAuth = error instanceof DriveAuthorizationError && error.requiresInteraction;
    const permanent = error instanceof DriveApiError && error.status !== 401 && !error.retryable;
    this.blockedConnection = missing ? "file-missing" : needsAuth ? "auth-required" : permanent ? "error" : undefined;
    if (needsAuth || (error instanceof DriveApiError && error.status === 401)) {
      this.token = "";
      this.tokenExpiry = 0;
    }
    const delay = Math.min(5000 * 2 ** Math.min(this.retryCount++, 6), 300000);
    this.publish({
      driveConnection: missing ? "file-missing" : !this.online ? "offline" : needsAuth ? "auth-required" : permanent ? "error" : "disconnected",
      driveError: errorMessage(error),
      driveRetryAt: needsAuth || permanent ? 0 : Date.now() + delay,
      message: `${errorMessage(error)} Copie locale conservee.${needsAuth ? " Reconnecte Drive." : ""}`,
    });
  }

  private async verifyFile(file: DriveFileRef) {
    await this.ports.verify(file, this.token);
    this.verifiedAt = Date.now();
  }

  private async authorize(interactive: boolean) {
    try {
      this.acceptToken(await this.ports.authorize(interactive));
    } catch (error) {
      throw error instanceof DriveAuthorizationError ? error : new DriveAuthorizationError(errorMessage(error));
    }
  }

  private async recoverDrive(interactive: boolean): Promise<boolean> {
    const file = this.state.driveFile;
    if (!file) return false;
    if (!this.online) {
      this.publish({ driveConnection: "offline" });
      return false;
    }
    if (interactive) this.blockedConnection = undefined;
    this.publish({ driveConnection: "reconnecting", driveError: "", driveRetryAt: 0 });
    try {
      if (interactive || !this.token || Date.now() >= this.tokenExpiry) await this.authorize(interactive);
      if (this.state.pendingDriveSave) {
        const saved = await this.sync("Modifications locales enregistrees.");
        if (!saved) return false;
      } else {
        await this.verifyFile(file);
        if (this.refreshNeeded || interactive) {
          const wallet = await this.ports.download(file, this.token);
          await this.replace({ wallet, driveFile: file, pendingDriveSave: false });
        }
      }
      this.refreshNeeded = false;
      this.connected();
      this.publish({ message: `${file.name} reconnecte a Google Drive.` });
      return true;
    } catch (error) {
      this.interrupted(error);
      return false;
    }
  }

  setOnline = (online: boolean) => {
    if (this.online === online) return;
    this.online = online;
    if (!this.state.driveFile) return;
    if (!online) this.publish({ driveConnection: this.blockedConnection === "file-missing" ? "file-missing" : "offline" });
    else this.publish({ driveConnection: this.blockedConnection ?? (this.token && Date.now() < this.tokenExpiry ? "connected" : "disconnected") });
  };

  resumeDrive = (force = false): Promise<boolean> => {
    if (this.reconnecting) return this.reconnecting;
    if (!this.state.hydrated || !this.state.driveFile || !this.ports.driveConfigured() || !this.online || this.jobs > 0
      || this.blockedConnection
      || (!force && Date.now() < this.state.driveRetryAt)) return Promise.resolve(false);
    if (this.token && Date.now() < this.tokenExpiry && !this.state.pendingDriveSave && !this.refreshNeeded
      && this.verifiedAt !== undefined && Date.now() - this.verifiedAt < 60000) {
      if (this.state.driveConnection !== "connected") this.connected();
      return Promise.resolve(true);
    }
    this.reconnecting = this.run(() => this.recoverDrive(false), true).finally(() => { this.reconnecting = undefined; });
    return this.reconnecting;
  };

  private async sync(success: string) {
    const { wallet, driveFile, pendingDriveSave } = this.state;
    if (!driveFile || !pendingDriveSave) {
      this.publish({ message: success });
      return true;
    }
    if (!this.online || !this.token || Date.now() >= this.tokenExpiry || this.blockedConnection || Date.now() < this.state.driveRetryAt) {
      this.publish({ driveConnection: this.blockedConnection === "file-missing" ? "file-missing" : !this.online ? "offline" : this.blockedConnection ?? "disconnected",
        message: `${success} Modifications en attente de synchronisation Drive.` });
      return false;
    }
    this.publish({ driveSaving: true });
    try {
      // Do not resend a revision if only its local acknowledgement needs retrying.
      if (this.uploadedWallet !== wallet) {
        await this.verifyFile(driveFile);
        await this.ports.upload(wallet, driveFile, this.token);
        this.uploadedWallet = wallet;
      }
      try {
        await this.replace({ wallet, driveFile, pendingDriveSave: false });
      } catch (error) {
        this.blockedConnection = "error";
        this.publish({ driveConnection: "error", driveError: `Confirmation locale impossible : ${errorMessage(error)}`, driveRetryAt: 0,
          message: "Fichier sauvegarde sur Drive, mais confirmation locale impossible. Synchronisation suspendue." });
        return false;
      }
      this.uploadedWallet = undefined;
      this.connected();
      this.publish({ message: `${success} Nouvelle version Google Drive sauvegardee.` });
      return true;
    } catch (error) {
      this.interrupted(error);
      this.publish({ message: `${errorMessage(error)} Modifications conservees localement.` });
      return false;
    } finally {
      this.publish({ driveSaving: false });
    }
  }

  importWallet = (wallet: Wallet) => this.run(async () => {
    await this.replace({ wallet, driveFile: null, pendingDriveSave: false });
    this.token = "";
    this.tokenExpiry = 0;
    this.refreshNeeded = false;
    this.retryCount = 0;
    this.blockedConnection = undefined;
    this.uploadedWallet = undefined;
    this.verifiedAt = undefined;
    this.publish({ driveConnection: "local", driveError: "", driveRetryAt: 0,
      message: `${wallet.sourceFileName ?? "Fichier"} importe : ${wallet.transactions.length} operations.` });
  });

  connectDrive = () => this.run(async () => {
    if (this.state.driveFile) {
      if (!await this.recoverDrive(true)) throw new Error(this.state.driveError || "Google Drive est hors ligne.");
    } else {
      await this.selectDriveFile();
    }
    this.publish({ message: `${this.state.driveFile?.name} charge depuis Google Drive.` });
  });

  private async selectDriveFile() {
    if (!this.online) throw new Error("Google Drive est hors ligne.");
    const selected = await this.ports.pick();
    await this.ports.verify(selected.file, selected.accessToken);
    const wallet = await this.ports.download(selected.file, selected.accessToken);
    // Keep the previous wallet and pending edits until the replacement is valid and persisted.
    await this.replace({ wallet, driveFile: selected.file, pendingDriveSave: false });
    this.acceptToken(selected.accessToken);
    this.verifiedAt = Date.now();
    this.refreshNeeded = false;
    this.uploadedWallet = undefined;
    this.connected();
  }

  chooseDriveFile = (discardPending = false) => this.run(async () => {
    if (this.state.pendingDriveSave && !discardPending) {
      throw new Error("Exporte les modifications locales ou confirme leur remplacement avant de charger un autre fichier.");
    }
    await this.selectDriveFile();
    this.publish({ message: `${this.state.driveFile?.name} charge depuis Google Drive.` });
  });

  private async persistTransaction(wallet: Wallet, message: string) {
    await this.replace({ wallet, driveFile: this.state.driveFile, pendingDriveSave: Boolean(this.state.driveFile) });
    await this.sync(message);
  }

  commit = (transaction: Transaction, payee: string) => this.run(async () => {
    const wallet = commitTransaction(this.state.wallet, transaction, payee);
    await this.persistTransaction(wallet, "Operation enregistree localement.");
  });

  mark = (id: string, status: Transaction["status"]) => this.run(async () => {
    const wallet = setTransactionStatus(this.state.wallet, id, status);
    await this.persistTransaction(wallet, status === "reconciled" ? "Operation rapprochee." : "Operation pointee.");
  });

  reset = () => this.run(async () => {
    await this.replace({ wallet: emptyWallet(), driveFile: null, pendingDriveSave: false });
    this.token = "";
    this.tokenExpiry = 0;
    this.refreshNeeded = false;
    this.retryCount = 0;
    this.blockedConnection = undefined;
    this.uploadedWallet = undefined;
    this.verifiedAt = undefined;
    this.publish({ driveConnection: "local", driveError: "", driveRetryAt: 0, message: "Donnees locales effacees." });
  });

  setMessage = (message: string) => this.publish({ message });
}
