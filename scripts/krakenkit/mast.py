"""The ship's mast standing in the hall: a tarred spar from the floor into the ceiling beams
(y = 1.96), on a staved plinth and a square foot, with a yard across its front carrying a furled,
torn sail, a crow's nest at 1.32 and rope ladders up to it. After the keeper's concept drawing,
its shapes without its cartoon swell: nothing bulbous, a little weathered.
"""
import math
from geom import (TAU, PI, DARK, WOOD, OAK, IRON, ROPE, HULLW, BEAMX, DECKP, material,
                  box, span, rod, disc, ball, lathe, prism, hull, tube, torus, cloth, chain,
                  coil, lantern, rng, M)

ASSET = 'civic_kraken_mast'

TOP = 1.96                  # the room's ceiling: the mast runs into its beams
SPAR = material('plank:mast', 0x3a2618)
SAIL = 'plain:sail'
YARD_Y = 1.02
NEST_Y = 1.32               # the top of the crow's nest's floor
GASKETS = [-.64, -.4, -.17, .17, .4, .64]


def R(y):
    """The mast's radius at height y: 0.09 at the foot, 0.07 at the ceiling."""
    return .09 - .02 * y / TOP


def ring_tube(label, centre, ry, rz, r, mat, n=8, sides=3):
    """A rope ring round something lying along x (a gasket round yard and sail): an ellipse in the
    yz plane, closed by running the tube once round and past its start."""
    x, y, z = centre
    pts = [(x, y + ry * math.cos(TAU * i / n), z + rz * math.sin(TAU * i / n)) for i in range(n + 1)]
    pts.append(pts[1])
    tube(label, pts, r, mat, sides=sides)


def dip(x):
    """How far the furled sail hangs below the yard at x: a swag between every two gaskets, pulled
    up tight at each one, the middle swag (under the lashing) the deepest."""
    if x <= GASKETS[0] or x >= GASKETS[-1]:
        return 0.0
    for a, b in zip(GASKETS, GASKETS[1:]):
        if a <= x <= b:
            t = (x - a) / (b - a)
            depth = .036 if a < 0 < b else .026
            return depth * math.sin(PI * t)
    return 0.0


def foot():
    # Four short beams in a square, half-lapped at the corners, on four little feet.
    for sx in (-1, 1):
        for sz in (-1, 1):
            span('mast foot', sx * .19 - .03, sx * .19 + .03, 0, .024, sz * .19 - .03, sz * .19 + .03, DARK)
    for s in (-1, 1):
        span('mast frame', -.215, .215, .022, .066, s * .15 - .028, s * .15 + .028, BEAMX, bevel=.005)
        span('mast frame', s * .15 - .028, s * .15 + .028, .02, .064, -.215, .215, BEAMX, bevel=.005)
    # The partners: a drum of vertical staves round the mast, bound with two iron hoops.
    g = rng(52)
    n = 14
    y0 = .064
    for i in range(n):
        a0, a1 = TAU * i / n + .012, TAU * (i + 1) / n - .012
        top = .155 + g.uniform(-.006, .004)
        pts = []
        for a in (a0, a1):
            c, s = math.cos(a), math.sin(a)
            pts += [(.085 * c, y0, .085 * s), (.2 * c, y0, .2 * s), (.085 * c, top, .085 * s), (.19 * c, top, .19 * s)]
        hull('mast stave', pts, HULLW)
    for hy in (.08, .128):
        lathe('mast hoop', [(.207, hy), (.207, hy + .013)], IRON, sides=n, phase=TAU / n / 2)
    # Wedges driven in round the mast where it goes through.
    lathe('mast wedges', [(.112, .15), (.112, .168), (.096, .186)], DARK, sides=10)
    coil((0, .158, 0), r0=.168, turns=1.6, layers=2, thick=.028)


def spar():
    ys = [.05, .5, 1.0, 1.5, TOP]
    lathe('mast', [(R(y), y) for y in ys], SPAR, sides=10)
    for y in (.2, .93, 1.1, 1.62):
        disc('mast band', (0, y, 0), R(y) + .006, .022, IRON, sides=10)
    disc('mast band', (0, TOP - .05, 0), R(TOP) + .006, .05, IRON, sides=10)
    # The fish: four battens fished on over a sprung stretch, bound with rope wooldings.
    for k in range(4):
        a = PI / 4 + k * PI / 2
        r = R(.55) + .006
        box('mast fish', (r * math.sin(a), .56, r * math.cos(a)), (.042, .34, .016), WOOD, turn=a)
    for y in (.41, .56, .71):
        disc('mast woolding', (0, y - .015, 0), R(y) + .018, .03, ROPE, sides=10)


def yard():
    zy = R(YARD_Y) + .032
    xs = [-.8, -.6, -.4, -.2, 0, .2, .4, .6, .8]
    tube('yard', [(x, YARD_Y, zy) for x in xs], [.017 + .011 * (1 - (x / .8) ** 2) for x in xs], SPAR, sides=6)
    for s in (-1, 1):
        rod('yard cap', (s * .765, YARD_Y, zy), (s * .81, YARD_Y, zy), .02, IRON, sides=6)
        torus('yard eye', (s * .826, YARD_Y, zy), .012, .003, IRON, seg=6, sides=3, tilt=PI / 2)
    # The lashing: two turns, each round the back of the mast above and below the yard and
    # across its front, so the front shows an X.
    rm = R(YARD_Y) + .007
    for s in (-1, 1):
        back = lambda y: [(s * rm * math.cos(a), y, rm * math.sin(a))
                          for a in [.4 + (-PI - .8) * i / 5 for i in range(6)]]
        pts = back(1.07)
        pts += [(-s * .07, 1.056, zy), (-s * .058, 1.042, zy + .031), (0, 1.02, zy + .037),
                (s * .058, .998, zy + .031), (s * .07, .984, zy)]
        pts += back(.97)
        tube('yard lashing', pts, .0065, ROPE, sides=4)
    # The parrel: a string of wooden beads round the back of the mast, holding the yard to it.
    ang = [-.25 - (PI - .5) * i / 6 for i in range(7)]
    pr = R(YARD_Y) + .014
    tube('yard parrel', [(pr * math.cos(a), YARD_Y - .002, pr * math.sin(a)) for a in ang], .004, ROPE, sides=3)
    for a in ang[1:-1]:
        ball('parrel bead', (pr * math.cos(a), YARD_Y - .002, pr * math.sin(a)), .014, OAK, seg=6, rings=3)
    # The slings: short chains from the yard up to the band under the nest.
    for s in (-1, 1):
        chain((s * .13, YARD_Y + .026, zy - .006), (s * R(1.1) * .9, 1.1, .03))
    return zy


def sail(zy):
    zs = zy + .013
    # The furled sail: a bundle under the yard, pinched in by every gasket, swagging between.
    xs = sorted(set([round(-.69 + .06 * i, 3) for i in range(24)] + GASKETS + [.69]))
    xs = [x for x in xs if -.69 <= x <= .69]
    ys, rs = [], []
    for x in xs:
        d = dip(x)
        end = min(1.0, (.69 - abs(x)) / .06)
        ys.append(.972 - d)
        rs.append(max(.012, (.029 + .5 * d) * (.45 + .55 * end)) if d else .027 * (.45 + .55 * end))
    tube('sail roll', [(x, y, zs) for x, y in zip(xs, ys)], rs, SAIL, sides=6)
    for gx in GASKETS:
        ring_tube('sail gasket', (gx, .994, zy + .006), .056, .04, .0055, ROPE, n=6)
    # What has come loose of it: a torn sheet hanging in front, down to about 0.73.
    g = rng(7)
    fold = [g.uniform(-.006, .006) for _ in range(21)]
    x0, x1 = -.6, .6
    corner = lambda u, v: (x0 + (x1 - x0) * u, .955 - .15 * v,
                           zs + .012 + .014 * v + fold[round(u * 20)] + .006 * math.sin(u * 31) * v)
    sag = lambda u, v: dip(x0 + (x1 - x0) * u) * (1 - .35 * v) + .012 * v * math.sin(PI * u * 3) ** 2
    cloth(corner, 20, 3, sag, SAIL, thick=.006, ragged=.04, seed=11)
    # Loose ends of rope hanging off it, frayed out at the bottom.
    for x, y0, y1, bend in ((-.4, .94, .66, .02), (.4, .94, .7, -.015), (-.79, .99, .62, .025),
                            (-.2, .925, .72, .01), (.17, .94, .68, .018)):
        pts = [(x + bend * math.sin(PI * t) * .6, y0 + (y1 - y0) * t, zy + .03 + bend * t) for t in (0, .3, .6, .85, 1)]
        tube('loose rope', pts, [.0055, .0055, .005, .005, .007], ROPE, sides=3)
    lantern((.73, .82, zy), hang_to=YARD_Y - .02)


def nest():
    y = NEST_Y
    disc('nest floor', (0, y - .03, 0), .22, .03, DECKP, sides=12)
    torus('nest curb', (0, y - .004, 0), .214, .013, DARK, seg=12, sides=4)
    gap = .34                   # where the front ladder comes up through the rail
    start, arc = PI / 2 + gap, TAU - 2 * gap
    rb = .205
    n = 10
    for k in range(n + 1):
        a = start + arc * k / n
        end = k in (0, n)
        rod('nest baluster', (rb * math.cos(a), y, rb * math.sin(a)), (rb * math.cos(a), y + .15, rb * math.sin(a)),
            .012 if end else .0075, DARK if end else WOOD, sides=4)
    torus('nest rail', (0, y + .156, 0), rb, .011, DARK, seg=12, sides=4, arc=arc, start=start)
    torus('nest rope rail', (0, y + .075, 0), rb, .005, ROPE, seg=12, sides=3, arc=arc, start=start)
    # Four knees under it, on the diagonals, clear of the yard and the ladders.
    for k in range(4):
        a = PI / 4 + k * PI / 2
        prism('nest knee', [(R(1.2) - .01, y - .03), (.17, y - .03), (.15, y - .06), (.11, y - .12), (R(1.2) - .01, y - .19)], .02, DARK,
              M((0, 0, 0), turn=a))


def ladder(label, bottom, top, half, step, r_side, r_rung, rung_mat, across):
    """A rope ladder: two sides and rungs between them. `across` is the unit vector between
    the two sides."""
    ax, az = across
    for s in (-1, 1):
        tube(label, [(bottom[0] + s * half * ax, bottom[1], bottom[2] + s * half * az),
                     (top[0] + s * half * ax, top[1], top[2] + s * half * az)], r_side, ROPE, sides=4)
    h = top[1] - bottom[1]
    y = bottom[1] + step
    while y < top[1] - step * .6:
        t = (y - bottom[1]) / h
        cx, cz = bottom[0] + (top[0] - bottom[0]) * t, bottom[2] + (top[2] - bottom[2]) * t
        rod(label + ' rung', (cx - half * ax, y, cz - half * az), (cx + half * ax, y, cz + half * az), r_rung, rung_mat, sides=3)
        y += step


def ladders():
    # Up the front, from a cleat on the floor to the gap in the nest's rail.
    ladder('front ladder', (0, .01, .28), (0, NEST_Y + .01, .214), .07, .07, .0065, .0075, WOOD, (1, 0))
    span('ladder cleat', -.095, .095, 0, .018, .266, .294, DARK, bevel=.003)
    for s in (-1, 1):
        torus('ladder ring', (s * .07, .02, .28), .01, .0028, IRON, seg=6, sides=3, tilt=PI / 2)
    # A thinner one hanging down the west side (the side the side view is drawn from), rope rungs, made fast to the foot's beam end.
    ladder('side ladder', (-.285, .02, 0), (-.214, NEST_Y - .01, 0), .05, .08, .0045, .0045, ROPE, (0, 1))
    span('ladder cleat', -.304, -.262, 0, .016, -.075, .075, DARK, bevel=.003)


def build():
    foot()
    spar()
    zy = yard()
    sail(zy)
    nest()
    ladders()
