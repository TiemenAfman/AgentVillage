"""The rowing boat. Rebuild with scripts/blender.mjs --background --python scripts/build-rowboat.py.

Plans/roeiboot-en-schat.md: every boat that is not a galleon - a harbour's boats, a wanderer's
skiff, the settlers' outings, the boat a newcomer arrives in - was the 3D Benchy, a toy tug with a
cabin. The keeper wanted a rowing boat: an open boat with two thwarts and a pair of oars, room in
the stern sheets for the treasure statue, and oars that are seen to pull.

One hero asset, `rowboat`, three parts:

    rowboat hull        the shell (outside, inside and the gunwale between them), the transom,
                        floorboards, two thwarts and the two rowlocks. Origin on the keel's lowest
                        point in the middle of the boat; bow towards +z like every boat here.
    rowboat oar port    an oar each, origin on its rowlock (`at` is the pin), lying level and
    rowboat oar stbd    straight out to its side. web/js/boat.js turns them about that point by the
                        way the hull has made, so every page pulls every boat on the same stroke.

Sized to the Benchy it replaces (1.3 long, 0.67 wide): 1.24 long and 0.5 across, so the berths
of shared/quay.mjs, the boat's bow probe (BOW is measured off this bake) and the outings' lanes
keep the room they had. A settler is 0.54 tall; the middle thwart is a seat for one at 0.15 over
the keel, the floorboards where the feet go at 0.085 (shared/hull.mjs CABIN_FLOOR) - over the waterline,
since an open boat shows the sea inside her wherever her floor is under it.

Why so coarse: the hull is seven points round a section at nine stations along it, outside and
inside, which is ~300 triangles and reads as a lapstrake boat because the plank sheet (`plankZ`,
planks along z) draws the strakes - modelling them would be ten times that for something seen
from a camera two metres up. The faces are wound by hand, then checked against bmesh's own
normals and flipped where they disagree, from this script's own lists: bmesh reaches its answer by
a different route every run, so its faces are never the ones written (the krakenkit's lesson).

Written in island coordinates (x right, y up, z to the front) through xyz(), like build-wagon.py.
"""
import bpy
import bmesh
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/rowboat'
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


OUTSIDE = material('plankZ', 'rowboat strakes', 0x2f6a78)
SHEER = material('plain', 'rowboat sheer strake', 0xe4dcc6)
INSIDE = material('plankZ', 'rowboat ceiling', 0xb88d5e)
TRANSOM = material('plank', 'rowboat transom', 0x2f6a78)
THWART = material('plank', 'rowboat thwart', 0x8a6242)
FLOOR = material('plankZ', 'rowboat floorboards', 0x9c7448)
IRON = material('plain', 'rowboat rowlock', 0x3a3b3f)
LOOM = material('plankZ', 'rowboat oar loom', 0xc9a06a)
BLADE = material('plain', 'rowboat oar blade', 0xe8dcc0)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = name, Vector(origin)
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

    def orient(self, inward=()):
        """Turn every face to agree with bmesh's outward normals, from our own lists."""
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in self.verts]
        made = [bm.faces.new([vs[i] for i in f]) for f in self.faces]
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.normal_update()
        for k, (f, b) in enumerate(zip(self.faces, made)):
            mine = (self.verts[f[1]] - self.verts[f[0]]).cross(self.verts[f[2]] - self.verts[f[0]])
            if mine.dot(b.normal) < 0:
                self.faces[k] = f[::-1]
        bm.free()

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


def box(part, centre, size, mat):
    c, (sx, sy, sz) = Vector(centre), size
    pts = [c + Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


# ---- the hull's lines ----------------------------------------------------------------------
L = 1.24                  # overall length
Z0, Z1 = -L / 2, L / 2    # transom, stem
BEAM = 0.25               # half the beam at its widest, a little aft of the middle
THK = 0.014               # the planking
# Nine stations from the transom to the stem. `w` is the half-width at the sheer, `keel` how far
# the keel has risen there (rocker, more at the bow), `sheer` the gunwale's height above the
# lowest point of the keel (springing up at both ends).
STATIONS = [
    (-1.00, 0.70, 0.035, 0.235),
    (-0.75, 0.88, 0.012, 0.222),
    (-0.50, 0.97, 0.003, 0.214),
    (-0.25, 1.00, 0.000, 0.210),
    (0.00, 0.98, 0.000, 0.210),
    (0.25, 0.90, 0.004, 0.214),
    (0.50, 0.72, 0.016, 0.226),
    (0.75, 0.42, 0.040, 0.245),
    (1.00, 0.02, 0.085, 0.275),
]
# Round a section, port gunwale to starboard gunwale: how far out (of `w`) and how far up (of the
# depth from keel to sheer). The two points at 0.93 / 0.42 are the turn of the bilge, the ones at
# 0.8 the bottom edge of the sheer strake, which is painted apart.
SECTION = [(-1.0, 1.0), (-0.985, 0.8), (-0.93, 0.42), (-0.6, 0.08), (0.0, 0.0), (0.6, 0.08), (0.93, 0.42), (0.985, 0.8), (1.0, 1.0)]
N = len(SECTION)


def ring(t, w, keel, sheer, inset=0.0):
    z = t * L / 2
    if inset:
        # The inside skin stops a plank short of the transom and the stem.
        z = max(Z0 + inset, min(Z1 - inset * 3, z))
    half = max(BEAM * w - inset, 0.002)
    out = []
    for sx, sy in SECTION:
        y = keel + (sheer - keel) * sy
        out.append((sx * half, y + (inset if sy < 1 else 0), z))
    return out


hull = Part('rowboat hull')
outer = [ring(*s) for s in STATIONS]
inner = [ring(*s, inset=THK) for s in STATIONS]
S = len(STATIONS)


def skin(rings, mat_of):
    for k in range(S - 1):
        a, b = rings[k], rings[k + 1]
        for i in range(N - 1):
            mat = mat_of(i)
            hull.add([a[i], a[i + 1], b[i + 1], b[i]], [[0, 1, 2, 3]], mat)


# The top strake outside is painted the sheer's cream, the rest the boat's colour.
skin(outer, lambda i: SHEER if i in (0, N - 2) else OUTSIDE)
skin(inner, lambda i: INSIDE)
# The gunwale: the strip on top joining the outside to the inside, either side.
for k in range(S - 1):
    for i in (0, N - 1):
        hull.add([outer[k][i], outer[k + 1][i], inner[k + 1][i], inner[k][i]], [[0, 1, 2, 3]], SHEER)
# The transom, outside and in, and its top edge between them.
hull.add(outer[0], [list(range(N))], TRANSOM)
hull.add(inner[0], [list(range(N))], INSIDE)
hull.add([outer[0][0], outer[0][N - 1], inner[0][N - 1], inner[0][0]], [[0, 1, 2, 3]], SHEER)
# The stem: the outside's last ring is all but a line; close it onto the inside's last ring.
for i in range(N - 1):
    hull.add([outer[-1][i], outer[-1][i + 1], inner[-1][i + 1], inner[-1][i]], [[0, 1, 2, 3]], SHEER if i in (0, N - 2) else OUTSIDE)
hull.orient()

# Floorboards, where the feet go (CABIN_FLOOR in shared/hull.mjs is their top): a flat panel over
# the bottom from the stern sheets to forward of the oarsman.
FLOOR_Y = 0.085
box(hull, (0, FLOOR_Y - 0.006, -0.08), (0.24, 0.012, 0.74), FLOOR)
# Two thwarts across: the oarsman's in the middle (at the rowlocks) and one forward of him; and
# the stern sheets' seat across the transom, where the statue rides.
THWART_Y = 0.15
ROW_Z = 0.04
for z, half in ((ROW_Z, 0.218), (0.3, 0.16)):
    box(hull, (0, THWART_Y, z), (half * 2, 0.018, 0.075), THWART)
box(hull, (0, 0.135, -0.5), (0.2, 0.016, 0.09), THWART)
# The rowlocks: a block on each gunwale abreast of the thwart, a little aft of it, with the pin
# the oar turns on.
LOCK_Z = ROW_Z - 0.09
lock_half = BEAM * 0.975
LOCK_Y = 0.214
for sx in (-1, 1):
    box(hull, (sx * lock_half, LOCK_Y + 0.012, LOCK_Z), (0.03, 0.024, 0.05), IRON)
hull.build()

# ---- the oars ------------------------------------------------------------------------------
# 0.8 long (3.2 m, an oar for a boat this size), 0.2 of it inboard of the pin as the loom the hands
# hold, a flat blade at the far end. Level and straight out at rest: the stroke is boat.js's.
PIN_Y = LOCK_Y + 0.03
OAR = 0.8
INBOARD = 0.2
for sx, side in ((-1, 'port'), (1, 'stbd')):
    pin = (sx * lock_half, PIN_Y, LOCK_Z)
    oar = Part(f'rowboat oar {side}', origin=pin)
    shaft = OAR - 0.2
    box(oar, (pin[0] + sx * (shaft / 2 - INBOARD), PIN_Y, LOCK_Z), (shaft, 0.016, 0.016), LOOM)
    box(oar, (pin[0] + sx * (OAR - INBOARD - 0.1), PIN_Y, LOCK_Z), (0.2, 0.008, 0.055), BLADE)
    oar.build()

scene = bpy.context.scene
scene.unit_settings.system = 'NONE'
scene.unit_settings.scale_length = 1
scene['building_height'] = 0.3
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'rowboat.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'rowboat'})
