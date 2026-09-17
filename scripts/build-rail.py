"""Author the post and rail fence in Blender. Run with:

    blender --background --python scripts/build-rail.py

It writes assets/rail/agentvillage-rail.blend and bakes it to web/js/rail-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

This is the bottom rung of the boundary ladder in web/js/hamlets.js and the last one to
stop being a drawn shape: what a hamlet of tents puts round its own land, and - through
lotVariant() over there - what every ploughed field and every house yard on the island is
fenced with. That second job is why it is the rung the island has most of by a long way.

    prop_rail_a       one bay: a post with two rails hung off it, low and wide apart
    prop_rail_b       one bay: the same, hung closer together and higher up
    prop_railpost     the post on its own, to close a run and to stand beside a gateway

The bay carries its own post, which the paling fence's bay does not, and the reason is
worth knowing because it is a rule rather than a preference. scripts/model-rules.mjs
measures every asset's lowest point and refuses one that hovers: a model is stood on the
ground and the ground is y = 0. Two rails and nothing else hover by definition - that is
what a post and rail fence is - so the post they hang off belongs to the bay. Which is
also how one is built and carried: a post with its rails already nailed to it.

It was a swept profile with the outline of a plank, and the outline was honest about what
was drawn and dishonest about what it was called. A post and rail fence is posts with
rails between them, and what stood on the island was a continuous board running the length
of the run: from above a hairline, from the lane a skirting board on the grass, and
nowhere the one thing that makes this kind of fence legible, which is that you can see
straight through it between the rails.

So the gaps are the whole point of this set, and they are why it costs no more than the
board did. A bay is two boxes and a post is one: thirty-six triangles to the ground cell,
which is exactly what the swept profile cost with its four-point outline swept at half a
unit. The island gets a fence you can see a field through for nothing.

A bay is one cell because that is how buildBorders() chains an edge - a run is a whole
number of cells, so it lays one bay per cell with a post at every joint, and a bay of any
other length would leave a stub at the end of every run. hamlets.js picks between the two
bays off the same hash the jitter uses.

Coordinates are the island's - Y up, the run along +Z, which is the convention every other
boundary set and the bridge already keep - and the helpers turn them into Blender's Z up
on the way in, exactly as build-fence.py does.
"""
import bpy
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/rail'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The two browns the swept rail was shaded between, to the digit: 0x6b4a2f at the foot and
# 0x7d5a3a at the top. Keeping them is what makes this fence replace that one rather than
# stand next to it looking like different timber - and the split is now on the material,
# where the posts are the part that goes in the ground and weathers and the rails are the
# part that does not. Nothing in web/js/hamlets.js has an opinion about the colour any
# more beyond the nudge towards the hamlet's own hue that every boundary gets.
COLORS = {
    'plank:post': 0x6b4a2f,
    'plank:rail': 0x7d5a3a,
}
materials = {}
for name, hex in COLORS.items():
    m = bpy.data.materials.new(name)
    rgb = [((hex >> s) & 255) / 255 for s in [16, 8, 0]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .88
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated. A negative factor
    turns every face inside out, and with no normals exported that is a black fence."""
    return (s[0], s[2], s[1])


def asset(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def adopt(name, mat, coll):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def timber(name, mat, coll, at, size):
    """One piece of sawn timber: a box, twelve triangles, centred on `at` and sized
    (w, h, d) in island axes.

    Flat ends, which is what lets a rail meet the next bay's rail without a seam and a post
    stand square on the joint. Everything in this set is one of these; the shape of a post
    and rail fence is entirely in where the pieces are and how much air is between them.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(at))
    o = adopt(name, mat, coll)
    o.scale = scale_xyz(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


# The nominal fence, and the two numbers hamlets.js scales it by. RAIL_T is the full width
# of the run across its own line and only the post takes all of it; the rails are half that
# and sit inside it, so the run's outline from above is a post every cell with a thin line
# between. RAIL_H is the top of the post. Both are the middle of this rung's range in
# BOUNDARY, so a fence of average standing is drawn at the size it was modelled.
BAY = 1.0              # one ground cell, which is four metres
RAIL_H = 0.32
RAIL_T = 0.105

# A rail is thinner across the run than a post and the post is what the run is measured by,
# so a rail passing a post is plainly nailed to its side rather than let into it. At this
# scale - a post 42 cm across, a rail 22 - that is the difference between a fence somebody
# knocked together and a piece of joinery, and this is the rung for the former.
RAIL_X, RAIL_Y = 0.055, 0.045
POST_D = 0.085


def bay(name, heights):
    """One bay: a post at the near end of the cell, and two rails running the length of it.

    The post is at -z rather than in the middle, so a run of bays puts one on every cell
    line and the rails span the gaps between them - which is the shape of the thing. The
    rails stop exactly on the cell line at both ends, so two bays meet flush and neither
    cap is ever drawn: both face away from the other and the island's material is single
    sided. Nothing needs to overlap to hide that joint, because the next bay's post stands
    on it.
    """
    coll = asset(name)
    timber(f'{name} post', 'plank:post', coll, (0, RAIL_H / 2, -BAY / 2), (RAIL_T, RAIL_H, POST_D))
    for which, y in zip(['lower', 'upper'], heights):
        timber(f'{name} rail {which}', 'plank:rail', coll, (0, y, 0), (RAIL_X, RAIL_Y, BAY))
    return coll


# Low and wide apart, which is the fence a field gets: one rail at knee height to turn a
# sheep and one at hand height to lean on.
bay('prop_rail_a', [0.105, 0.255])
# And the same fence built a hand higher and closer, which is what a stretch mended in a
# different year looks like. Two rhythms is all this rung needs - it has no boards and no
# stones to vary, so the only thing a run can differ in is where the rails run.
bay('prop_rail_b', [0.135, 0.285])

# ---------------------------------------------------------------- prop_railpost
# The same post on its own, for the two places a run has no bay to bring one: the far end,
# where the last bay's rails stop and nothing follows them, and either side of a gateway.
#
# Square-topped and untrimmed, like the one in the bay: there is no cap here of the kind
# the paling fence's post gets, because a cap is a finish and this is the fence a hamlet
# of tents puts up in a week. The rung above it is where the carpentry starts.
post = asset('prop_railpost')
timber('prop_railpost shaft', 'plank:post', post, (0, RAIL_H / 2, 0), (RAIL_T, RAIL_H, POST_D))

# The tallest thing in the set. Only a building reads this; a boundary measures itself off
# BOUNDARY in web/js/hamlets.js.
bpy.context.scene['building_height'] = RAIL_H

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything above is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on - so a bay moved aside
# for elbow room in the .blend would be drawn to one side of the spot it was asked for.
# Solo one collection in the outliner, or read the PNGs scripts/preview-model.py writes.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -.001))
floor = bpy.context.object
floor.name = 'Studio floor'
mat = bpy.data.materials.new('Studio')
mat.diffuse_color = (.21, .25, .20, 1)
floor.data.materials.append(mat)


def aim(o, p):
    o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.camera_add(location=(1.0, -1.25, .84))
cam = bpy.context.object
aim(cam, (0, 0, .2))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.55
bpy.context.scene.camera = cam
for loc, power, size in [((-1.3, -1.9, 2.2), 150, 2.0), ((1.6, -.6, 1.3), 60, 1.6), ((0, 1.4, 1.6), 100, 1.3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .2))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-rail.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'rail'})
