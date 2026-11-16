// Parité iOS / Android / contrat : shared/scripts/check-parity.mjs doit passer sur le dépôt tel qu'il est,
// et détecter les dérives (un cas Swift ou une propriété Kotlin ajoutée / retirée, un preset modifié, un libellé
// changé) quand on les simule dans une copie temporaire des sources. Aucun réseau, aucune modification du dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const SCRIPT = join(here, '..', 'scripts', 'check-parity.mjs');

const SOURCES = [
  'shared/toolbar-actions.json',
  'shared/settings-keys.json',
  'ios-browser/QafilaBrowser/Models/ToolbarAction.swift',
  'ios-browser/QafilaBrowser/Views/Chrome.swift',
  'ios-browser/QafilaBrowser/Store/Settings.swift',
  'android-browser/app/src/main/java/fr/qafila/browser/data/Models.kt',
  'android-browser/app/src/main/java/fr/qafila/browser/ui/Icons.kt',
  'android-browser/app/src/main/res/values/strings.xml'
];

/** Lance le script ; renvoie { code, report } (le rapport JSON est écrit même en cas d'échec). */
function run(root, ...extra) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--root', root, '--json', ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, report: JSON.parse(out) };
  } catch (e) {
    assert.ok(e.stdout, `le script a planté sans rapport : ${e.stderr}`);
    return { code: e.status, report: JSON.parse(e.stdout) };
  }
}

/** Copie les sources dans un dossier temporaire et applique une mutation { fichier: texte → texte }. */
function withMutation(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'qafila-parity-'));
  for (const rel of SOURCES) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), readFileSync(join(ROOT, rel), 'utf8'));
  }
  mutate((rel, from, to) => {
    const p = join(dir, rel);
    const src = readFileSync(p, 'utf8');
    assert.ok(src.includes(from), `la mutation vise un texte absent de ${rel} : ${from}`);
    writeFileSync(p, src.replace(from, to));
  });
  return dir;
}

const toolbar = JSON.parse(readFileSync(join(ROOT, 'shared/toolbar-actions.json'), 'utf8'));
const settings = JSON.parse(readFileSync(join(ROOT, 'shared/settings-keys.json'), 'utf8'));

test('le dépôt est en parité avec le contrat (0 erreur, 0 avertissement)', () => {
  const { code, report } = run(ROOT);
  assert.equal(code, 0, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.ok(report.divergences.length > 0, 'les divergences documentées (reopenTab…) doivent être listées');
  assert.equal(report.counts.actions.planned, 2);
});

test('--strict échoue tant que des divergences documentées subsistent', () => {
  const { code, report } = run(ROOT, '--strict');
  assert.equal(code, 1);
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, []);
});

test('toolbar-actions.json : identifiants uniques, références valides, divergences documentées', () => {
  const ids = toolbar.actions.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants dupliqués');
  const known = new Set(ids);
  for (const a of toolbar.actions) {
    assert.match(a.id, /^[a-z][A-Za-z0-9]*$/, `${a.id} : lowerCamelCase attendu`);
    assert.ok(['shipped', 'planned'].includes(a.status), `${a.id} : status`);
    if (a.status === 'planned') assert.ok(Number.isInteger(a.phase), `${a.id} : phase manquante`);
    for (const p of ['ios', 'android']) {
      if (a.status === 'shipped' && !a.platforms.includes(p)) assert.ok(a.parityNote, `${a.id} absente de ${p} sans parityNote`);
    }
    assert.ok(a.platforms.includes('desktop'), `${a.id} : Electron construit son interface depuis ce fichier`);
  }
  const entry = (e) => e.split(':')[0];
  for (const e of toolbar.defaultMenu) assert.ok(known.has(entry(e)), `defaultMenu : ${e}`);
  const presetIds = toolbar.presets.map((p) => p.id);
  assert.deepEqual(presetIds, ['complete', 'navigation', 'tools', 'reader', 'minimal', 'zen'], 'galerie DESIGN.md §7, dans l\'ordre');
  for (const p of toolbar.presets) {
    for (const id of p.bar) assert.ok(known.has(id), `${p.id}.bar : ${id}`);
    if (p.menu !== 'default') for (const e of p.menu) assert.ok(known.has(entry(e)), `${p.id}.menu : ${e}`);
    for (const [platform, ov] of Object.entries(p.overrides ?? {})) {
      assert.ok(ov.parityNote, `${p.id}.overrides.${platform} sans parityNote`);
      for (const id of ov.bar ?? []) assert.ok(known.has(id), `${p.id}.overrides.${platform}.bar : ${id}`);
    }
    assert.ok(p.description?.ios && p.description?.android, `${p.id} : descriptions des deux plateformes`);
  }
  const passwords = toolbar.actions.find((a) => a.id === 'passwords');
  assert.equal(passwords.status, 'planned');
  assert.equal(passwords.phase, 1);
  assert.equal(passwords.label, 'Mots de passe');
});

test('settings-keys.json : clés uniques, enums connues, liste blanche de synchro conforme à COFFRE-SYNC.md §4.1', () => {
  const keys = settings.settings.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'clés dupliquées');
  for (const s of settings.settings) {
    assert.match(s.key, /^[A-Za-z][A-Za-z0-9_.]*$/, `${s.key} : motif de record-setting.schema.json`);
    assert.equal(typeof s.sync, 'boolean', `${s.key} : sync`);
    if (s.type.startsWith('enum:')) assert.ok(settings.enums[s.type.slice(5)], `${s.key} : enum ${s.type} inconnue`);
    if (s.status === 'planned') assert.ok(Number.isInteger(s.phase), `${s.key} : phase`);
    if (s.type === 'integer') assert.ok(Number.isInteger(s.default), `${s.key} : défaut entier`);
    if (s.type === 'boolean') assert.equal(typeof s.default, 'boolean', `${s.key} : défaut booléen`);
    if (s.type === 'stringSet') assert.deepEqual(s.default, [], `${s.key} : ensemble vide par défaut`);
  }
  // Jamais synchronisés (propres à l'appareil), d'après COFFRE-SYNC.md §4.1.
  for (const k of ['appIcon', 'haptics', 'comfortMode', 'suspendTabsInLowPower', 'customUserAgent', 'landscapeTopBar', 'edgeSwipeNavigation', 'autoLockMinutes', 'biometricUnlock']) {
    const s = settings.settings.find((x) => x.key === k);
    assert.ok(s, `${k} manquant`);
    assert.equal(s.sync, false, `${k} doit être propre à l'appareil`);
  }
  // Le réglage composé `toolbar` voyage comme une seule valeur.
  assert.equal(settings.settings.find((s) => s.key === 'toolbar').sync, true);
  for (const [name, def] of Object.entries(settings.enums)) {
    assert.ok(Array.isArray(def.values) && def.values.length > 0, `${name} : values`);
    for (const v of def.values) assert.match(v, /^[a-z][A-Za-z0-9]*$/, `${name}.${v} : rawValue Swift attendu`);
    for (const wire of Object.keys(def.androidNames ?? {})) assert.ok(def.values.includes(wire), `${name}.androidNames.${wire} n'est pas une valeur`);
  }
});

test('détecte un cas Swift ajouté qui correspond à une action planifiée', () => {
  const dir = withMutation((edit) => edit('ios-browser/QafilaBrowser/Models/ToolbarAction.swift', 'case address, darkMode', 'case address, darkMode, passwords'));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /passwords/.test(e.msg) && /shipped/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('détecte un cas Swift inconnu du contrat', () => {
  const dir = withMutation((edit) => edit('ios-browser/QafilaBrowser/Models/ToolbarAction.swift', 'case address, darkMode', 'case address, darkMode, teleport'));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /teleport/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('détecte une propriété Kotlin retirée de Settings', () => {
  const dir = withMutation((edit) => edit('android-browser/app/src/main/java/fr/qafila/browser/data/Models.kt', '    val comfortMode: Boolean = false,\n', ''));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /comfortMode/.test(e.msg) && /Models\.kt/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('détecte un défaut Swift modifié', () => {
  const dir = withMutation((edit) => edit('ios-browser/QafilaBrowser/Store/Settings.swift', 'var blockAds: Bool = true', 'var blockAds: Bool = false'));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /blockAds/.test(e.msg) && /défaut iOS/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('détecte une barre de preset Android modifiée', () => {
  const dir = withMutation((edit) => edit('android-browser/app/src/main/java/fr/qafila/browser/data/Models.kt',
    'bar = listOf(s(ToolbarAction.BACK), s(ToolbarAction.FORWARD), s(ToolbarAction.SHARE), s(ToolbarAction.NEW_TAB), s(ToolbarAction.TABS), s(ToolbarAction.MENU))',
    'bar = listOf(s(ToolbarAction.FORWARD), s(ToolbarAction.BACK), s(ToolbarAction.SHARE), s(ToolbarAction.NEW_TAB), s(ToolbarAction.TABS), s(ToolbarAction.MENU))'));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /complete/.test(e.msg) && /barre Android/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('détecte une icône Android changée et un drapeau destructif iOS changé', () => {
  const dir = withMutation((edit) => {
    edit('android-browser/app/src/main/java/fr/qafila/browser/ui/Icons.kt', 'ToolbarAction.HOME -> QIcon.HOME', 'ToolbarAction.HOME -> QIcon.GLOBE');
    edit('ios-browser/QafilaBrowser/Models/ToolbarAction.swift', 'self == .closeTab || self == .closeAllTabs', 'self == .closeAllTabs');
  });
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /home/.test(e.msg) && /GLOBE/.test(e.msg)), JSON.stringify(report.errors));
    assert.ok(report.errors.some((e) => /closeTab/.test(e.msg) && /isDestructive/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un libellé français changé est un avertissement (bloquant seulement en --strict)', () => {
  const dir = withMutation((edit) => edit('android-browser/app/src/main/res/values/strings.xml', '<string name="action_home">Accueil</string>', '<string name="action_home">Maison</string>'));
  try {
    const lax = run(dir);
    assert.equal(lax.code, 0);
    assert.ok(lax.report.warnings.some((w) => /home/.test(w.msg) && /Maison/.test(w.msg)), JSON.stringify(lax.report.warnings));
    const strict = run(dir, '--strict');
    assert.equal(strict.code, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('une entrée du contrat sans correspondance dans le code est une erreur', () => {
  const dir = withMutation((edit) => edit('shared/settings-keys.json', '"key": "blockAds"', '"key": "blockAdverts"'));
  try {
    const { code, report } = run(dir);
    assert.equal(code, 1);
    assert.ok(report.errors.some((e) => /blockAdverts/.test(e.msg)), JSON.stringify(report.errors));
    assert.ok(report.errors.some((e) => /« blockAds »/.test(e.msg)), JSON.stringify(report.errors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
