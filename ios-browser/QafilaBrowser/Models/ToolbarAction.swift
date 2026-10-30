import SwiftUI

/// Toutes les actions disponibles pour la barre d'outils et le menu (comme dans Quiche : chaque bouton peut être placé où l'on veut).
enum ToolbarAction: String, Codable, CaseIterable, Identifiable {
    case back, forward, reload, stop
    case tabs, newTab, newPrivateTab, closeTab, closeAllTabs
    case bookmarks, addBookmark, history, share, find
    case blocker, darken, reader, javascript, desktopSite, translate
    case scrollTop, scrollBottom, home, settings, customize, menu
    case address, darkMode
    case separator

    var id: String { rawValue }

    var label: String {
        switch self {
        case .back: return L("Précédent")
        case .forward: return L("Suivant")
        case .reload: return L("Recharger")
        case .stop: return L("Arrêter")
        case .tabs: return L("Onglets")
        case .newTab: return L("Nouvel onglet")
        case .newPrivateTab: return L("Onglet privé")
        case .closeTab: return L("Fermer l'onglet")
        case .closeAllTabs: return L("Fermer tous les onglets")
        case .bookmarks: return L("Favoris")
        case .addBookmark: return L("Ajouter aux favoris")
        case .history: return L("Historique")
        case .share: return L("Partager")
        case .find: return L("Rechercher dans la page")
        case .blocker: return L("Bloqueur")
        case .darken: return L("Assombrir")
        case .reader: return L("Lecteur")
        case .javascript: return L("JavaScript")
        case .desktopSite: return L("Version bureau")
        case .translate: return L("Traduire")
        case .scrollTop: return L("Haut de page")
        case .scrollBottom: return L("Bas de page")
        case .home: return L("Accueil")
        case .settings: return L("Réglages")
        case .customize: return L("Personnaliser")
        case .menu: return L("Menu")
        case .address: return L("Adresse")
        case .darkMode: return L("Mode sombre")
        case .separator: return L("Séparateur")
        }
    }

    var symbol: String {
        switch self {
        case .back: return "chevron.backward"
        case .forward: return "chevron.forward"
        case .reload: return "arrow.clockwise"
        case .stop: return "xmark"
        case .tabs: return "square.on.square"
        case .newTab: return "plus"
        case .newPrivateTab: return "hand.raised"
        case .closeTab: return "xmark"
        case .closeAllTabs: return "xmark.square"
        case .bookmarks: return "book"
        case .addBookmark: return "bookmark"
        case .history: return "clock"
        case .share: return "square.and.arrow.up"
        case .find: return "text.magnifyingglass"
        case .blocker: return "shield.lefthalf.filled"
        case .darken: return "circle.lefthalf.filled"
        case .reader: return "text.alignleft"
        case .javascript: return "curlybraces"
        case .desktopSite: return "desktopcomputer"
        case .translate: return "character.bubble"
        case .scrollTop: return "arrow.up.to.line"
        case .scrollBottom: return "arrow.down.to.line"
        case .home: return "house"
        case .settings: return "gearshape"
        case .customize: return "slider.horizontal.3"
        case .menu: return "ellipsis"
        case .address: return "link"
        case .darkMode: return "moon"
        case .separator: return "minus"
        }
    }

    /// Libellé court sous une tuile du menu.
    var tileLabel: String {
        switch self {
        case .find: return L("Rechercher")
        case .addBookmark: return L("Favori")
        case .closeAllTabs: return L("Tout fermer")
        case .desktopSite: return L("Bureau")
        default: return label
        }
    }

    /// Les actions destructives sont affichées en rouge dans le menu, comme dans Quiche.
    var isDestructive: Bool { self == .closeTab || self == .closeAllTabs }
}

enum ButtonSize: String, Codable, CaseIterable, Identifiable {
    case small, medium, large
    var id: String { rawValue }
    var label: String { switch self { case .small: return L("Petit"); case .medium: return L("Moyen"); case .large: return L("Grand") } }
    var pointSize: CGFloat { switch self { case .small: return 17; case .medium: return 20; case .large: return 23 } }
}

/// Un emplacement dans la barre ou le menu.
struct ToolbarSlot: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var action: ToolbarAction
    var size: ButtonSize = .medium
    /// Dans le menu : ligne avec intitulé, ou icône seule (les icônes seules consécutives forment une rangée de tuiles).
    var showsLabel: Bool = true
}

/// Configuration complète : barre + menu, comme la « Toolbar Gallery » de Quiche.
struct ToolbarConfig: Codable, Equatable {
    var bar: [ToolbarSlot]
    var menu: [ToolbarSlot]
    var style: ToolbarStyle = .floating
    var position: ToolbarPosition = .bottom

    var hasInlineAddress: Bool { bar.contains { $0.action == .address } }

    /// Menu standard (celui de Quiche) : tuiles nouvel onglet / privé, rangée d'icônes, lignes d'actions, fermetures en rouge, navigation.
    static let standardMenu: [ToolbarSlot] = {
        func s(_ a: ToolbarAction, label: Bool = true) -> ToolbarSlot { ToolbarSlot(action: a, showsLabel: label) }
        // Comme Quiche : tuiles « Nouvel onglet / Onglet privé », lignes d'actions, fermetures en rouge,
        // tuiles « Rechercher / Onglets / Partager », puis la navigation.
        // Léger, comme Quiche : le reste (bloqueur, lecteur, version bureau…) s'ajoute dans l'éditeur.
        return [s(.newTab, label: false), s(.newPrivateTab, label: false), s(.separator),
                s(.history), s(.bookmarks), s(.darkMode), s(.separator),
                s(.closeTab), s(.closeAllTabs), s(.separator),
                s(.find, label: false), s(.tabs, label: false), s(.share, label: false), s(.separator),
                s(.back, label: false), s(.forward, label: false), s(.reload, label: false), s(.settings, label: false)]
    }()

    static func preset(_ p: Preset) -> ToolbarConfig {
        func s(_ a: ToolbarAction, _ size: ButtonSize = .medium) -> ToolbarSlot { ToolbarSlot(action: a, size: size) }
        let bar: [ToolbarSlot]
        switch p {
        case .complete: bar = [s(.back), s(.forward), s(.share), s(.newTab), s(.tabs), s(.menu)]
        case .navigation: bar = [s(.back), s(.forward), s(.tabs), s(.newTab), s(.closeTab)]
        case .tools: bar = [s(.back), s(.reload), s(.desktopSite), s(.reader), s(.tabs), s(.closeTab), s(.menu)]
        case .reader: bar = [s(.translate), s(.reader), s(.javascript), s(.scrollTop), s(.newTab), s(.tabs), s(.closeTab)]
        case .minimal: bar = [s(.address), s(.tabs), s(.menu)]
        case .zen: bar = [s(.newTab), s(.address), s(.tabs), s(.closeTab)]
        }
        return ToolbarConfig(bar: bar, menu: standardMenu)
    }

    enum Preset: String, CaseIterable, Identifiable {
        case complete, navigation, tools, reader, minimal, zen
        var id: String { rawValue }
        var label: String {
            switch self { case .complete: return L("Complète"); case .navigation: return L("Navigation"); case .tools: return L("Outils"); case .reader: return L("Lecteur"); case .minimal: return L("Minimal"); case .zen: return L("Zen") }
        }
        var description: String {
            switch self {
            case .complete: return L("Les boutons essentiels, à portée de pouce.")
            case .navigation: return L("Précédent, suivant, onglets — et fermer d'un geste.")
            case .tools: return L("Recharger, version bureau et lecteur en accès direct.")
            case .reader: return L("Traduire, lecteur, JavaScript : pensée pour lire.")
            case .minimal: return L("L'adresse dans la barre, onglets et menu. Rien d'autre.")
            case .zen: return L("Une seule ligne : nouvel onglet, adresse, onglets, fermer.")
            }
        }
    }
}
