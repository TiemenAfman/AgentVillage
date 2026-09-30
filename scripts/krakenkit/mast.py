"""The ship's mast standing in the hall: a tarred spar from the floor into the ceiling beams
(y = 2.35, the two-storey hall), on a staved plinth and a square foot, with a yard across its front
carrying a furled, torn sail, a planked crow's nest whose floor is walked on (top at 1.55) and two
rope ladders up to it through hatches (back and west). After the keeper's concept drawing, its shapes without its
cartoon swell: nothing bulbous, a little weathered.

The nest is a place people stand: above its planks there is nothing inside the rail but the mast,
and the rail is open on +z (its front), 0.5 wide round x = 0, where the rope bridge from the gallery
comes in: the hall stands the mast turned a quarter, so its front faces the bridge. The yard stays
along x, in front; the main ladder is at the back so it does not run under the bridge.
Indoors triangles are not what limits a piece, so the mast is 16-sided and its bands are riveted.
"""
import math
import bmesh
from geom import (TAU, PI, DARK, WOOD, OAK, IRON, ROPE, HULLW, BEAMX, DECKP, material, emit,
                  box, span, rod, disc, ball, lathe, prism, hull, tube, torus, cloth, chain,
                  coil, lantern, rng, M)

ASSET = 'civic_kraken_mast'

TOP = 2.35                  # the hall's ceiling: the mast runs into its beams
SPAR = material('plank:mast', 0x3a2618)
SAIL = 'plain:sail'
YARD_Y = 1.18
NEST_Y = 1.55               # the top of the crow's nest's planks: a walkable floor
NEST_R = .65                # its outside, the rail included: 1.3 across, room for a walker (0.32) round the pole
PLANK_R = .63               # where the planks stop and the rim begins
DECK_T = .035               # the planks' thickness
GAP = math.asin(.25 / .64)  # half the opening in the rail on +z, as an angle (0.5 wide at the rail)
X = 1.125                   # the yard and its sail, stretched along x from the first, 1.6 long, design
GASKETS = [g * X for g in (-.64, -.4, -.17, .17, .4, .64)]
# The two holes the ladders come up through: (x0, x1, z0, z1).
HATCHES = [(-.14, .14, -.42, -.2), (-.42, -.2, -.13, .13)]


def R(y):
    """The mast's radius at height y: 0.1 at the foot, 0.075 at the ceiling."""
    return .1 - .025 * y / TOP


def annulus(label, r0, r1, y0, y1, mat, seg=32, start=0.0, arc=None):
    """A ring with a rectangular section (a rim, a rail cap): r0..r1 wide, y0..y1 high, all the way
    round or `arc` of it from `start`, closed at both ends."""
    full = arc is None
    a1 = TAU if full else arc
    n = seg if full else seg + 1
    bm = bmesh.new()
    rings = []
    for i in range(n):
        a = start + a1 * i / seg
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, y, r * s)) for r, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1))])
    for i in range(n if full else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(4):
            bm.faces.new((A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j]))
    if not full:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    emit(bm, mat, label)


def ring_tube(label, centre, ry, rz, r, mat, n=10, sides=4):
    """A rope ring round something lying along x (a gasket round yard and sail): an ellipse in the
    yz plane, closed by running the tube once round and past its start."""
    x, y, z = centre
    pts = [(x, y + ry * math.cos(TAU * i / n), z + rz * math.sin(TAU * i / n)) for i in range(n + 1)]
    pts.append(pts[1])
    tube(label, pts, r, mat, sides=sides)


def iron_band(y, h=.024, rivets=12, extra=.006):
    """An iron band round the mast with a ring of rivet heads on it."""
    r = R(y) + extra
    disc('mast band', (0, y, 0), r, h, IRON, sides=16)
    for k in range(rivets):
        a = TAU * (k + .5) / rivets
        ball('band rivet', (r * math.cos(a), y + h / 2, r * math.sin(a)), .0045, IRON, seg=5, rings=3)


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
            span('mast foot', sx * .195 - .027, sx * .195 + .027, 0, .026, sz * .195 - .027, sz * .195 + .027, DARK, bevel=.003)
    for s in (-1, 1):
        span('mast frame', -.222, .222, .024, .07, s * .16 - .03, s * .16 + .03, BEAMX, bevel=.005)
        span('mast frame', s * .16 - .03, s * .16 + .03, .022, .068, -.222, .222, BEAMX, bevel=.005)
        for t in (-1, 1):   # a treenail through each lap
            disc('frame peg', (s * .16, .07, t * .16), .009, .004, OAK, sides=6)
    # The partners: a drum of vertical staves round the mast, bound with two riveted iron hoops.
    g = rng(52)
    n = 18
    y0 = .068
    for i in range(n):
        a0, a1 = TAU * i / n + .01, TAU * (i + 1) / n - .01
        top = .165 + g.uniform(-.007, .004)
        pts = []
        for a in (a0, a1):
            c, s = math.cos(a), math.sin(a)
            pts += [(.095 * c, y0, .095 * s), (.212 * c, y0, .212 * s), (.095 * c, top, .095 * s), (.2 * c, top, .2 * s)]
        hull('mast stave', pts, HULLW)
    for hy in (.084, .136):
        lathe('mast hoop', [(.218, hy), (.218, hy + .014)], IRON, sides=n, phase=TAU / n / 2)
        for k in range(9):
            a = TAU * (k * 2 + 1) / n
            ball('hoop rivet', (.219 * math.cos(a), hy + .007, .219 * math.sin(a)), .004, IRON, seg=5, rings=3)
    # Wedges driven in round the mast where it goes through.
    for k in range(10):
        a = TAU * k / 10
        hull('mast wedge', [(r * math.cos(a + d), y, r * math.sin(a + d))
                            for r, y in ((.098, .16), (.126, .16), (.098, .2)) for d in (-.26, .26)], DARK)
    coil((0, .168, 0), r0=.182, turns=1.6, layers=2, thick=.03)


def spar():
    ys = [.05, .6, 1.2, 1.8, TOP]
    lathe('mast', [(R(y), y) for y in ys], SPAR, sides=16)
    for y in (.24, 1.08, 1.27, 1.95):
        iron_band(y)
    iron_band(TOP - .06, h=.06, rivets=16)
    # The fish: four battens fished on over a sprung stretch, bound with rope wooldings.
    for k in range(4):
        a = PI / 4 + k * PI / 2
        r = R(.65) + .007
        box('mast fish', (r * math.sin(a), .65, r * math.cos(a)), (.046, .4, .018), WOOD, turn=a, bevel=.003)
    for y in (.48, .65, .82):
        for dy in (-.012, .012):
            torus('mast woolding', (0, y + dy, 0), R(y) + .02, .0085, ROPE, seg=16, sides=5)


def yard():
    zy = R(YARD_Y) + .034
    L = .8 * X
    xs = [L * (i / 6 - 1) for i in range(13)]
    tube('yard', [(x, YARD_Y, zy) for x in xs], [.018 + .012 * (1 - (x / L) ** 2) for x in xs], SPAR, sides=10)
    for s in (-1, 1):
        rod('yard cap', (s * (L - .035), YARD_Y, zy), (s * (L + .012), YARD_Y, zy), .021, IRON, sides=10)
        torus('yard eye', (s * (L + .028), YARD_Y, zy), .013, .0035, IRON, seg=8, sides=4, tilt=PI / 2)
        for dx in (.2, .5):   # the stirrup bands the footropes would hang from
            torus('yard band', (s * L * (1 - dx), YARD_Y, zy), .026 * (1 - (1 - dx) ** 2 * .35) + .003, .004, IRON,
                  seg=10, sides=4, roll=PI / 2)
    # The lashing: two turns, each round the back of the mast above and below the yard and
    # across its front, so the front shows an X.
    rm = R(YARD_Y) + .008
    for s in (-1, 1):
        back = lambda y: [(s * rm * math.cos(a), y, rm * math.sin(a))
                          for a in [.4 + (-PI - .8) * i / 9 for i in range(10)]]
        pts = back(YARD_Y + .052)
        pts += [(-s * .078, YARD_Y + .038, zy), (-s * .064, YARD_Y + .024, zy + .033), (0, YARD_Y, zy + .04),
                (s * .064, YARD_Y - .024, zy + .033), (s * .078, YARD_Y - .038, zy)]
        pts += back(YARD_Y - .052)
        tube('yard lashing', pts, .007, ROPE, sides=5)
    # The parrel: a string of wooden beads round the back of the mast, holding the yard to it.
    ang = [-.25 - (PI - .5) * i / 8 for i in range(9)]
    pr = R(YARD_Y) + .015
    tube('yard parrel', [(pr * math.cos(a), YARD_Y - .002, pr * math.sin(a)) for a in ang], .004, ROPE, sides=4)
    for a in ang[1:-1]:
        ball('parrel bead', (pr * math.cos(a), YARD_Y - .002, pr * math.sin(a)), .015, OAK, seg=8, rings=4)
    # The slings: short chains from the yard up to the band under the nest.
    for s in (-1, 1):
        chain((s * .15, YARD_Y + .03, zy - .006), (s * R(1.27) * .9, 1.28, .035))
    return zy


def sail(zy):
    zs = zy + .014
    Y = YARD_Y
    end_x = .69 * X
    # The furled sail: a bundle under the yard, pinched in by every gasket, swagging between.
    xs = sorted(set([round(-end_x + .035 * i, 3) for i in range(int(2 * end_x / .035) + 1)] + GASKETS + [end_x]))
    xs = [x for x in xs if -end_x <= x <= end_x]
    ys, rs = [], []
    for x in xs:
        d = dip(x)
        end = min(1.0, (end_x - abs(x)) / .07)
        ys.append(Y - .048 - d)
        rs.append(max(.012, (.03 + .5 * d) * (.45 + .55 * end)) if d else .028 * (.45 + .55 * end))
    tube('sail roll', [(x, y, zs) for x, y in zip(xs, ys)], rs, SAIL, sides=10)
    for gx in GASKETS:
        ring_tube('sail gasket', (gx, Y - .025, zy + .007), .058, .043, .0055, ROPE)
        # the reef knot on top, and its two ends
        ball('gasket knot', (gx, Y + .034, zy + .004), (.011, .008, .009), ROPE, seg=6, rings=3)
    # What has come loose of it: a torn sheet hanging in front, no lower than 0.95.
    g = rng(7)
    nu = 32
    fold = [g.uniform(-.007, .007) for _ in range(nu + 1)]
    x0, x1 = -.6 * X, .6 * X
    corner = lambda u, v: (x0 + (x1 - x0) * u, Y - .065 - .085 * v,
                           zs + .012 + .014 * v + fold[round(u * nu)] + .006 * math.sin(u * 31) * v)
    sag = lambda u, v: dip(x0 + (x1 - x0) * u) * (1 - .35 * v) + .012 * v * math.sin(PI * u * 3) ** 2
    cloth(corner, nu, 4, sag, SAIL, thick=.006, ragged=.032, seed=11)
    # Loose ends of rope hanging off it, each with a knot at the bottom.
    for x, y0, y1, bend in ((-.45, Y - .085, .98, .02), (.45, Y - .085, 1.0, -.015), (-.89, Y - .03, .96, .025),
                            (-.22, Y - .1, 1.0, .01), (.19, Y - .085, .97, .018)):
        pts = [(x + bend * math.sin(PI * t) * .6, y0 + (y1 - y0) * t, zy + .035 + bend * t) for t in (0, .2, .4, .6, .8, 1)]
        tube('loose rope', pts, .005, ROPE, sides=5)
        ball('rope knot', pts[-1], .008, ROPE, seg=6, rings=3)
    lantern((.84, 1.02, zy), hang_to=YARD_Y - .02, s=1.1)


def plank_piece(xa, xb, z0, z1, y0, y1):
    """One plank of the nest, or the piece of it beside a hatch: the strip z0..z1 between xa and
    xb, cut to the round of the deck. Convex, so its hull is the plank."""
    pts = []
    for k in range(5):
        z = z0 + (z1 - z0) * k / 4
        half = math.sqrt(max(PLANK_R * PLANK_R - z * z, 0))
        l, r = max(xa, -half), min(xb, half)
        if r - l > .004:
            pts += [(l, y, z) for y in (y0, y1)] + [(r, y, z) for y in (y0, y1)]
    if len(pts) >= 8:
        hull('nest plank', pts, DECKP)


def nest():
    y = NEST_Y
    y0 = y - DECK_T
    # The planks, run along x, cut round the two hatches.
    n = 16
    w = 2 * PLANK_R / n
    g = rng(31)
    for i in range(n):
        z0, z1 = -PLANK_R + w * i + .002, -PLANK_R + w * (i + 1) - .002
        cuts = sorted((hx0, hx1) for hx0, hx1, hz0, hz1 in HATCHES if hz0 < z1 and z0 < hz1)
        x = -PLANK_R
        for cx0, cx1 in cuts + [(PLANK_R, PLANK_R)]:
            # a butt joint somewhere along the longest planks
            if cx0 - x > .5:
                j = g.uniform(-.1, .1)
                plank_piece(x, j - .002, z0, z1, y0, y)
                plank_piece(j + .002, cx0, z0, z1, y0, y)
            else:
                plank_piece(x, cx0, z0, z1, y0, y)
            x = cx1
    # The hatches' frames, flush with the deck, and an iron bar the ladder hangs from.
    for hx0, hx1, hz0, hz1 in HATCHES:
        t = .016
        span('hatch frame', hx0, hx1, y0 - .02, y, hz0, hz0 + t, DARK)
        span('hatch frame', hx0, hx1, y0 - .02, y, hz1 - t, hz1, DARK)
        span('hatch frame', hx0, hx0 + t, y0 - .02, y, hz0, hz1, DARK)
        span('hatch frame', hx1 - t, hx1, y0 - .02, y, hz0, hz1, DARK)
    # The rim: a band round the deck's edge standing a finger proud of the planks.
    annulus('nest rim', PLANK_R - .002, NEST_R, y0 - .025, y + .006, DARK, seg=64)
    # Crosstrees and trestletrees under the deck, clear of both hatches.
    for s in (-1, 1):
        span('nest crosstree', -.62, .62, y0 - .065, y0, s * .15 - .0225, s * .15 + .0225, BEAMX, bevel=.004)
        span('nest trestletree', s * .17 - .0225, s * .17 + .0225, y0 - .065, y0, -.62, .62, BEAMX, bevel=.004)
        # and an outer pair each way, under the planks' far ends
        span('nest crosstree', -.43, .43, y0 - .05, y0, s * .45 - .02, s * .45 + .02, BEAMX, bevel=.004)
        span('nest trestletree', s * .45 - .02, s * .45 + .02, y0 - .05, y0, -.43, .43, BEAMX, bevel=.004)
    # Knees from the beams down to the mast, where neither ladder comes up.
    yk = y0 - .065
    for a in (PI / 4, 3 * PI / 4, 5 * PI / 4, 7 * PI / 4, 0.0, 3 * PI / 2):
        rk = R(1.3) - .012
        curve = [(.54 - (.54 - (rk + .035)) * math.sin(t * PI / 2), yk - .025 - (yk - .025 - 1.3) * (1 - math.cos(t * PI / 2)))
                 for t in [k / 5 for k in range(6)]]
        prism('nest knee', [(rk, yk), (.57, yk), *curve, (rk, 1.3)], .032, DARK, M((0, 0, 0), turn=a))
    # The rail: all the way round but for the gap on +z where the rope bridge comes in.
    start, arc = PI / 2 + GAP, TAU - 2 * GAP
    rb = .64
    cap = y + .265
    nb = 36
    for k in range(nb + 1):
        a = start + arc * k / nb
        c, s = math.cos(a), math.sin(a)
        if k in (0, nb):
            # the gap's two posts, stout, with eyes for the bridge's hand ropes and foot ropes
            box('nest post', (rb * c, (y + cap) / 2 + .01, rb * s), (.042, cap - y + .02, .042), DARK, turn=-a, bevel=.004)
            ball('nest post knob', (rb * c, cap + .03, rb * s), .024, DARK, seg=8, rings=4)
            for ey in (y + .03, cap - .02):
                torus('bridge eye', (rb * c, ey, rb * s + .026), .014, .004, IRON, seg=8, sides=4, tilt=PI / 2)
        elif k % 4 == 0:
            box('nest stanchion', (rb * c, (y + cap) / 2, rb * s), (.026, cap - y, .026), DARK, turn=-a)
        else:
            rod('nest baluster', (rb * c, y, rb * s), (rb * c, cap, rb * s), .0085, WOOD, sides=6)
    annulus('nest rail', rb - .016, rb + .014, cap - .005, cap + .018, DARK, seg=64, start=start, arc=arc)
    torus('nest rope rail', (0, y + .13, 0), rb, .0055, ROPE, seg=64, sides=4, arc=arc, start=start)


def ladder(label, bottom, top, half, step, r_side, r_rung, rung_mat, across, rung_sides=6):
    """A rope ladder: two sides and rungs between them. `across` is the unit vector between
    the two sides."""
    ax, az = across
    for s in (-1, 1):
        tube(label, [(bottom[0] + s * half * ax, bottom[1], bottom[2] + s * half * az),
                     (top[0] + s * half * ax, top[1], top[2] + s * half * az)], r_side, ROPE, sides=5)
    h = top[1] - bottom[1]
    y = bottom[1] + step
    while y < top[1] - step * .6:
        t = (y - bottom[1]) / h
        cx, cz = bottom[0] + (top[0] - bottom[0]) * t, bottom[2] + (top[2] - bottom[2]) * t
        rod(label + ' rung', (cx - half * ax - r_side, y, cz - half * az - r_side * az / max(abs(az), 1)),
            (cx + half * ax, y, cz + half * az), r_rung, rung_mat, sides=rung_sides)
        for s in (-1, 1):   # the seizing where the rung goes through the side
            ball(label + ' seizing', (cx + s * half * ax, y, cz + s * half * az), r_side * 1.6, ROPE, seg=5, rings=3)
        y += step


def ladders():
    # Up the back, from a cleat on the floor to the back hatch, hung from a bar across it.
    hx0, hx1, hz0, hz1 = HATCHES[0]
    ladder('back ladder', (0, .012, -.46), (0, NEST_Y - .045, hz0 + .02), .075, .075, .0065, .008, WOOD, (1, 0))
    rod('ladder bar', (hx0 + .01, NEST_Y - .05, hz0 + .02), (hx1 - .01, NEST_Y - .05, hz0 + .02), .008, IRON, sides=6)
    span('ladder cleat', -.105, .105, 0, .02, -.475, -.445, DARK, bevel=.003)
    for s in (-1, 1):
        torus('ladder ring', (s * .075, .022, -.46), .011, .003, IRON, seg=8, sides=4, tilt=PI / 2)
    # A thinner one with rope rungs up the west side (the side the side view is drawn from), to
    # the other hatch.
    hx0, hx1, hz0, hz1 = HATCHES[1]
    ladder('side ladder', (-.46, .02, 0), (hx0 + .02, NEST_Y - .045, 0), .05, .085, .0048, .005, ROPE, (0, 1),
           rung_sides=5)
    rod('ladder bar', (hx0 + .02, NEST_Y - .05, hz0 + .01), (hx0 + .02, NEST_Y - .05, hz1 - .01), .007, IRON, sides=6)
    span('ladder cleat', -.48, -.44, 0, .018, -.075, .075, DARK, bevel=.003)


def build():
    foot()
    spar()
    zy = yard()
    sail(zy)
    nest()
    ladders()
