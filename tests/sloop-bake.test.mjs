// The sloop's bake (scripts/build-sloop.py, Plans/nieuwe-sloep.md chip 3) held to what she is for: decks
// at the heights her anchors say, stairs a body can climb, every deck reached on foot from the waist and
// none of it leading off her, entry ports open to the deck, pins up the mast cut to the climb, a hole in
// the top to come up through, guns that see out of their ports, a harpoon on her middle line, a free
// wheel, her sail and flag as the parts web/js/ship-motion.js moves, inside her budget.
//
// Only the bake: the walk map is cut here from her triangles with scripts/build-shipwalk.mjs's own cut,
// at her own waterline, so these hold before the craft and the committed map are made again from her
// (chip 4) - and the same cut is what that map will be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';
import { DECK_Y } from '../shared/hull.mjs';
import { RUNG_STEP, RUNG_FROM, RUNG_R } from '../shared/deck.mjs';
import { createSurface, STEP_UP, STEP_DOWN, HEAD } from '../shared/hullwalk.mjs';
import { layer, gridsOf } from '../scripts/build-shipwalk.mjs';
import { heightsAt } from '../scripts/hull-cut.mjs';
import { checkSet, HERO_BUDGETS } from '../scripts/model-rules.mjs';

const A = PIRATESHIP.anchors;
const W = 0.83;                                   // the keeper's draught (checkpoint A)
const lift = A.waterline[1] + DECK_Y;
const hull = PIRATESHIP.parts['pirateship hull'];
const pos = hull.positions;
const { grid, aloft } = gridsOf(PIRATESHIP);
const surface = createSurface({ ...layer(pos, grid, lift), aloft: layer(pos, aloft, lift) });
// The top's own layer alone, for asking what its floor is without the deck eight units under it answering.
const top = createSurface(layer(pos, aloft, lift));
const cy = (p) => p[1] - lift;                     // an anchor's height in the walk's frame
const Q = grid.q;                                   // the cut's height step: what "at" means here

const pairs = (kind) => {
  const out = {};
  for (const [k, p] of Object.entries(A)) {
    const m = new RegExp(`^${kind}\\.(.+)\\.(lo|hi)$`).exec(k);
    if (m) (out[m[1]] ??= {})[m[2]] = p;
  }
  return out;
};
const decks = pairs('deck'), stairs = pairs('stair'), climbs = pairs('climb'), mounts = pairs('mount');
const DECK = cy(decks.waist.lo);

test('she floats at the keeper\'s draught', () => {
  assert.equal(A.waterline[1], W);
});

test('every deck rectangle is planking at its anchor\'s height, the cabin\'s under the quarterdeck included', () => {
  for (const [name, { lo, hi }] of Object.entries(decks)) {
    assert.equal(lo[1], hi[1], `deck.${name} is not level`);
    const y = cy(lo);
    // Something may stand on a deck - the capstan, the mast, a bunk, the top's rim - so a point may find
    // no floor to stand on (it is under that) or a higher one, but never a lower one, and most of it is
    // planking (six of nine, as build-batavia.py's measured() asks of hers).
    let at = 0;
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fz of [0.1, 0.5, 0.9]) {
        const x = lo[0] + (hi[0] - lo[0]) * fx, z = lo[2] + (hi[2] - lo[2]) * fz;
        const f = (name === 'nest' ? top : surface).floorIn(x, z, y + 0.06, 0.1);
        assert.ok(f === null || f >= y - Q, `deck.${name} at (${x.toFixed(2)}, ${z.toFixed(2)}): a floor at ${f}, under the anchor's ${y.toFixed(3)}`);
        if (f !== null && Math.abs(f - y) <= Q) at++;
      }
    }
    assert.ok(at >= 6, `deck.${name}: only ${at} of 9 points on planking at ${y.toFixed(3)}`);
  }
});

test('every stair rises step by step, never more than a step at once', () => {
  for (const [name, { lo, hi }] of Object.entries(stairs)) {
    const x = (lo[0] + hi[0]) / 2;
    let y = cy(lo);
    const n = Math.ceil(Math.abs(hi[2] - lo[2]) / 0.02);
    for (let i = 0; i <= n; i++) {
      const z = lo[2] + (hi[2] - lo[2]) * (i / n);
      const f = surface.floorIn(x, z, y, STEP_UP);
      assert.ok(f !== null, `stair.${name}: no floor at z ${z.toFixed(2)}`);
      assert.ok(f >= y - Q && f - y <= STEP_UP, `stair.${name}: from ${y.toFixed(3)} to ${f.toFixed(3)} at z ${z.toFixed(2)}`);
      y = f;
    }
    assert.ok(Math.abs(y - cy(hi)) <= Q, `stair.${name} ends at ${y.toFixed(3)}, not ${cy(hi).toFixed(3)}`);
  }
});

// Everywhere a body can walk to from the waist, in steps of a tenth, by the walk's own rules: a floor
// that holds its footprint, nothing in the way, no drop of more than a step.
const STEP = 0.1;
const key = (x, z, y) => `${Math.round(x / STEP)},${Math.round(z / STEP)},${Math.round(y / Q)}`;
function flood(start) {
  const seen = new Map();
  const todo = [start];
  seen.set(key(start.x, start.z, start.y), start);
  while (todo.length) {
    const p = todo.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = p.x + dx * STEP, z = p.z + dz * STEP;
      const f = surface.standAt(x, z, p.y);
      if (f === null || f < p.y - STEP_DOWN || surface.blockedAt(x, z, f)) continue;
      const k = key(x, z, f);
      if (seen.has(k)) continue;
      const q = { x, z, y: f };
      seen.set(k, q);
      todo.push(q);
    }
  }
  return [...seen.values()];
}
const start = { x: 0, z: 1.0, y: DECK };
const walked = flood(start);
const reaches = (x, z, y, tol = 0.15) => walked.some((p) => Math.abs(p.x - x) <= tol && Math.abs(p.z - z) <= tol && Math.abs(p.y - y) <= 2 * Q);

test('from the waist a body walks to every deck, every gun\'s and the harpoon\'s stand, the wheel and the ladders\' heads', () => {
  assert.ok(surface.standAt(start.x, start.z, start.y) !== null, 'the start is not on the waist');
  for (const [name, { lo, hi }] of Object.entries(decks)) {
    if (name === 'nest') continue;               // up the pins, not on foot
    const x = (lo[0] + hi[0]) / 2, z = (lo[2] + hi[2]) / 2;
    assert.ok(reaches(x, z, cy(lo), Math.max(0.15, Math.min(Math.abs(hi[0] - lo[0]), Math.abs(hi[2] - lo[2])) / 2)), `deck.${name} is not reached on foot`);
  }
  for (const [name, { lo }] of Object.entries(mounts)) assert.ok(reaches(lo[0], lo[2], cy(lo)), `mount.${name}'s stand is not reached`);
  assert.ok(reaches(A.helm[0], A.helm[2], cy(A.helm)), 'the wheel is not reached');
  assert.ok(reaches(A.cargo[0], A.cargo[2], cy(A.cargo)), 'where cargo goes is not reached');
  for (const [name, { lo, hi }] of Object.entries(climbs)) {
    if (name === 'mast') assert.ok(reaches(lo[0], lo[2], cy(lo)), 'the foot of the pins is not reached');
    else assert.ok(reaches(hi[0], hi[2], cy(hi)), `climb.${name}'s head is not reached`);
  }
});

test('and nowhere off her: every place walked is inside her side', () => {
  for (const p of walked) {
    // her bottom is under every place walked, and it is within her side's breadth and length
    assert.ok(heightsAt(pos, p.x, p.z, lift).some((h) => h < p.y - 0.3), `walked to (${p.x.toFixed(2)}, ${p.z.toFixed(2)}), with nothing of her under it`);
    assert.ok(Math.abs(p.x) < 1.5 && p.z > -4.6 && p.z < 4.4, `walked to (${p.x.toFixed(2)}, ${p.z.toFixed(2)}, ${p.y.toFixed(2)})`);
  }
});

test('the entry ports are open from the deck up, wide enough for a body, with a ladder at each', () => {
  const ports = pairs('port');
  assert.deepEqual(Object.keys(ports).sort(), ['1', '2']);
  for (const { lo, hi } of Object.values(ports)) {
    assert.ok(Math.abs(hi[2] - lo[2]) >= 0.4, 'narrower than 0.4');
    const s = Math.sign(lo[0]), z0 = Math.min(lo[2], hi[2]), z1 = Math.max(lo[2], hi[2]);
    for (let z = z0 + 0.04; z <= z1 - 0.04; z += 0.04) {
      for (let x = Math.abs(lo[0]) - 0.1; x <= Math.abs(lo[0]) + 0.05; x += 0.025) {
        const hs = heightsAt(pos, s * x, z, lift).filter((h) => h > cy(lo) + 0.03 && h < cy(lo) + HEAD);
        assert.deepEqual(hs, [], `something stands in the port at (${(s * x).toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
    const ladder = Object.entries(climbs).find(([n, c]) => n.startsWith('side-') && Math.sign(c.lo[0]) === s && c.lo[2] >= z0 && c.lo[2] <= z1);
    assert.ok(ladder, 'no rope ladder hangs at this port');
  }
});

test('the pins up the mast lie every RUNG_STEP from the deck, RUNG_FROM before whoever climbs them', () => {
  const { lo } = climbs.mast;
  const pinZ = lo[2] + RUNG_FROM;
  // A pin is a rod across the mast's after face: its ends are corners at its half-length either side.
  const half = Math.max(...pos.filter((_, i) => i % 3 === 0 && Math.abs(pos[i + 2] - pinZ) < 0.02 && pos[i + 1] > lo[1] + 0.1 && pos[i + 1] < A['deck.nest.lo'][1]).map(Math.abs));
  const ys = [];
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i] - half) < 1e-5 && Math.abs(pos[i + 2] - pinZ) < 0.02) ys.push(pos[i + 1]);
  }
  const centres = [...new Set(ys.map((y) => Math.round((y - lo[1] - RUNG_R) / RUNG_STEP)))].sort((a, b) => a - b);
  assert.ok(centres.length > 50, `only ${centres.length} pins`);
  assert.equal(centres[0], 1);
  assert.equal(centres.at(-1), centres[0] + centres.length - 1, 'a pin is missing');
  for (const k of centres) {
    const at = ys.filter((y) => Math.round((y - lo[1] - RUNG_R) / RUNG_STEP) === k);
    const mid = (Math.min(...at) + Math.max(...at)) / 2;
    assert.ok(Math.abs(mid - (lo[1] + k * RUNG_STEP + RUNG_R)) < 1e-4, `pin ${k} at ${mid}`);
  }
  assert.ok(lo[1] + centres.at(-1) * RUNG_STEP + RUNG_R <= A['deck.nest.lo'][1] - 0.06 + 1e-9, 'the top pin is in the nest\'s floor');
});

test('the top has a hole the pins come up through, and its floor round it to stand on and a seat', () => {
  const { lo, hi } = climbs.mast;
  const floor = A['deck.nest.lo'][1];
  for (const dz of [0.0, 0.08, 0.16]) {
    const hs = heightsAt(pos, 0, lo[2] + dz, 0).filter((h) => h > floor - 0.3 && h < floor + HEAD);
    assert.deepEqual(hs, [], `a face over the hole at z ${(lo[2] + dz).toFixed(2)}: ${hs}`);
  }
  const off = surface.standAt(hi[0], hi[2], cy(hi) + 0.02);
  assert.ok(off !== null && Math.abs(off - cy(hi)) <= Q && !surface.blockedAt(hi[0], hi[2], off), 'nowhere to step off at the top');
  // and room up there to stand about in, not one spot: a body's footprint between the mast, the hole and the rim
  let room = 0;
  for (let x = -0.8; x <= 0.8; x += 0.05) {
    for (let z = A['mast.main'][2] - 0.85; z <= A['mast.main'][2] + 0.85; z += 0.05) {
      const f = surface.standAt(x, z, cy(hi) + 0.02);
      if (f !== null && Math.abs(f - cy(hi)) <= Q && !surface.blockedAt(x, z, f)) room++;
    }
  }
  assert.ok(room >= 60, `only ${room} places to stand in the top`);
  assert.ok(A.nest[1] > floor, 'the seat is not over the floor');
});

// Whether the segment a->b passes through any triangle of the hull.
function crosses(a, b) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  for (let t = 0; t < pos.length; t += 9) {
    const p0 = [pos[t], pos[t + 1], pos[t + 2]], p1 = [pos[t + 3], pos[t + 4], pos[t + 5]], p2 = [pos[t + 6], pos[t + 7], pos[t + 8]];
    const e1 = p1.map((v, i) => v - p0[i]), e2 = p2.map((v, i) => v - p0[i]);
    const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = a.map((v, i) => v - p0[i]);
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
    if (u < 0 || u > 1) continue;
    const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
    if (v < 0 || u + v > 1) continue;
    const w = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
    if (w > 0 && w < 1) return true;
  }
  return false;
}

test('the guns stand on the waist and see out of their ports; the harpoon is on her middle line, over the bow', () => {
  const guns = Object.entries(mounts).filter(([n]) => n.startsWith('cannon'));
  assert.equal(guns.length, 2);
  for (const [name, { lo, hi }] of guns) {
    assert.equal(lo[1], A['deck.waist.lo'][1], `mount.${name} is not on the waist`);
    const s = Math.sign(hi[0] - lo[0]);
    assert.ok(Math.abs(hi[2] - lo[2]) < 1e-9 && s !== 0, `mount.${name} does not point square out`);
    // the bore's line, a hand and a half over the deck, out past her side
    assert.ok(!crosses([hi[0], hi[1] + 0.15, hi[2]], [s * 2.2, hi[1] + 0.15, hi[2]]), `mount.${name} fires into her own bulwark`);
  }
  const { lo, hi } = mounts.harpoon;
  assert.ok(Math.abs(lo[0]) < 0.05 && Math.abs(hi[0]) < 0.05, 'the harpoon is off her middle line');
  assert.ok(hi[2] > lo[2], 'the harpoon does not point forward');
});

test('the wheel has room behind it for whoever steers', () => {
  const y = cy(A.helm);
  const f = surface.standAt(A.helm[0], A.helm[2], y + 0.05);
  assert.ok(f !== null && Math.abs(f - y) <= Q, `no floor at the helm: ${f}`);
  assert.ok(!surface.blockedAt(A.helm[0], A.helm[2], f), 'the helm is in something');
});

test('what moves is her sail and her flag, as parts of their own; the sail a regular grid under its yard', () => {
  assert.deepEqual(Object.keys(PIRATESHIP.parts).sort(), ['pirateship flag', 'pirateship glow', 'pirateship hull', 'pirateship sail']);
  const sail = PIRATESHIP.parts['pirateship sail'];
  assert.equal(sail.positions.length / 9, 10 * 14 * 2 * 2, 'ten by fourteen cloths, both sides');
  let top = -Infinity;
  for (let i = 1; i < sail.positions.length; i += 3) {
    assert.ok(sail.positions[i] <= 1e-9, 'a corner of the sail is above its yard');
    top = Math.max(top, sail.positions[i]);
  }
  assert.ok(top > -0.1, 'the sail does not hang from its yard');
  const flag = PIRATESHIP.parts['pirateship flag'];
  assert.ok(flag.positions.some((v, i) => i % 3 === 2 && Math.abs(v) < 1e-9), 'the flag is not hung by its luff at its origin');
});

test('she is within her budget and the model rules, with her colour zones named', () => {
  assert.deepEqual(checkSet('pirateship', PIRATESHIP), []);
  const tris = Object.values(PIRATESHIP.parts).reduce((n, p) => n + p.positions.length / 9, 0);
  assert.equal(HERO_BUDGETS.pirateship, 20000);
  assert.ok(tris <= 16000, `${tris} triangles, over the 16k she was meant to come in under`);
  for (const p of Object.values(PIRATESHIP.parts)) {
    assert.equal(p.zones.length, p.positions.length / 9, 'a zone a triangle');
    assert.ok(p.zones.every((z) => Number.isInteger(z) && z >= 0 && z < p.zoneNames.length));
  }
});
