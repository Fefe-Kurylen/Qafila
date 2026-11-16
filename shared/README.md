# `shared/` — le contrat partagé entre iPhone, Android et PC

Qafila existe trois fois : en Swift (`ios-browser/`), en Kotlin (`android-browser/`) et bientôt en TypeScript
pour Electron (`desktop/`). Rien de ce qui doit être **identique** entre les trois ne vit dans l'une d'elles :
tout est ici, en JSON, en texte brut ou en JavaScript ES2017 sans dépendance, et chaque plateforme le lit, le
copie ou le reproduit. Ce dossier est la phase 0 de `COFFRE-SYNC.md` (§9.1, §10) : le coffre chiffré, la
synchronisation, l'import Chrome/Firefox, le remplissage et la parité d'interface y sont spécifiés **à
l'octet** avant qu'une ligne native ne soit écrite.

Ce n'est pas une bibliothèque : aucune plateforme n'importe de code Swift, Kotlin ou TS d'ici. Le **format est
le contrat**, pas le code (`COFFRE-SYNC.md` §9.3). Les vecteurs et les fixtures tranchent les désaccords ; une
implémentation qui les reproduit est conforme, quelle que soit sa façon d'y arriver.

## La règle

> **On change le contrat d'abord, puis les trois implémentations.**

Un nouveau champ dans un enregistrement, une nouvelle action de barre, une clé de réglage, une règle de
détection de formulaire : la modification commence par le fichier de `shared/` concerné (et son vecteur, sa
fixture ou son test), est relue là, puis est portée sur iOS, Android et PC. Jamais l'inverse. Si une plateforme
a besoin de dévier, la déviation est écrite dans le contrat (encadré **Décision**, `parityNote`,
`platformDefaults`…) pour que les deux autres sachent qu'elle existe et que le contrôle de parité ne la
redécouvre pas à chaque exécution. Quand `COFFRE-SYNC.md` est précis, le contrat le reprend tel quel ; quand il
est vague, la décision est prise ici et marquée, et c'est alors le fichier de `shared/` qui fait foi.

## Carte du dossier

| Chemin | Rôle | Référence |
|---|---|---|
| `CRYPTO.md` | spécification cryptographique byte-exacte : primitives, hiérarchie des clés, AAD, bourrage, emplacements, en-têtes, kit de secours, appairage, sauvegarde `.qafila` | `COFFRE-SYNC.md` §3 |
| `PROTOCOL.md` | relais aveugle (`/sync/v1`), enveloppes, HLC, fusion LWW, limites, codes d'erreur, appairage, transport « via un dossier » | §5 |
| `IMPORT.md` | import Chrome/Firefox/Safari (CSV), favoris Netscape (HTML), dédoublonnage, exports | §6 |
| `FORMS.md` | ce que fait `qafila-forms.js` et ce que le natif fait autour (correspondance d'origine, carte de remplissage, presse-papiers) | §7.1 |
| `schemas/*.schema.json` | JSON Schema 2020-12 des enregistrements (login, bookmark, folder, setting, device), de l'enveloppe, des en-têtes, des emplacements, de la sauvegarde ; source des types `Codable` / `@Serializable` / TS | §4 |
| `schemas/protocol/*.json` | schémas des corps de requête et de réponse du relais, des QR et de `sync-state.json` | §5 |
| `vectors/*.json` | vecteurs de test figés (standards + Qafila + négatifs), générés une fois par `vectors/gen.mjs` | §3.9 |
| `fixtures/import/` | CSV et HTML réels + `expected/*.json` | §6.3 |
| `fixtures/forms/` | pages HTML + `*.expected.json` pour `detect()` ; `origin-matching.json` pour la correspondance d'origine | §7.1 |
| `fixtures/protocol/` | échanges complets avec le relais (cycle de vie, appairage, conflit, révocation) | §5 |
| `import/parse.mjs` | analyseur de référence (ES2017, sans dépendance) : CSV RFC 4180, HTML Netscape, détection par le contenu | §6.3 |
| `qafila-forms.js` | **le** script de contenu embarqué tel quel sur les trois plateformes (IIFE ES2017, sans dépendance) | §7.1 |
| `bip39-french.txt` | les 2 048 mots de la clé de secours | §3.7 |
| `toolbar-actions.json` | actions de la barre et du menu (identifiant, libellé, SF Symbol, icône Android, destructif, tuile), menu standard, galerie de presets, actions planifiées `passwords` et `sync` | `DESIGN.md` §2–3, §7 ; `COFFRE-SYNC.md` §8.2 |
| `settings-keys.json` | toutes les clés de réglages : nom de fil, nom par plateforme, type, défaut, valeurs permises, liste blanche de synchronisation ; c'est le `SETTINGS_SYNC_KEYS.md` annoncé par `COFFRE-SYNC.md` | §4.1 |
| `scripts/check-parity.mjs` | lit les enums Swift et Kotlin et échoue si une action, un preset ou un réglage existe sur une plateforme et pas dans le contrat ou l'autre plateforme | — |
| `test/*.test.mjs` | exécution de référence de tout ce qui précède (`node --test`) | — |
| `package.json` | `npm test` ; dépendances de test seulement : `hash-wasm` (Argon2id), `jsdom` | — |

Annoncés par `COFFRE-SYNC.md` §9.1 et pas encore écrits : `AUTOFILL_HEURISTICS.md` (absorbé par `FORMS.md` §7),
`UX_FLOWS.md`, `vectors/sync-merge-cases.json` (les cas vivent pour l'instant dans `fixtures/protocol/`),
`url-normalization.json`, `wordlist-fr-en.txt`, `common-passwords-10k.txt`, `i18n/{fr,en}.json`, `web/psl-compact.dat`,
l'unification de `blocklist.txt`, `reading-time.js` et `darken.js`, et `tools/sync-shared.sh`. Ils arrivent avec
la phase qui en a besoin, en respectant la règle ci-dessus.

## Comment chaque plateforme consomme chaque fichier

| Fichier | iOS (Swift, CryptoKit + swift-sodium) | Android (Kotlin, Bouncy Castle API légère) | PC (Node / Electron) |
|---|---|---|---|
| `CRYPTO.md`, `PROTOCOL.md`, `IMPORT.md`, `FORMS.md` | lus par l'agent qui écrit `ios-browser/QafilaCore` | idem pour `android-browser/core` | idem pour `packages/qafila-core` |
| `schemas/*.schema.json` | types `Codable` écrits à la main d'après le schéma ; les champs inconnus sont conservés (§3.4) | types `@Serializable` (`kotlinx-serialization`, `ignoreUnknownKeys = false` + stockage des extras) | types TS + validation `ajv` dans le relais et le cœur |
| `vectors/*.json`, `fixtures/**` | copiés dans les ressources de la cible de test (`Bundle.module`), rejoués en **XCTest** sur le runner macOS, sans simulateur | copiés dans `core/src/test/resources`, rejoués en **JUnit** (JVM pur, sans émulateur) | lus directement, rejoués ici en **node:test** (`npm test`) et dans `vitest` du cœur TS |
| `qafila-forms.js` | **copié comme ressource** du bundle (`Resources/Shared/qafila-forms.js`), chargé par `WKUserScript` au `document start` dans un `WKContentWorld` dédié ; messages via `WKScriptMessageHandler` | **copié comme asset** (`app/src/main/assets/shared/qafila-forms.js`), injecté par `WebViewCompat.addDocumentStartJavaScript`, messages via `addWebMessageListener` | **importé** par le processus main (`readFileSync` ou import Vite `?raw`) et exécuté dans un monde isolé par `webFrameMain.executeJavaScriptInIsolatedWorld` depuis le `preload` |
| `import/parse.mjs` | **pas importé** : port Swift (`QafilaCore/Sources/Import/`) validé sur les mêmes fixtures | port Kotlin (`core/.../import/`) validé sur les mêmes fixtures | importé tel quel par le cœur TS |
| `bip39-french.txt`, listes à venir | ressource du bundle | asset | fichier lu au démarrage |
| `toolbar-actions.json` | source de `ToolbarAction.swift` (cas, `label`, `symbol`, `tileLabel`, `isDestructive`, presets) : aujourd'hui recopié à la main, vérifié par `check-parity.mjs` | source de `ToolbarAction` et des presets de `Models.kt`, des icônes d'`Icons.kt` et des chaînes de `strings.xml` ; même vérification | **lu directement** : la barre, le menu flottant, le menu contextuel et les raccourcis sont construits depuis le fichier (phase 3) |
| `settings-keys.json` | `Settings.swift` : clés `CodingKeys`, enums, défauts ; la couche de synchro (phase 2) convertit vers les valeurs de fil | `Models.kt` `Settings` : la table `android` et `enums.*.androidNames` donnent la conversion nom Kotlin ↔ fil | page Réglages et conversion de fil générées depuis le fichier |

Les copies (ressource iOS, asset Android, ressources de test) sont faites par `tools/sync-shared.sh` dès qu'il
existe, avec un contrôle de dérive par SHA-256 en CI (`COFFRE-SYNC.md` §9.1). D'ici là, la copie est manuelle
et le hash du fichier source est noté dans le commit qui la met à jour.

## Lancer les tests

```sh
cd shared
npm ci          # une fois : hash-wasm (Argon2id en WebAssembly) et jsdom, rien d'autre
npm test        # node --test : crypto, protocole, import, formulaires, parité
```

Aucun test ne parle au réseau ; `jsdom` ne charge aucune ressource ; les vecteurs sont figés. Le workflow
`.github/workflows/conformance.yml` fait la même chose à chaque modification de `shared/`. Les cibles XCTest et
JUnit qui rejouent les mêmes vecteurs sont créées par la phase 1 (`COFFRE-SYNC.md` §9.1 : aucun des deux projets
n'a de cible de test aujourd'hui).

## Le contrôle de parité

```sh
node shared/scripts/check-parity.mjs            # rapport lisible, sortie 1 s'il y a une erreur
node shared/scripts/check-parity.mjs --strict   # les divergences documentées et les libellés deviennent bloquants
node shared/scripts/check-parity.mjs --json     # rapport machine (utilisé par test/parity.test.mjs)
```

Le script lit, avec des expressions régulières, `ToolbarAction.swift`, `Chrome.swift`, `Settings.swift`,
`Models.kt`, `Icons.kt` et `values/strings.xml`, puis compare à `toolbar-actions.json` et `settings-keys.json` :

- **✖ erreur** (bloquante) : une action, un preset, une clé de réglage ou une valeur d'enum existe sur une
  plateforme et pas dans le contrat, ou dans le contrat et pas sur la plateforme où il est déclaré ; un symbole,
  une icône, un drapeau destructif, un type, un défaut ou une barre de preset qui ne correspond pas ; une
  entrée `planned` déjà présente dans le code ; une absence non documentée.
- **⚠ avertissement** (bloquant en `--strict`) : un libellé français qui diffère d'une plateforme sans être
  enregistré (`platformLabels`, `platformTileLabels`).
- **ℹ divergence documentée** (jamais bloquante hors `--strict`) : tout ce que le contrat déclare volontairement
  comme différent aujourd'hui — `platforms` réduit avec `parityNote` (quatre actions n'existent que sur Android :
  `reopenTab`, `closeAllAndClear`, `copyLink`, `search`), `overrides` d'un preset (iOS garde le menu standard
  et met Recharger à la place de ↶ dans « Outils »), `platformDefaults`, noms de propriété Android (`android`),
  noms Kotlin non mécaniques (`androidNames`), valeurs propres à une plateforme (`platformOnlyValues`).

Le contrat décrit donc **la réalité et la cible** : la liste des divergences est la liste des travaux de parité.
Pour en résorber une, on corrige le code de la plateforme en retard puis on retire la note ; le script
redevient silencieux. Pour ajouter une action ou une clé : l'écrire ici avec `status: "planned"` et sa phase,
puis la porter ; le script refuse qu'elle apparaisse dans le code sans passer à `shipped`.

## Conventions

- Documentation en français, identifiants (clés JSON, champs, noms de fichiers de code) en anglais.
- Identifiants de fil en lowerCamelCase = `rawValue` Swift ; Kotlin en UPPER_SNAKE_CASE avec conversion
  mécanique, exceptions listées dans `settings-keys.json › enums.*.androidNames`.
- JSON canonique (`CRYPTO.md` §2) partout où un octet compte : clés triées, entiers seulement, pas d'espaces.
- Un fichier exécuté sur les plateformes (`qafila-forms.js`, `import/parse.mjs`) est de l'ES2017 sans
  bundler, sans dépendance et sans API Node, pour tourner tel quel dans WebKit, Chromium, jsdom et Node.
- Rien de secret, rien de réseau, rien de généré à la volée : ce qui est ici peut être lu par n'importe qui et
  rejoué hors ligne.
