"""The Salty Kraken: the pirates' pub by the harbour, one crooked timber inn on a three by three.

Run: node scripts/blender.mjs --background --python scripts/build-piratetavern.py
Hand edits are lost: this script writes assets/piratetavern/promptholm-piratetavern.blend
from scratch and bakes it in the same run.

It is the tavern's size and not a hand more (Plans/piratenkroeg.md): every placement rule a
civic building passes through is written for a three by three lot, and the room is inside,
where it can be as big as it likes (web/js/pirate-tavern.js). So what makes it the pirates'
has to be the shape, read from across the harbour at the size of a thumbnail:

- **It leans.** The upper storey is turned two degrees on the ground floor and juts out over
  it on seven beam ends, and the roof sags in the middle of its ridge. A straight gable is the
  village's tavern; a crooked one is somebody who built it out of a wreck.
- **It is dark.** Tarred planks below, weathered ochre plaster between black timbers above,
  a slate roof where every other building on the island has terracotta. The one warm thing on
  it is the light in the windows and the lantern by the door, so at night it is the windows.
- **A ship came through the front wall.** Over the door the prow of a hull sticks out of the
  timbers with its bowsprit, and on the prow sits the kraken, a dome of a head with four arms
  hanging down round the lintel. Four eight-sided rods an arm and not a real tentacle: at
  this size a curl is three segments, and more segments only made the arms look knotted.
- **It flies its own flag.** A Jolly Roger on a mast off the back of the roof, baked in with
  its skull (the sea chest's `flag_emblem`, larger). There is deliberately **no
  anchor.flag**: main.js hangs the district's flag on every `anchors.flag` it finds, and a
  pirate pub in the parish's colours is the one thing this building must not look like.

The door is on the water (+Z), a harbour inn's door; the lot's middle is where you are let in
from (Plans/piratenkroeg.md, "Ingang"). Everything a settler could walk into - barrels, crate,
bollard, rope - stands to the sides of the door's approach, and web/js/buildings.js keeps the
parts APART so their walls do not close over it (tests/pirate-tavern-building.test.mjs).

Budget: a hero set, 4000 triangles. Spent where the silhouette is - the jetty, the timbers, the
prow and the flag - and nowhere on what the porch or the lanes hide: no bevels on the timbers,
no inner faces, four-sided rods for everything thinner than a finger.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/piratetavern'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

# The tavern's own colours where they are the square's (glass, iron, brass, the foundation
# stone), and the darker ones that make this the pirates' house. Linearised like every set.
COLORS = {
    'plank:tar': 0x3a2e25, 'plank:dark': 0x2a1f18, 'plank:oak': 0x6b4a2f, 'plank:hull': 0x5a3a22,
    'wall:ochre': 0xc9ab7c, 'roof:slate': 0x3a4640, 'roof:slate-ridge': 0x2b332f,
    'stone:foundation': 0x7d746a, 'stone:brick': 0x6e4436,
    'plain:iron': 0x2c2d2f, 'plain:brass': 0xc9a13b, 'plain:glass': 0xffc070,
    'plain:flag': 0x1c1d22, 'plain:bone': 0xece4d2, 'plain:rope': 0xb89a68,
    'plain:kraken': 0x6b3a6e, 'plain:kraken-dark': 0x3f2342,
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
    materials[name] = m

TAR, TIMBER, OAK, HULL = 'plank:tar', 'plank:dark', 'plank:oak', 'plank:hull'
PLASTER, SLATE, RIDGE = 'wall:ochre', 'roof:slate', 'roof:slate-ridge'
STONE, BRICK = 'stone:foundation', 'stone:brick'
IRON, BRASS, GLASS = 'plain:iron', 'plain:brass', 'plain:glass'
FLAG, BONE, ROPE, KRAKEN, KRAKEN_DARK = 'plain:flag', 'plain:bone', 'plain:rope', 'plain:kraken', 'plain:kraken-dark'

# The upper storey's twist: every part of it goes through `up()`, which turns a point about
# the building's vertical axis. Two degrees reads as crooked; four read as a mistake.
TWIST = math.radians(2)
_turn = Matrix.Rotation(TWIST, 4, 'Z')


def xyz(p):
    return (p[0], -p[2], p[1])


def link(obj, name, mat):
    obj.name = 'Salty ' + name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    return obj


def twisted(obj, on):
    """Turn a finished object about the vertical axis through the origin, if it is upstairs."""
    if on:
        bpy.context.view_layer.update()
        obj.matrix_world = _turn @ obj.matrix_world
    return obj


def box(name, p, size, mat, bevel=0, up=False, turn=0.0, tilt=0.0):
    """A box centred on p, sized (w, h, d) in island axes; `turn` about its own vertical,
    `tilt` about its own x (a slope running down towards +Z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = link(bpy.context.object, name, mat)
    o.scale = (size[0], size[2], size[1])
    o.rotation_euler = (tilt, 0, -turn)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = o.modifiers.new('Worn edges', 'BEVEL')
        m.width = bevel
        m.segments = 1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return twisted(o, up)


def rod(name, a, b, r, mat, top=None, sides=8, up=False, fill='NGON'):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top,
                                    depth=(b - a).length, location=(a + b) / 2, end_fill_type=fill)
    o = link(bpy.context.object, name, mat)
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return twisted(o, up)


def ball(name, p, size, mat, seg=8, rings=5, up=False):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=xyz(p))
    o = link(bpy.context.object, name, mat)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return twisted(o, up)


def outward(o):
    """Point every face of a hand-made mesh outward, so the winding in the lists need not be right."""
    for other in bpy.context.selected_objects:
        other.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def solid(name, verts, faces, mat, up=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    mesh.update()
    o = bpy.data.objects.new('x', mesh)
    bpy.context.collection.objects.link(o)
    link(o, name, mat)
    outward(o)
    return twisted(o, up)


def plate(name, outline, x, y, z, depth, mat, up=False):
    """A flat shape of some thickness, its outline in x and y, its front towards +Z."""
    front = [(x + a, y + b, z + depth / 2) for a, b in outline]
    back = [(x + a, y + b, z - depth / 2) for a, b in outline]
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    return solid(name, front + back, faces, mat, up)


# ---- the measurements everything below hangs off -----------------------------------------
# The tavern stands 1.36 by 1.04 on its stone foot; this is a hair wider and as deep, and the
# upper storey juts 0.06 over it on three sides. Across its roof it is 1.70, well inside the
# 1.35 either side of the middle that tests/tavern.test.mjs allows the tavern.
W, D = 1.40, 1.04
HW, FRONT = W / 2, D / 2
FOOT, JETTY, EAVE = .12, .64, 1.10
UW, UD = W + .12, D + .12                # the upper storey, over the jetty
UHW, UFRONT = UW / 2, UD / 2
RIDGE_Y, SAG = 1.70, .05

# ---- the ground floor: stone foot, tarred planks, four plaster panels --------------------
box('stone foot', (0, FOOT / 2, 0), (W + .08, FOOT, D + .04), STONE, .015)
box('tarred walls', (0, (FOOT + JETTY) / 2, 0), (W, JETTY - FOOT, D), TAR)
# Plaster panels between the corner posts on the two long faces, the only light thing low
# down: without them the ground floor was one black box under the jetty.
for x in (-.46, .46):
    for z, s in ((FRONT + .006, 1), (-FRONT - .006, -1)):
        if s > 0 and abs(x) < .3:
            continue
        box('lower plaster panel', (x, .40, z), (.30, .30, .012), PLASTER)
for x in (-HW, HW):
    for z in (-FRONT, FRONT):
        box('corner post', (x, (FOOT + JETTY) / 2, z), (.06, JETTY - FOOT, .06), TIMBER)

# The jetty: seven beam ends under the front of the upper floor and a sill it rests on.
for i in range(7):
    x = -HW + .08 + i * (W - .16) / 6
    box('jetty beam', (x, JETTY - .03, FRONT + .03), (.05, .05, .14), TIMBER)
box('jetty sill', (0, JETTY + .005, FRONT + .065), (UW + .02, .05, .05), TIMBER, up=True)

# ---- the upper storey, turned: ochre plaster and black timbers ---------------------------
box('upper storey', (0, (JETTY + EAVE) / 2, 0), (UW, EAVE - JETTY, UD), PLASTER, up=True)
for z, s in ((UFRONT + .008, 1), (-UFRONT - .008, -1)):
    for y in (JETTY + .04, EAVE - .03):
        box('timber rail', (0, y, z), (UW + .02, .05, .03), TIMBER, up=True)
    for x in (-UHW + .02, -.40, .08, UHW - .02):
        box('timber post', (x, (JETTY + EAVE) / 2, z), (.05, EAVE - JETTY, .03), TIMBER, up=True)
    # Two braces a face, the house's X; the front's right-hand bay is the oriel's.
    for x0, x1 in ((-UHW + .04, -.42), (.10, UHW - .04)):
        if s > 0 and x0 > 0:
            continue
        a, b = (x0, JETTY + .06, z), (x1, EAVE - .05, z)
        rod('timber brace', a, b, .018, TIMBER, sides=4, up=True)
for x, s in ((UHW + .008, 1), (-UHW - .008, -1)):
    for y in (JETTY + .04, EAVE - .03):
        box('side timber rail', (x, y, 0), (.03, .05, UD + .02), TIMBER, up=True)
    for z in (-.18, .18):
        box('side timber post', (x, (JETTY + EAVE) / 2, z), (.03, EAVE - JETTY, .05), TIMBER, up=True)

# ---- the roof: slate, a sagging ridge, a dormer -------------------------------------------
# Built by hand rather than as a prism, for the sag: the ridge has a middle point 0.05 lower
# than its ends, and the two slopes fold along it.
RW, RD = UW + .20, UD + .22
rw, rd, eave = RW / 2, RD / 2, EAVE
roof_v = [(-rw, eave, rd), (0, eave, rd), (rw, eave, rd),          # 0 1 2 front eave
          (-rw, eave, -rd), (0, eave, -rd), (rw, eave, -rd),       # 3 4 5 back eave
          (-rw, RIDGE_Y, 0), (0, RIDGE_Y - SAG, 0), (rw, RIDGE_Y, 0)]  # 6 7 8 ridge
# No gable faces on the slate: the gables are plaster and timber, set in under the overhang,
# or the two ends of the house were two black triangles (the first render).
roof_f = [(0, 1, 7, 6), (1, 2, 8, 7), (4, 3, 6, 7), (5, 4, 7, 8),  # the slopes
          (0, 3, 4, 1), (1, 4, 5, 2)]                              # the soffit
for s in (-1, 1):
    gx = s * (UHW + .004)
    gv = [(gx, eave, UFRONT), (gx, eave, -UFRONT), (gx, RIDGE_Y - .06, 0)]
    solid('gable infill', gv + [(gx - s * .03, y, z) for _, y, z in gv], [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], PLASTER, up=True)
    box('gable king post', (gx + s * .006, (eave + RIDGE_Y - .06) / 2, 0), (.02, RIDGE_Y - .06 - eave, .05), TIMBER, up=True)
    box('gable collar', (gx + s * .006, eave + .22, 0), (.02, .04, UD * .56), TIMBER, up=True)
solid('slate roof', roof_v, roof_f, SLATE, up=True)
for z in (-rd, rd):
    box('eave board', (0, eave - .01, z), (RW + .02, .05, .04), TIMBER, up=True)
for x in (-rw - .005, rw + .005):
    for s in (-1, 1):
        rod('gable verge', (x, eave, s * rd), (x, RIDGE_Y, 0), .022, TIMBER, sides=4, up=True)
# Twelve ridge tiles following the sag, each a four-sided rod on its own piece of the fold.
for i in range(12):
    x0, x1 = -rw + i * RW / 12, -rw + (i + 1) * RW / 12 - .015
    y0 = RIDGE_Y - SAG * (1 - abs(x0) / rw) + .012
    y1 = RIDGE_Y - SAG * (1 - abs(x1) / rw) + .012
    rod('ridge tile', (x0, y0, 0), (x1, y1, 0), .034, RIDGE, sides=4, up=True)
# The dormer on the front slope, over the door's left: cheeks, a little gable and a window.
DX, DY, DZ = -.30, 1.30, .30
box('dormer cheeks', (DX, DY, DZ), (.30, .24, .30), PLASTER, up=True)
dv = [(-.19, 0, .17), (.19, 0, .17), (.19, 0, -.17), (-.19, 0, -.17), (-.19, .15, .17), (.19, .15, .17)]
dv = [(DX + a, DY + .12 + b, DZ + c) for a, b, c in dv]
solid('dormer roof', dv + [(DX - .19, DY + .12 + .15, DZ - .17), (DX + .19, DY + .12 + .15, DZ - .17)],
      [(0, 1, 5, 4), (4, 5, 7, 6), (0, 4, 6, 3), (1, 2, 7, 5), (0, 3, 2, 1), (3, 6, 7, 2)], SLATE, up=True)
box('dormer frame', (DX, DY, DZ + .152), (.20, .17, .02), TIMBER, up=True)
box('dormer pane', (DX, DY, DZ + .164), (.15, .12, .008), GLASS, up=True)
box('dormer mullion', (DX, DY, DZ + .17), (.016, .13, .008), TIMBER, up=True)

# ---- the chimney: brick, stacked a little askew ------------------------------------------
CX, CZ = -.46, -.24
box('chimney', (CX, 1.40, CZ), (.20, .80, .20), BRICK, up=True)
for y in (1.52, 1.70):
    box('chimney course', (CX, y, CZ), (.215, .025, .215), STONE, up=True)
box('chimney crown', (CX, 1.82, CZ), (.25, .05, .25), STONE, up=True)
box('chimney pot', (CX + .03, 1.88, CZ), (.08, .08, .08), BRICK, up=True)
box('chimney flue', (CX + .03, 1.921, CZ), (.05, .004, .05), IRON, up=True)

# ---- windows -------------------------------------------------------------------------------
def window(name, x, y, z, turn=0.0, up=False, w=.22, h=.24, shutter=False):
    """A frame, an amber pane, a cross of mullions and a sill on a flat face; `turn` faces it
    +Z at 0. The shutter hangs open on one side, half off its hinge."""
    nx, nz = math.sin(turn), math.cos(turn)
    at = lambda off, dx=0.0, dy=0.0: (x + nx * off + math.cos(turn) * dx, y + dy, z + nz * off - math.sin(turn) * dx)
    box(name + ' window frame', at(.0), (w, h, .03), TIMBER, turn=turn, up=up)
    box(name + ' window pane', at(.017), (w - .05, h - .05, .008), GLASS, turn=turn, up=up)
    box(name + ' window mullion', at(.022), (.014, h - .05, .008), TIMBER, turn=turn, up=up)
    box(name + ' window transom', at(.022), (w - .05, .014, .008), TIMBER, turn=turn, up=up)
    box(name + ' window sill', at(.03, dy=-h / 2 - .01), (w + .05, .03, .06), OAK, turn=turn, up=up)
    if shutter:
        box(name + ' window shutter', at(.035, dx=w / 2 + .06), (.10, h, .02), HULL, turn=turn - .5, up=up)


window('ground left', -.48, .40, FRONT + .004, shutter=True)
window('upper left', -.14, .88, UFRONT + .004, up=True)
window('ground side', HW + .004, .40, -.12, math.pi / 2)
window('upper side', -UHW - .004, .88, .02, -math.pi / 2, up=True, shutter=True)
window('upper back', .20, .88, -UFRONT - .004, math.pi, up=True)
# A porthole on the ground floor's west face: a ring of brass round a round pane.
rod('porthole ring', (-HW - .02, .42, .16), (-HW + .004, .42, .16), .085, BRASS, sides=10)
rod('porthole glass', (-HW - .026, .42, .16), (-HW - .018, .42, .16), .062, GLASS, sides=10)

# The oriel, upstairs over the door's right: a box out on two brackets, glass on its three
# faces and eight glazing bars across the front, under its own lean-to of slate.
OX, OY, OZ = .38, .86, UFRONT + .09
box('oriel body', (OX, OY, OZ - .02), (.46, .38, .20), PLASTER, up=True)
box('oriel glass', (OX, OY + .01, OZ + .082), (.38, .26, .01), GLASS, up=True)
for x in (-.19, -.095, 0, .095, .19):
    box('oriel bar', (OX + x, OY + .01, OZ + .09), (.016, .28, .01), TIMBER, up=True)
for y in (-.06, .08):
    box('oriel rail', (OX, OY + .01 + y, OZ + .09), (.40, .014, .01), TIMBER, up=True)
for x in (-.23, .23):
    box('oriel side glass', (OX + x + (.004 if x > 0 else -.004), OY + .01, OZ - .02), (.01, .22, .12), GLASS, up=True)
box('oriel sill', (OX, OY - .20, OZ), (.50, .04, .24), OAK, up=True)
for x in (-.16, .16):
    box('oriel bracket', (OX + x, OY - .27, OZ - .05), (.04, .12, .12), TIMBER, tilt=.5, up=True)
box('oriel roof', (OX, OY + .22, OZ - .01), (.52, .03, .26), SLATE, tilt=.35, up=True)

# ---- the door -------------------------------------------------------------------------------
DOOR_Z = FRONT + .02
box('door recess', (0, .31, DOOR_Z), (.38, .62, .03), TIMBER)
for i in range(5):
    box('door board', (-.14 + i * .07, .29, DOOR_Z + .022), (.064, .56, .02), HULL)
for y in (.12, .30, .48):
    box('door band', (0, y, DOOR_Z + .036), (.30, .026, .012), IRON)
rod('door ring', (.10, .30, DOOR_Z + .03), (.10, .30, DOOR_Z + .046), .03, BRASS, sides=8)
box('door lintel', (0, .64, DOOR_Z + .02), (.48, .07, .07), TIMBER)
for x in (-.215, .215):
    box('door jamb', (x, .31, DOOR_Z + .02), (.05, .62, .05), TIMBER)

# The great lantern by the door, on the door's left: bracket, four ribs round amber glass, cap.
LX, LY, LZ = -.30, .50, FRONT + .14
box('lantern bracket', (LX, LY + .15, FRONT + .07), (.03, .03, .16), IRON)
rod('lantern hanger', (LX, LY + .15, LZ), (LX, LY + .09, LZ), .006, IRON, sides=4)
box('lantern glass', (LX, LY, LZ), (.08, .13, .08), GLASS)
for dx in (-.042, .042):
    for dz in (-.042, .042):
        box('lantern rib', (LX + dx, LY, LZ + dz), (.012, .14, .012), IRON)
rod('lantern cap', (LX, LY + .07, LZ), (LX, LY + .11, LZ), .07, IRON, top=.012, sides=4)
box('lantern base', (LX, LY - .075, LZ), (.10, .02, .10), IRON)

# ---- the prow over the door, and the kraken on it ----------------------------------------
# The front of a hull comes out of the wall between the storeys: two cheeks meeting at a
# stem, a bowsprit off it, and the kraken sitting on the stem with four arms hanging down
# either side of the lintel. It is above a settler's head (0.45) even before the porch lifts
# it, so it walls nothing in.
PZ = UFRONT + .005
stem = (0, .74, PZ + .30)
for s in (-1, 1):
    cheek = [(s * .22, .64, PZ), (s * .22, .86, PZ), stem[:2] + (stem[2],), (0, .64, PZ + .22)]
    verts = [(x, y, z) for x, y, z in cheek] + [(x, y + .0, z - .0) for x, y, z in cheek]
    # a cheek is a thin quad: the same four corners, pushed 0.02 inwards
    inner = [(x - s * .02, y, z - .01) for x, y, z in cheek]
    solid('prow cheek', cheek + inner, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], HULL)
box('prow rail', (0, .87, PZ + .12), (.46, .03, .26), OAK)
rod('bowsprit', (0, .80, PZ), (0, 1.02, PZ + .56), .026, OAK, top=.016, sides=6)
for y in (.86, .95):
    rod('bowsprit band', (0, y - .005, PZ + .26 + (y - .86) * 2.4), (0, y + .01, PZ + .27 + (y - .86) * 2.4), .03, IRON, sides=6)
rod('stay', (0, 1.02, PZ + .56), (0, 1.08, UFRONT - .02), .006, ROPE, sides=4)
# The kraken: a dome of a head with two pale eyes, and four arms that each hang in three
# segments and curl out at the end.
KX, KY, KZ = 0, .88, PZ + .24
ball('kraken head', (KX, KY + .06, KZ), (.12, .13, .11), KRAKEN, seg=10, rings=6)
ball('kraken brow', (KX, KY + .02, KZ + .07), (.10, .04, .05), KRAKEN_DARK, seg=8, rings=4)
for s in (-1, 1):
    ball('kraken eye', (KX + s * .05, KY + .03, KZ + .10), (.022, .026, .015), BONE, seg=6, rings=4)
    ball('kraken pupil', (KX + s * .05, KY + .03, KZ + .113), (.008, .016, .006), FLAG, seg=4, rings=3)
for i, (sx, sz) in enumerate([(-1, 1), (1, 1), (-1, -.3), (1, -.3)]):
    reach = .16 if sz > 0 else .12
    pts = [(KX + sx * .06, KY - .02, KZ + sz * .05),
           (KX + sx * (.09 + .02 * i), KY - .14, KZ + sz * .06 + .02),
           (KX + sx * reach, KY - .24, KZ + sz * .04 + .05),
           (KX + sx * (reach + .06), KY - .22, KZ + sz * .02 + .09)]
    for k in range(3):
        r = .026 - .007 * k
        rod('kraken arm', pts[k], pts[k + 1], r, KRAKEN, top=r - .007, sides=6, fill='NOTHING' if k else 'NGON')

# The sign, hung off the corner on the door's right: an iron arm and a board with a brass
# kraken plate - the same five lines as the tavern's tankard sign, turned to the side.
box('sign arm', (HW + .10, .74, FRONT - .02), (.26, .03, .03), IRON)
rod('sign stay', (HW, .62, FRONT - .02), (HW + .18, .735, FRONT - .02), .008, IRON, sides=4)
for x in (HW + .07, HW + .19):
    rod('sign chain', (x, .72, FRONT - .02), (x, .64, FRONT - .02), .005, IRON, sides=4)
box('sign board', (HW + .13, .54, FRONT - .02), (.24, .20, .04), TIMBER, .01)
ball('sign kraken', (HW + .13, .56, FRONT + .005), (.06, .06, .012), BRASS, seg=8, rings=4)
for x in (-.06, -.02, .02, .06):
    box('sign kraken arm', (HW + .13 + x, .49, FRONT + .005), (.014, .06, .01), BRASS)

# ---- the Jolly Roger, off the back of the roof -------------------------------------------
# No anchor.flag (see the top): the flag is baked, cloth and skull, on both faces, since the
# plain material is single-sided.
MX, MZ, MAST_TOP = .52, -.30, 2.12
rod('flag mast', (MX, 1.30, MZ), (MX, MAST_TOP, MZ), .016, OAK, top=.012, sides=6, up=True)
rod('flag mast truck', (MX, MAST_TOP, MZ), (MX, MAST_TOP + .03, MZ), .022, BRASS, top=0, sides=6, up=True)
FW, FH, FT = .34, .22, .01
FX, FY = MX + .014 + FW / 2, MAST_TOP - .14
box('jolly roger', (FX, FY, MZ), (FW, FH, FT), FLAG, up=True)


def emblem(s):
    """Skull and crossbones on one face of the flag (s = +1 the +Z face, -1 the back): the sea
    chest's flag_emblem (scripts/build-treasure.py) at full size, crossed bones under a skull
    plate cut to a cranium, cheeks and jaw, with sockets and teeth in the cloth's black."""
    z0 = MZ + s * FT / 2
    ex, ey = FX + .02, FY + .01
    for k in (-1, 1):
        a = (ex - k * .085, ey - .075, z0 + s * .002)
        b = (ex + k * .085, ey + .055, z0 + s * .002)
        rod('crossbone', a, b, .007, BONE, sides=4, up=True)
        for end in (a, b):
            ball('bone knuckle', end, (.012, .012, .004), BONE, seg=4, rings=3, up=True)
    half = [(0, .05), (.026, .045), (.041, .03), (.045, .01), (.038, -.01), (.033, -.02), (.031, -.035), (.016, -.042)]
    outline = [(x, .012 + y) for x, y in half] + [(-x, .012 + y) for x, y in reversed(half[1:])]
    plate('skull', outline, ex, ey, z0 + s * .0045, .003, BONE, up=True)
    zf = z0 + s * .0065
    for x in (-1, 1):
        hexagon = [(.0125 * math.cos(i * math.tau / 6), .0125 * math.sin(i * math.tau / 6)) for i in range(6)]
        plate('skull socket', hexagon, ex + x * .017, ey + .024, zf, .002, FLAG, up=True)
    plate('skull nose', [(0, .01), (-.005, -.002), (.005, -.002)], ex, ey, zf, .002, FLAG, up=True)
    for x in (-.012, 0, .012):
        box('skull tooth gap', (ex + x, ey - .02, zf), (.002, .016, .002), FLAG, up=True)


for s in (1, -1):
    emblem(s)

# ---- on the quay: two barrels, a crate, a bollard and a coil of rope ----------------------
# All to the sides of the door, clear of the walk up to it (the building test measures it).
for x, z in ((-.88, .30), (-.88, .02)):
    rod('barrel', (x, 0, z), (x, .27, z), .105, OAK, top=.095, sides=10)
    for y in (.05, .20):
        rod('barrel hoop', (x, y, z), (x, y + .022, z), .108, IRON, sides=10, fill='NOTHING')
    rod('barrel lid', (x, .268, z), (x, .28, z), .09, TIMBER, sides=10)
box('crate', (.86, .10, .34), (.20, .20, .20), OAK, .01, turn=.3)
box('crate on the crate', (.86, .25, .34), (.14, .10, .14), HULL, .006, turn=-.2)
rod('bollard', (.62, 0, FRONT + .30), (.62, .16, FRONT + .30), .045, IRON, sides=8)
rod('bollard cap', (.62, .16, FRONT + .30), (.62, .185, FRONT + .30), .06, IRON, sides=8)
rod('rope coil', (.86, 0, -.02), (.86, .045, -.02), .09, ROPE, sides=10)
rod('rope coil top', (.86, .045, -.02), (.86, .07, -.02), .06, ROPE, sides=10)

for name, p in (('smoke', (CX + .03, 1.93, CZ)), ('door', (0, 0, FRONT + .06))):
    q = _turn @ Vector(xyz(p)) if name == 'smoke' else Vector(xyz(p))
    bpy.ops.object.empty_add(location=q)
    bpy.context.object.name = 'anchor.' + name

# A hair over the truck's top: a height exactly on it reads as below it in float32.
bpy.context.scene['building_height'] = round(MAST_TOP + .035, 3)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-piratetavern.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'piratetavern'})
