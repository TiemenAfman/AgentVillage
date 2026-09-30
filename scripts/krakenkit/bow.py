"""The broken bow of a ship, jutting out of the hall's north wall over the bar (the keeper's drawing
`boeg`): the front of a hull sawn off square at the back, where it meets the wall, and broken off
along the bottom.

Ten strakes of weathered honey-coloured planks, each strake a plank or two butted end to end, run
from the wall to a massive stem timber. They are clinker laid - every strake's lower edge stands
proud of the one below - so a seam is a real step with a shadow in it, not a line. The eighth
strake from the bottom is painted a faded blue-green under a dark rubbing rail, the two below the
rail carry the iron: cleats, eye plates with rings, a hook. Along the top a gunwale, short square
balusters and a dark cap rail. Two hawse holes each side, a big strap hinge with a hook on the +x
side and a smaller strap on the -x side. The stem runs past the hull's bottom to the floor of the
asset, lashed with rope near its foot, and above the gunwale rakes forward into a snapped-off point
with an iron band and a brass fitting round it.

The broken part: the five lower strakes do not reach the wall. Each is snapped off further forward
than the one above it, its end cut in teeth (every row of its section breaks at another place),
with splinters left hanging off, and where nothing is left under a strake its lower edge is torn
too. Behind the break the ship's frames show, snapped at their own lengths, and a deck under the
gunwale closes the hull from above.

The hull is a surface S(th, v): `v` a strake height at the wall, `th` a quarter turn from the wall
(0) to the stem (pi/2), a half ellipse in plan whose breadth B(v) makes a U in section, and a sheer
that lifts every strake SH towards the stem. Every plank is lofted through that surface along its
own normal, so a plank, a rail or a plate is laid ON the hull rather than approximated.

Frame: the front (the stem) faces +z; the back is the plane z = -DEPTH/2 and nothing lies behind
it (it stands against the wall, and it is open: the wall is its back); centred on x; the stem's
foot is y = 0 and nothing is lower. GUNWALE_Y is the top of the gunwale cap at the wall (the sheer
lifts it SH at the stem), STEM the middle of the stem's front face just under the gunwale, where a
figurehead is to be bolted on.
"""
import math
import bmesh
from mathutils import Matrix, Vector
from geom import (PI, emit, frame, box, disc, ball, hull, tube, torus, material, rng,
                  DARK, IRON, BRASS, BLACK, ROPE, RIB)

ASSET = 'civic_kraken_bow'

DEPTH = 1.4
ZB = -DEPTH / 2              # the wall, and the back of every plank that reaches it
V0, VT = .2, 1.46            # the lowest strake's foot, the planking's top (at the wall)
NS = 10                      # strakes
H = (VT - V0) / NS
SH = .07                     # the sheer: how much the top rises towards the stem
HALF = .68                   # the half breadth at the planking's top
EXP = .9                     # the plan: cos**EXP, a round bow a little fuller than an ellipse
T, D, C, G, LAP = .022, .01, .006, .004, .014   # plank thickness, lap, bevel, seam, overlap behind
GH, BH = .032, .13           # the gunwale cap's thickness, the balusters' height
GUNWALE_Y = VT + GH
TEAL_K = 7                   # the painted strake; the rubbing rail runs along its top

PLANKS = [material('plankZ:bow-a', 0x7a5634), material('plankZ:bow-b', 0x6d4c2e),
          material('plankZ:bow-c', 0x83603a), material('plankZ:bow-d', 0x664628)]
TEAL = [material('plain:bow-teal', 0x3f6d69), material('plain:bow-teal-worn', 0x4b7770)]
STEMW = material('plain:bow-stem', 0x6f4e2f)
RAIL = material('plankZ:bow-rail', 0x33231a)
BALUSTER = material('plain:bow-baluster', 0x3d2a1c)
DECK = material('plankZ:bow-deck', 0x5a3c25)
STRAP = material('plain:strap', 0x5b5d61)       # the counter's iron: the same ship's fittings

# The stem's middle line in the yz plane, (y, z), from its foot to the snapped-off tip.
STEM_CTRL = [(0.0, .335), (.3, .365), (.7, .415), (1.1, .495), (1.5, .605), (1.72, .695), (1.92, .825), (2.06, .955)]
YG = VT + SH                 # the planking's top at the stem
YTIP = STEM_CTRL[-1][0]


def catmull(ctrl, n):
    """n points on a Catmull-Rom curve through the control points, ends included."""
    P = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    for i in range(n):
        u = i / (n - 1) * (len(ctrl) - 1)
        k = min(int(u), len(ctrl) - 2)
        t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(tuple(.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


_STEM = catmull(STEM_CTRL, 241)


def zc(y):
    """The stem's middle line: z at height y (straight on past either end)."""
    if y <= _STEM[0][0]:
        (y0, z0), (y1, z1) = _STEM[0], _STEM[1]
    elif y >= _STEM[-1][0]:
        (y0, z0), (y1, z1) = _STEM[-2], _STEM[-1]
    else:
        k = next(i for i in range(1, len(_STEM)) if _STEM[i][0] >= y)
        (y0, z0), (y1, z1) = _STEM[k - 1], _STEM[k]
    return z0 + (z1 - z0) * (y - y0) / (y1 - y0)


def stem_size(y):
    """Half the stem's width (x) and half its depth (fore and aft) at height y: massive up to the
    gunwale, then tapering to the snapped point."""
    if y <= YG:
        k = max(0.0, y) / YG
        return .102 - .014 * k, .1 - .01 * k
    k = min(1.0, (y - YG) / (YTIP - YG))
    return .088 - .056 * k ** 1.2, .09 - .06 * k ** 1.1


def stem_frame(y):
    """Middle, tangent, sideways (x) and forward unit vectors of the stem at height y."""
    e = .004
    c = Vector((0, y, zc(y)))
    t = Vector((0, 2 * e, zc(y + e) - zc(y - e))).normalized()
    u = Vector((1, 0, 0))
    return c, t, u, u.cross(t).normalized()


def stem_section(y, grow=0.0):
    """The stem's section as (sideways, forward): the front face narrower than the back, the way a
    stem narrows to its cutwater, every corner chamfered."""
    hx, hw = stem_size(y)
    hx, hw = hx + grow, hw + grow
    hf = hx * .72
    c = min(.016, hf * .4)
    return [(-hx, -hw + c), (-hx + c, -hw), (hx - c, -hw), (hx, -hw + c),
            (hf, hw - c), (hf - c, hw), (-hf + c, hw), (-hf, hw - c)]


def stem_ring(y, grow=0.0):
    c, t, u, w = stem_frame(y)
    return [c + u * a + w * b for a, b in stem_section(y, grow)]


def _stem_mount():
    y = YG - .1
    c, t, u, w = stem_frame(y)
    p = c + w * stem_size(y)[1]
    return (0.0, round(p.y, 3), round(p.z, 3))


STEM = _stem_mount()


# ---- the hull surface -----------------------------------------------------------------------------
def B(v):
    """Half breadth of the hull at strake height v: a U, narrow at the broken bottom."""
    u = min(1.0, max(0.0, (v - V0) / (VT - V0)))
    return HALF * (.14 + .86 * (1 - (1 - u) ** 2.4) ** .55)


def L(v):
    """How far a strake runs from the wall to where it ends inside the stem."""
    return zc(v + SH) - .03 - ZB


def S(th, v, sx=1):
    s, c = math.sin(th), max(0.0, math.cos(th))
    return Vector((sx * B(v) * c ** EXP, v + SH * s * s, ZB + L(v) * s))


def frame_at(th, v, sx=1):
    """The outward normal, the unit tangent along the strake and the unit tangent up the hull."""
    e = 1e-3
    a, b = max(0.0, th - e), min(PI / 2, th + e)
    dth = S(b, v, sx) - S(a, v, sx)
    dv = S(th, v + e, sx) - S(th, v - e, sx)
    n = dth.cross(dv)
    if n.dot(Vector((sx, 0, .3))) < 0:
        n = -n
    return n.normalized(), dth.normalized(), dv.normalized()


def on_hull(th, v, sx, off):
    """A frame on the hull: local y out of it, local z up it, local x along the strake."""
    n, _, tv = frame_at(th, v, sx)
    X = n.cross(tv).normalized()
    Z = X.cross(n).normalized()
    m = Matrix((X, n, Z)).transposed().to_4x4()
    m.translation = S(th, v, sx) + n * off
    return m


def pointing(p, n):
    """A frame at p with local y along n."""
    m = Vector((0, 1, 0)).rotation_difference(Vector(n).normalized()).to_matrix().to_4x4()
    m.translation = p
    return m


def loft(label, rings, mat):
    """A closed solid through rings of points (the same count each), capped at both ends by a fan
    round the ring's middle (so a ring that is not flat - a broken end - still closes)."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for A, Bv in zip(vs, vs[1:]):
        for j in range(n):
            bm.faces.new((A[j], A[(j + 1) % n], Bv[(j + 1) % n], Bv[j]))
    for ring, pts in ((vs[0], rings[0]), (vs[-1], rings[-1])):
        c = bm.verts.new(sum(pts, Vector()) / n)
        for j in range(n):
            bm.faces.new((ring[j], ring[(j + 1) % n], c))
    emit(bm, mat, label)


def wall(p):
    """Nothing behind the wall."""
    p = Vector(p)
    p.z = max(p.z, ZB)
    return p


# ---- the strakes ----------------------------------------------------------------------------------
BREAKS = {5: (0, .06), 4: (.15, .24), 3: (.29, .38), 2: (.43, .52), 1: (.56, .64), 0: (.68, .76)}
RIBS_F = (.2, .44, .68)
BUSY = {1: [], -1: []}       # (th, v, r) where a fitting is, so no nail is driven through it
STARTS = {}                  # (side, k) -> the angle a strake is broken off at (0: it reaches the wall)


def strake_rows(k):
    """A plank's section as (v, offset, is its lower edge) round the ring: out along its face from
    the lower edge (bevelled, standing D proud of the one below) to its upper edge (nearly flush)
    and on up behind the next strake, then back down its inside."""
    vk0, vk1 = V0 + k * H, V0 + (k + 1) * H
    a = vk0 + (G if k else 0)
    m = a + .6 * (vk1 - a)
    if k == NS - 1:
        return [(a, D - C, 1), (a + C, D, 1), (m, D * .4, 0), (vk1, .0015, 0), (vk1, -T, 0), (a, -T + .004, 1)]
    top = vk1 + G + LAP
    return [(a, D - C, 1), (a + C, D, 1), (m, D * .4, 0), (vk1, .0015, 0), (top, 0.0, 0), (top, -T, 0), (a, -T + .004, 1)]


def off_at(k, v):
    """How far the face of strake k stands out of the surface at height v."""
    a = V0 + k * H + (G if k else 0)
    t = min(1.0, max(0.0, (v - a) / (V0 + (k + 1) * H - a)))
    return D * (1 - t) + .0015 * t


def piece(sx, k, starts, th1, mat, jit, jag):
    rows = strake_rows(k)
    N = max(2, math.ceil((th1 - min(starts)) / (PI / 2) * 22))
    rings = []
    for i in range(N + 1):
        ring = []
        for j, (v, off, low) in enumerate(rows):
            th = starts[j] + (th1 - starts[j]) * i / N
            vv = v + (jag(i, th) if low else 0.0)
            n = frame_at(th, vv, sx)[0]
            ring.append(wall(S(th, vv, sx) + n * (off + jit)))
        rings.append(ring)
    loft('bow strake', rings, mat)


def splinter(sx, th, v, length, dv, g, width=.014):
    """A sliver of plank left hanging off a broken end, lying along the hull towards the wall (or
    down, with a negative `dv` and a short `length`), bent a little outwards."""
    tip = max(.01, th - length)
    pts = []
    for w in (-width / 2, width / 2):
        for o in (D * .5, -T * .6):
            n = frame_at(th + .01, v + w, sx)[0]
            pts.append(S(th + .01, v + w, sx) + n * o)
    mid, mv = (th + tip) / 2, v + dv * .5
    for w in (-width * .3, width * .3):
        n = frame_at(mid, mv + w, sx)[0]
        pts.append(S(mid, mv + w, sx) + n * (D * .3 + .004))
    n = frame_at(tip, v + dv, sx)[0]
    p = S(tip, v + dv, sx) + n * (g.uniform(.002, .008))
    p.y = max(p.y, .02)
    pts.append(p)
    hull('bow splinter', [wall(q) for q in pts], PLANKS[g.randrange(4)])


def strakes(sx, g):
    for k in range(NS):
        lo, hi = BREAKS.get(k, (0, 0))
        f = g.uniform(lo, hi) if hi else 0.0
        STARTS[sx, k] = 0.0 if f < .03 else f * PI / 2
    for k in range(NS):
        rows = strake_rows(k)
        th0 = STARTS[sx, k]
        # Which ring points break together: a plank's face and its inside at the same height.
        key = list(range(len(rows) - 2)) + [len(rows) - 3, 0]
        if th0:
            teeth = [g.uniform(0, .2) for _ in range(len(rows) - 2)]
            teeth[g.randrange(len(teeth))] = 0.0
            teeth[g.randrange(len(teeth))] = g.uniform(.14, .22)
            teeth[1] = teeth[0] + g.uniform(-.01, .02)
            starts = [th0 + max(0.0, teeth[key[j]]) for j in range(len(rows))]
        else:
            starts = [0.0] * len(rows)
        # A torn lower edge wherever the strake below is gone.
        below = 0.0 if k == 0 else STARTS[sx, k - 1]
        table = [g.uniform(0, .014) if i % 2 == 0 else g.uniform(.022, .05) for i in range(64)]
        whole = k > 0 and below == 0.0

        def jag(i, th, table=table, below=below, whole=whole, k=k):
            if whole or (k > 0 and th >= below):
                return 0.0
            return table[i % 64] * (1.0 if k else 1.2)

        mats = TEAL if k == TEAL_K else PLANKS
        span = PI / 2 - max(starts)
        if span > .9:
            b = max(starts) + span * g.uniform(.34, .62)
            piece(sx, k, starts, b - .004, mats[g.randrange(len(mats))], g.uniform(-.002, .002), jag)
            piece(sx, k, [b + .004] * len(rows), PI / 2, mats[g.randrange(len(mats))], g.uniform(-.002, .002),
                  lambda i, th, j=jag: j(i + 5, th))
            butt = b
        else:
            piece(sx, k, starts, PI / 2, mats[g.randrange(len(mats))], g.uniform(-.002, .002), jag)
            butt = None
        if th0 and g.random() < .75:
            j = g.randrange(len(rows) - 2)
            splinter(sx, starts[j], rows[j][0], g.uniform(.06, .16), g.uniform(-.03, .01), g)
        if not whole and g.random() < .4:
            th = g.uniform(max(th0 + .08, .05), (below if k else PI / 2 * .9) - .02)
            if th > th0 + .05:
                splinter(sx, th, V0 + k * H + .012, g.uniform(.01, .04), -g.uniform(.05, .11), g, width=.018)
        nails(sx, k, th0 + .1 if th0 else 0.0, butt, g)


def nails(sx, k, th_min, butt, g):
    """Iron heads where the planks are fastened: one at every frame (a few rusted away), a pair at
    each end of a butt, one by the stem."""
    spots = [(f * PI / 2, .5) for f in RIBS_F if g.random() < .85] + [(.88 * PI / 2, .5)]
    if butt is not None:
        spots += [(butt + s * .035, dv) for s in (-1, 1) for dv in (.28, .72)]
    for th, dv in spots:
        if th < th_min:
            continue
        v = V0 + k * H + (G if k else 0) + dv * (H - G)
        if any(abs(th - bt) < br and abs(v - bv) < br * 1.2 for bt, bv, br in BUSY[sx]):
            continue
        nail(th, v, sx, off_at(k, v) - .003)


def nail(th, v, sx, off, r=.0085):
    with frame(on_hull(th, v, sx, off)):
        disc('bow nail', (0, 0, 0), r, .008, IRON, sides=5)


# ---- inside the break: frames and the deck ------------------------------------------------------
def lowest(sx, th):
    return min(k for k in range(NS) if STARTS[sx, k] <= th)


def ribs(sx, g):
    DY = VT - .025
    for f in RIBS_F:
        th = f * PI / 2
        v_top = DY - .045 - SH * math.sin(th) ** 2
        v_bot = max(V0 - .05, V0 + lowest(sx, th) * H - g.uniform(.02, .09))
        rings = []
        n_st = 8
        for i in range(n_st + 1):
            v = v_top + (v_bot - v_top) * i / n_st
            ring = []
            for a, o in ((-.024, -T + .003), (.024, -T + .003), (.024, -T - .032), (-.024, -T - .032)):
                vv = v + (g.uniform(0, .05) if i == n_st else 0.0)
                n, tt, _ = frame_at(th, vv, sx)
                ring.append(wall(S(th, vv, sx) + tt * a + n * o))
            rings.append(ring)
        loft('bow frame', rings, RIB)


def deck():
    """A deck just under the gunwale: from above the hull is not a shell, and from below, through
    the break, its underside is the ceiling of the hold."""
    DY = VT - .025
    pts = []
    for sx in (1, -1):
        for i in range(17):
            th = PI / 2 * i / 16
            v = DY - SH * math.sin(th) ** 2
            p = S(th, v, sx) - frame_at(th, v, sx)[0] * (T - .002)
            for y in (DY, DY - .03):
                pts.append(wall((p.x, y, p.z)))
    hull('bow deck', pts, DECK)


# ---- along the top --------------------------------------------------------------------------------
def horizontal(th, v, sx):
    n = frame_at(th, v, sx)[0]
    h = Vector((n.x, 0, n.z)).normalized()
    return h, Vector((0, 1, 0))


def along_hull(th, v, sx):
    n, _, tv = frame_at(th, v, sx)
    return n, (tv - n * tv.dot(n)).normalized()


def sweep(label, sx, v, ring, mat, axes, lift=0.0, n=28, th0=0.0, th1=PI / 2):
    """A rail along a strake at height v, from th0 to th1: `ring` its section in the two axes
    `axes` gives at each point (out, up), `lift` straight up from the surface first."""
    rings = []
    for i in range(n + 1):
        th = th0 + (th1 - th0) * i / n
        base = S(th, v, sx) + Vector((0, lift, 0))
        U, W = axes(th, v, sx)
        rings.append([wall(base + U * a + W * b) for a, b in ring])
    loft(label, rings, mat)


def railing(sx, g):
    # The gunwale cap on the planking's top edge, standing out a little over the planks.
    sweep('bow gunwale', sx, VT, [(-T - .024, 0), (.02, 0), (.02, .022), (.012, GH), (-T - .024, GH)], RAIL, horizontal)
    # The cap rail over the balusters.
    sweep('bow cap rail', sx, VT, [(-.04, 0), (.012, 0), (.017, .018), (.007, .034), (-.03, .034), (-.045, .018)],
          RAIL, horizontal, lift=GH + BH)
    # Balusters, evenly by length along the gunwale, stopping short of the stem.
    pts = [S(PI / 2 * i / 200, VT, sx) for i in range(201)]
    run = [0.0]
    for a, b in zip(pts, pts[1:]):
        run.append(run[-1] + (b - a).length)
    hx = stem_size(YG)[0]
    missing = g.randrange(3, 9)
    stub = g.randrange(2, 9)
    s, i, idx = .075, 0, 0
    while True:
        while i < 200 and run[i + 1] < s:
            i += 1
        if i >= 200:
            break
        th = PI / 2 * (i + (s - run[i]) / (run[i + 1] - run[i])) / 200
        p = S(th, VT, sx)
        if abs(p.x) < hx + .04:
            break
        if idx != missing:
            h, _ = horizontal(th, VT, sx)
            tang = frame_at(th, VT, sx)[1]
            turn = math.atan2(-tang.z, tang.x)
            hgt = BH + .006 if idx != stub else BH * .45
            c = p + h * -.012 + Vector((0, GH + hgt / 2 - .003, 0))
            box('bow baluster', tuple(c), (.028, hgt, .028), BALUSTER, turn=turn,
                tilt=g.uniform(-.03, .03), roll=g.uniform(-.03, .03) + (.25 * sx if idx == stub else 0))
        s += .14
        idx += 1
    # A heavier post at the wall, where the rail was sawn through.
    p = S(0, VT, sx)
    box('bow rail post', (p.x - sx * .012, VT + (GH + BH) / 2, ZB + .02), (.036, GH + BH + .004, .04), BALUSTER)


def wale(sx):
    top = V0 + (TEAL_K + 1) * H
    sweep('bow wale', sx, top, [(-.006, -.024), (.024, -.021), (.036, -.009), (.036, .009), (.024, .021), (-.006, .024)],
          RAIL, along_hull)
    foot = V0 + TEAL_K * H + G
    sweep('bow wale moulding', sx, foot, [(-.004, -.009), (.021, -.008), (.021, .008), (-.004, .009)],
          RAIL, along_hull, n=24)


# ---- iron ------------------------------------------------------------------------------------------
def hawse(sx, f, v):
    th = f * PI / 2
    BUSY[sx].append((th, v, .09))
    with frame(on_hull(th, v, sx, 0.0)):
        disc('bow hawse', (0, 0, 0), .043, .012, BLACK, sides=10)
        torus('bow hawse rim', (0, .011, 0), .05, .011, STRAP, seg=12, sides=4)
        for k in range(4):
            a = PI / 4 + PI / 2 * k
            disc('bow hawse bolt', (.066 * math.cos(a), .004, .066 * math.sin(a)), .007, .008, IRON, sides=5)


def cleat(sx, f, v):
    th = f * PI / 2
    BUSY[sx].append((th, v, .07))
    with frame(on_hull(th, v, sx, off_at(NS - 2, v))):
        box('bow cleat', (0, .005, 0), (.11, .014, .032), STRAP, bevel=.003)
        box('bow cleat', (0, .024, 0), (.032, .03, .024), STRAP)
        hull('bow cleat horn', [(x, y, z) for x, y in ((-.08, .043), (.08, .043), (-.05, .055), (.05, .055),
                                                        (-.025, .034), (.025, .034), (0, .06)) for z in (-.011, .011)], STRAP)
        for x in (-.042, .042):
            disc('bow cleat bolt', (x, .01, 0), .006, .005, IRON, sides=5)


def eye_ring(sx, f, v, hook=False, R=.042):
    th = f * PI / 2
    BUSY[sx].append((th, v, .07))
    with frame(on_hull(th, v, sx, off_at(NS - 2, v))):
        disc('bow eye plate', (0, 0, 0), .026, .01, STRAP, sides=6)
        for k in range(3):
            a = PI / 2 + 2 * PI * k / 3
            disc('bow eye bolt', (.017 * math.cos(a), .008, .017 * math.sin(a)), .005, .005, IRON, sides=4)
        torus('bow eye', (0, .022, 0), .013, .005, STRAP, seg=6, sides=4, roll=PI / 2)
        if hook:
            tube('bow hook', [(0, .026, -.008), (0, .036, -.03), (0, .036, -.06), (0, .03, -.085), (0, .042, -.104),
                              (0, .06, -.098), (0, .066, -.078)], [.008, .008, .0075, .007, .007, .0065, .005], STRAP, sides=5)
        else:
            torus('bow ring', (0, .022, -R), R, .0065, STRAP, seg=12, sides=4)


def strap_plate(sx, th, v0, v1, w, t, label):
    """An iron strap laid over the planks up the hull, from v0 to v1, `w` wide, following the hull."""
    rings = []
    for i in range(7):
        v = v0 + (v1 - v0) * i / 6
        n, tt, _ = frame_at(th, v, sx)
        rings.append([S(th, v, sx) + tt * a + n * o for a, o in ((-w / 2, 0), (w / 2, 0), (w / 2, D + t), (-w / 2, D + t))])
    loft(label, rings, STRAP)


def hinge(sx, f):
    """The big strap hinge on the side, a crossbar near its top, a spear point below, and a heavy
    hook hanging from an eye at its foot."""
    th = f * PI / 2
    v0, v1 = V0 + 4 * H + .04, V0 + (TEAL_K) * H - .012
    BUSY[sx].append((th, (v0 + v1) / 2, .16))
    strap_plate(sx, th, v0, v1, .072, .012, 'bow hinge strap')
    n, tt, tv = frame_at(th, v0, sx)
    p = S(th, v0, sx)
    hull('bow hinge point', [p + tt * a + n * o for a in (-.036, .036) for o in (0, D + .012)]
         + [S(th, v0 - .06, sx) + frame_at(th, v0 - .06, sx)[0] * o for o in (0, D + .008)], STRAP)
    vc = v1 - .045
    rings = []
    for i in range(7):
        t2 = th - .1 + .2 * i / 6
        n2, _, tv2 = frame_at(t2, vc, sx)
        rings.append([S(t2, vc, sx) + tv2 * a + n2 * o for a, o in ((-.028, 0), (.028, 0), (.028, D + .015), (-.028, D + .015))])
    loft('bow hinge bar', rings, STRAP)
    for t2 in (th - .085, th + .085):
        nail(t2, vc, sx, D + .012, r=.009)
    for v in (v0 + .03, (v0 + vc) / 2, vc - .05):
        nail(th, v, sx, D + .01, r=.009)
    with frame(on_hull(th, v0 + .01, sx, D + .012)):
        torus('bow hinge eye', (0, .014, 0), .016, .007, STRAP, seg=6, sides=4, roll=PI / 2)
        tube('bow hinge hook', [(0, .02, -.01), (0, .036, -.04), (0, .04, -.08), (0, .034, -.12), (0, .05, -.148),
                                (0, .078, -.14), (0, .088, -.112)],
             [.012, .012, .011, .011, .01, .009, .007], STRAP, sides=6)


def small_strap(sx, f):
    th = f * PI / 2
    v0, v1 = V0 + 5 * H + .02, V0 + TEAL_K * H - .012
    BUSY[sx].append((th, (v0 + v1) / 2, .1))
    strap_plate(sx, th, v0, v1, .05, .01, 'bow chain plate')
    for v in (v0 + .03, v1 - .03):
        nail(th, v, sx, D + .008, r=.008)
    with frame(on_hull(th, v0, sx, D + .01)):
        torus('bow eye', (0, .012, 0), .014, .006, STRAP, seg=6, sides=4, roll=PI / 2)
        torus('bow ring', (0, .016, -.05), .048, .007, STRAP, seg=12, sides=4)


# ---- the stem --------------------------------------------------------------------------------------
def stem(g):
    ys = [0.0] + [YTIP * (i / 22) ** .95 for i in range(1, 23)]
    rings = [stem_ring(y) for y in ys]
    # The foot, broken off across, never under y = 0.
    for p in rings[0]:
        p.y = g.uniform(0, .035)
    rings[0][g.randrange(8)].y = 0.0
    rings[0][0].y = 0.0
    # The head, snapped: every corner of the last section broken at another length, the front ones
    # furthest, so it ends in a ragged point raking forward.
    c, t, u, w = stem_frame(YTIP)
    last = rings[-1]
    for j, p in enumerate(last):
        front = stem_section(YTIP)[j][1] > 0
        last[j] = p + t * (g.uniform(.1, .2) if front else g.uniform(0, .05))
    loft('bow stem', rings, STEMW)
    tip = sum(last, Vector()) / 8
    for k in range(3):
        a = g.uniform(-.02, .02)
        q = last[g.randrange(8)]
        hull('bow stem splinter', [q, q + u * .012, q + w * .012 - t * .03, q - w * .01 - t * .02,
                                   tip.lerp(q, .6) + t * g.uniform(.06, .14) + u * a], STEMW)
    # An iron band round the head and a brass fitting on either side below it.
    for yb, grow in ((YG + .3, .006), (YG + .38, .005)):
        hull('bow stem band', stem_ring(yb - .02, grow) + stem_ring(yb + .02, grow), STRAP)
        c, t, u, w = stem_frame(yb)
        hx, hw = stem_size(yb)
        for sx in (-1, 1):
            for b in (-hw * .5, hw * .4):
                with frame(pointing(c + u * sx * (hx + grow) + w * b, u * sx)):
                    disc('bow stem bolt', (0, 0, 0), .008, .008, IRON, sides=5)
    yb = YG + .13
    c, t, u, w = stem_frame(yb)
    hx, hw = stem_size(yb)
    for sx in (-1, 1):
        with frame(pointing(c + u * sx * hx - w * hw * .2, u * sx)):
            disc('bow stem rosette', (0, 0, 0), .036, .01, BRASS, sides=10)
            disc('bow stem rosette', (0, .008, 0), .024, .008, BRASS, sides=8, top=.018)
            ball('bow stem boss', (0, .018, 0), .011, BRASS, seg=6, rings=3)
            torus('bow stem ring', (0, .014, -.046), .036, .0065, BRASS, seg=12, sides=4)
    # Iron bolt heads down the stem's sides, where the planks come in.
    for i in range(9):
        y = V0 + SH + .06 + i * H
        c, t, u, w = stem_frame(y)
        hx, hw = stem_size(y)
        for sx in (-1, 1):
            with frame(pointing(c + u * sx * hx + w * hw * .15, u * sx)):
                disc('bow stem bolt', (0, 0, 0), .009, .007, IRON, sides=5)
    lashing(g)


def lashing(g):
    """Rope lashed round the stem's foot, turn over turn, and an end hanging out of it."""
    for k, y in enumerate((.075, .1, .125, .15, .175)):
        c, t, u, w = stem_frame(y)
        sec = stem_section(y, .011)
        # Once round the section's corners and their midpoints, climbing a turn's width as it goes,
        # and a little past the start so the two ends are buried in each other.
        ring = []
        for i in range(19):
            a0, b0 = sec[(i // 2) % 8]
            a1, b1 = sec[(i // 2 + 1) % 8]
            h = .5 if i % 2 else 0.0
            a, b = a0 + (a1 - a0) * h, b0 + (b1 - b0) * h
            ring.append(c + u * a + w * b + t * (.022 * (i / 18 - .5) + g.uniform(-.002, .002)))
        tube('bow lashing', ring, .0125, ROPE, sides=4)
    c, t, u, w = stem_frame(.14)
    hx, hw = stem_size(.14)
    s = c + u * (hx + .02) + w * hw * .6
    tube('bow lashing end', [s, s + Vector((.02, -.02, .015)), s + Vector((.03, -.06, .03)),
                             s + Vector((.026, -.1, .036)), s + Vector((.03, -.12, .034))],
         [.012, .012, .011, .01, .008], ROPE, sides=4)


def build():
    g = rng(2604)
    BUSY[1].clear()
    BUSY[-1].clear()
    # The fittings first, so the nails know where not to go.
    hawse(1, .27, V0 + 6.5 * H)
    hawse(1, .47, V0 + 6.5 * H)
    hinge(1, .7)
    cleat(1, .36, V0 + 9.35 * H)
    eye_ring(1, .6, V0 + 9.3 * H, hook=True)
    eye_ring(1, .82, V0 + 9.3 * H)
    hawse(-1, .32, V0 + 6.5 * H)
    hawse(-1, .54, V0 + 6.5 * H)
    small_strap(-1, .74)
    cleat(-1, .5, V0 + 9.35 * H)
    eye_ring(-1, .24, V0 + 9.3 * H, hook=True)
    eye_ring(-1, .8, V0 + 9.3 * H, R=.036)
    for sx in (1, -1):
        strakes(sx, g)
        ribs(sx, g)
        railing(sx, g)
        wale(sx)
    deck()
    stem(g)
