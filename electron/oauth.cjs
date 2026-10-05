const http = require("node:http");
const { randomBytes, createHash } = require("node:crypto");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
function authorizationRequest(clientId, redirectUri, pick = false) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri,
    response_type: "code", scope: DRIVE_SCOPE, access_type: "offline", prompt: "consent",
    state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    ...(pick ? { trigger_onepick: "true", allow_multiple: "false" } : {}),
  }).toString();
  return { url: url.href, state, verifier };
}

// The listener is ephemeral and bound to loopback only. Invalid state never consumes a valid flow.
function browserAuthorization({ clientId, pick, openExternal, signal, timeoutMs = 180000 }) {
  return new Promise((resolve, reject) => {
    let request, origin, settled = false, timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      server.close();
      server.closeAllConnections();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new Error("Connexion Google annulee."));
    const server = http.createServer((req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      if (!origin || req.headers.host !== new URL(origin).host || req.method !== "GET") {
        res.writeHead(403).end(); return;
      }
      let callback;
      try { callback = new URL(req.url, origin); }
      catch { res.writeHead(400).end(); return; }
      if (callback.origin !== origin || callback.pathname !== "/oauth/callback" || callback.searchParams.get("state") !== request.state) {
        res.writeHead(400).end("Reponse Google invalide."); return;
      }
      if (settled) { res.writeHead(410).end(); return; }
      const code = callback.searchParams.get("code");
      const ids = (callback.searchParams.get("picked_file_ids") ?? "").split(",").filter(Boolean);
      const error = callback.searchParams.has("error") ? new Error("Autorisation Google refusee ou annulee.")
        : !code ? new Error("Code Google absent.")
        : pick && (ids.length !== 1 || !validFileId(ids[0])) ? new Error("Aucun fichier Google Drive selectionne.") : undefined;
      res.writeHead(error ? 400 : 200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error ? error.message : "Connexion terminee. Vous pouvez revenir dans HomeBank Web.", () => {
        finish(error, { code, verifier: request.verifier, redirectUri: `${origin}/oauth/callback`, fileId: ids[0] });
      });
    });
    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      if (settled) { server.close(); return; }
      origin = `http://127.0.0.1:${server.address().port}`;
      request = authorizationRequest(clientId, `${origin}/oauth/callback`, pick);
      timer = setTimeout(() => finish(new Error("Connexion Google expiree. Reessayez.")), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      Promise.resolve().then(() => openExternal(request.url)).catch((error) => finish(error));
    });
  });
}

function validFileId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value); }
module.exports = { DRIVE_SCOPE, authorizationRequest, browserAuthorization, validFileId };
