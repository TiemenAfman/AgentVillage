"""Model the hamlet walls: recessed bonds, weathered blocks and chamfered coping.

Run: node scripts/blender.mjs --background --python scripts/build-wall.py
A one-cell bay stays within 120 triangles and the existing boundary footprint.
"""
import bpy
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/wall'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# The two greys the swept wall was shaded between, to the digit: 0x8a857c at the footing
# and 0x9a958c at the top. Keeping them is what makes this wall replace that one rather
# than stand next to it looking like different stone - and the split is now on the
# material, where the coping is the course the weather gets at and the body is the one it
# does not.
COLORS = {
    'stone:wall': 0x8a857c,
    'plain:coping': 0xafa48e,
    'stone:warm': 0x9b907b,
    'stone:pale': 0xa49b89,
    'stone:shade': 0x827e70,
    'plain:joint': 0x716e60,
}
materials = {}
for name, hex in COLORS.items():
    m = bpy.data.materials.new(name)
    rgb = [((hex >> s) & 255) / 255 for s in [16, 8, 0]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .95
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated. A negative factor
    turns every face inside out, and with no normals exported that is a black wall."""
    return (s[0], s[2], s[1])


def asset(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def adopt(name, mat, coll):
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def stone(name, mat, coll, at, size):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(at))
    o = adopt(name, mat, coll)
    o.scale = scale_xyz(size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

def coping(name, coll, at, width, height, depth):
    # Only the upper longitudinal edges are bevelled: six profile corners give
    # readable highlights for 20 triangles, rather than beveling every hidden edge.
    w=width/2
    profile=[(-w,0),(w,0),(w,height*.65),(w-.028,height),(-w+.028,height),(-w,height*.65)]
    verts=[xyz((x+at[0],y+at[1],z+at[2])) for z in [-depth/2,depth/2] for x,y in profile]
    faces=[tuple(reversed(range(6))),tuple(range(6,12))]
    for i in range(6):
        j=(i+1)%6
        faces.append((i,j,j+6,i+6))
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active=o
    adopt(name,'plain:coping',coll)
    return o


WALL_H=.54
WALL_T=.45
PIER_H=.66
for name,flip in [('prop_wall_a',False),('prop_wall_b',True)]:
    coll=asset(name)
    # The dark inner core closes the narrow recessed joints; it never protrudes
    # through the faces. Individual stones supply the relief and colour variation.
    stone(name+' joint core','plain:joint',coll,(0,.205,0),(.35,.41,1.01))
    courses=[(0,.205,[-.5,-.18,.17,.5]),(.202,.21,[-.5,.025,.5])]
    tones=['stone:warm','stone:pale','stone:wall','stone:shade','stone:pale']
    n=0
    for row,(y,h,bounds) in enumerate(courses):
        for a,b in zip(bounds,bounds[1:]):
            z=(a+b)/2*(-1 if flip else 1)
            width=WALL_T-(.025 if row else 0)-(.010 if n%2 else 0)
            o=stone(f'{name} course {row} block {n}',tones[(n+(2 if flip else 0))%len(tones)],coll,
                    (0,y+h/2,z),(width,h,(b-a)-.009))
            # Uneven top corners interrupt the ruler-straight silhouette of a cube
            # without extra triangles, while the bottom course stays on the ground.
            for v in o.data.vertices:
                if v.co.z>0:
                    v.co.x*=.96 if n%2 else .985
                    v.co.z-=.006 if v.co.y>0 and n%2 else 0
            n+=1
    for i,z in enumerate([-.25,.25]):
        coping(f'{name} coping {i}',coll,(0,.414,z),.465,.126-(.012 if i==int(flip) else 0),.494)

pier=asset('prop_wallpier')
stone('prop_wallpier recessed shaft','plain:joint',pier,(0,.29,0),(.37,.58,.35))
for i in range(3):
    stone(f'prop_wallpier block {i}', ['stone:warm','stone:pale','stone:wall'][i],pier,
          (0,.095+i*.169,0),(.425-i*.012,.161,.40-i*.008))
coping('prop_wallpier foot',pier,(0,0,0),.47,.065,.44)
coping('prop_wallpier cap',pier,(0,.555,0),.51,.105,.48)

# The tallest thing in the set, which is the pier rather than the wall it ends. hamlets.js
# scales the whole set by the bay's own WALL_H, so the pier keeps standing proud of the
# run whatever standing the hamlet has.
bpy.context.scene['building_height'] = PIER_H

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Everything is stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on. Solo one collection in
# the outliner, or read the PNGs scripts/preview-model.py writes.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -.001))
floor = bpy.context.object
floor.name = 'Studio floor'
mat = bpy.data.materials.new('Studio')
mat.diffuse_color = (.21, .25, .20, 1)
floor.data.materials.append(mat)


def aim(o, p):
    from mathutils import Vector
    o.rotation_euler = (Vector(p) - o.location).to_track_quat('-Z', 'Y').to_euler()


bpy.ops.object.camera_add(location=(1.0, -1.25, .84))
cam = bpy.context.object
aim(cam, (0, 0, .2))
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.55
bpy.context.scene.camera = cam
for loc, power, size in [((-1.3, -1.9, 2.2), 150, 2.0), ((1.6, -.6, 1.3), 60, 1.6), ((0, 1.4, 1.6), 100, 1.3)]:
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.size = size
    aim(o, (0, 0, .2))

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-wall.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'wall'})
