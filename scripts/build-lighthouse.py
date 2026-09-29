"""The harbour lighthouse, using the square's plaster, stone and patinated copper.

Run: node scripts/blender.mjs --background --python scripts/build-lighthouse.py
Hand edits: none - this script is the source; run it again rather than saving the .blend.

It is built to its real size, not scaled to it (Plans/DONE/mijlpalen-tot-tweehonderd.md, "De
vuurtoren"). The first bake was 3.0 tall: barely over the town hall, and beside the pirate
galleon's masthead at 10.8 a shed. Stretching that bake would have given a two-storey door
and windows a settler could walk through, so everything a person measures against keeps the
size it has everywhere else on the island and the tower gets more of it instead:

  the door        0.72 high, the town hall's (a settler is 0.43, the player 0.45)
  the windows     exactly the old ones, now on every storey rather than on two
  the storeys     eight painted bands of 0.47, the old band's height, where there were four
  the gallery     a railing of 0.25 - a metre, at 4 m to the unit
  the lantern     glass 0.66 high round a room 0.72 across, a person's height and more, with
                  the lamp standing in it

That comes to 6.52 to the tip of the finial, 6.70 once the porch has stood it on its step:
the tallest thing on land (the great castle is 5.3 on its own) and well under a masthead.
A tower that tall on the old 0.86 foot is a chimney, so it tapers: the foot is 1.44 across
its corners, the height between four and a half and five times that, and the shaft narrows
from 1.20 to 0.80 under the gallery. It still stands on its one coast cell (SMALL in
lib/layout.mjs), and on a plinth no wider than its foot it covers barely more ground than the
old tower on its step did (1.39 by 1.49 against 1.32 by 1.34); it does reach past the cell,
and lib/animal-places.mjs is told how far (tests/lighthouse.test.mjs holds the two together).
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/lighthouse'
OUT.mkdir(parents=True, exist_ok=True)
# The actual shared materials preserve both the colour and the night-window mask.
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/townhall/promptholm-townhall.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object;obj.name='Lighthouse '+name
    obj.data.materials.append(bpy.data.materials[mat]);obj['building_part']=True
    return obj
def box(name,p,size,mat,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p))
    o=finish(name,mat);o.scale=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('Worn edges','BEVEL');m.width=bevel;m.segments=1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return o


def rod(name,a,b,r,mat,top=None,sides=8):
    a,b=Vector(xyz(a)),Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides,radius1=r,radius2=r if top is None else top,depth=(b-a).length,location=(a+b)/2)
    o=finish(name,mat);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def ball(name,p,r,mat):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=r,location=xyz(p));return finish(name,mat)

# Every course of the tower is a twelve-sided cone standing on the one below it. Blender puts a
# corner of that polygon dead ahead, which set the old door and windows on a ridge with the
# facets falling away behind their edges; turned half a facet, a flat face looks each way the
# door and the windows do, and they sit on it.
SIDES = 12
HALF_FACET = math.pi / SIDES
FLAT = math.cos(HALF_FACET)              # a face's distance from the axis, per unit of corner radius
def course(name,y0,y1,r0,mat,r1=None,sides=SIDES):
    bpy.ops.mesh.primitive_cone_add(vertices=sides,radius1=r0,radius2=r0 if r1 is None else r1,depth=y1-y0,
        location=xyz((0,(y0+y1)/2,0)),rotation=(0,0,math.pi/sides))
    return finish(name,mat)

# Painted vermilion retains the old red/white daymark in the square's warmer palette.
red = bpy.data.materials.new('wall:red')
rgb = [v / 255 for v in (187, 70, 49)]
rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
red.diffuse_color = (*rgb, 1)
red.use_nodes = True
red.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
red.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85

# ---------------------------------------------------------------- the foot
# Stone to above the door, so the door is cut into masonry rather than into the paint: the
# foot course, a brick drum with a slight batter, and a cap to carry the shaft. 1.44 across
# at the grass - the widest thing on the tower, which is what keeps it from reading as a
# chimney - and 0.88 high, a door and its lintel.
FOOT = .72
course('stone foot', 0, .14, FOOT, 'stone:foundation', r1=.70)
course('brick plinth', .14, .80, .66, 'stone:brick', r1=.64)
course('plinth cap', .80, .88, .68, 'stone:foundation', r1=.63)

# ---------------------------------------------------------------- the shaft
# Eight bands, alternating cream and red as the old four did, cream at the foot and red under
# the gallery. Each band is the old band's height, so there are more of them, not bigger
# ones; together they are one straight taper from 1.20 across to 0.80, the way a masonry
# tower narrows as the load on it does.
SHAFT0, SHAFT1 = .88, 4.64
R0, R1 = .60, .40
BANDS = 8
BAND = (SHAFT1 - SHAFT0) / BANDS
def radius(y): return R0 + (R1 - R0) * (y - SHAFT0) / (SHAFT1 - SHAFT0)
for i in range(BANDS):
    y0 = SHAFT0 + i*BAND
    course('painted band', y0, y0 + BAND, radius(y0), 'wall:cream' if i % 2 == 0 else 'wall:red', r1=radius(y0 + BAND))

# ---------------------------------------------------------------- the gallery
# A flared stone corbel out to a deck 1.36 across: a walk 0.30 wide round the lantern, the
# metre and a bit a keeper cleans the glass from, and still narrower than the foot, so the
# silhouette tapers all the way up. The railing is a metre too: posts 0.25 high with a mid
# rail and a top rail.
DECK0, DECK1 = 4.84, 4.92
course('gallery corbel', SHAFT1, DECK0, R1, 'stone:foundation', r1=.66)
course('gallery deck', DECK0, DECK1, .68, 'stone:foundation')
RAIL_R, RAIL_H = .65, .25
for i in range(SIDES):
    a = HALF_FACET + i*math.tau/SIDES
    b = HALF_FACET + (i+1)*math.tau/SIDES
    x,z = RAIL_R*math.cos(a),RAIL_R*math.sin(a)
    rod('gallery railing post', (x,DECK1,z), (x,DECK1+RAIL_H,z), .012, 'plain:iron', sides=4)
    for h in [DECK1+RAIL_H/2, DECK1+RAIL_H]:
        rod('gallery railing', (x,h,z), (RAIL_R*math.cos(b),h,RAIL_R*math.sin(b)), .009, 'plain:iron', sides=4)

# ---------------------------------------------------------------- the lantern
# A room a person could stand in: an iron parapet to the height of their hip, then glass 0.66
# high - the old lantern was 0.32 of glass, lower than the player - round a floor 0.72
# across, under a copper roof that clears the glass by its rim.
GLASS_R = .36
GLASS0, GLASS1 = 5.13, 5.79
course('lantern parapet', DECK1, GLASS0, .38, 'plain:iron')
course('lantern sill', GLASS0 - .03, GLASS0 + .01, .40, 'plain:iron')
# The glass glows after dark (emissive in the town hall's own material), which is how the
# island shows a lamp is lit: the one material is opaque, so from outside the glass *is* the
# light. beacon.js starts the beam at this cylinder's radius, read off the bake.
course('lantern glass', GLASS0, GLASS1, GLASS_R, 'plain:glass')
course('lantern sill', GLASS1, GLASS1 + .04, .40, 'plain:iron')
for i in range(SIDES):
    a = HALF_FACET + i*math.tau/SIDES
    x,z = (GLASS_R+.006)*math.cos(a),(GLASS_R+.006)*math.sin(a)
    rod('lantern mullion', (x,GLASS0+.01,z), (x,GLASS1,z), .012, 'plain:iron', sides=4)
# The lamp, standing on the lantern floor with its lens at the middle of the glass - where a
# real lens sits, so its light leaves through the panes and not through the parapet. Its
# origin is the beam's height: web/js/buildings.js reads it into BEACON_RISE, and that takes
# it to beacon.js and to horizon.js's far light, so neither can drift away from the glass.
LAMP = (GLASS0 + GLASS1) / 2
rod('lamp pedestal', (0,DECK1,0), (0,LAMP-.14,0), .045, 'plain:iron', sides=6)
course('lamp lens', LAMP-.14, LAMP+.14, .13, 'plain:glass', sides=8)
ROOF0 = GLASS1 + .04
course('copper roof rim', ROOF0, ROOF0 + .05, .46, 'plain:patina')
course('copper roof', ROOF0 + .05, 6.22, .46, 'plain:patina', r1=.05)
ball('roof brass ball', (0,6.26,0), .05, 'plain:brass')
rod('roof finial', (0,6.29,0), (0,6.52,0), .018, 'plain:brass', top=0, sides=6)

# ---------------------------------------------------------------- the door
# The town hall's height (its recess is 0.48 by 0.72) as a single leaf 0.34 wide, set in a
# stone surround in the plinth's front face. The entrance meets the ground; there is no
# decorative step across the walker's door - the porch buildings.js adds is that step.
FACE = .65 * FLAT                         # the plinth's front face, halfway up the door
DOOR_W, DOOR_H = .34, .72
box('door stone surround', (0,.42,FACE+.01), (.50,.84,.20), 'stone:foundation', .014)
front = FACE + .11
box('door recess', (0,DOOR_H/2,front+.009), (DOOR_W,DOOR_H,.018), 'plank:dark')
BOARDS = 6
pitch = (DOOR_W - .02) / BOARDS
for i in range(BOARDS):
    box('oak door board', (-(DOOR_W - .02)/2 + pitch*(i+.5),.355,front+.024), (pitch-.004,.70,.016), 'plank:oak')
for y in [.16,.54]:
    box('door hinge', (-.08,y,front+.037), (.16,.022,.014), 'plain:iron')
ball('door handle', (.10,.36,front+.041), .014, 'plain:brass')
box('door lintel', (0,.86,FACE+.04), (.58,.09,.22), 'stone:foundation', .008)

# ---------------------------------------------------------------- the windows
# The old windows exactly - surround, pane and mullion at the same sizes - one pair to every
# storey, in the middle of its band. The pairs turn a quarter from each storey to the next,
# which is how a stair winding up inside a tower lights itself: from any side there is a
# window on every other band, and from a corner a zigzag up the whole height.
for i in range(BANDS):
    y = SHAFT0 + (i + .5)*BAND
    r = radius(y) * FLAT
    for turn in ([0, math.pi] if i % 2 == 0 else [math.pi/2, -math.pi/2]):
        nx,nz = math.sin(turn),math.cos(turn)
        for name,w,h,d,off,mat in [('window surround',.14,.24,.035,.003,'stone:foundation'),('window pane',.081,.17,.013,.027,'plain:glass'),('window mullion',.012,.18,.012,.039,'plank:dark')]:
            o=box(name,(nx*(r+off),y,nz*(r+off)),(w,h,d),mat)
            o.rotation_euler.z = -turn

bpy.ops.object.empty_add(location=xyz((0,0,front+.04)))
bpy.context.object.name='anchor.door'
scene=bpy.context.scene
scene['building_height']=6.52
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lighthouse.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'lighthouse'})
