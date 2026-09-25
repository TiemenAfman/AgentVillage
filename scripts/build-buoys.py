"""Author the channel buoys: node scripts/blender.mjs --background --python scripts/build-buoys.py.

The base is at zero for the asset contract; world.js immerses the lowest .09 units.
Eight facets keep the painted float and topmark legible within the 120 triangle budget.
"""
import bpy
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/buoys'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, hex):
    m = bpy.data.materials.new('plain:' + name)
    rgb = [((hex >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .65
    return m


iron = material('buoy-iron', 0x303b3b)
red = material('buoy-red', 0xc84d3d)
green = material('buoy-green', 0x389563)


def finish(obj, name, coll, mat):
    obj.name = coll.name + ' ' + name
    obj['building_part'] = True
    obj.data.materials.append(mat)
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


for color, paint in [('red', red), ('green', green)]:
    coll = bpy.data.collections.new('prop_buoy_' + color)
    bpy.context.scene.collection.children.link(coll)
    # A continuous hull avoids hidden overlapping caps. The broad shoulder carries
    # the rubber belt; the sloping deck sheds water and catches the island's light.
    rings = [(0, .15), (.09, .24), (.17, .24), (.30, .21), (.37, .105)]
    vertices = [(r * math.cos(i * math.tau / 8), r * math.sin(i * math.tau / 8), h)
                for h, r in rings for i in range(8)]
    faces = [tuple(reversed(range(8)))]
    for j in range(4):
        for i in range(8):
            k = (i + 1) % 8
            faces.append((j * 8 + i, j * 8 + k, (j + 1) * 8 + k, (j + 1) * 8 + i))
    faces.append(tuple(range(32, 40)))
    mesh = bpy.data.meshes.new(coll.name + ' hull')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new('hull', mesh)
    coll.objects.link(obj)
    finish(obj, 'float', coll, paint)
    mesh.materials.append(iron)
    for p in mesh.polygons:
        if 9 <= p.index <= 16:
            p.material_index = 1
    bpy.ops.mesh.primitive_cylinder_add(vertices=4, radius=.027, depth=.19, location=(0, 0, .465))
    finish(bpy.context.object, 'stem', coll, iron)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=.105, radius2=.105 if color == 'red' else 0,
                                    depth=.17, location=(0, 0, .645))
    finish(bpy.context.object, 'topmark', coll, paint)

bpy.context.scene['building_height'] = .73
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'buoys.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'buoys'})
