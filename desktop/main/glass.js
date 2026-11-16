'use strict';
// Faux verre (comme GlassBackdrop.kt) : la zone de la page sous la bande du chrome est capturée à échelle réduite
// (au plus toutes les ~100 ms pendant le défilement, puis une dernière fois à l'arrêt) et envoyée au chrome, qui la
// floute sous la couleur translucide de la barre. Jamais d'exception : en cas d'échec, la barre garde sa couleur simple.
class Glass {
  /**
   * @param {object} o
   * @param {() => Electron.WebContents|null} o.pageContents contenu de la page affichée
   * @param {() => Electron.WebContents|null} o.chromeContents contenu du chrome
   * @param {() => Electron.Rectangle|null} o.stripRect zone de la barre dans la fenêtre (null : verre inactif)
   */
  constructor({ pageContents, chromeContents, stripRect, scale = 0.25 }) {
    this.pageContents = pageContents;
    this.chromeContents = chromeContents;
    this.stripRect = stripRect;
    this.scale = scale;
    this.last = 0;
    this.pending = null;
    this.busy = false;
    this.active = true;
  }

  setActive(on) { this.active = !!on; if (on) this.refresh(60); else this.clear(); }

  /** Défilement : une capture toutes les 100 ms au plus, puis une dernière à l'arrêt. */
  onScroll(final) {
    if (!this.active) return;
    const now = Date.now();
    if (final || now - this.last >= 100) { this.last = now; this.capture(); }
    this.refresh(150);
  }

  /** Capture différée (fin de chargement, changement d'onglet, redimensionnement). */
  refresh(delay = 0) {
    clearTimeout(this.pending);
    if (!this.active) return;
    this.pending = setTimeout(() => this.capture(), delay);
  }

  clear() {
    clearTimeout(this.pending);
    const chrome = this.chromeContents();
    if (chrome && !chrome.isDestroyed()) chrome.send('qafila:glass', null);
  }

  async capture() {
    if (this.busy || !this.active) return;
    const page = this.pageContents();
    const chrome = this.chromeContents();
    const rect = this.stripRect();
    if (!page || page.isDestroyed() || !chrome || chrome.isDestroyed() || !rect || rect.width < 2 || rect.height < 2) return;
    this.busy = true;
    try {
      const img = await page.capturePage({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
      if (!img.isEmpty()) {
        const small = img.resize({ width: Math.max(8, Math.round(rect.width * this.scale)), quality: 'good' });
        chrome.send('qafila:glass', { dataURL: small.toDataURL(), rect });
      }
    } catch { /* page en cours de destruction ou fenêtre cachée : la couleur simple reste */ }
    this.busy = false;
  }
}

module.exports = { Glass };
