# Packaging et releases

La meme interface React est embarquee dans **Electron pour macOS/Windows** et **Capacitor pour iOS/Android**. Electron ne produit pas d'applications iOS ou Android. Aucun serveur web n'est necessaire une fois l'application installee.

## Limites importantes

- La version web garde son integration Google Drive. **Electron prend aussi en charge Drive**, via le navigateur systeme et un client OAuth de type Desktop distinct (configuration ci-dessous). Les builds iOS/Android desactivent encore Drive : leur flux OAuth natif reste a implementer, sans connexion Google dans une WebView embarquee.
- Les versions natives permettent l'import local `.xhb`, la consultation, la saisie et la sauvegarde locale. Sur mobile, l'export ouvre le partage systeme pour enregistrer dans Fichiers ou choisir une application destinataire. Le fichier temporaire reste dans le cache prive pour permettre sa lecture par le destinataire ; ce cache n'est pas chiffre par l'application et peut etre purge par l'OS.
- Les portefeuilles du navigateur, d'Electron et des applications mobiles sont independants. Exporter/importer un `.xhb` pour transferer les donnees.
- iOS est prepare pour la distribution **Ad Hoc**, pas pour TestFlight. L'IPA ne s'installe que sur les appareils dont les UDID figurent dans le profil Apple. Le ZIP simulateur n'est pas installable sur iPhone.
- Les builds desktop sans certificats sont non signes/non notarises : SmartScreen ou Gatekeeper peuvent les bloquer. Configurer les signatures avant une distribution publique, sans desactiver globalement les protections de l'OS.
- La pipeline publie les packages dans GitHub Releases, pas sur les stores, et n'implemente pas de mise a jour automatique.

References : [plateformes Electron](https://www.electronjs.org/docs/latest/), [Capacitor](https://capacitorjs.com/docs), [regles OAuth Google](https://developers.google.com/identity/protocols/oauth2/policies), [distribution de test Apple](https://developer.apple.com/documentation/xcode/testing-a-release-build).

## Google Drive dans Electron

1. Utiliser le meme projet Google Cloud que pour le web. Activer **Google Drive API** et **Google Picker API**. Conserver le scope limite `https://www.googleapis.com/auth/drive.file` et ajouter votre compte aux utilisateurs de test si le consentement est en mode Testing.
2. Dans **Google Auth platform > Clients**, creer un client de type **Desktop app / Application de bureau**. Ne pas reutiliser le CLIENT_ID de type Web. Le retour OAuth utilise `http://127.0.0.1:<port-aleatoire>/oauth/callback` ; un client Desktop accepte ce retour loopback sans URL web de production.
3. Creer `electron-drive.local.json` a la racine du projet, avec seulement les deux valeurs du client Desktop :

```json
{
  "clientId": "VOTRE_CLIENT_DESKTOP.apps.googleusercontent.com",
  "clientSecret": "VALEUR_CLIENT_SECRET_DESKTOP_SI_FOURNIE"
}
```

Le fichier est ignore par Git. Le champ `clientSecret` peut etre vide si votre client Desktop ne l'exige pas. Cette valeur d'un client natif public est embarquee dans le package et n'est pas un secret confidentiel comme celui d'un serveur web : ne jamais mettre ici un secret de client Web, un compte de service ou un jeton utilisateur. Aucune `API_KEY` n'est requise pour ce Picker natif.

4. Lancer `npm run desktop:start` ou reconstruire le package. Dans **Fichier > Ouvrir Drive**, Google puis le Picker s'ouvrent dans le navigateur par defaut. Choisir le `.xhb`, puis revenir dans Electron. L'import, la verification du fichier et les sauvegardes automatiques reutilisent la synchronisation existante.
5. Pour GitHub Actions, definir la **variable Actions** `ELECTRON_GOOGLE_CLIENT_ID` et le **secret Actions** `ELECTRON_GOOGLE_CLIENT_SECRET` (optionnel selon le client). Ces variables peuvent aussi etre exportees en local et prennent precedence sur le fichier JSON. Sans client configure, le bouton Drive reste desactive.

L'authentification utilise PKCE, un `state` aleatoire et un listener local temporaire. Les jetons d'acces/renouvellement ne sont jamais transmis au renderer React ni stockes dans IndexedDB. Le jeton de renouvellement est chiffre par `safeStorage` dans `google-drive-token.enc`, dans le dossier de donnees utilisateur Electron, pour restaurer Drive au redemarrage sans rouvrir le navigateur. Si le stockage securise est indisponible, la connexion echoue sans sauvegarde en clair. Les fichiers restent caches localement selon le fonctionnement du MVP ; ce portefeuille local n'est pas chiffre par cette fonctionnalite.

Un consentement revoque ou expire exige une nouvelle connexion. En mode Testing Google, les refresh tokens peuvent expirer apres sept jours. Sur macOS, conserver une signature de distribution stable pour eviter les demandes de permission du Trousseau a chaque mise a jour. Pour retirer l'autorisation, utiliser la page des connexions tierces du compte Google ; le jeton local invalide est supprime lors de la prochaine tentative de renouvellement. Fermer la fenetre annule un flux de connexion en cours ; un onglet du navigateur ferme sans retour Google est detecte par expiration apres trois minutes.

References : [OAuth Desktop et PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Picker natif dans le navigateur systeme](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker), [stockage Electron et garanties par OS](https://www.electronjs.org/docs/latest/api/safe-storage).

## Prerequis

1. Node **22.22.2+** ou **24.15.0+**, Node 24 pour reproduire la CI, puis `npm ci`.
2. Modifier `packaging.config.json` : `appId` est un identifiant reverse-DNS que vous controlez. Remplacer la valeur d'exemple avant de creer les profils Apple. `productName` est le nom de l'application.
3. macOS/iOS : un Mac ; pour iOS, **Xcode 26+** complet et selectionne, pas seulement les Command Line Tools.
4. Android : Android Studio compatible Capacitor 8, JDK **21**, SDK **36**, Build Tools **36.0.0**, et les variables `JAVA_HOME` / `ANDROID_HOME`.

`public/icon.svg` genere les icones. Les dependances et templates sont verrouilles dans `package-lock.json`.

`native/`, `.packaging/`, `dist-native/` et `release/` sont generes et ignores par Git. Ne pas y laisser de personnalisations indispensables sans les versionner explicitement. Si `appId` change, sauvegarder les personnalisations puis regenerer les dossiers `native/ios` et `native/android` : `cap sync` seul ne renomme pas les identifiants natifs. Un garde-fou empeche d'utiliser un projet genere pour un ancien identifiant.

## Builds locaux

Executer depuis la racine du depot `homebank-web`. Sur Windows, utiliser npm sans installer Make. Les packages macOS exigent macOS ; les packages Windows exigent Windows. La CI utilise les OS correspondants.

| Cible | npm | Make |
| --- | --- | --- |
| Web | `npm run build` | `make web` |
| Interface native | `npm run build:native` | `make native` |
| Electron local | `npm run desktop:start` | |
| Electron non installe | `npm run desktop:dir -- arm64` | `make desktop ARCH=arm64` |
| macOS Apple Silicon | `npm run desktop:mac -- arm64` | `make mac ARCH=arm64` |
| macOS Intel | `npm run desktop:mac -- x64` | `make mac ARCH=x64` |
| Windows x64 | `npm run desktop:windows -- x64` | `make windows ARCH=x64` |
| Android APK debug | `npm run android:debug` | `make android` |
| Android APK/AAB signes | `npm run android:release` | `make android-release` |
| iOS simulateur | `npm run ios:simulator` | `make ios` |
| iOS IPA Ad Hoc | `npm run ios:adhoc` | `make ios-adhoc` |
| Projets Android/iOS | `npm run native:sync:android` / `native:sync:ios` | `make sync-android` / `sync-ios` |

Les commandes reconstruisent l'interface. Les packages sont dans `release/desktop`, `release/android` et `release/ios`. Les sorties desktop sont DMG/ZIP macOS et NSIS/ZIP Windows. L'AAB est destine a un store ; l'APK est installable directement.

L'APK debug utilise un identifiant suffixe `.debug` et un stockage separe : il peut coexister avec l'application de distribution sans remplacer ses donnees.

Test Electron : `npm run build:native`, puis `npm run desktop:smoke`. Une fenetre est ouverte avec un profil temporaire et des donnees fictives, l'import/restauration et l'isolation sont verifies, puis elle est fermee.

## Signature Android

Creer une cle de distribution et en conserver une sauvegarde securisee. Une mise a jour de l'application doit utiliser la meme cle.

```sh
keytool -genkeypair -v -keystore homebank-release.jks -alias homebank -keyalg RSA -keysize 2048 -validity 10000
```

Avant `npm run android:release`, definir `ANDROID_KEYSTORE_PATH` (chemin absolu), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD`. Ne pas mettre les mots de passe dans les arguments de Make ni dans Git. Une release echoue si la signature est incomplete ; elle ne produit pas silencieusement un APK debug.

## Signature iOS Ad Hoc

1. Dans Apple Developer, enregistrer un App ID identique a `packaging.config.json` et les UDID des appareils autorises.
2. Creer un certificat **Apple Distribution** avec sa cle privee, puis l'exporter depuis le Trousseau en `.p12` protege par mot de passe.
3. Creer un profil **Ad Hoc** associant cet App ID, ce certificat et ces appareils. Telecharger le `.mobileprovision`.
4. En local, installer le certificat dans le Trousseau, definir `IOS_TEAM_ID` et `IOS_PROFILE_PATH` (chemin absolu du profil), puis executer `npm run ios:adhoc`.

Le script valide l'equipe, l'App ID, l'expiration, les appareils et l'absence du droit de debug. Il archive en Release puis exporte Ad Hoc (`release-testing` dans Xcode recent). Les profils App Store, Enterprise ou Development sont refuses.

Recuperer l'IPA puis utiliser Apple Configurator ou les outils de gestion d'appareils Xcode pour l'installer sur un appareil autorise. Un lien GitHub seul n'effectue pas une installation OTA iOS ; l'hebergement d'un manifeste OTA n'est pas fourni.

## Signature desktop

Electron-builder utilise `CSC_LINK` (certificat `.p12`/`.pfx`, chemin ou contenu base64) et `CSC_KEY_PASSWORD`. macOS exige un certificat **Developer ID Application**, distinct du certificat iOS Apple Distribution.

Pour notariser macOS, definir aussi `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` et `APPLE_TEAM_ID`. Sans certificat explicitement configure, les scripts ne recherchent pas automatiquement une identite dans le Trousseau local. Les packages sont alors sans signature de distribution.

## Secrets GitHub

Ouvrir **Settings > Secrets and variables > Actions** dans le depot. Encoder en base64 les certificats, profils et keystores, pas les mots de passe.

| Secret | Contenu |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Keystore de distribution Android |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | Alias Android |
| `ANDROID_KEY_PASSWORD` | Mot de passe de la cle |
| `IOS_CERTIFICATE_BASE64` | `.p12` Apple Distribution avec cle privee |
| `IOS_CERTIFICATE_PASSWORD` | Mot de passe du `.p12` |
| `IOS_PROFILE_BASE64` | Profil Ad Hoc `.mobileprovision` |
| `IOS_TEAM_ID` | Identifiant de l'equipe Apple |
| `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` | Certificat/mot de passe desktop macOS |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Certificat/mot de passe desktop Windows |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | Notarisation macOS |

Sur macOS, `base64 -i certificat.p12 | pbcopy` prepare la valeur sans creer de fichier dans le depot. Ne jamais coller les secrets dans un fichier suivi ou un ticket. Les fichiers temporaires de signature sont supprimes par les etapes `always()` et exclus des artefacts. `GITHUB_TOKEN` fourni par Actions suffit pour publier, sans PAT.

**Les secrets Android et iOS sont obligatoires pour une release sur tag.** S'ils manquent, aucune release incomplete n'est publiee. Les signatures desktop sont optionnelles pour generer, mais recommandees pour distribuer.

Une execution manuelle sur une branche via **Actions > Packages et Release > Run workflow** produit des artefacts de test : desktop, APK debug, application iOS simulateur. Elle ne publie pas de release.

## Versioning et release

`package.json` est la source de la version SemVer. Le lockfile et le tag doivent correspondre exactement.

```sh
npm run release:prepare -- 0.2.0
npm run release:check -- v0.2.0
git add package.json package-lock.json
git commit -m "Release 0.2.0"
git tag v0.2.0
git push origin HEAD
git push origin v0.2.0
```

Commiter aussi les scripts, workflows et modifications applicatives avant de taguer. `release:prepare` ne cree ni commit, ni tag, ni push. Les fichiers non commites ne figurent pas dans le build GitHub du tag.

`.github/workflows/release.yml` verifie les versions, lance les tests et compile le web, puis genere les packages sur les runners natifs. La publication ne commence qu'apres la reussite de **toutes** les cibles. La release inclut les fichiers et `SHA256SUMS`, avec des notes generees. Les permissions d'ecriture sont limitees au job de publication.

`v0.2.0-rc.1` produit une **prerelease**, un tag stable une release publique. Une release existante n'est pas ecrasee. `ci.yml` valide les pull requests et les branches `main`/`master` sans certificats.

`BUILD_NUMBER` definit `versionCode` Android et `CFBundleVersion` iOS ; il provient de `github.run_number` dans la pipeline. La version commerciale reste `X.Y.Z`. Sans cette variable en local, le numero est calcule depuis SemVer. Pour distribuer plusieurs builds locaux ou prereleases, definir un compteur coherent et croissant ; ne pas melanger sans coordination compteurs locaux et CI. Les noms de fichiers et la version Android conservent le suffixe prerelease.

## Securite

Electron charge uniquement les fichiers embarques via `homebank://app`, avec Node desactive dans le renderer, isolation, sandbox, CSP, permissions refusees et navigation/fenetres externes bloquees. Aucun contenu distant ne beneficie de privileges Node. Drive passe par un preload limite a cinq commandes validees, reservees a la fenetre principale ; les appels Google sont effectues dans le processus principal sur des endpoints fixes. L'ouverture du navigateur est limitee a l'URL d'autorisation construite par l'application.

Les builds natifs utilisent `native.html`, ignorent les fichiers `.env*` et les variables web `VITE_*`, et n'activent pas le service worker. Le paquet desktop ne contient ni `.env.local`, ni sources C HomeBank, ni portefeuilles, ni l'ensemble de `node_modules`. La persistance du MVP reste privee a chaque application, mais n'est pas un coffre chiffre.

La validation finale des packages signes exige les certificats reels et des essais sur les appareils cibles. Les tests web/Electron ne remplacent pas les tests iPhone/Android ni les controles de signature macOS/Windows. Les images des runners et leurs SDK doivent etre maintenus quand GitHub les fait evoluer.
