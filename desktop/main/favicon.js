'use strict';
// Icônes des sites : la page propose une adresse (preload/page.js, page-favicon-updated), le processus principal la
// filtre (http, https ou data:image seulement), la télécharge avec la session de l'onglet (partition, bloqueur) et
// ne donne au chrome qu'une petite adresse data:. Le chrome ne charge ainsi aucune ressource distante ni file:.

const MAX_URL = 2048;
const MAX_DATA_URL = 100_000;
const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 300;
const RETRY_MS = 10 * 60 * 1000;
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)(;[a-z0-9=._-]+)*,/i;

/** Adresse d'icône acceptable (http, https ou data:image raisonnable), sinon null. */
function safeFaviconURL(u) {
  if (typeof u !== 'string' || !u) return null;
  if (u.startsWith('data:')) return DATA_IMAGE.test(u) && u.length <= MAX_DATA_URL ? u : null;
  if (u.length > MAX_URL) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch { return null; }
}

/** Type d'image reconnu par ses premiers octets (serveurs qui répondent application/octet-stream). */
function sniff(buf) {
  if (buf.length >= 4 && buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) return 'image/x-icon';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

class FaviconCache {
  /** @param {() => void} onReady appelé quand une icône vient d'arriver (pour repousser l'état au chrome) */
  constructor(onReady) {
    this.onReady = onReady;
    this.entries = new Map(); // adresse → { data, pending, failedAt }
  }

  /**
   * Adresse data: de l'icône si elle est prête ; sinon lance le téléchargement (une fois) et renvoie null.
   * @param {string|null} url adresse proposée par la page
   * @param {Electron.Session|null} ses session de l'onglet
   */
  get(url, ses) {
    const safe = safeFaviconURL(url);
    if (!safe) return null;
    if (safe.startsWith('data:')) return safe;
    const e = this.entries.get(safe);
    if (e?.data) return e.data;
    if (e?.pending || (e?.failedAt && Date.now() - e.failedAt < RETRY_MS) || !ses || typeof ses.fetch !== 'function') return null;
    this.entries.set(safe, { data: null, pending: true, failedAt: 0 });
    this.trim();
    this.download(safe, ses).then((data) => {
      this.entries.set(safe, { data, pending: false, failedAt: 0 });
      this.onReady?.();
    }, () => {
      this.entries.set(safe, { data: null, pending: false, failedAt: Date.now() });
    });
    return null;
  }

  async download(url, ses) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await ses.fetch(url, { signal: ctrl.signal, credentials: 'omit', redirect: 'follow', headers: { accept: 'image/*' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const finalURL = res.url || url;
      if (!/^https?:/i.test(finalURL)) throw new Error('schéma refusé');
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BYTES) throw new Error('trop lourde');
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) throw new Error('taille');
      let type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/.test(type)) type = sniff(buf);
      if (!type) throw new Error('pas une image');
      return `data:${type};base64,${buf.toString('base64')}`;
    } finally { clearTimeout(timer); }
  }

  trim() {
    while (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value);
  }
}

module.exports = { FaviconCache, safeFaviconURL };
