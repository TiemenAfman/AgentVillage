// A polder drained by hand, measured against the ladder's own rules. The hash is the thing:
// it has to be the coast *with* the new land, recorded by the op itself, or the next
// `placeAll` reads a reseeding and the town goes (tests/polder-hash.test.mjs is the long
// version). Then the land has to be land - walled, pooled, causewayed, joined to the
// square - and nothing that stood may have moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, polderCandidate, touchesShore, poldersWanted, POLDER_AT } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { blockOf } from '../shared/lattice.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { village, clone, key, stands, movedBetween } from './support/village.mjs';
import { reachableFromSquare } from '../shared/roads.mjs';

const SEED = 1337, SIZE = 128;
const opts = { seed: SEED, size: SIZE };
const groundOf = (l) => makeTerrain(SEED, { size: SIZE, polders: l.polders, fairway: l.fairway }).hash;

function settled(settlers = 36) {
  const model = village(settlers);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout };
}

// A shore-touching blob of `n` candidate super-cells, grown four-connected from the first
// candidate found walking out from the centre.
function blob(layout, n) {
  const t = makeTerrain(SEED, { size: SIZE, polders: layout.polders, fairway: layout.fairway });
  const lat = layout.lattice;
  const keep = new Set(((layout.fairway || {}).cells || []).map(key));
  const cand = (i, j) => polderCandidate(t, lat, i, j, keep);
  let seed = null;
  for (let r = 1; r < 16 && !seed; r++) {
    for (let dj = -r; dj <= r && !seed; dj++) for (let di = -r; di <= r && !seed; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (cand(di, dj) && touchesShore(t, lat, di, dj)) seed = [di, dj];
    }
  }
  if (!seed) return null;
  const out = [seed], own = new Set([key(seed)]);
  while (out.length < n) {
    let grew = false;
    for (const [i, j] of [...out]) {
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = [i + a, j + b];
        if (own.has(key(c)) || !cand(c[0], c[1])) continue;
        out.push(c); own.add(key(c)); grew = true;
        if (out.length >= n) break;
      }
      if (out.length >= n) break;
    }
    if (!grew) break;
  }
  return out;
}

test('a hand-drawn polder is land: walled, dated, hashed, and joined to the square', () => {
  const { model, layout } = settled();
  const supers = blob(layout, 4);
  assert.ok(supers && supers.length >= 2, 'no shallows to reclaim on this coast');
  const wasStanding = stands(layout);
  const before = clone(layout);
  const bareHash = layout.terrainHash;

  const dry = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }] }), { ...opts, dryRun: true, now: 1_800_000_000_000 });
  assert.ok(dry.ok, dry.error || JSON.stringify(dry.verdicts));
  assert.equal(JSON.stringify(layout), JSON.stringify(before), 'a dry run changed the layout');

  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }] }), { ...opts, now: 1_800_000_000_000 });
  assert.ok(r.ok, r.error);
  assert.equal(layout.polders.length, 1);
  const p = layout.polders[0];
  assert.equal(p.manual, true);
  assert.equal(p.dugAt, new Date(1_800_000_000_000).toISOString());
  assert.equal(p.at, model.stats.settlers);
  assert.deepEqual(p.supers, [...supers].sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  assert.equal(p.cells.length, supers.length * 16);
  assert.ok(p.dike.length > 0, 'a polder without a dike');
  assert.notEqual(layout.terrainHash, bareHash, 'reclaiming is supposed to move the coast');
  assert.equal(layout.terrainHash, groundOf(layout), 'the hash on record is not the coast with the polder');
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'reclaiming moved something that stood');
  assert.deepEqual(r.diff.plots.otherMoved, []);

  // The new ground is land the island can use, and the way onto it reaches the square.
  const t = makeTerrain(SEED, { size: SIZE, polders: layout.polders, fairway: layout.fairway });
  for (const c of p.cells) assert.ok(t.isBuildable(c[0], c[1]), `polder cell ${key(c)} is not buildable`);
  for (const c of p.pools) assert.ok(before.terrainHash && !makeTerrain(SEED, { size: SIZE, polders: before.polders, fairway: before.fairway }).isLand(c[0], c[1]), `pool ${key(c)} was not water`);
  const road = layout.paths.find((q) => q.id === 'road:polder:0');
  assert.ok(road && road.cells.length, 'no causeway was laid');
  const open = reachableFromSquare({ paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] }, SIZE);
  assert.ok(road.cells.every(([gx, gz]) => open.has(gx + gz * SIZE)), 'the causeway does not reach the square');

  // And the scan after it changes nothing - the ladder sees a polder and digs none of its own.
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written, 'the scan after the polder rewrote the layout');
});

test('a hamlet can be set down on the land the same plan made', () => {
  const { model, layout } = settled();
  const supers = blob(layout, 6);
  if (!supers || supers.length < 6) return;   // this coast has no room for it; the first test is the measurement
  // Find a delta that puts proj:0 wholly on the new ground: its cells, translated, must be
  // a subset of the polder's interior - so try the offsets that map its seed onto each.
  const lobe = layout.districts['proj:0'].lobes[0];
  const inside = new Set(supers.map(key));
  let found = null;
  for (const [i, j] of supers) {
    const di = i - lobe.seed[0], dj = j - lobe.seed[1];
    if (lobe.cells.every(([a, b]) => inside.has(key([a + di, b + dj])))) { found = [di, dj]; break; }
  }
  if (!found) { return; }   // the blob's shape does not hold this lobe; the first test is the measurement
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }, { op: 'move', lobes: [{ district: 'proj:0' }], di: found[0], dj: found[1] }] }), { ...opts, dryRun: true });
  // Either it fits (and the dike, being held, kept it off the wall) or the refusal names the wall.
  if (!r.ok) assert.match(r.verdicts[1].reason || '', /held|belt|land/, `an unexpected refusal: ${r.verdicts[1].reason}`);
  else assert.deepEqual(r.diff.plots.otherMoved, []);
});

test('refusals: land, two pieces, no shore, the town\'s own coast', () => {
  const { model, layout } = settled();
  const before = JSON.stringify(layout);
  const lobe = layout.districts['proj:0'].lobes[0];
  let r = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers: [lobe.seed] }] }), { ...opts, dryRun: true });
  assert.match(r.verdicts[0].reason, /already land/);
  assert.throws(() => parsePlan({ ops: [{ op: 'polder', supers: [[20, 20], [22, 20]] }] }), /one piece/);
  assert.throws(() => parsePlan({ ops: [{ op: 'polder', supers: [] }] }), /at least one/);
  // Open sea far from any coast: a candidate maybe, but nothing to lean on.
  const t = makeTerrain(SEED, { size: SIZE });
  const lat = layout.lattice;
  let lonely = null;
  for (let j = -15; j <= 15 && !lonely; j++) for (let i = -15; i <= 15 && !lonely; i++) {
    if (polderCandidate(t, lat, i, j, new Set()) && !touchesShore(t, lat, i, j)) {
      const ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => !t.isLand(...blockOf(lat, i + a, j + b)));
      if (ok) lonely = [i, j];
    }
  }
  if (lonely) {
    r = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers: [lonely] }] }), { ...opts, dryRun: true });
    assert.match(r.verdicts[0].reason, /touch the shore|too deep/);
  }
  assert.equal(JSON.stringify(layout), before, 'a refused polder changed the layout');
});

test('the sea takes a polder back: coast, hash, roads and the ladder\'s memory', () => {
  const { model, layout } = settled();
  const supers = blob(layout, 4);
  assert.ok(supers);
  const bare = clone(layout);
  runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }] }), opts);
  assert.equal(layout.polders.length, 1);
  const wasStanding = stands(layout);
  const before = JSON.stringify(layout);
  const dry = runPlan(layout, model, parsePlan({ ops: [{ op: 'unpolder', index: 0 }] }), { ...opts, dryRun: true });
  assert.ok(dry.ok, dry.error || JSON.stringify(dry.verdicts));
  assert.equal(JSON.stringify(layout), before);
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'unpolder', index: 0 }] }), opts);
  assert.ok(r.ok, r.error);
  assert.equal(layout.polders.length, 0);
  assert.equal(layout.poldersReturned, 1);
  assert.equal(layout.terrainHash, bare.terrainHash, 'the coast is not the coast before the polder');
  assert.equal(layout.terrainHash, groundOf(layout));
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'giving land back moved something');
  assert.deepEqual(layout.paths.filter((q) => String(q.id).startsWith('road:polder:')), [], 'a causeway to nowhere stayed');
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written, 'the scan after giving land back rewrote the layout');
  // The ladder remembers: at POLDER_AT + 10 one rung is wanted, and it was taken.
  const big = village(POLDER_AT + 10);
  big.milestones = [{ civicType: 'poldermill', unlocked: true }];
  placeAll(layout, big, opts);
  assert.equal(layout.polders.length, 0, 'the ladder dug the returned polder up again');
  // Refused while something stands on it, and while a second one is asked in one plan.
  const { model: m2, layout: l2 } = settled();
  const s2 = blob(l2, 3);
  runPlan(l2, m2, parsePlan({ ops: [{ op: 'polder', supers: s2 }] }), opts);
  const c = l2.polders[0].cells[5];
  l2.plots['shed:squatter'] = { gx: c[0], gz: c[1], w: 1, d: 1, rot: 0 };
  const no = runPlan(l2, m2, parsePlan({ ops: [{ op: 'unpolder', index: 0 }] }), { ...opts, dryRun: true });
  assert.match(no.verdicts[0].reason, /shed:squatter stands on it/);
  assert.match(runPlan(l2, m2, parsePlan({ ops: [{ op: 'unpolder', index: 3 }] }), { ...opts, dryRun: true }).verdicts[0].reason, /no polder 3/);
  assert.throws(() => parsePlan({ ops: [{ op: 'unpolder', index: 0 }, { op: 'unpolder', index: 1 }] }), /one polder can be given back/);
});

test('the ladder counts a hand-drawn polder as a rung', () => {
  const { layout } = settled();
  const supers = blob(layout, 3);
  assert.ok(supers);
  const model = village(36);
  runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }] }), opts);
  assert.equal(layout.polders.length, 1);
  // Cross POLDER_AT: wanted is 1, and the manual one is it - the ladder digs nothing.
  const big = village(POLDER_AT + 10);
  big.milestones = [{ civicType: 'poldermill', unlocked: true }];
  const before = layout.polders.length;
  placeAll(layout, big, opts);
  assert.equal(poldersWanted(POLDER_AT + 10), 1);
  assert.equal(layout.polders.length, before, 'the ladder dug beside the hand-drawn polder');
  assert.equal(layout.terrainHash, groundOf(layout));
});
