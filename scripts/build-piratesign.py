"""The Salty Kraken's hanging sign. Rebuild with
scripts/blender.mjs --background --python scripts/build-piratesign.py.

After assets/piratesign/reference/: a wrought-iron wall arm with a curl at its tip and a
quarter-circle brace under it, a ragged board of weathered planks hung from it on two chains,
iron straps and rivets across the planks, a carved kraken along the top plank, and a lantern
hanging from a hook at the end of the arm. The lettering - THE SALTY / KRAKEN / PIRATE PUB /
GROG, ALE & SEA STORIES - is not modelled: web/js/piratesign.js paints it on a canvas and lays it
over the four planks that carry it (`piratesign swing text <n>`), which is why those four are
flat, flush and parts of their own.

It is a hero set - one asset, `piratesign`, with no collection - and not a prop or an addon,
because what makes it the Salty Kraken's is the kraken: eight tentacles in relief on both faces
and a head with eyes, which is most of its triangles. `prop_` (120) and `addon_` (150) cannot
draw a board and a lantern, let alone that; `civic_` is for a building with a lot. There is one
pirate tavern on an island and it is looked at from the quay on foot, so it can afford ~1500.
The 4000 ceiling is where heroes stop, not a target.

Frames, and they are not the island's usual ones:

    x = 0      the wall. The arm runs out along +x; the set is hung by turning its +x to the
               facade's outward normal.
    z          the board's faces: the front (+z) and the back (-z) are the same, kraken and all,
               because a sign standing out from a wall is read from both ways along the street.
    y = 0      the lowest point of the board, because model-rules.mjs stands every asset on the
               ground. The point on the wall the arm is fixed to is `anchor.sign`, and that is
               the point to put on the facade: the set's origin goes at facade - anchor.sign.

Parts that move, left out of the merge by `isPirateSignMoving` (web/js/piratesign.js) and hung
on their own pivots there, as build-sawmill.py does it:

    piratesign swing board / kraken / text <n>   the board, its chains and its carving, all with
                                  their origin on the line through the two chain hooks under the
                                  arm - the axis it swings about, along x.
    piratesign lantern            the lantern, its origin at its hook, swinging about x as well.

The rest - `piratesign arm` - is still: the wall plate, the arm, the brace and the curl.

Colours come from the reference's rusted iron and tarry, sea-worn oak, flattened to one colour a
slot. The planks take the plank sheet, which draws their grain along x; the iron, the carving and
the moss are plain. The lantern's glass is the one emissive slot. Written in island coordinates
(x out from the wall, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/piratesign'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SET = 'piratesign'


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(sheet, name, color, emissive=False):
    m = bpy.data.materials.new(f'{sheet}:{name}')
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    if emissive:
        m['emissive'] = 1.0
    return m


IRON = material('plain', 'kraken iron', 0x3a2b23)
RUST = material('plain', 'kraken rust', 0x6a4027)
OAK = material('plank', 'kraken oak', 0x6b4a32)
OAK_DARK = material('plank', 'kraken oak dark', 0x553a28)
OAK_GREY = material('plank', 'kraken oak grey', 0x735a44)
CARVING = material('plain', 'kraken carving', 0x8b5a36)
CARVING_DARK = material('plain', 'kraken carving dark', 0x5e3a22)
EYES = material('plain', 'kraken eyes', 0xd8a847)
PUPIL = material('plain', 'kraken pupil', 0x1c130d)
MOSS = material('plain', 'kraken moss', 0x55632f)
GLOW = material('plain', 'kraken lantern glow', 0xffc766, emissive=True)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = f'{SET} {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat):
        base, s = len(self.verts), self.slot(mat)
        self.verts.extend(Vector(p) - self.origin for p in points)
        for f in faces:
            self.faces.append([base + i for i in f])
            self.mats.append(s)

    def face(self, points, mat, out):
        """One polygon, wound so that it faces `out` - for the relief, whose strips twist."""
        p = [Vector(q) for q in points]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        if n.dot(Vector(out)) < 0:
            p.reverse()
        self.add(p, [list(range(len(p)))], mat)

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([xyz(v) for v in self.verts], [], self.faces)
        for mat in self.slots:
            mesh.materials.append(mat)
        for poly, m in zip(mesh.polygons, self.mats):
            poly.material_index = m
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = xyz(self.origin)
        obj['building_part'] = True
        bpy.context.scene.collection.objects.link(obj)
        return obj


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def pyramid(part, centre, half, y0, y1, mat):
    """A four-sided cap: base square at y0, point at y1 (below it for a finial)."""
    cx, cz = centre
    base = [(cx - half, y0, cz - half), (cx + half, y0, cz - half), (cx + half, y0, cz + half), (cx - half, y0, cz + half)]
    tip = Vector((cx, y1, cz))
    up = 1 if y1 > y0 else -1
    for i in range(4):
        a, b = Vector(base[i]), Vector(base[(i + 1) % 4])
        part.face([a, b, tip], mat, ((a + b) / 2 - Vector((cx, y0, cz))) + Vector((0, 0.3 * up, 0)))
    part.face(base, mat, (0, -up, 0))


def prism(part, outline, z0, z1, mat):
    """A plank: an (x, y) outline, counter-clockwise seen from the front, from z0 to z1."""
    n = len(outline)
    pts = [(x, y, z0) for x, y in outline] + [(x, y, z1) for x, y in outline]
    part.add(pts, [list(range(n, 2 * n)), list(range(n))[::-1]]
             + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], mat)


def tube(part, points, r, mat, flat=0.0):
    """A square iron bar swept along a polyline in the z = `flat` plane."""
    pts = [Vector((x, y, flat)) for x, y in points]
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        side = Vector((-d.y, d.x, 0))
        z = Vector((0, 0, 1))
        rings.append([p + side * r + z * r, p - side * r + z * r, p - side * r - z * r, p + side * r - z * r])
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            q = [a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]]
            mid = sum(q, Vector()) / 4
            centre = (sum(a, Vector()) + sum(b, Vector())) / 8
            part.face(q, mat, mid - centre)
    for ring, back in ((rings[0], pts[0] - pts[1]), (rings[-1], pts[-1] - pts[-2])):
        part.face(ring, mat, back)


def arc(cx, cy, r0, r1, a0, a1, n):
    """Points along a spiral from angle a0 to a1 (radians), its radius easing from r0 to r1."""
    return [(cx + (r0 + (r1 - r0) * i / n) * math.cos(a0 + (a1 - a0) * i / n),
             cy + (r0 + (r1 - r0) * i / n) * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ---- measurements ------------------------------------------------------------------------
# A board about 1.3 m across and 1.7 m tall, hung two metres out on an arm of 2 m: the
# reference's proportions at a size the tavern's upper storey (~0.7 a floor) can carry.
T = 0.024                   # board thickness; the faces are at +-FRONT
FRONT = T / 2
KFACE = FRONT + 0.0015     # the kraken plank stands a hair proud of the rest
CX = 0.285                  # the board's middle, out from the wall
ARM_Y = 0.492               # the arm's middle
BAR = 0.016                 # the arm's square section
HOOK_Y = ARM_Y - BAR / 2    # its underside, where the chains and the lantern hang
CHAINS = (0.175, 0.395)     # where the two chains hang, along the arm
LANTERN_X = 0.5
PIVOT = (CX, HOOK_Y, 0.0)   # the board swings about the line through its chain hooks

# ---- the arm: still ------------------------------------------------------------------------
arm = Part('arm')
# The wall plate, bolted top and bottom, and the bar out from it.
box(arm, (0.006, ARM_Y - 0.055, 0), (0.012, 0.17, 0.036), IRON)
for y in (ARM_Y - 0.125, ARM_Y + 0.015):
    box(arm, (0.016, y, 0), (0.008, 0.012, 0.012), RUST)
box(arm, (0.258, ARM_Y, 0), (0.496, BAR, BAR), IRON)
# The curl at its tip: up, over and in, a scroll a smith would draw.
tube(arm, arc(LANTERN_X + 0.004, ARM_Y + 0.034, 0.034, 0.014, -math.pi / 2, math.pi * 1.25, 10), BAR * 0.4, IRON)
# The brace: a quarter circle from the corner, meeting the wall below the plate's foot.
tube(arm, arc(0.012, ARM_Y, 0.118, 0.118, 0.0, -math.pi / 2, 6), 0.006, IRON)
# A small scroll where the brace meets the arm, and the collars the chains hang from.
tube(arm, arc(0.09, ARM_Y - 0.03, 0.02, 0.008, math.pi * 0.2, math.pi * 1.4, 5), 0.004, IRON)
for x in (*CHAINS, LANTERN_X):
    box(arm, (x, ARM_Y, 0), (0.012, BAR + 0.006, BAR + 0.006), RUST)
arm.build()

# ---- the board: swings ---------------------------------------------------------------------
board = Part('swing board', PIVOT)


def ragged(x0, x1, y0, y1, jag):
    """A plank's outline: square along its edges, one split at each end."""
    h = y1 - y0
    j0, j1, j2, j3 = jag
    return [(x0 + j0, y0), (x1 - j1, y0), (x1 + j2, y0 + h * 0.55), (x1, y1),
            (x0 + j3, y1), (x0 - j2, y0 + h * 0.45)]


# The bottom plank, splintered to a point in the middle as on the reference, and mossy.
prism(board, [(0.19, 0.02), (0.235, 0.004), (0.272, 0.012), (0.29, 0.0), (0.33, 0.014), (0.372, 0.008),
              (0.392, 0.03), (0.4, 0.057), (0.165, 0.057), (0.172, 0.036)], -FRONT - 0.002, FRONT - 0.002, OAK_DARK)
# The four lettered planks, flush: web/js/piratesign.js lays one flat canvas across them.
TEXT = [  # (y0, y1, x0, x1, jag, sheet) - bottom to top
    (0.057, 0.118, 0.145, 0.425, (0.004, 0.006, 0.005, 0.002), OAK),
    (0.118, 0.176, 0.132, 0.438, (0.002, 0.004, 0.006, 0.005), OAK_GREY),
    (0.176, 0.24, 0.125, 0.446, (0.005, 0.002, 0.004, 0.006), OAK),
    (0.24, 0.296, 0.132, 0.44, (0.003, 0.005, 0.006, 0.002), OAK_DARK),
]
for i, (y0, y1, x0, x1, jag, mat) in enumerate(TEXT, 1):
    plank = Part(f'swing text {i}', PIVOT)
    prism(plank, ragged(x0, x1, y0, y1, jag), -FRONT, FRONT, mat)
    plank.build()
# The kraken's plank on top, humped up where the head is.
prism(board, [(0.142, 0.296), (0.43, 0.296), (0.438, 0.335), (0.43, 0.375), (0.415, 0.402), (0.375, 0.41),
              (0.335, 0.42), (0.31, 0.436), (0.285, 0.445), (0.26, 0.436), (0.235, 0.42), (0.195, 0.408),
              (0.155, 0.404), (0.138, 0.375), (0.146, 0.335)], -KFACE, KFACE, OAK_GREY)

# Iron: two straps down the ends of the kraken plank and the title, clasping both faces; two
# brackets across the bottom corners; a plate where each chain goes through the plank.
for x in (0.152, 0.414):
    box(board, (x, 0.305, 0), (0.016, 0.17, T + 0.007), IRON)
for x, rz in ((0.188, -0.8), (0.378, 0.8)):
    box(board, (x, 0.033, 0), (0.05, 0.013, T + 0.004), IRON, rz=rz)
EYE_Y = {CHAINS[0]: 0.402, CHAINS[1]: 0.404}
for x in CHAINS:
    box(board, (x, EYE_Y[x] - 0.012, 0), (0.018, 0.03, T + 0.006), RUST)
# Rivets through both faces: on the straps where they cross a plank, and on the brackets.
for x in (0.152, 0.414):
    for y in (0.232, 0.268, 0.332, 0.372):
        box(board, (x, y, 0), (0.008, 0.008, T + 0.012), RUST)
for x, y in ((0.172, 0.047), (0.204, 0.02), (0.394, 0.047), (0.362, 0.02), (CHAINS[0], 0.386), (CHAINS[1], 0.388)):
    box(board, (x, y, 0), (0.007, 0.007, T + 0.011), RUST)

# The chains: three links each, turned alternately, from the collar to the plate.
for x in CHAINS:
    top, bottom = HOOK_Y + 0.004, EYE_Y[x] + 0.002
    step = (top - bottom) / 3
    for k in range(3):
        y = top - step * (k + 0.5)
        if k % 2:
            box(board, (x, y, 0), (0.004, step + 0.008, 0.012), IRON)
        else:
            box(board, (x, y, 0), (0.012, step + 0.008, 0.004), IRON)

# Moss in the splits and along the bottom, on both faces.
MOSS_AT = [[(0.2, 0.012), (0.24, 0.006), (0.25, 0.02), (0.21, 0.028)],
           [(0.33, 0.016), (0.37, 0.01), (0.385, 0.03), (0.35, 0.034)],
           [(0.395, 0.06), (0.424, 0.066), (0.418, 0.085), (0.4, 0.08)],
           [(0.15, 0.064), (0.168, 0.062), (0.172, 0.088), (0.152, 0.092)]]
for side in (1, -1):
    for patch in MOSS_AT:
        z = side * (FRONT + 0.0012)
        board.face([(x, y, z) for x, y in patch], MOSS, (0, 0, side))
board.build()

# ---- the kraken: swings with the board ---------------------------------------------------
kraken = Part('swing kraken', PIVOT)
HEAD = (CX, 0.382)
HEAD_R = (0.037, 0.05)


def dome(side):
    """The head: an egg of three rings rising off the plank to a point."""
    K = 10
    ring = lambda s, dz, up: [Vector((HEAD[0] + math.cos(2 * math.pi * i / K) * HEAD_R[0] * s,
                                      HEAD[1] + up + math.sin(2 * math.pi * i / K) * HEAD_R[1] * s,
                                      side * (KFACE + dz))) for i in range(K)]
    # Rings that climb as they shrink, so the mantle bulges at the top the way an octopus's does.
    rings = [ring(1.0, 0.0, 0.0), ring(0.86, 0.011, 0.004), ring(0.55, 0.019, 0.008)]
    tip = Vector((HEAD[0], HEAD[1] + 0.011, side * (KFACE + 0.022)))
    centre = Vector((HEAD[0], HEAD[1], 0))
    for a, b in zip(rings, rings[1:]):
        for i in range(K):
            q = [a[i], a[(i + 1) % K], b[(i + 1) % K], b[i]]
            kraken.face(q, CARVING, sum(q, Vector()) / 4 - centre)
    for i in range(K):
        tri = [rings[-1][i], rings[-1][(i + 1) % K], tip]
        kraken.face(tri, CARVING, sum(tri, Vector()) / 3 - centre)
    # Eyes low on the head, a slit in each, and a frown of a brow over them.
    for s in (-1, 1):
        ex = HEAD[0] + s * 0.015
        box(kraken, (ex, 0.356, side * (KFACE + 0.0105)), (0.014, 0.01, 0.006), EYES)
        box(kraken, (ex, 0.356, side * (KFACE + 0.0138)), (0.0035, 0.009, 0.002), PUPIL)
        box(kraken, (ex, 0.367, side * (KFACE + 0.013)), (0.018, 0.005, 0.006), CARVING_DARK, rz=s * 0.35)


# (base x off the middle, base y, heading, length, curl, width): the right-hand four; the left
# are their mirror. The heading is where a tentacle leaves the head, the curl how far it turns
# by its tip - most of it at the end, which is what makes a curl a curl and not an arc.
TENTACLES = [
    (0.024, 0.362, 0.4, 0.15, -3.9, 0.0115),    # out along the top, curling down at the end
    (0.022, 0.343, -0.3, 0.122, 3.6, 0.0105),     # out under it, curling up into its curl
    (0.012, 0.336, -1.2, 0.078, 2.8, 0.009),      # a short one down and out
    (0.026, 0.398, 0.8, 0.075, -2.4, 0.0072),     # up over the shoulder of the head
]
SEGS = 9


def tentacle(side, s, dx, y, heading, length, curl, width):
    """A tapering ridge laid on the plank along a curling centre line: two sloping faces, and
    under them a flat band a little wider in the dark carving colour - the cut round a carving,
    which is what makes it read as relief rather than as a rope laid on the wood."""
    pts, p = [], Vector((HEAD[0] + s * dx, y, 0))
    for i in range(SEGS + 1):
        pts.append(p.copy())
        t = (i + 0.5) / SEGS
        a = heading + curl * t ** 1.6
        p = p + Vector((s * math.cos(a), math.sin(a), 0)) * (length / SEGS)
    z0, lift = side * KFACE, side
    rows = []
    for i, c in enumerate(pts):
        d = (pts[min(i + 1, SEGS)] - pts[max(i - 1, 0)]).normalized()
        n = Vector((-d.y, d.x, 0))
        w = width * (1 - 0.85 * i / SEGS)
        base = Vector((0, 0, z0 + lift * 0.0004))
        rows.append((c + n * w + base, c + Vector((0, 0, z0 + lift * w * 1.1)), c - n * w + base,
                     c + n * w * 1.45 + base, c - n * w * 1.45 + base))
    out = Vector((0, 0, lift))
    for i in range(SEGS):
        (l0, t0, r0, ol0, or0), (l1, t1, r1, ol1, or1) = rows[i], rows[i + 1]
        n = (pts[i + 1] - pts[i]).normalized()
        side_n = Vector((-n.y, n.x, 0))
        kraken.face([l0, l1, t1, t0], CARVING, side_n + out)
        kraken.face([t0, t1, r1, r0], CARVING, -side_n + out)
        kraken.face([ol0, ol1, or1, or0], CARVING_DARK, out)


for side in (1, -1):
    dome(side)
    for s in (1, -1):
        for spec in TENTACLES:
            tentacle(side, s, *spec)
kraken.build()

# ---- the lantern: swings from its hook ---------------------------------------------------
lantern = Part('lantern', (LANTERN_X, HOOK_Y, 0))
L = LANTERN_X
box(lantern, (L, HOOK_Y - 0.009, 0), (0.004, 0.02, 0.012), IRON)      # the hook's loop
box(lantern, (L, HOOK_Y - 0.021, 0), (0.014, 0.004, 0.004), IRON)              # the handle
pyramid(lantern, (L, 0), 0.031, HOOK_Y - 0.036, HOOK_Y - 0.019, IRON)                   # the cap
box(lantern, (L, HOOK_Y - 0.04, 0), (0.062, 0.008, 0.062), RUST)              # top and bottom plates
box(lantern, (L, HOOK_Y - 0.12, 0), (0.062, 0.008, 0.062), RUST)
for dx in (-0.025, 0.025):
    for dz in (-0.025, 0.025):
        box(lantern, (L + dx, HOOK_Y - 0.08, dz), (0.007, 0.074, 0.007), IRON)
for dx, dz, w in ((0, 0.026, (0.004, 0.072, 0.003)), (0, -0.026, (0.004, 0.072, 0.003)),
                  (0.026, 0, (0.003, 0.072, 0.004)), (-0.026, 0, (0.003, 0.072, 0.004))):
    box(lantern, (L + dx, HOOK_Y - 0.08, dz), w, IRON)
box(lantern, (L, HOOK_Y - 0.08, 0), (0.044, 0.072, 0.044), GLOW)              # the glass, lit
pyramid(lantern, (L, 0), 0.012, HOOK_Y - 0.124, HOOK_Y - 0.136, IRON)                   # a finial under it
lantern.build()

# Where the arm is fixed to the wall: the point the tavern puts on its facade.
sign = bpy.data.objects.new('anchor.sign', None)
sign.location = xyz((0.0, ARM_Y, 0.0))
bpy.context.scene.collection.objects.link(sign)

bpy.context.scene['building_height'] = round(ARM_Y + 0.034 * 2 + BAR, 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'piratesign.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': SET})
