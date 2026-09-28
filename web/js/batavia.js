// The Batavia riding at anchor (Plans/batavia.md): her hull heaves, pitches and rolls a little
// and her flags fly. Cosmetic, on this page's own clock, with a phase from her id - nothing
// here is on the wire, and two screens need not agree on which way she is leaning, any more
// than they agree on a chimney's smoke.
//
// The flags are baked inside her one asset with their origins at the middle of their hoists
// (scripts/build-batavia.py), streaming aft along -z because a ship at anchor lies head to
// the wind. buildings.js leaves them out of the merged hull (`isBataviaMoving`); this file
// builds all five into one geometry - one more draw call a ship, not five - and waves them by
// moving its vertices: how far a vertex is from the hoist says how far it swings, so the hoist
// stays on its staff and the fly end does the flying.
//
// The swell is put on the hull's own mesh, never on the record's group. The group is where the
// plot put her, and main.js reads her blockers off its position and turn (blockersOf): tilting
// it would walk her hull's solids round the roads with every roll. The flags hang on the hull
// mesh, so they lean with her.
//
// Shaped like sawmill.js: `attachBatavia` builds, `updateBatavia` moves, `disposeBatavia`
// gives the geometry back. Pure of the DOM, so tests/batavia.test.mjs can wave a flag under Node.
import * as THREE from 'three';
import { hash32 } from 'shared/rng.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';
import { mesh, mergeParts, isBataviaMoving, shipDraught, shipLivery } from './buildings.js';
import * as models from './models.js';

// The swell at anchor: small, slow and never in step. A roll of 0.012 rad is 0.14 at the main
// truck, which is what makes a ship read as afloat from the shore; the heave is the sea's own
// order of size (boat.js bobs a Benchy 0.03). Periods in seconds, none a multiple of another,
// so the three do not come round together and nod her like a toy.
export const SWELL = Object.freeze({
  heave: 0.028, heaveS: 5.3,
  pitch: 0.0045, pitchS: 7.1,
  roll: 0.012, rollS: 9.7,
});
// The flags: how far the fly end of a flag swings, as a share of its length, the wave along it,
// and how fast the wave runs. A pennant is long and light and gets more of all of it.
const FLAG = Object.freeze({ swing: 0.12, wave: 5.2, speed: 6.5, droop: 0.05 });
const PENNANT = Object.freeze({ swing: 0.2, wave: 3.6, speed: 7.5, droop: 0.02 });

const TAU = Math.PI * 2;

// Every moving part of the bake, in the register's order: `batavia flag ensign:0`, `:1`, ...
export function flagParts() {
  return models.assetParts('batavia').filter(isBataviaMoving);
}

// The flags as one geometry in the hull's frame (her waterline at y = 0), and for each vertex
// how far it lies from its hoist and how that flag waves. The repaint is the livery's: the
// main truck's flag and the pennants take its stripes, the ensign and the jack never do.
export function buildFlags(id) {
  const draught = shipDraught();
  const livery = shipLivery(id);
  const geometries = [];
  const fly = [], len = [], kind = [], seed = [];
  for (const name of flagParts()) {
    const part = models.part(name);
    const m = /^batavia (flag|pennant) (\w+):?(\d*)$/.exec(name);
    const stripe = m && m[3] !== '' ? Number(m[3]) : 0;
    const own = m && (m[1] === 'pennant' || m[2] === 'main') && livery.flag ? livery.flag[stripe] : null;
    const g = mesh(name, own ?? 0xffffff, { x: part.at[0], y: part.at[1] - draught, z: part.at[2], repaint: own != null });
    geometries.push(g);
    // The flag's length is the furthest its vertices reach aft of the hoist, the same for
    // every stripe of it; the seed keeps two flags from waving in step.
    let far = 0;
    for (let i = 2; i < part.positions.length; i += 3) far = Math.max(far, -part.positions[i]);
    const pennant = m && m[1] === 'pennant';
    const s = (hash32(`${id}:${m ? m[2] : name}`) % 1000) / 1000 * TAU;
    for (let i = 2; i < part.positions.length; i += 3) {
      fly.push(Math.max(0, -part.positions[i]));
      len.push(far || 1);
      kind.push(pennant ? 1 : 0);
      seed.push(s);
    }
  }
  if (!geometries.length) return null;
  const geometry = mergeParts(geometries);
  for (const g of geometries) g.dispose();
  return {
    geometry,
    base: Float32Array.from(geometry.attributes.position.array),
    fly: Float32Array.from(fly), len: Float32Array.from(len), kind: Uint8Array.from(kind), seed: Float32Array.from(seed),
  };
}

// Where the flags' vertices are at time t: the pure half of updateBatavia, and what the test
// runs. Written into `out` (a Float32Array the size of `base`).
export function waveFlags(f, t, out) {
  const { base, fly, len, kind, seed } = f;
  for (let v = 0, i = 0; v < fly.length; v++, i += 3) {
    const d = fly[v];
    out[i] = base[i]; out[i + 1] = base[i + 1]; out[i + 2] = base[i + 2];
    if (d <= 0) continue;
    const w = kind[v] ? PENNANT : FLAG;
    const k = d / len[v];
    out[i] += w.swing * len[v] * k * Math.sin(w.wave * d - w.speed * t + seed[v]);
    out[i + 1] -= w.droop * len[v] * k * k;
  }
  return out;
}

// Hung on the hull's own mesh (see the top of this file), with a phase from her id.
export function attachBatavia(hull, id, material) {
  if (!hull || !models.hasAsset('batavia')) return null;
  const flags = buildFlags(id);
  let flagMesh = null;
  if (flags) {
    flagMesh = new THREE.Mesh(flags.geometry, material);
    flagMesh.castShadow = true;
    // Waving moves the fly ends by a fraction of a unit; a sphere that has room for it means
    // the flags are never culled while the ship is on screen.
    flags.geometry.boundingSphere.radius += 0.5;
    hull.add(flagMesh);
  }
  const h = hash32(`${id}:swell`);
  return {
    hull, flags, flagMesh, t: 0,
    phase: [(h % 997) / 997 * TAU, ((h >>> 10) % 991) / 991 * TAU, ((h >>> 20) % 983) / 983 * TAU],
  };
}

export function swellAt(s, t) {
  return {
    y: SWELL.heave * Math.sin(t * TAU / SWELL.heaveS + s.phase[0]),
    pitch: SWELL.pitch * Math.sin(t * TAU / SWELL.pitchS + s.phase[1]),
    roll: SWELL.roll * Math.sin(t * TAU / SWELL.rollS + s.phase[2]),
  };
}

export function updateBatavia(s, dt) {
  if (!s) return;
  s.t += Number.isFinite(dt) ? dt : 0;
  const { y, pitch, roll } = swellAt(s, s.t);
  s.hull.position.y = y;
  s.hull.rotation.x = pitch;
  s.hull.rotation.z = roll;
  if (s.flags) {
    const pos = s.flags.geometry.attributes.position;
    waveFlags(s.flags, s.t, pos.array);
    pos.needsUpdate = true;
  }
}

export function disposeBatavia(s) {
  if (!s) return;
  if (s.flagMesh) {
    s.hull.remove(s.flagMesh);
    s.flags.geometry.dispose();
  }
  s.hull.position.y = 0;
  s.hull.rotation.x = 0;
  s.hull.rotation.z = 0;
}

// Where a floating building stands on its plot: turned the way the layout's rot says (rot 0
// faces -z, 1 +x, 2 +z, 3 -x - housePlacement's turn, which leaves a plot that is not three by
// three exactly as surveyed), on the sea rather than on the bed under it, and with the middle
// of everything she is - `bbox`, bowsprit to gallery, yard arm to yard arm - on the middle of
// the plot. Not her waterline's middle: she is 15.1 long from the gallery to the bowsprit and
// the plot is 16, but her bowsprit reaches 8.7 forward of her midships and her stern 6.5 aft,
// so centred on her hull the bowsprit would stand 0.7 out over the next plot's water. Her hull
// lies 1.1 aft of the plot's middle instead, which nobody can see from the shore.
//
// main.js's poseOnPlot and guest-island.js's raise both ask this for anything built with
// `floats`, so a test can hold all four turns of a 4 by 16 plot to the one copy. The plot is
// stamped with `w` along x and `d` along z, so at an odd rot it is 16 by 4. The turn of a
// local point is the one blockersOf in main.js uses: x' = x cos + z sin, z' = -x sin + z cos.
export function floatingPose(plot, half, bbox = null) {
  const yaw = Math.PI - (plot.rot || 0) * Math.PI / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const mx = bbox ? (bbox.min.x + bbox.max.x) / 2 : 0, mz = bbox ? (bbox.min.z + bbox.max.z) / 2 : 0;
  return {
    x: plot.gx + plot.w / 2 - half - (mx * c + mz * s),
    y: SEA_LEVEL,
    z: plot.gz + plot.d / 2 - half - (-mx * s + mz * c),
    yaw,
  };
}
