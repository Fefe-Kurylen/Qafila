package fr.qafila.browser.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import fr.qafila.browser.R
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.data.ButtonSize
import fr.qafila.browser.data.ToolbarAction
import fr.qafila.browser.data.ToolbarConfig
import fr.qafila.browser.data.ToolbarSlot

/** Éditeur : barre et menu — ordre, taille, intitulé dans le menu, séparateurs, ajout / retrait. Aperçu en direct en haut. */
@Composable
fun ToolbarEditorPage(store: BrowserStore, backLabel: String, onBack: () -> Unit, openGallery: () -> Unit) {
    val state by store.state.collectAsState()
    val s = state.settings
    val cfg = s.toolbar
    val q = LocalQ.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
    fun set(c: ToolbarConfig) = store.updateSettings { it.copy(toolbar = c) }
    val slots = if (tab == 0) cfg.bar else cfg.menu
    fun change(list: List<ToolbarSlot>) = set(if (tab == 0) cfg.copy(bar = list) else cfg.copy(menu = list))
    val used = slots.map { it.action }.toSet()
    val available = ToolbarAction.entries.filter { a ->
        a != ToolbarAction.SEPARATOR && a !in used && !(tab == 1 && (a == ToolbarAction.ADDRESS || a == ToolbarAction.MENU || a == ToolbarAction.STOP))
    }

    QPage(stringResource(R.string.action_customize), onBack, backLabel = backLabel, header = {
        Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp)) { ChromePreview(s, compact = true) }
        Segmented(listOf(stringResource(R.string.editor_bar), stringResource(R.string.action_menu)), tab, Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp)) { tab = it }
    }) {
        item {
            val count = slots.count { it.action != ToolbarAction.SEPARATOR }
            SectionHeader(stringResource(R.string.editor_section, stringResource(if (tab == 0) R.string.editor_bar else R.string.action_menu), pluralStringResource(R.plurals.items_count, count, count)))
            GroupCard {
                if (slots.isEmpty()) Text(stringResource(R.string.no_items), Modifier.padding(16.dp), color = q.secondary, fontSize = 14.sp)
                slots.forEachIndexed { i, slot ->
                    SlotRow(slot, inMenu = tab == 1, first = i == 0, last = i == slots.lastIndex,
                        onRemove = { change(slots - slot) },
                        onMove = { d -> change(slots.toMutableList().apply { add(i + d, removeAt(i)) }) },
                        onUpdate = { u -> change(slots.map { if (it.id == slot.id) u else it }) })
                    if (i < slots.lastIndex) RowDivider(52.dp)
                }
            }
            SectionFooter(if (tab == 0) stringResource(R.string.editor_bar_footer, ToolbarAction.ADDRESS.label) else stringResource(R.string.editor_menu_footer))
        }
        item {
            SectionHeader(stringResource(R.string.add))
            GroupCard {
                (available + ToolbarAction.SEPARATOR).forEachIndexed { i, a ->
                    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).rowClick { change(slots + ToolbarSlot(action = a, showsLabel = tab == 0 || a.destructive || a == ToolbarAction.SEPARATOR || slots.lastOrNull()?.showsLabel != false)) }
                        .padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(22.dp).clip(CircleShape).background(q.text), contentAlignment = Alignment.Center) { QIconView(QIcon.PLUS, stringResource(R.string.add), q.card, 14.dp) }
                        Spacer(Modifier.width(12.dp))
                        QIconView(a.qicon(menuIcon = s.menuIcon), null, if (a.destructive) q.destructive else q.text, 19.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(a.label, color = q.text, fontSize = 15.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    if (i < available.size) RowDivider(52.dp)
                }
            }
        }
        item {
            Spacer(Modifier.height(24.dp))
            GroupCard {
                NavRow(stringResource(R.string.page_gallery), icon = QIcon.GRID, onClick = openGallery); RowDivider(50.dp)
                ActionRow(stringResource(R.string.reset_bar_menu), q.destructive) { set(ToolbarConfig.preset(ToolbarConfig.Preset.COMPLETE).copy(style = cfg.style, position = cfg.position)) }
            }
        }
    }
}

@Composable
private fun SlotRow(slot: ToolbarSlot, inMenu: Boolean, first: Boolean, last: Boolean, onRemove: () -> Unit, onMove: (Int) -> Unit, onUpdate: (ToolbarSlot) -> Unit) {
    val q = LocalQ.current
    val a = slot.action
    val removeLabel = stringResource(R.string.remove)
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(28.dp).pressFade(onClick = onRemove).semantics { contentDescription = removeLabel }, contentAlignment = Alignment.Center) {
            Box(Modifier.size(20.dp).clip(CircleShape).background(q.destructive), contentAlignment = Alignment.Center) { Box(Modifier.width(9.dp).height(1.6.dp).background(Color.White)) }
        }
        Spacer(Modifier.width(8.dp))
        if (a == ToolbarAction.SEPARATOR) {
            Box(Modifier.weight(1f).height(20.dp), contentAlignment = Alignment.CenterStart) { Hairline(Modifier.padding(end = 12.dp), q.secondary) }
        } else {
            QIconView(a.qicon(), null, if (a.destructive) q.destructive else q.text, 20.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.label, color = q.text, fontSize = 15.sp, lineHeight = 19.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Row(Modifier.padding(top = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (!inMenu && a != ToolbarAction.ADDRESS) MiniSegment(ButtonSize.entries.map { it.label.take(1) }, slot.size.ordinal) { onUpdate(slot.copy(size = ButtonSize.entries[it])) }
                    if (inMenu) Chip(stringResource(if (slot.showsLabel) R.string.row_with_label else R.string.tile), selected = slot.showsLabel) { onUpdate(slot.copy(showsLabel = !slot.showsLabel)) }
                }
            }
        }
        Box(Modifier.size(34.dp).pressFade(enabled = !first) { onMove(-1) }, contentAlignment = Alignment.Center) { QIconView(QIcon.CHEVRON_UP, stringResource(R.string.move_up), q.text.copy(alpha = if (first) 0.25f else 1f), 16.dp) }
        Box(Modifier.size(34.dp).pressFade(enabled = !last) { onMove(1) }, contentAlignment = Alignment.Center) { QIconView(QIcon.CHEVRON_DOWN, stringResource(R.string.move_down), q.text.copy(alpha = if (last) 0.25f else 1f), 16.dp) }
    }
}

@Composable
private fun MiniSegment(options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    val q = LocalQ.current
    Row(Modifier.clip(RoundedCornerShape(7.dp)).background(q.fill).padding(2.dp)) {
        options.forEachIndexed { i, o ->
            val sel = i == selected
            Box(Modifier.size(28.dp, 20.dp).clip(RoundedCornerShape(5.dp)).background(if (sel) q.card else Color.Transparent).pressFade { onSelect(i) }, contentAlignment = Alignment.Center) {
                Text(o, color = if (sel) q.text else q.secondary, fontSize = 11.sp, fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}

@Composable
private fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    val q = LocalQ.current
    Text(text, Modifier.clip(RoundedCornerShape(50)).border(0.5.dp, if (selected) q.text else q.separator, RoundedCornerShape(50)).pressFade(onClick = onClick).padding(horizontal = 9.dp, vertical = 3.dp),
        color = if (selected) q.text else q.secondary, fontSize = 11.sp)
}

/** Galerie de barres (DESIGN.md §7) : six barres prêtes à l'emploi, avec aperçu. */
@Composable
fun ToolbarGalleryPage(store: BrowserStore, backLabel: String, onBack: () -> Unit) {
    val state by store.state.collectAsState()
    val s = state.settings
    val q = LocalQ.current
    QPage(stringResource(R.string.page_gallery), onBack, backLabel = backLabel) {
        item { SectionFooter(stringResource(R.string.gallery_footer)); Spacer(Modifier.height(6.dp)) }
        ToolbarConfig.Preset.entries.forEach { p ->
            item(p.name) {
                val cfg = ToolbarConfig.preset(p).copy(style = s.toolbar.style, position = s.toolbar.position)
                val current = s.toolbar.bar.map { it.action } == cfg.bar.map { it.action }
                Column(Modifier.padding(horizontal = 16.dp, vertical = 7.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(q.card)
                    .border(if (current) 1.5.dp else 0.dp, if (current) q.text else Color.Transparent, RoundedCornerShape(16.dp))
                    .rowClick { store.applyPreset(p) }.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.label, Modifier.weight(1f), color = q.text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                        if (current) QIconView(QIcon.CHECK, stringResource(R.string.current_bar), q.text, 18.dp)
                    }
                    Text(stringResource(p.descriptionRes), color = q.secondary, fontSize = 13.sp, lineHeight = 17.sp, modifier = Modifier.padding(top = 3.dp, bottom = 12.dp))
                    ChromePreview(s.copy(menuIcon = p.menuIcon ?: s.menuIcon), toolbar = cfg, compact = true)
                }
            }
        }
        item { Spacer(Modifier.height(8.dp)); Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { Text(stringResource(R.string.gallery_kept), Modifier.padding(horizontal = 32.dp), color = q.secondary, fontSize = 12.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center) } }
    }
}
