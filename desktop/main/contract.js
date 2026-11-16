'use strict';
// Le contrat partagé (shared/toolbar-actions.json, shared/settings-keys.json) est lu directement :
// en développement depuis ../shared, une fois empaqueté depuis resources/shared (extraResources d'electron-builder).
// Pour basculer vers une copie locale, il suffit d'ajouter son dossier en tête de `candidates`.
const fs = require('node:fs');
const path = require('node:path');

function candidates() {
  const list = [];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'shared'));
  list.push(path.join(__dirname, '..', '..', 'shared'));
  list.push(path.join(__dirname, '..', 'config'));
  return list;
}

function readJSON(name) {
  for (const dir of candidates()) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  throw new Error(`Contrat partagé introuvable : ${name}`);
}

function readText(name) {
  for (const dir of candidates()) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return null;
}

/** Relit un fichier du contrat à chaque appel (support.json peut changer sans redémarrage en développement). */
function readJSONFresh(name) { return readJSON(name); }

let toolbar = null;
let settings = null;

module.exports = {
  /** Actions, menu standard et presets (toolbar-actions.json). */
  toolbarActions() { return toolbar || (toolbar = readJSON('toolbar-actions.json')); },
  /** Clés de réglages, types, défauts et enums (settings-keys.json). */
  settingsKeys() { return settings || (settings = readJSON('settings-keys.json')); },
  readJSONFresh,
  /** Script de contenu des formulaires (phase 1, non encore injecté en v1). */
  formsScript() { return readText('qafila-forms.js'); },
};
