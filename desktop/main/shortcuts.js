'use strict';
// Raccourcis clavier : traduction d'une frappe (before-input-event) en commande, sans dépendance à Electron (testé
// par node --test). Les lettres suivent la disposition latine du clavier (AZERTY, QWERTZ…) ; avec une disposition non
// latine (arabe, russe, grec, hébreu…), la touche physique (input.code) donne la lettre, comme Chrome.

/** Touche normalisée : lettre en minuscule, ou nom de la touche (« ArrowLeft », « F5 »…). */
function keyOf(input) {
  const raw = String(input?.key || '');
  let key = raw.length === 1 ? raw.toLowerCase() : raw;
  // Touche morte (macOS : ⌥I donne « ˆ ») ou caractère non latin : la lettre de la touche physique.
  if ((key.length === 1 && key > '\x7f') || key === 'Dead') {
    const m = /^Key([A-Z])$/.exec(input.code || '');
    if (m) key = m[1].toLowerCase();
  }
  return key;
}

/**
 * Commande d'une frappe, ou null. Formes : 'back', 'forward', 'reload', 'fullscreen', 'escape', 'devtools',
 * 'newTab', 'reopenTab', 'newPrivateTab', 'closeTab', 'nextTab', 'prevTab', 'focusAddress', 'find',
 * 'bookmark', 'history', 'bookmarks', 'tabs', 'settings', 'zoomIn', 'zoomOut', 'zoomReset', 'tab:<n>' (1…9).
 * macOS : ⌘ remplace Ctrl ; ⌥←/→ reste le saut de mot du système (Précédent / Suivant = ⌘[ / ⌘]) ; ⌘H reste
 * « Masquer Qafila » (Historique = ⌘Y) ; outils de développement = ⌘⌥I ; onglet suivant / précédent = Ctrl+Tab,
 * ⇧⌘] / ⇧⌘[ ou ⌥⌘→ / ⌥⌘← (⌘Tab appartient au sélecteur d'applications).
 * Windows / Linux : champ d'adresse aussi par Alt+D et F6, comme Chrome, Edge et Firefox.
 */
function resolve(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown') return null;
  const mac = platform === 'darwin';
  const mod = mac ? !!input.meta : !!input.control;
  const key = keyOf(input);
  const shift = !!input.shift;
  const alt = !!input.alt;
  if (key === 'F6' && !mod && !alt && !shift && !input.meta && !input.control) return 'focusAddress';
  if (alt && !mod) {
    if (mac) return null;
    if (key === 'ArrowLeft') return 'back';
    if (key === 'ArrowRight') return 'forward';
    if (key === 'd' && !shift) return 'focusAddress';
    return null;
  }
  if (mac && input.control && !input.meta && !alt && key === 'Tab') return shift ? 'prevTab' : 'nextTab';
  if (key === 'F5') return 'reload';
  if (key === 'F11') return 'fullscreen';
  if (key === 'Escape') return 'escape';
  if (key === 'F12') return 'devtools';
  if (mod && key === 'i' && (mac ? alt : shift)) return 'devtools';
  if (!mod) return null;
  // Chiffres par position physique (Ctrl+1…9, Ctrl+0) : indépendants de la disposition (AZERTY : « & », « é »…).
  // Pavé numérique : seulement s'il donne un chiffre (Verr. Num. éteint, Ctrl+Fin ou Ctrl+Inser restent à la page).
  const digit = /^(Digit|Numpad)([0-9])$/.exec(input.code || '');
  if (digit && !shift && !alt && (digit[1] === 'Digit' || /^[0-9]$/.test(String(input.key || '')))) return digit[2] === '0' ? 'zoomReset' : `tab:${digit[2]}`;
  if (mac && alt && !shift && (key === 'ArrowLeft' || key === 'ArrowRight')) return key === 'ArrowLeft' ? 'prevTab' : 'nextTab';
  if (mac && shift && !alt && (key === '{' || key === '}' || input.code === 'BracketLeft' || input.code === 'BracketRight')) {
    return key === '{' || (key !== '}' && input.code === 'BracketLeft') ? 'prevTab' : 'nextTab';
  }
  if (alt) return null;
  switch (key) {
    case 't': return shift ? 'reopenTab' : 'newTab';
    case 'n': return shift ? 'newPrivateTab' : 'newTab';
    case 'w': return 'closeTab';
    case 'Tab': return shift ? 'prevTab' : 'nextTab';
    case 'PageDown': return 'nextTab';
    case 'PageUp': return 'prevTab';
    case 'l': return 'focusAddress';
    case 'r': return 'reload';
    case 'f': return 'find';
    case 'd': return 'bookmark';
    case 'y': return mac ? 'history' : null;
    case 'h': return mac ? null : 'history';
    case '[': return mac ? 'back' : null;
    case ']': return mac ? 'forward' : null;
    case 'b': return shift ? 'bookmarks' : null;
    case 'a': return shift ? 'tabs' : null;
    case ',': return 'settings';
    case '+': case '=': return 'zoomIn';
    case '-': return 'zoomOut';
    case '0': return 'zoomReset';
    default: return /^[1-9]$/.test(key) ? `tab:${key}` : null;
  }
}

module.exports = { keyOf, resolve };
