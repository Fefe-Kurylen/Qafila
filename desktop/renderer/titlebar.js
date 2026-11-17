'use strict';
// Barre de titre Windows : couleurs (celles de la bande de Qafila) et titre de l'onglet, posés par le processus principal.
window.__qafilaTitlebar = (s) => {
  const root = document.documentElement;
  if (s.bg) root.style.setProperty('--bg', s.bg);
  if (s.fg) root.style.setProperty('--fg', s.fg);
  root.classList.toggle('blur', s.focused === false);
  if (s.height) { root.style.setProperty('--h', s.height + 'px'); root.style.fontSize = s.height >= 48 ? '13px' : s.height <= 32 ? '11.5px' : '12px'; }
  const el = document.getElementById('title');
  if (typeof s.title === 'string' && el.textContent !== s.title) el.textContent = s.title;
};
