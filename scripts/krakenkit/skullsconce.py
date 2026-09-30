"""The skull sconce: the hanging lamp's skull, candle and dish (skulllamp.py) held out from a wall
on an iron arm, in front of a dark wooden back plate edged in brass and strapped to the wall with
iron. The wall's face is z = 0 and nothing reaches behind z = -0.01; the plate's foot is y = 0."""
import math
from geom import PI, IRON, BRASS, M, frame, span, prism, tube
from skulllamp import skull_on_dish, rivet, BLOCK

ASSET = 'civic_kraken_skullsconce'

R = .08                 # the dish's radius
OUT = .13               # the dish's centre, out from the wall
DISH_Y = .1             # the dish's bottom
W, H = .1, .26          # the back plate


def octagon(w, h, c):
    """A rectangle w x h standing on y = 0 with its corners cut by c."""
    x, y = w / 2, h
    return [(-x + c, 0), (x - c, 0), (x, c), (x, y - c), (x - c, y), (-x + c, y), (-x, y - c), (-x, c)]


def build():
    # The back plate: a brass board behind a slightly smaller wooden one, so the brass shows as an
    # edge all round it.
    prism('sconce brass', octagon(W, H, .018), .022, BRASS, M((0, 0, .001)))
    prism('sconce plate', [(x, y + .007) for x, y in octagon(W - .014, H - .014, .014)], .018, BLOCK,
          M((0, 0, .015)))
    # Two iron straps over it, into the wall, each with two bolts.
    for y in (.035, H - .035):
        span('sconce strap', -W / 2 - .006, W / 2 + .006, y - .009, y + .009, -.01, .0265, IRON)
        for x in (-.032, .032):
            rivet((x, y, .0265), (0, 0, 1), k=.0045, h=.004, mat=IRON)
    # The arm: an iron bar from a plate bolted to the board out under the dish, and a brass brace
    # curving up from the board to meet it.
    arm = DISH_Y - .006
    span('sconce bracket', -.018, .018, arm - .03, arm + .012, .024, .031, IRON)
    rivet((0, arm - .018, .031), (0, 0, 1), k=.0045, h=.004, mat=IRON)
    span('sconce arm', -.008, .008, arm - .004, arm + .008, .03, OUT, IRON)
    span('sconce collar', -.022, .022, arm + .004, DISH_Y + .002, OUT - .022, OUT + .022, IRON)
    pts = []
    y0, z0 = arm - .06, .026
    for i in range(5):
        t = PI / 2 * i / 4
        pts.append((0, y0 + (arm - .002 - y0) * math.sin(t), z0 + (OUT - .03 - z0) * (1 - math.cos(t))))
    tube('sconce brace', pts, [.006, .0055, .005, .0045, .004], BRASS, sides=4)
    with frame(M((0, DISH_Y, OUT))):
        skull_on_dish(R, seed=5)
