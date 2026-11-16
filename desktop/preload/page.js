'use strict';
// Préchargement de chaque page web (monde isolé, bac à sable) : informations de page portées de Scripts.swift
// (temps de lecture à 200 mots/min, couleur du site, icône) et signal de défilement pour le faux verre.
// Aucune API n'est exposée aux pages : seul ipcRenderer.send vers le processus principal est utilisé.
const { ipcRenderer } = require('electron');

function count(t) { return (t || '').split(/\s+/).filter(Boolean).length; }

/** Couleur normalisée en rgb() (theme-color selon le mode, sinon fond de la page), comme Scripts.kt. */
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
  return empty(c) ? '' : c;
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

// Défilement : au plus un signal toutes les 100 ms, puis un dernier à l'arrêt (le processus principal capture la page).
let lastScroll = 0;
let idle = null;
window.addEventListener('scroll', () => {
  const now = performance.now();
  if (now - lastScroll >= 100) { lastScroll = now; ipcRenderer.send('qafila:page:scroll', { final: false }); }
  clearTimeout(idle);
  idle = setTimeout(() => ipcRenderer.send('qafila:page:scroll', { final: true }), 150);
}, { passive: true, capture: true });

// Le thème du système change : la couleur du site (theme-color avec media) peut changer avec lui.
try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(pageInfo, 50)); } catch { /* ignoré */ }

// Boutons latéraux de la souris (Précédent / Suivant). Sous Windows, l'événement « app-command » de la fenêtre s'en
// charge déjà (main/index.js) : ne pas naviguer deux fois.
if (process.platform !== 'win32') {
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    ipcRenderer.send('qafila:page:nav', { dir: e.button === 3 ? 'back' : 'forward' });
  }, true);
}
