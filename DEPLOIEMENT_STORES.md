# 🚀 Publier Qafila Browser sur l'App Store et Google Play

Tout ce qui pouvait être préparé sans vos comptes l'a été : code iOS et Android, icônes, textes de fiche,
politique de confidentialité, chaînes de compilation et de publication automatiques. Il reste les étapes qui
exigent **vos** comptes développeur. Suivez les cases dans l'ordre.

## 0. Prérequis communs

- [ ] **Pages publiques** (assistance + confidentialité, exigées par les deux stores) : dépôt GitHub → *Settings* → *Pages* →
      *Source* : **GitHub Actions**. Le workflow *Qafila pages publiques* publie alors le dossier `site/` sur
      `https://fefe-kurylen.github.io/Qafila/` (assistance) et `…/confidentialite.html`. Ces adresses sont déjà dans les fiches.
      ⚠️ Gratuit seulement si le dépôt est **public** (Pages sur dépôt privé = offre GitHub payante).
- [x] Captures d'écran : **déjà prêtes**, générées par le workflow *Qafila captures stores* (vraie appli dans un simulateur iPhone 16 Pro Max
      et un émulateur Android) et rangées dans le dépôt :
      `ios-browser/fastlane/screenshots/fr-FR/` (6 × 1320×2868, format 6,9" — envoyées automatiquement par la lane `release`)
      et `android-browser/play/screenshots/phone/` (6 × 1080×1920, format 9:16 — à glisser dans la Play Console).
      Elles se régénèrent à chaque modification du code des applis (artefacts `store-screenshots-ios` / `-android`).

## 1. App Store (iOS)

### Comptes et identifiants
- [ ] Adhérer à l'**Apple Developer Program** (99 €/an) : https://developer.apple.com/programs/enroll/
- [ ] Dans App Store Connect → *Utilisateurs et accès* → *Intégrations* → *App Store Connect API* : créer une **clé API** avec le rôle **Admin**
      (indispensable : c'est ce qui permet à Apple de gérer le certificat de signature dans le cloud, **sans Mac**).
      Noter l'**Issuer ID**, le **Key ID** et télécharger le fichier `.p8`.
- [ ] Dans *Certificats, identifiants et profils* : créer l'**App ID** `fr.qafila.QafilaBrowser` (aucune capacité spéciale requise).
- [ ] Dans App Store Connect → *Mes apps* → **+** : créer l'app « Qafila : Navigateur Internet », bundle `fr.qafila.QafilaBrowser`, SKU `qafila-browser`.

### Abonnement « Soutenir Qafila » (0,99 €/mois, débloque l'icône Or)
- Concerne les builds App Store, TestFlight et Xcode, qui gardent cet abonnement. L'IPA de test (hors App Store) passe par le lien Stripe (voir § 4).
- [ ] App Store Connect → *Accords, taxes et services bancaires* : signer l'accord **Applications payantes**, ajouter compte bancaire et fiscalité.
- [ ] App → *Abonnements* → créer le groupe **Soutien Qafila**, puis l'abonnement :
      ID produit **`qafila_soutien_mensuel`**, durée **1 mois**, prix **0,99 €**, nom affiché « Soutenir Qafila »,
      description « Soutenez Qafila et débloquez l'icône Or ». Ajouter la capture `9-soutenir.png` comme capture de vérification.
- [ ] Le premier abonnement est soumis **avec** une version de l'app (cocher l'abonnement sur la page de la version avant l'envoi en validation).
- Test sans payer : lancé depuis Xcode, l'appli utilise `ios-browser/Qafila.storekit` (achat simulé) ; dans TestFlight, les achats sont gratuits (bac à sable).

### Secrets GitHub (Settings → Secrets and variables → Actions)
| Secret | Valeur |
|---|---|
| `APPLE_TEAM_ID` | Identifiant d'équipe (10 caractères, visible sur developer.apple.com/account) |
| `APP_STORE_CONNECT_KEY_ID` | Key ID de la clé API |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID |
| `APP_STORE_CONNECT_KEY_CONTENT` | Contenu du fichier `.p8`, **collé tel quel** (de `-----BEGIN PRIVATE KEY-----` à `-----END PRIVATE KEY-----`) |
| `IOS_CERT_P12_BASE64` / `IOS_CERT_PASSWORD` | *Facultatifs* : inutiles avec la signature gérée par Apple (clé Admin). |

### Lancer
- [ ] **Vérifier la compilation** : onglet *Actions* → *Qafila iOS* → *Run workflow* → lane `build`. Ce job tourne sur un Mac GitHub
      et compile réellement le projet contre le SDK iOS. S'il remonte des erreurs, collez-les moi, je corrige.
- [ ] **TestFlight** : *Run workflow* → lane `beta`. Le build apparaît dans App Store Connect → TestFlight en 10 à 30 min ; installez-le sur votre iPhone via l'app TestFlight.
- [ ] **App Store** : *Run workflow* → lane `release`. Les métadonnées FR/EN (`ios-browser/fastlane/metadata`) sont envoyées et l'app est soumise à la validation.
      Les captures de `fastlane/screenshots/fr-FR` sont envoyées en même temps.
- [ ] Questionnaire *Confidentialité de l'app* dans App Store Connect : répondre « **Aucune donnée collectée** » (conforme au `PrivacyInfo.xcprivacy`).
- [ ] Classification : 17+ n'est pas nécessaire ; cocher « Accès web sans restriction » (navigateur), ce qui donne **17+** automatiquement comme pour Quiche (16+ en France).

Sans Mac, tout passe par GitHub Actions. Avec un Mac : `cd ios-browser && brew install xcodegen && xcodegen generate && open QafilaBrowser.xcodeproj`, puis Product → Archive → Distribute.

## 2. Google Play (Android)

### Comptes et identifiants
- [ ] Créer un compte **Google Play Console** (25 $ une fois) : https://play.google.com/console/signup
- [ ] Créer l'application « Qafila : Navigateur Internet », type *Application*, gratuite, langue par défaut français.
- [ ] Générer le **keystore de signature** (une seule fois, à sauvegarder dans un gestionnaire de mots de passe, il est irremplaçable) :
      `cd android-browser && ./scripts-keystore.sh`
- [ ] Dans Play Console → *Configuration* → *Accès à l'API* : lier un projet Google Cloud, créer un **compte de service** avec le rôle
      *Administrateur de versions*, télécharger sa clé JSON, puis l'inviter dans *Utilisateurs et autorisations* de l'app.

### Abonnement « Soutenir Qafila »
- Concerne le bundle Google Play, qui garde cet abonnement. L'APK de test (hors Google Play) passe par le lien Stripe (voir § 4).
- [ ] Play Console → *Paramètres* → *Profil de paiement* : créer le profil marchand (compte bancaire).
- [ ] App → *Monétiser* → *Produits* → *Abonnements* : ID **`qafila_soutien_mensuel`**, une offre de base **mensuelle** à renouvellement
      automatique, prix **0,99 €**. (Nécessite d'avoir envoyé au moins une version contenant la bibliothèque de facturation.)
- [ ] *Paramètres* → *Test des licences* : ajouter votre adresse Gmail pour acheter en test sans être débité.

### Secrets GitHub
| Secret | Valeur |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 qafila-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Mot de passe du keystore |
| `ANDROID_KEY_ALIAS` | `qafila` |
| `ANDROID_KEY_PASSWORD` | Mot de passe de la clé (identique) |
| `PLAY_SERVICE_ACCOUNT_JSON` | Contenu complet du fichier JSON du compte de service |

### Lancer
- [ ] **Premier envoi manuel obligatoire** : Google exige que le tout premier bundle soit déposé à la main. Lancer *Qafila Android* → *Run workflow*
      → piste `internal`, récupérer l'artefact `qafila-release-aab` et le glisser dans Play Console → *Tests internes* → *Créer une version*.
      (Si l'envoi automatique échoue avec « applicationNotFound », c'est ce cas.) Les envois suivants sont automatiques.
- [ ] Remplir la fiche depuis `android-browser/play/listing/fr-FR.md` : titre, descriptions, icône 512 (`play/icon-512.png`),
      visuel de présentation (`play/feature-graphic-1024x500.png`), captures d'écran (`play/screenshots/phone/`).
- [ ] *Contenu de l'application* : politique de confidentialité (URL), **Sécurité des données** → « Aucune donnée collectée ni partagée »,
      questionnaire de classification (type *Autre* → navigateur avec accès web non contrôlé), publicités : non, application de navigation web : oui.
- [ ] Promouvoir de *Tests internes* vers *Production* une fois satisfait.

## Vérifié dans le dépôt

| Vérification | Résultat |
|---|---|
| Compilation iOS (Xcode, macOS GitHub) | ✅ |
| Lancement réel dans un simulateur iPhone 16 Pro Max | ✅ captures générées |
| Compilation Android debug + lint | ✅ |
| Bundle **release** Android minifié et signé (clé de test) | ✅ AAB 3,1 Mo, APK 1,3 Mo, API cible 35 |
| Lancement réel dans un émulateur Android 13 | ✅ captures générées |
| Envoi TestFlight / App Store / Google Play | ⏳ nécessite vos comptes et secrets |

## 3. Après publication

- [ ] Mettre à jour `release_notes.txt` (iOS) et `play/whatsnew/*` (Android) à chaque version, puis relancer les workflows.
- [ ] Les numéros de build sont automatiques (`github.run_number`) ; la version marketing est `1.0.<run>` côté Android et `MARKETING_VERSION` dans `project.yml` côté iOS.

## 4. Passer le soutien sur Stripe dans les Stores

Aujourd'hui, « Soutenir Qafila » passe par **Stripe** uniquement dans les versions de test (APK et IPA de la release *Version de test*) ;
App Store, TestFlight et Google Play gardent l'**abonnement 0,99 €/mois**. En France et dans l'EEE, un lien vers un paiement externe
dans une appli des stores n'est permis qu'après inscription aux programmes d'Apple et de Google : sans eux, la version risque d'être refusée
(Apple, règles 3.1.1 / 3.1.3) ou de valoir un avertissement Google Play.

**Le lien Stripe**, un seul endroit pour toutes les plateformes : `shared/support.json` → `"stripePaymentLink": "https://buy.stripe.com/…"`.
- Le créer dans Stripe → *Liens de paiement* (option « le client choisit le montant » pour une contribution libre). Apple Pay et Google Pay
  apparaissent sur la page Stripe s'ils sont activés dans *Paramètres › Moyens de paiement*.
- Seules les adresses `https` de `buy.stripe.com`, `donate.stripe.com` et `checkout.stripe.com` sont acceptées ; vide ou autre adresse = bouton « Bientôt disponible ».
- Une fois le lien collé, les versions de test se recompilent toutes seules ; pour les stores, il faut publier une nouvelle version.

**Apple (App Store, TestFlight)**
- [ ] Accepter dans App Store Connect les conditions de lien externe de l'UE (**DPLA, annexe 14**) et obtenir l'autorisation correspondante pour l'app.
- [ ] Commission Apple : **5 %** sur les ventes réalisées dans les **7 jours** qui suivent le toucher sur le lien.
- [ ] Déclarer ces ventes à Apple via les **API External Purchase**. ⚠️ Pas encore intégré dans l'appli : à ajouter avant de basculer.
- [ ] Puis, dans `ios-browser/project.yml`, passer `QAFILA_SUPPORT_CHANNEL: store` à **`stripe`** et relancer les lanes `beta` / `release`.

**Google (Google Play)**
- [ ] Compte Play Console au nom d'une **entreprise enregistrée**.
- [ ] S'inscrire au **programme d'offres externes de l'EEE** (Play Console), accepter ses **frais de service** et **déclarer les transactions** à Google.
      ⚠️ La déclaration n'est pas encore intégrée dans l'appli : à ajouter avant de basculer.
- [ ] Puis compiler avec `gradle bundleRelease -Pqafila.stripeInStores=true` (pour le workflow *Qafila Android* : ajouter
      `qafila.stripeInStores=true` dans `android-browser/gradle.properties`).

Après la bascule, l'appli ne propose plus l'abonnement : retirer `qafila_soutien_mensuel` de la vente dans App Store Connect et la Play Console.
