// The ore in the gold mine's bin, the miner, and the cart (Plans/goudmijn.md).
//
// The bin holds the keeper's week: a hundred lumps of gold-bearing rock, one for every percent
// of the seven-day window, taken off the top of the heap as the week is used - the gold pit's
// own bargain (web/js/goldpit.js), a week wide. The building is one merged loaf like any other
// (buildings.js, scripts/build-goldmine.py), and the heap is its own InstancedMesh hung on the
// building's group, whose `count` is the ore left: one draw call however full the bin is.
//
// The cart and the miner belong to goldrun.js, which walks them to the goldsmith when the
// five-hour window turns over; the shapes and the look they are made of are here, with the
// mine they come from.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grouped } from './models.js';
import { meshAsset } from './buildings.js';
import { MINE_ORE } from 'shared/gold.mjs';
import { makeRng } from 'shared/rng.mjs';
import { normalizeAvatar } from './avatar.js';

// One lump as scripts/build-goldmine.py makes prop_goldore: origin under its middle.
export const LUMP = { r: 0.04, h: 0.045 };
// The inside of the bin, from the middle of its floor (the bake's `civic_goldmine bin`): the
// planks are 0.62 across and 0.03 thick, and a lump's own half width is kept off them.
export const BIN_IN = 0.27;
// A week turning over is a rise of at least this much, and fills the bin over ORE_FILL_S.
export const ORE_RISE = 5;
export const ORE_FILL_S = 10;
const GLINT = 0.18;

function glinting(g, glint) {
  g.clearGroups();
  const n = g.attributes.position.count;
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(n).fill(glint), 1));
  return g;
}

export function oreGeometry({ glint = GLINT } = {}) {
  return glinting(grouped('prop_goldore', ['plain']), glint);
}

// ---- where the ore lies --------------------------------------------------------------------
//
// Tipped, not stacked: every lump is dropped at a point drawn from one fixed stream
// ('goldmine:ore'), nearer the middle more often than not, and comes to rest on whatever it
// lands on - the floor, or the highest lump already under it. So the heap is highest in the
// middle and runs out towards the planks, and every page tips the same one. Returned lowest
// first, which is the order `count` keeps them in: the week is taken off the top.
let ORE_SLOTS = null;
export function oreSlots() {
  if (ORE_SLOTS) return ORE_SLOTS.map((s) => s.slice());
  const rng = makeRng('goldmine:ore');
  const lumps = [];
  const reach = LUMP.r * 1.7;
  for (let t = 0; lumps.length < MINE_ORE && t < 20000; t++) {
    // Two draws averaged: a heap, not a floor evenly strewn.
    const x = (rng.range(-BIN_IN, BIN_IN) + rng.range(-BIN_IN, BIN_IN)) / 2;
    const z = (rng.range(-BIN_IN, BIN_IN) + rng.range(-BIN_IN, BIN_IN)) / 2;
    let y = 0;
    for (const l of lumps) {
      const d = Math.hypot(l[0] - x, l[2] - z);
      if (d < reach) y = Math.max(y, l[1] + LUMP.h * 0.72 * Math.sqrt(1 - (d / reach) ** 2));
    }
    // A heap has a slope it keeps: nothing higher than the cone over the middle of the bin
    // allows, or a lump that landed on another near the planks would stand on a tower.
    const cone = 0.17 * (1 - Math.max(Math.abs(x), Math.abs(z)) / (BIN_IN + 0.02));
    if (y > Math.max(0, cone)) continue;
    const s = 0.85 + 0.35 * rng.next();
    lumps.push([x, y, z, rng.range(0, Math.PI * 2), rng.range(-0.35, 0.35), rng.range(-0.35, 0.35), s]);
  }
  lumps.sort((a, b) => a[1] - b[1]);
  ORE_SLOTS = lumps;
  return ORE_SLOTS.map((s) => s.slice());
}

// Hang the heap on the mine's group. `at` is the middle of the bin's floor in that group's
// frame (buildings.js publishes it as `animated.orepile`). `setOre(n)` shows the lowest n.
export function attachOrePile(group, at) {
  const material = new THREE.MeshPhongMaterial({
    vertexColors: true, specular: 0xffe8a6, shininess: 60,
    emissive: 0x4a3008, emissiveIntensity: 0.1,
  });
  const geometry = oreGeometry();
  const slots = oreSlots();
  const mesh = new THREE.InstancedMesh(geometry, material, slots.length);
  let told = false, shown = MINE_ORE;
  const draw = () => {
    const n = Math.round(shown);
    mesh.count = n;
    mesh.visible = n > 0;
  };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  slots.forEach(([x, y, z, yaw, roll, pitch, s], i) => {
    e.set(roll, yaw, pitch);
    mesh.setMatrixAt(i, m.compose(p.set(at[0] + x, at[1] + y, at[2] + z), q.setFromEuler(e), s3.setScalar(s)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  const handle = {
    mesh,
    ore: MINE_ORE,
    // What the bin should hold. The first word is shown as it is; a rise of ORE_RISE or more
    // after that is the week turning over, and the bin fills over ORE_FILL_S instead of being
    // whole in one frame - the miner at the face beside it is what fills it. Anything else,
    // spending included, is shown at once.
    setOre(n) {
      const ore = Math.max(0, Math.min(MINE_ORE, Math.round(Number.isFinite(n) ? n : MINE_ORE)));
      const rise = told && ore - shown >= ORE_RISE;
      told = true;
      handle.ore = ore;
      if (rise) return;
      shown = ore;
      draw();
    },
    // Counts the bin up towards `ore`; main.js calls it every frame (animateExtras).
    update(dt) {
      if (shown >= handle.ore || !(dt > 0)) return;
      shown = Math.min(handle.ore, shown + MINE_ORE / ORE_FILL_S * Math.min(dt, 0.1));
      draw();
    },
    shown: () => Math.round(shown),
    dispose() {
      group.remove(mesh);
      geometry.dispose();
      material.dispose();
      mesh.dispose?.();
    },
  };
  return handle;
}

// ---- the cart and the miner ----------------------------------------------------------------

// The cart, and the load it carries down to the goldsmith: seven lumps on top of its tub, the
// bin's own shape in the building's own material, merged into one geometry that goldrun.js
// shows or hides. Both in the cart's frame: on the rails under its middle, running along z.
export function mineCartGeometry() {
  return mergeGeometries(meshAsset('prop_minecart'), false);
}
const LOAD = [[-0.04, 0.2, -0.07], [0.045, 0.19, -0.05], [0, 0.215, 0], [-0.05, 0.195, 0.05],
  [0.05, 0.2, 0.06], [0.01, 0.23, 0.08], [0, 0.23, -0.1]];
export function cartLoadGeometry() {
  const lumps = [];
  LOAD.forEach(([x, y, z], i) => {
    for (const g of meshAsset('prop_goldore', 0xffffff, { x, y, z, ry: i * 1.3, sx: 1.2, sy: 1.2, sz: 1.2 })) lumps.push(g);
  });
  const g = mergeGeometries(lumps, false);
  for (const l of lumps) l.dispose();
  return g;
}
// How far ahead of the one pushing it the cart runs: its back rim at their fists.
export const CART_AHEAD = 0.27;

// The miner: a villager in dusty grey with a round felt hat, a pick in his right hand while he
// works the face by the mouth. The pick is a villager's tool and not in HAND_ITEMS
// (classic-avatar.js), so it is handed to him after normalising, as the butcher's cleaver is.
const MINER_BASE = normalizeAvatar({
  skin: 0xd8a57f, tunic: 0x5f5b52, trim: 0x33291f, hat: 0xc79a3c, hatShape: 'dome',
  equip: { backpack: false },
});
export const MINER_LOOK = { ...MINER_BASE, equip: { ...MINER_BASE.equip, rightHandItem: 'pickaxe' } };
export const MINER_PUSHING = { ...MINER_BASE, equip: { ...MINER_BASE.equip } };

// Where he stands in the mine's frame while nothing is to be carried: out on the apron to the
// right of the rails, working the boulder at the foot of the hill (the bake's first crag on
// that side), side on to anybody on the road.
export const MINER_WORK = [0.66, 0.84];
export const MINER_FACE = [0.98, 0.46];
