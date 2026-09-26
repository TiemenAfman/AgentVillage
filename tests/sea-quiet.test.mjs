// A sea that does not answer is said on the page, once, and taken down when it answers.
//
// The sea walks every crowd, this island's own included, so a sea that never opens its
// socket is an island standing empty. On 26 September it stood so for twelve minutes with
// nothing on the screen to say why: net.js said 'on' and 'off' to an onStatus that main.js
// had wired to nothing. Now it says 'quiet' after a grace - once however many attempts fail,
// the refusal toasts' rule - and main.js puts web/js/seaquiet.js's sentence in the skew box
// until the next 'on'. The islander's half of the same day is in tests/seaclient.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// Just enough of a browser for net.js: a socket that fails or opens as the plan says, the
// way a browser's does - an error and then a close, both after the constructor returns.
const plan = [];
const sockets = [];
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
globalThis.WebSocket = class {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    this.handlers = {};
    sockets.push(this);
    const opens = plan.shift() === 'open';
    setTimeout(() => {
      if (opens) { this.readyState = 1; this.fire('open'); return; }
      this.readyState = 3;
      this.fire('error');
      this.fire('close');
    }, 5);
  }
  fire(type) { for (const h of this.handlers[type] || []) h({}); }
  addEventListener(type, h) { (this.handlers[type] ||= []).push(h); }
  send(text) { this.sent.push(JSON.parse(text)); }
  // A browser's close() on a socket that already failed is nothing; on an open one it is a
  // close event a moment later.
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.fire('close'), 1);
  }
};
const { createNet } = await import('../web/js/net.js');
const { seaQuietNotice } = await import('../web/js/seaquiet.js');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const peers = { setSelf() {}, join() {}, leave() {}, roster() {}, snapshot() {}, clear() {}, act() {} };
const walk = { state: { active: false, pos: { x: 0, y: 0, z: 0 }, yaw: 0 } };

test('the page says the sea is quiet once, clears it when a socket opens, and says it again on the next outage', async () => {
  // Attempts at about 0, 1 and 3 s (net.js's backoff): two that fail, then one that opens.
  plan.push('fail', 'fail', 'open', 'open');
  const said = [];
  const net = createNet({ peers, walk, url: 'ws://sea/ws', frame: () => [0, 0], quietMs: 250, onStatus: (s) => said.push(s) });
  try {
    await wait(1600);
    assert.ok(sockets.length >= 2, `only ${sockets.length} attempt(s) - the second failure is what this is about`);
    assert.deepEqual(said.filter((s) => s !== 'off'), ['quiet'], 'said once for the first failure, and not again for the next');

    await wait(2400);
    assert.deepEqual(said.filter((s) => s !== 'off'), ['quiet', 'on'], 'a socket opening did not take it down');

    // The sea goes away under an open line: a fresh outage, said again after its own grace.
    sockets.at(-1).close();
    await wait(400);
    assert.deepEqual(said.filter((s) => s !== 'off'), ['quiet', 'on', 'quiet']);
    await wait(1300);
    assert.deepEqual(said.filter((s) => s !== 'off'), ['quiet', 'on', 'quiet', 'on']);
  } finally {
    net.dispose();
    plan.length = 0;
  }
});

test('a line back within the grace says nothing at all', async () => {
  plan.push('open', 'open');
  const said = [];
  const net = createNet({ peers, walk, url: 'ws://sea/ws', frame: () => [0, 0], quietMs: 2500, onStatus: (s) => said.push(s) });
  try {
    await wait(50);
    sockets.at(-1).close();                        // a sea restarting: a second of blank water
    await wait(1500);
    assert.deepEqual(said, ['on', 'off', 'on']);
  } finally {
    net.dispose();
    plan.length = 0;
  }
});

test('the words name the sea the way the keeper chose it, and only the keeper is pointed at On my own', () => {
  const online = seaQuietNotice({ url: 'https://agentvillage.xeroxmsj.freeddns.org/', mode: 'join', open: true, keeper: true });
  assert.match(online, /The online sea is not answering/);
  assert.match(online, /nobody is walking/);
  assert.match(online, /On my own/);
  assert.match(online, /Settings/);

  const lan = seaQuietNotice({ url: 'http://192.168.1.20:4750/', mode: 'join', keeper: true });
  assert.match(lan, /The sea at 192\.168\.1\.20:4750 is not answering/);
  assert.match(lan, /On my own/);

  // A visitor, and a phone, have no say in which sea the island is in.
  assert.doesNotMatch(seaQuietNotice({ url: 'http://192.168.1.20:4750/', mode: 'join', keeper: false }), /On my own/);
  assert.doesNotMatch(seaQuietNotice({ url: 'https://agentvillage.xeroxmsj.freeddns.org/' }), /On my own/);

  // Our own sea is already "on my own", and has no address worth reading out.
  for (const mode of ['single', 'host']) {
    const own = seaQuietNotice({ url: 'http://localhost:4750/', mode, keeper: true });
    assert.match(own, /own sea is not answering/);
    assert.doesNotMatch(own, /localhost|On my own/);
  }

  // Whatever the address, it goes on the page as text.
  assert.doesNotMatch(seaQuietNotice({ url: 'not a url <img src=x onerror=alert(1)>', mode: 'join' }), /<img/);
  assert.match(seaQuietNotice({}), /^<b>The sea is not answering<\/b>/);
});
