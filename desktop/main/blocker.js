'use strict';
// Bloqueur : annule les requêtes tierces vers les domaines publicitaires / de traçage / de bandeaux (session.webRequest)
// et masque par CSS les emplacements publicitaires et les bandeaux de cookies. Trois interrupteurs comme sur mobile,
// plus des exceptions par site (blockerDisabledHosts).
const lists = require('../blocker/lists.json');

const adSet = new Set(lists.ads);
const trackerSet = new Set(lists.trackers);
const cookieSet = new Set(lists.cookies);

/** Hôte (ou domaine parent) dans une famille active ? Parcourt les suffixes sans allouer par domaine. */
function family(host) {
  if (!host) return null;
  const h = host.toLowerCase();
  let i = 0;
  for (;;) {
    const d = i === 0 ? h : h.slice(i);
    if (adSet.has(d)) return 'ads';
    if (trackerSet.has(d)) return 'trackers';
    if (cookieSet.has(d)) return 'cookies';
    i = h.indexOf('.', i);
    if (i < 0 || i === h.length - 1) return null;
    i++;
  }
}

/** Domaine enregistrable approximatif (deux étiquettes, trois pour les suffixes du type co.uk / com.br). */
function baseDomain(host) {
  if (!host) return '';
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const sld = parts[parts.length - 2];
  const n = /^(co|com|org|net|gov|edu|ac|gouv)$/.test(sld) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-n).join('.');
}

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

const cookieCSS = lists.cookieSelectors.join(', ') + ' { display: none !important; visibility: hidden !important; }\nhtml, body { overflow: auto !important; position: static !important; }';
const adCSS = lists.adSelectors.join(', ') + ' { display: none !important; }';

class Blocker {
  /**
   * @param {() => object} getSettings réglages courants
   * @param {(wcId:number) => string|null} pageURLFor adresse de la page du webContents (première partie)
   */
  constructor(getSettings, pageURLFor) {
    this.getSettings = getSettings;
    this.pageURLFor = pageURLFor;
    this.blocked = new Map(); // webContentsId → nombre de requêtes bloquées sur la page courante
  }

  /** Le bloqueur est-il actif pour cette page (réglages + exceptions) ? */
  isActive(pageURL) {
    const s = this.getSettings();
    if (!(s.blockAds || s.blockTrackers || s.blockCookieBanners)) return false;
    const h = hostOf(pageURL || '');
    return !h || !(s.blockerDisabledHosts || []).includes(h.toLowerCase());
  }

  /**
   * Décision pour une requête (appelée par l'unique gestionnaire onBeforeRequest de la session, voir tabs.js :
   * Electron n'accepte qu'un seul écouteur par événement webRequest). Renvoie true si la requête doit être annulée.
   */
  shouldBlock(details) {
    if (details.resourceType === 'mainFrame') return false;
    const s = this.getSettings();
    const fam = family(hostOf(details.url));
    if (!fam) return false;
    if ((fam === 'ads' && !s.blockAds) || (fam === 'trackers' && !s.blockTrackers) || (fam === 'cookies' && !s.blockCookieBanners)) return false;
    const page = this.pageURLFor(details.webContentsId) || details.referrer || '';
    if (!this.isActive(page)) return false;
    // Première partie : un site ne se bloque pas lui-même (ex. onetrust.com visité directement).
    if (page && baseDomain(hostOf(page)) === baseDomain(hostOf(details.url))) return false;
    this.blocked.set(details.webContentsId, (this.blocked.get(details.webContentsId) || 0) + 1);
    return true;
  }

  /** CSS à injecter au dom-ready d'une page (bandeaux de cookies, emplacements publicitaires). */
  cssFor(pageURL) {
    if (!this.isActive(pageURL)) return '';
    const s = this.getSettings();
    return (s.blockCookieBanners ? cookieCSS + '\n' : '') + (s.blockAds ? adCSS : '');
  }

  resetCount(wcId) { this.blocked.set(wcId, 0); }
  count(wcId) { return this.blocked.get(wcId) || 0; }
  forget(wcId) { this.blocked.delete(wcId); }
}

module.exports = { Blocker, family, baseDomain, lists };
