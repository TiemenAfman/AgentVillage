"""The galleries' decks: sections cut out of broken ships (the keeper's galerijdek.jpg, not its two
alternatives). A flat deck of weathered honey-brown planks - single planks, butt joints staggered,
some short, nail heads, a crack or a knot hole here and there - on a shallow length of hull: dark
clinker strakes tumbling in underneath to a flat bottom, heavy iron straps bolted down the side, a
faded blue-green band painted along the sheer at one end. A railed edge carries the ship's own
balustrade (short turned balusters under a dark cap rail between posts), broken off before a broken
end; a broken end has its planks snapped off ragged. They stand on old mast stumps with iron bands
and a split, root-like foot.

The galleries in the hall are all different sizes (web/js/kraken-layout.js FLOORS), and a fixed mesh
stretched to each would stretch its planks, so this is a pair of functions for the hall to call
(scripts/krakenroom/shell.py) plus one showcase section as the kit's asset:

    d = deck_section(x0, x1, z0, z1, y, rail_edges=('x1',), broken_ends=('z1',), seed=0,
                     hull_depth=.35, gaps={'x1': [(-1.7, -1.0)]}, wall_edges=('x0',), along=None, band=None)
    stump_post(x, z, y0, d['under'](x, z), r=POST_R, seed=0, foot=None)

Both emit through geom's buckets, so the caller's group() applies. What walk mode walks is the
layout's rectangle at y, and that is exactly the top of the planks: nothing inside it stands above y
but nail heads a millimetre proud, and a rail stands on its RAILS line (centred RAIL_IN inside the
edge, as shell.py's rails are). A broken end's splinters stick out at most BREAK_OUT past the
rectangle, and only at or under y. The hull is outside the rectangle by at most the lap of a strake.

Frame: room coordinates (x east, y up, z south), like the hall. Inside, the section is modelled in
(u, v): u along its planks (by default its longer side), v across, from the rectangle's middle, and
mapped straight onto x/z - for planks along z that swaps the axes, which is a mirror, and every
primitive here is symmetric or a convex hull, so it does not matter. Sheets follow the grain: a
piece whose grain runs along world x is `plank:`, along z `plankZ:`, iron and paint `plain:`.
"""
import math
import bmesh
from mathutils import Vector
import geom
from geom import TAU, PI, F, IRON, DARK, BEAMX, material, emit, span, hull, lathe, disc, ball, rod, rng

ASSET = 'civic_kraken_deck'

BT = .035            # a deck plank's thickness
COVER_W = .075       # the covering board along a hull side, on the sheer
OVERHANG = .012      # how far the covering board stands out over the side
LAP = .007           # how far a strake's lower edge stands proud (clinker)
ST = .035            # a strake's thickness
RAIL_IN = .035       # the rail's middle, inside the edge
RAIL_H = .30         # the cap rail's top over the deck
BREAK_OUT = .12      # the most a splinter of a broken end sticks out past the rectangle
POW = 2.2            # the side's tumblehome: v = W/2 - inset * t^POW, vertical at the sheer

# ---- colours ---------------------------------------------------------------------------------
# Honey-brown deck planks, lighter than the hall's own floors (the reference's deck is the lightest
# thing in it), one of them sun-bleached; the hull under it dark, nearly tarred at the bottom.
DECK_TONES = [('kdeck-a', 0x8a5f37), ('kdeck-b', 0x7a5231), ('kdeck-c', 0x94693f), ('kdeck-d', 0x6e4a2c),
              ('kdeck-a', 0x8a5f37), ('kdeck-e', 0x9e7648)]
HULL_TONES = [('khull-a', 0x553a27), ('khull-b', 0x48311f), ('khull-c', 0x604230), ('khull-d', 0x4d3423)]
BOTTOM_TONES = [('khull-bottom', 0x33241a), ('khull-bottom-b', 0x3b2a1d)]
COVER_TONE = ('kdeck-cover', 0x4a3120)
CAP_TONE = ('krail-cap', 0x3b2819)
BAL = [material('plain:krail-baluster', 0x5c3e27), material('plain:krail-baluster-b', 0x684830)]
RPOST = material('plain:krail-post', 0x3e2a1b)
GAPM = material('plain:kdeck-gap', 0x1a120c)          # what a crack, a seam and a knot hole show
PAINT = material('plain:kdeck-paint', 0x4f7c73)
PAINT2 = material('plain:kdeck-paint-worn', 0x6b8a7f)
BOLT = material('plain:strap', 0x5b5d61)              # the counter's strap iron, for the bolt heads
SPLINTER = material('plain:splinter', 0xa07c52)       # the hall's raw wood where it broke
STUMP = material('plank:stump', 0x5a3d27)


def sheet(axis, tone):
    """A plank colour on the sheet whose grain runs along world `axis`."""
    name, hex = tone
    return material(f'{"plank" if axis == "x" else "plankZ"}:{name}', hex)


# ---- the section -----------------------------------------------------------------------------
class _Sec:
    """One section's frame and shape: (u, v) <-> world, the hull's profile."""

    def __init__(self, x0, x1, z0, z1, y, along, hull_depth, walls):
        self.along = along
        if along == 'x':
            self.cu, self.L, self.cv, self.W = (x0 + x1) / 2, x1 - x0, (z0 + z1) / 2, z1 - z0
            self.names = {'x0': 'u-', 'x1': 'u+', 'z0': 'v-', 'z1': 'v+'}
        else:
            self.cu, self.L, self.cv, self.W = (z0 + z1) / 2, z1 - z0, (x0 + x1) / 2, x1 - x0
            self.names = {'z0': 'u-', 'z1': 'u+', 'x0': 'v-', 'x1': 'v+'}
        self.AX = along                              # the grain of the planks and strakes
        self.CROSS = 'z' if along == 'x' else 'x'    # the grain of the end boards
        self.Y = y
        self.A, self.H = self.L / 2, self.W / 2
        self.walls = {self.names[e] for e in walls}
        self.ytop = y - .04
        self.ybot = y - hull_depth
        self.inset = min(.4 * self.H, .8 * hull_depth)
        self.vb = self.H - self.inset

    def w(self, u, y, v):
        return (self.cu + u, y, self.cv + v) if self.along == 'x' else (self.cv + v, y, self.cu + u)

    def local(self, x, z):
        return (x - self.cu, z - self.cv) if self.along == 'x' else (z - self.cu, x - self.cv)

    def vs(self, t):
        return self.H - self.inset * t ** POW

    def ys(self, t):
        return self.ytop - (self.ytop - self.ybot) * t

    def hull(self, label, pts, mat):
        hull(label, [self.w(*p) for p in pts], mat)

    def box(self, label, u0, u1, y0, y1, v0, v1, mat, bevel=0.0):
        a, b = self.w(min(u0, u1), min(y0, y1), min(v0, v1)), self.w(max(u0, u1), max(y0, y1), max(v0, v1))
        span(label, min(a[0], b[0]), max(a[0], b[0]), a[1], b[1], min(a[2], b[2]), max(a[2], b[2]), mat, bevel)

    def under(self, x, z):
        """The height of the hull's underside at (x, z): where a post under it ends."""
        u, v = self.local(x, z)
        side = 'v+' if v > 0 else 'v-'
        a = abs(v)
        if a <= self.vb or side in self.walls:
            return self.ybot
        t = min(1.0, max(0.0, (self.H - a) / self.inset)) ** (1 / POW)
        return self.ys(t)


def plank(s, label, u0, u1, v0, v1, yl, ya, yb, mat, ch=.005, e0=None, e1=None):
    """A board from u0 to u1, v0 to v1, its underside at yl and its top at ya (u0 end) and yb (u1
    end), the top narrower than the foot by `ch` all round so the seams read as grooves. `e0`/`e1`
    are (u at v0, u at v1) for an end cut on the slant (a broken end), else square."""
    a0, a1 = e0 or (u0, u0)
    b0, b1 = e1 or (u1, u1)
    c0 = 0 if e0 else ch
    c1 = 0 if e1 else ch
    s.hull(label, [(a0, yl, v0), (a1, yl, v1), (b0, yl, v0), (b1, yl, v1),
                   (a0 + c0, ya, v0 + ch), (a1 + c0, ya, v1 - ch), (b0 - c1, yb, v0 + ch), (b1 - c1, yb, v1 - ch)], mat)


def nail(s, u, v, top):
    """A nail head: a low pyramid a millimetre proud of the board it is in."""
    d = .0065
    s.hull('deck nail', [(u + du, top - .0015, v + dv) for du in (-d, d) for dv in (-d, d)] + [(u, top + .0012, v)], IRON)


def splinter(s, u, v, y, du, dy, mat, w=.012, t=.008):
    """A thin shard, triangular in section, from (u, y, v) out along u by du, dropping dy."""
    s.hull('deck splinter', [(u, y, v - w / 2), (u, y, v + w / 2), (u, y - t, v), (u + du, y - dy, v + w * .2)], mat)


def rows(g, a, b, lo=.13, hi=.17):
    """Plank widths across a..b: (v0, v1) per row."""
    out = []
    c = a
    while c < b - .02:
        wd = g.uniform(lo, hi)
        if b - (c + wd) < .07:
            wd = b - c
        out.append((c, c + wd))
        c += wd
    return out


def runs(g, A, short=.15, lo=.9, hi=2.3):
    """Butt joints along a row from -A to A: (ua, ub) pieces, first and last cut at the ends."""
    out = []
    u = -A - g.uniform(0, 1.6)
    while u < A:
        l = g.uniform(.3, .6) if g.random() < short else g.uniform(lo, hi)
        ua, ub = max(-A, u), min(A, u + l)
        if ub - ua > .05:
            out.append((ua, ub))
        u += l
    return out


def deck_top(s, g, broken):
    Y, A, H = s.Y, s.A, s.H
    yl = Y - BT
    va = -H + (0 if 'v-' in s.walls else COVER_W)
    vb_ = H - (0 if 'v+' in s.walls else COVER_W)
    beams = [-A + .35 + k * 1.1 for k in range(int((2 * A - .5) / 1.1) + 1)]
    for v0, v1 in rows(g, va, vb_):
        tone = None
        for ua, ub in runs(g, A):
            m = sheet(s.AX, g.choice(DECK_TONES))
            if m == tone:
                m = sheet(s.AX, g.choice(DECK_TONES))
            tone = m
            ya = Y - g.choice((0, 0, 0, .0015, .003))
            yb = Y - g.choice((0, 0, 0, .0015, .003))
            e0 = e1 = None
            lo_end, hi_end = ua <= -A + 1e-6, ub >= A - 1e-6
            # A broken end: each plank snapped at its own length, on the slant.
            if hi_end and 'u+' in broken:
                e1 = (A + g.uniform(-.02, .06), A + g.uniform(-.02, .06))
                yb = Y - g.uniform(.002, .006)
            if lo_end and 'u-' in broken:
                e0 = (-A - g.uniform(-.02, .06), -A - g.uniform(-.02, .06))
                ya = Y - g.uniform(.002, .006)
            pa = ua if lo_end else ua + .002
            pb = ub if hi_end else ub - .002
            # A crack: over a stretch the plank is split along its grain and the dark shows.
            if pb - pa > .6 and g.random() < .12:
                c0 = g.uniform(pa + .1, pb - .45)
                c1 = c0 + g.uniform(.2, .4)
                vm = g.uniform(v0 + .04, v1 - .04)
                t = lambda u: ya + (yb - ya) * (u - pa) / (pb - pa)
                plank(s, 'deck plank', pa, c0, v0 + .0025, v1 - .0025, yl, ya, t(c0), m, e0=e0, e1=(c0, c0))
                plank(s, 'deck plank', c0, c1, v0 + .0025, vm - .005, yl, t(c0), t(c1), m, e0=(c0, c0), e1=(c1, c1))
                plank(s, 'deck plank', c0, c1, vm + .005, v1 - .0025, yl, t(c0), t(c1), m, e0=(c0, c0), e1=(c1, c1))
                plank(s, 'deck plank', c1, pb, v0 + .0025, v1 - .0025, yl, t(c1), yb, m, e0=(c1, c1), e1=e1)
            else:
                plank(s, 'deck plank', pa, pb, v0 + .0025, v1 - .0025, yl, ya, yb, m, e0=e0, e1=e1)
            top = lambda u: ya + (yb - ya) * (u - pa) / max(pb - pa, 1e-6)
            vn = ((v0 + v1) / 2 - (v1 - v0) * .28, (v0 + v1) / 2 + (v1 - v0) * .28)
            # Nails: a pair (or what is left of it) at the far end of every plank, where it meets the
            # next, and one over every deck beam. A pair at both ends of every butt was 3000 triangles
            # on a gallery ten long, and at a gallery's distance a pair reads the same as two.
            if lo_end and 'u-' not in broken:
                for v in vn:
                    nail(s, pa + .03, v, top(pa + .03))
            if not (hi_end and 'u+' in broken):
                for v in (vn if g.random() < .6 else vn[g.randrange(2):][:1]):
                    nail(s, pb - .03, v, top(pb - .03))
            for k, u in enumerate(beams):
                if pa + .08 < u < pb - .08:
                    nail(s, u, vn[k % 2] + g.uniform(-.004, .004), top(u))
            if g.random() < .04 and pb - pa > .4:
                u = g.uniform(pa + .1, pb - .1)
                disc('deck knot', s.w(u, top(u) - .0015, g.uniform(v0 + .03, v1 - .03)), g.uniform(.008, .013), .002,
                     GAPM, sides=5)
            # Torn tips and shards on a broken end, never above the deck and never past BREAK_OUT.
            for side, e, sign in (('u+', e1, 1), ('u-', e0, -1)):
                if e is None or side not in broken:
                    continue
                ue = min(e) if sign > 0 else max(e)
                room = A + BREAK_OUT - abs(ue)
                if g.random() < .55 and room > .03:
                    vt = g.uniform(v0 + .02, v1 - .02)
                    du = sign * g.uniform(.03, min(.1, room))
                    s.hull('deck splinter', [(ue - sign * .01, yl, v0 + .003), (ue - sign * .01, yl, v1 - .003),
                                             (ue - sign * .01, Y - .005, v0 + .006), (ue - sign * .01, Y - .005, v1 - .006),
                                             (ue + du, Y - g.uniform(.012, .025), vt)], m)
                if g.random() < .3 and room > .04:
                    splinter(s, ue - sign * .01, g.uniform(v0 + .01, v1 - .01), Y - .008, sign * g.uniform(.03, room),
                             g.uniform(.005, .03), SPLINTER)


def cover_boards(s, g, broken):
    """The covering board on the sheer of each hull side: its top flush with the deck, a little over
    the side, in one or two lengths."""
    for side, sgn in (('v-', -1), ('v+', 1)):
        if side in s.walls:
            continue
        m = sheet(s.AX, COVER_TONE)
        v0, v1 = sorted((sgn * (s.H - COVER_W + .002), sgn * (s.H + OVERHANG)))
        cut = g.uniform(-.3, .3) * s.A if s.L > 3 else None
        pieces = [(-s.A, cut - .002), (cut + .002, s.A)] if cut is not None else [(-s.A, s.A)]
        for ua, ub in pieces:
            e0 = (-s.A - g.uniform(-.02, .05),) * 2 if ua <= -s.A and 'u-' in broken else None
            e1 = (s.A + g.uniform(-.02, .05),) * 2 if ub >= s.A and 'u+' in broken else None
            plank(s, 'deck cover', ua, ub, v0, v1, s.Y - .045, s.Y, s.Y, m, ch=.006, e0=e0, e1=e1)


def hull_body(s, g, broken, band_end):
    """The hull section: a dark core the seams show, clinker strakes down each side, bottom planks,
    end boards closing an end that is not broken; the painted band."""
    Y, A, H = s.Y, s.A, s.H
    n = max(3, round((s.ytop - s.ybot) / .08))
    ts = [i / n for i in range(n + 1)]
    # The core: the section, a little inside everything, from end to end.
    ce0 = -A + (.06 if 'u-' in broken else .03)
    ce1 = A - (.06 if 'u+' in broken else .03)
    sec = [(0, Y - BT + .0005)]
    for side, sgn in (('v-', -1), ('v+', 1)):
        if side in s.walls:
            sec += [(sgn * (H - .005), Y - BT + .0005), (sgn * (H - .005), s.ybot + .02)]
        else:
            sec += [(sgn * (H - .012), Y - BT + .0005)] + [(sgn * (s.vs(t) - .02), s.ys(t) + (.02 if t == 1 else 0)) for t in ts]
    s.hull('hull core', [(u, y, v) for u in (ce0, ce1) for v, y in sec], DARK)

    def ends(ragged_lo, ragged_hi, reach=.1):
        a = -A - g.uniform(-.08, reach) if ragged_lo else -A
        b = A + g.uniform(-.08, reach) if ragged_hi else A
        return a, b

    # The strakes, each a board lying on a chord of the side, its lower edge lapped over the next.
    for side, sgn in (('v-', -1), ('v+', 1)):
        if side in s.walls:
            continue
        for k in range(n):
            ta, tb = ts[k], ts[k + 1]
            oa = (s.vs(ta) + .001, s.ys(ta) - (.003 if k else 0))
            ob = (s.vs(tb) + LAP, s.ys(tb) + (.003 if k < n - 1 else 0))
            ia = (oa[0] - ST, oa[1])
            ib = (ob[0] - ST * .8, ob[1] + ST * .35)
            u = -A - g.uniform(0, 2.0)
            while u < A:
                l = g.uniform(1.4, 3.0)
                ua, ub = max(-A, u), min(A, u + l)
                lo, hi = ua <= -A + 1e-6, ub >= A - 1e-6
                if ub - ua > .1:
                    a, b = ends(lo and 'u-' in broken, hi and 'u+' in broken)
                    a = a if lo else ua + .002
                    b = b if hi else ub - .002
                    m = sheet(s.AX, g.choice(HULL_TONES))
                    s.hull('hull strake', [(uu, y, sgn * vv) for uu in (a, b) for vv, y in (oa, ob, ib, ia)], m)
                    for uu, sign, ragged in ((b, 1, hi and 'u+' in broken), (a, -1, lo and 'u-' in broken)):
                        room = A + BREAK_OUT - abs(uu)
                        if ragged and room > .03 and g.random() < .5:
                            vm = sgn * ((oa[0] + ob[0]) / 2 - .005)
                            ym = (oa[1] + ob[1]) / 2
                            s.hull('hull splinter', [(uu - sign * .01, y, sgn * vv) for vv, y in (oa, ob)]
                                   + [(uu - sign * .01, y, sgn * (vv - .02)) for vv, y in (oa, ob)]
                                   + [(uu + sign * g.uniform(.02, min(.09, room)), ym + g.uniform(-.02, .02), vm)], m)
                u += l
    # The bottom: planks along u, flat, from chine to chine.
    b0 = -H + .005 if 'v-' in s.walls else -s.vb
    b1 = H - .005 if 'v+' in s.walls else s.vb
    for v0, v1 in rows(g, b0, b1, .14, .19):
        for ua, ub in runs(g, A, short=0, lo=1.4, hi=3.0):
            lo, hi = ua <= -A + 1e-6, ub >= A - 1e-6
            a, b = ends(lo and 'u-' in broken, hi and 'u+' in broken, .06)
            a = a if lo else ua + .002
            b = b if hi else ub - .002
            s.box('hull bottom', a, b, s.ybot, s.ybot + .03, v0 + .003, v1 - .003, sheet(s.AX, g.choice(BOTTOM_TONES)))
    # End boards on a closed end: planks across, stacked, following the section.
    for side, e in (('u-', -1), ('u+', 1)):
        if side in broken:
            continue
        m_ = 4
        for j in range(m_):
            ta, tb = j / m_, (j + 1) / m_
            ya = Y - BT if j == 0 else s.ys(ta) - .002
            yb = s.ys(tb) + (0 if j == m_ - 1 else .002)
            pts = []
            for t, yy in ((ta, ya), (tb, yb)):
                for sd, sgn in (('v-', -1), ('v+', 1)):
                    vv = H - .005 if sd in s.walls else (s.vs(t) - .004 if t > 0 else H - .004)
                    pts += [(e * (A - .035), yy, sgn * vv), (e * A, yy, sgn * vv)]
            s.hull('hull end', pts, sheet(s.CROSS, g.choice(HULL_TONES)))
    # The painted band: along the sheer strake from the band end, chipped, and across its end board.
    if band_end is None:
        return
    e = 1 if band_end == 'u+' else -1
    length = min(g.uniform(.7, 1.1), .45 * s.L)
    oa, ob = (s.vs(0) + .001, s.ys(0)), (s.vs(ts[1]) + LAP, s.ys(ts[1]))
    dv, dy = ob[0] - oa[0], ob[1] - oa[1]
    ln = math.hypot(dv, dy)
    nv, ny = -dy / ln, dv / ln
    if nv < 0:
        nv, ny = -nv, -ny
    for side, sgn in (('v-', -1), ('v+', 1)):
        if side in s.walls:
            continue
        u = e * (A - .004)
        left = length
        while left > .05:
            l = min(left, g.uniform(.12, .35))
            f0, f1 = g.uniform(.05, .15), g.uniform(.75, .95) if left - l > .05 else g.uniform(.4, .7)
            p0 = (oa[0] + dv * f0, oa[1] + dy * f0)
            p1 = (oa[0] + dv * f1, oa[1] + dy * f1)
            pts = []
            for uu in (u, u - e * l):
                for vv, y in (p0, p1):
                    for o in (.0015, .005):
                        pts.append((uu, y + ny * o, sgn * (vv + nv * o)))
            s.hull('hull paint', pts, g.choice((PAINT, PAINT, PAINT2)))
            u -= e * (l + g.uniform(.015, .05))
            left -= l + .03
    if ('u+' if e > 0 else 'u-') not in broken:
        y0, y1 = Y - BT - .075, Y - BT - .012
        v = H - .03
        x = 0.0
        while x < 2 * v - .05:
            l = min(2 * v - x, g.uniform(.5, 1.1))
            if 2 * v - x - l < .12:
                l = 2 * v - x
            s.box('hull paint', e * A, e * (A + .004), y0 + g.uniform(0, .012), y1, -v + x, -v + x + l, PAINT)
            x += l + g.uniform(.03, .08)


def straps(s, g):
    """Iron straps down each hull side: over the covering board's face, down the strakes, under the
    bottom, bolted at three places."""
    Y = s.Y
    for side, sgn in (('v-', -1), ('v+', 1)):
        if side in s.walls:
            continue
        path = [(s.H + OVERHANG, Y - .006), (s.H + OVERHANG, Y - .045)]
        path += [(s.vs(t) + LAP, s.ys(t)) for t in (.08, .5, 1.0)]
        path += [(s.vb - .12, s.ybot)]
        u = -s.A + g.uniform(.2, .35)
        while u < s.A - .2:
            ribbon(s, 'hull strap', [(sgn * v, y) for v, y in path], u, g.uniform(.045, .058), .011, IRON, bolts=(1, 3, 4))
            u += g.uniform(.5, .68)


def ribbon(s, label, path, uc, w, th, mat, bolts=()):
    """A flat strip over the section `path` (v, y points) at u = uc, `w` wide, `th` thick along the
    outward normal, bolted at the points indexed by `bolts`."""
    n = len(path)
    rings = []
    norms = []
    for i, (v, y) in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, n - 1)]
        tv, ty = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(tv, ty)
        nv, ny = ty / ln, -tv / ln
        if nv * v + ny * (y - s.Y) < 0:
            nv, ny = -nv, -ny
        norms.append((nv, ny))
        rings.append([(uc - w / 2, y, v), (uc + w / 2, y, v), (uc + w / 2, y + ny * th, v + nv * th),
                      (uc - w / 2, y + ny * th, v + nv * th)])
    bm = bmesh.new()
    vs = [[bm.verts.new(s.w(*p)) for p in r] for r in rings]
    for A_, B_ in zip(vs, vs[1:]):
        for j in range(4):
            bm.faces.new((A_[j], A_[(j + 1) % 4], B_[(j + 1) % 4], B_[j]))
    bm.faces.new(vs[0])
    bm.faces.new(list(reversed(vs[-1])))
    emit(bm, mat, label)
    for i in bolts:
        if i >= n:
            continue
        v, y = path[i]
        nv, ny = norms[i]
        d = .009
        # the bolt head's square lies in the strip's plane: across u and along the path's tangent
        tv, ty = -ny, nv
        base = [(uc + du, y + ny * th + ty * dt, v + nv * th + tv * dt) for du in (-d, d) for dt in (-d, d)]
        s.hull('hull bolt', base + [(uc, y + ny * (th + .008), v + nv * (th + .008))], BOLT)


# ---- the rail --------------------------------------------------------------------------------
def rail(s, g, edge, gaps, broken, posts):
    """The ship's balustrade along one edge: posts at its ends and either side of every gap and
    at most 1.1 apart, short turned balusters under a dark cap rail on a foot rail. Where the edge
    runs into a broken end, the cap rail is snapped off short of it and only stubs stand beyond."""
    Y = s.Y
    side = edge in ('v-', 'v+')
    A_ = (s.A if side else s.H) - RAIL_IN
    c = (s.H if side else s.A) - RAIL_IN
    sgn = 1 if edge.endswith('+') else -1
    axis = s.AX if side else s.CROSS
    base = s.cu if side else s.cv

    def at(a, y, cc=0.0):
        return s.w(a, y, sgn * (c + cc)) if side else s.w(sgn * (c + cc), y, a)

    def B(label, a0, a1, y0, y1, half, mat, bevel=0.0):
        if side:
            s.box(label, a0, a1, y0, y1, sgn * c - half, sgn * c + half, mat, bevel)
        else:
            s.box(label, sgn * c - half, sgn * c + half, y0, y1, a0, a1, mat, bevel)

    cut = []
    for g0, g1 in gaps:
        a0, a1 = sorted((g0 - base, g1 - base))
        cut.append((max(a0, -A_), min(a1, A_)))
    lo_b = side and 'u-' in broken
    hi_b = side and 'u+' in broken
    spans_ = []
    a = -A_
    for g0, g1 in sorted(cut):
        if g0 > a + .05:
            spans_.append((a, g0))
        a = max(a, g1)
    if A_ > a + .05:
        spans_.append((a, A_))
    cap_m, foot_m = sheet(axis, CAP_TONE), sheet(axis, COVER_TONE)
    for k, (r0, r1) in enumerate(spans_):
        e0, e1 = lo_b and r0 <= -A_ + 1e-6, hi_b and r1 >= A_ - 1e-6
        # Where the cap rail breaks off, short of a broken end.
        c0 = r0 + g.uniform(.2, .45) if e0 else r0
        c1 = r1 - g.uniform(.2, .45) if e1 else r1
        if c1 - c0 < .1:
            c0, c1 = r0, r1
            e0 = e1 = False
        n = max(1, math.ceil((c1 - c0) / 1.1))
        ps = [c0 + (c1 - c0) * i / n for i in range(n + 1)]
        for i, pa in enumerate(ps):
            corner = (i == 0 and abs(r0) > A_ - 1e-6 and not e0) or (i == n and abs(r1) > A_ - 1e-6 and not e1)
            if (i == 0 and e0) or (i == n and e1):
                continue
            p = at(pa, Y)
            key = (round(p[0], 3), round(p[2], 3))
            posts[key] = max(posts.get(key, 0), 2 if corner else 1)
        # The foot rail, the cap rail and its moulding.
        f0 = r0 - (.03 if not e0 else -.005) - (g.uniform(0, .04) if e0 else 0)
        f1 = r1 + (.03 if not e1 else -.005) + (g.uniform(0, .04) if e1 else 0)
        B('rail foot', f0, f1, Y, Y + .03, .027, foot_m, .006)
        B('rail cap', c0 - (0 if e0 else .035), c1 + (0 if e1 else .035), Y + RAIL_H - .04, Y + RAIL_H, .035, cap_m, .01)
        B('rail moulding', c0 - (0 if e0 else .02), c1 + (0 if e1 else .02), Y + RAIL_H - .055, Y + RAIL_H - .04, .024, DARK)
        for cc, sign, broke in ((c0, -1, e0), (c1, 1, e1)):
            if broke:
                # the snapped end of the cap: torn to a point, the raw wood showing
                tip = cc + sign * g.uniform(.04, .09)
                ptsl = [(cc, Y + RAIL_H - .04, -.03), (cc, Y + RAIL_H - .04, .03), (cc, Y + RAIL_H - .004, -.03),
                        (cc, Y + RAIL_H - .004, .03), (tip, Y + RAIL_H - .025, g.uniform(-.015, .015))]
                hull('rail splinter', [at(a_, y_, q) for a_, y_, q in ptsl], SPLINTER)
        # Balusters, with a few gone or broken on these old decks; past the break only stubs.
        real = [q for i, q in enumerate(ps) if not (i == 0 and e0) and not (i == n and e1)]
        u = r0 + .08
        while u < r1 - .05:
            if all(abs(u - q) > .055 for q in real):
                past = (e0 and u < c0) or (e1 and u > c1)
                roll = g.random()
                m = g.choice(BAL)
                if past:
                    if roll < .55:
                        h = g.uniform(.04, .13)
                        rod('rail stub', at(u, Y + .03), at(u, Y + .03 + h), .014, m, top=.011, sides=5)
                        rod('rail stub', at(u, Y + .03 + h), at(u + g.uniform(-.01, .01), Y + .03 + h + .025, .004), .01, SPLINTER,
                            top=.002, sides=4)
                elif roll < .05:
                    pass
                elif roll < .1:
                    h = g.uniform(.05, .12)
                    rod('rail stub', at(u, Y + .03), at(u, Y + .03 + h), .014, m, top=.011, sides=5)
                    rod('rail stub', at(u, Y + .03 + h), at(u, Y + .03 + h + .02), .01, SPLINTER, top=.002, sides=4)
                else:
                    lathe('rail baluster', [(.012, 0), (.019, .06), (.0095, .135), (.0095, .16), (.013, RAIL_H - .085)], m,
                          at=at(u, Y + .03), sides=6, phase=g.uniform(0, 1))
            u += .12


def rail_posts(posts, Y):
    for (x, z), kind in sorted(posts.items()):
        top = Y + (RAIL_H + .06 if kind == 2 else RAIL_H + .02)
        span('rail post', x - .033, x + .033, Y - .04, top, z - .033, z + .033, RPOST, bevel=.008)
        if kind == 2:
            lathe('rail post knob', [(.028, 0), (.036, .02), (.03, .042), (0, .05)], RPOST, at=(x, top, z), sides=8)
        else:
            span('rail post cap', x - .026, x + .026, top, top + .012, z - .026, z + .026, DARK, bevel=.004)


# ---- the two functions -----------------------------------------------------------------------
def deck_section(x0, x1, z0, z1, y, rail_edges=(), broken_ends=(), seed=0, hull_depth=.35, gaps=None,
                 wall_edges=(), along=None, band=None):
    """A broken ship's deck over the rectangle x0..x1, z0..z1 with its planks' tops at y, on a hull
    section `hull_depth` deep.

    rail_edges   edges ('x0', 'x1', 'z0', 'z1') that carry the balustrade, centred RAIL_IN inside
                 the edge, its cap RAIL_H over the deck;
    gaps         {edge: [(from, to), ...]} along that edge in room coordinates (z for an x edge, x
                 for a z edge): no rail there, a post either side;
    broken_ends  edges where the deck was snapped off (splinters out to BREAK_OUT, never above y);
                 only the ends across the planks break, a broken side is taken as a plain one;
    wall_edges   edges against a wall: no hull side, no straps, no band, the deck runs to it;
    along        'x' or 'z', the planks' direction; the longer side by default;
    band         the end ('x0'...) with the painted band; None the first end that is not broken,
                 False none.

    Returns {'under': f(x, z) -> the hull's underside there (where a post ends), 'along': ...}."""
    along = along or ('x' if (x1 - x0) >= (z1 - z0) else 'z')
    s = _Sec(x0, x1, z0, z1, y, along, hull_depth, wall_edges)
    g = rng(seed * 7919 + 17)
    broken = {s.names[e] for e in broken_ends if s.names[e].startswith('u')}
    if band is None:
        band_end = next((e for e in ('u-', 'u+') if e not in broken and e not in s.walls), None)
    elif band is False:
        band_end = None
    else:
        band_end = s.names[band]
    deck_top(s, g, broken)
    cover_boards(s, g, broken)
    hull_body(s, g, broken, band_end)
    straps(s, g)
    posts = {}
    gaps = gaps or {}
    for e in rail_edges:
        le = s.names[e]
        if le in broken:
            continue
        rail(s, g, le, gaps.get(e, ()), broken, posts)
    rail_posts(posts, y)
    return {'under': s.under, 'along': along}


def stump_post(x, z, y0, y1, r=.09, seed=0, foot=None):
    """An old mast cut down to a post, from y0 up to y1 (the underside of what it carries, which is
    where its cap's top is): round and a little tapered, nine-sided and not quite regular, two or three
    iron bands, a flared foot split into roots when it stands on the ground (`foot`, by default when
    y0 is at the floor) and a square cap with two cleats under the deck."""
    g = rng(seed * 104729 + 3)
    foot = (y0 <= F + .011) if foot is None else foot
    sides = 9
    cap_h = .055
    top = y1 - cap_h
    H = top - y0
    phase = g.uniform(0, TAU)

    def rad(y):
        t = (y - y0) / max(H, 1e-6)
        rr = r * (1 - .1 * t)
        if foot:
            rr *= 1 + .22 * max(0.0, 1 - (y - y0) / .13) ** 1.6
        return rr

    lv = [y0, y0 + .05, y0 + .12, y0 + .22, y0 + H * .55, top] if foot else [y0, y0 + H * .5, top]
    lv = sorted({min(max(v, y0), top) for v in lv})
    jit = [1 + g.uniform(-.06, .06) for _ in range(sides)]
    bm = bmesh.new()
    rings = []
    for yy in lv:
        rr = rad(yy)
        rings.append([bm.verts.new((x + rr * jit[i] * math.cos(phase + TAU * i / sides), yy,
                                    z + rr * jit[i] * math.sin(phase + TAU * i / sides))) for i in range(sides)])
    for A_, B_ in zip(rings, rings[1:]):
        for i in range(sides):
            bm.faces.new((A_[i], A_[(i + 1) % sides], B_[(i + 1) % sides], B_[i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, STUMP, 'stump')
    if foot:
        # The roots: five split, spreading wedges, lower and thinner as they go out.
        n = 5
        for k in range(n):
            a = phase + TAU * (k + g.uniform(-.2, .2)) / n
            out = r * g.uniform(1.8, 2.3)
            h = g.uniform(.1, .17)
            ca, sa = math.cos(a), math.sin(a)
            px, pz = -sa, ca
            wi, wo = r * .5, r * g.uniform(.12, .18)
            ri = r * .9
            pts = [(x + ri * ca + px * wi * q, y0, z + ri * sa + pz * wi * q) for q in (-1, 1)]
            pts += [(x + ri * ca + px * wi * .7 * q, y0 + h, z + ri * sa + pz * wi * .7 * q) for q in (-1, 1)]
            mid = r * 1.4
            pts += [(x + mid * ca + px * wi * .6 * q, y0, z + mid * sa + pz * wi * .6 * q) for q in (-1, 1)]
            pts.append((x + mid * ca, y0 + h * .45, z + mid * sa))
            pts += [(x + out * ca + px * wo * q, y0, z + out * sa + pz * wo * q) for q in (-1, 1)]
            pts.append((x + out * ca, y0 + .025, z + out * sa))
            hull('stump root', pts, STUMP)
        # Splits up the flared foot: dark slivers on the grain.
        for k in range(2):
            a = phase + g.uniform(0, TAU)
            yy = y0 + .02
            rr = rad(yy) + .002
            ca, sa = math.cos(a), math.sin(a)
            hull('stump split', [(x + rr * ca - sa * .008 * q, yy, z + rr * sa + ca * .008 * q) for q in (-1, 1)]
                 + [(x + (rr - .012) * ca, yy, z + (rr - .012) * sa),
                    (x + (rad(y0 + .2) + .001) * ca, y0 + .2, z + (rad(y0 + .2) + .001) * sa)], GAPM)
    # Iron bands: over the flare, halfway, and under the cap.
    bands = ([y0 + .24] if foot else [y0 + .06]) + ([y0 + H * .55] if H > .6 else []) + [top - .07]
    for yy in bands:
        if yy + .04 > top or yy < y0:
            continue
        rr = rad(yy + .02) * 1.06 + .008
        disc('stump band', (x, yy, z), rr, .04, IRON, sides=sides, turn=-phase)
        for k in range(3):
            a = phase + TAU * (k + .5) / 3
            ball('stump rivet', (x + (rr + .002) * math.cos(a), yy + .02, z + (rr + .002) * math.sin(a)), .006, BOLT,
                 seg=4, rings=2)
    # The cap: a square block across the top, two cleats nailed to the post under it.
    w = r * 1.25
    span('stump cap', x - w, x + w, top, y1, z - w, z + w, BEAMX, bevel=.008)
    for q in (-1, 1):
        a = phase + q * PI / 2
        ca, sa = math.cos(a), math.sin(a)
        rt = rad(top) * .95
        hull('stump cleat', [(x + rt * ca - sa * .025 * p, top, z + rt * sa + ca * .025 * p) for p in (-1, 1)]
             + [(x + (rt + .04) * ca - sa * .025 * p, top, z + (rt + .04) * sa + ca * .025 * p) for p in (-1, 1)]
             + [(x + rt * ca - sa * .025 * p, top - .14, z + rt * sa + ca * .025 * p) for p in (-1, 1)], BEAMX)


def build():
    """One section like the reference: 2.0 x 1.6 at y = 0.9, the balustrade along its back, broken off
    at its east end, the band on its west end, on two stumps from the floor."""
    d = deck_section(-1.0, 1.0, -.8, .8, .9, rail_edges=('z0',), broken_ends=('x1',), seed=3)
    for x, z, seed in ((-.5, .05, 1), (.45, -.08, 2)):
        stump_post(x, z, 0.0, d['under'](x, z), seed=seed, foot=True)
