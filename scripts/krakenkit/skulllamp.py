"""The hanging skull lamp: a skull standing in an iron dish, a fat candle burning on its crown with
the wax run down over the bone, its eye sockets glowing from inside, hung on three chains from a
dark block bolted to a ceiling beam.

The skull, the candle and the dish are shared with the wall sconce (skullsconce.py imports them),
so both lamps carry the same skull. Everything of the skull is modelled in its own frame: its
teeth on y = 0, facing +z, about 0.1 wide.

Cheap on purpose - there are several of these in the hall: the cranium and the face are hulls of a
dozen points (faceted rather than round, which is also the look), the drips are four-sided
ridges half sunk into the bone, and a chain link is a three-sided tube round a rectangle (24
triangles, six links a chain - the chains are still a third of the lamp)."""
import math
import bmesh
from mathutils import Matrix, Vector
from geom import (TAU, PI, BLACK, WAX, FLAME, SOCKET, IRON, BRASS,
                  M, frame, box, span, lathe, hull, tube, prism, emit, rng, material)

ASSET = 'civic_kraken_skulllamp'

# The hall's BONE is a pale, cool white; against it the wax vanished. An old skull is warmer and
# darker than the candle burning on it, and the wax reads as wax.
SKULL = material('plain:skull', 0xd4bd94)
DISHIRON = material('plain:dish-iron', 0x38383a)
BLOCK = material('plain:lamp-block', 0x3e2a1c)


# ---- small closed shapes of our own ------------------------------------------------------------
def band(label, at, r0, r1, y0, y1, mat, sides=10, phase=0.0):
    """A flat ring (a washer standing on edge): r0..r1 across, y0..y1 tall. The lathe caps its
    ends with discs, which across a dish would be a lid."""
    bm = bmesh.new()
    secs = []
    for i in range(sides):
        a = phase + TAU * i / sides
        c, s = math.cos(a), math.sin(a)
        secs.append([bm.verts.new((r * c, y, r * s)) for r, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1))])
    for i in range(sides):
        A, B = secs[i], secs[(i + 1) % sides]
        for j in range(4):
            bm.faces.new((A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j]))
    bm.transform(M(at))
    emit(bm, mat, label)


def loop(label, pts, r, mat, normal=(0, 0, 1), sides=3):
    """A closed tube round a flat polygon: a chain link with a hole in it."""
    pts = [Vector(p) for p in pts]
    nz = Vector(normal)
    n = len(pts)
    bm = bmesh.new()
    secs = []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
        u = t.cross(nz).normalized()
        secs.append([bm.verts.new(p + (u * math.cos(TAU * k / sides) + nz * math.sin(TAU * k / sides)) * r)
                     for k in range(sides)])
    for i in range(n):
        A, B = secs[i], secs[(i + 1) % n]
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    emit(bm, mat, label)


def rivet(p, n, k=.0038, h=.0035, mat=BRASS):
    """A rivet head: a four-sided pyramid pressed onto a surface at p, pointing along n."""
    p, n = Vector(p), Vector(n).normalized()
    a = n.cross(Vector((0, 1, 0)) if abs(n.y) < .9 else Vector((1, 0, 0))).normalized()
    b = n.cross(a)
    hull('rivet', [tuple(p + a * k), tuple(p - a * k), tuple(p + b * k), tuple(p - b * k), tuple(p + n * h)], mat)


# ---- the skull -----------------------------------------------------------------------------------
# The cranium as an ellipsoid, so the wax can be run over its surface.
CC = Vector((0, .066, -.013))
CR = Vector((.05, .047, .055))


def on_cranium(lat, lon, out=.0):
    """A point on the cranium: `lat` down from the crown (0) towards the equator (pi/2), `lon`
    round from +x through +z (the face)."""
    s = math.sin(lat)
    d = Vector((CR.x * s * math.cos(lon), CR.y * math.cos(lat), CR.z * s * math.sin(lon)))
    return CC + d * (1 + out / d.length)


def cranium_normal(p):
    d = Vector(p) - CC
    return Vector((d.x / CR.x ** 2, d.y / CR.y ** 2, d.z / CR.z ** 2)).normalized()


def drip(label, pts, normals, radii, mat):
    """A run of wax lying on a surface: a four-sided section turned so that one corner points
    out of the surface and the opposite one is sunk into it, which reads as a rounded ridge from
    every side (a square tube turned any old way showed a flat board edge on)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    secs = []
    for i, (p, nn, r) in enumerate(zip(pts, normals, radii)):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nn = Vector(nn).normalized()
        b = t.cross(nn).normalized()
        nn = b.cross(t).normalized()
        secs.append([bm.verts.new(p + v) for v in (nn * r, b * r * .85 + nn * r * .4, -nn * r * .6, -b * r * .85 + nn * r * .4)])
    for A, B in zip(secs, secs[1:]):
        for k in range(4):
            bm.faces.new((A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]))
    bm.faces.new(secs[0])
    bm.faces.new(list(reversed(secs[-1])))
    emit(bm, mat, label)


def skull():
    # The brain case: a faceted egg, broadest behind the eyes, a little flat on top.
    pts = [tuple(CC + Vector((0, CR.y * .98, 0)))]
    # Down to the base behind the jaw, flattened where it sits in the dish.
    for k, lat in enumerate((.55, 1.05, 1.5, 1.95, 2.4)):
        for i in range(8):
            lon = TAU * i / 8 + (PI / 8 if k % 2 else 0)
            p = on_cranium(lat, lon)
            p.y = max(p.y, .014)
            pts.append(tuple(p))
    hull('skull cranium', pts, SKULL)
    for sx in (-1, 1):
        # The brow over each eye, standing out from the forehead.
        hull('skull brow', [(sx * .004, .068, .05), (sx * .02, .074, .05), (sx * .044, .066, .036),
                            (sx * .046, .06, .03), (sx * .02, .065, .054), (sx * .004, .06, .051),
                            (sx * .03, .07, .03), (sx * .008, .07, .036)], SKULL)
        # The cheekbone under it, out to the side.
        hull('skull cheek', [(sx * .014, .036, .049), (sx * .036, .037, .046), (sx * .047, .042, .03),
                             (sx * .048, .03, .02), (sx * .03, .026, .044), (sx * .016, .028, .046),
                             (sx * .042, .026, .016), (sx * .04, .044, .02)], SKULL)
        # The outer rim of the orbit, from brow to cheekbone, so the socket is bone all round.
        hull('skull orbit', [(sx * .035, .064, .045), (sx * .036, .037, .045), (sx * .047, .062, .03),
                             (sx * .048, .04, .028), (sx * .044, .05, .042), (sx * .04, .05, .02)], SKULL)
    # The face between: the bridge of the nose down to the upper jaw that holds the teeth.
    hull('skull face', [(sx * dx, y, z) for sx in (-1, 1) for dx, y, z in
                        ((.006, .062, .046), (.012, .042, .05), (.02, .03, .049), (.028, .016, .046),
                         (.022, .01, .043), (.036, .012, .012), (.042, .03, .01), (.03, .006, .0))], SKULL)
    # Upper teeth on a gentle curve, the dark of the mouth behind them.
    box('skull mouth', (0, .008, .036), (.044, .012, .008), BLACK)
    for i in range(5):
        x = -.016 + i * .008
        z = .042 - x * x * 5
        w, d, top = .0068, .008, .015
        hull('skull tooth', [(x + sx * w / 2, top, z + sz * d / 2) for sx in (-1, 1) for sz in (-1, 1)]
             + [(x + sx * w * .3, 0, z) for sx in (-1, 1)], SKULL)
    # The nose: a dark triangle, point up.
    prism('skull nose', [(0, .011), (-.0075, -.004), (.0075, -.004)], .006, BLACK, M((0, .03, .048)))
    # The sockets: a dark rim sunk into the face, the ember a little back inside it. Slanted a
    # little, outer corners down, like the drawing's.
    for sx in (-1, 1):
        with frame(M((sx * .021, .05, 0)) @ Matrix.Rotation(-sx * .18, 4, 'Z')):
            lathe('skull socket', [(.0145, 0), (.0145, .01), (0, .01)], BLACK, at=(0, 0, .032),
                  sides=6, tilt=PI / 2, scale=(1.1, 1, .88))
            lathe('eye', [(.0112, 0), (.0112, .0045), (0, .0045)], SOCKET, at=(0, 0, .04),
                  sides=6, tilt=PI / 2, scale=(1.1, 1, .88))


def candle(y0, seed=0, h=.06, r=.019):
    """A thick stub of a candle on the skull's crown, the top melted into a hollow, with a pool of
    wax round its foot and runs of it down the bone."""
    z = CC.z + .004
    lathe('lamp candle', [(r * 1.05, 0), (r, h * .5), (r * .95, h), (r * .6, h - .006), (0, h - .005)],
          WAX, at=(0, y0, z), sides=7)
    tube('lamp wick', [(0, y0 + h - .006, z), (0, y0 + h + .006, z)], .0016, BLACK, sides=3)
    lathe('flame', [(0, 0), (.0065, .004), (.0095, .012), (.0065, .021), (0, .034)], FLAME,
          at=(0, y0 + h + .002, z), sides=5)
    g = rng(seed)
    # Runs down the candle itself, from the melted lip, each ending in a bead.
    for a in (.9, 3.4):
        a += g.uniform(-.3, .3)
        l = g.uniform(.028, .04)
        c, s = math.cos(a), math.sin(a)
        ys = (y0 + h + .001, y0 + h - l, y0 + h - l - .006)
        drip('candle run', [(r * c, y, z + r * s) for y in ys], [(c, 0, s)] * 3, [.0045, .0055, .0015], WAX)
    # The pool on the crown: a skin of wax over the bone, thickest at the candle's foot.
    prof = [(0, CC.y + CR.y + .004)]
    for lat, out in ((.3, .007), (.58, .0058), (.8, .0005)):
        p = on_cranium(lat, 0, out)
        prof.append((p.x, p.y))
    lathe('wax pool', prof, WAX, at=(0, 0, CC.z), sides=8, phase=PI / 8, scale=(1, 1, CR.z / CR.x))
    # Runs down the cranium from the pool's edge: two over the forehead to the brow, the rest
    # round the sides and the back. Half sunk into the bone, so what shows is a rounded ridge
    # with a fatter bead where it stopped.
    for lon, end in ((PI / 2 - .38, 1.28), (PI / 2 + .34, 1.16), (.25, 1.18), (PI - .3, 1.26),
                     (-PI / 2 + .5, 1.3)):
        lon += g.uniform(-.1, .1)
        path = [on_cranium(lat, lon, .0015) for lat in (.62, (.62 + end) / 2, end, end + .075)]
        drip('wax run', path, [cranium_normal(p) for p in path], [.0068, .0062, .0092, .0025], WAX)


def dish(R, seed=0):
    """A shallow iron dish, bottom on y = 0, a brass band round its lip studded with rivets and a
    little iron plate at the front. Returns the height of its floor."""
    y0, y1 = R * .3, R * .5             # the brass band
    floor = R * .46
    lathe('dish', [(0, 0), (R * .42, 0), (R * .72, R * .1), (R * .9, R * .24), (R * .93, R * .34),
                   (0, floor)], DISHIRON, sides=10)
    ro = R * 1.03
    band('dish band', (0, 0, 0), R * .86, ro, y0, y1, BRASS, sides=10)
    ym = (y0 + y1) / 2
    fl = ro * math.cos(PI / 10)          # the band's flats, where a rivet sits
    for i in range(10):
        a = TAU * i / 10 + PI / 10
        if abs(math.sin(a) - 1) < 1e-3 or i % 2:
            continue                     # every other flat; the front plate has its own
        rivet((fl * math.cos(a), ym, fl * math.sin(a)), (math.cos(a), 0, math.sin(a)), k=.0042, h=.0045)
    # The plate at the front, standing proud of the band, with its own rivet.
    span('dish plate', -.013, .013, y0 - .008, y1 + .001, fl - .001, fl + .006, IRON)
    rivet((0, ym, fl + .006), (0, 0, 1), k=.0035, h=.0035, mat=IRON)
    return floor


def skull_on_dish(R, seed=0):
    """Dish, skull and candle, standing on y = 0 at the dish's bottom."""
    floor = dish(R, seed)
    with frame(M((0, floor, -.004))):
        skull()
        candle(CC.y + CR.y - .012, seed=seed)
    return floor


# ---- the hanging lamp ------------------------------------------------------------------------------
R = .09                  # the dish's radius
TOP = .55                # the block's top
BLOCK_H = .05


def chain(a, b, n=6, w=.04, wire=.006):
    """n links from a to b, each turned a quarter on the last: a closed three-sided tube round a
    rectangle, 24 triangles, so it has a hole from whichever side it is seen. Flat plates for every
    other link were cheaper and read as a ladder of black slabs from the side."""
    a, b = Vector(a), Vector(b)
    d = b - a
    step = d.length / n
    L = step + 2.6 * wire               # long enough to hook through its neighbours
    hw, hh = w / 2 - wire, L / 2 - wire
    # The first link lies in the lamp's front plane, the next across it, and so on: from the front
    # and from the side a chain is then an open link, a bar through it, an open link, as in the
    # drawing. (Turned to face the lamp's axis instead, the two chains at the front showed every
    # link half open and read as ladders.)
    y = d.normalized()
    x = Vector((1, 0, 0))
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    q = Matrix((x, y, z)).transposed().to_4x4()
    for i in range(n):
        p = a + d * ((i + .5) / n)
        with frame(Matrix.Translation(p) @ q @ Matrix.Rotation((i % 2) * PI / 2, 4, 'Y')):
            loop('chain link', [(hw, hh, 0), (-hw, hh, 0), (-hw, -hh, 0), (hw, -hh, 0)], wire, IRON)


def build():
    skull_on_dish(R, seed=3)
    # The block the lamp hangs from, bolted to a beam: dark wood, an iron strap over it where each
    # chain comes up to it, with a bolt through.
    y0 = TOP - BLOCK_H
    span('lamp block', -.075, .075, y0, TOP, -.05, .05, BLOCK)
    for x in (-.042, .042):
        span('lamp strap', x - .01, x + .01, y0 - .003, TOP + .002, -.053, .053, IRON)
        rivet((x, y0 + BLOCK_H / 2, .053), (0, 0, 1), k=.005, h=.0045, mat=IRON)
    span('lamp strap', -.075 - .003, .075 + .003, y0 - .003, TOP + .002, -.03, -.012, IRON)
    # Three chains from the dish's band to the block: two to the front corners, one at the back,
    # so from the front the back one hides behind the candle, as in the drawing.
    rim = R * .98
    ry = R * .42
    for a in (PI / 6, 5 * PI / 6, -PI / 2):
        c, s = math.cos(a), math.sin(a)
        top = (.042 * (1 if c > .1 else -1 if c < -.1 else 0), y0 - .002, .022 if s > 0 else -.021)
        chain((rim * c, ry, rim * s), top)
