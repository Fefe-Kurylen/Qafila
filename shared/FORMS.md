# Qafila — Formulaires : détection, remplissage, correspondance d'origine (contrat partagé)

Ce document fixe **ce que fait le script de contenu `shared/qafila-forms.js`** et ce que la partie native de
chaque plateforme (iOS, Android, PC) doit faire autour de lui pour le remplissage automatique dans Qafila
(COFFRE-SYNC.md §7.1). Le script est écrit une fois et embarqué tel quel sur les trois plateformes ; la
correspondance d'origine, la carte de remplissage et l'hygiène du presse-papiers sont natives, écrites trois fois
d'après les règles ci-dessous. Les fixtures de `shared/fixtures/forms/` tranchent : les trois plateformes doivent
produire la même description pour chaque page.

Fichiers :

| Fichier | Rôle |
|---|---|
| `shared/qafila-forms.js` | le script injecté (ES2017, IIFE, sans dépendance, idempotent) |
| `shared/fixtures/forms/<nom>.html` + `<nom>.expected.json` | pages de test et description attendue de `detect()` |
| `shared/fixtures/forms/origin-matching.json` | vecteurs de la correspondance d'origine (côté natif) |
| `shared/test/forms.test.mjs` | exécution de référence (node:test + jsdom) : `cd shared && npm test` |

> **Écarts par rapport à COFFRE-SYNC.md, assumés ici.** (1) Le chemin : le script vit à `shared/qafila-forms.js`
> et ce contrat à `shared/FORMS.md`, là où §7.1 et §9.1 citent `shared/web/qafila-forms.js` et
> `shared/AUTOFILL_HEURISTICS.md` ; `shared/tools/sync-shared.sh` copie le fichier où chaque plateforme le lit, le
> nom du dossier n'a pas d'autre conséquence. (2) Le descripteur : §7.1 esquissait
> `{ kind:"forms", isTopFrame, formAction, fields:[{id, role}] }` ; le format fixé ici (§2.2) le remplace, avec un
> chemin CSS stable par champ, l'origine de l'action et un drapeau d'inscription. (3) Le second rang de la
> correspondance d'origine (même domaine enregistrable) n'est **plus implicite** : il est activé par un drapeau
> explicite par identifiant, `matchSubdomains` (§7.3). Le reste de §7.1 s'applique à la lettre.

---

## 1. Périmètre et garanties

- Le script **ne connaît jamais le coffre**. Il décrit la page ; la partie native choisit un identifiant ;
  le script reçoit **une valeur, une fois, après le tap de l'utilisateur** et la pose dans un champ.
- Il **ne soumet jamais** un formulaire, n'appelle jamais `submit()`, `requestSubmit()` ni `click()`.
- Il **ne remplit jamais** dans un cadre enfant (iframe, même de même origine en v1), ni pour une autre origine que
  celle de la page (`window.location.origin`, comparée à l'origine que le natif a décidée).
- Il ne lit pas l'URL complète, ne journalise rien (`console` absent), ne touche ni au réseau ni au stockage.
- Il n'expose à la page aucune information qu'elle n'a pas déjà : `detect()` décrit son propre DOM,
  `captureSubmit()` lui rapporte ses propres valeurs, `fill()` exige une valeur qu'elle ne possède pas.
  Là où il n'y a pas de monde isolé (Android), l'objet `window.__qafilaForms` est posé **non configurable, non
  énumérable et gelé** au `document start`, avant tout script de la page : la page ne peut ni le remplacer ni
  intercepter un appel natif à `fill()`.
- La valeur **une fois posée** est lisible par le JavaScript de la page : inhérent au remplissage dans la page,
  dit tel quel dans le modèle de menace (COFFRE-SYNC.md §2). C'est pourquoi : tap obligatoire, origine décidée
  côté natif, cadre principal seulement.

Hors périmètre v1 (phase 5 si la demande existe) : Shadow DOM (les champs sous une racine fantôme ne sont pas
vus), iframes de même origine, champs `contenteditable`, codes à usage unique (`autocomplete="one-time-code"`,
volontairement ignorés), formulaires d'adresse et de carte bancaire.

---

## 2. Interface du script

### 2.1 Injection et appels, par plateforme

Le script est injecté **au `document start`, dans le cadre principal**, puis la plateforme ajoute quelques lignes
de **colle** (non partagées) qui relient `observe()` et `captureSubmit()` à son canal de messages. Rien d'autre
n'est injecté dans la page.

| Plateforme | Injection | Colle (messages vers le natif) | Appels natif → page |
|---|---|---|---|
| iOS 17+ | `WKUserScript(source:, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: WKContentWorld.world(name: "qafila"))` | `userContentController.add(handler, contentWorld: qafilaWorld, name: "qafilaForms")` ; la colle appelle `webkit.messageHandlers.qafilaForms.postMessage(JSON.stringify(...))` | `webView.evaluateJavaScript("window.__qafilaForms.fill(\(json))", in: nil, in: qafilaWorld)` |
| Android 8+ | `WebViewCompat.addDocumentStartJavaScript(webView, script + colle, setOf("*"))` | `WebViewCompat.addWebMessageListener(webView, "qafilaFormsBridge", setOf("*"), listener)` ; la colle appelle `qafilaFormsBridge.postMessage(JSON.stringify(...))` ; le natif **n'accepte que** `isMainFrame == true` et compare `sourceOrigin` à `webView.url` | `webView.evaluateJavascript("window.__qafilaForms.fill($json)", null)` |
| PC (Electron) | `webFrameMain.executeJavaScriptInIsolatedWorld(QAFILA_WORLD, [{ code: script + colle }])` sur `did-start-navigation`/`dom-ready` du cadre principal ; `contextIsolation`, `sandbox`, `nodeIntegration:false` | la colle appelle un `contextBridge` du preload limité à un canal `qafila:forms` ; le main vérifie `event.senderFrame === webContents.mainFrame` | `mainFrame.executeJavaScriptInIsolatedWorld(QAFILA_WORLD, [{ code: \`window.__qafilaForms.fill(${json})\` }])` |

Règles communes :
- `json` est produit par l'encodeur JSON natif (`JSONEncoder`, `kotlinx.serialization`, `JSON.stringify`) : jamais
  de concaténation manuelle d'une chaîne venant du coffre. Les encodeurs Swift/Kotlin n'échappent pas U+2028/U+2029 ;
  c'est accepté depuis ES2019 dans un littéral, et de toute façon le JSON est posé en **argument**, pas dans une
  balise `<script>`.
- Le natif vérifie que l'origine de la vue au moment du tap est toujours celle qui a servi au choix de l'identifiant
  (`webView.url` / `WebView.getUrl()` / `webContents.getURL()`), puis passe cette origine dans `credential.origin`.
  Le script la revérifie (défense en profondeur), pas l'inverse.
- Le natif traite tout ce qui vient de la page (descriptions, soumissions) comme **des données**, jamais comme des
  instructions ; tailles bornées (5 formulaires, 8 champs, chaînes tronquées à 1 024 caractères au natif).

### 2.2 `detect()` → tableau de formulaires

Renvoie un tableau JSON, **vide** si : cadre enfant, origine non `http(s)`, pas de `<body>`, rien de détecté.
Au plus 5 formulaires, classés (§3.8), chacun :

```json
{ "origin": "https://aeon.example",
  "formActionOrigin": "https://aeon.example",
  "form": "#login",
  "isSignup": false,
  "isPasswordChange": false,
  "fields": [
    { "kind": "username", "selectorPath": "#user", "visible": true,  "autocomplete": null },
    { "kind": "password", "selectorPath": "#pass", "visible": true,  "autocomplete": "current-password" } ] }
```

| Champ | Sens |
|---|---|
| `origin` | `window.location.origin` de la page (`scheme://host[:port]`) |
| `formActionOrigin` | origine de l'action du `<form>` (résolue ; sans attribut `action` = origine de la page ; `javascript:` ou schéma non http(s) = `null`) ; `null` sans `<form>` |
| `form` | `selectorPath` du `<form>`, `null` si le conteneur n'est pas un `<form>` |
| `isSignup` | il y a un `newPassword` et aucun `password` (mot de passe actuel) |
| `isPasswordChange` | il y a un `newPassword` **et** un `password` |
| `fields[]` | au plus 8, dans l'**ordre du document** (pas l'ordre visuel) |
| `fields[].kind` | `username` · `password` (celui qui connecte, ou le mot de passe actuel) · `newPassword` · `confirmPassword` |
| `fields[].selectorPath` | chemin CSS déterministe (§3.5), résolu par `document.querySelector` en exactement un élément |
| `fields[].visible` | rendu au sens de §3.6 ; un champ non visible est décrit mais **jamais rempli** |
| `fields[].autocomplete` | valeur brute de l'attribut `autocomplete`, minuscules, espaces normalisés ; `null` si absent |

### 2.3 `fill(credential)` → résultat

```json
{ "origin": "https://aeon.example", "form": "#login",
  "username": "lina@example.org", "password": "…", "newPassword": "…" }
```

- `origin` **obligatoire**, doit être strictement égal à `window.location.origin`.
- `form` optionnel : `selectorPath` du formulaire visé ; sinon le premier formulaire du classement.
- `username`, `password`, `newPassword` : chaînes optionnelles. Sur un formulaire `isSignup`, `password` va dans
  `newPassword` **et** `confirmPassword` (générateur) ; sur un changement de mot de passe, `password` va dans le
  champ actuel et `newPassword` dans nouveau + confirmation.

Résultat : `{ ok, filled: ["username","password"], skipped: [{ kind, reason }], reason }`.

| `reason` (refus global) | Quand |
|---|---|
| `frame` | le script n'est pas dans le cadre principal |
| `argument` | `credential` n'est pas un objet |
| `origin` | origine absente, différente de celle de la page, ou page hors http(s) |
| `no-form` | aucun formulaire détecté, ou `form` ne désigne aucun formulaire détecté |
| `nothing-to-fill` | tous les champs demandés ont été écartés (voir `skipped`) |
| `error` | exception interne (la page a cassé une API DOM) ; rien n'a été posé ou seulement une partie, `filled` fait foi |

`skipped[].reason` : `hidden` (non visible, dont `type=hidden`), `readonly`, `disabled`, `setter` (setter natif
indisponible). Un champ écarté **n'est jamais** réécrit : un identifiant que le site a prérempli (étape 2 d'une
connexion « e-mail d'abord ») reste intact.

Pose d'une valeur (§4) : `focus()`, setter natif `HTMLInputElement.prototype.value`, événement `input`
(`InputEvent`, `inputType: "insertText"`, bulles, composé), puis `change` (bulles). Rien d'autre : pas de
`keydown`, pas de `blur`, pas de soumission.

### 2.4 `observe(callback)` → fonction de désabonnement

`callback(forms, meta)` avec `forms` = résultat de `detect()` et `meta` :

| `meta.reason` | Quand | `meta.focused` |
|---|---|---|
| `initial` | après `DOMContentLoaded` (ou tout de suite, en asynchrone, si déjà chargé) | chemin du champ détecté qui a le focus, sinon `null` |
| `mutation` | le DOM a changé **et** la description a changé (JSON différent du précédent), 150 ms après la dernière mutation ; aussi sur `load`, `pageshow`, `hashchange`, `popstate` | idem |
| `focus` | un élément prend le focus (`focusin`, phase de capture) | chemin du champ détecté focalisé, `null` si le focus est ailleurs (la carte se replie) |
| `blur` | un champ détecté perd le focus (`focusout`) ; `meta.left` = son chemin | `null` |

Les rappels `focus` et `blur` ne sont pas dédoublonnés (la carte suit le focus) ; `initial` et `mutation` le sont.
Une exception dans le rappel est avalée. Dans un cadre enfant, `observe` ne fait rien et renvoie une fonction vide.

### 2.5 `captureSubmit(callback)` → fonction de désabonnement

Rapporte le couple **tel que la page l'envoie**, pour la carte « Enregistrer dans Qafila ? » :

```json
{ "origin": "https://aeon.example", "formActionOrigin": "https://aeon.example", "form": "#login",
  "username": "lina", "password": "pw-1", "newPassword": null, "isSignup": false, "isPasswordChange": false }
```

Déclencheurs (phase de capture, donc avant que la page vide les champs) : événement `submit` d'un `<form>` ;
clic sur un contrôle de soumission du formulaire (`button` sans type ou `type=submit`, `input[type=submit|image]`)
ou sur un bouton dont le texte ressemble à une connexion (§3.9) ; sans `<form>` : clic sur tout bouton du conteneur
ou touche Entrée dans un champ du conteneur. Règles : `password` **ou** `newPassword` non vide, sinon rien ;
confirmation présente et différente du nouveau mot de passe ⇒ rien (le site refusera) ; le même quadruplet
(formulaire, identifiant, mot de passe, nouveau) n'est rapporté qu'une fois par 3 s (un clic suivi d'un `submit`
ne compte qu'une fois). Le natif compare au coffre : couple nouveau ⇒ « Enregistrer ? » ; même identifiant, mot de
passe différent ⇒ « Mettre à jour ? » ; identique ⇒ rien ; `neverSaveHere` ⇒ rien.

### 2.6 Propriétés

`version` (entier, `1`) et `frame` (`"top"` ou `"child"`). Une seconde injection d'une même version ne fait rien ;
l'objet est gelé et la propriété `window.__qafilaForms` n'est ni réinscriptible ni reconfigurable.

---

## 3. Règles de détection (déterministes : mêmes résultats sur jsdom, WebKit, Chromium)

### 3.1 Ce qui est regardé

- Uniquement des `<input>` du document principal ; pas les iframes, pas les racines fantômes, pas le contenu des
  `<template>`.
- **Mot de passe** : `type=password` (insensible à la casse) sans jeton `one-time-code` dans `autocomplete`.
- **Candidat identifiant** : `type` ∈ `text` (ou absent ou inconnu), `email`, `tel`, `hidden`. Jamais `search`,
  `url`, `number`, cases, boutons.
- Un champ `disabled` ou `readonly` est décrit (il peut porter l'identifiant prérempli) mais jamais rempli.

### 3.2 Conteneur

Pour chaque champ mot de passe : son `<form>` (`closest('form')`) ; sinon le **premier ancêtre** qui contient
aussi un autre champ texte (hors `type=hidden`) ou un bouton (`button`, `input[type=submit|button]`,
`[role=button]`) ; sinon `<body>`. Les champs mot de passe qui partagent un conteneur forment **un** formulaire.

### 3.3 Rôles des champs mot de passe

Soit `P` les champs mot de passe du conteneur dans l'ordre du document, `V ⊆ P` ceux qui sont visibles, et
`C = V` si `V` n'est pas vide, sinon `C = P` (un formulaire entièrement caché — fenêtre modale pas encore
ouverte — est quand même classé). Indice d'inscription `S` = les attributs du conteneur (`id`, `name`, `class`,
`action`, `aria-label`, `data-testid`) **ou** le texte de ses boutons correspondent à `RE_SIGNUP`.

1. Si aucun champ de `C` n'a `autocomplete` contenant `new-password`, que `|C| = 1` et que `S` est faux : tout
   est `password`.
2. Sinon, dans l'ordre, pour chaque champ de `C` (texte = §3.9) :
   `current-password` ⇒ `password` · `new-password` ⇒ `newPassword` si aucun `newPassword` encore posé et texte sans
   mot de confirmation, sinon `confirmPassword` · texte « actuel » (et pas « confirmer ») ⇒ `password` · texte
   « confirmer » ⇒ `confirmPassword` · `|C| ≥ 3`, premier champ, aucun `new-password` explicite ⇒ `password` ·
   sinon ⇒ `newPassword` si aucun encore, sinon `confirmPassword`.
3. Si aucun `newPassword` n'a été posé (deux champs « confirmer »), le premier `confirmPassword` devient `newPassword`.
4. Les champs de `P \ C` (cachés alors que d'autres sont visibles : pots de miel) sont `password`, `visible:false`,
   et ne pèsent pas sur `isSignup`.

### 3.4 Choix de l'identifiant

Un seul identifiant par formulaire, le candidat (§3.1) du conteneur au **score le plus élevé, strictement
positif** ; à égalité, le plus proche du premier champ mot de passe (en nombre d'`<input>` du conteneur).

| Critère | Points |
|---|---|
| `autocomplete` contient `username` | +100 |
| sinon contient `email` | +90 |
| sinon contient `tel` | +60 |
| sinon `autocomplete` explicite autre que `on`/`off` (`name`, `address-line1`…) | −60 |
| `type=email` | +80 |
| texte (§3.9) correspond à `RE_USERNAME` | +40 |
| texte correspond à `RE_NOT_USERNAME`, sauf si `autocomplete` username/email, `type=email` ou `RE_USERNAME_STRONG` | −100 |
| visible | +50 ; sinon `type=hidden` −20, sinon −10 |
| précède le premier mot de passe dans le document | +30 ; sinon −20 |
| `type=hidden` sans `autocomplete` username/email ni `RE_USERNAME` | −500 (valeur technique, jamais un identifiant) |
| `disabled` | −30 |

Ainsi : un `autocomplete="username"` l'emporte sur la position (`autocomplete-wins.html`), un « Code postal »
placé avant l'identifiant est écarté (`labels-french.html`), un `input type=hidden name="identifier"` est
retenu mais invisible (`email-first-two-step.html`), un prénom est écarté devant un e-mail (`signup-confirm.html`).

### 3.5 `selectorPath`

En remontant depuis l'élément jusqu'à `<html>` exclu : si l'élément porte un `id` de la forme
`[A-Za-z_][A-Za-z0-9_-]*` **unique** dans le document, le chemin commence par `#id` et s'arrête là ; sinon on
ajoute `tag:nth-of-type(n)` (`tag` en minuscules, `n` = rang parmi les frères de même balise). Les segments sont
joints par ` > `. Exemples : `#pass`, `#gate > label:nth-of-type(1) > input:nth-of-type(1)`,
`body:nth-of-type(1) > div:nth-of-type(2) > input:nth-of-type(1)`. Le natif ne calcule jamais un chemin : il le
reçoit dans une description et le renvoie tel quel dans `fill()`.

### 3.6 `visible`

Faux si : `type=hidden` ; ou, sur l'élément ou **un ancêtre** : attribut `hidden`, `aria-hidden="true"`, style
calculé `display:none`, `visibility:hidden|collapse`, `opacity:0`. Quand le moteur fournit une mise en page
(`documentElement.getBoundingClientRect()` non nul — jamais dans jsdom), faux aussi si la boîte fait moins de
2 × 2 px ou se termine à gauche ou au-dessus de l'écran (`right ≤ 0` ou `bottom ≤ 0`). Un champ plus bas que
l'écran (sous le pli) reste visible.

### 3.7 Formulaires « identifiant d'abord »

Un champ texte **visible ou non rendu mais pas `type=hidden`** dont `autocomplete` contient `username`, dans un
conteneur sans aucun mot de passe, forme un formulaire à un seul champ (`fields:[{kind:"username"}]`,
`isSignup:false`). C'est l'opt-in explicite du site (même heuristique que Chrome) : un `type=email` seul ne suffit
pas, sinon chaque lettre d'information deviendrait un formulaire de connexion (`login-honeypot-newsletter.html`).

### 3.8 Classement et limites

Rang = `100` si un mot de passe est visible, `+10` s'il y a un identifiant, `+5` s'il est visible, `−1` si
inscription ; formulaires « identifiant d'abord » : `20` (+5 si visible). Tri par rang décroissant puis ordre du
document ; au plus **5** formulaires, **8** champs par formulaire. Le premier formulaire est celui que `fill()`
prend par défaut.

### 3.9 Texte d'un champ et mots-clés

Texte = `name`, `id`, `placeholder`, `aria-label`, `title`, `class`, le texte des éléments d'`aria-labelledby`,
des `<label for>` et du `<label>` parent, joints par ` | `, **pliés** : minuscules, accents retirés (NFD puis
suppression des diacritiques), espaces normalisés. Les expressions régulières (anglais + français) sont dans le
script, section « Mots-clés » ; elles **font partie du contrat** : les ports natifs n'en ont pas besoin (le
script tourne tel quel), mais toute modification se fait là et se vérifie par les fixtures.

- `RE_USERNAME` : user, login, e-mail, courriel, identifiant, pseudo, compte/account, téléphone/mobile, membre,
  utilisateur, client…
- `RE_USERNAME_STRONG` (lève la pénalité) : e-mail, courriel, identifiant, utilisateur, username, login.
- `RE_NOT_USERNAME` : recherche/search, captcha, otp, code postal/zip, ville, prénom/nom de famille, adresse/rue,
  société, carte/cvv/iban, naissance, coupon, quantité, sujet/message/commentaire, newsletter, `q`, `code`.
- `RE_CONFIRM` : confirm, repeat/répéter, again, verify/vérif, retype, re-enter, second, …2, bis, encore.
- `RE_CURRENT` : current/actuel, old/ancien, existing, present.
- `RE_SIGNUP` : sign up, register, inscri…, créer/create, join/rejoindre, nouveau compte, get started.
- `RE_LOGIN_BUTTON` (clic sans `type=submit`) : log in, sign in, connexion, continuer, suivant, valider, entrer…

---

## 4. Remplissage : pourquoi ces gestes précis

- **Setter natif** `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`, capturé au
  `document start` : React pose sur l'instance un setter qui « suit » la valeur et ignore l'événement `input` si la
  valeur suivie est déjà égale ; `el.value = x` est donc sans effet sur son état, le setter du prototype non
  (`react-controlled.html` le prouve). Vue, Angular, Svelte écoutent `input` : servis par le même geste.
- **`input` puis `change`** avec `bubbles:true` : délégation d'événements et validateurs à la soumission.
- **`focus()` avant** : les champs flottants (« floating labels ») et les validateurs « au focus » se déclenchent ;
  pas de `blur()` après : sur mobile, le clavier resterait, puis disparaîtrait, pour rien.
- **Aucun** `keydown`/`keypress` : simuler une frappe avec le mot de passe en clair dans `event.key` n'apporte rien
  et expose la valeur à un gestionnaire de plus.
- **Jamais de soumission** : COFFRE-SYNC.md §7.1. L'utilisateur relit, corrige, puis appuie lui-même.
- Un `fill()` = **un geste** : le natif n'appelle `fill()` qu'en réaction à un tap sur la carte (§8), jamais sur un
  `focus`, un `observe`, une navigation ou une minuterie. Le script n'a aucun moyen de le vérifier : c'est une règle
  native, testée par relecture et par l'absence de tout autre appel dans le code.

---

## 5. Ce que la description ne dit pas et que le natif décide

- **Quelle origine** sert au choix : celle de la **vue** (`webView.url`…), jamais `forms[].origin` reçu de la page
  (il doit être égal ; sinon on jette la description et on ne montre rien).
- **Quel identifiant** proposer : §7.
- **Quand** montrer la carte : §8.
- **Quoi faire de `formActionOrigin`** : s'il diffère de l'origine de la page, la carte le dit (« envoie vers
  auth.shop-id.example ») ; il ne sert **qu'au classement** des candidats (un identifiant dont `formActionOrigin`
  enregistré est égal passe devant), jamais à la correspondance.
- **`isSignup`** : afficher la tuile « Générer un mot de passe » ; `fill({ origin, password: généré })` remplit
  nouveau + confirmation ; l'identifiant est proposé s'il est connu pour ce site.
- **`isPasswordChange`** : tuile « Générer » ; `fill({ origin, password: actuel, newPassword: généré })` si
  l'utilisateur le demande ; après `captureSubmit` avec `newPassword`, carte « Mettre à jour ? » qui pousse l'ancien
  dans `passwordHistory`.

---

## 6. Observation et applications monopages

`observe()` suffit aux SPA : une navigation côté client modifie le DOM, donc déclenche une mutation ; `popstate`
et `hashchange` sont écoutés en plus. Le script ne redéfinit **pas** `history.pushState` (on ne modifie pas les
prototypes de la page). Le natif, lui, réinitialise son état (carte, candidats) à chaque changement d'URL de la vue
et à chaque `initial`. Le temporisateur de 150 ms évite une tempête de rappels pendant un rendu ; les événements
`focus`/`blur` passent sans délai.

---

## 7. Correspondance d'origine stricte (côté natif)

Décidée **depuis l'URL de la vue**, jamais depuis la page. Vecteurs : `shared/fixtures/forms/origin-matching.json`,
implémentation de référence dans `shared/test/forms.test.mjs` (`matchOrigin`).

### 7.1 Normalisation d'une origine

`scheme://host[:port]` : schéma en minuscules, **`http` ou `https` seulement** (une origine `app:com.aeon` d'un
identifiant Android est ignorée pour une page web) ; hôte en minuscules, **punycode** (forme `xn--`), point final
retiré ; port omis s'il est celui du schéma (`:443` pour https, `:80` pour http) ; chemin, requête et fragment
supprimés. Les `origins` d'un identifiant sont **stockés normalisés** (CRYPTO.md / schéma `common.schema.json`).
« Apex » d'un hôte = l'hôte sans son préfixe `www.` ; `www.` et l'apex sont **équivalents** partout.

### 7.2 Premier rang : exact

Même schéma, même port, même apex ⇒ **exact**. C'est le seul rang par défaut. Un identifiant enregistré en
`http://` et proposé sur la même page en `https://` est exact, avec `upgrade:true` : l'appli propose de mettre
l'origine à jour (l'inverse, §7.4, est interdit).

### 7.3 Second rang : « proposer aussi sur les sous-domaines » (`matchSubdomains`)

> **Décision.** eTLD+1 **ne suffit pas** : des milliers de sites hébergent des contenus tiers sur des sous-domaines
> (`*.github.io`, `*.herokuapp.com`, pages d'utilisateurs). COFFRE-SYNC.md §7.1 voulait un second rang étiqueté
> et mémorisé ; il est conservé, mais **derrière un drapeau explicite par identifiant**, `matchSubdomains`
> (booléen, `false` par défaut, dans le contenu chiffré du `login`, ligne « Proposer aussi sur les sous-domaines »
> dans la fiche). Sans le drapeau, l'utilisateur passe par « Mots de passe… » (recherche dans tout le coffre) ; le
> choix d'un identifiant pour une autre origine l'ajoute à ses `origins` (correspondance exacte désormais,
> `memorised-subdomain-origin`). Deux mécanismes, deux intentions : « ce site, précisément » et « tout ce domaine ».

Avec `matchSubdomains:true` : même schéma, même port, et même **domaine enregistrable** (eTLD+1 d'après la Public
Suffix List, `shared/web/psl-compact.dat` ; Swift : analyseur embarqué ; Android : `PublicSuffixDatabase` d'OkHttp
ou le fichier ; TS : `tldts`) ⇒ **subdomain**, carte étiquetée avec l'hôte **complet** de la page
(`login.aeon.example`). Un hôte sans domaine enregistrable (adresse IP, `localhost`, suffixe public lui-même
comme `github.io`) n'a jamais de second rang. La règle fonctionne dans les deux sens (l'identifiant de
`login.aeon.example` est proposé sur `aeon.example` et sur `shop.aeon.example`) et jamais au-delà
(`aeon.example.evil.example` est un autre domaine enregistrable).

Le drapeau est posé **par l'utilisateur**, jamais automatiquement ; l'import Chrome/Firefox ne le pose pas.

### 7.4 Jamais proposé

- Page `http://` pour un identifiant `https://` (**downgrade**) : carte d'avertissement « Ce site n'est pas
  sécurisé ; votre identifiant est enregistré pour la version sécurisée » sans bouton Remplir. Un identifiant
  `http://` exact l'emporte sur un `https://` en downgrade (`downgrade-beaten-by-exact`) : il **est** exact.
- Erreur TLS sur la page (certificat refusé puis contourné) : rien.
- `about:`, `file:`, `data:`, `blob:`, `qafila:` : rien (`detect()` renvoie d'ailleurs `[]`).
- Cadres enfants : rien, même de même origine (v1).
- Onglets privés : rien, sauf réglage « Remplir aussi en navigation privée » (désactivé par défaut).
- Hôtes IDN : comparés en punycode. Si l'hôte **affiché** mélange des alphabets (latin + cyrillique…), la carte
  d'adresse montre la forme `xn--` en rouge et la carte de remplissage ajoute « Vérifiez l'adresse ».
- Un port différent, un schéma différent : jamais.

### 7.5 Ordre des candidats

1. rang (exact avant subdomain) ; 2. `formActionOrigin` enregistré égal à celui de la page ; 3. `lastUsedAt` le plus
   récent ; 4. `modifiedAt`. Au plus 3 pastilles ; au-delà, « Mots de passe… ».

---

## 8. La carte de remplissage : contrat d'interface (style Quiche, DESIGN.md)

| Règle | Détail |
|---|---|
| **Un tap** | Un tap sur la carte = un `fill()`. Rien d'autre ne remplit : pas d'insertion au focus, pas de « remplir automatiquement sur ce site », pas de minuterie, pas de remplissage à la navigation. |
| **Jamais sans geste** | Le geste est le tap sur la carte native (hors de la page). Si le coffre est verrouillé, le tap déclenche la biométrie (ou le mot de passe) puis remplit **sans second tap** si l'authentification réussit dans les 30 s ; sinon rien. |
| **Jamais de soumission** | Après le remplissage, le clavier reste ouvert sur le dernier champ rempli ; l'utilisateur appuie sur le bouton du site. |
| **Quand** | Carte affichée quand `observe` rapporte `focused` sur un champ détecté **et** qu'il existe ≥ 1 candidat (§7) ; repliée sur `focused:null`, `blur`, changement d'URL, verrouillage. Au plus **1 s** après le focus (le temps du déchiffrement niveau 1), jamais avant que l'origine de la vue soit stable. Sur PC, aussi par Ctrl/Cmd+Maj+L quand un champ détecté a le focus. |
| **Où** | Mobile : carte blanche au-dessus du clavier, dans la zone des suggestions qu'utilise déjà l'éditeur d'adresse. PC : ancrée au-dessus de la barre, alignée au champ. |
| **Quoi** | DOMAINE en petites capitales (9,5 pt, interlettrage 0,6) + identifiant (12,5 pt, une ligne, tronqué), icône clé fine à gauche, rayon 12. Second rang : l'hôte complet de la page en libellé sous le domaine (« login.aeon.example »). `formActionOrigin` différent : ligne grise « envoie vers auth.shop-id.example ». Jamais le mot de passe, même masqué. |
| **Plusieurs** | ≤ 3 pastilles horizontales (identifiant seul), défilement ; dernière pastille « Mots de passe… ». |
| **Inscription** | `isSignup` : tuile « Générer un mot de passe » (20 caractères par défaut, §7.3 de COFFRE-SYNC.md) ; un tap remplit nouveau + confirmation **et** retient le mot de passe généré en mémoire 10 min pour la carte « Enregistrer ? ». |
| **Appui long** | sur un champ détecté : « Mots de passe… » (recherche dans tout le coffre ; le choix d'un identifiant pour une autre origine l'ajoute à `origins`, après confirmation en une ligne). |
| **Enregistrer** | Après `captureSubmit` : carte « Enregistrer dans Qafila ? » (couple nouveau) ou « Mettre à jour ? » (même identifiant, mot de passe différent), affichée **après** la navigation ou 1,5 s sans navigation, avec « Jamais pour ce site » (`neverSaveHere` sur un `login` à mot de passe vide ou drapeau sur l'existant). Disparaît seule au changement d'onglet. Rien pour un mot de passe identique, rien pour un site `neverSaveHere`, rien pour un `downgrade`. |
| **Indices** | Chip clé à droite de la carte d'adresse quand `detect()` n'est pas vide (tap = même carte). Point discret si la proposition d'enregistrement attend. |
| **Échec** | `fill()` renvoie `ok:false` : toast une ligne « Impossible de remplir ce champ » + bouton Copier (presse-papiers, §9). Jamais de nouvelle tentative automatique. |
| **Textes** | Français d'abord, anglais ensuite ; tous dans `shared/i18n/{fr,en}.json` (clés `forms.*`). |

---

## 9. Hygiène du presse-papiers

Le remplissage **ne passe jamais** par le presse-papiers (setter natif, §4). Le presse-papiers n'est utilisé
que sur un tap explicite « Copier » (fiche d'un identifiant, générateur, repli d'échec).

| Règle | iOS | Android | PC |
|---|---|---|---|
| Expiration **60 s** pour un mot de passe, un code TOTP, une clé de secours | `UIPasteboard.general.setItems([...], options: [.expirationDate: +60 s, .localOnly: true])` | `ClipDescription.extras` avec `EXTRA_IS_SENSITIVE` (API 33+ : masque l'aperçu système) ; `Handler`/`WorkManager` efface à 60 s **si** le clip est encore le nôtre (`ClipboardManager.clearPrimaryClip()`, API 28+) | `clipboard.writeText` ; `setTimeout` 60 s puis `clipboard.clear()` **si** `clipboard.readText()` est encore notre valeur |
| Pas d'historique ni de presse-papiers universel | `.localOnly: true` (pas Handoff/iCloud) | `EXTRA_IS_SENSITIVE` (exclu de l'historique des claviers qui le respectent) | aucun gestionnaire d'historique n'est contournable : documenté dans À propos |
| Identifiant (nom d'utilisateur) | copie **sans** expiration (pas un secret), `.localOnly` tout de même | idem, sans `EXTRA_IS_SENSITIVE` | idem |
| Ré-authentification | si le coffre est verrouillé : biométrie / mot de passe **avant** la copie d'un secret | idem | mot de passe principal (ou « Se souvenir sur cet ordinateur ») |
| Retour visuel | « Copié · effacé dans 60 s » en une ligne, puis « Effacé » | idem | idem |
| Jamais | journaliser le contenu ; copier au focus ; copier « pour faciliter » après un `fill()` ; lire le presse-papiers sans action de l'utilisateur (hors vérification « est-ce encore notre valeur ») | | |
| Génération | le mot de passe généré va dans les champs via `fill()` ; « Copier » reste un tap distinct | | |

---

## 10. Tests et conformité

- `cd shared && npm test` : `test/forms.test.mjs` charge chaque fixture sous son `url`, injecte le script,
  compare `detect()` **à l'identique** avec `<nom>.expected.json`, vérifie que chaque `selectorPath` désigne un
  seul `<input>` du bon type, puis exerce `fill()` (événements, refus d'origine, cadre enfant, champs cachés / en
  lecture seule, inscription, changement, React, sans `<form>`), `captureSubmit()` (submit, clic, Entrée, doublons,
  confirmation différente) et `observe()` (initial, mutation, dédoublonnage, focus, désabonnement). Il rejoue
  aussi `origin-matching.json` avec l'implémentation de référence de §7.
- **Ports natifs** (phase 1) : les mêmes fixtures chargées dans une `WKWebView` (XCTest, hors simulateur impossible :
  cible macOS de `QafilaCore` avec WebKit) et dans une `WebView` (test instrumenté ou Robolectric) doivent produire
  la **même** description ; `origin-matching.json` se rejoue en test unitaire pur (Swift, Kotlin, TS). Le job CI
  « conformance » (COFFRE-SYNC.md §9.1) y ajoute un contrôle de dérive : le SHA-256 du script embarqué sur chaque
  plateforme est celui de `shared/qafila-forms.js`.
- Ajouter une fixture = ajouter la page **et** son attendu, écrit à la main d'après §3, puis faire passer les trois
  plateformes. Un attendu généré par le script lui-même n'a aucune valeur de contrat.

---

## 11. Décisions prises ici (à relire par le propriétaire)

1. `detect()` renvoie un **tableau** de formulaires (une page peut en avoir plusieurs), chacun au format demandé,
   plutôt qu'un objet unique.
2. Dans un **cadre enfant**, le script est inerte (`frame:"child"`, `detect()` = `[]`, `fill()` = `frame`), même
   pour une iframe de même origine ; les banques qui logent leur formulaire dans une iframe attendront la phase 5.
3. Les champs **cachés** (`type=hidden`, `display:none`, formulaire masqué) sont **décrits** (`visible:false`),
   jamais remplis ; un formulaire entièrement caché est quand même classé, pour que la carte apparaisse dès qu'une
   fenêtre modale s'ouvre (`observe` le signale).
4. Formulaire « identifiant d'abord » détecté **uniquement** sur `autocomplete="username"` (opt-in du site).
5. Inscription à un seul mot de passe reconnue par les attributs du formulaire ou le texte de ses boutons
   (`RE_SIGNUP`), jamais par le texte libre de la page.
6. `captureSubmit` rapporte **aussi** sur un clic de bouton de soumission (les SPA n'émettent pas `submit`), avec
   dédoublonnage 3 s ; c'est le natif qui attend la navigation ou 1,5 s avant de proposer d'enregistrer.
7. `observe` rapporte le **focus** (`meta.focused`), nécessaire à la carte « champ focalisé ⇒ carte » de
   COFFRE-SYNC.md §7.1 que le natif ne peut pas voir seul dans une WebView.
8. Correspondance d'origine : exact par défaut, second rang (eTLD+1) **derrière `matchSubdomains`** par
   identifiant ; `http`→`https` accepté avec proposition de mise à jour ; `https`→`http` jamais.
9. Le presse-papiers n'intervient jamais dans le remplissage ; 60 s pour les secrets, pas d'expiration pour un
   identifiant.
10. À ajouter au schéma `record-login.schema.json` (propriété du contrat crypto/protocole, non modifié ici) :
    `"matchSubdomains": { "type": "boolean" }`, optionnel, `false` par défaut ; les champs inconnus étant conservés,
    rien ne casse en attendant.
