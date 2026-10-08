// The harpoons on the sea (lib/harpoons.mjs, lib/boats.mjs tow, Plans/harpoen.md fase B): a line's state
// is passed on to everybody else only from somebody aboard its ship; a hook on a player reaches that
// player alone and only off their own island, on foot and within reach; a loose boat can be towed from
// aboard another ship, never one somebody steers, never a skiff, a step at a time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoster } from '../lib/players.mjs';
import { createHarpoons } from '../lib/harpoons.mjs';
import { createBoats } from '../lib/boats.mjs';

function setup() {
  const fleet = { all: () => [{ id: 'home', origin: [100, 0], terrain: { half: 20 } }] };
  let harpoons;
  const roster = createRoster({
    harpoon: (p, m, sendAll) => harpoons.on(p, m, sendAll),
    moorings: [{ id: 'boat:abcd', x: 0, z: 0, yaw: 0 }, { id: 'boat:efgh', x: 30, z: 0, yaw: 0 }],
  });
  harpoons = createHarpoons({ fleet, roster });
  const sent = [[], [], []];
  const conns = [0, 1, 2].map((k) => ({ id: `c${k}aabbcc`, send: (x) => sent[k].push(JSON.parse(x)), close() {} }));
  const ps = conns.map((c) => roster.attach(c, {}));
  for (const c of conns) roster.message(c, JSON.stringify({ t: 'w', on: true }));
  const say = (k, m) => roster.message(conns[k], JSON.stringify(m));
  return { roster, harpoons, sent, ps, say };
}

test('a line is passed on to the others only from somebody aboard its ship', () => {
  const { roster, sent, ps, say } = setup();
  const line = { t: 'harpoon', a: 'line', b: 'boat:abcd', i: 2, s: 'out', at: [5, 1, 6], L: 9, k: 'land' };
  say(0, line);
  assert.ok(!sent[1].some((m) => m.t === 'harpoon'), 'passed on from somebody not aboard');
  roster.boats.board('boat:abcd', ps[0].id, [0, 0]);
  say(0, line);
  const got = sent[1].find((m) => m.t === 'harpoon' && m.a === 'line');
  assert.ok(got && got.id === ps[0].id && got.k === 'land' && got.L === 9 && got.at[2] === 6);
  assert.ok(!sent[0].some((m) => m.t === 'harpoon'), 'echoed to the gunner');
  // Nonsense is dropped.
  const before = sent[1].length;
  say(0, { ...line, L: 400 });
  say(0, { ...line, i: 99 });
  say(0, { ...line, k: 'house' });
  assert.equal(sent[1].length, before, 'a bad line was passed on');
});

test('a hook reaches the hooked player alone, on foot and within reach, never on their own island', async () => {
  const { roster, sent, ps, say } = setup();
  roster.boats.board('boat:abcd', ps[0].id, [0, 0]);
  Object.assign(ps[0], { x: 0, z: 0, posed: true });
  Object.assign(ps[1], { x: 10, z: 0, posed: true, island: 'home' });
  Object.assign(ps[2], { x: 12, z: 0, posed: true });
  const hook = (who) => say(0, { t: 'harpoon', a: 'hook', b: 'boat:abcd', i: 2, who });
  hook(ps[1].id);
  const got = sent[1].find((m) => m.a === 'hooked');
  assert.ok(got && got.by === ps[0].id && got.b === 'boat:abcd');
  assert.ok(!sent[2].some((m) => m.a === 'hooked'), 'told somebody else');
  // On their own island they are safe.
  await new Promise((r) => setTimeout(r, 650));
  Object.assign(ps[1], { x: 104, z: 0 });
  sent[1].length = 0;
  hook(ps[1].id);
  assert.ok(!sent[1].some((m) => m.a === 'hooked'), 'hooked on their own island');
  // Out of reach.
  await new Promise((r) => setTimeout(r, 650));
  Object.assign(ps[2], { x: 300 });
  hook(ps[2].id);
  assert.ok(!sent[2].some((m) => m.a === 'hooked'), 'hooked out of reach');
  // Let go: only by whoever holds them.
  say(2, { t: 'harpoon', a: 'free', b: 'boat:abcd', who: ps[1].id });
  assert.ok(!sent[1].some((m) => m.a === 'free'));
  say(0, { t: 'harpoon', a: 'free', b: 'boat:abcd', who: ps[1].id });
  assert.ok(sent[1].some((m) => m.a === 'free' && m.by === ps[0].id));
});

test('a loose boat is towed from aboard another ship, a step at a time; a steered one or a skiff never', () => {
  const boats = createBoats({ moorings: [{ id: 'boat:abcd', x: 0, z: 0, yaw: 0 }, { id: 'boat:efgh', x: 30, z: 0, yaw: 0 }] });
  const me = 'aaaa-1111', other = 'bbbb-2222';
  assert.equal(boats.tow('boat:efgh', me, 'boat:abcd', 28, 0, 0), null, 'not aboard the towing ship');
  boats.board('boat:abcd', me, [0, 0]);
  const moved = boats.tow('boat:efgh', me, 'boat:abcd', 28, 0, 0.3);
  assert.deepEqual(moved, { id: 'boat:efgh', x: 28, z: 0, yaw: 0.3 });
  assert.equal(boats.tow('boat:efgh', me, 'boat:abcd', 10, 0, 0), null, 'too far in one step');
  assert.equal(boats.tow('boat:abcd', me, 'boat:abcd', 1, 0, 0), null, 'towing itself');
  // Somebody takes her helm: she is theirs, and towing her is chasing her.
  boats.board('boat:efgh', other, [28, 0]);
  assert.equal(boats.tow('boat:efgh', me, 'boat:abcd', 27.5, 0, 0), null, 'towed with somebody aboard');
  boats.take('boat:efgh', other);
  assert.equal(boats.tow('boat:efgh', me, 'boat:abcd', 27, 0, 0), null, 'towed from under her pilot');
  assert.equal(boats.tow('boat:w-cccc', me, 'boat:abcd', 1, 0, 0), null, 'a skiff');
});
