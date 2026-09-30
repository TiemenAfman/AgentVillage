"""The Salty Kraken's ways across: the gangplank from the ground up to the west landing, and the rope
bridges over the atrium to the crow's nest (the keeper's loopplank.jpg and touwbrug.jpg).

The gangplank is one long, thick, weathered plank made of three or four boards side by side, on two
stringers flush with its sides: dark iron straps across it at intervals, bolted on top and run down
both sides, some ending in a curled hook; a faded blue-green strip painted along the foot of its
sides, chipped; ragged, slanted board ends; cleats across it to stand on; square posts along one side
with a thick rope handrail through their tops; iron tongues over the landing at the top end and hooks
at both ends. The rope bridge is separate loose planks laid across, small gaps between them, an iron
clip bolted over the foot rope at each end of every plank, a patch of planks painted blue-green, a
plank broken in two, two hand lines along its sides, and short posts with iron eye rings at its ends.

Both are sized by the hall (web/js/kraken-layout.js STAIRS and FLOORS), so they are functions the hall
calls (scripts/krakenroom/shell.py), plus one showcase with one of each as the kit's asset:

    gangplank(x0, x1, z0, z1, y0, y1, axis='z', rail_side=None, seed=0, floor=None, against=None)
    rope_bridge(x0, x1, z0, z1, y, axis='x', seed=0, hangers=None, post_ends=None, post_foot=None,
                hanger_group=None)

What walk mode walks is the layout's rectangle and slope, not this mesh, so the walking surface is
exactly there: a gangplank's board tops lie on the slope from y0 at the axis's start to y1 at its end,
across the rectangle's full width (a board may sit .002 low, a ragged end stops at most END_SHORT
short of an end); nothing on it stands prouder than .026 (a cleat's CLEAT_H and the bolt heads in it,
measured; a strap is .005, its bolts .012), but the posts and their rope on the rail side. A
bridge's plank tops are at y, but for the broken plank, whose halves sag towards the break. Under a
gangplank's surface there are BT + STRINGER_D of timber; under a bridge's, PT of plank and a foot rope.

Frame: room coordinates (x east, y up, z south), like the hall. Inside, a piece is modelled in (u, y,
v): u along the axis from the rectangle's start, v across in room coordinates, mapped straight onto
x/z - for axis 'z' that swaps two axes, which is a mirror, and every primitive here is a convex hull or
a tube whose faces geom's emit turns outward, so it does not matter. Sheets follow the grain: a piece
whose grain runs along world x is `plank:`, along z `plankZ:`, iron, paint, posts and rope `plain:`.
"""
import math
import bmesh
from mathutils import Vector
import geom
from geom import PI, IRON, DARK, ROPE, material, emit, hull, tube, torus, ball, rod, rng
import deck
from deck import DECK_TONES, HULL_TONES, PAINT, PAINT2, BOLT, SPLINTER, GAPM, sheet

ASSET = 'civic_kraken_walkway'

# ---- the gangplank's measures ----------------------------------------------------------------
BT = .045            # a gangplank board's thickness (vertical)
STRINGER_D = .075    # the stringers under the boards: 0.12 of timber under the surface in all
STRINGER_W = .08
CLEAT_H = .022       # how proud a cleat stands (the brief's limit is 0.03)
CLEAT_W = .035       # a cleat's width along the plank
CLEAT_EVERY = .3
STRAP_EVERY = .6
STRAP_T = .005       # a strap's thickness; its bolts stand .007 over it
END_SHORT = .05      # the most a ragged board end stops short of the rectangle's end
POST_W = .055        # the handrail posts: square, their outer face .005 inside the edge
POST_IN = .005
RAIL_H = .30         # the handrail rope over the surface at a post
POST_H = .37         # a post's top over the surface

# ---- the rope bridge's measures --------------------------------------------------------------
PT = .04             # a bridge plank's thickness
PITCH = .2           # a plank and its gap
GAP = (.012, .02)    # between planks: small enough that it reads as a bridge
HAND_H = .30         # the hand lines over the planks at a post or a hanger
BPOST_W = .06
BPOST_IN = .004      # an end post's outer faces inside the rectangle's edges
EYE = lambda y: y + HAND_H + .03     # an end post's eye ring, where the hand line is made fast

POSTM = material('plain:kwalk-post', 0x7a5634)
POSTM2 = material('plain:kwalk-post-b', 0x6c4a2d)
CAPM = material('plain:kwalk-cap', 0x3b2819)
STRINGM = HULL_TONES
BRIDGE_TONES = [('kbridge-a', 0x7a5334), ('kbridge-b', 0x6a4529), ('kbridge-c', 0x86603c), ('kbridge-d', 0x5e3d25)]


class _Way:
    """(u, y, v) <-> world for a rectangle with u along `axis` from its start and v across it in room
    coordinates, and the surface y(u) over it."""

    def __init__(self, x0, x1, z0, z1, axis, y0, y1, floor=None):
        self.axis = axis
        if axis == 'x':
            self.a0, self.L, self.c0, self.c1 = x0, x1 - x0, z0, z1
        else:
            self.a0, self.L, self.c0, self.c1 = z0, z1 - z0, x0, x1
        self.y0, self.y1 = y0, y1
        self.k = (y1 - y0) / self.L
        self.floor = -1e9 if floor is None else floor
        self.AX = axis                              # the grain of what runs along the way
        self.CROSS = 'z' if axis == 'x' else 'x'    # the grain of what lies across it

    def w(self, u, y, v):
        return (self.a0 + u, y, v) if self.axis == 'x' else (v, y, self.a0 + u)

    def surf(self, u):
        return self.y0 + self.k * u

    def hull(self, label, pts, mat):
        hull(label, [self.w(*p) for p in _dedup(pts)], mat)

    def tube(self, label, pts, r, mat, sides=5):
        tube(label, [self.w(*p) for p in pts], r, mat, sides=sides)

    def slab(self, label, ua, ub, v0, v1, lo, hi, mat, ch=0.0, ea=None, eb=None):
        """A board over the surface: from u = ua to ub (or, cut on the slant, `ea`/`eb` = (u at v0, u at
        v1)), v0 to v1, its underside `lo` and its top `hi` off the surface (hi > lo), nothing below the
        floor. The top is narrower than the foot by `ch` all round (a square end only), so a seam reads
        as a groove."""
        a = ea or (ua, ua)
        b = eb or (ub, ub)
        ca = 0 if ea else ch
        cb = 0 if eb else ch
        if abs(self.k) > 1e-9:
            # a piece whose top would be under the floor (a stringer at the foot) stops where it meets it
            ut = (self.floor + .002 - self.y0 - hi) / self.k
            if self.k > 0:
                a = tuple(max(p, ut) for p in a)
            else:
                b = tuple(min(p, ut) for p in b)
            if min(b) - max(a) < .01:
                return
        pts = []
        for (va, vt, i) in ((v0, v0 + ch, 0), (v1, v1 - ch, 1)):
            u0, u1 = a[i], b[i]
            us = [u0, u1]
            if abs(self.k) > 1e-9:
                uc = (self.floor - self.y0 - lo) / self.k   # where the underside meets the floor
                if u0 < uc < u1:
                    us.append(uc)
            for u in us:
                pts.append((u, max(self.surf(u) + lo, self.floor), va))
            pts.append((u0 + ca, self.surf(u0 + ca) + hi, vt))
            pts.append((u1 - cb, self.surf(u1 - cb) + hi, vt))
        self.hull(label, pts, mat)


def _dedup(pts):
    out = []
    for p in pts:
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 > 1e-8 for q in out):
            out.append(p)
    return out


def bolt(way, u, v, y, d=.0075, h=.007):
    """A bolt head: a low square pyramid with its base on the slope at height `y` over it."""
    way.hull('walk bolt', [(u + du, way.surf(u + du) + y - .001, v + dv) for du in (-d, d) for dv in (-d, d)]
             + [(u, way.surf(u) + y + h, v)], BOLT)


def sag_line(pts, sag, n=5):
    """A line through `pts` ((u, y) supports) hanging `sag` times each span's length between them."""
    out = []
    for (ua, ya), (ub, yb) in zip(pts, pts[1:]):
        for j in range(n):
            t = j / n
            out.append((ua + (ub - ua) * t, ya + (yb - ya) * t - sag * (ub - ua) * math.sin(PI * t)))
    out.append(pts[-1])
    return out


# ---- the gangplank ---------------------------------------------------------------------------
def gangplank(x0, x1, z0, z1, y0, y1, axis='z', rail_side=None, seed=0, floor=None, against=None):
    """A ship's gangplank over the rectangle, its board tops on the slope from y0 at the axis's start
    (x0 or z0) to y1 at its end, across the full width.

    rail_side  the long edge ('x0'/'x1' for axis 'z', 'z0'/'z1' for axis 'x') whose posts carry the rope
               handrail; by default the far one (x1 or z1); False for none;
    floor      nothing goes below it - the foot of the boards and stringers is cut level with it;
               by default the lower of y0 and y1, where the gangplank stands;
    against    a long edge that runs along something (the hall's west gangplank along the gallery): no hook
               sticks out past it, only the straps' plates and bolts (.012). Elsewhere a hook stands .06 out.

    Returns {'under': BT + STRINGER_D, 'posts': [(x, z), ...]}."""
    way = _Way(x0, x1, z0, z1, axis, y0, y1, min(y0, y1) if floor is None else floor)
    g = rng(seed * 7907 + 11)
    L, c0, c1 = way.L, way.c0, way.c1
    W = c1 - c0
    fl = way.floor
    slope = math.hypot(L, y1 - y0)
    low_u = 0.0 if y0 < y1 else L          # the foot's end
    high_u = L - low_u
    if rail_side is None:
        rail_side = 'x1' if axis == 'z' else 'z1'
    rail_v = None if rail_side is False else (c0 if rail_side.endswith('0') else c1)
    wall_v = None if against is None else (c0 if against.endswith('0') else c1)

    # Where the underside clears the floor by `d`: straps and hooks below that would be cut off.
    def clear(d):
        if abs(way.k) < 1e-9:
            return lambda u: True
        return lambda u: way.surf(u) - BT - STRINGER_D - d >= fl

    # The boards: three or four side by side, not all as wide, their ends ragged and slanted.
    n = 4 if W >= .6 else 3
    ws = [g.uniform(.85, 1.15) for _ in range(n)]
    edges = [c0]
    for wd in ws:
        edges.append(edges[-1] + W * wd / sum(ws))
    edges[-1] = c1
    for i in range(n):
        v0, v1 = edges[i] + (0 if i == 0 else .003), edges[i + 1] - (0 if i == n - 1 else .003)
        ea = (g.uniform(0, END_SHORT), g.uniform(0, END_SHORT))
        eb = (L - g.uniform(0, END_SHORT), L - g.uniform(0, END_SHORT))
        top = g.choice((0, 0, -.002))
        m = sheet(way.AX, g.choice(DECK_TONES))
        if L > 2.5 and g.random() < .5:
            # a butt joint: the board in two lengths
            cut = g.uniform(.3, .7) * L
            way.slab('gangplank board', 0, cut - .003, v0, v1, -BT, top, m, ch=.005, ea=ea)
            way.slab('gangplank board', cut + .003, L, v0, v1, -BT, top - g.choice((0, .002)),
                     sheet(way.AX, g.choice(DECK_TONES)), ch=.005, eb=eb)
        else:
            way.slab('gangplank board', 0, L, v0, v1, -BT, top, m, ch=.005, ea=ea, eb=eb)
        # the foot torn ragged: a shard of the board sticking out past its end, never above the surface
        if g.random() < .6:
            out = -1 if low_u == 0 else 1
            e = ea if low_u == 0 else eb
            vm = g.uniform(v0 + .03, v1 - .03)
            ue = (e[0] + (e[1] - e[0]) * (vm - v0) / (v1 - v0)) - out * .01
            tip = ue + out * g.uniform(.04, .09)
            lo = max(way.surf(ue) - BT + .006, fl)
            way.hull('gangplank splinter', [(ue, way.surf(ue) - .004, vm - .018), (ue, way.surf(ue) - .004, vm + .018),
                                            (ue, lo, vm - .012), (ue, lo, vm + .012),
                                            (tip, max(min(way.surf(tip), way.surf(ue)) - .02, fl + .002), vm + g.uniform(-.01, .01))],
                     m)
        # a split along the grain here and there, the dark showing
        if g.random() < .4:
            ua = g.uniform(.15, L - .6)
            vm = g.uniform(v0 + .03, v1 - .03)
            way.hull('gangplank crack', [(u, way.surf(u) + top - .0005, vm + dv) for u in (ua, ua + g.uniform(.25, .45))
                                         for dv in (-.002, .002)]
                     + [(ua + .15, way.surf(ua + .15) + top - .006, vm)], GAPM)
    # The stringers, flush with the sides, their feet cut level with the floor.
    for v0, v1 in ((c0, c0 + STRINGER_W), (c1 - STRINGER_W, c1)):
        way.slab('gangplank stringer', .02, L - .02, v0, v1, -BT - STRINGER_D, -BT + .001,
                 sheet(way.AX, g.choice(STRINGM)))
    # The painted strip along the foot of both sides, faded and chipped, in lengths.
    for v, sgn in ((c0, -1), (c1, 1)):
        u = g.uniform(.05, .3)
        while u < L - .1:
            l = min(L - .05 - u, g.uniform(.25, .7))
            h0, h1 = -BT - STRINGER_D + g.uniform(.004, .012), -BT - g.uniform(.02, .04)
            pts = []
            for uu in (u, u + l):
                for yy in (h0, h1 - g.uniform(0, .012)):
                    for o in (.0006, .0026):
                        pts.append((uu, max(way.surf(uu) + yy, fl + .002), v + sgn * o))
            if way.surf(u + l) - BT - STRINGER_D + .01 > fl or way.surf(u) - BT - STRINGER_D + .01 > fl:
                way.hull('gangplank paint', pts, g.choice((PAINT, PAINT, PAINT2)))
            u += l + g.uniform(.03, .15)

    # The iron straps across, bolted on top and down both sides, some ending in a hook.
    ok = clear(.0)
    straps = []
    u = g.uniform(.25, .4)
    while u < L - .2:
        straps.append(u)
        u += g.uniform(.85, 1.15) * STRAP_EVERY * L / slope
    for j, uc in enumerate(straps):
        hw = g.uniform(.021, .026)
        ua, ub = uc - hw, uc + hw
        way.hull('gangplank strap', [(uu, way.surf(uu) + dy, v) for uu in (ua, ub) for dy in (-.0005, STRAP_T)
                                     for v in (c0 - .006, c1 + .006)], IRON)
        for v, sgn in ((c0, -1), (c1, 1)):
            bot = -BT - STRINGER_D + .01
            pts = []
            for uu in (ua, ub):
                yb = max(way.surf(uu) + bot, fl + .003)
                for yy in (way.surf(uu) + STRAP_T, yb):
                    for o in (0, .006):
                        pts.append((uu, yy, v + sgn * o))
            way.hull('gangplank strap', pts, IRON)
            for bf in (.3, .8):
                y_ = -BT - STRINGER_D * bf
                if way.surf(uc) + y_ - .01 > fl:
                    way.hull('walk bolt', [(uc + du, way.surf(uc) + y_ + dy, v + sgn * .005) for du in (-.007, .007)
                                           for dy in (-.007, .007)] + [(uc, way.surf(uc) + y_, v + sgn * .012)], BOLT)
            # a hook curled off the foot of the strap on the side away from the rail, now and then
            if v != wall_v and (j + (v == c1)) % 2 == 0 and ok(uc) and way.surf(uc) - BT - STRINGER_D - .06 > fl:
                yb = way.surf(uc) - BT - STRINGER_D + .01
                way.tube('gangplank hook', [(uc, yb, v + sgn * .003), (uc, yb - .025, v + sgn * .012),
                                            (uc, yb - .045, v + sgn * .03), (uc, yb - .035, v + sgn * .046),
                                            (uc, yb - .015, v + sgn * .045)], .0055, IRON, sides=4)
        # bolts on top, one a board or so
        for i in range(n):
            if g.random() < .8:
                bolt(way, uc + g.uniform(-.004, .004), (edges[i] + edges[i + 1]) / 2 + g.uniform(-.02, .02), STRAP_T)

    # The posts along the rail side, at least one near each end, never more than ~1.0 apart.
    posts = []
    if rail_v is not None:
        k_ = max(1, math.ceil((slope - .3) / 1.0))
        posts = [.14 + (L - .28) * i / k_ for i in range(k_ + 1)]
    pv = None if rail_v is None else (rail_v + (POST_IN + POST_W / 2) * (1 if rail_v == c0 else -1))

    # The cleats: battens across the boards, keeping clear of the straps and the posts.
    u = CLEAT_EVERY * .6
    while u < L - .1:
        if all(abs(u - s_) > .065 for s_ in straps):
            a, b = c0 + .035, c1 - .035
            if pv is not None and any(abs(u - p) < .06 for p in posts):
                a, b = (a, pv - POST_W / 2 - .012) if rail_v == c1 else (pv + POST_W / 2 + .012, b)
            m = sheet(way.CROSS, g.choice(HULL_TONES))
            way.slab('gangplank cleat', u - CLEAT_W / 2, u + CLEAT_W / 2, a, b, -.002, CLEAT_H, m, ch=.004)
            for vv in (a + .03, b - .03):
                bolt(way, u, vv, CLEAT_H, d=.005, h=.004)
        u += CLEAT_EVERY * L / slope

    # The posts and the rope through their tops.
    tops = []
    for j, pu in enumerate(posts):
        s0 = way.surf(pu)
        foot = max(s0 - BT - STRINGER_D * .6, fl)
        h = POST_H + g.uniform(-.015, .015)
        way.hull('gangplank post', [(pu + du, y_, pv + dv) for du in (-POST_W / 2, POST_W / 2)
                                    for dv in (-POST_W / 2, POST_W / 2) for y_ in (foot, s0 + h - .02)],
                 g.choice((POSTM, POSTM2)))
        c = POST_W / 2 + .007
        way.hull('gangplank post cap', [(pu + du, s0 + h + dy, pv + dv) for du in (-c, c) for dv in (-c, c) for dy in (-.035, 0)]
                 + [(pu, s0 + h + .022, pv)], CAPM)
        # an iron band round the foot, where it is bolted to the boards
        c = POST_W / 2 + .004
        way.hull('gangplank post band', [(pu + du, s0 + dy, pv + dv) for du in (-c, c) for dv in (-c, c) for dy in (.002, .045)], IRON)
        tops.append((pu, s0 + RAIL_H))
        # the rope's wrap round the post where it goes through
        torus('gangplank lashing', way.w(pu, s0 + RAIL_H - .012, pv), POST_W * .62, .01, ROPE, seg=6, sides=3,
              turn=PI / 4)
    if tops:
        line = sag_line(tops, .035, n=6)
        # past the end posts the rope runs down to the plank's ends and is knotted there
        ua_, ub_ = .025, L - .025
        line = [(ua_, way.surf(ua_) + .05)] + line + [(ub_, way.surf(ub_) + .05)]
        way.tube('gangplank rope', [(u_, y_, pv) for u_, y_ in line], .016, ROPE, sides=5)
        for u_ in (ua_, ub_):
            ball('gangplank knot', way.w(u_, way.surf(u_) + .04, pv), (.024, .02, .024), ROPE, seg=5, rings=3)

    # At the top: two iron tongues over the edge of what it rests on, bolted; hooks at both ends.
    sg = 1 if high_u > low_u else -1
    for vc in (c0 + W * .25, c1 - W * .25):
        ua, ub = sorted((high_u - sg * .22, high_u + sg * .07))
        hi = max(y0, y1)
        pts = []
        for uu in (ua, ub):
            past = (uu - high_u) * sg > 0
            yy = hi if past else way.surf(uu)
            for dy in (-.0005, STRAP_T):
                for dv in (-.02, .02):
                    pts.append((uu, yy + dy, vc + dv))
        pts += [(high_u, hi + dy, vc + dv) for dy in (-.0005, STRAP_T) for dv in (-.02, .02)]
        way.hull('gangplank tongue', pts, IRON)
        for uu in (high_u - sg * .15, high_u + sg * .04):
            yy = hi if (uu - high_u) * sg > 0 else way.surf(uu)
            way.hull('walk bolt', [(uu + du, yy + STRAP_T - .001, vc + dv) for du in (-.007, .007) for dv in (-.007, .007)]
                     + [(uu, yy + STRAP_T + .007, vc)], BOLT)
    for ue in (low_u + (sg * .12), high_u - sg * .12):
        for v, sgn in ((c0, -1), (c1, 1)):
            if v == wall_v or way.surf(ue) - BT - STRINGER_D - .06 <= fl:
                continue
            yb = way.surf(ue) - BT - .02
            way.tube('gangplank hook', [(ue, yb + .02, v + sgn * .002), (ue, yb, v + sgn * .01), (ue, yb - .04, v + sgn * .016),
                                        (ue, yb - .062, v + sgn * .034), (ue, yb - .05, v + sgn * .052),
                                        (ue, yb - .028, v + sgn * .05)], .006, IRON, sides=4)
            way.hull('walk bolt', [(ue + du, yb + .02 + dy, v + sgn * .001) for du in (-.009, .009) for dy in (-.009, .009)]
                     + [(ue, yb + .02, v + sgn * .01)], BOLT)
    return {'under': BT + STRINGER_D, 'posts': [way.w(p, 0, pv)[::2] for p in posts] if pv is not None else []}


# ---- the rope bridge -------------------------------------------------------------------------
def rope_bridge(x0, x1, z0, z1, y, axis='x', seed=0, hangers=None, post_ends=None, post_foot=None,
                hanger_group=None):
    """A rope bridge over the rectangle, its planks' tops at y, the axis its length.

    hangers       [(u, top_y), ...] or [(u, top_y, out), ...]: at u (a room coordinate along the axis:
                  x for axis 'x') a rope goes up from each hand line to top_y, leaning `out` away from
                  the bridge's middle at the top (0 by default), and ends in an iron ring; the hand
                  lines are held at HAND_H there as at the posts;
    post_ends     the ends ('x0', 'x1' or 'z0', 'z1') with a pair of posts; both by default;
    post_foot     where those posts start (by default 0.25 under y, as if fixed to what is below);
    hanger_group  the geom group the hangers go into (the hall hangs them off the roof: 'roof').

    Returns {'hand': f(u) -> the hand lines' height at u (room coordinate)}."""
    way = _Way(x0, x1, z0, z1, axis, y, y)
    g = rng(seed * 6421 + 5)
    L, c0, c1 = way.L, way.c0, way.c1
    W = c1 - c0
    a0 = way.a0
    names = ('x0', 'x1') if axis == 'x' else ('z0', 'z1')
    ends = names if post_ends is None else tuple(post_ends)
    ends_u = [0.0 if e == names[0] else L for e in ends]
    foot = y - .25 if post_foot is None else post_foot
    fr_v = (c0 + .075, c1 - .075)                    # the foot ropes, under the planks
    fr_r = .014

    # The planks: laid across, a small gap between, each a little askew; a painted patch; a broken one.
    n = max(3, round(L / PITCH))
    pitch = L / n
    paint0 = g.randrange(1, max(2, n - 3))
    paint_n = g.choice((2, 3))
    paint_side = g.random() < .5
    broken = set()
    if n >= 7:
        cand = [i for i in range(2, n - 2) if not (paint0 <= i < paint0 + paint_n)]
        broken.add(g.choice(cand))
        if L > 4 and len(cand) > 4:
            broken.add(g.choice([i for i in cand if all(abs(i - b) > 2 for b in broken)] or cand))
    for i in range(n):
        gap = g.uniform(*GAP)
        ua = i * pitch + (0 if i == 0 else gap / 2)
        ub = (i + 1) * pitch - (0 if i == n - 1 else gap / 2)
        tw = g.uniform(-.007, .007) * (0 if i in (0, n - 1) else 1)
        va, vb = c0 + g.uniform(0, .02), c1 - g.uniform(0, .02)
        top = g.choice((0, 0, 0, -.002))
        m = sheet(way.CROSS, g.choice(BRIDGE_TONES + DECK_TONES[:2]))
        ea, eb = (ua + tw, ua - tw), (ub + tw, ub - tw)
        if i in broken:
            # broken across its middle: each half snapped on the slant and sagging to the break
            vm = va + (vb - va) * g.uniform(.4, .6)
            slant = g.uniform(-.035, .035)            # the break runs on the slant across the plank
            for outer, sgn in ((va, 1), (vb, -1)):
                d = g.uniform(.018, .03)
                pts = []
                for uu, k in ((ua, -1), (ub, 1)):
                    brk = vm + k * slant - sgn * .012
                    pts += [(uu, y + top, outer), (uu, y + top - PT, outer), (uu, y - d, brk), (uu, y - d - PT, brk)]
                way.hull('bridge plank', pts, m)
                # a torn tip hanging down out of the break
                brk = vm - sgn * .012
                um = (ua + ub) / 2 + g.uniform(-.03, .03)
                way.hull('bridge splinter', [(um - .025, y - d - .004, brk), (um + .025, y - d - .004, brk),
                                             (um, y - d - PT + .004, brk),
                                             (um + g.uniform(-.015, .015), y - d - .045, brk + sgn * g.uniform(.01, .025))],
                         SPLINTER)
        elif paint0 <= i < paint0 + paint_n:
            # painted over part of its length, the rest bare wood where the paint wore off
            cut = va + (vb - va) * (g.uniform(.3, .45) if paint_side else g.uniform(.55, .7))
            pa, pb = (cut + .002, vb) if paint_side else (va, cut - .002)
            wa, wb = (va, cut - .002) if paint_side else (cut + .002, vb)
            way.slab('bridge plank', ua, ub, wa, wb, -PT, top, m, ch=.004, ea=ea, eb=eb)
            way.slab('bridge paint', ua, ub, pa, pb, -PT, top, g.choice((PAINT, PAINT, PAINT2)), ch=.004, ea=ea, eb=eb)
        else:
            way.slab('bridge plank', ua, ub, va, vb, -PT, top, m, ch=.004, ea=ea, eb=eb)
        # the fittings: an iron clip over the foot rope at each end, bolted through
        if i not in broken:
            for fv in fr_v:
                uc = (ua + ub) / 2 + g.uniform(-.015, .015)
                hu, hv = g.uniform(.022, .028), .018
                way.hull('bridge clip', [(uc + du, y + top + dy, fv + dv) for du in (-hu, hu) for dv in (-hv, hv)
                                         for dy in (-.0005, .003)] + [(uc, y + top + .008, fv)], IRON)
        elif g.random() < .5:
            way.hull('bridge clip', [(ua + .03 + du, y - .0005 + dy, fr_v[0] + dv) for du in (-.024, .024) for dv in (-.018, .018)
                                     for dy in (0, .0035)], IRON)
    # The foot ropes, straight under the planks from end to end, lashed round the end posts.
    for fv in fr_v:
        way.tube('bridge foot rope', [(-.01, y - PT - fr_r, fv), (L + .01, y - PT - fr_r, fv)], fr_r, ROPE, sides=5)

    # The hand lines: along both edges, held at HAND_H at the posts and the hangers, sagging between.
    hs = []
    for h in hangers or ():
        u_, top_ = h[0] - a0, h[1]
        out = h[2] if len(h) > 2 else 0.0
        if 0 < u_ < L:
            hs.append((u_, top_, out))
    hs.sort()
    sup = sorted({0.0, L, *[h[0] for h in hs]})
    line = sag_line([(u_, y + HAND_H) for u_ in sup], .025, n=max(3, min(8, round(L / len(sup) / .15))))

    def hand(u_):
        for (ua, ya), (ub, yb) in zip(line, line[1:]):
            if ua <= u_ <= ub:
                return ya + (yb - ya) * (u_ - ua) / max(ub - ua, 1e-9)
        return y + HAND_H
    pin = BPOST_IN + BPOST_W / 2
    for v, sgn in ((c0, 1), (c1, -1)):
        pts = [(u_, y_, v) for u_, y_ in line]
        # the ends: to the eye rings of the posts, a little inside the edge
        if 0.0 in ends_u:
            pts[0] = (pin, EYE(y), v + sgn * pin)
        if L in ends_u:
            pts[-1] = (L - pin, EYE(y), v + sgn * pin)
        way.tube('bridge hand line', pts, .014, ROPE, sides=5)
        # cords from the hand line down to the plank ends
        u_ = pitch * 1.5
        while u_ < L - pitch:
            way.tube('bridge cord', [(u_, hand(u_), v), (u_ + .01, y - .012, v + sgn * .02)], .0045, ROPE, sides=3)
            u_ += pitch * 2
        # the hangers from this line
        grp = geom.group(hanger_group) if hanger_group else None
        if grp:
            grp.__enter__()
        for u_, top_, out in hs:
            a = way.w(u_, hand(u_), v)
            b = way.w(u_, top_, v - sgn * out)
            rod('bridge hanger', a, b, .009, ROPE, sides=4)
            ball('bridge hanger knot', a, .02, ROPE, seg=5, rings=3)
            torus('bridge hanger ring', way.w(u_, top_ - .02, v - sgn * out), .028, .007, IRON, seg=8, sides=3,
                  tilt=PI / 2, turn=PI / 2 if axis == 'z' else 0)
        if grp:
            grp.__exit__()

    # The end posts: short and square, an iron eye ring on top, the foot rope lashed round them.
    for ue in ends_u:
        pu = pin if ue == 0 else L - pin
        for v, sgn in ((c0, 1), (c1, -1)):
            pvv = v + sgn * pin
            h = EYE(y) - .05
            s = BPOST_W / 2
            way.hull('bridge post', [(pu + du, yy, pvv + dv) for du in (-s, s) for dv in (-s, s) for yy in (foot, h)],
                     g.choice((POSTM, POSTM2)))
            way.hull('bridge post cap', [(pu + du, h + dy, pvv + dv) for du in (-s - .005, s + .005)
                                         for dv in (-s - .005, s + .005) for dy in (-.03, .004)], CAPM)
            # the eye bolt: a shank and a ring standing across the line
            rod('bridge eye shank', way.w(pu, h, pvv), way.w(pu, h + .03, pvv), .006, IRON, sides=4)
            torus('bridge eye', way.w(pu, h + .05, pvv), .022, .006, IRON, seg=8, sides=3, tilt=PI / 2,
                  turn=PI / 2 if axis == 'x' else 0)
            # iron band and the lashings where the ropes are made fast
            c = s + .004
            way.hull('bridge post band', [(pu + du, yy, pvv + dv) for du in (-c, c) for dv in (-c, c)
                                          for yy in (y - PT - .045, y - PT - .005)], IRON)
            torus('bridge lashing', way.w(pu, y - PT - .022, pvv), s * 1.25, .009, ROPE, seg=6, sides=3,
                  turn=PI / 4)
    return {'hand': lambda x: hand(x - a0)}


def build():
    """One of each side by side: a gangplank 2.0 long and 0.7 wide from y 0.6 at its back down to the
    floor, its rope along the outer (west) side; and a rope bridge 2.0 by 0.5 at y 0.6 on its four end
    posts from the floor, held in its middle by two hangers from 1.3."""
    gangplank(-.9, -.2, -1.0, 1.0, .6, 0.0, axis='z', rail_side='x0', seed=1)
    rope_bridge(.4, .9, -1.0, 1.0, .6, axis='z', seed=2, post_foot=0.0, hangers=[(0.0, 1.3, .06)])
