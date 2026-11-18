#!/usr/bin/env python3
"""Icône Qafila : « Q boussole connecté » doré.

Un grand anneau blanc (le Q), une aiguille de boussole en deux tons au centre et, à la place
de la queue du Q, un point de connexion posé sur l'anneau en bas à droite (disque percé).
Même famille que Pyramid PDF et Merifa : carré arrondi, dégradé en diagonale, symbole blanc.

Le symbole est dessiné dans un repère « tuile » : tuile de 464 unités de côté centrée en 0,0
(c'est le carré arrondi de 464 px dans une image de 512). Chaque sortie le place à l'échelle
voulue : tout est en tracés pleins, coordonnées absolues, sans trait ni transformation,
pour passer tel quel en VectorDrawable. Le trou du point de connexion est une vraie découpe
(shapely) : il laisse voir le fond, y compris dans la couche monochrome d'Android.

Usage (voir README.md) :
  python3 generate.py            # SVG sources + VectorDrawable Android
  python3 generate.py --png      # en plus, toutes les PNG (iOS, Android, Play, PC, site)
  python3 generate.py --check    # vérifie seulement la géométrie
"""
import json
import os
import subprocess
import sys
import tempfile

from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

# ------------------------------------------------------------------ géométrie (repère tuile : côté 464, centre 0,0)
TILE = 464.0
RING_R, RING_W = 142.0, 34.0          # anneau du Q : rayon moyen, épaisseur
NODE_C, NODE_R, HOLE_R = (100.0, 100.0), 42.0, 16.0   # point de connexion (sur l'anneau, à 45°) et son trou
NEEDLE_TIP, NEEDLE_HALF = 72.0, 19.0  # aiguille : pointes à ±72 sur la diagonale, largeur ±19
PALE = 0.62                           # opacité de la moitié claire de l'aiguille
RES = 48                              # segments par quart de cercle
SAFE_R = 33.0                         # cercle de sécurité Android (grille 108)

# bg : fond (couleur ou dégradé clair → foncé, None = transparent) ; fg : symbole (couleur ou dégradé)
PALETTES = {
    'classic': {'bg': ('#E9B949', '#B7791F'), 'fg': '#FFFFFF'},
    'dark':    {'bg': '#17191C', 'fg': '#F2F4F7'},
    'ink':     {'bg': '#14233C', 'fg': '#F3EEE3'},
    'desert':  {'bg': '#E9D7B7', 'fg': '#7A4E25'},
    'gold':    {'bg': '#0E0E10', 'fg': ('#F8DC8C', '#B8862E')},
}
ANDROID_SUFFIX = {'classic': '', 'dark': '_dark', 'ink': '_ink', 'desert': '_desert', 'gold': '_gold'}


def symbol():
    """Les deux formes du symbole : (pleine, claire), en repère tuile."""
    ring = Point(0, 0).buffer(RING_R + RING_W / 2, RES).difference(Point(0, 0).buffer(RING_R - RING_W / 2, RES))
    node = Point(*NODE_C).buffer(NODE_R, RES)
    hole = Point(*NODE_C).buffer(HOLE_R, RES)
    t, h = NEEDLE_TIP, NEEDLE_HALF
    bright = Polygon([(t, -t), (-h, -h), (h, h)])
    pale = Polygon([(-t, t), (-h, -h), (h, h)])
    solid = unary_union([ring, node, bright]).difference(hole)
    return solid, pale


def max_radius(geoms):
    return max(Point(0, 0).distance(Point(x, y)) for g in geoms for poly in getattr(g, 'geoms', [g])
               for x, y in poly.exterior.coords)


# ------------------------------------------------------------------ chemins
def _f(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def path(geom, cx, cy, k):
    """Tracé SVG / VectorDrawable d'une géométrie placée au centre (cx, cy), échelle k."""
    out = []
    for poly in getattr(geom, 'geoms', [geom]):
        for ring in [poly.exterior, *poly.interiors]:
            pts = list(ring.coords)[:-1]
            out.append('M' + ' L'.join(f'{_f(cx + x * k)},{_f(cy + y * k)}' for x, y in pts) + ' Z')
    return ' '.join(out)


def items(cx, cy, k):
    solid, pale = symbol()
    return [('solid', path(solid, cx, cy, k), 1.0), ('pale', path(pale, cx, cy, k), PALE)]


# ------------------------------------------------------------------ SVG
def _grad(gid, col, x0, y0, x1, y1):
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{_f(x0)}" y1="{_f(y0)}" x2="{_f(x1)}" y2="{_f(y1)}">'
            f'<stop offset="0" stop-color="{col[0]}"/><stop offset="1" stop-color="{col[1]}"/></linearGradient>')


def svg(pal, size=512, shape='tile', inset=24.0, radius=110.0, background=True, mono=None):
    """Image carrée de `size` unités.

    shape : 'tile' (carré arrondi, coins transparents), 'circle' (rond), 'full' (carré plein, pour iOS / Play)
    inset : marge autour de la tuile ; radius : arrondi des coins.
    """
    side = size - 2 * inset if shape != 'full' else size
    k = side / TILE
    c = size / 2
    defs, body = [], []
    if background and pal['bg'] and not mono:
        x0 = y0 = inset if shape != 'full' else 0
        x1 = y1 = x0 + side
        if isinstance(pal['bg'], tuple):
            defs.append(_grad('bg', pal['bg'], x0, y0, x1, y1))
            fill = 'url(#bg)'
        else:
            fill = pal['bg']
        if shape == 'circle':
            body.append(f'<circle cx="{_f(c)}" cy="{_f(c)}" r="{_f(side / 2)}" fill="{fill}"/>')
        elif shape == 'full':
            body.append(f'<rect width="{size}" height="{size}" fill="{fill}"/>')
        else:
            body.append(f'<rect x="{_f(x0)}" y="{_f(y0)}" width="{_f(side)}" height="{_f(side)}" rx="{_f(radius)}" fill="{fill}"/>')
    fg = mono or pal['fg']
    if isinstance(fg, tuple):
        defs.append(_grad('fg', fg, c - 160 * k, c - 160 * k, c + 160 * k, c + 160 * k))
        fg = 'url(#fg)'
    for _, d, a in items(c, c, k):
        op = f' fill-opacity="{a}"' if a < 1 else ''
        body.append(f'<path fill="{fg}"{op} d="{d}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            + (f'<defs>{"".join(defs)}</defs>' if defs else '') + ''.join(body) + '</svg>\n')


# ------------------------------------------------------------------ Android
VD_K = 72.0 / TILE      # la zone visible d'une icône adaptative (72 dp) correspond à la tuile


def _argb(c, a=1.0):
    return f'#{round(a * 255):02X}{c[1:]}'


def _vd_head(name, what):
    return ['<?xml version="1.0" encoding="utf-8"?>',
            f'<!-- Icône Qafila, variante « {name} » : {what}.',
            '     Généré par shared/icon/generate.py : ne pas modifier à la main. -->',
            '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" '
            'android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">']


def _vd_gradient(d, col, x0, y0, x1, y1, a=1.0, indent='    '):
    return [f'{indent}<path android:pathData="{d}"' + (f' android:fillAlpha="{a}"' if a < 1 else '') + '>',
            f'{indent}    <aapt:attr name="android:fillColor">',
            f'{indent}        <gradient android:type="linear" android:startX="{_f(x0)}" android:startY="{_f(y0)}" '
            f'android:endX="{_f(x1)}" android:endY="{_f(y1)}" android:startColor="{col[0]}" android:endColor="{col[1]}" />',
            f'{indent}    </aapt:attr>',
            f'{indent}</path>']


def vd_foreground(name, pal):
    lines = _vd_head(name, 'Q boussole (anneau, aiguille en deux tons) et point de connexion percé')
    fg = pal['fg']
    for _, d, a in items(54, 54, VD_K):
        if isinstance(fg, tuple):
            r = 160 * VD_K
            lines += _vd_gradient(d, fg, 54 - r, 54 - r, 54 + r, 54 + r, a)
        else:
            lines.append(f'    <path android:fillColor="{fg}"' + (f' android:fillAlpha="{a}"' if a < 1 else '')
                         + f' android:pathData="{d}" />')
    lines.append('</vector>')
    return '\n'.join(lines) + '\n'


def vd_background(name, pal):
    lines = _vd_head(name, 'fond en dégradé doré, en diagonale')
    lines += _vd_gradient('M0,0 L108,0 L108,108 L0,108 Z', pal['bg'], 18, 18, 90, 90)
    lines.append('</vector>')
    return '\n'.join(lines) + '\n'


def vd_logo():
    """Logo complet (tuile arrondie en dégradé + symbole) en VectorDrawable, pour la page d'accueil Android."""
    pal = PALETTES['classic']
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             '<!-- Logo de Qafila (page d\'accueil). Généré par shared/icon/generate.py : ne pas modifier à la main. -->',
             '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" '
             'android:width="96dp" android:height="96dp" android:viewportWidth="512" android:viewportHeight="512">']
    x0, x1, r = 24, 488, 110
    tile = (f'M{x0 + r},{x0} L{x1 - r},{x0} A{r},{r} 0 0 1 {x1},{x0 + r} L{x1},{x1 - r} A{r},{r} 0 0 1 {x1 - r},{x1} '
            f'L{x0 + r},{x1} A{r},{r} 0 0 1 {x0},{x1 - r} L{x0},{x0 + r} A{r},{r} 0 0 1 {x0 + r},{x0} Z')
    lines += _vd_gradient(tile, pal['bg'], x0, x0, x1, x1)
    for _, d, a in items(256, 256, (x1 - x0) / TILE):
        lines.append(f'    <path android:fillColor="{pal["fg"]}"' + (f' android:fillAlpha="{a}"' if a < 1 else '') + f' android:pathData="{d}" />')
    lines.append('</vector>')
    return '\n'.join(lines) + '\n'


def adaptive(name):
    suf = ANDROID_SUFFIX[name]
    bg = '@drawable/ic_launcher_background' if name == 'classic' else f'@color/ic_launcher_background{suf}'
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            f'    <background android:drawable="{bg}" />\n'
            f'    <foreground android:drawable="@drawable/ic_launcher_foreground{suf}" />\n'
            f'    <monochrome android:drawable="@drawable/ic_launcher_foreground{suf}" />\n'
            '</adaptive-icon>\n')


def colors():
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             '<!-- Fonds des icônes adaptatives (la classique a un fond en dégradé : drawable/ic_launcher_background.xml).',
             '     Généré par shared/icon/generate.py. -->', '<resources>']
    for name, suf in ANDROID_SUFFIX.items():
        if name != 'classic':
            lines.append(f'    <color name="ic_launcher_background{suf}">{PALETTES[name]["bg"]}</color>')
    return '\n'.join(lines + ['</resources>']) + '\n'


def write(p, text):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as fh:
        fh.write(text)


# ------------------------------------------------------------------ PNG
ANDROID_RES = os.path.join(REPO, 'android-browser/app/src/main/res')
XC = os.path.join(REPO, 'ios-browser/QafilaBrowser/Resources/Assets.xcassets')


def render(svgtext, out, size, opaque=None):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as fh:
        fh.write(svgtext)
        tmp = fh.name
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = ['node', os.path.join(HERE, 'render.mjs'), 'png', tmp, out, str(size)] + ([f'--opaque={opaque}'] if opaque else [])
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    os.unlink(tmp)


def _mode(p, mode):
    from PIL import Image
    Image.open(p).convert(mode).save(p, optimize=True)


def pngs():
    classic = PALETTES['classic']
    # iOS : carré plein sans transparence (le système arrondit les coins)
    ios = {'classic': 'AppIcon.appiconset/icon-1024.png', 'dark': 'AppIcon-Dark.appiconset/icon-1024.png',
           'ink': 'AppIcon-Ink.appiconset/icon-1024.png', 'desert': 'AppIcon-Desert.appiconset/icon-1024.png',
           'gold': 'AppIcon-Gold.appiconset/icon-1024.png'}
    for name, rel in ios.items():
        txt = svg(PALETTES[name], shape='full')
        out = os.path.join(XC, rel)
        render(txt, out, 1024, opaque='#000000'); _mode(out, 'RGB')
        prev = os.path.join(XC, f'PreviewIcon-{name.capitalize()}.imageset/icon.png')
        render(txt, prev, 180, opaque='#000000'); _mode(prev, 'RGB')
    # iOS, apparence sombre de l'icône classique : symbole doré sur fond sombre
    out = os.path.join(XC, 'AppIcon.appiconset/icon-1024-dark.png')
    render(svg({'bg': '#17191C', 'fg': ('#F8DC8C', '#C9983C')}, shape='full'), out, 1024, opaque='#17191C'); _mode(out, 'RGB')
    # Android ancien format : carré arrondi / rond, transparents
    for dpi, size in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        for f, shape in (('ic_launcher.png', 'tile'), ('ic_launcher_round.png', 'circle')):
            out = os.path.join(ANDROID_RES, f'mipmap-{dpi}', f)
            render(svg(classic, shape=shape, inset=20, radius=96), out, size); _mode(out, 'RGBA')
    # Google Play : carré plein 512 (Play arrondit lui-même)
    out = os.path.join(REPO, 'android-browser/play/icon-512.png')
    render(svg(classic, shape='full'), out, 512, opaque='#000000'); _mode(out, 'RGB')
    # site
    out = os.path.join(REPO, 'site/icon.png')
    render(svg(classic, inset=12, radius=112), out, 256); _mode(out, 'RGBA')
    # PC : Windows / Linux (tuile ~91 %, comme Pyramid PDF et Merifa) et macOS (tuile ~80 %, centrée)
    out = os.path.join(REPO, 'desktop/build/icon.png')
    render(svg(classic), out, 1024); _mode(out, 'RGBA')
    # Windows : tuile presque bord à bord (comme les icônes de Claude, Chrome…) pour ne pas paraître plus petite
    # dans la barre des tâches, et un .ico multi-tailles (16 à 256 px) rendu depuis la grande image.
    out = os.path.join(REPO, 'desktop/build/icon-win.png')
    render(svg(classic, inset=6, radius=104), out, 1024); _mode(out, 'RGBA')
    from PIL import Image
    big = Image.open(out).convert('RGBA')
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    big.resize((256, 256), Image.LANCZOS).save(os.path.join(REPO, 'desktop/build/icon.ico'), sizes=[(n, n) for n in sizes])
    out = os.path.join(REPO, 'desktop/build/icon-mac.png')
    render(svg(classic, inset=50, radius=92), out, 1024); _mode(out, 'RGBA')


# ------------------------------------------------------------------ main
def check():
    solid, pale = symbol()
    r = max_radius([solid, pale])
    vd = r * VD_K
    print(f'rayon max du symbole : {r:.1f} unités (tuile {TILE:.0f}) → {vd:.2f} dp sur 108 (sécurité {SAFE_R})')
    assert vd <= SAFE_R, 'le symbole sort du cercle de sécurité Android'
    assert r < TILE / 2, 'le symbole déborde de la tuile'
    return r


def main():
    check()
    if '--check' in sys.argv:
        return
    write(os.path.join(HERE, 'master.svg'), svg(PALETTES['classic']))
    for name, pal in PALETTES.items():
        write(os.path.join(HERE, f'{name}.svg'), svg(pal))
        suf = ANDROID_SUFFIX[name]
        write(os.path.join(ANDROID_RES, f'drawable/ic_launcher_foreground{suf}.xml'), vd_foreground(name, pal))
        write(os.path.join(ANDROID_RES, f'mipmap-anydpi-v26/ic_launcher{suf}.xml'), adaptive(name))
        write(os.path.join(ANDROID_RES, f'mipmap-anydpi-v26/ic_launcher{suf}_round.xml'), adaptive(name))
    write(os.path.join(ANDROID_RES, 'drawable/ic_launcher_background.xml'), vd_background('classic', PALETTES['classic']))
    write(os.path.join(ANDROID_RES, 'values/ic_launcher_background.xml'), colors())
    write(os.path.join(HERE, 'mono.svg'), svg(PALETTES['classic'], background=False, mono='#000000'))
    # Logo de la page d'accueil (à la place du mot « Qafila ») : PC, iPhone, Android.
    logo = svg(PALETTES['classic'], size=512).replace('<svg ', '<svg class="logo" role="img" aria-label="Qafila" ', 1).replace('id="bg"', 'id="qlbg"').replace('url(#bg)', 'url(#qlbg)').strip()
    write(os.path.join(REPO, 'desktop/main/logo.js'), "'use strict';\n// Logo de Qafila (page d'accueil). Généré par shared/icon/generate.py : ne pas modifier à la main.\nmodule.exports = " + json.dumps(logo) + ";\n")
    write(os.path.join(REPO, 'ios-browser/QafilaBrowser/Web/QafilaLogo.swift'), "// Logo de Qafila (page d'accueil). Généré par shared/icon/generate.py : ne pas modifier à la main.\nenum QafilaLogo {\n    static let svg = #\"\"\"\n" + logo + "\n\"\"\"#\n}\n")
    write(os.path.join(ANDROID_RES, 'drawable/ic_qafila_logo.xml'), vd_logo())
    if '--png' in sys.argv:
        pngs()
    print('ok')


if __name__ == '__main__':
    main()
