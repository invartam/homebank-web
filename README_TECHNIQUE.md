# HomeBank Web : Guide Technique

Installation, compilation, deploiement et maintenance de la SPA HomeBank Web. La presentation du logiciel et ses captures d'ecran sont dans le [README principal](README.md).

Pour les installateurs Electron macOS/Windows, les applications Capacitor iOS/Android, les signatures et les releases GitHub versionnees, consulter le [guide de packaging](README_PACKAGING.md).

La revue des bibliotheques, de la securite, des bonnes pratiques et des optimisations, avec corrections et risques restants, est dans [CODE_AUDIT.md](CODE_AUDIT.md).

## Sommaire

- [Installation et lancement](#installation-et-lancement)
- [Compilation et apercu local](#compilation-et-apercu-local)
- [Deploiement](#deploiement)
- [Comportements metier](#comportements-metier)
- [Google Drive et configuration Google Cloud](#google-drive)
- [Tests](#tests)
- [Architecture](#architecture)
- [Limites et precautions](#limites-et-precautions)

## Installation et lancement

Prerequis : Node.js **24.x a partir de 24.15.0**, ou **22.x a partir de 22.22.2**, npm et un navigateur moderne avec IndexedDB. Ces versions respectent les contraintes des dependances de compilation et de test du projet, notamment jsdom. Un fichier `.xhb` permet d'utiliser le logiciel ; Google Cloud est optionnel pour l'import/export local.

Depuis le dossier qui contient `homebank-web` :

```bash
cd homebank-web
npm ci
npm run dev
```

`npm ci` installe les versions du `package-lock.json`. Ouvrir l'URL affichee par Vite, habituellement `http://localhost:5173`. Si le port est occupe, Vite peut en choisir un autre. Pour fixer l'origine utilisee par OAuth :

```bash
npm run dev -- --port 5173 --strictPort
```

Le serveur ecoute uniquement sur la machine locale par defaut. Pour un test smartphone sur un reseau de confiance, lancer explicitement `npm run dev -- --host 0.0.0.0` et utiliser l'adresse reseau affichee par Vite. Ne pas exposer le serveur de developpement sur Internet. L'HTTP sur une adresse IP locale ne remplace pas une origine HTTPS de production pour Drive et la PWA.

Aucune variable d'environnement n'est necessaire pour l'import/export local. Sans configuration Google, les commandes Drive sont desactivees. Pour Drive, suivre le [guide Google Cloud](#guide-google-cloud-pas-a-pas) puis redemarrer Vite.

## Compilation et apercu local

```bash
npm run build
```

La commande verifie les types TypeScript, puis genere la SPA statique dans `dist/` : HTML, JavaScript, CSS, polices locales, icone, manifest et service worker. Aucun backend ni base de donnees serveur ne sont necessaires pour cette version.

Pour verifier ce build avant publication :

```bash
npm run preview -- --port 4173 --strictPort
```

Ouvrir `http://localhost:4173`. Si Drive est teste sur cet apercu, autoriser aussi cette origine et son referent dans Google Cloud.

`npm run preview` sert a verifier le build localement, **pas a heberger la production**. Reference : [deploiement statique avec Vite](https://vite.dev/guide/static-deploy).

## Deploiement

### Hebergement attendu

Publier le contenu de `dist/` sur un hebergement statique en **HTTPS**, a la racine d'un domaine ou sous-domaine, par exemple `https://homebank.example.com/`.

La version actuelle utilise des chemins absolus pour `/sw.js`, le manifest, son `start_url` et l'icone. Publier sous `/homebank/` demande d'adapter ces chemins ainsi que `base` dans Vite ; changer uniquement `base` ne suffit pas.

### Publication pas a pas

1. Installer les dependances avec `npm ci` dans `homebank-web`.
2. Configurer les variables `VITE_GOOGLE_*` dans l'environnement de compilation si Drive est active.
3. Executer `npm run build`, puis verifier le resultat avec `npm run preview`.
4. Publier **tout le contenu de `dist/`**, en conservant les noms et l'arborescence des fichiers. Ne pas publier le depot, `.env.local`, les fichiers bancaires ou les resultats de tests.
5. Activer HTTPS. Verifier que `/`, `/assets/...`, `/sw.js` et `/manifest.webmanifest` sont accessibles. Une eventuelle regle SPA doit conserver l'acces aux fichiers statiques : ne pas renvoyer `index.html` a la place d'un fichier JavaScript absent.
6. Ajouter l'origine HTTPS exacte et les referents de production dans Google Cloud.
7. Tester l'import, une modification, l'export, le rechargement, la reconnexion Drive et l'ouverture sur smartphone avec un fichier de demonstration.

### Compilation automatique depuis Git

Pour un hebergeur qui compile le projet, configurer :

| Parametre | Valeur |
| --- | --- |
| Dossier de travail | `homebank-web` si le depot contient aussi les sources originales ; sinon la racine du depot web. |
| Version Node.js | `24.x` (minimum `24.15.0`) ou `22.x` (minimum `22.22.2`). |
| Installation | `npm ci` |
| Compilation | `npm run build` |
| Dossier a publier | `dist`, relatif au dossier de travail. |
| Variables | `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, eventuellement `VITE_GOOGLE_APP_ID`. |

Les variables `VITE_*` sont integrees au JavaScript a la compilation et sont visibles dans le navigateur. **Ne jamais y placer de secret OAuth, de jeton personnel ou de refresh token.** Restreindre la cle API dans Google Cloud. Modifier une variable apres publication demande de **recompiler et redeployer** ; aucun acces a Google n'est necessaire pendant la compilation.

### Cache et mises a jour PWA

Le service worker est enregistre uniquement en production. Il conserve l'enveloppe et les ressources chargees, mais pas les requetes Drive, les requetes authentifiees ou les fichiers bancaires. Le portefeuille est persiste separement dans IndexedDB.

- Servir `index.html`, `sw.js` et le manifest avec une politique permettant leur revalidation, par exemple `Cache-Control: no-cache`.
- Les fichiers versionnes par leur contenu dans `assets/` peuvent avoir un cache long : `Cache-Control: public, max-age=31536000, immutable`.
- Lors d'une evolution du cache ou de l'enveloppe, incrementer `CACHE_NAME` dans `public/sw.js` et adapter `tests/serviceWorker.test.ts`.
- Publier les nouveaux assets avant le HTML qui les reference, ou utiliser un deploiement atomique. Conserver les anciens assets pendant la transition si des sessions ouvertes les utilisent encore.
- Le service worker n'appelle pas `skipWaiting` : une nouvelle version peut attendre la fermeture des anciens onglets ou de la PWA avant de prendre la main.

L'installation sur l'ecran d'accueil depend du navigateur et de la plateforme. Verifier le manifest et l'installation sur les appareils cibles.

### Changement d'adresse et donnees locales

IndexedDB et les preferences sont lies a l'origine du site. Changer de domaine, de protocole ou de port cree un autre espace de stockage. Exporter la copie locale avant une migration d'adresse, surtout si des operations attendent leur synchronisation.

La copie locale n'est pas une sauvegarde independante : effacer les donnees du navigateur peut la supprimer. Conserver des exports reguliers du fichier `.xhb`.

## Comportements metier

Les sections suivantes precisent les regles d'edition et de prevision, puis le fonctionnement de l'integration Drive.

### Types d'operations

Le formulaire propose `Depense`, `Revenu` et `Virement interne`. Le montant se saisit positif ; le type determine son signe dans le fichier HomeBank. Un virement selectionne un compte debite et un compte credite distincts, parmi les comptes actifs. Entre devises differentes, le montant du compte lie se saisit aussi explicitement.

Les deux operations d'un virement sont creees ou modifiees dans une seule sauvegarde locale et une seule revision Drive. Elles conservent une cle `kxfer` commune, les comptes reciproques et les indicateurs HomeBank (`OF_INTXFER`, `OF_INCOME`, `OF_ADVXFER`). Les statuts pointe/rapproche sont independants pour chaque compte ; l'annulation porte sur les deux operations. Modifier la date met a jour les deux dates ; sinon les dates distinctes d'un virement importe sont conservees. Transformer un virement en depense/revenu retire sa contrepartie.

Les ventilations et les virements importes incomplets, ambigus ou lies a un compte desactive conservent leur structure : leurs montants, comptes et type ne sont pas modifiables.

### Consultation des comptes clos

Les vues `Operations` et `Planifiees > Echeancier` proposent un controle `Inclure les comptes clos`, desactive par defaut et independant pour chaque vue. Les comptes clos sont identifies par `(clos)` dans le filtre. Les operations saisies, les totaux et, dans le calendrier, les previsions suivent les comptes inclus. Les operations des comptes clos sont consultables en lecture seule dans la liste des operations ; la saisie reste reservee aux comptes ouverts.

Masquer les comptes clos alors qu'un compte clos est selectionne remet le filtre sur `Tous les comptes`. L'onglet `Recurrences` reste limite aux comptes ouverts. Le tableau de bord `Comptes`, ses soldes et son activite recente ne sont jamais affectes par ces controles. Les preferences sont limitees a la session d'affichage, sans modifier les flags des comptes ni le fichier HomeBank.

### Operations planifiees

L'onglet `Planifiees` et le bouton `Planifications` du tableau de bord ouvrent la consultation des planifications actives du fichier HomeBank. Les comptes clos sont exclus par defaut et peuvent etre inclus dans l'echeancier ; les modeles sans recurrence active ne sont pas affiches.

- La synthese et la comparaison par compte totalisent les echeances de l'onglet actif. Les filtres compte, type et recherche s'appliquent aussi aux totaux et au nombre d'echeances.
- La comparaison `Par compte` permet d'ouvrir directement les previsions d'un compte. Les devises differentes sont totalisees separement, sans conversion ni addition entre devises.
- L'onglet `Echeancier` est un calendrier : vue mensuelle du lundi au dimanche sur six semaines, et vue annuelle avec douze mois. Les fleches parcourent les mois ou annees ; `Aujourd'hui` revient a la periode courante. Un clic sur un jour ou un mois ouvre la liste des operations ; le detail annuel propose `Voir le mois`.
- Les operations saisies, non annulees et liees aux comptes inclus sont comptabilisees quelle que soit leur date, y compris les operations futures deja postees. A partir de demain, les occurrences encore planifiees s'y ajoutent. Aucune occurrence n'est generee avant la prochaine date de sa planification.
- Les mois passes utilisent exclusivement les operations saisies ; les mois futurs combinent les operations deja postees et les previsions. La prochaine date HomeBank delimite les echeances restantes : aucune fusion heuristique par date, tiers ou montant n'est appliquee entre une saisie et une prevision.
- Dans les cases du calendrier, les virements internes affichent separement la somme des montants entrants et sortants, sans les annuler en un net nul. Le flux net de la synthese reste calcule avec la difference entre ces deux sommes. Les devises restent separees.
- Chaque case affiche les revenus et depenses, avec les virements separes. Sur les petits ecrans, les montants journaliers sont abreges ; les libelles accessibles, les infobulles et le dialogue conservent les montants precis. Les fleches du clavier parcourent les cases, `Home` et `End` atteignent la premiere et derniere case de la periode.
- L'onglet `Recurrences` montre et totalise une prochaine echeance par planification et par compte concerne, y compris les echeances hors du mois courant et celles en retard. Il n'applique pas de filtre de periode : ces totaux ne sont pas des moyennes mensuelles. Le calendrier conserve sa navigation au retour depuis les recurrences. Le detail donne les dates, la frequence, la limite restante, le report week-end, le tiers, le memo et le numero de paiement.
- Les virements sont exclus des revenus/depenses et affiches comme flux entrants/sortants des comptes concernes. Le flux net les inclut ; un virement entre deux comptes de meme devise s'annule dans la vue generale. Le nombre d'echeances compte les mouvements par compte : un virement visible dans ses deux comptes compte donc deux lignes.

Les champs `recflg`, `nextdate`, `every`, `unit`, `limit`, `weekend`, `gap`, `ordn` et `wkdy` sont interpretes suivant `../homebank-5.10.3/src/hb-template.h`, `hb-template.c` et `hb-xml.c`. Les flags historiques de recurrence anterieurs a HomeBank 5.9 sont aussi lus. Les calculs calendaires utilisent [Temporal.PlainDate](https://tc39.es/proposal-temporal/docs/plaindate.html) via `@js-temporal/polyfill`. Une fois l'application et le portefeuille charges, la consultation ne demande aucun acces reseau supplementaire et reste disponible hors ligne.

Cette premiere version est strictement en lecture seule : pas de creation, edition, suppression, saut d'echeance ni comptabilisation automatique. Les previsions ne changent pas les soldes existants. Les noeuds XML `<fav>` restent conserves tels quels, y compris les attributs non reconnus, les prochaines dates et les limites. Une recurrence invalide ou une projection historique trop longue est signalee comme prevision incomplete plutot que consideree comme une prevision fiable.

## Google Drive

Cette section de configuration OAuth/Picker concerne la version **web**. Pour **Electron**, utiliser un client Google de type Desktop et suivre [Google Drive dans Electron](README_PACKAGING.md#google-drive-dans-electron). Pour les applications **iOS/Android**, suivre [Google Drive mobile](README_PACKAGING.md#google-drive-sur-ios-et-android) : clients mobiles distincts, session systeme/Trousseau iOS et autorisation native Google Play Services sur Android. Les jetons mobiles ne sont pas exposes au JavaScript.

### Connexion et reprise automatique

Une petite icone dans l'en-tete indique l'etat Drive : vert pour connecte, orange pour hors ligne / interrompu ou sauvegarde en attente, bleu anime pendant une reconnexion/sauvegarde, rouge si une autorisation ou une intervention est requise. Son infobulle precise l'etat. Sur mobile, elle reste visible ; l'import reste accessible depuis le tableau de bord et l'ecran Fichier.

L'application reprend automatiquement au retour du reseau, au retour au premier plan et lors de ses verifications periodiques (toutes les 5 secondes, uniquement quand elle est visible). Les erreurs temporaires sont reessayees avec un delai croissant de 5 secondes jusqu'a 5 minutes. Un jeton encore valide est reutilise ; son expiration est detectee et une erreur HTTP 401 provoque une tentative de renouvellement. Les erreurs permanentes d'acces au fichier ne sont pas reessayees en boucle.

Au refresh comme a la reconnexion, les modifications locales en attente sont envoyees sans telecharger le contenu distant, apres verification de l'existence du fichier. Une reprise automatique ne ferme pas le formulaire et ne remplace pas son brouillon.

Le modele OAuth navigateur Google utilise une fenetre de dialogue : le renouvellement automatique n'est donc pas garanti. Si Google exige une connexion, un consentement ou si le navigateur bloque la popup, les tentatives automatiques s'arretent ; cliquer l'icone Drive ou `Reconnecter Drive` permet de reprendre. Une reconnexion manuelle ne redemande pas systematiquement le consentement deja accorde. Les jetons et leurs dates d'expiration restent uniquement en memoire. Une reconnexion totalement autonome apres expiration necessiterait une evolution avec backend et refresh token protege. Reference : [modele de jetons Google](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

### Fichier introuvable ou dans la corbeille

L'application verifie les metadonnees du fichier memorise au chargement/reconnexion et avant chaque sauvegarde. Tant que la page est visible et connectee, un controle supplementaire est effectue environ une fois par minute, sans recharger le contenu bancaire.

Si Drive repond HTTP 404 ou indique que le fichier est dans la corbeille, l'icone devient rouge et une alerte propose `Choisir un autre fichier Drive`. La synchronisation automatique est suspendue ; le portefeuille local et les modifications en attente restent disponibles. Une panne reseau, une expiration de session ou un refus HTTP 403 ne sont pas assimiles a un fichier supprime. Google peut renvoyer HTTP 404 aussi pour un fichier inaccessible : [gestion des erreurs Drive](https://developers.google.com/workspace/drive/api/guides/handle-errors#notfound).

Le choix d'un autre fichier demande confirmation. Si des operations locales ne sont pas synchronisees, le dialogue le signale et propose `Exporter la copie locale` avant de remplacer le portefeuille. Ces operations ne sont pas fusionnees avec le nouveau fichier. La reference Drive et les donnees ne sont remplacees qu'apres selection, verification, lecture d'un fichier HomeBank valide et sauvegarde locale reussies. Une annulation ou une erreur conserve la session precedente ; aucune modification de l'ancien portefeuille n'est envoyee au fichier nouvellement choisi.

### Guide Google Cloud pas a pas

Ce MVP utilise le flux navigateur Google Identity Services avec le scope Drive non sensible `https://www.googleapis.com/auth/drive.file`. Ce scope limite l'acces aux fichiers autorises par l'utilisateur via Google Picker.

References : [configuration de Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview) et [modele de jetons Google](https://developers.google.com/identity/oauth2/web/guides/use-token-model). Utiliser un client OAuth, une cle API et un numero de projet provenant du meme projet Google Cloud.

1. Ouvrir Google Cloud Console
   - Aller sur `https://console.cloud.google.com/`.
   - Creer un projet ou selectionner un projet existant.
   - Noter le numero du projet : menu `IAM et administration` > `Parametres`. Il servira pour `VITE_GOOGLE_APP_ID`.

2. Activer les APIs necessaires
   - Aller dans `APIs et services` > `Bibliotheque`.
   - Activer `Google Drive API`.
   - Activer `Google Picker API`.

3. Configurer l'ecran de consentement OAuth
   - Aller dans `APIs et services` > `Ecran de consentement OAuth` ou `Google Auth Platform`.
   - Choisir le type adapte a ton usage.
   - Renseigner le nom de l'application, l'email support et l'email developpeur.
   - Ajouter le scope `https://www.googleapis.com/auth/drive.file`.
   - En mode test, ajouter ton compte Google dans les utilisateurs de test.

4. Creer le `CLIENT_ID`
   - Aller dans `APIs et services` > `Identifiants`.
   - Cliquer `Creer des identifiants` > `ID client OAuth`.
   - Type d'application : `Application Web`.
   - Dans `Origines JavaScript autorisees`, ajouter les origines utilisees par l'app, par exemple :
     - `http://localhost:5173`
     - l'URL HTTPS de production si l'app est publiee.
   - Ne pas renseigner de redirect URI pour ce MVP : il utilise le token model en popup.
   - Copier l'ID client dans `VITE_GOOGLE_CLIENT_ID`.

5. Creer l'`API_KEY`
   - Aller dans `APIs et services` > `Identifiants`.
   - Cliquer `Creer des identifiants` > `Cle API`.
   - Ouvrir la cle creee pour la restreindre.
   - `Restrictions d'application` : choisir `Sites Web`.
   - Ajouter les referers autorises :
     - `http://localhost:5173/*`
     - l'URL HTTPS de production avec `/*`
     - `https://docs.google.com/*`
   - `Restrictions d'API` : choisir `Restreindre la cle`.
   - Selectionner `Google Picker API` et `Google Drive API`.
   - Copier la cle dans `VITE_GOOGLE_API_KEY`.

6. Renseigner `.env.local`

```bash
cp .env.example .env.local
```

Puis remplir :

```bash
VITE_GOOGLE_CLIENT_ID=ton-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=ta-cle-api
VITE_GOOGLE_APP_ID=ton-numero-de-projet
```

7. Redemarrer Vite

```bash
npm run dev
```

Pour un deploiement, renseigner ces memes variables dans l'environnement de compilation et lancer `npm run build` avant publication. L'origine et les referents de production doivent etre autorises comme ceux de developpement.

8. Tester
   - Ouvrir l'application.
   - Cliquer `Drive`.
   - Accepter l'autorisation Google.
   - Choisir un fichier `.xhb`.
   - Ajouter ou modifier une operation.
   - Verifier dans Google Drive que le fichier a une nouvelle revision.
   - Rafraichir la page : l'application doit retrouver le fichier Drive choisi. Si le navigateur bloque le renouvellement du jeton, elle restaure la copie locale et demande de cliquer `Drive` / `Reconnecter Drive` pour reconnecter le meme fichier.

### Depannage

- Bouton Drive desactive : verifier que `.env.local` contient `VITE_GOOGLE_CLIENT_ID` et `VITE_GOOGLE_API_KEY`, puis redemarrer Vite.
- Erreur `API developer key is invalid` : verifier les restrictions de cle API, notamment l'ajout de `https://docs.google.com/*`.
- Erreur d'origine OAuth : ajouter exactement l'origine affichee par Vite dans les origines JavaScript autorisees, par exemple `http://localhost:5173`.
- Consentement bloque : si l'app est en mode test, ajouter ton compte Google dans les utilisateurs de test.
- Sauvegarde Drive interrompue : l'icone montre l'etat et la reprise reseau est automatique. Si l'icone signale qu'une connexion Google est requise, cliquer dessus ou sur `Reconnecter Drive`.
- Apres refresh, copie locale restauree au lieu du fichier Drive : cliquer `Drive` ou `Reconnecter Drive` pour renouveler l'autorisation sur le fichier deja memorise. Un backend serait necessaire pour une restauration Drive garantie sans interaction utilisateur.

## Tests

Utiliser les versions Node.js indiquees dans les [prerequis](#installation-et-lancement), y compris pour les tests.

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

Les tests unitaires couvrent les soldes, les types d'operations, les liens de virements et leur export XML, les dates locales, la persistance IndexedDB, les erreurs OAuth, l'expiration des jetons, les reprises Drive et le cache PWA. Les tests Playwright couvrent l'import, les comptes actifs, les dates sans chevauchement, les themes, la creation des trois types, l'edition d'un virement depuis le compte credite, le pointage, le rapprochement, l'export/reimport, la restauration apres refresh, l'indicateur hors ligne et la reconnexion sans perte du brouillon, aux formats desktop et mobile. Ils utilisent des donnees fictives et des reponses Drive/OAuth simulees ; ils ne se connectent pas a un compte Google. Les parcours Drive necessitent une configuration Google non vide dans le build (des valeurs fictives suffisent pour ces tests).

Les tests couvrent aussi les projections de planifications, les reports du week-end, les limites d'occurrences, les filtres, les totaux de l'onglet actif et la conservation des noeuds XML apres consultation.

Pour les parcours Drive en developpement sans configurer de vrai compte :

```bash
VITE_GOOGLE_CLIENT_ID=123456789-test.apps.googleusercontent.com VITE_GOOGLE_API_KEY=test-key npm run test:e2e
```

Les parcours sont aussi verifies sur un petit ecran de 320 pixels. Pour les executer sur le build de production :

```bash
VITE_GOOGLE_CLIENT_ID=123456789-test.apps.googleusercontent.com VITE_GOOGLE_API_KEY=test-key npm run build
E2E_PREVIEW=1 npm run test:e2e
```

Le port local `4174` doit etre disponible. Ne pas deployer le build aux identifiants fictifs : recompiler ensuite avec la configuration prevue pour l'hebergement.

## Architecture

- `src/App.tsx` : navigation et composition des ecrans.
- `src/theme.ts` : theme Material UI (couleurs, typographie, boutons, champs et etats interactifs).
- `src/components/` : tableau de bord, soldes, ligne et formulaire d'operation.
- `src/hooks/useWallet.ts` : integration du portefeuille avec React.
- `src/hooks/useWalletSelectors.ts` : index, recherche et soldes derives, memorises.
- `src/lib/models.ts` : types du domaine et portefeuille vide.
- `src/lib/homebank.ts` : import/export XML, dates, devises et calculs de soldes.
- `src/lib/wallet.ts` : types d'operations, creation/edition atomique des virements, tiers, categories et operations recentes.
- `src/lib/scheduled.ts` : lecture et projection des planifications, regroupements et totaux.
- `src/lib/calendar.ts` : frontiere historique/previsions, periodes et grille du calendrier, totaux par devise.
- `src/components/ScheduledCalendar.tsx` : calendrier mensuel/annuel, navigation et listes des operations selectionnees.
- `src/lib/walletController.ts` : restauration et file de sauvegarde, independantes de React.
- `src/lib/storage.ts` : persistance atomique du portefeuille, du fichier Drive et de l'etat de synchronisation.
- `src/lib/googleDrive.ts` : adaptateur OAuth, Picker et API Drive.

Le detail de l'analyse et des corrections figure dans [CODE_REVIEW.md](CODE_REVIEW.md).

Les sources de reference HomeBank sont dans `../homebank-5.10.3` ; elles ne sont pas necessaires pour compiler le projet web.

### Interface et themes

Sans choix enregistre, l'application suit le theme du systeme et ses changements pendant la visite. Le switch soleil/lune de l'en-tete permet un choix manuel conserve dans le navigateur. Si le stockage des preferences est indisponible, ce choix reste valable pour la visite en cours.

Les tokens Material UI sont dans `src/theme.ts` et les dispositions adaptatives dans `src/styles.css`. Roboto est hebergee dans l'application ; React et Material sont compiles en fichiers separes pour leur mise en cache. La navigation est laterale sur ordinateur et en bas de l'ecran sur mobile.

### Sauvegarde et restauration

Une modification est d'abord enregistree dans IndexedDB avec un indicateur de synchronisation en attente, puis envoyee a Drive. L'indicateur n'est retire qu'apres une sauvegarde reussie. Au refresh, une copie locale avec des modifications en attente est restauree sans etre remplacee par Drive ; la reprise automatique tente d'envoyer cette copie. Sans modifications en attente, la restauration tente de renouveler l'autorisation sans ecran de consentement et recharge le fichier distant. Si Google exige une action, `Reconnecter Drive` reprend le meme fichier. Les jetons OAuth restent uniquement en memoire.

## Limites et precautions

- Les splits sont parses et re-exportes, mais pas encore editables.
- Les champs structurels des operations ventilees et des virements incomplets, ambigus ou lies a un compte desactive restent verrouilles pour conserver leur coherence.
- Les regles d'affectation, modeles, operations planifiees et filtres sont conserves comme noeuds XML bruts.
- Les montants utilisent encore `number`, comme le code C existant. Une etape ulterieure devrait passer en decimal strict ou entier en unite minimale.
- Les comptes fermes HomeBank sont conserves dans le fichier exporte, mais masques dans l'interface.
- La synchronisation est serialisee dans une instance de l'application. La detection des conflits entre plusieurs appareils ou onglets n'est pas encore implementee.
- Les totaux globaux supposent des comptes dans une meme devise ; aucune conversion de devises n'est encore appliquee.
- Les planifications sont consultables uniquement : leur creation, edition et comptabilisation automatique ne sont pas disponibles.
- Il n'y a pas de connexion directe aux banques ni d'import automatique de transactions bancaires.
- Les donnees bancaires sont persistees dans le navigateur sans chiffrement applicatif. Eviter les appareils partages et proteger l'acces a la session.
- Le stockage depend du navigateur et de l'origine du site. Conserver une sauvegarde `.xhb` independante et exporter les modifications en attente avant d'effacer les donnees locales.
- Le renouvellement OAuth peut demander une intervention ; la reprise automatique n'est pas une garantie de synchronisation sans interaction.

## Depannage du deploiement

- Page blanche ou assets en erreur : verifier que tout `dist/` est publie a la racine et que les fichiers absents ne sont pas remplaces par du HTML.
- Ancienne interface apres publication : verifier la revalidation de `sw.js` et du HTML, puis fermer les onglets et la PWA pour permettre l'activation de la nouvelle version.
- Drive fonctionne localement mais pas en production : verifier les variables du build, l'origine OAuth exacte et les referents de la cle API.
- Port occupe : choisir un autre port et adapter l'origine OAuth si elle change. Les tests utilisent un port strict et ne reutilisent pas un serveur existant.

Les captures du README principal sont dans `docs/screenshots/` et utilisent uniquement des donnees fictives. Pour les renouveler, charger un portefeuille de demonstration et capturer les themes et formats correspondants ; ne jamais publier un portefeuille personnel dans la documentation.
