// Exécution des actions du contrat (barre, menu, raccourcis) : chacune passe par l'API IPC window.qafila.
import { q, S, t, selectedTab, settings, setOverlay, toast, render } from './core.js';
import { beginEditing, openFind } from './bar.js';
import { openSheet } from './sheet.js';
import { openTabs } from './tabs.js';

/** État d'une action pour son icône et son libellé (actif / inactif). */
export function actionState() {
  const tab = selectedTab();
  return {
    loading: !!tab?.loading, bookmarked: !!tab?.bookmarked, blockerActive: tab ? tab.blockerActive !== false : true,
    javascript: tab ? tab.javascript !== false : true, desktop: !!tab?.desktop, darkened: !!tab?.darkened, reader: !!tab?.reader,
    dark: !!S.state?.dark, menuIcon: settings().menuIcon, canGoBack: !!tab?.canGoBack, canGoForward: !!tab?.canGoForward,
    isWeb: /^https?:/.test(tab?.url || ''),
  };
}

/** Une action « active » est dessinée dans la couleur d'accent (comme ActionGlyph sur iOS). */
export function isActive(id, st = actionState()) {
  return (id === 'darken' && st.darkened) || (id === 'desktopSite' && st.desktop && !settings().desktopByDefault)
    || (id === 'reader' && st.reader) || (id === 'addBookmark' && st.bookmarked);
}

// Actions qui n'ont de sens que sur une page web (pas sur la page de démarrage ni une page vide) : grisées ailleurs.
const WEB_ONLY = new Set(['share', 'copyLink', 'find', 'reader', 'desktopSite', 'blocker', 'javascript', 'translate', 'addBookmark']);

export function isEnabled(id, st = actionState()) {
  if (id === 'back') return st.canGoBack;
  if (id === 'forward') return st.canGoForward;
  if (WEB_ONLY.has(id)) return st.isWeb;
  return true;
}

/** Libellé d'une ligne du menu selon l'état (FloatingMenu.lineLabel). */
export function lineLabel(id, base) {
  const st = actionState();
  const n = S.state?.tabs.length || 0;
  switch (id) {
    case 'blocker': return st.blockerActive ? t('menu_blocker_off_here') : t('menu_blocker_on_here');
    case 'darken': return st.darkened ? t('menu_undarken') : t('menu_darken_site');
    case 'darkMode': return st.dark ? t('menu_light_mode') : base;
    case 'javascript': return st.javascript ? t('menu_js_off') : t('menu_js_on');
    case 'desktopSite': return st.desktop ? t('menu_mobile_version') : t('menu_desktop_version');
    case 'reader': return st.reader ? t('menu_exit_reader') : base;
    case 'addBookmark': return st.bookmarked ? t('menu_remove_bookmark') : base;
    case 'reload': return st.loading ? t('action_stop') : base;
    case 'closeAllTabs': return n > 1 ? t('close_n_tabs', n) : base;
    default: return base;
  }
}

/** Exécute une action ; ferme d'abord le menu s'il est ouvert. */
export async function perform(id) {
  const tab = selectedTab();
  if (S.overlay === 'menu' && id !== 'menu') await setOverlay('none');
  switch (id) {
    case 'back': return q.tabs.back();
    case 'forward': return q.tabs.forward();
    case 'reload': return tab?.loading ? q.tabs.stop() : q.tabs.reload();
    case 'stop': return q.tabs.stop();
    case 'tabs': return S.overlay === 'tabs' ? setOverlay('none') : openTabs();
    case 'newTab': await setOverlay('none'); return q.tabs.create({ isPrivate: false });
    case 'newPrivateTab': await setOverlay('none'); return q.tabs.create({ isPrivate: true });
    case 'closeTab': return q.tabs.close();
    case 'closeAllTabs': return q.tabs.closeAll({});
    case 'closeAllAndClear': await q.tabs.closeAll({}); await q.data.clear(); return toast(t('toast_data_cleared'));
    case 'reopenTab': { const r = await q.tabs.reopen(); if (!r) toast(t('toast_no_closed_tabs')); return r; }
    case 'bookmarks': return openSheet('bookmarks', true);
    case 'history': return openSheet('history', true);
    case 'addBookmark': { const r = await q.bookmarks.toggleCurrent(); if (r?.toast) toast(r.toast); return r; }
    case 'share': case 'copyLink': { const ok = await q.page.copyLink(); if (ok) toast(t('toast_address_copied')); return ok; }
    case 'find': return openFind();
    case 'blocker': return q.page.toggleBlocker();
    case 'darken': return q.page.toggleDarken();
    case 'reader': return q.page.toggleReader();
    case 'javascript': return q.page.toggleJavascript();
    case 'desktopSite': return q.page.toggleDesktop();
    case 'translate': return q.page.translate();
    case 'scrollTop': return q.page.scrollTo('top');
    case 'scrollBottom': return q.page.scrollTo('bottom');
    case 'home': return q.tabs.goHome();
    case 'settings': return openSheet('settings', true);
    case 'customize': return openSheet('editor', true);
    case 'menu': return setOverlay(S.overlay === 'menu' ? 'none' : 'menu');
    case 'address': case 'search': return beginEditing();
    case 'darkMode': return q.settings.set('appearance', S.state.dark ? 'light' : 'dark');
    default: render(); return null;
  }
}
