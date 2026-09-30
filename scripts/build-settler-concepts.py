"""Three editable Blender concept studies; leaves runtime assets untouched.
Run: blender --background --python scripts/build-settler-concepts.py
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'/'settler'/'concepts'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0

def mat(name,color,rough=.75,texture=False):
    m=bpy.data.materials.new(name); m.use_nodes=True
    rgb=[int(color[i:i+2],16)/255 for i in (0,2,4)]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    m.diffuse_color=(*rgb,1)
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*rgb,1); p.inputs['Roughness'].default_value=rough
    if texture:
        n=m.node_tree.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value=180
        b=m.node_tree.nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value=.13; b.inputs['Distance'].default_value=.0005
        m.node_tree.links.new(n.outputs['Fac'],b.inputs['Height']); m.node_tree.links.new(b.outputs['Normal'],p.inputs['Normal'])
    return m
M={k:mat(k,c,r,t) for k,c,r,t in [('skin','E4B18D',.78,False),('shirt','E8DDC5',.88,True),('collar','F6EDD9',.88,True),('leather','67452F',.62,True),('pack','92724E',.88,True),('hat','C7A669',.9,True),('hair','503A2D',.86,False),('eye','342E2B',.6,False),('mouth','925F49',.85,False),('metal','B69555',.4,False),('blanket','6F8980',.9,True),('trousers','777765',.9,True),('sole','42362C',.88,False)]}
active=None
PRODUCTION = False

def finish(o,name,slot):
    o.name=name; o.data.materials.append(M[slot]); o['avatar_slot']=slot; o['concept']=active.name
    for c in list(o.users_collection): c.objects.unlink(o)
    active.objects.link(o)
    if o.type=='MESH':
        for p in o.data.polygons:p.use_smooth=True
    return o

def ball(name,pos,scale,slot):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16 if PRODUCTION else 32,ring_count=10 if PRODUCTION else 20,radius=1,location=pos)
    o=finish(bpy.context.object,name,slot); o.scale=scale; return o

def box(name,pos,scale,slot,bevel=.004):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos); o=finish(bpy.context.object,name,slot); o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Rounded edges','BEVEL'); b.width=bevel;b.segments=2 if PRODUCTION else 4
    n=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');n.keep_sharp=True
    return o

def rod(name,a,b,r,slot,r2=None):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=16 if PRODUCTION else 32,radius1=r,radius2=r if r2 is None else r2,depth=(b-a).length,location=(a+b)/2)
    o=finish(bpy.context.object,name,slot);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    be=o.modifiers.new('Soft edge','BEVEL');be.width=min(r*.14,.002);be.segments=2 if PRODUCTION else 3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL'); return o

def curve(name,pts,r,slot):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.resolution_u=3 if PRODUCTION else 16;d.bevel_depth=r;d.bevel_resolution=1 if PRODUCTION else 3
    sp=d.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
    for b,p in zip(sp.bezier_points,pts):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,d);active.objects.link(o);o.data.materials.append(M[slot]);return o

def rings(name,profiles,slot,n=48,fold=0):
    if PRODUCTION: n=16
    verts=[]
    for z,rx,ry in profiles:
        for i in range(n):
            t=2*math.pi*i/n;f=1+fold*math.cos(t*8)
            verts.append((rx*math.cos(t)*f,ry*math.sin(t)*f,z))
    faces=[]
    for j in range(len(profiles)-1):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.extend([tuple(reversed(range(n))),tuple((len(profiles)-1)*n+i for i in range(n))])
    d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);finish(o,name,slot)
    s=o.modifiers.new('Tailored smooth surface','SUBSURF');s.levels=1 if PRODUCTION else 2;s.render_levels=s.levels
    return o

def panel(name,pts,slot):
    d=bpy.data.meshes.new(name);d.from_pydata(pts,[],[tuple(range(len(pts)))]);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);finish(o,name,slot)
    s=o.modifiers.new('Fabric thickness','SOLIDIFY');s.thickness=.0015
    b=o.modifiers.new('Soft fabric edge','BEVEL');b.width=.001;b.segments=3
    return o

def character(index):
    global active
    titles=['01 - Vertrouwd en zacht','02 - Slanke reiziger','03 - Ambachtelijk karakter']
    active=bpy.data.collections.new(titles[index]);bpy.context.scene.collection.children.link(active)
    slim=[1,.84,.91][index]; leg=[0,.033,.016][index]; bodyTop=.296+leg
    headZ=.374+leg; hx=[.072,.064,.068][index]; hz=[.077,.073,.075][index]
    # Soft leather boots, rounded toes and a visible sole.
    for s,side in [(-1,'Left'),(1,'Right')]:
        x=s*.047*slim
        box(side+' sole',(x,-.018,.009),(.071*slim,.108,.018),'sole',.009)
        box(side+' boot',(x,-.018,.033),(.072*slim,.106,.055),'leather',.018)
        rod(side+' boot shaft',(x,.002,.032),(x,.002,.083),.031*slim,'leather',.031*slim)
        rod(side+' trouser leg',(x,0,.065),(x,0,.164+leg),.023*slim,'trousers',.029*slim)
        curve(side+' toe seam',[(x-.025*slim,-.048,.051),(x,-.059,.058),(x+.025*slim,-.048,.051)],.0007,'pack')
        # Sleeve and forearm meet at the cuff, with hands slightly turned inward.
        shoulder=(s*.080*slim,0,bodyTop-.027);elbow=(s*.111*slim,-.004,.226+leg);wrist=(s*.119*slim,-.010,.192+leg)
        sleeve=rings(side+' continuous sleeve',[(.194+leg,.022,.025),(.198+leg,.024,.027),(.224+leg,.028,.031),(.251+leg,.033,.036),(.274+leg,.033,.035),(.289+leg,.023,.026),(.296+leg,.008,.010)],'shirt')
        for v in sleeve.data.vertices:
            t=max(0,min(1,(v.co.z-(.194+leg))/.102))
            v.co.x+=s*(.119-.039*t)*slim
            v.co.y-=.009*(1-t)
        rod(side+' turned cuff',(s*.118*slim,-.010,.196+leg),(s*.116*slim,-.009,.211+leg),.024,'collar')
        ball(side+' hand',(s*.120*slim,-.012,.179+leg),(.020,.022,.026),'skin')
        ball(side+' thumb',(s*.104*slim,-.026,.184+leg),(.008,.010,.015),'skin')
    rings('Tailored linen tunic',[(.123+leg,.078*slim,.055),(.126+leg,.082*slim,.059),(.158+leg,.087*slim,.061),(.193+leg,.082*slim,.057),(.245+leg,.083*slim,.056),(.274+leg,.074*slim,.048),(bodyTop,.046,.031),(bodyTop+.002,.038,.028)],'shirt',fold=.007 if index==0 else .014)
    rings('Leather waist belt',[(.183+leg,.084*slim,.059),(.185+leg,.085*slim,.060),(.196+leg,.084*slim,.059),(.198+leg,.083*slim,.058)],'leather')
    box('Buckle',(0,-.062,.191+leg),(.023,.006,.019),'metal',.002)
    box('Buckle inset',(0,-.066,.191+leg),(.014,.002,.010),'leather',.001)
    rod('Neck',(0,0,.282+leg),(0,0,.326+leg),.024,'skin')
    for s in [-1,1]:
        panel('Folded collar',[(s*.004,-.031,bodyTop+.006),(s*.032,-.025,bodyTop+.003),(s*.039,-.049,bodyTop-.020),(s*.018,-.057,bodyTop-.032)],'collar')
    curve('Shirt placket',[(0,-.049,bodyTop-.023),(0,-.057,.245+leg),(0,-.059,.211+leg)],.0015,'collar')
    for z in [.253,.234,.216]:ball('Horn button',(0,-.059,z+leg),(.0025,.0015,.0025),'pack')
    # One continuous head surface prevents the old overlapping face-shell seam.
    ball('Head',(0,-.001,headZ),(hx,.063,hz),'skin')
    ball('Hair back',(0,.017,headZ+.026),(hx*1.01,.059,.055),'hair')
    # Face features stay small and soft; the original black bead eyes are reduced.
    for s,side in [(-1,'Left'),(1,'Right')]:
        ball(side+' ear',(s*hx*.98,-.001,headZ-.005),(.011,.014,.019),'skin')
        ball(side+' ear inset',(s*hx*1.04,-.010,headZ-.005),(.004,.004,.010),'mouth')
        ball(side+' side lock',(s*hx*.89,-.027,headZ+.020),(.008,.018,.024),'hair')
        ex=s*hx*.34
        ball(side+' eye',(ex,-.061,headZ+.013),(.0043,.003,.0055),'eye')
        curve(side+' brow',[(ex-s*.009,-.058,headZ+.029),(ex,-.060,headZ+.031),(ex+s*.008,-.057,headZ+.029)],.0017,'hair')
    ball('Nose bridge',(0,-.061,headZ+.002),(.009,.009,.017),'skin')
    ball('Nose tip',(0,-.069,headZ-.006),(.011,.011,.010),'skin')
    curve('Quiet smile',[(-.013,-.059,headZ-.028),(0,-.063,headZ-.030),(.013,-.059,headZ-.027)],.0011,'mouth')
    # Rounded canvas pack and continuous leather shoulder straps.
    box('Backpack',(0,.073,.232+leg),(.124*slim,.068,.125),'pack',.015)
    box('Backpack flap',(0,.110,.274+leg),(.129*slim,.014,.039),'leather',.006)
    for s in [-1,1]:
        x=s*.048*slim
        curve('Shoulder strap',[(x,-.055,.196+leg),(x,-.056,.253+leg),(x,-.024,.287+leg),(x,.028,.292+leg),(x,.095,.264+leg)],.0055,'leather')
        box('Strap adjuster',(x,-.063,.244+leg),(.012,.004,.015),'metal',.0015)
        curve('Pack buckle strap',[(x,.119,.281+leg),(x,.117,.253+leg),(x,.110,.211+leg)],.004,'leather')
    rod('Rolled blanket',(-.078,.076,.309+leg),(.078,.076,.309+leg),.027,'blanket')
    for x in [-.049,.049]:rod('Blanket tie',(x-.004,.076,.309+leg),(x+.004,.076,.309+leg),.028,'leather')
    # End spiral gives the bedroll an actual rolled fabric section.
    pts=[]
    samples=20 if PRODUCTION else 70
    for i in range(samples):
        t=i/(samples-1)*math.pi*4;r=.002+.021*i/(samples-1);pts.append((.079,.076+math.cos(t)*r,.309+leg+math.sin(t)*r))
    curve('Blanket roll spiral',pts,.001,'collar')
    hatZ=headZ+hz*.76
    radius=[.117,.108,.117][index]
    n=32 if PRODUCTION else 96;verts=[];faces=[]
    for j,rr in enumerate([.061,.070,radius-.007,radius,radius-.001]):
        for i in range(n):
            t=2*math.pi*i/n
            lift=(rr/radius)**3 * ([.002,.007,.010][index]*math.cos(t*2)+.002*math.sin(t))
            verts.append((rr*math.cos(t),rr*.92*math.sin(t),hatZ+lift-(.003 if j==4 else 0)))
    for j in range(4):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    d=bpy.data.meshes.new('Curved brim');d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new('Soft straw brim',d);bpy.context.collection.objects.link(o);finish(o,'Soft straw brim','hat')
    so=o.modifiers.new('Brim thickness','SOLIDIFY');so.thickness=.002
    su=o.modifiers.new('Smooth brim','SUBSURF');su.levels=0 if PRODUCTION else 2
    rings('Rounded straw crown',[(hatZ-.001,.070,.064),(hatZ+.004,.070,.064),(hatZ+.034,.060,.055),(hatZ+.045,.055,.050),(hatZ+.049,.040,.038),(hatZ+.050,.001,.001)],'hat')
    rings('Hat ribbon',[(hatZ+.006,.0705,.0645),(hatZ+.007,.0705,.0645),(hatZ+.017,.0675,.0618),(hatZ+.018,.0675,.0618)],'leather')
    if index==2:
        # More hand-crafted clothing while keeping the original traveller palette.
        for s in [-1,1]:
            vv=[]; ff=[]; edge=[]
            for j in range(9):
                v=j/8
                for k in range(13):
                    u=k/12; angle=math.radians(21+53*u)
                    z=.205+leg+v*(.080-.013*u)
                    h=z-leg
                    profile=[(.193,.082,.057),(.245,.083,.056),(.274,.074,.048),(.296,.046,.031)]
                    for (za,xa,ya),(zb,xb,yb) in zip(profile,profile[1:]):
                        if za<=h<=zb:
                            f=(h-za)/(zb-za);rx=(xa+(xb-xa)*f)*slim+.004;ry=ya+(yb-ya)*f+.004;break
                    pos=(s*math.sin(angle)*rx,-math.cos(angle)*ry,z)
                    vv.append(pos)
                    if k==0:edge.append((pos[0],pos[1]-.001,pos[2]))
            for j in range(8):
                for k in range(12):ff.append((j*13+k,j*13+k+1,(j+1)*13+k+1,(j+1)*13+k))
            d=bpy.data.meshes.new('Fitted waistcoat');d.from_pydata(vv,[],ff);d.update()
            o=bpy.data.objects.new('Fitted waistcoat',d);bpy.context.collection.objects.link(o);finish(o,'Fitted waistcoat','blanket')
            so=o.modifiers.new('Fabric thickness','SOLIDIFY');so.thickness=.0015
            su=o.modifiers.new('Soft tailoring','SUBSURF');su.levels=0 if PRODUCTION else 2
            curve('Waistcoat piping',edge,.001,'pack')
        box('Belt pouch',(.068,-.038,.156+leg),(.038,.031,.043),'leather',.008)
        box('Pouch flap',(.068,-.055,.168+leg),(.039,.006,.016),'pack',.003)
        ball('Pouch stud',(.068,-.059,.166+leg),(.0025,.0015,.0025),'metal')

    # Presentation turn, identical for all concepts.
    root=bpy.data.objects.new('Character root',None);active.objects.link(root)
    for o in list(active.objects):
        if o!=root:o.parent=root
    root.rotation_euler.z=math.radians(-17)
    return active,root

def main():
    characters=[character(i) for i in range(3)]
    scene=bpy.context.scene
    studio=bpy.data.collections.new('Studio');scene.collection.children.link(studio)
    def studio_link(o):
        for c in list(o.users_collection):c.objects.unlink(o)
        studio.objects.link(o)
    def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002));o=bpy.context.object;o.name='Sage studio floor';studio_link(o);o.data.materials.append(mat('Studio sage','6C7B75',.95))
    bpy.ops.object.camera_add(location=(0,-1.6,.88));camera=bpy.context.object;studio_link(camera);aim(camera,(0,0,.255));camera.data.type='ORTHO';camera.data.ortho_scale=.66;scene.camera=camera
    for name,loc,energy,size in [('Key',(-1,-1.5,2),95,1.7),('Fill',(1,-.5,1),35,1.4),('Rim',(.3,1,1.7),115,1.2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.name=name;studio_link(l);l.data.energy=energy;l.data.shape='DISK';l.data.size=size;aim(l,(0,0,.26))
    scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
    scene.render.resolution_x=1000;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.world.color=(.22,.22,.22);scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
    scene['notes']='Three concept studies, original traveller wardrobe, smooth surfaces. Not exported to the live island.'
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
    # Each blend contains its own editable concept and the same studio.
    for i,(col,root) in enumerate(characters):
        for j,(other,_) in enumerate(characters):other.hide_render=j!=i;other.hide_viewport=j!=i
        scene.render.filepath=str(OUT/f'variant-{i+1}.png')
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'variant-{i+1}.blend'))
        bpy.ops.render.render(write_still=True)
        print('CONCEPT_RENDER_COMPLETE',i+1,flush=True)
    # A single real Blender render places all three under identical lighting.
    for i,(col,root) in enumerate(characters):col.hide_render=False;col.hide_viewport=False;root.location.x=(i-1)*.43
    camera.location=(0,-2.7,1.05);aim(camera,(0,0,.26));camera.data.ortho_scale=1.43
    scene.render.resolution_x=2100;scene.render.resolution_y=1000
    scene.render.filepath=str(OUT/'comparison.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'three-travellers.blend'))
    bpy.ops.render.render(write_still=True)
    print('ALL_CONCEPTS_COMPLETE',flush=True)
    
    
    

if __name__ == "__main__":
    main()
