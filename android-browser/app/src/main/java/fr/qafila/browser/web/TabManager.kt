package fr.qafila.browser.web

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import fr.qafila.browser.R
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.data.BrowserTab
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import java.io.ByteArrayInputStream

/** Une WebView par onglet, conservée en mémoire : changer d'onglet ne recharge rien (sauf onglet mis en veille). */
class TabManager(private val context: Context, private val store: BrowserStore, scope: CoroutineScope) {
    data class NavState(val canBack: Boolean = false, val canForward: Boolean = false, val loading: Boolean = false, val progress: Float = 0f)

    val navState = MutableStateFlow<Map<String, NavState>>(emptyMap())
    val favicons = Favicons(context, scope)
    /** Vignettes des onglets (grille), réduites, conservées même quand la WebView est mise en veille. */
    val snapshots = MutableStateFlow<Map<String, Bitmap>>(emptyMap())
    val readerActive = MutableStateFlow<Set<String>>(emptySet())
    private val views = HashMap<String, WebView>()
    /** Historique (précédent / suivant) des onglets mis en veille, restauré quand la WebView est recréée. */
    private val savedStates = HashMap<String, Bundle>()
    /** Ordre d'affichage des onglets (le dernier est l'onglet courant) : sert à mettre en veille les moins récents. */
    private val shownOrder = ArrayList<String>()
    /** Sites joints en http dans la session (https refusé ou renvoyant vers http) : plus de passage forcé en https. */
    private val httpOnlyHosts = HashSet<String>()
    private var selectedId: String? = null
    private var timersPaused = false

    private val isDark: Boolean get() = store.isAppDark()

    fun hasView(id: String) = views.containsKey(id)

    @SuppressLint("SetJavaScriptEnabled")
    fun webView(id: String, initialUrl: String? = null): WebView {
        views[id]?.let { return it }
        val tab = store.tabs.first { it.id == id }
        // Contexte modifiable : celui de l'Activity quand l'onglet est affiché (menus <select>, boîtes de dialogue JavaScript).
        val web = WebView(MutableContextWrapper(context))
        web.layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = if (tab.isPrivate) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
            if (Build.VERSION.SDK_INT >= 33) isAlgorithmicDarkeningAllowed = false
        }
        if (tab.isPrivate) CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        val client = Client(id).also { it.pageHost = store.hostOf(tab.url) }
        web.addJavascriptInterface(Bridge(id, web), "Qafila")
        web.webViewClient = client
        web.webChromeClient = Chrome(id)
        web.setBackgroundColor(if (isDark) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
        views[id] = web
        val url = initialUrl ?: tab.url
        applySettings(id, url)
        // Onglet sorti de veille : son historique est restauré (puis la nouvelle adresse, s'il y en a une, s'y ajoute).
        val restored = savedStates.remove(id)?.let { web.restoreState(it) } != null
        if (initialUrl != null || !restored) url?.let { web.loadUrl(it) }
        if (!timersPaused) web.resumeTimers()
        evictIfNeeded(keep = id)
        return web
    }

    /** Ferme définitivement l'onglet. */
    fun discard(id: String) {
        views.remove(id)?.apply { (parent as? android.view.ViewGroup)?.removeView(this); destroy() }
        savedStates.remove(id); shownOrder.remove(id)
        navState.update { it - id }; snapshots.update { it - id }; readerActive.update { it - id }
    }

    /** Met l'onglet en veille : la WebView est détruite, l'onglet (adresse, titre, vignette, historique) est conservé et rechargé à la demande. */
    fun suspend(id: String) {
        views.remove(id)?.apply {
            Bundle().let { b -> if (saveState(b) != null) savedStates[id] = b }
            (parent as? android.view.ViewGroup)?.removeView(this); destroy()
        }
        navState.update { it - id }; readerActive.update { it - id }
    }

    /** Mémoire basse (onTrimMemory) : tous les onglets en arrière-plan sont mis en veille. */
    fun suspendBackground() {
        views.keys.filter { it != selectedId }.forEach { captureSnapshot(it); suspend(it) }
    }

    /** Au-delà de [MAX_LIVE] WebView vivantes, les onglets affichés le moins récemment sont mis en veille. */
    private fun evictIfNeeded(keep: String) {
        if (views.size <= MAX_LIVE) return
        val candidates = views.keys.filter { it != selectedId && it != keep }.sortedBy { shownOrder.indexOf(it) }
        candidates.take(views.size - MAX_LIVE).forEach { captureSnapshot(it); suspend(it) }
    }

    /** Onglet affiché : les autres WebView sont mises en pause (animations, géolocalisation…). */
    fun onSelected(id: String) {
        selectedId = id
        shownOrder.remove(id); shownOrder.add(id)
        views.forEach { (k, v) -> if (k == id) v.onResume() else v.onPause() }
    }

    /** Vue attachée à l'écran : contexte de l'Activity pour l'onglet affiché, contexte de l'application pour les autres (aucune fuite d'Activity). */
    fun attach(id: String, activity: Context) {
        views.forEach { (k, v) -> (v.context as? MutableContextWrapper)?.baseContext = if (k == id) activity else context }
    }

    /** Application en arrière-plan : minuteurs JavaScript suspendus (batterie). */
    fun pauseAll() { timersPaused = true; views.values.forEach { it.onPause() }; views.values.firstOrNull()?.pauseTimers() }
    fun resumeAll() { timersPaused = false; views.values.firstOrNull()?.resumeTimers(); selectedId?.let { views[it]?.onResume() } }

    fun load(url: String?, id: String) {
        if (url == null) return
        val existed = views.containsKey(id)
        val w = webView(id, initialUrl = url)
        readerActive.update { it - id }
        if (existed) { applySettings(id, url); w.loadUrl(url) }
    }
    fun goBack(id: String) = views[id]?.let { if (it.canGoBack()) it.goBack() }
    fun goForward(id: String) = views[id]?.let { if (it.canGoForward()) it.goForward() }
    fun reload(id: String) = views[id]?.reload()
    fun stop(id: String) = views[id]?.stopLoading()
    fun js(id: String, script: String) = views[id]?.evaluateJavascript(script, null)
    fun find(id: String, text: String) = views[id]?.findAllAsync(text)
    fun findNext(id: String, forward: Boolean) = views[id]?.findNext(forward)
    fun clearFind(id: String) = views[id]?.clearMatches()
    fun clearCaches() { views.values.firstOrNull()?.clearCache(true) ?: WebView(context).apply { clearCache(true); destroy() } }

    /**
     * User agent de Chrome mobile, sans la marque « ; wv » des WebView : sans ça, Google refuse la connexion
     * (« Ce navigateur ou cette application ne sont peut-être pas sécurisés »).
     */
    private val mobileUserAgent: String by lazy {
        android.webkit.WebSettings.getDefaultUserAgent(context).replace("; wv)", ")").replace(Regex("Version/\\d+(\\.\\d+)* "), "")
    }

    private fun userAgentFor(tab: BrowserTab, url: String?): String {
        val s = store.settings
        return when {
            s.customUserAgent.isNotBlank() -> s.customUserAgent
            store.isDesktop(tab.copy(url = url)) -> DESKTOP_UA
            else -> mobileUserAgent
        }
    }

    /** Applique les réglages (JavaScript, user agent, zoom) pour l'adresse [url] — par défaut celle de l'onglet. */
    fun applySettings(id: String, url: String? = null) {
        val web = views[id] ?: return
        val tab = store.tabs.firstOrNull { it.id == id } ?: return
        val target = url ?: tab.url
        web.settings.javaScriptEnabled = store.isJavaScriptEnabled(target)
        web.settings.userAgentString = userAgentFor(tab, target)
        web.settings.textZoom = store.settings.textZoom.coerceIn(50, 200)
    }
    fun applySettingsToAll() = views.keys.toList().forEach { applySettings(it) }

    fun applyDarken(id: String, on: Boolean) = js(id, Scripts.injectCss("qafila-darken", Scripts.darkenCss, on))
    fun refreshDarken() = store.tabs.forEach { t -> if (views.containsKey(t.id)) applyDarken(t.id, store.isDarkened(t)) }

    fun toggleReader(id: String) {
        val web = views[id] ?: return
        if (id in readerActive.value) { (web.webViewClient as? Client)?.readerUrl = null; web.goBack(); readerActive.update { it - id }; return }
        web.evaluateJavascript(Scripts.reader, null)
    }

    /** Capture une vignette réduite de l'onglet (pour la grille). */
    fun captureSnapshot(id: String) {
        val w = views[id] ?: return
        if (w.width == 0 || w.height == 0 || w.parent == null) return
        runCatching {
            val scale = 0.4f
            val b = Bitmap.createBitmap((w.width * scale).toInt().coerceAtLeast(1), (w.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.RGB_565)
            val c = Canvas(b); c.scale(scale, scale); c.translate(-w.scrollX.toFloat(), -w.scrollY.toFloat()); w.draw(c)
            snapshots.update { it + (id to b) }
        }
    }

    fun destroyAll() { views.values.forEach { it.destroy() }; views.clear(); savedStates.clear(); shownOrder.clear() }

    private fun parseCssColor(c: String): String? = runCatching {
        val n = Regex("[0-9]+(\\.[0-9]+)?").findAll(c).map { it.value.toFloat() }.toList()
        if (n.size < 3) return null
        if (n.size >= 4 && n[3] < 0.5f) return null
        String.format(java.util.Locale.ROOT, "#%02X%02X%02X", n[0].toInt().coerceIn(0, 255), n[1].toInt().coerceIn(0, 255), n[2].toInt().coerceIn(0, 255))
    }.getOrNull()

    private fun escapeHtml(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    // ----- Pont JavaScript → app -----
    /**
     * Appelé depuis le fil JavaScript, par n'importe quel cadre de la page. Chaque message porte l'adresse de son cadre :
     * seuls ceux du cadre principal (adresse égale à celle de la WebView, lue sur le fil principal) sont pris en compte.
     */
    private inner class Bridge(val id: String, val web: WebView) {
        private fun onMainFrame(url: String?, block: () -> Unit) {
            if (url == null) return
            web.post { if (views[id] === web && web.url == url) block() }
        }

        @JavascriptInterface fun pageInfo(minutes: Int, color: String?, url: String?) {
            val hex = parseCssColor(color ?: "")
            val m = minutes.coerceIn(0, 100_000)
            onMainFrame(url) { store.updateTab(id) { it.copy(readingMinutes = m, themeColor = hex) } }
        }
        @JavascriptInterface fun reader(title: String?, byline: String?, html: String?, host: String?, url: String?) {
            if (html == null) return
            onMainFrame(url) {
                // Le texte vient du cadre principal lui-même : il est rechargé sous sa propre origine, jamais une autre.
                (web.webViewClient as? Client)?.readerUrl = url
                web.loadDataWithBaseURL(url, Scripts.readerPage(escapeHtml(title ?: ""), escapeHtml(byline ?: ""), html, escapeHtml(host ?: ""), isDark), "text/html", "utf-8", url)
                readerActive.update { it + id }
            }
        }
    }

    private fun injectPageCss(view: WebView, host: String?) {
        val s = store.settings
        val active = store.isBlockerActive(host)
        view.evaluateJavascript(Scripts.injectCss("qafila-cookies", ContentBlocker.cookieCss, active && s.blockCookieBanners), null)
        view.evaluateJavascript(Scripts.injectCss("qafila-ads", ContentBlocker.adCss, active && s.blockAds), null)
    }

    // ----- Clients WebView -----
    private inner class Client(val id: String) : WebViewClient() {
        /** Hôte de la page principale (lu depuis le fil réseau pour les exceptions du bloqueur). */
        @Volatile var pageHost: String? = null
        /** Adresse http d'origine quand la navigation a été forcée en https (retour en http si https échoue). */
        private var upgradedFrom: String? = null
        /** Adresse de la page affichée en mode lecture (son chargement ne quitte pas le mode lecture). */
        var readerUrl: String? = null

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            val scheme = url.scheme ?: return false
            if (scheme !in listOf("http", "https", "about", "file", "data", "blob")) {
                runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, url).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
            if (!request.isForMainFrame) return false
            val target = url.toString()
            pageHost = url.host
            // Réglages par site (JavaScript, site pour ordinateur) pour la page de destination, avant son chargement.
            val ua = store.tabs.firstOrNull { it.id == id }?.let { userAgentFor(it, target) }
            view.settings.javaScriptEnabled = store.isJavaScriptEnabled(target)
            val uaChanged = ua != null && view.settings.userAgentString != ua
            if (uaChanged) view.settings.userAgentString = ua
            if (scheme == "http" && store.settings.upgradeToHttps) {
                val host = url.host?.lowercase()
                val backFromHttps = upgradedFrom != null && (request.isRedirect || target == upgradedFrom)
                if (backFromHttps || host in httpOnlyHosts) {
                    // https a renvoyé vers http (ou a déjà échoué pour ce site) : on reste en http, sans boucler.
                    host?.let { httpOnlyHosts.add(it) }; upgradedFrom = null
                } else {
                    upgradedFrom = target
                    view.loadUrl(url.buildUpon().scheme("https").build().toString()); return true
                }
            } else if (scheme == "https" && upgradedFrom != null && target != upgradedFrom.orEmpty().replaceFirst("http://", "https://")) upgradedFrom = null
            // Un nouvel user agent relance la navigation (la requête en cours partait avec l'ancien).
            if (uaChanged) { view.loadUrl(target); return true }
            return false
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (request.isForMainFrame) { pageHost = request.url.host; return null }
            val s = store.settings
            if (!store.isBlockerActive(pageHost)) return null
            if (ContentBlocker.isBlocked(request.url.host, s.blockAds, s.blockTrackers, s.blockCookieBanners)) {
                return WebResourceResponse("text/plain", "utf-8", 204, "Blocked by Qafila", emptyMap(), ByteArrayInputStream(ByteArray(0)))
            }
            return null
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            navState.update { it + (id to (it[id] ?: NavState()).copy(loading = true, progress = 0.05f, canBack = view.canGoBack(), canForward = view.canGoForward())) }
            if (url != null && url.startsWith("http")) {
                pageHost = android.net.Uri.parse(url).host
                view.settings.javaScriptEnabled = store.isJavaScriptEnabled(url)
                store.updateTab(id) {
                    val sameHost = store.hostOf(it.url) == store.hostOf(url)
                    it.copy(url = url, lastVisited = System.currentTimeMillis(), readingMinutes = if (url == it.url) it.readingMinutes else 0, themeColor = if (sameHost) it.themeColor else null)
                }
            }
            injectPageCss(view, pageHost)
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (url != null && url.startsWith("https://") && url == upgradedFrom?.replaceFirst("http://", "https://")) upgradedFrom = null
            navState.update { it + (id to (it[id] ?: NavState()).copy(loading = false, progress = 1f, canBack = view.canGoBack(), canForward = view.canGoForward())) }
            store.updateTab(id) { it.copy(title = view.title?.takeUnless { t -> t.startsWith("http") || t.startsWith("about:") } ?: it.title) }
            view.evaluateJavascript(Scripts.pageInfo, null)
            injectPageCss(view, pageHost)
            store.tabs.firstOrNull { it.id == id }?.let { tab ->
                store.recordVisit(tab)
                if (store.isDarkened(tab)) applyDarken(id, true)
                favicons.request(tab.url, persist = !tab.isPrivate)
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (url != null && url.startsWith("http")) store.updateTab(id) { it.copy(url = url) }
            navState.update { it + (id to (it[id] ?: NavState()).copy(canBack = view.canGoBack(), canForward = view.canGoForward())) }
            // Le chargement de la page « lecture » elle-même conserve le mode lecture ; toute autre navigation le quitte.
            if (!isReload && url != readerUrl) { readerUrl = null; readerActive.update { it - id } }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            val original = upgradedFrom
            if (original != null && request.url.toString() == original.replaceFirst("http://", "https://")) {
                // Le site n'existe pas en https : retour à l'adresse http d'origine.
                upgradedFrom = null; request.url.host?.lowercase()?.let { httpOnlyHosts.add(it) }
                view.loadUrl(original); return
            }
            val res = context.resources
            val page = Scripts.errorPage(res.getString(R.string.error_page_title), error.description.toString(), request.url.toString(),
                res.configuration.locales[0].language, res.configuration.layoutDirection == android.view.View.LAYOUT_DIRECTION_RTL)
            view.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
        }
    }

    private inner class Chrome(val id: String) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) { navState.update { it + (id to (it[id] ?: NavState()).copy(progress = newProgress / 100f, loading = newProgress < 100)) } }
        override fun onReceivedTitle(view: WebView, title: String?) {
            if (title.isNullOrBlank() || title.startsWith("http") || title.startsWith("about:")) return
            store.updateTab(id) { it.copy(title = title) }
        }
        override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
            val tab = store.tabs.firstOrNull { it.id == id } ?: return
            if (icon != null) favicons.put(view.url ?: tab.url, icon, persist = !tab.isPrivate)
        }
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean {
            // target=_blank : on récupère l'URL via une WebView temporaire puis on ouvre un nouvel onglet.
            val temp = WebView(view.context)
            temp.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean { store.newTab(url = r.url.toString(), isPrivate = store.selectedTab?.isPrivate ?: false); temp.destroy(); return true }
            }
            (resultMsg?.obj as? WebView.WebViewTransport)?.webView = temp
            resultMsg?.sendToTarget()
            return true
        }
    }

    companion object {
        const val DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
        /** Nombre maximal de WebView gardées vivantes en même temps. */
        const val MAX_LIVE = 8
    }
}
