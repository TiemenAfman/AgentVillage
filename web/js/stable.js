// The stable at home (scripts/build-stable.py, Plans/stal-en-veld.md): the horse loose in its
// paddock and two hens scratching in front of the stall doors, each on its own time
// (web/js/fauna.js). The paddock is the baked sand, `civic_stable_yard paddock`: where the horse
// may go is measured off it, less a horse's half length so it never pokes its head through the
// rails, and not written down here again.
import * as THREE from 'three';
import * as models from './models.js';
import { createAnimal } from './fauna.js';

const SAND = 'civic_stable_yard paddock';
// Half a horse, nose to rump, and a little: how far inside the rails its middle stays.
const HORSE_CLEAR = 0.32;
// Where the hens scratch: in front of the stall doors, a small round patch.
const HENS_AT = { x: -0.5, z: 0.48, r: 0.22 };

// Where the horse's middle may go: the sand's extent in the stable's own frame, off its baked
// vertices, less HORSE_CLEAR all round.
export function paddockArea() {
  const part = models.part(SAND);
  if (!part) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < part.positions.length; i += 3) {
    const x = part.positions[i] + part.at[0], z = part.positions[i + 2] + part.at[2];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { x0: x0 + HORSE_CLEAR, x1: x1 - HORSE_CLEAR, z0: z0 + HORSE_CLEAR, z1: z1 - HORSE_CLEAR };
}

export function attachStable(group, at, material, yaw = 0) {
  const area = paddockArea();
  if (!area) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);
  const animals = [
    createAnimal('horse', material, { area, seed: 'stable:horse' }),
    createAnimal('chicken', material, { area: HENS_AT, seed: 'stable:hen:0' }),
    createAnimal('chicken', material, { area: HENS_AT, seed: 'stable:hen:1' }),
  ].filter(Boolean);
  for (const a of animals) root.add(a.object);
  return { root, area, animals };
}

export function updateStable(stable, dt) {
  if (!stable) return;
  for (const a of stable.animals) a.update(dt);
}

export function disposeStable(stable) {
  if (!stable) return;
  for (const a of stable.animals) a.dispose();
  stable.root.parent?.remove(stable.root);
}
