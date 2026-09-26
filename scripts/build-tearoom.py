"""The tea room. Rebuild with scripts/blender.mjs --background --python scripts/build-tearoom.py.

A tea room on a corner of the square (Plans/knus-dorpscentrum.md): a pale cream stone ground floor
wrapped in tall round-topped windows - three either side of the door and two round each corner -
framed in sage green, with leading across the panes; a sage door under an arched fanlight; above
it a jettied upper floor of cream plaster in dark timber, window boxes of flowers under its three
windows, and a very steep slate roof with one tall gable over the door and a crooked chimney on
the ridge. Beside the door a white teapot with a gold band hangs from a curly iron bracket, over
the door a small sage board carries a gold teacup, and out front two little white iron café
tables each have two chairs.

One civic asset, `civic_tearoom` (budget 1500), and nothing that moves. It fills its lot the way
a terrace house fills its plot: the walls run x -1.40..+1.40 so the neighbours stand almost
against it, the roof stops at 1.47, and nothing on the pavement passes z 1.46. The door is in the
middle of the front, because that is where the island's paths arrive, and the tables stand either
side of it so the doorway stays clear. `anchor.door` is at its foot, `anchor.smoke` on the
chimney pot.

Every window is a dark pane with a smaller emissive shape just in front of it, as in
build-bakery.py: dark by day with a lit middle, and the middle is what glows at night. Here the
shapes are arches - an n-gon of a rectangle and a half circle, six segments round the top, which
is the fewest that still reads as round rather than as a bell - so that after dark the ground
floor is a row of warm round-topped lights, which is the one thing that says "tea room" from the
far side of the square. The arches are flat layers a few millimetres apart (sage frame, dark
glass, glow, leading) rather than recesses: a solid box has no hole to put a window in, and at
island distance a recess of a hand's depth is invisible while its triangles are not.

The house is solid boxes rather than wall slabs: nobody looks into it, and a box is twelve
triangles where four walls are forty-eight. Timber that is only ever seen from the front is drawn
without the faces that lie against the plaster. The teapot is the one round thing that is turned
on a lathe (eight sides, which is where most of its triangles go), because it is the sign and has
to read as a teapot and not as a ball; the spout points along the street so its silhouette shows
from the front. Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/tearoom'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


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


# The palette is the terrace's (cream plaster, near-black oak, blue-grey slate) with this shop's
# own colour in the paint: sage green, with cream stone and gold beside it.
STONE = material('stone', 'tearoom cream stone', 0xe4dac2)
FOOTING = material('stone', 'tearoom footing', 0xa49b89)
PLASTER = material('wall', 'tearoom plaster', 0xf0e6cc)
TIMBER = material('plank', 'tearoom timber', 0x3e2a1c)
TIMBER_Z = material('plankZ', 'tearoom timber', 0x3e2a1c)
SLATE = material('roof', 'tearoom slate', 0x46505c)
RIDGE_SLATE = material('roof', 'tearoom ridge', 0x363d47)
CHIMNEY = material('stone', 'tearoom chimney', 0x8a8276)
POT = material('plain', 'tearoom chimney pot', 0xa35b3c)
SOOT = material('plain', 'tearoom soot', 0x1f1b18)
SAGE = material('plank', 'tearoom sage paint', 0x86a27f)
SAGE_Z = material('plankZ', 'tearoom sage paint', 0x86a27f)
SAGE_DARK = material('plank', 'tearoom sage door', 0x5e7c5c)
SAGE_FLAT = material('plain', 'tearoom sage frame', 0x86a27f)
GOLD = material('plain', 'tearoom gold', 0xd8ab44)
GLASS = material('plain', 'tearoom window', 0x2b3136)
GLOW = material('plain', 'tearoom lit window', 0xffd88a, emissive=True)
LEAD = material('plain', 'tearoom leading', 0x2a2b2f)
CHINA = material('plain', 'tearoom china', 0xf7f2e7)
IRON = material('plain', 'tearoom iron', 0x2e2f33)
CAFE = material('plain', 'tearoom white iron', 0xf2f0ea)
LEAVES = material('plain', 'tearoom leaves', 0x5b8b3b)
FLOWERS = [material('plain', f'tearoom flower {n}', c)
           for n, c in (('pink', 0xec7fa0), ('red', 0xd9483e), ('yellow', 0xf4cb4b), ('white', 0xf7f3ea))]


class Part:
    def __init__(self, asset, name, origin=(0, 0, 0)):
        self.asset, self.name, self.origin = asset, f'{asset.name} {name}', Vector(origin)
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
        self.asset.objects.link(obj)
        return obj


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# A box's six faces by name, in the order hexa() lays them down, so a caller can leave out the
# ones that lie against a wall or inside another box.
FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
         'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}


def hexa(part, pts, mat, omit=()):
    """Eight corners in box order: (-,-,-) (+,-,-) (+,+,-) (-,+,-) then the same at +z."""
    part.add(pts, [f for k, f in FACES.items() if k not in omit], mat)


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, omit=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    hexa(part, [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
                for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))], mat, omit)


class Wall:
    """A wall's own frame: u along it (left to right seen from outside), v up, n out of it."""
    def __init__(self, origin, u, n):
        self.o, self.u, self.v, self.n = Vector(origin), Vector(u), Vector((0, 1, 0)), Vector(n)

    def at(self, u, v, d=0.0):
        return self.o + self.u * u + self.v * v + self.n * d

    def u_of(self, p):
        return (Vector(p) - self.o).dot(self.u)


def wpoly(part, wall, pts, d, mat):
    """A flat face on a wall, `d` out from it, its 2D outline counter-clockwise from outside."""
    part.add([wall.at(u, v, d) for u, v in pts], [list(range(len(pts)))], mat)


def wbox(part, wall, u0, u1, v0, v1, d0, d1, mat, omit=('back',)):
    """A box standing on a wall; the face against the wall is left out unless asked for."""
    hexa(part, [wall.at(u, v, d) for u, v, d in ((u0, v0, d0), (u1, v0, d0), (u1, v1, d0), (u0, v1, d0),
                                                 (u0, v0, d1), (u1, v0, d1), (u1, v1, d1), (u0, v1, d1))],
         mat, omit)


def wbar(part, wall, a, b, w, d0, d1, mat, ends=True):
    """A strip from a to b (wall coordinates), w wide: a brace, a glazing bar, a stroke of gold.
    A brace butts into the rails at both ends, so it can go without its end faces."""
    a, b = Vector((a[0], a[1])), Vector((b[0], b[1]))
    t = (b - a).normalized()
    s = Vector((-t.y, t.x)) * (w / 2)
    q = [a - s, b - s, b + s, a + s]
    if d1 - d0 < 1e-6:
        wpoly(part, wall, [(p.x, p.y) for p in q], d0, mat)
        return
    hexa(part, [wall.at(p.x, p.y, d) for d in (d0, d1) for p in q], mat,
         omit=('back',) if ends else ('back', 'left', 'right'))


def arch(cu, v0, spring, r, segs=6):
    """A round-topped outline: the two bottom corners, then the half circle from right to left."""
    return [(cu - r, v0), (cu + r, v0)] + [(cu + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs))
                                           for k in range(segs + 1)]


def half_disc(cu, spring, r, segs=6):
    return [(cu + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]


def tube(part, a, b, r1, r2, mat, sides=6, cap_a=None, cap_b=None, phase=0.0):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c, r: [c + (u * math.cos(2 * math.pi * i / sides + phase) + v * math.sin(2 * math.pi * i / sides + phase)) * r
                         for i in range(sides)]
    part.add(ring(a, r1) + ring(b, r2), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap_a:
        part.add(ring(a, r1), [list(range(sides))[::-1]], cap_a)
    if cap_b:
        part.add(ring(b, r2), [list(range(sides))], cap_b)


def rod(part, a, b, r, mat, sides=3):
    tube(part, a, b, r, r, mat, sides)


def cone(part, base, apex, r, mat, sides=5):
    base, apex = Vector(base), Vector(apex)
    d = (apex - base).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = [base + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    part.add(ring + [apex], [[i, (i + 1) % sides, sides] for i in range(sides)], mat)


def lathe(part, cx, cz, rings, mats, sides=8, bottom=None, top=None):
    """A turned shape round a vertical axis: rings of (y, r), one material per band between them."""
    pts = [(cx + math.cos(2 * math.pi * k / sides) * r, y, cz + math.sin(2 * math.pi * k / sides) * r)
           for y, r in rings for k in range(sides)]
    for j, mat in enumerate(mats):
        part.add(pts, [[j * sides + (i + 1) % sides, j * sides + i, (j + 1) * sides + i, (j + 1) * sides + (i + 1) % sides]
                       for i in range(sides)], mat)
    if bottom:
        part.add(pts[:sides], [list(range(sides))], bottom)
    if top:
        part.add(pts[-sides:], [list(range(sides))[::-1]], top)


def tet(part, c, s, mat, phase=0.0):
    """A flower: four triangles standing on their point, so what shows from above is a flat head
    of colour. The right way up they read as a row of little party hats."""
    c = Vector(c)
    head = [c + Vector((s * math.cos(phase + 2 * math.pi * k / 3), 0.3 * s, s * math.sin(phase + 2 * math.pi * k / 3)))
            for k in range(3)]
    part.add(head + [c - Vector((0, s, 0))], [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]], mat)


def strip(part, a, b, w, across, mat):
    """One quad from a to b, w wide along `across`: a chair leg of bent iron, seen from any side."""
    a, b, h = Vector(a), Vector(b), Vector(across).normalized() * (w / 2)
    part.add([a - h, b - h, b + h, a + h], [[0, 1, 2, 3]], mat)


def strap(part, x, curve, w, mat):
    """Flat strap iron bent on edge in the plane x = const: a band of quads along a (z, y) curve.
    Its flat faces look along the street, which is how a sign bracket is forged and seen; from
    straight ahead it is a line, which is all a real one is from there too."""
    pts = [Vector((0, y, z)) for z, y in curve]
    out = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = Vector((0, -t.z, t.y)) * (w / 2)
        out.append((p - n, p + n))
    verts = [Vector((x, 0, 0)) + q for pair in out for q in pair]
    part.add(verts, [[2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1] for i in range(len(pts) - 1)], mat)


ASSET = bpy.data.collections.new('civic_tearoom')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measurements ---------------------------------------------------------------------
# The ground floor is a touch narrower and shallower than the floor above it, which leans out
# over the pavement on a beam (a jetty): XG/ZG below, XU/ZU above. XR is the roof's reach.
XG, XU, XR = 1.37, 1.40, 1.46
ZB, ZG, ZU = -1.30, 0.93, 1.03
FOOT = 0.05
BEAM0, BEAM1 = 0.80, 0.88          # the jetty beam the upper floor stands on
GF = 0.84
EAVES, RIDGE = 1.64, 2.96
ZM, HALF = (ZU + ZB) / 2, (ZU - ZB) / 2
SLOPE = (RIDGE - EAVES) / HALF     # 1.13, so the main pitch is 48 degrees; the gable is 59
OV, T = 0.12, 0.05                 # the roof's overhang, and the slates' thickness
CX, CROSS = 0.58, 2.60             # the front gable's half width and the height of its ridge
CZ = ZU + 0.03                     # its face, a hair proud of the wall below it

FRONT_G = Wall((0, 0, ZG), (1, 0, 0), (0, 0, 1))
FRONT_U = Wall((0, 0, ZU), (1, 0, 0), (0, 0, 1))
GABLE = Wall((0, 0, CZ), (1, 0, 0), (0, 0, 1))
BACK = Wall((0, 0, ZB), (-1, 0, 0), (0, 0, -1))
SIDES_G = [Wall((XG, 0, 0), (0, 0, -1), (1, 0, 0)), Wall((-XG, 0, 0), (0, 0, 1), (-1, 0, 0))]
SIDES_U = [Wall((XU, 0, 0), (0, 0, -1), (1, 0, 0)), Wall((-XU, 0, 0), (0, 0, 1), (-1, 0, 0))]

# ---- the house ----------------------------------------------------------------------------
body = Part(ASSET, 'body')
box(body, (0, GF / 2, (ZB + ZG) / 2), (2 * XG, GF, ZG - ZB), STONE, omit=('bottom', 'top'))
box(body, (0, FOOT / 2, (ZB + ZG) / 2), (2 * XG + 0.04, FOOT, ZG - ZB + 0.04), FOOTING, omit=('bottom',))
box(body, (0, (GF + EAVES) / 2, (ZB + ZU) / 2), (2 * XU, EAVES - GF, ZU - ZB), PLASTER, omit=('bottom', 'top'))
# The jetty: a beam along the front and one down each side, closing the gap under the overhang.
# The front one is the shop's fascia, painted sage with a gold line along it, which is what ties
# the arched windows and the door together into one shopfront.
box(body, (0, (BEAM0 + BEAM1) / 2, (ZG + ZU + 0.012) / 2), (2 * XU + 0.02, BEAM1 - BEAM0, ZU + 0.012 - ZG), SAGE, omit=('back', 'top'))
wpoly(body, Wall((0, 0, ZU + 0.012), (1, 0, 0), (0, 0, 1)),
      [(-XU, 0.832), (XU, 0.832), (XU, 0.845), (-XU, 0.845)], 0.002, GOLD)
for s in (-1, 1):
    box(body, (s * (XG + XU + 0.012) / 2, (BEAM0 + BEAM1) / 2, (ZB + ZU) / 2),
        (XU + 0.012 - XG, BEAM1 - BEAM0, ZU - ZB), TIMBER_Z, omit=('top', 'left' if s > 0 else 'right'))
# The gable ends, the plaster triangles under the roof at either side.
for wall in SIDES_U:
    wpoly(body, wall, [(wall.u_of((0, 0, z)), y) for z, y in ((ZU, EAVES), (ZB, EAVES), (ZM, RIDGE))][::1 if wall.u.z < 0 else -1], 0, PLASTER)
# The front gable's triangle.
wpoly(body, GABLE, [(-CX, EAVES), (CX, EAVES), (0, CROSS)], 0, PLASTER)
body.build()

# ---- the roof -----------------------------------------------------------------------------
roof = Part(ASSET, 'roof')


def main_slab(xa, xb, front, overhang=True, omit=()):
    """One pitch between ridge and eave, bottom face on the line from the ridge to the wall top.
    The face along the ridge is never drawn: it lies against the other pitch, under the cap."""
    ov = OV if overhang else 0.0
    ze = (ZU + ov) if front else (ZB - ov)
    ye = EAVES - SLOPE * ov
    if not front:
        xa, xb = xb, xa            # keep the corners right-handed, so the faces face out
    pts = []
    for z, y in ((ZM, RIDGE), (ze, ye)):
        pts += [(xa, y, z), (xb, y, z), (xb, y + T, z), (xa, y + T, z)]
    hexa(roof, pts, SLATE, omit=('back',) + tuple(omit))


# The front pitch is cut in three round the front gable: its middle stops at the wall, where
# the gable's own roof takes over, or its overhang would run across the gable's foot.
main_slab(-XR, -CX, True)
main_slab(-CX, CX, True, overhang=False, omit=('left', 'right'))
main_slab(CX, XR, True)
main_slab(-XR, XR, False)
box(roof, (0, RIDGE + T + 0.012, ZM), (2 * XR + 0.02, 0.055, 0.09), RIDGE_SLATE, omit=('bottom',))
# The front gable's roof: two pitches from its ridge down to the main eave line, running back
# until they are lost inside the main roof.
GZF, GZB = ZU + OV + 0.01, 0.10
for s in (-1, 1):
    zs = (GZB, GZF) if s > 0 else (GZF, GZB)
    pts = []
    for z in zs:
        pts += [(0, CROSS, z), (s * CX, EAVES, z), (s * CX, EAVES + T, z), (0, CROSS + T, z)]
    # Left out: the face along its ridge (against the other pitch) and its far end, buried in
    # the main roof.
    hexa(roof, pts, SLATE, omit=('left', 'back' if s > 0 else 'front'))
GZR = ZU - (CROSS - EAVES) / SLOPE     # where the gable's ridge meets the main roof
box(roof, (0, CROSS + T + 0.01, (GZR + GZF) / 2), (0.08, 0.05, GZF - GZR), RIDGE_SLATE, omit=('bottom',))
# The chimney: on the ridge near the left gable, leaning a little the way old ones do.
CHX, CHZ, CHY0, CHY1, LEAN = -0.92, ZM - 0.02, 2.45, 3.30, 0.05
cm = rotation(rx=-0.03, rz=LEAN)
ch_c = Vector((CHX, (CHY0 + CHY1) / 2, CHZ))
box(roof, ch_c, (0.24, CHY1 - CHY0, 0.26), CHIMNEY, rx=-0.03, rz=LEAN, omit=('bottom',))
ch_top = ch_c + cm @ Vector((0, (CHY1 - CHY0) / 2, 0))
box(roof, ch_top + Vector((0, 0.02, 0)), (0.31, 0.05, 0.33), CHIMNEY, rx=-0.04, rz=LEAN + 0.03, omit=('bottom',))
pot0 = ch_top + Vector((0.03, 0.04, 0.0))
pot1 = pot0 + Vector((-0.008, 0.11, 0))
tube(roof, pot0, pot1, 0.055, 0.045, POT, sides=6, cap_b=SOOT)
roof.build()

# ---- the timber frame ---------------------------------------------------------------------
frame = Part(ASSET, 'timber')
for x in (-XU + 0.03, XU - 0.03):
    for z in (ZU - 0.03, ZB + 0.03):
        box(frame, (x, (BEAM1 + EAVES) / 2, z), (0.07, EAVES - BEAM1, 0.07), TIMBER, omit=('bottom', 'top'))
# The front of the upper floor: posts at the gable's corners, a sill rail under the windows, a
# top plate under the eaves, and a steep brace in every narrow panel beside a window.
wbox(frame, FRONT_U, -XU - 0.005, XU + 0.005, 1.58, EAVES, 0, 0.026, TIMBER)
wbox(frame, FRONT_U, -XU, XU, 0.97, 1.02, 0, 0.02, TIMBER, omit=('back', 'left', 'right'))
for x in (-CX, CX):
    wbox(frame, FRONT_U, x - 0.025, x + 0.025, BEAM1, 1.58, 0, 0.024, TIMBER, omit=('back', 'top', 'bottom'))
UPPER = [-0.99, 0.0, 0.99]         # the three windows upstairs
WIN_W = 0.20
for x0, x1 in ((-XU + 0.065, UPPER[0] - WIN_W), (UPPER[0] + WIN_W, -CX - 0.025), (-CX + 0.025, -WIN_W)):
    for a, b in (((x0 + 0.02, 1.02), (x1 - 0.02, 1.58)), ((-x0 - 0.02, 1.02), (-x1 + 0.02, 1.58))):
        wbar(frame, FRONT_U, a, b, 0.045, 0, 0.018, TIMBER, ends=False)
# The sides: a post in the middle, a sill rail and a top plate, and one brace in the long back
# panel, so a corner lot shows a framed gable and not a blank one.
for wall in SIDES_U:
    um = wall.u_of((0, 0, ZM))
    u_front, u_back = wall.u_of((0, 0, ZU)), wall.u_of((0, 0, ZB))
    lo, hi = min(u_front, u_back), max(u_front, u_back)
    wbox(frame, wall, um - 0.025, um + 0.025, BEAM1, 1.58, 0, 0.024, TIMBER_Z, omit=('back', 'top', 'bottom'))
    wbox(frame, wall, lo, hi, 1.58, EAVES, 0, 0.026, TIMBER_Z)
    wbox(frame, wall, lo, hi, 0.97, 1.02, 0, 0.02, TIMBER_Z, omit=('back', 'left', 'right'))
    ub = wall.u_of((0, 0, ZB + 0.08))
    wbar(frame, wall, (ub, 1.02), (um + (0.05 if ub < um else -0.05), 1.58), 0.045, 0, 0.018, TIMBER_Z, ends=False)
    # The gable above: a king post up the middle and a collar across it.
    wbox(frame, wall, um - 0.022, um + 0.022, EAVES, RIDGE - 0.03, 0, 0.02, TIMBER_Z, omit=('back', 'bottom'))
    half = HALF * (RIDGE - 2.2) / (RIDGE - EAVES) - 0.03
    wbox(frame, wall, um - half, um + half, 2.17, 2.22, 0, 0.02, TIMBER_Z)
# The back: its top plate, enough that the eaves line runs all the way round.
wbox(frame, BACK, -XU - 0.005, XU + 0.005, 1.58, EAVES, 0, 0.026, TIMBER)
# The front gable: dark barge boards tucked under the front edge of its roof, a collar and a
# short king post. On the gable's face instead, a board stuck out past the slates at its foot
# and read from three-quarters as a stick poking out of the roof.
BW = 0.055
for s in (-1, 1):
    # Half a board's width in from the roof's edge, so its top edge lies along the slates.
    down = Vector((-s * (CROSS - EAVES), -CX)).normalized() * (BW / 2)
    a, b = Vector((s * CX, EAVES)) + down, Vector((0, CROSS)) + down
    wbar(frame, GABLE, (a.x, a.y), (b.x, b.y), BW, GZF - CZ - 0.04, GZF - CZ - 0.005, TIMBER)
cy0, cy1 = 2.10, 2.15
chalf = CX * (CROSS - cy1) / (CROSS - EAVES)
wbox(frame, GABLE, -chalf, chalf, cy0, cy1, 0, 0.02, TIMBER)
wbox(frame, GABLE, -0.022, 0.022, cy1, CROSS - 0.04, 0, 0.02, TIMBER, omit=('back', 'bottom'))
frame.build()

# ---- the shopfront ------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
SILL, SPRING = 0.155, 0.49
PR, GR, LR = 0.135, 0.105, 0.085   # the frame's, the glass's and the glow's half width


def light(part, wall, cu):
    """One round-topped window: sage frame, dark glass, the lit middle, and its leading."""
    wpoly(part, wall, arch(cu, SILL, SPRING, PR), 0.004, SAGE_FLAT)
    wpoly(part, wall, arch(cu, SILL + 0.025, SPRING, GR), 0.008, GLASS)
    wpoly(part, wall, arch(cu, SILL + 0.045, SPRING, LR), 0.012, GLOW)
    wbar(part, wall, (cu, SILL + 0.025), (cu, SPRING + GR), 0.012, 0.016, 0.016, LEAD)
    wbar(part, wall, (cu - GR, SPRING), (cu + GR, SPRING), 0.012, 0.016, 0.016, LEAD)


FRONT_LIGHTS = [0.48, 0.80, 1.12]
for s in (-1, 1):
    for x in FRONT_LIGHTS:
        light(shop, FRONT_G, s * x)
    wbox(shop, FRONT_G, *sorted((s * 0.32, s * 1.28)), SILL - 0.04, SILL, 0, 0.05, SAGE, omit=('back', 'bottom'))
# Round each corner: two more on each side wall, close to the front.
for wall in SIDES_G:
    us = [wall.u_of((0, 0, z)) for z in (0.62, 0.30)]
    for u in us:
        light(shop, wall, u)
    wbox(shop, wall, min(us) - 0.16, max(us) + 0.16, SILL - 0.04, SILL, 0, 0.05, SAGE_Z, omit=('back', 'bottom'))
# The door: sage, under an arched fanlight, in a sage frame that stands out from the stone.
DR, DRO, DSP, DB = 0.15, 0.195, 0.42, FOOT
wbox(shop, FRONT_G, -DR, DR, DB, DSP, 0, 0.015, SAGE_DARK)
wpoly(shop, FRONT_G, half_disc(0, DSP, DR), 0.006, GLASS)
wpoly(shop, FRONT_G, half_disc(0, DSP, DR - 0.03), 0.010, GLOW)
for t in (math.pi / 3, 2 * math.pi / 3):
    wbar(shop, FRONT_G, (0, DSP), (DR * math.cos(t), DSP + DR * math.sin(t)), 0.012, 0.013, 0.013, LEAD)
wbox(shop, FRONT_G, -DR, DR, DSP - 0.015, DSP + 0.015, 0, 0.025, SAGE)
for u0, u1 in ((-DR + 0.03, -0.01), (0.01, DR - 0.03)):
    wpoly(shop, FRONT_G, [(u0, 0.10), (u1, 0.10), (u1, 0.36), (u0, 0.36)], 0.018, SAGE)
inner = [(-DR, DB)] + [(DR * math.cos(math.pi - math.pi * k / 6), DSP + DR * math.sin(math.pi - math.pi * k / 6)) for k in range(7)] + [(DR, DB)]
outer = [(-DRO, DB)] + [(DRO * math.cos(math.pi - math.pi * k / 6), DSP + DRO * math.sin(math.pi - math.pi * k / 6)) for k in range(7)] + [(DRO, DB)]
DF = 0.03
ring = []
for k in range(len(inner) - 1):
    ring.append([inner[k], inner[k + 1], outer[k + 1], outer[k]])
for q in ring:
    wpoly(shop, FRONT_G, q, DF, SAGE_FLAT)
for k in range(len(outer) - 1):
    a, b = outer[k], outer[k + 1]
    shop.add([FRONT_G.at(a[0], a[1], 0), FRONT_G.at(b[0], b[1], 0), FRONT_G.at(b[0], b[1], DF), FRONT_G.at(a[0], a[1], DF)],
             [[0, 1, 2, 3]], SAGE_FLAT)
cone(shop, FRONT_G.at(0.105, 0.24, 0.015), FRONT_G.at(0.105, 0.24, 0.04), 0.016, GOLD, sides=4)
# No doorstep: a shop is walked round part by part (APART in buildings.js), so a step would be a
# solid of its own right where anchor.door is, and the porch the island sets every shop on is
# the step already.
# The sign over the door: a sage board edged in gold, and a gold teacup on its saucer with a
# curl of steam - the picture a lettered board would otherwise need words for. It is fixed to
# the front of the fascia and hangs below it: on the wall behind, the jetty hid it from anyone
# looking down on the square, which on the island is everyone.
FASCIA = Wall((0, 0, ZU + 0.012), (1, 0, 0), (0, 0, 1))
SB, CY = (0.655, 0.855), 0.745     # the board's bottom and top, and the cup's middle
wbox(shop, FASCIA, -0.19, 0.19, SB[0], SB[1], 0.002, 0.022, SAGE, omit=())
for (a, b) in (((-0.172, SB[1] - 0.014), (0.172, SB[1] - 0.014)), ((-0.172, SB[0] + 0.014), (0.172, SB[0] + 0.014)),
               ((-0.172, SB[0] + 0.014), (-0.172, SB[1] - 0.014)), ((0.172, SB[0] + 0.014), (0.172, SB[1] - 0.014))):
    wbar(shop, FASCIA, a, b, 0.012, 0.024, 0.024, GOLD)
wpoly(shop, FASCIA, [(-0.035, CY - 0.03), (0.035, CY - 0.03), (0.052, CY + 0.03), (-0.052, CY + 0.03)], 0.026, GOLD)
wpoly(shop, FASCIA, [(-0.08, CY - 0.043), (0.08, CY - 0.043), (0.068, CY - 0.031), (-0.068, CY - 0.031)], 0.026, GOLD)
hc = (0.054, CY + 0.004)
for k in range(3):
    t0, t1 = -math.pi / 2 + math.pi * k / 3, -math.pi / 2 + math.pi * (k + 1) / 3
    pa = [(hc[0] + r * math.cos(t), hc[1] + r * math.sin(t)) for r, t in ((0.013, t0), (0.013, t1))]
    pb = [(hc[0] + r * math.cos(t), hc[1] + r * math.sin(t)) for r, t in ((0.025, t1), (0.025, t0))]
    wpoly(shop, FASCIA, pa + pb, 0.026, GOLD)
for dx in (-0.018, 0.018):
    wbar(shop, FASCIA, (dx, CY + 0.038), (dx + 0.013, CY + 0.056), 0.009, 0.026, 0.026, GOLD)
    wbar(shop, FASCIA, (dx + 0.013, CY + 0.056), (dx, CY + 0.074), 0.009, 0.026, 0.026, GOLD)
shop.build()

# ---- upstairs -----------------------------------------------------------------------------
up = Part(ASSET, 'upstairs')


def window(part, wall, cu, v0=1.04, v1=1.50, w=WIN_W):
    """A casement: a dark frame, the pane, its lit middle, and a mullion and transom over it."""
    wbox(part, wall, cu - w, cu + w, v0, v1, 0, 0.03, TIMBER, omit=('back', 'bottom'))
    wpoly(part, wall, [(cu - w + 0.035, v0 + 0.035), (cu + w - 0.035, v0 + 0.035), (cu + w - 0.035, v1 - 0.035), (cu - w + 0.035, v1 - 0.035)], 0.034, GLASS)
    wpoly(part, wall, [(cu - w + 0.07, v0 + 0.07), (cu + w - 0.07, v0 + 0.07), (cu + w - 0.07, v1 - 0.07), (cu - w + 0.07, v1 - 0.07)], 0.038, GLOW)
    wbar(part, wall, (cu, v0 + 0.035), (cu, v1 - 0.035), 0.022, 0.042, 0.042, TIMBER)
    wbar(part, wall, (cu - w + 0.035, v0 + 0.3), (cu + w - 0.035, v0 + 0.3), 0.02, 0.042, 0.042, TIMBER)


def flower_box(part, wall, cu, k0):
    wbox(part, wall, cu - 0.21, cu + 0.21, 0.93, 1.01, 0, 0.09, SAGE)
    wbox(part, wall, cu - 0.19, cu + 0.19, 1.01, 1.045, 0.015, 0.08, LEAVES, omit=('back', 'bottom'))
    for k, du in enumerate((-0.12, 0.0, 0.12)):
        tet(part, wall.at(cu + du, 1.052, 0.045 + 0.012 * ((k + k0) % 2)), 0.036, FLOWERS[(k + k0) % 4], phase=0.7 * k)


for k, x in enumerate(UPPER):
    window(up, FRONT_U, x)
    flower_box(up, FRONT_U, x, k)
for wall in SIDES_U:
    window(up, wall, wall.u_of((0, 0, 0.45)))
window(up, BACK, BACK.u_of((0.62, 0, 0)))
# The attic light in the front gable: a small arch, under the collar.
wpoly(up, GABLE, arch(0, 1.74, 1.90, 0.12), 0.004, TIMBER)
wpoly(up, GABLE, arch(0, 1.765, 1.90, 0.095), 0.008, GLASS)
wpoly(up, GABLE, arch(0, 1.79, 1.90, 0.07), 0.012, GLOW)
wbar(up, GABLE, (0, 1.765), (0, 1.995), 0.014, 0.016, 0.016, TIMBER)
up.build()

# ---- the teapot on its bracket ------------------------------------------------------------
tea = Part(ASSET, 'teapot')
# The pot's axis, the height of its foot and its scale: a sign is bigger than the thing it
# means, and at 1.4 it is still clear of anybody walking under it (WALK_CLEARANCE is 0.55).
TX, TZ, TB, K = 0.43, 1.29, 0.62, 1.4
ARM_Y, ARM_Z1 = 0.862, 1.42
rod(tea, (TX, ARM_Y, ZU + 0.012), (TX, ARM_Y, ARM_Z1), 0.011, IRON, sides=4)
# The ironwork that holds the arm up, as strap: a quarter round from the wall out to the arm, a
# scroll curled up inside it, and a curl at the arm's tip.
Z0 = ZU + 0.004
quarter = [(Z0 + 0.25 * math.sin(math.pi / 2 * k / 5), ARM_Y + 0.25 * math.cos(math.pi / 2 * k / 5)) for k in range(6)]
strap(tea, TX, quarter, 0.016, IRON)
scroll = [(Z0 + 0.105 + (0.07 - 0.009 * k) * math.cos(math.radians(-90 + 62 * k)),
           ARM_Y + 0.08 + (0.07 - 0.009 * k) * math.sin(math.radians(-90 + 62 * k))) for k in range(7)]
strap(tea, TX, scroll, 0.013, IRON)
tip = [(ARM_Z1 - 0.025 + (0.045 - 0.007 * k) * math.cos(math.radians(-55 + 68 * k)),
        ARM_Y + 0.037 + (0.045 - 0.007 * k) * math.sin(math.radians(-55 + 68 * k))) for k in range(6)]
strap(tea, TX, tip, 0.012, IRON)
P = lambda dx, dy: (TX + dx * K, TB + dy * K, TZ)
rings = [(TB + y * K, r * K) for y, r in ((0, 0.052), (0.028, 0.083), (0.058, 0.092), (0.074, 0.092), (0.104, 0.07), (0.12, 0.038))]
lathe(tea, TX, TZ, rings, [CHINA, CHINA, GOLD, CHINA, CHINA], sides=8, bottom=CHINA, top=CHINA)
cone(tea, P(0, 0.12), P(0, 0.148), 0.022 * K, GOLD)
rod(tea, P(0, 0.148), (TX, ARM_Y, TZ), 0.005, IRON)
tube(tea, P(0.07, 0.036), P(0.172, 0.126), 0.024 * K, 0.011 * K, CHINA, sides=5)
handle = [P(-0.078, 0.1), P(-0.138, 0.098), P(-0.142, 0.042), P(-0.082, 0.028)]
for a, b in zip(handle, handle[1:]):
    rod(tea, a, b, 0.013 * K, CHINA, sides=4)
tea.build()

# ---- the café tables ----------------------------------------------------------------------
# One part per table, and that is load-bearing: the island walks round a shop by the rectangle
# of each baked part, and one part holding both tables was one rectangle from table to table,
# straight across the doorway.
TABLE_Z, TERRACE = 1.27, []
for side, tx in (('left', -0.80), ('right', 0.80)):
    cafe = Part(ASSET, f'terrace {side}')
    tube(cafe, (tx, 0.185, TABLE_Z), (tx, 0.2, TABLE_Z), 0.1, 0.1, CAFE, sides=6, cap_b=CAFE)
    rod(cafe, (tx, 0.02, TABLE_Z), (tx, 0.185, TABLE_Z), 0.012, CAFE)
    tube(cafe, (tx, 0.0, TABLE_Z), (tx, 0.03, TABLE_Z), 0.055, 0.014, CAFE, sides=4)
    # The chairs are bent iron, and drawn as it: a seat, a back and four legs that are one quad
    # each, the legs turned corner-wise. Each chair is swung a little towards the wall, so it
    # looks out over its table at the street - and so its back is not edge-on from the front,
    # where a flat back would vanish and leave four legs.
    for a in (math.radians(-25), math.radians(205)):
        o, p = Vector((math.cos(a), 0, math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))
        c, SEAT = Vector((tx, 0, TABLE_Z)) + o * 0.19, 0.12
        at = lambda do, dp, y=SEAT: c + o * do + p * dp + Vector((0, y, 0))
        ring = lambda r, y, degs: [at(r * math.cos(math.radians(g)), r * math.sin(math.radians(g)), y) for g in degs]
        cafe.add(ring(0.062, SEAT, range(0, 360, 60))[::-1], [list(range(6))], CAFE)
        # A bistro chair's back is a hoop round the seat's far side: three quads, so there is
        # no side from which it is edge-on and gone.
        hoop = (-72, -24, 24, 72)
        cafe.add(ring(0.06, SEAT, hoop) + ring(0.074, SEAT + 0.13, hoop), [[k, k + 1, 5 + k, 4 + k] for k in range(3)], CAFE)
        for do in (-0.05, 0.05):
            for dp in (-0.05, 0.05):
                leg = o * do + p * dp
                strip(cafe, at(do * 1.12, dp * 1.12, 0.0), at(do, dp), 0.014, (-leg.z, 0, leg.x), CAFE)
    cafe.build()
    TERRACE.append(cafe)

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(pot1 + Vector((0, 0.04, 0)))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZG + 0.12))
ASSET.objects.link(door)

# The tallest thing is the chimney pot, and the scene says so rather than a guess at it.
top = max(v.y for p in (body, roof, frame, shop, up, tea, *TERRACE) for v in p.verts)
bpy.context.scene['building_height'] = round(top, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'tearoom.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'tearoom'})
