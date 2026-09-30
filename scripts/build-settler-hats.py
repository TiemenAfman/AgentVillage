"""Rounded, fitted player headwear in Blender coordinates (Z up, forward -Y)."""
import bpy
import math
from mathutils import Vector


def build_hats(materials):
    result = []
    variant = 'wide'

    def finish(obj, name, slot):
        obj.name = name
        obj.data.materials.clear()
        obj.data.materials.append(materials[slot])
        obj['avatar_slot'] = slot
        obj['avatar_variant'] = variant
        obj['avatar_group'] = 'head'
        if obj.type == 'MESH':
            for face in obj.data.polygons:
                face.use_smooth = True
        result.append(obj)
        return obj

    def mesh(name, vertices, faces, slot):
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        return finish(obj, name, slot)

    def crown(name, profiles, slot='hat', n=40):
        # Each ring can lean independently, giving fabric and tips a soft silhouette.
        vertices = []
        for z, rx, ry, cx, cy in profiles:
            for i in range(n):
                t = math.tau*i/n
                vertices.append((cx+rx*math.cos(t), cy+ry*math.sin(t), z))
        faces = []
        for j in range(len(profiles)-1):
            for i in range(n):
                k = (i+1) % n
                faces.append((j*n+i, j*n+k, (j+1)*n+k, (j+1)*n+i))
        faces.extend([tuple(reversed(range(n))), tuple((len(profiles)-1)*n+i for i in range(n))])
        return mesh(name, vertices, faces, slot)

    def band(name, z, rx, ry, height, slot='trim'):
        return crown(name, [(z,rx-.001,ry-.001,0,0),(z+.001,rx,ry,0,0),
            (z+height-.001,rx,ry,0,0),(z+height,rx-.001,ry-.001,0,0)],slot)

    def tube(name, points, radius, slot):
        data = bpy.data.curves.new(name, 'CURVE')
        data.dimensions = '3D'; data.resolution_u = 2
        data.bevel_depth = radius; data.bevel_resolution = 1
        spline = data.splines.new('BEZIER'); spline.bezier_points.add(len(points)-1)
        for point, co in zip(spline.bezier_points, points):
            point.co = co; point.handle_left_type = point.handle_right_type = 'AUTO'
        obj = bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
        finish(obj,name,slot)
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.convert(target='MESH')
        return obj

    def brim(name, z, rx, ry, wave=.004, slot='hat'):
        n=48; vertices=[]
        # Closed ribbon section: round the edge without a heavy cylindrical slab.
        for r, dz in [(.60,0),(.87,0),(.985,-.0004),(1,-.0016),(.985,-.0028),(.87,-.003),(.60,-.003)]:
            for i in range(n):
                t=math.tau*i/n
                lift=wave*math.cos(2*t)*(r**3)+.0015*math.sin(t)*r*r
                vertices.append((rx*r*math.cos(t),ry*r*math.sin(t),z+lift+dz))
        faces=[]
        for j in range(6):
            for i in range(n):
                k=(i+1)%n
                # Outer radial direction first keeps top normals facing outwards.
                faces.append((j*n+i,(j+1)*n+i,(j+1)*n+k,j*n+k))
        return mesh(name,vertices,faces,slot)

    def visor(name,z,width,reach,slot):
        n=24; vertices=[]
        for r,dz in [(0,0),(.65,-.002),(1,-.005),(1,-.008),(.65,-.005),(0,-.003)]:
            for i in range(n+1):
                t=-math.pi*.43 + math.pi*.86*i/n
                x=math.sin(t)*width
                y=-.038-math.cos(t)*(.020+r*reach)
                vertices.append((x,y,z+dz-.004*(x/width)**2))
        faces=[]
        for j in range(5):
            for i in range(n):
                a=j*(n+1)+i; faces.append((a,a+n+1,a+n+2,a+1))
        return mesh(name,vertices,faces,slot)

    def bead(name,location,scale,slot):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=location)
        obj=finish(bpy.context.object,name,slot);obj.scale=scale
        return obj

    # Straw: slightly swept brim, a rounded crown and a narrow leather ribbon.
    brim('Straw swept brim',.430,.111,.104,.006)
    crown('Straw soft crown',[(.429,.067,.062,0,0),(.435,.068,.063,0,0),(.449,.065,.060,0,.001),
        (.464,.060,.056,-.001,.002),(.474,.052,.049,-.002,.003),(.479,.036,.034,-.002,.003),(.480,.001,.001,-.002,.003)])
    band('Straw leather ribbon',.435,.0688,.064,.009)
    tube('Straw ribbon knot',[(-.065,.002,.439),(-.071,.012,.440),(-.068,.020,.440)],.0025,'trim')

    variant='band'
    band('Woven headband',.410,.071,.065,.015,'hat')
    bead('Headband knot',(.065,.018,.419),(.010,.009,.008),'hat')
    tube('Headband long tail',[(.068,.023,.416),(.073,.031,.403),(.070,.035,.389)],.0038,'hat')
    tube('Headband short tail',[(.067,.022,.416),(.079,.027,.409),(.082,.028,.400)],.0032,'hat')

    variant='cap'
    band('Flat cap welt',.421,.069,.064,.007)
    visor('Flat cap curved peak',.425,.065,.034,'hat')
    crown('Flat cap cloth crown',[(.425,.069,.065,0,-.001),(.434,.075,.068,0,-.002),
        (.446,.073,.065,0,0),(.456,.061,.055,0,.005),(.465,.041,.039,0,.012),(.468,.001,.001,0,.017)])
    tube('Flat cap centre seam',[(0,-.065,.431),(0,-.053,.449),(0,-.028,.464),(0,.017,.468),(0,.048,.450)],.0006,'trim')

    variant='sailor'
    band('Sailor fitted band',.418,.071,.065,.012)
    visor('Sailor curved peak',.423,.062,.026,'trim')
    crown('Sailor soft crown',[(.429,.071,.065,0,0),(.433,.082,.074,0,.001),(.442,.085,.076,0,.002),
        (.451,.079,.070,0,.002),(.458,.061,.055,0,.002),(.461,.034,.031,0,.002),(.462,.001,.001,0,.002)])
    bead('Sailor brass badge',(0,-.066,.424),(.006,.002,.006),'brass')

    variant='dome'
    crown('Wool knitted crown',[(.421,.072,.066,0,0),(.434,.074,.068,0,0),(.449,.067,.062,-.001,.002),
        (.462,.053,.050,-.004,.004),(.471,.034,.033,-.008,.006),(.474,.001,.001,-.011,.007)])
    band('Wool folded cuff',.415,.075,.069,.018,'hat')
    # Fine ribs belong to the cuff; no large contrasting piping across the head.
    for i in range(16):
        t=math.tau*i/16
        tube('Wool cuff rib',[(.0752*math.cos(t),.0692*math.sin(t),.419),
            (.0757*math.cos(t),.0697*math.sin(t),.424),(.0752*math.cos(t),.0692*math.sin(t),.430)],.00055,'hat')

    variant='wizard'
    brim('Pointed soft brim',.428,.099,.089,.003)
    crown('Pointed bent crown',[(.428,.068,.063,0,0),(.438,.066,.061,0,0),(.454,.052,.049,.002,.002),
        (.469,.035,.033,.007,.004),(.480,.019,.018,.016,.007),(.485,.008,.008,.027,.009),(.482,.001,.001,.036,.010)])
    band('Pointed leather band',.433,.067,.062,.006)

    variant='helmet'
    crown('Helmet forged dome',[(.418,.073,.068,0,0),(.430,.073,.068,0,0),(.447,.065,.061,0,.001),
        (.462,.052,.049,0,.001),(.472,.033,.031,0,.001),(.477,.001,.001,0,.001)],'steel')
    band('Helmet rolled rim',.415,.075,.070,.009,'brass')
    tube('Helmet centre ridge',[(0,-.067,.428),(0,-.055,.454),(0,-.028,.472),(0,.001,.478),(0,.031,.470),(0,.060,.448)],.0018,'steel')
    # A tapered nose guard with rounded ends, kept clear of eyes and nose.
    tube('Helmet nose guard',[(0,-.071,.421),(0,-.074,.408),(0,-.077,.391)],.0035,'steel')
    for sign in [-1,1]:
        bead('Helmet rim rivet',(sign*.049,-.052,.419),(.0024,.0018,.0024),'brass')
    return result
