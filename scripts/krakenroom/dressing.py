"""The Salty Kraken's dressing: every crate, barrel, chest, hoard, net, sail, lantern and candle in the
hall, drawn round the shell (shell.py) and the ship's parts (scripts/krakenkit/). `build(L)` takes the
layout (web/js/kraken-layout.js as a dict, with web/js/kraken-dressing.js under L['DRESSING']).

What stands on a floor is a PROP there, `{ kind, x, z, y, ry, s }`, drawn here by KINDS[kind]; each
kind is a whole stack (a crate with two more on it is one `crate-stack`), so a prop's y is always a
storey's boards. Each kind's footprint is kraken-dressing.js's FOOT, which pirate-tavern.js turns into
every prop's blocker: a kind drawn bigger here needs its FOOT there grown with it.
What nobody can bump into - coins, candles on a table, bottles on a shelf, gold lying flat, all that
hangs from the ceiling or the walls - is placed here directly and is in neither list.

The fixed places the game sits people at are the layout's, not this file's: the six tables in the pit
and their benches (TABLES), the keg table by the cannon and its two keg seats, the chart table, the
captain's chair, the two sloops (SLOOPS). The crew's places and the two figures (CREW_PLACES, FIGURES)
are left free; KEEP_CLEAR holds nothing taller than a coin. Whatever hangs from the rock goes in the
lid (geom.lid); whatever is fixed to the south or east walls in geom.group('near'), which the cutaway
preview leaves out.

The keeper's brief for the big hall (18 x 14 under a vault of 5, a cascade of terraces round an open
pit; refs/krakenkit/renders/concept-grotkroeg-2-richtpunt.jpg): "a nice spacious view that does not
need many decorations on every level". So a few groups placed with intent - barrels and crates in the
corners and against the walls and rails, one heap of gold to a terrace at most, the hold packed with
cargo, the cellar's keg rack and the treasure behind its bars - and the atrium's floor and every way
between the stairs bare. Triangles do not count indoors, so a barrel is its staves and a crate its
planks and battens. The pieces that define the look are placeholders until the keeper has drawn them
(`ph_*`, one function each, see "placeholders" below).
"""
import hatch
import math
from mathutils import Matrix, Vector
import geom
from geom import (TAU, PI, M, frame, lid, group, span, box, rod, disc, ball, lathe, prism, hull, tube,
                  torus, cloth, chain, coil, candle, candles, candlestick, candelabra, goblet, tankard,
                  bottle, coin, gem, scatter, heap, gold_floor, pearls, crown, ingots, skull,
                  skull_lamp_top, lantern, rng, material,
                  OAK, DARK, WOOD, CARVED, IRON, BRASS, GOLD, GOLDHI, SILVER, BONE, BLACK, WAX, ROPE, NET,
                  VELVET, RUG, RUGB, PARCH, INK, FLAG, SACK, PEARL, CLOTH, CHESTW, TABLEW, BOTTLES)

# ---- materials of the dressing's own ----------------------------------------------------------
CRATES = [material('plank:crate', 0x8a6842), material('plank:crate-old', 0x6a5033),
          material('plank:crate-grey', 0x7d705e)]
STAVES = [OAK, material('plank:stave', 0x6e4a2e), material('plank:stave-light', 0x9a6c42)]
CANVAS = material('plain:canvas', 0x9c8c6c)
PEWTER = material('plain:pewter', 0x8a8e94)
LEATHER = material('plain:leather', 0x5a3420)
COATS = [material('plain:coat-red', 0x7a2a26), material('plain:coat-blue', 0x2a3a5a),
         material('plain:coat-green', 0x3f4a2c)]
FLOATS = ['plain:float-teal', 'plain:float-green', material('plain:float-amber', 0xc8902a)]
BOATW = material('plank:boat', 0x6a4a30)
PAINT = material('plain:paint', 0x1a1714)
SAIL = 'plain:sail'

def sp(label, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    """span with its corners in any order."""
    span(label, min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1), min(z0, z1), max(z0, z1), mat, bevel=bevel)


# ---- barrels: staves, hoops and a head ---------------------------------------------------------
def cask(r=.12, h=.28, seed=0, staves=14, hoops=(.07, .28, .72, .93), head=True, bung=True, tap=False):
    """A cask of separate staves (three woods, a hairline of dark core between them), iron hoops
    with a rivet or two, and a head of boards let in below the chime. Stands on y = 0, up +y."""
    g = rng(seed)
    bulge = lambda t: r * (.84 + .16 * (1 - (2 * t - 1) ** 2))
    ts = (0, .12, .3, .5, .7, .88, 1)
    lathe('barrel core', [(0, .003)] + [(bulge(t) * .93, max(.003, min(h - .003, h * t))) for t in ts] + [(0, h - .003)],
          DARK, sides=staves)
    gap = .012
    for k in range(staves):
        a0, a1 = TAU * k / staves + gap, TAU * (k + 1) / staves - gap
        top = h + g.uniform(-.004, .003)
        swell = 1 + g.uniform(-.012, .012)
        pts = []
        for t in ts:
            y = top * t
            for a in (a0, (a0 + a1) / 2, a1):
                rr = bulge(t) * swell
                pts.append((rr * math.cos(a), y, rr * math.sin(a)))
            for a in (a0, a1):
                rr = bulge(t) * .88
                pts.append((rr * math.cos(a), y, rr * math.sin(a)))
        mat = STAVES[0] if g.random() < .5 else STAVES[1 + (k % 2)]
        hull('barrel stave', pts, mat)
    for i, t in enumerate(hoops):
        y = h * t
        rr = bulge(t)
        disc('barrel hoop', (0, y - .009, 0), rr + .005, .018, IRON, sides=staves)
        for j in range(2):
            a = g.uniform(0, TAU)
            ball('hoop rivet', ((rr + .006) * math.cos(a), y, (rr + .006) * math.sin(a)), .004, IRON, seg=4, rings=3)
    if head:
        hr = bulge(1) * .9
        disc('barrel head', (0, h - .018, 0), hr, .008, STAVES[2], sides=staves)
        for dx in (-hr / 3, hr / 3):
            w = math.sqrt(max(hr * hr - dx * dx, 0)) * 2
            box('barrel head seam', (dx, h - .0095, 0), (.003, .002, w * .98), DARK)
        if g.random() < .5:
            disc('barrel bung', (hr * .5, h - .01, -hr * .3), .012, .006, 'plain:cork', sides=6)
    if bung:
        a = g.uniform(0, TAU)
        disc('barrel bung', (bulge(.5) * math.cos(a), h * .5, bulge(.5) * math.sin(a)), .011, .012, 'plain:cork', sides=6,
             turn=-a + PI / 2, tilt=PI / 2)
    if tap:
        rod('barrel tap', (0, h * .18, bulge(.18) - .004), (0, h * .18, bulge(.18) + .04), .008, BRASS, sides=6)
        rod('barrel tap handle', (0, h * .18 + .002, bulge(.18) + .03), (0, h * .18 + .04, bulge(.18) + .03), .005, BRASS, sides=4)
        ball('barrel tap knob', (0, h * .18 + .043, bulge(.18) + .03), .007, BRASS, seg=5, rings=3)


def lying_cask(centre, r, h, turn=0.0, seed=0, tap=False, chocks=True):
    x, y, z = centre
    with frame(M(centre, turn)):
        with frame(M((-h / 2, 0, 0), roll=-PI / 2)):
            cask(r, h, seed, tap=False)
        if tap:
            rod('cask tap', (h / 2 - .004, -r * .5, 0), (h / 2 + .045, -r * .5, 0), .01, BRASS, sides=6)
            rod('cask tap handle', (h / 2 + .03, -r * .5, 0), (h / 2 + .03, -r * .5 + .045, 0), .006, BRASS, sides=4)
        if chocks:
            for sx in (-1, 1):
                prism('chock', [(-r * .9, -r - .002), (r * .9, -r - .002), (r * .5, -r * .55), (-r * .5, -r * .55)], .04, DARK,
                      M((sx * h * .3, 0, 0), PI / 2))


# ---- crates: planks, battens, a brace and nails --------------------------------------------------
def crate(w=.28, h=.26, d=None, seed=0, top=True, mat=None, broken=False):
    """A shipping crate: three planks a side with gaps onto a dark core, corner posts, rim battens
    and a diagonal brace front and back, nails at the battens' ends, planks on top (or none)."""
    g = rng(seed)
    d = d or w
    mat = mat or CRATES[g.randrange(3)]
    t = .013
    sp('crate core', -w / 2 + .01, w / 2 - .01, .004, h - .006, -d / 2 + .01, d / 2 - .01, DARK)
    rows = 3
    for i in range(rows):
        y0 = .02 + (h - .04) * i / rows + .003
        y1 = .02 + (h - .04) * (i + 1) / rows - .003
        for s in (-1, 1):
            if broken and s == 1 and i == rows - 1:
                continue
            m2 = mat if g.random() > .25 else CRATES[g.randrange(3)]
            sp('crate plank', -w / 2 + .026, w / 2 - .026, y0, y1, s * d / 2, s * (d / 2 - t), m2)
            m2 = mat if g.random() > .25 else CRATES[g.randrange(3)]
            sp('crate plank', s * w / 2, s * (w / 2 - t), y0, y1, -d / 2 + .026, d / 2 - .026, m2)
    bat = DARK if g.random() < .5 else CRATES[1]
    for sx in (-1, 1):
        for sz in (-1, 1):
            sp('crate post', sx * (w / 2 + .004), sx * (w / 2 - .026), 0, h, sz * (d / 2 + .004), sz * (d / 2 - .026), bat)
    for y0, y1 in ((0, .022), (h - .022, h)):
        for s in (-1, 1):
            sp('crate batten', -w / 2 + .026, w / 2 - .026, y0, y1, s * (d / 2 + .004), s * (d / 2 - .004), bat)
            sp('crate batten', s * (w / 2 + .004), s * (w / 2 - .004), y0, y1, -d / 2 + .026, d / 2 - .026, bat)
    # The brace, corner to corner on the two faces along x.
    L_ = math.hypot(w - .05, h - .044)
    ang = math.atan2(h - .044, w - .05) * (1 if g.random() < .5 else -1)
    for s in (-1, 1):
        if broken and s == 1:
            continue
        box('crate brace', (0, h / 2, s * (d / 2 + .003)), (L_, .024, .008), bat, roll=ang)
    for sx in (-1, 1):
        for y in (.011, h - .011):
            for s in (-1, 1):
                box('crate nail', (sx * (w / 2 - .04), y, s * (d / 2 + .0065)), (.006, .006, .003), IRON)
    if top:
        n = 3
        for i in range(n):
            z0 = -d / 2 + .004 + (d - .008) * i / n + .003
            z1 = -d / 2 + .004 + (d - .008) * (i + 1) / n - .003
            sp('crate lid', -w / 2 + .004, w / 2 - .004, h - .004, h + .01, z0, z1, mat if i != 1 else CRATES[g.randrange(3)])
        for sx in (-1, 1):
            sp('crate lid batten', sx * (w / 2 - .045), sx * (w / 2 - .075), h + .01, h + .02, -d / 2 + .01, d / 2 - .01, bat)
    # A stencilled mark on some: crossed bones, or a painted X.
    mark = g.random()
    if mark < .35:
        for a in (.7, -.7):
            box('crate stencil', (0, h * .5, d / 2 + .0015), (w * .45, .012, .002), PAINT, roll=a)
    elif mark < .55:
        for a in (.6, -.6):
            box('crate stencil', (0, h * .45, d / 2 + .0015), (w * .38, .01, .002), BONE, roll=a)
        disc('crate stencil', (0, h * .62, d / 2 + .0005), .028, .002, BONE, sides=8, tilt=PI / 2)


def broken_crate(w=.28, h=.24, seed=0):
    """A crate stove in: lid gone, a front plank snapped and lying at its foot, a heap of gold standing
    proud of the rim and running out through the hole."""
    crate(w, h, seed=seed, top=False, broken=True)
    g = rng(seed + 1)
    heap((0, h * .55, 0), w * .47, .11, coins=18, seed=seed + 2, gems=3)
    hull('gold spill', [(-.07, h - .02, w / 2 - .02), (.07, h - .03, w / 2 - .02), (-.05, h * .55, w / 2 + .01),
                        (.06, h * .55, w / 2 + .01), (-.1, 0, w / 2 + .1), (.09, 0, w / 2 + .11), (-.1, 0, w / 2),
                        (.09, 0, w / 2), (0, .04, w / 2 + .05)], GOLD)
    scatter(0, w / 2 + .14, 0, .02, .12, 14, seed + 3, arc=(-PI * .1, PI * 1.1))
    with frame(M((.04, .012, w / 2 + .09), .5)):
        box('crate plank', (0, 0, 0), (w * .8, .012, h / 3 - .006), CRATES[g.randrange(3)], tilt=PI / 2 - .1, roll=.1)
    with frame(M((-w / 2 - .02, 0, .02), PI / 2 + .3)):
        # The lid, leaning against its side.
        with frame(M((0, 0, 0), tilt=-.25)):
            for i in range(3):
                sp('crate lid', -w / 2, w / 2, 0, .012, -.01 + i * .07, .05 + i * .07, CRATES[g.randrange(3)])
    gem((0.04, h + .06, .02), .012, seed=seed + 4)


# ---- chests ------------------------------------------------------------------------------------------
def chest_closed(w=.36, d=.22, h=.16, seed=0):
    """A sea chest shut: leather-bound, a rounded lid, iron straps and corners, a brass lock, rope
    handles; sometimes a sleeve of velvet caught under the lid and a coin or two dropped by it."""
    g = rng(seed)
    wood = CHESTW if g.random() < .6 else CRATES[1]
    sp('chest', -w / 2, w / 2, .012, h, -d / 2, d / 2, wood, bevel=.006)
    sp('chest plinth', -w / 2 - .008, w / 2 + .008, 0, .02, -d / 2 - .008, d / 2 + .008, DARK, bevel=.004)
    rise = d * .32
    outline = [(-(d / 2) * math.cos(t), rise * math.sin(t)) for t in [PI * i / 8 for i in range(9)]]
    prism('chest lid', [(-u, v) for u, v in reversed(outline)], w, wood, M((0, h, 0), PI / 2))
    sp('chest lid rim', -w / 2 - .004, w / 2 + .004, h - .006, h + .008, -d / 2 - .004, d / 2 + .004, DARK)
    for x in (-w * .32, 0, w * .32) if w > .3 else (-w * .3, w * .3):
        sp('chest strap', x - .014, x + .014, .01, h, -d / 2 - .004, d / 2 + .004, IRON)
        ring = [(x, h + v, u) for u, v in [(-(d / 2 + .004) * math.cos(t), (rise + .004) * math.sin(t)) for t in [PI * i / 8 for i in range(9)]]]
        tube('chest lid strap', ring, .006, IRON, sides=4)
        for y in (.05, .11):
            ball('chest rivet', (x, y, d / 2 + .005), .004, BRASS, seg=4, rings=3)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box('chest corner', (sx * (w / 2 - .01), h / 2, sz * (d / 2 - .01)), (.026, h + .004, .026), IRON)
        torus('chest handle', (sx * (w / 2 + .012), h * .6, 0), .022, .005, ROPE, seg=6, sides=4, roll=PI / 2, arc=PI, start=0)
    span('chest lock', -.03, .03, h - .06, h + .012, d / 2, d / 2 + .008, BRASS)
    span('chest keyhole', -.005, .005, h - .04, h - .02, d / 2 + .006, d / 2 + .01, BLACK)
    if g.random() < .5:
        sp('chest caught', -.1, -.04, h - .004, h - .045, d / 2 + .002, d / 2 + .008, VELVET)
        pearls([(.08, h + .002, d / 2 + .004), (.1, h - .04, d / 2 + .01), (.11, h - .1, d / 2 + .012)], n=7)
    scatter(0, d / 2 + .06, 0, .01, .06, 5, seed + 5, arc=(0, PI))


# ---- the gold ---------------------------------------------------------------------------------------
def hoard(R=.24, H=.17, seed=0, crown_=True):
    heap((0, 0, 0), R, H, coins=int(200 * R), seed=seed, gems=int(28 * R))
    scatter(0, 0, 0, R * .92, R * 1.5, int(120 * R), seed + 1)
    g = rng(seed + 2)
    if crown_:
        crown((g.uniform(-.03, .03), H * .96, g.uniform(-.03, .03)), s=1.0 + R, seed=seed + 3)
    goblet((R * .8, 0, R * .5), s=1.2, tilt=1.4, turn=g.uniform(0, TAU), mat=GOLDHI)
    pearls([(-R * .7, H * .45, R * .1), (-R * .9, H * .2, R * .4), (-R * 1.2, .006, R * .5), (-R * 1.3, .004, R * .8)], n=10)
    for i in range(3):
        a = g.uniform(0, TAU)
        gem((R * 1.1 * math.cos(a), .006, R * 1.1 * math.sin(a)), .011, seed=seed + 10 + i)


def sack(seed=0, gold=False):
    lathe('sack', [(0, 0), (.1, 0), (.13, .04), (.125, .1), (.09, .15), (.05, .17), (.062, .2), (.035, .215), (0, .2)],
          SACK, sides=9)
    torus('sack tie', (0, .17, 0), .05, .007, ROPE, seg=8, sides=3)
    for k in range(3):
        a = TAU * k / 3 + seed
        rod('sack fold', (.12 * math.cos(a), .03, .12 * math.sin(a)), (.08 * math.cos(a + .3), .15, .08 * math.sin(a + .3)),
            .01, SACK, sides=4)
    if gold:
        heap((0, .19, 0), .06, .045, coins=8, seed=seed + 1)
        hull('gold spill', [(.05, .17, .06), (.09, .12, .1), (.14, .0, .16), (.2, 0, .26), (.08, 0, .3), (.03, .15, .08),
                            (.12, .01, .1), (.1, .05, .15)], GOLD)
        scatter(.12, .28, 0, .01, .12, 14, seed + 2)
        coin((.04, .215, .02), tilt=.4)


# ---- the kinds ----------------------------------------------------------------------------------
def top_things(y, g, seed):
    """What stands on a barrel head: candles, a skull, a tankard, a bottle, or nothing."""
    k = g.random()
    if k < .3:
        candles((g.uniform(-.02, .02), y, g.uniform(-.02, .02)), 3, seed, spread=.04)
    elif k < .45:
        tankard((.02, y, -.02), turn=g.uniform(0, TAU), mat=PEWTER if g.random() < .5 else WOOD)
        scatter(-.03, .03, y, 0, .04, 4, seed)
    elif k < .6:
        bottle(g.choice(['wine', 'rum', 'gin', 'jug']), (.02, y, .01), BOTTLES[g.randrange(len(BOTTLES))],
               label=PARCH if g.random() < .5 else None)
        candle((-.04, y, -.02), h=.04, r=.01, drips=3, seed=seed)
    elif k < .68:
        with frame(M((0, y, 0), g.uniform(-1, 1))):
            skull(glow=False)


def k_barrel(g, seed):
    cask(.12, .28, seed, tap=g.random() < .2)
    top_things(.28, g, seed)


def k_barrel_small(g, seed):
    cask(.09, .2, seed, staves=12, hoops=(.1, .9))
    top_things(.2, g, seed)


def k_barrel_tall(g, seed):
    cask(.12, .28, seed)
    with frame(M((g.uniform(-.01, .01), .28, 0), g.uniform(0, TAU))):
        cask(.105, .26, seed + 1)
        candles((0, .26, 0), 4, seed + 2, spread=.045)


def k_barrel_skull(g, seed):
    cask(.12, .28, seed)
    with frame(M((0, .28, 0), g.uniform(-.5, .5), scale=1.15)):
        skull()
        skull_lamp_top(.098, seed=seed + 3)
    scatter(0, 0, .28, .06, .1, 5, seed + 4)


def k_barrel_rack(g, seed):
    for sx in (-1, 1):
        prism('rack chock', [(-.25, 0), (.25, 0), (.2, .05), (-.2, .05)], .04, DARK, M((0, 0, sx * .1), 0))
    for i, x in enumerate((-.13, .13)):
        with frame(M((x, .105, -.15), tilt=PI / 2)):
            cask(.1, .3, seed + i, staves=12)
    with frame(M((0, .27, -.14), tilt=PI / 2)):
        cask(.095, .28, seed + 5, staves=12)
    candles((0, .37, .02), 2, seed + 7, spread=.02)


def k_cask(g, seed):
    lying_cask((0, .215, 0), .2, .5, seed=seed, tap=True, chocks=False)
    for sx in (-1, 1):
        prism('cask cradle', [(-.23, 0), (.23, 0), (.23, .04), (.14, .06), (.06, .1), (-.06, .1), (-.14, .06), (-.23, .04)],
              .05, DARK, M((sx * .16, 0, 0), PI / 2))
    tankard((.29, 0, .08), mat=PEWTER)
    candles((0, .415, 0), 3, seed + 3, spread=.04)
    gold_floor(.3, -.05, .07, seed + 4, y=0, coins=3)


def k_keg_rack(g, seed):
    for dz in (-.37, .37):
        prism('rack end', [(-.12, 0), (.12, 0), (.12, .12), (0, .43), (-.12, .12)], .03, DARK, Matrix.Translation((0, 0, dz)))
    sp('rack rail', -.12, .12, 0, .03, -.4, .4, DARK)
    for sx in (-1, 1):
        rod('rack stringer', (sx * .1, .06, -.38), (sx * .1, .06, .38), .012, DARK, sides=4)
    for row, count in ((0, 3), (1, 2), (2, 1)):
        for i in range(count):
            kz = (i - (count - 1) / 2) * .14
            ky = .1 + row * .115
            with frame(M((-.09, ky, kz), roll=-PI / 2)):
                cask(.063, .18, seed + row * 3 + i, staves=10, hoops=(.12, .88), bung=False)
            rod('keg spigot', (.09, ky, kz), (.125, ky, kz), .006, BRASS, sides=4)
            rod('keg spigot handle', (.115, ky, kz), (.115, ky + .02, kz), .004, BRASS, sides=3)
    candles((0, .43, 0), 2, seed + 20, spread=.015)


def k_crate(g, seed):
    crate(.28, .26, seed=seed)
    if g.random() < .5:
        top_things(.28, g, seed)


def k_crate_small(g, seed):
    crate(.2, .18, seed=seed)
    if g.random() < .5:
        top_things(.2, g, seed)


def k_crate_stack(g, seed):
    crate(.3, .28, seed=seed)
    with frame(M((g.uniform(-.02, .02), .3, g.uniform(-.02, .02)), g.uniform(-.4, .4))):
        crate(.24, .21, seed=seed + 1)
        with frame(M((g.uniform(-.02, .02), .23, 0), g.uniform(-.5, .5))):
            if g.random() < .5:
                crate(.16, .14, seed=seed + 2)
                lantern((0, .21, 0), s=1.2)
            else:
                cask(.075, .13, seed + 3, staves=10, hoops=(.15, .85))
                candles((0, .13, 0), 2, seed + 4, spread=.02)


def k_crate_wide(g, seed):
    for i, x in enumerate((-.15, .15)):
        with frame(M((x, 0, 0), g.uniform(-.05, .05))):
            crate(.28, .27, seed=seed + i)
    with frame(M((.04, .29, 0), .12)):
        crate(.26, .23, seed=seed + 3)
        top_things(.25, g, seed + 4)
    with frame(M((-.2, .29, .02), -.3)):
        ingots((0, 0, 0), .2)


def k_crate_gold(g, seed):
    broken_crate(.28, .24, seed)


def k_crate_barrel(g, seed):
    crate(.3, .27, seed=seed)
    with frame(M((0, .29, 0), g.uniform(0, TAU))):
        cask(.1, .22, seed + 1, staves=12)
        top_things(.22, g, seed + 2)


def k_chest(g, seed):
    ph_chest_open(.42, .26, .2, seed)


def k_chest_closed(g, seed):
    chest_closed(.36, .22, .16, seed)
    if g.random() < .5:
        with frame(M((.06, .23, 0), .3)):
            chest_closed(.18, .12, .08, seed + 1)
    elif g.random() < .5:
        candles((-.08, .22, 0), 2, seed + 2, spread=.02)


def k_hoard(g, seed):
    hoard(.24, .17, seed)


def k_hoard_small(g, seed):
    heap((0, 0, 0), .14, .09, coins=24, seed=seed, gems=3)
    scatter(0, 0, 0, .13, .24, 22, seed + 1)
    if g.random() < .5:
        goblet((.06, .07, 0), s=1.1, tilt=.4)


def k_ingots(g, seed):
    ingots((0, 0, 0))
    coin((.07, .004, .05), turn=1)


def k_sack(g, seed):
    sack(seed)


def k_sack_gold(g, seed):
    sack(seed, gold=True)


def k_cannon(g, seed):
    ph_cannon()


def k_shot_pile(g, seed):
    """Round shot stacked six, three and one on a little tray."""
    r = .028
    s3 = math.sqrt(3)
    for layer, n in ((0, 3), (1, 2), (2, 1)):
        z0 = layer * s3 * r / 3 - 2 * s3 * r / 3
        for i in range(n):
            for j in range(n - i):
                ball('cannon shot', ((j - (n - 1 - i) / 2) * 2 * r, .01 + r + layer * 1.633 * r, z0 + i * s3 * r), r, BLACK, seg=8, rings=5)
    sp('shot rack', -.085, .085, 0, .01, -.08, .08, DARK)


def k_woodpile(g, seed):
    for z in (-.23, .23):
        for x in (-.13, .13):
            sp('woodpile stake', x - .015, x + .015, 0, .26, z - .015, z + .015, DARK)
    gg = rng(seed)
    for row in range(4):
        for i in range(4 - (row % 2)):
            y = .03 + row * .05
            x = -.1 + i * .066 + (row % 2) * .033
            rod('woodpile log', (x, y, -.24), (x + gg.uniform(-.01, .01), y, .24), .026 + gg.uniform(-.004, .004),
                WOOD if (i + row) % 3 else DARK, sides=7)
            disc('log end', (x, y, .24), .022, .004, 'plain:sack', sides=7, tilt=PI / 2)
    rod('axe haft', (.16, 0, .2), (.12, .3, .14), .008, WOOD, sides=5)
    hull('axe head', [(.12, .3, .14), (.12, .27, .13), (.08, .31, .12), (.07, .26, .11), (.12, .3, .15), (.075, .285, .125)], IRON)


def k_coil(g, seed):
    coil((0, 0, 0), r0=.1, turns=3, layers=2, thick=.02)


def k_globe(g, seed):
    ph_globe()


def k_telescope(g, seed):
    ph_telescope()


def k_candle_stand(g, seed):
    """A tall iron floor pricket, the wax of a hundred nights run down it and over its dish."""
    for k in range(3):
        a = TAU * k / 3
        tube('stand foot', [(0, .08, 0), (.05 * math.cos(a), .03, .05 * math.sin(a)), (.08 * math.cos(a), 0, .08 * math.sin(a)),
                            (.09 * math.cos(a), .012, .09 * math.sin(a))], .007, IRON, sides=4)
    rod('stand stem', (0, .06, 0), (0, .52, 0), .009, IRON, sides=6)
    for y in (.2, .38):
        ball('stand knop', (0, y, 0), .016, IRON, seg=6, rings=4)
    lathe('stand dish', [(0, .5), (.05, .51), (.06, .525), (.055, .53), (0, .525)], IRON, sides=10)
    candle((0, .525, 0), h=.08, r=.02, drips=5, seed=seed)
    gg = rng(seed)
    for i in range(8):
        a = gg.uniform(0, TAU)
        rod('stand wax', (.05 * math.cos(a), .53, .05 * math.sin(a)), (.058 * math.cos(a), .53 - gg.uniform(.04, .16), .058 * math.sin(a)),
            .006, WAX, top=.002, sides=4)
    ball('stand wax pool', (0, .528, 0), (.058, .01, .058), WAX, seg=8, rings=3)


KINDS = {
    'barrel': k_barrel, 'barrel-small': k_barrel_small, 'barrel-tall': k_barrel_tall, 'barrel-skull': k_barrel_skull,
    'barrel-rack': k_barrel_rack, 'cask': k_cask, 'keg-rack': k_keg_rack,
    'crate': k_crate, 'crate-small': k_crate_small, 'crate-stack': k_crate_stack, 'crate-wide': k_crate_wide,
    'crate-gold': k_crate_gold, 'crate-barrel': k_crate_barrel,
    'chest': k_chest, 'chest-closed': k_chest_closed, 'hoard': k_hoard, 'hoard-small': k_hoard_small,
    'ingots': k_ingots, 'sack': k_sack, 'sack-gold': k_sack_gold, 'cannon': k_cannon, 'shot-pile': k_shot_pile,
    'woodpile': k_woodpile, 'coil': k_coil, 'globe': k_globe, 'telescope': k_telescope, 'candle-stand': k_candle_stand,
}


# ---- the fixed places -----------------------------------------------------------------------------
TABLE_H, BENCH_Y = .2, .135


def tables(L):
    """The trestle tables (1.5 x 0.5, top at 0.2) with a bench each side 0.32 out (seat at 0.135):
    the crew sit on those, the player on what is left, and a drink goes where a place is, so the
    table's own clutter keeps to its middle strip and its ends. They stand in the pit."""
    F = L['LEVEL']['pit']
    for n, t in enumerate(L['TABLES']):
        tx, tz, seed = t['x'], t['z'], 71 + n
        hatch.hatch_top(tx, tz, F + TABLE_H, 1.5, .5, seed=seed)   # scripts/krakenkit/hatch.py
        for sx in (-1, 1):
            lx = tx + sx * .6
            span('trestle foot', lx - .03, lx + .03, F, F + .04, tz - .21, tz + .21, DARK, bevel=.008)
            span('trestle post', lx - .022, lx + .022, F + .04, F + TABLE_H - .025, tz - .05, tz + .05, DARK, bevel=.006)
            span('trestle cleat', lx - .025, lx + .025, F + TABLE_H - .03, F + TABLE_H, tz - .22, tz + .22, DARK, bevel=.006)
            for sz in (-1, 1):
                rod('trestle knee', (lx, F + .04, tz + sz * .18), (lx, F + TABLE_H - .03, tz + sz * .06), .012, DARK, sides=4)
        span('trestle stretcher', tx - .6, tx + .6, F + .08, F + .11, tz - .02, tz + .02, DARK, bevel=.006)
        for sx in (-1, 1):
            rod('trestle wedge', (tx + sx * .66, F + .095, tz - .03), (tx + sx * .66, F + .095, tz + .03), .008, OAK, sides=4)
        for sz in (-1, 1):
            bz = tz + sz * .32
            span('bench', tx - .65, tx + .65, F + BENCH_Y - .025, F + BENCH_Y, bz - .05, bz + .05, TABLEW, bevel=.006)
            for bx in (-.5, .5):
                span('bench leg', tx + bx - .02, tx + bx + .02, F, F + BENCH_Y - .025, bz - .04, bz + .04, DARK, bevel=.005)
            span('bench rail', tx - .5, tx + .5, F + .04, F + .06, bz - .01, bz + .01, DARK)
        top = F + TABLE_H + .028
        # A candle stuck in a green bottle in the middle with its wax down the glass, coins, dice.
        bottle('wine', (tx - .02, top, tz), 'plain:bottle-green', s=.85)
        candle((tx - .02, top + .08, tz), h=.05, r=.009, drips=4, seed=seed)
        g = rng(seed)
        for i in range(8):
            a = g.uniform(0, TAU)
            rod('bottle wax', (tx - .02 + .0075 * math.cos(a), top + .078, tz + .0075 * math.sin(a)),
                (tx - .02 + .016 * math.cos(a), top + g.uniform(.01, .06), tz + .016 * math.sin(a)), .0045, WAX, top=.002, sides=4)
        ball('bottle wax pool', (tx - .02, top + .003, tz), (.03, .006, .03), WAX, seg=8, rings=3)
        scatter(tx + .15, tz, top, 0, .05, 9, seed + 1)
        for k in range(4):
            coin((tx + .15, top + .002 + k * .0042, tz + .02), turn=k * .7)
        scatter(tx - .55, tz, top, 0, .05, 6, seed + 2)
        goblet((tx + .62, top, tz + .03), mat=GOLDHI if n % 2 else GOLD)
        tankard((tx - .66, top, tz - .05), turn=1.0 + n, mat=PEWTER)
        for i in range(3):
            box('die', (tx - .2 + i * .026, top + .009, tz - .02 + (i % 2) * .02), (.018, .018, .018), BONE, turn=i * .7)
        disc('plate', (tx + .3, top, tz), .045, .006, PEWTER, sides=10)
        ball('bone', (tx + .3, top + .012, tz), (.03, .01, .01), BONE, seg=6, rings=3, turn=.5)
    # A few things of each table's own: cards and a pistol on the first, an oyster with a pearl and a
    # map with a dagger through it on the second, a skull with a candle on the third.
    t1, t2, t3 = L['TABLES'][0], L['TABLES'][1], L['TABLES'][2]
    top = F + TABLE_H + .028
    for i in range(6):
        box('card', (t1['x'] - .33 + i * .02, top + .001 + i * .0008, t1['z'] + (i % 2) * .012 - .005), (.028, .0015, .04),
            PARCH, turn=i * .25)
    pistol((t1['x'] + .42, top, t1['z'] - .02), .4)
    disc('oyster', (t2['x'] + .45, top, t2['z']), .03, .008, 'plain:shell', sides=7)
    box('oyster lid', (t2['x'] + .45, top + .02, t2['z'] - .025), (.055, .004, .04), 'plain:shell', tilt=-1.0)
    ball('pearl', (t2['x'] + .45, top + .016, t2['z']), .011, PEARL, seg=6, rings=4)
    treasure_map(M((t2['x'] - .32, top + .001, t2['z']), .15))
    with frame(M((t3['x'] - .35, top, t3['z']), .6, scale=1.1)):
        skull(glow=False)
        skull_lamp_top(.098, seed=77)


def pistol(at, turn):
    with frame(M(at, turn)):
        rod('pistol barrel', (0, .012, 0), (.14, .012, 0), .007, IRON, sides=6)
        disc('pistol muzzle', (.14, .012, 0), .009, .01, BRASS, sides=6, roll=-PI / 2)
        hull('pistol stock', [(-.01, .004, -.01), (-.01, .004, .01), (-.01, .022, -.01), (-.01, .022, .01), (-.07, 0, -.012),
                              (-.07, 0, .012), (-.085, .03, -.014), (-.085, .03, .014), (-.06, .03, 0)], WOOD)
        ball('pistol butt', (-.085, .015, 0), (.014, .016, .016), BRASS, seg=6, rings=4)
        box('pistol lock', (-.005, .02, .01), (.03, .012, .004), IRON)


def treasure_map(m, dagger=True):
    with frame(m):
        span('map', -.1, .1, 0, .002, -.065, .065, PARCH)
        for z in (-.07, .07):
            rod('map roll', (-.1, .006, z), (.1, .006, z), .007, PARCH, sides=5)
        tube('map coast', [(-.07, .003, -.03), (-.03, .003, -.04), (.01, .003, -.01), (.04, .003, -.03), (.06, .003, .02),
                           (.03, .003, .04), (-.05, .003, .03), (-.07, .003, -.03)], .002, INK, sides=3)
        tube('map track', [(-.08, .003, .05), (-.04, .003, .02), (0, .003, .03), (.03, .003, .015)], .0012, VELVET, sides=3)
        for turn in (-.78, .78):
            box('map cross', (.03, .003, .018), (.024, .002, .004), VELVET, turn=turn)
        if dagger:
            rod('dagger blade', (.03, .0, .018), (.03, .07, .018), .005, SILVER, top=.001, sides=4)
            rod('dagger guard', (.012, .07, .018), (.048, .07, .018), .004, GOLD, sides=4)
            rod('dagger grip', (.03, .07, .018), (.03, .1, .018), .005, 'plain:ink', sides=5)
            ball('dagger pommel', (.03, .105, .018), .007, GOLD, seg=5, rings=3)


def snug(L):
    """The keg table by the cannon (a keg 0.13 round, 0.22 tall) and the two small kegs sat on (0.09,
    0.14) with a sack for a cushion: the game sits you at 0.16. On the ground."""
    T = L['LEVEL']['ground']
    st = L['KEG_TABLE']
    with frame(M((st['x'], T, st['z']), .3)):
        cask(.13, .22, 901, staves=16, hoops=(.08, .3, .7, .92), bung=False)
        disc('keg table top', (0, .22, 0), .135, .01, OAK, sides=14)
        candlestick((-.03, .23, 0), h=.05, s=.8, mat=SILVER, seed=1000)
        scatter(.02, -.07, .23, 0, .04, 6, 1001)
        box('card', (.06, .232, .02), (.028, .0015, .04), PARCH, turn=.4)
    for i, k in enumerate(L['KEG_SEATS']):
        with frame(M((k['x'], T, k['z']), k.get('yaw', 0))):
            cask(.09, .14, 910 + i, staves=12, hoops=(.15, .85), head=True, bung=False)
            lathe('keg cushion', [(0, .14), (.075, .14), (.085, .148), (.07, .158), (0, .16)], SACK, sides=10)


# ---- the hearth -------------------------------------------------------------------------------------
def hearth(L):
    """What the hearth holds round its fire (the stone is the shell's; the fire basket with its logs
    and ash is the kit's firebasket, placed by pirate-tavern.js; the flame is the game's): fire irons,
    a ship's wheel on the chimney breast with crossed cutlasses over it, candles and gold on the
    mantel, a rug with a gold border before it. The shell's numbers: the jambs' face at HEARTH.x +
    0.35, the opening 0.42 each side of HEARTH.z, the mantel's top at F + 1.05 and 0.1 proud of the
    jambs, the breast 0.38 out of the wall at the mantel and 0.32 at the wheel."""
    F = L['F']
    hx, hz = L['HEARTH']['x'], L['HEARTH']['z']
    front = hx + .35
    fz = hz + .55
    rod('iron stand', (front + .07, F, fz), (front + .07, F + .36, fz), .006, IRON, sides=4)
    disc('iron stand foot', (front + .07, F, fz), .04, .008, IRON, sides=6)
    rod('poker', (front + .06, F + .01, fz + .03), (front + .07, F + .36, fz + .005), .005, IRON, sides=4)
    rod('shovel', (front + .1, F + .03, fz - .03), (front + .075, F + .36, fz - .005), .005, IRON, sides=4)
    box('shovel blade', (front + .1, F + .03, fz - .03), (.05, .06, .008), IRON, turn=.3)
    rod('tongs', (front + .04, F + .01, fz), (front + .065, F + .36, fz), .004, IRON, sides=4)
    # The mantel's things: candlesticks, candle clusters with their wax over the edge, a goblet, a rum
    # bottle, a casket of jewels, a skull.
    my = F + 1.05
    mx = front - .07
    lip = front + .1
    for dz, seed in ((-.64, 1), (.64, 2)):
        candlestick((mx - .05, my, hz + dz), h=.06, seed=seed)
    candles((mx, my, hz - .44), 4, 11, spread=.045)
    candles((mx, my, hz + .46), 3, 12, spread=.04)
    for i in range(12):
        g = rng(40 + i)
        z = hz + g.choice((-1, 1)) * g.uniform(.3, .6)
        rod('mantel wax', (lip - .004, my, z), (lip, my - g.uniform(.03, .1), z + g.uniform(-.005, .005)), .006, WAX, top=.002, sides=4)
    goblet((mx, my, hz - .24), s=1.2)
    bottle('rum', (mx, my, hz - .1), 'plain:rum', label=PARCH)
    with frame(M((mx, my, hz + .06), PI / 2 - .3, scale=.9)):
        skull(glow=False)
        skull_lamp_top(.098, seed=45)
    with frame(M((mx, my, hz + .26), PI / 2 + .2)):
        span('casket', -.05, .05, 0, .045, -.035, .035, CHESTW, bevel=.004)
        box('casket lid', (0, .075, -.04), (.1, .006, .06), CHESTW, tilt=-1.2)
        heap((0, .03, 0), .04, .03, coins=5, seed=40, gems=3)
        pearls([(-.05, .04, .03), (-.06, .02, .05), (-.07, .0, .05)], n=6)
    scatter(mx + .02, hz + .36, my, 0, .05, 7, 44)
    for k in range(5):
        coin((mx + .03, my + .002 + k * .0042, hz - .34), turn=k)
    # Crossed cutlasses over the wheel on the chimney breast (the wheel is the kit's, helm.py at KIT.helm),
    # on the breast's face, hx + 0.30 at that height (at the hall's west wall + 0.34 they were 0.2 inside the stone).
    crossed_cutlasses((hx + .32, F + 2.0, hz), PI / 2)
    # The rug before the hearthstone, and a scatter of coins someone dropped by the fire.
    x0, x1, z0, z1 = front + .3, front + 1.12, hz - .55, hz + .55
    span('rug', x0, x1, F, F + .004, z0, z1, RUG)
    for (a0, a1, b0, b1) in ((x0 + .04, x1 - .04, z0 + .04, z0 + .08), (x0 + .04, x1 - .04, z1 - .08, z1 - .04),
                             (x0 + .04, x0 + .08, z0 + .04, z1 - .04), (x1 - .08, x1 - .04, z0 + .04, z1 - .04)):
        span('rug border', a0, a1, F + .004, F + .006, b0, b1, RUGB)
    ball('rug medallion', ((x0 + x1) / 2, F + .005, (z0 + z1) / 2), (.12, .002, .18), RUGB, seg=8, rings=3)
    for z in [z0 + .03 + i * .045 for i in range(int((z1 - z0) / .045))]:
        for x in (x0, x1):
            span('rug fringe', x - .02, x + .02, F, F + .002, z, z + .012, PARCH)
    scatter(front + .15, hz - .2, F + .01, 0, .12, 6, 46)


SOOT_ = 'plain:soot'


def cutlass(m, jewel=True):
    with frame(m):
        blade = [(0, .008), (.1, .012), (.2, .014), (.27, .011), (.32, -.004), (.3, -.012), (.2, -.013), (.1, -.01), (0, -.008)]
        prism('cutlass blade', blade, .004, SILVER)
        lathe('cutlass guard', [(0, -.008), (.03, -.004), (.032, 0), (0, .006)], GOLD, sides=8, roll=-PI / 2)
        rod('cutlass grip', (-.075, 0, 0), (0, 0, 0), .008, 'plain:ink', sides=6)
        ball('cutlass pommel', (-.082, 0, 0), .012, GOLD, seg=6, rings=4)
        tube('cutlass bow', [(.004, -.03, 0), (-.03, -.034, 0), (-.06, -.026, 0), (-.08, -.012, 0)], .0035, GOLD, sides=4)
        if jewel:
            gem((0, 0, .006), .007, which='plain:ruby')


def crossed_cutlasses(at, turn):
    with frame(M(at, turn)):
        cutlass(M((-.12, -.1, .012), roll=.65))
        # Its other face to the room (tilt), which flips y after the roll: PI + 0.65 brings its blade up
        # to the left, crossing the first. PI - 0.65 pointed it down, through the wheel under it.
        cutlass(M((.12, -.1, .02), roll=PI + .65, tilt=PI), jewel=False)


# ---- on the walls --------------------------------------------------------------------------------
def wanted_board(m):
    with frame(m):
        span('wanted board', -.25, .25, 0, .36, 0, .02, WOOD, bevel=.006)
        for i, (x, rz) in enumerate(((-.15, -.08), (0.0, .03), (.15, .09))):
            with frame(M((x, .2 - (i % 2) * .03, .022), roll=rz)):
                span('wanted bill', -.06, .06, -.08, .08, 0, .003, PARCH)
                span('wanted face', -.03, .03, -.02, .045, .002, .005, INK)
                for y in (-.04, -.055, -.068):
                    span('wanted line', -.045, .045, y, y + .006, .002, .005, INK)
                ball('wanted nail', (0, .07, .005), .006, IRON, seg=4, rings=3)
        with frame(M((.1, .05, .025), roll=.3)):
            rod('knife', (0, 0, 0), (.1, 0, 0), .004, SILVER, top=.001, sides=4)
            rod('knife grip', (-.05, 0, 0), (0, 0, 0), .007, WOOD, sides=5)


def wall_map(m):
    """A treasure map nailed to a wall, a dagger through its X."""
    with frame(m):
        span('wall map', -.16, .16, -.11, .11, 0, .003, PARCH)
        for y in (-.115, .115):
            rod('wall map roll', (-.16, y, .008), (.16, y, .008), .009, PARCH, sides=5)
        tube('wall map coast', [(-.11, -.05, .004), (-.05, -.07, .004), (.02, -.02, .004), (.08, -.05, .004), (.12, .03, .004),
                                (.05, .07, .004), (-.08, .06, .004), (-.11, -.05, .004)], .003, INK, sides=3)
        tube('wall map track', [(-.12, -.09, .004), (-.06, -.03, .004), (0, .0, .004), (.05, .02, .004)], .0018, VELVET, sides=3)
        for a in (.78, -.78):
            box('wall map cross', (.05, .02, .005), (.04, .006, .002), VELVET, roll=a)
        rod('dagger blade', (.05, .02, 0), (.05, .02, .09), .005, SILVER, top=.004, sides=4)
        rod('dagger guard', (.03, .02, .09), (.07, .02, .09), .004, GOLD, sides=4)
        rod('dagger grip', (.05, .02, .09), (.05, .02, .13), .006, 'plain:ink', sides=5)
        ball('dagger pommel', (.05, .02, .135), .008, GOLD, seg=5, rings=3)
        for p in ((-.15, .1), (.15, .1), (-.15, -.1), (.15, -.1)):
            ball('nail', (p[0], p[1], .004), .006, IRON, seg=4, rings=3)


def shelf(x0, x1, y, zw, normal, axis, items_seed, depth=.14, what='mixed'):
    """A plank shelf on two iron brackets against a wall, and what stands on it. `axis` 'x' means the
    shelf runs along x on a wall at z = zw facing `normal` (+1/-1 in z); 'z' along z on a wall at x = zw."""
    g = rng(items_seed)
    if axis == 'x':
        z0, z1 = zw, zw + normal * depth
        sp('shelf', x0, x1, y - .022, y, z0, z1, OAK, bevel=.004)
        for x in (x0 + .08, x1 - .08):
            prism('shelf bracket', [(0, 0), (0, -.1), (depth * .8, 0)], .012, IRON,
                  M((x, y - .022, zw), -PI / 2 if normal > 0 else PI / 2))
        spots = [(x0 + .06 + (x1 - x0 - .12) * (i + .5) / max(1, int((x1 - x0) / .09)), (z0 + z1) / 2)
                 for i in range(max(1, int((x1 - x0) / .09)))]
    else:
        x0_, x1_ = zw, zw + normal * depth
        sp('shelf', x0_, x1_, y - .022, y, x0, x1, OAK, bevel=.004)
        for z in (x0 + .08, x1 - .08):
            prism('shelf bracket', [(0, 0), (0, -.1), (depth * .8, 0)], .012, IRON,
                  M((zw, y - .022, z), 0 if normal > 0 else PI))
        spots = [((x0_ + x1_) / 2, x0 + .06 + (x1 - x0 - .12) * (i + .5) / max(1, int((x1 - x0) / .09)))
                 for i in range(max(1, int((x1 - x0) / .09)))]
    for i, (px, pz) in enumerate(spots):
        k = g.random()
        seed = items_seed * 10 + i
        if k < .4:
            bottle(g.choice(['wine', 'rum', 'gin', 'flask', 'jug']), (px, y, pz), BOTTLES[g.randrange(len(BOTTLES))],
                   s=g.uniform(1.0, 1.25), turn=g.uniform(0, PI), label=PARCH if g.random() < .5 else None)
        elif k < .6:
            candles((px, y, pz), g.randrange(2, 5), seed, spread=.035)
        elif k < .7:
            with frame(M((px, y, pz), (0 if axis == 'x' and normal > 0 else PI if axis == 'x' else PI / 2 * normal), scale=.9)):
                skull(glow=False)
                if g.random() < .6:
                    skull_lamp_top(.098, seed=seed)
        elif k < .8:
            goblet((px, y, pz), s=1.2, mat=GOLDHI if g.random() < .5 else GOLD)
        elif k < .9:
            tankard((px, y, pz), turn=g.uniform(0, TAU), mat=PEWTER, ale=False)
        else:
            scatter(px, pz, y, 0, .04, 6, seed)
            ball('shelf gem', (px, y + .008, pz), .008, PEARL, seg=5, rings=3)
    # Wax run over the shelf's front edge.
    for i in range(int(abs(x1 - x0) / .12)):
        t = g.uniform(0, 1)
        if axis == 'x':
            px, pz = x0 + (x1 - x0) * t, zw + normal * (depth - .004)
        else:
            px, pz = zw + normal * (depth - .004), x0 + (x1 - x0) * t
        rod('shelf wax', (px, y, pz), (px, y - g.uniform(.03, .09), pz), .005, WAX, top=.0015, sides=4)


# ---- cloth, rope and nets under the ceiling -------------------------------------------------------
def rope_loop(a, b, drop, r=.011, n=12):
    a, b = Vector(a), Vector(b)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.y -= drop * 4 * t * (1 - t)
        pts.append(tuple(p))
    tube('hanging rope', pts, r, ROPE, sides=5)


def ceiling_net(x0, x1, z0, z1, top, sag, seed, floats=4):
    """A fishing net slung under the beams by its corners, sagging, with glass floats lying in it."""
    def at(u, v):
        return (x0 + (x1 - x0) * u, top - .04 - sag * math.sin(PI * u) * math.sin(PI * v) - .05 * (u + v) * .5,
                z0 + (z1 - z0) * v)
    for sgn in (-1, 1):
        for k in range(-8, 17):
            c = k / 8
            pts = [at(u, sgn * u + c) for u in (i / 18 for i in range(19)) if 0 <= sgn * u + c <= 1]
            if len(pts) >= 2:
                tube('net', pts, .0035, NET, sides=3)
    for u, v in ((0, 0), (1, 0), (0, 1), (1, 1)):
        p = at(u, v)
        rod('net lashing', p, (p[0], top, p[2]), .005, ROPE, sides=3)
    g = rng(seed)
    for i in range(floats):
        u, v = g.uniform(.25, .75), g.uniform(.25, .75)
        x, y, z = at(u, v)
        r = g.uniform(.03, .045)
        ball('float', (x, y + r * .7, z), r, FLOATS[g.randrange(3)], seg=10, rings=6)
        torus('float rope', (x, y + r * .7, z), r * 1.02, .003, ROPE, seg=8, sides=3)
        torus('float rope', (x, y + r * .7, z), r * 1.02, .003, ROPE, seg=8, sides=3, roll=PI / 2)
    x, y, z = at(.6, .4)
    prism('starfish', [(.04 * math.cos(a) * (1 if k % 2 == 0 else .4), .04 * math.sin(a) * (1 if k % 2 == 0 else .4))
                       for k, a in enumerate([PI / 2 + TAU * i / 10 for i in range(10)])], .008, 'plain:starfish',
          M((x, y + .006, z), tilt=-PI / 2))


def wall_net(corner_fn, seed, floats=3):
    for sgn in (-1, 1):
        for k in range(-7, 15):
            c = k / 7
            pts = [corner_fn(u, sgn * u + c) for u in (i / 16 for i in range(17)) if 0 <= sgn * u + c <= 1]
            if len(pts) >= 2:
                tube('net', pts, .0035, NET, sides=3)
    for u in (0, 1):
        ball('net peg', corner_fn(u, 0), .012, IRON, seg=5, rings=3)
    g = rng(seed)
    for i in range(floats):
        x, y, z = corner_fn(g.uniform(.2, .8), g.uniform(.3, .85))
        ball('float', (x, y, z), .035, FLOATS[g.randrange(3)], seg=10, rings=6)


def sail(x0, x1, z0, z1, top, drop, seed, mat=SAIL):
    """A torn sail slung under the beams: bent to a line along x at z0, hanging away towards z1 in
    a belly, its free edge ragged; rope ties along the line it hangs from."""
    def corner(u, v):
        return (x0 + (x1 - x0) * u, top - .03, z0 + (z1 - z0) * v)

    def sag(u, v):
        return drop * v ** 1.3 + .12 * math.sin(PI * u) * v + .03 * math.sin(PI * u)

    cloth(corner, 16, 6, sag, mat, thick=.006, ragged=.08, seed=seed)
    rod('sail spar', (x0 - .05, top - .02, z0), (x1 + .05, top - .02, z0), .018, DARK, sides=6)
    for i in range(6):
        x = x0 + (x1 - x0) * (i + .5) / 6
        torus('sail tie', (x, top - .025, z0), .024, .005, ROPE, seg=6, sides=3, roll=PI / 2)


def coat(peg, length, width, mat, seed):
    """A coat hung on a peg against a wall facing +z: a sheet falling in folds, a collar."""
    px, py, pz = peg

    def corner(u, v):
        return (px + (u - .5) * width * (1 - .35 * (1 - v)), py - .02 - v * length, pz + .012 + .02 * math.sin(PI * u) * v)

    def sag(u, v):
        return .015 * math.sin(u * PI * 4) * v

    cloth(corner, 6, 5, sag, mat, thick=.008, ragged=.02, seed=seed)
    rod('coat collar', (px - width * .3, py - .03, pz + .015), (px + width * .3, py - .03, pz + .015), .01, mat, sides=5)


def hat(at, turn=0.0):
    x, y, z = at
    with frame(M(at, turn)):
        lathe('tricorn', [(0, 0), (.07, 0), (.075, .008), (.04, .012), (.035, .045), (0, .05)], BLACK_HAT, sides=3, phase=.3)
        torus('tricorn trim', (0, .01, 0), .06, .003, GOLD, seg=3, sides=3, start=.3)


BLACK_HAT = material('plain:hat', 0x1e1a1c)


# ---- placeholders ------------------------------------------------------------------------------------
# The pieces that make the room's look - the sloop, the open chests, the cannon, the jolly boat, the
# hammocks, the captain's chair, the chart table, the globe, the telescope, the anchor, the Jolly
# Roger, the wheel, the wheel chandelier, the split rudder over the bar, the hatch-cover table tops -
# are the keeper's to draw: each is a plain stand-in of the right size in the right place, one function
# apiece, so a finished model replaces one function and nothing else. What lies round them (gold,
# candles, coins, the shot, the chart's candlestick) is the dressing's own and stays.
def ph_chest_open(w=.42, d=.26, h=.2, seed=0):
    """An open treasure chest: w x d x h, its lid stood open at the back, gold heaped over the rim
    and run out onto the floor in front (+z)."""
    sp('chest', -w / 2, w / 2, 0, h, -d / 2, d / 2, CHESTW)
    for x in (-w * .32, w * .32):
        sp('chest band', x - .015, x + .015, 0, h + .002, -d / 2 - .003, d / 2 + .003, IRON)
    box('chest lid', (0, h + d * .42, -d / 2 - .02), (w, d * .9, .03), CHESTW, tilt=-.25)
    sp('chest lid lining', -w / 2 + .015, w / 2 - .015, h + .02, h + d * .8, -d / 2 - .002, -d / 2 + .01, VELVET)
    heap((0, h - .04, 0), min(w, d) * .6, .12, coins=int(24 * w / .42), seed=seed + 1, gems=4)
    hull('gold spill', [(-.08, h, d / 2 - .02), (.07, h, d / 2 - .02), (-.11, 0, d / 2 + .1), (.1, 0, d / 2 + .11),
                        (-.11, 0, d / 2), (.1, 0, d / 2), (0, .05, d / 2 + .04)], GOLD)
    scatter(0, d / 2 + .16, 0, .02, .15, 20, seed + 3, arc=(-PI * .1, PI * 1.1))


def ph_cannon():
    """The snug's gun, muzzle to +x: a carriage 0.4 x 0.18 x 0.12 on four trucks, a barrel 0.55 long
    from 0.065 to 0.05 round at 0.21 up."""
    sp('carriage', -.2, .2, .03, .15, -.09, .09, WOOD)
    for x in (-.14, .14):
        for sz in (-1, 1):
            disc('carriage truck', (x, .05, sz * .105), .05, .025, DARK, sides=10, tilt=PI / 2)
    rod('cannon', (-.27, .21, 0), (.28, .21, 0), .065, IRON, top=.05, sides=12)
    ball('cannon cascabel', (-.29, .21, 0), .025, IRON, seg=6, rings=4)
    rod('rammer', (-.3, .01, -.19), (.32, .06, -.19), .008, WOOD, sides=5)


def ph_globe():
    """A globe on a stand: 0.5 high, the ball 0.12 round at 0.37."""
    disc('globe foot', (0, 0, 0), .11, .02, DARK, sides=8)
    rod('globe stand', (0, .02, 0), (0, .26, 0), .02, DARK, sides=6)
    ball('globe', (0, .37, 0), .12, 'plain:globe', seg=14, rings=9)
    torus('globe meridian', (0, .37, 0), .132, .006, BRASS, seg=16, sides=3, tilt=PI / 2)


def ph_telescope():
    """A brass glass on a tripod at the window, looking out along +x: tripod 0.15 round, the tube
    0.48 long and 0.03 round at 0.55."""
    for k in range(3):
        a = TAU * k / 3 + .5
        rod('tripod leg', (.15 * math.cos(a), 0, .15 * math.sin(a)), (0, .53, 0), .01, DARK, sides=5)
    rod('telescope', (-.22, .52, 0), (.26, .58, 0), .022, BRASS, top=.032, sides=10)


def ph_chart_table(top=.2):
    """The chart table, in its own frame (the kit's charttable.py, at KIT.charttable on the captain's
    deck): a top 0.64 x 0.42 at `top` on four legs, a compass, an hourglass, a candlestick and two
    goblets on it. Its chart is the room's (`chart_on_table`), so it lies on the HD model too."""
    span('chart table', -.32, .32, top - .024, top, -.21, .21, OAK)
    for dx, dz in ((-.28, -.17), (.28, -.17), (-.28, .17), (.28, .17)):
        sp('chart table leg', dx - .02, dx + .02, 0, top - .024, dz - .02, dz + .02, DARK)
    disc('compass', (.2, top, .1), .035, .014, BRASS, sides=12)
    disc('hourglass', (.24, top, -.12), .02, .07, 'plain:bottle-clear', sides=6)
    candlestick((-.25, top, -.12), h=.05, seed=501)
    for dx in (.05, .14):
        goblet((dx, top, -.13), mat=GOLDHI)
    scatter(.12, .05, top, 0, .04, 5, 502)


def chart_on_table(L):
    """The captain's chart on the chart table (KIT.charttable, its top at `top`): the treasure map
    the second table has, without its dagger - Pixal3D's model of the table had only a pale sheet
    there (the keeper, 1 October 2026)."""
    t = L['KIT']['charttable']
    treasure_map(M((t['x'] - .04, t['y'] + t['top'] + .001, t['z']), .1), dagger=False)


def ph_captain_chair():
    """The captain's chair, in its own frame (the kit's captainchair.py, at KIT.captainchair): a seat
    0.24 x 0.22 at 0.17 on four legs, a back 0.24 wide to 0.66, facing +z (the chart table)."""
    span('chair seat', -.12, .12, .14, .17, -.11, .11, CARVED)
    span('chair cushion', -.105, .105, .17, .19, -.095, .095, VELVET)
    for sx in (-1, 1):
        for sz in (-1, 1):
            sp('chair leg', sx * .1 - .015, sx * .1 + .015, 0, .14, sz * .09 - .015, sz * .09 + .015, DARK)
    span('chair back', -.12, .12, .17, .66, -.13, -.1, VELVET)


def sloop_chain(L, S, to=None):
    """The candle boat itself is the kit's (scripts/krakenkit/sloop.py, placed by pirate-tavern.js at
    KIT.sloop); the room draws only the long chain from the top of its own short one up to the roof.
    S (one of SLOOPS) is where its flames are."""
    top = S['y'] - L['KIT']['sloop']['flame'] + L['KIT']['sloop']['ringTop']
    with lid():
        chain((S['x'], top, S['z']), (S['x'], L['TOP'] if to is None else to, S['z']))


def ph_rowboat():
    """The jolly boat, in its own frame with her gunwale at y = 0 (the kit's rowboat.py frames her on
    her keel, 0.17 under it): a hull 1.0 long, 0.42 across, 0.17 deep; two oars in her, a lantern on
    her stem post. Moored beside the jetty at KIT.rowboat; her painter is the room's."""
    hull('boat hull', [(-.5, 0, -.19), (-.5, 0, .19), (.5, .02, 0), (-.48, -.15, -.12), (-.48, -.15, .12), (.35, -.14, -.08),
                       (.35, -.14, .08), (0, -.17, 0), (0, 0, -.21), (0, 0, .21), (.3, .01, -.16), (.3, .01, .16)], BOATW)
    span('boat thwart', -.03, .03, .0, .012, -.19, .19, OAK)
    for sz in (-1, 1):
        rod('oar', (-.4, .02, sz * .06), (.45, .03, sz * .08), .011, WOOD, sides=6)
    rod('stem post', (.48, .02, 0), (.48, .3, 0), .01, DARK, sides=5)
    lantern((.54, .22, 0), s=1.0)
    rod('stem arm', (.48, .29, 0), (.54, .29, 0), .006, IRON, sides=4)


def rowboat_painter(L):
    """The jolly boat's painter, from her bow to the jetty's end (the boat is the kit's, at
    KIT.rowboat, whose y is her keel's, `gunwale` under her gunwale)."""
    P, J, b = L['POOL'], L['JETTY'], L['KIT']['rowboat']
    y = b['y'] + b['gunwale']
    end = (J['x1'] - .02, L['F'] - .01, J['z1'] - .02)
    bow = (b['x'] + .5, y + .04, b['z'] + .03)
    tube('painter', [bow, ((bow[0] + end[0]) / 2, P['surface'] + .005, (bow[2] + end[2]) / 2 + .03), end], .006, ROPE, sides=4)


def ph_hammock(a, b, sag, width=.26, seed=0):
    """A hammock slung between two hooks: a sagging canvas sheet `width` across, its ends 14% in
    from the hooks, a rope from each end to its hook."""
    a, b = Vector(a), Vector(b)
    ax = (b - a).normalized()
    side = ax.cross(Vector((0, 1, 0))).normalized()

    def corner(u, v):
        return tuple(a.lerp(b, .14 + .72 * u) + side * (v - .5) * width)

    cloth(corner, 10, 3, lambda u, v: sag * math.sin(PI * u), CANVAS, thick=.006, seed=seed)
    for u, hook in ((0, a), (1, b)):
        rod('hammock rope', tuple(a.lerp(b, .14 + .72 * u)), tuple(hook), .004, ROPE, sides=3)


def ph_wheel(at, turn, R=.19):
    """The ship's wheel on the chimney breast: a rim R round, a hub, eight spokes out past the rim."""
    with frame(M(at, turn)):
        torus('wheel rim', (0, 0, 0), R, .015, WOOD, seg=16, sides=4, tilt=PI / 2)
        disc('wheel hub', (0, 0, -.03), .045, .06, WOOD, sides=8, tilt=PI / 2)
        for k in range(8):
            a = TAU * k / 8
            rod('wheel spoke', (0, 0, 0), (math.cos(a) * (R + .07), math.sin(a) * (R + .07), 0), .01, WOOD, sides=5)


def ph_anchor(m):
    """An anchor hung on the wall, 1.05 tall in its own frame: shank, stock 0.44 across, two arms."""
    with frame(m):
        rod('anchor shank', (0, .27, 0), (0, 1.0, 0), .022, IRON, sides=6)
        torus('anchor ring', (0, 1.05, 0), .045, .01, IRON, seg=10, sides=4, tilt=PI / 2)
        span('anchor stock', -.22, .22, .9, .94, -.022, .022, DARK)
        tube('anchor arm', [(-.22, .42, 0), (-.12, .3, 0), (0, .27, 0), (.12, .3, 0), (.22, .42, 0)], .02, IRON, sides=6)


def ph_jolly_roger(m, w=.66, h=.44, seed=0):
    """A black flag w x h nailed flat to a wall, facing +z in its frame, a skull and crossed bones."""
    with frame(m):
        prism('jolly roger', [(-w / 2, h / 2), (w / 2, h / 2), (w / 2, -h / 2), (-w / 2, -h / 2)], .006, FLAG)
        disc('jolly roger skull', (0, h * .08, .003), h * .16, .006, BONE, sides=10, tilt=PI / 2)
        for a in (.7, -.7):
            box('jolly roger bones', (0, -h * .16, .006), (w * .45, .02, .006), BONE, roll=a)


def ph_hatch_top(tx, tz, y, w=1.5, d=.5):
    """A table top that is a ship's hatch cover: a coaming of four boards round a grating of battens
    half-lapped both ways, their tops flush at y + 0.028 (the table's top, where its clutter stands),
    over a dark board so the holes read as depth and not as the floor. w x d, on the trestles at y."""
    top = y + .028
    c = .035
    span('hatch board', tx - w / 2 + c, tx + w / 2 - c, y, y + .008, tz - d / 2 + c, tz + d / 2 - c, DARK)
    span('hatch coaming', tx - w / 2, tx + w / 2, y, top, tz - d / 2, tz - d / 2 + c, TABLEW, bevel=.006)
    span('hatch coaming', tx - w / 2, tx + w / 2, y, top, tz + d / 2 - c, tz + d / 2, TABLEW, bevel=.006)
    span('hatch coaming', tx - w / 2, tx - w / 2 + c, y, top, tz - d / 2 + c, tz + d / 2 - c, TABLEW, bevel=.006)
    span('hatch coaming', tx + w / 2 - c, tx + w / 2, y, top, tz - d / 2 + c, tz + d / 2 - c, TABLEW, bevel=.006)
    x0, x1, z0, z1 = tx - w / 2 + c, tx + w / 2 - c, tz - d / 2 + c, tz + d / 2 - c
    n = 6
    for i in range(1, n):
        z = z0 + (z1 - z0) * i / n
        span('hatch batten', x0, x1, top - .012, top, z - .012, z + .012, OAK)
    m = 20
    for i in range(1, m):
        x = x0 + (x1 - x0) * i / m
        span('hatch batten', x - .012, x + .012, y + .008, top - .004, z0, z1, OAK)
    for sx in (-1, 1):
        for sz in (-1, 1):
            box('hatch nail', (tx + sx * (w / 2 - .018), top + .001, tz + sz * (d / 2 - .018)), (.01, .002, .01), IRON)


def ph_wheel_chandelier(at, R=.45, to=None, seed=400):
    """A ship's wheel hung flat as a chandelier: a rim R round with its spokes out past it to the
    handles, a hub, candles standing round the rim (their flames about 0.09 over `at`), four chains
    to a ring over the hub and one on up to `to`."""
    x, y, z = at
    g = rng(seed)
    with frame(M(at)):
        torus('chandelier rim', (0, 0, 0), R, .028, WOOD, seg=20, sides=4)
        torus('chandelier rim band', (0, .012, 0), R, .012, BRASS, seg=20, sides=3)
        disc('chandelier hub', (0, -.03, 0), .07, .06, WOOD, sides=8)
        disc('chandelier boss', (0, .03, 0), .04, .012, BRASS, sides=8)
        for k in range(8):
            a = TAU * k / 8
            ca, sa = math.cos(a), math.sin(a)
            rod('chandelier spoke', (.06 * ca, 0, .06 * sa), ((R + .13) * ca, 0, (R + .13) * sa), .014, WOOD, sides=5)
            ball('chandelier handle', ((R + .15) * ca, 0, (R + .15) * sa), (.02, .016, .02), CARVED, seg=6, rings=4)
        for k in range(12):
            a = TAU * (k + .5) / 12
            ca, sa = math.cos(a), math.sin(a)
            candle((R * ca, .028, R * sa), h=g.uniform(.05, .07), r=.012, drips=3, seed=seed + k)
            for j in range(2):
                dz = g.uniform(-.01, .01)
                rod('chandelier wax', ((R + .028) * ca, .02, (R + .028) * sa + dz),
                    ((R + .03) * ca, .02 - g.uniform(.03, .09), (R + .03) * sa + dz), .006, WAX, top=.002, sides=4)
        for k in range(4):
            a = TAU * k / 4 + PI / 4
            chain(((R - .02) * math.cos(a), .03, (R - .02) * math.sin(a)), (0, .5, 0))
        torus('chandelier ring', (0, .51, 0), .03, .007, IRON, seg=8, sides=4)
    if to is not None:
        chain((x, y + .52, z), (x, to, z))


def ph_rudder_sign(at, to=None):
    """A ship's rudder, split down its length and hung on two chains as the house's sign, facing +z:
    its stock at the top (`at` is the stock's cap), the blade 0.9 tall and 0.34 wide, the aft half
    split off and hanging askew, three iron pintle straps holding the halves, a name board nailed
    across. The chains go up to `to` (a height in the room)."""
    x, y, z = at
    with frame(M(at)):
        rod('rudder stock', (0, -.3, 0), (0, .02, 0), .035, DARK, sides=8)
        disc('rudder stock cap', (0, .02, 0), .045, .02, IRON, sides=8)
        hull('rudder blade', [(-.16, -.28, -.025), (-.16, -.28, .025), (0, -.28, -.025), (0, -.28, .025),
                              (-.14, -1.2, -.025), (-.14, -1.2, .025), (-.01, -1.18, -.025), (-.01, -1.18, .025)], WOOD)
        with frame(M((.012, 0, 0), roll=-.05)):
            hull('rudder blade', [(0, -.28, -.024), (0, -.28, .024), (.18, -.3, -.024), (.18, -.3, .024),
                                  (.02, -1.16, -.024), (.02, -1.16, .024), (.12, -1.14, -.024), (.12, -1.14, .024)], OAK)
        for yy in (-.36, -.7, -1.04):
            span('rudder strap', -.19, .19, yy - .018, yy + .018, -.031, .031, IRON)
            for xx in (-.15, .15):
                ball('rudder rivet', (xx, yy, .034), .006, IRON, seg=4, rings=3)
        span('rudder board', -.3, .3, -.62, -.47, .03, .05, PAINT, bevel=.006)
        for xx in (-.26, .26):
            ball('rudder nail', (xx, -.545, .054), .007, IRON, seg=4, rings=3)
        for i in range(7):
            box('rudder letter', (-.2 + i * .067, -.545, .052), (.03, .07, .004), GOLD, roll=(.3 if i % 2 else -.2))
        for xx in (-.1, .1):
            torus('rudder eye', (xx, .06, 0), .025, .006, IRON, seg=8, sides=3, tilt=PI / 2)
    if to is not None:
        for xx in (-.1, .1):
            chain((x + xx, y + .085, z), (x + xx * 3, to, z))

# ---- the hall ---------------------------------------------------------------------------------------
def slung_net(x0, x1, z0, z1, top, sag, seed, floats, to):
    """A net slung under the rock: ceiling_net at `top`, and its four lashings carried on up to `to`
    (the vault's crown; where the rock comes lower they run into it)."""
    ceiling_net(x0, x1, z0, z1, top, sag, seed, floats=floats)
    for x in (x0, x1):
        for z in (z0, z1):
            rod('net lashing', (x, top, z), (x, to, z), .005, ROPE, sides=3)


def slung_sail(x0, x1, z0, z1, top, drop, seed, to):
    """A torn sail on its spar (sail), the spar hung from the rock by a rope at each end."""
    sail(x0, x1, z0, z1, top, drop, seed)
    for x in (x0, x1):
        rod('sail sling', (x, top - .02, z0), (x, to, z0), .007, ROPE, sides=4)


def build(L):
    LV = L['LEVEL']
    G, P, B, C, U = LV['ground'], LV['pit'], LV['bar'], LV['captain'], LV['top']
    TOP = L['TOP']
    H = L['HALL']
    W, E, N, S = H['x0'], H['x1'], H['z0'], H['z1']
    UNDER = .16                     # a deck's underside below its boards (shell.py: boards, sub-floor, joist)

    # Everything standing on a floor. A kind with nothing to draw it or no footprint to block with
    # would be an invisible wall or a thing walked through: refuse it here, before anybody does.
    D = L['DRESSING']
    for p in D['PROPS']:
        if (p['kind'] not in KINDS and p['kind'] not in D['KIT_KINDS']) or p['kind'] not in D['FOOT']:
            raise KeyError(f"prop kind {p['kind']!r} needs both a KINDS drawer here and a FOOT in kraken-dressing.js")
    for i, p in enumerate(D['PROPS']):
        if p['kind'] in D['KIT_KINDS']:
            continue                # a kit piece now (scripts/krakenkit/), placed by pirate-tavern.js
        seed = 1000 + i * 17
        g = rng(seed)
        with frame(M((p['x'], p['y'], p['z']), p.get('ry', 0), scale=p.get('s', 1))):
            KINDS[p['kind']](g, seed)

    # The roof: pitched, its ridge north-south over x = 0 at TOP and its eaves on the west and east
    # walls. What hangs from it hangs from under its rafters, a hand below the pitch.
    EAVES = L['EAVES']

    def roof(x):
        return TOP - (TOP - EAVES) * min(abs(x), E) / E - .12

    tables(L)
    snug(L)
    chart_on_table(L)
    for i, sl in enumerate(L['SLOOPS']):
        sloop_chain(L, sl, to=roof(sl['x']))
    rowboat_painter(L)
    hearth(L)

    # ---- gold lying about, by the chests and the heaps it ran out of -------------------------
    for (x, z, y, r, seed) in ((-3.0, -2.3, P, .16, 2001), (-2.75, -2.6, P, .08, 2002),      # the pit's chest
                               (-3.85, -6.0, B, .2, 2003), (-3.25, -6.2, B, .1, 2004),       # the bar's hoard
                               (8.15, -6.0, C, .2, 2005), (8.3, -5.05, C, .1, 2006),         # the captain's
                               (-6.4, -8.35, G, .15, 2007)):                                 # behind the bars
        gold_floor(x, z, r, seed, y=y)
    scatter(0.1, 3.8, P, 0, .45, 10, 2020)                           # dropped in the aisle on the way out
    scatter(-4.9, -1.6, P, 0, .25, 6, 2021)                          # at the foot of the west stair
    scatter(7.4, -3.9, C, 0, .3, 8, 2022)                            # before the captain

    # ---- hammocks: in the hold, and under the west gallery --------------------------------------
    # Slung higher than a head (their lowest point 0.65 over the ground), from hooks on ropes down
    # from the deck overhead.
    # The hammocks themselves are the kit's (hammock.py, at KIT.hammocks); the room hangs their slings.
    for h in L['KIT']['hammocks']:
        x, za, zb, y = h['x'], h['za'], h['zb'], h['hook']
        for z, dy in ((za, 0), (zb, -.03)):
            rod('hammock sling', (x, y + dy, z), (x, C - UNDER, z), .005, ROPE, sides=3)

    # ---- lanterns --------------------------------------------------------------------------------
    # Under the decks: in the hold, under the west gallery over the way to the cellar, and under the
    # east upper gallery over the captain.
    lantern((7.4, G + 1.45, -3.6), hang_to=C - UNDER, s=1.3)
    lantern((-7.4, G + 1.55, -3.2), hang_to=C - UNDER, s=1.3)
    lantern((7.9, C + .78, -4.75), hang_to=U - UNDER, s=1.3)
    with lid():
        # From the roof on long chains: over the bar terrace, the south strip, the keg table and both
        # upper galleries. And the one in the cellar's vault.
        for (x, y, z) in ((-3.6, B + 1.3, -4.6), (3.4, B + 1.3, -4.6), (-3.4, G + 1.9, 6.2), (2.8, G + 1.9, 6.2),
                          (-6.8, G + 1.45, 6.0), (-7.9, U + .75, -4.6), (7.9, U + .75, -0.4)):
            lantern((x, y, z), hang_to=roof(x), s=1.3)
        lantern((-8.0, G + .95, -8.0), hang_to=G + L['CELLAR']['ceiling'] - .02, s=1.2)
        # The ship's wheel over the middle of the pit, before the mast, between the two sloops: its
        # flames 2.7 over the pit, clear of the aisle's heads and of the crow's nest.
        # The wheel and the rudder themselves are the kit's (wheel.py, rudder.py, placed by
        # pirate-tavern.js at KIT.wheel and KIT.rudder); the room draws their long chains to the roof.
        import wheel as kit_wheel, rudder as kit_rudder
        w, r = L['KIT']['wheel'], L['KIT']['rudder']
        chain((w['x'], w['y'] + kit_wheel.RING_TOP, w['z']), (w['x'], roof(w['x']), w['z']))
        for bx in kit_rudder.BRACKETS:
            chain((r['x'] + bx, r['y'] + kit_rudder.CHAIN_TOP, r['z']), (r['x'] + bx, roof(r['x'] + bx), r['z']))

    # ---- shelves, with their bottles, candles and skulls ----------------------------------------------
    shelf(-5.3, -3.8, B + .75, N + .06, 1, 'x', 31)                  # on the north wall over the bar's hoard
    shelf(-8.85, -7.6, G + .7, W + .05, 1, 'z', 34)                  # in the cellar, over the keg rack
    shelf(5.3, 6.5, G + .7, W + .05, 1, 'z', 33)                     # on the west wall by the cannon

    # ---- the walls ------------------------------------------------------------------------------------
    # The walls of the south and east. The two Jolly Rogers (one over the outside of the east upper
    # gallery's rail, to the hall) and the anchor are the kit's (jollyroger.py, anchor.py, at
    # KIT.jollyrogers and KIT.anchor).
    with group('near'):
        wanted_board(M((1.4, G + .62, S - .012), PI))
        crossed_cutlasses((-3.3, G + 1.02, S - .02), PI)
        # A net with floats on the south wall over the crates east of the door.
        wall_net(lambda u, v: (3.15 + u * .95, G + 1.95 - v * .8 - .08 * math.sin(PI * u) * (1 - v * .5),
                               S - .02 - .02 * math.sin(PI * u) * math.sin(PI * v)), 51)
        # The captain's chart on the east wall over his table.
        wall_map(M((E - .012, C + .7, L['CHART']['z']), -PI / 2))

    # ---- under the roof: torn sails on the trusses, nets, ropes, a hook -------------------------------
    # Never lower than 0.6 over what is under them; nothing over the bridges or the upper galleries,
    # where the roof is too low for it. The sails are bent to spars lashed under the trusses' tie
    # beams (kraken-layout.js TRUSSES, at EAVES): the truss over the south rows of tables and the one
    # over the bar terrace in front of the broken bow, whichever of them are nearest 3.6 and -4.4.
    with lid():
        ts, tn = (min(L['TRUSSES'], key=lambda t: abs(t - want)) for want in (3.6, -4.4))
        tie = EAVES - .08
        slung_sail(-4.3, -2.3, ts, ts + .8, tie, .6, 61, tie + .08)      # over the tables, south
        slung_sail(1.0, 2.9, ts, ts - .75, tie, .55, 62, tie + .08)
        slung_sail(-5.0, -3.0, tn, tn - .8, tie, .6, 63, tie + .08)      # over the bar terrace
        slung_sail(2.3, 4.5, tn, tn + .7, tie, .5, 64, tie + .08)
        slung_net(-5.3, -3.7, -6.7, -5.6, 4.0, .3, 72, 4, roof(-3.7))    # over the bar's hoard
        slung_net(6.6, 8.6, 2.6, 4.0, 3.9, .35, 73, 4, roof(6.6))       # over the pool
        for (x0, z0, x1, z1, drop) in ((-2.2, -0.3, -1.2, 0.2, .5), (1.0, 3.4, 2.2, 3.9, .6),
                                       (-4.6, 3.2, -3.6, 3.9, .5), (4.2, -1.0, 5.0, -0.2, .45)):
            rope_loop((x0, roof(x0) - .1, z0), (x1, roof(x1) - .1, z1), drop)
        x, z, y = -7.4, 5.3, G + 1.7
        chain((x, roof(x), z), (x, y, z))
        torus('meat hook', (x, y - .04, z), .03, .005, IRON, seg=8, sides=3, tilt=PI / 2, arc=PI * 1.4, start=PI * .8)
