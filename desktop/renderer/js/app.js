// Chrome de Qafila — démarrage : abonnements à l'état poussé par le processus principal, commandes (raccourcis
// clavier, scénario de test), voile, Échap, composition des captures d'écran de test. Aucun texte en dur :
// toutes les chaînes viennent de config().strings (i18n/<langue>.json).
import { q, S, $, t, setOverlay, render, renderNow, syncChromeMode, onRender, toast } from './core.js';
import { installBarEvents, beginEditing, cancelEditing, openFind, closeFind, demoEditing } from './bar.js';
import { installMenuEvents } from './menu.js';
import { installTabsEvents, openTabs, tabsEscape, setTabsDemo } from './tabs.js';
import { installSheetEvents, openSheet, sheetBack } from './sheet.js';
import { perform } from './actions.js';

// ----- Voile et surcouches -----
onRender(() => {
  const dim = $('#dim');
  dim.hidden = !['menu', 'editing', 'sheet'].includes(S.overlay);
  dim.classList.toggle('strong', S.overlay === 'sheet');
  document.documentElement.classList.toggle('overlay-tabs', S.overlay === 'tabs');
  // macOS : la barre déplace la fenêtre seulement quand aucune surcouche ne la recouvre (style.css).
  document.documentElement.classList.toggle('overlay-open', S.overlay !== 'none');
  // Plein écran d'une page : seul l'avis reste visible dans la vue du chrome (posée en haut, au centre).
  const n = S.state?.fullscreenNotice;
  document.documentElement.classList.toggle('fullscreen-notice', !!n);
  const fsn = $('#fsn');
  fsn.hidden = !n;
  if (n) fsn.textContent = n.host ? t('fullscreen_notice', n.host) : t('fullscreen_notice_page');
});
$('#mini').addEventListener('click', () => q.ui.expand().catch(() => {}));

/** Échap : referme la surcouche la plus haute. */
function escape() {
  if (S.overlay === 'editing') return cancelEditing();
  if (S.overlay === 'tabs' && tabsEscape()) return null;
  if (S.overlay === 'sheet') return sheetBack();
  if (S.overlay !== 'none') return setOverlay('none');
  if (S.find) return closeFind();
  return null;
}

$('#dim').addEventListener('mousedown', () => { if (S.overlay === 'editing') cancelEditing(); else setOverlay('none'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest('input')) escape(); });
window.addEventListener('resize', () => render());
// Boutons latéraux de la souris au-dessus de la barre, macOS seulement (sous Windows et Linux, « app-command » de la
// fenêtre s'en charge : ne pas naviguer deux fois).
document.addEventListener('mouseup', (e) => {
  if ((e.button !== 3 && e.button !== 4) || S.cfg?.app?.platform !== 'darwin') return;
  e.preventDefault();
  if (e.button === 3) q.tabs.back(); else q.tabs.forward();
});

// ----- Commandes du processus principal -----
q.ui.onCommand(async (c) => {
  switch (c.name) {
    case 'escape': return escape();
    case 'focusAddress': return beginEditing();
    case 'find': return openFind();
    case 'bookmark': return perform('addBookmark');
    case 'toast': return toast(c.text);
    case 'screen':
      if (c.screen === 'tabs') return S.overlay === 'tabs' ? setOverlay('none') : openTabs();
      if (['history', 'bookmarks', 'settings'].includes(c.screen)) return openSheet(c.screen, true);
      return setOverlay('none');
    case 'demo': return demo(c);
    default: return null;
  }
});

/** Scénario de démonstration (captures --smoke) : ouvre un écran précis. */
async function demo(c) {
  const s = c.screen;
  if (S.find) closeFind();
  if (s === 'none') return setOverlay('none');
  if (s === 'scroll') { const b = $('#sheet-body'); if (b) b.scrollTop = c.top === 'end' ? b.scrollHeight : Number(c.top) || 0; return null; }
  if (s === 'menu') { await setOverlay('none'); return setOverlay('menu'); }
  if (s === 'address') return demoEditing(c.text || 'cara');
  if (s === 'find') { await setOverlay('none'); openFind(); const i = $('#find-input'); if (i) { i.value = c.text || 'caravane'; i.dispatchEvent(new Event('input', { bubbles: true })); } return null; }
  if (s === 'tabs') { setTabsDemo({ popup: false }); return openTabs({ privateMode: false }); }
  if (s === 'tabs-popup') { setTabsDemo({ popup: true }); return render(); }
  if (['settings', 'history', 'bookmarks', 'gallery', 'editor'].includes(s)) return openSheet(s, true);
  if (['appearance', 'toolbar', 'address', 'privacy', 'reading', 'about', 'search', 'tabsSettings', 'downloads', 'language', 'extensions', 'sitePermissions', 'passwords', 'transfer'].includes(s)) { await openSheet('settings', true); return openSheet(s); }
  return null;
}

// ----- Faux verre au repos : rien à faire ici (bar.js), captures de test ci-dessous -----
q.test.onComposite(async ({ id, width, height, page, chrome, title }) => {
  const canvas = $('#composite');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = S.state?.dark ? '#000' : '#fff';
  ctx.fillRect(0, 0, width, height);
  const draw = async (part) => {
    if (!part) return;
    const img = new Image();
    img.src = part.dataURL;
    await img.decode();
    ctx.drawImage(img, part.bounds.x, part.bounds.y, part.bounds.width, part.bounds.height);
  };
  try { await draw(title); await draw(page); await draw(chrome); q.test.composited(id, canvas.toDataURL('image/png')); } catch { q.test.composited(id, null); }
});

// ----- Démarrage -----
q.state.onChange(async (s) => {
  const langChanged = S.state && s.lang !== S.state.lang;
  S.state = s;
  if (langChanged) S.cfg = await q.config();
  await syncChromeMode();
  render();
});
q.ui.onTheme(() => render());

installBarEvents();
installMenuEvents();
installTabsEvents();
installSheetEvents();

const [c, s] = await Promise.all([q.config(), q.state.get()]);
S.cfg = c;
S.state = s;
await syncChromeMode();
renderNow();
document.documentElement.classList.add('ready');
