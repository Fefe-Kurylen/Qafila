'use strict';
// Gestion des onglets : une WebContentsView par onglet (partition « persist:qafila », ou « qafila-private » partagée
// par tous les onglets privés et vidée avec le dernier), navigation, comportements web portés du mobile (HTTPS forcé
// avec repli, schémas externes, fenêtres surgissantes → onglets, lecteur, assombrissement, user agent, zoom, bloqueur).
const { WebContentsView, session, shell, clipboard, Menu, dialog } = require('electron');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const scripts = require('./scripts');
const search = require('./search');
const { safeFaviconURL } = require('./favicon');

const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page.js');

/** Copie un texte (Electron 44+ : clipboard.writeText renvoie une promesse ; un échec est ignoré). */
function copyText(text) { return clipboard.writeText(String(text)).then(() => true, () => false); }

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const INTERNAL_SCHEMES = new Set(['http:', 'https:', 'about:', 'file:', 'data:', 'blob:', 'chrome:', 'devtools:', 'chrome-error:']);
// Applications externes : courriel et téléphone seulement, après un geste récent de l'utilisateur et sa confirmation.
const EXTERNAL_SCHEMES = new Set(['mailto:', 'tel:']);
const GESTURE_WINDOW_MS = 3000;
const GESTURE_EVENTS = new Set(['mouseDown', 'keyDown', 'rawKeyDown', 'gestureTap', 'touchStart']);
// Monde isolé de l'extracteur du lecteur (999 est celui des préchargements d'Electron).
const READER_WORLD = 1001;
const MAX_LIVE_VIEWS = 8;
// Plantage du moteur de rendu : au plus un rechargement automatique par onglet et par minute, puis page d'erreur.
const CRASH_RELOAD_MS = 60_000;
// Permissions accordées sans question : aucune n'expose l'appareil ni l'utilisateur (plein écran, verrouillage du
// pointeur, écriture filtrée du presse-papiers). Tout le reste est refusé : notifications, géolocalisation, caméra et
// micro (media), MIDI, lecture du presse-papiers, gestion des fenêtres (getScreenDetails : écrans, positions,
// libellés), capteurs, stockage partagé entre sites, ouverture d'applications (gérée à part, avec confirmation)…
const GRANTED_PERMISSIONS = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
// User agent mobile : même version majeure de Chrome que le moteur (sinon l'écart UA / moteur distingue l'utilisateur).
const CHROME_MAJOR = String(process.versions.chrome || '140').split('.')[0];
const MOBILE_UA = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Mobile Safari/537.36`;
// JavaScript désactivé (réglage global ou par site) : appliqué à chaque document par cet en-tête, quelle que soit la
// vue (redirection vers un site désactivé, réglage changé après l'ouverture de l'onglet).
const NO_SCRIPT_CSP = "script-src 'none'";
const ERR_ABORTED = -3;

/** User agent « Chrome ordinaire » : sans Electron/… ni Qafila/… (la connexion Google exige un navigateur connu). */
function desktopUserAgent(fallback) {
  return String(fallback || '').replace(/\sElectron\/\S+/g, '').replace(/\sQafila\/\S+/gi, '').replace(/\squafila-desktop\/\S+/gi, '');
}

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
function stripWWW(h) { return h.startsWith('www.') ? h.slice(4) : h; }

class TabManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {Electron.BrowserWindow} o.win fenêtre
   * @param {import('./store').Store} o.store état
   * @param {import('./blocker').Blocker} o.blocker bloqueur
   * @param {() => import('./i18n').translator} o.t traducteur courant
   * @param {() => boolean} o.isDark thème sombre effectif
   * @param {boolean} [o.offline] mode démo hors ligne : pages d'article locales
   */
  constructor({ win, store, blocker, t, isDark, offline = false, userAgent }) {
    super();
    this.win = win;
    this.store = store;
    this.blocker = blocker;
    this.t = t;
    this.isDark = isDark;
    this.offline = offline;
    this.views = new Map();      // tabId → WebContentsView
    this.live = new Map();       // tabId → { loading, progress, canGoBack, canGoForward, blocked }
    this.readerActive = new Set();
    this.upgradedFrom = new Map(); // webContentsId → adresse http d'origine d'un passage forcé en https
    this.httpOnlyHosts = new Set();
    this.lastGesture = new Map();  // webContentsId → instant du dernier clic / appui de touche dans la page
    this.externalPrompt = new Set(); // webContentsId dont une demande d'application externe est ouverte
    this.downloadState = new Map(); // webContentsId → { used, at } : téléchargements de l'onglet (geste / automatique)
    this.trustedNav = new Map();   // webContentsId → la navigation en cours vient du navigateur ou d'un geste
    this.popupGesture = new Map(); // webContentsId → instant du geste déjà consommé par une fenêtre surgissante
    this.crashReloads = new Map(); // tabId → instant du dernier rechargement après un plantage
    this.attached = null;        // onglet dont la vue est affichée
    this.pageBounds = { x: 0, y: 0, width: 0, height: 0 };
    this.userAgent = desktopUserAgent(userAgent);
    this.persistent = session.fromPartition('persist:qafila');
    this.private = null;
    this.privateClearing = null;   // effacement de la session privée en cours (attendu avant toute nouvelle page privée)
    this.prepare(this.persistent);
  }

  // ----- Sessions -----
  prepare(ses) {
    ses.setUserAgent(this.userAgent);
    ses.setSpellCheckerEnabled(false);
    // Téléchargements : traités par le processus principal (dossier par défaut, notification dans la barre).
    ses.on('will-download', (_e, item, wc) => this.emit('download', item, wc, ses === this.private));
    // Permissions : rien n'est accordé en silence qui révèle l'appareil ou l'utilisateur (voir GRANTED_PERMISSIONS).
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(GRANTED_PERMISSIONS.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => GRANTED_PERMISSIONS.has(permission));
    // Périphériques (USB, HID, série, Bluetooth) : jamais.
    ses.setDevicePermissionHandler(() => false);
    // Un seul gestionnaire onBeforeRequest par session (un second appel remplacerait le premier) :
    // 1) HTTPS forcé : les navigations principales en http partent en https ; en cas d'échec, retour en http (did-fail-load) ;
    // 2) bloqueur : requêtes tierces vers les domaines publicitaires / traqueurs / bandeaux annulées.
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, cb) => {
      if (details.resourceType === 'mainFrame') {
        const upgraded = this.upgrade(details);
        return cb(upgraded ? { redirectURL: upgraded } : {});
      }
      cb(this.blocker.shouldBlock(details) ? { cancel: true } : {});
    });
    // Un seul gestionnaire onHeadersReceived par session : JavaScript désactivé = « script-src 'none' » ajouté au
    // document (les politiques s'additionnent : le site ne peut pas l'assouplir). Cadre principal : réglage de son
    // adresse ; sous-cadre : réglage de la page qui le contient (comme Chrome, réglage par site de premier niveau).
    ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
      const { resourceType } = details;
      if (resourceType !== 'mainFrame' && resourceType !== 'subFrame') return cb({});
      const top = resourceType === 'mainFrame' ? details.url : (this.pageURLFor(details.webContentsId) || details.url);
      if (this.isJavaScriptEnabled(top)) return cb({});
      const headers = { ...(details.responseHeaders || {}) };
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy';
      headers[key] = [...[].concat(headers[key] || []), NO_SCRIPT_CSP];
      cb({ responseHeaders: headers });
    });
  }

  /** Adresse https à utiliser pour une navigation principale en http, ou null. */
  upgrade(details) {
    if (!details.url.startsWith('http://') || !this.store.settings.upgradeToHTTPS) return null;
    const host = hostOf(details.url);
    if (!host || this.httpOnlyHosts.has(host) || host === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith('[') || host.endsWith('.local')) return null;
    this.upgradedFrom.set(details.webContentsId, details.url);
    return 'https://' + details.url.slice('http://'.length);
  }

  /** Session d'un onglet (privée ou persistante). */
  sessionFor(tab) { return tab?.isPrivate ? this.privateSession() : this.persistent; }

  privateSession() {
    if (!this.private) { this.private = session.fromPartition('qafila-private'); this.prepare(this.private); }
    return this.private;
  }

  /**
   * Plus aucun onglet privé : les données de navigation privée disparaissent avec la dernière page, connexions
   * ouvertes (keep-alive, HTTP/2) et cache DNS compris. Une nouvelle page privée attend la fin de l'effacement (open).
   */
  dropPrivateData() {
    if (!this.private) return null;
    const s = this.private;
    const run = () => Promise.all([
      s.closeAllConnections(), s.clearStorageData(), s.clearCache(), s.clearAuthCache(), s.clearHostResolverCache(),
    ].map((p) => Promise.resolve(p).catch(() => {})));
    const job = (this.privateClearing || Promise.resolve()).then(run);
    this.privateClearing = job;
    job.then(() => { if (this.privateClearing === job) this.privateClearing = null; });
    return job;
  }

  // ----- Vues -----
  view(tabId) { return this.views.get(tabId) || null; }
  contents(tabId) { return this.views.get(tabId)?.webContents || null; }

  tabIdFor(wc) {
    for (const [id, v] of this.views) if (v.webContents === wc || v.webContents.id === wc) return id;
    return null;
  }

  /** Crée (ou renvoie) la vue d'un onglet ; charge l'adresse de l'onglet ou la page de démarrage. */
  ensure(tabId) {
    const existing = this.views.get(tabId);
    if (existing) return existing;
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!tab) return null;
    const ses = tab.isPrivate ? this.privateSession() : this.persistent;
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: PAGE_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false,
        javascript: true, // réglage JavaScript appliqué à chaque document (onHeadersReceived), pas à la vue
        backgroundThrottling: true,
        safeDialogs: true,
        zoomFactor: this.zoomFactor(),
      },
    });
    view.setBackgroundColor(this.isDark() ? '#000000' : '#ffffff');
    this.views.set(tabId, view);
    this.live.set(tabId, { loading: false, progress: 0, canGoBack: false, canGoForward: false, blocked: 0 });
    this.wire(view.webContents, tabId);
    this.applyUserAgent(tabId);
    this.open(tabId, tab.url, { initial: true });
    setImmediate(() => this.evictIfNeeded(tabId));
    return view;
  }

  /** Charge une adresse dans l'onglet (null = page de démarrage locale). */
  open(tabId, url, { initial = false } = {}) {
    const wc = this.contents(tabId);
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!wc || !tab) return;
    // Onglet privé pendant l'effacement de la session privée précédente : chargement après la fin de l'effacement.
    if (tab.isPrivate && this.privateClearing) {
      this.privateClearing.then(() => { if (!wc.isDestroyed()) this.open(tabId, url, { initial }); });
      return;
    }
    this.readerActive.delete(tabId);
    if (url && url !== 'about:blank' && !url.startsWith('about:')) {
      if (this.offline && /^https?:/.test(url)) {
        // Mode démo hors ligne : page d'article locale, l'adresse affichée reste celle de l'onglet.
        const html = scripts.demoArticle({ title: tab.title || stripWWW(hostOf(url)), host: stripWWW(hostOf(url)), minutes: tab.readingMinutes || 4, dark: this.isDark() });
        wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        return;
      }
      wc.loadURL(url).catch(() => {});
      return;
    }
    // Accueil ou page vide : l'onglet repart de zéro (adresse, titre, icône et temps de lecture de l'ancien site).
    if (!initial) this.store.updateTab(tabId, { url: url || null, title: '', faviconURL: null, themeColorHex: null, readingMinutes: 0 });
    if (url === 'about:blank') { wc.loadURL('about:blank'); return; }
    this.loadStartPage(wc);
  }

  loadStartPage(wc) {
    const t = this.t();
    const html = scripts.startPage({ dark: this.isDark(), bookmarks: this.store.bookmarks, title: t('new_tab'), rtl: t.rtl, lang: t.lang });
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }

  /** Affiche la vue d'un onglet (sous le chrome) et détache l'ancienne, qui reste vivante. */
  show(tabId) {
    const view = this.ensure(tabId);
    if (!view) return;
    if (this.attached && this.attached !== tabId) {
      const old = this.views.get(this.attached);
      if (old) { try { this.win.contentView.removeChildView(old); } catch { /* déjà détachée */ } }
    }
    if (this.attached !== tabId || !this.win.contentView.children.includes(view)) {
      this.win.contentView.addChildView(view, 0); // index 0 : toujours sous la vue du chrome
    }
    this.attached = tabId;
    view.setBounds(this.pageBounds);
    this.emit('shown', tabId);
  }

  setPageBounds(b) {
    this.pageBounds = b;
    const v = this.attached && this.views.get(this.attached);
    if (v) v.setBounds(b);
  }

  focus() { const wc = this.attached && this.contents(this.attached); if (wc && !wc.isDestroyed()) wc.focus(); }

  /** Garde au plus MAX_LIVE_VIEWS pages vivantes : les moins récemment visitées sont libérées (rechargées à l'ouverture). */
  evictIfNeeded(keep) {
    if (this.views.size <= MAX_LIVE_VIEWS) return;
    const protect = new Set([keep, this.store.selected, this.attached]);
    const visited = (id) => this.store.tabs.find((t) => t.id === id)?.lastVisited || 0;
    const victims = [...this.views.keys()].filter((id) => !protect.has(id)).sort((a, b) => visited(a) - visited(b));
    for (const id of victims.slice(0, this.views.size - MAX_LIVE_VIEWS)) this.discard(id);
  }

  discard(tabId) {
    const view = this.views.get(tabId);
    if (!view) return;
    if (this.attached === tabId) { try { this.win.contentView.removeChildView(view); } catch { /* ignoré */ } this.attached = null; }
    const wc = view.webContents;
    this.blocker.forget(wc.id);
    this.upgradedFrom.delete(wc.id);
    this.lastGesture.delete(wc.id);
    this.externalPrompt.delete(wc.id);
    this.downloadState.delete(wc.id);
    this.trustedNav.delete(wc.id);
    this.popupGesture.delete(wc.id);
    this.views.delete(tabId);
    this.live.delete(tabId);
    this.readerActive.delete(tabId);
    try { if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false }); } catch { /* ignoré */ }
  }

  discardAll() { for (const id of [...this.views.keys()]) this.discard(id); }

  // ----- Événements d'une page -----
  wire(wc, tabId) {
    const update = (patch) => { const l = this.live.get(tabId); if (l) { Object.assign(l, patch); this.emit('change', tabId); } };
    const navState = () => update({ canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() });

    wc.on('did-start-loading', () => update({ loading: true, progress: 0.1 }));
    wc.on('did-stop-loading', () => { update({ loading: false, progress: 1 }); navState(); this.emit('glass', tabId); });
    wc.on('did-start-navigation', (e) => {
      const { isMainFrame, isSameDocument, initiator } = e;
      if (!isMainFrame || isSameDocument) return;
      this.blocker.resetCount(wc.id);
      // Navigation du navigateur (adresse, favori, Précédent : sans cadre initiateur) ou suivant un geste récent :
      // seule une telle page, une fois affichée (did-navigate), remet à zéro le compteur de téléchargements. Une page
      // qui se redirige seule vers des fichiers (location.href en boucle) ne le remet donc jamais à zéro.
      this.trustedNav.set(wc.id, !initiator || this.recentGesture(wc));
      update({ blocked: 0, progress: 0.2 });
    });
    wc.on('dom-ready', () => {
      update({ progress: 0.6 });
      const url = wc.getURL();
      const css = this.blocker.cssFor(url);
      if (css) wc.insertCSS(css).catch(() => {});
      const tab = this.store.tabs.find((x) => x.id === tabId);
      if (tab && this.isDarkened(tab)) wc.insertCSS(scripts.darkenCSS).catch(() => {});
    });
    wc.on('did-navigate', (_e, url, code) => {
      // Nouveau document affiché (un téléchargement n'en affiche aucun) : de nouveau un téléchargement automatique
      // permis, si la navigation venait du navigateur ou d'un geste de l'utilisateur.
      if (this.trustedNav.get(wc.id)) this.downloadState.delete(wc.id);
      this.trustedNav.delete(wc.id);
      this.emit('navigated', tabId);
      this.trackURL(tabId, url);
      navState();
      update({ blocked: this.blocker.count(wc.id) });
      if (code >= 200 && code < 400 && url.startsWith('https://')) {
        const from = this.upgradedFrom.get(wc.id);
        if (from && from.replace(/^http:/, 'https:') === url) this.upgradedFrom.delete(wc.id);
      }
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) { this.trackURL(tabId, url); navState(); } });
    wc.on('did-redirect-navigation', (_e, url, _inPlace, isMainFrame) => {
      // https a renvoyé vers http : on reste en http pour ce site, sans boucler.
      if (!isMainFrame) return;
      const from = this.upgradedFrom.get(wc.id);
      if (from && url.startsWith('http://') && hostOf(url) === hostOf(from)) { this.httpOnlyHosts.add(hostOf(url)); this.upgradedFrom.delete(wc.id); }
    });
    wc.on('page-title-updated', (_e, title) => {
      if (this.isLocal(wc.getURL())) return;
      this.store.updateTab(tabId, { title });
      this.emit('change', tabId);
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (this.isLocal(wc.getURL()) || !favicons?.length) return;
      const tab = this.store.tabs.find((x) => x.id === tabId);
      const icon = favicons.map(safeFaviconURL).find(Boolean);
      if (tab && !tab.isPrivate && icon) this.store.updateTab(tabId, { faviconURL: icon });
      this.emit('change', tabId);
    });
    wc.on('did-finish-load', () => {
      const tab = this.store.tabs.find((x) => x.id === tabId);
      if (tab && !this.isLocal(wc.getURL())) this.store.recordVisit(tab);
      update({ loading: false, progress: 1 });
      this.emit('glass', tabId);
    });
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED || code === 0) return;
      const from = this.upgradedFrom.get(wc.id);
      if (from && validatedURL === from.replace(/^http:/, 'https:')) {
        // Le site n'existe pas en https : retour à l'adresse http d'origine.
        this.upgradedFrom.delete(wc.id);
        this.httpOnlyHosts.add(hostOf(from));
        wc.loadURL(from).catch(() => {});
        return;
      }
      if (code === -302 /* ERR_UNKNOWN_URL_SCHEME */) { this.openExternal(validatedURL, wc); return; }
      this.showError(wc, description, validatedURL);
    });
    wc.on('render-process-gone', () => {
      this.readerActive.delete(tabId);
      if (wc.isDestroyed()) return;
      if (this.store.selected !== tabId) { this.discard(tabId); return; }
      const tab = this.store.tabs.find((x) => x.id === tabId);
      if (!tab) return;
      const now = Date.now();
      if (now - (this.crashReloads.get(tabId) || 0) >= CRASH_RELOAD_MS) { this.crashReloads.set(tabId, now); this.open(tabId, tab.url); return; }
      // Second plantage en moins d'une minute : page d'erreur plutôt qu'une boucle plantage / rechargement.
      this.showError(wc, this.t()('page_crashed'), tab.url || '');
    });
    wc.on('will-navigate', (e, url) => {
      let scheme = '';
      try { scheme = new URL(url).protocol; } catch { return; }
      if (!INTERNAL_SCHEMES.has(scheme)) { e.preventDefault(); this.openExternal(url, wc); }
    });
    wc.setWindowOpenHandler(({ url }) => {
      // target=_blank / window.open : un nouvel onglet dans Qafila (privé si l'onglet d'origine l'est), seulement
      // juste après un geste de l'utilisateur, un onglet par geste (bloqueur de fenêtres surgissantes : Electron n'en a
      // pas). Sans geste, rien ne s'ouvre et la barre le signale. « Ouvrir dans un nouvel onglet » (menu) n'est pas concerné.
      const tab = this.store.tabs.find((x) => x.id === tabId);
      if (!/^https?:/.test(url)) { this.openExternal(url, wc); return { action: 'deny' }; }
      const gesture = this.lastGesture.get(wc.id) || 0;
      if (!this.recentGesture(wc) || this.popupGesture.get(wc.id) === gesture) { this.emit('popup-blocked', tabId, url); return { action: 'deny' }; }
      this.popupGesture.set(wc.id, gesture);
      this.emit('open-tab', { url, isPrivate: !!tab?.isPrivate, select: true });
      return { action: 'deny' };
    });
    wc.on('enter-html-full-screen', () => this.emit('fullscreen', true, stripWWW(hostOf(wc.getURL()))));
    wc.on('leave-html-full-screen', () => this.emit('fullscreen', false));
    wc.on('found-in-page', (_e, result) => this.emit('found', tabId, result));
    wc.on('update-target-url', (_e, url) => this.emit('status', tabId, url));
    wc.on('before-input-event', (e, input) => this.emit('input', e, input));
    // Gestes de l'utilisateur (clic, touche) : seuls eux autorisent l'ouverture d'une application externe.
    wc.on('input-event', (_e, ev) => { if (GESTURE_EVENTS.has(ev?.type)) this.lastGesture.set(wc.id, Date.now()); });
    wc.on('context-menu', (_e, params) => this.contextMenu(tabId, params));
    wc.on('ipc-message', (_e, channel, data) => {
      if (channel === 'qafila:page:info') this.onPageInfo(tabId, wc, data || {});
      else if (channel === 'qafila:page:scroll') {
        const n = (v) => (Number.isFinite(Number(v)) ? Math.max(-1e7, Math.min(1e7, Number(v))) : 0);
        this.emit('scroll', tabId, { final: !!data?.final, y: n(data?.y), dy: n(data?.dy) });
      } else if (channel === 'qafila:page:edge') { if (data?.edge === 'top' || data?.edge === 'bottom') this.emit('edge', tabId, data.edge); }
      else if (channel === 'qafila:page:nav') { if (data?.dir === 'back') this.back(tabId); else if (data?.dir === 'forward') this.forward(tabId); }
    });
    wc.on('zoom-changed', (_e, dir) => this.emit('zoom', dir));
  }

  /** Page d'erreur locale dans la langue de l'interface. */
  showError(wc, message, url) {
    const t = this.t();
    const html = scripts.errorPage({ title: t('error_page_title'), message, url, lang: t.lang, rtl: t.rtl, dark: this.isDark() });
    // Origine opaque (data: sans baseURLForDataURL) : la page d'erreur n'hérite jamais des droits du site.
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
  }

  /** Un clic ou une touche dans la page il y a moins de GESTURE_WINDOW_MS. */
  recentGesture(wc) { return Date.now() - (this.lastGesture.get(wc.id) || 0) <= GESTURE_WINDOW_MS; }

  /**
   * Téléchargement lancé par une page (règle de Chrome) : un geste de l'utilisateur (clic, touche) permet un
   * téléchargement, et le premier téléchargement automatique passe aussi. Au-delà, il faut demander (une fois par
   * site). Le compteur appartient à l'onglet : seule une nouvelle page ouverte par l'utilisateur le remet à zéro
   * (did-navigate). Renvoie { ask: false } ou { ask: true, host }.
   */
  downloadVerdict(wc) {
    if (!wc || wc.isDestroyed?.()) return { ask: false };
    const now = Date.now();
    const st = this.downloadState.get(wc.id) || { used: false, at: 0 };
    const gesture = this.lastGesture.get(wc.id) || 0;
    if (gesture > st.at || !st.used) { this.downloadState.set(wc.id, { used: true, at: now }); return { ask: false }; }
    let host = '';
    try { host = new URL(wc.getURL()).host; } catch { host = ''; }
    return { ask: true, host: host || String(wc.getURL()).slice(0, 80) };
  }

  onPageInfo(tabId, wc, info) {
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!tab) return;
    // Pages locales (démo hors ligne, lecteur, erreur) : le temps de lecture de l'onglet est conservé.
    const patch = {};
    if (!this.isLocal(wc.getURL())) {
      patch.readingMinutes = Math.max(0, Number(info.minutes) || 0);
      // Seule une couleur « #rrggbb » est retenue (la barre Auto ne lit que ce format).
      if (HEX_COLOR.test(String(info.color || ''))) patch.themeColorHex = String(info.color).toLowerCase();
      const icon = safeFaviconURL(info.icon);
      if (icon && !tab.isPrivate && !tab.faviconURL) patch.faviconURL = icon;
    }
    this.store.updateTab(tabId, patch);
    this.emit('change', tabId);
    this.emit('glass', tabId);
  }

  /** Les pages locales (data:, about:, lecteur, erreur) ne remplacent jamais l'adresse de l'onglet. */
  isLocal(url) { return !url || /^(data|about|blob|chrome-error|chrome|devtools):/.test(url); }

  trackURL(tabId, url) {
    if (this.isLocal(url)) return;
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!tab) return;
    const patch = { url, lastVisited: Date.now() };
    if (tab.url && hostOf(tab.url) !== hostOf(url)) { patch.faviconURL = null; patch.themeColorHex = null; patch.readingMinutes = 0; }
    this.store.updateTab(tabId, patch);
    this.readerActive.delete(tabId);
    this.emit('change', tabId);
  }

  /**
   * Ouvre mailto: / tel: dans l'application du système, uniquement juste après un geste de l'utilisateur dans la page
   * (un geste = une demande au plus), avec une confirmation native comme Chrome, et une seule demande à la fois par page.
   * Tout autre schéma (magnet:, facetime:, sms:…) est ignoré.
   */
  async openExternal(url, wc) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (!EXTERNAL_SCHEMES.has(u.protocol) || !wc || wc.isDestroyed()) return false;
    const last = this.lastGesture.get(wc.id) || 0;
    if (Date.now() - last > GESTURE_WINDOW_MS) return false;
    this.lastGesture.delete(wc.id);
    if (this.externalPrompt.has(wc.id)) return false;
    this.externalPrompt.add(wc.id);
    try {
      const t = this.t();
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'question', buttons: [t('external_open'), t('cancel')], defaultId: 0, cancelId: 1, noLink: true,
        message: t(u.protocol === 'tel:' ? 'external_open_tel' : 'external_open_mail'), detail: u.href.slice(0, 300),
      });
      if (response !== 0) return false;
      await shell.openExternal(u.href);
      return true;
    } catch { return false; } finally { this.externalPrompt.delete(wc.id); }
  }

  /** Menu contextuel des pages : lien (nouvel onglet, onglet privé, copier, enregistrer), image (copier, enregistrer,
   * adresse), édition, sélection (copier, rechercher), navigation (précédent, suivant, actualiser) et « Inspecter ». */
  contextMenu(tabId, params) {
    const wc = this.contents(tabId);
    if (!wc) return;
    const t = this.t();
    const tab = this.store.tabs.find((x) => x.id === tabId);
    const items = [];
    const sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
    const web = (u) => /^https?:/i.test(u || '');
    if (params.linkURL && web(params.linkURL)) {
      items.push({ label: t('open_in_new_tab'), click: () => this.emit('open-tab', { url: params.linkURL, isPrivate: !!tab?.isPrivate, select: false }) });
      items.push({ label: t('open_in_private_tab'), click: () => this.emit('open-tab', { url: params.linkURL, isPrivate: true, select: true }) });
      items.push({ label: t('action_copy_link'), click: () => copyText(params.linkURL) });
      items.push({ label: t('save_link_as'), click: () => { this.lastGesture.set(wc.id, Date.now()); wc.downloadURL(params.linkURL); } });
      sep();
    } else if (params.linkURL) {
      items.push({ label: t('action_copy_link'), click: () => copyText(params.linkURL) });
      sep();
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push({ label: t('copy_image'), click: () => wc.copyImageAt(params.x, params.y) });
      items.push({ label: t('save_image_as'), click: () => { this.lastGesture.set(wc.id, Date.now()); wc.downloadURL(params.srcURL); } });
      items.push({ label: t('copy_image_address'), click: () => copyText(params.srcURL) });
      sep();
    }
    if (params.isEditable) {
      const f = params.editFlags || {};
      items.push({ label: t('ctx_cut'), enabled: !!f.canCut, click: () => wc.cut() });
      items.push({ label: t('ctx_copy'), enabled: !!f.canCopy, click: () => wc.copy() });
      items.push({ label: t('ctx_paste'), enabled: !!f.canPaste, click: () => wc.paste() });
      items.push({ label: t('ctx_select_all'), click: () => wc.selectAll() });
      sep();
    } else if (params.selectionText && params.selectionText.trim()) {
      const text = params.selectionText.trim().replace(/\s+/g, ' ');
      const short = text.length > 28 ? text.slice(0, 27) + '…' : text;
      items.push({ label: t('ctx_copy'), click: () => wc.copy() });
      items.push({ label: t('search_selection', short), click: () => this.emit('open-tab', { url: search.searchURL(text, this.store.settings), isPrivate: !!tab?.isPrivate, select: true }) });
      sep();
    }
    if (!params.linkURL && params.mediaType === 'none' && !params.isEditable && !params.selectionText) {
      items.push({ label: t('action_back'), enabled: wc.navigationHistory.canGoBack(), click: () => this.back(tabId) });
      items.push({ label: t('action_forward'), enabled: wc.navigationHistory.canGoForward(), click: () => this.forward(tabId) });
      items.push({ label: t('action_reload'), click: () => this.reload(tabId) });
      sep();
    }
    items.push({ label: t('inspect'), click: () => { wc.inspectElement(params.x, params.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus(); } });
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ----- Navigation -----
  load(tabId, url) { this.ensure(tabId); this.open(tabId, url); }
  back(tabId) { const wc = this.contents(tabId); if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
  forward(tabId) { const wc = this.contents(tabId); if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
  reload(tabId) {
    const wc = this.contents(tabId);
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!wc || !tab) return;
    if (this.isLocal(wc.getURL()) && !this.readerActive.has(tabId)) this.open(tabId, tab.url); else wc.reload();
  }
  stop(tabId) { this.contents(tabId)?.stop(); }
  isLoading(tabId) { return !!this.live.get(tabId)?.loading; }

  scrollTo(tabId, where) {
    const js = where === 'top' ? "window.scrollTo({top:0,behavior:'smooth'})" : "window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})";
    this.contents(tabId)?.executeJavaScript(js, true).catch(() => {});
  }

  findInPage(tabId, text, opts = {}) {
    const wc = this.contents(tabId);
    if (!wc || !text) return 0;
    return wc.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase });
  }
  stopFind(tabId, action = 'clearSelection') { this.contents(tabId)?.stopFindInPage(action); }

  async snapshot(tabId, width) {
    const wc = this.contents(tabId);
    if (!wc || wc.isDestroyed()) return null;
    try {
      let img = await wc.capturePage();
      if (img.isEmpty()) return null;
      if (width && img.getSize().width > width) img = img.resize({ width: Math.round(width) });
      return img.toDataURL();
    } catch { return null; }
  }

  // ----- Lecteur, assombrissement, user agent, zoom, JavaScript -----
  async toggleReader(tabId) {
    const wc = this.contents(tabId);
    if (!wc) return false;
    if (this.readerActive.has(tabId)) { this.readerActive.delete(tabId); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); else this.reload(tabId); return false; }
    // Extraction dans un monde isolé : la page ne peut pas détourner JSON ni les prototypes du DOM de l'extracteur.
    let json = null;
    try { json = await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code: scripts.reader }], true); } catch { json = null; }
    if (typeof json !== 'string' || json.length > 20_000_000) return false;
    let obj;
    try { obj = JSON.parse(json); } catch { return false; }
    if (!obj || typeof obj !== 'object') return false;
    // Le domaine affiché vient du processus principal (adresse de l'onglet), jamais de la page.
    const tab = this.store.tabs.find((x) => x.id === tabId);
    const html = scripts.readerPage({
      title: String(obj.title || '').slice(0, 500), byline: String(obj.byline || '').slice(0, 300),
      tree: obj.tree, host: stripWWW(hostOf(tab?.url || wc.getURL())), lang: obj.lang,
    }, this.isDark());
    this.readerActive.add(tabId);
    // Origine opaque : pas de baseURLForDataURL (sinon la page du lecteur prendrait l'origine, les cookies et le
    // stockage du site). Les adresses de l'article sont déjà absolues.
    await wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    this.emit('change', tabId);
    return true;
  }

  /** Assombrir : réglage global (éventuellement limité au mode sombre), inversé par site via les exceptions. */
  darkenByDefault() { const s = this.store.settings; return s.darkenSites && (!s.darkenOnlyInDarkMode || this.isDark()); }
  isDarkened(tab) { const h = hostOf(tab?.url || ''); if (!h) return false; return this.darkenByDefault() !== (this.store.settings.darkenHosts || []).includes(h); }
  applyDarken(tabId) {
    const wc = this.contents(tabId);
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!wc || !tab || this.isLocal(wc.getURL())) return;
    const on = this.isDarkened(tab);
    const js = `(function(){var id='qafila-darken';var el=document.getElementById(id);if(${on}){if(!el){el=document.createElement('style');el.id=id;el.textContent=${JSON.stringify(scripts.darkenCSS)};(document.head||document.documentElement).appendChild(el);}}else if(el){el.remove();}})();`;
    wc.executeJavaScript(js, true).catch(() => {});
  }
  refreshDarken() { for (const id of this.views.keys()) this.applyDarken(id); }

  isDesktop(tab) { const s = this.store.settings; const h = hostOf(tab?.url || ''); return s.desktopByDefault !== (!!h && (s.desktopHosts || []).includes(h)); }
  applyUserAgent(tabId) {
    const wc = this.contents(tabId);
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!wc || !tab) return;
    const s = this.store.settings;
    const ua = s.customUserAgent ? s.customUserAgent : (this.isDesktop(tab) ? this.userAgent : MOBILE_UA);
    if (wc.getUserAgent() !== ua) wc.setUserAgent(ua);
  }
  applyUserAgentToOpenTabs() { for (const id of this.views.keys()) this.applyUserAgent(id); }

  /** Réglage JavaScript changé : les pages web ouvertes sont rechargées (le nouvel en-tête s'applique au rechargement). */
  reloadForJavaScript() {
    for (const [id, v] of this.views) {
      const wc = v.webContents;
      if (!wc.isDestroyed() && /^https?:/.test(wc.getURL())) { this.readerActive.delete(id); wc.reload(); }
    }
  }

  isJavaScriptEnabled(url) { const s = this.store.settings; if (!s.javascriptEnabled) return false; const h = hostOf(url || ''); return !h || !(s.javascriptDisabledHosts || []).includes(h); }

  zoomFactor() { return Math.min(1.5, Math.max(0.8, (Number(this.store.settings.textZoom) || 100) / 100)); }
  applyZoom() { const z = this.zoomFactor(); for (const v of this.views.values()) { try { v.webContents.setZoomFactor(z); } catch { /* ignoré */ } } }

  /** Thème changé : fond des vues, pages locales (démarrage) rechargées, assombrissement réévalué. */
  onThemeChanged() {
    const bg = this.isDark() ? '#000000' : '#ffffff';
    for (const [id, v] of this.views) {
      v.setBackgroundColor(bg);
      const tab = this.store.tabs.find((x) => x.id === id);
      if (tab && !tab.url && !this.readerActive.has(id)) this.loadStartPage(v.webContents);
      // Démo hors ligne : l'article local suit le thème comme le ferait un site (prefers-color-scheme).
      else if (tab && this.offline && /^https?:/.test(tab.url || '') && !this.readerActive.has(id)) this.open(id, tab.url, { initial: true });
    }
    this.refreshDarken();
  }

  /** Les favoris changent : les pages de démarrage ouvertes les reflètent. */
  refreshStartPages() {
    for (const [id, v] of this.views) { const tab = this.store.tabs.find((x) => x.id === id); if (tab && !tab.url) this.loadStartPage(v.webContents); }
  }

  translate(tabId) {
    const tab = this.store.tabs.find((x) => x.id === tabId);
    if (!tab?.url || !/^https?:/.test(tab.url)) return;
    const lang = this.store.settings.translateLanguage || 'fr';
    this.load(tabId, `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(lang)}&u=${encodeURIComponent(tab.url)}`);
  }

  /** Informations vivantes d'un onglet pour le chrome. */
  liveState(tabId) {
    const l = this.live.get(tabId) || { loading: false, progress: 0, canGoBack: false, canGoForward: false, blocked: 0 };
    return { ...l, reader: this.readerActive.has(tabId), alive: this.views.has(tabId) };
  }

  /** Pour le bloqueur : adresse de la page d'un webContents (première partie). */
  pageURLFor(wcId) {
    for (const v of this.views.values()) if (v.webContents.id === wcId) return v.webContents.getURL();
    return null;
  }

  clearData() {
    return Promise.all([
      this.persistent.clearStorageData(), this.persistent.clearCache(), this.persistent.clearAuthCache(), this.persistent.clearHostResolverCache(),
    ]).catch(() => {});
  }
}

module.exports = { copyText, TabManager, desktopUserAgent, MOBILE_UA, hostOf, stripWWW };
