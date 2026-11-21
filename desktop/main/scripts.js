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
 * Page de démarrage locale façon Safari : logo, puis « Favoris » en grille de grandes icônes (icônes des sites
 * gardées sur l'ordinateur, fondues dans leur tuile) ; chaque dossier est une tuile qui montre en miniature ses
 * quatre premiers sites, et s'ouvre sur place (ancre #f-…, sans script) avec un retour vers « Favoris ».
 * Aucune requête réseau. `classic` : style classique minimaliste (angles droits).
 */
function startPage({ dark, bg = null, bookmarks = [], folders = [], title = 'Qafila', rtl = false, lang = 'fr', privacy = '', classic = false, icons = () => null, labels = {} }) {
  const ids = new Set(folders.map((f) => f.id));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const face = (b, mini = false) => {
    const ic = icons(hostOf(b.url));
    const letter = escape(String(b.title || hostOf(b.url) || '?').trim().slice(0, 1).toUpperCase());
    if (!ic) return `<span class="${mini ? 'mi' : 'ic'} letter">${letter}</span>`;
    const style = ic.bg ? ` style="background:${escape(ic.bg)}"` : '';
    return `<span class="${mini ? 'mi' : 'ic'}${ic.fill ? ' fill' : ''}"${style}><img src="${escape(ic.url)}" alt=""></span>`;
  };
  const tile = (b) => `<a class="tile" href="${escape(b.url)}" title="${escape(b.title)}">${face(b)}<span class="t">${escape(b.title)}</span></a>`;
  const inside = (fid) => { const out = new Set([fid]); let grew = true; while (grew) { grew = false; for (const f of folders) if (f.parent && out.has(f.parent) && !out.has(f.id)) { out.add(f.id); grew = true; } } return out; };
  const folderTile = (f) => {
    const set = inside(f.id);
    const marks = bookmarks.filter((b) => set.has(b.folder)).slice(0, 4);
    const minis = marks.map((b) => face(b, true)).join('') + '<span class="mi empty"></span>'.repeat(Math.max(0, 4 - marks.length));
    return `<a class="tile" href="#f-${escape(f.id)}" title="${escape(f.name)}"><span class="ic fold">${minis}</span><span class="t">${escape(f.name)}</span></a>`;
  };
  const rootFolders = folders.filter((f) => !f.parent || !ids.has(f.parent));
  const rootMarks = bookmarks.filter((b) => !b.folder || !ids.has(b.folder));
  // Autant de colonnes que de tuiles (8 au plus) : la grille reste centrée sous le logo, titre aligné sur elle.
  const grid = (items) => `<div class="grid" style="grid-template-columns: repeat(${Math.max(1, Math.min(8, items.length))}, 96px)">${items.join('')}</div>`;
  const views = folders.map((f) => {
    const subs = folders.filter((x) => x.parent === f.id);
    const marks = bookmarks.filter((b) => b.folder === f.id);
    const back = f.parent && ids.has(f.parent) ? `#f-${escape(f.parent)}` : '#';
    return `<section class="folder" id="f-${escape(f.id)}"><div class="fh"><a class="back" href="${back}">‹ ${escape(labels.back || 'Retour')}</a><h2>${escape(f.name)}</h2></div>${grid([...subs.map(folderTile), ...marks.map(tile)])}</section>`;
  });
  const hasFav = rootFolders.length || rootMarks.length;
  const r = classic ? 0 : 18;
  const tileBg = dark ? (bg && bg !== '#000000' ? 'rgba(255,255,255,.09)' : '#1c1c1e') : '#f2f2f7';
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${cspMeta(CSP_LOCAL)}<title>${escape(title)}</title>
<style>
:root { color-scheme: ${dark ? 'dark' : 'light'}; --bg: ${bg || (dark ? '#000000' : '#ffffff')}; --fg: ${dark ? '#f2f2f7' : '#1c1c1e'}; --tile: ${tileBg}; --tilefg: ${dark ? '#d1d1d6' : '#3a3a3c'}; --sub: ${dark ? '#98989f' : '#6e6e73'}; }
body { margin: 0; min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); padding: 0 24px 56px; }
.head { margin-top: ${hasFav ? '9vh' : '26vh'}; text-align: center; display: flex; flex-direction: column; align-items: center; }
.priv { margin-top: 16px; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: ${classic ? 0 : 999}px; font: 500 13px system-ui, -apple-system, "Segoe UI", sans-serif; color: ${dark ? '#9ad8a7' : '#1f7a3a'}; background: ${dark ? 'rgba(80,200,120,.12)' : 'rgba(31,122,58,.08)'}; }
.logo { width: 104px; height: 104px; display: block; filter: drop-shadow(0 6px 18px rgba(183, 121, 31, ${dark ? '.35' : '.25'})); }
.fav, .folder { max-width: 100%; margin-top: 40px; }
.fav h1, .folder h2 { font: 700 24px system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0 0 18px 6px; }
.grid { display: grid; gap: 22px 8px; justify-content: start; }
.tile { display: flex; flex-direction: column; align-items: center; gap: 8px; text-decoration: none; color: inherit; border-radius: ${r + 4}px; padding: 4px 0; }
.ic { width: 72px; height: 72px; border-radius: ${r}px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--tile); color: var(--tilefg); box-shadow: inset 0 0 0 1px ${dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)'}; transition: transform .15s ease; }
.ic img { width: 46px; height: 46px; object-fit: contain; }
.ic.fill img { width: 100%; height: 100%; object-fit: cover; }
.letter { font: 600 28px system-ui, -apple-system, "Segoe UI", sans-serif; }
.ic.fold { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 9px; box-sizing: border-box; }
.mi { width: 24px; height: 24px; border-radius: ${classic ? 0 : 6}px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: ${dark ? 'rgba(255,255,255,.12)' : '#ffffff'}; font: 700 12px system-ui, sans-serif; color: var(--tilefg); }
.mi img { width: 18px; height: 18px; object-fit: contain; } .mi.fill img { width: 100%; height: 100%; object-fit: cover; }
.mi.empty { background: transparent; }
.tile:hover .ic { transform: scale(1.05); }
.t { font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); max-width: 92px; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; }
.folder { display: none; }
.folder:target { display: block; }
body:has(.folder:target) .fav, body:has(.folder:target) .head { display: none; }
.fh { display: flex; flex-direction: column; gap: 6px; margin-top: 6vh; }
.back { font: 600 15px system-ui, sans-serif; color: var(--sub); text-decoration: none; margin-left: 6px; }
.back:hover { color: var(--fg); }
</style></head><body><div class="head">${LOGO}${privacy ? `<div class="priv"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${escape(privacy)}</div>` : ''}</div>
${hasFav ? `<div class="fav"><h1>${escape(labels.favorites || 'Favoris')}</h1>${grid([...rootFolders.map(folderTile), ...rootMarks.map(tile)])}</div>` : ''}
${views.join('\n')}
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
