"""Render a saved Blender model from all sides, with and without backface culling.

node scripts/blender.mjs --background --python scripts/inspect-model.py -- model.blend output-dir

The paired views distinguish missing geometry from reversed or one-sided faces. Nothing
is saved back to the source file. Vertex paint is preserved, as on the pirate ship.
"""
import bpy
import argparse
import json
import sys
from pathlib import Path
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('source')
parser.add_argument('output')
parser.add_argument('--target', type=float, nargs=3, help='Detail centre in Blender coordinates')
parser.add_argument('--span', type=float, help='Width of an orthographic detail view')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
source, output = args.source, args.output
out = Path(output).resolve()
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(Path(source).resolve()))
scene = bpy.context.scene
objects = [o for o in scene.objects if o.type == 'MESH' and o.get('building_part')]
if not objects:
    raise ValueError('No building_part meshes in the source file')
for obj in scene.objects:
    obj.hide_render = obj not in objects
points = [o.matrix_world @ Vector(p) for o in objects for p in o.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
middle = (lo + hi) / 2
if args.target:
    middle = Vector(args.target)
reach = (hi - lo).length
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'VERTEX' if all(o.data.color_attributes for o in objects) else 'MATERIAL'
shading.show_shadows = False
shading.show_cavity = True
shading.cavity_type = 'BOTH'
shading.background_type = 'VIEWPORT'
shading.background_color = (0.16, 0.22, 0.28)
scene.view_settings.view_transform = 'Standard'
scene.display.render_aa = '16'
scene.render.resolution_x = scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
cam = bpy.data.objects.new('Inspection camera', bpy.data.cameras.new('Inspection camera'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.clip_start = 0.001
cam.data.clip_end = reach * 10
views = {
    'starboard': (1, 0, 0), 'port': (-1, 0, 0),
    'bow': (0, -1, 0), 'stern': (0, 1, 0),
    'top': (0, 0, 1), 'bottom': (0, 0, -1),
    'bow-quarter': (3, -4, 2), 'stern-quarter': (-3, 4, 2),
    'deck': (1, 0, 2), 'hull-below': (3, 4, -2),
}
for name, direction in views.items():
    cam.location = middle + Vector(direction).normalized() * reach * 3
    cam.rotation_euler = (middle - cam.location).to_track_quat('-Z', 'Y').to_euler()
    rotation = cam.rotation_euler.to_matrix().transposed()
    projected = [rotation @ (p - middle) for p in points]
    cam.data.ortho_scale = max(max(p[i] for p in projected) - min(p[i] for p in projected) for i in (0, 1)) * 1.12
    if args.span:
        cam.data.ortho_scale = args.span
    for cull in (True, False):
        shading.show_backface_culling = cull
        scene.render.filepath = str(out / f'{name}-{"culled" if cull else "two-sided"}.png')
        bpy.ops.render.render(write_still=True)
report = {'source': str(Path(source).resolve()), 'bounds': [list(lo), list(hi)], 'objects': []}
for obj in objects:
    obj.data.calc_loop_triangles()
    report['objects'].append({'name': obj.name, 'triangles': len(obj.data.loop_triangles)})
(out / 'inspection.json').write_text(json.dumps(report, indent=2))
print(f'Inspection complete: {out}', flush=True)
