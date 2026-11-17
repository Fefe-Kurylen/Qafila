'use strict';
// Pont typé entre le chrome (desktop/renderer) et le processus principal : window.qafila.*.
// contextIsolation activé, nodeIntegration désactivé ; chaque canal est validé côté main (main/ipc.js).
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(`qafila:${channel}`, payload);
const on = (channel, handler) => {
  const listener = (_e, data) => handler(data);
  ipcRenderer.on(`qafila:${channel}`, listener);
  return () => ipcRenderer.removeListener(`qafila:${channel}`, listener);
};

contextBridge.exposeInMainWorld('qafila', {
  /** Onglets : liste, création, fermeture, sélection, navigation. `id` absent = onglet courant. */
  tabs: {
    list: () => invoke('tabs:list'),
    create: (opts = {}) => invoke('tabs:create', opts),
    close: (id) => invoke('tabs:close', { id }),
    closeAll: (opts = {}) => invoke('tabs:closeAll', opts),
    reopen: () => invoke('tabs:reopen'),
    select: (id) => invoke('tabs:select', { id }),
    navigate: (text, id) => invoke('tabs:navigate', { text, id }),
    back: (id) => invoke('tabs:back', { id }),
    forward: (id) => invoke('tabs:forward', { id }),
    reload: (id) => invoke('tabs:reload', { id }),
    stop: (id) => invoke('tabs:stop', { id }),
    goHome: (id) => invoke('tabs:goHome', { id }),
    snapshot: (id, width) => invoke('tabs:snapshot', { id, width }),
    move: (id, index) => invoke('tabs:move', { id, index }),
  },
  /** État complet (onglets enrichis, favoris, historique, réglages, thème) et abonnement aux mises à jour poussées. */
  state: {
    get: () => invoke('state:get'),
    onChange: (cb) => on('state', cb),
  },
  bookmarks: {
    list: () => invoke('bookmarks:list'),
    add: (title, url) => invoke('bookmarks:add', { title, url }),
    remove: (idOrUrl) => invoke('bookmarks:remove', { id: idOrUrl }),
    update: (id, patch) => invoke('bookmarks:update', { id, patch }),
    toggleCurrent: () => invoke('bookmarks:toggleCurrent'),
  },
  history: {
    list: (opts = {}) => invoke('history:list', opts),
    remove: (id) => invoke('history:remove', { id }),
    clear: () => invoke('history:clear'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (key, value) => invoke('settings:set', { key, value }),
    reset: (key) => invoke('settings:reset', { key }),
    schema: () => invoke('settings:schema'),
    applyPreset: (id) => invoke('settings:applyPreset', { id }),
  },
  /** Actions sur la page courante. */
  page: {
    find: (text, opts = {}) => invoke('page:find', { text, ...opts }),
    stopFind: (action = 'clearSelection') => invoke('page:stopFind', { action }),
    onFound: (cb) => on('found', cb),
    toggleReader: () => invoke('page:toggleReader'),
    toggleDarken: () => invoke('page:toggleDarken'),
    toggleDesktop: () => invoke('page:toggleDesktop'),
    toggleBlocker: () => invoke('page:toggleBlocker'),
    toggleJavascript: () => invoke('page:toggleJavascript'),
    translate: () => invoke('page:translate'),
    scrollTo: (where) => invoke('page:scrollTo', { where }),
    zoom: (delta) => invoke('page:zoom', { delta }),
    copyLink: () => invoke('page:copyLink'),
    share: () => invoke('page:share'),
    onStatus: (cb) => on('status', cb),
  },
  data: {
    clear: () => invoke('data:clear'),
  },
  /** Suggestions pour la saisie d'adresse : favoris + historique + moteur. */
  suggest: (query) => invoke('suggest', { query }),
  /** Contrat partagé, chaînes et informations de l'application (version, moteur, langue). */
  config: () => invoke('config'),
  openExternal: (url) => invoke('openExternal', { url }),
  /** Téléchargements : dossier (dialogue natif), retour au dossier du système, ouverture du dossier. */
  downloads: {
    chooseFolder: () => invoke('downloads:chooseFolder'),
    resetFolder: () => invoke('downloads:resetFolder'),
    openFolder: () => invoke('downloads:openFolder'),
  },
  /** Soutenir Qafila : { configured } puis ouverture du lien Stripe dans le navigateur du système. */
  support: {
    info: () => invoke('support:info'),
    open: () => invoke('support:open'),
  },
  /** Mises à jour : recherche manuelle (renvoie l'état) et installation de la version téléchargée (redémarrage). */
  update: {
    check: () => invoke('update:check'),
    install: () => invoke('update:install'),
  },
  /** Le chrome déclare sa géométrie : bande ('strip', hauteur de barre) ou plein écran ('full'). */
  ui: {
    setChrome: (mode, height, find = false) => invoke('ui:setChrome', { mode, height, find: !!find }),
    /** Focus clavier natif : 'chrome' ou 'page'. */
    focus: (target) => invoke('ui:focus', { target }),
    /** Réduire : rouvre la barre depuis la mini-adresse. */
    expand: () => invoke('ui:expand'),
    onCommand: (cb) => on('command', cb),
    onTheme: (cb) => on('theme', cb),
    close: () => invoke('ui:window', { action: 'close' }),
    minimize: () => invoke('ui:window', { action: 'minimize' }),
    maximize: () => invoke('ui:window', { action: 'maximize' }),
  },
  /** Faux verre : captures floutées de la page sous la barre. */
  glass: {
    onFrame: (cb) => on('glass', cb),
  },
  /** Tests : composition d'une capture (page + chrome) et dépôt d'un fichier PNG. */
  test: {
    onComposite: (cb) => on('test:composite', cb),
    composited: (id, dataURL) => ipcRenderer.send('qafila:test:composited', { id, dataURL }),
    screenshot: (name) => invoke('test:screenshot', { name }),
  },
});
