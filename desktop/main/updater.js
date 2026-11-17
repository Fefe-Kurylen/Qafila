'use strict';
// Mises à jour de Qafila pour PC (electron-updater). Deux canaux, choisis d'après le numéro de version :
//  - stable (« 0.9.1 ») : releases GitHub « vX.Y.Z » de Fefe-Kurylen/Qafila ;
//  - test (« 0.9.1-test.12 », versions construites à chaque envoi sur main) : la release « test », qui contient aussi
//    latest.yml / latest-linux.yml / latest-mac.yml. Une version de test se met donc à jour toute seule vers la
//    suivante, sans réinstallation ; une version stable ne reçoit jamais de version de test. Windows et Linux (AppImage) : recherche au démarrage puis toutes les 6 heures, téléchargement en
// arrière-plan, puis le bouton « Mettre à jour » apparaît dans la barre ; un clic redémarre sur la nouvelle version.
// Sans clic, la version téléchargée s'installe à la fermeture. macOS (application non signée, que Squirrel.Mac refuse
// d'installer) : seule la recherche se fait, le bouton ouvre la page de téléchargement dans le navigateur du système.
// Seul GitHub est contacté ; aucune donnée personnelle n'est envoyée.
const { app, shell } = require('electron');

const OWNER = 'Fefe-Kurylen';
const REPO = 'Qafila';
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const TEST_RELEASE_URL = `https://github.com/${OWNER}/${REPO}/releases/tag/test`;
const TEST_FEED = `https://github.com/${OWNER}/${REPO}/releases/download/test/`;

/** Canal de mise à jour d'après le numéro de version : « 0.9.1-test.12 » → test, sinon stable. */
function channelOf(version) {
  return /^\d+\.\d+\.\d+-test\.\d+$/.test(String(version || '')) ? 'test' : 'stable';
}
const FIRST_CHECK_MS = 12_000;
const PERIOD_MS = 6 * 60 * 60 * 1000;

/**
 * Flux de test local (QAFILA_UPDATE_URL) : uniquement http://127.0.0.1 ou http://localhost, jamais une adresse
 * distante (une variable d'environnement ne doit pas pouvoir détourner les mises à jour vers un autre serveur).
 */
function localTestFeed() {
  const raw = process.env.QAFILA_UPDATE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

class Updater {
  /**
   * @param {{ onChange: () => void, isAutomatic: () => boolean, demo?: boolean }} opts
   */
  constructor({ onChange, isAutomatic, demo = false }) {
    this.onChange = onChange;
    this.isAutomatic = isAutomatic;
    this.testFeed = localTestFeed();
    this.manual = process.platform === 'darwin';
    this.channel = channelOf(app.getVersion());
    const linuxOK = process.platform !== 'linux' || !!process.env.APPIMAGE || !!this.testFeed;
    this.supported = !demo && (app.isPackaged || !!this.testFeed) && linuxOK && ['win32', 'darwin', 'linux'].includes(process.platform);
    /** status : disabled | idle | checking | none | available | downloading | ready | error */
    this.state = { status: this.supported ? 'idle' : 'disabled', version: null, percent: null, manual: this.manual, channel: this.channel };
    this.au = null;
    this.timer = null;
    this.interval = null;
    this.pending = null;
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }

  /** Charge electron-updater au premier usage (rien n'est chargé si les mises à jour ne sont pas prises en charge). */
  updater() {
    if (this.au || !this.supported) return this.au;
    const { autoUpdater } = require('electron-updater');
    const au = autoUpdater;
    au.logger = null;
    au.allowPrerelease = this.channel === 'test';
    au.allowDowngrade = false;
    au.autoDownload = !this.manual;
    au.autoInstallOnAppQuit = !this.manual;
    au.fullChangelog = false;
    if (this.testFeed) {
      au.forceDevUpdateConfig = true;
      au.setFeedURL({ provider: 'generic', url: this.testFeed });
    } else if (this.channel === 'test') {
      au.setFeedURL({ provider: 'generic', url: TEST_FEED });
    }
    au.on('checking-for-update', () => { if (!['downloading', 'ready'].includes(this.state.status)) this.set({ status: 'checking' }); });
    au.on('update-not-available', () => this.set({ status: 'none', version: null, percent: null }));
    au.on('update-available', (info) => this.set({ status: this.manual ? 'available' : 'downloading', version: info?.version || null, percent: this.manual ? null : 0 }));
    au.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p?.percent || 0))) }));
    au.on('update-downloaded', (info) => this.set({ status: 'ready', version: info?.version || this.state.version, percent: 100 }));
    // Une erreur réseau après le téléchargement ne retire pas le bouton : la version prête reste installable.
    au.on('error', () => { if (this.state.status !== 'ready') this.set({ status: 'error', percent: null }); });
    this.au = au;
    return au;
  }

  /** Démarre les recherches automatiques (si le réglage « Mises à jour automatiques » est actif). */
  start() {
    if (!this.supported) return;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    this.timer = setTimeout(() => { if (this.isAutomatic()) this.check(); }, FIRST_CHECK_MS);
    this.interval = setInterval(() => { if (this.isAutomatic()) this.check(); }, PERIOD_MS);
  }

  /** Recherche une mise à jour ; renvoie l'état final (bouton « Rechercher les mises à jour » des réglages). */
  async check() {
    if (!this.supported) return this.state;
    if (['downloading', 'ready'].includes(this.state.status)) return this.state;
    if (this.pending) return this.pending;
    const au = this.updater();
    this.pending = (async () => {
      try { await au.checkForUpdates(); } catch { if (this.state.status !== 'ready') this.set({ status: 'error', percent: null }); }
      // Avec le téléchargement automatique, checkForUpdates rend la main avant la fin du téléchargement : l'état
      // « downloading » puis « ready » arrivera par les événements.
      return this.state;
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }

  /** Bouton « Mettre à jour » : redémarre sur la version téléchargée (macOS : ouvre la page de téléchargement). */
  async install() {
    if (this.state.status === 'ready' && this.au) {
      // isSilent (pas d'assistant d'installation), isForceRunAfter (Qafila se relance tout seul).
      setImmediate(() => { try { this.au.quitAndInstall(true, true); } catch { this.set({ status: 'error' }); } });
      return true;
    }
    if (this.manual && this.state.status === 'available') {
      const url = this.channel === 'test' ? TEST_RELEASE_URL : RELEASES_URL;
      try { await shell.openExternal(url, { activate: true }); return true; } catch { return false; }
    }
    return false;
  }

  stop() { clearTimeout(this.timer); clearInterval(this.interval); }
}

module.exports = { Updater, RELEASES_URL, TEST_FEED, channelOf, localTestFeed };
