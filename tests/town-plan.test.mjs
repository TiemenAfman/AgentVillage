// The town's plan (Plans/knus-dorpscentrum.md): a ring of buildings round the square, four
// shopping streets leaving it, the workshops and a new castle out beyond them, and the gold
// pit behind the library.
//
// What is asserted is what the plan promises rather than where any one seed happens to put
// things: each building of the square on its own lot of the ring whenever that lot was free
// when the island was founded, the shops on the streets and facing them, the workshops past
// the last street lot, the streets paved but not where the Friday gathering goes - and the two
// things every layout change owes the island: no house moves as the town grows, and a scan of
// an unchanged island writes the same file. The migration of an island laid out before the plan
// is held to the same: the centre is laid out again and not one house or shed is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { emptyLayout, placeAll, loadLayout, outsideDoor, TOWN_PLAN, TOWN_VERSION } = await import('../lib/layout.mjs');
const { MILESTONES } = await import('../lib/village.mjs');
const { squareCells, gatherCells } = await import('../shared/roads.mjs');
const { makeTerrain } = await import('../shared/terrain.mjs');
const { superOf } = await import('../shared/lattice.mjs');

const SIZE = 128;
const SEEDS = [5, 2024, 1337];
const t0 = Date.UTC(2026, 0, 1);
const { RING, RING_OF, STREET_LOTS, OUTSKIRTS, GOLDPIT_LOT, TOWN_REACH } = TOWN_PLAN;
const TRADES = ['sawmill', 'smithy'];

function village(settlers, { school = true } = {}) {
  const buildings = [];
  for (let i = 0; i < settlers; i++) {
    buildings.push({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: 'p:demo', harbour: false, tier: 'hut', startedAt: t0 + i * 1000 });
  }
  return {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: settlers, firstSeenAt: t0 }],
    buildings,
    milestones: MILESTONES.map((m) => {
      const unlocked = m.on === 'apprentices' ? school : m.at <= settlers;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers },
  };
}

// The whole ladder of shops, earned: a hundred settlers and the school.
function grown(seed, settlers = 100) {
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, village(settlers), { seed, size: SIZE });
  return layout;
}

const rel = (layout, p) => [p.gx - layout.town.centre[0], p.gz - layout.town.centre[1]];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const plotAt = (layout, at) => Object.entries(layout.plots)
  .find(([id, p]) => id.startsWith('civic:') && p.w === 3 && same(rel(layout, p), at))?.[0] || null;
// The shops that go on a street, as opposed to the four on the corners of the ring.
const SHOPS = ['grocer', 'apothecary', 'tailor', 'wandmaker', 'butcher', 'sweetshop', 'owlpost', 'cauldron'];
const houses = (layout) => Object.fromEntries(Object.entries(layout.plots)
  .filter(([id]) => id.startsWith('house:') || id.startsWith('shed:')).map(([id, p]) => [id, JSON.stringify(p)]));

test('the plan is what the plan document draws', () => {
  // Eight lots in the ring, sixteen along the streets, none of them overlapping, none on the
  // square, and every one of them facing a cell outside itself.
  const cells = new Set();
  const lots = [...Object.values(RING), ...STREET_LOTS, GOLDPIT_LOT];
  assert.equal(Object.keys(RING).length, 8);
  assert.equal(STREET_LOTS.length, 16);
  for (const { at, look } of lots) {
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 3; x++) {
        const k = `${at[0] + x},${at[1] + z}`;
        assert.ok(!cells.has(k), `two lots share ${k}`);
        assert.ok(Math.abs(at[0] + x) > 3 || Math.abs(at[1] + z) > 3, `a lot reaches onto the square at ${k}`);
        cells.add(k);
      }
    }
    assert.ok(!(look[0] >= at[0] && look[0] < at[0] + 3 && look[1] >= at[1] && look[1] < at[1] + 3), 'a lot faces itself');
  }
  // Every building of the square has a lot of its own, and no two share one.
  assert.equal(new Set(Object.values(RING_OF)).size, Object.keys(RING_OF).length);
});

for (const seed of SEEDS) {
  test(`seed ${seed}: the square's buildings stand on the ring, facing as the plan has them`, () => {
    const layout = grown(seed);
    const c = layout.town.centre;
    const founded = new Set((layout.town.lots || []).map(([gx, gz]) => `${gx - c[0]},${gz - c[1]}`));
    let checked = 0;
    for (const [type, slot] of Object.entries(RING_OF)) {
      const lot = RING[slot];
      if (!founded.has(lot.at.join(','))) continue;           // not free when the island was founded
      const p = layout.plots[`civic:${type}`];
      assert.ok(p, `the ${type} was given ground`);
      assert.deepEqual(rel(layout, p), lot.at, `the ${type} stands on its own lot of the ring`);
      // Its door opens onto the side it was meant to face: the square, or its street.
      const door = outsideDoor(p.gx, p.gz, p.rot);
      const toLook = Math.abs(door[0] - (c[0] + lot.look[0])) + Math.abs(door[1] - (c[1] + lot.look[1]));
      const toSelf = Math.abs(p.gx + 1 - (c[0] + lot.look[0])) + Math.abs(p.gz + 1 - (c[1] + lot.look[1]));
      assert.ok(toLook < toSelf, `the ${type} faces away from where it should look`);
      checked++;
    }
    assert.ok(checked >= 5, `only ${checked} lots of the ring were free on this seed`);
  });

  test(`seed ${seed}: the shops stand on the streets, facing them, and fill them from the square out`, () => {
    const layout = grown(seed);
    const onStreet = new Map(STREET_LOTS.map((l, n) => [l.at.join(','), n]));
    const streetCells = new Set((layout.town.streets || []).map((k) => k.join(',')));
    const paved = new Set((layout.town.paved || []).map((k) => k.join(',')));
    const taken = [];
    for (const type of SHOPS) {
      const p = layout.plots[`civic:${type}`];
      assert.ok(p, `the ${type} was given ground`);
      const n = onStreet.get(rel(layout, p).join(','));
      if (n === undefined) continue;                          // every street lot was taken or unbuildable
      taken.push(n);
      const door = outsideDoor(p.gx, p.gz, p.rot).join(',');
      assert.ok(paved.has(door), `the ${type}'s door does not open onto the paving`);
      assert.ok(streetCells.has(door) || !streetCells.size, `the ${type}'s door opens onto the square rather than its street`);
      assert.ok(!Object.values(RING).some((r) => same(r.at, rel(layout, p))), `the ${type} took a lot of the ring`);
    }
    // A shop stands off the streets only when no street lot could take it: every street lot
    // left empty is ground that cannot be built on, is under something, or is a hamlet's.
    if (taken.length < SHOPS.length) {
      const terrain = makeTerrain(seed, { size: SIZE, polders: layout.polders || [], fairway: layout.fairway || null, grow: layout.grow || null });
      const c = layout.town.centre;
      const under = new Set();
      for (const p of Object.values(layout.plots)) for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) under.add(`${p.gx + x},${p.gz + z}`);
      for (const q of layout.paths) for (const k of q.cells) under.add(k.join(','));
      const hamlet = new Set(Object.values(layout.districts).flatMap((d) => d.lobes || []).flatMap((l) => l.cells).map((k) => k.join(',')));
      for (const lot of STREET_LOTS) {
        if (plotAt(layout, lot.at)) continue;
        let open = true;
        for (let z = 0; z < 3 && open; z++) {
          for (let x = 0; x < 3 && open; x++) {
            const gx = c[0] + lot.at[0] + x, gz = c[1] + lot.at[1] + z;
            open = terrain.isBuildable(gx, gz) && !under.has(`${gx},${gz}`) && !hamlet.has(superOf(layout.lattice, gx, gz).join(','));
          }
        }
        assert.ok(!open, `the street lot at ${lot.at} stands empty and buildable while a shop stands off the streets`);
      }
    }
    // The school and the water tower take the far end, never the first lot of a street.
    for (const type of OUTSKIRTS) {
      const p = layout.plots[`civic:${type}`];
      const n = p ? onStreet.get(rel(layout, p).join(',')) : undefined;
      if (n !== undefined) assert.ok(n >= 8, `the ${type} took a lot next to the square`);
    }
  });

  test(`seed ${seed}: the workshops and a new castle stand out beyond the streets`, () => {
    const layout = grown(seed);
    const c = layout.town.centre;
    for (const type of TRADES) {
      const p = layout.plots[`civic:${type}`];
      assert.ok(p, `the ${type} was given ground`);
      const near = Math.max(Math.abs(p.gx + 1 - c[0]), Math.abs(p.gz + 1 - c[1]));
      assert.ok(near > 12, `the ${type} stands ${near} cells from the centre, inside the streets`);
    }
    const castle = layout.plots['civic:castle'];
    assert.ok(castle, 'the castle was given ground');
    const inPlan = castle.gx <= c[0] + TOWN_REACH && castle.gx + castle.w - 1 >= c[0] - TOWN_REACH
      && castle.gz <= c[1] + TOWN_REACH && castle.gz + castle.d - 1 >= c[1] - TOWN_REACH;
    assert.ok(!inPlan, 'the castle is wedged into the town plan');
  });

  test(`seed ${seed}: the streets are paving, off every plot, and not where the Friday gathering goes`, () => {
    const layout = grown(seed);
    const streets = layout.town.streets || [];
    assert.ok(streets.length > 0, 'no street was paved');
    const paved = new Set(layout.town.paved.map((k) => k.join(',')));
    const under = new Set();
    for (const p of Object.values(layout.plots)) for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) under.add(`${p.gx + x},${p.gz + z}`);
    for (const k of streets) {
      assert.ok(paved.has(k.join(',')), 'a street cell is not in the paving');
      assert.ok(!under.has(k.join(',')), 'a street runs under a building');
    }
    const village = { island: { town: layout.town }, districts: [] };
    const gather = new Set(gatherCells(village).map((k) => k.join(',')));
    assert.equal(squareCells(village).length, layout.town.paved.length);
    for (const k of streets) assert.ok(!gather.has(k.join(',')), 'the gathering is sent into a street');
    assert.ok(gather.size > 0, 'the gathering has nowhere to go');
  });
}

test('a young island grows into its plan: no house moves, and an unchanged scan writes the same file', () => {
  const seed = 2024;
  const layout = emptyLayout(seed, SIZE);
  let before = null;
  let model = null;
  for (const n of [12, 25, 40, 70, 100]) {
    model = village(n, { school: n >= 60 });
    placeAll(layout, model, { seed, size: SIZE });
    const now = houses(layout);
    if (before) {
      const moved = Object.keys(before).filter((id) => now[id] && now[id] !== before[id]);
      assert.deepEqual(moved, [], `houses moved on the way to ${n} settlers`);
    }
    before = now;
  }
  const once = JSON.stringify(layout);
  placeAll(layout, model, { seed, size: SIZE });
  assert.equal(JSON.stringify(layout), once, 'the second scan rewrote the layout');
});

test('an island laid out before the plan: the centre is laid out again, and no house or shed moves', () => {
  const seed = 5;
  const model = village(100);
  const layout = grown(seed);
  const c = layout.town.centre;
  // The old centre, as far as it matters here: no town version, the sawmill pressed against the
  // ring on the nearest free block and the market off its lot, the way the keeper left it.
  delete layout.townV;
  const moveTo = (id, at) => { layout.plots[id] = { ...layout.plots[id], gx: c[0] + at[0], gz: c[1] + at[1] }; };
  const freeNear = [[9, -9], [9, 9], [-9, 9], [13, 13]].find((at) =>
    !Object.values(layout.plots).some((p) => Math.abs(p.gx - (c[0] + at[0])) < 3 && Math.abs(p.gz - (c[1] + at[1])) < 3));
  moveTo('civic:sawmill', freeNear);
  const kept = houses(layout);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-town-')), 'layout.json');
  fs.writeFileSync(file, JSON.stringify(layout));

  const loaded = loadLayout(file, seed, SIZE);
  assert.equal(loaded.townV, TOWN_VERSION);
  assert.equal(loaded.plots['civic:sawmill'], undefined, 'the sawmill was not lifted');
  assert.equal(loaded.plots['civic:townhall'], undefined, 'the hall was not lifted');
  assert.ok(loaded.plots['civic:castle'], 'the castle was lifted with the centre');
  assert.deepEqual(loaded.paths, [], 'the roads were not taken up to be routed round the streets');

  placeAll(loaded, model, { seed, size: SIZE });
  assert.deepEqual(houses(loaded), kept, 'a house or a shed moved');
  const saw = loaded.plots['civic:sawmill'];
  assert.ok(Math.max(Math.abs(saw.gx + 1 - c[0]), Math.abs(saw.gz + 1 - c[1])) > 12, 'the sawmill is still in town');
  assert.equal(plotAt(loaded, RING.N.at), 'civic:townhall', 'the hall is not back on its lot');
  const once = JSON.stringify(loaded);
  placeAll(loaded, model, { seed, size: SIZE });
  assert.equal(JSON.stringify(loaded), once, 'the scan after the migration rewrote the layout');
});
