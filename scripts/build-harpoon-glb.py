"""Make web/models/harpoon.glb, the galleon's harpoon gun, from the Sketchfab download (Plans/harpoen.md).

    node scripts/blender.mjs --background --python-exit-code 1 --python scripts/build-harpoon-glb.py

Source: assets/harpoon/source-harpoon.glb, the unmodified download ("Sea Of Thieves Harpoon" by
J.D.Productions, CC BY 4.0 - assets/harpoon/CREDITS.md). 48.5k triangles in 16 meshes and five PBR
texture sets at 1024: far over anything the bake takes, and textured, which the bake cannot carry
(export-models.py drops UVs). The keeper wanted this model first, as it is, so it takes the route the
captain and the lava imp take - a GLB fetched after the boot (web/js/harpoon.js) - and the house-style
bake is made beside it to compare (Plans/harpoen.md, "Het model en de licentie").

What this does, and nothing else:
  - groups the source's pieces into the four that move differently, each with its origin on its own
    axis, nested so that turning a parent carries its children:
      harpoon_mount  the pedestal, origin on the deck in the middle of its foot. Never moves.
      harpoon_yoke   the forked arm on it, origin on the pedestal's axis: TRAVERSE turns this about y.
      harpoon_gun    barrel, cradle, handles, rope drum - origin on the trunnion bolt at the top of
                     the yoke: ELEVATION turns this about its own x.
      harpoon_bolt   the barbed harpoon itself, origin at its tail (where the line is made fast):
                     it leaves the barrel when fired and is drawn back into it when reeled home.
    and an empty `harpoon_muzzle` in the gun at the middle of the barrel's mouth.
  - turns it to face +Z on the island (the source's barrel points along +x) and scales it so the
    trunnion stands at PIVOT_Y - a settler's chest (a settler is 0.45 tall).
  - decimates each piece by its own share: the leather windings and the rope coil are tens of
    thousands of triangles of millimetre detail that a gun 1.5 m long seen from the deck never shows.
  - halves the textures to 512 and writes them as JPEG; the occlusion map is left out (the room
    and the deck have their own light, and it doubled the file).
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets/harpoon/source-harpoon.glb'
TARGET = ROOT / 'web/models/harpoon.glb'
PIVOT_Y = 0.31            # island units, deck to trunnion
TEX = 512

# The source's own numbers, measured (Plans/harpoen.md): the pedestal's axis and the trunnion bolt,
# in the imported scene (Blender Z up, barrel along +x).
AXIS = Vector((-0.05, -29.17, 0.0))
TRUNNION_Z = 13.67
# Each source piece by the name of the node it hangs from -> which of the four it belongs to, and how
# much of it to keep.
GROUP = {'base': 'mount', 'arms': 'yoke', 'harpoon': 'bolt', 'harpoon.001': 'bolt'}
SHARE = {
    'straps': 0.06, 'Plane': 0.15, 'harpoon_base': 0.12, 'harpoon': 0.06, 'harpoon.001': 0.2,
    'handles': 0.5, 'arms': 0.5, 'base': 0.7,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene

k = PIVOT_Y / TRUNNION_Z
# Barrel from +x to -Y (the island's +Z once exported Y up), the pedestal's axis on the origin, its
# foot (the lowest point of the model) on the deck.
meshes = [o for o in scene.objects if o.type == 'MESH']
low = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
place = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Scale(k, 4) @ Matrix.Translation(-Vector((AXIS.x, AXIS.y, low)))
TRUNNION = place @ Vector((AXIS.x, AXIS.y, TRUNNION_Z))

pieces = {'mount': [], 'yoke': [], 'gun': [], 'bolt': []}
for o in meshes:
    src = o.parent.name if o.parent else o.name
    o.data = o.data.copy()
    o.data.transform(place @ o.matrix_world)
    o.parent = None
    o.matrix_world = Matrix()
    share = SHARE.get(src, 1.0)
    bpy.context.view_layer.objects.active = o
    if share < 1:
        dec = o.modifiers.new('Budget', 'DECIMATE')
        dec.ratio = share
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    pieces[GROUP.get(src, 'gun')].append(o)
for o in list(scene.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)


def tris(o):
    o.data.calc_loop_triangles()
    return len(o.data.loop_triangles)


def join(objs, name, origin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    o.data.transform(Matrix.Translation(-origin))
    o.location = origin
    return o


bolt_pts = [o.matrix_world @ v.co for o in pieces['bolt'] for v in o.data.vertices]
# Its tail is the end nearest the gun (the island's -Z, Blender's +Y), on the barrel's line.
tail_y = max(p.y for p in bolt_pts)
TAIL = Vector((0.0, tail_y, sum(p.z for p in bolt_pts) / len(bolt_pts)))
gun_pts = [o.matrix_world @ v.co for o in pieces['gun'] for v in o.data.vertices]
# The barrel's mouth: the gun's furthest point forward, on the bolt's line.
MUZZLE = Vector((0.0, min(p.y for p in gun_pts if abs(p.z - TAIL.z) < 0.02 and abs(p.x) < 0.02), TAIL.z))

mount = join(pieces['mount'], 'harpoon_mount', Vector((0, 0, 0)))
yoke = join(pieces['yoke'], 'harpoon_yoke', Vector((0, 0, min((o.matrix_world @ v.co).z for o in pieces['yoke'] for v in o.data.vertices))))
gun = join(pieces['gun'], 'harpoon_gun', TRUNNION)
bolt = join(pieces['bolt'], 'harpoon_bolt', TAIL)


def parent(child, to):
    world = child.matrix_world.copy()
    child.parent = to
    child.matrix_world = world


bpy.context.view_layer.update()
parent(yoke, mount)
parent(gun, yoke)
parent(bolt, gun)
muzzle = bpy.data.objects.new('harpoon_muzzle', None)
scene.collection.objects.link(muzzle)
muzzle.location = MUZZLE
bpy.context.view_layer.update()
parent(muzzle, gun)

# Textures: half size, and no occlusion. The glTF importer wires occlusion through a group node
# named after it; dropping the link is what keeps the exporter from writing the map.
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    for n in list(m.node_tree.nodes):
        if n.type == 'GROUP' and 'ccl' not in n.name.lower():
            for s in n.inputs:
                for link in list(s.links):
                    m.node_tree.links.remove(link)
for img in bpy.data.images:
    if img.size[0] > TEX:
        img.scale(TEX, TEX)

total = {o.name: tris(o) for o in (mount, yoke, gun, bolt)}
print('harpoon triangles', total, 'sum', sum(total.values()), flush=True)
print('trunnion', tuple(round(v, 4) for v in TRUNNION), 'muzzle', tuple(round(v, 4) for v in MUZZLE),
      'tail', tuple(round(v, 4) for v in TAIL), flush=True)

TARGET.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=str(TARGET), export_format='GLB', export_yup=True, export_apply=True,
    export_image_format='JPEG', export_jpeg_quality=82, export_animations=False,
    export_extras=False, export_cameras=False, export_lights=False,
)
print('wrote', TARGET, TARGET.stat().st_size, 'bytes', flush=True)
