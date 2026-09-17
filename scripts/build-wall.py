"""Author the hamlet's dry stone wall in Blender. Run with:

    blender --background --python scripts/build-wall.py

It writes assets/wall/agentvillage-wall.blend and bakes it to web/js/wall-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

The wall is the top rung of the boundary ladder in web/js/hamlets.js: what a hamlet of
manors and keeps puts round its own land. It was a swept profile, and the profile leaned
in as it rose, which is what a stacked thing does - but it leaned in by exactly the same
amount for four hundred metres, and the one thing a dry stone wall is never is uniform.
It is the stones now:

    prop_wall_a       a bay one ground cell long: eight stones in three courses
    prop_wall_b       the same wall laid by somebody else
    prop_wallpier     the pier a gateway leaves behind where a road crosses

A bay is one cell because that is how buildBorders() chains an edge - a run is a whole
number of cells, and a bay of any other length would leave a stub at the end of every
run. hamlets.js picks between the two bays off the same hash the jitter uses.

The batter comes out of the courses rather than out of a profile: each course is narrower
than the one below, so the wall leans in as it rises, which is what a stacked thing does.
And the middle course is offset half a stone and hangs over both ends of the bay, which is
the one thing a bay-per-cell scheme has to answer for. Two bays butting on the cell line
put a straight joint the full height of the wall every four metres, dead straight, all the
way round the hamlet; a course laid across that line covers it, exactly as a bond covers
the joints inside a bay.

What the model does not draw is the masonry. web/textures/stone-stacked.png already draws
that - staggered rows, each stone its own tone, a deep joint between them - and it is the
loudest sheet on the island. So the model is the mass and the silhouette, the sheet is the
stonework, and between them there is no third opinion: see the note about two things
deciding one thing in assets/README.md.

Coordinates are the island's - Y up, the run along +Z - and every shape here is a box.
The first version of this set used build-flora.py's `lobe()`, the knocked-about icosphere
it makes its boulders out of, on the reasoning that a rock and a stone in a wall are the
same object. They are not: a boulder is seen alone and a wall stone is seen in a course,
and twenty facets apiece in a row read as a heap of gemstones. See stone() below.
"""
import bpy
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/wall'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The two greys the swept wall was shaded between, to the digit: 0x8a857c at the footing
# and 0x9a958c at the top. Keeping them is what makes this wall replace that one rather
# than stand next to it looking like different stone - and the split is now on the
# material, where the coping is the course the weather gets at and the body is the one it
# does not.
COLORS = {
    'stone:wall': 0x8a857c,
    'stone:coping': 0x9a958c,
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
    shader.inputs['Roughness'].default_value = .95
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated. A negative factor
    turns every face inside out, and with no normals exported that is a black wall."""
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


def stone(name, mat, coll, at, size):
    """One stone: a box, twelve triangles, centred on `at` and sized (w, h, d) in island
    axes.

    A box and not the knocked-about icosphere the rocks on the beach are made of, which is
    the whole lesson of the first version of this set. An icosphere at one subdivision has
    twenty faces and every one of them catches the light differently, so five of them in a
    row read as a heap of gemstones - and worse, a ball tapers to a point at each end, so a
    bay tapered too and a run came out beaded: fat in the middle of every cell and thin on
    every cell line, the length of the island.

    A box has flat ends that butt against the next bay exactly, flat sides for the sheet to
    lie on, and eight fewer triangles - which is what pays for nine stones to the bay
    instead of five. What it does not have is rubble's irregular face, and that is
    web/textures/stone-stacked.png's job, not this file's.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(at))
    o = adopt(name, mat, coll)
    o.scale = scale_xyz(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


# The nominal wall, and the two numbers hamlets.js scales it by: WALL_T is the full width
# of the run across its own line, taken at the footing where the wall is widest, and
# WALL_H is the top of the coping. They are the middle of this rung's range in BOUNDARY.
BAY = 1.0              # one ground cell, which is four metres
WALL_H = 0.54
WALL_T = 0.45

# Three courses, from the footing up: how high the course sits, how tall it is, how wide
# across the wall, and where along the bay its stones are centred. Two things are doing
# work here and both are how a wall is actually laid.
#
# The batter: each course is narrower than the one under it, so the wall leans in as it
# rises. That was the swept profile's whole job and it is three numbers now.
#
# The bond: the middle course is offset half a stone, so its joints land over the middle
# of the stones below - and its two stones hang over the ends of the bay, which is what
# hides the one seam a bay-per-cell scheme would otherwise show. Two bays butting on the
# cell line put a straight joint the full height of the wall every four metres, all the
# way round the hamlet; a course that straddles that line covers it, exactly as it covers
# the joints inside the bay. The overhanging stones run into the neighbouring bay's stones
# and are lost inside the mass, which costs nothing: solid inside solid draws nothing.
COURSES = [
    # y bottom, height, half-width, stones at
    (0.00, 0.25, WALL_T / 2, [-1 / 3, 0, 1 / 3]),
    (0.21, 0.22, WALL_T / 2 * 0.90, [-0.25, 0.25]),
    (0.39, WALL_H - 0.39, WALL_T / 2 * 0.78, [-1 / 3, 0, 1 / 3]),
]


def bay(name, sizes):
    """One bay: eight stones in three courses, ninety-six triangles.

    `sizes` is a nudge per stone - a fraction of its own length and height - because a
    course of identical blocks is brickwork and this is rubble. It is the only difference
    between the two bays, and at the distance a boundary is read from it is enough: what
    the eye picks up along a run is where the joints fall, not how big any one stone is.
    """
    coll = asset(name)
    parts = []
    nudge = iter(sizes)
    for c, (y0, h, half, alongs) in enumerate(COURSES):
        mat = 'stone:coping' if c == len(COURSES) - 1 else 'stone:wall'
        span = BAY / len(alongs)
        for i, at in enumerate(alongs):
            long, tall = next(nudge)
            # Longer than its share of the bay, so neighbours overlap rather than meet:
            # a joint you can see through is a hole in a wall, and the sheet draws the
            # joints that should be seen.
            d = span * 1.18 * long
            parts.append(stone(f'{name} course {c} stone {i}', mat, coll,
                               (0, y0 + h * tall / 2, at), (half * 2, h * tall, d)))
    return parts


bay('prop_wall_a', [(1.00, 1.00), (0.92, 0.96), (1.06, 1.00),
                    (1.00, 1.00), (0.96, 0.94),
                    (0.94, 1.00), (1.08, 0.92), (0.98, 1.00)])
# Laid by somebody else. Two rhythms is what a run needs to stop reading as one extruded
# shape, and it is all a hundred and twenty triangles a bay will pay for.
bay('prop_wall_b', [(1.08, 0.94), (1.00, 1.00), (0.92, 1.00),
                    (0.94, 0.96), (1.04, 1.00),
                    (1.02, 1.00), (0.94, 1.00), (1.04, 0.94)])

# ---------------------------------------------------------------- prop_wallpier
# Where a road crosses, the wall opens and leaves a pier either side. It is the wall's own
# stone rather than the hewn cylinder the post-and-rail rung stands there: a gateway in a
# dry stone wall is stone, and a smooth six-sided post against a bay of rubble is the one
# place the two would plainly not be the same wall.
#
# Taller than the wall and narrower, which is what a pier is: it is the end of a run, so
# it has to read as deliberate rather than as the place the stones ran out.
PIER_H = 0.66
pier = asset('prop_wallpier')
for i, (y0, h, w, d, mat) in enumerate([
    (0.00, 0.26, WALL_T * 1.04, WALL_T * 0.92, 'stone:wall'),
    (0.23, 0.26, WALL_T * 0.96, WALL_T * 0.86, 'stone:wall'),
    # The capstone is proud of the shaft on every side, which is the whole of what makes a
    # pier read as finished rather than as the place the stones ran out.
    (0.46, PIER_H - 0.46, WALL_T * 1.12, WALL_T * 1.00, 'stone:coping'),
]):
    stone(f'prop_wallpier course {i}', mat, pier, (0, y0 + h / 2, 0), (w, h, d))

# The tallest thing in the set, which is the pier rather than the wall it ends. hamlets.js
# scales the whole set by the bay's own WALL_H, so the pier keeps standing proud of the
# run whatever standing the hamlet has.
bpy.context.scene['building_height'] = PIER_H

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on. Solo one collection in
# the outliner, or read the PNGs scripts/preview-model.py writes.
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-wall.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'wall'})
