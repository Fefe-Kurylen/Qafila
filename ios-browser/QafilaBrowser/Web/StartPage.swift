import Foundation

/// Page de démarrage locale (aucune requête réseau) et page d'erreur.
enum StartPage {
    static func html(dark: Bool, bookmarks: [(title: String, url: String)] = []) -> String {
        let tiles = bookmarks.map { b -> String in
            let letter = String(b.title.trimmingCharacters(in: .whitespaces).prefix(1)).uppercased()
            return "<a class=\"tile\" href=\"\(escape(b.url))\"><span class=\"ic\">\(escape(letter))</span><span class=\"t\">\(escape(b.title))</span></a>"
        }.joined()
        return """
        <!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        :root { color-scheme: light dark; --bg: #ffffff; --fg: #1c1c1e; --tile: #f2f2f7; --tilefg: #3a3a3c; }
        @media (prefers-color-scheme: dark) { :root { --bg: #000000; --fg: #f2f2f7; --tile: #1c1c1e; --tilefg: #d1d1d6; } }
        * { -webkit-tap-highlight-color: transparent; }
        body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; font-family: -apple-system, system-ui; background: var(--bg); color: var(--fg); }
        .head { margin-top: 26vh; text-align: center; display: flex; flex-direction: column; align-items: center; }
        .priv { margin-top: 14px; padding: 5px 12px; border-radius: 999px; font: 500 12px -apple-system, system-ui; color: #1f7a3a; background: rgba(31,122,58,.08); }
        @media (prefers-color-scheme: dark) { .priv { color: #9ad8a7; background: rgba(80,200,120,.12); } }
        .logo { width: 104px; height: 104px; display: block; filter: drop-shadow(0 6px 18px rgba(183, 121, 31, .25)); }
        .grid { display: grid; grid-template-columns: repeat(4, 72px); gap: 18px 14px; margin-top: 44px; }
        .tile { display: flex; flex-direction: column; align-items: center; gap: 7px; text-decoration: none; color: inherit; }
        .ic { width: 56px; height: 56px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font: 500 22px "New York", Georgia, serif; background: var(--tile); color: var(--tilefg); }
        .t { font-size: 11px; color: #8e8e93; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        </style></head><body><div class="head">\(QafilaLogo.svg)<div class="priv">🛡︎ \(escape(L("Aucune collecte · Tout reste sur cet appareil")))</div></div>
        <div class="grid">\(tiles)</div></body></html>
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
