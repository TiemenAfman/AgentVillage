"""The Wanderer's bodies: a man and a woman in their underwear, hairstyles, and clothes worn over
them one garment at a time (Plans/basislichamen-en-outfits.md).

    node scripts/blender.mjs --background --python-exit-code 1 --python scripts/build-bodies.py

reads the CC0 Quaternius glTFs in assets/bodies/source/ (scripts/prepare-bodies-source.py copied
them out of the two free kits; assets/bodies/CREDITS.md) and writes, per body,
assets/bodies/island-wanderer-<sex>.blend - the body, every hairstyle and every garment as an
object of its own, fitted and rigged on the hanging-arm rest pose: the base to model a new garment
on in Blender - and then web/js/bodies-mesh.js from that same scene. This script is the source of
truth: it rebuilds both from the glTFs, so a hand edit in a .blend is lost on the next run (a new
garment belongs in source/ and in GARMENT_SOURCES below).

The runtime contract is the Adventurer's (build-adventurer.py, read by web/js/classic-avatar.js):
parts cut per limb group, each limb skinned to its chain, a rig of pivots, corner colours sampled
from the texture. An arm is skinned to 23 bones: its chain, the five of the shared torso and fifteen
finger knuckles. A leg here is skinned to its chain and the torso too (indices 4..7 after the
runtime's toe at 3), so the waistband and the hips follow the pelvis instead of tearing from it at
a line. What is new:

- Every armature in the scene (the body's, each hair's, each garment set's) is posed onto the
  body's own bones, with the arms let down from the T-pose to hang, and that pose is applied as
  the rest. One step does three jobs: it lowers the arms through the source's own skin weights, it
  fits a garment made for another build of the same skeleton - the kit's outfits were made for its
  slimmer Regular builds - onto this one, and it leaves a .blend rigged as the island draws it.
- A garment is one slot (GARMENTS: shirt, trousers, shoes, straps) of one set (peasant): the kit's
  Body is the shirt, Legs the trousers, Feet the shoes, and Arms is cut into its loose pieces - a
  piece reaching from the upper arm past the elbow is a sleeve and goes to the shirt, the rest are
  straps.
- The body is the same whatever is worn; what each garment hides is a list per body part
  (`hide: { <garment>: [from, to, ...] }`, runs of triangles), worked out here by looking along
  each skin vertex's normal for that garment's cloth. avatar.js leaves the union of what the worn
  garments hide out, so no skin pokes through a sleeve when an arm bends.
- Skin and hair are `tint` parts: the kit made its skin and hair maps to be tinted, so their
  corner colours are the texture over its own mean, and avatar.js multiplies them by whatever the
  look says - the shading stays (a blush, a strand, the shadow under the chin), the colour is the
  look's. A Wanderer who never chose one has the look's default sand skin and brown hair.
"""
import bpy
import json
import math
import re
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets/bodies/source'
OUT = ROOT / 'assets/bodies'

# One scale for both: the man's hair tops out a little over the Adventurer's 0.466, the woman is
# the head shorter the kit made her. Quaternius's metres times S is island units.
S = .25
# The T-pose's arms let down to hang, about the forward axis at the shoulder. Short of 90: the
# superhero builds are broad in the lats, and at 90 the inside of the arm went into the ribs.
ARM_DROP = 82
# Underwear: the bodies' texture leaves it a flat light grey (the kit's shader colours it through a
# vertex mask); it is cut out of the skin by that lack of colour, so the skin can be dyed and the
# underwear not, and drawn charcoal with the texture's shading kept.
UNDERWEAR_SAT = .08
UNDERWEAR = [.075, .075, .085]
# How far along a skin vertex's normal cloth may lie and still cover it (source metres): enough for
# a loose shirt, not so much that a sleeve hides the hand beyond its cuff. Inward: the kit made
# its outfits for its slimmer Regular builds, and on these superhero ones a thigh stands up to a
# few centimetres out through the trousers - cloth that far under the skin covers it too.
COVER_OUT = .045
COVER_IN = .04
# Each corner's colour is sampled this far in towards its triangle's middle (see emit).
SAMPLE_IN = .25
# A triangle at least this much on each thigh is the crotch's (see emit).
CROTCH = .15

# The kit paints the woman's peasant hands into the outfit's own sleeves (the man's are a mesh of
# skin under a material of their own, dropped below): cut from the cloth, so the body's own hands -
# dyed with the rest of the skin - show instead.
HAND_BONES = ('hand_', 'thumb_', 'index_', 'middle_', 'ring_', 'pinky_')

# The slots a Wanderer dresses in, in the inventory's order (web/js/player-bodies.js GARMENTS).
GARMENTS = ['shirt', 'trousers', 'shoes', 'straps']
# Which kit mesh is which slot; 'Arms' is cut into sleeves (shirt) and straps.
KIT_SLOT = {'Body': 'shirt', 'Legs': 'trousers', 'Feet': 'shoes', 'Arms': None}

BODIES = {
    'female': dict(body='Superhero_Female_FullBody',
                   hair={'long': 'Hair_Long', 'buns': 'Hair_Buns', 'parted': 'Hair_SimpleParted', 'buzzed': 'Hair_BuzzedFemale'},
                   sets={'peasant': 'Female_Peasant'}),
    'male': dict(body='Superhero_Male_FullBody',
                 hair={'parted': 'Hair_SimpleParted', 'buzzed': 'Hair_Buzzed', 'long': 'Hair_Long', 'buns': 'Hair_Buns'},
                 sets={'peasant': 'Male_Peasant'}),
}


def game(v):
    """Blender (Z up, front -Y, as the glTF importer leaves it) to island units (Y up, front +Z)."""
    return Vector((v.x * S, v.z * S, -v.y * S))


def side_of(name):
    """The island's rig names its limbs the way the Traveller's bake does: its left is at -x. The
    kit's _r bones are at -x, so _r is the rig's left."""
    if name.endswith('_r'):
        return 'left'
    if name.endswith('_l'):
        return 'right'
    return None


FINGER_ORDER = [('Thumb', 'thumb'), ('IndexFinger', 'index'), ('MiddleFinger', 'middle'),
                ('RingFinger', 'ring'), ('LittleFinger', 'pinky')]
# The torso's bones as an arm's skin indexes them (3..7: pelvis, spine, chest, neck, head) and as a
# leg's does (after the runtime's toe at 3: 4..7, the head folded into the neck).
ARM_TORSO = {'pelvis': 3, 'spine_01': 4, 'spine_02': 5, 'spine_03': 5, 'neck_01': 6, 'Head': 7}
LEG_TORSO = {'pelvis': 4, 'spine_01': 5, 'spine_02': 6, 'spine_03': 6, 'neck_01': 7, 'Head': 7}


def classify(name):
    """Which limb chain and which of its joints a kit bone deforms with; (group, index)."""
    side = side_of(name)
    for digit, word in FINGER_ORDER:
        m = re.match(word + r'_0(\d)', name)
        if m and side:
            seg = min(int(m.group(1)) - 1, 2)
            return side + 'Arm', 8 + FINGER_ORDER.index((digit, word)) * 3 + seg
    if side:
        for word, idx in (('upperarm', 0), ('lowerarm', 1), ('hand', 2)):
            if name.startswith(word):
                return side + 'Arm', idx
        for word, idx in (('thigh', 0), ('calf', 1), ('foot', 2), ('ball', 2)):
            if name.startswith(word):
                return side + 'Leg', idx
        if name.startswith('clavicle'):
            return 'outfit', 'spine_03'
    if name in ('Head', 'neck_01'):
        return 'head', name
    return 'outfit', name if name in ARM_TORSO else 'pelvis'


def import_gltf(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SRC / (name + '.gltf')))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = []
    for o in new:
        # Every kit glTF carries a small icosphere at the root (the kit's own bone display), and the
        # man's peasant his Regular build's own forearms; neither is anything anybody wears.
        if o.type == 'MESH' and (o.name.lower().startswith('icosphere')
                                 or (o.data.materials and 'Regular' in o.data.materials[0].name)):
            bpy.data.objects.remove(o, do_unlink=True)
        elif o.type == 'MESH':
            meshes.append(o)
    return arm, meshes


def active(obj, mode='OBJECT'):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if mode != 'OBJECT':
        bpy.ops.object.mode_set(mode=mode)


def pose_body(arm):
    """Let the arms down to hang. Returns {bone: armature-space matrix} of the posed body."""
    active(arm, 'POSE')
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for name, sign in (('upperarm_l', 1), ('upperarm_r', -1)):
        pb = arm.pose.bones[name]
        head = pb.matrix.to_translation()
        # About Blender's Y (the kit's forward axis after import): +x goes down for the arm at +x.
        r = Matrix.Rotation(sign * math.radians(ARM_DROP), 4, 'Y')
        pb.matrix = Matrix.Translation(head) @ r @ Matrix.Translation(-head) @ pb.matrix
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    return {pb.name: pb.matrix.copy() for pb in arm.pose.bones}


def pose_onto(arm, target):
    """Pose another armature's bones onto the posed body's: hair and garments follow it."""
    active(arm, 'POSE')
    for pb in sorted(arm.pose.bones, key=lambda pb: len(pb.parent_recursive)):
        if pb.name in target:
            pb.matrix = target[pb.name]
            bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')


def apply_rest(arm, meshes):
    """Make the pose the rest: bake it into each mesh, then into the armature, and bind again."""
    for o in meshes:
        mod = next((m for m in o.modifiers if m.type == 'ARMATURE'), None)
        if mod:
            active(o)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    active(arm, 'POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes:
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = arm


def weights_of(obj):
    groups = {g.index: g.name for g in obj.vertex_groups}
    return [{groups[g.group]: g.weight for g in v.groups if g.weight > 0 and g.group in groups}
            for v in obj.data.vertices]


def bare_hand(weights, verts):
    total = hand = 0
    for vi in verts:
        for bone, w in weights[vi].items():
            total += w
            if bone.startswith(HAND_BONES):
                hand += w
    return total and hand / total > .5


def split_garments(set_id, meshes):
    """The kit's pieces of one set as garment objects, one per slot (see the header)."""
    pieces = {slot: [] for slot in GARMENTS}
    for o in meshes:
        kind = o.name.split('_')[-1]
        slot = KIT_SLOT.get(kind, 'shirt')
        if kind != 'Arms':
            pieces[slot].append(o)
            continue
        active(o, 'EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.separate(type='LOOSE')
        bpy.ops.object.mode_set(mode='OBJECT')
        for part in list(bpy.context.selected_objects):
            w = weights_of(part)
            upper = lower = 0
            for vw in w:
                for bone, x in vw.items():
                    if bone.startswith('upperarm'):
                        upper += x
                    elif bone.startswith(('lowerarm', 'hand')):
                        lower += x
            total = upper + lower or 1
            sleeve = upper / total > .2 and lower / total > .2
            pieces['shirt' if sleeve else 'straps'].append(part)
    out = {}
    for slot, objs in pieces.items():
        if not objs:
            continue
        active(objs[0])
        for o in objs[1:]:
            o.select_set(True)
        if len(objs) > 1:
            bpy.ops.object.join()
        g = bpy.context.view_layer.objects.active
        g.name = g.data.name = f'Garment {set_id}-{slot}'
        g['garment'] = f'{set_id}-{slot}'
        out[f'{set_id}-{slot}'] = g
    return out


def base_image(obj):
    mat = obj.data.materials[0] if obj.data.materials else None
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image:
            img = n.image
            return dict(w=img.size[0], h=img.size[1], px=list(img.pixels[:]))
    return None


def sampler(img):
    def at(uv):
        if not img:
            return [.5, .5, .5]
        x = int((uv[0] % 1) * img['w']) % img['w']
        y = int((uv[1] % 1) * img['h']) % img['h']
        i = (y * img['w'] + x) * 4
        return img['px'][i:i + 3]
    return at


def lum(c):
    return sum(c) / 3


def sat(c):
    return max(c) - min(c)


def runs_of(flags):
    r, i = [], 0
    while i < len(flags):
        if flags[i]:
            j = i
            while j < len(flags) and flags[j]:
                j += 1
            r += [i, j]
            i = j
        else:
            i += 1
    return r


def build(sex, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body_arm, body_meshes = import_gltf(spec['body'])
    hairs = {sid: import_gltf(f) for sid, f in spec['hair'].items()}
    sets = {sid: import_gltf(f) for sid, f in spec['sets'].items()}
    target = pose_body(body_arm)
    for arm, _ in [*hairs.values(), *sets.values()]:
        pose_onto(arm, target)
    bpy.context.view_layer.update()

    joint = lambda name: game(body_arm.matrix_world @ target[name].to_translation())
    # The rig, from the posed body's bones.
    rig, joints, fingers = {}, {}, {}
    for side, kit in (('left', 'r'), ('right', 'l')):
        hip, knee, ankle = joint('thigh_' + kit), joint('calf_' + kit), joint('foot_' + kit)
        # avatar-gait.js solves the leg in the sagittal plane from a rest leg that is vertical.
        knee.z = ankle.z = hip.z
        knee.x = ankle.x = hip.x
        rig[side + 'Leg'] = list(hip)
        joints[side + 'Leg'] = {'bend': list(knee), 'end': list(ankle)}
        rig[side + 'Arm'] = list(joint('upperarm_' + kit))
        joints[side + 'Arm'] = {'bend': list(joint('lowerarm_' + kit)), 'end': list(joint('hand_' + kit))}
        sign = -1 if side == 'left' else 1
        chain = []
        for digit, word in FINGER_ORDER:
            for seg in range(3):
                index = 8 + len(chain)
                chain.append(dict(name=f'{digit}:{seg}', point=list(joint(f'{word}_0{seg + 1}_{kit}')),
                                  parent=2 if seg == 0 else index - 1, axis=[0, 0, -sign],
                                  relaxed=([.12, .22, .18] if digit == 'Thumb' else [.16, .28, .18])[seg],
                                  grip=([.35, .55, .45] if digit == 'Thumb' else [.85, 1.05, .7])[seg]))
        fingers[side + 'Arm'] = chain
    rig['head'] = list(joint('neck_01'))
    # In the fist: a little past the hand bone towards the middle knuckle, and in front of it.
    hand, knuckle = Vector(joints['rightArm']['end']), Vector(fingers['rightArm'][6]['point'])
    rig['grip'] = list(hand + (knuckle - hand) * .55 + Vector((0, 0, .006)))

    # The pose as the rest, every piece named for what it is, and the .blend for Blender.
    apply_rest(body_arm, body_meshes)
    for arm, meshes in [*hairs.values(), *sets.values()]:
        apply_rest(arm, meshes)
    for o in body_meshes:
        mat = o.data.materials[0].name if o.data.materials else ''
        o.name = 'Body eyes' if 'Eyes' in mat else 'Body brows' if 'Hair' in mat else 'Body skin'
    for sid, (arm, meshes) in hairs.items():
        arm.name = f'Hair {sid} rig'
        for o in meshes:
            o.name = f'Hair {sid}'
    body_arm.name = 'Body rig'
    garments = {}
    for sid, (arm, meshes) in sets.items():
        arm.name = f'Garments {sid} rig'
        garments.update(split_garments(sid, meshes))
    bpy.context.view_layer.update()
    blend = OUT / f'island-wanderer-{sex}.blend'
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), relative_remap=True)

    parts = []
    eye_ys = []

    # Each garment's cloth as a BVH: what covers the skin. Bare hands are not cloth.
    cloth = {}
    for gid, o in garments.items():
        mesh = o.data
        mesh.calc_loop_triangles()
        w = weights_of(o)
        verts = [o.matrix_world @ v.co for v in mesh.vertices]
        polys = [list(t.vertices) for t in mesh.loop_triangles if not bare_hand(w, t.vertices)]
        cloth[gid] = BVHTree.FromPolygons(verts, polys)

    def covered(p, n, tree):
        hit = tree.ray_cast(p - n * COVER_IN, n, COVER_IN + COVER_OUT)
        return hit[0] is not None

    def emit(obj, label, variant, kind, hides=(), garment=None):
        """kind: 'skin' (body, split into skin and underwear), 'hair', 'eyes', 'cloth'."""
        mesh = obj.data
        mesh.calc_loop_triangles()
        at = sampler(base_image(obj))
        uv = mesh.uv_layers.active.data if mesh.uv_layers.active else None
        m3 = obj.matrix_world.to_3x3()
        world = [obj.matrix_world @ v.co for v in mesh.vertices]
        normals = [(m3 @ v.normal).normalized() for v in mesh.vertices]
        weights = weights_of(obj)
        cover = {gid: [covered(world[i], normals[i], cloth[gid]) for i in range(len(world))] for gid in hides}
        batches = {}
        for t in mesh.loop_triangles:
            if kind == 'cloth' and bare_hand(weights, t.vertices):
                continue
            score = {}
            for vi in t.vertices:
                for bone, w in weights[vi].items():
                    g = classify(bone)[0]
                    score[g] = score.get(g, 0) + w
            total = sum(score.values()) or 1
            if kind in ('hair', 'eyes'):
                group = 'head'
            else:
                group = max(score, key=score.get) if score else 'outfit'
                arms = [g for g in ('leftArm', 'rightArm') if score.get(g, 0) > 1e-6]
                legs = [g for g in ('leftLeg', 'rightLeg') if score.get(g, 0) / total > .25]
                centre = sum((game(world[vi]) for vi in t.vertices), Vector()) / 3
                side = 'leftLeg' if centre.x < 0 else 'rightLeg'
                if arms and group != 'head':
                    group = max(arms, key=score.get)
                # A shirt is the torso's, its hem included: half of a hem on the legs and half on the
                # torso tore open at every step. Trousers and shoes are wholly the legs'.
                elif garment == 'shirt':
                    group = 'outfit' if group.endswith('Leg') else group
                elif garment in ('trousers', 'shoes'):
                    group = max(legs, key=score.get) if legs else side
                # A leg carries the pelvis in its skin (LEG_TORSO), so what leans on a thigh at all
                # - the hips, the waistband, the seat - goes with the leg and follows the pelvis
                # where the kit weighted it to: no seam at a line to tear open in a stride.
                elif legs:
                    group = max(legs, key=score.get)
            # Each corner is sampled a quarter of the way in towards the triangle's middle: the kit's
            # UV islands are tight and padded with the sheet's grey, and a corner exactly on an
            # island's edge took that grey - pale blotches all over the cloth.
            if uv:
                us = [Vector(uv[l].uv) for l in t.loops]
                mid = sum(us, Vector((0, 0))) / 3
                cols = [at(u + (mid - u) * SAMPLE_IN) for u in us]
            else:
                cols = [[.5, .5, .5]] * 3
            slot = {'hair': 'hair', 'eyes': 'wanderer', 'cloth': 'wanderer', 'skin': 'skin'}[kind]
            if kind == 'skin':
                mid = [sum(c[k] for c in cols) / 3 for k in range(3)]
                if sat(mid) < UNDERWEAR_SAT:
                    slot = 'underwear'
                    cols = [[u * lum(c) / .6 for u in UNDERWEAR] for c in cols]
            corners = []
            for vi, l, c in zip(t.vertices, t.loops, cols):
                n = (m3 @ mesh.corner_normals[l].vector).normalized()
                corners.append(dict(p=game(world[vi]), n=Vector((n.x, n.z, -n.y)), c=c, w=weights[vi]))
            # The crotch leans on both thighs, and a leg's skin knows only its own: drawn in both
            # legs, each copy follows its own thigh and the two overlap where one alone opened a slit.
            groups = [group]
            if group.endswith('Leg') and all(score.get(g, 0) / total > CROTCH for g in ('leftLeg', 'rightLeg')):
                groups = ['leftLeg', 'rightLeg']
            for g in groups:
                b = batches.setdefault((g, slot), dict(tris=[], hide={gid: [] for gid in cover}))
                b['tris'].append(corners)
                for gid, flags in cover.items():
                    b['hide'][gid].append(all(flags[vi] for vi in t.vertices))
            if kind == 'eyes':
                eye_ys.extend(c['p'].y for c in corners)
        # The kit's skin and hair maps are its own colours, made to be tinted: each corner becomes its
        # texel over the mean of the mesh's texels of that slot, so the shading stays and the look's
        # colour is what the hair and skin are on average.
        means = {}
        for slot in ('skin', 'hair'):
            cs = [c['c'] for (g, sl), b in batches.items() if sl == slot for corners in b['tris'] for c in corners]
            if cs:
                means[slot] = [max(1e-4, sum(c[k] for c in cs) / len(cs)) for k in range(3)]
        for (group, slot), b in sorted(batches.items()):
            part = dict(name=f'Wanderer {sex} {label} {group}' + ('' if slot in ('skin', 'hair', 'wanderer') else ' ' + slot),
                        slot=slot, variant=variant, group=group, positions=[], normals=[], colors=[])
            if slot in means:
                part['tint'] = True
            limb = group if group.endswith(('Arm', 'Leg')) else None
            if limb:
                part.update(skinGroup=limb, skin=[], skinIndices=[], skinWeights=[])
            torso = ARM_TORSO if limb and limb.endswith('Arm') else LEG_TORSO
            for corners in b['tris']:
                for c in corners:
                    col = [v / m for v, m in zip(c['c'], means[slot])] if slot in means else c['c']
                    part['positions'] += [round(x, 4) for x in c['p']]
                    part['normals'] += [round(x, 3) for x in c['n']]
                    part['colors'] += [round(x, 3) for x in col]
                    if not limb:
                        continue
                    per = {}
                    for bone, w in c['w'].items():
                        g, idx = classify(bone)
                        if g == limb:
                            pass
                        elif g in ('outfit', 'head'):
                            idx = torso[idx]
                        # The other thigh's share (the crotch, the seat's middle) goes to the pelvis:
                        # given to this thigh, the two halves of a seam each followed their own leg
                        # and opened between them.
                        elif limb.endswith('Leg') and g.endswith('Leg'):
                            idx = torso['pelvis']
                        else:
                            idx = 0
                        per[idx] = per.get(idx, 0) + w
                    total = sum(per.values()) or 1
                    part['skin'] += [round(per.get(1, 0) / total, 4), round(per.get(2, 0) / total, 4)]
                    top = sorted(per.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
                    s4 = sum(w for _, w in top) or 1
                    top += [(0, 0)] * (4 - len(top))
                    part['skinIndices'] += [i for i, _ in top]
                    part['skinWeights'] += [round(w / s4, 4) for _, w in top]
            runs = {gid: r for gid, flags in b['hide'].items() if (r := runs_of(flags))}
            if runs:
                part['hide'] = runs
            parts.append(part)

    for o in body_meshes:
        kind = {'Body eyes': 'eyes', 'Body brows': 'hair', 'Body skin': 'skin'}[o.name]
        emit(o, kind.replace('hair', 'brows'), 'body', kind, hides=list(garments) if kind == 'skin' else ())
    for sid, (arm, meshes) in hairs.items():
        for o in meshes:
            emit(o, f'hair {sid}', 'hair:' + sid, 'hair')
    for gid, o in garments.items():
        emit(o, gid, 'garment:' + gid, 'cloth', garment=gid.split('-')[1])
    eye_y = round(sum(eye_ys) / len(eye_ys), 4)
    parts += refit_gear(parts, rig)
    return dict(rig=rig, joints=joints, fingers=fingers, eyeY=eye_y, hair=next(iter(spec['hair'])),
                hairStyles=list(spec['hair']), garments=sorted(garments), parts=parts)


# The wardrobe (hats, pack, armour) is the Adventurer's, already fitted once from the Traveller's
# (build-adventurer.py), fitted again here by the same kind of measurement: the head's box onto
# this head's box, the torso pieces from the shoulders, the leg pieces along their leg. Every
# piece keeps its name, slot, variant and skin, so the inventory and classic-avatar.js's part
# lists work on these bodies unchanged.
ADV_TEXT = (ROOT / 'web/js/adventurer-mesh.js').read_text(encoding='utf8')
ADV_PARTS = json.loads(re.search(r'export const ADVENTURER_PARTS = (.*);', ADV_TEXT).group(1))
ADV_RIG = json.loads(re.search(r'export const ADVENTURER_RIG = (.*);', ADV_TEXT).group(1))
# Over this hair, a hat goes on a size up from the Adventurer's (his ponytail is tied back); the
# superhero torsos are deeper than his, so the pack and plate stand a little off them.
HAT_EASE = 1.06
TORSO_EASE = 1.04


def box(parts, pred):
    pts = [(p['positions'][i], p['positions'][i + 1], p['positions'][i + 2])
           for p in parts if pred(p) for i in range(0, len(p['positions']), 3)]
    lo = [min(v[k] for v in pts) for k in range(3)]
    hi = [max(v[k] for v in pts) for k in range(3)]
    return lo, hi


def refit_gear(parts, rig):
    old_head = box(ADV_PARTS, lambda p: p['variant'] == 'body' and p['group'] == 'head')
    # The head with its default hairstyle: what a hat goes over.
    new_head = box(parts, lambda p: p['group'] == 'head' and p['variant'] in ('body', 'hair:' + parts_hair(parts)))
    old_torso = box(ADV_PARTS, lambda p: p['variant'] == 'body' and p['group'] == 'outfit')
    new_torso = box(parts, lambda p: p['variant'] == 'body' and p['group'] == 'outfit' and p['slot'] == 'skin')
    w = lambda b, k: b[1][k] - b[0][k]
    hx = w(new_head, 0) / w(old_head, 0) * HAT_EASE
    hz = w(new_head, 2) / w(old_head, 2) * HAT_EASE
    hmid = lambda b, k: (b[0][k] + b[1][k]) / 2
    kx = rig['rightArm'][0] / ADV_RIG['rightArm'][0] * TORSO_EASE
    ky = (rig['rightArm'][1] - rig['rightLeg'][1]) / (ADV_RIG['rightArm'][1] - ADV_RIG['rightLeg'][1])
    kz = w(new_torso, 2) / w(old_torso, 2) * TORSO_EASE
    out = []
    for part in ADV_PARTS:
        if part['variant'] == 'body':
            continue
        leg = part.get('skinGroup', '')
        pos = part['positions']
        q = []
        for i in range(0, len(pos), 3):
            x, y, z = pos[i:i + 3]
            if part['group'] == 'head':
                x = (x - hmid(old_head, 0)) * hx + hmid(new_head, 0)
                y = (y - old_head[1][1]) * hx + new_head[1][1]
                z = (z - hmid(old_head, 2)) * hz + hmid(new_head, 2)
            elif leg.endswith('Leg'):
                ox, nx = ADV_RIG[leg][0], rig[leg][0]
                x = (x - ox) * kx + nx
                y = y * rig[leg][1] / ADV_RIG[leg][1]
                z = (z - ADV_RIG[leg][2]) * kz + rig[leg][2]
            else:
                x = x * kx
                y = (y - ADV_RIG['rightArm'][1]) * ky + rig['rightArm'][1]
                z = (z - old_torso[0][2]) * kz + new_torso[0][2]
            q += [round(x, 4), round(y, 4), round(z, 4)]
        out.append({**part, 'positions': q})
    return out


def parts_hair(parts):
    return next(p['variant'][5:] for p in parts if p['variant'].startswith('hair:'))


out = {sex: build(sex, spec) for sex, spec in BODIES.items()}
text = '// Generated by scripts/build-bodies.py in Blender. Do not edit.\n'
text += 'export const BODIES = ' + json.dumps(out, separators=(',', ':')) + ';\n'
(ROOT / 'web/js/bodies-mesh.js').write_text(text, encoding='utf8', newline='\n')
for sex, b in out.items():
    print('Exported', sex, sum(len(p['positions']) // 9 for p in b['parts']), 'triangles,', len(b['parts']), 'parts,',
          'garments', b['garments'], 'hair', b['hairStyles'])
