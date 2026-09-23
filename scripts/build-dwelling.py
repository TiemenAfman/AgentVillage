"""Author one dwelling body from its design.json. Roofs and yards remain composable.
blender --background --python scripts/build-dwelling.py -- hut
Hand edits: npm run models -- hut (rebuilding replaces hand edits).
"""
import bpy, sys, json, runpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
kind=sys.argv[sys.argv.index('--')+1]
OUT=ROOT/'assets'/kind
D=json.loads((OUT/'design.json').read_text(encoding='utf-8-sig'))
w,h=D['width'],D['height']; name='house_'+kind+'_a'
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/tavern/promptholm-tavern.blend'))
for o in list(bpy.context.scene.objects):
    if o.get('building_part') or o.name.startswith('anchor.'):bpy.data.objects.remove(o,do_unlink=True)
collection=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(collection)
def xyz(p):return(p[0],-p[2],p[1])
def box(label,p,size,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name=name+' '+label
    o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    o.data.materials.append(bpy.data.materials[mat]);o['building_part']=True
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o);return o
# A plaster core, a dressed base and timber eaves define the silhouette at every distance.
box('plaster',(0,h/2,0),(w,h,w),'wall:cream')
box('foot',(0,.035,0),(w+.065,.07,w+.065),'stone:foundation')
frame='stone:foundation' if D.get('stone') else 'plank:dark'
for x in [-w/2,w/2]:
    for z in [-w/2,w/2]:box('corner',(x,h/2,z),(.04,h,.04),frame)
for z in [-w/2,w/2]:box('eave',(0,h-.022,z),(w+.055,.045,.045),'plank:dark')
for x in [-w/2,w/2]:box('side eave',(x,h-.022,0),(.045,.045,w),'plank:dark')
# Solid door, lintel and jambs. All framing stays clear of the approach.
dh=min(.44,h*.78);dz=w/2+.014
box('door',(0,dh/2+.045,dz),(.19,dh,.025),'plank:oak')
for x in [-.112,.112]:box('door jamb',(x,dh/2+.04,dz+.012),(.024,dh+.05,.03),frame)
box('door lintel',(0,dh+.055,dz+.012),(.25,.034,.045),frame)
box('latch',(.055,dh*.50,dz+.03),(.035,.012,.014),'plain:brass')
# Individually framed panes: larger houses gain an upstairs row instead of stretched windows.
rows=[h*.53] if h<.9 else [.31,h*.76]
for row,y in enumerate(rows):
    # Lower front windows sit to either side of the doorway; the side window lights the room.
    spots=[(-w*.30,w/2+.012,False),(w*.30,w/2+.012,False),(w/2+.012,-w*.14,True)]
    for i,(x,z,side) in enumerate(spots):
        ww=.145 if D.get('stone') else .17;hh=min(.25,h*.36)
        def detail(label,dx,dy,depth,sw,sh,sd,mat):
            return box(label,(x+(depth if side else dx),y+dy,z+(dx if side else depth)),(sd if side else sw,sh,sw if side else sd),mat)
        detail('window frame',0,0,0,ww+.045,hh+.045,.028,'plank:dark')
        detail('pane',0,0,.018,ww,hh,.014,'plain:glass')
        detail('mullion',0,0,.03,.014,hh,.01,'plank:oak')
        detail('sill',0,-hh/2-.02,.028,ww+.08,.027,D.get('sillDepth',.07),'stone:foundation' if D.get('stone') else 'plank:oak')
# Deliberate differences authored per design: shutters, projecting floor or stone piers.
if D.get('shutters'):
    for x in [-w*.30,w*.30]:
        for s in [-1,1]:box('shutter',(x+s*.124,rows[0],w/2+.035),(.055,.23,.022),'plain:canvas')
if D.get('course'):
    y=h*.52
    for z in [-w/2,w/2]:box('floor beam',(0,y,z),(w+.055,.055,.055),frame)
    for x in [-w/2,w/2]:box('floor return',(x,y,0),(.055,.055,w),frame)
if D.get('braces'):
    for x in [-w/2-.006,w/2+.006]:
        o=box('diagonal brace',(x,h*.70,w*.23),(.027,h*.36,.027),'plank:dark');o.rotation_euler.x=.65
if D.get('canopy'):
    o=box('door canopy',(0,dh+.20,dz+.09),(.33,.035,.20),'plank:oak');o.rotation_euler.x=.16
if D.get('wing'):
    box('study frame',(w*.62,h*.36,.16),(.25,.27,.026),'plank:dark')
    box('study pane',(w*.62,h*.36,.18),(.20,.22,.012),'plain:glass')
if D.get('windowbox'):
    x=w/2+.10;z=-w*.14;y=rows[0]-.19
    box('windowbox',(x,y,z),(.16,.10,.29),'plank:oak')
    box('windowbox soil',(x,y+.054,z),(.12,.012,.25),'plain:soil')
    for dz in [-.075,.075]:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.065,location=xyz((x,y+.10,z+dz)))
        o=bpy.context.object;o.name=name+' herbs';o['building_part']=True;o.data.materials.append(bpy.data.materials['plain:leaf'])
        for c in list(o.users_collection):c.objects.unlink(o)
        collection.objects.link(o)
scene=bpy.context.scene;scene['building_height']=h
cam=scene.camera;cam.location=(2.6,-4,2.4);cam.rotation_euler=(Vector((0,0,h*.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=2.15
scene.render.filepath=str(OUT/(kind+'-preview.png'))
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/('promptholm-'+kind+'.blend')))
runpy.run_path(str(ROOT/'scripts/export-models.py'),init_globals={'MODEL_SET':kind})
bpy.ops.render.render(write_still=True)



