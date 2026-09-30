"""The hall's frames: its roof trusses and the ship's ribs along its walls (the keeper's spant.jpg and
ribben.jpg). A truss is a king-post truss of rough, adzed honey-brown timber - a heavy tie beam, two
rafters to the ridge, a king post and two struts - wrapped in black iron straps with brass rivets at
every joint, a brass shoe on each rafter's foot, and on a few of them a lantern hung from the tie beam
or a hank of rope thrown over it. A rib is one of a wrecked ship's frames stood against a wall: a thick
timber from the sill (or the floor) up the wall and bent over in a knee under a tie beam, cracked and
chipped, iron-banded, painted blue-green low down where the ship's bottom was, and on some of them the
foot broken off and splintered. Two ribs meeting at their heads are the arch on each gable.

Every piece of these is a different size in the hall (web/js/kraken-layout.js: TRUSSES, EAVES, TOP,
HALL), so like deck.py this is a set of functions for the hall to call (scripts/krakenroom/shell.py) and
one showcase as the kit's asset:

    truss(z, x0, x1, eaves_y, ridge_y, seed=0, lantern=False, rope=False)
    rib(axis, plane, inward, u, y0, top, seed=0, broken=False, tie=None)
    rib_arch(axis, plane, inward, a, y0, crown, seed=0, broken=None, ceiling=None)

They mean what the shell's own `truss(zt)`, `wall_rib(...)` and `gable_arch(...)` meant, measured the
same way, so the shell can swap them in (see each docstring for the call). All of them emit through
geom's buckets, so the caller's group() (the roof's lid) applies.

The measurements every roof piece hangs on are the shell's: the tie beam's underside on `eaves_y`, and
the roof boards' underside on the line from `eaves_y + lift` over the walls to `ridge_y` over the ridge
(shell.py's roof_y, ROOF_LIFT). The rafters' top faces lie `purlin` under that line, where the purlins
sit, and the king post stops `ridge_beam` under `ridge_y`, under the ridge beam. None of it is ever
above that line, so the shell's boards, purlins and ridge beam sit on it as they sat on the old one.

Frame: room coordinates (x east, y up, z south). A truss stands across the hall in the plane z; a rib
stands in the plane square to its wall at `u` along it, `wpt`'s (u, y, d) with d into the room; an arch
lies in its wall's plane. Timber grain follows the sheets as in deck.py: a piece lying in a plane that
holds world x is `plank:`, one in a plane that holds z `plankZ:`; iron, brass, paint and rope `plain:`.

How the timber is made (`_hew`): a squared section with its arrises chamfered, eight corners a ring,
rings along the timber's line; every face of every ring set in or out a few millimetres and every
chamfer a different width, which with flat shading is what an adze leaves. A chip out of an arris is a
ring where one chamfer is cut deep, between two ordinary ones; a crack a dark sliver let into a face.
The straps are bands round the section (and round two timbers where they meet), the rivets small
pyramids on them - the counter's and the deck's strap language.
"""
import math
import bmesh
from mathutils import Vector
from geom import (TAU, PI, IRON, BRASS, ROPE, WAX, material, emit, hull, box, span, tube, torus, lathe, rod,
                  ball, flame, rng)

ASSET = 'civic_kraken_frames'

# ---- colours ---------------------------------------------------------------------------------
# Honey-brown, the reference's, a shade under the galleries' deck planks (deck.py) so that the frames
# read as the older, heavier timber of the two.
TONES = [('kframe-a', 0x8a5e34), ('kframe-b', 0x7c522f), ('kframe-c', 0x96683c), ('kframe-d', 0x70482a)]
GAPM = material('plain:kdeck-gap', 0x1a120c)          # deck.py's: what a crack shows
PAINT = material('plain:kdeck-paint', 0x4f7c73)       # deck.py's blue-green band, and its worn one
PAINT2 = material('plain:kdeck-paint-worn', 0x6b8a7f)
SPLINTER = material('plain:splinter', 0xa07c52)       # the raw wood where it broke

# ---- the numbers, at k = 1 (the hall's sizes) -------------------------------------------------
LIFT, PURLIN, RIDGE_BEAM, PAST = .34, .14, .32, .1    # shell.py ROOF_LIFT, its purlins' depth, ridge beam
TIE_D, TIE_W = .24, .11                               # the tie beam: shell.py TIE_D, half its width
RAF_D, RAF_W = .22, .07                               # a rafter's depth (square to it) and half width
KING_W = .08                                          # half the king post
STRUT_D, STRUT_W = .12, .05                           # a strut
STRUT_AT = .4                                         # where a strut meets its rafter, of the half span
RIB_W, RIB_T = .14, .13                               # a wall rib: across its bend, along the wall
RIB_R, RIB_REACH, RIB_FLARE = .36, .45, .15           # its knee's radius, its reach under the beam, its foot
ARCH_W = .16                                          # a gable rib across its bend
CH, JIT = .014, .006                                  # an arris's chamfer; how much a hewn face wanders
STRAP_T = .01                                         # strap iron's thickness


def sheet(axis, tone):
    """A timber colour on the sheet whose grain runs along world `axis`."""
    name, hex = tone
    return material(f'{"plank" if axis == "x" else "plankZ"}:{name}', hex)


# ---- a timber --------------------------------------------------------------------------------
class Timber:
    """A squared timber along a polyline lying in one plane (normal `side`): its section is `ext` =
    (u0, u1, v0, v1) about the line, u along U = side x tangent (across the bend), v along V = side
    (across the plane). `ext` may be a function of the distance along the line. `plumb` cuts every
    section in a vertical plane instead of square to the line, u then still measured square to it
    (a rafter, whose ends are a plumb cut at the ridge and a seat on the tie beam)."""

    def __init__(self, pts, side, ext, plumb=False):
        self.P = [Vector(p) for p in pts]
        self.side = Vector(side).normalized()
        self.cum = [0.0]
        for a, b in zip(self.P, self.P[1:]):
            self.cum.append(self.cum[-1] + (b - a).length)
        self.L = self.cum[-1]
        self.ext = ext
        self.plumb = plumb

    def _seg(self, k):
        return (self.P[k + 1] - self.P[k]).normalized()

    def frame(self, s):
        s = min(max(s, 0.0), self.L)
        n = len(self.P)
        k = 0
        while k < n - 2 and self.cum[k + 1] <= s - 1e-9:
            k += 1
        ln = self.cum[k + 1] - self.cum[k]
        t = (s - self.cum[k]) / ln if ln > 1e-9 else 0.0
        p = self.P[k].lerp(self.P[k + 1], t)
        T = self._seg(k)
        # at a corner of the line the section is the mitre between its two segments
        if t < 1e-6 and k > 0:
            T = (self._seg(k - 1) + T).normalized()
        elif t > 1 - 1e-6 and k < n - 2:
            T = (T + self._seg(k + 1)).normalized()
        U = self.side.cross(T).normalized()
        e = self.ext(s) if callable(self.ext) else self.ext
        if self.plumb:
            c = U.y
            U = Vector((0, 1 if c > 0 else -1, 0))
            e = (e[0] / abs(c), e[1] / abs(c), e[2], e[3])
        return p, T, U, self.side, e

    def face(self, s, name):
        """A face of the timber at s: (line point, tangent, outward normal, offset, lateral axis,
        lateral range); its surface is point + normal * offset + lateral * a."""
        p, T, U, V, (u0, u1, v0, v1) = self.frame(s)
        return {'U+': (p, T, U, u1, V, (v0, v1)), 'U-': (p, T, -U, -u0, V, (v0, v1)),
                'V+': (p, T, V, v1, U, (u0, u1)), 'V-': (p, T, -V, -v0, U, (u0, u1))}[name]

    def s_near(self, q):
        """The distance along the line of its point nearest q."""
        q = Vector(q)
        best, bs = 1e9, 0.0
        for k in range(len(self.P) - 1):
            a, b = self.P[k], self.P[k + 1]
            d = b - a
            t = min(1.0, max(0.0, (q - a).dot(d) / max(d.length_squared, 1e-12)))
            dist = (a + d * t - q).length
            if dist < best:
                best, bs = dist, self.cum[k] + (self.cum[k + 1] - self.cum[k]) * t
        return bs


def _stations(tb, g, base, k, s0=0.0, s1=None, dents=0, room=None):
    """Where the rings go: the `base` distances (the line's own corners, or even steps) between s0 and
    s1, and for each chip three more - either side of it and the chip itself, whose ring has one
    chamfer cut deep. Returns [(s, [(corner, depth)])]."""
    s1 = tb.L if s1 is None else s1
    out = {round(s, 6): [] for s in base if s0 - 1e-6 <= s <= s1 + 1e-6}
    out.setdefault(round(s0, 6), [])
    out.setdefault(round(s1, 6), [])
    w = .05 * k
    for _ in range(dents):
        for _try in range(8):
            s = g.uniform(s0 + .12 * (s1 - s0), s1 - .12 * (s1 - s0))
            if room is not None and not room(s):
                continue
            if all(abs(s - q) > w * 1.3 for q in out):
                out[round(s - w, 6)] = []
                out[round(s, 6)] = [(g.randrange(4), g.uniform(.018, .034) * k)]
                out[round(s + w, 6)] = []
                break
    return sorted(out.items())


def _even(L, step):
    n = max(1, math.ceil(L / step))
    return [L * i / n for i in range(n + 1)]


def _hew(tb, label, mat, g, stations, k, jag=None, floor=None, chamfer=None, jit=None):
    """The timber `tb` as a closed solid through `stations` (see _stations). `jag` = ('start' or
    'end', length) tears that end: its ring pulled about along the line and the end drawn to a ragged
    point. `floor` keeps every corner on or over that height, and lays a whole foot flat on it."""
    ch = CH * k if chamfer is None else chamfer
    jt = JIT * k if jit is None else jit
    bm = bmesh.new()
    rings = []
    n = len(stations)
    for i, (s, dents) in enumerate(stations):
        p, T, U, V, (u0, u1, v0, v1) = tb.frame(s)
        e = [g.uniform(-jt, jt) for _ in range(4)]
        u1_, v1_, u0_, v0_ = u1 + e[0], v1 + e[1], u0 - e[2], v0 - e[3]
        lim = .4 * min(u1 - u0, v1 - v0)
        cs = [min(lim, ch * g.uniform(.5, 1.6)) for _ in range(4)]
        for corner, depth in dents:
            cs[corner] = min(lim * 1.15, cs[corner] + depth)
        # corners: 0 (+U+V), 1 (-U+V), 2 (-U-V), 3 (+U-V)
        oc = [(u1_, v0_ + cs[3]), (u1_, v1_ - cs[0]), (u1_ - cs[0], v1_), (u0_ + cs[1], v1_),
              (u0_, v1_ - cs[1]), (u0_, v0_ + cs[2]), (u0_ + cs[2], v0_), (u1_ - cs[3], v0_)]
        tear = jag is not None and ((jag[0] == 'start' and i == 0) or (jag[0] == 'end' and i == n - 1))
        out = -T if i == 0 else T
        ring = []
        for a, b in oc:
            q = p + U * a + V * b + T * g.uniform(-jt, jt) * .5
            if tear:
                q += out * g.uniform(-.35, 1.0) * jag[1]
            if floor is not None:
                q.y = floor if (i == 0 and not tear) else max(q.y, floor)
            ring.append(bm.verts.new(q))
        rings.append((ring, p, out, tear))
    for (A, *_), (B, *_) in zip(rings, rings[1:]):
        for j in range(8):
            bm.faces.new((A[j], A[(j + 1) % 8], B[(j + 1) % 8], B[j]))
    for ring, p, out, tear in (rings[0], rings[-1]):
        if tear:
            c = p + out * jag[1] * 1.25
            if floor is not None:
                c.y = max(c.y, floor)
            cv = bm.verts.new(c)
            for j in range(8):
                bm.faces.new((ring[j], ring[(j + 1) % 8], cv))
        else:
            bm.faces.new(ring)
    emit(bm, mat, label)


def _rivet(c, N, A, T, r, mat=BRASS):
    """A rivet head: a three-sided pyramid (four triangles; at the distance a rivet is seen from, the
    square one's two more bought nothing)."""
    base = [c + (A * math.cos(a) + T * math.sin(a)) * r - N * .002 for a in (PI / 2, PI / 2 + TAU / 3, PI / 2 + 2 * TAU / 3)]
    hull('frame rivet', base + [c + N * r * .85], mat)


def _band(tb, s, width, k, mat=IRON, proud=None, rivets=(), rmat=BRASS, skip=None, label='frame strap'):
    """A strap round the timber at s, `width` along it, standing `proud` of its faces (over their
    wander), its rivets on the faces named in `rivets` as {face: how many across}; `skip` the way into
    the room, so that the face turned from it (the one on the wall) gets none."""
    proud = (JIT + STRAP_T) * k if proud is None else proud
    s0, s1 = max(0.0, s - width / 2), min(tb.L, s + width / 2)

    def rect(ss, off):
        p, T, U, V, (u0, u1, v0, v1) = tb.frame(ss)
        return [p + U * a + V * b for a, b in ((u1 + off, v1 + off), (u0 - off, v1 + off), (u0 - off, v0 - off), (u1 + off, v0 - off))]

    bm = bmesh.new()
    A, B = [bm.verts.new(q) for q in rect(s0, proud)], [bm.verts.new(q) for q in rect(s1, proud)]
    C, D = [bm.verts.new(q) for q in rect(s1, -.012 * k)], [bm.verts.new(q) for q in rect(s0, -.012 * k)]
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((A[i], A[j], B[j], B[i]))
        bm.faces.new((D[i], C[i], C[j], D[j]))
        bm.faces.new((B[i], B[j], C[j], C[i]))
        bm.faces.new((A[i], D[i], D[j], A[j]))
    emit(bm, mat, label)
    r = min(.22 * (s1 - s0), .011 * k)
    for name, count in (rivets.items() if isinstance(rivets, dict) else ((f, 1) for f in rivets)):
        p, T, N, off, Ax, (a0, a1) = tb.face(s, name)
        if skip is not None and N.dot(Vector(skip)) < -.5:
            continue
        for q in range(count):
            a = (a0 + a1) / 2 + ((q + .5) / count - .5) * (a1 - a0) * .8
            _rivet(p + N * (off + proud) + Ax * a, N, Ax, T, r, rmat)


def _strip(tb, s0, s1, name, width, k, mat=IRON, label='frame strap'):
    """A flat strap laid along one face from s0 to s1."""
    pts = []
    for ss in (s0, s1):
        p, T, N, off, A, (a0, a1) = tb.face(ss, name)
        c = p + N * off + A * (a0 + a1) / 2
        for sd in (-1, 1):
            for o in (-.003 * k, (JIT + STRAP_T) * k):
                pts.append(c + A * sd * width / 2 + N * o)
    hull(label, pts, mat)
    return pts


def _crack(tb, s, l, name, q, k, g):
    """A split along the grain: a dark sliver let into a face, widest in its middle."""
    pts = []
    w = g.uniform(.008, .014) * k
    for ss, mid in ((s - l / 2, False), (s, True), (s + l / 2, False)):
        p, T, N, off, A, (a0, a1) = tb.face(ss, name)
        c = p + N * off + A * ((a0 + a1) / 2 + q * (a1 - a0) * .32)
        if mid:
            pts += [c + A * sd * w / 2 + N * (JIT + .0015) * k for sd in (-1, 1)] + [c - N * .012 * k]
        else:
            pts.append(c + N * (JIT + .0015) * k)
    hull('frame crack', pts, GAPM)


def _cracks(tb, g, k, n, faces, s0=0.0, s1=None, lmax=.35):
    s1 = tb.L if s1 is None else s1
    for _ in range(n):
        l = min(g.uniform(.12, lmax) * k, .6 * (s1 - s0))
        s = g.uniform(s0 + l / 2 + .02, s1 - l / 2 - .02)
        _crack(tb, s, l, g.choice(faces), g.uniform(-1, 1), k, g)


def _splinters(tb, s, g, k, n, down, floor, tone):
    """Shards standing out of a torn end towards `down`, their tips on `floor`."""
    p, T, U, V, (u0, u1, v0, v1) = tb.frame(s)
    for i in range(n):
        a = g.uniform(u0 * .8, u1 * .8)
        b = g.uniform(v0 * .8, v1 * .8)
        c = p + U * a + V * b
        wa, wb = (u1 - u0) * g.uniform(.16, .28), (v1 - v0) * g.uniform(.14, .26)
        base = [c + U * da + V * db for da, db in ((-wa, -wb), (wa, -wb), (wa, wb), (-wa, wb))]
        tip = c + Vector(down) * g.uniform(.5, 1.0) * .14 * k + U * g.uniform(-.03, .03) * k
        if floor is not None:
            tip.y = max(floor, tip.y) if i else floor
            base = [Vector((q.x, max(q.y, floor + .01 * k), q.z)) for q in base]
        hull('frame splinter', base + [tip], g.choice((SPLINTER, tone)))


# ---- the truss -------------------------------------------------------------------------------
def truss(z, x0, x1, eaves_y, ridge_y, seed=0, lantern=False, rope=False, k=1.0, lift=None, purlin=None,
          ridge_beam=None, past=None, ends=False, ridge_stub=0.0):
    """A king-post truss across the hall in the plane z, the walls at x0 (west) and x1 (east), the
    ridge over x = 0 - shell.py's `truss(zt)` is `truss(zt, HALL.x0, HALL.x1, EAVES, TOP)`:

      the tie beam from x0 - past to x1 + past, its underside on eaves_y, TIE_D deep, TIE_W each side;
      two rafters, their top faces `purlin` under the boards' underside - the line from eaves_y + lift
        over each wall to ridge_y over the ridge (shell.py roof_y) - from the king post down to where
        they come to rest on the tie beam, plumb-cut at the top;
      the king post from the tie beam up to ridge_y - ridge_beam, under the ridge beam;
      two struts from the king post's foot to the rafters at STRUT_AT of the half span;
      iron straps round every joint, brass rivets, a brass shoe on each rafter's foot.

    `lantern` hangs a lantern under the tie beam (True: at 0.3 of the east half span, or an x); `rope`
    throws a hank of rope over it (True: at 0.45 of the west half span, or an x). `k` scales every
    timber, strap and fitting (not the spans): the showcase is a small truss. `ends` sheathes the tie
    beam's ends in brass, for a truss whose ends are not in a wall. `ridge_stub` draws that length of
    ridge beam on the king post, for a truss seen on its own."""
    g = rng(seed * 7907 + 29)
    lift = LIFT * k if lift is None else lift
    purlin = PURLIN * k if purlin is None else purlin
    ridge_beam = RIDGE_BEAM * k if ridge_beam is None else ridge_beam
    past = PAST * k if past is None else past
    lo = eaves_y + lift
    yb, yt = eaves_y, eaves_y + TIE_D * k
    Z = Vector((0, 0, 1))
    tone = lambda: sheet('x', g.choice(TONES))

    def half(x):
        return x1 if x > 0 else -x0

    def rtop(x):
        """The rafters' top faces: the boards' underside less the purlins."""
        return lo + (ridge_y - lo) * (1 - abs(x) / half(x)) - purlin

    # The tie beam.
    tie = Timber([(x0 - past, (yb + yt) / 2, z), (x1 + past, (yb + yt) / 2, z)], Z,
                 (-TIE_D * k / 2, TIE_D * k / 2, -TIE_W * k, TIE_W * k))
    _hew(tie, 'frame tie beam', tone(), g, _stations(tie, g, _even(tie.L, 1.0 * k), k, dents=3), k)
    _cracks(tie, g, k, 4, ('V+', 'V-', 'U-'), lmax=.5)
    # The king post, from inside the tie beam up under the ridge beam.
    ytop = ridge_y - ridge_beam
    king = Timber([(0, yt - .03 * k, z), (0, ytop, z)], Z, (-KING_W * k, KING_W * k, -KING_W * k, KING_W * k))
    _hew(king, 'frame king post', tone(), g, _stations(king, g, _even(king.L, .8 * k), k, dents=1), k)
    _cracks(king, g, k, 1, ('V+', 'V-'))
    rafters, struts = {}, {}
    for s in (-1, 1):
        h = half(s)
        slope = (ridge_y - lo) / h
        cos = 1 / math.sqrt(1 + slope * slope)
        # the foot: where the top face comes down to a hand over the tie beam's top
        rest = (yt + .05 * k + purlin - lo) / (ridge_y - lo)
        xf = s * min(h + past, h * (1 - rest))
        xi = s * (KING_W * k + .008 * k)
        c = lambda x: (x, rtop(x) - RAF_D * k / 2 / cos, z)
        raf = Timber([c(xi), c(xf)], Z, (-RAF_D * k / 2, RAF_D * k / 2, -RAF_W * k, RAF_W * k), plumb=True)
        _hew(raf, 'frame rafter', tone(), g, _stations(raf, g, _even(raf.L, 1.0 * k), k, dents=2), k)
        _cracks(raf, g, k, 2, ('V+', 'V-', 'U-'))
        rafters[s] = (raf, xf)
        # The strut: from the king post's foot into the rafter's underside.
        xs = s * STRUT_AT * h
        a = Vector((s * KING_W * k * .4, yt + .06 * k, z))
        b = Vector((xs, rtop(xs) - RAF_D * k / cos, z))
        d = (b - a).normalized()
        st = Timber([a, b + d * .05 * k], Z, (-STRUT_D * k / 2, STRUT_D * k / 2, -STRUT_W * k, STRUT_W * k))
        _hew(st, 'frame strut', tone(), g, _stations(st, g, _even(st.L, 1.2 * k), k, dents=1), k)
        _cracks(st, g, k, 1, ('V+', 'V-'))
        struts[s] = (st, xs, (a - b).length)

    # ---- the ironwork
    faces = {'V+': 2, 'V-': 2}
    # the stirrup under the king post: round the tie beam, and up both faces of the post
    _band(tie, tie.s_near((0, yb, z)), .075 * k, k, rivets={'V+': 2, 'V-': 2})
    for f in ('V+', 'V-'):
        _strip(king, .02 * k, .4 * k, f, .07 * k, k)
        for q in (.16, .32):
            p, T, N, off, A, _ = king.face(q * k, f)
            _rivet(p + N * (off + (JIT + STRAP_T) * k), N, A, T, .01 * k)
    # the post's head, under where the rafters meet
    _band(king, king.L - .1 * k - RAF_D * k, .06 * k, k, rivets={'V+': 1, 'V-': 1})
    for s in (-1, 1):
        raf, xf = rafters[s]
        st, xs, sl = struts[s]
        # the rafters' heads, strapped to each other over the post
        _band(raf, .1 * k, .06 * k, k, rivets={'V+': 1, 'V-': 1})
        # the strut's head: a strap round the rafter where it lands, and one round the strut
        _band(raf, raf.s_near((xs, rtop(xs), z)), .07 * k, k, rivets={'V+': 1, 'V-': 1})
        _band(st, sl - .1 * k, .06 * k, k, rivets={'V+': 1, 'V-': 1})
        # the foot: a brass shoe on the rafter's end, and a strap round tie beam and rafter together
        _band(raf, raf.L - .14 * k, .28 * k, k, mat=BRASS, proud=(JIT + .006) * k, rivets={'V+': 2, 'V-': 2},
              rmat=IRON, label='frame shoe')
        xw = xf - s * .26 * k
        top = rtop(xw) + .004 * k
        pair = Timber([(xw - .1, (yb + top) / 2, z), (xw + .1, (yb + top) / 2, z)], Z,
                      (-(top - yb) / 2, (top - yb) / 2, -TIE_W * k, TIE_W * k))
        _band(pair, .1, .07 * k, k, rivets={'V+': 2, 'V-': 2})
        # two more round the tie beam along its length, the reference's
        _band(tie, tie.s_near((s * .62 * half(s), yb, z)), .07 * k, k, rivets={'V+': 2, 'V-': 2})
        if ends:
            e = tie.L if s > 0 else 0.0
            _band(tie, e - s * .07 * k, .14 * k, k, mat=BRASS, proud=(JIT + .006) * k, rivets=faces,
                  rmat=IRON, label='frame shoe')
            p = Vector((x1 + past if s > 0 else x0 - past, (yb + yt) / 2, z))
            span('frame shoe', p.x - .004 * k if s > 0 else p.x - .006 * k, p.x + .006 * k if s > 0 else p.x + .004 * k,
                 yb - .01 * k, yt + .01 * k, z - TIE_W * k - .01 * k, z + TIE_W * k + .01 * k, BRASS)
    if ridge_stub:
        rb = Timber([(0, ridge_y - ridge_beam / 2, z - ridge_stub / 2), (0, ridge_y - ridge_beam / 2, z + ridge_stub / 2)],
                    (1, 0, 0), (-ridge_beam / 2, ridge_beam / 2, -.09 * k, .09 * k))
        _hew(rb, 'frame ridge', sheet('z', g.choice(TONES)), g, _stations(rb, g, [0, rb.L], k), k)
    if lantern is not False:
        x = .3 * x1 if lantern is True else lantern
        hanging_lantern(x, yb, z, k, g)
    if rope is not False:
        x = .45 * x0 if rope is True else rope
        hank(x, yb, yt, z, TIE_W * k, k, g)


def hanging_lantern(x, y, z, k, g, drop=.12):
    """A ship's lantern hung from an eye under a beam whose underside is y: a brass cage with a
    candle in it, open, so that the flame - the one thing that glows - is seen."""
    torus('frame lantern eye', (x, y - .018 * k, z), .018 * k, .005 * k, IRON, seg=6, sides=3, tilt=PI / 2)
    H, w = .17 * k, .05 * k
    ytop = y - .036 * k - drop * k
    n = 4
    for i in range(n):                    # a short chain, plates turned a quarter on each other
        yy = y - .036 * k - (i + .5) * drop * k / n
        box('frame chain', (x, yy, z), (.016 * k, drop * k / n * 1.2, .005 * k) if i % 2 else
            (.005 * k, drop * k / n * 1.2, .016 * k), IRON)
    torus('frame lantern ring', (x, ytop - .012 * k, z), .014 * k, .004 * k, BRASS, seg=6, sides=3, tilt=PI / 2)
    y1 = ytop - .026 * k                  # the cap's peak
    y0 = y1 - H
    lathe('frame lantern cap', [(w * 1.15, y1 - .05 * k), (0, y1)], BRASS, sides=4, phase=PI / 4, at=(x, 0, z))
    span('frame lantern top', x - w, x + w, y1 - .062 * k, y1 - .05 * k, z - w, z + w, BRASS)
    span('frame lantern base', x - w * 1.05, x + w * 1.05, y0, y0 + .016 * k, z - w * 1.05, z + w * 1.05, BRASS)
    lathe('frame lantern foot', [(w * .5, y0), (0, y0 - .03 * k)], BRASS, sides=4, phase=PI / 4, at=(x, 0, z))
    for sx in (-1, 1):
        for sz in (-1, 1):
            span('frame lantern post', x + sx * w - .006 * k, x + sx * w + .006 * k, y0 + .016 * k, y1 - .062 * k,
                 z + sz * w - .006 * k, z + sz * w + .006 * k, BRASS)
    yc = y0 + .016 * k
    ch = g.uniform(.04, .06) * k
    rod('frame lantern candle', (x, yc, z), (x, yc + ch, z), .011 * k, WAX, top=.01 * k, sides=6)
    flame((x, yc + ch - .002 * k, z), 1.9 * k)


def hank(x, yb, yt, z, hw, k, g, loops=3):
    """A hank of rope hung over a beam (underside yb, top yt, hw each side of z): loops round the beam,
    their two sides drawn together under it by a few turns of the tail, hanging down in a teardrop,
    and the tail's end hanging out of it."""
    r = max(.007, .014 * k)
    c = hw + r
    for i in range(loops):
        L = .46 * k * g.uniform(.85, 1.12)
        dx = x + (i - (loops - 1) / 2) * r * 2.3
        lean = g.uniform(-.35, .35)
        yn = yb - .1 * k
        side = [(c * .8, yt + r * .6), (c, yt - .3 * (yt - yb)), (c, yb + .1 * (yt - yb)), (r * 1.6, yn),
                (.16 * L, yb - .5 * L), (.08 * L, yb - .9 * L)]
        zy = [(0.0, yt + r)] + side + [(0.0, yb - L)] + [(-a, b) for a, b in reversed(side)]
        pts = [(dx + lean * max(0.0, yn - y), y, z + zz * (1 + .04 * i)) for zz, y in zy]
        pts += [pts[0], pts[1]]
        tube('frame rope', pts, r, ROPE, sides=4)
    yn = yb - .1 * k
    for dy in (-.9, .9):
        torus('frame rope turn', (x, yn + dy * r, z), r * 2.9, r * .75, ROPE, seg=8, sides=3)
    tail = [(x + r * 2.4, yn - r * 2, z + r), (x + r * 2.8, yn - .12 * k, z + r * 1.5),
            (x + r * 2.2, yn - .26 * k, z + r * .5), (x + r * 3, yn - .36 * k, z)]
    tube('frame rope', tail, r * .95, ROPE, sides=4)
    ball('frame rope whipping', tail[-1], r * 1.15, ROPE, seg=5, rings=3)


# ---- the ribs --------------------------------------------------------------------------------
def _wpt(axis, plane, inward, u, y, d):
    n = plane + inward * d
    return (u, y, n) if axis == 'x' else (n, y, u)


def _scrap(at, turn, g, k, tone):
    """A broken length of plank lying at a rib's foot."""
    x, y, z = at
    l, w, t = g.uniform(.22, .32) * k, g.uniform(.08, .11) * k, .02 * k
    ca, sa = math.cos(turn), math.sin(turn)
    pts = []
    for u, v in ((-l / 2, -w / 2), (-l / 2, w / 2), (l / 2 - g.uniform(0, .06) * k, -w / 2), (l / 2, w / 2 - g.uniform(0, .04) * k),
                 (l / 2 + g.uniform(.02, .06) * k, g.uniform(-w / 3, w / 3))):
        for yy in (y, y + t):
            pts.append((x + u * ca - v * sa, yy, z + u * sa + v * ca))
    hull('frame scrap', pts, tone)
    hull('frame scrap', [(x + (l / 2 + .01 * k) * ca, y + t * .6, z + (l / 2 + .01 * k) * sa),
                         (x + (l / 2 + .09 * k) * ca, y + .002, z + (l / 2 + .09 * k) * sa),
                         (x + l / 2 * ca - .01 * k * sa, y, z + l / 2 * sa + .01 * k * ca),
                         (x + l / 2 * ca + .01 * k * sa, y, z + l / 2 * sa - .01 * k * ca)], SPLINTER)


def _paint(tb, s, k, g, flip=False):
    """The ship's blue-green bottom paint, two bands of it a little apart, worn."""
    w1, w2 = g.uniform(.11, .13) * k, g.uniform(.08, .1) * k
    gap = .016 * k
    a, b = (PAINT, PAINT2) if not flip else (PAINT2, PAINT)
    _band(tb, s, w1, k, mat=a, proud=(JIT + .004) * k, label='frame paint')
    _band(tb, s + (w1 + w2) / 2 + gap, w2, k, mat=b, proud=(JIT + .004) * k, label='frame paint')


def rib(axis, plane, inward, u, y0, top, seed=0, broken=False, k=1.0, tie=None, scrap=False, paint=True):
    """One of a ship's frames stood against the west or east wall (or any wall) at u along it - the
    shell's `wall_rib(axis, plane, inward, u)` is `rib(axis, plane, inward, u, STONE_TOP + SILL, EAVES)`:
    its foot on y0 turned out into the room as a hull's bilge turns, straight up the wall, and bent
    over in a knee RIB_R round under whatever lies on `top` (the tie beam's underside), running
    RIB_REACH on under it; RIB_W across its bend, RIB_T along the wall, its back on the wall's face.

    `broken` tears its foot off a hand above y0, splintered down to it. `tie` = (depth, half width) of
    the beam on `top` puts a strap round that beam and the rib's head together. `scrap` lays a broken
    length of plank at its foot, and a broken foot's chunk (on y0: only where there is floor). `paint`: the blue-green bands
    low on it."""
    g = rng(seed * 6151 + 11)
    hw, RK = RIB_W * k / 2, RIB_R * k
    yk = top - hw - RK
    yf = y0 + .24 * (top - y0)
    fl = RIB_FLARE * k
    path = [(hw + fl * ((yf - y) / (yf - y0)) ** 2, y) for y in [y0 + (yf - y0) * i / 3 for i in range(4)]]
    path.append((hw, (yf + yk) / 2))
    path.append((hw, yk))
    for i in range(1, 7):
        a = (PI / 2) * i / 6
        path.append((hw + RK * (1 - math.cos(a)), yk + RK * math.sin(a)))
    path.append((hw + RK + RIB_REACH * k, top - hw))
    side = (1, 0, 0) if axis == 'x' else (0, 0, 1)
    room = Vector((0, 0, inward)) if axis == 'x' else Vector((inward, 0, 0))
    tb = Timber([_wpt(axis, plane, inward, u, y, d) for d, y in path], side,
                (-hw, hw, -RIB_T * k / 2, RIB_T * k / 2))
    tone = sheet('z' if axis == 'x' else 'x', g.choice(TONES))
    base = tb.cum[:]
    s_knee = tb.cum[5]
    s0 = 0.0
    if broken:
        s0 = tb.s_near(_wpt(axis, plane, inward, u, y0 + g.uniform(.1, .14) * k, hw))
    st = _stations(tb, g, base, k, s0=s0, dents=3, room=lambda s: abs(s - s_knee) > .1 * k)
    _hew(tb, 'frame rib', tone, g, st, k, jag=('start', .07 * k) if broken else None, floor=y0)
    # which of its faces looks into the room, and which lies on the wall
    fin = 'U+' if tb.frame(tb.cum[4])[2].dot(room) > 0 else 'U-'
    _cracks(tb, g, k, 3, ('V+', 'V-', fin), s0=s0 + .1 * k, s1=s_knee)
    _cracks(tb, g, k, 1, ('V+', 'V-'), s0=s_knee, s1=tb.L, lmax=.14)
    if broken:
        _splinters(tb, s0, g, k, 4, (0, -1, 0), y0, tone)
    if broken and scrap:
        # a chunk of it lying by the foot, where there is floor to lie on
        p = Vector(_wpt(axis, plane, inward, u + g.choice((-1, 1)) * .13 * k, y0, hw + fl + .08 * k))
        hull('frame chunk', [p + Vector((g.uniform(-1, 1) * .04 * k, g.uniform(0, 1) * .05 * k, g.uniform(-1, 1) * .04 * k))
                             for _ in range(8)] + [p], g.choice((SPLINTER, tone)))
    # ironwork: a band halfway up the leg, one where it bends, one near its head
    riv = {'V+': 1, 'V-': 1, 'U+': 1, 'U-': 1}
    for s in (tb.s_near(_wpt(axis, plane, inward, u, y0 + .55 * (yk - y0), hw)), s_knee - .06 * k):
        _band(tb, s, .065 * k, k, rivets=riv, skip=room)
    if tie is None:
        _band(tb, tb.L - .12 * k, .06 * k, k, rivets={'V+': 1, 'V-': 1})
    else:
        dep, hwt = tie
        s = tb.L - .14 * k
        p, T, U, V, _ = tb.frame(s)
        yl, yh = top - RIB_W * k - .002 * k, top + dep + .002 * k
        c = Vector(p)
        c.y = (yl + yh) / 2
        pair = Timber([c - T * .1, c + T * .1], side,
                      (-(yh - yl) / 2, (yh - yl) / 2, -max(hwt, RIB_T * k / 2), max(hwt, RIB_T * k / 2)))
        _band(pair, .1, .07 * k, k, rivets={'V+': 2, 'V-': 2})
    # bolts through it into the wall
    for s in (tb.s_near(_wpt(axis, plane, inward, u, y0 + .35 * (yk - y0), hw)),
              tb.s_near(_wpt(axis, plane, inward, u, y0 + .8 * (yk - y0), hw))):
        p, T, N, off, A, _ = tb.face(s, fin)
        _rivet(p + N * off, N, A, T, .012 * k, IRON)
    if paint:
        s = tb.s_near(_wpt(axis, plane, inward, u, y0 + .3 * (yk - y0), hw))
        _paint(tb, max(s, s0 + .1 * k), k, g)
    if scrap:
        p = _wpt(axis, plane, inward, u + g.uniform(.05, .12) * k, y0, hw + fl + .2 * k)
        _scrap(p, g.uniform(0, PI), g, k, sheet('x', g.choice(TONES)))


def rib_arch(axis, plane, inward, a, y0, crown, seed=0, broken=None, k=1.0, ceiling=None, n=2.6,
             scrap=False, paint=True):
    """Two of a ship's frames stood up on a gable wall as an arch, as a hull's section stands upside
    down: their feet on y0 at a each side of the wall's middle (u = 0), meeting over it with their
    centre line at `crown`, strapped together there - the shell's `gable_arch(axis, plane, inward, a)`
    is `rib_arch(axis, plane, inward, a, STONE_TOP + SILL, roof_y(0) - .45, ceiling=roof_y)`. ARCH_W
    across the bend, RIB_T out from the wall, the back on its face. `ceiling(u)`: a height the centre
    line keeps 0.2 under. `n` squares the arch off (2 is an ellipse; the reference's legs stand
    straighter). `broken` (-1 or 1) tears off that leg's foot."""
    g = rng(seed * 4099 + 5)
    H = crown - y0
    side = (0, 0, 1) if axis == 'x' else (1, 0, 0)
    room = Vector((0, 0, inward)) if axis == 'x' else Vector((inward, 0, 0))
    d = RIB_T * k / 2
    hw = ARCH_W * k / 2
    phs = [0, .1, .22, .36, .5, .64, .78, .92, 1.06, 1.2, 1.36, PI / 2]
    tone_axis = 'x' if axis == 'x' else 'z'
    for s in (-1, 1):
        pts = []
        for ph in phs:
            uu = s * a * math.cos(ph) ** (2 / n) if ph < PI / 2 - 1e-9 else 0.0
            yy = y0 + H * math.sin(ph) ** (2 / n)
            if ceiling is not None:
                yy = min(yy, ceiling(uu) - .2 * k)
            pts.append(_wpt(axis, plane, inward, uu, yy, d))
        tb = Timber(pts, side, (-hw, hw, -d, d))
        tone = sheet(tone_axis, g.choice(TONES))
        torn = broken == s
        s0 = tb.s_near(_wpt(axis, plane, inward, s * a, y0 + g.uniform(.1, .14) * k, d)) if torn else 0.0
        _hew(tb, 'frame arch rib', tone, g, _stations(tb, g, tb.cum, k, s0=s0, dents=3), k,
             jag=('start', .07 * k) if torn else None, floor=y0)
        fin = 'V+' if Vector(side).dot(room) > 0 else 'V-'
        _cracks(tb, g, k, 3, ('U+', 'U-', fin), s0=s0 + .1 * k, s1=tb.L * .6)
        _cracks(tb, g, k, 1, ('U+', 'U-', fin), s0=tb.L * .6, s1=tb.L - .1 * k, lmax=.14)
        if torn:
            _splinters(tb, s0, g, k, 4, (0, -1, 0), y0, tone)
        if torn and scrap:
            p = Vector(_wpt(axis, plane, inward, s * (a - .12 * k), y0, d + .14 * k))
            hull('frame chunk', [p + Vector((g.uniform(-1, 1) * .04 * k, g.uniform(0, 1) * .05 * k, g.uniform(-1, 1) * .04 * k))
                                 for _ in range(8)] + [p], g.choice((SPLINTER, tone)))
        riv = {'U+': 1, 'U-': 1, fin: 1}
        for yy in (.5, .86):
            _band(tb, tb.s_near(_wpt(axis, plane, inward, s * a, y0 + yy * H, d)) if yy < .8 else tb.L * .72,
                  .065 * k, k, rivets=riv, skip=room)
        if paint:
            sp = tb.s_near(_wpt(axis, plane, inward, s * a, y0 + .2 * H, d))
            _paint(tb, max(sp, s0 + .1 * k), k, g, flip=s > 0)
        if scrap and (torn or broken is None and s > 0):
            p = _wpt(axis, plane, inward, s * (a - .25 * k), y0, d + .22 * k)
            _scrap(p, g.uniform(0, PI), g, k, sheet('x', g.choice(TONES)))
    # the strap over their heads, where they meet
    c = Vector(_wpt(axis, plane, inward, 0, crown if ceiling is None else min(crown, ceiling(0) - .2 * k), d))
    along = Vector((1, 0, 0)) if axis == 'x' else Vector((0, 0, 1))
    cap = Timber([c - along * .1, c + along * .1], side, (-hw, hw, -d, d))
    _band(cap, .1, .12 * k, k, rivets={'U+': 2, 'U-': 2, fin: 2}, skip=room)


def build():
    """A small truss like the reference's - 3.0 between its ribs, the tie beam on 1.6, the ridge 2.4
    - standing on two ribs, one with its foot broken off and a scrap of plank by it; a lantern under
    the tie beam on one side, a hank of rope over it on the other. Its lowest point is y = 0."""
    k = .45
    tie = (TIE_D * k, TIE_W * k)
    # the ribs a little heavier than the truss's own scale: in the hall a rib is RIB_W over a leg of
    # 2.7, and at 0.45 over a leg of 1.6 it read as a pipe
    rib('z', -1.5, 1, 0.0, 0.0, 1.6, seed=1, k=.65, tie=tie)
    rib('z', 1.5, -1, 0.0, 0.0, 1.6, seed=2, k=.65, tie=tie, broken=True, scrap=True)
    truss(0.0, -1.5, 1.5, 1.6, 2.4, seed=3, k=k, lantern=.55, rope=-.62, ends=True, ridge_stub=.7)
