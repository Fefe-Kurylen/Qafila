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
    private var chromeFrame: CGRect { chromeBox.frame }
    @State private var menuAnchor: CGRect = .zero

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
                VStack(spacing: 0) {
                    if atTop { chrome(safe, palette) }
                    Spacer(minLength: 0)
                    if !atTop { chrome(safe, palette) }
                }
                menuLayer(geo, palette)
                if let t = store.toast { toast(t) }
            }
            .coordinateSpace(name: "browser")
            .onPreferenceChange(MenuAnchorKey.self) { if menuAnchor != $0 { menuAnchor = $0 } }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: store.barsHidden)
        .animation(.spring(response: 0.3), value: store.toast)
        .animation(.spring(response: 0.34, dampingFraction: 0.78), value: store.showMenu)
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
            Group {
                if collapsed && s.scrollBehavior == .shrink {
                    MiniChrome()
                } else {
                    ChromeBar(editor: editor, singleRow: landscape, atTop: atTop)
                }
            }
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

    /// Menu en carte, ouvert tout près de son bouton (8 pt au-dessus de la barre, ou en dessous si elle est en haut),
    /// avec une petite animation qui part du bouton. Positionné d'après le cadre réel de la barre à l'écran.
    private func menuLayer(_ geo: GeometryProxy, _ palette: ChromePalette) -> some View {
        let screen = geo.frame(in: .global)
        let width = geo.size.width
        let anchorX = menuAnchor == .zero ? width - 30 : menuAnchor.midX - screen.minX
        let menuWidth = FloatingMenu.width(s)
        let x = min(max(anchorX + 28 - menuWidth, Self.floatMargin), width - menuWidth - Self.floatMargin)
        let bar = chromeFrame == .zero ? CGRect(x: 0, y: screen.maxY - chromeHeight, width: width, height: chromeHeight) : chromeFrame
        let gap: CGFloat = 8
        // Hauteur disponible entre le haut de l'écran utile et la barre (ou entre la barre et le bas).
        let space = atTop ? (screen.maxY - (bar.maxY - screen.minY) - gap - 12) : (bar.minY - screen.minY - gap - 12)
        // Point de départ de l'animation : le bouton (la transition s'applique à la carte décalée de x).
        let unit = UnitPoint(x: min(max(anchorX / (x + menuWidth), 0), 1), y: atTop ? 0 : 1)
        // Conteneur toujours présent : seuls le voile et la carte apparaissent, chacun avec sa transition.
        return ZStack(alignment: .topLeading) {
            if store.showMenu {
                Color.black.opacity(0.12).ignoresSafeArea()
                    .onTapGesture { withAnimation(.spring(response: 0.28, dampingFraction: 0.9)) { store.showMenu = false } }
                    .transition(.opacity)
            }
            VStack(spacing: 0) {
                if !atTop { Spacer(minLength: 0) }
                if store.showMenu {
                    FloatingMenu(tabManager: store.tabManager, palette: palette)
                        .frame(maxHeight: max(200, space))
                        .fixedSize(horizontal: true, vertical: false)
                        .padding(.leading, x)
                        .transition(.scale(scale: 0.4, anchor: unit).combined(with: .opacity))
                }
                if atTop { Spacer(minLength: 0) }
            }
            .frame(width: width, height: max(200, atTop ? screen.maxY - bar.maxY - gap : bar.minY - screen.minY - gap), alignment: .leading)
            .offset(y: atTop ? bar.maxY - screen.minY + gap : 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
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

    private func handleScroll(_ delta: CGFloat) {
        guard s.scrollBehavior != .fixed, !store.isEditingAddress, !store.showMenu else { return }
        if delta > 8, !store.barsHidden { store.barsHidden = true }
        else if delta < -8, store.barsHidden { store.barsHidden = false }
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
