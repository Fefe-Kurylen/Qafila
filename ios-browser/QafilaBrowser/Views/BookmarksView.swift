import SwiftUI

struct BookmarksView: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    /// Grille d'icônes (affichage façon Safari) ou liste (modification : supprimer, réordonner).
    @State private var editing = false

    private var items: [Bookmark] {
        query.isEmpty ? store.bookmarks : store.bookmarks.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.url.absoluteString.localizedCaseInsensitiveContains(query) }
    }
    private var asGrid: Bool { store.settings.favoritesStyle == .icons && !editing }

    var body: some View {
        NavigationStack {
            Group {
                if asGrid { grid } else { list }
            }
            .searchable(text: $query, prompt: "Rechercher dans les favoris")
            .navigationTitle("Favoris")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(editing ? L("Terminé") : L("Modifier")) { withAnimation { editing.toggle() } }
                        .font(.system(size: 17, weight: .semibold))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Affichage des favoris", selection: $store.settings.favoritesStyle) {
                            ForEach(FavoritesStyle.allCases) { Text($0.label).tag($0) }
                        }
                    } label: { Image(systemName: store.settings.favoritesStyle == .icons ? "square.grid.2x2" : "list.bullet") }
                }
                ToolbarItem(placement: .confirmationAction) { Button("OK") { dismiss() } }
            }
        }
    }

    private var addCurrent: some View {
        Group {
            if let t = store.selectedTab, t.url != nil, !store.isBookmarked(t) {
                Button { store.toggleBookmark(t) } label: { Label(L("Ajouter « %@ »", t.displayTitle), systemImage: "star.fill").font(.system(size: 17, weight: .semibold)) }
            }
        }
    }

    private var grid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                addCurrent.padding(.horizontal, 20)
                if items.isEmpty {
                    Text("Aucun favori pour l'instant.").font(.system(size: 17)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 40)
                }
                FavoritesIconGrid(icons: store.tabManager.siteIcons, items: items, open: { open($0.url) },
                                  newTab: { store.newTab(url: $0.url); dismiss() },
                                  remove: { b in withAnimation { store.bookmarks.removeAll { $0.id == b.id } } })
            }
            .padding(.vertical, 14)
        }
    }

    private var list: some View {
        List {
            addCurrent
            ForEach(items) { b in
                Button { open(b.url) } label: {
                    HStack(spacing: 12) {
                        FavoriteTileIcon(bookmark: b, image: store.tabManager.icon(for: b.url.host), size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(b.title).font(.system(size: 16.5, weight: .semibold)).foregroundStyle(.primary).lineLimit(2)
                            Text(b.url.host ?? b.url.absoluteString).font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .onDelete { idx in idx.map { items[$0].id }.forEach { id in store.bookmarks.removeAll { $0.id == id } } }
            .onMove { store.bookmarks.move(fromOffsets: $0, toOffset: $1) }
            if store.bookmarks.isEmpty { Text("Aucun favori pour l'instant.").foregroundStyle(.secondary) }
        }
        .environment(\.editMode, .constant(editing ? .active : .inactive))
    }

    private func open(_ url: URL) {
        if let id = store.selectedTabID { store.tabManager.load(url, in: id) }
        dismiss()
    }
}

/// Grille de favoris (écran Favoris) : 4 colonnes d'icônes, appui long = ouvrir dans un nouvel onglet, copier, supprimer.
struct FavoritesIconGrid: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var icons: SiteIcons
    let items: [Bookmark]
    var open: (Bookmark) -> Void
    var newTab: (Bookmark) -> Void
    var remove: (Bookmark) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 20) {
            ForEach(items) { b in
                Button { open(b) } label: { FavoriteTile(bookmark: b, image: icons.images[b.url.host ?? ""] ?? store.tabManager.icon(for: b.url.host)) }
                    .buttonStyle(CardPressStyle())
                    .contextMenu {
                        Button { newTab(b) } label: { Label("Ouvrir dans un nouvel onglet", systemImage: "plus.square.on.square") }
                        Button { UIPasteboard.general.url = b.url } label: { Label("Copier l'adresse", systemImage: "doc.on.doc") }
                        Divider()
                        Button(role: .destructive) { remove(b) } label: { Label("Supprimer", systemImage: "trash") }
                    }
            }
        }
        .padding(.horizontal, 16)
    }
}
