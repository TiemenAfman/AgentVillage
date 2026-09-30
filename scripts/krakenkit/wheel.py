"""The ship's-wheel chandelier: an old helm hung level over the tables, candles burning round its rim,
the wax of years hanging under it, four chains up to a ring and an oil lantern under the hub. After
the keeper's drawing (refs/krakenkit/objecten/stuurwiel-kroon.jpg), the same wheel twice.

The drawing shows it from the side and stands the wheel up, but in the hall it hangs flat, like a
wagon-wheel chandelier: the rim is a band of wood round the level spokes, and what the drawing draws
as its top edge (a painted blue-green band with a thin olive stripe over it, iron at its foot) is
the rim's outer face. Eight turned spokes run from the hub through the rim and out past it into
handles, an iron strap round the rim where each passes; the hub has an iron boss above and below,
and the eye under it carries the lantern's chain. Eight fat cream candles stand in iron cups on the
rim between the spokes, their wax run down them, over the rim's face and hanging from its underside
in pale icicles; the hall sees it mostly from below, which is where the drips and the straps are.

Frame: centred on x and z, the lantern's foot on y = 0. The rim is 0.9 across (the handles 1.22),
the spokes at y = WHEEL_Y; the four chains meet at a ring at RING_Y and one goes on up to RING_TOP
(the long drop to the roof is the room's). Plain materials throughout: neither plank sheet lays its
boards round a ring or along a turned spoke.
"""
import math
import bmesh
from mathutils import Vector
from geom import (PI, TAU, M, frame, box, rod, disc, ball, lathe, tube, torus, emit, rng, material,
                  flame, IRON, BLACK, WAX, GLASS)
from skulllamp import chain, drip, rivet

ASSET = 'civic_kraken_wheel'

TIMBER = material('plain:wheel-wood', 0x6a4527)     # the rim and the spokes, old oiled oak
HUBW = material('plain:wheel-hub', 0x55361f)
PAINT = material('plain:wheel-paint', 0x2d4f5a)     # the rim's painted band, a faded blue-green
OLIVE = material('plain:wheel-olive', 0x5c6236)     # the thin stripe over it
OLDIRON = material('plain:wheel-iron', 0x2f2e2c)
DRIPWAX = material('plain:wheel-drip', 0xd9ceb4)    # old wax, greyer than the candles' cream

# ---- the numbers --------------------------------------------------------------------------------
WHEEL_Y = .431           # the spokes' axis, the middle of the rim
R0, R1 = .395, .45       # the rim, inside and out: 0.9 across
Y0, Y1 = .39, .472       # its underside and top
RM = (R0 + R1) / 2       # where the candles and the chains stand on it
SPOKES = 8
HUB_R = .07
RING_Y = 1.0             # the ring the four chains meet at
RING_TOP = 1.2           # where the chain going on up ends
FLAME_S = 1.35

# The candles, between the spokes: (visible height, radius). Burnt down unevenly, as in the drawing.
CANDLES = [(.15, .031), (.11, .029), (.165, .033), (.125, .03), (.095, .028), (.155, .032), (.115, .029), (.14, .031)]
PAN = .008               # the cup's pan over the rim
CUP = .026               # the socket's height over its pan
SUNK = .012


def _flame_foot(h):
    return Y1 + PAN + CUP - SUNK + h + SUNK + .003


FLAME_Y = round(sum(_flame_foot(h) for h, _ in CANDLES) / len(CANDLES) + .017 * FLAME_S, 4)
LS = 1.2                 # the lantern's scale: the drawing's is a fifth of the wheel across
GLOBE_Y = .085           # the middle of its glass, in its own frame
LANTERN_Y = round(GLOBE_Y * LS, 4)


def polar(r, a, y):
    return (r * math.cos(a), y, r * math.sin(a))


def annulus(label, r0, r1, y0, y1, mat, seg=48, phase=0.0):
    """A ring of rectangular section, r0..r1 wide and y0..y1 tall, closed on itself."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = phase + TAU * i / seg
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, y, r * s)) for r, y in ((r0, y0), (r1, y0), (r1, y1), (r0, y1))])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(4):
            bm.faces.new((A[j], A[(j + 1) % 4], B[(j + 1) % 4], B[j]))
    emit(bm, mat, label)


# ---- the wheel ----------------------------------------------------------------------------------
# A spoke turned on a lathe, as (radius, distance from the hub's axis): a bead and a swell inside
# the rim, a collar where it leaves it, and the handle outside - a grip swelling to a knob.
SPOKE = [(.015, .06), (.016, .09), (.012, .12), (.016, .15), (.022, .19), (.023, .215), (.019, .245),
         (.012, .28), (.015, .32), (.017, .39), (.017, .455), (.024, .465), (.024, .478), (.015, .492),
         (.018, .515), (.024, .545), (.025, .56), (.02, .578), (.013, .59), (.019, .598), (.019, .606),
         (.012, .614), (0, .617)]


def spokes():
    for k in range(SPOKES):
        a = TAU * k / SPOKES
        lathe('wheel spoke', SPOKE, TIMBER, at=(0, WHEEL_Y, 0), sides=7, turn=-a, roll=-PI / 2)


def rim():
    annulus('wheel rim', R0, R1, Y0, Y1, TIMBER)
    # The outer face, as the drawing has it from the side: iron at the foot, the painted band, a thin
    # olive stripe over it and the wood's own edge on top.
    annulus('wheel rim iron', R1 - .002, R1 + .005, Y0 - .002, Y0 + .012, OLDIRON)
    annulus('wheel rim paint', R1 - .001, R1 + .0035, Y0 + .013, Y0 + .058, PAINT)
    annulus('wheel rim stripe', R1 - .001, R1 + .004, Y0 + .06, Y0 + .07, OLIVE)
    annulus('wheel rim iron', R0 - .005, R0 + .002, Y0 - .002, Y0 + .009, OLDIRON, seg=40)
    # Nails in the iron band, one between each strap and the next.
    for k in range(SPOKES * 2):
        a = TAU * (k + .5) / (SPOKES * 2)
        rivet(polar(R1 + .005, a, Y0 + .0045), (math.cos(a), 0, math.sin(a)), k=.0042, h=.003, mat=OLDIRON)
    # Where a spoke passes, an iron strap wrapped round the rim's section, with a bolt on its face.
    for k in range(SPOKES):
        a = TAU * k / SPOKES
        box('wheel strap', polar(RM, a, (Y0 + Y1) / 2), (R1 - R0 + .012, Y1 - Y0 + .008, .03), OLDIRON, turn=-a)
        rivet(polar(R1 + .006, a, WHEEL_Y + .01), (math.cos(a), 0, math.sin(a)), k=.006, h=.004, mat=OLDIRON)


def hub():
    lathe('wheel hub', [(.064, 0), (.07, .008), (.07, .072), (.064, .08)], HUBW, at=(0, WHEEL_Y - .04, 0), sides=12)
    lathe('wheel hub band', [(.072, 0), (.072, .018)], OLDIRON, at=(0, WHEEL_Y - .009, 0), sides=12)
    # The boss on top, a dome with a square nut, and one under it with the eye the lantern hangs from.
    lathe('wheel boss', [(.048, 0), (.046, .01), (.034, .018), (.016, .022), (0, .023)], OLDIRON,
          at=(0, WHEEL_Y + .04, 0), sides=10)
    box('wheel nut', (0, WHEEL_Y + .065, 0), (.022, .012, .022), OLDIRON, turn=.3)
    lathe('wheel boss', [(0, -.022), (.016, -.02), (.034, -.014), (.046, -.006), (.048, 0)], OLDIRON,
          at=(0, WHEEL_Y - .04, 0), sides=10)
    torus('wheel eye', (0, WHEEL_Y - .075, 0), .013, .0038, OLDIRON, seg=8, sides=4, tilt=PI / 2)


# ---- the candles --------------------------------------------------------------------------------
def candle(a, h, r, seed):
    """An iron cup screwed to the rim, a fat church candle in it melted down unevenly, its wax run
    down its sides, over the cup, and in a pool out over the rim's edge."""
    g = rng(seed)
    x, _, z = polar(RM, a, 0)
    y = Y1
    lathe('wheel cup pan', [(0, 0), (r + .012, 0), (r + .016, .005), (r + .017, PAN), (r + .013, PAN), (0, PAN - .002)],
          OLDIRON, at=(x, y, z), sides=9)
    lathe('wheel cup socket', [(r + .003, PAN - .002), (r + .007, PAN), (r + .007, PAN + CUP), (r + .003, PAN + CUP),
                                (0, PAN + CUP - .006)], OLDIRON, at=(x, y, z), sides=9)
    b = y + PAN + CUP - SUNK
    H = h + SUNK
    lean = g.uniform(-.003, .003)
    # The top melted into a hollow with a lip standing round it higher on one side.
    lathe('wheel candle', [(r * 1.01, 0), (r, H * .5), (r * .99, H - .008), (r * .96, H - .001), (r * .8, H + .002),
                           (r * .66, H - .006), (0, H - .007)], WAX, at=(x, b, z), sides=9, phase=g.uniform(0, TAU))
    rod('wheel wick', (x, b + H - .008, z), (x + lean, b + H + .008, z), .0018, BLACK, sides=3)
    flame((x + lean, b + H + .003, z), FLAME_S)
    # Runs down the candle from the lip, one of them reaching the cup, each ending in a bead.
    for k in range(3):
        c = g.uniform(0, TAU)
        l = h - .004 if k == 0 else g.uniform(.25, .6) * h
        cc, ss = math.cos(c), math.sin(c)
        ys = (b + H + .001, b + H - l * .55, b + H - l, b + H - l - .007)
        drip('wheel candle run', [(x + r * .99 * cc, yy, z + r * .99 * ss) for yy in ys], [(cc, 0, ss)] * 4,
             [.0055, .006, .0078, .002], WAX)
    # A collar of wax over the socket's lip and a run of it down the socket into the pan.
    lathe('wheel wax collar', [(r + .005, 0), (r + .009, .004), (r + .008, .008), (r + .001, .011)], WAX,
          at=(x, y + PAN + CUP - .006, z), sides=8)
    c = g.uniform(0, TAU)
    cc, ss = math.cos(c), math.sin(c)
    ro = r + .0075
    drip('wheel socket run', [(x + ro * cc, y + PAN + CUP, z + ro * ss), (x + ro * cc, y + PAN + CUP * .45, z + ro * ss),
                              (x + (ro + .005) * cc, y + PAN + .002, z + (ro + .005) * ss)],
         [(cc, 0, ss)] * 3, [.005, .0055, .004], WAX)


def icicle(tip, top, r, seed, mat=DRIPWAX):
    """Wax hanging straight down from `top` to `tip`: fat where it leaves the rim, a waist, a bead."""
    x, y0, z = tip
    L = top - y0
    g = rng(seed)
    w = g.uniform(.8, 1.2)
    prof = [(0, 0), (r * .55, .006), (r * .32, .017)]
    if L > .06:
        prof += [(r * .5, L * .5)]
    prof += [(r * .82, L * .82), (r * 1.08, L + .004), (0, L + .008)]
    lathe('wheel icicle', prof, mat, at=(x, y0, z), sides=5, phase=g.uniform(0, TAU), scale=(w, 1, 2 - w))


def wax():
    """What years of candles left on the rim: from under each candle a pool over the rim's top, a
    run or two over its outer (and now and then its inner) face and the icicles hanging from where
    those runs stopped; and more icicles all round under it, longest under the candles."""
    g = rng(83)
    for i, (h, r) in enumerate(CANDLES):
        a = TAU * (i + .5) / SPOKES
        n = (math.cos(a), 0, math.sin(a))
        # The pool: a low skin spreading from the cup to the rim's outer edge.
        with frame(M(polar(RM + .006, a, Y1), turn=-a)):
            ball('wheel wax pool', (0, 0, 0), (.036, .0045, .05), WAX, seg=8, rings=3)
        for k in range(2 if i % 3 else 3):
            b = a + g.uniform(-.07, .07)
            nb = (math.cos(b), 0, math.sin(b))
            end = Y0 - .002
            path = [polar(R1 + .005, b, Y1 + .001), polar(R1 + .006, b, (Y1 + end) / 2),
                    polar(R1 + .0065, b, end + .006), polar(R1 + .004, b, end)]
            drip('wheel rim run', path, [nb] * 4, [.006, .0065, .0085, .005], WAX)
            L = g.uniform(.04, .13) if k == 0 else g.uniform(.02, .07)
            icicle(polar(R1 + .003, b, end - L), end + .004, g.uniform(.008, .012), 100 + i * 5 + k)
        if i % 2 == 0:
            b = a + g.uniform(-.05, .05)
            path = [polar(R0 - .004, b, Y1 + .001), polar(R0 - .005, b, (Y1 + Y0) / 2), polar(R0 - .004, b, Y0)]
            drip('wheel rim run', path, [(-math.cos(b), 0, -math.sin(b))] * 3, [.0055, .0065, .005], WAX)
            L = g.uniform(.03, .08)
            icicle(polar(R0 - .002, b, Y0 - L), Y0 + .004, g.uniform(.007, .01), 200 + i)
    # The underside: a curtain of shorter ones all round, clustered under the candles.
    for j in range(28):
        i = j % SPOKES
        a = TAU * (i + .5) / SPOKES + g.uniform(-.22, .22)
        near = 1 - min(1.0, abs(a - TAU * (i + .5) / SPOKES) / .22)
        L = .015 + g.uniform(0, .05) + near * g.uniform(0, .05)
        rr = g.uniform(R0 + .008, R1 - .006)
        icicle(polar(rr, a, Y0 - L), Y0 + .004, g.uniform(.006, .01), 300 + j)


# ---- the lantern --------------------------------------------------------------------------------
def lantern():
    with frame(M(scale=LS)):
        lantern_parts()


def lantern_parts():
    """An old iron oil lantern of the hurricane kind: a round tank on a foot ring, a glass globe
    with a wire guard round it, two air tubes up its sides into the cap, a chimney and a bail."""
    lathe('lantern foot', [(0, 0), (.05, 0), (.052, .006), (.046, .01), (0, .01)], OLDIRON, sides=12)
    lathe('lantern tank', [(0, .008), (.046, .008), (.055, .016), (.056, .03), (.05, .038), (.036, .043), (0, .044)],
          OLDIRON, sides=12)
    box('lantern filler', (.03, .044, .018), (.012, .01, .012), OLDIRON, turn=.4)
    lathe('lantern globe', [(0, .042), (.028, .044), (.039, .058), (.043, GLOBE_Y), (.039, .112), (.027, .126),
                            (0, .128)], GLASS, sides=10)
    # The guard: four bowed wires from the tank to the cap and a ring round the globe's belly.
    for k in range(4):
        a = TAU * k / 4 + PI / 4
        tube('lantern guard', [polar(r, a, y) for r, y in ((.036, .042), (.045, .058), (.049, GLOBE_Y),
                                                            (.045, .113), (.034, .128))], .0028, OLDIRON, sides=4)
    torus('lantern guard ring', (0, GLOBE_Y, 0), .049, .003, OLDIRON, seg=12, sides=3)
    # The air tubes: out of the tank's shoulders, up either side and into the cap.
    for sx in (-1, 1):
        tube('lantern tube', [(sx * .05, .036, 0), (sx * .062, .05, 0), (sx * .062, .128, 0), (sx * .048, .142, 0)],
             .0055, OLDIRON, sides=5)
    lathe('lantern cap', [(0, .126), (.048, .126), (.052, .132), (.044, .142), (.028, .152), (.019, .158),
                          (.019, .17), (.025, .172), (.025, .176), (0, .178)], OLDIRON, sides=10)
    # The bail over the top, and the ring it hangs by.
    torus('lantern bail', (0, .15, 0), .058, .0032, OLDIRON, seg=10, sides=4, tilt=PI / 2, arc=PI, start=PI)
    for sx in (-1, 1):
        disc('lantern pivot', (sx * .055, .15, 0), .007, .006, OLDIRON, sides=6, roll=-sx * PI / 2)
    torus('lantern ring', (0, .214, 0), .011, .0032, OLDIRON, seg=8, sides=4, roll=PI / 2)


# ---- the chains ---------------------------------------------------------------------------------
def chains():
    torus('wheel ring', (0, RING_Y, 0), .034, .0075, OLDIRON, seg=12, sides=4)
    for k in range(4):
        a = TAU * (2 * k + 1) / SPOKES
        # An eye standing on the rim over the spoke's strap, where the chain takes hold.
        box('wheel chain plate', polar(RM, a, Y1 + .003), (.036, .006, .03), OLDIRON, turn=-a)
        torus('wheel chain eye', polar(RM, a, Y1 + .017), .011, .0038, OLDIRON, seg=8, sides=4, tilt=PI / 2, turn=-a + PI / 2)
        eye = Vector(polar(RM, a, Y1 + .026))
        d = Vector((math.cos(a), 0, math.sin(a)))
        top = Vector((0, RING_Y - .002, 0)) + d * .03
        chain(tuple(eye), tuple(top), n=max(3, round((top - eye).length / .05)), w=.03, wire=.0045)
    chain((0, RING_Y + .006, 0), (0, RING_TOP, 0), n=4, w=.036, wire=.0055)
    # The lantern's chain, from the eye under the hub down to its ring.
    chain((0, WHEEL_Y - .085, 0), (0, .222 * LS, 0), n=2, w=.028, wire=.0045)


def build():
    spokes()
    rim()
    hub()
    for i, (h, r) in enumerate(CANDLES):
        candle(TAU * (i + .5) / SPOKES, h, r, 600 + i)
    wax()
    lantern()
    chains()
