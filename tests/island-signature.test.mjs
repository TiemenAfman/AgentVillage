// When a neighbour's island has to be drawn again, and when it must not be.
//
// `rev` is the sea's counter: it moves on every publish and means "their bundle is not the
// one you have". It is not the same question as "does their island look different", and
// the gap between the two is expensive. A scan republishes an island every time a
// session's state moves on, so a busy neighbour bumps `rev` three times a minute - and
// raising a guest island now builds the same landscape ours is built with, twenty thousand
// trees and all, which measures better than half a second. Three times a minute the page
// stopped dead for that long, and on the frame afterwards every settler, mill and cloud
// lurched forward by the whole of it.
//
// Both halves are asserted here and the second is the one with teeth. Missing a rebuild is
// the worse failure of the two: a neighbour builds a house and it is simply never drawn,
// with nothing in the console to say so. That is why the signature is written as what to
// leave out - so a field added to a bundle tomorrow counts by default - and that is what
// the last test in this file pins down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawnSignature, SOFT_FIELDS, SOFT_BUILDING_FIELDS } from '../web/js/islandsig.js';

// Shaped like a bundle off the wire, with only the fields these tests move.
const bundle = () => ({
  v: 1,
  island: {
    id: 'a84a82acc8646c6c', name: 'Hoogezand', keeper: 'martijn', seed: 4242, gridSize: 256,
    terrainHash: 'abc123', town: { gx: 32, gz: 32, paved: [[32, 32]] }, lattice: { anchor: [0, 0], pitch: 4 },
  },
  grid: { size: 256 },
  districts: [{ id: 'd1', name: 'The Quay', hue: 205, paved: [[10, 10]], lobes: [{ parcel: null }] }],
  buildings: [{ id: 'house:s1', kind: 'house', plot: { gx: 4, gz: 4, w: 3, d: 3, rot: 0 }, door: [4, 7], active: false, lastAt: 1000 }],
  paths: [{ cells: [[1, 1], [1, 2]] }],
  bridges: [], cleared: [[4, 4]], polders: [], fairway: null,
  props: [{ id: 'p1', kind: 'tree', x: 1, z: 1 }],
  crops: [{ id: 'c1', bed: 2 }],
  placements: { 'house:s1': [4.5, 4.5] },
  decks: { 100: 0.4 },
});

const same = (mutate) => {
  const a = bundle(), b = bundle();
  mutate(b);
  return drawnSignature(a) === drawnSignature(b);
};

test('a republish that only moves a settler\'s state draws nothing again', () => {
  // Measured on a live island: across a scan with nothing built, `buildings` was the only
  // top-level field that differed and these two were the only keys inside it.
  assert.ok(same((b) => { b.buildings[0].active = true; }));
  assert.ok(same((b) => { b.buildings[0].lastAt = 999999; }));
  assert.ok(same((b) => { b.buildings[0].active = true; b.buildings[0].lastAt = 5; }));
});

test('what has a door of its own does not force a rebuild', () => {
  // Props and beds arrive through POST /island/:id/parcel and are applied without one;
  // placements and decks are the sea's business and this page never reads them.
  assert.ok(same((b) => { b.props.push({ id: 'p2', kind: 'tree', x: 9, z: 9 }); }));
  assert.ok(same((b) => { b.crops = []; }));
  assert.ok(same((b) => { b.placements = {}; }));
  assert.ok(same((b) => { b.decks = { 200: 1.5 }; }));
  assert.deepEqual([...SOFT_FIELDS].sort(), ['crops', 'decks', 'placements', 'props']);
  assert.deepEqual([...SOFT_BUILDING_FIELDS].sort(), ['active', 'lastAt']);
});

test('anything that changes the shape of the place is drawn again', () => {
  const cases = {
    'a house built': (b) => b.buildings.push({ id: 'house:s2', kind: 'house', plot: { gx: 9, gz: 9, w: 3, d: 3 } }),
    'a house moved': (b) => { b.buildings[0].plot.gx = 40; },
    'a door moved': (b) => { b.buildings[0].door = [5, 8]; },
    'a house pulled down': (b) => { b.buildings = []; },
    'a lane laid': (b) => b.paths.push({ cells: [[7, 7]] }),
    'a bridge thrown': (b) => b.bridges.push({ cells: [[3, 3]] }),
    'ground cleared': (b) => b.cleared.push([5, 5]),
    'a polder walled in': (b) => b.polders.push({ cells: [[8, 8]], dike: [], road: [] }),
    'a fairway dredged': (b) => { b.fairway = { cells: [[2, 2]] }; },
    'a hamlet founded': (b) => b.districts.push({ id: 'd2', hue: 90, paved: [], lobes: [] }),
    'a hamlet recoloured': (b) => { b.districts[0].hue = 12; },
    'a parcel grown': (b) => { b.districts[0].lobes = [{ parcel: { w: 2, h: 2, rows: ['11', '11'], i0: 0, j0: 0 } }]; },
    'a district renamed': (b) => { b.districts[0].name = 'The Outlands'; },
    'the square paved wider': (b) => { b.island.town.paved.push([33, 32]); },
    'the lattice moved': (b) => { b.island.lattice.pitch = 5; },
    'the land itself': (b) => { b.island.terrainHash = 'def456'; },
    'a different seed': (b) => { b.island.seed = 7; },
  };
  for (const [what, mutate] of Object.entries(cases)) {
    assert.equal(same(mutate), false, `${what} left the island looking unchanged`);
  }
});

test('a field nobody has thought of yet counts', () => {
  // The whole reason this is a deny-list. Somebody adds `piers` to a bundle next month and
  // does not come here; the island must still be drawn again rather than silently never.
  assert.equal(same((b) => { b.piers = [{ id: 'j1', cells: [[1, 1]] }]; }), false);
  assert.equal(same((b) => { b.island.beacons = [[3, 3]]; }), false);
  assert.equal(same((b) => { b.buildings[0].storeys = 3; }), false);
});

test('a bundle that is not one has no signature, and does not throw', () => {
  assert.equal(drawnSignature(null), '');
  assert.equal(drawnSignature({}), '');
  assert.equal(drawnSignature({ island: null }), '');
  assert.ok(drawnSignature(bundle()).length > 0);
});
