// Barre de Qafila : capsule flottante en faux verre (ou barre Classique / Verre pleine largeur), carte d'adresse
// (6 styles), rangée d'icônes du contrat, saisie d'adresse avec suggestions, recherche dans la page.
import {
  q, S, $, t, esc, STRIP, backgroundHex, barSizes, bookmarkSizes, bookmarksBarOn, splitBar, actionLabel, selectedTab, settings, toolbar, palette, accentRGB, favicon, readingLabel,
  shortURL, setOverlay, renderNow, toast, onRender,
} from './core.js';
import { icon, actionIcon, tabsGlyph } from './icons.js';
import { perform, actionState, isActive, isEnabled } from './actions.js';
import { openBookmarksFolder, openBookmarkEdit } from './sheet.js';

const SIZES = { small: 17, medium: 20, large: 23 };
const WEIGHTS = { thin: 1.15, regular: 1.5, bold: 2 };

// ----- Thème : variables CSS de la barre et de l'interface -----
let titlebarSig = '';
export function applyTheme() {
  const root = document.documentElement;
  const st = S.state;
  const tb = toolbar();
  const p = palette();
  root.classList.toggle('dark', !!st.dark);
  root.classList.toggle('bar-dark', p.contentDark);
  root.classList.toggle('bottom', tb.position === 'bottom');
  for (const s of ['classic', 'glass', 'floating']) root.classList.toggle('style-' + s, (tb.style || 'floating') === s);
  // Style classique minimaliste : angles droits, aucune transparence (style.css :root.ui-classic).
  root.classList.toggle('ui-classic', settings().uiStyle === 'classic');
  root.style.setProperty('--bar-rgb', p.bar.join(','));
  root.style.setProperty('--alpha', p.alpha.toFixed(3));
  root.style.setProperty('--alpha-solid', (p.style === 'classic' ? 1 : 1 - 0.12 * p.transparency).toFixed(3));
  root.style.setProperty('--card', p.card);
  root.style.setProperty('--sw', String(WEIGHTS[settings().buttonWeight] || 1.15));
  root.style.setProperty('--strip', STRIP() + 'px');
  const bs = barSizes();
  const bk = bookmarkSizes();
  root.classList.toggle('split', splitBar());
  root.style.setProperty('--bar-h', bs.bar + 'px');
  root.style.setProperty('--pill-h', bs.pill + 'px');
  root.style.setProperty('--btn-w', bs.btn + 'px');
  root.style.setProperty('--bm', (bookmarksBarOn() ? bk.h : 0) + 'px');
  root.style.setProperty('--bm-row', (bk.h - 2) + 'px');
  root.style.setProperty('--bm-font', bk.font + 'px');
  root.style.setProperty('--bm-opt', bk.opt + 'px');
  // La page est toujours posée à côté de la bande : la bande a son propre fond, couleur du thème ou du site (barre « Auto »).
  root.style.setProperty('--strip-color', p.site ? `rgb(${p.site.join(',')})` : backgroundHex());
  // Au défilement : barre réduite à la mini-adresse (Réduire) ou masquée (Masquer), décidé par le processus principal.
  const c = st.collapse || 'none';
  root.classList.toggle('collapse-mini', c === 'mini');
  root.classList.toggle('collapse-hidden', c === 'hidden');
  const miniFg = p.site ? (p.contentDark ? '#ffffff' : '#000000') : (st.dark ? '#f2f2f7' : '#1c1c1e');
  root.style.setProperty('--mini-fg', miniFg);
  // Barre de titre Windows : même couleur que la bande.
  const hex = (rgb) => '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const tbg = p.site ? hex(p.site) : backgroundHex();
  if (titlebarSig !== tbg + miniFg) { titlebarSig = tbg + miniFg; q.ui.titlebar(tbg, miniFg).catch(() => {}); }
  root.classList.toggle('mac', S.cfg?.app?.platform === 'darwin');
  const acc = accentRGB();
  if (acc) root.style.setProperty('--accent', `rgb(${acc.join(',')})`); else root.style.removeProperty('--accent');
  root.classList.toggle('accent-mono', !acc);
  root.lang = st.lang;
  root.dir = st.rtl ? 'rtl' : 'ltr';
}

// ----- Carte d'adresse -----
/** Carte d'adresse d'un onglet selon le style ; `opts.preview` pour les aperçus des réglages. */
export function addressCard(tab, opts = {}) {
  const s = { ...settings(), ...(opts.settings || {}) };
  const style = opts.style || (s.addressStyle === 'hidden' ? 'card' : s.addressStyle || 'card');
  const showFav = s.addressShowsFavicon !== false;
  const showRead = s.addressShowsReadingTime !== false;
  const reading = showRead ? readingLabel(tab) : null;
  const domain = tab?.host || '';
  // Téléchargement en cours : la pilule de lecture devient une pilule de progression (notification dans la barre).
  const dl = !opts.preview && S.state?.downloads?.active ? S.state.downloads : null;
  const dlText = dl ? (dl.progress === null ? '' : t('percent', Math.round(dl.progress * 100))) : '';
  const pill = dl ? `<span class="pill dl" title="${esc(t('downloads'))}">${icon('download', 12)}${esc(dlText)}</span>` : reading ? `<span class="pill">${esc(reading)}</span>` : '';
  let inner;
  if (!opts.preview && S.toast) {
    inner = `<span class="toast">${esc(S.toast)}</span>`;
  } else if (!tab?.url) {
    const centered = style === 'domainPill' || style === 'centered';
    inner = `<span class="ph${centered ? ' center' : ''}">${icon('search')}<span>${esc(t('search_or_enter_address'))}</span></span>`;
  } else if (style === 'fullURL') {
    const lock = tab.url.startsWith('https://') ? `<span class="lock">${icon('lock')}</span>` : '';
    inner = `${showFav ? favicon(tab, 18) : ''}${lock}<span class="url">${esc(shortURL(tab.url))}</span>${pill}`;
  } else if (style === 'domainPill') {
    inner = `<span class="dom-pill">${showFav ? favicon(tab, 16) : ''}<span class="h">${esc(domain)}</span>${reading ? `<span class="sub">· ${esc(reading)}</span>` : ''}</span>`;
  } else if (style === 'titleReading') {
    const sub = reading ? t('reading_time_label', reading) : domain;
    inner = `${showFav ? favicon(tab, 20) : ''}<span class="txt"><span class="title strong"><bdi>${esc(tab.title)}</bdi></span><span class="sub">${esc(sub)}</span></span>`;
  } else if (style === 'centered') {
    inner = `<span class="txt center"><span class="dom">${esc(domain)}</span><span class="title"><bdi>${esc(tab.title)}</bdi>${reading ? ` <span class="sub">${esc(reading)}</span>` : ''}</span></span>`;
  } else {
    inner = `${showFav ? favicon(tab, 20) : ''}<span class="txt"><span class="dom">${esc(domain)}</span><span class="title"><bdi>${esc(tab.title)}</bdi></span></span>${pill}`;
  }
  const loading = !opts.preview && tab?.loading;
  const progress = opts.preview ? '' : `<span class="progress" style="opacity:${loading ? 1 : 0};transform:scaleX(${loading ? Math.max(0.06, tab.progress || 0) : 1})"></span>`;
  return `<div class="address style-${style}${opts.preview ? '' : ' live'}" ${opts.preview ? '' : 'data-address'} title="${esc(tab?.url || '')}">${inner}${progress}</div>`;
}

// ----- Rangée d'icônes -----
/** Emplacements affichés : l'adresse est insérée en 3e position si la barre n'en contient pas (barre sur une ligne). */
export function rowSlots(bar, addressStyle) {
  const list = [...(bar || [])];
  const hasAddress = list.some((s) => s.action === 'address');
  if (!hasAddress && addressStyle !== 'hidden') list.splice(Math.min(2, list.length), 0, { action: 'address', size: 'medium' });
  return list;
}

/**
 * Disposition de la barre. En deux parties (PC, par défaut) : la capsule d'adresse à gauche, tous les boutons
 * (précédent, onglets, +, menu…) dans une seconde capsule à droite, sur la même ligne. Une ligne : l'adresse au
 * milieu des boutons, dans une seule capsule.
 */
function layout(bar, s, tb) {
  const split = splitBar(s, tb);
  return { split, slots: split ? (bar || []).filter((x) => x.action !== 'address') : rowSlots(bar, s.addressStyle) };
}

function button(slot, st, count) {
  const id = slot.action;
  const size = SIZES[slot.size] || 20;
  const enabled = isEnabled(id, st);
  const glyph = id === 'tabs' ? tabsGlyph(count, size) : icon(actionIcon(id, st), size);
  return `<button class="btn${enabled ? '' : ' off'}${isActive(id, st) ? ' on' : ''}" data-action="${id}" ${enabled ? '' : 'disabled'} title="${esc(actionLabel(id))}" aria-label="${esc(actionLabel(id))}">${glyph}</button>`;
}

/** Bouton « Mettre à jour » : visible seulement quand une nouvelle version est prête (macOS : disponible). */
export function updateButton() {
  const u = S.state?.update;
  // Téléchargement en cours : pastille discrète avec le pourcentage (le bouton arrive quand c'est prêt).
  if (u?.status === 'downloading') return `<span class="upd upd-dl" title="${esc(t('update_status_downloading', u.percent ?? 0))}">${icon('update', 17)}<span>${esc(t('percent', u.percent ?? 0))}</span></span>`;
  if (!u || !(u.status === 'ready' || (u.manual && u.status === 'available'))) return '';
  const title = t(u.manual ? 'update_button_title_manual' : 'update_button_title', u.version || '');
  return `<button class="upd" data-update title="${esc(title)}" aria-label="${esc(title)}">${icon('update', 17)}<span>${esc(t('update_button'))}</span></button>`;
}

/** HTML de la rangée (barre réelle ou aperçu de la galerie / des réglages). */
export function rowHTML(cfgBar, opts = {}) {
  const s = { ...settings(), ...(opts.settings || {}) };
  // Aperçus (réglages, galerie) : dessinés comme sur une page web, même quand l'onglet courant est la page de démarrage.
  const st = opts.state || (opts.preview ? { ...actionState(), isWeb: true } : actionState());
  const tab = opts.tab !== undefined ? opts.tab : selectedTab();
  const count = opts.count ?? (S.state?.tabs.filter((x) => !x.isPrivate).length || 0);
  const { split, slots } = layout(cfgBar, opts.oneRow ? { ...s, barLayout: 'one' } : s, opts.toolbar);
  const inline = split || slots.some((x) => x.action === 'address');
  const parts = slots.map((slot) => {
    if (slot.action === 'separator') return '<span class="gap"></span>';
    if (slot.action === 'address') return addressCard(tab, { preview: opts.preview, settings: opts.settings });
    return button(slot, st, count);
  });
  // Barre réelle : boutons des extensions puis « Mettre à jour », juste avant le bouton du menu (sinon en fin de rangée).
  const upd = opts.preview ? '' : extensionSlot() + updateButton();
  if (upd) {
    const m = slots.findIndex((x) => x.action === 'menu');
    parts.splice(m >= 0 ? m : parts.length, 0, upd);
  }
  if (split) return `<div class="row split"><div class="bseg bseg-addr">${addressCard(tab, { preview: opts.preview, settings: opts.settings })}</div><div class="bseg bseg-btns">${parts.join('')}</div></div>`;
  return `<div class="row${inline ? ' inline' : ' spread'}">${parts.join('')}</div>`;
}

// ----- Saisie d'adresse -----
const edit = { text: '', results: { local: [], remote: [] }, index: -1, seq: 0 };

export function beginEditing(initial) {
  const tab = selectedTab();
  edit.text = initial !== undefined ? initial : (tab?.url && /^https?:/.test(tab.url) ? tab.url : '');
  edit.index = -1;
  edit.results = { local: [], remote: [] };
  S.find = null;
  setOverlay('editing').then(() => {
    const input = $('#edit-input');
    if (input) { input.value = edit.text; input.focus(); input.select(); }
    fetchSuggestions();
  });
}

export function cancelEditing() { if (S.overlay === 'editing') setOverlay('none'); }

let suggestTimer = null;
function fetchSuggestions() {
  clearTimeout(suggestTimer);
  const seq = ++edit.seq;
  suggestTimer = setTimeout(async () => {
    const query = edit.text.trim() && edit.text === selectedTab()?.url ? '' : edit.text;
    const r = await q.suggest(query).catch(() => ({ local: [], remote: [] }));
    if (seq !== edit.seq) return;
    edit.results = r || { local: [], remote: [] };
    edit.index = -1;
    renderSuggestions();
  }, edit.text ? 90 : 0);
}

/** Lignes du panneau : saisie telle quelle, puis favoris / historique, puis suggestions du moteur. */
function suggestionItems() {
  const items = [];
  const text = edit.text.trim();
  const isCurrent = text && text === selectedTab()?.url;
  if (text && !isCurrent) items.push({ kind: 'go', text, label: text });
  for (const l of edit.results.local || []) items.push({ kind: l.kind, text: l.url, label: l.title || shortURL(l.url), sub: shortURL(l.url) });
  for (const r of edit.results.remote || []) if (r.toLowerCase() !== text.toLowerCase()) items.push({ kind: 'remote', text: r, label: r });
  return items.slice(0, 12);
}

function renderSuggestions() {
  const box = $('#suggest');
  if (!box) return;
  const items = suggestionItems();
  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  const engine = t('engine_' + (settings().searchEngine || 'google'));
  const looksURL = (s) => /^[a-z]+:\/\//i.test(s) || (/^\S+\.\S+$/.test(s) && !/\s/.test(s));
  let html = '';
  let lastGroup = null;
  items.forEach((it, i) => {
    const group = it.kind === 'remote' ? 'remote' : it.kind === 'go' ? 'go' : 'local';
    if (lastGroup && group !== lastGroup) html += '<div class="sep"></div>';
    lastGroup = group;
    let ic = 'search';
    let sub = it.sub || '';
    if (it.kind === 'bookmark') ic = 'book';
    else if (it.kind === 'history') ic = 'clock';
    else if (it.kind === 'go') { ic = looksURL(it.text) ? 'link' : 'search'; sub = looksURL(it.text) ? '' : engine; }
    html += `<div class="sg${i === edit.index ? ' sel' : ''}" data-sg="${i}">${icon(ic)}<span class="l"><span class="t">${esc(it.label)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ''}</span>${it.kind === 'remote' ? `<span class="fill" data-fill="${i}" title="${esc(t('fill_in'))}">${icon('arrowUpLeft')}</span>` : ''}</div>`;
  });
  box.innerHTML = html;
  box.hidden = false;
  alignSuggestions(box);
}

/** Le panneau prend la largeur de la pilule de saisie (barre flottante) ; pleine largeur sinon. */
function alignSuggestions(box) {
  const field = document.querySelector('#bar .edit-field');
  if (!field) return;
  const r = field.getBoundingClientRect();
  const wide = toolbar().style !== 'floating';
  const left = wide ? Math.max(12, r.left - 6) : r.left - 6;
  box.style.left = left + 'px';
  box.style.right = 'auto';
  box.style.width = Math.min(window.innerWidth - left - 12, r.width + 12) + 'px';
  // Sous la barre de favoris (barre en haut) : les favoris restent visibles et cliquables pendant la saisie.
  const bm = $('#bmbar');
  const top = !document.documentElement.classList.contains('bottom');
  if (top && bm && !bm.hidden) { const b = bm.getBoundingClientRect(); box.style.top = Math.round(Math.max(r.bottom, b.bottom) + 6) + 'px'; }
  else box.style.top = '';
}

function commit(text) {
  const v = String(text || '').trim();
  if (!v) return;
  q.tabs.navigate(v);
  setOverlay('none');
}

/**
 * Saisie d'adresse : la rangée de boutons reste en place (onglets, +, menu…), seule la carte d'adresse devient le
 * champ. Échap ou un clic ailleurs annule. Les boutons sont rafraîchis à chaque rendu (nombre d'onglets…) sans
 * reconstruire le champ, qui garde sa frappe et son focus.
 */
function editingHTML() {
  const { split, slots } = layout(toolbar().bar, { ...settings(), addressStyle: 'card' });
  const field = `<label class="address edit-field">${icon('search')}<input id="edit-input" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(t('search_or_enter_address'))}" dir="auto"><button class="clear" data-edit-clear title="${esc(t('clear'))}">${icon('xmarkCircle')}</button></label>`;
  const parts = slots.map((slot, i) => (slot.action === 'address' ? field : slot.action === 'separator' ? '<span class="gap"></span>' : `<span class="slot" data-slot="${i}"></span>`));
  if (split) return `<div class="row split editing"><div class="bseg bseg-addr">${field}</div><div class="bseg bseg-btns">${parts.join('')}</div></div>`;
  return `<div class="row inline editing">${parts.join('')}</div>`;
}

function refreshEditingButtons() {
  const { slots } = layout(toolbar().bar, { ...settings(), addressStyle: 'card' });
  const st = actionState();
  const count = S.state?.tabs.filter((x) => !x.isPrivate).length || 0;
  for (const el of document.querySelectorAll('#bar [data-slot]')) {
    const slot = slots[Number(el.dataset.slot)];
    const html = slot ? (slot.action === 'menu' ? updateButton() : '') + button(slot, st, count) : '';
    if (el.innerHTML !== html) el.innerHTML = html;
  }
}

// ----- Menu d'un dossier de la barre de favoris (comme Chrome) -----
/** Clic sur un dossier : sa liste s'ouvre sous lui ; second clic sur le même dossier : fermeture. */
function toggleFolderMenu(btn) {
  const id = btn.dataset.bmfolder;
  if (S.overlay === 'bmmenu' && S.bmMenu?.stack?.[0] === id) { setOverlay('none'); return; }
  const r = btn.getBoundingClientRect();
  S.bmMenu = { stack: [id], x: r.left, y: r.bottom + 4 };
  setOverlay('bmmenu');
}
function renderFolderMenu() {
  const el = $('#bmmenu');
  if (!el) return;
  const on = S.overlay === 'bmmenu' && S.bmMenu;
  if (!on) { if (!el.hidden) { el.hidden = true; el.innerHTML = ''; el.dataset.html = ''; } return; }
  const folders = S.state?.folders || [];
  const id = S.bmMenu.stack[S.bmMenu.stack.length - 1];
  const cur = folders.find((f) => f.id === id);
  if (!cur) { setOverlay('none'); return; }
  const subs = folders.filter((f) => f.parent === id);
  const marks = (S.state?.bookmarks || []).filter((b) => b.folder === id);
  const ic = bookmarkSizes().ic;
  const rows = [];
  if (S.bmMenu.stack.length > 1) rows.push(`<button class="m-line bmm-head" data-bmm-back>${icon('chevronLeft', 15)}<span class="l"><b>${esc(cur.name)}</b></span></button>`, '<div class="m-gap"></div>');
  for (const f of subs) rows.push(`<button class="m-line" data-bmm-folder="${esc(f.id)}"><span class="bmm-fic">${icon('folder', ic + 2)}</span><span class="l">${esc(f.name)}</span>${icon('chevronRight', 13)}</button>`);
  if (subs.length && marks.length) rows.push('<div class="m-sep"></div>');
  for (const b of marks) rows.push(`<button class="m-line" data-bmm-open="${esc(b.id)}" title="${esc(b.title)}\n${esc(b.url)}">${bookmarkIcon(b)}<span class="l"><bdi>${esc(b.title || b.url)}</bdi></span></button>`);
  if (!subs.length && !marks.length) rows.push(`<div class="m-line bmmenu-empty"><span class="l">${esc(t('bm_folder_empty_short'))}</span></div>`);
  rows.push('<div class="m-gap"></div>');
  if (marks.length > 1) rows.push(`<button class="m-line" data-bmm-all>${icon('squares', 15)}<span class="l">${esc(t('bm_open_all', marks.length))}</span></button>`);
  rows.push(`<button class="m-line" data-bmm-manage>${icon('sliders', 15)}<span class="l">${esc(t('bm_manage'))}</span></button>`);
  const html = rows.join('');
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
  const wasHidden = el.hidden;
  el.hidden = false;
  const w = 280;
  el.style.width = w + 'px';
  el.style.left = Math.round(Math.max(8, Math.min(S.bmMenu.x, window.innerWidth - w - 8))) + 'px';
  el.style.top = Math.round(S.bmMenu.y) + 'px';
  el.style.maxHeight = Math.max(160, window.innerHeight - S.bmMenu.y - 12) + 'px';
  if (wasHidden) { el.classList.remove('in'); void el.offsetWidth; el.classList.add('in'); }
}
onRender(renderFolderMenu);
function installFolderMenuEvents() {
  const el = $('#bmmenu');
  el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  const open = (e, b) => {
    const m = (S.state?.bookmarks || []).find((x) => x.id === b.dataset.bmmOpen);
    if (!m) return;
    if (e.button === 1 || e.ctrlKey || e.metaKey) { q.tabs.create({ url: m.url, select: false }); return; }
    q.tabs.navigate(m.url); setOverlay('none');
  };
  el.addEventListener('click', (e) => {
    let b;
    if ((b = e.target.closest('[data-bmm-folder]'))) { S.bmMenu.stack.push(b.dataset.bmmFolder); renderNow(); return; }
    if (e.target.closest('[data-bmm-back]')) { S.bmMenu.stack.pop(); renderNow(); return; }
    if ((b = e.target.closest('[data-bmm-open]'))) { open(e, b); return; }
    if (e.target.closest('[data-bmm-all]')) {
      const id = S.bmMenu.stack[S.bmMenu.stack.length - 1];
      for (const m of (S.state?.bookmarks || []).filter((x) => x.folder === id)) q.tabs.create({ url: m.url, select: false });
      setOverlay('none'); return;
    }
    if (e.target.closest('[data-bmm-manage]')) { const id = S.bmMenu.stack[S.bmMenu.stack.length - 1]; setOverlay('none').then(() => openBookmarksFolder(id)); }
  });
  el.addEventListener('auxclick', (e) => { const b = e.target.closest('[data-bmm-open]'); if (b && e.button === 1) open(e, b); });
}

// ----- Barre de favoris -----
/** Icône d'un favori : celle d'un onglet ouvert sur le même site, sinon l'initiale. */
function bookmarkIcon(b) {
  let host = '';
  try { host = new URL(b.url).hostname.replace(/^www\./, ''); } catch { /* adresse illisible */ }
  const tab = (S.state?.tabs || []).find((x) => !x.isPrivate && x.host === host && x.faviconData);
  return favicon(tab || { host }, bookmarkSizes().ic);
}

/** Action choisie dans le menu du clic droit de la barre de favoris. */
async function bookmarkMenuChoice(choice, kind, id) {
  if (!choice) return;
  const b = kind === 'bookmark' && (S.state?.bookmarks || []).find((x) => x.id === id);
  const newFolder = async (parent) => {
    const f = await q.bookmarks.addFolder(t('bm_new_folder_name'), parent || null);
    // Attendre que l'état diffusé contienne le dossier avant d'ouvrir sa fiche.
    for (let i = 0; f?.id && i < 40 && !(S.state?.folders || []).some((x) => x.id === f.id); i++) await new Promise((r) => setTimeout(r, 25));
    return f?.id || null;
  };
  if (choice.startsWith('move:')) { if (b) await q.bookmarks.move('bookmark', id, choice.slice(5) || null); return; }
  switch (choice) {
    case 'newTab': if (b) q.tabs.create({ url: b.url, select: true }); break;
    case 'privateTab': if (b) q.tabs.create({ url: b.url, isPrivate: true, select: true }); break;
    case 'copy': toast(t('toast_address_copied')); break;
    case 'edit': openBookmarkEdit(kind === 'folder' ? 'f' : 'b', id); break;
    case 'manage': openBookmarksFolder(id); break;
    case 'manageAll': openBookmarksFolder(null); break;
    case 'addPage': perform('addBookmark'); break;
    case 'newFolder': {
      // Nouveau dossier à la racine (visible dans la barre), ou dans le dossier cliqué ; fiche ouverte pour le nommer.
      const fid = await newFolder(kind === 'folder' ? id : null);
      if (fid) openBookmarkEdit('f', fid);
      break;
    }
    case 'moveNew': {
      const fid = await newFolder(b?.folder || null);
      if (fid && b) { await q.bookmarks.move('bookmark', id, fid); openBookmarkEdit('f', fid); }
      break;
    }
    case 'delete': if (kind === 'bookmark') await q.bookmarks.remove(id); else if (kind === 'folder') await q.bookmarks.removeFolder(id); break;
    default: break;
  }
}

/**
 * Glisser-déposer dans la barre, comme les icônes d'un téléphone :
 *  - lâché sur le bord gauche / droit d'un élément du même type → déplacé avant / après lui ;
 *  - lâché au centre d'un dossier → rangé dedans ;
 *  - lâché au centre d'un autre favori → les deux sont réunis dans un nouveau dossier (fiche ouverte pour le nommer).
 * Les dossiers restent devant les favoris dans la barre : un dossier ne se range qu'entre dossiers.
 */
function installBarDrag(bm) {
  let drag = null;
  const clear = () => bm.querySelectorAll('.drop-into, .drop-before, .drop-after, .drop-merge').forEach((x) => x.classList.remove('drop-into', 'drop-before', 'drop-after', 'drop-merge'));
  const zone = (e, el) => {
    const r = el.getBoundingClientRect();
    const f = (e.clientX - r.left) / Math.max(1, r.width);
    const isFolder = !!el.dataset.bmfolder;
    const sameKind = isFolder === (drag.kind === 'folder');
    if (f < 0.28 && sameKind) return 'before';
    if (f > 0.72 && sameKind) return 'after';
    if (isFolder) return 'into';
    if (drag.kind === 'bookmark') return 'merge';
    return null;   // un dossier lâché sur un favori : rien
  };
  bm.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-bm], [data-bmfolder]');
    if (!el) return;
    drag = el.dataset.bm ? { kind: 'bookmark', id: el.dataset.bm } : { kind: 'folder', id: el.dataset.bmfolder };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', drag.id); } catch { /* ignoré */ }
  });
  bm.addEventListener('dragover', (e) => {
    if (!drag) return;
    const el = e.target.closest('[data-bm], [data-bmfolder]');
    clear();
    if (!el || el.dataset.bm === drag.id || el.dataset.bmfolder === drag.id) return;
    const z = zone(e, el);
    if (!z) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add(z === 'into' ? 'drop-into' : z === 'merge' ? 'drop-merge' : z === 'before' ? 'drop-before' : 'drop-after');
  });
  bm.addEventListener('dragleave', (e) => { if (!bm.contains(e.relatedTarget)) clear(); });
  bm.addEventListener('drop', async (e) => {
    const el = e.target.closest('[data-bm], [data-bmfolder]');
    const d = drag;
    const z = d && el ? zone(e, el) : null;
    drag = null; clear();
    bm.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    if (!d || !el || !z) return;
    e.preventDefault();
    const target = el.dataset.bmfolder || el.dataset.bm;
    if (target === d.id) return;
    if (z === 'before' || z === 'after') await q.bookmarks.placeBefore(d.kind, d.id, target, z === 'after');
    else if (z === 'into') await q.bookmarks.move(d.kind, d.id, target);
    else if (z === 'merge') {
      // Deux favoris réunis : nouveau dossier à la place, les deux dedans, fiche ouverte pour le nommer.
      const f = await q.bookmarks.addFolder(t('bm_new_folder_name'), null);
      if (!f?.id) return;
      await q.bookmarks.move('bookmark', target, f.id);
      await q.bookmarks.move('bookmark', d.id, f.id);
      for (let i = 0; i < 40 && !(S.state?.folders || []).some((x) => x.id === f.id); i++) await new Promise((r) => setTimeout(r, 25));
      openBookmarkEdit('f', f.id);
    }
  });
  bm.addEventListener('dragend', () => { drag = null; clear(); bm.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')); });
}

function renderBookmarksBar() {
  const el = $('#bmbar');
  if (!el) return;
  const on = bookmarksBarOn() && S.overlay !== 'tabs';
  el.hidden = !on;
  if (!on) return;
  // Racine des favoris : dossiers d'abord (ouvrent le gestionnaire dans ce dossier), puis favoris.
  const list = (S.state?.bookmarks || []).filter((b) => !b.folder);
  const folders = (S.state?.folders || []).filter((f) => !f.parent);
  const mac = S.cfg?.app?.platform === 'darwin';
  const items = list.length || folders.length
    ? folders.map((f) => `<button class="bm bm-folder" draggable="true" data-bmfolder="${esc(f.id)}" title="${esc(f.name)}">${icon('folder', bookmarkSizes().ic)}<span><bdi>${esc(f.name)}</bdi></span></button>`).join('') + list.map((b) => `<button class="bm" draggable="true" data-bm="${esc(b.id)}" title="${esc(b.title)}\n${esc(b.url)}">${bookmarkIcon(b)}<span><bdi>${esc(b.title)}</bdi></span></button>`).join('')
    : `<button class="bm bm-add" data-action="addBookmark">${icon(actionIcon('addBookmark', {}), 14)}<span>${esc(t('bookmarks_bar_add'))}</span></button><span class="bm-empty">${esc(t('bookmarks_bar_empty', mac ? '⌘D' : t('kbd_ctrl') + '+D'))}</span>`;
  // À droite : options rapides (page en favori, tous les favoris, historique, réglages).
  const st = actionState();
  const opts = ['addBookmark', 'bookmarks', 'history', 'settings'].map((id) => `<button class="bm-all${id === 'addBookmark' && st.bookmarked ? ' on' : ''}" data-bmact="${id}" title="${esc(actionLabel(id))}" aria-label="${esc(actionLabel(id))}">${icon(actionIcon(id, st), bookmarkSizes().opt)}</button>`).join('');
  const html = `<div class="bm-list">${items}</div><div class="bm-opts">${opts}</div>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

function openBookmark(e, full) {
  const b = (S.state?.bookmarks || []).find((x) => x.id === full.dataset.bm);
  if (!b) return;
  // Clic du milieu ou Ctrl / ⌘ + clic : nouvel onglet en arrière-plan, comme dans les navigateurs de bureau.
  if (e.button === 1 || e.ctrlKey || e.metaKey) q.tabs.create({ url: b.url, select: false });
  else { q.tabs.navigate(b.url); if (S.overlay !== 'none') setOverlay('none'); }
}

// ----- Recherche dans la page -----
export function openFind() {
  // S.find avant le retour à la bande : le processus principal laisse alors le focus au chrome.
  S.find = S.find || { text: '', matches: 0, active: 0 };
  if (S.overlay !== 'none') setOverlay('none');
  renderNow();
  q.ui.focus('chrome');
  const input = $('#find-input');
  if (input) { input.focus(); input.select(); }
}

export function closeFind() {
  if (!S.find) return;
  S.find = null;
  q.page.stopFind('clearSelection');
  renderNow();
  // La frappe (Espace, flèches, Page suivante) revient à la page.
  if (S.overlay === 'none') q.ui.focus('page');
}

function findHTML() {
  const f = S.find;
  const count = f.text ? (f.matches ? t('find_count', f.active, f.matches) : t('find_none')) : '';
  return `<div class="row inline finding">
    <label class="address edit-field">${icon('textSearch')}<input id="find-input" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(t('find_placeholder'))}" dir="auto"><span class="count" id="find-count">${esc(count)}</span></label>
    <button class="btn" data-find="prev" title="${esc(t('find_previous'))}">${icon('chevronDown', 20).replace('<svg', '<svg style="transform:rotate(180deg)"')}</button>
    <button class="btn" data-find="next" title="${esc(t('find_next'))}">${icon('chevronDown', 20)}</button>
    <button class="text-btn" data-find="done">${esc(t('done'))}</button></div>`;
}

function updateFindCount() {
  const f = S.find;
  const el = $('#find-count');
  if (!f || !el) return;
  el.textContent = f.text ? (f.matches ? t('find_count', f.active, f.matches) : t('find_none')) : '';
}

// ----- Boutons des extensions -----
// <browser-action-list> (préchargement preload/browser-action.js) : un seul élément, déplacé dans la rangée à chaque
// reconstruction, pour garder ses icônes, badges et fenêtre ouverte.
let extEl = null;
function extensionSlot() {
  const x = S.state?.extensions;
  return x?.ready && x.actionTab >= 0 && x.list.some((e) => e.hasAction) && customElements.get('browser-action-list') ? '<span class="ext-slot"></span>' : '';
}
function placeExtensionActions(host) {
  const slot = host.querySelector('.ext-slot');
  if (!slot) return;
  if (!extEl) {
    extEl = document.createElement('browser-action-list');
    extEl.className = 'ext-actions';
    extEl.setAttribute('partition', 'persist:qafila');
  }
  const tab = String(S.state.extensions.actionTab);
  if (extEl.getAttribute('tab') !== tab) extEl.setAttribute('tab', tab);
  const align = toolbar().position === 'bottom' ? 'top left' : 'bottom left';
  if (extEl.getAttribute('alignment') !== align) extEl.setAttribute('alignment', align);
  slot.replaceWith(extEl);
}

// ----- Barre en deux parties : le verre (capture floutée + teinte) découpé en deux capsules -----
let segSig = '';
function updateSegMask() {
  const bar = $('#bar');
  if (!bar) return;
  const segs = [...bar.querySelectorAll('.bseg')];
  const root = document.documentElement;
  if (!segs.length || !root.classList.contains('split')) {
    if (segSig) { root.classList.remove('has-segs'); root.style.removeProperty('--seg-mask'); segSig = ''; }
    return;
  }
  const b = bar.getBoundingClientRect();
  const rects = segs.map((el) => { const r = el.getBoundingClientRect(); return [r.left - b.left, r.top - b.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); });
  const sig = `${b.width}x${b.height}:${JSON.stringify(rects)}`;
  if (sig === segSig) return;
  segSig = sig;
  const body = rects.map(([x, y, w, h]) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${h / 2}'/>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${b.width}' height='${b.height}' viewBox='0 0 ${b.width} ${b.height}'>${body}</svg>`;
  root.style.setProperty('--seg-mask', `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`);
  root.classList.add('has-segs');
}
window.addEventListener('resize', () => requestAnimationFrame(updateSegMask));

// ----- Rendu de la barre -----
let mode = null; // 'row' | 'editing' | 'find' : la saisie n'est pas reconstruite à chaque mise à jour
let lastRowHTML = '';
function renderBar() {
  if (!S.state || !S.cfg) return;
  applyTheme();
  const host = $('#bar-content');
  const want = S.overlay === 'editing' ? 'editing' : S.find ? 'find' : 'row';
  if (want === 'editing') {
    if (mode !== 'editing') { host.innerHTML = editingHTML(); mode = 'editing'; }
    refreshEditingButtons();
  } else if (want === 'find') {
    if (mode !== 'find') { host.innerHTML = findHTML(); mode = 'find'; const i = $('#find-input'); if (i) i.value = S.find.text || ''; }
    updateFindCount();
  } else {
    // La rangée n'est reconstruite que si elle change (les boutons des extensions gardent leur état).
    const html = rowHTML(toolbar().bar);
    if (mode !== 'row' || html !== lastRowHTML) {
      host.innerHTML = html;
      lastRowHTML = html;
      mode = 'row';
      placeExtensionActions(host);
    }
  }
  renderBookmarksBar();
  updateSegMask();
  const sg = $('#suggest');
  if (sg && want !== 'editing') sg.hidden = true;
  // Réduire : mini-adresse (domaine seul) ; un clic rouvre la barre.
  const mini = $('#mini');
  mini.hidden = (S.state.collapse || 'none') !== 'mini';
  if (!mini.hidden) {
    const tab = selectedTab();
    const label = tab?.host || t('new_tab');
    if (mini.textContent !== label) mini.textContent = label;
    mini.setAttribute('aria-label', label);
  }
}
onRender(renderBar);

// ----- Faux verre : capture floutée de la page sous la bande -----
// Le flou estompe les bords de l'image vers la transparence : la couche reçoit en fond la couleur moyenne de la
// capture, si bien que la page ne transparaît jamais nette sous la barre.
const avgCanvas = document.createElement('canvas');
avgCanvas.width = 1; avgCanvas.height = 1;
q.glass.onFrame(async (frame) => {
  const img = $('#glass-img');
  if (!img) return;
  img.style.backgroundImage = frame ? `url("${frame.dataURL}")` : 'none';
  img.classList.toggle('empty', !frame);
  if (!frame) { img.parentNode.style.backgroundColor = ''; return; }
  try {
    const im = new Image();
    im.src = frame.dataURL;
    await im.decode();
    const ctx = avgCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(im, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    img.parentNode.style.backgroundColor = `rgb(${r},${g},${b})`;
  } catch { /* capture illisible : la teinte seule suffit */ }
});

// ----- Interactions -----
let pressTimer = null;
let longPressed = false;

function addressTap() {
  if (settings().addressTap === 'menu') perform('menu'); else beginEditing();
}
function addressLongPress() {
  const s = settings();
  if (s.addressTap === 'menu') return beginEditing();
  if (s.addressLongPress === 'menu') return perform('menu');
  if (s.addressLongPress === 'copy') return q.page.copyLink().then((ok) => ok && toast(t('toast_address_copied')));
  return null;
}

export function installBarEvents() {
  const bar = $('#bar');
  bar.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('[data-address]') || e.button !== 0) return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; addressLongPress(); }, 450);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  bar.addEventListener('pointerup', cancelPress);
  bar.addEventListener('pointerleave', cancelPress);
  bar.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-address]')) { e.preventDefault(); addressLongPress(); } });
  bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-update]')) { q.update.install(); return; }
    const b = e.target.closest('[data-action]');
    if (b) {
      if (b.disabled) return;
      if (S.overlay === 'editing') { setOverlay('none').then(() => perform(b.dataset.action)); return; }
      perform(b.dataset.action);
      return;
    }
    if (e.target.closest('[data-address]')) { if (!longPressed) addressTap(); longPressed = false; return; }
    if (e.target.closest('[data-edit-cancel]')) { cancelEditing(); return; }
    if (e.target.closest('[data-edit-clear]')) { const i = $('#edit-input'); i.value = ''; edit.text = ''; i.focus(); fetchSuggestions(); return; }
    const f = e.target.closest('[data-find]');
    if (f) {
      const what = f.dataset.find;
      if (what === 'done') closeFind();
      else if (S.find?.text) q.page.find(S.find.text, { findNext: false, forward: what === 'next' });
    }
  });
  bar.addEventListener('input', (e) => {
    if (e.target.id === 'edit-input') { edit.text = e.target.value; fetchSuggestions(); }
    if (e.target.id === 'find-input') {
      S.find.text = e.target.value;
      // Electron : findNext = true ouvre une NOUVELLE recherche ; false passe au résultat suivant.
      if (S.find.text) q.page.find(S.find.text, { findNext: true, forward: true }); else { q.page.stopFind('clearSelection'); S.find.matches = 0; updateFindCount(); }
    }
  });
  bar.addEventListener('keydown', (e) => {
    if (e.target.id === 'edit-input') {
      const items = suggestionItems();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        edit.index = (edit.index + (e.key === 'ArrowDown' ? 1 : -1) + items.length + 1) % (items.length + 1);
        if (edit.index === items.length) edit.index = -1;
        renderSuggestions();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[edit.index];
        commit(it ? it.text : e.target.value);
      } else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
    }
    if (e.target.id === 'find-input') {
      if (e.key === 'Enter' && S.find?.text) { e.preventDefault(); q.page.find(S.find.text, { findNext: false, forward: !e.shiftKey }); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
    }
  });
  installFolderMenuEvents();
  const bm = $('#bmbar');
  bm.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // pas de défilement automatique
  bm.addEventListener('click', (e) => {
    const o = e.target.closest('[data-bmact]');
    if (o) { perform(o.dataset.bmact); return; }
    if (e.target.closest('.bm-add')) { perform('addBookmark'); return; }
    const fo = e.target.closest('[data-bmfolder]');
    if (fo) { toggleFolderMenu(fo); return; }
    const it = e.target.closest('[data-bm]');
    if (it) openBookmark(e, it);
  });
  bm.addEventListener('auxclick', (e) => { const it = e.target.closest('[data-bm]'); if (it && e.button === 1) openBookmark(e, it); });
  // Clic droit sur un favori, un dossier ou la zone vide de la barre (pas sur les raccourcis de droite) : menu natif.
  bm.addEventListener('contextmenu', async (e) => {
    const it = e.target.closest('[data-bm]');
    const fo = e.target.closest('[data-bmfolder]');
    if (!it && !fo && e.target.closest('.bm-opts')) return;
    e.preventDefault();
    if (S.overlay === 'bmmenu') await setOverlay('none');
    const kind = it ? 'bookmark' : fo ? 'folder' : 'bar';
    const id = it ? it.dataset.bm : fo ? fo.dataset.bmfolder : '';
    const choice = await q.bookmarks.contextMenu(kind, id, e.clientX, e.clientY);
    await bookmarkMenuChoice(choice, kind, id);
  });
  installBarDrag(bm);
  const box = $('#suggest');
  box.addEventListener('mousedown', (e) => e.preventDefault()); // garde le focus dans le champ
  box.addEventListener('click', (e) => {
    const fill = e.target.closest('[data-fill]');
    const items = suggestionItems();
    if (fill) { const it = items[Number(fill.dataset.fill)]; const i = $('#edit-input'); i.value = it.text + ' '; edit.text = i.value; i.focus(); fetchSuggestions(); return; }
    const row = e.target.closest('[data-sg]');
    if (row) commit(items[Number(row.dataset.sg)]?.text);
  });
  q.page.onFound((r) => {
    if (!S.find || !r) return;
    S.find.matches = r.matches || 0;
    S.find.active = r.activeMatchOrdinal || 0;
    updateFindCount();
  });
}

/** Scénario de démonstration : saisie « cara » et suggestions affichées. */
export function demoEditing(text) {
  beginEditing(text);
  setTimeout(() => { edit.text = text; const i = $('#edit-input'); if (i) { i.value = text; i.setSelectionRange(text.length, text.length); } fetchSuggestions(); }, 50);
}

