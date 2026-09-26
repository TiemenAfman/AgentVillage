// The whole recovery chain of a story animal's errand, end to end (docs/animals-wire.md,
// "Completion"; Plans/dierenverhalen.md): the islander's real lib/animal-life.mjs and
// lib/animal-store.mjs on a scratch journal, its real lib/seaclient.mjs, and a real lib/sea.mjs
// on a loopback port - with a TCP proxy between the two that can cut the line, hold it down, or
// swallow what the sea says, and a sea clock the test turns up and down.
//
// The promise, in every scenario: an encounter the sea walked becomes exactly one memory in the
// journal - never none, never two - and the animal it happened to keeps its identity, its
// relationships and every memory it had before.
//
// Synchronisation is explicit: every wait is for a condition on the journal, the sea's herd or
// the line home, with a deadline, never a sleep. The sea's clock is ours: fast while an animal
// walks (so a thirty-second errand is a couple of real seconds), nearly stopped while the line is
// down (so the grace in which the sea keeps a quiet island is not what the test measures -
// except in the one scenario that sets out to outlast it).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { createSea } = await import('../lib/sea.mjs');
const { GRACE_MS } = await import('../lib/fleet.mjs');
const { createSeaClient } = await import('../lib/seaclient.mjs');
const { createAnimalLife } = await import('../lib/animal-life.mjs');
const { rulesFor } = await import('../lib/animal-stories.mjs');
const { buildBundle, beaconId } = await import('../lib/islandbundle.mjs');
const { makeTerrain } = await import('../shared/terrain.mjs');

const R = rulesFor(1);
const TOKEN = 'c'.repeat(48);
const SIZE = 64;
const SEED = 1337;
// How much faster than real time the sea runs while an animal walks. The beat caps a herd at
// eight ticks of 0.05 s, so a 33 ms beat can keep up with twelve times.
const FAST = 12;
const TICK_MS = 33;

// ---- the world ---------------------------------------------------------------------------

// A lane of houses across the middle of a real island, each a one-cell plot with its door on
// the lane - the same island for the sea (as a bundle) and for the islander (as a village), so
// the doorsteps the story sends a hen to are ground the sea can walk her over.
function fixtureIsland() {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) {
    if (terrain.isLand(gx, mid) && terrain.isLand(gx, mid + 1) && terrain.isLand(gx, mid + 2)) lane.push([gx, mid]);
  }
  const now = Date.parse('2026-09-26T10:00:00Z');
  const names = ['Slate Mill', 'Verdant Moor', 'Nimble Barrow', 'Ashen Yarrow'];
  const buildings = [0, 3, 6, 9].map((k, i) => {
    const [gx] = lane[k];
    return {
      id: `house:h${i}`, kind: 'house', name: names[i], style: 'opus', sessionId: `s${i}`,
      active: i === 0, lastAt: new Date(now - (i === 0 ? 0 : 5 * 3600e3)).toISOString(),
      plot: { gx, gz: mid + 1, w: 1, d: 1, rot: 0 }, door: [gx, mid],
      stats: { humanTurns: 2, assistantMsgs: 10, toolCalls: 5 },
    };
  });
  const id = beaconId(4747, 'host-recovery');
  const village = {
    generatedAt: new Date(now).toISOString(),
    island: {
      name: 'Herstelholm', seed: SEED, gridSize: SIZE, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z', landing: null,
      town: { centre: [mid, mid], paved: [] }, lattice: null,
    },
    grid: { size: SIZE },
    districts: [], buildings, paths: [{ id: 'lane', cells: lane }], bridges: [],
    cleared: [], polders: [], milestones: [], active: ['house:h0'], assignments: [], stats: {},
  };
  const named = {};
  const bundle = buildBundle({ config: { islandName: 'Herstelholm', seed: SEED, port: 4747, gridSize: SIZE }, village, id, keeper: 'Tester' }, named);
  const shownOf = (real) => { for (const k in named.ids || {}) if (named.ids[k] === real) return k; return null; };
  // The garden's refusals, on the same terrain, so no test has loadConfig reach for a home.
  const check = () => ({
    terrain,
    refuse: (x, z) => {
      const gx = Math.floor(x + terrain.half), gz = Math.floor(z + terrain.half);
      if (!terrain.inGrid(gx, gz)) return 'off the island';
      if (terrain.isRiver(gx, gz)) return 'river';
      if (!terrain.isLand(gx, gz)) return 'sea';
      if (terrain.isBeach(gx, gz)) return 'sand';
      return null;
    },
  });
  return { id, terrain, village, bundle, shownOf, check, now };
}

// A clock that runs at `speed` times real time from wherever it was when the speed changed.
function steerableClock(speed = FAST) {
  let base = Date.now(), at = Date.now(), s = speed;
  const now = () => base + (Date.now() - at) * s;
  return {
    now,
    speed(next) { base = now(); at = Date.now(); s = next; },
    jump(ms) { base += ms; },
  };
}

// A TCP proxy on a loopback port, piping to the sea's. `cut` drops every connection through it
// (a network going away), `hold` refuses new ones until `release`, `mute` keeps connections open
// but swallows everything the sea sends down them (a confirmation lost on its way home), and
// `retarget` points it at a sea that came back on another port.
function createProxy(target) {
  let to = target;
  let holding = false;
  let muted = false;
  const pairs = new Set();
  const server = net.createServer((down) => {
    if (holding) { down.destroy(); return; }
    const up = net.connect(to, '127.0.0.1');
    const pair = { down, up };
    pairs.add(pair);
    down.on('data', (d) => { if (!up.destroyed) up.write(d); });
    up.on('data', (d) => { if (!muted && !down.destroyed) down.write(d); });
    const end = () => { down.destroy(); up.destroy(); pairs.delete(pair); };
    for (const s of [down, up]) { s.on('error', end); s.on('close', end); }
  });
  return {
    listen: () => new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port))),
    cut() { for (const p of [...pairs]) { p.down.destroy(); p.up.destroy(); } pairs.clear(); },
    hold() { holding = true; },
    release() { holding = false; },
    mute(on = true) { muted = on; },
    retarget(port) { to = port; },
    close: () => new Promise((res) => { for (const p of [...pairs]) { p.down.destroy(); p.up.destroy(); } server.close(() => res()); }),
  };
}

// Wait for a condition, with a deadline. The only way time passes in these tests.
async function until(pred, what, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    let ok = false;
    try { ok = !!pred(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() > end) assert.fail(`gave up waiting (${ms} ms): ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// One islander and one sea, joined through the proxy, with the first hen already arrived.
async function world(t) {
  const isle = fixtureIsland();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animal-recovery-'));
  const w = {
    isle, dir, sea: null, seaPort: 0, clock: null, proxy: null, proxyPort: 0,
    life: null, client: null, lifeNow: isle.now, work: 0,
    deliveries: [], logs: [],
  };
  w.raiseSea = async () => {
    w.clock = steerableClock(FAST);
    w.sea = createSea({ port: 0, host: '127.0.0.1', name: 'recovery sea', tickMs: TICK_MS, now: w.clock.now, log: () => {} });
    w.seaPort = (await w.sea.listen()).port;
  };
  await w.raiseSea();
  w.proxy = createProxy(w.seaPort);
  w.proxyPort = await w.proxy.listen();

  // The islander, wired exactly as serve.mjs wires it: a change posts the animals, and the one
  // message it takes from the sea goes to animalLife.complete with the line's own generation.
  w.startLife = () => {
    w.life = createAnimalLife({
      dir, now: () => w.lifeNow, check: isle.check, log: (m) => w.logs.push(m),
      onChange: (why = {}) => { if (w.client) w.client.sendAnimals({ force: !!why.again }).catch(() => {}); },
    });
  };
  w.startClient = () => {
    const c = createSeaClient({
      url: `http://127.0.0.1:${w.proxyPort}/`, islandId: isle.id, token: TOKEN,
      bundle: () => isle.bundle, animals: () => (w.life ? w.life.publicState(isle.shownOf) : null),
      log: (m) => w.logs.push(`sea: ${m}`),
    });
    c.onAnimal((m) => {
      const took = w.life ? w.life.complete(m, c.generation()) : false;
      w.deliveries.push({ ...m, current: c.generation(), took });
    });
    w.client = c;
    return c;
  };
  // The village as a scan would write it, with the working settler `work` steps further on.
  w.village = () => {
    const v = structuredClone(isle.village);
    const h = v.buildings.find((b) => b.id === 'house:h0');
    h.stats.assistantMsgs += 3 * w.work;
    h.stats.toolCalls += 2 * w.work;
    h.lastAt = new Date(w.lifeNow).toISOString();
    return v;
  };
  w.scan = () => w.life.afterScan(w.village(), { viewing: true });
  w.herd = () => w.sea.herds.get(isle.id);
  w.hen = () => { const h = w.herd(); return h ? h.walk.get('animal:1') : null; };
  w.journal = () => fs.readFileSync(path.join(dir, 'animal-events.jsonl'), 'utf8');
  w.events = () => w.journal().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  w.encountersOf = (action) => w.events().filter((e) => e.kind === 'encounter' && e.data.action === action);

  t.after(async () => {
    try { if (w.client) w.client.close(); } catch { /* going */ }
    try { if (w.life) w.life.close(); } catch { /* going */ }
    await w.proxy.close();
    try { await w.sea.close(); } catch { /* already down */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  w.startLife();
  w.scan();
  assert.equal(Object.keys(w.life.state().animals).length, 1, 'no hen arrived on the fixture island');
  w.startClient();
  await until(() => w.client.connected() && w.client.generation() === 1, 'the islander never joined the sea');
  await until(() => w.hen(), 'the hen never reached the sea');
  return w;
}

// New work, and the scans that follow it, until the hen has an errand - one activity window at
// a time, the way the reducer counts them. Returns the action.
async function errand(w) {
  for (let i = 0; i < 24; i++) {
    const pending = Object.values(w.life.state().pending);
    if (pending.length) return pending[0];
    w.lifeNow += R.window;
    w.work += 1;
    w.scan();
  }
  assert.fail('two dozen windows of work and the hen never set off');
}

const walking = (w, a) => until(() => w.hen() && w.hen().errand && w.hen().errand.id === a.id, `the sea never walked ${a.id}`);
// In the middle of it, with less than `left` seconds of the doing still to go.
const nearlyDone = (w, a, left = 2) => until(() => {
  const e = w.hen() && w.hen().errand;
  return e && e.id === a.id && e.doing && e.left < left;
}, `${a.id} never got to its last ${left} s`);
const finishedAtSea = (w, a) => until(() => w.herd() && w.herd().finished.includes(a.id), `the sea never finished ${a.id}`);
const remembered = (w, a) => until(() => w.encountersOf(a.id).length >= 1, `${a.id} never became a memory`);
const rejoined = (w, gen) => until(() => w.client.connected() && w.client.generation() === gen, `the islander never came back as generation ${gen}`);

// One ordinary errand, walked and remembered - the memory every scenario must keep.
async function aMemory(w) {
  const a = await errand(w);
  await remembered(w, a);
  await until(() => !w.hen().errand, 'the sea kept walking an errand the islander had finished');
  return a;
}

// What a scenario must leave untouched, read before it: who the hen is, what she has lived
// through so far, and how she stands with the settler the errand is for.
function before(w, a) {
  const s = w.life.state();
  const hen = s.animals['animal:1'];
  return {
    journal: w.journal(),
    identity: { id: hen.id, name: hen.name, species: hen.species, traits: hen.traits, arrivedAt: hen.arrivedAt },
    rel: hen.rel[a.resident] ? { ...hen.rel[a.resident] } : null,
    others: Object.fromEntries(Object.entries(hen.rel).filter(([k]) => k !== a.resident)),
    encounters: s.encounters,
  };
}

// And what it must end with: exactly one memory of the errand, appended after everything that
// was there; the same hen; one more visit to that settler and no other relationship touched;
// nothing left pending; and a sea that has stopped walking it.
async function exactlyOnce(w, a, was) {
  await remembered(w, a);
  const now = w.journal();
  assert.ok(now.startsWith(was.journal), 'the journal was rewritten rather than appended to');
  assert.equal(w.encountersOf(a.id).length, 1, `${a.id} is in the journal ${w.encountersOf(a.id).length} times`);
  const s = w.life.state();
  const hen = s.animals['animal:1'];
  assert.deepEqual({ id: hen.id, name: hen.name, species: hen.species, traits: hen.traits, arrivedAt: hen.arrivedAt }, was.identity, 'the hen is somebody else now');
  assert.equal(hen.rel[a.resident].visits, (was.rel ? was.rel.visits : 0) + 1, 'the visit was counted twice, or not at all');
  assert.deepEqual(Object.fromEntries(Object.entries(hen.rel).filter(([k]) => k !== a.resident)), was.others, 'another relationship changed');
  assert.equal(s.encounters, was.encounters + 1);
  assert.ok(!Object.hasOwn(s.pending, a.id), 'the errand is still pending');
  // And reopened from disk, the same story - the journal, not memory, is the truth.
  const snapshot = w.life.state();
  w.life.close();
  w.startLife();
  w.scan();
  assert.equal(w.encountersOf(a.id).length, 1);
  assert.deepEqual(w.life.state().animals['animal:1'].rel, snapshot.animals['animal:1'].rel, 'the journal does not say what memory said');
  await until(() => !w.hen() || !w.hen().errand || w.hen().errand.id !== a.id, 'the sea kept walking a remembered errand');
}

// ---- the scenarios -------------------------------------------------------------------------

test('the line drops while the hen is on her way, and comes back before she arrives', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await walking(w, a);
  const was = before(w, a);
  // Nearly stopped, so she is still on her way when the islander is back.
  w.clock.speed(0.05);
  w.proxy.cut();
  await rejoined(w, 2);
  await until(() => w.herd().genOf.get(a.id) === 2, 'the errand was not posted again on the new line');
  assert.equal(w.encountersOf(a.id).length, 0, 'remembered before it happened');
  w.clock.speed(FAST);
  await exactlyOnce(w, a, was);
  const took = w.deliveries.filter((d) => d.action === a.id && d.took);
  assert.equal(took.length, 1);
  assert.equal(took[0].gen, 2, 'the done that counted was not the new line\'s');
});

test('the line drops and the sea finishes the errand while the islander is away', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await nearlyDone(w, a);
  const was = before(w, a);
  const herd = w.herd();
  w.proxy.hold();
  w.proxy.cut();
  await finishedAtSea(w, a);
  // Away, but not for the grace: the sea keeps the island and remembers what it finished.
  w.clock.speed(0.05);
  w.proxy.release();
  await rejoined(w, 2);
  await exactlyOnce(w, a, was);
  assert.equal(w.herd(), herd, 'the island was swept while its islander was away for seconds');
  const took = w.deliveries.filter((d) => d.action === a.id && d.took);
  assert.deepEqual(took.map((d) => d.gen), [2], 'the errand was not answered again on the new line');
});

test('the islander is away past the grace: the herd is swept, walked again, and still remembered once', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await walking(w, a);
  const was = before(w, a);
  w.proxy.hold();
  w.proxy.cut();
  await until(() => !w.client.connected(), 'the line never went down');
  await until(() => w.sea.fleet.get(w.isle.id).live === false, 'the sea never noticed the islander had gone');
  // Explicitly past the grace, and the sweep that follows it.
  w.clock.jump(GRACE_MS + 1000);
  w.sea.sweep();
  assert.equal(w.sea.herds.has(w.isle.id), false, 'the sweep left the herd');
  w.proxy.release();
  await rejoined(w, 2);
  await until(() => w.hen(), 'the hen never came back to the sea');
  await exactlyOnce(w, a, was);
});

test('the sea restarts in the middle of the encounter', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await nearlyDone(w, a, 6);
  const was = before(w, a);
  const oldSea = w.sea;
  await oldSea.close();
  // A new sea on a new port: nothing of the old one survives - it writes nothing down.
  await w.raiseSea();
  w.proxy.retarget(w.seaPort);
  w.proxy.cut();
  await rejoined(w, 2);
  await until(() => w.hen() && w.hen().errand && w.hen().errand.id === a.id, 'the new sea was never given the errand');
  assert.equal(w.encountersOf(a.id).length, 0, 'an errand the old sea never finished was remembered');
  await exactlyOnce(w, a, was);
});

test('the islander restarts with the encounter still open', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await walking(w, a);
  const was = before(w, a);
  // Down hard: the line and the journal closed, the process as good as gone.
  w.client.close();
  w.client = null;
  w.life.close();
  w.life = null;
  // A lock left behind by a crash, naming a process that no longer runs.
  fs.writeFileSync(path.join(w.dir, 'animal-store.lock'), JSON.stringify({ pid: 2147483646 }));
  // And back: the scan first, as serve.mjs does, then the line home - generation 1 again.
  w.startLife();
  w.scan();
  assert.equal(w.life.enabled(), true, `the journal did not open again: ${w.life.error()}`);
  assert.ok(Object.hasOwn(w.life.state().pending, a.id), 'the open errand was lost in the restart');
  w.startClient();
  await rejoined(w, 1);
  await exactlyOnce(w, a, was);
});

test('the islander restarts after the sea finished the errand, and hears of it again', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await nearlyDone(w, a);
  const was = before(w, a);
  w.clock.speed(FAST);
  w.client.close();
  w.client = null;
  w.life.close();
  w.life = null;
  await finishedAtSea(w, a);
  w.clock.speed(0.05);
  w.startLife();
  w.scan();
  w.startClient();
  await rejoined(w, 1);
  await exactlyOnce(w, a, was);
});

test('the encounter is done but the confirmation is lost on its way home', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await nearlyDone(w, a);
  const was = before(w, a);
  // The line stays up - the sea still counts the islander as there - but nothing it says arrives.
  w.proxy.mute();
  await finishedAtSea(w, a);
  // Told, and lost: a done went down a line that delivered nothing.
  await until(() => w.herd().genOf.size === 0, 'the sea never let go of the finished errand');
  assert.equal(w.deliveries.filter((d) => d.action === a.id).length, 0, 'the swallowed done arrived');
  assert.equal(w.encountersOf(a.id).length, 0);
  // The line then dies of it, as a line that has gone quiet does, and comes back.
  w.clock.speed(0.05);
  w.proxy.mute(false);
  w.proxy.cut();
  await rejoined(w, 2);
  await exactlyOnce(w, a, was);
  assert.deepEqual(w.deliveries.filter((d) => d.action === a.id && d.took).map((d) => d.gen), [2]);
});

test('the journal cannot write the memory, and the islander recovers without a restart', async (t) => {
  const w = await world(t);
  await aMemory(w);
  const a = await errand(w);
  await nearlyDone(w, a);
  const was = before(w, a);
  // The disk refuses the next line: the journal's name is a directory for a moment, the way
  // tests/animal-stories.test.mjs makes an append fail.
  const file = path.join(w.dir, 'animal-events.jsonl');
  fs.renameSync(file, `${file}.aside`);
  fs.mkdirSync(file);
  await until(() => w.deliveries.some((d) => d.action === a.id), 'the done never arrived');
  assert.equal(w.deliveries.find((d) => d.action === a.id).took, false, 'a memory was taken that could not be written');
  // The disk is back. Nothing restarts: the next scan is all the islander gets.
  fs.rmdirSync(file);
  fs.renameSync(`${file}.aside`, file);
  w.lifeNow += 1000;
  w.scan();
  await exactlyOnce(w, a, was);
});

test('an old or a repeated confirmation counts for nothing', async (t) => {
  const w = await world(t);
  const first = await aMemory(w);
  const a = await errand(w);
  await remembered(w, a);
  await until(() => !w.hen().errand, 'the sea kept walking');
  const journal = w.journal();
  const state = w.life.state();
  const gen = w.client.generation();
  // The same errand posted again, as a stale islander would: the sea answers it from memory -
  // once under the current generation, once under an old one - and both reach the islander.
  const body = w.life.publicState(w.isle.shownOf);
  const repost = (g, action) => fetch(`http://127.0.0.1:${w.seaPort}/island/${w.isle.id}/animals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Island-Token': TOKEN },
    body: JSON.stringify({ ...body, gen: g, actions: [{ id: action.id, animal: action.animal, act: action.act, dur: action.dur, to: action.to, look: action.look }] }),
  });
  for (const [g, action] of [[gen, a], [gen - 1, a], [gen, first]]) {
    const n = w.deliveries.length;
    assert.equal((await repost(g, action)).status, 200);
    await until(() => w.deliveries.length > n && w.deliveries.some((d, i) => i >= n && d.action === action.id && d.gen === g), `the sea never answered ${action.id} under ${g}`);
  }
  // And one straight into the islander, twice.
  assert.equal(w.life.complete({ action: a.id, gen }, gen), false);
  assert.equal(w.life.complete({ action: a.id, gen: gen - 1 }, gen), false);
  for (const action of [first, a]) {
    const heard = w.deliveries.filter((d) => d.action === action.id);
    assert.ok(heard.length >= 2, `${action.id} was only ever heard once, so nothing was repeated`);
    assert.equal(heard.filter((d) => d.took).length, 1, `${action.id} was taken ${heard.filter((d) => d.took).length} times`);
  }
  assert.equal(w.journal(), journal, 'a repeated or old done changed the journal');
  assert.deepEqual(w.life.state(), state);
  assert.equal(w.encountersOf(a.id).length, 1);
  assert.equal(w.encountersOf(first.id).length, 1);
});
