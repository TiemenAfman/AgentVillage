// The kadehaven's planks on the stone quay (issue #85): planKade dug the basin round the quay
// district's planks and kept their ramp as ground, which left Hoogezand a two-cell islet in the
// middle of the harbour with the pier and its three boats beside it, while the finger jetties
// along the wall stood empty. `planKadePier` lays that harbour's planks from the wall instead, in
// the place of the finger nearest the old ramp, and digs the ramp and the old planks away.
//
// What is held here, on Hoogezand as fase 3 built it (tests/support/hoogezand-resort.mjs) with its
// houses moved to the resort, as the live island stands:
//   - the planks start on a quay cell and run five cells straight out into open water;
//   - no ground is left where the ramp stood, and the old planks' shelf is the basin's bed;
//   - every page and the sea moor the harbour's boats at the new planks (shared/quay.mjs);
//   - no plot moves, and the approach keeps every cell but its boardwalk out to the ramp;
//   - a second pass does nothing. (That placeAll after it is a no-op is held on new islands by
//     tests/resort.test.mjs, whose quays go through it.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, CHANNEL_H } from '../shared/terrain.mjs';
import { emptyLayout, planKadePier, planResort } from '../lib/layout.mjs';
import { mooringsFor, quaysOf } from '../shared/quay.mjs';
import { clone } from './support/village.mjs';
import { HOOGEZAND_RESORT as F } from './support/hoogezand-resort.mjs';

const key = (c) => `${c[0]},${c[1]}`;
const groundOf = (l) => makeTerrain(l.seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow || null });

function hoogezand() {
  const l = emptyLayout(F.seed, F.size, clone(F.grow));
  Object.assign(l, clone({
    polders: F.polders, fairway: F.fairway, works: F.works, harbours: F.harbours, landing: F.landing, town: F.town, lattice: F.lattice,
    zones: F.zones, bridges: F.bridges, districts: F.districts, plots: F.plots, paths: F.paths, terrainHash: F.hash,
  }));
  planResort(l, groundOf(l), { districts: [{ id: 'quay', kind: 'quay' }] });
  return l;
}

const n = F.harbours.findIndex((h) => h && h.shore[0] === F.districts.quay.shore[0] && h.shore[1] === F.districts.quay.shore[1]);
const before = hoogezand();
const after = hoogezand();
const T = planKadePier(after, groundOf(after), { seed: F.seed, size: F.size });

test('the quay harbour\'s planks start on the quay and run five cells out into open water', () => {
  assert.ok(T, 'the planks moved');
  assert.equal(after.terrainHash, T.hash);
  const h = after.harbours[n];
  const onKade = new Set(after.works.kade.cells.map(key));
  assert.ok(onKade.has(key(h.shore)), 'the shore is a quay cell');
  assert.deepEqual(h.slip, [h.shore]);
  assert.equal(h.side, before.harbours[n].side);
  const [wx, wz] = [-after.works.kade.back[0], -after.works.kade.back[1]];
  h.pier.forEach((c, i) => {
    assert.deepEqual(c, [h.shore[0] + wx * (i + 1), h.shore[1] + wz * (i + 1)], 'straight out from the wall');
    assert.ok(T.isWater(c[0], c[1]), `plank ${key(c)} over water`);
  });
  assert.equal(h.pier.length, 5);
  assert.deepEqual(after.districts.quay.shore, h.shore, 'the quay district\'s planks are the harbour\'s');
  assert.deepEqual(after.districts.quay.pier, h.pier);
});

test('where the ramp stood is the basin\'s bed, the old planks\' shelf with it', () => {
  const old = before.harbours[n];
  for (const [gx, gz] of [old.shore, ...old.slip, ...old.pier]) {
    assert.ok(T.isWater(gx, gz), `${gx},${gz} is water`);
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.equal(T.H[(gx + dx) + (gz + dz) * (T.size + 1)], CHANNEL_H, `corner of ${gx},${gz} on the bed`);
    }
  }
});

test('every page and the sea moor the harbour\'s boats at the new planks', () => {
  const view = (l) => ({ island: { landing: l.landing, harbours: l.harbours.filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: 3 })) }, districts: [{ pier: l.districts.quay.pier, shore: l.districts.quay.shore }] });
  const h = after.harbours[n];
  const q = quaysOf(T, view(after), after.landing).find((x) => x.side === h.side);
  assert.deepEqual(q.shore, h.shore, 'the quay every page derives is the one on record');
  const head = T.cellWorld(h.pier[4][0], h.pier[4][1]);
  const mine = mooringsFor('x', T, view(after)).filter((m) => m.side === h.side);
  assert.equal(mine.length, 3);
  for (const m of mine) assert.ok(Math.hypot(m.x - head[0], m.z - head[1]) < 2.5, `${m.id} lies at the new head`);
});

test('nothing else moves: plots as they were, the approach less its boardwalk', () => {
  assert.deepEqual(after.plots, before.plots);
  const id = `road:harbour:${n}:approach`;
  const was = before.paths.find((p) => p.id === id).cells.map(key);
  const now = after.paths.find((p) => p.id === id).cells.map(key);
  assert.deepEqual(now, was.slice(was.length - now.length), 'the approach keeps its landward end');
  for (const c of now) { const [gx, gz] = c.split(',').map(Number); assert.ok(!T.isWater(gx, gz), `${c} on land`); }
  const others = (l) => l.paths.filter((p) => !String(p.id).startsWith(`road:harbour:${n}`));
  assert.deepEqual(others(after), others(before));
});

test('asked again it does nothing', () => {
  const again = clone(after);
  assert.equal(planKadePier(again, T, { seed: F.seed, size: F.size }), null);
  assert.deepEqual(again, after);
});
