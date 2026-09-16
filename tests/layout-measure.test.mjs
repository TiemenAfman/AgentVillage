// The layout, measured. lib/layout.mjs decides where every building on the island
// stands and it had no test of its own: the only thing that ever checked it was somebody
// walking the island afterwards and noticing. That is how this island shipped for
// several releases with nought front paths - every house standing on grass, and nothing
// anywhere that would say so.
//
// So this is the net, and it is a measurement rather than a set of expected numbers. The
// village is grown from whatever transcripts are on the machine, so the counts are
// different on every one; what has to hold is the *properties*. Every house can be
// reached from its own door. Two plots never share a cell unless one is the other's shed.
// The village is spread over the island rather than heaped on one ring. A road is a road
// and not a kilometre of one. And scanning the same island twice does not change it,
// which is the rule the whole file is built on and the easiest one to break.
//
// It runs the real scanner over a copy in a scratch directory, so the island's own
// data/layout.json is never touched. The one thing it does write inside data/ is
// data/scan.lock, for as long as the scan takes: that lock is how two scanners keep out
// of each other's way and there is no way to ask for it somewhere else. If the island's
// own server happens to be scanning at that moment the lock is held, the scan comes back
// skipped, and we wait and ask again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../scan.mjs';
import { DATA, readJson, loadConfig } from '../lib/paths.mjs';
import { outsideDoor, TOWN_CORE_R } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-layout-'));
const files = {
  layout: path.join(work, 'layout.json'),
  village: path.join(work, 'village.json'),
  cache: path.join(work, 'cache.json'),
};
// Start from the island as it stands, so the measurement is of the real village and of
// the migration it is about to go through - not of a fresh founding nobody will ever see.
for (const [from, to] of [['layout.json', files.layout], ['cache.json', files.cache]]) {
  try { fs.copyFileSync(path.join(DATA, from), to); } catch { /* a checkout with no island yet */ }
}

async function scanOnce() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await scan({
      quiet: true, persistLayout: true,
      layoutFile: files.layout, out: files.village, cacheFile: files.cache,
    });
    if (!r || !r.skipped) return r;
    await new Promise((done) => setTimeout(done, 400));
  }
  throw new Error('the island was scanning throughout; could not take the scan lock');
}

const first = await scanOnce();
const layout1 = readJson(files.layout);
const village = readJson(files.village);
const second = await scanOnce();
const layout2 = readJson(files.layout);

const config = loadConfig();
const terrain = makeTerrain(config.seed, { size: layout2.size, polders: layout2.polders || [] });
const L = layout2;
const key = (c) => `${c[0]},${c[1]}`;
const plots = Object.entries(L.plots);
const houses = plots.filter(([id]) => id.startsWith('house:'));
const civicLots = plots.filter(([id, p]) => id.startsWith('civic:') && p.w === 3);

// Everything a door may open onto: road, the paving of the square and its frontage, and
// the deck of a bridge. Read off the layout rather than off the cell grid, which is not
// written down anywhere the viewer or a test can see.
const paved = new Set();
for (const p of L.paths) for (const c of p.cells) paved.add(key(c));
for (const c of (L.town.paved || [])) paved.add(key(c));
for (const b of (L.bridges || [])) for (const c of b.cells) paved.add(key(c));

const bbox = (cells) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of cells) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return { w: x1 - x0 + 1, h: z1 - z0 + 1 };
};

// How often a road changes direction, per cell of road. A path records only the cells it
// paved itself - the stretch it shares with a road that was already there belongs to that
// road - so consecutive entries are not always neighbours, and a gap is where the walk
// carried on over somebody else's stone. It starts a new run rather than counting as a
// bend.
function bends(paths) {
  let cells = 0, turns = 0, longest = 0;
  for (const p of paths) {
    cells += p.cells.length;
    let run = 1, prev = null;
    for (let i = 1; i < p.cells.length; i++) {
      const a = p.cells[i - 1], b = p.cells[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      if (Math.abs(dx) + Math.abs(dz) !== 1) { prev = null; run = 1; continue; }
      const d = `${dx},${dz}`;
      if (prev !== null && d !== prev) { turns++; longest = Math.max(longest, run); run = 1; } else run++;
      prev = d;
    }
    longest = Math.max(longest, run);
  }
  return { cells, turns, per: cells ? turns / cells : 0, longest };
}

// Enough of a village to measure. On a machine with no transcripts on it the island is
// one settler and a town square, and "the village fills the island" means nothing - so
// those checks say so and stand aside rather than failing.
const SETTLED = houses.length >= 12;

test('a second scan of the same island changes nothing', () => {
  for (const part of ['plots', 'town', 'paths', 'districts', 'bridges', 'cleared', 'lattice', 'polders']) {
    assert.deepEqual(layout2[part], layout1[part], `${part} was rewritten by the second scan`);
  }
  // And the file itself, which catches a version number that is written but never set -
  // the reason a freshly founded island used to be rewritten once on its second scan.
  assert.equal(fs.readFileSync(files.layout, 'utf8'), JSON.stringify(layout1), 'layout.json was rewritten');
});

test('nothing stands inside anything else, bar a shed in its own master\'s yard', () => {
  const claims = new Map();
  for (const [id, p] of plots) {
    for (let z = 0; z < p.d; z++) {
      for (let x = 0; x < p.w; x++) {
        const k = `${p.gx + x},${p.gz + z}`;
        if (!claims.has(k)) claims.set(k, []);
        claims.get(k).push(id);
      }
    }
  }
  const shedOf = L.shedOf || {};
  for (const [cell, ids] of claims) {
    if (ids.length < 2) continue;
    assert.equal(ids.length, 2, `${ids.length} plots on ${cell}: ${ids.join(', ')}`);
    const shed = ids.find((id) => id.startsWith('shed:'));
    const other = ids.find((id) => id !== shed);
    assert.ok(shed, `two plots on ${cell} and neither is a shed: ${ids.join(', ')}`);
    assert.equal(shedOf[shed], other, `${shed} stands on ${other}, which is not its master`);
  }
});

test('every house can be reached from its own front door', () => {
  const stranded = houses.filter(([id, p]) => {
    const door = outsideDoor(p.gx, p.gz, p.rot);
    return !paved.has(key(door)) && !L.paths.some((q) => q.id === `path:${id}`);
  });
  assert.deepEqual(stranded.map(([id]) => id), [], 'houses with no way to their door');
  // A shed on the doorstep is the other way to wall a house in: the path is still laid,
  // from behind the shed, so the check above would pass and the door would not open.
  const shedOf = L.shedOf || {};
  for (const [id, p] of plots) {
    if (!id.startsWith('shed:')) continue;
    const master = L.plots[shedOf[id]];
    if (!master) continue;
    const door = outsideDoor(master.gx, master.gz, master.rot);
    assert.ok(p.gx !== door[0] || p.gz !== door[1], `${id} is standing on the doorstep of ${shedOf[id]}`);
  }
});

test('every civic lot keeps its road', () => {
  // One road per three-by-three civic lot, no more and no fewer. A bump of
  // PARCEL_VERSION empties `paths`, and a civic building is not placed again afterwards -
  // so without the block that relays these, the roads to the town hall, the market, the
  // tavern and the school go and never come back.
  const roads = L.paths.filter((p) => String(p.id).startsWith('path:civic:'));
  assert.equal(roads.length, civicLots.length, 'a civic lot has no road, or has two');
  for (const [id] of civicLots) {
    assert.ok(L.paths.some((p) => p.id === `path:${id}`), `${id} has no road`);
  }
});

test('the village is spread over the island, and nobody is a guest', () => {
  assert.equal(first.unplaced, 0, 'something could not be placed');
  assert.equal(second.unplaced, 0, 'something could not be placed on the second scan');
  for (const d of village.districts) assert.equal(d.guest, false, `${d.id} is lodging on the commons`);

  const rings = [];
  for (const rec of Object.values(L.districts)) {
    for (const lobe of rec.lobes || []) rings.push(Math.max(Math.abs(lobe.seed[0]), Math.abs(lobe.seed[1])));
  }
  if (!SETTLED) return;
  // Past the town's own core, and not all on one ring. Both halves matter: the ladder in
  // `pickSeed` is what pushes a hamlet out past the centre, and the sector term is what
  // stops them all queueing up on the same ring once they are out there.
  for (const r of rings) assert.ok(r > TOWN_CORE_R, `a hamlet is seeded on ring ${r}, inside the town core`);
  assert.ok(Math.max(...rings) >= TOWN_CORE_R + 4, `the furthest hamlet is only on ring ${Math.max(...rings)}`);
  assert.ok(new Set(rings).size > 1, `all ${rings.length} hamlets are on ring ${rings[0]}`);
});

test('a road is a road and not a kilometre of one', () => {
  for (const p of L.paths.filter((q) => String(q.id).startsWith('road:'))) {
    assert.ok(p.cells.length < 60, `${p.id} is ${p.cells.length} cells long`);
  }
});

test('how much of the island the village reaches', (t) => {
  const land = bbox(terrain.landCells);
  const built = bbox(houses.map(([, p]) => [p.gx + 1, p.gz + 1]));
  const fill = (built.w * built.h) / (land.w * land.h);
  // Reported rather than asserted, on purpose. How much of the island the village covers
  // is mostly a question about the island: nine hamlets spread as far as the ladder can
  // push them cover two-fifths of a 128-cell island and a ninth of a 256-cell one, and
  // neither number says anything about this file. What layout.mjs does control is the
  // spread of the hamlet seeds, and that is asserted above. So this is a measurement,
  // printed on every run, for whoever is deciding how big the island should be.
  t.diagnostic(`houses ${built.w}x${built.h} on land ${land.w}x${land.h}`
    + ` - ${(fill * 100).toFixed(0)}% of the island's box, ${houses.length} houses`);
});

test('the roads bend', () => {
  if (!SETTLED) return;
  const all = bends(L.paths);
  assert.ok(all.per > 0.12, `${all.per.toFixed(3)} bends per cell of road: the roads are straight`);
  assert.ok(all.longest < 30, `a straight run of ${all.longest} cells`);
});

test('the ground under the village is the ground the forest keeps off', () => {
  // `cleared` is exactly the union of what is built and what is paved. It is stored
  // rather than derived because the trees never grow back over it, so a scan that forgot
  // a piece would let the forest close over a road - which is what happened to the
  // bridges once, and to every old hamlet road on the scan that re-routed them.
  const want = new Set();
  for (const [, p] of plots) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) want.add(`${p.gx + x},${p.gz + z}`);
  }
  for (const p of L.paths) for (const c of p.cells) want.add(key(c));
  for (const b of (L.bridges || [])) for (const c of b.cells) want.add(key(c));
  const have = new Set(L.cleared.map(key));
  for (const k of want) assert.ok(have.has(k), `${k} is built on or paved but the forest may grow over it`);
});

test.after(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* the tmp dir will go */ } });
