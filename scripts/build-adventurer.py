"""The Adventurer: the second body a player can choose (Plans/tweede-avonturier.md).

Adapted from the CC-BY model Tiemen picked on Sketchfab (assets/adventurer/CREDITS.md has the
licence, the author, the link and every change made here), so the source GLB is committed
beside this script and read fresh on every run:

    node scripts/blender.mjs --background --python scripts/build-adventurer.py

writes assets/adventurer/island-adventurer.blend and then runs export-adventurer.py on it, which
writes web/js/adventurer-mesh.js. The .blend is the editable result - skinned body pieces,
fitted gear, a three-joint armature - but this script is the source of truth: it rebuilds the
.blend from the GLB, so a hand edit there is lost on the next run.

What the runtime needs is the Traveller's contract (scripts/build-settler.py, read by
web/js/classic-avatar.js): parts cut per limb group (head, outfit, leftArm, rightArm, leftLeg,
rightLeg), each limb skinned to a root/bend/end chain, a rig of pivots, and the wardrobe's parts
under the same names. So the source's 124 bones are folded into those three joints per limb,
with the finger chains preserved, its A-pose arms are lowered to hang, its texture is sampled into corner colours (no loader, no
texture: CLAUDE.md "Nothing is fetched at boot"), and the Traveller's gear is refitted onto it
by measurement.
"""
import bpy
import bmesh
import json
import math
import re
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/adventurer'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(OUT / 'source-link.glb'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

# The GLB is in metres-ish and faces Blender +Y. S takes it to the scale the gear was measured
# at; FIT (applied last, to everything at once) is the height on the island: 0.92 puts the top
# of the hair at 0.45, a little over the Traveller's 0.437, which a slim body can carry without
# towering over a village drawn round the Traveller's walking clearance.
S = .285
FIT = .92


def game(v):
    """Source Blender coordinates to island coordinates (x, y up, z forward), turned to face +Z."""
    return Vector((-v.x * S, v.z * S, v.y * S))


def blender(v):
    """Island coordinates back to Blender's (the island is Y up, Blender Z up)."""
    return Vector((v.x, -v.z, v.y))


def bone(word):
    return next(b for b in arm.data.bones if word in b.name)


def at(word):
    return game(arm.matrix_world @ bone(word).head_local)


# The rig. Its "left" is the source's Right: the island's rig names hands the way the Traveller's
# bake does, and classic-avatar.js mirrors the whole figure (object.scale.x = -1) to put them
# right. The shoulders are turned down 43 degrees about the island's forward axis, which takes
# the source's A-pose to arms hanging at the sides - the pose every held-item angle in
# classic-avatar.js was tuned from.
ARM_DROP = 43
rig, joints, turns = {}, {}, {}
for side, source, sign in [('left', 'Right', -1), ('right', 'Left', 1)]:
    hip, knee, ankle = at(source + ' leg_'), at(source + ' knee_'), at(source + ' ankle_')
    # avatar-gait.js solves the leg in the sagittal plane from a rest leg that is vertical.
    knee.z = ankle.z = hip.z
    rig[side + 'Leg'] = list(hip)
    joints[side + 'Leg'] = {'bend': list(knee), 'end': list(ankle)}
    shoulder = at(source + ' arm_')
    r = Matrix.Rotation(-sign * math.radians(ARM_DROP), 3, 'Z')
    turns[side] = (shoulder, r)
    elbow = shoulder + r @ (at(source + ' elbow_') - shoulder)
    wrist = shoulder + r @ (at(source + ' wrist_') - shoulder)
    rig[side + 'Arm'] = list(shoulder)
    joints[side + 'Arm'] = {'bend': list(elbow), 'end': list(wrist)}
rig['head'] = list(at('Neck_'))
# Where a held item's grip sits: in the fist, a little in front of and above the wrist bone.
rig['grip'] = list(Vector(joints['rightArm']['end']) + Vector((0, -.014, .008)))

# Keep the source's three knuckles per digit. Indices 3..7 are the shared torso/head
# bones at runtime, so sleeve vertices can retain their original torso influence.
fingers, finger_bones = {}, {}
for side, suffix, sign in [('left', 'R', -1), ('right', 'L', 1)]:
    origin, turn = turns[side]
    chain = []
    for digit in ['Thumb', 'IndexFinger', 'MiddleFinger', 'RingFinger', 'LittleFinger']:
        for segment in range(3):
            source = bone(f'{digit}{segment if digit == "Thumb" else segment + 1}_{suffix}_')
            point = origin + turn @ (game(arm.matrix_world @ source.head_local) - origin)
            index = 8 + len(chain)
            chain.append(dict(name=f'{digit}:{segment}', point=list(point),
                              parent=2 if segment == 0 else index - 1,
                              axis=[0, 0, -sign],
                              relaxed=([.12, .22, .18] if digit == 'Thumb' else [.16, .28, .18])[segment],
                              grip=([.35, .55, .45] if digit == 'Thumb' else [.85, 1.05, .7])[segment]))
            finger_bones[source.name] = (side + 'Arm', index)
    fingers[side + 'Arm'] = chain


def classify(name):
    """Which limb chain, and which of its three joints, a source bone deforms with.

    Fingers keep their knuckles; assist bones and toes fold into the nearest shoulder/elbow/
    wrist or hip/knee/ankle by walking up the parents; everything else (spine, head, the skirt's cloth bones)
    is the rigid outfit.
    """
    b = arm.data.bones.get(name)
    while b:
        n = b.name
        if n in finger_bones:
            return finger_bones[n]
        for src, dst in [('Left', 'right'), ('Right', 'left')]:
            if src + ' wrist_' in n: return dst + 'Arm', 2
            if src + ' elbow_' in n: return dst + 'Arm', 1
            if src + ' arm_' in n: return dst + 'Arm', 0
            if src + ' ankle_' in n or src + ' toe_' in n: return dst + 'Leg', 2
            if src + ' knee_' in n: return dst + 'Leg', 1
            if src + ' leg_' in n: return dst + 'Leg', 0
        b = b.parent
    return 'outfit', 0


def bone_head(word):
    return game(arm.matrix_world @ bone(word).head_local)


# Reshaping through the source's own bones, so a change follows the shape it was painted for
# instead of a box cut through the head: how far each bone's vertices are drawn in towards the
# bone's root. The ears end up small and round (the source's are long and pointed, the one
# feature that says whose they are), the ponytail and the side locks shorter.
SHRINK = {
    'Left_Ear': 1, 'Right_Ear': 1,
    'Ponytail': .7,
    'Left_Sideburn_A2': .35, 'Right_Sideburn_A2': .35,
}
SHRINK_ROOT = {name: bone_head(name + '_') for name in SHRINK}

# The island palette: slate blue cloth, sand trousers, brown leather.
SLATE = [.16, .24, .28]
SAND = [.62, .52, .36]
LEATHER = [.25, .15, .08]
HAIR = [.16, .072, .033]
BRASS = [.62, .47, .2]


def lum(c):
    return sum(c) / 3


# Hair and skin are dyed at runtime (Plans/basislichamen-en-outfits.md): their corner colours are
# the texel over the look's default hair or skin colour in linear light (web/js/avatar.js
# DEFAULT_AVATAR, held equal by tests/bodies.test.mjs, as THREE.Color makes them), and avatar.js
# multiplies them by the colour the look asks for. At the defaults the Adventurer is drawn exactly
# as before.
DEFAULT_SKIN = 0xf1c9a5
DEFAULT_HAIR = 0x503a2d


def linear(hexv):
    out = []
    for shift in (16, 8, 0):
        c = ((hexv >> shift) & 255) / 255
        out.append(c / 12.92 if c < .04045 else ((c + .055) / 1.055) ** 2.4)
    return out


def tint_of(label):
    if 'Hairband' in label:
        return 'hair'
    if label.endswith('Head') or 'Upper_Skin' in label:
        return 'skin'
    return None


TINT_BASE = {'hair': linear(DEFAULT_HAIR), 'skin': linear(DEFAULT_SKIN)}


def recolour(label, c):
    """The source's texel, turned into this body's colour.

    Flat cloth where the source had an emblem (the tunic), the source's own shading kept as a
    brightness on everything else it had painted - the folds of the trousers, the stitching on a
    boot - so the texture still reads, in the island's colours.
    """
    if 'Tunic' in label:
        return SLATE
    if 'Hairband' in label:
        shade = .45 + .55 * lum(c)
        return [v * shade for v in HAIR]
    if 'Eyeball' in label and c[2] > c[0] * 1.15:
        return [c[2] * .45, c[2] * .5, c[2] * .27]
    if 'Lower' in label and lum(c) > .45:
        shade = .55 + .6 * lum(c)
        return [min(1, v * shade) for v in SAND]
    if 'Belt' in label or 'Gauntlets' in label or 'Armcover' in label:
        # Leather, and the source's bright metal (buckles, studs) as plain brass.
        if max(c) > .55 and c[0] > c[2] * 1.3:
            return BRASS
        shade = .5 + 1.1 * lum(c)
        return [min(1, v * shade) for v in LEATHER]
    return c


meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.materials]
objects = []
head_points = []
eye_points = []
for obj in meshes:
    mat = obj.data.materials[0]
    label = mat.name
    # The source's own weapons and its earring are left behind: the island's hand items and
    # wardrobe are the ones the inventory offers.
    if label.startswith('weapon_') or 'Earring' in label:
        continue
    head = any(t in label for t in ['Head', 'Eyeball', 'Eyelashes', 'Hairband'])
    # The face is painted in its 256-pixel texture, not modelled: one cut per edge gives the
    # corner colours enough samples to keep the eyes, brows and mouth (measured: none at all
    # and the face is a smear, two cuts cost 9x the triangles for little more).
    if 'Eyeball' in label or label.endswith('Head'):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=3 if 'Eyeball' in label else 1, use_grid_fill=True)
        bm.to_mesh(obj.data)
        bm.free()
    mesh = obj.data
    mesh.calc_loop_triangles()
    img = next((n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE'), None)
    pixels = list(img.pixels[:]) if img else []
    w, h = img.size if img else (1, 1)
    groups = {g.index: g.name for g in obj.vertex_groups}
    cats = {i: classify(name) for i, name in groups.items()}
    tint = tint_of(label)
    points, weights = [], []
    for v in mesh.vertices:
        p = game(obj.matrix_world @ v.co)
        ww = {}
        for g in v.groups:
            cat = cats[g.group]
            ww[cat] = ww.get(cat, 0) + g.weight
            name = groups[g.group]
            for word, amount in SHRINK.items():
                if word + '_' in name and g.weight > 0:
                    root = SHRINK_ROOT[word]
                    p = root + (p - root) * (1 - amount * g.weight)
        # Lower the A-pose arms, smoothly at the sleeves: a vertex turns by as much as it
        # belongs to the arm.
        for side in ['left', 'right']:
            amount = sum(value for (group, _), value in ww.items() if group == side + 'Arm')
            origin, r = turns[side]
            p += ((origin + r @ (p - origin)) - p) * amount
        points.append(p)
        weights.append(ww)
        if head:
            head_points.append(p)
        if 'Eyeball' in label:
            eye_points.append(p)

    def sample(loop):
        uv = mesh.uv_layers.active.data[loop].uv if mesh.uv_layers.active else Vector((0, 0))
        # The left eye is deliberately in UV tile (0, 1). Its source sampler repeats;
        # clamping that tile to the last row erased the entire iris and pupil.
        x = int((uv.x % 1) * w) % w
        y = int((uv.y % 1) * h) % h
        c = pixels[(y * w + x) * 4:(y * w + x) * 4 + 3] if pixels else [.5, .5, .5]
        c = recolour(label, c)
        if tint:
            c = [v / b for v, b in zip(c, TINT_BASE[tint])]
        return [round(v, 5) for v in c]

    batches = {}
    for tri in mesh.loop_triangles:
        score = {}
        for idx in tri.vertices:
            for (group, _), value in weights[idx].items():
                score[group] = score.get(group, 0) + value
        group = 'head' if head else max(score, key=score.get) if score else 'outfit'
        arm_groups = [g for g in ['leftArm', 'rightArm'] if score.get(g, 0) > 1e-6]
        if not head and arm_groups:
            group = max(arm_groups, key=score.get)
        # The trousers, and the tunic's skirt below the hips, go with the leg on their side:
        # weighted to the hips they would stand still while the legs walked out of them.
        centre = sum((points[i] for i in tri.vertices), Vector()) / 3
        if 'Lower' in label or ('Tunic' in label and centre.y < rig['leftLeg'][1]):
            group = ('left' if centre.x < 0 else 'right') + 'Leg'
        batch = batches.setdefault(group, {'vertices': [], 'faces': [], 'colors': [], 'skin': []})
        ids = []
        for idx, loop in zip(tri.vertices, tri.loops):
            ids.append(len(batch['vertices']))
            batch['vertices'].append(blender(points[idx]))
            batch['colors'].append(sample(loop))
            count = 23 if group.endswith('Arm') else 3
            ww = [weights[idx].get((group, b), 0) for b in range(count)]
            if group.endswith('Arm'):
                # Match classic-avatar.js weightTorso at the seam, without throwing away
                # the source weights when a triangle crosses from tunic to sleeve.
                y = points[idx].y
                hip, shoulder, neck = rig['leftLeg'][1], rig['leftArm'][1], rig['head'][1]
                length = shoulder - hip
                ramp = lambda value: max(0, min(1, value))
                a = ramp((y - hip - .1 * length) / (.3 * length))
                b = ramp((y - hip - .4 * length) / (.3 * length))
                c = ramp((y - shoulder - .3 * (neck - shoulder)) / (.6 * (neck - shoulder)))
                rest = max(0, sum(weights[idx].values()) - sum(ww))
                for j, value in enumerate([1-a, a*(1-b), a*b*(1-c), a*b*c]):
                    ww[3+j] = rest * value
                if y >= neck:
                    head_weight = ramp((y - neck) * FIT / .016)
                    ww[3:8] = [0, 0, 0, rest * (1-head_weight), rest * head_weight]
            total = sum(ww)
            batch['skin'].append([1] + [0] * (count-1) if total < 1e-6 else [x / total for x in ww])
        batch['faces'].append(ids)
    for group, batch in batches.items():
        name = 'Adventurer ' + label.split('Mt_')[-1] + ' ' + group
        data = bpy.data.meshes.new(name)
        data.from_pydata(batch['vertices'], [], batch['faces'])
        data.update()
        o = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(o)
        objects.append(o)
        o['avatar_group'] = group
        o['avatar_variant'] = 'body'
        o['avatar_slot'] = tint or 'adventurer'
        if tint:
            o['avatar_tint'] = 1
        attr = data.color_attributes.new(name='Colour', type='FLOAT_COLOR', domain='CORNER')
        for loop in data.loops:
            attr.data[loop.index].color = (*batch['colors'][loop.vertex_index], 1)
        for poly in data.polygons:
            poly.use_smooth = True
        if group in joints:
            o['avatar_skin'] = group
            vg = [o.vertex_groups.new(name=group + ':' + str(i)) for i in range(23 if group.endswith('Arm') else 3)]
            for i, ww in enumerate(batch['skin']):
                for g, value in zip(vg, ww):
                    if value:
                        g.add([i], value, 'REPLACE')
        # Weld the triangle soup back together (corner colours and weights survive), so the
        # smooth shading has neighbours to average over.
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
        bm.to_mesh(data)
        bm.free()
        data.update()

for o in list(bpy.data.objects):
    if o not in objects:
        bpy.data.objects.remove(o, do_unlink=True)


def box_of(pts):
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


# The Traveller's wardrobe, refitted. Every piece keeps its name, slot and variant, so the
# inventory, normalizeAvatar and classic-avatar.js's part lists work on this body unchanged.
# The hand items (sword, shield, torch, hammer) are not carried: a sword is the same sword in
# either body's hand, and classic-avatar.js draws them from the Traveller's bake.
text = (ROOT / 'web/js/settler-mesh.js').read_text()
old = json.loads(re.search(r'export const SETTLER_PARTS = (.*);', text).group(1))
old_rig = json.loads(re.search(r'export const SETTLER_RIG = (.*);', text).group(1))
HELD = ('Sword', 'Shield', 'Torch', 'Hammer')


def old_points(pred):
    return [Vector(p['positions'][i:i + 3]) for p in old if pred(p) for i in range(0, len(p['positions']), 3)]


old_head = box_of(old_points(lambda p: p['variant'] == 'body' and p.get('group') == 'head'))
new_head = box_of(head_points)
old_torso = box_of(old_points(lambda p: p['variant'] == 'body' and p.get('group') == 'outfit'))
new_torso = box_of([Vector((v.co.x, v.co.z, -v.co.y))
                    for o in objects if o['avatar_group'] == 'outfit' for v in o.data.vertices])

# A hat: the Traveller's head box onto this one, as wide and deep as this head is, and as tall
# as it is wide so a brim stays a brim; hung from the top of the hair and sunk a little into
# it, as the Traveller's hats sink 0.021 into his.
hx = (new_head[1].x - new_head[0].x) / (old_head[1].x - old_head[0].x)
hz = (new_head[1].z - new_head[0].z) / (old_head[1].z - old_head[0].z)
old_head_mid = (old_head[0] + old_head[1]) / 2
new_head_mid = (new_head[0] + new_head[1]) / 2
# Worn a size up: the crown has to go over hair the Traveller does not have.
HAT_EASE = 1.3


def fit_head(v):
    return Vector(((v.x - old_head_mid.x) * hx * HAT_EASE + new_head_mid.x,
                   (v.y - old_head[1].y) * hx * HAT_EASE + new_head[1].y - .01,
                   (v.z - old_head_mid.z) * hz * HAT_EASE + new_head_mid.z))


# The backpack and the chestplate: across, the shoulders' span; up and down, hung from the
# shoulders at a stretch between that and the longer torso this body has; front to back, the
# torso's depth, laid against its back - the Traveller's pack sits on his back, and scaled
# about his middle it hung a hand's width off this one's.
kx = rig['rightArm'][0] / old_rig['rightArm'][0]
ky = 1.08
kz = (new_torso[1].z - new_torso[0].z) / (old_torso[1].z - old_torso[0].z)


def fit_torso(v):
    return Vector((v.x * kx,
                   (v.y - old_rig['rightArm'][1]) * ky + rig['rightArm'][1],
                   (v.z - old_torso[0].z) * kz + new_torso[0].z))


# A pauldron is a lump on the Traveller's broad shoulder; carried over whole it stood out like
# a pillow on this one's. Set where the fit puts its middle, then shrunk about that middle.
PAULDRON = .72


# Leg armour follows its leg: narrower round the leg's own line, stretched with the longer leg.
# Not a sabaton, which stretched with it stood up the shin like a bucket: it keeps nearly its
# own height, and the leg's own boot shows between it and the greave.
def fit_leg(v, side, boot=False):
    return Vector(((v.x - old_rig[side][0]) * (.6 if boot else .68) + rig[side][0],
                   v.y * (1.15 if boot else rig[side][1] / old_rig[side][1]),
                   v.z * (.68 if boot else .8)))


def part_mesh(name, verts, faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    return data


for part in old:
    if part['variant'] in ('body', 'held') or part['name'].startswith(HELD):
        continue
    group = part.get('group', '')
    skin_group = part.get('skinGroup', '')
    pos = part['positions']
    verts = []
    raw = [Vector(pos[i:i + 3]) for i in range(0, len(pos), 3)]
    middle = sum(raw, Vector()) / len(raw)
    for v in raw:
        if group == 'head':
            v = fit_head(v)
        elif skin_group.endswith('Leg'):
            v = fit_leg(v, skin_group, 'sabaton' in part['name'])
        elif 'pauldron' in part['name']:
            v = fit_torso(middle) + (fit_torso(v) - fit_torso(middle)) * PAULDRON
        else:
            v = fit_torso(v)
        verts.append(blender(v))
    faces = [(i, i + 1, i + 2) for i in range(0, len(verts), 3)]
    data = part_mesh(part['name'], verts, faces)
    o = bpy.data.objects.new(part['name'], data)
    bpy.context.collection.objects.link(o)
    objects.append(o)
    o['avatar_group'] = group or 'equipment'
    o['avatar_variant'] = part['variant']
    o['avatar_slot'] = part['slot']
    if skin_group:
        o['avatar_skin'] = skin_group
        vg = [o.vertex_groups.new(name=skin_group + ':' + str(i)) for i in range(3)]
        skin = part.get('skin') or []
        for i in range(len(verts)):
            bend, end = (skin[i * 2], skin[i * 2 + 1]) if skin else (0, 0)
            for g, value in zip(vg, (max(0, 1 - bend - end), bend, end)):
                if value:
                    g.add([i], value, 'REPLACE')
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
    bm.to_mesh(data)
    bm.free()
    for poly in data.polygons:
        poly.use_smooth = True
    # Round where the Traveller's pieces are round, a hard edge where his have one.
    data.set_sharp_from_angle(angle=math.radians(40))
    data.update()

# Everything to the island's height at once, rig and eye included.
fit = Matrix.Scale(FIT, 4)
for o in objects:
    o.data.transform(fit)
rig = {k: [x * FIT for x in v] for k, v in rig.items()}
joints = {k: {j: [x * FIT for x in p] for j, p in c.items()} for k, c in joints.items()}
for chain in fingers.values():
    for joint in chain:
        joint['point'] = [v * FIT for v in joint['point']]
eye_y = round(sum(p.y for p in eye_points) / len(eye_points) * FIT, 4)

material = bpy.data.materials.new('Baked adventurer colours')
material.use_nodes = True
colour = material.node_tree.nodes.new('ShaderNodeVertexColor')
colour.layer_name = 'Colour'
bsdf = material.node_tree.nodes.get('Principled BSDF')
material.node_tree.links.new(colour.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = .85
for o in objects:
    o.data.materials.append(material)

# A real, editable armature on the same three joints per limb the page drives, so the .blend
# can be posed to check a sleeve or a boot before anything is exported.
skel = bpy.data.armatures.new('Island adventurer rig')
ao = bpy.data.objects.new('Island adventurer rig', skel)
bpy.context.collection.objects.link(ao)
bpy.context.view_layer.objects.active = ao
ao.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for group, chain in joints.items():
    pts = [Vector(rig[group]), Vector(chain['bend']), Vector(chain['end'])]
    for i in range(3):
        b = skel.edit_bones.new(group + ':' + str(i))
        b.head = blender(pts[i])
        b.tail = blender(pts[i + 1]) if i < 2 else blender(pts[i] + Vector((0, -.02, .005)))
        if i:
            b.parent = skel.edit_bones[group + ':' + str(i - 1)]
    if group in fingers:
        hip, shoulder, neck = rig['leftLeg'][1], rig['leftArm'][1], rig['head'][1]
        for i, y in enumerate([hip, hip + .3 * (shoulder-hip), hip + .7 * (shoulder-hip), neck, neck], 3):
            b = skel.edit_bones.new(group + ':' + str(i))
            b.head = blender(Vector((0, y, 0)))
            b.tail = b.head + Vector((0, 0, .01))
            if i > 3:
                b.parent = skel.edit_bones[group + ':' + str(i - 1)]
        for i, joint in enumerate(fingers[group], 8):
            b = skel.edit_bones.new(group + ':' + str(i))
            b.head = blender(Vector(joint['point']))
            b.tail = b.head + Vector((0, 0, -.004))
            b.parent = skel.edit_bones[group + ':' + str(joint['parent'])]
bpy.ops.object.mode_set(mode='OBJECT')
for group, chain in fingers.items():
    for i, joint in enumerate(chain, 8):
        pose = ao.pose.bones[group + ':' + str(i)]
        local_axis = pose.bone.matrix_local.to_3x3().inverted() @ blender(Vector(joint['axis']))
        pose.rotation_mode = 'AXIS_ANGLE'
        pose.rotation_axis_angle = (joint['relaxed'], *local_axis)
ao.show_in_front = True
for o in objects:
    if 'avatar_skin' in o:
        mod = o.modifiers.new('Joint deformation', 'ARMATURE')
        mod.object = ao

scene = bpy.context.scene
scene['adventurer_rig'] = json.dumps(rig)
scene['adventurer_joints'] = json.dumps(joints)
scene['adventurer_fingers'] = json.dumps(fingers)
scene['adventurer_eye_y'] = eye_y
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'island-adventurer.blend'))
exec(compile((ROOT / 'scripts/export-adventurer.py').read_text(), str(ROOT / 'scripts/export-adventurer.py'), 'exec'))
