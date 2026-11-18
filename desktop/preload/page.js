'use strict';
// Préchargement de chaque page web (monde isolé, bac à sable) : informations de page portées de Scripts.swift
// (temps de lecture à 200 mots/min, couleur du site, icône) et signal de défilement pour le faux verre.
// Aucune API n'est exposée aux pages : seul ipcRenderer.send vers le processus principal est utilisé.
const { ipcRenderer, contextBridge } = require('electron');

// Pages de Google : objet window.chrome présent comme dans Google Chrome (sans lui, la connexion Google prend Qafila
// pour une application intégrée non sécurisée). Objet inerte : aucune fonction ne donne accès à quoi que ce soit.
if (/(^|\.)(google\.com|youtube\.com)$/.test(location.hostname)) {
  const t0 = Date.now() / 1000;
  try {
    contextBridge.exposeInMainWorld('chrome', {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null, getIsInstalled: () => false, runningState: () => 'cannot_run',
      },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      },
      loadTimes: () => ({ requestTime: t0, startLoadTime: t0, commitLoadTime: t0, finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }),
      csi: () => ({ startE: Math.round(t0 * 1000), onloadT: Date.now(), pageT: Date.now() - t0 * 1000, tran: 15 }),
    });
  } catch { /* window.chrome déjà présent */ }
}

function count(t) { return (t || '').split(/\s+/).filter(Boolean).length; }

/** Convertit une couleur calculée « rgb(r, g, b) » / « rgba(r, g, b, a) » en « #rrggbb » ; '' si illisible ou trop transparente (alpha < 0,5). */
function toHex(c) {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(String(c || '').trim());
  if (!m) return '';
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4] && m[4].endsWith('%')) a /= 100;
  if (!(a >= 0.5)) return '';
  return '#' + [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))).toString(16).padStart(2, '0')).join('');
}

/** Couleur du site en « #rrggbb » (theme-color selon le mode, sinon fond de la page), comme Scripts.kt. */
function pageColor() {
  function norm(c) {
    if (!c) return '';
    const d = document.createElement('div');
    d.style.color = c;
    (document.body || document.documentElement).appendChild(d);
    const r = getComputedStyle(d).color;
    d.remove();
    return r;
  }
  function empty(c) { return !c || c === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(c); }
  let c = '';
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  for (const m of metas) {
    const media = m.getAttribute('media');
    if (!media || window.matchMedia(media).matches) { c = m.getAttribute('content') || ''; break; }
  }
  c = norm(c);
  if (empty(c) && document.body) {
    c = getComputedStyle(document.body).backgroundColor;
    if (empty(c)) c = getComputedStyle(document.documentElement).backgroundColor;
  }
  return empty(c) ? '' : toHex(c);
}

let lastInfo = '';
function pageInfo() {
  try {
    const root = document.querySelector('#mw-content-text, article, main, [role=main]') || document.body;
    if (!root) return;
    // Seuls les paragraphes comptent (pas les références, tableaux ni menus).
    let words = count(Array.prototype.map.call(root.querySelectorAll('p'), (p) => p.textContent).join(' '));
    if (words < 60) words = count(root.textContent);
    let icon = '';
    const links = document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]');
    for (const l of links) { if (l.href) { icon = l.href; if (/apple-touch/.test(l.rel)) break; } }
    const info = { minutes: Math.max(0, Math.round(words / 200)), color: pageColor(), icon, url: location.href };
    const key = JSON.stringify(info);
    if (key === lastInfo) return;
    lastInfo = key;
    ipcRenderer.send('qafila:page:info', info);
  } catch { /* page hostile ou en cours de destruction : silencieux */ }
}

window.addEventListener('DOMContentLoaded', () => { pageInfo(); setTimeout(pageInfo, 1500); setTimeout(pageInfo, 5000); });
window.addEventListener('load', pageInfo);

// Défilement : au plus un signal toutes les 100 ms, puis un dernier à l'arrêt (le processus principal capture la page
// pour le faux verre et, en Réduire / Masquer, replie ou rouvre la barre selon le sens : y = scrollY, dy = écart).
let lastScroll = 0;
let lastY = window.scrollY || 0;
let idle = null;
function sendScroll(final) {
  const y = Math.round(window.scrollY || 0);
  ipcRenderer.send('qafila:page:scroll', { final, y, dy: y - lastY });
  lastY = y;
}
window.addEventListener('scroll', () => {
  const now = performance.now();
  if (now - lastScroll >= 100) { lastScroll = now; sendScroll(false); }
  clearTimeout(idle);
  idle = setTimeout(() => sendScroll(true), 150);
}, { passive: true, capture: true });

// Masquer : la souris touche le bord haut ou bas de la page → la barre peut revenir (au plus un signal / 300 ms).
let lastEdge = 0;
window.addEventListener('mousemove', (e) => {
  const edge = e.clientY <= 2 ? 'top' : e.clientY >= window.innerHeight - 3 ? 'bottom' : null;
  if (!edge || performance.now() - lastEdge < 300) return;
  lastEdge = performance.now();
  ipcRenderer.send('qafila:page:edge', { edge });
}, { passive: true, capture: true });

// Le thème du système change : la couleur du site (theme-color avec media) peut changer avec lui.
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(pageInfo, 50)); } catch { /* ignoré */ }

// Boutons latéraux de la souris (Précédent / Suivant), macOS seulement : sous Windows et Linux, l'événement
// « app-command » de la fenêtre s'en charge déjà (main/index.js) ; ne pas naviguer deux fois.
if (process.platform === 'darwin') {
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    ipcRenderer.send('qafila:page:nav', { dir: e.button === 3 ? 'back' : 'forward' });
  }, true);
}
