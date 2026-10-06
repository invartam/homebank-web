import Foundation
import UIKit
import Security
import Capacitor
import AppAuth

@objc(HomeBankDrivePlugin)
public class HomeBankDrivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeBankDrivePlugin"
    public let jsName = "HomeBankDrive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfiguration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]
    private var clientId = ""
    private var authState: OIDAuthState?
    private var authorizationFlow: OIDExternalUserAgentSession?
    private var urlObserver: NSObjectProtocol?
    private var keychainError = false
    private let scope = "https://www.googleapis.com/auth/drive.file"
    private let maxBytes = 32 * 1024 * 1024

    public override func load() {
        clientId = getConfig().getString("iosClientId") ?? ""
        guard configured else { return }
        do { authState = try restore() } catch { keychainError = true }
        urlObserver = NotificationCenter.default.addObserver(forName: .capacitorOpenURL, object: nil, queue: .main) { [weak self] notification in
            guard let url = (notification.object as? [String: Any])?["url"] as? URL else { return }
            self?.authorizationFlow?.resumeExternalUserAgentFlow(with: url)
        }
    }
    deinit {
        if let observer = urlObserver { NotificationCenter.default.removeObserver(observer) }
        authorizationFlow?.cancel()
    }
    private var configured: Bool { clientId.range(of: "^[A-Za-z0-9_.-]+\\.apps\\.googleusercontent\\.com$", options: .regularExpression) != nil }
    private func validFileId(_ id: String) -> Bool { id.range(of: "^[A-Za-z0-9_-]{1,200}$", options: .regularExpression) != nil }
    private func success(_ call: CAPPluginCall, _ value: Any = NSNull()) { call.resolve(["ok": true, "value": value]) }
    private func fail(_ call: CAPPluginCall, _ kind: String, _ message: String, status: Int = 0, retryable: Bool = false, interaction: Bool = false) {
        call.resolve(["ok": false, "error": ["kind": kind, "message": message, "status": status, "retryable": retryable, "requiresInteraction": interaction]])
    }
    private func authError(_ call: CAPPluginCall, _ message: String, interaction: Bool = true) { fail(call, "authorization", message, interaction: interaction) }
    private func expiry() -> [String: Any] {
        ["expiresAt": (authState?.lastTokenResponse?.accessTokenExpirationDate ?? Date()).timeIntervalSince1970 * 1000]
    }

    // Each OAuth client has its own device-only Keychain item. No credentials leave this plugin.
    private var keychainQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "\(Bundle.main.bundleIdentifier ?? "homebank").google-drive",
         kSecAttrAccount as String: clientId]
    }
    private func restore() throws -> OIDAuthState? {
        var query = keychainQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw NSError(domain: "HomeBankKeychain", code: Int(status)) }
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: OIDAuthState.self, from: data)
    }
    private func persist(_ state: OIDAuthState) throws {
        let data = try NSKeyedArchiver.archivedData(withRootObject: state, requiringSecureCoding: true)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(keychainQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = keychainQuery
            attributes.forEach { item[$0.key] = $0.value }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw NSError(domain: "HomeBankKeychain", code: Int(added)) }
        } else if status != errSecSuccess { throw NSError(domain: "HomeBankKeychain", code: Int(status)) }
        keychainError = false
    }
    @objc func getConfiguration(_ call: CAPPluginCall) { call.resolve(["configured": configured]) }
    @objc func authorize(_ call: CAPPluginCall) {
        let prompt = call.getString("prompt") ?? "none"
        guard ["", "none", "consent"].contains(prompt) else { authError(call, "Demande Drive invalide.", interaction: false); return }
        DispatchQueue.main.async {
            if let state = self.authState, state.isAuthorized {
                state.setNeedsTokenRefresh()
                self.withAccess(call, interactive: prompt != "none") { _ in self.success(call, self.expiry()) }
            } else if prompt != "none" { self.connect(call, pick: false) }
            else { self.authError(call, "Connexion Google requise.") }
        }
    }
    @objc func pick(_ call: CAPPluginCall) { DispatchQueue.main.async { self.connect(call, pick: true) } }
    private func connect(_ call: CAPPluginCall, pick: Bool) {
        guard configured, let controller = bridge?.viewController else { authError(call, "Configuration Google iOS manquante.", interaction: false); return }
        guard authorizationFlow == nil else { authError(call, "Une connexion Google est deja en cours.", interaction: false); return }
        let scheme = clientId.split(separator: ".").reversed().joined(separator: ".")
        let configuration = OIDServiceConfiguration(authorizationEndpoint: URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!, tokenEndpoint: URL(string: "https://oauth2.googleapis.com/token")!)
        var parameters = ["access_type": "offline", "prompt": "consent"]
        if pick { parameters["trigger_onepick"] = "true"; parameters["allow_multiple"] = "false" }
        let request = OIDAuthorizationRequest(configuration: configuration, clientId: clientId, scopes: [scope],
            redirectURL: URL(string: "\(scheme):/oauth2redirect")!, responseType: OIDResponseTypeCode, additionalParameters: parameters)
        authorizationFlow = OIDAuthState.authState(byPresenting: request, presenting: controller) { [weak self] state, error in
            guard let self = self else { return }
            self.authorizationFlow = nil
            guard let state = state, state.isAuthorized, state.refreshToken != nil else {
                self.authError(call, "Connexion Google annulee, refusee ou sans autorisation persistante."); return
            }
            var selected: String?
            if pick {
                selected = state.lastAuthorizationResponse.additionalParameters?["picked_file_ids"] as? String
                guard let id = selected, self.validFileId(id) else { self.authError(call, "Aucun fichier Google Drive selectionne."); return }
            }
            do { try self.persist(state) }
            catch { self.authError(call, "Le stockage securise iOS est indisponible.", interaction: false); return }
            self.authState = state
            if let id = selected {
                self.withAccess(call) { token in
                    self.request(call, fileId: id, query: "fields=id,name,trashed", token: token) { data in
                        guard let metadata = self.metadata(data), metadata["id"] as? String == id, metadata["trashed"] as? Bool != true,
                              let name = metadata["name"] as? String else { self.fail(call, "api", "Fichier Drive indisponible.", status: 404); return }
                        var value = self.expiry(); value["file"] = ["id": id, "name": name]; self.success(call, value)
                    }
                }
            } else { self.success(call, self.expiry()) }
        }
    }
    private func withAccess(_ call: CAPPluginCall, interactive: Bool = false, action: @escaping (String) -> Void) {
        guard let state = authState, state.isAuthorized else {
            if interactive { connect(call, pick: false) }
            else { authError(call, keychainError ? "Connexion Drive enregistree illisible. Reconnectez Drive." : "Connexion Google requise.") }
            return
        }
        state.performAction { accessToken, _, error in
            guard let token = accessToken, error == nil else {
                if !state.isAuthorized {
                    self.authState = nil
                    SecItemDelete(self.keychainQuery as CFDictionary)
                    if interactive { self.connect(call, pick: false) }
                    else { self.authError(call, "Connexion Google expiree. Reconnectez Drive.") }
                } else { self.authError(call, "Connexion Google temporairement indisponible.", interaction: false) }
                return
            }
            do { try self.persist(state) }
            catch { self.authError(call, "Le stockage securise iOS est indisponible.", interaction: false); return }
            action(token)
        }
    }
    @objc func verify(_ call: CAPPluginCall) { operation(call, query: "fields=id,trashed") { data, id in
        guard let metadata = self.metadata(data) else { self.fail(call, "generic", "Reponse Drive invalide."); return }
        if metadata["trashed"] as? Bool == true || metadata["id"] as? String != id { self.fail(call, "api", "Fichier Drive introuvable ou dans la corbeille.", status: 404) }
        else { self.success(call) }
    } }
    @objc func download(_ call: CAPPluginCall) { operation(call, query: "alt=media") { data, _ in
        guard let xml = String(data: data, encoding: .utf8) else { self.fail(call, "generic", "Fichier Drive illisible."); return }
        self.success(call, xml)
    } }
    @objc func save(_ call: CAPPluginCall) {
        guard let xml = call.getString("xml"), xml.utf8.count <= maxBytes else { fail(call, "generic", "Fichier HomeBank invalide ou trop volumineux."); return }
        operation(call, query: "uploadType=media", xml: xml) { _, _ in self.success(call) }
    }
    private func metadata(_ data: Data) -> [String: Any]? { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
    private func operation(_ call: CAPPluginCall, query: String, xml: String? = nil, completion: @escaping (Data, String) -> Void) {
        guard let id = call.getString("fileId"), validFileId(id) else { fail(call, "generic", "Identifiant Drive invalide."); return }
        DispatchQueue.main.async { self.withAccess(call) { token in
            self.request(call, fileId: id, query: query, token: token, xml: xml) { data in completion(data, id) }
        } }
    }
    private func request(_ call: CAPPluginCall, fileId: String, query: String, token: String, xml: String? = nil, completion: @escaping (Data) -> Void) {
        let prefix = xml == nil ? "" : "upload/"
        var request = URLRequest(url: URL(string: "https://www.googleapis.com/\(prefix)drive/v3/files/\(fileId)?\(query)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let xml = xml { request.httpMethod = "PATCH"; request.httpBody = Data(xml.utf8); request.setValue("application/x-homebank+xml", forHTTPHeaderField: "Content-Type") }
        let transfer = BoundedDriveRequest(maxBytes: maxBytes) { data, response, error in
            DispatchQueue.main.async {
                if (error as NSError?)?.code == NSURLErrorDataLengthExceedsMaximum {
                    self.fail(call, "api", "Fichier Drive trop volumineux (32 Mo maximum).", status: 413); return
                }
                guard error == nil, let response = response as? HTTPURLResponse, let data = data else { self.fail(call, "api", "Connexion Drive temporairement indisponible.", status: 503, retryable: true); return }
                let status = response.statusCode
                guard (200..<300).contains(status) else {
                    if status == 401 { self.authState?.setNeedsTokenRefresh() }
                    let errors = (self.metadata(data)?["error"] as? [String: Any])?["errors"] as? [[String: Any]] ?? []
                    let rateLimited = errors.contains { ["rateLimitExceeded", "userRateLimitExceeded"].contains($0["reason"] as? String ?? "") }
                    self.fail(call, "api", status == 404 ? "Fichier Drive introuvable ou inaccessible." : "Operation Drive impossible.", status: status, retryable: status == 429 || status >= 500 || rateLimited); return
                }
                guard data.count <= self.maxBytes else { self.fail(call, "generic", "Fichier Drive trop volumineux (32 Mo maximum)."); return }
                completion(data)
            }
        }
        transfer.start(request)
    }
}
