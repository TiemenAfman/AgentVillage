"""The hatch-cover table (the keeper's drawing `luiktafel`): a ship's cargo hatch taken off its
coaming and used as a table top. A thick frame of honey-coloured boards stacked two or three high,
one of them chipped at a corner, planks inside it running the long way, a heavy rope laid round the
top edge, dark iron angle brackets bolted over the four corners and iron rings hanging off the
sides - on a short squat cask as its foot, the bar stool's cask (stool.py `bulge`) grown to a
table's size so that the two read as one family.

Two things come out of it. `hatch_top` is the top alone, for any w x d: the room's long trestle
tables (1.5 x 0.5, scripts/krakenroom/dressing.py) call it in place of their placeholder, so it
is written for a long narrow top as much as for the square one - planks along the long side,
brackets at all four corners, rings on the long sides only. `build()` is the drawing itself, the
square table on its cask, as the asset `civic_kraken_hatch`.

What is fixed: the top surface is y + TOP_T exactly (the coaming's top and the highest plank; the
other planks sit a hair under it, never over), since that is where the caller stands its clutter,
and nothing but the rope and the corner irons rises over it - the rope by 0.017, the irons' lip
by 0.004 - so a tankard put down on the edge stands. The coaming hangs `drop` below the support
height y as an apron: little by default, because at the long tables a sitting settler's thighs are
at 0.15 under a top at 0.23, and the drawing's deep apron (`SHOW_DROP`) only on the showcase,
which nobody sits at.
"""
import math
import bmesh
from mathutils import Vector
from geom import TAU, PI, IRON, DARK, emit, span, lathe, torus, hull, rod, frame, M, material, rng
from stool import bulge as stool_bulge, STAVES

ASSET = 'civic_kraken_hatch'

TOP_T = .03                 # the top's thickness over its support: clutter stands at y + TOP_T
TABLE_H = .2                # scripts/krakenroom/dressing.py TABLE_H: where a table's top is carried
HEIGHT = TABLE_H + TOP_T    # the square table's top surface (the long tables' height too)
SQUARE = .55                # the showcase's top, square
FOOT_R = .15                # the cask's widest radius: 0.3 across
SHOW_DROP = .08             # the showcase's apron under the support: a coaming 0.11 deep, as drawn

COAMING = .04               # the frame's wall, horizontally
BOARD = .036                # a coaming board's height, near enough (the count is rounded)
BRACKET = .075              # how far an angle iron's arm runs from its corner
IRON_T = .005               # its plate
LIP = .004                  # the fold over the top edge: all an iron rises over the top
ROPE_R = .011               # a heavy rope: 0.09 m across
ROPE_IN = .022              # its middle from the outer edge (the coaming is COAMING wide)
ROPE_UP = .55               # its middle this share of ROPE_R over the top: it rises ROPE_R * 1.55
ROPE_STEP = .02             # a point of the rope every so far along it
RING_R, RING_W = .03, .0055

HONEY = {'x': material('plank:hatch', 0xa87440), 'z': material('plankZ:hatch', 0xa87440)}
DECK = [{'x': material('plank:hatch-deck', 0xb07c42), 'z': material('plankZ:hatch-deck', 0xb07c42)},
        {'x': material('plank:hatch-deck-b', 0x9e6a37), 'z': material('plankZ:hatch-deck-b', 0x9e6a37)}]
ROPE_MAT = material('plain:hatch-rope', 0x8f6d45)   # browner than the hall's rope, as drawn


def sp(label, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    """span() that takes its bounds in either order (the corners are mirrored by sign)."""
    span(label, min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1), mat, bevel=bevel)


def chipped(label, x0, x1, y0, y1, z0, z1, corner, cut, mat, bevel):
    """A board with one corner knocked off: the box's eight corners with `corner` (a point) replaced
    by three points `cut` in from it along x, y and z - a flat chip, so the hull stays convex."""
    # In plain floats: a mathutils Vector holds single precision, and the corner never compared
    # equal to the board's own bounds (the chip was cut outwards, a board sticking out past its iron).
    pts = []
    lo = (x0, y0, z0)
    for x in (x0, x1):
        for y in (y0, y1):
            for z in (z0, z1):
                p = (x, y, z)
                if max(abs(a - b) for a, b in zip(p, corner)) > 1e-7:
                    pts.append(p)
                    continue
                for axis in range(3):
                    q = list(p)
                    q[axis] += (1 if abs(p[axis] - lo[axis]) < 1e-9 else -1) * cut[axis]
                    pts.append(tuple(q))
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    loose = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    # The hull comes back as triangles; made flat faces again the bevel runs round the board's
    # edges only, not across its sides.
    bmesh.ops.dissolve_limit(bm, angle_limit=.01, verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, offset_type='OFFSET', segments=1,
                    profile=.5, affect='EDGES', clamp_overlap=True)
    emit(bm, mat, label)


def rivet(label, p, normal, k=.0042, h=.004):
    """A bolt head: a four-sided pyramid pressed onto a surface at p, pointing along `normal`."""
    n = Vector(normal).normalized()
    u = n.cross(Vector((0, 1, 0)))
    u = u.normalized() if u.length > 1e-6 else Vector((1, 0, 0))
    v = n.cross(u)
    p = Vector(p)
    base = [p + (u * a + v * b) * k for a, b in ((1, 0), (0, 1), (-1, 0), (0, -1))]
    hull(label, [tuple(q) for q in base] + [tuple(p + n * h)], IRON)


def rope_loop(label, pts, y, r, flat=.9, lobe=.72):
    """A closed rope along `pts` (x, z) at height y: the stool's twisted triangular strand with its
    three edges rounded into lobes (a section of six points, every other one `lobe` in), turning 40
    degrees a point. The stool's sharp triangle at this size read as a saw blade along the edge of
    the table rather than as a lay; three strands wound round each other cost half again as much
    and read no better from above. The whole twist is a whole number of turns, so the last section
    meets the first."""
    n = len(pts)
    turns = max(1, round(n / 9))
    twist = TAU * turns / n
    P = [Vector((x, y, z)) for x, z in pts]
    bm = bmesh.new()
    rings = []
    for i in range(n):
        t = (P[(i + 1) % n] - P[i - 1]).normalized()
        out = Vector((t.z, 0, -t.x))
        up = Vector((0, 1, 0))
        rings.append([bm.verts.new(P[i] + (out * flat * math.cos(twist * i + TAU * j / 6)
                                          + up * math.sin(twist * i + TAU * j / 6)) * r * (1 if j % 2 == 0 else lobe))
                      for j in range(6)])
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(6):
            bm.faces.new((A[j], A[(j + 1) % 6], B[(j + 1) % 6], B[j]))
    emit(bm, ROPE_MAT, label)


def rounded_rect(a, b, rc, step):
    """Points round a rectangle of half sides a x b with corners rounded by rc, about `step` apart."""
    pts = []
    corners = ((a - rc, b - rc, 0), (-(a - rc), b - rc, PI / 2), (-(a - rc), -(b - rc), PI), (a - rc, -(b - rc), 1.5 * PI))
    for k, (cx, cz, a0) in enumerate(corners):
        # The straight run into this corner (from the previous one), then the quarter round.
        px, pz, _ = corners[k - 1]
        pa = a0 - PI / 2
        sx, sz = px + rc * math.cos(pa), pz + rc * math.sin(pa)
        ex, ez = cx + rc * math.cos(pa), cz + rc * math.sin(pa)
        runs = max(1, round(math.hypot(ex - sx, ez - sz) / step))
        for i in range(runs):
            pts.append((sx + (ex - sx) * i / runs, sz + (ez - sz) * i / runs))
        arcs = max(2, round(rc * PI / 2 / step))
        for i in range(arcs):
            ang = pa + PI / 2 * i / arcs
            pts.append((cx + rc * math.cos(ang), cz + rc * math.sin(ang)))
    return pts


def ring(phi, at, drop):
    """An iron ring hung off a face from a staple: modelled on a face facing +z at `at` (x, y, z
    of the face), turned by phi to the face it hangs on. Its top is at the staple, its bottom leans
    back against the boards, as a ring on a wall hangs."""
    lean = .15
    R = min(RING_R, max(.02, drop * .55))
    # Tilted by PI/2 + lean the ring's top stands out by R sin(lean) and its bottom in by as much:
    # the eye is put where the bottom just touches the boards.
    eye = RING_W + 2 * R * math.sin(lean) + .001
    with frame(M(at, turn=phi)):
        sp('hatch staple', -.009, .009, -.011, .011, 0, .005, IRON)
        rod('hatch staple eye', (0, 0, .004), (0, 0, eye + .002), .004, IRON, sides=4)
        torus('hatch ring', (0, -R * math.cos(lean) + RING_W * .5, eye - R * math.sin(lean)),
              R, RING_W, IRON, seg=10, sides=4, tilt=PI / 2 + lean)


def hatch_top(cx, cz, y, w, d, seed=0, rope=True, rings=True, drop=.02):
    """A hatch cover as a table top, w x d round (cx, cz), carried at y: its top surface is at
    y + TOP_T (the coaming's top; the planks within it are flush or a hair under). The coaming
    hangs `drop` under y as an apron. Planks along the longer side, an angle iron over each corner,
    a rope round the top edge (`rope`), rings on the long sides (`rings`; all four when square)."""
    g = rng(seed)
    turned = d > w + 1e-9
    W, D = (d / 2, w / 2) if turned else (w / 2, d / 2)     # local: x is the long side
    ax, az = ('z', 'x') if turned else ('x', 'z')            # which sheet a board along local x / z takes
    T, yb = y + TOP_T, y - drop
    c = min(COAMING, .12 * 2 * D)
    nb = max(2, round((T - yb) / BOARD))
    # Board heights: a little uneven, as boards are, and summing to the coaming exactly.
    hs = [1 + g.uniform(-.12, .12) for _ in range(nb)]
    k = (T - yb) / sum(hs)
    ys = [yb]
    for h in hs:
        ys.append(ys[-1] + h * k)
    ys[-1] = T
    chip_x, chip_z = g.choice((-1, 1)), g.choice((-1, 1))
    # The chip goes some way down the top board and never through it (a chip as deep as the board
    # left the bevel faces of no size, which the bake refuses).
    chip_h = ys[-1] - ys[-2]
    with frame(M((cx, 0, cz), turn=PI / 2 if turned else 0)):
        # ---- the coaming: long boards the full length (a butt joint in a long one), short ones between.
        for sz in (-1, 1):
            for i in range(nb):
                out = g.uniform(-.0015, .0015) if i < nb - 1 else 0
                z0, z1 = sz * (D - c), sz * (D + out)
                cuts = [-W, W]
                if 2 * W > .9:
                    cuts = [-W, g.uniform(-.25, .25) * W, W]
                for j in range(len(cuts) - 1):
                    x0 = cuts[j] + (.0015 if j else 0)
                    x1 = cuts[j + 1] - (.0015 if j < len(cuts) - 2 else 0)
                    top_end = i == nb - 1 and sz == chip_z and (x1 == W if chip_x > 0 else x0 == -W)
                    if top_end:
                        corner = (chip_x * W, T, sz * (D + out))
                        chipped('hatch coaming chip', x0, x1, ys[i] + .001, T, min(z0, z1), max(z0, z1),
                                corner, (.045, chip_h * .6, .028), HONEY[ax], .004)
                    else:
                        sp('hatch coaming', x0, x1, ys[i] + .001, ys[i + 1] - (.001 if i < nb - 1 else 0), z0, z1,
                           HONEY[ax], bevel=.004)
        for sx in (-1, 1):
            for i in range(nb):
                out = g.uniform(-.0015, .0015) if i < nb - 1 else 0
                x0, x1 = sx * (W - c), sx * (W + out)
                zc0, zc1 = -(D - c) + .001, D - c - .001
                if i == nb - 1 and sx == chip_x:
                    corner = (sx * W, T, chip_z * zc1)
                    chipped('hatch coaming chip', min(x0, x1), max(x0, x1), ys[i] + .001, T, zc0, zc1,
                            corner, (.02, chip_h * .4, .024), HONEY[az], .004)
                else:
                    sp('hatch coaming', x0, x1, ys[i] + .001, ys[i + 1] - (.001 if i < nb - 1 else 0), zc0, zc1,
                       HONEY[az], bevel=.004)
        # ---- the cover: a dark board under planks laid the long way, their seams showing it.
        ix, iz = W - c, D - c
        sp('hatch board', -ix, ix, y, y + .008, -iz, iz, DARK)
        n = max(3, round(2 * iz / .07))
        pw = 2 * iz / n
        for p in range(n):
            z0, z1 = -iz + p * pw + .002, -iz + (p + 1) * pw - .002
            top = T - (0 if p % 3 == 1 else g.choice((0, .0008, .0015)))
            length = 2 * ix
            joints = int(length / .9) + (1 if g.random() < .4 else 0)
            xs = sorted(g.uniform(-ix + .12, ix - .12) for _ in range(joints)) if length > .3 else []
            xs = [-ix] + xs + [ix]
            for j in range(len(xs) - 1):
                x0 = xs[j] + (.002 if j else 0)
                x1 = xs[j + 1] - (.002 if j < len(xs) - 2 else 0)
                if x1 - x0 < .04:
                    continue
                sp('hatch plank', x0, x1, y + .008, top, z0, z1, g.choice(DECK)[ax], bevel=.003)
        # ---- the angle irons: a plate on each face round the corner, folded over the top edge.
        for sx in (-1, 1):
            for sz in (-1, 1):
                chip = sx == chip_x and sz == chip_z
                ytop = ys[-2] if chip else T      # the iron at the broken corner ends under the chip
                ya = yb - .004
                L = min(BRACKET, .3 * D)
                sp('hatch iron', sx * (W - L), sx * (W + IRON_T), ya, ytop, sz * D, sz * (D + IRON_T), IRON, bevel=.0015)
                sp('hatch iron', sx * W, sx * (W + IRON_T), ya, ytop, sz * (D - L), sz * D, IRON, bevel=.0015)
                if not chip:
                    sp('hatch iron lip', sx * (W - L), sx * (W + IRON_T), T, T + LIP, sz * (D - .012), sz * (D + IRON_T), IRON)
                    sp('hatch iron lip', sx * (W - .012), sx * W, T, T + LIP, sz * (D - L), sz * (D - .012), IRON)
                for i in range(len(ys) - 1):
                    yr = (ys[i] + ys[i + 1]) / 2
                    if yr > ytop:
                        continue
                    rivet('hatch bolt', (sx * (W - L * .55), yr, sz * (D + IRON_T)), (0, 0, sz))
                    rivet('hatch bolt', (sx * (W + IRON_T), yr, sz * (D - L * .55)), (sx, 0, 0))
        # ---- the rope round the top, and the rings.
        if rope:
            e = min(ROPE_IN, c * .55)
            rope_loop('hatch rope', rounded_rect(W - e, D - e, .025, ROPE_STEP), T + ROPE_R * ROPE_UP, ROPE_R)
        if rings:
            # Off the foot of an iron, as drawn: on the long sides' irons, or round the four faces
            # in turn when the top is square, so that each face has one.
            L = min(BRACKET, .3 * D)
            square = abs(W - D) < 1e-6
            for sx, sz in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                on_x = square and sx * sz < 0
                if on_x:
                    at, phi = (sx * (W + IRON_T), yb, sz * (D - L * .3)), PI / 2 * sx
                else:
                    at, phi = (sx * (W - L * .3), yb, sz * (D + IRON_T)), 0 if sz > 0 else PI
                ring(phi, at, T - yb)

def cask(y1, R=FOOT_R, n=12):
    """The foot: the bar stool's cask (stool.bulge, the same belly) grown to R at its widest and
    y1 tall, as twelve staves with a seam between each over a dark core, and dark iron hoops -
    a wide one at the foot and one just under the coaming, as drawn."""
    top = max(stool_bulge(i / 20) for i in range(21))
    rb = lambda t: stool_bulge(t) * R / top
    ts = (0, .25, .5, .75, 1)
    lathe('hatch cask core', [(0, 0)] + [(rb(t) - .01, y1 * t) for t in ts] + [(0, y1)], DARK, sides=n)
    gap = .004 / R
    for s in range(n):
        a0, a1 = TAU * s / n + gap, TAU * (s + 1) / n - gap
        bm = bmesh.new()
        rows = []
        for t in ts:
            r = rb(t)
            ring_ = []
            for a, rr in ((a0, r), (a1, r), (a1, r - .012), (a0, r - .012)):
                ring_.append(bm.verts.new((rr * math.cos(a), y1 * t, rr * math.sin(a))))
            rows.append(ring_)
        for A, B in zip(rows, rows[1:]):
            for j in range(4):
                bm.faces.new((A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j]))
        bm.faces.new(rows[0])
        bm.faces.new(list(reversed(rows[-1])))
        emit(bm, STAVES, 'hatch cask stave')
    for t0, t1 in ((0, .13), (.46, .55)):
        lathe('hatch cask hoop', [(rb(t0) + .004, y1 * t0), (rb(t1) + .004, y1 * t1)], IRON, sides=n)
    for s in range(0, n, 3):
        a = TAU * (s + .5) / n
        t = .505
        r = (rb(t) + .004) * math.cos(PI / n)
        rivet('hatch cask rivet', (r * math.cos(a), y1 * t, r * math.sin(a)), (math.cos(a), 0, math.sin(a)))


def build():
    y = HEIGHT - TOP_T
    cask(y)
    hatch_top(0, 0, y, SQUARE, SQUARE, seed=2, drop=SHOW_DROP)   # seed 2: the chip at the front left, as drawn
