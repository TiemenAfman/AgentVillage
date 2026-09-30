"""Bind the traveller's limbs and equipment to deforming three-bone chains."""
import bpy
import bmesh
from mathutils import Vector


def bind_traveller(parts, rig):
    # Game coordinates: up Y, forward Z. The hip is inside the tunic.
    for side, sign in [('left',-1),('right',1)]:
        rig[side+'Leg']=[sign*.0402,.179,0]
    joints={}
    for side,sign in [('left',-1),('right',1)]:
        joints[side+'Leg']={'bend':[sign*.0402,.104,0], 'end':[sign*.0402,.037,-.002]}
        joints[side+'Arm']={'bend':[sign*.100,.223,.007], 'end':[sign*.103,.188,.012]}
    def xyz(p):return Vector((p[0],-p[2],p[1]))
    armature=bpy.data.armatures.new('Traveller articulated skeleton')
    skeleton=bpy.data.objects.new('Traveller articulated skeleton',armature)
    bpy.context.collection.objects.link(skeleton)
    bpy.ops.object.select_all(action='DESELECT');skeleton.select_set(True);bpy.context.view_layer.objects.active=skeleton
    bpy.ops.object.mode_set(mode='EDIT')
    for group,chain in joints.items():
        positions=[xyz(rig[group]),xyz(chain['bend']),xyz(chain['end'])]
        for i in range(3):
            bone=armature.edit_bones.new(group+':'+str(i));bone.head=positions[i]
            bone.tail=positions[i+1] if i<2 else positions[i]+Vector((0,-.025,0))
            if i:bone.parent=armature.edit_bones[group+':'+str(i-1)]
    bpy.ops.object.mode_set(mode='OBJECT');skeleton.show_in_front=True;skeleton.hide_render=True
    def smooth(a,b,v):
        t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
    for obj in parts:
        group=obj.get('avatar_group')
        if group not in joints:
            side='left' if obj.name.startswith('Left ') else 'right' if obj.name.startswith('Right ') else None
            if side and any(p in obj.name for p in ['legging','knee cop','sabaton']):group=side+'Leg'
            else:continue
        # Freeze the mesh before assigning weights so exported corner indices are stable.
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        bpy.ops.object.convert(target='MESH')
        # Shorter shirt tails and fuller upper trousers clear the lifted knee.
        if 'trouser leg' in obj.name:
            inverse = obj.matrix_world.inverted()
            for vert in obj.data.vertices:
                point = obj.matrix_world @ vert.co
                if point.z > .14: point.z += .016 * min(1,(point.z-.14)/.029)
                vert.co = inverse @ point
        # Long trouser and greave edges need intermediate rings for a visible knee bend.
        if group.endswith('Leg'):
            bm=bmesh.new();bm.from_mesh(obj.data)
            edges=[e for e in bm.edges if abs((obj.matrix_world.to_3x3()@(e.verts[0].co-e.verts[1].co)).z)>.030]
            if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=3,use_grid_fill=True)
            bm.to_mesh(obj.data);bm.free();obj.data.update()
        groups=[obj.vertex_groups.new(name=group+':'+str(i)) for i in range(3)]
        knee=joints[group]['bend'][1];ankle=joints[group]['end'][1]
        for vert in obj.data.vertices:
            y=(obj.matrix_world@vert.co).z
            lower=1-smooth(knee-.013,knee+.013,y)
            end=1-smooth(ankle-.008,ankle+.008,y)
            weights=[1-lower,lower*(1-end),lower*end]
            # Shoe leather and soles keep their shape. The shaft belongs to the shin;
            # the foot rotates at the ankle instead of folding the entire shoe in half.
            if any(word in obj.name for word in ['boot','sole','toe seam','sabaton']):
                weights = [0,1,0] if 'shaft' in obj.name else [0,0,1]
            for g,w in zip(groups,weights):
                if w>0:g.add([vert.index],w,'REPLACE')
        obj['avatar_skin']=group
        deform=obj.modifiers.new('Joint deformation','ARMATURE');deform.object=skeleton
    return joints
