package io.homebank.drive;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

@CapacitorPlugin(name = "HomeBankDrive")
public class HomeBankDrivePlugin extends Plugin {
    private static final String SCOPE = "https://www.googleapis.com/auth/drive.file";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private String clientId;
    private volatile String token;
    private volatile long expiresAt;
    private PluginCall interactiveCall;
    private ActivityResultLauncher<IntentSenderRequest> authorizationLauncher;

    @Override public void load() {
        authorizationLauncher = bridge.registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::authorizationResult);
        boolean debug = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        clientId = getConfig().getString(debug ? "androidDebugClientId" : "androidClientId", "");
        preferences = getContext().getSharedPreferences("homebank-drive", Context.MODE_PRIVATE);
        if (!clientId.equals(preferences.getString("clientId", ""))) preferences.edit().clear().commit();
    }
    private boolean configured() { return clientId.matches("[A-Za-z0-9_.-]+\\.apps\\.googleusercontent\\.com"); }
    private static boolean fileId(String value) { return value != null && value.matches("[A-Za-z0-9_-]{1,200}"); }
    private void success(PluginCall call, Object value) {
        JSObject result = new JSObject(); result.put("ok", true); result.put("value", value == null ? JSONObject.NULL : value); call.resolve(result);
    }
    private void fail(PluginCall call, String kind, String message, int status, boolean retryable, boolean interaction) {
        JSObject error = new JSObject(); error.put("kind", kind); error.put("message", message);
        error.put("status", status); error.put("retryable", retryable); error.put("requiresInteraction", interaction);
        JSObject result = new JSObject(); result.put("ok", false); result.put("error", error); call.resolve(result);
    }
    private void authError(PluginCall call, String message, boolean interaction) { fail(call, "authorization", message, 0, !interaction, interaction); }
    private JSObject expiry() { JSObject value = new JSObject(); value.put("expiresAt", expiresAt); return value; }

    @PluginMethod public void getConfiguration(PluginCall call) { call.resolve(new JSObject().put("configured", configured())); }
    @PluginMethod public void authorize(PluginCall call) {
        String prompt = call.getString("prompt", "none");
        if (!prompt.equals("") && !prompt.equals("none") && !prompt.equals("consent")) { authError(call, "Demande Drive invalide.", false); return; }
        // Force renewal after a Drive 401, but never present consent during automatic restoration.
        worker.execute(() -> {
            try { if (token != null) GoogleAuthUtil.clearToken(getContext(), token); }
            catch (Exception ignored) { /* AuthorizationClient handles expired cached grants. */ }
            token = null;
            getActivity().runOnUiThread(() -> authorizeNative(call, !prompt.equals("none"), false, value -> success(call, expiry())));
        });
    }
    @PluginMethod public void pick(PluginCall call) { getActivity().runOnUiThread(() -> authorizeNative(call, true, true, value -> picked(call, value))); }

    private void authorizeNative(PluginCall call, boolean interactive, boolean pick, Consumer<AuthorizationResult> completion) {
        if (!configured()) { authError(call, "Configuration Google Android manquante.", false); return; }
        if (interactiveCall != null) { authError(call, "Une connexion Google est deja en cours.", false); return; }
        String account = preferences.getString("account", "");
        if (!interactive && account.isEmpty()) { authError(call, "Connexion Google requise.", true); return; }
        AuthorizationRequest.Builder request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).setOptOutIncludingGrantedScopes(true);
        if (!account.isEmpty()) request.setAccount(new Account(account, "com.google"));
        if (pick) request.setPrompt(AuthorizationRequest.Prompt.CONSENT)
            .addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_OAUTH_TRIGGER, "true")
            .addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_MULTIPLE, "false");
        Identity.getAuthorizationClient(getActivity()).authorize(request.build()).addOnSuccessListener(result -> {
            if (result.hasResolution()) {
                if (!interactive) { authError(call, "Google demande une reconnexion.", true); return; }
                interactiveCall = call;
                try { authorizationLauncher.launch(new IntentSenderRequest.Builder(result.getPendingIntent()).build()); }
                catch (Exception error) { interactiveCall = null; authError(call, "Connexion Google impossible.", true); }
            } else accept(call, result, completion);
        }).addOnFailureListener(error -> authorizationFailure(call, error));
    }
    private void authorizationResult(ActivityResult activity) {
        PluginCall call = interactiveCall;
        interactiveCall = null;
        if (call == null) return;
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(activity.getData());
            boolean pick = call.getMethodName().equals("pick");
            accept(call, result, value -> { if (pick) picked(call, value); else success(call, expiry()); });
        } catch (Exception error) { authorizationFailure(call, error); }
    }
    private void authorizationFailure(PluginCall call, Exception error) {
        boolean temporary = error instanceof ApiException && (((ApiException) error).getStatusCode() == CommonStatusCodes.NETWORK_ERROR || ((ApiException) error).getStatusCode() == CommonStatusCodes.INTERNAL_ERROR);
        authError(call, temporary ? "Connexion Google temporairement indisponible." : "Connexion Google annulee ou refusee.", !temporary);
    }
    @SuppressWarnings("deprecation")
    private void accept(PluginCall call, AuthorizationResult result, Consumer<AuthorizationResult> completion) {
        String access = result.getAccessToken();
        Account account = result.toGoogleSignInAccount() == null ? null : result.toGoogleSignInAccount().getAccount();
        if (access == null || account == null || !result.getGrantedScopes().contains(SCOPE)) { authError(call, "Autorisation Drive incomplete.", true); return; }
        // Only account identity is persisted here. Google Play services owns the authorization credentials.
        if (!preferences.edit().putString("account", account.name).putString("clientId", clientId).commit()) { authError(call, "Impossible de memoriser la connexion Google.", false); return; }
        token = access; expiresAt = System.currentTimeMillis() + 3000000;
        completion.accept(result);
    }
    private void picked(PluginCall call, AuthorizationResult result) {
        String ids = result.getTokenResponseParams() == null ? "" : result.getTokenResponseParams().getString("picked_file_ids", "");
        if (!fileId(ids)) { authError(call, "Aucun fichier Google Drive selectionne.", true); return; }
        request(call, ids, "fields=id,name,trashed", null, response -> {
            if (response.optBoolean("trashed") || !ids.equals(response.optString("id"))) { fail(call, "api", "Fichier Drive indisponible.", 404, false, false); return; }
            JSObject file = new JSObject(); file.put("id", ids); file.put("name", response.optString("name", "homebank.xhb"));
            JSObject value = expiry(); value.put("file", file); success(call, value);
        });
    }
    @PluginMethod public void verify(PluginCall call) {
        String id = call.getString("fileId");
        withAccess(call, () -> request(call, id, "fields=id,trashed", null, response -> {
            if (response.optBoolean("trashed") || !id.equals(response.optString("id"))) fail(call, "api", "Fichier Drive introuvable ou dans la corbeille.", 404, false, false);
            else success(call, null);
        }));
    }
    @PluginMethod public void download(PluginCall call) { withAccess(call, () -> request(call, call.getString("fileId"), "alt=media", null, null)); }
    @PluginMethod public void save(PluginCall call) {
        String xml = call.getString("xml");
        if (xml == null || xml.getBytes(StandardCharsets.UTF_8).length > 32 * 1024 * 1024) { fail(call, "generic", "Fichier HomeBank invalide ou trop volumineux.", 0, false, false); return; }
        withAccess(call, () -> request(call, call.getString("fileId"), "uploadType=media", xml, response -> success(call, null)));
    }
    private void withAccess(PluginCall call, Runnable action) {
        if (!fileId(call.getString("fileId"))) { fail(call, "generic", "Identifiant Drive invalide.", 0, false, false); return; }
        getActivity().runOnUiThread(() -> {
            if (token != null && System.currentTimeMillis() < expiresAt - 60000) action.run();
            else authorizeNative(call, false, false, result -> action.run());
        });
    }
    private void request(PluginCall call, String id, String query, String xml, Consumer<JSONObject> completion) {
        if (!fileId(id)) { fail(call, "generic", "Identifiant Drive invalide.", 0, false, false); return; }
        String access = token;
        worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) URI.create("https://www.googleapis.com/" + (xml == null ? "" : "upload/") + "drive/v3/files/" + id + "?" + query).toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(30000); connection.setReadTimeout(30000);
                connection.setUseCaches(false); connection.setRequestProperty("Authorization", "Bearer " + access);
                if (xml != null) {
                    connection.setRequestMethod("PATCH"); connection.setRequestProperty("Content-Type", "application/x-homebank+xml"); connection.setDoOutput(true);
                    try (var output = connection.getOutputStream()) { output.write(xml.getBytes(StandardCharsets.UTF_8)); }
                }
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
                String text;
                try (InputStream input = stream; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                    if (input != null) {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.read(buffer)) != -1) {
                            bytes.write(buffer, 0, count);
                            if (bytes.size() > 32 * 1024 * 1024) { fail(call, "generic", "Fichier Drive trop volumineux (32 Mo maximum).", 0, false, false); return; }
                        }
                    }
                    text = bytes.toString(StandardCharsets.UTF_8.name());
                }
                if (status < 200 || status >= 300) {
                    if (status == 401) { expiresAt = 0; }
                    boolean retryable = status == 429 || status >= 500;
                    try {
                        var errors = new JSONObject(text).getJSONObject("error").optJSONArray("errors");
                        if (errors != null) for (int i = 0; i < errors.length(); i++) {
                            String reason = errors.getJSONObject(i).optString("reason");
                            if (reason.equals("rateLimitExceeded") || reason.equals("userRateLimitExceeded")) retryable = true;
                        }
                    } catch (Exception ignored) { /* Retain the HTTP classification. */ }
                    fail(call, "api", status == 404 ? "Fichier Drive introuvable ou inaccessible." : "Operation Drive impossible.", status, retryable, false); return;
                }
                if (text.getBytes(StandardCharsets.UTF_8).length > 32 * 1024 * 1024) { fail(call, "generic", "Fichier Drive trop volumineux (32 Mo maximum).", 0, false, false); return; }
                if (completion == null) success(call, text); else completion.accept(text.isEmpty() ? new JSONObject() : new JSONObject(text));
            } catch (Exception error) { fail(call, "api", "Connexion Drive temporairement indisponible.", 503, true, false); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
