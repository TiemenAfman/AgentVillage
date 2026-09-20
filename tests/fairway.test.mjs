// The dredged river mouth, and the hull that is allowed to scrape.
//
// Two changes with one promise between them: you can take a boat up your own river. Each
// half is worth very little alone - a forgiving hull still cannot cross a bar, and an open
// bar still puts fifty-six bends between you and the town - so the test that matters is
// the one at the bottom, which sails the whole thing with the same pure `stepBoat` the
// browser runs and the same terrain the scanner plans on.
//
// The rest of the file is the two invariants that pay for it:
//
//   An island that has never dredged is bit-for-bit the island it was. `layout.json` is
//   append-only and a changed terrain hash throws the whole town away (lib/layout.mjs:
//   `resetForNewTerrain`), so a `makeTerrain` that reacted at all to the new argument
//   being absent would move every house on every machine on the next scan.
//
//   The dredger never touches anything anybody built. It plans against a layout that
//   already has houses on it, and the one outcome worth ruling out absolutely is a scan
//   that drops somebody's front garden into the sea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeTerrain, CHANNEL_H, BEACH_MAX } from '../shared/terrain.mjs';
import { planFairway, emptyLayout } from '../lib/layout.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
register('./support/shared-loader.mjs', import.meta.url);

// boat.js reaches buildings.js for the hull, and buildings.js asks for its texture sheets
// the moment it loads. The same stub tests/boat.test.mjs uses, for the same reason.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { stepBoat, BOAT_FLOAT, BOAT_SCRAPE } = await import('../web/js/boat.js');
delete globalThis.document;

const SIZE = 256;
// Promptholm's own seed first, because it is the island this was measured on and the one
// somebody will be looking at when it breaks. 7 has two rivers, so it also covers the
// choice between them; 3 is a third coast.
const SEEDS = [1337, 7, 3];
const DT = 1 / 60;
const bare = (seed) => emptyLayout(seed, SIZE);
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

test('an island nobody has dredged is the island it always was', () => {
  for (const seed of [...SEEDS, 90210]) {
    const plain = makeTerrain(seed, { size: SIZE });
    for (const [what, opt] of [
      ['no argument at all', {}],
      ['an explicit null', { fairway: null }],
      ['a channel with nothing in it', { fairway: { line: [], cells: [] } }],
    ]) {
      const t = makeTerrain(seed, { size: SIZE, ...opt });
      assert.equal(t.hash, plain.hash, `seed ${seed} changed shape with ${what}`);
    }
  }
});

test('dredging only ever lowers ground, and only inside the channel', () => {
  const seed = 1337;
  const before = makeTerrain(seed, { size: SIZE });
  const dug = planFairway(before, bare(seed));
  assert.ok(dug && dug.cells.length, 'Promptholm was left with no channel to test');
  const after = makeTerrain(seed, { size: SIZE, fairway: dug });
  assert.notEqual(after.hash, before.hash, 'the dredger moved nothing at all');

  const inChannel = new Set(dug.cells.map((c) => `${c[0]},${c[1]}`));
  let lowered = 0;
  for (let gz = 0; gz < SIZE; gz++) {
    for (let gx = 0; gx < SIZE; gx++) {
      const b = before.heightAt(gx, gz), a = after.heightAt(gx, gz);
      if (a === b) continue;
      assert.ok(a < b, `the dredger raised ${gx},${gz}`);
      lowered++;
      // A cell is four corners shared with its neighbours, so digging one cell moves the
      // *corner* heights of the ring around it and `heightAt` averages four of them. The
      // ring is the sides of the channel and is expected; two cells out is not.
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) {
        for (let dx = -1; dx <= 1; dx++) if (inChannel.has(`${gx + dx},${gz + dz}`)) { near = true; break; }
      }
      assert.ok(near, `${gx},${gz} moved and is not in or beside the channel`);
    }
  }
  assert.ok(lowered > 20, `only ${lowered} cells moved, which is not a channel`);

  // And the bottom really is at the channel's own depth, so the estuary has no step in it
  // where the dredger stopped and the river's bed begins.
  for (const [gx, gz] of dug.cells) {
    assert.ok(after.heightAt(gx, gz) <= CHANNEL_H + 1e-9, `${gx},${gz} is still above the dredged depth`);
  }
});

test('the dredger refuses ground anybody built on', () => {
  const seed = 1337;
  const terrain = makeTerrain(seed, { size: SIZE });
  const open = planFairway(terrain, bare(seed));
  assert.ok(open && open.line.length > 4, 'no channel to obstruct');

  // Put a house across the middle of the channel it would otherwise dig, and a path over
  // the cell beside it. Both are as sticky as anything in layout.json, so the only right
  // answer is to dig round them or stop.
  const blocked = bare(seed);
  const [hx, hz] = open.line[Math.floor(open.line.length / 2)];
  blocked.plots['house:test'] = { gx: hx, gz: hz, w: 1, d: 1, rot: 0 };
  const [px, pz] = open.line[Math.floor(open.line.length / 2) + 1];
  blocked.paths.push({ id: 'path:test', cells: [[px, pz]] });

  const dug = planFairway(terrain, blocked);
  const cells = new Set((dug ? dug.cells : []).map((c) => `${c[0]},${c[1]}`));
  assert.ok(!cells.has(`${hx},${hz}`), 'the dredger dug out a house');
  assert.ok(!cells.has(`${px},${pz}`), 'the dredger dug out a road');
});

test('planning the same island twice digs the same channel', () => {
  for (const seed of SEEDS) {
    const terrain = makeTerrain(seed, { size: SIZE });
    const a = planFairway(terrain, bare(seed));
    const b = planFairway(terrain, bare(seed));
    assert.deepEqual(b, a, `seed ${seed} dredges differently on a second look`);
  }
});

// ---- the hull ------------------------------------------------------------------------
// A flat world at a given height, so the two thresholds can be walked up to one at a time.
const flat = (h) => () => h;

test('a shoal is a bump and a bank is a wall', () => {
  const ahead = { throttle: 1, turn: 0 };
  // Open water: it moves, and it is neither aground nor scraping.
  const sea = { x: 0, z: 0, yaw: 0, v: 5 };
  stepBoat(sea, ahead, DT, flat(BOAT_FLOAT - 0.01));
  assert.ok(sea.z > 0 && !sea.aground && !sea.scraping, 'a hull stopped in water it floats in');

  // A shoal: it keeps way for the moment, and says what is happening.
  const shoal = { x: 0, z: 0, yaw: 0, v: 5 };
  stepBoat(shoal, ahead, DT, flat((BOAT_FLOAT + BOAT_SCRAPE) / 2));
  assert.ok(shoal.scraping, 'the bow found a shoal and nothing said so');
  assert.ok(shoal.v > 0, 'a shoal stopped the hull dead on the first frame');
  assert.ok(shoal.v < 5, 'a shoal cost the hull nothing');

  // Land: dead stop, way thrown away, exactly as it always was.
  const shore = { x: 0, z: 0, yaw: 0, v: 5 };
  stepBoat(shore, ahead, DT, flat(BOAT_SCRAPE + 0.01));
  assert.equal(shore.v, 0, 'land did not stop the hull');
  assert.ok(shore.aground && !shore.scraping, 'running onto land did not read as aground');
  assert.equal(shore.z, 0, 'the hull moved onto land');
});

test('leaning on a shoal at full throttle still ends in a stop', () => {
  // The load-bearing half of SCRAPE_DRAG. If the throttle can hold a hull against sand it
  // can hold it against every beach on the island, and a boat that grinds along a
  // shoreline at a walking pace is the magnetised hull web/js/boat.js refuses to be - and
  // tests/circumnavigate.test.mjs would stop being able to find the bar off the quay.
  const b = { x: 0, z: 0, yaw: 0, v: 9.5 };
  let t = 0;
  for (let i = 0; i < 60 * 5 && !b.aground; i++) { stepBoat(b, { throttle: 1, turn: 0 }, DT, flat(0.2)); t += DT; }
  assert.ok(b.aground, 'full ahead into a shoal is a speed you can keep');
  assert.ok(t < 1, `it took ${t.toFixed(2)}s to stop, which is a slide and not a grounding`);
});

// ---- the whole promise ---------------------------------------------------------------
// Sailed rather than reasoned about, the way tests/circumnavigate.test.mjs sails the coast:
// a helm that only ever pushes ahead, aiming a fixed distance along the river, at a fixed
// 60 Hz. What it does on a grounding is what a person does - back off, turn, try again.
// `start` is where the boat is put and which way it is pointed, and it is the caller's so
// that the same water can be sailed on an island with a channel and on the same island
// without one. Handing each run its own start is how the first version of this test
// managed to prove nothing: with no channel to follow it began at the mouth, which is on
// the wrong side of the bar the whole argument is about.
function sailUp(terrain, cells, start) {
  const up = terrain.rivers.reduce((a, b) => (b.length > a.length ? b : a))
    .map((c) => terrain.cellWorld(...c)).reverse();
  const h = (x, z) => terrain.worldHeight(x, z);
  const b = { x: start[0], z: start[1], yaw: start[2], v: 0, aground: false };
  let idx = 0, stops = 0, backing = 0, turn = 0, bias = 1, wasAground = false;
  for (let i = 0; i < 60 * 400; i++) {
    while (idx < up.length - 1 && Math.hypot(up[idx][0] - b.x, up[idx][1] - b.z) < 3) idx++;
    if (idx >= cells) return { in: true, stops, seconds: i * DT };
    if (i % 12 === 0 && backing <= 0) {
      const err = norm(Math.atan2(up[idx][0] - b.x, up[idx][1] - b.z) - b.yaw);
      turn = Math.abs(err) < 0.12 ? 0 : Math.sign(-err);
    }
    let throttle = 1;
    // A fresh grounding: astern for three quarters of a second, helm over, and the other
    // way next time - which is what stops a dumb helm driving into the same bank for ever.
    if (b.aground && !wasAground) { stops++; backing = 45; bias = -bias; }
    wasAground = b.aground;
    if (backing > 0) { throttle = -1; turn = bias; backing--; }
    stepBoat(b, { throttle, turn }, DT, h);
    if (stops > 25) return { in: false, stops, at: [b.x, b.z], reached: idx };
  }
  return { in: false, stops, at: [b.x, b.z], reached: idx, timeout: true };
}

// The seaward end of the channel, pointed up it: open water on either island, because the
// dredger only ever digs and the cut ends where the water was already deep enough.
function offTheEntrance(terrain, dug) {
  const [ax, az] = terrain.cellWorld(dug.line[0][0], dug.line[0][1]);
  const [bx, bz] = terrain.cellWorld(dug.line[1][0], dug.line[1][1]);
  const yaw = Math.atan2(bx - ax, bz - az);
  // A few boat-lengths further out still, so the run includes finding the entrance and not
  // only passing through one it is already sitting in.
  return [ax - Math.sin(yaw) * 8, az - Math.cos(yaw) * 8, yaw];
}

test('the bar off Promptholm shuts the river, and the dredging opens it', () => {
  const seed = 1337;
  const silted = makeTerrain(seed, { size: SIZE });
  const dug = planFairway(silted, bare(seed));
  assert.ok(dug && dug.cells.length, 'Promptholm was left with no channel to test');
  const start = offTheEntrance(silted, dug);

  const shut = sailUp(silted, 20, start);
  assert.equal(shut.in, false, 'the river was already open, so this test proves nothing');

  const open = makeTerrain(seed, { size: SIZE, fairway: dug });
  // The whole river, not the first stretch of it: the point of the channel is the journey
  // behind it, and an entrance that only lets you two cells in is the bar again.
  const course = open.rivers.reduce((a, b) => (b.length > a.length ? b : a));
  const run = sailUp(open, course.length - 1, start);
  assert.ok(run.in, `still cannot get up the river: ${JSON.stringify(run)}`);
});

test('every dredged island can be sailed into', () => {
  for (const seed of SEEDS) {
    const silted = makeTerrain(seed, { size: SIZE });
    const dug = planFairway(silted, bare(seed));
    if (!dug || !dug.cells.length) continue;      // a river that ends inland: nothing to open
    const open = makeTerrain(seed, { size: SIZE, fairway: dug });
    const run = sailUp(open, 20, offTheEntrance(open, dug));
    assert.ok(run.in, `seed ${seed} has a channel nobody can sail: ${JSON.stringify(run)}`);
    // And the channel is marked-able: the beacons stand along the centreline, so a
    // centreline of one cell is a channel with nothing to steer by.
    assert.ok(dug.line.length >= 4, `seed ${seed} dredged a channel too short to buoy`);
  }
});

test('a river that ends inland is left alone rather than cut to the sea', () => {
  // 90210's river stops in water that cannot reach the edge of the map, and every bearing
  // out of it crosses ground above BEACH_MAX. Digging anyway would be a canal through the
  // island, which is a much larger idea than opening a river mouth - so the dredger says
  // no, and `placeAll` writes an empty channel down so it never asks again.
  const terrain = makeTerrain(90210, { size: SIZE });
  assert.ok(terrain.rivers.length, 'seed 90210 no longer has a river to make the point');
  assert.equal(planFairway(terrain, bare(90210)), null);
});

test('a dredged island can still be handed to a neighbour', () => {
  // The failure this is a net under is silent and total: `parseBundle` rebuilds the ground
  // from what arrived and refuses the whole island when its hash does not match the one it
  // was told. Leave the channel out of the bundle and every neighbour rejects a dredged
  // island with a message about the two machines running different code - which is exactly
  // what it looks like from the other end, and nowhere near where the mistake is.
  const seed = 1337, size = 256;
  const silted = makeTerrain(seed, { size });
  const dug = planFairway(silted, bare(seed));
  const terrain = makeTerrain(seed, { size, fairway: dug });
  const village = {
    v: 1,
    generatedAt: '2026-09-20T10:00:00.000Z',
    island: {
      name: 'Promptholm', seed, foundedAt: '2026-09-16T10:22:44.431Z', terrainHash: terrain.hash,
      landing: [199, 156],
      town: { square: [126, 126], centre: [128, 128], lots: [], paved: [], size: 5, parcel: null, coreR: 2, sizeSteps: [] },
      lattice: { anchor: [127, 127], pitch: 4 },
    },
    grid: { size },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
    fairway: { ...dug, at: 25, unlockedAt: '2026-09-10T14:20:06.485Z' },
    milestones: [], active: [], assignments: [], stats: {},
  };
  const config = { islandName: 'Promptholm', seed, port: 4747, gridSize: size };
  const packed = buildBundle({ config, village, id: 'abcdef0123456789', keeper: 'Tiemen' });
  assert.equal(packed.fairway.cells.length, dug.cells.length, 'the channel did not get on the boat');
  assert.deepEqual(packed.fairway.line, dug.line, 'the centreline did not travel, so nothing would be buoyed');
  // The date stays home: nothing the host draws needs it, and the whitelist is the reason.
  assert.equal(packed.fairway.unlockedAt, undefined);
  // This throws if the host's own terrain does not come out at the same hash.
  const landed = parseBundle(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(landed, packed, 'a dredged island is not its own fixed point');
});

test('the channel is never cut through anything the island calls land', () => {
  for (const seed of SEEDS) {
    const terrain = makeTerrain(seed, { size: SIZE });
    const dug = planFairway(terrain, bare(seed));
    if (!dug) continue;
    for (const [gx, gz] of dug.cells) {
      assert.ok(terrain.heightAt(gx, gz) < BEACH_MAX, `seed ${seed} dug through land at ${gx},${gz}`);
    }
  }
});
