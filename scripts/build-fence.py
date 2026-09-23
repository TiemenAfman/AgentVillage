"""Author the hamlet fence in Blender. Run with:

    blender --background --python scripts/build-fence.py

It writes assets/fence/promptholm-fence.blend and bakes it to web/js/fence-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

This set is the middle rung of the boundary ladder in web/js/hamlets.js. A hamlet of tents
and huts puts up post and rail, a hamlet of houses puts up dry stone, and what stood
between them was a hedge: a swept profile with a leaf sheet on it, the one surface on the
island that was grown rather than built. It is a paling fence now, and it is a model
rather than a profile because a fence is joinery - posts, rails, boards - and a swept
outline can only ever be the silhouette of one.

Three things come out of it, and the three are what a run of fence is made of:

    prop_fencepost    the post the bays hang between, and the gatepost where a road crosses
    prop_fence_a      one bay: two rails and six boards, exactly one ground cell long
    prop_fence_b      the same bay with a closer, less even rhythm

A bay is one cell because that is how buildBorders() chains an edge: a run is a whole
number of cells and it lays one bay per cell with a post at every joint, so the fence
tiles along the run without a seam and without a part-bay at the end. hamlets.js picks
between the bays off the same hash the jitter already uses, which is what keeps a long
straight run from reading as one extruded shape.

Coordinates are the island's - Y up, and the run along +Z, which is the convention the
bridge and the washing line already keep - and the helpers turn them into Blender's Z up
on the way in, exactly as build-props.py does.

The whole fence is modelled at a nominal height and thickness and scaled to the run's own
when it is placed, because the boundary's thickness ramps with the standing of the houses
inside it (see BOUNDARY in web/js/hamlets.js). FENCE_H and FENCE_T below are the middle of
that rung's range, so a fence of average standing is drawn at the size it was modelled and
the two ends of the ramp are a fifth either side of it.
"""
import bpy
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/fence'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The prefix before the colon is the texture sheet the face is drawn on - see
# assets/README.md. Both timbers are sawn boards, so both are `plank`, and the two hexes
# are PLANK and PLANK_DARK out of web/js/props.js: the pale sawn face and the weathered
# one the island already draws a deck, a bench and a hand-placed fence in. Keeping those
# two is what makes this fence read as the same carpentry as the rest of the island rather
# than as a new kind of wood that arrived with Blender.
#
# There is no second opinion about the colour anywhere. The boundary used to mix a base
# and a top hex per rung in web/js/hamlets.js and shade the profile between them; a
# modelled fence carries its colour on the slot, which is the rule in assets/README.md,
# and hamlets.js only nudges the lot towards the hamlet's own hue afterwards.
COLORS = {
    'plank:pale': 0xa9855a, 'plank:weathered': 0x8a6a44,
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


def asset(name):
    """One collection per piece, which is how the exporter tells them apart."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def finish(name, mat, coll, obj=None):
    obj = obj or bpy.context.object
    obj.name = name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def box(name, p, size, mat, coll):
    """A box centred on p, sized (w, h, d) in island axes.

    Everything in this set is a box, and that is the budget rather than a shortage of
    ideas. A prop gets 120 triangles (assets/README.md) and a box is twelve of them, so a
    bay of two rails and six boards is 96 and there is no room for a round post or a
    pointed pale. It is also the right shape twice over: a fence is sawn timber, and the
    thing is read as a silhouette from the air, where a chamfer costs three triangles a
    facet and shows nothing at all.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = finish(name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


# The nominal fence, and the two numbers hamlets.js scales it by. FENCE_T is the full
# width of the run across its own line - the same `t` the swept profiles are drawn to -
# and the post is the only thing that takes all of it, so the run's outline from above is
# a post every cell with a thinner line of boards between. FENCE_H is the top of the post,
# because the post is the tallest thing here and the rung's height is measured to it.
BAY = 1.0              # one ground cell, which is four metres
FENCE_H = 0.41
FENCE_T = 0.22

# ---------------------------------------------------------------- prop_fencepost
# A post with a cap on it. The cap is what makes a post read as a post rather than as a
# stake: it is the widest thing in the set, it throws a line of shadow along the top of
# the run, and from above it is the only part of the fence that is not a board. It costs
# a second box, which is twelve of the twenty-four triangles a post is worth - and the
# post is drawn once per cell against a bay of ninety-six, so that is four triangles in a
# hundred and twenty for the one detail you can pick out at island distance.
post = asset('prop_fencepost')
CAP_H = .035
box('prop_fencepost shaft', (0, (FENCE_H - CAP_H) / 2, 0), (.17, FENCE_H - CAP_H, .14),
    'plank:weathered', post)
box('prop_fencepost cap', (0, FENCE_H - CAP_H / 2, 0), (FENCE_T, CAP_H, .18), 'plank:weathered', post)


# ---------------------------------------------------------------- prop_fence_a, _b
# A bay is the length of fence between two posts, and it carries no post of its own: the
# run draws a post at every joint and a bay in every gap, so two bays meeting share one
# post instead of standing two in the same place. That is also why a bay is exactly one
# cell long - the run is chained in cells, and a bay of any other length would leave a
# stub at the end of every run on the island.
#
# The boards stand a little proud of the rails on both faces rather than being nailed to
# one of them, which is not what a carpenter would do and is what this fence needs: a
# hamlet's boundary is seen from both sides, half the runs on the island face the other
# way, and a fence with its rails showing on the outside would be an accident of which
# direction buildBorders() happened to chain that edge in.
#
# A board is wider along the run than it is thick across it, and getting that the wrong
# way round is the whole difference between a fence and a row of posts: the first render
# of this set had boards four tenths of a metre thick and three wide, and what came out
# was six little pillars with the rails hidden behind them. So the numbers below are read
# in metres before they are believed - a board is 22 cm thick and 41 cm wide, which is
# heavy timber but is timber, and the island draws everything at this weight.
RAIL_T, RAIL_X = .055, .04
BOARD_X, BOARD_FILL = .055, .62


def bay(name, boards, tall, short):
    """One bay: two rails along it, and `boards` boards standing on the ground.

    The boards reach the ground rather than hanging above it. That is partly what the rung
    is for - a fence here replaces something grown thick enough to stop a sheep - and
    partly the rule in scripts/model-rules.mjs, which measures an asset's lowest point and
    refuses anything that hovers. hamlets.js sinks the whole run five centimetres anyway,
    the same as the swept profiles, so no board ever shows daylight under it on a slope.
    """
    coll = asset(name)
    for which, y in [('lower', .115), ('upper', .295)]:
        box(f'{name} rail {which}', (0, y, 0), (RAIL_X, RAIL_T, BAY), 'plank:weathered', coll)
    width = BAY / boards * BOARD_FILL
    for i in range(boards):
        # Alternating heights, and the alternation is what one bay has and the other does
        # not. A run of identical bays is an extrusion however good the bay is; two
        # rhythms picked off a hash are a fence somebody built a bit at a time.
        h = tall if i % 2 == 0 else short
        box(f'{name} board {i}', (0, h / 2, -BAY / 2 + BAY * (i + .5) / boards),
            (BOARD_X, h, width), 'plank:pale', coll)
    return coll


# Six boards to the bay, all one height: the tidy run, and the one a hamlet gets most of.
# Six over four metres is a board every 67 cm, so a 41 cm board and a 26 cm gap - a paling
# fence rather than a hoarding. The gap is the point: you can see the field through it,
# which is what stops a hamlet boundary reading as a compound wall.
bay('prop_fence_a', 6, .345, .345)
# And seven at two heights, which is the same fence built closer and less evenly. Seven
# boards is 84 triangles and the bay is 108 of its 120, so an eighth would not fit - which
# is the honest reason there are two rhythms here and not four.
bay('prop_fence_b', 7, .345, .305)

# The tallest thing in the set, which is the post's cap. Only a building reads this; a
# boundary measures itself off BOUNDARY in web/js/hamlets.js.
bpy.context.scene['building_height'] = FENCE_H

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything above is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on - so a bay moved aside
# for elbow room in the .blend would be drawn to one side of the spot it was asked for.
# That makes the file a pile when you open it: solo one collection in the outliner, or
# read the per-asset PNGs that scripts/preview-model.py writes.
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-fence.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'fence'})
