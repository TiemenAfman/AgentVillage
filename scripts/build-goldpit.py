"""Concrete bullion bunker and a bevelled ingot; rebuild with Blender, then bake."""
import bpy
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/goldpit'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

def material(name, hex):
    m = bpy.data.materials.new('plain:' + name)
    rgb = [((hex >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    return m

concrete = material('warm-concrete', 0xb2afa2)
cap = material('cut-edge', 0xd2cdbb)
dark = material('joint', 0x686960)
brass = material('brass', 0xcaa342)
gold = material('bullion', 0xf5c449)
bright = material('polished-bevel', 0xffe493)
stamp = material('assay-stamp', 0xa8731c)
plaster = material('office-plaster', 0xe2d4af)
oak = material('office-oak', 0x60432c)
copper = material('office-patina', 0x527f70)
glass = material('office-glass', 0x9ec6be)

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def finish(o, name, c, mat):
    o.name = c.name + ' ' + name
    o['building_part'] = True
    o.data.materials.append(mat)
    for old in list(o.users_collection):
        old.objects.unlink(o)
    c.objects.link(o)
    return o

def box(name, p, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(p[0], -p[2], p[1]))
    o = finish(bpy.context.object, name, pit, mat)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('Cast edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

pit = collection('civic_goldpit')
# The slab sits above turf, including at its mouth. Its old negative floor let the
# square show through it; the gold and the loader now share a visible concrete apron.
box('slab', (0, .015, 0), (2.5, .03, 2.72), concrete, .009)
for x in [-1.18, 1.18]:
    box('rear wall', (x, .18, -.41), (.14, .30, 1.90), concrete, .018)
    box('front wall', (x, .11, .95), (.14, .16, .82), concrete, .018)
    box('coping', (x, .335, -.41), (.18, .03, 1.92), cap, .007)
    box('low coping', (x, .195, .95), (.18, .025, .82), cap, .006)
    for z in [-1.05, -.42, .21]:
        box('casting seam', (x + (.072 if x > 0 else -.072), .175, z), (.003, .25, .012), dark)
box('back wall', (0, .18, -1.29), (2.5, .30, .14), concrete, .018)
box('back coping', (0, .335, -1.29), (2.54, .03, .18), cap, .007)
for x in [-.62, .62]:
    box('floor joint', (x, .0305, 0), (.009, .001, 2.55), dark)
box('threshold', (0, .033, 1.27), (2.15, .006, .07), brass)
box('sign post', (-1.32, .21, 1.26), (.04, .42, .04), dark)
box('sign', (-1.32, .37, 1.28), (.29, .14, .035), brass, .009)
box('sign inset', (-1.32, .37, 1.300), (.22, .08, .005), dark)
box('sign ingot', (-1.32, .37, 1.306), (.12, .035, .008), bright)

# A keeper's office on the left of the apron. It stays on the existing plot:
# the centre aisle and the loading point in front of the bullion remain open.
box('office footing', (-.79, .07, .70), (.66, .08, .86), cap, .012)
box('office plaster', (-.79, .52, .70), (.60, .82, .80), plaster)
for x in [-1.09, -.49]:
    for z in [.30, 1.10]:
        box('office corner', (x, .53, z), (.042, .86, .042), oak)
for y in [.14, .92]:
    box('office front beam', (-.79, y, 1.114), (.64, .04, .035), oak)
    box('office side beam', (-.476, y, .70), (.035, .04, .84), oak)
# A glazed door towards the square, and a cashier's hatch towards the loading aisle.
box('office door frame', (-.79, .41, 1.126), (.29, .59, .025), oak)
box('office door panel', (-.79, .29, 1.143), (.23, .30, .018), copper)
box('office door glass', (-.79, .58, 1.143), (.22, .20, .018), glass)
box('office door handle', (-.71, .40, 1.160), (.02, .055, .014), brass)
box('office hatch frame', (-.465, .59, .70), (.025, .39, .48), oak)
box('office hatch glass', (-.448, .60, .70), (.012, .31, .40), glass)
box('office hatch mullion', (-.438, .60, .70), (.014, .32, .023), oak)
box('office counter', (-.395, .40, .70), (.20, .04, .54), oak, .006)
box('office counter ledger', (-.36, .426, .75), (.09, .012, .13), plaster)
# Folded copper roof: one ridge, two pitches, with a generous drip edge.
verts = [(-1.18, .95, .21), (-.40, .95, .21), (-.40, .95, 1.19),
         (-1.18, .95, 1.19), (-.79, 1.20, .21), (-.79, 1.20, 1.19)]
faces = [(0, 4, 1), (3, 2, 5), (0, 3, 5, 4), (1, 4, 5, 2), (0, 1, 2, 3)]
m = bpy.data.meshes.new('Office roof')
m.from_pydata([(x, -z, y) for x, y, z in verts], [], faces)
m.update()
o = bpy.data.objects.new('roof', m)
pit.objects.link(o)
finish(o, 'office copper roof', pit, copper)
box('office ridge', (-.79, 1.20, .70), (.045, .035, 1.02), brass)
for x in [-1.18, -.40]:
    box('office eave', (x, .95, .70), (.032, .04, 1.02), oak)
box('office bullion plaque', (-.79, .82, 1.136), (.35, .13, .025), oak)
for x, y in [(-.85, .80), (-.73, .80), (-.79, .855)]:
    box('office plaque ingot', (x, y, 1.154), (.10, .035, .018), bright)

bar = collection('prop_goldbar')
# Taper first, bevel second: the narrow top and its bright rim remain legible
# from the island camera without increasing the number of instances or draws.
bpy.ops.mesh.primitive_cube_add(size=1)
o = finish(bpy.context.object, 'ingot', bar, gold)
for v in o.data.vertices:
    upper = v.co.z > 0
    v.co.x *= .26 * (.78 if upper else 1)
    v.co.y *= .13 * (.78 if upper else 1)
    v.co.z = .075 if upper else 0
o.data.materials.append(bright)
mod = o.modifiers.new('Polished arris', 'BEVEL')
mod.width = .008
mod.segments = 1
mod.affect = 'EDGES'
mod.material = 1
bpy.ops.object.modifier_apply(modifier=mod.name)
# A tiny dark assay mark on the top, with no text geometry at this viewing scale.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, .0752))
o = finish(bpy.context.object, 'assay', bar, stamp)
o.scale = (.043, .022, .0004)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

coin = collection('prop_goldcoin')
# Loose change around the heap, oversized like the bar - a real coin would be a pixel from
# the island camera. Ten sides is round enough at that size, and only the rims are
# bevelled (the angle limit leaves the sides alone), so the bright edge is what catches the
# sun and the triangle count stays a third of the budget: seventy of these are one instance
# batch (web/js/goldpit.js), kept out of the shadow pass because a coin's shadow is a hair.
bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=.036, depth=.012)
o = finish(bpy.context.object, 'disc', coin, gold)
for v in o.data.vertices:
    v.co.z += .006
o.data.materials.append(bright)
mod = o.modifiers.new('Milled rim', 'BEVEL')
mod.width = .003
mod.segments = 1
mod.limit_method = 'ANGLE'
mod.angle_limit = 1.0         # 57 degrees: the rims are 90, the ten sides meet at 36
mod.material = 1
bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.scene['building_height'] = 1.22
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'goldpit.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'goldpit'})
