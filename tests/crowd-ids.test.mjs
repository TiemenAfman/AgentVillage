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
import test from 'node:test';
import assert from 'node:assert/strict';
import { guestVillage } from '../lib/guestview.mjs';
import { buildBundle } from '../lib/islandbundle.mjs';
import { isPublicPath } from '../lib/access.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SESSION = '0aded9dd-965c-438d-a44f-462bf2829bc0';
const SECOND = '11111111-2222-3333-4444-555555555555';
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
    ],
    paths: [], bridges: [], cleared: [], polders: [], milestones: [], active: [], assignments: [], stats: {},
  };
}

test('every name the sea will use comes back as the name this island knows', () => {
  const v = village();
  const out = {};
  const bundle = buildBundle({ config: { islandName: 'Promptholm', seed: 1337, port: 4747, gridSize: SIZE }, village: v, id: 'abcdef0123456789', keeper: 'Martijn' }, out);

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
  const plain = buildBundle({ config: { islandName: 'Promptholm', seed: 1337, port: 4747, gridSize: SIZE }, village: v, id: 'abcdef0123456789', keeper: 'Martijn' });
  const out = {};
  const asked = buildBundle({ config: { islandName: 'Promptholm', seed: 1337, port: 4747, gridSize: SIZE }, village: v, id: 'abcdef0123456789', keeper: 'Martijn' }, out);
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
