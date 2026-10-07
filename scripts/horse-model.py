"""The horse's closed surfaces and editable armature, called by build-fauna.py.

Coordinates and material helpers are passed in by that builder. All deformation is authored
here; the page receives ordinary baked triangles, weights and the same rest-bone positions.
"""
import json
import bmesh

a = collection('fauna_horse')
bones = []


def joint(name, point, parent):
    bones.append(dict(name=name, at=list(point), parent=parent))
    return len(bones) - 1


joint('body', (0, .39, 0), -1)
joint('neck', (0, .435, .16), 0)
joint('head', (0, .605, .285), 1)
joint('tail', (0, .424, -.246), 0)
joint('tailTip', (0, .26, -.305), 3)
legs = []
for key, sx, front in [('fl', -1, True), ('fr', 1, True), ('bl', -1, False), ('br', 1, False)]:
    x, z = sx * .061, .163 if front else -.183
    root = joint(key + ':upper', (x, .35, z), 0)
    bend = joint(key + ':knee', (x, .191, z + (.005 if front else -.032)), root)
    end = joint(key + ':hoof', (x, .043, z + .012), bend)
    legs.append(dict(name=key, root=root, bend=bend, end=end, front=front, sole=.043))

rig = dict(bones=bones, legs=legs, neck=1, head=2, tail=3, tailTip=4)
parts = []


def smoothstep(a, b, v):
    t = max(0, min(1, (v-a)/(b-a)))
    return t*t*(3-2*t)


def finish(part, weight):
    obj = part.build()
    # Explicit outward winding: a closed shape with inward caps still disappears from one side.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    assert not any(e.is_boundary or not e.is_manifold for e in bm.edges), part.name + ' has an open edge'
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        # Keep the saddle, straps and tread crisp; anatomical surfaces are smooth.
        label = obj.data.materials[poly.material_index].name
        poly.use_smooth = not any(s in label for s in ['saddle', 'brass', 'pad', 'bridle'])
    groups = [obj.vertex_groups.new(name='horse:' + str(i)) for i in range(len(bones))]
    for v in obj.data.vertices:
        p = Vector((v.co.x, v.co.z, -v.co.y)) + part.origin
        for index, value in weight(p).items():
            if value > 0:
                groups[index].add([v.index], value, 'REPLACE')
    obj['skin_rig'] = 'horse'
    parts.append(obj)
    return obj


def oval(part, centre, size, mat, sides=12, bands=8):
    # Capped latitude rings without duplicated pole vertices (no degenerate triangles).
    cx, cy, cz = centre
    sx, sy, sz = size
    sections = []
    for k in range(1, bands):
        t = -math.pi/2 + math.pi*k/bands
        sections.append(((cx, cy+sy/2*math.sin(t), cz), (0, 1, 0), sx*math.cos(t), sz*math.cos(t)))
    pts = [p for c, d, w, h in sections for p in ring(c, d, w, h, sides)]
    faces = loft_faces(len(sections), sides, caps=False)
    bottom, top = len(pts), len(pts)+1
    pts += [Vector((cx, cy-sy/2, cz)), Vector((cx, cy+sy/2, cz))]
    for i in range(sides):
        faces += [[bottom, (i+1)%sides, i], [top, (len(sections)-1)*sides+i, (len(sections)-1)*sides+(i+1)%sides]]
    part.add(pts, faces, mat)


body = Part(a, 'body')
loft(body, [((0, y, z), (0, 0, 1), w, h) for z, y, w, h in [
    (-.275,.391,.07,.1),(-.245,.395,.15,.174),(-.2,.39,.188,.206),
    (-.14,.381,.197,.21),(-.075,.375,.194,.211),(0,.376,.184,.205),
    (.07,.386,.177,.21),(.13,.402,.172,.203),(.19,.417,.139,.181),(.235,.428,.084,.12)]], BAY, sides=16)
# Taper the back beneath the saddle so the rider's inner thighs clear the coat.
for p in body.verts:
    p.x *= 1 - .38 * smoothstep(.415, .452, p.y) * (1-smoothstep(.045,.12,abs(p.z)))
# The saddle still fits the same rider and keeps the existing seat/iron measurements.
saddle(body)
finish(body, lambda p: {0: 1})

head = Part(a, 'head', bones[1]['at'])
loft(head, along([(0,.385,.13),(0,.425,.165),(0,.458,.188),(0,.506,.224),(0,.553,.253),
                 (0,.595,.282),(0,.605,.311),(0,.59,.344),(0,.568,.377),(0,.54,.416)],
                [.145,.133,.128,.113,.092,.08,.079,.073,.062,.063],
                [.17,.178,.17,.147,.122,.112,.112,.103,.082,.07]), BAY, sides=14)
muzzle = material('horse muzzle', 0x594537)
loft(head, along([(0,.545,.402),(0,.532,.429),(0,.532,.45)], [.063,.074,.059], [.068,.06,.048]), muzzle, sides=12)
# Raised surfaces sit slightly inside the coat, so a side view never sees floating eyes/straps.
eye = material('horse eye', 0x17120f)
glint = material('horse eye glint', 0xc5b6a0)
bridle = material('horse bridle', 0x493025)
for side in [-1, 1]:
    oval(head, (side*.037,.604,.322), (.014,.018,.025), DARK)
    oval(head, (side*.042,.605,.325), (.007,.01,.014), eye)
    oval(head, (side*.045,.608,.33), (.002,.003,.003), glint, sides=8, bands=4)
    oval(head, (side*.03,.543,.44), (.006,.009,.014), DARK, sides=8, bands=6)
    loft(head, along([(side*.021,.64,.283),(side*.025,.668,.286),(side*.03,.689,.293)],
                    [.026,.017,.003], [.023,.015,.003]), BAY, sides=8)
    loft(head, along([(side*.023,.647,.296),(side*.028,.675,.297)], [.011,.002], [.003,.002]), muzzle, sides=6)
    loft(head, along([(side*.039,.626,.297),(side*.044,.596,.329),(side*.038,.551,.422)], [.005]*3), bridle, sides=6)
    oval(head, (side*.041,.552,.41), (.007,.011,.011), material('horse tack brass',0xc6a263), sides=8, bands=4)
# A tapered blaze lies on the front plane of the skull, not a floating rectangular strip.
loft(head, along([(0,.642,.318),(0,.619,.353),(0,.59,.394),(0,.557,.443)],
                [.012,.018,.014,.009], [.003]*4), BLAZE, sides=6)
# Closed mane tufts follow the crest, and overlap instead of leaving open-ended ribbons.
for i in range(7):
    t=i/6
    y,z=.472+.168*t,.153+.12*t
    loft(head, along([(0,y,z+.015),(0,y+.008,z-.008),(0,y-.025,z-.017)],
                    [.022,.026,.012],[.028,.022,.007]), DARK, sides=8)
loft(head, along([(0,.644,.292),(0,.651,.321),(0,.619,.355)], [.034,.026,.009],[.016,.014,.004]), DARK, sides=8)


def head_weights(p):
    neck = smoothstep(.432,.515,p.y)
    skull = smoothstep(.545,.604,p.y) if p.z < .325 else smoothstep(.29,.355,p.z)
    return {0: 1-neck, 1: neck*(1-skull), 2: neck*skull}


finish(head, head_weights)
tail = Part(a, 'tail', bones[3]['at'])
loft(tail, along([(0,.435,-.244),(0,.395,-.273),(0,.327,-.3),(.005,.239,-.31),(.007,.145,-.316),(.009,.12,-.306)],
                [.033,.047,.051,.049,.035,.01],[.035,.035,.037,.034,.024,.009]), DARK, sides=12)
finish(tail, lambda p: {3: 1-smoothstep(.34,.18,p.y), 4:smoothstep(.34,.18,p.y)})

for leg in legs:
    root, knee, foot = [Vector(bones[leg[k]]['at']) for k in ['root','bend','end']]
    part = Part(a, 'leg '+leg['name'], root)
    front = leg['front']
    # Extra rings around carpus/hock and fetlock deform without the old angular cut-outs.
    pts = [root+Vector((0,.045,0)),root,root.lerp(knee,.3),root.lerp(knee,.7),knee,
           knee.lerp(foot,.2),knee.lerp(foot,.6),foot+Vector((0,.018,0)),foot,foot+Vector((0,-.015,.012))]
    widths = [.075,.078,.065,.04,.036,.029,.024,.029,.035,.038] if front else [.09,.097,.076,.042,.037,.03,.025,.03,.035,.037]
    heights = [w*1.16 for w in widths]
    loft(part, along(pts, widths, heights), BAY, sides=12,
         paint=lambda p: SOCK if p.y < .136 else BAY)
    # A rounded wall, sloping toe and level sole; the hoof is weighted rigidly below the fetlock.
    z=foot.z+.012
    loft(part, [((root.x,y,z+dz),(0,1,0),w,h) for y,w,h,dz in [
        (0,.047,.06,.006),(.008,.052,.065,.006),(.031,.041,.046,0),(.039,.033,.034,-.003)]], HOOF, sides=12)

    def weights(p, leg=leg, root=root, knee=knee):
        hip = smoothstep(root.y+.035,root.y-.04,p.y)
        bend = smoothstep(knee.y+.045,knee.y-.04,p.y)
        hoof = smoothstep(.08,.045,p.y)
        return {0:1-hip,leg['root']:hip*(1-bend),leg['bend']:hip*bend*(1-hoof),leg['end']:hip*bend*hoof}

    finish(part, weights)

# The .blend has the same real bones and weights as the browser, available for posing.
armature = bpy.data.armatures.new('Horse armature')
arm = bpy.data.objects.new('Horse armature',armature)
a.objects.link(arm)
bpy.context.view_layer.objects.active=arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for i,b in enumerate(bones):
    eb=armature.edit_bones.new('horse:'+str(i))
    eb.head=xyz(b['at'])
    child=next((c for c in bones if c['parent']==i),None)
    eb.tail=xyz(child['at']) if child else eb.head+Vector((0,0,.025))
    if b['parent']>=0: eb.parent=armature.edit_bones['horse:'+str(b['parent'])]
bpy.ops.object.mode_set(mode='OBJECT')
arm.show_in_front=True
for obj in parts:
    mod=obj.modifiers.new('Horse joints','ARMATURE'); mod.object=arm
bpy.context.scene['skin_rigs']=json.dumps({'horse':rig})
