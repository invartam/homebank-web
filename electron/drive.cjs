const { readFile, writeFile, rename, rm } = require("node:fs/promises");
const path = require("node:path");
const { browserAuthorization, validFileId } = require("./oauth.cjs");
const { readLimitedResponse } = require("./http.cjs");

class AuthorizationError extends Error {
  constructor(message, requiresInteraction = true) { super(message); this.kind = "authorization"; this.requiresInteraction = requiresInteraction; }
}
class ApiError extends Error {
  constructor(message, status, retryable = false) { super(message); this.kind = "api"; this.status = status; this.retryable = retryable; }
}
const configured = (config) => typeof config.clientId === "string" && /^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.clientId);

function createDriveService({ config, userData, safeStorage, openExternal, fetchImpl = fetch, authorize = browserAuthorization }) {
  const tokenPath = path.join(userData, "google-drive-token.enc");
  let token, refreshToken, loaded = false, refreshJob, interactiveJob, abort;
  async function encryptedStorage() {
    if (!(await safeStorage.isAsyncEncryptionAvailable()) ||
      (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
      throw new AuthorizationError("Le stockage securise du systeme est indisponible.", false);
    }
  }
  async function loadRefresh() {
    if (loaded) return;
    await encryptedStorage();
    try {
      const decrypted = await safeStorage.decryptStringAsync(await readFile(tokenPath));
      const saved = JSON.parse(decrypted.result);
      if (saved.clientId === config.clientId && typeof saved.refreshToken === "string") refreshToken = saved.refreshToken;
    } catch (error) {
      if (error.code !== "ENOENT") throw new AuthorizationError("Connexion Drive enregistree illisible. Reconnectez Drive.");
    }
    loaded = true;
  }
  async function storeRefresh(value) {
    await encryptedStorage();
    const data = await safeStorage.encryptStringAsync(JSON.stringify({ clientId: config.clientId, refreshToken: value }));
    await writeFile(`${tokenPath}.tmp`, data, { mode: 0o600 });
    await rename(`${tokenPath}.tmp`, tokenPath);
    refreshToken = value;
    loaded = true;
  }
  async function exchange(parameters) {
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), ...parameters }).toString(),
    });
    const data = JSON.parse(await readLimitedResponse(response, 256 * 1024));
    if (!response.ok) {
      if (data.error === "invalid_grant") {
        refreshToken = undefined; token = undefined;
        await rm(tokenPath, { force: true });
      }
      const temporary = response.status === 429 || response.status >= 500;
      throw new AuthorizationError(temporary ? "Google temporairement indisponible." : "Connexion Google expiree ou refusee. Reconnectez Drive.", !temporary);
    }
    if (typeof data.access_token !== "string" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new AuthorizationError("Reponse d'autorisation Google invalide.", false);
    }
    if (parameters.grant_type === "authorization_code" && typeof data.refresh_token !== "string") {
      throw new AuthorizationError("Google n'a pas fourni de connexion persistante. Reconnectez Drive.");
    }
    if (data.refresh_token) await storeRefresh(data.refresh_token);
    token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return token;
  }
  async function interactive(pick) {
    if (interactiveJob) throw new AuthorizationError("Une connexion Google est deja en cours.", false);
    abort = new AbortController();
    const currentAbort = abort;
    interactiveJob = (async () => {
      await encryptedStorage();
      let result;
      try { result = await authorize({ clientId: config.clientId, pick, openExternal, signal: currentAbort.signal }); }
      catch (error) { throw new AuthorizationError(error.message); }
      await exchange({ grant_type: "authorization_code", code: result.code, code_verifier: result.verifier, redirect_uri: result.redirectUri });
      return result.fileId;
    })();
    try { return await interactiveJob; }
    finally { interactiveJob = undefined; abort = undefined; }
  }
  async function access(force = false) {
    if (!configured(config)) throw new AuthorizationError("Configurez le client OAuth Google Electron.", false);
    if (!force && token && token.expiresAt > Date.now() + 60000) return token;
    if (!refreshJob) refreshJob = (async () => {
      await loadRefresh();
      if (!refreshToken) throw new AuthorizationError("Connexion Google requise.");
      return exchange({ grant_type: "refresh_token", refresh_token: refreshToken });
    })().finally(() => { refreshJob = undefined; });
    return refreshJob;
  }
  async function api(fileId, query, { upload = false, body } = {}) {
    if (!validFileId(fileId)) throw new Error("Identifiant Drive invalide.");
    const current = await access();
    const response = await fetchImpl(`https://www.googleapis.com/${upload ? "upload/" : ""}drive/v3/files/${encodeURIComponent(fileId)}?${query}`, {
      method: upload ? "PATCH" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${current.value}`, ...(upload ? { "Content-Type": "application/x-homebank+xml" } : {}) },
      ...(upload ? { body } : {}),
    });
    if (!response.ok) {
      let reasons = [];
      try { reasons = (await response.json()).error?.errors?.map((item) => item.reason) ?? []; } catch { /* Keep the HTTP status for recovery. */ }
      if (response.status === 401) token = undefined;
      throw new ApiError(response.status === 404 ? "Fichier Google Drive introuvable ou inaccessible." : "Operation Google Drive impossible.", response.status,
        response.status === 429 || response.status >= 500 || reasons.some((reason) => ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason)));
    }
    return response;
  }
  async function handle(command, payload) {
    try {
      if (!configured(config)) throw new AuthorizationError("Configurez le client OAuth Google Electron.", false);
      let value;
      if (command === "authorize") {
        if (!["", "consent", "none"].includes(payload)) throw new Error("Demande d'autorisation invalide.");
        try { await access(true); }
        catch (error) {
          if (payload === "none" || !(error instanceof AuthorizationError) || !error.requiresInteraction) throw error;
          await interactive(false);
        }
        value = { expiresAt: token.expiresAt };
      } else if (command === "pick") {
        const fileId = await interactive(true);
        const metadata = JSON.parse(await readLimitedResponse(await api(fileId, "fields=id,name,trashed"), 256 * 1024));
        if (metadata.trashed || metadata.id !== fileId) throw new ApiError("Fichier Google Drive indisponible.", 404);
        if (typeof metadata.name !== "string") throw new Error("Nom du fichier Google Drive absent.");
        value = { file: { id: metadata.id, name: metadata.name }, expiresAt: token.expiresAt };
      } else if (command === "verify") {
        const metadata = JSON.parse(await readLimitedResponse(await api(payload, "fields=id,trashed"), 256 * 1024));
        if (metadata.trashed) throw new ApiError("Le fichier Google Drive est dans la corbeille.", 404);
        if (metadata.id !== payload) throw new Error("Reponse Google Drive invalide.");
      } else if (command === "download") {
        value = await readLimitedResponse(await api(payload, "alt=media"));
      } else if (command === "save") {
        if (!payload || typeof payload.xml !== "string" || Buffer.byteLength(payload.xml) > 32 * 1024 * 1024) throw new Error("Fichier HomeBank invalide ou trop volumineux (32 Mo maximum).");
        await api(payload.fileId, "uploadType=media", { upload: true, body: payload.xml });
      } else throw new Error("Commande Drive inconnue.");
      return { ok: true, value };
    } catch (error) {
      if (!error.kind && ["TypeError", "TimeoutError", "AbortError"].includes(error.name)) {
        error = ["authorize", "pick"].includes(command)
          ? new AuthorizationError("Connexion Google temporairement indisponible.", false)
          : new ApiError("Connexion Drive temporairement indisponible.", 503, true);
      }
      // Electron strips custom Error fields across IPC; return an explicit, non-sensitive envelope.
      return { ok: false, error: { kind: error.kind ?? "generic", message: error.kind ? error.message : "Connexion Drive impossible. Reessayez.",
        status: error.status, retryable: error.retryable, requiresInteraction: error.requiresInteraction } };
    }
  }
  return { handle, cancel: () => abort?.abort() };
}
module.exports = { createDriveService, configured };
