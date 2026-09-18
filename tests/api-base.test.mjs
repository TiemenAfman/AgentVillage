// The page may be served from somewhere other than the machine it talks to, and from a
// path other than /. Two things have to hold for that to work, and neither of them is
// visible by looking at a running island on localhost - which is exactly why they are
// asserted here rather than left to be noticed behind the first reverse proxy.
//
//   1. Every address is worked out from the module's own URL, so a page at /island/
//      asks for /island/api/... and not for /api/... one directory too high.
//   2. Nothing reaches the network without saying which machine it means. A bare
//      `fetch('/api/...')` is the old assumption that the page and the server are the
//      same thing, and it has to stay gone.
//
// web/js/api.js imports nothing, so it loads under Node with no loader and no document
// stub. That is a property worth keeping: it is the module every other one depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBJS = path.join(HERE, '..', 'web', 'js');

const api = await import(pathToFileURL(path.join(WEBJS, 'api.js')).href);

test('an address is resolved against the module, not against the origin', () => {
  // Under Node the module lives on disk, so its root is web/ - the same directory the
  // server serves. What matters is the shape: the leading slash on a call site is a
  // route rather than an origin-absolute path, and it never escapes the base.
  const hello = api.mineUrl('/api/hello');
  assert.ok(hello.endsWith('/web/api/hello'), hello);
  assert.equal(api.mineUrl('api/hello'), hello, 'a leading slash is optional, never meaningful');
  assert.equal(api.mineUrl('///api/hello'), hello, 'and never lets a path climb out');
});

test('a query string survives the trip', () => {
  assert.ok(api.mineUrl('/api/islands?id=abc').endsWith('/web/api/islands?id=abc'));
});

test('the sea is the same place until it is told otherwise', () => {
  api.useSea(null);
  assert.equal(api.seaUrl('/world'), api.mineUrl('/world'),
    'single player and every deployment today: one machine, two names for it');
});

test('a sea somewhere else takes every world call with it, and only those', () => {
  api.useSea('https://sea.example/');
  assert.equal(api.seaUrl('/world'), 'https://sea.example/world');
  assert.equal(api.seaUrl('/island/abc'), 'https://sea.example/island/abc');
  assert.ok(api.mineUrl('/api/garden').startsWith('file:'), 'my own machine did not move');
  api.useSea(null);
});

test('a sea behind a proxy keeps its subpath', () => {
  api.useSea('https://example.org/promptholm/');
  assert.equal(api.seaUrl('/world'), 'https://example.org/promptholm/world');
  api.useSea(null);
});

test('the socket follows the sea, and upgrades its scheme with it', () => {
  api.useSea('https://sea.example/');
  assert.equal(api.seaSocket(), 'wss://sea.example/ws');
  api.useSea('http://192.168.1.5:4747/');
  assert.equal(api.seaSocket(), 'ws://192.168.1.5:4747/ws');
  api.useSea(null);
});

// Strip the comments before looking. api.js talks about the old shape at length in its
// own header, and a test that could not tell prose from code would either fail on that or
// have to exempt the one file it most wants to keep honest.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n');
}

test('nothing under web/js reaches the network without naming the machine', () => {
  const offenders = [];
  for (const name of fs.readdirSync(WEBJS)) {
    if (!name.endsWith('.js')) continue;
    const src = code(fs.readFileSync(path.join(WEBJS, name), 'utf8'));
    for (const [, q] of src.matchAll(/fetch\((['`])\//g)) {
      offenders.push(`${name}: fetch(${q}/…`);
    }
    // EventSource and sendBeacon are the two that are not fetch and are just as absolute.
    for (const m of src.matchAll(/new EventSource\((['`])\//g)) offenders.push(`${name}: EventSource`);
    for (const m of src.matchAll(/sendBeacon\((['`])\//g)) offenders.push(`${name}: sendBeacon`);
  }
  assert.deepEqual(offenders, [], 'use mine() or sea() from web/js/api.js');
});

// The inline scripts in the HTML cannot import api.js - the boot-stall reporter exists
// precisely for when the module graph is broken - so they use document-relative paths
// instead, and this is what stops one creeping back to an origin-absolute one. It was a
// real leak: /api/vendor asked one directory too high behind a proxy and reported "the
// island is missing files" when nothing was missing at all.
test('no inline script in a page asks from the origin', () => {
  const web = path.join(HERE, '..', 'web');
  const offenders = [];
  for (const name of fs.readdirSync(web)) {
    if (!name.endsWith('.html')) continue;
    const src = code(fs.readFileSync(path.join(web, name), 'utf8'));
    for (const m of src.matchAll(/(?:fetch|sendBeacon)\((['`])\//g)) offenders.push(`${name}: ${m[0]}…`);
    for (const m of src.matchAll(/(?:href|src)="\/[^"]/g)) offenders.push(`${name}: ${m[0]}…`);
  }
  assert.deepEqual(offenders, [], 'make it relative to the document');
});

test('the socket address is given to net.js rather than guessed from the page', () => {
  const src = code(fs.readFileSync(path.join(WEBJS, 'net.js'), 'utf8'));
  assert.ok(!/location\./.test(src), 'net.js must not read location: the world may be elsewhere');
});

test('no texture prefix resolves against the document any more', () => {
  for (const name of ['world.js', 'buildings.js', 'hamlets.js']) {
    const src = code(fs.readFileSync(path.join(WEBJS, name), 'utf8'));
    assert.ok(!/=\s*'textures\//.test(src), `${name} still has a document-relative texture prefix`);
  }
});

// A loader's path is not a fetch at a glance, which is exactly why these two got missed.
// Both were found by putting the island behind a proxy and reading what it asked for.
test('no asset is loaded from the origin', () => {
  const offenders = [];
  for (const name of fs.readdirSync(WEBJS)) {
    if (!name.endsWith('.js')) continue;
    const src = code(fs.readFileSync(path.join(WEBJS, name), 'utf8'));
    for (const m of src.matchAll(/['`]\/(models|textures|icons|vendor)\//g)) offenders.push(`${name}: ${m[0]}…`);
  }
  assert.deepEqual(offenders, [], 'use textureUrl/modelUrl from web/js/assets.js');
});

// ground-wear.js climbed out of web/js with ../../ to reach shared/. At / that lands on
// /shared/ by accident, because the climb is clamped at the root - so it worked, and
// loaded rng.mjs a second time under a second URL with its own simplex tables. Behind a
// proxy it simply asks outside the island. The import map is the one way in.
test('shared/ is reached through the import map, never by climbing out', () => {
  const offenders = [];
  for (const name of fs.readdirSync(WEBJS)) {
    if (!name.endsWith('.js')) continue;
    const src = code(fs.readFileSync(path.join(WEBJS, name), 'utf8'));
    if (/from\s+['`][.\/]*\.\.\/shared\//.test(src)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], "import from 'shared/…' instead");
});
