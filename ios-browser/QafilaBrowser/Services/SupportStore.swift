import SwiftUI
import StoreKit

/// Abonnement « Soutenir Qafila » (0,99 €/mois) : seul avantage, l'icône exclusive « Or ». Tout le reste est gratuit.
/// StoreKit 2 : l'état vient des droits vérifiés par Apple (`Transaction.currentEntitlements`), mis en cache pour l'affichage hors ligne.
@MainActor
final class SupportStore: ObservableObject {
    static let productID = "qafila_soutien_mensuel"
    static let fallbackPrice = "0,99 €"

    @Published private(set) var product: Product?
    @Published private(set) var isSupporter: Bool = UserDefaults.standard.bool(forKey: "qafila.supporter") {
        didSet { UserDefaults.standard.set(isSupporter, forKey: "qafila.supporter") }
    }
    @Published private(set) var busy = false
    @Published var message: String?

    /// Appelé quand le soutien prend fin (pour quitter l'icône Or).
    var onSupportEnded: (() -> Void)?
    private var updates: Task<Void, Never>?

    var price: String { product?.displayPrice ?? Self.fallbackPrice }

    init() {
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                await self?.refresh()
            }
        }
        Task { await load() }
    }

    func load() async {
        if product == nil { product = try? await Product.products(for: [Self.productID]).first }
        await refresh()
    }

    /// Droits en cours : abonnement vérifié, non remboursé, non expiré.
    func refresh() async {
        var active = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result, t.productID == Self.productID, t.revocationDate == nil else { continue }
            if let exp = t.expirationDate, exp < Date() { continue }
            active = true
        }
        let was = isSupporter
        isSupporter = active
        if was && !active { onSupportEnded?() }
    }

    func purchase() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        if product == nil { await load() }
        guard let product else { message = "Achat indisponible pour le moment. Réessayez plus tard."; return }
        do {
            switch try await product.purchase() {
            case .success(let result):
                if case .verified(let t) = result { await t.finish() }
                await refresh()
                if isSupporter { message = "Merci pour votre soutien ♥" }
            case .pending: message = "Achat en attente de validation."
            case .userCancelled: break
            @unknown default: break
            }
        } catch {
            message = "L'achat n'a pas abouti : \(error.localizedDescription)"
        }
    }

    func restore() async {
        busy = true
        defer { busy = false }
        try? await AppStore.sync()
        await refresh()
        message = isSupporter ? "Abonnement retrouvé. Merci ♥" : "Aucun abonnement trouvé pour ce compte Apple."
    }

    /// Mode démo (captures) : simule un soutien actif.
    func setDemoSupporter(_ on: Bool) { isSupporter = on }
}
