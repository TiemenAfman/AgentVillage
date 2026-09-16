"""The village school: tavern plaster/oak/tiles, classroom windows and a bell.

Rebuilds the first design. For hand edits, save the .blend and run npm run models -- school.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/school'
OUT.mkdir(parents=True, exist_ok=True)
# Borrow the actual tavern materials and studio, not a second approximation of its palette.
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/tavern/agentvillage-tavern.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)
patina = bpy.data.materials.new('plain:patina')
rgb = [v/255 for v in (79,125,106)]
rgb = [v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
patina.diffuse_color=(*rgb,1);patina.use_nodes=True
patina.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*rgb,1)
patina.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8

def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object;obj.name='School '+name
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
    o=bpy.data.objects.new('School '+name,m);bpy.context.collection.objects.link(o)
    o.location=xyz(p);o.rotation_euler.z=turn;o.data.materials.append(bpy.data.materials[mat]);o['building_part']=True
    return o


box('foundation',(0,.07,0),(1.78,.14,1.18),'stone:foundation',.015)
box('brick base',(0,.22,0),(1.70,.16,1.10),'stone:brick')
box('classroom plaster',(0,.64,0),(1.66,.70,1.06),'wall:cream')
roof('gable plaster',(0,.99,0),1.66,1.06,.46,'wall:cream')
for z in [-.546,.546]:
    for x in [-.81,-.27,.27,.81]: box('oak upright',(x,.64,z),(.045,.72,.035),'plank:dark')
    for y in [.30,.98]: box('oak rail',(0,y,z),(1.70,.045,.045),'plank:dark')
for x in [-.845,.845]:
    for z in [-.49,0,.49]: box('side post',(x,.64,z),(.035,.70,.045),'plank:dark')
    for s in [-1,1]: rod('side brace',(x,.40,s*.05),(x,.94,s*.44),.02,'plank:dark',sides=4)
roof('terracotta roof',(0,1.0,0),1.94,1.34,.52,'roof:terracotta')
for z in [-.675,.675]: box('eaves',(0,1.0,z),(1.98,.055,.05),'plank:dark')
for x in [-.975,.975]:
    for s in [-1,1]: rod('verge',(x,1.0,s*.675),(x,1.535,0),.028,'plank:dark',sides=4)
for i in range(14): rod('ridge cap',(-.97+i*.14,1.535,0),(-.84+i*.14,1.535,0),.035,'roof:light',sides=6)
box('door frame',(0,.47,.555),(.37,.65,.045),'plank:dark')
for i in range(5): box('door board',(-.128+i*.064,.46,.584),(.058,.60,.025),'plank:oak')
ball('door latch',(.105,.46,.61),.018,'plain:brass')
roof('entrance gable',(0,.82,.67),.55,.46,.26,'wall:cream',math.pi/2)
roof('porch roof',(0,.84,.67),.63,.54,.27,'roof:light',math.pi/2)
for x in [-.25,.25]: rod('porch brace',(x,.65,.56),(x,.84,.84),.018,'plank:dark',sides=4)
for z in [-.56,.56]:
    for x in [-.54,.54]:
        box('window surround',(x,.655,z),(.32,.47,.032),'plank:dark')
        box('warm pane',(x,.655,z*1.027),(.26,.40,.014),'plain:glass')
        for dx in [-.155,0,.155]:box('window stile',(x+dx,.655,z*1.047),(.018,.45,.015),'plank:oak')
        box('window crossbar',(x,.67,z*1.047),(.30,.018,.015),'plank:oak')
        box('window sill',(x,.41,z*1.045),(.37,.045,.085),'stone:foundation')
for s in [-1,1]:
    o=box('book page',(s*.058,.965,.956),(.11,.14,.025),'plain:linen');o.rotation_euler.y=s*.14
rod('book spine',(0,.895,.974),(0,1.035,.974),.008,'plain:brass',sides=4)
box('slate frame',(.76,.31,.70),(.25,.30,.04),'plank:oak')
box('lesson slate',(.76,.32,.727),(.205,.25,.014),'plain:iron')
for i,w in enumerate([.13,.10,.145]):box('chalk lesson',(.75,.39-i*.065,.738),(w,.009,.004),'plain:linen')
box('bench seat',(-.42,.25,-.73),(.65,.045,.22),'plank:oak')
for x in [-.65,-.19]:box('bench foot',(x,.12,-.73),(.05,.24,.16),'plank:dark')
box('bell floor',(-.53,1.58,0),(.29,.055,.27),'plank:dark')
for x in [-.64,-.42]:
    for z in [-.095,.095]:box('bell post',(x,1.75,z),(.025,.32,.025),'plank:oak')
rod('school bell',(-.53,1.69,0),(-.53,1.79,0),.072,'plain:brass',.025,sides=10)
ball('bell clapper',(-.53,1.67,0),.018,'plain:iron')
roof('bell roof',(-.53,1.91,0),.40,.36,.17,'roof:terracotta')
box('chimney',(.61,1.41,-.22),(.13,.47,.15),'stone:brick')
box('chimney cap',(.61,1.66,-.22),(.18,.04,.20),'stone:foundation')
rod('flag pole',(.80,.3,-.46),(.80,1.60,-.46),.012,'plank:dark')
for name,p in [('door',(0,0,.62)),('smoke',(.61,1.69,-.22)),('flag',(.80,1.56,-.46))]:
    bpy.ops.object.empty_add(location=xyz(p));bpy.context.object.name='anchor.'+name
scene=bpy.context.scene;scene['building_height']=2.08
cam=scene.camera;cam.location=(3.5,-5,3.2);cam.rotation_euler=(Vector((0,0,1.0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=3.3
scene.render.filepath=str(OUT/'school-preview.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'agentvillage-school.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'school'})
bpy.ops.render.render(write_still=True)


