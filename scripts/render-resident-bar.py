"""The residents against their bar: a resident (web/js/residents-mesh.js, ~2.5k triangles dressed) and the
Wanderer it was cut down from (web/js/bodies-mesh.js, the full Quaternius man and woman, ~25k), in the
same peasant clothes, the same colours, light and camera - rendered one at a time so a critic can be shown
the two blind, A and B in a shuffled order (Plans/inwoners-in-avonturierstijl.md, "De lat").

    node scripts/blender.mjs --background --python-exit-code 1 --python scripts/render-resident-bar.py -- <out dir> [seed]

Writes <out>/<sex>-<view>-A.png and -B.png per view, and <out>/key.json saying which is the resident. Views:
`village` is how the island mostly sees a resident (a few dozen units off, from above, small), `near` the
camera on foot beside one, `back` and `side` the same from behind and beside. Everything is built from the
exported arrays, at rest: what is rendered is what the island gets.
"""
import bpy
import json
import math
import random
import re
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(args[0]) if args else ROOT / 'assets/residents/renders/bar'
SEED = int(args[1]) if len(args) > 1 else 1
OUT.mkdir(parents=True, exist_ok=True)


def module(path, name):
    text = (ROOT / path).read_text(encoding='utf8')
    return json.loads(re.search(r'export const ' + name + r' = (.*);', text).group(1))


RESIDENTS = module('web/js/residents-mesh.js', 'RESIDENTS')
BODIES = module('web/js/bodies-mesh.js', 'BODIES')

# One look for both: the island's own swatches (shared/palette.mjs), linear.
def linear(hex_):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    return (ch((hex_ >> 16) & 255), ch((hex_ >> 8) & 255), ch(hex_ & 255))


SKIN, HAIR = linear(0xe0aa7c), linear(0x503a2d)
HAIRSTYLE = {'male': 'parted', 'female': 'buns'}
WORN = ['peasant-shirt', 'peasant-trousers', 'peasant-shoes']


def triangles(pos, cols, keep=None):
    """[(three corners, three colours)] of a part's arrays, the triangles in `keep` only."""
    out = []
    for t in range(len(pos) // 9):
        if keep is not None and t not in keep:
            continue
        out.append(([Vector(pos[t * 9 + k * 3:t * 9 + k * 3 + 3]) for k in range(3)],
                     [tuple(cols[t * 9 + k * 3:t * 9 + k * 3 + 3]) for k in range(3)]))
    return out


def wanderer(sex):
    """The Wanderer in the peasant's shirt, breeches and boots: the body's parts less what those hide,
    the garments as their corners are coloured, hair and skin tinted by the look."""
    tris = []
    for p in BODIES[sex]['parts']:
        v = p['variant']
        if v == 'body':
            hidden = set()
            for g in WORN:
                runs = p.get('hide', {}).get(g, [])      # [from, to, ...], `to` exclusive (avatar.js keptTriangles)
                for i in range(0, len(runs), 2):
                    hidden.update(range(runs[i], runs[i + 1]))
            keep = set(range(len(p['positions']) // 9)) - hidden
            tint = SKIN if p['slot'] in ('skin', 'underwear') else HAIR if p['slot'] == 'hair' else (1, 1, 1)
        elif v == 'hair:' + HAIRSTYLE[sex]:
            keep, tint = None, HAIR
        elif v.startswith('garment:') and v[8:] in WORN:
            keep, tint = None, (1, 1, 1)
        else:
            continue
        if not p.get('tint') and p['slot'] in ('skin', 'underwear', 'hair'):
            tint = (1, 1, 1) if p['slot'] == 'underwear' else tint
        for corners, cols in triangles(p['positions'], p['colors'], keep):
            tris.append((corners, [tuple(c[k] * tint[k] for k in range(3)) for c in cols]))
    return tris


def mean_colour(sex, garment):
    acc, n = [0, 0, 0], 0
    for p in BODIES[sex]['parts']:
        if p['variant'] == 'garment:' + garment:
            c = p['colors']
            for i in range(0, len(c), 3):
                for k in range(3):
                    acc[k] += c[i + k]
                n += 1
    return tuple(x / max(1, n) for x in acc)


def resident(sex):
    """The resident in the same clothes, each garment dyed the Wanderer's own mean colour."""
    show = 'trousers/shoes'
    dye = {'shirt': mean_colour(sex, 'peasant-shirt'), 'trousers': mean_colour(sex, 'peasant-trousers'),
           'shoes': mean_colour(sex, 'peasant-shoes')}
    tris = []
    for p in RESIDENTS[sex]['parts']:
        pid = p['id']
        if p['kind'] == 'skin':
            if show not in p['shows']:
                continue
            tint = SKIN
        elif pid == 'hair:' + HAIRSTYLE[sex]:
            tint = HAIR
        elif pid in dye:
            tint = dye[pid]
        else:
            continue
        trim = p.get('trim')
        for t, (corners, cols) in enumerate(triangles(p['positions'], p['colors'])):
            # A trim corner is the kit's own colour, not dyed (resident-skin.js residentTrim).
            keep = [trim[t * 3 + k] if trim else 0 for k in range(3)]
            tris.append((corners, [tuple(c[k] * (tint[k] + (1 - tint[k]) * w) for k in range(3))
                                   for c, w in zip(cols, keep)]))
    return tris


def build(tris, name):
    verts, faces = [], []
    for corners, _ in tris:
        n = len(verts)
        verts += [(c.x, -c.z, c.y) for c in corners]
        faces.append((n, n + 1, n + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for t, (_, cols) in enumerate(tris):
        for k in range(3):
            col.data[t * 3 + k].color = (*cols[k], 1)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(MAT)
    return obj


def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.62, .7, .78, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    mat = bpy.data.materials.new('Figure')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .85
    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bpy.ops.mesh.primitive_plane_add(size=6)
    g = bpy.context.object
    gm = bpy.data.materials.new('Grass')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.25, .38, .18, 1)
    g.data.materials.append(gm)
    return scene, mat


# (name, bearing from the front, elevation, distance, resolution, flat shading - the island's)
VIEWS = [('village', 25, 35, 6.0, 260), ('near', 20, 8, 1.1, 720), ('back', 200, 10, 1.1, 720),
         ('side', 90, 5, 1.1, 720)]


def shoot(scene, obj, view, path):
    name, bearing, elev, dist, res = view
    for o in scene.objects:
        if o.type == 'MESH' and o.name.startswith('fig:'):
            o.hide_render = o is not obj
    scene.render.resolution_x = scene.render.resolution_y = res
    cam = scene.camera
    a, e = math.radians(bearing), math.radians(elev)
    centre = Vector((0, 0, .22))
    cam.location = centre + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50 if name != 'village' else 85
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def flat(obj):
    for f in obj.data.polygons:
        f.use_smooth = False


def main():
    global MAT
    rng = random.Random(SEED)
    scene, MAT = setup()
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    key = {}
    for sex in ('male', 'female'):
        figs = {'resident': build(resident(sex), f'fig:{sex}:resident'), 'wanderer': build(wanderer(sex), f'fig:{sex}:wanderer')}
        for o in figs.values():
            flat(o)
        for view in VIEWS:
            order = ['resident', 'wanderer']
            rng.shuffle(order)
            for label, who in zip('AB', order):
                shoot(scene, figs[who], view, OUT / f'{sex}-{view[0]}-{label}.png')
            key[f'{sex}-{view[0]}'] = {'resident': 'AB'[order.index('resident')]}
        print('Bar:', sex, {k: len(v.data.polygons) for k, v in figs.items()})
    (OUT / 'key.json').write_text(json.dumps(key, indent=1), encoding='utf8')


if __name__ == '__main__':
    main()
