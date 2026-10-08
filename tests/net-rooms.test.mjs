// A room is one place for the whole sea (Plans/DONE/gedeelde-kamers.md).
//
// net.js puts our island's berth on every position it sends and takes it off every one it is
// sent. Indoors that put two players in the same tavern, each come in from their own island, a
// berth apart - outside its walls, so each sat alone with the innkeeper. A position in a room
// is the room's own and crosses the socket as it is; `boat` is no room but a pilot out of
// doors, and keeps the berth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

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
  receive(obj) { (this.handlers.message || []).forEach((h) => h({ data: JSON.stringify(obj) })); }
};
const { createNet } = await import('../web/js/net.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const walker = (x, z) => ({ state: { active: true, moving: true, grounded: true, swimming: false, running: false, pos: { x, y: 1, z }, yaw: 0 } });
const BERTH = [300, -200];

test('a pose in a room goes out in the room\'s frame, one on a boat in the sea\'s', async () => {
  const outside = walker(5, -3);
  const tavern = walker(1.5, 2);
  const net = createNet({ walk: outside, url: 'ws://sea/ws', join: { v: 1, as: 'client', island: 'aaaaaaaaaaaaaaaa' }, frame: () => BERTH });
  try {
    await wait(10);
    net.setWalking(true);
    net.setRoom('tavern', tavern);
    await wait(250);
    const sock = sockets.at(-1);
    const inside = sock.sent.filter((m) => m.t === 'p').at(-1);
    assert.equal(inside.r, 'tavern');
    assert.deepEqual([inside.x, inside.z], [1.5, 2]);

    net.setRoom('boat', outside);
    await wait(250);
    const aboard = sock.sent.filter((m) => m.t === 'p').at(-1);
    assert.equal(aboard.r, 'boat');
    assert.deepEqual([aboard.x, aboard.z], [305, -203]);
  } finally {
    net.dispose();
  }
});

test('somebody in a room comes in where the room has them; outdoors and aboard lose our berth', async () => {
  const seen = [];
  const peers = { snapshot: (rows) => seen.push(rows), setSelf() {}, join() {}, act() {}, leave() {}, roster() {}, clear() {} };
  const net = createNet({ peers, walk: walker(0, 0), url: 'ws://sea/ws', join: { v: 1, as: 'client', island: 'aaaaaaaaaaaaaaaa' }, frame: () => BERTH });
  try {
    await wait(10);
    sockets.at(-1).receive({ t: 's', a: [
      ['in', 1.5, 1, 2, 0, 0, 'tavern'],
      ['out', 310, 1, -190, 0, 0],
      ['helm', 320, 1, -180, 0, 0, 'boat'],
    ] });
    const rows = Object.fromEntries(seen.at(-1).map((r) => [r[0], [r[1], r[3]]]));
    assert.deepEqual(rows, { in: [1.5, 2], out: [10, 10], helm: [20, 20] });
  } finally {
    net.dispose();
  }
});
