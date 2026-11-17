'use strict';
// Réglages : défauts, validation et conversion à partir de shared/settings-keys.json.
// Les clés de state.json sont exactement les clés canoniques du contrat (une future synchro n'a rien à traduire).
const contract = require('./contract');

// Défauts propres au PC (comme `platformDefaults` du contrat) : barre en haut, sites en version bureau.
const DESKTOP_DEFAULTS = {
  desktopByDefault: true,
  searchEngine: 'google',
  scrollBehavior: 'fixed',
};

// Réglages qui n'existent que sur PC (jamais synchronisés). `language` : '' = langue du système.
const DESKTOP_ONLY = [
  { key: 'language', section: 'about', type: 'enum:Language', default: '', sync: false, platforms: ['desktop'] },
  // Dossier de téléchargement : '' = dossier « Téléchargements » du système.
  { key: 'downloadFolder', section: 'privacy', type: 'string', default: '', sync: false, platforms: ['desktop'] },
  // Mises à jour : recherche au démarrage puis toutes les 6 heures, téléchargement en arrière-plan (main/updater.js).
  { key: 'autoUpdate', section: 'about', type: 'boolean', default: true, sync: false, platforms: ['desktop'] },
  // Barre de favoris, discrète, sous la barre d'adresse (Ctrl+Maj+B).
  { key: 'showBookmarksBar', section: 'appearance', type: 'boolean', default: true, sync: false, platforms: ['desktop'] },
  // Migration unique : DuckDuckGo (ancien moteur par défaut) remplacé par Google, nouveau défaut.
  { key: 'searchDefaultGoogle', section: 'search', type: 'boolean', default: false, sync: false, platforms: ['desktop'] },
  // Tailles (Apparence › Tailles) : barre d'adresse, barre de titre Windows, barre de favoris.
  { key: 'barSize', section: 'appearance', type: 'enum:UiSize', default: 'medium', sync: false, platforms: ['desktop'] },
  { key: 'barLayout', section: 'appearance', type: 'enum:BarLayout', default: 'two', sync: false, platforms: ['desktop'] },
  { key: 'titleBarSize', section: 'appearance', type: 'enum:UiSize', default: 'medium', sync: false, platforms: ['desktop'] },
  { key: 'bookmarksBarSize', section: 'appearance', type: 'enum:UiSize', default: 'medium', sync: false, platforms: ['desktop'] },
];
const DESKTOP_ENUMS = { Language: { values: ['', 'fr', 'en', 'ar', 'es', 'de'] }, UiSize: { values: ['small', 'medium', 'large'] }, BarLayout: { values: ['one', 'two'] } };

let schema = null;

/** Table clé → description (type, défaut, enum) des réglages livrés (`shipped`) + réglages PC. */
function describe() {
  if (schema) return schema;
  const keys = contract.settingsKeys();
  const enums = { ...keys.enums, ...DESKTOP_ENUMS };
  const byKey = {};
  for (const s of keys.settings) {
    if (s.status !== 'shipped') continue;
    if (s.platforms && !s.platforms.includes('desktop')) continue;
    byKey[s.key] = { ...s, default: DESKTOP_DEFAULTS[s.key] !== undefined ? DESKTOP_DEFAULTS[s.key] : s.default };
  }
  for (const s of DESKTOP_ONLY) byKey[s.key] = s;
  // Le défaut de `toolbar` est le preset Complète avec le menu standard, style Flottante, position haute (PC).
  byKey.toolbar.default = defaultToolbar();
  schema = { byKey, enums };
  return schema;
}

function slot(action, size = 'medium', showsLabel = true) { return { action, size, showsLabel }; }

/** Développe une entrée de menu du contrat ("action", "action:tile", "separator") en emplacement. */
function menuEntry(entry) {
  const [action, flag] = String(entry).split(':');
  return slot(action, 'medium', flag !== 'tile');
}

/** Configuration de barre d'un preset du contrat (identifiant `complete`, `navigation`…). */
function presetConfig(id) {
  const ta = contract.toolbarActions();
  const p = ta.presets.find((x) => x.id === id) || ta.presets[0];
  const menu = p.menu === 'default' ? ta.defaultMenu : p.menu;
  return {
    bar: p.bar.map((a) => slot(a)),
    menu: menu.map(menuEntry),
    style: 'floating',
    position: 'top',
    preset: p.id,
  };
}

function defaultToolbar() { return presetConfig('complete'); }

/** Valeur par défaut de chaque réglage. */
function defaults() {
  const out = {};
  for (const [k, s] of Object.entries(describe().byKey)) out[k] = clone(s.default);
  return out;
}

function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/** Valide une valeur pour une clé ; renvoie la valeur normalisée ou `undefined` si elle est refusée. */
function validate(key, value) {
  const { byKey, enums } = describe();
  // Clés propres seulement : « __proto__ », « constructor », « toString »… ne désignent jamais un réglage.
  if (typeof key !== 'string' || !Object.hasOwn(byKey, key)) return undefined;
  const s = byKey[key];
  if (!s || typeof s.type !== 'string') return undefined;
  const type = s.type;
  if (type === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (type === 'string') return typeof value === 'string' ? value : undefined;
  if (type === 'integer' || type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    const v = type === 'integer' ? Math.round(n) : n;
    if (s.range) return Math.min(s.range[1], Math.max(s.range[0], v));
    return v;
  }
  if (type === 'stringSet') {
    if (!Array.isArray(value)) return undefined;
    return [...new Set(value.filter((x) => typeof x === 'string').map((x) => x.toLowerCase()))].sort();
  }
  if (type.startsWith('enum:')) {
    const e = enums[type.slice(5)];
    return e && e.values.includes(value) ? value : undefined;
  }
  if (type === 'object:ToolbarConfig') return validateToolbar(value);
  return undefined;
}

function validateToolbar(v) {
  if (!v || typeof v !== 'object') return undefined;
  if (v.preset && !v.bar) return presetConfig(v.preset);
  const { enums } = describe();
  const ids = new Set(contract.toolbarActions().actions.filter((a) => a.status === 'shipped').map((a) => a.id));
  const fix = (list, inMenu) => (Array.isArray(list) ? list : [])
    .filter((s) => s && ids.has(s.action) && (!inMenu || (s.action !== 'menu' && s.action !== 'address')))
    .map((s) => slot(s.action, enums.ButtonSize.values.includes(s.size) ? s.size : 'medium', s.showsLabel !== false));
  return {
    bar: fix(v.bar, false),
    menu: fix(v.menu, true),
    style: enums.ToolbarStyle.values.includes(v.style) ? v.style : 'floating',
    position: enums.ToolbarPosition.values.includes(v.position) ? v.position : 'top',
    preset: typeof v.preset === 'string' ? v.preset : undefined,
  };
}

/** Fusionne un objet lu sur disque avec les défauts : clé inconnue conservée, valeur invalide remplacée. */
function sanitize(raw) {
  const out = defaults();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const ok = validate(k, v);
    if (ok !== undefined) out[k] = ok;
    else if (!Object.hasOwn(out, k)) out[k] = v; // clé d'une autre plateforme ou d'une version future : conservée telle quelle
  }
  return out;
}

module.exports = { describe, defaults, validate, sanitize, presetConfig, defaultToolbar, DESKTOP_DEFAULTS };
