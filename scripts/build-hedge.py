"""Author the hamlet hedge in Blender. Run with:

    blender --background --python scripts/build-hedge.py

It writes assets/hedge/agentvillage-hedge.blend and bakes it to web/js/hedge-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

The hedge is the third rung of the boundary ladder in web/js/hamlets.js, between the
paling fence and the dry stone: a hamlet of houses has grown out of a fence and has not
yet built a wall. It was a swept profile once, and the profile was the right idea for the
wrong reason - a shape that swells and draws in at the top is exactly what says "grown",
but it said it the same way for the whole length of the island. One outline extruded four
hundred metres is topiary, and topiary is what it looked like from the air.

So it is a bay per ground cell now, and the bay is in two halves:

    prop_hedge_a      the mass, and four tufts of new growth astride the top of it
    prop_hedge_b      the same hedge with a year more on it

The mass is the swept profile, kept: the outline that swells and draws in is what says
grown rather than stacked, and it was never the thing that was wrong. It is modelled here
instead of drawn in hamlets.js for one reason, which is its ends. They are flat, so a bay
butts against the next bay exactly and neither cap is ever drawn - both face away from the
other and the island's material is single sided. The lumpy shapes this set was first made
of tapered to a point at each end, and a run of them came out beaded: fat in the middle of
every cell and thin on every cell line, the length of the island.

The tufts are the half that varies. They are wide and low, they sit above where the mass
begins to draw in so that each flares back out to the full width, and they overhang their
own cell and grow into the neighbouring bay - which is what a hedge does and what knits
the corners, where two runs meet at right angles and a butt joint would be a notch you
could see from above. hamlets.js picks between the two bays off the same hash the jitter
uses, and two rhythms is what stops a long straight run reading as one extrusion again.

A bay is one cell because that is how buildBorders() chains an edge: a run is a whole
number of cells, and a bay of any other length would leave a stub at the end of every run
on the island.

Coordinates are the island's - Y up, the run along +Z - and xyz() turns them into
Blender's Z up on the way in, exactly as build-flora.py does. `lobe()` is that file's
knocked-about icosphere, twenty triangles, and it is here for the same reason it is
there: it is the cheapest thing that still reads as round from every side, and growth
that reads as anything else reads as masonry.
"""
import bpy
import random
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/hedge'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The two greens the swept hedge was shaded between, to the digit: 0x4a6b39 at the foot
# and 0x5d8347 at the crown. Keeping them is what makes this hedge replace that one
# rather than stand next to it looking like a different plant - and the split is now
# where it belongs, on the material, so the mass is old growth and the clipped tops are
# new. Nothing in web/js/hamlets.js has an opinion about the colour any more beyond the
# nudge towards the hamlet's own hue that every boundary gets.
#
# `foliage:` is the sheet, which is the island's leaf sheet rather than a building's -
# see assets/README.md. The boundary material hangs web/textures/hedge-leaf.png on it,
# drawn at hedge scale rather than canopy scale, which is the one thing about this rung
# that a tree could not lend it.
COLORS = {
    'foliage:hedge': 0x4a6b39,
    'foliage:hedge-new': 0x5d8347,
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
    shader.inputs['Roughness'].default_value = .93
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated.

    Running a scale through xyz() would hand Blender a negative factor, which turns every
    face inside out - and since the exporter writes no normals, an inside out hedge is
    not a wrong-looking hedge but a black one.
    """
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


def build(name, mat, coll, verts, faces):
    """A mesh written out corner by corner, in island coordinates, around its own origin.

    Wound anticlockwise seen from outside, like prismRoof() in buildings.js and roof() in
    build-village.py: the island draws a boundary with a single-sided material, so a face
    wound the wrong way is not a dark face, it is a hole you look through.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return adopt(name, mat, coll)


def swept(name, mat, coll, profile, half_t, height, length):
    """The mass of the hedge: one cross-section, swept the length of the bay, flat ended.

    This is the shape the swept hedge had - the profile is its profile, to the digit - and
    it is here rather than in web/js/hamlets.js for one reason: the ends. A bay has to butt
    against the next bay exactly, and the lumpy shapes that made the first version of this
    set tapered to a point at each end, so a run came out beaded - fat in the middle of
    every cell and thin on every cell line, the length of the island. A flat cap meets the
    next flat cap and nothing shows: both face away from each other and the material is
    single sided, so neither is ever drawn.

    `profile` is (half-width as a fraction of half_t, height as a fraction of height),
    from the ground up. There is no underside: a run is sunk five centimetres into the
    ground, and strip() drew none either.
    """
    n = len(profile)
    verts = []
    for sz in (-1, 1):
        for sx in (-1, 1):
            for wf, hf in profile:
                verts.append((sx * half_t * wf, height * hf, sz * length / 2))
    # The four corner posts of the index space: near/far end, near/far side.
    a, b = 0, n            # the -z end: -x side, +x side
    c, d = 2 * n, 3 * n    # the +z end
    faces = []
    for i in range(n - 1):
        faces.append((a + i, c + i, c + i + 1, a + i + 1))          # the -x flank
        faces.append((b + i, b + i + 1, d + i + 1, d + i))          # the +x flank
    # The ridge along the top, wound the way round that faces up rather than down: the
    # two flanks run along z and this one has to as well, or the hedge is roofed with a
    # hole. Nothing in a preview would show it - Workbench draws both sides - so it is
    # worked out here rather than looked at.
    faces.append((a + n - 1, c + n - 1, d + n - 1, b + n - 1))
    # Both ends closed, so a run that stops at a gateway is not a tube you see through.
    ring = list(range(a, a + n)) + list(range(b + n - 1, b - 1, -1))
    faces.append(tuple(ring))
    faces.append(tuple(reversed(list(range(c, c + n)) + list(range(d + n - 1, d - 1, -1)))))
    return build(name, mat, coll, verts, faces)


def lobe(name, mat, coll, at, r, scale=(1, 1, 1), seed=0, rough=0.0):
    """A ball of leaves: an icosphere at one subdivision, twenty triangles.

    Twenty is the number that matters, and it is build-flora.py's argument verbatim: a
    cube is twelve and reads as a cube, the next subdivision is eighty and buys nothing
    at this size.
    """
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=xyz(at))
    obj = bpy.context.object
    obj.scale = scale_xyz(scale)
    if rough:
        # Along the normal, so the ball keeps its winding and only loses its roundness.
        # Seeded, because `npm run models` is checked for being idempotent and growth
        # rolled afresh on every bake would fail it.
        rnd = random.Random(seed)
        for v in obj.data.vertices:
            v.co += v.co.normalized() * rnd.uniform(-rough, rough)
    return adopt(name, mat, coll)


# The nominal hedge, and the two numbers hamlets.js scales it by: HEDGE_T is the full
# width of the run across its own line and HEDGE_H the top of the tallest clipped lump.
# They are the middle of this rung's range in BOUNDARY, so a hedge of average standing is
# drawn at the size it was modelled.
BAY = 1.0              # one ground cell, which is four metres
HEDGE_H = 0.50
HEDGE_T = 0.34
# The mass stops short of the top and the tufts carry the last hand's width. That split is
# the whole point of modelling this rung: the mass is the same for every cell on the island
# and the tufts are not, so what varies is exactly the line you read a hedge by from above.
MASS_H = 0.42

# The cross-section the swept hedge was drawn to, unchanged: half-width as a fraction of
# its own thickness, then height as a fraction of its own height. A shape that swells and
# draws in at the top is what reads as grown rather than stacked, and that much was always
# right - the four points below are the old five with the two middle ones merged, which is
# eight triangles back for a silhouette nobody can tell apart at boundary distance.
PROFILE = [(0.54, 0), (1.0, 0.34), (0.90, 0.72), (0.34, 1.0)]


def bay(name, tufts, seed):
    """One bay: the mass, and four tufts of new growth astride the top of it.

    The tufts are where this stops being an extrusion. They are wide and low - a cushion
    rather than a ball, which is what the first version of this set got wrong and what
    made it read as a row of gemstones - and they sit at 0.44, above where the mass has
    begun to draw in, so each one flares back out to the full width of the hedge and
    breaks the line of the top. Four to the cell, at the quarters, with enough overlap
    that no daylight shows between them: a hedge you can see through is a row of bushes,
    and the rung below this one is already a fence.
    """
    coll = asset(name)
    parts = [swept(f'{name} mass', 'foliage:hedge', coll, PROFILE, HEDGE_T / 2, MASS_H, BAY)]
    for i, top in enumerate(tufts):
        at = -BAY / 2 + BAY * (i + .5) / len(tufts)
        parts.append(lobe(f'{name} tuft {i}', 'foliage:hedge-new', coll, (0, .34, at), .22,
                          scale=(HEDGE_T / 2 / .22, (top - .34) / .22, .27 / .22),
                          seed=seed + i, rough=.035))
    # The mass already stands on the ground; the tufts are measured off it, so nothing is
    # dropped here. `npm run models` measures the box all the same and says so if it is
    # not on the grass.
    return parts


# Clipped level, near enough: a hedge somebody keeps. The unevenness is in the tufts
# rather than in the line of the top, which is the difference between a kept hedge and a
# neglected one, and a hamlet that has got as far as houses keeps its hedge.
bay('prop_hedge_a', [HEDGE_H, HEDGE_H - .025, HEDGE_H - .005, HEDGE_H - .03], 1)
# And one with a year more growth on it. Two rhythms is all the variation this needs: a
# run picks between them off a hash, and at the distance a boundary is read from, two is
# already enough to stop it reading as one extruded shape.
bay('prop_hedge_b', [HEDGE_H - .04, HEDGE_H + .02, HEDGE_H - .01, HEDGE_H + .01], 21)

# The tallest thing in the set. Only a building reads this; a boundary measures itself off
# BOUNDARY in web/js/hamlets.js.
bpy.context.scene['building_height'] = HEDGE_H + .02

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Both bays are stacked on the origin, because the exporter bakes an
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
    from mathutils import Vector
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-hedge.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'hedge'})
