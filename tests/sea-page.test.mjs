// The harbour office, and the one button on it.
//
// The button is a restart for everybody moored here, on a public address. So the thing
// worth asserting is not that it works - it is who it refuses, and that a sea which was
// never told how to update itself says so instead of pretending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { afloat, island, post } = await import('./support/sea.mjs');

test('the page is served, and names the sea without reading a file', async () => {
  await afloat(async ({ base }) => {
    const a = island();
    await post(base, `/island/${a.id}`, a.bundle);
    const r = await fetch(base);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    const html = await r.text();
    assert.match(html, /test sea/, 'the page does not say which sea it is');
    // It fetches its own numbers, so the routes it asks for have to be the ones that
    // exist - and relative, or the page breaks the moment it is behind a subpath.
    assert.match(html, /fetch\('health'/);
    assert.match(html, /fetch\('world'/);
  }, { name: 'test sea' });
});

test('a sea with a key lets nobody else press the button', async () => {
  await afloat(async ({ base }) => {
    const wrong = await fetch(`${base}/update`, { method: 'POST', headers: { 'X-Sea-Key': 'nope' } });
    assert.equal(wrong.status, 403);
    const none = await fetch(`${base}/update`, { method: 'POST' });
    assert.equal(none.status, 403, 'no key at all got through');

    // With the key: past the door, and then honestly stuck, because this sea has no hook.
    const right = await fetch(`${base}/update`, { method: 'POST', headers: { 'X-Sea-Key': 'k' } });
    assert.equal(right.status, 501);
    assert.match((await right.json()).error, /not told how to update/);
  }, { key: 'k' });
});

test('a sea without a key will not restart itself for anybody', async () => {
  // Who before what: 403 and not 501, because answering "no hook here" first would tell a
  // stranger something about how this sea is deployed.
  await afloat(async ({ base }) => {
    const r = await fetch(`${base}/update`, { method: 'POST' });
    assert.equal(r.status, 403);
  });
});

test('a hook without a key is a lock nobody fitted', async () => {
  // The sharp edge of the check: `if (key) …` reads as the protection and is not one when
  // there is no key. On a public address that is a redeploy button for anybody.
  const http = await import('node:http');
  const asked = [];
  const hook = http.createServer((req, res) => { asked.push(req.method); res.writeHead(200); res.end('{}'); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  try {
    await afloat(async ({ base }) => {
      const r = await fetch(`${base}/update`, { method: 'POST' });
      assert.equal(r.status, 403);
      assert.match((await r.json()).error, /no key/);
      assert.deepEqual(asked, [], 'the hook was asked anyway');
    }, { updateHook: `http://127.0.0.1:${hook.address().port}/hook` });
  } finally {
    await new Promise((r) => hook.close(r));
  }
});

test('the button asks the hook, and only on a POST', async () => {
  // A hook of our own, so nothing real is deployed by a test.
  const asked = [];
  const http = await import('node:http');
  const hook = http.createServer((req, res) => { asked.push(req.method); res.writeHead(200); res.end('{}'); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${hook.address().port}/hook`;
  try {
    await afloat(async ({ base }) => {
      assert.equal((await fetch(`${base}/update`, { method: 'GET' })).status, 404, 'a GET pressed the button');
      assert.deepEqual(asked, []);
      const r = await fetch(`${base}/update`, { method: 'POST', headers: { 'X-Sea-Key': 'k' } });
      assert.equal(r.status, 200);
      assert.deepEqual(asked, ['POST']);
    }, { updateHook: url, key: 'k' });
  } finally {
    await new Promise((r) => hook.close(r));
  }
});
