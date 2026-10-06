// The Mixamo downloader, offline: a fake mixamo.com answers, and what the script asks it and
// writes down is checked. Nothing here reaches the network or needs a token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildExport, cleanToken, readToken, slug, fileFor, createClient, fetchAll, findCharacter,
  parseArgs, ANIM_PREFS } from '../scripts/mixamo-fetch.mjs';

const TOKEN = 'secret-token-123';
const YBOT = { id: 'ybot-0000-1111', name: 'Y Bot', type: 'Character' };
const WALK = { id: 'aaaaaaaa-walk-1', name: 'Walking', type: 'Motion', description: 'Walking' };
const WALK2 = { id: 'bbbbbbbb-walk-2', name: 'Walking', type: 'Motion', description: 'Walking Backwards' };
const GMS = { 'model-id': 101, mirror: false, trim: [0, 100], overdrive: 0, params: [['Posture', 0.5], ['Arm Space', 0]], 'arm-space': 0, inplace: false };

function fakeMixamo({ fail429 = 0 } = {}) {
  const calls = [];
  let polls = 0;
  let lastExport = null;
  const res = (status, body, headers = {}) => ({
    status, ok: status < 400, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body, text: async () => JSON.stringify(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  });
  async function fetch(url, init = {}) {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('https://storage.example/')) return res(200, `FBX:${url.split('/').pop()}`);
    if (init.headers?.Authorization !== `Bearer ${TOKEN}`) return res(401, {});
    if (fail429 > 0) { fail429--; return res(429, {}, { 'retry-after': '1' }); }
    const u = new URL(url);
    if (u.pathname === '/api/v1/products') {
      const type = u.searchParams.get('type');
      const q = u.searchParams.get('query').toLowerCase();
      const all = type === 'Character' ? [YBOT, { id: 'xbot', name: 'X Bot', type: 'Character' }] : [WALK, WALK2];
      return res(200, { results: all.filter((p) => p.name.toLowerCase().includes(q)), pagination: { page: 1, num_pages: 1 } });
    }
    if (u.pathname.startsWith('/api/v1/products/')) return res(200, { details: { gms_hash: GMS } });
    if (u.pathname === '/api/v1/animations/export') { lastExport = JSON.parse(init.body); polls = 0; return res(200, { status: 'processing' }); }
    if (u.pathname.endsWith('/monitor')) {
      polls++;
      if (polls < 2) return res(200, { status: 'processing' });
      return res(200, { status: 'completed', job_result: `https://storage.example/${lastExport.product_name.replace(/ /g, '_')}.fbx` });
    }
    return res(404, {});
  }
  return { fetch, calls };
}

const client = (fake, extra = {}) => createClient({ token: TOKEN, fetch: fake.fetch, delay: 0, wait: async () => {}, ...extra });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mixamo-'));

test('a token pasted from DevTools is cleaned, and MIXAMO_TOKEN wins over the file', () => {
  assert.equal(cleanToken('"Bearer abc.def"\n'), 'abc.def');
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'token.txt'), 'from-file\r\n');
  assert.equal(readToken({ tokenFile: path.join(dir, 'token.txt'), env: {} }), 'from-file');
  assert.equal(readToken({ tokenFile: path.join(dir, 'token.txt'), env: { MIXAMO_TOKEN: 'from-env' } }), 'from-env');
  assert.equal(readToken({ tokenFile: path.join(dir, 'missing.txt'), env: {} }), '');
  assert.throws(() => createClient({ token: '' }), /no token/);
});

test('an animation is exported as FBX Binary without skin, 30 fps, no reduction, In Place off', () => {
  const body = buildExport({ character: YBOT, product: WALK, gmsHash: GMS });
  assert.deepEqual(body.preferences, { format: 'fbx7', skin: 'false', fps: '30', reducekf: '0', inplace: 'false' });
  assert.equal(body.character_id, YBOT.id);
  assert.equal(body.product_name, 'Walking');
  assert.equal(body.type, 'Motion');
  assert.equal(body.gms_hash.length, 1);
  assert.equal(body.gms_hash[0].params, '0.5,0', 'params go as their values, comma-separated');
  assert.equal(body.gms_hash[0].inplace, false);
  assert.equal(buildExport({ character: YBOT, product: WALK, gmsHash: GMS, inplace: true }).gms_hash[0].inplace, true);
});

test('a character is exported with skin in T-pose', () => {
  const body = buildExport({ character: YBOT, product: YBOT });
  assert.equal(body.type, 'Character');
  assert.equal(body.gms_hash, null);
  assert.equal(body.preferences.skin, 'true');
  assert.equal(body.preferences.mesh, 't-pose');
});

test('file names: lower case with dashes, the id only when the name is taken', () => {
  assert.equal(slug('Standing Idle'), 'standing-idle');
  assert.equal(slug('Hip Hop Dancing (2)'), 'hip-hop-dancing-2');
  const index = {};
  assert.equal(fileFor(index, WALK), 'walking.fbx');
  index[WALK.id] = 'walking.fbx';
  assert.equal(fileFor(index, WALK2), 'walking-bbbbbbbb.fbx');
  assert.equal(fileFor(index, WALK), 'walking.fbx', 'a known id keeps its file');
});

test('a whole run: export, poll, download, manifest - and a second run fetches nothing', async () => {
  const fake = fakeMixamo();
  const c = client(fake);
  const character = await findCharacter(c, { name: 'y bot' });
  assert.deepEqual(character, { id: YBOT.id, name: 'Y Bot' });
  const dir = tmp();
  const logs = [];
  const done = await fetchAll(c, [WALK, WALK2], { dir, character, log: (s) => logs.push(s), now: () => '2026-10-06T12:00:00.000Z' });
  assert.deepEqual(done, { fetched: 2, skipped: 0, failed: [] });
  assert.equal(fs.readFileSync(path.join(dir, 'walking.fbx'), 'utf8'), 'FBX:Walking.fbx');
  assert.ok(fs.existsSync(path.join(dir, 'walking-bbbbbbbb.fbx')));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'walking.json'), 'utf8'));
  assert.deepEqual(manifest, {
    name: 'Walking', id: WALK.id, type: 'Motion', description: 'Walking',
    character: { id: YBOT.id, name: 'Y Bot' },
    settings: { ...ANIM_PREFS, inplace: false },
    file: 'walking.fbx', bytes: 15, downloadedAt: '2026-10-06T12:00:00.000Z', source: 'mixamo.com',
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')),
    { [WALK.id]: 'walking.fbx', [WALK2.id]: 'walking-bbbbbbbb.fbx' });
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.part')));

  const exp = fake.calls.find((c) => c.url.endsWith('/animations/export'));
  assert.equal(exp.method, 'POST');
  assert.equal(exp.headers['X-Api-Key'], 'mixamo2');
  assert.ok(fake.calls.filter((c) => c.url.startsWith('https://storage.example/')).every((c) => !c.headers.Authorization),
    'the signed download URL is fetched without the bearer token');

  // Nothing written anywhere carries the token.
  for (const f of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes(TOKEN), f);
  assert.ok(!logs.join('\n').includes(TOKEN));

  const before = fake.calls.length;
  const again = await fetchAll(c, [WALK, WALK2], { dir, character, log: () => {} });
  assert.deepEqual(again, { fetched: 0, skipped: 2, failed: [] });
  assert.equal(fake.calls.length, before, 'a resumed run asks mixamo.com nothing for what it has');
});

test('429 is waited out, an expired token stops the run', async () => {
  const fake = fakeMixamo({ fail429: 2 });
  const waits = [];
  const c = client(fake, { wait: async (ms) => { waits.push(ms); } });
  const hits = await c.search({ kind: 'anims', query: 'walk' });
  assert.equal(hits.length, 2);
  assert.deepEqual(waits, [1000, 1000], 'Retry-After is honoured');

  const bad = createClient({ token: 'wrong', fetch: fakeMixamo().fetch, delay: 0, wait: async () => {} });
  await assert.rejects(fetchAll(bad, [WALK], { dir: tmp(), character: YBOT, log: () => {} }), /token has expired/);
});

test('a pack and a dry run fetch nothing', async () => {
  const fake = fakeMixamo();
  const dir = tmp();
  const done = await fetchAll(client(fake), [{ id: 'p1', name: 'Sword Pack', type: 'MotionPack' }, WALK],
    { dir, character: YBOT, dryRun: true, log: () => {} });
  assert.equal(done.fetched, 0);
  assert.equal(done.failed.length, 1);
  assert.equal(fake.calls.length, 0);
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['anims', 'Walking', '--character', 'X Bot', '--all', '--max', '3']),
    { _: ['anims', 'Walking'], character: 'X Bot', all: true, max: '3' });
});
