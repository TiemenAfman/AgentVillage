// What an island is allowed to say about itself when it sails somewhere else.
//
// Two halves, and they are worth different things.
//
// The first is what must never be in a bundle. A bundle is written to a machine this one
// does not own, by a person who cannot take it back, and it stays there until that other
// machine restarts - so the guarantees the guest view makes on a page have to hold here
// as bytes. The nets below are the same ones lib/guestview.mjs draws for itself, plus the
// ones that only matter once the destination is a disk: no session id, no absolute path,
// no session title, no branch name, no ticket summary, and - unconditionally, however
// this file changes - no uuid of any kind.
//
// The second is the fixed point. `parseBundle(buildBundle(v))` deep-equals
// `buildBundle(v)`, which is the one assertion that cannot be satisfied by writing the
// two halves of lib/islandbundle.mjs separately: the packer and the whitelist have to
// agree on every field name, every cap, every rounding and every null. It is checked
// twice, once directly and once through JSON, because on the wire an `undefined` silently
// becomes an absent key and that difference is invisible in memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { buildBundle, parseBundle, CAPS, SENT, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const SEED = 1337;
const SESSION = '05d81091-c731-4db2-9757-af8c2cce7189';
const RUN = 'a02a58fad9a49a61b';
const ROOT = 'D:\\git\\martijn\\fixture';
// A district's id *is* its full path, and that string turns up again inside the id of its
// office. Both of those are in the fixture on purpose.
const DISTRICT = 'p:d:\\git\\martijn\\fixture';
const TITLE = 'Set up the deploy pipeline for a customer';
const QUESTION = 'Which branch did you mean, develop or the feature one?';
const DESCRIPTION = 'Plan the multi-region client refactor';

// The very regex lib/guestview.mjs:51 uses for its own blunt second pass. Reused rather
// than rewritten so that loosening it there loosens it here too, visibly.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const config = {
  islandName: 'Promptholm',
  seed: SEED,
  port: 4747,
  gridSize: SIZE,
  foundedAt: '2026-09-16T10:22:44.431Z',
  // Everything a config carries that must not travel, in one place, so that a future
  // `...config` shows up as a failure rather than as a shrug.
  network: { public: true, inviteCode: 'open-sesame-9134', hosts: ['island.example.org'] },
  multiplayer: { enabled: true, maxPlayers: 16, guestView: 'full', name: 'Martijn' },
  github: { repo: 'someone/private-repo' },
  dispatch: { skill: 'jira-ticket-oppakken' },
};

function village() {
  const hash = makeTerrain(SEED, { size: SIZE, polders: [] }).hash;
  return {
    v: 1,
    generatedAt: '2026-09-18T10:00:00.000Z',
    all: false,
    island: {
      name: 'Promptholm',
      seed: SEED,
      foundedAt: '2026-09-16T10:22:44.431Z',
      terrainHash: hash,
      landing: [25, 54],
      town: {
        square: [30, 30], centre: [32, 32], lots: [[31, 26], [36, 26]], paved: [[30, 30], [31, 30]],
        size: 5, parcel: { i0: -1, j0: -1, w: 2, h: 2, rows: ['11', '10'] }, coreR: 2,
        sizeSteps: [{ size: 3, at: 1, unlockedAt: '2026-09-16T11:00:00.000Z' }],
      },
      lattice: { anchor: [31, 31], pitch: 4 },
    },
    grid: { size: SIZE },
    hamletAt: 3,
    districts: [{
      id: DISTRICT, kind: 'project', name: 'Fixture', root: ROOT, hue: 221,
      center: [40, 30], square: [41, 31], pier: [[20, 50]],
      firstSeenAt: '2026-09-04T08:48:50.524Z', population: 2,
      outposts: [{ name: 'fixture-docks' }], tier: 'hamlet', guest: false,
      paved: [[40, 31]],
      lobes: [{ green: [12, 40], size: 0, paved: [[12, 41]], parcel: { i0: -5, j0: 2, w: 1, h: 1, rows: ['1'] } }],
      folders: { [ROOT]: 2 },
      branches: { 'claude/ban-numbers-fillable-terms': 2 },
    }],
    districtsRev: 998877,
    buildings: [
      {
        id: `house:${SESSION}`, sessionId: SESSION, kind: 'house', visitor: false, district: DISTRICT,
        name: 'Loamy Forge', title: TITLE, founder: false,
        startedAt: '2026-09-17T09:03:40.864Z', lastAt: '2026-09-17T09:05:51.604Z',
        active: true, archived: false,
        waiting: { since: 1789728641858, quietFor: 2079730, asked: false, question: QUESTION, name: 'Fix the seed fallback' },
        source: 'code', entrypoint: 'claude-desktop', style: 'opus',
        model: 'claude-opus-5', models: { 'claude-opus-5': 4 }, tier: 'cottage',
        ornaments: ['forge', 'weathervane'], harbour: true,
        outpost: { name: 'fixture-lowpoly-docks-a093f7' },
        cwd: ROOT, gitBranch: 'claude/ban-numbers-fillable-terms',
        stats: { humanTurns: 1, toolCalls: 6, tokens: { input: 8, output: 1935 } },
        tools: { Skill: 1, ToolSearch: 4 },
        sheds: [`shed:${SESSION}:${RUN}`],
        plot: { gx: 43, gz: 27, w: 3, d: 3, rot: 3 }, door: [43, 28],
        workOrders: [{ key: 'ACME-12', summary: 'Rewrite the billing export' }],
        skills: { jira: false, issue: true },
        commission: { key: 'ACME-12', summary: 'Rewrite the billing export' },
      },
      {
        id: `shed:${SESSION}:${RUN}`, sessionId: SESSION, kind: 'shed', district: DISTRICT,
        master: `house:${SESSION}`, shedType: 'plan', agentType: 'Plan', description: DESCRIPTION,
        name: "Loamy Forge's Plan apprentice", title: DESCRIPTION,
        startedAt: '2026-09-18T10:26:34.152Z', lastAt: '2026-09-18T10:40:22.967Z',
        active: false, archived: false, source: 'code', entrypoint: 'claude-desktop',
        style: 'opus', model: 'claude-opus-5', tier: 'shed', ornaments: [], harbour: false,
        outpost: null, stats: { assistantMsgs: 51 }, tools: {}, spawnDepth: 1, run: null,
        plot: { gx: 44, gz: 30, w: 1, d: 1, rot: 0 }, door: null,
        workOrders: [], skills: { jira: false, issue: false }, commission: null,
      },
      {
        id: `civic:office:${DISTRICT}`, kind: 'civic', civicType: 'office', district: DISTRICT,
        plot: { gx: 39, gz: 29, w: 1, d: 1, rot: 2 }, door: null,
        name: 'Fixture office', label: 'Office', repoName: 'Fixture',
        startedAt: null, lastAt: null, style: 'unknown', model: null, models: {},
        tier: 'civic', ornaments: [], active: false, archived: false,
        stats: {}, tools: {}, sheds: [],
      },
    ],
    paths: [{ id: 'path:civic:clocktower', cells: [[32, 35], [32, 34], [32, 33]] }],
    bridges: [{ id: 'bridge:road:west:0', axis: 'x', cells: [[20, 40], [21, 40]] }],
    cleared: [[31, 26], [32, 26], [33, 26]],
    polders: [],
    milestones: [{ id: 'well', at: 5, label: 'The village well', unlockedAt: '2026-09-17T08:00:00.000Z' }],
    active: [`house:${SESSION}`],
    assignments: [{ key: 'ACME-12', summary: 'Rewrite the billing export' }],
    stats: { settlers: 2, apprentices: 1 },
  };
}

const props = [{
  id: 'prop:1a2b3c4d', kind: 'tree', x: 12.5, z: -3.25,
  // Unrounded on purpose: props.mjs rounds x and z when it stores them and leaves the
  // rotation alone, so this is the value that would break a naive round trip.
  rot: 1.5707963267948966, scale: 1, length: null, label: null, face: null,
  note: 'planted by the well', by: 'Martijn', at: '2026-09-17T09:00:00.000Z', unknown: false,
}];

const crops = [{
  id: 'bed:9f8e7d6c', kind: 'carrot', x: 4.5, z: 8.25, rot: 0,
  plantedAt: 1789728641858, ripeAt: 1789732241858, crop: 6, salt: false,
}];

const pack = () => buildBundle({ config, village: village(), props, crops, keeper: 'Martijn' });
// What actually goes over a wire, which is the only form the host ever sees.
const wire = () => JSON.parse(JSON.stringify(pack()));

function mutated(f) {
  const w = wire();
  f(w);
  return w;
}

test('a bundle carries the island and nothing that came out of a conversation', () => {
  const text = JSON.stringify(pack());

  // The ids. A house's id carries the session uuid and a district's id is a full path.
  assert.ok(!text.includes(SESSION), 'a session id travelled');
  assert.ok(!UUID.test(text), 'a uuid of some kind travelled');
  assert.ok(!/[A-Za-z]:\\\\/.test(text), 'an absolute path travelled');
  assert.ok(!text.toLowerCase().includes('git'), 'something that looks like a repository path travelled');

  // The labels the island writes out of the transcripts themselves.
  for (const key of ['title', 'gitBranch', 'workOrders', 'commission', 'sessionId', 'waiting', 'description', 'cwd', 'root']) {
    assert.ok(!text.includes(`"${key}"`), `buildings still carry ${key}`);
  }
  for (const value of [TITLE, QUESTION, DESCRIPTION, 'ACME-12', 'Rewrite the billing export']) {
    assert.ok(!text.includes(value), `"${value.slice(0, 30)}" travelled`);
  }

  // The four the brief names, which are not drawable and are a fingerprint of how the
  // machine is used.
  for (const key of ['stats', 'tools', 'models', 'skills']) {
    assert.ok(!text.includes(`"${key}"`), `buildings still carry ${key}`);
  }

  // And the config, which is never spread: an invite code is a key to the island.
  for (const value of ['open-sesame-9134', 'island.example.org', 'someone/private-repo', 'jira-ticket-oppakken']) {
    assert.ok(!text.includes(value), `"${value}" came out of the config`);
  }

  // The whole of data/layout.json stays home, and these are the field names that would
  // give it away if somebody ever put it in.
  for (const key of ['parcelV', 'roadV', 'squareV', 'shedOf', 'plots']) {
    assert.ok(!text.includes(`"${key}"`), `something from layout.json travelled (${key})`);
  }
});

test('the guest view runs even when this island shows visitors everything', () => {
  // config.multiplayer.guestView is 'full' in the fixture. That decides what a visitor
  // may look at through this island's own server; it decides nothing about what gets
  // written onto somebody else's disk.
  assert.equal(config.multiplayer.guestView, 'full');
  const b = pack();
  assert.ok(!JSON.stringify(b).includes(SESSION));
  assert.equal(b.buildings[0].id, 'house:s1');           // renamed, not dropped
  assert.equal(b.districts[0].id, 'p:d0');
  assert.equal(b.buildings[2].id, 'civic:office:p:d0');  // the path inside a civic id, gone
});

test('what is left is still drawable', () => {
  const b = pack();
  assert.equal(b.v, 1);
  assert.equal(b.grid.size, SIZE);
  assert.equal(b.island.gridSize, SIZE);
  assert.equal(b.island.seed, SEED);
  assert.equal(b.island.keeper, 'Martijn');
  assert.equal(b.island.id, beaconId(4747));
  assert.deepEqual(b.island.lattice, { anchor: [31, 31], pitch: 4 });
  assert.deepEqual(b.island.landing, [25, 54]);
  assert.deepEqual(b.island.town.parcel, { i0: -1, j0: -1, w: 2, h: 2, rows: ['11', '10'] });
  // A lobe parcel counts super-cells from the lattice anchor and is routinely negative.
  assert.equal(b.districts[0].lobes[0].parcel.i0, -5);
  assert.deepEqual(b.buildings[0].plot, { gx: 43, gz: 27, w: 3, d: 3, rot: 3 });
  assert.equal(b.buildings[0].harbour, true);
  assert.deepEqual(b.buildings[0].ornaments, ['forge', 'weathervane']);
  assert.equal(b.paths[0].cells.length, 3);
  assert.equal(b.bridges[0].axis, 'x');
  assert.equal(b.cleared.length, 3);
  assert.equal(b.props[0].kind, 'tree');
  assert.equal(b.crops[0].crop, 6);

  // The yard. `sheds` is a list of ids, and guestVillage destructures each entry as
  // though it were an object (lib/guestview.mjs:84), which turns every id into sixty
  // one-character keys. The bundle derives the list from the `master` link instead, so
  // the ids survive - and only for sheds that actually came along.
  assert.deepEqual(b.buildings[0].sheds, ['shed:s1:a02a58fad9a49a61b']);
  assert.deepEqual(b.buildings[1].sheds, []);
  assert.equal(b.buildings[1].master, 'house:s1');
});

test('a bundle that came out of buildBundle survives parseBundle unchanged', () => {
  const packed = pack();
  // Twice: once as the object, and once as what a POST actually delivers. The second is
  // the one that catches a field left as `undefined`, which JSON drops on the way out.
  assert.deepEqual(parseBundle(packed), packed);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);
});

test('a terrain that does not match is fatal, not a warning', () => {
  // web/js/main.js only console.warns on this, and on one machine that is right: the land
  // is drawn from the same file either way. Across two machines a mismatch means the two
  // are not running the same shared/terrain.mjs, and every house would stand in the sea.
  assert.throws(() => parseBundle(wire(), { terrainHash: 'deadbeef' }), /not running the same terrain/);
  // And with nothing handed in, it builds the terrain itself rather than taking the
  // sender's word for it.
  assert.throws(() => parseBundle(mutated((w) => { w.island.terrainHash = '00000000'; })), /not running the same terrain/);
});

test('a drained polder sails with every list that raised its ground', () => {
  // Which is all three of them. A dike corners off pockets of sea the tide can no longer
  // reach, `reclaim` fills those to the height of the polder, and `makeTerrain` therefore
  // reads `pools` alongside `cells` and `dike` - so they are part of the hash. Leave them
  // out of the whitelist and the bundle still declares the pooled hash while the ground it
  // carries builds the un-pooled one: the island is refused on arrival, in the words
  // reserved for two machines running different code. Twenty-eight of forty seeds grow a
  // pooled polder somewhere up the ladder, so this is the ordinary case, not a corner.
  const drained = { cells: [[20, 20], [21, 20]], pools: [[19, 20], [19, 21]], dike: [[22, 20]], road: [[23, 20]] };
  const without = { ...drained, pools: [] };
  const hash = makeTerrain(SEED, { size: SIZE, polders: [drained] }).hash;
  assert.notEqual(hash, makeTerrain(SEED, { size: SIZE, polders: [without] }).hash,
    'the pools have to move the coast, or this test proves nothing');

  const v = village();
  v.island.terrainHash = hash;
  v.polders = [{ ...drained, supers: [[1, 1]], seed: [1, 1], at: 150, unlockedAt: '2026-09-17T09:00:00.000Z' }];
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.polders[0].pools, drained.pools, 'the pools were dropped on the way out');
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);

  // A polder the keeper drained by hand (lib/plan.mjs) carries three fields the ladder's do
  // not - `manual`, `at` as a settler count, `dugAt` - and none of them moves a height. They
  // stay home: the bundle is the ground and the date, and it has to agree with its own hash
  // exactly as a planned one does.
  const w = village();
  w.island.terrainHash = hash;
  w.polders = [{ ...drained, supers: [[1, 1]], seed: [1, 1], manual: true, at: 134, dugAt: '2026-09-22T18:28:24.632Z', unlockedAt: '2026-09-22T18:28:24.632Z' }];
  const hand = buildBundle({ config, village: w, keeper: 'Martijn' });
  for (const f of ['manual', 'dugAt', 'supers', 'seed']) assert.equal(f in hand.polders[0], false, `${f} went to sea`);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(hand))), hand);
});

test('a grown island sails with what its steps decided and with its earthworks', () => {
  // All of it decides the ground and so the hash, like a polder's pools: a step's `water` with
  // its lanes, ponds and funnel, and `works` (digs, fills, the harbour funnel). Left out of the
  // whitelist the bundle still declares the hash while the ground it carries builds another, and
  // the island is refused on arrival in the words for two machines running different code.
  const fairway = { line: [[20, 30], [21, 30]], cells: [[19, 29], [20, 29], [21, 29], [20, 30], [21, 30], [22, 30]] };
  const haven = { top: [-12, -2], dir: [0, 64], w0: 1.5, open: 0.25, max: 6 };
  const step = (extra) => ({ r: 30, grid: SIZE, hold: [], relief: 1, ...extra });
  const works = { v: 1, dig: [{ cells: [[40, 40], [41, 40]], hold: [[43, 41]] }], fill: [[10, 10], [11, 10]], haven: { top: [20, 30], dir: [0, 64], w0: 1.5, open: 0.25, max: 6, from: 0 } };
  const ground = (grow, w) => makeTerrain(SEED, { size: SIZE, fairway, works: w, grow }).hash;
  const plain = { base: 32, steps: [step({})] };
  const wet = { base: 32, steps: [step({ water: 1, lane: [[-2, 20], [-1, 20]], ponds: [[5, -20]], haven })] };
  assert.notEqual(ground(plain, null), ground(wet, null), 'the water step draws the same ground as none, so it proves nothing here');
  assert.notEqual(ground(wet, null), ground(wet, works), 'the works move no corner, so they prove nothing here');

  const v = village();
  v.grow = wet;
  v.fairway = fairway;
  v.works = works;
  v.island.terrainHash = ground(wet, works);
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.grow.steps[0], wet.steps[0], 'the step lost part of what it decided on the way out');
  assert.deepEqual(packed.works, works, 'the works were not packed whole');
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);

  // A step from before `water`, and an island without works, stay exactly what they were.
  const w = village();
  w.grow = plain;
  w.fairway = fairway;
  w.island.terrainHash = ground(plain, null);
  const old = buildBundle({ config, village: w, keeper: 'Martijn' });
  assert.equal('water' in old.grow.steps[0], false);
  assert.equal('lane' in old.grow.steps[0], false);
  assert.equal(old.works, null);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(old))), old);

  // And a rule this code does not draw is refused rather than drawn as something else.
  assert.throws(() => parseBundle(mutated((x) => { x.grow = { base: 32, steps: [step({ water: 2 })] }; })), Error);
});

test('earthworks and a funnel this code cannot read are refused, not repaired', () => {
  const fairway = { line: [[20, 30], [21, 30]], cells: [[19, 29], [20, 29], [21, 29], [20, 30], [21, 30], [22, 30]] };
  const works = { v: 1, dig: [{ cells: [[40, 40]], hold: [] }], fill: [], haven: { top: [20, 30], dir: [0, 64], w0: 1.5, open: 0.25, max: 6, from: 0 } };
  const wire = (change) => mutated((x) => {
    x.fairway = fairway;
    x.works = change(JSON.parse(JSON.stringify(works)));
    x.island.terrainHash = makeTerrain(SEED, { size: SIZE, fairway, works: null }).hash;
  });
  // The well-formed record gets as far as the hash check (it moves ground the hash above does
  // not have), which is a refusal of a different kind: it was read.
  assert.throws(() => parseBundle(wire((w) => w)), /hashes/);
  // Asked for and nothing to plan is a null that stays a null.
  const none = village();
  none.fairway = fairway;
  none.works = { v: 1, haven: null };
  none.island.terrainHash = makeTerrain(SEED, { size: SIZE, fairway, works: none.works }).hash;
  const asked = buildBundle({ config, village: none, keeper: 'Martijn' });
  assert.deepEqual(asked.works, { v: 1, haven: null });
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(asked))), asked);
  for (const [what, change] of Object.entries({
    'an unknown field': (w) => ({ ...w, pools: [] }),
    'another version': (w) => ({ ...w, v: 2 }),
    'no version': (w) => { delete w.v; return w; },
    'a dig with a field it does not have': (w) => { w.dig[0].why = 'x'; return w; },
    'a dug cell off the grid': (w) => { w.dig[0].cells = [[SIZE, 1]]; return w; },
    'a funnel with a field it does not have': (w) => { w.haven.colour = 'red'; return w; },
    'a funnel without from': (w) => { delete w.haven.from; return w; },
    'a fractional w0': (w) => { w.haven.w0 = 1.3; return w; },
    'an opening that is not in 64ths': (w) => { w.haven.open = 0.3; return w; },
    'a funnel wider than any': (w) => { w.haven.max = 40; return w; },
    'a funnel narrower at sea than at its head': (w) => { w.haven.max = 1; return w; },
    'no direction': (w) => { w.haven.dir = [0, 0]; return w; },
    'a head off the grid': (w) => { w.haven.top = [SIZE, 3]; return w; },
  })) assert.throws(() => parseBundle(wire(change)), (err) => !/hashes/.test(err.message), `${what} was accepted`);
});

test('a stone quay sails whole, and one this code cannot draw is refused', () => {
  // `works.kade` (fase 3 of Plans/quay-en-rivier.md) sets the ground under it and round it, so it
  // decides the hash like a dig: a bundle that dropped it would draw another island.
  const fairway = { line: [[20, 30], [21, 30]], cells: [[19, 29], [20, 29], [21, 29], [20, 30], [21, 30], [22, 30]] };
  const cells = [];
  for (let z = 10; z <= 20; z++) for (let x = 40; x <= 42; x++) cells.push([x, z]);
  const works = { v: 1, dig: [{ cells: [[38, 12], [39, 12]], hold: [] }], haven: { top: [20, 30], dir: [0, 64], w0: 1.5, open: 0.25, max: 6, from: 0 }, kade: { cells, level: 113, back: [1, 0], hold: [[44, 12]] } };
  const ground = (w) => makeTerrain(SEED, { size: SIZE, fairway, works: w }).hash;
  assert.notEqual(ground(works), ground({ ...works, kade: null }), 'the quay moves no corner, so it proves nothing here');
  const v = village();
  v.fairway = fairway;
  v.works = works;
  v.island.terrainHash = ground(works);
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.works.kade, works.kade, 'the quay was not packed whole');
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);
  const wire = (change) => mutated((x) => {
    x.fairway = fairway;
    x.works = change(JSON.parse(JSON.stringify(works)));
    x.island.terrainHash = ground(works);
  });
  for (const [what, change] of Object.entries({
    'a quay with a field it does not have': (w) => { w.kade.wall = 1; return w; },
    'a quay at a height off the 256ths': (w) => { w.kade.level = 113.5; return w; },
    'a quay with the land on a slant': (w) => { w.kade.back = [1, 1]; return w; },
    'a quay with no cells': (w) => { w.kade.cells = []; return w; },
    'a quay off the grid': (w) => { w.kade.cells = [[SIZE, 3]]; return w; },
  })) assert.throws(() => parseBundle(wire(change)), (err) => !/hashes/.test(err.message), `${what} was accepted`);
});

test('parseBundle refuses a size it cannot draw', () => {
  for (const bad of [0, 1e9, '64', 64.5, null, NaN]) {
    assert.throws(() => parseBundle(mutated((w) => { w.island.gridSize = bad; })), Error, `gridSize ${String(bad)} was accepted`);
  }
  // Two names for one number, and a bundle that disagrees with itself about it would draw
  // two different islands.
  assert.throws(() => parseBundle(mutated((w) => { w.grid.size = 32; })), /agree with itself/);
});

test('parseBundle refuses more than an island holds', () => {
  const houses = (n) => mutated((w) => {
    const one = w.buildings[0];
    w.buildings = Array.from({ length: n }, (_, i) => ({ ...one, id: `house:s${i}` }));
  });
  assert.equal(CAPS.buildings, 5000);
  assert.throws(() => parseBundle(houses(CAPS.buildings + 1)), /more than the 5000/);
  // And the one from the brief, which is far enough over that it is refused whichever
  // guard gets there first.
  assert.throws(() => parseBundle(houses(10000)), Error);

  for (const [field, cap] of [['districts', CAPS.districts], ['paths', CAPS.paths], ['props', CAPS.props], ['crops', CAPS.crops]]) {
    const over = mutated((w) => { w[field] = Array.from({ length: cap + 1 }, () => w[field][0] || {}); });
    assert.throws(() => parseBundle(over), new RegExp(`more than the ${cap}`), `${field} was not capped`);
  }
});

// The sea is redeployed before an islander sends more (SENT, lib/islandbundle.mjs): a sea one
// release behind refuses a whole island one building past its cap, so nothing may be sent that
// the caps the sea accepts do not hold, and a village as big as Hoogezand (962 buildings, 408
// paths in October 2026) has to be taken whole by the sea in this release.
test('an islander never sends more than a sea accepts, and the sea takes a village past 600', () => {
  for (const [k, cap] of Object.entries(SENT)) assert.ok(cap <= CAPS[k], `${k}: sends ${cap}, a sea takes ${CAPS[k]}`);
  for (const k of Object.keys(CAPS)) assert.ok(k in SENT, `${k} has no sending cap`);
  const big = mutated((w) => {
    const one = w.buildings[0];
    w.buildings = Array.from({ length: 1000 }, (_, i) => ({ ...one, id: `house:s${i}` }));
    w.paths = Array.from({ length: 450 }, (_, i) => ({ ...w.paths[0], id: `path:house:s${i}` }));
  });
  const got = parseBundle(big);
  assert.equal(got.buildings.length, 1000);
  assert.equal(got.paths.length, 450);
});

test('a village past what it may send is cut, and buildBundle says what it cut', () => {
  const v = village();
  const one = v.buildings[0];
  v.buildings = [...Array.from({ length: SENT.buildings + 10 }, (_, i) => ({ ...one, id: `house:fill-${i}` })), ...v.buildings];
  const out = {};
  const b = buildBundle({ config, village: v }, out);
  assert.equal(b.buildings.length, SENT.buildings);
  assert.deepEqual(out.cuts.find((c) => c.what === 'buildings'), { what: 'buildings', had: v.buildings.length, cap: SENT.buildings });
  // Every civic of the village goes first - the cut is houses and sheds.
  const civics = (list) => list.filter((x) => x.kind === 'civic').length;
  assert.ok(civics(v.buildings) > 0);
  assert.equal(civics(b.buildings), civics(v.buildings), 'a civic was cut');
  // And a village inside every cap reports nothing.
  const quiet = {};
  buildBundle({ config, village: village() }, quiet);
  assert.deepEqual(quiet.cuts, []);
});

test('parseBundle refuses an id that is trying to be a path', () => {
  for (const bad of ['../..', '../../etc/passwd', 'd:\\git\\martijn', '', 'nope!']) {
    assert.throws(() => parseBundle(mutated((w) => { w.island.id = bad; })), /island id/, `island id ${bad} was accepted`);
  }
  assert.throws(() => parseBundle(mutated((w) => { w.buildings[0].id = '../../layout.json'; })), /not one/);
  assert.throws(() => parseBundle(mutated((w) => { w.paths[0].id = 'path:../..'; })), /not one/);
});

test('parseBundle refuses a __proto__ key rather than assigning it', () => {
  // Written through JSON on purpose: an object literal would set the prototype instead of
  // making the own property that a body off the wire actually carries.
  const evil = JSON.parse(`{"__proto__":{"polluted":true},${JSON.stringify(wire()).slice(1)}`);
  assert.throws(() => parseBundle(evil), /__proto__/);
  assert.throws(() => parseBundle(JSON.parse(`{"constructor":{},${JSON.stringify(wire()).slice(1)}`)), /constructor/);
  // And one buried deep, where a whitelist that only guarded the top level would miss it.
  const buried = JSON.parse(JSON.stringify(wire()).replace('"props":[', '"props":[{"__proto__":{"x":1}},'));
  assert.throws(() => parseBundle(buried), /__proto__/);
  assert.equal({}.polluted, undefined);
});

test('parseBundle refuses text with characters that wreck a sign', () => {
  // Not an escaping problem - web/js/ui.js escapes everywhere - but a name is drawn into
  // a canvas, and one control character in it ruins the metrics of the whole sign.
  assert.throws(() => parseBundle(mutated((w) => { w.buildings[0].name = 'Loamy\u0007Forge'; })), /do not belong/);
  assert.throws(() => parseBundle(mutated((w) => { w.props[0].note = 'two\nlines'; })), /do not belong/);
  assert.throws(() => parseBundle(mutated((w) => { w.island.keeper = 'Martijn\u200b'; })), /do not belong/);
  assert.throws(() => parseBundle(mutated((w) => { w.island.name = 'x'.repeat(200); })), /do not belong/);
  // The guest strips all of that on the way out, which is why the host can refuse it.
  assert.equal(buildBundle({
    config, village: village(), props, crops, keeper: 'Mar\u0007tijn',
  }).island.keeper, 'Martijn');
});

test('parseBundle range-checks every cell against the size the bundle declared', () => {
  assert.throws(() => parseBundle(mutated((w) => { w.cleared[0] = [999, 0]; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.cleared[0] = [0, -1]; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.paths[0].cells[1] = [64, 10]; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.buildings[0].plot.gx = 64; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.buildings[0].door = [70, 2]; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.island.town.centre = [-1, 32]; })), /outside 0\.\.63/);
  assert.throws(() => parseBundle(mutated((w) => { w.cleared[0] = [1]; })), /not a pair/);
  assert.throws(() => parseBundle(mutated((w) => { w.cleared[0] = { gx: 1, gz: 1 }; })), /not a pair/);
});

test('a bundle with nothing in it is still an island, and rubbish is not', () => {
  for (const bad of [null, 'island', 42, []]) {
    assert.throws(() => parseBundle(bad), /not an island/);
  }
  assert.throws(() => parseBundle(mutated((w) => { w.v = 2; })), /version/);
  assert.throws(() => parseBundle(mutated((w) => { delete w.island; })), /without an island/);
  assert.throws(() => parseBundle(mutated((w) => { delete w.grid; })), /without a grid/);
  assert.throws(() => parseBundle(mutated((w) => { w.island.seed = '1337'; })), /without a seed/);

  // An island with no houses on it yet is a perfectly good island to visit.
  const bare = mutated((w) => {
    w.buildings = []; w.districts = []; w.paths = []; w.bridges = [];
    w.cleared = []; w.props = []; w.crops = [];
  });
  const parsed = parseBundle(bare);
  assert.deepEqual(parsed.buildings, []);
  assert.equal(parsed.island.name, 'Promptholm');
});

test('buildBundle will not sail a village that has never been scanned', () => {
  // Without a terrain hash the host has nothing to compare its own land against, and the
  // whole safety of the arrangement is that comparison.
  const v = village();
  delete v.island.terrainHash;
  assert.throws(() => buildBundle({ config, village: v, props, crops }), /no terrain hash/);
  assert.throws(() => buildBundle({ config, village: null }), /no village/);
});

test('a harbour deck survives publication and carries the sea crowd without browser heights', async () => {
  const v = village();
  v.buildings[0].harbour = true;
  v.buildings[0].plot.quay = true;
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  const bundle = parseBundle(JSON.parse(JSON.stringify(packed)));
  const spec = bundle.buildings.find(b => b.harbour && b.plot?.quay);
  assert.ok(spec, 'the whitelisted plot retains its deck marker');
  const { createCrowd } = await import('../lib/crowd.mjs');
  const terrain = makeTerrain(SEED, { size: SIZE });
  const crowd = createCrowd({ id: 'quay-height', bundle, terrain });
  const resident = crowd.figures.get(spec.id);
  assert.equal(resident.y, .44, 'first wire position is on the deck');
  crowd.advance(1, 0);
  assert.equal(resident.y, .44, 'the sea keeps the resident on the deck');
});

// The harbours (Plans/DONE/vier-havens.md): what every other island draws the docks from and
// moors the boats at, so they travel - and the boat count is capped by the host, because a
// stranger's bundle asking for a hundred boats is a hundred hulls in everybody's water.
test('the harbours travel, boat counts included, and survive the round trip', () => {
  const v = village();
  v.island.harbours = [
    { side: 'n', shore: [25, 54], pier: [[25, 55], [25, 56]], boats: 2 },
    { side: 'e', shore: [40, 30], pier: [[41, 30]] },
  ];
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.island.harbours, [
    { side: 'n', shore: [25, 54], pier: [[25, 55], [25, 56]], boats: 2 },
    { side: 'e', shore: [40, 30], pier: [[41, 30]], boats: 0 },
  ]);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);
});

test('a host refuses a harbour with too many boats, no side, or no planks', () => {
  const harbour = (h) => mutated((w) => { w.island.harbours = [{ side: 'n', shore: [25, 54], pier: [[25, 55]], boats: 1, ...h }]; });
  assert.throws(() => parseBundle(harbour({ boats: 9 })), /outside 0\.\.3/);
  assert.throws(() => parseBundle(harbour({ side: 'up' })), /without a side/);
  assert.throws(() => parseBundle(harbour({ pier: [] })), /no planks/);
  assert.equal(parseBundle(harbour({})).island.harbours[0].boats, 1);
});

// The treasure statue (Plans/schatkaarten.md): `{ placed, found }`, so a visitor sees the
// same statue and the same plaque as the keeper - and can write neither.
test('the statue and its tally travel, and a village without one packs an empty count', () => {
  const v = village();
  assert.deepEqual(pack().treasure, { placed: false, found: 0 });
  v.treasure = { placed: true, found: 7 };
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.treasure, { placed: true, found: 7 });
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))), packed);
});

test('the sender clamps a broken tally and a host refuses it', () => {
  const v = village();
  v.treasure = { placed: 'yes', found: 5e9, secret: 'no' };
  const packed = buildBundle({ config, village: v, keeper: 'Martijn' });
  assert.deepEqual(packed.treasure, { placed: false, found: 999999 });   // forgiving, and nothing extra
  const t = (x) => mutated((w) => { w.treasure = x; });
  assert.throws(() => parseBundle(t({ placed: true, found: 1000000 })), /outside 0\.\.999999/);
  assert.throws(() => parseBundle(t({ placed: true, found: -1 })), /outside 0\.\.999999/);
  assert.throws(() => parseBundle(t({ placed: true, found: 1.5 })), /whole number/);
  assert.throws(() => parseBundle(t({ placed: true, found: '3' })), /whole number/);
  assert.throws(() => parseBundle(t({ placed: 1, found: 3 })), /yes or no/);
  assert.throws(() => parseBundle(t({ placed: true })), /whole number/);
  assert.throws(() => parseBundle(t({ placed: true, found: 3, note: 'x' })), /which is not something it carries/);
  assert.throws(() => parseBundle(t(null)), /not an object/);
  assert.throws(() => parseBundle(t([])), /not an object/);
});

test('a bundle from before the statue parses, and stays without one', () => {
  const old = mutated((w) => { delete w.treasure; });
  assert.equal('treasure' in parseBundle(old), false);
});
