import Foundation
import UIKit

/// Un onglet : état persistant (l'instance WKWebView vit dans TabManager, pas ici).
struct BrowserTab: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var url: URL?
    var title: String = ""
    var isPrivate: Bool = false
    var createdAt: Date = Date()
    var lastVisited: Date = Date()
    /// Temps de lecture estimé en minutes (calculé par script dans la page).
    var readingMinutes: Int = 0
    var faviconData: Data?
    var themeColorHex: String?

    var host: String {
        guard let h = url?.host else { return L("Nouvel onglet") }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }
    var displayTitle: String { title.isEmpty ? (url?.absoluteString ?? L("Nouvel onglet")) : title }
    /// Icône décodée une seule fois par image (la barre et la liste des onglets la redemandent à chaque rendu).
    var favicon: UIImage? {
        guard let d = faviconData, !d.isEmpty else { return nil }
        let key = d as NSData
        if let img = Self.faviconImages.object(forKey: key) { return img }
        guard let img = UIImage(data: d) else { return nil }
        Self.faviconImages.setObject(img, forKey: key)
        return img
    }
    private static let faviconImages: NSCache<NSData, UIImage> = { let c = NSCache<NSData, UIImage>(); c.countLimit = 200; return c }()
    var readingLabel: String? { readingMinutes > 0 ? L("%ld min", readingMinutes) : nil }
}

struct Bookmark: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var title: String
    var url: URL
    var addedAt: Date = Date()
}

struct HistoryEntry: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var title: String
    var url: URL
    var visitedAt: Date = Date()
}
