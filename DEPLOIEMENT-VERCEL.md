# Déploiement de CUD Collab sur Vercel

## Ce qui a été fait

Le projet d'origine était un **serveur Node classique** (`server.js`) qui écrivait
des fichiers sur le disque. Vercel est une plateforme **serverless** : le disque y
est **en lecture seule**. Le serveur d'origine n'aurait donc pas pu y fonctionner
(les uploads auraient échoué et les données auraient été perdues).

Le backend a été converti en **fonctions serverless** :

| Ancienne route (`server.js`) | Nouvelle fonction serverless |
| --- | --- |
| `GET /` + fichiers statiques | `index.html` + `images/` (servis par Vercel) |
| `POST /api/upload-profile` | `api/upload-profile.js` |
| `POST /api/upload-attachment` | `api/upload-attachment.js` |
| `POST /api/signal` | `api/signal.js` |
| `GET  /api/signals?room=` | `api/signals.js` |
| `GET / POST / DELETE /api/data?table=` | `api/data.js` (lecture, écriture, suppression Supabase) |

Fichiers de support (Vercel ne les expose pas comme routes, grâce au préfixe `_`) :

- `api/_shared.js` — réponses JSON, lecture du corps de requête
- `api/_records-store.js` — stockage (Vercel Blob ou `/tmp` en local)

Le serveur local `server.js` **est conservé** : `npm start` fonctionne toujours
pour développer sur votre poste.

---

## Étape 1 — Créer un stockage Blob (obligatoire pour la persistance)

Sans cela, les images et pièces jointes uploadées **ne seront pas conservées**.

1. Connectez-vous sur [vercel.com](https://vercel.com) puis ouvrez votre projet.
2. Onglet **Storage** → **Create Database** → **Blob**.
3. Nommez-le (ex. `cud-collab-blob`) puis créez-le et **connectez-le au projet**.
4. Vercel ajoute automatiquement la variable d'environnement
   `BLOB_READ_WRITE_TOKEN`.

> Pour le développement local, récupérez ce jeton dans **Settings → Environment
> Variables** et placez-le dans un fichier `.env.local` :
> ```
> BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxx
> ```

---

## Étape 2 — Déployer

### Option A — Via GitHub (recommandée)

1. Poussez le projet sur GitHub :
   ```powershell
   git init
   git add .
   git commit -m "Plateforme collaborative CUD - prête pour Vercel"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/<votre-repo>.git
   git push -u origin main
   ```
2. Sur Vercel : **Add New → Project → Import Git Repository**, choisissez le dépôt.
3. Framework Preset : **Other** (projet statique + fonctions `api/`).
   Ne modifiez ni la racine ni la commande de build.
4. Cliquez sur **Deploy**.

### Option B — En ligne de commande

```powershell
npm install -g vercel
vercel login
vercel          # prévisualisation
vercel --prod   # production
```

Ou simplement :

```powershell
npm run deploy
```

---

## Étape 3 — Tester en ligne

Après déploiement, vérifiez :

- `https://<votre-projet>.vercel.app/` → la plateforme s'affiche
- `https://<votre-projet>.vercel.app/api/signals?room=test` → doit répondre `[]`
- Modifiez votre photo de profil → l'image doit s'afficher (URL Blob)
- Envoyez une pièce jointe → elle doit rester accessible

---

## Points d'attention

- **Persistance** : assurée uniquement si **Blob est connecté**. Sans le jeton,
  l'app démarre mais rien n'est conservé.
- **Taille des fichiers** : limite de **4,5 Mo** par requête sur Vercel
  (fonctions serverless). Les vidéos volumineuses échoueront ; prévoyez
  [l'upload direct navigateur → Blob](https://vercel.com/docs/storage/vercel-blob/client-upload)
  si vous devez envoyer de gros fichiers.
- **Visio (WebRTC)** : le mécanisme d'échange de signalisation fonctionne, mais
  il repose sur un stockage partagé lu par scrutation. Pour une visio à
  plusieurs participants en production, un service de signalisation dédié
  (WebSocket temps réel) sera plus fiable.
- **Données utilisateurs** : la plateforme est aujourd'hui mono-navigateur
  (pas de backend de comptes). Le stockage Blob est **public** : n'y placez pas
  de données sensibles.

---

## Dépannage — « le chargement des fichiers échoue »

### Étape 0 — Diagnostic obligatoire : lire le message exact

Le message du navigateur est générique (`Upload failed`, `Failed to fetch`,
`Function Invocation Failed`). La vraie cause est toujours dans :

1. **Au build** : `Vercel → Deployments → cliquez sur le déploiement → onglet Building`
2. **À l'exécution** : `Vercel → votre projet → onglet Logs → Functions`

Sans ce message, on ne peut que deviner — d'où les 5 causes ci-dessous.

### Cause 0 ter — Page « Not found » à la racine

**Symptôme :** en ouvrant le lien, on obtient `Not found` — et **non** la
plateforme.

**Ce que ce message signifie :** Vercel cherche un fichier pour l'URL `/` et
n'en trouve aucun.

**Vérification faite :** le mot « Not found » n'existe **nulle part** dans
`index.html` — il vient donc bien de Vercel. `index.html` est présent (187 419
octets), suivi par Git, et servi correctement en local
(`GET / → HTTP 200`, titre « CUD Collab — Plateforme Collaborative »).

**Deux hypothèses, par ordre de probabilité :**

**A. Le projet Vercel pointe vers le mauvais dossier.** C'est la cause la plus
fréquente de « Not found ». Si Vercel regarde
`APPLICATIONS 2026 ING DP-DIVCOM-UCREA` au lieu de
`PLATEFORME COLLABORATIVE CUD`, il ne voit ni `index.html` ni `api/`.
→ **Settings → General → Root Directory** : indiquez
`PLATEFORME COLLABORATIVE CUD`, puis **redéployez** (changer ce réglage ne
redéploie pas automatiquement).

**B. `server.js` a été déployé malgré `.vercelignore`.** Le message exact
« Not found » correspond **caractère pour caractère** à la réponse 404 du
serveur local (`server.js`, ligne 84). Si `server.js` est présent à la racine
du déploiement, Vercel le lance comme fonction et renvoie sa page 404.
→ Vérifiez **Deployments → onglet Source** : `server.js` ne doit **pas** y
figurer. Si c'est l'inverse, renommez-le (voir la règle ci-dessous).

**Redirection explicite ajoutée :** `vercel.json` contient désormais
`rewrites` racine → `/index.html`. Le routage ne dépend plus de la détection
automatique de Vercel.

> **Règle de nommage Vercel :** tout fichier `.js` à la **racine** (hors
dossier `api/`) peut être exécuté comme fonction. Pour du statique pur, la
racine ne doit contenir **aucun** fichier `.js`. Seul `server.js` est toléré,
car `.vercelignore` l'exclut — mais si un doute subsiste, renommez-le
`server.js.local`.

### Cause 0 bis — `500 FUNCTION_INVOCATION_FAILED` (page d'erreur au chargement)

**Symptôme :**
```
500: FUNCTION_INVOCATION_FAILED
```

**Cause :** le nom de l'erreur contient « FUNCTION ». Vercel **exécutait une
fonction serveur** au lieu de servir le statique — d'où le plantage.

Deux fichiers déclenchaient cela :

1. **`package.json` contenait `"main": "index.html"`.** En présence d'un
   `package.json`, Vercel considère le projet comme une application **Node** et
tente de démarrer un point d'entrée. Or `index.html` n'est pas du JavaScript :
l'invocation échoue immédiatement. **Champ supprimé.**
2. **`index.js`** — un fichier vide exportant `module.exports = {}`, ajouté par
erreur comme « point d'entrée de détection ». Il était **exécuté comme fonction
serverless**, sans aucune gestion de requête → `500`. **Fichier supprimé.**

> **Règle à retenir :** ne créez **jamais** de fichier `index.js` à la racine
> d'un projet déployé sur Vercel. Vercel le traite toujours comme le point
> d'entrée d'une fonction et l'exécute.

**Configuration correcte** — un projet statique + des fonctions dans `api/`
ne doit **ni** avoir de `"main"` dans `package.json`, **ni** de `index.js` :

```
À la racine :    index.html, images/, api/, package.json (sans "main")
API serverless : package.json + fichier index.js DANS api/  (pas à la racine)
```

### Cause 0 — Déclaration JavaScript en double (erreur de build)

**Symptôme :**
```
Error: Build failed with 1 error:
[PARSE_ERROR] Error: Identifier `sendJson` has already been declared
```

**Cause :** `server.js` déclarait `sendJson` **deux fois** (lignes 15 et 20).

**Pourquoi Vercel le voyait alors que `.vercelignore` liste `server.js` :**
`.vercelignore` empêche l'envoi du fichier pour les **fichiers statiques** et
l'exécution, mais l'analyse de build peut tout de même parcourir la racine du
projet. Le doublon a donc été détecté malgré l'exclusion.

**Correctif appliqué :** suppression de la seconde définition dupliquée.
Vérifié ensuite : une seule déclaration, `node --check server.js` valide, et
les routes `GET /`, `GET /api/signals`, `POST /api/signal` répondent toutes
`HTTP 200`.

> **À retenir :** ne corrigez pas ce genre d'erreur en retirant la ligne du
> message d'erreur seule. Vérifiez toujours le fichier entier, puis revalidez
> avec `node --check <fichier>`.

### Cause 1 — `vercel.json` invalide (corrigé)

Le fichier contenait deux directives problématiques :

- `"rewrites"` avec une source identique à la destination
  (`/uploads/attachments/:file` → `/uploads/attachments/:file`) : **boucle infinie**
  de redirection au mieux, erreur de configuration au pire.
- `"buildCommand": null` : valeur non standard.

Ces deux blocs ont été **supprimés**. Ne les remettez pas.

### Cause 2 — `node_modules/` envoyé avec le projet

Le projet n'avait **aucun `.gitignore`** : les 1,6 Mo de `node_modules` partaient
sur GitHub, ce qui ralentit fortement l'upload (et peut le faire échouer).

Un `.gitignore` a été créé. Si l'upload avait déjà échoué, nettoyez le suivi :

```powershell
git rm -r --cached node_modules
git rm -r --cached .vercel
git commit -m "Retire node_modules du suivi"
git push
```

> Vercel installe lui-même les dépendances (`npm install`) lors du build.

### Cause 3 — Blob non connecté (cas le plus fréquent)

Si le stockage Blob n'est pas connecté au projet, `upload-profile.js` et
`upload-attachment.js` échouent en `500`, et le message remonté est
« Impossible d'enregistrer la pièce jointe ». Voir **Étape 1** ci-dessus.

### Cause 4 — Fichier trop volumineux

Limite Vercel : **4,5 Mo par requête**. Au-delà, la fonction est rejetée avant
même d'être exécutée. Vérifiez après miniaturisation si le fichier est lourd.

### Cause 5 — Déployer depuis un sous-dossier

Si Vercel pointe sur `E:\APPLICATIONS 2026 ING DP-DIVCOM-UCREA` au lieu du dossier
`PLATEFORME COLLABORATIVE CUD`, il ne trouvera ni `index.html` ni `api/`.
Corrigez dans **Settings → General → Root Directory** : indiquez
`PLATEFORME COLLABORATIVE CUD`.

### État du dépôt Git (vérifié)

```
Branche : main
Commit  : "Plateforme collaborative CUD prete pour Vercel"
Fichiers suivis : 19 (node_modules exclu)
```

Il ne reste qu'à rattacher le dépôt distant :

```powershell
git remote add origin https://github.com/<votre-compte>/<votre-repo>.git
git push -u origin main
```

Puis sur Vercel : **Add New → Project → Import Git Repository**.

---

## Rappel des fichiers ajoutés / modifiés

```
api/
  _shared.js               (nouveau)
  _records-store.js        (nouveau)
  signal.js                (nouveau)
  signals.js               (nouveau)
  upload-profile.js        (nouveau)
  upload-attachment.js     (nouveau)
vercel.json                (nouveau)
.vercelignore              (nouveau)
package.json               (modifié : dépendance @vercel/blob + scripts)
server.js                  (inchangé, pour le développement local)
DEPLOIEMENT-VERCEL.md      (ce guide)
```



---

## Mise à jour : base de données et variables d'environnement

- Exécuter dans Supabase, dans l'ordre : `supabase-auth-setup.sql` puis `supabase-migration-2026.sql`.
- Variables Vercel à définir (Settings → Environment Variables) : `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `BLOB_READ_WRITE_TOKEN`. Optionnel pour la visio :
  `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL`.
- Le détail des changements est dans `CORRECTIONS.md`.

## Visioconférence : liens d'invitation et serveur TURN Cloudflare

- Base de données : sur une base existante, exécuter `sql/4_migration_meetings_links.sql`
  (sur une base recréée, `2_create.sql` contient déjà ces colonnes).
- Variables Vercel (Settings → Environment Variables) pour le relais TURN :
  - `CLOUDFLARE_TURN_KEY_ID` : l'identifiant de la clé TURN (Cloudflare → Realtime → TURN)
  - `CLOUDFLARE_TURN_API_TOKEN` : le jeton API associé
  - `TURN_TTL_SECONDS` (optionnel, 3600 par défaut)
  Ne jamais mettre ces valeurs dans le code ni les partager dans un message : elles
  sont lues uniquement par le serveur (`api/ice-servers.js`).
- Dans le fichier `.env` en local, ajouter les deux premières variables pour tester
  le relais avec `npm start`.
- Le jeton API donne accès à votre compte Cloudflare TURN : s'il a été partagé
  quelque part, le révoquer et en créer un nouveau dans le tableau de bord Cloudflare.
- Test : ouvrir une visio, puis vérifier dans les outils de développement du navigateur
  (onglet Réseau) que `/api/ice-servers` renvoie une entrée `turn:turn.cloudflare.com`.
