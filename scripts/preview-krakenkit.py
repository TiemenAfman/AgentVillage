"""Build one object of the Salty Kraken's kit on its own and render it, without baking anything.

    node scripts/blender.mjs --background --python scripts/preview-krakenkit.py -- stern [outdir]

Renders <outdir>/<object>-front.png, -side.png and -three.png, with the ambient occlusion baked into
the vertex colours as the kit's bake does (`--flat` leaves it out: <object>-front-flat.png ...) (default outdir:
assets/krakenkit/renders/, gitignored like every set's renders) and prints the triangle count and
where the triangles went. It writes no .blend and no -mesh.js, so several objects can be worked on
at once; scripts/build-krakenkit.py bakes them all together afterwards.

Eevee with a warm key light and a cool fill, because these are seen indoors by candle light; the
glowing materials glow. The front view is orthographic, straight down the object's +z, so it can
be held against a reference drawing.
"""
import bpy
import importlib
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = [a for a in args if a.startswith('--')]
args = [a for a in args if not a.startswith('--')] + flags
name = args[0]
out = Path(args[1]) if len(args) > 1 and not args[1].startswith('--') else ROOT / 'assets/krakenkit/renders'
out.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, str(ROOT / 'scripts/krakenkit'))
geom = importlib.import_module('geom')
obj = importlib.import_module(name)
obj.build()
total, top = geom.flush(obj.ASSET, groups=False)
if '--flat' not in args:
    geom.bake_ao(list(bpy.context.scene.objects))
print(f'{obj.ASSET}: {total} triangles')
for label, n in top:
    print(f'  {n:6d}  {label}')

scene = bpy.context.scene
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        pass
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x, scene.render.resolution_y = 1000, 700
for m in bpy.data.materials:
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = m.diffuse_color
    if '--flat' not in args:
        attr = m.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'ao'
        m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    if m.get('emissive', 0):
        bsdf.inputs['Emission Color'].default_value = m.diffuse_color
        bsdf.inputs['Emission Strength'].default_value = 2.0

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in scene.objects:
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
mid, size = (lo + hi) / 2, max(hi - lo)

world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.12, .12, .13, 1)
scene.world = world
for kind, energy, color, at in (('SUN', 3.0, (1, .85, .65), (2, -4, 5)), ('SUN', .8, (.5, .7, 1), (-4, -2, 2))):
    d = bpy.data.lights.new(kind, kind)
    d.energy, d.color = energy, color
    o = bpy.data.objects.new(kind, d)
    o.rotation_euler = (mid - (mid + Vector(at))).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(o)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
# Blender axes: the island's front (+z) is Blender's -y.
for view, direction, ortho in (('front', (0, -1, 0), True), ('side', (-1, 0, 0), True), ('three', (.6, -1, .5), False)):
    d = Vector(direction).normalized()
    cam.data.type = 'ORTHO' if ortho else 'PERSP'
    # ortho_scale is the width of the frame; a tall object needs it wide enough that its height
    # fits in the frame's 0.7 of that.
    across = (hi - lo).x if view == 'front' else (hi - lo).y
    cam.data.ortho_scale = max(across, (hi - lo).z / .7) * 1.12
    cam.data.lens = 40
    cam.location = mid + d * size * (3 if ortho else 2.2)
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / f'{name}-{view}{"-flat" if "--flat" in args else ""}.png')
    bpy.ops.render.render(write_still=True)
