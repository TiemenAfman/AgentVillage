"""Author the quay's docks in Blender. Run with:

    blender --background --python scripts/build-docks.py

It writes assets/docks/agentvillage-docks.blend and bakes it to web/js/docks-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

This set is the quay's planks, and it replaces the three boxes a water cell used to get in
buildPierGeometry(): a flat slab 0.62 square, and two pins under it. Two things were wrong
with that and only one of them was the shape. The deck floated at 0.16 over a sea whose own
shader lifts the surface by up to 0.09 (WAVE in web/js/buildings.js), so at any hour the
crests washed straight through the planks - the pier was the one thing on the island drawn
under its own waterline. The deck here rides at QUAY_DECK, which is the clearance a bridge
already keeps, and the piles are long enough to disappear into the water rather than stop
at it.

    prop_dock_deck_a   one bay of decking: five boards across, two stringers, two piles
    prop_dock_deck_b   the same bay with the boards cut differently, for a run with rhythm
    prop_dock_head     the wide bay at the seaward end, where a boat comes alongside
    prop_dock_ramp     the landward bay, sloping down to meet the sand
    prop_dock_post     a mooring pile standing proud of the deck, banded and roped

A bay is one ground cell, because that is how the layout records a pier: pierCells() in
lib/layout.mjs walks up to five cells out from the shore along one axis, so a run of cells
is a run of bays and a bay of any other length would leave a stub at the end of every pier.
The run is along +Z, which is the convention the fence, the rail and the bridge already
keep, so one rotation turns a whole pier to face whichever way the sea is.

**Everything in this set is modelled in one frame, and that is the point.** The deck
surface sits at DECK over the foot of the piles, the ramp climbs to exactly that same DECK,
and the mooring post is a pile from the same foot that happens to keep going. So the island
stands the whole dock - decking, head, ramp and posts - at one height, QUAY_DECK - DECK,
and nothing has to be lined up twice. The first cut had the ramp in a frame of its own,
climbing from its own feet, and the seam between the ramp and the first bay was a step you
could see from the town square.

Which leaves the piles hanging below the frame: a pile foot is at y = 0, the deck is 0.80
over it, and the island drops the lot by 0.36, so every pile ends a third of a unit under
the sea. There is no seabed on the island to stand them on and nothing to see down there,
so a fixed length that is plainly long enough is the honest answer - and it is what keeps
scripts/model-rules.mjs satisfied that the set stands on the ground rather than hovering
over it.

The boards are modelled rather than left to the plank sheet, and that is the other half of
the answer to a pier that read as a bar of chocolate. The sheet gives a face the grain of
sawn timber, and a single slab wearing it is a slab with grain on it; what makes a dock a
dock is that you can see the water between the boards. Five boards to the bay is what 120
triangles buys, and the budget table in assets/README.md is why they are five and not
fifteen.

Coordinates are the island's - Y up, the run along +Z - and the helpers turn them into
Blender's Z up on the way in, exactly as build-props.py does.
"""
import bpy
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/docks'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The prefix before the colon is the texture sheet the face is drawn on - see
# assets/README.md. The two deck tones are C.plank out of buildings.js and a browner cut of
# it: one batch of boards laid beside another batch, which is what a deck that has been
# patched twice looks like and what stops five identical boards reading as one extrusion.
# The stringers and the piles take the rail fence's two browns, so timber standing in the
# water is the same timber as the post of a fence standing in a field. The blackened cap is
# the one colour here that is not already on the island: a pile head is tarred, and against
# the brown it is what makes a mooring post read as a mooring post from a hundred units up.
COLORS = {
    'plank:deck': 0xb07a4a, 'plank:weathered': 0x96683f, 'plank:pile': 0x5a3c28,
    'plankZ:beam': 0x6b4a2f, 'plain:tar': 0x3d372f, 'plain:iron': 0x3a3a3f,
    'plain:rope': 0xb9a37e,
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
    shader.inputs['Roughness'].default_value = .9
    m['emissive'] = 0.0
    materials[name] = m

# ---------------------------------------------------------------- the measurements
# A bay is one ground cell and a ground cell is four metres, so every number below is a
# real one: the walkway is two and a half metres across, a board is sixty-six centimetres
# wide, and a mooring post stands two metres over the planks.
BAY = 1.0             # one ground cell: what pierCells() hands out, one bay at a time
WALK = .62            # the walkway, and the width the drawn pier already had
DECK = .80            # the plank surface over the foot of the piles - the set's one datum
PLANK_T = .05         # a board
BEAM_T = .09          # a stringer under it
BEAM_W = .07
BEAM_X = .24          # the two stringers, a little inside the walkway's edges
PILE_R = .05
# Where the five boards of a bay lie, and how wide they are cut. The pitch is a fifth of a
# cell and the gap is what is left over, so the joint between two bays is the same gap as
# the joints inside one - which is the whole reason the outer two boards of both bays keep
# BOARD_W and only the middle three vary.
BOARD_Z = [-.4, -.2, 0, .2, .4]
BOARD_W = .165

# The seaward end, where a boat comes alongside. Wider than the walkway, because a quay you
# can only stand on in single file is a jetty: six and a half metres is a head two settlers
# can pass on with a barrel between them.
HEAD_W = 1.6
HEAD_BEAM_X = .52

# The landward end. It climbs exactly what the deck rides over the water, so its foot comes
# down on the waterline and the beach - which is where a shore cell is, by definition -
# rises the last hand's breadth to meet it. Anything gentler and the ramp would have to know
# how high the sand is, which is a thing a baked mesh cannot be told.
RAMP_RISE = .44

# A mooring post: a pile that keeps going. Half a unit over the planks is two metres, which
# is a post you tie a boat to rather than a stump you trip over.
POST_H = 1.30
POST_R = .075
POST_CAP = .07


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


def face(name, verts, faces, mat, coll):
    """A mesh given corner by corner, for the shapes no primitive makes."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return finish(name, mat, coll, obj=o)


def slab(name, x0, x1, z0, z1, top, t, mat, coll):
    """A board or a stringer, given by the box it fills: x0..x1 across, z0..z1 along the
    run, its upper surface at top(z) and t thick under it.

    Given corner by corner rather than as a cube primitive rolled into place, because two
    of the five pieces here slope. build-props.py has the long version of why that matters:
    a primitive points itself with a quaternion, where that leaves the prism's corners is
    then whatever the quaternion happened to be, and scripts/model-rules.mjs measures an
    asset's lowest point to the millimetre. Eight points have no roll to get wrong, and a
    box costs its twelve triangles either way.

    Wound counter-clockwise seen from outside, like prismRoof() in buildings.js and face()
    in build-props.py: the island draws a building with a single-sided material, so a face
    wound the wrong way is not a dark face, it is a hole you look through. The underside is
    wound too, unlike a roof's - a dock is the one thing on the island you can stand under,
    and from the water at dusk that is exactly where the camera is.
    """
    ya, yb = top(z0), top(z1)
    verts = [
        (x0, ya - t, z0), (x1, ya - t, z0), (x1, ya, z0), (x0, ya, z0),
        (x0, yb - t, z1), (x1, yb - t, z1), (x1, yb, z1), (x0, yb, z1),
    ]
    faces = [
        (4, 5, 6, 7),      # the end facing +z
        (1, 0, 3, 2),      # and the one facing -z
        (5, 1, 2, 6),      # the side facing +x
        (0, 4, 7, 3),      # and the one facing -x
        (3, 7, 6, 2),      # the top, which is the one anybody walks on
        (0, 1, 5, 4),      # and the underside
    ]
    return face(name, verts, faces, mat, coll)


def rod(name, a, b, r, mat, coll, sides=6):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r,
                                    depth=(b - a).length, location=(a + b) / 2)
    obj = finish(name, mat, coll)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def upright(name, p, r, h, mat, coll, sides=6):
    """The common case of rod(): standing on p, h tall. Its base cap is flat, which is what
    lets the roll be whatever the quaternion says without the foot lifting off the ground -
    the trap build-props.py's wheel fell into is a cap that is not flat on the ground."""
    return rod(name, p, (p[0], p[1] + h, p[2]), r, mat, coll, sides=sides)


def decking(name, width, boards, top, coll):
    """The boards of one bay, laid across the run so you walk over their grain.

    `boards` is (width, material) per board in BOARD_Z order, which is the only thing that
    differs between the two bays: the island lays them alternately along a run, and five
    identical boards repeated four times is an extrusion rather than a deck.
    """
    for i, (z, (w, mat)) in enumerate(zip(BOARD_Z, boards)):
        slab(f'{name} board {i}', -width / 2, width / 2, z - w / 2, z + w / 2, top, PLANK_T, mat, coll)


def carry(name, at_x, top, coll, pile_z=0.0):
    """The pair of stringers under a bay, each with a pile under it.

    The pile stops at the underside of the boards rather than at the stringer's, so the
    stringer hides its head: a pile cut off level with the timber it carries reads as a leg
    under a table, and a pile the timber is nailed to reads as a pier.
    """
    for sx, ex in [(-1, 'west'), (1, 'east')]:
        slab(f'{name} stringer {ex}', sx * at_x - BEAM_W / 2, sx * at_x + BEAM_W / 2,
             -BAY / 2, BAY / 2, lambda z: top(z) - PLANK_T, BEAM_T, 'plankZ:beam', coll)
        upright(f'{name} pile {ex}', (sx * at_x, 0, pile_z), PILE_R,
                top(pile_z) - PLANK_T - BEAM_T, 'plank:pile', coll, sides=4)


# ---------------------------------------------------------------- prop_dock_deck_a / _b
# The workhorse: one cell of walkway, and the piece the island lays for every water cell of
# a pier bar the last. Two of them, because a run of four identical bays is a corrugation
# and the cheapest way out of that is not a second model but the same model cut twice: the
# outer board of each bay keeps BOARD_W so the joint between bays stays the joint, and the
# middle three are sawn a few centimetres either way. From the lane it is a deck somebody
# laid; from above it is not a texture repeating.
def level(_z):
    return DECK


for name, boards in [
    ('prop_dock_deck_a', [(BOARD_W, 'plank:deck'), (BOARD_W, 'plank:weathered'), (BOARD_W, 'plank:deck'),
                          (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:weathered')]),
    ('prop_dock_deck_b', [(BOARD_W, 'plank:weathered'), (.150, 'plank:deck'), (.178, 'plank:weathered'),
                          (.148, 'plank:deck'), (BOARD_W, 'plank:deck')]),
]:
    bay = asset(name)
    decking(name, WALK, boards, level, bay)
    carry(name, BEAM_X, level, bay)

# ---------------------------------------------------------------- prop_dock_head
# The last cell of the run, widened. It is the difference between a dock and a plank walked
# out over the water: a boat comes alongside the head, and a settler stepping off it wants
# somewhere to stand that is not the gangway.
#
# Two piles rather than four, which is where the 120 triangles bite hardest in this set.
# Four would be 132 and each wing would have one of its own; instead the pair stands under
# the outer stringers where the wings begin, and the two mooring posts the island puts at
# the head's corners do the rest of the carrying - to the eye, which is the only thing doing
# any carrying here anyway.
head = asset('prop_dock_head')
decking('prop_dock_head', HEAD_W, [
    (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:weathered'),
    (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:weathered'),
], level, head)
carry('prop_dock_head', HEAD_BEAM_X, level, head)

# ---------------------------------------------------------------- prop_dock_ramp
# Where the planks meet the sand. It climbs RAMP_RISE over one cell, a little over twenty
# degrees - steeper than a road and shallower than a stair, which is what a ramp onto a
# jetty is - and it ends at DECK, the same plank surface every other piece here has, so it
# butts against the first bay with no step in it.
#
# Its piles are at the foot rather than the head, and they are stubs: at the head the ramp
# is already leaning on the bay in front of it, and at the foot there is nothing but beach.
# They are also the reason this asset stands on the ground at all - the boards at the low
# end are a third of a unit up in the air, and an asset whose lowest point is not zero is
# one scripts/model-rules.mjs refuses, rightly, because it would hover on the island.
def ramp(z):
    return DECK - RAMP_RISE * (BAY / 2 - z) / BAY


slope = asset('prop_dock_ramp')
decking('prop_dock_ramp', WALK, [
    (BOARD_W, 'plank:weathered'), (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:weathered'),
    (BOARD_W, 'plank:deck'), (BOARD_W, 'plank:deck'),
], ramp, slope)
carry('prop_dock_ramp', BEAM_X, ramp, slope, pile_z=-.38)

# ---------------------------------------------------------------- prop_dock_post
# A mooring pile: the same pile that holds the deck up, driven beside it rather than under
# it and left standing half a unit proud. These are what a dock is recognised by at any
# distance - the deck is a line on the water and the posts are the row of marks along it -
# so the island puts them at the head's four corners and down the run in pairs, outside the
# walkway where a rope would actually be belayed.
#
# Six sides rather than four, because this is the one piece here you walk up to: a squared
# post reads as sawn timber and these are whole trunks. The blackened cap is what a pile
# head gets in its first winter, the iron band under it is what stops the head splitting,
# and the two turns of rope above the band are why anybody drove it in the first place.
post = asset('prop_dock_post')
upright('prop_dock_post pile', (0, 0, 0), POST_R, POST_H, 'plank:pile', post)
upright('prop_dock_post cap', (0, POST_H, 0), POST_R + .02, POST_CAP, 'plain:tar', post)
upright('prop_dock_post band', (0, .95, 0), POST_R + .011, .05, 'plain:iron', post)
for i, y in enumerate([1.10, 1.152]):
    upright(f'prop_dock_post rope {i}', (0, y, 0), POST_R + .015, .045, 'plain:rope', post)

# The tallest thing in the set. Only a building reads this; the island stands a dock at the
# one height the whole set shares - see the note at the top about DECK being its datum.
bpy.context.scene['building_height'] = POST_H + POST_CAP

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything above is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on - so a bay moved aside
# for elbow room in the .blend would be drawn to one side of the cell it was asked for.
# That makes the file a pile when you open it: solo one collection in the outliner, or read
# the per-asset PNGs that scripts/preview-model.py writes.
#
# The floor is the one thing in here that is not the usual studio green. A dock stood on
# grass tells you nothing about the part of it that matters, which is how much of the pile
# is meant to be under water - so the floor sits at the waterline, RAMP_RISE below the plank
# surface, and is the colour of the island's sea.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, DECK - RAMP_RISE))
floor = bpy.context.object
floor.name = 'Studio water'
mat = bpy.data.materials.new('Studio')
mat.diffuse_color = (.06, .17, .24, 1)
floor.data.materials.append(mat)


def aim(o, p):
    o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.camera_add(location=(1.6, -2.0, 1.35))
cam = bpy.context.object
aim(cam, (0, 0, .6))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 2.4
bpy.context.scene.camera = cam
for loc, power, size in [((-1.3, -1.9, 2.2), 150, 2.0), ((1.6, -.6, 1.3), 60, 1.6), ((0, 1.4, 1.6), 100, 1.3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .6))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-docks.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'docks'})
