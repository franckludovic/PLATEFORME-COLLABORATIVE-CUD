# Corrections apportées au projet CUD Collab

Ce document liste les corrections faites lors de la relecture du projet, puis les
points restants qui demandent une décision (non modifiés).

## Corrections critiques

1. **Route `/api/data` absente sur Vercel** — toutes les lectures et écritures de
   l'interface passaient par `/api/data`, qui n'existait que dans `server.js`.
   Ajout de `api/data.js` (lecture, écriture, suppression), équivalent de
   `handleDataRequest` de `server.js`.
2. **SDK Supabase introuvable en production** — `/api/supabase-sdk` lisait
   `node_modules` à l'exécution ; Vercel ne fournit pas ce fichier, donc
   l'authentification échouait. Le SDK est maintenant chargé depuis jsDelivr
   (version 2.117.3, celle de `package-lock.json`). `api/supabase-sdk.js` a été supprimé.
3. **Fuite de secrets sur le serveur local** — `server.js` servait n'importe quel
   fichier du dossier, dont `.env`. Les fichiers cachés, `api/`, `server.js`,
   `package*.json`, `*.sql` et `*.md` ne sont plus servis.
   `.vercelignore` exclut désormais `.env`, `.env.*`, `.claude/`, `.vscode/`
   et les fichiers de développement.
4. **Injection HTML (XSS)** — noms, rôles, messages, sujets, commentaires, noms
   de fichiers et notifications étaient insérés tels quels dans le HTML.
   Toutes ces valeurs passent par `esc()`. Les liens de pièces jointes passent
   par `safeUrl()` (seuls `http(s)`, chemins relatifs et images `data:` sont acceptés).
5. **Suppression d'une direction refusée** — le serveur n'autorisait la
   suppression que pour `users`. Les administrateurs peuvent maintenant supprimer
   des directions (contrôle admin conservé).

## Corrections fonctionnelles

6. **Directions non sauvegardées** — création, modification et suppression de
   direction ne touchaient que la mémoire de la page. Elles sont enregistrées dans Supabase.
7. **Chef de direction incohérent** — le champ stockait le *nom* alors que
   l'affichage comparait des *identifiants*. Le champ stocke désormais l'identifiant.
8. **Faux messages de succès** — « enregistré en base » s'affichait même en cas
   d'échec. Sujets, commentaires, réunions et fichiers attendent maintenant la
   réponse du serveur et annulent l'ajout local en cas d'échec.
9. **Alerte générale non enregistrée** — elle est maintenant sauvegardée en base.
10. **Visioconférence** :
    - une tuile vidéo locale était créée pour chaque participant, avec des `id` en double ;
    - l'interrogation de la signalisation n'était jamais arrêtée à la fin de l'appel.
11. **Bouton « Copier l'email »** — il affichait « Email copié » sans rien copier.
    Il copie maintenant réellement dans le presse-papiers.
12. **Bouton « Message » de l'annuaire** — ouvrait toujours la conversation n° 1.
    Il ouvre la conversation avec la personne concernée.
13. **Limite de taille des pièces jointes** — `api/_shared.js` acceptait 6 Mo,
    alors que Vercel refuse au-delà de 4,5 Mo. Limite alignée sur 4,5 Mo.
14. **Lecture du stockage Blob** — une erreur de lecture était traitée comme un
    stockage vide, ce qui pouvait écraser les données. L'erreur remonte désormais.
15. **Corps de requête déjà lu par Vercel** — `readJsonBody` attend maintenant
    `req.body` si Vercel l'a déjà analysé (sinon la requête pouvait rester bloquée).
16. **Code mort supprimé** — stub `CUDDB` (no-op) et formulaire de connexion
    fantôme dont les boutons appelaient des fonctions inexistantes.

## Décisions prises sur les points restants

Ces choix remplacent la liste « points restants » de la version précédente.

- **Messagerie** — un message = une ligne dans `chat_history` (ajout seul, pas de
  réécriture de tout l'historique). Les conversations et messages privés ne sont
  visibles que par leurs participants et les administrateurs (règles RLS, fichier
  `supabase-migration-2026.sql`). Les forums, réunions, fichiers et notifications
  restent partagés entre tout le personnel connecté : c'est l'usage voulu d'une
  plateforme collaborative.
- **Fichiers et photos** — stockés dans Vercel Blob (plus de base64 dans la base).
  La base ne garde que les métadonnées et l'URL. Limite : 4,5 Mo par fichier
  (limite Vercel). Les anciens fichiers en base restent téléchargeables.
  Les photos de profil sont redimensionnées (512 px) avant envoi.
- **Accès aux envois** — `upload-attachment`, `upload-profile`, `signal`,
  `signals` et `ice-servers` exigent une session Supabase valide (`api/_auth.js`).
  Les types de fichiers acceptés incluent désormais zip, rar, 7z, pptx et txt.
- **Écritures ciblées** — chaque action n'enregistre que l'élément modifié, au lieu
  de renvoyer toute la collection. Cela réduit les écrasements entre utilisateurs.
- **Suppressions réelles** — les boutons « Réinitialiser » suppriment les lignes
  en base (réservé aux administrateurs) au lieu de ne vider que l'affichage.
- **Sauvegarde** — le bouton produit un export JSON téléchargeable (sans les
  fichiers ni les photos). La sauvegarde complète reste du ressort de Supabase
  (Database → Backups) : le bouton ne prétend plus faire ce qu'il ne fait pas.
- **Calendrier** — construit à partir des réunions réelles, avec navigation
  mois précédent / suivant.
- **Visioconférence** — les serveurs ICE viennent de `/api/ice-servers`. Pour une
  connexion fiable derrière certains réseaux, configurer un serveur TURN via
  `TURN_URLS`, `TURN_USERNAME` et `TURN_CREDENTIAL`. Le libellé « chiffrée »
  est remplacé par « Connexion chiffrée (WebRTC) ».
- **Colonnes** — `users.tel` et `directions.head` sont ajoutées par la migration.

## À faire côté Supabase / Vercel

1. Exécuter `supabase-auth-setup.sql` (si pas déjà fait), puis `supabase-migration-2026.sql`.
2. Vérifier que `conversations.participants` contient des identifiants numériques
   (tableau ou JSON). Si c'est du texte, adapter `cud_is_participant`.
3. Dans Vercel, définir `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BLOB_READ_WRITE_TOKEN`
   (et `TURN_*` si un serveur TURN est disponible).
4. Limites connues : la signalisation vidéo passe par un fichier partagé (scrutation),
   suffisant pour des petits groupes ; au-delà, prévoir un service temps réel.
   Les fichiers supprimés ne sont pas retirés du Blob (coût négligeable, nettoyage possible).
5. `PLATEFORME COLLABORATIVE CUD.html` est une ancienne copie de démonstration
   (redirige vers `index.html`) ; elle peut être supprimée.

## Chargements et gestion des erreurs (version complète)

- **Indicateur de chargement** sur toutes les actions qui parlent au serveur :
  démarrage, connexion (utilisateur et administrateur), création de compte, envoi
  de fichiers et de pièces jointes, publication de sujets et de commentaires,
  réunions, profils, comptes et directions, suppressions, export, déconnexion et
  démarrage de la visioconférence. Plusieurs actions simultanées sont comptées :
  l'indicateur ne disparaît qu'à la fin de la dernière.
- **Délai maximum de 20 secondes** pour chaque requête. Au-delà de 8 secondes, le
  message indique que le serveur répond lentement.
- **Messages d'erreur clairs** : réseau indisponible, délai dépassé, session
  expirée, réponse inattendue du serveur, refus du serveur (avec son message).
- **Un seul message d'erreur par enregistrement**, avec le nom de la section concernée
  (forums, comptes, fichiers, réunions...). Les messages détaillés restent dans la console.
- **Suppressions en masse** : un seul message récapitulatif si certaines lignes échouent.

## Visioconférence de groupe, liens d'invitation et TURN Cloudflare

- **Lien d'invitation** pour chaque réunion visio : code aléatoire de 10 caractères,
  lien du type `…/?join=CODE`. Le destinataire se connecte, puis rejoint directement
  la réunion. Les liens expirent le lendemain de la date de la réunion (24 h après une
  réunion immédiate). Bouton « Lien » dans la liste des réunions et dans la salle d'appel.
- **Groupe jusqu'à 6 personnes** : chaque participant se connecte directement aux autres.
  Au-delà de 6, un avertissement s'affiche (la qualité peut baisser).
- **Signalisation** via Supabase Realtime (canal par réunion, présence des participants)
  à la place des fichiers partagés par scrutation : plus de conflits d'écriture.
- **Relais TURN Cloudflare** : `/api/ice-servers` demande des identifiants temporaires à
  Cloudflare avec la clé API côté serveur. Sans clé ou en cas d'erreur, la visio reste
  possible en connexion directe (STUN).
- **Contrôles** : micro et caméra fonctionnels, bouton de copie du lien, départ de la réunion.
- **Limites** : le lien d'invitation donne accès à la réunion jusqu'à son expiration à
  toute personne connectée à CUD Collab qui le possède. Les appels à plus de 6 personnes
  nécessiteraient un serveur média (SFU).
