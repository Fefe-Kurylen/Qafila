# 🧪 Tester Qafila gratuitement

Les versions de test sont refaites automatiquement à chaque modification et déposées dans la release
**« Version de test »** du dépôt : onglet **Releases** › **Version de test** (ou `…/releases/tag/test`).

| Fichier | Pour |
|---|---|
| `Qafila-Android-test.apk` | téléphone Android |
| `Qafila-iPhone-test.ipa` | iPhone (via Sideloadly) |

## 🤖 Android (2 minutes)

1. Sur le téléphone, ouvrir la release **Version de test** (connecté à GitHub si le dépôt est privé).
2. Toucher **Qafila-Android-test.apk** pour le télécharger, puis l'ouvrir.
3. Autoriser « Installer des applis inconnues » pour le navigateur quand Android le demande.
4. **Installer** → l'appli s'appelle **Qafila** (version de test, elle peut cohabiter avec la future version du Play Store).

## 🍏 iPhone (10 minutes, sans payer Apple)

Il faut un ordinateur (Windows ou Mac) et un câble.

1. Installer **Sideloadly** : <https://sideloadly.io> (gratuit). Sous Windows, installer aussi iTunes et iCloud *version site Apple* (pas Microsoft Store), comme indiqué sur le site.
2. Télécharger **Qafila-iPhone-test.ipa** sur l'ordinateur.
3. Brancher l'iPhone, le déverrouiller, répondre **Se fier à cet ordinateur**.
4. Glisser l'IPA dans Sideloadly, saisir son **identifiant Apple** (un compte gratuit suffit), cliquer **Start**.
5. Sur l'iPhone : **Réglages › Général › VPN et gestion de l'appareil** › toucher son identifiant › **Faire confiance**.
6. Si iOS le demande : **Réglages › Confidentialité et sécurité › Mode développeur** → activer, redémarrer.

ℹ️ Avec un identifiant gratuit, l'appli fonctionne **7 jours** ; il suffit de refaire l'étape 4 pour la prolonger.
Le compte Apple Developer (99 €/an) ne sert qu'à publier sur l'App Store / TestFlight.

## ✅ Quoi vérifier

**Navigation**
- [ ] Rechercher un mot, ouvrir une adresse, suggestions pendant la saisie
- [ ] Précédent / suivant, glisser depuis le bord (iPhone) ou sur l'adresse (Android)
- [ ] Nouvel onglet, onglet privé, fermer, liste et grille des onglets
- [ ] Favoris : ⋯ › Ajouter aux favoris, puis page d'accueil et liste des favoris
- [ ] Historique, partage, rechercher dans la page, lecteur, traduire

**Connexion Google**
- [ ] Se connecter sur gmail.com ou youtube.com, fermer l'appli, rouvrir : toujours connecté

**Apparence (Réglages)**
- [ ] Style de barre : Classique / Verre / **Flottante**
- [ ] Couleurs de barre clair et sombre, épaisseur des icônes, icône du menu
- [ ] Les 6 styles d'adresse, la galerie de barres, l'éditeur de boutons
- [ ] Icône de l'appli (Classique, Nuit, Encre, Désert)

**Confidentialité et lecture**
- [ ] Bloqueur (pubs, traqueurs, cookies) et « Désactiver le bloqueur ici »
- [ ] Assombrir les sites, taille du texte, version bureau

**À signaler en priorité (Android)** : le menu ⋯ et la barre « Flottante » doivent être **opaques**
(sur l'émulateur de GitHub, la page apparaissait légèrement à travers).

Un souci ? Noter l'écran, ce qui a été touché et ce qui s'est passé (une capture d'écran aide beaucoup).
