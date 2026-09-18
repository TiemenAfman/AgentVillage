// The gate, and the one hole deliberately cut in it.
//
// lib/access.mjs decides whether a request may start an unattended agent on this machine,
// so the assertion this file exists for is the first one: with config.multiplayer
// .joinInPlace off - the default - every classification is exactly what it was before the
// in-place join was written. The expected objects below are literals for that reason. If
// one of them has to be edited to make this suite pass, the flag stopped being a flag.
//
// The second assertion is the cap: a page on another origin that clears the new
// allowance is a guest even over a loopback socket, because a loopback socket is exactly
// what a hostile page on this very machine also has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import fs from 'node:fs';
import { createAccess, CROSS_ORIGIN_OK } from '../lib/access.mjs';

const PORT = 4747;
const HOST = `localhost:${PORT}`;
const SELF = `http://${HOST}`;

// A neighbour's page, kept on its own origin: same machine, different port. This is the
// shape the in-place join actually arrives in.
const NEIGHBOUR = 'http://localhost:5252';
const NEIGHBOUR_IP = 'http://127.0.0.1:5252';
const NEIGHBOUR_V6 = 'http://[::1]:5252';
const EVIL = 'http://evil.example';

const LOOPBACK = '127.0.0.1';
const LAN = '192.168.1.9';
const OUTSIDE = '8.8.8.8';

function access({ open = false, invite = null, joinInPlace = undefined } = {}) {
  const multiplayer = { enabled: true, maxPlayers: 16 };
  if (joinInPlace !== undefined) multiplayer.joinInPlace = joinInPlace;
  return createAccess({ port: PORT, config: { network: { public: open, inviteCode: invite, hosts: [] }, multiplayer } });
}

function req({ host = HOST, origin = null, addr = LOOPBACK, cookie = null, headers = {} } = {}) {
  const h = { host, ...headers };
  if (origin) h.origin = origin;
  if (cookie) h.cookie = cookie;
  return { headers: h, socket: { remoteAddress: addr } };
}

const at = (path) => new URL(path, SELF);
const who = (a, path, opts) => a.classify(req(opts), at(path));

// ---------------------------------------------------------------------------------
// Off, which is the default, and which has to be today's behaviour to the letter.
// ---------------------------------------------------------------------------------

// Every combination of Origin and socket the file distinguishes, spelled out. Run once
// with the key absent (a config written before the flag existed) and once with it false.
function today(a) {
  return [
    ['no origin, loopback', { addr: LOOPBACK }, { role: 'islander', why: 'loopback' }],
    ['matching origin, loopback', { addr: LOOPBACK, origin: SELF }, { role: 'islander', why: 'loopback' }],
    ['mismatched origin, loopback', { addr: LOOPBACK, origin: NEIGHBOUR }, { role: 'refused', why: `origin ${NEIGHBOUR}` }],
    ['outside origin, loopback', { addr: LOOPBACK, origin: EVIL }, { role: 'refused', why: `origin ${EVIL}` }],
    ['no origin, lan', { addr: LAN }, a.open ? { role: 'guest', why: 'same network' } : { role: 'refused', why: 'the island is not open' }],
    ['mismatched origin, lan', { addr: LAN, origin: NEIGHBOUR }, { role: 'refused', why: `origin ${NEIGHBOUR}` }],
    ['no origin, outside', { addr: OUTSIDE }, a.open
      ? { role: 'refused', why: a.invite ? 'no invite' : 'outside the network' }
      : { role: 'refused', why: 'the island is not open' }],
    ['unknown host', { host: 'evil.example', addr: LOOPBACK }, { role: 'refused', why: 'host evil.example' }],
  ];
}

for (const [label, joinInPlace] of [['absent', undefined], ['false', false]]) {
  test(`with joinInPlace ${label} every classification is what it was`, () => {
    for (const open of [false, true]) {
      const a = access({ open, joinInPlace });
      // Every path, not only the interesting ones: the allowlist must be inert.
      for (const path of [...CROSS_ORIGIN_OK, '/api/assign', '/events', '/']) {
        for (const [name, opts, want] of today(a)) {
          assert.deepEqual(who(a, path, opts), want, `${name} on ${path} (open=${open})`);
        }
      }
    }
  });
}

test('with joinInPlace off an invite still buys a look, and still only a look', () => {
  const a = access({ open: true, invite: 'sesame', joinInPlace: false });
  assert.deepEqual(who(a, '/village.json', { addr: OUTSIDE, cookie: 'promptholm_key=sesame' }), { role: 'guest', why: 'invited' });
  assert.deepEqual(who(a, '/village.json', { addr: OUTSIDE, cookie: 'promptholm_key=open' }), { role: 'refused', why: 'no invite' });
});

test('with joinInPlace off there are no CORS headers for anybody', () => {
  const a = access({ open: true, joinInPlace: false });
  for (const path of CROSS_ORIGIN_OK) {
    assert.equal(a.corsHeadersFor(req({ origin: NEIGHBOUR }), at(path)), null, path);
  }
});

// ---------------------------------------------------------------------------------
// On: a loopback-named Origin, the listed paths, and never more than 'guest'.
// ---------------------------------------------------------------------------------

test('a loopback origin joins in place - as a guest, never as the islander', () => {
  const a = access({ open: true, joinInPlace: true });
  for (const origin of [NEIGHBOUR, NEIGHBOUR_IP, NEIGHBOUR_V6, 'http://localhost', 'http://127.0.0.1']) {
    const got = who(a, '/ws', { addr: LOOPBACK, origin });
    assert.equal(got.role, 'guest', `${origin} on /ws`);
    assert.notEqual(got.role, 'islander');
    assert.match(got.why, /cross-origin/, 'the log has to be able to tell this from a keeper');
  }
  // Same for a socket that is loopback in its other two shapes.
  for (const addr of ['::1', '::ffff:127.0.0.1']) {
    assert.equal(who(a, '/ws', { addr, origin: NEIGHBOUR }).role, 'guest');
  }
  // And the keeper's own page is untouched: same origin, still the islander.
  assert.deepEqual(who(a, '/ws', { addr: LOOPBACK, origin: SELF }), { role: 'islander', why: 'loopback' });
  assert.deepEqual(who(a, '/api/assign', { addr: LOOPBACK, origin: SELF }), { role: 'islander', why: 'loopback' });
});

test('every listed path is a guest at most, and nothing else is reachable at all', () => {
  const a = access({ open: true, joinInPlace: true });
  for (const path of CROSS_ORIGIN_OK) {
    assert.equal(who(a, path, { addr: LOOPBACK, origin: NEIGHBOUR }).role, 'guest', path);
  }
  // The route this whole clause exists for, plus the rest of the dangerous half.
  for (const path of ['/api/assign', '/api/garden', '/api/transcript', '/api/say', '/api/banish', '/events', '/']) {
    assert.deepEqual(who(a, path, { addr: LOOPBACK, origin: NEIGHBOUR }), { role: 'refused', why: `origin ${NEIGHBOUR}` }, path);
  }
});

test('a page that is not on loopback is refused on every path, listed or not', () => {
  const a = access({ open: true, joinInPlace: true });
  for (const origin of [EVIL, 'https://evil.example', 'http://evil.example:4747', 'http://localhost.evil.example', 'http://notlocalhost']) {
    for (const path of [...CROSS_ORIGIN_OK, '/api/assign']) {
      assert.deepEqual(who(a, path, { addr: LOOPBACK, origin }), { role: 'refused', why: `origin ${origin}` }, `${origin} on ${path}`);
    }
    assert.equal(a.corsHeadersFor(req({ origin }), at('/village.json')), null, origin);
  }
});

test('a shut island joins nobody in place', () => {
  const a = access({ open: false, joinInPlace: true });
  for (const path of CROSS_ORIGIN_OK) {
    assert.deepEqual(who(a, path, { addr: LOOPBACK, origin: NEIGHBOUR }), { role: 'refused', why: `origin ${NEIGHBOUR}` }, path);
    assert.equal(a.corsHeadersFor(req({ origin: NEIGHBOUR }), at(path)), null, path);
  }
});

test('the CORS answer is readable, echoed, and never carries credentials', () => {
  const a = access({ open: true, invite: 'sesame', joinInPlace: true });
  const h = a.corsHeadersFor(req({ origin: NEIGHBOUR }), at('/village.json'));
  assert.equal(h['Access-Control-Allow-Origin'], NEIGHBOUR, 'echoed, not a wildcard');
  assert.notEqual(h['Access-Control-Allow-Origin'], '*');
  assert.equal(h.Vary, 'Origin');
  // The invite cookie must not ride along: without this header the browser refuses to
  // send it, which is what lets the client say { credentials: 'omit' } and mean it.
  assert.equal('Access-Control-Allow-Credentials' in h, false);
  // Not for a path off the list, not for a same-origin request, not for an unknown Host.
  assert.equal(a.corsHeadersFor(req({ origin: NEIGHBOUR }), at('/api/assign')), null);
  assert.equal(a.corsHeadersFor(req({ origin: SELF }), at('/village.json')), null);
  assert.equal(a.corsHeadersFor(req({ origin: NEIGHBOUR, host: 'evil.example' }), at('/village.json')), null);
  assert.equal(a.corsHeadersFor(req({}), at('/village.json')), null, 'no Origin, no CORS');
});

test('an unparseable or schemeless Origin is refused rather than guessed at', () => {
  const a = access({ open: true, joinInPlace: true });
  for (const origin of ['null', 'localhost:5252', 'chrome-extension://abc', 'file://']) {
    assert.deepEqual(who(a, '/ws', { addr: LOOPBACK, origin }), { role: 'refused', why: `origin ${origin}` }, origin);
  }
});

// ---------------------------------------------------------------------------------
// The two things that must not have moved.
// ---------------------------------------------------------------------------------

test('hostAllowed is unchanged: a shut island answers to loopback names only', () => {
  for (const joinInPlace of [false, true]) {
    const shut = access({ open: false, joinInPlace });
    for (const host of ['localhost:4747', '127.0.0.1:4747', '[::1]:4747']) {
      assert.equal(who(shut, '/', { host, addr: LOOPBACK }).role, 'islander', host);
    }
    for (const host of ['evil.example', '192.168.1.9:4747', '']) {
      assert.deepEqual(who(shut, '/', { host, addr: LOOPBACK }), { role: 'refused', why: `host ${host}` }, host);
    }
    // Open, and the machine's own address becomes an acceptable Host - but not a stranger's.
    const open = access({ open: true, joinInPlace });
    assert.deepEqual(who(open, '/', { host: 'evil.example', addr: LAN }), { role: 'refused', why: 'host evil.example' });
  }
});

test('X-Forwarded-For is still not read, by behaviour and by the file itself', () => {
  for (const joinInPlace of [false, true]) {
    const a = access({ open: true, joinInPlace });
    const forged = { addr: OUTSIDE, headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' } };
    assert.deepEqual(who(a, '/village.json', forged), { role: 'refused', why: 'outside the network' });
    // Clearing the new allowance does not make a forged header work either: the socket is
    // still read straight off the connection. (The `why` differs per flag - with the
    // allowance off it is the Origin that refuses first - so only the verdict is asserted.)
    assert.equal(who(a, '/ws', { ...forged, origin: NEIGHBOUR }).role, 'refused');
  }
  // And it must not start: the only mentions in the file are the comment saying it never
  // happens. A grep is the cheapest guard there is against somebody "fixing" the proxy case.
  const src = fs.readFileSync(new URL('../lib/access.mjs', import.meta.url), 'utf8');
  for (const line of src.split(/\r?\n/)) {
    if (!/forwarded|real-ip/i.test(line)) continue;
    assert.match(line.trim(), /^\/\//, `lib/access.mjs looks at a proxy header: ${line.trim()}`);
  }
});
