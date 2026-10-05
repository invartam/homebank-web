import { serializeHomeBankXml, type Wallet } from "./homebank";
import { electronDrive, type DesktopDriveResult } from "./electronDrive";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const XHB_MIME_TYPE = "application/x-homebank+xml";
let issuedToken: { value: string; expiresAt: number } | undefined;

export class DriveAuthorizationError extends Error {
  constructor(message: string, public requiresInteraction = true) { super(message); }
}

export class DriveApiError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) { super(message); }
}

export class DriveFileUnavailableError extends DriveApiError {
  constructor(message = "Fichier Google Drive introuvable ou inaccessible.") { super(message, 404, false); }
}

export const driveAccessTokenExpiresAt = (token: string) => issuedToken?.value === token ? issuedToken.expiresAt : undefined;

declare global {
  interface Window {
    gapi?: { load: (module: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }) => void };
    google?: {
      accounts?: { oauth2?: { initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
        error_callback: (error: { type: string }) => void;
      }) => { requestAccessToken: (options: { prompt: string }) => void } } };
      picker?: {
        PickerBuilder: new () => PickerBuilder;
        DocsView: new (id: string) => PickerView;
        ViewId: { DOCS: string };
        Action: { CANCEL: string; PICKED: string };
        Document: { NAME: string };
      };
    };
  }
}

interface PickerView {
  setIncludeFolders: (value: boolean) => PickerView;
  setSelectFolderEnabled: (value: boolean) => PickerView;
}

interface PickerData {
  action: string;
  docs?: Array<{ id?: string; name?: string; [key: string]: unknown }>;
}

interface PickerBuilder {
  setOAuthToken: (value: string) => PickerBuilder;
  setDeveloperKey: (value: string) => PickerBuilder;
  setAppId: (value: string) => PickerBuilder;
  setTitle: (value: string) => PickerBuilder;
  addView: (view: PickerView) => PickerBuilder;
  setCallback: (callback: (data: PickerData) => void) => PickerBuilder;
  build: () => { setVisible: (value: boolean) => void };
}

export interface DriveFileRef {
  id: string;
  name: string;
}

export const googleDriveConfigured = () =>
  electronDrive()?.configured ?? (!import.meta.env.VITE_NATIVE_APP && Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_API_KEY));

const DESKTOP_SESSION = "electron-drive-session";
async function desktopResult<T>(result: Promise<DesktopDriveResult<T>>): Promise<T> {
  const response = await result;
  if (response.ok) return response.value;
  const error = response.error;
  if (error.kind === "authorization") throw new DriveAuthorizationError(error.message, error.requiresInteraction);
  if (error.kind === "api") {
    if (error.status === 404) throw new DriveFileUnavailableError(error.message);
    throw new DriveApiError(error.message, error.status ?? 500, error.retryable ?? false);
  }
  throw new Error(error.message);
}
function rememberDesktopSession(expiresAt: number) {
  issuedToken = { value: DESKTOP_SESSION, expiresAt };
  return DESKTOP_SESSION;
}

const googleClientId = () => import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const googleApiKey = () => import.meta.env.VITE_GOOGLE_API_KEY as string;
const googleAppId = () =>
  (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) ?? googleClientId().split("-")[0];

const loadGapiPicker = () =>
  new Promise<void>((resolve, reject) => {
    if (!window.gapi) {
      reject(new Error("La bibliotheque Google API n'est pas chargee."));
      return;
    }

    window.gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Impossible de charger Google Picker.")),
      timeout: 10000,
      ontimeout: () => reject(new Error("Chargement Google Picker trop long.")),
    });
  });

const waitForGoogleIdentity = () =>
  new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.oauth2) {
        window.clearInterval(timer);
        resolve();
        return;
      }

      if (attempts > 100) {
        window.clearInterval(timer);
        reject(new DriveAuthorizationError("La bibliotheque Google Identity Services n'est pas chargee.", false));
      }
    }, 100);
  });

export const requestDriveAccessToken = (prompt: "" | "consent" | "none" = "") =>
  new Promise<string>((resolve, reject) => {
    const desktop = electronDrive();
    if (desktop) {
      desktopResult(desktop.authorize(prompt)).then(({ expiresAt }) => resolve(rememberDesktopSession(expiresAt)), reject);
      return;
    }
    if (!googleDriveConfigured()) {
      reject(new Error("Configure VITE_GOOGLE_CLIENT_ID et VITE_GOOGLE_API_KEY pour activer Google Drive."));
      return;
    }

    waitForGoogleIdentity()
      .then(() => {
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        };
        const timer = window.setTimeout(() => fail(new DriveAuthorizationError("Autorisation Google Drive expiree. Reconnecte Drive.")), prompt === "none" ? 10000 : 60000);
        try {
          const client = window.google!.accounts!.oauth2!.initTokenClient({
            client_id: googleClientId(),
            scope: DRIVE_SCOPE,
            callback: (response) => {
              if (settled) return;
              window.clearTimeout(timer);
              if (response.error || !response.access_token) {
                fail(new DriveAuthorizationError(response.error ?? "Autorisation Google Drive refusee."));
                return;
              }
              settled = true;
              const lifetime = Number(response.expires_in);
              issuedToken = { value: response.access_token, expiresAt: Date.now() + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000 };
              resolve(response.access_token);
            },
            error_callback: (error) => {
              fail(new DriveAuthorizationError(error.type === "popup_closed" ? "Connexion Google annulee." : "Impossible d'ouvrir la connexion Google."));
            },
          });

          client.requestAccessToken({ prompt });
        } catch (error) {
          fail(new DriveAuthorizationError(error instanceof Error ? error.message : "Connexion Google impossible."));
        }
      })
      .catch(reject);
  });

export const pickDriveHomeBankFile = async (): Promise<{ file: DriveFileRef; accessToken: string }> => {
  const desktop = electronDrive();
  if (desktop) {
    const result = await desktopResult(desktop.pick());
    return { file: result.file, accessToken: rememberDesktopSession(result.expiresAt) };
  }
  const accessToken = await requestDriveAccessToken("consent");
  await loadGapiPicker();

  return new Promise((resolve, reject) => {
    const api = window.google!.picker!;
    const picker = new api.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(googleApiKey())
      .setAppId(googleAppId())
      .setTitle("Selectionner un fichier HomeBank")
      .addView(
        new api.DocsView(api.ViewId.DOCS)
          .setIncludeFolders(true)
          .setSelectFolderEnabled(false),
      )
      .setCallback((data) => {
        if (data.action === api.Action.CANCEL) {
          reject(new Error("Selection Google Drive annulee."));
          return;
        }

        if (data.action !== api.Action.PICKED) {
          return;
        }

        const doc = data.docs?.[0];
        if (!doc?.id) {
          reject(new Error("Aucun fichier Drive selectionne."));
          return;
        }

        resolve({
          accessToken,
          file: {
            id: doc.id,
            name: doc.name ?? String(doc[api.Document.NAME] ?? "homebank.xhb"),
          },
        });
      })
      .build();

    picker.setVisible(true);
  });
};

export const verifyDriveFile = async (file: DriveFileRef, accessToken: string): Promise<void> => {
  const desktop = electronDrive();
  if (desktop) return desktopResult(desktop.verify(file.id));
  const query = new URLSearchParams({ fields: "id,trashed" });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?${query}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw await driveResponseError(response, "Impossible de verifier le fichier Google Drive.");
  const metadata = await response.json() as { id?: string; trashed?: boolean };
  if (metadata.trashed === true) throw new DriveFileUnavailableError("Le fichier Google Drive est dans la corbeille.");
  if (metadata.id !== file.id) throw new Error("Reponse Google Drive invalide lors de la verification du fichier.");
};

export const downloadDriveFile = async (fileId: string, accessToken: string) => {
  const desktop = electronDrive();
  if (desktop) return desktopResult(desktop.download(fileId));
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw await driveResponseError(response, "Impossible de lire le fichier Google Drive.");
  }

  return response.text();
};

export const saveWalletToDrive = async (wallet: Wallet, file: DriveFileRef, accessToken: string) => {
  const desktop = electronDrive();
  if (desktop) return desktopResult(desktop.save(file.id, serializeHomeBankXml(wallet)));
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`,
    {
      method: "PATCH",
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": XHB_MIME_TYPE,
      },
      body: serializeHomeBankXml(wallet),
    },
  );

  if (!response.ok) {
    throw await driveResponseError(response, "Impossible de sauvegarder le fichier Google Drive.");
  }
};

async function driveResponseError(response: Response, message: string) {
  if (response.status === 404) return new DriveFileUnavailableError();
  let rateLimited = false;
  try {
    const body = await response.json() as { error?: { errors?: Array<{ reason?: string }> } };
    rateLimited = body.error?.errors?.some((error) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(error.reason ?? "")) ?? false;
  } catch {
    // A non-JSON response must retain its HTTP status for recovery decisions.
  }
  return new DriveApiError(message, response.status, response.status === 429 || response.status >= 500 || rateLimited);
}
