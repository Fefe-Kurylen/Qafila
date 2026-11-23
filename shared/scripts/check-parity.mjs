#!/usr/bin/env node
// Parité iOS / Android / contrat partagé.
//
// Lit, avec des expressions régulières (aucune chaîne de compilation Swift ou Kotlin n'est nécessaire) :
//   - ios-browser/QafilaBrowser/Models/ToolbarAction.swift   (enum ToolbarAction, presets, menu standard)
//   - ios-browser/QafilaBrowser/Views/Chrome.swift             (symboles actif / inactif)
//   - ios-browser/QafilaBrowser/Store/Settings.swift           (struct Settings, enums de réglages)
//   - android-browser/.../data/Models.kt                       (enum ToolbarAction, presets, data class Settings, enums)
//   - android-browser/.../ui/Icons.kt                          (ToolbarAction -> QIcon)
//   - android-browser/.../res/values/strings.xml               (libellés français)
// et les compare à shared/toolbar-actions.json et shared/settings-keys.json.
//
// Règles :
//   ✖ erreur       : quelque chose existe sur une plateforme et pas dans le JSON (ou l'inverse), ou le JSON
//                    décrit une plateforme autrement que son code (icône, destructif, défaut, type, valeurs, preset) ;
//                    une action / un réglage absent d'une plateforme sans `parityNote` ; une entrée `planned` déjà
//                    dans le code. Sortie 1.
//   ⚠ avertissement : un libellé français qui diffère d'une plateforme sans être enregistré dans `platformLabels`.
//                    Sortie 0, sauf --strict.
//   ℹ divergence    : différence volontairement documentée dans le JSON (platforms réduit + parityNote, overrides,
//                    platformDefaults, platformLabels…). Toujours listée, jamais bloquante sauf --strict.
//
// Usage : node shared/scripts/check-parity.mjs [--root <dépôt>] [--strict] [--json] [--quiet]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------------------------------------------
// Arguments et chemins

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(option('--root') || join(here, '..', '..'));
const STRICT = flag('--strict');
const JSON_OUT = flag('--json');
const QUIET = flag('--quiet');

const PATHS = {
  toolbarJson: 'shared/toolbar-actions.json',
  settingsJson: 'shared/settings-keys.json',
  iosActions: 'ios-browser/QafilaBrowser/Models/ToolbarAction.swift',
  iosChrome: 'ios-browser/QafilaBrowser/Views/Chrome.swift',
  iosSettings: 'ios-browser/QafilaBrowser/Store/Settings.swift',
  androidModels: 'android-browser/app/src/main/java/fr/qafila/browser/data/Models.kt',
  androidIcons: 'android-browser/app/src/main/java/fr/qafila/browser/ui/Icons.kt',
  androidStrings: 'android-browser/app/src/main/res/values/strings.xml'
};

function read(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`fichier introuvable : ${p}`);
  return readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------------------------------------------
// Rapport

const report = { errors: [], warnings: [], divergences: [], counts: {} };
const error = (section, msg) => report.errors.push({ section, msg });
const warn = (section, msg) => report.warnings.push({ section, msg });
const diverge = (section, msg) => report.divergences.push({ section, msg });

// ---------------------------------------------------------------------------------------------------------------
// Petits utilitaires d'analyse

// Retire les commentaires de ligne et de bloc (Swift et Kotlin). Les chaînes de ces fichiers ne contiennent pas « // ».
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^"\n]*$/gm, '');
}

/** Texte entre l'accolade / parenthèse qui suit `start` et sa fermante, en équilibrant. */
function balanced(src, startIndex, open, close) {
  const from = src.indexOf(open, startIndex);
  if (from < 0) return null;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return { body: src.slice(from + 1, i), end: i + 1 }; }
  }
  return null;
}

/** Noms de premier niveau d'un corps d'enum Kotlin : `A(...), B(...)` → ['A', 'B'] (le contenu des parenthèses est retiré). */
function kotlinEnumEntries(body) {
  let out = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0) out += ch;
  }
  const names = [];
  for (const token of out.split(/[,;]/)) {
    const m = token.trim().match(/^([A-Z][A-Z0-9_]*)\b/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** lowerCamelCase → UPPER_SNAKE_CASE (fullURL → FULL_URL, newTab → NEW_TAB, dotsCircle → DOTS_CIRCLE). */
function camelToSnake(id) {
  return id.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toUpperCase();
}

/** Valeur de fil d'un nom Kotlin, pour une enum donnée du contrat (table androidNames puis règle mécanique). */
function kotlinNameToWire(enumDef, name) {
  for (const [wire, kn] of Object.entries(enumDef?.androidNames || {})) if (kn === name) return wire;
  for (const wire of allWireValues(enumDef)) if (camelToSnake(wire) === name) return wire;
  return null;
}
function wireToKotlinName(enumDef, wire) {
  return enumDef?.androidNames?.[wire] || camelToSnake(wire);
}
function allWireValues(enumDef) {
  const extra = Object.values(enumDef?.platformOnlyValues || {}).flat();
  return [...(enumDef?.values || []), ...extra];
}

function unescapeAndroid(s) {
  return s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8230;/g, '…').trim();
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fmt = (v) => JSON.stringify(v);

// ---------------------------------------------------------------------------------------------------------------
// Lecture du contrat

const toolbarJson = JSON.parse(read(PATHS.toolbarJson));
const settingsJson = JSON.parse(read(PATHS.settingsJson));

const actionsById = new Map(toolbarJson.actions.map((a) => [a.id, a]));
const shippedOn = (a, platform) => a.status === 'shipped' && a.platforms.includes(platform);

/** "newTab:tile" → { action: "newTab", showsLabel: false } ; "separator" → { action: "separator", showsLabel: true } */
function parseMenuEntry(entry) {
  const [action, suffix] = entry.split(':');
  return { action, showsLabel: suffix !== 'tile' };
}
function menuOf(spec) {
  if (spec === 'default') return toolbarJson.defaultMenu.map(parseMenuEntry);
  return spec.map(parseMenuEntry);
}

// ---------------------------------------------------------------------------------------------------------------
// iOS — ToolbarAction.swift

const iosActionsSrc = stripComments(read(PATHS.iosActions));

function parseIosActions(src) {
  const enumStart = src.indexOf('enum ToolbarAction');
  const enumBody = balanced(src, enumStart, '{', '}').body;
  // Les cases sont déclarés avant le premier `var`.
  const casesPart = enumBody.split(/\n\s*var /)[0];
  const cases = [];
  for (const m of casesPart.matchAll(/^\s*case\s+([^\n]+)$/gm)) {
    for (const c of m[1].split(',')) cases.push(c.trim());
  }
  const switchValues = (propName) => {
    const i = enumBody.indexOf(`var ${propName}:`);
    if (i < 0) return new Map();
    const body = balanced(enumBody, i, '{', '}').body;
    const map = new Map();
    for (const m of body.matchAll(/case\s+\.(\w+):\s*return\s+(?:L\()?"([^"]*)"\)?/g)) map.set(m[1], m[2]);
    return map;
  };
  const labels = switchValues('label');
  const symbols = switchValues('symbol');
  const tileLabels = switchValues('tileLabel');
  const destructiveMatch = enumBody.match(/var isDestructive:\s*Bool\s*\{([^}]*)\}/);
  const destructive = new Set([...(destructiveMatch ? destructiveMatch[1] : '').matchAll(/\.(\w+)/g)].map((m) => m[1]));

  // Menu standard et presets (ToolbarConfig).
  const stdStart = src.indexOf('static let standardMenu');
  const stdBody = balanced(src, src.indexOf('return [', stdStart), '[', ']').body;
  const standardMenu = [...stdBody.matchAll(/s\(\.(\w+)(?:,\s*label:\s*(true|false))?\)/g)].map((m) => ({ action: m[1], showsLabel: m[2] !== 'false' }));

  const presetFn = src.indexOf('static func preset(');
  const presetBody = balanced(src, presetFn, '{', '}').body;
  const presets = new Map();
  for (const m of presetBody.matchAll(/case\s+\.(\w+):\s*bar\s*=\s*\[([^\]]*)\]/g)) {
    presets.set(m[1], { bar: [...m[2].matchAll(/s\(\.(\w+)/g)].map((x) => x[1]), menu: 'standard' });
  }
  const presetEnumStart = src.indexOf('enum Preset');
  const presetEnumBody = balanced(src, presetEnumStart, '{', '}').body;
  const presetCases = (presetEnumBody.match(/case\s+([\w,\s]+)\n/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean);
  const presetLabels = new Map();
  const presetDescriptions = new Map();
  for (const m of presetEnumBody.matchAll(/case\s+\.(\w+):\s*return\s+L\("([^"]*)"\)/g)) {
    if (!presetLabels.has(m[1])) presetLabels.set(m[1], m[2]);
    else presetDescriptions.set(m[1], m[2]);
  }
  return { cases, labels, symbols, tileLabels, destructive, standardMenu, presets, presetCases, presetLabels, presetDescriptions };
}
const ios = parseIosActions(iosActionsSrc);

// Chrome.swift : symboles dépendant de l'état.
const iosStateSymbols = new Map();
for (const m of stripComments(read(PATHS.iosChrome)).matchAll(/case\s+\.(\w+):\s*return\s+[^"\n]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g)) {
  iosStateSymbols.set(m[1], { active: m[2], inactive: m[3] });
}
// Recharger / Arrêter : symbole d'état rendu par la vue ReloadGlyph (observe la progression à part).
{
  const m = stripComments(read(PATHS.iosChrome)).match(/struct\s+ReloadGlyph\b[\s\S]*?Image\(systemName:\s*\w+\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/);
  if (m && !iosStateSymbols.has('reload')) iosStateSymbols.set('reload', { active: m[1], inactive: m[2] });
}

// ---------------------------------------------------------------------------------------------------------------
// Android — Models.kt, Icons.kt, strings.xml

const androidSrc = stripComments(read(PATHS.androidModels));
const androidStrings = new Map();
for (const m of read(PATHS.androidStrings).matchAll(/<string name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) androidStrings.set(m[1], unescapeAndroid(m[2]));
const str = (res) => androidStrings.get(res) ?? `<R.string.${res} introuvable>`;

function parseKotlinEnum(src, name) {
  const m = src.match(new RegExp(`enum class ${name}\\b`));
  if (!m) return null;
  // `enum class X(...) : Labeled {` ou `enum class X {` : la liste de paramètres n'est consommée que si elle suit le nom.
  const afterName = m.index + m[0].length;
  const hasParams = /^\s*\(/.test(src.slice(afterName, afterName + 4));
  const paramList = hasParams ? balanced(src, afterName, '(', ')') : null;
  const bodyStart = src.indexOf('{', paramList ? paramList.end : afterName);
  const body = balanced(src, bodyStart, '{', '}').body;
  // Le corps d'enum se termine au premier `;` de premier niveau (ensuite : fonctions membres).
  return body;
}

function parseAndroidActions(src) {
  const body = parseKotlinEnum(src, 'ToolbarAction');
  const entries = new Map();
  // Chaque entrée : NAME(R.string.x[, true][, R.string.y | shortRes = R.string.y])
  let depth = 0, token = '', tokens = [];
  for (const ch of body.split(';')[0]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { tokens.push(token); token = ''; } else token += ch;
  }
  tokens.push(token);
  for (const t of tokens) {
    const m = t.trim().match(/^([A-Z][A-Z0-9_]*)\(([^)]*)\)$/);
    if (!m) continue;
    const argsList = m[2].split(',').map((s) => s.trim());
    const labelRes = argsList[0].replace('R.string.', '');
    let destructive = false, shortRes = labelRes;
    for (const a of argsList.slice(1)) {
      if (a === 'true' || a === 'destructive = true') destructive = true;
      else if (a.startsWith('shortRes')) shortRes = a.split('=')[1].trim().replace('R.string.', '');
      else if (a.startsWith('R.string.')) shortRes = a.replace('R.string.', '');
    }
    entries.set(m[1], { label: str(labelRes), tileLabel: str(shortRes), destructive });
  }

  // Menu par défaut.
  const dmStart = src.indexOf('fun defaultMenu()');
  const dmBody = balanced(src, src.indexOf('listOf(', dmStart), '(', ')').body;
  const parseSlots = (text) => {
    const out = [];
    for (const m of text.matchAll(/\bSEP\b|s\(ToolbarAction\.(\w+)((?:,\s*(?:size\s*=\s*ButtonSize\.\w+|label\s*=\s*(?:true|false)))*)\)/g)) {
      if (m[0] === 'SEP') out.push({ action: 'SEPARATOR', showsLabel: true });
      else out.push({ action: m[1], showsLabel: !/label\s*=\s*false/.test(m[2] || '') });
    }
    return out;
  };
  const defaultMenu = parseSlots(dmBody);

  // Presets : `Preset.X -> ToolbarConfig(bar = listOf(...), menu = defaultMenu() | listOf(...))`.
  const presets = new Map();
  const pfStart = src.indexOf('fun preset(p: Preset)');
  const whenBody = balanced(src, src.indexOf('when (p)', pfStart), '{', '}').body;
  const arms = whenBody.split(/Preset\.([A-Z_]+)\s*->/).slice(1);
  for (let i = 0; i < arms.length; i += 2) {
    const name = arms[i], text = arms[i + 1];
    const bar = balanced(text, text.indexOf('bar = listOf('), '(', ')').body;
    const menuIdx = text.indexOf('menu =');
    const menuText = text.slice(menuIdx);
    const menu = /^menu\s*=\s*defaultMenu\(\)/.test(menuText) ? 'default' : parseSlots(balanced(menuText, menuText.indexOf('listOf('), '(', ')').body);
    presets.set(name, { bar: parseSlots(bar).map((s) => s.action), menu });
  }
  const presetEnumBody = parseKotlinEnum(src, 'Preset');
  const presetMeta = new Map();
  for (const m of presetEnumBody.matchAll(/([A-Z_]+)\(R\.string\.(\w+),\s*R\.string\.(\w+)(?:,\s*MenuIconStyle\.(\w+))?\)/g)) {
    presetMeta.set(m[1], { label: str(m[2]), description: str(m[3]), menuIcon: m[4] || null });
  }
  return { entries, defaultMenu, presets, presetMeta };
}
const android = parseAndroidActions(androidSrc);

const androidIconsSrc = stripComments(read(PATHS.androidIcons));
const qiconEnum = new Set(kotlinEnumEntries(parseKotlinEnum(androidIconsSrc, 'QIcon')));
const androidIconMap = new Map();
for (const m of androidIconsSrc.matchAll(/ToolbarAction\.(\w+)\s*->\s*(.+)$/gm)) {
  const rhs = m[2];
  const icons = [...rhs.matchAll(/QIcon\.(\w+)/g)].map((x) => x[1]);
  if (/^if \(active\)/.test(rhs)) androidIconMap.set(m[1], { icon: icons[1], active: icons[0] });
  else androidIconMap.set(m[1], { icon: icons[0], active: null });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Actions

const S_ACT = 'actions';
const iosCaseSet = new Set(ios.cases);
const androidNameSet = new Set(android.entries.keys());

for (const a of toolbarJson.actions) {
  const kn = camelToSnake(a.id);
  const onIos = iosCaseSet.has(a.id), onAndroid = androidNameSet.has(kn);
  for (const f of ['id', 'label', 'tileLabel', 'sfSymbol', 'androidIcon', 'destructive', 'platforms', 'status']) {
    if (!(f in a)) error(S_ACT, `${a.id} : champ « ${f} » manquant dans toolbar-actions.json`);
  }
  if (a.status === 'planned') {
    if (onIos) error(S_ACT, `${a.id} est planifiée (phase ${a.phase}) mais existe déjà dans ToolbarAction.swift : passer status à shipped`);
    if (onAndroid) error(S_ACT, `${a.id} est planifiée (phase ${a.phase}) mais existe déjà dans Models.kt (${kn}) : passer status à shipped`);
    continue;
  }
  // Présence déclarée vs réelle.
  for (const [platform, present, file] of [['ios', onIos, 'ToolbarAction.swift'], ['android', onAndroid, 'Models.kt']]) {
    const declared = a.platforms.includes(platform);
    if (declared && !present) error(S_ACT, `${a.id} : déclarée sur ${platform} mais absente de ${file}`);
    if (!declared && present) error(S_ACT, `${a.id} : présente dans ${file} mais « platforms » ne liste pas ${platform}`);
    if (declared === present && !present) {
      if (!a.parityNote) error(S_ACT, `${a.id} : absente de ${platform} sans parityNote`);
      else diverge(S_ACT, `${a.id} n'existe pas sur ${platform} — ${a.parityNote}`);
    }
  }
  // iOS : libellés, symbole, destructif.
  if (onIos) {
    const l = ios.labels.get(a.id), expectedL = a.platformLabels?.ios ?? a.label;
    if (l !== expectedL) warn(S_ACT, `${a.id} : libellé iOS « ${l} » ≠ contrat « ${expectedL} » (ajouter platformLabels.ios ou corriger le contrat)`);
    else if (a.platformLabels?.ios) diverge(S_ACT, `${a.id} : libellé iOS « ${l} » diffère du canonique « ${a.label} »`);
    const t = ios.tileLabels.get(a.id) ?? l, expectedT = a.platformTileLabels?.ios ?? a.tileLabel;
    if (t !== expectedT) warn(S_ACT, `${a.id} : libellé de tuile iOS « ${t} » ≠ contrat « ${expectedT} »`);
    else if (a.platformTileLabels?.ios) diverge(S_ACT, `${a.id} : tuile iOS « ${t} » diffère du canonique « ${a.tileLabel} »`);
    const sym = ios.symbols.get(a.id);
    if (sym !== a.sfSymbol) error(S_ACT, `${a.id} : SF Symbol iOS « ${sym} » ≠ contrat « ${a.sfSymbol} »`);
    const dest = ios.destructive.has(a.id);
    if (dest !== a.destructive) error(S_ACT, `${a.id} : isDestructive iOS = ${dest}, contrat = ${a.destructive}`);
    const states = iosStateSymbols.get(a.id);
    if (states && !same(states, a.sfSymbolStates)) error(S_ACT, `${a.id} : symboles d'état iOS ${fmt(states)} ≠ contrat ${fmt(a.sfSymbolStates ?? null)}`);
    if (!states && a.sfSymbolStates) error(S_ACT, `${a.id} : contrat déclare sfSymbolStates mais Chrome.swift n'a pas de variante`);
  }
  // Android : libellés, icône, destructif.
  if (onAndroid) {
    const e = android.entries.get(kn);
    const expectedL = a.platformLabels?.android ?? a.label;
    if (e.label !== expectedL) warn(S_ACT, `${a.id} : libellé Android « ${e.label} » ≠ contrat « ${expectedL} » (ajouter platformLabels.android ou corriger le contrat)`);
    else if (a.platformLabels?.android) diverge(S_ACT, `${a.id} : libellé Android « ${e.label} » diffère du canonique « ${a.label} »`);
    const expectedT = a.platformTileLabels?.android ?? a.tileLabel;
    if (e.tileLabel !== expectedT) warn(S_ACT, `${a.id} : libellé court Android « ${e.tileLabel} » ≠ contrat « ${expectedT} »`);
    else if (a.platformTileLabels?.android) diverge(S_ACT, `${a.id} : tuile Android « ${e.tileLabel} » diffère du canonique « ${a.tileLabel} »`);
    if (e.destructive !== a.destructive) error(S_ACT, `${a.id} : destructive Android = ${e.destructive}, contrat = ${a.destructive}`);
    const ic = androidIconMap.get(kn);
    if (!ic) error(S_ACT, `${a.id} : aucune icône dans Icons.kt pour ToolbarAction.${kn}`);
    else {
      if (ic.icon !== a.androidIcon) error(S_ACT, `${a.id} : icône Android « ${ic.icon} » ≠ contrat « ${a.androidIcon} »`);
      if ((ic.active ?? null) !== (a.androidIconActive ?? null)) error(S_ACT, `${a.id} : icône Android active « ${ic.active} » ≠ contrat « ${a.androidIconActive ?? null} »`);
      if (!qiconEnum.has(a.androidIcon)) error(S_ACT, `${a.id} : QIcon.${a.androidIcon} n'existe pas dans Icons.kt`);
    }
  }
}
for (const c of ios.cases) if (!actionsById.has(c)) error(S_ACT, `ToolbarAction.swift a « ${c} », absent de toolbar-actions.json`);
for (const n of android.entries.keys()) {
  const match = [...actionsById.keys()].find((id) => camelToSnake(id) === n);
  if (!match) error(S_ACT, `Models.kt a ToolbarAction.${n}, absent de toolbar-actions.json`);
}
report.counts.actions = { ios: ios.cases.length, android: android.entries.size, contract: toolbarJson.actions.length, planned: toolbarJson.actions.filter((a) => a.status === 'planned').length };

// ---------------------------------------------------------------------------------------------------------------
// 2. Menu par défaut et presets

const S_PRE = 'presets';
const toWireSlots = (slots) => slots.map((s) => ({ action: s.action.includes('_') || /^[A-Z]+$/.test(s.action) ? kotlinToId(s.action) : s.action, showsLabel: s.showsLabel }));
function kotlinToId(name) {
  const found = [...actionsById.keys()].find((id) => camelToSnake(id) === name);
  return found || name.toLowerCase();
}
const contractDefault = menuOf('default');
if (!same(ios.standardMenu, contractDefault)) error(S_PRE, `menu standard iOS ≠ defaultMenu du contrat\n      iOS      : ${fmt(ios.standardMenu)}\n      contrat  : ${fmt(contractDefault)}`);
if (!same(toWireSlots(android.defaultMenu), contractDefault)) error(S_PRE, `defaultMenu() Android ≠ defaultMenu du contrat\n      Android  : ${fmt(toWireSlots(android.defaultMenu))}\n      contrat  : ${fmt(contractDefault)}`);
for (const e of contractDefault) if (!actionsById.has(e.action)) error(S_PRE, `defaultMenu référence une action inconnue « ${e.action} »`);

const presetIds = new Set(toolbarJson.presets.map((p) => p.id));
for (const c of ios.presetCases) if (!presetIds.has(c)) error(S_PRE, `preset iOS « ${c} » absent du contrat`);
for (const n of android.presets.keys()) if (!presetIds.has(n.toLowerCase())) error(S_PRE, `preset Android « ${n} » absent du contrat`);

for (const p of toolbarJson.presets) {
  for (const id of p.bar) if (!actionsById.has(id)) error(S_PRE, `${p.id} : bar référence une action inconnue « ${id} »`);
  if (p.menu !== 'default') for (const e of menuOf(p.menu)) if (!actionsById.has(e.action)) error(S_PRE, `${p.id} : menu référence une action inconnue « ${e.action} »`);
  for (const id of p.bar) if (actionsById.get(id)?.status === 'planned') error(S_PRE, `${p.id} : la barre contient l'action planifiée « ${id} »`);

  // iOS
  const ip = ios.presets.get(p.id);
  if (!ip) { error(S_PRE, `${p.id} : absent de ToolbarAction.swift`); }
  else {
    const ov = p.overrides?.ios;
    const expectedBar = ov?.bar ?? p.bar;
    if (!same(ip.bar, expectedBar)) error(S_PRE, `${p.id} : barre iOS ${fmt(ip.bar)} ≠ attendu ${fmt(expectedBar)}`);
    else if (ov?.bar) diverge(S_PRE, `${p.id} : barre iOS ${fmt(ip.bar)} au lieu du canonique ${fmt(p.bar)} — ${ov.parityNote ?? ''}`);
    const expectedMenu = ov?.menu ?? p.menu;
    const iosMenuSpec = 'default'; // iOS n'a qu'un menu standard pour tous les presets.
    if (!same(menuOf(iosMenuSpec), menuOf(expectedMenu))) error(S_PRE, `${p.id} : menu iOS (standard) ≠ attendu ${fmt(expectedMenu)}`);
    else if (ov?.menu && ov.menu !== p.menu) diverge(S_PRE, `${p.id} : iOS garde le menu standard au lieu du menu du preset — ${ov.parityNote ?? ''}`);
    if ((ov?.bar || (ov?.menu && ov.menu !== p.menu)) && !ov.parityNote) error(S_PRE, `${p.id} : overrides.ios sans parityNote`);
    const l = ios.presetLabels.get(p.id);
    if (l !== p.label) warn(S_PRE, `${p.id} : libellé iOS « ${l} » ≠ contrat « ${p.label} »`);
    const d = ios.presetDescriptions.get(p.id);
    if (d !== p.description?.ios) warn(S_PRE, `${p.id} : description iOS « ${d} » ≠ contrat « ${p.description?.ios} »`);
    if (p.platformMenuIcon?.ios) error(S_PRE, `${p.id} : platformMenuIcon.ios déclaré mais iOS ne force jamais l'icône du menu`);
  }
  // Android
  const kn = p.id.toUpperCase();
  const ap = android.presets.get(kn);
  if (!ap) { error(S_PRE, `${p.id} : absent de Models.kt`); }
  else {
    const ov = p.overrides?.android;
    const expectedBar = ov?.bar ?? p.bar;
    const bar = ap.bar.map(kotlinToId);
    if (!same(bar, expectedBar)) error(S_PRE, `${p.id} : barre Android ${fmt(bar)} ≠ attendu ${fmt(expectedBar)}`);
    else if (ov?.bar) diverge(S_PRE, `${p.id} : barre Android ${fmt(bar)} au lieu du canonique ${fmt(p.bar)} — ${ov.parityNote ?? ''}`);
    const expectedMenu = menuOf(ov?.menu ?? p.menu);
    const menu = ap.menu === 'default' ? menuOf('default') : toWireSlots(ap.menu);
    if (!same(menu, expectedMenu)) error(S_PRE, `${p.id} : menu Android ≠ attendu\n      Android : ${fmt(menu)}\n      attendu : ${fmt(expectedMenu)}`);
    else if (ov?.menu) diverge(S_PRE, `${p.id} : menu Android spécifique — ${ov.parityNote ?? ''}`);
    const meta = android.presetMeta.get(kn);
    if (meta.label !== p.label) warn(S_PRE, `${p.id} : libellé Android « ${meta.label} » ≠ contrat « ${p.label} »`);
    if (meta.description !== p.description?.android) warn(S_PRE, `${p.id} : description Android « ${meta.description} » ≠ contrat « ${p.description?.android} »`);
    const expectedIcon = p.platformMenuIcon?.android ? camelToSnake(p.platformMenuIcon.android) : null;
    if ((meta.menuIcon ?? null) !== expectedIcon) error(S_PRE, `${p.id} : menuIcon Android « ${meta.menuIcon} » ≠ contrat « ${expectedIcon} »`);
    else if (expectedIcon) diverge(S_PRE, `${p.id} : Android force menuIcon = ${p.platformMenuIcon.android}, iOS non`);
  }
}
report.counts.presets = { ios: ios.presetCases.length, android: android.presets.size, contract: toolbarJson.presets.length };

// ---------------------------------------------------------------------------------------------------------------
// 3. Réglages

const S_SET = 'settings';

function parseSwiftSettings(src) {
  const start = src.indexOf('struct Settings:');
  const body = balanced(src, start, '{', '}').body;
  const props = new Map();
  for (const m of body.matchAll(/^\s*var\s+(\w+):\s*([\w<>]+)\s*=\s*(.+?)\s*$/gm)) {
    if (m[3].includes('{')) continue; // propriété calculée
    props.set(m[1], { type: m[2], raw: m[3] });
  }
  return props;
}
function parseSwiftEnums(src) {
  const enums = new Map();
  for (const m of src.matchAll(/enum\s+(\w+):\s*String[^{]*\{/g)) {
    const body = balanced(src, m.index, '{', '}').body;
    const casesPart = body.split(/\n\s*var /)[0];
    const cases = [];
    for (const c of casesPart.matchAll(/^\s*case\s+([^\n]+)$/gm)) for (const x of c[1].split(',')) cases.push(x.trim());
    enums.set(m[1], cases);
  }
  return enums;
}
function parseKotlinSettings(src) {
  const start = src.indexOf('data class Settings(');
  const body = balanced(src, start, '(', ')').body;
  const props = new Map();
  for (const m of body.matchAll(/^\s*val\s+(\w+):\s*([\w<>]+)\s*=\s*(.+?),?\s*$/gm)) props.set(m[1], { type: m[2], raw: m[3].replace(/,$/, '') });
  return props;
}
function parseKotlinEnums(src) {
  const enums = new Map();
  for (const m of src.matchAll(/enum class (\w+)/g)) {
    const body = parseKotlinEnum(src, m[1]);
    if (body) enums.set(m[1], kotlinEnumEntries(body.split(';')[0]));
  }
  return enums;
}

const iosSettingsSrc = stripComments(read(PATHS.iosSettings));
const swiftProps = parseSwiftSettings(iosSettingsSrc);
const swiftEnums = new Map([...parseSwiftEnums(iosSettingsSrc), ...parseSwiftEnums(iosActionsSrc)]);
const kotlinProps = parseKotlinSettings(androidSrc);
const kotlinEnums = parseKotlinEnums(androidSrc);

/** Normalise un défaut Swift vers la forme du contrat. */
function swiftDefault(raw, setting) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^".*"$/.test(raw)) return JSON.parse(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === '[]') return [];
  if (/^\.preset\(\.(\w+)\)$/.test(raw)) return { preset: raw.match(/\.preset\(\.(\w+)\)/)[1] };
  if (raw.includes('Locale.current')) return 'deviceLanguage';
  if (raw === 'Settings.currentDefaults') return Number(read(PATHS.iosSettings).match(/static let currentDefaults\s*=\s*(\d+)/)?.[1]);
  if (/^\.(\w+)$/.test(raw)) return raw.slice(1);
  return `<non reconnu : ${raw}>`;
}
/** Normalise un défaut Kotlin vers la forme du contrat (valeurs de fil pour les enums). */
function kotlinDefault(raw, setting) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^".*"$/.test(raw)) return JSON.parse(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'emptySet()' || raw === 'emptyList()') return [];
  const preset = raw.match(/ToolbarConfig\.preset\(ToolbarConfig\.Preset\.(\w+)\)/);
  if (preset) return { preset: preset[1].toLowerCase() };
  const en = raw.match(/^(\w+)\.([A-Z][A-Z0-9_]*)$/);
  if (en) {
    const enumName = setting.type.startsWith('enum:') ? setting.type.slice(5) : null;
    const def = settingsJson.enums[enumName];
    return kotlinNameToWire(def, en[2]) ?? `<valeur Kotlin inconnue du contrat : ${raw}>`;
  }
  return `<non reconnu : ${raw}>`;
}

const settingsByKey = new Map(settingsJson.settings.map((s) => [s.key, s]));
for (const s of settingsJson.settings) {
  const iosName = s.ios ?? s.key, androidName = s.android ?? s.key;
  const sp = swiftProps.get(iosName), kp = kotlinProps.get(androidName);
  const platforms = s.platforms ?? ['ios', 'android', 'desktop'];
  if (s.status === 'planned') {
    if (sp) error(S_SET, `${s.key} est planifié (phase ${s.phase}) mais Settings.swift a déjà « ${iosName} » : passer status à shipped`);
    if (kp) error(S_SET, `${s.key} est planifié (phase ${s.phase}) mais Models.kt a déjà « ${androidName} » : passer status à shipped`);
    continue;
  }
  for (const f of ['key', 'type', 'default', 'sync', 'iosType', 'androidType', 'section']) if (!(f in s)) error(S_SET, `${s.key} : champ « ${f} » manquant dans settings-keys.json`);
  for (const [platform, present, name, file] of [['ios', !!sp, iosName, 'Settings.swift'], ['android', !!kp, androidName, 'Models.kt']]) {
    const declared = platforms.includes(platform);
    if (declared && !present) error(S_SET, `${s.key} : attendu dans ${file} sous « ${name} », introuvable`);
    if (!declared && present) error(S_SET, `${s.key} : présent dans ${file} mais « platforms » exclut ${platform}`);
    if (!declared && !present) {
      if (!s.parityNote && !s.note) error(S_SET, `${s.key} : absent de ${platform} sans note`);
      else diverge(S_SET, `${s.key} n'existe pas sur ${platform} — ${s.parityNote ?? s.note}`);
    }
  }
  if (s.ios && s.ios !== s.key) error(S_SET, `${s.key} : « ios » doit être absent (la clé canonique EST le nom Swift)`);
  if (s.android && s.android !== s.key) diverge(S_SET, `${s.key} : propriété Android nommée « ${s.android} »`);
  if (sp) {
    if (sp.type !== s.iosType) error(S_SET, `${s.key} : type Swift « ${sp.type} » ≠ contrat iosType « ${s.iosType} »`);
    const d = swiftDefault(sp.raw, s), expected = s.platformDefaults?.ios ?? s.default;
    if (!same(d, expected)) error(S_SET, `${s.key} : défaut iOS ${fmt(d)} ≠ attendu ${fmt(expected)} (Settings.swift : ${sp.raw})`);
    else if ('ios' in (s.platformDefaults ?? {})) diverge(S_SET, `${s.key} : défaut iOS ${fmt(d)} au lieu du canonique ${fmt(s.default)}`);
  }
  if (kp) {
    if (kp.type !== s.androidType) error(S_SET, `${s.key} : type Kotlin « ${kp.type} » ≠ contrat androidType « ${s.androidType} »`);
    const d = kotlinDefault(kp.raw, s), expected = s.platformDefaults?.android ?? s.default;
    if (!same(d, expected)) error(S_SET, `${s.key} : défaut Android ${fmt(d)} ≠ attendu ${fmt(expected)} (Models.kt : ${kp.raw})`);
    else if ('android' in (s.platformDefaults ?? {})) diverge(S_SET, `${s.key} : défaut Android ${fmt(d)} au lieu du canonique ${fmt(s.default)}`);
  }
  if (s.type.startsWith('enum:')) {
    const def = settingsJson.enums[s.type.slice(5)];
    if (!def) error(S_SET, `${s.key} : enum « ${s.type.slice(5)} » absente de settings-keys.json › enums`);
    else {
      if (sp && def.ios !== s.iosType) error(S_SET, `${s.key} : iosType « ${s.iosType} » ≠ enums.${s.type.slice(5)}.ios « ${def.ios} »`);
      if (kp && def.android !== s.androidType) error(S_SET, `${s.key} : androidType « ${s.androidType} » ≠ enums.${s.type.slice(5)}.android « ${def.android} »`);
    }
  }
}
const iosCovered = new Set(settingsJson.settings.filter((s) => s.status === 'shipped').map((s) => s.ios ?? s.key));
const androidCovered = new Set(settingsJson.settings.filter((s) => s.status === 'shipped').map((s) => s.android ?? s.key));
for (const name of swiftProps.keys()) if (!iosCovered.has(name)) error(S_SET, `Settings.swift a « ${name} », absent de settings-keys.json`);
for (const name of kotlinProps.keys()) if (!androidCovered.has(name)) error(S_SET, `Models.kt Settings a « ${name} », absent de settings-keys.json`);

// Enums : valeurs sur chaque plateforme.
const S_ENUM = 'enums';
for (const [name, def] of Object.entries(settingsJson.enums)) {
  const sw = swiftEnums.get(def.ios);
  if (!sw) error(S_ENUM, `${name} : enum Swift « ${def.ios} » introuvable`);
  else {
    const expected = [...def.values, ...(def.platformOnlyValues?.ios ?? [])].sort();
    if (!same([...sw].sort(), expected)) error(S_ENUM, `${name} : cas Swift ${fmt([...sw].sort())} ≠ contrat ${fmt(expected)}`);
  }
  // Enum propre à l'iPhone (android: null) : rien à vérifier côté Kotlin.
  if (def.android === null) continue;
  const kt = kotlinEnums.get(def.android);
  if (!kt) error(S_ENUM, `${name} : enum Kotlin « ${def.android} » introuvable`);
  else {
    const expected = [...def.values, ...(def.platformOnlyValues?.android ?? [])].map((v) => wireToKotlinName(def, v)).sort();
    if (!same([...kt].sort(), expected)) error(S_ENUM, `${name} : entrées Kotlin ${fmt([...kt].sort())} ≠ contrat ${fmt(expected)}`);
  }
  for (const [platform, extra] of Object.entries(def.platformOnlyValues ?? {})) diverge(S_ENUM, `${name} : valeurs ${fmt(extra)} seulement sur ${platform} — ${def.note ?? ''}`);
  if (def.androidNames) diverge(S_ENUM, `${name} : noms Kotlin non mécaniques ${fmt(def.androidNames)}`);
}
report.counts.settings = { ios: swiftProps.size, android: kotlinProps.size, contract: settingsJson.settings.length, planned: settingsJson.settings.filter((s) => s.status === 'planned').length, synced: settingsJson.settings.filter((s) => s.sync).length };
report.counts.enums = { contract: Object.keys(settingsJson.enums).length };

// ---------------------------------------------------------------------------------------------------------------
// Sortie

const ok = report.errors.length === 0 && (!STRICT || (report.warnings.length === 0 && report.divergences.length === 0));
report.ok = ok;
report.strict = STRICT;

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else if (!QUIET) {
  const c = report.counts;
  const lines = [];
  lines.push('Parité iOS / Android / contrat partagé');
  lines.push(`  Actions  : ${c.actions.ios} iOS · ${c.actions.android} Android · ${c.actions.contract} dans le contrat (${c.actions.planned} planifiée(s))`);
  lines.push(`  Presets  : ${c.presets.ios} iOS · ${c.presets.android} Android · ${c.presets.contract} dans le contrat`);
  lines.push(`  Réglages : ${c.settings.ios} iOS · ${c.settings.android} Android · ${c.settings.contract} dans le contrat (${c.settings.planned} planifié(s), ${c.settings.synced} synchronisés) · ${c.enums.contract} enums`);
  const section = (title, items, mark) => {
    if (!items.length) return;
    lines.push('');
    lines.push(`${mark} ${title} (${items.length})`);
    for (const it of items) lines.push(`  ${mark} [${it.section}] ${it.msg}`);
  };
  section('Erreurs', report.errors, '✖');
  section('Avertissements', report.warnings, '⚠');
  section('Divergences documentées', report.divergences, 'ℹ');
  lines.push('');
  lines.push(ok ? `Résultat : OK (${report.errors.length} erreur, ${report.warnings.length} avertissement, ${report.divergences.length} divergences documentées${STRICT ? ', mode strict' : ''})`
               : `Résultat : ÉCHEC (${report.errors.length} erreur(s), ${report.warnings.length} avertissement(s)${STRICT ? ', mode strict' : ''})`);
  process.stdout.write(lines.join('\n') + '\n');
}
process.exit(ok ? 0 : 1);
