"""The Salty Kraken's shell: the hall of wrecked ships and the cascade at its bottom, and nothing that
stands in it. At the bottom the cascade round the atrium - the ground, the pit and the bar terrace
with their retaining walls (the bar's is a ship's side), the stairs, the pool under the arch to the
sea, the cellar and its cage, the hearth; over it the hall: fieldstone on every wall up to STONE_TOP
and ship's timber above (patched planks, curved ship's ribs, portholes), a pitched roof on heavy
trusses, galleries of broken ship's decks on old masts at two heights along the west and east walls
with gangplanks and ships' ladders between them, rope bridges across the middle to the crow's nest,
and a ship's bow broken off and jutting out of the north gable over the bar. The furniture and the
clutter are dressing.py's; the ship's parts (stern, counter, mast and crow's nest, gun ports, jukebox,
figurehead, lamps) are the kit's.

Every number comes from web/js/kraken-layout.js (handed in as `L`): a floor is built at the height
it is walked at, a stair's treads (a gangplank's planks, a ladder's steps) sit on the slope the game
walks, a rail stands on the line that is its blocker, a retaining wall on the edge where a solid
terrace stops, a truss at every TRUSSES z with its tie beam on EAVES. What is only this file's is how
things are made: plank widths, stone sizes, where a joist or a rib goes, the roof's rise from the
wall plate to the boards (ROOF_LIFT).

Groups (scripts/krakenkit/geom.py): the roof and everything hanging from it is the lid (`lid()`), the
south and east walls and whatever is fixed to them (the door, the portholes and ribs there, the sea
arch, the ledgers on them) are `near` (the cutaway preview leaves them out), the rest is the room.

First versions, each in a function of its own so it can be replaced alone once there is a
reference drawing for it: `stair` (with its handrail), `gangplank`, `ships_ladder`, `rope_bridge`,
`hearth`, `sea_arch`, `porthole`, `skylight`, `door` / `door_leaf` and `broken_bow`. They are kept
simple and in proportion; the structure round them (terraces, retaining walls, the hull, the walls,
decks, joists, masts, rails, trusses, the pool's rim, the cellar's vault) is the finished part.

Rules this keeps, all from the layout's side:
- y = 0 is the lowest point; the ground's boards top out at F; the pool's water at POOL.surface.
- Nothing of a wall stands in front of its wall line below head height: the fieldstone's faces are
  on it or behind it, the timber's planks on it; only the ribs, ledgers and the sill beam stand
  proud, and nowhere more than 0.15 below a body's head over the floor next to them.
- The roof's lowest timbers, the tie beams, have their undersides on EAVES: a body on the upper
  galleries (LEVEL.top + 0.62) and on the bridges passes under them.
"""
import math
from mathutils import Matrix, Vector
import geom
from geom import (PI, TAU, TAR, HULLW, DECKP, STAGEP, CEIL, BEAMZ, BEAMX, OAK, DARK, WOOD, RIB, CARVED,
                  HEARTH, CELLAR, FLAGS, SOOT, IRON, ROPE, PANE, BLACK, material,
                  group, lid, box, rod, disc, ball, lathe, prism, hull, tube, torus, rng)

ROCK, ROCKW = 'stone:rock', 'stone:rock-warm'
ROCKL = material('stone:rock-light', 0x7a6c5c)
CAVE = material('stone:cave', 0x4a4650)
CAVED = material('stone:cave-deep', 0x2c2a30)
SEAROCK = material('stone:sea-rock', 0x34373e)
# The fieldstone: grey boulders of every shade set in a lighter mortar.
MORTAR = material('stone:mortar', 0x5f5a54)
FIELD = [material('stone:field-a', 0x6f6d6b), material('stone:field-b', 0x827d76),
         material('stone:field-c', 0x5d5c60), material('stone:field-d', 0x918b83),
         material('stone:field-e', 0x6a6560)]
WATER = material('plain:water', 0x173f47)
DECKB = material('plank:deck-b', 0x553823)
DECKC = material('plank:deck-c', 0x684630)
DECKZ = material('plankZ:deck', 0x5e3e27)
DECKZB = material('plankZ:deck-b', 0x6c4a2e)
DECKZC = material('plankZ:deck-c', 0x543722)
DECKZD = material('plankZ:deck-d', 0x77553a)          # a sun-bleached plank from another ship
TREAD = material('plank:tread', 0x6a4a2e)
TREADZ = material('plankZ:tread', 0x6a4a2e)
HULLB = material('plank:hull-b', 0x5f412a)
HULLC = material('plank:hull-c', 0x7a5638)
HULLD = material('plank:hull-d', 0x4f5a55)            # a patch of old painted planking, green-grey
HULLE = material('plank:hull-e', 0x7a4a34)            # and one of faded red
TARB = material('plank:tar-b', 0x251b14)
TARC = material('plank:tar-c', 0x3a2a1e)
CELLARB = material('stone:cellar-b', 0x58514a)
CELLARC = material('stone:cellar-c', 0x75695c)
HEARTHB = material('stone:hearth-b', 0x6c6258)
FLAGSB = material('stone:flags-b', 0x6c645a)
SPLINTER = material('plain:splinter', 0xa07c52)
POSTW = material('plain:post', 0x3e2a1c)
SPAR = material('plank:mast', 0x3a2618)               # the kit's mast's own colour: old masts are masts
STRAKES = [material('plank:counter-a', 0x6e4c31), material('plank:counter-b', 0x5f412a),
           material('plank:counter-c', 0x684630), material('plank:counter-d', 0x5a3d28)]
LIDW = material('plank:portlid', 0x33241a)
STRAP = material('plain:strap', 0x5b5d61)
BRONZE = 'plain:bronze'
BRASS = 'plain:brass'
PATCHED = (HULLW, HULLW, HULLB, HULLC, HULLB, TARC, DECKC, HULLW, HULLC)

# ---- the layout -------------------------------------------------------------------------------
F = G = P = B = C = U = TOP = W = DOOR = EAVES = STONE_TOP = 0.0
HALL = CEL = POOL = JETTY = KIT = HEARTHP = BARS = None
ARCH = FLOORS = STAIRS = RAILS = POSTS = SLOOPS = TRUSSES = None
POST_R = .09
FL, ST = {}, {}

BT, SUB = .035, .025        # a floor's boards and the sub-floor under them
JD = .1                     # a joist's depth under the sub-floor
GD = .14                    # an edge beam's (girder's) depth
SILL = .16                  # the timber sill on the fieldstone, under the planking
ROOF_LIFT = .34             # the roof boards over the wall plate at the eaves: the tie beam's height
                            # and the rafter's foot on it
TIE_D = .24                 # a tie beam's depth, its underside on EAVES
ROCK_EAST = 1.6             # south of this the east wall is the sea arch's
PURLINS = (2.6, 5.4, 7.8)   # along z under the roof boards, each side of the ridge
ARCH_SPRING, ARCH_RISE = .81, 1.95
BOW = False                 # the placeholder bow on the north gable; the kit's bow (bow.py) is placed now


def _init(L):
    global F, G, P, B, C, U, TOP, W, DOOR, EAVES, STONE_TOP, HALL, CEL, POOL, JETTY, KIT, HEARTHP, BARS
    global ARCH, FLOORS, STAIRS, RAILS, POSTS, SLOOPS, TRUSSES, POST_R, FL, ST, ARCH_SPRING
    F = L['F']
    lv = L['LEVEL']
    G, P, B, C, U = lv['ground'], lv['pit'], lv['bar'], lv['captain'], lv['top']
    TOP, W, DOOR = L['TOP'], L['WALL'], L['DOOR_HALF']
    EAVES, STONE_TOP = L['EAVES'], L['STONE_TOP']
    HALL, CEL = L['HALL'], L['CELLAR']
    POOL, JETTY, KIT, HEARTHP, BARS = L['POOL'], L['JETTY'], L['KIT'], L['HEARTH'], L['CELLAR_BARS']
    ARCH, FLOORS, STAIRS, RAILS, POSTS = L['ARCH'], L['FLOORS'], L['STAIRS'], L['RAILS'], L['POSTS']
    SLOOPS = L.get('SLOOPS', [])
    TRUSSES = L['TRUSSES']
    SKYLIGHTS[:] = [tuple(sk) for sk in L['SKYLIGHTS']]
    POST_R = L.get('POST_R', .09)
    FL = {f['id']: f for f in FLOORS}
    ST = {s['id']: s for s in STAIRS}
    ARCH_SPRING = F + .75


# ---- small helpers ---------------------------------------------------------------------------
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

def clamp(v, a, b):
    return a if v < a else b if v > b else v

def lerp(a, b, t):
    return a + (b - a) * t

def smooth(t):
    t = clamp(t, 0, 1)
    return t * t * (3 - 2 * t)


# Value noise, for the rock: smooth lumps in the face and patches of colour that belong together,
# where a random colour per stone was confetti.

def _h(i, j, s):
    n = (i * 374761393 + j * 668265263 + s * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffff) / 0xffffff

def vnoise(x, y, s):
    i, j = math.floor(x), math.floor(y)
    fx, fy = x - i, y - j
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = _h(i, j, s), _h(i + 1, j, s), _h(i, j + 1, s), _h(i + 1, j + 1, s)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy

def fbm(x, y, s, octaves=3):
    tot, amp, norm = 0.0, 1.0, 0.0
    for k in range(octaves):
        tot += amp * vnoise(x * (2 ** k), y * (2 ** k), s + k * 101)
        norm += amp
        amp *= .5
    return tot / norm


# Directions spread evenly over a sphere (a Fibonacci lattice): a boulder is the hull of these,
# each pushed in a little. geom.rock's twelve random points came out as shards and slabs; this is
# a chunk of rock with facets, rounder but still broken.
_DIRS = []
for _i in range(26):
    _yy = 1 - 2 * (_i + .5) / 26
    _rr = math.sqrt(1 - _yy * _yy)
    _a = _i * 2.399963
    _DIRS.append((_rr * math.cos(_a), _yy, _rr * math.sin(_a)))

def rock(at, size, seed, mat=ROCK, lift=True, flat=True):
    """A boulder in the box `size` (semi-axes) round `at`, lifted where it would reach below
    y = 0 (the room's lowest point). `flat=False` leaves out the knocked-off face, for a rock that
    has to reach all the way up into the vault it hangs from."""
    g = rng(seed)
    x, y, z = at
    sx, sy, sz = size
    if lift:
        y = max(y, sy + .001)
    a = g.uniform(0, TAU)
    ca, sa = math.cos(a), math.sin(a)
    flat = g.uniform(.55, .9) if flat else 2.0   # a face knocked flat somewhere, as broken rock has
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

def rock_mat(g):
    v = g.random()
    return ROCK if v < .45 else ROCKW if v < .8 else CAVE if v < .93 else ROCKL

def patch_mat(n):
    """A rock colour from a noise value, so neighbouring facets share it."""
    return CAVE if n < .36 else ROCK if n < .5 else ROCKW if n < .64 else ROCKL if n < .7 else ROCK

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
    holes = [(max(h[0], x0), min(h[1], x1), max(h[2], z0), min(h[3], z1)) for h in holes]
    holes = [h for h in holes if h[1] > h[0] and h[3] > h[2]]
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

def ring(label, m, cx, cy, r0, r1, a0, a1, n, d0, d1, mats, g, gap=.01, jitter=0.0, ry=1.0):
    """An arch of n voussoirs in a frame's xy plane, from d0 to d1 along its z: every stone a
    convex hull of its own, a seam between them. `ry` squashes it into an ellipse."""
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
                    pts.append((cx + r * math.cos(t), cy + r * ry * math.sin(t), d))
        hull(label, pts, g.choice(mats), m)

def fan(label, apex, pts, depth, mat, m):
    """The region between a corner and a curve, as triangles from the corner: convex pieces."""
    for p, q in zip(pts, pts[1:]):
        if abs((p[0] - apex[0]) * (q[1] - apex[1]) - (p[1] - apex[1]) * (q[0] - apex[0])) < 1e-5:
            continue
        prism(label, [apex, p, q], depth, mat, m)

def bolt(at, axis, r=.011, mat=IRON):
    """A square bolt head on a face; `axis` the face's normal ('x', 'y' or 'z')."""
    s = {'x': (.012, r * 2, r * 2), 'y': (r * 2, .012, r * 2), 'z': (r * 2, r * 2, .012)}[axis]
    box('bolt', at, s, mat)

def slope_y(s, x, z):
    if s['axis'] == 'z':
        t = (z - s['z0']) / (s['z1'] - s['z0'])
    else:
        t = (x - s['x0']) / (s['x1'] - s['x0'])
    t = clamp(t, 0, 1)
    return s['y0'] + (s['y1'] - s['y0']) * t

def in_rect(x, z, r, pad=0.0):
    return r['x0'] - pad <= x <= r['x1'] + pad and r['z0'] - pad <= z <= r['z1'] + pad

def roof_y(x):
    """The underside of the roof boards: TOP over the ridge (x = 0), ROOF_LIFT over EAVES at the
    west and east walls, straight between. Past the walls it goes on down (the rafters' feet)."""
    lo = EAVES + ROOF_LIFT
    return lo + (TOP - lo) * (1 - abs(x) / HALL['x1'])


def wall_top(axis, plane, u):
    """Where a wall stops under the roof: the roof's line over a gable (north, south), the boards'
    underside over the eaves (west, east)."""
    return roof_y(clamp(u, HALL['x0'], HALL['x1'])) if axis == 'x' else roof_y(HALL['x1'])


def grid(a0, a1, step):
    n = max(1, round((a1 - a0) / step))
    return [a0 + (a1 - a0) * i / n for i in range(n + 1)]


def jit(i, j, s, amount):
    return (_h(i, j, s) - .5) * 2 * amount, (_h(i, j, s + 1) - .5) * 2 * amount


def wall_m(axis, plane, inward):
    """The frame of a wall's face: own x along the wall, own y up, own z into the room."""
    if axis == 'x':
        return plane_m((0, 0, plane), (1, 0, 0), (0, 1, 0), (0, 0, inward))
    return plane_m((plane, 0, 0), (0, 0, 1), (0, 1, 0), (inward, 0, 0))


def bent_timber(label, pts, side, w, t, mat):
    """A timber along a path of points: `w` wide across the path in the plane it bends in, `t` thick
    along `side` (the plane's normal), as convex pieces from one point's section to the next."""
    side = Vector(side).normalized()
    P_ = [Vector(p) for p in pts]
    n = len(P_)
    secs = []
    for i, p in enumerate(P_):
        tan = (P_[min(i + 1, n - 1)] - P_[max(i - 1, 0)]).normalized()
        wd = side.cross(tan).normalized()
        secs.append([p + wd * w / 2 + side * t / 2, p - wd * w / 2 + side * t / 2,
                     p - wd * w / 2 - side * t / 2, p + wd * w / 2 - side * t / 2])
    for A, Bq in zip(secs, secs[1:]):
        hull(label, [tuple(v) for v in A + Bq], mat)


def knee(m, yb, arm=.3, leg=.34, t=.08, r=.2, thick=.1, mat=RIB):
    """The L of a knee in a frame's xy plane: a leg down own x = 0..t from yb, an arm along own x
    under yb, the throat between them curved. `thick` along own z."""
    prism('knee', [(0, yb), (0, yb - leg), (t, yb - leg), (t, yb)], thick, mat, m)
    prism('knee', [(t, yb), (t, yb - t), (arm, yb - t), (arm, yb)], thick, mat, m)
    c = (t + r, yb - t - r)
    arc = [(c[0] - r * math.cos((PI / 2) * i / 6), c[1] + r * math.sin((PI / 2) * i / 6)) for i in range(7)]
    fan('knee', (t, yb - t), arc, thick, mat, m)
    for s_, y in ((t * .5, yb - leg + .07), (arm - .06, yb - t * .5)):
        p = m @ Vector((s_, y, thick / 2 + .004))
        box('knee bolt', tuple(p), (.02, .02, .02), IRON)


def hanging_knee(axis, plane, inward, u, yb, arm=.3, leg=.34, t=.08, r=.2, thick=.1, mat=RIB):
    """A knee under a beam where it meets a wall, in the wall's normal plane at u."""
    if axis == 'x':
        m = plane_m((u, 0, plane), (0, 0, inward), (0, 1, 0), (1, 0, 0))
    else:
        m = plane_m((plane, 0, u), (inward, 0, 0), (0, 1, 0), (0, 0, 1))
    knee(m, yb, arm, leg, t, r, thick, mat)


# ---- floors ----------------------------------------------------------------------------------
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

def stair_rect(s, pad=0.0):
    return (s['x0'] - pad, s['x1'] + pad, s['z0'] - pad, s['z1'] + pad)

def ground():
    """The slab from y = 0 to the boards, under the hall and the cellar, less the pool; the ground's
    boards everywhere the terraces and the stone steps do not stand; flags before the hearth; the
    door's threshold."""
    x0, x1, z0, z1 = HALL['x0'] - W, HALL['x1'] + W, HALL['z0'] - W, HALL['z1'] + W
    px0, pz0 = POOL['x0'], POOL['z0']
    for a, b, c, d in [(x0, px0, z0, z1), (px0, x1, z0, pz0)]:
        span('slab', a, b, 0, F - BT, c, d, DARK)
    span('slab', CEL['x0'] - W, CEL['x1'] + W, 0, F - .025, CEL['z0'] - W, HALL['z0'] - W, DARK)
    hz = HEARTHP['z']
    hearth_flags = (HALL['x0'], -7.9, hz - 1.1, hz + 1.1)
    holes = [(f['x0'], f['x1'], f['z0'], f['z1']) for f in FLOORS if f.get('solid')]
    holes += [(POOL['x0'], x1, POOL['z0'], z1), hearth_flags]
    holes += [stair_rect(s) for s in STAIRS if min(s['y0'], s['y1']) <= G + .01 and s['kind'] == 'stair'
              and s['id'] != 'bar-captain']
    for i, (a, b, c, d) in enumerate(rect_minus(HALL['x0'], HALL['x1'], HALL['z0'], HALL['z1'], holes)):
        hold = a >= 5.4 and d <= POOL['z0'] + .01
        mats = [DECKB, DECKB, DECKP, TARC] if hold else [DECKP, DECKP, DECKB, DECKC]
        deck(a, b, c, d, F, 'x', 100 + i, mats, lmin=1.2, lmax=2.6)
    flags(*hearth_flags, 57, cell=.34)
    # A worn stone threshold in the door.
    span('threshold', -DOOR, DOOR, 0, F + .008, HALL['z1'] - .01, HALL['z1'] + W + .02, HEARTH, bevel=.01)
    span('threshold', -DOOR + .05, DOOR - .05, F + .004, F + .012, HALL['z1'] + .02, HALL['z1'] + W - .02, HEARTHB)

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
    P_ = lambda i, k: (x0 + (x1 - x0) * i / nx + jx[i][k], z0 + (z1 - z0) * k / nz + jz[i][k])
    for i in range(nx):
        for k in range(nz):
            q = [P_(i, k), P_(i + 1, k), P_(i + 1, k + 1), P_(i, k + 1)]
            cx = sum(p[0] for p in q) / 4
            cz = sum(p[1] for p in q) / 4
            q = [(cx + (p[0] - cx) * .93, cz + (p[1] - cz) * .93) for p in q]
            top = F - g.choice((0, 0, .003, .006))
            hull('flag', [(p[0], F - .024, p[1]) for p in q] + [(p[0], top, p[1]) for p in q],
                 g.choice([FLAGS, FLAGS, FLAGSB, CELLARB]))


# ---- timber ----------------------------------------------------------------------------------
def planked(axis, plane, inward, u0, u1, y0, y1, seed, holes=(), tar_to=None, wale=True, wale_skip=(),
            upper=(HULLW, HULLW, HULLW, HULLB, HULLB, HULLC), lower=(TAR, TAR, TARB, TARC), top=None,
            strake=(.1, .135), butt=(1.7, 3.2), back=W):
    """A wall of ship's planking: strakes of 0.1-0.135 with butt joints staggered along it, tarred
    below the wale and lighter above, a dark backing the wall's thickness behind their faces, and
    the wale itself, a rubbing strake standing proud. Holes are (u0, u1, y0, y1). `top(u)` cuts the
    wall off under a vault that is not level (to the next strake above it)."""
    g = rng(seed)
    tar_to = F + .44 if tar_to is None else tar_to
    ys = [y0]
    y = y0
    while y < y1 - .04:
        y = min(y1, y + g.uniform(*strake))
        ys.append(y)
    extra = [tar_to, tar_to + .07] if wale else [tar_to]
    for h in holes:
        extra += [h[2], h[3]]
    for v in extra:
        if y0 < v < y1:
            ys = [q for q in ys if abs(q - v) > .03 or q in (y0, y1)] + [v]
    ys = sorted(set(ys))
    cut = []
    if top is not None:
        # a hole over every stretch where this strake is already in the vault
        n = max(2, int((u1 - u0) / .25))
        cut_at = [(u0 + (u1 - u0) * k / n, u0 + (u1 - u0) * (k + 1) / n) for k in range(n)]
    for ya, yb in zip(ys, ys[1:]):
        mats = lower if yb <= tar_to + .075 else upper
        hl = list(holes)
        if top is not None:
            hl += [(a, b, ya, yb) for a, b in cut_at if ya > max(top(a), top(b)) + .02]
        for a, b in free_runs(u0, u1, ya, yb, hl):
            wspan('wall', axis, plane, inward, a, b, ya, yb, -back, -.018, DARK)
            u = a - g.uniform(0, butt[1] * .75)
            while u < b:
                l = g.uniform(*butt)
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

def rib(axis, plane, inward, u, y0, y1, gaps=(), wide=.1, proud=.07):
    """A ship's frame standing in front of the planking, bolted through it, broken where a port or
    a door or a ledger goes across the wall."""
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

def bulkhead(axis, plane, inward, u0, u1, y0, y1, seed, posts=1.1, mats=(TAR, TARB, TARC, DARK), cap=True):
    """The timber face of a solid terrace: heavy planks laid on edge behind square posts driven in
    front of them, iron-bolted, a cap board over the top edge."""
    planked(axis, plane, inward, u0, u1, y0, y1, seed, wale=False, tar_to=y1, lower=mats, upper=mats,
            strake=(.13, .19), butt=(1.2, 2.4), back=.1)
    n = max(1, round((u1 - u0) / posts))
    for k in range(n + 1):
        u = u0 + .08 + (u1 - u0 - .16) * k / n
        wspan('bulkhead post', axis, plane, inward, u - .05, u + .05, 0, y1 - .02, -.02, .05, POSTW, bevel=.01)
        for yy in (y0 + .12, y1 - .14):
            if yy > y0 + .06:
                wspan('bulkhead bolt', axis, plane, inward, u - .012, u + .012, yy - .012, yy + .012, .05, .058, IRON)
    if cap:
        wspan('bulkhead cap', axis, plane, inward, u0, u1, y1 - .05, y1 + .002, -.1, .03, DARK, bevel=.008)

def stonework(axis, plane, inward, u0, u1, y0, y1, seed, mats=(CELLAR, CELLAR, CELLARB, CELLARC, HEARTHB)):
    """The face of a solid terrace laid up in rough stone: courses of blocks of every length, each
    a little proud of or behind its neighbours, a timber cap on the top."""
    g = rng(seed)
    ys = [y0]
    y = y0
    while y < y1 - .08:
        y = min(y1 - .05, y + g.uniform(.12, .2))
        ys.append(y)
    wspan('stone backing', axis, plane, inward, u0, u1, y0, y1, -.12, -.03, CAVED)
    for ya, yb in zip(ys, ys[1:]):
        u = u0 - g.uniform(0, .3)
        while u < u1:
            l = g.uniform(.22, .48)
            ua, ub = max(u0, u), min(u1, u + l)
            if ub - ua > .04:
                wspan('stone', axis, plane, inward, ua + .006, ub - .006, ya + .006, yb - .006,
                      -.05, g.uniform(-.004, .016), g.choice(mats), bevel=.012)
            u += l
    wspan('stone cap', axis, plane, inward, u0, u1, y1 - .05, y1 + .002, -.1, .03, DARK, bevel=.008)


# ---- the terraces ----------------------------------------------------------------------------
def terrace_top(f, seed, mats, holes=()):
    """A solid terrace's body of rubble and timber to under its boards, and the boards."""
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    for a, b, c, d in rect_minus(x0, x1, z0, z1, holes):
        span('terrace', a + .02, b - .02, 0, y - BT, c + .02, d - .02, DARK)
    for i, r in enumerate(rect_minus(x0, x1, z0, z1, holes)):
        deck(*r, y, 'x', seed + i, mats, lmin=1.2, lmax=2.6)

def pit():
    f = FL['pit']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    on = [stair_rect(ST[k]) for k in ('pit-bar-west', 'pit-bar-east')]
    terrace_top(f, 150, [STAGEP, DECKC, DECKP, STAGEP, DECKB], holes=on)
    bulkhead('z', x0, -1, z0, z1, 0, y, 151)
    bulkhead('x', z1, 1, x0 - .1, x1 + .1, 0, y, 152)
    bulkhead('z', x1, 1, z0, z1, 0, y, 153)

def bar():
    f = FL['bar']
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    hx0, hx1 = ST['pit-bar-west']['x1'], ST['pit-bar-east']['x0']   # the hull between the two stairs
    span('terrace', x0 + .02, x1 - .02, 0, y - BT, z0, z1 - .42, DARK)
    span('terrace', x0 + .02, hx0, 0, y - BT, z1 - .45, z1 - .02, DARK)
    span('terrace', hx1, x1 - .02, 0, y - BT, z1 - .45, z1 - .02, DARK)
    for i, r in enumerate(rect_minus(x0, x1, z0, z1, [(hx0 - .02, hx1 + .02, z1 - .12, z1)])):
        deck(*r, y, 'x', 160 + i, [DECKP, DECKB, DECKC, STAGEP], lmin=1.2, lmax=2.6)
    # The west face drops to the ground by the cellar: stone, the rock's side of the hall.
    stonework('z', x0, -1, z0, z1, 0, y, 161)
    # East of the ship's side the terrace drops to the ground by the jetty, and into the hold.
    east = ST['pit-bar-east']['x1']
    bulkhead('x', z1, 1, east, x1, 0, y, 162, posts=.9)
    bulkhead('z', x1, 1, z0, z1, 0, y, 163)
    # Where the captain's deck stands beside it, the bar's east edge goes on up to C as a knee wall.
    for za, zb in ((z0, FL['captain-north']['z1']), (FL['captain-south']['z0'], z1)):
        planked('z', x1, -1, za, zb, y, C - .085, 164, wale=False, tar_to=C, lower=(HULLW, HULLB, HULLC),
                back=.12)
        rib('z', x1, -1, (za + zb) / 2, y, C - .085, wide=.08, proud=.05)
    hull_side(hx0, hx1, z1)


# ---- the bar's front: a ship's side ----------------------------------------------------------
def hull_z(y, zf0):
    """The ship's side in section: widest (at the terrace's edge) just under the wale, tucked in
    hard towards the pit's boards and a little at the top, as a hull's tumblehome is."""
    t = (y - P) / (B - P)
    if t < .5:
        return zf0 - .17 * ((.5 - t) / .5) ** 2
    return zf0 - .06 * ((t - .5) / .5) ** 2

def hull_side(xa, xb, zf0):
    """The bar terrace's face towards the pit, 0.9 high: strakes lofted round the section and laid
    along x with staggered butts over a dark core, a heavy wale, gun ports - most shut on their
    hinges, two with a cannon's muzzle run out - a carved wheel in the middle, a cap rail."""
    g = rng(171)
    lo, hi = P, B
    tar_to = P + .3
    wale0, wale1 = P + .32, P + .41
    port0, port1 = P + .47, P + .75
    m = plane_m((0, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0))     # own x = world z, own y = y, own z = world x

    def section(ya, yb, out0, out1, n=4):
        ys = [ya + (yb - ya) * k / n for k in range(n + 1)]
        return [(hull_z(v, zf0) + out1, v) for v in ys] + [(hull_z(v, zf0) + out0, v) for v in reversed(ys)]

    def piece(label, x0, x1, outline, mat):
        if x1 - x0 < .01:
            return
        prism(label, outline, x1 - x0, mat, m @ Matrix.Translation((0, 0, (x0 + x1) / 2)))
    # the core, the dark between the strakes
    piece('hull core', xa, xb, section(lo, hi, -.3, -.035, 8), DARK)
    # the strakes
    ys = [lo]
    while ys[-1] < hi - .06:
        ys.append(min(hi - .05, ys[-1] + g.uniform(.1, .12)))
    for v in (tar_to, wale0, wale1, port0, port1):
        ys = [q for q in ys if abs(q - v) > .035] + [v]
    ys = sorted(set(ys + [hi - .05]))
    ports = [-3.9, -2.8, -1.7, .7, 1.8, 2.9]
    ports = [p for p in ports if xa + .3 < p < xb - .3]
    runs_with = lambda ya, yb: free_runs(xa, xb, ya, yb, [(p - .19, p + .19, port0, port1) for p in ports])
    for ya, yb in zip(ys, ys[1:]):
        if wale0 - 1e-6 <= ya and yb <= wale1 + 1e-6:
            continue
        mats = [TAR, TARB, TARC] if yb <= tar_to + 1e-6 else STRAKES
        for a, b in runs_with(ya, yb):
            u = a - g.uniform(0, 1.8)
            while u < b:
                l = g.uniform(1.4, 2.6)
                ua, ub = max(a, u), min(b, u + l)
                if ub - ua > .04:
                    piece('hull strake', ua + .003, ub - .003, section(ya + .004, yb - .004, -.04, g.choice((0, .004, .008))), g.choice(mats))
                u += l
    # the wale, and the cap rail over the top, its edge on the terrace's line
    piece('hull wale', xa - .02, xb + .02, section(wale0, wale1, -.04, .04, 3), DARK)
    x = xa + .25
    while x < xb - .1:
        bolt((x, (wale0 + wale1) / 2, hull_z((wale0 + wale1) / 2, zf0) + .044), 'z', r=.012)
        x += .5
    span('cap rail', xa - .02, xb + .02, hi - .05, hi + .004, zf0 - .2, zf0 + .015, OAK, bevel=.01)
    span('cap rail', xa - .02, xb + .02, hi - .08, hi - .05, zf0 - .12, zf0 - .01, DARK)
    # stem posts where the side meets the stairs
    for x in (xa, xb):
        span('hull stem', x - .05, x + .05, lo, hi, zf0 - .24, zf0 + .02, DARK, bevel=.012)
        for yy in (lo + .15, (lo + hi) / 2, hi - .15):
            bolt((x, yy, zf0 + .027), 'z', r=.013)
    # the gun ports
    muzzles = {-2.8, 1.8}
    for p in ports:
        gun_port(p, port0, port1, zf0, p in muzzles, g)
    # the ship's wheel carved in the middle of the side, between two dark battens
    wheel_panel((xa + xb) / 2, (port0 + port1) / 2 + .02, zf0)
    # frames showing through between every two ports
    for a, b in zip([xa] + ports, ports + [xb]):
        c = (a + b) / 2
        if abs(c - (xa + xb) / 2) < .5 or b - a < .6:
            continue
        rod('hull batten', (c, lo + .02, hull_z(lo + .02, zf0) + .006), (c, wale0, hull_z(wale0, zf0) + .006), .018, DARK, sides=4)

def gun_port(x, y0, y1, zf0, muzzle, g):
    """A gun port in the ship's side: a dark frame, and either the lid shut on two iron hinge straps
    with a ring to haul it by, or the lid swung up on its hinges over a cannon's muzzle."""
    hw = .15
    zc = hull_z((y0 + y1) / 2, zf0)
    # the frame round the hole, standing a little proud
    for a, b, c, d in ((x - hw - .04, x + hw + .04, y0 - .04, y0), (x - hw - .04, x + hw + .04, y1, y1 + .04),
                       (x - hw - .04, x - hw, y0, y1), (x + hw, x + hw + .04, y0, y1)):
        span('port frame', a, b, c, d, zc - .06, zc + .022, DARK, bevel=.006)
    if not muzzle:
        span('port lid', x - hw + .005, x + hw - .005, y0 + .005, y1 - .005, zc - .04, zc + .026, LIDW, bevel=.008)
        for k in (-.5, .5):
            span('port lid batten', x - hw + .01, x + hw - .01, lerp(y0, y1, .5 + k * .6) - .012, lerp(y0, y1, .5 + k * .6) + .012,
                 zc + .026, zc + .034, DARK)
        for s in (-1, 1):
            xs = x + s * hw * .55
            span('port hinge', xs - .018, xs + .018, y0 + .03, y1 + .06, zc + .026, zc + .038, STRAP)
            disc('port pintle', (xs, y1 + .045, zc + .03), .014, .03, IRON, sides=6, tilt=PI / 2)
            bolt((xs, y0 + .08, zc + .04), 'z', r=.008)
            bolt((xs, y1 - .06, zc + .04), 'z', r=.008)
        torus('port ring', (x, y0 + .06, zc + .04), .024, .005, IRON, seg=8, sides=4, tilt=PI / 2)
        return
    # open: the dark inside, the lid swung up and out on its hinges, the muzzle run out
    span('port dark', x - hw, x + hw, y0, y1, zc - .12, zc - .02, BLACK)
    lift = Matrix.Translation((0, y1 + .03, zc + .02)) @ Matrix.Rotation(-1.25, 4, 'X') @ Matrix.Translation((0, -(y1 + .03), -(zc + .02)))
    with geom.frame(lift):
        span('port lid', x - hw + .005, x + hw - .005, y1 + .03 - (y1 - y0) + .01, y1 + .03, zc - .015, zc + .045, LIDW, bevel=.008)
        for s in (-1, 1):
            xs = x + s * hw * .55
            span('port hinge', xs - .018, xs + .018, y1 + .03 - (y1 - y0) + .03, y1 + .05, zc + .045, zc + .057, STRAP)
    for s in (-1, 1):
        disc('port pintle', (x + s * hw * .55, y1 + .045, zc + .03), .014, .03, IRON, sides=6, tilt=PI / 2)
    yc = (y0 + y1) / 2 - .01
    # a bronze muzzle, its swell and lip, run out 0.13 past the side (the pit is walked from 0.16 off)
    tip = zf0 + .13
    lathe('cannon muzzle', [(0, 0), (.058, 0), (.058, .03), (.05, .05), (.047, .16), (.056, .19), (.06, .21),
                            (.052, .23), (.03, .23), (.03, .01), (0, .01)], BRONZE,
          at=(x, yc, tip - .23), sides=10, tilt=PI / 2)
    disc('cannon bore', (x, yc, tip - .005), .026, .006, BLACK, sides=8, tilt=PI / 2)
    # tackle ropes from the lid to the side
    rod('port lanyard', (x - hw * .6, y1 + .04, zc + .05), (x - hw * .8, y1 + .2, zc + .2), .005, ROPE, sides=3)

def wheel_panel(x, y, zf0):
    """A ship's wheel carved into the side, on a dark boss, with brass strips either side."""
    zc = hull_z(y, zf0) + .03
    r = .14
    disc('wheel boss plate', (x, y, zc - .03), r + .06, .03, DARK, sides=12, tilt=PI / 2)
    torus('wheel rim', (x, y, zc + .01), r, .016, CARVED, seg=16, sides=4, tilt=PI / 2)
    disc('wheel hub', (x, y, zc - .01), .038, .04, CARVED, sides=8, tilt=PI / 2)
    for k in range(8):
        a = TAU * k / 8
        ca, sa = math.cos(a), math.sin(a)
        rod('wheel spoke', (x + ca * .03, y + sa * .03, zc + .012), (x + ca * (r + .07), y + sa * (r + .07), zc + .012), .009, CARVED, sides=5)
        ball('wheel handle', (x + ca * (r + .075), y + sa * (r + .075), zc + .012), .014, CARVED, seg=6, rings=3)
    for s in (-1, 1):
        span('wheel strip', x + s * (r + .12) - .012, x + s * (r + .12) + .012, P + .45, B - .09,
             hull_z(y, zf0) - .02, hull_z(y, zf0) + .012, 'plain:brass')


# ---- the walls: fieldstone -------------------------------------------------------------------
def cobble(at, size, seed, mat):
    """A rounded field boulder: the hull of fourteen directions barely pushed in."""
    g = rng(seed)
    x, y, z = at
    sx, sy, sz = size
    a = g.uniform(0, TAU)
    ca, sa = math.cos(a), math.sin(a)
    pts = []
    for dx, dy, dz in _DIRS14:
        r = g.uniform(.88, 1.0)
        px, py, pz = dx * r, dy * r, dz * r
        px, pz = px * ca - pz * sa, px * sa + pz * ca
        pts.append((x + px * sx, y + py * sy, z + pz * sz))
    hull('fieldstone', pts, mat)


_DIRS14 = []
for _i in range(14):
    _yy = 1 - 2 * (_i + .5) / 14
    _rr = math.sqrt(1 - _yy * _yy)
    _a = _i * 2.399963
    _DIRS14.append((_rr * math.cos(_a), _yy, _rr * math.sin(_a)))


def fieldstone(seed, axis, plane, inward, u0, u1, y0, y1, cut=None, hide=None):
    """Rough fieldstone: rounded boulders of every size laid in rough courses in a bed of mortar, their
    faces on the wall line (never in front of it), the mortar 0.055 behind. `cut(y)` gives the
    openings at height y as (u0, u1) spans (an arch's width at that height); `hide(u, y, su, sy)`
    leaves out a stone nobody can see (behind a terrace)."""
    g = rng(seed)

    def spans(ya, yb):
        if cut is None:
            return []
        out = []
        for y in (ya, (ya + yb) / 2, yb):
            out += [(a, b, ya, yb) for a, b in cut(y)]
        return out
    # the mortar, in bands so an arch's round top is followed
    y = y0
    while y < y1 - 1e-6:
        yb = min(y1, y + .1)
        for a, b in free_runs(u0, u1, y, yb, spans(y, yb)):
            if hide and hide((a + b) / 2, (y + yb) / 2, (b - a) / 2, 0) and hide(a, y, 0, 0) and hide(b, y, 0, 0):
                continue
            wspan('mortar', axis, plane, inward, a, b, y, yb, -.13, -.075, MORTAR)
        y = yb
    # the stones, course by course
    y = y0
    while y < y1 - .05:
        h = min(g.uniform(.17, .26), y1 - y)
        u = u0 - g.uniform(0, .25)
        while u < u1:
            w = g.uniform(.22, .46)
            su = w / 2 * g.uniform(1.04, 1.16)
            sy = h / 2 * g.uniform(1.0, 1.18)
            uc = u + w / 2 + g.uniform(-.03, .03)
            yc = y + h / 2 + g.uniform(-.025, .025)
            u += w
            if uc - su * .6 > u1 or uc + su * .6 < u0:
                continue
            if any(a < uc + su * .7 and b > uc - su * .7 for a, b, _, _ in spans(yc - sy * .7, yc + sy * .7)):
                continue
            if hide and hide(uc, yc, su, sy):
                continue
            sd = g.uniform(.055, .07)
            p = wpt(axis, plane, inward, uc, max(yc, sy + .002), -sd - .004)
            size = (su, sy, sd) if axis == 'x' else (sd, sy, su)
            cobble(p, size, g.randrange(1 << 30), g.choice(FIELD))
        y += h


def sill(axis, plane, inward, u0, u1, holes=()):
    """The timber sill the planking stands on, laid along the top of the fieldstone."""
    for a, b in free_runs(u0, u1, STONE_TOP - .03, STONE_TOP + SILL, holes):
        wspan('sill', axis, plane, inward, a, b, STONE_TOP - .03, STONE_TOP + SILL, -.1, .05,
              BEAMX if axis == 'x' else BEAMZ, bevel=.012)
        u = a + .3
        while u < b - .1:
            wspan('sill bolt', axis, plane, inward, u - .012, u + .012, STONE_TOP + .05, STONE_TOP + .075, .05, .058, IRON)
            u += .9


# ---- the walls: ship's timber ----------------------------------------------------------------
def timber_wall(axis, plane, inward, u0, u1, seed, holes=(), patches=8, avoid=()):
    """Ship's planking from the sill to the roof: strakes of odd lengths and odd ships, tarred low
    down, and patches of other planks nailed over where the old ones gave out."""
    top = lambda u: wall_top(axis, plane, u) + .05
    ymax = max(top(u0), top(u1), top((u0 + u1) / 2))
    planked(axis, plane, inward, u0, u1, STONE_TOP + SILL, ymax, seed, holes=holes, top=top, wale=False,
            tar_to=STONE_TOP + SILL + .35, upper=PATCHED, lower=(TAR, TARB, TARC))
    g = rng(seed + 5)
    tries = 0
    while patches > 0 and tries < 60:
        tries += 1
        lw, n = g.uniform(.45, .9), g.randint(2, 4)
        u = g.uniform(u0 + .3, u1 - .3 - lw)
        y = g.uniform(STONE_TOP + SILL + .15, min(top(u), top(u + lw)) - .5)
        hh = n * .12
        box_ = (u - .05, u + lw + .05, y - .05, y + hh + .05)
        if any(h[0] < box_[1] and h[1] > box_[0] and h[2] < box_[3] and h[3] > box_[2] for h in list(holes) + list(avoid)):
            continue
        patches -= 1
        mat = g.choice([HULLD, HULLE, DECKZD, HULLC, TARC])
        for k in range(n):
            ya = y + k * .12
            sk = g.uniform(-.06, .06)
            wspan('patch', axis, plane, inward, u + sk, u + lw + sk, ya + .004, ya + .116, .0, .018, mat)
            for uu in (u + sk + .04, u + lw + sk - .04):
                wspan('patch nail', axis, plane, inward, uu - .008, uu + .008, ya + .05, ya + .066, .018, .024, IRON)


def wall_rib(axis, plane, inward, u, mat=RIB):
    """One of a ship's frames stood against the west or east wall at a truss: its foot on the sill
    turned out into the room as a hull's bilge turns, straight up the planking, and at the top
    bent over in a knee under the truss's tie beam - together with the rafters an arch over the hall."""
    y0 = STONE_TOP + SILL
    RK = .36
    yk = EAVES - .07 - RK
    pts = []
    for i in range(6):
        y = y0 + (2.45 - y0) * i / 5
        pts.append((.07 + .15 * ((2.45 - y) / (2.45 - y0)) ** 2, y))
    pts.append((.07, yk))
    for i in range(1, 8):
        a = (PI / 2) * i / 7
        pts.append((.07 + RK * (1 - math.cos(a)), yk + RK * math.sin(a)))
    pts.append((.07 + RK + .45, EAVES - .07))
    side = (1, 0, 0) if axis == 'x' else (0, 0, 1)
    bent_timber('wall rib', [wpt(axis, plane, inward, u, y, d) for d, y in pts], side, .14, .13, mat)
    for d, y in pts[2:6:2]:
        bolt(wpt(axis, plane, inward, u + (.066 if axis == 'z' else 0), y, d), 'z' if axis == 'z' else 'x', r=.013)


def gable_arch(axis, plane, inward, a):
    """Two of a ship's frames stood up on a gable wall as an arch: their feet on the sill a each side
    of the middle, meeting under the ridge on a block, as a hull's section stands upside down."""
    y0 = STONE_TOP + SILL
    H = roof_y(0) - .45 - y0
    n = 9
    for s in (-1, 1):
        pts = []
        for i in range(n + 1):
            ph = (PI / 2) * i / n
            u = s * a * math.cos(ph)
            y = y0 + H * math.sin(ph)
            y = min(y, roof_y(u) - .2)
            pts.append(wpt(axis, plane, inward, u * (1 if i < n else 0) + (s * .05 if i == n else 0), y, .065))
        bent_timber('gable rib', pts, (0, 0, 1) if axis == 'x' else (1, 0, 0), .16, .13, RIB)
    wspan('gable apex', axis, plane, inward, -.14, .14, y0 + H - .12, y0 + H + .1, -.01, .16, DARK, bevel=.012)
    for uu in (-.08, .08):
        wspan('apex bolt', axis, plane, inward, uu - .012, uu + .012, y0 + H - .02, y0 + H + .004, .16, .168, IRON)
def porthole(axis, plane, inward, u, y, r=.13):
    """A porthole: a round of glass with the night behind it, a thick turned frame of wood round it
    and a brass ring, bolted through the planking. Its hole in the planks is porthole_hole's."""
    m = wall_m(axis, plane, inward) @ Matrix.Translation((u, y, 0))
    g = rng(int(abs(u * 131 + y * 17 + plane * 7)) & 0xffff)
    oct_ = [(r * math.cos(TAU * i / 10), r * math.sin(TAU * i / 10)) for i in range(10)]
    prism('pane', oct_, .01, PANE, m @ Matrix.Translation((0, 0, -.1)))
    ring('porthole frame', m, 0, 0, r, r + .11, 0, TAU, 10, -.03, .04, [DARK, POSTW], g, gap=.004)
    ring('porthole tunnel', m, 0, 0, r, r + .03, 0, TAU, 10, -.1, -.03, [DARK], g, gap=.0)
    torus('porthole ring', tuple(m @ Vector((0, 0, .045))), r + .015, .014, BRASS, seg=12, sides=4,
          tilt=PI / 2 if axis == 'x' else 0, roll=0 if axis == 'x' else PI / 2)
    for i in range(6):
        a = TAU * (i + .5) / 6
        p = m @ Vector(((r + .075) * math.cos(a), (r + .075) * math.sin(a), .045))
        box('porthole bolt', tuple(p), (.018, .018, .018), IRON)


def porthole_hole(u, y):
    return (u - .17, u + .17, y - .17, y + .17)


# ---- the four walls --------------------------------------------------------------------------
def arch_geom():
    ac = (ARCH[0] + ARCH[1]) / 2
    ar = (ARCH[1] - ARCH[0]) / 2
    atop = F + 1.0
    return ac, ar, atop, atop - ar

def north_wall():
    """Fieldstone to STONE_TOP with the cellar's arch through it, ship's timber up to the gable, an
    arch of ribs round the bow, portholes each side. Solid and closed; the stern stands against it."""
    z0 = HALL['z0']
    x0, x1 = HALL['x0'] - W, HALL['x1'] + W
    ac, ar, atop, aspring = arch_geom()

    def cut(y):
        if y < aspring:
            return [(ARCH[0] - .17, ARCH[1] + .17)]
        rr = ar + .13
        if y - aspring < rr:
            h = math.sqrt(rr * rr - (y - aspring) ** 2)
            return [(ac - h, ac + h)]
        if y < atop + .16:
            return [(ac - .07, ac + .07)]
        return []

    def hide(u, y, su, sy):
        return FL['bar']['x0'] + .05 < u < FL['bar']['x1'] - .05 and y + sy < B + .02
    fieldstone(71, 'x', z0, 1, x0, x1, 0, STONE_TOP, cut=cut, hide=hide)
    s = KIT['stern']
    sill('x', z0, 1, x0, x1, holes=[(s['x'] - 1.95, s['x'] + 1.95, 0, 9)])
    holes = [porthole_hole(u, y) for u, y in NORTH_PORTS]
    timber_wall('x', z0, 1, x0, x1, 72, holes=holes, patches=7,
                avoid=[(-1.4, 1.4, B + 1.9, EAVES + .1), (-2.1, 2.1, 0, B + 1.9)])
    gable_arch('x', z0, 1, 3.3)
    for u, y in NORTH_PORTS:
        porthole('x', z0, 1, u, y)


def south_wall():
    z1 = HALL['z1']
    x0, x1 = HALL['x0'] - W, HALL['x1'] + W
    DH = F + 1.1
    fieldstone(81, 'x', z1, -1, x0, x1, 0, STONE_TOP,
               cut=lambda y: [(-DOOR - .14, DOOR + .14)] if y < DH + .16 else [])
    sill('x', z1, -1, x0, x1)
    holes = [porthole_hole(u, y) for u, y in SOUTH_PORTS]
    timber_wall('x', z1, -1, x0, x1, 82, holes=holes, patches=9)
    gable_arch('x', z1, -1, 4.5)
    for u, y in SOUTH_PORTS:
        porthole('x', z1, -1, u, y)
    door(DH)
    cannonball(-5.4, STONE_TOP + .75, z1, rng(311))


def west_wall():
    x0 = HALL['x0']
    z0, z1 = HALL['z0'] - W, HALL['z1'] + W
    hz = HEARTHP['z']
    fieldstone(91, 'z', x0, 1, z0, z1, 0, STONE_TOP, cut=lambda y: [(hz - .78, hz + .78)])
    sill('z', x0, 1, z0, z1, holes=[(hz - .8, hz + .8, 0, 9)])
    holes = [porthole_hole(u, y) for u, y in WEST_PORTS]
    timber_wall('z', x0, 1, z0, z1, 92, holes=holes, patches=8,
                avoid=[(hz - .9, hz + .9, 0, 9)] + gallery_bands('west'))
    for z in TRUSSES:
        if abs(z - hz) < 1.0 or abs(z - ST['west-ladder']['z0'] - .4) < .55:
            continue
        wall_rib('z', x0, 1, z)
    for u, y in WEST_PORTS:
        porthole('z', x0, 1, u, y)
    plate('z', x0, 1, HALL['z0'], HALL['z1'])


def east_wall():
    """The east wall: fieldstone and timber like the rest, and south of ROCK_EAST the sea arch through
    both, the stone going up round it."""
    x1 = HALL['x1']
    z0, z1 = HALL['z0'] - W, HALL['z1'] + W
    az0, az1 = POOL['arch']
    zc, hw = (az0 + az1) / 2, (az1 - az0) / 2
    spring, rv = ARCH_SPRING, ARCH_RISE
    sz0, sz1, stop = az0 - .45, az1 + .45, spring + rv + .75      # the stone round the arch

    def cut(y):
        m = .2
        if y < spring:
            return [(az0 - m, az1 + m)]
        k = (y - spring) / (rv + m)
        if k >= 1:
            return []
        h = (hw + m) * math.sqrt(1 - k * k)
        return [(zc - h, zc + h)]
    fieldstone(101, 'z', x1, -1, z0, z1, 0, STONE_TOP, cut=cut)
    fieldstone(102, 'z', x1, -1, sz0, sz1, STONE_TOP, stop, cut=cut)
    sill('z', x1, -1, z0, z1, holes=[(sz0, sz1, 0, 9)])
    wspan('arch lintel', 'z', x1, -1, sz0 - .05, sz1 + .05, stop, stop + .18, -.1, .06, BEAMZ, bevel=.014)
    holes = [porthole_hole(u, y) for u, y in EAST_PORTS] + [(sz0, sz1, 0, stop + .18)]
    timber_wall('z', x1, -1, z0, z1, 103, holes=holes, patches=6, avoid=gallery_bands('east'))
    for z in TRUSSES:
        if z < ROCK_EAST + .1:
            wall_rib('z', x1, -1, z)
    for u, y in EAST_PORTS:
        porthole('z', x1, -1, u, y)
    plate('z', x1, -1, HALL['z0'], HALL['z1'])


def gallery_bands(side):
    """The heights on a wall where a gallery's ledger and knees are, kept free of patches."""
    out = []
    for y in (C, U):
        out.append((-99, 99, y - .7, y + .05))
    return out


def plate(axis, plane, inward, u0, u1):
    """The wall plate on the west or east wall, the tie beams' seat, its top on EAVES."""
    n = max(2, int((u1 - u0) / 1.5))
    for k in range(n):
        a, b = u0 + (u1 - u0) * k / n, u0 + (u1 - u0) * (k + 1) / n
        wspan('wall plate', axis, plane, inward, a + .002, b - .002, EAVES - .17, EAVES, -.02, .14, BEAMZ, bevel=.012)
        wspan('plate bolt', axis, plane, inward, (a + b) / 2 - .014, (a + b) / 2 + .014, EAVES - .1, EAVES - .07, .14, .148, IRON)


# ---- the roof --------------------------------------------------------------------------------
def roof_slab(label, xa, xb, za, zb, below, above, mat):
    """A piece lying on the roof's plane (both ends on one side of the ridge), from `below` under the
    boards' underside to `above` over it."""
    pts = [(x, roof_y(x) + dy, z) for x in (xa, xb) for z in (za, zb) for dy in (-below, above)]
    hull(label, pts, mat)


SKYLIGHTS = []                  # kraken-layout.js SKYLIGHTS, set by load()


def roof():
    """The pitched roof, all of it the lid: at every TRUSSES z a truss - a tie beam on the wall plates
    with its underside on EAVES, two principal rafters up to the ridge, a king post and two struts -
    the ridge beam and three purlins a side along the hall, and the boards on them, with two skylights."""
    z0, z1 = HALL['z0'] - W, HALL['z1'] + W
    xw = HALL['x1']
    mz = KIT['mast']['z']
    with lid():
        for zt in TRUSSES:
            truss(zt)
        # the gables' own rafters, on the north and south walls
        for zg in (HALL['z0'] + .07, HALL['z1'] - .07):
            for s in (-1, 1):
                hull('verge rafter', [(s * x, roof_y(x) - .12 + dy, zg + dz) for x in (.08, xw + .1)
                                      for dy in (0, -.2) for dz in (-.065, .065)], BEAMX)
        span('ridge beam', -.09, .09, TOP - .32, TOP, z0, z1, BEAMZ, bevel=.014)
        for x in PURLINS:
            for s in (-1, 1):
                roof_slab('purlin', s * x - .065, s * x + .065, z0, z1, .14, 0, BEAMZ)
        # the boards, down the slope from the ridge to past the wall plate, two lengths each
        g = rng(611)
        for s in (-1, 1):
            z = z0
            while z < z1 - .01:
                w = min(g.uniform(.16, .22), z1 - z)
                xs = g.uniform(2.8, 6.4)
                cuts = [(min(abs(sx0), abs(sx1)), max(abs(sx0), abs(sx1)), 0, 1) for sx0, sx1, sz0, sz1 in SKYLIGHTS
                        if (sx0 > 0) == (s > 0) and sz0 < z + w and sz1 > z]
                for xa, xb in ((.0, xs), (xs, xw + .25)):
                    for a, b in free_runs(xa, xb, 0, 1, cuts):
                        roof_slab('roof board', s * (a + .004), s * (b - .004), z + .003, z + w - .003, 0, .035,
                                  g.choice([CEIL, CEIL, DECKZC, DECKZ, TARC]))
                z += w
        for sk in SKYLIGHTS:
            skylight(*sk)
        # where the mast runs up into the ridge: a collar of iron round it
        torus('mast collar', (KIT['mast']['x'], TOP - .36, mz), .12, .025, IRON, seg=12, sides=4)
        for s in (-1, 1):
            span('mast partner', -.34, .34, TOP - .44, TOP - .32, mz + s * .115, mz + s * .215, BEAMX, bevel=.01)


def truss(zt):
    xw = HALL['x1']
    mz, mx = KIT['mast']['z'], KIT['mast']['x']
    yb, yt = EAVES, EAVES + TIE_D
    through_mast = abs(zt - mz) < .3
    span('tie beam', -xw - .1, xw + .1, yb, yt, zt - .11, zt + .11, BEAMX, bevel=.018)
    for s in (-1, 1):
        # the principal rafter, its top under the purlins, its foot on the tie beam's end
        hull('rafter', [(s * x, roof_y(x) - .14 + dy, zt + dz) for x in (.09, xw + .1) for dy in (0, -.22)
                        for dz in (-.07, .07)], BEAMX)
        # the strut from the king post's foot to the rafter
        xs = 3.6
        a = Vector((s * .08, yt + .06, zt))
        b = Vector((s * xs, roof_y(xs) - .36, zt))
        bent_timber('strut', [a, b], (0, 0, 1), .12, .1, BEAMX)
        # iron straps: the rafter's foot to the tie beam, the strut's head
        span('truss strap', s * (xw - .45) - .03, s * (xw - .45) + .03, yb - .012, roof_y(xw - .45) - .12, zt - .118, zt + .118, IRON)
        span('truss strap', s * xs - .03, s * xs + .03, roof_y(xs) - .38, roof_y(xs) - .12, zt - .118, zt + .118, IRON)
    span('king post', -.08, .08, yt, TOP - .32, zt - .08, zt + .08, BEAMZ, bevel=.012)
    for yy in (yt + .03, TOP - .4):
        span('king post strap', -.09, .09, yy, yy + .05, zt - .09, zt + .09, IRON)
    if through_mast:
        torus('mast band', (mx, yt + .3, mz), .12, .02, IRON, seg=12, sides=4)


def skylight(xa, xb, za, zb):
    """A skylight in the roof: a curb of timber round the hole, the glass (the night sky over it) laid
    over the curb, two glazing bars."""
    s = 1 if xa > 0 else -1
    lo, hi = (xa, xb)
    roof_slab('skylight curb', lo - .07, lo, za - .07, zb + .07, .14, .12, DARK)
    roof_slab('skylight curb', hi, hi + .07, za - .07, zb + .07, .14, .12, DARK)
    roof_slab('skylight curb', lo, hi, za - .07, za, .14, .12, DARK)
    roof_slab('skylight curb', lo, hi, zb, zb + .07, .14, .12, DARK)
    roof_slab('pane', lo, hi, za, zb, -.1, .115, PANE)
    for t in (1 / 3, 2 / 3):
        zz = za + (zb - za) * t
        roof_slab('glazing bar', lo, hi, zz - .012, zz + .012, -.06, .1, WOOD)
    zz = (za + zb) / 2
    roof_slab('glazing bar', (lo + hi) / 2 - .012, (lo + hi) / 2 + .012, za, zb, -.06, .1, WOOD)


# ---- the broken bow --------------------------------------------------------------------------
def ph_bow():
    """A placeholder, until the kit's own bow (scripts/krakenkit/bow.py) stands here: a ship's bow
    broken off and jutting out of the north gable over the bar, drawn apart from the wall (which is
    whole behind it) and switched off with BOW = False: its hull closing to
    the stem in plan and rising to it from the keel, its strakes splintered and ragged where it was
    cut off at the wall, a broken deck on top with its gunwale, a wale, a dark inside, and iron straps
    up round the tie beam of the truss it was rammed in under. The figurehead (the kit's) stands on
    the stem's face at KIT.figurehead, nothing of the bow in front of that."""
    zw = HALL['z0']
    fh = KIT['figurehead']
    zs = fh['z']
    ze = zs - .16                        # where the planks close on the stem's back
    Lb = ze - zw
    yb0, yb1 = B + 2.0, B + 2.22
    ytop = EAVES - .06
    w0 = 1.15
    g = rng(701)

    def yk(t):
        return yb0 + (yb1 - yb0) * t * t

    def half(t, v):
        plan = max(.07, w0 * max(0.0, 1 - t ** 2.4) ** .55)
        return plan * (.06 + .94 * max(0.0, v) ** .45)

    def pt(t, v, side, inset=0.0):
        y = yk(t) + (ytop - yk(t)) * v
        return (side * (half(t, v) - inset), y, zw + Lb * t)
    ts = [i / 12 for i in range(13)]
    vs = [0, .14, .28, .42, .56, .7, .84, 1.0]
    # the dark inside, from the wall on
    for ta, tb in zip(ts, ts[1:]):
        pts = [pt(t, v, s, .045) for t in (ta, tb) for v in (0, .35, .7, 1) for s in (-1, 1)]
        hull('bow inside', pts, BLACK)
    # the strakes, each begun at a ragged distance from the wall, some with a splinter
    for side in (-1, 1):
        for si in range(len(vs) - 1):
            v0, v1 = vs[si] + .008, vs[si + 1] - .008
            wale = si == 4
            mat = DARK if wale else g.choice(STRAKES + [HULLB, TARC])
            t0 = g.uniform(.0, .08)
            st = [t0] + [t for t in ts if t > t0 + .03]
            out = .02 if wale else 0
            for ta, tb in zip(st, st[1:]):
                pts = []
                for t in (ta, tb):
                    for v in (v0, v1):
                        x, y, z = pt(t, v, side)
                        pts += [(x + side * out, y, z), (x - side * .04, y, z)]
                hull('bow strake', pts, mat)
            if g.random() < .7:
                x, y, z = pt(t0, (v0 + v1) / 2, side)
                L_ = g.uniform(.07, .2)
                hull('bow splinter', [(x, y - .04, z + .01), (x, y + .04, z + .01), (x - side * .03, y, z + .01),
                                      (x + side * g.uniform(-.02, .03), y + g.uniform(-.03, .03), z - L_)],
                     g.choice([SPLINTER, HULLC]))
    # the keel along the bottom, the stem at the front
    for ta, tb in zip(ts, ts[1:]):
        hull('bow keel', [(dx, yk(t) + dy, zw + Lb * t) for t in (ta, tb) for dx in (-.055, .055) for dy in (-.07, .03)], DARK)
    span('bow stem', -.075, .075, yk(1) - .1, EAVES - .01, ze - .03, zs, DARK, bevel=.012)
    for yy in (yk(1) + .08, (yk(1) + EAVES) / 2, EAVES - .12):
        span('stem band', -.083, .083, yy, yy + .035, ze - .035, zs + .004, IRON)
    # the deck on top, broken off short of the wall, and the gunwale along the sheer
    x = -w0 + .02
    while x < w0 - .03:
        w = g.uniform(.1, .14)
        xa, xb = x, x + w
        tmax = 0.0
        for i in range(60):
            t = i / 59
            if half(t, 1) - .03 > max(abs(xa), abs(xb)):
                tmax = t
        tstart = g.uniform(.03, .2)
        if tmax > tstart + .05:
            span('bow deck', xa + .003, xb - .003, ytop - .03, ytop, zw + Lb * tstart, zw + Lb * tmax, g.choice([DECKZ, DECKZB, DECKZD]))
        x += w
    for side in (-1, 1):
        for ta, tb in zip(ts, ts[1:]):
            pts = []
            for t in (ta, tb):
                x, y, z = pt(t, 1, side)
                pts += [(x + side * .02, ytop, z), (x - side * .07, ytop, z), (x + side * .02, ytop + .05, z), (x - side * .07, ytop + .05, z)]
            hull('bow gunwale', pts, OAK)
    # hawse holes, one a side
    for side in (-1, 1):
        x, y, z = pt(.78, .72, side)
        disc('hawse hole', (x + side * .004, y, z), .04, .02, BLACK, sides=8, roll=-side * PI / 2)
    # iron straps from the gunwale up round the tie beam over it
    zt = min(TRUSSES, key=lambda v: abs(v - (zw + zs) / 2))
    if zw < zt < ze:
        t = (zt - zw) / Lb
        for side in (-1, 1):
            x = side * (half(t, 1) - .1)
            span('bow strap', x - .025, x + .025, ytop - .25, EAVES + TIE_D + .015, zt - .125, zt - .11, IRON)
            span('bow strap', x - .025, x + .025, ytop - .25, EAVES + TIE_D + .015, zt + .11, zt + .125, IRON)
            span('bow strap', x - .025, x + .025, EAVES + TIE_D, EAVES + TIE_D + .015, zt - .125, zt + .125, IRON)
    # a plate bolting the keel's cut end to the wall
    span('bow wall plate', -.3, .3, yb0 - .12, yb0 + .2, zw, zw + .02, IRON)
    for xx in (-.22, .22):
        bolt((xx, yb0 + .04, zw + .025), 'z', r=.016)


# ---- the galleries: broken ship's decks on old masts -----------------------------------------
def iron_bracket(wx, wz, nx, nz, y, reach=.5, drop=.45):
    """An iron bracket from a wall at (wx, wz), facing (nx, nz), up under a beam at height y
    `reach` out: a strap on the wall, the diagonal and the arm, and their bolts."""
    a = (wx + nx * .01, y - drop, wz + nz * .01)
    b = (wx + nx * (reach - .04), y - .02, wz + nz * (reach - .04))
    rod('bracket', a, b, .016, IRON, sides=4)
    rod('bracket arm', (wx, y - .025, wz), (wx + nx * reach, y - .025, wz + nz * reach), .014, IRON, sides=4)
    span('bracket plate', min(wx, wx + nx * .03) - (.045 if nz else 0), max(wx, wx + nx * .03) + (.045 if nz else 0),
         y - drop - .06, y, min(wz, wz + nz * .03) - (.045 if nx else 0), max(wz, wz + nz * .03) + (.045 if nx else 0), IRON)
    for yy in (y - drop - .03, y - .04):
        bolt((wx + nx * .035, yy, wz + nz * .035), 'x' if nx else 'z', r=.013)

def ship_deck(rects, y, seed, ragged=None, mats=(DECKZ, DECKZB, DECKZC, DECKZB, TREADZ, DECKZD)):
    """A deck taken out of a ship: planks along z with their seams, and where the deck was broken off
    (a rect's z1 equal to `ragged`) the planks run on past the edge in ragged, splintered ends."""
    g = rng(seed)
    for x0, x1, z0, z1 in rects:
        c = x0
        while c < x1 - .015:
            w = g.uniform(.12, .16)
            if x1 - (c + w) < .06:
                w = x1 - c
            u = z0 - g.uniform(0, 2.4)
            while u < z1:
                l = g.uniform(1.3, 2.8)
                ua, ub = max(z0, u), min(z1, u + l)
                end = ragged is not None and abs(z1 - ragged) < 1e-6 and ub >= z1 - 1e-6
                if end:
                    ub = z1 + g.uniform(-.01, .14)
                if ub - ua > .03:
                    m = g.choice(mats)
                    span('deck plank', c + .003, c + w - .003, y - BT, y - g.choice((0, 0, .002)), ua + .002, ub - .002, m)
                    if end and g.random() < .45:
                        tip = ub + g.uniform(.05, .17)
                        xm = g.uniform(c + .02, c + w - .02)
                        hull('deck splinter', [(c + .004, y - BT, ub - .004), (c + w - .004, y - BT, ub - .004),
                                               (c + .004, y - .004, ub - .004), (c + w - .004, y - .004, ub - .004),
                                               (xm, y - BT * .6, tip)], m)
                u += l
            c += w
    sub_floor(rects, y)


def joists_x(x0, x1, z0, z1, yb, pitch=.45, skip=()):
    """Joists along x under a deck whose sub-floor's underside is yb; returns their z."""
    n = max(1, round((z1 - z0 - .16) / pitch))
    out = []
    for k in range(n + 1):
        z = z0 + .08 + (z1 - z0 - .16) * k / n
        if any(a <= z <= b for a, b in skip):
            continue
        span('joist', x0, x1, yb - JD, yb, z - .035, z + .035, BEAMX, bevel=.008)
        out.append(z)
    return out


def ledger(axis, plane, inward, u0, u1, yb):
    wspan('ledger', axis, plane, inward, u0, u1, yb - GD, yb, -.01, .14, BEAMZ if axis == 'z' else BEAMX, bevel=.012)
    u = u0 + .3
    while u < u1 - .1:
        wspan('ledger bolt', axis, plane, inward, u - .014, u + .014, yb - GD / 2 - .014, yb - GD / 2 + .014, .14, .148, IRON)
        u += .55


def west_gallery():
    """The west gallery at the first height and its landing: a broken ship's deck on joists from a
    ledger on the west wall to a girder on the old masts, a knee under every other joist at the wall;
    the landing on two joists run on out of it and a header."""
    f, ld = FL['west-gallery'], FL['west-landing']
    y = f['y']
    yb = y - BT - SUB
    x0, x1, z0, z1 = f['x0'], f['x1'], f['z0'], f['z1']
    ship_deck([(x0, x1, z0, z1), (ld['x0'], ld['x1'], ld['z0'], ld['z1'])], y, 250, ragged=z1)
    zs = joists_x(x0 + .14, x1 - .12, z0, z1, yb)
    for z in (ld['z0'] + .08, ld['z1'] - .08):
        span('joist', x1 - .12, ld['x1'] - .1, yb - JD, yb, z - .035, z + .035, BEAMX, bevel=.008)
    span('header', ld['x1'] - .12, ld['x1'], yb - GD, yb, ld['z0'], ld['z1'], BEAMZ, bevel=.01)
    span('girder', x1 - .12, x1, yb - GD, yb, z0, z1, BEAMZ, bevel=.012)
    ledger('z', HALL['x0'], 1, z0, z1, yb)
    for z in zs[::2]:
        hanging_knee('z', HALL['x0'] + .14, 1, z, yb - JD, arm=.36, leg=.42, thick=.07)
    nosing(x1 - .01, x1 + .035, z0, ld['z0'], y)
    nosing(x1 - .01, x1 + .035, ld['z1'], z1, y)
    nosing(x1, ld['x1'] + .035, ld['z0'] - .035, ld['z0'] + .01, y)
    nosing(ld['x1'] - .01, ld['x1'] + .035, ld['z0'], ld['z1'], y)


def upper_galleries():
    """The upper galleries under the eaves, broken ship's decks like the one below, on masts standing
    on the first height's decks; the west one with the hatch its ladder comes up through."""
    lad = ST['west-ladder']
    for fid, wall, seed in (('west-upper', 'west', 260), ('east-upper', 'east', 270)):
        f = FL[fid]
        y = f['y']
        yb = y - BT - SUB
        x0, x1, z0, z1 = f['x0'], f['x1'], f['z0'], f['z1']
        west = wall == 'west'
        hatch = (lad['x0'], lad['x1'] + .03, lad['z0'] - .03, lad['z1'] + .05) if west else None
        rects = rect_minus(x0, x1, z0, z1, [hatch]) if hatch else [(x0, x1, z0, z1)]
        ship_deck(rects, y, seed, ragged=z1)
        if west:
            gx0, gx1 = x1 - .12, x1
            skip = [(hatch[2] - .02, hatch[3] + .02)]
            zs = joists_x(x0 + .14, gx0, z0, z1, yb, skip=skip)
            for z in (hatch[2] - .04, hatch[3] + .04):
                span('trimmer', x0 + .14, gx0, yb - JD, yb, z - .04, z + .04, BEAMX, bevel=.008)
            span('trimmer', hatch[1], hatch[1] + .08, yb - JD, yb, hatch[2], hatch[3], BEAMZ, bevel=.008)
            span('coaming', hatch[1], hatch[1] + .05, y - .09, y + .04, hatch[2] - .05, hatch[3] + .05, DARK, bevel=.008)
            span('coaming', x0, hatch[1] + .05, y - .09, y + .04, hatch[3], hatch[3] + .05, DARK, bevel=.008)
            ledger('z', HALL['x0'], 1, z0, z1, yb)
            for z in zs[::2]:
                hanging_knee('z', HALL['x0'] + .14, 1, z, yb - JD, arm=.34, leg=.4, thick=.07)
            nosing(x1 - .01, x1 + .035, z0, z1 + .035, y)
        else:
            gx0, gx1 = x0, x0 + .12
            zs = joists_x(gx1, x1 - .14, z0, z1, yb)
            with group('near'):
                ledger('z', HALL['x1'], -1, z0, z1, yb)
                for z in zs[::2]:
                    hanging_knee('z', HALL['x1'] - .14, -1, z, yb - JD, arm=.34, leg=.4, thick=.07)
            nosing(x0 - .035, x0 + .01, z0, z1 + .035, y)
        span('girder', gx0, gx1, yb - GD, yb, z0, z1, BEAMZ, bevel=.012)
def captain_deck():
    """The captain's deck over the hold, the east gallery at the first height: a broken ship's deck on
    joists along x, carried by a girder on the old masts along its west edge and a beam on its south
    edge over the pool, a ledger on the east wall and one on the north wall, and the bar's knee wall
    under its north-west piece; trimmers and a header round the stairwell."""
    cp, cn, cs = FL['captain'], FL['captain-north'], FL['captain-south']
    y = cp['y']
    yb = y - BT - SUB
    x0, x1 = cn['x0'], cp['x1']
    rects = [(x0, x1, cp['z0'], cn['z1']), (cp['x0'], x1, cn['z1'], cs['z0']), (x0, x1, cs['z0'], cp['z1'])]
    ship_deck(rects, y, 220, ragged=cp['z1'])
    well = (cn['z1'], cs['z0'])
    zs = joists_x(x0 + .06, x1 - .14, cp['z0'], cp['z1'], yb, skip=[(well[0] - .06, well[1] + .06)])
    joists_x(cp['x0'] + .06, x1 - .14, well[0], well[1], yb, pitch=.4)
    span('girder', x0, x0 + .12, yb - GD, yb, cs['z0'] - .06, cp['z1'], BEAMZ, bevel=.012)
    span('edge beam', x0, x1, yb - GD, yb, cp['z1'] - .12, cp['z1'], BEAMX, bevel=.012)
    for z in well:
        span('trimmer', x0, cp['x0'] + .06, yb - GD, yb, z - .06, z + .06, BEAMX, bevel=.01)
    span('header', cp['x0'] - .06, cp['x0'] + .06, yb - GD, yb, well[0], well[1], BEAMZ, bevel=.01)
    span('ledger', x0, x1 - .14, yb - GD, yb, cp['z0'], cp['z0'] + .12, BEAMX, bevel=.01)
    for x in (6.2, 7.4, 8.5):
        iron_bracket(x, cp['z0'], 0, 1, yb - GD, reach=.3, drop=.4)
    span('ledger', x0, x0 + .1, yb - GD, yb, cp['z0'], cn['z1'], BEAMZ, bevel=.01)
    nosing(x0 - .035, x0 + .01, cs['z0'], cp['z1'], y)
    nosing(x0 - .035, x0 + .01, cp['z0'], cn['z1'], y)
    for z0_, z1_ in ((well[0] - .01, well[0] + .035), (well[1] - .035, well[1] + .01)):
        nosing(x0 - .035, cp['x0'], z0_, z1_, y)
    with group('near'):
        ledger('z', HALL['x1'], -1, cp['z0'], cp['z1'], yb)
        for z in zs[1::2]:
            hanging_knee('z', HALL['x1'] - .14, -1, z, yb - JD, arm=.34, leg=.4, thick=.07)
def mast_post(x, z, y0, y1, knees=()):
    """An old mast cut down for a post: round, a little tapered, iron bands round it, on a stone step
    on the ground or a timber partner on a deck, knees up to what it carries."""
    r = POST_R
    rod('mast post', (x, y0, z), (x, y1, z), r, SPAR, top=r * .9, sides=10)
    if y0 <= F + .01:
        span('mast step', x - r - .05, x + r + .05, 0, F + .05, z - r - .05, z + r + .05, HEARTHB, bevel=.012)
    else:
        for s in (-1, 1):
            span('mast partner', x - r - .06, x + r + .06, y0, y0 + .07, z + s * r, z + s * (r + .06), BEAMX, bevel=.008)
            span('mast partner', x + s * r, x + s * (r + .06), y0, y0 + .07, z - r, z + r, BEAMX, bevel=.008)
    yy = y0 + .25
    while yy < y1 - .12:
        rr = r * (1 - .1 * (yy - y0) / max(y1 - y0, .1))
        disc('mast band', (x, yy, z), rr + .008, .035, IRON, sides=10)
        yy += .55
    disc('mast band', (x, y1 - .1, z), r * .9 + .01, .05, IRON, sides=10)
    for dx, dz in knees:
        m = plane_m((x + dx * r * .9, 0, z + dz * r * .9), (dx, 0, dz), (0, 1, 0), (-dz, 0, dx))
        knee(m, y1, arm=.42, leg=.5, t=.08, r=.24, thick=.09)


def posts():
    for p in POSTS:
        x, z, y0, y1 = p['x'], p['z'], p['y0'], p['y1']
        top = y1 - BT - SUB - GD
        knees = []
        for f in FLOORS:
            if abs(f['y'] - y1) > .01:
                continue
            if abs(x - f['x0']) < .12 or abs(x - f['x1']) < .12:
                for dz in (-1, 1):
                    if f['z0'] - .01 <= z + dz * .5 <= f['z1'] + .01:
                        knees.append((0, dz))
            if abs(z - f['z0']) < .12 or abs(z - f['z1']) < .12:
                for dx in (-1, 1):
                    if f['x0'] - .01 <= x + dx * .5 <= f['x1'] + .01:
                        knees.append((dx, 0))
        mast_post(x, z, y0, top, knees=sorted(set(knees)))


# ---- the rope bridges ------------------------------------------------------------------------
def rope_bridge(f, anchored):
    """Planks across two foot ropes, their tops within 0.012 of the floor's height (the walk is
    flat), hand lines along the RAILS lines sagging between the ends, cords between hand line and
    foot rope, and hangers from the tie beams either side holding the middle. `anchored` is the end
    ('x0' or 'x1') that stands on a gallery, with a post for each line; the other is the crow's
    nest's rail, where the lines are lashed."""
    x0, x1, z0, z1, y = f['x0'], f['x1'], f['z0'], f['z1'], f['y']
    L_ = x1 - x0
    sag = lambda x: .01 * 4 * (x - x0) * (x1 - x) / (L_ * L_)
    g = rng(int(abs(x0) * 100) & 0xffff)
    n = max(4, round(L_ / .19))
    pw = L_ / n
    for i in range(n):
        xa, xb = x0 + i * pw + .012, x0 + (i + 1) * pw - .012
        yc = y - sag((xa + xb) / 2) - g.choice((0, .002))
        tw = g.uniform(-.012, .012)
        hull('bridge plank', [(xa, yc - .03, z0 + .012 + tw), (xb, yc - .03, z0 + .012 + tw), (xa, yc, z0 + .012 + tw), (xb, yc, z0 + .012 + tw),
                              (xa, yc - .03, z1 - .012 + tw), (xb, yc - .03, z1 - .012 + tw), (xa, yc, z1 - .012 + tw), (xb, yc, z1 - .012 + tw)],
             g.choice([WOOD, TREADZ, DECKZB, DECKZC]))
    k = 14
    xs = [x0 + L_ * i / k for i in range(k + 1)]
    for z in (z0 + .05, z1 - .05):
        tube('bridge foot rope', [(x, y - .042 - sag(x), z) for x in xs], .012, ROPE, sides=5)
    hr = .3
    hand = lambda x: y + hr - .06 * 4 * (x - x0) * (x1 - x) / (L_ * L_)
    for z in (z0, z1):
        tube('bridge hand line', [(x, hand(x), z) for x in xs], .013, ROPE, sides=5)
        xx = x0 + pw
        while xx < x1 - pw * .5:
            zz = z + (.05 if z == z0 else -.05)
            rod('bridge cord', (xx, y - .04 - sag(xx), zz), (xx, hand(xx), z), .004, ROPE, sides=3)
            xx += pw * 2
        xe = x0 + .036 if anchored == 'x0' else x1 - .036
        span('bridge post', xe - .035, xe + .035, y - .22, y + hr + .08, z - .035, z + .035, POSTW, bevel=.008)
        ball('bridge post cap', (xe, y + hr + .1, z), .026, DARK, seg=6, rings=3)
        for yy in (y + hr - .01, y - .04):
            torus('bridge lashing', (xe, yy, z), .042, .009, ROPE, seg=8, sides=3)
        xn = x1 if anchored == 'x0' else x0
        torus('bridge lashing', (xn, y + hr - .03, z), .03, .009, ROPE, seg=8, sides=3)
        torus('bridge lashing', (xn, y - .04, z + (.05 if z == z0 else -.05)), .03, .009, ROPE, seg=8, sides=3)
    # hangers from the nearest tie beam on each side of the bridge
    zc = (z0 + z1) / 2
    for t in (.3, .62):
        xh = x0 + L_ * t
        for z in (z0, z1):
            cands = [zt for zt in TRUSSES if (zt - zc) * (z - zc) > 0]
            if not cands:
                continue
            zt = min(cands, key=lambda v: abs(v - z))
            ztb = zt - .1 if zt > z else zt + .1
            with lid():
                rod('bridge hanger', (xh, hand(xh), z), (xh, EAVES + .02, ztb), .008, ROPE, sides=4)
                torus('hanger ring', (xh, EAVES - .015, ztb), .03, .007, IRON, seg=8, sides=3)


# ---- ways up ---------------------------------------------------------------------------------
def stair_frame(s):
    axis = s['axis']
    lo_y, hi_y = min(s['y0'], s['y1']), max(s['y0'], s['y1'])
    if axis == 'z':
        a0, a1, c0, c1 = s['z0'], s['z1'], s['x0'], s['x1']
    else:
        a0, a1, c0, c1 = s['x0'], s['x1'], s['z0'], s['z1']
    low_at, high_at = (a1, a0) if s['y0'] > s['y1'] else (a0, a1)
    dirn = 1 if high_at > low_at else -1
    run = abs(a1 - a0)

    def at(r, c, y):
        a = low_at + dirn * r
        return (c, y, a) if axis == 'z' else (a, y, c)
    return axis, lo_y, hi_y, c0, c1, low_at, dirn, run, at

def open_sides(s, on_solid):
    """The sides of a stair that are open (a drop beside them), as (c, drop) pairs: not against a
    wall, not beside the deck edges that rail a stairwell."""
    axis, lo_y, hi_y, c0, c1, low_at, dirn, run, at = stair_frame(s)
    out = []
    for c in (c0, c1):
        if axis == 'z' and (abs(c - HALL['x0']) < .06 or abs(c - HALL['x1']) < .06):
            continue
        if axis == 'x' and (abs(c - HALL['z0']) < .06 or abs(c - HALL['z1']) < .06):
            continue
        # beside a floor at or above the stair's top: a stairwell
        beside = False
        for f in FLOORS:
            if f['y'] < hi_y - .01:
                continue
            if axis == 'x' and f['x0'] <= (s['x0'] + s['x1']) / 2 <= f['x1'] and (abs(f['z1'] - c) < .02 or abs(f['z0'] - c) < .02):
                beside = True
        if not beside:
            out.append(c)
    return out

def stair(s):
    """Solid steps where the stair stands on the ground or a terrace (a block of timber under every
    tread, planked sides), treads on two stringers where there is room under it (over the hold);
    either way every tread's top on the slope the game walks, at the tread's middle, and a
    handrail on newels along each open side."""
    axis, lo_y, hi_y, c0, c1, low_at, dirn, run, at = stair_frame(s)
    rise = hi_y - lo_y
    n = max(3, round(rise / .1))
    k = rise / run
    g = rng(sum(map(ord, s['id'])))
    tmat = TREAD if axis == 'z' else TREADZ
    solid = s['id'] != 'bar-captain'
    base = 0.0 if solid else lo_y
    for i in range(n):
        ra, rb = run * i / n, run * (i + 1) / n
        ytop = lo_y + k * (ra + rb) / 2
        pa, pb = at(ra - .02, c0 + .01, ytop - .04), at(rb, c1 - .01, ytop)
        span('tread', min(pa[0], pb[0]), max(pa[0], pb[0]), ytop - .045, ytop, min(pa[2], pb[2]), max(pa[2], pb[2]), g.choice([tmat, tmat, WOOD, DECKC]), bevel=.006)
        if solid:
            qa, qb = at(ra + .005, c0 + .03, base), at(rb + .01, c1 - .03, ytop - .045)
            span('step', min(qa[0], qb[0]), max(qa[0], qb[0]), base, ytop - .045, min(qa[2], qb[2]), max(qa[2], qb[2]), g.choice([TAR, TARB, DARK]))
    ex = (0, 0, dirn) if axis == 'z' else (dirn, 0, 0)
    ez = (1, 0, 0) if axis == 'z' else (0, 0, 1)
    for c in (c0, c1):
        cc = c + (.02 if c == c0 else -.02)
        m = plane_m(at(0, cc, 0), ex, (0, 1, 0), ez)
        top = .06
        if solid:
            outline = [(-.02, base), (-.02, lo_y + top), (run - top / k, hi_y + .0), (run, hi_y), (run, base)]
            prism('stair side', outline, .04, DARK, m)
        else:
            bot = .16
            outline = [(0, lo_y - bot), (0, lo_y + top), (run - top / k, hi_y), (run, hi_y), (run, hi_y - top - bot)]
            prism('stringer', outline, .05, DARK, m)
    if solid:
        for c in (c0, c1):
            r = .1
            while r < run - .05:
                ya = lo_y + k * r
                p = at(r, c - (.012 if c == c0 else -.012), 0)
                span('stair batten', p[0] - (.02 if axis == 'x' else .012), p[0] + (.02 if axis == 'x' else .012), base + .02, ya - .02,
                     p[2] - (.012 if axis == 'x' else .02), p[2] + (.012 if axis == 'x' else .02), RIB)
                r += .5
    for c in open_sides(s, solid):
        cc = c + (.035 if c == c0 else -.035)
        handrail(at, cc, lo_y, k, run)

def handrail(at, cc, lo_y, k, run, hr=.32, rope=False):
    for r in (.05, run - .05) if run < 1.6 else (.05, run / 2, run - .05):
        ya = lo_y + k * r
        p = at(r, cc, 0)
        span('newel', p[0] - .03, p[0] + .03, ya - .06, ya + hr + .06, p[2] - .03, p[2] + .03, POSTW, bevel=.008)
        ball('newel cap', (p[0], ya + hr + .075, p[2]), .027, DARK, seg=6, rings=4)
    if rope:
        pts = [at(run * t, cc, lo_y + k * run * t + hr - .02 - .03 * math.sin(PI * t)) for t in [i / 10 for i in range(11)]]
        tube('handrail rope', pts, .014, ROPE, sides=5)
        return
    rod('handrail', at(.02, cc, lo_y + k * .02 + hr), at(run - .02, cc, lo_y + k * (run - .02) + hr), .022, OAK, sides=6)
    r = .16
    while r < run - .1:
        ya = lo_y + k * r
        rod('baluster', at(r, cc, ya - .02), at(r, cc, ya + hr), .012, WOOD, sides=4)
        r += .16

def gangplank(s):
    """A ship's gangplank from the ground up to the west landing: four planks side by side on two
    stringers, their tops on the slope the game walks, cleats across them to stand on, an iron shoe
    at the foot, hooks over the landing's edge, a rope handrail on stanchions along both sides."""
    axis, lo_y, hi_y, c0, c1, low_at, dirn, run, at = stair_frame(s)
    k = (hi_y - lo_y) / run
    g = rng(801)
    n = 4
    wid = (c1 - c0) / n

    def sl(label, ra, rb, ca, cb, d0, d1, mat):
        pts = []
        for r in (ra, rb):
            for c in (ca, cb):
                for d in (d0, d1):
                    pts.append(at(r, c, lo_y + k * r + d))
        hull(label, pts, mat)
    for i in range(n):
        ca, cb = c0 + i * wid + .006, c0 + (i + 1) * wid - .006
        sl('gangplank plank', .0, run + .03, ca, cb, -.045, g.choice((0, -.003)), g.choice([TREAD, HULLB, DECKC, DECKB]))
    for c in (c0 + .12, c1 - .12):
        sl('gangplank stringer', (.2 - lo_y + .01) / k, run - .05, c - .04, c + .04, -.2, -.045, DARK)
    r = .22
    while r < run - .1:
        sl('gangplank cleat', r - .02, r + .02, c0 + .03, c1 - .03, 0, .025, DARK)
        r += .3
    p = at(.07, (c0 + c1) / 2, 0)
    box('gangplank shoe', (p[0], lo_y - .01, p[2]), ((c1 - c0) - .04, .04, .14) if axis == 'z' else (.14, .04, (c1 - c0) - .04), IRON)
    for c in (c0 + .15, c1 - .15):
        q = at(run + .02, c, hi_y + .005)
        torus('gangplank hook', q, .03, .007, IRON, seg=8, sides=3, tilt=PI / 2, arc=PI, start=0)
    # the rope handrail: iron stanchions and a rope along their eyes, sagging between
    stan = [.15 + (run - .3) * i / 4 for i in range(5)]
    for c in (c0 + .03, c1 - .03):
        tops = []
        for r in stan:
            y0 = lo_y + k * r
            rod('gangplank stanchion', at(r, c, y0 - .02), at(r, c, y0 + .36), .011, IRON, sides=4)
            torus('stanchion eye', at(r, c, y0 + .37), .018, .005, IRON, seg=6, sides=3, tilt=PI / 2)
            tops.append((r, y0 + .37))
        pts = []
        for (ra, ya), (rb, yb) in zip(tops, tops[1:]):
            for j in range(5):
                t = j / 5
                pts.append(at(ra + (rb - ra) * t, c, ya + (yb - ya) * t - .05 * math.sin(PI * t)))
        pts.append(at(tops[-1][0], c, tops[-1][1]))
        tube('gangplank rope', pts, .012, ROPE, sides=5)
def ships_ladder(s):
    """A ship's ladder, steep: two side stringers and flat steps whose tops are on the slope the game
    walks, iron handrails run on up over the top."""
    axis, lo_y, hi_y, c0, c1, low_at, dirn, run, at = stair_frame(s)
    rise = hi_y - lo_y
    k = rise / run
    ln = math.hypot(run, rise)
    ux, uy = run / ln, rise / ln
    side = (1, 0, 0) if axis == 'z' else (0, 0, 1)
    for c in (c0 + .03, c1 - .03):
        a = at(-.02 * ux, c, lo_y - .02 * uy + .03)
        b = at(run + .08 * ux, c, hi_y + .08 * uy + .03)
        bent_timber('ladder stringer', [a, b], side, .14, .045, DARK)
    n = max(4, round(rise / .19))
    for i in range(n):
        r = run * (i + .5) / n
        y = lo_y + k * r
        pa, pb = at(r - .055, c0 + .055, y - .03), at(r + .055, c1 - .055, y)
        span('ladder step', min(pa[0], pb[0]), max(pa[0], pb[0]), y - .03, y, min(pa[2], pb[2]), max(pa[2], pb[2]), TREAD if axis == 'z' else TREADZ, bevel=.005)
    for c in (c0 + .03, c1 - .03):
        rod('ladder handrail', at(run * .45, c, lo_y + k * run * .45 + .35), at(run + .02, c, hi_y + .5), .014, IRON, sides=5)
        rod('ladder handrail', at(run + .02, c, hi_y + .5), at(run + .02, c, hi_y), .014, IRON, sides=5)


# ---- rails -----------------------------------------------------------------------------------
def rail_buried(x0, z0, x1, z1, y):
    """A rail line whose level is under a stair standing on it (the pit's edge beside the stair up to
    the bar): the stair's own handrail is the rail there."""
    for s in STAIRS:
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        if s['x0'] - .02 <= mx <= s['x1'] + .02 and s['z0'] - .02 <= mz <= s['z1'] + .02:
            if slope_y(s, mx, mz) > y + .2:
                return True
    return False

def rails():
    """Ship's rails along every RAILS line but the crow's nest's (the mast brings its own) and the
    bridges' (their hand lines): posts, a top rail at 0.26, balusters between."""
    nest = FL.get('crows-nest')
    bridges = [f for f in FLOORS if f['id'].startswith('bridge')]
    skipped = []
    for r in RAILS:
        x0, z0, x1, z1 = r['line']
        y = r['level']
        if nest and all(in_rect(x, z, nest, .01) for x, z in ((x0, z0), (x1, z1))):
            continue
        if any(abs(z0 - z1) < 1e-6 and (abs(z0 - b['z0']) < .01 or abs(z0 - b['z1']) < .01)
               and min(x0, x1) >= b['x0'] - .01 and max(x0, x1) <= b['x1'] + .01 for b in bridges):
            continue
        if rail_buried(x0, z0, x1, z1, y):
            skipped.append(r['line'])
            continue
        rail(x0, z0, x1, z1, y)
    if skipped:
        print(f'shell: rails under a stair, left to its handrail: {skipped}')

def rail(x0, z0, x1, z1, y):
    """A ship's rail along a RAILS line: stanchions with turned caps, a broad cap rail, a middle rail
    and balusters; on the galleries, taken from wrecks, a baluster missing or broken here and there."""
    along_x = abs(z1 - z0) < 1e-6
    a0, a1 = sorted((x0, x1)) if along_x else sorted((z0, z1))
    c = z0 if along_x else x0
    L_ = a1 - a0
    n = max(1, math.ceil(L_ / .6))
    top = .26
    g = rng(int(abs(a0 * 97 + c * 31 + y * 13) * 100))
    old = y > B + .1

    def S(label, u0, u1, y0, y1, w, mat, bevel=0.0):
        if along_x:
            span(label, u0, u1, y0, y1, c - w, c + w, mat, bevel)
        else:
            span(label, c - w, c + w, y0, y1, u0, u1, mat, bevel)
    posts_ = [a0 + L_ * i / n for i in range(n + 1)]
    for u in posts_:
        # no bevels, a box for a cap: a hundred and twenty posts at forty-four triangles and a ball
        # each were ten thousand of a hall at its ceiling
        S('rail post', u - .035, u + .035, y - .08, y + top + .02, .035, POSTW)
        S('rail post cap', u - .03, u + .03, y + top + .02, y + top + .06, .03, DARK)
    S('cap rail', a0 - .04, a1 + .04, y + top - .045, y + top, .048, OAK, .012)
    S('cap moulding', a0 - .03, a1 + .03, y + top - .065, y + top - .045, .03, DARK)
    S('bottom rail', a0 - .03, a1 + .03, y + .005, y + .035, .026, DARK, .006)
    u = a0 + .11
    while u < a1 - .05:
        if min(abs(u - p) for p in posts_) > .06:
            roll = g.random()
            if old and roll < .07:
                pass
            elif old and roll < .13:
                S('baluster', u - .013, u + .013, y + .035, y + .035 + g.uniform(.04, .1), .013, SPLINTER)
            else:
                S('baluster', u - .013, u + .013, y + .035, y + top - .065, .013, g.choice([WOOD, WOOD, OAK]))
        u += .12


# ---- the cellar arch, the cellar -------------------------------------------------------------
def cellar_arch():
    z0 = HALL['z0']
    g = rng(41)
    ac, ar, atop, aspring = arch_geom()
    m = plane_m((0, 0, z0 - W / 2), (1, 0, 0), (0, 1, 0), (0, 0, 1))
    for x0, x1 in ((ARCH[0] - .17, ARCH[0] + .012), (ARCH[1] - .012, ARCH[1] + .17)):
        ys = [0, .22, .44, aspring]
        for k, (y0, y1) in enumerate(zip(ys, ys[1:])):
            o = .015 if k == 1 else 0
            span('arch jamb', x0 - o, x1 + o, y0 + .003, y1 - .003, z0 - W - .03, z0 + .035,
                 g.choice([HEARTH, HEARTHB]), bevel=.012)
    ring('arch stone', m, ac, aspring, ar, ar + .12, 0, PI, 9, -W / 2 - .03, W / 2 + .035, [HEARTH, HEARTHB, CELLARC], g, jitter=.014)
    span('arch keystone', ac - .055, ac + .055, atop, atop + .14, z0 - W - .035, z0 + .05, HEARTH, bevel=.012)
    flags(ARCH[0], ARCH[1], z0 - W, z0, 55)

def block_wall(axis, plane, inward, u0, u1, y0, y1, seed, holes=(), mats=(CELLAR, CELLAR, CELLARB, CELLARC), back=W):
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
            wspan('block backing', axis, plane, inward, a, b, ya, yb, -back, -.05, CAVED)
            u = a - g.uniform(0, .25)
            while u < b:
                l = g.uniform(.18, .36)
                ua, ub = max(a, u), min(b, u + l)
                if ub - ua > .03:
                    # no bevel: forty-four triangles a block was fifteen thousand for a room seen
                    # through its door
                    wspan('block', axis, plane, inward, ua + .005, ub - .005, ya + .005, yb - .005,
                          -.06, g.uniform(0, .014), g.choice(mats))
                u += l

def cellar():
    ac, ar, atop, aspring = arch_geom()
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
    block_wall('x', z0, 1, x0, x1, 0, spring, 52)
    block_wall('z', x0, 1, z0, z1, 0, spring, 53)
    block_wall('z', x1, -1, z0, z1, 0, spring, 54)
    # its backing stops short of the hall's wall line: the hall's rock is a skin in front of it
    block_wall('x', z1, -1, x0, x1, 0, spring, 56, holes=[(ARCH[0], ARCH[1], 0, atop)], back=.088)
    Ro = R + .07
    arc = [(zc + Ro * math.cos(th0 + (PI - 2 * th0) * i / 12), yc + Ro * math.sin(th0 + (PI - 2 * th0) * i / 12)) for i in range(13)]
    end = [(arc[0][0], spring)] + arc + [(arc[-1][0], spring)]
    for xe in (x0 - W / 2, x1 + W / 2):
        m = plane_m((xe, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0))
        prism('cellar end', end, W, CELLAR, m)
    ribs = [x0 + .55, -6.2]
    for rx in ribs:
        span('vault pier', rx - .05, rx + .05, 0, spring, z0 - .01, z0 + .06, HEARTH, bevel=.01)
        if not (ARCH[0] - .12 < rx < ARCH[1] + .12):
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
    bars()

def bars():
    """Iron bars across the cellar's east end, CELLAR_BARS.z from x0 to the east wall, and their
    return at x0 to the north wall, a padlocked gate in the long side: the treasure's cage."""
    zb, xa, xb = BARS['z'], BARS['x0'], BARS['x1']
    zn = CEL['z0']
    yt = F + 1.1
    span('bars sill', xa - .03, xb, F - .01, F + .02, zb - .03, zb + .03, IRON)
    span('bars head', xa - .03, xb, yt, yt + .04, zb - .025, zb + .025, IRON)
    span('bars rail', xa, xb, F + .5, F + .53, zb - .018, zb + .018, IRON)
    for x in (xa, xb - .03):
        span('bars stile', x - .025, x + .025, F, yt, zb - .025, zb + .025, IRON)
    gate = (xa + .45, xa + .85)
    x = xa + .08
    while x < xb - .04:
        if not (gate[0] - .02 < x < gate[1] + .02):
            rod('bar', (x, F, zb), (x, yt, zb), .01, IRON, sides=5)
        x += .085
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
    z = zb - .09
    while z > zn + .05:
        rod('bar', (xa, F, z), (xa, yt, z), .01, IRON, sides=5)
        z -= .085
    span('bars head', xa - .025, xa + .025, yt, yt + .04, zn, zb, IRON)
    span('bars sill', xa - .03, xa + .03, F - .01, F + .02, zn, zb, IRON)
    span('bars rail', xa - .018, xa + .018, F + .5, F + .53, zn, zb, IRON)


# ---- the hearth ------------------------------------------------------------------------------
def hearth():
    """A big fireplace built into the west wall's fieldstone: stone jambs, an arch of voussoirs over
    the firebox, a hearthstone, an oak mantel on corbels and the chimney breast up to the roof.
    Its numbers, for the dressing: the jambs' face at HEARTH.x + 0.35, the opening 0.42 each side of
    HEARTH.z with its arch's crown at F + 0.87, the firebox back at x = -9.4, the mantel's top at
    F + 1.05 and 0.1 proud of the jambs, the breast 0.6 out of the wall at the mantel."""
    x0 = HALL['x0']
    hz = HEARTHP['z']
    xf = HEARTHP['x'] + .35
    xb = x0 - .4
    ow, spring = .42, F + .45
    r0, r1 = ow, ow + .12
    jw = .34
    mt = F + 1.05
    g = rng(71)
    for side in (-1, 1):
        za, zb = sorted((hz + side * ow, hz + side * (ow + jw)))
        ys = [0, .16, .32, spring, F + .66, mt - .1]
        for k, (y0, y1) in enumerate(zip(ys, ys[1:])):
            o = g.uniform(0, .025)
            span('hearth stone', x0 - .1, xf + o, y0 + .003, y1 - .003, za - (.015 if k % 2 else 0), zb + (.015 if k % 2 else 0),
                 g.choice([HEARTH, HEARTHB]), bevel=.014)
    span('firebox', xb - .06, xb, 0, spring + r0 + .05, hz - ow - .02, hz + ow + .02, SOOT)
    for side in (-1, 1):
        za = hz + side * ow
        span('firebox', xb, xf - .02, 0, spring + r0, min(za, za + side * .03), max(za, za + side * .03), SOOT)
    span('firebox hood', xb, xf - .2, spring + r0 * .5, mt - .1, hz - ow - .02, hz + ow + .02, SOOT)
    span('firebed', xb, xf, F - .02, F + .005, hz - ow, hz + ow, SOOT)
    m = plane_m((xf, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0))
    ring('hearth arch', m, hz, spring, r0, r1, 0, PI, 9, -.26, .014, [HEARTH, HEARTHB], g, gap=.004, jitter=.012)
    top = mt - .1
    for side in (-1, 1):
        cz = hz + side * ow
        pts = [(hz + r1 * math.cos(a), spring + r1 * math.sin(a))
               for a in ([PI * i / 10 for i in range(6)] if side > 0 else [PI - PI * i / 10 for i in range(6)])]
        pts = [(clamp(p[0], hz - ow - .12, hz + ow + .12), min(p[1], top)) for p in pts]
        fan('hearth spandrel', (cz + side * .12, top), pts + [(hz, top)], .24, HEARTHB, plane_m((xf - .12, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0)))
    span('hearth lintel stones', x0 - .1, xf - .01, spring + r1 - .03, top, hz - ow - jw, hz - .16, HEARTH, bevel=.012)
    span('hearth lintel stones', x0 - .1, xf - .01, spring + r1 - .03, top, hz + .16, hz + ow + jw, HEARTHB, bevel=.012)
    for i, (za, zb) in enumerate(((hz - .9, hz - .3), (hz - .3, hz + .3), (hz + .3, hz + .9))):
        span('hearthstone', xf - .02, xf + .42 - i * .03, 0, F + .012 - i * .003, za + .005, zb - .005, g.choice([HEARTH, HEARTHB]), bevel=.008)
    span('mantel', x0 - .05, xf + .1, mt - .1, mt, hz - ow - jw - .08, hz + ow + jw + .08, OAK, bevel=.016)
    for z in (hz - ow - jw + .06, hz + ow + jw - .06):
        span('corbel', x0, xf + .06, mt - .24, mt - .1, z - .06, z + .06, HEARTH, bevel=.012)
        span('mantel strap', xf + .08, xf + .105, mt - .105, mt + .005, z - .09, z - .05, IRON)
    # the chimney breast: stone courses narrowing up through the timber into the roof
    y = mt
    ytop = roof_y(x0 + .3) + .1
    while y < ytop:
        h = g.uniform(.12, .17)
        t = (y - mt) / (ytop - mt)
        hw_ = .8 - .22 * t
        proud = .6 - .18 * t
        za = hz - hw_
        while za < hz + hw_ - .02:
            l = min(g.uniform(.22, .38), hz + hw_ - za)
            span('chimney stone', x0 - .1, x0 + proud + g.uniform(-.015, .015), y + .004, min(y + h, ytop + .05) - .004,
                 za + .006, za + l - .006, g.choice([HEARTH, HEARTHB, CELLARC]))
            za += l
        y += h


# ---- the door --------------------------------------------------------------------------------
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
    span('quay', -DOOR - .6, DOOR + .6, 0, F - .01, z1 + W, z1 + W + 1.1, DECKB)
    prism('pane', [(-DOOR - 1.4, 0), (DOOR + 1.4, 0), (DOOR + 1.4, DH + .9), (-DOOR - 1.4, DH + .9)], .02, PANE,
          plane_m((0, 0, z1 + W + 1.15), (1, 0, 0), (0, 1, 0), (0, 0, 1)))
    door_leaf(DH)

def door_leaf(DH):
    """The door itself, hung on the pintles of the west post and swung out onto the quay: planks on
    two ledges and a brace, iron strap hinges, a ring to pull it by."""
    z1 = HALL['z1']
    hx, hz = -DOOR - .01, z1 + W + .02
    a = 1.05                                    # open: its face turned out towards the harbour
    w, h, t = 2 * DOOR - .02, DH - F - .03, .05
    m = Matrix.Translation((hx, 0, hz)) @ Matrix.Rotation(-a, 4, 'Y')
    g = rng(331)
    with geom.frame(m):
        n = 6
        for i in range(n):
            u0, u1 = w * i / n + .004, w * (i + 1) / n - .004
            span('door plank', u0, u1, F + .02, F + h - g.uniform(0, .02), 0, t, g.choice([HULLB, HULLC, DECKC]))
        for y in (F + .18, F + h - .18):
            span('door ledge', .03, w - .03, y - .05, y + .05, -.04, 0, DARK, bevel=.008)
            span('door strap', -.02, w * .72, y - .025, y + .025, t, t + .01, IRON)
        rod('door brace', (w - .08, F + .24, -.02), (.08, F + h - .24, -.02), .03, DARK, sides=4)
        torus('door ring', (w - .12, F + .55, t + .012), .03, .006, IRON, seg=8, sides=4, tilt=PI / 2)

def cannonball(x, y, zf, g):
    span('shot hole', x - .1, x + .1, y - .09, y + .09, zf - .002, zf + .01, BLACK)
    ball('cannonball', (x, y, zf + .02), .075, IRON, seg=10, rings=6)
    for i in range(13):
        a = TAU * i / 13 + g.uniform(-.2, .2)
        r0 = .07
        L_ = g.uniform(.07, .19)
        w = g.uniform(.012, .026)
        ca, sa = math.cos(a), math.sin(a)
        pa = (x + ca * r0, y + sa * r0)
        pb = (x + ca * (r0 + L_), y + sa * (r0 + L_))
        nx, ny = -sa * w, ca * w
        lift = g.uniform(.012, .05)
        hull('splinter', [(pa[0] + nx, pa[1] + ny, zf - .004), (pa[0] - nx, pa[1] - ny, zf - .004),
                          (pa[0] + nx, pa[1] + ny, zf - lift), (pa[0] - nx, pa[1] - ny, zf - lift),
                          (pb[0], pb[1], zf - .002), (pb[0] + nx * .3, pb[1] + ny * .3, zf - .008)],
             SPLINTER if i % 3 else HULLC)


# ---- the pool, the sea arch ------------------------------------------------------------------
def pool():
    x0, x1, z0, z1 = POOL['x0'], POOL['x1'], POOL['z0'], POOL['z1']
    wy = POOL['surface']
    span('water', x0, x1 + W, 0, wy, z0, z1 + W, WATER)
    jz0, jz1 = JETTY['z0'], JETTY['z1']
    for za, zb in ((z0, jz0), (jz1, z1)):
        span('pool curb', x0 - .06, x0 + .03, 0, F + .004, za, zb, DARK, bevel=.008)
    span('pool curb', x0, x1, 0, F + .004, z0 - .06, z0 + .03, DARK, bevel=.008)
    g = rng(401)
    for i in range(26):
        z = z0 + .1 + (z1 - z0 - .2) * i / 25
        if jz0 - .1 < z < jz1 + .1:
            continue
        s = g.uniform(.07, .14)
        rock((x0 + .03 + s * .5, 0, z + g.uniform(-.03, .03)), (s * .8, g.uniform(.03, .042), s),
             g.randrange(1 << 30), g.choice([ROCK, CAVE, SEAROCK]))
    for i in range(12):
        x = x0 + .15 + (x1 - x0 - .3) * i / 11
        s = g.uniform(.07, .14)
        rock((x + g.uniform(-.03, .03), 0, z0 + .03 + s * .5), (s, g.uniform(.03, .042), s * .8),
             g.randrange(1 << 30), g.choice([ROCK, CAVE, SEAROCK]))
    for i in range(10):
        x = x0 + .2 + (x1 - x0 - .2) * i / 9
        s = g.uniform(.1, .18)
        rock((x, 0, z1 - s * .4), (s, .04, s * .6), g.randrange(1 << 30), g.choice([SEAROCK, CAVE]))
    for at, s in (((8.3, 3.0), .2), ((8.0, 5.9), .16), ((6.9, 2.2), .12), ((8.6, 5.2), .1)):
        rock((at[0], 0, at[1]), (s, .08, s * .8), g.randrange(1 << 30), SEAROCK)
    jetty()

def jetty():
    x0, x1, z0, z1, y = JETTY['x0'], JETTY['x1'], JETTY['z0'], JETTY['z1'], JETTY['y']
    g = rng(411)
    n = 11
    pw = (x1 - x0) / n
    for i in range(n):
        xa, xb = x0 + i * pw + .006, x0 + (i + 1) * pw - .006
        dz = g.uniform(-.02, .02)
        span('jetty plank', xa, xb, y - .03, y - g.choice((0, 0, .003)), z0 - .01 + dz, z1 + .01 + dz, g.choice([TREADZ, DECKZB, WOOD]), bevel=.004)
    for z in (z0 + .04, z1 - .04):
        span('jetty stringer', x0 - .05, x1, max(.003, y - .03 - .06), y - .03, z - .025, z + .025, DARK, bevel=.006)
    for x in (x0 + .5, x0 + 1.05, x1 - .04):
        for z in (z0 + .03, z1 - .03):
            top = y - .03 if not (x > x1 - .1 and z > z1 - .05) else y + .3
            disc('pile', (x, 0, z), .035, top, POSTW, sides=7)
            span('pile band', x - .038, x + .038, .03, .05, z - .038, z + .038, IRON)
    xm, zm = x1 - .04, z1 - .03
    disc('mooring cap', (xm, y + .3, zm), .042, .02, DARK, sides=7)
    for k in range(3):
        torus('mooring rope', (xm, y + .12 + k * .025, zm), .04, .008, ROPE, seg=8, sides=3)
    disc('cleat', (x0 + .6, y, z1 - .06), .015, .03, IRON, sides=5)
    span('cleat', x0 + .54, x0 + .66, y + .03, y + .045, z1 - .075, z1 - .045, IRON)

def arch_outline(n=40):
    """The sea arch's opening in the east wall as (t, z, y, nz, ny): up the south leg from the
    water, round the top, down the north leg, with the outward normal in the wall's plane. Its
    edge a little broken, as a fieldstone arch's is."""
    az0, az1 = POOL['arch']
    zc, hw = (az0 + az1) / 2, (az1 - az0) / 2
    spring, rv = ARCH_SPRING, ARCH_RISE
    legs = max(2, round(spring / .3))
    out = []
    pts = [(az1, spring * k / legs) for k in range(legs)]
    pts += [(zc + hw * math.cos(PI * i / n), spring + rv * math.sin(PI * i / n)) for i in range(n + 1)]
    pts += [(az0, spring * (legs - k) / legs) for k in range(1, legs + 1)]
    for k, (z, y) in enumerate(pts):
        if y <= spring + 1e-6 and (z == az0 or z == az1):
            nz, ny = (1.0 if z == az1 else -1.0), 0.0
        else:
            a = math.atan2((y - spring) / rv, (z - zc) / hw)
            nz, ny = math.cos(a) / hw, math.sin(a) / rv
            ln = math.hypot(nz, ny)
            nz, ny = nz / ln, ny / ln
        t = k / (len(pts) - 1)
        rough = .02 + .07 * fbm(t * 9, 0, 441)
        out.append((t, z + nz * rough, y + ny * rough, nz, ny))
    return out
def sea_arch():
    """The sea's way in through the east wall: a ring of big field boulders round the opening, a
    tunnel of rough stone through the wall's thickness and a little way on, the water running on out
    of it, rocks standing in the sea and the night. The wall's own fieldstone round it is east_wall's."""
    x1 = HALL['x1']
    az0, az1 = POOL['arch']
    zc, hw = (az0 + az1) / 2, (az1 - az0) / 2
    wy = POOL['surface']
    spring, rv = ARCH_SPRING, ARCH_RISE
    edge = arch_outline()
    g = rng(421)
    # the ring: boulders set round the opening, bigger than the wall's
    for i in range(0, len(edge), 2):
        t, z, y, nz, ny = edge[i]
        s = g.uniform(.13, .17)
        cobble((x1 + .012, max(s * .9, y + ny * (s + .02)), z + nz * (s + .02)), (.06, s * g.uniform(.8, 1.0), s),
               g.randrange(1 << 30), g.choice(FIELD))
    xs = [x1 + .02, x1 + .3, x1 + .7, x1 + 1.1, x1 + 1.5, x1 + 1.9]
    flare = [.1, 0, .05, .12, .18, .26]
    R = {}
    for i, (t, z, y, nz, ny) in enumerate(edge):
        for j, (xx, f) in enumerate(zip(xs, flare)):
            n = fbm(t * 7, j * .8, 447) - .5
            o = f + .12 * n
            xj = xx + (0 if j in (0, len(xs) - 1) else (_h(i, j, 449) - .5) * .12)
            R[i, j] = (xj, max(0.0, y + ny * o), z + nz * o, nz, ny)
    for i in range(len(edge) - 1):
        for j in range(len(xs) - 1):
            q = [R[i, j], R[i + 1, j], R[i + 1, j + 1], R[i, j + 1]]
            pts = [(p[0], p[1], p[2]) for p in q] + [(p[0], p[1] + p[4] * .4, p[2] + p[3] * .4) for p in q]
            c = (edge[i][0] + edge[i + 1][0]) / 2
            hull('arch rock', pts, FIELD[int(fbm(c * 6, j * .7, 451) * 97) % len(FIELD)])
    for z in (az0 - .1, az1 + .1, az0 + .25, az1 - .3):
        s_ = g.uniform(.2, .32)
        rock((x1 - .15 + g.uniform(-.05, .2), 0, z), (s_, s_ * .7, s_ * .9), g.randrange(1 << 30), g.choice([SEAROCK, CAVE, ROCK]))
    span('water', x1 + W, x1 + 2.6, 0, wy, az0 - .6, az1 + .6, WATER)
    for (x, z, s, h) in ((9.9, 2.9, .22, .25), (10.4, 5.3, .3, .4), (10.9, 3.7, .16, .12), (11.2, 2.8, .35, .5)):
        rock((x, 0, z), (s, h * .6 + .04, s * .8), g.randrange(1 << 30), SEAROCK)
    prism('pane', [(az0 - 1.0, 0), (az1 + 1.0, 0), (az1 + 1.0, spring + rv + .8), (az0 - 1.0, spring + rv + .8)], .04, PANE,
          plane_m((x1 + 2.3, 0, 0), (0, 0, 1), (0, 1, 0), (1, 0, 0)))


# ---- build -----------------------------------------------------------------------------------
# Portholes, (u, y) on each wall: between the ribs, under and over the galleries, clear of the sconces.
NORTH_PORTS = [(-6.2, F + 2.8), (6.2, F + 2.82), (-4.4, F + 2.6), (4.4, F + 2.6)]
SOUTH_PORTS = [(-6.8, F + 2.7), (-2.6, F + 2.7), (2.6, F + 2.7), (6.8, F + 2.7), (-2.6, F + 3.9), (2.6, F + 3.9)]
WEST_PORTS = [(-5.4, F + 2.82), (-3.4, F + 2.82), (-1.4, F + 2.82), (.6, F + 2.82), (2.6, F + 2.82),
              (-5.4, F + 4.0), (-1.4, F + 4.0), (.6, F + 4.0), (6.4, F + 2.6), (6.4, F + 3.9)]
EAST_PORTS = [(-5.4, F + 2.82), (-3.4, F + 2.82), (-1.4, F + 2.82), (.6, F + 2.82),
              (-5.4, F + 4.0), (-3.4, F + 4.0), (-1.4, F + 4.0)]


def build(L):
    _init(L)
    ground()
    pit()
    bar()
    north_wall()
    west_wall()
    cellar_arch()
    cellar()
    hearth()
    captain_deck()
    west_gallery()
    upper_galleries()
    rope_bridge(FL['bridge-west'], 'x0')
    rope_bridge(FL['bridge-east'], 'x1')
    for s in STAIRS:
        if s['kind'] == 'ladder':
            ships_ladder(s)
        elif s['kind'] == 'gangplank':
            gangplank(s)
        else:
            stair(s)
    rails()
    posts()
    pool()
    if BOW:
        ph_bow()
    with group('near'):
        south_wall()
        east_wall()
        sea_arch()
    roof()
    print(f'shell: {sum(geom.TRIS.values())} triangles')
