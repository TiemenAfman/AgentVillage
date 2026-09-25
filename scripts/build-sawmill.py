"""The sawmill. Rebuild with scripts/blender.mjs --background --python scripts/build-sawmill.py.

Modelled after Ideas/Images to Render: a red-brown plank barn with a front gable, a sign over
the big door and a lamp over the sign; a lean-to on the right full of logs, a stair and a
conveyor on the left, and in front of the door a saw bench standing in its own sawdust. Not yet
placed on the island (Plans/zagerij.md) - it stands on /demo.

Two civic assets, each under the civic budget of 1500:

    civic_sawmill        the barn, the lean-to, the stair, the chimney, the signs, the lamp
    civic_sawmill_yard   the saw bench, the conveyor, the log piles, the sawdust - and the
                         parts that move, which web/js/sawmill.js takes out of the merge and
                         hangs on their own pivots:

        civic_sawmill_yard blade      the circular saw, turning about z at its arbour
        civic_sawmill_yard log        the log fed through it along +x, from where it lies here
                                      to as far past the blade as it starts before it
        civic_sawmill_yard roller <n> the conveyor's rollers, each turning about z
        civic_sawmill_yard billet     a split log carried up the belt, bottom roller to top

Every moving part has its Blender origin on its own axis, so its baked `at` is the pivot and
nothing in JS says where an axle is. They live inside the yard rather than as assets of their
own because an asset has to stand on the ground (scripts/model-rules.mjs) and a saw blade at
bench height does not.

The lettering on the reference cannot be drawn - there are no textures - so a sign is a board
with a darker inlay where the words would be. Plank walls take the plank sheet, which draws
the boards; the roof is planks too, painted red, because the tile sheet would put a cottage's
tiles on a mill. Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/sawmill'
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


WALL = material('plank', 'mill boards', 0x9a5a3a)
WALL_Z = material('plankZ', 'mill boards', 0x9a5a3a)
TRIM = material('plank', 'mill trim', 0x5e3824)
ROOF = material('plank', 'mill roof', 0xa8432e)
DARK = material('plain', 'mill inside', 0x2e2019)
SIGN = material('plank', 'mill sign', 0xc99b65)
INLAY = material('plain', 'mill lettering', 0x6b4128)
LAMP = material('plain', 'mill lamp', 0xffd58a, emissive=True)
IRON = material('plain', 'mill iron', 0x5c6166)
STEEL = material('plain', 'mill steel', 0xb9bec3)
BELT = material('plain', 'mill belt', 0x333336)
BARK = material('plain', 'mill bark', 0x7a4a2a)
GRAIN = material('plain', 'mill end grain', 0xd9a86c)
BOARD = material('plank', 'mill fresh boards', 0xd6a871)
DUST = material('plain', 'mill sawdust', 0xe2c38d)


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


def basis(d):
    d = d.normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def cylinder(part, a, b, r, mat, sides=6, cap=None, turn=0.0):
    """A prism from a to b. `cap` is the material of its two ends, or None for open ends."""
    a, b = Vector(a), Vector(b)
    u, v = basis(b - a)
    ring = lambda c: [c + (u * math.cos(t) + v * math.sin(t)) * r
                      for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap is not None:
        part.add(ring(a), [list(range(sides))[::-1]], cap)
        part.add(ring(b), [list(range(sides))], cap)


def log(part, a, b, r, turn=0.0):
    cylinder(part, a, b, r, BARK, sides=6, cap=GRAIN, turn=turn)


def disc(part, centre, radii, width, mat):
    """A flat plate about the z axis through `radii` - the saw blade."""
    c, n = Vector(centre), len(radii)
    ring = lambda dz: [c + Vector((math.cos(2 * math.pi * i / n) * r, math.sin(2 * math.pi * i / n) * r, dz))
                       for i, r in enumerate(radii)]
    part.add(ring(-width / 2) + ring(width / 2),
             [list(range(n))[::-1], list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], mat)


def slab(part, outline, y0, y1, mat):
    """A flat shape standing on the ground: an (x, z) outline raised from y0 to y1."""
    n = len(outline)
    pts = [(x, y0, z) for x, z in outline] + [(x, y1, z) for x, z in outline]
    part.add(pts, [list(range(n)), list(range(n, 2 * n))[::-1]] + [[i, n + i, n + (i + 1) % n, (i + 1) % n] for i in range(n)], mat)


# ---- the barn -----------------------------------------------------------------------
BARN = collection('civic_sawmill')
W, BACK, FRONT = 0.55, -0.65, 0.45        # half-width, back and front wall faces
EAVES, RIDGE = 0.78, 1.28
DOOR_W, DOOR_H = 0.32, 0.56
T = 0.04                                   # wall thickness

walls = Part(BARN, 'walls')
box(walls, (0, EAVES / 2, BACK + T / 2), (2 * W, EAVES, T), WALL)
for side in (-1, 1):
    box(walls, (side * (W - T / 2), EAVES / 2, (BACK + FRONT) / 2), (T, EAVES, FRONT - BACK), WALL_Z)
    # the front wall either side of the big door
    jamb = (W - DOOR_W) / 2
    box(walls, (side * (DOOR_W + jamb / 2 + 0.0), EAVES / 2, FRONT - T / 2), (W - DOOR_W, EAVES, T), WALL)
box(walls, (0, (EAVES + DOOR_H) / 2, FRONT - T / 2), (2 * DOOR_W, EAVES - DOOR_H, T), WALL)
# The gables, front and back: a triangle of boards between the eaves and the ridge.
for z in (BACK, FRONT - T):
    walls.add([(-W, EAVES, z), (W, EAVES, z), (0, RIDGE, z), (-W, EAVES, z + T), (W, EAVES, z + T), (0, RIDGE, z + T)],
              [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3]], WALL)
walls.build()

frame = Part(BARN, 'frame')
# Corner posts and the door's frame, the dark timber that draws the barn's outline.
for x in (-W, W):
    for z in (BACK, FRONT):
        box(frame, (x, EAVES / 2, z), (0.06, EAVES, 0.06), TRIM)
for side in (-1, 1):
    box(frame, (side * (DOOR_W + 0.02), DOOR_H / 2, FRONT + 0.005), (0.045, DOOR_H, 0.05), TRIM)
box(frame, (0, DOOR_H + 0.025, FRONT + 0.005), (2 * DOOR_W + 0.09, 0.05, 0.055), TRIM)
box(frame, (0, EAVES + 0.01, FRONT + 0.005), (2 * W + 0.06, 0.035, 0.05), TRIM)
# The dark inside behind the door, and what is piled in there.
box(frame, (0, 0.006, (BACK + FRONT) / 2), (2 * W - 2 * T, 0.012, FRONT - BACK - 2 * T), DARK)
box(frame, (0, EAVES / 2, BACK + T + 0.004), (2 * W - 2 * T, EAVES, 0.008), DARK)
for i, (x, y) in enumerate(((-0.14, 0.045), (0.0, 0.045), (0.14, 0.045), (-0.07, 0.12), (0.07, 0.12))):
    log(frame, (x, y, BACK + 0.12), (x, y, 0.1), 0.042, turn=i * 0.4)
frame.build()

roof = Part(BARN, 'roof')
pitch = math.atan2(RIDGE - EAVES, W)
span = math.hypot(W, RIDGE - EAVES) + 0.1
depth = FRONT - BACK + 0.16
for side in (-1, 1):
    # Halfway down the pitch, lifted half a board off the rafters.
    box(roof, (side * W / 2, (EAVES + RIDGE) / 2 + 0.022, (BACK + FRONT) / 2), (span, 0.035, depth), ROOF, rz=-side * pitch)
box(roof, (0, RIDGE + 0.035, (BACK + FRONT) / 2), (0.06, 0.03, depth + 0.01), TRIM)
# The chimney: a stovepipe through the left pitch, with a cap. The smoke comes out of its top.
pipe_x, pipe_z = -0.26, -0.36
cylinder(roof, (pipe_x, 0.9, pipe_z), (pipe_x, 1.5, pipe_z), 0.035, IRON, sides=8)
cylinder(roof, (pipe_x, 1.5, pipe_z), (pipe_x, 1.54, pipe_z), 0.05, IRON, sides=8, cap=IRON)
roof.build()

lean = Part(BARN, 'lean-to')
# The open shed on the right, its roof falling away from the barn, full of long logs.
LX0, LX1, LZ0, LZ1 = W, 1.0, -0.58, 0.36
hi, lo = 0.64, 0.46
box(lean, ((LX0 + LX1) / 2 + 0.02, (hi + lo) / 2 + 0.02, (LZ0 + LZ1) / 2),
    (math.hypot(LX1 - LX0 + 0.08, hi - lo), 0.03, LZ1 - LZ0 + 0.1), ROOF, rz=-math.atan2(hi - lo, LX1 - LX0))
for z in (LZ0, (LZ0 + LZ1) / 2, LZ1):
    box(lean, (LX1 - 0.02, lo / 2, z), (0.045, lo, 0.045), TRIM)
box(lean, (LX1 - 0.02, lo - 0.02, (LZ0 + LZ1) / 2), (0.05, 0.04, LZ1 - LZ0), TRIM)
for row, (count, y) in enumerate(((4, 0.045), (3, 0.125), (2, 0.2))):
    for i in range(count):
        x = W + 0.09 + (i + row * 0.5) * 0.085
        log(lean, (x, y, LZ0 + 0.04), (x, y, LZ1 - 0.04), 0.042, turn=(row + i) * 0.5)
lean.build()

stair = Part(BARN, 'stair')
# Up the left wall to a side door: a landing on two posts, four steps down to the front.
SX0, SX1, LAND = -W - 0.24, -W, 0.3
box(stair, ((SX0 + SX1) / 2, LAND, 0.1), (SX1 - SX0, 0.03, 0.2), TRIM)
for z in (0.02, 0.18):
    box(stair, (SX0 + 0.02, LAND / 2, z), (0.035, LAND, 0.035), TRIM)
for i in range(4):
    y = LAND - (i + 1) * LAND / 5
    box(stair, ((SX0 + SX1) / 2, y, 0.23 + i * 0.06), (SX1 - SX0 - 0.02, 0.022, 0.055), TRIM)
for x in (SX0 + 0.005, SX1 - 0.01):
    box(stair, (x, LAND / 2 + 0.04, 0.33), (0.018, 0.018, 0.33), TRIM, rx=math.atan2(LAND, 0.3))
cylinder(stair, (SX0 + 0.01, LAND, 0.02), (SX0 + 0.01, LAND + 0.2, 0.02), 0.01, TRIM, sides=4)
cylinder(stair, (SX0 + 0.01, LAND + 0.2, 0.02), (SX0 + 0.01, LAND + 0.2, 0.2), 0.01, TRIM, sides=4)
box(stair, (-W - 0.004, LAND + 0.16, 0.1), (0.012, 0.3, 0.14), DARK)       # the side door
box(stair, (-W - 0.006, 0.5, -0.35), (0.012, 0.13, 0.16), DARK)            # where the belt goes in
stair.build()

signs = Part(BARN, 'signs')
# Over the door, on the gable, and a smaller one on the left wall: boards with a dark inlay
# where the words are painted - there is no lettering without a texture.
box(signs, (0, 0.95, FRONT + 0.012), (0.5, 0.17, 0.025), SIGN)
box(signs, (0, 0.95, FRONT + 0.026), (0.38, 0.06, 0.006), INLAY)
box(signs, (0, 0.95, FRONT + 0.03), (0.5, 0.012, 0.012), TRIM)
box(signs, (-W - 0.012, 0.64, -0.1), (0.022, 0.1, 0.26), SIGN)
box(signs, (-W - 0.025, 0.64, -0.1), (0.006, 0.04, 0.19), INLAY)
# The lamp over the sign, which lights up after dark.
box(signs, (0, 1.12, FRONT + 0.04), (0.012, 0.012, 0.08), IRON)
box(signs, (0, 1.1, FRONT + 0.08), (0.06, 0.03, 0.05), IRON)
box(signs, (0, 1.078, FRONT + 0.08), (0.04, 0.014, 0.034), LAMP)
signs.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((pipe_x, 1.6, pipe_z))
BARN.objects.link(smoke)

# ---- the yard -----------------------------------------------------------------------
YARD = collection('civic_sawmill_yard')
BENCH_Y, BENCH_Z, BENCH_X0, BENCH_X1 = 0.2, 0.82, -0.2, 0.86
BLADE_X, BLADE_R = 0.32, 0.095

bench = Part(YARD, 'bench')
for x in (BENCH_X0 + 0.05, BENCH_X1 - 0.05):
    for dz in (-0.08, 0.08):
        box(bench, (x, BENCH_Y / 2, BENCH_Z + dz), (0.035, BENCH_Y, 0.035), IRON)
    box(bench, (x, 0.06, BENCH_Z), (0.03, 0.03, 0.16), IRON)
box(bench, ((BENCH_X0 + BENCH_X1) / 2, BENCH_Y - 0.01, BENCH_Z), (BENCH_X1 - BENCH_X0, 0.03, 0.2), IRON)
for dz in (-0.095, 0.095):
    box(bench, ((BENCH_X0 + BENCH_X1) / 2, BENCH_Y + 0.012, BENCH_Z + dz), (BENCH_X1 - BENCH_X0, 0.018, 0.018), STEEL)
# the motor under the blade, and the guard over it
box(bench, (BLADE_X, 0.11, BENCH_Z), (0.12, 0.1, 0.1), IRON)
cylinder(bench, (BLADE_X, 0.11, BENCH_Z + 0.05), (BLADE_X, 0.11, BENCH_Z + 0.075), 0.03, STEEL, sides=8, cap=STEEL)
box(bench, (BLADE_X, BENCH_Y + 0.14, BENCH_Z - 0.02), (0.14, 0.012, 0.03), IRON)
box(bench, (BLADE_X + 0.065, BENCH_Y + 0.075, BENCH_Z - 0.02), (0.012, 0.13, 0.012), IRON)
bench.build()

blade = Part(YARD, 'blade', (BLADE_X, BENCH_Y + 0.03, BENCH_Z))
disc(blade, blade.origin, [BLADE_R if i % 2 else BLADE_R - 0.012 for i in range(24)], 0.006, STEEL)
cylinder(blade, blade.origin + Vector((0, 0, -0.008)), blade.origin + Vector((0, 0, 0.008)), 0.014, IRON, sides=6, cap=IRON)
blade.build()

# The log on the bench, fed through the blade. It lies as far before the blade as it will end
# up past it (web/js/sawmill.js reads the travel off the two origins).
LOG_R = 0.038
feed = Part(YARD, 'log', (BLADE_X - 0.36, BENCH_Y + 0.021 + LOG_R, BENCH_Z))
log(feed, feed.origin + Vector((-0.15, 0, 0)), feed.origin + Vector((0.15, 0, 0)), LOG_R)
feed.build()

# ---- the conveyor, on the left: from the split-log pile up into the wall ----------------
BELT_A = Vector((-1.2, 0.12, -0.35))
BELT_B = Vector((-W - 0.03, 0.5, -0.35))
run = BELT_B - BELT_A
tilt = math.atan2(run.y, run.x)
belt = Part(YARD, 'belt')
box(belt, (BELT_A + BELT_B) / 2, (run.length + 0.04, 0.02, 0.13), BELT, rz=tilt)
for dz in (-0.07, 0.07):
    box(belt, (BELT_A + BELT_B) / 2 + Vector((0, -0.015, dz)), (run.length + 0.06, 0.035, 0.012), IRON, rz=tilt)
for k in (0.25, 0.75):
    foot = BELT_A + run * k
    for dz in (-0.06, 0.06):
        box(belt, (foot.x, (foot.y - 0.03) / 2, foot.z + dz), (0.025, foot.y - 0.03, 0.025), TRIM)
belt.build()
ROLLERS = 4
for i in range(ROLLERS):
    at = BELT_A + run * (i / (ROLLERS - 1)) + Vector((0, -0.02, 0))
    roller = Part(YARD, f'roller {i}', at)
    cylinder(roller, at + Vector((0, 0, -0.078)), at + Vector((0, 0, 0.078)), 0.018, STEEL, sides=6, cap=IRON)
    roller.build()
billet = Part(YARD, 'billet', BELT_A + Vector((0, 0.04, 0)))
log(billet, billet.origin + Vector((0, 0, -0.045)), billet.origin + Vector((0, 0, 0.045)), 0.028)
billet.build()

piles = Part(YARD, 'piles')
# The split logs at the foot of the belt, short and stacked end-on.
for row, (count, y) in enumerate(((4, 0.028), (3, 0.08), (2, 0.132))):
    for i in range(count):
        z = -0.55 + (i + row * 0.5) * 0.06 + 0.05
        log(piles, (-1.42, y, z), (-1.26, y, z), 0.028, turn=(i + row) * 0.7)
# The long logs out in the open on the right, and two that rolled off the pile.
for row, (count, y) in enumerate(((3, 0.045), (2, 0.125), (1, 0.205))):
    for i in range(count):
        z = -0.46 + (i + row * 0.5) * 0.09
        log(piles, (1.07, y, z), (1.42, y, z), 0.045, turn=(i + row) * 0.3)
log(piles, (0.95, 0.04, 0.42), (1.35, 0.04, 0.52), 0.04)
log(piles, (0.8, 0.04, 0.62), (1.18, 0.04, 0.58), 0.04, turn=0.5)
# Fresh boards leant against the front wall, right of the door, and one lying by the bench.
for i, x in enumerate((0.38, 0.45)):
    box(piles, (x, 0.2, FRONT + 0.04), (0.05, 0.4, 0.012), BOARD, rx=-0.12, rz=0.05 * i)
box(piles, (0.0, 0.009, 1.08), (0.42, 0.018, 0.05), BOARD, ry=0.18)
piles.build()

dust = Part(YARD, 'sawdust')
# A drift of sawdust round the bench, thickest under the blade.
outline = [(BLADE_X + math.cos(a) * rx, BENCH_Z + 0.02 + math.sin(a) * rz)
           for a, rx, rz in ((2 * math.pi * i / 14, 0.52 + 0.1 * math.sin(i * 2.3), 0.3 + 0.06 * math.cos(i * 1.7))
                             for i in range(14))]
slab(dust, outline, 0.0, 0.006, DUST)
dust.add([(BLADE_X + math.cos(2 * math.pi * i / 7) * 0.13, 0.006, BENCH_Z + math.sin(2 * math.pi * i / 7) * 0.1) for i in range(7)]
         + [(BLADE_X, 0.05, BENCH_Z)], [[i, 7, (i + 1) % 7] for i in range(7)], DUST)
dust.build()

bpy.context.scene['building_height'] = 1.54
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'sawmill.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'sawmill'})
