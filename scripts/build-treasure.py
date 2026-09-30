"""The treasure set: the one golden statue, its carried copy, the digger's shovel, the
pirate's sea chest and the heap of dug sand. Run with:

    node scripts/blender.mjs --background --python scripts/build-treasure.py

It writes assets/treasure/promptholm-treasure.blend and bakes it to web/js/treasure-mesh.js.
Running it again replaces both, so edits made by hand in the .blend are lost - export those
with `npm run models -- treasure` instead. Pick one of the two routes and say which.

Five assets, each in a collection named after it, every part named after that collection
(a part name is unique across every set the register in web/js/models.js holds):

    civic_treasure        the statue on the town's square: a cast-gold pirate captain
                          heaving an open treasure chest over his head, on a dark marble
                          plinth with gold lines and a plaque. One cell across (the
                          plinth is 0.74), about 1.94 tall, front +Z. It is the founder's
                          statue's sibling (scripts/build-statue.py): built the same way,
                          in gold on the plain sheet where that one is bronze.
    prop_treasure_carry   just the chest and its hoard, in ~110 triangles and 0.21 tall,
                          for the arms of whoever carries it and for the deck of a boat.
    prop_shovel           the digger's spade, blade down in the ground, 0.225 long
                          (0.9 m at 4 m to the unit - the same scale as the miner's pick,
                          whose handle is 0.24 in web/js/classic-avatar.js).
    prop_treasure_mound   the sand heaped beside a hole while somebody digs.
    civic_pirate          the pirate's sea chest behind the tavern, with a short mast and a
                          small black flag with a skull and bones on both faces. Kept low
                          on purpose (0.72 to the top of the mast): it is a corner you
                          find, not a signboard - see "the pirate's sea chest" in lib/layout.mjs.

Budgets: civic_ 1500, prop_ 120 (scripts/model-rules.mjs). The statue is the only shape here
that can afford real facets; the carried copy spends its 120 on what still reads from a
deck - chest, straps, lid, hoard, a coin and two gems - and has no figure and no plinth.

WHERE THE COUNTER GOES. The statue is asked to show how many treasures have been found.
`civic_treasure treasure_plaque_face` is the flat panel for it: a plain quad-box on the
front (+Z) of the plinth's shaft, 0.28 wide and 0.20 tall, its face at z = 0.246, centre at
y = 0.41, in a gold frame (unchanged since the first statue). `anchor.sign` sits at the middle of that face, which is the point
main.js hangs a sign on (createNameplate) - so the plaque reads as an ordinary sign anchor and
nothing new has to be invented for it.

HELD SHOVEL. prop_shovel stands blade-down with its tip on y = 0, because that is what a
prop has to do (scripts/model-rules.mjs wants the box on the ground). Held items in
classic-avatar.js point +y out of the fist with the head at the top (the pick's head is at
+0.155): to use this one as HELD_ITEM_PROCEDURAL geometry, turn it upside down (blade at
+y) and move the grip - the shaft at 0.12 up from the tip - to the origin. Blade 0.056
wide, shaft 0.016 square, D-grip 0.05 across at the top.
"""
import bpy
import bmesh
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/treasure'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Gold is three slots so the statue glitters without a texture: the body, the edges and
# coins that catch the light, and the shaded inside of the chest. The stone is the town's
# own foundation stone (0x8d8577 in buildings.js C.foundation) so the plinth belongs on the
# square. sand is a beach's, flag is nearly black so the bone-white skull reads on it.
COLORS = {
    'plain:treasure-gold': 0xe2a919, 'plain:treasure-gold-hi': 0xffdf70,
    'plain:treasure-gold-dark': 0xa87410, 'plain:ruby': 0xc8323c,
    'plain:sapphire': 0x2f5fc8, 'plain:emerald': 0x2f9a58,
    'stone:marble': 0x74847a, 'stone:marble-vein': 0xf2eee4,
    'plain:iron': 0x343638, 'plank:oak': 0x845335, 'plank:dark': 0x503728,
    'plain:flag': 0x1c1d22, 'plain:bone': 0xece4d2, 'plain:sand': 0xd9c48a,
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
    shader.inputs['Roughness'].default_value = .4 if 'gold' in name else .86
    m['emissive'] = 0.0
    materials[name] = m

GOLD, HI, DARK = 'plain:treasure-gold', 'plain:treasure-gold-hi', 'plain:treasure-gold-dark'
MARBLE, VEIN, IRON, RUBY = 'stone:marble', 'stone:marble-vein', 'plain:iron', 'plain:ruby'
SAPPHIRE, EMERALD = 'plain:sapphire', 'plain:emerald'
OAK, TIMBER, FLAG, BONE, SAND = 'plank:oak', 'plank:dark', 'plain:flag', 'plain:bone', 'plain:sand'


def xyz(p):
    return (p[0], -p[2], p[1])


def asset(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


_named = {}


def finish(name, mat, coll, obj=None):
    """Name it, give it its material and file it. A part name that repeats within an asset
    is numbered here rather than left to Blender, which would call the second `x.001`."""
    obj = obj or bpy.context.object
    count = _named.get(name, 0) + 1
    _named[name] = count
    obj.name = name if count == 1 else f'{name} {count}'
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def bevelled(obj, width):
    m = obj.modifiers.new('Worn edges', 'BEVEL')
    m.width = width
    m.segments = 1
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)


def box(name, p, size, mat, coll, bevel=0):
    """A box centred on p, sized (w, h, d) in island axes."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = finish(name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        bevelled(o, bevel)
    return o


def rod(name, a, b, r, mat, coll, top=None, sides=8):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top,
                                    depth=(b - a).length, location=(a + b) / 2)
    o = finish(name, mat, coll)
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return o


def upright(name, p, r, h, mat, coll, top=None, sides=8):
    """rod() standing on p, h tall: its flat base is on p, which is what the ground rule measures."""
    return rod(name, p, (p[0], p[1] + h, p[2]), r, mat, coll, top=top, sides=sides)


def ellipsoid(name, p, size, mat, coll):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=xyz(p))
    o = finish(name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def uvsphere(name, p, size, mat, coll, seg=12, rings=6):
    """A rounded form with a pole up: segments x rings, scaled to (w, h, d) in island axes."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=xyz(p))
    o = finish(name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def solid(name, verts, faces, mat, coll):
    """A closed mesh given corner by corner (island coordinates); normals are worked out
    outward afterwards, so the winding of `faces` does not have to be right."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    finish(name, mat, coll, obj=o)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return o


def unit(v):
    v = Vector(v)
    return v / v.length


def beam(name, a, b, wdir, w0, w1, t0, t1, mat, coll):
    """A tapering rectangular bar from a to b. It is `w` wide along wdir and `t` thick along
    the direction that is at right angles to both that and the bar's own; sizes at a and b.
    A blade is a beam with wdir in the plane it is seen in and the depth for thickness;
    an open lid is a beam with wdir along x, so that its thickness comes out at right
    angles to it in the y-z plane."""
    a, b = Vector(a), Vector(b)
    w = unit(wdir)
    t = unit((b - a).cross(w))
    verts = []
    for end, (p, ww, tt) in enumerate([(a, w0, t0), (b, w1, t1)]):
        for sw in (-1, 1):
            for st in (-1, 1):
                verts.append(tuple(p + w * (sw * ww / 2) + t * (st * tt / 2)))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return solid(name, verts, faces, mat, coll)


def plate(name, outline, thick, z, mat, coll):
    """A flat cut-out, `outline` corner by corner in (x, y), `thick` deep centred on z."""
    n = len(outline)
    verts = [(x, y, z - thick / 2) for x, y in outline] + [(x, y, z + thick / 2) for x, y in outline]
    faces = [tuple(range(n)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return solid(name, verts, faces, mat, coll)


# ================================================================ civic_treasure
# The statue after the picture Martijn drew it from: a cast-gold pirate captain, boots apart,
# heaving an open sea chest over his head with both hands. Standing on a dark marble plinth
# with gold lines and a plaque on the front. Budget 1500, spent roughly 900 on the figure, 300
# on the chest and its hoard and 200 on the plinth; height 1.94, the plinth 0.74 across.
#
# The figure is built the way build-statue.py builds the founder: rods for limbs, a lofted
# coat, ellipsoids for joints, flat facets everywhere. Two things differ. The coat is lofted on
# elliptic rings because a pirate's coat is fuller than a founder's, and it is dressed with
# separate panels (tails, lapels, shirt) instead of being one shell.
statue = asset('civic_treasure')
P = 'civic_treasure '
FLOOR = .72                       # the top of the plinth: where the boots stand


def vein(name, a, b, normal, coll):
    """A pale vein across a face: `normal` is the face's outward direction, the strip
    stands a hair proud of it."""
    a, b = Vector(a), Vector(b)
    wdir = unit((b - a).cross(Vector(normal)))
    beam(name, a, b, wdir, .022, .008, .005, .005, VEIN, coll)


# --- the plinth: dark marble, gold lines, the plaque. Same footprint and same plaque as the
# first statue, so nothing that hangs on it has moved.
box(P + 'bottom step', (0, .04, 0), (.74, .08, .74), MARBLE, statue)
box(P + 'base line', (0, .084, 0), (.70, .008, .70), GOLD, statue)
box(P + 'upper step', (0, .118, 0), (.62, .06, .62), MARBLE, statue)
box(P + 'plinth foot', (0, .175, 0), (.52, .05, .52), MARBLE, statue)
box(P + 'foot line', (0, .203, 0), (.50, .008, .50), GOLD, statue)
box(P + 'plinth shaft', (0, .41, 0), (.46, .42, .46), MARBLE, statue)
box(P + 'coping line', (0, .622, 0), (.50, .008, .50), GOLD, statue)
box(P + 'coping lower', (0, .642, 0), (.54, .036, .54), MARBLE, statue)
box(P + 'coping crown', (0, .692, 0), (.60, .056, .60), MARBLE, statue)
box(P + 'coping crown line', (0, .672, 0), (.62, .01, .62), GOLD, statue)
# The shaft's front is at z = .23: a gold frame let into it, and on the frame the plaque face,
# the flat panel a counter is drawn on. Its front is z = .246.
box(P + 'plaque frame', (0, .41, .232), (.32, .24, .012), DARK, statue)
box(P + 'treasure_plaque_face', (0, .41, .242), (.28, .20, .008), IRON, statue)
anchor = bpy.data.objects.new('anchor.sign', None)
anchor.location = xyz((0, .41, .246))
statue.objects.link(anchor)
# Veins: two on the base, one either side of the plaque, one on each side of the shaft.
vein(P + 'marble vein', (-.30, .07, .371), (-.20, .012, .371), (0, 0, 1), statue)
vein(P + 'marble vein', (.16, .012, .371), (.28, .07, .371), (0, 0, 1), statue)
vein(P + 'marble vein', (-.215, .25, .231), (-.17, .38, .231), (0, 0, 1), statue)
vein(P + 'marble vein', (.17, .46, .231), (.215, .58, .231), (0, 0, 1), statue)
vein(P + 'marble vein', (.231, .28, -.15), (.231, .55, .10), (1, 0, 0), statue)
vein(P + 'marble vein', (-.231, .55, -.15), (-.231, .30, .12), (-1, 0, 0), statue)
vein(P + 'marble vein', (-.10, .70, .301), (-.02, .665, .301), (0, 0, 1), statue)
vein(P + 'marble vein', (.06, .67, .301), (.24, .705, .301), (0, 0, 1), statue)


def band(name, y, h, rx, rz, mat, coll, sides=8, x=0, z=0):
    """A ring of `sides` facets, elliptic (rx across, rz deep), h tall from y."""
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=1, radius2=1, depth=h, location=xyz((x, y + h / 2, z)))
    o = finish(name, mat, coll)
    o.scale = (rx, rz, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def inplane(a, b):
    """The direction across a strip running a -> b as seen from the front."""
    return unit((Vector(b) - Vector(a)).cross(Vector((0, 0, 1))))


# --- the legs: boots apart, cuffs turned down at the top, trousers up into the coat.
for x, dz in [(-.09, .035), (.09, -.02)]:
    box(P + 'boot foot', (x, FLOOR + .02, dz + .035), (.09, .04, .15), DARK, statue)
    rod(P + 'boot shaft', (x, FLOOR + .03, dz), (x, FLOOR + .21, dz), .05, DARK, statue, top=.058, sides=6)
    rod(P + 'boot cuff', (x, FLOOR + .165, dz), (x, FLOOR + .215, dz), .072, HI, statue, sides=6)
    rod(P + 'trouser leg', (x, FLOOR + .21, dz), (x * .8, FLOOR + .35, 0), .064, DARK, statue, top=.07, sides=6)

# --- the coat: five bands on elliptic rings, then the dressing on top of the shell.
rings = [(.97, .165, .11), (1.04, .145, .098), (1.09, .125, .088), (1.17, .14, .092),
         (1.27, .175, .095), (1.32, .115, .075)]
verts = [(rx * math.cos(i * math.tau / 8), y, rz * math.sin(i * math.tau / 8)) for y, rx, rz in rings for i in range(8)]
faces = [tuple(range(8))]
for j in range(len(rings) - 1):
    for i in range(8):
        k = (i + 1) % 8
        faces.append((j * 8 + i, j * 8 + k, (j + 1) * 8 + k, (j + 1) * 8 + i))
faces.append(tuple(range(8 * (len(rings) - 1), 8 * len(rings))))
solid(P + 'coat', verts, faces, GOLD, statue)
for s in (-1, 1):
    # The skirts of the coat, flung out at the hip by the way he stands.
    beam(P + 'coat tail', (s * .13, 1.06, .02), (s * .235, .9, .04), (1, 0, 0), .11, .15, .016, .016, GOLD, statue)
beam(P + 'coat back', (0, 1.03, -.095), (0, .89, -.12), (1, 0, 0), .20, .27, .016, .016, GOLD, statue)
box(P + 'shirt', (0, 1.2, .09), (.06, .2, .006), DARK, statue)
band(P + 'belt', 1.075, .04, .13, .095, DARK, statue)
box(P + 'buckle', (0, 1.095, .105), (.06, .05, .014), HI, statue)
a, b = Vector((-.125, 1.30, .078)), Vector((.10, 1.11, .10))
beam(P + 'baldric', a, b, inplane(a, b), .03, .03, .012, .012, DARK, statue)
rod(P + 'neck', (0, 1.30, 0), (0, 1.39, .005), .042, GOLD, statue, sides=6)

# --- the cutlass at his hip, hilt forward.
top, tip = Vector((-.14, 1.07, .01)), Vector((-.27, .80, -.13))
d = unit(tip - top)
beam(P + 'scabbard', top, tip, inplane(top, tip), .028, .02, .02, .014, DARK, statue)
grip_end = top - d * .07
beam(P + 'sword grip', top, grip_end, inplane(top, tip), .022, .022, .022, .022, HI, statue)
beam(P + 'sword guard', grip_end + Vector((-.045, 0, 0)), grip_end + Vector((.045, 0, 0)), (0, 0, 1), .03, .03, .014, .014, HI, statue)
box(P + 'sword pommel', tuple(grip_end - d * .012), (.026, .026, .026), HI, statue)

# --- the arms: up and out from the shoulder, elbows wide, forearms drawn in under the chest,
# cuffs turned back over the wrist and the hand closed under the chest's edge.
for s in (-1, 1):
    sh, el, wr = Vector((s * .165, 1.275, 0)), Vector((s * .25, 1.42, -.005)), Vector((s * .19, 1.565, .0))
    uvsphere(P + 'shoulder', tuple(sh), (.06, .06, .06), GOLD, statue, seg=6, rings=3)
    rod(P + 'upper sleeve', tuple(sh), tuple(el), .05, GOLD, statue, top=.043, sides=6)
    uvsphere(P + 'elbow', tuple(el), (.048, .048, .048), GOLD, statue, seg=6, rings=3)
    rod(P + 'lower sleeve', tuple(el), tuple(wr), .043, GOLD, statue, top=.036, sides=6)
    dirn = unit(wr - el)
    rod(P + 'sleeve cuff', tuple(wr - dirn * .045), tuple(wr + dirn * .012), .056, HI, statue, sides=6)
    box(P + 'hand', tuple(wr + dirn * .045), (.07, .065, .065), HI, statue)

# --- the head: a domed skull, brow, nose, a full beard round an open laughing mouth, and a
# bandana knotted behind.
HY = 1.455
uvsphere(P + 'head', (0, HY, .008), (.086, .095, .088), GOLD, statue, seg=8, rings=4)
box(P + 'brow', (0, HY + .03, .088), (.12, .016, .02), DARK, statue)
for x in (-.032, .032):
    box(P + 'eye', (x, HY + .012, .085), (.018, .013, .01), IRON, statue)
box(P + 'nose', (0, HY - .012, .095), (.022, .034, .028), GOLD, statue)
box(P + 'moustache', (0, HY - .038, .088), (.09, .018, .022), DARK, statue)
# The beard starts under the nose and hangs off the jaw, so the face above it stays open.
rod(P + 'beard', (0, HY - .046, .02), (0, HY - .16, .05), .078, DARK, statue, top=.03, sides=6)
for x in (-1, 1):
    box(P + 'sideburn', (x * .082, HY - .014, .02), (.03, .085, .06), DARK, statue)
box(P + 'mouth', (0, HY - .058, .108), (.044, .022, .01), IRON, statue)
band(P + 'bandana', HY + .05, .042, .092, .094, HI, statue, z=.006)
box(P + 'bandana knot', (.04, HY + .056, -.092), (.042, .042, .038), HI, statue)
beam(P + 'bandana tail', (.04, HY + .04, -.098), (.06, HY - .06, -.115), (1, 0, 0), .034, .044, .012, .012, HI, statue)
beam(P + 'bandana tail', (.02, HY + .04, -.10), (-.005, HY - .05, -.12), (1, 0, 0), .034, .04, .012, .012, HI, statue)

# --- the chest, held overhead: a gold sea chest with the lid thrown back and treasure
# heaped so high it spills. It rests on the two hands (1.60) at 1.62 to 1.71; the lid hinges
# on the back edge and swings 110 degrees, and its top is the statue's highest point.
CY, CD = 1.68, .27
box(P + 'chest body', (0, CY, 0), (.44, .10, CD), GOLD, statue)
for x in (-.13, .13):
    box(P + 'chest strap', (x, CY, 0), (.046, .102, CD + .002), HI, statue)
box(P + 'chest lock', (0, CY + .015, CD / 2 + .004), (.06, .06, .012), HI, statue)
hinge = Vector((0, CY + .05, -CD / 2))
lift = (math.sin(math.radians(110)), math.cos(math.radians(110)))
tip = hinge + Vector((0, .21 * lift[0], .21 * lift[1]))
beam(P + 'chest lid', hinge, tip, (1, 0, 0), .44, .44, .034, .034, GOLD, statue)
n = Vector((0, -lift[1], lift[0])) * 0.022      # the lid's inner side, towards the chest
beam(P + 'lid lining', hinge + n, tip + n, (1, 0, 0), .39, .39, .012, .012, DARK, statue)
for x in (-.13, .13):
    off = Vector((x, 0, 0)) - n
    beam(P + 'lid strap', hinge + off, tip + off, (1, 0, 0), .046, .046, .01, .01, HI, statue)
# The hoard: two layers heaped above the rim, coins standing on edge in its front slope so
# their faces catch the light, a few lying on top and one over the lip, and gems standing
# clear of it.
upright(P + 'hoard', (0, CY + .05, .0), .21, .06, GOLD, statue, top=.155, sides=8)
upright(P + 'hoard top', (0, CY + .11, .0), .155, .06, DARK, statue, top=.08, sides=8)
for x, y, z in [(-.11, CY + .13, .115), (.10, CY + .14, .105), (-.01, CY + .19, .06), (.17, CY + .11, .02)]:
    rod(P + 'coin standing', (x, y, z - .007), (x, y, z + .007), .056, HI, statue, sides=6)
for x, y, z in [(-.05, CY + .19, -.03), (.06, CY + .18, -.04)]:
    upright(P + 'coin', (x, y, z), .05, .014, HI, statue, sides=6)
upright(P + 'coin on lip', (.06, CY + .05, .14), .046, .014, HI, statue, sides=6)
for x, y, z, col in [(-.06, CY + .17, .09, RUBY), (.12, CY + .13, .09, SAPPHIRE), (-.16, CY + .12, .02, EMERALD), (.04, CY + .19, .02, RUBY)]:
    upright(P + 'gem', (x, y, z), .03, .05, col, statue, top=.01, sides=4)

# ================================================================ prop_treasure_carry
# The chest on its own, the way the statue holds it up: body, a strap, the lid thrown back,
# the hoard, a coin and two gems. 112 of the 120 triangles; no figure and no plinth.
carry = asset('prop_treasure_carry')
C = 'prop_treasure_carry '
box(C + 'chest', (0, .05, 0), (.24, .10, .16), GOLD, carry)
box(C + 'strap', (.06, .05, 0), (.03, .102, .162), HI, carry)
box(C + 'strap', (-.06, .05, 0), (.03, .102, .162), HI, carry)
hc = Vector((0, .10, -.08))
lc = hc + Vector((0, .12 * lift[0], .12 * lift[1]))
beam(C + 'lid', hc, lc, (1, 0, 0), .24, .24, .022, .022, GOLD, carry)
upright(C + 'hoard', (0, .10, .0), .105, .05, HI, carry, top=.05, sides=6)
upright(C + 'coin', (.05, .145, .05), .035, .01, GOLD, carry, sides=6)
upright(C + 'gem', (-.05, .145, .03), .02, .03, RUBY, carry, top=.006, sides=4)
upright(C + 'gem', (.03, .145, -.03), .02, .03, SAPPHIRE, carry, top=.006, sides=4)

# ================================================================ prop_shovel
# A spade standing on its tip. The blade is a cut-out plate, the shaft a four-sided prism,
# the grip a crossbar with a stub down each end (a D handle).
shovel = asset('prop_shovel')
S = 'prop_shovel '
plate(S + 'blade', [(-.028, .062), (.028, .062), (.028, .03), (0, 0), (-.028, .03)], .008, 0, IRON, shovel)
box(S + 'socket', (0, .07, 0), (.018, .02, .014), IRON, shovel)
upright(S + 'shaft', (0, .07, 0), .008, .142, OAK, shovel, sides=4)
box(S + 'grip bar', (0, .22, 0), (.05, .01, .01), OAK, shovel)
for x in (-.02, .02):
    box(S + 'grip stub', (x, .208, 0), (.01, .02, .01), OAK, shovel)

# ================================================================ prop_treasure_mound
# Dug sand: a wide foot, a shoulder on it and a lump beside, three prisms.
mound = asset('prop_treasure_mound')
M = 'prop_treasure_mound '
upright(M + 'foot', (0, 0, 0), .19, .035, SAND, mound, top=.13, sides=8)
upright(M + 'shoulder', (0, .035, 0), .13, .04, SAND, mound, top=.05, sides=8)
upright(M + 'lump', (.06, 0, .04), .09, .06, SAND, mound, top=.03, sides=8)

# ================================================================ civic_pirate
# The pirate's sea chest: dark planks, oak lid, iron straps and a gold lock, the mast at
# its back-left corner and a black flag with a skull and crossbones on both faces (a
# single-sided material would lose one side). The lock is on the front, +Z.
#
# Small on purpose: he stands behind the tavern now (Plans/schatkaarten.md, "achter de tavern"),
# somewhere you come upon rather than a landmark. The chest is the first version at S = 0.72 of its
# size, the mast 0.72 to the top (it was 1.35) and the flag a third of the cloth it was (0.20 by 0.13
# against 0.34 by 0.22), with its skull and bones drawn at E = 0.59 of theirs, which is what keeps
# them readable from a few paces but no further.
pirate = asset('civic_pirate')
R = 'civic_pirate '
S = .72
box(R + 'chest body', (0, .16 * S, 0), (.56 * S, .32 * S, .34 * S), TIMBER, pirate, .008)
box(R + 'chest lid', (0, .365 * S, 0), (.58 * S, .09 * S, .36 * S), OAK, pirate, .015)
box(R + 'chest ridge', (0, .425 * S, 0), (.50 * S, .03 * S, .28 * S), TIMBER, pirate, .006)
for x in (-.18, .18):
    box(R + 'body strap', (x * S, .162 * S, 0), (.05 * S, .324 * S, .346 * S), IRON, pirate)
    box(R + 'lid strap', (x * S, .365 * S, 0), (.05 * S, .094 * S, .366 * S), IRON, pirate)
box(R + 'lock', (0, .32 * S, .18 * S), (.07 * S, .08 * S, .014 * S), HI, pirate)
box(R + 'keyhole', (0, .315 * S, .189 * S), (.012 * S, .024 * S, .004 * S), IRON, pirate)
for x, z in [(-.16, .27), (.05, .30), (.2, .25)]:
    upright(R + 'coin', (x * S, 0, z * S), .035 * S, .01, HI, pirate, sides=6)
MX, MZ = -.24 * S, -.10 * S
MAST_TOP = .72
upright(R + 'mast', (MX, .23, MZ), .012, MAST_TOP - .23, OAK, pirate, sides=4)
upright(R + 'mast cap', (MX, MAST_TOP - .012, MZ), .018, .024, HI, pirate, top=0, sides=4)
E = .59
FW, FH, FT = .34 * E, .22 * E, .009
FX, FY = MX + .014 + FW / 2, MAST_TOP - .075
box(R + 'flag', (FX, FY, MZ), (FW, FH, FT), FLAG, pirate)
def flag_emblem(s):
    """Skull and crossbones in relief on one face of the flag (s = +1 for the +Z face, -1 for
    the back), in bone on the black cloth: crossed bones with knuckled ends underneath, and
    over them a skull plate cut to the outline of a cranium, cheeks and jaw, with hollow
    sockets, a nose pit and the gaps between the teeth in the flag's own black. The flag
    is a single-sided material, so both faces are dressed the same way. Every width is the
    full-size emblem's times E; the relief depths are not, or the sockets would vanish."""
    z0 = MZ + s * FT / 2
    ex, ey = FX + .02 * E, FY + .01 * E
    for k in (-1, 1):
        a = Vector((ex - k * .085 * E, ey - .075 * E, 0))
        b = Vector((ex + k * .085 * E, ey + .055 * E, 0))
        za = z0 + s * .002
        beam(R + 'crossbone', (a.x, a.y, za), (b.x, b.y, za), (0, 0, 1), .012 * E, .012 * E, .004, .004, BONE, pirate)
        along = unit(b - a)
        across = Vector((-along.y, along.x, 0))
        for end in (a, b):
            for side in (-1, 1):
                p = end + across * (side * .008 * E)
                box(R + 'bone knuckle', (p.x, p.y, za), (.013 * E, .013 * E, .004), BONE, pirate)
    half = [(0, .05), (.026, .045), (.041, .03), (.045, .01), (.038, -.01), (.033, -.02), (.031, -.035), (.016, -.042)]
    outline = [(ex + x * E, ey + (0.012 + y) * E) for x, y in half] + [(ex - x * E, ey + (0.012 + y) * E) for x, y in reversed(half[1:])]
    plate(R + 'skull', outline, .003, z0 + s * .0045, BONE, pirate)
    zf = z0 + s * .0065
    for x in (-1, 1):
        hexagon = [(ex + x * .017 * E + .0125 * E * math.cos(i * math.tau / 6), ey + .024 * E + .0125 * E * math.sin(i * math.tau / 6)) for i in range(6)]
        plate(R + 'skull socket', hexagon, .002, zf, FLAG, pirate)
    plate(R + 'skull nose', [(ex, ey + .01 * E), (ex - .005 * E, ey - .002 * E), (ex + .005 * E, ey - .002 * E)], .002, zf, FLAG, pirate)
    box(R + 'skull jaw line', (ex, ey - .012 * E, zf), (.062 * E, .002, .002), FLAG, pirate)
    for x in (-.012, 0, .012):
        box(R + 'skull tooth gap', (ex + x * E, ey - .02 * E, zf), (.002, .016 * E, .002), FLAG, pirate)


for s in (1, -1):
    flag_emblem(s)

bpy.context.scene['building_height'] = 1.94

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-treasure.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'treasure'})
