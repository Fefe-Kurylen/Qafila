'use strict';
// Qafila pour PC — processus principal : une fenêtre, une WebContentsView par onglet sous une vue « chrome »
// transparente (desktop/renderer) qui occupe une bande en haut ou en bas, ou toute la fenêtre quand un menu, les
// suggestions ou un écran (onglets, réglages…) sont ouverts. Lancer avec --demo pour les onglets de démonstration,
// --smoke=<dossier> pour les captures d'écran de test (quitte avec le code 0).
const { app, BrowserWindow, WebContentsView, nativeTheme, ipcMain, net, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store');
const { TabManager, hostOf, desktopUserAgent } = require('./tabs');
const { Blocker } = require('./blocker');
const { Glass } = require('./glass');
const search = require('./search');
const i18n = require('./i18n');
const ipc = require('./ipc');
const demo = require('./demo');

const argv = process.argv.slice(1);
const arg = (name) => { const a = argv.find((x) => x === `--${name}` || x.startsWith(`--${name}=`)); return a ? (a.includes('=') ? a.slice(a.indexOf('=') + 1) : true) : null; };
const SMOKE_DIR = typeof arg('smoke') === 'string' ? arg('smoke') : null;
const DEMO = !!arg('demo') || !!SMOKE_DIR;
const DEMO_DARK = String(arg('demo')).endsWith('-dark');
const OFFLINE = DEMO && arg('online') === null;

const BAR_MARGIN = 12;          // marge de la capsule flottante (DESIGN.md §8)
const MIN_SIZE = { width: 1024, height: 680 };
const DEFAULT_SIZE = { width: 1280, height: 820 };

// Fenêtre unique, nom d'application, pas de clés Google ni de rapporteur de plantage.
app.setName('Qafila');
// User agent « Chrome ordinaire » partout (sans Electron/… ni Qafila/…) : la connexion Google l'exige.
app.userAgentFallback = desktopUserAgent(app.userAgentFallback);
if (SMOKE_DIR) {
  app.setPath('userData', path.join(SMOKE_DIR, 'userData'));
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
}
if (!app.requestSingleInstanceLock()) app.quit();

/** L'application : services et actions partagés par l'IPC et les raccourcis. */
const Q = {
  win: null, chrome: null, store: null, tabs: null, blocker: null, glass: null,
  chromeMode: 'strip', barHeight: 92, t: null, demo: DEMO, isFullscreenPage: false,
  pending: new Map(), broadcastTimer: null,
};

function isDark() { return nativeTheme.shouldUseDarkColors; }

function translator() {
  const lang = i18n.resolveLanguage(Q.store?.settings.language, app.getLocale());
  if (!Q.t || Q.t.lang !== lang) Q.t = i18n.translator(lang);
  return Q.t;
}

// ----- Géométrie : bande du chrome, page sous la bande -----
function stripRect() {
  if (!Q.win || Q.win.isDestroyed()) return null;
  const [w, h] = Q.win.getContentSize();
  const strip = Q.barHeight + 2 * BAR_MARGIN;
  const top = (Q.store.settings.toolbar?.position || 'top') === 'top';
  return { x: 0, y: top ? 0 : Math.max(0, h - strip), width: w, height: Math.min(h, strip) };
}

function layout() {
  if (!Q.win || Q.win.isDestroyed()) return;
  const [w, h] = Q.win.getContentSize();
  const full = { x: 0, y: 0, width: w, height: h };
  const strip = stripRect();
  const style = Q.store.settings.toolbar?.style || 'floating';
  // Style Classique : barre pleine et opaque, la page est posée sous elle (aucun recouvrement, pas de CSS injecté).
  let page = full;
  if (style === 'classic' && !Q.isFullscreenPage) {
    page = strip.y === 0 ? { x: 0, y: strip.height, width: w, height: h - strip.height } : { x: 0, y: 0, width: w, height: h - strip.height };
  }
  Q.tabs.setPageBounds(page);
  if (Q.isFullscreenPage) { Q.chrome.setBounds({ x: 0, y: h, width: w, height: 0 }); return; }
  Q.chrome.setBounds(Q.chromeMode === 'full' ? full : strip);
  Q.glass.setActive(style !== 'classic');
  Q.glass.refresh(30);
}

function setChrome(mode, height) {
  if (height) Q.barHeight = height;
  Q.chromeMode = mode;
  layout();
}

// ----- État poussé au chrome -----
function describeTabs() {
  const t = translator();
  return Q.store.tabs.map((tab) => {
    const live = Q.tabs.liveState(tab.id);
    const host = hostOf(tab.url || '');
    return {
      id: tab.id, url: tab.url, title: tab.title || (tab.url ? tab.url : t('new_tab')), isPrivate: tab.isPrivate,
      createdAt: tab.createdAt, lastVisited: tab.lastVisited, readingMinutes: tab.readingMinutes, faviconURL: tab.faviconURL,
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
    window: { fullscreen: Q.win?.isFullScreen() || false, maximized: Q.win?.isMaximized() || false, focused: Q.win?.isFocused() || false },
  };
}

function broadcast() {
  clearTimeout(Q.broadcastTimer);
  Q.broadcastTimer = setTimeout(() => {
    if (Q.chrome && !Q.chrome.webContents.isDestroyed()) Q.chrome.webContents.send('qafila:state', describeState());
  }, 16);
}

function command(name, data) { if (Q.chrome && !Q.chrome.webContents.isDestroyed()) Q.chrome.webContents.send('qafila:command', { name, ...data }); }

// ----- Actions -----
function newTab({ url = null, isPrivate = false, select = true } = {}) {
  const target = url || search.newTabURL(Q.store.settings);
  const tab = Q.store.addTab({ url: target, isPrivate, select });
  if (select) showSelected();
  else Q.tabs.ensure(tab.id);
  broadcast();
  return tab;
}

function selectTab(id) { Q.store.select(id); showSelected(); broadcast(); }

function showSelected() {
  const tab = Q.store.selectedTab;
  if (!tab) { if (!Q.store.tabs.length) newTab(); return; }
  Q.tabs.show(tab.id);
  Q.tabs.applyUserAgent(tab.id);
  if (!Q.chromeMode || Q.chromeMode === 'strip') Q.tabs.focus();
  Q.glass.refresh(80);
}

function closeTab(id) {
  const tab = Q.store.removeTab(id);
  if (!tab) return;
  Q.tabs.discard(id);
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
  if (!h) { Q.store.setSetting('javascriptEnabled', !Q.store.settings.javascriptEnabled); return; }
  Q.store.toggleHost('javascriptDisabledHosts', h);
  // Le réglage JavaScript d'une vue est fixé à sa création : la vue est recréée.
  Q.tabs.discard(tab.id);
  showSelected();
  broadcast();
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
  Q.store.clearHistory();
  broadcast();
  return true;
}

function onSettingChanged(key) {
  const s = Q.store.settings;
  if (key === 'appearance') nativeTheme.themeSource = s.appearance;
  if (key === 'toolbar') layout();
  if (key === 'textZoom') Q.tabs.applyZoom();
  if (key === 'language') { Q.t = null; translator(); Q.tabs.refreshStartPages(); }
  if (['darkenSites', 'darkenOnlyInDarkMode', 'darkenHosts'].includes(key)) Q.tabs.refreshDarken();
  if (['desktopByDefault', 'desktopHosts', 'customUserAgent'].includes(key)) Q.tabs.applyUserAgentToOpenTabs();
  if (['blockAds', 'blockTrackers', 'blockCookieBanners', 'blockerDisabledHosts'].includes(key)) { /* pris en compte à la prochaine requête */ }
  broadcast();
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
        const res = await net.fetch(base + search.encodeQuery(query), { signal: ctrl.signal, headers: { accept: 'application/json' } });
        clearTimeout(timer);
        const json = await res.json();
        const list = Array.isArray(json) ? (Array.isArray(json[1]) ? json[1] : json) : (json.suggestions || []);
        remote = list.map((x) => (typeof x === 'string' ? x : x?.phrase || x?.text || '')).filter(Boolean).slice(0, 6);
      } catch { remote = []; }
    }
  }
  return { local, remote };
}

// ----- Raccourcis clavier (depuis une page ou depuis le chrome) -----
function shortcut(event, input) {
  if (input.type !== 'keyDown') return false;
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  const shift = input.shift;
  const sel = Q.store.selected;
  const run = (fn) => { event.preventDefault(); fn(); return true; };
  if (input.alt && !mod) {
    if (key === 'ArrowLeft') return run(() => Q.tabs.back(sel));
    if (key === 'ArrowRight') return run(() => Q.tabs.forward(sel));
    return false;
  }
  if (key === 'F5') return run(() => Q.tabs.reload(sel));
  if (key === 'F11') return run(() => Q.win.setFullScreen(!Q.win.isFullScreen()));
  if (key === 'Escape') { if (Q.chromeMode === 'full') return run(() => command('escape')); if (Q.tabs.isLoading(sel)) return run(() => Q.tabs.stop(sel)); return false; }
  if (!mod) return false;
  switch (key) {
    case 't': return run(() => newTab({ isPrivate: false }));
    case 'n': if (shift) return run(() => newTab({ isPrivate: true })); return false;
    case 'w': return run(() => closeTab(sel));
    case 'Tab': return run(() => cycleTab(shift ? -1 : 1));
    case 'l': return run(() => command('focusAddress'));
    case 'r': return run(() => Q.tabs.reload(sel));
    case 'f': return run(() => command('find'));
    case 'd': return run(() => command('bookmark'));
    case 'h': return run(() => command('screen', { screen: 'history' }));
    case 'b': if (shift) return run(() => command('screen', { screen: 'bookmarks' })); return false;
    case 'a': if (shift) return run(() => command('screen', { screen: 'tabs' })); return false;
    case ',': return run(() => command('screen', { screen: 'settings' }));
    case '+': case '=': return run(() => zoom(10));
    case '-': return run(() => zoom(-10));
    case '0': return run(() => zoom(0));
    case 'T': if (shift) return run(() => reopenTab()); return false;
    default:
      if (/^[1-9]$/.test(key)) return run(() => { const i = key === '9' ? Q.store.tabs.length - 1 : Number(key) - 1; const t = Q.store.tabs[i]; if (t) selectTab(t.id); });
      return false;
  }
}

function cycleTab(dir) {
  const i = Q.store.tabs.findIndex((t) => t.id === Q.store.selected);
  if (i < 0) return;
  const n = Q.store.tabs.length;
  selectTab(Q.store.tabs[(i + dir + n) % n].id);
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
  const id = `${Date.now()}-${Math.random()}`;
  const chromeBounds = Q.chrome.getBounds();
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => { Q.pending.delete(id); resolve(null); }, 5000);
    Q.pending.set(id, (dataURL) => { clearTimeout(timer); resolve(dataURL); });
    Q.chrome.webContents.send('qafila:test:composite', {
      id, width: w, height: h,
      page: page && !page.isEmpty() ? { dataURL: page.toDataURL(), bounds: pageBounds } : null,
      chrome: chrome && !chrome.isEmpty() ? { dataURL: chrome.toDataURL(), bounds: chromeBounds } : null,
    });
  });
  if (result) fs.writeFileSync(file, Buffer.from(result.split(',')[1], 'base64'));
  else if (page) fs.writeFileSync(file, page.toPNG());
  return file;
}

ipcMain.on('qafila:test:composited', (_e, { id, dataURL }) => { const cb = Q.pending.get(id); if (cb) { Q.pending.delete(id); cb(dataURL); } });

// ----- Fenêtre -----
function createWindow() {
  const dark = isDark();
  Q.win = new BrowserWindow({
    ...DEFAULT_SIZE, minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height, title: 'Qafila', show: false,
    backgroundColor: dark ? '#000000' : '#ffffff', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);

  Q.blocker = new Blocker(() => Q.store.settings, (wcId) => Q.tabs.pageURLFor(wcId));
  Q.tabs = new TabManager({ win: Q.win, store: Q.store, blocker: Q.blocker, t: translator, isDark, offline: OFFLINE, userAgent: app.userAgentFallback });

  Q.chrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
      transparent: true,
    },
  });
  Q.chrome.setBackgroundColor('#00000000');
  Q.win.contentView.addChildView(Q.chrome);
  Q.chrome.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  Q.chrome.webContents.on('before-input-event', (e, input) => shortcut(e, input));
  Q.chrome.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) newTab({ url }); return { action: 'deny' }; });
  Q.chrome.webContents.on('will-navigate', (e) => e.preventDefault());

  Q.glass = new Glass({
    pageContents: () => (Q.store.selected ? Q.tabs.contents(Q.store.selected) : null),
    chromeContents: () => Q.chrome?.webContents || null,
    stripRect: () => ((Q.store.settings.toolbar?.style || 'floating') === 'classic' ? null : stripRect()),
  });

  Q.tabs.on('change', broadcast);
  Q.tabs.on('shown', () => broadcast());
  Q.tabs.on('glass', (id) => { if (id === Q.store.selected) Q.glass.refresh(50); });
  Q.tabs.on('scroll', (id, final) => { if (id === Q.store.selected) Q.glass.onScroll(final); });
  Q.tabs.on('open-tab', (o) => newTab(o));
  Q.tabs.on('found', (id, result) => { if (id === Q.store.selected) Q.chrome.webContents.send('qafila:found', result); });
  Q.tabs.on('status', (id, url) => { if (id === Q.store.selected) Q.chrome.webContents.send('qafila:status', url); });
  Q.tabs.on('input', shortcut);
  Q.tabs.on('fullscreen', (on) => { Q.isFullscreenPage = on; layout(); });
  Q.tabs.on('zoom', (dir) => zoom(dir === 'in' ? 10 : -10));

  Q.store.on('change', broadcast);
  Q.win.on('resize', () => { layout(); broadcast(); });
  Q.win.on('maximize', broadcast); Q.win.on('unmaximize', broadcast); Q.win.on('focus', broadcast); Q.win.on('blur', broadcast);
  Q.win.on('enter-full-screen', () => { layout(); broadcast(); }); Q.win.on('leave-full-screen', () => { layout(); broadcast(); });
  // Boutons latéraux de la souris : Précédent / Suivant.
  Q.win.on('app-command', (_e, cmd) => { if (cmd === 'browser-backward') Q.tabs.back(Q.store.selected); if (cmd === 'browser-forward') Q.tabs.forward(Q.store.selected); });
  Q.win.on('close', () => { Q.store.saveNow(); });
  Q.win.on('closed', () => { Q.win = null; });

  nativeTheme.on('updated', () => {
    if (!Q.win || Q.win.isDestroyed()) return;
    Q.win.setBackgroundColor(isDark() ? '#000000' : '#ffffff');
    Q.tabs.onThemeChanged();
    Q.chrome.webContents.send('qafila:theme', { dark: isDark() });
    broadcast();
  });

  // Téléchargements : dossier par défaut, pas de dialogue, notification au chrome.
  const onDownload = (_e, item) => {
    item.once('done', (_ev, state) => { if (state === 'completed') command('toast', { text: translator()('download_done', item.getFilename()) }); });
  };
  Q.tabs.persistent.on('will-download', onDownload);

  Q.chrome.webContents.once('did-finish-load', () => {
    layout();
    showSelected();
    Q.win.show();
    broadcast();
  });
  Q.win.once('ready-to-show', () => Q.win.show());
  layout();
}

// ----- Démarrage -----
app.whenReady().then(async () => {
  Q.store = new Store(app.getPath('userData'), { ephemeral: DEMO });
  Q.store.load();
  if (DEMO) demo.applyDemo(Q.store, { dark: DEMO_DARK, language: typeof arg('lang') === 'string' ? arg('lang') : 'fr' });
  nativeTheme.themeSource = Q.store.settings.appearance || 'system';
  if (!Q.store.tabs.length) Q.store.addTab({ url: search.newTabURL(Q.store.settings) });
  if (!Q.store.selected) Q.store.selected = Q.store.tabs[0].id;
  translator();

  ipc.register({
    get win() { return Q.win; }, get store() { return Q.store; }, get tabs() { return Q.tabs; }, get blocker() { return Q.blocker; }, demo: DEMO,
    t: translator, describeTabs, describeState, newTab, closeTab, closeAllTabs, reopenTab, selectTab, navigate, goHome, moveTab,
    toggleBookmark, toggleDarken, toggleDesktop, toggleBlocker, toggleJavascript, zoom, clearData, onSettingChanged, suggest, setChrome, screenshot,
  });

  createWindow();
  if (SMOKE_DIR) runSmoke().catch((e) => { console.error('Smoke :', e); app.exit(1); });
});

app.on('second-instance', () => { if (Q.win) { if (Q.win.isMinimized()) Q.win.restore(); Q.win.focus(); } });
app.on('window-all-closed', () => { Q.store?.saveNow(); app.quit(); });
app.on('before-quit', () => { Q.store?.saveNow(); });
app.on('web-contents-created', (_e, wc) => {
  // Aucune vue n'ouvre de fenêtre native ni ne charge de code distant dans le chrome.
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

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
  demoScreen('none'); await wait(900);
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
  app.exit(report.errors.length ? 1 : 0);
}
