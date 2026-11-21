import SwiftUI
@preconcurrency import WebKit
import Combine

/// Progression et état de chargement, à part : seules la ligne de progression et l'icône Recharger les observent,
/// le reste de l'interface ne se redessine pas à chaque tic de chargement.
@MainActor
final class LoadState: ObservableObject {
    @Published var progress: [UUID: Double] = [:]
    @Published var loading: Set<UUID> = []
}

/// Icône d'un favori pour la page de démarrage.
struct StartIcon { let dataURL: String; let background: String; let fill: Bool }

extension UIImage {
    /// Réduction (côté le plus long = `side` px) pour les vignettes.
    func resized(to side: CGFloat) -> UIImage {
        let scale = min(1, side / max(size.width * self.scale, size.height * self.scale))
        guard scale < 1 else { return self }
        let target = CGSize(width: size.width * self.scale * scale, height: size.height * self.scale * scale)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }

    /// Couleur moyenne des bords de l'icône (fond de tuile assorti) et si elle peut remplir toute la tuile
    /// (grande icône, bords opaques, comme les icônes d'écran d'accueil). `nil` si l'image est illisible.
    func tileStyle() -> (color: UIColor, hex: String, fill: Bool)? {
        guard let cg = cgImage else { return nil }
        let n = 24
        var px = [UInt8](repeating: 0, count: n * n * 4)
        guard let ctx = CGContext(data: &px, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: n, height: n))
        var r = 0.0, g = 0.0, b = 0.0, a = 0.0, count = 0.0
        for y in 0..<n { for x in 0..<n where x == 0 || y == 0 || x == n - 1 || y == n - 1 {
            let i = (y * n + x) * 4
            r += Double(px[i]); g += Double(px[i + 1]); b += Double(px[i + 2]); a += Double(px[i + 3]); count += 1
        } }
        let alpha = a / count / 255
        let big = max(cg.width, cg.height) >= 96
        // Bords transparents : fond neutre (l'icône garde sa forme) ; sinon la couleur des bords.
        guard alpha > 0.6 else { return (UIColor.secondarySystemFill, "", false) }
        let c = UIColor(red: r / count / 255 / alpha, green: g / count / 255 / alpha, blue: b / count / 255 / alpha, alpha: 1)
        let hex = String(format: "#%02x%02x%02x", Int(min(255, r / count / alpha)), Int(min(255, g / count / alpha)), Int(min(255, b / count / alpha)))
        return (c, hex, big && alpha > 0.95)
    }
}

/// Icônes des sites favoris (grille façon Safari, page de démarrage), à part : seules les vues des favoris l'observent.
@MainActor
final class SiteIcons: ObservableObject {
    @Published var images: [String: UIImage] = [:]
}

/// Conserve une WKWebView par onglet (l'état de navigation survit aux changements d'onglet), applique les règles de blocage,
/// le mode sombre, le user agent, et remonte titre / URL / progression au store.
@MainActor
final class TabManager: NSObject, ObservableObject {
    weak var store: BrowserStore?
    let loadState = LoadState()
    @Published var navState: [UUID: (back: Bool, forward: Bool)] = [:]
    @Published var readerActive: Set<UUID> = []

    private var views: [UUID: WKWebView] = [:]
    private var observers: [UUID: [NSKeyValueObservation]] = [:]
    private var adsRules: WKContentRuleList?
    private var trackerRules: WKContentRuleList?
    private var cookieRules: WKContentRuleList?
    private let processPool = WKProcessPool()
    /// Données des onglets privés (cookies, cache) : créées avec le premier onglet privé, détruites avec le dernier.
    private var privateDataStore: WKWebsiteDataStore?
    /// Nombre maximal de pages gardées en mémoire ; au-delà, les moins récemment visitées sont libérées (rechargées à l'ouverture).
    static let maxLiveViews = 6
    // Icônes de site : une requête par hôte au plus (Data vide = aucune icône trouvée), trois téléchargements à la fois.
    private var faviconCache: [String: Data] = [:]
    private var faviconQueue: [(host: String, icon: String)] = []
    private var faviconWaiting: [String: [UUID]] = [:]
    private var faviconActive = 0
    let siteIcons = SiteIcons()
    /// Icônes gardées sur l'appareil (dossier Caches) : la grille des favoris s'affiche tout de suite au lancement.
    private static let iconFolder: URL = {
        let u = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("site-icons", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private static func iconFile(_ host: String) -> URL { iconFolder.appendingPathComponent(host.replacingOccurrences(of: "/", with: "_")) }

    override init() {
        super.init()
        ContentBlocker.compile { [weak self] ads, trackers, cookies in
            Task { @MainActor in self?.adsRules = ads; self?.trackerRules = trackers; self?.cookieRules = cookies; self?.applyRules() }
        }
    }

    // MARK: Création
    func webView(for id: UUID) -> WKWebView {
        if let v = views[id] { return v }
        guard let tab = store?.tabs.first(where: { $0.id == id }) else { return WKWebView() }
        // Page vierge préparée à l'avance (onglets normaux) : le nouvel onglet s'affiche sans attendre la création de WebKit.
        let web: WKWebView
        if !tab.isPrivate, let ready = spare { web = ready; spare = nil } else { web = makeWebView(isPrivate: tab.isPrivate) }
        web.pageZoom = CGFloat(store?.settings.textZoom ?? 1)
        web.allowsBackForwardNavigationGestures = store?.settings.edgeSwipeNavigation ?? true
        views[id] = web
        observe(web, id: id)
        applyRules(to: web)
        applyUserAgent(id)
        if let url = tab.url { web.load(URLRequest(url: url)) } else { loadStartPage(web) }
        // Hors du cycle de rendu de SwiftUI (cette méthode est appelée depuis le conteneur de la page).
        Task { @MainActor [weak self] in self?.evictIfNeeded(keeping: id); self?.prepareSpareSoon() }
        return web
    }

    private var spare: WKWebView?
    /// Prépare la prochaine page vierge un peu après (jamais pendant une animation ou un chargement en cours d'affichage).
    private func prepareSpareSoon() {
        guard spare == nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self, self.spare == nil else { return }
            self.spare = self.makeWebView(isPrivate: false)
        }
    }

    private func makeWebView(isPrivate: Bool) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.processPool = processPool
        config.websiteDataStore = isPrivate ? privateStore() : .default()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.preferredContentMode = .mobile
        // Même signature que Safari : les sites (dont la connexion Google) traitent Qafila comme un vrai navigateur.
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        let controller = WKUserContentController()
        controller.add(LeakAvoider(self), name: "qafila")
        controller.addUserScript(WKUserScript(source: Scripts.pageInfo, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = controller

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsLinkPreview = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isFindInteractionEnabled = true
        web.backgroundColor = .systemBackground
        web.isOpaque = false
        return web
    }

    private func privateStore() -> WKWebsiteDataStore {
        if let s = privateDataStore { return s }
        let s = WKWebsiteDataStore.nonPersistent()
        privateDataStore = s
        return s
    }

    /// Plus aucun onglet privé : les données de navigation privée disparaissent avec la dernière page.
    func dropPrivateData() { privateDataStore = nil }

    /// Garde au plus `maxLiveViews` pages vivantes : les moins récemment visitées sont libérées, jamais l'onglet sélectionné.
    private func evictIfNeeded(keeping id: UUID) {
        guard let store, views.count > Self.maxLiveViews else { return }
        let protected = Set([id, store.selectedTabID].compactMap { $0 })
        func visited(_ id: UUID) -> Date { store.tabs.first { $0.id == id }?.lastVisited ?? .distantPast }
        let victims = views.keys.filter { !protected.contains($0) }.sorted { visited($0) < visited($1) }
        for v in victims.prefix(views.count - Self.maxLiveViews) { discard(v) }
    }

    func discard(_ id: UUID) {
        observers[id]?.forEach { $0.invalidate() }
        observers[id] = nil
        views[id]?.removeFromSuperview()
        views[id] = nil
        loadState.progress[id] = nil; loadState.loading.remove(id); navState[id] = nil; readerActive.remove(id)
    }

    private func observe(_ web: WKWebView, id: UUID) {
        observers[id] = [
            // Progression arrondie au vingtième : quelques mises à jour par chargement au lieu de dizaines.
            web.observe(\.estimatedProgress) { [weak self] w, _ in Task { @MainActor in
                guard let load = self?.loadState else { return }
                let p = (w.estimatedProgress * 20).rounded() / 20
                if load.progress[id] != p { load.progress[id] = p }
            } },
            web.observe(\.isLoading) { [weak self] w, _ in Task { @MainActor in
                guard let load = self?.loadState else { return }
                if w.isLoading { if !load.loading.contains(id) { load.loading.insert(id) } } else if load.loading.contains(id) { load.loading.remove(id) }
            } },
            web.observe(\.title) { [weak self] w, _ in Task { @MainActor in self?.store?.update(id) { $0.title = w.title ?? "" } } },
            web.observe(\.url) { [weak self] w, _ in Task { @MainActor in
                guard let u = w.url, u.scheme != "about" else { return }
                self?.store?.update(id) { $0.url = u; $0.lastVisited = Date() }
                self?.readerActive.remove(id)
            } },
            web.observe(\.canGoBack) { [weak self] w, _ in Task { @MainActor in self?.setNav(id, w) } },
            web.observe(\.canGoForward) { [weak self] w, _ in Task { @MainActor in self?.setNav(id, w) } },
            // La zone sous la barre d'état (marge haute) prend la couleur de fond de la page : aucun aplat clair ou noir.
            web.observe(\.underPageBackgroundColor) { w, _ in Task { @MainActor in
                let c = w.underPageBackgroundColor ?? .systemBackground
                w.backgroundColor = c; w.scrollView.backgroundColor = c
            } },
            web.observe(\.themeColor) { [weak self] w, _ in Task { @MainActor in
                guard let store = self?.store, store.selectedTabID == id else { return }
                let c = w.themeColor.map { Color(uiColor: $0) }
                if store.siteThemeColor != c { store.siteThemeColor = c }
            } },
        ]
    }

    private func setNav(_ id: UUID, _ w: WKWebView) {
        let n = (back: w.canGoBack, forward: w.canGoForward)
        if let old = navState[id], old.back == n.back, old.forward == n.forward { return }
        navState[id] = n
    }

    // MARK: Navigation
    func load(_ url: URL?, in id: UUID) {
        let web = webView(for: id)
        readerActive.remove(id)
        if let url, url.scheme != "about" { web.load(URLRequest(url: url)); return }
        // Accueil ou page vide : l'onglet repart de zéro (adresse, titre, icône et temps de lecture de l'ancien site).
        store?.update(id) { $0.url = url; $0.title = ""; $0.faviconData = nil; $0.themeColorHex = nil; $0.readingMinutes = 0 }
        if store?.selectedTabID == id, store?.siteThemeColor != nil { store?.siteThemeColor = nil }
        if let url { web.load(URLRequest(url: url)) } else { loadStartPage(web) }
    }

    private func loadStartPage(_ web: WKWebView) {
        let icons = store?.settings.favoritesStyle != .letters
        // Icônes pour les 80 premiers favoris (page légère) ; les suivants, plus rarement vus, gardent leur initiale.
        let marks = (store?.bookmarks ?? []).prefix(300).enumerated().map { i, b in
            StartPage.Mark(title: b.title, url: b.url.absoluteString, icon: icons && i < 80 ? startIcon(for: b.url.host) : nil, folder: b.folder)
        }
        let folders = (store?.folders ?? []).map { StartPage.Folder(id: $0.id, name: $0.name, parent: $0.parent) }
        web.loadHTMLString(StartPage.html(dark: store?.isDarkScheme ?? false, bookmarks: Array(marks), folders: folders, iconGrid: icons), baseURL: nil)
    }

    /// Une icône de favori vient d'arriver : les pages de démarrage ouvertes sont redessinées (une fois, un peu plus tard).
    private var startRefresh: DispatchWorkItem?
    func refreshStartPagesSoon() {
        startRefresh?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.refreshStartPages() }
        startRefresh = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
    }

    func refreshStartPages() {
        guard let store else { return }
        for t in store.tabs where t.url == nil { if let web = views[t.id] { loadStartPage(web) } }
    }

    /// Réglages qui s'appliquent à toutes les pages ouvertes : zoom du texte, gestes de bord d'écran.
    func applySettings() {
        guard let s = store?.settings else { return }
        for web in views.values {
            let zoom = CGFloat(s.textZoom)
            if web.pageZoom != zoom { web.pageZoom = zoom }
            web.allowsBackForwardNavigationGestures = s.edgeSwipeNavigation
        }
    }

    func refreshDarken() {
        guard let store else { return }
        for (id, _) in views { if let tab = store.tabs.first(where: { $0.id == id }) { applyDarken(id, enabled: store.isDarkened(tab)) } }
    }

    /// Mode économie d'énergie : les onglets en arrière-plan libèrent leur page (rechargée à l'ouverture).
    func suspendBackgroundIfNeeded(keeping id: UUID) {
        guard store?.settings.suspendTabsInLowPower == true, ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
        for other in views.keys where other != id { discard(other) }
    }

    func findInPage(_ id: UUID) {
        webView(for: id).findInteraction?.presentFindNavigator(showingReplace: false)
    }

    func toggleReader(_ id: UUID) {
        let web = webView(for: id)
        if readerActive.contains(id) { web.goBack(); readerActive.remove(id); return }
        web.evaluateJavaScript(Scripts.reader) { [weak self] result, _ in
            guard let json = result as? String, let data = json.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return }
            let dark = UITraitCollection.current.userInterfaceStyle == .dark
            let html = Scripts.readerPage(title: obj["title"] ?? "", byline: obj["byline"] ?? "", html: obj["html"] ?? "", host: obj["host"] ?? "", dark: dark)
            web.loadHTMLString(html, baseURL: URL(string: obj["url"] ?? ""))
            Task { @MainActor in self?.readerActive.insert(id) }
        }
    }

    // MARK: Règles, mode sombre, user agent
    func applyRules() { views.values.forEach { applyRules(to: $0) } }
    /// Listes séparées (pubs, traqueurs, bandeaux de cookies) ; un site en exception n'a aucune règle.
    private func applyRules(to web: WKWebView, url: URL? = nil) {
        let c = web.configuration.userContentController
        c.removeAllContentRuleLists()
        guard let store, store.isBlockerActive(for: url ?? web.url) else { return }
        if store.settings.blockAds, let l = adsRules { c.add(l) }
        if store.settings.blockTrackers, let l = trackerRules { c.add(l) }
        if store.settings.blockCookieBanners, let l = cookieRules { c.add(l) }
    }

    func applyDarken(_ id: UUID, enabled: Bool) {
        webView(for: id).evaluateJavaScript(Scripts.darken(enabled))
    }

    /// User agent de la page ; le mode de contenu (mobile / bureau) se décide à chaque navigation dans `decidePolicyFor`,
    /// car la configuration d'une WKWebView existante n'est qu'une copie.
    func applyUserAgent(_ id: UUID) {
        guard let store, let tab = store.tabs.first(where: { $0.id == id }) else { return }
        let web = webView(for: id)
        if !store.settings.customUserAgent.isEmpty { web.customUserAgent = store.settings.customUserAgent; return }
        web.customUserAgent = store.isDesktop(tab) ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15" : nil
    }

    /// Icônes des onglets restaurés mais pas encore ouverts (pour la liste des onglets) ; celles déjà connues alimentent le cache par hôte.
    func prefetchFavicons() {
        guard let store else { return }
        for t in store.tabs { if let h = t.url?.host, let d = t.faviconData, faviconCache[h] == nil { faviconCache[h] = d } }
        for t in store.tabs where t.faviconData == nil && !t.isPrivate { if let h = t.url?.host { fetchFavicon("", host: h, id: t.id) } }
    }

    /// Icône d'un site (mémoire, puis disque) ; sinon téléchargée en arrière-plan et publiée dans `siteIcons`.
    func icon(for host: String?) -> UIImage? {
        guard let host, !host.isEmpty else { return nil }
        if let img = siteIcons.images[host] { return img }
        if let d = faviconCache[host] ?? (try? Data(contentsOf: Self.iconFile(host))), !d.isEmpty, let img = UIImage(data: d) {
            faviconCache[host] = d
            DispatchQueue.main.async { [weak self] in if self?.siteIcons.images[host] == nil { self?.siteIcons.images[host] = img } }
            return img
        }
        if faviconCache[host] == nil, faviconWaiting[host] == nil {
            faviconQueue.append((host: host, icon: ""))
            faviconWaiting[host] = []
            startNextFavicon()
        }
        return nil
    }

    /// Icône prête pour la page de démarrage : image réduite (96 px, adresse data:), couleur de fond assortie à ses bords
    /// (l'icône se fond dans sa tuile) et « remplit » si l'icône est assez grande pour couvrir toute la tuile.
    func startIcon(for host: String?) -> StartIcon? {
        guard let host else { return nil }
        if let c = startIcons[host] { return c }
        guard let img = icon(for: host), let tile = img.tileStyle() else { return nil }
        let data = img.resized(to: 96).pngData() ?? Data()
        let icon = StartIcon(dataURL: "data:image/png;base64," + data.base64EncodedString(), background: tile.hex, fill: tile.fill)
        startIcons[host] = icon
        return icon
    }
    private var startIcons: [String: StartIcon] = [:]

    func applyUserAgentToOpenTabs() { for id in views.keys { applyUserAgent(id) } }

    /// Vignette d'une page vivante, à la largeur demandée (en points) plutôt qu'à la résolution de l'écran.
    func snapshot(_ id: UUID, width: CGFloat? = nil, completion: @escaping (UIImage?) -> Void) {
        guard let web = views[id] else { completion(nil); return }
        let config = WKSnapshotConfiguration()
        config.afterScreenUpdates = false
        if let width { config.snapshotWidth = NSNumber(value: Double(width)) }
        web.takeSnapshot(with: config) { img, _ in completion(img) }
    }

    private func tabID(for web: WKWebView) -> UUID? { views.first { $0.value === web }?.key }
}

// MARK: - Délégués WebKit
extension TabManager: WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, preferences: WKWebpagePreferences, decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        let url = navigationAction.request.url
        preferences.allowsContentJavaScript = store?.isJavaScriptEnabled(for: url) ?? true
        if let store, let id = tabID(for: webView), let tab = store.tabs.first(where: { $0.id == id }) {
            preferences.preferredContentMode = store.isDesktop(tab) ? .desktop : .mobile
        }
        if navigationAction.targetFrame?.isMainFrame == true { applyRules(to: webView, url: url) }
        // Passage automatique en HTTPS
        if let store, store.settings.upgradeToHTTPS, let u = url, u.scheme == "http", navigationAction.targetFrame?.isMainFrame == true,
           var comps = URLComponents(url: u, resolvingAgainstBaseURL: false) {
            comps.scheme = "https"
            if let https = comps.url { webView.load(URLRequest(url: https)); decisionHandler(.cancel, preferences); return }
        }
        // Liens externes (tel:, mailto:, stores)
        if let u = url, let scheme = u.scheme, !["http", "https", "about", "file", "data", "blob"].contains(scheme) {
            UIApplication.shared.open(u); decisionHandler(.cancel, preferences); return
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let id = tabID(for: webView), let store else { return }
        if let tab = store.tabs.first(where: { $0.id == id }) {
            store.recordVisit(tab)
            if store.isDarkened(tab) { applyDarken(id, enabled: true) }
        }
    }

    /// Processus web tué par le système : la page visible est rechargée, une page d'arrière-plan est libérée (rechargée à l'ouverture).
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard let id = tabID(for: webView) else { return }
        readerActive.remove(id)
        guard store?.selectedTabID == id else { discard(id); return }
        if webView.url?.scheme?.hasPrefix("http") == true { webView.reload() } else { load(store?.tabs.first { $0.id == id }?.url, in: id) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError(webView, error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showError(webView, error) }
    private func showError(_ web: WKWebView, _ error: Error) {
        let e = error as NSError
        guard e.code != NSURLErrorCancelled, e.code != 102 else { return }
        web.loadHTMLString(StartPage.error(message: e.localizedDescription, url: e.userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? ""), baseURL: nil)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target=_blank : on ouvre un nouvel onglet dans Qafila.
        if let u = navigationAction.request.url { store?.newTab(url: u, isPrivate: store?.selectedTab?.isPrivate ?? false) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: webView.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        UIApplication.shared.topViewController?.present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: webView.url?.host, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: L("Annuler"), style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        UIApplication.shared.topViewController?.present(a, animated: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["type"] as? String == "pageInfo",
              let web = message.webView, let id = tabID(for: web) else { return }
        let minutes = body["minutes"] as? Int ?? 0
        let color = body["color"] as? String ?? ""
        let icon = body["icon"] as? String ?? ""
        let previous = store?.tabs.first(where: { $0.id == id })?.themeColorHex
        store?.update(id) { $0.readingMinutes = minutes; if !color.isEmpty { $0.themeColorHex = color } }
        if let store, store.selectedTabID == id, !color.isEmpty, store.siteThemeColor == nil || previous != color {
            store.siteThemeColor = Color(hex: color)
        }
        fetchFavicon(icon, host: web.url?.host, id: id)
    }

    func fetchFavicon(_ icon: String, host: String?, id: UUID) {
        guard let host else { return }
        if let data = faviconCache[host] { setFavicon(data, for: id); return }
        if faviconWaiting[host] == nil { faviconQueue.append((host: host, icon: icon)) }
        faviconWaiting[host, default: []].append(id)
        startNextFavicon()
    }

    private func setFavicon(_ data: Data, for id: UUID) {
        guard !data.isEmpty else { return }
        store?.update(id) { if $0.faviconData != data { $0.faviconData = data } }
    }

    private func startNextFavicon() {
        guard faviconActive < 3, !faviconQueue.isEmpty else { return }
        let (host, icon) = faviconQueue.removeFirst()
        faviconActive += 1
        let candidates = [icon, "https://\(host)/apple-touch-icon.png", "https://\(host)/favicon.ico"].filter { !$0.isEmpty }
        Task.detached {
            let found = await Self.downloadFavicon(candidates)
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.faviconCache[host] = found
                if !found.isEmpty, let img = UIImage(data: found) {
                    try? found.write(to: Self.iconFile(host), options: .atomic)
                    self.siteIcons.images[host] = img
                    self.refreshStartPagesSoon()
                }
                for id in self.faviconWaiting.removeValue(forKey: host) ?? [] { self.setFavicon(found, for: id) }
                self.faviconActive -= 1
                self.startNextFavicon()
            }
        }
    }

    /// Première image valide parmi les adresses candidates (Data vide si aucune).
    nonisolated private static func downloadFavicon(_ candidates: [String]) async -> Data {
        for c in candidates {
            guard let u = URL(string: c), let result = try? await URLSession.shared.data(from: u),
                  (result.1 as? HTTPURLResponse)?.statusCode == 200, result.0.count < 400_000, UIImage(data: result.0) != nil else { continue }
            return result.0
        }
        return Data()
    }
}

/// Évite le cycle de rétention WKUserContentController → handler.
@MainActor
final class LeakAvoider: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

extension Color {
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6 || s.count == 3, let v = UInt64(s.count == 3 ? s.map { "\($0)\($0)" }.joined() : s, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}
