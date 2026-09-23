"""The square's clock tower: warm masonry, a brass dial and an open copper belfry.

Run: node scripts/blender.mjs --background --python scripts/build-clocktower.py
Hand edits: save assets/clocktower/clocktower.blend, then npm run models -- clocktower.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/clocktower'
OUT.mkdir(parents=True, exist_ok=True)
# The actual shared materials preserve both the colour and the night-window mask.
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/townhall/agentvillage-townhall.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object;obj.name='Clocktower '+name
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

# The shaft stays inside the old square plot. Stone courses separate brick and
# plaster, while the open belfry gives the top a silhouette beyond a pointed box.
box('stone foot',(0,.07,0),(.74,.14,.74),'stone:foundation',.018)
box('brick base',(0,.34,0),(.62,.40,.62),'stone:brick')
box('base cornice',(0,.56,0),(.68,.07,.68),'stone:foundation',.008)
box('plaster shaft',(0,1.05,0),(.56,.92,.56),'wall:cream')
for x in [-.267,.267]:
    for z in [-.267,.267]:
        box('corner pilaster',(x,1.045,z),(.075,.92,.075),'stone:foundation')
        box('pilaster capital',(x,1.48,z),(.105,.06,.105),'stone:foundation')
box('clock lower cornice',(0,1.55,0),(.69,.10,.69),'stone:foundation',.01)
box('clock chamber',(0,1.855,0),(.62,.51,.62),'wall:cream')
for x in [-.297,.297]:
    for z in [-.297,.297]:box('clock corner oak',(x,1.855,z),(.045,.51,.045),'plank:dark')
box('clock upper cornice',(0,2.145,0),(.73,.08,.73),'stone:foundation',.012)

# The dial origin is the animation anchor. Its .17 radius preserves the existing
# hour marks and hands; the extra rings live outside their swept area.
rod('clock stone bezel',(0,1.855,.306),(0,1.855,.332),.235,'stone:foundation',sides=24)
rod('clock brass bezel',(0,1.855,.332),(0,1.855,.35),.205,'plain:brass',sides=24)
rod('clock dial',(0,1.855,.351),(0,1.855,.365),.17,'wall:cream',sides=24)
for i in range(12):
    a=i*math.tau/12
    ball('bezel rivet',(.19*math.sin(a),1.855+.19*math.cos(a),.365),.008,'plain:iron')
# Side louvres belong to the bell chamber rather than pretending to be other clocks.
for x in [-.32,.32]:
    box('side louvre recess',(x,1.86,0),(.028,.30,.23),'plank:dark')
    for i in range(5):box('side louvre',(x*1.04,1.75+i*.052,0),(.032,.022,.21),'plank:oak')
box('rear clock panel',(0,1.855,-.32),(.24,.31,.025),'plank:dark')
for i in range(5):box('rear louvre',(0,1.75+i*.052,-.345),(.22,.024,.028),'plank:oak')

box('belfry floor',(0,2.205,0),(.66,.04,.66),'plain:patina')
for x in [-.235,.235]:
    for z in [-.235,.235]:
        box('belfry post',(x,2.39,z),(.043,.35,.043),'plank:dark')
for z in [-.235,.235]:box('belfry beam',(0,2.55,z),(.53,.045,.045),'plank:dark')
for x in [-.235,.235]:box('belfry side beam',(x,2.55,0),(.045,.045,.53),'plank:dark')
rod('bell crown',(0,2.44,0),(0,2.49,0),.07,'plain:brass',sides=10)
rod('bell shoulder',(0,2.34,0),(0,2.44,0),.10,'plain:brass',top=.07,sides=10)
rod('bell flare',(0,2.30,0),(0,2.34,0),.14,'plain:brass',top=.10,sides=10)
rod('bell lip',(0,2.285,0),(0,2.30,0),.145,'plain:brass',sides=10)
ball('bell clapper',(0,2.26,0),.026,'plain:iron')
# Eight-sided copper cap, with a shallow skirt and a steeper crown.
rod('copper roof skirt',(0,2.56,0),(0,2.66,0),.43,'plain:patina',top=.30,sides=8)
rod('copper roof crown',(0,2.66,0),(0,2.88,0),.30,'plain:patina',top=.04,sides=8)
ball('roof finial ball',(0,2.90,0),.038,'plain:brass')
rod('roof finial',(0,2.925,0),(0,3.04,0),.014,'plain:brass',top=0,sides=6)

box('door surround',(0,.265,.32),(.29,.53,.075),'stone:foundation',.009)
box('door recess',(0,.24,.366),(.205,.48,.018),'plank:dark')
for i in range(5):box('door board',(-.078+i*.039,.235,.381),(.035,.46,.016),'plank:oak')
for h in [.14,.35]:box('door iron hinge',(-.047,h,.395),(.105,.02,.012),'plain:iron')
ball('door handle',(.058,.24,.402),.013,'plain:brass')
box('door lintel',(0,.525,.35),(.33,.055,.12),'stone:foundation',.007)
for turn in [0,math.pi/2,math.pi,-math.pi/2]:
    nx,nz=math.sin(turn),math.cos(turn)
    for name,w,h,d,r,mat in [('shaft window frame',.145,.31,.025,.288,'plank:dark'),('shaft window pane',.095,.245,.015,.308,'plain:glass'),('shaft window crossbar',.10,.018,.012,.324,'plank:dark')]:
        o=box(name,(nx*r,1.07,nz*r),(w,h,d),mat)
        o.rotation_euler.z=-turn

bpy.ops.object.empty_add(location=xyz((0,0,.41)))
bpy.context.object.name='anchor.door'
scene=bpy.context.scene
scene['building_height']=3.04
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'clocktower.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'clocktower'})
