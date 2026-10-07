// The fisherman at the fisherman's hut (Plans/DONE/regisseur.md): the hut stood with nobody in it,
// and a place with nobody in it is nothing for the camera to go and look at. A villager - the
// player's rig in fisherman's clothes, the smith's pattern (smithy.js), nobody's agent and not on
// the wire - who comes out of the door in the morning, walks down to the water in front of the
// hut and fishes there: casts, waits for a bite with the line out, strikes, and casts again. At
// dusk he goes in.
//
// Where he stands is measured, not written down: between the boat pulled up on the left (x up to
// -0.52 in the hut's frame, scripts/build-harbourhouses.py) and the drying rack on the right
// (from 0.62), as far down the lot towards the sea (+z) as the ground stays out of the water.
// Measured on the first update, when the hut's group stands where it stands, off the ground the
// page walks on.
import * as THREE from 'three';
import { createClassicAvatar } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';
import { SEA_LEVEL } from 'shared/terrain.mjs';

const BASE = normalizeAvatar({
  skin: 0xd6a07a, tunic: 0x39566e, trim: 0xd9c9a3, hat: 0xd8b85a, hatShape: 'wide',
  equip: { backpack: false },
});
// The rod is a villager's tool like the miner's pick: not in HAND_ITEMS, handed to him after
// normalising (classic-avatar.js).
export const FISHER_LOOK = { ...BASE, equip: { ...BASE.equip, rightHandItem: 'rod' } };
const SCALE = 0.72;               // the villagers' size (smithy.js SMITH_SCALE)
const DOOR = [0, -0.1];           // just out of the hut's door (anchor.door is [0, 0, -0.22])
const X = 0.08;                   // between the boat and the rack
const Z_FROM = 0.35, Z_TO = 1.45; // the stretch of the lot searched for the water's edge
const DRY = 0.06;                 // how far above the sea a foot wants the ground
// The arm held out with the rod up and forward over the water (classic-avatar.js `reach`), and
// the line hanging from its tip - which is modelled for this angle (ROD_LINE there).
export const FISH_ARM = -1.9;
const WALK = 0.45;
const DUSK = 0.55, DAWN = 0.45;
const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;

// `deckY` is set for a hut on the quay: its ground is cut away there (world.js), so the terrain
// under it is the waterline or lower while everything drawn stands on the quay's deck - the
// model's own floor, HARBOUR_DECK in the hut's frame. Measured off the terrain he stood sunk in
// the quay's kerb with only his hat above it.
export function attachFisher(group, material, groundAt, deckY = null) {
  const avatar = createClassicAvatar(FISHER_LOOK, material);
  avatar.object.scale.x = 1;       // unmirrored, like every villager whose tool was placed
  const figure = new THREE.Group();
  figure.rotation.order = 'YXZ';
  figure.scale.setScalar(SCALE);
  figure.add(avatar.object);
  figure.visible = false;
  group.add(figure);
  return {
    group, figure, avatar, material, groundAt, deckY,
    spot: null, mode: 'inside', pos: [...DOOR], phase: 0, wait: 0, bites: 0, time: 0, castAt: null,
  };
}

// The water's edge in front of the hut, in the hut's frame, and the height of the ground there
// and at the door, also in its frame.
function measure(f) {
  // On the deck he stands on the deck, a little way out of the door, and never at the water's edge
  // the terrain would find: there is no terrain to find it in.
  if (f.deckY != null) return { at: [X, Z_FROM], y: f.deckY, doorY: f.deckY };
  const g = f.group;
  g.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const local = (x, z) => {
    g.localToWorld(v.set(x, 0, z));
    return f.groundAt(v.x, v.z);
  };
  let z = Z_FROM;
  for (let t = Z_FROM; t <= Z_TO; t += 0.05) {
    if (local(X, t) > SEA_LEVEL + DRY) z = t;
    else break;
  }
  const base = g.getWorldPosition(new THREE.Vector3()).y;
  return { at: [X, z], y: local(X, z) - base, doorY: local(...DOOR) - base };
}

export function updateFisher(f, dt) {
  if (!f) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  if (!f.spot) f.spot = measure(f);
  f.time += step;
  const night = nightOf(f.material);
  const { at } = f.spot;
  let moving = false, reach;

  if (f.mode === 'inside') {
    if (night < DAWN) { f.mode = 'out'; f.pos = [...DOOR]; }
  } else if (f.mode === 'out' || f.mode === 'in') {
    const to = f.mode === 'out' ? at : DOOR;
    const dx = to[0] - f.pos[0], dz = to[1] - f.pos[1], d = Math.hypot(dx, dz);
    if (d < 0.02) {
      f.mode = f.mode === 'out' ? 'fish' : 'inside';
      f.wait = 1.5;
    } else {
      const s = Math.min(d, WALK * step);
      f.pos = [f.pos[0] + dx / d * s, f.pos[1] + dz / d * s];
      f.yaw = Math.atan2(dx, dz);
      f.phase += s * 18;
      moving = true;
    }
  } else if (f.mode === 'fish') {
    f.yaw = 0;                    // out over the water, +z
    reach = FISH_ARM;
    if (night > DUSK) { f.mode = 'in'; }
    else {
      f.wait -= step;
      // A strike when the wait for a bite runs out, and straight away a new cast: two swings
      // of the rod arm, the second a moment after the first. Bites come every 5 to 12 s.
      if (f.wait <= 0) {
        f.avatar.attack('rightArm');
        f.bites += 1;
        f.wait = 5 + ((f.bites * 7.31) % 7);
        f.castAt = f.time + 0.9;
      } else if (f.castAt != null && f.time >= f.castAt) {
        f.avatar.attack('rightArm');
        f.castAt = null;
      }
    }
  }

  f.figure.visible = f.mode !== 'inside';
  if (!f.figure.visible) return;
  const k = f.mode === 'fish' ? 1 : Math.min(1, Math.hypot(f.pos[0] - DOOR[0], f.pos[1] - DOOR[1]) / Math.max(0.01, Math.hypot(at[0] - DOOR[0], at[1] - DOOR[1])));
  const y = f.spot.doorY + (f.spot.y - f.spot.doorY) * k;
  f.figure.position.set(f.pos[0], y, f.pos[1]);
  f.figure.rotation.y = f.yaw || 0;
  f.avatar.update({ moving, grounded: true, phase: f.phase, reach }, step);
}

// Where he is in world [x, z] while he is out, for the director; null while he is inside.
export function fisherAt(f) {
  if (!f || !f.figure.visible) return null;
  const v = f.figure.getWorldPosition(new THREE.Vector3());
  return [v.x, v.z];
}

export function disposeFisher(f) {
  if (!f) return;
  f.group.remove(f.figure);
  f.avatar.dispose();
}
