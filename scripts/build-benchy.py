"""Build the game Benchy from the coloured Blender studio source.

blender --background --python scripts/build-benchy.py
The source keeps the editable parts; the game mesh keeps their colours as vertex
colours under one material, preserving the boat's single draw call and part name.
"""
import bpy
import bmesh
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/benchy/source/Benchy.blend'
TARGET = ROOT / 'assets/benchy/benchy.blend'
# The original cabin is 28.5 mm high. The studio source uses 0.1 unit/mm.
SCALE = (0.54 + 0.08) / 2.85
BUDGETS = {'Hull': 1400, 'Bridge roof': 350, 'Bridge walls': 260,
           'Gunwale': 350, 'Deck surface': 220, 'Chimney body': 120,
           'Chimney top': 180}

bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
parts = sorted(list(bpy.data.collections['01 | BENCHY - losse onderdelen'].objects), key=lambda o: o.name)
for o in list(bpy.context.scene.objects):
    if o not in parts:
        bpy.data.objects.remove(o, do_unlink=True)
for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    o.modifiers.clear()
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.00001)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=0.000001)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(o.data); bm.free()
    o.data.calc_loop_triangles()
    count = len(o.data.loop_triangles)
    budget = BUDGETS.get(o.name, 100)
    original = o.data.copy()
    if count > budget:
        dec = o.modifiers.new('Game triangle budget', 'DECIMATE')
        dec.ratio = budget / count
        bpy.ops.object.modifier_apply(modifier=dec.name)
    o.data.calc_loop_triangles()
    if len(o.data.loop_triangles) > budget * 1.1:
        # The print STL has coincident internal faces that collapse cannot remove.
        # Voxel remeshing only these parts repairs them without closing the cabin.
        damaged = o.data
        o.data = original.copy()
        bpy.data.meshes.remove(damaged)
        o.data.remesh_voxel_size = 0.025
        bpy.ops.object.voxel_remesh()
        o.data.calc_loop_triangles()
        dec = o.modifiers.new('Repaired game budget', 'DECIMATE')
        dec.ratio = budget / len(o.data.loop_triangles)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    bpy.data.meshes.remove(original)
    rgb = o.data.materials[0].diffuse_color[:]
    attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    o.data.color_attributes.active_color = attr
    for c in attr.data: c.color = rgb
    world = o.matrix_world.copy()
    for v in o.data.vertices:
        p = world @ v.co
        # Studio bow +X becomes Blender -Y, hence game +Z.
        v.co = Vector((p.y, -p.x, p.z)) * SCALE
    o.location = (0, 0, 0)
    o.rotation_euler = (0, 0, 0)
    o.scale = (1, 1, 1)
    for p in o.data.polygons: p.use_smooth = False
    print(o.name, len(o.data.polygons), flush=True)

points = [v.co for o in parts for v in o.data.vertices]
offset = Vector(((min(p.x for p in points)+max(p.x for p in points))/2,
                 (min(p.y for p in points)+max(p.y for p in points))/2,
                 min(p.z for p in points)))
for o in parts:
    for v in o.data.vertices: v.co -= offset
funnel = next(o for o in parts if o.name == 'Chimney top')
smoke = sum((v.co for v in funnel.data.vertices), Vector()) / len(funnel.data.vertices)
smoke.z = max(v.co.z for v in funnel.data.vertices)
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
hull = bpy.context.object; hull.name = 'benchy hull'
hull.data.materials.clear()
m = bpy.data.materials.new('plain:benchy paint'); m.diffuse_color=(1,1,1,1)
hull.data.materials.append(m)
for p in hull.data.polygons: p.material_index=0
hull['building_part'] = True
scene = bpy.context.scene
scene.unit_settings.system = 'NONE'; scene.unit_settings.scale_length = 1
scene['building_height'] = max(v.co.z for v in hull.data.vertices)
bpy.ops.object.empty_add(location=smoke)
anchor = bpy.context.object; anchor.name='anchor.smoke'
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET':'benchy'})
