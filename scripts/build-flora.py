"""Author the island's trees, bushes and boulders in Blender. Run with:

    blender --background --python scripts/build-flora.py

It writes assets/flora/agentvillage-flora.blend and bakes it to web/js/flora-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

This is the cheapest set on the island and the dearest one, for the same reason: one
canopy is twenty thousand trees. Every triangle here is drawn again for every stem in
the forest - twice over, because the shadow pass walks every instance too - and the
shape of a pine is most of what the island looks like from any distance. Hence sixty
triangles for a tree, forty for a rock, and an `_lo` variant for the modest GPU.

What the budget buys, against what world.js drew before:

    flora_pine_a   trunk + four skirts     50    was a trunk and two cones, 44
    flora_oak_a    trunk + two lobes       50    was a trunk and one flat icosahedron, 40
    flora_bush_a   two lobes, no trunk     40    was nothing at all
    flora_rock_a   one knocked-about ball  20    was a regular dodecahedron, 36
    flora_rock_b   the same, flattened     20    was nothing; it is the coast's shelf

Four layers of needles for six triangles more than two cones is Blender's own
triangulation paying for it. three.js caps a five-sided cylinder with five triangles
round a middle vertex and Blender caps it with an n-gon that comes out as three; a skirt
is a six-sided cone over an n-gon base and costs ten. The trunk then throws both its own
caps away, because nobody can see either.

A tree is drawn with a material array - bark and needles - off one geometry with two
groups; see `grouped()` in web/js/models.js. That is what the slot in a material name is
for: `bark:` and `foliage:` are the island's own two sheets that no building uses, and
the order world.js asks for the groups in is the order it hands its materials in.

Coordinates here are the island's - Y up, front +Z - and xyz() turns them into Blender's
Z up on the way in, exactly as build-props.py and build-tavern.py do. That map is a
quarter turn about x and not a mirror, so a face wound anticlockwise here is still wound
anticlockwise once Blender has it and once the exporter has given it back: the winding
is the only thing that decides which way a face is lit, because no normals are exported
and world.js recomputes them flat.
"""
import bpy
import random
import runpy
from math import cos, pi, sin
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/flora'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The colours world.js mixed these shapes out of before Blender, to the digit. The shape
# is what this card changes; a forest that also changed colour would make the before and
# after pictures impossible to read. The island still tints every instance on top of
# these (`setColorAt` in placeTrees), and that multiplies.
#
# The prefix before the colon is the texture sheet the face is drawn on. `bark` and
# `foliage` are the island's two non-building sheets: scripts/make-textures.mjs draws
# them and world.js hangs each on a material of its own, which is why a tree needs two
# groups and a barrel does not. See assets/README.md.
COLORS = {
    'bark:pine': 0x6b4a2f,
    'foliage:pine': 0x3f7d47,
    'foliage:pine-light': 0x478950,
    'bark:oak': 0x6b4a2f,
    'foliage:oak': 0x5c9a3f,
    'foliage:bush': 0x53803c,
    'plain:rock': 0x7f7a72,
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


def xyz(p):
    """Island coordinates in, Blender coordinates out."""
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated.

    Running a scale through xyz() would hand Blender a negative factor, which turns every
    face on the object inside out - and since the exporter writes no normals, an inside
    out tree is not a wrong-looking tree but a black one.
    """
    return (s[0], s[2], s[1])


def asset(name):
    """One collection per plant, which is how the exporter tells them apart."""
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
    """A mesh written out vertex by vertex, in island coordinates, around its own origin.

    Everything in this file is small enough to be worth placing by hand: it is the only
    way to know the triangle count before Blender is asked, and the count is the whole
    point here.
    """
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    return adopt(name, mat, coll)


def ring(r, y, sides, phase=0.0):
    """`sides` points anticlockwise round a circle of radius `r` at height `y`."""
    return [(r * cos(phase + i * 2 * pi / sides), y, r * sin(phase + i * 2 * pi / sides))
            for i in range(sides)]


def tube(name, mat, coll, r_base, r_top, y0, y1, sides=5, phase=0.0):
    """An open-ended trunk: `sides` quads and no caps at all.

    The caps are the cheapest triangles to lose and the only ones nobody can see - the
    bottom is under the grass, since world.js sinks a tree 0.05 into the ground, and the
    top is inside the canopy. Six triangles saved on a five-sided trunk is more than half
    a skirt on the pine.
    """
    verts = ring(r_base, y0, sides, phase) + ring(r_top, y1, sides, phase)
    # Anticlockwise seen from outside: bottom, up, along, back down. The other order
    # lights the trunk from inside itself.
    faces = [(i, sides + i, sides + (i + 1) % sides, (i + 1) % sides) for i in range(sides)]
    return build(name, mat, coll, verts, faces)


def skirt(name, mat, coll, r, y0, h, sides=6, phase=0.0):
    """One layer of needles: a cone closed with an n-gon, `sides` + (`sides` - 2) triangles.

    Stacked with the layer above starting below this one's apex, so the skirts overlap
    and the silhouette steps outward instead of tapering in one straight line - which is
    the whole difference between this and the two bare cones it replaces.
    """
    verts = ring(r, y0, sides, phase) + [(0, y0 + h, 0)]
    apex = sides
    faces = [(i, apex, (i + 1) % sides) for i in range(sides)]
    # The rim again, as one n-gon, which Blender triangulates into sides - 2. Taken
    # anticlockwise from above it faces down, which is what closes the underside of a
    # bough rather than opening it.
    faces.append(tuple(range(sides)))
    return build(name, mat, coll, verts, faces)


def lobe(name, mat, coll, at, r, scale=(1, 1, 1), seed=0, rough=0.0):
    """A ball of leaves or a boulder: an icosphere, twenty triangles.

    Twenty is the number that matters. A once-subdivided icosphere is the cheapest shape
    that still reads as round from every side - a cube is twelve and reads as a cube, the
    next subdivision is eighty and buys nothing at this size - which is why the oak, the
    bush and both rocks are made of them, and why none of them can afford three.
    """
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=xyz(at))
    obj = bpy.context.object
    obj.scale = scale_xyz(scale)
    if rough:
        # Along the normal, so the ball keeps its winding and only loses its roundness.
        # Seeded, because `npm run models` is checked for being idempotent and a rock
        # rolled afresh on every bake would fail it.
        rnd = random.Random(seed)
        for v in obj.data.vertices:
            v.co += v.co.normalized() * rnd.uniform(-rough, rough)
    return adopt(name, mat, coll)


def lowest(objs):
    """The lowest point of these objects above the grass, in island units.

    Blender's z is the island's y. A jittered, squashed icosphere has no idea where its
    bottom ended up, and `npm run models` measures an asset's box against the ground and
    refuses one that hovers or sinks - so it is measured rather than guessed at.
    """
    return min((o.matrix_world @ v.co).z for o in objs for v in o.data.vertices)


def sit_on_ground(objs):
    """Drop a whole asset until its lowest vertex is exactly y = 0.

    All of its parts by the same amount: only the asset as a whole has to reach the
    ground, and levelling each lump on its own bottom would flatten a bush into a pair
    of hemispheres sitting side by side.
    """
    bpy.context.view_layer.update()
    drop = lowest(objs)
    for o in objs:
        o.location.z -= drop


# ------------------------------------------------------------------ flora_pine_a
# A conifer is mostly stem at the bottom and four overlapping skirts above it. Each skirt
# starts below the apex of the one under it, so the wood never shows through and the
# outline steps rather than tapers. The lower two take the darker green and the upper two
# the lighter, which is where the light falls on a fir and costs nothing to say.
pine = asset('flora_pine_a')
tube('flora_pine_a trunk', 'bark:pine', pine, .062, .045, 0, .52, sides=5)
for i, (r, y, h, mat) in enumerate([
    (.40, .28, .34, 'foliage:pine'),
    (.34, .50, .32, 'foliage:pine'),
    (.26, .70, .28, 'foliage:pine-light'),
    (.17, .88, .30, 'foliage:pine-light'),
]):
    # Half a facet of turn on alternate layers, so one skirt's corners sit over the next
    # one's flats and there is no seam running up the tree.
    skirt(f'flora_pine_a skirt {i + 1}', mat, pine, r, y, h, sides=6, phase=(i % 2) * pi / 6)

# The modest GPU's pine: the same trunk, two skirts instead of four. Thirty triangles,
# which is under the forty-four world.js drew before there was a .blend at all - modest
# has to come out cheaper than the baseline, not dearer.
pine_lo = asset('flora_pine_a_lo')
tube('flora_pine_a_lo trunk', 'bark:pine', pine_lo, .062, .045, 0, .52, sides=5)
skirt('flora_pine_a_lo skirt 1', 'foliage:pine', pine_lo, .40, .30, .48, sides=6)
skirt('flora_pine_a_lo skirt 2', 'foliage:pine-light', pine_lo, .28, .72, .46, sides=6, phase=pi / 6)

# ------------------------------------------------------------------- flora_oak_a
# A broadleaf wants a bollen crown, and one flattened icosahedron is a pebble on a stick.
# Two of them, different sizes and off centre from each other, give the lumpy
# double-headed outline a Settlers oak has. The lower one hangs past the top of the trunk
# so there is no daylight between bark and leaf.
oak = asset('flora_oak_a')
tube('flora_oak_a trunk', 'bark:oak', oak, .075, .055, 0, .48, sides=5)
oak_parts = [
    lobe('flora_oak_a crown', 'foliage:oak', oak, (0, .70, 0), .40, scale=(1.06, .82, 1.02), seed=1, rough=.02),
    lobe('flora_oak_a crown upper', 'foliage:oak', oak, (.09, .95, -.06), .26, scale=(1, .88, 1), seed=2, rough=.018),
]

oak_lo = asset('flora_oak_a_lo')
tube('flora_oak_a_lo trunk', 'bark:oak', oak_lo, .075, .055, 0, .48, sides=5)
lobe('flora_oak_a_lo crown', 'foliage:oak', oak_lo, (0, .74, 0), .42, scale=(1.04, .84, 1), seed=1, rough=.02)

# ------------------------------------------------------------------ flora_bush_a
# Undergrowth, and the one thing here with no trunk: two lobes sitting on the ground at
# the edge of a copse. Knocked about, because a bush made of two clean spheres reads as
# topiary and these grow where nobody has been.
bush = asset('flora_bush_a')
bush_parts = [
    lobe('flora_bush_a clump', 'foliage:bush', bush, (-.03, .16, .02), .21, scale=(1.12, .78, 1.05), seed=11, rough=.045),
    # Close enough in to grow out of the first one rather than beside it: two lumps with
    # daylight between them are two bushes, and at this size that reads as a mistake.
    lobe('flora_bush_a clump side', 'foliage:bush', bush, (.11, .10, -.05), .145, scale=(1.1, .84, 1.1), seed=12, rough=.04),
]

# ------------------------------------------------------- flora_rock_a, flora_rock_b
# An icosphere each, knocked about hard enough to lose the sphere. `rock_a` is the
# boulder that has always stood on the heath and the shore. `rock_b` is the same ball
# pressed flat into the wave-cut shelf the coast needed: wider than it is tall, low
# enough to walk past, and what every cell of terrain.coastCells gets a plate of.
rock_a = asset('flora_rock_a')
rock_a_parts = [lobe('flora_rock_a boulder', 'plain:rock', rock_a, (0, .20, 0), .23,
                     scale=(1.1, .92, 1.02), seed=21, rough=.085)]

rock_b = asset('flora_rock_b')
rock_b_parts = [lobe('flora_rock_b shelf', 'plain:rock', rock_b, (0, .09, 0), .31,
                     scale=(1.25, .32, 1.12), seed=22, rough=.075)]

# Only the things that have no trunk to stand on. A tree already reaches the ground - its
# stem starts at y = 0 - and levelling its crown as well would pull the canopy down onto
# the grass, which is exactly what it did the first time this ran.
for parts in [bush_parts, rock_a_parts, rock_b_parts]:
    sit_on_ground(parts)

# The tallest thing in the set: the pine, trunk to tip. Only a building reads this; a
# plant is stood on the ground by world.js and measures itself.
bpy.context.scene['building_height'] = 1.18

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


bpy.ops.object.camera_add(location=(1.7, -2.2, 1.5))
cam = bpy.context.object
aim(cam, (0, 0, .55))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.9
bpy.context.scene.camera = cam
for loc, power, size in [((-2.2, -3.2, 4.0), 700, 3.0), ((2.8, -1.2, 2.2), 260, 2.4), ((0, 2.6, 2.8), 420, 2.0)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .55))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-flora.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'flora'})
