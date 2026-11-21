'use strict';
// Icônes des sites favoris (page de démarrage façon Safari) : prises sur le site lui-même (apple-touch-icon, sinon
// favicon.ico, ou l'icône annoncée par la page visitée), réduites à 96 px et gardées sur l'ordinateur
// (dossier site-icons). Aucun service tiers. Jamais pour un onglet privé.
const fs = require('node:fs');
const path = require('node:path');
const { net, nativeImage } = require('electron');

const SIZE = 96;

class SiteIcons {
  /** @param {{ dir: string, onChange: () => void, session: () => Electron.Session }} o */
  constructor(o) {
    Object.assign(this, o);
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* existe */ }
    this.memory = new Map();   // hôte → { url, bg, fill } | null
    this.pending = new Set();
    this.changeTimer = null;
  }

  file(host) { return path.join(this.dir, host.replace(/[^a-z0-9.-]/gi, '_') + '.json'); }

  /** Icône connue pour un hôte, ou null (la cherche alors en arrière-plan). */
  get(host) {
    if (!host) return null;
    host = host.toLowerCase();
    if (this.memory.has(host)) return this.memory.get(host);
    try {
      const v = JSON.parse(fs.readFileSync(this.file(host), 'utf8'));
      if (v && typeof v.url === 'string' && v.url.startsWith('data:image/png;base64,')) { this.memory.set(host, v); return v; }
    } catch { /* inconnue */ }
    this.fetch(host);
    return null;
  }

  /** Icône annoncée par une page visitée (onglet normal) : prise si l'hôte n'en a pas encore. */
  offer(host, url) {
    if (!host || !/^https?:/.test(url || '')) return;
    host = host.toLowerCase();
    if (this.memory.get(host)) return;
    this.fetch(host, [url]);
  }

  async fetch(host, first = []) {
    if (this.pending.has(host)) return;
    this.pending.add(host);
    this.memory.set(host, null);
    const urls = [...first, `https://${host}/apple-touch-icon.png`, `https://${host}/apple-touch-icon-precomposed.png`, `https://${host}/favicon.ico`];
    try {
      for (const u of urls) {
        const img = await this.load(u);
        if (!img) continue;
        const entry = style(img);
        this.memory.set(host, entry);
        try { fs.writeFileSync(this.file(host), JSON.stringify(entry)); } catch { /* disque plein */ }
        this.changed();
        return;
      }
    } finally {
      this.pending.delete(host);
    }
  }

  async load(url) {
    try {
      const ses = this.session?.();
      const res = await (ses ? ses.fetch(url, { redirect: 'follow' }) : net.fetch(url, { redirect: 'follow' }));
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 2_000_000) return null;
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const { width, height } = img.getSize();
      if (width < 16 || height < 16) return null;
      return img;
    } catch { return null; }
  }

  changed() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.onChange(), 600);
  }
}

/**
 * Image réduite + couleur moyenne de ses bords (fond de la tuile, l'icône s'y fond) ; `fill` : grande icône opaque
 * qui peut couvrir toute la tuile (comme les icônes d'écran d'accueil).
 */
function style(img) {
  const { width, height } = img.getSize();
  const small = width > SIZE || height > SIZE ? img.resize({ width: SIZE, height: SIZE, quality: 'best' }) : img;
  const probe = img.resize({ width: 24, height: 24, quality: 'good' });
  const bmp = probe.toBitmap(); // BGRA
  const n = 24;
  let r = 0; let g = 0; let b = 0; let a = 0; let count = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!(x === 0 || y === 0 || x === n - 1 || y === n - 1)) continue;
      const i = (y * n + x) * 4;
      b += bmp[i]; g += bmp[i + 1]; r += bmp[i + 2]; a += bmp[i + 3]; count++;
    }
  }
  const alpha = a / count / 255;
  let bg = '';
  if (alpha > 0.6) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v / count / alpha))).toString(16).padStart(2, '0');
    bg = '#' + c(r) + c(g) + c(b);
  }
  return { url: small.toDataURL(), bg, fill: Math.max(width, height) >= SIZE && alpha > 0.95 };
}

module.exports = { SiteIcons };
