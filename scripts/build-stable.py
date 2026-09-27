"""The stable. Rebuild with scripts/blender.mjs --background --python scripts/build-stable.py.

After Ideas/Images to Render/StableParts.png: planked walls under a half-timbered upper storey
and a blue slate roof, two stall doors split across the middle with their top halves open, a
big cross-braced double door, a hay loft in the gable, a hanging sign and a lantern; beside it
a paddock of post-and-rail fence with a gate, a trough, a hay rack, bales, a saddle on its rack
and a trodden-sand floor. The horse is not baked here: it is `fauna_horse`
(scripts/build-fauna.py), and web/js/stable.js lets it loose on the sand. Not yet placed on
the island (Plans/stal-en-veld.md); it stands on /demo.

    civic_stable        the stable building
    civic_stable_yard   the paddock and its furniture; `civic_stable_yard paddock` is the sand,
                        which stable.js measures for where the horse may go

Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/stable'
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


BOARDS = material('plank', 'stable boards', 0x7b5230)
BOARDS_Z = material('plankZ', 'stable boards', 0x7b5230)
TIMBER = material('plank', 'stable timber', 0x5e3b20)
TIMBER_Z = material('plankZ', 'stable timber', 0x5e3b20)
PLASTER = material('wall', 'stable plaster', 0xe9e0cc)
SLATE = material('roof', 'stable slate', 0x3f63a8)
DARK = material('plain', 'stable inside', 0x2a1f18)
IRON = material('plain', 'stable iron', 0x3a3a3e)
HAY = material('plain', 'stable hay', 0xe0b84e)
HAY_BAND = material('plain', 'stable twine', 0xb68a34)
SAND = material('plain', 'stable sand', 0xb89a6a)
WATER = material('plain', 'stable water', 0x5b7f96)
LEATHER = material('plain', 'stable saddle', 0x6b3f25)
SIGN = material('plank', 'stable sign', 0xb08556)
LAMP = material('plain', 'stable lamp', 0xffd27a, emissive=True)
STONE = material('stone', 'stable footing', 0x929087)
EDGE = material('plank', 'stable cut oak', 0xa77b49)


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


def beam(part, a, b, t, mat):
    a, b = Vector(a), Vector(b)
    d = b - a
    box(part, (a + b) / 2, (t, t, d.length), mat, rx=-math.atan2(d.y, math.hypot(d.x, d.z)), ry=math.atan2(d.x, d.z))


# ---- the stable -----------------------------------------------------------------------
HOUSE = collection('civic_stable')
X0, X1, Z0, Z1 = -0.8, 0.3, -0.42, 0.26
EAVES, RIDGE, BAND = 0.66, 1.06, 0.38        # BAND: where the planks stop and the timbering starts
MIDZ, T = (Z0 + Z1) / 2, 0.04

walls = Part(HOUSE, 'walls')
# A low stone course keeps the boards out of the mud without raising the doors.
box(walls, ((X0 + X1) / 2, 0.035, MIDZ), (X1 - X0 + 0.045, 0.07, Z1 - Z0 + 0.035), STONE)
for z in (Z0 + T / 2, Z1 - T / 2):
    box(walls, ((X0 + X1) / 2, BAND / 2, z), (X1 - X0, BAND, T), BOARDS)
    box(walls, ((X0 + X1) / 2, (BAND + EAVES) / 2, z), (X1 - X0, EAVES - BAND, T), PLASTER)
for x in (X0 + T / 2, X1 - T / 2):
    box(walls, (x, BAND / 2, MIDZ), (T, BAND, Z1 - Z0), BOARDS_Z)
    box(walls, (x, (BAND + EAVES) / 2, MIDZ), (T, EAVES - BAND, Z1 - Z0), PLASTER)
    walls.add([(x - T / 2, EAVES, Z0), (x - T / 2, EAVES, Z1), (x - T / 2, RIDGE, MIDZ),
               (x + T / 2, EAVES, Z0), (x + T / 2, EAVES, Z1), (x + T / 2, RIDGE, MIDZ)],
              [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1]], PLASTER)
walls.build()

frame = Part(HOUSE, 'frame')
for x in (X0, X1):
    for z in (Z0, Z1):
        box(frame, (x, EAVES / 2, z), (0.055, EAVES, 0.055), TIMBER)
for z in (Z0 - 0.012, Z1 + 0.012):
    for y in (BAND, EAVES - 0.02):
        box(frame, ((X0 + X1) / 2, y, z), (X1 - X0 + 0.06, 0.035, 0.028), TIMBER)
# The upper storey's timbering on the front: posts and two crosses.
for i, x in enumerate((-0.55, -0.25, 0.05)):
    box(frame, (x, (BAND + EAVES) / 2, Z1 + 0.014), (0.03, EAVES - BAND, 0.02), TIMBER)
for x0, x1 in ((-0.55, -0.25), (-0.25, 0.05)):
    beam(frame, (x0, BAND + 0.02, Z1 + 0.016), (x1, EAVES - 0.03, Z1 + 0.016), 0.022, TIMBER)
    beam(frame, (x1, BAND + 0.02, Z1 + 0.018), (x0, EAVES - 0.03, Z1 + 0.018), 0.022, TIMBER)
for x in (X0 - 0.012, X1 + 0.012):
    box(frame, (x, BAND, MIDZ), (0.028, 0.035, Z1 - Z0), TIMBER_Z)
    box(frame, (x, EAVES - 0.02, MIDZ), (0.035, 0.045, Z1 - Z0), TIMBER_Z)
    for z in (Z0, Z1):
        beam(frame, (x, EAVES, z), (x, RIDGE, MIDZ), 0.035, EDGE)
        beam(frame, (x, BAND + 0.025, z), (x, EAVES - 0.045, MIDZ), 0.025, TIMBER)
# Short rafter tails give the broad slate roof a timber underside.
for x in (-0.7, -0.4, -0.1, 0.2):
    for z in (Z0 - 0.035, Z1 + 0.035):
        box(frame, (x, EAVES - 0.035, z), (0.035, 0.045, 0.115), EDGE)
frame.build()

doors = Part(HOUSE, 'doors')
# Two stall doors split across the middle: the bottom half shut, the top half open onto the
# dark stall behind it. Then the big double door, cross-braced, with iron strap hinges.
for x in (-0.64, -0.42):
    box(doors, (x, 0.13, Z1 + 0.006), (0.16, 0.24, 0.02), BOARDS)
    beam(doors, (x - 0.07, 0.03, Z1 + 0.018), (x + 0.07, 0.23, Z1 + 0.018), 0.018, TIMBER)
    # The dark opening must sit in front of the solid wall, or the plaster hides it.
    box(doors, (x, 0.34, Z1 + 0.008), (0.15, 0.17, 0.012), DARK)
    for dx in (-0.09, 0.09):
        box(doors, (x + dx, 0.235, Z1 + 0.025), (0.022, 0.45, 0.035), EDGE)
    box(doors, (x, 0.44, Z1 + 0.025), (0.2, 0.025, 0.035), EDGE)
    # An upper half swung out: the split door reads as a stall from the street.
    box(doors, (x - 0.105, 0.34, Z1 + 0.09), (0.025, 0.17, 0.15), BOARDS)
    box(doors, (x, 0.255, Z1 + 0.012), (0.18, 0.02, 0.035), TIMBER)
    for y in (0.07, 0.19):
        box(doors, (x - 0.05, y, Z1 + 0.019), (0.07, 0.012, 0.005), IRON)
for side in (-1, 1):
    x = 0.0 + side * 0.1
    box(doors, (x, 0.24, Z1 + 0.006), (0.19, 0.46, 0.02), BOARDS)
    beam(doors, (x - 0.08, 0.03, Z1 + 0.018), (x + 0.08, 0.45, Z1 + 0.018), 0.02, TIMBER)
    beam(doors, (x + 0.08, 0.03, Z1 + 0.02), (x - 0.08, 0.45, Z1 + 0.02), 0.02, TIMBER)
    for y in (0.1, 0.38):
        box(doors, (x + side * 0.05, y, Z1 + 0.021), (0.09, 0.014, 0.005), IRON)
box(doors, (0, 0.49, Z1 + 0.012), (0.44, 0.03, 0.04), TIMBER)
for x in (-0.025, 0.025):
    box(doors, (x, 0.245, Z1 + 0.035), (0.014, 0.05, 0.012), IRON)
doors.build()

roof = Part(HOUSE, 'roof')
pitch = math.atan2(RIDGE - EAVES, (Z1 - Z0) / 2)
span = math.hypot((Z1 - Z0) / 2, RIDGE - EAVES) + 0.12
for side in (-1, 1):
    box(roof, ((X0 + X1) / 2, (EAVES + RIDGE) / 2 + 0.03, MIDZ + side * ((Z1 - Z0) / 4 + 0.02)),
        (X1 - X0 + 0.16, 0.04, span), SLATE, rx=side * pitch)
box(roof, ((X0 + X1) / 2, RIDGE + 0.04, MIDZ), (X1 - X0 + 0.18, 0.04, 0.06), TIMBER)
# Bargeboards follow the slopes; the blue tiles remain the large, quiet colour field.
for x in (X0 - 0.085, X1 + 0.085):
    for side in (-1, 1):
        beam(roof, (x, EAVES - 0.055, MIDZ + side * 0.415),
             (x, RIDGE + 0.055, MIDZ), 0.035, EDGE)
# The hay loft door in the right gable, open, with hay showing, and a hoist beam over it.
box(roof, (X1 + 0.004, 0.8, MIDZ), (0.012, 0.16, 0.14), DARK)
box(roof, (X1 + 0.008, 0.76, MIDZ), (0.014, 0.07, 0.12), HAY)
box(roof, (X1 + 0.08, 0.95, MIDZ), (0.16, 0.03, 0.03), TIMBER)
box(roof, (X1 + 0.15, 0.9, MIDZ), (0.004, 0.09, 0.004), IRON)
for z in (MIDZ - 0.095, MIDZ + 0.095):
    box(roof, (X1 + 0.018, 0.805, z), (0.03, 0.21, 0.025), EDGE)
box(roof, (X1 + 0.04, 0.705, MIDZ), (0.09, 0.03, 0.22), EDGE)
box(roof, (X1 + 0.02, 0.91, MIDZ), (0.03, 0.025, 0.22), EDGE)
for z in (MIDZ - 0.15, MIDZ + 0.15):
    box(roof, (X1 + 0.025, 0.8, z), (0.03, 0.17, 0.07), BOARDS_Z)
    box(roof, (X1 + 0.044, 0.8, z), (0.014, 0.018, 0.07), TIMBER_Z)
roof.build()

signs = Part(HOUSE, 'sign')
# A board on an arm by the big door, a horseshoe on it, and the lantern the other side.
box(signs, (0.28, 0.58, Z1 + 0.09), (0.02, 0.02, 0.16), TIMBER)
box(signs, (0.28, 0.5, Z1 + 0.14), (0.012, 0.12, 0.12), SIGN)
# A connected U on both faces, open at the top: five loose dots read as nails.
for x in (0.27, 0.29):
    for i in range(7):
        a, b = [math.pi * (0.25 + 1.5 * k / 7) for k in (i, i + 1)]
        beam(signs, (x, 0.5 + 0.035 * math.cos(a), Z1 + 0.14 + 0.035 * math.sin(a)),
             (x, 0.5 + 0.035 * math.cos(b), Z1 + 0.14 + 0.035 * math.sin(b)), 0.01, IRON)
box(signs, (-0.22, 0.52, Z1 + 0.03), (0.01, 0.01, 0.05), IRON)
box(signs, (-0.22, 0.47, Z1 + 0.055), (0.035, 0.05, 0.035), LAMP)
box(signs, (-0.22, 0.5, Z1 + 0.055), (0.045, 0.01, 0.045), IRON)
signs.build()

# ---- the paddock ------------------------------------------------------------------------
YARD = collection('civic_stable_yard')
PX0, PX1, PZ0, PZ1 = 0.42, 1.5, -0.42, 0.78

paddock = Part(YARD, 'paddock')
box(paddock, ((PX0 + PX1) / 2, 0.004, (PZ0 + PZ1) / 2), (PX1 - PX0 - 0.04, 0.008, PZ1 - PZ0 - 0.04), SAND)
paddock.build()

fence = Part(YARD, 'fence')
GATE = (0.95, 1.2)                               # the gap in the front rail, x from to
posts = []
for x in (PX0, (PX0 + PX1) / 2, PX1):
    posts += [(x, PZ0), (x, PZ1)]
posts += [(PX0, (PZ0 + PZ1) / 2), (PX1, (PZ0 + PZ1) / 2)]
posts += [(GATE[0], PZ1), (GATE[1], PZ1)]
for x, z in posts:
    box(fence, (x, 0.13, z), (0.035, 0.26, 0.035), TIMBER)
for y in (0.1, 0.21):
    box(fence, ((PX0 + PX1) / 2, y, PZ0), (PX1 - PX0, 0.022, 0.02), TIMBER)
    box(fence, (PX1, y, (PZ0 + PZ1) / 2), (0.02, 0.022, PZ1 - PZ0), TIMBER_Z)
    box(fence, ((PX0 + GATE[0]) / 2, y, PZ1), (GATE[0] - PX0, 0.022, 0.02), TIMBER)
    box(fence, ((GATE[1] + PX1) / 2, y, PZ1), (PX1 - GATE[1], 0.022, 0.02), TIMBER)
    box(fence, (PX0, y, (PZ0 + PZ1) / 2), (0.02, 0.022, PZ1 - PZ0), TIMBER_Z)
# The gate, standing a little open.
gw = GATE[1] - GATE[0]
for y in (0.08, 0.2):
    box(fence, (GATE[0] + gw * 0.45, y, PZ1 + 0.1), (gw * 0.9, 0.02, 0.018), TIMBER, ry=0.45)
beam(fence, (GATE[0] + 0.02, 0.08, PZ1 + 0.01), (GATE[0] + gw * 0.8, 0.2, PZ1 + 0.18), 0.016, TIMBER)
fence.build()

gear = Part(YARD, 'gear')
# The trough against the back rail, the hay rack beside it, bales in the corner by the stable,
# a saddle on its rack by the gate, and a barrel.
box(gear, (1.1, 0.05, PZ0 + 0.08), (0.3, 0.1, 0.1), BOARDS)
box(gear, (1.1, 0.096, PZ0 + 0.08), (0.27, 0.01, 0.075), WATER)
for x in (0.99, 1.21):
    box(gear, (x, 0.02, PZ0 + 0.08), (0.02, 0.04, 0.12), TIMBER_Z)
box(gear, (1.38, 0.16, PZ0 + 0.1), (0.18, 0.02, 0.12), TIMBER)
for i in range(5):
    box(gear, (1.3 + i * 0.04, 0.23, PZ0 + 0.1), (0.008, 0.12, 0.1), TIMBER, rx=0.15)
box(gear, (1.38, 0.19, PZ0 + 0.1), (0.16, 0.05, 0.08), HAY)
for x in (1.3, 1.46):
    box(gear, (x, 0.08, PZ0 + 0.1), (0.02, 0.16, 0.02), TIMBER)
for i, (x, y, z) in enumerate(((0.52, 0.045, PZ0 + 0.1), (0.66, 0.045, PZ0 + 0.1), (0.59, 0.135, PZ0 + 0.1), (0.52, 0.045, PZ0 + 0.26))):
    box(gear, (x, y, z), (0.13, 0.09, 0.14), HAY, ry=0.05 * i)
    box(gear, (x - 0.035, y, z), (0.008, 0.092, 0.142), HAY_BAND, ry=0.05 * i)
    box(gear, (x + 0.035, y, z), (0.008, 0.092, 0.142), HAY_BAND, ry=0.05 * i)
SX, SZ = 0.68, PZ1 + 0.14                        # the saddle rack, outside by the gate
for dx in (-0.05, 0.05):
    box(gear, (SX + dx, 0.08, SZ), (0.02, 0.16, 0.02), TIMBER)
box(gear, (SX, 0.165, SZ), (0.14, 0.02, 0.03), TIMBER)
box(gear, (SX, 0.19, SZ), (0.1, 0.03, 0.08), LEATHER)
box(gear, (SX, 0.21, SZ - 0.02), (0.03, 0.02, 0.02), LEATHER)
for side in (-1, 1):
    box(gear, (SX, 0.13, SZ + side * 0.045), (0.02, 0.1, 0.006), LEATHER)
gear.build()

bpy.context.scene['building_height'] = 1.1
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'stable.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'stable'})
