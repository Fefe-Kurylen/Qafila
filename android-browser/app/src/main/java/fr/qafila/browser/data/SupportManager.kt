package fr.qafila.browser.data

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import fr.qafila.browser.BuildConfig
import fr.qafila.browser.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/** Lien de paiement Stripe : validé à l'exécution, sinon considéré comme non configuré. */
object StripeLink {
    /** Renvoie le lien s'il est en https, sans port exotique ni identifiants, vers un hôte autorisé ; sinon null. */
    fun validated(raw: String, allowedHosts: Collection<String>): String? {
        val url = raw.trim()
        if (url.isEmpty()) return null
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return null
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.rawUserInfo != null) return null
        if (uri.port != -1 && uri.port != 443) return null
        val host = uri.host?.lowercase() ?: return null
        return url.takeIf { host in allowedHosts.map { it.trim().lowercase() } }
    }
}

/**
 * « Soutenir Qafila », deux canaux fixés à la compilation (BuildConfig.SUPPORT_VIA_STRIPE) :
 * - Google Play (bundle de release) : abonnement 0,99 €/mois, seul avantage l'icône exclusive « Or ».
 *   L'état vient des achats actifs renvoyés par Google Play ; il est mis en cache pour l'affichage hors ligne.
 *   Sans Play Store (émulateur, appareil sans services Google), rien ne plante : l'achat est simplement indisponible.
 * - Stripe (APK de test hors Google Play, ou stores après inscription) : contribution libre sur la page Stripe,
 *   ouverte dans le navigateur du système. Rien n'est débloqué (l'icône Or est offerte à tous) et Google Play
 *   Billing n'est jamais contacté.
 */
class SupportManager(private val app: Application, private val scope: CoroutineScope) : PurchasesUpdatedListener {
    companion object {
        const val PRODUCT_ID = "qafila_soutien_mensuel"
    }

    /** Soutien par le lien Stripe (true) ou par l'abonnement Google Play (false). */
    val viaStripe: Boolean = BuildConfig.SUPPORT_VIA_STRIPE
    /** Lien Stripe validé (null = pas encore configuré : bouton « Bientôt disponible »). */
    val stripeUrl: String? = if (viaStripe) StripeLink.validated(BuildConfig.SUPPORT_STRIPE_URL, BuildConfig.SUPPORT_ALLOWED_HOSTS.split(',')) else null

    private val prefs = app.getSharedPreferences("qafila_support", Context.MODE_PRIVATE)
    /** Abonnement Google Play actif (toujours false avec Stripe : aucun paiement externe n'est vérifié). */
    val isSupporter = MutableStateFlow(!viaStripe && prefs.getBoolean("supporter", false))
    /** Prix affiché par Google Play (null tant qu'il n'est pas connu : l'interface affiche R.string.support_fallback_price). */
    val price = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)
    val message = MutableStateFlow<String?>(null)
    /** Appelé quand le soutien prend fin (pour quitter l'icône Or). */
    var onSupportEnded: (() -> Unit)? = null

    private var details: ProductDetails? = null
    // Créé à la première utilisation seulement : jamais avec Stripe.
    private val client: BillingClient by lazy {
        BillingClient.newBuilder(app)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
    }

    init { if (!viaStripe) connect() }

    private fun connect() {
        if (viaStripe || client.isReady) return
        runCatching {
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) scope.launch { loadDetails(); refreshNow() }
                    else if (busy.value) message.value = app.getString(R.string.support_unavailable)
                }
                /** Google Play s'est déconnecté : nouvelle connexion au prochain besoin (refresh / achat). */
                override fun onBillingServiceDisconnected() = Unit
            })
        }
    }

    private suspend fun loadDetails() {
        val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(
            QueryProductDetailsParams.Product.newBuilder().setProductId(PRODUCT_ID).setProductType(BillingClient.ProductType.SUBS).build(),
        )).build()
        val res = runCatching { client.queryProductDetails(params) }.getOrNull() ?: return
        details = res.productDetailsList?.firstOrNull()
        price.value = details?.subscriptionOfferDetails?.firstOrNull()?.pricingPhases?.pricingPhaseList?.lastOrNull()?.formattedPrice
    }

    /** À chaque retour dans l'appli : l'abonnement est-il toujours actif ? */
    fun refresh() { if (viaStripe) return; if (client.isReady) scope.launch { refreshNow() } else connect() }

    private suspend fun refreshNow() {
        if (!client.isReady) return
        val res = runCatching {
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build())
        }.getOrNull() ?: return
        if (res.billingResult.responseCode != BillingClient.BillingResponseCode.OK) return
        val active = res.purchasesList.filter { PRODUCT_ID in it.products && it.purchaseState == Purchase.PurchaseState.PURCHASED }
        acknowledge(active)
        setSupporter(active.isNotEmpty())
    }

    private suspend fun acknowledge(purchases: List<Purchase>) {
        purchases.filter { !it.isAcknowledged }.forEach { p ->
            runCatching { client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) }
        }
    }

    private fun setSupporter(active: Boolean) {
        val was = isSupporter.value
        isSupporter.value = active
        prefs.edit().putBoolean("supporter", active).apply()
        if (was && !active) onSupportEnded?.invoke()
    }

    fun purchase(activity: Activity) {
        if (viaStripe || busy.value) return
        if (!client.isReady) { connect(); message.value = app.getString(R.string.support_unavailable); return }
        scope.launch {
            busy.value = true
            if (details == null) loadDetails()
            val d = details
            val offer = d?.subscriptionOfferDetails?.firstOrNull()
            if (d == null || offer == null) {
                message.value = app.getString(R.string.support_unavailable)
            } else {
                val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).setOfferToken(offer.offerToken).build(),
                )).build()
                val r = client.launchBillingFlow(activity, params)
                if (r.responseCode != BillingClient.BillingResponseCode.OK) message.value = app.getString(R.string.support_failed, r.debugMessage.ifBlank { app.getString(R.string.support_error_code, r.responseCode) })
            }
            busy.value = false
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> scope.launch {
                // L'achat renvoyé par Google Play fait foi tout de suite (une nouvelle interrogation peut encore l'ignorer).
                val list = purchases.orEmpty().filter { PRODUCT_ID in it.products }
                val active = list.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                when {
                    active.isNotEmpty() -> { acknowledge(active); setSupporter(true); message.value = app.getString(R.string.support_thanks) }
                    list.any { it.purchaseState == Purchase.PurchaseState.PENDING } -> message.value = app.getString(R.string.support_pending)
                    else -> { refreshNow(); if (isSupporter.value) message.value = app.getString(R.string.support_thanks) }
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> Unit
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> scope.launch { refreshNow(); message.value = app.getString(R.string.support_already) }
            else -> message.value = app.getString(R.string.support_failed, result.debugMessage.ifBlank { app.getString(R.string.support_error_code, result.responseCode) })
        }
    }

    fun restore() {
        if (viaStripe) return
        if (!client.isReady) { connect(); message.value = app.getString(R.string.support_play_unavailable); return }
        scope.launch {
            busy.value = true
            refreshNow()
            busy.value = false
            message.value = app.getString(if (isSupporter.value) R.string.support_restored else R.string.support_none_found)
        }
    }

    fun manage(context: Context) {
        val uri = Uri.parse("https://play.google.com/store/account/subscriptions?sku=$PRODUCT_ID&package=${app.packageName}")
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /**
     * Ouvre la page Stripe dans le navigateur du système (Google Pay, carte), jamais dans un onglet Qafila.
     * Qafila étant lui-même un navigateur, ses activités sont écartées s'il est choisi par défaut.
     */
    fun openStripe(context: Context) {
        val url = stripeUrl ?: return
        val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pm = context.packageManager
        fun isQafila(pkg: String) = pkg == context.packageName || pkg.startsWith("fr.qafila.browser")
        val handlers = runCatching { pm.queryIntentActivities(view, PackageManager.MATCH_DEFAULT_ONLY) }.getOrDefault(emptyList())
        val own = handlers.filter { isQafila(it.activityInfo.packageName) }.map { ComponentName(it.activityInfo.packageName, it.activityInfo.name) }
        val others = handlers.map { it.activityInfo.packageName }.filterNot(::isQafila).distinct()
        val default = runCatching { pm.resolveActivity(view, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName }.getOrNull()
        val launch = when {
            // Un autre navigateur est déjà le navigateur par défaut.
            default != null && default in others -> view
            others.size == 1 -> Intent(view).setPackage(others.first())
            own.isNotEmpty() -> Intent.createChooser(view, null)
                .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, own.toTypedArray()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            else -> view
        }
        if (runCatching { context.startActivity(launch) }.isFailure) message.value = app.getString(R.string.support_open_failed)
    }
}
