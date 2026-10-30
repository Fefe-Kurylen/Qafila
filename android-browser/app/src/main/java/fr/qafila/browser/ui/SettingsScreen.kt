package fr.qafila.browser.ui

import android.webkit.WebView
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import android.content.ContextWrapper
import android.content.Context
import android.app.Activity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.geometry.Offset
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.Canvas
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import fr.qafila.browser.R
import fr.qafila.browser.data.ToolbarAction
import fr.qafila.browser.data.AccentColor
import fr.qafila.browser.data.AddressLongPressAction
import fr.qafila.browser.data.AddressStyle
import fr.qafila.browser.data.AddressTapAction
import fr.qafila.browser.data.AppIcon
import fr.qafila.browser.data.Appearance
import fr.qafila.browser.data.AutoCloseTabs
import fr.qafila.browser.data.BarColor
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.data.GridSize
import fr.qafila.browser.data.IconWeight
import fr.qafila.browser.data.MenuIconStyle
import fr.qafila.browser.data.NewTabPage
import fr.qafila.browser.data.ScrollBehavior
import fr.qafila.browser.data.SearchEngine
import fr.qafila.browser.data.Settings
import fr.qafila.browser.data.SettingsPage
import fr.qafila.browser.data.SuggestionsMode
import fr.qafila.browser.data.TabsLayout
import fr.qafila.browser.data.TabsSort
import fr.qafila.browser.data.ToolbarPosition
import fr.qafila.browser.data.ToolbarStyle
import fr.qafila.browser.data.TranslateLanguage
import fr.qafila.browser.web.ContentBlocker

/** Réglages : navigation à sous-pages, style réglages iOS sobre (DESIGN.md §6). */
@Composable
fun SettingsScreen(store: BrowserStore, onDismiss: () -> Unit) {
    val stack by store.settingsStack.collectAsState()
    fun push(p: SettingsPage) { store.settingsStack.value = stack + p }
    fun pop() { if (stack.size > 1) store.settingsStack.value = stack.dropLast(1) else onDismiss() }
    BackHandler { pop() }
    // Les sous-pages arrivent du côté « fin » : de la droite, ou de la gauche en arabe.
    val dir = if (isRtl()) -1 else 1
    AnimatedContent(
        targetState = stack,
        transitionSpec = {
            val forward = targetState.size >= initialState.size
            (slideInHorizontally(tween(220)) { (if (forward) it / 3 else -it / 3) * dir } + fadeIn(tween(220))) togetherWith (slideOutHorizontally(tween(220)) { (if (forward) -it / 4 else it / 4) * dir } + fadeOut(tween(160)))
        },
        label = "settings",
    ) { st ->
        val page = st.last()
        val back = if (st.size > 1) stringResource(st[st.size - 2].titleRes) else stringResource(R.string.done)
        val onBack: () -> Unit = { pop() }
        when (page) {
            SettingsPage.ROOT -> RootPage(store, onDismiss) { push(it) }
            SettingsPage.EDITOR -> ToolbarEditorPage(store, back, onBack) { push(SettingsPage.GALLERY) }
            SettingsPage.GALLERY -> ToolbarGalleryPage(store, back, onBack)
            else -> QPage(stringResource(page.titleRes), onBack, backLabel = back) { pageContent(store, page) { push(it) } }
        }
    }
}

@Composable
private fun RootPage(store: BrowserStore, onDismiss: () -> Unit, open: (SettingsPage) -> Unit) {
    val state by store.state.collectAsState()
    val q = LocalQ.current
    QPage(stringResource(R.string.action_settings), onBack = null, trailing = { TextAction(stringResource(R.string.done), onClick = onDismiss) }) {
        item {
            Spacer(Modifier.height(12.dp))
            val supporter by store.support.isSupporter.collectAsState()
            val price by store.support.price.collectAsState()
            GroupCard {
                // Rangée « premium » mais sobre : seul le cœur est en couleur.
                NavRow(stringResource(R.string.page_support), value = if (supporter) stringResource(R.string.support_thanks_short) else stringResource(R.string.price_per_month, price ?: stringResource(R.string.support_fallback_price)),
                    icon = QIcon.HEART, iconTint = SupportPink) { open(SettingsPage.SUPPORT) }
            }
            Spacer(Modifier.height(24.dp))
            GroupCard {
                NavRow(stringResource(R.string.page_appearance), icon = QIcon.CONTRAST) { open(SettingsPage.APPEARANCE) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.page_toolbar), icon = QIcon.BAR) { open(SettingsPage.TOOLBAR) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.page_address), value = state.settings.addressStyle.label, icon = QIcon.ADDRESS) { open(SettingsPage.ADDRESS) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.action_tabs), icon = QIcon.TABS) { open(SettingsPage.TABS) }
            }
            Spacer(Modifier.height(24.dp))
            GroupCard {
                NavRow(stringResource(R.string.page_search), value = state.settings.searchEngine.label.substringBefore(" ("), icon = QIcon.SEARCH) { open(SettingsPage.SEARCH) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.page_privacy_security), icon = QIcon.SHIELD) { open(SettingsPage.PRIVACY) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.page_reading), icon = QIcon.READER) { open(SettingsPage.READING) }; RowDivider(50.dp)
                NavRow(stringResource(R.string.page_energy), icon = QIcon.BATTERY) { open(SettingsPage.ENERGY) }
            }
            Spacer(Modifier.height(24.dp))
            GroupCard {
                NavRow(stringResource(R.string.action_bookmarks), icon = QIcon.BOOK) { onDismiss(); store.showBookmarks.value = true }; RowDivider(50.dp)
                NavRow(stringResource(R.string.action_history), icon = QIcon.CLOCK) { onDismiss(); store.showHistory.value = true }
            }
            Spacer(Modifier.height(24.dp))
            GroupCard { NavRow(stringResource(R.string.page_about), icon = QIcon.INFO) { open(SettingsPage.ABOUT) } }
            Spacer(Modifier.height(28.dp))
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.app_name), color = q.secondary, fontSize = 15.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
                Text(stringResource(R.string.app_name_arabic), color = q.tertiary, fontSize = 13.sp)
            }
        }
    }
}

private fun LazyListScope.pageContent(store: BrowserStore, page: SettingsPage, open: (SettingsPage) -> Unit) {
    when (page) {
        SettingsPage.APPEARANCE -> item { AppearancePage(store, open) }
        SettingsPage.SUPPORT -> item { SupportPage(store) }
        SettingsPage.TOOLBAR -> item { ToolbarPage(store, open) }
        SettingsPage.ADDRESS -> item { AddressPage(store) }
        SettingsPage.TABS -> item { TabsPage(store) }
        SettingsPage.SEARCH -> item { SearchPage(store) }
        SettingsPage.PRIVACY -> item { PrivacyPage(store) }
        SettingsPage.READING -> item { ReadingPage(store) }
        SettingsPage.ENERGY -> item { EnergyPage(store) }
        SettingsPage.ABOUT -> item { AboutPage(store) }
        else -> Unit
    }
}

@Composable
private fun settingsOf(store: BrowserStore): Settings = store.state.collectAsState().value.settings

@Composable
private fun LivePreview(s: Settings) = Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)) { ChromePreview(s) }

@Composable
private fun SegmentedSection(title: String, options: List<String>, selected: Int, footer: String? = null, onSelect: (Int) -> Unit) {
    SectionHeader(title)
    Segmented(options, selected, Modifier.padding(horizontal = 16.dp), onSelect)
    if (footer != null) SectionFooter(footer)
}

// ---------------------------------------------------------------- Apparence
@Composable
private fun AppearancePage(store: BrowserStore, open: (SettingsPage) -> Unit) {
    val s = settingsOf(store)
    val supporter by store.support.isSupporter.collectAsState()
    val q = LocalQ.current
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    Column {
        LivePreview(s)
        SegmentedSection(stringResource(R.string.theme), Appearance.entries.map { it.label }, s.appearance.ordinal) { i -> up { it.copy(appearance = Appearance.entries[i]) } }

        SectionHeader(stringResource(R.string.accent_color))
        GroupCard {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                AccentColor.entries.forEach { a ->
                    val c = if (a == AccentColor.MONO) q.text else Color(a.argb)
                    Swatch(c, selected = s.accent == a) { up { it.copy(accent = a) } }
                }
            }
            RowDivider(); Text(s.accent.label, Modifier.padding(horizontal = 16.dp, vertical = 11.dp), color = q.secondary, fontSize = 13.sp)
        }

        BarColorSection(stringResource(R.string.bar_color_light), s.barColorLight, dark = false) { c -> up { it.copy(barColorLight = c) } }
        BarColorSection(stringResource(R.string.bar_color_dark), s.barColorDark, dark = true) { c -> up { it.copy(barColorDark = c) } }

        SegmentedSection(stringResource(R.string.bar_style), ToolbarStyle.entries.map { it.label }, s.toolbar.style.ordinal, stringResource(R.string.bar_style_footer)) { i -> up { it.copy(toolbar = it.toolbar.copy(style = ToolbarStyle.entries[i])) } }

        SectionHeader(stringResource(R.string.app_icon))
        GroupCard {
            Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                AppIcon.entries.forEach { ic ->
                    val locked = ic.supportersOnly && !supporter
                    Column(Modifier.pressFade { if (locked) open(SettingsPage.SUPPORT) else up { it.copy(appIcon = ic) } }, horizontalAlignment = Alignment.CenterHorizontally) {
                        AppIconTile(ic, selected = s.appIcon == ic, size = 52.dp, locked = locked)
                        Spacer(Modifier.height(6.dp))
                        Text(ic.label, Modifier.widthIn(max = 64.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (s.appIcon == ic) q.text else q.secondary, fontSize = 12.sp, fontWeight = if (s.appIcon == ic) FontWeight.SemiBold else FontWeight.Normal)
                    }
                }
            }
        }
        SectionFooter(stringResource(if (supporter) R.string.app_icon_footer_supporter else R.string.app_icon_footer))

        SectionHeader(stringResource(R.string.haptic_feedback))
        GroupCard { ToggleRow(stringResource(R.string.vibrations), s.haptics) { v -> up { it.copy(haptics = v) } } }
    }
}

@Composable
private fun Swatch(color: Color, selected: Boolean, content: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val q = LocalQ.current
    Box(Modifier.size(34.dp).pressFade(onClick = onClick).then(if (selected) Modifier.border(1.5.dp, q.text, CircleShape) else Modifier).padding(4.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(color).border(0.5.dp, q.separator, CircleShape), contentAlignment = Alignment.Center) { content?.invoke() }
    }
}

@Composable
private fun BarColorSection(title: String, selected: BarColor, dark: Boolean, onSelect: (BarColor) -> Unit) {
    val q = LocalQ.current
    SectionHeader(title)
    GroupCard {
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 14.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            BarColor.entries.forEach { c ->
                if (c == BarColor.AUTO) Box(Modifier.size(34.dp).pressFade { onSelect(c) }.then(if (selected == c) Modifier.border(1.5.dp, q.text, CircleShape) else Modifier).padding(4.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(26.dp).clip(CircleShape).background(Brush.sweepGradient(listOf(Color(0xFFF6DCE6), Color(0xFFECE8F5), Color(0xFF7E91A8), Color(0xFFF2F2F7), Color(0xFFF6DCE6)))), contentAlignment = Alignment.Center) {
                        Text(stringResource(R.string.bar_auto_letter), color = Color(0xFF111111), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }
                } else Swatch(Color(c.argb), selected == c) { onSelect(c) }
            }
        }
        RowDivider()
        Text(if (selected == BarColor.AUTO) stringResource(if (dark) R.string.bar_auto_dark_desc else R.string.bar_auto_light_desc) else selected.label,
            Modifier.padding(horizontal = 16.dp, vertical = 11.dp), color = q.secondary, fontSize = 13.sp)
    }
}

/** Aperçu des icônes de l'application : la pyramide, mêmes couleurs que les ressources du lanceur. */
@Composable
fun AppIconTile(icon: AppIcon, selected: Boolean, size: Dp = 58.dp, locked: Boolean = false) {
    val q = LocalQ.current
    fun solid(c: Long) = SolidColor(Color(c))
    fun grad(a: Long, b: Long) = Brush.verticalGradient(listOf(Color(a), Color(b)))
    val (bg, lit, shade) = when (icon) {
        AppIcon.CLASSIC -> Triple(Color.White, solid(0xFF4A4E57), solid(0xFF17191C))
        AppIcon.DARK -> Triple(Color(0xFF17191C), solid(0xFFF2F4F7), solid(0xFF9FA6B0))
        AppIcon.INK -> Triple(Color(0xFF14233C), solid(0xFFF3EEE3), solid(0xFFBFB49C))
        AppIcon.DESERT -> Triple(Color(0xFFE9D7B7), solid(0xFFC0703E), solid(0xFF7A4E25))
        AppIcon.GOLD -> Triple(Color(0xFF0E0E10), grad(0xFFF8DC8C, 0xFFD6A548), grad(0xFFB8862E, 0xFF7E5A1C))
    }
    Box(Modifier.size(size)) {
        Box(Modifier.fillMaxSize().border(if (selected) 2.dp else 0.5.dp, if (selected) q.text else q.separator, RoundedCornerShape(size * 0.26f)).padding(3.dp)
            .clip(RoundedCornerShape(size * 0.21f)).background(bg)) {
            Canvas(Modifier.fillMaxSize()) {
                val k = this.size.width / 108f
                val z = 1.6f
                fun p(x: Float, y: Float) = Offset((54f + (x - 54f) * z) * k, (54f + (y - 52.5f) * z) * k)
                val a = p(50f, 33f); val l = p(26f, 72f); val f = p(59f, 72f); val r = p(82f, 72f)
                drawPath(Path().apply { moveTo(a.x, a.y); lineTo(l.x, l.y); lineTo(f.x, f.y); close() }, lit)
                drawPath(Path().apply { moveTo(a.x, a.y); lineTo(f.x, f.y); lineTo(r.x, r.y); close() }, shade)
            }
        }
        if (locked) Box(Modifier.align(Alignment.BottomEnd).size(20.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.75f)), contentAlignment = Alignment.Center) {
            QIconView(QIcon.LOCK, stringResource(R.string.supporters_only), Color.White, 12.dp)
        }
    }
}

// ---------------------------------------------------------------- Soutenir Qafila
@Composable
private fun SupportPage(store: BrowserStore) {
    val q = LocalQ.current
    val sup = store.support
    val supporter by sup.isSupporter.collectAsState()
    val price by sup.price.collectAsState()
    val busy by sup.busy.collectAsState()
    val message by sup.message.collectAsState()
    val s = settingsOf(store)
    val context = LocalContext.current
    val p = price ?: stringResource(R.string.support_fallback_price)
    val pink = SupportPink
    Column {
        Column(Modifier.fillMaxWidth().padding(start = 28.dp, end = 28.dp, top = 20.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AppIconTile(AppIcon.GOLD, selected = false, size = 96.dp)
            Spacer(Modifier.height(14.dp))
            Text(stringResource(R.string.page_support), color = q.text, fontSize = 24.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
            Spacer(Modifier.height(8.dp))
            Text(stringResource(R.string.support_pitch, p),
                color = q.secondary, fontSize = 15.sp, lineHeight = 21.sp, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.height(16.dp))
        if (supporter) {
            GroupCard {
                ActionRow(stringResource(R.string.support_you_support), color = pink, icon = QIcon.HEART_FILLED) {}
                RowDivider()
                ActionRow(stringResource(if (s.appIcon == AppIcon.GOLD) R.string.support_gold_in_use else R.string.support_use_gold), icon = if (s.appIcon == AppIcon.GOLD) QIcon.CHECK else null) {
                    store.updateSettings { it.copy(appIcon = AppIcon.GOLD) }
                }
                RowDivider()
                ActionRow(stringResource(R.string.support_manage), icon = QIcon.CHEVRON_RIGHT) { sup.manage(context) }
            }
        } else {
            Box(Modifier.padding(horizontal = 16.dp).fillMaxWidth().height(52.dp).clip(RoundedCornerShape(14.dp)).background(pink.copy(alpha = if (busy) 0.6f else 1f))
                .pressFade(enabled = !busy) { context.findActivity()?.let { sup.purchase(it) } }, contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.support_subscribe, p), Modifier.padding(horizontal = 16.dp), maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        SectionHeader(stringResource(R.string.support_what))
        GroupCard {
            ValueRow(stringResource(R.string.support_gold_icon), "✦"); RowDivider()
            ValueRow(stringResource(R.string.support_no_ads), stringResource(R.string.support_for_everyone)); RowDivider()
            ValueRow(stringResource(R.string.support_cancel_anytime), "")
        }
        Spacer(Modifier.height(24.dp))
        GroupCard { ActionRow(stringResource(R.string.support_restore)) { sup.restore() } }
        if (message != null) {
            Spacer(Modifier.height(12.dp))
            Text(message!!, Modifier.fillMaxWidth().padding(horizontal = 32.dp).pressFade { sup.message.value = null }, color = q.text, fontSize = 14.sp, textAlign = TextAlign.Center)
        }
        SectionFooter(stringResource(R.string.support_terms, p))
        Spacer(Modifier.height(10.dp))
        Text(stringResource(R.string.privacy_policy), Modifier.padding(horizontal = 32.dp).pressFade {
            store.showSettings.value = false; store.newTab(url = "https://fefe-kurylen.github.io/Qafila/confidentialite.html")
        }, color = q.accent, fontSize = 13.sp)
    }
}

// ---------------------------------------------------------------- Barre d'outils
@Composable
private fun ToolbarPage(store: BrowserStore, open: (SettingsPage) -> Unit) {
    val s = settingsOf(store)
    val q = LocalQ.current
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    Column {
        LivePreview(s)
        Spacer(Modifier.height(20.dp))
        GroupCard {
            NavRow(stringResource(R.string.customize_bar_menu), icon = QIcon.SLIDERS) { open(SettingsPage.EDITOR) }; RowDivider(50.dp)
            NavRow(stringResource(R.string.page_gallery), icon = QIcon.GRID) { open(SettingsPage.GALLERY) }
        }
        SegmentedSection(stringResource(R.string.position), ToolbarPosition.entries.map { it.label }, s.toolbar.position.ordinal) { i -> up { it.copy(toolbar = it.toolbar.copy(position = ToolbarPosition.entries[i])) } }
        Spacer(Modifier.height(10.dp))
        GroupCard { ToggleRow(stringResource(R.string.landscape_top_bar), s.landscapeTopBar) { v -> up { it.copy(landscapeTopBar = v) } } }

        SegmentedSection(stringResource(R.string.icon_weight), IconWeight.entries.map { it.label }, s.iconWeight.ordinal) { i -> up { it.copy(iconWeight = IconWeight.entries[i]) } }

        SectionHeader(stringResource(R.string.menu_icon))
        GroupCard {
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                MenuIconStyle.entries.forEach { m ->
                    val sel = s.menuIcon == m
                    Column(Modifier.pressFade { up { it.copy(menuIcon = m) } }.padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)).background(if (sel) q.fill else Color.Transparent).border(if (sel) 1.dp else 0.5.dp, if (sel) q.text else q.separator, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                            QIconView(ToolbarAction.MENU.qicon(menuIcon = m), m.label, q.text, 22.dp)
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(m.label, Modifier.widthIn(max = 92.dp), color = if (sel) q.text else q.secondary, fontSize = 12.sp, lineHeight = 15.sp, maxLines = 2, textAlign = TextAlign.Center)
                    }
                }
            }
        }

        SectionHeader(stringResource(R.string.on_scroll))
        ChoiceCard(ScrollBehavior.entries, s.scrollBehavior, { it.label }, { stringResource(it.descriptionRes) }) { v -> up { it.copy(scrollBehavior = v) } }

        SectionHeader(stringResource(R.string.gestures))
        GroupCard { ToggleRow(stringResource(R.string.swipe_address), s.swipeBarNavigation) { v -> up { it.copy(swipeBarNavigation = v) } } }
        SectionFooter(stringResource(R.string.swipe_address_footer))
    }
}

// ---------------------------------------------------------------- Barre d'adresse
@Composable
private fun AddressPage(store: BrowserStore) {
    val s = settingsOf(store)
    val q = LocalQ.current
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    val bar = barColorsFor(resolveBarColor(s, q.dark, if (q.dark) Color(0xFF1E1D1B) else Color(0xFFF6F3EE), private = false, darkened = false))
    Column {
        LivePreview(s)
        SectionHeader(stringResource(R.string.style))
        GroupCard {
            AddressStyle.entries.forEachIndexed { i, st ->
                Column(Modifier.fillMaxWidth().rowClick { up { it.copy(addressStyle = st) } }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(st.label, color = q.text, fontSize = 15.sp)
                            Text(stringResource(st.descriptionRes), color = q.secondary, fontSize = 12.5.sp, lineHeight = 16.sp)
                        }
                        if (s.addressStyle == st) QIconView(QIcon.CHECK, stringResource(R.string.selected), q.accent, 18.dp)
                    }
                    Spacer(Modifier.height(10.dp))
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bar.bg).padding(8.dp)) {
                        if (st == AddressStyle.HIDDEN) Row(Modifier.fillMaxWidth().height(36.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                            listOf(QIcon.PLUS, QIcon.SEARCH, QIcon.TABS, QIcon.DOTS).forEach { QIconView(it, null, bar.text, 18.dp) }
                        } else AddressView(sampleChromeData(), s, bar, inline = false, interactive = false, cb = ChromeCallbacks(), styleOverride = st)
                    }
                }
                if (i < AddressStyle.entries.lastIndex) RowDivider()
            }
        }
        SectionHeader(stringResource(R.string.content))
        GroupCard {
            ToggleRow(stringResource(R.string.show_favicon), s.addressShowsFavicon) { v -> up { it.copy(addressShowsFavicon = v) } }; RowDivider()
            ToggleRow(stringResource(R.string.show_reading_time), s.addressShowsReadingTime) { v -> up { it.copy(addressShowsReadingTime = v) } }
        }
        SectionHeader(stringResource(R.string.address_tap))
        ChoiceCard(AddressTapAction.entries, s.addressTap, { it.label }) { v -> up { it.copy(addressTap = v) } }
        SectionHeader(stringResource(R.string.address_long_press))
        if (s.addressTap == AddressTapAction.MENU) {
            GroupCard { ValueRow(stringResource(R.string.long_press), stringResource(R.string.tap_edit_address)) }
            SectionFooter(stringResource(R.string.long_press_footer))
        } else ChoiceCard(AddressLongPressAction.entries, s.addressLongPress, { it.label }) { v -> up { it.copy(addressLongPress = v) } }
    }
}

// ---------------------------------------------------------------- Onglets
@Composable
private fun TabsPage(store: BrowserStore) {
    val s = settingsOf(store)
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    Column {
        SegmentedSection(stringResource(R.string.layout), TabsLayout.entries.map { it.label }, s.tabsLayout.ordinal) { i -> up { it.copy(tabsLayout = TabsLayout.entries[i]) } }
        if (s.tabsLayout == TabsLayout.GRID) SegmentedSection(stringResource(R.string.thumbnails), GridSize.entries.map { it.label }, s.tabsGridSize.ordinal) { i -> up { it.copy(tabsGridSize = GridSize.entries[i]) } }
        SectionHeader(stringResource(R.string.sort_by))
        ChoiceCard(TabsSort.entries, s.tabsSort, { it.label }) { v -> up { it.copy(tabsSort = v) } }
        Spacer(Modifier.height(10.dp))
        GroupCard { ToggleRow(stringResource(R.string.group_by_site), s.groupTabsByDomain) { v -> up { it.copy(groupTabsByDomain = v) } } }
        SectionHeader(stringResource(R.string.new_tab_opens))
        GroupCard {
            NewTabPage.entries.forEachIndexed { i, p ->
                CheckRow(p.label, s.newTabPage == p) { up { it.copy(newTabPage = p) } }
                if (p == NewTabPage.CUSTOM && s.newTabPage == NewTabPage.CUSTOM) { RowDivider(); TextFieldRow("https://example.org", s.newTabCustomUrl) { v -> up { it.copy(newTabCustomUrl = v) } } }
                if (i < NewTabPage.entries.lastIndex) RowDivider()
            }
        }
        SectionHeader(stringResource(R.string.auto_close_tabs))
        ChoiceCard(AutoCloseTabs.entries, s.autoCloseTabs, { it.label }) { v -> up { it.copy(autoCloseTabs = v) } }
        SectionFooter(stringResource(R.string.auto_close_footer))
        SectionHeader(stringResource(R.string.comfort))
        GroupCard { ToggleRow(stringResource(R.string.comfort_mode), s.comfortMode, subtitle = stringResource(R.string.comfort_mode_sub)) { v -> up { it.copy(comfortMode = v) } } }
    }
}

// ---------------------------------------------------------------- Recherche
@Composable
private fun SearchPage(store: BrowserStore) {
    val s = settingsOf(store)
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    Column {
        SectionHeader(stringResource(R.string.search_engine))
        GroupCard {
            SearchEngine.entries.forEachIndexed { i, e ->
                CheckRow(e.label, s.searchEngine == e) { up { it.copy(searchEngine = e) } }
                if (s.searchEngine == e && e.needsBaseUrl) { RowDivider(); TextFieldRow(if (e == SearchEngine.QAFILA) "https://qafila.example.org" else "https://searxng.example.org", s.searchBaseUrl) { v -> up { it.copy(searchBaseUrl = v) } } }
                if (s.searchEngine == e && e == SearchEngine.CUSTOM) { RowDivider(); TextFieldRow("https://example.org/search?q=%s", s.customSearchTemplate) { v -> up { it.copy(customSearchTemplate = v) } } }
                if (i < SearchEngine.entries.lastIndex) RowDivider()
            }
        }
        if (s.searchEngine == SearchEngine.CUSTOM) SectionFooter(stringResource(R.string.custom_search_footer))
        SectionHeader(stringResource(R.string.suggestions))
        ChoiceCard(SuggestionsMode.entries, s.suggestionsMode, { it.label }) { v -> up { it.copy(suggestionsMode = v) } }
        SectionFooter(stringResource(R.string.suggestions_footer))
        SectionHeader(stringResource(R.string.results))
        GroupCard { ToggleRow(stringResource(R.string.hide_ai), s.hideAiAnswers) { v -> up { it.copy(hideAiAnswers = v) } } }
        SectionFooter(stringResource(R.string.hide_ai_footer))
    }
}

// ---------------------------------------------------------------- Confidentialité
@Composable
private fun PrivacyPage(store: BrowserStore) {
    val s = settingsOf(store)
    val q = LocalQ.current
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    var confirm by remember { mutableStateOf(false) }
    Column {
        SectionHeader(stringResource(R.string.action_blocker))
        GroupCard {
            ToggleRow(stringResource(R.string.block_ads), s.blockAds) { v -> up { it.copy(blockAds = v) } }; RowDivider()
            ToggleRow(stringResource(R.string.block_trackers), s.blockTrackers) { v -> up { it.copy(blockTrackers = v) } }; RowDivider()
            ToggleRow(stringResource(R.string.hide_cookie_banners), s.blockCookieBanners) { v -> up { it.copy(blockCookieBanners = v) } }
        }
        val ads = ContentBlocker.adDomains.size
        val trackers = ContentBlocker.trackerDomains.size
        SectionFooter(stringResource(R.string.blocker_lists_footer, pluralStringResource(R.plurals.ad_networks_count, ads, ads), pluralStringResource(R.plurals.trackers_count, trackers, trackers)))
        SectionHeader(stringResource(R.string.blocker_off_sites))
        HostListCard(s.blockerDisabledHosts, stringResource(R.string.blocker_off_empty, stringResource(R.string.menu_blocker_off_here))) { h -> up { it.copy(blockerDisabledHosts = it.blockerDisabledHosts - h) } }

        SectionHeader(stringResource(R.string.javascript))
        GroupCard { ToggleRow(stringResource(R.string.javascript), s.javascriptEnabled) { v -> up { it.copy(javascriptEnabled = v) } } }
        SectionHeader(stringResource(R.string.js_off_sites))
        HostListCard(s.javascriptDisabledHosts, stringResource(R.string.js_off_empty)) { h -> up { it.copy(javascriptDisabledHosts = it.javascriptDisabledHosts - h) } }

        SectionHeader(stringResource(R.string.security))
        GroupCard { ToggleRow(stringResource(R.string.upgrade_https), s.upgradeToHttps) { v -> up { it.copy(upgradeToHttps = v) } } }

        SectionHeader(stringResource(R.string.data))
        GroupCard {
            ToggleRow(stringResource(R.string.clear_on_close_all), s.clearOnCloseAll) { v -> up { it.copy(clearOnCloseAll = v) } }; RowDivider()
            ActionRow(stringResource(if (confirm) R.string.tap_again_to_clear else R.string.clear_history_data), q.destructive) {
                if (confirm) { store.clearBrowsingData(); confirm = false } else confirm = true
            }
        }
        SectionHeader(stringResource(R.string.advanced))
        GroupCard { TextFieldRow(stringResource(R.string.custom_user_agent), s.customUserAgent, androidx.compose.ui.text.input.KeyboardType.Text) { v -> up { it.copy(customUserAgent = v) } } }
        SectionFooter(stringResource(R.string.privacy_footer))
    }
}

// ---------------------------------------------------------------- Lecture
@Composable
private fun ReadingPage(store: BrowserStore) {
    val s = settingsOf(store)
    val q = LocalQ.current
    fun up(c: (Settings) -> Settings) = store.updateSettings(c)
    Column {
        SectionHeader(stringResource(R.string.action_darken))
        GroupCard {
            ToggleRow(stringResource(R.string.darken_all), s.darkenSites) { v -> up { it.copy(darkenSites = v) } }; RowDivider()
            ToggleRow(stringResource(R.string.darken_only_dark), s.darkenOnlyInDarkMode, enabled = s.darkenSites) { v -> up { it.copy(darkenOnlyInDarkMode = v) } }
        }
        SectionHeader(stringResource(if (s.darkenSites) R.string.never_darkened else R.string.always_darkened))
        HostListCard(s.darkenHosts, stringResource(R.string.darken_empty, stringResource(R.string.action_darken))) { h -> up { it.copy(darkenHosts = it.darkenHosts - h) } }

        SectionHeader(stringResource(R.string.text_size))
        GroupCard {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).pressFade(enabled = s.textZoom > 80) { up { it.copy(textZoom = (it.textZoom - 10).coerceAtLeast(80)) } }, contentAlignment = Alignment.Center) { Text(stringResource(R.string.text_size_letter), color = q.text, fontSize = 13.sp) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.percent, s.textZoom), color = q.text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                    Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        (80..150 step 10).forEach { v -> Box(Modifier.size(6.dp).clip(CircleShape).background(if (v <= s.textZoom) q.text else q.tertiary)) }
                    }
                }
                Box(Modifier.size(44.dp).pressFade(enabled = s.textZoom < 150) { up { it.copy(textZoom = (it.textZoom + 10).coerceAtMost(150)) } }, contentAlignment = Alignment.Center) { Text(stringResource(R.string.text_size_letter), color = q.text, fontSize = 21.sp) }
            }
            RowDivider()
            Text(stringResource(R.string.text_size_sample), Modifier.padding(16.dp), color = q.text, fontSize = (15f * s.textZoom / 100f).sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
        }

        SectionHeader(stringResource(R.string.translation_language))
        ChoiceCard(TranslateLanguage.entries, s.translateLanguage, { it.label }) { v -> up { it.copy(translateLanguage = v) } }

        SectionHeader(stringResource(R.string.action_desktop_site))
        GroupCard { ToggleRow(stringResource(R.string.desktop_by_default), s.desktopByDefault) { v -> up { it.copy(desktopByDefault = v) } } }
        SectionHeader(stringResource(if (s.desktopByDefault) R.string.mobile_sites else R.string.desktop_sites))
        HostListCard(s.desktopHosts, stringResource(R.string.desktop_empty, stringResource(R.string.menu_desktop_version))) { h -> up { it.copy(desktopHosts = it.desktopHosts - h) } }
    }
}

// ---------------------------------------------------------------- Énergie
@Composable
private fun EnergyPage(store: BrowserStore) {
    val s = settingsOf(store)
    val power by store.powerSave.collectAsState()
    Column {
        Spacer(Modifier.height(12.dp))
        GroupCard {
            ToggleRow(stringResource(R.string.suspend_background_tabs), s.suspendTabsInPowerSave, subtitle = stringResource(R.string.in_power_save)) { v -> store.updateSettings { it.copy(suspendTabsInPowerSave = v) } }
            RowDivider()
            ValueRow(stringResource(R.string.power_save), stringResource(if (power) R.string.on else R.string.off))
        }
        SectionFooter(stringResource(R.string.energy_footer))
    }
}

// ---------------------------------------------------------------- À propos
@Composable
private fun AboutPage(store: BrowserStore) {
    val q = LocalQ.current
    val webview = remember { runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull() }
    Column {
        Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AppIconTile(settingsOf(store).appIcon, selected = false)
            Spacer(Modifier.height(10.dp))
            Text(stringResource(R.string.app_name), color = q.text, fontSize = 26.sp, fontFamily = androidx.compose.ui.text.font.FontFamily.Serif)
            Text(stringResource(R.string.app_name_arabic), color = q.secondary, fontSize = 16.sp)
            if (store.support.isSupporter.collectAsState().value) {
                Spacer(Modifier.height(8.dp))
                Text(stringResource(R.string.support_thanks), color = SupportPink, fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
        GroupCard {
            ValueRow(stringResource(R.string.version), fr.qafila.browser.BuildConfig.VERSION_NAME); RowDivider()
            ValueRow(stringResource(R.string.engine), stringResource(R.string.webview) + (webview?.let { " $it" } ?: ""))
        }
        SectionHeader(stringResource(R.string.page_privacy))
        GroupCard {
            Text(stringResource(R.string.about_privacy),
                Modifier.padding(16.dp), color = q.text, fontSize = 14.sp, lineHeight = 19.sp, textAlign = TextAlign.Start, overflow = TextOverflow.Clip)
        }
        Spacer(Modifier.height(20.dp))
        GroupCard {
            ActionRow(stringResource(R.string.source_code), icon = QIcon.CHEVRON_RIGHT) { store.showSettings.value = false; store.newTab(url = "https://github.com/Fefe-Kurylen/Qafila") }
        }
    }
}

/** Rose du soutien (cœur, bouton S'abonner) : la seule couleur des réglages, le reste est monochrome. */
private val SupportPink = Color(0xFFED4D73)

private tailrec fun Context.findActivity(): Activity? = when (this) { is Activity -> this; is ContextWrapper -> baseContext.findActivity(); else -> null }
