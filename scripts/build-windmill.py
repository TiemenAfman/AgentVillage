"""Author the Dutch thatched mill and its separate rotating sail cross.

Run with node scripts/blender.mjs --background --python scripts/build-windmill.py.
The sails stand on y=0 for the asset contract; their hub is y=1.05, which the
viewer subtracts before turning them. The studio copy shows the assembled mill.
"""
import bpy
import math
import runpy
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/windmill'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

COLORS = {'stone:brick': 0x98684f, 'stone:foot': 0x716b60,
          'plain:reed': 0x9d8054, 'plain:reed-light': 0xb69a67,
          'plain:reed-dark': 0x806744, 'plank:green': 0x315a47,
          'plank:dark': 0x493c2d, 'plain:cream': 0xe6ddc4,
          'plain:glass': 0x425657, 'plain:canvas': 0xd8c9a5}
MATS = {}
for name, color in COLORS.items():
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    MATS[name] = m

def xyz(p):
    return (p[0], -p[2], p[1])

def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

body = collection('civic_windmill')
sails = collection('civic_windmill_sails')

def adopt(o, name, mat, coll=body):
    o.name = coll.name + ' ' + name
    o.data.materials.append(MATS[mat])
    o['building_part'] = True
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)
    return o

def box(name, p, size, mat, coll=body):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = adopt(bpy.context.object, name, mat, coll)
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

def rod(name, a, b, r, mat, sides=4, top=None, coll=body):
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r,
        radius2=r if top is None else top, depth=(b-a).length, location=(a+b)/2)
    o = adopt(bpy.context.object, name, mat, coll)
    o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return o

def shell(name, rings, mat, segments=8, reeds=False):
    # Flat octagonal faces and fine broken reed streaks give thatch its own surface;
    # the roof sheet is deliberately absent because it would stamp tiles onto straw.
    vertices = []
    for y, r in rings:
        vertices += [xyz((r*math.sin((i+.5)*2*math.pi/segments), y,
                          r*math.cos((i+.5)*2*math.pi/segments))) for i in range(segments)]
    faces = [tuple(reversed(range(segments)))]
    for j in range(len(rings)-1):
        for i in range(segments):
            faces.append((j*segments+i, j*segments+(i+1)%segments,
                         (j+1)*segments+(i+1)%segments, (j+1)*segments+i))
    faces.append(tuple((len(rings)-1)*segments+i for i in range(segments)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    o = bpy.data.objects.new(name, mesh)
    body.objects.link(o)
    adopt(o, name, mat)
    if reeds:
        streaks, strips = [], []
        for j in range(len(rings)-1):
            y0, r0 = rings[j]; y1, r1 = rings[j+1]
            for i in range(segments):
                a, b = (i+.5)*2*math.pi/segments, (i+1.5)*2*math.pi/segments
                for k in range(7):
                    t = (k+.5)/7
                    dx = (1-t)*math.sin(a)+t*math.sin(b)
                    dz = (1-t)*math.cos(a)+t*math.cos(b)
                    start = len(streaks)
                    for f, shift in [(0.08, -.004), (.88, -.002), (.88, .002), (.08, .004)]:
                        r = r0+(r1-r0)*f+.002
                        streaks.append(xyz((dx*r+shift*math.cos(a), y0+(y1-y0)*f,
                                           dz*r-shift*math.sin(a))))
                    strips.append(tuple(range(start, start+4)))
        m = bpy.data.meshes.new(name+' reed streaks'); m.from_pydata(streaks, [], strips)
        o = bpy.data.objects.new(name+' reed streaks', m); body.objects.link(o)
        adopt(o, name+' reed streaks', 'plain:reed-light')

shell('brick footing', [(0,.49),(.12,.49),(.46,.44)], 'stone:brick')
shell('stone skirt', [(0,.51),(.06,.51)], 'stone:foot')
shell('thatched octagon', [(.44,.465),(1.40,.32)], 'plain:reed', reeds=True)
shell('cap curb', [(1.39,.345),(1.46,.345)], 'plank:green')
shell('rounded thatched cap', [(1.46,.40),(1.66,.36),(1.83,.23),(1.88,.07)],
      'plain:reed', segments=12, reeds=True)
box('ridge', (0,1.89,0), (.10,.045,.30), 'plank:dark')
box('door surround', (0,.225,.442), (.25,.43,.045), 'plain:cream')
box('green door', (0,.213,.47), (.195,.405,.025), 'plank:green')
box('door latch', (.058,.21,.488), (.04,.015,.015), 'plank:dark')
for x in [-.37,.37]:
    o = box('window frame', (x,.82,.05), (.035,.24,.18), 'plain:cream')
    box('window glass', (x*1.045,.82,.05), (.012,.19,.13), 'plain:glass')
    box('window crossbar', (x*1.066,.82,.05), (.014,.018,.14), 'plain:cream')
box('green breast', (0,1.57,.346), (.38,.23,.055), 'plank:green')
box('breast trim', (0,1.46,.38), (.43,.035,.04), 'plain:cream')
rod('windshaft', (0,1.61,.27), (0,1.61,.64), .058, 'plank:dark', sides=8)
# The tail is behind the mill, clear of both the door and the entire sail disc.
for x in [-.27,.27]:
    rod('tail brace', (x,1.45,-.20), (0,.20,-.80), .022, 'plank:green')
rod('tail pole', (0,1.67,-.28), (0,.16,-.82), .026, 'plank:dark')
rod('tail crossbar', (-.18,.23,-.78), (.18,.23,-.78), .025, 'plank:green')

# Four handed lattice sails. Only the inner strip is clothed, so daylight remains
# visible through the outer lattice even at the island's normal camera distance.
for i in range(4):
    angle = i*math.pi/2
    def sailbox(name, x, y, w, h, d, mat, z=0):
        o = box(name, (x*math.cos(angle)-y*math.sin(angle),
                      1.05+x*math.sin(angle)+y*math.cos(angle), z), (w,h,d), mat, sails)
        o.rotation_euler.y = angle
    sailbox('stock', 0,.525,.034,1.05,.038,'plank:dark')
    for x in [.075,.17]:
        sailbox('lattice rail', x,.68,.012,.72,.022,'plank:green')
    for j in range(9):
        sailbox('lattice rung', .087,.33+j*.086,.20,.013,.026,'plain:cream')
    sailbox('sailcloth', .043,.71,.063,.61,.009,'plain:canvas', -.019)
rod('sail hub', (0,1.05,-.04), (0,1.05,.055), .075, 'plank:dark', sides=8, coll=sails)

scene = bpy.context.scene
scene['building_height'] = 2.68
bpy.context.preferences.filepaths.save_version = 0
# In Blender the authored sails stay at their bake origin, hidden in the viewport.
# A non-exported linked copy is assembled on the shaft for inspecting the whole mill.
sails.hide_render = True
studio = collection('Assembled sails (preview only)')
for original in list(sails.objects):
    o = original.copy(); o.data = original.data; studio.objects.link(o)
    o['building_part'] = False
    o.location += Vector(xyz((0,.56,.64)))
    original.hide_set(True)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'windmill.blend'))
runpy.run_path(str(ROOT/'scripts/export-models.py'), init_globals={'MODEL_SET':'windmill'})

# Use the same workbench settings as the standard asset thumbnails, but include
# the rotating assembly so visual review sees the silhouette that reaches the island.
sys.argv = ['preview-model.py', '--', 'windmill', 'civic_windmill']
preview = runpy.run_path(str(ROOT/'scripts/preview-model.py'), run_name='windmill_preview',
                        init_globals={})
bpy.ops.wm.open_mainfile(filepath=str(OUT/'windmill.blend'))
scene = bpy.context.scene
preview['workbench'](scene)
preview['frame'](scene, list(bpy.data.collections['civic_windmill'].objects)+
                 list(bpy.data.collections['Assembled sails (preview only)'].objects))
scene.render.filepath = str(OUT/'windmill-preview.png')
bpy.ops.render.render(write_still=True)
