'use strict';
// Remplissage des mots de passe (contrat shared/FORMS.md) :
// - le script partagé shared/qafila-forms.js est injecté dans un monde isolé (4712) du cadre principal, avec une
//   « colle » qui transmet la description des formulaires et les soumissions par une passerelle du préchargement
//   visible seulement dans ce monde (preload/page.js) ;
// - quand un champ de connexion prend le focus et que le coffre connaît ce site, une petite carte s'affiche sous le
//   champ (vue séparée, hors de la page) ; UN clic sur un identifiant le remplit (jamais d'envoi du formulaire) ;
// - après une connexion, carte « Enregistrer le mot de passe ? » / « Mettre à jour ? » / « Jamais pour ce site ».
// Le mot de passe n'est jamais affiché, n'est jamais posé dans le presse-papiers et ne quitte le coffre que pour le
// champ de la page d'origine exacte (vérifiée au moment du clic). Rien en navigation privée.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebContentsView } = require('electron');

const WORLD = 4712;
const CARD_W = 300;
const SAVE_W = 340;

const GLUE = `;(() => {
  const F = window.__qafilaForms, B = window.__qafilaFormsBridge;
  if (!F || !B || window.__qafilaFormsGlue) return;
  window.__qafilaFormsGlue = true;
  const rect = (sel) => {
    try { const el = sel && document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; } catch (e) { return null; }
  };
  F.observe((forms, meta) => {
    const focused = (meta && meta.focused) || null;
    B.post(JSON.stringify({ t: 'observe', forms: forms, reason: meta && meta.reason, focused: focused, rect: rect(focused) }));
  });
  F.captureSubmit((sub) => { B.post(JSON.stringify({ t: 'submit', sub: sub })); });
})();`;

function readScript() {
  const dirs = [process.resourcesPath && path.join(process.resourcesPath, 'shared'), path.join(__dirname, '..', '..', 'shared')].filter(Boolean);
  for (const d of dirs) { try { return fs.readFileSync(path.join(d, 'qafila-forms.js'), 'utf8'); } catch { /* suivant */ } }
  return null;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const originOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; } };
const hostOf = (origin) => { try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Mot de passe fort de 20 caractères (lettres, chiffres, quelques symboles), sans caractères ambigus. */
function generatePassword(n = 20) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_.!?@#'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const out = sets.map(pick);
  while (out.length < n) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

class Autofill {
  /**
   * @param {object} o
   * @param {() => Electron.BaseWindow} o.win
   * @param {import('./tabs').TabManager} o.tabs
   * @param {import('./vault').Vault} o.vault
   * @param {() => string} o.selected   onglet affiché
   * @param {() => Function} o.t        traductions
   * @param {() => boolean} o.isDark
   * @param {() => void} o.openPasswords  Réglages › Mots de passe
   * @param {(text: string) => void} o.toast
   */
  constructor(o) {
    Object.assign(this, o);
    this.script = readScript();
    this.view = null;
    this.card = null;        // { kind: 'fill'|'save', tabId, origin, ... }
    this.hideTimer = null;
    this.generated = new Map(); // tabId → { password, at } (carte « Enregistrer ? » après un mot de passe généré)
    this.lastSubmit = new Map();
  }

  // ----- Injection -----
  inject(tabId, wc) {
    if (!this.script || !wc || wc.isDestroyed() || !originOf(wc.getURL())) return;
    if (this.vault().status().state === 'none') return; // pas de coffre : rien à proposer
    wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: this.script + GLUE }]).catch(() => {});
  }

  // ----- Messages de la page (données, jamais des instructions) -----
  onMessage(tabId, wc, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'observe') this.onObserve(tabId, wc, msg);
    else if (msg.t === 'submit') this.onSubmit(tabId, wc, msg.sub);
  }

  onObserve(tabId, wc, msg) {
    if (tabId !== this.selected()) return;
    const forms = Array.isArray(msg.forms) ? msg.forms.slice(0, 5) : [];
    const focused = typeof msg.focused === 'string' ? msg.focused.slice(0, 1024) : null;
    // Afficher la carte (nouvelle vue) retire un instant le focus à la page : cette perte-là est ignorée.
    if (!focused) { if (this.card?.kind === 'fill' && Date.now() - (this.shownAt || 0) > 600) this.hideSoon(); return; }
    // Carte déjà ouverte pour ce champ : rien à refaire (la recharger reprendrait le focus à la page).
    if (this.card?.kind === 'fill' && this.card.tabId === tabId && this.card.focused === focused) { clearTimeout(this.hideTimer); return; }
    if (msg.reason !== 'focus') return;
    const form = forms.find((f) => Array.isArray(f.fields) && f.fields.some((x) => x.selectorPath === focused));
    const field = form?.fields.find((x) => x.selectorPath === focused);
    if (!form || !field) { if (this.card?.kind === 'fill') this.hideSoon(); return; }
    const origin = originOf(wc.getURL());
    if (!origin || form.origin !== origin) return;
    const signup = (form.isSignup && field.kind !== 'username') || field.kind === 'newPassword' || field.kind === 'confirmPassword';
    let items = [];
    let locked = false;
    try { items = this.vault().candidates(origin).slice(0, 3); } catch { locked = true; }
    if (!locked && !items.length && !signup) { this.hide(); return; }
    const r = msg.rect && Number.isFinite(msg.rect.x) ? msg.rect : null;
    this.show({ kind: 'fill', tabId, wcId: wc.id, origin, form: form.form, focused, rect: r, items, signup, locked });
  }

  onSubmit(tabId, wc, sub) {
    if (!sub || typeof sub !== 'object') return;
    const origin = originOf(wc.getURL());
    if (!origin || sub.origin !== origin) return;
    const password = String((sub.newPassword || sub.password) || '').slice(0, 4096);
    const username = String(sub.username || '').slice(0, 1024);
    if (!password) return;
    const key = `${origin}|${username}|${password}`;
    if (this.lastSubmit.get(tabId) === key) return;
    this.lastSubmit.set(tabId, key);
    let cmp = { kind: 'new' };
    let locked = false;
    try { cmp = this.vault().compareSubmit(origin, username, password); } catch { locked = true; }
    if (cmp.kind === 'same' || cmp.kind === 'never' || cmp.kind === 'none') return;
    // Affichée après la navigation qui suit la connexion (ou au bout de 1,5 s si la page ne change pas).
    const pending = { kind: 'save', tabId, origin, username, password, update: cmp.kind === 'update' ? cmp.id : null, locked };
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { if (tabId === this.selected()) this.show(pending); }, 1500);
  }

  // ----- Carte -----
  ensureView() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, spellcheck: false } });
    view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e, url) => { e.preventDefault(); this.onClick(url); });
    this.view = view;
    return view;
  }

  show(card) {
    clearTimeout(this.hideTimer);
    const win = this.win();
    if (!win || win.isDestroyed()) return;
    const tabView = this.tabs.view(card.tabId);
    if (!tabView) return;
    this.card = card;
    const view = this.ensureView();
    const html = this.html(card);
    const height = this.heightOf(card);
    const tb = tabView.getBounds();
    const wc = this.tabs.contents(card.tabId);
    const zoom = wc && !wc.isDestroyed() ? wc.getZoomFactor() : 1;
    let x; let y; const w = card.kind === 'save' ? SAVE_W : CARD_W;
    if (card.kind === 'fill' && card.rect) {
      x = tb.x + Math.round(card.rect.x * zoom);
      y = tb.y + Math.round((card.rect.y + card.rect.h) * zoom) + 6;
      if (y + height > tb.y + tb.height) y = tb.y + Math.round(card.rect.y * zoom) - height - 6; // pas la place dessous
    } else {
      x = tb.x + tb.width - w - 16;
      y = tb.y + 12;
    }
    x = Math.max(tb.x + 8, Math.min(x, tb.x + tb.width - w - 8));
    y = Math.max(tb.y + 4, Math.min(y, tb.y + tb.height - height - 4));
    view.setBounds({ x, y, width: w, height });
    win.contentView.addChildView(view); // au premier plan
    this.shownAt = Date.now();
    view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {});
    // La carte ne garde jamais le focus : le curseur reste dans le champ de la page.
    if (card.kind === 'fill') { this.tabs.focus(); view.webContents.once('did-finish-load', () => { if (this.card === card) this.tabs.focus(); }); }
  }

  heightOf(card) {
    if (card.kind === 'save') return 132;
    const rows = (card.locked ? 1 : card.items.length) + (card.signup ? 1 : 0) + 1;
    return 16 + rows * 48;
  }

  hideSoon() { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => this.hide(), 700); }

  hide() {
    clearTimeout(this.hideTimer);
    this.card = null;
    const win = this.win();
    if (this.view && win && !win.isDestroyed()) { try { win.contentView.removeChildView(this.view); } catch { /* déjà retirée */ } }
  }

  /** Changement d'onglet, de page, défilement, surcouche du chrome : la carte de remplissage disparaît. */
  onTabEvent(kind, tabId) {
    if (!this.card) return;
    if (kind === 'select' && this.card.tabId !== this.selected()) this.hide();
    else if (kind === 'navigate' && this.card.tabId === tabId && this.card.kind === 'fill') this.hide();
    else if (kind === 'scroll' && this.card.kind === 'fill' && this.card.tabId === tabId) this.hide();
    else if (kind === 'chrome') this.hide();
  }

  async onClick(url) {
    const card = this.card;
    clearTimeout(this.hideTimer);
    if (!card) return;
    let action; let arg;
    try { const u = new URL(url); if (u.protocol !== 'qafila-fill:') return; action = u.hostname; arg = decodeURIComponent(u.pathname.slice(1)); } catch { return; }
    const wc = this.tabs.contents(card.tabId);
    const t = this.t();
    if (action === 'close') { this.hide(); return; }
    if (action === 'more' || action === 'unlock') { this.hide(); this.openPasswords(); return; }
    if (!wc || wc.isDestroyed() || wc.id !== card.wcId && card.kind === 'fill') { this.hide(); return; }
    if (card.kind === 'fill') {
      // L'origine est revérifiée au moment du clic (FORMS.md §2.1).
      if (originOf(wc.getURL()) !== card.origin) { this.hide(); return; }
      let payload;
      if (action === 'fill') {
        let cred;
        try { cred = this.vault().credential(arg); } catch { this.hide(); this.openPasswords(); return; }
        if (!cred) { this.hide(); return; }
        payload = { origin: card.origin, form: card.form, username: cred.username || undefined, password: cred.password };
      } else if (action === 'gen') {
        const password = generatePassword();
        this.generated.set(card.tabId, { password, at: Date.now() });
        payload = { origin: card.origin, form: card.form, password };
      } else return;
      this.hide();
      this.tabs.focus();
      const res = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `window.__qafilaForms.fill(${JSON.stringify(payload)})` }]).catch(() => null);
      if (!res?.ok) this.toast(t('autofill_failed'));
      return;
    }
    if (card.kind === 'save') {
      try {
        if (action === 'save') {
          if (card.update) this.vault().updatePassword(card.update, card.password);
          else this.vault().add({ url: card.origin, username: card.username, password: card.password });
          this.toast(card.update ? t('autofill_updated') : t('autofill_saved'));
        } else if (action === 'never') {
          this.vault().neverSave(card.origin);
        }
        this.hide();
      } catch {
        this.hide();
        this.openPasswords();
      }
    }
  }

  // ----- Rendu (HTML statique, sans script : chaque bouton est un lien qafila-fill://) -----
  html(card) {
    const t = this.t();
    const dark = this.isDark();
    const key = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>';
    const host = hostOf(card.origin);
    let body = '';
    if (card.kind === 'fill') {
      const rows = [];
      if (card.locked) rows.push(`<a class="row" href="qafila-fill://unlock/">${key}<span class="txt"><b>${esc(t('autofill_unlock'))}</b><small>${esc(host.toUpperCase())}</small></span></a>`);
      for (const it of card.locked ? [] : card.items) {
        rows.push(`<a class="row" href="qafila-fill://fill/${encodeURIComponent(it.id)}">${key}<span class="txt"><b>${esc(it.username || t('vault_no_username'))}</b><small>${esc(host.toUpperCase())}</small></span></a>`);
      }
      if (card.signup) rows.push(`<a class="row" href="qafila-fill://gen/">${key}<span class="txt"><b>${esc(t('autofill_generate'))}</b><small>${esc(t('autofill_generate_sub'))}</small></span></a>`);
      rows.push(`<a class="row more" href="qafila-fill://more/"><span class="txt"><b>${esc(t('autofill_more'))}</b></span></a>`);
      body = rows.join('');
    } else {
      body = `<div class="save"><div class="title">${key}<b>${esc(card.update ? t('autofill_update_q') : t('autofill_save_q'))}</b><a class="x" href="qafila-fill://close/">✕</a></div>
        <div class="who">${esc(host)}${card.username ? ' · ' + esc(card.username) : ''}</div>
        <div class="btns"><a class="btn ghost" href="qafila-fill://never/">${esc(t('autofill_never'))}</a><a class="btn" href="qafila-fill://save/">${esc(card.update ? t('autofill_update') : t('autofill_save'))}</a></div></div>`;
    }
    const bg = dark ? '#2c2c2e' : '#ffffff';
    const fg = dark ? '#f2f2f7' : '#1c1c1e';
    const sub = dark ? '#98989f' : '#6e6e73';
    const line = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)';
    const hover = dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.05)';
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
      html,body{margin:0;padding:0;background:transparent;font:13px/1.3 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;color:${fg};user-select:none;overflow:hidden}
      .card{margin:4px;background:${bg};border:1px solid ${line};border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.18);padding:4px;overflow:hidden}
      a{color:inherit;text-decoration:none}
      .row{display:flex;align-items:center;gap:10px;height:44px;padding:0 10px;border-radius:9px;cursor:default}
      .row:hover{background:${hover}} .row svg{flex:none;color:${sub}}
      .txt{display:flex;flex-direction:column;min-width:0} .txt b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .txt small{font-size:9.5px;letter-spacing:.6px;color:${sub};font-weight:600}
      .more{height:36px;border-top:1px solid ${line};border-radius:0 0 9px 9px;margin-top:2px} .more b{font-weight:500;color:${sub}}
      .save{padding:10px 12px} .title{display:flex;align-items:center;gap:8px;font-size:14px} .title b{flex:1}
      .x{color:${sub};padding:2px 6px;border-radius:6px} .x:hover{background:${hover}}
      .who{color:${sub};margin:6px 0 10px 26px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .btns{display:flex;justify-content:flex-end;gap:8px}
      .btn{padding:6px 14px;border-radius:999px;background:${fg};color:${bg};font-weight:600} .btn.ghost{background:transparent;color:${fg};border:1px solid ${line}}
    </style></head><body><div class="card">${body}</div></body></html>`;
  }
}

module.exports = { Autofill, generatePassword, WORLD };
