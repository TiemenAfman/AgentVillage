// The starters: small islands the sea puts out itself (Plans/starter-eilanden.md, step 1).
//
// What has to hold before the sea can raise one: the same slot gives the same island on
// every start (the sea writes nothing down), it is a bundle parseBundle takes like anybody
// else's, and the crowd finds an innkeeper and a mayor on it and nobody else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { starterBundle, starterId, starterName, STARTER, parseBundle, ISLAND_ID } from '../lib/islandbundle.mjs';
import { createCrowd } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { VOLCANO } from '../shared/volcano.mjs';

const island = (slot) => {
  const bundle = starterBundle(slot);
  const terrain = makeTerrain(bundle.island.seed, { size: bundle.island.gridSize });
  return { id: bundle.island.id, bundle, terrain };
};

test('a slot gives the same starter on every start, and each slot its own', () => {
  for (const slot of [0, 1, 2, 9]) {
    assert.deepEqual(starterBundle(slot), starterBundle(slot), `starter ${slot} came out different the second time`);
  }
  const ids = new Set([0, 1, 2, 3].map(starterId));
  assert.equal(ids.size, 4);
  const seeds = new Set([0, 1, 2, 3].map((s) => starterBundle(s).island.seed));
  assert.equal(seeds.size, 4, 'two starters share a coast');
});

test('a starter is an ordinary bundle: an island id, a number for a seed, nothing hostile', () => {
  const b = starterBundle(0);
  assert.match(b.island.id, ISLAND_ID);
  assert.notEqual(b.island.id, VOLCANO.id);
  assert.equal(typeof b.island.seed, 'number');
  assert.equal(b.island.hostile, false);
  assert.equal(b.island.volcano, false);
  assert.equal(b.island.gridSize, STARTER.size);
  assert.equal(b.island.room, STARTER.room, 'the berth is not held for the island that takes it');
  assert.equal(b.island.landing, null, 'a starter has no boat of its own');
  assert.equal(b.island.name, starterName(0));
  // And it survives the round trip every bundle makes: out over the wire, back through the
  // whitelist on the other side.
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(b))), b);
});

test('the town stands on buildable ground, with the tavern and the town hall facing the square', () => {
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const { bundle, terrain } = island(slot);
    const [cx, cz] = bundle.island.town.centre;
    for (const b of bundle.buildings) {
      const { gx, gz, w, d } = b.plot;
      for (let z = gz; z < gz + d; z++) for (let x = gx; x < gx + w; x++) {
        assert.ok(terrain.isBuildable(x, z), `starter ${slot}: ${b.id} stands on ${x},${z}, which is not buildable`);
      }
    }
    const inn = bundle.buildings.find((b) => b.civicType === 'tavern');
    const hall = bundle.buildings.find((b) => b.civicType === 'townhall');
    assert.ok(inn.plot.gz + inn.plot.d <= cz - 2 && inn.plot.rot === 2, `starter ${slot}: the tavern is not north of the square facing it`);
    assert.ok(hall.plot.gz >= cz + 3 && hall.plot.rot === 0, `starter ${slot}: the town hall is not south of the square facing it`);
    const paved = new Set(bundle.island.town.paved.map(([x, z]) => `${x},${z}`));
    assert.ok(paved.has(`${cx},${cz - 3}`) && paved.has(`${cx},${cz + 3}`), `starter ${slot}: a door steps out onto grass`);
  }
});

test('the crowd finds an innkeeper and a mayor on a starter, and nobody else', () => {
  const crowd = createCrowd(island(0));
  const posts = [...crowd.figures.values()].map((f) => f.post || null);
  assert.deepEqual(posts.sort(), ['innkeeper', 'mayor']);
  assert.ok(crowd.figures.get('civic:tavern') && crowd.figures.get('civic:townhall'));
});

// ---- steps 2 and 3: the fleet puts them out, and a newcomer takes one's berth ----------

const { createFleet } = await import('../lib/fleet.mjs');
const { island: newcomer, afloat, post, talk, until, SEA_V } = await import('./support/sea.mjs');

const TOKEN = 'a'.repeat(48);
const clear = (a, b) => Math.abs(a.origin[0] - b.origin[0]) >= a.reach + b.reach
  || Math.abs(a.origin[1] - b.origin[1]) >= a.reach + b.reach;

test('the fleet puts out STARTER.free starters round the volcano, and no more', () => {
  const f = createFleet();
  const volcano = f.raiseVolcano();
  const raised = f.raiseStarters();
  assert.equal(raised.length, STARTER.free);
  assert.deepEqual(raised.map((s) => s.id), [0, 1, 2].map(starterId));
  for (const s of raised) {
    assert.ok(s.sea && s.starter && s.live, 'a starter is not the sea\'s');
    assert.ok(clear(s, { origin: volcano.origin, reach: volcano.half }), `${s.id} is on the volcano`);
  }
  assert.ok(clear(raised[0], raised[1]) && clear(raised[1], raised[2]) && clear(raised[0], raised[2]), 'two starters overlap');
  assert.deepEqual(f.raiseStarters(), [], 'a second call put out more');
  assert.equal(f.players(), 0, 'a starter counted as somebody\'s');
  assert.deepEqual(f.expired(Infinity), []);
  // The sea's, so nobody can wear one.
  assert.equal(f.claim(raised[0].id, TOKEN), null);
  assert.throws(() => f.vouch(raised[0].id, TOKEN), /sea's own/);
});

test('a newcomer takes the first starter\'s berth, and the next one is put out on a new slot', () => {
  const f = createFleet();
  f.raiseVolcano();
  const [first, second] = f.raiseStarters();
  const a = newcomer({ port: 4747, name: 'Promptholm' });
  const one = f.publish(a.id, a.bundle, { token: TOKEN });
  assert.deepEqual(one.origin, first.origin, 'the newcomer did not take the starter\'s berth');
  assert.equal(one.took.id, first.id);
  assert.equal(f.get(first.id), null, 'the starter is still there under the newcomer');
  assert.deepEqual(f.raiseStarters().map((s) => s.id), [starterId(3)], 'a taken slot came back');

  // Republishing keeps the berth and takes nothing more.
  const again = f.publish(a.id, a.bundle, { token: TOKEN });
  assert.deepEqual(again.origin, first.origin);
  assert.equal(again.took, undefined);
  assert.ok(f.get(second.id), 'a republish took another starter');

  const b = newcomer({ port: 4748, name: 'Tiemenholm' });
  assert.deepEqual(f.publish(b.id, b.bundle, { token: TOKEN.replace(/a/g, 'b') }).origin, second.origin);
});

test('an island asking for more room than a starter holds gets a berth of its own', () => {
  const f = createFleet();
  f.raiseVolcano();
  const raised = f.raiseStarters();
  const big = newcomer();
  big.bundle.island.room = 512;
  const one = f.publish(big.id, big.bundle, { token: TOKEN });
  assert.equal(one.took, undefined);
  for (const s of raised) assert.ok(f.get(s.id), `${s.id} made way for an island it could not hold`);
  for (const s of raised) assert.ok(clear(one, s), `the big island overlaps ${s.id}`);
});

test('starters count against the cap, and a full sea still lets a newcomer take one', () => {
  const f = createFleet({ max: 2 });
  f.raiseVolcano();
  assert.equal(f.raiseStarters().length, 2, 'more starters than places');
  const a = newcomer({ port: 4747 });
  assert.ok(f.publish(a.id, a.bundle, { token: TOKEN }).took, 'a full sea refused a newcomer a starter was waiting for');
  assert.deepEqual(f.raiseStarters(), [], 'a starter was put out past the cap');
  const b = newcomer({ port: 4748 });
  f.publish(b.id, b.bundle, { token: TOKEN.replace(/a/g, 'b') });
  const c = newcomer({ port: 4749 });
  assert.throws(() => f.publish(c.id, c.bundle, { token: TOKEN.replace(/a/g, 'c') }), /full/);
});

// ---- step 4: the sea puts them out, and says so when one makes way ---------------------

test('a sea starts with its starters, and a newcomer\'s publish retires one: gone, then joined', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const world = await (await fetch(`${base}/world`)).json();
    const ids = world.islands.map((i) => i.id);
    for (const slot of [0, 1, 2]) assert.ok(ids.includes(starterId(slot)), `starter ${slot} is not in the world`);
    assert.ok(sea.crowds.get(starterId(0)), 'a starter has no crowd');

    const watcher = talk(wsUrl);
    await watcher.ready;
    watcher.say({ t: 'join', v: SEA_V });
    await watcher.until((m) => m.t === 'welcome');

    const a = newcomer();
    const res = await post(base, `/island/${a.id}`, a.bundle, TOKEN);
    assert.equal(res.status, 200);
    const said = [];
    await watcher.until((m) => {
      if (m.t === 'island') said.push(`${m.a}:${m.id}`);
      return m.t === 'island' && m.a === 'joined' && m.id === starterId(3);
    }, 60);
    assert.deepEqual(said, [`gone:${starterId(0)}`, `joined:${a.id}`, `joined:${starterId(3)}`]);
    assert.equal(sea.crowds.get(starterId(0)), null, 'the retired starter kept its crowd');
    watcher.close();
  }, { starters: true });
});

test('whoever is walking on a starter when it makes way is put back in their skiff', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const first = sea.fleet.get(starterId(0));
    const phone = talk(wsUrl);
    await phone.ready;
    phone.say({ t: 'join', v: SEA_V });
    await phone.until((m) => m.t === 'welcome');
    // In the water off the starter, then out of the boat and onto its square.
    const [ox, oz] = first.origin;
    phone.say({ t: 'boat', id: '', a: 'launch', x: ox, z: oz - first.half - 4, yaw: 0 });
    const skiff = await phone.until((m) => m.t === 'boat' && m.pilot);
    phone.say({ t: 'boat', id: skiff.id, a: 'drop' });
    const [sx, sz] = first.terrain.cellWorld(...first.bundle.island.town.centre);
    phone.say({ t: 'p', x: ox + sx, y: 1, z: oz + sz, yaw: 0 });
    await until(() => sea.roster.all().some((p) => p.posed && Math.abs(p.x - (ox + sx)) < 0.01), 'the phone never stood on the square');

    const a = newcomer();
    await post(base, `/island/${a.id}`, a.bundle, TOKEN);
    const sent = await phone.until((m) => m.t === 'evicted', 60);
    assert.equal(sent.boat, skiff.id, 'the phone was not put back in its own skiff');
    assert.equal(sent.island, first.bundle.island.name);
    phone.close();
  }, { starters: true });
});

// ---- step 5: the phone keeps out of the room a starter holds -----------------------------

test('a phone laying its berth from the rows the sea sends keeps clear of every starter\'s room', async () => {
  const { nextOrigin, SEA_GAP } = await import('../shared/regions.mjs');
  const OPEN_HOME = 64;   // web/js/main.js
  const f = createFleet();
  f.raiseVolcano();
  f.raiseStarters();
  const rows = f.manifest().islands;
  for (const r of rows.filter((x) => x.id.startsWith('5ea5'))) assert.equal(r.reach, STARTER.room / 2, 'a row does not say what a starter holds');
  // What standaloneHome does with them.
  const placed = rows.map((i) => ({ half: i.reach ?? (i.gridSize || OPEN_HOME) / 2, origin: i.origin }));
  const home = { origin: nextOrigin(placed, OPEN_HOME / 2), reach: OPEN_HOME / 2 };
  for (const s of f.all().filter((i) => i.starter)) {
    assert.ok(Math.abs(home.origin[0] - s.origin[0]) >= home.reach + s.reach + SEA_GAP
      || Math.abs(home.origin[1] - s.origin[1]) >= home.reach + s.reach + SEA_GAP, `the phone's berth is in the room ${s.id} holds`);
  }
});
