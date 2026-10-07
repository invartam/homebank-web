# Packaging et releases

La meme interface React est embarquee dans **Electron pour macOS/Windows** et **Capacitor pour iOS/Android**. Electron ne produit pas d'applications iOS ou Android. Aucun serveur web n'est necessaire une fois l'application installee.

## Limites importantes

- La version web garde son integration Google Drive. **Electron, iOS et Android prennent aussi en charge Drive**, avec des clients Google specifiques a chaque plateforme (configuration ci-dessous). La connexion n'est jamais faite dans la WebView bancaire : navigateur/session systeme sur Electron/iOS et autorisation native Google sur Android.
- Les versions natives permettent l'import local `.xhb`, la consultation, la saisie et la sauvegarde locale. Sur mobile, l'export ouvre le partage systeme pour enregistrer dans Fichiers ou choisir une application destinataire. Le fichier temporaire reste dans le cache prive pour permettre sa lecture par le destinataire ; ce cache n'est pas chiffre par l'application et peut etre purge par l'OS.
- Les portefeuilles du navigateur, d'Electron et des applications mobiles sont independants. Exporter/importer un `.xhb` pour transferer les donnees.
- iOS est prepare pour la distribution **Ad Hoc**, pas pour TestFlight. L'IPA ne s'installe que sur les appareils dont les UDID figurent dans le profil Apple. Le ZIP simulateur n'est pas installable sur iPhone.
- Les builds desktop sans certificats sont non signes/non notarises : SmartScreen ou Gatekeeper peuvent les bloquer. Configurer les signatures avant une distribution publique, sans desactiver globalement les protections de l'OS.
- La pipeline publie les packages dans GitHub Releases, pas sur les stores, et n'implemente pas de mise a jour automatique.

References : [plateformes Electron](https://www.electronjs.org/docs/latest/), [Capacitor](https://capacitorjs.com/docs), [regles OAuth Google](https://developers.google.com/identity/protocols/oauth2/policies), [distribution de test Apple](https://developer.apple.com/documentation/xcode/testing-a-release-build).

## Google Drive dans Electron

Si le navigateur indique que la connexion est terminee mais que l'application refuse le fichier, verifier le message d'import : une erreur XML concerne aussi l'import local, pas uniquement OAuth. Le format HomeBank 1.6 peut porter l'en-tete numerique v="1.6000000000000001", ecrit par le client original. Cette ecriture est prise en charge ; les anciens paquets contenant le controle de version trop strict doivent etre remplaces par un build corrige. Il n'est pas necessaire de modifier le fichier .xhb pour le raccourcir en v="1.6".

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

## Google Drive sur iOS et Android

Le plugin local `native-plugins/homebank-drive` utilise **AppAuth-iOS 2.0.0** et **Google Identity Services / play-services-auth 21.5.0**. Il expose le meme contrat que le preload Electron : autorisation, selection, verification, lecture et sauvegarde. La synchronisation et les revisions `.xhb` reutilisent le controleur existant. Les dependances natives sont resolues lors de la compilation, avec Swift Package Manager pour iOS.

### Configuration commune

1. Dans le meme projet Google Cloud, activer **Google Drive API** et **Google Picker API**. Autoriser uniquement `https://www.googleapis.com/auth/drive.file`. En mode Testing, ajouter les comptes autorises a l'ecran de consentement.
2. Creer les clients mobiles ci-dessous. Ne pas reutiliser le client Electron/Desktop ou Web.
3. Renseigner `mobile-drive.local.json` a la racine avec le format de `mobile-drive.example.json` :

```json
{
  "iosClientId": "CLIENT_IOS.apps.googleusercontent.com",
  "androidClientId": "CLIENT_ANDROID_RELEASE.apps.googleusercontent.com",
  "androidDebugClientId": "CLIENT_ANDROID_DEBUG.apps.googleusercontent.com"
}
```

Ces CLIENT_ID sont publics ; aucune cle API, aucun secret OAuth et aucun jeton utilisateur ne doivent figurer dans ce fichier. Il est ignore par Git et reste independant de `electron-drive.local.json`. Une valeur vide desactive Drive pour la variante concernee sans bloquer l'import local.

### iOS

1. Creer un client OAuth de type **iOS** avec le Bundle ID exact de `packaging.config.json`. Ne pas activer l'obligation App Check pour cette integration AppAuth : l'attestation App Check n'est pas implementee.
2. Renseigner `iosClientId`, puis executer `make sync-ios`, `make ios` ou `make ios-adhoc`. Le script enregistre le schema de retour dans `Info.plist`, par exemple `com.googleusercontent.apps.123-ios:/oauth2redirect`. Il conserve les schemas sans rapport avec Drive. Utiliser ces scripts plutot que `npx cap sync` seul pour cette configuration.
3. Dans l'application, choisir **Fichier > Ouvrir Drive**, autoriser Google dans la session systeme, choisir le fichier, puis revenir a l'application.

AppAuth valide `state` et PKCE, echange le code et renouvelle les jetons. L'etat OAuth est archive avec `NSSecureCoding` dans le **Trousseau iOS**, avec `AfterFirstUnlockThisDeviceOnly` et une entree propre au client et a l'application. Les jetons ne sont ni retournes a JavaScript ni sauvegardes dans IndexedDB. Une autorisation invalide exige une reconnexion ; aucun consentement ne s'ouvre automatiquement lors d'une restauration.

### Android

Le package de distribution configure est `lu.benjy.homebankwallet.app` ; la variante debug utilise `lu.benjy.homebankwallet.app.debug`. Utiliser ces noms dans les clients OAuth Android, chacun avec la SHA-1 de sa signature. Un changement de package cree une application distincte sur l'appareil : exporter le portefeuille de l'ancienne application avant de la desinstaller.

1. Creer un client OAuth de type **Android** avec le nom de package exact (`appId`) et l'empreinte **SHA-1 du certificat de distribution**. Le SDK Google identifie l'application par ce couple package/signature ; le CLIENT_ID configure sert de garde-fou de configuration et d'identite de session, pas de secret serveur.
2. Pour l'APK debug, creer un **autre client Android** avec le package `appId.debug` et la SHA-1 du keystore debug. Renseigner `androidDebugClientId`. L'absence de cette valeur laisse Drive desactive dans l'APK debug.
3. Apres `make sync-android`, `./gradlew signingReport` depuis `native/android` donne les empreintes des variantes debug. Pour la distribution, inspecter votre keystore de release avec `keytool -list -v -keystore ... -alias ...`, sans mettre ses mots de passe dans Git. Si Google Play resigne l'application, enregistrer aussi son certificat de signature Play dans Google Cloud.
4. Reconstruire avec `make android` ou `make android-release`, puis utiliser **Fichier > Ouvrir Drive**. Un appareil/emulateur avec Google Play Services et un compte Google est requis ; cette integration ne cible pas les appareils sans services Google.

Le Picker est demande par `AuthorizationClient` avec `PICKER_OAUTH_TRIGGER`, un seul fichier et uniquement le scope `drive.file`. **Google Play Services gere les autorisations et leur renouvellement** : aucun refresh token n'est sauvegarde par HomeBank sur Android. Le jeton d'acces reste en memoire native. Seuls le nom du compte choisi et le CLIENT_ID sont memorises dans les preferences privees de l'application, afin de restaurer le meme compte sans afficher le consentement. Ces preferences ne constituent pas un coffre chiffre ; elles ne contiennent pas de jetons.

### CI et verification

Configurer les **variables Actions**, pas des secrets utilisateur, `MOBILE_GOOGLE_IOS_CLIENT_ID`, `MOBILE_GOOGLE_ANDROID_CLIENT_ID` et `MOBILE_GOOGLE_ANDROID_DEBUG_CLIENT_ID`. Les memes variables sont utilisables en local et prennent precedence sur le JSON. La pipeline de release les injecte dans les projets Capacitor. Les workflows de PR compilent egalement l'APK debug et l'application iOS simulateur sans identifiants ni signature de distribution.

Pour tester Drive dans l'APK debug genere par GitHub, ajouter aussi le secret **`ANDROID_DEBUG_KEYSTORE_BASE64`** contenant un keystore debug stable, et enregistrer sa SHA-1 dans le client Android debug. Utiliser le format Android standard (alias `androiddebugkey`, mots de passe `android`), par exemple le keystore local `~/.android/debug.keystore` cree par le premier build. Ne jamais l'utiliser pour une distribution release. Sans cette cle stable, la pipeline manuelle produit toujours l'APK debug, mais y desactive Drive : un nouveau runner aurait sinon une nouvelle SHA-1 non autorisee par Google. Le keystore temporaire est supprime apres compilation et n'est pas publie.

Tester sur appareils reels : premiere selection, ajout/modification puis revision Drive, fermeture/reouverture, reprise apres expiration, perte/reprise reseau, consentement annule et fichier supprime. Les tests JavaScript simulent le plugin ; une synchronisation Capacitor et une validation syntaxique Swift ne remplacent pas une compilation native et ces essais OAuth reels.

La reprise automatique fonctionne quand l'application est ouverte ou revient au premier plan. Elle ne promet pas de synchronisation pendant que l'OS suspend ou ferme l'application. Le portefeuille local du MVP reste dans IndexedDB et n'est pas chiffre par ce plugin. Les fichiers transferes sont limites a 32 Mo sur mobile. La gestion des conflits entre modifications simultanees sur plusieurs appareils n'est pas ajoutee ici : eviter d'editer le meme fichier simultanement.

References : [Picker et scopes mobiles](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker), [autorisation Android](https://developer.android.com/identity/authorization), [AppAuth et sessions iOS](https://github.com/openid/AppAuth-iOS), [clients et retours OAuth iOS](https://developers.google.com/identity/protocols/oauth2/native-app).

## Prerequis

1. Node **22.22.2+** ou **24.15.0+**, Node 24 pour reproduire la CI, puis `npm ci`.
2. Modifier `packaging.config.json` : `appId` est un identifiant reverse-DNS que vous controlez, commun au package Android, au Bundle ID iOS et au packaging Electron. Les clients OAuth mobiles et les profils Apple doivent correspondre a cet identifiant. `productName` est le nom de l'application.
3. macOS/iOS : un Mac ; pour iOS, **Xcode 26+** complet et selectionne, pas seulement les Command Line Tools. Ouvrir Xcode pour accepter sa licence et terminer l'installation des composants avant le premier build.
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
| Creer la cle Android | `npm run android:key:generate` | `make android-key` |
| Certificat Android / empreintes | `npm run android:key:info` | `make android-key-info` |
| iOS simulateur | `npm run ios:simulator` | `make ios` |
| iOS IPA Ad Hoc | `npm run ios:adhoc` | `make ios-adhoc` |
| Projets Android/iOS | `npm run native:sync:android` / `native:sync:ios` | `make sync-android` / `sync-ios` |

Les commandes reconstruisent l'interface. Les packages sont dans `release/desktop`, `release/android` et `release/ios`. Les sorties desktop sont DMG/ZIP macOS et NSIS/ZIP Windows. L'AAB est destine a un store ; l'APK est installable directement.

L'APK debug utilise un identifiant suffixe `.debug` et un stockage separe : il peut coexister avec l'application de distribution sans remplacer ses donnees.

Test Electron : `npm run build:native`, puis `npm run desktop:smoke`. Une fenetre est ouverte avec un profil temporaire et des donnees fictives, l'import/restauration et l'isolation sont verifies, puis elle est fermee.

## Signature Android

Pour installer les APK manuellement, utiliser une **cle de signature de distribution geree par vous**, sans compte Play Store ni Play App Signing. Le certificat est auto-signe : aucune autorite de certification n'est necessaire. La meme cle doit signer toutes les mises a jour de la meme application. [Documentation Android](https://developer.android.com/studio/publish/app-signing).

### Creer la cle une seule fois

Depuis la racine du projet, avec un JDK installe (JDK 21 requis pour les builds Android) :

~~~sh
npm run android:key:generate
# ou : make android-key
~~~

Le script lance les questions de `keytool` dans votre terminal : choisir un mot de passe long et unique, puis renseigner l'identite du certificat et la confirmer. Le mot de passe n'est pas affiche. Sans variables de signature deja definies, le resultat est :

- Fichier : `.signing/homebank-release.keystore`, ignore par Git.
- Alias : `homebank`.
- Format : PKCS12, cle RSA 4096 bits, signature SHA256withRSA, validite 10 000 jours.
- Le mot de passe de la cle est identique a celui du keystore.

Le script refuse tout ecrasement et supprime ses fichiers temporaires en cas d'echec. Sur macOS/Linux, le fichier est accessible uniquement a son proprietaire (0600). Sur Windows, conserver le fichier dans un dossier personnel protege par les permissions NTFS. Ne jamais regenerer la cle pour une simple nouvelle version.

Le chemin et l'alias peuvent etre personnalises :

~~~sh
npm run android:key:generate -- --keystore /chemin/securise/homebank.keystore --alias homebank
npm run android:key:info -- --keystore /chemin/securise/homebank.keystore --alias homebank
~~~

`ANDROID_KEYSTORE_PATH` et `ANDROID_KEY_ALIAS` servent aussi de valeurs par defaut. Pour une execution automatisee, definir `ANDROID_KEYSTORE_PASSWORD` dans l'environnement et fournir `--dname` (par exemple `"CN=HomeBank Wallet"`). Aucun argument de mot de passe en clair n'est accepte ; le script utilise le modificateur [keytool :env](https://docs.oracle.com/en/java/javase/21/docs/specs/man/keytool.html).

**Sauvegarder le keystore hors du depot et hors de cette machine**, dans un stockage chiffre, et conserver son mot de passe dans un gestionnaire de mots de passe. Sa perte empeche les mises a jour avec la meme signature ; son vol permet de signer de faux APK.

### Configurer Google Drive

Afficher le certificat et ses empreintes publiques, avec le meme mot de passe :

~~~sh
npm run android:key:info
# ou : make android-key-info
~~~

Renseigner la SHA-1 affichee dans le client OAuth Android de distribution pour le package `lu.benjy.homebankwallet.app`. Ne pas utiliser la SHA-1 debug pour ce client. La cle privee et le keystore ne doivent jamais etre transmis a Google Cloud.

### Compiler et installer l'APK

Avant `npm run android:release`, definir `ANDROID_KEYSTORE_PATH` (chemin absolu), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` et `ANDROID_KEY_PASSWORD`. Exemple pour **zsh, le terminal par defaut sur macOS**, avec le keystore par defaut :

~~~zsh
export ANDROID_KEYSTORE_PATH="$PWD/.signing/homebank-release.keystore"
export ANDROID_KEY_ALIAS=homebank
read -rs 'ANDROID_KEYSTORE_PASSWORD?Mot de passe du keystore : '
printf '\n'
export ANDROID_KEYSTORE_PASSWORD
export ANDROID_KEY_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
make android-release
unset ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD
~~~

Sous bash, remplacer la ligne `read` par : `read -rsp 'Mot de passe du keystore : ' ANDROID_KEYSTORE_PASSWORD`. Ne pas mettre les mots de passe dans les arguments de Make, dans l'historique du terminal ni dans Git. Une release echoue si la signature est incomplete ; elle ne produit pas silencieusement un APK debug.

L'APK signe se trouve dans `release/android/HomeBankWeb-VERSION-android-release.apk`. Le build produit aussi un AAB, inutile pour votre installation manuelle. Transferer **uniquement l'APK**, l'ouvrir sur Android et autoriser l'installation pour l'application qui ouvre ce fichier (gestionnaire de fichiers ou navigateur). Autre possibilite, avec un appareil autorise pour le debogage USB :

~~~sh
adb install -r release/android/HomeBankWeb-0.1.0-android-release.apk
~~~

Adapter la version dans le chemin. Pour une mise a jour, conserver le package `lu.benjy.homebankwallet.app` et la meme cle, et augmenter le `versionCode` via le versioning decrit ci-dessous. Eviter de desinstaller l'ancienne version : cela supprime ses donnees locales.

Pour les releases GitHub, reutiliser ce meme keystore dans le secret `ANDROID_KEYSTORE_BASE64`, l'alias `homebank` et le meme mot de passe pour `ANDROID_KEYSTORE_PASSWORD` et `ANDROID_KEY_PASSWORD`. Sur macOS : `base64 -i .signing/homebank-release.keystore | pbcopy`. Le base64 n'est pas un chiffrement : le coller uniquement dans le secret Actions, pas dans un fichier suivi.

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

Les deux workflows initialisent explicitement les outils Android avec [setup-android](https://github.com/android-actions/setup-android), fige sur un commit : outils en ligne de commande, licences, `ANDROID_HOME` et `PATH`, puis SDK 36 et Build Tools 36.0.0. Ils ne supposent pas que `sdkmanager` est deja accessible sur le runner. Les tests navigateur compilent un dossier isole `dist-e2e/` avec une configuration Google fictive ; ils ne necessitent aucun secret Google et cette configuration n'est pas utilisee par les packages distribues. Voir [les commandes de test](README_TECHNIQUE.md#tests).

`v0.2.0-rc.1` produit une **prerelease**, un tag stable une release publique. Une release existante n'est pas ecrasee. `ci.yml` valide les pull requests et les branches `main`/`master` sans certificats.

`BUILD_NUMBER` definit `versionCode` Android et `CFBundleVersion` iOS ; il provient de `github.run_number` dans la pipeline. La version commerciale reste `X.Y.Z`. Sans cette variable en local, le numero est calcule depuis SemVer. Pour distribuer plusieurs builds locaux ou prereleases, definir un compteur coherent et croissant ; ne pas melanger sans coordination compteurs locaux et CI. Les noms de fichiers et la version Android conservent le suffixe prerelease.

## Securite

Les builds Android generes par les scripts excluent les sauvegardes OS cloud et les transferts d'appareil pour les donnees privees, et interdisent le HTTP en clair. Conserver une sauvegarde via export .xhb ou la synchronisation explicite Drive. Les paquets Electron desactivent les fuses inutiles et imposent l'ASAR avec controle d'integrite ; une signature Ad Hoc locale permet les tests macOS, sans remplacer une signature de distribution/notarisation. Voir [la revue de securite et ses limites](CODE_AUDIT.md).

Electron charge uniquement les fichiers embarques via `homebank://app`, avec Node desactive dans le renderer, isolation, sandbox, CSP, permissions refusees et navigation/fenetres externes bloquees. Aucun contenu distant ne beneficie de privileges Node. Drive passe par un preload limite a cinq commandes validees, reservees a la fenetre principale ; les appels Google sont effectues dans le processus principal sur des endpoints fixes. L'ouverture du navigateur est limitee a l'URL d'autorisation construite par l'application.

Les builds natifs utilisent `native.html`, ignorent les fichiers `.env*` et les variables web `VITE_*`, et n'activent pas le service worker. Le paquet desktop ne contient ni `.env.local`, ni sources C HomeBank, ni portefeuilles, ni l'ensemble de `node_modules`. La persistance du MVP reste privee a chaque application, mais n'est pas un coffre chiffre.

La validation finale des packages signes exige les certificats reels et des essais sur les appareils cibles. Les tests web/Electron ne remplacent pas les tests iPhone/Android ni les controles de signature macOS/Windows. Les images des runners et leurs SDK doivent etre maintenus quand GitHub les fait evoluer.
