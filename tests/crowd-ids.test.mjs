// The map back from a redacted roster to this island's own names.
//
// The bundle an island publishes is the redacted one - the same bundle every stranger is
// handed, and it has to be - so the sea walks our crowd under `house:s3` while this page
// drew the houses under `house:<uuid>`. Something has to join the two, and it can only be
// the machine that did the renaming: a shed's id in particular cannot be reconstructed
// from the outside, which is the entire point of redacting it.
//
// Two things are asserted, and the second is the one with teeth: the map is *right*, and
// it is the exact inverse of the redaction, so it must never be reachable by a visitor.
//
// And then the other half of the same promise, at the bottom: that there is nothing left in
// a published bundle for that map to be the inverse *of*. `placements` shipped its keys
// verbatim for as long as it existed, so a bundle sailed with its buildings redacted and
// its placements in raw session uuids - and the sea, which looks a settler up by the
// redacted name, missed on every one of them. Those tests are written as a walk over the
// whole structure rather than as a list of the fields allowed to carry an id, because a
// list of fields is precisely what has failed here three times in a fortnight: `pools` was
// missed when it arrived beside `dike`, `fairway` twice nearly went the same way, and
// `placements` did. A walk cannot be forgotten when a field is added beside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { guestVillage } from '../lib/guestview.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { isPublicPath } from '../lib/access.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SESSION = '0aded9dd-965c-438d-a44f-462bf2829bc0';
const SECOND = '11111111-2222-3333-4444-555555555555';
// A session whose house has been demolished since the page last wrote its placements down.
// data/placements.json is not pruned by anything - the scanner never touches it - so a real
// one on this machine carries rows for buildings that are no longer in the village, and a
// row that names nothing has to be dropped rather than passed through raw.
const GONE = '99999999-8888-7777-6666-555555555555';
const AGENT = 'a02a58fad9a49a61b';
const SHED = `shed:${SESSION}:${AGENT}`;
const SIZE = 64;

function village() {
  const terrain = makeTerrain(1337, { size: SIZE });
  return {
    generatedAt: '2026-09-18T10:00:00.000Z',
    island: {
      name: 'Promptholm', seed: 1337, gridSize: SIZE, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z', landing: null,
      town: { gx: 32, gz: 32, r: 8, paved: [] }, lattice: null,
    },
    grid: { size: SIZE },
    districts: [],
    buildings: [
      { id: `house:${SESSION}`, sessionId: SESSION, kind: 'house', name: 'One', style: 'opus', plot: { gx: 20, gz: 20, w: 2, d: 2, rot: 0 }, sheds: [SHED] },
      { id: SHED, sessionId: SESSION, kind: 'shed', master: `house:${SESSION}`, agentType: 'Explore', name: 'Helper', style: 'opus', plot: { gx: 22, gz: 20, w: 1, d: 1, rot: 0 } },
      { id: `house:${SECOND}`, sessionId: SECOND, kind: 'house', name: 'Two', style: 'opus', plot: { gx: 26, gz: 20, w: 2, d: 2, rot: 0 } },
      // No session and so no uuid: guestVillage finds nothing to rename in this one, and it
      // sails under the name this island knows it by. It is here because that is the case
      // the rename must leave alone - a civic building is in the table mapping to itself,
      // and the lighthouse keeps the placement lib/fleet.mjs lights it from.
      { id: 'civic:lighthouse', kind: 'civic', civicType: 'lighthouse', plot: { gx: 52, gz: 9, w: 1, d: 1, rot: 2 } },
    ],
    paths: [], bridges: [], cleared: [], polders: [], milestones: [], active: [], assignments: [], stats: {},
  };
}

// What the keeper's own page posts back to /api/placements, in this machine's own names -
// which is how data/placements.json is written and how it stays. The translation to the
// names a building sails under belongs at the moment of packing, not in the file: the file
// is what this machine reads back, and a redacted copy on disk would be a second copy of
// the redaction to keep in step with the first.
function placements() {
  return {
    at: {
      [`house:${SESSION}`]: [-10.75, -11.25],
      [SHED]: [-9.6, -11.4],
      [`house:${SECOND}`]: [-4.85, -11.1],
      'civic:lighthouse': [20.75, -22.25],
      [`house:${GONE}`]: [3.5, 3.5],
    },
    // Keyed by the plain `gx + gz * size` cell a bridge or the quay is recorded under, not
    // by the building that carries the road. Nothing in here to rename.
    decks: { 2145: 1.25, 2146: 1.3 },
  };
}

const CONFIG = { islandName: 'Promptholm', seed: 1337, port: 4747, gridSize: SIZE };
const pack = (extra = {}, out = null) => buildBundle({
  config: CONFIG, village: village(), id: 'abcdef0123456789', keeper: 'Martijn', ...extra,
}, out);

// Every session id this island's own names are built out of, exactly as guestview.mjs
// matches them. Deliberately the same pattern and not a stricter one: what matters is that
// nothing shaped like a session id survives, whatever field invented it.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Every place a raw session id turns up in a structure - in a key or in a value, at any
// depth - with the path to it, so a failure names the field rather than merely the count.
function uuidsIn(node, at = '$', found = []) {
  if (typeof node === 'string') {
    if (UUID.test(node)) found.push(`${at} = ${node}`);
    return found;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => uuidsIn(v, `${at}[${i}]`, found));
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (UUID.test(k)) found.push(`${at} has a key ${k}`);
      uuidsIn(v, `${at}.${k}`, found);
    }
  }
  return found;
}

test('every name the sea will use comes back as the name this island knows', () => {
  const v = village();
  const out = {};
  const bundle = buildBundle({ config: CONFIG, village: v, id: 'abcdef0123456789', keeper: 'Martijn' }, out);

  // Every building that actually sailed can be named. A map that leaves one out is a
  // settler with no face; a map that names one that did not sail is simply wrong.
  assert.equal(Object.keys(out.ids).length, bundle.buildings.length);
  for (const b of bundle.buildings) {
    assert.ok(out.ids[b.id], `nothing maps ${b.id} back`);
    assert.ok(v.buildings.some((r) => r.id === out.ids[b.id]), `${out.ids[b.id]} is not a building of ours`);
  }

  // And the shed in particular, which is the one that cannot be worked out from outside:
  // its id carries an agent token the redaction renames on a counter of its own.
  const shed = bundle.buildings.find((b) => b.kind === 'shed');
  assert.ok(shed, 'the fixture lost its apprentice');
  assert.notEqual(shed.id, SHED, 'the shed sailed with its real id');
  assert.equal(out.ids[shed.id], SHED);

  // No two names collide onto one house.
  const real = Object.values(out.ids);
  assert.equal(new Set(real).size, real.length);
});

test('asking for the map does not change what sails', () => {
  const v = village();
  const plain = buildBundle({ config: CONFIG, village: v, id: 'abcdef0123456789', keeper: 'Martijn' });
  const out = {};
  const asked = buildBundle({ config: CONFIG, village: v, id: 'abcdef0123456789', keeper: 'Martijn' }, out);
  assert.deepEqual(asked, plain, 'the bundle came out differently when somebody asked for the key to it');

  // And guestVillage without an `out` is what it always was.
  assert.deepEqual(guestVillage(v), guestVillage(v, {}));
});

test('the map is not something a visitor can ask for', () => {
  // It is the inverse of the redaction: one request would undo all of it. The API is
  // deny-by-default, so this is really a test that nobody ever puts it on the allowlist -
  // which is a thing somebody could plausibly do while chasing a settler with no face.
  assert.equal(isPublicPath('/api/crowd-ids'), false);
  // The neighbours it would sit between, so the assertion above cannot pass because the
  // whole allowlist stopped working.
  assert.equal(isPublicPath('/api/hello'), true);
});

// ---- and nothing left for that map to be the inverse of -------------------------------

test('nothing anywhere in a published bundle is a raw session id', () => {
  // Not "no uuid in `placements`". The whole structure, keys and values alike, because all
  // three of the holes this file has had were a field nobody thought to look at. The
  // fixture is deliberately built so that every id in it *starts* as a uuid: if the
  // redaction stopped working altogether this would light up rather than pass vacuously.
  const bundle = pack({ placements: placements() });
  assert.ok(uuidsIn(village()).length > 0, 'the fixture has no session ids left to redact');
  assert.deepEqual(uuidsIn(bundle), [], 'a session id sailed');

  // And the same island with nothing standing on it yet, which is every island until a
  // browser has drawn it once - so the walk is not quietly only exercising the one map it
  // was written for.
  assert.deepEqual(uuidsIn(pack()), []);
});

test('every placement names a building that is actually in the same bundle', () => {
  const bundle = pack({ placements: placements() });
  const sailed = new Set(bundle.buildings.map((b) => b.id));

  const keys = Object.keys(bundle.placements);
  assert.ok(keys.length, 'the bundle sailed with no placements at all');
  for (const key of keys) assert.ok(sailed.has(key), `${key} is placed and is not a building here`);

  // The stale row for a demolished house is dropped rather than carried under a name
  // nobody can resolve - five rows in, four buildings out.
  assert.equal(keys.length, 4);

  // The shed is the one that proves the table is the redaction's own and not a pattern
  // somebody wrote by hand: `shed:s0:x0` carries a counter that cannot be worked out from
  // the outside, so a second, parallel notion of what an id becomes would get it wrong.
  const shed = bundle.buildings.find((b) => b.kind === 'shed');
  assert.ok(bundle.placements[shed.id], 'the apprentice lost their placement in the rename');

  // A civic building is not renamed at all, so its placement travels untouched - which is
  // the row lib/fleet.mjs lights a lighthouse from.
  assert.deepEqual(bundle.placements['civic:lighthouse'], [20.75, -22.25]);

  // `decks` is the map beside it and it turns out to be a different question: keyed by the
  // plain `gx + gz * size` cell rather than by a building, so there is no name in it to
  // redact and never was. What it owes instead is that every key is a cell on this
  // island's own grid, which is asserted here so that keying a deck off the bridge that
  // carries it would be caught rather than merely disapproved of in a comment.
  const most = bundle.grid.size * bundle.grid.size;
  const cells = Object.keys(bundle.decks);
  assert.ok(cells.length, 'the bundle sailed with no decks at all');
  for (const key of cells) {
    const cell = Number(key);
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < most, `${key} is not a cell on a ${bundle.grid.size}-cell island`);
  }
});

test('a settler stands outside their own door rather than on the surveyed centre', () => {
  // The lookup lib/crowd.mjs does, line for line: `bundle.placements[spec.id]`, where
  // `spec.id` is the redacted name, with the plot centre as the fallback. This is the half
  // of the bug that is not about privacy - the keys sailed raw, so every one of these
  // missed and the placements might as well not have travelled at all.
  const bundle = pack({ placements: placements() });
  const half = bundle.grid.size / 2;
  const housed = bundle.buildings.filter((b) => b.kind !== 'civic' && b.plot);
  assert.equal(housed.length, 3);
  for (const spec of housed) {
    const at = bundle.placements[spec.id];
    assert.ok(at, `${spec.id} fell back to the surveyed centre`);
    const centre = [spec.plot.gx + spec.plot.w / 2 - half, spec.plot.gz + spec.plot.d / 2 - half];
    assert.notDeepEqual(at, centre, `${spec.id} was placed where the survey already had it`);
  }
});

test('a bundle carrying placements still survives its own round trip', () => {
  // The fixed point this whole design rests on, now with the one field that is translated
  // on the way out. It is the assertion that catches renaming twice: parseBundle sees keys
  // that have already been through the table, and putting them through it again would drop
  // every one of them - a bundle refused by the very machine that packed it.
  const built = pack({ placements: placements() });
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(built))), built);
});
