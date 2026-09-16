// Blender-authored resident parts, split at the instancing colour/transform seams.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTLER_PARTS, SETTLER_COLORS, SETTLER_EYE_Y } from './villager-mesh.js';

export const RESIDENT_HEAD_Y = 0.350;
export const RESIDENT_EYE_OFFSET = SETTLER_EYE_Y - RESIDENT_HEAD_Y;

// Passing a tint replaces the part colour; null preserves hair and facial details.
export function residentPart(variant, tint = null, dy = 0) {
  const parts = SETTLER_PARTS.filter((part) => part.variant === variant).map((part) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    const count = g.attributes.position.count;
    const color = new THREE.Color(tint ?? SETTLER_COLORS[part.slot]);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count), 1));
    g.translate(0, dy, 0);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}
