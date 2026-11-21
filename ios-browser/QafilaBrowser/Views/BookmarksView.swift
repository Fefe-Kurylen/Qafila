import SwiftUI
import UniformTypeIdentifiers

/// Écran Favoris façon Safari : grille de grandes icônes, dossiers (tuile avec les 4 premiers sites en miniature),
/// « Modifier » pour supprimer / réordonner, nouveau dossier, déplacer un favori, import d'un fichier de favoris
/// exporté par un autre navigateur (HTML, dossiers compris).
struct BookmarksView: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.dismiss) private var dismiss
    @State private var path: [UUID] = []
    @State private var importing = false

    var body: some View {
        NavigationStack(path: $path) {
            FolderScreen(folder: nil, close: { dismiss() }, importing: $importing)
                .navigationDestination(for: UUID.self) { id in FolderScreen(folder: id, close: { dismiss() }, importing: $importing) }
        }
        .onAppear {
            // Dossier touché sur la page de démarrage ou dans la saisie d'adresse : ouvert directement.
            if let f = store.openFolder { path = chain(to: f); store.openFolder = nil }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.html, .plainText, .data]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
                store.flash(L("Ce fichier ne peut pas être lu.")); return
            }
            let n = BookmarkImport.importHTML(text, into: store)
            store.flash(n > 0 ? L("%ld favoris importés", n) : L("Aucun favori trouvé dans ce fichier."))
        }
    }

    /// Chemin de dossiers depuis la racine jusqu'à `id` (navigation directe).
    private func chain(to id: UUID) -> [UUID] {
        var out: [UUID] = []
        var cur: UUID? = id
        var guardCount = 0
        while let c = cur, guardCount < 32 { out.insert(c, at: 0); cur = store.folders.first { $0.id == c }?.parent; guardCount += 1 }
        return out
    }
}

/// Contenu d'un dossier (ou de la racine) : dossiers puis favoris.
struct FolderScreen: View {
    @EnvironmentObject var store: BrowserStore
    let folder: UUID?
    var close: () -> Void
    @Binding var importing: Bool
    @State private var query = ""
    @State private var editing = false
    @State private var naming: NamingTarget?
    @State private var name = ""

    enum NamingTarget: Identifiable { case new, rename(UUID); var id: String { switch self { case .new: return "new"; case .rename(let u): return u.uuidString } } }

    private var title: String { folder.flatMap { f in store.folders.first { $0.id == f }?.name } ?? L("Favoris") }
    private var subfolders: [BookmarkFolder] { query.isEmpty ? store.subfolders(of: folder) : [] }
    private var items: [Bookmark] {
        if query.isEmpty { return store.bookmarks(in: folder) }
        return store.bookmarks.filter { $0.title.localizedCaseInsensitiveContains(query) || $0.url.absoluteString.localizedCaseInsensitiveContains(query) }
    }
    private var asGrid: Bool { store.settings.favoritesStyle == .icons && !editing }

    var body: some View {
        Group { if asGrid { grid } else { list } }
            .searchable(text: $query, prompt: "Rechercher dans les favoris")
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(folder == nil ? .large : .inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(editing ? L("Terminé") : L("Modifier")) { withAnimation { editing.toggle() } }
                        .font(.system(size: 17, weight: .semibold))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { name = ""; naming = .new } label: { Label("Nouveau dossier", systemImage: "folder.badge.plus") }
                        Button { importing = true } label: { Label("Importer un fichier de favoris", systemImage: "square.and.arrow.down") }
                        Picker("Affichage des favoris", selection: $store.settings.favoritesStyle) {
                            ForEach(FavoritesStyle.allCases) { Text($0.label).tag($0) }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
                ToolbarItem(placement: .confirmationAction) { Button("OK") { close() } }
            }
            .alert(namingTitle, isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } })) {
                TextField("Nom du dossier", text: $name)
                Button("Annuler", role: .cancel) { naming = nil }
                Button("OK") {
                    let n = name.trimmingCharacters(in: .whitespaces)
                    if !n.isEmpty {
                        switch naming {
                        case .new: store.addFolder(n, parent: folder)
                        case .rename(let id): store.renameFolder(id, n)
                        case nil: break
                        }
                    }
                    naming = nil
                }
            }
    }

    private var namingTitle: String { if case .rename = naming { return L("Renommer le dossier") } else { return L("Nouveau dossier") } }

    private var addCurrent: some View {
        Group {
            if folder == nil, query.isEmpty, let t = store.selectedTab, t.url != nil, !store.isBookmarked(t) {
                Button { store.toggleBookmark(t) } label: { Label(L("Ajouter « %@ »", t.displayTitle), systemImage: "star.fill").font(.system(size: 17, weight: .semibold)) }
            }
        }
    }

    private var empty: Bool { subfolders.isEmpty && items.isEmpty }

    private var grid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                addCurrent.padding(.horizontal, 20)
                if empty {
                    VStack(spacing: 10) {
                        Text(folder == nil ? L("Aucun favori pour l'instant.") : L("Ce dossier est vide.")).font(.system(size: 17)).foregroundStyle(.secondary)
                        if folder == nil {
                            Button { importing = true } label: { Label("Importer un fichier de favoris", systemImage: "square.and.arrow.down").font(.system(size: 16, weight: .semibold)) }
                        }
                    }
                    .frame(maxWidth: .infinity).padding(.top, 40)
                }
                FavoritesIconGrid(icons: store.tabManager.siteIcons, folders: subfolders, items: items,
                                  open: { open($0.url) },
                                  newTab: { store.newTab(url: $0.url); close() },
                                  remove: { b in withAnimation { store.bookmarks.removeAll { $0.id == b.id } } },
                                  rename: { f in name = f.name; naming = .rename(f.id) },
                                  removeFolder: { f in withAnimation { store.deleteFolder(f.id) } })
            }
            .padding(.vertical, 14)
        }
    }

    private var list: some View {
        List {
            addCurrent
            ForEach(subfolders) { f in
                NavigationLink(value: f.id) {
                    HStack(spacing: 12) {
                        FolderTileIcon(folder: f, size: 36)
                        Text(f.name).font(.system(size: 16.5, weight: .semibold))
                    }
                }
                .swipeActions { Button(role: .destructive) { store.deleteFolder(f.id) } label: { Label("Supprimer", systemImage: "trash") } }
                .contextMenu { folderMenu(f) }
            }
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
                .contextMenu { MoveMenu(bookmark: b) }
            }
            .onDelete { idx in idx.map { items[$0].id }.forEach { id in store.bookmarks.removeAll { $0.id == id } } }
            .onMove { from, to in moveItems(from, to) }
            if empty { Text(folder == nil ? L("Aucun favori pour l'instant.") : L("Ce dossier est vide.")).foregroundStyle(.secondary) }
        }
        .environment(\.editMode, .constant(editing ? .active : .inactive))
    }

    @ViewBuilder private func folderMenu(_ f: BookmarkFolder) -> some View {
        Button { name = f.name; naming = .rename(f.id) } label: { Label("Renommer", systemImage: "pencil") }
        Button(role: .destructive) { store.deleteFolder(f.id) } label: { Label("Supprimer le dossier", systemImage: "trash") }
    }

    /// Réordonne les favoris du dossier affiché, sans toucher à l'ordre des autres dossiers.
    private func moveItems(_ from: IndexSet, _ to: Int) {
        var shown = items
        shown.move(fromOffsets: from, toOffset: to)
        let ids = Set(shown.map(\.id))
        let positions = store.bookmarks.indices.filter { ids.contains(store.bookmarks[$0].id) }
        var all = store.bookmarks
        for (p, b) in zip(positions, shown) { all[p] = b }
        store.bookmarks = all
    }

    private func open(_ url: URL) {
        if let id = store.selectedTabID { store.tabManager.load(url, in: id) }
        close()
    }
}

/// Menu « Déplacer vers… » d'un favori (racine ou un dossier).
struct MoveMenu: View {
    @EnvironmentObject var store: BrowserStore
    let bookmark: Bookmark
    var body: some View {
        Menu {
            Button { store.move(bookmark.id, to: nil) } label: { Label("Favoris", systemImage: bookmark.folder == nil ? "checkmark" : "star") }
            ForEach(store.folders) { f in
                Button { store.move(bookmark.id, to: f.id) } label: { Label(f.name, systemImage: bookmark.folder == f.id ? "checkmark" : "folder") }
            }
        } label: { Label("Déplacer vers…", systemImage: "folder") }
    }
}

/// Grille de favoris (écran Favoris) : dossiers puis sites, 4 colonnes ; appui long = actions.
struct FavoritesIconGrid: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var icons: SiteIcons
    var folders: [BookmarkFolder] = []
    let items: [Bookmark]
    var open: (Bookmark) -> Void
    var newTab: (Bookmark) -> Void
    var remove: (Bookmark) -> Void
    var rename: (BookmarkFolder) -> Void = { _ in }
    var removeFolder: (BookmarkFolder) -> Void = { _ in }

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 20) {
            ForEach(folders) { f in
                NavigationLink(value: f.id) { FolderTile(folder: f, icons: icons) }
                    .buttonStyle(CardPressStyle())
                    .contextMenu {
                        Button { rename(f) } label: { Label("Renommer", systemImage: "pencil") }
                        Button(role: .destructive) { removeFolder(f) } label: { Label("Supprimer le dossier", systemImage: "trash") }
                    }
            }
            ForEach(items) { b in
                Button { open(b) } label: { FavoriteTile(bookmark: b, image: icons.images[b.url.host ?? ""] ?? store.tabManager.icon(for: b.url.host)) }
                    .buttonStyle(CardPressStyle())
                    .contextMenu {
                        Button { newTab(b) } label: { Label("Ouvrir dans un nouvel onglet", systemImage: "plus.square.on.square") }
                        Button { UIPasteboard.general.url = b.url } label: { Label("Copier l'adresse", systemImage: "doc.on.doc") }
                        MoveMenu(bookmark: b)
                        Divider()
                        Button(role: .destructive) { remove(b) } label: { Label("Supprimer", systemImage: "trash") }
                    }
            }
        }
        .padding(.horizontal, 16)
    }
}

/// Tuile de dossier : nom dessous, et dans le carré les icônes des 4 premiers sites (comme Safari).
struct FolderTile: View {
    @EnvironmentObject var store: BrowserStore
    let folder: BookmarkFolder
    @ObservedObject var icons: SiteIcons
    var body: some View {
        VStack(spacing: 7) {
            FolderTileIcon(folder: folder, size: 66)
            Text(folder.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                .lineLimit(2).multilineTextAlignment(.center).frame(maxWidth: 80)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

struct FolderTileIcon: View {
    @EnvironmentObject var store: BrowserStore
    let folder: BookmarkFolder
    var size: CGFloat = 66
    var body: some View {
        let marks = Array(store.bookmarksDeep(in: folder.id).prefix(4))
        let mini = size * 0.36
        let shape = RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
        shape.fill(Color.primary.opacity(0.08))
            .frame(width: size, height: size)
            .overlay {
                LazyVGrid(columns: [GridItem(.fixed(mini), spacing: size * 0.08), GridItem(.fixed(mini), spacing: size * 0.08)], spacing: size * 0.08) {
                    ForEach(0..<4, id: \.self) { i in
                        if let b = marks[safe: i] {
                            FavoriteTileIcon(bookmark: b, image: store.tabManager.icon(for: b.url.host), size: mini)
                        } else {
                            Color.clear.frame(width: mini, height: mini)
                        }
                    }
                }
            }
            .overlay(shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
    }
}

/// Import d'un fichier de favoris au format « Netscape » (exporté par Safari, Chrome, Edge, Firefox) : dossiers
/// recréés, favoris déjà présents ignorés.
enum BookmarkImport {
    @MainActor
    static func importHTML(_ html: String, into store: BrowserStore) -> Int {
        var stack: [UUID?] = [nil]
        var pendingFolder: UUID?
        var added = 0
        let known = Set(store.bookmarks.map { $0.url.absoluteString })
        var seen = known
        let pattern = #"<DT>\s*<H3[^>]*>(.*?)</H3>|<DT>\s*<A\s[^>]*HREF="([^"]+)"[^>]*>(.*?)</A>|<DL>|</DL>"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) else { return 0 }
        let ns = html as NSString
        for m in re.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            let token = ns.substring(with: m.range).uppercased()
            if token.hasPrefix("<DL") { let inherited: UUID? = stack.last ?? nil; stack.append(pendingFolder ?? inherited); pendingFolder = nil; continue }
            if token.hasPrefix("</DL") { if stack.count > 1 { stack.removeLast() }; continue }
            if m.range(at: 1).location != NSNotFound {
                let name = decode(ns.substring(with: m.range(at: 1)))
                // Barre de favoris / Favoris de Safari : contenu remis à la racine plutôt que dans un dossier technique.
                if ["favorites bar", "bookmarks bar", "barre de favoris", "barre des favoris", "favoris", "favorites", "bookmarks menu", "menu des favoris"].contains(name.lowercased()) && stack.count == 2 {
                    pendingFolder = nil
                } else {
                    let parent = stack.last ?? nil
                    let existing = store.folders.first { $0.name == name && $0.parent == parent }
                    pendingFolder = existing?.id ?? store.addFolder(name, parent: parent)
                }
                continue
            }
            if m.range(at: 2).location != NSNotFound, let url = URL(string: decode(ns.substring(with: m.range(at: 2)))), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                guard !seen.contains(url.absoluteString) else { continue }
                seen.insert(url.absoluteString)
                var title = decode(ns.substring(with: m.range(at: 3)))
                if title.isEmpty { title = url.host ?? url.absoluteString }
                store.bookmarks.append(Bookmark(title: String(title.prefix(300)), url: url, folder: stack.last ?? nil))
                added += 1
            }
        }
        return added
    }

    private static func decode(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        for (a, b) in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&#x27;", "'"), ("&nbsp;", " ")] { t = t.replacingOccurrences(of: a, with: b) }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
