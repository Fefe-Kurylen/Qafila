// Tests du contrat « formulaires » (shared/FORMS.md) : shared/qafila-forms.js exécuté dans jsdom.
// - chaque fixture de shared/fixtures/forms/ est chargée sous son URL, le script injecté, detect() comparé
//   à l'identique avec <nom>.expected.json ; chaque selectorPath doit désigner exactement un <input> ;
// - fill() pose les valeurs via le setter natif et émet input/change, refuse les autres origines, les cadres
//   enfants, les champs cachés / lecture seule, et ne soumet jamais ;
// - captureSubmit() rapporte le couple soumis (submit, clic, Entrée) sans doublon ;
// - observe() signale les changements du DOM (SPA) et le focus.
// Aucun réseau : jsdom ne charge aucune ressource ; les fixtures n'en référencent aucune.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(here, '..', 'qafila-forms.js');
const FIXTURES = join(here, '..', 'fixtures', 'forms');
const SCRIPT = readFileSync(SCRIPT_PATH, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Les objets créés dans la fenêtre jsdom ont les prototypes de cette fenêtre : on les ramène en objets simples.
const plain = (v) => JSON.parse(JSON.stringify(v));

function fixtureNames() {
  return readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).map((f) => basename(f, '.html')).sort();
}
function expectedOf(name) {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.expected.json`), 'utf8'));
}
function load(name, urlOverride) {
  const html = readFileSync(join(FIXTURES, `${name}.html`), 'utf8');
  const expected = expectedOf(name);
  const dom = new JSDOM(html, {
    url: urlOverride || expected.url,
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  dom.window.eval(SCRIPT);
  return { dom, window: dom.window, document: dom.window.document, api: dom.window.__qafilaForms, expected };
}
// Enregistre les événements reçus par un champ (type, constructeur, bubbles) et la valeur au moment de l'événement.
function recordEvents(window, el) {
  const seen = [];
  for (const type of ['input', 'change', 'keydown', 'keyup', 'submit']) {
    el.addEventListener(type, (e) => seen.push({ type, ctor: e.constructor.name, bubbles: e.bubbles, value: el.value }));
  }
  return seen;
}

// ------------------------------------------------------------------ garde-fous sur le fichier lui-même
test('le script est du ES2017 sans module, sans réseau ni journalisation', () => {
  assert.match(SCRIPT, /^\/\*[\s\S]*?\*\/\s*\(function \(\) \{\s*'use strict';/, 'IIFE en mode strict');
  for (const forbidden of [/\?\./, /\?\?/, /\bimport\b/, /\bexport\b/, /\basync\b/, /\bawait\b/, /\bclass\s+\w/, /\.\.\.\w/, /\bfetch\(/, /XMLHttpRequest/, /console\./, /\bnavigator\.sendBeacon/, /localStorage|sessionStorage|indexedDB/]) {
    assert.doesNotMatch(SCRIPT, forbidden, `motif interdit : ${forbidden}`);
  }
  assert.ok(fixtureNames().length >= 10, 'au moins 10 fixtures');
});

test('injection idempotente et API verrouillée', () => {
  const { window, api } = load('classic-login');
  assert.equal(api.version, 1);
  assert.equal(api.frame, 'top');
  assert.deepEqual(Object.keys(api).sort(), ['captureSubmit', 'detect', 'fill', 'frame', 'observe', 'version']);
  window.eval(SCRIPT);
  assert.equal(window.__qafilaForms, api, 'une seconde injection ne remplace pas l\'objet');
  assert.ok(Object.isFrozen(api));
  assert.throws(() => { 'use strict'; window.__qafilaForms = { fill() {} }; }, 'la page ne peut pas substituer l\'API');
  assert.throws(() => { Object.defineProperty(window, '__qafilaForms', { value: 1 }); });
  assert.equal(Object.getOwnPropertyDescriptor(window, '__qafilaForms').enumerable, false);
});

// ------------------------------------------------------------------ détection : chaque fixture
for (const name of fixtureNames()) {
  test(`detect() — ${name}`, () => {
    const { document, api, expected } = load(name);
    const actual = plain(api.detect());
    assert.deepEqual(actual, expected.detect, `description inattendue pour ${name}`);
    for (const form of actual) {
      assert.equal(form.origin, new URL(expected.url).origin);
      if (form.form !== null) {
        const f = document.querySelectorAll(form.form);
        assert.equal(f.length, 1, `form ${form.form} doit désigner un seul élément`);
        assert.equal(f[0].localName, 'form');
      }
      const paths = new Set();
      for (const field of form.fields) {
        assert.ok(!paths.has(field.selectorPath), 'chemins distincts');
        paths.add(field.selectorPath);
        const els = document.querySelectorAll(field.selectorPath);
        assert.equal(els.length, 1, `${field.selectorPath} doit désigner un seul élément`);
        assert.equal(els[0].localName, 'input');
        const type = (els[0].getAttribute('type') || 'text').toLowerCase();
        if (field.kind === 'username') assert.ok(['text', 'email', 'tel', 'hidden'].includes(type), `identifiant de type ${type}`);
        else assert.equal(type, 'password', `${field.kind} doit être un type=password`);
        assert.ok(['username', 'password', 'newPassword', 'confirmPassword'].includes(field.kind));
        assert.equal(typeof field.visible, 'boolean');
        assert.ok(field.autocomplete === null || typeof field.autocomplete === 'string');
      }
    }
  });
}

test('detect() renvoie [] hors http(s) et dans un document sans <body>', () => {
  const dom = new JSDOM('<form><input name="u"><input type="password" name="p"></form>', { runScripts: 'dangerously' });
  dom.window.eval(SCRIPT);
  assert.deepEqual(plain(dom.window.__qafilaForms.detect()), [], 'about:blank : origine « null »');
  const { api } = load('classic-login', 'http://aeon.example/connexion');
  assert.equal(api.detect()[0].origin, 'http://aeon.example', 'http est détecté (c\'est le natif qui avertit)');
});

test('detect() — cadre enfant inerte, même pour un formulaire de connexion', () => {
  const { document, window } = load('cross-origin-iframe');
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const child = iframe.contentWindow;
  child.document.body.innerHTML = '<form id="f"><input name="user"><input type="password" name="pass"></form>';
  child.eval(SCRIPT);
  const api = child.__qafilaForms;
  assert.equal(api.frame, 'child');
  assert.deepEqual(plain(api.detect()), []);
  const r = plain(api.fill({ origin: 'https://news.example', username: 'a', password: 'b' }));
  assert.deepEqual(r, { ok: false, filled: [], skipped: [], reason: 'frame' });
  assert.equal(child.document.querySelector('[name=pass]').value, '', 'rien n\'est posé dans l\'iframe');
  let called = 0;
  const stop = api.observe(() => { called++; });
  const stop2 = api.captureSubmit(() => { called++; });
  assert.equal(typeof stop, 'function'); assert.equal(typeof stop2, 'function');
  stop(); stop2();
  assert.equal(called, 0);
  assert.deepEqual(plain(window.__qafilaForms.detect()), [], 'le cadre principal ne descend jamais dans l\'iframe');
});

// ------------------------------------------------------------------ remplissage
test('fill() — connexion classique : setter natif, input puis change, jamais de soumission', () => {
  const { window, document, api } = load('classic-login');
  const user = document.getElementById('user');
  const pass = document.getElementById('pass');
  const form = document.getElementById('login');
  const userEvents = recordEvents(window, user);
  const passEvents = recordEvents(window, pass);
  let submitted = 0;
  form.addEventListener('submit', (e) => { submitted++; e.preventDefault(); });
  window.HTMLFormElement.prototype.submit = () => { submitted++; };

  const r = plain(api.fill({ origin: 'https://aeon.example', username: 'lina@example.org', password: 'S3cret!motdepasse' }));
  assert.deepEqual(r, { ok: true, filled: ['username', 'password'], skipped: [], reason: null });
  assert.equal(user.value, 'lina@example.org');
  assert.equal(pass.value, 'S3cret!motdepasse');
  assert.deepEqual(userEvents.map((e) => e.type), ['input', 'change']);
  assert.deepEqual(passEvents.map((e) => e.type), ['input', 'change']);
  assert.equal(userEvents[0].ctor, 'InputEvent');
  assert.ok(userEvents.every((e) => e.bubbles));
  assert.ok(userEvents.every((e) => e.value === 'lina@example.org'), 'la valeur est déjà posée quand les événements partent');
  assert.equal(submitted, 0, 'fill() ne soumet jamais');
  assert.equal(document.activeElement, pass, 'le dernier champ rempli garde le focus');
});

test('fill() — refus : autre origine, origine absente, argument invalide, aucun formulaire', () => {
  const { document, api } = load('form-action-cross-origin');
  const forms = api.detect();
  assert.equal(forms[0].formActionOrigin, 'https://auth.shop-id.example');
  assert.equal(api.fill({ origin: 'https://auth.shop-id.example', username: 'a', password: 'b' }).reason, 'origin',
    'l\'origine de l\'action du formulaire ne suffit pas : seule l\'origine de la page compte');
  assert.equal(api.fill({ origin: 'https://login.shop.example', username: 'a', password: 'b' }).reason, 'origin', 'un sous-domaine n\'est pas la même origine');
  assert.equal(api.fill({ origin: 'http://shop.example', username: 'a', password: 'b' }).reason, 'origin', 'le schéma compte');
  assert.equal(api.fill({ origin: 'https://shop.example:8443', username: 'a', password: 'b' }).reason, 'origin', 'le port compte');
  assert.equal(api.fill({ username: 'a', password: 'b' }).reason, 'origin', 'sans origine, rien');
  assert.equal(api.fill(null).reason, 'argument');
  assert.equal(api.fill('https://shop.example').reason, 'argument');
  assert.equal(document.getElementById('login-pass').value, '', 'aucun refus ne laisse de trace');
  const ok = api.fill({ origin: 'https://shop.example', username: 'a', password: 'b' });
  assert.equal(ok.ok, true);

  const none = plain(load('dark-pattern-search-password').api.fill({ origin: 'https://blog.example', username: 'a', password: 'b' }));
  assert.deepEqual(none, { ok: false, filled: [], skipped: [], reason: 'no-form' });
  const blogDoc = load('dark-pattern-search-password').document;
  assert.equal(blogDoc.querySelector('[name=password]').value, '');
});

test('fill() — champs cachés, lecture seule et désactivés ne sont jamais remplis', () => {
  const hidden = load('hidden-username');
  const r = plain(hidden.api.fill({ origin: 'https://shop.example', username: 'autre@example.org', password: 'pw' }));
  assert.deepEqual(r, { ok: true, filled: ['password'], skipped: [{ kind: 'username', reason: 'hidden' }], reason: null });
  assert.equal(hidden.document.getElementById('email').value, 'lina@example.org', 'la valeur préremplie du site est intacte');

  const ro = load('classic-login');
  ro.document.getElementById('user').readOnly = true;
  ro.document.getElementById('pass').disabled = true;
  const r2 = plain(ro.api.fill({ origin: 'https://aeon.example', username: 'a', password: 'b' }));
  assert.deepEqual(r2, { ok: false, filled: [], skipped: [{ kind: 'username', reason: 'readonly' }, { kind: 'password', reason: 'disabled' }], reason: 'nothing-to-fill' });

  const two = load('email-first-two-step');
  const r3 = plain(two.api.fill({ origin: 'https://mail.example', form: '#step2', username: 'lina', password: 'pw' }));
  assert.deepEqual(r3, { ok: false, filled: [], skipped: [{ kind: 'username', reason: 'hidden' }, { kind: 'password', reason: 'hidden' }], reason: 'nothing-to-fill' });
});

test('fill() — choix du formulaire par selectorPath et étape 2 révélée', () => {
  const { document, api } = load('email-first-two-step');
  const r1 = api.fill({ origin: 'https://mail.example', username: 'lina@example.org' });
  assert.deepEqual(plain(r1.filled), ['username'], 'par défaut : le premier formulaire (étape 1)');
  assert.equal(document.getElementById('email').value, 'lina@example.org');
  // le site passe à l'étape 2
  document.getElementById('step1').hidden = true;
  document.getElementById('step2').hidden = false;
  document.getElementById('identifier-hidden').value = 'lina@example.org';
  const forms = api.detect();
  assert.equal(forms[0].form, '#step2', 'l\'étape 2, désormais visible, passe en tête');
  assert.equal(forms[0].fields[1].visible, true);
  const r2 = plain(api.fill({ origin: 'https://mail.example', form: '#step2', username: 'pirate@example.org', password: 'pw' }));
  assert.deepEqual(r2, { ok: true, filled: ['password'], skipped: [{ kind: 'username', reason: 'hidden' }], reason: null });
  assert.equal(document.getElementById('identifier-hidden').value, 'lina@example.org', 'un champ hidden n\'est jamais réécrit');
  assert.equal(api.fill({ origin: 'https://mail.example', form: '#nope', password: 'pw' }).reason, 'no-form');
});

test('fill() — inscription : newPassword et confirmPassword reçoivent le même mot de passe', () => {
  const { document, api } = load('signup-confirm');
  const r = api.fill({ origin: 'https://forum.example', username: 'lina@example.org', password: 'Généré-20-caractères!' });
  assert.deepEqual(plain(r.filled), ['username', 'newPassword', 'confirmPassword']);
  assert.equal(document.getElementById('pw1').value, 'Généré-20-caractères!');
  assert.equal(document.getElementById('pw2').value, 'Généré-20-caractères!');
  assert.equal(document.getElementById('first').value, '', 'le prénom n\'est pas touché');
});

test('fill() — changement de mot de passe : password = actuel, newPassword = nouveau + confirmation', () => {
  const { document, api } = load('change-password');
  const r = api.fill({ origin: 'https://account.example', password: 'ancien', newPassword: 'nouveau-mot-de-passe' });
  assert.deepEqual(plain(r.filled), ['password', 'newPassword', 'confirmPassword']);
  const inputs = document.querySelectorAll('input');
  assert.deepEqual([...inputs].map((i) => i.value), ['ancien', 'nouveau-mot-de-passe', 'nouveau-mot-de-passe']);
});

test('fill() — champs contrôlés façon React : l\'état du cadriciel est mis à jour', () => {
  const { window, document, api } = load('react-controlled');
  // Preuve que l'imitation est fidèle : une affectation directe est ignorée par le cadriciel.
  const pass = document.getElementById('password');
  pass.value = 'ignoré';
  pass.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(window.__reactState.password, '');
  const r = api.fill({ origin: 'https://app.example', username: 'lina@example.org', password: 'pw-react' });
  assert.deepEqual(plain(r.filled), ['username', 'password']);
  assert.deepEqual(plain(window.__reactState), { email: 'lina@example.org', password: 'pw-react' });
  assert.deepEqual(plain(window.__reactChanges), ['email', 'password']);
  assert.equal(pass.value, 'pw-react');
});

test('fill() — sans <form> : la carte sert de conteneur', () => {
  const { document, api } = load('no-form-element');
  const r = api.fill({ origin: 'https://spa.example', username: 'lina', password: 'pw' });
  assert.deepEqual(plain(r.filled), ['username', 'password']);
  assert.equal(document.getElementById('u').value, 'lina');
  assert.equal(document.querySelector('[name=q]').value, '', 'la recherche n\'est pas touchée');
});

// ------------------------------------------------------------------ capture de la soumission
test('captureSubmit() — submit du formulaire, puis clic + submit sans doublon', () => {
  const { window, document, api } = load('classic-login');
  const got = [];
  const stop = api.captureSubmit((p) => got.push(plain(p)));
  const form = document.getElementById('login');
  form.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('user').value = 'lina';
  document.getElementById('pass').value = 'pw-1';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(got, [{
    origin: 'https://aeon.example', formActionOrigin: 'https://aeon.example', form: '#login',
    username: 'lina', password: 'pw-1', newPassword: null, isSignup: false, isPasswordChange: false
  }]);
  // clic sur le bouton puis événement submit : une seule remontée
  document.getElementById('pass').value = 'pw-2';
  document.querySelector('button[type=submit]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 2);
  assert.equal(got[1].password, 'pw-2');
  // mot de passe vide : rien
  document.getElementById('pass').value = '';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 2);
  stop();
  document.getElementById('pass').value = 'pw-3';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 2, 'après désabonnement, plus rien');
});

test('captureSubmit() — sans <form> : clic sur le bouton ou Entrée dans le mot de passe', () => {
  const { window, document, api } = load('no-form-element');
  const got = [];
  api.captureSubmit((p) => got.push(plain(p)));
  document.getElementById('u').value = 'lina';
  document.getElementById('p').value = 'pw';
  document.getElementById('go').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 1);
  assert.equal(got[0].form, null);
  assert.equal(got[0].formActionOrigin, null);
  assert.deepEqual([got[0].username, got[0].password], ['lina', 'pw']);
  document.getElementById('p').value = 'pw-enter';
  document.getElementById('p').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(got.length, 2);
  assert.equal(got[1].password, 'pw-enter');
});

test('captureSubmit() — inscription : confirmation différente ignorée, identique rapportée comme newPassword', () => {
  const { window, document, api } = load('signup-confirm');
  const got = [];
  api.captureSubmit((p) => got.push(plain(p)));
  const form = document.getElementById('register');
  form.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('email').value = 'lina@example.org';
  document.getElementById('pw1').value = 'abc';
  document.getElementById('pw2').value = 'abd';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 0, 'le site refusera : on ne propose rien');
  document.getElementById('pw2').value = 'abc';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 1);
  assert.equal(got[0].username, 'lina@example.org');
  assert.equal(got[0].password, null);
  assert.equal(got[0].newPassword, 'abc');
  assert.equal(got[0].isSignup, true);
});

test('captureSubmit() — changement de mot de passe : actuel et nouveau', () => {
  const { window, document, api } = load('change-password');
  const got = [];
  api.captureSubmit((p) => got.push(plain(p)));
  const form = document.getElementById('pwd-change');
  form.addEventListener('submit', (e) => e.preventDefault());
  const [old, neu, conf] = document.querySelectorAll('input');
  old.value = 'ancien'; neu.value = 'nouveau'; conf.value = 'nouveau';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(got.length, 1);
  assert.equal(got[0].username, null);
  assert.equal(got[0].password, 'ancien');
  assert.equal(got[0].newPassword, 'nouveau');
  assert.equal(got[0].isPasswordChange, true);
});

// ------------------------------------------------------------------ observation
test('observe() — état initial, mutation du DOM (SPA), dédoublonnage, focus, désabonnement', async () => {
  const { window, document, api } = load('cross-origin-iframe');
  const calls = [];
  const stop = api.observe((forms, meta) => calls.push(plain({ forms, meta })));
  await sleep(10);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].forms, []);
  assert.equal(calls[0].meta.reason, 'initial');

  // une SPA injecte un formulaire de connexion
  const card = document.createElement('div');
  card.innerHTML = '<input id="u" type="email" autocomplete="username"><input id="p" type="password" autocomplete="current-password"><button type="button">Connexion</button>';
  document.body.appendChild(card);
  await sleep(300);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].meta.reason, 'mutation');
  assert.deepEqual(calls[1].forms.map((f) => f.fields.map((x) => x.kind)), [['username', 'password']]);

  // mutation sans effet sur la description : pas de rappel
  card.appendChild(document.createElement('p'));
  await sleep(300);
  assert.equal(calls.length, 2);

  // focus sur un champ détecté
  document.getElementById('u').focus();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].meta.reason, 'focus');
  assert.equal(calls[2].meta.focused, '#u');
  document.getElementById('u').blur();
  assert.equal(calls[3].meta.reason, 'blur');
  assert.equal(calls[3].meta.left, '#u');

  // focus ailleurs : rapporté avec focused=null (la carte se replie)
  const other = document.createElement('input');
  document.body.appendChild(other);
  await sleep(300);
  const before = calls.length;
  other.focus();
  assert.equal(calls[before].meta.reason, 'focus');
  assert.equal(calls[before].meta.focused, null);

  stop();
  document.getElementById('p').remove();
  await sleep(300);
  assert.equal(calls.length, before + 1, 'après désabonnement, plus rien');
  // sans mot de passe, #u (autocomplete=username) reste un formulaire « identifiant d'abord »
  assert.deepEqual(plain(window.__qafilaForms.detect()).map((f) => f.fields.map((x) => x.kind)), [['username']]);
});

test('observe() — un rappel qui lève une exception ne casse ni la page ni les suivants', async () => {
  const { document, api } = load('classic-login');
  let n = 0;
  api.observe(() => { n++; throw new Error('boom'); });
  await sleep(10);
  assert.equal(n, 1);
  document.getElementById('pass').focus();
  assert.equal(n, 2);
});

// ------------------------------------------------------------------ correspondance d'origine (côté natif, FORMS.md §7)
// Implémentation de référence, volontairement minuscule, de la règle que Swift, Kotlin et TypeScript doivent reproduire.
// La liste de suffixes publics est réduite aux besoins des vecteurs (la vraie vient de shared/web/psl-compact.dat).
const PSL_SUBSET = ['com', 'fr', 'uk', 'co.uk', 'example', 'io', 'github.io', 'net'];

function parseOrigin(input) {
  let u;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, ''); // WHATWG URL rend déjà l'IDN en punycode
  const port = u.port === '' ? null : Number(u.port);
  return { scheme: u.protocol.slice(0, -1), host, port, origin: `${u.protocol}//${host}${port ? `:${port}` : ''}` };
}
const apex = (host) => (host.startsWith('www.') ? host.slice(4) : host);
function registrableDomain(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || !host.includes('.')) return null;
  const labels = host.split('.');
  let suffixLen = 0;
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    if (PSL_SUBSET.includes(candidate)) { suffixLen = labels.length - i; break; }
  }
  if (suffixLen === 0 || suffixLen >= labels.length) return null;
  return labels.slice(labels.length - suffixLen - 1).join('.');
}
function matchOrigin(page, record) {
  const P = parseOrigin(page);
  if (!P) return { result: 'none', label: null, upgrade: false };
  let best = { result: 'none', label: null, upgrade: false };
  const rankOf = { exact: 0, subdomain: 1, downgrade: 2, none: 3 };
  for (const o of record.origins) {
    const R = parseOrigin(o);
    if (!R) continue; // app:… ou autre : hors sujet pour une page web
    let candidate = null;
    if (R.scheme === 'https' && P.scheme === 'http') {
      if (apex(R.host) === apex(P.host) && R.port === P.port) candidate = { result: 'downgrade', label: null, upgrade: false };
    } else if (R.port === P.port) {
      const upgrade = R.scheme === 'http' && P.scheme === 'https';
      if (apex(R.host) === apex(P.host)) candidate = { result: 'exact', label: null, upgrade };
      else if (record.matchSubdomains === true) {
        const rd = registrableDomain(R.host);
        if (rd && rd === registrableDomain(P.host)) candidate = { result: 'subdomain', label: P.host, upgrade };
      }
    }
    if (candidate && rankOf[candidate.result] < rankOf[best.result]) best = candidate;
  }
  return best;
}

const ORIGIN_CASES = JSON.parse(readFileSync(join(FIXTURES, 'origin-matching.json'), 'utf8')).cases;
test('origin-matching.json : identifiants uniques et ≥ 20 cas', () => {
  assert.ok(ORIGIN_CASES.length >= 20);
  assert.equal(new Set(ORIGIN_CASES.map((c) => c.id)).size, ORIGIN_CASES.length);
});
for (const c of ORIGIN_CASES) {
  test(`correspondance d'origine — ${c.id}`, () => {
    assert.deepEqual(matchOrigin(c.page, c.record), c.expected);
  });
}

test('captureSubmit() — sans <form> : un simple lien ne rapporte rien, un lien à rôle de bouton ou au texte de connexion si', () => {
  const html = `<!doctype html><body><div id="box">
    <input id="u" type="text" autocomplete="username"><input id="p" type="password">
    <a id="forgot" href="/reset">Mot de passe oublié ?</a>
    <a id="rolebtn" href="#" role="button">Entrer</a>
    <a id="textbtn" href="#">Se connecter</a>
  </div></body>`;
  const dom = new JSDOM(html, { url: 'https://links.example/', runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.eval(SCRIPT);
  const window = dom.window;
  const document = window.document;
  const got = [];
  window.__qafilaForms.captureSubmit((p) => got.push(plain(p)));
  document.getElementById('u').value = 'lina';
  document.getElementById('p').value = 'pw-1';
  const click = (id) => document.getElementById(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  click('forgot');
  assert.equal(got.length, 0, 'un lien « mot de passe oublié » ne vaut pas une soumission');
  click('rolebtn');
  assert.equal(got.length, 1, 'role=button compte');
  document.getElementById('p').value = 'pw-2';
  click('textbtn');
  assert.equal(got.length, 2, 'un lien dont le texte ressemble à une connexion compte');
  assert.deepEqual([got[1].username, got[1].password, got[1].form], ['lina', 'pw-2', null]);
});
