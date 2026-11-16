import SwiftUI
import StoreKit

/// Canal de soutien, fixé à la compilation (Info.plist `QafilaSupportChannel` = réglage `QAFILA_SUPPORT_CHANNEL`).
/// - `store` (par défaut : App Store, TestFlight, Xcode) : abonnement StoreKit qui débloque l'icône « Or ».
/// - `stripe` (IPA de test hors App Store, ou App Store une fois inscrit aux conditions de lien externe d'Apple) :
///   lien de paiement Stripe ouvert dans Safari (Apple Pay), rien n'est débloqué, l'icône « Or » est pour tout le monde.
/// Valeur inconnue ou absente → `store`.
enum SupportChannel: String {
    case store, stripe

    static let current: SupportChannel = {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "QafilaSupportChannel") as? String) ?? ""
        return SupportChannel(rawValue: raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) ?? .store
    }()
}

/// Lien de soutien partagé par toutes les plateformes : `shared/support.json`, embarqué tel quel dans l'appli.
struct SupportConfig: Decodable {
    let stripePaymentLink: String
    let allowedHosts: [String]

    /// Lien Stripe validé (https, hôte autorisé, sans identifiants ni port), sinon nil = soutien « Bientôt disponible ».
    static func stripeURL(bundle: Bundle = .main) -> URL? {
        guard let file = bundle.url(forResource: "support", withExtension: "json"),
              let data = try? Data(contentsOf: file),
              let config = try? JSONDecoder().decode(SupportConfig.self, from: data) else { return nil }
        return config.validatedURL
    }

    var validatedURL: URL? {
        let raw = stripePaymentLink.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty, let parts = URLComponents(string: raw),
              parts.scheme?.lowercased() == "https",
              let host = parts.host?.lowercased(),
              allowedHosts.contains(where: { $0.lowercased() == host }),
              parts.user == nil, parts.password == nil, parts.port == nil,
              let url = parts.url else { return nil }
        return url
    }
}

/// Soutien à Qafila. Canal `store` : abonnement « Soutenir Qafila » (0,99 €/mois), seul avantage l'icône exclusive « Or ».
/// StoreKit 2 : l'état vient des droits vérifiés par Apple (`Transaction.currentEntitlements`), mis en cache pour l'affichage hors ligne.
/// Canal `stripe` : StoreKit n'est jamais sollicité ; seul le lien Stripe validé est exposé.
@MainActor
final class SupportStore: ObservableObject {
    static let productID = "qafila_soutien_mensuel"
    static let fallbackPrice = "0,99 €"

    let channel = SupportChannel.current
    /// Lien de paiement Stripe validé (canal `stripe` uniquement) ; nil = pas encore configuré.
    let stripeURL: URL? = SupportChannel.current == .stripe ? SupportConfig.stripeURL() : nil

    var usesStripe: Bool { channel == .stripe }
    /// L'icône « Or » : offerte à tous en mode Stripe (aucun déblocage contre un paiement externe), réservée aux abonnés sinon.
    var goldUnlocked: Bool { usesStripe || isSupporter }

    @Published private(set) var product: Product?
    @Published private(set) var isSupporter: Bool = SupportChannel.current == .store && UserDefaults.standard.bool(forKey: "qafila.supporter") {
        didSet { UserDefaults.standard.set(isSupporter, forKey: "qafila.supporter") }
    }
    @Published private(set) var busy = false
    @Published var message: String?

    /// Appelé quand le soutien prend fin (pour quitter l'icône Or).
    var onSupportEnded: (() -> Void)?
    private var updates: Task<Void, Never>?

    var price: String { product?.displayPrice ?? Self.fallbackPrice }

    init() {
        guard channel == .store else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let t) = result { await t.finish() }
                await self?.refresh()
            }
        }
        Task { await load() }
    }

    func load() async {
        guard channel == .store else { return }
        if product == nil { product = try? await Product.products(for: [Self.productID]).first }
        await refresh()
    }

    /// Droits en cours : abonnement vérifié, non remboursé, non expiré.
    func refresh() async {
        guard channel == .store else { return }
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
        guard channel == .store, !busy else { return }
        busy = true
        defer { busy = false }
        if product == nil { await load() }
        guard let product else { message = L("Achat indisponible pour le moment. Réessayez plus tard."); return }
        do {
            switch try await product.purchase() {
            case .success(let result):
                if case .verified(let t) = result { await t.finish() }
                await refresh()
                if isSupporter { message = L("Merci pour votre soutien ♥") }
            case .pending: message = L("Achat en attente de validation.")
            case .userCancelled: break
            @unknown default: break
            }
        } catch {
            message = L("L'achat n'a pas abouti : %@", error.localizedDescription)
        }
    }

    func restore() async {
        guard channel == .store else { return }
        busy = true
        defer { busy = false }
        try? await AppStore.sync()
        await refresh()
        message = isSupporter ? L("Abonnement retrouvé. Merci ♥") : L("Aucun abonnement trouvé pour ce compte Apple.")
    }

    /// Mode démo (captures) : simule un soutien actif.
    func setDemoSupporter(_ on: Bool) { isSupporter = on }
}
