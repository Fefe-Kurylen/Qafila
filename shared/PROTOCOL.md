# Qafila — Protocole du relais aveugle et appairage (contrat partagé, v1)

Ce document est la version **exécutable** du chapitre 5 de `COFFRE-SYNC.md` : ce que le module `src/relay/` du
serveur Node accepte et renvoie, ce que les trois clients (iOS, Android, PC) envoient et attendent, et ce que le
relais **ne peut pas** faire. Là où `COFFRE-SYNC.md` est précis, il est repris à l'octet ; là où il laisse une
latitude, la décision est prise ici et marquée **Décision**. Les dérivations cryptographiques (HKDF, AES-GCM,
X25519, bourrage, encodages) sont fixées par `shared/CRYPTO.md` et ses vecteurs `shared/vectors/` ; ce document
ne les rappelle que pour dire **quand** et **à qui** chaque valeur est envoyée.

Fichiers associés :

| Fichier | Rôle |
|---|---|
| `shared/schemas/protocol/*.json` | un JSON Schema (2020-12) par corps de requête et de réponse, pour les deux QR et pour `sync-state.json` |
| `shared/fixtures/protocol/*.json` | échanges complets : cycle de vie d'un coffre, appairage, conflit à deux appareils, révocation |
| `shared/test/protocol.test.mjs` | valide chaque fixture contre son schéma, recalcule le vecteur d'appairage, rejoue la fusion |

> **Décision — emplacement.** `COFFRE-SYNC.md` §9.1 annonçait `shared/sync/PROTOCOL.md` et `shared/schema/`. Le
> dossier `shared/` est resté plat (`PROTOCOL.md`, `CRYPTO.md`, `schemas/`), les schémas du protocole vivent dans
> `schemas/protocol/` pour ne pas se mêler aux schémas de données (`schemas/*.schema.json`), qui restent la source
> des types Swift / Kotlin / TS. Les deux jeux se recoupent sur `envelope` et l'en-tête public ; ils sont identiques
> et le test le vérifie sur les fixtures.

---

## 1. Ce qu'est le relais

Un dépôt **bête, non fiable, en ajout seul** d'enveloppes chiffrées, rangées sous un identifiant de coffre
imprévisible. Il ne connaît ni compte, ni e-mail, ni mot de passe, ni clé. Il sait : combien d'octets occupe un
coffre, quand on lui a parlé pour la dernière fois (au jour), et le `rev` en clair de chaque enveloppe, dont il se
sert pour ne garder que la plus récente par identifiant — règle que les clients **ré-appliquent** après
déchiffrement, puisque le `rev` est dans l'AAD et ne peut être falsifié.

- Module Node/Express `src/relay/`, monté sur **`/sync/v1`** dans le serveur existant (même image Docker),
  publiable seul (`qafila-relay`) pour l'auto-hébergement. Le réglage « Serveur de synchronisation » accepte toute
  URL `https://` ; le client y ajoute `/sync/v1`.
- Stockage **`node:sqlite`** sur un volume persistant (`PRAGMA journal_mode=WAL`, `secure_delete=ON`). Tables de
  `COFFRE-SYNC.md` §5.1 : `vaults`, `records` (`UNIQUE(vaultId, id)`, `serverSeq AUTOINCREMENT`), `pairing`.
  La colonne `pkHash` de `pairing` reçoit le `readProofHash` (§6.4) ; une colonne `commit` et une colonne `state`
  s'y ajoutent.
- **TLS terminé par le relais lui-même**, HSTS (`max-age=31536000`), **aucun CDN ni proxy tiers** devant lui.
- Versionnage : le préfixe `/sync/v1` et le champ `v: 1` des enveloppes évoluent ensemble. Un relais qui ne
  connaît pas un préfixe répond 404 ; un client qui reçoit un champ inconnu dans une **réponse** l'ignore ; le
  relais qui reçoit un champ inconnu dans une **requête** la refuse (§2).

---

## 2. Conventions

- **JSON** partout : requêtes et réponses en `application/json; charset=utf-8`. Réponses avec
  `Cache-Control: no-store`. Pas de cookies, pas de session.
- **Encodages** (alignés sur `CRYPTO.md`) : tout binaire en **base64url sans bourrage** (RFC 4648 §5, décodage
  strict : alphabet url seul, pas de `=`, bits de queue canoniques) ; identifiants, jetons, hachés, engagements et
  preuves en **hexadécimal minuscule** ; horodatages en **millisecondes Unix**, entiers.
- **Strict en entrée** : chaque corps de requête est validé contre son schéma avec `additionalProperties: false`.
  Une enveloppe qui porte une propriété en trop est refusée (`invalid_envelope`) : c'est la seule garantie
  mécanique qu'aucun client ne fera fuir une métadonnée (« deviceName », « title »…) dans la partie en clair.
- **Tolérant en sortie** : les clients ignorent les propriétés inconnues des réponses.
- **Idempotence** : `PUT /vaults/{id}` (même jeton), `POST /changes` (même `rev`), `DELETE` et la lecture du
  paquet d'appairage (après la première, 410) peuvent être rejoués après une coupure réseau sans effet de bord.
- **Taille des corps** : `PUT` coffre et en-tête ≤ 8 Kio ; `POST /changes` ≤ 10 Mio (100 enveloppes de 64 Kio
  en base64url) ; appairage ≤ 48 Kio. Au-delà : 413 `payload_too_large` sans lire le reste.
- Les URL contiennent `vaultId` et `slot` en hexadécimal minuscule ; toute autre forme est 404 (pas de
  normalisation de casse, pour n'avoir qu'une seule orthographe dans les journaux et les clés SQLite).

---

## 3. Authentification

`Authorization: Bearer <jeton>` où le jeton est **64 caractères hexadécimaux minuscules** (32 octets) :

| Jeton | Dérivation (`CRYPTO.md`) | Donne accès à |
|---|---|---|
| **jeton de synchronisation** | `K_sync = HKDF(VMK, "qafila/v1/sync-token")`, envoyé en hex | tout le coffre |
| **jeton de récupération** | `HKDF(RK, "qafila/v1/recovery-auth")`, envoyé en hex | `GET /vaults/{id}/header` **seulement** |

Le relais stocke **`SHA-256` de la chaîne ASCII du jeton tel que reçu** (les 64 caractères, pas les 32 octets
décodés — vecteur `shared/vectors/bearer-token.json`), compare en temps constant, et n'enregistre jamais le jeton.
Un jeton qui n'est pas exactement 64 hex minuscules est refusé avant toute consultation (401).

Règles de réponse, dans cet ordre :

1. coffre inconnu → **404 `vault_not_found`**, quel que soit le jeton. L'identifiant fait 128 bits imprévisibles :
   révéler son inexistence ne révèle rien. Cette règle donne aux autres appareils le bon message après une
   rotation (§8) : ils ne distinguent pas « effacé » de « jamais existé », et n'ont pas besoin de le faire ;
2. coffre connu, jeton égal au jeton de synchronisation → accès complet ;
3. coffre connu, jeton égal au jeton de récupération → `GET header` seulement ; tout autre chemin →
   **403 `forbidden`** ;
4. sinon → **401 `unauthorized`**.

Aucun endpoint anonyme sauf `GET /sync/v1/` (§5.1), et les deux endpoints d'appairage, protégés par la clé
éphémère plutôt que par un jeton (§6).

---

## 4. Identifiants et horloge

### 4.1 Identifiants

- **`vaultId`** : 32 hex (128 bits). Pour le relais, une valeur **opaque et imprévisible** choisie par le client ;
  `CRYPTO.md` la dérive de `K_sync` (`HKDF(K_sync, "qafila/v1/vault-id", 16)`), ce qui garantit qu'un nouveau
  jeton (nouvelle génération de clé) emporte un nouvel identifiant. Le relais ne vérifie aucune relation entre
  les deux : il ne connaît pas `K_sync`.
- **`id`** d'enregistrement : UUID v4 minuscule, aléatoire pour tout (clé de réglage, appareil… à l'intérieur du
  chiffré). Le relais n'en déduit rien.
- **`deviceId`** : 8 hex, uniquement dans le chiffré et dans `sync-state.json`. **Jamais** sur le fil en clair.
- **`slot`** d'appairage : `hex(SHA-256(pkN))`, 64 hex.

### 4.2 Révision `rev` : horloge logique hybride

Format `"<ms, 13 chiffres>-<compteur, 4 hex>-<aléa, 4 hex>"`, ordre total = **comparaison lexicographique des
chaînes** (toutes les parties sont à largeur fixe, donc l'ordre lexicographique est l'ordre numérique). Pas
d'identifiant d'auteur : l'aléa départage deux appareils à la même milliseconde avec le même compteur ; l'auteur
est dans le chiffré.

> **Décision — génération et adoption.** L'état est `hlc: { lastMs, counter }` dans `sync-state.json`.
>
> - **Émettre** : `now = horloge murale` ; si `now > lastMs` alors `lastMs = now, counter = 0`, sinon
>   `counter += 1` ; si `counter` dépasse `ffff`, `lastMs += 1, counter = 0`. `aléa` = 2 octets CSPRNG.
> - **Adopter** : à l'application d'une enveloppe distante `(ms_r, c_r)` acceptée : si `ms_r > lastMs` alors
>   `lastMs = ms_r, counter = c_r` ; si `ms_r == lastMs` alors `counter = max(counter, c_r)`. Ainsi une édition
>   faite **après** avoir vu une version distante porte toujours un `rev` strictement supérieur — y compris à la
>   même milliseconde (fixture `merge-two-devices.json`, étape 5).
> - **Borne** : une enveloppe dont `ms` dépasse `now + 24 h` est **rejetée** avant adoption, côté client
>   (« enveloppe refusée : horloge d'un appareil déréglée ») **et** côté relais (400 `rev_in_future`). L'horloge
>   murale n'est **jamais** corrigée d'après le serveur ; `lastMs` ne peut donc jamais dépasser `now + 24 h`.

---

## 5. Le coffre

### 5.1 Carte d'identité — `GET /sync/v1/`

Sans jeton. Réponse `service-info.json` : `{ service: "qafila-relay", protocol: 1, limits: {…} }`. Le client s'en
sert pour valider l'URL saisie (« Ce serveur n'est pas un relais Qafila ») et afficher les quotas de l'instance.
Un auto-hébergeur peut **relever** les limites, jamais les abaisser sous les valeurs du §7 (les schémas
l'imposent) : un client se fie aux valeurs annoncées pour ses messages, pas pour sa sécurité.

### 5.2 Création — `PUT /sync/v1/vaults/{vaultId}`

Porteur : le **jeton de synchronisation du nouveau coffre**. Corps `vault-create-request.json` :
`{ header, recoveryTokenHash }` — l'en-tête **public** (§5.3) et `hex(SHA-256(jeton de récupération))`. Le relais
ne voit donc le jeton de récupération que le jour où il sert.

| Cas | Réponse |
|---|---|
| nouveau | **201** `vault-create-response.json` (`seq: 0`, `expiresAt`, `usage` à zéro) ; `lastSeenAt` = aujourd'hui |
| existe, même jeton | **200**, même corps ; **l'en-tête stocké n'est pas modifié** (rejeu réseau ; pour changer l'en-tête, §5.3) |
| existe, autre jeton | **409 `vault_exists`** (premier arrivé gagne) |
| `header.vaultId` ≠ chemin, `recoveryTokenHash` égal au haché du porteur, en-tête > 4 Kio, `header.keyGeneration` < 1 | **400 `bad_request`** avec `details.field` |
| 6ᵉ création depuis la même IP dans la journée UTC | **429 `creation_limited`** |

### 5.3 En-tête public — `GET` / `PUT /sync/v1/vaults/{vaultId}/header`

L'en-tête public (`header-public.json` = `vault-header.schema.json#/$defs/public`) ne contient que `v`,
`vaultId`, `createdAt`, `keyGeneration` et le seul emplacement **`recovery`**. Ni emplacement mot de passe (il
reste sur chaque appareil : aucune cible de force brute hors ligne sur le relais), ni emplacement appareil, ni
paramètres KDF, ni `previousKeys`.

- **`GET`** : porteur = jeton de synchronisation **ou** de récupération. Réponse `header-get-response.json` :
  `{ header, seq, expiresAt, usage, via }`, `via ∈ sync | recovery`. C'est le chemin de la **récupération par
  kit** (`COFFRE-SYNC.md` §3.7) : le nouvel appareil scanne ou tape le kit, calcule le jeton de récupération,
  télécharge l'en-tête, désenveloppe VMK avec `HKDF(RK, "qafila/v1/recovery")`, dérive `K_sync`, puis
  synchronise normalement. Le jeton de récupération **ne donne rien d'autre** (403 ailleurs).
- **`PUT`** : porteur = jeton de synchronisation seul. Corps `header-put-request.json` :
  `{ header, recoveryTokenHash? }`. Sert au changement de clé de secours (« Nouvelle clé de secours ») : nouvel
  emplacement `recovery`, nouveau haché. `header.keyGeneration` doit **égaler** celle du coffre (409
  `key_generation_mismatch` sinon) : une nouvelle génération est un **nouveau coffre** (§8), jamais une mise à
  jour. Réponse 200 `header-get-response.json` (`via: "sync"`).

### 5.4 Tirer — `GET /sync/v1/vaults/{vaultId}/changes?since=<seq>&limit=<n>[&wait=<s>]`

Flux **d'état courant** : chaque identifiant apparaît **au plus une fois**, à son dernier `serverSeq` ; une
enveloppe supplantée disparaît du flux (elle est remplacée en place, `UNIQUE(vaultId, id)`). Un client qui part de
`since=0` reçoit donc exactement l'état du coffre, sans historique ni compaction.

- `since` : dernier `seq` connu (défaut 0). `limit` : 1–500 (défaut 500). `wait` : 0–25 s (défaut 0) ; avec
  `wait`, le relais retient la réponse jusqu'à ce qu'une enveloppe de `seq > since` existe ou que le délai expire,
  puis répond normalement (éventuellement vide). **Mobile : jamais `wait`** (pas de connexion maintenue) ;
  PC : `wait=25` en boucle.
- Réponse `changes-get-response.json` : `{ changes: [{ seq, envelope }…], nextSeq, more }`, `changes` trié par
  `seq` strictement croissant ; `nextSeq` = `seq` du dernier élément, ou `since` si vide ; `more` = il en reste.
- Toute requête authentifiée remet `lastSeenAt` au jour courant.

### 5.5 Pousser — `POST /sync/v1/vaults/{vaultId}/changes`

Corps `changes-post-request.json` : `{ changes: [enveloppe…] }`, 1 à 100 enveloppes, identifiants **distincts**
dans le lot. Le lot est **atomique** : tout est validé, puis tout est écrit dans une transaction, ou rien.

Validation de chaque enveloppe, dans l'ordre (la première faute arrête, `details.index` la désigne) :

1. forme exacte `envelope.json` (huit champs, aucun autre) — sinon 400 `invalid_envelope` ;
2. `kg` = `keyGeneration` du coffre — sinon 409 `key_generation_mismatch` (`details.expected / received`) ;
3. `ms(rev) ≤ now + 24 h` — sinon 400 `rev_in_future` ;
4. `décodé(ct)` : longueur `256·k + 16`, `k ≥ 1`, ≤ 65 536 + 16 octets ; `décodé(n)` = 12 octets — sinon 400
   `invalid_envelope` (`details.reason`). Le relais **impose** le bourrage : une taille non multiple de 256 est
   une fuite de métadonnée et un bug client ;
5. quotas (§7) après calcul du delta d'octets et de nombre — sinon 413 `quota_exceeded`.

Puis, par enveloppe, la règle **« plus grand `rev` par `id` »** :

| État du relais pour cet `id` | Résultat | Effet |
|---|---|---|
| absent, ou `rev` stocké < `rev` reçu | `accepted` | écrit, nouveau `seq` (renvoyé) |
| `rev` stocké = `rev` reçu, `ct` identique | `duplicate` | rien (rejeu idempotent) |
| `rev` stocké = `rev` reçu, `ct` différent | `accepted` si le `ct` reçu est le plus grand (décision ci-dessous), sinon `superseded` | idem |
| `rev` stocké > `rev` reçu | `superseded` | rien ; `rev` courant renvoyé |

> **Décision — égalité de `rev`.** Deux appareils peuvent produire le même `rev` pour le même `id` (même
> milliseconde, même compteur, même aléa : 2⁻¹⁶ par milliseconde partagée, `CRYPTO.md` §7.4). Pour que ni le relais
> ni les clients ne divergent, le départage est le même partout : à `rev` égal, on compare les octets **décodés** de
> `ct` (octets non signés, ordre lexicographique ; si l'un est préfixe de l'autre, le plus long est le plus grand) et
> **le plus grand gagne**. `ct` identique ⇒ `duplicate`. Le client applique exactement la même comparaison quand il
> reçoit une enveloppe de `rev` égal à celle qu'il détient ; pour un `login`, le mot de passe perdant est archivé
> comme pour toute autre défaite (§5.7). Le relais ne lit rien de plus : `rev`, puis ces octets opaques.

Réponse `changes-post-response.json` : `{ results: [{ id, status, rev, seq? }…], nextSeq, usage }`, dans l'ordre du
lot ; `seq` présent **si et seulement si** `accepted`. Le relais ne compare jamais deux enveloppes autrement que par
`rev` (puis par les octets de `ct` à égalité) : il ne sait pas ce qu'elles contiennent. Le client qui reçoit
`superseded` retire l'enveloppe de son outbox, **tire**, et laisse la règle de fusion (§5.7) trancher après
déchiffrement — qui aboutit au même gagnant.

> **Décision — pas de `del` dans le flux.** `del` est stocké et renvoyé tel quel ; le relais ne s'en sert que pour
> la purge à 90 jours (§8). Il ne refuse pas une enveloppe `del: true` plus récente qu'une `del: false` ni
> l'inverse : la **résurrection** par édition postérieure est voulue (`COFFRE-SYNC.md` §4.2).

### 5.6 Effacer — `DELETE /sync/v1/vaults/{vaultId}`

Porteur = jeton de synchronisation. Supprime le coffre, ses enregistrements, l'en-tête et les deux hachés ;
**204** sans corps ; rejeu → 404. C'est « **Désactiver la synchronisation et effacer du serveur** » et la dernière
étape d'une rotation (§8). Le client efface ensuite `sync-state.json` et `outbox.jsonl`, garde le coffre local.
Les autres appareils reçoivent 404 et affichent le message du §10.4.

### 5.7 Fusion côté client (rappel, `COFFRE-SYNC.md` §4.2)

Rejouée dans `protocol.test.mjs` sur `merge-two-devices.json` :

- **Dernier écrivain gagne par enregistrement entier**, sur `rev`. Un favori renommé par A et déplacé par B hors
  ligne converge vers la version de B si `rev_B > rev_A` : le renommage de A est **perdu**, pas fusionné champ par
  champ. Les deux appareils aboutissent au même état quel que soit l'ordre d'arrivée.
- **login** : si le perdant avait un autre mot de passe, le client qui détecte le conflit l'ajoute à
  `passwordHistory` du gagnant (10 entrées maximum, les plus anciennes sortent) et **ré-écrit** l'enregistrement
  avec un `rev` neuf (strictement supérieur par la règle d'adoption §4.2). Rien n'est perdu en silence.
- **Idempotence** : appliquer deux fois la même enveloppe est sans effet (même `rev` et même `ct` ⇒ rien à faire).
- **Égalité de `rev`** avec un `ct` différent : le `ct` dont les octets décodés sont les plus grands gagne (§5.5),
  comme au relais ; aucune ré-écriture n'est nécessaire, le gagnant est déjà celui que le relais a retenu.
- `del` en clair ≠ `deleted` déchiffré ⇒ enveloppe rejetée et signalée ; jamais utilisée pour fusionner.

### 5.8 Anti-rejeu et points de contrôle

Le relais est non fiable : il peut **retenir** ou **rendre une vieille version**. Il ne peut pas forger (AEAD), ni
permuter (AAD), ni faire gagner une vieille version (le `rev` est authentifié). Reste la détection, côté client :

- **Ordre des `seq`** : dans une réponse, `seq` strictement croissants et `> since` ; `nextSeq ≥ since`. Sinon :
  réponse rejetée, message « le serveur a renvoyé des données plus anciennes ».
- **Plus grand `rev` par `id`** (dans `records.jsonl`) : une enveloppe reçue avec un `rev` **inférieur** à celui
  déjà connu pour cet `id`, alors que le relais la présente comme courante à un `seq` plus grand, est une
  **régression** : ignorée et comptée ; au premier cas, bandeau « le serveur a renvoyé des données plus
  anciennes » et pause `stale_server`.
- **Points de contrôle** (`sync-state.json.checkpoints`, les 10 derniers) : après chaque tirage complet, le client
  note `{ seq: nextSeq, records: nombre d'identifiants connus, at }`. Au tirage suivant, un `nextSeq` **inférieur**
  au dernier point (le serveur a « oublié » des écritures acceptées, restauration d'une sauvegarde) déclenche le
  même bandeau. `keyGeneration` de l'en-tête inférieure à celle connue : idem.
- Le relais renvoie `seq` dans `changes-post-response` : le client vérifie que les `seq` attribués à son lot sont
  `> nextSeq` du dernier tirage et les adopte comme nouveau `serverSeq` (il n'a pas besoin de re-tirer ses propres
  écritures ; il les reconnaît au couple `(id, rev)` s'il les reçoit).

Risque résiduel assumé et dit sur la page confidentialité : la **rétention** (le relais garde une écriture pour
lui) est détectée au mieux (un appareil voit son `accepted` disparaître au tirage suivant), pas empêchée ; la
sauvegarde `.qafila` chiffrée reste la parade.

---

## 6. Appairage (association d'un appareil)

Règle d'interface : « **L'appareil qui a déjà vos données scanne. Le nouveau affiche.** » N (nouveau) affiche un
QR, E (existant, déverrouillé) le scanne. Les deux écrans affichent ensuite le **même code à 6 chiffres** ; la
confirmation se fait **sur E**, celui qui détient les données, et c'est elle qui libère le paquet.

### 6.1 Ce que le QR contient

`qafila://pair?v=1&s=<serveur percent-encodé>&pk=<pkN base64url>` — exactement ces trois paramètres, dans cet
ordre, rien d'autre (`qr-pair.json`, forme analysée `{ scheme, action, v, s, pk }`). `pkN` est la **clé publique
X25519 éphémère** de N (32 octets, 43 caractères). Une photo du QR est **inoffensive** : elle ne contient aucun
secret et ne permet, au pire, que de gêner l'échange (§6.6). **Jamais** de VMK, de jeton ni de SAS dans un QR.

Le scanner distingue `qafila://pair` de `qafila://recover` (kit de secours, `qr-recover.json`, §6.7) par le chemin.

### 6.2 Dérivations (rappel ; `CRYPTO.md` fait foi, vecteur `shared/vectors/pairing.json`)

```
 S      = X25519(nE, pkN) = X25519(nN, pkE)                  (rejet si S = 0)
 info   = "qafila/v1/<usage>" || pkN || pkE   (sel HKDF vide, pour les quatre dérivations)
 K_pair = HKDF(S, "pair")      K_mac = HKDF(S, "pair-mac")      K_read = HKDF(S, "pair-read")
 SAS    = uint32BE(4 premiers octets de HKDF(S, "pair-sas")) mod 10^6, sur 6 chiffres, affiché « 099 275 »
 slot   = hex(SHA-256(pkN))
 ct     = AES-256-GCM(K_pair, n, AAD "qafila/v1/pair|<slot>", pad256(JSON canonique de la charge))
 mac    = HMAC-SHA256(K_mac, pkN || pkE || ct)                 (octets bruts)
 readProof = HMAC-SHA256(K_read, SHA-256(pkN))                 (32 octets, envoyé en hex)
```

Charge déchiffrée (`pairing-packet-plaintext.json`) : `{ v, vaultId, keyGeneration, vmk, header, server,
deviceName }` — VMK en clair (ce paquet n'existe qu'en RAM), l'en-tête public, l'URL du relais **de E** (elle fait
foi : c'est celle du coffre) et le nom de E (« Associé à iPhone de Lina »).

### 6.3 La boîte aux lettres en deux tours

> **Décision — deux tours liés par un engagement.** `COFFRE-SYNC.md` §5.2 exige que la boîte « n'accepte qu'un
> paquet signé par la clé éphémère », que le `GET` « renvoie d'abord pkE, puis le paquet contre la preuve », et
> que l'utilisateur confirme le SAS **sur E**. Pour que cette confirmation ait un effet, le paquet (qui contient
> VMK) **n'est déposé qu'après elle** : tour 1 = réponse (`pkE` + engagements), tour 2 = paquet. Le relais, qui ne
> connaît aucun secret, vérifie le lien entre les deux tours par un **engagement** `commit = hex(SHA-256(ct))`
> déposé au tour 1 : seul celui qui avait déjà chiffré le paquet peut l'ouvrir ensuite. Il vérifie la **preuve de
> lecture** par son haché `readProofHash` déposé au tour 1 : seul un détenteur de S peut consommer la boîte.

États d'une boîte : `empty` → `answered` (tour 1) → `opened` (tour 2) → `consumed` (lecture) ; `expired` ou
`burned` à tout moment. TTL **600 s** à partir du tour 1 ; une boîte consommée, expirée ou brûlée reste connue
(pour répondre 410 plutôt que 404) jusqu'à `expiresAt`, puis disparaît.

| Étape | Requête | Réponse |
|---|---|---|
| N interroge (toutes les 2 s) | `GET /pairing/{slot}` | 404 `pairing_not_found` tant que vide |
| **Tour 1** — E répond | `POST /pairing/{slot}` `{ v, pkN, pkE, commit, readProofHash }` (`pairing-answer-request.json`) | 201 `pairing-status.json` `{ state: "answered", pkE, expiresAt }` ; 400 `pairing_slot_mismatch` si `slot ≠ hex(SHA-256(pkN))` ; 409 `pairing_slot_taken` si déjà répondu |
| N lit `pkE` | `GET /pairing/{slot}` | 200 `{ state: "answered", pkE, expiresAt }` → N calcule S, K_pair, SAS ; **les deux écrans affichent le SAS** |
| L'utilisateur confirme « Même code ? » **sur E** | — | E vérifie aussi le quota (§7 : 5 appareils) avant de poursuivre |
| **Tour 2** — E dépose | `PUT /pairing/{slot}` `{ n, ct, mac }` (`pairing-open-request.json`) | 200 `{ state: "opened", pkE, expiresAt }` ; 409 `pairing_commit_mismatch` si `hex(SHA-256(ct)) ≠ commit` ; si l'état n'est pas `answered` : 404 `pairing_not_found` (vide), 409 `pairing_slot_taken` (déjà ouvert), 410 `pairing_gone` |
| N voit `opened`, lit | `GET /pairing/{slot}` + en-tête `X-Qafila-Pair-Proof: <readProof hex>` | 200 `pairing-packet-response.json` `{ state: "opened", expiresAt, packet: { v, pkN, pkE, n, ct, mac } }` ; la boîte passe à `consumed` |
| trop tôt | même `GET` avec preuve avant le tour 2 | 409 `pairing_not_open` (`details.state: "answered"`) |
| mauvaise preuve | | 403 `pairing_proof_invalid` ; à la **5ᵉ** mauvaise preuve la boîte est **brûlée** (410, `details.state: "burned"`) |
| relecture, expiration | | 410 `pairing_gone` (`details.state`) |

Le `packet` rendu est exactement l'objet `pairing-packet.schema.json` de `CRYPTO.md` : le relais le **recompose**
à partir des deux tours (`v`, `pkN`, `pkE` du tour 1 ; `n`, `ct`, `mac` du tour 2). N vérifie `pkN` = sa clé,
`mac`, déchiffre, compare `vaultId` et `keyGeneration` à ceux de l'en-tête reçu, pose ses emplacements (mot de passe
de cet appareil, biométrie), écrit son record `device`, puis tire tout le coffre (`since=0`) et pousse son
`device`. Rien n'est écrit sur le disque de N avant la vérification du `mac`.

### 6.4 Ce que le relais voit et vérifie

Il voit : `pkN`, `pkE` (clés publiques éphémères, sans valeur après l'échange), deux hachés, un nonce, un chiffré,
un HMAC qu'il ne peut pas vérifier, et deux adresses IP pendant 24 h. Il vérifie : `slot = hex(SHA-256(pkN))`,
l'unicité du tour 1, `SHA-256(ct) = commit` au tour 2, `SHA-256(preuve) = readProofHash` à la lecture, et le TTL.
Il ne peut **ni** lire le paquet (pas de S), **ni** le remplacer (engagement), **ni** le consommer (preuve),
**ni** le livrer deux fois.

### 6.5 Côté E : conditions avant chaque tour

- Coffre **déverrouillé** (niveau 1) : le paquet contient VMK.
- Avant le tour 1 : refuser si le coffre compte déjà **5** records `device` non supprimés (« Retirez un appareil
  d'abord ») ; le relais ne peut pas compter les appareils (ils sont chiffrés).
- Avant le tour 2 : la confirmation explicite de l'utilisateur, bouton « Même code » sous le SAS, avec le bouton
  « Ce n'est pas le même code » qui abandonne la boîte (elle expire seule).
- E garde `nE` en RAM pendant l'échange et l'efface ensuite ; N fait de même avec `nN`.

### 6.6 Menaces et ce qui reste

| Qui | Ce qu'il peut faire | Ce qu'il ne peut pas faire |
|---|---|---|
| Quelqu'un qui a **photographié le QR** (connaît `pkN`) | répondre **avant E** au tour 1 avec sa propre `pkE'` : E reçoit 409 et affiche « Quelqu'un d'autre a répondu à ce code — recommencez » ; N affiche un SAS qui ne correspond à rien sur E | obtenir VMK (E ne dépose jamais pour une `pkE'` dont l'utilisateur n'a pas confirmé le SAS) ; lire ou remplacer le paquet de E |
| Le **relais** | retenir, laisser expirer | lire, forger, substituer `pkE` (le SAS changerait), livrer deux fois |
| Un intrus **sur le réseau** (TLS cassé) | voir ce que voit le relais | idem |

Résidu : si l'intrus répond en premier **et** que l'utilisateur confirme sur N sans regarder E — N n'a **pas** de
bouton de confirmation, seulement « Annuler » ; N n'applique le paquet qu'au tour 2, que seul le déposant du tour
1 peut faire. Dans le pire cas (intrus déposant les deux tours), N rejoindrait le coffre **de l'intrus**, vide, et
E aurait affiché l'erreur : l'utilisateur voit que rien ne s'est associé et que ses données ne sont pas là. Le
paquet d'un tiers ne peut en aucun cas donner accès au coffre de l'utilisateur.

### 6.7 Repli sans caméra : le kit de secours

`qafila://recover?v=1&s=<serveur>&id=<vaultId en Crockford>&rk=<RK base64url>` (`qr-recover.json`) : `id` =
2 bits nuls + 128 bits en base32 Crockford, 26 symboles majuscules (le premier vaut 0 à 7), affiché en groupes
**6-5-5-5-5** avec tirets (« code du coffre ») ; le décodeur ignore tirets et casse, corrige `O→0`, `I/L→1`.
Ce QR contient la clé de secours : il ne s'affiche que dans l'écran protégé du kit et dans le PDF, jamais ailleurs.
Chemin : `GET header` avec le jeton de récupération (§5.3).

---

## 7. Quotas, limites, abus

### 7.1 Quotas par coffre (`COFFRE-SYNC.md` §1 et §5.1)

| Quota | Valeur | Qui l'applique |
|---|---|---|
| taille du coffre | **20 Mo** (20 971 520 octets comptés, §7.2) | relais (413 `quota_exceeded`, `details.quota: "bytes"`) |
| enregistrements | **10 000** identifiants, tombstones compris | relais (`details.quota: "records"`) |
| appareils | **5** records `device` | **client** (E au tour 1 ; l'écran Appareils) |
| enveloppe | **64 Kio** décodés (65 536 + 16 octets) | relais (`invalid_envelope`) et client (un `login` dépasse ce seuil seulement avec une note de ~60 Ko : le client refuse la saisie) |
| lot | **100** enveloppes, 10 Mio | relais |
| boîte d'appairage | 1 tour 1 par `slot`, 48 Kio, 600 s | relais |

### 7.2 Comptage des octets

> **Décision.** La taille comptée d'une enveloppe est la **longueur en octets de sa sérialisation JSON compacte**,
> clés dans l'ordre `v, id, tier, kg, rev, del, n, ct`, sans espace (ce que produit `JSON.stringify` d'un objet
> construit dans cet ordre). Déterministe sur les trois plateformes, et c'est ce que le relais stocke réellement.
> `usage.bytes` = somme sur les enveloppes stockées ; une enveloppe supplantée **rend** ses octets ; une purge de
> tombstone aussi. Le client peut afficher la jauge sans rien demander : il connaît toutes les enveloppes.

### 7.3 Limites de débit

| Portée | Limite | Réponse |
|---|---|---|
| par **jeton** (coffre) | 60 requêtes / min | 429 `rate_limited` + `Retry-After` |
| par **IP**, toutes requêtes | 120 / min | idem |
| par **IP**, créations de coffre (`PUT` → 201) | 5 / jour UTC | 429 `creation_limited` |
| par **IP**, jetons refusés (401/403) | 20 / min, puis blocage 1 h | 429 `rate_limited` |
| par **IP**, `POST /pairing` | 30 / min | 429 |
| par **IP**, `GET /pairing` | 60 / min (N interroge toutes les 2 s) | 429 |
| par **IP**, boîtes ouvertes simultanées | 20 | 429 |

Les compteurs vivent en mémoire (un seul processus, comme `src/rateLimit.js` aujourd'hui) ; un redémarrage les
remet à zéro, c'est acceptable. `Retry-After` en secondes, toujours présent sur un 429.

### 7.4 Abus

Sans compte, la seule surface d'abus est le **stockage** ; elle est bornée par les quotas et la limite de
création (pire cas théorique : 5 coffres × 20 Mo par IP et par jour, purgés à 180 jours d'inactivité). Un corps
trop grand est refusé **avant** lecture (413). Un `vaultId` qui n'est pas 32 hex, un `slot` qui n'est pas 64 hex,
une requête sans `Content-Type: application/json` : 404 ou 400 sans traitement. Le relais n'a **aucun** moyen de
juger un contenu ; une demande légitime de retrait porte sur un `vaultId` que seul son détenteur peut citer, et
l'opérateur n'exécute alors que ce que `DELETE` ferait. Il n'existe pas de « signalement » : rien n'est lisible.

---

## 8. Rétention, purge, rotation

| Donnée | Durée | Mécanisme |
|---|---|---|
| enveloppe courante | jusqu'à supplantation ou effacement du coffre | remplacement en place |
| **tombstone** (`del: true`) | **90 jours** après `ms(rev)` | purge quotidienne, relais **et** client (sur `deleted` déchiffré) ; un appareil hors ligne plus de 90 jours peut ressusciter un élément : accepté, « N éléments restaurés depuis <appareil> » |
| coffre **inactif** | **180 jours** après le dernier jour d'activité | `expiresAt` = minuit UTC du dernier jour + 180 j, renvoyé à la création et dans `GET header` ; l'appli avertit à **150 jours** (`expiresAt − 30 j`) et affiche la date dans Réglages › Synchronisation ; un simple lancement remet le compteur |
| boîte d'appairage | 600 s | TTL |
| journaux d'accès | **24 h** glissantes | rotation ; voir §11 |
| sauvegarde SQLite | 7 jours glissants, chiffrée, stockage objet | un `DELETE` est donc effectif au plus tard 7 jours plus tard dans les sauvegardes — dit tel quel sur la page confidentialité |

**Rotation / révocation** (`COFFRE-SYNC.md` §3.8, fixture `revocation-key-generation-bump.json`) : depuis un
appareil déverrouillé, nouvelle VMK₂ et `keyGeneration + 1`, ré-chiffrement de tout, dérivation de `K_sync₂` →
**nouveau `vaultId`, nouveau jeton** ; `PUT` du nouveau coffre, `POST` de tout, puis `DELETE` de l'ancien.
L'appareil révoqué reçoit 404 (et 401 sur le nouveau coffre même s'il en devinait l'identifiant). Les autres
appareils légitimes reçoivent 404 et affichent « Ce coffre a été renouvelé depuis un autre appareil. Ré-associez
cet appareil (QR) ou utilisez votre clé de secours. ». Aucun « pont » VMK₁ → VMK₂ n'existe nulle part, ni sur le
relais ni dans les paquets. Le relais refuse d'ailleurs toute enveloppe d'une autre génération que celle du
coffre (409) : un coffre ne contient **qu'une** génération.

---

## 9. Codes d'erreur

Corps `error.json` : `{ error: <code>, message: <français, pour les journaux>, details?: {…} }`. Les clients
réagissent au **code**, jamais au `message` (qui peut changer), et n'affichent jamais le `message` tel quel.

| HTTP | `error` | Quand | Le client |
|---|---|---|---|
| 400 | `bad_request` | JSON invalide, schéma non respecté (`details.field`), `header.vaultId` ≠ chemin | bug ; journalise, n'insiste pas |
| 400 | `invalid_envelope` | enveloppe hors format, propriété en trop, bourrage incorrect, `id` en double (`details.index`, `details.reason`) | retire l'enveloppe de l'outbox, signale |
| 400 | `rev_in_future` | `ms(rev) > now + 24 h` (`details.index`) | « L'horloge de cet appareil est déréglée » |
| 400 | `pairing_slot_mismatch` | `slot ≠ hex(SHA-256(pkN))` | bug |
| 401 | `unauthorized` | jeton mal formé ou inconnu sur un coffre existant | pause `unauthorized`, écran de ré-association |
| 403 | `forbidden` | jeton de récupération hors `GET header` | bug |
| 403 | `pairing_proof_invalid` | preuve de lecture fausse | bug ; au 5ᵉ, 410 |
| 404 | `vault_not_found` | coffre inconnu (ou effacé) | pause `vault_not_found`, message du §10.4 |
| 404 | `pairing_not_found` | boîte vide | N continue d'interroger (jusqu'à son propre délai de 10 min) |
| 409 | `vault_exists` | création d'un identifiant pris avec un autre jeton | bug (collision improbable) ou attaque : nouvel identifiant |
| 409 | `key_generation_mismatch` | `kg` ≠ génération du coffre (`details.expected / received`) | enveloppe retardataire : rechiffrer sous la génération courante |
| 409 | `pairing_slot_taken` | second tour 1 | E : « Quelqu'un d'autre a répondu à ce code — recommencez » |
| 409 | `pairing_commit_mismatch` | tour 2 d'un autre déposant | E : bug ; recommencer |
| 409 | `pairing_not_open` | preuve présentée avant le tour 2 (`details.state`) | N : continuer d'interroger sans preuve |
| 410 | `pairing_gone` | boîte consommée, expirée, brûlée (`details.state`) | « Le code a expiré, affichez-en un nouveau » |
| 413 | `payload_too_large` | corps > limite (`details.quota: "body" | "envelope" | "batch"`) | bug ; scinder |
| 413 | `quota_exceeded` | 20 Mo ou 10 000 (`details.quota`, `limit`, `current`) | pause `quota_exceeded`, « Quota atteint : supprimez des éléments ou désactivez la synchronisation » |
| 429 | `rate_limited` | §7.3 (`details.retryAfter`, en-tête `Retry-After`) | attend, puis reprend |
| 429 | `creation_limited` | 6ᵉ création par IP et jour | « Réessayez demain ou changez de serveur » |
| 500 | `internal_error` | — | réessai exponentiel |
| 503 | `unavailable` | maintenance (`Retry-After`) | idem |

La liste est close par `common.json#/$defs/errorCode` ; le test vérifie que chaque fixture d'erreur porte le
statut de cette table.

---

## 10. Comportement du client

### 10.1 Fichiers (`COFFRE-SYNC.md` §3.4)

`records.jsonl` (une enveloppe par ligne, plus grand `rev` par `id`), `outbox.jsonl` (enveloppes à pousser, **une
par `id`** : une nouvelle édition locale remplace la ligne de la même `id`), `sync-state.json` (schéma
`sync-state.json` : `server`, `vaultId`, `deviceId`, `serverSeq`, `lastSync`, `lastPush`, `expiresAt`, `hlc`,
`checkpoints`, `paused`). L'outbox est **persistée avant tout réseau** : un changement local est d'abord écrit dans
`records.jsonl` et `outbox.jsonl`, puis poussé.

### 10.2 Cadence

- **Pousser** : 2 s après le dernier changement local (temporisation), par lots de 100.
- **Tirer** : au passage au premier plan ; après chaque poussée ; toutes les 15 min au premier plan (mobile) ;
  `BGAppRefreshTask` / `WorkManager` périodique 1 h en arrière-plan (au mieux) ; PC : long-poll `wait=25` en
  boucle, ou toutes les 60 s si le long-poll échoue.
- **Toujours tirer avant de pousser au démarrage** (pour adopter l'horloge et éviter de pousser des `rev` déjà
  supplantés).
- Pas de notification push, pas de socket maintenue sur mobile.

### 10.3 Hors ligne et reprises

Tout fonctionne hors ligne ; l'outbox se vide au retour du réseau. Échec réseau ou 5xx : réessai exponentiel
2 s → 4 → 8 … plafonné à **5 min**, remis à zéro au succès. 429 : attendre `Retry-After`. Toute poussée est
rejouable (`duplicate`). Ligne « Synchronisé il y a 2 min » en tête de Réglages › Synchronisation ; point discret
sur la ligne du menu si l'outbox n'est pas vide.

### 10.4 Pauses (`sync-state.json.paused`)

| `reason` | Déclencheur | Écran |
|---|---|---|
| `vault_not_found` | 404 | « Ce coffre a été renouvelé depuis un autre appareil. Ré-associez cet appareil (QR) ou utilisez votre clé de secours. » |
| `unauthorized` | 401 | même écran (ne devrait pas arriver : jeton et coffre changent ensemble) |
| `quota_exceeded` | 413 | « Quota atteint… » ; les tirages continuent, les poussées attendent |
| `stale_server` | §5.8 | « Le serveur a renvoyé des données plus anciennes » ; tirages continuent, poussées attendent la confirmation de l'utilisateur |
| `user` | « Désactiver la synchronisation » sans effacer | rien ; l'outbox s'accumule |

Une pause ne vide jamais l'outbox ni le coffre local.

---

## 11. Confidentialité : ce que le relais voit, ce qu'il ne voit pas

Texte de référence pour la page confidentialité et les fiches des stores (même formulation que `COFFRE-SYNC.md` §2).

**Le relais voit** : un identifiant de coffre aléatoire ; des identifiants d'enregistrement aléatoires ; pour
chaque enregistrement, un bit « mots de passe / autres » (`tier`), la génération de clé, une révision contenant
une **milliseconde** d'écriture choisie par l'appareil, un indice de suppression, une taille **arrondie à
256 octets** ; le nombre d'enregistrements et le total d'octets ; le **jour** de la dernière activité ; pendant un
appairage, deux clés publiques éphémères et des hachés ; l'adresse IP de chaque requête pendant **24 heures**.

**Il ne voit pas** : un mot de passe, une URL, un titre, un nom d'appareil, une clé de réglage, le nombre
d'appareils, le mot de passe principal (jamais transmis), la clé de secours (jamais transmise), les jetons (il n'en
garde que des hachés), le contenu d'un paquet d'appairage.

**Il ne peut pas** : lire, forger un enregistrement ou une suppression, permuter deux enregistrements, faire
gagner une vieille version, deviner le mot de passe principal, attaquer la clé de secours (256 bits aléatoires).
**Il peut** : retenir ou effacer des données (détecté au mieux, §5.8 ; parade : sauvegarde `.qafila`).

**Minimisation** : tailles bourrées par le client **et imposées** par le relais ; horodatages du relais arrondis
au **jour** (`lastSeenAt`, `expiresAt`) ; `deviceId` et noms uniquement dans le chiffré ; **aucun** champ libre dans
les enveloppes ; `User-Agent` ni lu ni journalisé ; pas de corps dans les journaux ; pas de cookies.

**Journaux d'accès** (24 h) : minute, IP, méthode, **gabarit** de route (`/vaults/:vaultId/changes`, jamais
l'identifiant réel), statut, durée. Pas d'`Authorization`, pas de requête (`?since=`), pas de corps, pas
d'`User-Agent`. Les erreurs 5xx sont journalisées avec la pile, sans corps.

**Hébergement** : TLS terminé par le relais, HSTS, aucun CDN/proxy tiers (il verrait jetons et IP). Sauvegarde
chiffrée côté opérateur. Code MIT, image publiable : n'importe qui peut héberger son relais ; le réglage « Serveur
de synchronisation » le permet.

---

## 12. Transport « via un dossier » (phase 5, pour mémoire)

Mêmes enveloppes, écrites en fichiers journaux **par appareil** `qafila-sync/<vaultId>/<deviceId>.jsonl` +
`header.json` dans un dossier choisi ; un écrivain par fichier. Ajouts exigés par `COFFRE-SYNC.md` §5.4 : numéro
de séquence par appareil **dans le chiffré**, descripteur d'appareil chiffré, pointeur de tête HMAC par journal.
L'appairage y est le kit de secours ou le QR entre deux appareils voisins (les deux tours passent alors par deux
fichiers dans le même dossier). Spécifié à part quand la phase 5 s'ouvre ; rien ici ne l'empêche.

---

## 13. Décisions prises dans ce document

Là où `COFFRE-SYNC.md` laissait une latitude :

1. **Deux tours d'appairage** liés par `commit = SHA-256(ct)` et `readProofHash = SHA-256(readProof)` ; le paquet
   n'est déposé qu'après la confirmation du SAS sur E ; états `answered / opened / consumed / expired / burned` ;
   5 mauvaises preuves brûlent la boîte ; preuve dans l'en-tête `X-Qafila-Pair-Proof`.
2. **Hachage des jetons** sur la chaîne hex ASCII reçue (aligné sur `CRYPTO.md`), jamais sur les octets décodés.
3. **404 pour tout coffre inconnu**, quel que soit le jeton ; 401 seulement sur un coffre existant ; 403 pour un
   jeton de récupération hors en-tête ; pas de « tombstone » de coffre après `DELETE`.
4. **Flux d'état courant** (un `id` apparaît une fois, à son dernier `seq`) plutôt qu'un journal.
5. **Lot atomique** de 1 à 100 enveloppes, statuts `accepted / superseded / duplicate`, `seq` renvoyé pour les
   seuls `accepted` ; le relais **impose** le bourrage à 256 et refuse toute propriété supplémentaire.
6. **Comptage des octets** = sérialisation JSON compacte ordonnée `v,id,tier,kg,rev,del,n,ct`.
7. **HLC** : règles d'émission et d'adoption (§4.2), état persistant `hlc` ; le relais rejette aussi `rev` futur.
8. **Points de contrôle** anti-rejeu : 10 derniers `{ seq, records, at }`, pause `stale_server`.
9. **Horodatages serveur au jour** (`lastSeenAt`, `expiresAt` à minuit UTC) ; `expiresAt` renvoyé au client pour
   l'avertissement à 150 jours.
10. **Limites de débit** par IP (120/min, 20 jetons refusés/min puis 1 h, 30 `POST` et 60 `GET` d'appairage/min,
    20 boîtes) en plus des 60/min par jeton et 5 créations/jour du document.
11. **`PUT` coffre idempotent** avec le même jeton (200) sans modifier l'en-tête ; `PUT header` ne change jamais la
    génération.
12. **Journaux** : gabarit de route, pas d'identifiant, pas de requête ; **sauvegardes** 7 jours, dit sur la page
    confidentialité.
13. `GET /sync/v1/` **carte d'identité** sans jeton, limites minimales imposées par le schéma.
14. QR `pair` : trois paramètres dans un ordre fixe, paramètre inconnu = QR invalide.
15. **Égalité de `rev`** sur un même `id` : départage par les octets décodés de `ct` (le plus grand gagne), identique
    au relais et chez les clients ; `duplicate` réservé au `ct` identique (§5.5, `CRYPTO.md` §7.4 et §14).

---

## 14. Vérifications automatiques

`cd shared && node --test` exécute `test/protocol.test.mjs` :

- chaque étape de chaque fixture est validée contre son schéma (validateur JSON Schema minimal, sans dépendance :
  `type`, `properties`, `required`, `additionalProperties`, `items`, `min/max*`, `pattern`, `enum`, `const`,
  `allOf/anyOf/oneOf`, `$ref` interne et inter-fichiers) ; chaque erreur porte le statut du §9 ; chaque schéma est
  exercé par au moins une fixture ;
- le vecteur d'appairage est **recalculé** (X25519, HKDF, SAS, AES-GCM, HMAC, engagement, preuve) et comparé à
  `shared/vectors/pairing.json` (tant que les deux fichiers partagent les mêmes clés de test) : une divergence entre `PROTOCOL.md` et `CRYPTO.md` fait échouer la suite ;
- l'exemple de fusion est rejoué dans trois ordres d'application et doit converger comme §5.7 le dit (favori : LWW
  entier, renommage perdu ; identifiant : mot de passe perdant archivé, `rev` neuf strictement supérieur) ;
- les tailles d'enveloppes, les `seq`, les statuts et `usage.bytes` des fixtures respectent §5.4, §5.5 et §7.2.

Les mêmes fixtures serviront aux tests du module `src/relay/` (rejouer chaque étape contre le serveur réel) et aux
clients Swift / Kotlin / TS (le QR, le paquet, la fusion).
