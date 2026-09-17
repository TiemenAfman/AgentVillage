"""Author the village's roofs, roof add-ons and civic landmarks in Blender. Run with:

    blender --background --python scripts/build-village.py

It writes assets/village/agentvillage-village.blend and bakes it to web/js/village-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export
those with `npm run models` instead.

What is in here is the architecture of the reference illustration that everything else on
the island is being pulled towards: red pantiled roofs at several pitches, ridge courses,
dormers, little turrets with cone caps, brick chimneys, and a timber water tower on
splayed legs. None of it is a building. They are pieces a house is composed from, which
is why they are in one set rather than one .blend each: buildings.js picks a roof with
the rng it already has and stands it on a wall it already drew.

Two conventions in here that the rest of assets/README.md does not have to spell out:

**The roofs are modelled on a unit footprint.** A gable spans exactly 1 x 1 with its
origin on the eaves plane, so `mesh('roof_gable_a tiles', hex, { y: top, sx: w, sz: w })`
puts it on a wall of any width the way `prismRoof(w, w, h)` used to - the scale is the
overhang, and the pitch is `sy`. Nothing here is bigger than its unit square, including
the barge boards, because the caller multiplies whatever it finds.

**Three of the slots are painted by the island, not by Blender.** There is one gable and
there are four styles, so the tiles, the plaster and a lit pane take their colour from
`PALETTE` at build time (`repaint` in buildings.js mesh()). The colours below are still
the real ones - they are what the preview PNGs show and they are the tavern's own
terracotta and cream, so a Blender roof held against the tavern's roof is the same roof -
but on the island a fable house gets the fable red. Timber, brick, iron and the water
tower's shingles are not repainted: oak is oak whoever lives under it.

Everything is authored around the origin, because the exporter bakes an object's world
origin as the point the island puts the part on - so a dormer moved aside for elbow room
in the .blend would be drawn to one side of the roof it was asked for. That makes the
file a pile when you open it: solo one collection in the outliner, or look at
assets/village/renders/, which is what `npm run models:preview` is for.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/village'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The prefix before the colon is the texture sheet the face is drawn on; the rest is for
# us. `plankZ` is the same boards read a quarter turn round, for a run along z - the barge
# board down a gable end rather than the eaves board along it.
#
# terracotta/light/cream/oak/dark/brick/foundation/glass are the tavern's own hexes to the
# byte, so a Blender roof and the tavern's roof are one roof. shingle is the water tower's
# alone: it is not a tiled roof, it is the cheapest lid a carpenter puts on a tank.
COLORS = {
    'roof:terracotta': 0xb8552f, 'roof:light': 0xc76b3d, 'roof:shingle': 0x7a5a3f,
    'wall:cream': 0xe8d4ad,
    'plank:oak': 0x845335, 'plank:dark': 0x503728, 'plankZ:dark': 0x503728,
    'stone:brick': 0x9c5a44, 'stone:foundation': 0x968778,
    'plain:glass': 0xffcb75, 'plain:iron': 0x343638, 'plain:copper': 0xb87333,
    'plain:canvas-green': 0x4f7b50, 'plain:canvas-cream': 0xefe0bd,
    'plain:chalk': 0x27322b, 'plain:chalk-mark': 0xe8e2c9,
    'plain:seed-gold': 0xd6a83d, 'plain:seed-rust': 0xa95332,
    'plain:seed-green': 0x799447, 'plain:sack': 0xb99a68,
    'plain:water': 0x64b4cf, 'stone:aged': 0xb7ad9b,
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
    m['emissive'] = 1.0 if name == 'plain:glass' else 0.0
    if m['emissive']:
        shader.inputs['Emission Color'].default_value = (*rgb, 1)
        shader.inputs['Emission Strength'].default_value = .35
    materials[name] = m


def xyz(p):
    """Island coordinates in, Blender coordinates out: Y up becomes Z up, front +Z is -Y."""
    return (p[0], -p[2], p[1])


def asset(name):
    """One collection per composable, which is how the exporter tells them apart."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def adopt(obj, name, mat, coll):
    obj.name = name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def box(name, p, size, mat, coll):
    """A box centred on p, sized (w, h, d) in island axes."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = adopt(bpy.context.object, name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def rod(name, a, b, r, mat, coll, top=None, sides=8):
    """A prism from a to b, radius across the axis; four sides makes a beam, six a roll."""
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top,
                                    depth=(b - a).length, location=(a + b) / 2)
    o = adopt(bpy.context.object, name, mat, coll)
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return o


def upright(name, p, r, h, mat, coll, top=None, sides=8):
    """The common case of rod(): standing on p, h tall."""
    return rod(name, p, (p[0], p[1] + h, p[2]), r, mat, coll, top=top, sides=sides)


def roof(name, p, w, d, h, mat, coll, ridge=None, turn=0):
    """A pitched roof standing on p: four eaves corners and a ridge along x.

    `ridge` shortens the ridge and turns the two gable ends into hips, which is the only
    difference between a gable and a hip roof and costs not one triangle more - the same
    six points and the same eight faces, with two of them moved inward.
    """
    r = w / 2 if ridge is None else ridge / 2
    v = [(-w / 2, 0, -d / 2), (w / 2, 0, -d / 2), (w / 2, 0, d / 2), (-w / 2, 0, d / 2),
         (-r, h, 0), (r, h, 0)]
    # Wound counter-clockwise seen from outside, or the roof is back-face culled and you
    # look straight through the house - the same winding prismRoof() in buildings.js has.
    faces = [(0, 5, 1), (0, 4, 5), (2, 4, 3), (2, 5, 4), (0, 3, 4), (1, 5, 2), (0, 2, 3), (0, 1, 2)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(a) for a in v], [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    o.location = xyz(p)
    o.rotation_euler.z = turn
    return adopt(o, name, mat, coll)


def empty(kind, p, coll):
    """An anchor.* Empty is what main.js hangs smoke, a flag or a sign on."""
    bpy.ops.object.empty_add(location=xyz(p))
    o = bpy.context.object
    o.name = 'anchor.' + kind
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    return o


def ridge_course(prefix, coll, x0, x1, y, r, count, along='x'):
    """The row of half-round tiles that caps a ridge, as `count` rolls end to end.

    A ridge drawn as one long rod reads as a pipe. The reference has a line of separate
    caps along every ridge and it is the single detail that says "tiled" from the air, so
    the ridge gets its roll and the caps get laid over it - which is also how the tavern's
    own ridge is built, twelve rolls at 0.13 apart.
    """
    for i in range(count):
        t = (i + .5) / count
        c = x0 + (x1 - x0) * t
        half = abs(x1 - x0) / count * .42
        a = (c - half, y, 0) if along == 'x' else (0, y, c - half)
        b = (c + half, y, 0) if along == 'x' else (0, y, c + half)
        rod(f'{prefix} cap {i}', a, b, r, 'roof:light', coll, sides=4)


# ---------------------------------------------------------------- roof_gable_a
# The steep one, with the eaves clipped tight to the wall. A 46 degree pitch is what a
# pantile needs to shed water and it is what the reference's tallest houses have; on a
# unit footprint that is a ridge at 0.52, and buildings.js widens the whole thing by the
# overhang when it scales it to the wall.
gable_a = asset('roof_gable_a')
roof('roof_gable_a tiles', (0, 0, 0), 1.0, 1.0, .52, 'roof:terracotta', gable_a)
rod('roof_gable_a ridge roll', (-.5, .525, 0), (.5, .525, 0), .042, 'roof:light', gable_a, sides=6)
ridge_course('roof_gable_a ridge', gable_a, -.46, .46, .535, .05, 7)
for z in [-.475, .475]:
    box('roof_gable_a eave board', (0, .027, z), (1.0, .05, .05), 'plank:dark', gable_a)
    # The bottom course sits proud of the ones above it, which is what puts a shadow line
    # along the eaves and stops the pitch reading as a flat triangle.
    rod('roof_gable_a starter course', (-.5, .064, z * .94), (.5, .064, z * .94), .032, 'roof:light', gable_a, sides=4)
# The barge board stops a hair short of the eaves corner rather than on it. A rod is a
# prism and its end cap is square to its own axis, so one begun exactly at 0.5 puts a
# corner 0.021 outside the unit square - and tests/models.test.mjs is right to refuse it:
# buildings.js scales this by the width of a wall and believes the answer is the overhang.
for x in [-.47, .47]:
    for s in [-1, 1]:
        rod('roof_gable_a verge', (x, .03, s * .478), (x, .53, 0), .03, 'plankZ:dark', gable_a, sides=4)

# ---------------------------------------------------------------- roof_gable_b
# The shallow one, with deep eaves and the purlins left showing through the gable. Same
# footprint, same origin, two thirds of the pitch: side by side down a street the pair
# read as houses built a generation apart, which is the whole reason for having two.
gable_b = asset('roof_gable_b')
roof('roof_gable_b tiles', (0, 0, 0), 1.0, 1.0, .34, 'roof:terracotta', gable_b)
rod('roof_gable_b ridge roll', (-.5, .345, 0), (.5, .345, 0), .05, 'roof:light', gable_b, sides=6)
ridge_course('roof_gable_b ridge', gable_b, -.44, .44, .36, .058, 5)
for z in [-.465, .465]:
    box('roof_gable_b eave board', (0, .04, z), (1.0, .075, .06), 'plank:dark', gable_b)
    rod('roof_gable_b starter course', (-.5, .088, z * .93), (.5, .088, z * .93), .036, 'roof:light', gable_b, sides=4)
for x in [-.46, .46]:
    for s in [-1, 1]:
        rod('roof_gable_b verge', (x, .04, s * .478), (x, .35, 0), .034, 'plankZ:dark', gable_b, sides=4)
    for y, d in [(.10, .40), (.20, .22)]:
        box('roof_gable_b purlin end', (x, y, 0), (.075, .05, d), 'plank:dark', gable_b)

# ---------------------------------------------------------------- roof_hip_a
# A hip: the gable ends sloped back instead of walled up, so the roof has no flat face
# anywhere and the house underneath looks squarer and richer. The reference's manor-ish
# houses have them, and buildings.js gives one to a quarter of its houses.
hip = asset('roof_hip_a')
roof('roof_hip_a tiles', (0, 0, 0), 1.0, 1.0, .44, 'roof:terracotta', hip, ridge=.42)
rod('roof_hip_a ridge roll', (-.21, .445, 0), (.21, .445, 0), .042, 'roof:light', hip, sides=6)
ridge_course('roof_hip_a ridge', hip, -.19, .19, .455, .05, 3)
# One roll down each of the four hips, the way the ridge has one along it. These are what
# make a hip read as a hip rather than as a lump.
for sx in [-1, 1]:
    for sz in [-1, 1]:
        rod('roof_hip_a hip roll', (sx * .47, .03, sz * .47), (sx * .21, .44, 0), .032, 'roof:light', hip, sides=4)
for z in [-.475, .475]:
    box('roof_hip_a eave board', (0, .027, z), (1.0, .05, .05), 'plank:dark', hip)
    rod('roof_hip_a starter course', (-.47, .064, z * .94), (.47, .064, z * .94), .032, 'roof:light', hip, sides=4)
for x in [-.475, .475]:
    box('roof_hip_a eave return', (x, .027, 0), (.05, .05, .95), 'plankZ:dark', hip)
    rod('roof_hip_a starter return', (x * .94, .064, -.47), (x * .94, .064, .47), .032, 'roof:light', hip, sides=4)

# ---------------------------------------------------------------- roof_cone_a
# The cap for anything round - the haiku houses, and the turret below borrows the shape at
# a third the size. Ten facets: at a radius of half a cell it is round from every distance
# the island is looked at from, and twelve would be two triangles nobody sees.
cone = asset('roof_cone_a')
rod('roof_cone_a tiles', (0, 0, 0), (0, .5, 0), .5, 'roof:terracotta', cone, top=0, sides=10)
rod('roof_cone_a eave ring', (0, 0, 0), (0, .05, 0), .5, 'plank:dark', cone, sides=10)
for i in range(5):
    a = (i / 5) * math.pi * 2
    rod('roof_cone_a hip roll', (math.cos(a) * .47, .04, math.sin(a) * .47), (0, .49, 0), .026, 'roof:light', cone, sides=4)
upright('roof_cone_a finial', (0, .48, 0), .022, .15, 'plain:copper', cone, sides=6)
rod('roof_cone_a finial tip', (0, .61, 0), (0, .70, 0), .05, 'plain:copper', cone, top=0, sides=6)

# ---------------------------------------------------------------- addon_dormer_a
# A dormer, at true size rather than on a unit square: it is a window, and a window is
# the same window on a hut and on a keep. Its ridge runs along z, across the house's own,
# and the pane is the one thing in this set that glows after dark.
dormer = asset('addon_dormer_a')
box('addon_dormer_a cheeks', (0, .15, 0), (.30, .30, .34), 'wall:cream', dormer)
roof('addon_dormer_a tiles', (0, .30, .01), .38, .40, .15, 'roof:terracotta', dormer, turn=math.pi / 2)
rod('addon_dormer_a ridge roll', (0, .455, -.19), (0, .455, .19), .028, 'roof:light', dormer, sides=4)
box('addon_dormer_a frame', (0, .15, .175), (.24, .20, .03), 'plank:dark', dormer)
box('addon_dormer_a pane', (0, .155, .187), (.19, .15, .012), 'plain:glass', dormer)
box('addon_dormer_a mullion', (0, .155, .194), (.016, .16, .014), 'plank:dark', dormer)
box('addon_dormer_a sill', (0, .045, .185), (.28, .035, .06), 'plank:oak', dormer)
for s in [-1, 1]:
    rod('addon_dormer_a verge', (s * .19, .305, .195), (0, .455, .195), .026, 'plank:dark', dormer, sides=4)

# ---------------------------------------------------------------- addon_turret_a
# The corner turret, which in the reference is what a house gets instead of a second
# storey: an octagonal shaft, a stone corbel where it meets the wall, a cone cap and a
# pole with a pennant on it. `anchor.flag` is that pennant - main.js draws the cloth
# itself, instanced, so it can blow in the same wind as every other flag on the island.
turret = asset('addon_turret_a')
upright('addon_turret_a shaft', (0, 0, 0), .16, .86, 'wall:cream', turret, sides=8)
upright('addon_turret_a corbel', (0, .80, 0), .185, .045, 'stone:foundation', turret, sides=6)
rod('addon_turret_a cap', (0, .845, 0), (0, 1.125, 0), .21, 'roof:terracotta', turret, top=0, sides=8)
for i in range(4):
    a = (i / 4) * math.pi * 2 + math.pi / 8
    rod('addon_turret_a hip roll', (math.cos(a) * .20, .86, math.sin(a) * .20), (0, 1.12, 0), .02, 'roof:light', turret, sides=4)
box('addon_turret_a pane', (0, .52, .157), (.09, .12, .02), 'plain:glass', turret)
upright('addon_turret_a pole', (0, 1.10, 0), .012, .24, 'plain:iron', turret, sides=4)
empty('flag', (0, 1.30, 0), turret)

# ---------------------------------------------------------------- addon_chimney_a
# Every house on the island gets one of these from its first hut upward, and the reason is
# `anchor.smoke`: main.js already knows how often a settler's chimney should puff and how
# far away to stop bothering, and until now it had nowhere on a house to puff from. The
# courses are the tavern's chimney - three bands of pale stone up a brick stack - because
# a chimney is the one thing on the roof you see on every building at once.
chimney = asset('addon_chimney_a')
box('addon_chimney_a stack', (0, .26, 0), (.15, .52, .15), 'stone:brick', chimney)
for y in [.18, .30, .42]:
    box('addon_chimney_a course', (0, y, 0), (.168, .026, .168), 'stone:foundation', chimney)
box('addon_chimney_a crown', (0, .545, 0), (.194, .05, .194), 'stone:foundation', chimney)
upright('addon_chimney_a pot', (0, .57, 0), .045, .13, 'stone:brick', chimney, sides=6)
box('addon_chimney_a flue', (0, .704, 0), (.062, .008, .062), 'plain:iron', chimney)
empty('smoke', (0, .72, 0), chimney)

# ---------------------------------------------------------------- civic_fountain
# The centrepiece of the square: a broad stone basin, a carved pedestal and two tiers of
# water. Its old procedural version had the right outline, but the repeated collars,
# petal bowl, copper finial and arcing jets give it the silhouette of a civic monument.
fountain = asset('civic_fountain')

def fountain_profile(name, profile, sides=24):
    """Closed radial section: outer wall, coping and inner wall, with an open centre."""
    verts = [xyz((r * math.cos(i * math.tau / sides), y,
                  r * math.sin(i * math.tau / sides)))
             for r, y in profile for i in range(sides)]
    faces = []
    for j in range(len(profile)):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            c = ((j + 1) % len(profile)) * sides + (i + 1) % sides
            d = ((j + 1) % len(profile)) * sides + i
            faces.append((a, d, c, b))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    return adopt(o, name, 'stone:aged', fountain)

# A sixteen-sided step under a rounder basin keeps the footprint compatible with the
# flower bed that occupies this exact spot before the village earns its fountain.
upright('civic_fountain foundation', (0, 0, 0), .55, .08,
        'stone:foundation', fountain, top=.52, sides=16)
fountain_profile('civic_fountain basin wall',
                 [(.49, .08), (.515, .30), (.515, .35), (.435, .35), (.405, .12)])
upright('civic_fountain basin foot', (0, .08, 0), .515, .055,
        'stone:foundation', fountain, top=.50, sides=24)
upright('civic_fountain basin water', (0, .305, 0), .435, .025,
        'plain:water', fountain, sides=24)

# Eight shallow ribs make the basin feel assembled and carved without spending geometry
# on lettering that could never be read at the island's scale.
for i in range(8):
    a = (i / 8) * math.pi * 2
    x, z = math.cos(a) * .492, math.sin(a) * .492
    rod('civic_fountain basin rib', (x * .96, .105, z * .96), (x, .275, z),
        .023, 'stone:foundation', fountain, sides=4)

# The pedestal grows out of the water as a square plinth under a tapered, twelve-sided
# column. Three proud collars catch highlights and keep it from reading as one cylinder.
box('civic_fountain pedestal plinth', (0, .39, 0), (.30, .18, .30),
    'stone:foundation', fountain)
upright('civic_fountain pedestal foot', (0, .46, 0), .17, .07,
        'stone:aged', fountain, top=.15, sides=12)
upright('civic_fountain pedestal', (0, .51, 0), .125, .34,
        'stone:aged', fountain, top=.095, sides=12)
for y, r in [(.51, .15), (.67, .12), (.82, .14)]:
    upright('civic_fountain pedestal collar', (0, y, 0), r, .045,
            'stone:foundation', fountain, sides=12)

# A flared upper bowl with a thin sheet of water. Eight small lobes below its edge give
# the otherwise low-poly circle a flower-like profile from the town square.
fountain_profile('civic_fountain upper bowl',
                 [(.10, .82), (.235, .91), (.235, .97), (.195, .97), (.09, .85)], 16)
upright('civic_fountain upper water', (0, .932, 0), .195, .018,
        'plain:water', fountain, sides=16)
# Four continuous streams arc from the upper bowl into the lower basin.
for i in range(4):
    a = (i / 4) * math.pi * 2
    d = Vector((math.cos(a), 0, math.sin(a)))
    # A continuous tapered tube following a gravity-shaped arc, with shared rings.
    verts, faces = [], []
    for j in range(9):
        t = j / 8
        radius = .19 + .215 * t
        y = .965 + .10 * t - .735 * t * t
        centre = Vector((d.x * radius, y, d.z * radius))
        tangent = Vector((d.x * .215, .10 - 1.47 * t, d.z * .215)).normalized()
        side = Vector((-d.z, 0, d.x))
        normal = tangent.cross(side).normalized()
        for k in range(5):
            angle = k * math.tau / 5
            v = centre + (.009 - .003 * t) * (side * math.cos(angle) + normal * math.sin(angle))
            verts.append(xyz(v))
    for j in range(8):
        for k in range(5):
            faces.append((j*5+k, j*5+(k+1)%5, (j+1)*5+(k+1)%5, (j+1)*5+k))
    mesh = bpy.data.meshes.new('stream')
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new('civic_fountain water jet', mesh)
    bpy.context.scene.collection.objects.link(o)
    adopt(o, 'civic_fountain water jet', 'plain:water', fountain)

# A smaller crown repeats the lower pedestal and ends in a warm copper seed-shaped
# finial, tying the monument back to the agricultural village around it.
upright('civic_fountain crown stem', (0, .95, 0), .045, .07,
        'stone:aged', fountain, top=.045, sides=10)
upright('civic_fountain crown collar', (0, 1.01, 0), .055, .025,
        'stone:foundation', fountain, top=.045, sides=10)
upright('civic_fountain finial', (0, 1.035, 0), .045, .06,
        'plain:copper', fountain, top=0, sides=10)

# ---------------------------------------------------------------- civic_seed_stall
# A proper little shop rather than three miniature trestles. The broad silhouette and
# striped canvas make it legible from the square; the drawers, open seed bins, sacks and
# hanging sign explain what it sells when the player walks close enough to trade.
stall = asset('civic_seed_stall')

# Stone shoes keep the four oak posts out of wet ground. The rear posts rise to the
# canopy; the front pair also frame the counter so the stall still reads from behind.
for x in [-.72, .72]:
    for z in [-.31, .31]:
        box('civic_seed_stall footing', (x, .025, z), (.13, .05, .13), 'stone:foundation', stall)
        upright('civic_seed_stall post', (x, .05, z), .038, 1.18, 'plank:dark', stall, sides=4)

# A deep counter and a boarded shopfront, with an open lower shelf visible at the sides.
box('civic_seed_stall counter', (0, .55, .18), (1.52, .08, .42), 'plank:oak', stall)
box('civic_seed_stall front', (0, .29, .345), (1.46, .48, .055), 'plankZ:dark', stall)
box('civic_seed_stall lower shelf', (0, .16, -.04), (1.28, .055, .48), 'plank:oak', stall)
for x in [-.61, .61]:
    rod('civic_seed_stall side brace', (x, .08, -.27), (x, .50, .27), .025,
        'plank:dark', stall, sides=4)

# Six seed drawers face the customer. Tiny iron pulls break up the large timber panel.
for row in range(2):
    for col in range(3):
        x = -.43 + col * .43
        y = .19 + row * .20
        box('civic_seed_stall drawer', (x, y, .379), (.36, .15, .022), 'plank:oak', stall)
        box('civic_seed_stall drawer pull', (x, y, .397), (.085, .025, .014), 'plain:iron', stall)

# Five alternating strips form one pitched canvas roof. Modelling the stripes as separate
# roof panels keeps the island's flat, textureless colour language and gives the eaves a
# crisp rhythm from every viewing angle.
for i in range(5):
    x = -.68 + i * .34
    cloth = 'plain:canvas-green' if i % 2 == 0 else 'plain:canvas-cream'
    roof('civic_seed_stall awning', (x, 1.20, 0), .34, .82, .17, cloth, stall)
for x in [-.82, .82]:
    box('civic_seed_stall canopy rail', (x, 1.205, 0), (.045, .06, .88), 'plankZ:dark', stall)

# A scalloped front valance carries the stripe pattern down over the roof edge.
for i in range(10):
    x = -.765 + i * .17
    cloth = 'plain:canvas-green' if (i // 2) % 2 == 0 else 'plain:canvas-cream'
    box('civic_seed_stall valance', (x, 1.145, .42), (.155, .12, .025), cloth, stall)
    upright('civic_seed_stall valance drop', (x, 1.06, .42), .042, .085, cloth, stall, top=0, sides=6)

# The hanging board is deliberately oversized: it is the readable emblem of the shop,
# with three simple seed marks rather than illegible miniature lettering.
for x in [-.23, .23]:
    rod('civic_seed_stall sign chain', (x, 1.19, .43), (x, 1.04, .47), .009,
        'plain:iron', stall, sides=4)
box('civic_seed_stall sign', (0, .93, .48), (.62, .25, .035), 'plain:chalk', stall)
for x, mat in [(-.18, 'plain:seed-gold'), (0, 'plain:seed-green'), (.18, 'plain:seed-rust')]:
    upright('civic_seed_stall sign seed', (x, .895, .503), .045, .085, mat, stall,
            top=.018, sides=6)

# Open counter bins: three crops, each with a small heap of angular seeds. The bins are
# low enough not to hide their contents from the slightly elevated game camera.
seed_mats = ['plain:seed-gold', 'plain:seed-green', 'plain:seed-rust']
for b, mat in enumerate(seed_mats):
    x = -.44 + b * .44
    box('civic_seed_stall seed bin base', (x, .615, .13), (.34, .045, .27), 'plank:oak', stall)
    for dx in [-.15, .15]:
        box('civic_seed_stall seed bin side', (x + dx, .68, .13), (.025, .13, .28), 'plank:dark', stall)
    for dz in [.01, .25]:
        box('civic_seed_stall seed bin end', (x, .68, dz), (.32, .13, .025), 'plank:dark', stall)
    for n in range(5):
        sx = x + (n % 3 - 1) * .075
        sz = .10 + (n // 3) * .075 + (n % 2) * .02
        upright('civic_seed_stall seed', (sx, .66, sz), .027, .045 + .01 * (n % 2),
                mat, stall, top=.012, sides=5)

# Stock under the counter: tapered sacks with tied necks and a pair of small crates.
for x, z, h in [(-.46, -.08, .30), (.45, -.06, .26), (.18, -.14, .22)]:
    upright('civic_seed_stall sack', (x, .17, z), .105, h, 'plain:sack', stall,
            top=.075, sides=8)
    upright('civic_seed_stall sack neck', (x, .17 + h, z), .045, .06,
            'plain:sack', stall, top=.025, sides=6)
    box('civic_seed_stall sack tie', (x, .20 + h, z), (.10, .018, .045), 'plain:iron', stall)
for x in [-.63, .63]:
    box('civic_seed_stall crate', (x, .14, -.25), (.26, .23, .25), 'plank:oak', stall)
    for y in [.065, .145, .225]:
        box('civic_seed_stall crate slat', (x, y, -.382), (.29, .035, .025), 'plank:dark', stall)

# ---------------------------------------------------------------- civic_watertower
# The one whole building in the set, and the one the reference has that the island has no
# way of drawing: a plank tank on four splayed legs, braced both ways, with a ladder up
# the front and a hanging board under the deck. It is a civic type rather than a prop
# because it stands on a plot of its own and the village unlocks it.
#
# The legs batter inward as they rise - 0.46 out at the ground, 0.30 at the deck - which
# is the whole reason a structure this thin does not look like it would blow over. Every
# brace and rail has to follow that taper, so `leg()` answers where a leg is at a height
# instead of the numbers being written out four times and drifting.
tower = asset('civic_watertower')
LEG_FOOT, LEG_HEAD, DECK = .46, .30, 1.56


def leg(y):
    return LEG_FOOT + (LEG_HEAD - LEG_FOOT) * min(1.0, y / DECK)


for sx in [-1, 1]:
    for sz in [-1, 1]:
        # A pad under each leg, and the leg starting on top of it. Not only because a
        # timber post standing in wet grass rots: a battered leg is a tilted prism and its
        # end cap is tilted with it, so a leg begun at y = 0 dips six millimetres into the
        # lawn - past the 0.002 that scripts/model-rules.mjs calls standing on the ground,
        # and it is right to refuse it. The pad is flat, so the tower stands on the pads.
        box('civic_watertower footing', (sx * LEG_FOOT, .05, sz * LEG_FOOT), (.17, .10, .17), 'stone:foundation', tower)
        rod('civic_watertower leg', (sx * LEG_FOOT, .04, sz * LEG_FOOT),
            (sx * LEG_HEAD, DECK, sz * LEG_HEAD), .042, 'plank:dark', tower, sides=4)
# Two storeys of bracing. Each face gets a rail across it and a full X below that rail,
# which is the timber-framing of the reference's water tower and is also, at four sides
# and two levels, the cheapest way to make a silhouette this open read as engineered.
for y0, y1 in [(.04, .54), (.54, 1.08)]:
    for side in range(4):
        turn = side * math.pi / 2
        c, s = math.cos(turn), math.sin(turn)

        def at(out, across, y):
            """A point on one face: `out` along the face normal, `across` along the face."""
            return (out * c - across * s, y, out * s + across * c)

        rod('civic_watertower rail', at(leg(y1), -leg(y1), y1), at(leg(y1), leg(y1), y1),
            .026, 'plank:dark', tower, sides=4)
        for d in [1, -1]:
            rod('civic_watertower brace', at(leg(y0), -d * leg(y0), y0), at(leg(y1), d * leg(y1), y1),
                .022, 'plank:dark', tower, sides=4)
for z in [-.28, 0, .28]:
    box('civic_watertower joist', (0, 1.545, z), (.92, .05, .07), 'plank:dark', tower)
box('civic_watertower deck', (0, 1.595, 0), (.86, .05, .86), 'plank:oak', tower)
upright('civic_watertower tank', (0, 1.62, 0), .38, .86, 'plank:oak', tower, sides=12)
for y in [1.78, 2.30]:
    upright('civic_watertower hoop', (0, y, 0), .395, .04, 'plain:iron', tower, sides=12)
rod('civic_watertower roof', (0, 2.48, 0), (0, 2.80, 0), .44, 'roof:shingle', tower, top=0, sides=12)
for i in range(6):
    a = (i / 6) * math.pi * 2
    rod('civic_watertower roof hip', (math.cos(a) * .42, 2.49, math.sin(a) * .42), (0, 2.79, 0),
        .022, 'plank:dark', tower, sides=4)
upright('civic_watertower finial', (0, 2.78, 0), .022, .16, 'plain:copper', tower, sides=6)
rod('civic_watertower finial tip', (0, 2.92, 0), (0, 3.02, 0), .055, 'plain:copper', tower, top=0, sides=6)
# The ladder leans with the legs rather than standing off them, so it is part of the frame
# and not a thing propped against it. Front face, which is +z, beside the door path.
for x in [-.19, -.03]:
    rod('civic_watertower stile', (x, .02, .50), (x, 1.58, .34), .022, 'plank:oak', tower, sides=4)
for i in range(8):
    t = (i + .5) / 8
    box('civic_watertower rung', (-.11, .02 + 1.56 * t, .50 - .16 * t), (.22, .022, .03), 'plank:oak', tower)
# A downpipe off the tank and a tap a settler could fill a bucket at: the thing the tower
# is for, on the side away from the ladder.
rod('civic_watertower downpipe', (.24, 1.60, .30), (.30, .34, .40), .022, 'plain:iron', tower, sides=4)
rod('civic_watertower tap', (.30, .32, .40), (.30, .32, .52), .016, 'plain:iron', tower, sides=4)
box('civic_watertower sign bracket', (.28, 1.60, .56), (.04, .05, .30), 'plank:dark', tower)
for x in [.15, .41]:
    rod('civic_watertower sign chain', (x, 1.50, .66), (x, 1.575, .66), .009, 'plain:iron', tower, sides=4)
box('civic_watertower sign board', (.28, 1.37, .66), (.34, .26, .035), 'plank:oak', tower)
empty('sign', (.28, 1.37, .685), tower)

# The tallest thing in the set, which is the water tower's copper tip. Buildings read this;
# a roof composed onto one measures itself.
bpy.context.scene['building_height'] = 3.02

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything above is stacked on the origin - see the note at the top - so
# the view is aimed at the water tower, which is the only thing in here big enough to fill
# a frame. Solo a collection in the outliner to look at one of the others, or read the
# per-asset PNGs that scripts/preview-model.py writes.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -.001))
floor = bpy.context.object
floor.name = 'Studio floor'
studio = bpy.data.materials.new('Studio')
studio.diffuse_color = (.21, .25, .20, 1)
floor.data.materials.append(studio)


def aim(o, p):
    o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.camera_add(location=(3.2, -4.0, 2.6))
cam = bpy.context.object
aim(cam, (0, 0, 1.3))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 3.6
bpy.context.scene.camera = cam
for loc, power, size in [((-3, -4, 5), 420, 4), ((4, -1, 3), 180, 3), ((0, 3, 4), 300, 3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, 1.0))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-village.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'village'})
