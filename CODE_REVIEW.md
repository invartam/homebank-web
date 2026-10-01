# Analyse et refactor du MVP

Analyse du code React/TypeScript du MVP et comparaison des attributs XML avec `../src/hb-xml.c` du client HomeBank. Le client fourni utilise du C avec GTK/GLib.

## Constats et corrections

| Priorite | Constat initial | Correction |
| --- | --- | --- |
| Haute | Deux modifications rapproches pouvaient envoyer des snapshots concurrents a Drive, le plus ancien pouvant terminer en dernier. | File unique dans `src/lib/walletController.ts`, mutations appliquees au dernier portefeuille disponible et sauvegardes ordonnees. |
| Haute | Apres un echec Drive, un refresh ou une reconnexion pouvait remplacer les modifications locales par le fichier distant. | Etat `pendingDriveSave` persiste avec le portefeuille ; restauration locale prioritaire si des modifications restent en attente. |
| Haute | Le service worker mettait en cache tous les GET, y compris les reponses Google Drive authentifiees. | Cache limite aux ressources de l'application sur la meme origine, exclusion des requetes authentifiees et des fichiers de donnees ; lecture Drive avec `cache: no-store`. |
| Haute | IndexedDB annoncait le succes d'une requete avant la validation de la transaction ; portefeuille et reference Drive etaient enregistres separement. | Une transaction pour la session complete, succes sur `oncomplete`, gestion des erreurs et rollback en cas d'exception. |
| Moyenne | Une date effacee dans le formulaire produisait `NaN` puis une erreur de rendu. | Etat de saisie distinct du modele, date et montant obligatoires, validation avant mutation. |
| Moyenne | Le calcul du jour courant utilisait la date UTC, incorrecte autour de minuit local. | Date construite avec les composantes du calendrier local. |
| Moyenne | Les memos vides des splits etaient supprimes, decalant les memos suivants. Les sauts de ligne pouvaient aussi etre normalises a l'export XML. | Positions des memos conservees et caracteres de controle encodes dans les attributs XML. |
| Moyenne | Le parseur acceptait des nombres invalides et ne retrouvait pas les tags definis apres les operations. | Validation des attributs numeriques et lecture des tags avant les operations. |
| Moyenne | Une operation annulee pouvait etre reactivee par le bouton Rapprocher. | Actions rapides masquees pour les operations annulees ; exclusion des operations annulees des listes recentes. |
| Moyenne | Le formulaire simple permettait de modifier les montants ou comptes de virements/ventilations sans mettre a jour les donnees associees. | Virements traites par paire atomique avec comptes reciproques et cle `kxfer` commune. Structures ventilees ou virements incomplets/ambigus verrouilles. |
| Moyenne | Les dates completes debordaient de leur colonne mobile dans les dernieres operations. | Colonne ajustee a la largeur du contenu et test navigateur mesurant le debordement reel. |
| Faible | Une fermeture de popup OAuth pouvait laisser une promesse en attente indefiniment. | Callback d'erreur OAuth et delai maximal ; restauration avec le prompt silencieux `none`. |
| Faible | Un filtre de compte ou un brouillon pouvait rester associe a l'ancien fichier apres import. | Navigation, recherche, filtre et brouillon reinitialises au changement de portefeuille. |

## Structure retenue

`App.tsx` a ete reduit de 948 a 274 lignes : il compose les ecrans et gere la navigation. Les composants visuels sont dans `src/components/`. Le modele du domaine est separe dans `src/lib/models.ts`.

`useWalletSelectors` construit les index et les soldes derives. Les trois soldes de chaque compte sont calcules en un seul parcours des operations, puis reutilises sur les ecrans. Cela remplace les filtrages repetes pour chaque compte a chaque rendu.

`WalletController` orchestre les actions par une file et recoit ses dependances de stockage/Drive par injection. Il est testable sans React et ne connait pas le DOM. `useWallet` adapte cet etat a React avec `useSyncExternalStore` et une initialisation idempotente pour StrictMode.

La base IndexedDB existante et ses cles `current` / `drive-file` sont conservees. La nouvelle cle `drive-pending` est optionnelle lors de la lecture des anciennes donnees. Les jetons ne sont pas persistes. Aucun framework de gestion d'etat ou backend n'a ete ajoute.

Le controleur expose maintenant un etat de connexion Drive et sa reprise est declenchee par le hook React au retour du reseau / premier plan et par un controle periodique. Les reprises utilisent la meme file que les modifications, sans verrouiller le formulaire pendant une tentative en arriere-plan. Les erreurs temporaires ont un backoff ; les erreurs OAuth necessitant une action et les erreurs permanentes suspendent les reprises automatiques. Les modifications locales en attente sont toujours prioritaires et envoyees sans telechargement prealable. Les jetons ont une expiration en memoire ; un echec de confirmation IndexedDB apres upload ne declenche pas une boucle de nouvelles revisions.

## Verification

Le fichier Drive memorise est verifie par ses metadonnees avant lecture/sauvegarde et periodiquement quand la page est visible. Les erreurs HTTP 404 et les fichiers dans la corbeille suspendent la synchronisation avec un etat distinct `file-missing`, sans supprimer le portefeuille local. Le changement de fichier est explicite, protege les modifications non synchronisees par une confirmation avec export, et ne remplace la session qu'apres validation et persistance du nouveau portefeuille.

- Build de reference avant refactor et build TypeScript/Vite apres refactor.
- Tests Vitest : soldes, limites de decouvert, calendrier local, XML, tiers/numero/memo, categories, transactions IndexedDB, restauration, concurrence, erreurs de sauvegarde, OAuth et cache PWA.
- Tests Playwright : parcours desktop et mobile dans Chromium, ajout/edition/pointage/rapprochement puis refresh, avec verification du contenu restaure.
- Verification visuelle des captures desktop/mobile et controle des largeurs et chevauchements.
- Toutes les donnees des tests sont fictives ; les adaptateurs Drive/OAuth sont simules. Aucun fichier bancaire reel n'est modifie et aucune sauvegarde vers le compte Google de l'utilisateur n'est executee par les tests.

## Limites restantes

1. **Conflits entre appareils/onglets.** La file protege une instance uniquement. Un autre client peut modifier le fichier Drive entre deux sauvegardes. Etape suivante : version distante, detection de conflit et decision de fusion avant remplacement.
2. **Devises multiples.** Les totaux additionnent encore les montants bruts sans conversion. Les soldes individuels gardent leur devise ; les totaux doivent etre convertis ou regroupes par devise avant un usage multidevise.
3. **Precision monetaire.** Le domaine utilise toujours `number`. La migration vers des unites minimales ou des decimaux doit etre accompagnee de tests de compatibilite import/export.
4. **Formats XML et extensions.** Le parseur couvre les champs HomeBank 5.10.3 actuellement modelises. Il ne garantit pas la conservation de nouveaux attributs/noeuds d'une version future, ni une compatibilite avec tous les fichiers historiques.
5. **Edition avancee.** L'edition complete des ventilations et des operations planifiees reste a implementer. Les depenses, revenus et virements internes sont desormais pris en charge ; les structures de virements incompletes ou ambigues restent protegees.
6. **Authentification et appareils reels.** La reconnexion silencieuse depend du navigateur et du compte Google. Les tests mobile utilisent une emulation Chromium ; un essai Safari sur iPhone et Chrome sur Android avec le compte de test reste necessaire pour valider OAuth/Picker sur appareils reels.

References API utilisees : [Google Identity Services](https://developers.google.com/identity/oauth2/web/reference/js-reference), [Drive files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update).
