// The Salty Kraken in the wind (Plans/kraken-op-zee.md, "Beweging"): its two Jolly Rogers fly, its
// three set sails breathe and ripple, and the lanterns that hang on a hook - at the stern, under the
// bowsprit, under the fore top and beside the door - swing a little. The ones standing on posts stay
// still: a lantern on a post does not swing.
//
// All of it is baked in the building's one asset (scripts/build-piratetavern.py) and found here by
// part name; buildings.js leaves those parts out of the merged body (`isKrakenMoving`) and this file
// merges them into ONE geometry, hung on the record's group - one draw call a pub - whose vertices
// it moves on the CPU, the way web/js/batavia.js waves her flags. Every vertex carries what moves it:
// which group it belongs to, and the group's pivot and measures, all read off the bake, so a rebake
// that moves a sail moves its motion with it.
//
// On the sea's clock (`t` in seconds, main.js passes timeNow()), like the hanging sign, so every
// screen has the flags and the lanterns at the same place. Phases come from the group's name, never
// from a random number. Nothing here is on the wire.
//
// Shaped like batavia.js: `buildKrakenMotion` measures (pure of the DOM, tested under Node),
// `moveKraken` writes positions, `attachKrakenMotion` / `updateKrakenMotion` / `disposeKrakenMotion`
// hang, move and give it back.
import * as THREE from 'three';
import { hash32 } from 'shared/rng.mjs';
import { mesh, mergeParts, isKrakenMoving } from './buildings.js';
import * as models from './models.js';

const ASSET = 'piratetavern';
const FLAG_RE = /^Salty (great|fore) jolly roger( (crossbone|knuckle|skull|socket))?( \d+)?(:\d+)?$/;
const SAIL_RE = /^Salty (fore course|fore topsail|aft topsail)( (reef band|boltrope|patch))?( \d+)?(:\d+)?$/;
const LAMP_RE = /^Salty (stern|bow|fore top|door) lantern (ring|cap|rim|glass|stile|band|base|foot|finial)( \d+)?(:\d+)?$/;

// What moves, and so stays out of the building's merge, is buildings.js's `isKrakenMoving` (it
// would be an import cycle from here); tests/kraken-motion.test.mjs holds it to these three.
export const isKrakenGroup = (n) => FLAG_RE.test(n) || SAIL_RE.test(n) || LAMP_RE.test(n);

// How it moves. A flag: how far the fly end swings across, as a share of its length, how many
// waves run along it, how fast, and how far the fly droops. A sail: how far it breathes in and out
// at its foot, as a share of its height, and the smaller ripple running across it. A lantern: how
// far it swings, in radians, and how fast.
export const MOTION = Object.freeze({
  flag: { swing: 0.09, wave: 4.2, speed: 5.0, droop: 0.03 },
  sail: { breathe: 0.035, breatheS: 3.7, ripple: 0.012, wave: 5.0, speed: 2.4 },
  lamp: { swing: 0.09, rate: 1.3 },
});

const TAU = Math.PI * 2;
const KIND = { flag: 0, sail: 1, lamp: 2 };

function groupOf(name) {
  let m = FLAG_RE.exec(name);
  if (m) return { kind: 'flag', key: `flag ${m[1]}`, cloth: !m[2] };
  m = SAIL_RE.exec(name);
  if (m) return { kind: 'sail', key: `sail ${m[1]}`, cloth: !m[2] };
  m = LAMP_RE.exec(name);
  if (m) return { kind: 'lamp', key: `lamp ${m[1]}`, cloth: m[2] === 'cap' };
  return null;
}

// Every moving part as one geometry in the building's frame, and per vertex what moves it. Null on
// a checkout that has never baked the set.
export function buildKrakenMotion() {
  if (!models.hasAsset(ASSET)) return null;
  const names = models.assetParts(ASSET).filter(isKrakenMoving);
  if (!names.length) return null;
  // First the groups' measures, off the bake: every vertex of a group, in the building's frame.
  const groups = new Map();
  for (const name of names) {
    const g = groupOf(name);
    const { positions: p, at } = models.part(name);
    let G = groups.get(g.key);
    if (!G) groups.set(g.key, G = { kind: g.kind, key: g.key, all: [], cloth: [] });
    for (let i = 0; i < p.length; i += 3) {
      const v = [p[i] + at[0], p[i + 1] + at[1], p[i + 2] + at[2]];
      G.all.push(v);
      if (g.cloth) G.cloth.push(v);
    }
  }
  for (const G of groups.values()) {
    const src = G.cloth.length ? G.cloth : G.all;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of src) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
    G.lo = lo; G.hi = hi;
    G.seed = (hash32(`kraken:${G.key}`) % 1000) / 1000 * TAU;
    if (G.kind === 'sail') {
      // Which way the sail runs across: the main axis of its cloth on the plane (it is braced round,
      // not square to the ship), and its normal, the way it breathes.
      let cx = 0, cz = 0;
      for (const v of src) { cx += v[0]; cz += v[2]; }
      cx /= src.length; cz /= src.length;
      let xx = 0, zz = 0, xz = 0;
      for (const v of src) { const dx = v[0] - cx, dz = v[2] - cz; xx += dx * dx; zz += dz * dz; xz += dx * dz; }
      const a = 0.5 * Math.atan2(2 * xz, xx - zz);
      G.along = [Math.cos(a), Math.sin(a)];
      G.normal = [-Math.sin(a), Math.cos(a)];
      G.centre = [cx, cz];
      let half = 0;
      for (const v of src) half = Math.max(half, Math.abs((v[0] - cx) * G.along[0] + (v[2] - cz) * G.along[1]));
      G.half = half || 1;
    } else if (G.kind === 'lamp') {
      // The hook it hangs from: over the middle of its cap, at the top of the whole lantern.
      let top = -Infinity;
      for (const v of G.all) top = Math.max(top, v[1]);
      G.pivot = [(lo[0] + hi[0]) / 2, top, (lo[2] + hi[2]) / 2];
    }
  }
  // Then the geometry, and for each vertex its group, in the merge's own order (mergeParts keeps
  // the order of its pieces and of their vertices).
  const order = [...groups.keys()];
  const pieces = [], gi = [];
  for (const name of names) {
    const { at } = models.part(name);
    const g = mesh(name, 0xffffff, { x: at[0], y: at[1], z: at[2] });
    pieces.push(g);
    const k = order.indexOf(groupOf(name).key);
    for (let i = 0; i < g.attributes.position.count; i++) gi.push(k);
  }
  const geometry = mergeParts(pieces);
  for (const g of pieces) g.dispose();
  if (!geometry || geometry.attributes.position.count !== gi.length) return null;
  geometry.computeBoundingSphere();
  // The fly ends and the lanterns move by a fraction of a unit.
  geometry.boundingSphere.radius += 0.5;
  return {
    geometry,
    base: Float32Array.from(geometry.attributes.position.array),
    group: Uint8Array.from(gi),
    groups: order.map((k) => groups.get(k)).map(({ all, cloth, ...g }) => ({ ...g, kind: KIND[g.kind] })),
  };
}

// Where every vertex is at sea time `t` (seconds), written into `out`: the pure half of
// updateKrakenMotion, and what tests/kraken-motion.test.mjs runs.
export function moveKraken(m, t, out) {
  const { base, group, groups } = m;
  const F = MOTION.flag, S = MOTION.sail, L = MOTION.lamp;
  // Per group, what does not change per vertex.
  const now = groups.map((G) => {
    if (G.kind === KIND.lamp) {
      const ax = L.swing * Math.sin(L.rate * t + G.seed), az = 0.7 * L.swing * Math.sin(1.3 * L.rate * t + 2 * G.seed);
      return { cx: Math.cos(ax), sx: Math.sin(ax), cz: Math.cos(az), sz: Math.sin(az) };
    }
    if (G.kind === KIND.sail) return { breathe: Math.sin(TAU * t / S.breatheS + G.seed) };
    return null;
  });
  for (let v = 0, i = 0; v < group.length; v++, i += 3) {
    let x = base[i], y = base[i + 1], z = base[i + 2];
    const G = groups[group[v]];
    if (G.kind === KIND.flag) {
      // Flying towards +x from its luff at the staff (jolly_roger in the bake).
      const len = G.hi[0] - G.lo[0] || 1;
      const d = Math.max(0, x - G.lo[0]), k = d / len;
      z += F.swing * len * k * Math.sin(F.wave * d / len - F.speed * t + G.seed);
      y -= F.droop * len * k * k;
    } else if (G.kind === KIND.sail) {
      // Hung from its yard at the top: the yard stays, the foot moves most.
      const h = G.hi[1] - G.lo[1] || 1;
      const k = Math.min(1, Math.max(0, (G.hi[1] - y) / h));
      const s = ((x - G.centre[0]) * G.along[0] + (z - G.centre[1]) * G.along[1]) / G.half;
      const push = h * k * (S.breathe * now[group[v]].breathe * (1 - Math.min(1, s * s))
        + S.ripple * Math.sin(S.wave * s - S.speed * t + G.seed));
      x += G.normal[0] * push;
      z += G.normal[1] * push;
    } else {
      // Swinging on its hook: about x, then about z, round the pivot.
      const r = now[group[v]], [px, py, pz] = G.pivot;
      let dx = x - px, dy = y - py, dz = z - pz;
      const y1 = dy * r.cx - dz * r.sx, z1 = dy * r.sx + dz * r.cx;
      dy = y1; dz = z1;
      const x2 = dx * r.cz - dy * r.sz, y2 = dx * r.sz + dy * r.cz;
      dx = x2; dy = y2;
      x = px + dx; y = py + dy; z = pz + dz;
    }
    out[i] = x; out[i + 1] = y; out[i + 2] = z;
  }
  return out;
}

export function attachKrakenMotion(group, material) {
  const m = buildKrakenMotion();
  if (!m) return null;
  const node = new THREE.Mesh(m.geometry, material);
  node.castShadow = true;
  node.receiveShadow = true;
  group.add(node);
  return { group, node, m };
}

export function updateKrakenMotion(s, t) {
  if (!s || !Number.isFinite(t)) return;
  const pos = s.m.geometry.attributes.position;
  moveKraken(s.m, t, pos.array);
  pos.needsUpdate = true;
}

export function disposeKrakenMotion(s) {
  if (!s) return;
  s.group.remove(s.node);
  s.m.geometry.dispose();
}
