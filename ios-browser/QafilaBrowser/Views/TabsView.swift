import SwiftUI

/// Appui sur une vignette : léger rétrécissement, comme dans Safari.
struct CardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.75), value: configuration.isPressed)
    }
}

/// Onglets façon Quiche / Safari : fond gris groupé, cartes blanches, domaine en capitales, temps de lecture ;
/// liste ou grille de vignettes, groupement par site (carrousels en grille), tri, mode confort, onglets privés.
struct TabsView: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @State private var snapshots: [UUID: UIImage] = [:]
    @State private var showPrivate = false
    @State private var query = ""

    private var s: Settings { store.settings }

    private var visibleTabs: [BrowserTab] {
        var t = store.tabs.filter { $0.isPrivate == showPrivate }
        if !query.isEmpty { t = t.filter { $0.displayTitle.localizedCaseInsensitiveContains(query) || $0.host.localizedCaseInsensitiveContains(query) } }
        switch s.tabsSort {
        case .date: return t.sorted { $0.lastVisited > $1.lastVisited }
        case .readingTime: return t.sorted { $0.readingMinutes > $1.readingMinutes }
        case .title: return t.sorted { $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending }
        }
    }

    private struct TabGroup: Identifiable { let id: String; let title: String; let tabs: [BrowserTab] }

    private var groups: [TabGroup] {
        let all = visibleTabs
        guard s.groupTabsByDomain, query.isEmpty else { return [TabGroup(id: "all", title: "", tabs: all)] }
        var order: [String] = []; var dict: [String: [BrowserTab]] = [:]
        for t in all {
            let key = t.url == nil ? L("NOUVEAUX ONGLETS") : t.host.uppercased()
            if dict[key] == nil { order.append(key) }
            dict[key, default: []].append(t)
        }
        var out = order.filter { (dict[$0]?.count ?? 0) > 1 }.map { TabGroup(id: $0, title: $0, tabs: dict[$0] ?? []) }
        let singles = order.filter { (dict[$0]?.count ?? 0) == 1 }.flatMap { dict[$0] ?? [] }
        if !singles.isEmpty { out.append(TabGroup(id: "others", title: out.isEmpty ? "" : L("AUTRES SITES"), tabs: singles)) }
        return out
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 0) {
                searchField
                if visibleTabs.isEmpty { empty } else if s.tabsLayout == .list { list } else { grid }
            }
            bottomBar
        }
        .onAppear { captureSnapshots() }
        .onChange(of: s.tabsLayout) { _, _ in captureSnapshots() }
        .onChange(of: showPrivate) { _, _ in captureSnapshots() }
    }

    // MARK: En-tête et pied

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.system(size: 17, weight: .semibold)).foregroundStyle(.secondary)
            TextField(showPrivate ? L("Rechercher dans les onglets privés") : L("Rechercher dans les onglets"), text: $query)
                .font(.system(size: 17, weight: .medium)).textInputAutocapitalization(.never).autocorrectionDisabled()
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 18)).foregroundStyle(.tertiary) }
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14).frame(height: 46)
        .background(Capsule().fill(Color(.tertiarySystemFill)))
        .overlay(Capsule().strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.75))
        .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 6)
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: showPrivate ? "hand.raised" : "square.on.square").font(.system(size: 42, weight: .regular)).foregroundStyle(.tertiary)
            Text(showPrivate ? L("Aucun onglet privé") : L("Aucun onglet")).font(.system(size: 20, weight: .bold))
            if showPrivate { Text("Les onglets privés ne gardent ni historique ni cookies.").font(.system(size: 16)).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 30) }
            Spacer(); Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    /// Pied en verre, comme la barre (et comme Safari) : « + », la pastille du nombre d'onglets (menu), « OK ».
    private var bottomBar: some View {
        let palette = ChromePalette.make(s, scheme: scheme, site: nil)
        let weight = s.buttonWeight.fontWeight
        return HStack(spacing: 0) {
            Button { store.newTab(isPrivate: showPrivate); dismiss() } label: {
                Image(systemName: "plus").font(.system(size: 22, weight: weight)).frame(width: 64, height: 56).contentShape(Rectangle())
            }
            .buttonStyle(ToolbarPressStyle())
            .accessibilityLabel(L("Nouvel onglet"))
            Spacer(minLength: 0)
            Menu {
                Section {
                    Picker("Affichage", selection: $store.settings.tabsLayout) {
                        Label("Grille", systemImage: "square.grid.2x2").tag(TabsLayout.grid)
                        Label("Liste", systemImage: "list.bullet").tag(TabsLayout.list)
                    }
                    Picker("Trier par", selection: $store.settings.tabsSort) { ForEach(TabsSort.allCases) { Text($0.label).tag($0) } }
                    Toggle("Grouper par site", isOn: $store.settings.groupTabsByDomain)
                    if s.tabsLayout == .grid {
                        Picker("Vignettes", selection: $store.settings.thumbnailSize) { ForEach(ThumbnailSize.allCases) { Text($0.label).tag($0) } }
                    }
                }
                Section {
                    Button { withAnimation { showPrivate.toggle() } } label: {
                        Label(showPrivate ? L("Onglets normaux") : L("Onglets privés"), systemImage: showPrivate ? "square.on.square" : "hand.raised")
                    }
                }
                Section {
                    Button(role: .destructive) { store.closeAllTabs(privateOnly: showPrivate); if !showPrivate { dismiss() } } label: {
                        Label(L("Fermer les %ld onglets", visibleTabs.count), systemImage: "xmark")
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    if showPrivate { Image(systemName: "hand.raised.fill").font(.system(size: 14, weight: .semibold)) }
                    Text(countLabel).font(.system(size: 17, weight: .medium))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16).frame(height: 56).contentShape(Rectangle())
            }
            Spacer(minLength: 0)
            Button { dismiss() } label: { Text("OK").font(.system(size: 17, weight: .semibold)).frame(width: 64, height: 56).contentShape(Rectangle()) }
                .buttonStyle(ToolbarPressStyle())
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 6)
        .modifier(SchemeOverride(scheme: s.toolbar.style == .classic ? nil : palette.contentScheme))
        .background {
            if s.toolbar.style == .classic {
                Capsule().fill(Color(.secondarySystemGroupedBackground))
                    .overlay(Capsule().strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.75))
                    .shadow(color: .black.opacity(0.10), radius: 14, y: 4)
            } else {
                GlassSurface(palette: palette, radius: 28, transparency: s.glassTransparency, interactive: true)
            }
        }
        .padding(.horizontal, BrowserView.floatMargin)
        .padding(.bottom, 8)
    }

    private var countLabel: String {
        let n = visibleTabs.count
        if showPrivate { return n > 1 ? L("%ld onglets privés", n) : L("%ld onglet privé", n) }
        return n > 1 ? L("%ld onglets", n) : L("%ld onglet", n)
    }

    // MARK: Liste

    private var list: some View {
        List {
            ForEach(groups) { group in
                Section {
                    ForEach(group.tabs) { tab in row(tab) }
                } header: {
                    if !group.title.isEmpty {
                        HStack {
                            Text(group.title).font(.system(size: 13, weight: .bold)).tracking(0.5)
                            Spacer()
                            Text("\(group.tabs.count)").font(.system(size: 13, weight: .bold)).monospacedDigit()
                        }
                        .foregroundStyle(.secondary)
                    }
                }
            }
            Color.clear.frame(height: 80).listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 68)
        .defaultScrollAnchor(s.comfortMode ? .bottom : .top)
    }

    private func row(_ tab: BrowserTab) -> some View {
        Button { select(tab) } label: {
            HStack(spacing: 14) {
                Favicon(tab: tab, size: 32)
                VStack(alignment: .leading, spacing: 3) {
                    Text(tab.displayTitle).font(.system(size: 16.5, weight: .semibold)).lineLimit(2).foregroundStyle(.primary).multilineTextAlignment(.leading)
                    Text(tab.url == nil ? L("PAGE DE DÉMARRAGE") : tab.host.uppercased()).font(.system(size: 12, weight: .bold)).tracking(0.4).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 6)
                if s.addressShowsReadingTime, let r = tab.readingLabel { ReadingPill(text: r) }
                if tab.id == store.selectedTabID { Image(systemName: "checkmark.circle.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(Color.accentColor) }
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) { Button(role: .destructive) { withAnimation { store.close(tabID: tab.id) } } label: { Label("Fermer", systemImage: "xmark") } }
        .contextMenu { tabMenu(tab) }
    }

    @ViewBuilder private func tabMenu(_ tab: BrowserTab) -> some View {
        Button { UIPasteboard.general.url = tab.url } label: { Label("Copier l'adresse", systemImage: "doc.on.doc") }
        Button { store.toggleBookmark(tab) } label: { Label(store.isBookmarked(tab) ? L("Retirer des favoris") : L("Ajouter aux favoris"), systemImage: "bookmark") }
        if let u = tab.url { Button { store.newTab(url: u, isPrivate: tab.isPrivate, select: false) } label: { Label("Dupliquer", systemImage: "plus.square.on.square") } }
        Divider()
        Button(role: .destructive) { withAnimation { store.close(tabID: tab.id) } } label: { Label("Fermer", systemImage: "xmark") }
    }

    // MARK: Grille (façon Safari : grandes vignettes arrondies, titre dessous, croix ronde dans le coin)

    private var columns: Int { s.thumbnailSize == .large ? 2 : 3 }
    private var cardWidth: CGFloat { columns == 2 ? 174 : 112 }

    private var grid: some View {
        ScrollView {
            if s.groupTabsByDomain && query.isEmpty {
                LazyVStack(alignment: .leading, spacing: 22) {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            if !group.title.isEmpty {
                                Text(group.title).font(.system(size: 13, weight: .bold)).tracking(0.5).foregroundStyle(.secondary).padding(.horizontal, 22)
                            }
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(alignment: .top, spacing: 14) {
                                    ForEach(group.tabs) { tab in card(tab).frame(width: cardWidth) }
                                }
                                .padding(.horizontal, 18)
                            }
                        }
                    }
                }
                .padding(.vertical, 12)
            } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: columns), spacing: 20) {
                    ForEach(visibleTabs) { tab in card(tab).transition(.scale(scale: 0.8).combined(with: .opacity)) }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
            Color.clear.frame(height: 90)
        }
        .defaultScrollAnchor(s.comfortMode ? .bottom : .top)
    }

    private func card(_ tab: BrowserTab) -> some View {
        let selected = tab.id == store.selectedTabID
        let small = columns > 2
        let shape = RoundedRectangle(cornerRadius: small ? 16 : 22, style: .continuous)
        return VStack(spacing: 8) {
            // La vignette et la croix sont deux boutons voisins (jamais imbriqués) : chaque toucher va au bon endroit.
            ZStack(alignment: .topTrailing) {
                Button { select(tab) } label: {
                    Color(.secondarySystemGroupedBackground)
                        .aspectRatio(0.72, contentMode: .fit)
                        .overlay(alignment: .top) {
                            if let img = snapshots[tab.id] {
                                Image(uiImage: img).resizable().scaledToFill()
                                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                            } else {
                                VStack(spacing: 10) {
                                    Favicon(tab: tab, size: small ? 30 : 44)
                                    if !small { Text(tab.url == nil ? L("Page de démarrage") : tab.host).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1).padding(.horizontal, 10) }
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                            }
                        }
                        .clipShape(shape)
                        .overlay(shape.strokeBorder(selected ? Color.accentColor : Color.primary.opacity(0.14), lineWidth: selected ? 3 : 0.75))
                        .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                        .contentShape(shape)
                }
                .buttonStyle(CardPressStyle())
                .contextMenu { tabMenu(tab) }

                Button { withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { store.close(tabID: tab.id) } } label: {
                    Image(systemName: "xmark").font(.system(size: small ? 11 : 13, weight: .bold)).foregroundStyle(.white)
                        .frame(width: small ? 24 : 28, height: small ? 24 : 28)
                        .background(Circle().fill(Color.black.opacity(0.55)))
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.75))
                        .padding(small ? 6 : 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("Fermer"))
            }
            Button { select(tab) } label: {
                HStack(spacing: 6) {
                    if !small { Favicon(tab: tab, size: 18) }
                    Text(tab.displayTitle).font(.system(size: small ? 12 : 14, weight: .semibold)).lineLimit(1).foregroundStyle(.primary)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func select(_ tab: BrowserTab) {
        store.selectedTabID = tab.id
        store.haptic(.light)
        dismiss()
    }

    /// Seule la grille affiche des vignettes ; elles sont capturées à la largeur des cartes, pas à la résolution de l'écran.
    private func captureSnapshots() {
        guard s.tabsLayout == .grid else { return }
        let width = cardWidth
        for t in store.tabs where snapshots[t.id] == nil && t.isPrivate == showPrivate {
            store.tabManager.snapshot(t.id, width: width) { img in if let img { snapshots[t.id] = img } }
        }
    }
}
