# Icône Qafila

Grande pyramide 3D orange foncé au centre d'un atome : trois orbites tissées (moitié arrière
derrière la pyramide, moitié avant devant) et trois électrons, **sans fond**.

## Fichiers

- `master.svg` : dessin de référence (variante classique, fond transparent), grille 108 × 108.
- `classic.svg`, `dark.svg`, `ink.svg`, `desert.svg`, `gold.svg` : les cinq variantes
  (fond / face éclairée / face d'ombre / orbites ; classique sans fond).
- `mono.svg` : silhouette d'une seule couleur (couche monochrome d'Android).
- `generate.py` : produit tout ce qui précède, les VectorDrawable Android et toutes les PNG.
- `render.mjs` : rendu SVG → PNG avec le Chromium de Playwright.

Tout est en tracés pleins (aucun trait ni transformation, coordonnées absolues) pour
passer tel quel en VectorDrawable. Les croisements dessus/dessous sont de vraies découpes,
et tout le dessin tient dans le cercle de sécurité d'Android (centre 54,54, rayon 33).

## Régénérer

```sh
python3 generate.py --check   # géométrie seule (rayon max, écarts)
python3 generate.py           # SVG + android-browser/.../drawable/ic_launcher_foreground*.xml
python3 generate.py --png     # en plus : iOS, Android (ancien format), PC (desktop/build), site
```

Dépendances : Python 3 avec `shapely`, `numpy` et `Pillow` ; Node avec `playwright`.

## Où va quoi

- **Android** : premier plan vectoriel ; fond adaptatif transparent pour la classique,
  fond coloré pour les variantes ; PNG ancien format transparentes.
- **iOS** : Apple refuse les icônes transparentes, donc carré plein RVB sans alpha
  (classique sur blanc, `icon-1024-dark.png` sur #17191C, variantes sur leur fond).
- **PC** : `desktop/build/icon.png` (dessin ~90 %) et `icon-mac.png` (~80 %, centré), transparentes.
- **Site** : `site/icon.png`, 256 px, transparente.
- L'aperçu des icônes dans les réglages Android (`AppIconTile`, SettingsScreen.kt) redessine
  la même géométrie : à mettre à jour si les paramètres de `generate.py` changent.
