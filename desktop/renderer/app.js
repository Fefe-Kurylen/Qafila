// Chrome de Qafila — squelette de l'étape 1 : barre flottante (verre, carte d'adresse, rangée d'icônes),
// menu, liste d'onglets et réglages réduits, composition des captures de test. Aucun texte en dur : tout passe
// par les chaînes i18n fournies par le processus principal (config().strings).
const q = window.qafila;
const $ = (sel) => document.querySelector(sel);
const BAR_H = 64;

let cfg = null;
let state = null;
let overlay = 'none';     // none | menu | tabs | settings
let supportInfo = { configured: false };

// ----- Chaînes -----
function plural(lang, n) {
  if (lang === 'fr') return n <= 1 ? 'one' : 'many';
  if (lang === 'ar') return n === 1 ? 'one' : n === 2 ? 'two' : 'other';
  return n === 1 ? 'one' : 'other';
}
function t(key, ...args) {
  let v = cfg?.strings?.[key];
  if (v === undefined) return null;
  if (typeof v === 'object') v = v[plural(cfg.lang, Number(args[0]) || 0)] ?? v.other ?? v.many ?? v.one ?? '';
  let i = 0;
  return String(v).replace(/%(\d+\$)?([ds])|%%/g, (m, pos) => (m === '%%' ? '%' : String(args[pos ? parseInt(pos, 10) - 1 : i++] ?? '')));
}
const snake = (id) => id.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
/** Libellé d'une action : chaîne Android action_<id>, sinon libellé canonique du contrat. */
function actionLabel(id, short = false) {
  const k = 'action_' + snake(id);
  const a = cfg.actions.actions.find((x) => x.id === id);
  return (short && t(k + '_short')) || t(k) || (short ? a?.tileLabel : a?.label) || id;
}

// ----- Icônes (traits fins, provisoires : le jeu complet arrive avec l'interface définitive) -----
const ICONS = {
  back: '<path d="M14.5 5 7.5 12l7 7"/>',
  forward: '<path d="m9.5 5 7 7-7 7"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1.5"/>',
  newTab: '<path d="M12 5v14M5 12h14"/>',
  tabs: '<rect x="5.5" y="5.5" width="13" height="13" rx="3"/>',
  menu: '<circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="18" cy="12" r=".9" fill="currentColor"/>',
  closeTab: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  reload: '<path d="M18.5 12a6.5 6.5 0 1 1-2-4.7"/><path d="M18.5 4.5v3.5H15"/>',
  generic: '<circle cx="12" cy="12" r="6.5"/>',
};
const svg = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || ICONS.generic}</svg>`;

// ----- Rendu -----
function selectedTab() { return state?.tabs.find((x) => x.id === state.selected) || null; }

function applyTheme() {
  const root = document.documentElement;
  const tb = state.settings.toolbar || {};
  root.classList.toggle('dark', !!state.dark);
  root.classList.toggle('bottom', tb.position === 'bottom');
  for (const s of ['classic', 'glass', 'floating']) root.classList.toggle('style-' + s, (tb.style || 'floating') === s);
  const tr = Number(state.settings.glassTransparency);
  root.style.setProperty('--alpha', String(1 - 0.6 * (Number.isFinite(tr) ? tr : 0.5)));
  root.style.setProperty('--bar-h', BAR_H + 'px');
  root.style.setProperty('--strip', BAR_H + 24 + 'px');
  root.lang = state.lang;
  root.dir = state.rtl ? 'rtl' : 'ltr';
}

function addressCard(tab) {
  const host = tab?.host || '';
  const title = tab?.url ? tab.title : (t('new_tab') || '');
  const fav = tab?.faviconURL ? `<img src="${esc(tab.faviconURL)}" alt="">` : esc((host || 'Q').slice(0, 1).toUpperCase());
  const pill = tab?.readingMinutes > 0 && state.settings.addressShowsReadingTime !== false
    ? `<span class="pill">${esc(t('reading_minutes', tab.readingMinutes) || `${tab.readingMinutes} min`)}</span>` : '';
  return `<div class="address"><span class="fav">${fav}</span><span class="txt"><div class="dom">${esc(host)}</div><div class="title">${esc(title)}</div></span>${pill}</div>`;
}

function renderBar() {
  const tab = selectedTab();
  const slots = (state.settings.toolbar?.bar || []).map((s) => s.action).filter((a) => a !== 'address');
  const lead = slots.length >= 4 ? 2 : 0;
  const btn = (a) => {
    const off = (a === 'back' && !tab?.canGoBack) || (a === 'forward' && !tab?.canGoForward);
    const count = a === 'tabs' ? `<span class="count">${state.tabs.length}</span>` : '';
    return `<div class="btn${off ? ' off' : ''}" data-action="${a}" title="${esc(actionLabel(a))}">${svg(a)}${count}</div>`;
  };
  $('#row').innerHTML = slots.slice(0, lead).map(btn).join('') + addressCard(tab) + slots.slice(lead).map(btn).join('');
  const p = $('#progress');
  const loading = tab?.loading;
  p.style.opacity = loading ? '1' : '0';
  p.style.transform = `scaleX(${loading ? Math.max(0.05, tab.progress || 0) : 1})`;
}

function renderMenu() {
  const entries = state.settings.toolbar?.menu || [];
  let html = '';
  let tiles = [];
  const flush = () => { if (tiles.length) { html += `<div class="tiles">${tiles.join('')}</div>`; tiles = []; } };
  for (const e of entries) {
    if (e.action === 'separator') { flush(); html += '<hr>'; continue; }
    const a = cfg.actions.actions.find((x) => x.id === e.action);
    if (!e.showsLabel) tiles.push(`<div class="tile">${esc(actionLabel(e.action, true))}</div>`);
    else { flush(); html += `<div class="item${a?.destructive ? ' red' : ''}">${esc(actionLabel(e.action))}</div>`; }
  }
  flush();
  $('#menu').innerHTML = html.replace(/^(<hr>)+|(<hr>)+$/g, '');
}

function renderTabs() {
  const groups = new Map();
  for (const tab of state.tabs) {
    const k = tab.host || '—';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(tab);
  }
  let html = `<h1>${esc(actionLabel('tabs'))}</h1>`;
  for (const [host, list] of groups) {
    html += `<div class="head">${esc(host)}</div><div class="group">`;
    for (const tab of list) html += `<div class="line"><span class="t">${esc(tab.title)}</span>${tab.readingMinutes ? `<span class="sub">${esc(t('reading_minutes', tab.readingMinutes) || '')}</span>` : ''}</div>`;
    html += '</div>';
  }
  html += `<div class="head" style="text-align:center">${esc(t('tabs_count', state.tabs.length) || '')}</div>`;
  $('#screen').innerHTML = html;
}

function renderSettings() {
  const pages = ['page_gallery', 'page_appearance', 'page_toolbar', 'page_address', 'page_search', 'page_privacy', 'page_reading', 'page_about'];
  let html = `<h1>${esc(actionLabel('settings'))}</h1><div class="group">`;
  const support = supportInfo.configured
    ? `<div class="line" data-support><span class="t">${esc(t('page_support'))}</span></div>`
    : `<div class="line disabled"><span class="t">${esc(t('page_support'))}</span><span class="sub">${esc(t('support_coming_soon'))}</span></div>`;
  html += support + '</div><div class="group">';
  for (const k of pages) html += `<div class="line"><span class="t">${esc(t(k) || k)}</span></div>`;
  html += '</div>';
  $('#screen').innerHTML = html;
}

function render() {
  if (!state || !cfg) return;
  applyTheme();
  renderBar();
  $('#dim').hidden = overlay === 'none';
  $('#menu').hidden = overlay !== 'menu';
  $('#screen').hidden = !['tabs', 'settings'].includes(overlay);
  if (overlay === 'menu') renderMenu();
  if (overlay === 'tabs') renderTabs();
  if (overlay === 'settings') renderSettings();
}

/** Ouvre / ferme une surcouche ; le chrome occupe toute la fenêtre tant qu'elle est ouverte. */
async function setOverlay(name) {
  overlay = name;
  if (name === 'settings') supportInfo = await q.support.info().catch(() => ({ configured: false }));
  await q.ui.setChrome(name === 'none' ? 'strip' : 'full', BAR_H);
  render();
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ----- Interactions minimales -----
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) {
    const a = b.dataset.action;
    if (a === 'back') q.tabs.back(); else if (a === 'forward') q.tabs.forward(); else if (a === 'newTab') q.tabs.create();
    else if (a === 'tabs') setOverlay(overlay === 'tabs' ? 'none' : 'tabs'); else if (a === 'menu') setOverlay(overlay === 'menu' ? 'none' : 'menu');
    else if (a === 'closeTab') q.tabs.close(); else if (a === 'reload') q.tabs.reload(); else if (a === 'share') q.page.share();
    return;
  }
  if (e.target.closest('[data-support]')) { q.support.open(); return; }
  if (e.target.id === 'dim' || e.target.id === 'screen') setOverlay('none');
});

// ----- Faux verre : capture floutée de la page sous la bande -----
q.glass.onFrame((frame) => { $('.glass-img').style.backgroundImage = frame ? `url("${frame.dataURL}")` : 'none'; });

// ----- Commandes du processus principal (raccourcis, scénario de test) -----
q.ui.onCommand((c) => {
  if (c.name === 'demo') setOverlay(c.screen === 'none' ? 'none' : c.screen);
  else if (c.name === 'escape') setOverlay('none');
  else if (c.name === 'screen') setOverlay(['tabs', 'settings'].includes(c.screen) ? c.screen : 'none');
});

// ----- Captures de test : page et chrome composés sur un canevas à la taille de la fenêtre -----
q.test.onComposite(async ({ id, width, height, page, chrome }) => {
  const canvas = $('#composite');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = state?.dark ? '#000' : '#fff';
  ctx.fillRect(0, 0, width, height);
  const draw = async (part) => {
    if (!part) return;
    const img = new Image();
    img.src = part.dataURL;
    await img.decode();
    ctx.drawImage(img, part.bounds.x, part.bounds.y, part.bounds.width, part.bounds.height);
  };
  try { await draw(page); await draw(chrome); q.test.composited(id, canvas.toDataURL('image/png')); } catch { q.test.composited(id, null); }
});

// ----- Démarrage -----
q.state.onChange((s) => { state = s; render(); });
q.ui.onTheme(() => render());
const [c, s] = await Promise.all([q.config(), q.state.get()]);
cfg = c; state = s;
await q.ui.setChrome('strip', BAR_H);
render();
