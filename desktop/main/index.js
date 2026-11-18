'use strict';
// Qafila pour PC — processus principal : une fenêtre, une WebContentsView par onglet sous une vue « chrome »
// transparente (desktop/renderer) qui occupe une bande en haut ou en bas, ou toute la fenêtre quand un menu, les
// suggestions ou un écran (onglets, réglages…) sont ouverts. Lancer avec --demo pour les onglets de démonstration,
// --smoke=<dossier> pour les captures d'écran de test (quitte avec le code 0).
const { app, BrowserWindow, WebContentsView, nativeTheme, ipcMain, session, Menu, dialog, screen, safeStorage, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { Store } = require('./store');
const { TabManager, hostOf, desktopUserAgent } = require('./tabs');
const { Blocker } = require('./blocker');
const { Glass } = require('./glass');
const search = require('./search');
const i18n = require('./i18n');
const ipc = require('./ipc');
const { Vault } = require('./vault');
const { Transfer } = require('./transfer');
const demo = require('./demo');
const { FaviconCache } = require('./favicon');
const shortcuts = require('./shortcuts');
const { APP_ID } = require('./app-id');
const { safeFilename, extensionOf, zoneIdentifier } = require('./filename');
const { Updater } = require('./updater');
const { Extensions } = require('./extensions');

const argv = process.argv.slice(1);
const arg = (name) => { const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : null; };
const SMOKE_DIR = typeof arg('smoke') === 'string' ? arg('smoke') : null;
const DEMO = !!arg('demo') || !!SMOKE_DIR;
const DEMO_DARK = String(arg('demo')).endsWith('-dark');
const OFFLINE = DEMO && arg('online') === null;

const BAR_MARGIN = 12;          // marge de la capsule flottante (DESIGN.md §8)
// Windows : barre de titre Qafila de 40 px (plus haute que celle du système), boutons réduire / agrandir / fermer de
// Windows dessinés par-dessus (titleBarOverlay) aux couleurs de la bande. QAFILA_TITLEBAR=1 la force ailleurs (tests).
const TITLE_SIZES = { small: 32, medium: 40, large: 48 };
const titleBarHeight = () => TITLE_SIZES[Q.store?.settings.titleBarSize] || TITLE_SIZES.medium;
const CUSTOM_TITLEBAR = process.platform === 'win32' || process.env.QAFILA_TITLEBAR === '1';
// Taille minimale modeste : la moitié d'un écran 1920 × 1080 à 100 % (960 px, Ancrage de Windows) ou d'un portable
// 1366 × 768 à 125 % doit tenir, sans que la fenêtre déborde sur sa voisine ni sous la barre des tâches.
const MIN_SIZE = { width: 560, height: 480 };
const DEFAULT_SIZE = { width: 1280, height: 820 };

// Fenêtre unique, nom d'application, pas de clés Google ni de rapporteur de plantage.
app.setName('Qafila');
// Windows : identifiant porté par les raccourcis NSIS (menu Démarrer, bureau). Sans lui, une icône épinglée ouvre un
// second bouton dans la barre des tâches au lieu de s'allumer. Constante (main/app-id.js) : electron-builder retire
// « build » du package.json empaqueté ; un test vérifie qu'elle reste égale à build.appId.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// User agent « Chrome ordinaire » partout (sans Electron/… ni Qafila/…) : la connexion Google l'exige.
app.userAgentFallback = desktopUserAgent(app.userAgentFallback);
if (SMOKE_DIR) {
  app.setPath('userData', path.join(SMOKE_DIR, 'userData'));
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}
// Instance unique : un second lancement transmet ses adresses à la première fenêtre et quitte aussitôt, avant de
// lire state.json ou de créer quoi que ce soit (app.quit() seul laisserait whenReady() s'exécuter).
const GOT_LOCK = app.requestSingleInstanceLock();
if (!GOT_LOCK) app.exit(0);

/** L'application : services et actions partagés par l'IPC et les raccourcis. */
const Q = {
  win: null, chrome: null, store: null, tabs: null, blocker: null, glass: null,
  chromeMode: 'strip', barHeight: 92, t: null, demo: DEMO, isFullscreenPage: false, fullscreenNotice: null,
  collapse: 'none', scrollAcc: 0, collapseQuiet: 0, // Au défilement : 'none' | 'mini' (Réduire) | 'hidden' (Masquer)
  pending: new Map(), broadcastTimer: null, favicons: null, updater: null, extensions: null,
};

function isDark() { return nativeTheme.shouldUseDarkColors; }

function translator() {
  const lang = i18n.resolveLanguage(Q.store?.settings.language, app.getLocale());
  if (!Q.t || Q.t.lang !== lang) Q.t = i18n.translator(lang);
  return Q.t;
}

// ----- Géométrie : bande du chrome, page toujours posée à côté (jamais dessous : rien d'un site n'est caché) -----
const MINI_STRIP = 28;          // Réduire : mini-adresse (domaine seul, 11 px)
const COLLAPSE_AFTER = 48;      // défilement cumulé (px) qui réduit / masque la barre, ou la rouvre en remontant
const COLLAPSE_QUIET_MS = 300;  // après un changement, la page se redimensionne : défilements ignorés (pas d'oscillation)

/** Extensions : liste et onglet dont la barre montre les boutons (jamais un onglet privé). */
function describeExtensions() {
  const x = Q.extensions;
  if (!x || !x.ready) return { ready: false, list: [], actionTab: -1 };
  const tab = Q.store.selectedTab;
  const wc = tab && !tab.isPrivate ? Q.tabs.contents(tab.id) : null;
  return { ready: true, list: x.list(), actionTab: wc && !wc.isDestroyed() ? wc.id : -1 };
}

/** Hauteur de la barre de titre Qafila (0 hors Windows, en plein écran de la fenêtre ou d'une page). */
function titleH() {
  return CUSTOM_TITLEBAR && Q.win && !Q.win.isDestroyed() && !Q.win.isFullScreen() && !Q.isFullscreenPage ? titleBarHeight() : 0;
}
function isTop() { return (Q.store.settings.toolbar?.position || 'top') === 'top'; }

/** Taille de l'interface (barre, menus, réglages) : facteur de zoom du chrome, 0,8 à 1,5. */
function uiScale() { const v = Number(Q.store?.settings.uiScale); return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1; }
function applyUiScale() { const wc = Q.chrome?.webContents; if (wc && !wc.isDestroyed()) wc.setZoomFactor(uiScale()); }

function stripRect() {
  if (!Q.win || Q.win.isDestroyed()) return null;
  const [w, h] = Q.win.getContentSize();
  const t = titleH();
  // La bande est mesurée en pixels CSS du chrome : multipliée par la taille de l'interface.
  let strip = Math.round((Q.barHeight + 2 * BAR_MARGIN) * uiScale());
  if (Q.chromeMode === 'strip' && Q.collapse === 'mini') strip = Math.round(MINI_STRIP * uiScale());
  else if (Q.chromeMode === 'strip' && Q.collapse === 'hidden') strip = 0;
  const height = Math.min(Math.max(0, h - t), strip);
  return { x: 0, y: isTop() ? t : Math.max(t, h - height), width: w, height };
}

/** Rectangle de la page dans la fenêtre : à côté de la bande (sous elle si la barre est en haut, au-dessus sinon). */
function pageRect() {
  const [w, h] = Q.win.getContentSize();
  if (Q.isFullscreenPage) return { x: 0, y: 0, width: w, height: h };
  const t = titleH();
  const strip = stripRect();
  const height = Math.max(0, h - t - strip.height);
  return isTop() ? { x: 0, y: t + strip.height, width: w, height } : { x: 0, y: t, width: w, height };
}

/** Zone de la page capturée pour le faux verre, en coordonnées de la page : ses premières lignes (dernières si la barre est en bas). */
function glassRect() {
  const s = stripRect();
  const p = Q.tabs?.pageBounds;
  if (!s || !p || p.width < 2 || p.height < 2 || s.height < 2) return null;
  const h = Math.min(s.height, p.height);
  return { x: 0, y: isTop() ? 0 : p.height - h, width: p.width, height: h };
}

/**
 * Au défilement (réglage « scrollBehavior ») : Fixe = barre toujours entière ; Réduire = en descendant, il ne reste
 * qu'une mini-adresse (un clic ou une remontée rouvre la barre) ; Masquer = la barre disparaît en descendant et revient
 * en remontant ou quand la souris touche le bord de la fenêtre côté barre. La page grandit d'autant.
 */
function setCollapse(c) {
  if (Q.collapse === c) return;
  Q.collapse = c;
  Q.scrollAcc = 0;
  Q.collapseQuiet = Date.now() + COLLAPSE_QUIET_MS;
  layout();
  broadcast();
}

function onPageScroll(id, { y = 0, dy = 0 } = {}) {
  const mode = Q.store.settings.scrollBehavior || 'fixed';
  if (id !== Q.store.selected || mode === 'fixed' || Q.chromeMode !== 'strip' || Q.isFullscreenPage) return;
  if (Date.now() < Q.collapseQuiet) return;
  if (y <= 8) { setCollapse('none'); return; }
  Q.scrollAcc = Math.sign(dy) === Math.sign(Q.scrollAcc) ? Q.scrollAcc + dy : dy;
  if (Q.scrollAcc > COLLAPSE_AFTER) setCollapse(mode === 'hide' ? 'hidden' : 'mini');
  else if (Q.scrollAcc < -COLLAPSE_AFTER) setCollapse('none');
}

/** Masquer : la souris touche le bord de la fenêtre côté barre (signal de la page) → la barre revient. */
function onPageEdge(id, edge) {
  if (id !== Q.store.selected || Q.collapse !== 'hidden') return;
  if (edge === (Q.store.settings.toolbar?.position || 'top')) setCollapse('none');
}

/**
 * Plein écran demandé par une page : le chrome disparaît, sauf un avis bref en haut (« site en plein écran, Échap pour
 * quitter »), comme Chrome : une page ne peut pas se faire passer pour Qafila sans que l'utilisateur le voie.
 */
const FULLSCREEN_NOTICE_MS = 4000;
function fullscreenNoticeRect(w, h) {
  if (Q.fullscreenNotice === null) return { x: 0, y: h, width: w, height: 0 };
  const width = Math.max(200, Math.min(620, w - 32));
  return { x: Math.round((w - width) / 2), y: 24, width, height: 64 };
}

function onPageFullscreen(on, host) {
  Q.isFullscreenPage = on;
  clearTimeout(Q.fullscreenTimer);
  Q.fullscreenNotice = on ? String(host || '') : null;
  if (on) Q.fullscreenTimer = setTimeout(() => { Q.fullscreenNotice = null; layout(); broadcast(); }, FULLSCREEN_NOTICE_MS);
  layout();
  broadcast();
}

/** Quitte le plein écran de la page (monde isolé : la page ne peut pas remplacer document.exitFullscreen). */
function exitPageFullscreen() {
  const wc = Q.store.selected && Q.tabs.contents(Q.store.selected);
  if (!wc || wc.isDestroyed()) return;
  wc.executeJavaScriptInIsolatedWorld(1002, [{ code: 'document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false' }], true).catch(() => {});
}

function layout() {
  if (!Q.win || Q.win.isDestroyed()) return;
  const [w, h] = Q.win.getContentSize();
  const t = titleH();
  const full = { x: 0, y: t, width: w, height: Math.max(0, h - t) };
  const strip = stripRect();
  const style = Q.store.settings.toolbar?.style || 'floating';
  Q.tabs.setPageBounds(pageRect());
  if (Q.isFullscreenPage) { Q.chrome.setBounds(fullscreenNoticeRect(w, h)); return; }
  Q.chrome.setBounds(Q.chromeMode === 'full' ? full : strip);
  Q.glass.setActive(style !== 'classic');
  Q.glass.refresh(30);
}

/**
 * Le chrome change de géométrie. Le focus clavier natif suit : une vue qui n'a pas le focus ne le prend pas avec
 * element.focus() dans son moteur de rendu, il faut le donner depuis le processus principal.
 * Plein écran (menu, suggestions, écrans) → focus au chrome ; retour à la bande → focus à la page, sauf si la
 * recherche dans la page (logée dans la bande) est ouverte.
 */
function setChrome(mode, height, { find = false } = {}) {
  if (height) Q.barHeight = height;
  const was = Q.chromeMode;
  Q.chromeMode = mode;
  if (mode === 'full' && Q.collapse !== 'none') { Q.collapse = 'none'; Q.scrollAcc = 0; broadcast(); }
  layout();
  if (mode === 'full') focusChrome();
  else if (was === 'full' && !find) Q.tabs.focus();
}

function focusChrome() { if (Q.chrome && !Q.chrome.webContents.isDestroyed()) Q.chrome.webContents.focus(); }

/** Focus demandé par le chrome : 'chrome' (champ de recherche dans la page) ou 'page' (après fermeture). */
function focusUI(target) {
  if (target === 'chrome') focusChrome();
  else if (Q.chromeMode !== 'full') Q.tabs.focus();
}

// ----- État poussé au chrome -----
function describeTabs() {
  const t = translator();
  return Q.store.tabs.map((tab) => {
    const live = Q.tabs.liveState(tab.id);
    const host = hostOf(tab.url || '');
    return {
      id: tab.id, url: tab.url, title: tab.title || (tab.url ? tab.url : t('new_tab')), isPrivate: tab.isPrivate,
      createdAt: tab.createdAt, lastVisited: tab.lastVisited, readingMinutes: tab.readingMinutes,
      // Le chrome ne reçoit qu'une adresse data: (icône téléchargée par la session de l'onglet), jamais l'adresse du site.
      faviconData: tab.isPrivate ? null : Q.favicons.get(tab.faviconURL, Q.tabs.sessionFor(tab)),
      themeColor: tab.themeColorHex, host: host.replace(/^www\./, ''), selected: tab.id === Q.store.selected,
      loading: live.loading, progress: live.progress, canGoBack: live.canGoBack, canGoForward: live.canGoForward,
      blocked: live.blocked, reader: live.reader,
      bookmarked: Q.store.isBookmarked(tab.url), darkened: Q.tabs.isDarkened(tab), desktop: Q.tabs.isDesktop(tab),
      blockerActive: Q.blocker.isActive(tab.url || ''), javascript: Q.tabs.isJavaScriptEnabled(tab.url || ''),
    };
  });
}

function describeState() {
  const t = translator();
  return {
    tabs: describeTabs(), selected: Q.store.selected, bookmarks: Q.store.bookmarks, historyCount: Q.store.history.length,
    settings: Q.store.settings, dark: isDark(), lang: t.lang, rtl: t.rtl, closedTabs: Q.store.closedTabs.length,
    downloads: describeDownloads(), sitePermissions: Q.store.sitePermissions, extensions: describeExtensions(), vault: Q.vault ? Q.vault.status() : { state: 'none' }, transfer: Q.transfer ? Q.transfer.describe() : null, update: Q.updater ? Q.updater.state : { status: 'disabled' }, collapse: Q.chromeMode === 'strip' ? Q.collapse : 'none',
    fullscreenNotice: Q.isFullscreenPage && Q.fullscreenNotice !== null ? { host: Q.fullscreenNotice } : null,
    window: { fullscreen: Q.win?.isFullScreen() || false, maximized: Q.win?.isMaximized() || false, focused: Q.win?.isFocused() || false },
  };
}

function broadcast() {
  clearTimeout(Q.broadcastTimer);
  Q.broadcastTimer = setTimeout(() => {
    if (Q.chrome && !Q.chrome.webContents.isDestroyed()) Q.chrome.webContents.send('qafila:state', describeState());
    updateTitlebar();
  }, 16);
}

/**
 * Barre de titre Windows : couleur de la bande (thème, ou couleur du site en barre « Auto »), envoyée par le chrome
 * (ui:titlebar), titre de l'onglet courant (jamais celui d'un onglet privé) et état actif / inactif de la fenêtre.
 */
function updateTitlebar(colors) {
  if (colors) Q.titlebarColors = colors;
  if (!CUSTOM_TITLEBAR || !Q.win || Q.win.isDestroyed()) return;
  const c = Q.titlebarColors || (isDark() ? { bg: '#000000', fg: '#f2f2f7' } : { bg: '#ffffff', fg: '#1c1c1e' });
  const tab = Q.store?.selectedTab;
  const title = tab && !tab.isPrivate && tab.title && tab.url ? `${tab.title} — Qafila` : 'Qafila';
  const s = { bg: c.bg, fg: c.fg, title, focused: Q.win.isFocused(), height: titleBarHeight() };
  const sig = JSON.stringify(s);
  if (sig === Q.titlebarSig) return;
  try { Q.win.setTitleBarOverlay({ color: c.bg, symbolColor: c.fg, height: s.height }); } catch { /* plate-forme sans overlay */ }
  const wc = Q.win.webContents;
  // Document pas encore chargé : did-finish-load relancera la mise à jour (la signature n'est retenue qu'une fois envoyée).
  if (wc.isDestroyed() || wc.isLoading()) return;
  Q.titlebarSig = sig;
  wc.executeJavaScript(`window.__qafilaTitlebar && window.__qafilaTitlebar(${sig})`, false).catch(() => { Q.titlebarSig = ''; });
}

function command(name, data) {
  if (!Q.chrome || Q.chrome.webContents.isDestroyed()) return;
  // Ctrl+L / Ctrl+F depuis une page : le champ d'adresse ou de recherche doit recevoir la frappe, pas la page.
  if (name === 'focusAddress' || name === 'find' || name === 'screen') focusChrome();
  // La recherche dans la page loge dans la barre : une barre réduite ou masquée revient d'abord.
  if (name === 'find') setCollapse('none');
  Q.chrome.webContents.send('qafila:command', { name, ...data });
}

// ----- Actions -----
/**
 * Nouvel onglet. `focus` (Ctrl+T, Ctrl+Shift+N, bouton +) : sans adresse imposée, la frappe va au champ d'adresse du
 * nouvel onglet, comme dans tout navigateur de bureau ; un onglet ouvert sur une adresse (lien, favori) garde le
 * focus dans la page.
 */
function newTab({ url = null, isPrivate = false, select = true, focus = false } = {}) {
  const target = url || search.newTabURL(Q.store.settings);
  const tab = Q.store.addTab({ url: target, isPrivate, select });
  const toAddress = select && focus && !url;
  if (select) showSelected({ focusPage: !toAddress });
  else Q.tabs.ensure(tab.id);
  broadcast();
  if (toAddress) {
    command('focusAddress');
    // Le premier chargement de la vue peut lui rendre le focus natif : le champ d'adresse le reprend ensuite.
    const wc = Q.tabs.contents(tab.id);
    wc?.once('did-finish-load', () => { if (Q.chromeMode === 'full' && Q.store.selected === tab.id) focusChrome(); });
  }
  return tab;
}

function selectTab(id) { Q.store.select(id); showSelected(); broadcast(); }

function showSelected({ focusPage = true } = {}) {
  const tab = Q.store.selectedTab;
  if (!tab) { if (!Q.store.tabs.length) newTab(); return; }
  Q.tabs.show(tab.id);
  Q.tabs.applyUserAgent(tab.id);
  if (focusPage && (!Q.chromeMode || Q.chromeMode === 'strip')) Q.tabs.focus();
  Q.glass.refresh(80);
}

function closeTab(id) {
  const tab = Q.store.removeTab(id);
  if (!tab) return;
  Q.tabs.discard(id);
  popupNotices.delete(id);
  if (tab.isPrivate && !Q.store.tabs.some((t) => t.isPrivate)) Q.tabs.dropPrivateData();
  if (!Q.store.tabs.length) newTab(); else showSelected();
  broadcast();
}

function closeAllTabs(privateOnly = null) {
  const doomed = Q.store.tabs.filter((t) => privateOnly === null || t.isPrivate === privateOnly);
  for (const t of doomed) { Q.store.removeTab(t.id); Q.tabs.discard(t.id); }
  if (!Q.store.tabs.some((t) => t.isPrivate)) Q.tabs.dropPrivateData();
  if (Q.store.settings.clearDataOnCloseAll && privateOnly !== true) clearData();
  if (!Q.store.tabs.length) newTab(); else { if (!Q.store.selectedTab) Q.store.select(Q.store.tabs[Q.store.tabs.length - 1].id); showSelected(); }
  broadcast();
}

function reopenTab() {
  const last = Q.store.closedTabs.pop();
  if (!last) return null;
  const tab = Q.store.addTab({ url: last.url, isPrivate: false, select: true, index: last.index });
  Q.store.updateTab(tab.id, { title: last.title, readingMinutes: last.readingMinutes, faviconURL: last.faviconURL });
  showSelected();
  broadcast();
  return tab.id;
}

function moveTab(id, index) {
  const from = Q.store.tabs.findIndex((t) => t.id === id);
  if (from < 0 || !Number.isInteger(index)) return;
  const [tab] = Q.store.tabs.splice(from, 1);
  Q.store.tabs.splice(Math.max(0, Math.min(index, Q.store.tabs.length)), 0, tab);
  Q.store.scheduleSave();
  broadcast();
}

function navigate(text, id = Q.store.selected) {
  const url = search.urlFromInput(text, Q.store.settings);
  if (!url || !id) return;
  Q.tabs.load(id, url);
  Q.store.updateTab(id, { url: /^https?:/.test(url) ? url : Q.store.tabs.find((t) => t.id === id)?.url || null });
  broadcast();
}

function goHome(id = Q.store.selected) { if (id) { Q.tabs.load(id, search.newTabURL(Q.store.settings)); broadcast(); } }

function toggleBookmark() {
  const tab = Q.store.selectedTab;
  if (!tab?.url || !/^https?:/.test(tab.url)) return null;
  const t = translator();
  let result;
  if (Q.store.isBookmarked(tab.url)) { Q.store.removeBookmark(tab.url); result = { bookmarked: false, toast: t('toast_bookmark_removed') }; }
  else { Q.store.addBookmark(tab.title || tab.url, tab.url); result = { bookmarked: true, toast: t('toast_bookmark_added') }; }
  Q.tabs.refreshStartPages();
  broadcast();
  return result;
}

function toggleDarken() {
  const tab = Q.store.selectedTab;
  if (!tab) return;
  const h = hostOf(tab.url || '');
  if (!h) Q.store.setSetting('darkenSites', !Q.store.settings.darkenSites); else Q.store.toggleHost('darkenHosts', h);
  Q.tabs.applyDarken(tab.id);
  broadcast();
}

function toggleDesktop() {
  const tab = Q.store.selectedTab;
  const h = hostOf(tab?.url || '');
  if (!h) return;
  Q.store.toggleHost('desktopHosts', h);
  Q.tabs.applyUserAgent(tab.id);
  Q.tabs.reload(tab.id);
  broadcast();
}

function toggleBlocker() {
  const tab = Q.store.selectedTab;
  const h = hostOf(tab?.url || '');
  if (!h) return;
  Q.store.toggleHost('blockerDisabledHosts', h);
  Q.tabs.reload(tab.id);
  broadcast();
}

function toggleJavascript() {
  const tab = Q.store.selectedTab;
  const h = hostOf(tab?.url || '');
  if (!h) { Q.store.setSetting('javascriptEnabled', !Q.store.settings.javascriptEnabled); onSettingChanged('javascriptEnabled'); return; }
  Q.store.toggleHost('javascriptDisabledHosts', h);
  onSettingChanged('javascriptDisabledHosts');
}

function zoom(delta) {
  const cur = Number(Q.store.settings.textZoom) || 100;
  const next = delta === 0 ? 100 : Math.round(cur + delta);
  Q.store.setSetting('textZoom', next);
  Q.tabs.applyZoom();
  broadcast();
}

async function clearData() {
  await Q.tabs.clearData();
  // Session par défaut (anciennes suggestions envoyées avec cookies et cache disque) : vidée aussi. Le chrome n'y
  // garde rien (aucun stockage local).
  await Promise.all([session.defaultSession.clearStorageData(), session.defaultSession.clearCache()].map((p) => p.catch(() => {})));
  Q.store.clearHistory();
  // Rien ne doit permettre de retrouver les sites effacés : onglets fermés (Ctrl+Maj+T), icônes en mémoire, sites
  // restés en http, décisions de téléchargement.
  Q.store.closedTabs = [];
  Q.favicons?.entries.clear();
  Q.tabs.httpOnlyHosts.clear();
  Q.tabs.privateHttpOnlyHosts.clear();
  downloadSites.clear();
  privateDownloadSites.clear();
  blockedNotified.clear();
  broadcast();
  return true;
}

function onSettingChanged(key) {
  const s = Q.store.settings;
  if (key === 'appearance') nativeTheme.themeSource = s.appearance;
  if (key === 'toolbar' || key === 'scrollBehavior') { Q.collapse = 'none'; Q.scrollAcc = 0; layout(); }
  // JavaScript : appliqué à chaque navigation (en-tête CSP) ; les pages ouvertes sont rechargées pour le prendre en compte.
  // Service workers des sites dont JavaScript est coupé supprimés d'abord (voir TabManager.reloadForJavaScript).
  if (key === 'javascriptEnabled') Q.tabs.reloadForJavaScript(s.javascriptEnabled ? [] : null);
  if (key === 'javascriptDisabledHosts') Q.tabs.reloadForJavaScript(s.javascriptDisabledHosts || []);
  if (key === 'textZoom') Q.tabs.applyZoom();
  if (key === 'language') { Q.t = null; translator(); Q.tabs.refreshStartPages(); }
  // Mises à jour automatiques réactivées : recherche tout de suite (sinon au prochain passage, toutes les 6 heures).
  if (key === 'autoUpdate' && s.autoUpdate && Q.updater) Q.updater.check();
  if (key === 'titleBarSize') { updateTitlebar(); layout(); }
  if (key === 'uiScale') { applyUiScale(); layout(); }
  if (['darkenSites', 'darkenOnlyInDarkMode', 'darkenHosts'].includes(key)) Q.tabs.refreshDarken();
  if (['desktopByDefault', 'desktopHosts', 'customUserAgent'].includes(key)) Q.tabs.applyUserAgentToOpenTabs();
  if (['blockAds', 'blockTrackers', 'blockCookieBanners', 'blockerDisabledHosts'].includes(key)) { /* pris en compte à la prochaine requête */ }
  broadcast();
}

// Suggestions du moteur : session en mémoire, sans cookies ni cache. La frappe (onglets privés compris) ne laisse
// aucune trace sur le disque et le moteur ne peut pas la relier à un identifiant persistant (NID, MUID…).
let suggestSes = null;
function suggestFetch(url, signal) {
  suggestSes ||= session.fromPartition('qafila-suggest');
  return suggestSes.fetch(url, { signal, credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } });
}

/** Suggestions : favoris et historique locaux, puis le moteur (sauf réglage « Jamais » / onglet privé). */
async function suggest(query) {
  const q = query.trim().toLowerCase();
  if (!q) return { local: Q.store.bookmarks.slice(0, 6).map((b) => ({ kind: 'bookmark', title: b.title, url: b.url })), remote: [] };
  const seen = new Set();
  const local = [];
  for (const b of Q.store.bookmarks) if ((b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) && !seen.has(b.url)) { seen.add(b.url); local.push({ kind: 'bookmark', title: b.title, url: b.url }); }
  for (const h of Q.store.history) { if (local.length >= 8) break; if ((h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) && !seen.has(h.url)) { seen.add(h.url); local.push({ kind: 'history', title: h.title, url: h.url }); } }
  const s = Q.store.settings;
  const priv = !!Q.store.selectedTab?.isPrivate;
  let remote = [];
  if (OFFLINE) return { local, remote: s.suggestions === 'never' ? [] : demo.demoSuggestions(query) };
  if (s.suggestions === 'everywhere' || (s.suggestions === 'notPrivate' && !priv)) {
    const base = search.suggestURL(s);
    if (base) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await suggestFetch(base + search.encodeQuery(query), ctrl.signal);
        clearTimeout(timer);
        const json = await res.json();
        const list = Array.isArray(json) ? (Array.isArray(json[1]) ? json[1] : json) : (json.suggestions || []);
        remote = list.map((x) => (typeof x === 'string' ? x : x?.phrase || x?.text || '')).filter(Boolean).slice(0, 6);
      } catch { remote = []; }
    }
  }
  return { local, remote };
}

// ----- Raccourcis clavier (depuis une page ou depuis le chrome) : table dans main/shortcuts.js -----
function shortcut(event, input) {
  const cmd = shortcuts.resolve(input, process.platform);
  if (!cmd) return false;
  const sel = Q.store.selected;
  const run = (fn) => { event.preventDefault(); fn(); return true; };
  if (cmd === 'escape') {
    // Plein écran demandé par la page : Échap en sort toujours (la page ne peut pas l'intercepter, ce gestionnaire
    // passe avant elle).
    if (Q.isFullscreenPage) return run(() => exitPageFullscreen());
    if (Q.chromeMode === 'full') return run(() => command('escape'));
    command('escape'); // ferme la recherche dans la page si elle est ouverte (sans retirer Échap à la page)
    if (Q.tabs.isLoading(sel)) return run(() => Q.tabs.stop(sel));
    return false;
  }
  if (cmd.startsWith('tab:')) {
    const n = Number(cmd.slice(4));
    return run(() => { const i = n === 9 ? Q.store.tabs.length - 1 : n - 1; const tab = Q.store.tabs[i]; if (tab) selectTab(tab.id); });
  }
  switch (cmd) {
    case 'back': return run(() => Q.tabs.back(sel));
    case 'forward': return run(() => Q.tabs.forward(sel));
    case 'reload': return run(() => Q.tabs.reload(sel));
    case 'fullscreen': return run(() => Q.win.setFullScreen(!Q.win.isFullScreen()));
    // Outils de développement de la page (comme « Inspecter » du menu contextuel).
    case 'devtools': return run(() => { const wc = Q.tabs.contents(sel); if (wc) wc.toggleDevTools(); });
    case 'newTab': return run(() => newTab({ isPrivate: false, focus: true }));
    case 'newPrivateTab': return run(() => newTab({ isPrivate: true, focus: true }));
    case 'reopenTab': return run(() => reopenTab());
    case 'closeTab': return run(() => closeTab(sel));
    case 'nextTab': return run(() => cycleTab(1));
    case 'prevTab': return run(() => cycleTab(-1));
    case 'focusAddress': return run(() => command('focusAddress'));
    case 'find': return run(() => command('find'));
    case 'bookmark': return run(() => command('bookmark'));
    case 'history': return run(() => command('screen', { screen: 'history' }));
    case 'bookmarks': return run(() => command('screen', { screen: 'bookmarks' }));
    case 'tabs': return run(() => command('screen', { screen: 'tabs' }));
    case 'settings': return run(() => command('screen', { screen: 'settings' }));
    case 'zoomIn': return run(() => zoom(10));
    case 'zoomOut': return run(() => zoom(-10));
    case 'zoomReset': return run(() => zoom(0));
    default: return false;
  }
}

function cycleTab(dir) {
  const i = Q.store.tabs.findIndex((t) => t.id === Q.store.selected);
  if (i < 0) return;
  const n = Q.store.tabs.length;
  selectTab(Q.store.tabs[(i + dir + n) % n].id);
}

// ----- Téléchargements -----
const downloads = new Map(); // identifiant → { name, received, total, state }

function downloadFolder() {
  const custom = Q.store.settings.downloadFolder;
  if (custom && path.isAbsolute(custom)) { try { if (fs.statSync(custom).isDirectory()) return custom; } catch { /* dossier disparu */ } }
  return app.getPath('downloads');
}

// Chemins promis à des téléchargements encore en cours : deux fichiers du même nom lancés ensemble (double clic,
// deux pièces jointes « document.pdf ») ne s'écrasent jamais. Windows et macOS ignorent la casse.
const reservedPaths = new Set();
const pathKey = (p) => (process.platform === 'linux' ? p : p.toLowerCase());

/** Chemin libre dans le dossier : « nom.ext », puis « nom (1).ext », « nom (2).ext »… (ni sur le disque ni réservé). */
function uniquePath(dir, filename) {
  const safe = safeFilename(filename);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  const taken = (p) => fs.existsSync(p) || reservedPaths.has(pathKey(p));
  let candidate = path.join(dir, safe);
  for (let i = 1; taken(candidate) && i < 1000; i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

// Zone d'attente : un téléchargement qui attend la réponse de l'utilisateur n'est jamais écrit sous son nom final
// (Chromium écrit le fichier entier même mis en pause dans « will-download »). Sous-dossier caché du dossier de
// téléchargement : même volume, donc le déplacement final est un renommage (ni copie, ni place prise ailleurs : /tmp
// en mémoire sous Linux, %TEMP% sur C: quand les téléchargements vont sur D:). Propre au profil (une seule instance
// par profil), privé (0700, à soi, jamais un lien ni un dossier créé par un autre compte : sinon repli dans le
// profil), vidé au démarrage et à la fermeture, supprimé dès qu'il est vide.
const pendingUse = new Map(); // zone d'attente → fichiers en cours d'utilisation
function pendingDir(folder = downloadFolder()) {
  const tag = crypto.createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 12);
  return path.join(folder, `.qafila-pending-${tag}`);
}
const fallbackPendingDir = () => path.join(app.getPath('userData'), 'pending');

/** Prend une place dans une zone d'attente sûre pour le dossier de téléchargement actuel (null : aucune). */
function acquirePendingDir() {
  for (const dir of [pendingDir(), fallbackPendingDir()]) {
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const st = fs.lstatSync(dir);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (process.platform !== 'win32') {
        if (st.uid !== process.getuid()) continue;
        if (st.mode & 0o077) fs.chmodSync(dir, 0o700);
      } else if (!pendingUse.has(dir)) {
        execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'attrib.exe'), ['+h', dir], { windowsHide: true }, () => { /* échec : ignoré */ });
      }
      pendingUse.set(dir, (pendingUse.get(dir) || 0) + 1);
      return dir;
    } catch { /* dossier en lecture seule : suivant */ }
  }
  return null;
}
/** Rend la place ; zone vide : supprimée (synchrone, donc jamais pendant qu'un autre téléchargement la prend). */
function releasePendingDir(dir) {
  const n = (pendingUse.get(dir) || 1) - 1;
  if (n > 0) { pendingUse.set(dir, n); return; }
  pendingUse.set(dir, 0);
  try { fs.rmdirSync(dir); } catch { /* pas encore vide (Chromium) : vidée à la fermeture */ }
}
function clearPendingDirs() {
  const dirs = new Set([...pendingUse.keys(), fallbackPendingDir()]);
  try { dirs.add(pendingDir()); } catch { /* réglages pas encore chargés */ }
  for (const dir of dirs) {
    try { if (!fs.lstatSync(dir).isSymbolicLink()) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* absent ou verrouillé : ignoré */ }
  }
}

/**
 * Déplace un fichier confirmé de la zone d'attente vers le dossier de téléchargement. Le nom choisi est réservé avant
 * toute attente : plusieurs fichiers du même nom acceptés par une seule réponse ne s'écrasent pas. Autre volume
 * (dossier changé pendant la question, zone de repli) : copie sous un nom caché du même volume, puis renommage.
 */
async function moveIntoPlace(src, name) {
  const dir = downloadFolder();
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* erreur au renommage */ }
  const dest = uniquePath(dir, name);
  const key = pathKey(dest);
  reservedPaths.add(key);
  try {
    try { fs.renameSync(src, dest); return dest; } catch (e) { if (e.code === 'ENOENT') throw e; /* EXDEV, fichier verrouillé : copie */ }
    const stageDir = acquirePendingDir();
    const stage = stageDir ? path.join(stageDir, crypto.randomUUID()) : path.join(dir, `.qafila-${crypto.randomUUID()}.part`);
    try {
      await fs.promises.copyFile(src, stage, fs.constants.COPYFILE_EXCL);
      fs.renameSync(stage, dest);
    } catch (e) {
      try { fs.rmSync(stage, { force: true }); } catch { /* ignoré */ }
      throw e;
    } finally { if (stageDir) releasePendingDir(stageDir); }
    try { fs.rmSync(src, { force: true }); } catch { /* vidée à la fermeture */ }
    return dest;
  } finally { reservedPaths.delete(key); }
}

/**
 * Marque d'origine Internet (Chromium la pose par un service qu'Electron ne branche pas) : Windows, flux
 * Zone.Identifier (SmartScreen, mode protégé d'Office, blocage des macros) ; macOS, attribut com.apple.quarantine
 * (Gatekeeper). L'adresse source n'est jamais écrite pour un téléchargement privé. Volume FAT ou erreur : ignoré.
 */
function markFromInternet(file, url, isPrivate) {
  if (process.platform === 'win32') {
    try { fs.writeFileSync(`${file}:Zone.Identifier`, zoneIdentifier(url, isPrivate)); } catch { /* volume sans flux NTFS */ }
  } else if (process.platform === 'darwin') {
    const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};Qafila;`;
    execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, file], () => { /* échec : ignoré */ });
  }
}

// Téléchargements automatiques sans geste de l'utilisateur : décision par site pour la session. La navigation privée a
// ses propres décisions, oubliées avec la dernière page privée.
const downloadSites = new Map(); // hôte → true | false | Promise<boolean> (question en cours)
const privateDownloadSites = new Map();
const sitesFor = (isPrivate) => (isPrivate ? privateDownloadSites : downloadSites);
const riskyPrompts = new Set();   // webContents dont une question « fichier exécutable » est ouverte
const blockedNotified = new Set(); // « priv:hôte » / « hôte » déjà signalés comme bloqués (un seul message par site)
const MAX_WAITING_PER_SITE = 5;    // fichiers en zone d'attente par site pendant une question ; au-delà, annulés
const waitingBySite = new Map();

/** Demande une seule fois par site s'il peut télécharger plusieurs fichiers (règle de Chrome). */
function allowMultipleDownloads(host, isPrivate) {
  const sites = sitesFor(isPrivate);
  if (sites.has(host)) return Promise.resolve(sites.get(host));
  const t = translator();
  const asked = dialog.showMessageBox(Q.win, {
    type: 'question', buttons: [t('download_allow'), t('download_block')], defaultId: 1, cancelId: 1, noLink: true,
    message: t('download_multiple', host),
  }).then((r) => r.response === 0, () => false);
  sites.set(host, asked);
  return asked.then((ok) => { sites.set(host, ok); return ok; });
}

// Fichiers capables d'exécuter du code ou d'ouvrir autre chose (Windows d'abord, puis macOS et Linux). Sans geste
// récent de l'utilisateur dans la page, même le premier téléchargement automatique attend sa confirmation.
const RISKY_EXTENSIONS = new Set(`exe msi msix msixbundle appx appxbundle appinstaller appref-ms application bat cmd com
  scr pif cpl dll sys drv ocx hta js jse vbs vbe wsf wsh wsc ps1 psm1 psd1 ps1xml psc1 msc msp mst lnk url scf inf reg
  library-ms search-ms searchconnector-ms settingcontent-ms website gadget chm hlp iso img vhd vhdx jar jnlp xll xlam
  docm dotm xlsm xltm pptm potm ppam html htm xhtml xht shtml mht mhtml svg app command tool pkg mpkg dmg terminal
  workflow scpt sh bash zsh csh ksh run deb rpm appimage desktop py pyw pl rb`.split(/\s+/).filter(Boolean));

function pageHost(wc) {
  let u = '';
  try { u = wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch { u = ''; }
  try { return new URL(u).host || u.slice(0, 80); } catch { return u.slice(0, 80); }
}

/**
 * Nouveau téléchargement. Libre (geste de l'utilisateur, premier fichier automatique d'une page) : écrit directement
 * sous un nom unique du dossier. Sinon il part en zone d'attente et n'arrive dans le dossier que si l'utilisateur
 * accepte ET que le fichier est complet ; refusé, il est supprimé. Une seule question « fichier exécutable » à la
 * fois par page ; un refus vaut pour le site pendant la session (les suivants sont annulés sans question).
 */
function onDownload(item, wc, isPrivate) {
  const t = translator();
  const name = safeFilename(item.getFilename());
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const live = !!(wc && !wc.isDestroyed());
  const sites = sitesFor(isPrivate);
  const notifyBlocked = (host) => {
    const k = `${isPrivate ? 'priv:' : ''}${host}`;
    if (blockedNotified.has(k)) return;
    blockedNotified.add(k);
    command('toast', { text: t('download_blocked', host) });
  };

  // 1) Décision : null = libre ; sinon promesse de la réponse (true : garder).
  let decision = null;
  let site = '';
  let refused = false;
  const risky = RISKY_EXTENSIONS.has(extensionOf(name)) && !(live && Q.tabs.recentGesture(wc));
  if (risky) {
    site = pageHost(wc);
    if (sites.get(site) === false) { refused = true; notifyBlocked(site); }
    else if (live && riskyPrompts.has(wc.id)) refused = true; // question déjà ouverte pour cette page : annulé sans bruit
    else {
      const wcId = live ? wc.id : 0;
      if (wcId) riskyPrompts.add(wcId);
      decision = dialog.showMessageBox(Q.win, {
        type: 'warning', buttons: [t('download_keep'), t('cancel')], defaultId: 1, cancelId: 1, noLink: true,
        message: t('download_risky', site, name),
      }).then((r) => r.response === 0, () => false).then((ok) => {
        riskyPrompts.delete(wcId);
        if (!ok) { sites.set(site, false); command('toast', { text: t('download_canceled', name) }); }
        return ok;
      });
    }
  } else {
    // Un geste (clic, touche) = un téléchargement ; le premier téléchargement automatique d'une page passe aussi.
    const verdict = Q.tabs.downloadVerdict(wc);
    if (verdict.ask) {
      site = verdict.host;
      if (sites.get(site) === true) { /* site déjà autorisé pour la session : libre, sans zone d'attente */ }
      else if (sites.get(site) === false) { refused = true; notifyBlocked(site); }
      else if ((waitingBySite.get(site) || 0) >= MAX_WAITING_PER_SITE) refused = true;
      else decision = allowMultipleDownloads(site, isPrivate).then((ok) => { if (!ok) notifyBlocked(site); return ok; });
    }
  }

  // 2) Destination : nom final réservé (libre) ou fichier anonyme de la zone d'attente (question, refus).
  const gated = refused || !!decision;
  let file;
  let pending = null;
  if (gated) {
    pending = acquirePendingDir();
    if (!pending) { item.cancel(); if (!refused) command('toast', { text: t('download_failed', name) }); return; }
    file = path.join(pending, crypto.randomUUID());
  } else {
    const dir = downloadFolder();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* repli : dialogue d'Electron */ }
    file = uniquePath(dir, name);
    reservedPaths.add(pathKey(file));
  }
  item.setSavePath(file);
  // Fichier anonyme de la zone d'attente supprimé (synchrone, avant de rendre la place : zone vide supprimée).
  const dropPending = () => { try { fs.rmSync(file, { force: true }); } catch { /* vidée à la fermeture */ } releasePendingDir(pending); };
  if (refused) { item.once('done', dropPending); item.cancel(); return; }

  const track = () => {
    downloads.set(key, { name, received: item.getReceivedBytes(), total: item.getTotalBytes(), state: 'progressing' });
    command('toast', { text: t('download_started', name) });
    broadcast();
  };
  item.on('updated', () => { const d = downloads.get(key); if (d) { d.received = item.getReceivedBytes(); d.total = item.getTotalBytes(); broadcast(); } });

  // 3) Fin : il faut l'état final de Chromium et, en zone d'attente, la réponse de l'utilisateur.
  let ended = null;
  let accepted = gated ? null : true;
  let settled = false;
  const settle = async () => {
    if (ended === null || accepted === null || settled) return;
    settled = true; // item.cancel() peut émettre « done » avant la fin de la réponse : une seule conclusion
    const tracked = downloads.delete(key);
    if (!gated) reservedPaths.delete(pathKey(file));
    if (accepted && ended === 'completed') {
      let dest = file;
      if (gated) {
        try { dest = await moveIntoPlace(file, name); } catch {
          dropPending();
          command('toast', { text: t('download_failed', name) });
          broadcast();
          return;
        }
        releasePendingDir(pending);
      }
      markFromInternet(dest, item.getURL(), isPrivate);
      command('toast', { text: t('download_done', path.basename(dest)) });
      if (process.platform === 'darwin') app.dock?.downloadFinished(dest);
      lastDownload = dest;
    } else {
      if (gated) dropPending();
      if (accepted && ended !== 'cancelled' && tracked) command('toast', { text: t('download_failed', name) });
    }
    broadcast();
  };
  item.once('done', (_e, state) => { ended = state; settle(); });

  if (!gated) { track(); return; }
  item.pause(); // n'empêche pas l'écriture (zone d'attente), mais économise le réseau en attendant la réponse
  waitingBySite.set(site, (waitingBySite.get(site) || 0) + 1);
  decision.then((ok) => {
    waitingBySite.set(site, Math.max(0, (waitingBySite.get(site) || 1) - 1));
    accepted = ok;
    if (ended === null) {
      if (ok) { track(); item.resume(); } else item.cancel();
    }
    settle();
  });
}
let lastDownload = null;

function describeDownloads() {
  const list = [...downloads.values()];
  const total = list.reduce((a, d) => a + (d.total || 0), 0);
  const received = list.reduce((a, d) => a + (d.received || 0), 0);
  return { active: list.length, progress: total > 0 ? Math.min(1, received / total) : null, folder: downloadFolder(), last: lastDownload ? path.basename(lastDownload) : null };
}

// ----- Captures d'écran (tests) : page + chrome composés par le chrome lui-même (canvas) -----
async function screenshot(name) {
  if (!SMOKE_DIR && !DEMO) return null;
  const dir = SMOKE_DIR || app.getPath('pictures');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name.replace(/[^\w.-]/g, '_')}.png`);
  const pageWC = Q.store.selected && Q.tabs.contents(Q.store.selected);
  const [w, h] = Q.win.getContentSize();
  const pageBounds = Q.tabs.pageBounds;
  let page = null;
  try { page = pageWC && !pageWC.isDestroyed() ? await pageWC.capturePage() : null; } catch { page = null; }
  let chrome = null;
  try { chrome = await Q.chrome.webContents.capturePage(); } catch { chrome = null; }
  let title = null;
  try { title = titleH() ? await Q.win.webContents.capturePage({ x: 0, y: 0, width: w, height: titleH() }) : null; } catch { title = null; }
  const id = `${Date.now()}-${Math.random()}`;
  const chromeBounds = Q.chrome.getBounds();
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { Q.pending.delete(id); resolve(null); }, 5000);
    Q.pending.set(id, (dataURL) => { clearTimeout(timer); resolve(dataURL); });
    Q.chrome.webContents.send('qafila:test:composite', {
      id, width: w, height: h,
      page: page && !page.isEmpty() ? { dataURL: page.toDataURL(), bounds: pageBounds } : null,
      chrome: chrome && !chrome.isEmpty() ? { dataURL: chrome.toDataURL(), bounds: chromeBounds } : null,
      title: title && !title.isEmpty() ? { dataURL: title.toDataURL(), bounds: { x: 0, y: 0, width: w, height: titleH() } } : null,
    });
  });
  if (result) fs.writeFileSync(file, Buffer.from(result.split(',')[1], 'base64'));
  else if (page) fs.writeFileSync(file, page.toPNG());
  return file;
}

ipcMain.on('qafila:test:composited', (e, msg) => {
  if (!ipc.isChromeSender(e, Q.chrome?.webContents)) return;
  const { id, dataURL } = msg || {};
  if (typeof dataURL !== 'string' && dataURL !== null) return;
  const cb = Q.pending.get(id); if (cb) { Q.pending.delete(id); cb(dataURL); } });

// ----- Fenêtre -----
const popupNotices = new Map(); // onglet → { shown, at } : message « fenêtre surgissante bloquée » (voir createWindow)
/**
 * Menu de l'application. macOS : menus standard (Qafila, Édition, Présentation, Fenêtre) : Cmd+C / V / X / A / Z
 * et Cmd+Q passent par leurs rôles. Windows / Linux : aucune barre de menus ; Chromium y gère lui-même les raccourcis
 * d'édition (Ctrl+C / V / X / A / Z) dans les pages et les champs du chrome.
 */
function applicationMenu() {
  if (process.platform !== 'darwin') return null;
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu', submenu: [{ role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]);
}

// Taille, position et état agrandi de la fenêtre : ${userData}/window.json (jamais en démo ni en test).
const windowFile = () => path.join(app.getPath('userData'), 'window.json');

function loadWindowState() {
  if (DEMO) return null;
  try {
    const w = JSON.parse(fs.readFileSync(windowFile(), 'utf8'));
    const b = { x: Math.round(w.x), y: Math.round(w.y), width: Math.round(w.width), height: Math.round(w.height) };
    if (!Object.values(b).every(Number.isFinite)) return null;
    b.width = Math.max(MIN_SIZE.width, b.width);
    b.height = Math.max(MIN_SIZE.height, b.height);
    // Écran débranché ou changé depuis : la fenêtre doit recouper nettement la zone utile d'un écran visible, sinon
    // seule sa taille est gardée (position par défaut du système).
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 16 && b.y < area.y + area.height - 80;
    const bounds = visible ? b : { width: Math.min(b.width, area.width), height: Math.min(b.height, area.height) };
    return { bounds, maximized: w.maximized === true };
  } catch { return null; }
}

function saveWindowState() {
  if (DEMO || !Q.win || Q.win.isDestroyed()) return;
  try { fs.writeFileSync(windowFile(), JSON.stringify({ ...Q.win.getNormalBounds(), maximized: Q.win.isMaximized() })); } catch { /* disque plein : ignoré */ }
}

function createWindow() {
  const dark = isDark();
  const saved = loadWindowState();
  Q.win = new BrowserWindow({
    ...DEFAULT_SIZE, ...(saved?.bounds || {}), minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, title: 'Qafila', show: false,
    backgroundColor: dark ? '#000000' : '#ffffff', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Barre de titre native partout : sous macOS, les feux tricolores restent dans la barre de titre (jamais sur la
    // capsule) et la fenêtre se déplace par elle, quelle que soit la position de la barre (haut ou bas).
    // Windows : barre de titre Qafila de 40 px, boutons de Windows par-dessus (titleBarOverlay).
    ...(CUSTOM_TITLEBAR
      ? { titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#000000' : '#ffffff', symbolColor: dark ? '#f2f2f7' : '#1c1c1e', height: titleBarHeight() } }
      : { titleBarStyle: 'default' }),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (CUSTOM_TITLEBAR) {
    // Le document de la fenêtre elle-même sert de barre de titre (zone de déplacement), sous les vues de la page et du chrome.
    Q.win.webContents.on('will-navigate', (e) => e.preventDefault());
    Q.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    Q.win.webContents.on('did-finish-load', () => { Q.titlebarSig = ''; updateTitlebar(); });
    Q.win.loadFile(path.join(__dirname, '..', 'renderer', 'titlebar.html'));
  }
  // Première apparition : agrandie si elle l'était à la fermeture.
  const reveal = () => { if (Q.win.isVisible()) return; if (saved?.maximized) Q.win.maximize(); Q.win.show(); };
  Menu.setApplicationMenu(applicationMenu());

  Q.favicons = new FaviconCache(() => broadcast());
  Q.blocker = new Blocker(() => Q.store.settings, (wcId) => Q.tabs.pageURLFor(wcId));
  Q.tabs = new TabManager({ win: Q.win, store: Q.store, blocker: Q.blocker, t: translator, isDark, offline: OFFLINE, userAgent: app.userAgentFallback });

  // Boutons des extensions dans la barre (<browser-action-list>) : préchargement de la session du chrome.
  try {
    session.defaultSession.registerPreloadScript({ type: 'frame', id: 'qafila-browser-action', filePath: path.join(__dirname, '..', 'preload', 'browser-action.js') });
  } catch { /* déjà enregistré */ }
  Q.chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      transparent: true,
    },
  });
  Q.chrome.setBackgroundColor('#00000000');
  Q.win.contentView.addChildView(Q.chrome);
  Q.chrome.webContents.on('did-finish-load', applyUiScale);
  Q.chrome.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  Q.chrome.webContents.on('before-input-event', (e, input) => shortcut(e, input));
  Q.chrome.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url }); return { action: 'deny' }; });
  Q.chrome.webContents.on('will-navigate', (e) => e.preventDefault());

  Q.glass = new Glass({
    pageContents: () => (Q.store.selected ? Q.tabs.contents(Q.store.selected) : null),
    chromeContents: () => Q.chrome?.webContents || null,
    stripRect: () => ((Q.store.settings.toolbar?.style || 'floating') === 'classic' ? null : glassRect()),
  });

  Q.tabs.on('change', broadcast);
  Q.tabs.on('shown', () => { setCollapse('none'); broadcast(); });
  Q.tabs.on('glass', (id) => { if (id === Q.store.selected) Q.glass.refresh(50); });
  Q.tabs.on('scroll', (id, d) => { if (id === Q.store.selected) { Q.glass.onScroll(!!d.final); onPageScroll(id, d); } });
  Q.tabs.on('open-tab', (o) => newTab(o));
  Q.tabs.on('found', (id, result) => { if (id === Q.store.selected) Q.chrome.webContents.send('qafila:found', result); });
  Q.tabs.on('status', (id, url) => { if (id === Q.store.selected) Q.chrome.webContents.send('qafila:status', url); });
  Q.tabs.on('input', shortcut);
  Q.tabs.on('fullscreen', (on, host) => onPageFullscreen(on, host));
  // Fenêtre surgissante bloquée : un seul message par page affichée et au plus un toutes les 10 s par onglet (le
  // message remplace un instant le domaine dans la barre : une page ne doit pas pouvoir le cacher en boucle).
  Q.tabs.on('popup-blocked', (id) => {
    const now = Date.now();
    const last = popupNotices.get(id);
    if (id !== Q.store.selected || (last && (last.shown || now - last.at < 10000))) return;
    popupNotices.set(id, { shown: true, at: now });
    command('toast', { text: translator()('popup_blocked') });
  });
  Q.tabs.on('edge', onPageEdge);
  Q.tabs.on('navigated', (id) => { const n = popupNotices.get(id); if (n) n.shown = false; if (id === Q.store.selected) setCollapse('none'); });
  Q.tabs.on('zoom', (dir) => zoom(dir === 'in' ? 10 : -10));

  Q.store.on('change', broadcast);
  Q.win.on('resize', () => { layout(); broadcast(); });
  Q.win.on('maximize', broadcast); Q.win.on('unmaximize', broadcast); Q.win.on('focus', broadcast); Q.win.on('blur', broadcast);
  Q.win.on('enter-full-screen', () => { layout(); broadcast(); }); Q.win.on('leave-full-screen', () => { layout(); broadcast(); });
  // Boutons latéraux de la souris : Précédent / Suivant (Windows et Linux ; macOS n'émet pas « app-command »).
  Q.win.on('app-command', (_e, cmd) => { if (cmd === 'browser-backward') Q.tabs.back(Q.store.selected); if (cmd === 'browser-forward') Q.tabs.forward(Q.store.selected); });
  Q.win.on('close', () => { saveWindowState(); Q.store.saveNow(); });
  Q.win.on('closed', () => { Q.win = null; });

  nativeTheme.on('updated', () => {
    if (!Q.win || Q.win.isDestroyed()) return;
    Q.win.setBackgroundColor(isDark() ? '#000000' : '#ffffff');
    Q.tabs.onThemeChanged();
    Q.chrome.webContents.send('qafila:theme', { dark: isDark() });
    broadcast();
  });

  // Téléchargements : dossier par défaut (réglage « downloadFolder », sinon Téléchargements du système), sans dialogue,
  // nom unique, notification dans la barre (début, fin, échec) et progression dans l'état poussé au chrome.
  Q.tabs.on('download', (item, wc, isPrivate) => onDownload(item, wc, isPrivate));
  Q.tabs.on('private-dropped', () => { privateDownloadSites.clear(); for (const k of blockedNotified) if (k.startsWith('priv:')) blockedNotified.delete(k); });

  Q.chrome.webContents.once('did-finish-load', () => {
    layout();
    showSelected();
    reveal();
    broadcast();
  });
  Q.win.once('ready-to-show', reveal);
  layout();
}

// ----- Démarrage -----
/** Adresses web passées en ligne de commande (raccourci, « Ouvrir avec », second lancement). */
function urlsFromArgv(list) {
  return (Array.isArray(list) ? list : []).filter((a) => typeof a === 'string' && /^https?:\/\/\S+$/i.test(a) && a.length <= 4096).slice(0, 20);
}

if (GOT_LOCK) app.whenReady().then(async () => {
  Q.store = new Store(app.getPath('userData'), { ephemeral: DEMO });
  Q.store.load();
  clearPendingDirs(); // téléchargements jamais confirmés lors d'une session précédente
  // DuckDuckGo n'est plus proposé : un ancien choix « duckduckgo » devient Google.
  if (Q.store.settings.searchEngine === 'duckduckgo') Q.store.setSetting('searchEngine', 'google');
  if (!Q.store.settings.searchDefaultGoogle) Q.store.setSetting('searchDefaultGoogle', true);
  if (DEMO) demo.applyDemo(Q.store, { dark: DEMO_DARK, language: typeof arg('lang') === 'string' ? arg('lang') : 'fr' });
  nativeTheme.themeSource = Q.store.settings.appearance || 'system';
  if (!Q.store.tabs.length) Q.store.addTab({ url: search.newTabURL(Q.store.settings) });
  if (!Q.store.selected) Q.store.selected = Q.store.tabs[0].id;
  translator();

  // Coffre de mots de passe (démonstration et tests : dossier temporaire, jamais celui de l'utilisateur).
  const vaultDir = DEMO ? fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'qafila-vault-')) : app.getPath('userData');
  Q.vault = new Vault({ dir: vaultDir, safeStorage, clipboard, onChange: () => broadcast() });
  Q.transfer = new Transfer({ store: Q.store, vault: Q.vault, win: () => Q.win, downloadFolder: () => downloadFolder(), t: (...x) => translator()(...x), onChange: () => broadcast(), onSettingChanged, refresh: () => Q.tabs?.refreshStartPages() });

  ipc.register({
    get win() { return Q.win; }, get chrome() { return Q.chrome; }, get store() { return Q.store; }, get tabs() { return Q.tabs; }, get blocker() { return Q.blocker; }, demo: DEMO,
    t: translator, describeTabs, describeState, newTab, closeTab, closeAllTabs, reopenTab, selectTab, navigate, goHome, moveTab,
    toggleBookmark, toggleDarken, toggleDesktop, toggleBlocker, toggleJavascript, zoom, clearData, onSettingChanged, suggest, setChrome, focusUI, screenshot,
    downloadFolder, expandBar: () => setCollapse('none'), updateTitlebar,
    get updater() { return Q.updater; },
    get extensions() { return Q.extensions; },
    get vault() { return Q.vault; },
    get transfer() { return Q.transfer; },
  });

  createWindow();
  Q.updater = new Updater({ onChange: broadcast, isAutomatic: () => Q.store.settings.autoUpdate !== false, demo: DEMO });
  // Extensions Chrome (Chrome Web Store, boutons dans la barre, menus) : session normale seulement.
  Q.extensions = new Extensions({
    tabs: Q.tabs, win: () => Q.win, t: translator, newTab, selectTab, closeTab,
    chromeOffset: () => (Q.chrome ? Q.chrome.getBounds().y : 0), onChange: broadcast,
  });
  Q.tabs.extensionMenuItems = (wc, params) => Q.extensions.contextMenuItems(wc, params);
  Q.extensions.init({ webStore: !DEMO })
    .then(() => (SMOKE_DIR ? Q.extensions.loadUnpacked(path.join(__dirname, '..', 'test', 'fixtures', 'extension')) : null))
    .catch((e) => console.error('extensions :', e?.message || e));
  Q.updater.start();
  Q.win.on('focus', () => Q.updater?.maybeCheck());
  if (!SMOKE_DIR) for (const url of urlsFromArgv(argv)) newTab({ url });
  if (SMOKE_DIR) runSmoke().catch((e) => { console.error('Smoke :', e); app.exit(1); });
});

// Second lancement : la première fenêtre revient au premier plan et ouvre les adresses transmises.
app.on('second-instance', (_e, otherArgv) => {
  if (!Q.win || Q.win.isDestroyed()) return;
  if (Q.win.isMinimized()) Q.win.restore();
  Q.win.show();
  Q.win.focus();
  for (const url of urlsFromArgv(otherArgv)) newTab({ url });
});
app.on('window-all-closed', () => { Q.store?.saveNow(); app.quit(); });
app.on('before-quit', () => { Q.store?.saveNow(); Q.extensions?.shutdown(); });
// Fichiers jamais confirmés (question sans réponse, navigation privée) : rien ne reste après la fermeture.
app.on('will-quit', () => { if (Q.store) clearPendingDirs(); });
// Certificat client demandé par un site (TLS) : Electron enverrait sans rien demander le premier certificat du
// système (certificats d'entreprise, eID…), qui révèle le nom ou l'adresse de l'utilisateur et le suit d'un site à
// l'autre, même en navigation privée. Qafila n'envoie jamais de certificat : la connexion continue sans.
app.on('select-client-certificate', (e, _wc, _url, _list, cb) => { e.preventDefault(); cb(); });
app.on('web-contents-created', (_e, wc) => {
  // Aucune vue n'ouvre de fenêtre native ni ne charge de code distant dans le chrome.
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

/**
 * Contrôles de sécurité du test de fumée : lecteur (origine opaque, extracteur en monde isolé, aucun gestionnaire on*
 * ni lien javascript: même si la page détourne JSON et les prototypes du DOM), émetteur des messages IPC, schémas
 * externes sans geste, adresses d'icônes refusées.
 */
async function securityChecks(report, wait, shot) {
  const fail = (m) => { report.errors.push(m); console.error('sécurité :', m); };
  const evalIn = (wc, js) => wc.executeJavaScript(js, true).catch((e) => `ERREUR ${e.message}`);
  // 1) Lecteur sur l'article de démonstration.
  const sel = Q.store.selected;
  const wc = Q.tabs.contents(sel);
  if (!(await Q.tabs.toggleReader(sel))) fail('lecteur : extraction impossible');
  await wait(1200);
  const origin = await evalIn(wc, 'location.origin');
  if (origin !== 'null') fail(`lecteur : origine ${origin} au lieu d'une origine opaque`);
  await shot('26-reader');
  await Q.tabs.toggleReader(sel); await wait(1200);
  // 2) Page piégée : JSON.stringify et getAttribute détournés, img onerror, lien javascript:.
  const trap = newTab();
  await wait(800);
  const twc = Q.tabs.contents(trap.id);
  const para = '<p>Texte authentique de l\'article piégé, assez long pour être choisi par l\'extracteur du lecteur. '.repeat(6)
    + '<img src="http://127.0.0.1:9/x.png" onerror="document.documentElement.dataset.pwned=1"> <a href="javascript:document.documentElement.dataset.pwned=1">lien</a></p>';
  const hostile = `<!doctype html><html><head><meta charset="utf-8"><title>Piège</title><script>
JSON.stringify = function () { return '{"title":"x","tree":{"t":"img","a":{"src":"x","onerror":"document.documentElement.dataset.pwned=1"},"c":[]}}'; };
Element.prototype.getAttribute = function () { return 'javascript:document.documentElement.dataset.pwned=1'; };
</script></head><body><article><h1>Article piégé</h1>${para.repeat(4)}</article></body></html>`;
  await twc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(hostile)).catch(() => {});
  await wait(600);
  if (!(await Q.tabs.toggleReader(trap.id))) fail('lecteur piégé : extraction impossible');
  await wait(1500);
  const probe = await evalIn(twc, `JSON.stringify({ origin: location.origin, pwned: !!document.documentElement.dataset.pwned,
    handlers: document.querySelectorAll('[onerror],[onload],[onclick]').length, js: document.querySelectorAll('a[href^="javascript:"]').length,
    genuine: document.body.innerText.includes('Texte authentique'), csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') })`);
  let r = {};
  try { r = JSON.parse(probe); } catch { fail(`lecteur piégé : sonde illisible (${probe})`); }
  if (r.origin !== 'null') fail(`lecteur piégé : origine ${r.origin}`);
  if (r.pwned) fail('lecteur piégé : un gestionnaire on* a été exécuté');
  if (r.handlers || r.js) fail(`lecteur piégé : ${r.handlers} attribut(s) on*, ${r.js} lien(s) javascript:`);
  if (!r.genuine) fail('lecteur piégé : le contenu vient du JSON détourné (extracteur hors monde isolé)');
  if (!r.csp) fail('lecteur piégé : pas de CSP');
  // 3) IPC : une page n'est jamais acceptée comme émetteur ; le chrome l'est.
  if (ipc.isChromeSender({ sender: twc, senderFrame: twc.mainFrame }, Q.chrome.webContents)) fail('ipc : une page est acceptée comme émetteur');
  if (!ipc.isChromeSender({ sender: Q.chrome.webContents, senderFrame: Q.chrome.webContents.mainFrame }, Q.chrome.webContents)) fail('ipc : le chrome est refusé');
  // 4) Schémas externes : rien sans geste de l'utilisateur, jamais magnet:/facetime:.
  if (await Q.tabs.openExternal('magnet:?xt=urn:btih:0', twc)) fail('externe : magnet: ouvert');
  if (await Q.tabs.openExternal('mailto:a@example.org', twc)) fail('externe : mailto: ouvert sans geste');
  // 5) Téléchargements : le premier automatique d'une page passe, le second demande ; un geste en permet un de plus.
  const d1 = Q.tabs.downloadVerdict(twc);
  const d2 = Q.tabs.downloadVerdict(twc);
  await wait(5);
  Q.tabs.lastGesture.set(twc.id, Date.now());
  const d3 = Q.tabs.downloadVerdict(twc);
  const d4 = Q.tabs.downloadVerdict(twc);
  if (d1.ask || !d2.ask || d3.ask || !d4.ask) fail(`téléchargements : verdicts ${[d1, d2, d3, d4].map((d) => (d.ask ? 'demande' : 'libre')).join(', ')}`);
  // 6) Icônes : file:, javascript: refusées ; le chrome ne reçoit que des adresses data:.
  const { safeFaviconURL } = require('./favicon');
  if (safeFaviconURL('file://attacker.example/share/a.ico') || safeFaviconURL('javascript:alert(1)')) fail('icône : adresse file:/javascript: acceptée');
  if (describeTabs().some((x) => x.faviconData && !x.faviconData.startsWith('data:image/'))) fail('icône : adresse non data: envoyée au chrome');
  closeTab(trap.id);
  // Les captures suivantes repartent de l'onglet de démonstration initial.
  if (Q.store.tabs.some((x) => x.id === sel)) selectTab(sel);
  await wait(800);
}

/**
 * Focus clavier : Ctrl+L et Ctrl+F frappés dans une page donnent le focus natif au chrome ; Échap le rend à la page.
 * (Les champs sont remplis par code ailleurs dans le scénario : seul ce contrôle vérifie la vraie frappe.)
 */
async function focusChecks(report, wait) {
  const fail = (m) => { report.errors.push(m); console.error('focus :', m); };
  const sel = Q.store.selected;
  const page = Q.tabs.contents(sel);
  const chromeWC = Q.chrome.webContents;
  const key = (wc, keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const active = () => chromeWC.executeJavaScript('document.hasFocus() && document.activeElement ? document.activeElement.id : ""', true).catch(() => '');
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  Q.tabs.focus(); await wait(400);
  if (!page.isFocused()) fail('la page n\'a pas le focus au départ');
  key(page, 'L', [mod]); await wait(900);
  if (!chromeWC.isFocused()) fail('Ctrl+L : le chrome n\'a pas le focus');
  if ((await active()) !== 'edit-input') fail('Ctrl+L : le champ d\'adresse n\'a pas le focus');
  key(chromeWC, 'Escape'); await wait(900);
  if (!page.isFocused()) fail('Échap après Ctrl+L : la page n\'a pas repris le focus');
  key(page, 'F', [mod]); await wait(900);
  if (!chromeWC.isFocused()) fail('Ctrl+F : le chrome n\'a pas le focus');
  if ((await active()) !== 'find-input') fail('Ctrl+F : le champ de recherche n\'a pas le focus');
  key(chromeWC, 'Escape'); await wait(900);
  if (!page.isFocused()) fail('Échap après Ctrl+F : la page n\'a pas repris le focus');
  key(page, ',', [mod]); await wait(900);
  if (!chromeWC.isFocused()) fail('Ctrl+, : le chrome n\'a pas le focus');
  key(chromeWC, 'Escape'); await wait(900);
  if (Q.chromeMode !== 'strip') fail('Échap après Ctrl+, : réglages toujours ouverts');
  if (!page.isFocused()) fail('fermeture des réglages : la page n\'a pas repris le focus');
  // Ctrl+T : nouvel onglet sur la page de démarrage, frappe dans le champ d'adresse.
  key(page, 'T', [mod]); await wait(1400);
  const created = Q.store.selected;
  if (created === sel) fail('Ctrl+T : aucun nouvel onglet');
  if (!chromeWC.isFocused()) fail('Ctrl+T : le chrome n\'a pas le focus');
  if ((await active()) !== 'edit-input') fail('Ctrl+T : le champ d\'adresse n\'a pas le focus');
  key(chromeWC, 'Escape'); await wait(700);
  if (created !== sel) closeTab(created);
  if (Q.store.tabs.some((x) => x.id === sel)) selectTab(sel);
  await wait(800);
}

/**
 * Mise en page : la page ne croise jamais la bande du chrome, barre en haut comme en bas et pour les trois styles.
 * Au défilement : Réduire replie la barre en mini-adresse en descendant et la rouvre en remontant ; Masquer la retire
 * (page plein cadre) et la rend quand la souris touche le bord côté barre.
 */
async function layoutChecks(report, wait, set, shot) {
  const fail = (m) => { report.errors.push(m); console.error('mise en page :', m); };
  const tb = { ...Q.store.settings.toolbar };
  const scroll = Q.store.settings.scrollBehavior;
  const sel = Q.store.selected;
  const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const fmt = (r) => `${r.x},${r.y} ${r.width}×${r.height}`;
  const separate = (label) => {
    const [, h] = Q.win.getContentSize();
    const strip = stripRect();
    const view = Q.tabs.view(Q.store.selected)?.getBounds() || Q.tabs.pageBounds;
    const chrome = Q.chrome.getBounds();
    if (Q.chromeMode !== 'strip') fail(`${label} : chrome en mode ${Q.chromeMode}`);
    if (strip.height && meets(view, strip)) fail(`${label} : la page (${fmt(view)}) croise la bande (${fmt(strip)})`);
    if (chrome.height && meets(view, chrome)) fail(`${label} : la page (${fmt(view)}) croise la vue du chrome (${fmt(chrome)})`);
    if (view.height + strip.height + titleH() !== h) fail(`${label} : page ${view.height} + bande ${strip.height} + titre ${titleH()} ≠ fenêtre ${h}`);
    return strip;
  };
  for (const behavior of ['fixed', 'shrink']) {
    set('scrollBehavior', behavior);
    for (const position of ['top', 'bottom']) {
      for (const style of ['floating', 'glass', 'classic']) {
        set('toolbar', { ...tb, position, style }); await wait(behavior === 'fixed' ? 900 : 500);
        separate(`${behavior}, barre ${position}, ${style}`);
        if (behavior === 'fixed' && position === 'bottom' && style === 'floating') { Q.glass.refresh(0); await wait(500); await shot('27-bottom-fixed'); }
      }
    }
  }
  // Réduire : en descendant, mini-adresse ; en remontant, barre entière (article long : 14 paragraphes).
  set('toolbar', { ...tb, position: 'top', style: 'floating' });
  const articleURL = 'https://fr.wikipedia.org/wiki/Caravane_(convoi)';
  const article = newTab({ url: articleURL });
  Q.store.updateTab(article.id, { title: 'Caravane (convoi) — Wikipédia', readingMinutes: 14 });
  Q.tabs.open(article.id, articleURL, { initial: true });
  set('scrollBehavior', 'shrink'); await wait(1500);
  const wc = Q.tabs.contents(article.id);
  const full = Q.barHeight + 2 * BAR_MARGIN;
  await wc.executeJavaScript('window.scrollTo(0, 0)', true).catch(() => {});
  await wait(500);
  await wc.executeJavaScript('window.scrollTo(0, 700)', true).catch(() => {});
  await wait(900);
  const mini = separate('Réduire, après défilement');
  if (Q.collapse !== 'mini' || mini.height !== MINI_STRIP) fail(`Réduire : bande ${mini.height} (${Q.collapse}) au lieu de la mini-adresse ${MINI_STRIP}`);
  const label = await Q.chrome.webContents.executeJavaScript("(() => { const m = document.getElementById('mini'); return m && !m.hidden ? m.textContent : ''; })()", true).catch(() => '');
  if (!label) fail('Réduire : mini-adresse absente du chrome');
  Q.glass.refresh(0); await wait(400); await shot('28-shrink');
  await wc.executeJavaScript('window.scrollTo(0, 300)', true).catch(() => {});
  await wait(900);
  if (stripRect().height !== full) fail(`Réduire : la barre ne revient pas en remontant (bande ${stripRect().height})`);
  // Masquer : bande nulle en descendant, retour quand la souris touche le bord haut de la page.
  set('scrollBehavior', 'hide'); await wait(600);
  await wc.executeJavaScript('window.scrollTo(0, 900)', true).catch(() => {});
  await wait(900);
  const hidden = separate('Masquer, après défilement');
  if (Q.collapse !== 'hidden' || hidden.height !== 0) fail(`Masquer : bande ${hidden.height} (${Q.collapse}) au lieu de 0`);
  wc.sendInputEvent({ type: 'mouseMove', x: 400, y: 200 });
  await wait(100);
  wc.sendInputEvent({ type: 'mouseMove', x: 400, y: 1 });
  await wait(900);
  if (stripRect().height !== full) fail(`Masquer : la barre ne revient pas au bord de la fenêtre (bande ${stripRect().height})`);
  closeTab(article.id);
  set('scrollBehavior', scroll);
  set('toolbar', tb);
  if (Q.store.tabs.some((x) => x.id === sel)) selectTab(sel);
  await wait(1000);
}

/**
 * Pages hostiles servies en local : fenêtres surgissantes sans geste (bloquées, un onglet par geste), téléchargements
 * automatiques en boucle (location.href vers un fichier : le deuxième demande), JavaScript désactivé par site après
 * une redirection et réglage global coupé après l'ouverture (en-tête CSP par navigation).
 */
async function hostileChecks(report, wait, set) {
  const fail = (m) => { report.errors.push(m); console.error('pages hostiles :', m); };
  const http = require('node:http');
  const pages = {
    '/popup': '<!doctype html><title>Pop</title><script>for (let i = 0; i < 4; i++) window.open("https://example.org/p" + i);</script>',
    '/js': '<!doctype html><title>Statique</title><script>document.title = "JSRAN";</script>',
    '/swpage': '<!doctype html><title>Statique</title><script>document.title = "SW…"; navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then(() => { document.title = navigator.serviceWorker.controller ? "SWJS" : "SWPRET"; });</script>',
    '/dl-loop': '<!doctype html><title>Boucle</title><script>let n = 0; const go = () => { if (n < 4) { location.href = "/file?n=" + (n++); setTimeout(go, 350); } }; go();</script>',
  };
  const server = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/redir') { r.writeHead(302, { location: `http://localhost:${server.address().port}/js` }); r.end(); return; }
    if (u.pathname === '/suggest') { r.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'NID=pistage; Max-Age=999999', 'cache-control': 'no-cache' }); r.end(JSON.stringify(['x', [String(q.headers.cookie || '')]])); return; }
    if (u.pathname === '/setup.exe') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="setup.exe"' }); r.end('MZ'); return; }
    if (u.pathname === '/sw.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", (e) => e.waitUntil(clients.claim())); self.addEventListener("fetch", (e) => { if (e.request.mode === "navigate") e.respondWith(fetch(e.request)); });'); return; }
    if (u.pathname === '/same.bin') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="same.bin"' }); r.end(`content-${u.search.slice(1)}`); return; }
    if (u.pathname === '/file') { r.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="f${u.searchParams.get('n')}.bin"` }); r.end('x'); return; }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(pages[u.pathname] || '<!doctype html><title>Vide</title>');
  });
  await new Promise((resolve) => server.listen(0, resolve)); // toutes les interfaces : 127.0.0.1 et localhost (::1)
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const before = Q.store.selected;
  const saved = { js: Q.store.settings.javascriptEnabled, hosts: Q.store.settings.javascriptDisabledHosts, dl: Q.store.settings.downloadFolder };
  const tab = newTab();
  await wait(700);
  const twc = Q.tabs.contents(tab.id);
  try {
    // 1) Fenêtres surgissantes : aucune sans geste ; avec un geste, une seule.
    let count = Q.store.tabs.length;
    Q.tabs.lastGesture.delete(twc.id);
    await twc.loadURL(`${base}/popup`).catch(() => {});
    await wait(900);
    if (Q.store.tabs.length !== count) fail(`fenêtres surgissantes : ${Q.store.tabs.length - count} onglet(s) ouvert(s) sans geste`);
    Q.tabs.lastGesture.set(twc.id, Date.now());
    await twc.executeJavaScript('window.open("https://example.org/a"); window.open("https://example.org/b"); 1', true).catch(() => {});
    await wait(900);
    const opened = Q.store.tabs.length - count;
    if (opened !== 1) fail(`fenêtres surgissantes : ${opened} onglet(s) pour un geste au lieu de 1`);
    for (const extra of Q.store.tabs.filter((x) => x.id !== tab.id && /^https:\/\/example\.org\/[ab]$/.test(x.url || ''))) closeTab(extra.id);
    selectTab(tab.id); await wait(500);
    // 2) Téléchargements en boucle sans geste : le premier passe, les suivants demandent (refusés ici sans dialogue).
    Q.store.setSetting('downloadFolder', path.join(SMOKE_DIR, 'downloads'));
    fs.mkdirSync(path.join(SMOKE_DIR, 'downloads'), { recursive: true });
    downloadSites.set(`127.0.0.1:${port}`, false);
    const verdicts = [];
    const original = Q.tabs.downloadVerdict.bind(Q.tabs);
    Q.tabs.downloadVerdict = (w) => { const v = original(w); verdicts.push(v.ask ? 'demande' : 'libre'); return v; };
    try {
      Q.tabs.lastGesture.delete(twc.id);
      await twc.loadURL(`${base}/dl-loop`).catch(() => {});
      await wait(2600);
    } finally { Q.tabs.downloadVerdict = original; }
    if (verdicts.length < 3 || verdicts[0] !== 'libre' || verdicts.slice(1).some((v) => v !== 'demande')) fail(`téléchargements en boucle : verdicts [${verdicts.join(', ')}]`);
    const looped = fs.readdirSync(path.join(SMOKE_DIR, 'downloads')).filter((f) => /^f\d\.bin$/.test(f));
    if (looped.join() !== 'f0.bin') fail(`téléchargements en boucle : fichiers enregistrés [${looped.join(', ')}] au lieu de f0.bin`);
    // 3) JavaScript coupé pour localhost : la redirection 127.0.0.1 → localhost n'exécute pas le script.
    await twc.loadURL('about:blank').catch(() => {});
    set('javascriptDisabledHosts', ['localhost']);
    await twc.loadURL(`${base}/redir`).catch(() => {});
    await wait(900);
    if (twc.getTitle() !== 'Statique') fail(`JavaScript par site : « ${twc.getTitle()} » (le script a tourné après redirection)`);
    if (describeTabs().find((x) => x.id === tab.id)?.javascript !== false) fail('JavaScript par site : l\'onglet ne l\'indique pas désactivé');
    set('javascriptDisabledHosts', saved.hosts);
    // 4) Réglage global coupé après l'ouverture : la page rechargée n'exécute plus de script.
    await twc.loadURL(`${base}/js`).catch(() => {});
    await wait(700);
    if (twc.getTitle() !== 'JSRAN') fail(`JavaScript actif : « ${twc.getTitle()} » au lieu de JSRAN`);
    set('javascriptEnabled', false); await wait(1200);
    if (twc.getTitle() !== 'Statique') fail(`JavaScript coupé globalement : « ${twc.getTitle()} » après rechargement`);
    set('javascriptEnabled', true); await wait(1000);
    // 4 bis) Service worker d'un site sur un port non standard : JavaScript coupé pour ce nom d'hôte, il est supprimé
    // (sinon la page servie par lui échappe à « script-src 'none' »).
    await twc.loadURL(`${base}/swpage`).catch(() => {});
    await wait(1200);
    await twc.loadURL(`${base}/swpage`).catch(() => {});
    await wait(1200);
    const swTitle = twc.getTitle();
    set('javascriptDisabledHosts', ['127.0.0.1']); await wait(1500);
    if (swTitle !== 'SWJS') fail(`service worker : non installé (« ${swTitle} »)`);
    else if (twc.getTitle() !== 'Statique') fail(`service worker : JavaScript toujours actif après coupure (« ${twc.getTitle()} »)`);
    set('javascriptDisabledHosts', saved.hosts); await wait(1000);
    // 5) Plein écran demandé par la page : avis visible (hôte de la page), Échap en sort même si la page l'intercepte.
    await twc.executeJavaScript('addEventListener("keydown", (e) => e.preventDefault(), true); document.documentElement.requestFullscreen().then(() => 1, () => 0)', true).catch(() => 0);
    await wait(1200);
    const notice = await Q.chrome.webContents.executeJavaScript("(() => { const n = document.getElementById('fsn'); return n && !n.hidden ? n.textContent : ''; })()", true).catch(() => '');
    if (!Q.isFullscreenPage) fail('plein écran : la page n\'est pas passée en plein écran');
    else if (!notice.includes('127.0.0.1') || Q.chrome.getBounds().height < 40) fail(`plein écran : avis absent (« ${notice} », chrome ${Q.chrome.getBounds().height} px)`);
    else { try { fs.writeFileSync(path.join(SMOKE_DIR, '30-fullscreen-notice.png'), (await Q.chrome.webContents.capturePage()).toPNG()); } catch { /* capture facultative */ } }
    twc.focus();
    twc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    twc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(1500);
    if (Q.isFullscreenPage) fail('plein écran : Échap n\'en sort pas');
    // 6) Fichiers locaux : jamais rendus dans un onglet (adresse saisie, chargement direct), aucun fichier lu.
    const secret = path.join(SMOKE_DIR, 'secret.txt');
    const trapFile = path.join(SMOKE_DIR, 'piege.html');
    fs.writeFileSync(secret, 'SECRET-LOCAL');
    fs.writeFileSync(trapFile, `<!doctype html><title>Piège</title><script>fetch(${JSON.stringify(require('node:url').pathToFileURL(secret).href)}).then((r) => r.text()).then((t) => { document.title = 'LU:' + t; }, () => { document.title = 'REFUS'; });</script>`);
    const trapURL = require('node:url').pathToFileURL(trapFile).href;
    navigate(trapURL, tab.id); await wait(1200);
    if (!twc.getURL().startsWith('data:') || twc.getTitle().startsWith('LU:')) fail(`fichiers locaux (adresse) : ${twc.getURL().slice(0, 60)} « ${twc.getTitle()} »`);
    await twc.loadURL(trapURL).catch(() => {}); await wait(1200);
    if (twc.getTitle().startsWith('LU:') || twc.getURL().startsWith('file:')) fail(`fichiers locaux (chargement direct) : ${twc.getURL().slice(0, 60)} « ${twc.getTitle()} »`);
    // 7) Suggestions : aucun cookie renvoyé au moteur (session en mémoire, credentials « omit »).
    const sugg = async () => { try { return (await (await suggestFetch(`${base}/suggest`)).json())[1][0]; } catch (e) { return 'ERREUR ' + e.message; } };
    await sugg();
    const sent = await sugg();
    if (sent !== '') fail(`suggestions : cookie renvoyé au moteur (« ${sent} »)`);
    // 8) Exécutables sans geste : une seule question par page à la fois (trois liens cliqués par script), réponse
    // donnée après la fin du transfert (Chromium écrit le fichier même en pause) ; refusé, rien dans le dossier ni
    // dans la zone d'attente, et le site n'est plus questionné ; accepté (autre site), le fichier arrive dans le dossier.
    const dlDir = path.join(SMOKE_DIR, 'downloads');
    const exes = () => fs.readdirSync(dlDir).filter((f) => /^setup.*\.exe$/.test(f));
    const pendingLeft = () => { try { return fs.readdirSync(pendingDir()).length; } catch { return 0; } };
    const asked = [];
    const zones = []; // zone d'attente vue au moment de chaque réponse : dans le dossier de téléchargement, privée (0700)
    let answer = 1;
    const showBox = dialog.showMessageBox;
    dialog.showMessageBox = (...a) => {
      asked.push(a[a.length - 1]?.message || '');
      const r = answer;
      return new Promise((ok) => setTimeout(() => {
        try { zones.push(`${path.dirname(pendingDir())}|${(fs.statSync(pendingDir()).mode & 0o777).toString(8)}`); } catch { zones.push('absente'); }
        ok({ response: r });
      }, 900));
    };
    downloadSites.delete(`127.0.0.1:${port}`); // décision « bloquer » du contrôle 2 oubliée
    const clickThree = 'for (let i = 0; i < 3; i++) { const a = document.createElement("a"); a.href = "/setup.exe?" + i; a.download = ""; document.body.append(a); a.click(); } 1';
    try {
      await twc.loadURL(`${base}/js`).catch(() => {});
      await wait(500);
      Q.tabs.lastGesture.delete(twc.id);
      Q.tabs.downloadState.delete(twc.id);
      await twc.executeJavaScript(clickThree, true).catch(() => {});
      await wait(2200);
      if (asked.length !== 1 || !asked[0].includes('setup.exe')) fail(`exécutable sans geste : ${asked.length} question(s) pour 3 fichiers`);
      if (exes().length) fail(`exécutable sans geste : ${exes().join(', ')} enregistré(s) malgré le refus`);
      if (pendingLeft()) fail(`exécutable sans geste : ${pendingLeft()} fichier(s) laissé(s) en zone d'attente`);
      // Site déjà refusé : plus aucune question.
      await twc.executeJavaScript(clickThree, true).catch(() => {});
      await wait(1500);
      if (asked.length !== 1) fail(`exécutable sans geste : site refusé questionné de nouveau (${asked.length})`);
      if (exes().length || pendingLeft()) fail('exécutable sans geste : fichier écrit après refus du site');
      // Accepté sur un autre site : le fichier complet arrive sous son nom, la zone d'attente est vide.
      answer = 0;
      await twc.loadURL(`http://localhost:${port}/js`).catch(() => {});
      await wait(500);
      Q.tabs.lastGesture.delete(twc.id);
      await twc.executeJavaScript('location.href = "/setup.exe"; 1', true).catch(() => {});
      await wait(2200);
      if (asked.length !== 2) fail(`exécutable accepté : ${asked.length - 1} question(s)`);
      if (exes().join() !== 'setup.exe' || fs.readFileSync(path.join(dlDir, 'setup.exe'), 'utf8') !== 'MZ') fail(`exécutable accepté : dossier [${exes().join(', ')}]`);
      if (pendingLeft()) fail('exécutable accepté : zone d\'attente non vidée');
      if (fs.existsSync(pendingDir())) fail('exécutable accepté : zone d\'attente vide non supprimée');
      const zoneOK = `${dlDir}|${process.platform === 'win32' ? '' : '700'}`;
      if (!zones.length || zones.some((z) => (process.platform === 'win32' ? !z.startsWith(zoneOK) : z !== zoneOK))) fail(`zone d'attente : [${zones.join(', ')}] au lieu de ${zoneOK}`);
      // 9) Trois fichiers du même nom sans geste, deux en attente acceptés par une seule réponse (transferts déjà
      // finis) : trois fichiers distincts, aucun écrasé. Site autorisé ensuite : le suivant passe sans question.
      const same = () => fs.readdirSync(dlDir).filter((f) => /^same( \(\d\))?\.bin$/.test(f)).sort();
      const contents = () => same().map((f) => fs.readFileSync(path.join(dlDir, f), 'utf8')).sort().join();
      Q.tabs.lastGesture.delete(twc.id);
      Q.tabs.downloadState.delete(twc.id);
      await twc.executeJavaScript('for (let i = 0; i < 3; i++) { const a = document.createElement("a"); a.href = "/same.bin?" + i; a.download = ""; document.body.append(a); a.click(); } 1', true).catch(() => {});
      await wait(2400);
      if (asked.length !== 3) fail(`même nom : ${asked.length - 2} question(s) au lieu d'une`);
      if (same().join() !== 'same (1).bin,same (2).bin,same.bin' || contents() !== 'content-0,content-1,content-2') fail(`même nom : [${same().join(', ')}] contenus [${contents()}]`);
      await twc.executeJavaScript('{ const a = document.createElement("a"); a.href = "/same.bin?3"; a.download = ""; document.body.append(a); a.click(); } 1', true).catch(() => {});
      await wait(1200);
      if (asked.length !== 3 || same().length !== 4) fail(`site autorisé : ${asked.length - 3} question(s), ${same().length} fichier(s)`);
      if (fs.existsSync(pendingDir())) fail('même nom : zone d\'attente vide non supprimée');
    } finally { dialog.showMessageBox = showBox; downloadSites.delete(`localhost:${port}`); }
  } finally {
    set('javascriptEnabled', saved.js);
    set('javascriptDisabledHosts', saved.hosts);
    Q.store.setSetting('downloadFolder', saved.dl);
    downloadSites.delete(`127.0.0.1:${port}`);
    closeTab(tab.id);
    if (Q.store.tabs.some((x) => x.id === before)) selectTab(before);
    server.close();
    await wait(800);
  }
}

/** Plantage du moteur de rendu : un rechargement automatique, puis la page d'erreur au second plantage (< 1 min). */
async function crashChecks(report, wait) {
  const fail = (m) => { report.errors.push(m); console.error('plantage :', m); };
  const before = Q.store.selected;
  const tab = newTab();
  await wait(1200);
  const title = () => Q.tabs.contents(tab.id)?.executeJavaScript('document.title', true).catch(() => '?');
  Q.tabs.contents(tab.id).forcefullyCrashRenderer(); await wait(1800);
  if ((await title()) !== translator()('new_tab')) fail('premier plantage : la page n\'a pas été rechargée');
  Q.tabs.contents(tab.id).forcefullyCrashRenderer(); await wait(1800);
  const t2 = await title();
  if (t2 !== translator()('error_page_title')) fail(`second plantage : « ${t2} » au lieu de la page d'erreur`);
  closeTab(tab.id);
  if (Q.store.tabs.some((x) => x.id === before)) selectTab(before);
  await wait(800);
}

/** Barre « Auto » : une page avec <meta name=theme-color content=#c00> donne une barre rgb(204, 0, 0). */
async function themeColorCheck(report, wait, set) {
  const fail = (m) => { report.errors.push(m); console.error('couleur du site :', m); };
  const http = require('node:http');
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="theme-color" content="#c00"><title>Couleur</title></head><body><p>Rouge.</p></body></html>';
  const server = http.createServer((_q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = Q.store.settings.barColorLight;
  const before = Q.store.selected;
  const tab = newTab();
  await wait(600);
  try {
    await Q.tabs.contents(tab.id).loadURL(`http://127.0.0.1:${server.address().port}/`).catch(() => {});
    await wait(1500);
    const stored = Q.store.tabs.find((x) => x.id === tab.id)?.themeColorHex;
    if (stored !== '#cc0000') fail(`themeColorHex = ${stored} au lieu de #cc0000`);
    set('barColorLight', 'auto'); await wait(800);
    const bar = await Q.chrome.webContents.executeJavaScript("getComputedStyle(document.documentElement).getPropertyValue('--bar-rgb').trim()", true).catch(() => '');
    if (bar.replace(/\s/g, '') !== '204,0,0') fail(`barre Auto = [${bar}] au lieu de [204,0,0]`);
  } finally {
    set('barColorLight', previous);
    closeTab(tab.id);
    if (Q.store.tabs.some((x) => x.id === before)) selectTab(before);
    server.close();
    await wait(800);
  }
}

/** Scénario de test : onglets de démonstration, captures (page, menu, saisie, onglets, réglages, galerie, éditeur,
 * démarrage, sombre, barre en bas), contrôle de la bande, sortie 0. */
async function runSmoke() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const report = { started: Date.now(), shots: [], errors: [] };
  const shot = async (name) => { try { const f = await screenshot(name); report.shots.push(f); console.log('capture', f); } catch (e) { report.errors.push(`${name}: ${e.message}`); } };
  const demoScreen = (screen, extra = {}) => Q.chrome.webContents.send('qafila:command', { name: 'demo', screen, ...extra });
  const set = (key, value) => { Q.store.setSetting(key, value); onSettingChanged(key); };
  // Le chrome est prêt et la première page chargée.
  await new Promise((resolve) => { if (Q.chrome.webContents.isLoading()) Q.chrome.webContents.once('did-finish-load', resolve); else resolve(); });
  await wait(2500);
  Q.glass.refresh(0);
  await wait(500);
  await shot('01-page');
  demoScreen('menu'); await wait(900); await shot('02-menu');
  demoScreen('address', { text: 'cara' }); await wait(1200); await shot('03-address');
  demoScreen('none'); await wait(400);
  demoScreen('tabs'); await wait(1400); await shot('04-tabs');
  set('tabsLayout', 'grid'); await wait(1200); await shot('05-tabs-grid');
  set('tabsLayout', 'list');
  demoScreen('tabs-popup'); await wait(700); await shot('06-tabs-popup');
  demoScreen('none'); await wait(400);
  demoScreen('settings'); await wait(900); await shot('07-settings');
  demoScreen('appearance'); await wait(900); await shot('08-appearance');
  demoScreen('gallery'); await wait(900); await shot('09-gallery');
  demoScreen('editor'); await wait(900); await shot('10-editor');
  demoScreen('none'); await wait(400);
  demoScreen('find', { text: 'caravane' }); await wait(900); await shot('11-find');
  demoScreen('none'); await wait(300);
  // Lecteur : la page du lecteur a une origine opaque (jamais celle du site).
  await securityChecks(report, wait, shot);
  // Page de démarrage : un nouvel onglet, refermé ensuite.
  const start = newTab();
  await wait(1500); await shot('12-start');
  closeTab(start.id); await wait(800);
  set('appearance', 'dark');
  await wait(1800); Q.glass.refresh(0); await wait(400); await shot('13-dark');
  demoScreen('menu'); await wait(900); await shot('14-dark-menu');
  demoScreen('tabs'); await wait(1200); await shot('15-dark-tabs');
  demoScreen('settings'); await wait(900); await shot('16-dark-settings');
  demoScreen('none'); await wait(500);
  set('appearance', 'light');
  set('toolbar', { ...Q.store.settings.toolbar, position: 'bottom', style: 'glass' });
  await wait(1500); Q.glass.refresh(0); await wait(400); await shot('17-bottom-glass');
  set('toolbar', { ...Q.store.settings.toolbar, position: 'top', style: 'floating' });
  await wait(900);
  demoScreen('history'); await wait(900); await shot('19-history');
  demoScreen('bookmarks'); await wait(900); await shot('20-bookmarks');
  demoScreen('none'); await wait(500);
  // Apparence, bas de page : style de la barre et curseur Transparence (aperçu en direct).
  demoScreen('appearance'); await wait(900); demoScreen('scroll', { top: 'end' }); await wait(500); await shot('24-appearance-style');
  demoScreen('about'); await wait(900); await shot('25-about');
  demoScreen('none'); await wait(500);
  // Mise à jour prête (état simulé, rien n'est téléchargé) : bouton « Mettre à jour » dans la barre et page À propos.
  Q.updater.state = { status: 'ready', version: '0.9.2', percent: 100, manual: false };
  broadcast(); await wait(900); Q.glass.refresh(0); await wait(400); await shot('34-update-button');
  demoScreen('about'); await wait(900); await shot('35-update-about');
  demoScreen('none'); await wait(400);
  set('appearance', 'dark'); await wait(1500); Q.glass.refresh(0); await wait(400); await shot('36-update-dark');
  set('appearance', 'light');
  Q.updater.state = { status: 'disabled', version: null, percent: null, manual: false };
  // Extensions : bouton de l'extension d'essai dans la barre, sa fenêtre, réglages ; autorisations des sites.
  const fail = (m) => { report.errors.push(m); console.error('smoke :', m); };
  for (let i = 0; i < 30 && !(Q.extensions?.ready && Q.extensions.list().length); i++) await wait(200);
  if (!Q.extensions?.list().length) fail('extension d\'essai non chargée');
  broadcast(); await wait(1500); Q.glass.refresh(0); await wait(400); await shot('39-extension-button');
  const clicked = await Q.chrome.webContents.executeJavaScript(`(() => { const l = document.querySelector('browser-action-list'); const b = l && l.shadowRoot && l.shadowRoot.querySelector('.action'); if (!b) return false; b.click(); return true; })()`).catch(() => false);
  if (!clicked) fail('bouton de l\'extension introuvable dans la barre');
  await wait(1800);
  const popup = BrowserWindow.getAllWindows().find((w) => w !== Q.win && w.webContents.getURL().startsWith('chrome-extension://'));
  if (!popup) fail('fenêtre de l\'extension non ouverte');
  else {
    const img = await popup.webContents.capturePage();
    fs.writeFileSync(path.join(SMOKE_DIR, '40-extension-popup.png'), img.toPNG());
    const pb = popup.getBounds(); const cb = Q.chrome.getBounds(); const wb = Q.win.getContentBounds();
    if (pb.y < wb.y + cb.y) fail(`fenêtre de l'extension au-dessus de la barre (${pb.y} < ${wb.y + cb.y})`);
    popup.destroy();
  }
  demoScreen('extensions'); await wait(1200); await shot('41-extensions');
  demoScreen('none'); await wait(400);
  Q.store.setSitePermission('meet.google.com', 'camera', 'allow'); Q.store.setSitePermission('meet.google.com', 'microphone', 'allow'); Q.store.setSitePermission('pub.example.com', 'notifications', 'block');
  demoScreen('sitePermissions'); await wait(1200); await shot('42-site-permissions');
  demoScreen('none'); Q.store.resetSitePermissions(); await wait(400);
  // Mots de passe : coffre à créer, puis coffre ouvert avec deux identifiants ; Importer et exporter.
  demoScreen('passwords'); await wait(1200); await shot('43-passwords-new');
  demoScreen('none'); await wait(300);
  // Taille de l'interface à 125 %.
  Q.store.setSetting('uiScale', 1.25); onSettingChanged('uiScale'); await wait(900); await shot('46-ui-125');
  if (Math.abs(Q.chrome.webContents.getZoomFactor() - 1.25) > 0.01) fail(`taille de l'interface : zoom ${Q.chrome.webContents.getZoomFactor()}`);
  Q.store.setSetting('uiScale', 1); onSettingChanged('uiScale'); await wait(600);
  await Q.vault.create('phrase de démonstration', false);
  Q.vault.add({ url: 'https://fr.wikipedia.org/w/index.php?title=Connexion', username: 'lina@example.org', password: 'Zéphyr-2026!' });
  Q.vault.add({ url: 'https://github.com/login', username: 'lina-dev', password: 'caravane-du-désert' });
  if (Q.vault.list().length !== 2) fail('coffre : 2 identifiants attendus');
  demoScreen('passwords'); await wait(1500); await shot('44-passwords-list');
  demoScreen('transfer'); await wait(1500); await shot('45-transfer');
  demoScreen('none'); await wait(300);
  // Tailles : tout en Grande, puis tout en Petite, puis retour à Normale.
  for (const [size, name] of [['large', '37-sizes-large'], ['small', '38-sizes-small']]) {
    set('barSize', size); set('titleBarSize', size); set('bookmarksBarSize', size);
    await wait(1200); Q.glass.refresh(0); await wait(400); await shot(name);
  }
  set('barSize', 'medium'); set('titleBarSize', 'medium'); set('bookmarksBarSize', 'medium'); await wait(800);
  broadcast(); await wait(600);
  // Interface en arabe : mise en page de droite à gauche (dir="rtl").
  set('language', 'ar'); await wait(1500);
  await shot('21-ar-page');
  demoScreen('settings'); await wait(1000); await shot('22-ar-settings');
  demoScreen('menu'); await wait(900); await shot('23-ar-menu');
  demoScreen('none'); await wait(500);
  if (!describeState().rtl) report.errors.push('arabe : interface non RTL');
  set('language', 'fr'); await wait(1200);
  await focusChecks(report, wait);
  await themeColorCheck(report, wait, set);
  await hostileChecks(report, wait, set);
  await layoutChecks(report, wait, set, shot);
  await crashChecks(report, wait);
  // Fenêtre à la taille minimale (Ancrage de Windows sur une demi-largeur) : barre, menu et écran des onglets tiennent.
  const size = Q.win.getContentSize();
  Q.win.setContentSize(MIN_SIZE.width, MIN_SIZE.height); await wait(1200);
  Q.glass.refresh(0); await wait(400); await shot('31-min-size');
  demoScreen('menu'); await wait(900); await shot('32-min-menu');
  demoScreen('tabs'); await wait(1200); await shot('33-min-tabs');
  demoScreen('none'); await wait(500);
  Q.win.setContentSize(size[0], size[1]); await wait(1000);
  demoScreen('toolbar'); await wait(900); demoScreen('scroll', { top: 'end' }); await wait(500); await shot('29-toolbar-settings');
  demoScreen('none'); await wait(600);
  // La vue du chrome doit être revenue à la bande (barre + 2 × 12 px) une fois les surcouches fermées.
  const cb = Q.chrome.getBounds();
  if (cb.height !== Q.barHeight + 2 * BAR_MARGIN) report.errors.push(`bande : hauteur ${cb.height} au lieu de ${Q.barHeight + 2 * BAR_MARGIN}`);
  // Bande seule (transparence du chrome) et état complet.
  try {
    const img = await Q.chrome.webContents.capturePage();
    fs.writeFileSync(path.join(SMOKE_DIR, '18-chrome-strip.png'), img.toPNG());
    report.shots.push(path.join(SMOKE_DIR, '18-chrome-strip.png'));
  } catch (e) { report.errors.push('strip: ' + e.message); }
  report.state = describeState();
  report.finished = Date.now();
  fs.writeFileSync(path.join(SMOKE_DIR, 'smoke.json'), JSON.stringify(report, null, 2));
  console.log('smoke terminé :', report.shots.length, 'captures,', report.errors.length, 'erreurs');
  Q.extensions?.shutdown();
  app.exit(report.errors.length ? 1 : 0);
}
