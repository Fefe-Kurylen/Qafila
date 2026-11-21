'use strict';
const LOGO = require('./logo');
// Scripts et pages locales portés de Scripts.swift / Scripts.kt : lecteur, assombrissement, page de démarrage, page d'erreur.
// (Le calcul temps de lecture / couleur / favicon vit dans preload/page.js, exécuté dans chaque page.)

/** Mode sombre pour tous les sites : inversion douce, images et vidéos préservées (identique au mobile). */
const darkenCSS = `html { filter: invert(0.92) hue-rotate(180deg) !important; background: #111 !important; }
img, video, canvas, picture, svg, iframe, [style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`;

/**
 * Lecteur : extrait l'article principal (heuristique simple inspirée de Readability).
 * Exécuté dans un MONDE ISOLÉ (executeJavaScriptInIsolatedWorld) : la page ne peut ni remplacer JSON, ni détourner les
 * prototypes du DOM vus par ce script. Ne renvoie jamais de HTML : un arbre { t, a, c } (balise, attributs, enfants)
 * ou du texte, que le processus principal re-filtre et sérialise lui-même (renderReaderTree). Adresses rendues absolues.
 */
const reader = `(function(){
  function score(el){ var t=(el.innerText||'').trim(); var p=el.querySelectorAll('p').length; return t.length + p*80 - el.querySelectorAll('a').length*30; }
  var candidates = Array.from(document.querySelectorAll('article, main, [role=main], .post, .article, .entry-content, .post-content, #content, .content'));
  var best = null, bestScore = 0;
  candidates.forEach(function(c){ var s = score(c); if (s > bestScore) { bestScore = s; best = c; } });
  if (!best) { var ps = Array.from(document.querySelectorAll('p')); var map = new Map(); ps.forEach(function(p){ var par = p.parentElement; map.set(par, (map.get(par)||0) + (p.innerText||'').length); }); map.forEach(function(v,k){ if (v > bestScore) { bestScore = v; best = k; } }); }
  if (!best) return null;
  var SKIP = /^(script|style|noscript|template|nav|aside|footer|form|iframe|frame|frameset|object|embed|applet|svg|math|button|input|select|textarea|canvas|video|audio|source|track|link|meta|base|dialog|slot)$/;
  var DROP = /(^|\\s)(share|social|ad|ads)(\\s|$)|related|comment/i;
  var budget = 30000;
  // Titre et signature sont affichés par l'en-tête du lecteur : le h1 du titre, l'élément de signature et une ligne
  // de sous-titre juste après le h1 (domaine, date, temps de lecture…) ne sont pas repris dans l'article.
  var titleEl = document.querySelector('h1');
  var bylineEl = document.querySelector('[rel=author], .author, .byline');
  var skipEls = [titleEl, bylineEl];
  var next = titleEl && titleEl.nextElementSibling;
  if (next && /(^|[\s_-])(sub|subtitle|byline|meta|author|dateline|date)([\s_-]|$)/i.test(next.getAttribute('class') || '') && (next.innerText || '').length < 200) skipEls.push(next);
  function abs(u){ try { return new URL(u, document.baseURI).href; } catch (e) { return ''; } }
  function walk(node, depth){
    if (--budget <= 0 || depth > 60) return null;
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return null;
    var tag = String(node.localName || '').toLowerCase();
    if (SKIP.test(tag)) return null;
    if (depth > 0 && skipEls.indexOf(node) >= 0) return null;
    var cls = node.getAttribute('class') || '';
    if (depth > 0 && DROP.test(cls)) return null;
    var a = {};
    if (tag === 'a' && node.hasAttribute('href')) a.href = abs(node.getAttribute('href'));
    if (tag === 'img') { var src = node.currentSrc || node.getAttribute('src') || node.getAttribute('data-src') || ''; if (src) a.src = abs(src); a.alt = node.getAttribute('alt') || ''; }
    if (tag === 'td' || tag === 'th') { if (node.hasAttribute('colspan')) a.colspan = node.getAttribute('colspan'); if (node.hasAttribute('rowspan')) a.rowspan = node.getAttribute('rowspan'); }
    var c = [];
    for (var k = node.firstChild; k; k = k.nextSibling) { var r = walk(k, depth + 1); if (r !== null && r !== '') c.push(r); }
    return { t: tag, a: a, c: c };
  }
  var tree = walk(best, 0);
  var title = (titleEl || {}).innerText || document.title;
  var byline = (bylineEl || {}).innerText || '';
  return JSON.stringify({ title: String(title || ''), byline: String(byline || ''), lang: String(document.documentElement.lang || ''), tree: tree });
})();`;

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ----- Liste blanche du lecteur : balises gardées (les autres sont déballées : seul leur contenu reste) -----
const READER_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'kbd', 'samp',
  'em', 'strong', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup', 'small', 'mark', 'q', 'cite', 'abbr', 'time', 'a', 'img',
  'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'dl', 'dt', 'dd', 'span',
  'div', 'section', 'article', 'header', 'main', 'picture',
]);
const READER_VOID = new Set(['br', 'hr', 'img']);
// Sous-arbres jetés entièrement (même s'ils arrivaient d'un moteur de rendu compromis).
const READER_DROP = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'svg', 'math', 'form', 'button', 'input', 'select', 'textarea', 'link', 'meta', 'base', 'title', 'head']);
const IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;

/** Lien sûr : http(s) ou mailto uniquement (jamais javascript:, data:, file:…). */
function safeHref(u) {
  try { const x = new URL(String(u)); return ['http:', 'https:', 'mailto:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
}
/** Image sûre : http(s), ou data:image matricielle (pas de SVG). */
function safeImageSrc(u) {
  const s = String(u || '');
  if (IMAGE_DATA.test(s) && s.length <= 2_000_000) return s;
  try { const x = new URL(s); return ['http:', 'https:'].includes(x.protocol) ? x.href : ''; } catch { return ''; }
}

/**
 * Sérialise l'arbre renvoyé par l'extracteur avec une liste blanche stricte de balises et d'attributs : aucun
 * attribut on*, aucun style, aucune adresse javascript:/data: (sauf data:image matricielle). Tout texte est échappé.
 */
function renderReaderTree(tree) {
  const out = [];
  let budget = 40000;
  const visit = (n, depth) => {
    if (--budget <= 0 || depth > 64 || n == null) return;
    if (typeof n === 'string') { out.push(escape(n.slice(0, 100000))); return; }
    if (typeof n !== 'object') return;
    const tag = String(n.t || '').toLowerCase();
    if (READER_DROP.has(tag)) return;
    const kids = Array.isArray(n.c) ? n.c : [];
    if (!READER_TAGS.has(tag)) { for (const k of kids) visit(k, depth + 1); return; }
    const a = n.a && typeof n.a === 'object' ? n.a : {};
    let attrs = '';
    if (tag === 'a') { const h = safeHref(a.href); if (h) attrs += ` href="${escape(h)}" rel="noreferrer"`; }
    if (tag === 'img') {
      const src = safeImageSrc(a.src);
      if (!src) return;
      attrs += ` src="${escape(src)}" alt="${escape(String(a.alt || '').slice(0, 500))}" loading="lazy" referrerpolicy="no-referrer"`;
    }
    if (tag === 'td' || tag === 'th') {
      for (const k of ['colspan', 'rowspan']) { const v = parseInt(a[k], 10); if (Number.isInteger(v) && v > 1 && v <= 100) attrs += ` ${k}="${v}"`; }
    }
    out.push(`<${tag}${attrs}>`);
    if (READER_VOID.has(tag)) return;
    for (const k of kids) visit(k, depth + 1);
    out.push(`</${tag}>`);
  };
  visit(tree, 0);
  return out.join('');
}

// Politiques de sécurité des pages locales : aucun script, aucune requête hors images (lecteur) ; origine opaque (data:).
const CSP_READER = "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const CSP_LOCAL = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const cspMeta = (csp) => `<meta http-equiv="Content-Security-Policy" content="${csp}">`;

/** Code de langue BCP 47 plausible (attribut lang de l'article), sinon ''. */
function safeLang(v) { const l = String(v || '').trim(); return /^[a-z]{2,3}(-[a-z0-9]{1,8}){0,3}$/i.test(l) ? l : ''; }

/** Page du lecteur (mêmes couleurs et gabarit que le mobile). `host` vient du processus principal, jamais de la page. */
function readerPage({ title, byline, tree, host, lang }, dark) {
  const l = safeLang(lang);
  return `<!doctype html><html${l ? ` lang="${l}"` : ''}><head><meta charset="utf-8">${cspMeta(CSP_READER)}<meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; }
body { margin: 0 auto; padding: 24px 20px 60px; font: 19px/1.6 Georgia, "Iowan Old Style", "Times New Roman", serif; background: ${dark ? '#141416' : '#fbfaf7'}; color: ${dark ? '#ececec' : '#1b1b1b'}; max-width: 680px; }
h1 { font: 700 30px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 0 8px; }
.meta { color: #888; font: 14px system-ui, -apple-system, "Segoe UI", sans-serif; margin-bottom: 28px; }
img, video { max-width: 100%; height: auto; border-radius: 10px; }
a { color: ${dark ? '#8fb0ff' : '#004fd6'}; }
pre { white-space: pre-wrap; font-size: 15px; }
</style></head><body><h1>${escape(title)}</h1><div class="meta">${byline ? escape(byline) + ' · ' : ''}${escape(host)}</div>${renderReaderTree(tree)}</body></html>`;
}

/**
 * Page de démarrage locale : logo de Qafila, tuiles des favoris de la racine, puis une section par dossier (ses
 * favoris et ceux de ses sous-dossiers). Aucune requête réseau. `classic` : style classique minimaliste (angles droits).
 */
function startPage({ dark, bg = null, bookmarks = [], folders = [], title = 'Qafila', rtl = false, lang = 'fr', privacy = '', classic = false }) {
  const tile = (b) => {
    const letter = String(b.title || '').trim().slice(0, 1).toUpperCase();
    return `<a class="tile" href="${escape(b.url)}" title="${escape(b.title)}"><span class="ic">${escape(letter)}</span><span class="t">${escape(b.title)}</span></a>`;
  };
  const ids = new Set(folders.map((f) => f.id));
  const rootMarks = bookmarks.filter((b) => !b.folder || !ids.has(b.folder)).slice(0, 12);
  const inside = (fid) => { const out = new Set([fid]); let grew = true; while (grew) { grew = false; for (const f of folders) if (f.parent && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; } } return out; };
  const sections = folders.filter((f) => !f.parent || !ids.has(f.parent)).map((f) => {
    const set = inside(f.id);
    const marks = bookmarks.filter((b) => set.has(b.folder)).slice(0, 12);
    return marks.length ? { f, marks } : null;
  }).filter(Boolean);
  const cols = (n) => Math.max(1, Math.min(6, n));
  const folderIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7.2A1.8 1.8 0 0 1 5.8 5.4h3.9l2 2.2h6.5A1.8 1.8 0 0 1 20 9.4v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const r = classic ? 0 : 14;
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta(CSP_LOCAL)}<title>${escape(title)}</title>
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; --bg: ${bg || (dark ? '#000000' : '#ffffff')}; --fg: ${dark ? '#f2f2f7' : '#1c1c1e'}; --tile: ${dark ? (bg && bg !== '#000000' ? 'rgba(255,255,255,.08)' : '#1c1c1e') : '#f2f2f7'}; --tilefg: ${dark ? '#d1d1d6' : '#3a3a3c'}; --sep: ${dark ? '#2c2c2e' : '#e5e5ea'}; }
body { margin: 0; min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); padding-bottom: 56px; }
.head { margin-top: ${sections.length ? '12vh' : '26vh'}; text-align: center; display: flex; flex-direction: column; align-items: center; }
.priv { margin-top: 16px; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: ${classic ? 0 : 999}px; font: 500 13px system-ui, -apple-system, "Segoe UI", sans-serif; color: ${dark ? '#9ad8a7' : '#1f7a3a'}; background: ${dark ? 'rgba(80,200,120,.12)' : 'rgba(31,122,58,.08)'}; }
.logo { width: 112px; height: 112px; display: block; filter: drop-shadow(0 6px 18px rgba(183, 121, 31, ${dark ? '.35' : '.25'})); }
/* Au plus 6 colonnes, autant que de favoris : chaque grille reste centrée. */
.grid { display: grid; gap: 18px 14px; margin-top: 44px; justify-content: center; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 7px; text-decoration: none; color: inherit; }
.ic { width: 56px; height: 56px; border-radius: ${r}px; display: flex; align-items: center; justify-content: center; font: 500 22px "New York", Georgia, serif; background: var(--tile); color: var(--tilefg); }
.tile:hover .ic { outline: 2px solid ${dark ? '#3a3a3c' : '#d1d1d6'}; }
.t { font-size: 11px; color: #8e8e93; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sec { margin-top: 40px; display: flex; flex-direction: column; align-items: center; }
.sec h2 { display: flex; align-items: center; gap: 7px; margin: 0; padding-bottom: 8px; min-width: 240px; justify-content: center; border-bottom: 1px solid var(--sep); font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; color: ${dark ? '#d8b26a' : '#9a6a12'}; letter-spacing: .02em; }
.sec .grid { margin-top: 18px; }
</style></head><body><div class="head">${LOGO}${privacy ? `<div class="priv"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${escape(privacy)}</div>` : ''}</div>
${rootMarks.length ? `<div class="grid" style="grid-template-columns: repeat(${cols(rootMarks.length)}, 72px)">${rootMarks.map(tile).join('')}</div>` : ''}
${sections.map(({ f, marks }) => `<section class="sec"><h2>${folderIcon}<span>${escape(f.name)}</span></h2><div class="grid" style="grid-template-columns: repeat(${cols(marks.length)}, 72px)">${marks.map(tile).join('')}</div></section>`).join('\n')}
</body></html>`;
}

/** Page d'erreur dans la langue de l'interface ; l'adresse reste de gauche à droite. */
function errorPage({ title, message, url, lang = 'fr', rtl = false, dark = false, bg = null }) {
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">${cspMeta(CSP_LOCAL)}<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;padding:24px;background:${bg || (dark ? '#000000' : '#ffffff')};color:${dark ? '#f2f2f7' : '#1c1c1e'}}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#8e8e93;font-size:15px;max-width:360px}</style>
</head><body><h1>${escape(title)}</h1><p dir="auto">${escape(message)}</p><p dir="ltr" style="font-size:13px;word-break:break-all">${escape(url)}</p></body></html>`;
}

/** Page d'article locale du mode démo hors ligne (captures d'écran reproductibles sans réseau). */
function demoArticle({ title, host, minutes, dark }) {
  const paras = [];
  const n = Math.max(3, Math.min(14, minutes));
  for (let i = 0; i < n; i++) {
    paras.push(`<p>Une caravane est un convoi de marchandises ou un groupe de personnes voyageant ensemble, essentiellement dans le cadre d'une expédition commerciale. Les caravanes ont été utilisées principalement dans les zones désertiques du Sahara ou de la péninsule arabique et tout au long de la route de la soie, où le voyage en groupe permettait de se défendre contre les brigands et de partager l'eau, les vivres et les bêtes de somme. Les étapes se faisaient de puits en puits, de caravansérail en caravansérail.</p>`);
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">${cspMeta(CSP_LOCAL)}<title>${escape(title)}</title>
<link rel="icon" href="data:,">
<style>:root{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;font:17px/1.65 Georgia,"Times New Roman",serif;background:${dark ? '#101012' : '#ffffff'};color:${dark ? '#e8e8ea' : '#202122'}}
header{position:sticky;top:0;background:${dark ? '#1c1c1e' : '#f8f9fa'};border-bottom:1px solid ${dark ? '#333' : '#e5e5e5'};padding:14px 32px;font:600 22px/1 "Linux Libertine",Georgia,serif;letter-spacing:.02em}
main{max-width:760px;margin:0 auto;padding:32px 24px 120px}h1{font:400 34px/1.2 "Linux Libertine",Georgia,serif;border-bottom:1px solid ${dark ? '#333' : '#a2a9b1'};padding-bottom:6px;margin:0 0 6px}.sub{color:#8e8e93;font:14px system-ui,sans-serif;margin-bottom:24px}
.box{background:${dark ? '#1b1b1f' : '#f3f6ff'};border-left:4px solid #3366cc;padding:10px 14px;margin:0 0 18px;font:15px system-ui,sans-serif}a{color:#3366cc;text-decoration:none}</style></head>
<body><header>${escape(host)}</header><main><h1>${escape(title.replace(/ — .*$/, ''))}</h1><div class="sub">${escape(host)} · ${minutes} min de lecture</div>
<div class="box">Pour les articles homonymes, voir <a href="#">Caravane</a>.</div>${paras.join('')}</main></body></html>`;
}

module.exports = { darkenCSS, reader, readerPage, renderReaderTree, safeHref, safeImageSrc, startPage, errorPage, demoArticle, escape, CSP_READER, CSP_LOCAL };
