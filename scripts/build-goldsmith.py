"""The goldsmith. Rebuild with scripts/blender.mjs --background --python scripts/build-goldsmith.py.

Plans/goudmijn.md: when the keeper's five-hour window turns over, a cart of ore comes down the
road from the gold mine, the goldsmith melts it and casts it, and wheels the bars to the gold
pit. So this is a small workshop by the pit: a narrow house with its gable to the street, a
lit shop window and a hanging sign with a gold ring on it, and against its right wall a lean-to
over the work - a brick melting furnace with its own chimney, a casting bench with an ingot
mould on it, and a bin where the miner tips the ore.

One civic asset, under the civic budget of 1500, with the smithy's two kinds of special part
(build-smithy.py):

    civic_goldsmith glow    the fire in the furnace's mouth, which web/js/goldsmith.js takes
                            out of the merge and brightens while a load is melting - its origin
                            is the middle of the mouth, where the embers come out
    civic_goldsmith bench   the casting bench, still but measured: its origin is the middle of
                            its top, which is where the goldsmith works and where the bars are
                            cast

and `anchor.door`, where he goes in at night. There is no figure in the bake, for the smithy's
reason: a figure is the player's rig, dressed by goldsmith.js.

Everything below PORCH_UPTO stands on the island's own porch (buildings.js), so the bench and
the bins are modelled on y = 0 like the house.

Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/goldsmith'
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


PLASTER = material('wall', 'goldsmith plaster', 0xeee2c6)
TIMBER = material('plank', 'goldsmith timber', 0x5b3a24)
TIMBER_Z = material('plankZ', 'goldsmith timber', 0x5b3a24)
TILES = material('roof', 'goldsmith tiles', 0xb0603c)
BOARDS = material('plank', 'goldsmith lean-to', 0x7a5638)
STONE = material('stone', 'goldsmith plinth', 0x8f8a80)
BRICK = material('stone', 'goldsmith furnace', 0x9c5944)
DOOR = material('plank', 'goldsmith door', 0x2f4d3c)
SHOPGLASS = material('plain', 'goldsmith window', 0xf4d58c, emissive=True)
IRON = material('plain', 'goldsmith iron', 0x303236)
MOUTH = material('plain', 'goldsmith mouth', 0x1a1210)
FIRE = material('plain', 'goldsmith fire', 0xff8a2e, emissive=True)
GOLD = material('plain', 'goldsmith gold', 0xf2c14a)
SIGN = material('plank', 'goldsmith sign', 0x2f4d3c)
BENCH = material('plank', 'goldsmith bench', 0x8a6040)
ORE_ROCK = material('plain', 'goldsmith ore', 0x7d7163)
WATER = material('plain', 'goldsmith water', 0x3c5a6e)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

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


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def cylinder(part, a, b, r, mat, sides=6, cap=None):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(t) + v * math.sin(t)) * r for t in (2 * math.pi * i / sides for i in range(sides))]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap is not None:
        part.add(ring(b), [list(range(sides))], cap)


def torus(part, centre, R, r, mat, major=8, minor=4):
    """A ring standing up in the x-y plane - the goldsmith's sign."""
    c = Vector(centre)
    pts = []
    for i in range(major):
        a = 2 * math.pi * i / major
        ring_c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        for j in range(minor):
            b = 2 * math.pi * j / minor + math.pi / 4
            pts.append(c + ring_c + out * (math.cos(b) * r) + Vector((0, 0, math.sin(b) * r)))
    faces = [[i * minor + j, i * minor + (j + 1) % minor, ((i + 1) % major) * minor + (j + 1) % minor, ((i + 1) % major) * minor + j]
             for i in range(major) for j in range(minor)]
    part.add(pts, faces, mat)


def hash01(i, k=0):
    n = (i * 374761393 + k * 668265263) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffff) / 0xffffff


def lump(part, centre, r, mat, seed):
    c = Vector(centre)
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    pts = [c + Vector(d) * r * (0.72 + 0.5 * hash01(seed, n)) for n, d in enumerate(dirs)]
    for f in [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]:
        part.add([pts[i] for i in f], [[0, 1, 2]], mat if f[0] != 4 else GOLD)


SMITH = collection('civic_goldsmith')

# ---- the house ------------------------------------------------------------------------
# Its gable to the street, as a shop in a town street stands, and the ridge running back.
X0, X1, Z0, Z1 = -1.02, -0.02, -0.72, 0.3
EAVES, RIDGE = 0.62, 1.1
MIDX = (X0 + X1) / 2
T = 0.04

walls = Part(SMITH, 'walls')
box(walls, (MIDX, 0.04, (Z0 + Z1) / 2), (X1 - X0 + 0.06, 0.08, Z1 - Z0 + 0.06), STONE)
for z in (Z0 + T / 2, Z1 - T / 2):
    box(walls, (MIDX, (0.08 + EAVES) / 2, z), (X1 - X0, EAVES - 0.08, T), PLASTER)
    # the gable, front and back
    walls.add([(X0, EAVES, z - T / 2), (X1, EAVES, z - T / 2), (MIDX, RIDGE, z - T / 2),
               (X0, EAVES, z + T / 2), (X1, EAVES, z + T / 2), (MIDX, RIDGE, z + T / 2)],
              [[0, 2, 1], [3, 4, 5]], PLASTER)
for x in (X0 + T / 2, X1 - T / 2):
    box(walls, (x, (0.08 + EAVES) / 2, (Z0 + Z1) / 2), (T, EAVES - 0.08, Z1 - Z0), PLASTER)
walls.build()

frame = Part(SMITH, 'frame')
# Dark timbers: the corners, a rail at the eaves, the gable's two rafters and a king post.
for x in (X0, X1):
    for z in (Z0, Z1):
        box(frame, (x, (0.08 + EAVES) / 2, z), (0.05, EAVES - 0.08, 0.05), TIMBER)
for z in (Z0 - 0.012, Z1 + 0.012):
    box(frame, (MIDX, EAVES - 0.02, z), (X1 - X0 + 0.06, 0.04, 0.03), TIMBER)
    box(frame, (MIDX, 0.1, z), (X1 - X0, 0.03, 0.03), TIMBER)
half = (X1 - X0) / 2
pitch = math.atan2(RIDGE - EAVES, half)
for sx in (-1, 1):
    box(frame, (MIDX + sx * half / 2, (EAVES + RIDGE) / 2, Z1 + 0.014), (math.hypot(half, RIDGE - EAVES), 0.035, 0.03), TIMBER, rz=-sx * pitch)
box(frame, (MIDX, (EAVES + RIDGE) / 2 - 0.02, Z1 + 0.014), (0.03, RIDGE - EAVES - 0.04, 0.03), TIMBER)
for x in (X0, X1):
    box(frame, (x + (-0.012 if x == X0 else 0.012), EAVES - 0.02, (Z0 + Z1) / 2), (0.03, 0.04, Z1 - Z0), TIMBER_Z)
frame.build()

roof = Part(SMITH, 'roof')
# Two pitches of tiles down to the eaves on either side, overhanging the gables front and back.
OVER, TH = 0.08, 0.035
run = math.hypot(half + OVER, (RIDGE - EAVES) * (half + OVER) / half)
for sx in (-1, 1):
    cx = MIDX + sx * (half + OVER) / 2
    cy = RIDGE - (RIDGE - EAVES) * ((half + OVER) / 2) / half + TH / 2
    box(roof, (cx, cy, (Z0 + Z1) / 2), (run, TH, Z1 - Z0 + 2 * OVER + 0.04), TILES, rz=-sx * pitch)
box(roof, (MIDX, RIDGE + TH, (Z0 + Z1) / 2), (0.05, 0.04, Z1 - Z0 + 2 * OVER + 0.06), TILES)
roof.build()

front = Part(SMITH, 'front')
# The door on the right of the front, the shop window on the left, a round window in the gable.
DOOR_X, DOOR_W, DOOR_H = -0.24, 0.2, 0.42
box(front, (DOOR_X, 0.08 + DOOR_H / 2, Z1 + 0.012), (DOOR_W, DOOR_H, 0.02), DOOR)
box(front, (DOOR_X, 0.08 + DOOR_H + 0.02, Z1 + 0.016), (DOOR_W + 0.06, 0.035, 0.03), TIMBER)
for x in (DOOR_X - DOOR_W / 2 - 0.015, DOOR_X + DOOR_W / 2 + 0.015):
    box(front, (x, 0.08 + DOOR_H / 2, Z1 + 0.016), (0.03, DOOR_H, 0.03), TIMBER)
box(front, (DOOR_X + 0.06, 0.08 + DOOR_H * 0.5, Z1 + 0.026), (0.02, 0.03, 0.012), GOLD)
WIN_X, WIN_W, WIN_H, SILL = -0.68, 0.36, 0.26, 0.2
box(front, (WIN_X, SILL + WIN_H / 2, Z1 + 0.006), (WIN_W, WIN_H, 0.012), SHOPGLASS)
box(front, (WIN_X, SILL - 0.015, Z1 + 0.03), (WIN_W + 0.08, 0.03, 0.06), TIMBER)
box(front, (WIN_X, SILL + WIN_H + 0.015, Z1 + 0.02), (WIN_W + 0.06, 0.03, 0.04), TIMBER)
for x in (WIN_X - WIN_W / 2, WIN_X, WIN_X + WIN_W / 2):
    box(front, (x, SILL + WIN_H / 2, Z1 + 0.018), (0.022, WIN_H, 0.022), TIMBER)
box(front, (WIN_X, SILL + WIN_H / 2, Z1 + 0.018), (WIN_W, 0.018, 0.02), TIMBER)
# A small window high in the gable, lit at night like the shop.
box(front, (MIDX, EAVES + 0.17, Z1 + 0.006), (0.12, 0.12, 0.012), SHOPGLASS, rz=math.pi / 4)
box(front, (MIDX, EAVES + 0.17, Z1 + 0.014), (0.02, 0.16, 0.012), TIMBER, rz=math.pi / 4)
box(front, (MIDX, EAVES + 0.17, Z1 + 0.014), (0.16, 0.02, 0.012), TIMBER, rz=math.pi / 4)
# The sign: an iron bracket off the front corner, a green board hanging from it and on the
# board a gold ring, which is what a goldsmith has hung over his door for as long as there
# have been doors.
box(front, (X1 + 0.14, EAVES - 0.07, Z1 + 0.03), (0.28, 0.02, 0.02), IRON)
box(front, (X1 + 0.07, EAVES - 0.14, Z1 + 0.03), (0.16, 0.016, 0.016), IRON, rz=0.8)
for x in (X1 + 0.14, X1 + 0.24):
    box(front, (x, EAVES - 0.1, Z1 + 0.03), (0.006, 0.05, 0.006), IRON)
box(front, (X1 + 0.19, EAVES - 0.21, Z1 + 0.03), (0.18, 0.17, 0.02), SIGN)
torus(front, (X1 + 0.19, EAVES - 0.21, Z1 + 0.05), 0.05, 0.012, GOLD)
front.build()

# ---- the lean-to, the furnace and the bench ---------------------------------------------
# The lean-to covers the bench and no more. Over the furnace too, it was a lid: from the front
# and from the right the first bake showed a brown roof and nothing of the fire under it, which
# is the one thing that says what this building does. So the furnace and the ore bin stand out
# behind it in the open, the chimney clear of every roof.
LX0, LX1, LZ0, LZ1 = X1, 1.3, -0.34, 0.4
LEAN_HI, LEAN_LO = EAVES + 0.02, 0.54
yard = Part(SMITH, 'yard')
for z in (LZ0 + 0.03, LZ1 - 0.03):
    box(yard, (LX1 - 0.03, LEAN_LO / 2, z), (0.05, LEAN_LO, 0.05), TIMBER)
box(yard, (LX1 - 0.03, LEAN_LO - 0.02, (LZ0 + LZ1) / 2), (0.05, 0.05, LZ1 - LZ0), TIMBER_Z)
slope = math.atan2(LEAN_HI - LEAN_LO, LX1 - LX0)
box(yard, ((LX0 + LX1) / 2 + 0.03, (LEAN_HI + LEAN_LO) / 2 + 0.03, (LZ0 + LZ1) / 2),
    (math.hypot(LX1 - LX0 + 0.08, LEAN_HI - LEAN_LO), 0.03, LZ1 - LZ0 + 0.1), BOARDS, rz=-slope)

# The furnace against the house wall, at the back: a brick block with a chimney of its own
# going up through the lean-to, and its mouth towards the bench.
FX0, FX1, FZ0, FZ1, FH = 0.08, 0.62, -0.9, -0.4, 0.42
FMX = (FX0 + FX1) / 2
box(yard, (FMX, FH / 2, (FZ0 + FZ1) / 2), (FX1 - FX0, FH, FZ1 - FZ0), BRICK)
box(yard, (FMX, FH + 0.02, (FZ0 + FZ1) / 2), (FX1 - FX0 + 0.05, 0.04, FZ1 - FZ0 + 0.05), STONE)
box(yard, (FMX, (FH + 1.34) / 2, FZ0 + 0.15), (0.2, 1.34 - FH, 0.2), BRICK)
box(yard, (FMX, 1.36, FZ0 + 0.15), (0.26, 0.05, 0.26), STONE)
MOUTH_AT = (FMX, 0.2, FZ1 + 0.005)
box(yard, (FMX, MOUTH_AT[1], FZ1 - 0.02), (0.2, 0.15, 0.05), MOUTH)
box(yard, (FMX, MOUTH_AT[1] + 0.1, FZ1 + 0.01), (0.26, 0.04, 0.03), STONE)
# A crucible on the furnace's top, and the tongs hanging off its side.
cylinder(yard, (FMX - 0.12, FH + 0.04, FZ1 - 0.12), (FMX - 0.12, FH + 0.12, FZ1 - 0.12), 0.05, IRON, sides=6, cap=GOLD)
box(yard, (FX1 + 0.012, 0.3, FZ1 - 0.1), (0.012, 0.2, 0.012), IRON, rz=0.1)
box(yard, (FX1 + 0.012, 0.3, FZ1 - 0.13), (0.012, 0.2, 0.012), IRON, rz=-0.1)

# The ore bin at the back of the lean-to, where the miner tips the cart, with a little ore in
# it whatever the week says - the mine's own bin is the one that counts.
OX0, OX1, OZ0, OZ1 = 0.78, 1.24, -0.9, -0.5
box(yard, ((OX0 + OX1) / 2, 0.02, (OZ0 + OZ1) / 2), (OX1 - OX0, 0.04, OZ1 - OZ0), BENCH)
for (x, z, w, d, h) in [((OX0 + OX1) / 2, OZ0, OX1 - OX0, 0.03, 0.2), ((OX0 + OX1) / 2, OZ1, OX1 - OX0, 0.03, 0.14),
                         (OX0, (OZ0 + OZ1) / 2, 0.03, OZ1 - OZ0, 0.17), (OX1, (OZ0 + OZ1) / 2, 0.03, OZ1 - OZ0, 0.17)]:
    box(yard, (x, h / 2, z), (w, h, d), BENCH)
for n, (x, z) in enumerate([(0.9, -0.72), (1.02, -0.64), (1.12, -0.76), (0.96, -0.6)]):
    lump(yard, (x, 0.07, z), 0.045, ORE_ROCK, n)

# A quench bucket by the front post.
cylinder(yard, (1.12, 0, 0.2), (1.12, 0.13, 0.2), 0.065, BENCH, sides=7)
cylinder(yard, (1.12, 0.1, 0.2), (1.12, 0.11, 0.2), 0.058, WATER, sides=7, cap=WATER)
yard.build()

# The casting bench in front of the furnace: measured, not moved - its origin is the middle of
# its top, where the goldsmith works and the mould lies.
BX0, BX1, BZ0, BZ1, BY = 0.14, 0.72, -0.2, 0.14, 0.25
bench = Part(SMITH, 'bench', ((BX0 + BX1) / 2, BY, (BZ0 + BZ1) / 2))
box(bench, ((BX0 + BX1) / 2, BY - 0.015, (BZ0 + BZ1) / 2), (BX1 - BX0, 0.03, BZ1 - BZ0), BENCH)
for x in (BX0 + 0.04, BX1 - 0.04):
    for z in (BZ0 + 0.04, BZ1 - 0.04):
        box(bench, (x, (BY - 0.03) / 2, z), (0.035, BY - 0.03, 0.035), TIMBER)
# The ingot mould, three hollows with the last cast still in two of them.
box(bench, ((BX0 + BX1) / 2 - 0.04, BY + 0.015, (BZ0 + BZ1) / 2), (0.3, 0.03, 0.12), IRON)
for k in range(2):
    box(bench, ((BX0 + BX1) / 2 - 0.13 + k * 0.09, BY + 0.031, (BZ0 + BZ1) / 2), (0.07, 0.004, 0.08), GOLD)
box(bench, (BX1 - 0.1, BY + 0.01, BZ1 - 0.06), (0.1, 0.02, 0.05), GOLD)
bench.build()

# The fire in the mouth: its origin in the middle of it, where goldsmith.js lets the embers go.
glow = Part(SMITH, 'glow', MOUTH_AT)
box(glow, (FMX, MOUTH_AT[1], FZ1 - 0.015), (0.17, 0.12, 0.01), FIRE)
for i in range(3):
    box(glow, (FMX - 0.05 + i * 0.05, MOUTH_AT[1] - 0.045, FZ1 - 0.01), (0.04, 0.025, 0.03), FIRE, ry=i * 0.6)
glow.build()

door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DOOR_X, 0, Z1))
SMITH.objects.link(door)
smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((FMX, 1.4, FZ0 + 0.15))
SMITH.objects.link(smoke)

bpy.context.scene['building_height'] = 1.4
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'goldsmith.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'goldsmith'})
