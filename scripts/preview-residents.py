"""Renders of a row of residents, dressed twelve ways, to judge the bake by before anything draws it
(Plans/inwoners-in-avonturierstijl.md, fase 1). Run by scripts/build-residents.py with the bake in
hand (RESIDENTS, part_object); everything is built from the exported arrays, the walking row
skinned by the exported joints and weights exactly as the island's shader will - two influences,
linear blend - so a seam that tears here tears there.

Writes assets/residents/renders/{row,walk,faces}.png (ignored by git).
"""
import bpy
import math
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/residents/renders'
OUT.mkdir(parents=True, exist_ok=True)

# The island's own swatches (shared/palette.mjs SWATCHES), by name.
SKIN = {'porcelain': 0xf6d5b8, 'sand': 0xf1c9a5, 'honey': 0xe0aa7c, 'amber': 0xc68642, 'umber': 0xa9713b,
        'chestnut': 0x8d5524, 'cocoa': 0x6b4326, 'espresso': 0x4a2f1d}
HAIR = {'brown': 0x503a2d, 'chestnut': 0x6e3b1f, 'auburn': 0x8c3f22, 'copper': 0xb5612e, 'honey': 0xc79a55,
        'blond': 0xe0c27a, 'ash': 0xb9b2a0, 'black': 0x241d1a, 'grey': 0x8e8b88, 'white': 0xece8df}
CLOTH = {'cream': 0xf0e2c8, 'lilac': 0xcfc4e6, 'ash': 0xa8a59e, 'wheat': 0xd9b98c, 'meadow': 0x6fb84a,
         'poppy': 0xd94f3d, 'cornflower': 0x3d7ed9, 'gold': 0xd9a33d, 'teal': 0x3aa899, 'plum': 0x8a4b7a,
         'leather': 0x6b4a2f, 'walnut': 0x5a3c28, 'charcoal': 0x3a3a3f, 'violet': 0x6e5aa8, 'navy': 0x2b4c7e,
         'tan': 0x7d5a3a, 'rust': 0x8a4b2a, 'slate': 0x4c5566, 'straw': 0xc9a75c, 'green': 0x5c8a4a,
         'white': 0xf5efe0, 'red': 0xd94f3d}

# sex, skin, hair style, hair colour, hat (shape, colour), then garment: colour.
DRESSED = [
    ('male', 'sand', 'parted', 'brown', ('cap', 'slate'), {'shirt': 'cream', 'trousers': 'walnut', 'shoes': 'leather'}),
    ('female', 'honey', 'buns', 'auburn', None, {'dress': 'cornflower', 'clogs': 'wheat'}),
    ('male', 'umber', 'buzzed', 'black', ('wide', 'straw'), {'shirt': 'wheat', 'vest': 'rust', 'trousers': 'charcoal', 'clogs': 'wheat'}),
    ('female', 'porcelain', 'long', 'blond', ('band', 'red'), {'shirt': 'cream', 'skirt': 'teal', 'apron': 'white', 'shoes': 'leather'}),
    ('male', 'cocoa', 'long', 'black', None, {'shirt': 'meadow', 'straps': 'leather', 'trousers': 'tan', 'shoes': 'walnut'}),
    ('female', 'chestnut', 'parted', 'black', ('dome', 'navy'), {'shirt': 'lilac', 'vest': 'violet', 'trousers': 'slate', 'shoes': 'leather'}),
    ('male', 'amber', 'none', 'brown', None, {'shirt': 'ash', 'apron': 'leather', 'trousers': 'charcoal', 'clogs': 'wheat'}),
    ('female', 'sand', 'buzzed', 'copper', ('wizard', 'violet'), {'shirt': 'gold', 'skirt': 'plum', 'scarf': 'cream', 'clogs': 'wheat'}),
    ('male', 'porcelain', 'buns', 'ash', ('sailor', 'navy'), {'shirt': 'white', 'scarf': 'navy', 'trousers': 'navy', 'shoes': 'charcoal'}),
    ('female', 'espresso', 'long', 'black', ('wide', 'straw'), {'dress': 'poppy', 'scarf': 'gold', 'shoes': 'walnut'}),
    ('male', 'honey', 'parted', 'grey', None, {'shirt': 'cream', 'vest': 'green', 'scarf': 'red', 'trousers': 'walnut', 'clogs': 'wheat'}),
    ('female', 'amber', 'buns', 'chestnut', None, {'shirt': 'white', 'apron': 'cream', 'straps': 'rust', 'skirt': 'walnut', 'shoes': 'leather'}),
]
SPACING = .2


def linear(hex_):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    return (ch((hex_ >> 16) & 255), ch((hex_ >> 8) & 255), ch(hex_ & 255))


def rx(a):
    return Matrix.Rotation(a, 4, 'X')


def rz(a):
    return Matrix.Rotation(a, 4, 'Z')


def pose_matrices(rig, angles):
    """Joint matrices in the island's frame: each joint turns about its own point, after its parent."""
    pts, parents = rig['points'], rig['parents']
    m = []
    for i, name in enumerate(rig['joints']):
        p = Vector(pts[i])
        local = Matrix.Translation(p) @ angles.get(name, Matrix.Identity(4)) @ Matrix.Translation(-p)
        m.append((m[parents[i]] if parents[i] >= 0 else Matrix.Identity(4)) @ local)
    return m


# Mid-stride, the left leg forward: knees and elbows bent the way the shader will bend them.
WALK = {'leftHip': rx(-.5), 'leftKnee': rx(.25), 'rightHip': rx(.4), 'rightKnee': rx(.8),
        'leftShoulder': rx(.35), 'leftElbow': rx(-.35), 'rightShoulder': rx(-.4), 'rightElbow': rx(-.7),
        'spine': rx(-.06), 'chest': Matrix.Rotation(.08, 4, 'Y'), 'head': rx(.05)}


def figure(data, look, x, pose=None):
    sex, skin, hair, hair_c, hat, wear = look
    parts = {p['id']: p for p in data['parts']}
    bottom = 'skirt' if ('skirt' in wear or 'dress' in wear) else 'trousers'
    feet = 'clogs' if 'clogs' in wear else 'shoes'
    combo = f'{bottom}/{feet}'
    chosen = [(p, SKIN[skin]) for p in data['parts'] if p['kind'] == 'skin' and combo in p['shows']]
    chosen.append((parts['hair:' + hair], HAIR[hair_c]))
    for gid, c in wear.items():
        chosen.append((parts[gid], CLOTH[c]))
    if hat:
        chosen.append((parts['hat:' + hat[0]], CLOTH[hat[1]]))
    tris = sum(len(p['positions']) // 9 for p, _ in chosen)
    mats = pose_matrices(data['rig'], pose) if pose else None
    for p, c in chosen:
        globals()['part_object'](p, colour=linear(c), pose=mats, offset=(x, 0, 0))
    return tris


def setup(width, height):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.62, .7, .78, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .9
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(-10), math.radians(-30))
    scene.collection.objects.link(sun)
    mat = bpy.data.materials.new('Resident')
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .85
    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    ground = bpy.data.meshes.new('Ground')
    ground.from_pydata([(-10, -10, 0), (10, -10, 0), (10, 10, 0), (-10, 10, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('Ground', ground)
    scene.collection.objects.link(g)
    gm = bpy.data.materials.new('Grass')
    gm.diffuse_color = (.25, .38, .18, 1)
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.25, .38, .18, 1)
    g.data.materials.append(gm)
    return scene, mat


def camera(scene, centre, scale, tilt=12):
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    a = math.radians(tilt)
    cam.location = (centre[0], centre[1] - 5 * math.cos(a), centre[2] + 5 * math.sin(a))
    cam.rotation_euler = (math.radians(90 - tilt), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam


def render(name, pose=None, close=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    n = len(DRESSED)
    scene, mat = setup(2400 if not close else 2400, 520 if not close else 760)
    tris = []
    for i, look in enumerate(DRESSED if not close else DRESSED[:6]):
        x = (i - (n - 1) / 2) * SPACING if not close else (i - 2.5) * .11
        tris.append(figure(RESIDENTS[look[0]], look, x, pose))
    for o in scene.objects:
        if o.type == 'MESH' and o.name != 'Ground':
            o.data.materials.append(mat)
    if close:
        camera(scene, (0, 0, .36), .7, 4)
    else:
        camera(scene, (0, 0, .24), n * SPACING + .1, 10)
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('Rendered', name, 'triangles per figure', tris)


render('row')
render('walk', WALK)
render('faces', close=True)
