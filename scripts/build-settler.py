"""Run with Blender --background --python scripts/build-settler.py.

Editable Blender source and a compact, colour-slot mesh for the synchronous avatar API.
Coordinates in the modelling helpers are Promptholm's: Y up, facing +Z.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'settler'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
COLORS = dict(skin=0xf1c9a5, tunic=0xf0e2c8, trim=0x6b4a2f,
              hat=0xc9a75c, hair=0x543525, dark=0x302c30,
              brass=0xd9a33d, pack=0x98633d, blanket=0x61877c, steel=0x87969e,
              crimson=0xb22222, flame=0xff8a1f, ember=0xffd45a)
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

def ball(name, pos, scale, slot, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=max(16, segments), ring_count=max(10, rings), radius=1, location=xyz(pos))
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
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def rod(name, start, end, radius, slot, top=None, vertices=16):
    a, b = Vector(xyz(start)), Vector(xyz(end))
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if top is None else top, depth=(b-a).length, location=(a+b)/2)
    obj = finish(name, slot)
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return obj

# Concept 3 is the production traveller; equipment still uses the established names.
import importlib.util
import sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('traveller_concepts', ROOT / 'scripts/build-settler-concepts.py')
concept = importlib.util.module_from_spec(spec)
spec.loader.exec_module(concept)
concept.PRODUCTION = True
collection, character_root = concept.character(2)
character_root.rotation_euler.z = 0
SCALE = .94
# Keep the old walking clearance; the concept's taller legs are proportional within it.
character_root.scale = (SCALE, SCALE, SCALE)
slot_map = {'shirt':'tunic', 'leather':'trim', 'eye':'dark', 'metal':'brass'}
head_names = {'Neck','Head','Hair back','Nose bridge','Nose tip','Quiet smile'}
pack_names = ('Backpack','Shoulder strap','Strap adjuster','Pack buckle strap','Rolled blanket','Blanket tie','Blanket roll spiral')
hat_names = {'Soft straw brim','Rounded straw crown','Hat ribbon'}
for obj in list(collection.objects):
    if obj.type not in {'MESH', 'CURVE'}: continue
    name = obj.name
    if name in hat_names:
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    slot = obj.get('avatar_slot', obj.data.materials[0].name.split('.')[0])
    obj['avatar_slot'] = slot_map.get(slot, slot)
    obj['avatar_variant'] = 'body'
    group = 'outfit'
    if name in hat_names:
        obj['avatar_variant'] = 'wide'; group = 'head'
    elif name in head_names or any(name.startswith(side+' '+part) for side in ['Left','Right'] for part in ['ear','eye','brow','side lock']):
        group = 'head'
    elif name.startswith(pack_names):
        obj['avatar_variant'] = 'gear'; group = 'backpack'
    elif name.startswith(('Left ', 'Right ')):
        side = 'left' if name.startswith('Left ') else 'right'
        group = side + ('Arm' if any(word in name for word in ['sleeve','cuff','hand','thumb']) else 'Leg')
    obj['avatar_group'] = group
    # Freeze modifiers and curves in the source: export and renders read the same mesh.
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    parts.append(obj)
variant = 'gear'
gear_start = len(parts)

# Steel-and-brass armour (Plans/uitrusting-en-vasthouden.md): a second attempt at held/worn
# gear after two rounds of code-primitive shapes (flat boxes, then sharper cone-built ones)
# both read wrong next to a Blender-modelled settler - this set uses the same ball/box/rod
# vocabulary and bevel the rest of the settler is built from instead.
#
# Sword and shield are modelled with their grip at GRIP, the same point 'Right hand' sits
# at above - classic-avatar.js re-centres the baked mesh on that point so it can hand
# either one to either fist the way the procedural items already did.
GRIP = (.131, .190, .018)
ball('Sword pommel', (GRIP[0], .148, GRIP[2]), (.014, .014, .014), 'brass', 6, 4)
rod('Sword grip', (GRIP[0], .163, GRIP[2]), (GRIP[0], .213, GRIP[2]), .010, 'trim', vertices=6)
rod('Sword crossguard', (GRIP[0]-.045, .216, GRIP[2]), (GRIP[0]+.045, .216, GRIP[2]), .012, 'brass', .012, 4)
rod('Sword blade', (GRIP[0], .220, GRIP[2]), (GRIP[0], .430, GRIP[2]-.008), .016, 'steel', .003, 4)

# The shield hangs on the outside of the fist: its face is a plate in the YZ plane just
# clear of the hand's outer side, pointing away from the body (+X for the right hand;
# classic-avatar.js mirrors the mesh for the left and turns it a little forward), the way a
# shield strapped to a forearm sits when the arm is down. It used to hang behind the fist in
# Z, facing forward, which - together with the held-out arm pose every item then shared -
# put a torso-sized plate up beside the head. Two brass bars peeking past the crimson face
# read as a rim without a second, larger copy of the face's own shape.
SHIELD_X = GRIP[0] + .048
box('Shield face', (SHIELD_X, .205, GRIP[2]), (.014, .115, .090), 'crimson', .010)
box('Shield rim top', (SHIELD_X+.004, .2625, GRIP[2]), (.018, .013, .102), 'brass', 0)
box('Shield rim bottom', (SHIELD_X+.004, .1475, GRIP[2]), (.018, .013, .102), 'brass', 0)
box('Shield boss', (SHIELD_X+.010, .205, GRIP[2]), (.014, .026, .026), 'brass', 0)
rod('Shield grip', (GRIP[0], .190, GRIP[2]), (SHIELD_X-.006, .190, GRIP[2]), .009, 'trim', vertices=6)

# The torch is held like the sword, grip at GRIP, and stands a little taller than the blade
# so its flame clears the head when the arm is held out. A tapering stave, a brass band
# where the fist would slip, a pitch-soaked wrap at the top and two nested flame cones -
# orange outside, a yellow core peeking out above - because one cone alone reads as a party
# hat. 'flame' and 'ember' are colour slots of their own so avatar.js can make them, and
# only them, glow at night. It is baked under variant 'held' rather than 'gear': 'gear' is
# the "full outfit" avatarPlayerGeometry merges for the character sheet, which already has
# a sword in that fist and a triangle budget the torch would tip over.
variant = 'held'
rod('Torch stave', (GRIP[0], .140, GRIP[2]), (GRIP[0], .330, GRIP[2]), .009, 'pack', .012, 6)
rod('Torch band', (GRIP[0], .228, GRIP[2]), (GRIP[0], .240, GRIP[2]), .0135, 'brass', vertices=6)
rod('Torch wrap', (GRIP[0], .318, GRIP[2]), (GRIP[0], .352, GRIP[2]), .019, 'trim', .021, 8)
rod('Torch flame', (GRIP[0], .350, GRIP[2]), (GRIP[0], .420, GRIP[2]), .024, 'flame', .002, 8)
rod('Torch flame core', (GRIP[0], .352, GRIP[2]+.004), (GRIP[0]+.003, .432, GRIP[2]+.002), .013, 'ember', .001, 6)
variant = 'gear'

# The breastplate sits on 'Full tunic's own centre, slightly larger so it reads as worn
# over the tunic rather than replacing it.
# A fitted cuirass follows the shirt instead of cutting through its lower hem.
concept.M['steel'] = materials['steel']
concept.M['brass'] = materials['brass']
for name, slot, profile in [
    ('Chestplate body', 'steel', [(.178,.078,.059),(.181,.084,.063),(.219,.084,.065),(.251,.080,.068),(.274,.069,.059),(.283,.053,.049)]),
    ('Chestplate trim', 'brass', [(.176,.079,.060),(.178,.085,.064),(.184,.085,.064),(.186,.083,.063)])]:
    obj = concept.rings(name, profile, slot)
    obj['avatar_slot'] = slot; obj['avatar_variant'] = 'gear'
    parts.append(obj)
for sign, side in [(-1,'Left'), (1,'Right')]:
    ball(side+' chestplate pauldron', (sign*.108,.258,0), (.052,.040,.053), 'steel', 6, 5)

# Leggings and sabatons follow the same trousers/boot positions the settler's own legs use,
# so they hang over the limb rather than needing their own guess at where the leg is.
for sign, side in [(-1,'Left'), (1,'Right')]:
    x = sign*.052
    rod(side+' legging', (x,.048,0), (x,.140,0), .036, 'steel', .032, 10)
    rod(side+' knee cop', (x,.128,.006), (x,.146,.016), .038, 'brass', .020, 8)
    box(side+' sabaton', (x,.030,.025), (.090,.060,.135), 'steel', .010)
    box(side+' sabaton trim', (x,.050,.080), (.070,.012,.020), 'brass', 0)

# Fit the retained armour and hat choices to the new body. Bake transforms before export.
for obj in parts[gear_start:]:
    name = obj.name
    obj['avatar_group'] = 'equipment'
    if obj['avatar_variant'] not in ['gear','held']:
        obj.scale.x *= .84; obj.scale.y *= .84
        obj.location.z = .372 + (obj.location.z-.363)*.94
        obj.scale.z *= .94
        obj['avatar_group'] = 'head'
    elif name.startswith(('Sword','Shield','Torch')):
        obj.location += Vector((.120*.91*SCALE-.131, -(.012*SCALE-.018), .195*SCALE-.190))
    elif 'chestplate pauldron' in name:
        obj.location.z += .006
        obj.location.x *= .80
        obj.scale.x *= .81; obj.scale.y *= .87
    elif 'legging' in name or 'knee cop' in name:
        obj.location.x *= .82; obj.location.z *= 1.15
        obj.scale.x *= .87; obj.scale.y *= .87; obj.scale.z *= 1.15
    elif 'sabaton' in name:
        obj.location.x *= .82
        obj.scale.x *= .91; obj.scale.y *= .91
    for face in obj.data.polygons:
        face.use_smooth = not name.startswith(('Sword','Shield'))
    if name.startswith('Chestplate'):
        continue  # tailored rings already have their subdivision surface
    bpy.context.view_layer.objects.active = obj
    bevel = obj.modifiers.new('Equipment soft edge','BEVEL'); bevel.width=.001; bevel.segments=2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
# Every headwear choice is authored directly to the refined head's dimensions.
hat_spec = importlib.util.spec_from_file_location('traveller_hats', ROOT / 'scripts/build-settler-hats.py')
hats = importlib.util.module_from_spec(hat_spec)
hat_spec.loader.exec_module(hats)
parts.extend(hats.build_hats(materials))

rig = dict(
    leftLeg=[-.047*.91*SCALE,.156*SCALE,0], rightLeg=[.047*.91*SCALE,.156*SCALE,0],
    leftArm=[-.080*.91*SCALE,.285*SCALE,0], rightArm=[.080*.91*SCALE,.285*SCALE,0],
    head=[0,.3,0], grip=[.120*.91*SCALE,.195*SCALE,.012*SCALE])
# Slightly smaller headwear and boots give the chosen traveller an athletic silhouette.
bpy.context.view_layer.update()
head_centre = Vector((0, 0, .390*SCALE))
for obj in parts:
    if obj.name == 'Tailored linen tunic':
        inverse = obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if point.z < .183: point.z += .039 * max(0, min(1, (.183-point.z)/.052))
            vertex.co = inverse @ point
    if obj.get('avatar_group') == 'head' and obj.name != 'Neck':
        obj.matrix_world = Matrix.Translation(head_centre) @ Matrix.Scale(.92, 4) @ Matrix.Translation(-head_centre) @ obj.matrix_world
    elif any(word in obj.name for word in ['boot', 'sole', 'toe seam', 'sabaton']):
        centre = Vector((obj.matrix_world.translation.x,0,0))
        obj.matrix_world = Matrix.Translation(centre) @ Matrix.Diagonal((.90,.86,.92,1)) @ Matrix.Translation(-centre) @ obj.matrix_world
bpy.context.view_layer.update()
rig_spec = importlib.util.spec_from_file_location('traveller_rig', ROOT / 'scripts/rig-settler.py')
rig_module = importlib.util.module_from_spec(rig_spec)
rig_spec.loader.exec_module(rig_module)
joints = rig_module.bind_traveller(parts, rig)
bpy.context.scene['avatar_rig'] = json.dumps(rig)
bpy.context.scene['avatar_joints'] = json.dumps(joints)
bpy.context.scene['avatar_smooth_normals'] = True

# Export the same colour-slot data when building or later editing the .blend.
import runpy
bpy.context.scene['avatar_eye_y'] = (.390+.013*.92)*SCALE
runpy.run_path(str(ROOT / 'scripts/export-settler.py'))

for obj in parts:
    obj.hide_render = obj['avatar_variant'] not in ['body','wide'] and obj.get('avatar_group') != 'backpack'
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-settler.blend'))
bpy.ops.render.render(write_still=True)
