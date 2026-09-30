"""The bar counter (the keeper's drawing 3): a length of a ship's side stood on the floor with an
oak slab on it. The front is the hull - four thick strakes with deep dark seams, bellied out at
mid height and tucked in hard towards the floor, a heavy dark wale under the top, both ends
rounded off like a bow in plan and in elevation with a dark stem post - and on it the drawing's
motif repeated along the length: rib, gun port, rib, gun port, rib, the carved wheel panel
between two brass strips, and the same again. A brass foot rail on brackets runs in front.

The numbers that are fixed are the room's (the counter it replaces): the slab 3.48 x 0.34 with its
top at y = 0.31, the body 3.4 long and 0.26 deep round z = 0 with its back flat at z = -0.13,
nothing but the rail in front of z = 0.15 under the slab, the rail's axis at y = 0.08, z = 0.185.

The drawing is about 3:1 and this counter 11:1, so everything on the hull is sized to its
HEIGHT, not its length: a first version scaled to the length had ports like postage stamps and
a hull whose shape vanished. The length is filled by repeating the motif instead.

The hull is lofted rather than stacked: every strake is a closed plank of its own through the
same stations, bevelled along both edges, laid over a dark core well behind them, so the gap
between two strakes is a real seam that shows the core. The renderer shades flat facets, so the
rounded ends are cut by angle (ROUND steps a quarter turn) and the rail and wheel get sides.
"""
import math
import bmesh
from mathutils import Vector
from geom import (emit, span, rod, disc, ball, tube, torus, hull, lathe, frame, M, material,
                  OAK, TAR, DARK, CARVED, PANEL, BARW, BRASS, GOLD, BLACK, PI, TAU)

ASSET = 'civic_kraken_counter'

TOP_Y = .31                 # the slab's upper face (room data)
WALE0, WALE1 = .232, .28    # the rubbing strake under the slab
BACK = -.13                 # the barkeeper's side, flat
D = .008                    # how far a strake's lower edge stands proud of the curve (a lap)
G = .003                    # half a seam: the gap between two strakes is 2G
S_MIN, U0 = .15, .8         # the rounded ends: depth left at the tip, where the rounding starts
ZMAX, Z0, BELLY = .124, -.02, .15   # the side view: widest at BELLY, Z0 where it meets the floor
ROUND = 10                  # stations per rounded end

STRAKE_MATS = [material('plank:counter-a', 0x6e4c31), material('plank:counter-b', 0x5f412a),
               material('plank:counter-c', 0x684630), material('plank:counter-d', 0x5a3d28)]
STRAKES = [0, .062, .118, .174, WALE0]
LID = material('plank:portlid', 0x33241a)
STRAP = material('plain:strap', 0x5b5d61)


def zf(y):
    """The hull's front in side view, at full depth: the belly at 0.15 and the lower third turned
    in hard, to meet the floor well behind the front (the drawing's side view)."""
    if y < BELLY:
        return ZMAX - (ZMAX - Z0) * ((BELLY - y) / BELLY) ** 2.53
    return ZMAX - 1.2 * (y - BELLY) ** 2


def xe(y):
    """Half the body's length at height y: the ends follow the belly, so from the front the bow
    and the stern are a curve, 1.70 out at the belly and 1.40 at the floor."""
    return 1.70 - .30 * (1 - (zf(y) - Z0) / (ZMAX - Z0))


def s(u):
    """How much of the depth is left at station u (-1..1): all of it along the middle, a quarter
    ellipse over the last stretch, so the plan is a D at each end."""
    a = abs(u)
    if a <= U0:
        return 1.0
    t = min(1.0, (a - U0) / (1 - U0))
    return S_MIN + (1 - S_MIN) * math.sqrt(max(0.0, 1 - t * t))


def pt(u, y, z, half=None, k=1.0):
    """A point of the body: station u, height y, `z` the front at full depth (BACK stays BACK)."""
    return Vector((u * k * (xe(y) if half is None else half), y, BACK + (z - BACK) * s(u)))


def fz(x, y, out=D):
    """The hull's outer face at x, y (the strakes' proud edge), plus `out`."""
    return BACK + (zf(y) + out - BACK) * s(x / xe(y))


# Cut by angle, not by distance, so each facet of the rounded end turns the same amount.
ENDS = [U0 + (1 - U0) * math.sin(PI / 2 * i / ROUND) for i in range(ROUND + 1)]
STATIONS = sorted({-u for u in ENDS} | set(ENDS) | {0.0})


def loft(label, rings, mat):
    """A closed solid through rings of points (one ring per station, same count each), capped
    at both ends by a fan round the ring's middle."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    for A, B in zip(vs, vs[1:]):
        for j in range(n):
            bm.faces.new((A[j], A[(j + 1) % n], B[(j + 1) % n], B[j]))
    for ring, pts in ((vs[0], rings[0]), (vs[-1], rings[-1])):
        c = bm.verts.new(sum(pts, Vector()) / n)
        for j in range(n):
            bm.faces.new((ring[j], ring[(j + 1) % n], c))
    emit(bm, mat, label)


def strip(label, pts, normals, side, w, t, mat, ch=0.0):
    """A batten lying on a surface: along `pts`, `w` wide across `side`, `t` thick along each
    point's outward normal, its two outer edges chamfered by `ch`. Closed. A normal is never let
    point more than a little down, or the foot of a batten on the tuck-in goes through the floor."""
    bm = bmesh.new()
    side = Vector(side).normalized()
    rings = []
    for p, nrm in zip(pts, normals):
        p, nrm = Vector(p), Vector(nrm)
        nrm.y = max(nrm.y, -.35 * nrm.length)
        nrm.normalize()
        a, b = p - side * w / 2, p + side * w / 2
        if ch:
            ring = (a, b, b + nrm * (t - ch), b - side * ch + nrm * t, a + side * ch + nrm * t, a + nrm * (t - ch))
        else:
            ring = (a, b, b + nrm * t, a + nrm * t)
        rings.append([bm.verts.new((v.x, max(v.y, 0.0), v.z)) for v in ring])
    n = len(rings[0])
    for A, B in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((A[j], A[(j + 1) % n], B[(j + 1) % n], B[j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, mat, label)


def rows(y0, y1):
    """Enough rows to follow the belly: over a port's height it stands a centimetre proud of a
    chord, and a plate on two rows had the next strake's lap run through its middle."""
    n = max(1, math.ceil((y1 - y0) / .03))
    return [y0 + (y1 - y0) * i / n for i in range(n + 1)]


def plate(label, x0, x1, y0, y1, o0, o1, mat, ch=0.0):
    """A plate following the hull's face over x0..x1, y0..y1, from `o0` to `o1` out of it, its
    front edges chamfered by `ch`."""
    ys = rows(y0, y1)
    pts = [(x, y, fz(x, y) + o0) for x in (x0, x1) for y in ys]
    if ch:
        pts += [(x, y, fz(x, y) + o1 - ch) for x in (x0, x1) for y in ys]
        inner = rows(y0 + ch, y1 - ch)
        pts += [(x, y, fz(x, y) + o1) for x in (x0 + ch, x1 - ch) for y in inner]
    else:
        pts += [(x, y, fz(x, y) + o1) for x in (x0, x1) for y in ys]
    hull(label, pts, mat)


def plaque(label, x0, x1, y0, y1, zfront, mat, ch=0.0):
    """A block with a flat, upright front at `zfront`, its back sunk into the hull's belly."""
    ys = rows(y0, y1)
    pts = [(x, y, fz(x, y) - .014) for x in (x0, x1) for y in ys]
    if ch:
        pts += [(x, y, zfront - ch) for x in (x0, x1) for y in (y0, y1)]
        pts += [(x, y, zfront) for x in (x0 + ch, x1 - ch) for y in (y0 + ch, y1 - ch)]
    else:
        pts += [(x, y, zfront) for x in (x0, x1) for y in (y0, y1)]
    hull(label, pts, mat)


def normal_at(x, y):
    e = .004
    dz = fz(x, y + e) - fz(x, y - e)
    return Vector((0, -dz, 2 * e)).normalized()


def trenail(p, nrm, r=.0055, mat=DARK):
    """A wooden peg's head, a flat disc turned to face along `nrm` (which lies in the yz plane)."""
    disc('trenail', p, r, .003, mat, sides=6, tilt=math.atan2(nrm.z, nrm.y))


def bevel_box(label, x0, x1, y0, y1, z0, z1, mat, bevel, seg=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((x1 - x0, y1 - y0, z1 - z0)), verts=bm.verts[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, offset_type='OFFSET', segments=seg,
                    profile=.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.translate(bm, vec=Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), verts=bm.verts[:])
    emit(bm, mat, label)


# ---- the hull ------------------------------------------------------------------------------------
def strake_section(k):
    """One plank's section at full depth, as (y, z): its lower edge lapped D proud, its upper edge
    nearly flush, both front edges bevelled in two steps, its back well inside the core."""
    y0, y1 = STRAKES[k], STRAKES[k + 1]
    a, b = y0 + (G if k else 0), y1 - G
    c = .006

    def zr(y):
        t = (y - a) / (b - a)
        return zf(y) + D * (1 - t) + .0015 * t

    pts = [(a, zr(a))] if k == 0 else [(a, zr(a) - c), (a + .3 * c, zr(a + .3 * c) - .3 * c)]
    lo = a if k == 0 else a + c
    pts += [(lo + (b - c - lo) * i / 5, zr(lo + (b - c - lo) * i / 5)) for i in range(6)][1 if k == 0 else 0:]
    pts += [(b - .3 * c, zr(b - .3 * c) - .3 * c), (b, zr(b) - c)]
    pts += [(b, zf(b) - .032), (a, zf(a) - .032)]
    return pts


def body():
    # The dark core, well behind the planks: what the seams show.
    core = [(y, zf(y) - .007) for y in (0, .02, .045, .07, .1, .13, .17, WALE0)]
    loft('counter core', [[pt(u, y, z, k=.997) for y, z in core] + [pt(u, WALE0, BACK, k=.997), pt(u, 0, BACK, k=.997)]
                          for u in STATIONS], TAR)
    for k in range(len(STRAKES) - 1):
        sec = strake_section(k)
        loft('counter strake', [[pt(u, y, z) for y, z in sec] for u in STATIONS], STRAKE_MATS[k])
    # The wale: a heavy rounded rubbing strake right under the slab, round the ends too.
    wale = [(WALE0 + .048 * i / 8, .122 + .022 * math.sin(PI * i / 8) ** .5) for i in range(9)]
    wale += [(WALE1, BACK), (WALE0, BACK)]
    loft('counter wale', [[pt(u, y, z, half=1.715) for y, z in wale] for u in STATIONS], DARK)
    # The stems: a dark post down each rounded end, following its curve, pegged at every strake.
    ys = [.004 + (WALE0 - .004) * i / 11 for i in range(12)]
    for sx in (-1, 1):
        pts, nrms = [], []
        for y in ys:
            e = .004
            dx = xe(min(y + e, WALE0)) - xe(max(y - e, 0))
            pts.append((sx * (xe(y) - .004), y, BACK + .026))
            nrms.append(Vector((sx * 2 * e, -dx, 0)))
        strip('counter stem', pts, nrms, (0, 0, 1), .05, .016, DARK, ch=.004)
        for k in range(len(STRAKES) - 1):
            y = (STRAKES[k] + STRAKES[k + 1]) / 2
            x = sx * (xe(y) + .012)
            disc('trenail', (x, y, BACK + .026), .0055, .003, DARK, sides=6, roll=-sx * PI / 2)


RIBS = (-1.33, -.82, -.29, .29, .82, 1.33)
PORTS = (-1.075, -.555, .555, 1.075)


def frames():
    ys = [.01 + (WALE0 - .01) * i / 8 for i in range(9)]
    for x in RIBS:
        base = [Vector((x, y, fz(x, y) - .006)) for y in ys]
        nrms = [normal_at(x, y) for y in ys]
        strip('counter rib', base, nrms, (1, 0, 0), .042, .016, DARK, ch=.005)
        for k in range(len(STRAKES) - 1):
            y = (STRAKES[k] + STRAKES[k + 1]) / 2 + .004
            n = normal_at(x, y)
            trenail(Vector((x, y, fz(x, y) - .006)) + n * .016, n, mat=CARVED)
    for x in (-.15, .15):
        base = [Vector((x, y, fz(x, y) - .004)) for y in ys]
        nrms = [normal_at(x, y) for y in ys]
        strip('counter brass strip', base, nrms, (1, 0, 0), .013, .012, GOLD, ch=.003)
        for y in (.03, .09, .15, .21):
            n = normal_at(x, y)
            ball('brass rivet', Vector((x, y, fz(x, y) - .004)) + n * .012, .0032, GOLD, seg=6, rings=3)


def gun_port(cx):
    """A closed port sized to the hull's height: a bevelled frame, a lid of four dark planks on
    black, two raised iron strap hinges with rivets hung on knuckles at the top, a ring to pull."""
    w, y0, y1, b = .069, .088, .226, .02
    for x0, x1, ya, yb in ((cx - w, cx + w, y1 - b, y1), (cx - w, cx + w, y0, y0 + b),
                           (cx - w, cx - w + b, y0 + b, y1 - b), (cx + w - b, cx + w, y0 + b, y1 - b)):
        plate('port frame', x0, x1, ya, yb, -.012, .012, CARVED, ch=.004)
    li, la, lb = w - b, y0 + b, y1 - b
    plate('port backing', cx - li - .002, cx + li + .002, la - .002, lb + .002, -.012, .002, BLACK)
    pitch = 2 * li / 4
    for i in range(4):
        x0 = cx - li + i * pitch
        plate('port lid', x0 + .0008, x0 + pitch - .0008, la + .001, lb - .001, -.004, .007, LID)
    for hx in (cx - .028, cx + .028):
        ya, yb = la + .026, lb - .003
        plate('port strap', hx - .008, hx + .008, ya, yb, .004, .0105, STRAP, ch=.0015)
        hull('port strap tip', [(hx + dx, y, fz(hx, y) + o) for dx, y in ((-.008, ya + .001), (.008, ya + .001), (0, ya - .014))
                                for o in (.004, .0095)], STRAP)
        for y in (ya + .006, yb - .014):
            ball('port rivet', (hx, y, fz(hx, y) + .0105), .0026, STRAP, seg=5, rings=3)
        z = fz(hx, lb) + .0095
        rod('port knuckle', (hx - .013, lb, z), (hx + .013, lb, z), .0048, STRAP, sides=8)
        plate('port pintle', hx - .007, hx + .007, lb + .003, lb + .015, .008, .015, STRAP, ch=.002)
    yr = la + .02
    plate('port staple', cx - .005, cx + .005, yr, yr + .01, .006, .0105, STRAP)
    torus('port ring', (cx, yr - .002, fz(cx, yr) + .0105), .011, .0022, STRAP, seg=12, sides=4, tilt=PI / 2)


def wheel_panel():
    """The middle: a carved relief - an upright block with a moulded dark frame, a carved bead and a
    sunk field - and a ship's wheel filling it: rim, inner ring, eight spokes, turned handles and
    a turned hub."""
    w, y0, y1, b = .1, .046, .228, .022
    ZF, ZB, ZI = .143, .139, .136          # the frame's face, the bead's, the field's
    plaque('panel field', -w + b - .002, w - b + .002, y0 + b - .002, y1 - b + .002, ZI, PANEL)
    for x0, x1, ya, yb in ((-w, w, y1 - b, y1), (-w, w, y0, y0 + b), (-w, -w + b, y0 + b, y1 - b), (w - b, w, y0 + b, y1 - b)):
        plaque('panel frame', x0, x1, ya, yb, ZF, DARK, ch=.005)
    i, t = w - b, .007
    for x0, x1, ya, yb in ((-i, i, y1 - b - t, y1 - b), (-i, i, y0 + b, y0 + b + t),
                           (-i, -i + t, y0 + b + t, y1 - b - t), (i - t, i, y0 + b + t, y1 - b - t)):
        plaque('panel bead', x0, x1, ya, yb, ZB, CARVED, ch=.0025)
    for x in (-w + b / 2, w - b / 2):
        for y in (y0 + b / 2, y1 - b / 2):
            lathe('panel rosette', [(0, 0), (.008, 0), (.007, .002), (.004, .0035), (0, .004)], GOLD,
                  at=(x, y, ZF - .001), sides=8, tilt=PI / 2)
    cy = (y0 + y1) / 2
    R = .05
    with frame(M((0, cy, ZI + .0062))):
        torus('wheel rim', (0, 0, 0), R, .0055, GOLD, seg=24, sides=6, tilt=PI / 2)
        torus('wheel ring', (0, 0, 0), .02, .003, GOLD, seg=16, sides=4, tilt=PI / 2)
        lathe('wheel hub', [(0, -.005), (.012, -.005), (.013, -.001), (.011, .002), (.007, .004), (.003, .0055), (0, .0058)],
              GOLD, sides=12, tilt=PI / 2)
        for k in range(8):
            a = TAU * k / 8 + PI / 8
            d = Vector((math.cos(a), math.sin(a), 0))
            rod('wheel spoke', d * .01, d * (R + .002), .0028, GOLD, sides=6)
            lathe('wheel handle', [(.0032, 0), (.0045, .003), (.0052, .007), (.0038, .012), (.0046, .0155), (.003, .0185), (0, .019)],
                  GOLD, at=d * (R + .003), sides=6, roll=a - PI / 2)


def rail():
    """The brass foot rail: a tube on six turned brackets, each a post to the floor and an arm
    back to the hull, with a sleeve round the rail and knobs on its ends."""
    y, z = .08, .185
    tube('rail', [(-1.6, y, z), (1.6, y, z)], .011, BRASS, sides=16)
    for sx in (-1, 1):
        lathe('rail cap', [(0, 0), (.011, 0), (.014, .004), (.016, .01), (.014, .017), (.009, .021), (0, .023)],
              BRASS, at=(sx * 1.598, y, z), sides=12, roll=-sx * PI / 2)
    post = [(0, 0), (.018, 0), (.018, .004), (.012, .007), (.008, .011), (.0065, .017), (.0065, .056),
            (.0085, .06), (.0085, .065), (0, .07)]
    for x in (-1.5, -1.12, -.555, .555, 1.12, 1.5):
        lathe('rail post', post, BRASS, at=(x, 0, z), sides=8)
        back = fz(x, y) - .004
        L = z - back
        arm = [(0, 0), (.015, 0), (.015, .003), (.009, .006), (.0058, .011), (.0055, L - .016),
               (.0075, L - .011), (.0075, L - .006), (0, L)]
        lathe('rail arm', arm, BRASS, at=(x, y, back), sides=8, tilt=PI / 2)
        lathe('rail sleeve', [(0, 0), (.0125, 0), (.0145, .004), (.0145, .012), (.0125, .016), (0, .016)],
              BRASS, at=(x - .008, y, z), sides=10, roll=-PI / 2)


def back_side():
    """The barkeeper's side: three plain boards with gaps and two shelves under the slab."""
    for y0, y1 in ((.006, .078), (.082, .154), (.158, WALE0 - .002)):
        span('counter back', -1.36, 1.36, y0, y1, BACK - .006, BACK + .003, BARW, bevel=.002)
    for y in (.04, .135):
        bevel_box('counter shelf', -1.3, 1.3, y, y + .012, -.162, BACK, OAK, .003)
        for x in (-1.2, -.42, .42, 1.2):
            span('shelf bracket', x - .01, x + .01, y - .03, y, -.158, BACK, DARK, bevel=.002)


def top():
    """The oak slab: a thick board with a two-step rounded edge over a narrower moulding under it,
    so its edge reads as moulded rather than sawn."""
    bevel_box('counter top', -1.74, 1.74, TOP_Y - .017, TOP_Y, -.17, .17, OAK, .007)
    bevel_box('counter top moulding', -1.73, 1.73, TOP_Y - .03, TOP_Y - .013, -.16, .16, OAK, .006)


def build():
    body()
    frames()
    for cx in PORTS:
        gun_port(cx)
    wheel_panel()
    rail()
    back_side()
    top()
