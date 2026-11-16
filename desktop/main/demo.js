'use strict';
// Mode démo (captures d'écran) : les mêmes onglets et favoris que le mode démo iOS/Android (BrowserStore).
const DEMO_TABS = [
  ['https://fr.wikipedia.org/wiki/Caravane_(convoi)', 'Caravane (convoi) — Wikipédia', 19],
  ['https://fr.wikipedia.org/wiki/Route_de_la_soie', 'Route de la soie — Wikipédia', 24],
  ['https://fr.wikipedia.org/wiki/Sahara', 'Sahara — Wikipédia', 41],
  ['https://www.lemonde.fr/sciences/', 'Sciences — Le Monde', 6],
  ['https://www.marmiton.org/recettes/recette_pate-a-crepes_12372.aspx', 'La meilleure recette de pâte à crêpes', 4],
  ['https://www.marmiton.org/recettes/recette_gateau-au-chocolat-fondant-rapide_166352.aspx', 'Gâteau au chocolat fondant rapide', 3],
  ['https://github.com/Fefe-Kurylen/qafila', 'Fefe-Kurylen/qafila · GitHub', 2],
  ['https://www.openstreetmap.org', 'OpenStreetMap', 1],
];

const DEMO_BOOKMARKS = [
  ['Wikipédia', 'https://fr.wikipedia.org'], ['Le Monde', 'https://www.lemonde.fr'], ['OpenStreetMap', 'https://www.openstreetmap.org'],
  ['GitHub', 'https://github.com'], ['Marmiton', 'https://www.marmiton.org'], ['Arte', 'https://www.arte.tv'],
];

/** Remplit le store avec les données de démonstration (réglages par défaut, éventuellement sombres). */
function applyDemo(store, { dark = false, screen = 'page', language = 'fr' } = {}) {
  const now = Date.now();
  const { uuid } = require('./store');
  store.tabs = DEMO_TABS.map(([url, title, minutes], i) => ({
    id: uuid(), url, title, isPrivate: false, createdAt: now - i * 600_000, lastVisited: now - i * 600_000,
    readingMinutes: minutes, faviconURL: null, themeColorHex: null,
  }));
  if (screen === 'start') store.tabs.unshift({ id: uuid(), url: null, title: '', isPrivate: false, createdAt: now, lastVisited: now, readingMinutes: 0, faviconURL: null, themeColorHex: null });
  store.selected = store.tabs[0].id;
  store.bookmarks = DEMO_BOOKMARKS.map(([title, url], i) => ({ id: uuid(), title, url, addedAt: now - i * 1000 }));
  store.history = [];
  const settingsSchema = require('./settings');
  store.settings = settingsSchema.defaults();
  if (dark) store.settings.appearance = 'dark';
  // Les captures de démonstration sont en français comme sur mobile (--lang=en|ar|es|de pour les autres langues).
  if (['fr', 'en', 'ar', 'es', 'de'].includes(language)) store.settings.language = language;
  if (screen === 'grid') store.settings.tabsLayout = 'grid';
  store.scheduleSave();
}

module.exports = { DEMO_TABS, DEMO_BOOKMARKS, applyDemo };
