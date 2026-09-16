"""Author the loose props in Blender. Run with:

    blender --background --python scripts/build-props.py

It writes assets/props/agentvillage-props.blend and bakes it to web/js/props-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

Unlike the tavern, this set holds several things, so each one lives in a collection named
after it: `prop_barrel` now, a cart and a crate later. Everything inside a collection is
named after it too, which is what keeps a part name unique across every set the register
in web/js/models.js holds. Coordinates here are the island's - Y up, front +Z - and the
helpers turn them into Blender's Z up on the way in, exactly as build-tavern.py does.
"""
import bpy
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/props'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The same three colours the tavern's own barrels are made of, so a barrel put down by
# hand and a barrel standing by the tavern door are the same barrel. The prefix before
# the colon is the texture sheet the face is drawn on - see assets/README.md.
COLORS = {'plank:oak': 0x845335, 'plank:dark': 0x503728, 'plain:iron': 0x343638}
materials = {}
for name, hex in COLORS.items():
    m = bpy.data.materials.new(name)
    rgb = [((hex >> s) & 255) / 255 for s in [16, 8, 0]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .86
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def asset(name):
    """One collection per prop, which is how the exporter tells them apart."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def finish(name, mat, coll):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def rod(name, a, b, r, mat, coll, top=None, sides=8):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top,
                                    depth=(b - a).length, location=(a + b) / 2)
    obj = finish(name, mat, coll)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


# ---------------------------------------------------------------- prop_barrel
# The measurements are the tavern's barrels to the millimetre; only the facet count is
# lower. A hero building is looked at from two paces away and can afford ten sides per
# barrel; a prop is put down by the dozen and has 120 triangles to spend, which is four
# rods at eight sides. At 0.22 across - under a metre - the two extra facets were never
# the thing you could see anyway, and eight is what the island drew before Blender.
barrel = asset('prop_barrel')
rod('prop_barrel staves', (0, 0, 0), (0, .29, 0), .112, 'plank:oak', barrel, top=.101)
# Named apart rather than left to Blender, which would call the second one `hoop.001`.
# A part name is what buildings.js mesh() is called with and what the workbench writes
# back into the source, so a name that came out of a collision is a name nobody can read.
for which, y in [('lower', .052), ('upper', .205)]:
    rod(f'prop_barrel hoop {which}', (0, y, 0), (0, y + .024, 0), .115, 'plain:iron', barrel)
rod('prop_barrel lid', (0, .288, 0), (0, .30, 0), .095, 'plank:dark', barrel)

# The tallest thing in the set. Only a building reads this; a prop is stood on the ground
# by props.js and measures itself.
bpy.context.scene['building_height'] = .30

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. The per-asset preview PNGs come from scripts/preview-model.py.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -.001))
floor = bpy.context.object
floor.name = 'Studio floor'
mat = bpy.data.materials.new('Studio')
mat.diffuse_color = (.21, .25, .20, 1)
floor.data.materials.append(mat)


def aim(o, p):
    o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.camera_add(location=(.62, -.78, .52))
cam = bpy.context.object
aim(cam, (0, 0, .15))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = .62
bpy.context.scene.camera = cam
for loc, power, size in [((-.8, -1.2, 1.4), 60, 1.2), ((1.0, -.4, .8), 25, 1.0), ((0, .9, 1.0), 40, .8)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .15))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-props.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'props'})
