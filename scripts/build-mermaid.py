"""The mermaid: the one who comes up beside you when you have lost your ship (Plans/schip-vaart-door.md).

    node scripts/blender.mjs --background --python scripts/build-mermaid.py
    node scripts/blender.mjs --background --python scripts/build-mermaid.py -- <dir> [views]

The second form also renders previews into <dir>, one PNG per view (front, quarter, side, back, face,
flick - the tail out of the water - and swimmer, from a swimmer's eye a few lengths off; front, quarter,
flick and swimmer when none are named), with a settler-sized stand-in beside her for scale and the sea
drawn at her waterline. `nobake` among the views renders without saving the .blend or baking the module.

She replaces the placeholder of three.js primitives that web/js/mermaid.js drew first. One hero asset,
`mermaid`, three parts, each one material (`plain:...`) with its colours as a CORNER attribute `Paint`,
the sloop's way (scripts/build-sloop.py) - mermaid.js welds the three into one geometry, one draw call:

    mermaid body    torso, head and face, the shell top, the arms leaning on the water, the scales
                    at the hip. Still: the whole figure bobs, nothing in it bends.
    mermaid hair    long hair, a crown over the head falling down her back to the water, and two
                    locks over her shoulders. Its origin on the crown; mermaid.js waves every corner
                    by how far it hangs under it, so the crown stays put and the ends drift.
    mermaid tail    the tail and its fluke. Its origin on the hinge at the hip, about which mermaid.js
                    turns it - a slow kick along it all the time, and every so often a flick that
                    brings the fluke up out of the water.

**One frame, the lowest point at y = 0** (island coordinates through xyz(): x across, y up, z to the
front, which she faces), modelled at a settler's scale and grown by SCALE at the end so she reads from a
boat's length. Her waterline - her waist, where the arms lie on the sea - is baked as `anchor.waterline`,
as the ships' are: mermaid.js sinks her by that, never by a number of its own.

Why so coarse: she is seen from the water, a few lengths off, for the moment before you press E. A
torso of ten sides and a head of ten read as a figure at that range; the face is four small pieces of
geometry (eyes, brows, nose, lips) because a face in corner colours alone is a blur at this count.

Byte for byte the same on every run, by construction: no bpy.ops on geometry, no join, every triangle
built from these numbers in one order, so `npm run models` twice changes nothing.
"""
import bpy
import math
import runpy
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/mermaid'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW_DIR = Path(args[0]).resolve() if args else None
VIEWS = [v for v in args[1:] if v != 'nobake'] or ['front', 'quarter', 'flick', 'swimmer']
BAKE = 'nobake' not in args

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# Modelled at a settler's scale (a settler is about 0.45 tall), drawn this much larger: the placeholder
# was 1.6 times a figure about as tall as this one's waist-up, and from a swimmer's eye a mermaid the
# size of a settler is a head bobbing on the swell.
SCALE = 1.3
# How far she leans forward onto her arms: z grows by this times the height over the water.
LEAN = 0.2


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def lin(color):
    """An sRGB hex colour as the linear RGBA the bake carries (the exporter writes what it is given)."""
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1.0,)


def shade(c, f):
    r, g, b = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
    return (min(255, round(r * f)) << 16) | (min(255, round(g * f)) << 8) | min(255, round(b * f))


# ---- the palette ------------------------------------------------------------------------
# The island's own warmth: skin the settlers' (shared/palette.mjs's lighter tones), a sea-green tail
# with a paler fluke, auburn hair so she is not one colour from head to fin, coral shells.
SKIN = 0xe8bf9c
LIPS = 0xc0605a
EYES = 0x2a2232
HAIR = 0xa8482a
TAIL = 0x1f9e8f
BELLY = 0x6cc9b4
FIN = 0x5fd6c4
SHELL = 0xf08c7a
PEARL = 0xf3ead8


class Part:
    """One Blender object: triangles in island coordinates (before SCALE, in the frame where the water is
    y = 0) around its own origin, a colour per triangle."""

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = f'mermaid {name}', Vector(origin)
        self.tris, self.colours = [], []

    def tri(self, a, b, c, colour):
        self.tris.append((Vector(a), Vector(b), Vector(c)))
        self.colours.append(lin(colour))

    def build(self, lift):
        """Into Blender, every point moved up by `lift` (the waterline, so the lowest point is y = 0) and
        grown by SCALE about the frame's origin."""
        def place(p):
            return xyz(((p.x) * SCALE, (p.y + lift) * SCALE, (p.z) * SCALE))
        origin = place(self.origin)
        verts, faces = [], []
        for t in self.tris:
            base = len(verts)
            verts.extend(place(p) - origin for p in t)
            faces.append([base, base + 1, base + 2])
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(verts, [], faces)
        m = bpy.data.materials.new(f'plain:{self.name}')
        m.diffuse_color = (1, 1, 1, 1)
        mesh.materials.append(m)
        attr = mesh.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = attr
        for poly, c in zip(mesh.polygons, self.colours):
            poly.use_smooth = False
            for li in poly.loop_indices:
                attr.data[li].color = c
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = origin
        obj['building_part'] = True
        scene.collection.objects.link(obj)
        return obj


def facing(a, b, c, hint):
    """a, b, c wound so that the triangle faces `hint` - the island's material is single sided."""
    n = (Vector(b) - Vector(a)).cross(Vector(c) - Vector(a))
    if n.length < 1e-10:
        return None
    return (a, b, c) if n.dot(Vector(hint)) >= 0 else (a, c, b)


def tri(part, a, b, c, colour, hint):
    t = facing(a, b, c, hint)
    if t:
        part.tri(*t, colour)


def quad(part, a, b, c, d, colour, hint):
    """Two triangles, split on the a-c diagonal; a corner shared by two points is a triangle."""
    tri(part, a, b, c, colour, hint)
    tri(part, a, c, d, colour, hint)


def ring(c, rx, rz, n, start=0.0, up='y'):
    """n points round an ellipse about c, level (y fixed), from straight ahead (+z) round to +x."""
    out = []
    for j in range(n):
        a = start + 2 * math.pi * j / n
        out.append(Vector((c[0] + rx * math.sin(a), c[1], c[2] + rz * math.cos(a))))
    return out


def loft(part, rings, centres, colour, outward=True):
    """Quads between consecutive closed rings, wound away from (or towards) the line through their
    centres. `colour(i, j)` is the colour of the band between ring i and i+1 at side j."""
    n = len(rings[0])
    for i in range(len(rings) - 1):
        for j in range(n):
            k = (j + 1) % n
            a, b, c, d = rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]
            mid = (a + b + c + d) / 4
            axis = (centres[i] + centres[i + 1]) / 2
            hint = mid - axis if outward else axis - mid
            quad(part, a, b, c, d, colour(i, j), hint)


def cap(part, pts, centre, colour, hint):
    for j in range(len(pts)):
        tri(part, centre, pts[j], pts[(j + 1) % len(pts)], colour, hint)


def lean(y):
    return LEAN * max(0.0, y)


BODY = Part('body')

# ---- the torso ----------------------------------------------------------------------------
# From under the water (the tail's colour, where the scales begin) up to the neck, ten sides, each ring
# leaning forward with her. (y, half-width, half-depth)
TORSO = [(-0.07, 0.082, 0.064), (0.0, 0.072, 0.056), (0.05, 0.064, 0.05), (0.12, 0.071, 0.054),
         (0.17, 0.08, 0.061), (0.225, 0.095, 0.056), (0.255, 0.068, 0.045), (0.278, 0.032, 0.028)]
T_SIDES = 10
t_rings = [ring((0, y, lean(y)), rx, rz, T_SIDES) for y, rx, rz in TORSO]
t_centres = [Vector((0, y, lean(y))) for y, _, _ in TORSO]


def torso_colour(i, j):
    if TORSO[i][0] < 0:
        return shade(TAIL, 0.92 if j % 2 else 1.0)
    return shade(SKIN, 1.0 if j not in (4, 5, 6) else 0.94)   # her back a shade darker


loft(BODY, t_rings, t_centres, torso_colour)
cap(BODY, t_rings[0], t_centres[0], TAIL, (0, -1, 0))


def torso_at(y):
    """Half-width and half-depth of the torso at height y, by the rings above."""
    for (y0, x0, z0), (y1, x1, z1) in zip(TORSO, TORSO[1:]):
        if y0 <= y <= y1:
            f = (y - y0) / (y1 - y0)
            return x0 + (x1 - x0) * f, z0 + (z1 - z0) * f
    return TORSO[-1][1], TORSO[-1][2]


# The scales' edge at the water: a ring of points standing up from the hip, in the fin's colour, a hair
# outside the torso, so the seam between skin and tail is a frill and not a line.
FRILL_Y0, FRILL_Y1, FRILL_N = -0.03, 0.035, 14
for j in range(FRILL_N):
    a0, a1, am = (2 * math.pi * (j + f) / FRILL_N for f in (0, 1, 0.5))
    rx, rz = torso_at(FRILL_Y0)
    rx2, rz2 = torso_at(FRILL_Y1)
    p0 = Vector((1.06 * rx * math.sin(a0), FRILL_Y0, 1.06 * rz * math.cos(a0)))
    p1 = Vector((1.06 * rx * math.sin(a1), FRILL_Y0, 1.06 * rz * math.cos(a1)))
    tip = Vector((1.08 * rx2 * math.sin(am), FRILL_Y1, lean(FRILL_Y1) + 1.08 * rz2 * math.cos(am)))
    hint = Vector((math.sin(am), 0, math.cos(am)))
    tri(BODY, p0, p1, tip, shade(FIN, 1.0 if j % 2 else 0.86), hint)
    tri(BODY, p0, p1, tip, shade(TAIL, 0.8), -hint)

# ---- the shell top -------------------------------------------------------------------------
# Two scallops on her chest, each a fan from its hinge with ribs in two tones, bulged out a little, and a
# string of pearl between them and round her back.
SHELL_Y, SHELL_R = 0.148, 0.04


def chest_front(x, y):
    rx, rz = torso_at(y)
    q = max(0.0, 1 - (x / rx) ** 2)
    return lean(y) + rz * math.sqrt(q)


for side in (1, -1):
    hx = side * 0.036
    hinge = Vector((hx, SHELL_Y, chest_front(hx, SHELL_Y) + 0.006))
    rib = []
    for k in range(7):
        a = math.radians(22 + 136 * k / 6)
        x = hx + SHELL_R * math.cos(a) * 0.95
        y = SHELL_Y + SHELL_R * math.sin(a)
        bulge = 0.012 * math.sin(math.pi * k / 6)
        rib.append(Vector((x, y, chest_front(x, y) + 0.004 + bulge)))
    for k in range(6):
        colour = SHELL if k % 2 else shade(SHELL, 1.12)
        tri(BODY, hinge, rib[k], rib[k + 1], colour, (0, 0, 1))
        tri(BODY, hinge, rib[k], rib[k + 1], shade(SHELL, 0.7), (0, 0, -1))
    # the knob at the hinge
    knob = [Vector((hx + 0.008 * math.cos(a), SHELL_Y - 0.004 + 0.006 * math.sin(a), hinge.z + 0.003)) for a in
            (math.pi * k / 2 for k in range(4))]
    cap(BODY, knob, Vector((hx, SHELL_Y - 0.004, hinge.z + 0.008)), shade(SHELL, 0.85), (0, 0, 1))

STRAP_Y, STRAP_H = 0.172, 0.009
strap_lo = [p + Vector((0, 0, 0)) for p in ring((0, STRAP_Y, lean(STRAP_Y)), torso_at(STRAP_Y)[0] + 0.004, torso_at(STRAP_Y)[1] + 0.004, T_SIDES)]
strap_hi = [p + Vector((0, STRAP_H, 0)) for p in strap_lo]
loft(BODY, [strap_lo, strap_hi], [Vector((0, STRAP_Y, lean(STRAP_Y))), Vector((0, STRAP_Y + STRAP_H, lean(STRAP_Y)))],
     lambda i, j: shade(PEARL, 0.92 if j % 2 else 1.0))

# ---- the neck and head ---------------------------------------------------------------------
NECK = [(0.27, 0.025), (0.3, 0.023), (0.335, 0.024)]
n_rings = [ring((0, y, lean(y)), r, r * 0.95, 8) for y, r in NECK]
loft(BODY, n_rings, [Vector((0, y, lean(y))) for y, _ in NECK], lambda i, j: shade(SKIN, 0.95))

HEAD = Vector((0, 0.385, lean(0.385) + 0.004))
HEAD_R = (0.056, 0.069, 0.062)
H_SEG, H_RINGS = 10, 7


def head_point(u, v):
    """u round from the front, v from the crown (0) to the chin (pi). The chin is drawn in a little."""
    s, c = math.sin(v), math.cos(v)
    chin = 1.0 - 0.18 * max(0.0, -c) ** 2
    return Vector((HEAD.x + HEAD_R[0] * s * math.sin(u) * chin,
                   HEAD.y + HEAD_R[1] * c,
                   HEAD.z + HEAD_R[2] * s * math.cos(u) * (1 + 0.06 * max(0.0, -c))))


h_rows = [[head_point(2 * math.pi * j / H_SEG, math.pi * i / H_RINGS) for j in range(H_SEG)] for i in range(H_RINGS + 1)]
for i in range(H_RINGS):
    for j in range(H_SEG):
        k = (j + 1) % H_SEG
        a, b, c, d = h_rows[i][j], h_rows[i][k], h_rows[i + 1][k], h_rows[i + 1][j]
        quad(BODY, a, b, c, d, SKIN, (a + b + c + d) / 4 - HEAD)


def face_at(x, y, out=0.002):
    """A point on the front of her face at (x, y), `out` off the skin."""
    dx, dy = x / HEAD_R[0], (y - HEAD.y) / HEAD_R[1]
    q = max(0.0, 1 - dx * dx - dy * dy)
    return Vector((x, y, HEAD.z + HEAD_R[2] * math.sqrt(q) + out))


# The face: eyes and brows as small diamonds and slivers, a nose that stands off it, lips.
for side in (1, -1):
    ex, ey = side * 0.02, 0.392
    w, h = 0.0085, 0.0055
    quad(BODY, face_at(ex - w, ey), face_at(ex, ey - h), face_at(ex + w, ey), face_at(ex, ey + h, 0.0025), EYES, (0, 0, 1))
    bx = side * 0.021
    # a soft arch, the inner end the higher: level brows that dip inwards read as a frown at this size
    quad(BODY, face_at(bx - side * 0.011, 0.406), face_at(bx + side * 0.011, 0.402), face_at(bx + side * 0.01, 0.405),
         face_at(bx - side * 0.011, 0.409), shade(HAIR, 0.8), (0, 0, 1))
tip = face_at(0, 0.373, 0.013)
for a, b in ((face_at(-0.0075, 0.368), face_at(0, 0.392)), (face_at(0, 0.392), face_at(0.0075, 0.368)),
             (face_at(0.0075, 0.368), face_at(-0.0075, 0.368))):
    tri(BODY, a, b, tip, shade(SKIN, 1.04), (a + b) / 2 - HEAD)
quad(BODY, face_at(-0.012, 0.356), face_at(0, 0.350), face_at(0.012, 0.356), face_at(0, 0.357, 0.003), LIPS, (0, 0, 1))   # corners up

# ---- the arms ------------------------------------------------------------------------------
# From the shoulder down to an elbow on the water and the forearm lying on it, towards the other: she
# leans on the sea as on a sill. Six sides; a ring's plane is square to the arm, averaged at the elbow.
ARM = [  # (point, radius)
    ((0.08, 0.226, lean(0.226)), 0.027),
    ((0.106, 0.125, 0.064), 0.024),
    ((0.116, 0.02, 0.118), 0.021),     # the elbow, on the water
    ((0.088, 0.015, 0.2), 0.018),
    ((0.052, 0.016, 0.255), 0.016),    # the wrist
]


def tube(part, points, radii, colour, sides=6, flat=1.0):
    """A tube along a polyline, closed at both ends. `flat` squashes the rings in their own 'up'."""
    pts = [Vector(p) for p in points]
    rings, centres = [], []
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        t.normalize()
        ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
        side = t.cross(ref).normalized()
        up = side.cross(t).normalized()
        r = radii[i]
        rings.append([p + side * (r * math.cos(2 * math.pi * k / sides)) + up * (r * flat * math.sin(2 * math.pi * k / sides))
                      for k in range(sides)])
        centres.append(p)
    loft(part, rings, centres, lambda i, j: colour(i, j) if callable(colour) else colour)
    c0 = colour(0, 0) if callable(colour) else colour
    c1 = colour(len(pts) - 2, 0) if callable(colour) else colour
    cap(part, rings[0], centres[0], c0, centres[0] - centres[1])
    cap(part, rings[-1], centres[-1], c1, centres[-1] - centres[-2])


for side in (1, -1):
    pts = [(side * p[0], p[1], p[2]) for p, _ in ARM]
    tube(BODY, pts, [r for _, r in ARM], lambda i, j: shade(SKIN, 0.96 if j % 2 else 1.0))
    # the hand, flat on the water, fingers towards the other hand
    hc = Vector((side * 0.028, 0.017, 0.276))
    hand = []
    for k in range(6):
        a = 2 * math.pi * k / 6
        hand.append(Vector((hc.x + 0.03 * math.cos(a), hc.y, hc.z + 0.02 * math.sin(a))))
    top = hc + Vector((0, 0.012, 0))
    bot = hc - Vector((0, 0.008, 0))
    for k in range(6):
        a, b = hand[k], hand[(k + 1) % 6]
        tri(BODY, a, b, top, shade(SKIN, 1.02), (a + b) / 2 - hc + Vector((0, 0.5, 0)))
        tri(BODY, a, b, bot, shade(SKIN, 0.9), (a + b) / 2 - hc - Vector((0, 0.5, 0)))

# ---- the hair ------------------------------------------------------------------------------
# A crown over her head that opens over her face and falls down her back to the water, worked out as rows
# of an arc: (y, centre z, half-width, half-depth, the opening's half angle at the front). It has an outside
# and an inside a little within it, and the two are joined at the arc's ends and at the bottom, since the
# material is single sided and her face is seen through the opening.
HZ = HEAD.z
HAIR_ROWS = [
    (0.47, HZ - 0.004, 0.013, 0.013, 0.0),
    (0.46, HZ - 0.006, 0.045, 0.047, 0.0),
    (0.44, HZ - 0.008, 0.064, 0.067, 0.5),
    (0.41, HZ - 0.01, 0.071, 0.073, 0.95),
    (0.372, HZ - 0.014, 0.07, 0.068, 1.2),
    (0.335, HZ - 0.03, 0.062, 0.05, 1.32),
    (0.295, HZ - 0.05, 0.078, 0.04, 1.4),
    (0.225, lean(0.225) - 0.072, 0.092, 0.036, 1.5),
    (0.15, lean(0.15) - 0.074, 0.088, 0.034, 1.52),
    (0.07, lean(0.07) - 0.072, 0.082, 0.03, 1.55),
    (-0.015, -0.074, 0.072, 0.026, 1.58),
]
HAIR_ORIGIN = (0, 0.44, HZ - 0.008)
HAIR_PART = Part('hair', HAIR_ORIGIN)
H_ARC = 12
THICK = 0.007


def hair_row(y, cz, rx, rz, a, inset=0.0):
    out = []
    lo, hi = -(math.pi - a), math.pi - a
    for k in range(H_ARC + 1):
        th = lo + (hi - lo) * k / H_ARC
        # th = 0 is the back of her head; a ragged lower edge: every other strand hangs a little longer
        out.append(Vector(((rx - inset) * math.sin(th), y, cz - (rz - inset) * math.cos(th))))
    return out


outer = [hair_row(*r) for r in HAIR_ROWS]
inner = [hair_row(*r, inset=THICK) for r in HAIR_ROWS]
# ragged ends: the bottom row's strands alternately longer
for k in range(H_ARC + 1):
    if k % 2:
        outer[-1][k] = outer[-1][k] - Vector((0, 0.035, 0))
        inner[-1][k] = inner[-1][k] - Vector((0, 0.035, 0))
for i in range(len(HAIR_ROWS) - 1):
    axis = Vector((0, (HAIR_ROWS[i][0] + HAIR_ROWS[i + 1][0]) / 2, (HAIR_ROWS[i][1] + HAIR_ROWS[i + 1][1]) / 2))
    for k in range(H_ARC):
        tone = shade(HAIR, 1.0 if (k + i) % 3 else 0.88)          # strands in two tones
        a, b, c, d = outer[i][k], outer[i][k + 1], outer[i + 1][k + 1], outer[i + 1][k]
        mid = (a + b + c + d) / 4
        quad(HAIR_PART, a, b, c, d, tone, mid - axis)
        a, b, c, d = inner[i][k], inner[i][k + 1], inner[i + 1][k + 1], inner[i + 1][k]
        quad(HAIR_PART, a, b, c, d, shade(HAIR, 0.7), axis - (a + b + c + d) / 4)
    # the arc's two ends, where the opening is: outside to inside
    for k, sgn in ((0, -1), (H_ARC, 1)):
        a, b, c, d = outer[i][k], outer[i + 1][k], inner[i + 1][k], inner[i][k]
        hint = Vector((sgn, 0, 0.6))
        quad(HAIR_PART, a, b, c, d, shade(HAIR, 0.85), hint)
for k in range(H_ARC):
    a, b, c, d = outer[-1][k], outer[-1][k + 1], inner[-1][k + 1], inner[-1][k]
    quad(HAIR_PART, a, b, c, d, shade(HAIR, 0.75), (0, -1, 0))

# Two locks from her temples over her shoulders onto her chest.
for side in (1, -1):
    pts = [(side * 0.05, 0.4, HZ + 0.018), (side * 0.062, 0.34, HZ + 0.012), (side * 0.072, 0.27, lean(0.27) + 0.045),
           (side * 0.07, 0.2, lean(0.2) + 0.064), (side * 0.064, 0.13, lean(0.13) + 0.062)]
    tube(HAIR_PART, pts, [0.016, 0.017, 0.016, 0.012, 0.006], lambda i, j: shade(HAIR, 0.94 if j % 2 else 1.04), sides=5, flat=0.6)

# ---- the tail ------------------------------------------------------------------------------
# From the hinge at her hip down and back under the water to the fluke: rings along a curve, wider than
# deep, in bands of two tones with a paler belly, and a fluke spread level at its end.
HINGE = Vector((0, -0.075, -0.005))
TAIL_PART = Part('tail', HINGE)
P1, P2 = Vector((0, -0.25, -0.06)), Vector((0, -0.3, -0.44))
TAIL_RINGS = 12
TAIL_SIDES = 10


def tail_at(t):
    a = HINGE * ((1 - t) ** 2) + P1 * (2 * (1 - t) * t) + P2 * (t * t)
    d = (P1 - HINGE) * (2 * (1 - t)) + (P2 - P1) * (2 * t)
    return a, d.normalized()


def tail_r(t):
    # full at the hips, slimming to the fluke's root
    w = 0.086 - 0.06 * t ** 1.3 + 0.012 * math.sin(math.pi * min(1.0, t * 2.2))
    return w, w * 0.78


t_rows, t_centres = [], []
for i in range(TAIL_RINGS + 1):
    t = i / TAIL_RINGS
    c, d = tail_at(t)
    side = Vector((1, 0, 0))
    up = side.cross(d).normalized()       # +y for a tail running back level
    rx, ru = tail_r(t)
    t_rows.append([c + side * (rx * math.sin(2 * math.pi * k / TAIL_SIDES)) + up * (ru * math.cos(2 * math.pi * k / TAIL_SIDES))
                   for k in range(TAIL_SIDES)])
    t_centres.append(c)


def tail_colour(i, j):
    under = j in (4, 5, 6)                # k = 5 is straight down the belly
    base = BELLY if under else TAIL
    return shade(base, 1.0 if (i + j) % 2 else 0.86)


loft(TAIL_PART, t_rows, t_centres, tail_colour)
cap(TAIL_PART, t_rows[0], t_centres[0], TAIL, t_centres[0] - t_centres[1])
end_c, end_d = tail_at(1.0)
# The fluke: two lobes spread level from the tail's end, a fan each in ribbed tones, both faces drawn.
FLUKE = [(0.0, -0.005), (0.05, 0.03), (0.12, 0.085), (0.19, 0.16), (0.14, 0.155), (0.085, 0.14), (0.035, 0.12), (0.0, 0.1)]
up_end = Vector((1, 0, 0)).cross(end_d).normalized()
for side in (1, -1):
    pts = [end_c + Vector((side * s, 0, 0)) + end_d * a for s, a in FLUKE]
    root = end_c - end_d * 0.02
    for k in range(len(pts) - 1):
        colour = FIN if k % 2 else shade(FIN, 0.82)
        tri(TAIL_PART, root, pts[k], pts[k + 1], colour, up_end)
        tri(TAIL_PART, root, pts[k], pts[k + 1], shade(FIN, 0.7), -up_end)

# ---- bake ----------------------------------------------------------------------------------
parts = [BODY, HAIR_PART, TAIL_PART]
low = min(p.y for part in parts for t in part.tris for p in t)
W = -low                                  # the waterline, over her lowest point
objs = [p.build(W) for p in parts]
bpy.context.view_layer.update()
top = max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)
scene['building_height'] = top
scene.unit_settings.system = 'NONE'
scene.unit_settings.scale_length = 1


def anchor(name, p):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(p)
    scene.collection.objects.link(e)


anchor('waterline', (0, W * SCALE, 0))
counts = {p.name: len(p.tris) for p in parts}
print('mermaid triangles:', ', '.join(f'{k} {v}' for k, v in counts.items()), flush=True)
print(f'mermaid: {sum(counts.values())} triangles, top {top:.3f}, waterline {W * SCALE:.4f} '
      f'({top - W * SCALE:.3f} above it)', flush=True)

if BAKE:
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'mermaid.blend'))
    runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'mermaid'})

# ---- previews ------------------------------------------------------------------------------
if PREVIEW_DIR:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    WL = W * SCALE
    sea = bpy.data.meshes.new('sea')
    sea.from_pydata([xyz((-20, WL, -20)), xyz((20, WL, -20)), xyz((20, WL, 20)), xyz((-20, WL, 20))], [], [[0, 3, 2, 1]])
    so = bpy.data.objects.new('sea', sea)
    scene.collection.objects.link(so)
    sa = sea.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    for d in sa.data:
        d.color = (0.05, 0.22, 0.3, 1)
    so.color = (1, 1, 1, 0.75)
    smat = bpy.data.materials.new('sea')
    smat.diffuse_color = (0.08, 0.3, 0.38, 0.72)
    sea.materials.append(smat)

    # A settler for scale, standing on the sea's surface as if on a deck beside her: 0.43 tall.
    m = bpy.data.meshes.new('settler')
    pts, faces = [], []
    for c, s in (((0, 0.1, 0), (0.1, 0.2, 0.07)), ((0, 0.28, 0), (0.13, 0.16, 0.08)), ((0, 0.39, 0), (0.08, 0.08, 0.08))):
        base = len(pts)
        for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
            pts.append(xyz((0.6 + c[0] + x * s[0] / 2, WL + c[1] + y * s[1] / 2, c[2] + z * s[2] / 2)))
        faces += [[base + i for i in f] for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3))]
    m.from_pydata(pts, [], faces)
    st = bpy.data.objects.new('settler', m)
    scene.collection.objects.link(st)
    sta = m.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    for d in sta.data:
        d.color = (0.55, 0.12, 0.08, 1)

    tail_obj = next(o for o in objs if o.name == 'mermaid tail')
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.shadow_intensity = 0.3
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_backface_culling = True
    sh.background_type = 'VIEWPORT'
    sh.background_color = (0.62, 0.74, 0.86)
    scene.display.render_aa = '16'
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x, scene.render.resolution_y = 1200, 1000
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    H = WL + 0.3
    SHOTS = {   # eye, look, lens, tail flick (radians up), sea drawn
        'front': ((0, H + 0.05, 2.2), (0, H, 0), 50, 0.0, True),
        'quarter': ((-1.5, H + 0.35, 1.6), (0, H - 0.05, 0), 50, 0.0, True),
        'side': ((-2.4, H, 0.0), (0, H - 0.15, -0.15), 40, 0.0, False),
        'back': ((0.9, H + 0.5, -2.0), (0, H - 0.1, -0.2), 45, 0.0, True),
        'face': ((0.15, WL + 0.52, 0.85), (0, WL + 0.48, 0), 55, 0.0, True),
        'flick': ((-2.0, H + 0.3, 1.2), (0, H - 0.05, -0.3), 40, 1.15, True),
        'swimmer': ((-0.8, WL + 0.12, 3.2), (0, H, 0), 35, 0.0, True),
    }
    for view in VIEWS:
        eye, look, lens, flick, wet = SHOTS[view]
        tail_obj.rotation_euler = (flick, 0, 0)
        so.hide_render = not wet
        cam.data.lens = lens
        cam.location = xyz(eye)
        cam.rotation_euler = (xyz(look) - xyz(eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PREVIEW_DIR / f'mermaid-{view}.png')
        bpy.ops.render.render(write_still=True)
    tail_obj.rotation_euler = (0, 0, 0)
