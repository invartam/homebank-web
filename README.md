# HomeBank Web MVP

MVP local-first pour l'option A du plan de migration HomeBank.

## Fonctionnalites

- Interface bancaire avec Material UI, police Roboto locale, champs a libelles flottants et navigation adaptee au desktop/mobile.
- Themes clair et sombre : detection automatique du theme du systeme et switch dans l'en-tete, avec choix manuel memorise.
- Import d'un fichier HomeBank `.xhb` dans le navigateur.
- Parsing XML vers un modele TypeScript.
- Stockage local dans IndexedDB.
- Tableau de bord responsive avec comptes actifs separes entre Banque et Epargne.
- Solde principal rapproche, avec soldes pointes et futurs par compte.
- Soldes colores selon le decouvert autorise du compte : vert au-dessus de zero, orange dans le decouvert autorise, rouge sous la limite.
- Tableau de bord avec les 5 dernieres operations passees et les 5 prochaines operations a venir.
- Liste des operations avec recherche et filtre par compte.
- Consultation des operations planifiees : echeancier et recurrences par compte, revenus/depenses prevus, virements internes distincts, filtres et detail en lecture seule.
- Operations futures grisees dans la liste.
- Actions rapides pour pointer ou rapprocher une operation.
- Formulaire d'operation avec champs separes pour tiers, numero de paiement et memo.
- Categories affichees avec leur chemin hierarchique `categorie:sous-categorie`.
- Ouverture d'un fichier `.xhb` depuis Google Drive et sauvegarde automatique d'une nouvelle revision apres modification d'operation.
- Restauration du lien Google Drive au rechargement de l'application, avec rechargement du fichier Drive quand le navigateur autorise le renouvellement du jeton OAuth.
- Sauvegardes Drive serialisees et modifications locales en attente conservees apres une erreur reseau ou un rechargement.
- Indicateur de connexion Drive visible sur mobile et desktop, reprise automatique apres coupure reseau et tentative de renouvellement de l'autorisation.
- Ajout et edition de depenses, revenus et virements internes (deux operations liees, debitees/creditees ensemble).
- Export d'un nouveau fichier `.xhb`.
- Manifest et service worker minimal pour installation PWA.

## Design

Le theme bancaire utilise Material UI : surfaces claires ou sombres, accents bleus, boutons avec etats interactifs, champs outlined a libelles flottants et police Roboto hebergee dans l'application. Les couleurs de solde restent liees aux autorisations de decouvert et sont adaptees au contraste de chaque theme.

Sans choix enregistre, l'application suit le theme du systeme, y compris ses changements pendant la visite. Le switch soleil/lune de l'en-tete permet de choisir un theme manuellement ; ce choix est conserve dans le navigateur apres un refresh ou une prochaine visite. Si le stockage est indisponible, le switch reste utilisable pour la visite en cours.

Sur desktop, la navigation est laterale ; sur mobile, elle passe en bas de l'ecran et respecte les zones reservees par le systeme. Les operations recentes sont ouvrables directement et `Tout voir` donne acces a la liste complete.

Les tokens et composants Material UI sont configures dans `src/theme.ts` ; les dispositions adaptatives sont dans `src/styles.css`. Les bibliotheques React et Material sont generees dans des fichiers separes pour permettre leur mise en cache.

## Types d'operations

Le formulaire propose `Depense`, `Revenu` et `Virement interne`. Le montant se saisit positif ; le type determine son signe dans le fichier HomeBank. Un virement selectionne un compte debite et un compte credite distincts, parmi les comptes actifs. Entre devises differentes, le montant du compte lie se saisit aussi explicitement.

Les deux operations d'un virement sont creees ou modifiees dans une seule sauvegarde locale et une seule revision Drive. Elles conservent une cle `kxfer` commune, les comptes reciproques et les indicateurs HomeBank (`OF_INTXFER`, `OF_INCOME`, `OF_ADVXFER`). Les statuts pointe/rapproche sont independants pour chaque compte ; l'annulation porte sur les deux operations. Modifier la date met a jour les deux dates ; sinon les dates distinctes d'un virement importe sont conservees. Transformer un virement en depense/revenu retire sa contrepartie.

Les ventilations et les virements importes incomplets, ambigus ou lies a un compte desactive conservent leur structure : leurs montants, comptes et type ne sont pas modifiables.

## Operations planifiees

L'onglet `Planifiees` et le bouton `Planifications` du tableau de bord ouvrent la consultation des planifications actives du fichier HomeBank. Les comptes desactives sont exclus ; les modeles sans recurrence active ne sont pas affiches.

- La synthese affiche les revenus, depenses et flux net prevus sur le reste du mois, les 30 ou les 90 prochains jours, jour courant inclus. Les filtres compte, type et recherche s'appliquent aussi a cette synthese.
- La comparaison `Par compte` permet d'ouvrir directement les previsions d'un compte. Les devises differentes sont totalisees separement, sans conversion ni addition entre devises.
- L'onglet `Echeancier` presente les occurrences de la periode, regroupees par compte et triees par date. Les planifications dont la prochaine date est passee sont consultables dans une section distincte `en retard` ; leurs echeances passees sont exclues des totaux de la periode.
- L'onglet `Recurrences` montre une ligne par planification et par compte concerne, meme si sa prochaine echeance est hors periode. Le detail donne les dates, la frequence, la limite restante, le report week-end, le tiers, le memo et le numero de paiement.
- Les virements sont exclus des revenus/depenses et affiches comme flux entrants/sortants des comptes concernes. Le flux net les inclut ; un virement entre deux comptes de meme devise s'annule dans la vue generale. Le nombre d'echeances compte les mouvements par compte : un virement visible dans ses deux comptes compte donc deux lignes.

Les champs `recflg`, `nextdate`, `every`, `unit`, `limit`, `weekend`, `gap`, `ordn` et `wkdy` sont interpretes suivant `../homebank-5.10.3/src/hb-template.h`, `hb-template.c` et `hb-xml.c`. Les flags historiques de recurrence anterieurs a HomeBank 5.9 sont aussi lus. Les calculs calendaires utilisent [Temporal.PlainDate](https://tc39.es/proposal-temporal/docs/plaindate.html) via `@js-temporal/polyfill`. Une fois l'application et le portefeuille charges, la consultation ne demande aucun acces reseau supplementaire et reste disponible hors ligne.

Cette premiere version est strictement en lecture seule : pas de creation, edition, suppression, saut d'echeance ni comptabilisation automatique. Les previsions ne changent pas les soldes existants. Les noeuds XML `<fav>` restent conserves tels quels, y compris les attributs non reconnus, les prochaines dates et les limites. Une recurrence invalide ou une projection historique trop longue est signalee comme prevision incomplete plutot que consideree comme une prevision fiable.

## Google Drive

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

Ce MVP utilise le flux navigateur Google Identity Services avec le scope Drive non sensible `https://www.googleapis.com/auth/drive.file`. Ce scope limite l'acces aux fichiers choisis par l'utilisateur via Google Picker.

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

### Configuration locale

Creer un fichier `.env.local` depuis `.env.example` :

```bash
cp .env.example .env.local
```

Puis renseigner :

- `VITE_GOOGLE_CLIENT_ID` : client OAuth Web Google Cloud.
- `VITE_GOOGLE_API_KEY` : cle API avec Google Picker / Drive API activees.
- `VITE_GOOGLE_APP_ID` : numero du projet Google Cloud, optionnel si le client ID commence par ce numero.

Dans Google Cloud, activer Google Drive API et Google Picker API, puis autoriser l'origine JavaScript de l'application, par exemple `http://localhost:5173` en developpement.

## Lancement

```bash
npm install
npm run dev
```

Puis ouvrir l'URL Vite affichee dans le terminal.

## Build

```bash
npm run build
```

## Tests

Utiliser Node.js 22.12 ou plus recent pour les outils de test.

```bash
npm test
npx playwright install chromium
npm run test:e2e
```

Les tests unitaires couvrent les soldes, les types d'operations, les liens de virements et leur export XML, les dates locales, la persistance IndexedDB, les erreurs OAuth, l'expiration des jetons, les reprises Drive et le cache PWA. Les tests Playwright couvrent l'import, les comptes actifs, les dates sans chevauchement, les themes, la creation des trois types, l'edition d'un virement depuis le compte credite, le pointage, le rapprochement, l'export/reimport, la restauration apres refresh, l'indicateur hors ligne et la reconnexion sans perte du brouillon, aux formats desktop et mobile. Ils utilisent des donnees fictives et des reponses Drive/OAuth simulees ; ils ne se connectent pas a un compte Google. Les parcours Drive necessitent une configuration Google non vide dans le build (des valeurs fictives suffisent pour ces tests).

Les parcours sont aussi verifies sur un petit ecran de 320 pixels. Pour les executer sur le build de production :

```bash
npm run build
E2E_PREVIEW=1 npm run test:e2e
```

## Architecture

- `src/App.tsx` : navigation et composition des ecrans.
- `src/theme.ts` : theme Material UI (couleurs, typographie, boutons, champs et etats interactifs).
- `src/components/` : tableau de bord, soldes, ligne et formulaire d'operation.
- `src/hooks/useWallet.ts` : integration du portefeuille avec React.
- `src/hooks/useWalletSelectors.ts` : index, recherche et soldes derives, memorises.
- `src/lib/models.ts` : types du domaine et portefeuille vide.
- `src/lib/homebank.ts` : import/export XML, dates, devises et calculs de soldes.
- `src/lib/wallet.ts` : types d'operations, creation/edition atomique des virements, tiers, categories et operations recentes.
- `src/lib/walletController.ts` : restauration et file de sauvegarde, independantes de React.
- `src/lib/storage.ts` : persistance atomique du portefeuille, du fichier Drive et de l'etat de synchronisation.
- `src/lib/googleDrive.ts` : adaptateur OAuth, Picker et API Drive.

Le detail de l'analyse et des corrections figure dans [CODE_REVIEW.md](CODE_REVIEW.md).

Une modification est d'abord enregistree dans IndexedDB avec un indicateur de synchronisation en attente, puis envoyee a Drive. L'indicateur n'est retire qu'apres une sauvegarde reussie. Au refresh, une copie locale avec des modifications en attente est restauree sans etre remplacee par Drive ; la reprise automatique tente d'envoyer cette copie. Sans modifications en attente, la restauration tente de renouveler l'autorisation sans ecran de consentement et recharge le fichier distant. Si Google exige une action, `Reconnecter Drive` reprend le meme fichier. Les jetons OAuth restent uniquement en memoire.

## Perimetre volontairement limite

- Les splits sont parses et re-exportes, mais pas encore editables.
- Les champs structurels des operations ventilees et des virements incomplets, ambigus ou lies a un compte desactive restent verrouilles pour conserver leur coherence.
- Les regles d'affectation, modeles, operations planifiees et filtres sont conserves comme noeuds XML bruts.
- Les montants utilisent encore `number`, comme le code C existant. Une etape ulterieure devrait passer en decimal strict ou entier en unite minimale.
- Les comptes fermes HomeBank sont conserves dans le fichier exporte, mais masques dans l'interface.
- La synchronisation est serialisee dans une instance de l'application. La detection des conflits entre plusieurs appareils ou onglets n'est pas encore implementee.
- Les totaux globaux supposent des comptes dans une meme devise ; aucune conversion de devises n'est encore appliquee.

## Fichiers principaux

- `src/lib/models.ts` : modele TypeScript.
- `src/lib/homebank.ts` : parseur XML, serializer XML, dates HomeBank et soldes.
- `src/lib/storage.ts` : persistance IndexedDB.
- `src/App.tsx` : navigation SPA et composition des composants.
- `src/styles.css` : interface mobile/desktop.
- `public/manifest.webmanifest` et `public/sw.js` : enveloppe PWA minimale.
