"""Author the tavern in Blender; game units, Y up and front +Z in helpers."""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/tavern'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
COLORS = {'wall:cream':0xe8d4ad,'roof:terracotta':0xb8552f,'roof:light':0xc76b3d,
    'stone:foundation':0x968778,'stone:brick':0x9c5a44,'plank:oak':0x845335,
    'plank:dark':0x503728,'plain:iron':0x343638,'plain:brass':0xd7a64e,
    'plain:glass':0xffcb75,'plain:canvas':0x61806a,'plain:linen':0xf0dfb9,
    'plain:soil':0x503c2d,'plain:leaf':0x587346,'plain:flower':0xcc6148}
materials={}
for name,hex in COLORS.items():
    m=bpy.data.materials.new(name)
    rgb=[((hex>>s)&255)/255 for s in [16,8,0]]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m.diffuse_color=(*rgb,1); m.use_nodes=True
    shader=m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value=(*rgb,1)
    shader.inputs['Roughness'].default_value=.86
    m['emissive']=1.0 if name=='plain:glass' else 0.0
    if m['emissive']:
        shader.inputs['Emission Color'].default_value=(*rgb,1)
        shader.inputs['Emission Strength'].default_value=.35
    materials[name]=m
def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object; obj.name=name; obj.data.materials.append(materials[mat]); obj['building_part']=True
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
    v=[(-w/2,0,-d/2),(w/2,0,-d/2),(w/2,0,d/2),(-w/2,0,d/2),(-w/2,h,0),(w/2,h,0)]
    faces=[(0,5,1),(0,4,5),(2,4,3),(2,5,4),(0,3,4),(1,5,2),(0,2,3),(0,1,2)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([xyz(a) for a in v],[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o
    o.location=xyz(p);o.rotation_euler.z=turn;o.data.materials.append(materials[mat]);o['building_part']=True
    return o

# Stone foot, cream plaster and a fully framed cottage, kept within its existing plot.
box('Stone foot',(0,.07,0),(1.36,.14,1.04),'stone:foundation',.018)
box('Plaster walls',(0,.49,0),(1.30,.70,.98),'wall:cream')
roof('Gable infill',(0,.84,0),1.30,.98,.49,'wall:cream')
for z in [-.505,.505]:
    for x in [-.625,-.25,.25,.625]:
        box('Oak upright',(x,.49,z),(.05,.72,.045),'plank:dark')
    for y in [.16,.81]: box('Oak sill',(0,y,z),(1.32,.05,.05),'plank:dark')
    for s in [-1,1]: rod('Diagonal facade brace',(s*.29,.50,z+.008),(s*.59,.78,z+.008),.022,'plank:dark',sides=4)
for x in [-.659,.659]:
    for z in [-.45,0,.45]: box('Side upright',(x,.49,z),(.045,.70,.045),'plank:dark')
    box('Side rail',(x,.46,0),(.04,.045,.96),'plank:dark')
    for s in [-1,1]: rod('Side brace',(x,.49,s*.04),(x,.77,s*.42),.021,'plank:dark',sides=4)

# Deep terracotta roof, heavy eaves, ridge caps and one projecting dormer.
roof('Main tiled roof',(0,.85,0),1.56,1.24,.57,'roof:terracotta')
for z in [-.63,.63]: box('Eave beam',(0,.852,z),(1.60,.065,.055),'plank:dark')
for x in [-.785,.785]:
    for s in [-1,1]: rod('Gable verge',(x,.86,s*.635),(x,1.435,0),.033,'plank:dark',sides=4)
for i in range(12):
    rod('Ridge tile',(-.78+i*.13,1.435,0),(-.66+i*.13,1.435,0),.039,'roof:light',sides=6)
box('Dormer cheeks',(.31,1.135,.36),(.34,.25,.33),'wall:cream')
roof('Dormer tiled roof',(.31,1.25,.37),.45,.44,.20,'roof:light',math.pi/2)
box('Dormer window frame',(.31,1.155,.534),(.235,.20,.032),'plank:dark')
box('Dormer amber pane',(.31,1.158,.553),(.185,.15,.01),'plain:glass')
box('Dormer mullion',(.31,1.158,.561),(.018,.16,.012),'plank:dark')
box('Dormer sill',(.31,1.056,.553),(.28,.035,.06),'plank:oak')

# Door reaches the porch; all furniture stays beside its approach.
box('Door recess',(0,.33,.511),(.38,.66,.033),'plank:dark')
for i in range(5): box('Door board',(-.14+i*.07,.309,.535),(.062,.60,.021),'plank:oak')
for y in [.15,.46]: box('Door hinge',(-.105,y,.550),(.16,.025,.013),'plain:iron')
ball('Door latch',(.103,.32,.56),.021,'plain:brass')
box('Door lintel',(0,.676,.53),(.45,.075,.07),'plank:dark',.008)
for x in [-.45,.45]:
    box('Window frame',(x,.46,.526),(.255,.29,.035),'plank:dark')
    box('Amber window',(x,.46,.548),(.205,.24,.012),'plain:glass')
    box('Window mullion',(x,.46,.560),(.022,.25,.016),'plank:dark')
    box('Window transom',(x,.45,.560),(.21,.018,.016),'plank:dark')
    box('Window sill',(x,.305,.54),(.31,.045,.09),'plank:oak')
    for s in [-1,1]:
        box('Green shutter',(x+s*.158,.455,.531),(.075,.27,.025),'plain:canvas')
        for y in [.36,.54]: box('Shutter rail',(x+s*.158,y,.548),(.078,.018,.013),'plank:dark')
for x in [-.666,.666]:
    box('Side window surround',(x,.56,-.20),(.035,.26,.22),'plank:dark')
    box('Side amber pane',(x*1.023,.56,-.20),(.015,.20,.16),'plain:glass')

for i in range(7):
    o=box('Canvas awning stripe',(-.27+i*.09,.752,.692),(.09,.023,.31),'plain:canvas' if i%2==0 else 'plain:linen')
    o.rotation_euler.x=.18
    box('Canvas scallop',(-.27+i*.09,.712,.842),(.085,.045,.015),'plain:canvas' if i%2==0 else 'plain:linen',.006)
for x in [-.28,.28]: rod('Awning bracket',(x,.61,.55),(x,.73,.83),.012,'plank:dark',sides=4)

# A tankard sign, lantern, stacked barrels, a low bench and a planted window box.
box('Sign bracket',(.81,.90,.66),(.035,.035,.36),'plain:iron')
rod('Sign support',(.81,.76,.53),(.81,.91,.69),.010,'plain:iron')
for z in [.70,.83]: rod('Sign chain',(.81,.72,z),(.81,.89,z),.007,'plain:iron')
box('Hanging sign',(.81,.66,.77),(.048,.22,.28),'plank:dark',.012)
box('Tankard emblem',(.843,.65,.75),(.012,.108,.083),'plain:brass',.005)
box('Tankard foam',(.846,.714,.75),(.015,.018,.091),'plain:linen')
for y in [.619,.675]: box('Tankard handle',(.846,y,.812),(.013,.014,.040),'plain:brass')
box('Tankard handle edge',(.846,.646,.827),(.013,.065,.014),'plain:brass')
box('Lantern hook',(-.247,.65,.58),(.026,.025,.12),'plain:iron')
box('Lantern glow',(-.25,.55,.63),(.065,.10,.065),'plain:glass')
for y in [.486,.608]: box('Lantern cap',(-.25,y,.63),(.089,.025,.089),'plain:iron')
for x in [-.283,-.217]: box('Lantern bar',(x,.55,.666),(.009,.10,.009),'plain:iron')
for z in [-.28,.04]:
    rod('Barrel',(-.84,.0,z),(-.84,.29,z),.112,'plank:oak',.101,sides=10)
    for y in [.052,.205]: rod('Barrel hoop',(-.84,y,z),(-.84,y+.024,z),.115,'plain:iron',sides=10)
    rod('Barrel lid',(-.84,.288,z),(-.84,.30,z),.095,'plank:dark',sides=10)
for x in [.45,.73]: box('Bench leg',(x,.088,.68),(.045,.176,.13),'plank:dark')
box('Bench seat',(.59,.195,.68),(.43,.04,.17),'plank:oak',.008)
box('Window planter',(.47,.272,.591),(.27,.086,.14),'plank:oak',.009)
box('Planter soil',(.47,.318,.591),(.24,.009,.12),'plain:soil')
for i in range(4):
    ball('Planter leaf',(.37+i*.065,.35,.59),.042,'plain:leaf')
    ball('Small bloom',(.37+i*.065,.383,.60),.019,'plain:flower')

box('Brick chimney',(-.48,1.315,-.20),(.19,.65,.20),'stone:brick')
for y in [1.34,1.46,1.58]: box('Chimney course',(-.48,y,-.20),(.207,.027,.217),'stone:foundation')
box('Chimney crown',(-.48,1.657,-.20),(.245,.06,.25),'stone:foundation',.008)
box('Dark chimney flue',(-.48,1.69,-.20),(.139,.006,.14),'plain:iron')
rod('Pennant pole',(.69,.89,-.43),(.69,1.34,-.43),.012,'plank:dark')
for name,p in [('smoke',(-.48,1.71,-.20)),('flag',(.69,1.30,-.43))]:
    bpy.ops.object.empty_add(location=xyz(p));bpy.context.object.name='anchor.'+name
scene=bpy.context.scene
scene['building_height']=1.71
runpy.run_path(str(ROOT/'scripts/export-tavern.py'))

# Studio is excluded from the game export. Keep the same front view in the .blend.
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.01))
floor=bpy.context.object;floor.name='Studio floor'
mat=bpy.data.materials.new('Studio');mat.diffuse_color=(.21,.25,.20,1);floor.data.materials.append(mat)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3,-4,2.9));cam=bpy.context.object;aim(cam,(0,0,.80));cam.data.type='ORTHO';cam.data.ortho_scale=3.05;scene.camera=cam
for loc,power,size in [((-3,-4,5),420,4),((4,-1,3),180,3),((0,3,4),300,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=size;aim(o,(0,0,.6))
scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=1200;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.25,.25,.25);scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'tavern-preview.png')
bpy.context.preferences.filepaths.save_version=0
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'promptholm-tavern.blend'))
bpy.ops.render.render(write_still=True)
