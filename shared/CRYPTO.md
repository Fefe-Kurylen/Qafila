# Qafila — Contrat cryptographique (référence byte-exacte)

Ce fichier est la version **à l'octet** du chapitre 3 de `COFFRE-SYNC.md`. Trois implémentations le suivent
(Swift/CryptoKit + swift-sodium, Kotlin/Bouncy Castle API légère, Node pour Electron et le relais) ; elles ne
s'accordent pas en se lisant mais en reproduisant les vecteurs de `shared/vectors/*.json`, générés une fois par
`shared/vectors/gen.mjs` (implémentation de référence, aléa injecté) et vérifiés par `shared/test/crypto.test.mjs`.

Quand `COFFRE-SYNC.md` est précis, ce document le reprend tel quel. Quand il est vague, la décision est prise ici
et marquée **Décision** ; la liste complète est au §14. En cas de divergence entre ce fichier et un vecteur, le
vecteur fait foi et ce fichier a un bogue à corriger.

Conventions : `||` = concaténation d'octets ; `UTF-8("…")` = octets UTF-8 d'une chaîne sans terminateur ;
`hex` = hexadécimal **minuscule** ; `b64u` = base64url **sans** `=` ; `o` = octet. Tout entier dans un JSON est
un entier (jamais de flottant) ; tout horodatage est en millisecondes Unix.

---

## 1. Primitives et paramètres

| Rôle | Primitive | Paramètres exacts |
|---|---|---|
| Dérivation du mot de passe | **Argon2id**, RFC 9106, version `0x13` | mémoire **65 536 Kio** (= 67 108 864 o = 64 Mio), **t = 3** passes, **p = 1** voie, sortie **32 o**, sel **16 o** aléatoire par emplacement ; ni secret (`K`) ni données associées (`X`) |
| Chiffrement authentifié | **AES-256-GCM** | clé 32 o, nonce **12 o aléatoire par message** (CSPRNG, jamais un compteur partagé), tag **16 o**, AAD = chaîne UTF-8 fixée au §5, §7, §10 ; sortie stockée = `ciphertext || tag` |
| Sous-clés | **HKDF-SHA256**, RFC 5869 | `salt` **vide** (0 o — équivalent à 32 octets nuls selon la RFC), `info = UTF-8("qafila/v1/<usage>")`, longueur 32 o sauf mention ; appairage : `info` suivi de `pkN || pkE` (§10) |
| Hachage, MAC | **SHA-256**, **HMAC-SHA256** | sortie 32 o |
| Accord de clé | **X25519**, RFC 7748 | clés éphémères, 32 o bruts petit-boutistes ; secret partagé **nul rejeté** |
| Aléa | iOS `SecRandomCopyBytes` · Android `java.security.SecureRandom` · Electron `crypto.randomBytes` (processus main) | jamais `Math.random`, jamais un PRNG semé |
| Bourrage | `données || 0x80 || 0x00…` jusqu'au multiple de 256 o | §3 |

Bornes : < 2³² messages par clé AES-GCM (un coffre de 10 000 enregistrements renouvelé mille fois en est à 10⁷) ;
un enregistrement chiffré ≤ 64 Kio.

### 1.1 Correspondance par plateforme (nombres, jamais de constantes nommées)

| | iOS 17+ (Swift) | Android 8+ (Kotlin, JVM) | PC / relais (Node 22) |
|---|---|---|---|
| Argon2id | `swift-sodium` : `sodium.pwHash.hash(outputLength: 32, passwd:, salt:, opsLimit: 3, memLimit: 67108864, alg: .Argon2ID13)` — `memLimit` en **octets** | Bouncy Castle `Argon2BytesGenerator` + `Argon2Parameters.Builder(Argon2Parameters.ARGON2_id).withVersion(Argon2Parameters.ARGON2_VERSION_13).withMemoryAsKB(65536).withIterations(3).withParallelism(1).withSalt(salt)` ; `generateBytes(passwordBytes, out[32])` — API légère, jamais `Security.addProvider` | `hash-wasm` : `argon2id({ password, salt, parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'binary' })` — `memorySize` en **Kio** |
| AES-256-GCM | CryptoKit `AES.GCM.seal(_, using:, nonce:, authenticating:)` ; stocker `ciphertext || tag` (`sealedBox.ciphertext + sealedBox.tag`), **pas** `combined` (qui préfixe le nonce) | `Cipher.getInstance("AES/GCM/NoPadding")`, `GCMParameterSpec(128, nonce)`, `updateAAD(aad)` ; `doFinal` renvoie déjà `ciphertext || tag` | `createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })`, `setAAD`, puis `update + final + getAuthTag()` |
| HKDF-SHA256 | CryptoKit `HKDF<SHA256>.deriveKey(inputKeyMaterial:, salt: Data(), info:, outputByteCount:)` | `HKDFBytesGenerator(SHA256Digest())` + `HKDFParameters(ikm, ByteArray(0), info)` | `hkdfSync('sha256', ikm, Buffer.alloc(0), info, length)` |
| HMAC, SHA-256 | `HMAC<SHA256>`, `SHA256` | `HMac(SHA256Digest())`, `SHA256Digest` (ou `MessageDigest`) | `createHmac('sha256')`, `createHash('sha256')` |
| X25519 | `Curve25519.KeyAgreement.PrivateKey(rawRepresentation:)`, `.sharedSecretFromKeyAgreement(with:)` → `withUnsafeBytes` (32 o bruts, **pas** `hkdfDerivedSymmetricKey`) | `X25519PrivateKeyParameters(raw)`, `X25519Agreement` | `createPrivateKey` DER PKCS#8 préfixe `302e020100300506032b656e04220420 || clé`, `createPublicKey` SPKI préfixe `302a300506032b656e032100 || clé`, `diffieHellman({ privateKey, publicKey })` |
| Aléa | `SecRandomCopyBytes` | `SecureRandom()` (par défaut, pas `SHA1PRNG` semé) | `crypto.randomBytes` |

> ⚠️ **Piège libsodium.** `crypto_pwhash_OPSLIMIT_MODERATE` / `crypto_pwhash_MEMLIMIT_MODERATE` valent 3 et
> **268 435 456 o (256 Mio)**, pas 64 Mio ; `INTERACTIVE` vaut 2 / 64 Mio (mauvais `t`). Toujours passer les
> nombres : `opslimit = 3`, `memlimit = 67108864`. Même règle pour Bouncy Castle (65536 **Kio**) et `hash-wasm`
> (65536 **Kio**) : un facteur 1 024 d'erreur donne une clé différente et aucune erreur.

> ⚠️ **Bouncy Castle sur Android.** Utiliser `bcprov-jdk18on` par son API légère uniquement. L'enregistrer comme
> provider JCA entre en conflit avec le Bouncy Castle amputé livré dans la plateforme.

---

## 2. Encodages

### 2.1 Texte, NFC

Toute chaîne qui entre dans une primitive (mot de passe principal, phrase d'export, mots du kit, AAD, JSON
canonique) est **normalisée NFC** puis encodée **UTF-8** sans BOM ni terminateur. Le mot de passe n'est **ni
tronqué, ni rogné, ni changé de casse** (les espaces de début et de fin comptent). Les vecteurs `argon2id.json`
donnent chaque phrase en NFC et en NFD : les deux formes **doivent** produire la même clé.

### 2.2 Hexadécimal et base64url

- `hex` : minuscule, sans préfixe. Un décodeur refuse les majuscules partout où la valeur sert d'identifiant ou de
  jeton (`vaultId`, `rev`, `deviceId`, jetons porteurs, `slot` d'appairage).
- **`b64u`** : base64url (RFC 4648 §5, alphabet `A–Z a–z 0–9 - _`) **sans** `=`. **Tout** binaire dans un JSON
  du contrat l'utilise : `n`, `ct`, `salt`, `vmk`, `mac`, clés publiques, `rk` du QR. Un décodeur **strict**
  rejette `+`, `/`, `=`, une longueur ≡ 1 mod 4 et des bits de queue non nuls (ré-encoder et comparer).
  Tailles utiles : 12 o → 16 caractères ; 16 o → 22 ; 32 o → 43 ; 48 o → 64 ; 256·k + 16 o → 363, 704, 1 046…

> **Décision.** `COFFRE-SYNC.md` écrit `base64(…)` sans préciser. Un seul alphabet partout évite un second
> codec et des URL à échapper ; base64url est déjà imposé pour `pk=` et `rk=` dans les QR. Voir §14 pour la
> cohérence avec `shared/schemas/protocol/`.

### 2.3 JSON canonique

Sert à tout ce qui est chiffré ou authentifié (contenu des enregistrements, charge d'appairage, `mac` de la
sauvegarde) et, par commodité, aux fichiers écrits par Qafila. Règles :

1. Objets : clés **triées** par comparaison des **unités de code UTF-16** (JS `a < b`, Kotlin `compareTo`,
   Swift `a.utf16.lexicographicallyPrecedes(b.utf16)` — **pas** `<` sur `String`), sans doublon.
2. **Aucun** espace, retour à la ligne ou tabulation hors des chaînes.
3. Nombres : **entiers** seulement, |n| ≤ 2⁵³ − 1, sans signe `+`, sans zéro de tête, sans `.`, `e` ; `-0` s'écrit `0`.
   Un flottant est une erreur de contrat (`E_CANONICAL`), pas un arrondi.
4. Chaînes : échapper uniquement `"` → `\"`, `\` → `\\`, et les contrôles U+0000–U+001F : `\b \f \n \r \t`
   pour ceux-là, `\u00XX` (hex **minuscule**) pour les autres. Tout le reste, non-ASCII compris, est émis **brut**
   en UTF-8 (jamais `é`). Un substitut UTF-16 isolé est une erreur.
5. `true`, `false`, `null` en minuscules.

L'analyseur, lui, est un analyseur JSON ordinaire : il accepte n'importe quelle disposition, car on ne compare
jamais deux documents par leurs octets sauf dans les vecteurs. Vecteurs : `canonical-json.json`.

---

## 3. Bourrage

Avant chiffrement d'un contenu (enregistrement, charge d'appairage) :

```
padded = données || 0x80 || 0x00 × k      avec  k ≥ 0 minimal tel que |padded| ≡ 0 (mod 256)
```

Au moins **un** octet (`0x80`) est toujours ajouté : 255 o → 256 o, mais 256 o → 512 o. Débourrage : retirer
tous les `0x00` finaux, exiger que l'octet restant soit `0x80`, le retirer. Échecs (`E_PADDING`) : longueur nulle
ou non multiple de 256, aucun `0x80` après les zéros (y compris « que des zéros »). Le débourrage n'a lieu
**qu'après** une authentification GCM réussie : il ne porte aucun secret et n'a pas besoin d'être en temps
constant. Vecteurs : `padding.json`.

---

## 4. Hiérarchie des clés

```
 P (mot de passe principal, NFC) ─ Argon2id(sel 16 o) ─▶ KEK (32 o) ─┐
 DUK (32 o, Secure Enclave / Keystore / safeStorage) ─────────────────┼─▶ AES-GCM ─▶ VMK (32 o aléatoires)
 RK (32 o, clé de secours = 24 mots) ─ HKDF "recovery" ──────────────┘               │
                                                                                      ├─ HKDF "tier1-secrets"  ▶ K_secrets
                                                                                      ├─ HKDF "tier2-data"     ▶ K_data
                                                                                      ├─ HKDF "sync-token"     ▶ K_sync ─ HKDF "vault-id" (16 o) ▶ vaultId
                                                                                      ├─ HKDF "export"         ▶ K_export
                                                                                      └─ HKDF "previous-keys"  ▶ K_previous
 RK ─ HKDF "recovery-auth" ─▶ jeton de récupération (32 o)
```

| Clé | Origine | Longueur | Sert à |
|---|---|---|---|
| **VMK** | aléatoire, créée une fois par génération | 32 o | racine ; n'est **jamais** dérivée du mot de passe |
| **KEK** | `Argon2id(P, salt)` | 32 o | emplacement `passphrase` (local seulement) |
| **DUK** | aléatoire, gardée par l'enclave / le Keystore / `safeStorage` | 32 o | emplacement `device` (local seulement) |
| **RK** | aléatoire, affichée en 24 mots | 32 o | `K_recovery = HKDF(RK, "qafila/v1/recovery")` → emplacement `recovery` ; `HKDF(RK, "qafila/v1/recovery-auth")` → jeton de récupération |
| **K_secrets** | `HKDF(VMK, "qafila/v1/tier1-secrets")` | 32 o | niveau 1 : `login` |
| **K_data** | `HKDF(VMK, "qafila/v1/tier2-data")` | 32 o | niveau 2 : `bookmark`, `folder`, `setting`, `device`, `tabs` |
| **K_sync** | `HKDF(VMK, "qafila/v1/sync-token")` | 32 o | jeton porteur du relais (§8) |
| **vaultId** | `HKDF(K_sync, "qafila/v1/vault-id", 16)` | 16 o → 32 hex | identifiant du coffre, dans toutes les AAD |
| **K_export** | `HKDF(VMK, "qafila/v1/export")` | 32 o | `mac` du fichier `.qafila` (§11) |
| **K_previous** | `HKDF(VMK, "qafila/v1/previous-keys")` | 32 o | enveloppe des VMK des générations précédentes (§5.3) |

Toutes ces dérivations utilisent un sel **vide**. Les chaînes `info` exactes sont dans `hkdf.json` ; aucune autre
chaîne `qafila/v1/…` ne doit être inventée sans ajout ici.

> **Décision — `vaultId` dérivé de `K_sync`.** `COFFRE-SYNC.md` §3.8 : « dérive K_sync₂ → nouveau vaultId,
> nouveau jeton ». L'identifiant suit donc mécaniquement la génération de clé : impossible de pousser des
> enregistrements d'une génération sous l'identifiant d'une autre, et aucun état supplémentaire à stocker. Le
> relais ne peut pas relier `vaultId` au jeton autrement qu'en les recevant ensemble (HKDF est à sens unique).
> Conséquence : le « code du coffre » imprimé sur le kit change à chaque renouvellement ; l'appli propose de
> réimprimer le kit après un renouvellement.

> **Décision — `K_export`.** Les enveloppes d'une sauvegarde sont déjà chiffrées sous les clés de niveau ; la
> sauvegarde ne les re-chiffre pas. `K_export` authentifie le **fichier entier** (`mac`, §11) : une enveloppe
> retirée, ajoutée ou un en-tête modifié est détecté, ce qu'une authentification par enveloppe ne garantit pas.

Mise à zéro : toute clé en mémoire est écrasée au verrouillage (`Data.resetBytes` / `ByteArray.fill(0)` /
`Buffer.fill(0)`) ; les clés de niveau 2 et `K_sync` peuvent être mises en cache dans le magasin sécurisé sans
barrière biométrique (voir `COFFRE-SYNC.md` §3.2) ; `K_secrets`, KEK, VMK ne le sont jamais.

---

## 5. Emplacements (slots)

Un emplacement est la VMK (32 o) chiffrée en AES-256-GCM sous une clé d'emplacement :

```
slot = { "id": <slotId>, "n": b64u(nonce 12 o), "ct": b64u(AES-GCM(key, nonce, AAD, VMK)) }   →  |ct| = 48 o, 64 caractères
AAD  = UTF-8("qafila/v1/slot|<vaultId>|<slotId>|<keyGeneration>")
```

| `slotId` | Clé | Où il vit |
|---|---|---|
| `passphrase` | KEK | `header.json` local seulement — jamais sur le relais, jamais dans une sauvegarde |
| `device` | DUK | `header.json` local seulement |
| `recovery` | `K_recovery = HKDF(RK, "qafila/v1/recovery")` | `header.json` local **et** en-tête public du relais |
| `export` | KEK de la phrase d'export (Argon2id, sel propre) | fichier `.qafila` seulement |

Exemple d'AAD (vecteurs) : `qafila/v1/slot|19fb3adb8ccb193b8d782ab67cbbccdd|passphrase|3`. `keyGeneration` est
écrit en décimal sans zéro de tête. Un emplacement présenté sous un autre `vaultId`, un autre `id` ou une autre
génération échoue à l'authentification (`E_AEAD`) : vecteurs négatifs de `slots.json`.

Désenvelopper : décoder `n` et `ct` strictement, exiger |n| = 12 et |ct| = 48, déchiffrer avec l'AAD reconstruite
depuis l'**en-tête** (jamais depuis l'emplacement lui-même), exiger 32 o en sortie.

### 5.1 Nonces

Chaque enveloppement tire un **nouveau** nonce aléatoire de 12 o, y compris quand on ré-enveloppe la même VMK
(changement de mot de passe, ré-enrôlement biométrique). Deux emplacements ne partagent jamais un nonce ; un
nonce n'est jamais dérivé.

### 5.2 Paramètres KDF

`kdf = { "alg": "argon2id", "salt": b64u(16 o), "m": 65536, "t": 3, "p": 1 }` est stocké dans l'en-tête local
pour pouvoir **relever** `m` et `t` plus tard (ré-enveloppement avec un nouveau sel). Une implémentation refuse
d'ouvrir un en-tête dont `m < 65536`, `t < 3` ou `p ≠ 1` (`E_KDF`) et ne crée jamais de valeurs inférieures. Le
sel change à chaque changement de mot de passe.

### 5.3 Générations précédentes (`previousKeys`)

Après un renouvellement (§12), la VMK de la génération précédente est gardée pour lire des enregistrements locaux
retardataires (outbox non encore ré-chiffrée, fichier `.qafila` ancien) :

```
entry = { "kg": <kgOld>, "n": b64u(nonce), "ct": b64u(AES-GCM(K_previous, nonce, AAD, VMK_kgOld)) }
AAD   = UTF-8("qafila/v1/previous|<vaultId>|<kgOld>|<keyGeneration>")      avec kgOld < keyGeneration
```

`K_previous = HKDF(VMK courante, "qafila/v1/previous-keys")` : ouvrir le coffre courant suffit à lire l'ancienne
génération, rien de plus. `previousKeys` n'est **jamais** publié ni exporté ; il peut être vidé dès que plus aucun
enregistrement local ne porte `kg` ancien. Les clés de niveau d'une ancienne génération se dérivent de son VMK
exactement comme au §4.

> **Décision.** `COFFRE-SYNC.md` dit « garde VMK₁ enveloppée dans `previousKeys` » sans dire sous quoi : sous la
> VMK courante via `K_previous`, avec une AAD qui lie l'ancienne et la nouvelle génération (un ancien `ct` ne
> peut pas être présenté comme une autre génération).

---

## 6. En-têtes

### 6.1 En-tête local (`vault/header.json`)

```json
{ "v": 1,
  "vaultId": "19fb3adb8ccb193b8d782ab67cbbccdd",
  "createdAt": 1763290000000,
  "keyGeneration": 3,
  "kdf": { "alg": "argon2id", "salt": "<b64u 16 o>", "m": 65536, "t": 3, "p": 1 },
  "slots": [ { "id": "passphrase", "n": "…", "ct": "…" },
             { "id": "device",     "n": "…", "ct": "…" },
             { "id": "recovery",   "n": "…", "ct": "…" } ],
  "previousKeys": [ { "kg": 2, "n": "…", "ct": "…" } ] }
```

- `slots` contient **toujours** `recovery`, au plus un emplacement par `id`, jamais `export`.
- `device` est absent tant que la biométrie / « Se souvenir sur cet ordinateur » n'est pas activée ; il est
  **supprimé** (pas vidé) quand elle est désactivée ou invalidée.
- `passphrase` est absent uniquement dans l'extension iOS AutoFill (qui ne lit que `device`) ; l'application
  principale l'a toujours.
- `createdAt` est l'instant de création du coffre et ne change pas au renouvellement.
- Écrit en JSON canonique (§2.3), fichier remplacé atomiquement (écriture dans un temporaire puis renommage).
  Schéma : `shared/schemas/vault-header.schema.json`. Vecteur complet : `header.json`.

### 6.2 En-tête public (relais)

Projection de l'en-tête local : `v`, `vaultId`, `createdAt`, `keyGeneration` et `slots` réduit au seul
`recovery`. Ni `kdf`, ni `passphrase`, ni `device`, ni `previousKeys`. Le relais le renvoie tel quel ; le client
qui le reçoit vérifie `vaultId` (égal à celui demandé) et `keyGeneration` (≥ celle qu'il connaît, sinon
« le serveur a renvoyé des données plus anciennes »). Schéma : `vault-header.schema.json#/$defs/public`.

---

## 7. Enregistrements

### 7.1 Enveloppe (en clair, vue par le disque et le relais)

```json
{ "v": 1, "id": "<uuid v4>", "tier": 1, "kg": 3, "rev": "1763290511123-0002-9af3", "del": false,
  "n": "<b64u 12 o>", "ct": "<b64u (256·k + 16) o>" }
```

| Champ | Règle |
|---|---|
| `v` | `1` |
| `id` | UUID v4 **minuscule**, aléatoire pour **tout** (jamais dérivé d'une clé de réglage ni d'un `deviceId`) ; `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` |
| `tier` | `1` (`K_secrets`) ou `2` (`K_data`) ; doit correspondre au `type` déchiffré (§7.3) |
| `kg` | génération de clé ayant chiffré `ct` ; entier ≥ 1 |
| `rev` | `^[0-9]{13}-[0-9a-f]{4}-[0-9a-f]{4}$` : ms Unix sur 13 chiffres, compteur 4 hex, aléa 4 hex ; ordre total = ordre des octets ASCII ; **sans** auteur |
| `del` | indice de ménage pour le relais ; **toujours** égal à `deleted` du contenu, sinon rejet (`E_DEL_MISMATCH`) ; jamais lu pour fusionner |
| `n` | nonce 12 o, aléatoire par enveloppe |
| `ct` | `AES-GCM(K_tier, n, AAD, padded) || tag` ; |ct| − 16 est un multiple de 256 ; |ct| ≤ 65 536 + 16 o, soit au plus **87 403** caractères base64url (le même plafond figure dans les schémas) |

```
AAD = UTF-8("qafila/v1|<vaultId>|<id>|<tier>|<kg>|<rev>")
    ex. qafila/v1|19fb3adb8ccb193b8d782ab67cbbccdd|6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90|1|3|1763290511123-0002-9af3
```

Le `vaultId` vient du **contexte** (en-tête local, chemin de l'URL côté relais), jamais de l'enveloppe. Toute
modification de `id`, `tier`, `kg` ou `rev` fait échouer l'authentification : le relais ne peut ni permuter, ni
rajeunir, ni déplacer un enregistrement. Vecteurs : `records.json` (six enveloppes, quatorze négatifs).

### 7.2 Contenu (chiffré)

`padded = bourrage(UTF-8(JSON canonique du contenu))`. Le contenu est un objet avec au moins `type` et `deleted`
(booléen). Les types et leurs champs sont dans `shared/schemas/record-*.schema.json` ; le niveau est fixé par le
type :

| `type` | `tier` |
|---|---|
| `login` | 1 |
| `bookmark`, `folder`, `setting`, `device`, `tabs` | 2 |

**Tombstone** : contenu **exactement** `{"deleted":true,"type":"<type>"}` (canonique : 30 à 34 caractères,
bourré à 256 o) chiffré comme n'importe quel enregistrement, avec `del: true` dans l'enveloppe. Il n'existe
**aucune** suppression en clair : `ct: null`, une enveloppe sans `ct` ou un `ct` de taille non conforme sont
rejetés (`E_ENVELOPE`). Le tombstone a la taille d'un petit enregistrement.

**Champs inconnus** : un client conserve les champs qu'il ne connaît pas et les réécrit **tels quels** (même
valeur) quand il modifie l'enregistrement ; il ne les supprime jamais. C'est pourquoi les schémas de type ne
posent pas `additionalProperties: false`.

### 7.3 Ordre de validation au déchiffrement

1. Forme de l'enveloppe : `v = 1`, motifs de `id`, `rev`, `tier ∈ {1,2}`, `kg` entier ≥ 1, `del` booléen,
   `n`/`ct` base64url stricts, |n| = 12, (|ct| − 16) ≡ 0 mod 256, |ct| ≤ 65 536 + 16 → sinon `E_ENVELOPE` / `E_BASE64URL`.
2. `kg` connu (génération courante ou présente dans `previousKeys`) → sinon `E_KEYGEN`. `kg` **supérieur** à la
   génération courante : enregistrement rejeté et signal « coffre renouvelé depuis un autre appareil » (§12).
3. `rev` : refuser plus de **24 h dans le futur** par rapport à l'horloge locale (`E_REV_FUTURE`) ; ne jamais
   ajuster l'horloge sur le serveur. (Seule étape absente de `gen.mjs`, qui n'a pas d'horloge : les vecteurs
   `records.json` portent des `rev` de novembre 2026.)
4. AES-GCM avec `K_tier` de la génération `kg` et l'AAD du §7.1 → sinon `E_AEAD`.
5. Débourrage → sinon `E_PADDING`.
6. Analyse JSON ; objet ; `type` connu ; `TYPE_TIER[type] = tier` → sinon `E_CONTENT` / `E_TIER`.
7. `deleted = del` → sinon `E_DEL_MISMATCH`.
8. Validation du schéma de type (tombstone : exactement deux champs).

Un échec à n'importe quelle étape rejette l'enveloppe entière, la journalise **sans son contenu** (id et code
seulement) et ne touche pas à l'état local.

### 7.4 Horloge logique `rev`

`"<ms>-<compteur>-<aléa>"` : `ms` = max(horloge locale, plus grand `ms` connu) sur 13 chiffres ; `compteur` =
`0000` quand `ms` avance, sinon +1 (hex 4 chiffres, minuscule) ; `aléa` = 2 o CSPRNG en hex. Deux clients
produisent le même `rev` avec une probabilité 2⁻¹⁶ par milliseconde partagée, et un `rev` égal sur deux contenus
différents se résout par l'ordre des octets **décodés** du `ct` (le plus grand gagne ; règle unique du relais et des
clients, fixée dans `shared/PROTOCOL.md` §5.5).

---

## 8. Jetons porteurs

```
jeton de synchronisation   = hex(K_sync)                                  (64 caractères)
jeton de récupération      = hex(HKDF(RK, "qafila/v1/recovery-auth"))      (64 caractères)
en-tête HTTP               : Authorization: Bearer <jeton>
empreinte gardée au relais = hex(SHA-256(UTF-8(<jeton tel que reçu>)))     (64 caractères)
```

Le relais **ne stocke jamais** le jeton : il vérifie `^[0-9a-f]{64}$`, hache les 64 caractères ASCII (pas les
32 octets décodés) et compare en temps constant à l'empreinte stockée (`tokenHash`, `recoveryTokenHash`). Un
jeton en majuscules est refusé avant hachage (`E_TOKEN`). Vecteurs : `bearer-token.json`.

> **Décision.** Hacher la chaîne reçue plutôt que les octets : le relais n'a pas à décoder, et une
> implémentation qui hacherait les octets bruts obtient une autre empreinte (vecteur négatif `compare`).

---

## 9. Kit de secours

### 9.1 Vingt-quatre mots

`RK` (32 o = 256 bits) ‖ `SHA-256(RK)[0]` (8 bits) = 264 bits, lus **gros-boutiste**, découpés en 24 groupes de
11 bits ; chaque groupe indexe (0 à 2 047) la liste **`shared/bip39-french.txt`** : 2 048 lignes, une par mot,
ordre de la liste BIP-39 française de référence, **stockée en NFC** (la liste publiée est en NFD ; `recovery-kit.json`
donne le SHA-256 du fichier). Affichage : les 24 mots dans l'ordre, numérotés, séparés par une espace dans le PDF.

Décodage : 24 mots exactement ; chaque mot est normalisé **NFC**, mis en **minuscules**, débarrassé des espaces de
bord, puis cherché dans la liste (mot absent → `E_MNEMONIC`) ; les 264 bits reconstitués donnent `RK` et un octet
de contrôle qui doit égaler `SHA-256(RK)[0]` (sinon `E_MNEMONIC`). Aucune graine n'est dérivée des mots (pas de
PBKDF2 BIP-39) : la forme de normalisation n'affecte donc pas la clé.

> **Décision.** NFC plutôt que NFKD de BIP-39 parce que **toute** chaîne du contrat est NFC (§2.1) et que le
> mnémonique n'est ici qu'un encodage réversible de 256 bits. Les vecteurs couvrent la saisie en NFD et en
> majuscules.

### 9.2 Code du coffre (Crockford)

`vaultId` (16 o) préfixé de **deux bits nuls** = 130 bits, découpés en 26 groupes de 5 bits gros-boutistes,
alphabet Crockford `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (sans I, L, O, U). Affiché en **5 groupes `6-5-5-5-5`**
séparés par `-` : `0SZCXD-Q36B3-4XRTY-1APSY-BQK6X` ; le premier symbole est toujours dans `0–7`. Dans le QR,
les 26 symboles sans tiret. Saisie tolérante : minuscules acceptées, `O`→`0`, `I`/`L`→`1`, tirets et espaces
ignorés ; `U`, longueur ≠ 26 ou bits de tête non nuls → `E_VAULTCODE`.

### 9.3 QR de secours

```
qafila://recover?v=1&s=<serveur percent-encodé>&id=<26 symboles Crockford>&rk=<b64u(RK)>
```

Ordre des paramètres fixe. Le QR contient la clé de secours : il n'apparaît que sur l'écran protégé et dans le
PDF, jamais ailleurs (`FLAG_SECURE`, flou dans le sélecteur d'applis). Vecteurs : `recovery-kit.json`, `header.json`.

---

## 10. Appairage

Acteurs : **N** (nouveau, affiche le QR) et **E** (existant, déverrouillé, scanne). Notations : `nN, pkN` et
`nE, pkE` clés X25519 éphémères (32 o bruts), générées pour **une** tentative et détruites ensuite.

```
QR (N → E)        : qafila://pair?v=1&s=<serveur>&pk=<b64u(pkN)>
S                 = X25519(nE, pkN) = X25519(nN, pkE)             (32 o ; S = 0 → échec)
slot              = hex(SHA-256(pkN))                               (chemin /pairing/<slot>)
HKDF_pair(usage)  = HKDF-SHA256(ikm = S, salt = vide, info = UTF-8("qafila/v1/<usage>") || pkN || pkE, 32)
K_pair            = HKDF_pair("pair")
K_mac             = HKDF_pair("pair-mac")
K_read            = HKDF_pair("pair-read")
sasBytes          = HKDF_pair("pair-sas")
SAS               = décimal( uint32 gros-boutiste(sasBytes[0..3]) mod 1 000 000 ) sur 6 chiffres, affiché « 482 931 »
readProof         = HMAC-SHA256(K_read, SHA-256(pkN))               (32 o, hex ; preuve de possession de nN ou nE)
AAD               = UTF-8("qafila/v1/pair|<slot>")
ct                = AES-GCM(K_pair, n (12 o aléatoire), AAD, bourrage(UTF-8(JSON canonique(charge))))
mac               = HMAC-SHA256(K_mac, pkN || pkE || ct)            (octets bruts, ct = chiffré || tag, sans n)
paquet            = { "v": 1, "pkN": b64u, "pkE": b64u, "n": b64u, "ct": b64u, "mac": b64u }
charge            = { "v": 1, "vaultId", "keyGeneration", "vmk": b64u(VMK), "header": <en-tête public>,
                      "server": "<URL https de E>", "deviceName": "<nom de E>" }
```

> **Décision.** `COFFRE-SYNC.md` note `HKDF(S, "qafila/v1/pair", pkN||pkE)` : le troisième argument est
> concaténé à **`info`** (sel vide, règle unique du §1), pas placé dans le sel. `pkN || pkE` dans `info` lie les
> quatre clés aux deux clés publiques exactes de l'échange ; le SAS d'un autre échange est différent (vecteur
> négatif). La charge porte `keyGeneration` (nom complet comme dans l'en-tête) et `vmk` en base64url.
> `COFFRE-SYNC.md` écrit aussi `HMAC(HKDF(S,"pair-read"), slot)` sans dire si `slot` désigne l'hexadécimal du chemin
> ou le haché lui-même : `readProof` authentifie les **32 octets bruts** de `SHA-256(pkN)` (la valeur dont `slot`
> est l'écriture hexadécimale), jamais la chaîne de 64 caractères ; `pairing.json` et la fixture du protocole le fixent.

Vérification côté N, dans l'ordre : `v = 1` ; `pkN` égal à sa propre clé ; `pkE` 32 o ; `S ≠ 0` ; `mac` égal
(comparaison en temps constant) ; GCM ; débourrage ; JSON ; `vaultId` 32 hex, `keyGeneration` entier,
`vmk` 32 o ; en-tête public conforme au §6.2 et `header.vaultId = vaultId`. Puis N affiche le SAS ; **E** affiche
le même et c'est **sur E** (qui détient les données) que l'utilisateur confirme « Même code ? ». La charge
n'existe qu'en RAM ; N pose ensuite ses propres emplacements. Le relais ne connaît ni S ni aucune clé : il
vérifie seulement `slot = SHA-256(pkN)`, l'unicité du dépôt et la preuve de lecture `readProof` (échanges HTTP
dans `shared/PROTOCOL.md` §6). Vecteurs : `pairing.json`.

---

## 11. Sauvegarde chiffrée `.qafila`

```json
{ "format": "qafila-backup", "v": 1,
  "vaultId": "…", "keyGeneration": 3,
  "kdf": { "alg": "argon2id", "salt": "<b64u 16 o, propre au fichier>", "m": 65536, "t": 3, "p": 1 },
  "slot": { "id": "export", "n": "…", "ct": "…" },
  "records": [ <enveloppes de la génération courante, triées par id croissant (octets)> ],
  "mac": "<b64u 32 o>" }
```

- `slot.ct = AES-GCM(Argon2id(phrase d'export, salt), n, "qafila/v1/slot|<vaultId>|export|<keyGeneration>", VMK)`.
  La phrase d'export est choisie au moment de l'export (12 caractères minimum, même jauge) ; elle peut être le mot
  de passe principal, mais le sel est **toujours** nouveau.
- `records` : **toutes** les enveloppes locales de `kg = keyGeneration` (tombstones compris, pas les
  générations précédentes : le renouvellement ré-chiffre tout avant de pouvoir exporter).
- `mac = b64u(HMAC-SHA256(K_export, UTF-8(JSON canonique du fichier sans la clé "mac"))`.
- Import : vérifier `format`/`v`, dériver la KEK, ouvrir `slot`, dériver `K_export`, vérifier `mac` **avant**
  de lire une seule enveloppe (`E_BACKUP`), puis fusionner chaque enveloppe par la règle LWW ordinaire après
  validation §7.3. Un `.qafila` d'un autre `vaultId` est importable (fusion dans un Qafila vierge) : les AAD
  utilisent le `vaultId` **du fichier**.

Schéma : `backup.schema.json`. Vecteurs : `backup.json`.

> **Décision.** `COFFRE-SYNC.md` §6.5 liste `format, v, vaultId, kdf, slot, records` ; on ajoute
> `keyGeneration` (indispensable à l'AAD de `slot`) et `mac` (rôle de `K_export`, §4).

---

## 12. Générations de clés, rotation, révocation

- `keyGeneration` (`kg`) commence à **1** et n'avance que de **+1**, jamais réutilisé, jamais décrémenté.
- Toutes les AAD (emplacements, enregistrements, générations précédentes) contiennent `kg` : un objet d'une
  génération ne peut pas être présenté sous une autre.
- **Changer le mot de passe principal** : nouveau sel, nouvelle KEK, nouveau nonce, ré-enveloppement de
  `passphrase` seulement. `kg` inchangé. Local, instantané.
- **Ré-enrôler la biométrie / « se souvenir »** : nouvelle DUK, ré-enveloppement de `device`. `kg` inchangé.
- **Renouveler la clé** (« Retirer cet appareil », soupçon de fuite), depuis un appareil déverrouillé :
  1. `VMK' ← 32 o aléatoires`, `kg' = kg + 1` ; dériver les clés du §4 ; `vaultId'` en découle ;
  2. ré-chiffrer **chaque** enregistrement local sous `K_tier'` avec un **nouveau nonce** et un **nouveau `rev`**
     (l'AAD change, donc le `rev` doit avancer pour que la règle LWW l'emporte partout), `kg'` ;
  3. écrire le nouvel en-tête : emplacements `passphrase` et `device` de cet appareil sous `VMK'`, `recovery`
     ré-enveloppé (même RK, ou nouvelle RK si « Nouvelle clé de secours » est choisi), `previousKeys` reçoit
     `VMK` sous `K_previous'` (§5.3) ;
  4. créer le coffre `vaultId'` sur le relais avec le nouveau jeton, pousser tout, puis `DELETE` l'ancien coffre.
- **Interdit, par construction** : envelopper `VMK'` sous `VMK` (ou sous toute clé qu'un appareil révoqué peut
  détenir), publier `previousKeys`, réutiliser `kg`. Les autres appareils légitimes reçoivent 404 sur l'ancien
  coffre et se ré-associent par QR ou par kit : c'est voulu.
- Un enregistrement reçu avec `kg > keyGeneration` locale n'est jamais déchiffrable : le client s'arrête, affiche
  « Ce coffre a été renouvelé depuis un autre appareil » et ne pousse plus rien.
- Les emplacements d'un ancien `kg` sont supprimés de l'en-tête ; seule la VMK ancienne survit dans
  `previousKeys`, le temps de vider l'outbox.

---

## 13. Vecteurs de test et conformité

`shared/vectors/gen.mjs` est l'implémentation de référence (Node 22, `node:crypto` + `hash-wasm`) ; il n'utilise
**aucun** aléa : nonces, sels, scalaires éphémères et clés sont des constantes ou dérivés d'étiquettes. Le
régénérer (`cd shared && npm run vectors`) doit laisser `git status` propre ; `shared/test/crypto.test.mjs` le
vérifie, re-dérive chaque valeur et exige l'échec de chaque négatif avec son code.

| Fichier | Contenu | Négatifs |
|---|---|---|
| `argon2id.json` | 4 phrases (ASCII, accents, émoji, arabe) en NFC et NFD → KEK | octets NFD bruts ≠ KEK |
| `hkdf.json` | toutes les sous-clés du §4 depuis `vmk = 00…1f`, `rk = 20…3f` | — |
| `slots.json` | `passphrase`, `device`, `recovery`, `previousKeys` avec AAD | autre génération, autre coffre, autre `id`, NFD, tag altéré, base64 non url |
| `header.json` | en-tête local complet, projection publique, code du coffre, QR | — |
| `records.json` | `login`, tombstone, `bookmark`, `setting` (objet imbriqué, clé non ASCII), `folder`, `device` | tag, ct, `id`, `vaultId`, `kg`, `kg` inconnu, `rev`, `tier`, bourrage sans `0x80`, `del` ≠ `deleted`, type au mauvais niveau, base64, `v`, `rev` mal formé |
| `padding.json` | 0, 2, 255, 256, 257, 511 o | vide, non multiple, zéros seuls, `0x81`, sans `0x80` |
| `recovery-kit.json` | 4 RK → 24 mots (dont `00…` et `ff…`), 3 codes Crockford, QR | somme de contrôle, 23 mots, mot inconnu, mot voisin ; `U`, bits de tête |
| `bearer-token.json` | jetons sync et récupération, en-tête `Authorization`, empreintes | majuscules, longueur, hachage des octets bruts |
| `pairing.json` | échange complet : clés, `S`, `slot`, `K_pair`/`K_mac`/`K_read`, SAS, `readProof`, paquet | SAS d'un autre échange, `mac`, `ct`, `pkE`, `pkN` substitués |
| `backup.json` | `.qafila` à deux enveloppes avec `mac` | enveloppe retirée, `mac` altéré |
| `canonical-json.json` | tri UTF-16, échappements, non-ASCII brut | flottant, entier > 2⁵³ |
| `standard.json` | RFC 5869 A.1, RFC 4231 cas 2, AES-256-GCM McGrew–Viega / NIST cas 13 à 16, RFC 7748 §6.1, SHA-256(« abc ») | — |

Chaque port (Swift `XCTest`, Kotlin `JUnit`, TypeScript `vitest`) charge ces JSON, recalcule les positifs à
l'octet et vérifie que chaque négatif échoue **à l'étape annoncée** (`error`). Les codes d'erreur (`E_AEAD`,
`E_PADDING`, `E_KEYGEN`, `E_DEL_MISMATCH`, `E_TIER`, `E_ENVELOPE`, `E_BASE64URL`, `E_MNEMONIC`, `E_VAULTCODE`,
`E_TOKEN`, `E_PAIR`, `E_BACKUP`, `E_KDF`, `E_CANONICAL`, `E_REV_FUTURE`) sont le vocabulaire commun des trois
ports et des journaux (sans contenu). Les vecteurs libsodium d'Argon2id et ceux de chaque bibliothèque restent
dans les suites de ces bibliothèques ; `argon2id.json` est le test d'interopérabilité (hash-wasm ↔ libsodium ↔
Bouncy Castle).

---

## 14. Décisions prises ici et points à arbitrer

Choix faits là où `COFFRE-SYNC.md` était muet (chacun est marqué **Décision** plus haut) :

1. **base64url sans `=` pour tout binaire** (§2.2), y compris `n`, `ct`, `salt`, `mac`, `vmk`.
2. **JSON canonique** : tri par unités UTF-16, entiers seuls, non-ASCII brut (§2.3).
3. **`vaultId = HKDF(K_sync, "qafila/v1/vault-id", 16)`** (§4) ; le code du coffre change au renouvellement.
4. **`K_export`** authentifie le fichier `.qafila` (`mac`) ; la sauvegarde porte `keyGeneration` (§11).
5. **`previousKeys`** chiffrés sous `K_previous = HKDF(VMK, "qafila/v1/previous-keys")`, AAD
   `qafila/v1/previous|<vaultId>|<kgOld>|<kg>` (§5.3).
6. **Appairage** : `pkN || pkE` concaténés à `info`, sel vide ; `mac` sur `pkN || pkE || ct` ; SAS = 4 premiers
   octets gros-boutistes mod 10⁶ ; charge avec `keyGeneration` (§10).
7. **Kit** : liste BIP-39 française stockée en **NFC**, comparaison NFC + minuscules ; Crockford avec 2 bits de tête
   nuls, groupes `6-5-5-5-5` (§9).
8. **Jetons** : empreinte = SHA-256 de la chaîne hexadécimale reçue (§8).
9. Le type s'écrit **`setting`** (singulier, comme dans `COFFRE-SYNC.md` §4.1) ; `tabs` est déclaré (phase 5).
10. Emplacements : décodage strict, |ct| = 48 exigé ; `kdf` jamais abaissé (`E_KDF`).
11. **`readProof`** = HMAC-SHA256 sur les 32 octets bruts de `SHA-256(pkN)`, pas sur la chaîne hexadécimale `slot` (§10).
12. **Égalité de `rev`** sur un même `id` : départage par les octets décodés de `ct`, le plus grand gagne ; règle
    écrite dans `shared/PROTOCOL.md` §5.5 et appliquée à l'identique par le relais et les clients (§7.4).

**Écarts avec `COFFRE-SYNC.md`, assumés** :

- `COFFRE-SYNC.md` écrit `base64(…)` ; tout `shared/` (ce document, `schemas/`, `schemas/protocol/`, `fixtures/`,
  `vectors/`) est en **base64url sans `=`** (§2.2). `shared/test/protocol.test.mjs` recalcule le vecteur
  d'appairage depuis `pairing.json` : toute divergence d'encodage ou de dérivation entre les deux jeux de fichiers
  fait échouer la suite.
- `COFFRE-SYNC.md` nomme `shared/schema/*.schema.json`, `shared/tools/gen-vectors.mjs`, `shared/sync/PROTOCOL.md` ;
  la mise en place de `shared/` a retenu `shared/schemas/*.schema.json`, `shared/vectors/gen.mjs` (`npm run vectors`)
  et `shared/PROTOCOL.md`. Ce document suit l'arborescence réelle ; `COFFRE-SYNC.md` §9.1 reste à aligner.
