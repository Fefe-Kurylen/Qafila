'use strict';
// Coffre de mots de passe du PC (COFFRE-SYNC.md §3, shared/CRYPTO.md) : mot de passe principal → Argon2id → KEK,
// qui enveloppe une clé maîtresse aléatoire (VMK) ; les identifiants sont des enregistrements AES-256-GCM chiffrés
// avec K_secrets = HKDF(VMK, "qafila/v1/tier1-secrets"), mêmes formats octet pour octet que les vecteurs de
// shared/vectors (vérifié par test/vault.test.mjs). « Se souvenir sur cet ordinateur » ajoute l'emplacement
// `device` : une clé aléatoire (DUK) protégée par le système (Electron safeStorage : DPAPI sous Windows, trousseau
// sous macOS, libsecret sous Linux — refusé si le système n'a qu'un stockage en clair).
// Fichier : <userData>/vault.json (en-tête local + enveloppes) ; DUK : <userData>/vault-device.bin.
// Les mots de passe déchiffrés ne quittent le processus principal que pour « Afficher » ; « Copier » passe par le
// presse-papiers, vidé au bout de 60 s. Verrouillage automatique après 5 min sans utilisation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'qafila/v1';
const KDF = { alg: 'argon2id', m: 65536, t: 3, p: 1 };
const PAD = 256;
const MIN_PASSPHRASE = 12;
const AUTO_LOCK_MS = 5 * 60 * 1000;
const CLIPBOARD_MS = 60 * 1000;

// ----- Primitives (CRYPTO.md §1–§7) -----
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hex = (b) => Buffer.from(b).toString('hex');
const hkdf = (ikm, info, len = 32) => Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(info, 'utf8'), len));

function canonicalJson(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new Error('E_CANONICAL'); return String(v); }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  throw new Error('E_CANONICAL');
}

function pad(bytes) {
  const out = Buffer.alloc(Math.ceil((bytes.length + 1) / PAD) * PAD, 0);
  out.set(bytes, 0);
  out[bytes.length] = 0x80;
  return out;
}

function unpad(p) {
  let i = p.length - 1;
  while (i >= 0 && p[i] === 0) i--;
  if (i < 0 || p[i] !== 0x80 || p.length % PAD) throw new Error('E_PADDING');
  return p.subarray(0, i);
}

function seal(key, aad, plain, nonce = crypto.randomBytes(12)) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(Buffer.from(aad, 'utf8'));
  return { n: nonce, ct: Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]) };
}

function open(key, aad, nonce, ctTag) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(ctTag.subarray(ctTag.length - 16));
  return Buffer.concat([d.update(ctTag.subarray(0, ctTag.length - 16)), d.final()]);
}

async function argon2id(passphrase, salt, kdf = KDF) {
  if (kdf.alg !== 'argon2id' || kdf.m < KDF.m || kdf.t < KDF.t || kdf.p !== 1) throw new Error('E_KDF');
  const { argon2id: wasm } = require('hash-wasm');
  const out = await wasm({ password: Buffer.from(String(passphrase).normalize('NFC'), 'utf8'), salt, parallelism: kdf.p, iterations: kdf.t, memorySize: kdf.m, hashLength: 32, outputType: 'binary' });
  return Buffer.from(out);
}

function tierKeys(vmk) {
  const sync = hkdf(vmk, `${PREFIX}/sync-token`);
  return { secrets: hkdf(vmk, `${PREFIX}/tier1-secrets`), data: hkdf(vmk, `${PREFIX}/tier2-data`), export: hkdf(vmk, `${PREFIX}/export`), vaultId: hex(hkdf(sync, `${PREFIX}/vault-id`, 16)) };
}

const slotAad = (vaultId, slotId, kg) => `${PREFIX}/slot|${vaultId}|${slotId}|${kg}`;
const recordAad = (vaultId, id, tier, kg, rev) => `${PREFIX}|${vaultId}|${id}|${tier}|${kg}|${rev}`;

function wrapSlot(key, vmk, vaultId, slotId, kg, nonce) {
  const s = seal(key, slotAad(vaultId, slotId, kg), vmk, nonce);
  return { id: slotId, n: b64u(s.n), ct: b64u(s.ct) };
}

function unwrapSlot(key, slot, vaultId, kg) {
  const vmk = open(key, slotAad(vaultId, slot.id, kg), unb64u(slot.n), unb64u(slot.ct));
  if (vmk.length !== 32) throw new Error('E_SLOT');
  return vmk;
}

function encryptRecord({ vaultId, id, kg, rev, content, key, nonce }) {
  const s = seal(key, recordAad(vaultId, id, 1, kg, rev), pad(Buffer.from(canonicalJson(content), 'utf8')), nonce);
  return { v: 1, id, tier: 1, kg, rev, del: !!content.deleted, n: b64u(s.n), ct: b64u(s.ct) };
}

function decryptRecord(e, { vaultId, key }) {
  if (e.v !== 1 || e.tier !== 1) throw new Error('E_ENVELOPE');
  const content = JSON.parse(unpad(open(key, recordAad(vaultId, e.id, e.tier, e.kg, e.rev), unb64u(e.n), unb64u(e.ct))).toString('utf8'));
  if (!content || content.type !== 'login' || content.deleted !== e.del) throw new Error('E_CONTENT');
  return content;
}

let revCounter = 0;
/** Horloge hybride (CRYPTO.md §6) : ms Unix sur 13 chiffres, compteur, aléa. */
function newRev() {
  revCounter = (revCounter + 1) & 0xffff;
  return `${String(Date.now()).padStart(13, '0')}-${revCounter.toString(16).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex')}`;
}

/** Origine d'une adresse : schéma + hôte (+ port non standard), comme normalizeOrigin de shared/import/parse.mjs. */
function originOf(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin.toLowerCase();
  } catch { return null; }
}

/** Origine découpée pour la correspondance : schéma, apex (sans www.), port explicite. */
function splitOrigin(origin) {
  try {
    const u = new URL(String(origin));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const scheme = u.protocol.slice(0, -1);
    return { scheme, apex: u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, ''), port: u.port || (scheme === 'https' ? '443' : '80') };
  } catch { return null; }
}

const hostLabel = (origin) => { try { return new URL(origin).host.replace(/^www\./, ''); } catch { return origin; } };

class Vault {
  /**
   * @param {{ dir: string, safeStorage?: Electron.SafeStorage, clipboard?: Electron.Clipboard, onChange?: () => void }} opts
   */
  constructor({ dir, safeStorage = null, clipboard = null, onChange = () => {} }) {
    this.file = path.join(dir, 'vault.json');
    this.deviceFile = path.join(dir, 'vault-device.bin');
    this.safeStorage = safeStorage;
    this.clipboard = clipboard;
    this.onChange = onChange;
    this.data = null;     // { header, deviceId, records: [enveloppes] }
    this.keys = null;     // { vmk, secrets, export, vaultId } quand ouvert
    this.items = null;    // Map id → login déchiffré
    this.lockTimer = null;
    this.clipTimer = null;
    this.lastBatch = null;
    this.load();
  }

  load() {
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = null; }
    if (this.data && (!this.data.header || !Array.isArray(this.data.records))) this.data = null;
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** Le système sait-il protéger une clé pour « Se souvenir sur cet ordinateur » ? */
  canRemember() {
    const s = this.safeStorage;
    if (!s || !s.isEncryptionAvailable()) return false;
    try { if (typeof s.getSelectedStorageBackend === 'function' && s.getSelectedStorageBackend() === 'basic_text') return false; } catch { /* Windows / macOS */ }
    return true;
  }

  remembered() { return !!this.data?.header.slots.some((s) => s.id === 'device') && fs.existsSync(this.deviceFile); }

  status() {
    return {
      state: !this.data ? 'none' : this.keys ? 'open' : 'locked',
      remember: this.remembered(), canRemember: this.canRemember(),
      count: this.items ? [...this.items.values()].length : null,
      lastBatch: this.lastBatch ? { count: this.lastBatch.ids.length, at: this.lastBatch.at, source: this.lastBatch.source } : null,
    };
  }

  touch() {
    clearTimeout(this.lockTimer);
    if (this.keys) { this.lockTimer = setTimeout(() => this.lock(), AUTO_LOCK_MS); this.lockTimer.unref?.(); }
  }

  async create(passphrase, remember) {
    if (this.data) throw new Error('E_EXISTS');
    if (typeof passphrase !== 'string' || [...passphrase].length < MIN_PASSPHRASE) throw new Error('E_WEAK');
    const vmk = crypto.randomBytes(32);
    const keys = tierKeys(vmk);
    const salt = crypto.randomBytes(16);
    const kek = await argon2id(passphrase, salt);
    const header = { v: 1, vaultId: keys.vaultId, createdAt: Date.now(), keyGeneration: 1,
      kdf: { alg: KDF.alg, salt: b64u(salt), m: KDF.m, t: KDF.t, p: KDF.p }, slots: [wrapSlot(kek, vmk, keys.vaultId, 'passphrase', 1)], previousKeys: [] };
    kek.fill(0);
    this.data = { header, deviceId: crypto.randomBytes(4).toString('hex'), records: [] };
    this.openWith(vmk);
    if (remember) this.setRemember(true);
    this.save();
    this.onChange();
    return true;
  }

  openWith(vmk) {
    const keys = tierKeys(vmk);
    if (keys.vaultId !== this.data.header.vaultId) throw new Error('E_VAULT');
    const items = new Map();
    for (const e of this.data.records) {
      if (e.del) continue;
      try { items.set(e.id, { ...decryptRecord(e, { vaultId: keys.vaultId, key: keys.secrets }), id: e.id }); } catch { /* enveloppe illisible : ignorée */ }
    }
    this.keys = { vmk, ...keys };
    this.items = items;
    this.touch();
  }

  async unlock(passphrase) {
    if (!this.data) throw new Error('E_NONE');
    if (this.keys) return true;
    const h = this.data.header;
    const slot = h.slots.find((s) => s.id === 'passphrase');
    const kek = await argon2id(String(passphrase || ''), unb64u(h.kdf.salt), h.kdf);
    let vmk;
    try { vmk = unwrapSlot(kek, slot, h.vaultId, h.keyGeneration); } catch { throw new Error('E_WRONG'); } finally { kek.fill(0); }
    this.openWith(vmk);
    this.onChange();
    return true;
  }

  /** Ouverture sans mot de passe si « Se souvenir sur cet ordinateur » est actif. */
  unlockDevice() {
    if (!this.data || this.keys) return !!this.keys;
    if (!this.remembered() || !this.canRemember()) return false;
    try {
      const duk = Buffer.from(this.safeStorage.decryptString(fs.readFileSync(this.deviceFile)), 'base64');
      const h = this.data.header;
      const vmk = unwrapSlot(duk, h.slots.find((s) => s.id === 'device'), h.vaultId, h.keyGeneration);
      duk.fill(0);
      this.openWith(vmk);
      this.onChange();
      return true;
    } catch { return false; }
  }

  /** Ouvre si possible sans rien demander ; renvoie l'état. */
  ensureOpen() { if (!this.keys) this.unlockDevice(); if (this.keys) this.touch(); return !!this.keys; }

  setRemember(on) {
    if (!this.keys) throw new Error('E_LOCKED');
    const h = this.data.header;
    h.slots = h.slots.filter((s) => s.id !== 'device');
    try { fs.rmSync(this.deviceFile, { force: true }); } catch { /* absent */ }
    if (on) {
      if (!this.canRemember()) throw new Error('E_NO_KEYCHAIN');
      const duk = crypto.randomBytes(32);
      h.slots.push(wrapSlot(duk, this.keys.vmk, h.vaultId, 'device', h.keyGeneration));
      fs.writeFileSync(this.deviceFile, this.safeStorage.encryptString(duk.toString('base64')), { mode: 0o600 });
      duk.fill(0);
    }
    this.save();
    this.onChange();
    return this.remembered();
  }

  lock() {
    clearTimeout(this.lockTimer);
    if (this.keys) { for (const k of ['vmk', 'secrets', 'data', 'export']) this.keys[k]?.fill?.(0); }
    this.keys = null;
    this.items = null;
    this.onChange();
  }

  /** Vérifie le mot de passe principal sans changer l'état (export). */
  async verify(passphrase) {
    if (!this.data) return false;
    const h = this.data.header;
    const kek = await argon2id(String(passphrase || ''), unb64u(h.kdf.salt), h.kdf);
    try { unwrapSlot(kek, h.slots.find((s) => s.id === 'passphrase'), h.vaultId, h.keyGeneration).fill(0); return true; } catch { return false; } finally { kek.fill(0); }
  }

  // ----- Identifiants -----
  need() { if (!this.ensureOpen()) throw new Error('E_LOCKED'); }

  /** Liste sans les mots de passe. */
  list() {
    this.need();
    return [...this.items.values()].map((l) => ({ id: l.id, title: l.title, origin: l.origins[0], username: l.username, source: l.source || 'manual', modifiedAt: l.modifiedAt }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.username.localeCompare(b.username));
  }

  write(login) {
    const { id, ...content } = login;
    const rev = newRev();
    const env = encryptRecord({ vaultId: this.keys.vaultId, id, kg: this.data.header.keyGeneration, rev, content, key: this.keys.secrets });
    const i = this.data.records.findIndex((e) => e.id === id);
    if (i >= 0) this.data.records[i] = env; else this.data.records.push(env);
    if (content.deleted) this.items.delete(id); else this.items.set(id, login);
  }

  remove(id) {
    this.need();
    const l = this.items.get(id);
    if (!l) return false;
    // Pierre tombale (CRYPTO.md §6) : le contenu se réduit au strict nécessaire.
    this.write({ id, type: 'login', title: '', origins: l.origins, username: '', password: '', createdAt: l.createdAt, modifiedAt: Date.now(), author: this.data.deviceId, deleted: true });
    this.save();
    this.onChange();
    return true;
  }

  add({ url, username, password, title }) {
    this.need();
    const origin = originOf(url);
    if (!origin || typeof password !== 'string' || !password) throw new Error('E_INVALID');
    const now = Date.now();
    const login = { id: crypto.randomUUID(), type: 'login', title: String(title || hostLabel(origin)).slice(0, 512), origins: [origin], username: String(username || '').slice(0, 1024), password: password.slice(0, 4096),
      note: '', formActionOrigin: null, httpRealm: null, totp: null, folderId: null, favorite: false, tags: [], createdAt: now, modifiedAt: now, lastUsedAt: null, passwordChangedAt: now,
      passwordHistory: [], source: 'manual', importGuid: null, importBatch: null, neverSaveHere: false, author: this.data.deviceId, deleted: false };
    this.write(login);
    this.save();
    this.onChange();
    return login.id;
  }

  reveal(id) { this.need(); this.touch(); return this.items.get(id)?.password ?? null; }

  // ----- Remplissage automatique (FORMS.md §7) : correspondance exacte d'origine, www. et apex équivalents -----
  /** Identifiants pour l'origine d'une page (sans mot de passe), les plus récemment utilisés d'abord. */
  candidates(pageOrigin) {
    this.need();
    const page = splitOrigin(pageOrigin);
    if (!page) return [];
    const out = [];
    for (const l of this.items.values()) {
      if (l.neverSaveHere && !l.password) continue;
      let rank = null;
      for (const o of l.origins || []) {
        const c = splitOrigin(o);
        if (!c || c.port !== page.port || c.apex !== page.apex) continue;
        if (c.scheme === page.scheme) { rank = 'exact'; break; }
        if (c.scheme === 'http' && page.scheme === 'https') rank = rank || 'exact';   // mise à niveau acceptée, jamais l'inverse
      }
      if (rank) out.push({ id: l.id, username: l.username, title: l.title, lastUsedAt: l.lastUsedAt || 0, modifiedAt: l.modifiedAt || 0 });
    }
    return out.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.modifiedAt - a.modifiedAt);
  }

  /** Identifiant et mot de passe pour un remplissage (un tap de l'utilisateur) ; date d'utilisation mise à jour. */
  credential(id) {
    this.need();
    const l = this.items.get(id);
    if (!l) return null;
    this.write({ ...l, lastUsedAt: Date.now() });
    this.save();
    this.touch();
    return { username: l.username, password: l.password };
  }

  /** Après une connexion : identifiant déjà connu (même mot de passe = rien, autre = mise à jour), ou nouveau. */
  compareSubmit(pageOrigin, username, password) {
    this.need();
    const page = splitOrigin(pageOrigin);
    if (!page) return { kind: 'none' };
    for (const l of this.items.values()) {
      const same = (l.origins || []).some((o) => { const c = splitOrigin(o); return c && c.apex === page.apex && c.port === page.port; });
      if (!same) continue;
      if (l.neverSaveHere && !l.password) return { kind: 'never' };
      if ((l.username || '') === (username || '')) return l.password === password ? { kind: 'same' } : { kind: 'update', id: l.id };
    }
    return { kind: 'new' };
  }

  updatePassword(id, password) {
    this.need();
    const l = this.items.get(id);
    if (!l || typeof password !== 'string' || !password) throw new Error('E_INVALID');
    const now = Date.now();
    const history = [{ password: l.password, changedAt: l.passwordChangedAt || l.modifiedAt || now }, ...(l.passwordHistory || [])].slice(0, 5);
    this.write({ ...l, password: password.slice(0, 4096), passwordHistory: history, passwordChangedAt: now, modifiedAt: now });
    this.save();
    this.onChange();
    return true;
  }

  /** « Jamais pour ce site » : identifiant vide marqué neverSaveHere (FORMS.md §8). */
  neverSave(url) {
    this.need();
    const origin = originOf(url);
    if (!origin) return false;
    const now = Date.now();
    const login = { id: crypto.randomUUID(), type: 'login', title: hostLabel(origin), origins: [origin], username: '', password: '', note: '', formActionOrigin: null, httpRealm: null, totp: null,
      folderId: null, favorite: false, tags: [], createdAt: now, modifiedAt: now, lastUsedAt: null, passwordChangedAt: null, passwordHistory: [], source: 'manual', importGuid: null, importBatch: null,
      neverSaveHere: true, author: this.data.deviceId, deleted: false };
    this.write(login);
    this.save();
    this.onChange();
    return true;
  }

  /** Copie dans le presse-papiers, vidé au bout de 60 s s'il contient toujours cette valeur. */
  copy(id, field) {
    this.need();
    const l = this.items.get(id);
    if (!l || !this.clipboard) return false;
    const value = field === 'username' ? l.username : l.password;
    this.clipboard.writeText(value);
    if (field !== 'username') {
      clearTimeout(this.clipTimer);
      this.clipTimer = setTimeout(() => { try { if (this.clipboard.readText() === value) this.clipboard.clear(); } catch { /* fermé */ } }, CLIPBOARD_MS);
      this.clipTimer.unref?.();
    }
    this.touch();
    return true;
  }

  /**
   * Import d'identifiants analysés par shared/import/parse.mjs (IMPORT.md §6.2, §7.1) ; `dedupeLogins` vient du même
   * module. Renvoie les compteurs { added, updated, duplicates }.
   */
  importLogins(parsed, dedupeLogins, sourceLabel) {
    this.need();
    const now = Date.now();
    const batch = crypto.randomUUID();
    const existing = [...this.items.values()];
    const { logins, counts } = dedupeLogins(parsed.logins || [], existing, { now });
    const ids = [];
    for (const l of logins) {
      const fresh = !l.id;
      const rec = fresh
        ? { id: crypto.randomUUID(), type: 'login', title: l.title, origins: l.origins, username: l.username, password: l.password, note: l.note || '', formActionOrigin: l.formActionOrigin ?? null,
          httpRealm: l.httpRealm ?? null, totp: null, folderId: null, favorite: false, tags: [], createdAt: l.createdAt ?? now, modifiedAt: now, lastUsedAt: l.lastUsedAt ?? null,
          passwordChangedAt: l.passwordChangedAt ?? null, passwordHistory: l.passwordHistory || [], source: l.source || parsed.source || 'chrome', importGuid: l.importGuid ?? null,
          importBatch: batch, neverSaveHere: false, author: this.data.deviceId, deleted: false }
        : { ...l, modifiedAt: now, importBatch: batch };
      this.write(rec);
      if (fresh) ids.push(rec.id);
    }
    this.save();
    if (ids.length) this.lastBatch = { ids, at: now, source: sourceLabel };
    this.onChange();
    return counts;
  }

  /** Annule le dernier import : retire les identifiants qu'il avait ajoutés. */
  undoImport() {
    if (!this.lastBatch) return 0;
    this.need();
    let n = 0;
    for (const id of this.lastBatch.ids) if (this.items.has(id)) { this.remove(id); n++; }
    this.lastBatch = null;
    this.onChange();
    return n;
  }

  /** CSV dialecte Chrome (IMPORT.md §10.1), lisible par Chrome, Edge, Firefox, Bitwarden, 1Password. */
  exportCSV() {
    this.need();
    const q = (s) => (/[",\r\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const rows = [...this.items.values()].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : a.username < b.username ? -1 : 1));
    const lines = ['name,url,username,password,note'];
    for (const l of rows) {
      const url = l.origins[0].startsWith('app:') ? l.origins[0] : l.origins[0] + '/';
      const note = l.httpRealm ? `Authentification HTTP (${l.httpRealm}) · ${l.note || ''}` : (l.note || '');
      lines.push([l.title, url, l.username, l.password, note].map(q).join(','));
    }
    return lines.join('\n') + '\n';
  }
}

module.exports = { Vault, MIN_PASSPHRASE, internals: { canonicalJson, pad, unpad, hkdf, tierKeys, wrapSlot, unwrapSlot, encryptRecord, decryptRecord, argon2id, slotAad, recordAad } };
