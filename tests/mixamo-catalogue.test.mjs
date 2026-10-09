// The motion workbench's Mixamo catalogue (web/js/mixamo-catalogue.js, lib/mixamo.mjs): the keeper's
// own library browsed and tried on our bodies. Adobe's files, so the two routes are keeper-only, serve
// nothing but a bare `<word>.fbx` out of anims/y-bot (never the token beside it), and the FBXLoader
// stays off every page but the workbench.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { listClips, clipPath, isClipName, mixamoDirOf, clipsDirOf, MIXAMO_DEFAULT } from '../lib/mixamo.mjs';
import { isPublicPath } from '../lib/access.mjs';
import { categoriesOf, clipKey, exportChoice } from '../web/js/mixamo-catalogue.js';
import { GAIT_CLIPS, GAIT_JOINTS } from '../web/js/gait-clips.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mixamo-'));
  const dir = clipsDirOf(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, 'token.txt'), 'secret');
  fs.writeFileSync(path.join(dir, 'walking.fbx'), 'fbx');
  fs.writeFileSync(path.join(dir, 'walking.json'), JSON.stringify({ name: 'Walking', id: 'abc', description: 'Normal walk', settings: { inplace: false } }));
  fs.writeFileSync(path.join(dir, 'no-manifest.fbx'), 'fbx');
  fs.writeFileSync(path.join(dir, 'index.json'), '{}');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  return root;
}

test('the library lists every fbx with its manifest, and nothing else', () => {
  const root = library();
  const { clips, missing } = listClips(root);
  assert.equal(missing, false);
  assert.deepEqual(clips.map((c) => c.file), ['no-manifest.fbx', 'walking.fbx']);
  const walk = clips.find((c) => c.file === 'walking.fbx');
  assert.equal(walk.name, 'Walking');
  assert.equal(walk.id, 'abc');
  assert.equal(walk.seconds, null, 'a manifest without a length says none');
  assert.equal(listClips(path.join(root, 'nowhere')).missing, true);
});

test('only a bare .fbx in anims/y-bot is served', () => {
  const root = library();
  assert.equal(clipPath(root, 'walking.fbx'), path.join(clipsDirOf(root), 'walking.fbx'));
  for (const bad of ['../token.txt', '..\\token.txt', 'token.txt', '../../token.txt', 'a/walking.fbx', 'a\\walking.fbx',
    '..', '.fbx', 'walking.json', 'walking.fbx.json', 'walking..fbx', 'nope.fbx', '', null, undefined, 'C:\\x.fbx', '/etc/x.fbx']) {
    assert.equal(clipPath(root, bad), null, String(bad));
  }
  assert.equal(isClipName('180-turn-w-briefcase-c9c9ee12.fbx'), true);
});

test('the folder is the config\'s, else MIXAMO_OUT, else the fetcher\'s default', () => {
  assert.equal(mixamoDirOf({ mixamo: { dir: path.resolve('/lib/mixamo') } }, {}), path.resolve('/lib/mixamo'));
  assert.equal(mixamoDirOf({ mixamo: { dir: 'relative' } }, { MIXAMO_OUT: 'E:\\M' }), 'E:\\M');
  assert.equal(mixamoDirOf({}, {}), MIXAMO_DEFAULT);
  const fetcher = fs.readFileSync(path.join(ROOT, 'scripts', 'mixamo-fetch.mjs'), 'utf8');
  assert.match(fetcher, /DEFAULT_OUT = process\.env\.MIXAMO_OUT \|\| 'D:\\\\Mixamo'/, 'the same default as the fetcher');
});

test('both routes are keeper-only and go through lib/mixamo.mjs', () => {
  for (const p of ['/api/mixamo', '/api/mixamo/walking.fbx']) assert.equal(isPublicPath(p), false, p);
  const access = fs.readFileSync(path.join(ROOT, 'lib', 'access.mjs'), 'utf8');
  assert.doesNotMatch(access.match(/PUBLIC_API = new Set\(\[[^\]]*\]\)/)[0], /mixamo/);
  const serve = fs.readFileSync(path.join(ROOT, 'serve.mjs'), 'utf8');
  assert.match(serve, /p === '\/api\/mixamo'\) \{\s*const \{ clips, missing \} = listClips\(mixamoDirOf\(config\)\)/);
  assert.match(serve, /const file = clipPath\(mixamoDirOf\(config\), name\);\s*if \(!file\) return json\(res, 404/);
  // and the sea, a bundle or a release never names it
  for (const f of ['sea.mjs', 'lib/sea.mjs', 'lib/islandbundle.mjs', 'scripts/pack-release.mjs', 'scripts/pack-page.mjs']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /mixamo/i, f);
  }
});

test('the FBXLoader is the workbench\'s alone, and loaded only when a clip is played', () => {
  const cat = fs.readFileSync(path.join(ROOT, 'web', 'js', 'mixamo-catalogue.js'), 'utf8');
  assert.doesNotMatch(cat, /^import .*FBXLoader/m);
  assert.match(cat, /import\('three\/addons\/loaders\/FBXLoader\.js'\)/);
  assert.match(cat, /mine\(`\/api\/mixamo\//, 'through the islander, never a bare fetch');
  const importers = fs.readdirSync(path.join(ROOT, 'web', 'js')).filter((f) => f.endsWith('.js')
    && /from '\.\/mixamo-(catalogue|preview)\.js'/.test(fs.readFileSync(path.join(ROOT, 'web', 'js', f), 'utf8')));
  assert.deepEqual(importers.sort(), ['avatar-motion.js', 'mixamo-catalogue.js']);
  const vendor = fs.readFileSync(path.join(ROOT, 'scripts', 'vendor.mjs'), 'utf8');
  for (const f of ['loaders/FBXLoader.js', 'libs/fflate.module.js', 'curves/NURBSCurve.js', 'curves/NURBSUtils.js']) {
    assert.ok(vendor.includes(`'addons/${f}'`), f);
  }
});

test('categories, keys and the export are in clips.json\'s shape', () => {
  assert.ok(categoriesOf({ name: 'Climbing Ladder', description: '' }).includes('climb'));
  assert.ok(categoriesOf({ name: 'Sitting Idle', description: 'Sitting Still In A Chair' }).includes('sit'));
  assert.ok(categoriesOf({ name: 'Great Sword Slash', description: '' }).includes('sword'));
  assert.equal(clipKey('Standing Idle'), 'standingIdle');
  assert.equal(clipKey('180 Turn W/ Briefcase'), 'clip180TurnWBriefcase');
  const out = exportChoice([{ name: 'Walking', file: 'walking.fbx', id: 'a' }, { name: 'Walking', file: 'walking-c9.fbx', id: 'b' }]);
  assert.deepEqual(out.clips, { walking: 'walking.fbx', walking2: 'walking-c9.fbx' });
  assert.deepEqual(out.picked[1], { key: 'walking2', name: 'Walking', file: 'walking-c9.fbx', id: 'b' });
});

// The preview's conversion against the bake itself, on a clip the bake was made from - when the
// keeper's library is on this machine (it is not in git).
const HANG = path.join(clipsDirOf(process.env.MIXAMO_OUT || MIXAMO_DEFAULT), 'hanging-idle.fbx');
test('a clip converted in the browser is the baked clip, joint for joint', { skip: !fs.existsSync(HANG) && 'no Mixamo library here' }, async () => {
  const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const { previewClip } = await import('../web/js/mixamo-preview.js');
  const buf = fs.readFileSync(HANG);
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const c = previewClip(fbx, fbx.animations[0]);
  const B = GAIT_CLIPS.hang;
  assert.ok(Math.abs(c.seconds - B.seconds) < 0.01);
  for (const u of [0, 0.25, 0.5, 0.75]) {
    const a = c.rows[Math.round(u * (c.rows.length - 1))], b = B.rows[Math.round(u * B.rows.length)];
    for (let j = 0; j < GAIT_JOINTS.length; j++) {
      const qa = new THREE.Quaternion(...a.slice(j * 4, j * 4 + 4)), qb = new THREE.Quaternion(...b.slice(j * 4, j * 4 + 4));
      assert.ok(qa.angleTo(qb) < 0.05, `${GAIT_JOINTS[j]} at ${u}: ${(qa.angleTo(qb) * 180 / Math.PI).toFixed(1)} degrees`);
    }
    assert.ok(Math.abs(a.at(-1) - b.at(-1)) < 0.01, 'the hips\' drop');
  }
});
