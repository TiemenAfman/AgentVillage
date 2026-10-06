// Holding your breath (shared/breath.mjs, lib/breath.mjs, Plans/onderwater-zwemmen.md): the
// sum the page and the sea both make, who is counted as being under water, the bit the two
// keep in step, and who drowns and how the page is told. The sea's own beat and the wire are
// in tests/breath-sea.test.mjs; here the clock is a number the test moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIR_S, REFILL_S, DROWN_PER_S, HEAD, SWIMMING, submerged, stepAir } from '../shared/breath.mjs';
import { SEA_LEVEL } from '../shared/terrain.mjs';
import { createBreath } from '../lib/breath.mjs';
import { createHealth, MAX_HEALTH } from '../lib/health.mjs';
import { createRoster, POSE } from '../lib/players.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- the sum ---------------------------------------------------------------------------

test('under water the air runs down a second a second, and never below nothing', () => {
  assert.ok(near(stepAir(AIR_S, true, 1), AIR_S - 1));
  assert.ok(near(stepAir(10, true, 2.5), 7.5));
  assert.equal(stepAir(0.4, true, 1), 0);
  assert.equal(stepAir(0, true, 5), 0);
});

test('at the surface it comes back at a full lung per REFILL_S, and never above one', () => {
  const rate = AIR_S / REFILL_S;
  assert.ok(near(stepAir(0, false, 1), rate));
  assert.ok(near(stepAir(5, false, 0.5), 5 + rate / 2));
  // From nothing, REFILL_S of it is a whole lung - however the seconds are cut up.
  let air = 0;
  for (let i = 0; i < 30; i++) air = stepAir(air, false, REFILL_S / 30);
  assert.ok(near(air, AIR_S, 1e-9), `${air} after a full refill`);
  assert.equal(stepAir(AIR_S - 0.1, false, 1), AIR_S);
  assert.equal(stepAir(AIR_S, false, 10), AIR_S);
});

test('a frame that is not a positive number of seconds changes nothing', () => {
  for (const dt of [0, -1, NaN, undefined, Infinity * 0]) {
    assert.equal(stepAir(12, true, dt), 12, `dt ${dt} under water`);
    assert.equal(stepAir(12, false, dt), 12, `dt ${dt} at the surface`);
  }
  // Nor can it be talked out of its bounds by an air that was never in them.
  assert.equal(stepAir(-3, true, NaN), 0);
  assert.equal(stepAir(AIR_S + 9, false, 0), AIR_S);
});

test('a test can shorten the lung: airS and refillS are the defaults\' overrides', () => {
  assert.ok(near(stepAir(0.3, true, 0.1, 0.3, 0.3), 0.2));
  assert.equal(stepAir(0.29, false, 1, 0.3, 0.3), 0.3);
  assert.ok(near(stepAir(0, false, 0.15, 0.3, 0.3), 0.15));
});

// ---- who counts as under water -----------------------------------------------------------

test('somebody is under only with the swimming bit and a head below the surface', () => {
  assert.equal(SEA_LEVEL, 0, 'the numbers below are written against a sea at 0');
  assert.equal(submerged(SWIMMING, -1), true);
  assert.equal(submerged(SWIMMING, -4), true);
  // The surface swimmer walk.js keeps at -0.07 never counts, nor does anybody whose head is
  // still in the air: HEAD above the feet.
  assert.equal(submerged(SWIMMING, -0.07), false);
  assert.equal(submerged(SWIMMING, 0), false);
  assert.equal(submerged(SWIMMING, -HEAD), false, 'the head is exactly at the surface');
  assert.equal(submerged(SWIMMING, -HEAD - 0.01), true);
  // Depth alone is not swimming: a body on a jetty or a deck over deep water breathes.
  assert.equal(submerged(0, -1), false);
  assert.equal(submerged(POSE.MOVING | POSE.RUNNING, -1), false);
  // Every other bit of the pose is beside the point.
  assert.equal(submerged(POSE.SWIMMING | POSE.MOVING | POSE.CROUCHING | POSE.BLOCKING, -1), true);
});

// ---- the bit, in three places ---------------------------------------------------------

test('shared/, the sea and the page agree which bit swimming is', () => {
  assert.equal(SWIMMING, POSE.SWIMMING);
  // net.js is not importable under Node (it wants the browser), so its copy is read.
  assert.match(read('../web/js/net.js'), new RegExp(`FLAG_SWIMMING = ${POSE.SWIMMING};`));
});

test('shared/breath.mjs keeps to the shared rule: no trig, no pow, no clock, no dice', () => {
  const src = read('../shared/breath.mjs').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log|random)\b|Date\.|performance\.|setTimeout|setInterval/);
  assert.doesNotMatch(src, /from '\.\.?\/(lib|web)\//, 'shared/ may not reach into lib/ or web/');
});

test('the sea takes its constants from shared/ and not from a second copy', () => {
  const src = read('../lib/breath.mjs');
  assert.match(src, /from '\.\.\/shared\/breath\.mjs'/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /\b(AIR_S|DROWN_PER_S|REFILL_S)\s*=/, 'a constant was written out again');
});

// ---- the page's half, without a browser ------------------------------------------------

test('the page has the bar, the handler, and says why in its own words', () => {
  const html = read('../web/index.html');
  assert.match(html, /<div class="vital air full"><span>\S+<\/span><b><i><\/i><\/b><\/div>/);
  assert.match(read('../web/css/ui.css'), /\.vital\.air i \{/);
  const net = read('../web/js/net.js');
  assert.match(net, /case 'breath':/);
  assert.match(net, /onBreath = \(\) => \{\}/);
  const main = read('../web/js/main.js');
  assert.match(main, /import \{[^}]*\bstepAir\b[^}]*\} from 'shared\/breath\.mjs'/);
  assert.match(main, /onBreath: \(m\) =>/);
  assert.match(main, /m\.why === 'drown'/);
  assert.match(main, /stepBreath\(nowMs\)/);
  // The bar is the last thing frame() writes after the health, and evict puts the lung back.
  // (The handler is sentHome since Respawn to town shares it, issue #74.)
  assert.match(main, /onEvicted: \(m\) => sentHome\(m\)/);
  assert.match(main, /function sentHome\(m\) \{\s*(\/\/[^\n]*\n\s*)*air = AIR_S;/);
});

test('the air bar is a stamina-style bar: gone while full, back the moment it drains', async () => {
  const { createVitals } = await import('../web/js/vitals.js');
  const bar = () => {
    const classes = new Set(['vital']);
    const vars = {};
    return {
      dataset: {}, vars,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
      style: { setProperty: (k, v) => { vars[k] = v; } },
    };
  };
  const bars = { '.vital.health': bar(), '.vital.stamina': bar(), '.vital.air': bar(), '.vital.tipsy': bar() };
  const vitals = createVitals({ querySelector: (sel) => bars[sel] || null });
  assert.equal(typeof vitals.setAir, 'function');
  vitals.setAir(1);
  assert.equal(bars['.vital.air'].classList.contains('full'), true);
  vitals.setAir(0.5);
  assert.equal(bars['.vital.air'].classList.contains('full'), false);
  assert.equal(bars['.vital.air'].vars['--f'], '0.5');
  vitals.setAir(0);
  assert.equal(bars['.vital.air'].vars['--f'], '0');
  assert.equal(bars['.vital.air'].classList.contains('full'), false, 'an empty bar has to stay on screen');
  vitals.setAir(NaN);
  assert.equal(bars['.vital.air'].classList.contains('full'), true, 'a number that is not one is a bar with nothing to say');
  // And it is nobody else's bar.
  assert.equal(bars['.vital.stamina'].dataset.said, undefined);
});

// ---- the sea's half: who drowns -------------------------------------------------------

// A diver on a wanderer-less island with a home to be sent back to, on a clock the test
// moves. `evict` is the roster's own seam: it records what health sent and takes the pose
// away the way lib/players.mjs does.
function setup({ opts = {}, ...over } = {}) {
  let time = 1000;
  const home = { id: 'home', origin: [0, 400], terrain: { cellWorld: (gx, gz) => [gx, gz], worldHeight: () => 1 },
    bundle: { island: { town: { centre: [2, 3] } } } };
  const fleet = { get: (id) => (id === 'home' ? home : null), all: () => [home] };
  const messages = [];
  const diver = { id: 'diver', island: 'home', walking: true, posed: true, room: null, f: SWIMMING, x: 5, y: -1, z: 6,
    conn: { send: (m) => messages.push(JSON.parse(m)) }, ...over };
  const evictions = [];
  let boats = [];
  let players = [diver];
  const roster = { all: () => players, boats: { snapshot: () => boats },
    evict(player, at, name, boat, why) {
      evictions.push({ at, name, boat, why });
      [player.x, player.y, player.z] = at;
      player.f = 0;
      player.conn.send(JSON.stringify({ t: 'evicted', ...(why ? { why } : {}) }));
    } };
  const health = createHealth({ fleet, roster, now: () => time });
  const hurts = [];
  const spy = { hurt: (...a) => { hurts.push(a); return health.hurt(...a); } };
  const breath = createBreath({ roster, health: spy, now: () => time, ...opts });
  const breaths = () => messages.filter((m) => m.t === 'breath');
  return { p: diver, messages, breaths, evictions, hurts, breath, health,
    boats: (v) => { boats = v; }, players: (v) => { players = v; },
    tick(ms = 100) { time += ms; return breath.tick(); },
    ticks(n, ms = 100) { for (let i = 0; i < n; i++) this.tick(ms); } };
}

test('a surface swimmer never loses any air, and is never spoken to', () => {
  const s = setup({ y: -0.07 });
  s.ticks(1200);                    // two minutes
  assert.equal(s.breath.air(s.p), AIR_S);
  assert.equal(s.messages.length, 0);
  assert.equal(s.hurts.length, 0);
});

test('going under is said at once, in seconds and a rate; the page does the rest itself', () => {
  const s = setup();
  s.tick();
  assert.deepEqual(s.breaths(), [{ t: 'breath', air: AIR_S, max: AIR_S, rate: -1 }]);
  s.ticks(100);                      // ten seconds under, and not a word more
  assert.equal(s.breaths().length, 1, 'the sea sent a message for a bar the page fills by itself');
  assert.ok(near(s.breath.air(s.p), AIR_S - 10, 1e-6), `${s.breath.air(s.p)} left`);
  assert.equal(s.hurts.length, 0, 'nobody drowns with air in them');
});

test('coming up is said once, with the air as it stands and the rate it comes back at', () => {
  const s = setup();
  s.ticks(101);
  s.p.y = -0.07;
  s.tick();
  const last = s.breaths().at(-1);
  assert.equal(s.breaths().length, 2);
  assert.equal(last.max, AIR_S);
  assert.ok(near(last.air, AIR_S - 9, 0.02), `${last.air} on surfacing`);   // ten seconds under, then a tenth back
  assert.ok(near(last.rate, AIR_S / REFILL_S));
  // Then nothing until it is whole, and whole means forgotten.
  s.ticks(40);
  assert.equal(s.breaths().length, 2);
  assert.equal(s.breath.air(s.p), AIR_S);
});

test('a full refill takes REFILL_S from nothing, and the sea agrees with the page about it', () => {
  const s = setup();
  s.ticks(310);                      // out of air, and a little hurt
  s.p.y = -0.07;
  s.ticks(Math.round(REFILL_S * 10) - 1);
  assert.ok(s.breath.air(s.p) < AIR_S, 'whole a beat early');
  s.ticks(2);
  assert.equal(s.breath.air(s.p), AIR_S);
});

test('a diver bobbing at the head\'s own depth is told about it once a second, not every beat', () => {
  const s = setup();
  for (let i = 0; i < 60; i++) { s.p.y = i % 2 ? -0.07 : -1; s.tick(); }      // six seconds of flapping
  const n = s.breaths().length;
  assert.ok(n >= 2, `${n} messages: it said nothing about the flapping`);
  assert.ok(n <= 7, `${n} messages in six seconds`);
  // And each says where things stand when it is sent - draining, refilling, or whole again -
  // not a flip that undid itself.
  for (const said of s.breaths()) assert.ok([-1, 0, AIR_S / REFILL_S].includes(said.rate), `a rate of ${said.rate}`);
});

test('with no air left they are hurt as drowning, at DROWN_PER_S, and sent home with the reason', () => {
  const s = setup();
  let beats = 0;
  while (!s.evictions.length && beats++ < 1000) s.tick();
  assert.equal(s.evictions.length, 1, 'never sent home');
  // Thirty seconds of air, then a hundred health at twelve a second.
  const expected = (AIR_S + MAX_HEALTH / DROWN_PER_S) * 10;
  assert.ok(Math.abs(beats - expected) <= 3, `${beats} beats, expected about ${expected}`);
  assert.deepEqual(s.evictions[0], { at: [2, 1, 403], name: null, boat: null, why: 'drown' });
  for (const [who, amount, cause] of s.hurts) {
    assert.equal(who, s.p);
    assert.deepEqual(cause, { kind: 'drown' });
    assert.ok(near(amount, DROWN_PER_S / 10, 1e-9), `a beat cost ${amount}`);
  }
  // The page hears it in this order: sent home, then a full lung (and the health in between).
  const at = s.messages.findIndex((m) => m.t === 'evicted');
  assert.deepEqual(s.messages[at], { t: 'evicted', why: 'drown' });
  assert.deepEqual(s.messages.at(-1), { t: 'breath', air: AIR_S, max: AIR_S, rate: 0 });
  assert.ok(s.messages.slice(0, at).some((m) => m.t === 'health' && m.hp < MAX_HEALTH), 'the health bar never moved');
  // Home and dry: the next beats find nobody under water, and drown nobody.
  const hurtsBefore = s.hurts.length;
  s.ticks(20);
  assert.equal(s.hurts.length, hurtsBefore);
  assert.equal(s.breath.air(s.p), AIR_S);
});

test('an empty lung holds health back the way every other hurt does', () => {
  const s = setup();
  s.ticks(300 + 30);
  const hp = s.health.health(s.p);
  assert.ok(hp < MAX_HEALTH && hp > 0, `${hp}`);
  s.ticks(20);
  assert.ok(s.health.health(s.p) < hp - 10, 'health came back while they were still under');
});

test('the shared numbers can be shortened for a test', () => {
  const s = setup({ opts: { airS: 0.3, refillS: 0.3, drownPerS: 1000 } });
  let beats = 0;
  while (!s.evictions.length && beats++ < 50) s.tick();
  assert.equal(s.evictions[0].why, 'drown');
  assert.ok(beats <= 6, `${beats} beats`);
  assert.deepEqual(s.messages.at(-1), { t: 'breath', air: 0.3, max: 0.3, rate: 0 });
});

test('a pilot, a room, a sleeper, a walker with no pose yet or none at all, and a body out of the water are left alone', () => {
  for (const change of [
    (s) => s.boats([{ id: 'boat:x', pilot: 'diver' }]),
    (s) => { s.p.room = 'tavern'; },
    (s) => { s.p.f |= POSE.ASLEEP; },
    (s) => { s.p.walking = false; },
    (s) => { s.p.posed = false; },
    (s) => { s.p.f = POSE.MOVING; },
  ]) {
    const s = setup();
    change(s);
    assert.equal(s.tick(), 0);
    s.ticks(500);
    assert.equal(s.breath.air(s.p), AIR_S);
    assert.equal(s.messages.length, 0);
    assert.equal(s.hurts.length, 0);
    assert.equal(s.evictions.length, 0);
  }
});

test('whoever has gone is forgotten, and comes back with a whole lung', () => {
  const s = setup();
  const other = { id: 'other', island: 'home', walking: true, posed: true, room: null, f: 0, x: 0, y: 1, z: 0, conn: { send() {} } };
  s.ticks(150);
  assert.ok(s.breath.air(s.p) < AIR_S - 10);
  s.players([other]);               // somebody else is still here, so this is the sweep and not the empty room
  s.tick();
  assert.equal(s.breath.air(s.p), AIR_S);
  s.players([s.p, other]);
  s.tick();
  assert.ok(s.breath.air(s.p) > AIR_S - 0.5, `${s.breath.air(s.p)}: the old count came back with them`);
  // An empty sea forgets everybody too.
  s.ticks(50);
  s.players([]);
  s.tick();
  s.players([s.p]);
  s.tick();
  assert.ok(s.breath.air(s.p) > AIR_S - 0.5);
});

test('a sea coming back from a suspended process does not charge anybody for the minutes it slept', () => {
  const s = setup();
  s.tick();
  s.tick(60 * 60 * 1000);
  assert.ok(near(s.breath.air(s.p), AIR_S - 0.5, 1e-6), `${s.breath.air(s.p)}`);
});

test('a hurt that does not land - immune, or nowhere to be sent - is no reason to say anything twice', () => {
  const s = setup({ island: null });     // a wanderer with no skiff has no refuge, so nothing can hurt them
  s.ticks(600);
  assert.equal(s.evictions.length, 0);
  assert.equal(s.breaths().length, 1, 'a message per beat for a bar already at nothing');
  assert.equal(s.breath.air(s.p), 0);
});

// ---- the reason rides on evicted -------------------------------------------------------

test('evict says why only when there is something to say, and the rest of the message is unchanged', () => {
  const messages = [];
  const roster = createRoster();
  const p = roster.attach({ id: 'aabbccdd', send: (m) => messages.push(JSON.parse(m)), close() {} }, { island: 'aaaaaaaa' });
  roster.evict(p, [110, 2, -20], 'Codex');
  assert.deepEqual(messages.at(-1), { t: 'evicted', x: 110, y: 2, z: -20, island: 'Codex' });
  roster.evict(p, [110, 2, -20], null, 'boat:w-aabbccdd', 'drown');
  assert.deepEqual(messages.at(-1), { t: 'evicted', x: 110, y: 2, z: -20, island: null, boat: 'boat:w-aabbccdd', why: 'drown' });
});

test('health names a drowning and nothing else', () => {
  for (const [cause, why] of [[{ kind: 'drown' }, 'drown'], [{ kind: 'lava', island: 'De Vulkaan' }, null], [{ kind: 'guard', island: 'Codex' }, null], [{}, null]]) {
    const s = setup();
    s.health.hurt(s.p, MAX_HEALTH, cause);
    assert.equal(s.evictions.length, 1);
    assert.equal(s.evictions[0].why, why, JSON.stringify(cause));
  }
});
