# Qafila — Coffre, synchronisation et application PC (document de référence)

Ce document fixe **ce qu'on construit** pour les trois demandes : une application PC qui se synchronise avec
les applis mobiles, l'import des mots de passe et favoris de Firefox / Chrome, et un gestionnaire de mots de
passe sécurisé. Il est écrit pour être implémenté par des agents, plateforme par plateforme, sans réunion :
tout ce qui doit être identique entre iOS, Android et PC est spécifié à l'octet près ou renvoyé vers un fichier
de `shared/` qui le sera.

Il part de la proposition « sécurité » (la seule avec une hiérarchie de clés cohérente, des révisions
authentifiées et une révocation qui coupe réellement un appareil), y greffe les parcours utilisateur de la
proposition « produit » (import en deux gestes, « Ouvrir avec Qafila », kit de secours en bannière douce,
remplissage système tôt) et garde la proposition « zéro serveur » comme transport optionnel « via un dossier ».
Chaque défaut relevé par les trois relectures est corrigé ici ; quand elles se contredisent, la décision est
prise et motivée (encadrés « Décision »).

---

## 1. En une page, pour le propriétaire

### Ce qu'on construit

1. **Un coffre** dans Qafila : vos mots de passe, vos favoris (désormais en dossiers) et vos réglages, chiffrés
   sur l'appareil. Au quotidien il s'ouvre avec Face ID / l'empreinte ; derrière, un **mot de passe principal**
   et une **clé de secours** (24 mots imprimables). Personne, pas même Qafila, ne peut lire ou récupérer le
   coffre sans l'un des deux : c'est le prix de la promesse « aucune collecte ».
2. **L'import depuis Chrome ou Firefox** : on exporte depuis l'autre navigateur (CSV des mots de passe, HTML des
   favoris), on ouvre le fichier dans Qafila, Qafila reconnaît le format, affiche « 312 mots de passe · 27
   favoris dans 6 dossiers » et on valide. Dédoublonnage automatique, dossiers conservés, proposition
   d'effacer le fichier en clair. Export inverse toujours possible (CSV, HTML, sauvegarde chiffrée).
3. **Le remplissage automatique** : dans Qafila (une carte au-dessus du clavier, un tap pour remplir, jamais
   sans votre geste), puis dans toutes les applis du téléphone (extension iOS, service Android).
4. **La synchronisation** : un petit **relais aveugle**, module ajouté au serveur Node existant. Il ne stocke
   que des blocs chiffrés rangés sous un identifiant aléatoire ; il ne peut ni lire, ni forger, ni savoir qui
   vous êtes. Pas d'e-mail, pas de compte : on associe un nouvel appareil en scannant un QR code (20 s). Le
   serveur est auto-hébergeable et une option « via un dossier » (iCloud Drive, Nextcloud…) sans aucun serveur
   viendra ensuite.
5. **L'application PC** (Windows, macOS, Linux) : Electron, même moteur Chromium partout, même barre, même menu
   flottant, même écran d'onglets, mêmes réglages que le mobile (grâce à la synchro des réglages, le PC a
   littéralement l'allure de votre téléphone). Compilée, signée et publiée par GitHub Actions.

### Dans quel ordre

| Phase | Ce que l'utilisateur voit | Taille indicative |
|---|---|---|
| 0 | Rien : spécifications, vecteurs de test, fichiers partagés | 1–2 semaines |
| 1 | Coffre local + import/export Chrome/Firefox sur iPhone et Android, remplissage dans Qafila | 5–6 semaines |
| 2 | Synchronisation téléphone ↔ téléphone (favoris, réglages, mots de passe), association par QR | 4–5 semaines |
| 3 | Application PC v1 synchronisée, import depuis le profil Chrome/Firefox du PC | 6–8 semaines |
| 4 | Remplissage dans Safari, Chrome et les autres applis (iOS et Android) | 3–4 semaines |
| 5 | Options : synchro « via un dossier » sans serveur, codes TOTP, onglets des autres appareils… | à la demande |

Soit environ **5 à 6 mois de travail d'agents**, plutôt 6 à 7 avec les relectures et les validations des
stores. Chaque phase se livre seule ; l'appli navigateur continue de sortir normalement entre deux.

### Ce que ça coûte

| Poste | Coût | Remarque |
|---|---|---|
| Apple Developer Program | 99 €/an, **déjà prévu** | couvre aussi la signature et la notarisation macOS, 0 € de plus |
| Relais de synchronisation | **≈ 4,5 à 6 €/mois** | un petit VPS avec disque persistant (le conteneur actuel n'a pas de volume) ; SQLite, pas de base externe |
| Sauvegarde chiffrée du relais | ≈ 1 €/mois | stockage objet |
| Signature Windows | **0 €** (SignPath Foundation, gratuit pour un projet MIT) ou 19 $ une fois (Microsoft Store) | sinon avertissement SmartScreen documenté |
| Linux | 0 € | AppImage, rien à signer |
| GitHub Actions | 0 € si le dépôt reste **public** | les runners macOS comptent ×10 en privé |
| Relecture externe de la crypto (optionnelle, recommandée) | 1 500 à 4 000 € une fois | avant d'écrire « sécurisé » sur les fiches store |

Rien n'est facturé aux utilisateurs pour le coffre, l'import/export, le remplissage ni l'appli PC. La synchro
est gratuite avec des quotas raisonnables (5 appareils, 20 Mo, 10 000 éléments) ; « Soutenir Qafila » (0,99 €)
reste tel quel et est simplement présenté sur la page Synchronisation comme ce qui paie le relais.

### Les décisions à prendre (recommandation en gras)

1. **Transport par défaut** : relais aveugle hébergé par vous (**recommandé** : c'est la seule façon qu'une appli PC
   « se synchronise » sans demander à l'utilisateur de posséder un dossier cloud commun) — ou zéro serveur
   d'emblée (0 €/mois, mais « choisir un dossier iCloud/Drive/Nextcloud » est un concept de développeur, et
   Android + Windows ou iPhone + Linux n'ont pas de dossier commun fiable). Le format est identique : le dossier
   arrive en phase 5 comme option.
2. **Hébergement du relais** : petit VPS avec Docker et volume (**recommandé**, ≈ 4,5 €/mois, le serveur de
   recherche y migre aussi) — ou rester sur Railway/Fly/Render avec un volume payant.
3. **Tarification** : tout gratuit, quotas, « Soutenir Qafila » inchangé (**recommandé**) — ou gating de la
   synchro derrière l'abonnement (déconseillé : bloque exactement ce qui est demandé, le PC ne peut pas
   s'abonner, et vérifier un reçu Apple/Google introduit la première donnée reliable à une personne).
4. **Windows** : demander **SignPath Foundation** dès la phase 3 (gratuit, projet MIT), Microsoft Store (19 $)
   en second, Azure Trusted Signing (≈ 10 $/mois) en dernier recours.
5. **Ordre des phases** : coffre local d'abord (**recommandé** : l'import de mots de passe exige le coffre, et
   le PC a besoin du cœur TypeScript que la phase 2 produit) — ou PC d'abord sans mots de passe (gain de
   quelques semaines sur l'appli PC, mais deux chantiers de synchro au lieu d'un).
6. **Relecture externe** de `shared/CRYPTO.md` et des trois implémentations après la phase 2 : **oui** si le
   budget le permet ; sinon relecture communautaire (code public, modèle de menace publié).
7. **Déclaration de chiffrement** : passer `ITSAppUsesNonExemptEncryption` à `true` et répondre au
   questionnaire d'export d'Apple ; vérifier la formalité ANSSI pour un logiciel grand public à chiffrement
   standard avant la première soumission (voir §11).
8. **Nom dans l'interface** : « Mots de passe » pour l'écran, « coffre » dans les textes d'explication
   (**recommandé** : on ne vend pas de concept, on range des mots de passe).

---

## 2. Modèle de menace et garanties

### Ce qui est protégé

| Adversaire | Ce qu'il obtient | Ce qu'il ne peut pas faire |
|---|---|---|
| **Relais hostile ou piraté** (ou quiconque a volé le jeton de synchro) | identifiant de coffre aléatoire, identifiants d'enregistrements aléatoires, tailles arrondies à 256 octets, un bit « niveau 1 / niveau 2 », horodatages des écritures, adresse IP ≤ 24 h | lire un mot de passe, une URL, un titre, un nom d'appareil, une clé de réglage ; **forger** un enregistrement ou une suppression (tout est AEAD, suppressions comprises) ; **permuter** deux enregistrements (l'identifiant et le coffre sont dans l'AAD) ; **rejouer** une vieille version sans être détecté (révisions monotones vérifiées côté client) ; deviner le mot de passe principal (il n'est **jamais** sur le serveur) ; attaquer la clé de secours (256 bits aléatoires) |
| **Téléphone ou PC volé, verrouillé** | des fichiers chiffrés | ouvrir le coffre : la clé maîtresse n'existe que (a) enveloppée sous le mot de passe principal (Argon2id), (b) enveloppée sous une clé du Secure Enclave / Keystore conditionnée à la biométrie et non sauvegardable, (c) en RAM pendant le déverrouillage, effacée au verrouillage automatique |
| **Appareil volé déverrouillé** (code PIN connu, coffre verrouillé) | favoris et réglages (niveau 2), le jeton de synchro (donc effacement du coffre sur le relais : atteinte à la disponibilité, pas à la confidentialité) | lire les mots de passe (niveau 1 : Argon2id ou biométrie exigée) ; empêcher la révocation : depuis un autre appareil, « Retirer cet appareil » renouvelle la clé, le jeton et l'identifiant du coffre |
| **Site de phishing** | rien | obtenir un identifiant : le remplissage exige un tap, l'origine est lue côté natif (jamais depuis la page), correspondance exacte d'hôte, pas de rétrogradation https → http, pas d'iframe tiers, avertissement sur les domaines homographes |
| **Fichier du coffre exfiltré** (sauvegarde, forensique) | enregistrements chiffrés + enveloppe du mot de passe principal | déchiffrer sans le mot de passe principal (Argon2id 64 Mio, minimum 12 caractères, indicateur de force) ou la clé de secours |

### Ce qui n'est pas protégé (et dit tel quel dans l'appli)

- Un appareil avec logiciel malveillant, rooté ou jailbreaké.
- Un appareil volé **déverrouillé** dont le coffre est **ouvert** (atténué : verrouillage auto 5 min, ré-authentification pour révéler, copier ou exporter).
- Un mot de passe principal faible (atténué : 12 caractères minimum, jauge de force, refus des scores 0–1 ; mais la liberté de choisir reste à l'utilisateur).
- Les métadonnées : nombre d'éléments, rythme des modifications, le bit « mots de passe / autres » par enregistrement (nécessaire pour savoir quelle clé utiliser), l'adresse IP pendant 24 h.
- La valeur **une fois remplie** dans une page : le JavaScript de la page peut la lire (inhérent au remplissage dans la page ; c'est pourquoi on ne remplit que sur un tap et jamais dans les iframes tierces).
- La **rétention** par le serveur : il peut retenir ou supprimer des données (détecté, pas empêché) ; la sauvegarde `.qafila` chiffrée reste la parade.
- Le bavardage de l'index système : l'extension iOS AutoFill publie (hôte, nom d'utilisateur) dans `ASCredentialIdentityStore`, géré par Apple en clair local ; désactivable (Réglages › Mots de passe › Remplissage dans iOS).

### Garanties annoncées (formulation pour la fiche et la page confidentialité)

« Vos mots de passe, favoris et réglages sont chiffrés sur votre appareil. Le serveur de synchronisation ne
reçoit que des données chiffrées qu'il ne peut pas lire, sans compte ni adresse e-mail. Qafila ne peut pas
récupérer votre coffre : conservez votre clé de secours. » Pas de « inviolable », pas de « militaire ».

---

## 3. Cryptographie

Référence byte-exacte : `shared/CRYPTO.md` (ce chapitre en est la version lisible). Aucune primitive maison.

### 3.1 Primitives, une seule série sur les trois plateformes

| Rôle | Choix | Paramètres |
|---|---|---|
| Dérivation du mot de passe | **Argon2id** (RFC 9106) | sortie 32 o, **m = 65 536 Kio (64 Mio), t = 3, p = 1**, sel 16 o aléatoire ; paramètres stockés dans l'en-tête local pour pouvoir les relever (jamais abaisser) |
| Chiffrement authentifié | **AES-256-GCM** | nonce 12 o aléatoire par message (CSPRNG), tag 16 o, AAD canonique (§3.4). Borne : < 2³² messages par clé, largement respectée ; **interdiction** des nonces compteur partagés entre appareils |
| Sous-clés | **HKDF-SHA256** (RFC 5869) | sel vide, `info = "qafila/v1/<usage>"` |
| Hachage / MAC | SHA-256, HMAC-SHA256 | |
| Appairage | **X25519** éphémère + HKDF + AES-256-GCM | code de vérification (SAS) 6 chiffres dérivé du secret partagé |
| Aléa | iOS `SecRandomCopyBytes` · Android `java.security.SecureRandom` · Electron `crypto.randomBytes` (processus main) | jamais `Math.random` |
| Bourrage | avant chiffrement : JSON + `0x80` + zéros jusqu'à un multiple de 256 o | brouille les tailles |

> **Décision.** AES-256-GCM plutôt que XChaCha20-Poly1305 : natif et accéléré sur les trois plateformes
> (CryptoKit, `javax.crypto`, Node `crypto`), zéro dépendance ; la seule dépendance externe est Argon2id.
> XChaCha serait acceptable uniquement si libsodium était de toute façon adopté partout, ce qui n'est pas le cas.

Bibliothèques :
- **iOS 17+** : CryptoKit (`AES.GCM`, `HKDF`, `HMAC`, `SHA256`, `Curve25519.KeyAgreement`), Security (Keychain,
  `SecAccessControl`), LocalAuthentication. Argon2id : paquet SwiftPM `swift-sodium` (jedisct1, libsodium en
  xcframework ; `crypto_pwhash` avec `ALG_ARGON2ID13`, `opslimit = 3`, `memlimit = 67108864` en **octets**).
- **Android 8+ (API 26)** : `javax.crypto` `AES/GCM/NoPadding`, `AndroidKeyStore`, `androidx.biometric`.
  Argon2id, HKDF, X25519 : Bouncy Castle `org.bouncycastle:bcprov-jdk18on` via son **API légère**
  (`Argon2BytesGenerator`, `HKDFBytesGenerator`, `X25519Agreement`), **jamais** enregistré comme provider JCA
  (conflit avec le BC amputé livré dans Android). Si Argon2id dépasse 1,5 s sur un appareil Android 8 de
  test, bascule vers `lazysodium-android` (même sortie) ; c'est le maillon le moins maintenu, on ne l'adopte
  que si la mesure l'impose.
- **PC (processus main Electron)** : Node `crypto` (`aes-256-gcm`, `hkdfSync`, `createHmac`, `randomBytes`,
  `diffieHellman` x25519), Argon2id via `hash-wasm` (WebAssembly pur, aucune recompilation native sur CI).

> ⚠️ Piège signalé par la relecture : les constantes libsodium `crypto_pwhash_*_MODERATE` valent
> opslimit 3 / **memlimit 256 Mio**, pas 64 Mio. Toujours passer les nombres, jamais les constantes nommées.

### 3.2 Hiérarchie des clés (emplacements de clé à la LUKS)

```
 mot de passe principal P ──Argon2id(sel)──▶ KEK ─┐
 clé du Secure Enclave / Keystore (biométrie) ──▶ DUK ─┼─▶ enveloppent ──▶ VMK (32 o aléatoires, créée une fois)
 clé de secours RK (24 mots) ──HKDF("recovery")──▶ ─┘                       │
                                                                             ├─ HKDF "tier1-secrets" ──▶ K_secrets  (identifiants, notes, TOTP)
                                                                             ├─ HKDF "tier2-data"    ──▶ K_data     (favoris, dossiers, réglages, appareils, onglets)
                                                                             ├─ HKDF "sync-token"    ──▶ K_sync     (jeton porteur du relais ; le relais ne garde que SHA-256)
                                                                             └─ HKDF "export"        ──▶ K_export   (sauvegardes .qafila)
 clé de secours RK ──HKDF("recovery-auth")──▶ jeton de récupération (pour télécharger l'en-tête sans le jeton de synchro)
```

- **VMK** (Vault Master Key) n'est **jamais dérivée** du mot de passe : changer de mot de passe = ré-envelopper
  un emplacement, instantané.
- **Emplacements** (`slots`) : `passphrase` = AES-GCM(KEK, VMK) ; `device` = AES-GCM(DUK, VMK) ; `recovery` =
  AES-GCM(HKDF(RK, "recovery"), VMK). Chaque emplacement a son AAD : `"qafila/v1/slot|<vaultId>|<slotId>|<keyGeneration>"`
  (correction relevée : un emplacement ne peut pas être présenté sous une autre génération ni un autre coffre).
- **Deux niveaux de verrouillage**. Niveau 1 (`K_secrets`) : coffre ouvert requis (biométrie ou mot de passe).
  Niveau 2 (`K_data`) : mise en cache dans le magasin sécurisé **sans** barrière biométrique
  (iOS `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — et non `WhenUnlocked`, pour que
  `BGAppRefreshTask` fonctionne téléphone verrouillé ; Android clé Keystore sans `userAuthenticationRequired` ;
  Electron `safeStorage`). Les favoris et les réglages se chargent et se synchronisent au lancement comme
  aujourd'hui ; les mots de passe attendent le déverrouillage du coffre.

> **Décision — où vit l'emplacement « mot de passe principal ».** **Localement, par appareil, jamais sur le
> relais.** Ce que le relais stocke ne peut donc être attaqué qu'avec la clé de secours (256 bits aléatoires) :
> aucune cible de force brute hors ligne pour l'opérateur ou un pirate. Conséquence assumée : le mot de passe
> principal est **propre à chaque appareil** (en pratique le même, choisi par l'utilisateur à l'association ;
> l'écran dit « Choisissez le mot de passe principal de cet appareil — vous pouvez reprendre le même »), et
> un nouvel appareil s'intègre par **QR** ou par **clé de secours**, pas en tapant le mot de passe.

### 3.3 Force du mot de passe principal

Minimum **12 caractères**, jauge de force (zxcvbn-ts sur PC, estimation compacte entropie + 10 000 mots de passe
courants sur mobile depuis `shared/common-passwords-10k.txt`), refus des scores 0 et 1, acceptation dès 2 avec
un conseil visible. Pas de coffre « code PIN seul ».

> **Décision.** La relecture crypto demandait zxcvbn ≥ 3 ou 14 caractères obligatoires ; la relecture produit
> une simple jauge. Comme l'emplacement mot de passe ne quitte plus l'appareil (§3.2), la cible de force brute
> hors ligne n'existe qu'en cas de vol du fichier : un plancher de 12 + refus des pires scores est proportionné.

### 3.4 Format des enregistrements

Chaque enregistrement est **son propre message AEAD** (synchro par deltas, aucune permutation possible). Partie
en clair (ce que voient le disque et le relais) :

```json
{ "v": 1,
  "id": "6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90",
  "tier": 1,
  "kg": 3,
  "rev": "1763290511123-0002-9af3",
  "del": false,
  "n": "base64(12 o)",
  "ct": "base64(ciphertext || tag)" }
```

- `id` : UUID v4 minuscule **aléatoire pour tout** (plus d'UUID v5 déterministes : la clé d'un réglage,
  l'identifiant d'appareil, le type, le nom de l'appareil sont **dans** le chiffré).
- `rev` : horloge logique hybride `"<ms 13 chiffres>-<compteur 4 hex>-<aléa 4 hex>"`, ordre total
  lexicographique, **sans identifiant d'auteur** (l'aléa départage ; l'auteur est dans le chiffré). Les
  clients rejettent un `rev` de plus de 24 h dans le futur et **n'ajustent jamais leur horloge sur le serveur**.
- `kg` : génération de clé (`keyGeneration`).
- `del` : **indice pour le ménage du serveur uniquement**. Le client ne le lit jamais pour fusionner : il lit
  `deleted` dans le chiffré ; une incohérence = enregistrement rejeté et signalé.
- **AAD** = `"qafila/v1|<vaultId>|<id>|<tier>|<kg>|<rev>"` en UTF-8.
- **Tombstone** = enveloppe AEAD normale dont le contenu est `{"type":"<type>","deleted":true}` (bourré à
  256 o). **Jamais** `ct: null` : une suppression non authentifiée permettait au relais de détruire n'importe
  quel enregistrement.
- Contenu avant bourrage : JSON UTF-8 compact (clés triées) ; après déchiffrement, les champs inconnus sont
  **conservés** et réécrits tels quels (un vieux client ne supprime jamais un champ nouveau).

Fichiers locaux (`vault/` dans Application Support · `filesDir` · `userData`) :
`header.json` (en-tête local, §3.5), `records.jsonl` (une enveloppe par ligne, compacté à l'écriture),
`outbox.jsonl` (changements non poussés), `sync-state.json` (`serverSeq`, `lastSync`, `deviceId`, points de
contrôle). iOS : conteneur App Group **`group.fr.qafila.QafilaBrowser`** (identifiant réel du bundle, pas
`fr.qafila.browser` qui est l'`applicationId` Android), protection `CompleteUntilFirstUserAuthentication`.
Android : exclu de la sauvegarde automatique via `dataExtractionRules` (les clés Keystore ne se sauvegardent
pas, les fichiers seraient illisibles). Pas de SQLite ni Room/GRDB sur mobile : 2 000 enregistrements se
déchiffrent en quelques dizaines de ms à l'ouverture.

### 3.5 En-têtes

En-tête **local** (`header.json`) :

```json
{ "v": 1, "vaultId": "3f9a…(32 hex)", "createdAt": 1763290000000, "keyGeneration": 3,
  "kdf": { "alg": "argon2id", "salt": "base64(16 o)", "m": 65536, "t": 3, "p": 1 },
  "slots": [
    { "id": "passphrase", "n": "…", "ct": "…" },
    { "id": "device", "n": "…", "ct": "…" },
    { "id": "recovery", "n": "…", "ct": "…" } ],
  "previousKeys": [ { "kg": 2, "n": "…", "ct": "…" } ] }
```

En-tête **publié sur le relais** : uniquement `v`, `vaultId`, `keyGeneration`, `createdAt` et l'emplacement
`recovery`. Ni emplacement mot de passe, ni emplacement appareil, ni paramètres KDF (inutiles sans le mot de passe).

### 3.6 Déverrouillage biométrique

- **iOS** : DUK = 32 o aléatoires en `kSecClassGenericPassword`, `SecAccessControlCreateWithFlags(
  kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet)`, `kSecAttrSynchronizable = false`,
  groupe d'accès partagé avec l'extension AutoFill. Ré-enrôlement biométrique ou retrait du code → élément
  effacé → mot de passe principal demandé une fois (expliqué dans l'interface). Repli : le mot de passe
  **principal**, jamais le code de l'appareil.
- **Android** : clé AES-256-GCM `AndroidKeyStore`, `setUserAuthenticationRequired(true)`,
  `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` (API 30+ ; API 26–29 :
  `setUserAuthenticationValidityDurationSeconds(-1)`), `setInvalidatedByBiometricEnrollment(true)`, StrongBox si
  disponible sinon TEE ; `BiometricPrompt` avec `CryptoObject(cipher)`, **`BIOMETRIC_STRONG` seul : pas de
  repli sur le code PIN de l'appareil** (décision : le coffre ne doit pas valoir un PIN vu par-dessus
  l'épaule). Cette clé enveloppe DUK, qui enveloppe VMK : « désactiver la biométrie » = supprimer l'emplacement.
- **PC** : mot de passe principal au lancement ; au premier déverrouillage l'appli propose « Se souvenir sur cet
  ordinateur » (DUK via Electron `safeStorage` : DPAPI / trousseau macOS / libsecret), avec le verrouillage
  automatique visible juste en dessous. **Refus** si `safeStorage.getSelectedStorageBackend()` renvoie
  `basic_text` (Linux sans trousseau : repli en clair obfusqué, inacceptable). Touch ID / Windows Hello :
  phase 5.
- **Extension iOS AutoFill** : utilise **exclusivement** l'emplacement `device` (DUK via Face ID). Pas
  d'Argon2id à 64 Mio dans l'extension (plafond mémoire des extensions) ; si la biométrie est indisponible,
  l'extension renvoie vers l'application.
- **Verrouillage automatique** : Immédiat / 1 / 5 / 15 min après passage en arrière-plan, 5 min par défaut ;
  clés mises à zéro (Swift `Data` / Kotlin `ByteArray.fill(0)` / Node `Buffer.fill(0)`, au mieux côté JS).
  Révéler, copier, exporter : biométrie ou mot de passe fraîche si verrouillé. Presse-papiers : iOS
  `UIPasteboard.setItems(... expirationDate: +60 s, localOnly: true)` ; Android `ClipDescription.EXTRA_IS_SENSITIVE`
  + effacement à 60 s ; Electron `clipboard.clear()` à 60 s. `FLAG_SECURE` sur les écrans du coffre Android,
  capture floutée dans le sélecteur d'applis iOS.

### 3.7 Kit de secours et récupération

À la création du coffre, l'appli génère la **clé de secours RK** (32 o) et l'affiche comme **24 mots** (liste
BIP39 française, 2 048 mots, 11 bits par mot : 264 bits = 256 bits de clé + 8 bits de somme de contrôle,
encodage standard avec bibliothèques sur chaque plateforme — correction : 13 groupes de 4 caractères base32 ne
contenaient pas 256 + 8 bits), plus un **QR** `qafila://recover?v=1&s=<serveur>&id=<vaultId base32>&rk=<base64url>`
et une page imprimable « Kit de secours Qafila » (PDF) avec le **code du coffre** (vaultId, 26 caractères
Crockford en 5 groupes).

> **Décision.** Pas de re-saisie forcée de deux groupes (mur à l'entrée) : écran « Je l'ai mise en lieu sûr »
> + bannière douce persistante dans Réglages tant que ce n'est pas confirmé, ré-affichable après
> ré-authentification. Le texte dit en une phrase : « Qafila ne peut pas récupérer votre coffre. »

Trois chemins de retour : (1) le mot de passe principal de l'appareil ; (2) **n'importe quel autre appareil
associé** (il détient VMK et peut poser un nouvel emplacement mot de passe sur lui-même ; pour l'appareil
oublieux, on le ré-associe par QR) ; (3) la **clé de secours** : le nouvel appareil tape ou scanne le kit,
obtient le jeton de récupération `HKDF(RK,"recovery-auth")`, télécharge l'en-tête
(`GET /vaults/{id}/header`, porteur = jeton de récupération dont le relais garde le SHA-256), désenveloppe VMK,
pose ses emplacements. Aucune réinitialisation côté serveur n'existe, par construction.

### 3.8 Rotation et révocation

- **Changer le mot de passe principal** : ré-envelopper l'emplacement `passphrase` local. Instantané, local.
- **Renouveler la clé** (« Retirer cet appareil » ou soupçon) — spécifié honnêtement, depuis un appareil
  déverrouillé :
  1. génère VMK₂, `keyGeneration + 1` ; ré-chiffre tous les enregistrements (quelques milliers, quelques secondes) ;
  2. pose ses propres emplacements `passphrase` et `device` sous VMK₂ ; ré-enveloppe l'emplacement `recovery`
     (même RK sauf si l'utilisateur choisit « Nouvelle clé de secours », proposé quand le kit a pu fuir) ;
  3. dérive `K_sync₂` → **nouveau `vaultId`, nouveau jeton** : crée le nouveau coffre sur le relais, pousse
     tout, puis `DELETE` l'ancien ;
  4. garde VMK₁ enveloppée dans `previousKeys` pour lire d'éventuels retardataires locaux.
  Les **autres appareils légitimes** reçoivent 404 sur l'ancien coffre et affichent « Ce coffre a été
  renouvelé depuis un autre appareil. Ré-associez cet appareil (QR) ou utilisez votre clé de secours. »
  C'est le prix pour qu'un appareil révoqué, un kit volé ou une photo d'écran ne donnent **jamais** VMK₂ :
  **aucun « pont » enveloppant la nouvelle clé sous l'ancienne n'est autorisé** (défaut rédhibitoire d'une
  des propositions : la révocation n'y révoquait rien). Les emplacements `device` des autres appareils ne
  peuvent pas être ré-enveloppés à distance : leurs DUK ne quittent jamais leur enclave, d'où la ré-association.
- **Retirer un appareil sans soupçon** (« j'ai vendu ma tablette après l'avoir effacée ») : suppression du
  record `device` + proposition de renouveler quand même.

### 3.9 Vecteurs de test (`shared/vectors/`, exécutés sur les trois plateformes en CI)

Standards :
- **Argon2id** : vecteurs publiés de libsodium pour `crypto_pwhash` (sans secret ni données associées : l'API haut
  niveau de libsodium ne les expose pas ; le vecteur RFC 9106 §5.3 avec secret et AD ne sert qu'à valider
  Bouncy Castle et `hash-wasm`, qui les acceptent) ; plus trois vecteurs Qafila (m = 65 536, t = 3, p = 1,
  mots de passe UTF-8 avec accents et émoji, normalisation **NFC** avant dérivation — à spécifier, sinon
  « é » tapé sur iOS et Android diverge).
- **AES-256-GCM** : cas 13 à 16 de McGrew–Viega / NIST (cas 16 : clé `feffe9928665731c6d6a8f9467308308
  feffe9928665731c6d6a8f9467308308`, IV `cafebabefacedbaddecaf888`, texte 60 o, AAD 20 o, tag `76fc6ece0f4e1768cddf8853bb2d551b`).
- **HKDF-SHA256** : RFC 5869 cas 1–3. **HMAC-SHA256** : RFC 4231. **X25519** : RFC 7748 §6.1.
- **BIP39** : vecteurs de référence (entropie → mots → somme de contrôle), liste française.

Qafila (générés **une fois** par `shared/tools/gen-vectors.mjs`, nonces **injectés**, puis figés) :
- mot de passe `"qafila-vecteur-test"`, sel fixe → KEK ; VMK fixe → emplacements `passphrase` et `recovery` ;
  `K_secrets`, `K_data`, `K_sync`, `K_export` en hex ; un identifiant chiffré complet avec sa chaîne AAD
  exacte et son bourrage ; un tombstone chiffré ; un en-tête complet ; un échange d'appairage à clés
  éphémères fixes avec le SAS attendu ; une sauvegarde `.qafila` minimale.
- **Négatifs** (doivent échouer) : tag altéré ; AAD avec un autre `id` ; autre `vaultId` ; autre `kg` ;
  `rev` modifié ; emplacement présenté sous une autre génération ; mot de passe NFD au lieu de NFC ; bourrage
  invalide (pas de `0x80`) ; SAS d'un autre échange.

---

## 4. Modèle de données

Identifiants : UUID v4 minuscules (ce que produisent déjà `BrowserTab`/`Bookmark` iOS et `Models.kt`).
Horodatages : entiers, millisecondes Unix (convention Android ; Swift convertit `Date`). Schémas JSON dans
`shared/schema/*.schema.json`, source de vérité pour les types `Codable` / `@Serializable` / TS.

### 4.1 Types (contenu déchiffré)

**login** (niveau 1)
```json
{ "type": "login", "title": "Aeon",
  "origins": ["https://aeon.co", "https://login.aeon.co"],
  "username": "lina@example.org", "password": "…", "note": "",
  "formActionOrigin": "https://aeon.co", "httpRealm": null, "totp": null,
  "folderId": null, "favorite": false, "tags": [],
  "createdAt": 1763290000000, "modifiedAt": 1763290000000, "lastUsedAt": null, "passwordChangedAt": 1763290000000,
  "passwordHistory": [ { "password": "ancien", "changedAt": 1750000000000 } ],
  "source": "firefox", "importGuid": "{a1b2…}", "importBatch": "b7e1…", "neverSaveHere": false,
  "author": "d3c9a1f0", "deleted": false }
```
`origins` : `scheme://host[:port]` normalisés, le premier est l'origine principale. `passwordHistory` : 10 max.
`source` ∈ `manual | saved | chrome | firefox | safari | bitwarden | 1password`. `importBatch` permet
« Annuler cet import » (24 h).

**bookmark** (niveau 2) — étend `Bookmark{id,title,url,addedAt}` existant :
```json
{ "type": "bookmark", "title": "Aeon", "url": "https://aeon.co/", "addedAt": 1763290000000,
  "folderId": null, "position": "a0V", "author": "d3c9a1f0", "deleted": false }
```
`position` : index fractionnaire (chaîne) pour l'ordre manuel, deux insertions concurrentes ne se heurtent jamais.

**folder** (niveau 2) : `{ "type":"folder", "name":"Firefox · 16 nov. 2026", "kind":"bookmark"|"login", "parentId":null, "position":"a1", "createdAt":…, "toolbar":false }`.
`toolbar: true` = contenu affiché en tuiles sur la page de démarrage (par défaut : racine + ce dossier).

**setting** (niveau 2), **un enregistrement par clé**, id aléatoire, clé à l'intérieur :
```json
{ "type": "setting", "key": "searchEngine", "value": "duckduckgo", "scope": "all", "author": "d3c9a1f0", "deleted": false }
```
Deux appareils créant la même `key` pour la première fois produisent deux enregistrements : le client garde le
`rev` le plus grand et pose un tombstone sur les autres (règle « clé logique dans le chiffré »). Clés
synchronisées : toutes les clés de `Settings` **sauf** celles propres à l'appareil : `appIcon`, `haptics`,
`comfortMode`, `suspendTabsInPowerSave`, `customUserAgent`, `landscapeTopBar`, `edgeSwipeNavigation`,
`autoLockMinutes`, réglages biométriques. `toolbar` (barre + menu) se synchronise comme une seule valeur JSON ;
`toolbar.position` est **ignoré sur PC** (une barre en bas sur un 27 pouces n'est pas de la parité). La liste
exacte des clés et de leurs valeurs brutes (`rawValue` Swift = nom d'enum Kotlin) vit dans
`shared/SETTINGS_SYNC_KEYS.md` ; une clé inconnue d'une plateforme est conservée et ignorée.

**device** (niveau 2), un par appareil (id aléatoire, `deviceId` à l'intérieur) :
`{ "type":"device", "deviceId":"d3c9a1f0", "name":"iPhone de Lina", "platform":"ios", "appVersion":"1.4.0", "createdAt":…, "lastSeenAt":…, "deleted":false }`.

**tabs** (niveau 2, phase 5) : `{ "type":"tabs", "deviceId":"…", "tabs":[{ "title","url","lastVisited" }] }`, remplacé en bloc, pour « Onglets de mes autres appareils ».

**Jamais synchronisés** : historique, onglets privés, favicons, vignettes, état des onglets (ils restent dans
`state.json`). L'historique reste hors serveur **par principe**, dit sur la page confidentialité.

### 4.2 Résolution des conflits

- **Dernier écrivain gagne** par enregistrement, sur `rev` (ordre total). Le relais applique la même règle à
  l'aveugle sur le `rev` en clair ; le client la **ré-applique** après déchiffrement (le `rev` est dans l'AAD,
  donc authentifié : un relais ne peut pas faire gagner une vieille version).
- **login** : si le perdant avait un mot de passe différent, le client qui détecte le conflit l'ajoute à
  `passwordHistory` du gagnant. Rien n'est perdu en silence ; l'écran de détail montre « Historique du mot de passe ».
- **setting** : LWW par clé (un enregistrement par clé ⇒ fusion champ par champ gratuite).
- **folder / bookmark** : déplacement LWW ; un favori dont le dossier a été supprimé revient à la racine
  (l'enfant gagne sur le tombstone du parent) ; ordre par index fractionnaire, convergent.
- **Tombstones** : un tombstone bat tout `rev` plus ancien et perd contre une édition plus récente (une édition
  faite hors ligne après une suppression ressuscite l'élément : règle la moins surprenante). Conservés 90 jours
  puis purgés (client et relais, celui-ci sur l'indice `del`). Un appareil hors ligne plus de 90 jours peut
  ressusciter un élément supprimé : accepté, message « N éléments restaurés depuis <appareil> ».
- **Idempotence** : appliquer deux fois la même enveloppe est sans effet.

Scénarios figés dans `shared/vectors/sync-merge-cases.json` (LWW simple, mot de passe perdant archivé, édition
après suppression, parent supprimé / enfant ajouté, deux `setting` même clé, réordonnancement concurrent,
`rev` futur rejeté, enveloppe rejouée, tombstone forgé sans AEAD rejeté).

### 4.3 Migration depuis `state.json`

Au premier lancement après la mise à jour, **rien ne change** si l'utilisateur ne crée pas de coffre : favoris
et réglages restent dans `state.json`. À la création du coffre (ou à l'activation de la synchro), les favoris
deviennent des `bookmark` de niveau 2 (`folderId: null`, `position` dans l'ordre actuel), les réglages
synchronisables des `setting`. `header.json` porte `v` pour les migrations futures.

---

## 5. Synchronisation

**Principe** : le relais est un dépôt **bête, non fiable, en ajout seul** d'enveloppes. Toute la logique de
fusion et toutes les clés sont sur les appareils. Pas d'e-mail, pas de compte, pas de mot de passe serveur.

### 5.1 Le relais Qafila (transport 1, par défaut)

Module Node/Express `src/relay/` monté sur `/sync/v1` dans le serveur existant (**même image Docker**),
publiable aussi seul (`qafila-relay`) pour l'auto-hébergement. Le réglage « Serveur de synchronisation »
accepte toute URL https (même mécanique que l'instance SearXNG).

Stockage : **`node:sqlite`** (intégré à Node 22, pas de module natif à compiler sur Alpine/musl) sur un
**volume persistant**. ⚠️ Le `Dockerfile` et `docker-compose.yml` actuels n'ont pas de volume et le README
vise Railway/Fly/Render : l'hébergement du relais suppose un disque persistant (VPS + volume Docker, ou volume
payant de la plateforme). Tables : `vaults(vaultId PK, tokenHash, recoveryTokenHash, headerJson, keyGeneration,
createdAt, lastSeenAt, bytes)`, `records(vaultId, id, tier, kg, rev, del, n, ct, serverSeq AUTOINCREMENT,
UNIQUE(vaultId,id))`, `pairing(slot PK, blob, pkHash, expiresAt)`.

Endpoints (`Authorization: Bearer <K_sync hex>` sauf mention ; le relais ne stocke que `SHA-256(jeton)`) :

| Méthode | Chemin | Rôle |
|---|---|---|
| `PUT` | `/vaults/{vaultId}` | créer (corps : en-tête public + hash du jeton de récupération) ; premier arrivé gagne |
| `GET` | `/vaults/{vaultId}/header` | en-tête public ; porteur = jeton de synchro **ou** jeton de récupération (aucun endpoint anonyme) |
| `PUT` | `/vaults/{vaultId}/header` | mise à jour (changement de clé de secours) |
| `GET` | `/vaults/{vaultId}/changes?since=<seq>&limit=500[&wait=25]` | enveloppes + `nextSeq` ; `wait` = long-poll 25 s (PC) |
| `POST` | `/vaults/{vaultId}/changes` | tableau d'enveloppes ; le relais garde le plus grand `rev` par `id`, renvoie accepté/supplanté par id et le nouveau `seq` |
| `DELETE` | `/vaults/{vaultId}` | tout effacer (« Désactiver la synchronisation et effacer du serveur », rotation) |
| `POST` | `/pairing/{slot}` · `GET` `/pairing/{slot}` | boîte aux lettres d'appairage, TTL 10 min, lecture unique, écriture et lecture **liées à la clé éphémère** (§5.2) |

Limites : 64 Kio par enveloppe, **20 Mo et 10 000 enregistrements par coffre, 5 appareils** (record `device`
comptés côté client, `vaults.bytes` côté serveur), 5 créations par IP et par jour, 60 requêtes/min par jeton,
coffres inactifs **180 jours** supprimés (l'appli avertit à 150 jours **et** affiche la date d'expiration sur la
page Synchronisation ; un simple lancement remet le compteur). Journaux : accès 24 h glissantes, pas d'User-Agent,
pas de corps. **TLS terminé par le relais lui-même, HSTS, aucun CDN ni proxy tiers devant** (il verrait les jetons et
les IP : incompatible avec « aucun service tiers »).

Anti-rejeu : `serverSeq` monotone ; le client garde le plus grand `rev` connu par `id` et le dernier `seq` ; un
`rev` qui régresse ou un `seq` qui recule affiche « le serveur a renvoyé des données plus anciennes » (détection,
pas prévention : risque résiduel documenté §2).

### 5.2 Association d'un appareil (appairage)

Rien de long à taper. Deux modes, le scanner reconnaît lequel ; règle affichée : « **L'appareil qui a déjà vos
données scanne. Le nouveau affiche.** » (le cas inverse, nouveau téléphone / PC existant, est couvert parce que
le téléphone a toujours une caméra et peut aussi afficher).

```
 NOUVEAU (N)                                   EXISTANT déverrouillé (E)
 clé éphémère X25519 (nN, pkN)
 QR: qafila://pair?v=1&s=<serveur>&pk=pkN ───▶ scanne, clé éphémère (nE, pkE)
                                               S = X25519(nE, pkN) ; K = HKDF(S, "qafila/v1/pair", pkN||pkE)
                                               poste à /pairing/<SHA-256(pkN)> :
                                                 { pkE, ct = AES-GCM(K, {vaultId, VMK, kg, header, serveur, nomE}),
                                                   mac = HMAC(HKDF(S,"pair-mac"), pkN||pkE||ct) }
 poll (2 s), S = X25519(nN, pkE), K, vérifie mac, déchiffre
 affiche SAS = 6 chiffres de HKDF(S, "pair-sas", pkN||pkE)   ◀──▶  affiche le même SAS
 l'utilisateur confirme « Même code ? 482 931 » sur E (celui qui détient les données)
 N pose ses emplacements (mot de passe de cet appareil, biométrie), écrit son record device, première synchro
```

Corrections par rapport aux propositions : le code de vérification est dérivé **du secret partagé après
l'échange** et affiché **sur les deux écrans** (une empreinte placée dans le QR ne prouvait que la clé du nouvel
appareil, pas la provenance du paquet) ; la boîte aux lettres **n'accepte qu'un paquet signé par la clé
éphémère** `pkE` (`POST` porte `pkE` et `mac` ; le relais vérifie que `slot = SHA-256(pkN)` et refuse un second
dépôt ; `GET` exige la preuve de possession de `nN` : `HMAC(HKDF(S,"pair-read"), slot)` calculé après lecture de
`pkE` — en pratique : le `GET` renvoie d'abord `pkE`, puis le paquet contre la preuve) ; une lecture
anticipée par un tiers ne peut donc ni vider la boîte ni y déposer. **Jamais** de VMK ou de jeton en clair dans
un QR (une photo d'écran serait une compromission permanente).

Repli sans caméra des deux côtés : le **kit de secours** (24 mots + code du coffre + serveur, §3.7).

### 5.3 Comportement du client

Coffre entièrement répliqué localement. Chaque changement local → `records.jsonl` + `outbox.jsonl`, poussé après
2 s de temporisation. Tirage au premier plan, après chaque poussée, toutes les 15 min au premier plan (mobile),
`BGAppRefreshTask` / `WorkManager` périodique 1 h en arrière-plan (au mieux), 60 s ou long-poll sur PC.
**Toujours tirer avant de pousser** au démarrage. Hors ligne : tout fonctionne, l'outbox se vide au retour du
réseau. Ligne « Synchronisé il y a 2 min » en tête de Réglages › Synchronisation, point discret sur la ligne
du menu si quelque chose attend. Pas de notifications push, pas de socket maintenue sur mobile (batterie,
aucun tiers APNs/FCM).

Volumes : coffre type (500 identifiants, 300 favoris, 60 réglages) ≈ 1 Mo au premier tirage, deltas de
quelques Ko, < 10 Mo/mois par appareil.

### 5.4 Transport 2, « via un dossier » (phase 5, sans serveur)

Mêmes enveloppes, écrites en **fichiers journaux par appareil** `qafila-sync/<vaultId>/<deviceId>.jsonl` +
`header.json` dans un dossier choisi par l'utilisateur (iOS `UIDocumentPickerViewController(forOpeningContentTypes:[.folder])`
+ signet à portée de sécurité + `NSFileCoordinator` + `startDownloadingUbiquitousItem` ; Android
`ACTION_OPEN_DOCUMENT_TREE` + `takePersistableUriPermission` ; PC un chemin). Un écrivain par fichier ⇒ aucun
« conflicted copy », compaction sans course. Ajouts exigés par la relecture : **numéro de séquence par appareil
à l'intérieur du chiffré** (détection des lignes supprimées ou tronquées), **descripteur d'appareil chiffré**
(plus de « iPhone de Nadia » en clair pour le fournisseur), et un pointeur de tête HMAC par journal. Appairage
= kit de secours ou QR entre deux appareils voisins. Transport **swap**, pas de migration.

### 5.5 Abus et coûts

Pas de compte ⇒ la surface d'abus est le stockage : quotas, limites par IP, purge d'inactivité, taille de corps,
`DELETE` exigeant le jeton (un inconnu ne peut rien effacer). Pire cas borné par les quotas : 1 000 coffres
actifs × 1 Mo ≈ 1 Go ; 20 Go au maximum théorique. Sauvegarde nocturne chiffrée du fichier SQLite vers un
stockage objet (≈ 1 €/mois). Les auto-hébergeurs ne coûtent rien. Levier **ultérieur** si les coûts montent, le
seul compatible sans compte : quotas relevés pour les soutiens via un **reçu StoreKit/Play signé envoyé une
fois**, vérifiable **hors ligne** par le relais (clés publiques Apple/Google), attaché au `vaultId`, jamais à
une personne, sans appel aux API Apple/Google. Pas en phase 1.

---

## 6. Import / export

### 6.1 D'où vient le fichier (guide intégré, chemins exacts)

| Source | Mots de passe | Favoris |
|---|---|---|
| Chrome / Edge / Brave (PC) | `chrome://password-manager/settings` → « Exporter les mots de passe » (CSV) | `chrome://bookmarks` → ⋮ → « Exporter les favoris » (HTML) |
| Chrome (Android/iOS) | Paramètres → Gestionnaire de mots de passe → ⚙ → Exporter (CSV dans Téléchargements) | impossible sur mobile → depuis un PC, ou laisser **Qafila PC** importer et la synchro porter |
| Firefox (PC) | `about:logins` → ⋯ → « Exporter les identifiants… » (CSV) | Ctrl/Cmd+Maj+O → Importation et sauvegarde → « Exporter des marque-pages au format HTML… » |
| Firefox (mobile) | pas d'export | pas d'export → même parade |
| Safari (macOS 14+) | Fichier → Exporter → Mots de passe (CSV) | Fichier → Exporter → Signets (HTML) |

Qafila **ne lit jamais** les bases internes des autres navigateurs pour les mots de passe (`Login Data` sous
DPAPI/Keychain et App-Bound Encryption depuis Chrome 127, `key4.db` Firefox : fragile, hostile aux stores).
Exception **PC, favoris seulement, lecture seule** (phase 3) : détection des profils Chrome/Edge/Brave
(`Bookmarks` JSON, dates WebKit en µs depuis 1601) et Firefox (`places.sqlite` copié dans un fichier temporaire
car verrouillé, lu via `node:sqlite` si le Node embarqué par Electron le permet, sinon `sql.js` WASM) → un
bouton « Importer les favoris de Chrome » sans étape d'export.

### 6.2 Comment le fichier entre dans Qafila (« deux gestes »)

Points d'entrée : Réglages › **Importer depuis un autre navigateur** (en tête de Réglages la première semaine,
puis sous Favoris / Mots de passe), états vides de Favoris et de Mots de passe, carte du premier lancement du
coffre (« Vous venez de Chrome ou Firefox ? »), et **le système** : iOS déclare `CFBundleDocumentTypes` pour
`public.comma-separated-values-text` et `public.html` (« Ouvrir dans Qafila » depuis Fichiers, Mail, AirDrop) ;
Android un `intent-filter` `ACTION_VIEW`/`ACTION_SEND` pour `text/csv`, `text/comma-separated-values`,
`text/html` (« Ouvrir avec Qafila » depuis Téléchargements) ; PC : glisser-déposer sur la fenêtre + boîte de dialogue.

> **Décision.** La proposition « simplicité » jugeait l'enregistrement comme ouvreur de `.csv/.html` intrusif.
> Un navigateur est déjà l'ouvreur naturel du HTML, et l'import est le moment où l'utilisateur décide de rester :
> on déclare les types, en acceptant un tap de plus pour ceux qui ne s'en servent pas.

Geste 1 : choisir le fichier (`fileImporter` iOS avec `[.commaSeparatedText, .html, .plainText, .data]` +
`startAccessingSecurityScopedResource` ; Android `OpenDocument` avec `text/*` et `*/*` car Android étiquette
mal les CSV). Le format est **détecté par le contenu**, jamais demandé. Aperçu en carte, style Quiche :
« Firefox · 312 mots de passe · 27 favoris dans 6 dossiers · 14 doublons ignorés · 2 mots de passe mis à
jour », un seul interrupteur « Ranger dans un dossier « Firefox » » (activé par défaut), une ligne pour
ajouter le second fichier si on a l'un sans l'autre. Geste 2 : « Importer » (biométrie si le coffre est
verrouillé). Écran final : compteurs, « **Supprimer le fichier d'export ?** (il contient vos mots de passe en
clair) » (`FileManager.removeItem` sur l'URL à portée / `DocumentsContract.deleteDocument` / `shell.trashItem`),
rappel d'effacer la copie dans Téléchargements/AirDrop, CTA « Activer le remplissage automatique »
(`ASSettingsHelper.openCredentialProviderAppSettings()` / `Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE`) et
conseil discret « Pensez à désactiver l'enregistrement des mots de passe dans Chrome ». **« Annuler cet import »**
reste disponible 24 h dans Réglages › Mots de passe (tombstones du `importBatch`).

### 6.3 Analyseurs (une spécification, trois implémentations, mêmes fixtures)

Spécification `shared/IMPORT_FORMATS.md` ; fixtures `shared/fixtures/import/*.csv|html` avec `expected/*.json`
(BOM, guillemets, virgules et retours à la ligne dans les notes, accents, entités HTML, dossiers imbriqués,
`PERSONAL_TOOLBAR_FOLDER`, URL `place:`, dates en µs). Référence TS dans `packages/qafila-core/src/import/`,
ports Swift (`QafilaCore/Sources/Import/`) et Kotlin (`core/src/main/kotlin/fr/qafila/core/import/`), ~150
lignes chacun, sans bibliothèque (trois comportements à aligner sur un seul jeu de fixtures est plus simple à
raisonner que trois bibliothèques).

- **Détection** : BOM UTF-8 retiré ; en-tête `name,url,username,password[,note]` ⇒ Chrome/Edge/Brave/Google
  Password Manager ; `url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged`
  ⇒ Firefox ; `Title,URL,Username,Password,Notes,OTPAuth` ⇒ Safari (phase 5) ; `folder,favorite,type,name,notes,
  fields,reprompt,login_uri,login_username,login_password,login_totp` ⇒ Bitwarden (phase 5) ; 1Password 8 (phase 5) ;
  document contenant `<!DOCTYPE NETSCAPE-Bookmark-file-1>` ou `<DL><p>` ⇒ favoris Netscape.
- **CSV** : automate RFC 4180 (champs entre guillemets, guillemets doublés, CR/LF dans les notes), CRLF/LF,
  ligne vide finale, **colonnes par nom d'en-tête** jamais par position. Firefox : temps en ms →
  `createdAt`/`lastUsedAt`/`passwordChangedAt`, `guid` → `importGuid`, `httpRealm` non vide = auth HTTP Basic
  (titre « Authentification HTTP · hôte »), `formActionOrigin` conservé. Chrome : `note` optionnel, pas de
  dates (`createdAt` = import), entrées `android://…` conservées avec un drapeau. Lignes sans URL, nom ni mot de
  passe ignorées. URL → origine (`scheme://host[:port]`, chemin supprimé).
- **Netscape HTML** : **pas** un analyseur XML (jamais bien formé). Scanner de balises tolérant :
  `<DT><H3 ADD_DATE LAST_MODIFIED PERSONAL_TOOLBAR_FOLDER>` ouvre un dossier, `<DL><p>` / `</DL>` imbrique,
  `<DT><A HREF ADD_DATE LAST_MODIFIED ICON ICON_URI TAGS SHORTCUTURL>` ajoute, `<DD>` = description (note sur
  PC, ignorée sur mobile). Entités `&amp; &lt; &gt; &quot; &#39; &#NNN; &#xHH;`. Dates en secondes (si
  > 10¹² ⇒ ms ; si > 10¹⁶ ⇒ µs WebKit depuis 1601). `ICON` ignoré (favicons re-téléchargées). Ignorés avec
  compteur : `place:`, `javascript:`, `chrome://`, `about:`, `file:`, `data:`. Racines reconnues : « Barre de
  favoris » / « Bookmarks bar », « Autres favoris », « Bookmarks Toolbar » / « Barre personnelle », « Bookmarks
  Menu » / « Menu des marque-pages », « Mobile Bookmarks » / « Marque-pages mobiles », « Unfiled », et le
  dossier interne « Mozilla Firefox » (ignoré).
- **Flux** avec progression jusqu'à ~20 Mo / 20 000 lignes ; tout en mémoire, sur l'appareil, rien n'est envoyé,
  tampons mis à zéro, jamais journalisé (règle de lint CI : grep des journaux contenant `password`).

### 6.4 Dossiers et dédoublonnage

- **Dossiers** : avec « Ranger dans un dossier » (défaut), tout va dans `Firefox · 16 nov. 2026` en gardant la
  hiérarchie ; le dossier `PERSONAL_TOOLBAR_FOLDER` reçoit `toolbar: true` (ses tuiles apparaissent sur la page
  de démarrage). Sans l'interrupteur : contenu de la barre à la racine, les autres conteneurs de premier niveau
  deviennent des dossiers racine, les conteneurs vides disparaissent.
- **Identifiants** : clé = (origine principale, nom d'utilisateur insensible à la casse). Même clé + même mot de
  passe ⇒ « déjà présent ». Même clé + mot de passe différent ⇒ **fusion** : le plus récent par
  `passwordChangedAt` devient courant (sinon l'existant), l'autre va dans `passwordHistory`, compté « mis à
  jour ». `importGuid` identique ⇒ mise à jour en place (ré-importer le même export Firefox est idempotent).
- **Favoris** : clé = URL normalisée (schéma et hôte en minuscules, port par défaut, `#fragment` et `/` final
  retirés, requête conservée) dans le **même dossier cible** ⇒ ignoré.
- Toute l'opération est **un lot** : un seul passage dans l'outbox, un seul `importBatch`.

### 6.5 Export (toujours derrière le mot de passe principal, pas la biométrie seule)

- **Mots de passe CSV**, dialecte Chrome 5 colonnes `name,url,username,password,note` (Chrome, Firefox,
  Bitwarden, 1Password, Mots de passe Apple l'importent tous) ; feuille de confirmation calme : « ce fichier
  n'est pas chiffré ».
- **Favoris HTML** Netscape avec dossiers (`<H3>`) et `ADD_DATE` en secondes.
- **Sauvegarde chiffrée `.qafila`** : `{ "format":"qafila-backup", "v":1, "vaultId", "kdf":{…}, "slot":{ n, ct }, "records":[enveloppes] }`
  — en-tête avec un emplacement mot de passe (phrase choisie à l'export) + toutes les enveloppes. Importable
  dans un Qafila vierge (fusion normale), c'est **la sauvegarde périodique recommandée**, sans serveur. Rappel
  discret tous les 90 jours (désactivable).
- Via la feuille de partage (iOS), le sélecteur « créer un document » SAF (Android), une boîte d'enregistrement
  (PC). Rien ne transite par le relais.

---

## 7. Remplissage automatique

### 7.1 Dans le navigateur (trois plateformes, phase 1)

Un seul script de contenu `shared/web/qafila-forms.js` (ES2017, sans dépendance), embarqué tel quel sur chaque
plateforme comme le sont déjà les scripts d'assombrissement et de temps de lecture (`Scripts.swift`, `Scripts.kt`) :

- s'exécute au `document start` dans le **cadre principal** et les iframes **de même origine** seulement ;
- repère `input[type=password]` et le champ identifiant associé (dans l'ordre : `autocomplete="username"|"email"`,
  `type=email`, le champ texte précédent le plus proche dans le même `<form>`, sinon le même conteneur) ; détecte
  les formulaires d'inscription (`autocomplete="new-password"` ou deux champs mot de passe) et de changement ;
- poste à la partie native des **descripteurs** `{ kind:"forms", isTopFrame, formAction, fields:[{id, role}] }` ;
  **il ne reçoit jamais la liste du coffre** et n'expose aucune API à la page ;
- reçoit `fill {fieldId, value}` **une fois**, après le tap de l'utilisateur, pose la valeur via le setter natif
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set`, compatible React/Vue) et émet
  `input`/`change` ; `generate` remplit les deux champs mot de passe ;
- signale `submitted {username, passwordChanged}` pour la proposition d'enregistrement.

Canaux : iOS `WKUserScript` dans un `WKContentWorld` dédié (isolé du JS de la page) + `WKScriptMessageHandler`,
remplissage via `evaluateJavaScript(in: frame, in: world)` ; Android `WebViewCompat.addDocumentStartJavaScript` +
`addWebMessageListener` (`androidx.webkit` déjà présent ; le `WebMessage` porte `sourceOrigin` et `isMainFrame`
natifs, dignes de confiance ; pas de monde isolé sur Android, d'où « aucune API exposée ») ; Electron `preload`
avec `contextIsolation`, `sandbox`, `nodeIntegration:false`, exécution dans un monde isolé
(`webFrameMain.executeJavaScriptInIsolatedWorld`), `event.senderFrame === webContents.mainFrame` vérifié.

**Interface, style Quiche** : champ identifiant focalisé + correspondance ⇒ une carte blanche (rayon 12,
typographie de la carte d'adresse : DOMAINE en petites capitales + « lina@… ») au-dessus du clavier (zone des
suggestions que l'éditeur d'adresse utilise déjà) ou ancrée au-dessus de la barre sur PC ; plusieurs
correspondances ⇒ pastilles horizontales ; tuile « Générer un mot de passe » sur les inscriptions ; appui long sur
un champ ⇒ « Mots de passe… » (recherche dans tout le coffre). **Tap obligatoire, jamais d'insertion
automatique, jamais de soumission automatique.** Après soumission avec un couple nouveau ou un mot de passe
changé : carte « Enregistrer dans Qafila ? » / « Mettre à jour ? » avec « Jamais pour ce site » (`neverSaveHere`).
Raccourci PC Ctrl/Cmd+Maj+L. Chip clé à droite de la carte d'adresse quand un formulaire est détecté.

**Correspondance d'origine** (`shared/AUTOFILL_HEURISTICS.md`), décidée **côté natif** depuis l'URL de la vue
(`webView.url` / `WebView.getUrl()` / `webContents.getURL()`), jamais depuis la page :
1. premier rang : **hôte exact** (`www.` équivalent à l'apex), même schéma, même port ;
2. second rang, affiché sous un libellé explicite (« login.aeon.co ») : même domaine enregistrable (eTLD+1 via
   la Public Suffix List compacte `shared/web/psl-compact.dat`, régénérée mensuellement par CI ; Swift : petit
   analyseur embarqué ; Android : `PublicSuffixDatabase` d'OkHttp ou le fichier ; TS : `tldts`) — rempli
   après un tap explicite puis mémorisé dans `origins`.

> **Décision.** Hôte exact seul (proposition « simplicité ») est le plus sûr mais fait passer
> `accounts.google.com`, `login.microsoftonline.com` par un détour à chaque fois ; eTLD+1 seul expose aux
> sous-domaines hébergés par des tiers. Le second rang **étiqueté et mémorisé** combine les deux.

Jamais proposé : page `http://` pour un identifiant `https://` (carte d'avertissement à la place), erreur TLS,
`about:`/`file:`/`data:`/`blob:`, iframes d'une autre origine, onglets privés sauf réglage. Hôtes IDN comparés en
punycode ; mélange d'alphabets ⇒ forme `xn--` affichée en rouge. `formActionOrigin` et `httpRealm` ne servent qu'au
classement ; si le formulaire envoie vers une autre origine, la carte le dit.

### 7.2 Fournisseurs système (phase 4)

- **iOS** : cible d'extension `QafilaAutoFill` (`ASCredentialProviderViewController`) dans le même projet
  XcodeGen, entitlement `com.apple.developer.authentication-services.autofill-credential-provider`, App Group
  `group.fr.qafila.QafilaBrowser` (fichiers du coffre) et groupe d'accès Keychain partagé (DUK). L'extension
  déverrouille par Face ID via l'emplacement `device` **uniquement**, liste les identifiants pour les
  `serviceIdentifiers` fournis, et alimente `ASCredentialIdentityStore` (service = hôte, utilisateur, id) pour
  les suggestions QuickType dans Safari et toutes les applis. L'index Apple stocke hôtes et noms d'utilisateur en
  clair local : documenté, désactivable. Attendre un travail manuel sur l'App ID dans le portail développeur
  malgré la signature automatique. Passkeys (`ASPasskeyCredentialRequest`) : phase 5.
- **Android** : `QafilaAutofillService` (`android.service.autofill`, API 26+) analyse l'`AssistStructure`
  (`getWebDomain` pour Chrome/WebView, nom de paquet pour les applis, vérifié via **Digital Asset Links**
  quand disponible, sinon demandé une fois : « Associer l'application Aeon à aeon.co ? » → `origins` reçoit
  `app:com.aeon`), répond par des `Dataset` **exigeant une authentification** (`IntentSender` vers une activité
  `BiometricPrompt` : aucun secret exposé avant), `InlinePresentation` dans le clavier sur API 30+, `SaveInfo` pour
  la proposition d'enregistrement ; déclaré avec `BIND_AUTOFILL_SERVICE` et une activité de réglages ;
  **jamais** `MANAGE_EXTERNAL_STORAGE`. Credential Manager (API 34) et passkeys : phase 5.
- **PC** : les onglets de Qafila seulement. Pas d'extension pour Chrome/Firefox (hors périmètre, dit clairement).

### 7.3 Générateur et rapport

Générateur : CSPRNG avec **échantillonnage par rejet** (pas de biais modulo), 20 caractères par défaut
(curseur 12–64, majuscules/minuscules/chiffres/symboles, « éviter les caractères ambigus »), ou phrase de 4 à 6
mots depuis `shared/wordlist-fr-en.txt` (7 776 mots, type EFF large), séparateur et capitalisation réglables ;
copie avec expiration 60 s. Rapport local (Réglages › Mots de passe › Rapport) : mots de passe réutilisés,
faibles, de plus d'un an, sites en `http://`. Vérification des fuites connues (Have I Been Pwned, k-anonymat,
5 premiers hex du SHA-1, depuis l'appareil, jamais via le relais) : **opt-in explicite, phase 5**, nommée comme
service tiers dans la page confidentialité.

---

## 8. Application PC

### 8.1 Pile retenue : Electron

**Electron** (stable courant, mis à jour chaque mois pour les CVE Chromium) + TypeScript ; interface du
« chrome » en **Preact + Vite** ; `WebContentsView` par onglet ; `electron-builder` ; `electron-updater`.

Pourquoi pas Tauri 2 : pour un **navigateur**, un seul moteur (Chromium) sur Windows/macOS/Linux garantit que
bloqueur, assombrissement, lecture, scripts et remplissage se comportent à l'identique ; `session.webRequest`
permet le bloqueur de publicités/traqueurs/bandeaux (`@ghostery/adblocker-electron` avec EasyList, EasyPrivacy et
« I don't care about cookies », miroir des listes mobiles) là où WebKitGTK ne l'expose pas et WebView2
partiellement ; les webviews multiples de Tauri sont encore derrière un drapeau instable ; WebKitGTK est lent
et pauvre en codecs. Prix accepté : ≈ 100 Mo d'installeur, ≈ 200 Mo de RAM au repos. Si cela devait changer,
l'interface est du web et le cœur du TypeScript : seuls l'hôte d'onglets et le bloqueur changeraient.

Durcissement : `contextIsolation`, `sandbox`, `nodeIntegration:false` sur **tous** les renderers ; CSP stricte ;
aucun code distant dans l'interface ; crypto, synchro, fichiers et bloqueur dans le **processus main**, exposés
par un IPC typé (`contextBridge`) validé canal par canal ; DevTools désactivés en release ; navigation gardée
(`window.open` vers l'origine de l'interface refusé) ; pas de clés API Google, correcteur orthographique
désactivé, pas de rapporteur de plantage, DoH laissé à l'OS, le mise-à-jour ne parle qu'à `github.com`
(réglage « Vérifier les mises à jour », activé, désactivable).

### 8.2 Parité avec le design mobile (DESIGN.md appliqué à la lettre)

Une fenêtre = une barre + une page. Pas de bandeau d'onglets classique.

- **Barre** : la même rangée unique `‹ › ⇪ + ▢7 ⋯` avec la carte d'adresse (DOMAINE 9,5 pt capitales,
  interlettrage 0,6 + titre 12,5 pt, favicon, pastille de lecture, chip clé), hauteur 44, marges 10,
  construite depuis la même liste d'actions (`shared/toolbar-actions.json` : noms identiques à
  `ToolbarAction.swift` et à l'enum Kotlin, libellés, drapeaux destructifs, presets du §7 de DESIGN.md), tailles
  17/20/23 et graisses Fine/Normale/Grasse (Lucide, trait 1,1–2 px), les six styles d'adresse, les trois styles
  de barre (Verre : `backdrop-filter` sur une capture 1/6 comme Android, vibrancy sur macOS, `mica` sur
  Windows 11), couleurs `#F2F2F7 / #111 / #8E8E93` et sombre `#1C1C1E / #2C2C2E`, rayons 12/18/14/999, polices
  système (SF Pro, Segoe UI, `system-ui`). **Position par défaut : En haut** sur PC (réglage conservé, non
  synchronisé depuis le mobile).
- **Menu flottant** : la même carte translucide de 250, rayon 18, tuiles pour les éléments sans intitulé, lignes
  de 42 pour les autres, destructifs en rouge, séparateurs 0,5, ressort 0,92 → 1 depuis le coin du bouton.
- **Onglets** : la même surcouche plein écran Liste / Grille 2–3 colonnes (captures `webContents.capturePage`),
  groupement par site, tris ; Ctrl/Cmd+Maj+A.
- **Page de démarrage** : « Qafila » en serif, tuiles de favoris et de dossiers.
- **Réglages** : la même arborescence et les **mêmes clés** (feuille centrée ≤ 560 px, ou deux colonnes au-delà de
  1 100 px), aperçu de la barre en direct ; grâce à la synchro des réglages, le PC hérite de la barre, du style
  d'adresse, de l'accent et du moteur du téléphone dès l'association ; les clés sans sens sur PC sont ignorées.
  Nouvelles pages partout : Mots de passe, Synchronisation, Importer depuis un autre navigateur ; nouvelles
  `ToolbarAction` : `passwords`, `sync`.
- **Spécifique PC, minimal** : raccourcis (Ctrl/Cmd+T, W, L, R, F, D, `,`, Maj+T, 1–9, Maj+A onglets,
  Maj+L mots de passe, Maj+N fenêtre privée = partition de session en mémoire), infobulles, pastille de
  téléchargement fine, menu contextuel bâti sur les mêmes libellés, fenêtre sans cadre (`hiddenInset` macOS,
  `titleBarOverlay` Windows, cadre natif Linux), barre de menus système réduite au minimum sur macOS et cachée
  (`autoHideMenuBar`) sur Windows/Linux : tout est dans `⋯`.

### 8.3 Empaquetage, signature, mise à jour

Workflow `.github/workflows/desktop.yml`, matrice `ubuntu-22.04 / windows-latest / macos-15`, `npm ci`,
`vitest`, `electron-builder --publish onTag` sur les tags `desktop-v*`, artefacts attachés à une **GitHub
Release** (brouillon, le propriétaire clique « Publish ») ; les PR produisent des artefacts non signés 7 jours.

| OS | Formats | Signature | Mise à jour |
|---|---|---|---|
| Linux | AppImage x64/arm64 + `.deb` ; Flatpak plus tard | aucune | AppImage en place (zsync) |
| Windows | NSIS par utilisateur (sans admin) + portable, x64/arm64 ; MSIX (`appx`) pour le Store | **non signé au départ** (SmartScreen « éditeur inconnu », page de téléchargement avec SHA-256 et capture de l'avertissement) → **SignPath Foundation** (gratuit, projet MIT, demande dès la phase 3) → Microsoft Store (19 $, signé par le Store, mise-à-jour Electron désactivé dans ce build) ; Azure Trusted Signing (≈ 10 $/mois) en dernier recours | NSIS différentiel |
| macOS | DMG + ZIP universels, hardened runtime, `build/entitlements.mac.plist` | Developer ID + **notarisation** par `@electron/notarize` sur le runner macOS avec la clé App Store Connect **déjà prévue** (`APP_STORE_CONNECT_KEY_ID/ISSUER_ID/KEY_CONTENT`, secrets existants) + certificat Developer ID Application (`CSC_LINK/CSC_KEY_PASSWORD`) ; sans Mac. Avant le compte Apple : ZIP non signé pour testeurs (« clic droit › Ouvrir ») | Squirrel.Mac, exige le build signé |

`electron-updater` lit `latest.yml / latest-mac.yml / latest-linux.yml` de la Release ; vérification au lancement
et toutes les 6 h, téléchargement en arrière-plan, ligne « Redémarrer pour mettre à jour » dans le menu et dans
À propos ; intégrité : sha512 du manifeste sur TLS + signature/notarisation vérifiée par l'OS sur macOS.
Dependabot sur Electron ; une sortie par mois fait partie du plan. Chemins : `%APPDATA%/Qafila`,
`~/Library/Application Support/Qafila`, `~/.config/Qafila`.

---

## 9. Code partagé et code natif

### 9.1 Partagé (le contrat, dossier `shared/` à la racine)

| Fichier | Contenu |
|---|---|
| `shared/CRYPTO.md` | §3 à l'octet : hiérarchie, paramètres, AAD, bourrage, emplacements, en-têtes, NFC, appairage, kit |
| `shared/sync/PROTOCOL.md` | endpoints, enveloppe, HLC, règles de fusion, limites, codes d'erreur, transport dossier |
| `shared/schema/*.schema.json` | envelope, header, login, bookmark, folder, setting, device, tabs, backup (validés par `ajv` ; source des types Swift/Kotlin) |
| `shared/SETTINGS_SYNC_KEYS.md` | liste blanche des clés et de leurs valeurs brutes |
| `shared/IMPORT_FORMATS.md`, `shared/AUTOFILL_HEURISTICS.md`, `shared/UX_FLOWS.md` | formats, correspondance d'origine, parcours et textes français (premier lancement, appairage, import, verrouillage) |
| `shared/vectors/` | `crypto-vectors.json`, `sync-merge-cases.json`, `url-normalization.json` |
| `shared/fixtures/import/` | CSV/HTML + `expected/*.json` |
| `shared/web/` | `qafila-forms.js`, `reading-time.js`, `darken.js` (unifier ce qui est aujourd'hui dupliqué dans `Scripts.swift`/`Scripts.kt`), `blocklist.txt` (dupliqué dans `ContentBlocker.swift`/`.kt`), `psl-compact.dat` |
| `shared/toolbar-actions.json` | actions, libellés, destructifs, presets |
| `shared/wordlist-fr-en.txt`, `shared/bip39-french.txt`, `shared/common-passwords-10k.txt`, `shared/i18n/{fr,en}.json` | listes et chaînes (iOS `L()` et `strings.xml` Android générés par un petit script) |
| `shared/tools/` | `gen-vectors.mjs`, `sync-shared.sh` (copie dans `ios-browser/QafilaBrowser/Resources/Shared`, `android-browser/app/src/main/assets/shared`, `desktop/resources/shared`) + contrôle CI de dérive (sha256) |

Job CI **« conformance »** : les mêmes vecteurs et fixtures sur les trois piles — `vitest` (TS), `XCTest` sur le
paquet Swift (runner macOS, sans simulateur), `JUnit` sur le module Kotlin (JVM pur, sans émulateur). ⚠️ Ni le
projet iOS ni le projet Android n'ont de cible de test aujourd'hui : la phase 0 les crée.

### 9.2 Cœur TypeScript `packages/qafila-core`

TS pur, sans DOM, sans API Node hors adaptateur crypto injecté : enveloppes et AAD, HLC, fusion LWW +
`passwordHistory`, lecture/écriture des fichiers du coffre, client de synchro (`fetch`, reprises, outbox), analyseurs
d'import et écrivains d'export, normalisation d'URL et eTLD+1, générateur et force, appairage, kit de secours.
Consommateurs : l'appli PC (processus main), **le relais** (validation d'enveloppe et règle `rev` : serveur et
client s'accordent par construction), un petit CLI pour produire les fixtures. **Pas** utilisé par les mobiles, ni
par le front `public/` (pas de secrets dans une page web ordinaire).

### 9.3 Ports natifs (écrits deux fois, volontairement)

- iOS : paquet SwiftPM local `ios-browser/QafilaCore` (Crypto, Vault, Sync, Import, Autofill matching ; dépend de
  `swift-sodium` seulement ; partagé par l'appli et l'extension AutoFill).
- Android : module Gradle JVM `android-browser/core` (`fr.qafila.core`, même découpage ; `bcprov-jdk18on`,
  `kotlinx-serialization` déjà présent, PSL).

Chaque port fait ~800–1 200 lignes, mécanique parce que la spécification est byte-exacte et que les vecteurs
tranchent. **Pas de cœur binaire unique** (Rust + UniFFI, Kotlin Multiplatform) : une chaîne d'outils que le
propriétaire ne fait pas tourner, du FFI à déboguer sans Mac sur GitHub Actions, alors que CryptoKit/Keystore
restent natifs de toute façon. Le **format** est le contrat, pas le code : un cœur Rust pourra remplacer les
trois plus tard sans migration si les bugs de divergence s'accumulent.

### 9.4 Natif seulement

Toute l'interface (SwiftUI, Compose, Preact) ; Keychain/Keystore/`safeStorage` et biométrie ; ponts WebView
(`WKUserScript` / `WebMessageListener` / preload) ; extension et service de remplissage système ; sélecteurs de
fichiers et feuilles de partage ; rafraîchissement en arrière-plan ; QR (génération : CoreImage
`CIQRCodeGenerator`, ZXing, petit générateur SVG ; lecture : `DataScannerViewController` ou
`AVCaptureMetadataOutput`, CameraX + ZXing core de préférence à ML Kit pour éviter les services Google) ;
StoreKit / Billing (inchangés).

---

## 10. Plan de livraison

| Phase | Contenu | L'utilisateur voit | Taille |
|---|---|---|---|
| **0 — Contrat** | `shared/CRYPTO.md`, `PROTOCOL.md`, schémas, vecteurs (script Node, nonces injectés, négatifs), fixtures d'import avec attendus, `qafila-forms.js`, `toolbar-actions.json`, listes, i18n ; cibles de test XCTest/JUnit/vitest et job « conformance » ; `ITSAppUsesNonExemptEncryption` et `export_compliance` corrigés ; unification `blocklist.txt` et scripts | rien (documentation et tests) | 1–2 sem. |
| **1 — Coffre local + import/export (iOS, Android)** | `QafilaCore` / `core` (Argon2id, AES-GCM, emplacements), création du coffre (mot de passe ≥ 12 + jauge, kit 24 mots en bannière douce), biométrie, verrouillage auto, écrans Mots de passe (liste, recherche, détail, édition, historique, générateur, rapport local) dans le style DESIGN.md, carte de remplissage + proposition d'enregistrement via `qafila-forms.js`, hygiène presse-papiers/`FLAG_SECURE`, dossiers de favoris (racine + `toolbar` en tuiles), import deux gestes (Chrome/Firefox CSV, Netscape HTML, « Ouvrir avec Qafila »), dédoublonnage, « Annuler cet import », suppression du fichier source, exports CSV/HTML/`.qafila`, nouvelle `ToolbarAction` `passwords`, Réglages › Mots de passe, guide par navigateur | « Qafila garde vos mots de passe, chiffrés sur l'appareil ; venez de Chrome ou Firefox en deux gestes » | 5–6 sem. |
| **2 — Synchronisation** | module `src/relay/` (`node:sqlite`, quotas, boîte d'appairage liée à la clé, tests), déploiement avec volume, migration favoris/réglages en niveau 2, outbox, fusion, points de contrôle anti-rejeu, appairage QR deux modes + SAS, kit de secours comme repli, Réglages › Synchronisation (serveur, appareils, associer, retirer = renouveler la clé, désactiver et effacer, date d'expiration), page confidentialité et fiches mises à jour | « Vos deux téléphones (ou téléphone + tablette) partagent favoris, réglages et mots de passe, sans compte » | 4–5 sem. |
| **3 — Application PC v1** | `packages/qafila-core`, `desktop/` Electron (onglets `WebContentsView`, barre/menu/onglets/démarrage/réglages depuis `toolbar-actions.json`, bloqueur Ghostery, scripts réutilisés), coffre + remplissage + import (fichiers, glisser-déposer, profils Chrome/Firefox pour les favoris) + synchro depuis le cœur TS, appairage côté « nouveau » (QR affiché), restauration par kit, « Se souvenir sur cet ordinateur », `desktop.yml` (AppImage/deb, NSIS/portable non signés, DMG notarisé dès le compte Apple), `electron-updater`, page de téléchargement avec SHA-256, demande SignPath | « Qafila sur votre PC, avec l'allure de votre téléphone et vos données » ; Linux et Windows d'abord, macOS dès la signature | 6–8 sem. |
| **4 — Remplissage système** | extension iOS AutoFill (App Group, Keychain partagé, `ASCredentialIdentityStore`, `project.yml` + fastlane), `QafilaAutofillService` Android (datasets authentifiés, inline, `SaveInfo`, Digital Asset Links), CTA après import, fiches, Data safety, étiquette confidentialité ; TestFlight et piste interne | « Qafila remplit vos mots de passe dans Safari, Chrome et toutes vos applis » | 3–4 sem. |
| **5 — Options, à la demande** | transport « via un dossier » (séquences chiffrées, descripteur chiffré), onglets des autres appareils et « Envoyer à… », TOTP, imports Safari/Bitwarden/1Password, Credential Manager + passkeys, HIBP opt-in, Touch ID/Windows Hello sur PC, Microsoft Store, Flatpak, quotas pour soutiens par reçu hors ligne, relecture externe | selon l'option | moyen chacune |

La phase 3 peut démarrer en parallèle de la 2 dès que `packages/qafila-core` existe (le cœur TS est le même) :
c'est ainsi que l'appli PC, demandée en premier, arrive le plus tôt sans doubler le chantier de synchro.

---

## 11. Risques et parades

1. **Perte de la clé** (irréversible, par conception). Kit de secours à la création avec bannière douce,
   PDF imprimable, « n'importe quel appareil associé peut reposer un mot de passe », sauvegarde `.qafila`
   rappelée tous les 90 jours, phrase unique « Qafila ne peut pas récupérer votre coffre », explication du
   ré-enrôlement biométrique (le mot de passe est redemandé une fois). Page d'aide prête : ces demandes arriveront.
2. **Erreur de crypto dans l'une des trois langues.** Aucune primitive maison, spécification byte-exacte,
   vecteurs standards + Qafila + **négatifs** en CI sur les trois piles, nonces aléatoires 96 bits sous la borne
   2³² (interdiction des compteurs), AAD liant coffre/id/niveau/génération/révision, NFC imposé, dépendances
   épinglées (`swift-sodium`, `bcprov`, `hash-wasm`) ; relecture externe avant le mot « sécurisé ».
3. **Conflits et pertes à la synchro.** LWW sur HLC authentifié, `passwordHistory`, tombstones AEAD, outbox
   persistée avant tout réseau, idempotence, borne de 24 h sur l'horloge, jamais de correction d'horloge par le
   serveur, `sync-merge-cases.json`, historique visible par identifiant.
4. **Relais hostile, piraté ou abusé.** Chiffré seul et hachés de jetons ; pas de CDN ; limites par IP, quotas,
   purge, taille de corps, `DELETE` sous jeton, sauvegardes chiffrées ; rétention/rejeu détectés (pas empêchés) ;
   publication de « ce que voit le relais » sur la page confidentialité.
5. **Téléphone volé avec PIN compromis.** Niveau 2 et jeton de synchro accessibles, mots de passe non ; révocation
   par renouvellement depuis un autre appareil ; onboarding qui recommande un code fort.
6. **Appairage.** Photo d'un QR inoffensive (clé éphémère publique seulement) ; boîte liée à la clé ; SAS sur les
   deux écrans ; TTL 10 min ; jamais de VMK ni de jeton en clair.
7. **Validation des stores.** Apple : extension AutoFill et formulation « gestionnaire de mots de passe »
   conformes à 5.1.1, étiquette « Données non reliées à vous », explication de la caméra (QR),
   **`ITSAppUsesNonExemptEncryption` passe à `true`** et `export_compliance_uses_encryption` dans le `Fastfile` est
   mis en cohérence, questionnaire d'export répondu honnêtement (chiffrement standard protégeant les données de
   l'utilisateur ; vérifier au moment de la soumission si un rapport annuel est exigé) ; **France** : vérifier la
   formalité ANSSI (déclaration / dispense pour un logiciel grand public à chiffrement standard) avant la première
   soumission. Google : déclaration du service de remplissage, Data safety (« aucune collecte », blobs chiffrés de
   bout en bout en transit), **jamais** `MANAGE_EXTERNAL_STORAGE` ; export CSV derrière authentification = standard
   des gestionnaires approuvés. Le coffre reste **optionnel** : le navigateur sort même si une validation traîne.
8. **SmartScreen / Gatekeeper.** Page de téléchargement honnête (SHA-256, capture de l'avertissement), SignPath
   demandé tôt, notarisation branchée le jour où le compte Apple est approuvé, Store ensuite.
9. **Dette Electron.** Dependabot, cadence mensuelle, sandbox partout, pas de contenu distant, navigation gardée ;
   taille acceptée ; Tauri reste une sortie possible (interface web, cœur TS).
10. **Remplissage dans la page.** Valeur lisible une fois posée (inhérent) : tap obligatoire, origine native, mondes
    isolés, aucune API exposée, cadre principal / même origine seulement, pas de soumission auto ; index
    `ASCredentialIdentityStore` désactivable.
11. **Fichiers en clair et fuites d'écran.** Suppression proposée après import, avertissements à l'export,
    presse-papiers 60 s, `FLAG_SECURE`/flou, aucune journalisation des charges (lint CI).
12. **Hébergement.** Le déploiement actuel (Alpine, sans volume) n'est pas prêt : prévoir le VPS + volume ou un
    volume payant avant la phase 2 ; `node:sqlite` évite les modules natifs sur musl.
13. **Développeur seul.** Tout est dans `shared/` : n'importe quelle plateforme se reconstruit ; MIT et dépôt public
    pour que les utilisateurs auto-hébergent le relais si le projet s'arrête ; phases livrables une à une ; TOTP,
    passkeys, dossier, extension navigateur, HIBP explicitement en phase 5.
14. **Dérive de périmètre vers un « vrai » gestionnaire.** Garder la règle Quiche : un écran Mots de passe, un
    écran Synchronisation, une page Import ; chaque ajout (rapport, HIBP, inline) doit tenir dans une ligne de
    réglage ou disparaître.
