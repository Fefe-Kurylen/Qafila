package fr.qafila.browser.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import fr.qafila.browser.R
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.data.BrowserTab
import fr.qafila.browser.data.SettingsPage
import fr.qafila.browser.data.TabsLayout
import fr.qafila.browser.data.TabsSort

/** Onglets (DESIGN.md §4) : liste groupée / grille 2 ou 3 colonnes / carrousels par site ; barre « + · N onglets ⌃ · réglages ». */
@Composable
fun TabsScreen(store: BrowserStore, onDismiss: () -> Unit) {
    val state by store.state.collectAsState()
    val icons by store.tabManager.favicons.icons.collectAsState()
    val snapshots by store.tabManager.snapshots.collectAsState()
    val q = LocalQ.current
    val s = state.settings
    var showPrivate by rememberSaveable { mutableStateOf(state.tabs.firstOrNull { it.id == state.selectedTabId }?.isPrivate == true) }
    var pillMenu by remember { mutableStateOf(false) }
    BackHandler { if (pillMenu) pillMenu = false else onDismiss() }

    val visible = state.tabs.filter { it.isPrivate == showPrivate }.let { t ->
        when (s.tabsSort) { TabsSort.DATE -> t.sortedByDescending { it.lastVisited }; TabsSort.READING_TIME -> t.sortedByDescending { it.readingMinutes }; TabsSort.TITLE -> t.sortedBy { it.displayTitle.lowercase() } }
    }
    val newTabsLabel = stringResource(R.string.new_tabs_group)
    val otherSitesLabel = stringResource(R.string.other_sites)
    val groups: List<Pair<String, List<BrowserTab>>> = if (!s.groupTabsByDomain) listOf("" to visible) else {
        val byHost = visible.groupBy { it.hostOrNull ?: newTabsLabel }
        val multi = byHost.filter { it.value.size > 1 }.map { it.key to it.value }
        val singles = byHost.filter { it.value.size == 1 }.flatMap { it.value }
        multi + (if (singles.isEmpty()) emptyList() else listOf((if (multi.isEmpty()) "" else otherSitesLabel) to singles))
    }
    fun open(t: BrowserTab) { store.select(t.id); onDismiss() }
    fun favicon(t: BrowserTab) = icons[store.tabManager.favicons.keyOf(t.url)]
    val count = state.tabs.count { !it.isPrivate }
    val privateCount = state.tabs.count { it.isPrivate }

    Box(Modifier.fillMaxSize().background(q.groupedBg).blockTouches()) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (visible.isEmpty()) Text(stringResource(if (showPrivate) R.string.no_private_tabs else R.string.no_tabs), Modifier.align(Alignment.Center).padding(horizontal = 32.dp), color = q.secondary, fontSize = 15.sp, lineHeight = 21.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                else if (s.tabsLayout == TabsLayout.LIST) {
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 12.dp, bottom = 16.dp), reverseLayout = s.comfortMode) {
                        items(groups, key = { it.first.ifEmpty { "_" } }) { (host, tabs) ->
                            Column {
                                if (host.isNotEmpty()) GroupHeader(host)
                                else Spacer(Modifier.height(8.dp))
                                GroupCard {
                                    tabs.forEachIndexed { i, t ->
                                        TabListRow(store, t, favicon(t), t.id == state.selectedTabId, s.addressShowsReadingTime) { open(t) }
                                        if (i < tabs.lastIndex) RowDivider(start = 54.dp)
                                    }
                                }
                                Spacer(Modifier.height(6.dp))
                            }
                        }
                    }
                } else {
                    val cols = s.tabsGridSize.columns
                    if (s.groupTabsByDomain && groups.size > 1) {
                        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp), reverseLayout = s.comfortMode) {
                            items(groups, key = { it.first.ifEmpty { "_" } }) { (host, tabs) ->
                                Column {
                                    GroupHeader(host.ifEmpty { stringResource(R.string.action_tabs) })
                                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        items(tabs, key = { it.id }) { t ->
                                            TabThumb(t, favicon(t), snapshots[t.id], t.id == state.selectedTabId, Modifier.width(if (cols == 2) 150.dp else 104.dp), { open(t) }) { store.close(t.id) }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        LazyVerticalGrid(GridCells.Fixed(cols), Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), reverseLayout = s.comfortMode,
                            horizontalArrangement = Arrangement.spacedBy(if (cols == 2) 14.dp else 10.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (s.groupTabsByDomain && groups.firstOrNull()?.first?.isNotEmpty() == true) item(span = { GridItemSpan(maxLineSpan) }) { GroupHeader(groups.first().first) }
                            items(visible, key = { it.id }) { t -> TabThumb(t, favicon(t), snapshots[t.id], t.id == state.selectedTabId, Modifier, { open(t) }) { store.close(t.id) } }
                        }
                    }
                }
            }
            // Barre du bas : +   « N onglets ⌃ »   réglages
            Row(Modifier.fillMaxWidth().background(q.groupedBg).navigationBarsPadding().height(54.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(44.dp).pressFade { store.newTab(isPrivate = showPrivate); onDismiss() }, contentAlignment = Alignment.Center) { QIconView(QIcon.PLUS, stringResource(R.string.new_tab), q.text, 22.dp) }
                Spacer(Modifier.weight(1f))
                Row(Modifier.clip(RoundedCornerShape(50)).background(q.fill).pressFade { pillMenu = !pillMenu }.padding(start = 14.dp, end = 10.dp, top = 7.dp, bottom = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                    val n = if (showPrivate) privateCount else count
                    Text(pluralStringResource(if (showPrivate) R.plurals.private_count else R.plurals.tabs_count, n, n), color = q.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Spacer(Modifier.width(4.dp))
                    QIconView(QIcon.CHEVRON_UPDOWN, null, q.text, 13.dp)
                }
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(44.dp).pressFade { store.openSettings(SettingsPage.TABS, standalone = true) }, contentAlignment = Alignment.Center) { QIconView(QIcon.SLIDERS, stringResource(R.string.tab_settings), q.text, 22.dp) }
            }
        }

        if (pillMenu) Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null) { pillMenu = false })
        AnimatedVisibility(
            pillMenu, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 60.dp),
            enter = scaleIn(initialScale = 0.92f, transformOrigin = TransformOrigin(0.5f, 1f)) + fadeIn(), exit = scaleOut(targetScale = 0.92f, transformOrigin = TransformOrigin(0.5f, 1f)) + fadeOut(),
        ) {
            FloatingCard(width = 240.dp) {
                MenuLine(stringResource(R.string.action_tabs), QIcon.TABS, checked = !showPrivate) { showPrivate = false; pillMenu = false }
                MenuLine(stringResource(R.string.private_tabs) + if (privateCount > 0) " ($privateCount)" else "", QIcon.PRIVATE, checked = showPrivate) { showPrivate = true; pillMenu = false }
                Hairline()
                MenuLine(stringResource(R.string.sort_by_value, s.tabsSort.label), QIcon.LIST) {
                    store.updateSettings { it.copy(tabsSort = TabsSort.entries[(it.tabsSort.ordinal + 1) % TabsSort.entries.size]) }
                }
                MenuLine(stringResource(if (s.tabsLayout == TabsLayout.LIST) R.string.show_as_grid else R.string.show_as_list), if (s.tabsLayout == TabsLayout.LIST) QIcon.GRID else QIcon.LIST) {
                    store.updateSettings { it.copy(tabsLayout = if (it.tabsLayout == TabsLayout.LIST) TabsLayout.GRID else TabsLayout.LIST) }; pillMenu = false
                }
                Hairline()
                val n = if (showPrivate) privateCount else count
                MenuLine(if (n > 1) pluralStringResource(R.plurals.close_n_tabs, n, n) else stringResource(R.string.action_close_tab), QIcon.CLOSE, q.destructive) {
                    pillMenu = false; store.closeAllTabs(privateOnly = showPrivate); onDismiss()
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(host: String) =
    Text(host.uppercase(), Modifier.padding(start = 32.dp, end = 32.dp, top = 16.dp, bottom = 7.dp), color = LocalQ.current.secondary, fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TabListRow(store: BrowserStore, t: BrowserTab, fav: android.graphics.Bitmap?, current: Boolean, showRead: Boolean, onOpen: () -> Unit) {
    val q = LocalQ.current
    val dismiss = rememberSwipeToDismissBoxState(confirmValueChange = { v -> if (v == SwipeToDismissBoxValue.EndToStart) { store.close(t.id); true } else false })
    SwipeToDismissBox(
        state = dismiss, enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(Modifier.fillMaxSize().background(q.destructive).padding(end = 20.dp), contentAlignment = Alignment.CenterEnd) { Text(stringResource(R.string.action_close_tab_short), color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold) }
        },
    ) {
        Row(Modifier.fillMaxWidth().background(q.card).rowClick(onClick = onOpen).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Favicon(fav, t.hostOrNull, 26.dp, corner = 6.dp, private = t.isPrivate)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(t.uiTitle(), color = q.text, fontSize = 14.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.height(2.dp))
                Text(t.hostOrNull?.uppercase() ?: stringResource(R.string.newtab_start).uppercase(), color = q.secondary, fontSize = 10.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, style = if (t.hostOrNull != null) LtrText else androidx.compose.ui.text.TextStyle.Default)
            }
            if (current) { Spacer(Modifier.width(8.dp)); QIconView(QIcon.CHECK, stringResource(R.string.current_tab), q.secondary, 14.dp) }
            val read = readingLabel(t.readingMinutes)
            if (showRead && read != null) { Spacer(Modifier.width(8.dp)); Pill(read, q.fill, q.text) }
        }
    }
}

@Composable
private fun TabThumb(t: BrowserTab, fav: android.graphics.Bitmap?, snapshot: android.graphics.Bitmap?, current: Boolean, modifier: Modifier, onOpen: () -> Unit, onClose: () -> Unit) {
    val q = LocalQ.current
    Column(modifier.pressFade(onClick = onOpen)) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(14.dp)).background(q.card)
                .border(if (current) 2.dp else 0.5.dp, if (current) q.accent else q.separator, RoundedCornerShape(14.dp)),
        ) {
            if (snapshot != null) Image(snapshot.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop, alignment = Alignment.TopCenter)
            else Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Favicon(fav, t.hostOrNull, 34.dp, private = t.isPrivate)
                Spacer(Modifier.height(10.dp))
                Text(t.uiTitle(), color = q.secondary, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(26.dp).pressFade(onClick = onClose), contentAlignment = Alignment.Center) {
                Box(Modifier.size(22.dp).clip(CircleShape).background(if (q.dark) Color(0xCC3A3A3C) else Color(0xE6F2F2F7)), contentAlignment = Alignment.Center) {
                    QIconView(QIcon.CLOSE, stringResource(R.string.action_close_tab), q.text, 11.dp)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 2.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
            Favicon(fav, t.hostOrNull, 14.dp, corner = 3.dp, private = t.isPrivate)
            Spacer(Modifier.width(5.dp))
            Text(t.uiTitle(), color = q.text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
