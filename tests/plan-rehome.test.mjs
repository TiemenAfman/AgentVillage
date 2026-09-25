// Sending one house to a hamlet of its own (Plans/huis-naar-eigen-wijkje.md).
//
// The one op that moves a single house. What it has to be: the house and its sheds end up
// on the new hamlet's land and nowhere near their old neighbours; nothing else moves; the
// word about who lives where is kept in the layout, beside the plot; the scan after it
// changes nothing; and without somebody to survey the village again it refuses rather than
// placing the house back where it came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout } from '../lib/layout.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { namedDistrict } from '../lib/village.mjs';
import { village, clone, stands, movedBetween, cutOff, overlaps } from './support/village.mjs';

const SEED = 1337, SIZE = 128;
const opts = { seed: SEED, size: SIZE };

// What buildVillage does with `rehomed`, for the synthetic village: the house and its
// sheds change district, and the named district is counted like any other.
function surveyor(base) {
  return (rehomed) => {
    const m = clone(base);
    for (const [id, r] of Object.entries(rehomed || {})) {
      const house = m.buildings.find((b) => b.id === id);
      if (!house) continue;
      const from = m.districts.find((d) => d.id === house.district);
      for (const b of m.buildings) if (b.id === id || b.master === id) b.district = r.district;
      if (from) from.population--;
      let d = m.districts.find((x) => x.id === r.district);
      if (!d) { d = { ...namedDistrict(r.district, r.name), firstSeenAt: house.startedAt, population: 0 }; m.districts.push(d); }
      d.population++;
    }
    return m;
  };
}

function settled() {
  const model = village(36);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout };
}

test('a house leaves for a hamlet of its own, sheds and all, and nothing else moves', () => {
  const { model, layout } = settled();
  const id = 'house:proj:0:0';
  const shed = 'shed:proj:0:0:a';
  assert.ok(layout.plots[id] && layout.plots[shed], 'a house with a shed to send');
  const wasStanding = stands(layout);
  const plan = parsePlan({ ops: [{ op: 'rehome', house: id, name: 'Crypto' }] });
  const remodel = surveyor(model);

  const dry = runPlan(layout, model, plan, { ...opts, dryRun: true, remodel });
  assert.ok(dry.ok, `dry run refused: ${dry.error}`);
  assert.deepEqual(stands(layout), wasStanding, 'a dry run moved something');

  const r = runPlan(layout, model, plan, { ...opts, remodel });
  assert.ok(r.ok, `apply refused: ${r.error}`);
  assert.deepEqual(r.diff.plots.otherMoved, []);
  assert.deepEqual(movedBetween(wasStanding, stands(layout)).sort(), [id, shed].sort(), 'exactly the household moved');
  assert.equal(layout.plots[id].district, 'n:crypto');
  assert.deepEqual(layout.rehomed, { [id]: { district: 'n:crypto', name: 'Crypto' } });
  assert.ok(layout.districts['n:crypto'], 'the hamlet was founded');
  // On its own land: the house's cells are inside a lobe of the new hamlet.
  const lat = layout.lattice;
  const p = layout.plots[id];
  const own = new Set(layout.districts['n:crypto'].lobes.flatMap((l) => l.cells).map((c) => `${c[0]},${c[1]}`));
  const si = Math.floor((p.gx - lat.anchor[0]) / lat.pitch), sj = Math.floor((p.gz - lat.anchor[1]) / lat.pitch);
  assert.ok(own.has(`${si},${sj}`), `the house stands on [${si}, ${sj}], which is not the new hamlet's`);
  assert.deepEqual(cutOff(layout, SIZE), [], 'somebody has no way to the square');
  assert.deepEqual(overlaps(layout), []);
  // The returned model is the one with the house in it, for the scan to assemble from.
  assert.equal(r.model.buildings.find((b) => b.id === id).district, 'n:crypto');

  // And the next scan, with the new model, is byte-identical.
  const once = JSON.stringify(layout);
  placeAll(layout, r.model, opts);
  assert.equal(JSON.stringify(layout), once, 'the scan after the rehome moved something');
});

test('a rehome with nobody to survey the village is refused, and changes nothing', () => {
  const { model, layout } = settled();
  const before = JSON.stringify(layout);
  const plan = parsePlan({ ops: [{ op: 'rehome', house: 'house:proj:0:0', name: 'Crypto' }] });
  const r = runPlan(layout, model, plan, opts);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(layout), before);
});

test('what a rehome may say', () => {
  assert.deepEqual(parsePlan({ ops: [{ op: 'rehome', house: 'house:abc-1', name: ' Crypto! ' }] }).ops[0],
    { op: 'rehome', house: 'house:abc-1', name: 'Crypto!', slug: 'crypto' });
  assert.throws(() => parsePlan({ ops: [{ op: 'rehome', house: 'civic:townhall', name: 'X' }] }), /not a house/);
  assert.throws(() => parsePlan({ ops: [{ op: 'rehome', house: 'house:a', name: '!!!' }] }), /not a name/);
  assert.throws(() => parsePlan({ ops: [{ op: 'rehome', house: 'house:a', name: '__proto__' }] }));
  const { model, layout } = settled();
  const same = runPlan(layout, surveyor(model)({ 'house:proj:1:0': { district: 'n:crypto', name: 'Crypto' } }),
    parsePlan({ ops: [{ op: 'rehome', house: 'house:proj:9:9', name: 'Crypto' }] }), { ...opts, dryRun: true, remodel: surveyor(model) });
  assert.equal(same.ok, false, 'a house that does not stand anywhere cannot be sent anywhere');
});
