"""The town hall: tavern plaster/oak/tiles, with a civic front and patinated cupola.

Rebuilds the first design. For hand edits, save the .blend and run npm run models -- townhall.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/townhall'
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
    obj=bpy.context.object;obj.name='Townhall '+name
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
    o=bpy.data.objects.new('Townhall '+name,m);bpy.context.collection.objects.link(o)
    o.location=xyz(p);o.rotation_euler.z=turn;o.data.materials.append(bpy.data.materials[mat]);o['building_part']=True
    return o

box('stone foot',(0,.08,0),(1.62,.16,1.16),'stone:foundation',.018)
box('lower plaster',(0,.54,0),(1.52,.76,1.08),'wall:cream')
box('upper plaster',(0,1.16,0),(1.54,.48,1.10),'wall:cream')
for z in [-.566,.566]:
    for x in [-.73,-.28,.28,.73]:box('upright',(x,.79,z),(.055,1.25,.05),'plank:dark')
    for y in [.19,.90,1.40]:
        if z > 0 and y == .19:
            for x in [-.53,.53]:box('lower rail',(x,y,z),(.50,.05,.06),'plank:dark')
        else:box('cross rail',(0,y,z),(1.58,.05,.06),'plank:dark')
    for s in [-1,1]:
        rod('diagonal brace',(s*.32,.94,z),(s*.68,1.36,z),.023,'plank:dark',sides=4)
for x in [-.781,.781]:
    for z in [-.51,0,.51]:box('side upright',(x,.79,z),(.05,1.25,.055),'plank:dark')
    for y in [.19,.90,1.40]:box('side rail',(x,y,0),(.05,.05,1.12),'plank:dark')
    for s in [-1,1]:rod('side brace',(x,.93,s*.03),(x,1.35,s*.46),.022,'plank:dark',sides=4)

roof('gable infill',(0,1.40,0),1.54,1.1,.49,'wall:cream')
roof('terracotta roof',(0,1.42,0),1.83,1.36,.55,'roof:terracotta')
for z in [-.685,.685]:box('eave',(0,1.42,z),(1.87,.065,.055),'plank:dark')
for x in [-.918,.918]:
    for s in [-1,1]:rod('roof verge',(x,1.43,s*.69),(x,1.985,0),.032,'plank:dark',sides=4)
for i in range(14):rod('ridge cap',(-.91+i*.13,1.978,0),(-.79+i*.13,1.978,0),.037,'roof:light',sides=6)

# A central front gable and a broad double door make this a public building.
box('front gable wall',(0,1.365,.595),(.54,.53,.20),'wall:cream')
roof('front gable infill',(0,1.61,.595),.30,.54,.29,'wall:cream',math.pi/2)
roof('front gable roof',(0,1.62,.595),.44,.70,.32,'roof:light',math.pi/2)
for x in [-.282,.282]:box('front gable post',(x,1.40,.707),(.043,.47,.037),'plank:dark')
rod('gable left brace',(-.34,1.63,.825),(0,1.955,.825),.020,'plank:dark',sides=4)
rod('gable right brace',(.34,1.63,.825),(0,1.955,.825),.020,'plank:dark',sides=4)
box('door recess',(0,.36,.552),(.48,.72,.04),'plank:dark')
for i in range(8):box('door plank',(-.196+i*.056,.35,.581),(.048,.69,.024),'plank:oak')
for x in [-.04,.04]:ball('door handle',(x,.37,.607),.015,'plain:brass')
for x in [-.18,.18]:
    for y in [.20,.53]:box('door hinge',(x,y,.6),(.10,.023,.014),'plain:iron')
box('door lintel',(0,.746,.58),(.56,.085,.10),'plank:dark',.008)
roof('door canopy',(0,.80,.67),.64,.34,.14,'roof:terracotta')
for x in [-.27,.27]:rod('canopy brace',(x,.69,.57),(x,.81,.80),.017,'plank:dark',sides=4)

for x in [-.515,.515]:
    for y in [.52,1.145]:
        box('window frame',(x,y,.583),(.267,.31,.04),'plank:dark')
        box('window pane',(x,y,.608),(.213,.25,.014),'plain:glass')
        box('window mullion',(x,y,.619),(.020,.26,.012),'plank:dark')
        box('window transom',(x,y,.619),(.22,.020,.012),'plank:dark')
        box('window sill',(x,y-.17,.603),(.31,.04,.09),'plank:oak')
    for dx in [-.178,.178]:
        box('shutter',(x+dx,.52,.595),(.064,.28,.026),'plain:canvas')
for x in [-.798,.798]:
    for z in [-.28,.28]:
        box('side window frame',(x,.55,z),(.04,.29,.23),'plank:dark')
        box('side window pane',(x*1.021,.55,z),(.012,.23,.17),'plain:glass')
        box('side window mullion',(x*1.034,.55,z),(.012,.24,.018),'plank:dark')
# Civic crest: a small brass sun and crossed ears of grain, no text atlas.
rod('crest disc',(0,1.42,.718),(0,1.42,.737),.107,'plain:brass',sides=12)
rod('crest inset',(0,1.42,.739),(0,1.42,.748),.080,'plain:canvas',sides=12)
for s in [-1,1]:
    rod('crest wheat stem',(0,1.365,.752),(s*.050,1.465,.752),.006,'plain:brass',sides=5)
    for i in range(3):ball('crest wheat grain',(s*(.020+i*.012),1.408+i*.020,.757),.011,'plain:brass')
for x in [-.32,.32]:
    box('lantern glass',(x,.64,.669),(.065,.095,.065),'plain:glass')
    for y in [.58,.70]:box('lantern cap',(x,y,.669),(.084,.023,.084),'plain:iron')
    rod('lantern hook',(x,.71,.57),(x,.74,.67),.009,'plain:iron')

# Open bell lantern, octagonal patinated dome and a gold finial.
rod('cupola base',(0,1.92,-.13),(0,2.05,-.13),.245,'plank:dark',sides=8)
rod('cupola floor',(0,2.05,-.13),(0,2.09,-.13),.270,'plain:patina',sides=8)
for i in range(8):
    a=i*math.tau/8;x,z=math.cos(a)*.202,-.13+math.sin(a)*.202
    rod('bell post',(x,2.075,z),(x,2.425,z),.017,'plank:dark',sides=4)
rod('bell waist',(0,2.21,-.13),(0,2.37,-.13),.104,'plain:brass',.057,sides=10)
rod('bell lip',(0,2.195,-.13),(0,2.225,-.13),.119,'plain:brass',sides=10)
ball('bell clapper',(0,2.19,-.13),.030,'plain:iron')
rod('cupola cornice',(0,2.42,-.13),(0,2.465,-.13),.278,'plank:dark',sides=8)
# Four eight-sided rings, closed at the top: a dome without a UV surface.
v=[]
for r,y in [(.30,2.465),(.268,2.56),(.19,2.68),(.075,2.75)]:
    v.extend(xyz((math.cos(i*math.tau/8)*r,y,-.13+math.sin(i*math.tau/8)*r)) for i in range(8))
v.append(xyz((0,2.78,-.13)))
faces=[]
for j in range(3):
    for i in range(8):a=j*8+i;b=j*8+(i+1)%8;faces.extend([(a,b,b+8),(a,b+8,a+8)])
for i in range(8):faces.append((24+i,24+(i+1)%8,32))
m=bpy.data.meshes.new('Patina dome');m.from_pydata(v,[],[tuple(reversed(f)) for f in faces]);m.update()
o=bpy.data.objects.new('Townhall patina dome',m);bpy.context.collection.objects.link(o);o.data.materials.append(patina);o['building_part']=True
ball('gold finial',(0,2.805,-.13),.038,'plain:brass')
rod('finial needle',(0,2.82,-.13),(0,2.91,-.13),.012,'plain:brass',.002,sides=6)
rod('flag pole',(.69,1.56,-.40),(.69,2.28,-.40),.012,'plank:dark')
# A hearth shares the tavern's chimney language and the particle budget.
box('chimney',(-.59,1.88,-.28),(.15,.40,.17),'stone:brick')
box('chimney crown',(-.59,2.09,-.28),(.20,.05,.22),'stone:foundation')
box('chimney flue',(-.59,2.118,-.28),(.10,.006,.12),'plain:iron')
box('founding stone',(.89,.20,.59),(.18,.40,.12),'stone:foundation',.009)
box('founding plaque',(.89,.23,.657),(.13,.16,.012),'plain:brass')
for name,p in [('smoke',(-.59,2.14,-.28)),('flag',(.69,2.24,-.40)),('door',(0,0,.61))]:
    bpy.ops.object.empty_add(location=xyz(p));bpy.context.object.name='anchor.'+name

scene=bpy.context.scene;scene['building_height']=2.91
cam=scene.camera;cam.location=(3.5,-5.0,3.5)
cam.rotation_euler=(Vector((0,0,1.3))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale=3.8
scene.render.filepath=str(OUT/'townhall-preview.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'agentvillage-townhall.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'townhall'})
bpy.ops.render.render(write_still=True)
