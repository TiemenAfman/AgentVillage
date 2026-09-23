"""The harbour lighthouse, using the square's plaster, stone and patinated copper.

Run: node scripts/blender.mjs --background --python scripts/build-lighthouse.py
Hand edits: save assets/lighthouse/lighthouse.blend, then npm run models -- lighthouse.
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
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/townhall/agentvillage-townhall.blend'))
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

# Painted vermilion retains the old red/white daymark in the square's warmer palette.
red = bpy.data.materials.new('wall:red')
rgb = [v / 255 for v in (187, 70, 49)]
rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
red.diffuse_color = (*rgb, 1)
red.use_nodes = True
red.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
red.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = .85

# Four continuous tapered bands keep the daymark readable from sea; the cream,
# brick and oak come directly from the town hall's materials.
rod('stone foot', (0,0,0), (0,.13,0), .43, 'stone:foundation', top=.40, sides=12)
rod('brick plinth', (0,.13,0), (0,.29,0), .37, 'stone:brick', sides=12)
rod('plinth cap', (0,.29,0), (0,.34,0), .39, 'stone:foundation', top=.36, sides=12)
for i in range(4):
    bottom = .34 + i*.46
    rod('painted band', (0,bottom,0), (0,bottom+.46,0), .35-i*.03,
        'wall:cream' if i % 2 == 0 else 'wall:red', top=.32-i*.03, sides=12)
rod('gallery corbel', (0,2.08,0), (0,2.18,0), .23, 'stone:foundation', top=.41, sides=12)
rod('gallery deck', (0,2.18,0), (0,2.23,0), .43, 'stone:foundation', sides=12)

# The lantern's own origin is also the runtime beam height. Baking carries it to
# horizon.js through BEACON_RISE so a distant light cannot drift away from its glass.
rod('lantern glass', (0,2.24,0), (0,2.56,0), .205, 'plain:glass', sides=12)
for h in [2.23,2.56]:
    rod('lantern sill', (0,h,0), (0,h+.035,0), .235, 'plain:iron', sides=12)
for i in range(12):
    a = i*math.tau/12
    b = (i+1)*math.tau/12
    x,z = .212*math.cos(a),.212*math.sin(a)
    rod('lantern mullion', (x,2.26,z), (x,2.56,z), .011, 'plain:iron', sides=4)
    x,z = .395*math.cos(a),.395*math.sin(a)
    rod('gallery railing post', (x,2.23,z), (x,2.46,z), .011, 'plain:iron', sides=4)
    for h in [2.32,2.46]:
        rod('gallery railing', (x,h,z), (.395*math.cos(b),h,.395*math.sin(b)), .009, 'plain:iron', sides=4)
rod('copper roof rim', (0,2.595,0), (0,2.635,0), .285, 'plain:patina', sides=12)
rod('copper roof', (0,2.635,0), (0,2.86,0), .285, 'plain:patina', top=.035, sides=12)
ball('roof brass ball', (0,2.885,0), .034, 'plain:brass')
rod('roof finial', (0,2.90,0), (0,3.02,0), .014, 'plain:brass', top=0, sides=6)

# The entrance meets the ground; there is no decorative step across the walker's door.
box('door stone surround', (0,.30,.345), (.30,.60,.11), 'stone:foundation', .014)
box('door recess', (0,.26,.407), (.215,.52,.018), 'plank:dark')
for i in range(5):
    box('oak door board', (-.078+i*.039,.255,.422), (.035,.50,.016), 'plank:oak')
for y in [.13,.39]:
    box('door hinge', (-.045,y,.435), (.12,.022,.014), 'plain:iron')
ball('door handle', (.061,.26,.439), .014, 'plain:brass')
box('door lintel', (0,.59,.39), (.34,.07,.15), 'stone:foundation', .008)
for y in [.99,1.74]:
    r = .35-(y-.34)*(.03/.46)
    for turn in [0,math.pi/2,math.pi,-math.pi/2]:
        nx,nz = math.sin(turn),math.cos(turn)
        for name,w,h,d,off,mat in [('window surround',.14,.24,.035,.003,'stone:foundation'),('window pane',.081,.17,.013,.027,'plain:glass'),('window mullion',.012,.18,.012,.039,'plank:dark')]:
            o=box(name,(nx*(r+off),y,nz*(r+off)),(w,h,d),mat)
            o.rotation_euler.z = -turn

bpy.ops.object.empty_add(location=xyz((0,0,.45)))
bpy.context.object.name='anchor.door'
scene=bpy.context.scene
scene['building_height']=3.02
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'lighthouse.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'lighthouse'})
