'use strict';
// Moteurs de recherche et suggestions : mêmes gabarits d'URL que Settings.swift. Les noms affichés viennent de
// l'i18n (clés engine_<id>), jamais de `label` (simple nom de marque, absent pour « custom »).

const ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: (q) => `https://duckduckgo.com/?q=${q}`, home: 'https://duckduckgo.com' },
  kagi: { label: 'Kagi', url: (q) => `https://kagi.com/search?q=${q}`, home: 'https://kagi.com' },
  qwant: { label: 'Qwant', url: (q) => `https://www.qwant.com/?q=${q}`, home: 'https://www.qwant.com' },
  brave: { label: 'Brave Search', url: (q, s) => `https://search.brave.com/search?q=${q}${s.hideAIAnswers ? '&summary=0' : ''}`, home: 'https://search.brave.com' },
  startpage: { label: 'Startpage', url: (q) => `https://www.startpage.com/do/search?q=${q}`, home: 'https://www.startpage.com' },
  ecosia: { label: 'Ecosia', url: (q) => `https://www.ecosia.org/search?q=${q}`, home: 'https://www.ecosia.org' },
  google: { label: 'Google', url: (q, s) => `https://www.google.com/search?q=${q}${s.hideAIAnswers ? '&udm=14' : ''}`, home: 'https://www.google.com' },
  bing: { label: 'Bing', url: (q) => `https://www.bing.com/search?q=${q}`, home: 'https://www.bing.com' },
  searxng: { label: 'SearXNG', url: (q, s) => `${base(s) || 'https://searx.be'}/search?q=${q}`, home: (s) => base(s) || 'https://searx.be' },
  qafila: { label: 'Qafila', url: (q, s) => `${base(s) || 'https://qafila.example.com'}/?q=${q}`, home: (s) => base(s) || 'https://qafila.example.com' },
  custom: { url: (q, s) => (s.customSearchTemplate.includes('%s') ? s.customSearchTemplate : 'https://duckduckgo.com/?q=%s').replace('%s', q), home: 'https://duckduckgo.com' },
};

function base(s) { return String(s.searchBaseURL || '').replace(/^[\s/]+|[\s/]+$/g, ''); }

/** Caractères laissés tels quels (alphanumériques et -._~) ; tout le reste est encodé pour arriver intact au moteur. */
function encodeQuery(q) { return encodeURIComponent(q).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }

function searchURL(query, settings) {
  const e = ENGINES[settings.searchEngine] || ENGINES.google;
  return e.url(encodeQuery(query), settings);
}

function engineHome(settings) {
  const e = ENGINES[settings.searchEngine] || ENGINES.google;
  return typeof e.home === 'function' ? e.home(settings) : e.home;
}

/** Préfixe d'URL des suggestions (la requête encodée est ajoutée) ; null = pas de suggestions distantes. */
function suggestURL(settings) {
  switch (settings.searchEngine) {
    case 'qafila': return base(settings) ? base(settings) + '/api/suggest?q=' : null;
    case 'google': return 'https://suggestqueries.google.com/complete/search?client=firefox&q=';
    case 'bing': return 'https://api.bing.com/osjson.aspx?query=';
    default: return 'https://duckduckgo.com/ac/?type=list&q=';
  }
}

/** Saisie de l'adresse → URL : schéma connu, hôte probable, sinon recherche. */
function urlFromInput(raw, settings) {
  const t = String(raw || '').trim();
  if (!t) return null;
  // file: est rendu tel quel pour que l'onglet affiche « fichiers locaux refusés » (TabManager.open), jamais chargé.
  if (/^(https?|about|data|qafila):/i.test(t) || /^file:/i.test(t)) return t;
  const looksLikeHost = !/\s/.test(t) && t.includes('.') && !t.endsWith('.') && !/^[.]/.test(t);
  if (looksLikeHost || /^localhost(:\d+)?(\/|$)/.test(t)) return (settings.upgradeToHTTPS ? 'https://' : 'http://') + t;
  return searchURL(t, settings);
}

/** Adresse du « nouvel onglet » selon le réglage (null = page de démarrage locale). */
function newTabURL(settings) {
  switch (settings.newTabPage) {
    case 'blank': return 'about:blank';
    case 'search': return engineHome(settings);
    case 'custom': return settings.newTabCustomURL || null;
    default: return null;
  }
}

module.exports = { ENGINES, searchURL, suggestURL, urlFromInput, newTabURL, engineHome, encodeQuery };
