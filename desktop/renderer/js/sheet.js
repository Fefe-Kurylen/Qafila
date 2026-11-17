// Feuille plein cadre (style réglages iOS) : Réglages et leurs sous-pages, Galerie de barres, éditeur de la barre
// et du menu, Favoris, Historique. Chaque contrôle écrit un réglage par q.settings.set (validé côté principal).
import { q, S, $, $$, t, esc, actionLabel, action, settings, toolbar, selectedTab, BAR_COLORS, ACCENTS, setOverlay, onRender, render, toast, splitBar } from './core.js';
import { icon, actionIcon } from './icons.js';
import { rowHTML, addressCard } from './bar.js';
import { menuHTML } from './menu.js';

const local = { history: [], historyQuery: '', bookmarksQuery: '', confirmClear: false, adding: null, drag: null };

/** Ouvre une page ; `reset` = nouvelle pile (sinon la page s'empile, bouton Retour). */
export async function openSheet(page, reset = false) {
  if (reset || S.overlay !== 'sheet') S.sheet = [];
  S.sheet.push(page);
  local.adding = null;
  local.confirmClear = false;
  if (page === 'settings' || page === 'about') S.supportInfo = await q.support.info().catch(() => ({ configured: false }));
  if (page === 'history') await loadHistory();
  if (S.overlay !== 'sheet') await setOverlay('sheet'); else render();
  const body = $('#sheet-body');
  if (body) body.scrollTop = 0;
}

export function sheetBack() {
  if (S.sheet.length > 1) { S.sheet.pop(); local.adding = null; render(); return true; }
  setOverlay('none');
  return false;
}

async function loadHistory() { local.history = await q.history.list({ query: local.historyQuery, limit: 500 }).catch(() => []); }

// ----- Briques -----
const enc = (v) => esc(JSON.stringify(v));
function group(rows, { header, footer, cls = '' } = {}) {
  const r = rows.filter(Boolean);
  if (!r.length && !footer) return '';
  return `<div class="grp">${header ? `<div class="g-header">${esc(header)}</div>` : ''}${r.length ? `<div class="g-card ${cls}">${r.join('<div class="g-sep"></div>')}</div>` : ''}${footer ? `<div class="g-footer">${esc(footer)}</div>` : ''}</div>`;
}
function navRow(ic, label, value, page, extra = '') {
  return `<button class="s-row" data-nav="${page}" ${extra}>${ic ? `<span class="s-ic">${icon(ic, 20)}</span>` : ''}<span class="s-l">${esc(label)}</span>${value ? `<span class="s-v">${esc(value)}</span>` : ''}<span class="s-chev">${icon('chevronRight', 15)}</span></button>`;
}
function toggleRow(label, key, sub) {
  const on = !!settings()[key];
  return `<button class="s-row" data-toggle="${key}"><span class="s-l">${esc(label)}${sub ? `<span class="s-sub">${esc(sub)}</span>` : ''}</span><span class="switch${on ? ' on' : ''}"><span></span></span></button>`;
}
function segmented(key, options, value = settings()[key]) {
  return `<div class="s-row seg-row"><div class="seg">${options.map(([v, label, ic]) => `<button class="${v === value ? 'on' : ''}" data-set="${key}" data-v="${enc(v)}">${ic ? icon(ic, 16) : ''}<span>${esc(label)}</span></button>`).join('')}</div></div>`;
}
function labelledSegmented(label, key, options) {
  return `<div class="s-row split"><span class="s-l">${esc(label)}</span><div class="seg compact">${options.map(([v, l, ic]) => `<button class="${v === settings()[key] ? 'on' : ''}" data-set="${key}" data-v="${enc(v)}" title="${esc(l)}">${ic ? icon(ic, 16) : `<span>${esc(l)}</span>`}</button>`).join('')}</div></div>`;
}
function pickRows(key, options, value = settings()[key]) {
  return options.map(([v, label, sub]) => `<button class="s-row" data-set="${key}" data-v="${enc(v)}"><span class="s-l">${esc(label)}${sub ? `<span class="s-sub">${esc(sub)}</span>` : ''}</span>${v === value ? `<span class="s-check">${icon('check', 18)}</span>` : ''}</button>`);
}
function textRow(key, placeholder) {
  return `<div class="s-row"><input class="s-input" data-text="${key}" type="text" value="${esc(settings()[key] || '')}" placeholder="${esc(placeholder)}" spellcheck="false" dir="ltr"></div>`;
}
function hostList(key, emptyText) {
  const list = settings()[key] || [];
  if (!list.length) return [`<div class="s-row muted"><span class="s-l">${esc(emptyText)}</span></div>`];
  return list.map((h) => `<div class="s-row"><span class="s-l" dir="ltr">${esc(h)}</span><button class="s-x" data-unhost="${key}" data-v="${enc(h)}" title="${esc(t('remove'))}">${icon('xmarkCircle', 18)}</button></div>`);
}
function buttonRow(label, doId, { red = false, center = false } = {}) {
  return `<button class="s-row${red ? ' red' : ''}${center ? ' center' : ''}" data-do="${doId}"><span class="s-l">${esc(label)}</span></button>`;
}
function swatches(key, list) {
  const v = settings()[key];
  return `<div class="swatches">${list.map(([val, label, css]) => `<button class="sw${val === v ? ' on' : ''}" data-set="${key}" data-v="${enc(val)}"><span class="dot" style="${css}">${val === 'auto' ? esc(t('bar_auto_letter')) : ''}</span><span class="cap">${esc(label)}</span></button>`).join('')}</div>`;
}
function slider(key, min, max, step, value, fmt) {
  return `<div class="s-row slider-row"><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="${key}" data-scale="${key === 'glassTransparency' ? 100 : 1}"><span class="s-v" data-range-label="${key}">${esc(fmt(value))}</span></div>`;
}

const demoTab = () => {
  const tab = selectedTab();
  if (tab?.url) return tab;
  // Onglet fictif quand l'onglet courant est la page de démarrage (aucun texte en dur : le nom de l'application).
  return { host: 'qafila.fr', title: t('app_name'), url: 'https://qafila.fr', readingMinutes: 4 };
};

/** Aperçu en direct : fausse page et barre (ou une configuration de barre donnée). */
function preview(bar = toolbar().bar, { menu = false, sticky = false } = {}) {
  const tb = toolbar();
  const top = tb.position !== 'bottom';
  const count = S.state.tabs.filter((x) => !x.isPrivate).length;
  return `<div class="preview ${top ? 'top' : 'bottom'} pv-${tb.style || 'floating'}${menu ? ' with-menu' : ''}${sticky ? ' sticky' : ''}">
    <div class="pv-page"><i class="h"></i><i></i><i></i><i class="s"></i><i></i><i></i><i class="s"></i></div>
    <div class="pv-bar${splitBar() ? ' split' : ''}"><div class="pv-tint"></div>${rowHTML(bar, { preview: true, tab: demoTab(), count })}</div>
    ${menu ? `<div class="pv-menu card-glass">${menuHTML(tb.menu)}</div>` : ''}
  </div>`;
}

// ----- Pages -----
const P = {};

P.settings = () => {
  const s = settings();
  const sup = S.supportInfo?.configured;
  const lang = s.language ? t('lang_' + s.language) : t('language_system');
  return {
    title: actionLabel('settings'), root: true,
    body: group([
      navRow('grid', t('page_gallery'), '', 'gallery'),
      sup
        ? `<button class="s-row" data-do="support"><span class="s-ic heart">${icon('heart', 20)}</span><span class="s-l">${esc(t('page_support'))}</span><span class="s-chev">${icon('external', 16)}</span></button>`
        : `<div class="s-row disabled" aria-disabled="true"><span class="s-ic heart">${icon('heart', 20)}</span><span class="s-l">${esc(t('page_support'))}</span><span class="s-v">${esc(t('support_coming_soon'))}</span></div>`,
    ], { footer: sup ? t('support_desktop_pitch') : '' }) + group([
      navRow('circleHalf', t('page_appearance'), t('appearance_' + (s.appearance || 'system')), 'appearance'),
      navRow('toolbarIcon', t('page_toolbar'), t(s.toolbar?.position === 'bottom' ? 'position_bottom' : 'position_top'), 'toolbar'),
      navRow('link', t('page_address'), addressStyleLabel(s.addressStyle), 'address'),
      navRow('squares', t('action_tabs'), t(s.tabsLayout === 'grid' ? 'layout_grid' : 'layout_list'), 'tabsSettings'),
    ]) + group([
      navRow('search', t('page_search'), t('engine_' + (s.searchEngine || 'google')), 'search'),
      navRow('shieldHalf', t('page_privacy'), '', 'privacy'),
      navRow('puzzle', t('extensions'), String(S.state.extensions?.list?.length || ''), 'extensions'),
      navRow('reader', t('page_reading'), t('percent', s.textZoom || 100), 'reading'),
      navRow('download', t('downloads'), S.state.downloads?.active ? t('percent', Math.round((S.state.downloads.progress || 0) * 100)) : '', 'downloads'),
      navRow('globe', t('language'), lang, 'language'),
    ]) + group([navRow('info', t('page_about'), '', 'about')]),
  };
};

const ADDRESS_STYLES = [['card', 'address_card'], ['fullURL', 'address_full'], ['domainPill', 'address_centered'], ['titleReading', 'address_title_read'], ['centered', 'address_plain'], ['hidden', 'address_hidden']];
function addressStyleLabel(v) { const e = ADDRESS_STYLES.find((x) => x[0] === v); return e ? t(e[1]) : ''; }

const sizeOptions = () => [['small', t('ui_size_small')], ['medium', t('ui_size_medium')], ['large', t('ui_size_large')]];

P.appearance = () => {
  const s = settings();
  const style = s.toolbar?.style || 'floating';
  const accents = Object.entries(ACCENTS).map(([k, rgb]) => [k, t('accent_' + k), `background:${rgb ? `rgb(${rgb})` : 'var(--text)'}`]);
  const bars = [['auto', t('bar_auto'), 'background:conic-gradient(from 200deg,#ff5f6d,#ffc371,#47e891,#3fa7ff,#a875ff,#ff5f6d)']]
    .concat(Object.entries(BAR_COLORS).map(([k, rgb]) => [k, t({ white: 'bar_white', mist: 'bar_light_grey', lilac: 'bar_lilac', blush: 'bar_pink', slate: 'bar_slate', graphite: 'bar_graphite', black: 'bar_black' }[k]), `background:rgb(${rgb})`]));
  const tr = Math.round((Number(s.glassTransparency) || 0) * 100);
  return {
    title: t('page_appearance'),
    // Aperçu collant : la barre reste visible pendant le réglage des couleurs, du style et de la transparence.
    body: preview(undefined, { sticky: true })
      + group([segmented('appearance', [['system', t('appearance_system')], ['light', t('appearance_light')], ['dark', t('appearance_dark')]])], { header: t('theme') })
      + group([swatches('accent', accents)], { header: t('accent_color') })
      + group([swatches('barColorLight', bars)], { header: t('bar_color_light'), footer: t('bar_auto_light_desc') })
      + group([swatches('barColorDark', bars)], { header: t('bar_color_dark'), footer: t('bar_auto_dark_desc') })
      + group([`<div class="s-row seg-row"><div class="seg">${[['classic', 'style_classic'], ['glass', 'style_glass'], ['floating', 'style_floating']].map(([v, k]) => `<button class="${v === style ? 'on' : ''}" data-tbset="style" data-v="${enc(v)}"><span>${esc(t(k))}</span></button>`).join('')}</div></div>`], { header: t('bar_style'), footer: t('bar_style_footer') })
      + group([toggleRow(t('bookmarks_bar'), 'showBookmarksBar', t('bookmarks_bar_sub'))])
      + group([
        labelledSegmented(t('size_address_bar'), 'barSize', sizeOptions()),
        S.cfg.app.platform === 'win32' ? labelledSegmented(t('size_title_bar'), 'titleBarSize', sizeOptions()) : '',
        s.showBookmarksBar !== false ? labelledSegmented(t('bookmarks_bar'), 'bookmarksBarSize', sizeOptions()) : '',
      ], { header: t('sizes') })
      + (style === 'classic' ? '' : group([slider('glassTransparency', 0, 100, 1, tr, (v) => t('percent', v))], { header: t('transparency'), footer: t('transparency_footer') })),
  };
};

P.toolbar = () => {
  const s = settings();
  const pos = s.toolbar?.position || 'top';
  return {
    title: t('page_toolbar'),
    body: preview()
      + group([navRow('sliders', t('customize_bar_menu'), '', 'editor'), navRow('grid', t('page_gallery'), '', 'gallery')])
      + group([`<div class="s-row seg-row"><div class="seg">${[['top', 'position_top'], ['bottom', 'position_bottom']].map(([v, k]) => `<button class="${v === pos ? 'on' : ''}" data-tbset="position" data-v="${enc(v)}"><span>${esc(t(k))}</span></button>`).join('')}</div></div>`], { header: t('position') })
      + group([labelledSegmented(t('bar_layout'), 'barLayout', [['one', t('bar_layout_one')], ['split', t('bar_layout_split')]])], { footer: t('bar_layout_footer') })
      // Au défilement (comme sur mobile) : Fixe garde la barre entière ; Réduire ne laisse que le domaine ; Masquer la retire.
      + group([segmented('scrollBehavior', [['fixed', t('scroll_fixed')], ['shrink', t('scroll_shrink')], ['hide', t('scroll_hide')]], s.scrollBehavior || 'fixed')], { header: t('on_scroll'), footer: t('scroll_desktop_footer') })
      + group([segmented('buttonWeight', [['thin', t('weight_thin')], ['regular', t('weight_regular')], ['bold', t('weight_bold')]])], { header: t('icon_weight') })
      + group([segmented('menuIcon', [['dots', t('menu_icon_dots'), 'dots'], ['dotsCircle', t('menu_icon_dots_circle'), 'dotsCircle'], ['linesCircle', t('menu_icon_lines_circle'), 'linesCircle']])], { header: t('menu_icon') })
      + group([buttonRow(t('reset_bar_menu'), 'resetToolbar', { red: true })]),
  };
};

P.address = () => {
  const s = settings();
  const tab = demoTab();
  const rows = ADDRESS_STYLES.map(([v, k]) => `<div class="s-row tall clickable" role="button" tabindex="0" data-set="addressStyle" data-v="${enc(v)}">
      <span class="s-l">${esc(t(k))}<span class="s-sub">${esc(t(k + '_desc'))}</span></span>
      <span class="addr-pv pv-${toolbar().style || 'floating'}">${v === 'hidden' ? '' : addressCard(tab, { preview: true, style: v })}</span>
      <span class="s-check">${v === s.addressStyle ? icon('check', 18) : ''}</span></div>`);
  return {
    title: t('page_address'),
    body: preview()
      + group(rows, { header: t('style') })
      + group([toggleRow(t('show_favicon'), 'addressShowsFavicon'), toggleRow(t('show_reading_time'), 'addressShowsReadingTime')], { header: t('content') })
      + group([segmented('addressTap', [['edit', t('tap_edit_address')], ['menu', t('tap_open_menu')]])], { header: t('address_tap') })
      + group([segmented('addressLongPress', [['menu', t('tap_open_menu')], ['copy', t('long_press_copy')], ['none', t('nothing')]])], { header: t('address_long_press'), footer: t('long_press_footer') }),
  };
};

P.tabsSettings = () => {
  const s = settings();
  return {
    title: t('action_tabs'),
    body: group([segmented('tabsLayout', [['list', t('layout_list'), 'list'], ['grid', t('layout_grid'), 'grid']])], { header: t('layout') })
      + group([segmented('thumbnailSize', [['large', t('grid_large')], ['small', t('grid_small')]])], { header: t('thumbnails') })
      + group(pickRows('tabsSort', [['date', t('sort_date')], ['readingTime', t('sort_reading_time')], ['title', t('sort_title')]]), { header: t('sort_by') })
      + group([toggleRow(t('group_by_site'), 'groupTabsByDomain')])
      + group(pickRows('newTabPage', [['start', t('newtab_start')], ['search', t('newtab_search')], ['blank', t('newtab_blank')], ['custom', t('newtab_custom')]])
        .concat(s.newTabPage === 'custom' ? [textRow('newTabCustomURL', 'https://')] : []), { header: t('new_tab_opens') })
      + group(pickRows('autoCloseTabs', [['never', t('autoclose_never')], ['day', t('autoclose_day')], ['week', t('autoclose_week')], ['month', t('autoclose_month')]]), { header: t('auto_close_tabs'), footer: t('auto_close_footer') }),
  };
};

P.search = () => {
  const s = settings();
  const engines = (S.cfg.settingsKeys?.enums?.SearchEngine?.values || Object.keys(S.cfg.engines || {}));
  const extra = [];
  if (s.searchEngine === 'searxng' || s.searchEngine === 'qafila') extra.push(textRow('searchBaseURL', 'https://'));
  if (s.searchEngine === 'custom') extra.push(textRow('customSearchTemplate', 'https://example.com/?q=%s'));
  return {
    title: t('page_search'),
    body: group(pickRows('searchEngine', engines.map((e) => [e, t('engine_' + e)])).concat(extra), { header: t('search_engine'), footer: s.searchEngine === 'custom' ? t('custom_search_footer') : '' })
      + group([segmented('suggestions', [['everywhere', t('suggest_everywhere')], ['notPrivate', t('suggest_not_private')], ['never', t('autoclose_never')]])], { header: t('suggestions'), footer: t('suggestions_footer') })
      + group([toggleRow(t('hide_ai'), 'hideAIAnswers')], { footer: t('hide_ai_footer') }),
  };
};

P.privacy = () => ({
  title: t('page_privacy_security'),
  body: group([toggleRow(t('block_ads'), 'blockAds'), toggleRow(t('block_trackers'), 'blockTrackers'), toggleRow(t('hide_cookie_banners'), 'blockCookieBanners')])
    + group(hostList('blockerDisabledHosts', t('blocker_off_empty', t('menu_blocker_off_here'))), { header: t('blocker_off_sites') })
    + group([toggleRow(t('javascript'), 'javascriptEnabled')].concat(hostList('javascriptDisabledHosts', t('js_off_empty'))), { header: t('javascript') })
    + group([navRow('hand', t('site_permissions'), String(Object.keys(S.state.sitePermissions || {}).length || ''), 'sitePermissions')])
    + group([toggleRow(t('upgrade_https'), 'upgradeToHTTPS')], { header: t('security') })
    + group([buttonRow(local.confirmClear ? t('tap_again_to_clear') : t('clear_history_data'), 'clearData', { red: true }), toggleRow(t('clear_on_close_all'), 'clearDataOnCloseAll')], { header: t('data') })
    + group([textRow('customUserAgent', t('custom_user_agent'))], { header: t('advanced'), footer: t('privacy_footer') }),
});

/** Extensions Chrome : installées depuis le Chrome Web Store ; options et suppression. */
P.extensions = () => {
  const x = S.state.extensions || { ready: false, list: [] };
  const rows = x.list.map((e) => `<div class="s-row ext-row"><img class="ext-ic" src="${esc(e.icon)}" alt=""><span class="s-l">${esc(e.name)}<span class="s-sub">${esc(t('version_n', e.version))}${e.description ? ' · ' + esc(e.description) : ''}</span></span>${e.hasOptions ? `<button class="s-x" data-extopt="${esc(e.id)}" title="${esc(t('ext_options'))}">${icon('sliders', 18)}</button>` : ''}<button class="s-x" data-extrm="${esc(e.id)}" title="${esc(t('ext_remove'))}">${icon('trash', 18)}</button></div>`);
  return {
    title: t('extensions'),
    body: group([`<button class="s-row center" data-do="extStore"><span class="s-ic">${icon('plus', 18)}</span><span class="s-l">${esc(t('ext_add'))}</span></button>`], { footer: t('ext_add_footer') })
      + group(rows.length ? rows : [`<div class="s-row muted"><span class="s-l">${esc(x.ready ? t('ext_none') : t('ext_loading'))}</span></div>`], { header: t('ext_installed'), footer: t('ext_private_footer') }),
  };
};

/** Autorisations mémorisées par site (caméra, micro, position, notifications…). */
P.sitePermissions = () => {
  const all = S.state.sitePermissions || {};
  const hosts = Object.keys(all).sort();
  const rows = hosts.map((h) => {
    const perms = Object.entries(all[h]).map(([k, v]) => `<span class="perm ${v}">${esc(t('perm_' + k))} ${v === 'allow' ? '✓' : '✕'}</span>`).join('');
    return `<div class="s-row"><span class="s-l" dir="ltr">${esc(h)}<span class="s-sub perms">${perms}</span></span><button class="s-x" data-unperm="${enc(h)}" title="${esc(t('perm_reset_site'))}">${icon('xmarkCircle', 18)}</button></div>`;
  });
  return {
    title: t('site_permissions'),
    body: group(rows.length ? rows : [`<div class="s-row muted"><span class="s-l">${esc(t('perm_none'))}</span></div>`], { footer: t('perm_footer') })
      + (rows.length ? group([buttonRow(t('perm_reset_all'), 'resetPerms', { red: true, center: true })]) : ''),
  };
};

P.reading = () => {
  const s = settings();
  const z = Number(s.textZoom) || 100;
  const langs = S.cfg.settingsKeys?.enums?.TranslateLanguage?.values || ['fr', 'en', 'ar', 'es', 'de', 'it', 'pt'];
  return {
    title: t('page_reading'),
    body: group([toggleRow(t('darken_all'), 'darkenSites'), toggleRow(t('darken_only_dark'), 'darkenOnlyInDarkMode')])
      + group(hostList('darkenHosts', t('darken_empty', t('menu_darken_site'))), { header: s.darkenSites ? t('never_darkened') : t('always_darkened') })
      + group([slider('textZoom', 80, 150, 10, z, (v) => t('percent', v)), `<div class="s-row sample" style="font-size:${(15 * z / 100).toFixed(1)}px">${esc(t('text_size_sample'))}</div>`], { header: t('text_size') })
      + group(pickRows('translateLanguage', langs.map((l) => [l, t('lang_' + l)])), { header: t('translation_language') })
      + group([toggleRow(t('desktop_by_default'), 'desktopByDefault')])
      + group(hostList('desktopHosts', t('desktop_empty', t('menu_desktop_version'))), { header: s.desktopByDefault ? t('mobile_sites') : t('desktop_sites') }),
  };
};

P.downloads = () => {
  const d = S.state.downloads || {};
  const custom = !!settings().downloadFolder;
  return {
    title: t('downloads'),
    body: group([`<div class="s-row"><span class="s-ic">${icon('folder', 20)}</span><span class="s-l path" dir="ltr">${esc(d.folder || '')}</span></div>`,
      buttonRow(t('choose_folder'), 'chooseDownloads'), custom ? buttonRow(t('use_system_folder'), 'resetDownloads') : null], { header: t('downloads_folder'), footer: t('downloads_footer') })
      + group([`<button class="s-row" data-do="openDownloads"><span class="s-l">${esc(t('show_downloads'))}</span><span class="s-chev">${icon('external', 16)}</span></button>`]),
  };
};

P.language = () => ({
  title: t('language'),
  body: group(pickRows('language', [['', t('language_system')], ['fr', t('lang_fr')], ['en', t('lang_en')], ['ar', t('lang_ar')], ['es', t('lang_es')], ['de', t('lang_de')]])),
});

/**
 * Raccourcis affichés : mêmes touches que main/shortcuts.js. « M » = touche de commande : ⌘ sous macOS (⇧⌘N…,
 * ⌘Y pour l'historique, ⌘[ / ⌘] pour Précédent / Suivant), sinon Ctrl dans la langue du clavier (« Strg » en allemand).
 * Onglet suivant / précédent (Ctrl+Tab, ⇧⌘] / ⇧⌘[) : pas d'action correspondante dans le contrat, non listés.
 */
function shortcutList(mac) {
  const list = [
    ['M+T', 'newTab'], ['M+Shift+N', 'newPrivateTab'], ['M+W', 'closeTab'], ['M+Shift+T', 'reopenTab'], [mac ? 'M+L' : 'M+L · Alt+D · F6', 'search'],
    ['M+R · F5', 'reload'], ['M+F', 'find'], ['M+D', 'addBookmark'], [mac ? 'M+Y' : 'M+H', 'history'], ['M+Shift+B', 'bookmarks'],
    ['M+Shift+A', 'tabs'], ['M+,', 'settings'], [mac ? 'M+[' : 'Alt+←', 'back'], [mac ? 'M+]' : 'Alt+→', 'forward'],
  ];
  const fmt = (k) => (mac ? k.replace(/M\+Shift\+/g, '⇧⌘').replace(/M\+/g, '⌘') : k.replace(/M\+/g, t('kbd_ctrl') + '+'));
  return list.map(([k, id]) => [fmt(k), id]);
}
/** Mises à jour (page À propos) : état, réglage automatique, bouton d'action. */
function updatesGroup() {
  const u = S.state?.update || { status: 'disabled' };
  const v = u.version || '';
  const status = {
    disabled: t('update_status_disabled'), idle: t('update_status_idle'), checking: t('update_status_checking'),
    none: t('update_status_none'), available: t('update_status_available', v), ready: t('update_status_ready', v),
    downloading: t('update_status_downloading', u.percent ?? 0), error: t('update_status_error'),
  }[u.status] || '';
  const rows = [`<div class="s-row"><span class="s-ic">${icon('update', 20)}</span><span class="s-l">${esc(t('update_state'))}</span><span class="s-v">${esc(status)}</span></div>`];
  if (u.status !== 'disabled') {
    rows.push(toggleRow(t('update_auto'), 'autoUpdate', t('update_auto_sub')));
    if (u.status === 'ready') rows.push(buttonRow(t('update_install'), 'installUpdate', { center: true }));
    else if (u.manual && u.status === 'available') rows.push(buttonRow(t('update_download'), 'installUpdate', { center: true }));
    else if (!['checking', 'downloading'].includes(u.status)) rows.push(buttonRow(t('update_check'), 'checkUpdate', { center: true }));
  }
  return group(rows, { header: t('updates'), footer: u.status === 'disabled' ? '' : t('update_footer') });
}

P.about = () => {
  const a = S.cfg.app;
  return {
    title: t('page_about'),
    body: `<div class="about-head"><div class="serif">Qafila</div></div>`
      + group([`<div class="s-row"><span class="s-l">${esc(t('version'))}</span><span class="s-v">${esc(a.version)}</span></div>`,
        `<div class="s-row"><span class="s-l">${esc(t('engine_label'))}</span><span class="s-v">${esc(t('about_engine_desktop', a.electron, a.chrome))}</span></div>`], { footer: t('about_privacy') })
      + updatesGroup()
      + group([`<button class="s-row" data-do="source"><span class="s-l">${esc(t('source_code'))}</span><span class="s-chev">${icon('external', 16)}</span></button>`])
      + group(shortcutList(a.platform === 'darwin').map(([k, id]) => `<div class="s-row"><span class="s-ic">${icon(actionIcon(id, {}), 18)}</span><span class="s-l">${esc(actionLabel(id))}</span><span class="kbd" dir="ltr">${esc(k)}</span></div>`), { header: t('shortcuts') }),
  };
};

P.gallery = () => {
  const tb = toolbar();
  const presets = S.cfg.actions.presets;
  const body = presets.map((p) => {
    const bar = p.bar.map((a) => ({ action: a, size: 'medium', showsLabel: true }));
    const on = tb.preset === p.id;
    return `<div class="preset${on ? ' on' : ''}" role="button" tabindex="0" data-preset="${p.id}">
      <div class="preset-head"><span class="preset-t">${esc(t('preset_' + p.id))}</span>${on ? `<span class="preset-check">${icon('checkCircle', 24)}</span>` : ''}</div>
      <div class="preset-d">${esc(t('preset_' + p.id + '_desc'))}</div>
      <div class="preset-bar pv-${tb.style || 'floating'}${splitBar() ? ' split' : ''}"><div class="pv-tint"></div>${rowHTML(bar, { preview: true, tab: demoTab() })}</div>
    </div>`;
  }).join('');
  return { title: t('page_gallery'), body: `<div class="g-footer top">${esc(t('gallery_footer'))}</div>${body}<div class="g-footer">${esc(t('gallery_kept'))}</div>` };
};

// ----- Éditeur de la barre et du menu -----
function editorRow(list, i, slot) {
  const id = slot.action;
  const label = actionLabel(id);
  const ic = icon(actionIcon(id, { menuIcon: settings().menuIcon }), 18);
  const red = action(id)?.destructive ? ' red' : '';
  let ctl = '';
  if (list === 'bar' && id !== 'address' && id !== 'separator') {
    ctl = `<div class="seg compact">${[['small', 'size_small'], ['medium', 'size_medium'], ['large', 'size_large']].map(([v, k]) => `<button class="${slot.size === v ? 'on' : ''}" data-size="${i}" data-v="${v}" title="${esc(t(k))}"><span>${esc(t(k).slice(0, 1))}</span></button>`).join('')}</div>`;
  } else if (list === 'menu' && id !== 'separator') {
    ctl = `<div class="seg compact">${[[false, 'tile'], [true, 'row_with_label']].map(([v, k]) => `<button class="${(slot.showsLabel !== false) === v ? 'on' : ''}" data-label="${i}" data-v="${v}"><span>${esc(t(k))}</span></button>`).join('')}</div>`;
  }
  return `<div class="s-row ed-row${red}" draggable="true" data-drag="${list}" data-i="${i}"><span class="grip">${icon('grip', 16)}</span><span class="s-ic">${ic}</span><span class="s-l">${esc(label)}</span>${ctl}<button class="s-x" data-remove="${list}" data-i="${i}" title="${esc(t('remove'))}">${icon('xmarkCircle', 18)}</button></div>`;
}

function addPicker(list) {
  const shipped = S.cfg.actions.actions.filter((a) => a.status === 'shipped' && a.platforms.includes('desktop'));
  const cur = new Set((toolbar()[list] || []).map((s) => s.action));
  const avail = shipped.filter((a) => (list === 'menu' ? !['menu', 'address'].includes(a.id) : true) && (a.id === 'separator' || !cur.has(a.id)));
  return `<div class="add-grid">${avail.map((a) => `<button class="add-item" data-add="${list}" data-v="${a.id}">${icon(actionIcon(a.id, { menuIcon: settings().menuIcon }), 18)}<span>${esc(actionLabel(a.id))}</span></button>`).join('')}</div>`;
}

P.editor = () => {
  const tb = toolbar();
  const bar = (tb.bar || []).map((s, i) => editorRow('bar', i, s));
  const menu = (tb.menu || []).map((s, i) => editorRow('menu', i, s));
  const addRow = (list) => `<button class="s-row add" data-adding="${list}"><span class="s-ic">${icon('plus', 18)}</span><span class="s-l">${esc(t('add'))}</span></button>`;
  return {
    title: actionLabel('customize'),
    body: preview(tb.bar, { menu: true })
      + group(bar.concat([local.adding === 'bar' ? addPicker('bar') : addRow('bar')]), { header: t('editor_bar'), footer: t('editor_bar_footer', actionLabel('address')) })
      + group(menu.concat([local.adding === 'menu' ? addPicker('menu') : addRow('menu')]), { header: actionLabel('menu'), footer: t('editor_menu_footer') })
      + group([buttonRow(t('reset_bar_menu'), 'resetToolbar', { red: true })]),
  };
};

async function saveToolbar(patch) {
  const tb = toolbar();
  await q.settings.set('toolbar', { bar: tb.bar, menu: tb.menu, style: tb.style, position: tb.position, ...patch });
}

// ----- Favoris et historique -----
P.bookmarks = () => {
  const qy = local.bookmarksQuery.trim().toLowerCase();
  const list = S.state.bookmarks.filter((b) => !qy || b.title.toLowerCase().includes(qy) || b.url.toLowerCase().includes(qy));
  const rows = list.map((b) => {
    const host = hostOf(b.url);
    return `<div class="s-row link" role="button" tabindex="0" data-open="${esc(b.url)}">${faviconLetter(host)}<span class="s-l">${esc(b.title || host)}<span class="s-sub" dir="ltr">${esc(host)}</span></span><button class="s-x" data-unbookmark="${esc(b.id)}" title="${esc(t('delete'))}">${icon('xmarkCircle', 18)}</button></div>`;
  });
  return {
    title: actionLabel('bookmarks'), root: true,
    body: `<label class="t-search">${icon('search', 17)}<input data-search="bookmarksQuery" type="search" placeholder="${esc(t('search_bookmarks'))}" value="${esc(local.bookmarksQuery)}"></label>`
      + (rows.length ? group(rows) : `<div class="t-empty">${esc(t('no_bookmarks'))}</div>`),
  };
};

P.history = () => {
  const days = new Map();
  const fmt = new Intl.DateTimeFormat(S.state.lang, { weekday: 'long', day: 'numeric', month: 'long' });
  const tf = new Intl.DateTimeFormat(S.state.lang, { hour: '2-digit', minute: '2-digit' });
  for (const h of local.history) { const k = fmt.format(new Date(h.visitedAt)); if (!days.has(k)) days.set(k, []); days.get(k).push(h); }
  let body = `<label class="t-search">${icon('search', 17)}<input data-search="historyQuery" type="search" placeholder="${esc(t('search_history'))}" value="${esc(local.historyQuery)}"></label>`;
  if (!local.history.length) body += `<div class="t-empty">${esc(t('no_history'))}</div>`;
  for (const [day, list] of days) {
    body += group(list.map((h) => {
      const host = hostOf(h.url);
      return `<div class="s-row link" role="button" tabindex="0" data-open="${esc(h.url)}">${faviconLetter(host)}<span class="s-l">${esc(h.title || host)}<span class="s-sub" dir="ltr">${esc(host)}</span></span><span class="s-v">${esc(tf.format(new Date(h.visitedAt)))}</span><button class="s-x" data-unhistory="${esc(h.id)}" title="${esc(t('delete'))}">${icon('xmarkCircle', 18)}</button></div>`;
    }), { header: day });
  }
  if (local.history.length) body += group([buttonRow(t('clear'), 'clearHistory', { red: true, center: true })]);
  return { title: actionLabel('history'), root: true, body };
};

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function faviconLetter(host) {
  const labels = String(host || 'q').split('.');
  const name = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return `<span class="fav" style="width:26px;height:26px;border-radius:6px;font-size:14px">${esc((name || 'q').slice(0, 1).toUpperCase())}</span>`;
}

// ----- Rendu -----
function renderSheet() {
  const el = $('#sheet');
  const open = S.overlay === 'sheet' && S.sheet.length;
  el.hidden = !open;
  if (!open) return;
  const page = S.sheet[S.sheet.length - 1];
  const def = (P[page] || P.settings)();
  const sub = S.sheet.length > 1;
  const focused = document.activeElement?.dataset?.search || document.activeElement?.dataset?.text;
  const caret = document.activeElement?.selectionStart;
  const scroll = $('#sheet-body')?.scrollTop || 0;
  el.innerHTML = `<div class="sheet-card" role="dialog" aria-label="${esc(def.title)}">
    <div class="sheet-head">
      ${sub ? `<button class="round" data-sheet="back" title="${esc(t('back'))}">${icon('chevronLeft', 20)}</button>` : '<span class="round-sp"></span>'}
      <div class="sheet-title">${esc(def.title)}</div>
      <button class="pill-btn" data-sheet="done">${esc(t('done'))}</button>
    </div>
    <div class="sheet-body" id="sheet-body">${def.body}</div></div>`;
  const body = $('#sheet-body');
  body.scrollTop = scroll;
  if (focused) {
    const i = el.querySelector(`[data-search="${focused}"], [data-text="${focused}"]`);
    if (i) { i.focus(); try { i.setSelectionRange(caret, caret); } catch { /* champ sans sélection */ } }
  }
}
onRender(renderSheet);

// ----- Événements -----
export function installSheetEvents() {
  const el = $('#sheet');
  el.addEventListener('click', async (e) => {
    const g = (sel) => e.target.closest(sel);
    let b;
    if ((b = g('[data-sheet]'))) { if (b.dataset.sheet === 'back') sheetBack(); else setOverlay('none'); return; }
    if ((b = g('[data-nav]'))) { openSheet(b.dataset.nav); return; }
    if ((b = g('[data-toggle]'))) { const k = b.dataset.toggle; await q.settings.set(k, !settings()[k]); return; }
    if ((b = g('[data-set]'))) { await q.settings.set(b.dataset.set, JSON.parse(b.dataset.v)); return; }
    if ((b = g('[data-tbset]'))) { await saveToolbar({ [b.dataset.tbset]: JSON.parse(b.dataset.v), preset: toolbar().preset }); return; }
    if ((b = g('[data-extrm]'))) { await q.extensions.remove(b.dataset.extrm); return; }
    if ((b = g('[data-extopt]'))) { await q.extensions.options(b.dataset.extopt); setOverlay('none'); return; }
    if ((b = g('[data-unperm]'))) { await q.permissions.reset(JSON.parse(b.dataset.unperm)); return; }
    if ((b = g('[data-unhost]'))) { const k = b.dataset.unhost; const v = JSON.parse(b.dataset.v); await q.settings.set(k, (settings()[k] || []).filter((h) => h !== v)); return; }
    if ((b = g('[data-preset]'))) { await q.settings.applyPreset(b.dataset.preset); return; }
    if ((b = g('[data-unbookmark]'))) { e.stopPropagation(); await q.bookmarks.remove(b.dataset.unbookmark); return; }
    if ((b = g('[data-unhistory]'))) { e.stopPropagation(); await q.history.remove(b.dataset.unhistory); await loadHistory(); render(); return; }
    if ((b = g('[data-open]'))) { await q.tabs.navigate(b.dataset.open); setOverlay('none'); return; }
    if ((b = g('[data-adding]'))) { local.adding = b.dataset.adding; render(); return; }
    if ((b = g('[data-add]'))) {
      const list = b.dataset.add;
      const id = b.dataset.v;
      const entry = { action: id, size: 'medium', showsLabel: list === 'menu' ? !['back', 'forward', 'reload'].includes(id) : true };
      local.adding = null;
      await saveToolbar({ [list]: [...(toolbar()[list] || []), entry] });
      return;
    }
    if ((b = g('[data-remove]'))) { const list = b.dataset.remove; const arr = [...toolbar()[list]]; arr.splice(Number(b.dataset.i), 1); await saveToolbar({ [list]: arr }); return; }
    if ((b = g('[data-size]'))) { const arr = toolbar().bar.map((x) => ({ ...x })); arr[Number(b.dataset.size)].size = b.dataset.v; await saveToolbar({ bar: arr }); return; }
    if ((b = g('[data-label]'))) { const arr = toolbar().menu.map((x) => ({ ...x })); arr[Number(b.dataset.label)].showsLabel = b.dataset.v === 'true'; await saveToolbar({ menu: arr }); return; }
    if ((b = g('[data-do]'))) {
      const d = b.dataset.do;
      if (d === 'support') { if (!(await q.support.open())) toast(t('support_open_failed')); else setOverlay('none'); return; }
      if (d === 'chooseDownloads') { await q.downloads.chooseFolder(); return; }
      if (d === 'resetDownloads') { await q.downloads.resetFolder(); return; }
      if (d === 'openDownloads') { await q.downloads.openFolder(); return; }
      if (d === 'installUpdate') { await q.update.install(); return; }
      if (d === 'checkUpdate') {
        const r = await q.update.check().catch(() => null);
        if (r?.status === 'none') toast(t('update_toast_none'));
        else if (r?.status === 'error') toast(t('update_status_error'));
        return;
      }
      if (d === 'source') { q.openExternal('https://github.com/Fefe-Kurylen/qafila'); return; }
      if (d === 'resetToolbar') { await q.settings.applyPreset('complete'); toast(t('reset_bar_menu')); return; }
      if (d === 'extStore') { await q.extensions.openStore(); setOverlay('none'); return; }
      if (d === 'resetPerms') { await q.permissions.reset(null); return; }
      if (d === 'clearHistory') { await q.history.clear(); await loadHistory(); render(); return; }
      if (d === 'clearData') {
        if (!local.confirmClear) { local.confirmClear = true; render(); setTimeout(() => { local.confirmClear = false; render(); }, 3000); return; }
        local.confirmClear = false;
        await q.data.clear();
        toast(t('toast_data_cleared'));
        render();
      }
    }
  });
  // Clic sur le voile autour de la feuille : fermeture.
  el.addEventListener('mousedown', (e) => { if (e.target === el) setOverlay('none'); });
  el.addEventListener('input', async (e) => {
    const d = e.target.dataset;
    if (d.range) {
      const scale = Number(d.scale) || 1;
      const v = Number(e.target.value);
      const lab = el.querySelector(`[data-range-label="${d.range}"]`);
      if (lab) lab.textContent = t('percent', v);
      clearTimeout(rangeTimer);
      rangeTimer = setTimeout(() => q.settings.set(d.range, v / scale), 40);
    }
    if (d.search) { local[d.search] = e.target.value; if (d.search === 'historyQuery') await loadHistory(); render(); }
  });
  el.addEventListener('change', (e) => { const d = e.target.dataset; if (d.text) q.settings.set(d.text, e.target.value.trim()); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.text) e.target.blur();
    // Éléments « bouton » qui ne peuvent pas être des <button> (ils contiennent des aperçus) : Entrée / Espace.
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute?.('role') === 'button') { e.preventDefault(); e.target.click(); }
  });
  // Glisser-déposer des éléments de la barre et du menu.
  el.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-drag]'); if (!r) return; local.drag = { list: r.dataset.drag, i: Number(r.dataset.i) }; e.dataTransfer.effectAllowed = 'move'; r.classList.add('dragging'); });
  el.addEventListener('dragover', (e) => { const r = e.target.closest('[data-drag]'); if (r && local.drag && r.dataset.drag === local.drag.list) { e.preventDefault(); $$('.drop', el).forEach((x) => x.classList.remove('drop')); r.classList.add('drop'); } });
  el.addEventListener('dragend', () => { local.drag = null; $$('.drop, .dragging', el).forEach((x) => x.classList.remove('drop', 'dragging')); });
  el.addEventListener('drop', async (e) => {
    const r = e.target.closest('[data-drag]');
    if (!r || !local.drag || r.dataset.drag !== local.drag.list) return;
    e.preventDefault();
    const list = local.drag.list;
    const arr = [...toolbar()[list]];
    const [moved] = arr.splice(local.drag.i, 1);
    arr.splice(Number(r.dataset.i), 0, moved);
    local.drag = null;
    await saveToolbar({ [list]: arr });
  });
}
let rangeTimer = null;

