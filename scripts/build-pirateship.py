"""Build the game pirate ship from Greggory_Fisher's "Low-Poly Pirate Ship".

blender --background --python scripts/build-pirateship.py -- [preview.png] [side|deck]

Source: https://sketchfab.com/3d-models/low-poly-pirate-ship-c5e06cf1ba164b749cb47044fe7b86eb
by Greggory_Fisher, CC-BY-4.0 - credited in assets/pirateship/README.md, which is what the
licence asks of us. Kept as assets/pirateship/source/pirateship-greggoryfisher.glb.

The source is 73k triangles in 27 parts, one per material and no textures. Material
colours become vertex paint, and all parts share one material in the exported mesh.
Its own eight guns are taken out (Plans/kanonnen.md) and the decks receive clipped, staggered planks.
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
# Small shot and rigging can lose more detail.
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

# The source's eight guns, four a side through the waist's ports, are gone (Plans/kanonnen.md): the
# ship carries two of the keeper's own instead (scripts/build-cannon.py), drawn by web/js/boat.js where
# shared/crafts.mjs puts them, so they can be traversed and laid. Each carriage is found as a loose piece
# of the cannon materials, and with it go the iron that was bolted to it (the M_Metal pieces inside its
# box: cap squares, bolt heads, rings) - left behind, they would hang in the gun ports. The ports
# themselves are the hull's and stay open; the shot (M_Cannon_Balls) stays in its racks.
def islands(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        todo, group = [f], []
        seen.add(f.index)
        while todo:
            g = todo.pop()
            group.append(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        todo.append(h)
        vs = {v for i in group for v in bm.faces[i].verts}
        out.append((group, Vector((min(v.co.x for v in vs), min(v.co.y for v in vs), min(v.co.z for v in vs))),
                    Vector((max(v.co.x for v in vs), max(v.co.y for v in vs), max(v.co.z for v in vs)))))
    bm.free()
    return out

guns = [o for o in parts if o.data.materials[0].name.startswith('M_Cannon') and o.data.materials[0].name != 'M_Cannon_Balls']
boxes = []
for o in guns:
    for _, lo, hi in islands(o):
        # Pieces of one gun lie within a hand of each other: merge them into one box per gun.
        for i, (blo, bhi) in enumerate(boxes):
            if all(lo[k] < bhi[k] + 0.05 and hi[k] > blo[k] - 0.05 for k in range(3)):
                boxes[i] = (Vector(map(min, blo, lo)), Vector(map(max, bhi, hi)))
                break
        else:
            boxes.append((lo, hi))
print('old guns found:', len(boxes), [tuple(round(v, 2) for v in (lo + hi) / 2) for lo, hi in boxes], flush=True)
for o in guns:
    bpy.data.objects.remove(o, do_unlink=True)
parts = [o for o in parts if o not in guns]
inside = lambda lo, hi: any(all(lo[k] > blo[k] - 0.03 and hi[k] < bhi[k] + 0.03 for k in range(3)) for blo, bhi in boxes)
fittings = 0
for o in parts:
    if o.data.materials[0].name not in ('M_Metal_Dark', 'M_Metal_Light'):
        continue
    gone = [i for group, lo, hi in islands(o) if inside(lo, hi) for i in group]
    if not gone:
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in gone], context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    fittings += len(gone)
print(f'Removed {fittings} faces of the old guns ironwork', flush=True)

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

# ---- what she measures of herself ---------------------------------------------------------
# Anchors in the grammar of scripts/model-rules.mjs, read by scripts/build-craft.mjs into
# shared/craft-galleon.mjs (Plans/nieuwe-sloep.md, chip 2a). The numbers are the ones shared/crafts.mjs
# carried by hand until then - measured on this very bake by its own rays and by level rays across it -
# written here in the craft's frame (y above DECK_Y on the waterline, +z the bow) and lifted into the
# bake's by WATERLINE + DECK_Y. So the craft the generator derives is the craft the island already
# sails, to the rounding of a float (tests/craft-old-numbers.test.mjs holds it there until the sloop
# replaces her, scripts/build-sloop.py, which measures its anchors off its own geometry instead).
#   deck.<name>.lo|hi    opposite corners of level planking;  stair.<name>.lo|hi  a ramp, foot to head
#   rail.<n>.a|b         the ends of a run of bulwark on the floor under it (crafts.mjs puts its top on)
#   solid.<name>.lo|hi   a box nobody walks through (the stringers of the quarterdeck stairs)
#   mast.<name>          where a mast stands;  port.<n>.lo|hi  an opening in the bulwark (none here)
#   climb.side-*.lo|hi   a rope ladder: lo the climber's stand at its foot (CLIMB_OUT outside the
#                        ropes), hi where they step onto the deck;  climb.mast  the one up to the nest
#   mount.<kind>-<n>     lo where the gunner stands, hi the carriage: the bearing lo -> hi is its rest
#   helm / nest / cargo  points on the planking; waterline  her draught, as the Batavia's
import re as _re
def _js_const(path, name):
    src = (ROOT / path).read_text(encoding='utf8')
    return eval(_re.search(r'export const %s = ([0-9.\s*/+-]+);' % name, src).group(1))
DECK_Y = _js_const('shared/hull.mjs', 'DECK_Y')          # 0.0555: the deck datum over the water
CLIMB_OUT = _js_const('shared/deck.mjs', 'CLIMB_OUT')    # 0.16: a climber's feet outside the ropes
WATERLINE = 12.29 * 7 / 58.56                            # the old SHIP_DRAUGHT, 7 of 58.56 up the source
LIFT = WATERLINE + DECK_Y
SQ = 0.7071067811865476                                  # sqrt(1/2): the nest's ladder at 315 degrees

def craft_anchor(name, x, y, z):
    """An empty at a craft-frame point: game (x, y + LIFT, z) is Blender (x, -z, y + LIFT)."""
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = Vector((x, -z, y + LIFT))
    scene.collection.objects.link(e)

def pair(kind, name, lo, hi):
    craft_anchor(f'{kind}.{name}.lo', *lo)
    craft_anchor(f'{kind}.{name}.hi', *hi)

# The planking (crafts.mjs's rectangles: a ramp's corners are at its foot and its head, so that
# the middle and the slope come out as they were typed).
pair('deck', 'waist', (-1.75, 1.108, -2.3), (1.75, 1.108, 2.3))
pair('stair', 'forecastle', (-1.75, 1.11125, 2.2), (1.75, 1.31275, 2.85))          # 1.212, slope 0.31
pair('deck', 'forecastle', (-1.35, 1.318, 2.85), (1.35, 1.318, 3.4))
pair('deck', 'forecastle-mid', (-1.0, 1.318, 3.4), (1.0, 1.318, 3.9))
pair('deck', 'forecastle-fore', (-0.6, 1.318, 3.9), (0.6, 1.318, 4.6))
pair('stair', 'bow', (-0.45, 1.52, 4.6), (0.45, 2.02, 5.85))                        # 1.77, slope 0.4
pair('deck', 'quarterdeck', (-1.8, 1.738, -4.6), (1.8, 1.738, -2.3))
for s, side in ((1, 's'), (-1, 'p')):
    pair('stair', f'quarterdeck-{side}', (s * 1.15, 1.10975, -1.4), (s * 1.85, 1.74025, -2.05))  # 1.425, -0.97
    pair('deck', f'landing-{side}', (s * 1.15, 1.738, -2.3), (s * 1.85, 1.738, -2.05))
pair('deck', 'poop', (-1.8, 1.948, -6.1), (1.8, 1.948, -4.6))
# The crow's nest, a deck of its own layer (the walk map's ALOFT): its floor, and the box the rim is read in.
pair('deck', 'nest', (-0.75, 8.6, -0.75), (0.75, 8.6, 0.75))

# The rails: each run of bulwark on the planking it stands on.
n = 0
def run(a, b):
    global n
    n += 1
    craft_anchor(f'rail.{n}.a', *a)
    craft_anchor(f'rail.{n}.b', *b)
for s in (1, -1):
    run((s * 1.9, 1.108, -2.3), (s * 1.9, 1.108, 2.3))        # the waist
    run((s * 1.55, 1.318, 2.3), (s * 1.55, 1.318, 3.4))       # the forecastle's rim, stepping in
    run((s * 1.2, 1.318, 3.4), (s * 1.2, 1.318, 3.9))
    run((s * 0.8, 1.318, 3.9), (s * 0.8, 1.318, 4.6))
    run((s * 0.6, 1.5, 4.6), (s * 0.6, 1.5, 5.2))             # the foot of the bow's climb
    run((s * 1.95, 1.738, -4.6), (s * 1.95, 1.738, -2.3))     # the quarterdeck
    run((s * 1.95, 1.948, -6.1), (s * 1.95, 1.948, -4.6))     # the poop
    # The inside of each flight of the quarterdeck stairs: a stringer, a wall from the waist.
    pair('solid', f'stringer-{"s" if s > 0 else "p"}', (s * 0.91, 1.108, -2.1), (s * 0.99, 1.738, -1.4))
run((-1.95, 1.948, -6.15), (1.95, 1.948, -6.15))              # the taffrail
run((-1.1, 1.738, -2.36), (1.1, 1.738, -2.24))                # the quarterdeck's front balustrade
run((-0.5, 1.89, 5.85), (0.5, 1.89, 5.85))                    # the end of the bowsprit's deck
craft_anchor('mast.fore', 0, 1.318, 3.15)
craft_anchor('mast.main', 0, 1.108, 0)
craft_anchor('mast.mizzen', 0, 1.948, -5.4)

# The rope ladders over the waist (ropes at 2.42, foot under the water, landing 1.35 in) and up the
# mainmast to the nest (ropes 0.8 out at 315 degrees, foot on the waist, landing on the dais).
for s, side in ((1, 'starboard'), (-1, 'port')):
    pair('climb', f'side-{side}', (s * (2.42 + CLIMB_OUT), -0.65, 1.85), (s * 1.35, 1.108, 1.85))
pair('climb', 'mast', ((0.8 + CLIMB_OUT) * SQ, 1.12, -(0.8 + CLIMB_OUT) * SQ), (0.297, 8.96, -0.297))
craft_anchor('nest', 0, 9.2, 0.17)

# The guns in the waist, square out over the bulwark, and the harpoon guns on the forecastle, 57
# degrees off the bow (yaw 1.0): the gunner's stand is laid back along that bearing from the carriage.
for s, side in ((1, 's'), (-1, 'p')):
    pair('mount', f'cannon-{side}', (s * 0.85, 1.108, -1.0), (s * 1.5, 1.108, -1.0))
    pair('mount', f'harpoon-{side}', (s * 0.7476858359030154, 1.318, 3.02378167674425), (s * 1.1, 1.318, 3.25))
craft_anchor('helm', 0, 1.738, -3.2)
craft_anchor('cargo', 0, 1.108, 1.5)
craft_anchor('waterline', 0, -DECK_Y, 0)                     # (0, WATERLINE, 0) in the bake's frame

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
