// web/js/sfx-loader.js: the keeper's recordings are loaded only once sound.js has wanted their
// family, once each, a failure is said once, a family whose files changed is loaded again, and
// one whose files are gone is given back to its computed voice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSfxLoader } from '../web/js/sfx-loader.js';

function rig(files) {
  const wanted = new Set();
  const handed = [];
  const fetched = [];
  const said = [];
  let ctx = null;
  const sound = {
    context: () => ctx,
    wanted: () => [...wanted],
    setSamples: (name, list) => handed.push([name, list.length]),
  };
  const loader = createSfxLoader({
    sound,
    list: async () => files,
    bytes: async (name) => { fetched.push(name); if (name.includes('bad')) throw new Error('404'); return name; },
    decode: async (_ctx, data) => ({ data }),
    log: (line) => said.push(line),
  });
  return { loader, wanted, handed, fetched, said, open: () => { ctx = {}; } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('nothing is fetched before there is a graph, or for a family nobody wanted', async () => {
  const r = rig({ surf: ['surf-1.ogg', 'surf-2.ogg'], gull: ['gull.mp3'] });
  await r.loader.refresh();
  r.wanted.add('surf');
  r.loader.tick();
  assert.deepEqual(r.fetched, [], 'no context: sound is off');
  r.open();
  r.loader.tick();
  await settle(); await settle(); await settle();
  assert.deepEqual(r.fetched, ['surf-1.ogg', 'surf-2.ogg']);
  assert.deepEqual(r.handed, [['surf', 2]]);
  r.loader.tick();
  await settle();
  assert.equal(r.fetched.length, 2, 'once each');
});

test('a file that fails is said once and the rest still play', async () => {
  const r = rig({ gull: ['gull-1.mp3', 'gull-bad.mp3'], moo: ['moo-bad.ogg'] });
  r.open();
  await r.loader.refresh();
  r.wanted.add('gull'); r.wanted.add('moo');
  r.loader.tick();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual(r.handed, [['gull', 1]], 'a family with nothing that plays keeps its own voice');
  assert.equal(r.said.length, 1);
});

test('changed files are loaded again; files gone give the computed voice back', async () => {
  const files = { surf: ['surf-1.ogg'], gull: ['gull.mp3'] };
  const r = rig(files);
  r.open();
  r.wanted.add('surf'); r.wanted.add('gull');
  await r.loader.refresh();
  for (let i = 0; i < 6; i++) await settle();
  files.surf = ['surf-1.ogg', 'surf-2.ogg'];
  delete files.gull;
  await r.loader.refresh();
  for (let i = 0; i < 6; i++) await settle();
  assert.deepEqual(r.handed.slice(2), [['gull', 0], ['surf', 2]]);
});
