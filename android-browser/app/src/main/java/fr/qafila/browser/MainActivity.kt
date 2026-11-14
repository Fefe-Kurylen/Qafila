package fr.qafila.browser

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import fr.qafila.browser.data.BrowserStore
import fr.qafila.browser.ui.BrowserScreen
import fr.qafila.browser.ui.QafilaTheme

class MainActivity : ComponentActivity() {
    private val store: BrowserStore by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Barres système transparentes : la barre Qafila (ou la couleur du site) se prolonge dessous.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
        // Relance depuis les applications récentes : l'intent d'origine (lien partagé) n'est pas rouvert.
        if (savedInstanceState == null && intent?.flags?.and(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) {
            intent?.getStringExtra("demo")?.let { store.applyDemo(it) } ?: store.handleIntent(intent)
        }
        setContent { QafilaTheme(store) { BrowserScreen(store) } }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); store.handleIntent(intent) }

    override fun onResume() { super.onResume(); store.support.refresh() }

    /** Application cachée : minuteurs JavaScript en pause (batterie) et état enregistré sans attendre. */
    override fun onStart() { super.onStart(); store.tabManager.resumeAll() }
    override fun onStop() { super.onStop(); store.tabManager.pauseAll(); store.flush() }

    /** Mémoire basse (pas le simple passage en arrière-plan) : les onglets non affichés sont mis en veille, vignette et historique conservés. */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW && level != TRIM_MEMORY_UI_HIDDEN) store.tabManager.suspendBackground()
    }
}
