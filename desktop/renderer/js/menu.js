// Menu flottant (DESIGN.md §3) : carte de 256 px, rayon 18, ancrée au bouton Menu ; éléments sans intitulé
// consécutifs = rangée de tuiles (intitulés si ≤ 3), lignes intitulé à gauche / icône à droite, rouge pour les
// actions destructives, traits de 0,5 px, voile de 10 % sur la page.
import { S, $, esc, actionLabel, action, toolbar, onRender } from './core.js';
import { icon, actionIcon, tabsGlyph } from './icons.js';
import { perform, actionState, isActive, isEnabled, lineLabel } from './actions.js';

/** Regroupe les entrées : tuiles consécutives, lignes consécutives, séparateurs (jamais en tête ni en double). */
export function menuRows(entries) {
  const out = [];
  let tiles = [];
  let lines = [];
  const flush = () => { if (tiles.length) { out.push({ kind: 'tiles', items: tiles }); tiles = []; } if (lines.length) { out.push({ kind: 'lines', items: lines }); lines = []; } };
  for (const e of entries || []) {
    if (e.action === 'address' || e.action === 'menu') continue;
    if (e.action === 'separator') { flush(); if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap' }); continue; }
    if (e.showsLabel === false) { if (lines.length) flush(); tiles.push(e); } else { if (tiles.length) flush(); lines.push(e); }
  }
  flush();
  if (out.length && out[out.length - 1].kind === 'gap') out.pop();
  return out;
}

/** HTML du menu (réel ou aperçu de l'éditeur). */
export function menuHTML(entries, st = actionState()) {
  const count = S.state?.tabs.filter((x) => !x.isPrivate).length || 0;
  const glyph = (id, size) => (id === 'tabs' ? tabsGlyph(count, size) : icon(actionIcon(id, st), size));
  let html = '';
  for (const row of menuRows(entries)) {
    if (row.kind === 'gap') { html += '<div class="m-gap"></div>'; continue; }
    if (row.kind === 'tiles') {
      const labelled = row.items.length <= 3;
      html += `<div class="m-tiles${labelled ? ' labelled' : ''}">`;
      row.items.forEach((e, i) => {
        const a = action(e.action);
        const en = isEnabled(e.action, st);
        if (i > 0) html += '<span class="m-vsep"></span>';
        html += `<button class="m-tile${a?.destructive ? ' red' : ''}${isActive(e.action, st) ? ' on' : ''}" data-menu="${e.action}" ${en ? '' : 'disabled'} title="${esc(actionLabel(e.action))}">${glyph(e.action, labelled ? 19 : 18)}${labelled ? `<span>${esc(actionLabel(e.action, true))}</span>` : ''}</button>`;
      });
      html += '</div>';
      continue;
    }
    row.items.forEach((e, i) => {
      const a = action(e.action);
      if (i > 0) html += '<div class="m-sep"></div>';
      html += `<button class="m-line${a?.destructive ? ' red' : ''}${isActive(e.action, st) ? ' on' : ''}" data-menu="${e.action}"><span class="l">${esc(lineLabel(e.action, actionLabel(e.action)))}</span>${glyph(e.action, 16)}</button>`;
    });
  }
  return html || `<div class="m-empty">${esc(S.cfg ? actionLabel('menu') : '')}</div>`;
}

/** Position : sous la barre (en haut) ou au-dessus (en bas), bord aligné sur le bouton Menu (ou la fin de la barre). */
function place(menu) {
  const btn = document.querySelector('#bar [data-action="menu"]');
  const bar = $('#bar').getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  const W = 256;
  let edge;
  if (btn) { const r = btn.getBoundingClientRect(); edge = rtl ? r.left - 6 : r.right + 6; } else edge = rtl ? bar.left + 8 : bar.right - 8;
  let left = rtl ? edge : edge - W;
  left = Math.max(12, Math.min(window.innerWidth - W - 12, left));
  menu.style.left = left + 'px';
  const bottom = document.documentElement.classList.contains('bottom');
  const gap = 8;
  if (bottom) { menu.style.top = 'auto'; menu.style.bottom = (window.innerHeight - bar.top + gap) + 'px'; menu.style.maxHeight = (bar.top - gap - 12) + 'px'; }
  else { menu.style.bottom = 'auto'; menu.style.top = (bar.bottom + gap) + 'px'; menu.style.maxHeight = (window.innerHeight - bar.bottom - gap - 12) + 'px'; }
  const ox = btn ? Math.min(W, Math.max(0, (btn.getBoundingClientRect().left + btn.offsetWidth / 2) - left)) : W;
  menu.style.transformOrigin = `${ox}px ${bottom ? '100%' : '0'}`;
}

let wasOpen = false;
function renderMenu() {
  const menu = $('#menu');
  const open = S.overlay === 'menu';
  menu.hidden = !open;
  if (!open) { wasOpen = false; menu.classList.remove('in'); return; }
  menu.innerHTML = menuHTML(toolbar().menu);
  place(menu);
  if (!wasOpen) { menu.classList.remove('in'); void menu.offsetWidth; menu.classList.add('in'); }
  wasOpen = true;
}
onRender(renderMenu);

export function installMenuEvents() {
  $('#menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (b && !b.disabled) perform(b.dataset.menu);
  });
}
