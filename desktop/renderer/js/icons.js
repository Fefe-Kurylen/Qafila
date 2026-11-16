// Icônes au trait fin (grille 24, trait = currentColor) dessinées d'après les SF Symbols utilisés sur iOS
// et les QIcon d'Android. L'épaisseur du trait suit le réglage « Graisse des icônes » (variable CSS --sw).

/** Roue dentée (gearshape) : contour calculé, 8 dents. */
function gear() {
  const pts = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 4 === 0 || i % 4 === 1) ? 8.6 : 6.6;
    pts.push(`${(12 + r * Math.cos(a + 0.09)).toFixed(2)} ${(12 + r * Math.sin(a + 0.09)).toFixed(2)}`);
  }
  return `<path d="M${pts.join('L')}Z" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8"/>`;
}

const shield = 'M12 3.4 18.8 6v5.6c0 4.3-2.8 7.6-6.8 8.9-4-1.3-6.8-4.6-6.8-8.9V6z';
const braces = (s = 1, o = 0) => {
  const p = (x, y) => `${(o + x * s).toFixed(2)} ${(o + y * s).toFixed(2)}`;
  return `<path d="M${p(9, 4.5)}C${p(7, 4.5)} ${p(6.6, 5.4)} ${p(6.6, 7)}V${(o + 9.6 * s).toFixed(2)}C${p(6.6, 11)} ${p(5.9, 12)} ${p(4.6, 12)}C${p(5.9, 12)} ${p(6.6, 13)} ${p(6.6, 14.4)}V${(o + 17 * s).toFixed(2)}C${p(6.6, 18.6)} ${p(7, 19.5)} ${p(9, 19.5)}M${p(15, 4.5)}C${p(17, 4.5)} ${p(17.4, 5.4)} ${p(17.4, 7)}V${(o + 9.6 * s).toFixed(2)}C${p(17.4, 11)} ${p(18.1, 12)} ${p(19.4, 12)}C${p(18.1, 12)} ${p(17.4, 13)} ${p(17.4, 14.4)}V${(o + 17 * s).toFixed(2)}C${p(17.4, 18.6)} ${p(17, 19.5)} ${p(15, 19.5)}"/>`;
};
const dot = (x, y, r = 1.35) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;

export const PATHS = {
  back: '<path d="M15 4.8 7.8 12l7.2 7.2"/>',
  forward: '<path d="m9 4.8 7.2 7.2L9 19.2"/>',
  reload: '<path d="M19 12.2A7 7 0 1 1 16.9 7"/><path d="M17.6 3.6v3.9h-3.9"/>',
  stop: '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>',
  xmark: '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>',
  plus: '<path d="M12 4.4v15.2M4.4 12h15.2"/>',
  download: '<path d="M12 4v11.2M7.6 10.8 12 15.2l4.4-4.4"/><path d="M5 16.4v1.8A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8v-1.8"/>',
  folder: '<path d="M4 7.2A1.8 1.8 0 0 1 5.8 5.4h3.9l2 2.2h6.5A1.8 1.8 0 0 1 20 9.4v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.8z"/>',
  share: '<path d="M12 3.4v11.4M8.2 7.1 12 3.3l3.8 3.8"/><path d="M9.2 9.8H7.6a1.6 1.6 0 0 0-1.6 1.6v7.8a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6v-7.8a1.6 1.6 0 0 0-1.6-1.6h-1.6"/>',
  hand: '<path d="M8.6 12.6V6.3a1.25 1.25 0 0 1 2.5 0v5.2M11.1 11.5V4.9a1.25 1.25 0 0 1 2.5 0v6.6M13.6 11.5V6a1.25 1.25 0 0 1 2.5 0v6.2M16.1 12.2V8.6a1.25 1.25 0 0 1 2.5 0v5.6c0 3.9-2.6 6.6-6.2 6.6-2.4 0-3.9-1-5.2-2.9l-2.4-3.7a1.3 1.3 0 0 1 2.1-1.5l1.7 2.1v-2.2"/>',
  xmarkSquare: '<rect x="4.4" y="4.4" width="15.2" height="15.2" rx="3.2"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  book: '<path d="M12 6.6C10.2 5.2 7.7 4.6 4.4 4.6v13.2c3.3 0 5.8.6 7.6 2 1.8-1.4 4.3-2 7.6-2V4.6c-3.3 0-5.8.6-7.6 2zM12 6.6v13.1"/>',
  bookmark: '<path d="M7 4.4h10v15.4l-5-3.7-5 3.7z"/>',
  bookmarkFill: '<path d="M7 4.4h10v15.4l-5-3.7-5 3.7z" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3.1 2"/>',
  textSearch: '<circle cx="10.6" cy="10.6" r="6.2"/><path d="m15.1 15.1 4.7 4.7M8 9h5.2M8 12h3.4"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.4 15.4 4.4 4.4"/>',
  shieldHalf: `<path d="${shield}"/><path d="M12 3.4v17.1c-4-1.3-6.8-4.6-6.8-8.9V6z" fill="currentColor" stroke="none"/>`,
  shieldSlash: `<path d="${shield}"/><path d="m4 4 16 16"/>`,
  shield: `<path d="${shield}"/>`,
  circleHalf: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6a8.4 8.4 0 0 0 0 16.8z" fill="currentColor" stroke="none"/>',
  reader: '<path d="M4.4 6.4h15.2M4.4 10.2h10.4M4.4 14h15.2M4.4 17.8h8.6"/>',
  braces: braces(),
  bracesSquare: `<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4"/>${braces(0.62, 4.56)}`,
  desktop: '<rect x="3.4" y="4.4" width="17.2" height="11.6" rx="1.6"/><path d="M9.2 19.8h5.6M12 16v3.8"/>',
  phone: '<rect x="7.4" y="3" width="9.2" height="18" rx="2.3"/><path d="M10.9 18.3h2.2"/>',
  translate: '<path d="M5.6 4.4h12.8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7.2l-4.6 3.4v-3.4h-1a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/><path d="m9.2 14.4 2.8-7 2.8 7M10.2 12.1h3.6"/>',
  toTop: '<path d="M5 4.4h14M12 19.8V8.6M7.2 13.2 12 8.4l4.8 4.8"/>',
  toBottom: '<path d="M5 19.6h14M12 4.2v11.2M7.2 10.8l4.8 4.8 4.8-4.8"/>',
  house: '<path d="M3.8 11.2 12 4.2l8.2 7"/><path d="M6.2 9.4v10.2h4.2v-5.4h3.2v5.4h4.2V9.4"/>',
  gear: gear(),
  sliders: '<path d="M4 7h9.2M16.8 7H20M4 12h3.2M10.8 12H20M4 17h11.2M18.8 17H20"/><circle cx="15" cy="7" r="1.9"/><circle cx="9" cy="12" r="1.9"/><circle cx="17" cy="17" r="1.9"/>',
  dots: dot(5.6, 12) + dot(12, 12) + dot(18.4, 12),
  dotsCircle: '<circle cx="12" cy="12" r="8.6"/>' + dot(8.2, 12, 1.05) + dot(12, 12, 1.05) + dot(15.8, 12, 1.05),
  linesCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M8.2 9h7.6M8.2 12h7.6M8.2 15h7.6"/>',
  link: '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1 1"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1-1"/>',
  moon: '<path d="M19.4 14.6A8 8 0 1 1 9.4 4.6a6.4 6.4 0 0 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5"/>',
  minus: '<path d="M5 12h14"/>',
  undo: '<path d="M8.6 4.8 4.2 9.2l4.4 4.4"/><path d="M4.4 9.2h10.4a4.8 4.8 0 0 1 0 9.6H11"/>',
  trash: '<path d="M4.4 6.6h15.2M9.4 6.4V4.4h5.2v2M6.4 6.6l1 13h9.2l1-13M10.2 10.2v6M13.8 10.2v6"/>',
  copy: '<rect x="8.6" y="8.4" width="11" height="12" rx="2"/><path d="M15.4 8.4V6a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2v9.2a2 2 0 0 0 2 2h2.2"/>',
  key: '<circle cx="7.8" cy="12" r="3.6"/><path d="M11.4 12h9M17.4 12v3M20.2 12v2.4"/>',
  sync: '<path d="M18.8 9.6A7.2 7.2 0 0 0 5.6 8.4M5.2 14.4a7.2 7.2 0 0 0 13.2 1.2"/><path d="M5.4 4.8v3.8h3.8M18.6 19.2v-3.8h-3.8"/>',
  chevronRight: '<path d="m9.4 5.6 6.2 6.4-6.2 6.4"/>',
  chevronLeft: '<path d="M14.6 5.6 8.4 12l6.2 6.4"/>',
  chevronUpDown: '<path d="m8 9.6 4-4 4 4M8 14.4l4 4 4-4"/>',
  chevronDown: '<path d="m6.4 9.4 5.6 5.6 5.6-5.6"/>',
  check: '<path d="m5.2 12.6 4.4 4.4 9.2-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="m8 12.4 2.8 2.8 5.4-5.8" stroke="var(--check-ink, #fff)"/>',
  xmarkCircle: '<circle cx="12" cy="12" r="8.6"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  lock: '<rect x="6.2" y="10.6" width="11.6" height="9" rx="2"/><path d="M8.6 10.6V8a3.4 3.4 0 0 1 6.8 0v2.6"/>',
  grid: '<rect x="4.4" y="4.4" width="6.4" height="6.4" rx="1.6"/><rect x="13.2" y="4.4" width="6.4" height="6.4" rx="1.6"/><rect x="4.4" y="13.2" width="6.4" height="6.4" rx="1.6"/><rect x="13.2" y="13.2" width="6.4" height="6.4" rx="1.6"/>',
  list: '<path d="M9 6.6h11M9 12h11M9 17.4h11"/>' + dot(5, 6.6, 1.1) + dot(5, 12, 1.1) + dot(5, 17.4, 1.1),
  sort: '<path d="M7.6 19.4V4.6M4.2 8l3.4-3.4L11 8M16.4 4.6v14.8M13 16l3.4 3.4 3.4-3.4"/>',
  heart: '<path d="M12 20.2s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.6 10c0 5.6-7.6 10.2-7.6 10.2z" fill="currentColor" stroke="none"/>',
  toolbarIcon: '<rect x="3.4" y="5.4" width="17.2" height="13.2" rx="2.6"/><path d="M6.4 15.2h11.2" stroke-width="calc(var(--sw) * 1.8)"/>',
  squares: '<rect x="8.2" y="8.2" width="11.6" height="11.6" rx="2.4"/><path d="M15.8 8.2V6.6a2.4 2.4 0 0 0-2.4-2.4H6.6a2.4 2.4 0 0 0-2.4 2.4v6.8a2.4 2.4 0 0 0 2.4 2.4h1.6"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.6M10.6 16.6h2.8"/>' + dot(12, 7.9, 1.05),
  globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.4 2.4 3.4 5.4 3.4 8.6s-1 6.2-3.4 8.6c-2.4-2.4-3.4-5.4-3.4-8.6s1-6.2 3.4-8.6z"/>',
  keyboard: '<rect x="2.8" y="6" width="18.4" height="12" rx="2.2"/><path d="M6.4 9.6h.01M9.4 9.6h.01M12.4 9.6h.01M15.4 9.6h.01M18 9.6h.01M7.6 14.4h8.8"/>',
  external: '<path d="M13.6 4.6h5.8v5.8M19.2 4.8 11 13"/><path d="M17.4 13.6v4a1.8 1.8 0 0 1-1.8 1.8H6.4a1.8 1.8 0 0 1-1.8-1.8V8.4a1.8 1.8 0 0 1 1.8-1.8h4"/>',
  arrowUpLeft: '<path d="M17.4 17.4 6.8 6.8M6.6 15V6.6H15"/>',
  grip: '<path d="M6 9h12M6 12h12M6 15h12"/>',
  textSize: '<path d="M3.8 18.6 8 7.4l4.2 11.2M5.2 15h5.6M13.4 18.6l3.2-8.4 3.2 8.4M14.4 16h4.4"/>',
};

/** Icône d'une action du contrat (toolbar-actions.json), selon l'état (actif / inactif) et le réglage menuIcon. */
export function actionIcon(id, st = {}) {
  switch (id) {
    case 'back': return 'back';
    case 'forward': return 'forward';
    case 'reload': return st.loading ? 'stop' : 'reload';
    case 'stop': return 'stop';
    case 'newTab': return 'plus';
    case 'newPrivateTab': return 'hand';
    case 'closeTab': return 'xmark';
    case 'closeAllTabs': return 'xmarkSquare';
    case 'bookmarks': return 'book';
    case 'addBookmark': return st.bookmarked ? 'bookmarkFill' : 'bookmark';
    case 'history': return 'clock';
    case 'share': return 'share';
    case 'find': return 'textSearch';
    case 'blocker': return st.blockerActive === false ? 'shieldSlash' : 'shieldHalf';
    case 'darken': return 'circleHalf';
    case 'reader': return 'reader';
    case 'javascript': return st.javascript === false ? 'bracesSquare' : 'braces';
    case 'desktopSite': return st.desktop ? 'phone' : 'desktop';
    case 'translate': return 'translate';
    case 'scrollTop': return 'toTop';
    case 'scrollBottom': return 'toBottom';
    case 'home': return 'house';
    case 'settings': return 'gear';
    case 'customize': return 'sliders';
    case 'menu': return st.menuIcon === 'dotsCircle' ? 'dotsCircle' : st.menuIcon === 'linesCircle' ? 'linesCircle' : 'dots';
    case 'address': return 'link';
    case 'darkMode': return st.dark ? 'sun' : 'moon';
    case 'separator': return 'minus';
    case 'reopenTab': return 'undo';
    case 'closeAllAndClear': return 'trash';
    case 'copyLink': return 'copy';
    case 'search': return 'search';
    case 'passwords': return 'key';
    case 'sync': return 'sync';
    default: return 'minus';
  }
}

/** SVG en ligne. `size` en px (défaut : hérité du CSS). */
export function icon(name, size) {
  const s = size ? ` width="${size}" height="${size}"` : '';
  return `<svg class="ic" viewBox="0 0 24 24"${s} aria-hidden="true">${PATHS[name] || PATHS.minus}</svg>`;
}

/** Bouton Onglets : carré arrondi au trait avec le nombre d'onglets (police 10 pt à taille moyenne). */
export function tabsGlyph(count, size = 20) {
  const n = count > 99 ? '∞' : String(count);
  const box = size + 2;
  const fs = size * (n.length > 1 ? 0.46 : 0.52);
  return `<span class="tabs-glyph" style="width:${box}px;height:${box}px;border-radius:${(size * 0.26).toFixed(1)}px;font-size:${fs.toFixed(1)}px">${n}</span>`;
}
