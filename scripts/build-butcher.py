"""The butcher's. Rebuild with scripts/blender.mjs --background --python scripts/build-butcher.py.

The smithy's sister (scripts/build-smithy.py, Plans/slagerij.md): the same small half-timbered
house - cream plaster between brown timbers, stone feet at the corners, a dark slate roof with a
dormer and a stone chimney - but a shop: a wide window over a marble counter laid with meat,
a red-and-white awning over it, an ox-blood door, and a hanging sign with a pig on it at the
front corner, since a board with no letters has to say what it sells some other way. Beside it,
where the smithy has its lean-to, the work: a tall, narrow smokehouse on a stone foot with a
vent on its ridge and a fire smouldering in its base, a rack where two hams and a ring of
sausage hang to dry, and in front of it all the chopping block with a joint on it and a tub
beside it. Not yet placed on the island - it stands on /demo, like the sawmill and the smithy.

Two civic assets, each under the civic budget of 1500:

    civic_butcher        the house: frame, walls, shop front, counter and its meat, roof, dormer,
                         chimney, door, steps, the brine barrel, and the sign's iron bracket
    civic_butcher_yard   the smokehouse, the rack, the block and the tub - and every part that
                         moves, the awning and the sign included although they hang on the house,
                         so one rule (isButcherMoving) takes them all out of the merge and the
                         house stays one still thing. web/js/butcher.js hangs them:

        civic_butcher_yard awning    the awning, hinged at its roller box; it rolls in at night
        civic_butcher_yard sign      the sign board, hung from the bracket, swinging about x
        civic_butcher_yard hang 0-2  a ham, a ring of sausage, a ham, each from its own hook
        civic_butcher_yard joint     the meat on the block, which gives a little at each chop
        civic_butcher_yard slice     one slice as it comes off - butcher.js makes its three
        civic_butcher_yard embers    the fire in the smokehouse's base, which breathes

    and two that do not move but are measured: `civic_butcher_yard block`, whose origin is the
    block's top - where the cleaver lands - and `civic_butcher_yard vent`, whose origin is where
    the smoke comes out. The house's `anchor.door` is where the butcher goes in at night.

As in build-smithy.py, a moving part lives inside an asset that stands on the ground, with its
origin on its own axis, so its baked `at` is the pivot. The butcher is not drawn: there is no
figure in a baked set.

Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the
timber the plank sheets, so the island's own textures draw the courses and the boards. The
canvas, the meat and the marble are plain: tiled, they would read as a roof. The shop window is
the island's amber glass (build-tavern.py's), which lights at dusk - he is inside by then.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/butcher'
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


# The house keeps the smithy's own colours, so the two read as one street.
PLASTER = material('wall', 'butcher plaster', 0xe6dcc6)
TIMBER = material('plank', 'butcher timber', 0x7a4f2c)
TIMBER_Z = material('plankZ', 'butcher timber', 0x7a4f2c)
SLATE = material('roof', 'butcher slate', 0x3e4046)
STONE = material('stone', 'butcher stone', 0x8e9093)
DOOR = material('plank', 'butcher door', 0x7a2a22)          # ox-blood, the shop's own colour
IRON = material('plain', 'butcher iron', 0x303236)
AMBER = material('plain', 'butcher window', 0xffcb75, emissive=True)
DARK = material('plain', 'butcher dark', 0x2b2a2e)
MARBLE = material('plain', 'butcher marble', 0xdedad2)
ENAMEL = material('plain', 'butcher enamel', 0xf2efe8)
MEAT = material('plain', 'butcher meat', 0xc0484c)
FAT = material('plain', 'butcher fat', 0xf1e4d6)
HAM = material('plain', 'butcher ham', 0x9c4a32)
SAUSAGE = material('plain', 'butcher sausage', 0x8b3a2a)
BONE = material('plain', 'butcher bone', 0xeee6d6)
RED = material('plain', 'butcher red canvas', 0xb3322a)
WHITE = material('plain', 'butcher white canvas', 0xf2ece0)
PAINT = material('plain', 'butcher sign paint', 0xe9dcbf)
PIG = material('plain', 'butcher pig', 0xe8a0a4)
SNOUT = material('plain', 'butcher snout', 0xcf7d86)
SMOKED = material('plank', 'butcher smoked boards', 0x5a3b26)   # boards gone dark in the smoke
SMOKED_Z = material('plankZ', 'butcher smoked boards', 0x5a3b26)
GRAIN = material('plain', 'butcher end grain', 0xc98f55)
STUMP = material('plain', 'butcher block', 0x8a5a34)
EMBER = material('plain', 'butcher embers', 0xff7a2e, emissive=True)


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
    """A square timber from a to b, `t` thick - a brace or a stay."""
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


def gable_z(part, x0, x1, y0, y1, z0, z1, mat):
    """A gable end facing +z and -z, its ridge over the middle of x0..x1: a triangular slab
    from z0 to z1. Only the two faces - the slopes are under the roof."""
    xm = (x0 + x1) / 2
    part.add([(x0, y0, z1), (x1, y0, z1), (xm, y1, z1), (x0, y0, z0), (x1, y0, z0), (xm, y1, z0)],
             [[0, 1, 2], [3, 5, 4]], mat)


# ---- the house ------------------------------------------------------------------------
HOUSE = collection('civic_butcher')
# A little longer than the smithy's (0.82): the front has to hold a shop window and a door.
X0, X1, Z0, Z1 = -0.78, 0.22, -0.42, 0.34       # the house's walls; the ridge runs along x
EAVES, RIDGE = 0.64, 1.08
MIDZ = (Z0 + Z1) / 2
T = 0.04

walls = Part(HOUSE, 'walls')
box(walls, ((X0 + X1) / 2, 0.06 + (EAVES - 0.06) / 2, Z1 - T / 2), (X1 - X0, EAVES - 0.06, T), PLASTER)
box(walls, ((X0 + X1) / 2, 0.06 + (EAVES - 0.06) / 2, Z0 + T / 2), (X1 - X0, EAVES - 0.06, T), PLASTER)
for x in (X0 + T / 2, X1 - T / 2):
    box(walls, (x, 0.06 + (EAVES - 0.06) / 2, MIDZ), (T, EAVES - 0.06, Z1 - Z0), PLASTER)
    walls.add([(x - T / 2, EAVES, Z0), (x - T / 2, EAVES, Z1), (x - T / 2, RIDGE, MIDZ),
               (x + T / 2, EAVES, Z0), (x + T / 2, EAVES, Z1), (x + T / 2, RIDGE, MIDZ)],
              [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1]], PLASTER)
walls.build()

DOOR_X, DOOR_W, DOOR_H = 0.0, 0.22, 0.44
WIN_X, WIN_W = -0.46, 0.4                      # the shop window, left of the door
SILL, HEAD = 0.26, 0.5                          # the counter's top and the pane's top

frame = Part(HOUSE, 'frame')
# The half-timbering, as on the smithy: corner posts on stone feet, rails at the eaves and the
# sill, posts either side of the door and of the shop window, and a cross on each gable.
for x in (X0, X1):
    for z in (Z0, Z1):
        box(frame, (x, 0.08 / 2, z), (0.1, 0.08, 0.1), STONE)
        box(frame, (x, (0.08 + EAVES) / 2, z), (0.055, EAVES - 0.08, 0.055), TIMBER)
for z in (Z0, Z1):
    box(frame, ((X0 + X1) / 2, EAVES - 0.02, z + (0.012 if z == Z1 else -0.012)), (X1 - X0 + 0.08, 0.045, 0.03), TIMBER)
    box(frame, ((X0 + X1) / 2, 0.08, z + (0.012 if z == Z1 else -0.012)), (X1 - X0, 0.035, 0.03), TIMBER)
for x in (X0, X1):
    box(frame, (x + (0.012 if x == X1 else -0.012), EAVES - 0.02, MIDZ), (0.03, 0.045, Z1 - Z0), TIMBER_Z)
for x in (DOOR_X - DOOR_W / 2 - 0.02, DOOR_X + DOOR_W / 2 + 0.02, WIN_X - WIN_W / 2 - 0.02, WIN_X + WIN_W / 2 + 0.02):
    box(frame, (x, (0.08 + EAVES) / 2, Z1 + 0.012), (0.04, EAVES - 0.1, 0.03), TIMBER)
box(frame, (DOOR_X, 0.08 + DOOR_H + 0.02, Z1 + 0.014), (DOOR_W + 0.08, 0.04, 0.035), TIMBER)
box(frame, (WIN_X, HEAD + 0.02, Z1 + 0.014), (WIN_W + 0.08, 0.04, 0.035), TIMBER)
for x in (X0 - 0.012, X1 + 0.012):
    beam(frame, (x, EAVES, Z0 + 0.06), (x, RIDGE - 0.1, MIDZ), 0.03, TIMBER_Z)
    beam(frame, (x, EAVES, Z1 - 0.06), (x, RIDGE - 0.1, MIDZ), 0.03, TIMBER_Z)
    box(frame, (x, (EAVES + RIDGE) / 2 - 0.05, MIDZ), (0.03, RIDGE - EAVES - 0.05, 0.035), TIMBER_Z)
frame.build()

front = Part(HOUSE, 'front')
# The plank door, its iron straps and ring, and the stone steps up to it.
box(front, (DOOR_X, 0.08 + DOOR_H / 2, Z1 + 0.006), (DOOR_W, DOOR_H, 0.02), DOOR)
for y in (0.16, 0.42):
    box(front, (DOOR_X, y, Z1 + 0.018), (DOOR_W - 0.02, 0.018, 0.006), IRON)
cylinder(front, (DOOR_X - 0.06, 0.3, Z1 + 0.02), (DOOR_X - 0.06, 0.3, Z1 + 0.03), 0.018, IRON, sides=6, cap=IRON)
for i, (w, d) in enumerate(((0.34, 0.16), (0.26, 0.09))):
    box(front, (DOOR_X, 0.02 + i * 0.035, Z1 + 0.02 + d / 2), (w, 0.04, d), STONE)
# The shop window: one wide amber pane in four lights over a red-panelled stall board, and the
# marble counter standing out in front of it on two brackets. The roller box the awning lives
# in sits between the window's head and the eaves rail.
box(front, (WIN_X, (SILL + HEAD) / 2, Z1 + 0.004), (WIN_W, HEAD - SILL, 0.012), AMBER)
box(front, (WIN_X, (SILL + HEAD) / 2, Z1 + 0.012), (0.018, HEAD - SILL, 0.008), TIMBER)
box(front, (WIN_X, HEAD - 0.07, Z1 + 0.012), (WIN_W, 0.016, 0.008), TIMBER)
box(front, (WIN_X, 0.08 + (SILL - 0.1) / 2 + 0.01, Z1 + 0.01), (WIN_W, SILL - 0.1, 0.02), DOOR)
box(front, (WIN_X, SILL - 0.0125, Z1 + 0.06), (WIN_W + 0.06, 0.025, 0.13), MARBLE)
for x in (WIN_X - 0.15, WIN_X + 0.15):
    beam(front, (x, 0.15, Z1 + 0.02), (x, SILL - 0.03, Z1 + 0.1), 0.02, TIMBER)
ROLLER_Y = 0.575
box(front, (WIN_X, ROLLER_Y, Z1 + 0.025), (WIN_W + 0.1, 0.045, 0.05), DOOR)
front.build()

shop = Part(HOUSE, 'display')
# What is out on the counter: two chops on an enamel tray, a ham with its bone showing, and a
# row of sausages along the front edge.
top = SILL
box(shop, (WIN_X - 0.1, top + 0.004, Z1 + 0.065), (0.14, 0.008, 0.08), ENAMEL)
for i, (dx, ry) in enumerate(((-0.13, 0.3), (-0.07, -0.25))):
    box(shop, (WIN_X + dx, top + 0.015, Z1 + 0.065), (0.052, 0.014, 0.042), MEAT, ry=ry)
cylinder(shop, (WIN_X + 0.03, top + 0.03, Z1 + 0.06), (WIN_X + 0.13, top + 0.024, Z1 + 0.06), 0.03, HAM, sides=6, cap=HAM, r2=0.017)
cylinder(shop, (WIN_X + 0.13, top + 0.024, Z1 + 0.06), (WIN_X + 0.155, top + 0.024, Z1 + 0.06), 0.008, BONE, sides=5, cap=BONE)
for i in range(3):
    x = WIN_X - 0.03 + i * 0.058
    cylinder(shop, (x, top + 0.012, Z1 + 0.108), (x + 0.052, top + 0.012, Z1 + 0.108), 0.012, SAUSAGE, sides=5, cap=SAUSAGE)
shop.build()

roof = Part(HOUSE, 'roof')
pitch = math.atan2(RIDGE - EAVES, (Z1 - Z0) / 2)
span = math.hypot((Z1 - Z0) / 2, RIDGE - EAVES) + 0.12
length = X1 - X0 + 0.14
for side in (-1, 1):
    box(roof, ((X0 + X1) / 2, (EAVES + RIDGE) / 2 + 0.03, MIDZ + side * (Z1 - Z0) / 4 + side * 0.02),
        (length, 0.04, span), SLATE, rx=side * pitch)
box(roof, ((X0 + X1) / 2, RIDGE + 0.04, MIDZ), (length + 0.02, 0.05, 0.06), TIMBER)
# The dormer, as the smithy's, over the middle of the house - lit like the shop window, since
# the butcher lives over the shop.
DX, DZ, DY = (X0 + X1) / 2, 0.25, 0.8
box(roof, (DX, DY, DZ), (0.16, 0.16, 0.14), PLASTER)
box(roof, (DX, DY + 0.01, DZ + 0.071), (0.1, 0.09, 0.006), AMBER)
box(roof, (DX, DY + 0.01, DZ + 0.076), (0.012, 0.09, 0.004), TIMBER)
box(roof, (DX, DY + 0.01, DZ + 0.076), (0.1, 0.012, 0.004), TIMBER)
box(roof, (DX, DY - 0.045, DZ + 0.078), (0.13, 0.02, 0.02), TIMBER)
for side in (-1, 1):
    box(roof, (DX + side * 0.05, DY + 0.105, DZ + 0.01), (0.12, 0.025, 0.18), SLATE, rz=-side * 0.62)
CX, CZ = -0.6, MIDZ - 0.12
box(roof, (CX, 0.95, CZ), (0.15, 0.62, 0.15), STONE)
box(roof, (CX, 1.28, CZ), (0.19, 0.05, 0.19), STONE)
roof.build()

cask = Part(HOUSE, 'brine barrel')
# Against the left gable, where the smithy keeps its logs: the brine barrel with its lid on, and
# a crate beside it.
BRX, BRZ = X0 - 0.12, 0.12
cylinder(cask, (BRX, 0, BRZ), (BRX, 0.19, BRZ), 0.066, TIMBER_Z, sides=8, r2=0.07)
cylinder(cask, (BRX, 0.19, BRZ), (BRX, 0.205, BRZ), 0.064, TIMBER, sides=8, cap=TIMBER)
for y in (0.04, 0.15):
    cylinder(cask, (BRX, y, BRZ), (BRX, y + 0.014, BRZ), 0.07 + (y - 0.04) * 0.04, IRON, sides=8)
box(cask, (X0 - 0.1, 0.06, -0.14), (0.12, 0.12, 0.14), TIMBER_Z)
for y in (0.025, 0.095):
    box(cask, (X0 - 0.1, y, -0.14), (0.125, 0.012, 0.145), IRON)
cask.build()

bracket = Part(HOUSE, 'sign bracket')
# The iron arm the sign hangs from, out of the front left corner post, with its stay. The stay
# is short and steep, close to the post: a longer one would run through the board.
ARM_Y, ARM_L = 0.6, 0.32
box(bracket, (X0 - ARM_L / 2, ARM_Y, Z1), (ARM_L, 0.014, 0.014), IRON)
beam(bracket, (X0 - 0.02, ARM_Y - 0.08, Z1), (X0 - 0.08, ARM_Y - 0.004, Z1), 0.01, IRON)
box(bracket, (X0 - ARM_L + 0.004, ARM_Y + 0.012, Z1), (0.014, 0.03, 0.014), IRON)
bracket.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((CX, 1.36, CZ))
HOUSE.objects.link(smoke)
# Where the butcher goes in at night and comes out in the morning (web/js/butcher.js).
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DOOR_X, 0, Z1 + 0.1))
HOUSE.objects.link(door)

# ---- the yard: the smokehouse, the rack, the block ------------------------------------
YARD = collection('civic_butcher_yard')

# The smokehouse, back right, its gable to the front.
SX0, SX1, SZ0, SZ1 = 0.42, 0.72, -0.42, -0.12
SX, SZC = (SX0 + SX1) / 2, (SZ0 + SZ1) / 2
BASE, SW, SR = 0.12, 0.6, 0.8                   # the stone foot, the eaves, the ridge
house = Part(YARD, 'smokehouse')
box(house, (SX, BASE / 2, SZC), (SX1 - SX0 + 0.04, BASE, SZ1 - SZ0 + 0.04), STONE)
box(house, (SX, (BASE + SW) / 2, SZ1 - T / 2), (SX1 - SX0, SW - BASE, T), SMOKED)
box(house, (SX, (BASE + SW) / 2, SZ0 + T / 2), (SX1 - SX0, SW - BASE, T), SMOKED)
for x in (SX0 + T / 2, SX1 - T / 2):
    box(house, (x, (BASE + SW) / 2, SZC), (T, SW - BASE, SZ1 - SZ0 - 2 * T), SMOKED_Z)
gable_z(house, SX0, SX1, SW, SR, SZ1 - T, SZ1, SMOKED)
gable_z(house, SX0, SX1, SW, SR, SZ0, SZ0 + T, SMOKED)
spitch = math.atan2(SR - SW, (SX1 - SX0) / 2)
sspan = math.hypot((SX1 - SX0) / 2, SR - SW) + 0.07
for side in (-1, 1):
    box(house, (SX + side * ((SX1 - SX0) / 4 + 0.018), (SW + SR) / 2 + 0.025, SZC),
        (sspan, 0.035, SZ1 - SZ0 + 0.1), SLATE, rz=-side * spitch)
box(house, (SX, SR + 0.03, SZC), (0.05, 0.04, SZ1 - SZ0 + 0.1), TIMBER_Z)
# Its door, strapped, above the stone foot; and in the foot the mouth of the fire, a dark
# opening under a stone lintel. The glow inside is the `embers` part.
box(house, (SX, BASE + 0.16, SZ1 + 0.006), (0.14, 0.3, 0.018), TIMBER)
for y in (BASE + 0.06, BASE + 0.26):
    box(house, (SX, y, SZ1 + 0.017), (0.12, 0.016, 0.006), IRON)
box(house, (SX + 0.05, BASE + 0.16, SZ1 + 0.02), (0.012, 0.03, 0.01), IRON)
FRONT = SZ1 + 0.02                              # the stone foot's front face
MOUTH = (SX, 0.055, FRONT + 0.003)
box(house, (SX, 0.055, FRONT + 0.001), (0.1, 0.07, 0.004), DARK)
box(house, (SX, 0.1, FRONT + 0.008), (0.14, 0.022, 0.018), STONE)
house.build()

VENT = (SX, SR + 0.13, SZC)                     # between the stub's top and its cap
vent = Part(YARD, 'vent', VENT)
# The vent on the ridge: a boarded stub with a slate cap held up on four corner blocks, so the
# smoke comes out from under it on every side.
box(vent, (SX, SR + 0.065, SZC), (0.08, 0.11, 0.08), SMOKED)
for dx in (-0.045, 0.045):
    for dz in (-0.045, 0.045):
        box(vent, (SX + dx, SR + 0.135, SZC + dz), (0.014, 0.03, 0.014), SMOKED)
box(vent, (SX, SR + 0.16, SZC), (0.14, 0.02, 0.14), SLATE)
vent.build()

embers = Part(YARD, 'embers', MOUTH)
box(embers, (SX, 0.055, FRONT + 0.004), (0.08, 0.05, 0.003), EMBER)
for i in range(4):
    box(embers, (SX - 0.03 + i * 0.02, 0.033 + 0.006 * (i % 2), FRONT + 0.007), (0.017, 0.016, 0.008), EMBER, rz=i * 0.5)
embers.build()

# The rack beside it: two posts on stone feet and a beam, where the smoked meat hangs to dry.
RX0, RX1, RZ, RACK = 0.84, 1.18, -0.22, 0.6
rack = Part(YARD, 'rack')
for x in (RX0, RX1):
    box(rack, (x, 0.025, RZ), (0.07, 0.05, 0.07), STONE)
    box(rack, (x, (0.05 + RACK) / 2, RZ), (0.04, RACK - 0.05, 0.04), TIMBER)
box(rack, ((RX0 + RX1) / 2, RACK + 0.012, RZ), (RX1 - RX0 + 0.08, 0.035, 0.035), TIMBER)
beam(rack, (RX0, RACK - 0.11, RZ), (RX0 + 0.09, RACK - 0.005, RZ), 0.022, TIMBER)
beam(rack, (RX1, RACK - 0.11, RZ), (RX1 - 0.09, RACK - 0.005, RZ), 0.022, TIMBER)
rack.build()

HOOK_Y = RACK - 0.006
# Far enough apart that the hams' bellies and the sausage ring never touch: they swing about x,
# along the beam's own line, so nothing moves towards its neighbour.
HOOKS = [RX0 + 0.07, (RX0 + RX1) / 2, RX1 - 0.07]


def ham(part, x, y, s):
    """A ham hanging by its shank: the knuckle of bone at the top, the body swelling below it."""
    box(part, (x, y - 0.015, RZ), (0.005, 0.03, 0.005), IRON)
    cylinder(part, (x, y - 0.03, RZ), (x, y - 0.05, RZ), 0.008 * s, BONE, sides=5, cap=BONE)
    cylinder(part, (x, y - 0.045, RZ), (x, y - 0.045 - 0.1 * s, RZ), 0.02 * s, HAM, sides=6, cap=HAM, r2=0.045 * s)
    cylinder(part, (x, y - 0.045 - 0.1 * s, RZ), (x, y - 0.045 - 0.13 * s, RZ), 0.045 * s, HAM, sides=6, cap=HAM, r2=0.026 * s)


for i, x in enumerate(HOOKS):
    hang = Part(YARD, f'hang {i}', (x, HOOK_Y, RZ))
    if i == 1:
        # A ring of smoked sausage on a string, the way it hangs in every butcher's in the
        # country: a horseshoe of links, its two ends tied up to the hook.
        box(hang, (x, HOOK_Y - 0.012, RZ), (0.005, 0.024, 0.005), IRON)
        r, cy = 0.034, HOOK_Y - 0.1
        pts = [(x - r, HOOK_Y - 0.03)] + [(x + r * math.cos(a), cy + r * math.sin(a))
                                           for a in (math.pi + k * math.pi / 5 for k in range(6))] + [(x + r, HOOK_Y - 0.03)]
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            cylinder(hang, (ax, ay, RZ), (bx, by, RZ), 0.012, SAUSAGE, sides=5)
        for px, py in (pts[0], pts[-1]):
            box(hang, ((px + x) / 2, HOOK_Y - 0.026, RZ), (abs(px - x) + 0.004, 0.004, 0.004), IRON)
    else:
        ham(hang, x, HOOK_Y, 1.0 if i == 0 else 0.88)
    hang.build()

# The chopping block, in front of the smokehouse: a thick end-grain block on four short legs.
# A part of its own with its origin on the block's top, where the cleaver lands. Waist high to
# the butcher (0.72 of a player): at the anvil's 0.22 it was chest high, and the cleaver's
# lowest point in the swing - which is where it has to meet the meat - was inside the wood.
# Shallow front to back, so he can stand close behind it and still reach its middle, and well
# out in front of the smokehouse, so there is room behind him to step back and go round.
BX, BZ, BTOP = 0.56, 0.24, 0.14
BW, BD = 0.22, 0.13
block = Part(YARD, 'block', (BX, BTOP, BZ))
for dx in (-(BW / 2 - 0.03), BW / 2 - 0.03):
    for dz in (-(BD / 2 - 0.025), BD / 2 - 0.025):
        box(block, (BX + dx, 0.045, BZ + dz), (0.035, 0.09, 0.035), STUMP)
box(block, (BX, 0.09 + (BTOP - 0.09) / 2, BZ), (BW, BTOP - 0.09, BD), STUMP)
box(block, (BX, BTOP - 0.002, BZ), (BW - 0.004, 0.004, BD - 0.004), GRAIN)
block.build()

# The joint on it, lying along x with its bone at the far end: its origin is its bottom, where
# it sits on the block, so a squash at the blow keeps it on the wood. A little towards the back
# of the block: the cleaver lands as far in front of him as it lands, and this is what keeps his
# own front off the block's edge while it does.
JX, JZ = BX - 0.04, BZ - 0.02
joint = Part(YARD, 'joint', (JX, BTOP, JZ))
box(joint, (JX, BTOP + 0.017, JZ), (0.1, 0.034, 0.07), MEAT)
box(joint, (JX, BTOP + 0.038, JZ), (0.1, 0.008, 0.07), FAT)
cylinder(joint, (JX - 0.05, BTOP + 0.02, JZ), (JX - 0.07, BTOP + 0.02, JZ), 0.012, BONE, sides=5, cap=BONE)
joint.build()

# One slice as it comes off the cut end and falls flat - with its rind of fat - and its origin
# at its bottom middle. butcher.js makes its three from this.
CUT_X = JX + 0.05
slice_ = Part(YARD, 'slice', (CUT_X + 0.03, BTOP, JZ))
box(slice_, (CUT_X + 0.026, BTOP + 0.006, JZ), (0.032, 0.012, 0.066), MEAT)
box(slice_, (CUT_X + 0.046, BTOP + 0.006, JZ), (0.008, 0.012, 0.066), FAT)
slice_.build()

# The tub the cuts go into, to the right of the block.
TX = BX + 0.2
tub = Part(YARD, 'tub')
cylinder(tub, (TX, 0, BZ), (TX, 0.11, BZ), 0.056, TIMBER, sides=8, r2=0.064)
cylinder(tub, (TX, 0.08, BZ), (TX, 0.081, BZ), 0.058, MEAT, sides=8, cap=MEAT)
for y in (0.02, 0.08):
    cylinder(tub, (TX, y, BZ), (TX, y + 0.012, BZ), 0.058 + y * 0.075, IRON, sides=8)
tub.build()

# The awning, hinged along its roller box: five strips of red and white canvas sloping out over
# the counter, a scalloped valance along the front and a cheek at each end. butcher.js rolls it
# in by scaling it towards the hinge.
HINGE = (WIN_X, ROLLER_Y - 0.015, Z1 + 0.05)
DEPTH, DROP = 0.24, 0.1
AW = WIN_W + 0.08
awning = Part(YARD, 'awning', HINGE)
hx, hy, hz = HINGE
apitch = math.atan2(DROP, DEPTH)
fy, fz = hy - DROP, hz + DEPTH                  # the front edge
for i in range(5):
    x = hx - AW / 2 + AW / 10 + i * AW / 5
    cloth = RED if i % 2 == 0 else WHITE
    box(awning, (x, hy - DROP / 2, hz + DEPTH / 2), (AW / 5, 0.01, math.hypot(DEPTH, DROP)), cloth, rx=apitch)
    box(awning, (x, fy - 0.022, fz), (AW / 5 - 0.006, 0.044, 0.008), cloth)
    box(awning, (x, fy - 0.05, fz), (AW / 5 - 0.05, 0.014, 0.008), cloth)
for x in (hx - AW / 2, hx + AW / 2):
    # Both windings: a cheek is seen from outside and, under the awning, from inside.
    awning.add([(x, fy, hz), (x, fy, fz), (x, hy, hz)], [[0, 1, 2], [0, 2, 1]], RED)
awning.build()

# The sign, hung by two rings from the bracket: a board with a painted panel and, on the
# front, a pig. Its origin is the bracket, which it swings about.
PIVOT = (X0 - 0.2, ARM_Y - 0.007, Z1)
sign = Part(YARD, 'sign', PIVOT)
px, py, pz = PIVOT
for dx in (-0.07, 0.07):
    box(sign, (px + dx, py - 0.012, pz), (0.006, 0.024, 0.006), IRON)
sx, sy = px, py - 0.09
box(sign, (sx, sy, pz), (0.2, 0.13, 0.016), TIMBER)
for side in (-1, 1):
    box(sign, (sx, sy, pz + side * 0.009), (0.172, 0.104, 0.004), PAINT)
z = pz + 0.0125
box(sign, (sx + 0.012, sy - 0.002, z), (0.08, 0.042, 0.004), PIG)            # body
box(sign, (sx - 0.04, sy + 0.006, z), (0.034, 0.034, 0.004), PIG)            # head
box(sign, (sx - 0.061, sy, z + 0.001), (0.012, 0.016, 0.004), SNOUT)
box(sign, (sx - 0.034, sy + 0.027, z), (0.014, 0.014, 0.004), SNOUT, rz=0.785)  # an ear
for dx in (-0.014, 0.036):
    box(sign, (sx + dx, sy - 0.03, z), (0.012, 0.018, 0.004), PIG)          # legs
box(sign, (sx + 0.056, sy + 0.01, z), (0.014, 0.005, 0.004), PIG, rz=0.5)     # the tail
box(sign, (sx - 0.047, sy + 0.012, z + 0.002), (0.006, 0.006, 0.003), IRON)  # an eye
sign.build()

bpy.context.scene['building_height'] = 1.31
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'butcher.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'butcher'})
