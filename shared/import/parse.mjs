// Qafila — analyseur de référence pour l'import Chrome / Firefox (contrat : shared/IMPORT.md).
//
// Module ES sans dépendance ni DOM, écrit en ES2017 (pas de `?.`, `??`, `flat`, lookbehind) pour être chargé
// tel quel dans Electron (processus main ou renderer), dans Node et dans un navigateur. Les ports Swift
// (ios-browser/QafilaCore) et Kotlin (android-browser/core) doivent produire exactement les JSON de
// shared/fixtures/import/expected/ à partir des mêmes fixtures : ce fichier est la référence, pas une bibliothèque.
//
// Entrées : le texte du fichier (déjà décodé en UTF-8 par la plateforme). Sorties : objets JSON purs,
// déterministes (aucun identifiant aléatoire, aucune date « maintenant ») ; la transformation en
// enregistrements du coffre (§4.1 de COFFRE-SYNC.md) est décrite dans IMPORT.md §6.
//
// Rien n'est journalisé ici, volontairement : les objets contiennent des mots de passe en clair.

export const MAX_FILE_BYTES = 50 * 1024 * 1024;   // 50 Mio : au-delà, le fichier est refusé avant lecture
export const MAX_PASSWORD_BYTES = 1024;           // 1 Kio UTF-8 : au-delà, la ligne est ignorée (password-too-long)
export const MAX_FIELD_BYTES = 32 * 1024;         // 32 Kio : titre, nom d'utilisateur, note, URL (field-too-long)

const CHROME_REQUIRED = ['name', 'url', 'username', 'password'];
const FIREFOX_REQUIRED = ['url', 'username', 'password', 'httprealm', 'formactionorigin', 'guid'];
const SAFARI_REQUIRED = ['title', 'url', 'username', 'password', 'otpauth'];
const BITWARDEN_REQUIRED = ['folder', 'type', 'name', 'login_uri', 'login_username', 'login_password'];

export class ImportError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// ------------------------------------------------------------------ utilitaires

/** Longueur UTF-8 en octets d'une chaîne JavaScript (sans TextEncoder, pour les vieux moteurs). */
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Retire un BOM UTF-8 (U+FEFF) en tête de texte. */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function checkSize(text) {
  if (typeof text !== 'string') throw new ImportError('E_NOT_TEXT', 'Le contenu doit être une chaîne de caractères');
  // text.length (UTF-16) ≤ longueur UTF-8 : un texte de plus de 50 Mi « caractères » dépasse forcément 50 Mio.
  // Le contrôle exact sur la taille du fichier en octets est fait par la plateforme avant décodage (IMPORT.md §5).
  if (text.length > MAX_FILE_BYTES) throw new ImportError('E_TOO_LARGE', 'Fichier de plus de 50 Mio');
  return stripBom(text);
}

/** Horodatage → millisecondes Unix ou null. Secondes par défaut ; > 10¹² ⇒ déjà en ms ; > 10¹⁶ ⇒ µs WebKit depuis 1601. */
export function normalizeTimestamp(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!isFinite(n) || n <= 0) return null;
  if (n > 1e16) return Math.round(n / 1000) - 11644473600000;
  if (n > 1e12) return Math.round(n);
  return Math.round(n * 1000);
}

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

function parseUrl(input) {
  try { return new URL(input); } catch (e) { return null; }
}

/**
 * URL → origine `scheme://host[:port]` (IMPORT.md §4.1) ou null si refusée.
 * Schéma http/https uniquement ; hôte en minuscules, IDN en punycode ; port par défaut retiré ;
 * identifiants, chemin, requête et fragment supprimés ; sans schéma ⇒ https.
 */
export function normalizeOrigin(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s === '') return null;
  // sans schéma ⇒ https ; un `:` suivi d'un chiffre est un port (`localhost:3000`), pas un schéma
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:(?![0-9])/.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  const u = parseUrl(s);
  if (!u) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname;
  if (!host) return null;
  if (host.length > 1 && host.charAt(host.length - 1) === '.') host = host.slice(0, -1);
  const port = u.port && u.port !== DEFAULT_PORTS[u.protocol] ? ':' + u.port : '';
  return u.protocol + '//' + host + port;
}

/**
 * Origine d'un identifiant, applications Android comprises :
 * `android://<hash>@<package>/` (Chrome) ou `app:<package>` (export Qafila) ⇒ `app:<package>` ; sinon normalizeOrigin.
 */
export function loginOrigin(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let m = /^android:\/\/(?:[^@\/]*@)?([A-Za-z0-9_.]+)\/?$/i.exec(s);
  if (m) return 'app:' + m[1];
  m = /^app:([A-Za-z0-9_.]+)$/.exec(s);
  if (m) return 'app:' + m[1];
  return normalizeOrigin(s);
}

/** Libellé court d'une origine pour un titre : `aeon.co`, `aeon.co:8443`, `com.example.app`. */
export function originLabel(origin) {
  if (origin.indexOf('app:') === 0) return origin.slice(4);
  return origin.replace(/^https?:\/\//, '');
}

/**
 * Clé de dédoublonnage d'un favori (IMPORT.md §7.2) : schéma et hôte en minuscules, port par défaut retiré,
 * fragment retiré, `/` final du chemin retiré, requête conservée. null si l'URL est invalide.
 */
export function bookmarkKey(url) {
  if (typeof url !== 'string') return null;
  const u = parseUrl(url.trim());
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  let host = u.hostname;
  if (host.length > 1 && host.charAt(host.length - 1) === '.') host = host.slice(0, -1);
  const port = u.port && u.port !== DEFAULT_PORTS[u.protocol] ? ':' + u.port : '';
  let path = u.pathname;
  if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);
  if (path === '/') path = '';
  const userinfo = u.username ? u.username + (u.password ? ':' + u.password : '') + '@' : '';
  return u.protocol + '//' + userinfo + host + port + path + u.search;
}

const BOOKMARK_SCHEMES = /^(https?):\/\//i;

/** Classe une URL de favori : 'ok' ou la raison du rejet. */
function bookmarkUrlStatus(url) {
  if (!url) return 'missing-url';
  if (!BOOKMARK_SCHEMES.test(url)) return 'unsupported-scheme';
  if (!parseUrl(url)) return 'invalid-url';
  return 'ok';
}

// ------------------------------------------------------------------ CSV (RFC 4180, tolérant)

/**
 * Découpe un texte CSV en lignes de champs. Guillemets doublés, virgules et CR/LF dans les champs entre
 * guillemets, fins de ligne CRLF / LF / CR, lignes entièrement vides ignorées. Un guillemet au milieu d'un
 * champ non cité est littéral (tolérance). Aucune interprétation des types : tout est chaîne.
 */
export function parseCsv(text) {
  const rows = [];
  const n = text.length;
  let row = [];
  let field = '';
  let start = 0;
  let i = 0;
  let quoted = false;    // le champ courant a été ouvert par un guillemet

  const endField = () => { row.push(field); field = ''; quoted = false; };
  const endRow = () => {
    endField();
    let empty = true;
    for (let k = 0; k < row.length; k++) if (row[k] !== '') { empty = false; break; }
    if (!empty) rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 0x22 /* " */ && i === start && field === '' && !quoted) {
      // champ entre guillemets
      quoted = true;
      i++;
      start = i;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) { field += text.slice(start); i = n; break; }           // guillemet fermant absent : tolérance
        if (text.charCodeAt(q + 1) === 0x22) { field += text.slice(start, q + 1); i = q + 2; start = i; continue; }
        field += text.slice(start, q);
        i = q + 1;
        break;
      }
      field = field.replace(/\r\n?/g, '\n');      // sauts de ligne internes uniformisés en LF
      // après la fermeture, on avale jusqu'au séparateur (texte parasite éventuel conservé)
      start = i;
      continue;
    }
    if (c === 0x2c /* , */) { field += text.slice(start, i); endField(); i++; start = i; continue; }
    if (c === 0x0d /* CR */) {
      field += text.slice(start, i); i++;
      if (text.charCodeAt(i) === 0x0a) i++;
      endRow(); start = i; continue;
    }
    if (c === 0x0a /* LF */) { field += text.slice(start, i); i++; endRow(); start = i; continue; }
    i++;
  }
  field += text.slice(start, n);
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function headerIndex(headerRow) {
  const idx = {};
  for (let i = 0; i < headerRow.length; i++) {
    const name = stripBom(headerRow[i]).trim().toLowerCase();
    if (name && !(name in idx)) idx[name] = i;
  }
  return idx;
}

function hasAll(idx, names) {
  for (let i = 0; i < names.length; i++) if (!(names[i] in idx)) return false;
  return true;
}

function csvKind(idx) {
  if (hasAll(idx, FIREFOX_REQUIRED)) return 'firefox-csv';
  if (hasAll(idx, CHROME_REQUIRED)) return 'chrome-csv';
  if (hasAll(idx, SAFARI_REQUIRED)) return 'safari-csv';
  if (hasAll(idx, BITWARDEN_REQUIRED)) return 'bitwarden-csv';
  return null;
}

/** Première ligne non vide d'un CSV (pour la détection), sans lire tout le fichier. */
function firstRecord(text) {
  // on prend assez de texte pour un en-tête, même si une cellule citée contenait un saut de ligne
  const rows = parseCsv(text.slice(0, 64 * 1024));
  return rows.length ? rows[0] : [];
}

function cell(row, idx, name) {
  const i = idx[name];
  if (i === undefined || i >= row.length) return '';
  return row[i];
}

function tooLong(value, max) { return value.length > max || utf8Length(value) > max; }   // octets ≥ caractères UTF-16

function rowFieldsTooLong(fields) {
  for (let i = 0; i < fields.length; i++) if (tooLong(fields[i], MAX_FIELD_BYTES)) return true;
  return false;
}

function loginsResult(format, source, logins, skipped, rows) {
  let androidApps = 0;
  for (let i = 0; i < logins.length; i++) if (logins[i].origins[0].indexOf('app:') === 0) androidApps++;
  return {
    format, source, logins, skipped,
    counts: { rows, logins: logins.length, skipped: skipped.length, androidApps }
  };
}

/**
 * CSV Chrome / Edge / Brave / Google Password Manager : `name,url,username,password[,note]`.
 * Colonnes par nom d'en-tête ; `note` optionnelle ; aucune date (createdAt = moment de l'import, posé par l'appli).
 */
export function parseChromeCsv(text) {
  const rows = parseCsv(checkSize(text));
  if (!rows.length) throw new ImportError('E_EMPTY', 'Fichier vide');
  const idx = headerIndex(rows[0]);
  if (!hasAll(idx, CHROME_REQUIRED)) throw new ImportError('E_HEADER', 'En-tête Chrome attendu : name,url,username,password[,note]', rows[0]);
  const logins = [];
  const skipped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = cell(row, idx, 'name').trim();
    const url = cell(row, idx, 'url').trim();
    const username = cell(row, idx, 'username');
    const password = cell(row, idx, 'password');
    const note = cell(row, idx, 'note');
    const skip = classifyLoginRow(url, username, password, [name, username, note]);
    if (skip) { skipped.push({ row: r, reason: skip, url }); continue; }
    const origin = loginOrigin(url);
    logins.push({
      title: name || originLabel(origin),
      origins: [origin],
      username,
      password,
      note,
      formActionOrigin: null,
      httpRealm: null,
      createdAt: null,
      lastUsedAt: null,
      passwordChangedAt: null,
      importGuid: null,
      source: 'chrome'
    });
  }
  return loginsResult('chrome-csv', 'chrome', logins, skipped, rows.length - 1);
}

/** null si la ligne est acceptable, sinon la raison du rejet (ordre fixe des contrôles). */
function classifyLoginRow(url, username, password, otherFields) {
  if (url === '' && username === '' && password === '') return 'empty';
  if (loginOrigin(url) === null) return 'invalid-origin';
  if (tooLong(password, MAX_PASSWORD_BYTES)) return 'password-too-long';
  if (rowFieldsTooLong(otherFields)) return 'field-too-long';
  return null;
}

/**
 * CSV Firefox : `url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged`.
 * Temps en millisecondes (0 ou vide ⇒ null) ; `guid` ⇒ importGuid ; httpRealm non vide ⇒ authentification HTTP.
 */
export function parseFirefoxCsv(text) {
  const rows = parseCsv(checkSize(text));
  if (!rows.length) throw new ImportError('E_EMPTY', 'Fichier vide');
  const idx = headerIndex(rows[0]);
  if (!hasAll(idx, FIREFOX_REQUIRED)) throw new ImportError('E_HEADER', 'En-tête Firefox attendu : url,username,password,httpRealm,formActionOrigin,guid,…', rows[0]);
  const logins = [];
  const skipped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const url = cell(row, idx, 'url').trim();
    const username = cell(row, idx, 'username');
    const password = cell(row, idx, 'password');
    const realm = cell(row, idx, 'httprealm');
    const formAction = cell(row, idx, 'formactionorigin').trim();
    const guid = cell(row, idx, 'guid').trim();
    const skip = classifyLoginRow(url, username, password, [username, realm]);
    if (skip) { skipped.push({ row: r, reason: skip, url }); continue; }
    const origin = loginOrigin(url);
    const label = originLabel(origin);
    logins.push({
      title: realm !== '' ? 'Authentification HTTP · ' + label : label,
      origins: [origin],
      username,
      password,
      note: '',
      formActionOrigin: formAction === '' ? null : normalizeOrigin(formAction),
      httpRealm: realm === '' ? null : realm,
      createdAt: normalizeTimestamp(cell(row, idx, 'timecreated')),
      lastUsedAt: normalizeTimestamp(cell(row, idx, 'timelastused')),
      passwordChangedAt: normalizeTimestamp(cell(row, idx, 'timepasswordchanged')),
      importGuid: guid === '' ? null : guid,
      source: 'firefox'
    });
  }
  return loginsResult('firefox-csv', 'firefox', logins, skipped, rows.length - 1);
}

// ------------------------------------------------------------------ HTML Netscape (scanner de balises)

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Décode `&amp; &lt; &gt; &quot; &apos; &nbsp; &#NNN; &#xHH;`. Les entités inconnues restent telles quelles. */
export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{1,8});/g, (m, body) => {
    if (body.charAt(0) === '#') {
      const cp = body.charAt(1) === 'x' || body.charAt(1) === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      return String.fromCodePoint(cp);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function cleanText(raw) {
  return decodeEntities(raw).replace(/\s+/g, ' ').trim();
}

/** Attributs d'une balise : `NAME="v"`, `NAME='v'`, `NAME=v`, `NAME` (⇒ ""). Noms en minuscules. */
function parseAttributes(s) {
  const attrs = {};
  const re = /([^\s=\/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
    attrs[name] = decodeEntities(v);
  }
  return attrs;
}

/** Fin d'une balise ouverte en `pos` (après `<`), en respectant les attributs entre guillemets. */
function tagEnd(text, pos) {
  let quote = 0;
  for (let i = pos; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote) { if (c === quote) quote = 0; continue; }
    if (c === 0x22 || c === 0x27) { quote = c; continue; }
    if (c === 0x3e /* > */) return i;
  }
  return text.length;
}

/**
 * Tokenise une page HTML en `{ type:'tag', name, closing, attrs }` et `{ type:'text', text }`.
 * Commentaires, DOCTYPE et instructions sont sautés. Jamais un DOM : fonctionne partout, même mal formé.
 */
export function tokenizeHtml(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { tokens.push({ type: 'text', text: text.slice(i) }); break; }
    if (lt > i) tokens.push({ type: 'text', text: text.slice(i, lt) });
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.charAt(lt + 1) === '!' || text.charAt(lt + 1) === '?') {
      const end = text.indexOf('>', lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const end = tagEnd(text, lt + 1);
    const inner = text.slice(lt + 1, end).trim();
    i = end + 1;
    if (inner === '') continue;
    const closing = inner.charAt(0) === '/';
    const body = closing ? inner.slice(1).trim() : inner;
    const m = /^([a-zA-Z][a-zA-Z0-9:-]*)\s*([\s\S]*)$/.exec(body);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const attrs = closing ? {} : parseAttributes(m[2].replace(/\/\s*$/, ''));
    tokens.push({ type: 'tag', name, closing, attrs });
  }
  return tokens;
}

const ROLE_NAMES = {
  toolbar: ['bookmarks bar', 'barre de favoris', 'bookmarks toolbar', 'barre personnelle', 'barre des favoris', 'favorites bar'],
  unfiled: ['other bookmarks', 'autres favoris', 'unfiled bookmarks', 'autres marque-pages', 'unfiled'],
  menu: ['bookmarks menu', 'menu des marque-pages'],
  mobile: ['mobile bookmarks', 'marque-pages mobiles', 'favoris mobiles', 'favoris sur mobile'],
  internal: ['mozilla firefox']
};

function folderRole(attrs, name, depth) {
  if (attrs.personal_toolbar_folder !== undefined && attrs.personal_toolbar_folder.toLowerCase() !== 'false') return 'toolbar';
  if (attrs.unfiled_bookmarks_folder !== undefined && attrs.unfiled_bookmarks_folder.toLowerCase() !== 'false') return 'unfiled';
  if (depth > 0) return null;                       // les noms ne sont reconnus qu'au premier niveau
  const lower = name.toLowerCase();
  for (const role in ROLE_NAMES) if (ROLE_NAMES[role].indexOf(lower) >= 0) return role;
  return null;
}

function countBookmarks(folder) {
  let n = 0;
  for (let i = 0; i < folder.children.length; i++) {
    const c = folder.children[i];
    if (c.type === 'bookmark') n++; else if (c.type === 'folder') n += countBookmarks(c);
  }
  return n;
}

function countFolders(children) {
  let n = 0;
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === 'folder') n += 1 + countFolders(children[i].children);
  }
  return n;
}

/** Détecte le navigateur d'origine d'un fichier Netscape à partir de ses marques distinctives. */
export function detectNetscapeSource(text) {
  const head = text.slice(0, 256 * 1024);
  if (/UNFILED_BOOKMARKS_FOLDER|LAST_CHARSET=|Content-Security-Policy/i.test(head)) return 'firefox';
  const h1 = /<H1[^>]*>([\s\S]*?)<\/H1>/i.exec(head);
  if (h1) {
    const title = cleanText(h1[1]).toLowerCase();
    if (ROLE_NAMES.menu.indexOf(title) >= 0) return 'firefox';
    if (title === 'bookmarks' || title === 'favoris' || title === 'favorites') return 'chrome';
  }
  return 'unknown';
}

/**
 * Favoris au format Netscape (Chrome, Edge, Brave, Firefox, Safari…). Renvoie l'arbre des conteneurs de premier
 * niveau (`roots`), les éléments ignorés et des compteurs. Icônes, TAGS, SHORTCUTURL, LAST_CHARSET ignorés.
 */
export function parseNetscapeHtml(text) {
  text = checkSize(text);
  const tokens = tokenizeHtml(text);
  const root = { type: 'folder', name: '', children: [] };
  const stack = [];                      // dossiers ouverts par un <DL>
  let current = root;
  let pendingFolder = null;              // <H3> vu, en attente de son <DL>
  let lastItem = null;                   // cible d'un <DD>
  let capture = null;                    // { kind: 'h3'|'a'|'h1'|'dd', attrs, text }
  let sawDl = false;
  let title = null;
  const skipped = [];
  let separators = 0;
  let maxDepth = 0;
  const path = [];                       // noms des dossiers ouverts, pour les éléments ignorés

  const flushCapture = () => {
    if (!capture) return;
    const c = capture;
    capture = null;
    const txt = cleanText(c.text);
    if (c.kind === 'h1') { if (title === null) title = txt; return; }
    if (c.kind === 'dd') {
      if (lastItem && txt !== '') lastItem.note = lastItem.note ? lastItem.note + '\n' + txt : txt;
      return;
    }
    if (c.kind === 'h3') {
      const folder = {
        type: 'folder',
        name: txt || 'Sans titre',
        toolbar: false,
        role: folderRole(c.attrs, txt, path.length),
        addedAt: normalizeTimestamp(c.attrs.add_date),
        modifiedAt: normalizeTimestamp(c.attrs.last_modified),
        note: null,
        children: []
      };
      folder.toolbar = folder.role === 'toolbar';
      current.children.push(folder);
      pendingFolder = folder;
      lastItem = folder;
      return;
    }
    if (c.kind === 'a') {
      pendingFolder = null;              // un <H3> sans <DL> était un dossier vide, il reste tel quel
      const href = (c.attrs.href || '').trim();
      const status = bookmarkUrlStatus(href);
      if (status !== 'ok') {
        skipped.push({ reason: status, title: txt, url: href, path: path.slice() });
        lastItem = null;
        return;
      }
      if (tooLong(href, MAX_FIELD_BYTES) || tooLong(txt, MAX_FIELD_BYTES)) {
        skipped.push({ reason: 'field-too-long', title: txt.slice(0, 80), url: href.slice(0, 80), path: path.slice() });
        lastItem = null;
        return;
      }
      const bookmark = {
        type: 'bookmark',
        title: txt || href,
        url: href,
        addedAt: normalizeTimestamp(c.attrs.add_date),
        modifiedAt: normalizeTimestamp(c.attrs.last_modified),
        note: null
      };
      current.children.push(bookmark);
      lastItem = bookmark;
    }
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.type === 'text') {
      if (capture) capture.text += tok.text;
      continue;
    }
    const name = tok.name;
    if (capture && capture.kind === 'dd' && !(name === 'br' || name === 'b' || name === 'i' || name === 'em' || name === 'strong')) flushCapture();
    if (tok.closing) {
      if (capture && capture.kind === name) { flushCapture(); continue; }
      if (name === 'dl') {
        if (stack.length) {
          const top = stack.pop();
          current = top.parent;
          if (top.folder) path.pop();
        }
        pendingFolder = null;
        lastItem = null;
      }
      continue;
    }
    switch (name) {
      case 'h1': flushCapture(); capture = { kind: 'h1', attrs: tok.attrs, text: '' }; break;
      case 'h3': flushCapture(); capture = { kind: 'h3', attrs: tok.attrs, text: '' }; break;
      case 'a': flushCapture(); capture = { kind: 'a', attrs: tok.attrs, text: '' }; break;
      case 'dd': flushCapture(); capture = { kind: 'dd', attrs: tok.attrs, text: '' }; break;
      case 'dl': {
        flushCapture();
        const folder = pendingFolder;
        pendingFolder = null;
        if (!sawDl && !folder) { sawDl = true; stack.push({ parent: current, folder: null }); break; }   // conteneur racine
        sawDl = true;
        stack.push({ parent: current, folder });
        if (folder) { current = folder; path.push(folder.name); }
        if (path.length > maxDepth) maxDepth = path.length;
        break;
      }
      case 'hr': flushCapture(); separators++; lastItem = null; pendingFolder = null; break;
      case 'br': if (capture) capture.text += ' '; break;
      default: break;                    // dt, p, meta, title, b, i… : sans effet
    }
  }
  flushCapture();

  // dossier interne « Mozilla Firefox » : retiré et compté
  const roots = [];
  for (let i = 0; i < root.children.length; i++) {
    const c = root.children[i];
    if (c.type === 'folder' && c.role === 'internal') {
      skipped.push({ reason: 'internal-folder', title: c.name, url: '', path: [], bookmarks: countBookmarks(c) });
      continue;
    }
    roots.push(c);
  }

  return {
    format: 'netscape-html',
    source: detectNetscapeSource(text),
    title,
    roots,
    skipped,
    counts: { bookmarks: countBookmarks({ children: roots }), folders: countFolders(roots), separators, skipped: skipped.length, maxDepth }
  };
}

// ------------------------------------------------------------------ détection

/**
 * Détection par le contenu, jamais par l'extension (IMPORT.md §2).
 * Renvoie `{ format, source, supported, reason }` ; `format` null si rien n'est reconnu.
 */
export function detect(text) {
  if (typeof text !== 'string') return { format: null, source: null, supported: false, reason: 'not-text' };
  text = stripBom(text);
  const head = text.slice(0, 64 * 1024);
  const lead = head.replace(/^\s+/, '');
  if (lead.charAt(0) === '{') {
    if (/"format"\s*:\s*"qafila-backup"/.test(head)) return { format: 'qafila-backup', source: 'qafila', supported: true, reason: null };
    return { format: null, source: null, supported: false, reason: 'unknown' };
  }
  if (/^<|<!DOCTYPE\s+NETSCAPE-Bookmark-file-1|<DL\s*>\s*<p\s*>/i.test(lead)) {
    if (/<!DOCTYPE\s+NETSCAPE-Bookmark-file-1|<DL\s*>\s*<p\s*>|<DT\s*>\s*<(A|H3)\b/i.test(head)) {
      return { format: 'netscape-html', source: detectNetscapeSource(text), supported: true, reason: null };
    }
    return { format: null, source: null, supported: false, reason: 'html-not-bookmarks' };
  }
  const header = firstRecord(text);
  const kind = header.length ? csvKind(headerIndex(header)) : null;
  if (kind === 'chrome-csv') return { format: kind, source: 'chrome', supported: true, reason: null };
  if (kind === 'firefox-csv') return { format: kind, source: 'firefox', supported: true, reason: null };
  if (kind === 'safari-csv') return { format: kind, source: 'safari', supported: false, reason: 'phase-5' };
  if (kind === 'bitwarden-csv') return { format: kind, source: 'bitwarden', supported: false, reason: 'phase-5' };
  if (header.length >= 3) return { format: null, source: null, supported: false, reason: 'csv-unknown-header' };
  return { format: null, source: null, supported: false, reason: 'unknown' };
}

/** Détecte puis analyse. Lève ImportError E_UNSUPPORTED (phase 5) ou E_UNKNOWN_FORMAT. */
export function parse(text) {
  const d = detect(text);
  if (d.format === 'chrome-csv') return parseChromeCsv(text);
  if (d.format === 'firefox-csv') return parseFirefoxCsv(text);
  if (d.format === 'netscape-html') return parseNetscapeHtml(text);
  if (d.format === 'qafila-backup') throw new ImportError('E_BACKUP_FILE', 'Sauvegarde .qafila : voir CRYPTO.md §11', d);
  if (d.format) throw new ImportError('E_UNSUPPORTED', 'Format reconnu mais pas encore pris en charge : ' + d.format, d);
  throw new ImportError('E_UNKNOWN_FORMAT', 'Format non reconnu', d);
}

// ------------------------------------------------------------------ dédoublonnage

/** Clé d'un identifiant (IMPORT.md §7.1) : origine principale + nom d'utilisateur insensible à la casse, espaces retirés. */
export function loginKey(login) {
  return login.origins[0] + '\n' + String(login.username || '').trim().toLowerCase();
}

function cloneLogin(l) {
  const c = {};
  for (const k in l) c[k] = Array.isArray(l[k]) ? l[k].slice() : l[k];
  if (!Array.isArray(c.origins)) c.origins = [];
  if (!Array.isArray(c.passwordHistory)) c.passwordHistory = [];
  else c.passwordHistory = c.passwordHistory.map(h => ({ password: h.password, changedAt: h.changedAt }));
  if (typeof c.note !== 'string') c.note = '';
  return c;
}

function mergeNote(target, note) {
  if (!note || target.note.indexOf(note) >= 0) return false;
  target.note = target.note ? target.note + '\n' + note : note;
  return true;
}

function pushHistory(target, password, changedAt) {
  if (password === '' || password === target.password) return false;
  for (let i = 0; i < target.passwordHistory.length; i++) if (target.passwordHistory[i].password === password) return false;
  target.passwordHistory.unshift({ password, changedAt });
  if (target.passwordHistory.length > 10) target.passwordHistory.length = 10;
  return true;
}

function maxTs(a, b) { if (a === null || a === undefined) return b === undefined ? null : b; if (b === null || b === undefined) return a; return a > b ? a : b; }
function minTs(a, b) { if (a === null || a === undefined) return b === undefined ? null : b; if (b === null || b === undefined) return a; return a < b ? a : b; }

/**
 * Fusionne `incoming` dans `target` (muté, déjà une copie). Renvoie 'updated' si les mots de passe différaient
 * (le perdant est archivé dans passwordHistory), 'note' si seule la note / des métadonnées ont été complétées,
 * 'duplicate' sinon.
 */
function mergeLogin(target, incoming, now) {
  let outcome = 'duplicate';
  if (incoming.password !== target.password) {
    const incomingNewer = typeof incoming.passwordChangedAt === 'number' &&
      (target.passwordChangedAt === null || target.passwordChangedAt === undefined || incoming.passwordChangedAt > target.passwordChangedAt);
    if (incomingNewer) {
      const previous = target.password;
      const previousAt = typeof target.passwordChangedAt === 'number' ? target.passwordChangedAt : now;
      target.password = incoming.password;
      target.passwordChangedAt = incoming.passwordChangedAt;
      pushHistory(target, previous, previousAt);
      outcome = 'updated';
    } else if (pushHistory(target, incoming.password, typeof incoming.passwordChangedAt === 'number' ? incoming.passwordChangedAt : now)) {
      outcome = 'updated';
    }
    // sinon : ce mot de passe est déjà dans l'historique, rien ne change (ré-import idempotent)
  }
  let touched = false;
  if (mergeNote(target, incoming.note)) touched = true;
  for (let i = 0; i < incoming.origins.length; i++) {
    if (target.origins.indexOf(incoming.origins[i]) < 0) { target.origins.push(incoming.origins[i]); touched = true; }
  }
  if ((target.formActionOrigin === null || target.formActionOrigin === undefined) && incoming.formActionOrigin) { target.formActionOrigin = incoming.formActionOrigin; touched = true; }
  if ((target.httpRealm === null || target.httpRealm === undefined) && incoming.httpRealm) { target.httpRealm = incoming.httpRealm; touched = true; }
  if ((target.importGuid === null || target.importGuid === undefined) && incoming.importGuid) { target.importGuid = incoming.importGuid; touched = true; }
  const lu = maxTs(target.lastUsedAt, incoming.lastUsedAt); if (lu !== target.lastUsedAt) { target.lastUsedAt = lu; touched = true; }
  const ca = minTs(target.createdAt, incoming.createdAt); if (ca !== target.createdAt) { target.createdAt = ca; touched = true; }
  if (outcome === 'duplicate' && touched) outcome = 'note';
  return outcome;
}

/**
 * Dédoublonne des identifiants importés entre eux et contre le coffre (IMPORT.md §7.1).
 * `existing` : identifiants déjà dans le coffre (objets avec au moins origins, username, password ; `id` conservé).
 * Retour : `logins` = enregistrements à écrire (nouveaux + existants modifiés), et des compteurs.
 * `now` (ms) ne sert qu'à dater l'historique quand la source n'a pas de date ; fournir une valeur fixe en test.
 */
export function dedupeLogins(incoming, existing, options) {
  existing = existing || [];
  const now = options && typeof options.now === 'number' ? options.now : Date.now();
  const byKey = {};
  const byGuid = {};
  const entries = [];           // { login, fromVault, changed }
  const register = (entry) => {
    const k = loginKey(entry.login);
    if (!(k in byKey)) byKey[k] = entry;
    if (entry.login.importGuid && !(entry.login.importGuid in byGuid)) byGuid[entry.login.importGuid] = entry;
    entries.push(entry);
  };
  for (let i = 0; i < existing.length; i++) register({ login: cloneLogin(existing[i]), fromVault: true, changed: false });

  const counts = { incoming: incoming.length, added: 0, updated: 0, duplicates: 0, notesMerged: 0 };
  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    let entry = inc.importGuid ? byGuid[inc.importGuid] : undefined;
    if (!entry) entry = byKey[loginKey(inc)];
    if (!entry) {
      const copy = cloneLogin(inc);
      register({ login: copy, fromVault: false, changed: true });
      counts.added++;
      continue;
    }
    const outcome = mergeLogin(entry.login, inc, now);
    if (outcome === 'updated') { counts.updated++; entry.changed = true; }
    else if (outcome === 'note') { counts.duplicates++; counts.notesMerged++; entry.changed = true; }
    else counts.duplicates++;
  }
  const logins = [];
  for (let i = 0; i < entries.length; i++) if (entries[i].changed) logins.push(entries[i].login);
  return { logins, counts };
}

/**
 * Dédoublonne un arbre de favoris : même URL normalisée (bookmarkKey) dans le même dossier ⇒ un seul, le premier.
 * Renvoie un nouvel arbre et le nombre d'éléments retirés. Les dossiers ne sont jamais fusionnés.
 */
export function dedupeBookmarks(roots) {
  let removed = 0;
  const walk = (children) => {
    const seen = {};
    const out = [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c.type === 'bookmark') {
        const k = bookmarkKey(c.url) || c.url;
        if (k in seen) { removed++; continue; }
        seen[k] = true;
        out.push(Object.assign({}, c));
      } else if (c.type === 'folder') {
        out.push(Object.assign({}, c, { children: walk(c.children) }));
      } else out.push(c);
    }
    return out;
  };
  const result = walk(roots);
  return { roots: result, removed };
}

/**
 * Point d'entrée unique : `dedupe(parsed, existing, options)` applique dedupeLogins au résultat d'un CSV
 * (`parsed.logins`) ou dedupeBookmarks au résultat d'un HTML (`parsed.roots`).
 */
export function dedupe(parsed, existing, options) {
  if (parsed && Array.isArray(parsed.logins)) return dedupeLogins(parsed.logins, existing, options);
  if (parsed && Array.isArray(parsed.roots)) return dedupeBookmarks(parsed.roots);
  throw new ImportError('E_BAD_INPUT', 'dedupe attend le résultat de parseChromeCsv/parseFirefoxCsv ou parseNetscapeHtml');
}
