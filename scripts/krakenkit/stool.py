"""A bar stool made from a small cask: four splayed legs shod in iron, a bellied barrel with two
dark hoops and a brass ring at its foot, a twisted rope round its top, a brass rim and a red
cushion. Six of them stand along the counter, so it is cheap on purpose (under 450 triangles):
eight staves, and the rope is one twisted triangle rather than two strands.

Fixed by the room: a settler (0.45 tall) sits on it, so the cushion's top is y = 0.19; it stands
0.32 in front of the counter, so nothing reaches further than 0.095 from its axis."""
import math
import bmesh
from mathutils import Vector
from geom import TAU, PI, IRON, BRASS, ROPE, lathe, disc, hull, emit, material

ASSET = 'civic_kraken_stool'

SEAT = .19                  # top of the cushion: where a sitting settler's hips are
CUSHION = material('plain:cushion', 0x6a1e27)
LEGWOOD = material('plank:stool-leg', 0x553623)
STAVES = material('plank:stool', 0x6a4429)     # darker than the hall's oak: an old cask

B0, B1 = .038, .148         # the barrel's foot and head
PH = PI / 8                 # turn the octagon so a stave, not an edge, faces the front


def bulge(t):
    """The barrel's radius at t (0 foot, 1 head): bellied, a little wider at the foot than the head."""
    return .058 + (.056 - .058) * t + .008 * (1 - (2 * t - 1) ** 2)


def y_of(t):
    return B0 + (B1 - B0) * t


def hoop(label, t0, t1, mat, out=.0035):
    r = max(bulge(t0), bulge(t1)) + out
    disc(label, (0, y_of(t0), 0), r, y_of(t1) - y_of(t0), mat, sides=8, turn=-PH)


def rivet(t, a, r_out):
    """A rivet head as a four-sided pyramid pressed onto a hoop, at angle a round the axis."""
    y = y_of(t)
    c, s = math.cos(a), math.sin(a)
    u = Vector((c, 0, s))
    v = Vector((-s, 0, c))
    base = Vector((0, y, 0)) + u * (r_out * math.cos(PI / 8) - .0005)   # on the flat, not the corner
    k = .0042
    pts = [base + v * dv * k + Vector((0, dy * k, 0)) for dv, dy in ((1, 0), (0, 1), (-1, 0), (0, -1))]
    hull('stool rivet', [tuple(p) for p in pts] + [tuple(base + u * .004)], IRON)


def leg(a):
    """A chunky square leg splayed outwards along direction a, its top tucked under the barrel."""
    u = Vector((math.cos(a), 0, math.sin(a)))
    v = Vector((-math.sin(a), 0, math.cos(a)))
    foot, top = u * .066, u * .042 + Vector((0, B0 + .012, 0))
    hf, ht = .0115, .0095
    pts = []
    for c, h in ((foot, hf), (top, ht)):
        for du, dv in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            pts.append(tuple(c + u * du * h + v * dv * h))
    hull('stool leg', pts, LEGWOOD)
    # The iron shoe a little above the foot: the same section a hair bigger, a band 0.012 tall.
    band = []
    for t in (.24, .5):
        c = foot.lerp(top, t)
        h = (hf + (ht - hf) * t) + .0025
        for du, dv in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
            band.append(tuple(c + u * du * h + v * dv * h))
    hull('stool leg band', band, IRON)


def rope_ring(y, R, r, seg=15, twist=TAU * 2 / 15, flat=.75):
    """A rope ring as one triangular strand twisted round its own path: a turn of 48 degrees per
    segment, 720 in all, a whole number of the triangle's 120 so the ends meet. `flat` squeezes it
    in towards the barrel, or it stood out from it like a row of teeth."""
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = TAU * i / seg
        out = Vector((math.cos(a), 0, math.sin(a)))
        c = out * R + Vector((0, y, 0))
        rings.append([bm.verts.new(c + (out * flat * math.cos(twist * i + TAU * j / 3)
                                        + Vector((0, 1, 0)) * math.sin(twist * i + TAU * j / 3)) * r)
                      for j in range(3)])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(3):
            bm.faces.new((A[j], A[(j + 1) % 3], B[(j + 1) % 3], B[j]))
    emit(bm, ROPE, 'stool rope')


def build():
    for k in range(4):
        leg(PI / 4 + k * PI / 2)
    # The cask: eight staves, a ring at the foot, the belly and the head.
    lathe('stool barrel', [(bulge(t), y_of(t)) for t in (0, .3, .7, 1)], STAVES, sides=8, phase=PH)
    hoop('stool brass', .005, .05, BRASS, out=.0045)
    hoop('stool hoop', .3, .42, IRON)
    hoop('stool hoop', .76, .88, IRON)
    for a in (PI / 2, -PI / 2, 0, PI):
        rivet(.82, a, bulge(.82) + .0035)
    # Rope round the head, a brass rim on it, and the cushion rounded at its edge.
    rope_ring(.1535, .064, .0085)
    disc('stool rim', (0, .161, 0), .074, .01, BRASS, sides=8, turn=-PH)
    lathe('stool cushion', [(.069, .167), (.073, .181), (.052, SEAT)],
          CUSHION, sides=8, phase=PH)
