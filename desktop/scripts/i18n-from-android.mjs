#!/usr/bin/env node
// Génère desktop/i18n/{fr,en,ar,es,de}.json depuis les strings.xml Android (clé = nom de la chaîne Android).
// Les pluriels deviennent des objets { one, many, other } ; les séquences Android (\', \n, %1$d) sont conservées
// telles quelles sauf les échappements de guillemets. Aucune dépendance : analyse par expressions régulières.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const res = resolve(here, '..', '..', 'android-browser', 'app', 'src', 'main', 'res');
const out = resolve(here, '..', 'i18n');
// Langue → dossier de ressources Android. Le français est la langue de développement (values/).
const locales = { fr: 'values', en: 'values-en', ar: 'values-ar', es: 'values-es', de: 'values-de' };

/** Décode les entités XML et les échappements Android d'une valeur de chaîne. */
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\@/g, '@').replace(/\\\?/g, '?')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
}

function parse(xml) {
  const strings = {};
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) strings[m[1]] = decode(m[2]);
  for (const m of xml.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    const forms = {};
    for (const i of m[2].matchAll(/<item\s+quantity="([^"]+)"[^>]*>([\s\S]*?)<\/item>/g)) forms[i[1]] = decode(i[2]);
    strings[m[1]] = forms;
  }
  return strings;
}

mkdirSync(out, { recursive: true });
const base = parse(readFileSync(join(res, 'values', 'strings.xml'), 'utf8'));
for (const [lang, dir] of Object.entries(locales)) {
  let table = base;
  if (dir !== 'values') {
    try { table = parse(readFileSync(join(res, dir, 'strings.xml'), 'utf8')); } catch { table = {}; }
  }
  // Seules les clés traduites sont écrites : le français (langue de repli) complète le reste au chargement.
  const sorted = Object.fromEntries(Object.keys(table).sort().map((k) => [k, table[k]]));
  writeFileSync(join(out, `${lang}.json`), JSON.stringify(sorted, null, 2) + '\n');
  console.log(`${lang}: ${Object.keys(sorted).length} chaînes`);
}
