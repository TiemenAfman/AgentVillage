"""The candle sloop: a small open boat hung level on four chains as a chandelier, a board down her
middle carrying eight church candles on iron cup-spikes, and the wax of years hanging from her keel
and lower planks in long pale icicles. After the keeper's drawing
(refs/krakenkit/objecten/sloep-kroonluchter.jpg), the same boat twice.

She is clinker built: three weathered brown strakes over two painted a dark blue-green, each strake
a ribbon laid over one hull surface (`surf`), its lower edge standing out by LAP and its upper edge
tucked under the next, so the laps show as steps from every side. A thick dark gunwale rail along the
top, stem and stern posts rising a little over it with a square brass cap each (a dark ring and a
bolt on its end face), iron straps down her sides with brass plates under the rail, and brass
fittings with an eye where each chain takes hold.

Frame: the hull's length along x, her beam along z, centred on both. y = 0 is the tip of the longest
wax drip under the keel (the lowest point of the asset); everything is modelled with the gunwale at
midships on y = 0 and lifted by LIFT. About 1.5 long (post caps included), 0.44 across the rail,
0.31 from the rail to the keel's underside (the drawing's depth: a fifth of her length), the drips
under her half that again. Seen mostly from below in the hall, which is why the drips and the
painted bottom have the detail and the inside only a floor, thwarts and a few ribs.
"""
import math
import bmesh
from mathutils import Vector
from geom import (PI, TAU, M, frame, span, box, rod, disc, ball, lathe, hull, torus, emit, rng, material,
                  flame, IRON, BRASS, BLACK, WAX, OAK, DARK)
from skulllamp import chain, drip, rivet

ASSET = 'civic_kraken_sloop'

PLANK = material('plank:sloop', 0x6a4630)        # weathered brown strakes
PAINT = material('plain:sloop-paint', 0x21393a)  # the painted bottom, a dark blue-green
RAIL = material('plank:sloop-rail', 0x34231a)    # gunwale, keel
THWART = material('plankZ:sloop-thwart', 0x563a26)
DRIPWAX = material('plain:sloop-drip', 0xbfc9cc)  # old wax, grey-blue against the candles' cream

# ---- the hull's numbers (gunwale at midships = 0 in the modelling frame) -----------------------
LH = .70                 # half length, to the stems
BW = .20                 # half beam at the gunwale, over the planking
D = .29                  # gunwale to the planking's bottom at midships
SHEER = .05              # how much the gunwale rises to the ends
K = .7                   # the section's squareness: under 1 is a flat floor and upright sides
LAP = .007               # how far a strake's lower edge stands out
T = .009                 # plank thickness
U_END = .985             # the strakes stop here; the stems cover the rest
KEEL_DROP = LAP + .006   # the keel's middle under the planking
KEEL_HH = .008
CRUST_DROP = KEEL_DROP + .004   # the wax crust along the keel: its middle, and half its height
CRUST_HH = .007
DRIP_MAX = .16           # the longest drip, hanging from the crust at midships: half her depth
LIFT = D + CRUST_DROP + CRUST_HH + DRIP_MAX     # gunwale over the asset's origin
RING_L = .55             # the ring the four chains meet at, over the gunwale
RING_Y = LIFT + RING_L   # ... over the asset's origin
TOP_L = RING_L + .15     # where the chain going on up ends (the drop to the roof is the room's)

# The candles: x, z, visible height, radius, the cup's height over the board. Heights and gaps as in
# the drawing: a tall one at each end, three standing close together left of the middle.
BOARD_Y = -.022          # the board's top
CUP = .024               # a socket's height over its cup
SUNK = .012              # how deep a candle stands in its socket
CANDLES = [(-.47, .012, .09, .021, .036), (-.35, -.018, .072, .02, .03), (-.21, .016, .1, .023, .028),
           (-.14, -.02, .138, .025, .026), (-.065, .018, .112, .022, .036), (.08, -.008, .088, .021, .044),
           (.21, .02, .08, .02, .03), (.35, -.014, .122, .023, .04)]
FLAME_S = 1.15


def _flame_base(c):
    x, z, h, r, hh = c
    return BOARD_Y + hh + CUP - SUNK + (h + SUNK) + .003


# Where each flame stands (its foot) over the asset's origin, and FLAME_Y the height of their middle
# on average - where the room hangs the sloop's light (0.6325; the feet run 0.58 to 0.64). RING_Y is
# 1.024, and the chain going on up ends at LIFT + TOP_L = 1.174 (the asset's top, 1.178 with its link).
FLAMES = [(c[0], round(LIFT + _flame_base(c), 4), c[1]) for c in CANDLES]
FLAME_Y = round(sum(y for _, y, _ in FLAMES) / len(FLAMES) + .017 * FLAME_S, 4)


# ---- the hull surface -------------------------------------------------------------------------------
def half_beam(u):
    return BW * max(0.0, 1 - abs(u) ** 2.4) ** .55


def keel_y(u):
    return -D * (1 - .52 * abs(u) ** 2.1)


def sheer_y(u):
    return SHEER * abs(u) ** 2.5


def surf(u, v, s):
    """The planking's base surface: u -1..1 stern to bow, v 0 (keel) .. 1 (gunwale), s the side."""
    th = v * PI / 2
    zf = math.sin(th) ** K
    yf = 1 - max(math.cos(th), 0.0) ** K
    k = keel_y(u)
    return Vector((u * LH, k + (sheer_y(u) - k) * yf, s * half_beam(u) * zf))


def normal(u, v, s):
    h = 1e-3
    pu = surf(min(u + h, 1), v, s) - surf(max(u - h, -1), v, s)
    pv = surf(u, min(v + h, 1), s) - surf(u, max(v - h, 0), s)
    return (pu.cross(pv) * s).normalized()


def v_at(yf):
    """The v at which the planking stands `yf` of the way from the keel up to the gunwale."""
    return math.acos((1 - yf) ** (1 / K)) / (PI / 2)


# Strakes as (v from, v to, material), from the keel up; each runs on under the next by a third.
BOUNDS = [0, v_at(.17), v_at(.42), v_at(.61), v_at(.8), 1]
STRAKES = [(BOUNDS[i], BOUNDS[i + 1], PAINT if i < 2 else PLANK) for i in range(5)]


def reach(i):
    v0, v1, _ = STRAKES[i]
    return v1 if i == len(STRAKES) - 1 else v1 + (STRAKES[i + 1][1] - STRAKES[i + 1][0]) * .33


def lap_out(i, v):
    v0 = STRAKES[i][0]
    return LAP * (1 - (v - v0) / (reach(i) - v0))


def outer_at(v):
    """How far the outermost plank stands out of the base surface at v."""
    for i in reversed(range(len(STRAKES))):
        if STRAKES[i][0] <= v <= reach(i):
            return lap_out(i, v)
    return 0.0


def us(n, a=-U_END, b=U_END):
    """n+1 stations from a to b, closer together towards the ends where the hull turns."""
    out = []
    for i in range(n + 1):
        t = -1 + 2 * i / n
        out.append(math.sin(t * PI / 2))
    lo, hi = out[0], out[-1]
    return [a + (b - a) * (x - lo) / (hi - lo) for x in out]


def ribbon(label, mat, uu, vv, s, off):
    """A closed skin over the surface: rows uu x vv, `off(v)` = (outer, inner) out of it."""
    bm = bmesh.new()
    layers = []
    for which in (0, 1):
        grid = []
        for u in uu:
            row = []
            for v in vv:
                o = off(v)[which]
                row.append(bm.verts.new(surf(u, v, s) + normal(u, v, s) * o))
            grid.append(row)
        layers.append(grid)
    A, B = layers
    nu, nv = len(uu), len(vv)
    for i in range(nu - 1):
        for j in range(nv - 1):
            bm.faces.new((A[i][j], A[i + 1][j], A[i + 1][j + 1], A[i][j + 1]))
            bm.faces.new((B[i][j], B[i][j + 1], B[i + 1][j + 1], B[i + 1][j]))
    ring = [(i, 0) for i in range(nu - 1)] + [(nu - 1, j) for j in range(nv - 1)] + \
           [(i, nv - 1) for i in range(nu - 1, 0, -1)] + [(0, j) for j in range(nv - 1, 0, -1)]
    for k, (i, j) in enumerate(ring):
        i2, j2 = ring[(k + 1) % len(ring)]
        bm.faces.new((A[i][j], A[i2][j2], B[i2][j2], B[i][j]))
    emit(bm, mat, label)


def sweep(label, pts, hw, hh, mat, up=(0, 1, 0)):
    """A bar of rectangular section along a path, its height kept to `up`: a rail, the keel, a rib.
    `hw` and `hh` a half width and height, or one per point."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    hw = hw if isinstance(hw, (list, tuple)) else [hw] * n
    hh = hh if isinstance(hh, (list, tuple)) else [hh] * n
    bm = bmesh.new()
    secs = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        side = t.cross(Vector(up)).normalized()
        u2 = side.cross(t).normalized()
        secs.append([bm.verts.new(p + side * a * hw[i] + u2 * b * hh[i]) for a, b in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
    for A, B in zip(secs, secs[1:]):
        for k in range(4):
            bm.faces.new((A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]))
    bm.faces.new(secs[0])
    bm.faces.new(list(reversed(secs[-1])))
    emit(bm, mat, label)


# ---- the boat ---------------------------------------------------------------------------------------
def planking():
    uu = us(18)
    for s in (-1, 1):
        for i, (v0, v1, mat) in enumerate(STRAKES):
            v2 = reach(i)
            rows = 3 if i == 0 else 2
            vv = [v0 + (v2 - v0) * j / rows for j in range(rows + 1)]
            ribbon('sloop strake', mat, uu, vv, s, lambda v, i=i: (lap_out(i, v), lap_out(i, v) - T))


def ends():
    """Stem and stern: a block closing the planking's ends, a square post rising over the gunwale,
    and its brass cap with a dark ring and a bolt on the end face."""
    vv = [j / 6 for j in range(7)]
    for e in (-1, 1):
        u = e * U_END
        pts = []
        for s in (-1, 1):
            for v in vv:
                p = surf(u, v, s) + normal(u, v, s) * outer_at(v)
                pts.append(tuple(p))
                pts.append((e * (LH + .024), p.y, s * .013))
        hull('sloop stem', pts, RAIL)
        x = e * (LH + .006)
        y0, y1 = keel_y(1) - KEEL_DROP - KEEL_HH, sheer_y(1) + .062
        span('sloop post', x - .022, x + .022, y0, y1, -.025, .025, DARK, bevel=.003)
        # The forefoot: the knee where keel meets post.
        hull('sloop knee', [(e * (LH - .09), keel_y(.87) - KEEL_DROP - KEEL_HH, sz * .011) for sz in (-1, 1)]
             + [(e * (LH + .026), y0, sz * .02) for sz in (-1, 1)] + [(e * (LH + .026), y0 + .06, sz * .02) for sz in (-1, 1)]
             + [(e * (LH - .05), keel_y(.93) - .004, sz * .011) for sz in (-1, 1)], RAIL)
        cy = y1 + .012
        box('sloop cap', (x + e * .004, cy, 0), (.058, .048, .062), BRASS, bevel=.004)
        box('sloop cap band', (x, y1 - .014, 0), (.05, .01, .056), BRASS)
        face = x + e * .033
        # The dark ring and its bolt on the cap's end and on both its sides, as in the drawing (which
        # shows the boat side on, and the ring on the face turned to us).
        disc('sloop cap ring', (face - e * .002, cy, 0), .017, .004, BLACK, sides=10, roll=-e * PI / 2)
        disc('sloop cap bolt', (face + e * .0015, cy, 0), .008, .004, BRASS, sides=8, roll=-e * PI / 2, top=.005)
        for sz in (-1, 1):
            disc('sloop cap ring', (x + e * .004, cy, sz * .029), .016, .004, BLACK, sides=10, tilt=sz * PI / 2)
            disc('sloop cap bolt', (x + e * .004, cy, sz * .0325), .0075, .004, BRASS, sides=8, tilt=sz * PI / 2, top=.005)
        for sz in (-1, 1):
            rivet((x + e * .022, y1 - .03, sz * .014), (e, 0, 0), k=.004, h=.003, mat=BRASS)


def rails():
    uu = us(22, -.975, .975)
    for s in (-1, 1):
        pts = [surf(u, 1, s) + normal(u, 1, s) * .005 + Vector((0, .005, 0)) for u in uu]
        sweep('sloop gunwale', pts, .012, .011, RAIL)
    # The keel, from post to post along the bottom.
    ku = us(16, -1, 1)
    sweep('sloop keel', [(u * LH, keel_y(u) - KEEL_DROP, 0) for u in ku], .011, KEEL_HH, RAIL)


def straps():
    """Iron straps down the sides over the brown strakes and the top of the paint, bent over each
    lap, with a brass plate under the rail and a rivet on every strake."""
    for s in (-1, 1):
        for uc in (-.56, -.22, .22, .56):
            du = .011 / LH
            for i in range(2, len(STRAKES)):
                v0, v1 = STRAKES[i][0], (STRAKES[i][1] if i < len(STRAKES) - 1 else .985)
                ribbon('sloop strap', IRON, [uc - du, uc + du], [v0, (v0 + v1) / 2, v1], s,
                       lambda v, i=i: (lap_out(i, v) + .0035, lap_out(i, v) - .001))
                vm = (v0 + v1) / 2
                p = surf(uc, vm, s) + normal(uc, vm, s) * (lap_out(i, vm) + .0035)
                rivet(tuple(p), tuple(normal(uc, vm, s)), k=.0038, h=.003, mat=IRON)
            dp = .02 / LH
            ribbon('sloop plate', BRASS, [uc - dp, uc + dp], [.935, 1], s,
                   lambda v: (lap_out(4, v) + .0055, lap_out(4, v) + .001))
    # Where the chains take hold: a brass saddle over the rail and an iron eye standing on it.
    for e in (-1, 1):
        for s in (-1, 1):
            u = e * .8
            p = surf(u, 1, s) + normal(u, 1, s) * .005
            span('sloop saddle', p.x - .022, p.x + .022, p.y - .018, p.y + .019, p.z - .018, p.z + .018, BRASS)
            torus('sloop eye', (p.x, p.y + .031, p.z), .011, .0038, IRON, seg=8, sides=4, tilt=PI / 2)


def eye(e, s):
    u = e * .8
    p = surf(u, 1, s) + normal(u, 1, s) * .005
    return Vector((p.x, p.y + .038, p.z))


def inside():
    """What shows over the rail: bottom boards, a few ribs, three thwarts and the candle board."""
    yf = .3
    v = v_at(yf)
    fu = [-.86 + 1.72 * i / 10 for i in range(11)]
    top = [surf(u, v, 1) for u in fu]
    pts = []
    for p in top:
        for sz in (-1, 1):
            pts += [(p.x, p.y + .004, sz * (p.z - T - .004)), (p.x, p.y - .006, sz * (p.z - T - .012))]
    hull('sloop floor', pts, PLANK)
    for uc in (-.62, -.34, .34, .62):
        for s in (-1, 1):
            path = [surf(uc, w, s) + normal(uc, w, s) * (-T - .006) for w in (v, .6, .8, .92, .99)]
            sweep('sloop rib', path, .007, .006, RAIL, up=(1, 0, 0))
    for x in (-.4, .0, .4):
        u = x / LH
        w = half_beam(u) - T - .004
        span('sloop thwart', x - .03, x + .03, BOARD_Y - .038, BOARD_Y - .02, -w, w, THWART)
    span('sloop board', -.56, .5, BOARD_Y - .02, BOARD_Y, -.046, .046, OAK, bevel=.003)
    span('sloop board', -.56, .5, BOARD_Y - .026, BOARD_Y - .02, -.036, .036, DARK)


def candle(c, seed):
    """An iron spike with a drip pan and a socket, and a church candle in it burnt down unevenly,
    its wax run down the sides and over the socket's lip."""
    x, z, h, r, hh = c
    g = rng(seed)
    y = BOARD_Y
    lathe('sloop holder foot', [(.017, 0), (.017, .004), (.009, .008), (0, .008)], IRON, at=(x, y, z), sides=6)
    rod('sloop holder spike', (x, y + .006, z), (x, y + hh, z), .0045, IRON, top=.0035, sides=5)
    ball('sloop holder knop', (x, y + hh * .55, z), (.0075, .006, .0075), IRON, seg=6, rings=3)
    cy = y + hh
    lathe('sloop holder pan', [(0, 0), (.009, 0), (r + .012, .004), (r + .014, .008), (r + .011, .008), (0, .005)],
          IRON, at=(x, cy, z), sides=7)
    lathe('sloop holder socket', [(r + .002, .004), (r + .0055, .006), (r + .0055, CUP), (r + .002, CUP), (0, CUP - .006)],
          IRON, at=(x, cy, z), sides=7)
    b = cy + CUP - SUNK
    H = h + SUNK
    tilt = g.uniform(-.003, .003)
    lathe('sloop candle', [(r * 1.01, 0), (r, H * .45), (r * .98, H - .005), (r * .94, H - .001),
                           (r * .62, H - .006), (0, H - .005)], WAX, at=(x, b, z), sides=8)
    rod('sloop wick', (x, b + H - .006, z), (x + tilt, b + H + .007, z), .0016, BLACK, sides=3)
    flame((x + tilt, b + H + .003, z), FLAME_S)
    # Runs down the candle from the lip, one reaching the socket, each ending in a bead.
    for k in range(2):
        a = g.uniform(0, TAU)
        l = g.uniform(.25, .5) * h if k else h - .004
        cc, ss = math.cos(a), math.sin(a)
        ys = (b + H - .001, b + H - l * .6, b + H - l, b + H - l - .006)
        rr = r * .99
        drip('sloop candle run', [(x + rr * cc, yy, z + rr * ss) for yy in ys], [(cc, 0, ss)] * 4,
             [.0042, .0048, .0062, .0016], WAX)
    # A collar of wax over the socket's lip and one run of it down the socket into the pan.
    lathe('sloop wax collar', [(r + .0035, 0), (r + .0068, .003), (r + .0062, .007), (r + .001, .009)],
          WAX, at=(x, cy + CUP - .005, z), sides=6)
    a = g.uniform(0, TAU)
    cc, ss = math.cos(a), math.sin(a)
    ro = r + .0058
    drip('sloop socket run', [(x + ro * cc, cy + CUP - .002, z + ro * ss), (x + ro * cc, cy + CUP * .5, z + ro * ss),
                              (x + ro * cc, cy + .01, z + ro * ss), (x + (ro + .004) * cc, cy + .007, z + (ro + .004) * ss)],
         [(cc, 0, ss)] * 4, [.004, .0042, .0055, .003], WAX)


def icicle(tip, top, r, seed):
    """Wax hanging straight down from `top` to `tip`: fat where it leaves the hull, a waist, a bead
    at the end."""
    x, y0, z = tip
    L = top - y0
    g = rng(seed)
    w = g.uniform(.85, 1.15)
    # A drop at the end, a thin neck over it, and from there widening all the way up.
    prof = [(0, 0), (r * .5, .006), (r * .3, .016)]
    if L > .07:
        prof += [(r * .5, L * .5)]
    prof += [(r * .8, L * .8), (r * 1.05, L + .004), (0, L + .008)]
    lathe('sloop icicle', prof, DRIPWAX, at=(x, y0, z), sides=5, phase=g.uniform(0, TAU), scale=(w, 1, 2 - w))


def drips():
    """The wax under her: a crust along the keel with icicles hanging from it, and more of them
    from the painted bottom either side."""
    g = rng(71)
    cu = [-.72 + 1.4 * i / 14 for i in range(15)]
    hw = [.015 + g.uniform(-.002, .004) for _ in cu]
    hh = [CRUST_HH * g.uniform(.7, 1.0) for _ in cu]
    hh[7] = CRUST_HH           # full depth where the longest one hangs
    sweep('sloop crust', [(u * LH, keel_y(u) - CRUST_DROP, 0) for u in cu], hw, hh, DRIPWAX)
    bot = lambda u: keel_y(u) - CRUST_DROP - CRUST_HH
    # The longest, at midships, and the rest along the keel shorter the further out they hang.
    icicle((.0, bot(0) - DRIP_MAX, .0), bot(0) + .006, .012, 1)
    # A curtain along the keel: close together, longest in the middle and shorter towards the ends,
    # staggered either side of the keel so it has some depth from below.
    for i in range(24):
        u = -.72 + 1.44 * i / 23 + g.uniform(-.02, .02)
        if abs(u) < .04:
            u += .06 * (1 if u >= 0 else -1)
        mid = max(0.0, 1 - abs(u) / .8) ** 1.3
        L = DRIP_MAX * (.22 + .72 * mid * g.uniform(.55, 1.0) + g.uniform(0, .1))
        zz = (.007 if i % 2 else -.007) + g.uniform(-.003, .003)
        icicle((u * LH, bot(u) - L, zz), bot(u) + .006, g.uniform(.008, .012), 10 + i)
    # From the painted bottom where it turns under: wax that ran down the paint and hangs from the
    # lowest lap it reached. (Runs drawn on the paint above them read as thorns from the side.)
    for i in range(18):
        s = -1 if i % 2 else 1
        u = -.74 + 1.48 * (i // 2) / 8 + g.uniform(-.05, .05)
        v = g.uniform(.1, .26)
        p = surf(u, v, s) + normal(u, v, s) * (outer_at(v) - .003)
        L = (.04 + g.uniform(0, .1)) * (1 - .45 * abs(u))
        icicle((p.x, p.y - L, p.z), p.y + .01, g.uniform(.007, .011), 40 + i)


def chains():
    ring = Vector((0, RING_L, 0))
    torus('sloop ring', tuple(ring), .03, .0065, IRON, seg=10, sides=4)
    for e in (-1, 1):
        for s in (-1, 1):
            a = eye(e, s)
            d = Vector((a.x, 0, a.z)).normalized()
            b = ring + d * .026 + Vector((0, -.002, 0))
            chain(tuple(a), tuple(b), n=max(2, round((b - a).length / .05)), w=.028, wire=.004)
    chain((0, RING_L + .004, 0), (0, TOP_L, 0), n=4, w=.034, wire=.005)


def build():
    with frame(M((0, LIFT, 0))):
        planking()
        ends()
        rails()
        straps()
        inside()
        for i, c in enumerate(CANDLES):
            candle(c, 500 + i)
        drips()
        chains()
