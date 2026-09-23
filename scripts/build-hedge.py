"""Author a full, overlapping hedgerow rather than a straight bar with a tufted lid.

Run: node scripts/blender.mjs --background --python scripts/build-hedge.py
Three rounded leaf masses and a concealed core fit within 120 triangles per bay.
"""
import bpy
import random
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/hedge'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

# Mature leaves, shaded hollows and new growth share the forest palette.
COLORS = {
    'foliage:hedge': 0x4a6b39,
    'foliage:hedge-mid': 0x527442,
    'foliage:hedge-shade': 0x496838,
    'foliage:hedge-new': 0x5d8347,
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
    shader.inputs['Roughness'].default_value = .93
    m['emissive'] = 0.0
    materials[name] = m


def xyz(p):
    return (p[0], -p[2], p[1])


def scale_xyz(s):
    """A scale is not a position: the axes swap but nothing is negated.

    Running a scale through xyz() would hand Blender a negative factor, which turns every
    face inside out - and since the exporter writes no normals, an inside out hedge is
    not a wrong-looking hedge but a black one.
    """
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


# The renderer scales every bay from these dimensions, so changing the shape
# does not change the boundary line or the width of a gateway.
HEDGE_H = .50
HEDGE_T = .34


def bay(name, seed):
    coll=asset(name)
    rnd=random.Random(seed)
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz((0,.13,0)))
    core=adopt(name+' shaded core','foliage:hedge-mid',coll)
    core.scale=scale_xyz((.19,.26,1.015))
    for i in range(3):
        x=rnd.uniform(-.015,.015)
        z=(i-1)*.35
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,location=xyz((x,.265,z)))
        o=adopt(f'{name} leaf mass {i}','foliage:hedge-mid',coll)
        # Decimating a finer sphere keeps a rounded crown; a twenty-face ico puts
        # a spike on every bush. The three 34-triangle clumps plus core cost 114.
        for v in o.data.vertices:
            v.co*=rnd.uniform(.96,1.04)
        dec=o.modifiers.new('Rounded low-poly growth','DECIMATE');dec.ratio=.425
        bpy.ops.object.modifier_apply(modifier=dec.name)
        o.scale=scale_xyz((.195,.25,.38))
        low=min(v.co.z for v in o.data.vertices)
        high=max(v.co.z for v in o.data.vertices)
        top=rnd.uniform(.48,.52)
        for v in o.data.vertices:
            t=(v.co.z-low)/(high-low)
            y=.015+max(0,(t-.18)/.82)*(top-.015)
            v.co.z=(y-.265)/o.scale.z
        o.data.materials.append(materials['foliage:hedge-new'])
        o.data.materials.append(materials['foliage:hedge-shade'])
        for p in o.data.polygons:
            h=sum(o.data.vertices[v].co.z for v in p.vertices)/len(p.vertices)
            p.material_index=1 if h>.35 else (2 if h<-.4 else 0)


bay('prop_hedge_a', 7)
bay('prop_hedge_b', 31)

# The tallest thing in the set. Only a building reads this; a boundary measures itself off
# BOUNDARY in web/js/hamlets.js.
bpy.context.scene['building_height'] = HEDGE_H + .02

# A studio to open the file in, excluded from the bake because nothing in it is a
# building_part. Both bays are stacked on the origin, because the exporter bakes an
# object's world origin as the point the island stands the part on - so a bay moved aside
# for elbow room in the .blend would be drawn to one side of the spot it was asked for.
# Solo one collection in the outliner, or read the PNGs scripts/preview-model.py writes.
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
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'agentvillage-hedge.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'hedge'})
