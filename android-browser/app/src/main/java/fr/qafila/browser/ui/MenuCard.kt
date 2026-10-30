package fr.qafila.browser.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewModelScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import fr.qafila.browser.R
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.data.ToolbarAction
import fr.qafila.browser.data.ToolbarSlot
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Regroupe les éléments du menu : tuiles (sans intitulé, consécutifs), lignes (avec intitulé), séparateurs. */
sealed interface MenuBlock {
    data class Tiles(val slots: List<ToolbarSlot>) : MenuBlock
    data class Line(val slot: ToolbarSlot) : MenuBlock
    data object Separator : MenuBlock
}

fun menuBlocks(menu: List<ToolbarSlot>): List<MenuBlock> {
    val out = mutableListOf<MenuBlock>()
    var tiles = mutableListOf<ToolbarSlot>()
    fun flush() { if (tiles.isNotEmpty()) { out += MenuBlock.Tiles(tiles.toList()); tiles = mutableListOf() } }
    for (s in menu) {
        when {
            s.action == ToolbarAction.ADDRESS || s.action == ToolbarAction.MENU -> Unit
            s.action == ToolbarAction.SEPARATOR -> { flush(); if (out.isNotEmpty() && out.last() != MenuBlock.Separator) out += MenuBlock.Separator }
            s.showsLabel -> { flush(); out += MenuBlock.Line(s) }
            else -> tiles += s
        }
    }
    flush()
    while (out.lastOrNull() == MenuBlock.Separator) out.removeAt(out.lastIndex)
    return out
}

/**
 * Menu flottant (DESIGN.md §3) : carte translucide 250 dp, rayon 18, ancrée au-dessus de la barre, côté du bouton Menu.
 * Rendu des éléments configurés : tuiles, lignes « intitulé à gauche / icône à droite », actions destructives en rouge.
 */
@Composable
fun MenuCard(store: BrowserStore, maxHeight: Dp, modifier: Modifier = Modifier) {
    val state by store.state.collectAsState()
    val nav by store.tabManager.navState.collectAsState()
    val reader by store.tabManager.readerActive.collectAsState()
    val q = LocalQ.current
    val tab = state.tabs.firstOrNull { it.id == state.selectedTabId }
    val n = tab?.let { nav[it.id] }

    fun act(a: ToolbarAction) {
        store.showMenu.value = false
        // Portée du ViewModel : l'action survit à la sortie du menu de la composition.
        store.viewModelScope.launch { delay(90); store.perform(a) }
    }
    fun enabled(a: ToolbarAction) = when (a) {
        ToolbarAction.BACK -> n?.canBack == true
        ToolbarAction.FORWARD -> n?.canForward == true
        ToolbarAction.SHARE, ToolbarAction.COPY_LINK, ToolbarAction.ADD_BOOKMARK, ToolbarAction.TRANSLATE, ToolbarAction.READER -> tab?.url != null
        else -> true
    }
    fun active(a: ToolbarAction): Boolean = tab != null && when (a) {
        ToolbarAction.BLOCKER -> store.isBlockerActive(store.hostOf(tab.url))
        ToolbarAction.DARKEN -> store.isDarkened(tab)
        ToolbarAction.JAVASCRIPT -> store.isJavaScriptEnabled(tab.url)
        ToolbarAction.DESKTOP_SITE -> store.isDesktop(tab)
        ToolbarAction.READER -> tab.id in reader
        ToolbarAction.ADD_BOOKMARK -> store.isBookmarked(tab)
        else -> false
    }
    @Composable fun label(a: ToolbarAction): String = when (a) {
        ToolbarAction.BLOCKER -> stringResource(if (active(a)) R.string.menu_blocker_off_here else R.string.menu_blocker_on_here)
        ToolbarAction.DARKEN -> stringResource(if (active(a)) R.string.menu_undarken else R.string.menu_darken_site)
        ToolbarAction.JAVASCRIPT -> stringResource(if (active(a)) R.string.menu_js_off else R.string.menu_js_on)
        ToolbarAction.DESKTOP_SITE -> stringResource(if (active(a)) R.string.menu_mobile_version else R.string.menu_desktop_version)
        ToolbarAction.READER -> stringResource(if (active(a)) R.string.menu_exit_reader else R.string.action_reader)
        ToolbarAction.ADD_BOOKMARK -> stringResource(if (active(a)) R.string.menu_remove_bookmark else R.string.action_add_bookmark)
        ToolbarAction.RELOAD -> stringResource(if (n?.loading == true) R.string.action_stop else R.string.action_reload)
        ToolbarAction.CLOSE_TAB -> stringResource(R.string.menu_close_this_tab)
        ToolbarAction.CLOSE_ALL_TABS -> state.tabs.size.let { c -> if (c > 1) pluralStringResource(R.plurals.close_n_tabs, c, c) else stringResource(R.string.action_close_tab) }
        else -> a.label
    }
    /** Intitulé court des tuiles (suit l'état : Arrêter pendant le chargement, Retirer un favori…). */
    @Composable fun tileLabel(a: ToolbarAction): String = when (a) {
        ToolbarAction.RELOAD -> stringResource(if (n?.loading == true) R.string.action_stop else R.string.action_reload)
        else -> a.shortLabel
    }
    fun icon(a: ToolbarAction) = if (a == ToolbarAction.RELOAD && n?.loading == true) QIcon.CLOSE else a.qicon(active(a), state.settings.menuIcon)

    val blocks = menuBlocks(state.settings.toolbar.menu)
    FloatingCard(modifier) {
        Column(Modifier.heightIn(max = maxHeight).verticalScroll(rememberScrollState())) {
            // Adresse masquée sans bouton Rechercher : la saisie reste accessible depuis le menu.
            val s = state.settings
            if (s.addressStyle == fr.qafila.browser.data.AddressStyle.HIDDEN && s.toolbar.bar.none { it.action == ToolbarAction.ADDRESS || it.action == ToolbarAction.SEARCH }) {
                MenuLine(stringResource(R.string.search_or_enter_address), QIcon.SEARCH) { act(ToolbarAction.SEARCH) }
                if (blocks.isNotEmpty()) Hairline()
            }
            if (blocks.isEmpty()) Text(stringResource(R.string.menu_empty), Modifier.padding(16.dp), color = q.secondary, fontSize = 13.sp)
            blocks.forEach { b ->
                when (b) {
                    MenuBlock.Separator -> Hairline()
                    is MenuBlock.Line -> {
                        val a = b.slot.action
                        val color = if (a.destructive) q.destructive else q.text
                        Box(Modifier.alpha(if (enabled(a)) 1f else 0.3f)) {
                            MenuLine(label(a), icon(a), color) { if (enabled(a)) act(a) }
                        }
                    }
                    is MenuBlock.Tiles -> {
                        // Comme Quiche : jusqu'à 3 tuiles, un petit intitulé sous l'icône ; au-delà, icônes seules.
                        val withLabels = b.slots.size <= 3
                        Row(Modifier.fillMaxWidth().height(if (withLabels) 60.dp else 46.dp), verticalAlignment = Alignment.CenterVertically) {
                            b.slots.forEachIndexed { i, s ->
                                if (i > 0) Box(Modifier.width(0.5.dp).fillMaxHeight().background(q.separator))
                                val a = s.action
                                val color = if (a.destructive) q.destructive else q.text
                                Column(
                                    Modifier.weight(1f).fillMaxHeight().alpha(if (enabled(a)) 1f else 0.3f).rowClick(enabled = enabled(a)) { act(a) },
                                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                                ) {
                                    QIconView(icon(a), label(a), color, if (withLabels) 20.dp else 18.dp)
                                    if (withLabels) {
                                        Spacer(Modifier.height(5.dp))
                                        Text(tileLabel(a), color = color, fontSize = 11.5.sp, lineHeight = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 5.dp))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
