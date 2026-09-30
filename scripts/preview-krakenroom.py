"""The Salty Kraken's hall, built and rendered without baking anything: the shell and the dressing
(scripts/krakenroom/*.py) and every ship's part of the kit set where web/js/kraken-layout.js puts it.

    node scripts/blender.mjs --background --python scripts/preview-krakenroom.py [-- --ao] [-- --only cutaway]

Writes assets/piratetavern_room/renders/<view>.png (gitignored): `cutaway` is the whole hall from
above at 45 degrees with the lid and the near walls left out - the view of the keeper's concept
drawing - and the others stand inside at about a settler's eye. Eevee with the room's seven lights
(kraken-layout.js LIGHTS) and a dim warm ambient. `--ao` bakes the ambient occlusion first, as the
real bake does (slower). The Blender render has no plank or stone sheets; the game has.

A module in scripts/krakenroom/ has `build(L)`, L being the layout as a dict; anything it emits
inside `geom.lid()` is the lid, and anything inside `geom.group('near')` (the south and east walls
and whatever stands on them) is left out of the cutaway.
"""
import bpy
import importlib
import json
import math
import subprocess
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
only = args[args.index('--only') + 1] if '--only' in args else None
out = ROOT / 'assets/piratetavern_room/renders'
out.mkdir(parents=True, exist_ok=True)
L = json.loads(subprocess.run(['node', str(ROOT / 'scripts/kraken-layout-json.mjs')], capture_output=True, text=True, check=True).stdout)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, str(ROOT / 'scripts/krakenkit'))
sys.path.insert(0, str(ROOT / 'scripts/krakenroom'))
geom = importlib.import_module('geom')
for name in ('shell', 'dressing'):
    if (ROOT / 'scripts/krakenroom' / f'{name}.py').exists():
        importlib.import_module(name).build(L)
total, top = geom.flush('Kraken')
print(f'hall: {total} triangles')
for label, n in top:
    print(f'  {n:6d}  {label}')

# The kit, placed as pirate-tavern.js places it.
K = L['KIT']
places = [('stern', K['stern'], 0), ('counter', K['counter'], 0), ('mast', K['mast'], K['mast'].get('ry', 0)),
          ('jukebox', K['jukebox'], K['jukebox'].get('ry', 0)), ('figurehead', K['figurehead'], K['figurehead'].get('ry', 0))]
s = K['stools']
places += [('stool', {'x': s['x0'] + i * s['step'], 'z': s['z'], 'y': s['y']}, 0) for i in range(s['n'])]
places += [('gunport', {'x': g['x'], 'z': L['HALL']['z1'], 'y': L['F'] + 0.62}, math.pi) for g in K['gunports']]
places += [('skullsconce', c, c.get('ry', 0)) for c in K['sconces']]
places += [('skulllamp', K['skulllamp'], 0)]
places += [('bow', K['bow'], 0)]
places += [('wheel', K['wheel'], 0), ('rudder', K['rudder'], 0)]
places += [('sloop', {'x': sl['x'], 'y': sl['y'] - K['sloop']['flame'], 'z': sl['z']}, 0) for sl in L['SLOOPS']]
for name, at, ry in places:
    try:
        mod = importlib.import_module(name)
    except ModuleNotFoundError:
        continue
    with geom.frame(geom.M((at['x'], at.get('y', L['F']), at['z']), ry, scale=at.get('s', 1))):
        mod.build()
    geom.flush(f'kit {name} {at["x"]:.2f}', groups=False)
if '--ao' in args:
    geom.bake_ao(list(bpy.context.scene.objects))

scene = bpy.context.scene
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        pass
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
for m in bpy.data.materials:
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = m.diffuse_color
    if '--ao' in args:
        attr = m.node_tree.nodes.new('ShaderNodeVertexColor')
        attr.layer_name = 'ao'
        m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    if m.get('emissive', 0):
        bsdf.inputs['Emission Color'].default_value = m.diffuse_color
        broad = any(k in m.name for k in ('niche', 'pane'))
        bsdf.inputs['Emission Strength'].default_value = .6 if broad else 3.0
b = lambda x, y, z: Vector((x, -z, y))
for light in L['LIGHTS']:
    d = bpy.data.lights.new('l', 'POINT')
    d.energy = 30 * light['intensity'] * (light['dist'] / 2.6) ** 2
    d.color = [((light['hex'] >> k) & 255) / 255 for k in (16, 8, 0)]
    d.shadow_soft_size = .05
    o = bpy.data.objects.new('l', d)
    o.location = b(*light['at'])
    scene.collection.objects.link(o)
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.06, .045, .035, 1)
scene.world = world
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
F = L['F']
LV = L['LEVEL']
P, B, C, U = LV['pit'], LV['bar'], LV['captain'], LV['top']
TOP = L['TOP']
VIEWS = {
    # From the door into the hall at a settler's camera height: what you see when you come in.
    'door': ((0, F + 1.0, 6.6), (0, B + 0.5, -3.0), 16),
    'pit': ((-4.6, P + 0.8, 4.8), (0.2, P + 0.8, -3.2), 16),
    'bar': ((-2.6, B + 0.7, -3.5), (0.6, B + 0.5, -6.6), 18),
    'west': ((2.0, P + 0.9, 1.2), (-8.6, 1.5, 0.2), 15),
    'east': ((-3.0, P + 0.9, 1.2), (7.6, 1.6, -0.6), 15),
    'captain': ((6.2, C + 0.6, -0.6), (9.0, C + 0.9, -5.8), 17),
    'gallery': ((-8.2, U + 0.55, 2.4), (5.0, U - 0.4, -3.0), 16),
    'bow': ((0.6, B + 0.7, -3.4), (0.0, B + 2.3, -6.6), 16),
    'westgal': ((-2.5, P + 0.9, 3.2), (-8.6, C + 0.6, -2.2), 15),
    'roof': ((0.5, U + 0.4, 4.5), (0.0, TOP - 0.3, -3.0), 13),
    'pool': ((4.9, F + 0.8, -0.4), (9.0, 1.1, 4.4), 16),
    'up': ((1.2, P + 0.5, 3.4), (0.0, 4.0, -2.2), 13),
}
for name, (eye, target, lens) in VIEWS.items():
    if only and name != only:
        continue
    cam.data.type = 'PERSP'
    cam.data.lens = lens
    cam.location = b(*eye)
    cam.rotation_euler = (b(*target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / f'{name}.png')
    bpy.ops.render.render(write_still=True)
# The cutaway: the lid and whatever is labelled `near` left out.
if not only or only == 'cutaway':
    for o in scene.objects:
        if ' roof ' in o.name or ' near ' in o.name:
            o.hide_render = True
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 26.0
    d = Vector((-.55, .8, -.62)).normalized()        # looking down from the south-east, like the concept
    cam.location = b(0.4, 2.4, 0.4) - d * 30
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(out / 'cutaway.png')
    bpy.ops.render.render(write_still=True)
