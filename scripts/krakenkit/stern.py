"""A galleon's stern (transom) as the Salty Kraken's back bar: a cabinet of six doors, three deep
arched niches glowing purple, teal, purple and full of bottles, rope columns with skull sconces,
five cabin windows, a thick cornice and a carved taffrail with a kraken and two scroll volutes,
and a stern lantern on each top corner.

Frame: origin on the floor in the middle, the back flat at z = -0.15 against the rock wall, the
cabinet's front at +0.15 (nothing forward of +0.17 below y = 0.5: the barkeeper walks there).
The niche backs are named `niche glow west|middle|east` because pirate-tavern.js dims them by name.

Bottles and goblets are this module's own cheaper turnings (four or five rings, no bottom pole):
geom's are 110-150 triangles each, and twenty-seven of them were most of the budget.
"""
import math
from mathutils import Matrix
import geom
from geom import (PI, TAU, M, frame, span, box, rod, disc, ball, lathe, prism, hull, tube, band, arc_pts,
                  lantern, gem, coin, BONE, WAX, SOCKET,
                  DARK, WOOD, PANEL, CARVED, BARW, OAK, BRASS, GOLD, GOLDHI, IRON, BLACK, GLASS, PARCH,
                  BOTTLES, FLAG)

ASSET = 'civic_kraken_stern'

BACK, FACE, CAB = -.15, .05, .15     # the wall, the upper stern's face, the cabinet's front
NB = -.10                            # the niches' back wall (0.15 deep)
LEDGE0, SILL = .28, .33              # the counter ledge; its top is the niches' floor
R, SPRING = .30, .65                 # niche radius and springing: crowns at 0.95
NTOP = 1.02                          # top of the niche zone, where the moulding band starts
BAND1 = 1.07                         # the moulding band's top, the window band's foot
CORN0, CORN = 1.32, 1.45             # the cornice
NICHES = [(-1.06, 'plain:niche-purple', 'west'), (0.0, 'plain:niche-teal', 'middle'),
          (1.06, 'plain:niche-purple', 'east')]


def hw(y):
    """Half width of the body at height y: the tumblehome, 0.1 in over the height of the stern."""
    return 1.8 - .1 * max(0.0, y - SILL) / (CORN - SILL)


# ---- cheaper turnings ---------------------------------------------------------------------------
SHAPES = {
    'wine': ([(.019, 0), (.019, .05), (.007, .068), (.007, .09)], 5),
    'rum': ([(.023, 0), (.023, .036), (.008, .05), (.008, .066)], 5),
    'gin': ([(.022, 0), (.022, .062), (.008, .074), (.008, .086)], 4),
    'flask': ([(.013, 0), (.024, .018), (.02, .036), (.007, .048), (.007, .064)], 5),
    'jug': ([(.02, 0), (.026, .02), (.025, .045), (.01, .066), (.011, .074)], 5),
}


def bottle(kind, at, mat, s=1.3, label=False, turn=0.0):
    prof, sides = SHAPES[kind]
    phase = PI / 4 if sides == 4 else 0.0
    x, y, z = at
    lathe('bottle', prof, 'plain:stoneware' if kind == 'jug' else mat, at=at, sides=sides, phase=phase,
          scale=s, turn=turn)
    top = prof[-1][1] * s
    if kind == 'jug':
        with frame(M(at, turn)):
            geom.torus('jug handle', (.022 * s, .045 * s, 0), .014 * s, .004 * s, 'plain:stoneware', seg=4,
                       sides=3, tilt=PI / 2, arc=PI, start=-PI / 2)
    else:
        rod('bottle cork', (x, y + top - .002, z), (x, y + top + .01 * s, z), prof[-1][0] * .8 * s, 'plain:cork', sides=3)
    if label and kind in ('wine', 'rum', 'gin'):
        r = prof[0][0] * 1.04 * s
        disc('bottle label', (x, y + .014 * s, z), r, .018 * s, PARCH, sides=sides, turn=turn + phase)


def goblet(at, s=1.3, mat=GOLD):
    lathe('goblet', [(.02, 0), (.005, .01), (.005, .026), (.018, .034), (.023, .06)],
          mat, at=at, sides=5, scale=s)


def shelf_items(c, y, z, items, seed):
    """A row of bottles standing on a shelf: (kind, dx, colour index, label)."""
    for i, (kind, dx, ci, lab) in enumerate(items):
        bottle(kind, (c + dx, y, z), BOTTLES[ci % len(BOTTLES)], s=1.5 + .08 * ((seed + i) % 3 - 1), label=lab,
               turn=(seed * 7 + i * 3) % 5 * .6)


def ship_in_bottle(at):
    """Lying on its side on a cradle. The glass is opaque in the game, so the bottle is cut along its
    axis and only the back half is there: the ship stands against it and reads from the front."""
    with frame(M(at)):
        for sx in (-1, 1):
            span('ship bottle cradle', sx * .09 - .012, sx * .09 + .012, 0, .03, -.035, .03, DARK)
        ay = .08
        pts = []
        for x, r in ((-.16, .052), (.05, .052), (.1, .03), (.12, .017)):
            for k in range(7):       # the far half round the axis (z <= 0), x along the bottle
                a = PI + PI * k / 6
                pts.append((x, ay + r * math.cos(a), r * math.sin(a)))
        hull('ship bottle glass', pts, 'plain:bottle-clear')
        rod('ship bottle neck', (.11, ay, 0), (.165, ay, 0), .017, 'plain:bottle-clear', sides=6)
        rod('ship bottle cork', (.16, ay, 0), (.185, ay, 0), .013, 'plain:cork', sides=5)
        with frame(M((-.03, ay - .035, .012))):
            hull('ship hull', [(-.075, .0, -.012), (-.075, .0, .012), (.07, .0, 0), (-.07, .025, -.016),
                               (-.07, .025, .016), (.08, .028, 0), (.0, -.01, 0)], 'plain:bottle-brown')
            for mx, h in ((-.03, .07), (.02, .085)):
                rod('ship mast', (mx, .02, 0), (mx, h, 0), .002, DARK, sides=3)
                prism('ship sail', [(mx - .02, .032), (mx + .02, .032), (mx + .016, h - .01), (mx - .016, h - .01)],
                      .003, PARCH, Matrix.Translation((0, 0, .004)))
            prism('ship flag', [(.02, .085), (.042, .08), (.02, .074)], .002, FLAG)


# ---- the parts ------------------------------------------------------------------------------------
def cabinet(STERN, POST):
    span('plinth', -1.8, 1.8, 0, .045, BACK, .165, POST, bevel=.006)
    span('cabinet', -1.78, 1.78, .045, LEDGE0, BACK, CAB, BARW)
    span('ledge', -1.8, 1.8, LEDGE0, SILL, BACK, .168, OAK, bevel=.012)
    span('ledge bead', -1.79, 1.79, LEDGE0 - .012, LEDGE0, BACK, CAB + .008, GOLD)
    for c, _, _ in NICHES:
        for sx in (-1, 1):
            x0, x1 = sorted((c + sx * .012, c + sx * .3))
            span('cabinet door', x0, x1, .07, .255, CAB - .004, CAB + .006, PANEL)
            span('cabinet door panel', x0 + .04, x1 - .04, .1, .225, CAB + .004, CAB + .012, WOOD)
            ball('cabinet knob', (c + sx * .04, .165, CAB + .01), .0075, BRASS, seg=4, rings=2)
    # Stiles between the pairs, under the piers, with a gilt lozenge.
    for x in (-1.58, -.53, .53, 1.58):
        span('cabinet stile', x - .06, x + .06, .065, .26, CAB - .004, CAB + .008, DARK)
        hull('cabinet lozenge', [(x, .2, CAB + .008), (x, .12, CAB + .008), (x - .03, .16, CAB + .008), (x + .03, .16, CAB + .008),
                                 (x, .16, CAB + .016)], GOLD)


def body(STERN, POST):
    # The back slab all the way up to the cornice, the niches' back wall included.
    prism('stern back', [(-hw(SILL), SILL), (hw(SILL), SILL), (hw(CORN0), CORN0), (-hw(CORN0), CORN0)],
          NB - BACK, STERN, Matrix.Translation((0, 0, (BACK + NB) / 2)))
    zm = Matrix.Translation((0, 0, (NB + FACE) / 2))
    d = FACE - NB
    # Piers: two slanted outer ones, two straight inner ones. Their sides are the niches' walls.
    for sx in (-1, 1):
        e = NICHES[1 + sx][0] + sx * R
        out = [(e, SILL), (sx * hw(SILL), SILL), (sx * hw(NTOP), NTOP), (e, NTOP)]
        prism('stern pier', out, d, STERN, zm)
        a, b = sorted((sx * R, NICHES[1 + sx][0] - sx * R))
        prism('stern pier', [(a, SILL), (b, SILL), (b, NTOP), (a, NTOP)], d, STERN, zm)
    for c, mat, name in NICHES:
        # The vault is the underside of the spandrels: two fans from the top corners.
        arcr = arc_pts(c, SPRING, R, R, 0, PI / 2, 4)
        arcl = arc_pts(c, SPRING, R, R, PI, PI / 2, 4)
        prism('niche spandrel', [(c + R, NTOP)] + arcr + [(c, NTOP)], d, STERN, zm)
        prism('niche spandrel', [(c - R, NTOP)] + arcl + [(c, NTOP)], d, STERN, zm)
        # What glows: the back of the niche, arched to its shape.
        glow = [(c - R, SILL), (c + R, SILL)] + arc_pts(c, SPRING, R, R, 0, PI, 10)
        prism(f'niche glow {name}', glow, .004, mat, Matrix.Translation((0, 0, NB + .003)))
        # The archivolt: a carved ring with a gilt bead inside it, jambs down to the ledge, a keystone.
        band('niche arch', c, SPRING, R, R + .05, 0, PI, 5, .03, CARVED, Matrix.Translation((0, 0, FACE + .015)))
        tube('niche bead', [(x, y, FACE + .034) for x, y in arc_pts(c, SPRING, R + .004, R + .004, 0, PI, 7)], .008, GOLD, sides=3)
        for sx in (-1, 1):
            x0, x1 = sorted((c + sx * R, c + sx * (R + .05)))
            span('niche jamb', x0, x1, SILL, SPRING, FACE, FACE + .03, CARVED)
            x0, x1 = sorted((c + sx * (R - .004), c + sx * (R + .012)))
            span('niche jamb bead', x0, x1, SILL, SPRING, FACE + .028, FACE + .04, GOLD)
        hull('niche keystone', [(c + sx * .026, SPRING + R - .012, z) for sx in (-1, 1) for z in (FACE, FACE + .045)]
             + [(c + sx * .04, SPRING + R + .058, z) for sx in (-1, 1) for z in (FACE, FACE + .045)], GOLDHI)
        # Two shelves; the ledge is the floor.
        for y in (.52, .71):
            half = R if y < SPRING else math.sqrt(R * R - (y + .016 - SPRING) ** 2)
            span('niche shelf', c - half, c + half, y, y + .016, NB, FACE - .005, OAK)
            if y < SPRING:
                span('niche shelf lip', c - half, c + half, y - .008, y + .02, FACE - .012, FACE, GOLD)
    # The window band, under the moulding and up to the cornice.
    prism('stern band', [(-hw(NTOP), NTOP), (hw(NTOP), NTOP), (hw(CORN0), CORN0), (-hw(CORN0), CORN0)], d, STERN, zm)
    # Moulding band over the niches.
    w = hw(NTOP) + .02
    span('moulding', -w, w, NTOP, BAND1, BACK, FACE + .035, POST, bevel=.008)
    span('moulding bead', -w + .01, w - .01, NTOP + .004, NTOP + .016, BACK, FACE + .042, GOLD)
    # Five cabin windows.
    wy = (BAND1 + CORN0) / 2
    for i in range(5):
        x = (i - 2) * .66
        # A dark frame plate, the glass standing on it, a cross of mullions, a lintel and a sill.
        span('window frame', x - .072, x + .072, wy - .072, wy + .072, FACE - .005, FACE + .012, POST)
        box('stern window', (x, wy, FACE + .015), (.1, .1, .006), GLASS)
        span('window mullion', x - .007, x + .007, wy - .05, wy + .05, FACE + .01, FACE + .024, POST)
        span('window mullion', x - .05, x + .05, wy - .007, wy + .007, FACE + .01, FACE + .024, POST)
        span('window sill', x - .085, x + .085, wy - .09, wy - .072, FACE - .005, FACE + .03, CARVED)
    # The cornice: two steps, the upper one proud, a gilt bead under it.
    w = hw(CORN0) + .03
    span('cornice', -w, w, CORN0, 1.375, BACK, FACE + .045, POST, bevel=.01)
    span('cornice bead', -w + .005, w - .005, 1.366, 1.382, BACK, FACE + .058, GOLD)
    w = hw(CORN) + .06
    span('cornice', -w, w, 1.375, CORN, BACK, FACE + .08, POST, bevel=.012)
    # Quarter timbers: thick dark posts following the slanted sides.
    for sx in (-1, 1):
        pts = []
        for y in (SILL, CORN0):
            for x in (hw(y) - .12, hw(y)):
                for z in (BACK, FACE + .05):
                    pts.append((sx * x, y, z))
        hull('quarter timber', pts, POST)
        span('quarter timber foot', sx * 1.8 - .075 - sx * .075, sx * 1.8 + .075 - sx * .075, SILL, SILL + .05, BACK, FACE + .065, OAK)


def columns():
    for x, skulled in ((-1.51, False), (-.53, True), (.53, True), (1.51, False)):
        z = .10
        disc('column base', (x, SILL, z), .062, .04, GOLD, sides=5, top=.05)
        twist_column(x, z, SILL + .04, SPRING - .03, .05, CARVED)
        disc('column capital', (x, SPRING - .03, z), .05, .03, GOLD, sides=5, top=.066)
        if skulled:
            with frame(M((x, SPRING + .008, z + .005), 0, scale=1.25)):
                lathe('sconce dish', [(0, -.01), (.045, -.004), (.05, .006), (0, .004)], IRON, sides=6)
                skull_lamp()


def twist_column(x, z, y0, y1, r, mat, lobes=3, turns=1.0, levels=6):
    """A carved rope column as one twisted solid: a ring of 2 x `lobes` corners, the strands' crowns
    and the grooves between them, turned a little more at every level. geom.rope_column's two
    wound tubes were 200 triangles a column; this reads the same at bar distance for 90."""
    n = lobes * 2
    prof = []
    for i in range(levels + 1):
        prof.append(i / levels)
    import bmesh
    bm = bmesh.new()
    rings = []
    for t in prof:
        a0 = t * turns * TAU
        rings.append([bm.verts.new((x + (r if k % 2 == 0 else r * .62) * math.cos(a0 + TAU * k / n), y0 + (y1 - y0) * t,
                                    z + (r if k % 2 == 0 else r * .62) * math.sin(a0 + TAU * k / n))) for k in range(n)])
    for A, B in zip(rings, rings[1:]):
        for k in range(n):
            bm.faces.new((A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    geom.emit(bm, mat, 'rope column')


def skull_lamp():
    """A candle burning on a skull whose eyes burn too: geom.skull and skull_lamp_top drawn with
    fewer pieces (no single teeth, two wax runs), because two of them were 1300 triangles, a fifth
    of the whole stern. Same frame as geom's: jaw on y = 0, facing +z."""
    ball('skull cranium', (0, .062, -.004), (.04, .042, .047), BONE, seg=8, rings=5)
    ball('skull face', (0, .034, .018), (.03, .026, .028), BONE, seg=6, rings=4)
    hull('skull jaw', [(sx * .017, 0, .034) for sx in (-1, 1)] + [(sx * .028, .012, -.006) for sx in (-1, 1)]
         + [(sx * .027, .026, .012) for sx in (-1, 1)] + [(sx * .016, .02, .042) for sx in (-1, 1)], BONE)
    span('skull teeth', -.014, .014, .017, .03, .036, .045, BONE)
    span('skull bite', -.015, .015, .022, .025, .04, .0465, BLACK)
    for sx in (-1, 1):
        disc('skull socket', (sx * .015, .046, .028), .0125, .014, BLACK, sides=6, tilt=PI / 2)
        disc('eye', (sx * .015, .046, .0405), .0078, .002, SOCKET, sides=5, tilt=PI / 2)
    prism('skull nose', [(0, .009), (-.006, -.004), (.006, -.004)], .012, BLACK, Matrix.Translation((0, .033, .041)))
    y0 = .098
    rod('candle', (0, y0, -.004), (0, y0 + .045, -.004), .011, WAX, top=.01, sides=5)
    rod('candle wick', (0, y0 + .045, -.004), (0, y0 + .051, -.004), .0015, BLACK, sides=3)
    geom.flame((0, y0 + .048, -.004), 1.2)
    for a, l in ((-.6, .03), (-2.1, .022)):
        ball('wax run', (.03 * math.cos(a), y0 - .012, -.004 - .024 * math.sin(a)), (.008, l, .008), WAX, seg=4, rings=3)


def niche_contents():
    zb, zg = -.035, -.005
    # West: four on the floor, goblets and a flask on the middle shelf, three on the top one.
    c = NICHES[0][0]
    shelf_items(c, SILL, zb, [('wine', -.17, 0, True), ('gin', -.02, 3, False), ('jug', .16, 0, False)], 1)
    goblet((c - .12, .536, zg), s=1.4, mat=GOLDHI)
    goblet((c + .06, .536, zg), s=1.25)
    shelf_items(c, .726, zb, [('wine', -.1, 4, False), ('rum', .08, 1, True)], 3)
    # Middle: the ship in a bottle between two goblets, bottles below and above.
    c = NICHES[1][0]
    shelf_items(c, SILL, zb, [('rum', -.17, 1, False), ('wine', -.02, 0, True), ('flask', .15, 3, False)], 4)
    ship_in_bottle((c - .01, .536, -.03))
    goblet((c - .245, .536, zg), s=1.2, mat=GOLDHI)
    goblet((c + .245, .536, zg), s=1.2, mat=GOLDHI)
    shelf_items(c, .726, zb, [('gin', -.1, 4, False), ('gin', .1, 1, True)], 5)
    # East: gin and a jug on the floor, a chalice with a ruby, three on top.
    c = NICHES[2][0]
    shelf_items(c, SILL, zb, [('gin', -.17, 1, True), ('wine', -.02, 3, False), ('rum', .15, 0, False)], 6)
    goblet((c + .1, .536, zg), s=1.6, mat=GOLDHI)
    gem((c + .1, .536 + .085, zg), .014, which='plain:ruby')
    shelf_items(c, .726, zb, [('flask', -.09, 0, False), ('wine', .1, 4, True)], 8)
    for i, dx in enumerate((.19, .22, .2)):
        coin((c + dx, .536 + .002 + .004 * i, zg), 1.2)


RAIL = 1.3                           # the taffrail board's half width; the volutes take it on


def ztube(label, pts, radii, mat, sides=5):
    """geom.tube with its rings framed off the z axis instead of y: along a curve lying in the
    stern's own plane (a volute, a tentacle curling up) geom's frame flips where the curve turns
    vertical and the tube comes out twisted into a cog."""
    import bmesh
    from mathutils import Vector
    pts = [Vector(p) for p in pts]
    n = len(pts)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((0, 0, 1)))
        u = u.normalized() if u.length > 1e-4 else Vector((1, 0, 0))
        w = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(TAU * k / sides) + w * math.sin(TAU * k / sides)) * radii[i])
                      for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    geom.emit(bm, mat, label)


def smooth(ctrl, n):
    """n points on a Catmull-Rom curve through the control points, ends included."""
    P = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    for i in range(n):
        u = i / (n - 1) * (len(ctrl) - 1)
        k = min(int(u), len(ctrl) - 2)
        t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(tuple(.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def rail_y(x):
    """The top of the taffrail: a gentle arch rising to the middle."""
    return 1.545 + .075 * (1 - (x / RAIL) ** 2)


def taffrail(KRAKEN):
    xs = [-RAIL + 2 * RAIL * i / 10 for i in range(11)]
    outline = [(-RAIL, CORN), (RAIL, CORN)] + [(x, rail_y(x)) for x in xs[::-1]]
    prism('taffrail', outline, .05, PANEL, Matrix.Translation((0, 0, -.045)))
    tube('taffrail bead', [(x, rail_y(x) + .004, -.02) for x in xs], .014, GOLD, sides=4)
    for x in (-.8, .8):                 # gilt rosettes on the board, between the arms
        disc('taffrail rosette', (x, (CORN + rail_y(x)) / 2 + .01, -.02), .022, .012, GOLD, sides=5, tilt=PI / 2)
    # Scroll volutes at both ends, carrying on from the board and curling outward over the top,
    # tight enough that the turns touch and read as one carved coil.
    for sx in (-1, 1):
        R0 = .12
        cx, cy = sx * (RAIL + R0), rail_y(RAIL) + .005
        n = 16
        pts, radii = [], []
        for i in range(n + 1):
            t = i / n
            th = t * 1.6 * TAU
            r = R0 * (1 - .82 * t)
            a = PI - th
            pts.append((cx + sx * r * math.cos(a), cy + r * math.sin(a), -.02 + .03 * t))
            radii.append(.032 - .016 * t)
        ztube('scroll', pts, radii, KRAKEN, sides=4)
        disc('scroll eye', (cx, cy, -.01), .016, .03, GOLD, sides=5, tilt=PI / 2)


def arm(sx, path, base, KRAKEN, curl=.035):
    """A tentacle along `path` (x given for the east side), tapering, its tip rolled up in a curl."""
    pts = smooth([(sx * x, y, z) for x, y, z in path], 6)
    tx, ty, tz = pts[-1]
    for j in range(1, 4):
        a = 1.7 * PI * j / 3
        rr = curl * (1 - .45 * j / 3)
        pts.append((tx + sx * rr * math.sin(a), ty + curl - rr * math.cos(a), tz + .01 * j))
    m = len(pts)
    ztube('kraken arm', pts, [base * (1 - .8 * (i / (m - 1)) ** .8) + .005 for i in range(m)], KRAKEN, sides=5)


def kraken(KRAKEN):
    """Carved over the middle of the rail, leaning forward over the cornice, six arms out along it."""
    KZ, hy = .055, 1.6
    ball('kraken mantle', (0, hy + .07, KZ - .05), (.1, .095, .09), KRAKEN, seg=8, rings=5, tilt=.4)
    ball('kraken head', (0, hy, KZ), (.12, .085, .085), KRAKEN, seg=8, rings=5)
    ball('kraken brow', (0, hy + .03, KZ + .055), (.1, .026, .04), 'plain:rib', seg=6, rings=3)
    for sx in (-1, 1):
        ball('kraken eye', (sx * .047, hy + .004, KZ + .07), (.024, .026, .016), GOLDHI, seg=6, rings=4)
        ball('kraken pupil', (sx * .047, hy + .0, KZ + .085), (.008, .017, .004), BLACK, seg=4, rings=3)
        # Up along the rail's face, nearly to the volute.
        arm(sx, [(.07, hy - .01, .04), (.32, rail_y(.32) - .04, .02), (.6, rail_y(.6) - .015, .02),
                 (.86, rail_y(.86) - .05, .02), (1.06, rail_y(1.06) - .035, .025)], .046, KRAKEN, curl=.045)
        # Along the cornice top, forward of the rail.
        arm(sx, [(.06, hy - .05, .06), (.24, CORN + .04, .095), (.46, CORN + .03, .1), (.7, CORN + .036, .1)],
            .044, KRAKEN, curl=.036)
        # Over the cornice's front edge and down its face.
        arm(sx, [(.04, hy - .06, .08), (.13, CORN + .025, .14), (.2, CORN - .03, .16), (.27, 1.385, .165)],
            .038, KRAKEN, curl=.028)


def lanterns():
    for sx in (-1, 1):
        x, z = sx * 1.67, .0
        span('lantern plate', x - .05, x + .05, CORN, CORN + .012, z - .05, z + .05, IRON)
        rod('lantern post', (x, CORN + .01, z), (x, 1.5, z), .012, IRON, sides=5)
        lantern((x, 1.502 + .048 * 1.3, z), s=1.3)


def galleries(STERN, POST):
    """The quarter galleries, as a hint: a window box on each side face, with a sloped roof."""
    for sx in (-1, 1):
        y0, y1 = .9, 1.14
        xi = hw(y1) - .02
        x0, x1 = sorted((sx * xi, sx * 1.79))
        span('gallery', x0, x1, y0, y1, -.125, .005, STERN)
        hull('gallery corbel', [(sx * xi, y0, z) for z in (-.12, 0)] + [(sx * 1.79, y0, z) for z in (-.12, 0)]
             + [(sx * xi, y0 - .12, z) for z in (-.1, -.02)], POST)
        hull('gallery roof', [(sx * xi, y1 + .08, z) for z in (-.14, .02)] + [(sx * 1.8, y1 - .005, z) for z in (-.14, .02)]
             + [(sx * xi, y1 + .06, z) for z in (-.14, .02)] + [(sx * 1.8, y1 - .02, z) for z in (-.14, .02)], POST)
        gx = sx * 1.79
        box('gallery window', (gx + sx * .002, 1.02, -.06), (.006, .11, .08), GLASS)


def build():
    STERN = geom.material('plank:stern', 0x2a1f18)
    POST = geom.material('plain:post', 0x1d1511)
    cabinet(STERN, POST)
    body(STERN, POST)
    columns()
    niche_contents()
    KRAKEN = geom.material('plain:kraken', 0x9a6a3c)
    taffrail(KRAKEN)
    kraken(KRAKEN)
    lanterns()
    galleries(STERN, POST)
