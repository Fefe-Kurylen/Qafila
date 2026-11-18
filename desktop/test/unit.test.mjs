// Tests unitaires (node --test) : liste blanche du lecteur, CSP des pages locales, adresses d'icônes, lien Stripe
// « Soutenir Qafila », robustesse de state.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const scripts = require('../main/scripts.js');
const { safeFaviconURL } = require('../main/favicon.js');
const filename = require('../main/filename.js');

test('lecteur : aucun attribut on*, aucun lien javascript:, aucune balise script', () => {
  const tree = { t: 'article', a: {}, c: [
    'a <b> & "c"',
    { t: 'img', a: { src: 'https://example.org/a.png', onerror: 'alert(1)', alt: '"><script>' }, c: [] },
    { t: 'img', a: { src: 'javascript:alert(1)' }, c: [] },
    { t: 'img', a: { src: 'data:image/svg+xml;base64,PHN2Zz4=' }, c: [] },
    { t: 'a', a: { href: 'javascript:alert(1)', onclick: 'x' }, c: ['lien'] },
    { t: 'a', a: { href: 'https://example.org/x' }, c: ['ok'] },
    { t: 'script', a: {}, c: ['alert(1)'] },
    { t: 'iframe', a: { src: 'https://evil.example' }, c: [] },
    { t: 'custom-el', a: { onmouseover: 'x' }, c: ['déballé'] },
    { t: 'p onclick="x"', a: {}, c: ['balise forgée'] },
  ] };
  const html = scripts.renderReaderTree(tree);
  assert.doesNotMatch(html, /\son\w+=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<script|<iframe|svg\+xml/i);
  assert.match(html, /a &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(html, /<a href="https:\/\/example.org\/x" rel="noreferrer">ok<\/a>/);
  assert.match(html, /déballé/);
  assert.match(html, /balise forgée/);
});

test('lecteur et pages locales : CSP sans script', () => {
  const page = scripts.readerPage({ title: 't', byline: '', host: 'example.org', tree: 'x' }, false);
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'/);
  assert.doesNotMatch(page, /<base\s/i);
  for (const html of [scripts.errorPage({ title: 'e', message: 'm', url: 'https://x' }), scripts.startPage({ dark: false })]) {
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  }
});

test('icônes : seulement http, https et data:image', () => {
  assert.equal(safeFaviconURL('file://attacker.example/share/a.ico'), null);
  assert.equal(safeFaviconURL('file:///C:/x.png'), null);
  assert.equal(safeFaviconURL('javascript:alert(1)'), null);
  assert.equal(safeFaviconURL('data:text/html,<script>'), null);
  assert.equal(safeFaviconURL('https://example.org/favicon.ico'), 'https://example.org/favicon.ico');
  assert.equal(safeFaviconURL('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

// ----- Soutenir Qafila : validation du lien Stripe (shared/support.json) -----
const contract = require('../main/contract.js');
const support = require('../main/support.js');

/** paymentLink() avec un support.json simulé. */
function link(stripePaymentLink, ...hosts) {
  const allowedHosts = hosts.length ? hosts[0] : ['buy.stripe.com'];
  const saved = contract.readJSONFresh;
  contract.readJSONFresh = () => (allowedHosts === undefined ? { stripePaymentLink } : { stripePaymentLink, allowedHosts });
  try { return support.paymentLink(); } finally { contract.readJSONFresh = saved; }
}

test('Stripe : lien vide = « Bientôt disponible » (désactivé)', () => {
  assert.deepEqual(link(''), { configured: false, url: null, reason: 'empty' });
  assert.equal(link('   ').configured, false);
  assert.equal(link(undefined).configured, false);
});

test('Stripe : un hôte hors de Stripe ajouté à allowedHosts reste refusé', () => {
  assert.equal(link('https://evil.example/abc', ['buy.stripe.com', 'evil.example']).configured, false);
  assert.equal(link('https://donate.stripe.com/abc', ['donate.stripe.com']).configured, true);
});

test('Stripe : https://buy.stripe.com accepté', () => {
  const l = link('https://buy.stripe.com/abc123');
  assert.equal(l.configured, true);
  assert.equal(l.url, 'https://buy.stripe.com/abc123');
});

test('Stripe : http, autre hôte, sosie, identifiants, port, javascript: refusés', () => {
  for (const bad of [
    'http://buy.stripe.com/abc', 'https://evil.example/abc', 'https://buy.stripe.com.evil.com/abc', 'https://stripe.com/abc',
    'https://u:p@buy.stripe.com/abc', 'https://u@buy.stripe.com/abc', 'https://buy.stripe.com:8443/abc', 'javascript:alert(1)', 'pas une adresse',
  ]) assert.equal(link(bad).configured, false, bad);
  assert.equal(link('https://buy.stripe.com/abc', []).configured, false, 'allowedHosts vide');
  assert.equal(link('https://buy.stripe.com/abc', undefined).configured, false, 'allowedHosts absent');
});

// ----- state.json : fichier corrompu mis de côté, écriture atomique, nouvel essai après échec -----
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../main/store.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'qafila-store-')); }
const quiet = (fn) => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('state.json corrompu : renommé en state.json.corrupt-<horodatage>, jamais écrasé', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), '{"tabs": [ tronqué');
  const store = new Store(dir);
  quiet(() => store.load());
  const backups = fs.readdirSync(dir).filter((f) => f.startsWith('state.json.corrupt-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{"tabs": [ tronqué');
  assert.equal(store.tabs.length, 0);
  store.addTab({ url: 'https://example.org/' });
  assert.equal(store.saveNow(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).tabs[0].url, 'https://example.org/');
  clearTimeout(store._timer);
});

test('state.json : aller-retour, aucun fichier temporaire laissé', () => {
  const dir = tmpDir();
  const a = new Store(dir);
  a.load();
  a.addTab({ url: 'https://example.org/a' });
  a.addBookmark('A', 'https://example.org/a');
  assert.equal(a.saveNow(), true);
  clearTimeout(a._timer);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  const b = new Store(dir);
  b.load();
  assert.equal(b.tabs[0].url, 'https://example.org/a');
  assert.equal(b.bookmarks[0].url, 'https://example.org/a');
});

test('state.json : écriture impossible = état gardé « à écrire » et nouvel essai programmé', () => {
  const parent = tmpDir();
  const dir = path.join(parent, 'pas-un-dossier');
  fs.writeFileSync(dir, 'x'); // un fichier à la place du dossier : mkdir / open échouent
  const store = new Store(dir);
  store.addTab({ url: 'https://example.org/' });
  clearTimeout(store._timer);
  assert.equal(quiet(() => store.saveNow()), false);
  assert.equal(store._dirty, true);
  assert.ok(store._timer, 'nouvel essai programmé');
  clearTimeout(store._timer);
});

// ----- Raccourcis clavier : dispositions non latines, conventions macOS -----
const shortcuts = require('../main/shortcuts.js');
const key = (k, o = {}) => ({ type: 'keyDown', key: k, code: '', ...o });

test('raccourcis : disposition arabe = touche physique (Ctrl+T, Ctrl+W, Ctrl+L)', () => {
  assert.equal(shortcuts.resolve(key('ف', { code: 'KeyT', control: true }), 'win32'), 'newTab');
  assert.equal(shortcuts.resolve(key('ت', { code: 'KeyW', control: true }), 'win32'), 'closeTab');
  assert.equal(shortcuts.resolve(key('م', { code: 'KeyL', control: true }), 'linux'), 'focusAddress');
  assert.equal(shortcuts.resolve(key('ف', { code: 'KeyT', control: true, shift: true }), 'win32'), 'reopenTab');
  // AZERTY : la lettre de la disposition (Ctrl+A en position Q reste « a »), chiffres par position physique.
  assert.equal(shortcuts.resolve(key('a', { code: 'KeyQ', control: true, shift: true }), 'win32'), 'tabs');
  assert.equal(shortcuts.resolve(key('&', { code: 'Digit1', control: true }), 'win32'), 'tab:1');
  assert.equal(shortcuts.resolve(key('à', { code: 'Digit0', control: true }), 'win32'), 'zoomReset');
});

test('raccourcis : macOS — ⌥←/→ laissé au système, ⌘[ ⌘] , ⌘Y historique, ⌘H libre, ⌘⌥I', () => {
  assert.equal(shortcuts.resolve(key('ArrowLeft', { alt: true }), 'darwin'), null);
  assert.equal(shortcuts.resolve(key('ArrowLeft', { alt: true }), 'win32'), 'back');
  assert.equal(shortcuts.resolve(key('[', { meta: true }), 'darwin'), 'back');
  assert.equal(shortcuts.resolve(key(']', { meta: true }), 'darwin'), 'forward');
  assert.equal(shortcuts.resolve(key('y', { meta: true }), 'darwin'), 'history');
  assert.equal(shortcuts.resolve(key('h', { meta: true }), 'darwin'), null);
  assert.equal(shortcuts.resolve(key('h', { control: true }), 'win32'), 'history');
  assert.equal(shortcuts.resolve(key('Dead', { code: 'KeyI', meta: true, alt: true }), 'darwin'), 'devtools');
  assert.equal(shortcuts.resolve(key('I', { code: 'KeyI', control: true, shift: true }), 'win32'), 'devtools');
  assert.equal(shortcuts.resolve(key('t', { control: true }), 'darwin'), null);
  assert.equal(shortcuts.resolve({ ...key('t', { control: true }), type: 'keyUp' }, 'win32'), null);
});

test('raccourcis : Alt+D et F6 (champ d\'adresse), pavé numérique sans Verr. Num., onglets sous macOS', () => {
  assert.equal(shortcuts.resolve(key('d', { code: 'KeyD', alt: true }), 'win32'), 'focusAddress');
  assert.equal(shortcuts.resolve(key('d', { code: 'KeyD', alt: true }), 'linux'), 'focusAddress');
  assert.equal(shortcuts.resolve(key('∂', { code: 'KeyD', alt: true }), 'darwin'), null);
  assert.equal(shortcuts.resolve(key('F6'), 'win32'), 'focusAddress');
  assert.equal(shortcuts.resolve(key('F6'), 'darwin'), 'focusAddress');
  assert.equal(shortcuts.resolve(key('End', { code: 'Numpad1', control: true }), 'win32'), null);
  assert.equal(shortcuts.resolve(key('Insert', { code: 'Numpad0', control: true }), 'win32'), null);
  assert.equal(shortcuts.resolve(key('Home', { code: 'Numpad7', control: true }), 'win32'), null);
  assert.equal(shortcuts.resolve(key('1', { code: 'Numpad1', control: true }), 'win32'), 'tab:1');
  assert.equal(shortcuts.resolve(key('&', { code: 'Digit1', control: true }), 'win32'), 'tab:1');
  assert.equal(shortcuts.resolve(key('Tab', { code: 'Tab', control: true }), 'darwin'), 'nextTab');
  assert.equal(shortcuts.resolve(key('Tab', { code: 'Tab', control: true, shift: true }), 'darwin'), 'prevTab');
  assert.equal(shortcuts.resolve(key('}', { code: 'BracketRight', meta: true, shift: true }), 'darwin'), 'nextTab');
  assert.equal(shortcuts.resolve(key('{', { code: 'BracketLeft', meta: true, shift: true }), 'darwin'), 'prevTab');
  assert.equal(shortcuts.resolve(key('ArrowRight', { meta: true, alt: true }), 'darwin'), 'nextTab');
  assert.equal(shortcuts.resolve(key('ArrowLeft', { meta: true, alt: true }), 'darwin'), 'prevTab');
  assert.equal(shortcuts.resolve(key('Tab', { code: 'Tab', control: true }), 'win32'), 'nextTab');
});

test('raccourcis : AZERTY Ctrl+6 (« - ») = onglet 6, Ctrl+) = zoom arrière ; macOS français ⌘ + touches [ ] = Précédent / Suivant', () => {
  assert.equal(shortcuts.resolve(key('-', { code: 'Digit6', control: true }), 'win32'), 'tab:6');
  assert.equal(shortcuts.resolve(key('-', { code: 'Digit6', control: true }), 'linux'), 'tab:6');
  assert.equal(shortcuts.resolve(key('+', { code: 'Digit1', control: true }), 'win32'), 'tab:1'); // tchèque
  assert.equal(shortcuts.resolve(key(')', { code: 'Minus', control: true }), 'win32'), 'zoomOut');
  assert.equal(shortcuts.resolve(key('-', { code: 'NumpadSubtract', control: true }), 'win32'), 'zoomOut');
  assert.equal(shortcuts.resolve(key('-', { code: 'Slash', control: true }), 'linux'), 'zoomOut'); // QWERTZ
  assert.equal(shortcuts.resolve(key('-', { code: 'Equal', meta: true }), 'darwin'), 'zoomOut'); // AZERTY Mac
  assert.equal(shortcuts.resolve(key('-', { code: 'Minus', control: true }), 'win32'), 'zoomOut');
  assert.equal(shortcuts.resolve(key('=', { code: 'Equal', control: true }), 'win32'), 'zoomIn');
  assert.equal(shortcuts.resolve(key('+', { code: 'Equal', control: true, shift: true }), 'win32'), 'zoomIn');
  assert.equal(shortcuts.resolve(key('(', { code: 'Digit5', control: true }), 'win32'), 'tab:5');
  assert.equal(shortcuts.resolve(key('Dead', { code: 'BracketLeft', meta: true }), 'darwin'), 'back');
  assert.equal(shortcuts.resolve(key('$', { code: 'BracketRight', meta: true }), 'darwin'), 'forward');
  assert.equal(shortcuts.resolve(key('Dead', { code: 'BracketLeft', control: true }), 'win32'), null);
});

test('pluriels : arabe few / many (Intl.PluralRules), français inchangé', () => {
  const i18n = require('../main/i18n.js');
  const ar = i18n.translator('ar');
  assert.ok(ar('close_n_tabs', 8).includes('علامات'), ar('close_n_tabs', 8));
  assert.notEqual(ar('close_n_tabs', 8), ar('close_n_tabs', 100));
  const fr = i18n.translator('fr');
  assert.ok(!fr('close_n_tabs', 0).includes('onglets'), fr('close_n_tabs', 0));
  assert.ok(fr('close_n_tabs', 2).includes('onglets'), fr('close_n_tabs', 2));
});

// ----- Identifiant de l'application : égal à build.appId (raccourcis NSIS, épinglage Windows) -----
test('APP_ID = build.appId de package.json', () => {
  const pkg = require('../package.json');
  assert.equal(require('../main/app-id.js').APP_ID, pkg.build.appId);
});

// ----- Réglages : clés héritées du prototype refusées sans exception -----
const settingsSchema = require('../main/settings.js');

test('réglages : __proto__, constructor, toString refusés ; state.json gardé', () => {
  for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal(settingsSchema.validate(k, 'x'), undefined, k);
  const out = settingsSchema.sanitize(JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1, "blockAds": false}'));
  assert.equal(out.blockAds, false);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

// ----- Noms des fichiers téléchargés et marque d'origine Internet -----
test('noms de fichiers : coupe avant l\'extension, ni point ni espace final, périphériques Windows', () => {
  const { safeFilename, extensionOf } = filename;
  const long = 'A'.repeat(195);
  // Coupé à 200 caractères sans perdre l'extension réelle ; jamais « ….exe. » (Windows écrirait « ….exe »).
  for (const n of [`${long}.exe.x`, `${long}.exe x`, `${long}.exe.`, `${long}.exe `, 'payload.exe.', 'payload.exe . .']) {
    const s = safeFilename(n);
    assert.ok(s.length <= 200, n);
    assert.doesNotMatch(s, /[. ]$/, JSON.stringify(s));
  }
  assert.equal(extensionOf(`${long}.exe.x`), 'x');
  assert.equal(extensionOf(`${long}.exe x`), 'exe x'); // écrit tel quel : « ….exe x » n'est pas un .exe
  assert.equal(extensionOf('payload.exe.'), 'exe');
  assert.equal(extensionOf('payload.exe . .'), 'exe');
  assert.equal(extensionOf(`${'B'.repeat(400)}.msi`), 'msi');
  assert.equal(safeFilename(`${'B'.repeat(400)}.msi`).length, 200);
  // Jamais une moitié de caractère (paire de substitution UTF-16) au point de coupe.
  const emoji = safeFilename(`${'C'.repeat(194)}😀😀😀.pdf`);
  assert.doesNotMatch(emoji, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.ok(emoji.endsWith('.pdf'));
  // Caractères interdits, fichier caché, noms de périphériques.
  assert.equal(safeFilename('a/b\\c:d*e?.txt'), 'a_b_c_d_e_.txt');
  assert.equal(safeFilename('..'), 'download');
  assert.equal(safeFilename('.bashrc'), 'bashrc');
  assert.equal(safeFilename(''), 'download');
  assert.equal(safeFilename('CON'), '_CON');
  assert.equal(safeFilename('nul.txt'), '_nul.txt');
  assert.equal(safeFilename('com1.tar.gz'), '_com1.tar.gz');
  assert.equal(safeFilename('console.txt'), 'console.txt');
  // Idempotent (uniquePath le réapplique).
  for (const n of [`${long}.exe.x`, 'CON', '😀.pdf', 'a b . c']) assert.equal(safeFilename(safeFilename(n)), safeFilename(n));
});

test('Zone.Identifier : ni identifiant, ni mot de passe, ni fragment ; rien en privé', () => {
  const z = filename.zoneIdentifier('http://jean:MotDePasse123@127.0.0.1:8080/f?token=abc#frag%0d%0a', false);
  assert.equal(z, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=http://127.0.0.1:8080/f?token=abc\r\n');
  assert.equal(filename.zoneIdentifier('https://example.org/a.exe', true), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.equal(filename.zoneIdentifier('blob:https://example.org/x', false), '[ZoneTransfer]\r\nZoneId=3\r\n');
});

test('mises à jour : canal test seulement pour « X.Y.Z-test.N »', () => {
  const { channelOf } = require('../main/updater.js');
  assert.equal(channelOf('0.9.1-test.12'), 'test');
  assert.equal(channelOf('1.0.0-test.1'), 'test');
  for (const v of ['0.9.1', '0.9.1-beta.1', '0.9.1-test', '0.9.1-test.1x', 'test', '', undefined]) assert.equal(channelOf(v), 'stable', String(v));
});

test('identité Chrome : user agent réduit et indices client avec la marque Google Chrome', () => {
  const { CHROME_UA, chromeMetadata, isGoogleLogin } = require('../main/tabs.js');
  assert.match(CHROME_UA, /Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  assert.doesNotMatch(CHROME_UA, /Electron|Qafila/i);
  const m = chromeMetadata();
  assert.ok(m.brands.some((b) => b.brand === 'Google Chrome'));
  assert.equal(m.mobile, false);
  assert.ok(isGoogleLogin('https://accounts.google.com/v3/signin/identifier?hl=fr'));
  for (const u of ['https://mail.google.com/', 'https://accounts.google.com.evil.example/']) assert.ok(!isGoogleLogin(u), u);
});

test('indices client par en-têtes : base partout, détaillés quand demandés (Accept-CH)', () => {
  const { clientHintHeaders, requestedHints } = require('../main/tabs.js');
  const base = clientHintHeaders();
  assert.deepEqual(Object.keys(base).sort(), ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']);
  assert.match(base['sec-ch-ua'], /^"Google Chrome";v="\d+", "Chromium";v="\d+", "Not\/A\)Brand";v="24"$/);
  assert.equal(base['sec-ch-ua-mobile'], '?0');
  const asked = requestedHints({ 'Accept-CH': ['Sec-CH-UA-Arch, Sec-CH-UA-Full-Version-List, Viewport-Width'], 'critical-ch': 'Sec-CH-UA-Bitness' });
  assert.deepEqual([...asked].sort(), ['sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version-list']);
  const full = clientHintHeaders(asked);
  assert.equal(full['sec-ch-ua-bitness'], '"64"');
  assert.match(full['sec-ch-ua-full-version-list'], /"Google Chrome";v="\d+\.\d+\.\d+\.\d+"/);
  assert.equal(full['viewport-width'], undefined);
});

test('favoris : dossiers (création, rangement, ordre, suppression sans perte, réparation, import en arborescence)', () => {
  const dir = tmpDir();
  const s = new Store(dir);
  s.load();
  const a = s.addBookmark('A', 'https://a.example/');
  const b = s.addBookmark('B', 'https://b.example/');
  const f = s.addFolder('Travail');
  const g = s.addFolder('Outils', f.id);
  assert.ok(s.moveItem('bookmark', a.id, g.id));
  assert.equal(s.bookmarks.find((x) => x.id === a.id).folder, g.id);
  assert.ok(!s.moveItem('folder', f.id, g.id), 'un dossier ne va pas dans son propre sous-dossier');
  assert.ok(s.moveItem('folder', g.id, null));
  // Ordre parmi les éléments du même dossier.
  const c = s.addBookmark('C', 'https://c.example/');
  const root = () => s.bookmarks.filter((x) => !x.folder).map((x) => x.title);
  assert.deepEqual(root(), ['C', 'B']);
  assert.ok(s.reorderItem('bookmark', b.id, -1));
  assert.deepEqual(root(), ['B', 'C']);
  assert.ok(s.placeBefore('bookmark', c.id, b.id));
  assert.deepEqual(root(), ['C', 'B']);
  // Suppression d'un dossier : son contenu remonte.
  s.moveItem('folder', g.id, f.id);
  assert.ok(s.removeFolder(f.id));
  assert.equal(s.folders.find((x) => x.id === g.id).parent, null);
  assert.ok(s.removeFolder(g.id));
  assert.equal(s.bookmarks.find((x) => x.id === a.id).folder, null);
  // Import : arborescence recréée et réutilisée ; annulation : dossiers importés vides retirés.
  const created = new Set();
  const added = s.addBookmarks([{ title: 'X', url: 'https://x.example/', folderPath: ['Autres', 'Sub'] }, { title: 'Y', url: 'https://y.example/', folderPath: ['Autres'] }], created);
  assert.equal(created.size, 2);
  assert.equal(s.removeBookmarks(new Set(added.map((x) => x.id)), created), 2);
  assert.equal(s.folders.length, 0);
  // Réparation au chargement : boucle et favori orphelin.
  clearTimeout(s._timer);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ bookmarks: [{ id: 'k', title: 'K', url: 'https://k.example/', folder: 'zz' }], folders: [{ id: 'p', name: 'P', parent: 'q' }, { id: 'q', name: 'Q', parent: 'p' }] }));
  const r = new Store(dir);
  r.load();
  assert.equal(r.bookmarks[0].folder, null);
  assert.ok(r.folders.some((x) => x.parent === null));
  clearTimeout(r._timer);
});
