"""The mermaid figurehead on the Salty Kraken's wall: a ship's carving taken off some bow and
bolted to the hall, leaning out of the wall the way she leaned out over the sea.

A shield-shaped plank board lies flat on the wall (its back is z = 0), a dark beam bound in iron
comes out of it into her hips, and a flat iron bar holds her tail lower down. She leans out and
up, back arched, chest forward, head raised; her arms are swept back along her sides and her hair
streams back towards the wall in thick ribbons. Below the hips the body turns into a fish tail that
runs down in front of the board and curls into a spiral, its plane turned a little so the curl
reads from the front as well as the side, and a forked fin sweeps out to her left (-x).

Everything is faceted hulls and tubes; the tail and the hair are elliptic tubes of our own
(`etube`) rather than geom.tube, because geom.tube swaps its reference axis when a path turns
vertical and the tail's curl would twist a quarter turn where it passes straight down. Gold runs
along the tail and the hair as thin strips laid exactly on the tubes' corners.

Frame: the wall is z = 0 and nothing lies behind it; y = 0 is the bottom of the curl (the whole
figure is lifted by whatever the curl's lowest corner comes to); x = 0 is the board's middle."""
import math
import bmesh
from mathutils import Matrix, Vector
from geom import (TAU, PI, DARK, IRON, GOLD, GOLDHI, HULLW, BLACK, M, frame, box, span, disc, hull,
                  emit, material)

ASSET = 'civic_kraken_figurehead'

BODY = material('plain:figure', 0x7a5236)       # her skin: the lighter carved oak
TAIL = material('plain:figtail', 0x3f2c1d)      # the tail, darker, as the drawing has it
FIN = material('plain:figfin', 0x4a3322)
HAIR = material('plain:fighair', 0x4f3421)
BOARD = HULLW

CURL_AT = (.19, .085)       # (z, y) of the spiral's middle
CURL_R = .078               # the spiral's outer radius where the tail enters it
CURL_TURN = .7              # the curl's plane turned about y, so its outer side comes round to +x
WALL_Z = .112               # where the tail passes nearest the board: the curl's axis of turning


# ---- our own tube: an elliptic section with a lateral axis that never flips -----------------
def frames_of(pts, refs=None):
    """Tangent, lateral (u) and normal (w) at each point of a path. u is the reference direction
    (+x unless given per point) with the tangent taken out of it, so a path in the z-y plane has
    u = +x all the way round, and w = t x u points to the inside of every bend of it."""
    n = len(pts)
    out = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        ref = refs[i] if refs else Vector((1, 0, 0))
        u = ref - t * ref.dot(t)
        if u.length < 1e-5:
            u = Vector((0, 0, 1)) - t * t.z
        u.normalize()
        out.append((t, u, t.cross(u)))
    return out


def etube(label, pts, rx, rw, mat, sides=6, refs=None, phase=0.0):
    """A closed tube along `pts`, its section an ellipse rx wide (along u) and rw deep (along w);
    rx and rw are one number or one per point. Returns the frames, for laying strips on it."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rx = rx if isinstance(rx, (list, tuple)) else [rx] * n
    rw = rw if isinstance(rw, (list, tuple)) else [rw] * n
    fr = frames_of(pts, refs)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        _, u, w = fr[i]
        rings.append([bm.verts.new(p + u * max(rx[i], 1e-4) * math.cos(phase + TAU * k / sides)
                                   + w * max(rw[i], 1e-4) * math.sin(phase + TAU * k / sides))
                      for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, mat, label)
    return fr


def strip(label, pts, fr, rx, rw, k, sides, i0, i1, r, mat=GOLD, sink=.35):
    """A thin gold strip along corner k of an etube, from point i0 to i1, fattest in the middle
    and sharp at both ends: the streaks of the drawing."""
    a = TAU * k / sides
    path, radii = [], []
    for i in range(i0, i1 + 1):
        _, u, w = fr[i]
        p = Vector(pts[i]) + u * rx[i] * math.cos(a) + w * rw[i] * math.sin(a)
        nrm = (u * math.cos(a) + w * math.sin(a)).normalized()
        path.append(p - nrm * r * sink)
        s = (i - i0) / max(i1 - i0, 1)
        radii.append(r * max(.15, math.sin(PI * s)))
    geo_tube(label, path, radii, mat, 3)


def geo_tube(label, pts, radii, mat, sides):
    etube(label, pts, radii, radii, mat, sides=sides)


def limb(label, a, b, ra, rb, mat, n=5, flat=1.0):
    """A tapered faceted prism from a to b: the hull of two rings of n corners."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    ref = Vector((1, 0, 0)) if abs(t.x) < .8 else Vector((0, 1, 0))
    u = (ref - t * ref.dot(t)).normalized()
    w = t.cross(u)
    pts = []
    for c, r in ((a, ra), (b, rb)):
        for k in range(n):
            q = TAU * k / n + .3
            pts.append(tuple(c + u * r * math.cos(q) + w * r * flat * math.sin(q)))
    hull(label, pts, mat)


def ring_pts(y, rx, zf, zb, x0=0.0, n=8):
    """A section of a torso at height y (local): rx half-wide, zf in front, zb behind."""
    out = []
    for k in range(n):
        q = TAU * k / n
        c, s = math.cos(q), math.sin(q)
        out.append((x0 + rx * c, y, (zf if s > 0 else zb) * s))
    return out


def ellipsoid(c, r, n=8, rings=(-.6, 0, .6), poles=True, keep=None):
    """Points on an ellipsoid round c: `rings` are sines of latitude."""
    cx, cy, cz = c
    rx, ry, rz = r
    out = []
    for j, sl in enumerate(rings):
        cl = math.sqrt(1 - sl * sl)
        for k in range(n):
            q = TAU * k / n + j * PI / n
            out.append((cx + rx * cl * math.cos(q), cy + ry * sl, cz + rz * cl * math.sin(q)))
    if poles:
        out += [(cx, cy + ry, cz), (cx, cy - ry, cz)]
    return [p for p in out if keep is None or keep(p)]


# ---- the tail ---------------------------------------------------------------------------------
def tail_path():
    """The tail's spine and its radius: out of the hips, down in front of the board, into the curl."""
    pts = [(0, .300, .190), (0, .265, .165), (0, .225, .140), (0, .180, .122), (0, .130, .112)]
    rad = [.044, .042, .039, .035, .032]
    refs = [Vector((1, 0, 0))] * len(pts)
    zc, yc = CURL_AT
    turn = Matrix.Rotation(CURL_TURN, 3, 'Y')
    n = 14
    for k in range(n + 1):
        th = PI + k * PI / 6
        R = CURL_R * (1 - .6 * k / n)
        dz = zc + R * math.cos(th) - WALL_Z
        p = turn @ Vector((0, yc + R * math.sin(th), dz))
        pts.append((p.x, p.y, WALL_Z + p.z))
        rad.append(.030 - .024 * k / n if k < n else .0025)
        refs.append(turn @ Vector((1, 0, 0)))
    return pts, rad, refs


def build_tail(pts, rad, refs):
    rx = [r * 1.15 for r in rad]
    rw = [r * .95 for r in rad]
    S = 8
    fr = etube('figurehead tail', pts, rx, rw, TAIL, sides=S, refs=refs)
    # Flames of gold up the tail. Corner 2 is +w (the front on the way down, the inside of the
    # curl), 0 is her right, 4 her left (the side the side view sees).
    for k, i0, i1, r in ((1, 1, 8, .0045), (3, 2, 9, .0045), (2, 0, 6, .004), (4, 4, 13, .005),
                         (5, 7, 15, .004), (0, 6, 14, .0045), (3, 11, 18, .0035), (6, 3, 10, .004)):
        strip('figurehead tail gold', pts, fr, rx, rw, k, S, i0, i1, r, GOLD if k % 2 else GOLDHI)
    return fr


FIN_ROOT = (-.028, .2)


def build_fin():
    """A forked fin fanning out to her left, in front of the board and swept back a little: a fan
    of rays, each a thin tapering blade, so its edge comes out ragged like the carving's and the
    two outer rays, the longest, make the fork."""
    zf = lambda x: .122 + .22 * (x - FIN_ROOT[0])
    rx0, ry0 = FIN_ROOT
    rays = ((2.42, .19, .03), (2.75, .15, .032), (3.05, .13, .03), (3.33, .155, .03), (3.6, .18, .028))
    # The web between the rays, so the fin is one broad blade and only its edge is ragged.
    web = [(rx0, ry0 + .018), (rx0, ry0 - .018)]
    for a, length, _ in rays:
        web.append((rx0 + math.cos(a) * length * .62, ry0 + math.sin(a) * length * .62))
    hull('figurehead fin', [(x, y, zf(x) + sz * .003) for x, y in web for sz in (-1, 1)], FIN)
    for n, (a, length, wide) in enumerate(rays):
        d = Vector((math.cos(a), math.sin(a)))
        side = Vector((-d.y, d.x))
        pts = []
        for s, half, t in ((0, wide * .5, .014), (.6, wide, .008), (1, .004, .003)):
            c = Vector((rx0, ry0)) + d * length * s
            for sgn in (-1, 1):
                q = c + side * half * sgn
                pts += [(q.x, q.y, zf(q.x) + t / 2), (q.x, q.y, zf(q.x) - t / 2)]
        hull('figurehead fin', pts, FIN)
        if n % 2 == 0:
            path = []
            for s in (.08, .5, .9):
                c = Vector((rx0, ry0)) + d * length * s
                path.append(Vector((c.x, c.y, zf(c.x) + (.014 - .011 * s) / 2)))
            geo_tube('figurehead fin gold', path, [.0035, .003, .001], GOLD, 3)


# ---- the body ---------------------------------------------------------------------------------
def build_body():
    hips = M((0, .27, .18), tilt=.85)
    waist = hips @ Matrix.Translation((0, .06, 0))
    chest = Matrix.Translation(waist.to_translation()) @ Matrix.Rotation(.8, 4, 'X')
    head = Matrix.Translation(chest @ Vector((0, .118, .006))) @ Matrix.Rotation(-.42, 4, 'X')

    with frame(hips):
        # The hips are already tail: dark, and the border with the skin is a zigzag of gold.
        hull('figurehead hips', ring_pts(-.02, .036, .026, .026) + ring_pts(.02, .044, .031, .028)
             + ring_pts(.062, .034, .025, .024), TAIL)
        zig = []
        for k in range(11):
            q = -1.9 + 3.8 * k / 10
            y = .05 + (.011 if k % 2 else -.004)
            rx, rz = .0385, .0275
            zig.append((rx * math.sin(q) * 1.04, y, rz * math.cos(q) * 1.04))
        geo_tube('figurehead waist gold', zig, .003, GOLDHI, 3)
    with frame(chest):
        hull('figurehead waist', ring_pts(-.008, .031, .025, .025) + ring_pts(.035, .036, .029, .026), BODY)
        hull('figurehead chest', ring_pts(.03, .036, .029, .026) + ring_pts(.07, .046, .033, .029)
             + ring_pts(.092, .051, .024, .026) + ring_pts(.104, .03, .016, .018, n=6), BODY)
        for sx in (-1, 1):
            hull('figurehead breast', ellipsoid((sx * .019, .06, .028), (.016, .016, .015), n=6,
                                                 rings=(-.5, .3), poles=False) + [(sx * .02, .057, .047)], BODY)
        # The neck, from between the shoulders up into the jaw.
        limb('figurehead neck', (0, .085, -.002), (0, .128, .006), .015, .012, BODY, n=6)
        shoulders = [chest @ Vector((sx * .05, .086, -.006)) for sx in (-1, 1)]
    for sx, S in zip((-1, 1), shoulders):
        E = S + Vector((sx * .024, -.035, -.072))
        H = E + Vector((sx * .004, -.036, -.066))
        limb('figurehead upper arm', S, E, .013, .011, BODY)
        limb('figurehead forearm', E, H, .0105, .008, BODY)
        limb('figurehead hand', H, H + Vector((-sx * .004, -.012, -.028)), .011, .006, BODY, n=4, flat=.5)
    with frame(head):
        # A head a seventh of her: skull and face in one hull, so the nose is a ridge, the brow a
        # shelf and the chin a point, which is all a carving this size can say.
        face = [(-.006, .0, .02), (.006, .0, .02), (-.013, .005, .014), (.013, .005, .014), (-.021, .017, -.002), (.021, .017, -.002),
                (-.023, .031, .014), (.023, .031, .014), (-.017, .05, .024), (.017, .05, .024),
                (0, .03, .04), (0, .023, .033), (0, .047, .031), (0, .066, .021)]
        hull('figurehead head', ellipsoid((0, .042, -.006), (.025, .031, .028), n=8, rings=(-.5, .1, .6)) + face, BODY)
        # Her hair: a cap over the back of the skull, framing the face.
        cap = ellipsoid((0, .044, -.008), (.029, .034, .032), n=10, rings=(-.55, 0, .45, .8),
                        keep=lambda p: p[2] < .006)
        cap += [(0, .066, .021), (-.013, .062, .02), (.013, .062, .02), (-.022, .056, .014), (.022, .056, .014),
                (-.028, .04, .008), (.028, .04, .008)]
        hull('figurehead hair cap', cap, HAIR)
    return head


def build_hair(head):
    """Thick ribbons from the back of her head, streaming back towards the wall and falling."""
    R = [.015, .019, .018, .015, .01, .004]
    # One wind-blown curve (dy, dz) the long strands share: back, sagging, the end flicked up.
    wave = [(-.004, -.045), (-.02, -.09), (-.042, -.13), (-.056, -.168), (-.05, -.198)]
    strands = []
    for root, drop, length, spread, gold in (((0, .068, -.014), .75, 1.0, 0, True),
                                             ((-.017, .06, -.018), .9, .96, -.02, True),
                                             ((.017, .06, -.018), .9, .96, .02, False),
                                             ((-.024, .04, -.02), 1.08, .9, -.032, False),
                                             ((.024, .04, -.02), 1.08, .9, .032, True),
                                             ((0, .03, -.027), 1.2, .82, 0, False)):
        offs = [(spread * (i + 1) / len(wave), dy * drop, dz * length) for i, (dy, dz) in enumerate(wave)]
        strands.append((root, offs, gold))
    # And a lock either side of the face, falling over the shoulders.
    for sx in (-1, 1):
        strands.append(((sx * .026, .04, -.008), [(sx * .01, -.024, -.022), (sx * .018, -.045, -.055),
                                                 (sx * .023, -.06, -.095), (sx * .025, -.07, -.135),
                                                 (sx * .023, -.068, -.162)], sx > 0))
    for root, offs, gold in strands:
        r0 = head @ Vector(root)
        pts = [r0] + [r0 + Vector(o) for o in offs]
        rx = [r * 1.1 for r in R]
        rw = [r * 1.25 for r in R]
        fr = etube('figurehead hair', pts, rx, rw, HAIR, sides=5)
        if gold:
            # The strip goes on whichever corner of the ribbon faces most upward.
            k = max(range(5), key=lambda k: (fr[2][1] * math.cos(TAU * k / 5) + fr[2][2] * math.sin(TAU * k / 5)).y)
            strip('figurehead hair gold', pts, fr, rx, rw, k, 5, 1, 5, .004, GOLD)


# ---- the board and the ironwork ---------------------------------------------------------------
def build_mount():
    cy, h, w = .21, .15, .1
    outline = [(-w, h - .025), (-w + .025, h), (w - .025, h), (w, h - .025),
               (w, -h + .03), (w - .03, -h), (-w + .03, -h), (-w, -h + .03)]
    from geom import prism
    prism('figurehead board', [(x, y + cy) for x, y in outline], .026, BOARD, Matrix.Translation((0, 0, .013)))
    for x in (-.034, .034):
        span('figurehead board seam', x - .0025, x + .0025, cy - h + .004, cy + h - .004, .025, .0275, DARK)
    for x, y in ((-.075, cy + h - .03), (.075, cy + h - .03), (-.075, cy - h + .035), (.075, cy - h + .035)):
        disc('figurehead bolt', (x, y, .025), .009, .007, IRON, sides=6, tilt=PI / 2)
    # The beam into her hips, in a plate on the board, with two bands.
    span('figurehead beam', -.024, .024, .236, .284, .02, .165, DARK, bevel=.004)
    span('figurehead plate', -.038, .038, .218, .302, .025, .031, IRON)
    for x, y in ((-.03, .226), (.03, .226), (-.03, .294), (.03, .294)):
        disc('figurehead rivet', (x, y, .03), .005, .004, IRON, sides=4, tilt=PI / 2)
    for z in (.062, .12):
        span('figurehead band', -.028, .028, .232, .288, z, z + .012, IRON)
    # A flat bar lower down, round the tail where it passes the board.
    span('figurehead bar', -.013, .013, .157, .173, .025, .095, IRON)
    band = []
    for y in (.158, .172):
        for k in range(8):
            q = TAU * k / 8
            band.append((.043 * math.cos(q), y, .119 + .036 * math.sin(q)))
    hull('figurehead tail band', band, IRON)


def build():
    pts, rad, refs = tail_path()
    # Lift everything so the curl's lowest corner stands on y = 0.
    fr = frames_of([Vector(p) for p in pts], refs)
    low = min(Vector(p).y + (u * r * 1.15 * math.cos(TAU * k / 8) + w * r * .95 * math.sin(TAU * k / 8)).y
              for p, r, (_, u, w) in zip(pts, rad, fr) for k in range(8))
    # (+.001: the gold strip along the curl's underside stands that much proud of the corner.)
    with frame(M((0, -low + .001, 0))):
        build_mount()
        build_tail(pts, rad, refs)
        build_fin()
        head = build_body()
        build_hair(head)
