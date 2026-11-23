import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Signature de release : fichier keystore.properties (local) ou variables d'environnement (CI).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun signing(key: String): String? = keystoreProps.getProperty(key) ?: System.getenv(key)

// Soutien : lien Stripe lu dans la source unique ../shared/support.json (jamais codé en dur ici).
// Absent ou vide = « Bientôt disponible » dans l'appli ; l'URL est revalidée à l'exécution (https + hôte autorisé).
val supportJson: Map<*, *> = rootProject.file("../shared/support.json").let { f ->
    if (f.exists()) (JsonSlurper().parse(f) as? Map<*, *>).orEmpty() else emptyMap<Any, Any>()
}
val supportStripeUrl = (supportJson["stripePaymentLink"] as? String).orEmpty().trim()
val supportAllowedHosts = (supportJson["allowedHosts"] as? List<*>).orEmpty().mapNotNull { (it as? String)?.trim()?.lowercase() }.filter { it.isNotEmpty() }
/** Littéral Java échappé pour buildConfigField. */
fun javaLiteral(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "") + "\""
// Builds Google Play : abonnement natif tant que le programme d'offres externes de l'EEE n'est pas signé.
// Une fois inscrit : gradle bundleRelease -Pqafila.stripeInStores=true
val stripeInStores = (findProperty("qafila.stripeInStores") as? String)?.trim() == "true"
// Captures d'écran Google Play : elles sont prises sur l'APK debug, qui doit alors montrer le canal
// des stores (abonnement) et non Stripe : gradle assembleDebug -Pqafila.supportChannel=store
val debugSupportChannel = (findProperty("qafila.supportChannel") as? String)?.trim()

android {
    namespace = "fr.qafila.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "fr.qafila.browser"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
        vectorDrawables.useSupportLibrary = true
        // Langues livrées (les ressources d'autres langues venant des bibliothèques sont écartées).
        resourceConfigurations += listOf("fr", "en", "ar", "es", "de")
        buildConfigField("String", "SUPPORT_STRIPE_URL", javaLiteral(supportStripeUrl))
        buildConfigField("String", "SUPPORT_ALLOWED_HOSTS", javaLiteral(supportAllowedHosts.joinToString(",")))
    }

    signingConfigs {
        create("release") {
            val path = signing("KEYSTORE_FILE")
            if (path != null && file(path).exists()) {
                storeFile = file(path)
                storePassword = signing("KEYSTORE_PASSWORD")
                keyAlias = signing("KEY_ALIAS")
                keyPassword = signing("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signing("KEYSTORE_FILE") != null) signingConfig = signingConfigs.getByName("release")
            // Canal de soutien : Google Play (abonnement) sauf bascule explicite qafila.stripeInStores=true.
            buildConfigField("boolean", "SUPPORT_VIA_STRIPE", stripeInStores.toString())
        }
        debug {
            applicationIdSuffix = ".debug"
            // APK de test gratuit (hors Google Play) : soutien par le lien Stripe,
            // sauf -Pqafila.supportChannel=store (captures de la fiche Google Play).
            buildConfigField("boolean", "SUPPORT_VIA_STRIPE", (debugSupportChannel != "store").toString())
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.android.billingclient:billing-ktx:7.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
