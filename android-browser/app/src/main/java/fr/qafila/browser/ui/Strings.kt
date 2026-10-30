package fr.qafila.browser.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.LayoutDirection
import fr.qafila.browser.R
import fr.qafila.browser.data.BrowserTab
import fr.qafila.browser.data.Labeled
import fr.qafila.browser.data.ToolbarAction

/** Intitulé localisé d'une valeur de réglage (enum [Labeled]). */
val Labeled.label: String
    @Composable @ReadOnlyComposable get() = stringResource(labelRes)

/** Intitulé court d'une action (tuiles du menu). */
val ToolbarAction.shortLabel: String
    @Composable @ReadOnlyComposable get() = stringResource(shortRes)

/** Titre d'onglet affiché : « Nouvel onglet » (localisé) pour une page de démarrage. */
@Composable @ReadOnlyComposable
fun BrowserTab.uiTitle(): String = displayTitle.ifEmpty { stringResource(R.string.new_tab) }

/** Temps de lecture « 19 min » (null si inconnu). */
@Composable @ReadOnlyComposable
fun readingLabel(minutes: Int): String? = if (minutes > 0) stringResource(R.string.reading_minutes, minutes) else null

/** Interface en arabe (droite à gauche) ? */
@Composable @ReadOnlyComposable
fun isRtl(): Boolean = LocalLayoutDirection.current == LayoutDirection.Rtl

/** Adresses et domaines : toujours écrits de gauche à droite, même en arabe. */
val LtrText = TextStyle(textDirection = TextDirection.Ltr)

/** Alignement d'une adresse LTR calée côté « début » de l'interface (à droite en arabe). */
@Composable @ReadOnlyComposable
fun urlAlign(): TextAlign = if (isRtl()) TextAlign.Right else TextAlign.Left
