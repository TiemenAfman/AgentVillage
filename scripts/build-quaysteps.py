"""Modular dressed-stone quay stair. Rebuild with scripts/blender.mjs --background --python scripts/build-quaysteps.py.

The tread is three fitted stones with a chamfered nosing. Repeating this module
keeps the number of risers tied to the shared walking surface on every island.
"""
import bpy
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/quaysteps'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color):
    m = bpy.data.materials.new('stone:' + name)
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .93
    return m
stones = [material('limestone', 0xa49e8d), material('warm', 0xb2aa98), material('weathered', 0x999787)]

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def block(c, name, x, w, depth, height, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, height / 2))
    o = bpy.context.object
    o.name = c.name + ' ' + name
    o.dimensions = (w, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = o.modifiers.new('Worn stone edges', 'BEVEL')
    bevel.width = .008
    bevel.segments = 1
    o.data.materials.append(mat)
    o['building_part'] = True
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o)
    return o
c = collection('addon_quay_tread')
for i in range(3):
    block(c, 'stone ' + str(i), (i - 1) * .254, .252, 1 / 3 + .018, .15, stones[i])
c = collection('addon_quay_coping')
block(c, 'cap', 0, .18, 1 / 3 + .01, .10, stones[1])
bpy.context.scene['building_height'] = .15
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'quaysteps.blend'))
