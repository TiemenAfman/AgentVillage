"""The smithy. Rebuild with scripts/blender.mjs --background --python scripts/build-smithy.py.

After the reference: a small half-timbered house - cream plaster between brown timbers, stone
feet at the corners, a dark slate roof with a dormer and a stone chimney, a plank door with iron
straps and a shuttered window - and against its right gable an open lean-to on posts, where the
work is: the forge hearth with its bellows, an anvil on a stump, a quench bucket, a crate of
tools, and a lantern hanging from the front beam. Not yet placed on the island (Plans/smidse.md)
- it stands on /demo, like the sawmill.

Two civic assets, each under the civic budget of 1500:

    civic_smithy        the house: frame, walls, roof, dormer, chimney, door, window, steps, logs
    civic_smithy_yard   the lean-to and the forge - and the parts that move, which
                        web/js/smithy.js takes out of the merge and hangs on their own pivots:

        civic_smithy_yard bellows   the bellows' top board, hinged at the nozzle, about z
        civic_smithy_yard coals     the glow in the oven's mouth, which breathes with the bellows
        civic_smithy_yard lantern   the lantern, hanging from its hook, swinging about z

    and one that does not move but is measured: `civic_smithy_yard anvil`, whose origin is its
    face - where the smith strikes. The house's `anchor.door` is where he goes in at night.

As in build-sawmill.py, a moving part lives inside an asset that stands on the ground, with its
origin on its own axis, so its baked `at` is the pivot. The reference's smith is not drawn:
there is no figure in a baked set, and a hammer swinging on its own would be a ghost's.

Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the
timber the plank sheets, so the island's own textures draw the courses and the boards.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/smithy'
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


PLASTER = material('wall', 'smithy plaster', 0xe6dcc6)
TIMBER = material('plank', 'smithy timber', 0x7a4f2c)
TIMBER_Z = material('plankZ', 'smithy timber', 0x7a4f2c)
SLATE = material('roof', 'smithy slate', 0x3e4046)
STONE = material('stone', 'smithy stone', 0x8e9093)
DOOR = material('plank', 'smithy door', 0x5c3a22)
IRON = material('plain', 'smithy iron', 0x303236)
GLASS = material('plain', 'smithy window', 0x2b2a2e)
LOGS = material('plain', 'smithy bark', 0x7a4a2a)
GRAIN = material('plain', 'smithy end grain', 0xc98f55)
STUMP = material('plain', 'smithy stump', 0x8a5a34)
COALS = material('plain', 'smithy coals', 0xff7a2e, emissive=True)
FLAME = material('plain', 'smithy lantern', 0xffc860, emissive=True)
HOT = material('plain', 'smithy hot iron', 0xff9a3c, emissive=True)
WATER = material('plain', 'smithy water', 0x3c5a6e)


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


def beam(part, a, b, t, mat):
    """A square timber from a to b, `t` thick - a brace or a rafter end."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.atan2(d.x, d.z)
    pitch = math.atan2(d.y, math.hypot(d.x, d.z))
    box(part, (a + b) / 2, (t, t, d.length), mat, rx=-pitch, ry=yaw)


def basis(d):
    d = d.normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def cylinder(part, a, b, r, mat, sides=6, cap=None, turn=0.0, r2=None):
    a, b = Vector(a), Vector(b)
    u, v = basis(b - a)
    ring = lambda c, rr: [c + (u * math.cos(t) + v * math.sin(t)) * rr
                          for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    part.add(ring(a, r) + ring(b, r if r2 is None else r2),
             [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap is not None:
        part.add(ring(a, r), [list(range(sides))[::-1]], cap)
        part.add(ring(b, r if r2 is None else r2), [list(range(sides))], cap)


def log(part, a, b, r, turn=0.0):
    cylinder(part, a, b, r, LOGS, sides=6, cap=GRAIN, turn=turn)


# ---- the house ------------------------------------------------------------------------
HOUSE = collection('civic_smithy')
X0, X1, Z0, Z1 = -0.72, 0.1, -0.42, 0.34       # the house's walls; the ridge runs along x
EAVES, RIDGE = 0.64, 1.08
MIDZ = (Z0 + Z1) / 2
T = 0.04

walls = Part(HOUSE, 'walls')
box(walls, ((X0 + X1) / 2, 0.06 + (EAVES - 0.06) / 2, Z1 - T / 2), (X1 - X0, EAVES - 0.06, T), PLASTER)
box(walls, ((X0 + X1) / 2, 0.06 + (EAVES - 0.06) / 2, Z0 + T / 2), (X1 - X0, EAVES - 0.06, T), PLASTER)
for x in (X0 + T / 2, X1 - T / 2):
    box(walls, (x, 0.06 + (EAVES - 0.06) / 2, MIDZ), (T, EAVES - 0.06, Z1 - Z0), PLASTER)
    # the gable over each side wall
    walls.add([(x - T / 2, EAVES, Z0), (x - T / 2, EAVES, Z1), (x - T / 2, RIDGE, MIDZ),
               (x + T / 2, EAVES, Z0), (x + T / 2, EAVES, Z1), (x + T / 2, RIDGE, MIDZ)],
              [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1]], PLASTER)
walls.build()

frame = Part(HOUSE, 'frame')
# The half-timbering: corner posts on stone feet, a rail under the eaves and one at the sill,
# posts either side of the door, and a cross on the right gable over the lean-to.
for x in (X0, X1):
    for z in (Z0, Z1):
        box(frame, (x, 0.08 / 2, z), (0.1, 0.08, 0.1), STONE)
        box(frame, (x, (0.08 + EAVES) / 2, z), (0.055, EAVES - 0.08, 0.055), TIMBER)
for z in (Z0, Z1):
    box(frame, ((X0 + X1) / 2, EAVES - 0.02, z + (0.012 if z == Z1 else -0.012)), (X1 - X0 + 0.08, 0.045, 0.03), TIMBER)
    box(frame, ((X0 + X1) / 2, 0.08, z + (0.012 if z == Z1 else -0.012)), (X1 - X0, 0.035, 0.03), TIMBER)
for x in (X0, X1):
    box(frame, (x + (0.012 if x == X1 else -0.012), EAVES - 0.02, MIDZ), (0.03, 0.045, Z1 - Z0), TIMBER_Z)
DOOR_X, DOOR_W, DOOR_H = -0.24, 0.22, 0.44
for x in (DOOR_X - DOOR_W / 2 - 0.02, DOOR_X + DOOR_W / 2 + 0.02):
    box(frame, (x, (0.08 + EAVES) / 2, Z1 + 0.012), (0.04, EAVES - 0.1, 0.03), TIMBER)
box(frame, (DOOR_X, 0.08 + DOOR_H + 0.02, Z1 + 0.014), (DOOR_W + 0.08, 0.04, 0.035), TIMBER)
gx = X1 + 0.012
beam(frame, (gx, EAVES, Z0 + 0.06), (gx, RIDGE - 0.1, MIDZ), 0.03, TIMBER_Z)
beam(frame, (gx, EAVES, Z1 - 0.06), (gx, RIDGE - 0.1, MIDZ), 0.03, TIMBER_Z)
box(frame, (gx, (EAVES + RIDGE) / 2 - 0.05, MIDZ), (0.03, RIDGE - EAVES - 0.05, 0.035), TIMBER_Z)
frame.build()

front = Part(HOUSE, 'door')
# The plank door, its iron straps and ring; the shuttered window to its left; stone steps.
box(front, (DOOR_X, 0.08 + DOOR_H / 2, Z1 + 0.006), (DOOR_W, DOOR_H, 0.02), DOOR)
for y in (0.16, 0.42):
    box(front, (DOOR_X, y, Z1 + 0.018), (DOOR_W - 0.02, 0.018, 0.006), IRON)
cylinder(front, (DOOR_X + 0.06, 0.3, Z1 + 0.02), (DOOR_X + 0.06, 0.3, Z1 + 0.03), 0.018, IRON, sides=6, cap=IRON)
WIN_X = -0.56
box(front, (WIN_X, 0.4, Z1 + 0.004), (0.13, 0.14, 0.012), GLASS)
box(front, (WIN_X + 0.1, 0.4, Z1 + 0.012), (0.065, 0.16, 0.014), DOOR)
for y in (0.35, 0.45):
    box(front, (WIN_X + 0.1, y, Z1 + 0.021), (0.06, 0.012, 0.005), IRON)
box(front, (WIN_X, 0.32, Z1 + 0.02), (0.16, 0.02, 0.04), TIMBER)
for i, (w, d) in enumerate(((0.34, 0.16), (0.26, 0.09))):
    box(front, (DOOR_X, 0.02 + i * 0.035, Z1 + 0.02 + d / 2), (w, 0.04, d), STONE)
front.build()

roof = Part(HOUSE, 'roof')
pitch = math.atan2(RIDGE - EAVES, (Z1 - Z0) / 2)
span = math.hypot((Z1 - Z0) / 2, RIDGE - EAVES) + 0.12
length = X1 - X0 + 0.14
for side in (-1, 1):
    # Halfway down each pitch, lifted half a slate off the rafters; +z is the front pitch.
    box(roof, ((X0 + X1) / 2, (EAVES + RIDGE) / 2 + 0.03, MIDZ + side * (Z1 - Z0) / 4 + side * 0.02),
        (length, 0.04, span), SLATE, rx=side * pitch)
box(roof, ((X0 + X1) / 2, RIDGE + 0.04, MIDZ), (length + 0.02, 0.05, 0.06), TIMBER)
# The dormer on the front pitch, its own little gable over a four-light window. Set low on the
# pitch, near the eaves, so most of its face stands clear of the slates.
DX, DZ, DY = -0.02, 0.25, 0.8
box(roof, (DX, DY, DZ), (0.16, 0.16, 0.14), PLASTER)
box(roof, (DX, DY + 0.01, DZ + 0.071), (0.1, 0.09, 0.006), GLASS)
box(roof, (DX, DY + 0.01, DZ + 0.076), (0.012, 0.09, 0.004), TIMBER)
box(roof, (DX, DY + 0.01, DZ + 0.076), (0.1, 0.012, 0.004), TIMBER)
box(roof, (DX, DY - 0.045, DZ + 0.078), (0.13, 0.02, 0.02), TIMBER)
for side in (-1, 1):
    box(roof, (DX + side * 0.05, DY + 0.105, DZ + 0.01), (0.12, 0.025, 0.18), SLATE, rz=-side * 0.62)
# The chimney: dressed stone up the back pitch on the left, with a cap.
CX, CZ = -0.52, MIDZ - 0.12
box(roof, (CX, 0.95, CZ), (0.15, 0.62, 0.15), STONE)
box(roof, (CX, 1.28, CZ), (0.19, 0.05, 0.19), STONE)
roof.build()

wood = Part(HOUSE, 'woodpile')
# Split logs stacked against the left wall, and two boards leant beside them.
for row, (count, y) in enumerate(((3, 0.035), (2, 0.1), (1, 0.165))):
    for i in range(count):
        z = Z1 - 0.1 - (i + row * 0.5) * 0.07
        log(wood, (X0 - 0.16, y, z), (X0 - 0.04, y, z), 0.034, turn=(i + row) * 0.6)
for i, z in enumerate((Z1 + 0.02, Z1 - 0.26)):
    box(wood, (X0 - 0.19, 0.16, z), (0.02, 0.32, 0.05), TIMBER_Z, rz=0.15 + 0.05 * i)
wood.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((CX, 1.36, CZ))
HOUSE.objects.link(smoke)
# Where the smith goes in at night and comes out in the morning (web/js/smithy.js).
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DOOR_X, 0, Z1 + 0.1))
HOUSE.objects.link(door)

# ---- the lean-to and the forge --------------------------------------------------------
YARD = collection('civic_smithy_yard')
LX0, LX1 = X1, 0.9
HI, LO = 0.74, 0.52

shed = Part(YARD, 'lean-to')
box(shed, ((LX0 + LX1) / 2 + 0.02, (HI + LO) / 2 + 0.03, MIDZ),
    (math.hypot(LX1 - LX0 + 0.1, HI - LO), 0.035, Z1 - Z0 + 0.16), SLATE, rz=-math.atan2(HI - LO, LX1 - LX0))
for z in (Z0 + 0.03, Z1 - 0.03):
    box(shed, (LX1 - 0.03, 0.035, z), (0.09, 0.07, 0.09), STONE)
    box(shed, (LX1 - 0.03, (0.07 + LO) / 2, z), (0.05, LO - 0.07, 0.05), TIMBER)
    beam(shed, (LX1 - 0.03, LO - 0.14, z), (LX1 - 0.17, LO - 0.02, z), 0.025, TIMBER)
box(shed, (LX1 - 0.03, LO - 0.02, MIDZ), (0.055, 0.045, Z1 - Z0 + 0.04), TIMBER_Z)
box(shed, ((LX0 + LX1) / 2, (HI + LO) / 2 - 0.03, Z1 - 0.03), (LX1 - LX0, 0.035, 0.035), TIMBER, rz=-math.atan2(HI - LO, LX1 - LX0))
# Tools on the gable wall: two hammers and a pair of tongs, hung on pegs.
for i, x_off in enumerate((-0.14, -0.06)):
    z = Z0 + 0.34 + x_off
    box(shed, (LX0 + 0.008, 0.46, z), (0.01, 0.1, 0.012), TIMBER_Z)
    box(shed, (LX0 + 0.012, 0.51, z), (0.016, 0.022, 0.045), IRON)
beam(shed, (LX0 + 0.01, 0.4, Z0 + 0.4), (LX0 + 0.01, 0.53, Z0 + 0.36), 0.008, IRON)
beam(shed, (LX0 + 0.01, 0.4, Z0 + 0.4), (LX0 + 0.01, 0.53, Z0 + 0.44), 0.008, IRON)
shed.build()

HX, HZ = 0.6, Z0 + 0.14                       # the oven, at the back of the lean-to
OVEN_W, OVEN_H, OVEN_D = 0.3, 0.3, 0.24
MOUTH = (HX, 0.13, HZ + OVEN_D / 2)          # the middle of its open mouth, facing the front
forge = Part(YARD, 'forge')
# A squat stone oven: its body, a lintel and a sill round the mouth, and a domed top of two
# steps under the hood. The glow in the mouth is the `coals` part, which is what breathes.
mw, mh = 0.14, 0.1
box(forge, (HX, 0.02, HZ), (OVEN_W + 0.04, 0.04, OVEN_D + 0.04), STONE)
for side in (-1, 1):
    box(forge, (HX + side * (mw / 2 + (OVEN_W - mw) / 4), OVEN_H / 2, HZ), ((OVEN_W - mw) / 2, OVEN_H, OVEN_D), STONE)
box(forge, (HX, (MOUTH[1] + mh / 2 + OVEN_H) / 2, HZ), (mw, OVEN_H - MOUTH[1] - mh / 2, OVEN_D), STONE)
box(forge, (HX, (MOUTH[1] - mh / 2) / 2, HZ), (mw, MOUTH[1] - mh / 2, OVEN_D), STONE)
box(forge, (HX, MOUTH[1] - mh / 2 - 0.006, MOUTH[2] + 0.02), (mw + 0.06, 0.02, 0.05), STONE)
box(forge, (HX, MOUTH[1] + mh / 2 + 0.012, MOUTH[2] + 0.004), (mw + 0.05, 0.03, 0.02), STONE)
box(forge, (HX, OVEN_H + 0.02, HZ), (OVEN_W - 0.04, 0.04, OVEN_D - 0.04), STONE)
box(forge, (HX, OVEN_H + 0.055, HZ), (OVEN_W - 0.12, 0.03, OVEN_D - 0.1), STONE)
box(forge, (HX, MOUTH[1], HZ), (mw - 0.004, mh - 0.004, OVEN_D - 0.04), GLASS)   # the dark inside
# its hood and the pipe up through the lean-to roof
box(forge, (HX, 0.45, HZ - 0.02), (0.2, 0.06, 0.14), IRON)
cylinder(forge, (HX, 0.48, HZ - 0.02), (HX, 0.82, HZ - 0.02), 0.03, IRON, sides=8)
# The quench bucket and the tool crate.
BX, BZ = 0.7, 0.16
cylinder(forge, (BX, 0, BZ), (BX, 0.12, BZ), 0.055, TIMBER, sides=8, r2=0.062)
box(forge, (BX, 0.11, BZ), (0.09, 0.006, 0.09), WATER)
for y in (0.03, 0.09):
    cylinder(forge, (BX, y, BZ), (BX, y + 0.012, BZ), 0.062 + y * 0.06, IRON, sides=8)
KX, KZ = 1.02, 0.18
box(forge, (KX, 0.07, KZ), (0.16, 0.14, 0.16), TIMBER)
for y in (0.03, 0.11):
    box(forge, (KX, y, KZ), (0.165, 0.014, 0.165), IRON)
beam(forge, (KX - 0.03, 0.1, KZ), (KX - 0.05, 0.24, KZ + 0.02), 0.016, TIMBER)
beam(forge, (KX + 0.03, 0.1, KZ - 0.02), (KX + 0.06, 0.22, KZ - 0.04), 0.016, TIMBER)
# The bellows' bottom board and frame, beside the hearth; the top board is its own part.
WX, WZ = 0.34, Z0 + 0.12
box(forge, (WX, 0.18, WZ), (0.24, 0.02, 0.12), TIMBER)
for x in (WX - 0.09, WX + 0.09):
    box(forge, (x, 0.085, WZ), (0.025, 0.17, 0.025), TIMBER)
cylinder(forge, (WX + 0.12, 0.2, WZ), (HX - OVEN_W / 2, 0.16, WZ), 0.012, IRON, sides=5)
forge.build()

# The anvil on its stump, with a bar of hot iron on it. Still, but a part of its own with its
# origin on the anvil's face: that is where the smith strikes and the sparks fly from.
AX, AZ = 0.42, 0.14
anvil = Part(YARD, 'anvil', (AX, 0.22, AZ))
cylinder(anvil, (AX, 0, AZ), (AX, 0.14, AZ), 0.07, STUMP, sides=8, cap=GRAIN)
box(anvil, (AX, 0.16, AZ), (0.07, 0.04, 0.06), IRON)
box(anvil, (AX, 0.2, AZ), (0.17, 0.04, 0.07), IRON)
cylinder(anvil, (AX + 0.085, 0.2, AZ), (AX + 0.14, 0.205, AZ), 0.02, IRON, sides=5, r2=0.004)
box(anvil, (AX - 0.02, 0.226, AZ + 0.01), (0.09, 0.012, 0.014), HOT, ry=0.4)
anvil.build()

bellows = Part(YARD, 'bellows', (WX + 0.12, 0.2, WZ))    # hinged at the nozzle end
box(bellows, (WX, 0.215, WZ), (0.24, 0.018, 0.12), TIMBER)
box(bellows, (WX - 0.02, 0.2, WZ), (0.18, 0.025, 0.1), DOOR)     # the leather between the boards
box(bellows, (WX - 0.13, 0.225, WZ), (0.04, 0.012, 0.03), TIMBER)  # the handle
bellows.build()

coals = Part(YARD, 'coals', MOUTH)
# The fire seen through the mouth: a glowing back and a bed of coals on the sill.
box(coals, (HX, MOUTH[1], MOUTH[2] - 0.05), (mw - 0.02, mh - 0.02, 0.01), COALS)
for i in range(4):
    box(coals, (HX - 0.045 + i * 0.03, MOUTH[1] - mh / 2 + 0.012, MOUTH[2] - 0.03 - 0.01 * (i % 2)), (0.028, 0.02, 0.03), COALS, ry=i * 0.7)
coals.build()

LANTERN_AT = (LX1 - 0.12, LO - 0.04, Z1 - 0.03)          # its hook under the front beam
lantern = Part(YARD, 'lantern', LANTERN_AT)
lx, ly, lz = LANTERN_AT
box(lantern, (lx, ly - 0.05, lz), (0.006, 0.1, 0.006), IRON)
box(lantern, (lx, ly - 0.11, lz), (0.05, 0.012, 0.05), IRON)
box(lantern, (lx, ly - 0.15, lz), (0.04, 0.07, 0.04), FLAME)
box(lantern, (lx, ly - 0.19, lz), (0.05, 0.012, 0.05), IRON)
lantern.build()

bpy.context.scene['building_height'] = 1.31
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'smithy.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'smithy'})
