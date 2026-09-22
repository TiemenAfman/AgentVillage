// The planner as scan.mjs runs it, on a copy of the island as it stands: a dry run writes
// nothing, a refused plan writes nothing and takes no snapshot, an applied plan takes
// exactly one snapshot that is the file as it was, village.json carries the zones, and
// the plain scan after it changes nothing. The same scratch-directory idiom as
// tests/layout-measure.test.mjs, and the same wait on data/scan.lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../scan.mjs';
import { DATA, readJson } from '../lib/paths.mjs';
import { TOWN_CORE_R } from '../lib/layout.mjs';
import { parsePlan, isSnapshotName } from '../lib/plan.mjs';
import { stands, movedBetween } from './support/village.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-plan-'));
const files = { layout: path.join(work, 'layout.json'), village: path.join(work, 'village.json'), cache: path.join(work, 'cache.json') };
for (const [from, to] of [['layout.json', files.layout], ['cache.json', files.cache]]) {
  try { fs.copyFileSync(path.join(DATA, from), to); } catch { /* a checkout with no island yet */ }
}
// A placements file beside the layout, so `forgetPlacements` has one to forget from and
// the real island's is never touched.
fs.writeFileSync(path.join(work, 'placements.json'), JSON.stringify({ generatedAt: 'x', at: { 'house:nobody': [1, 2] }, decks: {} }));

// Patient, because the suite runs test files in parallel and tests/layout-measure.test.mjs
// scans the island three times over on the same lock: a wait of a few seconds here is
// the difference between measuring the planner and measuring who got the lock first.
async function scanOnce(extra = {}) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = await scan({ quiet: true, persistLayout: true, layoutFile: files.layout, out: files.village, cacheFile: files.cache, ...extra });
    if (!r || !r.skipped) return r;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error('the island was scanning throughout; could not take the scan lock');
}
const bytes = (f) => fs.readFileSync(f, 'utf8');
const snapshots = () => fs.readdirSync(work).filter(isSnapshotName);

await scanOnce();
const layout0 = readJson(files.layout);
const SETTLED = Object.keys(layout0.plots).filter((id) => id.startsWith('house:')).length >= 12;

// A super-cell that is wholly on the island, outside the town's core and nobody's: the
// first one found walking out from the centre.
function freeSuper(layout) {
  const owned = new Set();
  for (const d of Object.values(layout.districts)) for (const l of d.lobes || []) for (const c of l.cells) owned.add(`${c[0]},${c[1]}`);
  for (const c of layout.town.commons || []) owned.add(`${c[0]},${c[1]}`);
  const R = Math.floor(layout.size / layout.lattice.pitch / 2) - 2;
  for (let r = TOWN_CORE_R + 1; r < R; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (!owned.has(`${di},${dj}`)) return [di, dj];
    }
  }
  return null;
}

test('a dry run writes nothing, not even the cache', async () => {
  const before = { layout: bytes(files.layout), village: bytes(files.village), cache: bytes(files.cache) };
  const plan = parsePlan({ ops: [{ op: 'zone', add: [freeSuper(layout0)] }] });
  const r = await scanOnce({ plan, dryRun: true });
  assert.ok(r.plan, 'the scan carried no plan result');
  assert.equal(r.plan.ok, true, r.plan.error);
  assert.equal(r.plan.dryRun, true);
  assert.deepEqual(r.plan.diff.plots.otherMoved, []);
  assert.equal(bytes(files.layout), before.layout, 'layout.json was written by a dry run');
  assert.equal(bytes(files.village), before.village, 'village.json was written by a dry run');
  assert.equal(bytes(files.cache), before.cache, 'cache.json was written by a dry run');
  assert.deepEqual(snapshots(), []);
});

test('a refused plan writes nothing and takes no snapshot', async () => {
  const before = bytes(files.layout);
  const r = await scanOnce({ plan: parsePlan({ ops: [{ op: 'zone', add: [[0, 0]] }] }) });
  assert.equal(r.plan.ok, false);
  assert.match(r.plan.verdicts[0].reason, /town's own ground/);
  assert.equal(bytes(files.layout), before);
  assert.deepEqual(snapshots(), []);
});

test('an applied zone: one snapshot equal to the file before, zones in village.json, and the next scan is a no-op', async () => {
  const before = bytes(files.layout);
  const target = freeSuper(layout0);
  const r = await scanOnce({ plan: parsePlan({ ops: [{ op: 'zone', add: [target] }] }), now: new Date(2026, 8, 22, 15, 0, 0).getTime() });
  assert.equal(r.plan.ok, true, r.plan.error);
  assert.equal(r.plan.snapshot, 'layout.before-plan-20260922-150000.json');
  assert.deepEqual(snapshots(), [r.plan.snapshot]);
  assert.equal(bytes(path.join(work, r.plan.snapshot)), before, 'the snapshot is not the file as it was');
  const layout1 = readJson(files.layout);
  assert.deepEqual(layout1.zones, [{ kind: 'no-build', supers: [target] }]);
  assert.deepEqual(readJson(files.village).zones, layout1.zones, 'village.json does not carry the zones');
  assert.deepEqual(movedBetween(stands(layout0), stands(layout1)), [], 'a zone moved a plot');

  const written = bytes(files.layout);
  await scanOnce();
  assert.equal(bytes(files.layout), written, 'the scan after the plan rewrote layout.json');
});

test('a hamlet moved on the real island: rigid, roaded, and the next scan is a no-op', async (t) => {
  if (!SETTLED) { t.diagnostic('an island too small to have hamlets to move'); return; }
  const layout = readJson(files.layout);
  // The smallest hamlet with a road, since the belt refuses most destinations of a large
  // one on a settled island - see Plans/wijkjes-verplaatsen.md, "Wat echt moeilijk is" #2.
  const cands = Object.entries(layout.districts)
    .filter(([, d]) => d.lobes && d.lobes.length === 1 && d.lobes[0].road && d.lobes[0].cells.length >= 1)
    .sort((a, b) => a[1].lobes[0].cells.length - b[1].lobes[0].cells.length);
  assert.ok(cands.length, 'no hamlet with a road');
  let found = null;
  outer: for (const [district] of cands.slice(0, 3)) {
    for (let r = 1; r <= 3 && !found; r++) {
      for (let dj = -r; dj <= r && !found; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const plan = parsePlan({ ops: [{ op: 'move', lobes: [{ district, lobe: 0 }], di, dj }] });
          const dry = await scanOnce({ plan, dryRun: true });
          if (dry.plan.ok) { found = { district, plan, di, dj }; break outer; }
        }
      }
    }
  }
  if (!found) { t.diagnostic('no delta within three rings was accepted for the three smallest hamlets - the belt'); return; }
  const before = readJson(files.layout);
  const r = await scanOnce({ plan: found.plan });
  assert.equal(r.plan.ok, true, r.plan.error);
  assert.deepEqual(r.plan.diff.plots.otherMoved, []);
  assert.deepEqual(r.plan.unplaced, []);
  const after = readJson(files.layout);
  const houses = Object.entries(before.plots).filter(([id, p]) => id.startsWith('house:') && p.district === found.district && p.lobe === 0).map(([id]) => id);
  const sheds = Object.entries(before.shedOf || {}).filter(([, m]) => houses.includes(m)).map(([s]) => s);
  assert.ok(houses.length, 'the moved hamlet had no houses');
  for (const id of [...houses, ...sheds]) {
    const a = before.plots[id], b = after.plots[id];
    assert.deepEqual([b.gx - a.gx, b.gz - a.gz, b.rot], [found.di * 4, found.dj * 4, a.rot], `${id} did not move rigidly`);
  }
  const others = movedBetween(stands(before), stands(after)).filter((id) => !houses.includes(id) && !sheds.includes(id));
  assert.deepEqual(others.filter((id) => id !== `civic:office:${found.district}`), [], 'something else moved');
  t.diagnostic(`moved ${found.district} by [${found.di}, ${found.dj}]: ${houses.length} houses, ${sheds.length} sheds; paths ${r.plan.diff.paths.before} -> ${r.plan.diff.paths.after}, pruned ${r.plan.pruned.length}`);
  const written = bytes(files.layout);
  await scanOnce();
  assert.equal(bytes(files.layout), written, 'the scan after the move rewrote layout.json');
});

test.after(() => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* the tmp dir will go */ } });
