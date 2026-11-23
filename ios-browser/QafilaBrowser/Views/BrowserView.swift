import SwiftUI

/// Écran principal : la page occupe tout l'écran, la barre de Quiche flotte en bas (ou en haut), le menu s'ouvre en carte ancrée.
struct BrowserView: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.colorScheme) private var scheme
    @Environment(\.verticalSizeClass) private var vClass
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var editor = AddressEditModel()
    @State private var chromeHeight: CGFloat = 100
    /// Cadre réel de la barre à l'écran (décalages compris) : le menu s'ouvre juste au-dessus, collé au bouton.
    /// Gardé dans une boîte (pas un état observé) : le suivre pendant les animations de la barre ne redessine rien.
    @State private var chromeBox = FrameBox()
    /// Distance de défilement cumulée dans un même sens (sans redessin).
    @State private var scrollRun = ValueBox()
    private var chromeFrame: CGRect { chromeBox.frame }
    /// Cadre du bouton Menu, gardé sans observation : il bouge à chaque image quand la barre se réduit,
    /// et un @State redessinerait tout le navigateur pendant l'animation.
    @State private var menuAnchorBox = FrameBox()
    private var menuAnchor: CGRect { menuAnchorBox.frame }

    private var s: Settings { store.settings }
    private var landscape: Bool { vClass == .compact }
    private var atTop: Bool { s.toolbar.position == .top || (landscape && s.landscapeTopBar) }
    private var floating: Bool { s.toolbar.style == .floating }
    private var collapsed: Bool { store.barsHidden && !store.isEditingAddress && !store.showMenu }

    var body: some View {
        GeometryReader { geo in
            let safe = geo.safeAreaInsets
            // Calculée une seule fois par rendu (conversion UIColor et luminance).
            let palette = ChromePalette.make(s, scheme: scheme, site: store.siteThemeColor)
            ZStack {
                web(safe, palette)
                // Voile léger sous la barre : touché à côté = menu fermé (la carte elle-même est rattachée à la barre).
                if store.showMenu {
                    Color.black.opacity(0.1).ignoresSafeArea()
                        .onTapGesture { withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) { store.showMenu = false } }
                        .transition(.opacity)
                }
                VStack(spacing: 0) {
                    if atTop { chrome(safe, palette) }
                    Spacer(minLength: 0)
                    if !atTop { chrome(safe, palette) }
                }
                if let t = store.toast { toast(t) }
            }
            .coordinateSpace(name: "browser")
            .onPreferenceChange(MenuAnchorKey.self) { menuAnchorBox.frame = $0 }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.86), value: store.barsHidden)
        .animation(.spring(response: 0.3), value: store.toast)
        .animation(.spring(response: 0.34, dampingFraction: 0.78), value: store.showMenu)
        // Favoris ou dossiers modifiés : les pages de démarrage ouvertes suivent.
        .onChange(of: store.bookmarks) { _, _ in store.tabManager.refreshStartPagesSoon() }
        .onChange(of: store.folders) { _, _ in store.tabManager.refreshStartPagesSoon() }
        .animation(.spring(response: 0.3, dampingFraction: 0.86), value: store.isEditingAddress)
        .fullScreenCover(isPresented: $store.showTabs) { TabsView().environmentObject(store) }
        .sheet(isPresented: $store.showSettings, onDismiss: { store.settingsRoute = nil }) { SettingsView().environmentObject(store) }
        .sheet(isPresented: $store.showBookmarks) { BookmarksView().environmentObject(store) }
        .sheet(isPresented: $store.showHistory) { HistoryView().environmentObject(store) }
        .sheet(isPresented: $store.showToolbarEditor) { ToolbarEditorView().environmentObject(store) }
        .sheet(isPresented: $store.showToolbarGallery) { ToolbarGalleryView().environmentObject(store) }
        .onChange(of: store.selectedTabID) { _, _ in store.siteThemeColor = nil; store.barsHidden = false; store.showMenu = false }
        .onAppear { store.isDarkScheme = scheme == .dark }
        .onChange(of: scheme) { _, v in store.isDarkScheme = v == .dark }
        .onChange(of: scenePhase) { _, p in if p == .active { store.closeExpiredTabs(); store.syncAppIcon() } }
        .onChange(of: s) { old, new in applyChanges(old, new) }
    }

    // MARK: Couches

    private func web(_ safe: EdgeInsets, _ palette: ChromePalette) -> some View {
        Group {
            if let tab = store.selectedTab {
                WebContainer(tabID: tab.id,
                             topInset: atTop ? chromeHeight + safe.top : safe.top,
                             bottomInset: atTop ? safe.bottom : chromeHeight + safe.bottom - lift(safe),
                             onScroll: handleScroll)
                    .id(tab.id)
            }
        }
        .ignoresSafeArea()
        .overlay(alignment: atTop ? .bottom : .top) {
            if s.toolbar.style == .classic {
                // Bande derrière la barre d'état (ou l'indicateur d'accueil) pour que la page ne s'y mélange pas.
                ChromeBackground(palette: palette, style: .classic)
                    .frame(height: atTop ? safe.bottom : safe.top)
                    .ignoresSafeArea()
                    .opacity(atTop && collapsed && s.scrollBehavior == .hide ? 0 : 1)
            } else {
                // Verre : aucun aplat, la page passe sous la barre d'état (sa propre couleur de fond), adoucie par un court flou qui s'estompe.
                Rectangle().fill(.ultraThinMaterial)
                    .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
                    .frame(height: (atTop ? safe.bottom : safe.top) + 16)
                    .ignoresSafeArea()
                    .opacity(atTop ? 0 : 1)
                    .allowsHitTesting(false)
            }
        }
    }

    @ViewBuilder private func chrome(_ safe: EdgeInsets, _ palette: ChromePalette) -> some View {
        VStack(spacing: 8) {
            if store.isEditingAddress && !atTop { SuggestionsPanel(editor: editor).padding(.horizontal, 10).transition(.move(edge: .bottom).combined(with: .opacity)) }
            // Réduction façon Safari : une seule barre qui se rétracte (hauteur animée, contenu découpé dans la capsule)
            // pendant que ses boutons s'estompent et que le nom du site apparaît — plus de saut entre deux vues.
            let shrunk = collapsed && s.scrollBehavior == .shrink
            ZStack(alignment: atTop ? .top : .bottom) {
                ChromeBar(editor: editor, singleRow: landscape, atTop: atTop)
                    .opacity(shrunk ? 0 : 1)
                    .scaleEffect(shrunk ? 0.94 : 1, anchor: atTop ? .top : .bottom)
                    .allowsHitTesting(!shrunk)
                MiniChrome()
                    .opacity(shrunk ? 1 : 0)
                    .scaleEffect(shrunk ? 1 : 1.12)
                    .allowsHitTesting(shrunk)
            }
            .frame(height: shrunk ? 34 * s.ui : nil, alignment: atTop ? .top : .bottom)
            .clipped()
            .padding(.bottom, atTop ? 6 : (floating ? 8 : 0))
            .padding(.top, floating && atTop ? 2 : 0)
            .modifier(ChromeDressing(palette: palette, settings: s))
            .background {
                if floating {
                    ChromeBackground(palette: palette, style: .floating, transparency: s.glassTransparency)
                } else {
                    ChromeBackground(palette: palette, style: s.toolbar.style, transparency: s.glassTransparency).ignoresSafeArea(edges: atTop ? .top : .bottom)
                        .overlay(alignment: atTop ? .bottom : .top) { Rectangle().fill(Color.black.opacity(palette.contentScheme == .dark ? 0.35 : 0.07)).frame(height: 0.5) }
                }
            }
            .padding(.horizontal, floating ? Self.floatMargin : 0)
            .padding(atTop ? .top : .bottom, floating ? 8 : 0)
            .background(GeometryReader { g in
                Color.clear
                    .onAppear { chromeHeight = g.size.height; chromeBox.frame = g.frame(in: .global) }
                    .onChange(of: g.size.height) { _, h in if !collapsed { chromeHeight = h } }
                    .onChange(of: g.frame(in: .global)) { _, f in if !collapsed { chromeBox.frame = f } }
            })
            // Menu rattaché à la barre elle-même (comme Safari) : son bord bas est collé 8 pt au-dessus de la barre
            // (ou son bord haut 8 pt en dessous si la barre est en haut), quel que soit le décalage de la barre à l'écran.
            .overlay(alignment: atTop ? .bottomTrailing : .topTrailing) { menuCard(safe, palette) }
            .offset(y: hideOffset(safe) + lift(safe))
            if store.isEditingAddress && atTop { SuggestionsPanel(editor: editor).padding(.horizontal, 10) }
        }
    }

    /// Marge de la barre flottante : assez large pour qu'elle ne colle ni aux bords arrondis de l'écran ni au bas.
    static let floatMargin: CGFloat = 18

    /// Barre flottante en bas : même distance des bords latéraux et du bas de l'écran (comme Quiche / Liquid Glass).
    private func lift(_ safe: EdgeInsets) -> CGFloat {
        guard floating, !atTop, !store.isEditingAddress else { return 0 }
        return max(0, safe.bottom + 8 - Self.floatMargin)
    }

    private func hideOffset(_ safe: EdgeInsets) -> CGFloat {
        guard collapsed, s.scrollBehavior == .hide else { return 0 }
        return atTop ? -(chromeHeight + safe.top + 10) : chromeHeight + safe.bottom + 10
    }

    /// Menu en carte façon Safari : bord droit aligné sur la barre (ou sur le bouton Menu s'il n'est pas au bout),
    /// collé à 8 pt de la barre, et qui sort du bouton (petit et flou → net, avec un léger rebond).
    @ViewBuilder private func menuCard(_ safe: EdgeInsets, _ palette: ChromePalette) -> some View {
        let gap: CGFloat = 8
        let screenW = chromeFrame.width > 0 ? chromeFrame.width : UIScreen.main.bounds.width
        let screenH = UIScreen.main.bounds.height
        let w = FloatingMenu.width(s)
        let barRight = screenW - Self.floatMargin
        // Bouton Menu mesuré à l'écran : la carte finit 28 pt à sa droite, sans sortir des marges.
        let wantedRight = menuAnchor == .zero ? barRight : min(barRight, menuAnchor.midX - chromeFrame.minX + 28)
        let shift = max(Self.floatMargin + w - barRight, wantedRight - barRight)
        let left = barRight + shift - w
        let anchorX = menuAnchor == .zero ? w - 26 : menuAnchor.midX - chromeFrame.minX - left
        let unit = UnitPoint(x: min(max(anchorX / w, 0), 1), y: atTop ? 0 : 1)
        // Hauteur disponible entre la barre et le bord utile de l'écran.
        let barTop = chromeFrame == .zero ? screenH - chromeHeight - safe.bottom : chromeFrame.minY
        let avail = atTop ? screenH - (chromeFrame == .zero ? chromeHeight + safe.top : chromeFrame.maxY) - safe.bottom - gap - 12
                          : barTop - safe.top - gap - 12
        ZStack(alignment: atTop ? .top : .bottom) {
            if store.showMenu {
                FloatingMenu(tabManager: store.tabManager, palette: palette)
                    .transition(.modifier(active: MenuPop(progress: 0, anchor: unit), identity: MenuPop(progress: 1, anchor: unit)))
            }
        }
        .frame(width: w, height: max(200, avail), alignment: atTop ? .top : .bottom)
        .offset(x: shift)
        .padding(.trailing, Self.floatMargin)
        .alignmentGuide(atTop ? .bottom : .top) { d in atTop ? d[.top] - gap : d[.bottom] + gap }
        .allowsHitTesting(store.showMenu)
    }

    private func toast(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 16, weight: .semibold))
            .padding(.horizontal, 18).padding(.vertical, 11)
            .background(.regularMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
    }

    // MARK: Comportements

    /// Défilement : la barre se réduit (ou se cache) après ~28 pt vers le bas et revient après ~28 pt vers le haut,
    /// distance cumulée dans un même sens — plus d'allers-retours saccadés sur les petits mouvements du doigt.
    private func handleScroll(_ delta: CGFloat) {
        guard s.scrollBehavior != .fixed, !store.isEditingAddress, !store.showMenu else { scrollRun.value = 0; return }
        if delta <= -1000 { scrollRun.value = 0; if store.barsHidden { store.barsHidden = false }; return }
        let run = scrollRun.value
        scrollRun.value = (run >= 0) == (delta >= 0) ? run + delta : delta
        if scrollRun.value > 28, !store.barsHidden { store.barsHidden = true; scrollRun.value = 0 }
        else if scrollRun.value < -28, store.barsHidden { store.barsHidden = false; scrollRun.value = 0 }
    }

    /// Les réglages modifiés s'appliquent immédiatement aux pages ouvertes.
    private func applyChanges(_ old: Settings, _ new: Settings) {
        let tm = store.tabManager
        if old.textZoom != new.textZoom || old.edgeSwipeNavigation != new.edgeSwipeNavigation { tm.applySettings() }
        if old.blockAds != new.blockAds || old.blockTrackers != new.blockTrackers || old.blockCookieBanners != new.blockCookieBanners
            || old.blockerDisabledHosts != new.blockerDisabledHosts { tm.applyRules() }
        if old.darkenSites != new.darkenSites || old.darkenOnlyInDarkMode != new.darkenOnlyInDarkMode { tm.refreshDarken() }
        if old.desktopByDefault != new.desktopByDefault || old.customUserAgent != new.customUserAgent {
            tm.applyUserAgentToOpenTabs()
        }
        if old.appIcon != new.appIcon { store.syncAppIcon() }
        if old.scrollBehavior != new.scrollBehavior { store.barsHidden = false }
        if old.favoritesStyle != new.favoritesStyle { tm.refreshStartPages() }
    }
}

/// Boîte mutable sans observation (mesures qui ne doivent pas provoquer de redessin).
final class FrameBox { var frame: CGRect = .zero }
final class ValueBox { var value: CGFloat = 0 }

/// Apparition du menu façon Safari (iOS 26) : la carte « sort » du bouton — petite au départ, floue et transparente,
/// puis nette à sa taille, avec un léger rebond (ressort).
struct MenuPop: ViewModifier {
    var progress: CGFloat
    var anchor: UnitPoint
    func body(content: Content) -> some View {
        content
            .scaleEffect(0.18 + 0.82 * progress, anchor: anchor)
            .blur(radius: (1 - progress) * 6)
            .opacity(Double(min(1, progress * 1.6)))
    }
}
