"""Bake Mixamo clips into web/js/gait-clips.js, for the player's rig to play (Plans/tweede-avonturier.md).

    node scripts/blender.mjs --background --python scripts/bake-mixamo-gait.py

reads assets/mixamo/clips.json (a name for each clip and its FBX in that folder);
the skill .claude/skills/mixamo-clips/SKILL.md has the whole route for a new one.

Each clip is sampled at SAMPLES evenly spaced phases of one cycle and, for every joint of the
player's rig (web/js/classic-avatar.js), the rotation that joint has in it relative to its
parent, as a quaternion in the rig's own frame:

    pelvis  spine  chest  neck  head                    Hips, Spine+Spine1, Spine2, Neck, Head
    lClavicle lArm lElbow lWrist  (and r...)            Shoulder, Arm, ForeArm, Hand
    lHip lKnee lAnkle lToe        (and r...)            UpLeg, Leg, Foot, ToeBase

plus `drop`, how far the hips are below their rest height, in leg lengths; and per clip its
stride and speed in leg lengths, which the rig scales by its own leg. Fingers are not carried:
the player's hands are gloves in one piece.

How a rotation gets to the rig:
- a joint's change is its world rotation now against its world rotation at rest, D = W W0^-1,
  and what it turns by itself is that against its parent's, L = Dparent^-1 D;
- Mixamo's rest is a T-pose and ours hangs its arms (and stands its legs straight down), so the
  arm and leg chains' rests are first turned, whole, to point straight down (`align`): the
  elbow, wrist, knee and ankle then keep exactly the turn they have in the clip;
- Blender's world (X the body's left, -Y forward, Z up) to three's (X left, Z forward, Y up),
  and then the rig's mirror (classic-avatar.js: object.scale.x = -1): a rotation about axis a
  goes to one about (ax, -ay, -az) of the three axis, which is (xb, -zb, yb) of Blender's.
A clip downloaded with In Place has no stride to read and is refused.
"""
import bpy
import json
import sys
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parent.parent
# Samples per clip: 32 for a step cycle, about twelve a second for a long one (an idle, a swim).
SAMPLES_MIN, SAMPLES_PER_S = 32, 12
# Our joint -> (the Mixamo bone it turns with, its parent's). Spine and Spine1 are one joint
# for us (the small of the back), so `spine` turns by both.
JOINTS = {
    'pelvis': ('Hips', None), 'spine': ('Spine1', 'Hips'), 'chest': ('Spine2', 'Spine1'),
    'neck': ('Neck', 'Spine2'), 'head': ('Head', 'Neck'),
}
for s, k in (('Left', 'l'), ('Right', 'r')):
    JOINTS.update({
        k + 'Clavicle': (s + 'Shoulder', 'Spine2'), k + 'Arm': (s + 'Arm', s + 'Shoulder'),
        k + 'Elbow': (s + 'ForeArm', s + 'Arm'), k + 'Wrist': (s + 'Hand', s + 'ForeArm'),
        k + 'Hip': (s + 'UpLeg', 'Hips'), k + 'Knee': (s + 'Leg', s + 'UpLeg'),
        k + 'Ankle': (s + 'Foot', s + 'Leg'), k + 'Toe': (s + 'ToeBase', s + 'Foot'),
    })
NAMES = list(JOINTS)
ARM = ('Arm', 'ForeArm', 'Hand')
LEG = ('UpLeg', 'Leg', 'Foot', 'ToeBase')

# The clips: assets/mixamo/clips.json (name -> file in that folder), unless named on the command
# line as name=path.fbx. The module is written whole every time, so the list is the whole set.
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if args:
    clips = dict(a.split('=', 1) for a in args)
else:
    listed = json.loads((ROOT / 'assets/mixamo/clips.json').read_text())
    clips = {name: str(ROOT / 'assets/mixamo' / file) for name, file in listed.items()}
if not clips:
    raise SystemExit('no clips: list them in assets/mixamo/clips.json')


def to_rig(q):
    """A rotation in Blender's world axes, in the rig's mirrored three.js frame."""
    return Quaternion((q.w, q.x, -q.z, q.y))


def measure(clip, path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    scene = bpy.context.scene
    f0, f1 = (int(v) for v in arm.animation_data.action.frame_range)
    world = arm.matrix_world.to_quaternion()

    def bone(n):
        return arm.pose.bones['mixamorig:' + n]

    def head(n):
        return arm.matrix_world @ bone(n).head

    # Rest, and the arm and leg chains turned to hang straight down.
    rest = {}
    for b in arm.data.bones:
        rest[b.name[len('mixamorig:'):]] = world @ b.matrix_local.to_quaternion()
    for s in ('Left', 'Right'):
        for chain, top, nxt in ((ARM, s + 'Arm', s + 'ForeArm'), (LEG, s + 'UpLeg', s + 'Leg')):
            a, b = arm.matrix_world @ arm.data.bones['mixamorig:' + top].head_local, \
                arm.matrix_world @ arm.data.bones['mixamorig:' + nxt].head_local
            align = (b - a).normalized().rotation_difference(Vector((0, 0, -1)))
            for n in chain:
                rest[s + n] = align @ rest[s + n]
    rest_hips = (arm.matrix_world @ arm.data.bones['mixamorig:Hips'].head_local).z
    leg = (arm.data.bones['mixamorig:LeftUpLeg'].head_local - arm.data.bones['mixamorig:LeftLeg'].head_local).length \
        + (arm.data.bones['mixamorig:LeftLeg'].head_local - arm.data.bones['mixamorig:LeftFoot'].head_local).length
    leg *= arm.matrix_world.to_scale().z

    scene.frame_set(f0)
    start = head('Hips')
    scene.frame_set(f1)
    travel = head('Hips') - start
    travel.z = 0
    # A gait (walk, run, sprint) is played by distance and needs its stride; a clip that stands
    # (idle) or is timed (jump) is played by time and may be In Place.
    timed = clip in TIMED
    if travel.length < 0.05 and not timed:
        raise SystemExit(f'{path}: an In Place clip has no stride; download it without In Place')
    # The walk's own heading, so a clip that walks along any axis bakes the same: everything
    # is turned about Z until it walks along -Y, as the conversion above assumes. One that does
    # not travel faces the way its hips face at the start.
    # A timed clip (a dig, a swim) drifts a few centimetres however In Place it is, and that
    # drift is no heading: it faces the way its hips do.
    if travel.length >= 0.05 and not timed:
        heading = travel.normalized().rotation_difference(Vector((0, -1, 0)))
    else:
        scene.frame_set(f0)
        across = head('LeftUpLeg') - head('RightUpLeg')
        across.z = 0
        heading = across.normalized().rotation_difference(Vector((1, 0, 0)))

    samples = max(SAMPLES_MIN, round((f1 - f0) / scene.render.fps * SAMPLES_PER_S))
    rows = []
    ankles = []
    both = []
    for i in range(samples):
        t = f0 + (f1 - f0) * i / samples
        scene.frame_set(int(t), subframe=t - int(t))
        delta = {}
        for n in rest:
            if n in ('Hips',) or any(n.endswith(x) for x in ('Spine', 'Spine1', 'Spine2', 'Neck', 'Head')) \
                    or any(n.endswith(x) for x in ('Shoulder',) + ARM + LEG):
                pb = arm.pose.bones.get('mixamorig:' + n)
                if pb is None:
                    continue
                w = heading @ world @ pb.matrix.to_quaternion()
                delta[n] = w @ (heading @ rest[n]).inverted()
        local = {}
        for name in NAMES:
            b, parent = JOINTS[name]
            local[name] = delta[b] if parent is None else delta[parent].inverted() @ delta[b]
        rows.append((local, (rest_hips - head('Hips').z) / leg))
        ankles.append(head('LeftFoot').z)
        both.append(min(head('LeftFoot').z, head('RightFoot').z))
    # Mixamo's shoulders drop some twenty degrees from its T-pose as soon as the arms come down,
    # and stay there; ours stand where a hanging arm has them already. So a clavicle keeps only
    # its swing about its own mean, and the arm takes the rest, exactly: with the clavicle's K,
    # its mean M and the arm's A, the arm becomes K'^-1 K A for K' = M^-1 K, so the two together
    # turn the arm just as far as K A did.
    for k in ('l', 'r'):
        mean = Quaternion((0, 0, 0, 0))
        for local, _ in rows:
            q = local[k + 'Clavicle'].copy()
            if q.dot(rows[0][0][k + 'Clavicle']) < 0:
                q.negate()
            mean = Quaternion((mean.w + q.w, mean.x + q.x, mean.y + q.y, mean.z + q.z))
        mean.normalize()
        for local, _ in rows:
            K = local[k + 'Clavicle']
            swing = mean.inverted() @ K
            local[k + 'Arm'] = swing.inverted() @ K @ local[k + 'Arm']
            local[k + 'Clavicle'] = swing
    # A swimmer lies forward in the clip (71 degrees) and walk.js already tilts a swimming body
    # itself (1.32 rad), so the swim keeps only how the pelvis moves about its mean.
    if clip == 'swim':
        mean = Quaternion((0, 0, 0, 0))
        for local, _ in rows:
            q = local['pelvis'].copy()
            if q.dot(rows[0][0]['pelvis']) < 0:
                q.negate()
            mean = Quaternion((mean.w + q.w, mean.x + q.x, mean.y + q.y, mean.z + q.z))
        mean.normalize()
        for local, _ in rows:
            local['pelvis'] = mean.inverted() @ local['pelvis']
    baked = []
    for local, drop in rows:
        row = []
        for name in NAMES:
            q = to_rig(local[name])
            if q.w < 0:
                q.negate()
            row += [round(v, 4) for v in (q.x, q.y, q.z, q.w)]
        row.append(round(drop, 4))
        baked.append(row)
    seconds = (f1 - f0) / scene.render.fps
    # Where in the cycle the left foot comes down: the first sample at its lowest after one above
    # it, which the rig lines its own step counter up with (avatar-gait.js counts from a left
    # foot planted).
    low = min(ankles)
    contact = next((i for i in range(samples) if ankles[i] < low + 0.01 and ankles[i - 1] >= low + 0.01), 0)
    out = {
        'source': Path(path).name,
        'seconds': round(seconds, 4),
        'contact': round(contact / samples, 4),
        'rows': baked,
    }
    # A jump's flight: from the first sample with both feet off the ground to the last. The rig
    # plays that stretch over its own time in the air; what is before and after is the crouch
    # and the landing, which walk.js's jump has no time for.
    if clip in ('jump', 'standingJump'):
        ground = min(both)
        up = [i for i in range(samples) if both[i] > ground + 0.03]
        out['air'] = [round(up[0] / samples, 4), round((up[-1] + 1) / samples, 4)] if up else [0, 1]
    if not timed:
        out.update(stride=round(travel.length / leg, 4), speed=round(travel.length / seconds / leg, 4))
    return out


# Played by time, not by distance.
TIMED = ('idle', 'jump', 'standingJump', 'swim', 'dig')
out = {name: measure(name, path) for name, path in sorted(clips.items())}
target = ROOT / 'web/js/gait-clips.js'
target.write_text(
    '// Generated by scripts/bake-mixamo-gait.py from Mixamo clips (assets/mixamo/). Do not edit.\n'
    + '// A row is a quaternion (x, y, z, w) per joint of GAIT_JOINTS, then the hips\' drop in leg lengths.\n'
    + 'export const GAIT_JOINTS = ' + json.dumps(NAMES) + ';\n'
    + 'export const GAIT_CLIPS = ' + json.dumps(out, separators=(',', ':')) + ';\n',
    encoding='utf8', newline='\n')
for name, c in out.items():
    print('BAKED', name, c['source'], 'stride', c.get('stride'), 'speed', c.get('speed'), 'seconds', c['seconds'], 'contact', c['contact'])
