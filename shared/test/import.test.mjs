// Tests du contrat « import Chrome / Firefox » (shared/IMPORT.md) et de l'analyseur de référence
// shared/import/parse.mjs :
// - chaque fixture de shared/fixtures/import/ est analysée et comparée à son attendu expected/*.json ;
// - détection par le contenu, normalisation des origines et des URL, CSV RFC 4180, scanner Netscape ;
// - dédoublonnage des identifiants (entre eux, contre le coffre, idempotence) et des favoris.
// Aucune dépendance, aucun réseau, aucun secret : les mots de passe des fixtures sont fictifs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  detect, parse, parseChromeCsv, parseFirefoxCsv, parseNetscapeHtml, parseCsv, tokenizeHtml, decodeEntities,
  normalizeOrigin, loginOrigin, bookmarkKey, normalizeTimestamp, utf8Length,
  dedupe, dedupeLogins, dedupeBookmarks, loginKey,
  ImportError, MAX_FILE_BYTES, MAX_PASSWORD_BYTES
} from '../import/parse.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'fixtures', 'import');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');
const expected = (name) => JSON.parse(readFileSync(join(FIXTURES, 'expected', name), 'utf8'));
const NOW = 1763290511123;

// ------------------------------------------------------------------ fixtures

const FIXTURE_FORMATS = {
  'chrome-passwords.csv': ['chrome-csv', 'chrome'],
  'firefox-logins.csv': ['firefox-csv', 'firefox'],
  'chrome-bookmarks.html': ['netscape-html', 'chrome'],
  'firefox-bookmarks.html': ['netscape-html', 'firefox']
};

test('toutes les fixtures ont un attendu et réciproquement', () => {
  const sources = readdirSync(FIXTURES).filter(f => /\.(csv|html)$/.test(f)).sort();
  const expectedFiles = readdirSync(join(FIXTURES, 'expected')).filter(f => f.endsWith('.json')).sort();
  assert.deepEqual(sources.map(f => f.replace(/\.(csv|html)$/, '.json')), expectedFiles);
  assert.deepEqual(sources, Object.keys(FIXTURE_FORMATS).sort());
});

for (const [name, [format, source]] of Object.entries(FIXTURE_FORMATS)) {
  test(`fixture ${name} : détection puis analyse identique à expected/`, () => {
    const text = read(name);
    const d = detect(text);
    assert.equal(d.format, format);
    assert.equal(d.source, source);
    assert.equal(d.supported, true);
    const out = parse(text);
    assert.deepEqual(out, expected(name.replace(/\.(csv|html)$/, '.json')));
    // le JSON attendu est lui-même stable au re-sérialisation (clés dans l'ordre, pas de undefined)
    assert.equal(JSON.stringify(out), JSON.stringify(expected(name.replace(/\.(csv|html)$/, '.json'))));
  });
}

test('fixture Chrome CSV : BOM, CRLF, ≥ 8 identifiants, unicode, virgules, guillemets, notes multilignes, android', () => {
  const text = read('chrome-passwords.csv');
  assert.equal(text.charCodeAt(0), 0xfeff);
  assert.ok(text.indexOf('\r\n') > 0);
  const out = parseChromeCsv(text);
  assert.ok(out.logins.length >= 8);
  assert.equal(out.counts.androidApps, 1);
  const google = out.logins.find(l => l.origins[0] === 'https://accounts.google.com');
  assert.equal(google.password, 'p,ass"word');
  const forum = out.logins.find(l => l.origins[0] === 'http://www.example.org');
  assert.equal(forum.note, 'Compte forum\ncréé en 2019, "ancien" mot de passe');   // CRLF interne ⇒ LF
  const signal = out.logins.find(l => l.title === 'Signal');
  assert.equal(signal.origins[0], 'app:org.thoughtcrime.securesms');
  assert.deepEqual(out.skipped.map(s => s.reason), ['invalid-origin', 'invalid-origin']);
  const idn = out.logins.find(l => l.title === 'Médiathèque de Tunis');
  assert.equal(idn.origins[0], 'https://xn--mdiathque-53af.example.tn');
  assert.equal(idn.username, 'لينا');
});

test('fixture Firefox CSV : temps en ms, guid, httpRealm, formActionOrigin, 0 ⇒ null', () => {
  const out = parseFirefoxCsv(read('firefox-logins.csv'));
  const routeur = out.logins.find(l => l.httpRealm !== null);
  assert.equal(routeur.title, 'Authentification HTTP · routeur.example.lan:8080');
  assert.equal(routeur.origins[0], 'https://routeur.example.lan:8080');
  assert.equal(routeur.formActionOrigin, null);
  const amine = out.logins.find(l => l.username === 'amine');
  assert.equal(amine.lastUsedAt, null);
  const forum = out.logins.find(l => l.username === 'sami');
  assert.equal(forum.formActionOrigin, 'https://forum.example.org');        // le `/` final est retiré
  assert.equal(forum.lastUsedAt, null);                                       // champ vide
  assert.equal(forum.password, 'mot de passe, avec virgule');
  assert.equal(out.logins.filter(l => l.importGuid === '{3f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90}').length, 2);
  assert.deepEqual(out.skipped, [{ row: 12, reason: 'invalid-origin', url: 'chrome://settings' }]);
});

test('fixture Chrome HTML : barre de favoris, imbrication, icônes ignorées, dates WebKit, éléments racine', () => {
  const out = parseNetscapeHtml(read('chrome-bookmarks.html'));
  assert.equal(out.title, 'Bookmarks');
  assert.ok(out.counts.bookmarks >= 15);
  const bar = out.roots[0];
  assert.equal(bar.type, 'folder');
  assert.equal(bar.toolbar, true);
  assert.equal(bar.role, 'toolbar');
  assert.equal(bar.name, 'Bookmarks bar');
  assert.equal(bar.children[0].title, 'Aeon | a world of ideas');
  assert.equal(bar.children[0].addedAt, 1700000001000);
  assert.equal('icon' in bar.children[0], false);
  assert.equal(bar.children[1].title, 'Le Monde.fr - Actualités & Infos');
  const lecture = bar.children[2];
  assert.equal(lecture.name, 'Lecture');
  assert.equal(lecture.children[1].name, 'Sciences & techniques');
  const empty = bar.children.find(c => c.name === 'Dossier vide');
  assert.deepEqual(empty.children, []);
  // éléments « Autres favoris » : directement à la racine chez Chrome
  assert.equal(out.roots[1].type, 'bookmark');
  assert.equal(out.roots[1].url, 'https://fr.wikipedia.org/wiki/Caravane_(transport)');
  const webkit = out.roots[out.roots.length - 1];
  assert.equal(webkit.addedAt, 1673726400000);                                // 13318200000000000 µs depuis 1601
  assert.equal(webkit.title, 'Date WebKit en µs');
  assert.deepEqual(out.skipped.map(s => s.reason), ['unsupported-scheme', 'unsupported-scheme']);
  assert.equal(out.counts.maxDepth, 3);
  assert.equal(out.counts.separators, 0);
});

test('fixture Firefox HTML : séparateurs, DD, place:, dossier interne, rôles, entités', () => {
  const out = parseNetscapeHtml(read('firefox-bookmarks.html'));
  assert.equal(out.title, 'Bookmarks Menu');
  assert.ok(out.counts.bookmarks >= 15);
  assert.equal(out.counts.separators, 3);
  assert.deepEqual(out.roots.filter(r => r.type === 'folder').map(r => [r.name, r.role, r.toolbar]), [
    ['Bookmarks Toolbar', 'toolbar', true],
    ['Other Bookmarks', 'unfiled', false],
    ['Mobile Bookmarks', 'mobile', false],
    ['Lecture', null, false]
  ]);
  const toolbar = out.roots[0];
  assert.equal(toolbar.note, 'Add bookmarks to this folder to see them displayed on the Bookmarks Toolbar');
  const aeon = toolbar.children[1];
  assert.equal(aeon.note, 'Essais longs, à lire le week-end');
  assert.equal(aeon.modifiedAt, 1750000000000);
  assert.equal('tags' in aeon, false);
  const webmail = toolbar.children[2].children.find(c => c.title === 'Webmail (dates en ms)');
  assert.equal(webmail.addedAt, 1763290000000);
  const internal = out.skipped.find(s => s.reason === 'internal-folder');
  assert.deepEqual(internal, { reason: 'internal-folder', title: 'Mozilla Firefox', url: '', path: [], bookmarks: 4 });
  assert.deepEqual(out.skipped.filter(s => s.reason === 'unsupported-scheme').map(s => s.url.split(':')[0]), ['place', 'about', 'file', 'data']);
  const lecture = out.roots[out.roots.length - 1];
  assert.equal(lecture.children[1].title, "L'été — billet");
  assert.equal(lecture.children[1].url, "https://blog.example.org/2026/l'%C3%A9t%C3%A9");
  assert.ok(JSON.stringify(out).indexOf('Mozilla Firefox') < 0 || out.skipped.some(s => s.title === 'Mozilla Firefox'));
  assert.equal(out.roots.some(r => r.name === 'Mozilla Firefox'), false);
});

// ------------------------------------------------------------------ détection

test('détection : en-têtes CSV (ordre, casse, BOM), Safari et Bitwarden reconnus mais phase 5', () => {
  assert.equal(detect('﻿name,url,username,password,note\r\n').format, 'chrome-csv');
  assert.equal(detect('name,url,username,password\n').format, 'chrome-csv');                     // sans note
  assert.equal(detect('URL,Username,Password,Name\n').format, 'chrome-csv');                     // ordre et casse libres
  assert.equal(detect('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n').format, 'firefox-csv');
  assert.deepEqual(detect('Title,URL,Username,Password,Notes,OTPAuth\n'), { format: 'safari-csv', source: 'safari', supported: false, reason: 'phase-5' });
  assert.deepEqual(detect('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'),
    { format: 'bitwarden-csv', source: 'bitwarden', supported: false, reason: 'phase-5' });
  assert.deepEqual(detect('a,b,c\n1,2,3\n'), { format: null, source: null, supported: false, reason: 'csv-unknown-header' });
  assert.deepEqual(detect('Bonjour, voici un texte.'), { format: null, source: null, supported: false, reason: 'unknown' });
  assert.deepEqual(detect(''), { format: null, source: null, supported: false, reason: 'unknown' });
  assert.deepEqual(detect(42), { format: null, source: null, supported: false, reason: 'not-text' });
});

test('détection : HTML Netscape (doctype, <DL><p>, source), HTML quelconque, sauvegarde .qafila', () => {
  assert.deepEqual(detect('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n</DL>'), { format: 'netscape-html', source: 'unknown', supported: true, reason: null });
  assert.equal(detect('<DL><p>\n<DT><A HREF="https://a.co/">a</A>\n</DL><p>').format, 'netscape-html');       // sans doctype
  assert.equal(detect('<!doctype netscape-bookmark-file-1><H1>Bookmarks</H1><DL><p></DL>').source, 'chrome');
  assert.equal(detect('<!DOCTYPE NETSCAPE-Bookmark-file-1><H1>Bookmarks Menu</H1><DL><p></DL>').source, 'firefox');
  assert.equal(detect('<!DOCTYPE NETSCAPE-Bookmark-file-1><H1>Bookmarks</H1><DL><p><DT><H3 UNFILED_BOOKMARKS_FOLDER="true">x</H3></DL>').source, 'firefox');
  assert.deepEqual(detect('<!DOCTYPE html><html><body>Bonjour</body></html>'), { format: null, source: null, supported: false, reason: 'html-not-bookmarks' });
  assert.deepEqual(detect('{"format":"qafila-backup","v":1}'), { format: 'qafila-backup', source: 'qafila', supported: true, reason: null });
  assert.equal(detect('  {"foo":1}').format, null);
});

test('parse() : aiguillage et erreurs typées', () => {
  assert.throws(() => parse('Title,URL,Username,Password,Notes,OTPAuth\n'), (e) => e instanceof ImportError && e.code === 'E_UNSUPPORTED');
  assert.throws(() => parse('rien à voir'), (e) => e instanceof ImportError && e.code === 'E_UNKNOWN_FORMAT');
  assert.throws(() => parse('{"format":"qafila-backup"}'), (e) => e.code === 'E_BACKUP_FILE');
  assert.throws(() => parseChromeCsv('url,username,password\nhttps://a.co,x,y\n'), (e) => e.code === 'E_HEADER');
  assert.throws(() => parseFirefoxCsv('name,url,username,password\n'), (e) => e.code === 'E_HEADER');
  assert.throws(() => parseChromeCsv(''), (e) => e.code === 'E_EMPTY');
  assert.throws(() => parseChromeCsv('\n\n'), (e) => e.code === 'E_EMPTY');
  assert.throws(() => parseChromeCsv(12), (e) => e.code === 'E_NOT_TEXT');
});

test('fichier de plus de 50 Mio refusé avant analyse', () => {
  const big = 'name,url,username,password\n' + 'a'.repeat(MAX_FILE_BYTES);
  assert.throws(() => parseChromeCsv(big), (e) => e.code === 'E_TOO_LARGE');
  assert.throws(() => parseNetscapeHtml(big), (e) => e.code === 'E_TOO_LARGE');
});

// ------------------------------------------------------------------ origines, URL, temps

test('normalizeOrigin : schéma + hôte + port, minuscules, sans chemin', () => {
  assert.equal(normalizeOrigin('HTTPS://Aeon.CO/Login?x=1#top'), 'https://aeon.co');
  assert.equal(normalizeOrigin('https://aeon.co:443/'), 'https://aeon.co');
  assert.equal(normalizeOrigin('http://aeon.co:80/'), 'http://aeon.co');
  assert.equal(normalizeOrigin('https://banque.example.fr:8443/x'), 'https://banque.example.fr:8443');
  assert.equal(normalizeOrigin('https://user:pw@aeon.co/'), 'https://aeon.co');
  assert.equal(normalizeOrigin('aeon.co/login'), 'https://aeon.co');                      // sans schéma ⇒ https
  assert.equal(normalizeOrigin('localhost:3000'), 'https://localhost:3000');               // `:` + chiffre = port
  assert.equal(normalizeOrigin('  https://aeon.co.  '), 'https://aeon.co');                // espaces, point final
  assert.equal(normalizeOrigin('https://médiathèque.example.tn/'), 'https://xn--mdiathque-53af.example.tn');
  assert.equal(normalizeOrigin('https://xn--mdiathque-53af.example.tn'), 'https://xn--mdiathque-53af.example.tn');
  assert.equal(normalizeOrigin('http://[::1]:8080/'), 'http://[::1]:8080');
  assert.equal(normalizeOrigin('http://192.168.1.1/'), 'http://192.168.1.1');
  for (const bad of ['', '   ', 'ftp://files.example.net/', 'javascript:alert(1)', 'mailto:a@b.c', 'chrome://settings', 'about:blank',
    'file:///etc/passwd', 'data:text/html,x', 'http://', 'https:///', 'android://x@y/', null, undefined, 42]) {
    assert.equal(normalizeOrigin(bad), null, String(bad));
  }
});

test('loginOrigin : applications Android ⇒ app:<package>, réimport Qafila idempotent', () => {
  assert.equal(loginOrigin('android://Hc7rQ3mPZkTjvLq9mW8s2xJaBdUoGfYnKcRe1tVh5iE=@org.thoughtcrime.securesms/'), 'app:org.thoughtcrime.securesms');
  assert.equal(loginOrigin('android://@com.example.app/'), 'app:com.example.app');
  assert.equal(loginOrigin('android://com.example.app'), 'app:com.example.app');
  assert.equal(loginOrigin('app:com.example.app'), 'app:com.example.app');
  assert.equal(loginOrigin('android://x@not valid/'), null);
  assert.equal(loginOrigin('app:not valid'), null);
  assert.equal(loginOrigin('https://aeon.co/x'), 'https://aeon.co');
});

test('bookmarkKey : clé de dédoublonnage des favoris', () => {
  assert.equal(bookmarkKey('https://aeon.co/'), 'https://aeon.co');
  assert.equal(bookmarkKey('HTTPS://AEON.co'), 'https://aeon.co');
  assert.equal(bookmarkKey('https://aeon.co:443/a/'), 'https://aeon.co/a');
  assert.equal(bookmarkKey('https://aeon.co/a/b#frag'), 'https://aeon.co/a/b');
  assert.equal(bookmarkKey('https://aeon.co/?q=1&b=2#x'), 'https://aeon.co?q=1&b=2');
  assert.equal(bookmarkKey('https://example.com/?q=a&b=c'), bookmarkKey('https://example.com/?q=a&b=c#frag'));
  assert.notEqual(bookmarkKey('https://aeon.co/?q=1'), bookmarkKey('https://aeon.co/?q=2'));          // requête conservée
  assert.notEqual(bookmarkKey('https://aeon.co/A'), bookmarkKey('https://aeon.co/a'));                 // chemin sensible à la casse
  assert.equal(bookmarkKey('http://www.météo.example.fr/'), 'http://www.xn--mto-bmab.example.fr');
  assert.equal(bookmarkKey('javascript:void(0)'), null);
  assert.equal(bookmarkKey('place:sort=8'), null);
  assert.equal(bookmarkKey(''), null);
});

test('normalizeTimestamp : secondes, millisecondes, microsecondes WebKit, invalides', () => {
  assert.equal(normalizeTimestamp('1700000000'), 1700000000000);
  assert.equal(normalizeTimestamp(1700000000), 1700000000000);
  assert.equal(normalizeTimestamp('1763290000000'), 1763290000000);
  assert.equal(normalizeTimestamp('13318200000000000'), 1673726400000);
  assert.equal(normalizeTimestamp('11644473600000000'), 0 + 0);                            // 1970-01-01 en µs WebKit
  assert.equal(normalizeTimestamp('1700000000.5'), 1700000000500);
  for (const bad of ['0', '', ' ', 'abc', '-5', null, undefined, '1e9']) assert.equal(normalizeTimestamp(bad), null, String(bad));
});

test('utf8Length', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('é'), 2);
  assert.equal(utf8Length('€'), 3);
  assert.equal(utf8Length('🧭'), 4);
  assert.equal(utf8Length('لينا'), 8);
});

// ------------------------------------------------------------------ CSV

test('parseCsv : RFC 4180 tolérant', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);                          // CR seul
  assert.deepEqual(parseCsv('a,b\n\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);                   // lignes vides
  assert.deepEqual(parseCsv(',,\n'), []);                                                    // ligne de champs vides = vide
  assert.deepEqual(parseCsv('"a ""b"" c",d'), [['a "b" c', 'd']]);
  assert.deepEqual(parseCsv('"ligne 1\r\nligne 2",x'), [['ligne 1\nligne 2', 'x']]);          // CRLF interne ⇒ LF
  assert.deepEqual(parseCsv('"a,b","c\nd"\n"e",f'), [['a,b', 'c\nd'], ['e', 'f']]);
  assert.deepEqual(parseCsv('a,"",c'), [['a', '', 'c']]);
  assert.deepEqual(parseCsv('a,b"c,d'), [['a', 'b"c', 'd']]);                                // guillemet au milieu : littéral
  assert.deepEqual(parseCsv('"non fermé,x'), [['non fermé,x']]);                              // guillemet fermant absent
  assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseCsv('a'), [['a']]);
});

test('Chrome CSV : lignes ignorées avec raison, colonnes par nom, mot de passe > 1 Kio', () => {
  const longAscii = 'x'.repeat(MAX_PASSWORD_BYTES);
  const tooLongAscii = 'x'.repeat(MAX_PASSWORD_BYTES + 1);
  const okMultibyte = 'é'.repeat(512);          // 1 024 octets
  const tooLongMultibyte = 'é'.repeat(513);     // 1 026 octets
  const text = ['note,password,url,name,username',
    ',,,,',
    'seulement une note,,,,',                    // name/note sans url/identifiant/mot de passe
    `,${longAscii},https://a.co,a,u1`,
    `,${tooLongAscii},https://a.co,a,u2`,
    `,${okMultibyte},https://a.co,a,u3`,
    `,${tooLongMultibyte},https://a.co,a,u4`,
    ',pw,,,u5',
    ',pw,https://ok.example,,u6'].join('\n');
  const out = parseChromeCsv(text);
  assert.deepEqual(out.logins.map(l => l.username), ['u1', 'u3', 'u6']);
  assert.equal(out.logins[2].title, 'ok.example');                                           // name vide ⇒ libellé de l'origine
  assert.deepEqual(out.skipped, [
    { row: 1, reason: 'empty', url: '' },
    { row: 3, reason: 'password-too-long', url: 'https://a.co' },
    { row: 5, reason: 'password-too-long', url: 'https://a.co' },
    { row: 6, reason: 'invalid-origin', url: '' }
  ]);
  assert.equal(out.counts.rows, 7);
  assert.equal(out.counts.logins, 3);
  assert.equal(out.counts.skipped, 4);
});

test('Chrome CSV : colonnes supplémentaires ignorées, lignes courtes complétées', () => {
  const out = parseChromeCsv('name,url,username,password,note,extra\nA,https://a.co,u,p\nB,https://b.co,u,p,n,plus');
  assert.equal(out.logins.length, 2);
  assert.equal(out.logins[0].note, '');
  assert.equal(out.logins[1].note, 'n');
  assert.equal('extra' in out.logins[1], false);
});

test('Firefox CSV : URL avec chemin ramenée à l\'origine, temps en secondes tolérés', () => {
  const out = parseFirefoxCsv('url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged\n' +
    'https://a.co/login?x=1,u,p,,https://a.co/post,{g},1700000000,abc,1763290000000\n');
  assert.equal(out.logins[0].origins[0], 'https://a.co');
  assert.equal(out.logins[0].formActionOrigin, 'https://a.co');
  assert.equal(out.logins[0].createdAt, 1700000000000);
  assert.equal(out.logins[0].lastUsedAt, null);
  assert.equal(out.logins[0].passwordChangedAt, 1763290000000);
  assert.equal(out.logins[0].title, 'a.co');
});

// ------------------------------------------------------------------ HTML Netscape : cas limites

test('decodeEntities et tokenizeHtml', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x2014; &#8212; &nbsp;x &inconnue; &#xFFFFFF;'),
    'a & b <c> "d" \'e\' — —  x &inconnue; �');
  const toks = tokenizeHtml('<!DOCTYPE x><!-- c --><DT><A HREF="https://a.co/?x=1&amp;y=2" ADD_DATE=17 FLAG>Texte</A>');
  assert.deepEqual(toks, [
    { type: 'tag', name: 'dt', closing: false, attrs: {} },
    { type: 'tag', name: 'a', closing: false, attrs: { href: 'https://a.co/?x=1&y=2', add_date: '17', flag: '' } },
    { type: 'text', text: 'Texte' },
    { type: 'tag', name: 'a', closing: true, attrs: {} }
  ]);
  // `>` entre guillemets ne ferme pas la balise
  assert.equal(tokenizeHtml('<A TITLE="a > b" HREF="x">t</A>')[0].attrs.title, 'a > b');
});

test('Netscape : minuscules, attributs sans guillemets, H3 sans DL, A sans HREF, </DL> manquants', () => {
  const html = `<dl><p>
    <dt><h3 add_date=1700000000 personal_toolbar_folder=true>barre</h3>
    <dl><p>
      <dt><a href=https://a.co/>A</a>
      <dt><h3>Vide sans DL</h3>
      <dt><a>Sans adresse</a>
      <dt><a href="https://b.co/">B</a>
      <dt><h3>Sous-dossier</h3>
      <dl><p>
        <dt><a href="https://c.co/">C</a>`;
  const out = parseNetscapeHtml(html);
  assert.equal(out.roots.length, 1);
  const bar = out.roots[0];
  assert.equal(bar.toolbar, true);
  assert.equal(bar.addedAt, 1700000000000);
  assert.deepEqual(bar.children.map(c => c.type === 'folder' ? `[${c.name}]` : c.title), ['A', '[Vide sans DL]', 'B', '[Sous-dossier]']);
  assert.deepEqual(bar.children[1].children, []);
  assert.equal(bar.children[3].children[0].title, 'C');
  assert.deepEqual(out.skipped, [{ reason: 'missing-url', title: 'Sans adresse', url: '', path: ['barre'] }]);
  assert.equal(out.counts.bookmarks, 3);
  assert.equal(out.counts.folders, 3);
  assert.equal(out.source, 'unknown');
});

test('Netscape : rôles par nom au premier niveau seulement, DD multi-balises, séparateurs, titre vide', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><H1>Favoris</H1>
<DL><p>
  <DT><H3>Barre personnelle</H3>
  <DL><p>
    <DT><H3>Bookmarks bar</H3>
    <DL><p><DT><A HREF="https://x.co/">   </A></DL><p>
    <HR>
  </DL><p>
  <DT><H3>Autres favoris</H3>
  <DD>Ligne 1<br>Ligne 2 &amp; <b>gras</b></DD>
  <DL><p>
    <DT><A HREF="https://y.co/">Y</A>
    <DD>Note sur Y</DD>
  </DL><p>
  <DT><H3>Marque-pages mobiles</H3>
  <DL><p></DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="false">Pas une barre</H3>
  <DL><p></DL><p>
</DL><p>`;
  const out = parseNetscapeHtml(html);
  assert.equal(out.source, 'chrome');
  assert.deepEqual(out.roots.map(r => [r.name, r.role, r.toolbar]), [
    ['Barre personnelle', 'toolbar', true], ['Autres favoris', 'unfiled', false], ['Marque-pages mobiles', 'mobile', false], ['Pas une barre', null, false]
  ]);
  assert.equal(out.roots[0].children[0].role, null);                                 // « Bookmarks bar » imbriqué : pas un rôle
  assert.equal(out.roots[0].children[0].children[0].title, 'https://x.co/');         // titre vide ⇒ URL
  assert.equal(out.roots[1].note, 'Ligne 1 Ligne 2 & gras');
  assert.equal(out.roots[1].children[0].note, 'Note sur Y');
  assert.equal(out.counts.separators, 1);
});

test('Netscape : dossier interne « Mozilla Firefox » seulement au premier niveau', () => {
  const out = parseNetscapeHtml('<DL><p><DT><H3>Perso</H3><DL><p><DT><H3>Mozilla Firefox</H3><DL><p><DT><A HREF="https://m.co/">m</A></DL><p></DL><p></DL><p>');
  assert.equal(out.roots[0].children[0].name, 'Mozilla Firefox');
  assert.equal(out.skipped.length, 0);
  assert.equal(out.counts.bookmarks, 1);
});

// ------------------------------------------------------------------ dédoublonnage des identifiants

test('dedupe (Chrome) : même clé + même mot de passe ⇒ doublon ; mot de passe différent sans date ⇒ le premier reste, l\'autre en historique', () => {
  const parsed = parseChromeCsv(read('chrome-passwords.csv'));
  const r = dedupe(parsed, [], { now: NOW });
  assert.deepEqual(r.counts, { incoming: 11, added: 9, updated: 1, duplicates: 1, notesMerged: 0 });
  assert.equal(r.logins.length, 9);
  const aeon = r.logins.find(l => l.origins[0] === 'https://aeon.co');
  assert.equal(aeon.username, 'lina@example.org');
  assert.equal(aeon.password, 'Tr0ub4dour&3');
  assert.deepEqual(aeon.passwordHistory, [{ password: 'Tr0ub4dour&4', changedAt: NOW }]);
  assert.equal(aeon.note, 'Nouveau mot de passe');
  // http et https sont deux origines ⇒ deux identifiants
  assert.equal(r.logins.filter(l => l.username === 'lina' && /example\.org$/.test(l.origins[0])).length, 2);
  // même site, deux utilisateurs ⇒ deux identifiants
  assert.equal(r.logins.filter(l => /banque\.example\.fr/.test(l.origins[0])).length, 2);
});

test('dedupe (Firefox) : le plus récent par passwordChangedAt devient courant ; même guid ⇒ idempotent', () => {
  const parsed = parseFirefoxCsv(read('firefox-logins.csv'));
  const r = dedupe(parsed, [], { now: NOW });
  assert.deepEqual(r.counts, { incoming: 11, added: 9, updated: 1, duplicates: 1, notesMerged: 0 });
  const aeon = r.logins.find(l => l.origins[0] === 'https://aeon.co');
  assert.equal(aeon.password, 'Tr0ub4dour&5');
  assert.equal(aeon.passwordChangedAt, 1760000000000);
  assert.deepEqual(aeon.passwordHistory, [{ password: 'Tr0ub4dour&3', changedAt: 1750000000000 }]);
  assert.equal(aeon.username, 'lina@example.org');
  assert.equal(aeon.importGuid, '{3f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90}');
  assert.equal(aeon.lastUsedAt, 1763290000000);
  assert.equal(aeon.createdAt, 1700000000000);
  // ré-importer le même fichier dans le résultat : rien ne bouge
  const again = dedupeLogins(parsed.logins, r.logins, { now: NOW + 1 });
  assert.deepEqual(again.counts, { incoming: 11, added: 0, updated: 0, duplicates: 11, notesMerged: 0 });
  assert.deepEqual(again.logins, []);
});

test('dedupe contre le coffre : id conservé, notes fusionnées, casse et espaces du nom d\'utilisateur ignorés', () => {
  const existing = [{ id: '6f1c2e5a-3b0d-4a8e-9f21-0c7d4e5b6a90', type: 'login', title: 'Aeon', origins: ['https://aeon.co'], username: 'Lina@Example.org',
    password: 'Tr0ub4dour&3', note: 'Compte perso', passwordChangedAt: null, createdAt: 1600000000000, lastUsedAt: null, passwordHistory: [], importGuid: null }];
  const incoming = [
    { title: 'aeon.co', origins: ['https://aeon.co'], username: '  lina@example.org ', password: 'Tr0ub4dour&3', note: 'Depuis Chrome', formActionOrigin: 'https://aeon.co',
      httpRealm: null, createdAt: null, lastUsedAt: 1763000000000, passwordChangedAt: null, importGuid: null, source: 'chrome' },
    { title: 'aeon.co', origins: ['https://aeon.co'], username: 'lina@example.org', password: 'Tr0ub4dour&3', note: 'Depuis Chrome', formActionOrigin: null,
      httpRealm: null, createdAt: null, lastUsedAt: null, passwordChangedAt: null, importGuid: null, source: 'chrome' }
  ];
  const r = dedupeLogins(incoming, existing, { now: NOW });
  assert.deepEqual(r.counts, { incoming: 2, added: 0, updated: 0, duplicates: 2, notesMerged: 1 });
  assert.equal(r.logins.length, 1);
  assert.equal(r.logins[0].id, existing[0].id);
  assert.equal(r.logins[0].username, 'Lina@Example.org');                           // le coffre garde sa graphie
  assert.equal(r.logins[0].note, 'Compte perso\nDepuis Chrome');
  assert.equal(r.logins[0].formActionOrigin, 'https://aeon.co');
  assert.equal(r.logins[0].lastUsedAt, 1763000000000);
  assert.equal(existing[0].note, 'Compte perso');                                    // entrées jamais mutées
  assert.equal(incoming[0].username, '  lina@example.org ');
});

test('dedupe contre le coffre : dates décident du mot de passe courant, inconnu perd', () => {
  const base = { title: 'a', origins: ['https://a.co'], username: 'u', note: '', formActionOrigin: null, httpRealm: null, createdAt: null, lastUsedAt: null, importGuid: null, source: 'firefox' };
  // coffre plus récent ⇒ il reste, l'importé va dans l'historique avec sa date
  let r = dedupeLogins([{ ...base, password: 'vieux', passwordChangedAt: 1600000000000 }],
    [{ id: 'x', ...base, password: 'actuel', passwordChangedAt: 1700000000000, passwordHistory: [] }], { now: NOW });
  assert.equal(r.counts.updated, 1);
  assert.equal(r.logins[0].password, 'actuel');
  assert.deepEqual(r.logins[0].passwordHistory, [{ password: 'vieux', changedAt: 1600000000000 }]);
  // coffre sans date, importé daté ⇒ l'importé gagne, l'ancien est daté « maintenant »
  r = dedupeLogins([{ ...base, password: 'nouveau', passwordChangedAt: 1700000000000 }],
    [{ id: 'x', ...base, password: 'ancien', passwordChangedAt: null, passwordHistory: [] }], { now: NOW });
  assert.equal(r.logins[0].password, 'nouveau');
  assert.deepEqual(r.logins[0].passwordHistory, [{ password: 'ancien', changedAt: NOW }]);
  // importé sans date (Chrome) ⇒ le coffre reste
  r = dedupeLogins([{ ...base, password: 'chrome', passwordChangedAt: null }],
    [{ id: 'x', ...base, password: 'actuel', passwordChangedAt: null, passwordHistory: [] }], { now: NOW });
  assert.equal(r.logins[0].password, 'actuel');
  assert.deepEqual(r.logins[0].passwordHistory, [{ password: 'chrome', changedAt: NOW }]);
  // mot de passe déjà dans l'historique ⇒ doublon, rien à écrire
  r = dedupeLogins([{ ...base, password: 'chrome', passwordChangedAt: null }],
    [{ id: 'x', ...base, password: 'actuel', passwordChangedAt: null, passwordHistory: [{ password: 'chrome', changedAt: 1 }] }], { now: NOW });
  assert.deepEqual(r.counts, { incoming: 1, added: 0, updated: 0, duplicates: 1, notesMerged: 0 });
  assert.deepEqual(r.logins, []);
});

test('dedupe : historique plafonné à 10, le plus récent en premier', () => {
  const base = { title: 'a', origins: ['https://a.co'], username: 'u', note: '', formActionOrigin: null, httpRealm: null, createdAt: null, lastUsedAt: null, importGuid: null, source: 'firefox' };
  const incoming = [];
  for (let i = 1; i <= 12; i++) incoming.push({ ...base, password: 'p' + i, passwordChangedAt: 1700000000000 + i * 1000 });
  const r = dedupeLogins(incoming, [], { now: NOW });
  assert.equal(r.logins.length, 1);
  assert.equal(r.logins[0].password, 'p12');
  assert.equal(r.logins[0].passwordHistory.length, 10);
  assert.equal(r.logins[0].passwordHistory[0].password, 'p11');
  assert.equal(r.logins[0].passwordHistory[9].password, 'p2');
  assert.deepEqual(r.counts, { incoming: 12, added: 1, updated: 11, duplicates: 0, notesMerged: 0 });
});

test('loginKey et origines distinctes', () => {
  assert.equal(loginKey({ origins: ['https://aeon.co'], username: ' Lina@Example.ORG ' }), 'https://aeon.co\nlina@example.org');
  assert.notEqual(loginKey({ origins: ['https://aeon.co'], username: 'u' }), loginKey({ origins: ['http://aeon.co'], username: 'u' }));
  assert.notEqual(loginKey({ origins: ['https://aeon.co'], username: 'u' }), loginKey({ origins: ['https://aeon.co:8443'], username: 'u' }));
  assert.equal(loginKey({ origins: ['app:com.x'], username: '' }), 'app:com.x\n');
});

// ------------------------------------------------------------------ dédoublonnage des favoris

test('dedupeBookmarks : même URL normalisée dans le même dossier ⇒ un seul (le premier)', () => {
  const chrome = parseNetscapeHtml(read('chrome-bookmarks.html'));
  let r = dedupe(chrome);
  assert.equal(r.removed, 4);
  const titles = JSON.stringify(r.roots);
  for (const gone of ['arXiv cs.CR (doublon, slash final)', 'The Atlantic (doublon)', 'Tunisair (doublon, sans slash)', 'Exemple avec requête et fragment (doublon)']) {
    assert.equal(titles.indexOf(gone), -1, gone);
  }
  assert.ok(titles.indexOf('"arXiv cs.CR"') >= 0);
  assert.equal(r.roots[0].children.find(c => c.name === 'Dossier vide').children.length, 0);    // dossiers intacts
  assert.deepEqual(chrome.roots[0].children[2].children.length, 3);                             // l'entrée n'est pas mutée

  const firefox = parseNetscapeHtml(read('firefox-bookmarks.html'));
  r = dedupeBookmarks(firefox.roots);
  assert.equal(r.removed, 2);
  assert.equal(JSON.stringify(r.roots).indexOf('(doublon'), -1);
});

test('dedupeBookmarks : même URL dans deux dossiers différents ⇒ conservée deux fois', () => {
  const roots = [
    { type: 'folder', name: 'A', toolbar: false, role: null, addedAt: null, modifiedAt: null, note: null, children: [{ type: 'bookmark', title: 'x', url: 'https://x.co/', addedAt: null, modifiedAt: null, note: null }] },
    { type: 'bookmark', title: 'x', url: 'https://x.co', addedAt: null, modifiedAt: null, note: null },
    { type: 'bookmark', title: 'x bis', url: 'HTTPS://X.CO/#top', addedAt: null, modifiedAt: null, note: null }
  ];
  const r = dedupeBookmarks(roots);
  assert.equal(r.removed, 1);
  assert.equal(r.roots.length, 2);
  assert.equal(r.roots[0].children.length, 1);
});

test('dedupe : entrée inattendue', () => {
  assert.throws(() => dedupe({}), (e) => e.code === 'E_BAD_INPUT');
});

// ------------------------------------------------------------------ portabilité du module

test('parse.mjs reste en ES2017 (pas de ?., ??, flat, lookbehind, groupes nommés)', () => {
  const src = readFileSync(join(here, '..', 'import', 'parse.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/[^:\n]\/\/[^\n]*$/gm, '');   // sans commentaires
  assert.equal(/\?\.\s*[a-zA-Z_[(]/.test(src), false, 'optional chaining');
  assert.equal(/\?\?/.test(src), false, 'nullish coalescing');
  assert.equal(/\.flat(Map)?\(/.test(src), false, 'Array.prototype.flat');
  assert.equal(/\(\?<[=!]/.test(src), false, 'lookbehind');
  assert.equal(/\(\?<[a-zA-Z]/.test(src), false, 'groupes nommés');
  assert.equal(/\bimport\s+[^;]*from\s+['"](?!\.)/.test(src), false, 'aucune dépendance');
  assert.equal(/console\./.test(src), false, 'aucune journalisation');
});
