// The volcano's guardhouse and the guards who live in it (Plans/vulkaan-in-het-midden.md,
// section 7): where it stands, how many guards there are, and what happens to that number
// as islanders come and go. No loader and no document: all of this is the sea's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOLCANO, volcanoTerrain, guardhouseSite, guardTarget, GUARDS, GUARDHOUSE_ID, isGuard,
} from '../shared/volcano.mjs';
import { volcanoBundle, parseBundle } from '../lib/islandbundle.mjs';
import { createCrowds } from '../lib/crowd.mjs';
import { createGuards, countIslanders } from '../lib/guards.mjs';
import { crowdRoster, encodeCrowd } from '../shared/settlerwire.mjs';

const terrain = volcanoTerrain();
const bundle = volcanoBundle(terrain);

test('the volcano has one guardhouse, on buildable ground clear of lava and the crater', () => {
  const houses = bundle.buildings.filter((b) => b.id === GUARDHOUSE_ID);
  assert.equal(bundle.buildings.length, 1);
  assert.equal(houses.length, 1);
  const g = houses[0];
  assert.equal(g.kind, 'civic');
  assert.equal(g.civicType, 'castle', 'drawn as a building every page already knows');
  const { gx, gz, w, d, rot } = g.plot;
  assert.deepEqual([w, d], [3, 3]);
  for (let z = gz; z < gz + 3; z++) for (let x = gx; x < gx + 3; x++) {
    assert.ok(terrain.isBuildable(x, z), `(${x}, ${z}) under the guardhouse is not buildable`);
    assert.ok(!terrain.isLava(x, z));
    const [wx, wz] = terrain.cellWorld(x, z);
    assert.ok(wx * wx + wz * wz > (terrain.crater.r + 1) ** 2, 'in the crater');
  }
  // Its door looks downhill, away from the crater, and opens onto dry ground.
  const [cx, cz] = [gx + 1.5 - terrain.half, gz + 1.5 - terrain.half];
  const out = [[0, -1], [1, 0], [0, 1], [-1, 0]][rot];
  assert.ok(out[0] * cx + out[1] * cz > 0, 'the door faces the crater');
  const step = rot === 0 ? [gx + 1, gz - 1] : rot === 1 ? [gx + 3, gz + 1] : rot === 2 ? [gx + 1, gz + 3] : [gx - 1, gz + 1];
  assert.ok(terrain.isLand(...step) && !terrain.isLava(...step));
});

test('the guardhouse is where it was: the same spot on every start, through the whitelist', () => {
  assert.deepEqual(guardhouseSite(volcanoTerrain()), guardhouseSite(terrain));
  const again = parseBundle(JSON.parse(JSON.stringify(volcanoBundle())));
  assert.deepEqual(again.buildings, bundle.buildings);
});

test('the target is base plus three an islander, capped', () => {
  assert.equal(guardTarget(0), GUARDS.BASE);
  assert.equal(guardTarget(1), GUARDS.BASE + GUARDS.PER_ISLANDER);
  assert.equal(guardTarget(6), 22);
  assert.equal(guardTarget(7), GUARDS.CAP);
  assert.equal(guardTarget(16), GUARDS.CAP);
  assert.equal(guardTarget(-3), GUARDS.BASE);
  assert.equal(GUARDS.RESPAWN_MS, 20000);
});

const isle = (live = true, hostile = false) => ({ sea: false, live, bundle: { island: { hostile } } });

test('islanders are counted, not islands: the sea\'s own, quiet ones and Codex neighbours are not', () => {
  const fleet = { all: () => [
    { sea: true, live: true, bundle: { island: { hostile: true } } },
    isle(true), isle(true), isle(false), isle(true, true),
  ] };
  assert.equal(countIslanders(fleet), 2);
});

// The real volcano and its real crowd, in a fleet whose other islands are only as much as
// countIslanders reads.
function sea() {
  let time = 1000;
  const volcano = { id: VOLCANO.id, sea: true, live: true, bundle, terrain, origin: [0, 0], half: terrain.half };
  const others = [];
  const fleet = { all: () => [volcano, ...others], get: (id) => (id === VOLCANO.id ? volcano : null) };
  const crowds = createCrowds({ now: () => time });
  const crowd = crowds.join(volcano);
  const rosters = [];
  const guards = createGuards({ fleet, crowds, now: () => time, onRoster: (c) => rosters.push(crowdRoster(c)) });
  return {
    crowd, guards, rosters, others,
    join() { const i = isle(); others.push(i); return i; },
    later(ms) { time += ms; },
  };
}

test('the first beat brings the base guards out, and each islander brings three more at once', () => {
  const s = sea();
  assert.equal(s.crowd.guards().length, 0, 'a crowd is made without guards; the controller fills it');
  s.guards.tick();
  assert.equal(s.crowd.guardsStanding(), GUARDS.BASE);
  const first = s.rosters.at(-1);
  assert.deepEqual(first, ['guard:0', 'guard:1', 'guard:2', 'guard:3']);
  s.join();
  assert.equal(s.guards.tick(), true);
  assert.equal(s.crowd.guardsStanding(), 7);
  // Appended: everybody already on the wire keeps their index.
  assert.deepEqual(s.rosters.at(-1).slice(0, 4), first);
  assert.equal(s.rosters.at(-1).length, 7);
  s.join(); s.join();
  s.guards.tick();
  assert.equal(s.crowd.guardsStanding(), 13);
  // And nothing more on a beat where nothing changed.
  const n = s.rosters.length;
  assert.equal(s.guards.tick(), false);
  assert.equal(s.rosters.length, n);
});

test('an islander going home kills nobody and hides nobody', () => {
  const s = sea();
  s.guards.tick();
  const a = s.join(), b = s.join();
  s.guards.tick();
  assert.equal(s.crowd.guardsStanding(), 10);
  a.live = false;
  s.others.splice(s.others.indexOf(b), 1);   // swept
  s.guards.tick();
  assert.equal(s.guards.target(), GUARDS.BASE);
  assert.equal(s.crowd.guardsStanding(), 10);
  for (const f of s.crowd.guards()) assert.equal(f.visible, true);
  // Coming back up to where it was is not a rise past what is standing: nobody new.
  a.live = true;
  s.guards.tick();
  assert.equal(s.crowd.guards().length, 10);
});

test('a guard who falls above the target stays down; below it he is back after twenty seconds', () => {
  const s = sea();
  s.guards.tick();
  const a = s.join();
  s.guards.tick();                           // 7 standing, target 7
  a.live = false;
  s.guards.tick();                           // 7 standing, target 4
  for (const id of ['guard:6', 'guard:5', 'guard:4']) assert.equal(s.guards.guardDied(id), true);
  assert.equal(s.crowd.guardsStanding(), 4);
  assert.equal(s.guards.pending(), 0, 'nobody is due back while there were enough');
  assert.equal(s.guards.guardDied('guard:4'), false, 'a guard cannot fall twice');
  s.guards.guardDied('guard:0');            // 3 standing, below 4
  assert.equal(s.guards.pending(), 1);
  s.later(GUARDS.RESPAWN_MS - 1); s.guards.tick();
  assert.equal(s.crowd.guardsStanding(), 3);
  s.later(1); s.guards.tick();
  assert.equal(s.crowd.guardsStanding(), 4);
  const g0 = s.crowd.figures.get('guard:0');
  assert.equal(g0.visible, true);
  assert.deepEqual(g0.pos, g0.door, 'back out of the guardhouse, at their own place');
});

test('a fallen guard is a hole in the roster, and comes back under the same id', () => {
  const s = sea();
  s.guards.tick();
  s.guards.guardDied('guard:1');
  assert.deepEqual(s.rosters.at(-1), ['guard:0', null, 'guard:2', 'guard:3']);
  const { k } = encodeCrowd(s.crowd, { half: terrain.half, slices: 1 });
  const sent = [];
  for (let i = 0; i < k.length; i += 4) sent.push(k[i]);
  assert.deepEqual(sent, [0, 2, 3], 'nobody is placed where the fallen guard stood');
  // He was below the target as he fell, so he is due back - and a rise meanwhile fills
  // only what is missing besides him, rather than bringing him out twice.
  assert.equal(s.guards.pending(), 1);
  s.join();
  s.guards.tick();
  assert.deepEqual(s.rosters.at(-1), ['guard:0', null, 'guard:2', 'guard:3', 'guard:4', 'guard:5', 'guard:6']);
  s.later(GUARDS.RESPAWN_MS); s.guards.tick();
  assert.equal(s.rosters.at(-1)[1], 'guard:1');
});

test('a rise brings a guard who fell above the target out first, rather than growing the roster', () => {
  const s = sea();
  s.guards.tick();
  const a = s.join();
  s.guards.tick();                           // 7 standing
  a.live = false;
  s.guards.tick();                           // target 4
  s.guards.guardDied('guard:2');            // 6 standing, not due back
  assert.equal(s.guards.pending(), 0);
  a.live = true;
  s.guards.tick();                           // target 7 again: one missing
  assert.equal(s.crowd.guards().length, 7);
  assert.equal(s.crowd.guardsStanding(), 7);
  assert.equal(s.rosters.at(-1)[2], 'guard:2');
});

test('guards stand apart in front of the gate, on the mountain and out of the lava', () => {
  const s = sea();
  for (let i = 0; i < 7; i++) s.join();
  s.guards.tick();
  const gs = s.crowd.guards();
  assert.equal(gs.length, GUARDS.CAP);
  const spots = new Set(gs.map((f) => f.door.map((v) => v.toFixed(2)).join(',')));
  assert.equal(spots.size, gs.length, 'two guards share a spot');
  const g = bundle.buildings[0].plot;
  const [cx, cz] = [g.gx + 1.5 - terrain.half, g.gz + 1.5 - terrain.half];
  for (const f of gs) {
    assert.ok(isGuard(f.id));
    const [gx, gz] = [Math.floor(f.door[0] + terrain.half), Math.floor(f.door[1] + terrain.half)];
    assert.ok(terrain.isLand(gx, gz) && !terrain.isLava(gx, gz), `${f.id} lives at (${gx}, ${gz})`);
    assert.ok(Math.hypot(f.door[0] - cx, f.door[1] - cz) < 3, `${f.id} stands a long way from the guardhouse`);
  }
  // And they idle like residents: a while later some of them have stepped about.
  const before = gs.map((f) => [...f.pos]);
  s.crowd.advance(200, 0);
  assert.ok(gs.some((f, i) => f.pos[0] !== before[i][0] || f.pos[1] !== before[i][1]));
});

test('an ordinary island has no guardhouse and the controller leaves it alone', () => {
  const crowds = createCrowds();
  const guards = createGuards({ fleet: { all: () => [] }, crowds });
  assert.equal(guards.tick(), false);
  assert.equal(guards.guardDied('guard:0'), false);
});
