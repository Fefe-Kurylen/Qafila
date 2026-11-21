import SwiftUI

/// Menu de Quiche : carte translucide ancrée au-dessus du bouton menu. Les éléments sans intitulé forment des rangées de tuiles,
/// les autres des lignes (intitulé à gauche, icône à droite). Fermetures en rouge. Entièrement configurable dans l'éditeur.
struct FloatingMenu: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var tabManager: TabManager
    /// Même verre que la barre (couleur, transparence, thème des icônes).
    let palette: ChromePalette
    static func width(_ s: Settings) -> CGFloat { 284 * s.ui }
    private var ui: CGFloat { store.settings.ui }

    var body: some View {
        let s = store.settings
        let glass = s.toolbar.style != .classic
        ViewThatFits(in: .vertical) {
            content
            ScrollView(showsIndicators: false) { content }
        }
        .frame(width: Self.width(s))
        // On ne découpe que le contenu : le fond (et son ombre portée) reste intact.
        .clipShape(RoundedRectangle(cornerRadius: GlassSurface.menuRadius, style: .continuous))
        .modifier(SchemeOverride(scheme: glass ? palette.contentScheme : nil))
        .background {
            if glass {
                GlassSurface(palette: palette, radius: GlassSurface.menuRadius, transparency: s.glassTransparency)
            } else {
                RoundedRectangle(cornerRadius: GlassSurface.menuRadius, style: .continuous).fill(.regularMaterial)
                    .shadow(color: .black.opacity(0.15), radius: 24, y: 8)
            }
        }
    }

    private var content: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                switch row {
                // Séparateur de section : trait fin pleine largeur.
                case .gap: Color.primary.opacity(0.18).frame(height: 1)
                case .tiles(let slots): tileRow(slots)
                case .lines(let slots):
                    VStack(spacing: 0) {
                        ForEach(Array(slots.enumerated()), id: \.element.id) { i, slot in
                            if i > 0 { Color.primary.opacity(0.12).frame(height: 0.5).padding(.leading, 18) }
                            line(slot)
                        }
                    }
                }
            }
        }
    }

    private enum Row { case gap, tiles([ToolbarSlot]), lines([ToolbarSlot]) }

    /// Regroupe les éléments consécutifs de même nature ; les séparateurs deviennent des espacements.
    private var rows: [Row] {
        var out: [Row] = []
        var tiles: [ToolbarSlot] = [], lines: [ToolbarSlot] = []
        func flush() {
            if !tiles.isEmpty { out.append(.tiles(tiles)); tiles = [] }
            if !lines.isEmpty { out.append(.lines(lines)); lines = [] }
        }
        for s in store.settings.toolbar.menu where s.action != .address && s.action != .menu {
            if s.action == .separator {
                flush()
                if let last = out.last, case .gap = last {} else if !out.isEmpty { out.append(.gap) }
                continue
            }
            if s.showsLabel { if !tiles.isEmpty { flush() }; lines.append(s) } else { if !lines.isEmpty { flush() }; tiles.append(s) }
        }
        flush()
        if let last = out.last, case .gap = last { out.removeLast() }
        return out
    }

    private func tileRow(_ slots: [ToolbarSlot]) -> some View {
        let labelled = slots.count <= 3
        return HStack(spacing: 0) {
            ForEach(Array(slots.enumerated()), id: \.element.id) { i, slot in
                if i > 0 { Color.primary.opacity(0.12).frame(width: 0.5, height: (labelled ? 40 : 28) * ui) }
                Button { act(slot.action) } label: {
                    VStack(spacing: 6) {
                        ActionGlyph(tabManager: tabManager, action: slot.action, size: (labelled ? 21 : 20) * ui, tint: slot.action.isDestructive ? .red : nil)
                        if labelled { Text(slot.action.tileLabel).font(.system(size: 13 * ui)).foregroundStyle(slot.action.isDestructive ? Color.red : Color.primary).lineLimit(1).minimumScaleFactor(0.8) }
                    }
                    .frame(maxWidth: .infinity).frame(height: (labelled ? 72 : 56) * ui)
                    .contentShape(Rectangle())
                }
                .buttonStyle(MenuPressStyle())
                .foregroundStyle(slot.action.isDestructive ? Color.red : Color.primary)
                .disabled(!enabled(slot.action))
                .opacity(enabled(slot.action) ? 1 : 0.32)
                .accessibilityLabel(slot.action.label)
            }
        }
    }

    private func line(_ slot: ToolbarSlot) -> some View {
        Button { act(slot.action) } label: {
            HStack(spacing: 12) {
                Text(lineLabel(slot.action)).font(.system(size: 17 * ui)).lineLimit(1)
                Spacer(minLength: 6)
                if slot.action.isDestructive {
                    Image(systemName: slot.action.symbol).font(.system(size: 18 * ui, weight: store.settings.buttonWeight.fontWeight))
                } else {
                    ActionGlyph(tabManager: tabManager, action: slot.action, size: 18 * ui)
                }
            }
            .foregroundStyle(slot.action.isDestructive ? Color.red : Color.primary)
            .padding(.horizontal, 18).frame(height: 50 * ui)
            .contentShape(Rectangle())
        }
        .buttonStyle(MenuPressStyle())
    }

    private func enabled(_ a: ToolbarAction) -> Bool {
        guard let t = store.selectedTab else { return true }
        let nav = tabManager.navState[t.id] ?? (false, false)
        switch a {
        case .back: return nav.back
        case .forward: return nav.forward
        default: return true
        }
    }

    private func lineLabel(_ a: ToolbarAction) -> String {
        guard let t = store.selectedTab else { return a.label }
        switch a {
        case .blocker: return store.isBlockerActive(for: t.url) ? L("Désactiver le bloqueur") : L("Activer le bloqueur")
        case .darken: return store.isDarkened(t) ? L("Ne plus assombrir") : L("Assombrir le site")
        case .darkMode: return store.isDarkScheme ? L("Mode clair") : L("Mode sombre")
        case .javascript: return store.isJavaScriptEnabled(for: t.url) ? L("Désactiver JavaScript") : L("Activer JavaScript")
        case .desktopSite: return store.isDesktop(t) ? L("Version mobile") : L("Version bureau")
        case .reader: return tabManager.readerActive.contains(t.id) ? L("Quitter le lecteur") : L("Lecteur")
        case .addBookmark: return store.isBookmarked(t) ? L("Retirer des favoris") : L("Ajouter aux favoris")
        case .closeTab: return L("Fermer l'onglet")
        case .closeAllTabs: return store.tabs.count > 1 ? L("Fermer les %ld onglets", store.tabs.count) : L("Fermer tous les onglets")
        case .translate: let lang = store.settings.translateLanguage.label
            // Les noms de langue prennent une minuscule en français et en espagnol, une majuscule ailleurs.
            let lower = ["fr", "es", "it", "pt"].contains(Locale.current.language.languageCode?.identifier ?? "fr")
            return L("Traduire en %@", lower ? lang.lowercased() : lang)
        default: return a.label
        }
    }

    private func act(_ a: ToolbarAction) {
        withAnimation(.easeOut(duration: 0.18)) { store.showMenu = false }
        store.perform(a)
    }
}

/// Retour visuel discret à l'appui, comme les menus iOS.
struct MenuPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(Color.primary.opacity(configuration.isPressed ? 0.08 : 0))
    }
}
