// Feuille plein cadre (style réglages iOS) : Réglages et leurs sous-pages, Galerie de barres, éditeur de la barre
// et du menu, Favoris, Historique. Chaque contrôle écrit un réglage par q.settings.set (validé côté principal).
import { q, S, $, $$, t, esc, actionLabel, action, settings, toolbar, selectedTab, BAR_COLORS, ACCENTS, setOverlay, onRender, render, toast, splitBar } from './core.js';
import { icon, actionIcon } from './icons.js';
import { rowHTML, addressCard } from './bar.js';
import { menuHTML } from './menu.js';

const local = { history: [], historyQuery: '', bookmarksQuery: '', confirmClear: false, adding: null, drag: null,
  // Gestionnaire de favoris : dossier affiché, élément en cours de modification ('b:<id>' / 'f:<id>'), élément glissé.
  bmFolder: null, bmEdit: null, bmDrag: null,
  // Mots de passe et transferts : champs de saisie (jamais écrits dans le HTML), liste du coffre, valeurs affichées.
  fields: {}, vaultList: null, vaultQuery: '', revealed: {}, vaultError: '', sources: null, addingLogin: false, busy: false };

/** Gestionnaire de favoris ouvert directement dans un dossier (clic sur un dossier de la barre de favoris). */
export async function openBookmarksFolder(id) {
  await openSheet('bookmarks', true);
  local.bmFolder = (S.state.folders || []).some((f) => f.id === id) ? id : null;
  render();
}

/** Ouvre une page ; `reset` = nouvelle pile (sinon la page s'empile, bouton Retour). */
export async function openSheet(page, reset = false) {
  if (reset || S.overlay !== 'sheet') S.sheet = [];
  S.sheet.push(page);
  local.adding = null;
  local.confirmClear = false;
  if (page === 'settings' || page === 'about') S.supportInfo = await q.support.info().catch(() => ({ configured: false }));
  if (page === 'history') await loadHistory();
  if (page === 'bookmarks') { local.bmFolder = null; local.bmEdit = null; local.bookmarksQuery = ''; }
  if (page === 'passwords' || page === 'transfer') { local.fields = {}; local.revealed = {}; local.vaultError = ''; await loadVault(); }
  if (page === 'transfer') { local.sources = null; q.transfer.sources().then((s) => { local.sources = s || []; render(); }).catch(() => { local.sources = []; render(); }); }
  if (S.overlay !== 'sheet') await setOverlay('sheet'); else render();
  const body = $('#sheet-body');
  if (body) body.scrollTop = 0;
}

export function sheetBack() {
  if (S.sheet.length > 1) { S.sheet.pop(); local.adding = null; render(); return true; }
  setOverlay('none');
  return false;
}

async function loadVault() {
  const r = await q.vault.list().catch(() => null);
  local.vaultList = r?.ok ? r.value : null;
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
    body: `<button class="priv-card" data-nav="privacy"><span class="priv-ic">${icon('shieldHalf', 22)}</span><span class="priv-t">${esc(t('privacy_card_title'))}<span class="priv-s">${esc(t('privacy_card_sub'))}</span></span></button>`
      + group([
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
      navRow('key', t('page_passwords'), vaultLabel(), 'passwords'),
      navRow('sync', t('page_transfer'), '', 'transfer'),
      navRow('shieldHalf', t('page_privacy'), '', 'privacy'),
      navRow('puzzle', t('extensions'), String(S.state.extensions?.list?.length || ''), 'extensions'),
      navRow('reader', t('page_reading'), t('percent', s.textZoom || 100), 'reading'),
      navRow('download', t('downloads'), S.state.downloads?.active ? t('percent', Math.round((S.state.downloads.progress || 0) * 100)) : '', 'downloads'),
      navRow('globe', t('language'), lang, 'language'),
    ]) + group([navRow('info', t('page_about'), '', 'about')]),
  };
};

function vaultLabel() {
  const v = S.state.vault || {};
  if (v.state === 'none') return t('vault_not_created');
  if (v.state === 'locked') return t('vault_locked');
  return v.count != null ? String(v.count) : '';
}

// ----- Mots de passe -----
const field = (name, type, placeholder, extra = '') => `<div class="s-row"><input class="s-input" data-field="${name}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" ${extra}></div>`;
function rememberRow(v) {
  if (!v.canRemember) return '';
  const on = local.fields.remember !== undefined ? local.fields.remember : true;
  return `<button class="s-row" data-vremember-field><span class="s-l">${esc(t('vault_remember'))}<span class="s-sub">${esc(t('vault_remember_sub'))}</span></span><span class="switch${on ? ' on' : ''}"><span></span></span></button>`;
}
const errorRow = () => (local.vaultError ? `<div class="s-row muted v-error"><span class="s-l">${esc(local.vaultError)}</span></div>` : '');

P.passwords = () => {
  const v = S.state.vault || { state: 'none' };
  if (v.state === 'open' && local.vaultList == null && !local.loadingVault) { local.loadingVault = true; loadVault().finally(() => { local.loadingVault = false; render(); }); }
  if (v.state === 'none') {
    return { title: t('page_passwords'), body:
      `<div class="v-intro">${icon('key', 30)}<div class="v-intro-t">${esc(t('vault_intro_title'))}</div><div class="v-intro-s">${esc(t('vault_intro'))}</div></div>`
      + group([field('pass', 'password', t('vault_new_pass')), field('pass2', 'password', t('vault_confirm_pass')), errorRow()], { header: t('vault_master'), footer: t('vault_master_footer') })
      + group([rememberRow(v)])
      + group([buttonRow(t('vault_create'), 'vaultCreate', { center: true })]) };
  }
  if (v.state === 'locked') {
    return { title: t('page_passwords'), body:
      `<div class="v-intro">${icon('lock', 30)}<div class="v-intro-t">${esc(t('vault_locked_title'))}</div></div>`
      + group([field('pass', 'password', t('vault_master'), 'data-enter="vaultUnlock"'), errorRow()])
      + group([v.remember ? '' : rememberRow(v)])
      + group([buttonRow(t('vault_unlock'), 'vaultUnlock', { center: true })]) };
  }
  const list = (local.vaultList || []).filter((l) => !local.vaultQuery || `${l.title} ${l.username} ${l.origin}`.toLowerCase().includes(local.vaultQuery.toLowerCase()));
  let body = `<label class="t-search">${icon('search', 17)}<input data-search="vaultQuery" type="search" placeholder="${esc(t('vault_search'))}" value="${esc(local.vaultQuery)}"></label>`;
  if (!local.vaultList?.length) body += `<div class="t-empty">${esc(t('vault_empty'))}</div>`;
  else body += group(list.map((l) => {
    const shown = local.revealed[l.id];
    return `<div class="s-row v-login">${faviconLetter(hostOf(l.origin))}<span class="s-l">${esc(l.title)}<span class="s-sub">${esc(l.username || t('vault_no_username'))}</span>${shown != null ? `<span class="v-pass" dir="ltr">${esc(shown)}</span>` : ''}</span>
      <button class="s-x" data-vcopy="${esc(l.id)}" data-f="username" title="${esc(t('vault_copy_user'))}">${icon('copy', 17)}</button>
      <button class="s-x" data-vcopy="${esc(l.id)}" data-f="password" title="${esc(t('vault_copy_pass'))}">${icon('key', 17)}</button>
      <button class="s-x" data-vreveal="${esc(l.id)}" title="${esc(t(shown != null ? 'vault_hide' : 'vault_show'))}">${icon(shown != null ? 'xmark' : 'textSearch', 17)}</button>
      <button class="s-x" data-vremove="${esc(l.id)}" title="${esc(t('delete'))}">${icon('trash', 17)}</button></div>`;
  }), { header: t('vault_count', local.vaultList.length), footer: t('vault_copy_footer') });
  body += local.addingLogin
    ? group([field('url', 'text', 'https://exemple.fr'), field('user', 'text', t('vault_username')), field('pw', 'password', t('vault_password')), errorRow(), buttonRow(t('vault_add_save'), 'vaultAdd', { center: true })], { header: t('vault_add') })
    : group([`<button class="s-row center" data-do="vaultAddOpen"><span class="s-ic">${icon('plus', 18)}</span><span class="s-l">${esc(t('vault_add'))}</span></button>`]);
  body += group([navRow('sync', t('page_transfer'), '', 'transfer')]);
  body += group([
    v.canRemember ? `<button class="s-row" data-vremember><span class="s-l">${esc(t('vault_remember'))}<span class="s-sub">${esc(t('vault_remember_sub'))}</span></span><span class="switch${v.remember ? ' on' : ''}"><span></span></span></button>` : '',
    buttonRow(t('vault_lock_now'), 'vaultLock', { center: true }),
  ], { footer: t('vault_autolock_footer') });
  return { title: t('page_passwords'), body };
};

// ----- Importer et exporter -----
P.transfer = () => {
  const v = S.state.vault || { state: 'none' };
  const tr = S.state.transfer || {};
  const src = local.sources;
  const browserRows = src == null
    ? [`<div class="s-row muted"><span class="s-l">${esc(t('transfer_searching'))}</span></div>`]
    : src.length
      ? src.map((s) => `<button class="s-row" data-do="importBrowser" data-v="${esc(s.id)}"><span class="s-ic">${icon('globe', 20)}</span><span class="s-l">${esc(s.label)}<span class="s-sub">${esc(t('transfer_found', s.count))}</span></span><span class="s-v accent">${esc(t('transfer_import'))}</span></button>`)
      : [`<div class="s-row muted"><span class="s-l">${esc(t('transfer_no_browser'))}</span></div>`];
  let body = group(browserRows, { header: t('transfer_from_browser'), footer: t('transfer_from_browser_footer') });
  body += group([`<button class="s-row" data-do="importFile"><span class="s-ic">${icon('folder', 20)}</span><span class="s-l">${esc(t('transfer_choose_file'))}<span class="s-sub">${esc(t('transfer_file_sub'))}</span></span><span class="s-chev">${icon('chevronRight', 15)}</span></button>`],
    { header: t('transfer_from_file'), footer: t(v.state === 'none' ? 'transfer_file_footer_novault' : 'transfer_file_footer') });
  if (v.state === 'none') body += group([navRow('key', t('vault_create_to_import'), '', 'passwords')]);
  body += `<div class="v-guide"><div class="v-guide-t">${icon('info', 15)} ${esc(t('transfer_guide_title'))}</div>${['chrome', 'edge', 'firefox'].map((b) => `<div class="v-guide-r"><b>${esc(t('transfer_guide_' + b + '_name'))}</b> · ${esc(t('transfer_guide_' + b))}</div>`).join('')}</div>`;
  const exp = [
    `<button class="s-row" data-do="exportBookmarks"><span class="s-ic">${icon('book', 20)}</span><span class="s-l">${esc(t('transfer_export_bookmarks'))}<span class="s-sub">${esc(t('transfer_export_bookmarks_sub', S.state.bookmarks?.length || 0))}</span></span><span class="s-chev">${icon('chevronRight', 15)}</span></button>`,
    `<button class="s-row" data-do="exportBackup"><span class="s-ic">${icon('gear', 20)}</span><span class="s-l">${esc(t('transfer_export_backup'))}<span class="s-sub">${esc(t('transfer_export_backup_sub'))}</span></span><span class="s-chev">${icon('chevronRight', 15)}</span></button>`,
  ];
  if (v.state !== 'none') {
    exp.push(local.fields.exporting
      ? `<div class="s-row"><span class="s-ic">${icon('key', 20)}</span><input class="s-input" data-field="exportPass" type="password" placeholder="${esc(t('vault_master'))}" autocomplete="off" data-enter="exportPasswords"><button class="pill-btn small" data-do="exportPasswords">${esc(t('transfer_export'))}</button></div>${errorRow()}`
      : `<button class="s-row" data-do="exportPasswordsOpen"><span class="s-ic">${icon('key', 20)}</span><span class="s-l">${esc(t('transfer_export_passwords'))}<span class="s-sub">${esc(t('transfer_export_passwords_sub'))}</span></span><span class="s-chev">${icon('chevronRight', 15)}</span></button>`);
  }
  body += group(exp, { header: t('transfer_export_header'), footer: t('transfer_export_footer') });
  const undo = [];
  if (tr.last) undo.push(`<button class="s-row red" data-do="undoBookmarks"><span class="s-l">${esc(t('transfer_undo_bookmarks', tr.last.count, tr.last.source))}</span></button>`);
  if (v.lastBatch) undo.push(`<button class="s-row red" data-do="undoPasswords"><span class="s-l">${esc(t('transfer_undo_passwords', v.lastBatch.count, v.lastBatch.source))}</span></button>`);
  if (undo.length) body += group(undo, { header: t('transfer_last_import') });
  return { title: t('page_transfer'), body };
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
      + group([`<div class="s-row seg-row"><div class="seg">${[['modern', 'ui_style_modern', 'uiStyleModern'], ['classic', 'ui_style_classic', 'uiStyleClassic']].map(([v, k, d]) => `<button class="${(s.uiStyle || 'modern') === v ? 'on' : ''}" data-do="${d}"><span>${esc(t(k))}</span></button>`).join('')}</div></div>`], { header: t('ui_style'), footer: t('ui_style_footer') })
      + group([segmented('appearance', [['system', t('appearance_system')], ['light', t('appearance_light')], ['dark', t('appearance_dark')]])], { header: t('theme') })
      + group([swatches('accent', accents)], { header: t('accent_color') })
      + group([swatches('barColorLight', bars)], { header: t('bar_color_light'), footer: t('bar_auto_light_desc') })
      + group([swatches('barColorDark', bars)], { header: t('bar_color_dark'), footer: t('bar_auto_dark_desc') })
      + group([`<div class="s-row seg-row"><div class="seg">${[['classic', 'style_classic'], ['glass', 'style_glass'], ['floating', 'style_floating']].map(([v, k]) => `<button class="${v === style ? 'on' : ''}" data-tbset="style" data-v="${enc(v)}"><span>${esc(t(k))}</span></button>`).join('')}</div></div>`], { header: t('bar_style'), footer: t('bar_style_footer') })
      + group([toggleRow(t('bookmarks_bar'), 'showBookmarksBar', t('bookmarks_bar_sub'))])
      + group([
        labelledSegmented(t('size_interface'), 'uiScale', [[0.9, '90 %'], [1, '100 %'], [1.1, '110 %'], [1.25, '125 %'], [1.5, '150 %']]),
        labelledSegmented(t('size_address_bar'), 'barSize', sizeOptions()),
        S.cfg.app.platform === 'win32' ? labelledSegmented(t('size_title_bar'), 'titleBarSize', sizeOptions()) : '',
        s.showBookmarksBar !== false ? labelledSegmented(t('bookmarks_bar'), 'bookmarksBarSize', sizeOptions()) : '',
      ], { header: t('sizes'), footer: t('sizes_footer') })
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
  const engines = (S.cfg.settingsKeys?.enums?.SearchEngine?.values || Object.keys(S.cfg.engines || {})).filter((e) => e !== 'duckduckgo');
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
      + (S.state?.update?.status && S.state.update.status !== 'disabled' ? updatesGroup() : '')
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
// Gestionnaire de favoris : dossiers (navigation, fil d'Ariane), favoris, recherche dans tous les dossiers,
// modification en place (nom, adresse, dossier, ordre), glisser-déposer vers un dossier ou avant un autre favori.
const bmFolders = () => S.state.folders || [];
const bmFolder = (id) => bmFolders().find((f) => f.id === id) || null;
function bmPath(id) {
  const out = [];
  for (let f = bmFolder(id), n = 0; f && n < 50; f = bmFolder(f.parent), n++) out.unshift(f);
  return out;
}
function bmCount(id) {
  const inside = (fid) => S.state.bookmarks.filter((b) => b.folder === fid).length + bmFolders().filter((f) => f.parent === fid).reduce((n, f) => n + inside(f.id), 0);
  return inside(id);
}
/** Options « Dossier » : racine puis l'arborescence indentée ; `exclude` (dossier modifié) et ses sous-dossiers exclus. */
function bmFolderOptions(selected, exclude) {
  const opts = [`<option value=""${!selected ? ' selected' : ''}>${esc(t('bm_root'))}</option>`];
  const walk = (parent, depth) => {
    for (const f of bmFolders().filter((x) => (x.parent || null) === parent)) {
      if (f.id === exclude) continue;
      opts.push(`<option value="${esc(f.id)}"${f.id === selected ? ' selected' : ''}>${' '.repeat(depth)}${esc(f.name)}</option>`);
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  return opts.join('');
}
function bmEditCard(kind, item) {
  const isF = kind === 'f';
  const where = isF ? item.parent : item.folder;
  const field = (key, label, value, type = 'text') => `<div class="s-row bm-field"><span class="bm-lab">${esc(label)}</span><input class="s-input" data-field="${key}" type="${type}" value="${esc(value)}" spellcheck="false" autocomplete="off" data-enter="bmSave" dir="auto"></div>`;
  const rows = [
    field('bmName', t('bm_name'), isF ? item.name : item.title),
    isF ? '' : field('bmUrl', t('bm_address'), item.url, 'url'),
    `<div class="s-row bm-field"><span class="bm-lab">${esc(t('bm_folder'))}</span><select class="s-input bm-select" data-field="bmWhere">${bmFolderOptions(where || null, isF ? item.id : null)}</select></div>`,
    `<div class="s-row bm-tools">
      <button class="bm-tool" data-do="bmUp" title="${esc(t('bm_up'))}">${icon('chevronLeft', 16)}<span>${esc(t('bm_up'))}</span></button>
      <button class="bm-tool" data-do="bmDown" title="${esc(t('bm_down'))}">${icon('chevronRight', 16)}<span>${esc(t('bm_down'))}</span></button>
      <span class="bm-sp"></span>
      <button class="bm-tool red" data-do="bmDelete">${icon('trash', 16)}<span>${esc(t(isF ? 'bm_delete_folder' : 'delete'))}</span></button>
      <button class="bm-tool" data-do="bmCancel">${esc(t('cancel'))}</button>
      <button class="bm-tool primary" data-do="bmSave">${esc(t('bm_save'))}</button>
    </div>`,
    isF ? `<div class="s-row muted"><span class="s-l">${esc(t('bm_delete_folder_sub'))}</span></div>` : '',
  ];
  return `<div class="bm-edit">${rows.filter(Boolean).join('<div class="g-sep"></div>')}</div>`;
}
function bmFolderRow(f, sub) {
  if (local.bmEdit === 'f:' + f.id) return bmEditCard('f', f);
  return `<div class="s-row link bm-row" role="button" tabindex="0" draggable="true" data-bmdrag="f:${esc(f.id)}" data-bmgo="${esc(f.id)}" data-bmdrop="${esc(f.id)}">`
    + `<span class="s-ic bm-fic">${icon('folder', 22)}</span><span class="s-l">${esc(f.name)}<span class="s-sub">${esc(sub ?? t('bm_count', bmCount(f.id)))}</span></span>`
    + `<button class="s-x" data-bmedit="f:${esc(f.id)}" title="${esc(t('bm_edit'))}">${icon('sliders', 17)}</button><span class="s-chev">${icon('chevronRight', 15)}</span></div>`;
}
function bmRow(b, sub) {
  if (local.bmEdit === 'b:' + b.id) return bmEditCard('b', b);
  const host = hostOf(b.url);
  return `<div class="s-row link bm-row" role="button" tabindex="0" draggable="true" data-bmdrag="b:${esc(b.id)}" data-bmbefore="${esc(b.id)}" data-open="${esc(b.url)}">${faviconLetter(host)}`
    + `<span class="s-l">${esc(b.title || host)}<span class="s-sub" dir="ltr">${esc(sub ?? host)}</span></span>`
    + `<button class="s-x" data-bmedit="b:${esc(b.id)}" title="${esc(t('bm_edit'))}">${icon('sliders', 17)}</button>`
    + `<button class="s-x" data-unbookmark="${esc(b.id)}" title="${esc(t('delete'))}">${icon('xmarkCircle', 18)}</button></div>`;
}
P.bookmarks = () => {
  const qy = local.bookmarksQuery.trim().toLowerCase();
  if (local.bmFolder && !bmFolder(local.bmFolder)) local.bmFolder = null;
  const cur = local.bmFolder;
  const path = bmPath(cur);
  let body = `<label class="t-search">${icon('search', 17)}<input data-search="bookmarksQuery" type="search" placeholder="${esc(t('search_bookmarks'))}" value="${esc(local.bookmarksQuery)}"></label>`;
  if (qy) {
    const fs = bmFolders().filter((f) => f.name.toLowerCase().includes(qy)).map((f) => bmFolderRow(f, bmPath(f.parent).map((x) => x.name).join(' › ') || t('bm_root')));
    const bs = S.state.bookmarks.filter((b) => b.title.toLowerCase().includes(qy) || b.url.toLowerCase().includes(qy))
      .map((b) => bmRow(b, [hostOf(b.url), ...bmPath(b.folder).map((x) => x.name)].join(' · ')));
    body += fs.length || bs.length ? group([...fs, ...bs]) : `<div class="t-empty">${esc(t('no_bookmarks'))}</div>`;
    return { title: actionLabel('bookmarks'), root: true, body };
  }
  // Fil d'Ariane : chaque étape ouvre le dossier et reçoit les éléments déposés.
  const crumbs = [`<button class="bm-crumb${cur ? '' : ' on'}" data-bmgo="" data-bmdrop="">${icon('bookmark', 14)}${esc(t('bm_root'))}</button>`]
    .concat(path.map((f, i) => `<button class="bm-crumb${i === path.length - 1 ? ' on' : ''}" data-bmgo="${esc(f.id)}" data-bmdrop="${esc(f.id)}">${esc(f.name)}</button>`));
  body += `<div class="bm-crumbs">${crumbs.join(`<span class="bm-crumb-sep">${icon('chevronRight', 12)}</span>`)}</div>`;
  body += `<div class="bm-actions"><button class="bm-tool" data-do="bmNewFolder">${icon('folder', 16)}<span>${esc(t('bm_new_folder'))}</span></button>`
    + (selectedTab()?.url && /^https?:/.test(selectedTab().url) ? `<button class="bm-tool" data-do="bmAddHere">${icon('plus', 16)}<span>${esc(t('bm_add_here'))}</span></button>` : '')
    + (cur ? `<button class="bm-tool" data-do="bmUpLevel">${icon('arrowUpLeft', 16)}<span>${esc(t('bm_parent'))}</span></button>` : '') + '</div>';
  const fRows = bmFolders().filter((f) => (f.parent || null) === cur).map((f) => bmFolderRow(f));
  const bRows = S.state.bookmarks.filter((b) => (b.folder || null) === cur).map((b) => bmRow(b));
  body += fRows.length || bRows.length ? group([...fRows, ...bRows], { footer: t('bm_footer') })
    : `<div class="t-empty bmm-empty" data-bmdrop="${esc(cur || '')}">${esc(t(cur ? 'bm_folder_empty' : 'no_bookmarks'))}</div>`;
  return { title: cur ? path.at(-1).name : actionLabel('bookmarks'), root: true, body };
};

async function bmAction(d) {
  const f = local.fields;
  const [kind, id] = (local.bmEdit || ':').split(':');
  const k = kind === 'f' ? 'folder' : 'bookmark';
  switch (d) {
    case 'bmNewFolder': {
      const nf = await q.bookmarks.addFolder(t('bm_new_folder_name'), local.bmFolder);
      if (nf?.id) { local.bmEdit = 'f:' + nf.id; local.fields = { bmName: nf.name, bmWhere: local.bmFolder || '' }; }
      render(); focusBmName(); return true;
    }
    case 'bmAddHere': {
      const tab = selectedTab();
      const b = await q.bookmarks.add(tab?.title || tab?.url || '', tab?.url || '');
      if (b?.id && local.bmFolder) await q.bookmarks.move('bookmark', b.id, local.bmFolder);
      toast(b?.id ? t('bm_added') : t('bm_already'));
      return true;
    }
    case 'bmUpLevel': local.bmFolder = bmFolder(local.bmFolder)?.parent || null; local.bmEdit = null; render(); return true;
    case 'bmCancel': local.bmEdit = null; local.fields = {}; render(); return true;
    case 'bmUp': case 'bmDown': if (id) await q.bookmarks.reorder(k, id, d === 'bmUp' ? -1 : 1); return true;
    case 'bmDelete':
      if (!id) return true;
      if (k === 'folder') await q.bookmarks.removeFolder(id); else await q.bookmarks.remove(id);
      local.bmEdit = null; local.fields = {}; render(); return true;
    case 'bmSave': {
      if (!id) return true;
      const name = (f.bmName ?? '').trim();
      const where = f.bmWhere ?? null;
      if (k === 'folder') {
        if (name) await q.bookmarks.renameFolder(id, name);
        if (where !== null && where !== (bmFolder(id)?.parent || '')) await q.bookmarks.move('folder', id, where);
      } else {
        const b = S.state.bookmarks.find((x) => x.id === id);
        const url = (f.bmUrl ?? b?.url ?? '').trim();
        await q.bookmarks.update(id, { title: name || b?.title || url, url: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url });
        if (where !== null && where !== (b?.folder || '')) await q.bookmarks.move('bookmark', id, where);
      }
      local.bmEdit = null; local.fields = {}; render(); return true;
    }
    default: return false;
  }
}
function focusBmName() { setTimeout(() => { const i = $('#sheet')?.querySelector('[data-field="bmName"]'); if (i) { i.focus(); i.select(); } }, 30); }

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
  const focusedField = document.activeElement?.dataset?.field;
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
  // Champs du coffre : valeurs reposées après chaque rendu (jamais écrites dans le HTML).
  for (const inp of el.querySelectorAll('[data-field]')) { const v = local.fields[inp.dataset.field]; if (typeof v === 'string') inp.value = v; }
  if (focusedField) { const i = el.querySelector(`[data-field="${focusedField}"]`); if (i) { i.focus(); try { i.setSelectionRange(caret, caret); } catch { /* */ } } }
  else if (!focused) { const first = el.querySelector('[data-field]'); if (first && !first.value && (S.sheet.at(-1) === 'passwords')) first.focus(); }
  if (focused) {
    const i = el.querySelector(`[data-search="${focused}"], [data-text="${focused}"]`);
    if (i) { i.focus(); try { i.setSelectionRange(caret, caret); } catch { /* champ sans sélection */ } }
  }
}
onRender(renderSheet);

// ----- Actions du coffre et des transferts -----
const VAULT_ERRORS = { E_WEAK: 'vault_err_weak', E_WRONG: 'vault_err_wrong', E_INVALID: 'vault_err_invalid', E_NO_KEYCHAIN: 'vault_err_keychain', E_LOCKED: 'vault_err_locked' };
const vaultErr = (r) => t(VAULT_ERRORS[r?.error] || 'vault_err_generic');
async function vaultAction(d, b) {
  if (d.startsWith('bm') && (await bmAction(d))) return true;
  const f = local.fields;
  const busy = async (fn) => { if (local.busy) return; local.busy = true; try { await fn(); } finally { local.busy = false; } };
  switch (d) {
    case 'vaultCreate':
      if ((f.pass || '') !== (f.pass2 || '')) { local.vaultError = t('vault_err_mismatch'); render(); return true; }
      await busy(async () => {
        local.vaultError = t('vault_working'); render();
        const r = await q.vault.create(f.pass || '', f.remember !== undefined ? f.remember : true);
        local.vaultError = r?.ok ? '' : vaultErr(r);
        if (r?.ok) { local.fields = {}; await loadVault(); toast(t('vault_created')); }
        render();
      });
      return true;
    case 'vaultUnlock':
      await busy(async () => {
        local.vaultError = t('vault_working'); render();
        const r = await q.vault.unlock(f.pass || '', !!f.remember && !S.state.vault?.remember);
        local.vaultError = r?.ok ? '' : vaultErr(r);
        if (r?.ok) { local.fields = {}; await loadVault(); }
        render();
      });
      return true;
    case 'vaultLock': await q.vault.lock(); local.vaultList = null; local.revealed = {}; render(); return true;
    case 'vaultAddOpen': local.addingLogin = true; local.vaultError = ''; render(); return true;
    case 'vaultAdd': {
      const r = await q.vault.add(f.url || '', f.user || '', f.pw || '');
      if (!r?.ok) { local.vaultError = vaultErr(r); render(); return true; }
      local.addingLogin = false; local.vaultError = ''; delete f.url; delete f.user; delete f.pw;
      await loadVault(); toast(t('vault_added')); render(); return true;
    }
    case 'importBrowser': await busy(() => q.transfer.importBrowser(b.dataset.v)); await loadVault(); render(); return true;
    case 'importFile': await busy(() => q.transfer.importFile()); await loadVault(); render(); return true;
    case 'exportBookmarks': await busy(() => q.transfer.exportBookmarks()); return true;
    case 'exportBackup': await busy(() => q.transfer.exportBackup()); return true;
    case 'exportPasswordsOpen': f.exporting = true; local.vaultError = ''; render(); return true;
    case 'exportPasswords':
      await busy(async () => {
        local.vaultError = t('vault_working'); render();
        const r = await q.transfer.exportPasswords(f.exportPass || '');
        local.vaultError = r?.error === 'wrong' ? t('vault_err_wrong') : '';
        if (r?.error !== 'wrong') { delete f.exportPass; f.exporting = false; }
        render();
      });
      return true;
    case 'undoBookmarks': { const n = await q.transfer.undo(); toast(t('transfer_undone', n || 0)); return true; }
    case 'undoPasswords': { const r = await q.vault.undo(); toast(t('transfer_undone', r?.value || 0)); await loadVault(); render(); return true; }
    default: return false;
  }
}

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
    if ((b = g('[data-bmedit]'))) {
      e.stopPropagation();
      const v = b.dataset.bmedit;
      local.bmEdit = local.bmEdit === v ? null : v;
      const [k, id] = v.split(':');
      const it = k === 'f' ? bmFolder(id) : S.state.bookmarks.find((x) => x.id === id);
      local.fields = it ? (k === 'f' ? { bmName: it.name, bmWhere: it.parent || '' } : { bmName: it.title, bmUrl: it.url, bmWhere: it.folder || '' }) : {};
      render(); if (local.bmEdit) focusBmName(); return;
    }
    if ((b = g('[data-bmgo]'))) { local.bmFolder = b.dataset.bmgo || null; local.bmEdit = null; render(); $('#sheet-body')?.scrollTo(0, 0); return; }
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
    if ((b = g('[data-vcopy]'))) { const r = await q.vault.copy(b.dataset.vcopy, b.dataset.f); if (r?.ok) toast(t(b.dataset.f === 'username' ? 'vault_copied_user' : 'vault_copied_pass')); else { await loadVault(); render(); } return; }
    if ((b = g('[data-vreveal]'))) {
      const id = b.dataset.vreveal;
      if (local.revealed[id] != null) delete local.revealed[id];
      else { const r = await q.vault.reveal(id); if (r?.ok && r.value != null) local.revealed[id] = r.value; }
      render(); return;
    }
    if ((b = g('[data-vremove]'))) { await q.vault.remove(b.dataset.vremove); delete local.revealed[b.dataset.vremove]; await loadVault(); render(); return; }
    if ((b = g('[data-vremember-field]'))) { local.fields.remember = !(local.fields.remember !== undefined ? local.fields.remember : true); render(); return; }
    if ((b = g('[data-vremember]'))) { await q.vault.remember(!S.state.vault?.remember); return; }
    if ((b = g('[data-do]'))) {
      const d = b.dataset.do;
      if (await vaultAction(d, b)) return;
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
      if (d === 'source') { q.openExternal('https://fefe-kurylen.github.io/Qafila/'); return; }
      // Style de l'interface : Classique minimaliste = barre pleine largeur opaque, en une partie, angles droits.
      if (d === 'uiStyleClassic') { await q.settings.set('uiStyle', 'classic'); await saveToolbar({ style: 'classic', preset: toolbar().preset }); await q.settings.set('barLayout', 'one'); return; }
      if (d === 'uiStyleModern') { await q.settings.set('uiStyle', 'modern'); await saveToolbar({ style: 'floating', preset: toolbar().preset }); await q.settings.set('barLayout', 'split'); return; }
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
  // Glisser-déposer dans le gestionnaire de favoris : sur un dossier ou une étape du fil d'Ariane = ranger dedans ;
  // sur un favori (favori glissé) = placer juste avant lui.
  el.addEventListener('dragstart', (e) => {
    const r = e.target.closest?.('[data-bmdrag]');
    if (!r) return;
    const [k, id] = r.dataset.bmdrag.split(':');
    local.bmDrag = { kind: k === 'f' ? 'folder' : 'bookmark', id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    r.classList.add('dragging');
  });
  el.addEventListener('dragend', () => { local.bmDrag = null; for (const x of el.querySelectorAll('.drop-on, .drop-before, .dragging')) x.classList.remove('drop-on', 'drop-before', 'dragging'); });
  const bmTarget = (e) => {
    const d = local.bmDrag;
    if (!d) return null;
    const into = e.target.closest?.('[data-bmdrop]');
    if (into && !(d.kind === 'folder' && into.dataset.bmdrop === d.id)) return { el: into, cls: 'drop-on', go: () => q.bookmarks.move(d.kind, d.id, into.dataset.bmdrop || null) };
    const before = e.target.closest?.('[data-bmbefore]');
    if (before && d.kind === 'bookmark' && before.dataset.bmbefore !== d.id) return { el: before, cls: 'drop-before', go: () => q.bookmarks.placeBefore('bookmark', d.id, before.dataset.bmbefore) };
    return null;
  };
  el.addEventListener('dragover', (e) => {
    const tg = bmTarget(e);
    for (const x of el.querySelectorAll('.drop-on, .drop-before')) if (x !== tg?.el) x.classList.remove('drop-on', 'drop-before');
    if (!tg) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tg.el.classList.add(tg.cls);
  });
  el.addEventListener('drop', async (e) => {
    const tg = bmTarget(e);
    if (!tg) return;
    e.preventDefault();
    local.bmDrag = null;
    await tg.go();
  });
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
    if (d.field) { local.fields[d.field] = e.target.value; if (local.vaultError && local.vaultError !== t('vault_working')) { local.vaultError = ''; const er = el.querySelector('.v-error'); if (er) er.remove(); } }
    if (d.search) { local[d.search] = e.target.value; if (d.search === 'historyQuery') await loadHistory(); render(); }
  });
  el.addEventListener('change', (e) => { const d = e.target.dataset; if (d.text) q.settings.set(d.text, e.target.value.trim()); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.text) e.target.blur();
    if (e.key === 'Enter' && e.target.dataset.field) { const act = e.target.dataset.enter || el.querySelector('[data-do="vaultCreate"], [data-do="vaultUnlock"], [data-do="vaultAdd"]')?.dataset.do; if (act) vaultAction(act, e.target); }
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

