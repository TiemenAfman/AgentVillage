"""The small things of the fields and the water's edge. Rebuild with
scripts/blender.mjs --background --python scripts/build-farmyard.py.

Five props, each under the prop budget of 120 triangles and centred on its own middle, because
the island puts a prop down by its middle (scripts/model-rules.mjs):

    prop_scarecrow    a post and a crossbar, a patched shirt, a sack head and a straw hat
    prop_haystack     a round stack of hay on its pole, the kind left standing in a field
    prop_beehive      two straw skeps on a little bench, their doors facing the front
    prop_reeds        a clump of reeds with two bulrush heads, for the edge of a river
    prop_waterlily    two pads and a flower, floating: their undersides at y = 0, the water

What moves (the scarecrow and the reeds in the wind, the bees round the skeps, the lily on the
ripples) is web/js/countryside.js, which moves whole props: none of these has a part that turns.
Written in island coordinates (x right, y up, z to the front) through xyz(). Plans/stal-en-veld.md.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/farmyard'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(sheet, name, color):
    m = bpy.data.materials.new(f'{sheet}:{name}')
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    return m


WOOD = material('plain', 'farm pole', 0x6e4a2c)
SHIRT = material('plain', 'scarecrow shirt', 0x5f7fa8)
PATCH = material('plain', 'scarecrow patch', 0xb9553a)
SACK = material('plain', 'scarecrow sack', 0xcdb384)
STRAW = material('plain', 'farm straw', 0xe0bf5a)
STRAW_DARK = material('plain', 'farm straw shade', 0xc79f3e)
SKEP_DOOR = material('plain', 'skep door', 0x2a2018)
REED = material('plain', 'reed green', 0x6f8f3a)
REED_TIP = material('plain', 'reed tip', 0x9aa850)
BULRUSH = material('plain', 'bulrush', 0x5a3a22)
PAD = material('plain', 'lily pad', 0x4f8a3c)
PETAL = material('plain', 'lily petal', 0xf2c8d6)
HEART = material('plain', 'lily heart', 0xf2cf4a)


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


def box(part, centre, size, mat, rz=0.0, ry=0.0):
    c, (sx, sy, sz) = Vector(centre), size
    m = Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rz, 3, 'Z')
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def stack(part, rings, mat, sides=6, top=None, bottom=True, turn=0.0):
    """Upright rings (y, r), joined bottom to top: a skep, a haystack, a sack head. `top` is the
    point the last ring closes to, or None to close it flat."""
    pts = []
    for y, r in rings:
        pts += [(math.cos(2 * math.pi * k / sides + turn) * r, y, math.sin(2 * math.pi * k / sides + turn) * r) for k in range(sides)]
    faces = []
    for j in range(len(rings) - 1):
        faces += [[j * sides + (i + 1) % sides, j * sides + i, (j + 1) * sides + i, (j + 1) * sides + (i + 1) % sides] for i in range(sides)]
    last = (len(rings) - 1) * sides
    if top is not None:
        pts.append(top)
        faces += [[last + (i + 1) % sides, last + i, len(pts) - 1] for i in range(sides)]
    else:
        faces.append([last + i for i in range(sides)][::-1])
    if bottom:
        faces.append(list(range(sides)))
    part.add(pts, faces, mat)


def shift(part, start, d):
    """Move every vertex added since `start` by d - to set a stacked shape somewhere else."""
    for i in range(start, len(part.verts)):
        part.verts[i] = part.verts[i] + Vector(d)


def blade(part, base, lean, height, width, mat, tip_mat=None):
    """One flat, tapering leaf, both faces: a reed."""
    b = Vector(base)
    tip = b + Vector((lean[0], height, lean[1]))
    side = Vector((width / 2, 0, 0)) if abs(lean[0]) < abs(lean[1]) else Vector((0, 0, width / 2))
    mid = b + (tip - b) * 0.6
    part.add([b - side, b + side, mid + side * 0.6, mid - side * 0.6], [[0, 1, 2, 3], [3, 2, 1, 0]], mat)
    part.add([mid - side * 0.6, mid + side * 0.6, tip], [[0, 1, 2], [2, 1, 0]], tip_mat or mat)


# ---- the scarecrow ------------------------------------------------------------------------
a = collection('prop_scarecrow')
p = Part(a, 'figure')
box(p, (0, 0.2, 0), (0.025, 0.4, 0.025), WOOD)
box(p, (0, 0.3, 0), (0.3, 0.02, 0.02), WOOD)
box(p, (0, 0.27, 0), (0.12, 0.13, 0.06), SHIRT)
box(p, (0, 0.3, 0), (0.3, 0.04, 0.05), SHIRT)          # both sleeves, down the crossbar
box(p, (0.025, 0.25, 0.031), (0.035, 0.035, 0.004), PATCH)
stack(p, [(0.33, 0.035), (0.41, 0.038)], SACK)
for side in (-1, 1):
    blade(p, (side * 0.15, 0.3, 0), (side * 0.05, 0.02), -0.04, 0.03, STRAW)
stack(p, [(0.41, 0.075), (0.415, 0.075)], STRAW, sides=6, bottom=True)
stack(p, [(0.415, 0.035)], STRAW_DARK, sides=6, top=(0, 0.47, 0), bottom=False)
a_scare = p.build()

# ---- the haystack -------------------------------------------------------------------------
a = collection('prop_haystack')
p = Part(a, 'stack')
stack(p, [(0.0, 0.14), (0.1, 0.16), (0.2, 0.13), (0.28, 0.08)], STRAW, sides=8, top=(0, 0.33, 0), turn=0.2)
stack(p, [(0.06, 0.155), (0.075, 0.158)], STRAW_DARK, sides=8, bottom=False, turn=0.2)
box(p, (0, 0.36, 0), (0.015, 0.08, 0.015), WOOD)
p.build()

# ---- the beehives -------------------------------------------------------------------------
a = collection('prop_beehive')
p = Part(a, 'bench')
for x in (-0.1, 0.1):
    box(p, (x, 0.04, 0), (0.025, 0.08, 0.1), WOOD)
box(p, (0, 0.09, 0), (0.3, 0.02, 0.12), WOOD)
for x in (-0.07, 0.07):
    start = len(p.verts)
    # Standing on the bench, so no floor to them.
    stack(p, [(0.0, 0.056), (0.05, 0.054), (0.09, 0.03)], STRAW, sides=6, top=(0, 0.115, 0), bottom=False)
    shift(p, start, (x, 0.1, 0))
    p.add([(x - 0.011, 0.104, 0.056), (x + 0.011, 0.104, 0.056), (x + 0.011, 0.122, 0.054), (x - 0.011, 0.122, 0.054)],
          [[0, 1, 2, 3]], SKEP_DOOR)
p.build()

# ---- the reeds ----------------------------------------------------------------------------
a = collection('prop_reeds')
p = Part(a, 'clump')
for i in range(9):
    t = 2 * math.pi * i / 9
    r = 0.02 + 0.015 * (i % 3)
    blade(p, (math.cos(t) * r, 0, math.sin(t) * r), (math.cos(t) * 0.03, math.sin(t) * 0.03),
          0.22 + 0.06 * ((i * 5) % 3), 0.018, REED, REED_TIP)
for x, z, h in ((0.01, -0.01, 0.3), (-0.02, 0.02, 0.26)):
    box(p, (x, h / 2, z), (0.005, h, 0.005), REED)
    box(p, (x, h + 0.025, z), (0.016, 0.05, 0.016), BULRUSH)
p.build()

# ---- the water lily -----------------------------------------------------------------------
a = collection('prop_waterlily')
p = Part(a, 'pads')
for (x, z, r, cut) in ((0.0, 0.0, 0.07, 0.3), (0.1, -0.04, 0.05, 2.2)):
    n = 8
    outline = [(x + math.cos(cut + 0.5 + k * (2 * math.pi - 1) / (n - 1)) * r, z + math.sin(cut + 0.5 + k * (2 * math.pi - 1) / (n - 1)) * r) for k in range(n)]
    outline.append((x, z))       # the notch every lily pad has
    m = len(outline)
    p.add([(ox, 0.0, oz) for ox, oz in outline] + [(ox, 0.004, oz) for ox, oz in outline],
          [list(range(m, 2 * m)), list(range(m))[::-1]], PAD)
# the flower: six petals round a yellow heart
for k in range(6):
    t = 2 * math.pi * k / 6
    c = Vector((0.015, 0.008, 0.01))
    tip = c + Vector((math.cos(t) * 0.035, 0.025, math.sin(t) * 0.035))
    l = c + Vector((math.cos(t + 0.5) * 0.012, 0, math.sin(t + 0.5) * 0.012))
    rr = c + Vector((math.cos(t - 0.5) * 0.012, 0, math.sin(t - 0.5) * 0.012))
    p.add([l, rr, tip], [[0, 1, 2], [2, 1, 0]], PETAL)
box(p, (0.015, 0.015, 0.01), (0.014, 0.014, 0.014), HEART)
p.build()

bpy.context.scene['building_height'] = 0.48
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'farmyard.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'farmyard'})
