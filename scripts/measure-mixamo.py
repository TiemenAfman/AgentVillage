"""Measure a Mixamo clip as numbers for avatar-gait.js GAITS (Plans/tweede-avonturier.md).

Our player is a procedural rig - three joints a limb, driven by distance - so a Mixamo clip is
not played: it is read, and what it does is copied into the gait profile. This prints, for one
FBX (binary; Blender reads no ASCII FBX), every frame's angles in the plane of the walk and a
summary in leg lengths, which is the unit to scale by: the Adventurer's leg is 0.212 from hip
to ankle, so a Mixamo stride of 2.1 leg lengths is a `cycle` of 0.445.

    node scripts/blender.mjs --background --python scripts/measure-mixamo.py -- "<clip>.fbx"

Angles are degrees, positive forward: a thigh or an upper arm from hanging straight down, the
torso from standing straight up; a knee and an elbow are how far they are bent. A clip
downloaded with In Place has no travel, so its speed and stride are read off the planted foot
sliding back under the hips instead.
"""
import bpy
import math
import sys
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
scene = bpy.context.scene
action = arm.animation_data.action
f0, f1 = (int(v) for v in action.frame_range)
fps = scene.render.fps


def at(name):
    return arm.matrix_world @ arm.pose.bones['mixamorig:' + name].head


UP = Vector((0, 0, 1))
scene.frame_set(f0)
start = at('Hips')
scene.frame_set(f1)
travel = at('Hips') - start
travel.z = 0
# The way the clip walks; an In Place clip faces Mixamo's -Y.
# A clip that barely travels (a dig, a swim) faces the way its hips do: its drift is no heading.
scene.frame_set(f0)
across = at('LeftUpLeg') - at('RightUpLeg')
across.z = 0
FWD = travel.normalized() if travel.length > 0.5 else across.cross(UP).normalized()


def down_angle(a, b):
    d = b - a
    return math.degrees(math.atan2(d.dot(FWD), -d.dot(UP)))


def up_angle(a, b):
    d = b - a
    return math.degrees(math.atan2(d.dot(FWD), d.dot(UP)))


scene.frame_set(f0)
leg = (at('LeftUpLeg') - at('LeftLeg')).length + (at('LeftLeg') - at('LeftFoot')).length
frames = []
for f in range(f0, f1 + 1):
    scene.frame_set(f)
    hips = at('Hips')
    row = {'f': f, 'hip_h': hips.z, 'spine': up_angle(at('Hips'), at('Neck'))}
    for side in ('Left', 'Right'):
        hip, knee, ankle, toe = at(side + 'UpLeg'), at(side + 'Leg'), at(side + 'Foot'), at(side + 'ToeBase')
        shoulder, elbow, wrist = at(side + 'Arm'), at(side + 'ForeArm'), at(side + 'Hand')
        thigh, shin = down_angle(hip, knee), down_angle(knee, ankle)
        upper, fore = down_angle(shoulder, elbow), down_angle(elbow, wrist)
        row[side] = {
            'thigh': thigh, 'knee': thigh - shin, 'arm': upper, 'elbow': fore - upper,
            'ankle_f': (ankle - hips).dot(FWD), 'ankle_h': ankle.z, 'toe_h': toe.z, 'ankle_w': ankle.dot(FWD),
        }
    frames.append(row)

print('CLIP', path, 'frames', f0, f1, 'fps', fps, 'leg', round(leg, 3))
for r in frames:
    L, R = r['Left'], r['Right']
    print('F%3d hip %.3f spine %5.1f | L thigh %6.1f knee %5.1f ankle %+.3f h %.3f | arm %6.1f elbow %5.1f | '
          'R thigh %6.1f knee %5.1f arm %6.1f elbow %5.1f' % (
              r['f'], r['hip_h'], r['spine'], L['thigh'], L['knee'], L['ankle_f'], L['ankle_h'], L['arm'], L['elbow'],
              R['thigh'], R['knee'], R['arm'], R['elbow']))

L = [r['Left'] for r in frames]
seconds = (f1 - f0) / fps
low = min(x['ankle_h'] for x in L)
# Planted: the ankle within 2 cm of its lowest - for a clip that travels, standing still in the world.
planted = [x for x in L if x['ankle_h'] < low + 0.02]
stance = len(planted) / len(L)
span = (max(x['ankle_f'] for x in planted) - min(x['ankle_f'] for x in planted)) if planted else 0
stride = travel.length if travel.length > 0.05 else span / max(stance, 1e-6)
hip_h = [r['hip_h'] for r in frames]
arms = [x['arm'] for x in L]
print('SUMMARY in leg lengths (x 0.212 for the Adventurer):')
print('  speed  %.2f leg/s   cycle %.2f leg   cadence %.2f steps/s   stance %.2f' % (
    stride / seconds / leg, stride / leg, 2 / seconds, stance))
print('  planted span %.2f leg   hip bob %.3f leg   lift of the ankle %.3f leg (mid swing %.3f)' % (
    span / leg, (max(hip_h) - min(hip_h)) / leg, (max(x['ankle_h'] for x in L) - low) / leg,
    (sorted(x['ankle_h'] for x in L)[len(L) // 2] - low) / leg))
print('  thigh %+.0f..%+.0f   knee in swing %.0f, in stance %.0f..%.0f   torso %+.1f' % (
    min(x['thigh'] for x in L), max(x['thigh'] for x in L), max(x['knee'] for x in L),
    min(x['knee'] for x in planted) if planted else 0, max(x['knee'] for x in planted) if planted else 0,
    sum(r['spine'] for r in frames) / len(frames)))
print('  arm back %.0f, forward %.0f   elbow %.0f..%.0f' % (
    -min(arms), max(arms), min(x['elbow'] for x in L), max(x['elbow'] for x in L)))
