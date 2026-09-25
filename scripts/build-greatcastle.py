"""The great castle: the castle on its own seven by seven, built at that size.

Run: node scripts/blender.mjs --background --python scripts/build-greatcastle.py
Hand edits are lost: this script writes assets/greatcastle/greatcastle.blend from scratch.

The castle was baked for a three by three (scripts/build-castle.py) and, when it got two
super-cells square (Plans/groot-kasteel.md), was drawn at 7/3 of that bake every way. The
walls came out right and everything a settler measures a building by came out wrong: the
gate stood 1.5 tall and a whole cell wide against the town hall's 0.72 by 0.48, the windows
were the size of that door, and the crest over the gate was bigger than a house's front.
A door is a person wide whoever built it (build-village.py says the same of the church),
so a castle that is bigger has more wall, more windows and more storeys - not bigger ones.

So this is the same castle - brick keep under a cream upper hall, four round towers with
tiled caps, a stone gatehouse in front - drawn again at its real size, with the massing
taken from the 7/3 castle and every detail at the town hall's scale: a gate 0.56 by 0.86,
windows the town hall's, two rows of them on every face the towers leave open, three on
each tower. It stands a little lower than the scaled one (eaves 2.44 rather than 3.03),
because three storeys of village windows is what a keep this wide carries; the towers
still top the town hall's cupola by half as much again.

The three by three keeps build-castle.py's bake: the volcano's guardhouse is drawn as that
castle (GUARDHOUSE_LOOKS_LIKE in shared/volcano.mjs), and so is a castle that has not been
able to grow yet. web/js/buildings.js picks between the two by the lot's width.

Budget: a hero set, 4000 triangles. The old gate's worn-edge bevels (44 triangles a stone)
are gone - at this size they are a pixel - and every window on a face nobody can see
(a back tower's front, looking into the keep) is left out rather than hidden.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/greatcastle'
OUT.mkdir(parents=True, exist_ok=True)
# The tavern's materials, like the castle's: the colours and the night-window mask are the
# ones every civic building on the square shares.
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/tavern/promptholm-tavern.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p): return (p[0], -p[2], p[1])
def finish(name, mat):
    obj = bpy.context.object; obj.name = 'Great castle ' + name
    obj.data.materials.append(bpy.data.materials[mat]); obj['building_part'] = True
    return obj
def box(name, p, size, mat, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = finish(name, mat); o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = o.modifiers.new('Worn edges', 'BEVEL'); m.width = bevel; m.segments = 1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o
def rod(name, a, b, r, mat, top=None, sides=8, fill='NGON'):
    # fill='NOTHING' leaves the ends open, for a length whose both ends are inside something else.
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top, depth=(b - a).length, location=(a + b) / 2, end_fill_type=fill)
    o = finish(name, mat); o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler(); return o
def roof(name, p, w, d, h, mat, turn=0):
    vertices = [(-w/2, 0, -d/2), (w/2, 0, -d/2), (w/2, 0, d/2), (-w/2, 0, d/2), (-w/2, h, 0), (w/2, h, 0)]
    faces = [(0, 5, 1), (0, 4, 5), (2, 4, 3), (2, 5, 4), (0, 3, 4), (1, 5, 2), (0, 2, 3), (0, 1, 2)]
    m = bpy.data.meshes.new(name); m.from_pydata([xyz(v) for v in vertices], [], faces); m.update()
    o = bpy.data.objects.new('Great castle ' + name, m); bpy.context.collection.objects.link(o)
    o.location = xyz(p); o.rotation_euler.z = turn; o.data.materials.append(bpy.data.materials[mat]); o['building_part'] = True
    return o
def plate(name, outline, x, y, z, depth, mat):
    # A flat shape of some thickness, its outline in x and y, its front towards +Z.
    front = [(x + a, y + b, z + depth / 2) for a, b in outline]
    back = [(x + a, y + b, z - depth / 2) for a, b in outline]
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in front + back], [], faces)
    mesh.update()
    obj = bpy.data.objects.new('Great castle ' + name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[mat])
    obj['building_part'] = True
    return obj
def shield(w, h):
    # Square at the top, pointed at the foot: a heater shield. Counter-clockwise seen from the
    # front, like arch()'s outline, so its face points the way the gate does.
    return [(-w / 2, h / 2), (-w / 2, -h * .08), (-w * .3, -h * .36), (0, -h / 2), (w * .3, -h * .36), (w / 2, -h * .08), (w / 2, h / 2)]
def arch(name, x, y, z, width, straight, mat):
    # A filled arch, its front towards +Z, standing on y.
    r = width / 2
    outline = [(-r, 0), (r, 0)] + [(r * math.cos(i * math.pi / 8), straight + r * math.sin(i * math.pi / 8)) for i in range(9)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz((x + a, y + b, z)) for a, b in outline], [], [tuple(range(len(outline)))])
    mesh.update()
    obj = bpy.data.objects.new('Great castle ' + name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[mat])
    obj['building_part'] = True
    return obj

# ---- the measurements everything below hangs off -----------------------------------
# The footprint is the 7/3 castle's (1.34 x 1.18 keep, towers on 0.72 -> 3.12 x 2.72 on
# 1.68), which stands 4.7 across on its seven by seven and leaves the lane round it free.
# The heights are storeys: a brick ground floor the gate fits in, two cream ones above it
# at the town hall's 0.72 (its windows sit 0.63 apart), and the towers one more on top.
KEEP_W, KEEP_D = 3.12, 2.72
KS, KF = KEEP_W / 2, KEEP_D / 2          # side face x, front face z
FOOT, BRICK, FLOOR, EAVE = .16, 1.00, 1.72, 2.44
ROWS = [(BRICK + FLOOR) / 2, (FLOOR + EAVE) / 2]
T = 1.68                                 # tower centres, on both axes
T_TOP = EAVE + .72                       # the tower's own top storey, over the keep's eaves
GH_FACE, GH_BACK, GH_W, GH_TOP = 1.86, 1.24, 1.32, 2.20
GH_Z = (GH_FACE + GH_BACK) / 2

def window(x, y, z, turn=0, name='hall'):
    """A town-hall window on a flat face: frame, pane, mullion, sill. `turn` faces it +Z at 0."""
    nx, nz = math.sin(turn), math.cos(turn)
    for part, (off, size, mat) in {
        'window frame': (.0, (.22, .32, .03), 'plank:dark'),
        'window pane': (.018, (.16, .25, .012), 'plain:glass'),
        'window mullion': (.026, (.018, .25, .01), 'plank:dark'),
    }.items():
        o = box(f'{name} {part}', (x + nx * off, y, z + nz * off), size, mat)
        o.rotation_euler.z = -turn
    o = box(f'{name} window sill', (x + nx * .03, y - .175, z + nz * .03), (.27, .04, .06), 'stone:foundation')
    o.rotation_euler.z = -turn

# ---- the keep ---------------------------------------------------------------------------
box('foundation', (0, FOOT / 2, 0), (KEEP_W + .12, FOOT, KEEP_D + .12), 'stone:foundation', .02)
box('lower keep', (0, (FOOT + BRICK) / 2 - .01, 0), (KEEP_W, BRICK - FOOT + .02, KEEP_D), 'stone:brick')
box('upper keep', (0, (BRICK + EAVE) / 2, 0), (KEEP_W, EAVE - BRICK, KEEP_D), 'wall:cream')
# Timber courses at every floor, all the way round: the storeys are what make the keep read
# as big from across the island, so they are drawn rather than left to the windows.
for y in [BRICK + .025, FLOOR, EAVE - .03]:
    for z in [-KF - .012, KF + .012]:
        box('keep timber course', (0, y, z), (KEEP_W + .05, .05, .045), 'plank:dark')
    for x in [-KS - .012, KS + .012]:
        box('keep side timber course', (x, y, 0), (.045, .05, KEEP_D + .05), 'plank:dark')
# Uprights between the window bays on the three faces with three bays.
for u in [-.36, .36]:
    box('keep back upright', (u, (BRICK + EAVE) / 2, -KF - .012), (.04, EAVE - BRICK, .035), 'plank:dark')
    for x in [-KS - .012, KS + .012]:
        box('keep side upright', (x, (BRICK + EAVE) / 2, u), (.035, EAVE - BRICK, .04), 'plank:dark')

# Three bays between the towers on the back and on either side, two storeys each; the front
# has one bay either side of the gatehouse. The towers take 1.17 from the middle of a face.
for y in ROWS:
    for b in [-.72, 0, .72]:
        window(b, y, -KF - .005, math.pi)
        window(KS + .005, y, b, math.pi / 2)
        window(-KS - .005, y, b, -math.pi / 2)
    for x in [-.92, .92]:
        window(x, y, KF + .005)

roof('great hall roof', (0, EAVE, 0), KEEP_W + .14, KEEP_D + .26, 1.0, 'roof:terracotta')
for z in [-(KEEP_D + .26) / 2, (KEEP_D + .26) / 2]:
    box('hall eave', (0, EAVE, z), (KEEP_W + .18, .06, .05), 'plank:dark')
for i in range(12):
    x0 = -(KEEP_W + .14) / 2 + i * (KEEP_W + .14) / 12
    rod('ridge tile', (x0, EAVE + 1.01, 0), (x0 + (KEEP_W + .14) / 12 - .02, EAVE + 1.01, 0), .045, 'roof:light', sides=6)

# ---- the towers -------------------------------------------------------------------------
def tower_r(y):
    """The plaster's radius at height y: it tapers from 0.51 at the brick to 0.47 at the top."""
    return .51 - .04 * (y - BRICK) / (T_TOP - BRICK)

for x in [-T, T]:
    for z in [-T, T]:
        rod('tower plinth', (x, 0, z), (x, .20, z), .60, 'stone:foundation', sides=10)
        rod('tower brick foot', (x, .20, z), (x, BRICK, z), .54, 'stone:brick', top=.52, sides=10, fill='NOTHING')
        rod('tower plaster', (x, BRICK, z), (x, T_TOP, z), .51, 'wall:cream', top=.47, sides=10, fill='NOTHING')
        for h, r in [(BRICK - .03, .545), (EAVE - .03, .50), (T_TOP - .02, .53)]:
            rod('tower stone belt', (x, h, z), (x, h + .07, z), r, 'stone:foundation', sides=10)
        rod('tower eave', (x, T_TOP + .05, z), (x, T_TOP + .11, z), .62, 'plank:dark', sides=10)
        rod('tower tiled cap', (x, T_TOP + .11, z), (x, T_TOP + 1.2, z), .66, 'roof:terracotta', top=.05, sides=10)
        rod('tower finial', (x, T_TOP + 1.2, z), (x, T_TOP + 1.36, z), .045, 'plain:brass', top=0, sides=6)
        # Out of the two faces a tower shows the world - the front or the back, and its own
        # side - one window a storey, level with the keep's and one in the storey above it.
        for turn in [0 if z > 0 else math.pi, math.pi / 2 if x > 0 else -math.pi / 2]:
            nx, nz = math.sin(turn), math.cos(turn)
            for y in ROWS + [(EAVE + T_TOP) / 2]:
                r = tower_r(y)
                o = box('tower window surround', (x + nx * (r - .01), y, z + nz * (r - .01)), (.14, .27, .04), 'stone:foundation')
                o.rotation_euler.z = -turn
                o = box('tower window', (x + nx * (r + .012), y, z + nz * (r + .012)), (.075, .19, .012), 'plain:glass')
                o.rotation_euler.z = -turn

# ---- the gatehouse ---------------------------------------------------------------------
# It stands forward of the keep between the front towers and carries the public door. The
# gate is a castle's gate at a village's size: 0.56 by 0.86 against the town hall's double
# door, 0.48 by 0.72 - grander by a hand's width, not by a storey.
box('gatehouse', (0, GH_TOP / 2, GH_Z), (GH_W, GH_TOP, GH_FACE - GH_BACK), 'stone:foundation')
GATE_W, GATE_UP, GATE_Y = .56, .58, .04
arch('arched oak gate', 0, GATE_Y, GH_FACE + .007, GATE_W, GATE_UP, 'plank:oak')
for x in [-(GATE_W / 2 + .058), GATE_W / 2 + .058]:
    for i in range(5):
        box('portal jamb', (x, GATE_Y + .06 + i * .116, GH_FACE + .02), (.115, .105, .07), 'stone:foundation')
for i in range(9):
    a = (i + .5) * math.pi / 9
    rr = GATE_W / 2 + .058
    o = box('portal arch stone', (rr * math.cos(a), GATE_Y + GATE_UP + rr * math.sin(a), GH_FACE + .02), (.105, .125, .07), 'stone:foundation')
    o.rotation_euler.y = a - math.pi / 2
for x in [-.14, .14]:
    for y in [GATE_Y + .22, GATE_Y + .52]:
        box('gate iron strap', (x, y, GH_FACE + .018), (.22, .026, .014), 'plain:iron')
    box('gate ring', (x * .3, GATE_Y + .42, GH_FACE + .026), (.03, .03, .014), 'plain:brass')
box('gate meeting stile', (0, GATE_Y + GATE_UP / 2 + .1, GH_FACE + .015), (.016, GATE_UP + .2, .016), 'plank:dark')
for x in [-.48, .48]:
    box('gate lamp bracket', (x, .74, GH_FACE + .075), (.04, .04, .15), 'plain:iron')
    box('gate lamp glass', (x, .81, GH_FACE + .115), (.065, .11, .06), 'plain:glass')
    for h in [.745, .875]:
        box('gate lamp cap', (x, h, GH_FACE + .115), (.09, .02, .08), 'plain:iron')
# The crest over the gate, and the gatehouse's one window over that. A shield and not a
# square: a brass square over the gate, lit by nothing, read from across the square as one
# more window. Green on brass, the town hall's shutters and cupola on its door furniture.
plate('crest shield', shield(.30, .36), 0, 1.30, GH_FACE + .015, .03, 'plain:brass')
plate('crest field', shield(.23, .29), 0, 1.31, GH_FACE + .035, .012, 'plain:canvas')
window(0, 1.86, GH_FACE + .005, name='gatehouse')
box('gate cornice', (0, GH_TOP + .04, GH_Z), (GH_W + .10, .08, GH_FACE - GH_BACK + .10), 'stone:foundation', .01)
roof('gatehouse roof', (0, GH_TOP + .08, GH_Z), GH_W + .18, GH_FACE - GH_BACK + .22, .42, 'roof:terracotta')

rod('flag pole', (T, T_TOP + 1.2, -T), (T, T_TOP + 2.0, -T), .016, 'plank:dark', sides=6)
for name, p in [('flag', (T, T_TOP + 1.9, -T)), ('door', (0, 0, GH_FACE + .06))]:
    bpy.ops.object.empty_add(location=xyz(p))
    bpy.context.object.name = 'anchor.' + name

scene = bpy.context.scene
scene['building_height'] = round(T_TOP + 2.0, 3)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'greatcastle.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'greatcastle'})
