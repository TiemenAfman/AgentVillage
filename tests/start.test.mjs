// Where somebody with no island begins (Plans/start-op-land.md, shared/start.mjs): a free
// starter's square first, then an islet by an islander's island, then one by the volcano -
// always on dry ground, with water deep enough for the skiff off it - and what happens to
// them when the starter they stand on is taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startTarget, starterSpot, isletSpot, isStarterRow, SKIFF_DEPTH } from '../shared/start.mjs';
import { isletHeight } from '../shared/islets.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { createFleet } from '../lib/fleet.mjs';
import { starterId, STARTER } from '../lib/islandbundle.mjs';
import { island as newcomer, afloat, post, talk, until, SEA_V } from './support/sea.mjs';

const TOKEN = 'a'.repeat(48);
const HOME = [{ half: 32, origin: [3000, 3000] }];   // a berth of our own, out of the way
const rowsOf = (f) => f.manifest().islands;

test('the page knows a starter by the row\'s flag, or by the id a sea from before that gives it', () => {
  const f = createFleet();
  f.raiseVolcano();
  f.raiseStarters();
  const rows = rowsOf(f);
  assert.equal(rows.filter((r) => r.starter === true).length, STARTER.free);
  for (const slot of [0, 7, 4095]) assert.ok(isStarterRow({ id: starterId(slot) }), `starterId(${slot}) is not read as a starter`);
  assert.ok(!isStarterRow(rows.find((r) => r.volcano)), 'the volcano read as a starter');
  assert.ok(!isStarterRow({ id: 'abcdef0123456789' }));
});

test('a free starter comes first, the highest slot - the one a newcomer takes last - for everybody', () => {
  const f = createFleet();
  f.raiseVolcano();
  f.raiseStarters();
  const target = startTarget(rowsOf(f), { extra: HOME });
  assert.equal(target.kind, 'starter');
  assert.equal(target.row.id, starterId(STARTER.free - 1));
  // A sea from before the flag: the same answer from the ids alone.
  const bare = rowsOf(f).map(({ starter, ...r }) => r);
  assert.equal(startTarget(bare, { extra: HOME }).row.id, starterId(STARTER.free - 1));
});

test('on a starter: on its square, and the skiff in water deep enough off its shore', async () => {
  const f = createFleet();
  f.raiseVolcano();
  f.raiseStarters();
  const target = startTarget(rowsOf(f), { extra: HOME });
  const s = f.get(target.row.id);
  const [ox, oz] = s.origin;
  const [cx, cz] = s.bundle.island.town.centre;
  for (const who of ['a', 'b', 'wanderer', 'k3x9q']) {
    const spot = starterSpot(target.row, s.terrain, s.bundle, who);
    assert.deepEqual(spot, starterSpot(target.row, s.terrain, s.bundle, who), 'not the same answer twice');
    const [lx, lz] = [spot.stand[0] - ox, spot.stand[1] - oz];
    const [gx, gz] = [Math.floor(lx + s.terrain.half), Math.floor(lz + s.terrain.half)];
    assert.ok(Math.abs(gx - cx) <= 2 && Math.abs(gz - cz) <= 2, `${who} stands off the square at ${gx},${gz}`);
    assert.ok(!(gx === cx && gz === cz) && !(gx === cx + 1 && gz === cz + 1), `${who} stands in the well or the tables`);
    assert.ok(s.terrain.worldHeight(lx, lz) > 0, `${who} stands in the water`);
    const [bx, bz] = [spot.skiff[0] - ox, spot.skiff[1] - oz];
    assert.ok(s.terrain.worldHeight(bx, bz) <= SKIFF_DEPTH, `${who}'s skiff lies aground`);
  }
});

test('with no starter free: the islet nearest an islander\'s island, never the volcano\'s', () => {
  const f = createFleet();
  f.raiseVolcano();
  const a = newcomer();
  f.publish(a.id, a.bundle, { token: TOKEN, live: true });
  const rows = rowsOf(f);
  const target = startTarget(rows, { extra: HOME });
  assert.equal(target.kind, 'islet');
  assert.equal(target.near.id, a.id);
  const [ox, oz] = f.get(a.id).origin;
  const d = (i) => Math.hypot(i.x - ox, i.z - oz);
  const volcanoIslet = startTarget(rows.filter((r) => r.volcano), { extra: HOME }).islet;
  assert.ok(d(target.islet) <= d(volcanoIslet), 'an islet nearer the volcano was taken');
  assert.deepEqual(startTarget(rows, { extra: HOME }), target, 'not the same answer twice');
});

test('with nobody but the volcano: an islet by the volcano; with nothing at all, by the middle', () => {
  const f = createFleet();
  f.raiseVolcano();
  const target = startTarget(rowsOf(f), { extra: HOME });
  assert.equal(target.kind, 'islet');
  assert.ok(target.near && target.near.volcano);
  assert.equal(startTarget([], { extra: HOME }).kind, 'islet');
});

test('on an islet: dry ground clear of every palm trunk, and the skiff in its shoal', () => {
  const f = createFleet();
  f.raiseVolcano();
  const { islet } = startTarget(rowsOf(f), { extra: HOME });
  for (const who of ['a', 'b', 'wanderer', 'k3x9q']) {
    const spot = isletSpot(islet, who);
    assert.ok(spot, `${who} found nowhere to stand on ${islet.id} (${islet.kind})`);
    const [lx, lz] = [spot.stand[0] - islet.x, spot.stand[1] - islet.z];
    assert.ok(isletHeight(islet, lx, lz) > 0.1, `${who} stands in the water`);
    for (const p of islet.palms) assert.ok(Math.hypot(lx - p.x, lz - p.z) > 0.6 * p.s + 0.5, `${who} stands in a palm`);
    const [bx, bz] = [spot.skiff[0] - islet.x, spot.skiff[1] - islet.z];
    assert.ok(isletHeight(islet, bx, bz) <= SKIFF_DEPTH, `${who}'s skiff lies aground`);
  }
});

test('every islet there is has somewhere to stand', async () => {
  const { candidate, isletById } = await import('../shared/islets.mjs');
  let seen = 0;
  for (let i = -20; i < 20; i++) for (let j = -20; j < 20; j++) {
    if (!candidate(i, j)) continue;
    seen++;
    const islet = isletById(`islet:${i}:${j}`);
    assert.ok(isletSpot(islet, 'x'), `${islet.id} (${islet.kind}, r ${islet.r}) has nowhere to stand`);
  }
  assert.ok(seen > 100);
});

test('a wanderer on a starter that is settled is told so, and their skiff is laid off the newcomer\'s coast', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const first = sea.fleet.get(starterId(0));
    const phone = talk(wsUrl);
    await phone.ready;
    phone.say({ t: 'join', v: SEA_V });
    await phone.until((m) => m.t === 'welcome');
    const [ox, oz] = first.origin;
    // Moored a few cells off the square - on what will be the newcomer's ground.
    const [sx, sz] = first.terrain.cellWorld(...first.bundle.island.town.centre);
    phone.say({ t: 'boat', id: '', a: 'launch', x: ox + sx + 4, z: oz + sz, yaw: 0 });
    const skiff = await phone.until((m) => m.t === 'boat' && m.pilot);
    phone.say({ t: 'boat', id: skiff.id, a: 'drop' });
    phone.say({ t: 'p', x: ox + sx, y: 1, z: oz + sz, yaw: 0 });
    await until(() => sea.roster.all().some((p) => p.posed && Math.abs(p.x - (ox + sx)) < 0.01), 'the phone never stood on the square');

    const a = newcomer();
    await post(base, `/island/${a.id}`, a.bundle, TOKEN);
    const sent = await phone.until((m) => m.t === 'evicted', 60);
    assert.equal(sent.boat, skiff.id);
    assert.equal(sent.why, 'settled');
    assert.equal(sent.island, first.bundle.island.name);
    assert.equal(sent.by, a.bundle.island.name);
    const took = sea.fleet.get(a.id);
    const [nx, nz] = took.origin;
    const out = Math.max(Math.abs(sent.x - nx), Math.abs(sent.z - nz));
    assert.ok(out > took.half + 1, `put back in a skiff ${out} from the newcomer's middle, inside its ${took.half}`);
    const lying = sea.roster.boats.snapshot().find((b) => b.id === skiff.id);
    assert.ok(Math.abs(lying.x - sent.x) < 1e-9 && Math.abs(lying.z - sent.z) < 1e-9, 'the sea has the skiff somewhere else');
    // And it is water there: the newcomer's own ground, read in its own frame.
    assert.ok(took.terrain.worldHeight(sent.x - nx, sent.z - nz) < 0, 'the skiff lies on the newcomer\'s land');
    phone.close();
  }, { starters: true });
});
