# Qafila — import et export : Chrome, Firefox, HTML Netscape, sauvegarde `.qafila`

Contrat partagé entre les trois implémentations (Swift `ios-browser/QafilaCore`, Kotlin `android-browser/core`,
TypeScript/Electron). Il précise le §6 de `COFFRE-SYNC.md` : ce que Qafila accepte, comment il le lit, comment il
le range dans le coffre (§4 du document de référence), ce qu'il refuse et ce qu'il écrit à l'export. Là où ce
document est précis, les trois ports doivent produire **le même JSON** à partir des fixtures de
`shared/fixtures/import/` ; là où `COFFRE-SYNC.md` restait vague, la décision est prise ici (§12).

Référence exécutable : `shared/import/parse.mjs` (module ES2017 sans dépendance, chargeable dans Node, Electron
et un navigateur). Tests : `shared/test/import.test.mjs`. Attendus : `shared/fixtures/import/expected/*.json`.

> `COFFRE-SYNC.md` §6.3 et §9.1 nomment ce fichier `IMPORT_FORMATS.md` ; le brief de la phase 0 le nomme
> `IMPORT.md`. C'est ce fichier qui fait foi ; les renvois seront corrigés dans `COFFRE-SYNC.md`.

---

## 1. Périmètre

| Entrée | Phase | Fonction de référence |
|---|---|---|
| CSV des mots de passe de Chrome, Edge, Brave, Google Password Manager | 1 | `parseChromeCsv` |
| CSV des identifiants de Firefox | 1 | `parseFirefoxCsv` |
| HTML Netscape des favoris (Chrome, Edge, Brave, Firefox, Safari, Vivaldi…) | 1 | `parseNetscapeHtml` |
| Sauvegarde chiffrée `.qafila` | 1 | `CRYPTO.md` §11 (reconnue ici, lue ailleurs) |
| CSV Safari, Bitwarden, 1Password | 5 | reconnus (« bientôt »), refusés |
| Profils Chrome/Firefox lus directement (PC, favoris seulement) | 3 | hors de ce document |

Tout se passe sur l'appareil, en mémoire : rien n'est envoyé, rien n'est journalisé (les structures contiennent
des mots de passe en clair ; la règle de lint CI « aucun journal contenant `password` » s'applique à ce code).

---

## 2. Détection par le contenu

Le format est **toujours** détecté par le contenu, jamais par l'extension ni le type MIME (Android étiquette mal
les CSV, Mail renomme les pièces jointes). `detect(text)` renvoie `{ format, source, supported, reason }` :

| Condition (après retrait d'un BOM U+FEFF) | `format` | `source` | `supported` |
|---|---|---|---|
| premier caractère non blanc `{` et `"format":"qafila-backup"` dans les 64 premiers Kio | `qafila-backup` | `qafila` | oui (lu par le code de sauvegarde) |
| texte commençant par `<`, ou contenant `<!DOCTYPE NETSCAPE-Bookmark-file-1>` / `<DL><p>` ; et au moins l'un de : ce doctype, `<DL><p>`, `<DT><A`, `<DT><H3` (dans les 64 premiers Kio, casse libre) | `netscape-html` | voir §3.4 | oui |
| texte commençant par `<` sans ces marques | `null` | — | non, `reason: "html-not-bookmarks"` |
| premier enregistrement CSV (§3.1) dont les colonnes, en minuscules, contiennent `url, username, password, httprealm, formactionorigin, guid` | `firefox-csv` | `firefox` | oui |
| … contiennent `name, url, username, password` | `chrome-csv` | `chrome` | oui |
| … contiennent `title, url, username, password, otpauth` | `safari-csv` | `safari` | non, `reason: "phase-5"` |
| … contiennent `folder, type, name, login_uri, login_username, login_password` | `bitwarden-csv` | `bitwarden` | non, `reason: "phase-5"` |
| premier enregistrement d'au moins 3 colonnes, aucun des jeux ci-dessus | `null` | — | non, `reason: "csv-unknown-header"` |
| sinon | `null` | — | non, `reason: "unknown"` |

L'ordre des colonnes et leur casse sont libres, les colonnes supplémentaires sont ignorées : on teste
l'**inclusion** des noms requis, Firefox avant Chrome (leurs jeux sont disjoints : Firefox n'a pas `name`).
`parse(text)` enchaîne la détection et l'analyse ; un format reconnu mais non pris en charge lève
`ImportError("E_UNSUPPORTED")` (texte : « Les exports Safari arrivent bientôt »), un contenu inconnu
`E_UNKNOWN_FORMAT` (« Ce fichier n'est ni un export de mots de passe ni un fichier de favoris »).

---

## 3. Formats acceptés

### 3.1 CSV (commun à Chrome et Firefox)

Automate RFC 4180 **tolérant**, `parseCsv(text)` :

- séparateur `,` ; fins d'enregistrement `CRLF`, `LF` ou `CR` seul ; un enregistrement final sans fin de ligne est accepté ;
- un champ commençant par `"` est cité jusqu'au `"` fermant ; `""` à l'intérieur vaut `"` ; virgules et sauts de ligne
  y sont littéraux ; **les sauts de ligne internes sont uniformisés en `LF`** (un fichier CRLF ne produit jamais
  de `\r` dans une note) ; un guillemet fermant absent cite jusqu'à la fin du fichier (tolérance) ; du texte entre
  le `"` fermant et le séparateur est conservé ;
- un `"` qui n'ouvre pas un champ est littéral (`a,b"c,d` ⇒ `a` · `b"c` · `d`) ;
- les enregistrements dont **tous** les champs sont vides (lignes vides, `,,,,`) sont supprimés et **ne comptent pas** ;
- aucune conversion de type : tout est chaîne ; les champs manquants d'une ligne courte valent `""`, les champs en
  trop sont ignorés ; les colonnes sont lues **par nom d'en-tête** (minuscules, espaces retirés), jamais par position.

Numérotation : `row` dans `skipped[]` est l'indice de l'enregistrement **parmi les enregistrements non vides**,
`1` = première ligne de données (un CSV avec des notes multilignes n'a pas de « numéro de ligne » fiable).

### 3.2 CSV Chrome (`name,url,username,password[,note]`)

Produit par `chrome://password-manager/settings` › Exporter, Edge, Brave et Google Password Manager (web). UTF-8,
BOM fréquent, `note` absente dans les anciennes versions. Par ligne :

| Colonne | Traitement |
|---|---|
| `url` | espaces retirés, puis **origine** (§4.1) via `loginOrigin` : `android://<hash>@<package>/` ⇒ `app:<package>` ; sinon `normalizeOrigin` ; `null` ⇒ ligne ignorée `invalid-origin` |
| `name` | espaces retirés ⇒ `title` ; vide ⇒ libellé de l'origine (`aeon.co`, `aeon.co:8443`, `com.example.app`) |
| `username`, `password`, `note` | tels quels (pas de `trim` : un espace peut faire partie d'un mot de passe) ; `note` absente ⇒ `""` |
| dates | aucune : `createdAt`, `lastUsedAt`, `passwordChangedAt` = `null` (l'appli pose le moment de l'import, §6) |

### 3.3 CSV Firefox (`url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged`)

Produit par `about:logins` › ⋯ › Exporter. Tous les champs cités, `LF`. Par ligne :

| Colonne | Traitement |
|---|---|
| `url` | origine (§4.1) ; `null` ⇒ `invalid-origin` (ex. `chrome://settings`, `about:`) |
| `httpRealm` | non vide ⇒ `httpRealm` tel quel et `title` = `Authentification HTTP · <libellé>` ; vide ⇒ `null` et `title` = libellé de l'origine |
| `formActionOrigin` | vide ⇒ `null` ; sinon `normalizeOrigin` (le `/` final de Firefox disparaît ; invalide ⇒ `null`) |
| `guid` | espaces retirés ⇒ `importGuid` (`{…}` conservé tel quel) ; vide ⇒ `null` |
| `timeCreated`, `timeLastUsed`, `timePasswordChanged` | millisecondes Unix ; `0`, vide ou non numérique ⇒ `null` (§4.3) |
| `note` | n'existe pas ⇒ `""` |

### 3.4 HTML Netscape (favoris)

Jamais un analyseur XML ni un DOM : les fichiers ne sont pas bien formés (`<DT>` et `<p>` jamais fermés, `<DL><p>`,
attributs `ICON` de plusieurs Kio). `tokenizeHtml` découpe en balises et textes avec un scanner qui :

- saute `<!-- … -->`, `<!DOCTYPE …>` et `<? … ?>` ; met les noms de balises et d'attributs en minuscules ;
- lit les attributs `NAME="v"`, `NAME='v'`, `NAME=v`, `NAME` (⇒ `""`), le premier gagne en cas de doublon ; un `>` entre
  guillemets ne ferme pas la balise ; les valeurs d'attributs et les textes sont décodés : `&amp; &lt; &gt; &quot;
  &apos; &nbsp; &#NNN; &#xHH;` (points de code invalides ou substituts ⇒ U+FFFD) ; **toute autre entité nommée reste
  telle quelle** (Chrome et Firefox écrivent les accents en UTF-8, pas en `&eacute;`) ;
- les textes sont normalisés : blancs consécutifs ⇒ un espace, espaces de bord retirés ; `<br>` vaut un espace.

Structure (`parseNetscapeHtml`), avec une pile de conteneurs :

| Balise | Effet |
|---|---|
| `<H1>…</H1>` | `title` du résultat (premier seulement) ; sert à la détection de la source |
| `<DT><H3 …>nom</H3>` | crée un **dossier** dans le conteneur courant : `name` (vide ⇒ `Sans titre`), `addedAt` = `ADD_DATE`, `modifiedAt` = `LAST_MODIFIED` (§4.3), `role`, `toolbar` ; il devient « en attente » de son `<DL>` |
| `<DL>` | le premier `<DL>` sans dossier en attente est le conteneur racine ; ensuite : ouvre le dossier en attente (ses enfants vont dedans) ; un `<DL>` sans dossier en attente est transparent |
| `</DL>` | ferme le conteneur courant ; les `</DL>` manquants en fin de fichier sont tolérés |
| `<DT><A HREF=… ADD_DATE=… LAST_MODIFIED=…>titre</A>` | **favori** dans le conteneur courant : `title` (vide ⇒ l'URL), `url` = `HREF` avec espaces retirés, **non normalisée** (on garde ce que l'utilisateur avait), `addedAt`, `modifiedAt` |
| `<DD>texte` | `note` de l'élément précédent (dossier ou favori), jusqu'à la prochaine balise de structure ; plusieurs `<DD>` se concatènent avec `\n` |
| `<HR>` | séparateur Firefox : **compté** (`counts.separators`), pas représenté (le modèle n'en a pas) |
| `ICON`, `ICON_URI`, `TAGS`, `SHORTCUTURL`, `LAST_CHARSET`, `FEEDURL`, `WEB_PANEL` | ignorés sans compteur (favicons re-téléchargées, mots-clés et étiquettes sans équivalent) |

Favoris ignorés **avec compteur** (`skipped[]`, `reason`) : `missing-url` (pas de `HREF`), `unsupported-scheme`
(tout ce qui n'est pas `http://` ou `https://` : `place:`, `javascript:`, `chrome://`, `about:`, `file:`, `data:`,
`ftp:`, `moz-extension://`…), `invalid-url` (schéma http(s) mais URL non analysable), `field-too-long` (§5).
Chaque entrée porte `title`, `url` et `path` (noms des dossiers ouverts).

Rôles des conteneurs (`role`, premier niveau seulement pour les noms ; attributs à tout niveau) :

| `role` | Attribut | Noms reconnus (casse libre) |
|---|---|---|
| `toolbar` | `PERSONAL_TOOLBAR_FOLDER` ≠ `false` | Bookmarks bar, Barre de favoris, Bookmarks Toolbar, Barre personnelle, Barre des favoris, Favorites bar |
| `unfiled` | `UNFILED_BOOKMARKS_FOLDER` ≠ `false` | Other bookmarks, Autres favoris, Unfiled Bookmarks, Autres marque-pages, Unfiled |
| `menu` | — | Bookmarks Menu, Menu des marque-pages |
| `mobile` | — | Mobile Bookmarks, Marque-pages mobiles, Favoris mobiles, Favoris sur mobile |
| `internal` | — | Mozilla Firefox — **retiré de l'arbre**, compté `skipped[{reason:"internal-folder", bookmarks:n}]` |
| `null` | — | tout autre dossier |

`toolbar` (booléen) vaut `role === "toolbar"`. Un dossier imbriqué nommé « Bookmarks bar » n'a pas de rôle.

Formes réelles à connaître : **Chrome** met le contenu de « Autres favoris » **directement à la racine** (après le
dossier `PERSONAL_TOOLBAR_FOLDER`), `<H1>Bookmarks</H1>`, dates en secondes, parfois en µs WebKit dans de vieux
exports. **Firefox** : `<H1>Bookmarks Menu</H1>`, la racine **est** le menu, « Bookmarks Toolbar » et « Other
Bookmarks » (`UNFILED_BOOKMARKS_FOLDER`) sont des dossiers, « Mobile Bookmarks » sans attribut, un `<DD>` de
description sous la barre, des `place:` en tête, `<HR>`, `ICON_URI`, `LAST_CHARSET`, une balise
`<meta http-equiv="Content-Security-Policy">`.

Source (`detectNetscapeSource`) : `firefox` si `UNFILED_BOOKMARKS_FOLDER`, `LAST_CHARSET=` ou
`Content-Security-Policy` apparaissent, ou si `<H1>` est un nom de `menu` ; `chrome` si `<H1>` vaut Bookmarks,
Favoris ou Favorites ; sinon `unknown`. La source ne change que le nom du dossier d'import (§6) et le texte de
l'aperçu.

---

## 4. Normalisation

### 4.1 Origine d'un identifiant — `normalizeOrigin(url)`

Résultat `scheme://host[:port]`, conforme au schéma `common.schema.json#/$defs/origin`, ou `null` :

1. espaces de bord retirés ; chaîne vide ⇒ `null` ;
2. **sans schéma** (pas de `xxx:` en tête, ou un `:` suivi d'un chiffre — `localhost:3000` est un port) ⇒ `https://` ajouté ;
3. analyse WHATWG URL (`new URL`, `URLComponents`, `java.net.URI` + corrections ci-dessous) ; échec ⇒ `null` ;
4. schéma ∉ {`http`, `https`} ⇒ `null` (`ftp:`, `javascript:`, `mailto:`, `chrome://`, `about:`, `file:`, `data:`…) ;
5. hôte : minuscules, **IDN en punycode** (`médiathèque.example.tn` ⇒ `xn--mdiathque-53af.example.tn`), point final
   retiré, IPv6 entre crochets conservé ; hôte vide ⇒ `null` ;
6. port : retiré s'il vaut le port par défaut du schéma (`:443` pour https, `:80` pour http), conservé sinon ;
7. identifiants `user:pw@`, chemin, requête, fragment **supprimés**.

`http://www.example.org` et `https://www.example.org` sont **deux origines** (pas de rétrogradation, §2 du document
de référence) ; `aeon.co` et `www.aeon.co` aussi (l'équivalence `www.`/apex relève de la correspondance au
remplissage, `AUTOFILL_HEURISTICS.md`, pas du stockage).

`loginOrigin(url)` ajoute les applications Android : `android://<hash>@<package>/` (Chrome) et `app:<package>`
(export Qafila, §10.1) ⇒ `app:<package>` (`[A-Za-z0-9_.]+`). Le `hash` du certificat est ignoré (phase 4 :
Digital Asset Links). Ces identifiants sont comptés (`counts.androidApps`) et montrés dans l'aperçu (« dont 3
applications Android »).

Notes de portage : Node/Electron et Kotlin (`java.net.IDN.toASCII`) ont le punycode ; Swift n'en a pas dans
Foundation : le port embarque RFC 3492 appliqué après `lowercased()` + NFC (suffisant pour les hôtes réels ;
les cas limites UTS #46 ne sont pas couverts, et les exports Chrome/Firefox contiennent déjà des hôtes punycode).

### 4.2 Clé d'un favori — `bookmarkKey(url)`

Sert **uniquement** au dédoublonnage (§7.2) ; le champ `url` stocké reste celui du fichier. Même analyse qu'en
4.1 puis : schéma et hôte en minuscules (punycode), port par défaut retiré, **fragment retiré**, **un `/` final du
chemin retiré** (`/` seul ⇒ rien), requête conservée telle quelle, identifiants conservés, chemin sensible à la
casse. Non http(s) ou invalide ⇒ `null`. Exemples : `https://aeon.co/` ⇒ `https://aeon.co` ;
`https://a.co:443/x/#top` ⇒ `https://a.co/x` ; `https://a.co/?q=1` ≠ `https://a.co/?q=2`.

### 4.3 Horodatages — `normalizeTimestamp(value)`

Entrée : chaîne ou nombre. Non numérique, `≤ 0` ⇒ `null` (Firefox écrit `0` pour « jamais utilisé »). Sinon,
règle unique pour CSV et HTML : `> 10¹⁶` ⇒ **microsecondes WebKit depuis 1601** (`round(v / 1000) − 11 644 473 600 000`) ;
`> 10¹²` ⇒ déjà en millisecondes ; sinon **secondes** × 1000. Résultat entier (ms Unix, convention Android).
Exemples : `1700000000` ⇒ `1700000000000` ; `1763290000000` ⇒ `1763290000000` ; `13318200000000000` ⇒ `1673726400000`.

---

## 5. Refus et limites

| Cas | Où | Effet |
|---|---|---|
| fichier > **50 Mio** (`MAX_FILE_BYTES`) | plateforme, sur la taille en octets **avant** décodage ; l'analyseur revérifie `text.length` | `ImportError("E_TOO_LARGE")`, rien n'est lu : « Ce fichier dépasse 50 Mo » |
| en-tête CSV sans les colonnes requises | `parseChromeCsv` / `parseFirefoxCsv` | `E_HEADER` (la détection l'évite ; protège les appels directs) |
| fichier vide ou lignes vides seulement | idem | `E_EMPTY` |
| ligne sans `url`, `username` ni `password` | CSV | ignorée, `reason: "empty"` |
| `url` sans origine http(s)/android valide | CSV | ignorée, `reason: "invalid-origin"` (l'URL figure dans `skipped[].url` pour l'écran de détail) |
| mot de passe > **1 Kio** UTF-8 (`MAX_PASSWORD_BYTES`) | CSV | ignorée, `reason: "password-too-long"` (le schéma tolère 4 Kio ; 1 Kio est la borne d'import : au-delà ce n'est pas un mot de passe mais un fichier collé) |
| titre, nom d'utilisateur, note, URL, realm > **32 Kio** UTF-8 (`MAX_FIELD_BYTES`) | CSV, HTML | ignorée, `reason: "field-too-long"` |
| favori sans `HREF` / schéma non http(s) / URL invalide | HTML | ignoré, `reason` §3.4 |
| dossier interne « Mozilla Firefox » (premier niveau) | HTML | retiré, `reason: "internal-folder"` |
| mot de passe vide, nom d'utilisateur vide | CSV | **acceptés** (certains sites n'ont pas d'identifiant ; Firefox exporte des mots de passe vides) |
| doublons | §7 | fusionnés, jamais refusés |

Les contrôles d'une ligne CSV s'appliquent **dans cet ordre** : `empty`, `invalid-origin`, `password-too-long`,
`field-too-long` (une seule raison par ligne, la première). L'écran d'aperçu dit « 3 lignes ignorées » avec un
lien « Voir » listant `row`, `reason`, `url`.

---

## 6. Du résultat d'analyse aux enregistrements du coffre

Les analyseurs renvoient des objets **déterministes** (ni identifiant, ni date « maintenant ») pour que les
attendus soient comparables ; l'application les transforme ensuite en enregistrements `COFFRE-SYNC.md` §4.1. Les
champs non listés ici ne sont pas produits.

### 6.1 Formes intermédiaires

```json
{ "format": "chrome-csv" | "firefox-csv", "source": "chrome" | "firefox",
  "logins": [ { "title": "aeon.co", "origins": ["https://aeon.co"], "username": "lina@example.org", "password": "…",
                "note": "", "formActionOrigin": null, "httpRealm": null,
                "createdAt": null, "lastUsedAt": null, "passwordChangedAt": null, "importGuid": null, "source": "chrome" } ],
  "skipped": [ { "row": 11, "reason": "invalid-origin", "url": "" } ],
  "counts": { "rows": 13, "logins": 11, "skipped": 2, "androidApps": 1 } }
```

```json
{ "format": "netscape-html", "source": "firefox", "title": "Bookmarks Menu",
  "roots": [ { "type": "folder", "name": "Bookmarks Toolbar", "toolbar": true, "role": "toolbar",
               "addedAt": 1700000000000, "modifiedAt": 1763290000000, "note": "…", "children": [
                 { "type": "bookmark", "title": "Aeon", "url": "https://aeon.co/", "addedAt": 1700000002000, "modifiedAt": 1750000000000, "note": null } ] } ],
  "skipped": [ { "reason": "unsupported-scheme", "title": "Recent Tags", "url": "place:sort=8&maxResults=10", "path": [] },
               { "reason": "internal-folder", "title": "Mozilla Firefox", "url": "", "path": [], "bookmarks": 4 } ],
  "counts": { "bookmarks": 15, "folders": 6, "separators": 3, "skipped": 5, "maxDepth": 3 } }
```

`roots` conserve l'ordre du fichier ; les dossiers vides sont présents ; `maxDepth` compte les dossiers nommés
ouverts (racine = 0).

### 6.2 Identifiant importé → `login` (niveau 1)

Après dédoublonnage (§7.1), pour chaque élément de `logins` à écrire, avec `now` = moment de l'import,
`batch` = UUID v4 du lot, `author` = `deviceId` :

| Champ `login` | Valeur |
|---|---|
| `type`, `title`, `origins`, `username`, `password`, `note`, `formActionOrigin`, `httpRealm`, `importGuid`, `source` | copiés |
| `totp` | `null` |
| `folderId` | dossier `kind: "login"` du lot si « Ranger dans un dossier » est actif (§6.4), sinon `null` |
| `favorite`, `neverSaveHere` | `false` ; `tags` : `[]` |
| `createdAt` | `createdAt` importé sinon `now` |
| `modifiedAt` | `now` |
| `lastUsedAt` | `lastUsedAt` importé (ou `null`) |
| `passwordChangedAt` | `passwordChangedAt` importé (Firefox) ; `null` pour Chrome (inconnu — **pas** `now`, qui fausserait le dédoublonnage futur) |
| `passwordHistory` | résultat du dédoublonnage (`[]` pour un nouvel identifiant) |
| `importBatch` | `batch` |
| `author`, `deleted` | `author`, `false` |

Un identifiant **existant** modifié par la fusion garde son `id`, reçoit `modifiedAt = now` et `importBatch = batch`
(pour « Annuler cet import », §8) ; ses autres champs suivent §7.1.

### 6.3 Favoris → `folder` et `bookmark` (niveau 2)

Parcours de `roots` dans l'ordre, après `dedupeBookmarks` :

| Élément | Enregistrement |
|---|---|
| dossier | `folder` : `name`, `kind: "bookmark"`, `parentId` (dossier parent cible, `null` = racine), `position` (index fractionnaire généré dans l'ordre du fichier), `createdAt` = `addedAt` sinon `now`, `toolbar` (§6.4), `importBatch`, `author`, `deleted: false` |
| favori | `bookmark` : `title`, `url` (telle que lue), `addedAt` = `addedAt` sinon `now`, `folderId`, `position`, `importBatch`, `author`, `deleted: false` |
| `note` (`<DD>`) | PC : conservée dans un champ `note` du `bookmark`/`folder` (champ inconnu des mobiles, **conservé et réécrit** par eux, règle §3.4 du document de référence) ; mobile : ignorée à l'import |
| `modifiedAt` | non stocké (le modèle n'a pas de date de modification de favori) |

`position` : les trois plateformes génèrent leurs index fractionnaires avec leur bibliothèque habituelle ; seul
l'**ordre** est contractuel (ordre du fichier, dossiers et favoris mêlés comme dans le fichier).

> **Décision.** `record-bookmark.schema.json` et `record-folder.schema.json` ne listent pas `importBatch` ni `note` ;
> ils n'interdisent pas les champs inconnus. Ces deux champs sont ajoutés aux schémas lors de leur prochaine
> révision (demande ouverte) ; en attendant, leur présence est conforme.

### 6.4 « Ranger dans un dossier » (interrupteur, actif par défaut)

Nom du dossier de lot : `<Source> · <date courte locale>` (`Firefox · 16 nov. 2026`, `Chrome · 16 nov. 2026` ;
`Favoris · …` si la source est `unknown` ; `Edge`/`Brave` ne sont pas distinguables de Chrome).

- **Actif** : un `folder` racine `kind: "bookmark"` porte tout `roots` en gardant la hiérarchie ; le dossier
  `toolbar: true` du fichier garde `toolbar: true` (ses tuiles apparaissent sur la page de démarrage, en plus de
  la racine) ; les autres rôles (`unfiled`, `menu`, `mobile`) deviennent des dossiers ordinaires ; les favoris en
  vrac de la racine du fichier (Chrome : « Autres favoris » ; Firefox : le menu) vont directement dans le
  dossier de lot ; les dossiers vides sont conservés. Les identifiants vont dans un `folder` `kind: "login"` du
  même nom.
- **Inactif** : le contenu du dossier `toolbar` du fichier va à la **racine** (`folderId: null`, donc en tuiles) ;
  les favoris en vrac de la racine du fichier aussi ; les autres conteneurs de premier niveau deviennent des
  dossiers racine ; les dossiers **vides** disparaissent ; les identifiants ont `folderId: null`.

Le dédoublonnage des favoris contre le coffre (§7.2) se fait **après** ce placement, dans le dossier cible réel.

---

## 7. Dédoublonnage

Toute l'opération est un **lot** : un seul passage dans l'outbox, un seul `importBatch`. Les fonctions de
référence ne mutent jamais leurs entrées et renvoient des copies.

### 7.1 Identifiants — `dedupeLogins(incoming, existing, { now })`

Clé : `loginKey` = **origine principale** (`origins[0]`) + `\n` + nom d'utilisateur **en minuscules, espaces de bord
retirés**. `http://` et `https://`, ou deux ports, sont des clés différentes ; même site et deux utilisateurs aussi.

Les éléments importés sont traités **dans l'ordre du fichier**, chacun contre le coffre (`existing`, copies) puis
contre ce qui a déjà été accepté du fichier (une première ligne joue le rôle d'« existant » pour la seconde) :

1. **même `importGuid`** (Firefox) ⇒ cible trouvée, quelle que soit la clé ; sinon **même clé** ⇒ cible ; sinon
   **nouvel identifiant** (`added`).
2. Cible trouvée, **même mot de passe** ⇒ `duplicates` (« déjà présent »). Les métadonnées sont tout de même
   complétées : note fusionnée, origines réunies (ajout en fin), `formActionOrigin` / `httpRealm` / `importGuid` posés
   s'ils étaient `null`, `lastUsedAt` = max, `createdAt` = min. Si quelque chose a changé, l'enregistrement est
   réécrit (`notesMerged` compte les notes).
3. Cible trouvée, **mot de passe différent** ⇒ `updated`. Le plus récent par `passwordChangedAt` devient courant :
   l'importé gagne **seulement si** sa date est connue et strictement supérieure à celle de la cible (ou si la
   cible n'en a pas) ; sinon la cible reste. Le perdant est ajouté **en tête** de `passwordHistory` avec sa date
   (`now` s'il n'en a pas) ; 10 entrées au plus ; un mot de passe déjà présent dans l'historique (ou égal au courant)
   n'est pas ré-ajouté — et si rien n'a changé, l'élément est compté `duplicates` (ré-importer un fichier qui
   contient lui-même deux versions reste idempotent).
4. **Notes** : la note importée, non vide et non déjà contenue dans la note de la cible, est ajoutée après un `\n`.
   Le `title`, le `username` (graphie) et les autres champs de la cible sont conservés.

Conséquences utiles : Chrome n'a pas de dates ⇒ face à un existant, **l'existant garde son mot de passe** et le
Chrome part dans l'historique (rien n'est perdu, l'écran de détail montre « Historique du mot de passe ») ; deux
lignes Chrome de même clé ⇒ la **première** reste courante. Ré-importer le même export Firefox ⇒ `added: 0,
updated: 0`.

Retour : `{ logins: [à écrire : nouveaux + existants modifiés, avec leur id], counts: { incoming, added, updated,
duplicates, notesMerged } }`. Texte de l'aperçu : « 312 mots de passe · 14 doublons ignorés · 2 mots de passe mis
à jour » (`added`, `duplicates`, `updated`).

### 7.2 Favoris — `dedupeBookmarks(roots)`

Même `bookmarkKey` (§4.2) dans le **même dossier** ⇒ un seul, **le premier** dans l'ordre du fichier ; `removed`
compte les retraits (« 4 doublons ignorés »). La même URL dans deux dossiers différents est conservée deux fois. Les
dossiers ne sont jamais fusionnés (Chrome autorise deux dossiers homonymes). Une URL dont la clé est `null` est
comparée telle quelle. L'application applique ensuite la même règle contre les favoris déjà présents **dans le
dossier cible** (§6.4) ; les favoris existants ne sont jamais modifiés par un import.

---

## 8. « Annuler cet import »

Chaque enregistrement créé **ou modifié** par le lot porte `importBatch` = UUID v4 du lot. Dans Réglages › Mots de
passe (et Favoris), la ligne « Annuler l'import Firefox du 16 nov. (312 éléments) » reste **24 h** après l'import
(`createdAt` du lot ; l'appli garde la liste des lots dans `vault/imports.json` : `{ batch, at, source, created: [ids],
updated: [ids] }`, sans aucune donnée en clair).

- Enregistrements **créés** par le lot ⇒ tombstones (`deleted: true`, enveloppe AEAD normale), dossiers compris.
- Identifiants **modifiés** par le lot (fusion §7.1) ⇒ retour arrière : si le mot de passe courant a été posé par
  l'import, l'entrée la plus récente de `passwordHistory` dont `changedAt` ≤ `at` redevient courante et est retirée
  de l'historique ; les entrées d'historique ajoutées par le lot (`changedAt` = `now` du lot, ou égales à la date
  importée) sont retirées ; la note perd le suffixe `\n<note importée>` si elle le porte encore ; `importBatch` repasse
  à sa valeur d'avant (`null` ou lot précédent). Les origines ajoutées sont retirées si elles ne sont pas devenues
  l'origine principale.
- Favoris existants : jamais touchés par un import, rien à défaire.

Passé 24 h, la ligne disparaît (les `importBatch` restent : ils servent aux statistiques « importé depuis Firefox »).

---

## 9. Suppression du fichier source

Écran final : « **Supprimer le fichier d'export ?** Il contient vos mots de passe en clair. » (CSV seulement ; pour
un HTML : « Supprimer le fichier de favoris ? », sans alarme). Boutons : « Supprimer » (défaut) · « Garder ».

| Plateforme | Action | Remarque |
|---|---|---|
| iOS | `FileManager.removeItem(at:)` sur l'URL à portée de sécurité (`startAccessingSecurityScopedResource`) ; sinon `NSFileCoordinator` | Fichiers › Récents peut garder une vignette ; dit dans l'interface |
| Android | `DocumentsContract.deleteDocument(resolver, uri)` si `FLAG_SUPPORTS_DELETE` ; sinon on explique où est le fichier | les `ACTION_SEND` ne donnent pas toujours un URI supprimable |
| PC | `shell.trashItem(path)` (corbeille, récupérable 30 jours) puis proposition « Vider aussi la corbeille ? » | — |

Honnêteté : aucune de ces suppressions n'est un **effacement sûr** (mémoire flash, instantanés APFS, sauvegardes
iCloud/Google Drive). Le texte le dit en une ligne : « Pensez aussi à la copie dans Téléchargements, Mail ou
AirDrop. » Les tampons de l'analyseur sont mis à zéro là où le langage le permet (`Data`, `ByteArray.fill(0)`,
`Buffer.fill(0)`) ; les chaînes JavaScript ne le permettent pas, ce qui est documenté dans le modèle de menace.

---

## 10. Export

Toujours derrière le **mot de passe principal** (jamais la biométrie seule) ; feuille de confirmation « Ce fichier
n'est pas chiffré » pour CSV et HTML ; rien ne transite par le relais.

### 10.1 Mots de passe — CSV dialecte Chrome

`name,url,username,password,note` ; UTF-8 **sans BOM**, fins de ligne `LF`, en-tête obligatoire, un champ est cité
si et seulement s'il contient `"`, `,`, `\r` ou `\n` (guillemets doublés). Par identifiant non supprimé, dans
l'ordre `title` puis `username` (tri Unicode simple par points de code) :

| Colonne | Valeur |
|---|---|
| `name` | `title` |
| `url` | `origins[0]` + `/` (`https://aeon.co/`, forme que Chrome produit lui-même) ; application Android : `app:<package>` **tel quel** (Chrome l'ignorera à l'import ; Qafila le relit, §4.1) |
| `username`, `password` | tels quels |
| `note` | `note` ; `httpRealm` non vide est préfixé : `Authentification HTTP (realm) · ` + note ; `passwordHistory` et `totp` ne sont pas exportés |

Chrome, Firefox, Bitwarden, 1Password et Mots de passe Apple importent ce dialecte. Nom de fichier :
`Qafila - mots de passe - 2026-11-16.csv`.

### 10.2 Favoris — HTML Netscape

```html
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Barre de favoris</H3>
    <DL><p>
        <DT><A HREF="https://aeon.co/" ADD_DATE="1700000001">Aeon</A>
    </DL><p>
    <DT><A HREF="https://example.org/" ADD_DATE="1700000002">À la racine</A>
</DL><p>
```

Règles : indentation de 4 espaces par niveau, `LF` ; dates `ADD_DATE` / `LAST_MODIFIED` en **secondes** (`floor(ms /
1000)`) ; `LAST_MODIFIED` des dossiers = `createdAt` (pas de date de modification dans le modèle) ; les dossiers
`toolbar: true` portent `PERSONAL_TOOLBAR_FOLDER="true"` ; les favoris de la racine suivent les dossiers de la
racine ; ordre = `position` ; texte et attributs échappés `& < > "` ⇒ `&amp; &lt; &gt; &quot;` ; pas d'`ICON` ;
`note` (PC) ⇒ `<DD>` sous l'élément. Ce fichier est accepté par Chrome, Firefox, Safari et par `parseNetscapeHtml`
(source détectée `chrome`). Nom : `Qafila - favoris - 2026-11-16.html`.

### 10.3 Sauvegarde chiffrée `.qafila`

Format, AAD, dérivation et vérification : **`shared/CRYPTO.md` §11**, schéma `schemas/backup.schema.json`, vecteur
`vectors/backup.json`. Rappel : `{ format: "qafila-backup", v: 1, vaultId, keyGeneration, kdf, slot: { id: "export", n, ct },
records: [enveloppes de la génération courante, tombstones compris, triées par id], mac }` ; phrase d'export
≥ 12 caractères choisie au moment de l'export, sel neuf à chaque fichier, `mac` vérifié **avant** de lire une enveloppe.
Import : fusion LWW ordinaire après vérification ; importable dans un Qafila vierge (les AAD utilisent le `vaultId`
du fichier). C'est la sauvegarde périodique recommandée ; rappel discret tous les 90 jours. `detect` la reconnaît
(`format: "qafila-backup"`) et la route vers ce code, pas vers les analyseurs de ce document. Nom :
`Qafila - sauvegarde - 2026-11-16.qafila`.

---

## 11. Fixtures et conformité

| Fichier | Couvre |
|---|---|
| `fixtures/import/chrome-passwords.csv` | BOM, CRLF, `name,url,username,password,note` ; 11 identifiants : unicode (arabe, émoji, accents, IDN ⇒ punycode), virgule et guillemets dans un mot de passe, note multiligne avec guillemets (CRLF ⇒ LF), http vs https même hôte, même site deux utilisateurs, port non standard, doublon exact, doublon à casse différente avec mot de passe différent, application Android ; ligne vide (non comptée), ligne sans URL et `ftp:` ignorées |
| `fixtures/import/firefox-logins.csv` | tous champs cités, LF ; `httpRealm` (titre « Authentification HTTP · … »), `formActionOrigin` vide / avec `/` final, `guid` dupliqué (idempotence), temps en ms avec `0` et vide ⇒ `null`, mot de passe plus récent pour une même clé, `chrome://` ignoré |
| `fixtures/import/chrome-bookmarks.html` | forme Chrome : barre `PERSONAL_TOOLBAR_FOLDER`, 3 niveaux, `ICON` data: ignorés, entités `&amp; &#233; &#181;`, `&amp;` dans un `HREF`, favoris en vrac à la racine, dossier vide, `javascript:` et `chrome://` ignorés, IDN brut dans `url`, date en µs WebKit ; 4 doublons (slash final, fragment, sans slash, exact) |
| `fixtures/import/firefox-bookmarks.html` | forme Firefox : CSP meta, `<H1>Bookmarks Menu</H1>`, `place:` en tête, 3 `<HR>`, `<DD>` sous un dossier et sous des favoris, `UNFILED_BOOKMARKS_FOLDER`, « Mobile Bookmarks », dossier interne « Mozilla Firefox » retiré, `ICON_URI` / `TAGS` / `SHORTCUTURL` / `LAST_CHARSET` ignorés, `about:` / `file:` / `data:` ignorés, dates en ms, entités `&#39; &#x2014; &#8212;` ; 2 doublons |
| `fixtures/import/expected/*.json` | sortie exacte de `parse(text)` : `JSON.stringify(out, null, 2) + "\n"` |

Règle de conformité (job CI « conformance ») : pour chaque fixture, le port doit produire un JSON **égal en
profondeur** à l'attendu (mêmes clés, mêmes valeurs, `null` explicites, nombres entiers), puis `dedupe` doit
donner les compteurs des tests (`chrome-passwords` : `added 9, updated 1, duplicates 1` ; `firefox-logins` :
`added 9, updated 1, duplicates 1`, puis `added 0` au second passage ; `chrome-bookmarks` : `removed 4` ;
`firefox-bookmarks` : `removed 2`). Pour régénérer un attendu après une évolution **volontaire** du contrat :
`node -e 'import("./import/parse.mjs").then(m => process.stdout.write(JSON.stringify(m.parse(require("fs").readFileSync(process.argv[1], "utf8")), null, 2) + "\n"))' fixtures/import/x.csv`,
puis relecture à la main et mention dans le journal des changements de ce document. Les mots de passe des
fixtures sont fictifs ; aucune fixture ne contient de donnée réelle.

---

## 12. Décisions prises ici

1. **Un seul fichier `IMPORT.md`** (le `IMPORT_FORMATS.md` de `COFFRE-SYNC.md`) ; schémas dans `shared/schemas/` (et non `schema/`).
2. **Sortie d'analyse déterministe** (pas d'id, pas de `now`) ; la transformation en enregistrements est spécifiée (§6) mais exécutée par l'application.
3. **Origines en punycode minuscule**, port par défaut retiré, `https` ajouté sans schéma, `:` + chiffre = port.
4. **`android://` ⇒ `app:<package>`**, hash ignoré, exporté tel quel en CSV ; le schéma `origin` le permet déjà.
5. **1 Kio** pour un mot de passe, **32 Kio** pour les autres champs, **50 Mio** par fichier, ordre fixe des raisons.
6. **Ligne entièrement vide ⇒ supprimée et non comptée** ; `row` = indice parmi les enregistrements non vides.
7. **Sauts de ligne internes ⇒ LF** dans les champs CSV cités.
8. **Entités** : la liste du document de référence + `&apos;` et `&nbsp;` ; les autres restent telles quelles.
9. **Règle d'horodatage unique** (secondes / ms / µs WebKit) pour CSV et HTML.
10. **Séparateurs `<HR>` comptés, non représentés** ; `ICON`, `TAGS`, `SHORTCUTURL`, `LAST_CHARSET` ignorés sans compteur.
11. **Rôles par nom au premier niveau seulement** ; « Mozilla Firefox » retiré de l'arbre et compté.
12. **`url` du favori conservée telle quelle**, la normalisation ne sert qu'à la clé de dédoublonnage.
13. **Dédoublonnage** : guid avant clé ; mot de passe différent ⇒ `updated` même si l'existant garde la main ; Chrome sans date perd toujours face à une date connue ; déjà dans l'historique ⇒ rien à écrire.
14. **Notes fusionnées** par concaténation `\n`, jamais écrasées ; graphie du nom d'utilisateur de l'existant conservée.
15. **« Ranger dans un dossier » s'applique aussi aux identifiants** (`folder` `kind: "login"`).
16. **`importBatch` et `note` sur `bookmark`/`folder`** : champs à ajouter aux schémas (conformes en attendant).
17. **Annulation d'import** : tombstones pour les créations, retour arrière borné pour les fusions, journal `imports.json` sans donnée en clair, 24 h.
18. **Export CSV** : LF, sans BOM, citation minimale, `url` = origine + `/`, realm dans la note.
19. **Export HTML** : secondes, 4 espaces, `PERSONAL_TOOLBAR_FOLDER`, `<DD>` pour les notes PC.
