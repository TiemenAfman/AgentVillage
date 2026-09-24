// Every islander's Codex settlers, housed on the volcano (Plans/vulkaan-in-het-midden.md,
// section 8): what an islander may send, where the sea puts each house, who lives in the
// guardhouse when the plots run out, and - the part with teeth - that one islander's list
// changing touches nobody else's settlers and none of the guards. No loader and no document:
// all of this is the sea's and the islander's, never the page's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOLCANO, CODEX, CODEX_TIERS, GUARDHOUSE_ID, GUARDHOUSE_REACH, volcanoTerrain, guardhouseSite, codexPlots, codexId, isCodex,
} from '../shared/volcano.mjs';
import { volcanoBundle, packCodex, parseCodex, parseBundle } from '../lib/islandbundle.mjs';
import { createCrowds } from '../lib/crowd.mjs';
import { createGuards } from '../lib/guards.mjs';
import { createResidents } from '../lib/residents.mjs';
import { crowdRoster } from '../shared/settlerwire.mjs';

const terrain = volcanoTerrain();
const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

const entry = (n, extra = {}) => ({ id: `house:s${n}`, style: 'unknown', tier: 'hut', kind: 'house', active: false, ...extra });
const settlers = (n, from = 0, extra = {}) => Array.from({ length: n }, (_, i) => entry(from + i, extra));

// ---- the door's two halves ------------------------------------------------------------

test('a Codex list is refused whole for anything a packer would never have sent', () => {
  const ok = { settlers: settlers(3) };
  assert.equal(parseCodex(ok).settlers.length, 3);
  assert.deepEqual(parseCodex({ settlers: [] }), { settlers: [] }, 'an empty list is a real answer');

  const refused = [
    null, [], 'house:s1', { settlers: 'three' }, {},
    { settlers: settlers(1), keeper: 'Martijn' },                                     // a field nobody named
    { settlers: settlers(CODEX.PER_ISLANDER + 1) },                                   // over the cap
    { settlers: [entry(1), entry(1)] },                                               // twice
    { settlers: [{ ...entry(1), title: 'Herschrijf scopepagina' }] },                 // a prompt
    { settlers: [{ ...entry(1), cwd: 'D:\\git\\LogViewer' }] },                       // a path
    { settlers: [entry(1, { active: 1 })] },                                          // a number for yes
    { settlers: [entry(1, { active: 'true' })] },
    { settlers: [entry(1, { style: 7 })] },                                           // a number for a word
    { settlers: [entry(1, { tier: 'palace' })] },                                     // nothing anybody can build
    { settlers: [entry(1, { kind: 'civic' })] },
    { settlers: [{ ...entry(1), id: 'house:019e170a-3f73-7c23-8973-d4bf334cfe1c' }] }, // a session uuid
    { settlers: [{ ...entry(1), id: 'p:d:\\git\\agentvillage' }] },                   // a raw district id
    { settlers: [{ ...entry(1), id: 42 }] },
    { settlers: [{ id: 'house:s1', style: 'unknown', tier: 'hut', kind: 'house' }] }, // missing `active`
  ];
  for (const body of refused) assert.throws(() => parseCodex(body), `${JSON.stringify(body)?.slice(0, 80)} got in`);
  // Parsed rather than written, because `__proto__:` in source sets a prototype.
  assert.throws(() => parseCodex(JSON.parse('{"settlers":[],"__proto__":{"x":1}}')));
});

// A Codex village as scan.mjs writes one, with everything in it that must stay home.
function codexVillage(n = 5, { active = [] } = {}) {
  const buildings = [];
  for (let i = 0; i < n; i++) {
    const uuid = `019e170a-3f73-7c23-8973-${String(i).padStart(12, '0')}`;
    buildings.push({
      id: `house:${uuid}`, sessionId: uuid, kind: 'house', district: 'p:d:\\git\\logviewer',
      name: `Wry Furrow ${i}`, title: `Herschrijf scopepagina ${i}`, cwd: 'D:\\git\\LogViewer',
      gitBranch: 'claude/secret-branch', style: 'unknown', tier: CODEX_TIERS[i % 5],
      active: active.includes(i), startedAt: `2026-05-${String(10 + (i % 18)).padStart(2, '0')}T12:00:00.000Z`,
      lastAt: `2026-05-${String(10 + (i % 18)).padStart(2, '0')}T14:00:00.000Z`,
      plot: { gx: 10 + i, gz: 10, w: 3, d: 3, rot: 0 }, door: [11 + i, 10], sheds: [],
      stats: { tokens: { input: 1 } }, workOrders: [{ summary: 'PROJ-1 fix the thing' }],
    });
  }
  buildings.push({ id: 'civic:townhall', kind: 'civic', civicType: 'townhall', plot: { gx: 30, gz: 30, w: 3, d: 3, rot: 0 } });
  return {
    island: { name: 'Codex', seed: 7331, terrainHash: 'abcdef12' },
    districts: [{ id: 'p:d:\\git\\logviewer', root: 'D:\\git\\LogViewer', name: 'LogViewer' }],
    buildings,
  };
}

test('what an islander sends is redacted by the same pass as its bundle: no uuid, no prompt, no path', () => {
  const packed = packCodex({ village: codexVillage(8, { active: [5] }) });
  const text = JSON.stringify(packed);
  assert.equal(packed.settlers.length, 8, 'the town hall is not a settler; every house is');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(text), `a uuid went out: ${text}`);
  for (const secret of ['Herschrijf', 'LogViewer', 'logviewer', 'secret-branch', 'git', 'PROJ-1', 'Wry Furrow', '\\']) {
    assert.ok(!text.includes(secret), `"${secret}" went out`);
  }
  // Under the names a bundle would give them, and only the five fields.
  for (const s of packed.settlers) {
    assert.match(s.id, /^house:s\d+$/);
    assert.deepEqual(Object.keys(s).sort(), ['active', 'id', 'kind', 'style', 'tier']);
  }
  assert.deepEqual(packed.settlers.map((s) => s.id), [...packed.settlers.map((s) => s.id)].sort(), 'not in a stable order');
  assert.equal(packed.settlers.find((s) => s.active).id, 'house:s5');
  // And the sea takes exactly what the islander packs.
  assert.deepEqual(parseCodex(JSON.parse(text)), packed);
});

test('an islander with more Codex settlers than the cap sends the busiest and the newest', () => {
  const packed = packCodex({ village: codexVillage(CODEX.PER_ISLANDER + 20, { active: [0] }) });
  assert.equal(packed.settlers.length, CODEX.PER_ISLANDER);
  assert.ok(packed.settlers.some((s) => s.id === 'house:s0' && s.active), 'the one at work was left behind');
  assert.doesNotThrow(() => parseCodex(packed));
  // Nothing to pack is an empty list, not a crash.
  assert.deepEqual(packCodex({ village: null }), { settlers: [] });
  assert.deepEqual(packCodex({ village: { buildings: [] } }), { settlers: [] });
});

// ---- the plots --------------------------------------------------------------------------

test('the plots are buildable lots on the flank, clear of the guardhouse, the crater and each other', () => {
  const pool = codexPlots(terrain);
  assert.ok(pool.length >= 120, `only ${pool.length} plots`);
  assert.deepEqual(codexPlots(volcanoTerrain()), pool, 'not the same plots on a second start');
  const gh = guardhouseSite(terrain).plot;
  const cells = new Set();
  for (const { plot, door } of pool) {
    for (let z = plot.gz; z < plot.gz + 3; z++) for (let x = plot.gx; x < plot.gx + 3; x++) {
      assert.ok(terrain.isBuildable(x, z) && !terrain.isLava(x, z), `(${x}, ${z}) is not building ground`);
      assert.ok(!cells.has(`${x},${z}`), 'two plots overlap');
      cells.add(`${x},${z}`);
      const [wx, wz] = terrain.cellWorld(x, z);
      assert.ok(wx * wx + wz * wz > terrain.crater.r ** 2, 'a plot in the crater');
    }
    const apart = plot.gx + 3 + CODEX.CLEAR <= gh.gx || gh.gx + 3 + CODEX.CLEAR <= plot.gx
      || plot.gz + 3 + CODEX.CLEAR <= gh.gz || gh.gz + 3 + CODEX.CLEAR <= plot.gz;
    assert.ok(apart, `a plot at ${plot.gx},${plot.gz} crowds the guardhouse`);
    // The door looks away from the crater and steps out onto dry ground.
    const [cx, cz] = [plot.gx + 1.5 - terrain.half, plot.gz + 1.5 - terrain.half];
    const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][plot.rot];
    assert.ok(out[0] * cx + out[1] * cz > 0, 'a door faces the crater');
    const step = [door[0] + out[0], door[1] + out[1]];
    assert.ok(terrain.isLand(...step) && !terrain.isLava(...step), `the door at ${door} steps into lava or sea`);
  }
});

// ---- the sea's side ---------------------------------------------------------------------

// The real volcano and its real crowd, the guards on it, and the residents - in a fleet whose
// other islands are only as much as the three controllers read.
function sea() {
  let time = 1000;
  const bundle = volcanoBundle(terrain);
  const volcano = { id: VOLCANO.id, sea: true, live: true, bundle, raised: bundle.buildings, terrain, origin: [0, 0], half: terrain.half };
  const fleet = {
    all: () => [volcano],
    get: (id) => (id === VOLCANO.id ? volcano : null),
    furnishVolcano: (houses) => { volcano.bundle = { ...volcano.bundle, buildings: [...volcano.raised, ...houses] }; return volcano; },
  };
  const crowds = createCrowds({ now: () => time });
  const crowd = crowds.join(volcano);
  const said = [];
  const guards = createGuards({ fleet, crowds, now: () => time });
  const residents = createResidents({ fleet, crowds, onChange: (c, houses, how) => said.push({ houses, roster: crowdRoster(c), ...how }) });
  guards.tick();
  return { volcano, crowd, crowds, guards, residents, said, later(ms) { time += ms; } };
}

const houseOf = (s, fid) => s.volcano.bundle.buildings.find((b) => b.id === fid) || null;

test('a house stands where its id hashes to, the same on every sea, and passes the whitelist', () => {
  const one = sea(), two = sea();
  one.residents.set(A, settlers(10));
  two.residents.set(A, settlers(10));
  assert.deepEqual(one.volcano.bundle.buildings, two.volcano.bundle.buildings);
  assert.equal(one.volcano.bundle.buildings.length, 11, 'the guardhouse and ten houses');
  assert.equal(one.volcano.bundle.buildings[0].id, GUARDHOUSE_ID, 'the guardhouse was lost');
  const h = houseOf(one, codexId(A, 'house:s3'));
  assert.ok(h, 'no house for house:s3');
  assert.equal(h.kind, 'house');
  assert.equal(h.tier, 'hut');
  const pool = codexPlots(terrain);
  assert.ok(pool.some((p) => p.plot.gx === h.plot.gx && p.plot.gz === h.plot.gz), 'a house off the pool');
  // What a page fetches afterwards is a bundle like any other.
  assert.doesNotThrow(() => parseBundle(JSON.parse(JSON.stringify(one.volcano.bundle))));
});

test('a house arriving or leaving never moves one that is standing', () => {
  const s = sea();
  s.residents.set(A, settlers(20));
  s.residents.set(B, settlers(20));
  const plots = () => new Map(s.volcano.bundle.buildings.filter((b) => isCodex(b.id)).map((b) => [b.id, JSON.stringify(b.plot)]));
  const before = plots();
  assert.equal(before.size, 40);
  // More for A, fewer for B.
  s.residents.set(A, settlers(30));
  s.residents.set(B, settlers(10));
  const after = plots();
  assert.equal(after.size, 40);
  for (const [fid, plot] of after) if (before.has(fid)) assert.equal(plot, before.get(fid), `${fid} moved`);
  // Two islanders with the same redacted id are two houses, on two plots.
  assert.notEqual(after.get(codexId(A, 'house:s3')), after.get(codexId(B, 'house:s3')));
});

test('when the plots run out the rest lodge in the guardhouse, and move into a house when one comes free', () => {
  const s = sea();
  const pool = codexPlots(terrain).length;
  // As many islanders as it takes to overfill the pool - six on the 192-grid volcano, whose
  // 300 plots three could fill on the 128 one - and never more bodies than the mountain
  // carries, or the wait list below would be a second thing this test measures.
  const islanders = Math.ceil((pool + 1) / CODEX.PER_ISLANDER);
  const ids = [A, B, ...'defghijk'.split('').map((c) => c.repeat(16))].slice(0, islanders - 1).concat(C);
  for (const id of ids) s.residents.set(id, settlers(CODEX.PER_ISLANDER));
  const all = islanders * CODEX.PER_ISLANDER;
  assert.ok(all > pool, 'the fixture does not fill the pool');
  assert.ok(all <= CODEX.RESIDENTS, 'the fixture has more bodies than the mountain carries');
  assert.equal(s.residents.housed(), pool);
  assert.equal(s.residents.bodies(), all, 'somebody without a house got no body');
  const lodgers = s.crowd.residents().filter((f) => !f.dead && f.spec.id === GUARDHOUSE_ID);
  assert.equal(lodgers.length, all - pool);
  const gh = s.volcano.bundle.buildings[0].plot;
  const [cx, cz] = [gh.gx + 1.5 - terrain.half, gh.gz + 1.5 - terrain.half];
  const [ox, oz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][gh.rot];
  const plots = codexPlots(terrain).map((p) => p.plot);
  for (const f of lodgers) {
    assert.ok(Math.hypot(f.home[0] - cx, f.home[1] - cz) < 5, `${f.id} lodges a long way from the guardhouse`);
    const [gx, gz] = [Math.floor(f.home[0] + terrain.half), Math.floor(f.home[1] + terrain.half)];
    assert.ok(terrain.isLand(gx, gz) && !terrain.isLava(gx, gz), `${f.id} lodges at (${gx}, ${gz})`);
    // Behind the guards, out in front of the castle rather than inside it, and never
    // wandering onto somebody's plot: a lodger idles up to 0.3 from home and is 0.16 wide.
    const out = (f.home[0] - cx) * ox + (f.home[1] - cz) * oz;
    assert.ok(out - 0.3 - 0.16 >= GUARDHOUSE_REACH, `${f.id} lodges ${out.toFixed(2)} out - inside the castle`);
    for (const p of plots) {
      const x0 = p.gx - terrain.half, z0 = p.gz - terrain.half;
      const dx = Math.max(x0 - f.home[0], 0, f.home[0] - (x0 + p.w));
      const dz = Math.max(z0 - f.home[1], 0, f.home[1] - (z0 + p.d));
      assert.ok(Math.hypot(dx, dz) >= 0.3 + 0.16, `${f.id} lodges on the plot at ${p.gx},${p.gz}`);
    }
  }
  // C goes home: every lodger left has a house now, and nobody housed before moved.
  const before = new Map(s.volcano.bundle.buildings.map((b) => [b.id, JSON.stringify(b.plot)]));
  s.residents.drop(C);
  const left = (islanders - 1) * CODEX.PER_ISLANDER;
  assert.ok(left <= pool, 'the fixture leaves lodgers even after one goes home');
  assert.equal(s.residents.bodies(), left);
  assert.equal(s.residents.housed(), left);
  for (const f of s.crowd.residents()) {
    if (f.dead) continue;
    assert.equal(f.spec.id, f.id, `${f.id} is still in the guardhouse`);
    if (before.has(f.id)) assert.equal(JSON.stringify(f.spec.plot), before.get(f.id), `${f.id} moved house`);
  }
});

test('past the bodies the mountain can carry, the rest wait in the list for somebody to leave', () => {
  const s = sea();
  const ids = 'abcdefgh'.split('').map((c) => c.repeat(16));
  for (const id of ids) s.residents.set(id, settlers(CODEX.PER_ISLANDER));
  assert.equal(s.residents.bodies(), CODEX.RESIDENTS);
  assert.equal(s.crowd.residents().filter((f) => !f.dead).length, CODEX.RESIDENTS);
  s.residents.drop(ids[0]);
  assert.equal(s.residents.bodies(), CODEX.RESIDENTS, 'the ones waiting did not come out');
});

test('one islander\'s list changing touches nobody else: not their settlers, not the guards', () => {
  const s = sea();
  s.residents.set(A, settlers(6));
  s.residents.set(B, settlers(6));
  s.crowd.advance(60, 0);
  const crowd = s.crowds.get(VOLCANO.id);
  const others = [...crowd.figures.values()].filter((f) => !isCodex(f.id) || f.id.startsWith(`codex:${A}:`));
  const bodies = new Map(others.map((f) => [f.id, f]));
  const where = new Map(others.map((f) => [f.id, [...f.pos]]));
  const indexOf = new Map(crowdRoster(crowd).map((id, i) => [id, i]));

  s.residents.set(B, [...settlers(3), ...settlers(4, 10, { active: true })]);

  assert.equal(s.crowds.get(VOLCANO.id), crowd, 'the crowd was rebuilt');
  const roster = crowdRoster(crowd);
  for (const [id, f] of bodies) {
    assert.equal(crowd.figures.get(id), f, `${id} is a different body`);
    assert.deepEqual(f.pos, where.get(id), `${id} was moved`);
    assert.equal(roster.indexOf(id), indexOf.get(id), `${id} changed number`);
  }
  // B's departures are holes, its newcomers are on the end, and they hammer.
  for (const n of [3, 4, 5]) assert.equal(roster[indexOf.get(codexId(B, `house:s${n}`))], null);
  assert.deepEqual(roster.slice(-4), [10, 11, 12, 13].map((n) => codexId(B, `house:s${n}`)));
  for (const n of [10, 11, 12, 13]) assert.equal(crowd.figures.get(codexId(B, `house:s${n}`)).mode, 'hammer');
  // And the sea was told: the houses, then a roster with the holes in it.
  const last = s.said.at(-1);
  assert.equal(last.houses.length, 13);
  assert.deepEqual(last.roster, roster);
});

test('residents are the volcano\'s like its guards, and each wears its own face', () => {
  const s = sea();
  s.residents.set(A, settlers(4));
  const res = s.crowd.residents();
  assert.equal(res.length, 4);
  // Housed at their own door, visible, and candidates for the chase exactly like a guard.
  for (const f of res) {
    assert.equal(f.spec.id, f.id);
    assert.equal(f.visible, true);
    assert.ok(Math.abs(f.home[0] - (f.spec.plot.gx + 1.5 - terrain.half)) < 1.2);
  }
  assert.equal(new Set(res.map((f) => f.stride)).size > 1, true, 'four settlers with one stride');
});

test('an islander going home takes its houses and residents off the volcano, and leaves the guards', () => {
  const s = sea();
  s.residents.set(A, settlers(5));
  s.residents.set(B, settlers(5));
  const guards = s.crowd.guardsStanding();
  s.residents.drop(A);
  assert.equal(s.residents.housed(), 5);
  assert.ok(s.volcano.bundle.buildings.every((b) => !b.id.startsWith(`codex:${A}:`)), 'a house of A is still standing');
  for (const f of s.crowd.residents()) {
    if (f.id.startsWith(`codex:${A}:`)) { assert.equal(f.dead, true); assert.equal(f.visible, false); } else assert.equal(f.dead, false);
  }
  assert.equal(s.crowd.guardsStanding(), guards);
  assert.equal(s.residents.drop(A), null, 'dropping an islander twice did something');
  // Back again: the same people, standing again under the same numbers.
  const roster = crowdRoster(s.crowd);
  s.residents.set(A, settlers(5));
  const again = crowdRoster(s.crowd);
  assert.equal(again.length, roster.length, 'coming back grew the roster');
  for (let n = 0; n < 5; n++) assert.ok(again.includes(codexId(A, `house:s${n}`)));
});

test('a month of departures is closed up rather than carried as holes', () => {
  const s = sea();
  s.residents.set(B, settlers(5));
  const guards = s.crowd.guards().map((f) => f.id);
  for (let round = 0; round < 3; round++) s.residents.set(A, settlers(CODEX.PER_ISLANDER, round * 100));
  const roster = crowdRoster(s.crowd);
  const holes = roster.filter((id) => id === null).length;
  assert.ok(holes < 64, `${holes} holes carried`);
  assert.ok(s.said.some((x) => x.renumbered), 'the sea was never told the numbers moved');
  for (const id of guards) assert.ok(roster.includes(id), `${id} was closed up`);
  for (let n = 0; n < 5; n++) assert.ok(roster.includes(codexId(B, `house:s${n}`)));
});

test('a volcano crowd somebody rebuilt gets every resident back without a word from anybody', () => {
  const s = sea();
  s.residents.set(A, settlers(3));
  s.crowds.join(s.volcano);
  assert.equal(s.crowds.get(VOLCANO.id).residents().length, 0);
  assert.equal(s.residents.tick(), true);
  assert.equal(s.crowds.get(VOLCANO.id).residents().filter((f) => !f.dead).length, 3);
});
