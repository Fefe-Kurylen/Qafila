package fr.qafila.browser.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.SystemClock
import android.webkit.WebView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * « Faux verre » de la barre : Compose ne peut pas flouter la WebView dessous, alors la zone de la page derrière la barre
 * est capturée dans une petite image (échelle 1/6), floutée (API 31+) et affichée sous la couleur translucide de la barre.
 * Capture au plus toutes les ~100 ms pendant le défilement, puis une dernière fois à l'arrêt. Jamais d'exception :
 * en cas d'échec (ou de page de démarrage Compose), la barre retombe sur sa couleur simple.
 */
class GlassBackdrop(private val scope: CoroutineScope) {
    /** Dernière capture (null : couleur simple). */
    var image by mutableStateOf<ImageBitmap?>(null)
        private set
    /** WebView affichée (null : page de démarrage ou aucun onglet). */
    var web: WebView? = null
    /** Zone de la barre dans la fenêtre (px). */
    var bounds: IntRect? = null
    /** Couleur de la page, sous les zones qu'elle ne peint pas. */
    var pageColor: Int = android.graphics.Color.WHITE
    /** Capture autorisée : verre activé, barre visible, onglet web affiché, application au premier plan. */
    var active: Boolean = false
        set(v) { field = v; if (v) refresh(60) else clear() }

    // Deux images réutilisées en alternance : jamais de dessin dans celle qui est en cours d'affichage.
    private val buffers = arrayOfNulls<Bitmap>(2)
    private var next = 0
    private var lastCapture = 0L
    private var pending: Job? = null

    /**
     * Défilement de la page : une capture toutes les 100 ms au plus, puis une dernière à l'arrêt.
     * Toujours différée (scope.launch) : WebView.draw() ne doit jamais être appelé depuis onScrollChanged, qui est
     * déclenché par Chromium pendant son propre dessin.
     */
    fun onScroll() {
        if (!active) return
        val now = SystemClock.uptimeMillis()
        if (now - lastCapture >= 100) { lastCapture = now; scope.launch { capture() } }
        refresh(150)
    }

    /** Capture différée (fin de chargement, changement d'onglet, déplacement de la barre). */
    fun refresh(delayMs: Long = 0) {
        pending?.cancel()
        if (!active) return
        pending = scope.launch { delay(delayMs); capture() }
    }

    /** Nouvelle zone de barre : capture si elle a changé (une seule, à la fin d'une animation). */
    fun place(r: IntRect) { if (r != bounds) { bounds = r; refresh(120) } }

    fun clear() { pending?.cancel(); image = null }

    private fun capture() {
        lastCapture = SystemClock.uptimeMillis()
        val w = web
        val b = bounds
        if (!active || w == null || b == null || !w.isAttachedToWindow || w.width == 0 || w.height == 0 || b.width <= 0 || b.height <= 0) { image = null; return }
        try {
            val loc = IntArray(2)
            w.getLocationInWindow(loc)
            val bw = (b.width * SCALE).roundToInt().coerceAtLeast(1)
            val bh = (b.height * SCALE).roundToInt().coerceAtLeast(1)
            val bmp = buffers[next]?.takeIf { it.width == bw && it.height == bh } ?: Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888).also { buffers[next] = it }
            next = 1 - next
            val c = Canvas(bmp)
            c.drawColor(pageColor)
            c.scale(SCALE, SCALE)
            // Le coin de la barre (coordonnées de la WebView, défilement compris) vient en (0, 0).
            c.translate(-(w.scrollX + b.left - loc[0]).toFloat(), -(w.scrollY + b.top - loc[1]).toFloat())
            w.draw(c)
            image = bmp.asImageBitmap()
        } catch (_: Throwable) {
            image = null
        }
    }

    private companion object { const val SCALE = 1f / 6f }
}

/**
 * Surface de verre : la capture floutée (si disponible), puis la couleur de la barre à l'opacité réglée (transparence [t]),
 * puis le liseré dégradé. Sans capture ou avant l'API 31, simple couleur translucide.
 */
@Composable
fun GlassSurface(
    colors: BarColors, t: Float, backdrop: ImageBitmap?, shape: Shape, modifier: Modifier = Modifier,
    elevation: Dp = 0.dp, rim: Boolean = true, content: @Composable BoxScope.() -> Unit,
) {
    val blurred = backdrop != null && canBlurGlass
    Box(
        modifier
            .then(if (elevation > 0.dp) Modifier.shadow(elevation, shape, ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.16f)) else Modifier)
            .clip(shape),
    ) {
        if (blurred && backdrop != null) {
            Image(
                backdrop, null, contentScale = ContentScale.FillBounds,
                modifier = Modifier.matchParentSize().graphicsLayer { if (Build.VERSION.SDK_INT >= 31) renderEffect = BlurEffect(24f, 24f, TileMode.Clamp) },
            )
        }
        Box(
            Modifier.matchParentSize().background(colors.bg.copy(alpha = glassAlpha(t, blurred)))
                .then(if (rim) Modifier.border(0.8.dp, Brush.verticalGradient(glassRim(colors)), shape) else Modifier),
        )
        content()
    }
}
