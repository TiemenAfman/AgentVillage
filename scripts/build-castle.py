"""The square's castle, using the tavern and town hall palette.

Run: node scripts/blender.mjs --background --python scripts/build-castle.py
Hand edits: save assets/castle/castle.blend, then npm run models -- castle.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/castle'
OUT.mkdir(parents=True, exist_ok=True)
# The actual shared materials preserve both the colour and the night-window mask.
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/tavern/agentvillage-tavern.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object;obj.name='Castle '+name
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
def roof(name,p,w,d,h,mat,turn=0):
    vertices=[(-w/2,0,-d/2),(w/2,0,-d/2),(w/2,0,d/2),(-w/2,0,d/2),(-w/2,h,0),(w/2,h,0)]
    faces=[(0,5,1),(0,4,5),(2,4,3),(2,5,4),(0,3,4),(1,5,2),(0,2,3),(0,1,2)]
    m=bpy.data.meshes.new(name);m.from_pydata([xyz(v) for v in vertices],[],faces);m.update()
    o=bpy.data.objects.new('Castle '+name,m);bpy.context.collection.objects.link(o)
    o.location=xyz(p);o.rotation_euler.z=turn;o.data.materials.append(bpy.data.materials[mat]);o['building_part']=True
    return o



def arch(name, x, y, z, width, straight, mat):
    # A filled arch inset behind the stone voussoirs, with its front towards +Z.
    r = width / 2
    outline = [(-r, 0), (r, 0)] + [(r * math.cos(i * math.pi / 8), straight + r * math.sin(i * math.pi / 8)) for i in range(9)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz((x + a, y + b, z)) for a, b in outline], [], [tuple(range(len(outline)))])
    mesh.update()
    obj = bpy.data.objects.new('Castle ' + name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(bpy.data.materials[mat])
    obj['building_part'] = True
    return obj


# Keep the original corner positions and a sub-cell footprint around each turret.
# The roofline stays below the town hall's cupola so the square retains its centre.
box('foundation', (0,.07,0), (1.46,.14,1.30), 'stone:foundation', .015)
box('lower keep', (0,.42,0), (1.34,.70,1.18), 'stone:brick')
box('upper keep', (0,1.02,0), (1.34,.52,1.18), 'wall:cream')
for z in [-.601,.601]:
    for y in [.77,1.28]:
        box('keep timber course', (0,y,z), (1.38,.05,.045), 'plank:dark')
    for x in [-.61,0,.61]:
        box('keep upright', (x,1.02,z), (.04,.51,.035), 'plank:dark')
roof('great hall roof', (0,1.30,0), 1.48,1.42,.48, 'roof:terracotta')
for z in [-.716,.716]:
    box('hall eave', (0,1.30,z), (1.52,.055,.045), 'plank:dark')
for i in range(10):
    rod('ridge tile', (-.74+i*.15,1.79,0), (-.605+i*.15,1.79,0), .033, 'roof:light', sides=6)

for x in [-.72,.72]:
    for z in [-.72,.72]:
        rod('tower plinth', (x,0,z), (x,.16,z), .27, 'stone:foundation', sides=10)
        rod('tower brick foot', (x,.16,z), (x,.55,z), .235, 'stone:brick', top=.22, sides=10)
        rod('tower plaster', (x,.55,z), (x,1.72,z), .22, 'wall:cream', top=.195, sides=10)
        for h,r in [(.55,.232),(1.51,.211),(1.73,.235)]:
            rod('tower stone belt', (x,h,z), (x,h+.055,z), r, 'stone:foundation', sides=10)
        rod('tower eave', (x,1.785,z), (x,1.835,z), .27, 'plank:dark', sides=10)
        rod('tower tiled cap', (x,1.835,z), (x,2.30,z), .29, 'roof:terracotta', top=.025, sides=10)
        rod('tower finial', (x,2.30,z), (x,2.38,z), .026, 'plain:brass', top=0, sides=6)
        # Front and outward-facing windows keep the silhouette readable from the quay too.
        for turn in [0, math.pi / 2 if x > 0 else -math.pi / 2]:
            nx, nz = math.sin(turn), math.cos(turn)
            for y in [.96,1.40]:
                o = box('tower window surround', (x+nx*.208,y,z+nz*.208), (.10,.20,.025), 'stone:foundation')
                o.rotation_euler.z = -turn
                o = box('tower window', (x+nx*.223,y,z+nz*.223), (.049,.14,.012), 'plain:glass')
                o.rotation_euler.z = -turn

# A forward gatehouse hides the hall's central upright and announces the public door.
box('gatehouse', (0,.66,.675), (.72,1.20,.30), 'stone:foundation')
arch('arched oak gate', 0,.07,.832,.43,.43,'plank:oak')
for x in [-.274,.274]:
    for i in range(4):
        box('portal jamb', (x,.135+i*.12,.846), (.105,.108,.07), 'stone:foundation', .004)
for i in range(9):
    a = (i+.5)*math.pi/9
    o = box('portal arch stone', (.271*math.cos(a),.50+.271*math.sin(a),.846), (.098,.115,.07), 'stone:foundation', .003)
    o.rotation_euler.y = a-math.pi/2
for x in [-.105,.105]:
    for y in [.24,.43]:
        box('gate iron strap', (x,y,.855), (.16,.024,.014), 'plain:iron')
    ball('gate handle', (x*.36,.35,.866), .014, 'plain:brass')
box('gate meeting stile', (0,.30,.851), (.014,.46,.016), 'plank:dark')
box('gate cornice', (0,1.24,.675), (.80,.08,.38), 'stone:foundation', .008)
roof('gatehouse roof', (0,1.29,.675), .88,.49,.29, 'roof:terracotta')
box('crest shield', (0,1.00,.841), (.18,.22,.025), 'plank:dark', .016)
box('crest brass face', (0,1.01,.86), (.12,.14,.012), 'plain:brass', .01)

for z in [-.609,.609]:
    for x in [-.43,.43]:
        box('hall window frame', (x,1.025,z), (.17,.30,.025), 'plank:dark')
        box('hall window pane', (x,1.025,z*1.025), (.12,.24,.012), 'plain:glass')
        box('hall window mullion', (x,1.025,z*1.04), (.017,.24,.01), 'plank:dark')
        box('hall window sill', (x,.86,z), (.21,.04,.06), 'stone:foundation')
for x in [-.40,.40]:
    box('gate lamp bracket', (x,.77,.85), (.04,.04,.15), 'plain:iron')
    box('gate lamp glass', (x,.84,.89), (.065,.11,.06), 'plain:glass')
    for h in [.775,.905]:
        box('gate lamp cap', (x,h,.89), (.09,.02,.08), 'plain:iron')

rod('flag pole', (.72,2.30,-.72), (.72,2.83,-.72), .012, 'plank:dark', sides=6)
for name,p in [('flag',(.72,2.76,-.72)), ('door',(0,0,.88))]:
    bpy.ops.object.empty_add(location=xyz(p))
    bpy.context.object.name = 'anchor.' + name

scene = bpy.context.scene
scene['building_height'] = 2.83
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'castle.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET':'castle'})
