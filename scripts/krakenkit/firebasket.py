"""The hearth's fill: a wrought-iron fire basket on four posts with brass knobs, three charred oak
logs laid across it, and under it a bed of ash with chips, kindling, charcoal and embers (the keeper's
pick of the FLUX sheets, refs/krakenkit/objecten/haard/haardvulling-flux-15-4palen-messing.png, with
the wood a shade darker). The flame is not here: web/js/hearth-fire.js draws it over these logs, so
what glows here is only the cracks in the char and the coals, never a flame.

Fixed by the room (scripts/krakenroom/shell.py hearth(), kraken-layout.js HEARTH_FIRE): it stands
in the firebox turned with its front to the hall (+z here is the room's +x), which is 1.0 deep and
0.84 across, and under the hood's front edge at 0.66 - so it reaches 0.25 either side of its middle
and 0.2 to the front and back, and its knobs are the highest thing at 0.24.

There is one of it, so the triangles go to the logs (the kit's pieces may take 40000; this is a few
thousand): nine sides and eight rings each, every corner pushed in or out on its own so the char
reads as broken, and the glowing cracks of a log are one part, the glowing coals another - a glowing
part is a halo in room-glow.js, and forty of them on one hearth was a lamp, not a fire. Not one part
for all of it: then it is a glowing face 0.3 across, and nothing indoors glows broader than a hand
at full strength (tests/pirate-tavern-room.test.mjs); each log's cracks and the coals under them are
each under that. The iron stays coarse: five-
and six-sided bars and four-sided scrolls, black against a black firebox."""
import math
import bmesh
from mathutils import Vector
from geom import TAU, PI, IRON, BRASS, M, emit, merge, rng, rod, ball, disc, tube, lathe, hull, material

ASSET = 'civic_kraken_firebasket'

# Charred oak, darker than the reference: the keeper asked for it, and the hearth's lamp lights
# these from a hand away, so anything paler read as grey firewood.
CHAR = material('plain:char', 0x17110d)
SCORCH = material('plain:char-brown', 0x3a2517)
LOGEND = material('plain:log-end', 0x4a2d1a)
ASH = material('plain:ash', 0x9a958f)
CHIP = material('plain:chip', 0x8a6a46)
COAL = material('plain:coal', 0x201a17)
EMBER = material('plain:ember', 0xe8501c, glow=True)

W, D = .2, .13              # the posts' half spacing across and front to back
POST_TOP = .2               # where a post ends; its knob sits on it
RAIL = .085                 # the upper rails, which hold the logs in
GRATE = .036                # the bars the logs lie on
BAR_R = .0075


def post(x, z):
    rod('firebasket post', (x, 0, z), (x, POST_TOP, z), .0085, IRON, sides=6)
    disc('firebasket collar', (x, POST_TOP - .03, z), .013, .008, IRON, sides=6)
    disc('firebasket collar', (x, POST_TOP - .002, z), .012, .006, IRON, sides=6)
    ball('firebasket knob', (x, POST_TOP + .017, z), .017, BRASS, seg=8, rings=5)


def scroll(x, z, out):
    """A foot curled outward along `out` (a unit vector in the ground plane): down from the post to
    the floor and rolled up into a curl, like a smith's scroll."""
    o = Vector((out[0], 0, out[1]))
    up = Vector((0, 1, 0))
    base = Vector((x, 0, z))
    c, r0 = .032, .02
    pts = [base + up * .045, base + up * .02 + o * .006]
    for k in range(7):
        a = -PI / 2 + TAU * .85 * k / 6                     # from the floor, outward, up and back in
        r = r0 * (1 - .55 * k / 6)
        pts.append(base + o * (c + r * math.cos(a)) + up * (r0 + r * math.sin(a) + .004))
    tube('firebasket scroll', [tuple(p) for p in pts], .0055, IRON, sides=4)


def basket():
    for sx in (-1, 1):
        for sz in (-1, 1):
            post(sx * W, sz * D)
            scroll(sx * W, sz * D, (sx * .71, sz * .71))
    # The front rail bows out towards the room; the back and the sides are straight.
    for y in (RAIL, GRATE):
        bow = .028 if y == RAIL else .012
        tube('firebasket rail', [(W * t, y, D + bow * (1 - t * t)) for t in (-1, -.6, -.2, .2, .6, 1)],
             BAR_R, IRON, sides=5)
        rod('firebasket rail', (-W, y, -D), (W, y, -D), BAR_R, IRON, sides=5)
        for sx in (-1, 1):
            rod('firebasket rail', (sx * W, y, -D), (sx * W, y, D), BAR_R, IRON, sides=5)
    # The grate the logs lie on, front to back.
    for k in range(5):
        x = -W + 2 * W * (k + 1) / 6
        rod('firebasket grate', (x, GRATE, -D), (x, GRATE, D + .01), BAR_R * .9, IRON, sides=5)
    # Two little S-brackets between the front rails, as in the smith's basket.
    for sx in (-1, 1):
        x = sx * .085
        tube('firebasket bracket', [(x, GRATE + .006, D + .014), (x + sx * .012, .052, D + .02),
                                    (x, .066, D + .024), (x - sx * .012, .078, D + .026)], .0045, IRON, sides=4)


def log(a, b, r, seed):
    """A charred log from a to b: seven sides, each ring jittered and a little wobbled, a paler end
    grain at both ends, a few scorched brown patches where the bark is not yet char, and thin glowing
    cracks on its lower half (one part for all of them)."""
    g = rng(seed)
    cracks = bmesh.new()
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    u = t.cross(Vector((0, 1, 0))).normalized()
    w = t.cross(u)                  # points down-ish: the underside, where the coals are
    if w.y > 0:
        w = -w
    sides, n = 9, 8
    bm = bmesh.new()
    rings = []
    for i in range(n):
        c = a.lerp(b, i / (n - 1)) + u * g.uniform(-.004, .004)
        rr = r * (1 + .08 * math.sin(i * 1.9 + seed))
        rings.append([bm.verts.new(c + (u * math.cos(TAU * k / sides) + w * math.sin(TAU * k / sides))
                                   * rr * g.uniform(.8, 1.1)) for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, CHAR, 'firebasket log')
    # The end grain, set just proud of each cut, smaller than the log so the char rims it.
    for end, d in ((a, -t), (b, t)):
        at = end + d * .0015
        m = M(tuple(at)) @ (Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4())
        eb = bmesh.new()
        bmesh.ops.create_cone(eb, cap_ends=True, cap_tris=False, segments=9, radius1=r * .7, radius2=r * .7, depth=.003)
        eb.transform(m @ M(scale=(1, 1, 1)) @ _upright())
        emit(eb, LOGEND, 'firebasket log end')
    # Scorched patches on the top, where the fire has not reached through the bark yet.
    for _ in range(3):
        s = g.uniform(.2, .8)
        c = a.lerp(b, s)
        k = g.uniform(PI * .15, PI * .85)                 # round the top half
        n_ = -(u * math.cos(k) + w * math.sin(k))
        side = t.cross(n_).normalized()
        pts = [c + n_ * r * .99 + t * dt + side * ds
               for dt, ds in ((-.02, 0), (0, .012), (.022, 0), (0, -.011), (-.01, .008))]
        pts += [c + n_ * r * 1.02]
        hull('firebasket scorch', [tuple(p) for p in pts], SCORCH)
    # Glowing cracks: hairline slivers along and across the lower half, just breaking the surface.
    for _ in range(22):
        s = g.uniform(.1, .9)
        k = g.uniform(-.2, 1.2) * PI                     # the lower half and the flanks
        n_ = u * math.cos(k) + w * math.sin(k)
        if n_.y > .45:
            continue
        along = t if g.random() < .7 else t.cross(n_).normalized()
        c = a.lerp(b, s) + n_ * r * .93
        L_ = g.uniform(.006, .016)
        side = along.cross(n_).normalized()
        cb = bmesh.new()
        corners = [c + along * dl * L_ + side * dw * .0014 + n_ * dn * .0028
                   for dl in (-1, 1) for dw in (-1, 1) for dn in (-1, 1)]
        vs = [cb.verts.new(p) for p in corners]
        bmesh.ops.convex_hull(cb, input=vs)
        merge(cracks, cb)
        cb.free()
    emit(cracks, EMBER, 'firebasket cracks')


def _upright():
    """create_cone builds along z; the kit's frame stands things along y."""
    return M(tilt=-PI / 2)


def bed():
    """The ash under the basket, the chips and kindling round it, charcoal and embers in it."""
    g = rng(71)
    glowing = bmesh.new()
    lathe('firebasket ash', [(.29, 0), (.25, .008), (.17, .016), (.07, .021), (0, .022)], ASH,
          sides=10, scale=(1, 1, .82))
    # Charcoal: lumps on the grate and fallen through it onto the ash, the ones under the logs still
    # glowing - a scatter of coals, not a plate of fire (a single glowing patch read as an orange floor).
    for i in range(30):
        x, z = g.uniform(-.18, .18), g.uniform(-.11, .15)
        y = GRATE + .006 if g.random() < .35 else .019
        s = g.uniform(.007, .014)
        pts = [(x + s * g.uniform(-1, 1), y + s * g.uniform(0, 1.2), z + s * g.uniform(-1, 1)) for _ in range(7)]
        if abs(x) < .12 and abs(z) < .08 and i % 2 == 0:
            cb = bmesh.new()
            bmesh.ops.convex_hull(cb, input=[cb.verts.new(p) for p in pts])
            merge(glowing, cb)
            cb.free()
        else:
            hull('firebasket coal', pts, COAL)
    # Chopped wood chips and a few split kindling sticks, lying on the ash out to its rim.
    for i in range(18):
        a = g.uniform(0, TAU)
        rr = g.uniform(.1, .27)
        x, z = rr * math.cos(a), rr * .82 * math.sin(a)
        if abs(x) < W - .02 and abs(z) < D - .02:
            z = math.copysign(D + .03, z)                 # not hidden under the grate
        l, h = g.uniform(.014, .032), g.uniform(.005, .009)
        cb = bmesh.new()
        bmesh.ops.create_cube(cb, size=1.0)
        bmesh.ops.scale(cb, vec=Vector((l, h, l * .5)), verts=cb.verts[:])
        cb.transform(M((x, .012 + h / 2, z), turn=g.uniform(0, PI), roll=g.uniform(-.25, .25)))
        emit(cb, CHIP, 'firebasket chip')
    for i in range(3):
        a = g.uniform(-.5, .5) + (PI if i == 1 else 0)
        x0, z0 = .12 * math.cos(a), .19 * math.sin(a) + .05
        rod('firebasket kindling', (x0, .014, z0), (x0 + .06 * math.sin(a + i), .02, z0 + .03), .0045, CHAR, sides=4)
    emit(glowing, EMBER, 'firebasket embers')


def build():
    basket()
    r = .043
    y0 = GRATE + BAR_R + r * .9                           # a lower log lying on the grate
    # Two logs from the front corners in towards the back, and one across them on top - as in the
    # reference, a loose crisscross rather than a stack.
    log((-.17, y0, .1), (.02, y0 + .004, -.12), r, 3)
    log((.17, y0, .085), (-.01, y0 + .006, -.12), r * .95, 5)
    log((-.175, y0 + .065, -.03), (.17, y0 + .075, .05), r * 1.05, 7)
    bed()
