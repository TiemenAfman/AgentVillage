"""The island's residents in the Wanderer's style: a man and a woman, cut down to a crowd's budget,
and clothes worn over them one garment at a time (Plans/inwoners-in-avonturierstijl.md).

    node scripts/blender.mjs --background --python-exit-code 1 --python scripts/build-residents.py

reads the same CC0 Quaternius glTFs as the Wanderer (assets/bodies/source/, CREDITS.md there),
posed by the same functions (scripts/build-bodies.py, borrowed through runpy), and writes
web/js/residents-mesh.js and assets/residents/residents.blend - every part as an object with its
joint weights, in the rest pose the island draws - and two renders of a row of dressed residents
(assets/residents/renders/, ignored by git) to judge them by. Like build-bodies.py this script is
the source of truth: a hand edit in the .blend is lost on the next run.

What is different from the Wanderer, and why:

- **A crowd's budget.** The Wanderer is ~25k triangles dressed; three hundred of those is fifteen
  million a pass. Every piece is decimated here to a budget of its own (scripts/model-rules.mjs
  RESIDENT_BUDGETS, the one copy) so the heaviest outfit stays under RESIDENT_FIGURE.
- **Seventeen joints, two influences.** The kit's 65 bones fold into the joints a resident is
  posed by (JOINTS: hips, spine, chest, neck, head and per side shoulder, elbow, wrist, hip,
  knee, ankle - fingers into the wrist, the clavicle into the chest), and every vertex keeps the
  two heaviest, renormalised: a joint pair and the first one's weight. Two is enough for a knee
  and an elbow, and it is what keeps the instanced attributes small.
- **No skin under cloth.** A skin triangle every outfit covers is not baked at all; one only some
  outfits cover is its own part, drawn only with those (`shows`, a list of `<bottom>/<feet>`):
  the shins between the kit's breeches and a clog, the shins under a skirt. The cover test is the
  Wanderer's (a ray along the skin's normal into the cloth), eroded by a ring so a decimated edge
  still ends under the cloth rather than short of it.
- **Our own clothes.** The kit has one outfit; the island wants more. A skirt and a dress's long
  skirt are lathed round the hips from the body's own cross-sections, a vest is the shirt's torso
  stood off it with a V cut in front, an apron is a sheet hung from the waist, a scarf a ring at
  the base of the neck, and a clog a bevelled box round the foot. All of it carries weights like
  the kit's: a skirt hangs from the hips and follows a thigh more the nearer it is to the hem.
- **The face is geometry.** A decimated head loses what the texture drew, so eyes are small dark
  ellipsoids in the skin part (their corner colour dark, so the skin dye cannot lighten them), and
  brows two thin boxes beside them, a shade of the skin: a bald head is then no part at all.
- **Colour is a multiplier.** Every corner colour is shading round 1; the island multiplies it by
  the resident's own dye (`dye`: skin, hair, cloth, hat). Skin and hair keep their texture's hue
  over its mean, as the Wanderer's do; cloth keeps only its texture's light and dark over the
  median, so a shirt dyed poppy is poppy and not poppy-over-beige.
- **Hats are the residents' own** (web/js/villager-mesh.js), fitted from their old head's box onto
  this head with buzzed hair, by one uniform scale: the shapes stay the shapes the island knows.

The export (RESIDENTS) is plain arrays per corner, like every other bake: positions, normals,
colours, `joints` (two indices a corner) and `weights` (the first one's weight a corner).
"""
import bpy
import bmesh
import json
import math
import re
import runpy
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/residents'
B = runpy.run_path(str(ROOT / 'scripts/build-bodies.py'), run_name='bodies')
BODIES = B['BODIES']

# Source metres to island units. The resident stood 0.430 to the top of his head (villager-mesh.js);
# the kit's man is 1.81 m, so he stays that tall and the woman is the head shorter the kit made her.
S = .24

JOINTS = ['hips', 'spine', 'chest', 'neck', 'head',
          'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist',
          'leftHip', 'leftKnee', 'leftAnkle', 'rightHip', 'rightKnee', 'rightAnkle']
PARENTS = [-1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15]
J = {n: i for i, n in enumerate(JOINTS)}
# Which kit bone each joint is the head of (the kit's _r is at -x, which is the rig's left).
JOINT_BONE = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02', 'neck': 'neck_01', 'head': 'Head',
              'leftShoulder': 'upperarm_r', 'leftElbow': 'lowerarm_r', 'leftWrist': 'hand_r',
              'rightShoulder': 'upperarm_l', 'rightElbow': 'lowerarm_l', 'rightWrist': 'hand_l',
              'leftHip': 'thigh_r', 'leftKnee': 'calf_r', 'leftAnkle': 'foot_r',
              'rightHip': 'thigh_l', 'rightKnee': 'calf_l', 'rightAnkle': 'foot_l'}


def joint_of(bone):
    """The joint a kit bone deforms with."""
    side = 'left' if bone.endswith('_r') else 'right' if bone.endswith('_l') else None
    if side:
        for word, j in (('upperarm', 'Shoulder'), ('lowerarm', 'Elbow'), ('thigh', 'Hip'), ('calf', 'Knee'),
                        ('foot', 'Ankle'), ('ball', 'Ankle')):
            if bone.startswith(word):
                return J[side + j]
        if bone.startswith('clavicle'):
            return J['chest']
        return J[side + 'Wrist']             # the hand and every finger
    return {'spine_01': J['spine'], 'spine_02': J['chest'], 'spine_03': J['chest'],
            'neck_01': J['neck'], 'Head': J['head']}.get(bone, J['hips'])


# Triangles each piece is decimated to; the ceilings these must stay under are model-rules.mjs's.
TARGET = {'face': 560, 'arms': 230, 'bare': 200, 'shirt': 440, 'trousers': 290, 'shoes': 140,
          'straps': 100, 'vest': 140, 'hair': 260}
# The two choices that decide which skin shows: what is worn on the legs and on the feet.
BOTTOMS = ['trousers', 'skirt']
FEET = ['shoes', 'clogs']
COMBOS = [f'{b}/{f}' for b in BOTTOMS for f in FEET]
COVER_IN, COVER_OUT = B['COVER_IN'], B['COVER_OUT']
# Cloth stood off what it is worn over, in source metres.
# The vest is decimated after it is stood off, and a collapse pulls a surface in: at 1 cm half of it
# sank back into the shirt and only its hem and lapels showed.
VEST_OFF = .022
SKIRT_EASE = .018
EYE_DARK = .14
BROW_DARK = .3           # a brow's: a shade of the skin's own colour, darker than any hair dye would make it           # an eye's corner colour: dark under any skin dye
SAMPLE_IN = B['SAMPLE_IN']


def game(v):
    return Vector((v.x * S, v.z * S, -v.y * S))


def tris_of(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def strip_modifiers(obj):
    for m in list(obj.modifiers):
        obj.modifiers.remove(m)


def to_joints(obj, weights=None):
    """Replace the kit's vertex groups by the seventeen joints, summing what folds together."""
    w = weights if weights is not None else B['weights_of'](obj)
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = [obj.vertex_groups.new(name=n) for n in JOINTS]
    for vi, d in enumerate(w):
        acc = {}
        for bone, x in d.items():
            j = bone if isinstance(bone, int) else joint_of(bone)
            acc[j] = acc.get(j, 0) + x
        for j, x in acc.items():
            if x > 0:
                groups[j].add([vi], x, 'REPLACE')


def joint_weights(obj):
    """Per vertex: {joint: weight} from the joint groups."""
    names = {g.index: J[g.name] for g in obj.vertex_groups if g.name in J}
    return [{names[g.group]: g.weight for g in v.groups if g.group in names and g.weight > 0}
            for v in obj.data.vertices]


def keep_faces(obj, keep, name):
    """A copy of obj with only the faces whose index is in `keep`."""
    new = obj.copy()
    new.data = obj.data.copy()
    new.name = new.data.name = name
    bpy.context.collection.objects.link(new)
    bm = bmesh.new()
    bm.from_mesh(new.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(new.data)
    bm.free()
    return new


def decimate(obj, target):
    """Collapse to at most `target` triangles, symmetric about x, vertex groups and UVs carried."""
    for _ in range(6):
        n = tris_of(obj)
        if n <= target:
            return n
        B['active'](obj)
        mod = obj.modifiers.new('Decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = max(.01, target / n * (.98 if _ else 1))
        mod.use_collapse_triangulate = True
        mod.use_symmetry = True
        mod.symmetry_axis = 'X'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return tris_of(obj)


def mesh_object(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 1


def emit(obj, colour, invert=False):
    """The object's triangles as the bake's arrays: positions, normals, colours, joints, weights.
    `colour(tri, corner_loop, vertex)` -> [r, g, b]; `invert` flips the winding (an inner shell)."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    m3 = obj.matrix_world.to_3x3()
    w = joint_weights(obj)
    out = dict(positions=[], normals=[], colors=[], joints=[], weights=[])
    for t in mesh.loop_triangles:
        corners = list(zip(t.vertices, t.loops))
        if invert:
            corners.reverse()
        for vi, l in corners:
            p = game(obj.matrix_world @ mesh.vertices[vi].co)
            n = (m3 @ mesh.corner_normals[l].vector).normalized()
            n = Vector((n.x, n.z, -n.y)) * (-1 if invert else 1)
            top = sorted(w[vi].items(), key=lambda kv: (-kv[1], kv[0]))[:2] or [(J['hips'], 1)]
            if len(top) == 1:
                top.append((top[0][0], 0))
            s = top[0][1] + top[1][1] or 1
            out['positions'] += [round(x, 4) for x in p]
            out['normals'] += [round(x, 3) for x in n]
            out['colors'] += [round(x, 3) for x in colour(t, l, vi)]
            out['joints'] += [top[0][0], top[1][0]]
            out['weights'].append(round(top[0][1] / s, 3))
    return out


def concat(*arrs):
    out = dict(positions=[], normals=[], colors=[], joints=[], weights=[])
    for a in arrs:
        for k in out:
            out[k] += a[k]
    return out


def texture_colour(obj, mode):
    """Corner colours from the object's texture: 'tint' keeps the hue over the mean (skin, hair),
    'cloth' keeps only light and dark over the median (a garment is dyed whole)."""
    img = B['base_image'](obj)
    at = B['sampler'](img)
    mesh = obj.data
    uv = mesh.uv_layers.active.data if mesh.uv_layers.active else None
    mesh.calc_loop_triangles()
    raw = {}
    for t in mesh.loop_triangles:
        if not uv:
            for l in t.loops:
                raw[l] = [1, 1, 1]
            continue
        us = [Vector(uv[l].uv) for l in t.loops]
        mid = sum(us, Vector((0, 0))) / 3
        for l, u in zip(t.loops, us):
            raw[l] = at(u + (mid - u) * SAMPLE_IN)
    if mode == 'tint':
        mean = [max(1e-4, sum(c[k] for c in raw.values()) / max(1, len(raw))) for k in range(3)]
        fix = {l: [min(1.6, c[k] / mean[k]) for k in range(3)] for l, c in raw.items()}
    else:
        mid = max(1e-4, median([B['lum'](c) for c in raw.values()]))
        fix = {l: [max(.3, min(1.25, B['lum'](c) / mid))] * 3 for l, c in raw.items()}
    return lambda t, l, vi: fix[l]


def plain(v=1.0):
    return lambda t, l, vi: [v, v, v]


# ---- measuring the body -------------------------------------------------------------------

def slab(points, z, half=.025):
    return [p for p in points if abs(p.z - z) < half]


def ring_radii(points, cx, cy, z, bins, half=.03):
    """The body's outline at height z: per angular bin, the furthest point from (cx, cy)."""
    r = [0.0] * bins
    for p in slab(points, z, half):
        a = math.atan2(p.y - cy, p.x - cx) % math.tau
        k = int(a / math.tau * bins) % bins
        r[k] = max(r[k], math.hypot(p.x - cx, p.y - cy))
    # Bins with nothing in them (the gap between the legs) take their neighbours' reach.
    for _ in range(bins):
        for k in range(bins):
            if r[k] == 0:
                r[k] = max(r[(k - 1) % bins], r[(k + 1) % bins])
    return r


def lathe(name, cx, cy, rings, bins, inner=True):
    """A skirt-like surface: `rings` is [(z, [radius per bin])] top to bottom. With `inner`, the
    same surface again facing in, so the skirt is not see-through from below."""
    verts, faces = [], []
    for z, radii in rings:
        for k in range(bins):
            a = (k + .5) / bins * math.tau
            verts.append((cx + radii[k] * math.cos(a), cy + radii[k] * math.sin(a), z))
    for j in range(len(rings) - 1):
        for k in range(bins):
            a, b = j * bins + k, j * bins + (k + 1) % bins
            c, d = a + bins, b + bins
            faces.append((a, c, d, b))
    n = len(verts)
    if inner:
        shrink = .004
        for z, radii in rings:
            for k in range(bins):
                a = (k + .5) / bins * math.tau
                r = radii[k] - shrink
                verts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
        for j in range(len(rings) - 1):
            for k in range(bins):
                a, b = n + j * bins + k, n + j * bins + (k + 1) % bins
                faces.append((a, b, b + bins, a + bins))
    return mesh_object(name, verts, faces)


def skirt_weights(obj, z_top, z_hem, x_hip, thigh_most=.9):
    """A skirt hangs from the hips and swings with a thigh more the nearer it is to the hem; the
    middle front and back (no thigh of their own) stay with the hips, or they would tear in two."""
    w = []
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        down = max(0, min(1, (z_top - p.z) / (z_top - z_hem)))
        # Over half the hip's width already follows its thigh: at the hip's full width the knee of a
        # leg swung forward came out through the front of the skirt.
        side = min(1, abs(p.x) / (.5 * x_hip))
        t = thigh_most * down * side
        thigh = J['leftHip'] if p.x < 0 else J['rightHip']
        w.append({J['hips']: 1 - t, thigh: t} if t > 0 else {J['hips']: 1})
    return w


def nearest_weights(obj, source):
    """Weights for a garment of our own: those of the nearest vertex of what it is worn over."""
    sw = joint_weights(source)
    pts = [source.matrix_world @ v.co for v in source.data.vertices]
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    out = []
    for v in obj.data.vertices:
        acc = {}
        for _, i, d in kd.find_n(obj.matrix_world @ v.co, 3):
            for j, x in sw[i].items():
                acc[j] = acc.get(j, 0) + x / (d + 1e-3)
        s = sum(acc.values()) or 1
        out.append({j: x / s for j, x in acc.items()})
    return out


def box_object(name, lo, hi, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
    obj = bpy.context.object
    obj.name = obj.data.name = name
    obj.scale = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width, mod.segments = bevel, 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return obj


def ellipsoid(name, centre, radii, segs=6, rings=3):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1, location=centre)
    obj = bpy.context.object
    obj.name = obj.data.name = name
    obj.scale = radii
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
    return obj


def bounds(points):
    return ([min(p[k] for p in points) for k in range(3)], [max(p[k] for p in points) for k in range(3)])


def world_points(obj):
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def build(sex, spec):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body_arm, body_meshes = B['import_gltf'](spec['body'])
    hairs = {sid: B['import_gltf'](f) for sid, f in spec['hair'].items()}
    sets = {sid: B['import_gltf'](f) for sid, f in spec['sets'].items()}
    target = B['pose_body'](body_arm)
    for arm, _ in [*hairs.values(), *sets.values()]:
        B['pose_onto'](arm, target)
    bpy.context.view_layer.update()
    joints = {n: body_arm.matrix_world @ target[b].to_translation() for n, b in JOINT_BONE.items()}

    B['apply_rest'](body_arm, body_meshes)
    for arm, meshes in [*hairs.values(), *sets.values()]:
        B['apply_rest'](arm, meshes)
    skin = eyes = brows = None
    for o in body_meshes:
        mat = o.data.materials[0].name if o.data.materials else ''
        if 'Eyes' in mat:
            eyes = o
        elif 'Hair' in mat:
            brows = o
        else:
            skin = o
    garments = {}
    for sid, (arm, meshes) in sets.items():
        garments.update(B['split_garments'](sid, meshes))
    garments = {gid.split('-')[1]: o for gid, o in garments.items()}

    # The rest pose is the mesh now; the rigs are not needed again.
    every = [skin, eyes, brows, *garments.values(), *(m for _, ms in hairs.values() for m in ms)]
    for o in every:
        strip_modifiers(o)
        o.parent = None
    bpy.context.view_layer.update()
    for o in every:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)

    # Cloth: no bare hands (the kit paints the woman's into her sleeves) and no Regular forearms.
    for slot, o in garments.items():
        w = B['weights_of'](o)
        o.data.calc_loop_triangles()
        regular = {i for i, m in enumerate(o.data.materials) if m and 'Regular' in m.name}
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        drop = [f for f in bm.faces if f.material_index in regular or B['bare_hand'](w, [v.index for v in f.verts])]
        bmesh.ops.delete(bm, geom=drop, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(o.data)
        bm.free()
    for o in [skin, *garments.values(), *(m for _, ms in hairs.values() for m in ms)]:
        to_joints(o)

    # The body as measured for clothes, without its arms: they hang beside the hips, and a skirt
    # measured round them would be a bell with the arms inside it.
    sk = joint_weights(skin)
    arm_joints = {J[n] for n in ('leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist')}
    all_pts = world_points(skin)
    body_pts = [p for p, w in zip(all_pts, sk) if sum(x for j, x in w.items() if j in arm_joints) < .3]
    pelvis, knee_l, knee_r = joints['hips'], joints['leftKnee'], joints['rightKnee']
    ankle = joints['leftAnkle']
    knee_z = (knee_l.z + knee_r.z) / 2
    hip_x = abs(joints['leftHip'].x)
    cx, cy = 0.0, pelvis.y

    # ---- our own garments ------------------------------------------------------------------
    BINS = 16

    def skirt(name, z_top, z_hem, rings_n):
        rings, prev = [], None
        for j in range(rings_n):
            z = z_top + (z_hem - z_top) * j / (rings_n - 1)
            r = ring_radii(body_pts, cx, cy, z, BINS) if z > knee_z else [0] * BINS
            r = [max(r[(k - 1) % BINS], r[k], r[(k + 1) % BINS]) + SKIRT_EASE for k in range(BINS)]
            if prev:
                # Below the widest of the hips it only falls outward: it hangs, it does not wrap a leg.
                flare = .012 if z < pelvis.z else 0
                r = [max(a, b + flare) for a, b in zip(r, prev)]
            rings.append((z, r))
            prev = r
        obj = lathe(name, cx, cy, rings, BINS)
        to_joints(obj, skirt_weights(obj, z_top, z_hem, hip_x))
        return obj

    waist = joints['spine'].z + .02
    own = {}
    own['skirt'] = skirt('Skirt', waist, knee_z - .08, 5)
    long_skirt = skirt('Dress skirt', waist, (knee_z + ankle.z) / 2 + .02, 6)

    # The vest: the shirt's torso (not its sleeves), stood off it, with a V cut down the front.
    shirt = garments['shirt']
    sw = joint_weights(shirt)
    chest_z = joints['chest'].z
    keep = set()
    shirt.data.calc_loop_triangles()
    for f in shirt.data.polygons:
        armw = sum(sw[v].get(j, 0) for v in f.vertices for j in arm_joints)
        tot = sum(sum(sw[v].values()) for v in f.vertices) or 1
        c = shirt.matrix_world @ f.center
        front = c.y < cy
        vee = abs(c.x) < .03 + .55 * max(0, c.z - (chest_z - .06))
        if armw / tot < .25 and not (front and vee) and c.z > waist - .06:
            keep.add(f.index)
    vest = keep_faces(shirt, keep, 'Vest')
    for v in vest.data.vertices:
        v.co += v.normal * VEST_OFF
    own['vest'] = vest

    # The dress: a shirt's top and a long skirt in one cloth.
    dress_top = shirt.copy()
    dress_top.data = shirt.data.copy()
    bpy.context.collection.objects.link(dress_top)

    # The apron: a sheet hung from the waist, flat in front of whatever is widest under it.
    front_pts = [p for p in body_pts + world_points(own['skirt']) if abs(p.x) < .16]
    a_top, a_bot = waist - .02, knee_z + .03
    rows, cols = 5, 4
    verts, faces = [], []
    ys = []
    for j in range(rows):
        z = a_top + (a_bot - a_top) * j / (rows - 1)
        band = [p.y for p in front_pts if abs(p.z - z) < .04] or [cy - .12]
        y = min(band) - .012
        ys.append(min(y, ys[-1]) if ys else y)
    for side, dy in ((0, 0), (1, .005)):
        for j in range(rows):
            z = a_top + (a_bot - a_top) * j / (rows - 1)
            half = .14 + .03 * j / (rows - 1)
            for k in range(cols):
                verts.append((-half + 2 * half * k / (cols - 1), ys[j] + dy, z))
    n = rows * cols
    for j in range(rows - 1):
        for k in range(cols - 1):
            a = j * cols + k
            faces.append((a, a + 1, a + cols + 1, a + cols))
            faces.append((n + a, n + a + cols, n + a + cols + 1, n + a + 1))
    for j in range(rows - 1):         # the two side edges
        for k in (0, cols - 1):
            a = j * cols + k
            faces.append((a, a + cols, n + a + cols, n + a) if k == 0 else (a, n + a, n + a + cols, a + cols))
    for k in range(cols - 1):         # the hem
        a = (rows - 1) * cols + k
        faces.append((a, n + a, n + a + 1, a + 1))
    apron = mesh_object('Apron', verts, faces)
    # And its tie, a band round the waist.
    r = ring_radii(body_pts, cx, cy, a_top, 10)
    tie = lathe('Apron tie', cx, cy, [(a_top + .012, [x + .012 for x in r]), (a_top - .012, [x + .012 for x in r])], 10, inner=False)
    B['active'](apron)
    tie.select_set(True)
    bpy.ops.object.join()
    apron = bpy.context.view_layer.objects.active
    to_joints(apron, skirt_weights(apron, a_top, a_bot, hip_x, .8))
    own['apron'] = apron

    # The scarf: a ring at the base of the neck over the collar, and a tail hanging in front.
    neck = joints['neck']
    rn = ring_radii([p for p in body_pts if abs(p.x) < .09], 0, neck.y, neck.z + .02, 8, .015)
    ring = [x + .022 for x in rn]
    scarf = lathe('Scarf', 0, neck.y, [(neck.z + .025, [x * .92 for x in ring]), (neck.z, ring),
                                       (neck.z - .03, [x * .95 for x in ring])], 8, inner=False)
    front_y = neck.y - max(rn) - .01
    tail = box_object('Scarf tail', (.02, front_y - .02, neck.z - .17), (.07, front_y, neck.z - .01))
    B['active'](scarf)
    tail.select_set(True)
    bpy.ops.object.join()
    scarf = bpy.context.view_layer.objects.active
    to_joints(scarf, [{J['chest']: .7, J['neck']: .3} if (scarf.matrix_world @ v.co).z > neck.z - .02 else {J['chest']: 1}
                      for v in scarf.data.vertices])
    own['scarf'] = scarf

    # Clogs: a bevelled box round each foot, up to the ankle, toe a little longer than the foot.
    foot_pts = [p for p in body_pts if p.z < ankle.z + .02]
    clog_parts = []
    for side, sign in (('left', -1), ('right', 1)):
        pts = [p for p in foot_pts if p.x * sign > 0]
        lo, hi = bounds(pts)
        lo = (lo[0] - .012, lo[1] - .02, 0.0)
        hi = (hi[0] + .012, hi[1] + .012, ankle.z + .015)
        c = box_object(f'Clog {side}', lo, hi, bevel=.02)
        to_joints(c, [{J[side + 'Ankle']: 1}] * len(c.data.vertices))
        clog_parts.append(c)
    B['active'](clog_parts[0])
    clog_parts[1].select_set(True)
    bpy.ops.object.join()
    own['clogs'] = bpy.context.view_layer.objects.active

    # ---- which skin shows -----------------------------------------------------------------
    cloth = {}
    for name, o in (('shirt', shirt), ('trousers', garments['trousers']), ('shoes', garments['shoes']),
                    ('skirt', own['skirt']), ('clogs', own['clogs'])):
        o.data.calc_loop_triangles()
        cloth[name] = BVHTree.FromPolygons(world_points(o), [list(t.vertices) for t in o.data.loop_triangles])
    mesh = skin.data
    body_pts = all_pts
    normals = [v.normal.normalized() for v in mesh.vertices]
    adj = [set() for _ in mesh.vertices]
    for e in mesh.edges:
        a, b = e.vertices
        adj[a].add(b)
        adj[b].add(a)

    def covered(tree):
        hit = [tree.ray_cast(p - n * COVER_IN, n, COVER_IN + COVER_OUT)[0] is not None
               for p, n in zip(body_pts, normals)]
        # Eroded by a ring: a vertex counts as under the cloth only if its neighbours are too.
        return [h and all(hit[k] for k in adj[i]) for i, h in enumerate(hit)]

    cov = {name: covered(t) for name, t in cloth.items()}
    sig = {}
    for f in mesh.polygons:
        vs = f.vertices
        under = lambda name: all(cov[name][v] for v in vs)
        if under('shirt'):
            continue
        shows = tuple(c for c in COMBOS if not (under(c.split('/')[0]) or under(c.split('/')[1])))
        if shows:
            sig.setdefault(shows, set()).add(f.index)

    sw = joint_weights(skin)
    face_j = {J['head'], J['neck'], J['chest'], J['spine'], J['hips']}
    pieces = []
    always = tuple(COMBOS)
    for shows, faces_ in sorted(sig.items(), key=lambda kv: (-len(kv[0]), kv[0])):
        if shows == always:
            # The head and neck get most of the budget; the arms (forearms and hands) little.
            def heavy(fi):
                acc = {}
                for v in mesh.polygons[fi].vertices:
                    for j, x in sw[v].items():
                        acc[j] = acc.get(j, 0) + x
                return max(acc, key=acc.get) if acc else J['head']
            head = {fi for fi in faces_ if heavy(fi) in face_j}
            for key, group in (('face', head), ('arms', faces_ - head)):
                if group:
                    pieces.append((shows, key, keep_faces(skin, group, f'Skin {key}')))
        else:
            pieces.append((shows, 'bare', keep_faces(skin, faces_, 'Skin ' + '+'.join(shows))))
    bare_total = sum(len(f) for s, f in sig.items() if s != always) or 1

    parts = []

    def part(pid, kind, dye, arrays, **extra):
        parts.append(dict(name=f'Resident {sex} {pid}', sex=sex, id=pid, kind=kind, dye=dye, **extra, **arrays))

    # Eyes: the kit's, as two small dark ellipsoids where its eyeballs are.
    eye_pts = world_points(eyes)
    eye_objs = []
    for side, sign in (('left', -1), ('right', 1)):
        lo, hi = bounds([p for p in eye_pts if p.x * sign > 0])
        c = Vector(((lo[0] + hi[0]) / 2, lo[1] + .002, (lo[2] + hi[2]) / 2))
        # The kit's eyeball is the whole socket; drawn that size in one dark colour it read as a
        # hollow, so only the iris's share of it.
        e = ellipsoid(f'Eye {side}', c, ((hi[0] - lo[0]) * .28, .005, (hi[2] - lo[2]) * .3))
        to_joints(e, [{J['head']: 1}] * len(e.data.vertices))
        eye_objs.append(e)
    face = []
    for shows, key, obj in pieces:
        n = len(obj.data.polygons)
        goal = TARGET[key] if key != 'bare' else max(12, round(TARGET['bare'] * n / bare_total))
        # The texture is sampled by the corner's UV, which the collapse carries along.
        decimate(obj, goal)
        arr = emit(obj, texture_colour(obj, 'tint'))
        if shows == always:
            face.append(arr)
        else:
            part('skin:' + '+'.join(shows), 'skin', 'skin', arr, shows=list(shows))
    for e in eye_objs:
        face.append(emit(e, plain(EYE_DARK)))
    # Brows: two thin boxes where the kit's brows are, in the skin part like the eyes - dark under
    # any skin dye - so a bald head is no part of its own and costs no draw call.
    brow_pts = world_points(brows)
    for side, sign in (('left', -1), ('right', 1)):
        lo, hi = bounds([p for p in brow_pts if p.x * sign > 0])
        b = box_object(f'Brow {side}', (lo[0], lo[1] - .002, (lo[2] + hi[2]) / 2 - .003),
                       (hi[0], lo[1] + .006, (lo[2] + hi[2]) / 2 + .004))
        to_joints(b, [{J['head']: 1}] * len(b.data.vertices))
        face.append(emit(b, plain(BROW_DARK)))
    part('skin', 'skin', 'skin', concat(*face), shows=list(always))
    parts.sort(key=lambda p: p['id'] != 'skin')

    for sid, (arm, meshes) in hairs.items():
        B['active'](meshes[0])
        for m in meshes[1:]:
            m.select_set(True)
        if len(meshes) > 1:
            bpy.ops.object.join()
        h = bpy.context.view_layer.objects.active
        decimate(h, TARGET['hair'])
        part('hair:' + sid, 'hair', 'hair', emit(h, texture_colour(h, 'tint')))

    for slot in ('shirt', 'trousers', 'shoes', 'straps'):
        o = garments[slot]
        decimate(o, TARGET[slot])
        part(slot, 'garment', 'cloth', emit(o, texture_colour(o, 'cloth')))
    decimate(own['vest'], TARGET['vest'])
    part('vest', 'garment', 'cloth', emit(own['vest'], plain(.92)))
    decimate(dress_top, TARGET['shirt'])
    part('dress', 'garment', 'cloth', concat(emit(dress_top, texture_colour(dress_top, 'cloth')),
                                             emit(long_skirt, plain(1))))
    for slot in ('skirt', 'apron', 'scarf', 'clogs'):
        part(slot, 'garment', 'cloth', emit(own[slot], plain(1)))

    parts += hats(sex, parts)
    g = lambda v: [round(x, 4) for x in game(v)]
    rig = dict(joints=JOINTS, parents=PARENTS, points=[g(joints[n]) for n in JOINTS])
    rig['eyeY'] = round(sum(game(sum(world_points(e), Vector()) / len(e.data.vertices)).y for e in eye_objs) / 2, 4)
    rig['height'] = round(max(parts[0]['positions'][1::3]), 4)
    return dict(rig=rig, parts=parts)


# ---- hats -----------------------------------------------------------------------------------
VILLAGER = json.loads(re.search(r'export const SETTLER_PARTS = (.*);',
                                (ROOT / 'web/js/villager-mesh.js').read_text(encoding='utf8')).group(1))
HAT_SHAPES = ['wide', 'band', 'cap', 'sailor', 'dome', 'wizard']
# A size up from the bare head: a hat goes on over hair.
HAT_EASE = 1.12


def hats(sex, parts):
    def box(points):
        return bounds([points[i:i + 3] for i in range(0, len(points), 3)])
    old = box([x for p in VILLAGER if p['variant'] == 'head' for x in p['positions']])
    head = next(p for p in parts if p['id'] == 'skin')
    hair = next((p for p in parts if p['id'] == 'hair:buzzed'), None)
    pts = []
    for p in (head, hair):
        if not p:
            continue
        for i in range(0, len(p['positions']), 3):
            if p['joints'][i // 3 * 2] == J['head'] and p['weights'][i // 3] > .5:
                pts += p['positions'][i:i + 3]
    new = box(pts)
    k = (new[1][0] - new[0][0]) / (old[1][0] - old[0][0]) * HAT_EASE
    mid = lambda b, i: (b[0][i] + b[1][i]) / 2
    out = []
    for shape in HAT_SHAPES:
        positions = []
        for p in VILLAGER:
            if p['variant'] != shape:
                continue
            for i in range(0, len(p['positions']), 3):
                x, y, z = p['positions'][i:i + 3]
                positions += [round((x - mid(old, 0)) * k + mid(new, 0), 4),
                              round((y - old[1][1]) * k + new[1][1], 4),
                              round((z - mid(old, 2)) * k + mid(new, 2), 4)]
        n = len(positions) // 3
        normals = []
        for i in range(0, len(positions), 9):
            a, b, c = (Vector(positions[i + j * 3:i + j * 3 + 3]) for j in range(3))
            nn = (b - a).cross(c - a).normalized()
            normals += [round(x, 3) for x in nn] * 3
        out.append(dict(name=f'Resident {sex} hat:{shape}', sex=sex, id='hat:' + shape, kind='hat', dye='hat',
                        positions=positions, normals=normals, colors=[1] * (3 * n),
                        joints=[J['head'], J['head']] * n, weights=[1] * n))
    return out


# ---- the .blend, the module, the renders ------------------------------------------------------

def part_object(part, colour=None, pose=None, offset=(0, 0, 0), collection=None):
    """A part as a Blender object in island-to-Blender axes: from the bake's own arrays, so what
    is saved and rendered is what the island gets. `colour` multiplies the corner colours,
    `pose` is a list of 4x4 joint matrices (island frame) to skin it by."""
    pos, nrm = part['positions'], part['normals']
    n = len(pos) // 3
    verts, faces = [], []
    for i in range(n):
        p = Vector(pos[i * 3:i * 3 + 3])
        if pose:
            a, b = part['joints'][i * 2], part['joints'][i * 2 + 1]
            w = part['weights'][i]
            p = (pose[a] @ p) * w + (pose[b] @ p) * (1 - w)
        verts.append((p.x + offset[0], -p.z + offset[1], p.y + offset[2]))
    for t in range(n // 3):
        faces.append((t * 3, t * 3 + 1, t * 3 + 2))
    obj = mesh_object(part['name'], verts, faces)
    if collection:
        bpy.context.collection.objects.unlink(obj)
        collection.objects.link(obj)
    col = obj.data.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    tint = colour or (1, 1, 1)
    for li, loop in enumerate(obj.data.loops):
        c = part['colors'][loop.vertex_index * 3:loop.vertex_index * 3 + 3]
        col.data[li].color = (c[0] * tint[0], c[1] * tint[1], c[2] * tint[2], 1)
    if not pose:
        for jname in JOINTS:
            obj.vertex_groups.new(name=jname)
        for i in range(n):
            a, b = part['joints'][i * 2], part['joints'][i * 2 + 1]
            w = part['weights'][i]
            obj.vertex_groups[a].add([i], w, 'ADD')
            if b != a and w < 1:
                obj.vertex_groups[b].add([i], 1 - w, 'ADD')
    for f in obj.data.polygons:
        f.use_smooth = True
    return obj


def main():
    out = {}
    for sex, spec in BODIES.items():
        out[sex] = build(sex, spec)
        print('Residents:', sex, {p['id']: len(p['positions']) // 9 for p in out[sex]['parts']})
    text = '// Generated by scripts/build-residents.py in Blender. Do not edit.\n'
    text += 'export const RESIDENTS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
    (ROOT / 'web/js/residents-mesh.js').write_text(text, encoding='utf8', newline='\n')

    bpy.ops.wm.read_factory_settings(use_empty=True)
    for sex, data in out.items():
        coll = bpy.data.collections.new(sex)
        bpy.context.scene.collection.children.link(coll)
        for p in data['parts']:
            part_object(p, collection=coll)
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'residents.blend'))
    runpy.run_path(str(ROOT / 'scripts/preview-residents.py'), init_globals={'RESIDENTS': out, 'part_object': part_object},
                   run_name='residents_preview')


if __name__ == '__main__':
    main()
