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

async function scanOnce(layoutFile = files.layout, out = files.village) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await scan({ quiet: true, persistLayout: true, layoutFile, out, cacheFile: files.cache });
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

// And the same village founded from nothing, which is the only way to see the router at
// all. A road is laid once and is then as sticky as a house, so on an island that already
// has its roads the weights in `routePath` are not consulted and could be anything - the
// measurement below would read the same after a change that broke them. This is the
// island as it would be laid out today: same seed, same size, same settlers, no history.
const fresh = path.join(work, 'fresh.json');
await scanOnce(fresh, path.join(work, 'fresh-village.json'));
const F = readJson(fresh);

test('the quay is one connected deck and every harbour house stands on it', () => {
  const quay = village.districts.find((d) => d.kind === 'quay');
  if (!quay) return;
  const cells = [...(quay.deck || []), ...(quay.pier || [])];
  assert.ok(cells.length, 'the quay has a deck');
  const all = new Set(cells.map((c) => `${c[0]},${c[1]}`));
  const seen = new Set(), q = [cells[0]];
  while (q.length) {
    const [x, z] = q.shift(), key = `${x},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = `${x + dx},${z + dz}`;
      if (all.has(n) && !seen.has(n)) q.push([x + dx, z + dz]);
    }
  }
  assert.equal(seen.size, all.size, 'the pier, streets and front decks touch');
  for (const b of village.buildings.filter((b) => b.harbour)) {
    assert.equal(b.plot.quay, true, `${b.id} is marked as standing over quay water`);
  }
});

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

// A path in one piece. A path records only the cells it paved itself - the stretch it
// shares with a road that was already there belongs to that road - so consecutive entries
// are not always neighbours. A gap is where the walk carried on over somebody else's
// stone, and it breaks the path into pieces rather than counting as a bend.
function pieces(cells) {
  const out = [];
  let cur = [cells[0]];
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1], b = cells[i];
    if (Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) === 1) cur.push(b);
    else { if (cur.length > 1) out.push(cur); cur = [b]; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

// How much a road bends, and - the part that took a second go to get right - how much
// room it had to bend in.
//
// Turns per cell of road is the obvious measure and it is not a measure of the router: a
// road that has to go twenty-five cells north and two cells east can hold four turns at
// the very most, whatever the weights are, because every further turn costs it a cell it
// does not need. So the number says as much about where the hamlets happened to land as
// about how the road was walked. Measured: the same village three settlers apart scored
// 0.111 and 0.165 turns per cell, and the second island's roads were the *straighter* of
// the two for their shape.
//
// `room` is therefore the most turns the piece could have had - two per cell of its
// shorter leg - and one turn is taken off both sides, because even a straight L has a
// corner in it. What is left is the turning the router chose rather than the turning its
// errand forced on it, and that is a property of the weights.
function roadShape(paths) {
  let cells = 0, turns = 0, room = 0, forced = 0, longest = 0;
  for (const p of paths) {
    cells += p.cells.length;
    for (const piece of pieces(p.cells)) {
      let run = 1, prev = null;
      for (let i = 1; i < piece.length; i++) {
        const d = `${piece[i][0] - piece[i - 1][0]},${piece[i][1] - piece[i - 1][1]}`;
        if (prev !== null && d !== prev) { turns++; longest = Math.max(longest, run); run = 1; } else run++;
        prev = d;
      }
      longest = Math.max(longest, run);
      const dx = Math.abs(piece[piece.length - 1][0] - piece[0][0]);
      const dz = Math.abs(piece[piece.length - 1][1] - piece[0][1]);
      room += Math.min(piece.length - 1, 2 * Math.min(dx, dz));
      forced += dx > 0 && dz > 0 ? 1 : 0;      // the corner of the L, which is not a choice
    }
  }
  const spare = Math.max(0, room - forced);
  return {
    cells, turns, room: spare, longest,
    perCell: cells ? turns / cells : 0,
    chosen: spare ? Math.max(0, turns - forced) / spare : 0,
  };
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

test('and can walk from that door to the town square', () => {
  // The test above asks whether a house has a way to its door. It cannot ask where that
  // way goes, and for a long time nothing did - which is how this island grew a polder
  // whose three houses each had a tidy front path onto a road that ran to the sea wall
  // and stopped. Every stone was in place and every local check passed; the only thing
  // wrong was that none of it joined the island.
  //
  // So: one flood fill over all the paving, out from the town square, and every door has
  // to be in it. Four-connected, because that is how `settlers.js` walks - a lane that
  // meets the next one only at a corner is not a route a settler can take.
  const open = new Set();
  const q = [];
  const push = (c) => { const k = key(c); if (!paved.has(k) || open.has(k)) return; open.add(k); q.push(c); };
  push(L.town.square);
  for (const c of (L.town.paved || [])) push(c);
  for (let h = 0; h < q.length; h++) {
    const [x, z] = q[h];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) push([x + dx, z + dz]);
  }
  assert.ok(open.size > 0, 'the town square has no paving on it at all');

  // A door counts as joined if the cell it opens onto is on the network, or if any cell
  // of the house's own front path is: a path is recorded from the doorstep outward, so
  // its far end is the one that meets the lane.
  const cut = houses.filter(([id, p]) => {
    const door = outsideDoor(p.gx, p.gz, p.rot);
    if (open.has(key(door))) return false;
    const own = L.paths.find((r) => r.id === `path:${id}`);
    return !(own && own.cells.some((c) => open.has(key(c))));
  });
  assert.deepEqual(cut.map(([id]) => id), [], 'houses that cannot walk to the town square');

  // And no orphaned paving - except a bridge standing with nothing built on either end yet,
  // which lib/layout.mjs's own comment on `layout.bridges` calls "a bridge in the
  // countryside, not a bug": bridges are sticky and laid ahead of the houses that will one
  // day reach them. So only paths and town paving are required to be in the reached set; a
  // stretch of road that lost its junction, or the original polder bug this test was built
  // to catch, still fails exactly as before. Bridges stay in `paved` and are still usable
  // as stepping stones by the flood fill above - it is only being unconnected in isolation
  // that stops counting as a fault.
  const required = new Set();
  for (const p of L.paths) for (const c of p.cells) required.add(key(c));
  for (const c of (L.town.paved || [])) required.add(key(c));
  const orphaned = [...required].filter((k) => !open.has(k));
  assert.deepEqual(orphaned, [], `${orphaned.length} paved cells are cut off from the square`);
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

// Of the turning a hamlet road had room for, how much of it was taken. Measured by
// scanning this same village onto eighteen islands - fourteen seeds, four of them at a
// second grid size as well - and reading the roads off each, once with the weights as
// they stand and once with a dear turn and no wander field:
//
//   as it is now                    0.167 .. 0.482   (mean 0.28, sd 0.09, n = 19*)
//   turns dear, no wander field     0.011 .. 0.118   (mean 0.06, sd 0.03, n = 18)
//                                                    (* the eighteen, plus the live island)
//
// The two do not overlap anywhere, so the threshold goes between them, a fifth clear of
// each. Turns per cell of road will not do the job: 0.107 .. 0.167 against 0.059 .. 0.098
// is a hair's breadth, and it is the measure the first version of this test used - which
// is why it went red on a village three settlers older than the one it was written on,
// reading 0.111 where the same code had read 0.165 a day before. Nor will the longest
// straight run: 14 to 54 cells with the field and 23 to 60 without it is the same spread
// twice over. For the record, the island before it had any front paths at all read 0.063
// turns per cell, and that is what all of this is measured against.
const BENDS = 0.14;

test('the roads bend where they have room to', (t) => {
  const roads = roadShape(F.paths.filter((p) => String(p.id).startsWith('road:')));
  const standing = roadShape(L.paths.filter((p) => String(p.id).startsWith('road:')));
  t.diagnostic(`laid fresh: ${roads.turns} turns in ${roads.cells} cells of hamlet road`
    + ` - ${roads.perCell.toFixed(3)} per cell, ${roads.chosen.toFixed(3)} of the ${roads.room}`
    + ` turns they had room for, longest straight run ${roads.longest}`);
  t.diagnostic(`as they stand: ${standing.perCell.toFixed(3)} per cell,`
    + ` ${standing.chosen.toFixed(3)} of the ${standing.room} they had room for`);
  if (!SETTLED) return;
  // A village whose roads all run straight up a compass point has nothing to measure:
  // there is no room to turn in, so nought out of nought is not a straight road.
  if (roads.room < 20) return;
  assert.ok(
    roads.chosen > BENDS,
    `the roads took ${roads.chosen.toFixed(3)} of the ${roads.room} turns they had room for:`
    + ` that is the straight-line router, not this one`,
  );
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

test('the postbox stands on the hall\'s pavement and never on its doorstep', () => {
  const box = L.plots['civic:mailbox'];
  const hall = L.plots['civic:townhall'];
  if (!box || !hall) return;                  // an island too young to have a hall yet
  assert.equal(box.w, 1, 'a postbox takes one cell');
  // The cell the door opens onto is where the front path starts. A box planted there
  // walls the hall in exactly the way a shed walls a house in, and nothing else on the
  // island would ever say so.
  const step = outsideDoor(hall.gx, hall.gz, hall.rot);
  assert.notEqual(key([box.gx, box.gz]), key(step), 'the postbox is standing on the doorstep');
  assert.ok(paved.has(key([box.gx, box.gz])), 'the postbox is standing on grass, not on the frontage');
  // Beside the hall rather than somewhere out on the square: on its own ring of paving.
  assert.ok(box.gx >= hall.gx - 1 && box.gx <= hall.gx + 3 && box.gz >= hall.gz - 1 && box.gz <= hall.gz + 3,
    'the postbox has wandered off the town hall frontage');
  for (const [id, p] of plots) {
    if (id === 'civic:mailbox' || p.w !== 1) continue;
    assert.notEqual(key([p.gx, p.gz]), key([box.gx, box.gz]), `${id} is standing in the postbox`);
  }
});

test.after(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* the tmp dir will go */ } });
