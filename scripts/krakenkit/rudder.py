"""The house's sign: the blade of an old rudder, broken off below and split, hung from a dark beam
over the bar with a blue kraken painted on it. After the keeper's drawing
(refs/krakenkit/objecten/roer.jpg), the same sign twice.

The blade is five honey-brown planks standing side by side, each broken off at its own height, so
the lower edge is a row of splintered teeth running up to the right, and the left edge chipped and
ragged where the pintles tore out; one crack runs down from that edge. Iron straps cross the planks
from both edges and are bent round them, a knuckle where a pintle once turned, bolted through. The
kraken is paint: a flat mantle and eight tapered tentacles curling out over the planks, lying
barely proud of them, blue with teal on its crown and its suckers. Two iron brackets hang the blade
from the beam - a collar round the beam, a brass pin, a strap down over the blade's top - and a
scrolled wall bracket is left on the beam's west end from wherever it hung before. Two chains go up
from the collars; the long drop to the roof is the room's.

Frame: the painted face towards +z, centred on x and z, the lowest splinter on y = 0. The blade is
0.34 wide and 0.9 tall, the beam 0.5 long with its middle at BEAM_Y, the chains end at CHAIN_TOP.
The planks are `plain`: both plank sheets lay their boards along x on a face towards +z, which on a
standing board is across its grain.
"""
import math
from mathutils import Matrix, Vector
from geom import (PI, TAU, M, frame, box, span, rod, disc, ball, prism, tube, torus, rng, material,
                  BLACK, BRASS)
from skulllamp import chain, rivet

ASSET = 'civic_kraken_rudder'

HONEY = [material('plain:rudder-a', 0xa9733c), material('plain:rudder-b', 0x9a6632),
         material('plain:rudder-c', 0xb27d45)]
CRACK = material('plain:rudder-crack', 0x3a2414)
GRAIN = material('plain:rudder-grain', 0x80522a)
BEAMW = material('plank:rudder-beam', 0x4a2a20)
STRAP = material('plain:rudder-iron', 0x34353a)
BLUE = material('plain:kraken-blue', 0x2c5b8e)
TEAL = material('plain:kraken-teal', 0x3aa39c)

# ---- the numbers --------------------------------------------------------------------------------
W = .34                  # the blade across
TOP = .9                 # its top edge
T = .03                  # a plank's thickness
FACE = T / 2             # the painted face
N = 5                    # planks
PW = W / N
GAP = .0035
BEAM_Y = .962            # the beam's middle
BEAM_L, BEAM_H, BEAM_D = .5, .054, .06
CHAIN_TOP = round(BEAM_Y + .2, 4)
BRACKETS = (-.09, .1)    # where the two hanging brackets hold the blade (x)

# Where each plank broke off (the middle of its lower edge), from the west: longest on the west, the
# break running up to the east as in the drawing. The east plank is also cut in towards its foot.
BREAKS = [.012, .03, .06, .115, .2]


def teeth(x0, x1, base, g, n):
    """The broken lower edge of a plank, east to west (x1 to x0): splinters of different lengths with
    notches between, as (x, y) points."""
    pts = []
    for i in range(n + 1):
        t = 1 - i / n
        x = x0 + (x1 - x0) * t
        if 0 < i < n:
            x += g.uniform(-.25, .25) * (x1 - x0) / n
        y = base + (g.uniform(-.035, -.005) if i % 2 else g.uniform(.01, .04))
        pts.append((x, y))
    return pts


def plank(i, g):
    x0 = -W / 2 + i * PW + GAP / 2
    x1 = -W / 2 + (i + 1) * PW - GAP / 2
    base = BREAKS[i]
    pts = []
    # The east edge, top down. The east plank tapers in over its lower half.
    if i == N - 1:
        pts += [(x1, TOP), (x1, .4), (x1 - .008, .33), (x1 - .02, .27), (x1 - .028, .23)]
        bottom = teeth(x0, x1 - .03, base, g, 5)
    else:
        pts += [(x1, TOP)]
        bottom = teeth(x0, x1, base, g, 5)
    pts += bottom
    # The west edge, bottom up; the west plank's is ragged, chipped out where a pintle tore.
    if i == 0:
        for y in (.09, .15, .22, .29, .34, .4, .47, .55, .6, .66, .7, .76, .8, .84):
            d = g.uniform(0, .006)
            if .55 < y < .62:
                d += .018          # a chunk out of it
            if .76 < y < .82:
                d += .012
            pts.append((x0 + d, y))
    pts.append((x0, TOP))
    return pts


def lowest(outlines):
    """Stretch the planks' lower ends so the lowest splinter of all is on y = 0 (the teeth are
    random) and the top edge stays where it is."""
    lo = min(y for pts in outlines for _, y in pts)
    k = TOP / (TOP - lo)
    return [[(x, TOP - (TOP - y) * k) for x, y in pts] for pts in outlines]


def crack(label, pts, w=.0028, mat=CRACK):
    """A dark line lying on the face: a strip along the polyline, a hair proud of the planks."""
    left, right = [], []
    for k, p in enumerate(pts):
        a = Vector(pts[max(k - 1, 0)])
        b = Vector(pts[min(k + 1, len(pts) - 1)])
        d = (b - a).normalized()
        n = Vector((-d.y, d.x))
        ww = w * (1 - .6 * k / (len(pts) - 1))
        left.append(tuple(Vector(p) + n * ww))
        right.append(tuple(Vector(p) - n * ww))
    prism(label, left + list(reversed(right)), .002, mat, M((0, 0, FACE + .0005)))


def blade():
    g = rng(17)
    for i, pts in enumerate(lowest([plank(i, g) for i in range(N)])):
        # Boards are never quite flush: each stands a little proud or back. (Not leant: a lean
        # lifts the lowest splinter off y = 0.)
        dz = g.uniform(-.002, .002)
        prism('rudder plank', pts, T - g.uniform(0, .004), HONEY[i % 3], M((0, 0, dz)))
    # The seams: a dark line in every gap, set back so it reads as the shadow between two boards.
    for i in range(1, N):
        x = -W / 2 + i * PW
        span('rudder seam', x - GAP / 2, x + GAP / 2, max(BREAKS[i - 1], BREAKS[i]) + .055, TOP - .002, -T / 2 + .003,
             T / 2 - .005, CRACK)
    # The crack from the torn west edge down across the first two planks, and a shorter one low on
    # the third, both ending in a split.
    crack('rudder crack', [(-.168, .74), (-.15, .7), (-.143, .64), (-.128, .58), (-.123, .5), (-.108, .43), (-.104, .36)])
    crack('rudder crack', [(-.04, .3), (-.034, .24), (-.041, .17), (-.03, .1)], w=.0024)
    crack('rudder crack', [(.09, .86), (.084, .8), (.088, .74)], w=.002)
    # Grain: a few long faint lines down each plank.
    for i in range(N):
        x = -W / 2 + (i + .5) * PW
        for k in range(2 if i % 2 else 1):
            gx = x + g.uniform(-.45, .45) * PW * .6
            y0 = BREAKS[i] + .06 + g.uniform(0, .1)
            y1 = TOP - g.uniform(.02, .2)
            pts = [(gx + g.uniform(-.003, .003), y0 + (y1 - y0) * t / 3) for t in range(4)]
            crack('rudder grain', pts, w=.0009, mat=GRAIN)


def strap(y, side, length, tilt=0.0, h=.036):
    """An iron strap from one edge in along the face, bent round the edge onto the back, with a
    knuckle at the edge where a pintle turned and bolts through the plank."""
    ex = side * W / 2
    with frame(M((ex, y, 0), roll=tilt)):
        x0, x1 = (-length, .006) if side > 0 else (-.006, length)
        for z in (FACE + .003, -FACE - .003):
            span('rudder strap', x0, x1, -h / 2, h / 2, z - .003, z + .003, STRAP, bevel=.0015)
        span('rudder strap', 0 if side > 0 else -.006, .006 if side > 0 else 0, -h / 2, h / 2, -FACE - .006, FACE + .006, STRAP)
        disc('rudder knuckle', (side * .012, -h / 2 - .004, 0), .013, h + .008, STRAP, sides=8)
        tip = -length if side > 0 else length
        disc('rudder strap end', (tip, 0, FACE), h / 2, .006, STRAP, sides=8, tilt=PI / 2)
        for k in range(3 if length > .09 else 2):
            xx = side * -1 * (.03 + k * (length - .04) / max(1, (2 if length > .09 else 1)))
            rivet((xx, 0, FACE + .006), (0, 0, 1), k=.006, h=.005, mat=STRAP)


def straps():
    strap(.78, 1, .1)
    strap(.43, 1, .11, tilt=-.04, h=.04)
    strap(.3, -1, .11, tilt=-.28, h=.04)


def kraken():
    """The painted kraken: its mantle a flattened egg lying on the planks, crowned with teal, two dark
    eyes, and eight tentacles curling out from under it, each thinner as it goes and ending in a curl,
    a row of teal suckers along the first half of four of them. Everything flattened into the face."""
    cx, cy = .035, .62
    g = rng(29)
    flat = M((0, 0, FACE)) @ Matrix.Diagonal((1, 1, .38, 1))
    with frame(flat):
        ball('kraken mantle', (cx, cy, .004), (.036, .055, .032), BLUE, seg=12, rings=7, roll=-.15)
        ball('kraken crown', (cx - .009, cy + .02, .018), (.018, .027, .02), TEAL, seg=8, rings=4, roll=-.15)
        for sx in (-1, 1):
            ball('kraken eye', (cx + sx * .015 - .005, cy - .026, .014), .007, BLACK, seg=6, rings=3)
        # (start angle from the mantle's foot, curl direction, length) per tentacle.
        arms = [(2.4, -1, .15), (2.95, 1, .19), (-2.6, -1, .21), (-2.1, 1, .23), (-1.7, -1, .2),
                (-1.25, 1, .23), (-.75, -1, .21), (-.15, 1, .17)]
        for k, (a, curl, L) in enumerate(arms):
            p = Vector((cx + .024 * math.cos(a), cy - .034 + .022 * math.sin(a), 0))
            h = a + g.uniform(-.15, .15)
            n = 20
            pts, radii = [], []
            for i in range(n + 1):
                t = i / n
                pts.append((p.x, p.y, .002))
                radii.append(.0125 * (1 - t) ** .75 + .0022)
                # Out from the body with a slow wave in it first, then the curl at the end.
                h += curl * (.03 + .9 * t ** 2.6) * 20 / n * g.uniform(.85, 1.15) - curl * .05 * math.sin(t * 7)
                p = p + Vector((math.cos(h), math.sin(h), 0)) * (L / n) * (1 - .4 * t)
            tube('kraken arm', pts, radii, BLUE, sides=6)
            # The light along its top, over the first two thirds.
            m = n * 2 // 3
            light = []
            for i in range(m):
                d = (Vector(pts[i + 1]) - Vector(pts[max(i - 1, 0)])).normalized()
                side = Vector((-d.y, d.x, 0)) * curl * radii[i] * .35
                light.append(tuple(Vector(pts[i]) + side + Vector((0, 0, radii[i] * .5))))
            tube('kraken arm light', light, [r * .42 for r in radii[:m]], TEAL, sides=4)
            if k % 2 == 0:
                for i in range(2, 12, 2):
                    q = Vector(pts[i])
                    d = (Vector(pts[i + 1]) - Vector(pts[i - 1])).normalized()
                    s = Vector((-d.y, d.x, 0)) * (-curl) * radii[i] * .55
                    ball('kraken sucker', tuple(q + s + Vector((0, 0, radii[i] * .7))), radii[i] * .38, TEAL, seg=4, rings=3)


def beam():
    x0, x1 = -BEAM_L / 2, BEAM_L / 2
    span('rudder beam', x0, x1, BEAM_Y - BEAM_H / 2, BEAM_Y + BEAM_H / 2, -BEAM_D / 2, BEAM_D / 2, BEAMW, bevel=.006)
    # The two hanging brackets: a collar round the beam, a brass pin under it, and a strap down over
    # the top of the blade, front and back, bolted through.
    for x in BRACKETS:
        span('rudder collar', x - .022, x + .022, BEAM_Y - BEAM_H / 2 - .005, BEAM_Y + BEAM_H / 2 + .005,
             -BEAM_D / 2 - .005, BEAM_D / 2 + .005, STRAP, bevel=.002)
        rivet((x, BEAM_Y, BEAM_D / 2 + .005), (0, 0, 1), k=.007, h=.005, mat=STRAP)
        y = BEAM_Y - BEAM_H / 2 - .005
        rod('rudder hanger', (x, y, 0), (x, TOP - .01, 0), .007, STRAP, sides=6)
        box('rudder pin', (x, y - .012, 0), (.03, .012, BEAM_D * .8), BRASS, bevel=.002)
        for z in (FACE + .003, -FACE - .003):
            span('rudder top strap', x - .02, x + .02, TOP - .075, TOP + .012, z - .003, z + .003, STRAP, bevel=.0015)
        span('rudder top strap', x - .02, x + .02, TOP, TOP + .012, -FACE - .006, FACE + .006, STRAP)
        box('rudder clasp', (x, TOP + .01, FACE + .01), (.026, .016, .01), BRASS, bevel=.002)
        rivet((x, TOP - .05, FACE + .006), (0, 0, 1), k=.006, h=.005, mat=STRAP)
    # The wall bracket left on the west end: a plate down from under the beam, an arm along its
    # underside, a brace between them, a scroll curling in the corner and a pointed foot.
    bx = x0 + .018
    ya = BEAM_Y - BEAM_H / 2
    z0, z1 = -.011, .011
    span('rudder wall plate', bx - .012, bx + .012, ya - .15, ya, z0, z1, STRAP)
    span('rudder wall arm', bx, bx + .13, ya - .012, ya, z0 + .003, z1 - .003, STRAP)
    prism('rudder wall foot', [(-.012, 0), (.012, 0), (0, -.03)], .02, STRAP, M((bx, ya - .15, 0)))
    tube('rudder wall brace', [(bx + .008, ya - .13, 0), (bx + .05, ya - .085, 0), (bx + .1, ya - .03, 0),
                               (bx + .12, ya - .012, 0)], .0045, STRAP, sides=4)
    # Two scrolls: one hanging in the corner, one curled under the arm's end.
    for (sx, sy, r0, turns, start, sign) in ((bx + .038, ya - .05, .03, 1.6, PI * .9, -1),
                                            (bx + .1, ya - .026, .014, 1.3, 0.0, 1)):
        pts = []
        n = 18
        for i in range(n + 1):
            t = i / n
            a = start + sign * t * turns * TAU
            r = r0 * (1 - .82 * t)
            pts.append((sx + r * math.cos(a), sy + r * math.sin(a), 0))
        tube('rudder scroll', pts, [.0042 - .0022 * i / n for i in range(n + 1)], STRAP, sides=4)
    for yy in (ya - .035, ya - .11):
        rivet((bx, yy, z1), (0, 0, 1), k=.006, h=.005, mat=STRAP)
    # The chains up from the collars.
    for x in BRACKETS:
        chain((x, BEAM_Y + BEAM_H / 2 + .004, 0), (x, CHAIN_TOP, 0), n=5, w=.03, wire=.0045)


def build():
    blade()
    straps()
    kraken()
    beam()
