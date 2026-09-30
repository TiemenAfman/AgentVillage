"""The Salty Kraken's shell: the cave and the ship's timber it is built of, and nothing that stands
in it. Floors, walls, the cellar, the hearth, the storeys and the ways up, the pool and the sea
arch, the ceiling. The furniture and the clutter are dressing.py's, the ship's parts (stern,
counter, mast, gun ports, jukebox, figurehead, lamps) are the kit's.

Every number comes from web/js/kraken-layout.js (handed in as `L`): a floor is built at the height
it is walked at, a stair's treads sit on the slope the game walks, a rail stands on the line that
is its blocker. What is only this file's is how things are made: plank widths, rock sizes, where a
rib or a beam goes.

Groups (scripts/krakenkit/geom.py): the ceiling and everything hanging from it is the lid
(`lid()`), the south and east walls - the oriel's east and south walls, the sea arch and whatever
is fixed to them - are `near` (the cutaway preview leaves them out), the rest is the room.

First versions, each in a function of its own so it can be replaced alone once there is a
reference drawing for it: `stair` (with its handrail), `ladder`, `rope_bridge`, `hearth`,
`sea_arch`, `window` (the oriel's stern windows) and `door`. They are kept simple and in
proportion; the structure round them (floors, walls, frames, beams, posts, rails, rock, the pool's
rim, the cellar's vault) is the finished part.

Rules this keeps, all from the layout's side:
- y = 0 is the lowest point; the ground's boards top out at F.
- The rock of the north and west walls stays behind the wall line wherever somebody could stand
  next to it (from a floor's height to 0.62 over it, any floor or stair within 0.35 of the wall)
  and bulges at most 0.15 into the room elsewhere above F + 0.62; never in front of the stern or
  at the cellar arch.
- The rock overhang in the north keeps F + 2.0 clear above x -3..3 and 0.62 over any floor.
"""
import math
from mathutils import Matrix
import geom
from geom import (PI, TAU, TAR, HULLW, DECKP, STAGEP, CEIL, BEAMZ, BEAMX, OAK, DARK, WOOD, RIB, CARVED,
                  HEARTH, CELLAR, FLAGS, SOOT, IRON, ROPE, PANE, BLACK, material,
                  group, lid, box, rod, disc, ball, lathe, prism, hull, tube, torus, rng)

ROCK, ROCKW = 'stone:rock', 'stone:rock-warm'
CAVE = material('stone:cave', 0x4a4650)             # the deeper rock, between and behind the boulders
CAVED = material('stone:cave-deep', 0x2c2a30)       # the backing no light reaches
SEAROCK = material('stone:sea-rock', 0x34373e)
WATER = material('plain:water', 0x173f47)           # dark teal, lit by the moon light, not glowing
FOAM = material('plain:water-lip', 0x2a5a60)
DECKB = material('plank:deck-b', 0x553823)
DECKC = material('plank:deck-c', 0x684630)
DECKZ = material('plankZ:deck', 0x5e3e27)
DECKZB = material('plankZ:deck-b', 0x6c4a2e)
DECKZC = material('plankZ:deck-c', 0x543722)
TREAD = material('plank:tread', 0x6a4a2e)
TREADZ = material('plankZ:tread', 0x6a4a2e)
HULLB = material('plank:hull-b', 0x5f412a)
HULLC = material('plank:hull-c', 0x7a5638)
TARB = material('plank:tar-b', 0x251b14)
TARC = material('plank:tar-c', 0x3a2a1e)
CEILB = material('plankZ:ceiling-b', 0x31221a)
CELLARB = material('stone:cellar-b', 0x58514a)
CELLARC = material('stone:cellar-c', 0x75695c)
HEARTHB = material('stone:hearth-b', 0x6c6258)
FLAGSB = material('stone:flags-b', 0x6c645a)
SPLINTER = material('plain:splinter', 0xa07c52)
POSTW = material('plain:post', 0x3e2a1c)
RUST = material('plain:rust', 0x4a3428)

# ---- the layout -------------------------------------------------------------------------------
F = T = L1 = L2 = TOP = W = DOOR = 0.0
HALL = CEL = ORI = SNUG = POOL = JETTY = KIT = HEARTHP = None
ARCH = FLOORS = STAIRS = RAILS = POSTS = None
POST_R = .06
FL = {}

# The deck beams overhead, along z: the frames of the south wall stand under them. 1.8 and 2.9
# bracket the mast (2.4); -1.55 is behind the jukebox and 1.8 clear of the east gun port.
XS = [-3.85, -2.7, -1.55, -0.4, 0.75, 1.8, 2.9, 3.9]
BEAM_H = .15
BT, SUB = .035, .025        # a floor's boards and the sub-floor under them
JD = .1                     # a joist's depth under the sub-floor
GD = .14                    # an edge beam's (girder's) depth


def _init(L):
    global F, T, L1, L2, TOP, W, DOOR, HALL, CEL, ORI, SNUG, POOL, JETTY, KIT, HEARTHP
    global ARCH, FLOORS, STAIRS, RAILS, POSTS, POST_R, FL
    F = L['F']
    T, L1, L2 = L['LEVEL']['terrace'], L['LEVEL']['first'], L['LEVEL']['second']
    TOP, W, DOOR = L['TOP'], L['WALL'], L['DOOR_HALF']
    HALL, CEL, ORI, SNUG = L['HALL'], L['CELLAR'], L['ORIEL'], L['SNUG']
    POOL, JETTY, KIT, HEARTHP = L['POOL'], L['JETTY'], L['KIT'], L['HEARTH']
    ARCH, FLOORS, STAIRS, RAILS, POSTS = L['ARCH'], L['FLOORS'], L['STAIRS'], L['RAILS'], L['POSTS']
    POST_R = L.get('POST_R', .06)
    FL = {f['id']: f for f in FLOORS}


# ---- small helpers ------------------------------------------------------------------------------
def span(label, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    """geom.span, but a sliver is left out and a bevel never eats a thin box."""
    x0, x1 = min(x0, x1), max(x0, x1)
    y0, y1 = min(y0, y1), max(y0, y1)
    z0, z1 = min(z0, z1), max(z0, z1)
    d = min(x1 - x0, y1 - y0, z1 - z0)
    if d < .003:
        return
    if bevel and d < bevel * 3:
        bevel = d / 3.5 if d > .012 else 0.0
    geom.span(label, x0, x1, y0, y1, z0, z1, mat, bevel)


# Directions spread evenly over a sphere (a Fibonacci lattice): a boulder is the hull of these,
# each pushed in a little. geom.rock's twelve random points came out as shards and slabs; this is
# a chunk of rock with facets, rounder but still broken.
_DIRS = []
for _i in range(26):
    _yy = 1 - 2 * (_i + .5) / 26
    _rr = math.sqrt(1 - _yy * _yy)
    _a = _i * 2.399963
    _DIRS.append((_rr * math.cos(_a), _yy, _rr * math.sin(_a)))


def rock(at, size, seed, mat=ROCK):
    """A boulder in the box `size` (semi-axes) round `at`, lifted where it would reach below
    y = 0 (the room's lowest point)."""
    g = rng(seed)
    x, y, z = at
    sx, sy, sz = size
    y = max(y, sy + .001)
    a = g.uniform(0, TAU)
    ca, sa = math.cos(a), math.sin(a)
    flat = g.uniform(.55, .9)          # a face knocked flat somewhere, as broken rock has
    fd = _DIRS[g.randrange(len(_DIRS))]
    pts = []
    for dx, dy, dz in _DIRS:
        r = g.uniform(.8, 1.0)
        dot = dx * fd[0] + dy * fd[1] + dz * fd[2]
        if dot > flat:
            r *= flat / dot
        px, py, pz = dx * r, dy * r, dz * r
        px, pz = px * ca - pz * sa, px * sa + pz * ca
        pts.append((x + px * sx, y + py * sy, z + pz * sz))
    hull('rock', pts, mat)


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def plane_m(origin, ex, ey, ez):
    """A frame whose own x, y, z are ex, ey, ez (world vectors) and whose origin is `origin`."""
    return Matrix(((ex[0], ey[0], ez[0], origin[0]), (ex[1], ey[1], ez[1], origin[1]),
                   (ex[2], ey[2], ez[2], origin[2]), (0, 0, 0, 1)))


def free_runs(u0, u1, y0, y1, holes):
    """The parts of [u0, u1] that no hole (u0, u1, y0, y1) overlapping [y0, y1] covers."""
    runs = [(u0, u1)]
    for h0, h1, hy0, hy1 in holes:
        if hy1 <= y0 + 1e-6 or hy0 >= y1 - 1e-6:
            continue
        out = []
        for a, b in runs:
            if h1 <= a or h0 >= b:
                out.append((a, b))
                continue
            if h0 > a:
                out.append((a, h0))
            if h1 < b:
                out.append((h1, b))
        runs = out
    return [(a, b) for a, b in runs if b - a > .008]


def rect_minus(x0, x1, z0, z1, holes):
    """A rectangle less some rectangles (x0, x1, z0, z1), as rectangles."""
    zs = sorted({z0, z1} | {v for h in holes for v in (h[2], h[3]) if z0 < v < z1})
    out = []
    for a, b in zip(zs, zs[1:]):
        for u0, u1 in free_runs(x0, x1, a, b, holes):
            out.append((u0, u1, a, b))
    return out


def wspan(label, axis, plane, inward, u0, u1, y0, y1, d0, d1, mat, bevel=0.0):
    """A box on a wall: u along it, d into the room from its face (negative is into the wall).
    `axis` is the direction the wall runs ('x': a north or south wall), `inward` the room's side."""
    a, b = plane + inward * d0, plane + inward * d1
    n0, n1 = min(a, b), max(a, b)
    if axis == 'x':
        span(label, u0, u1, y0, y1, n0, n1, mat, bevel)
    else:
        span(label, n0, n1, y0, y1, u0, u1, mat, bevel)


def wpt(axis, plane, inward, u, y, d):
    n = plane + inward * d
    return (u, y, n) if axis == 'x' else (n, y, u)


def wall_m(axis, plane, inward):
    """The frame of a wall's face: own x along the wall, own y up, own z into the room."""
    if axis == 'x':
        return plane_m((0, 0, plane), (1, 0, 0), (0, 1, 0), (0, 0, inward))
    return plane_m((plane, 0, 0), (0, 0, 1), (0, 1, 0), (inward, 0, 0))


def ring(label, m, cx, cy, r0, r1, a0, a1, n, d0, d1, mats, g, gap=.01, jitter=0.0):
    """An arch of n voussoirs in a frame's xy plane, from d0 to d1 along its z: every stone a
    convex hull of its own, a seam between them."""
    for i in range(n):
        t0 = a0 + (a1 - a0) * i / n
        t1 = a0 + (a1 - a0) * (i + 1) / n
        pad = gap / max(r0, .05) / 2
        t0, t1 = t0 + pad, t1 - pad
        rr1 = r1 + g.uniform(-jitter, jitter)
        dd1 = d1 + g.uniform(0, jitter)
        pts = []
        for t in (t0, t1):
            for r in (r0, rr1):
                for d in (d0, dd1):
                    pts.append((cx + r * math.cos(t), cy + r * math.sin(t), d))
        hull(label, pts, g.choice(mats), m)


def fan(label, apex, pts, depth, mat, m):
    """The region between a corner and a curve, as triangles from the corner: convex pieces."""
    for p, q in zip(pts, pts[1:]):
        if abs((p[0] - apex[0]) * (q[1] - apex[1]) - (p[1] - apex[1]) * (q[0] - apex[0])) < 1e-5:
            continue
        prism(label, [apex, p, q], depth, mat, m)


def bolt(at, axis, r=.011, mat=IRON):
    """A square bolt head on a face; `axis` the face's normal ('x', 'y' or 'z')."""
    x, y, z = at
    s = {'x': (.012, r * 2, r * 2), 'y': (r * 2, .012, r * 2), 'z': (r * 2, r * 2, .012)}[axis]
    box('bolt', at, s, mat)


def slope_y(s, x, z):
    if s['axis'] == 'z':
        t = (z - s['z0']) / (s['z1'] - s['z0'])
    else:
        t = (x - s['x0']) / (s['x1'] - s['x0'])
    t = clamp(t, 0, 1)
    return s['y0'] + (s['y1'] - s['y0']) * t


def surfaces(x, z, r=.35):
    """The heights of everything one stands on within r of (x, z): the ground, floors, stairs."""
    hs = [F]
    for f in FLOORS:
        if f['x0'] - r <= x <= f['x1'] + r and f['z0'] - r <= z <= f['z1'] + r:
            hs.append(f['y'])
    for s in STAIRS:
        if s['x0'] - r <= x <= s['x1'] + r and s['z0'] - r <= z <= s['z1'] + r:
            hs.append(slope_y(s, clamp(x, s['x0'], s['x1']), clamp(z, s['z0'], s['z1'])))
    return hs


def stern_box():
    s = KIT['stern']
    return (s['x'] - 1.85, s['x'] + 1.85, s['y'] + 1.84)


# ---- floors ---------------------------------------------------------------------------------------
def deck(x0, x1, z0, z1, y, along, seed, mats, thick=BT, width=(.12, .165), label='deck', lmin=.8, lmax=1.7):
    """Boards laid along `along` over a rectangle, their tops at y, staggered butt joints and a
    hair of gap between them (the sub-floor under shows as the seams)."""
    g = rng(seed)
    a0, a1, c0, c1 = (x0, x1, z0, z1) if along == 'x' else (z0, z1, x0, x1)
    c = c0
    while c < c1 - .015:
        w = g.uniform(*width)
        if c1 - (c + w) < .06:
            w = c1 - c
        u = a0 - g.uniform(0, lmax)
        while u < a1:
            l = g.uniform(lmin, lmax)
            ua, ub = max(a0, u), min(a1, u + l)
            if ub - ua > .03:
                m = g.choice(mats)
                sink = g.choice((0, 0, 0, .002))
                if along == 'x':
                    span(label, ua + .002, ub - .002, y - thick, y - sink, c + .0025, c + w - .0025, m)
                else:
                    span(label, c + .0025, c + w - .0025, y - thick, y - sink, ua + .002, ub - .002, m)
            u += l
        c += w


def sub_floor(rects, y, mat=DARK):
    for x0, x1, z0, z1 in rects:
        span('sub floor', x0, x1, y - BT - SUB, y - BT + .001, z0, z1, mat)


def nosing(x0, x1, z0, z1, y, mat=DARK):
    """An edge board over a floor's open edge: its top flush with the boards, down over the
    thickness of the floor and the edge beam's face."""
    span('nosing', x0, x1, y - .085, y, z0, z1, mat, bevel=.008)


def ground():
    """The slab from y = 0 to the boards, under the hall, the hold and oriel and the cellar, less
    the pool; the ground's boards; the door's threshold."""
    x0, x1, z0, z1 = HALL['x0'] - W, HALL['x1'] + W, HALL['z0'] - W, HALL['z1'] + W
    px0, pz0 = POOL['x0'], POOL['z0']
    slab = [(x0, px0, z0, z1), (px0, x1, z0, pz0)]
    for a, b, c, d in slab:
        span('slab', a, b, 0, F - BT, c, d, DARK)
    span('slab', HALL['x1'] + W, ORI['x1'] + W, 0, F - BT, ORI['z0'] - W, ORI['z1'] + W, DARK)
    span('slab', CEL['x0'] - W, CEL['x1'] + W, 0, F - .025, CEL['z0'] - W, HALL['z0'] - W, DARK)
    # The boards: everywhere on the ground but under the platforms and in the pool. They run along
    # x (the plank sheet's way on a floor), which is the way into the hall from the door as well.
    t, s = FL['terrace'], FL['snug']
    holes = [(t['x0'], t['x1'], t['z0'], t['z1']), (s['x0'], s['x1'], s['z0'], s['z1']),
             (POOL['x0'], x1, POOL['z0'], z1)]
    for i, (a, b, c, d) in enumerate(rect_minus(HALL['x0'], HALL['x1'], HALL['z0'], HALL['z1'], holes)):
        deck(a, b, c, d, F, 'x', 100 + i, [DECKP, DECKP, DECKB, DECKC])
    # The hold under the cabin continues into the oriel's foot.
    deck(ORI['x0'], ORI['x1'], ORI['z0'], ORI['z1'], F, 'x', 120, [DECKB, DECKB, DECKP, TARC])
    # A worn stone threshold in the door.
    span('threshold', -DOOR, DOOR, 0, F + .008, HALL['z1'] - .01, HALL['z1'] + W + .02, HEARTH, bevel=.01)
    span('threshold', -DOOR + .05, DOOR - .05, F + .004, F + .012, HALL['z1'] + .02, HALL['z1'] + W - .02, HEARTHB)


def platform(f, open_edges, seed, fascia=TAR):
    """A raised floor on the ground (the terrace, the snug): a body of timber, boards on top, a
    nosing on the open edges and a tread along them outside it, one half of the rise."""
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    span('platform', x0, x1, 0, y - BT, z0, z1, fascia)
    deck(x0, x1, z0, z1, y, 'x', seed, [STAGEP, DECKC, DECKP, STAGEP])
    th = (y - F) / 2 + F
    g = rng(seed + 7)
    for e in open_edges:
        if e == 's':
            nosing(x0, x1, z1 - .03, z1 + .015, y)
            span('tread', x0 - (.14 if 'w' in open_edges else 0), x1 + (.14 if 'e' in open_edges else 0),
                 0, th, z1, z1 + .14, TREAD, bevel=.01)
            for x in [x0 + .35 + k * .8 for k in range(int((x1 - x0 - .4) / .8) + 1)]:
                span('batten', x - .03, x + .03, 0, y - .09, z1 - .005, z1 + .018, RIB, bevel=.006)
        elif e == 'n':
            nosing(x0, x1, z0 - .015, z0 + .03, y)
            span('tread', x0, x1, 0, th, z0 - .14, z0, TREAD, bevel=.01)
        elif e == 'w':
            nosing(x0 - .015, x0 + .03, z0, z1, y)
            span('tread', x0 - .14, x0, 0, th, z0, z1, TREADZ, bevel=.01)
            for z in [z0 + .4 + k * .8 for k in range(int((z1 - z0 - .45) / .8) + 1)]:
                span('batten', x0 - .018, x0 + .005, 0, y - .09, z - .03, z + .03, RIB, bevel=.006)
        elif e == 'e':
            nosing(x1 - .03, x1 + .015, z0, z1, y)
            span('tread', x1, x1 + .14, 0, th, z0, z1, TREADZ, bevel=.01)
            for z in [z0 + .4 + k * .8 for k in range(int((z1 - z0 - .45) / .8) + 1)]:
                span('batten', x1 - .005, x1 + .018, 0, y - .09, z - .03, z + .03, RIB, bevel=.006)


# ---- walls of timber ----------------------------------------------------------------------------
def planked(axis, plane, inward, u0, u1, y0, y1, seed, holes=(), tar_to=None, wale=True, wale_skip=(),
            upper=(HULLW, HULLW, HULLW, HULLB, HULLB, HULLC), lower=(TAR, TAR, TARB, TARC)):
    """A wall of ship's planking: strakes of 0.1-0.135 with butt joints staggered along it, tarred
    below the wale and lighter above, a dark backing the wall's thickness behind their faces, and
    the wale itself, a rubbing strake standing proud. Holes are (u0, u1, y0, y1)."""
    g = rng(seed)
    tar_to = F + .44 if tar_to is None else tar_to
    ys = [y0]
    y = y0
    while y < y1 - .04:
        y = min(y1, y + g.uniform(.1, .135))
        ys.append(y)
    extra = [tar_to, tar_to + .07] if wale else [tar_to]
    for h in holes:
        extra += [h[2], h[3]]
    for v in extra:
        if y0 < v < y1:
            ys = [q for q in ys if abs(q - v) > .03 or q in (y0, y1)] + [v]
    ys = sorted(set(ys))
    for ya, yb in zip(ys, ys[1:]):
        mats = lower if yb <= tar_to + .075 else upper
        for a, b in free_runs(u0, u1, ya, yb, holes):
            wspan('wall', axis, plane, inward, a, b, ya, yb, -W, -.018, DARK)
            u = a - g.uniform(0, 2.4)
            while u < b:
                l = g.uniform(1.7, 3.2)
                ua, ub = max(a, u), min(b, u + l)
                if ub - ua > .03:
                    inset = g.choice((0, 0, .003, .006))
                    wspan('strake', axis, plane, inward, ua + .003, ub - .003, ya + .003, yb - .003,
                          -.02, -inset, g.choice(mats))
                u += l
    if wale:
        for a, b in free_runs(u0, u1, tar_to, tar_to + .07, list(holes) + [(p, q, tar_to, tar_to + .07) for p, q in wale_skip]):
            wspan('wale', axis, plane, inward, a, b, tar_to, tar_to + .07, -.02, .03, DARK, bevel=.009)
            k = a + .3
            while k < b - .1:
                wspan('wale bolt', axis, plane, inward, k - .01, k + .01, tar_to + .025, tar_to + .045, .03, .036, IRON)
                k += .6


def rib(axis, plane, inward, u, y0, y1, gaps=(), wide=.1, proud=.07, seed=0):
    """A ship's frame standing in front of the planking, bolted through it, broken where a port or
    a door goes through the wall."""
    segs = [(y0, y1)]
    for a, b in gaps:
        out = []
        for s0, s1 in segs:
            if b <= s0 or a >= s1:
                out.append((s0, s1))
                continue
            if a > s0:
                out.append((s0, a))
            if b < s1:
                out.append((b, s1))
        segs = out
    for s0, s1 in segs:
        if s1 - s0 < .06:
            continue
        wspan('rib', axis, plane, inward, u - wide / 2, u + wide / 2, s0, s1, -.01, proud, RIB, bevel=.012)
        if s0 < .02:
            wspan('rib foot', axis, plane, inward, u - wide / 2 - .015, u + wide / 2 + .015, 0, .09, -.01, proud + .012, DARK, bevel=.01)
        yy = s0 + .22
        while yy < s1 - .12:
            wspan('rib bolt', axis, plane, inward, u - .013, u + .013, yy - .013, yy + .013, proud, proud + .008, IRON)
            yy += .42


def hanging_knee(axis, plane, inward, u, yb, arm=.3, leg=.34, t=.07, r=.2, thick=.08, mat=RIB):
    """The L of a hanging knee under a beam where it meets a wall, its throat curved: two legs and
    a fan of convex pieces for the throat. In the wall's normal plane at u; yb the beam's bottom."""
    if axis == 'x':      # a south or north wall: the knee's plane is x = u, s runs along z
        m = plane_m((u, 0, plane), (0, 0, inward), (0, 1, 0), (1, 0, 0))
    else:
        m = plane_m((plane, 0, u), (inward, 0, 0), (0, 1, 0), (0, 0, 1))
    prism('knee', [(0, yb), (0, yb - leg), (t, yb - leg), (t, yb)], thick, mat, m)
    prism('knee', [(t, yb), (t, yb - t), (arm, yb - t), (arm, yb)], thick, mat, m)
    c = (t + r, yb - t - r)
    # the throat: a quarter circle from (t, yb - t - r) round to (t + r, yb - t), the room's side
    arc = [(c[0] - r * math.cos((PI / 2) * i / 6), c[1] + r * math.sin((PI / 2) * i / 6)) for i in range(7)]
    fan('knee', (t, yb - t), arc, thick, mat, m)
    for s, y in ((t * .5, yb - leg + .07), (arm - .06, yb - t * .5)):
        p = m @ geom.Vector((s, y, thick / 2 + .004))
        box('knee bolt', tuple(p), (.018, .018, .018), IRON)


# ---- walls of rock --------------------------------------------------------------------------------
def rock_mat(g):
    v = g.random()
    return ROCK if v < .58 else ROCKW if v < .88 else CAVE


def rock_wall(seed, axis, plane, inward, u0, u1, y0, y1, reach, keep=None, deep=None,
              big=(.24, .42), step=.46, detail=4.5):
    """A face of boulders on a wall: a coarse layer of big ones and smaller ones in front, each
    boulder's face no further into the room than `reach(u, y)` allows anywhere on it (a function of
    its whole extent, sampled) and none where `keep(u, y, su, sy)` says. `deep(u)` is how far into
    the wall (negative d) a boulder may reach there: a wall with a room behind it is thin."""
    g = rng(seed)

    def rmin(u, y, su, sy):
        return min(reach(uu, yy) for uu in (u - su, u, u + su) for yy in (y - sy * .8, y, y + sy * .8))

    def place(u, y, su, sy, sd, front):
        if deep is not None:
            lim = deep(u)
            if front - 2 * sd < lim:
                sd = max(.025, (front - lim) / 2)
        c = front - sd
        p = wpt(axis, plane, inward, u, y, c)
        size = (su, sy, sd) if axis == 'x' else (sd, sy, su)
        rock(p, size, g.randrange(1 << 30), rock_mat(g))

    row = 0
    y = y0 + big[0] * .6
    while y < y1 + .08:
        u = u0 + (step * .5 if row % 2 else 0) - step * .25
        while u < u1 + step * .3:
            su = g.uniform(*big)
            sy = su * g.uniform(.6, .95)
            sd = su * g.uniform(.55, .85)
            uu = clamp(u + g.uniform(-.07, .07), u0 + su * .3, u1 - su * .3)
            yy = y + g.uniform(-.06, .06)
            if not (keep and keep(uu, yy, su, sy)):
                r = rmin(uu, yy, su, sy)
                front = r * g.uniform(.25, .7) - g.uniform(.008, .035)
                place(uu, yy, su, sy, sd, front)
            u += step * g.uniform(.8, 1.1)
        y += step * .74
        row += 1
    n = int((u1 - u0) * (y1 - y0) * detail)
    for _ in range(n):
        uu = g.uniform(u0 + .05, u1 - .05)
        yy = g.uniform(y0 + .05, y1)
        su = g.uniform(.09, .19)
        sy = su * g.uniform(.55, .95)
        sd = su * g.uniform(.5, .8)
        if keep and keep(uu, yy, su, sy):
            continue
        r = rmin(uu, yy, su, sy)
        front = r * g.uniform(.55, 1.0) - g.uniform(0, .014)
        place(uu, yy, su, sy, sd, front)


def wall_reach(axis, plane, inward):
    """How far a boulder may stand out of a rock wall at (u, y): nothing where a body could stand
    against it, 0.15 above head height, nothing in front of the stern."""
    sx0, sx1, sy1 = stern_box()
    cache = {}

    def f(u, y):
        key = round(u, 1)
        if key not in cache:
            x, _, z = wpt(axis, plane, inward, u, 0, .05)
            cache[key] = (surfaces(x, z), x, z)
        hs, x, z = cache[key]
        if y < F + .62:
            return 0.0
        if axis == 'x' and sx0 <= x <= sx1 and y < sy1 and z < KIT['stern']['z']:
            return 0.0
        for h in hs:
            if h - .15 <= y <= h + .62:
                return 0.0
        return .15
    return f


def backing(axis, plane, inward, u0, u1, y0, y1, d0, d1, holes=(), mat=CAVED):
    """The dark rock behind the boulders, so a gap between two is rock and not the void."""
    ys = sorted({y0, y1} | {v for h in holes for v in (h[2], h[3]) if y0 < v < y1})
    for a, b in zip(ys, ys[1:]):
        for ua, ub in free_runs(u0, u1, a, b, holes):
            wspan('rock backing', axis, plane, inward, ua, ub, a, b, d0, d1, mat)


# ---- the north and west walls: the cave ---------------------------------------------------------
def cave_walls():
    x0, x1, z0, z1 = HALL['x0'], HALL['x1'], HALL['z0'], HALL['z1']
    ac = (ARCH[0] + ARCH[1]) / 2
    ar = (ARCH[1] - ARCH[0]) / 2
    atop = F + .95
    aspring = atop - ar
    peek = (-2.82, -2.58, T + .2, T + .5)
    hz = HEARTHP['z']

    def keep_north(u, y, su, sy):
        # the cellar arch's jambs and its ring of voussoirs
        if u + su > ARCH[0] - .17 and u - su < ARCH[1] + .06 and y - sy < aspring:
            return True
        cx, cy = clamp(ac, u - su, u + su), clamp(aspring, y - sy, y + sy)
        if math.hypot(cx - ac, cy - aspring) < ar + .13:
            return True
        # the peephole into the cellar
        if u + su > peek[0] - .03 and u - su < peek[1] + .03 and y + sy > peek[2] - .03 and y - sy < peek[3] + .03:
            return True
        return False

    def deep_north(u):
        return -.125 if CEL['x0'] - W <= u <= CEL['x1'] + W else -1.0

    rn = wall_reach('x', z0, 1)
    rock_wall(11, 'x', z0, 1, x0, x1, 0, TOP + .06, rn, keep=keep_north, deep=deep_north)
    # Behind them: thin over the cellar, deep elsewhere, with the arch and the peephole open.
    holes = [(ARCH[0], ARCH[1], 0, atop), (peek[0], peek[1], peek[2], peek[3])]
    backing('x', z0, 1, x0 - W, CEL['x1'] + W, 0, TOP + .06, -W - .005, -.1, holes)
    backing('x', z0, 1, CEL['x1'] + W, x1 + W, 0, TOP + .06, -.34, -.12)

    def keep_west(u, y, su, sy):
        if u + su > hz - .66 and u - su < hz + .66 and y - sy < F + .74:
            return True
        if u + su > hz - .36 and u - su < hz + .36:
            return True
        return False

    rw = wall_reach('z', x0, 1)
    rock_wall(12, 'z', x0, 1, z0, z1, 0, TOP + .06, rw, keep=keep_west)
    backing('z', x0, 1, z0 - W, z1 + W, 0, TOP + .06, -.34, -.12)
    # The peephole: a ragged hole broken through into the cellar, lined with rock, its edge
    # broken stones.
    g = rng(31)
    px0, px1, py0, py1 = peek
    for (a, b, c, d) in ((px0 - .04, px1 + .04, py0 - .05, py0), (px0 - .04, px1 + .04, py1, py1 + .05),
                         (px0 - .05, px0, py0, py1), (px1, px1 + .05, py0, py1)):
        span('peephole lining', a, b, c, d, z0 - W - .01, z0 - .003, CAVE)
    for i in range(14):
        t = TAU * i / 14 + g.uniform(-.15, .15)
        cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
        rx, ry = (px1 - px0) / 2 + .04, (py1 - py0) / 2 + .04
        s = g.uniform(.035, .065)
        rock((cx + rx * math.cos(t), cy + ry * math.sin(t), z0 - s * .5 - .004),
             (s, s * .8, s * .5), g.randrange(1 << 30), rock_mat(g))
    return atop, aspring, peek


def cave_roof():
    """The rock coming over the north of the hall as its roof: boulders hung from the ceiling,
    lowest in the corners, their undersides kept clear of every floor by a body's height and of
    F + 2.0 over the bar."""
    g = rng(19)
    z0 = HALL['z0']

    def edge(x):
        return -2.3 + .14 * math.sin(x * 1.7) + .08 * math.cos(x * 3.1)

    def min_bottom(x, z):
        hs = [F] + [f['y'] for f in FLOORS if f['x0'] - .05 <= x <= f['x1'] + .05 and f['z0'] - .05 <= z <= f['z1'] + .05]
        b = max(hs) + .62
        if -3.0 <= x <= 3.0:
            b = max(b, F + 2.0)
        sx0, sx1, sy1 = stern_box()
        if sx0 <= x <= sx1:
            b = max(b, sy1 + .03)
        return b

    def want(x, z):
        n = clamp(1 - (z - z0) / 1.3, 0, 1)
        c = clamp(1 - min(x - HALL['x0'], HALL['x1'] - x) / 1.0, 0, 1)
        return TOP - .1 - .18 * n - .3 * c * (.4 + .6 * n)

    z = z0 + .05
    row = 0
    while z < -1.95:
        x = HALL['x0'] + (.2 if row % 2 else 0)
        while x < HALL['x1'] + .1:
            if z < edge(x) + g.uniform(-.1, .12):
                su = g.uniform(.2, .36)
                sz = su * g.uniform(.7, 1.0)
                xx = clamp(x + g.uniform(-.08, .08), HALL['x0'] + .05, HALL['x1'] - .05)
                zz = z + g.uniform(-.06, .06)
                lo = max(min_bottom(a, b) for a in (xx - su, xx, xx + su) for b in (zz - sz, zz, zz + sz))
                bot = max(lo, want(xx, zz) + g.uniform(-.05, .05))
                cy = TOP + .04
                sy = max(.05, cy - bot)
                rock((xx, cy, zz), (su, sy, sz), g.randrange(1 << 30), rock_mat(g))
            x += .38 * g.uniform(.85, 1.1)
        z += .3
        row += 1
    # The rock's lip where it gives way to the deck beams: smaller stones along the edge.
    for i in range(34):
        x = HALL['x0'] + .15 + i * .26 + g.uniform(-.05, .05)
        zz = edge(x) + g.uniform(-.02, .12)
        su = g.uniform(.1, .18)
        lo = min_bottom(x, zz)
        bot = max(lo, TOP - .14 + g.uniform(-.03, .03))
        rock((x, TOP + .02, zz), (su, max(.04, TOP + .02 - bot), su * .8), g.randrange(1 << 30), rock_mat(g))


# ---- the cellar arch, the cellar ----------------------------------------------------------------
def cellar_arch(atop, aspring):
    z0 = HALL['z0']
    g = rng(41)
    ac = (ARCH[0] + ARCH[1]) / 2
    ar = (ARCH[1] - ARCH[0]) / 2
    m = plane_m((0, 0, z0 - W / 2), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    # The jambs: dressed stones, the west one broad, the east one kept narrow by the peephole.
    for x0, x1 in ((ARCH[0] - .15, ARCH[0] + .012), (ARCH[1] - .012, ARCH[1] + .06)):
        ys = [0, .2, .4, aspring]
        for k, (y0, y1) in enumerate(zip(ys, ys[1:])):
            o = .012 if k == 1 else 0
            span('arch jamb', x0 - o, x1 + (o if x1 > ARCH[1] else 0), y0 + .003, y1 - .003, z0 - W - .03, z0 + .03,
                 g.choice([HEARTH, HEARTHB]), bevel=.012)
    ring('arch stone', m, ac, aspring, ar, ar + .1, 0, PI, 9, -W / 2 - .03, W / 2 + .03, [HEARTH, HEARTHB, CELLARC], g, jitter=.012)
    span('arch keystone', ac - .05, ac + .05, atop + .0, atop + .12, z0 - W - .035, z0 + .045, HEARTH, bevel=.012)
    # The spandrels in the rect the hole was cut to, outside the ring.
    r1 = ar + .1
    wm = plane_m((0, 0, z0 - W / 2), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    for side in (-1, 1):
        cx = ARCH[0] if side < 0 else ARCH[1]
        a_lo = math.atan2(math.sqrt(max(r1 * r1 - ar * ar, 0)), side * ar)
        a_hi = math.atan2(atop - aspring, side * math.sqrt(max(r1 * r1 - (atop - aspring) ** 2, 0)))
        n = 5
        pts = [(ac + r1 * math.cos(a_lo + (a_hi - a_lo) * i / n), aspring + r1 * math.sin(a_lo + (a_hi - a_lo) * i / n)) for i in range(n + 1)]
        pts = [(clamp(p[0], ARCH[0], ARCH[1]), min(p[1], atop)) for p in pts]
        fan('arch spandrel', (cx, atop), pts, W, HEARTHB, wm)
    # Under the arch, the cellar's flags run through.
    flags(ARCH[0], ARCH[1], z0 - W, z0, 55)


def flags(x0, x1, z0, z1, seed, cell=.3):
    """Flagstones: a jittered grid of four-sided stones with grout between, their tops at F."""
    g = rng(seed)
    nx = max(1, round((x1 - x0) / cell))
    nz = max(1, round((z1 - z0) / cell))
    jx = [[0.0] * (nz + 1) for _ in range(nx + 1)]
    jz = [[0.0] * (nz + 1) for _ in range(nx + 1)]
    for i in range(1, nx):
        for k in range(nz + 1):
            jx[i][k] = g.uniform(-.3, .3) * (x1 - x0) / nx
    for i in range(nx + 1):
        for k in range(1, nz):
            jz[i][k] = g.uniform(-.3, .3) * (z1 - z0) / nz
    P = lambda i, k: (x0 + (x1 - x0) * i / nx + jx[i][k], z0 + (z1 - z0) * k / nz + jz[i][k])
    for i in range(nx):
        for k in range(nz):
            q = [P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1)]
            cx = sum(p[0] for p in q) / 4
            cz = sum(p[1] for p in q) / 4
            q = [(cx + (p[0] - cx) * .93, cz + (p[1] - cz) * .93) for p in q]
            top = F - g.choice((0, 0, .003, .006))
            hull('flag', [(p[0], F - .024, p[1]) for p in q] + [(p[0], top, p[1]) for p in q],
                 g.choice([FLAGS, FLAGS, FLAGSB, CELLARB]))


def block_wall(axis, plane, inward, u0, u1, y0, y1, seed, holes=(), mats=(CELLAR, CELLAR, CELLARB, CELLARC)):
    """A wall of dressed stone blocks in courses, each block proud of its neighbours by a little."""
    g = rng(seed)
    ys = [y0]
    y = y0
    while y < y1 - .05:
        y = min(y1, y + g.uniform(.1, .145))
        ys.append(y)
    for h in holes:
        for v in (h[2], h[3]):
            if y0 < v < y1:
                ys = [q for q in ys if abs(q - v) > .035 or q in (y0, y1)] + [v]
    ys = sorted(set(ys))
    for ya, yb in zip(ys, ys[1:]):
        for a, b in free_runs(u0, u1, ya, yb, holes):
            wspan('block backing', axis, plane, inward, a, b, ya, yb, -W, -.05, CAVED)
            u = a - g.uniform(0, .25)
            while u < b:
                l = g.uniform(.18, .36)
                ua, ub = max(a, u), min(b, u + l)
                if ub - ua > .03:
                    wspan('block', axis, plane, inward, ua + .005, ub - .005, ya + .005, yb - .005,
                          -.06, g.uniform(0, .014), g.choice(mats), bevel=.01)
                u += l


def cellar(atop, peek):
    x0, x1, z0, z1 = CEL['x0'], CEL['x1'], CEL['z0'], HALL['z0'] - W
    crown = F + CEL['ceiling']
    spring = atop + .01
    hw = (z1 - z0) / 2
    zc = (z0 + z1) / 2
    rise = crown - spring
    R = (hw * hw + rise * rise) / (2 * rise)
    yc = crown - R
    th0 = math.atan2(spring - yc, hw)
    flags(x0, x1, z0, z1, 51)
    # The walls, stone to the springing.
    block_wall('x', z0, 1, x0, x1, 0, spring, 52)
    block_wall('z', x0, 1, z0, z1, 0, spring, 53)
    block_wall('z', x1, -1, z0, z1, 0, spring, 54)
    block_wall('x', z1, -1, x0, x1, 0, spring, 56,
               holes=[(ARCH[0], ARCH[1], 0, atop), (peek[0], peek[1], peek[2], peek[3])])
    # The two ends above the springing: lunettes, the vault's section.
    Ro = R + .07
    arc = [(zc + Ro * math.cos(th0 + (PI - 2 * th0) * i / 12), yc + Ro * math.sin(th0 + (PI - 2 * th0) * i / 12)) for i in range(13)]
    end = [(arc[0][0], spring)] + arc + [(arc[-1][0], spring)]
    for xe in (x0 - W / 2, x1 + W / 2):
        m = plane_m((xe, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0))
        prism('cellar end', end, W, CELLAR, m)
    # Piers under the ribs, against the north wall and, where the arch and the peephole leave room,
    # the south wall.
    ribs = [x0 + .5, (ARCH[0] + ARCH[1]) / 2, x1 - .62]
    for rx in ribs:
        span('vault pier', rx - .05, rx + .05, 0, spring, z0 - .01, z0 + .06, HEARTH, bevel=.01)
        if not (ARCH[0] - .12 < rx < peek[1] + .1):
            span('vault pier', rx - .05, rx + .05, 0, spring, z1 - .06, z1 + .01, HEARTH, bevel=.01)
    with lid():
        g = rng(57)
        n = 10
        for i in range(n):
            t0 = th0 + (PI - 2 * th0) * i / n - (.035 if i == 0 else 0)
            t1 = th0 + (PI - 2 * th0) * (i + 1) / n + (.035 if i == n - 1 else 0)
            u = x0 - W - g.uniform(0, .3)
            while u < x1 + W:
                l = g.uniform(.22, .4)
                ua, ub = max(x0 - W, u) + .004, min(x1 + W, u + l) - .004
                if ub - ua > .04:
                    pts = []
                    for t in (t0 + .006, t1 - .006):
                        for r in (R, R + .09):
                            for xx in (ua, ub):
                                pts.append((xx, yc + (r - (0 if r > R else g.uniform(0, .01))) * math.sin(t), zc + r * math.cos(t)))
                    hull('vault', pts, g.choice([CELLAR, CELLAR, CELLARB, CELLARC]))
                u += l
        for rx in ribs:
            ring('vault rib', plane_m((rx, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0)), zc, yc, R - .045, R + .01,
                 th0, PI - th0, 8, -.05, .05, [HEARTH, HEARTHB], g)
    bars(z0, z1)


def bars(z0, z1):
    """Iron bars across the cellar's east end with a padlocked gate in them: the rum's cage."""
    zb = -4.05
    xa, xb = -2.6, -1.72
    yt = F + 1.1
    g = rng(61)
    # frame: a sill in the flags, a head rail, two stiles
    span('bars sill', xa - .03, xb + .04, F - .01, F + .02, zb - .03, zb + .03, IRON)
    span('bars head', xa - .03, CEL['x1'] + .01, yt, yt + .04, zb - .025, zb + .025, IRON)
    for x in (xa, xb):
        span('bars stile', x - .025, x + .025, F, yt, zb - .025, zb + .025, IRON)
    span('bars stile', xb, CEL['x1'], yt - .9, yt - .86, zb - .02, zb + .02, IRON)
    gate = (-2.32, -1.98)
    x = xa + .08
    while x < xb - .04:
        if not (gate[0] - .02 < x < gate[1] + .02):
            rod('bar', (x, F, zb), (x, yt, zb), .01, IRON, sides=5)
        x += .085
    span('bars rail', xa, xb, F + .5, F + .53, zb - .018, zb + .018, IRON)
    # The gate: its own frame, bars, straps, hinges on the west stile, a hasp and a padlock.
    gx0, gx1 = gate
    for x in (gx0, gx1):
        span('gate stile', x - .018, x + .018, F + .02, yt - .03, zb + .02, zb + .05, IRON)
    for y in (F + .04, F + .5, yt - .06):
        span('gate rail', gx0, gx1, y, y + .028, zb + .022, zb + .048, IRON)
    x = gx0 + .07
    while x < gx1 - .03:
        rod('gate bar', (x, F + .04, zb + .035), (x, yt - .04, zb + .035), .009, IRON, sides=5)
        x += .075
    for y in (F + .15, yt - .2):
        disc('gate hinge', (gx0 - .02, y - .03, zb + .035), .02, .06, IRON, sides=6)
    span('gate hasp', gx1 - .01, gx1 + .06, F + .55, F + .58, zb + .04, zb + .06, IRON)
    span('padlock', gx1 + .03, gx1 + .085, F + .46, F + .52, zb + .045, zb + .075, 'plain:brass', bevel=.006)
    torus('padlock shackle', (gx1 + .0575, F + .53, zb + .06), .02, .005, IRON, seg=8, sides=4, tilt=PI / 2, arc=PI, start=0)
    span('padlock keyhole', gx1 + .052, gx1 + .063, F + .475, F + .5, zb + .074, zb + .078, BLACK)
    # The cage's west side, back to the vault's pier: the bars go round to the north wall.
    z = zb - .09
    while z > z0 + .05:
        rod('bar', (xa, F, z), (xa, yt, z), .01, IRON, sides=5)
        z -= .085
    span('bars head', xa - .025, xa + .025, yt, yt + .04, z0, zb, IRON)
    span('bars sill', xa - .03, xa + .03, F - .01, F + .02, z0, zb, IRON)
    span('bars rail', xa - .018, xa + .018, F + .5, F + .53, z0, zb, IRON)


# ---- the hearth -----------------------------------------------------------------------------------
def hearth():
    """A fireplace built into the rock of the west wall: stone jambs, an arch of voussoirs over the
    firebox, a hearthstone, an oak mantel on corbels and the chimney breast up into the rock."""
    x0 = HALL['x0']
    hz = HEARTHP['z']
    xf = -3.9                       # the front of the jambs; the fire burns at HEARTH.x + 0.3 inside it
    ow, spring = .26, F + .22       # the opening's half width, where its arch springs
    r0, r1 = ow, ow + .1
    g = rng(71)
    # jambs of stacked stones
    for side in (-1, 1):
        za, zb = sorted((hz + side * ow, hz + side * (ow + .3)))
        ys = [0, .14, spring, F + .44, F + .6]
        for k, (y0, y1) in enumerate(zip(ys, ys[1:])):
            o = g.uniform(0, .02)
            span('hearth stone', x0 - .05, xf + o, y0 + .003, y1 - .003, za - (.012 if k % 2 else 0), zb + (.012 if k % 2 else 0),
                 g.choice([HEARTH, HEARTHB]), bevel=.014)
    # the firebox: soot inside
    span('firebox', x0 - .05, x0 + .07, 0, spring + r0, hz - ow, hz + ow, SOOT)
    for side in (-1, 1):
        za = hz + side * ow
        span('firebox', x0, xf - .02, 0, spring + r0, min(za, za - side * .02), max(za, za - side * .02), SOOT)
    span('firebox hood', x0, xf - .19, spring + r0 * .6, F + .66, hz - ow - .01, hz + ow + .01, SOOT)
    span('firebed', x0, xf, F - .02, F + .005, hz - ow, hz + ow, SOOT)
    # the arch over it, its front on the jambs' face, and the spandrels up to the mantel
    m = plane_m((xf, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0))     # own x = z, own z = out into the room
    ring('hearth arch', m, hz, spring, r0, r1, 0, PI, 7, -.2, .012, [HEARTH, HEARTHB], g, gap=.004, jitter=.01)
    top = F + .6
    for side in (-1, 1):
        cz = hz + side * ow
        pts = [(hz + r1 * math.cos(a), spring + r1 * math.sin(a))
               for a in ([PI * i / 8 for i in range(5)] if side > 0 else [PI - PI * i / 8 for i in range(5)])]
        pts = [(clamp(p[0], hz - ow - .1, hz + ow + .1), min(p[1], top)) for p in pts]
        fan('hearth spandrel', (cz + side * .1, top), pts + [(hz, top)], .2, HEARTHB, plane_m((xf - .1, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0)))
    span('hearth lintel stones', x0 - .05, xf - .01, spring + r1 - .02, top, hz - ow - .3, hz - .12, HEARTH, bevel=.012)
    span('hearth lintel stones', x0 - .05, xf - .01, spring + r1 - .02, top, hz + .12, hz + ow + .3, HEARTHB, bevel=.012)
    # the hearthstone, three slabs, worn
    for i, (za, zb) in enumerate(((hz - .62, hz - .18), (hz - .18, hz + .2), (hz + .2, hz + .62))):
        span('hearthstone', xf - .02, xf + .28 - i * .02, 0, F + .01 - i * .002, za + .004, zb - .004, g.choice([HEARTH, HEARTHB]), bevel=.008)
    # the mantel: a baulk of oak on two stone corbels, iron straps round its ends
    span('mantel', x0 - .03, xf + .08, F + .6, F + .68, hz - .72, hz + .72, OAK, bevel=.014)
    for z in (hz - .62, hz + .62):
        span('corbel', x0, xf + .04, F + .5, F + .6, z - .05, z + .05, HEARTH, bevel=.012)
        span('mantel strap', xf + .06, xf + .085, F + .595, F + .685, z - .08, z - .045, IRON)
    # the chimney breast: stone courses narrowing up into the rock of the roof
    y = F + .68
    k = 0
    while y < TOP + .04:
        h = g.uniform(.1, .14)
        t = (y - F - .68) / (TOP - F - .68)
        hw_ = .5 - .14 * t
        proud = .38 - .1 * t
        za = hz - hw_
        while za < hz + hw_ - .02:
            l = min(g.uniform(.2, .34), hz + hw_ - za)
            span('chimney stone', x0 - .05, x0 + proud + g.uniform(-.012, .012), y + .004, min(y + h, TOP + .05) - .004,
                 za + .005, za + l - .005, g.choice([HEARTH, HEARTHB, CELLARC]), bevel=.012)
            za += l
        y += h
        k += 1
    # rock swallowing the breast's shoulders
    for i in range(10):
        side = -1 if i % 2 else 1
        yy = F + .8 + (TOP - F - .8) * (i // 2) / 5 + g.uniform(-.05, .05)
        t = (yy - F - .68) / (TOP - F - .68)
        s = g.uniform(.14, .22)
        rock((x0 + .08, yy, hz + side * (.5 - .14 * t + s * .4)), (s * .6, s, s), g.randrange(1 << 30), rock_mat(g))


# ---- the upper storeys ------------------------------------------------------------------------------
def post(x, z, y0, y1, knees=(), plinth=True, r=None, mat=POSTW):
    """A heavy square post, chamfered, on a stone plinth, with knee braces up to what it carries
    (`knees`: directions (dx, dz) along the beams it stands under) and iron bands."""
    r = POST_R if r is None else r
    span('post', x - r, x + r, y0, y1, z - r, z + r, mat, bevel=.016)
    if plinth and y0 <= F + .01:
        span('post plinth', x - r - .03, x + r + .03, 0, F + .035, z - r - .03, z + r + .03, HEARTHB, bevel=.01)
    for yb in (y0 + .12, y1 - .12):
        if yb - y0 > .1 and y1 - yb > .06:
            span('post band', x - r - .006, x + r + .006, yb - .018, yb + .018, z - r - .006, z + r + .006, IRON)
    for dx, dz in knees:
        a = (x + dx * r, y1 - .3, z + dz * r)
        b = (x + dx * (r + .28), y1 - .01, z + dz * (r + .28))
        rod('knee brace', a, b, .03, RIB, sides=4)
        bolt((x + dx * (r + .005), y1 - .26, z + dz * (r + .005)), 'x' if dx else 'z')


def iron_bracket(wx, wz, nx, nz, y, reach=.5, drop=.45):
    """An iron bracket from a rock wall at (wx, wz), facing (nx, nz), up under a beam at height y
    `reach` out: a strap on the rock, the diagonal and the arm, and their bolts."""
    a = (wx + nx * .01, y - drop, wz + nz * .01)
    b = (wx + nx * (reach - .04), y - .02, wz + nz * (reach - .04))
    rod('bracket', a, b, .014, IRON, sides=4)
    rod('bracket arm', (wx + nx * .0, y - .025, wz + nz * .0), (wx + nx * reach, y - .025, wz + nz * reach), .012, IRON, sides=4)
    span('bracket plate', min(wx, wx + nx * .03) - (.04 if nz else 0), max(wx, wx + nx * .03) + (.04 if nz else 0),
         y - drop - .06, y + .0, min(wz, wz + nz * .03) - (.04 if nx else 0), max(wz, wz + nz * .03) + (.04 if nx else 0), IRON)
    for yy in (y - drop - .03, y - .04):
        bolt((wx + nx * .035, yy, wz + nz * .035), 'x' if nx else 'z', r=.013)


def balcony():
    f = FL['balcony']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    deck(x0, x1 + .06, z0, z1, y, 'z', 201, [DECKZ, DECKZB, DECKZC])
    sub_floor([(x0, x1 + .06, z0, z1)], y)
    ws = next(s for s in STAIRS if s['id'] == 'west-stair')
    # edge beams: along the east edge, and on the south edge beside the stair (the stair's own
    # header where it lands)
    span('edge beam', x1 - .06, x1 + .06, y - BT - SUB - GD, y - BT - SUB, z0, z1, BEAMZ, bevel=.012)
    span('header', x0, x1 + .06, y - BT - SUB - GD, y - BT - SUB, z1 - .06, z1 + .0, BEAMX, bevel=.01)
    nosing(x1 + .04, x1 + .075, z0, z1, y)
    nosing(ws['x1'], x1 + .075, z1 - .02, z1 + .015, y)
    for z in (z0 + .12, z0 + .5, z0 + .88, z1 - .1):
        span('joist', x0 - .1, x1, y - BT - SUB - JD, y - BT - SUB, z - .035, z + .035, BEAMX, bevel=.008)
    for z in (z0 + .5, z1 - .1):
        iron_bracket(x0, z, 1, 0, y - BT - SUB - JD, reach=x1 - x0 - .03, drop=.42)


def crew_loft():
    f = FL['crew-loft']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    lad = next(s for s in STAIRS if s['id'] == 'west-ladder')
    hatch = (lad['x0'], lad['x1'] + .02, lad['z0'] - .05, lad['z1'] + .08)
    for i, r in enumerate(rect_minus(x0, x1 + .06, z0, z1 + .06, [hatch])):
        deck(*r, y, 'z', 210 + i, [DECKZ, DECKZB, DECKZC, DECKZB])
    sub_floor(rect_minus(x0, x1 + .06, z0, z1 + .06, [hatch]), y)
    yb = y - BT - SUB
    span('girder', x1 - .06, x1 + .06, yb - GD, yb, z0, z1 + .06, BEAMZ, bevel=.012)
    span('edge beam', x0, x1 + .06, yb - GD, yb, z1 - .06, z1 + .06, BEAMX, bevel=.012)
    nosing(x1 + .045, x1 + .08, z0, z1 + .08, y)
    nosing(x0, x1 + .08, z1 + .045, z1 + .08, y)
    # the hatch: a coaming round it, the trimmer under its open side
    hx0, hx1, hz0, hz1 = hatch
    span('coaming', hx1, hx1 + .05, y - .09, y + .006, hz0 - .05, hz1 + .05, DARK, bevel=.008)
    span('coaming', x0, hx1 + .05, y - .09, y + .006, hz0 - .05, hz0, DARK, bevel=.008)
    span('coaming', x0, hx1 + .05, y - .09, y + .006, hz1, hz1 + .05, DARK, bevel=.008)
    span('trimmer', hx1 + .01, hx1 + .08, yb - JD, yb, hz0 - .05, hz1 + .05, BEAMZ, bevel=.008)
    for z in (z0 + .14, hz0 - .04, (hz0 + hz1) / 2, hz1 + .04, z1 - .45, z1 - .12):
        xa = hx1 + .08 if hz0 < z < hz1 else x0 - .1
        span('joist', xa, x1 - .06, yb - JD, yb, z - .035, z + .035, BEAMX, bevel=.008)
    for z in (z0 + .14, hz1 + .04, z1 - .45):
        iron_bracket(x0, z, 1, 0, yb - JD, reach=.55, drop=.5)
    # the girder's north end, let into the rock on a bracket of its own
    iron_bracket(x1, z0, 0, 1, yb - GD, reach=.4, drop=.45)


def cabin():
    """The captain's floor over the hold, running on into the oriel: a girder on the posts along
    its west edge, a beam on its south edge over the pool, joists across to the east wall and on
    to the oriel's windows."""
    f, o = FL['cabin'], FL['cabin-oriel']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    yb = y - BT - SUB
    deck(x0 - .06, x1, z0, z1 + .06, y, 'z', 220, [DECKZ, DECKZB, DECKZC, DECKZB])
    deck(o['x0'], o['x1'], o['z0'], o['z1'], y, 'z', 221, [DECKZ, DECKZB, DECKZC])
    sub_floor([(x0 - .06, x1, z0, z1 + .06), (o['x0'], o['x1'], o['z0'], o['z1'])], y)
    span('girder', x0 - .06, x0 + .06, yb - GD, yb, z0, z1 + .06, BEAMZ, bevel=.012)
    span('edge beam', x0 - .06, x1, yb - GD, yb, z1 - .06, z1 + .06, BEAMX, bevel=.012)
    nosing(x0 - .085, x0 - .05, z0, z1 + .085, y)
    nosing(x0 - .085, x1, z1 + .05, z1 + .085, y)
    z = z0 + .12
    while z < z1 - .1:
        xe = o['x1'] if o['z0'] + .05 < z < o['z1'] - .05 else x1
        span('joist', x0 + .06, xe, yb - JD, yb, z - .035, z + .035, BEAMX, bevel=.008)
        z += .42
    # a header across the oriel's mouth, where the east wall is not
    span('header', x1 - .06, x1 + .06, yb - GD, yb, o['z0'], o['z1'], BEAMZ, bevel=.012)


def lookout():
    f = FL['lookout']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    yb = y - BT - SUB
    br = FL['rope-bridge']
    zs = max(z1, br['z1'])
    deck(x0 - .06, x1, z0 - .06, z1, y, 'z', 230, [DECKZ, DECKZB, DECKZC])
    deck(x0 - .06, HALL['x1'], z1, z1 + .06, y, 'z', 231, [DECKZB])
    sub_floor([(x0 - .06, x1, z0 - .06, z1), (x0 - .06, HALL['x1'], z1, z1 + .06)], y)
    span('girder', x0 - .06, x0 + .06, yb - GD, yb, z0 - .06, zs + .02, BEAMZ, bevel=.012)
    span('edge beam', x0 - .06, HALL['x1'], yb - GD, yb, z1 - .06, z1 + .06, BEAMX, bevel=.012)
    span('edge beam', x0 - .06, HALL['x1'], yb - GD, yb, z0 - .06, z0 + .06, BEAMX, bevel=.012)
    nosing(x0 - .085, x0 - .05, z0 - .085, z1, y)
    nosing(x0 - .085, HALL['x1'], z1 + .05, z1 + .085, y)
    nosing(x0 - .085, HALL['x1'], z0 - .085, z0 - .05, y)
    z = z0 + .15
    while z < z1 - .1:
        span('joist', x0 + .06, x1, yb - JD, yb, z - .035, z + .035, BEAMX, bevel=.008)
        z += .42


def rope_bridge():
    """Planks on two foot ropes between the crow's nest and the lookout, hand lines along the
    RAILS lines, hardly sagging: the planks' tops stay within 0.012 of the floor's height."""
    b = FL['rope-bridge']
    x0, x1, z0, z1, y = b['x0'], b['x1'], b['z0'], b['z1'], b['y']
    sag = lambda x: .012 * 4 * (x - x0) * (x1 - x) / ((x1 - x0) ** 2)
    g = rng(241)
    n = 8
    pw = (x1 - x0) / n
    for i in range(n):
        xa, xb = x0 + i * pw + .008, x0 + (i + 1) * pw - .008
        yc = y - sag((xa + xb) / 2)
        tw = g.uniform(-.015, .015)
        hull('bridge plank', [(xa, yc - .028, z0 + .01 + tw), (xb, yc - .028, z0 + .01 + tw), (xa, yc, z0 + .01 + tw), (xb, yc, z0 + .01 + tw),
                              (xa, yc - .028, z1 - .01 + tw), (xb, yc - .028, z1 - .01 + tw), (xa, yc, z1 - .01 + tw), (xb, yc, z1 - .01 + tw)],
             g.choice([WOOD, TREADZ, DECKZB]))
    for z in (z0 + .03, z1 - .03):
        pts = [(x0 + (x1 - x0) * k / 10, y - .035 - sag(x0 + (x1 - x0) * k / 10), z) for k in range(11)]
        tube('bridge foot rope', pts, .011, ROPE, sides=5)
    hr = .26
    for z in (z0, z1):
        pts = [(x0 + (x1 - x0) * k / 10, y + hr - .035 * 4 * (k / 10) * (1 - k / 10), z) for k in range(11)]
        tube('bridge hand line', pts, .011, ROPE, sides=5)
        for k in range(1, 10, 2):
            xx = x0 + (x1 - x0) * k / 10
            rod('bridge cord', (xx, y - .03 - sag(xx), z), (xx, y + hr - .035 * 4 * (k / 10) * (1 - k / 10), z), .004, ROPE, sides=3)
        # the lookout's end: a post on the girder, the line made fast round it
        span('bridge post', x1 - .03, x1 + .03, y - .1, y + hr + .06, z - .03, z + .03, POSTW, bevel=.008)
        torus('bridge lashing', (x1, y + hr - .01, z), .036, .008, ROPE, seg=8, sides=3)
        # the nest's end: lashed to the nest's rail, which is the mast's
        torus('bridge lashing', (x0, y + hr - .01, z), .03, .008, ROPE, seg=8, sides=3)


# ---- ways up ---------------------------------------------------------------------------------------
def stair(s):
    """Treads on two stringers, their tops on the slope the game walks (at the middle of each tread),
    and a handrail on newels along the open side(s)."""
    axis = s['axis']
    lo_y, hi_y = min(s['y0'], s['y1']), max(s['y0'], s['y1'])
    if axis == 'z':
        a0, a1, c0, c1 = s['z0'], s['z1'], s['x0'], s['x1']
    else:
        a0, a1, c0, c1 = s['x0'], s['x1'], s['z0'], s['z1']
    # run from the low end to the high end
    low_at, high_at = (a1, a0) if s['y0'] > s['y1'] else (a0, a1)
    dirn = 1 if high_at > low_at else -1
    run = abs(a1 - a0)
    rise = hi_y - lo_y
    n = max(3, round(rise / .1))
    k = rise / run

    def at(r, c, y):
        a = low_at + dirn * r
        return (c, y, a) if axis == 'z' else (a, y, c)

    ex = (0, 0, dirn) if axis == 'z' else (dirn, 0, 0)
    ez = (1, 0, 0) if axis == 'z' else (0, 0, 1)
    g = rng(sum(map(ord, s['id'])))
    tmat = TREAD if axis == 'z' else TREADZ
    for i in range(n):
        ra, rb = run * i / n, run * (i + 1) / n
        ytop = lo_y + k * (ra + rb) / 2
        pa, pb = at(ra - .015, c0 + .04, ytop - .04), at(rb, c1 - .04, ytop)
        span('tread', min(pa[0], pb[0]), max(pa[0], pb[0]), ytop - .04, ytop, min(pa[2], pb[2]), max(pa[2], pb[2]), g.choice([tmat, tmat, WOOD]), bevel=.006)
    walls = []
    for c in (c0, c1):
        against = (abs(c - HALL['x0']) < .06 or abs(c - HALL['x1']) < .06) if axis == 'z' else \
                  (abs(c - HALL['z0']) < .06 or abs(c - HALL['z1']) < .06)
        walls.append(against)
        cc = c + (.02 if c == c0 else -.02)
        m = plane_m(at(0, cc, 0), ex, (0, 1, 0), ez)
        top, bot = .06, .13
        outline = [(0, lo_y - (F if lo_y > F + .1 else 0) * 0), (0, lo_y + top), (run - top / k, hi_y), (run, hi_y),
                   (run, hi_y - top - bot), (bot / k, lo_y)]
        if lo_y > F + .1:
            outline = [(0, lo_y - bot), (0, lo_y + top), (run - top / k, hi_y), (run, hi_y), (run, hi_y - top - bot)]
        prism('stringer', outline, .04, DARK, m)
    for c, against in zip((c0, c1), walls):
        if against:
            continue
        cc = c + (.02 if c == c0 else -.02)
        hr = .3
        for r in (.04, run - .04):
            ya = lo_y + k * r
            p = at(r, cc, 0)
            span('newel', p[0] - .03, p[0] + .03, ya - .05, ya + hr + .06, p[2] - .03, p[2] + .03, POSTW, bevel=.008)
            ball('newel cap', (p[0], ya + hr + .075, p[2]), .026, DARK, seg=6, rings=4)
        rod('handrail', at(.04, cc, lo_y + k * .04 + hr), at(run - .04, cc, lo_y + k * (run - .04) + hr), .022, OAK, sides=6)
        r = .16
        while r < run - .1:
            ya = lo_y + k * r
            rod('baluster', at(r, cc, ya), at(r, cc, ya + hr), .012, WOOD, sides=4)
            r += .17


def ladder(s):
    axis = s['axis']
    if axis == 'z':
        a0, a1, c0, c1 = s['z0'], s['z1'], s['x0'], s['x1']
    else:
        a0, a1, c0, c1 = s['x0'], s['x1'], s['z0'], s['z1']
    low_at, high_at = (a1, a0) if s['y0'] > s['y1'] else (a0, a1)
    lo_y, hi_y = min(s['y0'], s['y1']), max(s['y0'], s['y1'])

    def P(a, c, y):
        return (c, y, a) if axis == 'z' else (a, y, c)
    ln = math.hypot(high_at - low_at, hi_y - lo_y)
    ux, uy = (high_at - low_at) / ln, (hi_y - lo_y) / ln
    ext = .34
    for c in (c0 + .035, c1 - .035):
        rod('ladder rail', P(low_at, c, lo_y), P(high_at + ux * ext, c, hi_y + uy * ext), .022, WOOD, sides=4)
        disc('ladder shoe', P(low_at, c, lo_y - .005), .03, .02, IRON, sides=6)
    t = .11
    while t < ln - .03:
        a = low_at + ux * t
        y = lo_y + uy * t
        rod('ladder rung', P(a, c0 + .035, y), P(a, c1 - .035, y), .012, OAK, sides=6)
        t += .115
    # made fast at the top with an iron hook each side
    for c in (c0 + .035, c1 - .035):
        torus('ladder hook', P(high_at, c, hi_y + .02), .02, .005, IRON, seg=6, sides=3, tilt=PI / 2)


def rails():
    """Ship's rails along every RAILS line that is not the crow's nest's (the mast brings its own)
    or the bridge's (hand lines, above): posts, a top rail at 0.26, balusters or rope between."""
    nest = FL.get('crows-nest')
    br = FL.get('rope-bridge')
    for r in RAILS:
        x0, z0, x1, z1 = r['line']
        y = r['level']
        if nest and all(nest['x0'] - .01 <= x <= nest['x1'] + .01 and nest['z0'] - .01 <= z <= nest['z1'] + .01
                        for x, z in ((x0, z0), (x1, z1))) and (
                abs(x0 - x1) < 1e-6 and (abs(x0 - nest['x0']) < .01 or abs(x0 - nest['x1']) < .01)
                or abs(z0 - z1) < 1e-6 and (abs(z0 - nest['z0']) < .01 or abs(z0 - nest['z1']) < .01)):
            continue
        if br and abs(z0 - z1) < 1e-6 and br['z0'] - .01 <= z0 <= br['z1'] + .01 and \
                min(x0, x1) >= br['x0'] - .01 and max(x0, x1) <= br['x1'] + .01:
            continue
        rope_between = y > L2 - .01 and min(x0, x1) < 0      # the crew loft: rope, like a ship's side
        rail(x0, z0, x1, z1, y, rope_between)


def rail(x0, z0, x1, z1, y, rope_between=False):
    along_x = abs(z1 - z0) < 1e-6
    a0, a1 = sorted((x0, x1)) if along_x else sorted((z0, z1))
    c = z0 if along_x else x0
    L = a1 - a0
    n = max(1, math.ceil(L / .5))
    top = .26
    g = rng(int(abs(a0 * 97 + c * 31 + y * 13) * 100))

    def S(label, u0, u1, y0, y1, w, mat, bevel=0.0):
        if along_x:
            span(label, u0, u1, y0, y1, c - w, c + w, mat, bevel)
        else:
            span(label, c - w, c + w, y0, y1, u0, u1, mat, bevel)
    for i in range(n + 1):
        u = a0 + L * i / n
        S('rail post', u - .03, u + .03, y - .08, y + top + .045, .03, POSTW, .007)
        p = (u, y + top + .06, c) if along_x else (c, y + top + .06, u)
        ball('rail post cap', p, .022, DARK, seg=6, rings=3)
    S('top rail', a0 - .035, a1 + .035, y + top - .04, y + top, .036, OAK, .01)
    if rope_between:
        for i in range(n):
            ua, ub = a0 + L * i / n + .03, a0 + L * (i + 1) / n - .03
            for hh in (.1, .18):
                pts = []
                for k in range(7):
                    u = ua + (ub - ua) * k / 6
                    yy = y + hh - .03 * 4 * (k / 6) * (1 - k / 6)
                    pts.append((u, yy, c) if along_x else (c, yy, u))
                tube('rail rope', pts, .008, ROPE, sides=4)
    else:
        S('bottom rail', a0 - .03, a1 + .03, y + .005, y + .035, .025, DARK, .006)
        u = a0 + .1
        while u < a1 - .05:
            if min(abs(u - (a0 + L * i / n)) for i in range(n + 1)) > .05:
                S('baluster', u - .012, u + .012, y + .035, y + top - .04, .012, g.choice([WOOD, WOOD, OAK]))
            u += .1


def posts():
    for p in POSTS:
        x, z, y0, y1 = p['x'], p['z'], p['y0'], p['y1']
        top = y1 - BT - SUB - GD
        knees = []
        for f in FLOORS:
            if abs(f['y'] - y1) > .01:
                continue
            if abs(x - f['x0']) < .1 or abs(x - f['x1']) < .1:
                for dz in (-1, 1):
                    if f['z0'] - .01 <= z + dz * .4 <= f['z1'] + .01:
                        knees.append((0, dz))
            if abs(z - f['z0']) < .1 or abs(z - f['z1']) < .1:
                for dx in (-1, 1):
                    if f['x0'] - .01 <= x + dx * .4 <= f['x1'] + .01:
                        knees.append((dx, 0))
        post(x, z, y0, top, knees=sorted(set(knees)))


# ---- the south and east walls: the ship's side --------------------------------------------------
def south_wall():
    z1 = HALL['z1']
    x0, x1 = HALL['x0'] - W, HALL['x1'] + W
    DH = F + 1.1
    juke = KIT['jukebox']['x']
    planked('x', z1, -1, x0, x1, 0, TOP + .05, 301, holes=[(-DOOR, DOOR, 0, DH)], wale_skip=[(juke - .2, juke + .2)])
    # the frames, under the deck beams, broken by the ports, the jukebox and the door
    juke = KIT['jukebox']['x']
    for x in XS:
        gaps = []
        for gp in KIT['gunports']:
            if abs(x - gp['x']) < .3:
                gaps.append((F + .58, F + 1.12))
        if abs(x - juke) < .26:
            gaps.append((0, F + .95))
        if abs(x) < DOOR + .18:
            gaps.append((0, DH + .16))
        rib('x', z1, -1, x, 0, TOP - BEAM_H, gaps)
    door(DH)
    # the cannonball, stuck in the planking with the planks split round it
    cannonball(1.3, F + 1.2, z1, rng(311))


def door(DH):
    """The way out to the harbour (a first version): two heavy posts, a lintel with knees, iron
    straps and the pintles of a door that is not hung, and the night outside it."""
    z1 = HALL['z1']
    for xa, xb in ((-DOOR - .14, -DOOR), (DOOR, DOOR + .14)):
        span('door post', xa, xb, 0, DH + .02, z1 - .06, z1 + W + .02, DARK, bevel=.014)
        for yy in (.14, .5, .86):
            span('door post strap', xa - .005, xb + .005, F + yy, F + yy + .035, z1 - .065, z1 - .045, IRON)
    span('door lintel', -DOOR - .26, DOOR + .26, DH, DH + .16, z1 - .07, z1 + W + .03, DARK, bevel=.016)
    for x in (-DOOR - .18, -DOOR + .1, DOOR - .1, DOOR + .18):
        bolt((x, DH + .08, z1 - .075), 'z', r=.014)
    for side in (-1, 1):
        xp = side * (DOOR + .14)
        m = plane_m((xp, 0, z1 - .03), (side, 0, 0), (0, 1, 0), (0, 0, 1))
        prism('door knee', [(0, DH), (.14, DH), (0, DH - .14)], .06, RIB, m)
    for y in (F + .2, F + .85):
        rod('pintle', (-DOOR + .005, y, z1 - .02), (-DOOR + .005, y + .07, z1 - .02), .012, IRON, sides=6)
    # outside: the quay's boards going off into the night
    span('quay', -DOOR - .3, DOOR + .3, 0, F - .01, z1 + W, z1 + W + .5, DECKB)
    prism('pane', [(-DOOR - .6, 0), (DOOR + .6, 0), (DOOR + .6, DH + .4), (-DOOR - .6, DH + .4)], .02, PANE,
          plane_m((0, 0, z1 + W + .55), (1, 0, 0), (0, 1, 0), (0, 0, 1)))


def cannonball(x, y, zf, g):
    span('shot hole', x - .1, x + .1, y - .09, y + .09, zf - .002, zf + .01, BLACK)
    ball('cannonball', (x, y, zf + .02), .075, IRON, seg=10, rings=6)
    for i in range(13):
        a = TAU * i / 13 + g.uniform(-.2, .2)
        r0 = .07
        L = g.uniform(.07, .19)
        w = g.uniform(.012, .026)
        ca, sa = math.cos(a), math.sin(a)
        pa = (x + ca * r0, y + sa * r0)
        pb = (x + ca * (r0 + L), y + sa * (r0 + L))
        nx, ny = -sa * w, ca * w
        lift = g.uniform(.012, .05)
        hull('splinter', [(pa[0] + nx, pa[1] + ny, zf - .004), (pa[0] - nx, pa[1] - ny, zf - .004),
                          (pa[0] + nx, pa[1] + ny, zf - lift), (pa[0] - nx, pa[1] - ny, zf - lift),
                          (pb[0], pb[1], zf - .002), (pb[0] + nx * .3, pb[1] + ny * .3, zf - .008)],
             SPLINTER if i % 3 else HULLC)
    # the strake it hit, split and bent out
    for s in (-1, 1):
        hull('split plank', [(x + s * .08, y - .03, zf), (x + s * .3, y - .03, zf), (x + s * .08, y + .04, zf),
                             (x + s * .3, y + .03, zf), (x + s * .08, y - .03, zf - .03), (x + s * .08, y + .04, zf - .035),
                             (x + s * .28, y + .0, zf - .006)], HULLC)


def east_wall():
    x1 = HALL['x1']
    z0, z1 = HALL['z0'], HALL['z1']
    oz0, oz1 = ORI['z0'], ORI['z1']
    pz0 = POOL['arch'][0] - .2         # where the timber gives way to the sea arch's rock
    planked('z', x1, -1, z0 - W, oz0, 0, TOP + .05, 321)
    planked('z', x1, -1, oz1, pz0, 0, TOP + .05, 322)
    for z in (.25, 1.15):
        rib('z', x1, -1, z, 0, TOP - BEAM_H, [(L1 - .22, L1 + .01)])
    # heavy posts at the oriel's mouth, from the ground to the ceiling
    for z in (oz0, oz1):
        span('oriel post', x1 - .09, x1 + .09, 0, TOP, z - .09, z + .09, POSTW, bevel=.018)
        for y in (F + .3, L1 + .3, L2 + .3):
            span('oriel post band', x1 - .096, x1 + .096, y, y + .035, z - .096, z + .096, IRON)
    # the oriel: its north wall is the room's, its south and east walls are near
    ox1 = ORI['x1']
    tar = L1 - .24
    # the east wall's three stern windows
    wins = stern_windows()
    planked('z', ox1, -1, oz0 - W, oz1 + W, 0, TOP + .05, 323, holes=[w[0] for w in wins], tar_to=tar)
    planked('x', oz1, -1, x1 + .09, ox1 + W, 0, TOP + .05, 324, tar_to=tar)
    rib('x', oz1, -1, (x1 + ox1) / 2, 0, TOP - .12, [(L1 - .22, L1 + .01), (L2 - .22, L2 + .01)])
    for w in wins:
        window(*w[1:])
    # carved pilasters between the windows and at the ends, on the wall's face
    zs = [wins[0][1] - wins[0][2] - .12] + [(a[1] + b[1]) / 2 for a, b in zip(wins, wins[1:])] + [wins[-1][1] + wins[-1][2] + .12]
    for z in zs:
        span('window pilaster', ox1 - .05, ox1, L1 - .02, L2 - .03, z - .04, z + .04, CARVED, bevel=.01)
        span('pilaster capital', ox1 - .07, ox1, L2 - .1, L2 - .03, z - .055, z + .055, CARVED, bevel=.01)
        span('pilaster base', ox1 - .07, ox1, L1 - .02, L1 + .06, z - .055, z + .055, CARVED, bevel=.01)


def oriel_north():
    x1, ox1, oz0 = HALL['x1'], ORI['x1'], ORI['z0']
    planked('x', oz0, 1, x1 + .09, ox1 + W, 0, TOP + .05, 325, tar_to=L1 - .24)
    rib('x', oz0, 1, (x1 + ox1) / 2, 0, TOP - .12, [(L1 - .22, L1 + .01), (L2 - .22, L2 + .01)])


def stern_windows():
    """Three tall arched windows in the oriel's east wall, their glass from L1 + 0.12 to at most
    L2 - 0.1: (hole, z centre, half width, sill, spring)."""
    oz0, oz1 = ORI['z0'], ORI['z1']
    y0 = L1 + .12
    ytop = L2 - .1
    n = 3
    pitch = (oz1 - oz0) / n
    hw = min(.24, pitch * .5 - .1)
    spring = ytop - hw
    out = []
    for i in range(n):
        zc = oz0 + pitch * (i + .5)
        hole = (zc - hw - .06, zc + hw + .06, y0 - .07, ytop + .06)
        out.append((hole, zc, hw, y0, spring))
    return out


def window(zc, hw, y0, spring):
    xw = ORI['x1']
    m = plane_m((xw, 0, 0), (0, 0, 1), (0, 1, 0), (-1, 0, 0))     # own x = z, own z = into the room
    g = rng(int(zc * 100) & 0xffff)
    top = spring + hw
    # the glass, arched, a little behind the frame's face
    outline = [(zc - hw, y0), (zc + hw, y0)] + [(zc + hw * math.cos(PI * i / 10), spring + hw * math.sin(PI * i / 10)) for i in range(11)]
    prism('pane', outline, .012, PANE, m @ Matrix.Translation((0, 0, -.05)))
    # the frame: sill, jambs, the arched head as a ring of wood, spandrels up to the head rail
    fw = .06
    span('window sill', xw - .07, xw + .02, y0 - .07, y0, zc - hw - .09, zc + hw + .09, DARK, bevel=.01)
    for s in (-1, 1):
        za, zb = sorted((zc + s * hw, zc + s * (hw + fw)))
        span('window jamb', xw - .06, xw + .01, y0, spring, za, zb, DARK, bevel=.008)
    ring('window head', m, zc, spring, hw, hw + fw, 0, PI, 7, -.01, .06, [DARK], g, gap=.004)
    span('window head rail', xw - .065, xw + .01, top + fw - .005, top + fw + .06, zc - hw - fw, zc + hw + fw, DARK, bevel=.008)
    for s in (-1, 1):
        cz = zc + s * (hw + fw)
        pts = [(zc + (hw + fw) * math.cos(a), spring + (hw + fw) * math.sin(a))
               for a in ([PI * i / 10 for i in range(6)] if s > 0 else [PI - PI * i / 10 for i in range(6)])]
        fan('window spandrel', (cz, top + fw), pts + [(zc, top + fw)], .06, DARK, m @ Matrix.Translation((0, 0, .025)))
    # mullion, transom and glazing bars
    span('mullion', xw - .045, xw - .01, y0, top, zc - .016, zc + .016, WOOD)
    span('transom', xw - .045, xw - .01, spring - .02, spring + .01, zc - hw, zc + hw, WOOD)
    for y in (y0 + (spring - y0) * .5,):
        span('glazing bar', xw - .04, xw - .02, y - .006, y + .006, zc - hw, zc + hw, WOOD)
    for dz in (-hw / 2, hw / 2):
        span('glazing bar', xw - .04, xw - .02, y0, spring + math.sqrt(max(hw * hw - dz * dz, 0)) - .01, zc + dz - .006, zc + dz + .006, WOOD)


# ---- the pool, the sea arch ------------------------------------------------------------------------
def water_top():
    """The water's surface, the layout's (F - 0.04: above y = 0, the room's lowest point)."""
    return POOL['surface']


def pool():
    x0, x1, z0, z1 = POOL['x0'], POOL['x1'], POOL['z0'], POOL['z1']
    wy = water_top()
    az0, az1 = POOL['arch']
    span('water', x0, x1 + W, 0, wy, z0, z1 + W, WATER)
    # the edge of the floor: a timber curb, and rocks along it in the water
    jz0, jz1 = JETTY['z0'], JETTY['z1']
    for za, zb in ((z0, jz0), (jz1, z1)):
        span('pool curb', x0 - .05, x0 + .03, 0, F + .004, za, zb, DARK, bevel=.008)
    span('pool curb', x0, x1, 0, F + .004, z0 - .05, z0 + .03, DARK, bevel=.008)
    g = rng(401)
    for i in range(22):
        z = z0 + .05 + (z1 - z0 - .1) * i / 21
        if jz0 - .08 < z < jz1 + .08:
            continue
        s = g.uniform(.06, .12)
        rock((x0 + .02 + s * .5, 0, z + g.uniform(-.03, .03)), (s * .8, g.uniform(.03, .042), s),
             g.randrange(1 << 30), g.choice([ROCK, CAVE, SEAROCK]))
    for i in range(14):
        x = x0 + .1 + (x1 - x0 - .15) * i / 13
        s = g.uniform(.06, .12)
        rock((x + g.uniform(-.03, .03), 0, z0 + .02 + s * .5), (s, g.uniform(.03, .042), s * .8),
             g.randrange(1 << 30), g.choice([ROCK, CAVE, SEAROCK]))
    # along the ship's side in the water, and a few stones standing out of the pool
    for i in range(10):
        x = x0 + .2 + (x1 - x0 - .2) * i / 9
        s = g.uniform(.08, .15)
        rock((x, 0, z1 - s * .4), (s, .035, s * .6), g.randrange(1 << 30), g.choice([SEAROCK, CAVE]))
    for at, s in (((4.2, 3.2), .14), ((3.55, 3.3), .09), ((4.35, 1.95), .11)):
        rock((at[0], 0, at[1]), (s, .06, s * .8), g.randrange(1 << 30), SEAROCK)
    jetty()


def jetty():
    x0, x1, z0, z1, y = JETTY['x0'], JETTY['x1'], JETTY['z0'], JETTY['z1'], JETTY['y']
    g = rng(411)
    n = 10
    pw = (x1 - x0) / n
    for i in range(n):
        xa, xb = x0 + i * pw + .006, x0 + (i + 1) * pw - .006
        dz = g.uniform(-.02, .02)
        span('jetty plank', xa, xb, y - .03, y - g.choice((0, 0, .003)), z0 - .01 + dz, z1 + .01 + dz, g.choice([TREADZ, DECKZB, WOOD]), bevel=.004)
    for z in (z0 + .04, z1 - .04):
        span('jetty stringer', x0 - .05, x1, max(.003, y - .03 - .06), y - .03, z - .025, z + .025, DARK, bevel=.006)
    for x in (x0 + .35, x1 - .04):
        for z in (z0 + .03, z1 - .03):
            top = y - .03 if not (x > x1 - .1 and z > z1 - .05) else y + .3
            disc('pile', (x, 0, z), .035, top, POSTW, sides=7)
            span('pile band', x - .038, x + .038, .03, .05, z - .038, z + .038, IRON)
    # the mooring post at the jetty's end: its pile run up, a cap, a few turns of rope
    xm, zm = x1 - .04, z1 - .03
    disc('mooring cap', (xm, y + .3, zm), .042, .02, DARK, sides=7)
    for k in range(3):
        torus('mooring rope', (xm, y + .12 + k * .025, zm), .04, .008, ROPE, seg=8, sides=3)
    disc('cleat', (x0 + .5, y, z1 - .06), .015, .03, IRON, sides=5)
    span('cleat', x0 + .44, x0 + .56, y + .03, y + .045, z1 - .075, z1 - .045, IRON)


def sea_arch():
    """The east wall over the pool is the cave's again: a rough rock arch opening to the sea, a short
    tunnel of rock out through it, water running on, a few rocks standing in it and the night."""
    x1 = HALL['x1']
    az0, az1 = POOL['arch']
    zc = (az0 + az1) / 2
    hw = (az1 - az0) / 2
    wy = water_top()
    spring = F + .5
    z0 = az0 - .2
    z1 = HALL['z1'] + W
    g = rng(421)

    def inside(z, y):
        """In the opening (with a hand of room)."""
        if y < spring:
            return az0 + .02 < z < az1 - .02
        return (z - zc) ** 2 / (hw - .02) ** 2 + (y - spring) ** 2 / ((hw - .02) * .95) ** 2 < 1

    def keep(u, y, su, sy):
        for zz in (u - su * .8, u, u + su * .8):
            for yy in (y - sy * .8, y, y + sy * .8):
                if inside(zz, yy):
                    return True
        return False
    rock_wall(431, 'z', x1, -1, z0, z1, 0, TOP + .06, lambda u, y: .1 if y > .7 else .02, keep=keep,
              big=(.24, .42), detail=10)
    backing('z', x1, -1, z0, z1, 0, TOP + .06, -.5, -.2, holes=[(az0 - .05, az1 + .05, 0, spring + hw)])
    # the tunnel: rocks round the opening going out, each clear of it
    for xx in (x1 + .15, x1 + .45, x1 + .8, x1 + 1.15):
        for i in range(11):
            a = PI * i / 10
            s = g.uniform(.18, .3)
            rr = hw + s + .03 + (xx - x1) * .12
            z = zc + rr * math.cos(a)
            y = spring + rr * .95 * math.sin(a)
            rock((xx + g.uniform(-.08, .08), y, z), (s * .9, s, s), g.randrange(1 << 30), g.choice([ROCK, CAVE, CAVE, SEAROCK]))
        for side in (-1, 1):
            for y in (.08, .32):
                s = g.uniform(.16, .24)
                rock((xx, y, zc + side * (hw + s + .03 + (xx - x1) * .12)), (s, s * .8, s * .9), g.randrange(1 << 30), g.choice([ROCK, CAVE, SEAROCK]))
    # the sea beyond, and a few rocks standing in it
    span('water', x1 + W, 7.0, 0, wy, az0 - .3, az1 + .3, WATER)
    span('water', 5.6, 7.6, 0, wy, az0 - 1.3, az1 + 1.3, WATER)
    for (x, z, s, h) in ((5.9, 1.55, .22, .25), (6.3, 3.35, .3, .4), (6.7, 2.2, .16, .12), (6.5, 1.3, .35, .5),
                         (6.9, 3.0, .12, .1), (7.1, 1.8, .25, .3)):
        rock((x, 0, z), (s, h * .6 + .04, s * .8), g.randrange(1 << 30), SEAROCK)
    prism('pane', [(az0 - 2.2, 0), (az1 + 2.2, 0), (az1 + 2.2, 2.6), (az0 - 2.2, 2.6)], .04, PANE,
          plane_m((7.55, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0)))


# ---- the snug -------------------------------------------------------------------------------------
def snug():
    s = FL['snug']
    x0, x1, z0, z1, y = s['x0'], s['x1'], s['z0'], s['z1'], s['y']
    platform(s, ['e'], 501)
    wall_top = y + .5
    # the half wall along its north side: planks, stiles, a rail on top
    span('snug wall', x0, x1, 0, wall_top, z0 - .04, z0 + .04, DARK)
    g = rng(503)
    yy = 0
    while yy < wall_top - .02:
        h = min(g.uniform(.1, .13), wall_top - yy)
        for side in (-1, 1):
            zz = z0 + side * .045
            span('snug strake', x0, x1, yy + .003, yy + h - .003, min(zz, zz + side * .012), max(zz, zz + side * .012),
                 g.choice([TAR, TARB, TARC]) if yy < F + .2 else g.choice([HULLW, HULLB]))
        yy += h
    for x in [x0 + .5 + k * .6 for k in range(int((x1 - x0 - .6) / .6) + 1)]:
        span('snug stile', x - .03, x + .03, 0, wall_top, z0 - .065, z0 + .065, RIB, bevel=.008)
    span('snug rail', x0, x1 + .02, wall_top, wall_top + .045, z0 - .075, z0 + .075, OAK, bevel=.012)
    # the turned post at its corner, up to its low ceiling
    ch = y + 1.25
    lathe('snug post', [(0, 0), (.075, 0), (.075, .05), (.058, .08), (.055, .3), (.07, .36), (.07, .4), (.05, .46),
                        (.046, .8), (.06, .86), (.045, .92), (.045, ch - .12), (.06, ch - .09), (.07, ch - .04), (.07, ch), (0, ch)],
          POSTW, at=(x1, 0, z0), sides=8)
    with lid():
        deck(x0, x1 + .07, z0 - .07, z1, ch + .045, 'z', 505, [CEIL, CEILB], thick=.045, width=(.13, .17))
        span('snug ceiling', x0, x1 + .07, ch + .045, ch + .07, z0 - .07, z1, DARK)
        for x in (x0 + .45, x0 + 1.05, x0 + 1.55):
            span('snug beam', x - .045, x + .045, ch - .085, ch, z0, z1, BEAMZ, bevel=.01)
        span('snug beam', x1 - .06, x1 + .07, ch - .12, ch + .045, z0 - .07, z1, BEAMZ, bevel=.012)
        span('snug beam', x0, x1 + .07, ch - .12, ch + .045, z0 - .07, z0 + .06, BEAMX, bevel=.012)


# ---- the ceiling ---------------------------------------------------------------------------------
def ceiling():
    with lid():
        x0, x1, z0, z1 = HALL['x0'] - W, HALL['x1'] + W, HALL['z0'] - W, HALL['z1'] + W
        deck(x0, x1, z0, z1, TOP + .035, 'z', 601, [CEIL, CEIL, CEILB], thick=.035, width=(.14, .19), label='ceiling')
        span('ceiling', x0, x1, TOP + .035, TOP + .08, z0, z1, DARK)
        ox0, ox1, oz0, oz1 = HALL['x1'] + W, ORI['x1'] + W, ORI['z0'] - W, ORI['z1'] + W
        deck(ox0, ox1, oz0, oz1, TOP + .035, 'z', 602, [CEIL, CEILB], thick=.035, width=(.14, .19), label='ceiling')
        span('ceiling', ox0, ox1, TOP + .035, TOP + .08, oz0, oz1, DARK)
        cave_roof()
        yb = TOP - BEAM_H
        edge = lambda x: -2.3 + .14 * math.sin(x * 1.7) + .08 * math.cos(x * 3.1)
        for x in XS:
            span('beam', x - .065, x + .065, yb, TOP, edge(x) - .25, HALL['z1'], BEAMZ, bevel=.014)
            hanging_knee('x', HALL['z1'], -1, x, yb)
            for z in (edge(x) + .4, HALL['z1'] - .5):
                span('beam strap', x - .07, x + .07, yb - .006, yb + .03, z - .02, z + .02, IRON)
        # carlings between the beams, and the mast's partners
        for z in (-1.35, 0.35, 1.45, 2.55):
            for xa, xb in zip(XS, XS[1:] + [HALL['x1']]):
                span('carling', xa + .065, xb - (.065 if xb != HALL['x1'] else 0), TOP - .1, TOP, z - .04, z + .04, BEAMX, bevel=.008)
        mx, mz = KIT['mast']['x'], KIT['mast']['z']
        xa, xb = max(x for x in XS if x < mx), min(x for x in XS if x > mx)
        for z in (mz - .16, mz + .16):
            span('mast partner', xa + .065, xb - .065, TOP - .13, TOP, z - .05, z + .05, BEAMX, bevel=.01)
        for x in (mx - .16, mx + .16):
            span('mast partner', x - .04, x + .04, TOP - .11, TOP, mz - .11, mz + .11, BEAMZ, bevel=.008)
        # wall plates on the timber walls, knees under the carlings at the east wall
        span('wall plate', HALL['x0'], HALL['x1'], TOP - .12, TOP, HALL['z1'] - .09, HALL['z1'], DARK, bevel=.01)
        span('wall plate', HALL['x1'] - .09, HALL['x1'], TOP - .12, TOP, HALL['z0'], POOL['arch'][0] - .2, DARK, bevel=.01)
        for z in (0.35, 1.45):
            hanging_knee('z', HALL['x1'], -1, z, TOP - .1, arm=.26, leg=.3)
        # over the oriel: beams across it, and a knee at each end on its walls
        for z in (ORI['z0'] + .7, (ORI['z0'] + ORI['z1']) / 2, ORI['z1'] - .7):
            span('beam', HALL['x1'], ORI['x1'], yb + .02, TOP, z - .06, z + .06, BEAMX, bevel=.012)
            hanging_knee('z', ORI['x1'], -1, z, yb + .02, arm=.26, leg=.3)


# ---- build ---------------------------------------------------------------------------------------
def build(L):
    _init(L)
    ground()
    platform(FL['terrace'], ['s', 'w', 'e'], 180)
    atop, aspring, peek = cave_walls()
    cellar_arch(atop, aspring)
    cellar(atop, peek)
    hearth()
    snug()
    balcony()
    crew_loft()
    cabin()
    lookout()
    rope_bridge()
    for s in STAIRS:
        (ladder if s['kind'] == 'ladder' else stair)(s)
    rails()
    posts()
    oriel_north()
    pool()
    with group('near'):
        south_wall()
        east_wall()
        sea_arch()
    ceiling()
    print(f'shell: {sum(geom.TRIS.values())} triangles')
