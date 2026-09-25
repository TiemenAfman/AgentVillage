// Seeing other players the way they see themselves (Plans/andere-spelers-zoals-jij.md): their
// look, their pose - lying, crouching, sitting - and their arms, a swing and a sip. peers.js,
// which draws all of it, reaches walk.js and cannot be loaded here; what can be held is what
// the sea lets through (lib/players.mjs) and what a page says (web/js/net.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createRoster, POSE } from '../lib/players.mjs';
register('./support/shared-loader.mjs', import.meta.url);

function room() {
  const roster = createRoster();
  const inbox = new Map();
  const join = (id) => {
    const conn = { id, send: (m) => inbox.get(id).push(JSON.parse(m)), close() {} };
    inbox.set(id, []);
    const p = roster.attach(conn, {});
    return { p, say: (msg) => roster.message(conn, JSON.stringify(msg)), got: () => inbox.get(id) };
  };
  return { roster, join };
}
const LOOK = {
  skin: 0xf1c9a5, tunic: 0x335577, trim: 0x6b4a2f, hat: 0xc9a75c, hatShape: 'helmet',
  equip: { backpack: false, chestplate: true, leggings: false, boots: true, leftHandItem: 'shield', rightHandItem: 'sword' },
};

test('a look is kept on the player, handed on in their identity, and only when it changed', () => {
  const { join } = room();
  const ann = join('aaaaaaaaaaaa'), ben = join('bbbbbbbbbbbb');
  ann.say({ t: 'look', ...LOOK });
  const said = ben.got().filter((m) => m.t === 'join' && m.p.id === 'aaaaaaaaaaaa');
  assert.equal(said.length, 1, 'the others were not told of the new look');
  assert.deepEqual(said[0].p.look, LOOK);
  ann.say({ t: 'look', ...LOOK });
  assert.equal(ben.got().filter((m) => m.t === 'join' && m.p.id === 'aaaaaaaaaaaa').length, 1, 'the same look said twice was news twice');
});

test('a look is held to its shape: whatever else a socket hangs on it does not reach anybody', () => {
  const { join } = room();
  const ann = join('aaaaaaaaaaaa');
  ann.say({
    t: 'look', skin: 'red', tunic: -1, trim: 0x1000000, hat: 3.5, hatShape: '<img src=x>',
    equip: { backpack: 'yes', leftHandItem: 'x'.repeat(40), rightHandItem: 'sword', extra: 1 }, script: 'alert(1)',
  });
  assert.deepEqual(ann.p.look, {
    skin: null, tunic: null, trim: null, hat: null, hatShape: null,
    equip: { leftHandItem: null, rightHandItem: 'sword' },
  });
});

test('lying, crouching and sitting go through the sea; nothing above them does', () => {
  const { join } = room();
  const ann = join('aaaaaaaaaaaa');
  for (const bit of [POSE.LYING, POSE.CROUCHING, POSE.SITTING]) {
    ann.say({ t: 'p', x: 1, y: 1, z: 1, yaw: 0, f: bit | POSE.MOVING });
    assert.equal(ann.p.f, bit | POSE.MOVING);
  }
  assert.deepEqual([POSE.LYING, POSE.CROUCHING, POSE.SITTING], [256, 512, 1024]);
  ann.say({ t: 'p', x: 1, y: 1, z: 1, yaw: 0, f: 4096 | POSE.SITTING });
  assert.equal(ann.p.f, POSE.SITTING);
});

test('a swing and a sip are shown to everybody else, on the hand they were, and not echoed back', () => {
  const { join } = room();
  const ann = join('aaaaaaaaaaaa'), ben = join('bbbbbbbbbbbb');
  ann.say({ t: 'w', on: true });
  ann.say({ t: 'swing', side: 'leftArm' });
  ann.say({ t: 'drink', side: 'rightArm' });
  ann.say({ t: 'swing', side: 'tail' });
  const seen = ben.got().filter((m) => m.t === 'swung' || m.t === 'drank');
  assert.deepEqual(seen, [
    { t: 'swung', id: 'aaaaaaaaaaaa', side: 'leftArm' },
    { t: 'drank', id: 'aaaaaaaaaaaa', side: 'rightArm' },
    { t: 'swung', id: 'aaaaaaaaaaaa', side: null },
  ]);
  assert.equal(ann.got().filter((m) => m.t === 'swung' || m.t === 'drank').length, 0, 'told about their own arm');
  // Somebody up in the sky with no body in the world has no arm to be seen swinging.
  const cat = join('cccccccccccc');
  cat.say({ t: 'swing', side: 'leftArm' });
  assert.equal(ben.got().filter((m) => m.t === 'swung' && m.id === 'cccccccccccc').length, 0);
});

// The page's half, with the stand-in browser tests/net-berth.test.mjs uses.
const sockets = [];
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.WebSocket = class {
  constructor() { this.readyState = 1; this.sent = []; this.handlers = {}; sockets.push(this); setTimeout(() => (this.handlers.open || []).forEach((h) => h()), 0); }
  addEventListener(type, h) { (this.handlers[type] ||= []).push(h); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
};
const { createNet, FLAG_LYING, FLAG_CROUCHING, FLAG_SITTING } = await import('../web/js/net.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a page says what it looks like on connect, how its body is, and which hand swung', async () => {
  const walk = { state: { active: true, moving: false, grounded: true, swimming: false, running: false, lying: true, crouching: false, sitting: null, pos: { x: 5, y: 1, z: -3 }, yaw: 0 } };
  const net = createNet({ walk, url: 'ws://sea/ws', join: { v: 3, as: 'client', island: null }, look: LOOK, frame: () => [0, 0] });
  try {
    await wait(10);
    const sock = sockets.at(-1);
    assert.deepEqual(sock.sent.find((m) => m.t === 'look'), { t: 'look', ...LOOK }, 'the look did not go out on connect');
    net.setWalking(true);
    await wait(150);
    assert.equal(sock.sent.filter((m) => m.t === 'p').at(-1).f & (FLAG_LYING | FLAG_CROUCHING | FLAG_SITTING), FLAG_LYING);
    walk.state.lying = false; walk.state.sitting = { x: 5, y: 1.2, z: -3 };
    await wait(150);
    assert.equal(sock.sent.filter((m) => m.t === 'p').at(-1).f & (FLAG_LYING | FLAG_CROUCHING | FLAG_SITTING), FLAG_SITTING);
    walk.state.sitting = null;
    assert.ok(net.swing('rightArm'));
    assert.equal(sock.sent.filter((m) => m.t === 'swing').at(-1).side, 'rightArm');
    net.drink('leftArm');
    assert.deepEqual(sock.sent.filter((m) => m.t === 'drink').at(-1), { t: 'drink', side: 'leftArm' });
    net.setLook({ ...LOOK, hatShape: 'wide' });
    assert.equal(sock.sent.filter((m) => m.t === 'look').at(-1).hatShape, 'wide');
  } finally {
    net.dispose();
  }
});

test('the numbers the page and the sea both write down agree', () => {
  // POSE is the sea's copy and net.js / peers.js the page's; three places, one set of bits.
  const peers = readFileSync(new URL('../web/js/peers.js', import.meta.url), 'utf8');
  for (const [name, bit] of [['LYING', 256], ['CROUCHING', 512], ['SITTING', 1024]]) {
    assert.equal(POSE[name], bit);
    assert.match(peers, new RegExp(`const FLAG_${name} = ${bit};`), `peers.js has another ${name}`);
  }
  assert.deepEqual([FLAG_LYING, FLAG_CROUCHING, FLAG_SITTING], [256, 512, 1024]);
});
