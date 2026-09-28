"""The gold mine. Rebuild with scripts/blender.mjs --background --python scripts/build-goldmine.py.

Plans/goudmijn.md: the mine holds the keeper's week - the seven-day usage window as a hundred
lumps of ore in a bin by the mouth, one a percent - and every five hours a cartload of it is
pushed down the road to the goldsmith, whose bars refill the gold pit. So it is a hillock with
a timbered adit in its face, rails running out of the dark onto a trampled apron, the ore bin
beside them, a lantern on a post and a board over the lintel with a pick on it.

Four assets:

    civic_goldmine_hill the hill, its crags and the apron, modelled DATUM too high: every baked
                        model stands with its lowest point on y = 0 (scripts/model-rules.mjs),
                        and this one's lowest point is the rim it buries a third of a unit
                        under the grass. buildings.js lowers it by MINE_DATUM, the shipyard's
                        way (SHIPYARD_LAND), and the two numbers are one number.
    civic_goldmine      the adit, the rails, the bin, the lantern, the board.
                        Two still parts are measured rather than drawn differently:
                          civic_goldmine cartstop   the buffer at the rails' outer end; its
                                                    origin is where the cart stands at rest
                          civic_goldmine bin        the ore bin, origin on its floor in the
                                                    middle: where web/js/goldmine.js heaps the ore
                        and `anchor.door` is the mouth, where the miner goes in at night.
    prop_minecart       the cart, which is not part of the building because it leaves it:
                        web/js/goldrun.js pushes it to the goldsmith and back. Origin on the
                        rails under its middle, running along z.
    prop_goldore        one lump of gold-bearing rock, instanced a hundred times in the bin
                        and a handful in the cart. Origin under its middle.

The hill is a height field rather than a sculpted mesh: a dome behind the mouth, two shoulders
either side of it so the adit is cut into a face rather than leaning on a slope, and a rim that
goes a third of a unit under the ground all round, because the island does not flatten the
ground under a building (web/js/buildings.js, PORCH_*) and a hill that stopped at y = 0 would
show its hem on any slope. Its noise is a hash of the grid index, so a rebuild is the same hill.
Steep faces are rock, flatter ones grass on top, so from the square it reads as a hill with a
rock face rather than a grey blister.

No porch (buildings.js NO_PORCH): a step round a hill is a plinth under a mountain. The apron
carries its own skirt instead.

Written in island coordinates (x right, y up, z to the front) through xyz(), like
build-smithy.py, whose Part class this repeats.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/goldmine'
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


ROCK = material('stone', 'mine rock', 0x8b8174)
ROCK_DARK = material('stone', 'mine crag', 0x6f665b)
TURF = material('ground', 'mine turf', 0x8fa257)
EARTH = material('stone', 'mine spoil', 0x9b8465)
TIMBER = material('plank', 'mine timber', 0x7b5634)
TIMBER_Z = material('plankZ', 'mine timber', 0x7b5634)
SLEEPER = material('plankZ', 'mine sleeper', 0x5e432c)
BIN = material('plank', 'mine bin', 0x8a6040)
BIN_Z = material('plankZ', 'mine bin', 0x8a6040)
DARK = material('plain', 'mine mouth', 0x120d0a)
IRON = material('plain', 'mine iron', 0x4d4f54)
RAIL = material('plain', 'mine rail', 0x6a6c70)
GOLD = material('plain', 'mine vein', 0xf2c14a)
FLAME = material('plain', 'mine lantern', 0xffc860, emissive=True)
BOARD = material('plank', 'mine board', 0x5a3c26)
CART = material('plain', 'minecart iron', 0x5d6168)
CART_RIM = material('plain', 'minecart rim', 0x3c3f45)
WHEEL = material('plain', 'minecart wheel', 0x2b2c30)
ORE_ROCK = material('plain', 'ore rock', 0x7d7163)
ORE_GOLD = material('plain', 'ore gold', 0xf5c449)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, asset, name, origin=(0, 0, 0), lift=0.0):
        # `lift` raises everything by that much, origin and all: what stands on the apron is
        # written as if the apron were the ground and stood up on it here (APRON).
        self.lift = Vector((0, lift, 0))
        self.asset, self.name, self.origin = asset, f'{asset.name} {name}', Vector(origin) + self.lift
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat):
        base, s = len(self.verts), self.slot(mat)
        self.verts.extend(Vector(p) + self.lift - self.origin for p in points)
        for f in faces:
            self.faces.append([base + i for i in f])
            self.mats.append(s)

    def face(self, points, mat):
        self.add(points, [list(range(len(points)))], mat)

    def floor(self):
        """Stand it on its lowest point: a wheel's hexagon or a lump's jittered point never
        lands on y = 0 by itself, and the bake allows two millimetres."""
        low = min(v.y + self.origin.y for v in self.verts)
        for v in self.verts:
            v.y -= low

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


def cylinder(part, a, b, r, mat, sides=6, cap=None, turn=0.0):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(t) + v * math.sin(t)) * r
                      for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap is not None:
        part.add(ring(a), [list(range(sides))[::-1]], cap)
        part.add(ring(b), [list(range(sides))], cap)


def hash01(i, j, k=0):
    """A number in 0..1 from three integers - the same on every run and every machine."""
    n = (i * 374761393 + j * 668265263 + k * 2147483647) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffff) / 0xffffff


def lump(part, centre, r, mats, seed, squash=1.0):
    """A rock: an octahedron with its six points pushed in and out, so each one is its own
    stone. Eight faces - a boulder is seen, not studied. `mats` gives each face its own slot,
    which is how a lump of ore has gold showing on some sides and rock on the rest."""
    c = Vector(centre)
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    pts = []
    for n, (x, y, z) in enumerate(dirs):
        k = 0.72 + 0.5 * hash01(seed, n)
        pts.append(c + Vector((x * r * k, y * r * k * squash, z * r * k)))
    faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]
    for f, face in enumerate(faces):
        part.add([pts[i] for i in face], [[0, 1, 2]], mats[f % len(mats)])


# ---- the building ---------------------------------------------------------------------
HILL = collection('civic_goldmine_hill')
MINE = collection('civic_goldmine')
DATUM = 0.34             # how far the hill's rim goes under; buildings.js MINE_DATUM
# How far the apron stands up out of the grass, and everything on it with it. At 0.022 the first
# bake's apron, rails and bin floor were under the grass on /demo (its field is at 0.06) and
# would be on any slope, the island not flattening the ground under a lot; this is a porch's
# step (buildings.js PORCH_RISE is 0.18) for a yard of trampled spoil. goldrun.js MINE_DECK.
APRON = 0.1

# The mouth: where the adit opens, in the face of the hill, and the rails come out of it.
MOUTH_Z = 0.42           # the front of the timber frame
MOUTH_W, MOUTH_H = 0.44, 0.5
HILL_FRONT = 0.5         # where the hill's rim meets the apron

hill = Part(HILL, 'hill')
NX, NZ = 13, 10
X0, X1, Z0, Z1 = -1.46, 1.46, -1.46, HILL_FRONT


def hill_height(x, z, i, j):
    # A dome behind the mouth, highest a little left of the middle so the silhouette is not a
    # pudding basin, and two shoulders beside the adit that make its face steep.
    # It falls away to every edge of the lot before the rim goes under: measured on the first
    # bake, a dome reaching to the back edge ended in a wall half a unit high there.
    dome = 1.15 * max(0.0, 1 - ((x + 0.12) / 1.4) ** 2 - ((z + 0.5) / 0.98) ** 2) ** 0.75
    shoulder = 0.0
    for sx, sh in ((-0.62, 0.62), (0.6, 0.5)):
        d2 = ((x - sx) / 0.42) ** 2 + ((z - 0.18) / 0.34) ** 2
        shoulder = max(shoulder, sh * max(0.0, 1 - d2))
    h = max(dome, shoulder)
    # A crown of crags on the dome and a little noise everywhere, from the grid index.
    h += 0.09 * (hash01(i, j, 1) - 0.5) + (0.16 * hash01(i, j, 2) if dome > 0.85 else 0)
    return h


grid = []
for j in range(NZ):
    row = []
    for i in range(NX):
        x = X0 + (X1 - X0) * i / (NX - 1)
        z = Z0 + (Z1 - Z0) * j / (NZ - 1)
        edge = i in (0, NX - 1) or j in (0, NZ - 1)
        # The rim goes under: a third of a unit, which hides it on any slope a lot is
        # allowed on (lib/layout.mjs QUARRY_RELIEF, 0.7 across the whole lot).
        y = -DATUM if edge else max(-0.02, hill_height(x, z, i, j))
        # Jitter the inner vertices a little in plan too, so the rows do not read as a grid.
        if not edge:
            x += 0.05 * (hash01(i, j, 3) - 0.5)
            z += 0.05 * (hash01(i, j, 4) - 0.5)
        row.append(Vector((x, y + DATUM, z)))
    grid.append(row)
for j in range(NZ - 1):
    for i in range(NX - 1):
        a, b, c, d = grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]
        for tri in ((a, d, c), (a, c, b)) if (i + j) % 2 else ((a, d, b), (b, d, c)):
            n = (tri[1] - tri[0]).cross(tri[2] - tri[0])
            # Grass on whatever a sheep could stand on, rock where it is steep, at the foot and
            # all round the mouth - the face the adit is cut into is bare.
            steep = n.length and abs(n.normalized().y) < 0.66
            low = max(p.y for p in tri) < DATUM + 0.12
            face = sum(p.z for p in tri) / 3 > -0.05
            hill.add(list(tri), [[0, 1, 2]], ROCK if steep or low or face else TURF)
hill.build()

# Crags and boulders at the foot and on top, and the gold showing in the face.
rocks = Part(HILL, 'rocks')
for n, (x, y, z, r) in enumerate([
    (-0.95, 0.06, 0.5, 0.17), (0.98, 0.04, 0.46, 0.14), (-0.45, 0.02, 0.62, 0.09),
    (1.22, 0.03, -0.2, 0.16), (-1.2, 0.05, -0.55, 0.15), (-0.2, 1.16, -0.7, 0.16), (0.2, 1.02, -0.4, 0.12),
]):
    lump(rocks, (x, y + DATUM, z), r, [ROCK_DARK, ROCK], 20 + n, squash=0.8)
for n, (x, y, z) in enumerate([(-0.42, 0.52, 0.3), (0.38, 0.44, 0.33), (-0.3, 0.72, 0.16), (0.52, 0.2, 0.44), (-0.6, 0.24, 0.42)]):
    lump(rocks, (x, y + DATUM, z), 0.045, [GOLD, ROCK_DARK], 40 + n)
rocks.build()

# The adit: a dark mouth, a timber frame round it, and a board with a pick over the lintel.
adit = Part(MINE, 'adit', lift=APRON)
box(adit, (0, MOUTH_H / 2, MOUTH_Z - 0.1), (MOUTH_W, MOUTH_H, 0.18), DARK)
for x in (-MOUTH_W / 2 - 0.03, MOUTH_W / 2 + 0.03):
    box(adit, (x, (MOUTH_H + 0.04) / 2, MOUTH_Z - 0.02), (0.06, MOUTH_H + 0.04, 0.06), TIMBER)
box(adit, (0, MOUTH_H + 0.05, MOUTH_Z - 0.02), (MOUTH_W + 0.2, 0.07, 0.08), TIMBER)
box(adit, (0, MOUTH_H + 0.13, MOUTH_Z - 0.05), (0.34, 0.1, 0.025), BOARD)
# The pick on the board: a handle and a head, crossed like the sign on any miner's door.
box(adit, (0, MOUTH_H + 0.13, MOUTH_Z - 0.035), (0.018, 0.1, 0.008), IRON, rz=0.7)
box(adit, (0.022, MOUTH_H + 0.15, MOUTH_Z - 0.033), (0.13, 0.016, 0.008), IRON, rz=-0.35)
# Two props inside the mouth, so it has depth and the dark is a tunnel, not a painted door.
for x in (-MOUTH_W / 2 + 0.03, MOUTH_W / 2 - 0.03):
    box(adit, (x, MOUTH_H / 2, MOUTH_Z - 0.16), (0.04, MOUTH_H, 0.04), TIMBER)
box(adit, (0, MOUTH_H - 0.03, MOUTH_Z - 0.16), (MOUTH_W, 0.04, 0.04), TIMBER)
adit.build()

# The apron: trampled spoil in front of the hill, with a skirt that goes under the ground like
# the hill's rim, so the rails and the bin have a floor on a slope.
apron = Part(HILL, 'apron')
box(apron, (0, (APRON + DATUM) / 2, (HILL_FRONT - 0.26 + 1.42) / 2), (2.7, APRON + DATUM, 1.42 - HILL_FRONT + 0.26), EARTH)
apron.build()

# The rails, out of the mouth and down the middle of the apron to the lot's edge, on sleepers.
RAIL_Y, GAUGE = 0.05, 0.15
RAILS_TO = 1.36
track = Part(MINE, 'rails', lift=APRON)
for x in (-GAUGE / 2, GAUGE / 2):
    box(track, (x, RAIL_Y - 0.009, (MOUTH_Z - 0.18 + RAILS_TO) / 2), (0.016, 0.018, RAILS_TO - MOUTH_Z + 0.18), RAIL)
z = MOUTH_Z - 0.1
while z < RAILS_TO - 0.02:
    box(track, (0, 0.03, z), (0.25, 0.018, 0.05), SLEEPER)
    z += 0.17
track.build()

# The buffer at the rails' end: measured, not moved. Its origin is where the cart rests, on
# the rails, a cart's half length short of the block.
CART_AT = (0, RAIL_Y, 1.1)
stop = Part(MINE, 'cartstop', CART_AT, lift=APRON)
box(stop, (0, RAIL_Y + 0.04, RAILS_TO - 0.03), (0.22, 0.08, 0.06), TIMBER)
for x in (-GAUGE / 2, GAUGE / 2):
    box(stop, (x, RAIL_Y + 0.02, RAILS_TO - 0.03), (0.03, 0.06, 0.07), IRON)
stop.build()

# The ore bin, left of the rails: planks on corner posts, the front lower than the back so the
# ore can be seen from the square. Its origin is the middle of its floor, which is where
# goldmine.js heaps the week.
BX0, BX1, BZ0, BZ1 = -1.28, -0.66, 0.62, 1.24
BIN_FLOOR = 0.04
bin_at = ((BX0 + BX1) / 2, BIN_FLOOR, (BZ0 + BZ1) / 2)
orebin = Part(MINE, 'bin', bin_at, lift=APRON)
box(orebin, (bin_at[0], BIN_FLOOR / 2, bin_at[2]), (BX1 - BX0, BIN_FLOOR, BZ1 - BZ0), BIN)
for (x, z, w, d, h, mat) in [
    ((BX0 + BX1) / 2, BZ0, BX1 - BX0, 0.03, 0.26, BIN),       # back
    ((BX0 + BX1) / 2, BZ1, BX1 - BX0, 0.03, 0.13, BIN),       # front, low
    (BX0, (BZ0 + BZ1) / 2, 0.03, BZ1 - BZ0, 0.2, BIN_Z),      # sides
    (BX1, (BZ0 + BZ1) / 2, 0.03, BZ1 - BZ0, 0.2, BIN_Z),
]:
    box(orebin, (x, h / 2, z), (w, h, d), mat)
for x in (BX0, BX1):
    for z, h in ((BZ0, 0.29), (BZ1, 0.16)):
        box(orebin, (x, h / 2, z), (0.05, h, 0.05), TIMBER)
orebin.build()

# A lantern on a post right of the mouth, lit after dark like every window on the island.
lamp = Part(MINE, 'lantern', lift=APRON)
LX, LZ = 0.42, 0.62
# The post goes through the apron into the ground: it is what this asset stands on, the bake
# wanting every asset's lowest point on y = 0.
box(lamp, (LX, 0.33 - APRON / 2, LZ), (0.045, 0.66 + APRON, 0.045), TIMBER)
box(lamp, (LX - 0.08, 0.64, LZ), (0.17, 0.03, 0.03), TIMBER)
box(lamp, (LX - 0.15, 0.6, LZ), (0.006, 0.05, 0.006), IRON)
box(lamp, (LX - 0.15, 0.56, LZ), (0.05, 0.012, 0.05), IRON)
box(lamp, (LX - 0.15, 0.52, LZ), (0.038, 0.065, 0.038), FLAME)
box(lamp, (LX - 0.15, 0.48, LZ), (0.05, 0.012, 0.05), IRON)
# A spare pick and a shovel leaning on the post, and a pair of wooden wedges on the apron.
box(lamp, (LX + 0.05, 0.2, LZ + 0.03), (0.016, 0.4, 0.016), TIMBER, rz=-0.18)
box(lamp, (LX + 0.09, 0.39, LZ + 0.03), (0.12, 0.018, 0.018), IRON, rz=-0.5)
box(lamp, (LX + 0.03, 0.2, LZ - 0.03), (0.016, 0.42, 0.016), TIMBER, rz=0.12)
box(lamp, (LX + 0.005, 0.03, LZ - 0.03), (0.07, 0.06, 0.012), IRON, rz=0.12)
lamp.build()

door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, MOUTH_Z - 0.12))
MINE.objects.link(door)

# ---- the cart ----------------------------------------------------------------------------
CART_C = collection('prop_minecart')
cart = Part(CART_C, 'body')
# An open iron tub, wider at the top, on two axles. Outer shell, inner shell and the rim
# between them: the inside has to be drawn, it is what the ore lies in.
L0, W0, L1, W1, YB, YT = 0.26, 0.17, 0.32, 0.22, 0.07, 0.22
def ring(y, l, w, inset=0.0):
    l, w = l / 2 - inset, w / 2 - inset
    return [(-w, y, -l), (w, y, -l), (w, y, l), (-w, y, l)]
outer_b, outer_t = ring(YB, L0, W0), ring(YT, L1, W1)
inner_b, inner_t = ring(YB + 0.02, L0, W0, 0.015), ring(YT, L1, W1, 0.015)
for k in range(4):
    n = (k + 1) % 4
    cart.face([outer_b[k], outer_b[n], outer_t[n], outer_t[k]], CART)
    cart.face([inner_b[n], inner_b[k], inner_t[k], inner_t[n]], CART)
    cart.face([outer_t[k], outer_t[n], inner_t[n], inner_t[k]], CART_RIM)
cart.face(outer_b[::-1], CART)
cart.face(inner_b, CART_RIM)
for z in (-0.085, 0.085):
    for x in (-0.078, 0.078):
        cylinder(cart, (x - 0.012, 0.042, z), (x + 0.012, 0.042, z), 0.042, WHEEL, sides=6, cap=WHEEL)
box(cart, (0, 0.055, 0), (0.14, 0.03, 0.22), CART_RIM)
cart.floor()
cart.build()

# ---- one lump of ore ----------------------------------------------------------------------
ORE_C = collection('prop_goldore')
ore = Part(ORE_C, 'lump')
lump(ore, (0, 0.028, 0), 0.04, [ORE_ROCK, ORE_GOLD, ORE_ROCK, ORE_GOLD, ORE_GOLD, ORE_ROCK, ORE_ROCK, ORE_GOLD], 7, squash=0.7)
ore.floor()
ore.build()

bpy.context.scene['building_height'] = 1.35
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'goldmine.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'goldmine'})
