// The flag on the postbox, which is the only part of the mailbox that has anything to
// say from across the square: down for an empty box, up when something unread is waiting
// in one of the accounts it holds.
//
// It lives out here rather than in buildings.js for the reason web/js/clock.js gives for
// the tower's hands: a building is one merged geometry and cannot move a piece of itself,
// so anything that turns has to be its own small mesh hung on the building's group. It
// shares the building material, so a flag costs one draw call and no state anywhere but
// the two numbers below.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, C } from './buildings.js';

// Down is not straight down: it lies back along the cheek of the box, which is what a
// flag with a hinge actually does and what keeps it from reading as a bent aerial.
const DOWN = -2.2;
const UP = 0;
// How fast it swings. Fast enough to be the answer to a button, slow enough to be seen -
// the whole point of the flag is that you can catch it going up out of the corner of your
// eye while you are walking past.
const SWING = 7;

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Built pointing up from a pivot on the origin, so the mesh's own rotation about z is the
// whole animation. Gold on a red box, because a red flag on a red box is no flag at all.
export function buildMailFlagGeometry() {
  return merge([
    box(0.016, 0.2, 0.016, C.iron),
    box(0.085, 0.062, 0.01, C.gold, { x: 0.05, y: 0.125 }),
    box(0.085, 0.014, 0.012, 0xb8862b, { x: 0.05, y: 0.125 }),   // the fold along its bottom edge
  ]);
}

// `at` is the anchor out of `built.animated.mailflag` - named apart from the `flag`
// anchor the town hall publishes, which is a flagpole and a different thing entirely.
export function attachMailFlag(group, at, material) {
  const mesh = new THREE.Mesh(buildMailFlagGeometry(), material);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.rotation.z = DOWN;
  group.add(mesh);
  return { mesh, angle: DOWN, want: DOWN, up: false };
}

// Whether there is anything waiting. Called when the poll comes back, which is every half
// minute at most - not every frame.
export function setMailFlag(flag, up) {
  if (!flag || flag.up === !!up) return;
  flag.up = !!up;
  flag.want = up ? UP : DOWN;
}

// Called every frame, and returns as soon as there is nothing to do - which is almost
// always, because the flag is at rest between the two moments a day it moves.
export function updateMailFlag(flag, dt) {
  if (!flag || flag.angle === flag.want) return;
  const step = SWING * dt;
  const gap = flag.want - flag.angle;
  flag.angle = Math.abs(gap) <= step ? flag.want : flag.angle + Math.sign(gap) * step;
  flag.mesh.rotation.z = flag.angle;
}
