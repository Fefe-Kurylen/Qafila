#!/usr/bin/env python3
"""Icône Qafila : grande pyramide 3D au centre d'un atome (trois orbites tissées et trois électrons), sans fond.

Géométrie sur la grille 108 × 108 (dp Android), reprise du choix « C » (atom3d/C.svg) et
peaufinée : trois orbites (32 × 13, tournées de 0/60/120°, trait 2,6) dont la moitié
arrière passe derrière la pyramide et la moitié avant devant elle ; trois électrons
répartis à 120° les uns des autres ; pyramide à deux faces avec une arête éclairée.
Le tout est réduit d'un facteur S pour rester dans le cercle de sécurité d'Android
(centre 54,54, rayon 33).

Tout est produit en tracés pleins (aucun trait, aucune transformation, coordonnées
absolues) pour passer tel quel en VectorDrawable. Chaque croisement « dessus/dessous »
est une vraie découpe (shapely) : orbites arrière découpées autour de la pyramide,
pyramide et orbites arrière découpées autour des orbites avant. La couche monochrome
d'Android, d'une seule couleur, garde ainsi tout le relief du tissage.

Usage (voir README.md) :
  python3 generate.py            # SVG sources + VectorDrawable Android
  python3 generate.py --png      # en plus, toutes les PNG (iOS, Android, PC, site)
  python3 generate.py --check    # vérifie seulement la géométrie
"""
import math
import os
import subprocess
import sys
import tempfile

import numpy as np
from shapely.affinity import rotate as sh_rotate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))

# ------------------------------------------------------------------ paramètres (dessin d'origine, avant réduction)
C = (54.0, 54.0)            # centre de l'atome
RX, RY = 32.0, 13.0         # demi-axes des orbites
ANGLES = (0, 60, 120)       # rotation des orbites (degrés, sens horaire à l'écran)
ORBIT_W = 2.6               # épaisseur des orbites
FRONT_UP = (False, False, True)   # par orbite : True = la moitié haute (y local) passe devant ; ici les trois moitiés basses à l'écran
# pyramide : sommet, base gauche, sommet avant de la base (plus bas), base droite
PYR = {'apex': (54.0, 30.0), 'left': (32.0, 62.95), 'front': (57.52, 66.45), 'right': (76.0, 62.95)}
RIDGE_W = 0.8               # arête éclairée entre les deux faces
E_R = 3.1                   # rayon des électrons
E_T = 35.0                  # position du premier électron sur l'orbite 0 (angle paramétrique, degrés, moitié haute)

S = 0.988                   # réduction autour du centre : bout d'orbite (32 + 1,3) × S ≤ 33
GAP = 1.4                   # espace autour de la pyramide (orbites arrière)
FRONT_GAP = 1.1             # espace autour des orbites avant, là où elles passent devant la pyramide
WEAVE_GAP = 1.0             # espace où une orbite avant croise une orbite arrière
SAFE_R = 33.0               # cercle de sécurité Android
TOL = 0.02                  # tolérance d'approximation des courbes (unités)

# bg : fond (None = transparent) ; lit / shade : faces ; orbit : orbites ;
# electron : couleur unie ou dégradé radial (clair, foncé) ; ridge : (couleur, opacité au sommet, opacité à la base)
PALETTES = {
    'classic': {'bg': None, 'lit': ('#FFA552', '#E06A1B'), 'shade': ('#B8500F', '#7A2E06'),
                'orbit': ('#F08A3A', '#A2410C'), 'electron': ('#FFB36B', '#D2591A'), 'ridge': ('#FFE2C2', 0.95, 0.35)},
    'dark':    {'bg': '#17191C', 'lit': '#F2F4F7', 'shade': '#9FA6B0', 'orbit': '#F2F4F7',
                'electron': '#F2F4F7', 'ridge': ('#FFFFFF', 0.9, 0.3)},
    'ink':     {'bg': '#14233C', 'lit': '#F3EEE3', 'shade': '#BFB49C', 'orbit': '#F3EEE3',
                'electron': '#F3EEE3', 'ridge': ('#FFFFFF', 0.85, 0.3)},
    'desert':  {'bg': '#E9D7B7', 'lit': '#C0703E', 'shade': '#7A4E25', 'orbit': '#7A4E25',
                'electron': '#C0703E', 'ridge': ('#F6DFC0', 0.9, 0.3)},
    'gold':    {'bg': '#0E0E10', 'lit': ('#F8DC8C', '#D6A548'), 'shade': ('#B8862E', '#7E5A1C'),
                'orbit': ('#F8DC8C', '#B8862E'), 'electron': ('#FCEBB4', '#C9983C'), 'ridge': ('#FFF4D2', 0.95, 0.35)},
}
ANDROID_SUFFIX = {'classic': '', 'dark': '_dark', 'ink': '_ink', 'desert': '_desert', 'gold': '_gold'}


def T(x, y):
    """Réduction de facteur S autour du centre."""
    return (C[0] + (x - C[0]) * S, C[1] + (y - C[1]) * S)


# ------------------------------------------------------------------ géométrie
def ellipse_point(ang_deg, t_deg):
    a, t = math.radians(ang_deg), math.radians(t_deg)
    x, y = RX * S * math.cos(t), RY * S * math.sin(t)
    return (C[0] + x * math.cos(a) - y * math.sin(a), C[1] + x * math.sin(a) + y * math.cos(a))


def ellipse_line(ang_deg, n=4000):
    pts = [ellipse_point(ang_deg, t) for t in np.linspace(0, 360, n, endpoint=False)]
    return LineString(pts + [pts[0]])


def half_plane(ang_deg, front, eps=0.0):
    """Demi-plan « avant » (y local > 0, moitié basse de l'orbite non tournée) ou « arrière » de l'orbite."""
    h = box(-200, 0 if front else -200, 200, 200 if front else eps)
    if FRONT_UP[ANGLES.index(ang_deg)]:
        h = sh_rotate(h, 180, origin=(0, 0))
    h = sh_rotate(h, ang_deg, origin=(0, 0))
    from shapely.affinity import translate
    return translate(h, C[0], C[1])


def clean(g, opening=0.15, min_area=0.3):
    if opening:
        g = g.buffer(-opening, quad_segs=16).buffer(opening, quad_segs=16)
    return [x for x in getattr(g, 'geoms', [g]) if not x.is_empty and x.area > min_area]


def build():
    p = {k: T(*v) for k, v in PYR.items()}
    silhouette = Polygon([p['apex'], p['left'], p['front'], p['right']])
    shade_tri = Polygon([p['apex'], p['front'], p['right']])
    (ax, ay), (fx, fy) = p['apex'], p['front']
    L = math.hypot(fx - ax, fy - ay)
    nx, ny = -(fy - ay) / L * RIDGE_W * S / 2, (fx - ax) / L * RIDGE_W * S / 2
    ridge = Polygon([(ax + nx, ay + ny), (fx + nx, fy + ny), (fx - nx, fy - ny), (ax - nx, ay - ny)]).intersection(silhouette)

    rings = [ellipse_line(a).buffer(ORBIT_W * S / 2, quad_segs=32) for a in ANGLES]
    # la moitié arrière déborde un peu sur l'avant aux deux bouts : pas de liseré à la jonction
    backs = [r.intersection(half_plane(a, False, eps=0.4)) for r, a in zip(rings, ANGLES)]
    fronts = [r.intersection(half_plane(a, True)) for r, a in zip(rings, ANGLES)]
    front_all = unary_union(fronts)

    # orbites arrière : découpées autour de la pyramide et sous les orbites avant des autres
    pyr_cut = silhouette.buffer(GAP, quad_segs=48)
    back_parts = []
    for k, b in enumerate(backs):
        others = unary_union([f for j, f in enumerate(fronts) if j != k]).buffer(WEAVE_GAP, quad_segs=24)
        back_parts += clean(b.difference(pyr_cut).difference(others))
    # un tracé par morceau (pas d'union) : chemins courts pour Android (avertissement VectorPath au-delà de 800 caractères)
    back = back_parts
    # pyramide : découpée sous les orbites avant
    front_cut = front_all.buffer(FRONT_GAP, quad_segs=24)
    lit = clean(silhouette.difference(front_cut), opening=0)
    shade = clean(shade_tri.difference(front_cut), opening=0)
    ridge = clean(ridge.difference(front_cut), opening=0, min_area=0.05)
    front = [x for fr in fronts for x in clean(fr, opening=0)]

    # électrons à 120° les uns des autres : P sur l'orbite 0, puis P tourné de 120° (orbite 120°) et de 240° (orbite 60°)
    p0 = ellipse_point(0, -E_T)
    electrons = []
    for k in range(3):
        a = math.radians(120 * k)
        dx, dy = p0[0] - C[0], p0[1] - C[1]
        electrons.append((C[0] + dx * math.cos(a) - dy * math.sin(a), C[1] + dx * math.sin(a) + dy * math.cos(a)))
    return dict(p=p, silhouette=silhouette, back=back, lit=lit, shade=shade, ridge=ridge, front=front,
                electrons=electrons, e_r=E_R * S)


# ------------------------------------------------------------------ courbes de Bézier (Schneider)
def _bez(b, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return mt ** 3 * b[0] + 3 * mt * mt * t * b[1] + 3 * mt * t * t * b[2] + t ** 3 * b[3]


def _bez_d(b, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return 3 * mt * mt * (b[1] - b[0]) + 6 * mt * t * (b[2] - b[1]) + 3 * t * t * (b[3] - b[2])


def _bez_dd(b, t):
    t = np.asarray(t)[:, None]
    return 6 * (1 - t) * (b[2] - 2 * b[1] + b[0]) + 6 * t * (b[3] - 2 * b[2] + b[1])


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _gen_bezier(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    A1 = t1[None, :] * (3 * (1 - u) ** 2 * u)[:, None]
    A2 = t2[None, :] * (3 * (1 - u) * u ** 2)[:, None]
    c00 = (A1 * A1).sum(); c01 = (A1 * A2).sum(); c11 = (A2 * A2).sum()
    tmp = pts - _bez(np.array([p0, p0, p3, p3]), u)
    x0 = (A1 * tmp).sum(); x1 = (A2 * tmp).sum()
    det = c00 * c11 - c01 * c01
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        a1 = (x0 * c11 - x1 * c01) / det
        a2 = (c00 * x1 - c01 * x0) / det
    else:
        a1 = a2 = seg / 3
    if a1 < 1e-6 * seg or a2 < 1e-6 * seg:
        a1 = a2 = seg / 3
    return np.array([p0, p0 + t1 * a1, p3 + t2 * a2, p3])


def _max_err(pts, b, u):
    d = np.linalg.norm(_bez(b, u) - pts, axis=1)
    i = int(np.argmax(d[1:-1])) + 1 if len(pts) > 2 else 1
    return d[i], i


def _reparam(pts, b, u):
    q = _bez(b, u) - pts
    q1 = _bez_d(b, u); q2 = _bez_dd(b, u)
    num = (q * q1).sum(1)
    den = (q1 * q1).sum(1) + (q * q2).sum(1)
    with np.errstate(divide='ignore', invalid='ignore'):
        nu = np.where(np.abs(den) > 1e-12, u - num / den, u)
    return np.clip(nu, 0, 1)


def _fit(pts, t1, t2, tol):
    if len(pts) == 2:
        d = np.linalg.norm(pts[1] - pts[0]) / 3
        return [np.array([pts[0], pts[0] + t1 * d, pts[1] + t2 * d, pts[1]])]
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    u = seg / seg[-1]
    b = _gen_bezier(pts, u, t1, t2)
    err, split = _max_err(pts, b, u)
    if err < tol:
        return [b]
    if err < tol * 6:
        for _ in range(30):
            u = _reparam(pts, b, u)
            b = _gen_bezier(pts, u, t1, t2)
            err, split = _max_err(pts, b, u)
            if err < tol:
                return [b]
    split = min(max(split, 1), len(pts) - 2)
    tc = _unit(pts[split - 1] - pts[split + 1])
    return _fit(pts[:split + 1], t1, tc, tol) + _fit(pts[split:], -tc, t2, tol)


def _end_tangent(pts, forward=True, dist=0.12):
    seq = pts if forward else pts[::-1]
    acc = 0
    for i in range(1, len(seq)):
        acc += np.linalg.norm(seq[i] - seq[i - 1])
        if acc >= dist:
            return _unit(seq[i] - seq[0])
    return _unit(seq[-1] - seq[0])


def ring_to_beziers(coords, tol=TOL, corner_deg=18):
    coords = list(LineString(coords).segmentize(0.04).coords)
    pts = np.array(coords[:-1] if coords[0] == coords[-1] else coords, dtype=float)
    keep = [pts[0]]
    for q in pts[1:]:
        if np.linalg.norm(q - keep[-1]) > 0.01:
            keep.append(q)
    pts = np.array(keep)
    n = len(pts)
    prev = pts[np.arange(n) - 1]; nxt = pts[(np.arange(n) + 1) % n]
    v1 = pts - prev; v2 = nxt - pts
    ang = np.degrees(np.abs(np.arctan2(v1[:, 0] * v2[:, 1] - v1[:, 1] * v2[:, 0], (v1 * v2).sum(1))))
    corners = [i for i in range(n) if ang[i] > corner_deg and ang[i] >= ang[i - 1] and ang[i] >= ang[(i + 1) % n]]
    smooth_split = False
    if not corners:
        corners = [int(round(i * n / 4)) % n for i in range(4)]
        smooth_split = True
    out = []
    for j, c0 in enumerate(corners):
        c1 = corners[(j + 1) % len(corners)]
        idx = [(c0 + k) % n for k in range(((c1 - c0) % n or n) + 1)]
        seg = pts[idx]
        if smooth_split:
            t1 = _unit(pts[(c0 + 1) % n] - pts[c0 - 1]); t2 = _unit(pts[c1 - 1] - pts[(c1 + 1) % n])
        else:
            t1 = _end_tangent(seg, True); t2 = _end_tangent(seg, False)
        out += _fit(seg, t1, t2, tol)
    return out


def _f(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def _pt(q):
    return f'{_f(q[0])},{_f(q[1])}'


def ring_path(coords, samples):
    bz = ring_to_beziers(coords)
    d = [f'M{_pt(bz[0][0])}']
    for b in bz:
        samples.append(_bez(np.round(b, 2), np.linspace(0, 1, 9)))
        chord = b[3] - b[0]
        L = np.linalg.norm(chord)
        straight = L > 1e-9 and all(abs(chord[0] * (b[i] - b[0])[1] - chord[1] * (b[i] - b[0])[0]) / L < 0.01 for i in (1, 2))
        d.append(f'L{_pt(b[3])}' if straight else f'C{_pt(b[1])} {_pt(b[2])} {_pt(b[3])}')
    return ' '.join(d) + ' Z'


def poly_path(poly, samples):
    return ' '.join(ring_path(list(r.coords), samples) for r in [poly.exterior, *poly.interiors])


def lin_path(*pts):
    return 'M' + ' L'.join(_pt(q) for q in pts) + ' Z'


def circle_path(c, r, samples):
    k = 0.5522847498 * r
    x, y = c
    segs = [((x + r, y), (x + r, y + k), (x + k, y + r), (x, y + r)),
            ((x, y + r), (x - k, y + r), (x - r, y + k), (x - r, y)),
            ((x - r, y), (x - r, y - k), (x - k, y - r), (x, y - r)),
            ((x, y - r), (x + k, y - r), (x + r, y - k), (x + r, y))]
    for b in segs:
        samples.append(_bez(np.round(np.array(b), 2), np.linspace(0, 1, 9)))
    return f'M{_pt(segs[0][0])} ' + ' '.join(f'C{_pt(b[1])} {_pt(b[2])} {_pt(b[3])}' for b in segs) + ' Z'


# ------------------------------------------------------------------ éléments de l'icône
def gradient_vector(role, g, key=None):
    """Dégradés en coordonnées absolues. Linéaire : (x0, y0, x1, y1). Radial (électrons) : (cx, cy, r)."""
    p = g['p']
    if role in ('back', 'front'):
        hw = RX + ORBIT_W / 2
        hh = math.sqrt((RX * math.sin(math.radians(60))) ** 2 + (RY * math.cos(math.radians(60))) ** 2) + ORBIT_W / 2
        a, b = T(C[0] - hw, C[1] - hh), T(C[0] + hw, C[1] + hh)
        return (*a, *b)
    if role == 'lit':
        # lumière venant d'en haut à gauche : du haut de l'arête gauche vers le sommet avant de la base
        (ax, ay), (lx, ly), (fx, fy) = p['apex'], p['left'], p['front']
        return (ax + (lx - ax) * 0.25, ay + (ly - ay) * 0.25, fx, fy)
    if role == 'shade':
        (ax, ay), (rx, ry), (fx, fy) = p['apex'], p['right'], p['front']
        return (ax, ay, (rx + fx) / 2, (ry + fy) / 2)
    if role == 'ridge':
        return (*p['apex'], *p['front'])
    if role == 'electron':
        cx, cy = g['electrons'][key]
        r = g['e_r']
        return (cx - 0.35 * r, cy - 0.35 * r, 1.35 * r)
    raise ValueError(role)


def shapes():
    """Liste (rôle, d, evenodd, clé) des tracés, dans l'ordre de dessin, et points des courbes produites."""
    g = build()
    samples = []
    out = []
    for poly in g['back']:
        out.append(('back', poly_path(poly, samples), len(poly.interiors) > 0, None))
    for role in ('lit', 'shade', 'ridge'):
        for poly in g[role]:
            out.append((role, poly_path(poly, samples), len(poly.interiors) > 0, None))
    for poly in g['front']:
        out.append(('front', poly_path(poly, samples), len(poly.interiors) > 0, None))
    for k, c in enumerate(g['electrons']):
        out.append(('electron', circle_path(c, g['e_r'], samples), False, k))
    return g, out, np.vstack(samples)


def check(g, samples):
    centre = Point(C)
    polys = g['back'] + g['front'] + g['lit']
    far_poly = max(centre.distance(Point(xy)) for x in polys for xy in x.exterior.coords)
    far_e = max(centre.distance(Point(c)) + g['e_r'] for c in g['electrons'])
    far_path = float(np.max(np.hypot(samples[:, 0] - C[0], samples[:, 1] - C[1])))
    far = max(far_poly, far_e, far_path)
    gap_back = min(g['silhouette'].distance(x) for x in g['back'])
    pyr = unary_union(g['lit'])
    gap_front = min(pyr.distance(x) for x in g['front'])
    e_pyr = min(g['silhouette'].distance(Point(c)) - g['e_r'] for c in g['electrons'])
    ok = far <= SAFE_R and gap_back >= GAP - 0.05 and gap_front >= FRONT_GAP - 0.05 and e_pyr > GAP
    print(f'rayon max : polygones {far_poly:.3f}, électrons {far_e:.3f}, tracés {far_path:.3f} (cercle de sécurité {SAFE_R})')
    print(f'écarts : pyramide/orbites arrière {gap_back:.3f}, pyramide/orbites avant {gap_front:.3f} (visés {GAP} et {FRONT_GAP}), '
          f'électrons/pyramide {e_pyr:.3f} -> {"OK" if ok else "ÉCHEC"}')
    return ok


def _paint(palette, role):
    if role in ('back', 'front'):
        return palette['orbit']
    return palette[role]


def svg(palette, g, items, background=True, mono=None, view='0 0 108 108', extra=''):
    defs, body = [], []
    for role, d, eo, key in items:
        rule = ' fill-rule="evenodd"' if eo else ''
        if mono:
            if role != 'ridge':
                body.append(f'<path fill="{mono}"{rule} d="{d}"/>')
            continue
        col = _paint(palette, role)
        if role == 'ridge':
            c, o0, o1 = col
            x0, y0, x1, y1 = gradient_vector(role, g)
            defs.append(f'<linearGradient id="g-ridge" gradientUnits="userSpaceOnUse" x1="{_f(x0)}" y1="{_f(y0)}" x2="{_f(x1)}" '
                        f'y2="{_f(y1)}"><stop offset="0" stop-color="{c}" stop-opacity="{o0}"/>'
                        f'<stop offset="1" stop-color="{c}" stop-opacity="{o1}"/></linearGradient>')
            body.append(f'<path fill="url(#g-ridge)"{rule} d="{d}"/>')
            continue
        if isinstance(col, tuple):
            gid = f'g-{role}' + (f'-{key}' if key is not None else '')
            if not any(f'id="{gid}"' in x for x in defs):
                v = gradient_vector(role, g, key)
                stops = f'<stop offset="0" stop-color="{col[0]}"/><stop offset="1" stop-color="{col[1]}"/>'
                if role == 'electron':
                    defs.append(f'<radialGradient id="{gid}" gradientUnits="userSpaceOnUse" cx="{_f(v[0])}" cy="{_f(v[1])}" '
                                f'r="{_f(v[2])}">{stops}</radialGradient>')
                else:
                    defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{_f(v[0])}" y1="{_f(v[1])}" '
                                f'x2="{_f(v[2])}" y2="{_f(v[3])}">{stops}</linearGradient>')
            fill = f'url(#{gid})'
        else:
            fill = col
        body.append(f'<path fill="{fill}"{rule} d="{d}"/>')
    bg = f'<rect x="-200" y="-200" width="508" height="508" fill="{palette["bg"]}"/>' if background and palette['bg'] else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" width="108" height="108">'
            + (f'<defs>{"".join(defs)}</defs>' if defs else '') + extra + bg + ''.join(body) + '</svg>\n')


def _argb(c, a):
    return f'#{round(a * 255):02X}{c[1:]}'


def vector_drawable(name, palette, g, items):
    lines = ['<?xml version="1.0" encoding="utf-8"?>',
             f'<!-- Icône Qafila, variante « {name} » : grande pyramide 3D (face éclairée à gauche, face d\'ombre à droite)',
             '     au centre d\'un atome (trois orbites tissées devant/derrière et trois électrons).',
             '     Généré par shared/icon/generate.py : ne pas modifier à la main. -->',
             '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" '
             'android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">']
    for role, d, eo, key in items:
        ft = ' android:fillType="evenOdd"' if eo else ''
        col = _paint(palette, role)
        grad = None
        if role == 'ridge':
            c, o0, o1 = col
            x0, y0, x1, y1 = gradient_vector(role, g)
            grad = (f'android:type="linear" android:startX="{_f(x0)}" android:startY="{_f(y0)}" android:endX="{_f(x1)}" '
                    f'android:endY="{_f(y1)}" android:startColor="{_argb(c, o0)}" android:endColor="{_argb(c, o1)}"')
        elif isinstance(col, tuple):
            v = gradient_vector(role, g, key)
            if role == 'electron':
                grad = (f'android:type="radial" android:centerX="{_f(v[0])}" android:centerY="{_f(v[1])}" '
                        f'android:gradientRadius="{_f(v[2])}" android:startColor="{col[0]}" android:endColor="{col[1]}"')
            else:
                grad = (f'android:type="linear" android:startX="{_f(v[0])}" android:startY="{_f(v[1])}" android:endX="{_f(v[2])}" '
                        f'android:endY="{_f(v[3])}" android:startColor="{col[0]}" android:endColor="{col[1]}"')
        if grad:
            lines += [f'    <path{ft} android:pathData="{d}">',
                      '        <aapt:attr name="android:fillColor">',
                      f'            <gradient {grad} />',
                      '        </aapt:attr>',
                      '    </path>']
        else:
            lines.append(f'    <path android:fillColor="{col}"{ft} android:pathData="{d}" />')
    lines.append('</vector>')
    return '\n'.join(lines) + '\n'


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)


# ------------------------------------------------------------------ PNG
RES = os.path.join(REPO, 'android-browser/app/src/main/res')
XC = os.path.join(REPO, 'ios-browser/QafilaBrowser/Resources/Assets.xcassets')
DIAM = 2 * SAFE_R      # diamètre du dessin (unités)
# côté (unités) de la vue carrée : le dessin occupe DIAM / côté de l'image
IOS_SIDE = 84.0        # iOS (carré opaque, masqué en coins arrondis par le système) : ~79 %
LEGACY_SIDE = 74.0     # Android ancien format (transparent) : ~89 %
SITE_SIDE = 70.0       # site (transparent) : ~94 %
PC_SIDE = DIAM / 0.90  # PC Windows/Linux (transparent) : ~90 %
MAC_SIDE = DIAM / 0.80 # PC macOS (transparent) : ~80 %, centré


def render(svgtext, out, size, opaque=None):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False) as fh:
        fh.write(svgtext)
        tmp = fh.name
    cmd = ['node', os.path.join(HERE, 'render.mjs'), 'png', tmp, out, str(size)] + ([f'--opaque={opaque}'] if opaque else [])
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    os.unlink(tmp)


def view(side):
    o = 54 - side / 2
    return f'{o:.4f} {o:.4f} {side:.4f} {side:.4f}'


def to_rgb(path):
    from PIL import Image
    Image.open(path).convert('RGB').save(path, optimize=True)


def to_rgba(path):
    from PIL import Image
    Image.open(path).convert('RGBA').save(path, optimize=True)


def pngs(g, items):
    classic = PALETTES['classic']
    # iOS : Apple refuse les icônes transparentes -> carré plein RVB sans alpha
    ios_bg = {'classic': '#FFFFFF', 'dark': '#17191C', 'ink': '#14233C', 'desert': '#E9D7B7', 'gold': '#0E0E10'}
    ios = {'classic': 'AppIcon.appiconset/icon-1024.png', 'dark': 'AppIcon-Dark.appiconset/icon-1024.png',
           'ink': 'AppIcon-Ink.appiconset/icon-1024.png', 'desert': 'AppIcon-Desert.appiconset/icon-1024.png',
           'gold': 'AppIcon-Gold.appiconset/icon-1024.png'}
    for name, rel in ios.items():
        txt = svg(PALETTES[name], g, items, view=view(IOS_SIDE))
        out = os.path.join(XC, rel)
        render(txt, out, 1024, opaque=ios_bg[name]); to_rgb(out)
        prev = os.path.join(XC, f'PreviewIcon-{name.capitalize()}.imageset/icon.png')
        render(txt, prev, 180, opaque=ios_bg[name]); to_rgb(prev)
    # icône classique en mode sombre d'iOS : même dessin orange sur #17191C
    out = os.path.join(XC, 'AppIcon.appiconset/icon-1024-dark.png')
    render(svg(classic, g, items, view=view(IOS_SIDE)), out, 1024, opaque='#17191C'); to_rgb(out)
    # Android, ancien format : dessin classique sur fond transparent (carré et rond identiques)
    for dpi, size in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        for f in ('ic_launcher.png', 'ic_launcher_round.png'):
            out = os.path.join(RES, f'mipmap-{dpi}', f)
            render(svg(classic, g, items, view=view(LEGACY_SIDE)), out, size); to_rgba(out)
    # Site
    out = os.path.join(REPO, 'site/icon.png')
    render(svg(classic, g, items, view=view(SITE_SIDE)), out, 256); to_rgba(out)
    # PC
    for f, side in (('icon.png', PC_SIDE), ('icon-mac.png', MAC_SIDE)):
        out = os.path.join(REPO, 'desktop/build', f)
        render(svg(classic, g, items, view=view(side)), out, 1024); to_rgba(out)




# ------------------------------------------------------------------ main
def main():
    g, items, samples = shapes()
    ok = check(g, samples)
    if '--check' in sys.argv:
        sys.exit(0 if ok else 1)
    if not ok:
        sys.exit('géométrie hors limites')
    write(os.path.join(HERE, 'master.svg'), svg(PALETTES['classic'], g, items, background=False))
    for name, pal in PALETTES.items():
        write(os.path.join(HERE, f'{name}.svg'), svg(pal, g, items))
        write(os.path.join(RES, f'drawable/ic_launcher_foreground{ANDROID_SUFFIX[name]}.xml'),
              vector_drawable(name, pal, g, items))
    write(os.path.join(HERE, 'mono.svg'), svg(PALETTES['classic'], g, items, background=False, mono='#000000'))
    for role, d, eo, _ in items:
        print(f'  {role:8s} {len(d):5d} car.{" evenOdd" if eo else ""}')
    if '--png' in sys.argv:
        pngs(g, items)
    print('ok')


if __name__ == '__main__':
    main()
