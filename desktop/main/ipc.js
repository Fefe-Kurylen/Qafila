'use strict';
// Canaux IPC du chrome (window.qafila.*) : chaque canal valide ses arguments ; rien n'est exposé au-delà de cette liste.
const { ipcMain, shell, clipboard, app, nativeTheme } = require('electron');
const contract = require('./contract');
const settingsSchema = require('./settings');
const search = require('./search');
const support = require('./support');
const { hostOf } = require('./tabs');

const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v) => (typeof v === 'string' && /^[0-9A-Fa-f-]{36}$/.test(v) ? v : null);

/**
 * @param {object} app0 les services de l'application (store, tabs, actions, ui…)
 */
function register(a) {
  const { store, tabs } = a;
  const handle = (channel, fn) => ipcMain.handle(`qafila:${channel}`, async (_e, p) => fn(p || {}));
  const current = (p) => id(p.id) || store.selected;

  // ----- Onglets -----
  handle('tabs:list', () => a.describeTabs());
  handle('tabs:create', (p) => a.newTab({ url: str(p.url) || null, isPrivate: !!p.isPrivate, select: p.select !== false }).id);
  handle('tabs:close', (p) => a.closeTab(current(p)));
  handle('tabs:closeAll', (p) => a.closeAllTabs(typeof p.privateOnly === 'boolean' ? p.privateOnly : null));
  handle('tabs:reopen', () => a.reopenTab());
  handle('tabs:select', (p) => { const t = id(p.id); if (t) a.selectTab(t); });
  handle('tabs:navigate', (p) => a.navigate(str(p.text), current(p)));
  handle('tabs:back', (p) => tabs.back(current(p)));
  handle('tabs:forward', (p) => tabs.forward(current(p)));
  handle('tabs:reload', (p) => tabs.reload(current(p)));
  handle('tabs:stop', (p) => tabs.stop(current(p)));
  handle('tabs:goHome', (p) => a.goHome(current(p)));
  handle('tabs:snapshot', (p) => tabs.snapshot(current(p), Math.min(1600, Math.max(40, Number(p.width) || 320))));
  handle('tabs:move', (p) => a.moveTab(id(p.id), Number(p.index)));

  // ----- État -----
  handle('state:get', () => a.describeState());

  // ----- Favoris / historique -----
  handle('bookmarks:list', () => store.bookmarks);
  handle('bookmarks:add', (p) => { const b = store.addBookmark(str(p.title, 512), str(p.url)); tabs.refreshStartPages(); return b; });
  handle('bookmarks:remove', (p) => { store.removeBookmark(str(p.id)); tabs.refreshStartPages(); });
  handle('bookmarks:update', (p) => { store.updateBookmark(str(p.id), { title: str(p.patch?.title, 512), url: str(p.patch?.url) }); tabs.refreshStartPages(); });
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
  handle('settings:set', (p) => { const key = str(p.key, 64); const ok = store.setSetting(key, p.value); if (ok) a.onSettingChanged(key); return ok ? store.settings[key] : null; });
  handle('settings:reset', (p) => { const key = str(p.key, 64); const d = settingsSchema.defaults(); if (!(key in d)) return null; store.setSetting(key, d[key]); a.onSettingChanged(key); return store.settings[key]; });
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
  handle('page:find', (p) => tabs.findInPage(store.selected, str(p.text, 512), p));
  handle('page:stopFind', (p) => tabs.stopFind(store.selected, ['clearSelection', 'keepSelection', 'activateSelection'].includes(p.action) ? p.action : 'clearSelection'));
  handle('page:toggleReader', () => tabs.toggleReader(store.selected));
  handle('page:toggleDarken', () => a.toggleDarken());
  handle('page:toggleDesktop', () => a.toggleDesktop());
  handle('page:toggleBlocker', () => a.toggleBlocker());
  handle('page:toggleJavascript', () => a.toggleJavascript());
  handle('page:translate', () => tabs.translate(store.selected));
  handle('page:scrollTo', (p) => tabs.scrollTo(store.selected, p.where === 'bottom' ? 'bottom' : 'top'));
  handle('page:zoom', (p) => a.zoom(Number(p.delta) || 0));
  handle('page:copyLink', () => { const u = store.selectedTab?.url; if (u) clipboard.writeText(u); return !!u; });
  handle('page:share', () => { const u = store.selectedTab?.url; if (u) clipboard.writeText(u); return !!u; });

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
    engines: Object.fromEntries(Object.entries(search.ENGINES).map(([k, v]) => [k, v.label])),
    theme: { dark: nativeTheme.shouldUseDarkColors },
  }));
  handle('openExternal', (p) => { const u = str(p.url); if (/^https?:\/\//i.test(u)) return shell.openExternal(u).then(() => true, () => false); return false; });

  // ----- Soutenir Qafila : lien Stripe ouvert dans le navigateur par défaut (jamais dans un onglet) -----
  handle('support:info', () => support.info());
  handle('support:open', () => support.open());

  // ----- Interface -----
  handle('ui:setChrome', (p) => a.setChrome(p.mode === 'full' ? 'full' : 'strip', Math.min(400, Math.max(40, Number(p.height) || 0))));
  handle('ui:window', (p) => {
    const w = a.win;
    if (p.action === 'close') w.close();
    else if (p.action === 'minimize') w.minimize();
    else if (p.action === 'maximize') (w.isMaximized() ? w.unmaximize() : w.maximize());
  });

  // ----- Tests -----
  handle('test:screenshot', (p) => a.screenshot(str(p.name, 64)));
}

module.exports = { register, hostOf };
