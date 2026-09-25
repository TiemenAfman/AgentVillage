// The countryside's small motions (scripts/build-farmyard.py, scripts/build-bakery.py,
// Plans/stal-en-veld.md): a scarecrow and a clump of reeds leaning with the wind, a water lily
// riding the ripples, bees about their skeps, and the bakery's oven breathing.
//
// The props have no moving parts: each is drawn whole and moved whole, about its own foot, so
// all a prop needs is its baked asset. The bakery's fire is its one unmerged part,
// `civic_bakery glow` (buildings.js leaves it out with `isBakeryMoving`), dimmed and brightened
// through its aEmissive the way smithy.js does the smithy's coals. Each thing runs on its own
// clock and a seed, so two of them side by side never sway in step and two runs of the same
// frames are the same (tests/countryside.test.mjs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { mesh, meshAsset, box } from './buildings.js';
import * as models from './models.js';

// How far each leans in the wind, and how fast it goes back and forth.
export const SWAY = {
  scarecrow: { lean: 0.035, hz: 0.35 },
  reeds: { lean: 0.12, hz: 0.55 },
  waterlily: { lean: 0.02, hz: 0.3 },
  haystack: { lean: 0, hz: 0 },
  beehive: { lean: 0, hz: 0 },
};
export const BEES = 7;
const BEE_HEX = 0x3b2f12;
const TAU = Math.PI * 2;

const asset = (kind) => `prop_${kind}`;
export const hasProp = (kind) => models.hasAsset(asset(kind));

function wholeGeometry(name, o) {
  const parts = meshAsset(name, 0xffffff, o);
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}

export function attachProp(kind, group, at, material, { seed = kind, yaw = 0 } = {}) {
  if (!hasProp(kind)) return null;
  const geometry = wholeGeometry(asset(kind));
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.rotation.order = 'YXZ';
  object.position.set(...at);
  object.rotation.y = yaw;
  group.add(object);
  const rng = makeRng(`countryside:${seed}`);
  const prop = { kind, object, geometries: [geometry], time: rng.range(0, 20), phase: rng.range(0, TAU), rest: [...at] };
  if (kind === 'beehive') {
    // The bees: a few specks on looping paths round the two doors. The doors are the front of
    // each skep, a hand's width out from the middle of the bench, about half the hive's height
    // up (scripts/build-farmyard.py) - measured over every colour slot the bench baked into.
    let top = 0;
    for (const n of models.assetParts(asset(kind))) {
      const b = models.part(n);
      for (let i = 1; i < b.positions.length; i += 3) top = Math.max(top, b.positions[i] + b.at[1]);
    }
    top *= 0.58;
    // Bigger than a bee, or at the island's distance there is nothing there at all.
    const bee = box(0.016, 0.012, 0.02, BEE_HEX);
    prop.geometries.push(bee);
    prop.bees = new THREE.InstancedMesh(bee, material, BEES);
    prop.bees.frustumCulled = false;
    object.add(prop.bees);
    prop.swarm = Array.from({ length: BEES }, (_, i) => ({
      home: [(i % 2 ? 0.07 : -0.07), top, 0.06], r: rng.range(0.05, 0.12), speed: rng.range(1.5, 3), off: rng.range(0, TAU),
    }));
  }
  updateProp(prop, 0);
  return prop;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const p3 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function updateProp(prop, dt) {
  if (!prop) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  prop.time += step;
  const t = prop.time, s = SWAY[prop.kind] || SWAY.haystack;
  // Two sines at unrelated rates, so a gust never settles into a metronome.
  const w = Math.sin(t * s.hz * TAU + prop.phase) * 0.7 + Math.sin(t * s.hz * 2.7 + prop.phase * 2) * 0.3;
  prop.object.rotation.z = s.lean * w;
  prop.object.rotation.x = s.lean * 0.4 * Math.sin(t * s.hz * 1.9 + prop.phase);
  if (prop.kind === 'waterlily') {
    prop.object.position.y = prop.rest[1] + 0.003 * Math.sin(t * 1.4 + prop.phase);
    prop.object.rotation.y += step * 0.03;
  }
  if (prop.bees) {
    prop.swarm.forEach((b, i) => {
      const a = t * b.speed + b.off;
      // A figure of eight in front of the door, a little up and down.
      p3.set(b.home[0] + Math.sin(a) * b.r, b.home[1] + 0.03 + 0.02 * Math.sin(a * 2.3), b.home[2] + Math.sin(a * 2) * b.r * 0.6);
      q.setFromAxisAngle(UP, a);
      m4.compose(p3, q, one);
      prop.bees.setMatrixAt(i, m4);
    });
    prop.bees.instanceMatrix.needsUpdate = true;
  }
}

export function disposeProp(prop) {
  if (!prop) return;
  prop.object.parent?.remove(prop.object);
  for (const g of prop.geometries) g.dispose();
  prop.bees?.dispose();
}

// ---- the bakery's oven ------------------------------------------------------------------
const GLOW = 'civic_bakery glow';
const OVEN_LIGHT = { color: 0xff8a3a, intensity: 0.9, distance: 1.4, ahead: 0.22, up: 0.08 };
const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;

export function attachBakery(group, at, material, yaw = 0) {
  const names = models.assetParts('civic_bakery').filter((n) => n === GLOW || n.startsWith(GLOW + ':'));
  if (!names.length) return null;
  const part = models.part(names[0]);
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);
  const geometry = names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
  const glow = new THREE.Mesh(geometry, material);
  glow.position.set(...part.at);
  root.add(glow);
  // In the scene from the start at nought, as the smithy's is (a new light recompiles everything).
  const light = new THREE.PointLight(OVEN_LIGHT.color, 0, OVEN_LIGHT.distance, 2);
  light.position.set(part.at[0], part.at[1] + OVEN_LIGHT.up, part.at[2] + OVEN_LIGHT.ahead);
  root.add(light);
  const bakery = { root, glow, light, material, geometry, time: 0, base: new Float32Array(geometry.attributes.aEmissive.array) };
  updateBakery(bakery, 0);
  return bakery;
}

export function updateBakery(bakery, dt) {
  if (!bakery) return;
  bakery.time += Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  const t = bakery.time;
  // A slow breath and a quick flicker on top.
  const fire = 0.78 + 0.14 * Math.sin(t * 1.1) + 0.08 * Math.sin(t * 13.7) * Math.sin(t * 5.3);
  const e = bakery.glow.geometry.attributes.aEmissive;
  for (let i = 0; i < e.count; i++) e.array[i] = bakery.base[i] * fire;
  e.needsUpdate = true;
  bakery.light.intensity = OVEN_LIGHT.intensity * fire * (0.1 + 0.9 * nightOf(bakery.material));
}

export function disposeBakery(bakery) {
  if (!bakery) return;
  bakery.root.parent?.remove(bakery.root);
  bakery.geometry.dispose();
}
