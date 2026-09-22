"""Bake a tiled boardwalk that can turn and branch without changing its saved cells.

A .76-wide bay and two .24-long infills retain the old footprint. Planks are
separate meshes; their narrow seams read at walking height, while the stringers
and piles continue below the water. All pieces merge into one island draw call.
"""
import bpy
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/boardwalk'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color):
    m = bpy.data.materials.new(name)
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .95
    return m
wood = [material('plank:oak', 0xb07a4a), material('plank:weathered', 0xa1744e), material('plank:light', 0xb98656)]
beam = material('plankZ:beam', 0x6b4a2f)
pile = material('plank:pile', 0x5a3c28)

def asset(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def finish(c, name, mat):
    o = bpy.context.object
    o.name = c.name + ' ' + name
    o.data.materials.append(mat)
    o['building_part'] = True
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o)
    return o

def box(c, name, x, y, z, w, h, d, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y + h / 2))
    o = finish(c, name, mat)
    o.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

DECK = 1.24
for variant in range(2):
    c = asset('prop_boardwalk_' + ('a' if variant == 0 else 'b'))
    for i in range(5):
        box(c, 'board ' + str(i), 0, DECK - .06, (i - 2) * .152,
            .76, .06, .148 if i not in (0, 4) else .150, wood[(i + variant) % 3])
    for side in (-1, 1):
        box(c, 'stringer ' + str(side), side * .28, DECK - .15, 0, .075, .09, .76, beam)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=.057, radius2=.05,
            depth=DECK - .06, location=(side * .28, -side * .28, (DECK - .06) / 2))
        finish(c, 'pile ' + str(side), pile)
# Joins have their own zero at the beam foot; no floating asset origins.
for axis in ('x', 'z'):
    c = asset('prop_boardwalk_join_' + axis)
    if axis == 'x':
        for i in range(5):
            box(c, 'board ' + str(i), 0, .09, (i - 2) * .152, .24, .06,
                .148 if i not in (0, 4) else .150, wood[(i + 1) % 3])
        for side in (-1, 1):
            box(c, 'beam ' + str(side), 0, 0, side * .28, .24, .09, .075, beam)
    else:
        box(c, 'board', 0, .09, 0, .76, .06, .24, wood[1])
        for side in (-1, 1):
            box(c, 'beam ' + str(side), side * .28, 0, 0, .075, .09, .24, beam)
# The broad deck under a harbour house, with the same .72-wide doorstep tongue.
c = asset('civic_quay_platform')
for i in range(15):
    box(c, 'floor ' + str(i), 0, DECK - .06, -1.1 + (i + .5) * 2.2 / 15,
        2.2, .06, 2.2 / 15 - .004, wood[i % 3])
for i in range(5):
    box(c, 'doorstep ' + str(i), 0, DECK - .06, 1.1 + (i + .5) * .14,
        .72, .06, .136, wood[(i + 1) % 3])
for x in (-.9, 0, .9):
    box(c, 'stringer ' + str(x), x, DECK - .15, 0, .09, .09, 2.2, beam)
for x in (-.26, .26):
    box(c, 'door beam ' + str(x), x, DECK - .15, 1.45, .075, .09, .7, beam)
for i, (x, z) in enumerate([(-.9,-.9),(0,-.9),(.9,-.9),(-.9,0),(.9,0),(-.9,.9),(0,.9),(.9,.9)]):
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=.06, radius2=.05,
        depth=DECK - .06, location=(x, -z, (DECK - .06) / 2))
    finish(c, 'pile ' + str(i), pile)
bpy.context.scene['building_height'] = DECK
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'boardwalk.blend'))
