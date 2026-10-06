// The harbour's floor dredged level (`planHarbourFloor`, the keeper's "restjes rare
// watervlekken", 6 October 2026). The funnel's dig took only sand, the quay's dig its basin, west
// rows, dock and anchorage, and between those masks the bay the ring drew stayed: lighter,
// square-edged shallows in a harbour whose floor is otherwise CHANNEL_H.
//
// What is held here, on Hoogezand as fase 3 built it (tests/support/hoogezand-resort.mjs) with the
// quay's harbour moved onto the quay (`planKadePier`), as the live island stands:
//   - the three stains the keeper saw are on the bed: the block between the west rows and the
//     dock, the islet the funnel's dig left standing, the lane down the axis past the quay's end;
//   - every funnel cell under water and reached from the head lies on the bed, unless something
//     stands on it or beside it;
//   - the dig only lowers, and never a corner of anything that stands;
//   - no plot or road moves, and a second pass does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, CHANNEL_H, SEA_LEVEL, funnelHas } from '../shared/terrain.mjs';
import { emptyLayout, planKadePier, planResort, planHarbourFloor } from '../lib/layout.mjs';
import { clone } from './support/village.mjs';
import { HOOGEZAND_RESORT as F } from './support/hoogezand-resort.mjs';

const groundOf = (l) => makeTerrain(l.seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow || null });

function hoogezand() {
  const l = emptyLayout(F.seed, F.size, clone(F.grow));
  Object.assign(l, clone({
    polders: F.polders, fairway: F.fairway, works: F.works, harbours: F.harbours, landing: F.landing, town: F.town, lattice: F.lattice,
    zones: F.zones, bridges: F.bridges, districts: F.districts, plots: F.plots, paths: F.paths, terrainHash: F.hash,
  }));
  planResort(l, groundOf(l), { districts: [{ id: 'quay', kind: 'quay' }] });
  planKadePier(l, groundOf(l), { seed: F.seed, size: F.size });
  return l;
}

const before = hoogezand();
const B = groundOf(before);
const after = hoogezand();
const T = planHarbourFloor(after, groundOf(after), { seed: F.seed, size: F.size });
const N = F.size + 1;
const corners = (H, gx, gz) => [H[gx + gz * N], H[gx + 1 + gz * N], H[gx + (gz + 1) * N], H[gx + 1 + (gz + 1) * N]];
const top = (H, gx, gz) => Math.max(...corners(H, gx, gz));

test('the stains the keeper saw lie on the bed', () => {
  assert.ok(T, 'the floor was dredged');
  assert.equal(after.terrainHash, T.hash);
  assert.equal(after.harbourFloor, true);
  assert.equal(after.works.dig.length, before.works.dig.length + 1, 'one dig more');
  // [cell, what it was]: the old bay between the west rows and the dock, the islet the funnel's dig
  // left (above BEACH_MAX, so not sand) and its profile sank, the lane down the axis past the quay.
  for (const [gx, gz] of [[140, 304], [142, 306], [141, 311], [142, 311], [149, 316], [160, 317]]) {
    assert.ok(top(B.H, gx, gz) > CHANNEL_H + 0.1, `${gx},${gz} was a shallow (${top(B.H, gx, gz)})`);
    assert.equal(top(T.H, gx, gz), CHANNEL_H, `${gx},${gz} on the bed`);
  }
});

test('the funnel\'s water reached from the head is one floor, but where something stands', () => {
  const held = new Set(after.works.dig.at(-1).hold.map((c) => `${c[0]},${c[1]}`));
  const standing = new Set();
  for (const p of Object.values(after.plots)) {
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) standing.add(`${p.gx + x},${p.gz + z}`);
  }
  const under = (H, gx, gz) => corners(H, gx, gz).every((h) => h < SEA_LEVEL);
  const h = after.works.haven;
  const seen = new Set([`${h.top[0]},${h.top[1]}`]), queue = [h.top];
  let checked = 0;
  for (let i = 0; i < queue.length; i++) {
    const [gx, gz] = queue[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz, k = `${nx},${nz}`;
      if (seen.has(k) || nx < 0 || nz < 0 || nx >= F.size || nz >= F.size || !funnelHas(h, nx, nz)) continue;
      seen.add(k);
      if (!under(B.H, nx, nz)) continue;
      queue.push([nx, nz]);
      if (held.has(k) || standing.has(k)) continue;
      assert.ok(top(T.H, nx, nz) <= CHANNEL_H, `${k} is above the bed: ${top(T.H, nx, nz)}`);
      checked++;
    }
  }
  assert.ok(checked > 500, `${checked} cells of harbour`);
});

test('the dig only lowers, and never what stands', () => {
  for (let k = 0; k < T.H.length; k++) assert.ok(T.H[k] <= B.H[k], `corner ${k} rose`);
  for (const [id, p] of Object.entries(after.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) {
      assert.deepEqual(corners(T.H, p.gx + x, p.gz + z), corners(B.H, p.gx + x, p.gz + z), `${id} at ${p.gx + x},${p.gz + z}`);
    }
  }
  for (const p of after.paths) for (const [gx, gz] of p.cells || []) {
    assert.deepEqual(corners(T.H, gx, gz), corners(B.H, gx, gz), `${p.id} at ${gx},${gz}`);
  }
});

test('nothing moves, and asked again it does nothing', () => {
  assert.deepEqual(after.plots, before.plots);
  assert.deepEqual(after.paths, before.paths);
  assert.deepEqual(after.harbours, before.harbours);
  const again = clone(after);
  assert.equal(planHarbourFloor(again, T, { seed: F.seed, size: F.size }), null);
  assert.deepEqual(again, after);
});

test('not before the quay\'s harbour stands on the quay', () => {
  const l = emptyLayout(F.seed, F.size, clone(F.grow));
  Object.assign(l, clone({ polders: F.polders, fairway: F.fairway, works: F.works, harbours: F.harbours, districts: F.districts, plots: F.plots, paths: F.paths }));
  assert.equal(planHarbourFloor(l, groundOf(l), { seed: F.seed, size: F.size }), null);
  assert.equal(l.harbourFloor, undefined, 'still to be asked');
});
