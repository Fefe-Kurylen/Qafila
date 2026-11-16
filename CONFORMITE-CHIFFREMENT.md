# Conformité « chiffrement » — guide pas à pas pour le propriétaire

Ce guide répond à la décision 7 du §1 de `COFFRE-SYNC.md` et à son risque 7 (§11) : **quelles formalités la
phase 1 (coffre chiffré) déclenche**, chez Apple, en France (ANSSI) et chez Google, et **quelles lignes du dépôt
changer le jour où elle sort**. Rien n'est à faire aujourd'hui : l'application actuelle n'utilise que le HTTPS du
système et elle est correctement déclarée comme exemptée.

Chaque affirmation est marquée :

- ✅ **certain** — lu sur la page officielle le 16 novembre 2026 (source citée au §7) ou dans le code du dépôt ;
- 🔍 **à confirmer** — plausible, cohérent avec les sources, mais la page officielle ne le dit pas mot pour mot,
  ou la situation peut avoir changé : vérifiez au moment de la soumission ;
- 💡 **recommandation** — un choix proposé, pas une obligation.

Ce guide n'est pas un avis juridique. Il vous donne le vocabulaire, les liens et l'ordre des opérations pour
que la vérification sur les sites officiels vous prenne une heure plutôt qu'une semaine.

---

## 1. Où nous en sommes, et ce que la phase 1 change

### Aujourd'hui (navigateur seul)

| Élément | État | Verdict |
|---|---|---|
| `ios-browser/project.yml`, ligne 47 : `ITSAppUsesNonExemptEncryption: false` | l'appli n'utilise que `URLSession` / WebKit (HTTPS du système) | ✅ correct : usage exempté, pas de question à chaque envoi |
| `ios-browser/fastlane/Fastfile`, ligne 69 : `export_compliance_uses_encryption: false` | cohérent avec la ligne précédente | ✅ correct |
| Android : aucune déclaration de chiffrement n'existe chez Google | HTTPS du système | ✅ rien à faire |
| France : HTTPS fourni par iOS / Android, pas par Qafila | le « moyen de cryptologie » est le système d'exploitation, pas l'appli | 🔍 aucune formalité à votre charge (voir §3.1) |

### Après la phase 1 (coffre), inventaire exact des primitives (`shared/CRYPTO.md` §1)

| Primitive | iOS | Android | PC | Nature |
|---|---|---|---|---|
| AES-256-GCM, HKDF-SHA256, HMAC-SHA256, SHA-256 | **CryptoKit** (système) | `javax.crypto` (système) | Node `crypto` | standard (NIST, RFC 5869, FIPS 180-4) |
| X25519 (phase 2, appairage) | **CryptoKit** (système) | Bouncy Castle (tiers) | Node `crypto` | standard (RFC 7748) |
| **Argon2id** (mot de passe principal) | **swift-sodium / libsodium** (tiers, pas dans le système) | Bouncy Castle (tiers) | `hash-wasm` (tiers) | standard (**RFC 9106**, IETF) |
| Aucune primitive maison, aucun algorithme propriétaire | | | | ✅ |

Conséquence, certaine : Qafila **utilise du chiffrement non exempté** (il protège les données de l'utilisateur,
il ne se limite pas à HTTPS ni à l'authentification) **avec des algorithmes standards** (tous publiés par des
organismes reconnus : IETF, NIST). C'est la case « algorithmes standards, en plus de ceux du système » du
questionnaire d'Apple, jamais la case « propriétaire ». Sur iOS, **c'est le seul Argon2id de libsodium qui fait
sortir Qafila de « chiffrement limité à celui du système d'exploitation »** : CryptoKit n'implémente pas Argon2id,
et le contrat impose Argon2id (`COFFRE-SYNC.md` §3.1). Il n'y a pas d'échappatoire propre : on déclare.

---

## 2. Apple — export compliance (App Store Connect)

### 2.1 Pourquoi la loi américaine s'applique à un développeur français ✅

Apple l'écrit noir sur blanc : « When you submit your app to TestFlight or the App Store, you upload your app
to a server in the United States. If you distribute your app outside the U.S. or Canada, your app is subject to
U.S. export laws, regardless of where your legal entity is based. » Et : « as well as the import compliance
requirements of the countries where you distribute your app » — d'où la question française (§3).

### 2.2 Les deux clés `Info.plist` ✅

| Clé | Rôle | Qafila |
|---|---|---|
| `ITSAppUsesNonExemptEncryption` | `false` : l'appli n'utilise pas de chiffrement, ou seulement du chiffrement exempté (ex. HTTPS via `URLSession`) → App Store Connect ne pose aucune question. `true` : l'appli utilise du chiffrement non exempté → les questions sont posées à **chaque** build (TestFlight compris, état « Missing Compliance ») tant que la seconde clé n'est pas renseignée. | `false` aujourd'hui → **`true` en phase 1** |
| `ITSEncryptionExportComplianceCode` | Le code qu'Apple vous remet **après avoir examiné vos documents** (« After successfully reviewing the documents, Apple provides you with a code. ») ; une fois posé, plus aucune question à l'envoi. | absente → à poser dès réception du code |

Apple annonce « approximately two business days » pour examiner un dossier complet, à condition d'avoir rempli la
description de l'appli et sa disponibilité par pays **avant** d'envoyer le document.

### 2.3 Le questionnaire et les réponses de Qafila

Les questions sont posées dans *App Information › App Encryption Documentation (+)* ou depuis le bouton *Manage*
d'un build. Leur formulation exacte change avec les refontes d'App Store Connect (🔍 : je n'ai pas pu lire les
libellés actuels, les pages d'aide ne les reproduisent pas), mais la logique documentée est stable :

| Question (sens) | Réponse Qafila phase 1 | Pourquoi |
|---|---|---|
| L'appli utilise-t-elle, contient-elle ou intègre-t-elle du chiffrement ? | **Oui** | AES-GCM, Argon2id… |
| Se limite-t-elle au chiffrement du système d'exploitation (ou à une exemption : HTTPS seul, authentification seule, médical, bancaire…) ? | **Non** | Argon2id vient de libsodium ; le coffre protège des données, pas seulement une authentification |
| Utilise-t-elle des algorithmes **propriétaires ou non standards** ? | **Non** | tout est RFC / NIST (voir §1) |
| Utilise-t-elle des algorithmes standards **à la place de, ou en plus de** ceux du système ? | **Oui** | libsodium (iOS) |
| L'appli sera-t-elle disponible sur l'App Store **en France** ? | **Oui** | d'où le document du §3 |

Ce que cela déclenche, d'après la page de référence d'Apple « Export compliance documentation for encryption »
(✅ lue le 16 novembre 2026) :

| Cas | Document demandé par Apple |
|---|---|
| chiffrement limité à celui du système Apple | aucun |
| **algorithme standard non fourni par le système Apple** | **« Upload your French encryption declaration in App Store Connect »** — note de bas de page : « French encryption declaration form is only required if you're distributing your app on the App Store in France » |
| algorithme propriétaire | CCATS américain **et** déclaration française |

Donc, pour Qafila : **pas de CCATS, pas d'ERN** (le registre ERN a d'ailleurs été supprimé par les États-Unis
en 2021 🔍) ; **un seul document : l'attestation / le récépissé de déclaration de l'ANSSI** (§3). Sans lui, deux
issues seulement : l'appli n'est pas disponible en France, ou Apple bloque la soumission — ni l'une ni l'autre
n'est acceptable pour un produit français.

### 2.4 Le rapport annuel d'auto-classification américain (BIS) — ce qui est certain et ce qui ne l'est pas

- ✅ Apple écrit : « If your app uses exempt forms of encryption, you might alternatively be required to submit
  a year-end self-classification report to the U.S. government. **(If you use non-exempt encryption and provide
  documentation to Apple, the self-classification report isn't necessary.)** » Qafila fournit un document
  (la déclaration française) : selon Apple, pas de rapport annuel.
- ✅ Le BIS (bis.gov, page « Annual Self-Classification ») : le rapport concerne les articles exportés sous
  l'exception de licence ENC § 740.17(b)(1), est dû au **1ᵉʳ février** pour l'année civile écoulée, **en CSV
  uniquement**, au format du *Supplement No. 8 to Part 742* ; un article déjà classé par le BIS (CCATS) n'y figure
  pas ; aucun rapport si rien n'a été exporté.
- 🔍 Les sources secondaires divergent sur l'obligation pour les logiciels « grand public » (mass market,
  § 740.17(b)(1) / § 742.15(b)(1)) : certaines disent « exemptés du rapport », d'autres non. Et l'exportateur au
  sens américain est Apple (ou Google), pas vous — mais Apple vous fait porter la responsabilité (« it's your
  responsibility to review the Export Administration Regulation… you're responsible for all liabilities »).
- 💡 Suivez la phrase d'Apple (document fourni ⇒ pas de rapport) et notez-le dans votre dossier ; si vous voulez
  être irréprochable, un rapport CSV d'une ligne envoyé au BIS avant le 1ᵉʳ février suivant la sortie coûte dix
  minutes et ne peut pas nuire. Vérifiez l'adresse d'envoi sur la page du BIS (elle est masquée contre les robots).

### 2.5 TestFlight et la CI

- ✅ Avec `ITSAppUsesNonExemptEncryption: true` et sans code, chaque build TestFlight reste en « Missing
  Compliance » jusqu'à ce que vous répondiez dans App Store Connect (une fois par build). Le code de conformité
  supprime l'étape.
- ✅ `upload_to_testflight` (fastlane `pilot`) accepte une option `uses_non_exempt_encryption` (défaut `false`),
  « used if there is 'ITSAppUsesNonExemptEncryption' is not set in the Info.plist ». Comme nous posons la clé via
  `project.yml`, elle est inutile.
- ✅ L'`Info.plist` est généré par XcodeGen depuis `project.yml` : **c'est le seul endroit à modifier** (§5).

### 2.6 Au passage : l'étiquette « Confidentialité de l'app »

- Phase 1 : tout reste sur l'appareil → « **Données non collectées** » reste vrai ✅.
- Phase 2 (relais) : le relais ne reçoit que des blocs chiffrés qu'il ne peut pas lire, sans compte ni e-mail.
  Il journalise l'adresse IP 24 h pour les limites anti-abus (`COFFRE-SYNC.md` §5.1). 🔍 La définition d'Apple
  (« transmitting data off the device in a way that allows you… to access it for a period longer than what is
  necessary to service the transmitted request in real time ») laisse une zone grise pour ce journal de 24 h :
  posez la question à Apple (App Review contact) ou déclarez-le prudemment. Les blocs chiffrés, eux, ne sont
  lisibles par personne : ils ne sont pas une « collecte » au sens de l'étiquette (même logique que Google, §4.2).
- Formulation des fiches : la phrase du §2 de `COFFRE-SYNC.md` (« Garanties annoncées »), sans « inviolable » ni
  « militaire » ; et pas de « sécurisé » avant la relecture externe (décision 6).

---

## 3. France — la formalité ANSSI

### 3.1 Quel régime s'applique, précisément

Base légale : **article 30 de la loi n° 2004-575 du 21 juin 2004** (LCEN) et **décret n° 2007-663 du 2 mai 2007**
(✅ texte lu sur Légifrance le 16 novembre 2026 ; 🔍 vérifiez que vous lisez la version consolidée en vigueur) :

| Opération | Régime | Pour Qafila |
|---|---|---|
| **Utilisation** d'un moyen de cryptologie | **libre** | vos utilisateurs n'ont rien à faire |
| **Fourniture**, **transfert depuis un État de l'UE**, **importation** d'un moyen qui n'assure pas *exclusivement* l'authentification ou le contrôle d'intégrité | **déclaration préalable** à l'ANSSI (art. 3, 1°) | **c'est votre cas** : le coffre chiffre des données (confidentialité) |
| **Transfert vers l'UE** et **exportation** vers Australie, Canada, États-Unis, Japon, Nouvelle-Zélande, Norvège, Suisse | **déclaration** (annexe 2, point A) | couvert par la même déclaration |
| **Exportation vers les autres pays** | **autorisation**, sauf produit « grand public » (annexe 2, point B, catégorie 3) qui ne relève que de la **déclaration** | demandez le **classement « grand public »** (voir ci-dessous) |
| Dispenses de toute formalité (annexe 1 : cartes à puce, équipements bancaires, téléphones sans fil, clés ≤ 56 bits symétriques, usage personnel, administration de SI…) | — | **aucune ne s'applique** à un gestionnaire de mots de passe AES-256 ✅ |

**Verdict : régime de la déclaration** (ni dispense, ni autorisation), à condition d'obtenir le classement
« grand public » pour l'export hors UE. Les trois conditions cumulatives du « grand public » (annexe 2, cat. 3) :
(a) vendu sans restriction au détail, y compris par voie électronique ; (b) fonction cryptographique non
modifiable facilement par l'utilisateur ; (c) installable sans assistance importante du fournisseur. Une appli de
store les remplit toutes. Debian a obtenu exactement cette attestation (« relève de la catégorie 3 de l'annexe 2 »)
pour sa distribution, gratuite et libre : la gratuité ne dispense pas, et ce n'est pas une épreuve ✅.

Qui déclare ✅ : « le fournisseur ou le primo-importateur ». Pour Qafila, c'est **vous**, personne physique ou
société, qui fournissez l'appli aux stores. 🔍 La déclaration porte sur le **moyen** (« Qafila », avec ses versions
iOS, Android et PC) : une seule déclaration pour les trois plateformes est la lecture naturelle du décret ;
confirmez-le avec l'ANSSI si le formulaire vous demande un découpage.

Et aujourd'hui ? 🔍 Le navigateur actuel n'embarque aucun moyen de cryptologie propre (HTTPS = WebKit / Android
System WebView, fournis par Apple et Google). La lecture courante est qu'il n'y a rien à déclarer tant que
l'appli ne fait qu'appeler le système ; c'est aussi la ligne d'Apple (« encryption limited to that within the
Apple operating system » ⇒ aucun document). Des articles alarmistes disent le contraire pour vendre un service :
ne les payez pas, posez la question à `controle@ssi.gouv.fr` si vous voulez une réponse écrite.

### 3.2 Comment faire la déclaration (procédure, pièces, délais)

1. **Où** ✅ : la démarche est en ligne — « Déclaration relative à un moyen de cryptologie » sur
   `https://demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie` (un guide PDF de
   la démarche est téléchargeable sur la page). Contact ANSSI : **controle@ssi.gouv.fr**, 01 71 75 80 11
   (9 h – 18 h). Les pages d'explication : `https://cyber.gouv.fr/controle-relatif-un-moyen-de-cryptologie` et
   `…/controle-reglementaire-sur-la-cryptographie-demarches-accomplir` (🔍 ces pages se chargent en JavaScript ;
   je n'ai pu lire que leurs résumés). Le formulaire papier historique existe aussi (arrêté du 29 janvier 2015
   fixant la forme des dossiers) ; la version en ligne suffit.
2. **Pièces demandées** ✅ (liste de la démarche en ligne) et ce que Qafila fournit :
   - document général présentant la société → une page : qui vous êtes, ce qu'est Qafila, gratuit, code public MIT ;
   - **extrait K bis de moins de trois mois** « ou document équivalent » → 🔍 si vous publiez en nom propre ou en
     micro-entreprise : avis de situation SIRENE + pièce d'identité ; demandez à l'ANSSI quel équivalent elle
     accepte ;
   - brochure commerciale → la fiche store (`android-browser/play/listing/fr-FR.md`, métadonnées fastlane) ;
   - **brochure technique** → `shared/CRYPTO.md` tel quel : c'est précisément la description des algorithmes,
     longueurs de clé, modes et paramètres qu'ils attendent (AES-256-GCM, Argon2id m = 64 Mio t = 3 p = 1, HKDF-SHA256,
     X25519, SHA-256, aléa système) ; joignez `COFFRE-SYNC.md` §2–3 pour le contexte ;
   - manuel utilisateur, guide administrateur « si disponibles » → la page d'aide du site (`site/`).
3. **Opérations à cocher** 💡 : fourniture, transfert intracommunautaire, exportation ; et **demandez
   l'attestation de classement « grand public »** (catégorie 3 de l'annexe 2) pour pouvoir exporter partout sans
   autorisation. Fonction : confidentialité (chiffrement de données stockées et transmises), plus authentification.
4. **Délais** ✅ : le dossier doit parvenir **au moins un mois avant** la première fourniture (art. 4). L'ANSSI a
   **un mois** pour demander un complément ou signaler que le moyen relève de l'autorisation ; passé ce délai sans
   réponse, vous pouvez procéder (art. 5). Elle délivre un **récépissé** portant le numéro d'enregistrement et peut
   délivrer une **attestation** avant l'échéance ; le classement « grand public » est prononcé sous **deux mois**.
   Retour d'expérience (Cryptomator, 2016) : deux mois au total, une relance pour une brochure technique manquante.
5. **Coût** 🔍 : aucun frais n'apparaît dans le décret ni sur la démarche en ligne ; je n'ai trouvé aucune mention
   de redevance. Considérez la formalité gratuite jusqu'à preuve du contraire.
6. **Le document à téléverser chez Apple** : l'**attestation** (ou le récépissé) de l'ANSSI, en PDF, dans *App
   Encryption Documentation*. Gardez le numéro d'enregistrement : il sert aux mises à jour.
7. **Mises à jour** 🔍 : une déclaration couvre le moyen déclaré ; une modification qui change les fonctions
   cryptographiques (nouvel algorithme, nouvelle fonction de confidentialité) appelle une déclaration
   modificative. Une mise à jour de version sans changement de crypto n'en appelle pas. Les phases 2 (X25519,
   relais) et 5 (TOTP) sont des ajouts de fonctions : déclarez-les dans le dossier initial comme « prévues » pour
   ne pas y revenir, ou prévoyez une déclaration complémentaire.

### 3.3 Calendrier conseillé 💡

Déposez le dossier **au début de la phase 1**, dès que `shared/CRYPTO.md` est figé (il l'est) : le délai d'un mois
court pendant que le coffre s'écrit, l'attestation arrive avant la première soumission, Apple n'attend jamais.

### 3.4 Union européenne

🔍 Le règlement (UE) 2021/821 (biens à double usage) exclut du contrôle les produits cryptographiques « grand
public » (note sur la cryptographie, catégorie 5, partie 2) : aucune licence européenne d'exportation n'est
attendue pour une appli de store. La formalité française du §3.1 reste due parce qu'elle porte sur la
**fourniture** en France, pas seulement sur l'export.

---

## 4. Google Play

### 4.1 Pas de questionnaire d'export, mais la même responsabilité

✅ Google Play n'a pas d'équivalent au questionnaire d'Apple ni de code de conformité. 🔍 Les serveurs de Play sont
américains : la logique du §2.4 (EAR, auto-classification) vaut en théorie aussi pour l'APK, et l'accord
développeur vous rend responsable du respect des lois d'export. La déclaration ANSSI (§3) couvre la fourniture
en France quel que soit le store.

### 4.2 Sécurité des données (*Data safety*) pour un gestionnaire de mots de passe

Définitions officielles ✅ (centre d'aide Play Console, lu le 16 novembre 2026) :

- « **Collecte** » = transmission des données de l'application **depuis l'appareil** de l'utilisateur.
- N'ont **pas** à être déclarées : les données **traitées uniquement sur l'appareil** ; les données **chiffrées de bout
  en bout**, « ne doivent pas pouvoir être lues par une entité intermédiaire, y compris le développeur » ; le
  **traitement éphémère** (en mémoire, le temps de répondre à une demande en temps réel).
- Les adresses IP sont à déclarer « en fonction de leur utilisation » ; si elles servent à déterminer une zone
  géographique, elles sont une « position approximative ».
- Une **politique de confidentialité** (URL) est obligatoire pour remplir le formulaire, même sans collecte.
- Le formulaire demande si **toutes les données collectées sont chiffrées en transit** et si vous offrez **un moyen
  de demander la suppression**.

Application à Qafila :

| Phase | Déclaration | Justification |
|---|---|---|
| 1 — coffre local, import, remplissage dans Qafila | **« Aucune donnée collectée ni partagée »** (inchangé) | tout est traité sur l'appareil ✅ |
| 2 — synchronisation | mots de passe, favoris, réglages : **non déclarés** au titre du chiffrement de bout en bout (le relais ne détient aucune clé : `COFFRE-SYNC.md` §2) ✅ ; adresse IP du journal 24 h : 🔍 soit non déclarée (sécurité anti-abus, non reliée à une personne, purgée en 24 h — à défendre comme traitement éphémère), soit déclarée prudemment | la page confidentialité publie déjà « ce que voit le relais » (§11, risque 4) |
| 2 — questions du formulaire | chiffrement en transit : **Oui** (TLS, et AEAD par-dessus) ; suppression : **Oui** (« Désactiver la synchronisation et effacer du serveur » → `DELETE /vaults/{id}`) | ✅ |
| 4 — service de remplissage | aucune collecte : le service lit l'`AssistStructure` localement et répond depuis le coffre | ✅ ; le guide Google cite `BIND_AUTOFILL_SERVICE` comme **indice** d'accès à des informations personnelles / financières, pas comme collecte |
| toutes | « Exigence de suppression de compte » : **non applicable** (aucun compte) 🔍 ; URL de confidentialité : `site/confidentialite.html` | |

💡 Au moment de la phase 2, relisez le formulaire avec la page confidentialité ouverte à côté : les deux doivent
dire la même chose, sinon Google parle de « divergence » et peut agir.

### 4.3 Permissions et déclarations annexes

- ✅ Manifeste actuel : `INTERNET`, `VIBRATE` seulement. Phase 1 ajoute `USE_BIOMETRIC` (pas de permission
  d'exécution) ; phase 2 ajoute `CAMERA` (permission d'exécution, demandée au moment de scanner le QR, avec un
  texte explicatif) ; phase 4 déclare le service avec `BIND_AUTOFILL_SERVICE` (permission de signature, réservée au
  système). **Jamais** `MANAGE_EXTERNAL_STORAGE` (`COFFRE-SYNC.md` §7.2 et §11).
- 🔍 À ma connaissance, Play n'impose **pas** de formulaire de déclaration spécifique au service de remplissage
  (contrairement au service d'accessibilité) ; le questionnaire *Contenu de l'application* demande en revanche de
  décrire l'usage des permissions sensibles (caméra). Vérifiez la liste des « autorisations et API à usage
  restreint » lors de la soumission de la phase 4.
- 💡 Catégorie et texte de fiche : « navigateur avec gestionnaire de mots de passe », en reprenant la phrase des
  garanties de `COFFRE-SYNC.md` §2. Pas de « sécurisé » avant la relecture externe.
- ✅ `android:allowBackup="true"` aujourd'hui : la phase 1 doit poser `dataExtractionRules` excluant `vault/`
  (`COFFRE-SYNC.md` §3.4) — pas une formalité de store, mais c'est ce que la fiche *Sécurité des données* promet.

---

## 5. Exactement quoi changer dans le dépôt, le jour où la phase 1 sort

**Ne rien changer avant** : tant que le coffre n'est pas dans un build envoyé à Apple, les valeurs actuelles sont
justes, et passer la clé à `true` trop tôt bloque chaque build TestFlight sur « Missing Compliance ».

### 5.1 `ios-browser/project.yml`

Ligne 47 aujourd'hui :

```yaml
        ITSAppUsesNonExemptEncryption: false
```

Au premier build contenant le coffre :

```yaml
        ITSAppUsesNonExemptEncryption: true
```

Dès réception du code d'Apple (après téléversement de l'attestation ANSSI), ajouter juste en dessous :

```yaml
        ITSEncryptionExportComplianceCode: "<code remis dans App Encryption Documentation>"
```

Dans le même bloc `properties:`, la phase 1 exige aussi (sinon l'appli plante à la première demande, et App
Review refuse) :

```yaml
        NSFaceIDUsageDescription: "Qafila déverrouille vos mots de passe avec Face ID."
```

et la phase 2 (lecture du QR d'appairage) :

```yaml
        NSCameraUsageDescription: "Qafila lit le QR code affiché par votre autre appareil pour l'associer."
```

Ce ne sont pas des clés d'export, mais elles font partie des mêmes contrôles d'App Review que le questionnaire.

### 5.2 `ios-browser/fastlane/Fastfile`

Ligne 69 aujourd'hui :

```ruby
      submission_information: { add_id_info_uses_idfa: false, export_compliance_uses_encryption: false }
```

Remplacer par (✅ les clés `export_compliance_*` ci-dessous existent toutes dans `spaceship/tunes/app_submission.rb`,
lu le 16 novembre 2026 ; 🔍 `add_id_info_uses_idfa`, déjà présente dans le fichier, n'y figure plus dans la
version courante — `add_id_info_serves_ads`, `add_id_info_tracks_action`, `add_id_info_tracks_install` sont les
noms listés : vérifiez avec la version de fastlane du workflow et retirez la clé si elle est refusée) :

```ruby
      submission_information: {
        add_id_info_uses_idfa: false,
        export_compliance_uses_encryption: true,                    # le coffre utilise du chiffrement
        export_compliance_is_exempt: false,                         # pas limité à HTTPS / au système
        export_compliance_contains_third_party_cryptography: true,  # swift-sodium (Argon2id)
        export_compliance_contains_proprietary_cryptography: false, # tout est RFC / NIST
        export_compliance_available_on_french_store: true,          # d'où l'attestation ANSSI
        export_compliance_encryption_updated: false                 # true seulement pour un build qui change la crypto
      }
```

Ces réponses ne remplacent pas l'`Info.plist` : avec le code de conformité posé dans `project.yml`, App Store
Connect ne les redemande plus ; elles restent utiles pour la toute première soumission (avant le code) et pour
la cohérence (`COFFRE-SYNC.md` §11, risque 7 : « mis en cohérence »). `export_compliance_encryption_updated`
passe à `true` pour le build qui ajoute X25519 (phase 2) ou TOTP (phase 5), puis revient à `false`.

### 5.3 Rien d'autre dans le code

- Le workflow `.github/workflows/ios.yml` n'a pas à changer : XcodeGen régénère l'`Info.plist` depuis `project.yml`.
- Android : aucune ligne de conformité chiffrement ; le travail se fait dans la Play Console (§4.2) et dans le
  manifeste de la phase 1 (`dataExtractionRules`, `USE_BIOMETRIC`).
- `DEPLOIEMENT_STORES.md` : ajouter les cases du §6 à sa section App Store quand la phase 1 est prête (il est
  rédigé pour le navigateur seul et dit encore « Aucune donnée collectée » sans nuance pour la phase 2).

---

## 6. Liste de contrôle, dans l'ordre

- [ ] **Début de phase 1** — Déposer la déclaration ANSSI en ligne (§3.2) : CRYPTO.md en brochure technique,
      fiche store en brochure commerciale, K bis ou équivalent ; cocher fourniture + transfert UE + export ;
      demander le classement « grand public ». Noter le numéro d'enregistrement du récépissé.
- [ ] **J + 1 mois** — Sans réponse de l'ANSSI : la fourniture est libre (art. 5). Avec attestation : la ranger
      en PDF. Relancer `controle@ssi.gouv.fr` pour le classement « grand public » s'il n'est pas prononcé à deux mois.
- [ ] **Premier build avec le coffre** — `project.yml` : `ITSAppUsesNonExemptEncryption: true` + `NSFaceIDUsageDescription`
      (§5.1) ; `Fastfile` : bloc `submission_information` (§5.2). Lancer la lane `beta`.
- [ ] **App Store Connect** — *App Information › App Encryption Documentation (+)* : répondre au questionnaire
      (§2.3), téléverser l'attestation ANSSI. Avoir rempli la description et la disponibilité par pays avant.
- [ ] **≈ 2 jours ouvrés** — Récupérer le code à côté du document approuvé ; `project.yml` :
      `ITSEncryptionExportComplianceCode`. Les builds suivants passent sans question.
- [ ] **Étiquette de confidentialité** (§2.6) et **Sécurité des données Play** (§4.2) : inchangées en phase 1 ;
      à relire en phase 2 (question du journal IP 24 h), avec la page confidentialité mise à jour en même temps.
- [ ] **1ᵉʳ février suivant la sortie** — Décider du rapport BIS (§2.4) : la phrase d'Apple vous en dispense ; un
      CSV d'une ligne lève tout doute.
- [ ] **Phase 2 / phase 5** — Déclaration ANSSI modificative si l'ajout (X25519, TOTP) n'était pas décrit dans le
      dossier initial ; `export_compliance_encryption_updated: true` pour ce build.

---

## 7. Sources consultées (16 novembre 2026) et limites

| Source | Ce qu'elle établit | Statut de lecture |
|---|---|---|
| Apple, *Complying with Encryption Export Regulations* (`developer.apple.com/documentation/security/complying-with-encryption-export-regulations`) | §2.1, §2.2, phrase sur le rapport annuel (§2.4) | ✅ texte intégral lu |
| Apple, App Store Connect Help, *Export compliance documentation for encryption* (`…/help/app-store-connect/reference/export-compliance-documentation-for-encryption`) | tableau des documents (§2.3) et note « French encryption declaration form is only required if you're distributing your app on the App Store in France » | ✅ |
| Apple, *Overview of export compliance* et *Determine and upload app encryption documentation* (App Store Connect Help) | responsabilité du développeur, contrôle français (« Secure Storage, Secure Communications… »), procédure de téléversement, deux jours ouvrés, code | ✅ |
| BIS, *Annual Self-Classification* (`bis.gov/learn-support/encryption-controls/annual-self-classification`) | §2.4 : 740.17(b)(1), 1ᵉʳ février, CSV, Supplement No. 8 | ✅ (adresses e-mail masquées sur la page) |
| Légifrance, décret n° 2007-663 du 2 mai 2007 (`legifrance.gouv.fr/loda/id/JORFTEXT000000646995`) | art. 1 à 5, annexes 1 et 2 (§3.1) | ✅ texte lu ; 🔍 version consolidée à vérifier |
| Démarche en ligne *Déclaration relative à un moyen de cryptologie* (`demarche.numerique.gouv.fr/commencer/declaration-relative-a-un-moyen-de-cryptologie`) | pièces, contact (§3.2) | ✅ |
| cyber.gouv.fr, pages *Contrôle relatif à un moyen de cryptologie* et *démarches à accomplir* | fournisseur / primo-importateur, délais, récépissé, classement grand public sous deux mois | 🔍 pages dynamiques : lues via résumés de recherche seulement |
| Debian, *Attestation de déclaration d'un moyen de cryptologie* (`debian.org/legal/anssi.fr.html`) | exemple réel d'attestation « catégorie 3 de l'annexe 2 » pour un logiciel libre gratuit | ✅ |
| Cryptomator, *In-Depth: Export Compliance for French iOS App Store* (2016) | retour d'expérience : délai ≈ 2 mois, relance pour brochure technique, téléversement de l'approbation dans App Store Connect | ✅ ancien (2016) |
| Google Play Console Help, *Sécurité des données* (`support.google.com/googleplay/android-developer/answer/10787469`) et Android Developers, *Declare data use* | définitions du §4.2, exemption bout en bout, indices `BIND_AUTOFILL_SERVICE` | ✅ |
| fastlane : `docs.fastlane.tools/actions/pilot/` et `spaceship/lib/spaceship/tunes/app_submission.rb` (dépôt GitHub, branche master) | option `uses_non_exempt_encryption` (§2.5), clés `export_compliance_*` du §5.2 | ✅ |

Ce que je n'ai **pas** pu vérifier et que vous confirmerez en soumettant : les libellés exacts des questions
d'App Store Connect en 2026 ; l'existence d'une redevance ANSSI (aucune trouvée) ; l'équivalent du K bis accepté
pour une personne physique ; le traitement par Apple et Google du journal d'adresses IP de 24 h ; l'option
`uses_non_exempt_encryption` de `pilot` et les noms exacts des clés `submission_information` dans la version de
fastlane du workflow ; l'étendue de l'exemption « mass market » pour le rapport annuel du BIS.
