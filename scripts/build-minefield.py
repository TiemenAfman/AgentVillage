"""The gold mine's field: the holes a dig leaves. Rebuild with
scripts/blender.mjs --background --python scripts/build-minefield.py.

Plans/goudmijn-zoektocht.md: inside the mine (web/js/mine-room.js) is a field of seven by seven
spots, CELL (0.6) apart, dug blind. A spot nobody has dug is the cave's own floor; a dug one was a
black square, and the stair down a little wooden frame on the floor that read as a hatch or a bench
(the keeper, 8 October 2026). So each spot is now a TILE of floor one cell square, and a dug one is
a tile with a hole in it:

    civic_minefield_pit_a/_b/_c   a dug pit: a ragged round mouth, sloping earth walls going
                                  darker as they go down, the spoil thrown up on one side of the
                                  rim and a few stones in it. Three, so a field of them is not
                                  one hole stamped twelve times; the room turns each by a
                                  quarter turn as well.
    civic_minefield_shaft         the way down: a deeper, steeper hole with a collar of logs round
                                  its mouth and a wooden ladder standing in it, its top above the
                                  rim and its foot lost in the dark.

Every tile is modelled DATUM too high, like the gold mine's hill (build-goldmine.py): a bake stands
on its lowest point (scripts/model-rules.mjs), which here is the pit's bottom, and the room lowers
the tile by its depth (MINE_PIT_DEPTH, MINE_SHAFT_DEPTH in mine-room.js - the same two numbers).
Its top is a flat square at exactly the floor's height, its edge on the cell's edge, so it meets
the next tile and the cave's floor with no step and no line - the part `<asset> floor` is
repainted by the room in the floor's own colour, so it cannot drift from it either.

The room has no shadows, and its four lamps light the bottom of a shaft as brightly as its rim. So
the darkness down a hole is painted: every band of wall a darker material than the one above it,
and the ladder in three lengths of timber going black. Sixteen sides to a mouth because the square
around it then has its corners on the ring's own angles (22.5 degrees a step), so the floor is a
strip of quads from the square to the mouth and nothing else.

Written in island coordinates (x right, y up, z to the front) through xyz(), with
build-goldmine.py's Part class.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/minefield'
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


# The floor is white: mine-room.js repaints it in the cave floor's colour (C.earth).
FLOOR = material('plain', 'minefield floor', 0xffffff)
SPOIL = material('plain', 'minefield spoil', 0x7a5a3a)
SPOIL_DARK = material('plain', 'minefield clod', 0x664a30)
# The lip where nothing was thrown: the floor's earth a shade darker, so the mouth has an edge
# without a ring of spoil round all of it.
RIM = material('plain', 'minefield rim', 0x4f3b2a)
# The walls, going down. The top band is the floor's earth in the shade of the rim; past that the
# light is what the room cannot give, so it is painted out.
WALL = [material('plain', f'minefield wall {k}', c) for k, c in enumerate((0x4c3828, 0x33251a, 0x1c140e, 0x0d0907, 0x050403))]
ROCK = material('plain', 'minefield stone', 0x77726a)
ROCK_DARK = material('plain', 'minefield stone dark', 0x5b5751)
TIMBER = [material('plank', f'minefield ladder {k}', c) for k, c in enumerate((0x7b5634, 0x3e2b1b, 0x120d09))]
LOG = material('plankZ', 'minefield collar', 0x6b4a2f)

CELL = 0.6               # shared/mine.mjs CELL: one tile is one spot
HALF = CELL / 2
SIDES = 16
PIT_DEPTH = 0.16         # mine-room.js MINE_PIT_DEPTH: about knee deep on a settler
SHAFT_DEPTH = 0.9        # mine-room.js MINE_SHAFT_DEPTH: deeper than anybody, and out of sight
RUNG_STEP = 0.061        # shared/deck.mjs RUNG_STEP: every ladder on the island is cut to the climb


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, asset, name):
        self.asset, self.name = asset, f'{asset.name} {name}'
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat):
        base, s = len(self.verts), self.slot(mat)
        self.verts.extend(Vector(p) for p in points)
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
        obj['building_part'] = True
        self.asset.objects.link(obj)
        return obj


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def hash01(i, j, k=0):
    """A number in 0..1 from three integers - the same on every run and every machine."""
    n = (i * 374761393 + j * 668265263 + k * 2147483647) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffff) / 0xffffff


def lump(part, centre, r, mat, seed, squash=1.0):
    """A stone or a clod: an octahedron with its points pushed in and out. Eight faces."""
    c = Vector(centre)
    dirs = [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    pts = []
    for n, (x, y, z) in enumerate(dirs):
        k = 0.72 + 0.5 * hash01(seed, n)
        pts.append(c + Vector((x * r * k, y * r * k * squash, z * r * k)))
    faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]]
    part.add(pts, faces, mat)


def cylinder(part, a, b, r, mat, sides=4, turn=math.pi / 4):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(t) + v * math.sin(t)) * r
                      for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)


def log(part, a, b, r, mat):
    """A log of the collar: a six-sided cylinder with its ends closed."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    u = d.cross(Vector((0, 1, 0))).normalized()
    v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(t) + v * math.sin(t)) * r for t in (2 * math.pi * i / 6 for i in range(6))]
    part.add(ring(a) + ring(b), [[i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i] for i in range(6)], mat)
    part.add(ring(a), [list(range(6))[::-1]], mat)
    part.add(ring(b), [list(range(6))], mat)


def angle(k):
    return 2 * math.pi * k / SIDES


def on_square(k, y):
    """Where the ray at angle k leaves the tile: the square's edge, its corners at k = 2, 6, 10, 14."""
    c, s = math.cos(angle(k)), math.sin(angle(k))
    m = max(abs(c), abs(s))
    # Exactly on the edge: a corner is (+-HALF, +-HALF) to the last bit, so tiles meet.
    x, z = HALF * c / m, HALF * s / m
    x = max(-HALF, min(HALF, round(x / HALF * 1e6) / 1e6 * HALF))
    z = max(-HALF, min(HALF, round(z / HALF * 1e6) / 1e6 * HALF))
    return Vector((x, y, z))


def around(radius, y):
    """A ring of SIDES points, `radius(k)` and `y(k)` each a function of the step."""
    return [Vector((radius(k) * math.cos(angle(k)), y(k), radius(k) * math.sin(angle(k)))) for k in range(SIDES)]


def band(part, upper, lower, mat):
    """The faces between two rings, the upper one outside or above the lower."""
    for k in range(SIDES):
        n = (k + 1) % SIDES
        part.add([upper[k], upper[n], lower[n], lower[k]], [[0, 3, 2, 1]], mat)


def hole(asset, seed, depth, mouth, throw, walls, steep):
    """The floor tile with a hole in it, down to its bottom at y = 0. `mouth` is the hole's
    radius, `throw` the bearing the spoil was thrown to, `walls` how many bands of wall (each a
    darker material), `steep` how little the walls narrow on the way down."""
    floor = Part(asset, 'floor')
    earth = Part(asset, 'earth')
    lip_r = [mouth * (0.86 + 0.28 * hash01(seed, k, 1)) for k in range(SIDES)]
    # The spoil: a low bank round the mouth, high on the side it was thrown to.
    heap = lambda k: max(0.0, math.cos(angle(k) - throw)) ** 2
    mound_r = [min(lip_r[k] + 0.05 + 0.03 * heap(k), HALF * 0.92) for k in range(SIDES)]
    square = [on_square(k, depth) for k in range(SIDES)]
    mound = around(lambda k: mound_r[k], lambda k: depth + (0.03 + 0.008 * hash01(seed, k, 2)) * heap(k))
    lip = around(lambda k: lip_r[k], lambda k: depth + 0.002 + 0.012 * heap(k))
    for k in range(SIDES):
        n = (k + 1) % SIDES
        floor.add([square[k], square[n], mound[n], mound[k]], [[0, 3, 2, 1]], FLOOR)
    # Spoil on the side it was thrown to, the bare rim of the floor elsewhere.
    for k in range(SIDES):
        n = (k + 1) % SIDES
        earth.add([mound[k], mound[n], lip[n], lip[k]], [[0, 3, 2, 1]], SPOIL if heap(k) + heap(n) > 0.5 else RIM)
    # The walls, down to the bottom, each band narrower and darker.
    upper = lip
    for b in range(walls):
        t = (b + 1) / walls
        y = depth * (1 - t) ** (0.8 if steep > 0.9 else 1.25)
        shrink = steep ** (b + 1)
        lower = around(lambda k: lip_r[k] * shrink * (0.94 + 0.12 * hash01(seed, k, 10 + b)),
                       lambda k: max(0.0, y + (0.01 * hash01(seed, k, 20 + b) if b < walls - 1 else 0.004 * hash01(seed, k, 20 + b))))
        band(earth, upper, lower, WALL[min(b, len(WALL) - 1)])
        upper = lower
    centre = Vector((0, 0, 0))
    for k in range(SIDES):
        earth.add([upper[k], upper[(k + 1) % SIDES], centre], [[0, 2, 1]], WALL[min(walls, len(WALL) - 1)])
    return floor, earth, lip_r, mound_r, heap


# ---- three pits -----------------------------------------------------------------------
for n, (name, mouth, throw) in enumerate((('a', 0.17, 0.4), ('b', 0.155, 2.3), ('c', 0.18, 4.4))):
    asset = collection(f'civic_minefield_pit_{name}')
    seed = 11 + n * 7
    floor, earth, lip_r, mound_r, heap = hole(asset, seed, PIT_DEPTH, mouth, throw, walls=2, steep=0.62)
    stones = Part(asset, 'stones')
    # Clods of the spoil on the bank it was thrown to, a stone or two the spade turned up, and one
    # at the bottom so the pit is not an empty bowl.
    for c in range(3):
        a = throw + (c - 1) * 0.55 + 0.2 * (hash01(seed, c, 30) - 0.5)
        r = mound_r[0] * 0.5 + (lip_r[0] + mound_r[0]) * 0.32
        lump(earth, (r * math.cos(a), PIT_DEPTH + 0.02 + 0.012 * c, r * math.sin(a)), 0.022 + 0.01 * hash01(seed, c, 31), SPOIL_DARK, seed * 10 + c, squash=0.6)
    for c in range(2):
        a = throw + math.pi * (0.7 + 0.6 * c) + 0.3 * hash01(seed, c, 32)
        r = (mound_r[0] + HALF) * 0.5
        lump(stones, (r * math.cos(a), PIT_DEPTH + 0.008, r * math.sin(a)), 0.018 + 0.008 * c, ROCK if c else ROCK_DARK, seed * 10 + 5 + c, squash=0.7)
    lump(stones, (0.03, 0.019, -0.02), 0.024, ROCK_DARK, seed * 10 + 9, squash=0.6)
    for p in (floor, earth, stones):
        p.build()

# ---- the shaft with its ladder ----------------------------------------------------------
asset = collection('civic_minefield_shaft')
floor, earth, lip_r, mound_r, heap = hole(asset, 101, SHAFT_DEPTH, 0.2, 1.2, walls=5, steep=0.97)
# A collar of four logs round the mouth, lying on the bank: the mouth of a shaft somebody means to
# go down more than once. Corners crossing, as logs are laid.
collar = Part(asset, 'collar')
C, Y, R = 0.215, SHAFT_DEPTH + 0.024, 0.02
for (ax, az), (bx, bz), lift in (((-C - 0.04, -C), (C + 0.04, -C), 0), ((-C - 0.04, C), (C + 0.04, C), 0),
                                 ((-C, -C - 0.04), (-C, C + 0.04), 0.03), ((C, -C - 0.04), (C, C + 0.04), 0.03)):
    log(collar, (ax, Y + lift, az), (bx, Y + lift, bz), R, LOG)
# The ladder: standing on the bottom against the far (-z) wall, leaning back, its top a hand above
# the logs. Rails and rungs in three lengths of timber going black: the room's lamps would light
# its foot as brightly as its top.
ladder = Part(asset, 'ladder')
FOOT = Vector((0, 0.03, 0.03))
TOP = Vector((0, SHAFT_DEPTH + 0.26, -0.19))
SHADE = (SHAFT_DEPTH * 0.72, SHAFT_DEPTH * 0.4)   # above the first, timber; above the second, dark


def shade_at(y):
    return TIMBER[0] if y > SHADE[0] else TIMBER[1] if y > SHADE[1] else TIMBER[2]


def at(y):
    t = (y - FOOT.y) / (TOP.y - FOOT.y)
    return FOOT.lerp(TOP, t)


for sx in (-0.075, 0.075):
    cuts = [FOOT.y, SHADE[1], SHADE[0], TOP.y]
    for lo, hi in zip(cuts, cuts[1:]):
        a, b = at(lo), at(hi)
        cylinder(ladder, (sx, a.y, a.z), (sx, b.y, b.z), 0.012, shade_at((lo + hi) / 2))
# Rungs every two rungs of a climbing ladder (a cycle of the climb), from a rung above the foot.
y = FOOT.y + 2 * RUNG_STEP
while y < TOP.y - 0.04:
    p = at(y)
    cylinder(ladder, (-0.075, p.y, p.z), (0.075, p.y, p.z), 0.008, shade_at(y))
    y += 2 * RUNG_STEP
stones = Part(asset, 'stones')
for c in range(3):
    a = 1.2 + (c - 1) * 0.9
    r = (mound_r[0] + HALF) * 0.52
    lump(stones, (r * math.cos(a), SHAFT_DEPTH + 0.008, r * math.sin(a)), 0.02 + 0.006 * c, ROCK if c % 2 else ROCK_DARK, 300 + c, squash=0.7)
for p in (floor, earth, collar, ladder, stones):
    p.build()

bpy.context.scene['building_height'] = SHAFT_DEPTH + 0.3
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'minefield.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'minefield'})
