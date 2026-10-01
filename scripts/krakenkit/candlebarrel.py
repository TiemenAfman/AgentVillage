"""A barrel crowded with fat candles, burnt down to every height and run over with wax, two gilt
skulls among them and a coil of rope round their feet; the wax has overflowed the head in thick
tongues down the staves and pooled on the boards, and three rocks lie against the foot.
Reference: refs/krakenkit/objecten/kaarsen-druipers.jpg (round 4, 1 October 2026).

Built by hand rather than from an image-to-3D mesh of the same picture: TRELLIS.2 lost every thin
thing - the runs, the rope, the pool - to holes; Pixal3D's (refs/krakenkit/3d/kaarsen-druipers-
pixal3d-50k.glb) is faithful and was the 3D reference for where things stand round the back, but at
50k triangles, textured and organic it is no kit piece. Here every run of wax is a closed tube lying
half sunk in the surface it ran down (`flow`), so nothing is thinner than it is drawn.

Its own frame: standing on y = 0, front to +z. Low and wide like the drawing: a squat cask 0.13
tall and 0.23 across under a rolled lip of wax 0.26 across (a slab of 0.29 read as a table top), the
candles fat, crowded on the head and two more on the boards beside it, their flames half again the
barrel's height over its head, the skulls in front; the pool and the rocks reach 0.25 from the axis.
A first version at a settler's waist with slim candles read as a tower, not as the drawing's heap.

About 17000 triangles, at the keeper's asking, and most of them where the eye goes: the candles'
melted crowns and runs (twelve-sided, the runs six-sided and curving), the skulls (a cranium of
its own, finer than the skull lamp's, which hangs several times and is cheap on purpose) and the
overflow over the head. The staves, the hoops and the rocks stay plain."""
import math
import bmesh
from mathutils import Matrix, Vector
from geom import (TAU, PI, BLACK, WAX, FLAME, IRON, ROPE, M, frame, lathe, hull, tube, disc, prism,
                  emit, rng, material)

ASSET = 'civic_kraken_candlebarrel'

STAVE = material('plank:candle-barrel', 0x6b4a2e)
GILT = material('plain:skull-gilt', 0xc89b3c, ao=False)   # old gilding; unshaded, or the candles behind turn it brown
OLDWAX = material('plain:wax-old', 0xe8d6b4)      # the wax that ran: a shade warmer than a fresh candle
PEBBLE = material('stone:candle-rock', 0x7d7a76)  # the drawing's rocks are a light, rounded grey

H = .13                     # the barrel's head
STAVES = 14
TOP = H + .01               # the wax lying over the head
RIM = .117                  # the head's radius under the wax
CAP = .132                  # the wax over it: a lip a little wider than the barrel, as in the drawing, that the
                            # outer candles stand on


def bulge(t):
    """The barrel's radius at t (0 foot, 1 head), bellied in the middle."""
    return .115 + .014 * (1 - (2 * t - 1) ** 2)


# ---- wax that ran ----------------------------------------------------------------------------
def flow(label, pts, normals, radii, mat, sides=6):
    """A run of wax lying on a surface: an oval section, wider along the surface than it stands
    off it, sunk a third into the surface so that only its rounded back shows, and closed at both
    ends. Six-sided, so a run reads as wax and not as a strip of wood."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    secs = []
    for i, (p, nn, r) in enumerate(zip(pts, normals, radii)):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nn = Vector(nn).normalized()
        b = t.cross(nn)
        if b.length < 1e-4:
            # The run goes straight along its normal (where it leaves the slab's lip and drops):
            # any sideways direction will do for the section.
            b = t.cross(Vector((1, 0, 0)) if abs(t.x) < .9 else Vector((0, 0, 1)))
        b.normalize()
        nn = b.cross(t).normalized()
        # Three quarters as thick as wide: at half, the runs read as flat strips of paper.
        secs.append([bm.verts.new(p + b * r * math.cos(TAU * k / sides)
                                  + nn * r * (.75 * math.sin(TAU * k / sides) + .2))
                     for k in range(sides)])
    for A, B in zip(secs, secs[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(secs[0])
    bm.faces.new(list(reversed(secs[-1])))
    emit(bm, mat, label)


def tongue(a, length, width, seed, n=9):
    """A tongue of wax from the overflow on the head, over the rim and down the staves: broad
    where it leaves the rim, narrowing, swelling again into the drop it stopped in. `length` 1
    reaches the floor, and there it bends out onto the boards."""
    g = rng(seed)
    wander = g.uniform(-.16, .16)
    pts, normals, radii = [], [], []
    # From the slab's rolled lip, where it leaves it: starting on the lip itself, so that it grows
    # out of the edge (begun on top, the tongues were a ring of spikes round the candles).
    for r, y in ((CAP - .004, TOP - .006), (CAP + .001, TOP - .016)):
        pts.append((r * math.cos(a), y, r * math.sin(a)))
        normals.append((math.cos(a), .3, math.sin(a)))
        radii.append(width * 1.45)
    for k in range(n):
        f = k / (n - 1)
        t = 1 - f * length
        aa = a + wander * f * f
        rr = bulge(t) + .001
        y = H * t - .004
        out = (math.cos(aa), 0, math.sin(aa))
        if length >= .99 and k == n - 1:
            # On the floor: out over the boards, lying flat.
            rr += .02
            y = .004
            out = (0, 1, 0)
        pts.append((rr * math.cos(aa), max(y, .004), rr * math.sin(aa)))
        normals.append(out)
        radii.append(width * (1.3 - .6 * f + .08 * math.sin(f * 7 + seed)) * g.uniform(.95, 1.05))
    if length < .99:
        radii[-1] = width * 1.05                        # the drop it stopped in, part of the run
    flow('barrel tongue', pts, normals, radii, OLDWAX, sides=8)   # six-sided they read as boxes


# ---- the candles -----------------------------------------------------------------------------
def candle(x, z, h, r, seed, y0=TOP):
    """A fat candle on the wax over the head (or, `y0` 0, on the boards beside the barrel): its top
    burnt into a hollow with a melted lip rolled over the edge, runs from the lip down its side that
    wander and end in drops, a black wick and a flame."""
    g = rng(seed)
    sides = 12
    lean = g.uniform(-.006, .006)
    prof = [(r * 1.08, 0), (r * 1.02, .006), (r, h * .35), (r * .99, h * .7), (r * .98, h - .012),
            (r * 1.14, h - .008), (r * 1.18, h - .002), (r * .96, h + .002), (r * .62, h - .004),
            (r * .3, h - .008), (0, h - .007)]
    lathe('candle', prof, WAX, at=(x, y0, z), sides=sides, phase=g.uniform(0, PI),
          roll=lean)
    tube('candle wick', [(x, y0 + h - .007, z), (x + .0008, y0 + h + .006, z + .0005)], .0016, BLACK, sides=4)
    # The drawing's flames are small against the candles, about two thirds of one across in
    # height; at the candle's own width they read as a row of yellow torches.
    lathe('flame', [(0, 0), (.0045, .003), (.0075, .009), (.0085, .015), (.006, .024), (.0025, .031), (0, .036)],
          FLAME, at=(x, y0 + h + .003, z), sides=6, scale=.72 * min(1.2, r / .02))
    # The runs from the lip: over its edge, then down the side, wandering, each its own length.
    k_runs = g.randint(5, 7)
    for k in range(k_runs):
        a = TAU * k / k_runs + g.uniform(-.3, .3)
        # Short and fat from a fat lip, as in the drawing: run down most of a tall candle they
        # hung off it as ribbons of paper.
        l = min(h * g.uniform(.15, .5), .07)
        w = r * g.uniform(.3, .42)
        wander = g.uniform(-.25, .25)
        pts, normals, radii = [], [], []
        pts.append((x + r * .95 * math.cos(a), y0 + h + .001, z + r * .95 * math.sin(a)))
        normals.append((math.cos(a) * .5, .85, math.sin(a) * .5))
        radii.append(w * 1.2)
        steps = 6
        for i in range(steps):
            f = (i + 1) / steps
            aa = a + wander * f * f / r * .02
            yy = y0 + h - .006 - l * f
            rr = r * (1.0 + .02 * (1 - f))
            pts.append((x + rr * math.cos(aa), yy, z + rr * math.sin(aa)))
            normals.append((math.cos(aa), 0, math.sin(aa)))
            radii.append(w * (1.15 - .55 * f + .12 * math.sin(f * 5 + k)))
        radii[-1] = w * 1.1                             # the drop it stopped in, part of the run
        flow('candle run', pts, normals, radii, WAX)


# ---- the gilt skulls -------------------------------------------------------------------------
# Where the two skulls sit on the head, and how far round their middle a skull reaches (0.82 of a
# cranium 0.11 deep, plus its brow): the candles are kept clear of it.
# At .82 they stood head to head as two gold balls as wide as the candles were tall; the drawing's
# are a quarter of the barrel across, apart, sunk among the candles.
SKULLS = ((-.047, .07), (.047, .07))
SKULL_SCALE = .66
SKULL_R = .042
CC = Vector((0, .066, -.012))     # the cranium's middle: the face is +z, the teeth on y = 0
CR = Vector((.046, .044, .055))


def cranium():
    """A cranium of its own: a sphere of 14 x 9 pressed into a skull's egg - broad behind the eyes,
    narrow at the temples, flat where it would sit on the jaw."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=1.0)
    bm.transform(Matrix.Rotation(-PI / 2, 4, 'X'))
    for v in bm.verts:
        x, y, z = v.co
        front = max(0.0, z)
        x *= CR.x * (1 - .16 * front * (1 - abs(y)))          # the temples come in
        z *= CR.z * (1 + .08 * max(0.0, -z))                  # the back of the head reaches out
        y *= CR.y
        y = max(y, -.034)                                     # flat underneath
        v.co = CC + Vector((x, y, z))
    emit(bm, GILT, 'skull cranium')


def gilt_skull():
    cranium()
    for sx in (-1, 1):
        # Brow over each eye, cheekbone under it, the rim of the orbit between.
        hull('skull brow', [(sx * .004, .07, .052), (sx * .02, .076, .052), (sx * .044, .068, .038),
                            (sx * .047, .061, .031), (sx * .02, .066, .056), (sx * .004, .061, .053),
                            (sx * .03, .072, .032), (sx * .008, .072, .038)], GILT)
        hull('skull cheek', [(sx * .014, .036, .051), (sx * .037, .037, .048), (sx * .048, .043, .031),
                             (sx * .049, .03, .021), (sx * .031, .025, .046), (sx * .016, .028, .048),
                             (sx * .043, .025, .016), (sx * .041, .045, .021)], GILT)
        hull('skull orbit', [(sx * .036, .065, .047), (sx * .037, .037, .047), (sx * .048, .063, .031),
                             (sx * .049, .04, .029), (sx * .045, .051, .044), (sx * .041, .051, .021)], GILT)
        # The socket: a deep dark hollow, slanted a little, outer corner down.
        with frame(M((sx * .021, .051, 0)) @ Matrix.Rotation(-sx * .18, 4, 'Z')):
            lathe('skull socket', [(.0152, 0), (.0152, .006), (.012, .012), (0, .013)], BLACK, at=(0, 0, .03),
                  sides=10, tilt=PI / 2, scale=(1.1, 1, .9))
    # The face between: the bridge of the nose down to the upper jaw.
    hull('skull face', [(sx * dx, y, z) for sx in (-1, 1) for dx, y, z in
                        ((.006, .064, .048), (.012, .043, .052), (.02, .031, .051), (.028, .017, .048),
                         (.022, .01, .045), (.036, .012, .012), (.042, .031, .01), (.03, .006, .0))], GILT)
    # The nose: a dark heart, point up, sunk into the face.
    prism('skull nose', [(0, .012), (-.004, .003), (-.0085, -.004), (0, -.002), (.0085, -.004), (.004, .003)],
          .01, BLACK, M((0, .031, .047)))
    # Upper teeth on a curve, the dark of the mouth behind them, and the lower jaw under them with
    # its own row (the skulls sit sunk to the chin in the wax, so it stops there).
    box_mouth = [(sx * .024, .0, .03) for sx in (-1, 1)] + [(sx * .022, .012, .036) for sx in (-1, 1)] \
        + [(sx * .02, .002, .041) for sx in (-1, 1)] + [(sx * .018, .013, .041) for sx in (-1, 1)]
    hull('skull mouth', box_mouth, BLACK)
    for i in range(6):
        xx = -.0175 + i * .007
        zz = .045 - xx * xx * 6
        hull('skull tooth', [(xx + sx * .003, .015, zz + sz * .0035) for sx in (-1, 1) for sz in (-1, 1)]
             + [(xx + sx * .0018, .004, zz + .0008) for sx in (-1, 1)], GILT)
        hull('skull tooth', [(xx + sx * .0028, -.002, zz - .001 + sz * .003) for sx in (-1, 1) for sz in (-1, 1)]
             + [(xx + sx * .0016, .006, zz - .0002) for sx in (-1, 1)], GILT)
    hull('skull jaw', [(sx * .03, -.012, .0) for sx in (-1, 1)] + [(sx * .026, -.016, .03) for sx in (-1, 1)]
         + [(sx * .016, -.016, .044) for sx in (-1, 1)] + [(sx * .028, -.002, .018) for sx in (-1, 1)]
         + [(sx * .016, -.004, .044) for sx in (-1, 1)], GILT)


# ---- the rest --------------------------------------------------------------------------------
def staves():
    """Fourteen staves with a hairline between them, each a hull of its outside and inside faces,
    so the gaps are dark seams the ambient occlusion finds."""
    gap = .012
    for i in range(STAVES):
        a0, a1 = TAU * i / STAVES + gap / 2, TAU * (i + 1) / STAVES - gap / 2
        pts = []
        for t in (0, .2, .4, .6, .8, 1):
            for a in (a0, a1):
                for r in (bulge(t), bulge(t) - .009):
                    pts.append((r * math.cos(a), H * t, r * math.sin(a)))
        hull('barrel stave', pts, STAVE)
    disc('barrel head', (0, H - .012, 0), bulge(1) - .006, .012, STAVE, sides=STAVES)
    for t in (.07, .93):
        y = H * t
        disc('barrel hoop', (0, y - .007, 0), bulge(t) + .003, .014, IRON, sides=STAVES)


def rope_ring(y, R, r, seed, wraps=2):
    """Rope wound round the barrel `wraps` times, a little loose, so the turns lie side by side."""
    g = rng(seed)
    n = 26 * wraps
    pts = []
    for i in range(n + 1):
        a = TAU * wraps * i / n
        pts.append(((R + g.uniform(-.001, .001)) * math.cos(a), y + .011 * i / n * wraps / 2, (R + g.uniform(-.001, .001)) * math.sin(a)))
    tube('barrel rope', pts, r, ROPE, sides=5)


def pebble(at, size, seed):
    """A rounded rock: the hull of two dozen points jittered a little round an ellipsoid, its
    foot on the floor."""
    g = rng(seed)
    x, z = at
    sx, sy, sz = size
    pts = []
    for i in range(26):
        u = -1 + 2 * (i + .5) / 26
        v = i * 2.39996 + g.uniform(-.2, .2)            # golden angle: evenly round the ball
        k = math.sqrt(1 - u * u) * g.uniform(.88, 1.0)
        pts.append((x + sx * k * math.cos(v), sy * (1 + u * g.uniform(.9, 1.0)), z + sz * k * math.sin(v)))
    hull('rock', pts, PEBBLE)


def pool(cx, cz, rx, rz, seed):
    """A lobe of wax spread on the boards: a low lumpy skin with a rounded edge."""
    g = rng(seed)
    pts = []
    for i in range(16):
        a = TAU * i / 16 + g.uniform(-.12, .12)
        k = g.uniform(.78, 1.0)
        pts += [(cx + rx * k * math.cos(a), 0, cz + rz * k * math.sin(a)),
                (cx + rx * k * .9 * math.cos(a), .005, cz + rz * k * .9 * math.sin(a)),
                (cx + rx * k * .7 * math.cos(a), .009, cz + rz * k * .7 * math.sin(a))]
    pts.append((cx, .012, cz))
    hull('wax pool', pts, OLDWAX)


def place(spots):
    """Where the candles stand, so that none is through a skull, through another candle or off the
    head: each is pushed straight away from whatever it is in, then drawn back inside the rim, a
    few rounds until nothing moves (the first fit, by eye, had two candles in the skulls and three
    hanging over the edge on nothing). A candle that still does not fit is left out."""
    placed = [list(p) for p in spots]
    for _ in range(12):
        moved = False
        for k, (x, z, h, r) in enumerate(placed):
            others = [(cx, cz, SKULL_R) for cx, cz in SKULLS] + [(ox, oz, orr * 1.13) for ox, oz, _, orr in placed[:k]]
            for cx, cz, cr in others:
                dx, dz = x - cx, z - cz
                d = math.hypot(dx, dz) or 1e-6
                need = cr + r * 1.13 + .002
                if d < need - 1e-6:
                    x, z, moved = cx + dx / d * need, cz + dz / d * need, True
            d = math.hypot(x, z)
            room = CAP - .006 - r * 1.08
            if d > room + 1e-6:
                x, z, moved = x * room / d, z * room / d, True
            placed[k][:2] = x, z
        if not moved:
            break
    out = []
    for k, (x, z, h, r) in enumerate(placed):
        clear = all(math.hypot(x - cx, z - cz) >= SKULL_R + r * 1.13 for cx, cz in SKULLS) and all(
            math.hypot(x - ox, z - oz) >= (orr + r) * 1.13 for ox, oz, _, orr in placed[:k])
        if clear:
            out.append((x, z, h, r, math.hypot(x, z) + r > RIM))
        else:
            print(f'candlebarrel: candle {k} has no room and is left out')
    return out


def build():
    staves()
    # The drawing's rope is as thick as a finger against the barrel: at .0055 it read as a hoop.
    rope_ring(H * .3, bulge(.3) + .006, .0085, 1)
    rope_ring(H * .62, bulge(.62) + .006, .0085, 2)
    # The wax over the head: a fat rolled rim over its edge, domed a little in the middle.
    # A rolled, swollen lip all round, and underneath it the wax gathers back in to the staves.
    lathe('head wax', [(0, TOP + .004), (CAP * .55, TOP + .003), (CAP * .82, TOP + .001),
                       (CAP - .01, TOP - .002), (CAP - .002, TOP - .007), (CAP + .002, TOP - .014),
                       (CAP - .002, TOP - .021), (CAP - .012, TOP - .026), (RIM + .004, H - .016),
                       (RIM - .004, H - .022), (0, H - .022)],
          OLDWAX, sides=32, phase=PI / 32)
    # The tongues down the staves, angle 0 is +x and PI/2 the front: three long ones in front
    # reaching the floor, middling ones between, and short ones all round the rim overlapping
    # them - the overflow's scalloped edge.
    for k, (a, length, w) in enumerate(((PI / 2 - .55, 1.0, .014), (PI / 2 + .2, 1.0, .016),
                                        (PI / 2 + .85, 1.0, .012), (PI / 2 - 1.15, .6, .012),
                                        (PI / 2 + 1.45, .5, .012), (-.25, .82, .013), (PI + .35, .62, .012),
                                        (-PI / 2 + .45, .5, .011), (-PI / 2 - .7, .86, .013))):
        tongue(a, length, w, 10 + k)
    # Eighteen short ones of one width read as a paper frill round a cake; eleven, fatter and of
    # more different lengths, as the overflow's lumpy edge.
    for k in range(11):
        a = TAU * k / 11 + .17
        tongue(a, .16 + .3 * ((k * 7) % 5) / 4, .012 + .003 * (k % 3), 70 + k, n=7)
    # On the floor: two lobes in front where the long tongues came down, one behind.
    pool(-.07, .14, .12, .08, 31)
    pool(.08, .135, .11, .075, 32)
    # Behind and to both sides as far as the HD model's pool reaches (the HD pack's fit, shared/hdfit.mjs:
    # every face of its box within a tenth of the model of this one's, and the textured model's wax runs
    # out to 0.285 across and 0.287 behind; at 0.22 and 0.19 the HD piece was refused).
    pool(-.03, -.175, .13, .095, 33)
    pool(.2, -.04, .085, .075, 34)
    pool(-.2, .0, .085, .075, 35)
    # The candles, crowded on the head: tall at the back, shorter at the front round the skulls.
    g = rng(5)
    # Six round the lip, everywhere but the front where the skulls sit (angle 0 is +x, -90 the
    # back), tallest at the back, and two tall ones in the middle behind the skulls. Nine did not
    # fit beside the skulls however they were pushed (place() leaves out what has no room).
    # The drawing's candles stand half again the barrel's height over its head; at 1.2 the barrel
    # read as a cake with candles on it.
    ring = [(4, .1, .022), (-34, .16, .026), (-71, .21, .028), (-109, .19, .027), (-146, .15, .025),
            (176, .095, .022)]                 # two more at 35 and 145 degrees found no room beside the skulls
    spots = [(.1 * math.cos(math.radians(a)), .1 * math.sin(math.radians(a)), h, r) for a, h, r in ring]
    spots += [(-.03, -.025, .2, .028), (.04, -.03, .17, .026)]
    for i, (x, z, h, r, edge) in enumerate(place([(x + g.uniform(-.003, .003), z + g.uniform(-.003, .003), h, r)
                                                  for x, z, h, r in spots])):
        if edge:
            # One that stands at the edge has run over it: a tongue from under its foot.
            tongue(math.atan2(z, x), .55 + .3 * (i % 2), r * .5, 90 + i)
        candle(x, z, h, r, 40 + i)
    # And on the boards beside it, as at the drawing's left: two tall ones whose flames stand among
    # those on the head, and a stub burnt down in the pool in front.
    for i, (x, z, h, r) in enumerate(((-.172, .025, .22, .03), (.168, -.06, .2, .028), (.11, .175, .045, .02))):
        candle(x, z, h, r, 120 + i, y0=.006)
    # Two gilt skulls at the front, turned a little towards each other, sunk to the chin in the wax.
    for (cx, cz), turn in zip(SKULLS, (.3, -.25)):
        with frame(M((cx, TOP + .006, cz), turn=turn, tilt=-.12, scale=(SKULL_SCALE,) * 3)):
            gilt_skull()
    # A coil of rope round their feet and behind them, lying on the wax.
    pts = []
    for i in range(41):
        a = PI * .15 + PI * 1.7 * i / 40
        rr = .1 + .006 * math.sin(i * .9)
        pts.append((rr * math.cos(a), TOP + .006 + .004 * math.sin(i * .5), rr * math.sin(a) * .9 - .004))
    tube('top rope', pts, .008, ROPE, sides=5)
    # And its end come down the front and lying on the boards in a loose coil before the barrel.
    g = rng(77)
    pts = [(-.02, TOP - .01, bulge(.95) + .01), (-.035, H * .55, bulge(.55) + .016), (-.05, .012, bulge(0) + .03)]
    for i in range(1, 34):
        a = PI * .55 + TAU * 1.6 * i / 33
        rr = .05 * (1 - .45 * i / 33)
        pts.append((-.085 + rr * math.cos(a) + g.uniform(-.002, .002), .008 + .002 * math.sin(i * .7),
                    .16 + rr * math.sin(a) * .8))
    tube('floor rope', pts, .008, ROPE, sides=5)
    # Three rocks against the foot, as in the drawing: two in front, one at the side.
    for (x, z, s), seed in (((-.175, .11, (.05, .034, .045)), 61), ((.0, .21, (.052, .036, .042)), 62),
                            ((.185, .055, (.045, .032, .042)), 63)):
        pebble((x, z), s, seed)
