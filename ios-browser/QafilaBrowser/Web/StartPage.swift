import Foundation

/// Page de démarrage locale (aucune requête réseau) et page d'erreur.
enum StartPage {
    /// `iconGrid` : favoris en grandes icônes de sites façon Safari (titre « Favoris » au-dessus) ; sinon lettres.
    static func html(dark: Bool, bookmarks: [(title: String, url: String, icon: StartIcon?)] = [], iconGrid: Bool = true) -> String {
        let tiles = bookmarks.map { b -> String in
            let letter = String(b.title.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
            guard let icon = b.icon else {
                return "<a class=\"tile\" href=\"\(escape(b.url))\"><span class=\"ic\">\(escape(letter))</span><span class=\"t\">\(escape(b.title))</span></a>"
            }
            // Icône fondue dans sa tuile : fond = couleur de ses bords ; grande icône opaque = tuile entièrement couverte.
            let bg = icon.background.isEmpty ? "" : " style=\"background:\(icon.background)\""
            return "<a class=\"tile\" href=\"\(escape(b.url))\"><span class=\"ic img\(icon.fill ? " fill" : "")\"\(bg)><img src=\"\(icon.dataURL)\" alt=\"\"></span><span class=\"t\">\(escape(b.title))</span></a>"
        }.joined()
        let title = iconGrid && !bookmarks.isEmpty ? "<div class=\"fh\">\(escape(L("Favoris")))</div>" : ""
        return """
        <!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; --bg: #ffffff; --fg: #1c1c1e; --tile: #f2f2f7; --tilefg: #3a3a3c; }
        @media (prefers-color-scheme: dark) { :root { --bg: #000000; --fg: #f2f2f7; --tile: #1c1c1e; --tilefg: #d1d1d6; } }
        * { -webkit-tap-highlight-color: transparent; }
        body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; font-family: -apple-system, system-ui; background: var(--bg); color: var(--fg); }
        .head { margin-top: 26vh; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .priv { margin-top: 16px; padding: 7px 14px; border-radius: 999px; font: 600 14px -apple-system, system-ui; color: #1f7a3a; background: rgba(31,122,58,.08); }
        @media (prefers-color-scheme: dark) { .priv { color: #9ad8a7; background: rgba(80,200,120,.12); } }
        .logo { width: 112px; height: 112px; display: block; filter: drop-shadow(0 6px 18px rgba(183, 121, 31, .25)); }
        .grid { display: grid; grid-template-columns: repeat(4, 76px); gap: 22px 12px; margin-top: 46px; }
        .tile { display: flex; flex-direction: column; align-items: center; gap: 7px; text-decoration: none; color: inherit; }
        .ic { width: 64px; height: 64px; border-radius: 17px; display: flex; align-items: center; justify-content: center; font: 600 26px "New York", Georgia, serif; background: var(--tile); color: var(--tilefg); }
        .t { font-size: 13px; font-weight: 600; color: #8e8e93; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ic.img { background: var(--tile); overflow: hidden; }
        .ic.img img { width: 42px; height: 42px; object-fit: contain; }
        .ic.img.fill img { width: 100%; height: 100%; object-fit: cover; }
        .wrap { display: flex; flex-direction: column; align-items: stretch; margin-top: 46px; }
        .fh { font: 700 22px -apple-system, system-ui; margin: 0 0 14px 2px; }
        .wrap .grid { margin-top: 0; }
        </style></head><body><div class="head">\(QafilaLogo.svg)<div class="priv">🛡︎ \(escape(L("Aucune collecte · Tout reste sur cet appareil")))</div></div>
        <div class="wrap">\(title)<div class="grid">\(tiles)</div></div></body></html>
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
