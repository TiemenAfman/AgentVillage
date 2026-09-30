"""A ship's gun port let into the hall's planking as a window, seen from inside: a heavy wooden
lining with a brass lip round a square of night sky (the pane, a mullion across it and a few stars),
a thick sill, and the port lid of three planks hung on two iron strap hinges above the frame,
swung up and out into the room and held there by a stay from the sill. After the keeper's concept
drawing, front and side.

Its own frame: the wall's face is z = 0 and everything stands out towards +z; y = 0 is the sill's
underside; centred in x. The wall itself is the hall's, not this.
"""
import math
from geom import (PI, DARK, WOOD, OAK, IRON, BRASS, RIB, PANE, material,
                  box, span, rod, disc, prism, hull, torus, frame, M)

ASSET = 'civic_kraken_gunport'

W, H = .34, .30             # the opening
LINE = .035                 # the lining's width round it
DEEP = .035                 # and how far it stands off the wall
SILL = .05                  # the sill's height: the opening starts on its top
X0 = W / 2
Y0, Y1 = SILL, SILL + H
HINGE = (0, Y1 + LINE + .006, DEEP + .016)     # the lid's axis, along x, in front of the head
OPEN = math.radians(55)     # the lid, out from the wall
LID_W, LID_L, LID_T = W + .02, H + .004, .028

STAR = material('plain:star', 0xfff4d0, glow=True)
LIDW = material('plain:portlid', 0x6f4d30)
LIDW2 = material('plain:portlid-worn', 0x7d5c3d)


def speck(x, y, r):
    """A far star: a flat diamond, eight triangles."""
    hull('star', [(x + r, y, .0095), (x - r, y, .0095), (x, y + r, .0095), (x, y - r, .0095),
                  (x, y, .0085), (x, y, .0105)], STAR)


def star(x, y, r):
    """A near star: a four-pointed plate just in front of the pane."""
    pts = []
    for k in range(8):
        a = PI / 2 + k * PI / 4
        rr = r if k % 2 == 0 else r * .32
        pts.append((x + rr * math.cos(a), y + rr * math.sin(a)))
    prism('star', pts, .002, STAR, M((0, 0, .0095)))


def lining():
    span('gunport sill', -X0 - LINE - .025, X0 + LINE + .025, 0, SILL, 0, .072, OAK, bevel=.006)
    for s in (-1, 1):
        span('gunport jamb', min(s * X0, s * (X0 + LINE)), max(s * X0, s * (X0 + LINE)),
             SILL - .002, Y1 + LINE, 0, DEEP, DARK, bevel=.004)
    span('gunport head', -X0 - LINE, X0 + LINE, Y1, Y1 + LINE, 0, DEEP, DARK, bevel=.004)
    # The brass lip round the inside edge, standing a hair proud of the lining.
    e = .006
    for s in (-1, 1):
        a, b = sorted((s * X0, s * (X0 + e)))
        span('gunport brass', a, b, Y0, Y1 + e, DEEP - .002, DEEP + .003, BRASS)
    span('gunport brass', -X0 - e, X0 + e, Y1, Y1 + e, DEEP - .002, DEEP + .003, BRASS)
    # The sky through it, a little back in the frame, and the post down its middle.
    span('pane', -X0, X0, Y0, Y1, .002, .008, PANE)
    span('gunport mullion', -.011, .011, Y0, Y1, .008, .026, RIB)
    # Low in the opening: from the room the lid hides the top of it.
    for x, y, r in ((-.105, .165, .0058), (.07, .12, .0056)):
        star(x, y, r)
    for x, y, r in ((-.05, .09, .003), (.12, .185, .0032), (-.14, .08, .0028), (.035, .205, .0026)):
        speck(x, y, r)
    # Nail heads at the lining's corners.
    for sx in (-1, 1):
        for y in (SILL + .02, Y1 + LINE * .5):
            disc('gunport nail', (sx * (X0 + LINE * .5), y, DEEP), .006, .004, IRON, sides=4, tilt=PI / 2)


def hinges():
    hy, hz = HINGE[1], HINGE[2]
    for sx in (-1, 1):
        x = sx * .1
        # The plate on the wall above the head, pointed at the top like a strap's end.
        prism('hinge plate', [(x - .028, Y1 + LINE), (x + .028, Y1 + LINE), (x + .028, .43),
                              (x, .46), (x - .028, .43)], .012, IRON, M((0, 0, .006)))
        disc('hinge nail', (x, .425, .012), .005, .004, IRON, sides=4, tilt=PI / 2)
        # Its tab over the head out to the knuckle, and the knuckle round the pin.
        span('hinge tab', x - .024, x + .024, Y1 + LINE - .002, Y1 + LINE + .01, .004, hz, IRON)
        rod('hinge knuckle', (x - .026, hy, hz), (x + .026, hy, hz), .012, IRON, sides=6)
    rod('hinge pin', (-.135, hy, hz), (.135, hy, hz), .004, IRON, sides=4)


def lid():
    """Modelled closed, hanging down from its axis at the origin, its face towards +z; then swung."""
    with frame(M(HINGE, tilt=-OPEN)):
        t = LID_T / 2
        top, bot = -.012, -.012 - LID_L
        # A dark board behind the three planks, so the gaps between them read dark.
        span('lid backing', -LID_W / 2 + .01, LID_W / 2 - .01, bot + .01, top - .004, -t + .004, t - .006, DARK)
        pw = (LID_W - 2 * .006) / 3
        for i, (mat, dl) in enumerate(((LIDW, .004), (LIDW2, -.003), (LIDW, .0))):
            x0 = -LID_W / 2 + i * (pw + .006)
            span('lid plank', x0, x0 + pw, bot + dl, top, -t, t, mat, bevel=.004)
        # Two battens across the inside, where the stay bears.
        for y in (top - .06, bot + .07):
            span('lid batten', -LID_W / 2 + .01, LID_W / 2 - .01, y - .018, y + .018, -t - .014, -t + .002, DARK)
        # The hinges' straps running down its face, and the ring to haul it by.
        for sx in (-1, 1):
            x = sx * .1
            prism('lid strap', [(x - .014, .004), (x + .014, .004), (x + .014, -.19), (x, -.225),
                                (x - .014, -.19)], .006, IRON, M((0, 0, t + .002)))
            disc('lid nail', (x, -.1, t + .005), .005, .003, IRON, sides=4, tilt=PI / 2)
        disc('lid staple', (0, bot + .075, t), .011, .006, IRON, sides=6, tilt=PI / 2)
        torus('lid ring', (0, bot + .05, t + .007), .026, .0042, IRON, seg=8, sides=3, tilt=PI / 2)


def stay():
    # From a cleat on the sill up to the batten on the lid's underside, off to one side.
    x = .163
    c, s = math.cos(OPEN), math.sin(OPEN)
    ly, lz = -.012 - LID_L + .07, -LID_T / 2 - .014       # the lower batten's underside, in the lid's frame
    ty = HINGE[1] + ly * c + lz * s
    tz = HINGE[2] - ly * s + lz * c
    foot = (x, SILL + .004, .05)
    rod('gunport stay', foot, (x, ty + .004, tz - .004), .01, WOOD, sides=4)
    span('stay cleat', x - .02, x + .02, SILL - .002, SILL + .014, .03, .045, DARK)


def build():
    lining()
    hinges()
    lid()
    stay()
