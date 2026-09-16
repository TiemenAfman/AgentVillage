"""Run with Blender --background --python scripts/build-settler.py.

Editable Blender source and a compact, colour-slot mesh for the synchronous avatar API.
Coordinates in the modelling helpers are AgentVillage's: Y up, facing +Z.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'settler'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
COLORS = dict(skin=0xf1c9a5, tunic=0xf0e2c8, trim=0x6b4a2f,
              hat=0xc9a75c, hair=0x543525, dark=0x302c30,
              brass=0xd9a33d, pack=0x98633d, blanket=0x61877c, steel=0x87969e)
materials = {}
for name, color in COLORS.items():
    mat = bpy.data.materials.new(name)
    rgb = [((color >> shift) & 255) / 255 for shift in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85
    materials[name] = mat

parts = []
variant = 'body'
def xyz(p): return (p[0], -p[2], p[1])
def finish(name, slot):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(materials[slot])
    obj['avatar_slot'] = slot
    obj['avatar_variant'] = variant
    parts.append(obj)
    return obj

def ball(name, pos, scale, slot, segments=10, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=xyz(pos))
    obj = finish(name, slot)
    obj.scale = (scale[0], scale[2], scale[1])
    return obj

def box(name, pos, size, slot, bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(pos))
    obj = finish(name, slot)
    obj.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft worn edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def rod(name, start, end, radius, slot, top=None, vertices=8):
    a, b = Vector(xyz(start)), Vector(xyz(end))
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if top is None else top, depth=(b-a).length, location=(a+b)/2)
    obj = finish(name, slot)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return obj

# Large shoes, short legs, a pear-shaped tunic and separate rounded sleeves.
for sign, side in [(-1, 'Left'), (1, 'Right')]:
    x = sign * .052
    box(side+' boot', (x,.028,.023), (.083,.056,.125), 'trim', .012)
    rod(side+' trousers', (x,.044,0), (x,.143,0), .030, 'trim')
    rod(side+' stocking cuff', (x,.080,0), (x,.098,0), .032, 'tunic')
    ball(side+' sleeve', (sign*.106,.245,0), (.046,.057,.049), 'tunic')
    rod(side+' cuff', (sign*.124,.205,.010), (sign*.128,.223,.008), .030, 'trim')
    ball(side+' hand', (sign*.131,.190,.018), (.028,.034,.031), 'skin', 8)
ball('Full tunic', (0,.204,0), (.107,.111,.075), 'tunic', 12, 8)
rod('Tunic hem', (0,.117,0), (0,.137,0), .097, 'trim', .099, 12).scale.y = .72
rod('Belt', (0,.174,0), (0,.194,0), .108, 'trim', .108, 12).scale.y = .72
box('Belt buckle', (0,.185,.080), (.025,.023,.009), 'brass', .003)
rod('Neck', (0,.281,0), (0,.319,0), .031, 'skin')
ball('Head', (0,.363,.008), (.083,.085,.074), 'skin', 12, 8)
ball('Hair cap', (0,.392,-.003), (.085,.059,.073), 'hair', 12, 6)
# Forehead and face sit in front of the hair silhouette.
ball('Face', (0,.360,.036), (.072,.065,.055), 'skin', 12, 8)
for sign, side in [(-1,'Left'), (1,'Right')]:
    ball(side+' ear', (sign*.080,.359,.010), (.018,.026,.019), 'skin', 8)
    ball(side+' eye', (sign*.029,.383,.085), (.007,.009,.0045), 'dark', 8, 4)
    rod(side+' eyebrow', (sign*.018,.399,.080), (sign*.040,.399,.076), .004, 'hair', vertices=5)
    ball(side+' sideburn', (sign*.070,.375,.040), (.012,.026,.019), 'hair', 8, 4)
ball('Round nose', (0,.363,.093), (.018,.019,.021), 'skin', 8)
rod('Smile left', (-.018,.340,.082), (0,.336,.087), .0025, 'hair', vertices=5)
rod('Smile right', (0,.336,.087), (.018,.340,.082), .0025, 'hair', vertices=5)
# Two shoulder straps, a flap backpack, rolled blanket and a small work hammer.
variant = 'gear'
for sign in [-1,1]:
    rod('Shoulder strap', (sign*.056,.183,.064), (sign*.060,.293,.034), .010, 'trim', vertices=4)
    rod('Strap over shoulder', (sign*.060,.293,.034), (sign*.060,.280,-.098), .010, 'trim', vertices=4)
box('Canvas backpack', (0,.218,-.105), (.158,.150,.075), 'pack', .017)
box('Backpack flap', (0,.268,-.147), (.165,.049,.014), 'trim', .008)
box('Pack clasp', (0,.235,-.150), (.019,.023,.007), 'brass', .002)
rod('Bedroll', (-.095,.315,-.096), (.095,.315,-.096), .036, 'blanket', vertices=10)
for x in [-.060,.060]:
    rod('Bedroll tie', (x-.006,.315,-.096), (x+.006,.315,-.096), .037, 'trim', vertices=10)
rod('Hammer handle', (.118,.126,-.073), (.118,.266,-.073), .010, 'pack')
box('Hammer head', (.118,.269,-.073), (.066,.030,.035), 'steel', .004)

for variant in ['wide','band','cap','sailor','dome','wizard']:
    if variant == 'wide':
        rod('Straw brim', (0,.426,0), (0,.439,0), .127, 'hat', vertices=12)
        rod('Straw crown', (0,.437,0), (0,.482,0), .074, 'hat', .057, 10)
        rod('Hat ribbon', (0,.440,0), (0,.450,0), .075, 'trim', .071, 10)
    elif variant == 'band':
        rod('Head band', (0,.410,0), (0,.429,0), .083, 'hat', vertices=12)
    elif variant in ['cap','sailor']:
        rod('Cap crown', (0,.422,0), (0,.463,0), .079, 'hat', .094 if variant == 'cap' else .087, 10)
        box('Cap visor', (0,.428,.078), (.119,.013,.064), 'hat', .006)
        rod('Cap band', (0,.420,0), (0,.432,0), .080, 'trim', vertices=10)
    elif variant == 'dome':
        ball('Wool cap', (0,.422,0), (.087,.052,.080), 'hat', 10, 6)
        rod('Wool rim', (0,.419,0), (0,.435,0), .088, 'hat', vertices=10)
    else:
        rod('Pointed brim', (0,.425,0), (0,.437,0), .109, 'hat', vertices=10)
        rod('Pointed crown', (0,.435,0), (.021,.488,-.007), .078, 'hat', .005, 8)

# Export the same colour-slot data when building or later editing the .blend.
import runpy
bpy.context.scene['avatar_eye_y'] = .383
runpy.run_path(str(ROOT / 'scripts/export-settler.py'))

for obj in parts:
    obj.hide_render = obj['avatar_variant'] not in ['body','gear','wide']
    obj.hide_set(obj.hide_render)

# A reusable studio in the .blend, with a full-body three-quarter preview.
bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.001))
ground = bpy.context.object
ground.name = 'Studio floor (not exported)'
mat = bpy.data.materials.new('Studio sage')
mat.diffuse_color = (.12,.17,.16,1)
ground.data.materials.append(mat)
def aim(obj, point): obj.rotation_euler = (Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.78,-1.25,.76))
camera = bpy.context.object
aim(camera, (0,0,.24))
camera.data.type = 'ORTHO'
camera.data.ortho_scale = .70
bpy.context.scene.camera = camera
for name, loc, energy, size in [('Key',(-1,-2,3),180,2),('Fill',(2,-.5,1),90,2),('Rim',(0,2,2),220,1.5)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.shape = 'DISK'
    light.data.size = size
    aim(light,(0,0,.24))
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 1000
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.world.color = (.25,.25,.25)
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(OUT / 'settler-preview.png')
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        area.spaces.active.region_3d.view_perspective = 'CAMERA'
bpy.ops.object.select_all(action='DESELECT')
parts[0].select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-settler.blend'))
bpy.ops.render.render(write_still=True)
