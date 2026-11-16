'use strict';
// État persistant : ${userData}/state.json, écrit de façon atomique (fichier temporaire + renommage), avec un délai
// de regroupement. Mêmes formes que sur mobile : tabs, selected, bookmarks {id,title,url,addedAt},
// history {id,title,url,visitedAt}, settings (clés de shared/settings-keys.json). Les onglets privés ne sont jamais écrits.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const settingsSchema = require('./settings');
const { safeFaviconURL } = require('./favicon');

const HISTORY_MAX = 2000;
const AUTO_CLOSE_MS = { never: null, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 };

class Store extends EventEmitter {
  constructor(dir, { ephemeral = false } = {}) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    this.ephemeral = ephemeral;
    this.tabs = [];
    this.selected = null;
    this.bookmarks = [];
    this.history = [];
    this.settings = settingsSchema.defaults();
    this.closedTabs = []; // pile des onglets fermés (« Rouvrir l'onglet fermé »)
    this._timer = null;
    this._dirty = false;
  }

  // ----- Chargement / sauvegarde -----
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.tabs = (Array.isArray(raw.tabs) ? raw.tabs : []).filter((t) => t && !t.isPrivate).map(normalizeTab);
      this.bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).filter((b) => b && b.url).map((b) => ({
        id: b.id || uuid(), title: String(b.title || ''), url: String(b.url), addedAt: num(b.addedAt),
      }));
      this.history = (Array.isArray(raw.history) ? raw.history : []).filter((h) => h && h.url).map((h) => ({
        id: h.id || uuid(), title: String(h.title || ''), url: String(h.url), visitedAt: num(h.visitedAt),
      })).slice(0, HISTORY_MAX);
      this.settings = settingsSchema.sanitize(raw.settings);
      // L'onglet sélectionné était privé (ou a disparu) : on reprend le dernier onglet visité.
      this.selected = this.tabs.some((t) => t.id === raw.selected) ? raw.selected
        : this.tabs.reduce((best, t) => (!best || t.lastVisited > best.lastVisited ? t : best), null)?.id ?? null;
    } catch {
      // Pas de fichier, ou illisible : on repart des défauts sans rien écraser avant la première écriture.
    }
    this.closeExpiredTabs();
  }

  snapshot() {
    return {
      version: 1,
      tabs: this.tabs.filter((t) => !t.isPrivate),
      selected: this.tabs.find((t) => t.id === this.selected && !t.isPrivate) ? this.selected : null,
      bookmarks: this.bookmarks,
      history: this.history,
      settings: this.settings,
    };
  }

  scheduleSave() {
    this._dirty = true;
    this.emit('change');
    if (this.ephemeral) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 400);
  }

  saveNow() {
    clearTimeout(this._timer);
    if (!this._dirty || this.ephemeral) return;
    this._dirty = false;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = path.join(this.dir, `.state.${process.pid}.${Date.now()}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(this.snapshot()));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('Sauvegarde de state.json impossible :', e.message);
    }
  }

  // ----- Onglets -----
  get selectedTab() { return this.tabs.find((t) => t.id === this.selected) || null; }

  addTab({ url = null, isPrivate = false, select = true, index } = {}) {
    const now = Date.now();
    const tab = { id: uuid(), url, title: '', isPrivate: !!isPrivate, createdAt: now, lastVisited: now, readingMinutes: 0, faviconURL: null, themeColorHex: null };
    if (Number.isInteger(index) && index >= 0 && index <= this.tabs.length) this.tabs.splice(index, 0, tab);
    else this.tabs.push(tab);
    if (select) this.selected = tab.id;
    this.scheduleSave();
    return tab;
  }

  updateTab(id, patch) {
    const t = this.tabs.find((x) => x.id === id);
    if (!t) return null;
    let changed = false;
    for (const [k, v] of Object.entries(patch)) if (t[k] !== v) { t[k] = v; changed = true; }
    if (changed) this.scheduleSave();
    return t;
  }

  removeTab(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const [tab] = this.tabs.splice(idx, 1);
    if (!tab.isPrivate && tab.url) { this.closedTabs.push({ ...tab, index: idx }); if (this.closedTabs.length > 20) this.closedTabs.shift(); }
    if (this.selected === id) this.selected = this.tabs[Math.min(idx, this.tabs.length - 1)]?.id ?? null;
    this.scheduleSave();
    return tab;
  }

  select(id) {
    if (!this.tabs.some((t) => t.id === id)) return;
    this.selected = id;
    this.updateTab(id, { lastVisited: Date.now() });
    this.scheduleSave();
  }

  /** Fermeture automatique des onglets inactifs (Réglages › Onglets), au lancement. */
  closeExpiredTabs() {
    const limit = AUTO_CLOSE_MS[this.settings.autoCloseTabs];
    if (!limit) return [];
    const now = Date.now();
    const expired = this.tabs.filter((t) => t.id !== this.selected && now - t.lastVisited > limit);
    if (expired.length) { this.tabs = this.tabs.filter((t) => !expired.includes(t)); this.scheduleSave(); }
    return expired;
  }

  // ----- Favoris & historique -----
  isBookmarked(url) { return !!url && this.bookmarks.some((b) => b.url === url); }

  addBookmark(title, url) {
    if (!url || this.isBookmarked(url)) return null;
    const b = { id: uuid(), title: String(title || url), url, addedAt: Date.now() };
    this.bookmarks.unshift(b);
    this.scheduleSave();
    return b;
  }

  removeBookmark(idOrUrl) {
    const n = this.bookmarks.length;
    this.bookmarks = this.bookmarks.filter((b) => b.id !== idOrUrl && b.url !== idOrUrl);
    if (this.bookmarks.length !== n) this.scheduleSave();
  }

  updateBookmark(id, patch) {
    const b = this.bookmarks.find((x) => x.id === id);
    if (!b) return;
    if (typeof patch.title === 'string') b.title = patch.title;
    if (typeof patch.url === 'string' && patch.url) b.url = patch.url;
    this.scheduleSave();
  }

  recordVisit(tab) {
    if (!tab || tab.isPrivate || !tab.url || !/^https?:/.test(tab.url)) return;
    const title = tab.title || tab.url;
    if (this.history[0] && this.history[0].url === tab.url) { this.history[0].title = title; this.scheduleSave(); return; }
    this.history.unshift({ id: uuid(), title, url: tab.url, visitedAt: Date.now() });
    if (this.history.length > HISTORY_MAX) this.history.length = HISTORY_MAX;
    this.scheduleSave();
  }

  removeHistory(id) { this.history = this.history.filter((h) => h.id !== id); this.scheduleSave(); }
  clearHistory() { this.history = []; this.scheduleSave(); }

  // ----- Réglages -----
  setSetting(key, value) {
    const v = settingsSchema.validate(key, value);
    if (v === undefined) return false;
    if (JSON.stringify(this.settings[key]) === JSON.stringify(v)) return true;
    this.settings[key] = v;
    this.scheduleSave();
    this.emit('setting', key, v);
    return true;
  }

  /** Ajoute/retire un hôte d'un ensemble (blockerDisabledHosts, darkenHosts…) ; renvoie l'état final. */
  toggleHost(key, host) {
    const set = new Set(this.settings[key] || []);
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    if (set.has(h)) set.delete(h); else set.add(h);
    this.setSetting(key, [...set]);
    return set.has(h);
  }
}

function normalizeTab(t) {
  return {
    id: t.id || uuid(), url: t.url || null, title: String(t.title || ''), isPrivate: false,
    createdAt: num(t.createdAt), lastVisited: num(t.lastVisited), readingMinutes: Number(t.readingMinutes) || 0,
    faviconURL: safeFaviconURL(t.faviconURL), themeColorHex: /^#[0-9a-f]{6}$/i.test(String(t.themeColorHex || '')) ? String(t.themeColorHex).toLowerCase() : null,
  };
}
function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : Date.now(); }
function uuid() { return crypto.randomUUID().toUpperCase(); }

module.exports = { Store, HISTORY_MAX, uuid };
