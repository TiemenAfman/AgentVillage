"""The pirates' jukebox, where the Salty Kraken's music comes from: an upright cabinet of very dark
wood with a round-arched top, two brass-framed columns on chunky iron-strapped feet, and in the
brass channel that runs up the columns and round the arch a tube of bubbling blood where a
Wurlitzer has its neon (the keeper's choice). A gold skull-and-crossbones medallion on the crown;
under the arch a half-moon opening onto the turntable, below it a little amber window with a record
in it, and in the lower middle a brass porthole speaker with a diamond grille. A faceted brass
gramophone horn rises from a motor box on the back, behind the top right. After the keeper's
concept drawing (refs/krakenkit/objecten/jukebox.jpg), front and side.

Frame: origin on the floor in the middle; the back against the wall at z = -0.11 (the motor box
and its bracket; the cabinet's own back is -0.08), the columns' front at +0.11. About 0.31 wide,
0.43 to the top of the arch, the horn to about 0.52.

The blood is static here (bubbles and all); every glowing piece is kept within ~0.1 so the game can
treat each on its own, which is why the tubes are cut into short lengths.
"""
import math
import bmesh
from mathutils import Matrix, Vector
import geom
from geom import (PI, TAU, M, frame, span, box, rod, disc, ball, lathe, prism, hull, torus, band,
                  DARK, JUKEW, IRON, BRASS, BRONZE, GOLD, GOLDHI, BLACK, SOOT, VELVET, material)

ASSET = 'civic_kraken_jukebox'

BLOOD = material('plain:blood', 0xb80c1a, glow=True)
BUBBLE = material('plain:blood-bubble', 0xff7a86, glow=True)
AMBER = 'plain:juke-window'
PORTGLASS = material('plain:juke-glass', 0x564a3a)
GRILLE = material('plain:juke-grille', 0x6a5232)
WOODJ = material('plank:juke-dark', 0x33201a)

C = .278                    # the arch's middle: the capitals' top, the half-moon's floor
HW = .146                   # the cabinet's half width (its sides)
BACK, FRONT = -.08, .085    # the cabinet's back and its front face (the columns stand proud of it)
COL0, COL1 = .075, .11      # the brass columns and arch: from, to (z)
IN0, IN1 = .093, .106       # the inner brass strip (x at the columns, radius round the arch)
OUT0, OUT1 = .134, .148     # the outer brass strip
TUBE, TR = .12, .0125       # the blood tube's line and its radius
TZ = .093                   # its axis, in z
FOOT = .098                 # the feet's top: where the columns begin
MOON = .076                 # the half-moon opening's radius
WX, WY0, WY1 = .05, .232, .266      # the window's hole: half width, bottom, top
WIN_Z = .055                # the window box's back, where the amber light is


# ---- helpers -----------------------------------------------------------------------------------
def ztube(label, pts, r, mat, sides=8):
    """A tube along a path in (or near) a plane facing z, its rings framed off z so a path that
    turns vertical does not twist (geom.tube flips there)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((0, 0, 1)))
        u = u.normalized() if u.length > 1e-4 else Vector((1, 0, 0))
        w = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(TAU * k / sides) + w * math.sin(TAU * k / sides)) * r)
                      for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    geom.emit(bm, mat, label)


def ptube(label, pts, radii, mat, sides=8):
    """A tube along a 3D path with its rings carried along (parallel transport), for the horn's
    neck, which turns from straight up to forward."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    radii = radii if isinstance(radii, (list, tuple)) else [radii] * n
    bm = bmesh.new()
    rings = []
    u = None
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if u is None:
            u = Vector((1, 0, 0)) - t * t.x
        else:
            u = u - t * u.dot(t)
        u.normalize()
        w = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(TAU * k / sides) + w * math.sin(TAU * k / sides)) * radii[i])
                      for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    geom.emit(bm, mat, label)


def bubbles(label, centres, mat=BUBBLE):
    """Several little beads as ONE piece: each glowing emit is a part of its own, so a tube's
    bubbles go together rather than a part each."""
    bm = bmesh.new()
    for c, r in centres:
        res = bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=4, radius=r)
        bmesh.ops.translate(bm, vec=Vector(c), verts=res['verts'])
    geom.emit(bm, mat, label)


def rivet(at, r=.0045, axis='z', s=1):
    """A domed rivet head on a face looking along +z, or along s*x (axis='x')."""
    tilt, roll = (PI / 2, 0) if axis == 'z' else (0, -s * PI / 2)
    disc('rivet', at, r, .003, IRON, sides=5, tilt=tilt, roll=roll, top=r * .55)


def arc(r, a0, a1, n, z):
    return [(r * math.cos(a0 + (a1 - a0) * i / n), C + r * math.sin(a0 + (a1 - a0) * i / n), z) for i in range(n + 1)]


# ---- the cabinet ---------------------------------------------------------------------------------
def cabinet():
    # The body under the arch, planked, between and behind the columns.
    # The body under the arch, and its front skin round the window's hole (the window is a box let
    # into the face, so the record can lie in it).
    span('jukebox body', -HW, HW, .004, C, BACK, WIN_Z, WOODJ, bevel=.004)
    for x0, x1, y0, y1 in ((-HW, HW, .004, WY0), (-HW, HW, WY1, C), (-HW, -WX, WY0, WY1), (WX, HW, WY0, WY1)):
        span('jukebox face', x0, x1, y0, y1, WIN_Z - .002, FRONT, WOODJ)
    # The arch: a solid half-round behind the half-moon's recess, and a ring in front round it.
    prism('jukebox arch', [(HW * math.cos(PI * i / 20), C + HW * math.sin(PI * i / 20)) for i in range(21)],
          -.02 - BACK, WOODJ, M((0, 0, (BACK - .02) / 2)))
    band('jukebox arch front', 0, C, .082, HW, 0, PI, 14, FRONT + .02, WOODJ, Matrix.Translation((0, 0, (FRONT - .02) / 2)))
    # The recess itself: sooty at the back so the turntable shows against it.
    prism('jukebox recess', [(.086 * math.cos(PI * i / 12), C + .086 * math.sin(PI * i / 12)) for i in range(13)],
          .004, SOOT, M((0, 0, -.018)))
    # Plank seams down the face under the window.
    for x in (-.047, .047):
        span('jukebox seam', x - .002, x + .002, .006, .222, FRONT, FRONT + .002, SOOT)
    span('jukebox seam', -.093, .093, .222, .226, FRONT, FRONT + .002, SOOT)
    span('jukebox seam', -.093, .093, .03, .034, FRONT, FRONT + .002, SOOT)
    # The side panels: brass along the back edge (up and over the top), a brass band at the arch's
    # height, and a porthole each side.
    for s in (-1, 1):
        a, b = sorted((s * HW, s * (HW + .004)))
        span('jukebox back strip', a, b, .0, C, BACK, BACK + .012, BRASS)
        span('jukebox side band', a, b, C - .01, C, BACK, COL0, BRASS)
        side_porthole(s)
    band('jukebox back strip arch', 0, C, HW - .01, HW + .004, 0, PI, 14, .012, BRASS,
         Matrix.Translation((0, 0, BACK + .006)))


def side_porthole(s):
    x = s * HW
    with frame(M((x, .168, .002), roll=-s * PI / 2)):
        # In this frame the porthole's axis is +y (out of the side).
        disc('side porthole glass', (0, 0, 0), .032, .002, PORTGLASS, sides=16)
        torus('side porthole', (0, .004, 0), .038, .0085, BRASS, seg=18, sides=5)


# ---- the feet, the columns and the arch in brass, with the blood running through them -----------
def feet():
    for s in (-1, 1):
        x0, x1 = sorted((s * .089, s * .15))
        span('jukebox foot', x0, x1, 0, FOOT, BACK - .004, .108, DARK, bevel=.007)
        for y in (.024, .06):
            a, b = sorted((s * .085, s * .154))
            span('foot strap', a, b, y - .007, y + .007, BACK - .008, .112, IRON, bevel=.002)
            for x in (.1, .141):
                rivet((s * x, y, .1135))
            rivet((s * .1545, y, .08), axis='x', s=s)


def columns():
    for s in (-1, 1):
        # Inner strip whole; the outer one open along the side, so the blood shows from there too.
        a, b = sorted((s * IN0, s * IN1))
        span('column inner', a, b, FOOT, C - .01, COL0, COL1, BRASS)
        a, b = sorted((s * OUT0, s * OUT1))
        span('column outer', a, b, FOOT, C - .01, COL0, TZ - .007, BRASS)
        span('column outer', a, b, FOOT, C - .01, TZ + .008, COL1, BRASS)
        a, b = sorted((s * IN1, s * OUT0))
        span('column channel', a, b, FOOT, C - .01, COL0, COL0 + .006, SOOT)
        # The tube's foot in a brass cup, the tube in two lengths, bubbles in each.
        x = s * TUBE
        disc('tube cup', (x, FOOT, TZ), .016, .012, BRASS, sides=8)
        ys = (FOOT + .008, .19, C - .004)
        for i in range(2):
            ztube('blood tube', [(x, ys[i], TZ), (x, ys[i + 1], TZ)], TR, BLOOD, sides=8)
            beads = [(.118 + .03 * i + .005 * s, .003), (.13 + .03 * i, .0045), (.15 + .035 * i, .0035)] if i == 0 else \
                    [(.205, .004), (.228, .003), (.25, .0045)]
            bubbles('blood bubble', [((x + s * .004 * ((k % 2) * 2 - 1), y, TZ + TR - r * .4), r)
                                     for k, (y, r) in enumerate(beads)])
        # The capital where column meets arch: a brass collar round it all.
        a, b = sorted((s * (IN0 - .006), s * (OUT1 + .004)))
        span('column capital', a, b, C - .014, C + .001, COL0 - .006, COL1 + .004, BRASS, bevel=.002)


def arch():
    m = Matrix.Translation((0, 0, (COL0 + COL1) / 2))
    band('arch inner', 0, C, IN0, IN1, 0, PI, 20, COL1 - COL0, BRASS, m)
    band('arch outer', 0, C, OUT0, OUT1, 0, PI, 20, COL1 - COL0, BRASS, m)
    band('arch channel', 0, C, IN1 - .001, OUT0 + .001, 0, PI, 12, .006, SOOT, Matrix.Translation((0, 0, COL0 + .003)))
    # The tube round the arch, in four lengths, each with its own bubbles.
    for q in range(4):
        a0, a1 = PI * q / 4, PI * (q + 1) / 4
        ztube('blood arch', arc(TUBE, a0 - .01, a1 + .01, 5, TZ), TR, BLOOD, sides=8)
        beads = []
        for k, (f, r) in enumerate(((.2, .0035), (.5, .0045), (.78, .003))):
            a = a0 + (a1 - a0) * (f + .07 * ((q + k) % 2))
            rr = TUBE + .004 * (1 if (q + k) % 2 else -1)
            beads.append(((rr * math.cos(a), C + rr * math.sin(a), TZ + TR - r * .4), r))
        bubbles('blood bubble', beads)
    # The half-moon's own brass rim.
    band('moon rim', 0, C, MOON, MOON + .009, 0, PI, 14, .018, BRASS, Matrix.Translation((0, 0, FRONT + .002)))


def medallion():
    y, z = .404, COL1
    disc('medallion', (0, y, z - .004), .034, .012, GOLD, sides=14, tilt=PI / 2)
    torus('medallion rim', (0, y, z + .008), .031, .0035, GOLDHI, seg=14, sides=4, tilt=PI / 2)
    f = z + .008
    # Crossbones behind the skull, knuckled at both ends.
    for sx in (-1, 1):
        a = (-sx * .022, y - .018, f + .002)
        b = (sx * .022, y + .012, f + .002)
        rod('crossbone', a, b, .0032, GOLDHI, sides=5)
        for p in (a, b):
            for k in (-1, 1):
                ball('bone knuckle', (p[0] + k * .003 * sx, p[1] + k * .003, p[2]), .0038, GOLDHI, seg=5, rings=3)
    # The skull in relief, gold on gold.
    ball('skull', (0, y + .004, f + .003), (.0145, .013, .007), GOLDHI, seg=8, rings=5)
    hull('skull jaw', [(sx * .008, y - .012, f + .002) for sx in (-1, 1)] + [(sx * .011, y - .003, f + .002) for sx in (-1, 1)]
         + [(sx * .007, y - .011, f + .007) for sx in (-1, 1)] + [(sx * .01, y - .003, f + .008) for sx in (-1, 1)], GOLDHI)
    for sx in (-1, 1):
        disc('skull eye', (sx * .0055, y + .002, f + .0085), .0038, .002, BLACK, sides=6, tilt=PI / 2)
    prism('skull nose', [(0, .003), (-.002, -.002), (.002, -.002)], .002, BLACK, M((0, y - .004, f + .0095)))


def turntable():
    """In the half-moon: a deck, a dark platter with a record on it, and the tone arm."""
    y0 = C
    span('turntable deck', -.064, .064, y0, y0 + .01, -.018, .072, DARK, bevel=.002)
    span('turntable lip', -.064, .064, y0 + .002, y0 + .008, .072, .075, BRASS)
    disc('platter', (0, y0 + .01, .03), .05, .006, IRON, sides=18)
    disc('platter record', (0, y0 + .016, .03), .045, .002, BLACK, sides=18)
    disc('platter label', (0, y0 + .018, .03), .013, .0015, VELVET, sides=10)
    rod('spindle', (0, y0 + .018, .03), (0, y0 + .024, .03), .002, BRASS, sides=4)
    disc('tonearm post', (.058, y0 + .01, -.004), .007, .016, IRON, sides=6)
    rod('tonearm', (.058, y0 + .024, -.004), (.024, y0 + .024, .05), .0024, BRASS, sides=4)
    box('tonearm head', (.022, y0 + .021, .053), (.01, .006, .012), IRON, turn=.55)


def window():
    """The little window under the half-moon, amber lit, a record lying in it."""
    x0, x1, y0, y1 = -WX, WX, WY0, WY1
    prism('window glow', [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], .003, AMBER, M((0, 0, WIN_Z + .0015)))
    # The frame: four brass bars standing off the face.
    e = .007
    for a, b, c, d in ((x0 - e, x1 + e, y0 - e, y0), (x0 - e, x1 + e, y1, y1 + e),
                       (x0 - e, x0, y0, y1), (x1, x1 + e, y0, y1)):
        span('window frame', a, b, c, d, FRONT, FRONT + .014, BRASS, bevel=.0015)
    # A record lying in the bottom of the box, tipped up to the glass, with its red label.
    with frame(M((0, y0 + .006, .072), tilt=.9)):
        disc('record', (0, 0, 0), .03, .003, BLACK, sides=16)
        disc('record label', (0, .003, 0), .008, .001, VELVET, sides=8)


def porthole():
    """The speaker: a brass porthole with rivets round it and a diamond grille behind."""
    cy, z = .141, FRONT
    disc('speaker back', (0, cy, z), .054, .003, BLACK, sides=16, tilt=PI / 2)
    rg = .052
    for sgn in (-1, 1):
        for k in range(-4, 5):
            o = k * .0115
            L = 2 * math.sqrt(max(rg * rg - o * o, 0))
            if L < .01:
                continue
            a = sgn * PI / 4
            px, py = -o * math.sin(a), o * math.cos(a)
            box('grille wire', (px, cy + py, z + .005 + (.0012 if sgn > 0 else 0)), (L, .003, .0022), GRILLE, roll=a)
    torus('porthole inner', (0, cy, z + .006), .054, .0055, BRASS, seg=20, sides=5, tilt=PI / 2)
    torus('porthole ring', (0, cy, z + .007), .066, .0095, BRASS, seg=24, sides=6, tilt=PI / 2)
    for k in range(16):
        a = TAU * k / 16 + PI / 16
        rivet((.066 * math.cos(a), cy + .066 * math.sin(a), z + .016), r=.0035)


def brackets():
    """Iron corner brackets at the four corners of the face between the columns."""
    w, L, t = .012, .04, .004
    for s in (-1, 1):
        cx = s * (IN0 - .001)
        for cy, up in ((.222, -1), (.048, 1)):
            # One arm along the column, one across the face, meeting in the corner.
            xa, xb = sorted((cx, cx - s * w))
            ya, yb = sorted((cy, cy + up * L))
            span('bracket', xa, xb, ya, yb, FRONT, FRONT + t, IRON, bevel=.001)
            xa, xb = sorted((cx, cx - s * L))
            ya, yb = sorted((cy, cy + up * w))
            span('bracket', xa, xb, ya, yb, FRONT, FRONT + t, IRON, bevel=.001)
            for dx, dy in ((w / 2, w / 2), (w / 2, L - .008), (L - .008, w / 2)):
                rivet((cx - s * dx, cy + up * dy, FRONT + t), r=.003)


def horn():
    """The gramophone: a motor box on the back behind the top right, its crank, and the neck
    running up out of it into a faceted brass bell that opens forward and up over the right side."""
    span('motor box', .015, .105, .25, .335, -.108, BACK + .002, DARK, bevel=.005)
    span('motor band', .012, .108, .318, .326, -.11, BACK + .002, IRON)
    disc('motor drum', (.06, .335, -.094), .014, .018, VELVET, sides=8)
    # The crank on the box's right side.
    disc('crank hub', (.105, .29, -.094), .008, .006, IRON, sides=6, roll=-PI / 2)
    rod('crank arm', (.111, .29, -.094), (.111, .262, -.1), .003, IRON, sides=4)
    rod('crank handle', (.111, .262, -.1), (.125, .262, -.1), .004, BLACK, sides=5)
    # The bell's axis and where it starts.
    d = Vector((.38, .58, .72)).normalized()
    base = Vector((.086, .418, -.078))
    neck = [(.06, .345, -.094), (.062, .372, -.096), (.068, .395, -.095), tuple(base - d * .018), tuple(base)]
    ptube('horn neck', neck, [.011, .011, .011, .0115, .012], BRASS, sides=8)
    # An iron bracket from the box up to a clamp round the neck.
    rod('horn stay', (.098, .335, -.104), (.075, .38, -.104), .003, IRON, sides=4)
    torus('horn clamp', (.064, .385, -.0955), .0122, .0026, IRON, seg=8, sides=3)
    q = Vector((0, 1, 0)).rotation_difference(d).to_matrix().to_4x4()
    with frame(Matrix.Translation(base) @ q):
        lathe('horn bell', [(.0115, 0), (.013, .02), (.016, .04), (.022, .058), (.031, .074), (.043, .088),
                            (.054, .098), (.058, .102), (.053, .101), (.043, .093), (.031, .08), (.02, .064),
                            (.014, .048), (0, .044)], BRASS, sides=10)
        disc('horn throat', (0, .05, 0), .016, .003, SOOT, sides=10)
        torus('horn rim', (0, .102, 0), .057, .0035, BRASS, seg=10, sides=4)


def build():
    cabinet()
    feet()
    columns()
    arch()
    medallion()
    turntable()
    window()
    porthole()
    brackets()
    horn()
