// A page that does not know its berth yet says nothing about where it is standing.
//
// net.js puts our own island's berth on every position it sends (sceneToWorld), and until
// the sea has said where that berth is, main.js's `state.homeOrigin` is null. Reporting the
// walker anyway, against a guessed [0, 0], put it in the middle of the world - which is the
// volcano, whose guards then caught a player who was standing on their own island. So the
// pose beat, and the hull that rides on it, wait for a berth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// Just enough of a browser for net.js: a socket that is open at once and keeps what it is
// sent, and a document to hang the visibility listener on.
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

test('no pose goes out before the berth is known, and the first one after is in the right frame', async () => {
  let berth = null;
  const walk = { state: { active: true, moving: true, grounded: true, swimming: false, running: false, pos: { x: 5, y: 1, z: -3 }, yaw: 0 } };
  const net = createNet({ walk, url: 'ws://sea/ws', join: { v: 1, as: 'client', island: 'aaaaaaaaaaaaaaaa' }, frame: () => berth });
  try {
    await wait(10);
    net.setWalking(true);
    await wait(350);
    const sock = sockets.at(-1);
    assert.ok(sock.sent.some((m) => m.t === 'join'), 'the handshake went out');
    assert.deepEqual(sock.sent.filter((m) => m.t === 'p'), [], 'a pose went out against a guessed berth');
    berth = [300, -200];
    await wait(250);
    const poses = sock.sent.filter((m) => m.t === 'p');
    assert.ok(poses.length >= 1, 'no pose once the berth was known');
    assert.deepEqual([poses[0].x, poses[0].z], [305, -203]);
  } finally {
    net.dispose();
  }
});
