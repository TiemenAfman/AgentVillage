"""Build the ship's cannon from the keeper's own model (Plans/kanonnen.md).

    node scripts/blender.mjs --background --python-exit-code 1 --python scripts/build-cannon.py

Source: assets/cannon/source/martijn-cannon.fbx, Martijn's MartijnCannon.fbx - one mesh of 9729
triangles, one grey material, no texture: a naval gun on a four-wheeled truck carriage, 25 cm long
in Maya centimetres, its bore along +x. It falls apart into 40 loose pieces, and those are what this
works with: the biggest is the barrel, a thin bar across it at the trunnions goes with the barrel,
the four wheels are the ones round the y axis low down, the rest - cheeks, bed, axles, cap squares,
bolts - is carriage. Each is painted with corner colours (iron, oak, darker wheels) since the island
has no texture for it, and decimated by its own share so the bolts are not what the budget is spent on.

Two parts come out, and that split is the point of the set:
  `cannon carriage`  origin on the ground in the middle of the carriage - the whole gun traverses
                     (turns about y) by turning this.
  `cannon barrel`    origin on the trunnion axis - the gun is laid (elevated) by turning this about
                     its own x, as the sawmill's blade turns on its own axle.
`anchor.muzzle` is the middle of the bore's mouth, at rest; the barrel's rest elevation is the angle
from its origin to that point (web/js/cannon.js works it out, rather than a second number here).

The front faces +Z on the island (-Y here), 0.62 long (two and a half metres: a settler is half a
unit), keel of the wheels on y = 0.
"""
import bpy
import bmesh
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/cannon/source/martijn-cannon.fbx'
TARGET = ROOT / 'assets/cannon/cannon.blend'
LENGTH = 0.62            # island units, breech to muzzle
BUDGET = 3800            # under the hero's 4000 (scripts/model-rules.mjs), with room for rounding

IRON = (0.045, 0.045, 0.05, 1)
IRON_RING = (0.075, 0.07, 0.065, 1)
OAK = (0.30, 0.17, 0.075, 1)
WHEEL = (0.17, 0.095, 0.045, 1)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(SOURCE))
scene = bpy.context.scene
src = [o for o in scene.objects if o.type == 'MESH'][0]
src.data.transform(src.matrix_world)
src.matrix_world = Matrix()
for o in list(scene.objects):
    if o is not src:
        bpy.data.objects.remove(o, do_unlink=True)

# Into island space before anything is measured: bore from +x to -Y (the island's +Z), scaled, the
# wheels' lowest point on z = 0 and the carriage's footprint centred on the origin.
pts = [v.co.copy() for v in src.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
k = LENGTH / (hi.x - lo.x)
mid = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
src.data.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Scale(k, 4) @ Matrix.Translation(-mid))

# The loose pieces, each its own object.
bpy.context.view_layer.objects.active = src
src.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
pieces = [o for o in scene.objects if o.type == 'MESH']


def box(o):
    vs = [v.co for v in o.data.vertices]
    return (Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))),
            Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs))))


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


barrel = max(pieces, key=tris)
blo, bhi = box(barrel)
# The trunnion bar: long across the bore (x here, after the turn), thin along it and in height, and
# level with the barrel's middle. Its middle is the trunnion axis.
across = [o for o in pieces if o is not barrel and tris(o) < 60
          and (box(o)[1].x - box(o)[0].x) > 0.8 * (bhi.x - blo.x)]
if len(across) != 1:
    raise ValueError(f'expected one trunnion bar, found {len(across)}')
bar = across[0]
alo, ahi = box(bar)
TRUNNION = Vector((0, (alo.y + ahi.y) / 2, (alo.z + ahi.z) / 2))
# The two big front trucks (each a wheel with its hub, 704 triangles in the source) and the two
# small rear ones under the step of the cheeks: everything touching the ground that is round.
wheels = [o for o in pieces if o not in (barrel, bar) and box(o)[0].z < 0.01 and 100 < tris(o) < 800
          and abs((box(o)[1].y - box(o)[0].y) - (box(o)[1].z - box(o)[0].z)) < 0.02]
if len(wheels) < 2:
    raise ValueError(f'expected the wheels, found {len(wheels)}')
small = lambda o: tris(o) < 120
print('trunnion', tuple(round(v, 4) for v in TRUNNION), 'wheels', len(wheels), flush=True)


def paint(o, colour, ring=None):
    attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    o.data.color_attributes.active_color = attr
    for poly in o.data.polygons:
        c = colour
        # The barrel's reinforcing rings and muzzle swell stand proud of the bore: a touch lighter.
        if ring is not None:
            r = math.hypot(poly.center.x - TRUNNION.x, poly.center.z - ring(poly.center.y))
            if r > 0.071 * LENGTH / 0.62:
                c = IRON_RING
        for li in poly.loop_indices:
            attr.data[li].color = c
    for p in o.data.polygons:
        p.use_smooth = False


# Planar dissolve first (it costs no shape), then a collapse per piece by its share.
def reduce(o, ratio):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    flat = o.modifiers.new('Flat', 'DECIMATE')
    flat.decimate_type = 'DISSOLVE'
    flat.angle_limit = math.radians(2)
    bpy.ops.object.modifier_apply(modifier=flat.name)
    tri = o.modifiers.new('Tri', 'TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=tri.name)
    if ratio < 1:
        dec = o.modifiers.new('Budget', 'DECIMATE')
        dec.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=dec.name)


SHARE = {'barrel': 1.0, 'wheel': 0.55, 'small': 0.45, 'carriage': 0.9}
for o in pieces:
    kind = 'barrel' if o in (barrel, bar) else 'wheel' if o in wheels else 'small' if small(o) else 'carriage'
    reduce(o, SHARE[kind])
total = sum(tris(o) for o in pieces)
print('triangles after reduction', total, flush=True)
if total > BUDGET:
    raise ValueError(f'{total} triangles is over {BUDGET}: lower a SHARE')

# The barrel's axis, for the rings: a line from the breech to the muzzle through the trunnion.
bv = [v.co for v in barrel.data.vertices]
front = min(v.y for v in bv)
mouth = [v for v in bv if v.y < front + 0.01]
MUZZLE = Vector((sum(v.x for v in mouth) / len(mouth), front, sum(v.z for v in mouth) / len(mouth)))
slope = (MUZZLE.z - TRUNNION.z) / (MUZZLE.y - TRUNNION.y)
axis_z = lambda y: TRUNNION.z + slope * (y - TRUNNION.y)
print('muzzle', tuple(round(v, 4) for v in MUZZLE),
      'rest elevation', round(math.degrees(math.atan2(MUZZLE.z - TRUNNION.z, TRUNNION.y - MUZZLE.y)), 2), flush=True)

for o in pieces:
    if o is barrel:
        paint(o, IRON, ring=axis_z)
    elif o is bar or small(o):
        paint(o, IRON)
    elif o in wheels:
        paint(o, WHEEL)
    else:
        paint(o, OAK)


def join(objs, name, origin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = o.data.name = name
    o.data.transform(Matrix.Translation(-origin))
    o.location = origin
    o.data.materials.clear()
    mat = bpy.data.materials.get('plain:cannon paint') or bpy.data.materials.new('plain:cannon paint')
    mat.diffuse_color = (1, 1, 1, 1)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.material_index = 0
    o['building_part'] = True
    return o


carriage = join([o for o in pieces if o not in (barrel, bar)], 'cannon carriage', Vector((0, 0, 0)))
gun = join([barrel, bar], 'cannon barrel', TRUNNION)

muzzle = bpy.data.objects.new('anchor.muzzle', None)
muzzle.location = MUZZLE
scene.collection.objects.link(muzzle)

bpy.context.view_layer.update()
scene.unit_settings.system = 'NONE'
scene.unit_settings.scale_length = 1
scene['building_height'] = max(max((o.matrix_world @ v.co).z for v in o.data.vertices) for o in (carriage, gun))
print('cannon', tris(carriage), '+', tris(gun), 'triangles; height', round(scene['building_height'], 3), flush=True)
TARGET.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'cannon'})
