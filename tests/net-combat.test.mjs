// The page's half of a fight (Plans/vulkaan-in-het-midden.md, step 7): the red bar that
// counts, the swing that goes to the sea, and the shield that rides in the pose.
//
// The sea decides everything that matters - who is hit, for how much, and what is left - so
// what is held here is that the page says exactly what the sea listens for and nothing it
// would drop: one `{t:'swing'}` per swing and only on foot on the sea, BLOCKING in the pose
// while the right button is held, and a bar that shows what the sea said and then fills on
// its own at the rate it gave, from one message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// Just enough of a browser for net.js: a socket that is open at once, keeps what it is
// sent and can be handed a message; a document to hang the visibility listener on.
const sockets = [];
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.WebSocket = class {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.handlers = {};
    sockets.push(this);
    setTimeout(() => (this.handlers.open || []).forEach((h) => h()), 0);
  }
  addEventListener(type, h) { (this.handlers[type] ||= []).push(h); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; (this.handlers.close || []).forEach((h) => h()); }
  receive(m) { (this.handlers.message || []).forEach((h) => h({ data: JSON.stringify(m) })); }
};
const { createNet, healthAt, FLAG_BLOCKING, SWING_MS } = await import('../web/js/net.js');
// classic-avatar.js reaches buildings.js for the held items, which builds a TextureLoader at
// import time - the same stub tests/avatar.test.mjs uses.
globalThis.document.createElementNS = () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} });
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { MeshBasicMaterial } = await import('three');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const peers = { setSelf() {}, join() {}, leave() {}, roster() {}, snapshot() {}, clear() {} };
const walker = (over = {}) => ({
  state: {
    active: true, moving: false, grounded: true, swimming: false, running: false, blocking: false,
    vehicle: null, pos: { x: 1, y: 0.5, z: 2 }, yaw: 0, ...over,
  },
});

async function line({ walk = walker(), berth = [0, 0], clock } = {}) {
  let t = 0;
  const net = createNet({
    peers, walk, url: 'ws://sea/ws', join: { v: 1, as: 'client', island: 'aaaaaaaaaaaaaaaa' },
    frame: () => berth, clock: clock || (() => t),
  });
  await wait(5);
  return { net, walk, sock: sockets.at(-1), at: (ms) => { t = ms; } };
}

test('the bar is whole until the sea says otherwise, then shows what it said', async () => {
  const { net, sock, at } = await line();
  try {
    assert.equal(net.health(), 1, 'a body the sea has never hurt is whole');
    at(1000);
    sock.receive({ t: 'health', hp: 40, max: 100, regenIn: 3000, rate: 25 });
    assert.equal(net.health(), 0.4);
    at(3999);
    assert.equal(net.health(), 0.4, 'it filled before the sea said it would');
  } finally { net.dispose(); }
});

test('after regenIn the bar fills at the rate the sea gave, and stops at whole', async () => {
  const { net, sock, at } = await line();
  try {
    at(1000);
    sock.receive({ t: 'health', hp: 40, max: 100, regenIn: 3000, rate: 25 });
    at(5000);                                    // a second into the regen: 40 + 25
    assert.ok(Math.abs(net.health() - 0.65) < 1e-9, `${net.health()}`);
    at(6400);                                    // 2.4 s in: 40 + 60
    assert.equal(net.health(), 1);
    at(60000);
    assert.equal(net.health(), 1, 'the bar filled past whole');
  } finally { net.dispose(); }
});

test('a new message starts the sum again, and a nonsense one is ignored', async () => {
  const { net, sock, at } = await line();
  try {
    at(0);
    sock.receive({ t: 'health', hp: 50, max: 100, regenIn: 0, rate: 25 });
    at(1000);
    assert.equal(net.health(), 0.75);
    // Hit again halfway through: the sea's count wins, and the wait starts over.
    sock.receive({ t: 'health', hp: 60, max: 100, regenIn: 3000, rate: 25 });
    assert.equal(net.health(), 0.6);
    at(3500);
    assert.equal(net.health(), 0.6);
    sock.receive({ t: 'health', hp: 'lots', max: 100 });
    sock.receive({ t: 'health', hp: 10, max: 0 });
    assert.equal(net.health(), 0.6, 'a message that does not add up moved the bar');
    // Sent back: the sea says whole, and whole it is.
    sock.receive({ t: 'health', hp: 100, max: 100, regenIn: 0, rate: 25 });
    assert.equal(net.health(), 1);
  } finally { net.dispose(); }
});

test('a dropped line is a fresh body on the sea, so the bar forgets what it was told', async () => {
  const { net, sock, at } = await line();
  try {
    at(0);
    sock.receive({ t: 'health', hp: 20, max: 100, regenIn: 3000, rate: 25 });
    assert.equal(net.health(), 0.2);
    sock.close();
    assert.equal(net.health(), 1);
  } finally { net.dispose(); }
});

test('healthAt is the sea\'s own sum', () => {
  assert.equal(healthAt(null, 5), 1);
  const h = { hp: 0, max: 100, regenIn: 3000, rate: 25, at: 0 };
  assert.equal(healthAt(h, 3000), 0);
  assert.equal(healthAt(h, 5000), 0.5);
  assert.equal(healthAt(h, 7000), 1);
  assert.equal(healthAt(h, 9e9), 1);
});

test('a swing goes out once, on foot on the sea, and nowhere else', async () => {
  const { net, walk, sock, at } = await line();
  const swings = () => sock.sent.filter((m) => m.t === 'swing');
  try {
    at(0);
    assert.equal(net.swing(), false, 'a swing went out from orbit');
    net.setWalking(true);
    assert.equal(net.swing(), true);
    assert.deepEqual(swings(), [{ t: 'swing' }], 'the swing carried something the sea does not read');
    // The pose went out with it, so the sea measures the blow from where we stand now.
    const i = sock.sent.findIndex((m) => m.t === 'swing');
    assert.equal(sock.sent[i - 1].t, 'p', 'no pose flushed ahead of the swing');
    at(SWING_MS - 1);
    assert.equal(net.swing(), false, 'a swing the sea would drop as too soon went out');
    at(SWING_MS * 2);
    walk.state.swimming = true;
    assert.equal(net.swing(), false, 'a swimmer swung');
    walk.state.swimming = false;
    walk.state.vehicle = { id: 'boat:x' };
    assert.equal(net.swing(), false, 'a pilot swung');
    walk.state.vehicle = null;
    walk.state.blocking = true;
    assert.equal(net.swing(), false, 'a swing went out behind a raised shield, which the sea ignores');
    walk.state.blocking = false;
    net.setRoom('tavern', walker());
    assert.equal(net.swing(), false, 'a swing went out from indoors');
    net.setRoom(null);
    assert.equal(net.swing(), true);
    assert.equal(swings().length, 2);
  } finally { net.dispose(); }
});

test('no swing before the sea knows where we are', async () => {
  const { net, sock } = await line({ berth: null });
  try {
    net.setWalking(true);
    assert.equal(net.swing(), false);
    assert.deepEqual(sock.sent.filter((m) => m.t === 'swing'), []);
  } finally { net.dispose(); }
});

test('the shield rides in the pose as bit 16, and not in the water', async () => {
  const walk = walker({ blocking: true });
  const { net, sock } = await line({ walk });
  const lastPose = () => sock.sent.filter((m) => m.t === 'p').at(-1);
  try {
    assert.equal(FLAG_BLOCKING, 16);
    net.setWalking(true);
    await wait(130);
    assert.equal(lastPose().f & FLAG_BLOCKING, FLAG_BLOCKING, 'blocking did not reach the pose');
    walk.state.blocking = false;
    await wait(130);
    assert.equal(lastPose().f & FLAG_BLOCKING, 0, 'the shield stayed up on the wire');
    walk.state.blocking = true;
    walk.state.swimming = true;
    await wait(130);
    assert.equal(lastPose().f & FLAG_BLOCKING, 0, 'a swimmer said he was blocking');
  } finally { net.dispose(); }
});

test('the arm says whether a swing started, so a mashed button is one blow', () => {
  const rig = createClassicAvatar(DEFAULT_AVATAR, new MeshBasicMaterial({ vertexColors: true }));
  assert.equal(rig.attack(), true);
  assert.equal(rig.attack(), false, 'a second click in the wind-up counted as a swing');
  rig.update({ moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 }, 0.3);   // past the strike
  assert.equal(rig.attack(), true, 'a swing past its strike could not be cut short');
});

test('a hit on an island is passed through to the page as it came', async () => {
  const seen = [];
  const net = createNet({ peers, walk: walker(), url: 'ws://sea/ws', frame: () => [0, 0], onAgent: (m) => seen.push(m) });
  try {
    await wait(5);
    sockets.at(-1).receive({ t: 'agent', a: 'hit', i: '0000000000000000', id: 'guard:3', hp: 60, max: 100 });
    assert.deepEqual(seen, [{ t: 'agent', a: 'hit', i: '0000000000000000', id: 'guard:3', hp: 60, max: 100 }]);
  } finally { net.dispose(); }
});
