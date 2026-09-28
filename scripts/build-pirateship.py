"""Build the game pirate ship from Greggory_Fisher's "Low-Poly Pirate Ship".

blender --background --python scripts/build-pirateship.py -- [preview.png] [side|deck]

Source: https://sketchfab.com/3d-models/low-poly-pirate-ship-c5e06cf1ba164b749cb47044fe7b86eb
by Greggory_Fisher, CC-BY-4.0 - credited in assets/pirateship/README.md, which is what the
licence asks of us. Kept as assets/pirateship/source/pirateship-greggoryfisher.glb.

The source is 73k triangles in 27 parts, one per material and no textures. The game keeps
the Benchy's recipe (scripts/build-benchy.py): every part decimated to a share of BUDGET,
its material's colour baked into a vertex colour, everything joined under one material so
the ship is one draw call. Turned bow to -Y (game +Z), scaled to about five Benchies
long, and set down with the origin on the waterline in the middle of the hull.
"""
import bpy
import sys
from pathlib import Path
from mathutils import Vector, Matrix
import math

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/pirateship/source/pirateship-greggoryfisher.glb'
TARGET = ROOT / 'assets/pirateship/pirateship.blend'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = args[0] if args else None
VIEW = args[1] if len(args) > 1 else 'side'

BUDGET = 10000
LENGTH = 13.0         # island units, hull and bowsprit: ten Benchies (~1.3) - five read as a toy beside a settler
WATERLINE = 7.0       # source units above the keel (its main deck is at 12.55)
# Parts that are mostly small repeated detail give up more than their share: 12k of cannon
# carriages and 8k of shot read the same at a tenth of that from a boat's length away.
# What each part keeps, as a share of its own triangles; parts under KEEP_UNDER are left
# whole, because a sail of 128 or a mast decimated to a quarter simply disappears.
KEEP = {'M_Cannon_Wood_01': 0.05, 'M_Cannon_Balls': 0.03, 'M_Rope': 0.08, 'M_Cannon_Wood_02': 0.2,
        'M_Cannon_01': 0.25, 'M_Cannon_02': 0.25, 'M_Barrel_Wood_1': 0.25, 'M_Barrel_Wood_2': 0.25,
        'M_Metal_Dark': 0.12, 'M_Metal_Light': 0.15}
KEEP_UNDER = 2000
# Clutter nobody sees from the water, and the source's baked shadow decals (the island
# lights its own).
DROP = {'M_Cups', 'M_Rum', 'M_Bottle_Transparent', 'M_Shadows'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene
parts = [o for o in scene.objects if o.type == 'MESH' and not (o.data.materials and o.data.materials[0].name in DROP)]
for o in list(scene.objects):
    if o not in parts:
        bpy.data.objects.remove(o, do_unlink=True)

total = 0
for o in parts:
    o.data.calc_loop_triangles(); total += len(o.data.loop_triangles)
share = BUDGET / total

def colour_of(m):
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = n.inputs['Base Color'].default_value
                return (c[0], c[1], c[2], 1.0)
    c = m.diffuse_color
    return (c[0], c[1], c[2], 1.0)

for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    # World transform into the vertices first: glTF import parents under a root with a
    # rotation, and the join below must not inherit it.
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix()
    o.data.calc_loop_triangles()
    count = len(o.data.loop_triangles)
    mname = o.data.materials[0].name if o.data.materials else ''
    want = count if count < KEEP_UNDER else int(count * KEEP.get(mname, 0.3))
    if count > want:
        # Coplanar triangles first, which costs no shape at all; then collapse what is left.
        flat = o.modifiers.new('Flat', 'DECIMATE'); flat.decimate_type = 'DISSOLVE'; flat.angle_limit = math.radians(3)
        bpy.ops.object.modifier_apply(modifier=flat.name)
        bpy.ops.object.modifier_add(type='TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=o.modifiers[-1].name)
        o.data.calc_loop_triangles(); count = len(o.data.loop_triangles)
    if count > want:
        dec = o.modifiers.new('Game triangle budget', 'DECIMATE')
        dec.ratio = want / count
        bpy.ops.object.modifier_apply(modifier=dec.name)
    rgb = colour_of(o.data.materials[0]) if o.data.materials else (0.5, 0.5, 0.5, 1)
    attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    o.data.color_attributes.active_color = attr
    for c in attr.data: c.color = rgb
    for p in o.data.polygons: p.use_smooth = False
    o.data.calc_loop_triangles()
    print('part', mname, count, '->', len(o.data.loop_triangles), flush=True)

# Bow is the source's +X (a first bake took -X and the ship sailed stern first); turn it to -Y, scale, and put the waterline at z = 0.
pts = [v.co for o in parts for v in o.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
k = LENGTH / (hi.x - lo.x)
# The keel on z = 0, like every baked set's origin on the ground (model-rules); the game drops
# the hull by its draught, as it does the Benchy's.
mid = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
M = Matrix.Scale(k, 4) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(-mid)
for o in parts:
    o.data.transform(M)

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = 'pirateship hull'
ship.data.materials.clear()
paint = bpy.data.materials.new('plain:pirateship paint'); paint.diffuse_color = (1, 1, 1, 1)
ship.data.materials.append(paint)
for p in ship.data.polygons: p.material_index = 0
ship['building_part'] = True
scene.unit_settings.system = 'NONE'; scene.unit_settings.scale_length = 1
ship.data.calc_loop_triangles()
zs = [v.co.z for v in ship.data.vertices]
scene['building_height'] = max(zs)
print('pirate ship triangles:', len(ship.data.loop_triangles),
      'size', tuple(round(x, 2) for x in ship.dimensions), 'keel', round(min(zs), 2), flush=True)
# The deck along the centreline and a little off it (clear of the masts), for the helm and
# for the walkable deck: straight down from above, the first hit under DECK_CEIL.
from mathutils.bvhtree import BVHTree
tree = BVHTree.FromObject(ship, bpy.context.evaluated_depsgraph_get())
DECK_CEIL = 5.2
for yy in [i * 0.5 for i in range(-13, 14)]:
    hits = []
    for xx in (0.0, 0.9, -0.9):
        h = tree.ray_cast(Vector((xx, yy, DECK_CEIL)), Vector((0, 0, -1)))
        hits.append(round(h[0].z, 3) if h[0] else None)
    print('deck y', yy, hits, flush=True)
TARGET.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
import runpy
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'pirateship'})

if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = scene.render.resolution_y = 1000
    world = bpy.data.worlds.new('w'); scene.world = world
    world.color = (0.93, 0.93, 0.95)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    if VIEW == 'deck':
        cam.data.lens = 22
        target = Vector((0, -2.5, 0.8))
        cam.location = Vector((0.3, 2.4, 1.9))
    else:
        cam.data.lens = 50
        target = Vector((0, 0, 2.0))
        cam.location = Vector((11.0, -9.5, 6.0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
