// Noyau du chrome : état partagé (configuration, état poussé par le processus principal, état de l'interface),
// chaînes i18n, palette de la barre et géométrie de la vue du chrome (bande ou fenêtre entière).
export const q = window.qafila;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Hauteurs (px) : capsule flottante 64 (pilule d'adresse 44, rayon 22 concentrique), barre pleine largeur 56. */
export const BAR = { floating: 64, full: 56, margin: 12 };
export const STRIP = () => barHeight() + 2 * BAR.margin;

export const S = {
  cfg: null,          // config() : contrat, chaînes, langue, application
  state: null,        // état poussé : onglets, favoris, réglages, thème…
  overlay: 'none',    // none | menu | editing | tabs | sheet | tabsMenu
  sheet: [],          // pile des pages de la feuille (réglages, favoris, historique, éditeur, galerie)
  find: null,         // { text, active, matches } quand la recherche dans la page est ouverte
  toast: null,
  supportInfo: { configured: false },
  chromeMode: null,
};

// ----- Chaînes -----
function plural(lang, n) {
  if (lang === 'fr') return n <= 1 ? 'one' : 'many';
  if (lang === 'ar') return n === 1 ? 'one' : n === 2 ? 'two' : 'other';
  return n === 1 ? 'one' : 'other';
}

/** t(clé, ...args) : gabarits Android (%d, %s, %1$s, %%), pluriels avec le nombre en premier argument. */
export function t(key, ...args) {
  let v = S.cfg?.strings?.[key];
  if (v === undefined) return key;
  if (typeof v === 'object') v = v[plural(S.cfg.lang, Number(args[0]) || 0)] ?? v.other ?? v.many ?? v.one ?? '';
  let i = 0;
  return String(v).replace(/%(\d+\$)?([ds])|%%/g, (m, pos) => (m === '%%' ? '%' : String(args[pos ? parseInt(pos, 10) - 1 : i++] ?? '')));
}

const snake = (id) => id.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const LABEL_KEYS = { newTab: 'new_tab', closeAllTabs: 'action_close_all', closeAllAndClear: 'action_close_all_clear', javascript: 'javascript' };

/** Libellé d'une action : chaîne action_<id> (Android), sinon libellé canonique du contrat. */
export function actionLabel(id, short = false) {
  const k = LABEL_KEYS[id] || 'action_' + snake(id);
  const has = (key) => S.cfg?.strings?.[key] !== undefined;
  if (short && has(k + '_short')) return t(k + '_short');
  if (has(k)) return t(k);
  const a = action(id);
  return (short ? a?.tileLabel : a?.label) || id;
}

export function action(id) { return S.cfg?.actions?.actions.find((x) => x.id === id) || null; }

export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ----- Onglets -----
export function selectedTab() { return S.state?.tabs.find((x) => x.id === S.state.selected) || null; }
export function settings() { return S.state?.settings || {}; }
export function toolbar() { return settings().toolbar || { bar: [], menu: [], style: 'floating', position: 'top' }; }

/** Initiale du site : « fr.m.wikipedia.org » → « W ». */
export function brandLetter(host) {
  const labels = String(host || 'qafila').toLowerCase().split('.').filter(Boolean);
  const name = labels.length >= 2 ? labels[labels.length - 2] : (labels[0] || 'q');
  return name.slice(0, 1).toUpperCase();
}

export function shortURL(u) {
  let s = String(u || '');
  for (const p of ['https://', 'http://', 'www.']) if (s.startsWith(p)) s = s.slice(p.length);
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Favicon : image du site, main levée en privé, sinon l'initiale en serif sur un carré gris. */
export function favicon(tab, size = 20) {
  const r = (size * 0.24).toFixed(1);
  const style = `width:${size}px;height:${size}px;border-radius:${r}px;font-size:${(size * 0.55).toFixed(1)}px`;
  if (tab?.faviconURL) return `<span class="fav img" style="${style}"><img src="${esc(tab.faviconURL)}" alt="" onerror="this.parentNode.classList.remove('img');this.replaceWith(document.createTextNode('${esc(brandLetter(tab.host))}'))"></span>`;
  if (tab?.isPrivate) return `<span class="fav" style="${style}"><svg class="ic" viewBox="0 0 24 24" style="width:${(size * 0.7).toFixed(1)}px;height:${(size * 0.7).toFixed(1)}px"><path d="M8.6 12.6V6.3a1.25 1.25 0 0 1 2.5 0v5.2M11.1 11.5V4.9a1.25 1.25 0 0 1 2.5 0v6.6M13.6 11.5V6a1.25 1.25 0 0 1 2.5 0v6.2M16.1 12.2V8.6a1.25 1.25 0 0 1 2.5 0v5.6c0 3.9-2.6 6.6-6.2 6.6-2.4 0-3.9-1-5.2-2.9l-2.4-3.7a1.3 1.3 0 0 1 2.1-1.5l1.7 2.1v-2.2"/></svg></span>`;
  return `<span class="fav" style="${style}">${esc(brandLetter(tab?.host))}</span>`;
}

export function readingLabel(tab) { return tab?.readingMinutes > 0 ? t('reading_minutes', tab.readingMinutes) : null; }

// ----- Couleurs (ChromePalette d'iOS) -----
export const BAR_COLORS = {
  white: [255, 255, 255], mist: [242, 242, 244], lilac: [239, 235, 248], blush: [248, 226, 233],
  slate: [126, 144, 166], graphite: [44, 44, 46], black: [0, 0, 0],
};
export const ACCENTS = {
  mono: null, indigo: [110, 92, 252], blue: [5, 97, 255], teal: [43, 158, 173], green: [3, 148, 92],
  orange: [242, 110, 20], pink: [230, 69, 135], red: [224, 56, 54],
};

function hexToRGB(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

/** Couleur de barre (réglage clair/sombre, Auto = couleur du site), carte d'adresse et thème des icônes. */
export function palette(cfgOverride) {
  const s = settings();
  const dark = !!S.state?.dark;
  const key = dark ? s.barColorDark : s.barColorLight;
  const tab = selectedTab();
  const fallback = dark ? [28, 28, 30] : [242, 242, 247];
  const bar = BAR_COLORS[key] || (key === 'auto' ? hexToRGB(tab?.themeColor) : null) || fallback;
  const l = lum(bar);
  const contentDark = l < 0.55;
  const style = (cfgOverride || toolbar()).style || 'floating';
  const tr = Math.min(1, Math.max(0, Number.isFinite(Number(s.glassTransparency)) ? Number(s.glassTransparency) : 0.5));
  const solid = 1 - tr;
  let card;
  if (style === 'classic') card = contentDark ? `rgba(255,255,255,${l < 0.08 ? 0.13 : 0.16})` : (l > 0.985 ? 'rgb(239,239,244)' : 'rgba(255,255,255,.92)');
  else card = contentDark ? `rgba(255,255,255,${(0.12 + 0.04 * solid).toFixed(3)})` : `rgba(255,255,255,${(0.55 + 0.10 * solid).toFixed(3)})`;
  const alpha = style === 'classic' ? 1 : 1 - 0.6 * tr;
  return { bar, card, contentDark, alpha, transparency: tr, style };
}

export function accentRGB() {
  const a = ACCENTS[settings().accent];
  return a || null;
}

// ----- Géométrie de la vue du chrome -----
/** Hauteur déclarée au processus principal (bande = hauteur + 2 × 12) : capsule 64 → bande 88 ; Classique / Verre → bande 64. */
export function barHeight() { return toolbar().style === 'floating' ? BAR.floating : BAR.full - 16; }

/** Bande (barre seule) ou fenêtre entière (menu, suggestions, écrans) ; le processus principal redimensionne la vue. */
export async function syncChromeMode() {
  const mode = S.overlay === 'none' ? 'strip' : 'full';
  const h = barHeight();
  const sig = mode + h;
  if (S.chromeMode === sig) return;
  S.chromeMode = sig;
  await q.ui.setChrome(mode, h);
}

/** Ouvre / ferme une surcouche : agrandit la vue AVANT d'afficher, la réduit APRÈS avoir masqué. */
export async function setOverlay(name) {
  const opening = name !== 'none';
  S.overlay = name;
  if (opening) { await syncChromeMode(); renderNow(); }
  else { renderNow(); await syncChromeMode(); }
}

// ----- Rendu planifié -----
const renderers = [];
export function onRender(fn) { renderers.push(fn); }
let scheduled = false;
export function render() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; for (const fn of renderers) { try { fn(); } catch (e) { console.error(e); } } });
}
export function renderNow() { for (const fn of renderers) { try { fn(); } catch (e) { console.error(e); } } }

/** Message bref dans la pilule d'adresse (« Ajouté aux favoris »…). */
let toastTimer = null;
export function toast(text) {
  if (!text) return;
  S.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toast = null; render(); }, 1800);
  render();
}
