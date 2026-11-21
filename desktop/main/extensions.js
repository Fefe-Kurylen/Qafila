'use strict';
// Extensions Chrome (comme dans Chrome) : installation depuis le Chrome Web Store (bouton « Ajouter à Chrome »),
// mises à jour automatiques, boutons des extensions dans la barre (<browser-action-list>, préchargement
// preload/browser-action.js), menus contextuels et API chrome.* (electron-chrome-extensions). Les extensions ne
// tournent que dans la session normale, jamais en navigation privée. Rien n'est installé sans la confirmation de
// l'utilisateur, qui voit ce que l'extension pourra faire.
const { app, dialog, session } = require('electron');
const path = require('node:path');

const STORE_URL = 'https://chromewebstore.google.com/';
const PARTITION = 'persist:qafila';

// Permissions d'extension → libellé i18n (ext_perm_<clé>) ; les autres ne sont pas détaillées.
const PERM_LABELS = ['tabs', 'history', 'bookmarks', 'downloads', 'cookies', 'clipboardRead', 'clipboardWrite', 'notifications', 'webRequest', 'declarativeNetRequest', 'scripting', 'storage', 'nativeMessaging', 'proxy', 'management'];

class Extensions {
  /**
   * @param {object} o
   * @param {import('./tabs').TabManager} o.tabs
   * @param {() => Electron.BrowserWindow} o.win
   * @param {() => Function} o.t
   * @param {(o: object) => object} o.newTab
   * @param {(id: string) => void} o.selectTab
   * @param {(id: string) => void} o.closeTab
   * @param {() => number} o.chromeOffset décalage vertical de la vue du chrome dans la fenêtre (barre de titre)
   * @param {() => void} o.onChange
   */
  constructor(o) {
    Object.assign(this, o);
    this.ext = null;
    this.ready = false;
    this.extensionsPath = path.join(app.getPath('userData'), 'Extensions');
  }

  get session() { return this.tabs.persistent; }

  /** Démarre la prise en charge des extensions (webStore = false : mode démo / test, sans le Chrome Web Store). */
  async init({ webStore = true } = {}) {
    const { ElectronChromeExtensions } = require('electron-chrome-extensions');
    // Icônes des extensions (crx://) dans le chrome, qui vit dans la session par défaut.
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
    this.ext = new ElectronChromeExtensions({
      session: this.session,
      createTab: async (details) => {
        const tab = this.newTab({ url: details.url || null, select: details.active !== false });
        const wc = this.tabs.ensure(tab.id)?.webContents;
        return [wc, this.win()];
      },
      selectTab: (wc) => { const id = this.tabs.tabIdFor(wc); if (id) this.selectTab(id); },
      removeTab: (wc) => { const id = this.tabs.tabIdFor(wc); if (id) this.closeTab(id); },
      createWindow: async (details) => {
        // Une seule fenêtre : chrome.windows.create ouvre ses adresses en onglets.
        for (const url of [].concat(details?.url || [])) this.newTab({ url, select: true });
        return this.win();
      },
      removeWindow: async () => {},
    });
    // Fenêtre d'une extension : placée sous son bouton, en tenant compte de la barre de titre de Qafila.
    // La position est corrigée avant d'être appliquée (« will-move ») : la fenêtre ne saute plus d'un endroit à l'autre,
    // et un fond assorti au thème évite l'éclair blanc à l'ouverture en mode sombre.
    this.ext.on('browser-action-popup-created', (popup) => {
      const w = popup.browserWindow;
      if (w && !w.isDestroyed() && this.isDark?.()) w.setBackgroundColor('#1c1c1e');
      popup.on('will-move', (pos) => { pos.y += this.chromeOffset() || 0; });
    });
    // Onglets existants et futurs.
    for (const [, view] of this.tabs.views) this.track(view.webContents);
    this.tabs.on('view', (_id, wc) => this.track(wc));
    this.tabs.on('shown', (id) => { const wc = this.tabs.contents(id); if (wc && this.isTracked(wc)) this.ext.selectTab(wc); });
    this.session.extensions.on('extension-loaded', () => { this.cache = null; this.onChange(); });
    this.session.extensions.on('extension-unloaded', () => { this.cache = null; this.onChange(); });
    if (webStore) {
      const { installChromeWebStore } = require('electron-chrome-web-store');
      await installChromeWebStore({
        session: this.session,
        extensionsPath: this.extensionsPath,
        autoUpdate: true,
        loadExtensions: true,
        beforeInstall: (details) => this.confirmInstall(details),
      });
    }
    this.ready = true;
    this.cache = null;
    this.onChange();
  }

  /** Onglet suivi par les extensions (jamais un onglet privé). */
  track(wc) {
    if (!this.ext || !wc || wc.isDestroyed() || wc.session !== this.session) return;
    if (this.isTracked(wc)) return;
    this.ext.addTab(wc, this.win());
    (this.trackedIds ||= new Set()).add(wc.id);
    wc.once('destroyed', () => this.trackedIds.delete(wc.id));
  }

  isTracked(wc) { return !!this.trackedIds?.has(wc.id); }

  /** « Ajouter à Chrome » sur le Web Store : confirmation avec ce que l'extension pourra faire. */
  async confirmInstall(details) {
    const t = this.t();
    const m = details.manifest || {};
    const perms = [].concat(m.permissions || []).filter((p) => PERM_LABELS.includes(p)).map((p) => '• ' + t('ext_perm_' + p));
    const hosts = [].concat(m.host_permissions || [], (m.content_scripts || []).flatMap((c) => c.matches || []));
    if (hosts.some((h) => /<all_urls>|^\*:\/\/\*\/|^https?:\/\/\*\//.test(h))) perms.unshift('• ' + t('ext_perm_all_sites'));
    const win = this.win();
    const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
      type: 'question',
      title: 'Qafila',
      message: t('ext_install_prompt', details.localizedName || m.name || details.id),
      detail: perms.length ? t('ext_install_can') + '\n' + perms.join('\n') : t('ext_install_nothing'),
      buttons: [t('ext_install_add'), t('cancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      icon: details.icon && !details.icon.isEmpty() ? details.icon : undefined,
    }).catch(() => ({ response: 1 }));
    return { action: response === 0 ? 'allow' : 'deny' };
  }

  /** Extensions installées, pour les réglages et la barre (liste gardée en mémoire jusqu'au prochain changement). */
  list() {
    if (!this.ext) return [];
    if (!this.cache) this.cache = this.computeList();
    return this.cache;
  }

  computeList() {
    return this.session.extensions.getAllExtensions().filter((e) => e.manifest && e.manifest.manifest_version).map((e) => {
      const m = e.manifest;
      const name = e.name && !/^__MSG_/.test(e.name) ? e.name : localized(m.name, e);
      const options = m.options_ui?.page || m.options_page || null;
      return {
        id: e.id,
        name,
        version: e.version || m.version || '',
        description: localized(m.description || '', e).slice(0, 200),
        hasAction: !!(m.action || m.browser_action),
        hasOptions: !!options,
        icon: `crx://extension-icon/${e.id}/32/2?partition=${encodeURIComponent(PARTITION)}`,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  openStore() { this.newTab({ url: STORE_URL, select: true }); }

  openOptions(id) {
    const e = this.session.extensions.getExtension(id);
    const page = e?.manifest?.options_ui?.page || e?.manifest?.options_page;
    if (!e || !page) return false;
    this.newTab({ url: `chrome-extension://${id}/${String(page).replace(/^\//, '')}`, select: true });
    return true;
  }

  async remove(id) {
    const e = this.session.extensions.getExtension(id);
    if (!e) return false;
    try {
      const { uninstallExtension } = require('electron-chrome-web-store');
      await uninstallExtension(id, { session: this.session, extensionsPath: this.extensionsPath });
    } catch {
      // Extension chargée hors du Web Store (essais) : simplement retirée de la session.
      try { this.session.extensions.removeExtension(id); } catch { /* déjà retirée */ }
    }
    this.cache = null;
    this.onChange();
    return true;
  }

  /** Entrées des extensions pour le menu contextuel d'une page (onglets normaux seulement). */
  contextMenuItems(wc, params) {
    if (!this.ext || !wc || !this.isTracked(wc)) return [];
    try { return this.ext.getContextMenuItems(wc, params) || []; } catch { return []; }
  }

  /**
   * Fermeture de Qafila : les extensions sont déchargées d'abord (sinon Electron peut rester bloqué à la sortie avec
   * un service worker d'extension actif). Elles sont rechargées au prochain démarrage depuis le dossier Extensions.
   */
  shutdown() {
    if (!this.ext || this.closed) return;
    this.closed = true;
    // Pages des onglets fermées d'abord, puis extensions déchargées : sans cela, la sortie peut rester bloquée.
    try { this.tabs.discardAll(); } catch { /* déjà fermées */ }
    try { for (const e of this.session.extensions.getAllExtensions()) this.session.extensions.removeExtension(e.id); } catch { /* déjà fermé */ }
  }

  /** Charge une extension décompressée (tests). */
  async loadUnpacked(dir) {
    return this.session.extensions.loadExtension(dir, { allowFileAccess: false });
  }
}

/** Nom localisé d'une extension (« __MSG_appName__ » → messages de la langue par défaut). */
function localized(value, ext) {
  const s = String(value || '');
  const m = /^__MSG_(\w+)__$/.exec(s);
  if (!m) return s;
  try {
    const fs = require('node:fs');
    const lang = ext.manifest.default_locale || 'en';
    const msgs = JSON.parse(fs.readFileSync(path.join(ext.path, '_locales', lang, 'messages.json'), 'utf8'));
    const key = Object.keys(msgs).find((k) => k.toLowerCase() === m[1].toLowerCase());
    return key ? String(msgs[key].message || s) : s;
  } catch { return s; }
}

module.exports = { Extensions, STORE_URL, PARTITION };
