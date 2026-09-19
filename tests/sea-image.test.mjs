// The box the sea goes in, and the one promise it has to keep.
//
// The image copies three things - sea.mjs, lib/ and shared/ - and copies them by name
// rather than copying the tree, because the tree contains the scanner, the mail server
// and the agent dispatcher, and none of those belong on a machine with a public address.
// That naming is also the failure mode: an import added to a fourth folder works on this
// laptop and produces a container that exits on its first line, on a box nobody watches.
//
// So this walks the sea's real import graph and checks every file in it is inside
// something the Dockerfile actually copies. It is the same walk tests/sea-join.test.mjs
// makes for a different reason, and it is written out again rather than shared because
// the two would drift apart the moment either one grew a special case.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../sea.mjs', import.meta.url)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function graph() {
  const seen = new Set();
  const walk = (f) => {
    f = path.resolve(f);
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import .*from '([^']+)'/gm)) {
      if (m[1].startsWith('node:')) continue;
      walk(path.join(path.dirname(f), m[1]));
    }
  };
  walk(path.join(root, 'sea.mjs'));
  return [...seen].map((f) => path.relative(root, f).split(path.sep).join('/'));
}

test('everything the sea imports is in the image', () => {
  const docker = read('Dockerfile.sea');
  // What the COPY lines actually name. Parsed rather than written down here, so that
  // removing one from the Dockerfile fails this instead of quietly agreeing with it.
  const copied = [...docker.matchAll(/^COPY[^\n]*?\s(\S+)\s+\.\/(\S*)$/gm)].map((m) => m[1]);
  assert.ok(copied.length >= 3, `only found ${copied.length} COPY lines: ${copied}`);

  const inside = (f) => copied.some((c) => (c.endsWith('/') ? f.startsWith(c) : f === c));
  const files = graph();
  assert.ok(files.length > 10, 'the walk found almost nothing, so it is not walking');
  const missing = files.filter((f) => !inside(f));
  assert.deepEqual(missing, [], `the image would not contain ${missing.join(', ')}`);
});

test('the image runs the sea open, on the port the compose file publishes', () => {
  const docker = read('Dockerfile.sea');
  const compose = read('docker-compose.sea.yml');

  // Inside a container, loopback is nobody. What keeps this shut is the network it is
  // published on and SEA_KEY, not the bind address - and forgetting --open produces a
  // container that is healthy, logs nothing wrong and answers no one.
  assert.match(docker, /CMD \[.*"--open".*\]/, 'the image would bind to loopback inside its own container');

  const port = (docker.match(/ENV SEA_PORT=(\d+)/) || [])[1];
  assert.ok(port, 'the image does not say which port it is on');
  assert.match(docker, new RegExp(`EXPOSE ${port}`));
  assert.match(compose, new RegExp(`"${port}:${port}"`), 'the compose file publishes a different port than the image listens on');
  assert.match(compose, new RegExp(`SEA_PORT: ${port}`));
});

test('the box holds nothing, and says so by having nowhere to put it', () => {
  const compose = read('docker-compose.sea.yml');
  // A volume here would be an invitation to start persisting something, and "the sea
  // writes nothing down" is what makes it safe to leave on a public address.
  assert.doesNotMatch(compose, /^\s*volumes:/m, 'the sea has been given somewhere to write');
  // And the key has to be reachable from the stack environment, or a keeper cannot set one.
  assert.match(compose, /SEA_KEY: \$\{SEA_KEY/);
});

test('a 404 says what was asked for, not only what exists', async () => {
  // Behind a reverse proxy these are different questions. A proxy that rewrites - a forward
  // path in Nginx Proxy Manager, a location with a trailing slash - turns every route into
  // this 404, and a message that lists the routes without naming the path reads as "the sea
  // is broken" when it means "your proxy is sending me somewhere else". Measured on a live
  // one: /health, /world and /island/:id all came back identical and said nothing.
  const { afloat } = await import('./support/sea.mjs');
  await afloat(async ({ base }) => {
    const r = await fetch(`${base}/somewhere/else`);
    assert.equal(r.status, 404);
    const said = await r.json();
    assert.equal(said.asked, '/somewhere/else');
    assert.match(said.error, /\/somewhere\/else/);
  });
});
