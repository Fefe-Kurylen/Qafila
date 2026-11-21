import SwiftUI
import WebKit

/// Affiche la WKWebView de l'onglet sélectionné dans un conteneur UIKit (changement d'onglet sans rechargement).
/// Le défilement est suivi par observation (KVO) : le délégué de la vue de défilement reste celui de WebKit
/// (sinon le zoom à deux doigts, le double-toucher et certains défilements de pages se comportent mal).
struct WebContainer: UIViewRepresentable {
    @EnvironmentObject var store: BrowserStore
    let tabID: UUID
    var topInset: CGFloat
    var bottomInset: CGFloat
    var onScroll: (CGFloat) -> Void

    func makeUIView(context: Context) -> UIView { UIView() }

    func updateUIView(_ container: UIView, context: Context) {
        let web = store.tabManager.webView(for: tabID)
        if web.superview !== container {
            container.subviews.forEach { $0.removeFromSuperview() }
            web.frame = container.bounds
            web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            container.addSubview(web)
            context.coordinator.attach(web.scrollView)
        }
        let insets = UIEdgeInsets(top: topInset, left: 0, bottom: bottomInset, right: 0)
        if web.scrollView.contentInset != insets {
            web.scrollView.contentInset = insets
            web.scrollView.verticalScrollIndicatorInsets = insets
        }
        context.coordinator.onScroll = onScroll
    }

    static func dismantleUIView(_ container: UIView, coordinator: Coordinator) { coordinator.detach() }

    func makeCoordinator() -> Coordinator { Coordinator(onScroll: onScroll) }

    @MainActor
    final class Coordinator: NSObject {
        var onScroll: (CGFloat) -> Void
        private var last: CGFloat = 0
        private var offsetObserver: NSKeyValueObservation?
        private weak var pan: UIPanGestureRecognizer?

        init(onScroll: @escaping (CGFloat) -> Void) { self.onScroll = onScroll }

        func attach(_ scroll: UIScrollView) {
            detach()
            last = scroll.contentOffset.y + scroll.contentInset.top
            // Seuls les mouvements du doigt (et l'inertie qui suit) comptent : pas les sauts de page provoqués par le site.
            offsetObserver = scroll.observe(\.contentOffset, options: [.new]) { [weak self] s, _ in
                MainActor.assumeIsolated { self?.scrolled(s) }
            }
            scroll.panGestureRecognizer.addTarget(self, action: #selector(panned(_:)))
            pan = scroll.panGestureRecognizer
        }

        func detach() {
            offsetObserver?.invalidate(); offsetObserver = nil
            pan?.removeTarget(self, action: #selector(panned(_:)))
            pan = nil
        }

        private func scrolled(_ s: UIScrollView) {
            let y = s.contentOffset.y + s.contentInset.top
            let delta = y - last
            last = y
            guard s.isTracking || s.isDecelerating else { return }
            if y > 60 || delta < 0 { onScroll(delta) }
        }

        @objc private func panned(_ g: UIPanGestureRecognizer) {
            guard g.state == .ended, let s = g.view as? UIScrollView else { return }
            if s.contentOffset.y + s.contentInset.top < 60 { onScroll(-1000) }
        }
    }
}
