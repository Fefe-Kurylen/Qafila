'use strict';
// Importer et exporter (Réglages › Importer et exporter) : favoris des autres navigateurs installés sur l'ordinateur
// (Chrome, Edge, Brave, Vivaldi, Opera, Firefox), fichier de favoris HTML de n'importe quel navigateur, sauvegarde
// Qafila (réglages + favoris) ; export des favoris en HTML (lisible par tous les navigateurs) et de la sauvegarde.
// Tout se passe sur l'ordinateur : rien n'est envoyé. Les favoris déjà présents ne sont jamais ajoutés en double ;
// le dernier import peut être annulé. Mots de passe : CSV de Chrome / Edge / Brave / Firefox vers le coffre chiffré
// (main/vault.js), export CSV derrière le mot de passe principal.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, dialog, shell } = require('electron');
const settingsSchema = require('./settings');

const MAX_IMPORT = 20000;                 // favoris par import
const MAX_FILE = 50 * 1024 * 1024;        // 50 Mio (comme shared/IMPORT.md)
const BACKUP_FORMAT = 'qafila-settings';
// Réglages jamais repris d'une sauvegarde : propres à cet ordinateur ou à cette installation.
const BACKUP_SKIP = new Set(['downloadFolder', 'searchDefaultGoogle']);

// ----- Emplacements des navigateurs -----
function browserDirs() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const mac = path.join(home, 'Library', 'Application Support');
  const cfg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const P = process.platform;
  const pick = (w, m, l) => (P === 'win32' ? w : P === 'darwin' ? m : l);
  return [
    { id: 'chrome', label: 'Google Chrome', kind: 'chromium', dir: pick(path.join(local, 'Google', 'Chrome', 'User Data'), path.join(mac, 'Google', 'Chrome'), path.join(cfg, 'google-chrome')) },
    { id: 'edge', label: 'Microsoft Edge', kind: 'chromium', dir: pick(path.join(local, 'Microsoft', 'Edge', 'User Data'), path.join(mac, 'Microsoft Edge'), path.join(cfg, 'microsoft-edge')) },
    { id: 'brave', label: 'Brave', kind: 'chromium', dir: pick(path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), path.join(mac, 'BraveSoftware', 'Brave-Browser'), path.join(cfg, 'BraveSoftware', 'Brave-Browser')) },
    { id: 'vivaldi', label: 'Vivaldi', kind: 'chromium', dir: pick(path.join(local, 'Vivaldi', 'User Data'), path.join(mac, 'Vivaldi'), path.join(cfg, 'vivaldi')) },
    { id: 'opera', label: 'Opera', kind: 'chromium', dir: pick(path.join(roaming, 'Opera Software', 'Opera Stable'), path.join(mac, 'com.operasoftware.Opera'), path.join(cfg, 'opera')) },
    { id: 'firefox', label: 'Mozilla Firefox', kind: 'firefox', dir: pick(path.join(roaming, 'Mozilla', 'Firefox', 'Profiles'), path.join(mac, 'Firefox', 'Profiles'), path.join(home, '.mozilla', 'firefox')) },
  ];
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const webURL = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length <= 8192;

// ----- Chromium : fichier « Bookmarks » (JSON) de chaque profil -----
/** date_added de Chromium : microsecondes depuis le 1er janvier 1601 → millisecondes Unix. */
function chromiumDate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round(n / 1000 - 11644473600000);
  return ms > 0 ? ms : null;
}

function chromiumFiles(dir) {
  const files = [];
  if (isFile(path.join(dir, 'Bookmarks'))) files.push(path.join(dir, 'Bookmarks')); // Opera : pas de dossier de profil
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* absent */ }
  for (const n of names) {
    if (n !== 'Default' && !/^Profile \d+$/.test(n)) continue;
    const f = path.join(dir, n, 'Bookmarks');
    if (isFile(f)) files.push(f);
  }
  return files;
}

function readChromium(dir) {
  const out = [];
  for (const file of chromiumFiles(dir)) {
    let json;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const walk = (node) => {
      if (!node || out.length >= MAX_IMPORT) return;
      if (node.type === 'url' && webURL(node.url)) out.push({ title: String(node.name || ''), url: node.url, addedAt: chromiumDate(node.date_added) });
      for (const c of Array.isArray(node.children) ? node.children : []) walk(c);
    };
    for (const k of ['bookmark_bar', 'other', 'synced']) walk(json?.roots?.[k]);
  }
  return out;
}

// ----- Firefox : dernière sauvegarde automatique des favoris (bookmarkbackups/*.jsonlz4) -----
/** Décompression d'un bloc LZ4 (format « mozLz40 » de Firefox). */
function lz4Block(src, size) {
  const dst = Buffer.alloc(size);
  let i = 0; let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255 && i < src.length); }
    if (o + lit > size) throw new Error('lz4');
    src.copy(dst, o, i, i + lit); i += lit; o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    if (!off || off > o) throw new Error('lz4');
    let len = token & 15;
    if (len === 15) { let b; do { b = src[i++]; len += b; } while (b === 255 && i < src.length); }
    len += 4;
    if (o + len > size) throw new Error('lz4');
    for (let k = 0, m = o - off; k < len; k++) dst[o++] = dst[m++];
  }
  return dst.subarray(0, o);
}

function readMozLz4(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 12 || buf.toString('latin1', 0, 8) !== 'mozLz40\0') throw new Error('mozlz4');
  const size = buf.readUInt32LE(8);
  if (size > MAX_FILE * 4) throw new Error('mozlz4');
  return lz4Block(buf.subarray(12), size).toString('utf8');
}

function firefoxBackup(dir) {
  let best = null;
  let profiles = [];
  try { profiles = fs.readdirSync(dir); } catch { return null; }
  for (const p of profiles) {
    const bk = path.join(dir, p, 'bookmarkbackups');
    let names = [];
    try { names = fs.readdirSync(bk); } catch { continue; }
    for (const n of names) {
      if (!/\.jsonlz4$/i.test(n)) continue;
      const f = path.join(bk, n);
      let m = 0;
      try { m = fs.statSync(f).mtimeMs; } catch { continue; }
      if (!best || m > best.m) best = { f, m };
    }
  }
  return best?.f || null;
}

function readFirefox(dir) {
  const file = firefoxBackup(dir);
  if (!file) return [];
  const json = JSON.parse(readMozLz4(file));
  const out = [];
  const walk = (node) => {
    if (!node || out.length >= MAX_IMPORT) return;
    if (node.type === 'text/x-moz-place' && webURL(node.uri)) out.push({ title: String(node.title || ''), url: node.uri, addedAt: node.dateAdded ? Math.round(Number(node.dateAdded) / 1000) || null : null });
    for (const c of Array.isArray(node.children) ? node.children : []) walk(c);
  };
  walk(json);
  return out;
}

function readBrowser(b) {
  return b.kind === 'firefox' ? readFirefox(b.dir) : readChromium(b.dir);
}

// ----- Fichiers -----
let parserPromise = null;
/** Analyseur de référence partagé (shared/import/parse.mjs) : resources/shared une fois empaqueté, ../shared sinon. */
function parser() {
  if (!parserPromise) {
    const dirs = [process.resourcesPath && path.join(process.resourcesPath, 'shared'), path.join(__dirname, '..', '..', 'shared')].filter(Boolean);
    const file = dirs.map((d) => path.join(d, 'import', 'parse.mjs')).find(isFile);
    parserPromise = file ? import(pathToFileURL(file).href) : Promise.reject(new Error('parse.mjs introuvable'));
  }
  return parserPromise;
}

function flattenNetscape(roots) {
  const out = [];
  const walk = (n) => {
    if (!n || out.length >= MAX_IMPORT) return;
    if (n.type === 'bookmark' && webURL(n.url)) out.push({ title: String(n.title || ''), url: n.url, addedAt: n.addedAt ?? null });
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
  };
  for (const r of roots || []) walk(r);
  return out;
}

const escHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Favoris au format HTML Netscape (shared/IMPORT.md §10.2), accepté par Chrome, Edge, Firefox et Safari. */
function bookmarksHTML(list) {
  const sec = (ms) => Math.floor((Number(ms) || Date.now()) / 1000);
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<!-- This is an automatically generated file.', '     It will be read and overwritten.', '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  for (const b of list) lines.push(`    <DT><A HREF="${escHTML(b.url)}" ADD_DATE="${sec(b.addedAt)}">${escHTML(b.title || b.url)}</A>`);
  lines.push('</DL><p>');
  return lines.join('\n') + '\n';
}

const today = () => new Date().toISOString().slice(0, 10);
/** Clé de comparaison : même adresse, au « / » final près. */
const urlKey = (u) => String(u).trim().replace(/\/+$/, '');

class Transfer {
  /**
   * @param {{ store: any, win: () => Electron.BrowserWindow, t: (k: string, ...a: any[]) => string,
   *           onChange: () => void, onSettingChanged: (k: string) => void, refresh: () => void }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.last = null; // { source, ids, at } : dernier import, annulable
    this.cache = null;
  }

  /** Navigateurs trouvés sur l'ordinateur, avec le nombre de favoris lisibles (calcul paresseux, mis en cache). */
  sources(force = false) {
    if (this.cache && !force) return this.cache;
    const list = [];
    for (const b of browserDirs()) {
      if (!isDir(b.dir) && !isFile(path.join(b.dir, 'Bookmarks'))) continue;
      let count = 0;
      try { count = readBrowser(b).length; } catch { count = 0; }
      if (count) list.push({ id: b.id, label: b.label, count });
    }
    this.cache = list;
    return list;
  }

  describe() {
    return { sources: this.cache, last: this.last ? { source: this.last.source, count: this.last.ids.length, at: this.last.at } : null };
  }

  /** Ajoute les favoris absents ; renvoie { added, already }. */
  merge(items, source) {
    const known = new Set(this.store.bookmarks.map((b) => urlKey(b.url)));
    const fresh = [];
    let already = 0;
    for (const it of items) {
      const k = urlKey(it.url);
      if (known.has(k)) { already++; continue; }
      known.add(k);
      fresh.push(it);
    }
    const added = this.store.addBookmarks(fresh);
    if (added.length) this.last = { source, ids: added.map((b) => b.id), at: Date.now() };
    this.refresh();
    this.onChange();
    return { added: added.length, already };
  }

  async report(ok, title, detail) {
    const win = this.win();
    await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, { type: ok ? 'info' : 'warning', title: 'Qafila', message: title, detail: detail || '', buttons: ['OK'], noLink: true });
  }

  async importFrom(id) {
    const b = browserDirs().find((x) => x.id === id);
    if (!b) return false;
    let items = [];
    try { items = readBrowser(b); } catch { items = []; }
    if (!items.length) { await this.report(false, this.t('transfer_none_found', b.label)); return false; }
    const r = this.merge(items, b.label);
    await this.report(true, this.t('transfer_imported', r.added, b.label), r.already ? this.t('transfer_already', r.already) : '');
    return true;
  }

  async importFile() {
    const win = this.win();
    const pick = await dialog.showOpenDialog(win, {
      title: this.t('transfer_choose_file'), defaultPath: app.getPath('downloads'), properties: ['openFile'],
      filters: [{ name: this.t('transfer_file_types'), extensions: ['html', 'htm', 'json', 'csv'] }, { name: '*', extensions: ['*'] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return false;
    const file = pick.filePaths[0];
    let text;
    try {
      if (fs.statSync(file).size > MAX_FILE) throw new Error('size');
      text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    } catch { await this.report(false, this.t('transfer_unreadable')); return false; }
    // Sauvegarde Qafila (réglages + favoris).
    if (/^\s*\{/.test(text) && text.slice(0, 65536).includes(`"${BACKUP_FORMAT}"`)) return this.importBackup(text);
    let P;
    try { P = await parser(); } catch { await this.report(false, this.t('transfer_unreadable')); return false; }
    const d = P.detect(text);
    if (d.format === 'netscape-html') {
      let parsed;
      try { parsed = P.parseNetscapeHtml(text); } catch { await this.report(false, this.t('transfer_unreadable')); return false; }
      const items = flattenNetscape(parsed.roots);
      if (!items.length) { await this.report(false, this.t('transfer_empty_file')); return false; }
      const r = this.merge(items, path.basename(file));
      await this.report(true, this.t('transfer_imported_file', r.added), r.already ? this.t('transfer_already', r.already) : '');
      return true;
    }
    if (d.format === 'chrome-csv' || d.format === 'firefox-csv') return this.importPasswords(text, P, d, file);
    if (d.format && /csv$/.test(d.format)) { await this.report(false, this.t('transfer_format_soon')); return false; }
    await this.report(false, this.t('transfer_unknown_file'), this.t('transfer_unknown_file_sub'));
    return false;
  }

  async importPasswords(text, P, d, file) {
    const st = this.vault.status().state;
    if (st === 'none') { await this.report(false, this.t('transfer_vault_needed'), this.t('transfer_vault_needed_sub')); return false; }
    if (!this.vault.ensureOpen()) { await this.report(false, this.t('transfer_vault_locked'), this.t('transfer_vault_locked_sub')); return false; }
    let parsed;
    try { parsed = d.format === 'firefox-csv' ? P.parseFirefoxCsv(text) : P.parseChromeCsv(text); } catch { await this.report(false, this.t('transfer_unreadable')); return false; }
    const label = d.format === 'firefox-csv' ? 'Firefox' : 'Chrome';
    const c = this.vault.importLogins(parsed, P.dedupeLogins, label);
    const win = this.win();
    const detail = [this.t('transfer_pw_detail', c.updated, c.duplicates), parsed.skipped?.length ? this.t('transfer_pw_skipped', parsed.skipped.length) : '', this.t('transfer_pw_delete_hint')].filter(Boolean).join('\n\n');
    const { response } = await dialog.showMessageBox(win, { type: 'info', title: 'Qafila', message: this.t('transfer_pw_imported', c.added), detail,
      buttons: [this.t('transfer_delete_csv'), this.t('transfer_keep_csv')], defaultId: 0, cancelId: 1, noLink: true });
    if (response === 0) { try { await shell.trashItem(file); } catch { /* déjà supprimé ou protégé */ } }
    return true;
  }

  async exportPasswords(passphrase) {
    if (!(await this.vault.verify(passphrase))) return { ok: false, error: 'wrong' };
    if (!this.vault.ensureOpen()) return { ok: false, error: 'locked' };
    if (!this.vault.list().length) { await this.report(false, this.t('transfer_no_passwords')); return { ok: false }; }
    const win = this.win();
    const { response } = await dialog.showMessageBox(win, { type: 'warning', title: 'Qafila', message: this.t('transfer_pw_export_warn'), detail: this.t('transfer_pw_export_warn_sub'),
      buttons: [this.t('transfer_export'), this.t('cancel')], defaultId: 1, cancelId: 1, noLink: true });
    if (response !== 0) return { ok: false };
    const file = await this.save(`Qafila - mots de passe - ${today()}.csv`, this.vault.exportCSV());
    if (file) await this.exported(file, this.t('transfer_exported_passwords'));
    return { ok: !!file };
  }

  async importBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { await this.report(false, this.t('transfer_unreadable')); return false; }
    if (data?.format !== BACKUP_FORMAT || typeof data !== 'object') { await this.report(false, this.t('transfer_unknown_file')); return false; }
    const win = this.win();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: 'Qafila', message: this.t('transfer_backup_confirm'), detail: this.t('transfer_backup_confirm_sub'),
      buttons: [this.t('transfer_backup_restore'), this.t('cancel')], defaultId: 0, cancelId: 1, noLink: true,
    });
    if (response !== 0) return false;
    let changed = 0;
    const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
    for (const [k, v] of Object.entries(s)) {
      if (BACKUP_SKIP.has(k) || settingsSchema.validate(k, v) === undefined) continue;
      if (this.store.setSetting(k, v)) { this.onSettingChanged(k); changed++; }
    }
    const items = (Array.isArray(data.bookmarks) ? data.bookmarks : []).filter((b) => b && webURL(b.url)).slice(0, MAX_IMPORT)
      .map((b) => ({ title: String(b.title || ''), url: b.url, addedAt: Number(b.addedAt) || null }));
    const r = this.merge(items, this.t('transfer_backup'));
    await this.report(true, this.t('transfer_backup_done'), this.t('transfer_backup_done_sub', r.added));
    return true;
  }

  /** Enregistre directement dans le dossier de téléchargement (réglage de Qafila, sinon Téléchargements), sans question. */
  async save(defaultName, content) {
    const dir = (this.downloadFolder && this.downloadFolder()) || app.getPath('downloads');
    const ext = path.extname(defaultName);
    const stem = defaultName.slice(0, defaultName.length - ext.length);
    let file = path.join(dir, defaultName);
    for (let i = 1; fs.existsSync(file) && i < 1000; i++) file = path.join(dir, `${stem} (${i})${ext}`);
    try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, content, { encoding: 'utf8', flag: 'wx' }); } catch { await this.report(false, this.t('transfer_write_failed')); return null; }
    return file;
  }

  async exported(file, title) {
    const win = this.win();
    const { response } = await dialog.showMessageBox(win, { type: 'info', title: 'Qafila', message: title, detail: file, buttons: ['OK', this.t('transfer_show_file')], defaultId: 0, noLink: true });
    if (response === 1) shell.showItemInFolder(file);
  }

  async exportBookmarks() {
    const list = this.store.bookmarks;
    if (!list.length) { await this.report(false, this.t('transfer_no_bookmarks')); return false; }
    const file = await this.save(`Qafila - favoris - ${today()}.html`, bookmarksHTML(list));
    if (file) await this.exported(file, this.t('transfer_exported_bookmarks', list.length));
    return !!file;
  }

  async exportBackup() {
    const settings = {};
    for (const [k, v] of Object.entries(this.store.settings)) if (!BACKUP_SKIP.has(k)) settings[k] = v;
    const data = { format: BACKUP_FORMAT, v: 1, app: 'Qafila PC', version: app.getVersion(), exportedAt: new Date().toISOString(),
      settings, bookmarks: this.store.bookmarks.map((b) => ({ title: b.title, url: b.url, addedAt: b.addedAt })) };
    const file = await this.save(`Qafila - sauvegarde - ${today()}.json`, JSON.stringify(data, null, 2) + '\n');
    if (file) await this.exported(file, this.t('transfer_exported_backup'));
    return !!file;
  }

  /** Annule le dernier import : retire les favoris qu'il avait ajoutés. */
  undo() {
    if (!this.last) return 0;
    const ids = new Set(this.last.ids);
    const n = this.store.removeBookmarks(ids);
    this.last = null;
    this.refresh();
    this.onChange();
    return n;
  }
}

module.exports = { Transfer, lz4Block, chromiumDate, bookmarksHTML, urlKey, readChromium, readFirefox };
