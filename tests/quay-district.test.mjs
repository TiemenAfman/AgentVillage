// The quay, measured against the water it is named after.
//
// A Cowork task's settler arrives by boat, so its district is the one place on the island
// whose position is not a preference: the planks have to stand over water a hull could
// reach, and the houses have to stand beside the planks. Both were wrong at once. The
// picker read `terrain.coastCells`, which is every land cell with water beside it -
// lake and river included - and then rewarded a shore near the town, so on the island this
// was found on it chose the lake six cells from the town square. And `pickSeed` weighs the
// shore it is handed against room, which a coast never has much of, so the parcel went
// thirty-two cells inland of even those planks.
//
// Nothing here asserts a coordinate: the island is grown from a seed and every seed puts
// its quay somewhere else. What has to hold is that the planks are over open sea, that the
// harbour houses are within sight of them, and that an island already carrying the old
// answer is repaired without disturbing anything else standing on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 128;
const SEEDS = [1337, 7, 90210];

// Water you can sail in from outside, worked out again here rather than imported: a test
// that borrows the implementation it is checking only proves the code agrees with itself.
function seaCells(terrain) {
  const n = terrain.size;
  const seen = new Set();
  const queue = [];
  const push = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return;
    const key = `${gx},${gz}`;
    if (seen.has(key) || !terrain.isWater(gx, gz)) return;
    seen.add(key);
    queue.push([gx, gz]);
  };
  for (let g = 0; g < n; g++) { push(g, 0); push(g, n - 1); push(0, g); push(n - 1, g); }
  for (let h = 0; h < queue.length; h++) {
    const [gx, gz] = queue[h];
    push(gx + 1, gz); push(gx - 1, gz); push(gx, gz + 1); push(gx, gz - 1);
  }
  return seen;
}

// A village with one Cowork district in it and nothing else, which is the smallest thing
// that has a quay at all. Seven harbour houses: enough to need a parcel rather than a
// single cell, and the number the quay reaches on a working day.
function coworkVillage(houses = 7) {
  const startedAt = Date.UTC(2026, 0, 2);
  return {
    districts: [{ id: 'quay', kind: 'quay', name: 'The Quay', population: houses, firstSeenAt: startedAt }],
    buildings: Array.from({ length: houses }, (_, i) => ({
      id: `house:cowork-${i}`, sessionId: `cowork-${i}`, kind: 'house', district: 'quay',
      harbour: true, tier: 'hut', startedAt: startedAt + i * 1000,
    })),
    milestones: [],
    furniture: [],
    stats: { settlers: houses },
  };
}

const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

for (const seed of SEEDS) {
  test(`the quay stands at the sea (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const { terrain } = placeAll(layout, coworkVillage(), { seed, size: SIZE });
    const quay = layout.districts.quay;
    assert.ok(quay, 'the island has a quay');
    assert.ok(quay.pier.length, 'the quay has planks');

    const sea = seaCells(terrain);
    for (const [gx, gz] of quay.pier) {
      assert.ok(sea.has(`${gx},${gz}`), `plank at ${gx},${gz} stands over water reachable from open sea`);
      assert.ok(!terrain.isRiver(gx, gz), `plank at ${gx},${gz} is not laid along a river`);
    }

    // Every parcel the quay holds is seeded against its own shore. This is the leash
    // itself: two super-cells, and four once it has widened because the first ring had no
    // room. Measured over these seeds it never needs the second.
    const lat = layout.lattice;
    const shoreCell = [
      Math.floor((quay.shore[0] - lat.anchor[0]) / lat.pitch),
      Math.floor((quay.shore[1] - lat.anchor[1]) / lat.pitch),
    ];
    for (const lobe of quay.lobes) {
      assert.ok(cheb(lobe.seed, shoreCell) <= 4, `a quay parcel seeded ${cheb(lobe.seed, shoreCell)} super-cells from its shore`);
    }

    // And within sight of the planks. A quayside spreads along the beach it is on, so the
    // far end of it is further off than the leash - sixteen cells over these seeds, where
    // the island this was found on had its harbour houses thirty-three cells inland.
    const harbour = Object.entries(layout.plots).filter(([id]) => id.startsWith('house:cowork-'));
    assert.equal(harbour.length, 7, 'every harbour house was given ground');
    for (const [id, p] of harbour) {
      const reach = Math.min(...quay.pier.map((c) => cheb(c, [p.gx + 1, p.gz + 1])));
      assert.ok(reach <= 16, `${id} stands ${reach} cells from the pier`);
    }
  });
}

test('an island whose quay was planned inland is repaired, and nothing else moves', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  const village = coworkVillage();
  // A village with a second district, so there is something on the island that the repair
  // is not allowed to touch.
  village.districts.push({ id: 'p:demo', kind: 'project', name: 'Demo', population: 4, firstSeenAt: Date.UTC(2026, 0, 1) });
  for (let i = 0; i < 4; i++) {
    village.buildings.push({
      id: `house:demo-${i}`, sessionId: `demo-${i}`, kind: 'house', district: 'p:demo',
      harbour: false, tier: 'hut', startedAt: Date.UTC(2026, 0, 1) + i * 1000,
    });
  }
  village.stats.settlers = village.buildings.length;
  placeAll(layout, village, { seed, size: SIZE });

  // Now forge the island as it was before: the quay's planks out on the lake, its parcel
  // left where it stands, and no `quayV` on record. This is what every island that ever
  // had a Cowork task is carrying.
  const terrain = makeTerrain(seed, { size: SIZE, polders: layout.polders });
  const lake = [];
  for (let r = 0; r < 6 && lake.length < 3; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = Math.round(terrain.lakeCentre[0] + terrain.half + dx);
        const gz = Math.round(terrain.lakeCentre[1] + terrain.half + dz);
        if (terrain.isWater(gx, gz) && !lake.some((c) => c[0] === gx && c[1] === gz)) lake.push([gx, gz]);
      }
    }
  }
  assert.ok(lake.length >= 3, 'this seed has a lake to put a bad pier on');
  layout.districts.quay.pier = lake.slice(0, 3);
  layout.districts.quay.shore = [lake[0][0], lake[0][1] + 1];
  delete layout.quayV;

  const before = structuredClone(layout.plots);
  placeAll(layout, village, { seed, size: SIZE });

  const sea = seaCells(terrain);
  for (const [gx, gz] of layout.districts.quay.pier) {
    assert.ok(sea.has(`${gx},${gz}`), 'the repaired pier stands over open sea');
  }
  for (const [id, p] of Object.entries(before)) {
    if (id.startsWith('house:cowork-')) continue;            // the quay's own, which may move
    const now = layout.plots[id];
    assert.ok(now, `${id} kept its plot`);
    assert.deepEqual([now.gx, now.gz, now.rot], [p.gx, p.gz, p.rot], `${id} did not move`);
  }

  // And once repaired it stays put: a scan of the same island never changes the layout.
  const settled = structuredClone(layout.plots);
  const pier = structuredClone(layout.districts.quay.pier);
  placeAll(layout, village, { seed, size: SIZE });
  assert.deepEqual(layout.plots, settled, 'a second pass moves nothing');
  assert.deepEqual(layout.districts.quay.pier, pier, 'a second pass leaves the planks alone');
});
