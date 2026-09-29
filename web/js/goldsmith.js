// The goldsmith's furnace, and where the goldsmith stands (Plans/DONE/goudmijn.md).
//
// Built like smithy.js: the fire in the furnace's mouth is baked inside the building's asset
// with its origin in the middle of the mouth (scripts/build-goldsmith.py), buildings.js leaves
// it out of the merge (`isGoldsmithMoving`), and this hangs it back on and lets it flare while
// a cartload of the mine's ore melts. Every place the goldsmith goes is read off the bake or
// measured against it; the goldsmith himself is walked by goldrun.js, because the last thing
// he does with each load is wheel it to the gold pit, which is off his lot.
//
// The glow is `aEmissive` above the bake's 1 (a bake may only say 0 or 1; the shader takes any
// number, and the building shader adds a quarter of it by day - buildings.js), so a melt reads
// in daylight as well as at night. No light of its own: the smithy's costs every material a
// recompile when an island with one appears, and a furnace that is mostly banked is not worth
// a second.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { mesh, box, partAt } from './buildings.js';
import * as models from './models.js';
import { normalizeAvatar } from './avatar.js';

const ASSET = 'civic_goldsmith';

// The goldsmith: claret coat with gold at the cuffs, bareheaded, a small hammer in his right
// hand for the work at the bench. The villagers' size (smithy.js SMITH_SCALE).
const BASE = normalizeAvatar({
  skin: 0xe7b894, tunic: 0x7b2d3a, trim: 0xb8923e, hat: 0x2f4d3c, hatShape: 'none',
  equip: { backpack: false },
});
export const GOLDSMITH_LOOK = { ...BASE, equip: { ...BASE.equip, rightHandItem: 'hammer' } };
export const GOLDSMITH_PUSHING = { ...BASE, equip: { ...BASE.equip } };
export const VILLAGER_SCALE = 0.72;

// How hot the fire is: banked while there is nothing to melt, and up to MELT_HEAT while there
// is, reached over HEAT_UP and let go over COOL_DOWN.
export const BANKED = 0.6;
export const MELT_HEAT = 3.2;
const HEAT_UP = 2.5;
const COOL_DOWN = 12;
const EMBERS = 16;
const EMBER_HEX = 0xffb347;

// Where things are, in the building's own frame, from the bake: the bench's top, the mouth,
// and the door; and from those, where he stands. At the bench he works from its right-hand
// end, side on to the street; at the furnace he stands by the mouth, off the bench's end and
// short of the ore bin (x 0.78.. at the back) and the lean-to's post (x 1.27).
export function goldsmithPlaces() {
  if (!models.hasAsset(ASSET)) return null;
  const bench = partAt(ASSET, 'bench');
  const mouth = partAt(ASSET, 'glow');
  const door = models.anchorsOf(ASSET).door;
  if (!bench || !mouth || !door) return null;
  return {
    bench, mouth, door,
    work: [bench[0] + 0.5, bench[2] + 0.02],
    workFace: [bench[0] + 0.2, bench[2] + 0.02],
    smelt: [mouth[0] + 0.48, mouth[2] + 0.12],
    smeltFace: [mouth[0], mouth[2]],
    // The barrow's frame (the pusher's feet) where it waits, facing the street, clear of the
    // lot's middle column: that is the door cell, where the road comes in.
    barrow: [0.95, 0.56],
  };
}

function glowGeometry() {
  const names = models.assetParts(ASSET).filter((n) => /^civic_goldsmith glow(:\d+)?$/.test(n));
  return names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

// Hang the fire on the goldsmith's group. `at` is buildings.js's `animated.goldsmith` (the
// porch's lift in it). Returns the handle goldrun.js drives: `melt(on)` and `update(dt)`.
export function attachFurnace(group, at, material) {
  const places = goldsmithPlaces();
  if (!places) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  group.add(root);
  const geometry = glowGeometry();
  const glow = new THREE.Mesh(geometry, material);
  glow.position.set(...places.mouth);
  root.add(glow);
  const base = new Float32Array(geometry.attributes.aEmissive.array);
  const chip = box(0.012, 0.012, 0.012, EMBER_HEX, { emissive: 1 });
  const embers = new THREE.InstancedMesh(chip, material, EMBERS);
  embers.frustumCulled = false;
  root.add(embers);
  const pool = Array.from({ length: EMBERS }, () => ({ life: 0, max: 1, p: [0, 0, 0], v: [0, 0, 0] }));
  const rng = makeRng('goldsmith:embers');
  const furnace = {
    root, places, heat: BANKED, melting: false, time: 0,
    melt(on) { furnace.melting = !!on; },
    update(dt) {
      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      furnace.time += step;
      const target = furnace.melting ? MELT_HEAT : BANKED;
      const rate = furnace.melting ? HEAT_UP : COOL_DOWN;
      furnace.heat += (target - furnace.heat) * Math.min(1, step / rate * 3);
      const flicker = 0.88 + 0.08 * Math.sin(furnace.time * 13) + 0.04 * Math.sin(furnace.time * 5.3);
      const e = geometry.attributes.aEmissive;
      for (let i = 0; i < e.count; i++) e.array[i] = base[i] * furnace.heat * flicker;
      e.needsUpdate = true;
      glow.scale.setScalar(0.92 + 0.05 * Math.min(2, furnace.heat));
      // Embers out of the mouth, a spray of them while it roars and a rare one banked.
      const hot = Math.max(0, furnace.heat - BANKED) / (MELT_HEAT - BANKED);
      if (rng.chance(step * (0.4 + hot * 14))) {
        for (const c of pool) {
          if (c.life > 0) continue;
          c.life = c.max = rng.range(0.7, 1.3);
          const [mx, my, mz] = places.mouth;
          c.p = [mx + rng.range(-0.05, 0.05), my + 0.02, mz + 0.03];
          c.v = [rng.range(-0.05, 0.05), rng.range(0.15, 0.32), rng.range(0.05, 0.14)];
          break;
        }
      }
      pool.forEach((c, i) => {
        if (c.life <= 0) { embers.setMatrixAt(i, hidden); return; }
        c.life -= step;
        for (let a = 0; a < 3; a++) c.p[a] += c.v[a] * step;
        c.v[1] += 0.05 * step;
        const size = Math.max(0, Math.min(1, c.life / (c.max * 0.4)));
        embers.setMatrixAt(i, m4.compose(p3.set(...c.p), q.identity(), s3.setScalar(size)));
      });
      embers.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      root.parent?.remove(root);
      geometry.dispose();
      chip.dispose();
      embers.dispose();
    },
  };
  furnace.update(0);
  return furnace;
}
