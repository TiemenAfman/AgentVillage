// Who may do what, and the three signals that decide it.
//
// This file used to be mostly about an exception. `config.multiplayer.joinInPlace` let a
// page on this machine talk to a neighbour's island, and it bought that by spending the
// Origin check on a narrow list of paths - with a cap that kept the role at 'guest' even
// over a loopback socket, because otherwise any localhost page a browser could be pointed
// at would have reached /api/assign and spawned real Claude Code sessions with full
// permissions in any folder.
//
// The sea made all of that unnecessary. The world is somewhere else now and this server
// answers nothing but its own machine, so the allowance is gone and so is the only write
// route a visitor could ever reach. What is left to assert is that it stayed gone: three
// signals, no exceptions, and a deny-by-default API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createAccess, isPublicPath } from '../lib/access.mjs';

const SELF = 'http://localhost:4747';
const NEIGHBOUR = 'http://localhost:4748';
const ELSEWHERE = 'https://evil.example';

function access({ open = false, invite = null } = {}) {
  return createAccess({
    port: 4747,
    config: { network: { public: open, inviteCode: invite, hosts: [] }, multiplayer: {} },
  });
}

// A request as the server sees one: a socket address, a Host, and maybe an Origin.
function req({ addr = '127.0.0.1', host = 'localhost:4747', origin = undefined, cookie = undefined } = {}) {
  return { socket: { remoteAddress: addr }, headers: { host, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } };
}
const at = (path) => new URL(`http://localhost:4747${path}`);

test('the keeper is a loopback socket, a known Host and no foreign Origin', () => {
  const a = access();
  assert.equal(a.classify(req(), at('/api/assign')).role, 'islander');
  assert.equal(a.classify(req({ origin: SELF }), at('/api/assign')).role, 'islander');
});

test('a foreign Origin is refused, whatever the socket says', () => {
  const a = access({ open: true });
  for (const origin of [NEIGHBOUR, ELSEWHERE, 'http://127.0.0.1:9999']) {
    for (const path of ['/api/assign', '/api/hello', '/village.json', '/ws']) {
      assert.equal(a.classify(req({ origin }), at(path)).role, 'refused', `${origin} ${path}`);
    }
  }
});

test('a Host we do not answer to is refused, which is the rebinding defence', () => {
  const a = access({ open: true });
  assert.equal(a.classify(req({ host: 'evil.example' }), at('/api/hello')).role, 'refused');
  // Even from our own loopback socket: a page on evil.example whose name resolves to
  // 127.0.0.1 reaches us over loopback too, and the Host is what tells the two apart.
  assert.equal(a.classify(req({ addr: '127.0.0.1', host: 'evil.example' }), at('/')).role, 'refused');
});

test('a shut island lets nobody but this machine in', () => {
  const a = access({ open: false });
  assert.equal(a.classify(req({ addr: '192.168.1.9', host: 'localhost:4747' }), at('/api/hello')).role, 'refused');
  assert.equal(a.classify(req(), at('/api/hello')).role, 'islander');
});

test('an open island lets the network look, and only look', () => {
  const a = access({ open: true });
  const who = a.classify(req({ addr: '192.168.1.9' }), at('/api/hello'));
  assert.equal(who.role, 'guest');
  assert.equal(who.why, 'same network');
});

test('an invite buys a look from outside the network, and still only a look', () => {
  const a = access({ open: true, invite: 'sesame' });
  const outside = { addr: '203.0.113.7' };
  assert.equal(a.classify(req(outside), at('/api/hello')).role, 'refused');
  assert.equal(a.classify(req(outside), at('/api/hello?key=sesame')).role, 'guest');
  assert.equal(a.classify(req({ ...outside, cookie: 'promptholm_key=sesame' }), at('/api/hello')).role, 'guest');
  // A guest is still refused everything that is not public, whatever they hold.
  assert.equal(isPublicPath('/api/assign'), false);
  assert.equal(isPublicPath('/api/garden'), false);
});

// The property this whole file exists for. Anything under /api/ has to be listed by hand,
// so a route added later is local-only without its author having to think about it.
test('the API is deny-by-default, and nothing on the public list writes', () => {
  assert.equal(isPublicPath('/api/hello'), true);
  assert.equal(isPublicPath('/api/props'), true);
  assert.equal(isPublicPath('/api/crops'), true);
  for (const path of ['/api/assign', '/api/garden', '/api/build', '/api/mail', '/api/sea',
    '/api/placements', '/api/sessions', '/api/transcript', '/api/git', '/api/seas',
    // The two that used to be public, and are not any more: an island is published to a
    // sea now, and a sea is not this server.
    '/api/island', '/api/islands']) {
    assert.equal(isPublicPath(path), false, `${path} is reachable from outside`);
  }
});

// And the thing that was briefly negotiable. There is no flag, no path list and no way to
// clear the Origin check with a foreign Origin - not on any path, open or shut.
test('there is no longer any way to spend the Origin check', () => {
  for (const open of [false, true]) {
    const a = access({ open });
    assert.equal(a.corsHeadersFor, undefined, 'the CORS helper is gone with the allowance');
    assert.equal(a.joinInPlace, undefined, 'and so is the flag');
    for (const path of ['/ws', '/village.json', '/api/hello', '/api/island', '/api/islands', '/api/assign']) {
      assert.equal(a.classify(req({ origin: NEIGHBOUR }), at(path)).role, 'refused', `${path} open=${open}`);
    }
  }
});

test('X-Forwarded-For is never read', async () => {
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('../lib/access.mjs', import.meta.url)), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.ok(!/x-forwarded-for/i.test(src), 'there is no trusted proxy in front of this');
});
