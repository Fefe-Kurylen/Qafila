'use strict';
// Scripts et pages locales portés de Scripts.swift / Scripts.kt : lecteur, assombrissement, page de démarrage, page d'erreur.
// (Le calcul temps de lecture / couleur / favicon vit dans preload/page.js, exécuté dans chaque page.)

/** Mode sombre pour tous les sites : inversion douce, images et vidéos préservées (identique au mobile). */
const darkenCSS = `html { filter: invert(0.92) hue-rotate(180deg) !important; background: #111 !important; }
img, video, canvas, picture, svg, iframe, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`;

/** Lecteur : extrait l'article principal (heuristique simple inspirée de Readability) ; renvoie du JSON ou null. */
const reader = `(function(){
  function score(el){ var t=(el.innerText||'').trim(); var p=el.querySelectorAll('p').length; return t.length + p*80 - el.querySelectorAll('a').length*30; }
  var candidates = Array.from(document.querySelectorAll('article, main, [role=main], .post, .article, .entry-content, .post-content, #content, .content'));
  var best = null, bestScore = 0;
  candidates.forEach(function(c){ var s = score(c); if (s > bestScore) { bestScore = s; best = c; } });
  if (!best) { var ps = Array.from(document.querySelectorAll('p')); var map = new Map(); ps.forEach(function(p){ var par = p.parentElement; map.set(par, (map.get(par)||0) + (p.innerText||'').length); }); map.forEach(function(v,k){ if (v > bestScore) { bestScore = v; best = k; } }); }
  if (!best) return null;
  var clone = best.cloneNode(true);
  clone.querySelectorAll('script, style, nav, aside, footer, form, iframe, .share, .social, .ad, .ads, [class*="related"], [class*="comment"]').forEach(function(e){ e.remove(); });
  var title = (document.querySelector('h1') || {}).innerText || document.title;
  var byline = (document.querySelector('[rel=author], .author, .byline') || {}).innerText || '';
  return JSON.stringify({ title: title, byline: byline, html: clone.innerHTML, host: location.host, url: location.href });
})();`;

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Page du lecteur (mêmes couleurs et gabarit que le mobile). */
function readerPage({ title, byline, html, host }, dark) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
body { margin: 0 auto; padding: 24px 20px 60px; font: 19px/1.6 Georgia, "Iowan Old Style", "Times New Roman", serif; background: ${dark ? '#141416' : '#fbfaf7'}; color: ${dark ? '#ececec' : '#1b1b1b'}; max-width: 680px; }
h1 { font: 700 30px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 0 8px; }
.meta { color: #888; font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; margin-bottom: 28px; }
img, video { max-width: 100%; height: auto; border-radius: 10px; }
a { color: ${dark ? '#8fb0ff' : '#004fd6'}; }
pre { white-space: pre-wrap; font-size: 15px; }
</style></head><body><h1>${escape(title)}</h1><div class="meta">${byline ? escape(byline) + ' · ' : ''}${escape(host)}</div>${html}</body></html>`;
}

/** Page de démarrage locale : « Qafila » en serif, « قافلة » en gris, tuiles de favoris (aucune requête réseau). */
function startPage({ dark, bookmarks = [], title = 'Qafila', rtl = false, lang = 'fr' }) {
  const tiles = bookmarks.slice(0, 12).map((b) => {
    const letter = String(b.title || '').trim().slice(0, 1).toUpperCase();
    return `<a class="tile" href="${escape(b.url)}"><span class="ic">${escape(letter)}</span><span class="t">${escape(b.title)}</span></a>`;
  }).join('');
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; --bg: ${dark ? '#000000' : '#ffffff'}; --fg: ${dark ? '#f2f2f7' : '#1c1c1e'}; --tile: ${dark ? '#1c1c1e' : '#f2f2f7'}; --tilefg: ${dark ? '#d1d1d6' : '#3a3a3c'}; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); }
.head { margin-top: 26vh; text-align: center; }
h1 { font-family: "New York", "Iowan Old Style", Georgia, "Times New Roman", serif; font-weight: 500; font-size: 40px; letter-spacing: -.02em; margin: 0; }
.ar { font-family: "Geeza Pro", "Damascus", "Noto Naskh Arabic", serif; font-size: 19px; color: #8e8e93; margin-top: 2px; }
.grid { display: grid; grid-template-columns: repeat(6, 72px); gap: 18px 14px; margin-top: 44px; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 7px; text-decoration: none; color: inherit; }
.ic { width: 56px; height: 56px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font: 500 22px "New York", Georgia, serif; background: var(--tile); color: var(--tilefg); }
.t { font-size: 11px; color: #8e8e93; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style></head><body><div class="head"><h1>Qafila</h1><div class="ar" lang="ar" dir="rtl">قافلة</div></div>
<div class="grid">${tiles}</div></body></html>`;
}

/** Page d'erreur dans la langue de l'interface ; l'adresse reste de gauche à droite. */
function errorPage({ title, message, url, lang = 'fr', rtl = false, dark = false }) {
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:24px;background:${dark ? '#000000' : '#ffffff'};color:${dark ? '#f2f2f7' : '#1c1c1e'}}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#8e8e93;font-size:15px;max-width:360px}</style>
</head><body><h1>${escape(title)}</h1><p dir="auto">${escape(message)}</p><p dir="ltr" style="font-size:13px;word-break:break-all">${escape(url)}</p></body></html>`;
}

/** Page d'article locale du mode démo hors ligne (captures d'écran reproductibles sans réseau). */
function demoArticle({ title, host, minutes, dark }) {
  const paras = [];
  const n = Math.max(3, Math.min(14, minutes));
  for (let i = 0; i < n; i++) {
    paras.push(`<p>Une caravane est un convoi de marchandises ou un groupe de personnes voyageant ensemble, essentiellement dans le cadre d'une expédition commerciale. Les caravanes ont été utilisées principalement dans les zones désertiques du Sahara ou de la péninsule arabique et tout au long de la route de la soie, où le voyage en groupe permettait de se défendre contre les brigands et de partager l'eau, les vivres et les bêtes de somme. Les étapes se faisaient de puits en puits, de caravansérail en caravansérail.</p>`);
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escape(title)}</title>
<link rel="icon" href="data:,">
<style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;font:17px/1.65 Georgia,"Times New Roman",serif;background:${dark ? '#101012' : '#ffffff'};color:${dark ? '#e8e8ea' : '#202122'}}
header{position:sticky;top:0;background:${dark ? '#1c1c1e' : '#f8f9fa'};border-bottom:1px solid ${dark ? '#333' : '#e5e5e5'};padding:14px 32px;font:600 22px/1 "Linux Libertine",Georgia,serif;letter-spacing:.02em}
main{max-width:760px;margin:0 auto;padding:32px 24px 120px}h1{font:400 34px/1.2 "Linux Libertine",Georgia,serif;border-bottom:1px solid ${dark ? '#333' : '#a2a9b1'};padding-bottom:6px;margin:0 0 6px}.sub{color:#8e8e93;font:14px system-ui,sans-serif;margin-bottom:24px}
.box{background:${dark ? '#1b1b1f' : '#f3f6ff'};border-left:4px solid #3366cc;padding:10px 14px;margin:0 0 18px;font:15px system-ui,sans-serif}a{color:#3366cc;text-decoration:none}</style></head>
<body><header>${escape(host)}</header><main><h1>${escape(title.replace(/ — .*$/, ''))}</h1><div class="sub">${escape(host)} · ${minutes} min de lecture</div>
<div class="box">Pour les articles homonymes, voir <a href="#">Caravane</a>.</div>${paras.join('')}</main></body></html>`;
}

module.exports = { darkenCSS, reader, readerPage, startPage, errorPage, demoArticle, escape };
