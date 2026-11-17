# Icône Qafila

« Q boussole connecté » doré : un grand anneau blanc (le Q), une aiguille de boussole en deux
tons au centre et, à la place de la queue du Q, un point de connexion percé posé sur l'anneau
en bas à droite. Même famille que Pyramid PDF et Merifa : carré arrondi, dégradé en diagonale
(#E9B949 → #B7791F), symbole blanc.

## Fichiers

- `master.svg` / `classic.svg` : icône classique (tuile dorée, 512 × 512).
- `dark.svg`, `ink.svg`, `desert.svg`, `gold.svg` : les variantes (icônes alternatives).
- `mono.svg` : silhouette d'une seule couleur (couche monochrome d'Android).
- `generate.py` : produit tout ce qui précède, les ressources Android et toutes les PNG.
- `render.mjs` : rendu SVG → PNG avec le Chromium de Playwright.

Le symbole est dessiné dans un repère « tuile » de 464 unités (le carré arrondi d'une image
de 512) puis placé à l'échelle de chaque sortie. Tout est en tracés pleins, sans trait ni
transformation, pour passer tel quel en VectorDrawable ; le trou du point de connexion est
une vraie découpe (il laisse voir le fond).

## Régénérer

```sh
python3 generate.py --check   # géométrie seule (rayon max, cercle de sécurité Android)
python3 generate.py           # SVG + ressources Android (premier plan, fond, icônes adaptatives)
python3 generate.py --png     # en plus : iOS, Android (ancien format), Google Play, PC, site
```

Dépendances : Python 3 avec `shapely` et `Pillow` ; Node avec `playwright`.

## Où va quoi

- **Android** : premier plan vectoriel (symbole seul, ~57 % de la zone visible) ; fond en
  dégradé doré (`drawable/ic_launcher_background.xml`) pour la classique, couleur unie pour
  les variantes ; PNG ancien format en carré arrondi et en rond ; `play/icon-512.png` en carré plein.
- **iOS** : carré plein sans transparence (le système arrondit) ; `icon-1024-dark.png` :
  symbole doré sur #17191C ; aperçus `PreviewIcon-*` pour les réglages.
- **PC** : `desktop/build/icon.png` (tuile ~91 %, comme Pyramid PDF et Merifa) et
  `icon-mac.png` (tuile ~80 %, centrée), transparentes.
- **Site** : `site/icon.png`, 256 px.
- L'aperçu des icônes dans les réglages Android (`AppIconTile`, SettingsScreen.kt) redessine
  la même géométrie : à mettre à jour si les paramètres de `generate.py` changent.
