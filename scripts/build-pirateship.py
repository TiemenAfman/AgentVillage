"""Build the game pirate ship from Greggory_Fisher's "Low-Poly Pirate Ship".

blender --background --python scripts/build-pirateship.py -- [preview.png] [side|deck]

Source: https://sketchfab.com/3d-models/low-poly-pirate-ship-c5e06cf1ba164b749cb47044fe7b86eb
by Greggory_Fisher, CC-BY-4.0 - credited in assets/pirateship/README.md, which is what the
licence asks of us. Kept as assets/pirateship/source/pirateship-greggoryfisher.glb.

The source is 73k triangles in 27 parts, one per material and no textures. Material
colours become vertex paint, and all parts share one material in the exported mesh.
Cannon contours are preserved and the decks receive clipped, staggered planks.
The bow faces -Y (game +Z), the length is 13, and the keel is on z = 0.
"""
import bpy
import bmesh
import sys
from pathlib import Path
from mathutils import Vector, Matrix
import math

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/pirateship/source/pirateship-greggoryfisher.glb'
TARGET = ROOT / 'assets/pirateship/pirateship.blend'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = args[0] if args else None
VIEW = args[1] if len(args) > 1 else 'side'

LENGTH = 13.0         # island units, hull and bowsprit: ten Benchies (~1.3) - five read as a toy beside a settler
# Cannon assemblies keep their contours; small shot and rigging can lose more detail.
# Small parts remain whole because reducing a low-poly sail can erase it entirely.
KEEP = {'M_Cannon_Balls': 0.25, 'M_Rope': 0.12,
        'M_Barrel_Wood_1': 0.25, 'M_Barrel_Wood_2': 0.25,
        'M_Metal_Dark': 0.12, 'M_Metal_Light': 0.15}
KEEP_UNDER = 2000
# Clutter nobody sees from the water, and the source's baked shadow decals (the island
# lights its own).
DROP = {'M_Cups', 'M_Rum', 'M_Bottle_Transparent', 'M_Shadows'}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene
parts = [o for o in scene.objects if o.type == 'MESH' and not (o.data.materials and o.data.materials[0].name in DROP)]
for o in list(scene.objects):
    if o not in parts:
        bpy.data.objects.remove(o, do_unlink=True)

def colour_of(m):
    if m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                c = n.inputs['Base Color'].default_value
                return (c[0], c[1], c[2], 1.0)
    c = m.diffuse_color
    return (c[0], c[1], c[2], 1.0)

for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    # World transform into the vertices first: glTF import parents under a root with a
    # rotation, and the join below must not inherit it.
    o.data.transform(o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix()
    o.data.calc_loop_triangles()
    count = len(o.data.loop_triangles)
    mname = o.data.materials[0].name if o.data.materials else ''
    if mname in ('M_Metal_Dark', 'M_Metal_Light', 'M_Cannon_Balls'):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
    want = count if count < KEEP_UNDER else int(count * KEEP.get(mname, 0.3))
    if mname.startswith('M_Cannon') and mname != 'M_Cannon_Balls':
        want = count
    if count > want:
        # Coplanar triangles first, which costs no shape at all; then collapse what is left.
        flat = o.modifiers.new('Flat', 'DECIMATE'); flat.decimate_type = 'DISSOLVE'; flat.angle_limit = math.radians(3)
        bpy.ops.object.modifier_apply(modifier=flat.name)
        bpy.ops.object.modifier_add(type='TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=o.modifiers[-1].name)
        o.data.calc_loop_triangles(); count = len(o.data.loop_triangles)
    if count > want:
        dec = o.modifiers.new('Game triangle budget', 'DECIMATE')
        dec.ratio = want / count
        bpy.ops.object.modifier_apply(modifier=dec.name)
    rgb = colour_of(o.data.materials[0]) if o.data.materials else (0.5, 0.5, 0.5, 1)
    attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    o.data.color_attributes.active_color = attr
    for c in attr.data: c.color = rgb
    for p in o.data.polygons: p.use_smooth = False
    o.data.calc_loop_triangles()
    print('part', mname, count, '->', len(o.data.loop_triangles), flush=True)

# Bow is the source's +X (a first bake took -X and the ship sailed stern first); turn it to -Y, scale, and put the waterline at z = 0.
pts = [v.co for o in parts for v in o.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
k = LENGTH / (hi.x - lo.x)
# The keel on z = 0, like every baked set's origin on the ground (model-rules); the game drops
# the hull by its draught, as it does the Benchy's.
mid = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
# The original bake's mast top fixes its vertical frame. Changing metal simplification
# otherwise changes the lowest loose vertex and silently lowers every walking deck.
mid.z = hi.z - 12.288581848144531 / k
M = Matrix.Scale(k, 4) @ Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Translation(-mid)
for o in parts:
    o.data.transform(M)
# Preserve the keel's ground contact after simplifying its metalwork; taper this tiny
# correction out below the waterline so no deck, cannon or rigging attachment moves.
bottom = min(v.co.z for o in parts for v in o.data.vertices)
for o in parts:
    for v in o.data.vertices:
        if v.co.z < bottom + 0.1:
            v.co.z -= bottom * max(0, 1 - (v.co.z - bottom) / 0.1)

# A barrel is split across two materials in the download. Reorienting each material
# separately treats open strips as solid objects and turns half the tube inside out.
# Join all cannon materials first, retaining corner paint, then weld and orient their
# complete surfaces. Planar dissolve saves triangles without collapsing wheels or bores.
cannons = [o for o in parts if o.data.materials[0].name.startswith('M_Cannon')]
bpy.ops.object.select_all(action='DESELECT')
for o in cannons:
    o.select_set(True)
bpy.context.view_layer.objects.active = cannons[0]
bpy.ops.object.join()
cannon = bpy.context.object
parts = [o for o in parts if o not in cannons] + [cannon]
bm = bmesh.new()
bm.from_mesh(cannon.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)
# The carriage cheeks in the source are two offset skins with no faces around their
# stepped perimeter. Recalculating normals cannot close that slit: pair the matching
# wooden boundary loops and bridge their thickness, leaving the barrel bores alone.
bm.edges.ensure_lookup_table()
wood = {i for i, mat in enumerate(cannon.data.materials) if mat.name.startswith('M_Cannon_Wood')}
remaining = {e for e in bm.edges if e.is_boundary and e.link_faces[0].material_index in wood}
loops = []
while remaining:
    first = min(remaining, key=lambda e: e.index)
    remaining.remove(first)
    edges, todo = [first], [first]
    while todo:
        edge = todo.pop()
        for vertex in edge.verts:
            for adjacent in vertex.link_edges:
                if adjacent in remaining:
                    remaining.remove(adjacent)
                    edges.append(adjacent)
                    todo.append(adjacent)
    verts = {v for edge in edges for v in edge.verts}
    center = sum((v.co for v in verts), Vector()) / len(verts)
    loops.append((edges, center))
paint_layer = bm.loops.layers.float_color['Paint']
bridges = 0
cheeks = []
while loops:
    edges, center = loops.pop(0)
    candidates = [(i, (other_center - center).length) for i, (other, other_center) in enumerate(loops) if len(other) == len(edges)]
    if not candidates:
        raise ValueError('Unpaired open cannon carriage skin')
    partner, distance = min(candidates, key=lambda p: p[1])
    if distance > 0.02:
        raise ValueError(f'Cannon carriage skins are not adjacent: {distance}')
    other, other_center = loops.pop(partner)
    normal = (other_center - center).normalized()
    tangent = Vector((-normal.y, normal.x, 0)).normalized()
    cheeks.append(((center + other_center) / 2, normal, tangent))
    material = edges[0].link_faces[0].material_index
    colour = colour_of(cannon.data.materials[material])
    result = bmesh.ops.bridge_loops(bm, edges=edges + other)
    for face in result['faces']:
        face.material_index = material
        for loop in face.loops:
            loop[paint_layer] = colour
    bridges += 1
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
wood_boundaries = [e for e in bm.edges if e.is_boundary and e.link_faces[0].material_index in wood]
if wood_boundaries:
    raise ValueError(f'{len(wood_boundaries)} open edges remain on cannon carriages')
print(f'Closed {bridges} carriage cheeks; wooden boundary edges: 0', flush=True)
print('cannon boundary edges:', sum(e.is_boundary for e in bm.edges), flush=True)
bm.to_mesh(cannon.data)
bm.free()
flat = cannon.modifiers.new('Preserve cannon contours', 'DECIMATE')
flat.decimate_type = 'DISSOLVE'
flat.angle_limit = math.radians(0.5)
flat.delimit = {'MATERIAL'}
bpy.ops.object.modifier_apply(modifier=flat.name)

# The small iron bolt heads share the source's open-skin problem. Close only complete
# metal boundary loops inside the carriage cheeks; this must not cap a cannon muzzle
# or an unrelated ring elsewhere on the ship.
closed_fittings = 0
for obj in parts:
    if obj.data.materials[0].name not in ('M_Metal_Dark', 'M_Metal_Light'):
        continue
    metal = bmesh.new()
    metal.from_mesh(obj.data)
    metal.edges.ensure_lookup_table()
    pending = {e for e in metal.edges if e.is_boundary}
    while pending:
        first = min(pending, key=lambda e: e.index)
        pending.remove(first)
        edges, todo = [first], [first]
        while todo:
            edge = todo.pop()
            for vertex in edge.verts:
                for adjacent in vertex.link_edges:
                    if adjacent in pending:
                        pending.remove(adjacent)
                        edges.append(adjacent)
                        todo.append(adjacent)
        vertices = {v for edge in edges for v in edge.verts}
        if not any(all(abs((v.co - c).dot(n)) < 0.08 and abs((v.co - c).dot(t)) < 0.33 and abs(v.co.z - c.z) < 0.15 for v in vertices) for c, n, t in cheeks):
            continue
        colour = colour_of(obj.data.materials[0])
        layer = metal.loops.layers.float_color['Paint']
        result = bmesh.ops.holes_fill(metal, edges=edges, sides=32)
        for face in result['faces']:
            for loop in face.loops:
                loop[layer] = colour
        closed_fittings += len(result['faces'])
    bmesh.ops.recalc_face_normals(metal, faces=list(metal.faces))
    metal.to_mesh(obj.data)
    metal.free()
print(f'Closed carriage metal openings: {closed_fittings}', flush=True)

# Real plank faces follow the existing deck polygons, including the hull's taper and
# openings. An offset grid of butt joints avoids drawing a checkerboard. The original
# deck remains underneath as dark caulking, so none of the seams opens into the hull.
def clip(poly, axis, edge, greater):
    result = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ina = a[axis] >= edge if greater else a[axis] <= edge
        inb = b[axis] >= edge if greater else b[axis] <= edge
        if ina:
            result.append(a)
        if ina != inb:
            result.append(a.lerp(b, (edge - a[axis]) / (b[axis] - a[axis])))
    return result

vertices, faces, colours = [], [], []
for o in parts:
    if o.data.materials[0].name not in ('M_Wood_Dark', 'M_Wood_Light', 'MI_Base_Wood_Dark'):
        continue
    o.data.update()
    for face in o.data.polygons:
        poly = [o.data.vertices[i].co.copy() for i in face.vertices]
        if face.normal.z < 0.99 or face.area < 0.025 or not 2.0 < poly[0].z < 5.0:
            continue
        # Sloped trim overlaps the walking deck in the downloaded mesh. Planking that
        # trim produces broad diagonal patches, so only horizontal deck faces receive it.
        if max(p.z for p in poly) - min(p.z for p in poly) > 0.001:
            continue
        # Keep small furniture and rails intact; large walking surfaces carry the boards.
        if face.area < 0.12:
            continue
        for loop in face.loop_indices:
            o.data.color_attributes['Paint'].data[loop].color = (0.055, 0.032, 0.016, 1)
        width, length, gap = 0.18, 1.15, 0.007
        for row in range(math.floor(min(p.x for p in poly) / width), math.floor(max(p.x for p in poly) / width) + 1):
            stagger = (row % 3) * length / 3
            for col in range(math.floor((min(p.y for p in poly) - stagger) / length), math.floor((max(p.y for p in poly) - stagger) / length) + 1):
                tile = poly
                for axis, edge, greater in ((0, row * width + gap / 2, True), (0, (row + 1) * width - gap / 2, False), (1, col * length + stagger + gap / 2, True), (1, (col + 1) * length + stagger - gap / 2, False)):
                    tile = clip(tile, axis, edge, greater)
                    if len(tile) < 3:
                        break
                if len(tile) < 3:
                    continue
                start = len(vertices)
                vertices.extend((p.x, p.y, p.z + 0.004) for p in tile)
                faces.append(tuple(range(start, start + len(tile))))
                tone = 0.86 + ((row * 73856093 ^ col * 19349663) % 11) * 0.027
                colours.append((0.24 * tone, 0.145 * tone, 0.067 * tone, 1))
deckmesh = bpy.data.meshes.new('Caulked deck planks')
deckmesh.from_pydata(vertices, [], faces)
deckmesh.update()
deck = bpy.data.objects.new('Deck planks', deckmesh)
scene.collection.objects.link(deck)
deckmesh.materials.append(parts[0].data.materials[0])
paint_attr = deckmesh.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
deckmesh.color_attributes.active_color = paint_attr
for face, colour in zip(deckmesh.polygons, colours):
    for loop in face.loop_indices:
        paint_attr.data[loop].color = colour
parts.append(deck)

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = 'pirateship hull'
ship.data.materials.clear()
paint = bpy.data.materials.new('plain:pirateship paint'); paint.diffuse_color = (1, 1, 1, 1)
ship.data.materials.append(paint)
for p in ship.data.polygons: p.material_index = 0
ship['building_part'] = True
scene.unit_settings.system = 'NONE'; scene.unit_settings.scale_length = 1
ship.data.calc_loop_triangles()
zs = [v.co.z for v in ship.data.vertices]
scene['building_height'] = max(zs)
print('pirate ship triangles:', len(ship.data.loop_triangles),
      'size', tuple(round(x, 2) for x in ship.dimensions), 'keel', round(min(zs), 2), flush=True)
# The deck along the centreline and a little off it (clear of the masts), for the helm and
# for the walkable deck: straight down from above, the first hit under DECK_CEIL.
from mathutils.bvhtree import BVHTree
tree = BVHTree.FromObject(ship, bpy.context.evaluated_depsgraph_get())
DECK_CEIL = 5.2
for yy in [i * 0.5 for i in range(-13, 14)]:
    hits = []
    for xx in (0.0, 0.9, -0.9):
        h = tree.ray_cast(Vector((xx, yy, DECK_CEIL)), Vector((0, 0, -1)))
        hits.append(round(h[0].z, 3) if h[0] else None)
    print('deck y', yy, hits, flush=True)
TARGET.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(TARGET))
import runpy
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'pirateship'})

if PREVIEW:
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'VERTEX'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = scene.render.resolution_y = 1000
    world = bpy.data.worlds.new('w'); scene.world = world
    world.color = (0.93, 0.93, 0.95)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam); scene.camera = cam
    if VIEW == 'deck':
        cam.data.lens = 22
        target = Vector((0, -2.5, 0.8))
        cam.location = Vector((0.3, 2.4, 1.9))
    else:
        cam.data.lens = 50
        target = Vector((0, 0, 2.0))
        cam.location = Vector((11.0, -9.5, 6.0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
