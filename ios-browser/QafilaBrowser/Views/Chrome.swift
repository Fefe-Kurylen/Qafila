import SwiftUI

// MARK: - Palette

/// Couleurs de la barre : fond choisi dans les réglages (ou couleur du site), carte d'adresse contrastée, icônes claires ou sombres selon la luminance.
struct ChromePalette {
    var bar: Color
    var card: Color
    var contentScheme: ColorScheme

    static func make(_ s: Settings, scheme: ColorScheme, site: Color?) -> ChromePalette {
        let fallback = scheme == .dark ? Color(red: 0.11, green: 0.11, blue: 0.118) : Color(red: 0.949, green: 0.949, blue: 0.969)
        let bar = s.barColor(for: scheme).color ?? site ?? fallback
        let lum = bar.luminance
        let dark = lum < 0.55
        let card: Color
        if dark { card = Color.white.opacity(lum < 0.08 ? 0.13 : 0.16) }
        else if lum > 0.985 { card = Color(red: 0.937, green: 0.937, blue: 0.957) }
        else { card = Color.white.opacity(0.92) }
        return ChromePalette(bar: bar, card: card, contentScheme: dark ? .dark : .light)
    }

    /// Carte d'adresse posée sur le verre : blanc à 12–16 % sur verre sombre, 55–65 % sur verre clair (plus opaque quand le verre l'est).
    func glassCard(_ transparency: Double) -> Color {
        let solid = 1 - min(max(transparency, 0), 1)
        return contentScheme == .dark ? Color.white.opacity(0.10 + 0.05 * solid) : Color.white.opacity(0.42 + 0.15 * solid)
    }
}

extension Color {
    var luminance: Double {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        return Double(0.299 * r + 0.587 * g + 0.114 * b)
    }
}

/// Fond de la barre : couleur unie (Classique) ou verre (Verre : pleine largeur, Flottante : capsule arrondie).
struct ChromeBackground: View {
    let palette: ChromePalette
    let style: ToolbarStyle
    var transparency: Double = 0.5
    var body: some View {
        switch style {
        case .classic: palette.bar
        case .glass: GlassSurface(palette: palette, radius: 0, transparency: transparency, shadow: false)
        case .floating: GlassSurface(palette: palette, radius: GlassSurface.barRadius, transparency: transparency, interactive: true)
        }
    }
}

/// Le verre de Qafila, partagé par la barre, le menu et la pilule des onglets pour un habillage cohérent :
/// Liquid Glass sur iOS 26, matériau teinté avant. `transparency` vient du réglage « Transparence » (0 = couleur opaque, 1 = le plus transparent).
struct GlassSurface: View {
    let palette: ChromePalette
    var radius: CGFloat = GlassSurface.barRadius
    var transparency: Double = 0.5
    /// Réagit au toucher (barre d'outils) sur iOS 26.
    var interactive = false
    var shadow = true

    static let barRadius: CGFloat = 34
    static let pillRadius: CGFloat = 24
    static let menuRadius: CGFloat = 22

    private var t: Double { min(max(transparency, 0), 1) }
    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: radius, style: .continuous) }

    var body: some View {
        surface
            // Bords bien marqués : la barre se détache nettement de la page, quelle que soit la couleur du site.
            .overlay { if radius > 0 { edge } }
            .shadow(color: .black.opacity(shadow && radius > 0 ? (palette.contentScheme == .dark ? 0.32 : 0.14) : 0), radius: 16, y: 5)
            // Le verre se rend toujours dans le thème de la barre (verre sombre profond, jamais gris boueux).
            .environment(\.colorScheme, palette.contentScheme)
    }

    /// Liseré : trait sombre fin à l'extérieur + reflet clair plus marqué en haut.
    private var edge: some View {
        let dark = palette.contentScheme == .dark
        return ZStack {
            shape.strokeBorder(Color.black.opacity(dark ? 0.55 : 0.16), lineWidth: 1)
            shape.inset(by: 1).strokeBorder(LinearGradient(colors: [Color.white.opacity(dark ? 0.34 : 0.9), Color.white.opacity(dark ? 0.10 : 0.35)],
                                                           startPoint: .top, endPoint: .bottom), lineWidth: 1)
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder private var surface: some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            // Teinte légère : le verre laisse vraiment voir la page (avant, la teinte presque opaque le rendait
            // identique au style Classique). Transparence 0 % = verre fortement teinté, 100 % = verre clair.
            let glass = Glass.regular.tint(palette.bar.opacity((1 - t) * 0.6))
            Color.clear.glassEffect(interactive ? glass.interactive() : glass, in: shape)
        } else {
            fallback
        }
        #else
        fallback
        #endif
    }

    /// iOS 17/18 : matériau ultra-fin teinté (liseré et ombre ajoutés par `body`, communs à toutes les versions).
    private var fallback: some View {
        shape.fill(.ultraThinMaterial)
            .overlay(shape.fill(palette.bar.opacity(0.04 + (1 - t) * 0.56)))
    }
}

/// Habillage commun de la barre (écran, aperçus, galerie) : carte d'adresse en verre ou pleine, rayon de pilule, thème des icônes.
struct ChromeDressing: ViewModifier {
    let palette: ChromePalette
    let settings: Settings
    func body(content: Content) -> some View {
        let style = settings.toolbar.style
        content
            .environment(\.chromeCard, style == .classic ? palette.card : palette.glassCard(settings.glassTransparency))
            .environment(\.chromeCardRadius, style == .floating ? GlassSurface.pillRadius : nil)
            .modifier(SchemeOverride(scheme: palette.contentScheme))
    }
}

/// Force le thème clair ou sombre d'une zone (icônes lisibles quelle que soit la couleur de la barre).
struct SchemeOverride: ViewModifier {
    let scheme: ColorScheme?
    func body(content: Content) -> some View {
        if let scheme { content.environment(\.colorScheme, scheme) } else { content }
    }
}

struct MenuAnchorKey: PreferenceKey {
    static let defaultValue: CGRect = .zero
    static func reduce(value: inout CGRect, nextValue: () -> CGRect) { let n = nextValue(); if n != .zero { value = n } }
}

// MARK: - Barre complète

/// La barre de Quiche : carte d'adresse (domaine en capitales au-dessus du titre) puis rangée d'icônes fines.
struct ChromeBar: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var editor: AddressEditModel
    /// Paysage : tout tient sur une seule ligne.
    var singleRow: Bool
    var atTop: Bool

    private var s: Settings { store.settings }
    private var showsCard: Bool { s.addressStyle != .hidden && !s.toolbar.hasInlineAddress && !singleRow }

    var body: some View {
        Group {
            if store.isEditingAddress {
                AddressEditorRow(editor: editor).padding(.horizontal, 10).padding(.vertical, 9)
            } else if singleRow {
                ToolbarRow(forceInlineAddress: true).padding(.horizontal, 8).frame(height: 54 * s.ui)
            } else {
                VStack(spacing: 0) {
                    if showsCard { AddressCard().padding(.horizontal, 10).padding(.top, atTop ? 5 : 8) }
                    ToolbarRow(forceInlineAddress: false).padding(.horizontal, 6).frame(height: 52 * s.ui)
                }
            }
        }
    }
}

/// Barre réduite au défilement : seulement le domaine. Un toucher la rouvre.
struct MiniChrome: View {
    @EnvironmentObject var store: BrowserStore
    var body: some View {
        let ui = store.settings.ui
        HStack(spacing: 5) {
            if store.selectedTab?.url?.scheme == "https" { Image(systemName: "lock.fill").font(.system(size: 10 * ui, weight: .bold)) }
            Text(store.selectedTab?.host ?? L("Qafila")).font(.system(size: 14.5 * ui, weight: .bold))
        }
        .foregroundStyle(Color.primary.opacity(0.85))
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity).frame(height: 34 * ui)
        .contentShape(Rectangle())
        .onTapGesture { store.barsHidden = false }
    }
}

// MARK: - Carte d'adresse

struct AddressCard: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.chromeCard) private var cardColor
    @Environment(\.chromeCardRadius) private var cardRadius
    /// Dans la rangée d'icônes (style Minimal / Zen / paysage).
    var inline = false

    private var tab: BrowserTab? { store.selectedTab }
    private var s: Settings { store.settings }
    private var style: AddressStyle { inline ? (s.addressStyle == .fullURL ? .fullURL : (s.addressStyle == .safari ? .safari : .card)) : s.addressStyle }
    @Environment(\.colorScheme) private var scheme
    /// Capsule façon Safari : plus sombre que la barre en mode sombre, blanche en mode clair.
    private var safariCapsule: Color { scheme == .dark ? Color(white: 0.09, opacity: 0.78) : Color.white.opacity(0.92) }
    private var isStart: Bool { tab?.url == nil }
    private var ui: CGFloat { s.ui }

    var body: some View {
        content
            .padding(.horizontal, style == .centered ? 4 : (style == .safari ? 6 : 14))
            .frame(maxWidth: .infinity)
            .frame(height: (inline ? 44 : 52) * ui)
            .background {
                if style == .safari {
                    Capsule(style: .continuous).fill(safariCapsule)
                        .overlay(Capsule(style: .continuous).strokeBorder(Color.primary.opacity(scheme == .dark ? 0.06 : 0.08), lineWidth: 0.75))
                } else if style != .centered {
                    let card = RoundedRectangle(cornerRadius: cardRadius ?? (inline ? 12 : 14), style: .continuous)
                    card.fill(cardColor).overlay(card.strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.75))
                }
            }
            .overlay(alignment: .bottom) { ProgressLine(load: store.tabManager.loadState).padding(.horizontal, 12) }
            .contentShape(Rectangle())
            .onTapGesture { tap() }
            .onLongPressGesture(minimumDuration: 0.45) { longPress() }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(tab?.displayTitle ?? L("Rechercher ou saisir une adresse"))
            .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private var content: some View {
        if isStart {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 16 * ui, weight: .medium))
                Text("Rechercher ou saisir une adresse").font(.system(size: 17 * ui, weight: .medium)).lineLimit(1)
            }
            .foregroundStyle(Color.primary.opacity(0.72))
            .frame(maxWidth: .infinity, alignment: style == .card || style == .fullURL || style == .titleReading ? .leading : .center)
            .padding(.horizontal, style == .safari ? 10 : 0)
        } else {
            switch style {
            case .safari: safariLayout
            case .card, .hidden: cardLayout
            case .fullURL: fullURLLayout
            case .domainPill: domainLayout
            case .titleReading: titleLayout
            case .centered: centeredLayout
            }
        }
    }

    private var domain: String { (tab?.host ?? "").uppercased() }
    private var title: String { tab?.displayTitle ?? "" }

    private var cardLayout: some View {
        HStack(spacing: 10) {
            if s.addressShowsFavicon { Favicon(tab: tab, size: (inline ? 20 : 24) * ui) }
            VStack(alignment: .leading, spacing: 1) {
                Text(domain).font(.system(size: 11 * ui, weight: .bold)).tracking(0.5).foregroundStyle(.secondary).lineLimit(1)
                Text(title).font(.system(size: 16 * ui, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
            }
            Spacer(minLength: 4)
            if s.addressShowsReadingTime, let r = tab?.readingLabel { ReadingPill(text: r) }
        }
    }

    /// Comme Safari : bouton menu (lignes) à gauche, nom du site en gras au centre, recharger à droite.
    private var safariLayout: some View {
        HStack(spacing: 0) {
            Button { store.haptic(.light); withAnimation(.spring(response: 0.34, dampingFraction: 0.78)) { store.showMenu.toggle() } } label: {
                Image(systemName: "text.alignleft").font(.system(size: 19 * ui, weight: .medium))
                    .frame(width: 44 * ui, height: 44 * ui).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel(Text("Menu"))
            Text((tab?.host ?? "").replacingOccurrences(of: "^www\\.", with: "", options: .regularExpression))
                .font(.system(size: 19 * ui, weight: .semibold)).foregroundStyle(.primary)
                .lineLimit(1).truncationMode(.middle).frame(maxWidth: .infinity)
            Button { store.perform(.reload) } label: {
                ReloadGlyph(load: store.tabManager.loadState, size: 19 * ui, weight: .medium, tint: nil)
                    .frame(width: 44 * ui, height: 44 * ui).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel(Text("Recharger"))
        }
        .foregroundStyle(.primary)
    }

    private var fullURLLayout: some View {
        HStack(spacing: 8) {
            if s.addressShowsFavicon { Favicon(tab: tab, size: 20 * ui) }
            if tab?.url?.scheme == "https" { Image(systemName: "lock.fill").font(.system(size: 11 * ui, weight: .semibold)).foregroundStyle(.secondary) }
            Text(tab?.url.map(Self.shortURL) ?? "").font(.system(size: 17 * ui)).foregroundStyle(.primary).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 4)
            if s.addressShowsReadingTime, let r = tab?.readingLabel { ReadingPill(text: r) }
        }
    }

    private var domainLayout: some View {
        HStack(spacing: 6) {
            if s.addressShowsFavicon { Favicon(tab: tab, size: 19 * ui) }
            Text(tab?.host ?? "").font(.system(size: 17 * ui, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
            if s.addressShowsReadingTime, let r = tab?.readingLabel { Text("· \(r)").font(.system(size: 14 * ui, weight: .medium)).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity)
    }

    private var titleLayout: some View {
        HStack(spacing: 10) {
            if s.addressShowsFavicon { Favicon(tab: tab, size: 24 * ui) }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 16 * ui, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
                if s.addressShowsReadingTime, let r = tab?.readingLabel {
                    Text(L("%@ de lecture", r)).font(.system(size: 12.5 * ui, weight: .medium)).foregroundStyle(.secondary)
                } else {
                    Text(tab?.host ?? "").font(.system(size: 12.5 * ui, weight: .medium)).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var centeredLayout: some View {
        VStack(spacing: 1) {
            Text(domain).font(.system(size: 11 * ui, weight: .bold)).tracking(0.5).foregroundStyle(.secondary).lineLimit(1)
            HStack(spacing: 6) {
                Text(title).font(.system(size: 16 * ui, weight: .medium)).foregroundStyle(.primary).lineLimit(1)
                if s.addressShowsReadingTime, let r = tab?.readingLabel { Text(r).font(.system(size: 12.5 * ui, weight: .medium)).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity)
    }

    static func shortURL(_ u: URL) -> String {
        var t = u.absoluteString
        for p in ["https://", "http://", "www."] where t.hasPrefix(p) { t.removeFirst(p.count) }
        if t.hasSuffix("/") { t.removeLast() }
        return t
    }

    private func tap() {
        switch s.addressTap {
        case .edit: store.beginEditing()
        case .menu: withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { store.showMenu.toggle() }
        }
    }

    private func longPress() {
        store.haptic(.medium)
        switch s.addressLongPress {
        case .menu: withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { store.showMenu = true }
        case .copy: store.copyAddress()
        case .none: break
        }
    }
}

struct ReadingPill: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 12.5, weight: .semibold)).monospacedDigit()
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Capsule().fill(Color.primary.opacity(0.07)))
    }
}

struct Favicon: View {
    /// Initiale du nom du site : « fr.m.wikipedia.org » → « W ».
    static func brandLetter(_ host: String) -> String {
        let labels = host.lowercased().split(separator: ".")
        let name = labels.count >= 2 ? labels[labels.count - 2] : (labels.first ?? "q")
        return String(name.prefix(1)).uppercased()
    }

    let tab: BrowserTab?
    var size: CGFloat = 20
    var body: some View {
        let img = tab?.favicon
        Group {
            if let img {
                Image(uiImage: img).resizable().scaledToFit()
            } else if tab?.isPrivate == true {
                Image(systemName: "hand.raised.fill").font(.system(size: size * 0.55)).foregroundStyle(.secondary)
            } else {
                Text(Self.brandLetter(tab?.host ?? "qafila"))
                    .font(.system(size: size * 0.55, weight: .semibold, design: .serif)).foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .background(img == nil ? Color.primary.opacity(0.07) : .clear)
        .clipShape(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous))
    }
}

/// Fine ligne de progression au bas de la carte d'adresse. Observe le gestionnaire d'onglets : seule cette vue se redessine à chaque tic.
struct ProgressLine: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var load: LoadState
    var body: some View {
        let id = store.selectedTabID
        let p = id.flatMap { load.progress[$0] } ?? 0
        let loading = id.map { load.loading.contains($0) } ?? false
        GeometryReader { g in
            Capsule().fill(Color.accentColor).frame(width: max(0, g.size.width * p)).opacity(loading && p < 1 ? 1 : 0)
        }
        .frame(height: 2)
        .animation(.linear(duration: 0.2), value: p)
    }
}

private struct ChromeCardKey: EnvironmentKey { static let defaultValue: Color = Color(.secondarySystemBackground) }
private struct ChromeCardRadiusKey: EnvironmentKey { static let defaultValue: CGFloat? = nil }
extension EnvironmentValues {
    var chromeCard: Color {
        get { self[ChromeCardKey.self] }
        set { self[ChromeCardKey.self] = newValue }
    }
    /// Rayon de la carte d'adresse (nil = carte classique ; une valeur = pilule concentrique dans la barre flottante).
    var chromeCardRadius: CGFloat? {
        get { self[ChromeCardRadiusKey.self] }
        set { self[ChromeCardRadiusKey.self] = newValue }
    }
}

// MARK: - Rangée d'icônes

struct ToolbarRow: View {
    @EnvironmentObject var store: BrowserStore
    var forceInlineAddress: Bool
    /// Aperçu (réglages, galerie) : configuration affichée sans interaction.
    var preview: [ToolbarSlot]? = nil

    private var slots: [ToolbarSlot] {
        var list = preview ?? store.settings.toolbar.bar
        if forceInlineAddress && !list.contains(where: { $0.action == .address }) {
            list.insert(ToolbarSlot(action: .address), at: min(2, list.count))
        }
        return list
    }

    var body: some View {
        // Avec l'adresse en ligne, les boutons gardent une largeur fixe et l'adresse prend l'espace restant.
        let inline = slots.contains { $0.action == .address }
        HStack(spacing: 0) {
            ForEach(slots) { slot in
                switch slot.action {
                case .separator: Spacer().frame(width: 10)
                case .address: AddressCard(inline: true).padding(.horizontal, 4).frame(maxWidth: .infinity)
                default:
                    if inline { ToolbarButton(tabManager: store.tabManager, slot: slot).frame(width: 50 * store.settings.ui) }
                    else { ToolbarButton(tabManager: store.tabManager, slot: slot).frame(maxWidth: .infinity) }
                }
            }
        }
        // Pas de menu contextuel sur toute la rangée : il se superposait à celui de chaque bouton et à l'appui long sur l'adresse.
    }
}

struct ToolbarButton: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var tabManager: TabManager
    let slot: ToolbarSlot

    private var tab: BrowserTab? { store.selectedTab }
    private var nav: (back: Bool, forward: Bool) { tab.flatMap { tabManager.navState[$0.id] } ?? (false, false) }
    private var isEnabled: Bool {
        switch slot.action {
        case .back: return nav.back
        case .forward: return nav.forward
        default: return true
        }
    }

    var body: some View {
        Button {
            if slot.action == .menu {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { store.perform(.menu) }
            } else {
                store.perform(slot.action)
            }
        } label: {
            ActionGlyph(tabManager: tabManager, action: slot.action, size: slot.size.pointSize * store.settings.ui)
                .opacity(isEnabled ? 1 : 0.3)
                .frame(maxWidth: .infinity, minHeight: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(ToolbarPressStyle())
        .disabled(!isEnabled)
        .accessibilityLabel(slot.action.label)
        .background {
            if slot.action == .menu {
                GeometryReader { g in Color.clear.preference(key: MenuAnchorKey.self, value: g.frame(in: .global)) }
            }
        }
        .contextMenu { longPressMenu }
    }

    @ViewBuilder private var longPressMenu: some View {
        switch slot.action {
        case .tabs, .newTab:
            Button { store.newTab() } label: { Label("Nouvel onglet", systemImage: "plus") }
            Button { store.newTab(isPrivate: true) } label: { Label("Nouvel onglet privé", systemImage: "hand.raised") }
            Divider()
            if let t = tab { Button(role: .destructive) { store.close(tabID: t.id) } label: { Label("Fermer cet onglet", systemImage: "xmark") } }
        case .back, .forward:
            Button { store.showHistory = true } label: { Label("Historique", systemImage: "clock") }
        case .menu:
            Button { store.showToolbarEditor = true } label: { Label("Personnaliser", systemImage: "slider.horizontal.3") }
            Button { store.showSettings = true } label: { Label("Réglages", systemImage: "gearshape") }
        default:
            Button { store.showToolbarEditor = true } label: { Label("Personnaliser la barre", systemImage: "slider.horizontal.3") }
            Button { store.showToolbarGallery = true } label: { Label("Galerie de barres", systemImage: "square.grid.2x2") }
        }
    }
}

/// Appui sur une icône de la barre : léger rétrécissement et atténuation, comme les boutons système.
struct ToolbarPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.86 : 1)
            .opacity(configuration.isPressed ? 0.55 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Icône d'une action, avec son état (actif / inactif) et le style choisi (graisse, icône du menu, compteur d'onglets).
struct ActionGlyph: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var tabManager: TabManager
    let action: ToolbarAction
    var size: CGFloat = 20
    var tint: Color? = nil

    private var weight: ButtonWeight { store.settings.buttonWeight }

    var body: some View {
        if action == .tabs {
            TabsGlyph(count: store.tabs.filter { !$0.isPrivate }.count, size: size, stroke: weight.stroke)
        } else if action == .reload {
            ReloadGlyph(load: tabManager.loadState, size: size, weight: weight.fontWeight, tint: tint)
        } else {
            Image(systemName: symbol)
                .font(.system(size: size, weight: weight.fontWeight))
                .foregroundStyle(tint ?? (isActive ? Color.accentColor : Color.primary))
                .symbolRenderingMode(.monochrome)
        }
    }

    private var isActive: Bool {
        guard let t = store.selectedTab else { return false }
        switch action {
        case .darken: return store.isDarkened(t)
        case .desktopSite: return store.isDesktop(t)
        case .reader: return tabManager.readerActive.contains(t.id)
        case .addBookmark: return store.isBookmarked(t)
        default: return false
        }
    }

    private var symbol: String {
        let t = store.selectedTab
        switch action {
        case .darkMode: return store.isDarkScheme ? "sun.max" : "moon"
        case .menu: return store.settings.menuIcon.symbol
        case .blocker: return store.isBlockerActive(for: t?.url) ? "shield.lefthalf.filled" : "shield.slash"
        case .javascript: return store.isJavaScriptEnabled(for: t?.url) ? "curlybraces" : "curlybraces.square"
        case .addBookmark: return isActive ? "bookmark.fill" : "bookmark"
        default: return action.symbol
        }
    }
}

/// Recharger / Arrêter : seule icône qui suit le chargement (les autres ne se redessinent pas à chaque tic).
struct ReloadGlyph: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var load: LoadState
    let size: CGFloat
    let weight: Font.Weight
    var tint: Color?
    var body: some View {
        let loading = store.selectedTabID.map { load.loading.contains($0) } ?? false
        Image(systemName: loading ? "xmark" : "arrow.clockwise")
            .font(.system(size: size, weight: weight))
            .foregroundStyle(tint ?? Color.primary)
    }
}

/// Bouton onglets de Quiche : carré arrondi contenant le nombre d'onglets.
struct TabsGlyph: View {
    let count: Int
    var size: CGFloat = 20
    var stroke: CGFloat = 1.5
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
            .strokeBorder(Color.primary, lineWidth: stroke)
            .frame(width: size + 2, height: size + 2)
            .overlay(
                Text(count > 99 ? "∞" : "\(count)")
                    .font(.system(size: size * (count > 9 ? 0.46 : 0.52), weight: stroke > 1.7 ? .heavy : .bold, design: .rounded))
                    .foregroundStyle(Color.primary)
            )
    }
}
