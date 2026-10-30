package fr.qafila.browser.data

import androidx.annotation.StringRes
import fr.qafila.browser.R
import kotlinx.serialization.Serializable
import java.util.UUID

/** Un onglet : état persistant ; la WebView vit dans TabManager. */
@Serializable
data class BrowserTab(
    val id: String = UUID.randomUUID().toString(),
    val url: String? = null,
    val title: String = "",
    val isPrivate: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val lastVisited: Long = System.currentTimeMillis(),
    val readingMinutes: Int = 0,
    val themeColor: String? = null,
) {
    /** Domaine affiché (sans « www. » ni sous-domaine mobile « m. ») : sert aussi à grouper les onglets par site. */
    val hostOrNull: String? get() = runCatching { java.net.URI(url ?: return null).host?.lowercase()?.removePrefix("www.")?.replace(Regex("(^|\\.)m\\."), "$1") }.getOrNull()
    /** Titre affichable ; vide pour une page de démarrage (l'interface affiche alors « Nouvel onglet » dans la langue de l'appareil). */
    val displayTitle: String get() = title.ifBlank { hostOrNull ?: url ?: "" }
    /** Adresse sans « https:// » ni « www. ». */
    val shortUrl: String get() = (url ?: "").removePrefix("https://").removePrefix("http://").removePrefix("www.").removeSuffix("/")
}

@Serializable data class Bookmark(val id: String = UUID.randomUUID().toString(), val title: String, val url: String, val addedAt: Long = System.currentTimeMillis())
@Serializable data class HistoryEntry(val id: String = UUID.randomUUID().toString(), val title: String, val url: String, val visitedAt: Long = System.currentTimeMillis())

/**
 * Intitulé localisé d'une valeur de réglage : ressource chaîne, résolue par l'interface (stringResource / getString).
 * Seul le nom de la constante est sérialisé : les réglages enregistrés restent lisibles quelle que soit la langue.
 */
interface Labeled { @get:StringRes val labelRes: Int }

/** Toutes les actions disponibles pour la barre et le menu (chaque bouton peut être placé où l'on veut). */
@Serializable
enum class ToolbarAction(@StringRes override val labelRes: Int, val destructive: Boolean = false, @StringRes val shortRes: Int = labelRes) : Labeled {
    BACK(R.string.action_back), FORWARD(R.string.action_forward), RELOAD(R.string.action_reload), STOP(R.string.action_stop),
    TABS(R.string.action_tabs), NEW_TAB(R.string.new_tab), NEW_PRIVATE_TAB(R.string.action_new_private_tab), REOPEN_TAB(R.string.action_reopen_tab, shortRes = R.string.action_reopen_tab_short),
    CLOSE_TAB(R.string.action_close_tab, true, R.string.action_close_tab_short), CLOSE_ALL_TABS(R.string.action_close_all, true),
    CLOSE_ALL_AND_CLEAR(R.string.action_close_all_clear, true, R.string.action_close_all_clear_short),
    BOOKMARKS(R.string.action_bookmarks), ADD_BOOKMARK(R.string.action_add_bookmark, shortRes = R.string.action_add_bookmark_short), HISTORY(R.string.action_history),
    SHARE(R.string.action_share), COPY_LINK(R.string.action_copy_link, shortRes = R.string.action_copy_link_short),
    FIND(R.string.action_find, shortRes = R.string.action_find_short), SEARCH(R.string.action_search),
    BLOCKER(R.string.action_blocker), DARKEN(R.string.action_darken), READER(R.string.action_reader, shortRes = R.string.action_reader_short), JAVASCRIPT(R.string.javascript),
    DESKTOP_SITE(R.string.action_desktop_site, shortRes = R.string.action_desktop_site_short), TRANSLATE(R.string.action_translate),
    SCROLL_TOP(R.string.action_scroll_top, shortRes = R.string.action_scroll_top_short), SCROLL_BOTTOM(R.string.action_scroll_bottom, shortRes = R.string.action_scroll_bottom_short),
    HOME(R.string.action_home), SETTINGS(R.string.action_settings), CUSTOMIZE(R.string.action_customize), MENU(R.string.action_menu),
    /** Emplacement de l'adresse « en ligne » dans la rangée d'icônes (barre seulement). */
    ADDRESS(R.string.action_address),
    SEPARATOR(R.string.action_separator);
}

/** Taille d'icône dans la barre : Petit 17 / Moyen 20 / Grand 23. */
@Serializable enum class ButtonSize(@StringRes override val labelRes: Int, val dp: Int) : Labeled { SMALL(R.string.size_small, 17), MEDIUM(R.string.size_medium, 20), LARGE(R.string.size_large, 23) }

@Serializable
data class ToolbarSlot(val id: String = UUID.randomUUID().toString(), val action: ToolbarAction, val size: ButtonSize = ButtonSize.MEDIUM, val showsLabel: Boolean = true)

/** Matériau de la barre : couleur pleine ou translucide. */
@Serializable enum class ToolbarStyle(@StringRes override val labelRes: Int) : Labeled { CLASSIC(R.string.style_classic), GLASS(R.string.style_glass), FLOATING(R.string.style_floating) }
@Serializable enum class ToolbarPosition(@StringRes override val labelRes: Int) : Labeled { BOTTOM(R.string.position_bottom), TOP(R.string.position_top) }

@Serializable
data class ToolbarConfig(val bar: List<ToolbarSlot>, val menu: List<ToolbarSlot>, val style: ToolbarStyle = ToolbarStyle.CLASSIC, val position: ToolbarPosition = ToolbarPosition.BOTTOM) {
    val hasInlineAddress: Boolean get() = bar.any { it.action == ToolbarAction.ADDRESS }

    /** Galerie de barres (DESIGN.md §7). */
    enum class Preset(@StringRes override val labelRes: Int, @StringRes val descriptionRes: Int, val menuIcon: MenuIconStyle? = null) : Labeled {
        COMPLETE(R.string.preset_complete, R.string.preset_complete_desc),
        NAVIGATION(R.string.preset_navigation, R.string.preset_navigation_desc),
        TOOLS(R.string.preset_tools, R.string.preset_tools_desc),
        READER(R.string.preset_reader, R.string.preset_reader_desc),
        MINIMAL(R.string.preset_minimal, R.string.preset_minimal_desc, MenuIconStyle.LINES_CIRCLE),
        ZEN(R.string.preset_zen, R.string.preset_zen_desc),
    }

    companion object {
        private fun s(a: ToolbarAction, size: ButtonSize = ButtonSize.MEDIUM, label: Boolean = true) = ToolbarSlot(action = a, size = size, showsLabel = label)
        private val SEP get() = s(ToolbarAction.SEPARATOR)

        /** Menu par défaut (DESIGN.md §3) : tuiles Nouvel onglet | Onglet privé, lignes, actions rouges, tuiles de navigation. */
        fun defaultMenu(): List<ToolbarSlot> = listOf(
            s(ToolbarAction.NEW_TAB, label = false), s(ToolbarAction.NEW_PRIVATE_TAB, label = false), SEP,
            s(ToolbarAction.BOOKMARKS), s(ToolbarAction.HISTORY), s(ToolbarAction.ADD_BOOKMARK), SEP,
            s(ToolbarAction.BLOCKER), s(ToolbarAction.DARKEN), s(ToolbarAction.READER), SEP,
            s(ToolbarAction.SETTINGS), SEP,
            s(ToolbarAction.CLOSE_TAB), s(ToolbarAction.CLOSE_ALL_TABS), SEP,
            s(ToolbarAction.BACK, label = false), s(ToolbarAction.FORWARD, label = false), s(ToolbarAction.RELOAD, label = false), s(ToolbarAction.SHARE, label = false),
        )

        fun preset(p: Preset): ToolbarConfig = when (p) {
            Preset.COMPLETE -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.BACK), s(ToolbarAction.FORWARD), s(ToolbarAction.SHARE), s(ToolbarAction.NEW_TAB), s(ToolbarAction.TABS), s(ToolbarAction.MENU)),
                menu = defaultMenu())
            Preset.NAVIGATION -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.BACK), s(ToolbarAction.FORWARD), s(ToolbarAction.TABS), s(ToolbarAction.NEW_TAB), s(ToolbarAction.CLOSE_TAB)),
                menu = listOf(s(ToolbarAction.NEW_PRIVATE_TAB, label = false), s(ToolbarAction.SETTINGS, label = false), SEP,
                    s(ToolbarAction.BOOKMARKS), s(ToolbarAction.HISTORY), s(ToolbarAction.SHARE), s(ToolbarAction.COPY_LINK), SEP,
                    s(ToolbarAction.BLOCKER), s(ToolbarAction.DARKEN), s(ToolbarAction.READER), SEP,
                    s(ToolbarAction.CLOSE_ALL_TABS), SEP, s(ToolbarAction.RELOAD, label = false), s(ToolbarAction.FIND, label = false)))
            Preset.TOOLS -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.BACK), s(ToolbarAction.REOPEN_TAB), s(ToolbarAction.DESKTOP_SITE), s(ToolbarAction.READER), s(ToolbarAction.TABS), s(ToolbarAction.CLOSE_TAB), s(ToolbarAction.MENU)),
                menu = listOf(s(ToolbarAction.NEW_TAB, label = false), s(ToolbarAction.NEW_PRIVATE_TAB, label = false), SEP,
                    s(ToolbarAction.BOOKMARKS), s(ToolbarAction.HISTORY), s(ToolbarAction.FIND), s(ToolbarAction.TRANSLATE), SEP,
                    s(ToolbarAction.BLOCKER), s(ToolbarAction.JAVASCRIPT), s(ToolbarAction.DARKEN), SEP,
                    s(ToolbarAction.SETTINGS), SEP, s(ToolbarAction.CLOSE_ALL_AND_CLEAR), SEP,
                    s(ToolbarAction.FORWARD, label = false), s(ToolbarAction.RELOAD, label = false), s(ToolbarAction.SHARE, label = false), s(ToolbarAction.COPY_LINK, label = false)))
            Preset.READER -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.TRANSLATE), s(ToolbarAction.READER), s(ToolbarAction.JAVASCRIPT), s(ToolbarAction.SCROLL_TOP), s(ToolbarAction.NEW_TAB), s(ToolbarAction.TABS), s(ToolbarAction.CLOSE_TAB)),
                menu = listOf(s(ToolbarAction.NEW_PRIVATE_TAB, label = false), s(ToolbarAction.SETTINGS, label = false), SEP,
                    s(ToolbarAction.BOOKMARKS), s(ToolbarAction.HISTORY), s(ToolbarAction.ADD_BOOKMARK), s(ToolbarAction.SHARE), SEP,
                    s(ToolbarAction.DARKEN), s(ToolbarAction.BLOCKER), s(ToolbarAction.FIND), SEP,
                    s(ToolbarAction.CLOSE_ALL_TABS), SEP,
                    s(ToolbarAction.BACK, label = false), s(ToolbarAction.FORWARD, label = false), s(ToolbarAction.RELOAD, label = false), s(ToolbarAction.SCROLL_BOTTOM, label = false)))
            Preset.MINIMAL -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.ADDRESS), s(ToolbarAction.TABS), s(ToolbarAction.MENU)),
                menu = defaultMenu())
            Preset.ZEN -> ToolbarConfig(
                bar = listOf(s(ToolbarAction.NEW_TAB), s(ToolbarAction.ADDRESS), s(ToolbarAction.TABS), s(ToolbarAction.CLOSE_TAB)),
                menu = defaultMenu())
        }
    }
}

@Serializable
enum class SearchEngine(@StringRes override val labelRes: Int, val needsBaseUrl: Boolean = false) : Labeled {
    DUCKDUCKGO(R.string.engine_duckduckgo), KAGI(R.string.engine_kagi), QWANT(R.string.engine_qwant), BRAVE(R.string.engine_brave), STARTPAGE(R.string.engine_startpage), ECOSIA(R.string.engine_ecosia),
    GOOGLE(R.string.engine_google), BING(R.string.engine_bing), SEARXNG(R.string.engine_searxng, true), QAFILA(R.string.engine_qafila, true), CUSTOM(R.string.engine_custom);

    /** URL de recherche. [base] : instance SearXNG / serveur Qafila ; [template] : modèle personnalisé avec %s. */
    fun url(query: String, base: String, template: String = "", hideAi: Boolean = false): String {
        val q = java.net.URLEncoder.encode(query, "UTF-8")
        val b = base.trim().trimEnd('/')
        return when (this) {
            QAFILA -> "${b.ifEmpty { "https://qafila.example.com" }}/?q=$q"
            DUCKDUCKGO -> if (hideAi) "https://noai.duckduckgo.com/?q=$q" else "https://duckduckgo.com/?q=$q"
            QWANT -> "https://www.qwant.com/?q=$q"
            KAGI -> "https://kagi.com/search?q=$q"
            SEARXNG -> "${b.ifEmpty { "https://searx.be" }}/search?q=$q"
            BRAVE -> "https://search.brave.com/search?q=$q" + if (hideAi) "&summary=0" else ""
            STARTPAGE -> "https://www.startpage.com/do/search?q=$q"
            ECOSIA -> "https://www.ecosia.org/search?q=$q"
            GOOGLE -> "https://www.google.com/search?q=$q" + if (hideAi) "&udm=14" else ""
            BING -> "https://www.bing.com/search?q=$q"
            CUSTOM -> template.trim().takeIf { it.contains("%s") }?.replace("%s", q) ?: "https://duckduckgo.com/?q=$q"
        }
    }

    /** Page d'accueil du moteur (nouvel onglet « Moteur de recherche »). */
    fun home(base: String, template: String, hideAi: Boolean): String = when (this) {
        DUCKDUCKGO -> if (hideAi) "https://noai.duckduckgo.com/" else "https://duckduckgo.com/"
        KAGI -> "https://kagi.com/"
        QWANT -> "https://www.qwant.com/"
        BRAVE -> "https://search.brave.com/"
        STARTPAGE -> "https://www.startpage.com/"
        ECOSIA -> "https://www.ecosia.org/"
        GOOGLE -> "https://www.google.com/"
        BING -> "https://www.bing.com/"
        SEARXNG -> base.trim().trimEnd('/').ifEmpty { "https://searx.be" } + "/"
        QAFILA -> base.trim().trimEnd('/').ifEmpty { "https://qafila.example.com" } + "/"
        CUSTOM -> runCatching { java.net.URI(template.trim().replace("%s", "")).let { u -> u.host?.let { "${u.scheme ?: "https"}://$it/" } } }.getOrNull() ?: "https://duckduckgo.com/"
    }

    /** Point d'accès des suggestions (null = suggestions locales seulement, pour ne pas envoyer la saisie ailleurs). */
    fun suggestUrl(base: String): String? = when (this) {
        QAFILA -> if (base.isBlank()) null else "${base.trim().trimEnd('/')}/api/suggest?q="
        SEARXNG -> if (base.isBlank()) null else "${base.trim().trimEnd('/')}/autocompleter?q="
        GOOGLE -> "https://suggestqueries.google.com/complete/search?client=firefox&q="
        BING -> "https://api.bing.com/osjson.aspx?query="
        BRAVE -> "https://search.brave.com/api/suggest?q="
        ECOSIA -> "https://ac.ecosia.org/autocomplete?type=list&q="
        QWANT -> "https://api.qwant.com/v3/suggest?q="
        DUCKDUCKGO -> "https://duckduckgo.com/ac/?type=list&q="
        KAGI, STARTPAGE, CUSTOM -> null
    }
}

@Serializable enum class Appearance(@StringRes override val labelRes: Int) : Labeled { SYSTEM(R.string.appearance_system), LIGHT(R.string.appearance_light), DARK(R.string.appearance_dark) }
@Serializable enum class AccentColor(@StringRes override val labelRes: Int, val argb: Long) : Labeled {
    MONO(R.string.accent_mono, 0xFF111111L), INDIGO(R.string.accent_indigo, 0xFF5856D6L), BLUE(R.string.accent_blue, 0xFF007AFFL), TEAL(R.string.accent_teal, 0xFF30B0C7L),
    GREEN(R.string.accent_green, 0xFF34C759L), ORANGE(R.string.accent_orange, 0xFFFF9500L), PINK(R.string.accent_pink, 0xFFFF2D55L), RED(R.string.accent_red, 0xFFFF3B30L)
}

/** Couleur de la barre (une pour le mode clair, une pour le mode sombre). AUTO = couleur du site (theme-color). */
@Serializable enum class BarColor(@StringRes override val labelRes: Int, val argb: Long) : Labeled {
    AUTO(R.string.bar_auto, 0), WHITE(R.string.bar_white, 0xFFFFFFFFL), LIGHT_GREY(R.string.bar_light_grey, 0xFFF2F2F7L), LILAC(R.string.bar_lilac, 0xFFECE8F5L), PINK(R.string.bar_pink, 0xFFF6DCE6L),
    SLATE(R.string.bar_slate, 0xFF7E91A8L), GRAPHITE(R.string.bar_graphite, 0xFF2C2C2EL), BLACK(R.string.bar_black, 0xFF000000L)
}

/** Styles de barre d'adresse (DESIGN.md §2). */
@Serializable enum class AddressStyle(@StringRes override val labelRes: Int, @StringRes val descriptionRes: Int) : Labeled {
    CARD(R.string.address_card, R.string.address_card_desc),
    FULL_URL(R.string.address_full, R.string.address_full_desc),
    CENTERED_DOMAIN(R.string.address_centered, R.string.address_centered_desc),
    TITLE_READ(R.string.address_title_read, R.string.address_title_read_desc),
    CENTERED_PLAIN(R.string.address_plain, R.string.address_plain_desc),
    HIDDEN(R.string.address_hidden, R.string.address_hidden_desc),
}
@Serializable enum class AddressTapAction(@StringRes override val labelRes: Int) : Labeled { EDIT(R.string.tap_edit_address), MENU(R.string.tap_open_menu) }
@Serializable enum class AddressLongPressAction(@StringRes override val labelRes: Int) : Labeled { MENU(R.string.tap_open_menu), COPY(R.string.long_press_copy), NONE(R.string.nothing) }
@Serializable enum class IconWeight(@StringRes override val labelRes: Int, val stroke: Float) : Labeled { THIN(R.string.weight_thin, 1.15f), REGULAR(R.string.weight_regular, 1.5f), BOLD(R.string.weight_bold, 2.0f) }
@Serializable enum class MenuIconStyle(@StringRes override val labelRes: Int) : Labeled { DOTS(R.string.menu_icon_dots), DOTS_CIRCLE(R.string.menu_icon_dots_circle), LINES_CIRCLE(R.string.menu_icon_lines_circle) }
@Serializable enum class ScrollBehavior(@StringRes override val labelRes: Int, @StringRes val descriptionRes: Int) : Labeled {
    FIXED(R.string.scroll_fixed, R.string.scroll_fixed_desc),
    SHRINK(R.string.scroll_shrink, R.string.scroll_shrink_desc),
    HIDE(R.string.scroll_hide, R.string.scroll_hide_desc),
}
@Serializable enum class TabsLayout(@StringRes override val labelRes: Int) : Labeled { LIST(R.string.layout_list), GRID(R.string.layout_grid) }
@Serializable enum class GridSize(@StringRes override val labelRes: Int, val columns: Int) : Labeled { LARGE(R.string.grid_large, 2), SMALL(R.string.grid_small, 3) }
@Serializable enum class TabsSort(@StringRes override val labelRes: Int) : Labeled { DATE(R.string.sort_date), READING_TIME(R.string.sort_reading_time), TITLE(R.string.sort_title) }
@Serializable enum class NewTabPage(@StringRes override val labelRes: Int) : Labeled { START(R.string.newtab_start), SEARCH(R.string.newtab_search), BLANK(R.string.newtab_blank), CUSTOM(R.string.newtab_custom) }
@Serializable enum class AutoCloseTabs(@StringRes override val labelRes: Int, val days: Int) : Labeled {
    NEVER(R.string.autoclose_never, 0), DAY(R.string.autoclose_day, 1), WEEK(R.string.autoclose_week, 7), MONTH(R.string.autoclose_month, 30)
}
@Serializable enum class SuggestionsMode(@StringRes override val labelRes: Int) : Labeled { EVERYWHERE(R.string.suggest_everywhere), NOT_PRIVATE(R.string.suggest_not_private), NEVER(R.string.autoclose_never) }
@Serializable enum class TranslateLanguage(@StringRes override val labelRes: Int, val code: String) : Labeled {
    FR(R.string.lang_fr, "fr"), EN(R.string.lang_en, "en"), AR(R.string.lang_ar, "ar"), ES(R.string.lang_es, "es"), DE(R.string.lang_de, "de"), IT(R.string.lang_it, "it"),
    PT(R.string.lang_pt, "pt"), NL(R.string.lang_nl, "nl"), TR(R.string.lang_tr, "tr"), ZH(R.string.lang_zh, "zh-CN"), JA(R.string.lang_ja, "ja")
}
/** Icônes alternatives de l'application (activity-alias). */
@Serializable enum class AppIcon(@StringRes override val labelRes: Int, val alias: String, val supportersOnly: Boolean = false) : Labeled {
    CLASSIC(R.string.icon_classic, "fr.qafila.browser.IconClassic"), DARK(R.string.icon_dark, "fr.qafila.browser.IconDark"),
    INK(R.string.icon_ink, "fr.qafila.browser.IconInk"), DESERT(R.string.icon_desert, "fr.qafila.browser.IconDesert"),
    /** Réservée aux personnes qui soutiennent Qafila (abonnement 0,99 €/mois). */
    GOLD(R.string.icon_gold, "fr.qafila.browser.IconGold", supportersOnly = true),
}

@Serializable
data class Settings(
    // Recherche
    val searchEngine: SearchEngine = SearchEngine.DUCKDUCKGO,
    val searchBaseUrl: String = "",
    val customSearchTemplate: String = "",
    val suggestionsMode: SuggestionsMode = SuggestionsMode.EVERYWHERE,
    val hideAiAnswers: Boolean = true,
    // Apparence
    val appearance: Appearance = Appearance.SYSTEM,
    val accent: AccentColor = AccentColor.MONO,
    val barColorLight: BarColor = BarColor.AUTO,
    val barColorDark: BarColor = BarColor.AUTO,
    val appIcon: AppIcon = AppIcon.CLASSIC,
    val haptics: Boolean = true,
    // Barre d'outils
    val toolbar: ToolbarConfig = ToolbarConfig.preset(ToolbarConfig.Preset.COMPLETE),
    val landscapeTopBar: Boolean = false,
    val iconWeight: IconWeight = IconWeight.REGULAR,
    val menuIcon: MenuIconStyle = MenuIconStyle.DOTS,
    val scrollBehavior: ScrollBehavior = ScrollBehavior.SHRINK,
    val swipeBarNavigation: Boolean = true,
    // Barre d'adresse
    val addressStyle: AddressStyle = AddressStyle.CARD,
    val addressShowsFavicon: Boolean = true,
    val addressShowsReadingTime: Boolean = true,
    val addressTap: AddressTapAction = AddressTapAction.EDIT,
    val addressLongPress: AddressLongPressAction = AddressLongPressAction.MENU,
    // Onglets
    val tabsLayout: TabsLayout = TabsLayout.LIST,
    val tabsGridSize: GridSize = GridSize.LARGE,
    val tabsSort: TabsSort = TabsSort.DATE,
    val groupTabsByDomain: Boolean = true,
    val newTabPage: NewTabPage = NewTabPage.START,
    val newTabCustomUrl: String = "",
    val autoCloseTabs: AutoCloseTabs = AutoCloseTabs.NEVER,
    val comfortMode: Boolean = false,
    // Confidentialité et sécurité
    val blockAds: Boolean = true,
    val blockTrackers: Boolean = true,
    val blockCookieBanners: Boolean = true,
    val blockerDisabledHosts: Set<String> = emptySet(),
    val javascriptEnabled: Boolean = true,
    val javascriptDisabledHosts: Set<String> = emptySet(),
    val upgradeToHttps: Boolean = true,
    val clearOnCloseAll: Boolean = false,
    val customUserAgent: String = "",
    // Lecture
    val darkenSites: Boolean = false,
    val darkenOnlyInDarkMode: Boolean = false,
    val darkenHosts: Set<String> = emptySet(),
    val textZoom: Int = 100,
    val translateLanguage: TranslateLanguage = TranslateLanguage.FR,
    val desktopByDefault: Boolean = false,
    val desktopHosts: Set<String> = emptySet(),
    // Énergie
    val suspendTabsInPowerSave: Boolean = true,
)

@Serializable
data class PersistedState(
    val tabs: List<BrowserTab> = emptyList(),
    val selectedTabId: String? = null,
    val bookmarks: List<Bookmark> = emptyList(),
    val history: List<HistoryEntry> = emptyList(),
    val settings: Settings = Settings(),
)
