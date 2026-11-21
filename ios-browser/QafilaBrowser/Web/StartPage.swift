import Foundation

/// Page de démarrage locale (aucune requête réseau) et page d'erreur.
enum StartPage {
    struct Mark { let title: String; let url: String; let icon: StartIcon?; let folder: UUID? }
    struct Folder { let id: UUID; let name: String; let parent: UUID? }

    /// Page de démarrage façon Safari : « Favoris » en grille de grandes icônes (fondues dans leur tuile) ; chaque
    /// dossier est une tuile avec les icônes de ses 4 premiers sites, qui s'ouvre sur place (ancre #f-…, sans script).
    /// `iconGrid` faux : lettres, comme avant.
    static func html(dark: Bool, bookmarks: [Mark] = [], folders: [Folder] = [], iconGrid: Bool = true) -> String {
        let ids = Set(folders.map(\.id))
        func face(_ b: Mark, mini: Bool = false) -> String {
            let cls = mini ? "mi" : "ic"
            let letter = escape(String(b.title.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased())
            guard let icon = b.icon else { return "<span class=\"\(cls) letter\">\(letter)</span>" }
            let bg = icon.background.isEmpty ? "" : " style=\"background:\(icon.background)\""
            return "<span class=\"\(cls) img\(icon.fill ? " fill" : "")\"\(bg)><img src=\"\(icon.dataURL)\" alt=\"\"></span>"
        }
        func tile(_ b: Mark) -> String {
            "<a class=\"tile\" href=\"\(escape(b.url))\">\(face(b))<span class=\"t\">\(escape(b.title))</span></a>"
        }
        func deep(_ id: UUID) -> Set<UUID> {
            var set: Set<UUID> = [id]; var grew = true
            while grew { grew = false; for f in folders { if let p = f.parent, set.contains(p), !set.contains(f.id) { set.insert(f.id); grew = true } } }
            return set
        }
        func folderTile(_ f: Folder) -> String {
            let set = deep(f.id)
            let marks = bookmarks.filter { $0.folder.map { set.contains($0) } ?? false }.prefix(4)
            let minis = marks.map { face($0, mini: true) }.joined() + String(repeating: "<span class=\"mi empty\"></span>", count: max(0, 4 - marks.count))
            return "<a class=\"tile\" href=\"#f-\(f.id.uuidString)\"><span class=\"ic fold\">\(minis)</span><span class=\"t\">\(escape(f.name))</span></a>"
        }
        let rootFolders = folders.filter { $0.parent.map { !ids.contains($0) } ?? true }
        let rootMarks = bookmarks.filter { $0.folder.map { !ids.contains($0) } ?? true }
        let views = folders.map { f -> String in
            let subs = folders.filter { $0.parent == f.id }
            let marks = bookmarks.filter { $0.folder == f.id }
            let back = f.parent.flatMap { ids.contains($0) ? "#f-\($0.uuidString)" : nil } ?? "#"
            return "<section class=\"folder\" id=\"f-\(f.id.uuidString)\"><a class=\"back\" href=\"\(back)\">‹ \(escape(L("Favoris")))</a><div class=\"fh\">\(escape(f.name))</div><div class=\"grid\">\((subs.map(folderTile) + marks.map(tile)).joined())</div></section>"
        }.joined()
        let items = (rootFolders.map(folderTile) + rootMarks.prefix(24).map(tile)).joined()
        let hasFav = !items.isEmpty
        let title = iconGrid && hasFav ? "<div class=\"fh\">\(escape(L("Favoris")))</div>" : ""
        return """
        <!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; --bg: #ffffff; --fg: #1c1c1e; --tile: #f2f2f7; --tilefg: #3a3a3c; --mini: #ffffff; --sub: #6e6e73; }
        @media (prefers-color-scheme: dark) { :root { --bg: #000000; --fg: #f2f2f7; --tile: #1c1c1e; --tilefg: #d1d1d6; --mini: #2c2c2e; --sub: #98989f; } }
        * { -webkit-tap-highlight-color: transparent; }
        body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; font-family: -apple-system, system-ui; background: var(--bg); color: var(--fg); padding-bottom: 140px; }
        .head { margin-top: \(hasFav ? "12vh" : "26vh"); text-align: center; display: flex; flex-direction: column; align-items: center; }
        .priv { margin-top: 16px; padding: 7px 14px; border-radius: 999px; font: 600 14px -apple-system, system-ui; color: #1f7a3a; background: rgba(31,122,58,.08); }
        @media (prefers-color-scheme: dark) { .priv { color: #9ad8a7; background: rgba(80,200,120,.12); } }
        .logo { width: 104px; height: 104px; display: block; filter: drop-shadow(0 6px 18px rgba(183, 121, 31, .25)); }
        .wrap, .folder { width: 344px; margin-top: 40px; }
        .fh { font: 700 24px -apple-system, system-ui; margin: 0 0 16px 4px; }
        .grid { display: grid; grid-template-columns: repeat(4, 80px); gap: 22px 8px; }
        .tile { display: flex; flex-direction: column; align-items: center; gap: 8px; text-decoration: none; color: inherit; }
        .ic { width: 68px; height: 68px; border-radius: 17px; display: flex; align-items: center; justify-content: center; overflow: hidden; background: var(--tile); color: var(--tilefg); }
        .letter { font: 600 28px -apple-system, system-ui; }
        .ic.img img { width: 44px; height: 44px; object-fit: contain; }
        .ic.img.fill img, .mi.img.fill img { width: 100%; height: 100%; object-fit: cover; }
        .ic.fold { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 9px; box-sizing: border-box; }
        .mi { width: 22px; height: 22px; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: var(--mini); font: 700 11px -apple-system, system-ui; color: var(--tilefg); }
        .mi.img img { width: 17px; height: 17px; object-fit: contain; }
        .mi.empty { background: transparent; }
        .t { font: \(iconGrid ? "600 14px" : "600 13px") -apple-system, system-ui; color: \(iconGrid ? "var(--fg)" : "#8e8e93"); max-width: 80px; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.2; }
        .folder { display: none; }
        .folder:target { display: block; }
        body:has(.folder:target) .wrap, body:has(.folder:target) .head { display: none; }
        .back { display: inline-block; margin: 8vh 0 10px 4px; font: 600 17px -apple-system, system-ui; color: var(--sub); text-decoration: none; }
        </style></head><body><div class="head">\(QafilaLogo.svg)<div class="priv">🛡︎ \(escape(L("Aucune collecte · Tout reste sur cet appareil")))</div></div>
        \(hasFav ? "<div class=\"wrap\">\(title)<div class=\"grid\">\(items)</div></div>" : "")
        \(views)</body></html>
        """
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    static func error(message: String, url: String) -> String {
        """
        <!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,system-ui;text-align:center;padding:24px;background:#ffffff;color:#1c1c1e}@media(prefers-color-scheme:dark){body{background:#000000;color:#f2f2f7}}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#8e8e93;font-size:15px;max-width:360px}</style>
        </head><body><h1>\(L("Page inaccessible"))</h1><p>\(message)</p><p style="font-size:13px;word-break:break-all">\(url)</p></body></html>
        """
    }
}
