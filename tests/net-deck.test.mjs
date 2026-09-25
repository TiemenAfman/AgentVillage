// What a page says about somebody standing on a deck (web/js/net.js - Plans/lopen-op-de-boot.md,
// fase 4). No walk mode stands anybody on one yet; this holds the wire for the day one does,
// and holds that adding it changed nothing for everybody else: a walker standing still is
// still quiet, and a pose with no deck is the pose it always was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// The same stand-in browser tests/net-berth.test.mjs uses.
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
  close() { this.readyState = 3; }
};
const { createNet } = await import('../web/js/net.js');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function walker() {
  return { state: { active: true, moving: false, grounded: true, swimming: false, running: false, pos: { x: 5, y: 1, z: -3 }, yaw: 0 } };
}

test('a walker standing still says so once and then keeps quiet, deck or no deck', async () => {
  const walk = walker();
  const net = createNet({ walk, url: 'ws://sea/ws', join: { v: 3, as: 'client', island: null }, frame: () => [0, 0] });
  try {
    await wait(10);
    net.setWalking(true);
    await wait(650);
    const poses = sockets.at(-1).sent.filter((m) => m.t === 'p');
    assert.equal(poses.length, 1, `${poses.length} poses in 0.65 s from somebody standing still`);
    assert.equal(poses[0].on, undefined, 'a pose with no deck says it is on one');
    assert.equal(poses[0].d, undefined);
  } finally {
    net.dispose();
  }
});

test('on a deck the pose names the boat and the place on it, and a step along the deck is news', async () => {
  const walk = walker();
  walk.state.deck = { boat: 'boat:a1b2c3d4', x: 0.5, y: 0, z: -1, yaw: 0.25 };
  const net = createNet({ walk, url: 'ws://sea/ws', join: { v: 3, as: 'client', island: null }, frame: () => [0, 0] });
  try {
    await wait(10);
    net.setWalking(true);
    await wait(250);
    const sock = sockets.at(-1);
    const first = sock.sent.filter((m) => m.t === 'p');
    assert.equal(first.length, 1);
    assert.equal(first[0].on, 'boat:a1b2c3d4');
    assert.deepEqual(first[0].d, [0.5, 0, -1, 0.25]);
    // Walking along the deck while the world position the page works out stays put - a
    // boat drifting at the speed its passenger walks aft - is still a step worth sending.
    walk.state.deck = { ...walk.state.deck, z: -0.6 };
    await wait(250);
    const after = sock.sent.filter((m) => m.t === 'p');
    assert.equal(after.length, 2, 'a step along the deck went unsaid');
    assert.deepEqual(after[1].d, [0.5, 0, -0.6, 0.25]);
    // And the three crew messages go out as the sea reads them (lib/players.mjs).
    net.boardBoat('boat:a1b2c3d4');
    net.letGoBoat('boat:a1b2c3d4');
    net.leaveBoat('boat:a1b2c3d4');
    assert.deepEqual(sock.sent.filter((m) => m.t === 'boat').map((m) => m.a), ['board', 'letgo', 'leave']);
  } finally {
    net.dispose();
  }
});
