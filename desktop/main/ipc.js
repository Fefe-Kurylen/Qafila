'use strict';
// Canaux IPC du chrome (window.qafila.*) : chaque canal valide ses arguments ; rien n'est exposé au-delà de cette liste.
const { ipcMain, shell, app, nativeTheme, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const contract = require('./contract');
const settingsSchema = require('./settings');
const search = require('./search');
const support = require('./support');
const { hostOf, copyText } = require('./tabs');

const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');
// Réglages jamais modifiables par settings:set / settings:reset : le dossier de téléchargement ne change que par le
// dialogue natif (downloads:chooseFolder) ou downloads:resetFolder.
const PROTECTED_KEYS = new Set(['downloadFolder']);

// Seul le document du chrome (renderer/index.html, cadre principal de la vue du chrome) peut appeler les canaux.
const RENDERER_URL = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html'));
const samePath = (a, b) => (process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Le message vient-il du chrome ? Vérifie la vue émettrice ET le cadre (principal, adresse file:// du chrome).
 * Une page web (même avec un moteur de rendu compromis) ne passe jamais ce contrôle.
 * @param {Electron.IpcMainEvent|Electron.IpcMainInvokeEvent} e
 * @param {Electron.WebContents|null|undefined} chromeWC
 */
function isChromeSender(e, chromeWC) {
  if (!chromeWC || chromeWC.isDestroyed() || e?.sender !== chromeWC) return false;
  const frame = e.senderFrame;
  if (!frame || frame.parent) return false;
  let u;
  try { u = new URL(frame.url); } catch { return false; }
  if (u.protocol !== 'file:' || u.host !== RENDERER_URL.host) return false;
  try { return samePath(decodeURIComponent(u.pathname), decodeURIComponent(RENDERER_URL.pathname)); } catch { return false; }
}

const id = (v) => (typeof v === 'string' && /^[0-9A-Fa-f-]{36}$/.test(v) ? v : null);

/**
 * @param {object} app0 les services de l'application (store, tabs, actions, ui…)
 */
function register(a) {
  // Accès paresseux : les onglets (TabManager) sont créés avec la fenêtre, après l'enregistrement des canaux.
  const store = a.store;
  const handle = (channel, fn) => ipcMain.handle(`qafila:${channel}`, async (e, p) => {
    if (!isChromeSender(e, a.chrome?.webContents)) throw new Error('qafila: émetteur refusé');
    return fn(p && typeof p === 'object' ? p : {});
  });
  const current = (p) => id(p.id) || store.selected;

  // ----- Onglets -----
  handle('tabs:list', () => a.describeTabs());
  // Bouton + / Nouvel onglet (privé) sans adresse : le champ d'adresse du nouvel onglet prend le focus.
  handle('tabs:create', (p) => { const url = str(p.url) || null; return a.newTab({ url, isPrivate: !!p.isPrivate, select: p.select !== false, focus: !url }).id; });
  handle('tabs:close', (p) => a.closeTab(current(p)));
  handle('tabs:closeAll', (p) => a.closeAllTabs(typeof p.privateOnly === 'boolean' ? p.privateOnly : null));
  handle('tabs:reopen', () => a.reopenTab());
  handle('tabs:select', (p) => { const t = id(p.id); if (t) a.selectTab(t); });
  handle('tabs:navigate', (p) => a.navigate(str(p.text), current(p)));
  handle('tabs:back', (p) => a.tabs.back(current(p)));
  handle('tabs:forward', (p) => a.tabs.forward(current(p)));
  handle('tabs:reload', (p) => a.tabs.reload(current(p)));
  handle('tabs:stop', (p) => a.tabs.stop(current(p)));
  handle('tabs:goHome', (p) => a.goHome(current(p)));
  handle('tabs:snapshot', (p) => a.tabs.snapshot(current(p), Math.min(1600, Math.max(40, Number(p.width) || 320))));
  handle('tabs:move', (p) => a.moveTab(id(p.id), Number(p.index)));

  // ----- État -----
  handle('state:get', () => a.describeState());

  // ----- Favoris / historique -----
  handle('bookmarks:list', () => store.bookmarks);
  handle('bookmarks:add', (p) => { const b = store.addBookmark(str(p.title, 512), str(p.url)); a.tabs.refreshStartPages(); return b; });
  handle('bookmarks:remove', (p) => { store.removeBookmark(str(p.id)); a.tabs.refreshStartPages(); });
  handle('bookmarks:update', (p) => { store.updateBookmark(str(p.id), { title: str(p.patch?.title, 512), url: str(p.patch?.url) }); a.tabs.refreshStartPages(); });
  handle('bookmarks:toggleCurrent', () => a.toggleBookmark());
  handle('history:list', (p) => {
    const q = str(p.query, 256).toLowerCase();
    const limit = Math.min(2000, Math.max(1, Number(p.limit) || 500));
    return (q ? store.history.filter((h) => h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) : store.history).slice(0, limit);
  });
  handle('history:remove', (p) => store.removeHistory(str(p.id)));
  handle('history:clear', () => store.clearHistory());

  // ----- Réglages -----
  handle('settings:get', () => store.settings);
  handle('settings:set', (p) => { const key = str(p.key, 64); if (PROTECTED_KEYS.has(key)) return null; const ok = store.setSetting(key, p.value); if (ok) a.onSettingChanged(key); return ok ? store.settings[key] : null; });
  handle('settings:reset', (p) => { const key = str(p.key, 64); const d = settingsSchema.defaults(); if (!Object.hasOwn(d, key) || PROTECTED_KEYS.has(key)) return null; store.setSetting(key, d[key]); a.onSettingChanged(key); return store.settings[key]; });
  handle('settings:schema', () => settingsSchema.describe());
  handle('settings:applyPreset', (p) => {
    const cfg = settingsSchema.presetConfig(str(p.id, 32));
    const prev = store.settings.toolbar || {};
    store.setSetting('toolbar', { ...cfg, style: prev.style || cfg.style, position: prev.position || cfg.position });
    const preset = contract.toolbarActions().presets.find((x) => x.id === cfg.preset);
    if (preset?.platformMenuIcon?.android) store.setSetting('menuIcon', preset.platformMenuIcon.android);
    a.onSettingChanged('toolbar');
    return store.settings.toolbar;
  });

  // ----- Page courante -----
  handle('page:find', (p) => a.tabs.findInPage(store.selected, str(p.text, 512), p));
  handle('page:stopFind', (p) => a.tabs.stopFind(store.selected, ['clearSelection', 'keepSelection', 'activateSelection'].includes(p.action) ? p.action : 'clearSelection'));
  handle('page:toggleReader', () => a.tabs.toggleReader(store.selected));
  handle('page:toggleDarken', () => a.toggleDarken());
  handle('page:toggleDesktop', () => a.toggleDesktop());
  handle('page:toggleBlocker', () => a.toggleBlocker());
  handle('page:toggleJavascript', () => a.toggleJavascript());
  handle('page:translate', () => a.tabs.translate(store.selected));
  handle('page:scrollTo', (p) => a.tabs.scrollTo(store.selected, p.where === 'bottom' ? 'bottom' : 'top'));
  handle('page:zoom', (p) => a.zoom(Number(p.delta) || 0));
  handle('page:copyLink', () => { const u = store.selectedTab?.url; return u ? copyText(u) : false; });
  handle('page:share', () => { const u = store.selectedTab?.url; return u ? copyText(u) : false; });

  // ----- Données, suggestions, configuration -----
  handle('data:clear', () => a.clearData());
  handle('suggest', (p) => a.suggest(str(p.query, 256)));
  handle('config', () => ({
    actions: contract.toolbarActions(),
    settingsKeys: settingsSchema.describe(),
    strings: a.t().all(),
    lang: a.t().lang,
    rtl: a.t().rtl,
    app: { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, demo: !!a.demo },
    // Noms des moteurs dans la langue de l'interface (« Personnalisé », « SearXNG (instance) »… passent par l'i18n).
    engines: Object.fromEntries(Object.keys(search.ENGINES).map((k) => [k, a.t()('engine_' + k)])),
    theme: { dark: nativeTheme.shouldUseDarkColors },
  }));
  handle('openExternal', (p) => { const u = str(p.url); if (/^https?:\/\//i.test(u)) return shell.openExternal(u).then(() => true, () => false); return false; });

  // ----- Téléchargements : choix du dossier (dialogue natif) et ouverture dans le gestionnaire de fichiers -----
  handle('downloads:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(a.win, { properties: ['openDirectory', 'createDirectory'], defaultPath: store.settings.downloadFolder || app.getPath('downloads') });
    if (r.canceled || !r.filePaths[0] || !path.isAbsolute(r.filePaths[0])) return null;
    store.setSetting('downloadFolder', r.filePaths[0]);
    a.onSettingChanged('downloadFolder');
    return r.filePaths[0];
  });
  handle('downloads:resetFolder', () => { store.setSetting('downloadFolder', ''); a.onSettingChanged('downloadFolder'); return true; });
  handle('downloads:openFolder', () => shell.openPath(a.downloadFolder()).then((err) => !err, () => false));

  // ----- Soutenir Qafila : lien Stripe ouvert dans le navigateur par défaut (jamais dans un onglet) -----
  handle('support:info', () => support.info());
  handle('support:open', () => support.open());

  // ----- Mises à jour de l'application (main/updater.js) -----
  handle('update:check', () => (a.updater ? a.updater.check() : { status: 'disabled' }));
  handle('update:install', () => (a.updater ? a.updater.install() : false));

  // ----- Interface -----
  handle('ui:setChrome', (p) => a.setChrome(p.mode === 'full' ? 'full' : 'strip', Math.min(400, Math.max(40, Number(p.height) || 0)), { find: p.find === true }));
  // Réduire : un clic sur la mini-adresse rouvre la barre.
  handle('ui:expand', () => a.expandBar());
  handle('ui:focus', (p) => a.focusUI(p.target === 'chrome' ? 'chrome' : 'page'));
  handle('ui:window', (p) => {
    const w = a.win;
    if (p.action === 'close') w.close();
    else if (p.action === 'minimize') w.minimize();
    else if (p.action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  });

  // ----- Tests -----
  handle('test:screenshot', (p) => a.screenshot(str(p.name, 64)));
}

module.exports = { register, hostOf, isChromeSender };
