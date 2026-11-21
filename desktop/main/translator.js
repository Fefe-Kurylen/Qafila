'use strict';
// Traduction intégrée (comme Chrome) : le texte de la page est traduit sur place, la mise en page, les liens, les
// formulaires et les connexions restent intacts (plus de détour par la page proxy de Google Traduction).
// Le script vit dans un monde isolé : le site ne le voit pas et ne peut pas le modifier. Seul le texte visible est
// envoyé au service de traduction, par lots ; le contenu ajouté ensuite (défilement infini, menus) est traduit au fil
// de l'eau. « Afficher l'original » remet le texte d'origine sans recharger.
// Traduction automatique (réglage autoTranslate) : pages dont la langue déclarée diffère de la langue choisie,
// jamais en navigation privée.
const { net } = require('electron');

const WORLD = 4711;
const ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&format=html&tl=';
const MAX_ITEMS = 60;
const MAX_CHARS = 4500;
const POLL_MS = 1500;

/**
 * Relève les textes pas encore traduits, regroupés par paragraphe (bloc) : chaque morceau de texte devient
 * « <a i=N>…</a> » (N = numéro du nœud), pour que la phrase soit traduite d'un seul tenant et que chaque morceau
 * (lien, gras…) retrouve sa place. Renvoie { texts } : un texte balisé par paragraphe.
 */
const COLLECT = `(() => {
  const st = window.__qtr || (window.__qtr = { nodes: [], orig: [], done: new WeakSet(), dirty: true, obs: null });
  if (!st.obs && document.body) {
    st.obs = new MutationObserver(() => { st.dirty = true; });
    st.obs.observe(document.body, { childList: true, subtree: true, characterData: false });
  }
  if (!st.dirty) return { texts: [] };
  st.dirty = false;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'MATH', 'KBD', 'SAMP', 'VAR', 'TEMPLATE', 'IFRAME', 'CANVAS']);
  const skipped = (el) => {
    for (let p = el; p; p = p.parentElement) {
      if (SKIP.has(p.tagName) || p.isContentEditable || p.getAttribute('translate') === 'no' || p.classList.contains('notranslate')) return true;
    }
    return false;
  };
  const blocks = new WeakMap();
  const blockOf = (el) => {
    for (let p = el; p; p = p.parentElement) {
      let b = blocks.get(p);
      if (b === undefined) { const d = getComputedStyle(p).display; b = !/^inline/.test(d) && d !== 'contents'; blocks.set(p, b); }
      if (b) return p;
    }
    return document.body;
  };
  const escHTML = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const texts = [];
  let chars = 0; let cur = null; let html = '';
  const flush = () => { if (html) { texts.push(html); chars += html.length; } html = ''; };
  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (st.done.has(n)) return NodeFilter.FILTER_REJECT;
      const v = n.nodeValue;
      if (!v || v.length > 5000 || !/\\p{L}/u.test(v)) return NodeFilter.FILTER_REJECT;
      return skipped(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    if (texts.length >= 1500 || chars > 120000) { st.dirty = true; break; }
    const i = st.nodes.length;
    st.nodes.push(n); st.orig.push(n.nodeValue); st.done.add(n);
    const b = blockOf(n.parentElement);
    if (b !== cur || html.length > 3000) { flush(); cur = b; }
    html += '<a i=' + i + '>' + escHTML(n.nodeValue.replace(/\\s+/g, ' ').trim()) + '</a> ';
  }
  flush();
  return { texts };
})()`;

const APPLY = (list) => `((list) => {
  const st = window.__qtr; if (!st) return;
  const dec = (t) => t.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, '\\u00a0').replace(/&amp;/g, '&');
  for (const html of list) {
    const re = /<a i=(\\d+)>([\\s\\S]*?)<\\/a>/g; let m;
    while ((m = re.exec(html))) {
      const i = Number(m[1]); const n = st.nodes[i]; const o = st.orig[i];
      const t = dec(m[2]).trim();
      if (!n || !t || n.nodeValue !== o) continue;
      // Élision (l’, d’) : pas d'espace avant le morceau suivant.
      const trail = /['’-]$/.test(t) ? '' : o.match(/\\s*$/)[0];
      n.nodeValue = o.match(/^\\s*/)[0] + t + trail;
    }
  }
})(${JSON.stringify(list)})`;

const RESTORE = `(() => {
  const st = window.__qtr; if (!st) return;
  if (st.obs) st.obs.disconnect();
  st.nodes.forEach((n, i) => { try { n.nodeValue = st.orig[i]; } catch (e) {} });
  window.__qtr = null;
})()`;

const LANG = `(document.documentElement.lang || document.querySelector('meta[http-equiv="content-language" i]')?.content || '').trim().toLowerCase()`;

class Translator {
  /**
   * @param {object} o
   * @param {import('./tabs').TabManager} o.tabs
   * @param {() => object} o.settings
   * @param {(tabId: string) => void} o.onChange
   * @param {(tabId: string, detected: string) => void} o.onTranslated
   */
  constructor(o) {
    Object.assign(this, o);
    this.state = new Map(); // tabId → { wcId, timer, busy, from }
  }

  target() { return String(this.settings().translateLanguage || 'fr').toLowerCase(); }
  isOn(tabId) { return this.state.has(tabId); }

  /** Bouton Traduire : traduit la page, ou rend l'original si elle l'est déjà. */
  toggle(tabId) { return this.isOn(tabId) ? this.restore(tabId) : this.start(tabId, { manual: true }); }

  async start(tabId, { manual = false } = {}) {
    const wc = this.tabs.contents(tabId);
    if (!wc || wc.isDestroyed() || !/^https?:/.test(wc.getURL()) || this.state.has(tabId)) return false;
    const s = { wcId: wc.id, timer: null, busy: false, from: '', manual };
    this.state.set(tabId, s);
    this.onChange(tabId);
    const first = await this.pass(tabId).catch(() => 0);
    if (!this.state.has(tabId)) return false;
    // Déjà dans la langue choisie (traduction automatique) : on n'insiste pas.
    if (!manual && s.from && s.from.split('-')[0] === this.target()) { await this.restore(tabId); return false; }
    if (first > 0 || manual) this.onTranslated(tabId, s.from);
    s.timer = setInterval(() => { this.pass(tabId).catch(() => {}); }, POLL_MS);
    return true;
  }

  async restore(tabId) {
    const s = this.state.get(tabId);
    if (!s) return false;
    clearInterval(s.timer);
    this.state.delete(tabId);
    const wc = this.tabs.contents(tabId);
    if (wc && !wc.isDestroyed() && wc.id === s.wcId) await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: RESTORE }]).catch(() => {});
    this.onChange(tabId);
    return true;
  }

  /** Nouveau document dans l'onglet : l'ancienne traduction n'existe plus. */
  reset(tabId) {
    const s = this.state.get(tabId);
    if (!s) return;
    clearInterval(s.timer);
    this.state.delete(tabId);
    this.onChange(tabId);
  }

  /** Fin de chargement : traduction automatique si la langue déclarée de la page n'est pas celle choisie. */
  async maybeAuto(tabId, tab) {
    if (this.settings().autoTranslate === false || tab?.isPrivate || this.state.has(tabId)) return;
    const wc = this.tabs.contents(tabId);
    if (!wc || wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return;
    const lang = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: LANG }]).catch(() => '');
    const primary = String(lang || '').split(/[-_]/)[0];
    if (!primary || primary === this.target() || !/^[a-z]{2,3}$/.test(primary)) return;
    this.start(tabId);
  }

  /** Un passage : relève les nouveaux textes, les traduit par lots, les remet en place. Renvoie le nombre traduit. */
  async pass(tabId) {
    const s = this.state.get(tabId);
    const wc = this.tabs.contents(tabId);
    if (!s || s.busy) return 0;
    if (!wc || wc.isDestroyed() || wc.id !== s.wcId) { this.reset(tabId); return 0; }
    s.busy = true;
    try {
      const got = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: COLLECT }]);
      const texts = got?.texts || [];
      if (!texts.length) return 0;
      let done = 0;
      for (const [, batch] of batches(texts)) {
        if (!this.state.has(tabId) || wc.isDestroyed()) break;
        const { list, langs } = await this.translate(batch);
        if (!s.from) s.from = majority(langs);
        await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: APPLY(list) }]);
        done += list.length;
      }
      return done;
    } finally {
      s.busy = false;
    }
  }

  /** Lot de textes → textes traduits (dans le même ordre) et langues détectées. */
  async translate(texts) {
    const body = texts.map((t) => 'q=' + encodeURIComponent(t)).join('&');
    const res = await net.fetch(ENDPOINT + encodeURIComponent(this.target()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
    if (!res.ok) throw new Error('traduction ' + res.status);
    const data = await res.json();
    // sl=auto : [[texte, langue], …] ; sinon [texte, …].
    const list = []; const langs = [];
    for (const item of Array.isArray(data) ? data : []) {
      if (Array.isArray(item)) { list.push(String(item[0] ?? '')); langs.push(String(item[1] ?? '')); } else list.push(String(item ?? ''));
    }
    return { list, langs };
  }

  shutdown() { for (const s of this.state.values()) clearInterval(s.timer); this.state.clear(); }
}

/** Découpe en lots (nombre de textes et taille limités) ; renvoie [décalage, textes][]. */
function batches(texts) {
  const out = [];
  let cur = []; let size = 0; let start = 0;
  texts.forEach((t, i) => {
    if (cur.length && (cur.length >= MAX_ITEMS || size + t.length > MAX_CHARS)) { out.push([start, cur]); cur = []; size = 0; start = i; }
    cur.push(t); size += t.length + 3;
  });
  if (cur.length) out.push([start, cur]);
  return out;
}

function majority(langs) {
  const n = new Map();
  for (const l of langs) if (l) n.set(l, (n.get(l) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

module.exports = { Translator, batches, majority };
