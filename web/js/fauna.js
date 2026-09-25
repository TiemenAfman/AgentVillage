// The animals at their own business (scripts/build-fauna.py). Nobody's agent and nobody's
// errand: a horse grazes its paddock, sheep drift over a field, a hen scratches about, a duck
// paddles, a gull circles the harbour. Passive life, the kind a village has whatever its
// settlers are doing.
//
// Every animal is baked in parts with their origins on their joints, so each part hangs on
// its own `at` and every angle below is a turn about a real hip, neck or shoulder. What an
// animal does is a small state machine on its own clock and a seeded rng: stand, graze or peck,
// walk to somewhere new inside its patch; so two runs of the same frames are the same field
// (tests/fauna.test.mjs).
//
// `createAnimal(kind, material, { area, seed, ground })` gives { object, update(dt) }: `area`
// is where it may go, in the frame the object is added to - { x, z, r } for a round patch, or
// { x0, x1, z0, z1 } for a paddock - and
// `ground(x, z)` the height there (the water surface for a duck), 0 when not given.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { mesh } from './buildings.js';
import * as models from './models.js';

// How each kind behaves. `walk` is its pace in units a second, `stride` how far a leg swings,
// `graze` how far the head comes down; the times are how long it holds a mood, as a range.
export const KINDS = {
  horse: { legs: 4, walk: 0.22, stride: 0.42, gait: 7, graze: 0.95, still: [3, 7], feed: [4, 9] },
  cow: { legs: 4, walk: 0.1, stride: 0.3, gait: 5, graze: 1.25, still: [4, 9], feed: [6, 12] },
  sheep: { legs: 4, walk: 0.12, stride: 0.45, gait: 9, graze: 0.7, still: [2, 5], feed: [3, 8] },
  // Made from a picture (scripts/build-fauna.py, AI): quicker than a sheep and never still long.
  goat: { legs: 4, walk: 0.15, stride: 0.4, gait: 9, graze: 0.9, still: [1, 4], feed: [2, 5] },
  chicken: { legs: 2, walk: 0.12, stride: 0.5, gait: 16, graze: 1.1, still: [0.5, 2], feed: [0.4, 1.2] },
  duck: { legs: 0, walk: 0.06, stride: 0, gait: 0, graze: 1.3, still: [2, 5], feed: [0.8, 1.6], swims: true },
  gull: { legs: 2, walk: 0.9, stride: 0.5, gait: 14, graze: 0.5, still: [2, 5], feed: [1, 2], flies: true },
  // From four views of it: rooting about, never in a hurry.
  pig: { legs: 4, walk: 0.09, stride: 0.35, gait: 9, graze: 0.55, still: [2, 6], feed: [3, 8] },
  // Two models made from pictures (scripts/build-fauna.py): fauna_sparrow on the ground, hopping
  // and pecking, and fauna_sparrow_flying on the wing - see createSparrow below.
  sparrow: { legs: 0, walk: 0.8, stride: 0, gait: 0, graze: 0.9, still: [3, 9], feed: [0.15, 0.3] },
};
// A gull on the wing: how high it circles and how fast its wings go.
const FLIGHT_Y = 1.6;
const FLAP_HZ = 2.2;
// Folded, a wing sweeps back along the body (the bake has it spread).
const FOLD = 1.25;
const TAU = Math.PI * 2;

function slotsOf(asset, name) {
  return models.assetParts(asset).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (asset, name) => {
  const names = slotsOf(asset, name);
  return names.length ? models.part(names[0]).at : null;
};

export function hasAnimal(kind) {
  return models.hasAsset(`fauna_${kind}`);
}

export function createAnimal(kind, material, { area = { x: 0, z: 0, r: 1 }, seed = kind, ground = () => 0, yaw = 0 } = {}) {
  if (kind === 'sparrow') return createSparrow(material, { area, seed, ground, yaw });
  const asset = `fauna_${kind}`;
  const K = KINDS[kind];
  if (!K || !models.hasAsset(asset)) return null;
  const object = new THREE.Group();
  object.rotation.order = 'YXZ';
  const geometries = [];
  const hang = (name) => {
    const names = slotsOf(asset, `${asset} ${name}`);
    if (!names.length) return null;
    const geometry = names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(...atOf(asset, `${asset} ${name}`));
    pivot.add(m);
    object.add(pivot);
    return pivot;
  };
  const body = hang('body');
  const head = hang('head');
  const tail = hang('tail');
  const legs = K.legs === 4 ? ['fl', 'fr', 'bl', 'br'].map((k) => hang(`leg ${k}`)) : K.legs === 2 ? ['l', 'r'].map((k) => hang(`leg ${k}`)) : [];
  const wings = ['l', 'r'].map((k) => hang(`wing ${k}`)).filter(Boolean);
  wings.forEach((w) => { w.rotation.order = 'YZX'; });

  const rng = makeRng(`fauna:${seed}`);
  const a = {
    kind, K, object, body, head, tail, legs, wings, geometries, area, ground, rng, x: 0, z: 0, yaw,
    mood: 'still', left: rng.range(...K.still), to: null, time: 0, phase: 0,
    headPitch: 0, flying: !!K.flies, circle: rng.range(0, TAU),
  };
  ({ x: a.x, z: a.z } = pickTarget(a));
  a.yaw = rng.range(-Math.PI, Math.PI);
  a.update = (dt) => updateAnimal(a, dt);
  a.dispose = () => { object.parent?.remove(object); for (const g of geometries) g.dispose(); };
  updateAnimal(a, 0);
  return a;
}

const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);
function turnTowards(from, to, rate) {
  let d = to - from;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return from + Math.max(-rate, Math.min(rate, d));
}

// Somewhere inside the patch.
function pickTarget(a) {
  const { rng, area } = a;
  if (area.x0 !== undefined) return { x: rng.range(area.x0, area.x1), z: rng.range(area.z0, area.z1) };
  const t = rng.range(0, TAU), r = Math.sqrt(rng.next()) * area.r;
  return { x: area.x + Math.cos(t) * r, z: area.z + Math.sin(t) * r };
}
// The middle of a patch and how far round it a gull may circle, whichever shape it is.
export function middleOf(area) {
  if (area.x0 === undefined) return area;
  return { x: (area.x0 + area.x1) / 2, z: (area.z0 + area.z1) / 2, r: Math.min(area.x1 - area.x0, area.z1 - area.z0) / 2 };
}

export function updateAnimal(a, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  a.time += step;
  const K = a.K, t = a.time;

  if (a.flying) return fly(a, step);

  // ---- the mood ---------------------------------------------------------------------------
  a.left -= step;
  if (a.left <= 0) {
    const roll = a.rng.next();
    if (a.mood !== 'walk' && roll < 0.45) { a.mood = 'walk'; a.to = pickTarget(a); a.left = 30; }
    else if (roll < 0.8) { a.mood = 'feed'; a.left = a.rng.range(...K.feed); }
    else { a.mood = 'still'; a.left = a.rng.range(...K.still); }
  }
  let moving = false;
  if (a.mood === 'walk' && a.to) {
    const dx = a.to.x - a.x, dz = a.to.z - a.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { a.mood = 'still'; a.left = a.rng.range(...K.still); a.to = null; }
    else {
      const want = Math.atan2(dx, dz);
      a.yaw = turnTowards(a.yaw, want, 2.2 * step);
      // Walks once it roughly faces the way, so it turns on the spot rather than skating.
      const facing = Math.cos(want - a.yaw);
      if (facing > 0.7) {
        const v = Math.min(d, K.walk * step);
        a.x += Math.sin(a.yaw) * v;
        a.z += Math.cos(a.yaw) * v;
        moving = true;
      }
    }
  }
  if (moving) a.phase += step * K.gait;

  // ---- the pose ---------------------------------------------------------------------------
  const y = a.ground(a.x, a.z);
  const bob = K.swims ? Math.sin(t * 2.1) * 0.004 : moving ? Math.abs(Math.sin(a.phase)) * 0.006 : 0;
  a.object.position.set(a.x, y + bob, a.z);
  a.object.rotation.y = a.yaw;
  // Feeding puts the head down: grazing, pecking, dabbling. A hen pecks in quick dips.
  let pitch = 0;
  if (a.mood === 'feed') pitch = K.legs === 2 || K.swims ? K.graze * Math.max(0, Math.sin(t * (K.swims ? 3 : 9))) : K.graze;
  else if (a.mood === 'still') pitch = 0.08 * Math.sin(t * 0.7);
  a.headPitch = damp(a.headPitch, pitch, K.legs === 2 ? 14 : 3, step);
  if (a.head) {
    a.head.rotation.x = a.headPitch;
    a.head.rotation.y = a.mood === 'still' ? 0.25 * Math.sin(t * 0.37) : 0;
  }
  if (a.tail) a.tail.rotation.z = 0.25 * Math.sin(t * 2.3) * Math.max(0, Math.sin(t * 0.41));
  // The legs: diagonal pairs together on four, alternate on two.
  a.legs.forEach((leg, i) => {
    if (!leg) return;
    const pair = K.legs === 4 ? (i === 0 || i === 3 ? 0 : Math.PI) : i * Math.PI;
    leg.rotation.x = moving ? K.stride * Math.sin(a.phase + pair) : damp(leg.rotation.x, 0, 8, step);
  });
  a.wings.forEach((w, i) => {
    const side = i === 0 ? -1 : 1;
    w.rotation.y = side * FOLD;
    w.rotation.z = K.swims ? 0 : side * 0.08 * Math.max(0, Math.sin(t * 5)) * (a.mood === 'feed' ? 1 : 0);
  });
}

// A gull: circles above its patch on flapping wings, gliding every so often.
function fly(a, step) {
  const t = a.time;
  const m = middleOf(a.area), r = Math.max(0.6, m.r);
  a.circle += (a.K.walk / r) * step;
  a.x = m.x + Math.cos(a.circle) * r;
  a.z = m.z + Math.sin(a.circle) * r;
  // Flying anticlockwise seen from above, the heading is the tangent.
  a.yaw = Math.atan2(-Math.sin(a.circle), Math.cos(a.circle));
  a.object.position.set(a.x, a.ground(a.x, a.z) + FLIGHT_Y + 0.15 * Math.sin(t * 0.6), a.z);
  a.object.rotation.y = a.yaw;
  a.object.rotation.z = -0.3;                      // banked into the turn
  const gliding = Math.sin(t * 0.5) > 0.4;
  const flap = gliding ? 0.15 : 0.55 * Math.sin(t * FLAP_HZ * TAU);
  a.wings.forEach((w, i) => {
    const side = i === 0 ? -1 : 1;
    w.rotation.y = 0;
    w.rotation.z = side * flap;
  });
  a.legs.forEach((leg) => { if (leg) leg.rotation.x = 0.9; });   // tucked up behind
  if (a.head) a.head.rotation.x = 0.1;
}

// ---- the sparrow ----------------------------------------------------------------------------
// Two models, swapped: on the ground the sitting one hops about and pecks; every few seconds it
// flies up in an arc on flapping wings to somewhere else in its patch and comes down there.
const HOP = { s: 0.2, far: [0.02, 0.05], high: 0.018 };
const FLIGHT = { speed: 0.9, rise: 0.22, flap: 0.7, hz: 9 };

function hangAll(asset, material, group, geometries) {
  const out = {};
  for (const n of models.assetParts(asset)) {
    const base = n.split(':')[0];
    if (out[base]) continue;
    const names = slotsOf(asset, base);
    const geometry = names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((x) => mesh(x)), false);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(...models.part(names[0]).at);
    pivot.add(m);
    group.add(pivot);
    out[base] = pivot;
  }
  return out;
}

function createSparrow(material, { area, seed, ground, yaw }) {
  const sits = models.hasAsset('fauna_sparrow'), flies = models.hasAsset('fauna_sparrow_flying');
  if (!sits && !flies) return null;
  const object = new THREE.Group();
  const geometries = [];
  const sitting = new THREE.Group(), flying = new THREE.Group();
  object.add(sitting, flying);
  const sp = sits ? hangAll('fauna_sparrow', material, sitting, geometries) : {};
  const fp = flies ? hangAll('fauna_sparrow_flying', material, flying, geometries) : {};
  const rng = makeRng(`fauna:${seed}`);
  const a = {
    kind: 'sparrow', K: KINDS.sparrow, object, area, ground, rng, geometries, time: 0,
    x: 0, z: 0, yaw, mode: 'ground', next: rng.range(0.3, 1), grounded: rng.range(...KINDS.sparrow.still),
    hop: null, peck: 0, flight: null,
    head: sp['fauna_sparrow head'] || null,
    wings: [fp['fauna_sparrow_flying wing l'], fp['fauna_sparrow_flying wing r']].filter(Boolean),
  };
  ({ x: a.x, z: a.z } = pickTarget(a));
  a.update = (dt) => updateSparrow(a, dt);
  a.dispose = () => { object.parent?.remove(object); for (const g of geometries) g.dispose(); };
  updateSparrow(a, 0);
  return a;
}

function updateSparrow(a, dt) {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  a.time += step;
  const rng = a.rng;
  let lift = 0;
  // Without the sitting model there is nothing to show on the ground - a flying sparrow with its
  // wings folded down is no bird at all - so it stays up, from one perch in the air to the next.
  if (a.mode === 'ground' && !a.head) a.grounded = 0;
  if (a.mode === 'ground') {
    a.grounded -= step;
    a.next -= step;
    if (a.grounded <= 0) {
      const to = pickTarget(a);
      const d = Math.hypot(to.x - a.x, to.z - a.z);
      a.flight = { from: { x: a.x, z: a.z }, to, t: 0, dur: Math.max(0.6, d / FLIGHT.speed + 0.3) };
      a.mode = 'flight';
    } else if (a.hop) {
      a.hop.t += step;
      const k = Math.min(1, a.hop.t / HOP.s);
      a.x = a.hop.x + Math.sin(a.yaw) * a.hop.far * k;
      a.z = a.hop.z + Math.cos(a.yaw) * a.hop.far * k;
      lift = HOP.high * Math.sin(Math.PI * k);
      if (k >= 1) a.hop = null;
    } else if (a.next <= 0) {
      const roll = rng.next();
      if (roll < 0.45) {
        // A hop the way it faces, turned back towards the middle if that would leave the patch.
        const far = rng.range(...HOP.far);
        const nx = a.x + Math.sin(a.yaw) * far, nz = a.z + Math.cos(a.yaw) * far;
        const t = pickTarget(a);
        if (!inside(a.area, nx, nz)) a.yaw = Math.atan2(t.x - a.x, t.z - a.z);
        else a.hop = { t: 0, x: a.x, z: a.z, far };
      } else if (roll < 0.8) a.peck = rng.range(...KINDS.sparrow.feed);
      else a.yaw += rng.range(-1.2, 1.2);
      a.next = rng.range(0.25, 0.9);
    }
    a.peck = Math.max(0, a.peck - step);
  } else {
    const f = a.flight;
    f.t += step;
    const k = Math.min(1, f.t / f.dur);
    a.x = f.from.x + (f.to.x - f.from.x) * k;
    a.z = f.from.z + (f.to.z - f.from.z) * k;
    a.yaw = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
    lift = FLIGHT.rise * Math.sin(Math.PI * k) + (a.head ? 0 : FLIGHT.rise * 0.6);
    if (k >= 1) { a.mode = 'ground'; a.grounded = rng.range(...KINDS.sparrow.still); a.flight = null; a.next = 0.5; }
  }
  const onWing = a.mode === 'flight' || !a.head;
  a.object.children[0].visible = !onWing;
  a.object.children[1].visible = onWing;
  a.object.position.set(a.x, a.ground(a.x, a.z) + lift, a.z);
  a.object.rotation.y = a.yaw;
  if (a.head) a.head.rotation.x = a.peck > 0 ? KINDS.sparrow.graze * Math.sin(Math.PI * (a.peck / 0.3)) : 0;
  const flap = a.mode === 'flight' ? FLIGHT.flap * Math.sin(a.time * FLIGHT.hz * TAU) : 0.9;
  if (a.wings[0]) a.wings[0].rotation.z = flap;
  if (a.wings[1]) a.wings[1].rotation.z = -flap;
}

function inside(area, x, z) {
  if (area.x0 !== undefined) return x >= area.x0 && x <= area.x1 && z >= area.z0 && z <= area.z1;
  return Math.hypot(x - area.x, z - area.z) <= area.r;
}
