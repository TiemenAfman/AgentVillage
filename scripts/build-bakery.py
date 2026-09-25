"""The bakery. Rebuild with scripts/blender.mjs --background --python scripts/build-bakery.py.

A small half-timbered shop under a red tiled roof: a door, a shop window under a striped awning
with loaves on the sill, a pretzel hung out on an arm, flour sacks by the door; and against its
right side a domed stone bread oven with a glowing mouth, its own flue, and the wood to feed it.
Not yet placed on the island (Plans/stal-en-veld.md); it stands on /demo.

One civic asset, `civic_bakery` (budget 1500), with one part that is not merged:
`civic_bakery glow`, the fire in the oven's mouth, origin on the mouth - web/js/countryside.js
makes it breathe, the way smithy.js does the smithy's coals. `anchor.smoke` is on the flue.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/bakery'
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


PLASTER = material('wall', 'bakery plaster', 0xf0e2c4)
TIMBER = material('plank', 'bakery timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'bakery timber', 0x6a4426)
TILES = material('roof', 'bakery tiles', 0xb9583a)
BRICK = material('stone', 'bakery oven', 0xa4674a)
STONE = material('stone', 'bakery footing', 0x8f8c86)
DOOR = material('plank', 'bakery door', 0x5a3a24)
GLASS = material('plain', 'bakery window', 0x2e3136)
AWNING_A = material('plain', 'bakery awning', 0xc8443a)
AWNING_B = material('plain', 'bakery awning stripe', 0xf2e8d8)
BREAD = material('plain', 'bakery bread', 0xc98a45)
CRUST = material('plain', 'bakery crust', 0x9c5f2a)
SACK = material('plain', 'bakery flour sack', 0xe6dcc6)
IRON = material('plain', 'bakery iron', 0x33343a)
DARK = material('plain', 'bakery inside', 0x231a14)
FIRE = material('plain', 'bakery fire', 0xff8636, emissive=True)
LOGS = material('plain', 'bakery logs', 0x7a4a2a)
GRAIN = material('plain', 'bakery end grain', 0xc98f55)
WINDOW_GLOW = material('plain', 'bakery lit window', 0xffd88a, emissive=True)


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


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def cylinder(part, a, b, r, mat, sides=6, cap=None):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap:
        part.add(ring(a), [list(range(sides))[::-1]], cap)
        part.add(ring(b), [list(range(sides))], cap)


ASSET = bpy.data.collections.new('civic_bakery')
bpy.context.scene.collection.children.link(ASSET)
X0, X1, Z0, Z1 = -0.52, 0.28, -0.34, 0.3
EAVES, RIDGE, MIDZ, T = 0.58, 0.96, (-0.34 + 0.3) / 2, 0.04

house = Part(ASSET, 'house')
for z in (Z0 + T / 2, Z1 - T / 2):
    box(house, ((X0 + X1) / 2, 0.05 + (EAVES - 0.05) / 2, z), (X1 - X0, EAVES - 0.05, T), PLASTER)
for x in (X0 + T / 2, X1 - T / 2):
    box(house, (x, 0.05 + (EAVES - 0.05) / 2, MIDZ), (T, EAVES - 0.05, Z1 - Z0), PLASTER)
    house.add([(x - T / 2, EAVES, Z0), (x - T / 2, EAVES, Z1), (x - T / 2, RIDGE, MIDZ),
               (x + T / 2, EAVES, Z0), (x + T / 2, EAVES, Z1), (x + T / 2, RIDGE, MIDZ)],
              [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1]], PLASTER)
box(house, ((X0 + X1) / 2, 0.025, MIDZ), (X1 - X0 + 0.04, 0.05, Z1 - Z0 + 0.04), STONE)
for x in (X0, X1):
    for z in (Z0, Z1):
        box(house, (x, EAVES / 2, z), (0.05, EAVES, 0.05), TIMBER)
for z in (Z0 - 0.012, Z1 + 0.012):
    box(house, ((X0 + X1) / 2, EAVES - 0.02, z), (X1 - X0 + 0.06, 0.035, 0.026), TIMBER)
    box(house, ((X0 + X1) / 2, 0.32, z), (X1 - X0, 0.03, 0.024), TIMBER)
for x in (X0 - 0.012, X1 + 0.012):
    box(house, (x, EAVES - 0.02, MIDZ), (0.026, 0.035, Z1 - Z0), TIMBER_Z)
# The door on the left, the shop window on the right with its sill of loaves and its awning.
DX = -0.32
box(house, (DX, 0.25, Z1 + 0.006), (0.17, 0.4, 0.02), DOOR)
box(house, (DX, 0.47, Z1 + 0.012), (0.21, 0.03, 0.035), TIMBER)
cylinder(house, (DX + 0.05, 0.25, Z1 + 0.017), (DX + 0.05, 0.25, Z1 + 0.03), 0.012, IRON, cap=IRON)
WX = 0.05
box(house, (WX, 0.35, Z1 - 0.004), (0.3, 0.18, 0.012), GLASS)
box(house, (WX, 0.35, Z1 + 0.004), (0.2, 0.1, 0.006), WINDOW_GLOW)
box(house, (WX, 0.35, Z1 + 0.01), (0.012, 0.18, 0.012), TIMBER)
box(house, (WX, 0.245, Z1 + 0.05), (0.34, 0.025, 0.11), TIMBER)
for i, x in enumerate((-0.07, 0.02, 0.11, 0.17)):
    box(house, (WX + x - 0.02, 0.275, Z1 + 0.055), (0.07, 0.035, 0.05), BREAD if i % 2 == 0 else CRUST, ry=0.2 * i)
for i in range(6):
    x = WX - 0.18 + i * 0.06
    box(house, (x + 0.03, 0.5, Z1 + 0.08), (0.06, 0.012, 0.17), AWNING_A if i % 2 == 0 else AWNING_B, rx=0.45)
# Flour sacks by the door.
for i, (x, z) in enumerate(((DX - 0.16, Z1 + 0.06), (DX - 0.11, Z1 + 0.13))):
    box(house, (x, 0.055, z), (0.07, 0.11, 0.06), SACK, ry=0.3 * i)
    box(house, (x, 0.115, z), (0.04, 0.02, 0.035), SACK, ry=0.3 * i)
house.build()

roof = Part(ASSET, 'roof')
pitch = math.atan2(RIDGE - EAVES, (Z1 - Z0) / 2)
span = math.hypot((Z1 - Z0) / 2, RIDGE - EAVES) + 0.12
for side in (-1, 1):
    box(roof, ((X0 + X1) / 2, (EAVES + RIDGE) / 2 + 0.03, MIDZ + side * ((Z1 - Z0) / 4 + 0.02)),
        (X1 - X0 + 0.14, 0.04, span), TILES, rx=side * pitch)
box(roof, ((X0 + X1) / 2, RIDGE + 0.04, MIDZ), (X1 - X0 + 0.16, 0.035, 0.05), TILES)
# The pretzel on its arm, over the door: a bent iron arm and the sign's loops as a ring of bits.
box(roof, (DX - 0.02, 0.56, Z1 + 0.1), (0.016, 0.016, 0.2), IRON)
px, py, pz = DX - 0.02, 0.47, Z1 + 0.17
for k in range(8):
    t = 2 * math.pi * k / 8
    box(roof, (px + 0.045 * math.cos(t) * (1 + 0.4 * math.cos(2 * t)), py + 0.04 * math.sin(t), pz), (0.03, 0.022, 0.018), CRUST, rz=t)
box(roof, (px, py + 0.055, pz), (0.004, 0.03, 0.004), IRON)
roof.build()

# ---- the oven ----------------------------------------------------------------------------
OX, OZ, OR, OH = 0.52, 0.02, 0.2, 0.3
MOUTH = (OX, 0.11, OZ + OR * 0.93)
oven = Part(ASSET, 'oven')
box(oven, (OX, 0.04, OZ), (OR * 2 + 0.06, 0.08, OR * 2 + 0.06), STONE)
rings = [(0.08, OR), (0.16, OR * 0.97), (0.24, OR * 0.8), (0.31, OR * 0.5), (0.345, OR * 0.12)]
sides = 10
pts = [(OX + math.cos(2 * math.pi * k / sides) * r, y, OZ + math.sin(2 * math.pi * k / sides) * r) for y, r in rings for k in range(sides)]
faces = []
for j in range(len(rings) - 1):
    faces += [[j * sides + (i + 1) % sides, j * sides + i, (j + 1) * sides + i, (j + 1) * sides + (i + 1) % sides] for i in range(sides)]
faces.append([(len(rings) - 1) * sides + i for i in range(sides)][::-1])
oven.add(pts, faces, BRICK)
# The arched mouth: a dark opening in a stone surround, and the flue behind the dome.
box(oven, (MOUTH[0], MOUTH[1], MOUTH[2] + 0.012), (0.16, 0.14, 0.03), STONE)
box(oven, (MOUTH[0], MOUTH[1], MOUTH[2] + 0.02), (0.1, 0.08, 0.02), DARK)
box(oven, (MOUTH[0], MOUTH[1] - 0.05, MOUTH[2] + 0.05), (0.14, 0.02, 0.06), STONE)
cylinder(oven, (OX, 0.28, OZ - 0.1), (OX, 0.48, OZ - 0.1), 0.035, BRICK, sides=6)
# The wood for it, stacked against the house wall behind the oven.
for row, (count, y) in enumerate(((3, 0.03), (2, 0.085))):
    for i in range(count):
        z = OZ - OR - 0.03 - (i + row * 0.5) * 0.055 + 0.1
        cylinder(oven, (OX + OR + 0.02, y, z), (OX + OR + 0.14, y, z), 0.028, LOGS, cap=GRAIN)
oven.build()

glow = Part(ASSET, 'glow', MOUTH)
box(glow, (MOUTH[0], MOUTH[1] - 0.01, MOUTH[2] + 0.026), (0.08, 0.05, 0.012), FIRE)
for k in range(3):
    box(glow, (MOUTH[0] - 0.03 + k * 0.03, MOUTH[1] - 0.03, MOUTH[2] + 0.03), (0.025, 0.015, 0.02), FIRE, ry=k)
glow.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((OX, 0.52, OZ - 0.1))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DX, 0, Z1 + 0.1))
ASSET.objects.link(door)

bpy.context.scene['building_height'] = 1.0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'bakery.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'bakery'})
