"""The timber wagon. Rebuild with scripts/blender.mjs --background --python scripts/build-wagon.py.

Plans/houtkar.md: the sawmill's draught horse takes a load of squared timber down the road to
the shipyard every few minutes and comes back empty. So a one-horse cart - a boarded bed on two
big wheels, and two shafts out of the front that the horse walks between - and the load on its
own, because it is there going and not coming back.

Two assets:

    prop_wagon          the cart. Origin on the ground in the middle of its footprint, shafts
                        towards +z (the horse walks in front, at the island's front). Two
                        parts are measured rather than drawn differently:
                          prop_wagon wheel east/west  their origin is the hub, so web/js/
                                                      timberrun.js turns them by the road
                                                      rolled, and their `at` is the axle
                          prop_wagon shafts           the tips are where the horse's middle
                                                      goes (SHAFT_TO)
    prop_timber         the load: five beams on the bed's floor. Origin on the bed floor in
                        the middle of the stack, so it is hung on the wagon at the bed's own
                        height and the two numbers cannot drift apart.

Why so coarse: a prop has 120 triangles, and wheels are where they go. A wheel here is a
six-sided disc (20 triangles) rather than a rim with spokes, which from the height anybody
looks at a road reads as a cart wheel anyway; eight sides would have been the tailboard. No
axle is drawn - the bed sits on it and the wheels hide its ends. The prop_cart handcart in
scripts/build-props.py is the same idea at a settler's size, and scaling that one up was the
first thing tried: at twice the size it is still a handcart, with one pole and nowhere for a
horse to stand.

Measured against fauna_horse: its body is 0.2 across and its middle stands about 0.4 above
the ground, so the shafts run 0.13 either side of the middle and rise to the horse's flanks,
and the bed stands clear of its rump by a hand's breadth.

Written in island coordinates (x right, y up, z to the front) through xyz(), like
build-goldmine.py, whose Part class this repeats.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/wagon'
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


BED = material('plankZ', 'wagon bed', 0x8a6242)
SIDE = material('plankZ', 'wagon side', 0x6e4a30)
TAIL = material('plank', 'wagon tail', 0x6e4a30)
SHAFT = material('plankZ', 'wagon shaft', 0x5a3c26)
WHEEL = material('plank', 'wagon wheel', 0x4a3322)
TYRE = material('plain', 'wagon tyre', 0x3a3b3f)
TIMBER = material('plankZ', 'timber fresh', 0xcf9f68)
TIMBER_END = material('plain', 'timber end grain', 0xe2bd85)


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


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, ends=None):
    """A box; `ends` paints the two faces across z (a beam's end grain) another colour."""
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7]], ends or mat)


def disc(part, centre, r, width, mat, rim, sides=6):
    """A wheel across x: a `sides`-sided disc, its tread in `rim` and both faces in `mat`."""
    c = Vector(centre)
    ring = lambda dx: [c + Vector((dx, r * math.cos(t), r * math.sin(t)))
                       for t in (2 * math.pi * i / sides for i in range(sides))]
    a, b = ring(-width / 2), ring(width / 2)
    part.add(a + b, [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], rim)
    part.add(a, [list(range(sides))], mat)
    part.add(b, [list(range(sides))[::-1]], mat)


# ---- the wagon -----------------------------------------------------------------------------
WAGON = collection('prop_wagon')
WHEEL_R = 0.15          # 1.2 m across: a farm cart's wheel, and tall enough to read from the square
WHEEL_W = 0.03
WHEEL_X = 0.19          # outboard of the bed, so the wheels show from the side
AXLE_Z = -0.23          # the axle under the middle of the bed
BED_W, BED_L = 0.30, 0.56
BED_Z0 = AXLE_Z - BED_L / 2
BED_Z1 = AXLE_Z + BED_L / 2
BED_Y = WHEEL_R + 0.03  # the bed's floor, on top of the axle
SIDE_H = 0.07
SHAFT_X = 0.13          # either side of the horse's middle (its body is 0.2 across)
SHAFT_TO = 0.62         # the tips: the horse's middle stands here
SHAFT_Y0, SHAFT_Y1 = BED_Y, 0.33

bed = Part(WAGON, 'bed')
box(bed, (0, BED_Y - 0.0125, AXLE_Z), (BED_W, 0.025, BED_L), BED)
for sx in (-1, 1):
    box(bed, (sx * (BED_W / 2 - 0.01), BED_Y + SIDE_H / 2, AXLE_Z), (0.02, SIDE_H, BED_L), SIDE)
box(bed, (0, BED_Y + SIDE_H / 2, BED_Z0 + 0.01), (BED_W - 0.04, SIDE_H, 0.02), TAIL)
bed.build()

# Two shafts from the front of the bed to the horse's flanks, one bar each, rising as they go.
shafts = Part(WAGON, 'shafts')
run = SHAFT_TO - BED_Z1
tilt = math.atan2(SHAFT_Y1 - SHAFT_Y0, run)
for sx in (-1, 1):
    box(shafts, (sx * SHAFT_X, (SHAFT_Y0 + SHAFT_Y1) / 2, (BED_Z1 + SHAFT_TO) / 2),
        (0.022, 0.022, math.hypot(run, SHAFT_Y1 - SHAFT_Y0)), SHAFT, rx=-tilt)
shafts.build()

for sx, side in ((-1, 'west'), (1, 'east')):
    hub = (sx * WHEEL_X, WHEEL_R, AXLE_Z)
    wheel = Part(WAGON, f'wheel {side}', origin=hub)
    disc(wheel, hub, WHEEL_R, WHEEL_W, WHEEL, TYRE)
    wheel.build()

# ---- the load ------------------------------------------------------------------------------
# Five beams, three below and two on top, a little longer than the bed so they stick out over
# the tailboard the way a load of timber does. Origin on the bed floor under the middle of it.
LOAD = collection('prop_timber')
load = Part(LOAD, 'beams')
BEAM = 0.06
L = 0.66
for k, (x, y) in enumerate([(-BEAM * 1.05, 0), (0, 0), (BEAM * 1.05, 0), (-BEAM * 0.55, BEAM), (BEAM * 0.55, BEAM)]):
    box(load, (x, y + BEAM / 2, -0.02 + (k % 2) * 0.03), (BEAM, BEAM, L), TIMBER, ends=TIMBER_END)
load.build()

bpy.context.scene['building_height'] = 0.4
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'wagon.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'wagon'})
