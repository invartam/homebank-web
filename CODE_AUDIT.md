# Revue du code et remediations

Date : 6 octobre 2026.

## Perimetre

Revue de React/TypeScript, modele et import/export HomeBank, stockage IndexedDB, controleur Drive, calendriers, formulaires, PWA, Electron, plugins Android/iOS, scripts de packaging/signature et workflows GitHub. Comparaison des ventilations avec ../homebank-5.10.3/src/hb-split.c. Le client original fourni est en C avec GTK/GLib, pas en C++.

Versions verifiees dans l'installation et le lockfile, audit npm en ligne, tests avec donnees fictives, builds web/native et compilation du plugin iOS. Aucun portefeuille bancaire reel utilise ni authentification/sauvegarde sur le Drive de l'utilisateur. Les configurations locales ne sont pas reproduites ici. Les travaux et modifications utilisateur deja presents ont ete conserves.

Cette revue n'est ni un pentest exhaustif, ni une certification bancaire, ni un audit juridique.

## Risques restant ouverts

| Priorite | Constat et emplacement | Suite recommandee |
| --- | --- | --- |
| Haute | Les sauvegardes Drive sont des PATCH complets sans precondition de version distante. Une verification d'existence ne detecte pas les modifications d'un autre appareil. src/lib/walletController.ts, sync ; src/lib/googleDrive.ts, saveWalletToDrive ; adaptateurs natifs save. | Conserver une version distante, signaler les divergences et definir export/rechargement/fusion. Une comparaison avant PATCH seule ne garantit pas l'atomicite. En attendant, eviter les editions simultanees du meme fichier sur plusieurs appareils ou fenetres. |
| Moyenne | Le portefeuille IndexedDB et les exports .xhb ne sont pas chiffres par l'application. La protection des jetons OAuth est distincte. src/lib/storage.ts, src/lib/nativeFiles.ts, exportFile dans src/App.tsx. | Concevoir chiffrement, recuperation des cles et verrouillage par plateforme. En attendant, verrouillage de l'appareil et sauvegardes d'exports chiffrees. |
| Moyenne | Les montants restent des number/double. Separer les devises ne garantit pas une precision decimale arbitraire. src/lib/models.ts et src/lib/homebank.ts. | Migration vers unites minimales ou decimaux avec tests import/export, ventilations, taux, transferts et migration des sessions. |
| Moyenne | Le modele XML n'est pas un conservateur universel des attributs/noeuds inconnus, meme dans une version reconnue. src/lib/homebank.ts. | Preserver les extensions opaques et etendre les fixtures avant de promettre une compatibilite sans perte avec tous les fichiers HomeBank. Le refus des versions futures limite ce risque sans le supprimer. |
| Moyenne | Le web charge les SDK Google depuis leurs domaines officiels ; la CSP stricte native n'est pas une protection equivalente du deploiement web. index.html et hebergeur. | Tester une CSP web compatible GIS/Picker ; verifier HTTPS, en-tetes et restrictions des cles API. La configuration Google Cloud et les en-tetes de production ne sont pas audites ici. |
| A valider | OAuth/Picker sur appareils reels, signatures de distribution, sauvegarde iOS et obligations de licence. | Essais iPhone/Android, controle des certificats, definition de la licence du projet et conservation des notices des bibliotheques. Ne pas deduire la licence du nouveau projet des seules licences npm. |

## Corrections appliquees

| Priorite initiale | Probleme confirme | Remediation |
| --- | --- | --- |
| Haute | Un brouillon d'edition perime apres rechargement Drive pouvait devenir une nouvelle operation a cause de son ancien identifiant. | Le formulaire conserve l'operation d'origine ; le controleur refuse la sauvegarde si elle a disparu ou change. Test sur brouillon perime. |
| Haute | Deux onglets pouvaient ecraser silencieusement leurs sessions locales respectives. | Revision comparee/incrementee dans la meme transaction IndexedDB que la session. Ecriture perimee refusee ; compatibilite avec l'ancienne base et tests de concurrence. Ce garde-fou local ne garantit pas l'exclusion mutuelle des uploads Drive. |
| Haute | parseInt/parseFloat des ventilations acceptaient des nombres partiels/invalides ; suppression des positions vides et remplacement silencieux par 0. | Nombres et longueurs valides obligatoires, positions conservees ; import invalide refuse avant remplacement du portefeuille. |
| Haute | Les soldes globaux additionnaient des devises differentes sous le symbole du premier compte. | Regroupement par devise dans Comptes et Operations, y compris couleurs de decouvert, sans conversion implicite. Calendrier deja groupe par devise conserve. |
| Moyenne | Nouveau local et import pouvaient abandonner des modifications non synchronisees. | Confirmation avec export/annulation et gardes au controleur. Export disponible avec uniquement des comptes clos. |
| Moyenne | Import local et downloads web/Electron non bornes ; limite iOS appliquee apres accumulation complete. | Limite de 32 Mo avant lecture/import et pendant les flux web/Electron/iOS ; comptage des octets decompresses. Metadonnees/token Electron limites a 256 Ko. |
| Moyenne | DTD, versions futures, dates/devises invalides ou statuts inconnus pouvaient provoquer erreur de rendu ou reinterpretation. | Refus explicite et dates ISO impossibles non normalisees silencieusement. Un XML Drive invalide est une erreur permanente, sans boucle automatique de telechargement. |
| Moyenne | Echec cache.put pouvant masquer une reponse reseau valide ; navigation directe vers un fichier de donnees susceptible d'etre cachee. | La reponse reste utilisable si le cache est plein/interdit. Extensions de donnees et navigations hors shell exclues ; cache PWA versionne en v21. |
| Moyenne | Chaine de build Electron vulnerable via sprintf-js. | Override cible @electron/get -> global-agent 4.1.3, retirant roarr/sprintf-js et conservant bootstrap. Aucun audit fix --force ou downgrade des outils. |
| Moyenne | Assets prives pouvant etre embarques sur mobile ; fichiers inattendus du dossier release pouvant etre publies. | Liste d'extensions autorisees pour les assets natifs, refus des liens/configurations locales et fichiers inattendus dans release, exclusion .local.json dans l'ASAR. |
| Moyenne | Fonctionnalites Electron inutiles activables et Actions GitHub sur tags mutables. | Fuses RunAsNode, NODE_OPTIONS, inspection CLI et privileges file desactives ; ASAR exclusif/integrite actives ; re-signature Ad Hoc pour les builds macOS sans certificat. Actions sur SHA verifies, suivi Dependabot. Voir [fuses Electron](https://www.electronjs.org/docs/latest/tutorial/fuses). |
| Moyenne | Sauvegardes OS Android susceptibles d'emporter portefeuille et preferences. | allowBackup=false, exclusions cloud/device-transfer et HTTP clair interdit, appliques idempotemment au sync, sans modifier les activites. [Android precise qu'allowBackup seul ne couvre pas tous les transferts OEM](https://developer.android.com/identity/data/autobackup). |
| Moyenne | Resolution Swift non alignee avec npm, Cordova non declare et dictionnaire AppAuth nullable utilise sans unwrap. | Capacitor exact 8.4.3, Cordova explicite, acces optionnel a additionalParameters ; compilation du plugin iOS simulateur reussie. |
| Faible | Dev/preview exposes sur toutes les interfaces sans choix explicite. | Loopback par defaut ; LAN disponible avec --host 0.0.0.0 sur reseau de confiance. |

## Correctif de compatibilite apres la revue

Le controle initial de version XML traitait v comme une paire majeur.mineur. C'etait une regression : homebank_save_xml_ver dans hb-xml.c utilise g_ascii_dtostr (format %.17g), et le client original relit un gdouble. La version 1.6 peut donc etre ecrite 1.6000000000000001. La validation compare maintenant la valeur numerique au maximum 1.6 et conserve l'ecriture originale a l'export. Les formats reellement plus recents et les valeurs non numeriques restent refuses.

Les erreurs d'import Drive affichent maintenant la cause reconnue (version, statut, ventilation, XML invalide), sans recopier le contenu du fichier ni confondre une erreur HTTP avec une erreur de parsing. Verification : 158 tests unitaires, 78 tests navigateur et smoke Electron avec un en-tete HomeBank original ; DMG macOS arm64 reconstruit.

## Bibliotheques

Versions effectivement installees/verrouillees. Licences declarees dans les metadonnees, sans certification de conformite du binaire distribue.

| Bibliotheques | Versions | Usage et verdict |
| --- | --- | --- |
| React, react-dom, types | 19.3.0 | Conserver : hooks, StrictMode et etat externe coherents, types stricts. MIT. |
| MUI, Emotion | 9.4.0 ; 11.14.0 / 11.14.1 | Conserver le systeme Material et les imports par composant. Pagination reutilise MUI. MIT. |
| Roboto, lucide-react | 5.3.0 ; 0.544.0 | Polices locales et icones existantes. OFL-1.1 / ISC. |
| Temporal polyfill | 0.5.1 | Conserver pour les calculs calendaires ; eviter leur reimplementation. Les regles de recurrence HomeBank restent propres au domaine. ISC. |
| Capacitor core/android/ios/cli | 8.4.3 | Versions alignees, y compris Swift apres correction. MIT. |
| Filesystem, Share | 8.1.3 ; 8.0.2 | Utiles aux exports mobiles ; leur cache n'est pas un coffre chiffre. MIT. |
| AppAuth-iOS, GIS Android | 2.0.0 ; play-services-auth 21.5.0 | SDK natifs conserves, scopes limites. Compilation AppAuth verifiee. Le chemin Android toGoogleSignInAccount est deprecated : suivre son remplacement public et tester sur appareils. Pas d'auth legacy GoogleSignIn ajoutee. |
| Plugin HomeBankDrive local | 0.1.0 | Pont partage avec Electron, tests JS distincts des tests des SDK. Licence du projet/plugin a definir. |
| Electron, electron-builder, asar | 44.5.1 ; 26.17.0 ; 4.3.1 | Conserver, durcir les fuses et suivre les mises a jour. Les dependances Node ne sont pas embarquees dans l'ASAR. MIT. |
| global-agent transitive | 4.1.3 via override | Retire la chaine vulnerable et preserve bootstrap ; tests et packaging verifies. Reevaluer cet override lors des mises a jour de @electron/get. [API primaire](https://github.com/gajus/global-agent). |
| Vite, plugin-react, TypeScript | 7.3.6 ; 5.2.0 ; 5.9.3 | Separation web/native et isolation des .env existantes utiles. MIT / MIT / Apache-2.0. |
| Vitest, Playwright, jsdom, fake-indexeddb | 5.0.3 ; 1.63.0 ; 30.1.1 ; 6.2.5 | Outils de test uniquement. MIT / Apache-2.0 / MIT / Apache-2.0. |
| plist, xmldom, semver, yaml | 3.1.1 ; 0.9.12 ; 7.8.5 ; 2.9.1 | APIs structurees. xmldom declare directement pour le manifeste, sans dependance implicite a plist. MIT / MIT / ISC / ISC. |
| resvg | 2.6.2 | Generation d'icones au build, non embarque comme moteur de rendu bancaire. MPL-2.0. |

L'audit npm initial signalait 8 entrees moderees issues d'une meme chaine sprintf-js -> roarr -> global-agent -> @electron/get. [L'advisory confirme l'absence de version corrigee de sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), d'ou suppression de la chaine concernee plutot qu'une mise a jour generale.

Apres remediation : **0 vulnerabilite connue signalee par npm audit**. Ce resultat ne couvre pas automatiquement Maven/SwiftPM, Chromium, les configurations Google Cloud ou les vulnerabilites inconnues. CI et validation avant release executent npm run audit:dependencies au seuil moderate. Dependabot propose des mises a jour npm/Actions hebdomadaires, sans fusion automatique ; les SDK natifs demandent une veille distincte.

## Bonnes pratiques et optimisations

- Controleur injecte, file d'actions et sauvegarde locale avant upload conserves ; revision locale ajoutee sans migration destructrice.
- Validation aux frontieres import/HTTP et au controleur, pas seulement dans les champs HTML.
- IndexedDB confirme sur oncomplete, ferme sur versionchange et signale une ouverture bloquee.
- Pagination de 50 operations ; recherche sur tout le portefeuille, pas seulement la page visible. Nouveau filtre/snapshot remet a la premiere page.
- Cache borne des formateurs Intl : 32 configurations, aucune valeur bancaire conservee dans ce cache.
- Tri des categories et operations recentes memoises ; soldes calcules une fois puis regroupes par devise.
- Jour courant suivi dans Comptes et Operations, meme sans reconnexion Drive ; dependance manquante du filtre de recherche des virements corrigee.
- Pas de nouvelle librairie d'etat, de virtualisation ou de graphique. Le parseur du manifeste etait deja transitif ; sa declaration directe rend le contrat explicite.

La projection des recurrences reste synchrone avec plafond par operation. Des portefeuilles extremes meriteraient un budget global, un worker et des mesures sur telephone peu puissant. Les optimisations sont verifiees fonctionnellement, pas presentees comme un benchmark universel.

## Verification

- 155 tests unitaires reussis.
- 75 tests Playwright reussis : desktop, iPhone 13 et iPhone SE emules, parcours existants et nouvelles regressions, dont conflit IndexedDB reel entre deux onglets.
- Builds TypeScript/Vite web et native reussis ; assets autorises et isolation des configurations web verifies.
- Plugin iOS compile pour arm64-apple-ios15.0-simulator avec Xcode/SDK iOS 27, AppAuth 2.0.0 et Capacitor/Cordova 8.4.3. Le delegate HTTP est aussi typechecke. Pas un essai OAuth sur iPhone.
- Paquet Electron macOS arm64 sans signature de distribution, avec signature Ad Hoc locale validee par codesign ; ASAR inspecte et fuses lus dans le binaire. Smoke sur profil temporaire : affichage, import/restauration, isolation Node et pont/bouton Drive, sans connexion Google.
- Pas d'APK signe, d'IPA Ad Hoc, de notarisation ou de test Windows. La machine dispose de JDK 25/27 et SDK Android 37 ; la chaine actuelle demande JDK 21 et SDK 36. Les jobs CI natifs n'ont pas ete declenches ici.
- Le projet iOS genere conserve encore l'identifiant io.github.homebankweb.app, different du nouvel appId lu.benjy.homebankwallet.app. Le garde-fou de sync refuse ce changement silencieux : sauvegarder les personnalisations et regenerer ce projet avant un build de l'application complete. La compilation du plugin verifiee ci-dessus est independante de cet identifiant.
- Aucun commit, push ou release effectue ; aucune cle utilisateur utilisee.

Les remediations ne mettent pas a jour les applications deja installees : reconstruire/reinstaller les packages. Le paquet local de verification Electron utilise un client Drive fictif ; reconstruire normalement avec votre configuration avant distribution.
