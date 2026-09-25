"""Build the residents from the same Blender face language, with working clothes."""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/settler'
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'promptholm-settler.blend'))
scene = bpy.context.scene
scene['avatar_mesh_name'] = 'villager-mesh.js'
scene['avatar_eye_y'] = .350 + (.383-.363)*.94
scene['avatar_head_y'] = .350
face_names = {'Head','Face','Hair cap','Left ear','Right ear','Left eye','Right eye',
              'Left eyebrow','Right eyebrow','Left sideburn','Right sideburn',
              'Round nose','Smile left','Smile right'}
for obj in list(scene.objects):
    if 'avatar_slot' not in obj:
        continue
    if obj.name not in face_names:
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    obj.hide_set(False)
    obj.hide_render = False
    obj['avatar_variant'] = 'head' if obj['avatar_slot'] == 'skin' else 'detail'
    # A smaller, rounder face on a shorter neck distinguishes the residents.
    obj.location.x *= .94
    obj.location.y *= .94
    obj.location.z = .350 + (obj.location.z-.363)*.94
    obj.scale *= .94

def xyz(p): return (p[0],-p[2],p[1])
def finish(name, slot, variant):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(bpy.data.materials[slot])
    obj['avatar_slot'], obj['avatar_variant'] = slot, variant
    return obj
def ball(name, p, scale, slot, variant):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1, location=xyz(p))
    obj = finish(name,slot,variant)
    obj.scale = (scale[0],scale[2],scale[1])
    return obj
def box(name,p,size,slot,variant,bevel=.005):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p))
    obj = finish(name,slot,variant)
    obj.scale = (size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod = obj.modifiers.new('Worn edges','BEVEL')
    mod.width, mod.segments = bevel, 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj
def rod(name,a,b,r,slot,variant,top=None):
    a,b = Vector(xyz(a)),Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=10,radius1=r,radius2=r if top is None else top,
        depth=(b-a).length,location=(a+b)/2)
    obj = finish(name,slot,variant)
    obj.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return obj

ball('Work shirt',(0,.212,0),(.089,.091,.062),'tunic','torso')
for sign,side in [(-1,'Left'),(1,'Right')]:
    x = sign*.047
    box(side+' clog',(x,.023,.017),(.070,.046,.099),'trim','limbs',.012)
    rod(side+' trousers',(x,.045,0),(x,.139,0),.029,'trim','limbs')
    ball(side+' rolled sleeve',(sign*.091,.247,.002),(.035,.040,.038),'tunic','torso')
    rod(side+' rolled cuff',(sign*.108,.216,.010),(sign*.107,.232,.010),.029,'tunic','torso')
    ball(side+' hand',(sign*.113,.198,.015),(.024,.031,.026),'skin','hands')
    box(side+' waistcoat',(sign*.045,.229,.052),(.042,.105,.015),'trim','limbs')
    o = box(side+' collar',(sign*.022,.279,.048),(.027,.032,.014),'tunic','torso',.003)
    o.rotation_euler.y = sign*.35
box('Short work apron',(0,.150,.066),(.128,.082,.015),'trim','limbs',.007)
box('Apron pocket',(0,.155,.076),(.061,.030,.008),'trim','limbs',.003)
rod('Waist tie',(0,.180,0),(0,.194,0),.091,'trim','limbs').scale.y = .73
rod('Neck',(0,.282,0),(0,.309,0),.028,'skin','hands')
for y in [.233,.255,.277]:
    ball('Shirt button',(0,y,.064),(.004,.004,.003),'trim','limbs')

# Shared faces stay expressive at this scale; a swept hairstyle and low bun give
# women a readable silhouette even in work trousers or a sailor's uniform.
# The bun sits below the hat line, so every existing hat still fits.
for sign,side in [(-1,'Left'),(1,'Right')]:
    ball(side+' swept hair',(sign*.064,.347,-.024),(.026,.057,.049),'hair','womanHair')
ball('Gathered hair',(0,.348,-.059),(.067,.053,.031),'hair','womanHair')
ball('Low hair bun',(0,.350,-.092),(.039,.032,.028),'hair','womanHair')
# A knee-length working skirt leaves the clogs and moving lower legs visible.
# It is an optional clothing layer, so women can wear either skirts or trousers
# without a second simulation, a different job, or a separate picking mesh.
# The front remains behind the short apron until its hem; a simple cone pierced
# the apron in the middle and left two brown corners hanging over the skirt.
rings=[(.077,.115,.094),(.110,.106,.060),(.170,.087,.060),(.185,.082,.067)]
verts=[xyz((rx*math.cos(i*math.tau/10),y,rz*math.sin(i*math.tau/10))) for y,rx,rz in rings for i in range(10)]
faces=[tuple(range(10))]
for j in range(3):
    for i in range(10):
        k=(i+1)%10
        faces.append((j*10+i,(j+1)*10+i,(j+1)*10+k,j*10+k))
faces.append(tuple(reversed(range(30,40))))
mesh=bpy.data.meshes.new('Working skirt')
mesh.from_pydata(verts,[],faces);mesh.update()
o=bpy.data.objects.new('Working skirt',mesh)
bpy.context.collection.objects.link(o)
bpy.context.view_layer.objects.active=o
finish('Working skirt','tunic','skirt')
o=rod('Skirt hem',(0,.075,0),(0,.086,0),.116,'tunic','skirt',.113)
o.scale.y=.82

# Lower, softer headwear: work caps, wool caps and a compact felt brim.
for shape in ['wide','band','cap','sailor','dome','wizard']:
    if shape == 'cap':
        ball('Slouch cap',(.009,.424,-.006),(.092,.034,.075),'hat',shape)
        box('Short cap peak',(0,.415,.065),(.105,.012,.045),'hat',shape)
    elif shape == 'dome':
        ball('Wool bonnet',(0,.417,-.004),(.082,.048,.074),'hat',shape)
        rod('Bonnet hem',(0,.401,0),(0,.418,0),.080,'hat',shape)
    elif shape == 'wide':
        rod('Felt brim',(0,.407,0),(0,.420,0),.100,'hat',shape)
        ball('Rounded felt crown',(0,.420,0),(.069,.040,.067),'hat',shape)
    elif shape == 'sailor':
        rod('Sailor band',(0,.406,0),(0,.423,0),.077,'hat',shape)
        rod('Sailor crown',(0,.423,0),(0,.449,0),.082,'hat',shape,.094)
        box('Sailor peak',(0,.412,.063),(.099,.012,.039),'hat',shape)
    elif shape == 'band':
        rod('Head scarf',(0,.399,0),(0,.420,0),.080,'hat',shape)
        ball('Scarf knot',(.077,.403,-.021),(.018,.017,.021),'hat',shape)
    else:
        rod('Soft pointed cap',(0,.407,0),(-.025,.482,-.010),.079,'hat',shape,.011)
        ball('Bent cap tip',(-.026,.478,-.010),(.021,.013,.018),'hat',shape)

for obj in scene.objects:
    if 'avatar_variant' in obj:
        hidden = obj['avatar_variant'] not in ['torso','limbs','hands','head','detail','cap']
        obj.hide_render = hidden
        obj.hide_set(hidden)
# Resident preview has a dyed shirt and dark workwear.
mat = bpy.data.materials['tunic']
mat.diffuse_color = (.17,.32,.22,1)
mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = mat.diffuse_color
runpy.run_path(str(ROOT / 'scripts/export-settler.py'))
scene.render.filepath = str(OUT / 'villager-preview.png')
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-villager.blend'))
bpy.ops.render.render(write_still=True)

# Preview the optional layers as well as the original outfit; these visibility
# changes are studio-only and do not change what was saved or exported above.
for outfit, filename in [('skirt','villager-woman-preview.png'),('trousers','villager-woman-trousers-preview.png')]:
    shown={'torso','limbs','hands','head','detail','womanHair','band'}
    if outfit=='skirt': shown.add('skirt')
    for obj in scene.objects:
        if 'avatar_variant' in obj:
            hidden=obj['avatar_variant'] not in shown
            obj.hide_render=hidden
            obj.hide_set(hidden)
    scene.render.filepath=str(OUT / filename)
    bpy.ops.render.render(write_still=True)
