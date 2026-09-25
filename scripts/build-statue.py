"""The founder: a cast bronze figure on the square's warm carved stone.

Run: node scripts/blender.mjs --background --python scripts/build-statue.py
Hand edits: save assets/statue/statue.blend, then npm run models -- statue.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/statue'
OUT.mkdir(parents=True, exist_ok=True)
# The actual shared materials preserve both the colour and the night-window mask.
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/townhall/promptholm-townhall.blend'))
for obj in list(bpy.context.scene.objects):
    if obj.get('building_part') or obj.name.startswith('anchor.'):
        bpy.data.objects.remove(obj, do_unlink=True)

def xyz(p): return (p[0],-p[2],p[1])
def finish(name,mat):
    obj=bpy.context.object;obj.name='Statue '+name
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


def material(name, rgb):
    m=bpy.data.materials.new(name)
    values=[v/255 for v in rgb]
    values=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values]
    m.diffuse_color=(*values,1)
    m.use_nodes=True
    shader=m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value=(*values,1)
    shader.inputs['Roughness'].default_value=.72
    return m

material('plain:statue-bronze',(127,100,61))
material('plain:statue-highlights',(162,133,81))
material('plain:statue-patina',(80,112,95))
BRONZE='plain:statue-bronze'
EDGE='plain:statue-highlights'
PATINA='plain:statue-patina'


def ellipsoid(name,p,size,mat):
    o=ball(name,p,1,mat)
    o.scale=(size[0],size[2],size[1])
    return o


def coat():
    # A continuous fitted silhouette, widening into the hem; no block torso or
    # detached shoulder cubes. The back is slightly longer like a founder's coat.
    rings=[(.975,.105,.065),(1.04,.080,.057),(1.13,.082,.058),(1.22,.112,.063),(1.255,.071,.045)]
    vertices=[xyz((rx*math.cos(i*math.tau/8),y,rz*math.sin(i*math.tau/8))) for y,rx,rz in rings for i in range(8)]
    faces=[tuple(reversed(range(8)))]
    for j in range(4):
        for i in range(8):
            k=(i+1)%8
            faces.append((j*8+i,j*8+k,(j+1)*8+k,(j+1)*8+i))
    faces.append(tuple(range(32,40)))
    m=bpy.data.meshes.new('cast coat');m.from_pydata(vertices,[],[tuple(reversed(f)) for f in faces]);m.update()
    o=bpy.data.objects.new('Statue fitted coat',m);bpy.context.collection.objects.link(o)
    o.data.materials.append(bpy.data.materials[BRONZE]);o['building_part']=True


# Chamfered courses, a recessed inscription panel and a slightly projecting coping
# make the pedestal read as carved stone without enlarging its old .52 footprint.
box('bottom step',(0,.04,0),(.56,.08,.56),'stone:foundation',.015)
box('upper step',(0,.115,0),(.47,.07,.47),'stone:foundation',.012)
box('pedestal foot',(0,.175,0),(.39,.05,.39),'stone:foundation',.008)
box('pedestal shaft',(0,.405,0),(.34,.41,.34),'stone:foundation',.012)
box('coping lower',(0,.63,0),(.39,.04,.39),'stone:foundation',.008)
box('coping crown',(0,.678,0),(.44,.056,.44),'stone:foundation',.012)
box('plaque recess',(0,.42,.177),(.225,.21,.016),'plain:iron',.01)
box('bronze plaque',(0,.42,.188),(.20,.185,.012),BRONZE,.008)
for x in [-.082,.082]:
    for y in [.348,.492]:ball('plaque pin',(x,y,.20),.008,EDGE)
# A simple compass relief instead of unreadable miniature lettering.
for a in [0,math.pi/2,math.pi,3*math.pi/2]:
    rod('compass relief',(0,.435,.201),(.049*math.sin(a),.435+.049*math.cos(a),.201),.006,EDGE,top=.001,sides=4)
for y,w in [(.365,.08),(.38,.12)]:box('inscription line',(0,y,.201),(w,.005,.004),EDGE)
rod('bronze casting base',(0,.706,0),(0,.735,0),.175,PATINA,sides=10)
pedestal_objects = set(bpy.context.scene.objects)

# A staggered stance and bent knees give the figure weight, and keep the gesture
# within the plinth's silhouette when seen from the other side of the square.
for side,z in [(-1,.018),(1,-.02)]:
    x=side*.053
    ellipsoid('boot',(x,.759,z+.028),(.034,.025,.068),BRONZE)
    rod('lower leg',(x,.78,z),(x*1.06,.885,z-.01),.025,BRONZE,top=.032,sides=7)
    ellipsoid('knee',(x*1.06,.885,z-.01),(.034,.037,.033),BRONZE)
    rod('upper leg',(x*1.06,.885,z-.01),(side*.043,1.035,0),.033,BRONZE,top=.040,sides=7)
coat()
rod('neck',(0,1.24,0),(0,1.293,.007),.030,BRONZE,sides=8)
ellipsoid('head',(0,1.335,.016),(.053,.069,.047),BRONZE)
ellipsoid('nose',(0,1.335,.060),(.016,.018,.022),EDGE)
ellipsoid('chin',(0,1.294,.038),(.032,.025,.023),BRONZE)
for x in [-.050,.050]:ellipsoid('ear',(x,1.331,.014),(.012,.021,.013),BRONZE)
# A short-brimmed cap and raised collar suggest a harbour founder, not a knight.
rod('cap brim',(0,1.382,.018),(0,1.393,.018),.078,BRONZE,top=.076,sides=10)
rod('cap crown',(0,1.393,.010),(0,1.422,.010),.056,PATINA,top=.048,sides=10)
for side in [-1,1]:
    rod('coat lapel',(side*.046,1.242,.048),(side*.012,1.155,.066),.014,EDGE,top=.009,sides=4)
for y in [1.06,1.105,1.15]:ball('coat button',(0,y,.062),.008,EDGE)
# One arm indicates the sea, the other supports the rolled founding plan.
for name,a,b,c in [('pointing',(.09,1.219,0),(.175,1.223,.018),(.237,1.285,.055)),('holding',(-.092,1.21,0),(-.147,1.11,.02),(-.100,1.103,.102))]:
    rod(name+' upper sleeve',a,b,.039,BRONZE,top=.029,sides=8)
    ellipsoid(name+' elbow',b,(.029,.029,.029),BRONZE)
    rod(name+' lower sleeve',b,c,.029,BRONZE,top=.021,sides=8)
    ellipsoid(name+' hand',c,(.024,.024,.027),EDGE)
rod('pointing finger',(.24,1.291,.062),(.282,1.312,.087),.010,EDGE,top=.007,sides=6)
rod('rolled plan',(-.108,1.025,.108),(-.108,1.187,.108),.024,PATINA,sides=8)
rod('plan top rim',(-.108,1.182,.108),(-.108,1.194,.108),.028,EDGE,sides=8)
rod('plan bottom rim',(-.108,1.019,.108),(-.108,1.031,.108),.028,EDGE,sides=8)

# Enlarge the complete figure around its soles, keeping the pedestal and its
# casting base at their original size. A world transform also catches the coat,
# whose vertices were authored in place rather than around an object origin.
FIGURE_SCALE = 1.45
pivot = Vector(xyz((0,.735,0)))
enlarge = Matrix.Translation(pivot) @ Matrix.Scale(FIGURE_SCALE, 4) @ Matrix.Translation(-pivot)
bpy.context.view_layer.update()
for obj in set(bpy.context.scene.objects) - pedestal_objects:
    obj.matrix_world = enlarge @ obj.matrix_world

scene=bpy.context.scene
scene['building_height']=.735 + (1.422 - .735) * FIGURE_SCALE
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'statue.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':'statue'})
