"""Author the loose props in Blender. Run with:

    blender --background --python scripts/build-props.py

It writes assets/props/promptholm-props.blend and bakes it to web/js/props-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

Unlike the tavern, this set holds several things, so each one lives in a collection named
after it: a barrel, a handcart, a crate, a woodpile, a tent and a washing line. Everything
inside a collection is named after it too, which is what keeps a part name unique across
every set the register in web/js/models.js holds. Coordinates here are the island's - Y
up, front +Z - and the helpers turn them into Blender's Z up on the way in, exactly as
build-tavern.py does.

These are the things lying about between the houses in the reference illustration, and
they are the cheapest thing on the island: a prop stood in a yard is merged into the same
single geometry as the house it belongs to, so a street of them costs no draw calls at
all. What it does cost is triangles, and a prop gets 120 of them - see the budget table in
assets/README.md. That number is why the shapes below are as coarse as they are, and every
place it bites is written down where it bites.

Two rules of thumb the budget forces, worth knowing before reading on: a four-sided prism
is twelve triangles, exactly like a box, and every extra facet on a round thing costs
three - so eight sides cost as much as two boxes. Anything that can be a beam, a billet or
a plank is therefore four-sided, and the facets are spent on the two shapes where
roundness is the whole point: the barrel and the cart's wheels.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/props'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The prefix before the colon is the texture sheet the face is drawn on - see
# assets/README.md. oak, dark and iron are the three the tavern's own barrels are made of,
# so a barrel put down by hand and a barrel standing by the tavern door are the same
# barrel. canvas and stripe are C.canvas and C.stripe out of buildings.js, which is the
# cloth and the trim the island drew a tent in before there was a model of one: keeping
# the hexes is what makes the Blender tent replace the old one rather than stand beside it
# looking like a different tent.
COLORS = {
    'plank:oak': 0x845335, 'plank:dark': 0x503728, 'plain:iron': 0x343638,
    'plain:canvas': 0xe9d8b4, 'plain:shade': 0x4a3d2e, 'plain:stripe': 0xc86b4a,
    'plain:rope': 0xb9a37e, 'plain:linen': 0xece4d2, 'plain:indigo': 0x8095ae,
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


def finish(name, mat, coll, obj=None):
    obj = obj or bpy.context.object
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


def upright(name, p, r, h, mat, coll, top=None, sides=8):
    """The common case of rod(): standing on p, h tall. Its base cap is flat on the
    ground, which is what scripts/model-rules.mjs measures an origin against."""
    return rod(name, p, (p[0], p[1] + h, p[2]), r, mat, coll, top=top, sides=sides)


# rod() points itself with to_track_quat, and where a prism's corners end up around its
# own axis is then whatever that quaternion happened to be. For anything standing on the
# ground that matters: a hexagon rolled so a flat is at the bottom leaves its lowest point
# an eighth of its radius above where the arithmetic says it is - the cart's wheels came
# out fifteen millimetres over the grass that way - and `npm run models` measures exactly
# that and is right to refuse it. So the two shapes here that touch the ground are turned
# by hand, with a corner pointing straight down.
def wheel(name, p, r, thick, mat, coll, sides=6):
    """A wheel on an axle along x, with a point of the rim exactly r below the axle.

    Blender begins a cone's ring on its own +Y and runs it along its own +Z, so the roll
    is a quarter turn to bring that first point round to +X and the tilt a quarter turn to
    lay the axis along the island's x. Both together, in that order, and as a quaternion
    because Euler XYZ cannot put a roll about the object's own axis first.
    """
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r, depth=thick, location=xyz(p))
    o = finish(name, mat, coll)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Quaternion((0, 1, 0), math.pi / 2) @ Quaternion((0, 0, 1), -math.pi / 2)
    return o


def billet(name, p, r, length, mat, coll, sides=4):
    """A prism lying along z, centred on p, with a corner exactly r below its axis."""
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r, depth=length,
                                    location=xyz(p), rotation=(math.pi / 2, 0, 0))
    return finish(name, mat, coll)


def box(name, p, size, mat, coll, turn=0):
    """A box centred on p, sized (w, h, d) in island axes; `turn` rolls it about x."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = finish(name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.rotation_euler = (turn, 0, 0)
    return o


def face(name, verts, faces, mat, coll):
    """A mesh given corner by corner, for the shapes no primitive makes.

    The tent's canvas is the one thing in this set that has to be a specific seven
    triangles: a prism with a hole in one end. Built out of primitives it would be two
    slopes and a gable and would cost four boxes; given point by point it costs what the
    surface actually is, and it can be left open where the door goes.

    Wound counter-clockwise seen from outside, like prismRoof() in buildings.js and roof()
    in build-village.py: the island draws buildings with a single-sided material, so a
    face wound the wrong way is not a dark face, it is a hole you look through.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return finish(name, mat, coll, obj=o)


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

# ---------------------------------------------------------------- prop_cart
# A handcart: a boarded box on two wheels, a headboard at the back and one draught pole
# out the front, sloping down to the ground the way a parked one rests on it. Bed and pole
# together are two and a half metres and the wheels are 0.68 across, which is a cart a
# settler pulls and not a wagon something has to be harnessed to. It took three goes to
# stop reading as furniture, and both mistakes are worth knowing: a bed as long as the
# wheels are tall is an armchair, and a bed as wide as the axle hides the wheels under it
# and leaves a table. So the box is narrow, the wheels stand outside it, and it has sides.
#
# The wheels are where the triangle budget shows. A spoked wheel wants a round rim and
# something in the middle of it; eight sides would be 28 triangles each, and two of those
# plus an axle and two spoke bars is more than half the prop. So the rim is six sides - 20
# - and the axle and the spokes are one bar: a single board run right through both wheels
# and rolled off their facets, which from outside is a hub with two spokes across it and
# between them is the axle. One part instead of three, and the twelve triangles that saves
# are the cart's sideboards.
cart = asset('prop_cart')
WHEEL_R, AXLE_Y = .085, .085
# The bed rides on top of the axle rather than beside it, which is what a cart with
# outboard wheels does and is also what keeps the spoke bar out of sight: rolled, that bar
# stands 0.156 tall, and a bed any lower has it lying in the middle of the load.
box('prop_cart bed', (0, .163, -.01), (.20, .026, .36), 'plank:oak', cart)
for sx, ex in [(-1, 'west'), (1, 'east')]:
    box(f'prop_cart side {ex}', (sx * .10, .211, -.01), (.02, .07, .36), 'plank:dark', cart)
    wheel(f'prop_cart wheel {ex}', (sx * .128, AXLE_Y, -.02), WHEEL_R, .026, 'plank:dark', cart)
box('prop_cart headboard', (0, .221, -.202), (.20, .09, .024), 'plank:dark', cart)
box('prop_cart axle', (0, AXLE_Y, -.02), (.31, WHEEL_R * 1.76, .024), 'plank:oak', cart, turn=.52)
rod('prop_cart pole', (0, .145, .16), (0, .022, .42), .016, 'plank:oak', cart, sides=4)

# ---------------------------------------------------------------- prop_crate
# A packing case a metre across: boarded sides, a batten up each corner, two bands round
# it and an iron strap across the front. The framing is the point - a plain box at this
# size is a plain box, and what makes it a crate is the timber on the outside of it.
crate = asset('prop_crate')
box('prop_crate body', (0, .10, 0), (.24, .20, .24), 'plank:oak', crate)
box('prop_crate lid', (0, .214, 0), (.26, .028, .26), 'plank:dark', crate)
for sx, ex in [(-1, 'west'), (1, 'east')]:
    for sz, ez in [(-1, 'back'), (1, 'front')]:
        box(f'prop_crate batten {ez} {ex}', (sx * .12, .10, sz * .12), (.04, .20, .04), 'plank:dark', crate)
# Proud of the boards by six millimetres, which puts a shadow line round the case instead
# of a stripe painted on it.
for which, y in [('lower', .055), ('upper', .155)]:
    box(f'prop_crate band {which}', (0, y, 0), (.252, .024, .252), 'plank:dark', crate)
# Corner to corner across the front face, and a rod rather than a rolled box because a
# diagonal is what a rod is for.
rod('prop_crate strap', (-.10, .025, .127), (.10, .185, .127), .014, 'plain:iron', crate, sides=4)

# ---------------------------------------------------------------- prop_woodpile
# Nine split billets stacked four, three and two, ends to the front so you see the cut
# faces. Firewood is split rather than round, so a four-sided section is not the cheap
# version of a log here - it is what a billet looks like - and nine of them at twelve
# triangles each is the whole prop for 108.
#
# The rows are offset by half a billet so the upper ones sit in the notches of the lower,
# which is how a stack stands up, and the two timbers alternate so the pile reads as split
# wood weathering rather than as one moulded lump.
woodpile = asset('prop_woodpile')
BILLET_R, BILLET_STEP = .055, .112
for row, (y, count) in enumerate([(.055, 4), (.165, 3), (.275, 2)]):
    for i in range(count):
        x = (i - (count - 1) / 2) * BILLET_STEP
        billet(f'prop_woodpile billet {row}{i}', (x, y, 0), BILLET_R, .28,
               'plank:oak' if (row + i) % 2 else 'plank:dark', woodpile)

# ---------------------------------------------------------------- prop_tent
# A ridge tent, open at the front, and the one prop in this set that is also a dwelling:
# buildings.js houseBody() stands it on the plot of a session that has not built anything
# yet, in place of the prismRoof and the two boxes the island drew there before. So the
# door has to be on +Z - the axis check the whole convention exists for - and the thing
# has to stand up to being looked at from the lane rather than only from above.
#
# There is deliberately no anchor on it: a tent has no chimney and houseBody() gives it no
# smoke. The band down the two front edges carries the session's colour instead, and it is
# the one slot the island repaints, the way it repaints the plaster and the tiles on a
# house. It was a strip across the middle of the doorway first, which from the lane looked
# like a plank someone had left leaning in the entrance; piping the opening puts the colour
# where the eye already is.
tent = asset('prop_tent')
TENT_W, TENT_D, TENT_H = .38, .36, .58
face('prop_tent canvas', [
    (-TENT_W, 0, -TENT_D), (TENT_W, 0, -TENT_D), (TENT_W, 0, TENT_D), (-TENT_W, 0, TENT_D),
    (0, TENT_H, -TENT_D), (0, TENT_H, TENT_D),
], [
    (0, 3, 5), (0, 5, 4),      # the slope facing -x
    (1, 4, 5), (1, 5, 2),      # the slope facing +x
    (0, 4, 1),                 # the gable at the back, walled up
    # The groundsheet faces up, unlike the underside of prismRoof() which this replaces.
    # Nothing is ever under a roof, so that one is wound downward and costs nothing; a tent
    # is open at the front and the floor is the first thing you see through the door.
    (0, 2, 1), (0, 3, 2),
], 'plain:canvas', tent)
# One triangle of shadow a hair inside the back gable. Without it the open front looks
# straight through that gable's own back face, which the single-sided material culls, and
# a tent with a hole in the far end of it is what you get.
face('prop_tent shade', [
    (-TENT_W * .95, 0, -TENT_D + .015), (TENT_W * .95, 0, -TENT_D + .015),
    (0, TENT_H * .95, -TENT_D + .015),
], [(0, 1, 2)], 'plain:shade', tent)
rod('prop_tent ridge', (0, TENT_H, -.46), (0, TENT_H, .46), .02, 'plank:dark', tent, sides=4)
for sz, ez in [(-1, 'back'), (1, 'front')]:
    upright(f'prop_tent pole {ez}', (0, 0, sz * (TENT_D + .015)), .018, TENT_H + .03,
            'plank:oak', tent, sides=4)
    # Two guys off each end of the ridge, splayed out to where a peg would be. They are
    # what stops a tent reading as a wedge of cloth on the grass, and they also decide how
    # much of the plot it takes: pegged further out the tent is prettier and the step under
    # it grows a hand's width on every side, so they land just clear of the poles.
    for sx, ex in [(-1, 'west'), (1, 'east')]:
        rod(f'prop_tent guy {ez} {ex}', (0, TENT_H - .015, sz * (TENT_D + .015)),
            (sx * .26, .012, sz * .50), .008, 'plain:rope', tent, sides=4)
for sx, ex in [(-1, 'west'), (1, 'east')]:
    rod(f'prop_tent band {ex}', (sx * TENT_W, .016, TENT_D + .006), (0, TENT_H - .01, TENT_D + .006),
        .022, 'plain:stripe', tent, sides=4)

# ---------------------------------------------------------------- prop_washline
# Two posts, two lines and the washing on them, and nothing moves: the flags on this
# island wave in a vertex shader of their own and one instanced mesh serves all of them,
# but that is a mesh with its own material, and a prop is drawn with the building material
# and merged into it. A still washing line costs nothing; a waving one costs a draw call.
#
# It runs along z, which is the convention the fence and the bridge already keep, so --rot
# turns it to lie along whatever it was put beside. The garments are thin boxes rather
# than flat sheets, because a single-sided sheet vanishes when you walk round it.
washline = asset('prop_washline')
LINE_Y, LINE_HALF = .44, .40
for sz, ez in [(-1, 'back'), (1, 'front')]:
    upright(f'prop_washline post {ez}', (0, 0, sz * LINE_HALF), .022, LINE_Y + .02,
            'plank:oak', washline, sides=4)
    box(f'prop_washline crossbar {ez}', (0, LINE_Y + .025, sz * LINE_HALF), (.22, .024, .03),
        'plank:dark', washline)
for sx, ex in [(-1, 'west'), (1, 'east')]:
    rod(f'prop_washline line {ex}', (sx * .085, LINE_Y, -LINE_HALF), (sx * .085, LINE_Y, LINE_HALF),
        .006, 'plain:rope', washline, sides=4)
for name, mat, p, size in [
    ('sheet', 'plain:linen', (-.085, .33, -.14), (.02, .22, .26)),
    ('shirt', 'plain:indigo', (.085, .365, .10), (.018, .15, .17)),
    ('cloth', 'plain:linen', (-.085, .38, .19), (.018, .12, .13)),
]:
    box(f'prop_washline {name}', p, size, mat, washline)

# The tallest thing in the set, which is now the tent's ridge rather than a barrel lid.
# Only a building reads this; a prop is stood on the ground by props.js and measures
# itself.
bpy.context.scene['building_height'] = TENT_H + .05

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything above is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on - so a cart moved aside
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
cam.data.ortho_scale = 1.15
bpy.context.scene.camera = cam
for loc, power, size in [((-1.3, -1.9, 2.2), 150, 2.0), ((1.6, -.6, 1.3), 60, 1.6), ((0, 1.4, 1.6), 100, 1.3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .2))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-props.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'props'})
