// A no-build zone, measured. It is a dike without the water (lib/layout.mjs `zoneCells`):
// held, so no parcel may contain the super-cell, and RESERVED on the cell grid, so no
// shed, civic or road lands on it. What already stands inside one stays. And a scan of an
// island with a zone on it changes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, TOWN_CORE_R } from '../lib/layout.mjs';
import { blockOf } from '../shared/lattice.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { village, clone, key, stands, movedBetween, plotCells, cutOff } from './support/village.mjs';

const SEED = 1337, SIZE = 128;
const opts = { seed: SEED, size: SIZE };

function settled(settlers) {
  const model = village(settlers);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout };
}
const cellsOf = (lat, supers) => {
  const out = new Set();
  for (const [i, j] of supers) {
    const [gx, gz] = blockOf(lat, i, j);
    for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) out.add(key([gx + x, gz + z]));
  }
  return out;
};

test('the next hamlet settles around a zone rather than on it', () => {
  // Grow the village on a copy to learn where the newcomers *would* have settled, then
  // zone exactly that ground on the real island and grow it for real.
  const { model: small, layout } = settled(24);
  const bigger = village(36);
  const foresee = clone(layout);
  placeAll(foresee, bigger, opts);
  const owned = new Set();
  for (const d of Object.values(layout.districts)) for (const l of d.lobes || []) for (const c of l.cells) owned.add(key(c));
  const fresh = [];
  for (const d of Object.values(foresee.districts)) for (const l of d.lobes || []) for (const c of l.cells) if (!owned.has(key(c))) fresh.push(c);
  assert.ok(fresh.length >= 3, `growing the village claimed ${fresh.length} new super-cells; nothing to zone`);

  const zone = fresh.filter(([i, j]) => Math.max(Math.abs(i), Math.abs(j)) > TOWN_CORE_R).slice(0, 8);
  const wasStanding = stands(layout);
  const r = runPlan(layout, small, parsePlan({ ops: [{ op: 'zone', add: zone }] }), opts);
  assert.ok(r.ok, r.error);
  assert.deepEqual(layout.zones, [{ kind: 'no-build', supers: [...zone].sort((a, b) => a[1] - b[1] || a[0] - b[0]) }]);
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'zoning moved something');

  placeAll(layout, bigger, opts);
  const zoned = new Set(zone.map(key));
  for (const [id, d] of Object.entries(layout.districts)) {
    for (const l of d.lobes || []) for (const c of l.cells) assert.ok(!zoned.has(key(c)), `${id} took zoned super-cell ${key(c)}`);
  }
  const cells = cellsOf(layout.lattice, zone);
  for (const k of plotCells(layout)) assert.ok(!cells.has(k), `a plot stands on zoned cell ${k}`);
  for (const p of layout.paths) for (const c of p.cells) assert.ok(!cells.has(key(c)), `${p.id} runs over zoned cell ${key(c)}`);
  assert.deepEqual(movedBetween(wasStanding, stands(layout)).filter((id) => wasStanding[id]), [], 'growing the village moved something that stood');

  const written = JSON.stringify(layout);
  placeAll(layout, bigger, opts);
  assert.equal(JSON.stringify(layout), written, 'a scan of the zoned island rewrote the layout');
});

test('a zone over a hamlet freezes it and says so; it never evicts', () => {
  const { model, layout } = settled(36);
  const lobe = layout.districts['proj:2'].lobes[0];
  const houseCells = lobe.cells.filter(([i, j]) => Object.values(layout.plots).some((p) => p.cell && p.cell[0] === i && p.cell[1] === j));
  assert.ok(houseCells.length, 'a lobe with a house on it');
  const wasStanding = stands(layout);
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', add: houseCells }] }), opts);
  assert.ok(r.ok, r.error);
  assert.match(r.verdicts[0].notes.join(' '), /covers \d+ building\(s\), which stay/);
  assert.match(r.verdicts[0].notes.join(' '), /of P2's land/);
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'a zone moved a house');
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written);
});

test('a road through a new zone is laid again around it, and nobody is cut off', () => {
  const { model, layout } = settled(36);
  // The first hamlet road's middle cell: zone the super-cell it runs through, if that
  // super-cell is nobody's (a zone over owned land freezes it, which is the test above).
  const owned = new Set();
  for (const d of Object.values(layout.districts)) for (const l of d.lobes || []) for (const c of l.cells) owned.add(key(c));
  const lat = layout.lattice;
  let target = null;
  for (const p of layout.paths.filter((q) => String(q.id).startsWith('road:'))) {
    for (const [gx, gz] of p.cells) {
      const i = Math.floor((gx - lat.anchor[0]) / lat.pitch), j = Math.floor((gz - lat.anchor[1]) / lat.pitch);
      if (Math.max(Math.abs(i), Math.abs(j)) <= TOWN_CORE_R || owned.has(key([i, j]))) continue;
      target = [i, j]; break;
    }
    if (target) break;
  }
  assert.ok(target, 'no hamlet road crosses unowned countryside');
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', add: [target] }] }), opts);
  assert.ok(r.ok, r.error);
  assert.match(r.verdicts[0].notes.join(' '), /road\(s\) ran through it/);
  const cells = cellsOf(lat, [target]);
  for (const p of layout.paths) for (const c of p.cells) assert.ok(!cells.has(key(c)), `${p.id} still runs through the zone`);
  assert.deepEqual(r.unplaced, []);
  assert.deepEqual(cutOff(layout, SIZE), [], 'the re-routing cut somebody off');
});

test('the town\'s own ground and the rim of the island are refused; releasing a zone works', () => {
  const { model, layout } = settled(36);
  const before = JSON.stringify(layout);
  let r = runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', add: [[0, 0]] }] }), { ...opts, dryRun: true });
  assert.equal(r.ok, false);
  assert.match(r.verdicts[0].reason, /town's own ground/);
  r = runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', add: [[-40, 0]] }] }), { ...opts, dryRun: true });
  assert.match(r.verdicts[0].reason, /not wholly on the island/);
  assert.equal(JSON.stringify(layout), before);

  runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', add: [[9, 9], [10, 9]] }] }), opts);
  assert.equal(layout.zones[0].supers.length, 2);
  runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', remove: [[9, 9]] }] }), opts);
  assert.deepEqual(layout.zones, [{ kind: 'no-build', supers: [[10, 9]] }]);
  runPlan(layout, model, parsePlan({ ops: [{ op: 'zone', remove: [[10, 9]] }] }), opts);
  assert.deepEqual(layout.zones, [], 'an emptied kind lingers');
});
