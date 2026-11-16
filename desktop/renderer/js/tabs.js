// Écran des onglets (DESIGN.md §4) : fond gris groupé, recherche, liste groupée par site (en-tête DOMAINE en
// capitales + nombre, « Autres sites » pour les sites isolés) ou grille de vignettes (captures des pages),
// tri, onglets privés, pilule du bas « + | N onglets ⌃ | OK ».
import { q, S, $, t, esc, settings, favicon, readingLabel, setOverlay, onRender, render } from './core.js';
import { icon } from './icons.js';

const view = { query: '', private: false, popup: false };
const snaps = new Map(); // id → dataURL (capture de la page, rafraîchie à l'ouverture)

function sorted(list) {
  const s = settings().tabsSort || 'date';
  const out = [...list];
  if (s === 'title') out.sort((a, b) => String(a.title).localeCompare(String(b.title), S.state.lang));
  else if (s === 'readingTime') out.sort((a, b) => (b.readingMinutes || 0) - (a.readingMinutes || 0));
  else out.sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0));
  return out;
}

function visibleTabs() {
  const qy = view.query.trim().toLowerCase();
  return sorted(S.state.tabs.filter((x) => !!x.isPrivate === view.private)
    .filter((x) => !qy || String(x.title).toLowerCase().includes(qy) || String(x.url || '').toLowerCase().includes(qy)));
}

/** Groupes par site : sites d'au moins deux onglets dans l'ordre du tri, puis « Autres sites ». */
function groups(list) {
  if (!settings().groupTabsByDomain) return [{ title: null, tabs: list }];
  const by = new Map();
  for (const tab of list) { const k = tab.host || '—'; if (!by.has(k)) by.set(k, []); by.get(k).push(tab); }
  const out = [];
  const others = [];
  for (const [host, tabs] of by) { if (tabs.length >= 2) out.push({ title: host, tabs }); else others.push(...tabs); }
  if (others.length) out.push({ title: out.length ? t('other_sites') : null, tabs: others });
  return out;
}

function rowHTML(tab) {
  const reading = readingLabel(tab);
  const sel = tab.id === S.state.selected;
  return `<div class="t-row${sel ? ' sel' : ''}" data-tab="${tab.id}" role="button" tabindex="0" aria-label="${esc(tab.title)}">
    ${favicon(tab, 26)}
    <span class="t-txt"><span class="t-title"><bdi>${esc(tab.title)}</bdi></span><span class="t-dom">${esc(tab.host || '')}</span></span>
    ${reading ? `<span class="pill">${esc(reading)}</span>` : ''}
    ${sel ? `<span class="t-check">${icon('check', 18)}</span>` : ''}
    <button class="t-close" data-close="${tab.id}" title="${esc(t('action_close_tab'))}">${icon('xmark', 14)}</button>
  </div>`;
}

function cardHTML(tab) {
  const snap = snaps.get(tab.id);
  const sel = tab.id === S.state.selected;
  const ph = `<span class="g-ph">${favicon(tab, 36)}</span>`;
  return `<div class="gt-card${sel ? ' sel' : ''}" data-tab="${tab.id}" role="button" tabindex="0" aria-label="${esc(tab.title)}">
    <div class="g-thumb">${snap ? `<img src="${snap}" alt="">` : ph}<button class="g-close" data-close="${tab.id}" title="${esc(t('action_close_tab'))}">${icon('xmark', 12)}</button></div>
    <div class="g-cap">${favicon(tab, 14)}<span><bdi>${esc(tab.title)}</bdi></span></div>
  </div>`;
}

function popupHTML() {
  const s = settings();
  const nPriv = S.state.tabs.filter((x) => x.isPrivate).length;
  const nNorm = S.state.tabs.length - nPriv;
  const check = (on) => (on ? icon('check', 16) : '<span class="ic-sp"></span>');
  return `<div class="pop" id="tabs-pop">
    <button class="m-line" data-tp="normal"><span class="l">${esc(t('tabs_count', nNorm))}</span>${check(!view.private)}</button>
    <div class="m-sep"></div>
    <button class="m-line" data-tp="private"><span class="l">${esc(t('private_tabs'))}${nPriv ? ` · ${nPriv}` : ''}</span>${check(view.private)}</button>
    <div class="m-gap"></div>
    <button class="m-line" data-tp="layout"><span class="l">${esc(s.tabsLayout === 'grid' ? t('show_as_list') : t('show_as_grid'))}</span>${icon(s.tabsLayout === 'grid' ? 'list' : 'grid', 16)}</button>
    <div class="m-sep"></div>
    <button class="m-line" data-tp="sort"><span class="l">${esc(t('sort_by_value', t({ date: 'sort_date', readingTime: 'sort_reading_time', title: 'sort_title' }[s.tabsSort] || 'sort_date')))}</span>${icon('sort', 16)}</button>
    <div class="m-sep"></div>
    <button class="m-line" data-tp="group"><span class="l">${esc(t('group_by_site'))}</span>${check(s.groupTabsByDomain)}</button>
    <div class="m-gap"></div>
    <button class="m-line" data-tp="settings"><span class="l">${esc(t('tab_settings'))}</span>${icon('sliders', 16)}</button>
    <div class="m-gap"></div>
    <button class="m-line red" data-tp="closeAll"><span class="l">${esc(view.private ? t('close_n_tabs', nPriv) : t('close_n_tabs', nNorm))}</span>${icon('xmarkSquare', 16)}</button>
  </div>`;
}

function renderTabs() {
  const el = $('#tabs');
  const open = S.overlay === 'tabs';
  el.hidden = !open;
  if (!open) { view.popup = false; return; }
  const s = settings();
  const list = visibleTabs();
  const grid = s.tabsLayout === 'grid';
  let body = '';
  if (!list.length) {
    body = `<div class="t-empty">${esc(view.private ? t('no_private_tabs') : (view.query ? t('no_items') : t('no_tabs')))}</div>`;
  } else {
    for (const g of groups(list)) {
      if (g.title) body += `<div class="t-head"><span>${esc(g.title)}</span><span>${g.tabs.length}</span></div>`;
      body += grid ? `<div class="g-grid ${s.thumbnailSize === 'small' ? 'small' : 'large'}">${g.tabs.map(cardHTML).join('')}</div>` : `<div class="t-group">${g.tabs.map(rowHTML).join('')}</div>`;
    }
  }
  const n = S.state.tabs.filter((x) => !!x.isPrivate === view.private).length;
  const label = view.private ? `${t('private_tabs')} · ${n}` : t('tabs_count', n);
  const active = document.activeElement?.id === 'tabs-search';
  // Onglet ayant le focus clavier : retrouvé après la reconstruction de la liste.
  const focusedTab = document.activeElement?.closest?.('#tabs [data-tab]')?.dataset.tab;
  const scroll = $('#tabs-scroll')?.scrollTop || 0;
  el.innerHTML = `<div class="t-scroll${grid ? ' wide' : ''}" id="tabs-scroll"><div class="t-col">
      <label class="t-search">${icon('search', 17)}<input id="tabs-search" type="search" placeholder="${esc(t('search_tabs'))}" value="${esc(view.query)}" spellcheck="false"></label>
      ${body}
    </div></div>
    <div class="t-bottom glass-pill">
      <button class="btn" data-tb="new" title="${esc(view.private ? t('action_new_private_tab') : t('new_tab'))}">${icon(view.private ? 'hand' : 'plus', 22)}</button>
      <button class="t-count${view.private ? ' priv' : ''}" data-tb="popup">${esc(label)} ${icon('chevronUpDown', 14)}</button>
      <button class="text-btn strong" data-tb="ok">${esc(t('done'))}</button>
    </div>
    ${view.popup ? popupHTML() : ''}`;
  const sc = $('#tabs-scroll');
  if (sc) sc.scrollTop = scroll;
  if (active) { const i = $('#tabs-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  else if (focusedTab) el.querySelector(`[data-tab="${CSS.escape(focusedTab)}"]`)?.focus();
}
onRender(renderTabs);

/** Captures des onglets vivants pour la grille (la page affichée est capturée à l'ouverture). */
export async function refreshSnapshots() {
  const ids = S.state.tabs.map((x) => x.id);
  const width = settings().thumbnailSize === 'small' ? 360 : 520;
  for (const id of ids) {
    const d = await q.tabs.snapshot(id, width).catch(() => null);
    if (d) snaps.set(id, d);
  }
  if (S.overlay === 'tabs') render();
}

export function openTabs({ privateMode } = {}) {
  view.query = '';
  view.popup = false;
  if (privateMode !== undefined) view.private = privateMode;
  else view.private = !!S.state.tabs.find((x) => x.id === S.state.selected)?.isPrivate;
  // Clavier : la frappe va au champ de recherche ; Tab / flèches parcourent ensuite les onglets.
  Promise.resolve(setOverlay('tabs')).then(() => $('#tabs-search')?.focus());
  refreshSnapshots();
}

export function installTabsEvents() {
  const el = $('#tabs');
  el.addEventListener('input', (e) => { if (e.target.id === 'tabs-search') { view.query = e.target.value; render(); } });
  el.addEventListener('keydown', onTabsKey);
  el.addEventListener('click', async (e) => {
    const close = e.target.closest('[data-close]');
    if (close) { e.stopPropagation(); snaps.delete(close.dataset.close); await q.tabs.close(close.dataset.close); return; }
    const tp = e.target.closest('[data-tp]');
    if (tp) {
      const s = settings();
      const k = tp.dataset.tp;
      if (k === 'normal' || k === 'private') { view.private = k === 'private'; view.popup = false; }
      else if (k === 'layout') { await q.settings.set('tabsLayout', s.tabsLayout === 'grid' ? 'list' : 'grid'); view.popup = false; refreshSnapshots(); }
      else if (k === 'sort') { const order = ['date', 'readingTime', 'title']; await q.settings.set('tabsSort', order[(order.indexOf(s.tabsSort) + 1) % order.length]); }
      else if (k === 'group') await q.settings.set('groupTabsByDomain', !s.groupTabsByDomain);
      else if (k === 'settings') { view.popup = false; const { openSheet } = await import('./sheet.js'); openSheet('tabsSettings', true); return; }
      else if (k === 'closeAll') { view.popup = false; await q.tabs.closeAll({ privateOnly: view.private }); }
      render();
      return;
    }
    const tb = e.target.closest('[data-tb]');
    if (tb) {
      const k = tb.dataset.tb;
      if (k === 'ok') setOverlay('none');
      else if (k === 'new') { await setOverlay('none'); q.tabs.create({ isPrivate: view.private }); }
      else if (k === 'popup') { view.popup = !view.popup; render(); }
      return;
    }
    if (view.popup && !e.target.closest('#tabs-pop')) { view.popup = false; render(); return; }
    const row = e.target.closest('[data-tab]');
    if (row) { await q.tabs.select(row.dataset.tab); setOverlay('none'); }
  });
}

/** Clavier : Entrée / Espace ouvre l'onglet ; flèches haut / bas (et gauche / droite en grille) passent au voisin. */
function onTabsKey(e) {
  const row = e.target.closest?.('[data-tab]');
  const items = [...$('#tabs').querySelectorAll('[data-tab]')];
  if (e.target.id === 'tabs-search' && e.key === 'ArrowDown' && items.length) { e.preventDefault(); items[0].focus(); return; }
  if (!row || e.target !== row) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); return; }
  const rtl = document.documentElement.dir === 'rtl';
  const step = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const i = items.indexOf(row) + step;
  if (i < 0) $('#tabs-search')?.focus(); else items[Math.min(i, items.length - 1)]?.focus();
}

export function tabsEscape() { if (view.popup) { view.popup = false; render(); return true; } return false; }
export function setTabsDemo(o) { Object.assign(view, o); }
