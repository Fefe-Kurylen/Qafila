'use strict';
// Chaînes de l'interface : desktop/i18n/<lang>.json (générés depuis les strings.xml Android), repli sur le français.
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = ['fr', 'en', 'ar', 'es', 'de'];
const RTL = new Set(['ar']);
const dir = path.join(__dirname, '..', 'i18n');
const cache = new Map();

function table(lang) {
  if (!cache.has(lang)) {
    let base = {};
    let extra = {};
    try { base = JSON.parse(fs.readFileSync(path.join(dir, `${lang}.json`), 'utf8')); } catch { base = {}; }
    // Chaînes propres au PC (i18n/extra), par-dessus celles générées depuis Android.
    try { extra = JSON.parse(fs.readFileSync(path.join(dir, 'extra', `${lang}.json`), 'utf8')); } catch { extra = {}; }
    delete extra.$comment;
    cache.set(lang, { ...base, ...extra });
  }
  return cache.get(lang);
}

/** Langue effective : réglage « Langue » s'il est fixé, sinon la langue du système ramenée aux cinq proposées. */
function resolveLanguage(preferred, systemLocale) {
  const want = (preferred || systemLocale || 'fr').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED.includes(want) ? want : 'fr';
}

/** Remplace les gabarits Android (%d, %s, %1$d, %2$s, %%) par les arguments. */
function format(template, args) {
  let i = 0;
  return String(template).replace(/%(\d+\$)?([ds])|%%/g, (m, pos) => {
    if (m === '%%') return '%';
    const idx = pos ? parseInt(pos, 10) - 1 : i++;
    return args[idx] === undefined ? '' : String(args[idx]);
  });
}

function pluralForm(lang, n) {
  if (lang === 'fr') return n <= 1 ? 'one' : 'many';
  if (lang === 'ar') return n === 1 ? 'one' : n === 2 ? 'two' : 'other';
  return n === 1 ? 'one' : 'other';
}

/** Crée un traducteur pour une langue : t(clé, ...args) ; les pluriels prennent le nombre en premier argument. */
function translator(lang) {
  const primary = table(lang);
  const fallback = table('fr');
  const t = (key, ...args) => {
    let v = primary[key] ?? fallback[key];
    if (v === undefined) return key;
    if (typeof v === 'object') {
      const n = Number(args[0]) || 0;
      v = v[pluralForm(lang, n)] ?? v.other ?? v.many ?? v.one ?? '';
    }
    return args.length ? format(v, args) : v;
  };
  t.lang = lang;
  t.rtl = RTL.has(lang);
  t.all = () => ({ ...fallback, ...primary });
  return t;
}

module.exports = { SUPPORTED, RTL, resolveLanguage, translator, format };
