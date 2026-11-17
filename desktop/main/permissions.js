'use strict';
// Autorisations des sites, comme dans Chrome : caméra, micro, position, notifications, presse-papiers, partage
// d'écran… Le site demande, Qafila pose la question (« Autoriser » / « Bloquer ») et peut mémoriser la réponse pour ce
// site (Réglages › Confidentialité › Autorisations des sites). En navigation privée, rien n'est écrit sur le disque :
// les réponses ne valent que pour la session privée. Aucune autorisation n'est accordée en silence, sauf celles qui
// n'exposent ni l'appareil ni l'utilisateur (plein écran, verrouillage du pointeur, écriture filtrée du presse-papiers).
const { dialog, desktopCapturer } = require('electron');

const SILENT = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock']);
// Permission Electron → clé mémorisée (et libellé i18n `perm_<clé>`).
const KEYS = {
  geolocation: 'geolocation',
  notifications: 'notifications',
  'clipboard-read': 'clipboard-read',
  midi: 'midi',
  'storage-access': 'storage-access',
  'top-level-storage-access': 'storage-access',
  'window-management': 'window-management',
  'idle-detection': 'idle-detection',
  'speaker-selection': 'speaker-selection',
};

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }

class SitePermissions {
  /**
   * @param {{ store: import('./store').Store, win: () => Electron.BrowserWindow, t: () => Function }} o
   */
  constructor({ store, win, t }) {
    this.store = store;
    this.win = win;
    this.t = t;
    this.privateAnswers = new Map(); // hôte → { clé: allow | block } (session privée, en mémoire)
    this.queue = Promise.resolve();   // une seule question à la fois
  }

  /** Clés concernées par une demande (caméra et / ou micro pour « media »). */
  keysFor(permission, details = {}) {
    if (permission === 'media') {
      const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : []);
      const keys = [];
      if (types.includes('video')) keys.push('camera');
      if (types.includes('audio')) keys.push('microphone');
      return keys;
    }
    return KEYS[permission] ? [KEYS[permission]] : null;
  }

  answers(host, isPrivate) {
    return (isPrivate ? this.privateAnswers.get(host) : this.store.sitePermissions[host]) || {};
  }

  remember(host, keys, value, isPrivate) {
    if (isPrivate) this.privateAnswers.set(host, { ...(this.privateAnswers.get(host) || {}), ...Object.fromEntries(keys.map((k) => [k, value])) });
    else for (const k of keys) this.store.setSitePermission(host, k, value);
  }

  /** Vérification silencieuse (navigator.permissions.query, Notification.permission…) : vrai seulement si autorisé. */
  check(permission, requestingOrigin, details, isPrivate) {
    if (SILENT.has(permission)) return true;
    const keys = this.keysFor(permission, details);
    const host = hostOf(requestingOrigin || details?.requestingUrl || '');
    if (!keys || !keys.length || !host) return false;
    const a = this.answers(host, isPrivate);
    return keys.every((k) => a[k] === 'allow');
  }

  /** Demande d'un site : réponse mémorisée, sinon question posée à l'utilisateur. */
  request(wc, permission, details, isPrivate) {
    if (SILENT.has(permission)) return Promise.resolve(true);
    const keys = this.keysFor(permission, details);
    const host = hostOf(details?.requestingUrl || (wc && !wc.isDestroyed() ? wc.getURL() : ''));
    if (!keys || !keys.length || !host) return Promise.resolve(false);
    const a = this.answers(host, isPrivate);
    if (keys.some((k) => a[k] === 'block')) return Promise.resolve(false);
    if (keys.every((k) => a[k] === 'allow')) return Promise.resolve(true);
    return this.ask(host, keys, isPrivate);
  }

  ask(host, keys, isPrivate) {
    const run = async () => {
      const t = this.t();
      const what = keys.map((k) => t('perm_' + k)).join(t('perm_and'));
      const win = this.win();
      try {
        const { response, checkboxChecked } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
          type: 'question',
          title: 'Qafila',
          message: t('perm_prompt', host, what),
          detail: isPrivate ? t('perm_detail_private') : t('perm_detail'),
          buttons: [t('perm_allow'), t('perm_block')],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          checkboxLabel: t('perm_remember'),
          checkboxChecked: true,
        });
        const value = response === 0 ? 'allow' : 'block';
        if (checkboxChecked) this.remember(host, keys, value, isPrivate);
        return value === 'allow';
      } catch { return false; }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * Partage d'écran (getDisplayMedia) : choix de l'écran ou d'une fenêtre dans une boîte de dialogue, après
   * l'autorisation du site. Son de l'ordinateur partagé sous Windows quand le site le demande.
   */
  async displayMedia(request, callback, isPrivate) {
    const host = hostOf(request?.securityOrigin || request?.frame?.url || '');
    const deny = () => { try { callback({}); } catch { /* déjà répondu */ } };
    if (!host) return deny();
    const a = this.answers(host, isPrivate);
    if (a.screen === 'block') return deny();
    let sources = [];
    try { sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }); } catch { return deny(); }
    const t = this.t();
    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    const windows = sources.filter((s) => s.id.startsWith('window:') && s.name && !/^Qafila$/i.test(s.name)).slice(0, 6);
    const choices = [
      ...screens.map((s, i) => ({ label: screens.length > 1 ? t('perm_screen_n', i + 1) : t('perm_screen_whole'), source: s })),
      ...windows.map((s) => ({ label: s.name.length > 60 ? s.name.slice(0, 59) + '…' : s.name, source: s })),
    ];
    if (!choices.length) return deny();
    const win = this.win();
    const run = async () => {
      const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
        type: 'question',
        title: 'Qafila',
        message: t('perm_screen_prompt', host),
        buttons: [...choices.map((c) => c.label), t('cancel')],
        cancelId: choices.length,
        defaultId: 0,
        noLink: false,
      });
      return response;
    };
    let response;
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    try { response = await p; } catch { return deny(); }
    const choice = choices[response];
    if (!choice) return deny();
    const answer = { video: choice.source };
    if (request.audioRequested && process.platform === 'win32') answer.audio = 'loopback';
    try { callback(answer); } catch { /* demande expirée */ }
  }
}

module.exports = { SitePermissions, SILENT };
