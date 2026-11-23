import SwiftUI
import UIKit

/// État de la saisie d'adresse, partagé entre le champ (dans la barre) et le panneau de suggestions (au-dessus).
@MainActor
final class AddressEditModel: ObservableObject {
    @Published var text = ""
    @Published var suggestions: [String] = []
    private var task: Task<Void, Never>?
    /// Adresses des favoris et de l'historique, dédoublonnées une fois par saisie (pas à chaque frappe).
    private var localIndex: [(url: String, lower: String)]?

    func fetch(_ q: String, store: BrowserStore) {
        task?.cancel()
        // L'adresse de la page courante pré-remplit le champ : rien à chercher tant qu'elle n'est pas modifiée.
        if q == store.selectedTab?.url?.absoluteString { suggestions = []; return }
        let lower = q.lowercased()
        if localIndex == nil {
            localIndex = Array(Set(store.bookmarks.map(\.url.absoluteString) + store.history.map(\.url.absoluteString))).map { (url: $0, lower: $0.lowercased()) }
        }
        let local = Array((localIndex ?? []).lazy.filter { $0.lower.contains(lower) }.prefix(2).map(\.url))
        let s = store.settings
        let allowed: Bool = {
            switch s.suggestions {
            case .everywhere: return true
            case .notPrivate: return store.selectedTab?.isPrivate != true
            case .never: return false
            }
        }()
        guard allowed, q.count >= 2, let base = s.searchEngine.suggestURL(settings: s) else { suggestions = q.isEmpty ? [] : local; return }
        task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled, let url = URL(string: base + (q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")) else { return }
            guard let (data, _) = try? await URLSession.shared.data(from: url), let obj = try? JSONSerialization.jsonObject(with: data) else { return }
            var remote: [String] = []
            if let arr = obj as? [Any], arr.count >= 2, let list = arr[1] as? [String] { remote = list }        // OpenSearch [q, [..]]
            else if let list = obj as? [String] { remote = list }                                                // Qafila /api/suggest
            else if let list = obj as? [[String: Any]] { remote = list.compactMap { $0["phrase"] as? String } }   // DuckDuckGo
            guard !Task.isCancelled else { return }
            self?.suggestions = local + remote.prefix(6)
        }
    }

    func reset() { task?.cancel(); suggestions = []; text = ""; localIndex = nil }
}

/// Barre en mode saisie : champ dans la carte + « Annuler ».
struct AddressEditorRow: View {
    @EnvironmentObject var store: BrowserStore
    @Environment(\.chromeCard) private var cardColor
    @Environment(\.chromeCardRadius) private var cardRadius
    @ObservedObject var editor: AddressEditModel
    @FocusState private var focused: Bool
    private var ui: CGFloat { store.settings.ui }

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 16 * ui, weight: .medium)).foregroundStyle(.secondary)
                TextField("Rechercher ou saisir une adresse", text: $editor.text)
                    .font(.system(size: 17 * ui))
                    .focused($focused)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.webSearch).submitLabel(.go)
                    .onSubmit { submit(editor.text) }
                    .onChange(of: editor.text) { _, v in editor.fetch(v, store: store) }
                if !editor.text.isEmpty {
                    Button { editor.text = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 19 * ui)).foregroundStyle(.secondary).frame(width: 36, height: 36).contentShape(Rectangle()) }.buttonStyle(.plain)
                }
            }
            .padding(.leading, 14).padding(.trailing, editor.text.isEmpty ? 14 : 4)
            .frame(height: 52 * ui)
            .background {
                let card = RoundedRectangle(cornerRadius: cardRadius ?? 14, style: .continuous)
                card.fill(cardColor).overlay(card.strokeBorder(Color.primary.opacity(0.14), lineWidth: 0.75))
            }

            Button { cancel() } label: { Text("Annuler").font(.system(size: 17 * ui)).padding(.horizontal, 4).frame(minHeight: 44).contentShape(Rectangle()) }
                .buttonStyle(.plain).foregroundStyle(.primary)
        }
        .onAppear {
            editor.text = store.selectedTab?.url?.absoluteString ?? ""
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                focused = true
                // Comme Safari : l'adresse entière est sélectionnée, la saisie la remplace au lieu de s'ajouter à la suite.
                guard !editor.text.isEmpty else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                    UIApplication.shared.sendAction(#selector(UIResponder.selectAll(_:)), to: nil, from: nil, for: nil)
                }
            }
        }
    }

    private func submit(_ s: String) {
        guard !s.trimmingCharacters(in: .whitespaces).isEmpty else { cancel(); return }
        store.navigate(s)
        editor.reset()
    }
    private func cancel() { store.isEditingAddress = false; editor.reset() }
}

/// Panneau flottant au-dessus de la barre : suggestions, ou favoris et pages récentes quand le champ est vide.
struct SuggestionsPanel: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var editor: AddressEditModel

    private var showingDefaults: Bool { editor.text.isEmpty || editor.text == store.selectedTab?.url?.absoluteString }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showingDefaults {
                if !store.bookmarks.isEmpty || !store.folders.isEmpty {
                    if store.settings.favoritesStyle == .icons {
                        FavoritesGrid(icons: store.tabManager.siteIcons, limit: 8) { go($0.url.absoluteString) }
                            .padding(.bottom, 6)
                    } else {
                        header("FAVORIS")
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 14) {
                                ForEach(store.bookmarks.prefix(10)) { b in
                                    Button { go(b.url.absoluteString) } label: {
                                        VStack(spacing: 6) {
                                            Text(String(b.title.prefix(1)).uppercased())
                                                .font(.system(size: 22, weight: .semibold, design: .serif))
                                                .frame(width: 56, height: 56)
                                                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.primary.opacity(0.07)))
                                            Text(b.title).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary).lineLimit(1).frame(width: 66)
                                        }
                                    }.buttonStyle(.plain)
                                }
                            }.padding(.horizontal, 14)
                        }.padding(.bottom, 8)
                    }
                }
                let recent = Array(store.history.prefix(4))
                if !recent.isEmpty {
                    header("RÉCENTS")
                    ForEach(recent) { e in row(icon: "clock", text: e.title, detail: e.url.host) { go(e.url.absoluteString) } }
                }
            } else {
                ForEach(editor.suggestions.prefix(7), id: \.self) { s in
                    let isURL = s.contains(".") && !s.contains(" ")
                    row(icon: isURL ? "globe" : "magnifyingglass", text: s, detail: nil) { go(s) }
                }
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.75))
        .shadow(color: .black.opacity(0.16), radius: 18, y: 4)
    }

    private func header(_ t: String) -> some View {
        Text(t).font(.system(size: 12.5, weight: .bold)).tracking(0.5).foregroundStyle(.secondary)
            .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 6)
    }

    private func row(icon: String, text: String, detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(.secondary).frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text(text).font(.system(size: 17)).foregroundStyle(.primary).lineLimit(1)
                    if let d = detail { Text(d).font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.left").font(.system(size: 13, weight: .semibold)).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 18).frame(minHeight: 50).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func go(_ s: String) { store.navigate(s); editor.reset() }
}

/// Favoris façon Safari : titre « Favoris » et « Tout afficher », grille de 4 grandes icônes de sites avec leur nom.
struct FavoritesGrid: View {
    @EnvironmentObject var store: BrowserStore
    @ObservedObject var icons: SiteIcons
    var limit = 8
    var open: (Bookmark) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Favoris").font(.system(size: 22, weight: .bold))
                Spacer()
                Button { store.isEditingAddress = false; store.showBookmarks = true } label: {
                    HStack(spacing: 3) {
                        Text("Tout afficher").font(.system(size: 16, weight: .semibold))
                        Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.secondary)
                    .frame(minHeight: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: 4), spacing: 16) {
                // Dossiers d'abord (tuile aux 4 miniatures, comme Safari), puis les favoris de la racine.
                let folders = Array(store.subfolders(of: nil).prefix(limit))
                ForEach(folders) { f in
                    Button { store.openFolder = f.id; store.isEditingAddress = false; store.showBookmarks = true } label: { FolderTile(folder: f, icons: icons) }
                        .buttonStyle(CardPressStyle())
                }
                ForEach(store.bookmarks(in: nil).prefix(max(0, limit - folders.count))) { b in
                    Button { open(b) } label: { FavoriteTile(bookmark: b, image: icons.images[b.url.host ?? ""] ?? store.tabManager.icon(for: b.url.host)) }
                        .buttonStyle(CardPressStyle())
                }
            }
        }
        .padding(.horizontal, 18).padding(.top, 10)
    }
}

struct FavoriteTile: View {
    let bookmark: Bookmark
    let image: UIImage?
    var body: some View {
        VStack(spacing: 7) {
            FavoriteTileIcon(bookmark: bookmark, image: image, size: 66)
            Text(bookmark.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.primary)
                .lineLimit(2).multilineTextAlignment(.center).frame(maxWidth: 80)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

/// Carré arrondi avec l'icône du site (ou sa première lettre). L'icône se fond dans sa tuile : fond de la couleur de
/// ses bords, et une grande icône opaque couvre toute la tuile (comme les favoris de Safari).
struct FavoriteTileIcon: View {
    let bookmark: Bookmark
    let image: UIImage?
    var size: CGFloat = 66

    private final class Style { let color: Color?; let fill: Bool; init(_ c: Color?, _ f: Bool) { color = c; fill = f } }
    private static let styles: NSCache<UIImage, Style> = { let c = NSCache<UIImage, Style>(); c.countLimit = 300; return c }()
    private static func style(_ img: UIImage) -> Style {
        if let s = styles.object(forKey: img) { return s }
        let t = img.tileStyle()
        let s = Style(t.flatMap { $0.hex.isEmpty ? nil : Color(uiColor: $0.color) }, t?.fill ?? false)
        styles.setObject(s, forKey: img)
        return s
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
        let st = image.map(Self.style)
        shape.fill(st?.color ?? Color.primary.opacity(0.08))
            .frame(width: size, height: size)
            .overlay {
                if let image {
                    if st?.fill == true {
                        Image(uiImage: image).resizable().interpolation(.high).scaledToFill()
                            .frame(width: size, height: size)
                    } else {
                        Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
                            .frame(width: size * 0.64, height: size * 0.64)
                    }
                } else {
                    Text(String(bookmark.title.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
                        .font(.system(size: size * 0.4, weight: .semibold, design: .rounded)).foregroundStyle(.secondary)
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(0.06), lineWidth: 0.5))
    }
}
