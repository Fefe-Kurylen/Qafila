package fr.qafila.browser.data

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
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
import fr.qafila.browser.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

/**
 * Abonnement « Soutenir Qafila » (0,99 €/mois, Google Play) : seul avantage, l'icône exclusive « Or ».
 * L'état vient des achats actifs renvoyés par Google Play ; il est mis en cache pour l'affichage hors ligne.
 * Sans Play Store (émulateur, appareil sans services Google), rien ne plante : l'achat est simplement indisponible.
 */
class SupportManager(private val app: Application, private val scope: CoroutineScope) : PurchasesUpdatedListener {
    companion object {
        const val PRODUCT_ID = "qafila_soutien_mensuel"
    }

    private val prefs = app.getSharedPreferences("qafila_support", Context.MODE_PRIVATE)
    val isSupporter = MutableStateFlow(prefs.getBoolean("supporter", false))
    /** Prix affiché par Google Play (null tant qu'il n'est pas connu : l'interface affiche R.string.support_fallback_price). */
    val price = MutableStateFlow<String?>(null)
    val busy = MutableStateFlow(false)
    val message = MutableStateFlow<String?>(null)
    /** Appelé quand le soutien prend fin (pour quitter l'icône Or). */
    var onSupportEnded: (() -> Unit)? = null

    private var details: ProductDetails? = null
    private val client: BillingClient = BillingClient.newBuilder(app)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .build()

    init { connect() }

    private fun connect() {
        if (client.isReady) return
        runCatching {
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (result.responseCode == BillingClient.BillingResponseCode.OK) scope.launch { loadDetails(); refreshNow() }
                }
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
    fun refresh() { if (client.isReady) scope.launch { refreshNow() } else connect() }

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
        if (busy.value) return
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
                client.launchBillingFlow(activity, params)
            }
            busy.value = false
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> scope.launch {
                val list = purchases.orEmpty()
                if (list.any { it.purchaseState == Purchase.PurchaseState.PENDING }) message.value = app.getString(R.string.support_pending)
                refreshNow()
                if (isSupporter.value) message.value = app.getString(R.string.support_thanks)
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> Unit
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> scope.launch { refreshNow(); message.value = app.getString(R.string.support_already) }
            else -> message.value = app.getString(R.string.support_failed, result.debugMessage.ifBlank { app.getString(R.string.support_error_code, result.responseCode) })
        }
    }

    fun restore() {
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
}
