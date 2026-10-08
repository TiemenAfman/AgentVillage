"""The galleon's harpoon gun in the island's own style (Plans/harpoen.md). Rebuild with
node scripts/blender.mjs --background --python-exit-code 1 --python scripts/build-harpoon.py.

The keeper chose the Sketchfab model first (web/models/harpoon.glb, scripts/build-harpoon-glb.py) and
asked for this one beside it, to compare: the same gun drawn out of primitives in corner-less flat
colours, the way every other thing on the island is, and baked into web/js/harpoon-mesh.js so it is
there before the first frame. It is not a copy of that design - a pedestal, a fork, a barrel with a
line drum and two handles is what any deck gun of the sort is - but it keeps the GLB's frame to the
millimetre, so the page can draw either on the same numbers:

    the trunnion   0.313 above the deck, on the pedestal's axis; the gun lifts about x through it
    the bore       0.018 above the trunnion, along +z; its mouth (`anchor.muzzle`) at z 0.164
    the bolt       its tail (where the line is made fast) at z 0.079 in the bore, its point at 0.27

Four parts, as the GLB's four nodes, each with its Blender origin on the axis it turns about
(build-sawmill.py's rule for parts that move, left out of the merge and hung on their own `at`):

    harpoon mount   the pedestal: iron foot, oak post, iron collar. Origin on the deck. Still.
    harpoon yoke    the fork on the collar. Origin on the axis at the collar's top: traverses about y.
    harpoon gun     barrel, bands, oak cradle, handles, line drum. Origin on the trunnion: elevates.
    harpoon bolt    the barbed iron, origin at its tail: fired out of the bore and reeled back in.

A hero set (one asset, called after the set), because the four parts together are one thing on a
ship and `prop_`'s 120 does not draw a barrel and a drum. The 4000 ceiling is not a target: ~900.
Written in island coordinates (x across, y up, z ahead) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/harpoon'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SET = 'harpoon'

# The GLB's frame (tests/harpoon-model.test.mjs reads both and holds them together).
TRUNNION = (0.0, 0.313, 0.0)
BORE_Y = 0.3312
MUZZLE_Z = 0.1637
TAIL_Z = 0.079
TIP_Z = 0.27


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


IRON = material('plain', 'harpoon iron', 0x3b3d40)
IRON_DARK = material('plain', 'harpoon iron dark', 0x26282b)
OAK = material('plank', 'harpoon oak', 0x6a4529)
LEATHER = material('plain', 'harpoon leather', 0x4a2c1b)
ROPE = material('plain', 'harpoon rope', 0xa88a5c)
STEEL = material('plain', 'harpoon steel', 0x8e9399)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = f'{SET} {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def add(self, points, faces, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        base, s = len(self.verts), self.slots.index(mat)
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
        bpy.context.scene.collection.objects.link(obj)
        return obj


def frame(axis):
    """Two unit vectors square to `axis` and to each other."""
    a = Vector(axis).normalized()
    up = Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0))
    u = a.cross(up).normalized()
    return a, u, a.cross(u).normalized()


def cylinder(part, a, b, r0, mat, n=8, r1=None, caps=True):
    """A prism of `n` sides from point a to point b, radius r0 at a and r1 at b (a cone when r1 = 0)."""
    a, b = Vector(a), Vector(b)
    r1 = r0 if r1 is None else r1
    _, u, v = frame(b - a)
    ring = lambda c, r: [c + (u * math.cos(2 * math.pi * i / n) + v * math.sin(2 * math.pi * i / n)) * r for i in range(n)]
    if r1 <= 0:
        part.add(ring(a, r0) + [b], [[i, (i + 1) % n, n] for i in range(n)], mat)
        if caps:
            part.add(ring(a, r0), [list(range(n))[::-1]], mat)
        return
    pts = ring(a, r0) + ring(b, r1)
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if caps:
        faces += [list(range(n))[::-1], list(range(n, 2 * n))]
    part.add(pts, faces, mat)


def box(part, centre, size, mat):
    c, (sx, sy, sz) = Vector(centre), size
    pts = [c + Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


# ---- the pedestal: still -------------------------------------------------------------------
COLLAR_TOP = 0.205
mount = Part('mount')
cylinder(mount, (0, 0, 0), (0, 0.018, 0), 0.075, IRON_DARK, n=8, r1=0.068)      # the foot, bolted down
cylinder(mount, (0, 0.018, 0), (0, 0.03, 0), 0.06, IRON, n=8, r1=0.05)
cylinder(mount, (0, 0.03, 0), (0, 0.17, 0), 0.042, OAK, n=8, r1=0.036)           # the post
cylinder(mount, (0, 0.17, 0), (0, COLLAR_TOP, 0), 0.05, IRON, n=8, r1=0.046)     # the collar
for i in range(4):                                                                # the foot's bolts
    a = math.pi / 4 + i * math.pi / 2
    box(mount, (0.058 * math.cos(a), 0.022, 0.058 * math.sin(a)), (0.012, 0.012, 0.012), IRON)

# ---- the fork: traverses about y -----------------------------------------------------------
yoke = Part('yoke', (0, COLLAR_TOP, 0))
cylinder(yoke, (0, COLLAR_TOP, 0), (0, COLLAR_TOP + 0.02, 0), 0.04, IRON_DARK, n=8)
for s in (-1, 1):
    # Each arm: up from the turntable, splaying out to clear the barrel, to a boss on the trunnion.
    x0, x1 = 0.018 * s, 0.042 * s
    box(yoke, (x0 * 1.3, COLLAR_TOP + 0.04, 0), (0.014, 0.04, 0.03), IRON)
    cylinder(yoke, (x0 * 1.3, COLLAR_TOP + 0.055, 0), (x1, TRUNNION[1] - 0.008, 0), 0.008, IRON, n=6)
    cylinder(yoke, (x1 - 0.006 * s, TRUNNION[1], 0), (x1 + 0.006 * s, TRUNNION[1], 0), 0.014, IRON_DARK, n=8)

# ---- the gun: elevates about its trunnion --------------------------------------------------
gun = Part('gun', TRUNNION)
BACK = -0.12
cylinder(gun, (0, BORE_Y, BACK), (0, BORE_Y, MUZZLE_Z), 0.026, IRON, n=10)                # the barrel
cylinder(gun, (0, BORE_Y, MUZZLE_Z - 0.03), (0, BORE_Y, MUZZLE_Z), 0.03, IRON_DARK, n=10)  # muzzle ring
cylinder(gun, (0, BORE_Y, MUZZLE_Z), (0, BORE_Y, MUZZLE_Z + 0.002), 0.011, IRON_DARK, n=8)  # the bore, dark
for z in (-0.09, -0.02, 0.06):                                                            # bands
    cylinder(gun, (0, BORE_Y, z - 0.007), (0, BORE_Y, z + 0.007), 0.029, IRON_DARK, n=10)
cylinder(gun, (0, BORE_Y, BACK - 0.012), (0, BORE_Y, BACK), 0.02, IRON_DARK, n=10, r1=0.026)  # breech cap
# The oak cradle under the barrel, and the trunnion pin through it.
box(gun, (0, TRUNNION[1] + 0.003, -0.02), (0.05, 0.022, 0.16), OAK)
cylinder(gun, (-0.03, TRUNNION[1], 0), (0.03, TRUNNION[1], 0), 0.008, IRON_DARK, n=6)
# Two handles out of the breech, back and to the sides, wrapped in leather where the hands go.
for s in (-1, 1):
    a, b, c = (0.02 * s, BORE_Y - 0.01, BACK + 0.02), (0.055 * s, BORE_Y - 0.03, BACK - 0.02), (0.07 * s, BORE_Y - 0.05, BACK - 0.045)
    cylinder(gun, a, b, 0.006, IRON, n=6)
    cylinder(gun, b, c, 0.009, LEATHER, n=6)
# The line drum under the breech: an oak spool across the gun, with the line wound on it.
DRUM = (0, BORE_Y - 0.05, BACK + 0.03)
box(gun, (0, BORE_Y - 0.028, BACK + 0.03), (0.016, 0.03, 0.02), IRON)
for s in (-1, 1):
    cylinder(gun, (0.03 * s, DRUM[1], DRUM[2]), (0.036 * s, DRUM[1], DRUM[2]), 0.026, OAK, n=10)
cylinder(gun, (-0.03, DRUM[1], DRUM[2]), (0.03, DRUM[1], DRUM[2]), 0.02, ROPE, n=10)

# ---- the bolt: fired and reeled home -------------------------------------------------------
bolt = Part('bolt', (0, BORE_Y, TAIL_Z))
cylinder(bolt, (0, BORE_Y, TAIL_Z), (0, BORE_Y, TIP_Z - 0.035), 0.0055, STEEL, n=6)        # the shaft
cylinder(bolt, (0, BORE_Y, TAIL_Z - 0.004), (0, BORE_Y, TAIL_Z + 0.004), 0.009, IRON_DARK, n=6)  # the eye
cylinder(bolt, (0, BORE_Y, TIP_Z - 0.035), (0, BORE_Y, TIP_Z), 0.011, STEEL, n=4, r1=0)    # the point
for s in (-1, 1):                                                                         # two barbs
    cylinder(bolt, (0, BORE_Y, TIP_Z - 0.03), (0.016 * s, BORE_Y, TIP_Z - 0.055), 0.004, STEEL, n=4, r1=0)

objs = [p.build() for p in (mount, yoke, gun, bolt)]
muzzle = bpy.data.objects.new('anchor.muzzle', None)
muzzle.location = xyz((0, BORE_Y, MUZZLE_Z))
bpy.context.scene.collection.objects.link(muzzle)

for o in objs:
    for poly in o.data.polygons:
        poly.use_smooth = False
scene = bpy.context.scene
scene.unit_settings.system = 'NONE'
scene['building_height'] = max((o.matrix_world @ v.co).z for o in objs for v in o.data.vertices)
print('harpoon', {o.name: len(o.data.polygons) for o in objs}, flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'harpoon.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'harpoon'})
