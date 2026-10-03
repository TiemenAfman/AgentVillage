// The browser version (Plans/spelen-in-de-browser.md): which page is which, which controls show,
// what the banner says, and what the pack lays out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handheldOf, firstInputMode, nextInputMode, padUsed } from '../web/js/device.js';
import { webNotice, SEA_PROTOCOL } from '../web/js/update.js';
import { shelfId, contentStamp, doorHtml, shelfJson, webManifest, withStandalone, copyPage, ROOM_ONLY } from '../scripts/pack-page.mjs';
import { OPEN_SEA as PACKED_SEA } from '../scripts/pack-web.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('the graphics tier comes from the machine, not from having no islander', () => {
  assert.equal(handheldOf({ app: true }), true, 'the app is a phone whatever it reports');
  assert.equal(handheldOf({ coarse: true, hover: false }), true, 'a phone or tablet browser');
  assert.equal(handheldOf({ coarse: true, hover: true }), false, 'a touch laptop with a mouse is a laptop');
  assert.equal(handheldOf({ coarse: false, hover: true }), false, 'a desktop in a browser is a desktop');
});

test('which controls a page starts with', () => {
  assert.equal(firstInputMode({ app: true, standalone: true }), 'touch');
  assert.equal(firstInputMode({ standalone: false, handheld: true }), 'desk', 'an islander page grew thumb controls');
  assert.equal(firstInputMode({ standalone: true, handheld: true }), 'touch');
  assert.equal(firstInputMode({ standalone: true, handheld: false }), 'desk');
});

test('a finger shows the thumbs, a key, a mouse or a pad hides them, and the app never changes', () => {
  assert.equal(nextInputMode('desk', { type: 'pointerdown', pointerType: 'touch' }), 'touch');
  assert.equal(nextInputMode('desk', { type: 'pointerdown', pointerType: 'pen' }), 'touch');
  assert.equal(nextInputMode('desk', { type: 'pointermove', pointerType: 'touch' }), 'desk', 'a finger moving is not a new touch');
  assert.equal(nextInputMode('touch', { type: 'keydown' }), 'desk');
  assert.equal(nextInputMode('touch', { type: 'pointermove', pointerType: 'mouse' }), 'desk');
  assert.equal(nextInputMode('touch', { type: 'pad' }), 'desk');
  assert.equal(nextInputMode('touch', { type: 'keydown' }, { app: true }), 'touch', 'a keyboard on a phone hid its controls');
  assert.equal(nextInputMode('touch', { type: 'wheel' }), 'touch');
});

test('a resting pad is not somebody using it', () => {
  assert.equal(padUsed(null), false);
  assert.equal(padUsed({ anyHit: false, move: { x: 0.1, y: 0.05 }, look: { x: 0, y: 0 } }), false);
  assert.equal(padUsed({ anyHit: true, move: { x: 0, y: 0 } }), true);
  assert.equal(padUsed({ anyHit: false, move: { x: 0, y: 0.9 } }), true);
});

test('a newer shelf is a reload, by the shelf and not only by the version', () => {
  const mine = { version: '0.8.1', commit: 'aaaaaaa' };
  const shelf = '0.8.1-aaaaaaa';
  assert.equal(webNotice({ mine, shelf, served: { version: '0.8.1', path: shelf } }), null, 'the page nagged about itself');
  const fix = webNotice({ mine, shelf, served: { version: '0.8.1', path: '0.8.1-bbbbbbb' } });
  assert.equal(fix.kind, 'reload', 'a second build of one version was not offered');
  assert.match(fix.html, /data-update-reload/);
  assert.equal(webNotice({ mine, shelf, served: { version: '0.9.0', path: '0.9.0-ccccccc' } }).kind, 'reload');
  assert.equal(webNotice({ mine, shelf, served: { version: '0.8.0', path: '0.8.0-ddddddd' } }), null,
    'a rollback on the server was offered as an update');
  assert.equal(webNotice({ mine, shelf, served: null }), null, 'no version.json is nothing to say');
});

test('without a newer shelf, what the sea says - and never a download', () => {
  const mine = { version: '0.8.1', commit: 'aaaaaaa' };
  const shelf = '0.8.1-aaaaaaa';
  const served = { version: '0.8.1', path: shelf };
  const moved = webNotice({ mine, shelf, served, speaks: SEA_PROTOCOL + 1 });
  assert.equal(moved.kind, 'wait');
  assert.doesNotMatch(moved.html, /href=|apk/i, 'the web was sent to download something');
  assert.equal(webNotice({ mine, shelf, served, speaks: SEA_PROTOCOL - 1 }).kind, 'sea-behind');
  assert.equal(webNotice({ mine, shelf, served, sea: { version: '0.9.0' } }).kind, 'behind');
  assert.equal(webNotice({ mine, shelf, served, sea: { version: '0.8.4' } }), null, 'a patch apart nagged');
  assert.equal(webNotice({ mine, shelf, served, sea: { version: '0.7.2' } }).kind, 'sea-behind');
  // A newer page wins over the sea's news: it is the thing that fixes it.
  assert.equal(webNotice({ mine, shelf, served: { version: '0.9.0', path: 'x' }, speaks: SEA_PROTOCOL + 1 }).kind, 'reload');
});

test('a shelf is named so a path can hold it', () => {
  assert.equal(shelfId({ version: '0.8.1', commit: 'c633e4d' }), '0.8.1-c633e4d');
  assert.equal(shelfId({ version: '0.8.1', commit: null }), '0.8.1');
  assert.equal(shelfId({ version: null, commit: null }), 'dev');
  assert.equal(shelfId({ version: '../0.8"<x', commit: 'c633e4d9999' }), '..0.8x-c633e4d');
  // A Portainer git stack has no commit to give: the content hash names the build instead.
  assert.equal(shelfId({ version: '0.8.2', commit: null }, 'abcdef0123'), '0.8.2-abcdef0');
  assert.equal(shelfId({ version: '0.8.2', commit: '57d081c' }, 'abcdef0'), '0.8.2-57d081c', 'the stamp outranked the commit');
});

test('the content stamp follows the files and nothing else', () => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  const a = path.join(at, 'web'), b = path.join(at, 'shared');
  fs.mkdirSync(path.join(a, 'js'), { recursive: true });
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'js', 'main.js'), 'one');
  fs.writeFileSync(path.join(a, 'js', 'krakenkit-mesh.js'), 'room');
  fs.writeFileSync(path.join(b, 'terrain.mjs'), 'ground');
  const skip = (p) => ROOM_ONLY.has(path.basename(p));
  const first = contentStamp([a, b], skip);
  assert.match(first, /^[0-9a-f]{7}$/);
  assert.equal(contentStamp([a, b], skip), first, 'the same tree named itself twice');
  fs.writeFileSync(path.join(a, 'js', 'krakenkit-mesh.js'), 'another room');
  assert.equal(contentStamp([a, b], skip), first, 'a file left out of the pack moved the name');
  fs.writeFileSync(path.join(a, 'js', 'main.js'), 'two');
  assert.notEqual(contentStamp([a, b], skip), first, 'a changed module kept the old shelf name');
  fs.rmSync(at, { recursive: true, force: true });
});

test('the door keeps the query, and the pointer names the shelf', () => {
  const html = doorHtml('0.8.1-c633e4d');
  assert.match(html, /location\.replace\("\.\/0\.8\.1-c633e4d\/" \+ location\.search \+ location\.hash\)/);
  assert.match(html, /<a href="\.\/0\.8\.1-c633e4d\/"/, 'no way in without scripts');
  assert.deepEqual(JSON.parse(shelfJson({ version: '0.8.1', commit: 'c633e4d' }, '0.8.1-c633e4d')),
    { version: '0.8.1', commit: 'c633e4d', path: '0.8.1-c633e4d' });
});

test('an installed web page starts at the door, not on the shelf it came from', () => {
  const m = JSON.parse(webManifest(read('web/manifest.webmanifest')));
  assert.equal(m.start_url, '../');
  assert.equal(m.scope, '../');
  assert.equal(m.name, 'Promptholm');
});

test('the head says web, and nothing in it can close the tag', () => {
  const html = withStandalone('<head><script>x</script>', { sea: 'https://s/</script>', host: 'web' });
  assert.match(html, /^<head><script>window\.PROMPTHOLM_STANDALONE = \{.*"host":"web".*\};<\/script>\n<script>x/);
  assert.equal(html.split('</script>').length - 1, 2, 'the sea address closed the tag');
});

test('the pack leaves the room sets out and keeps the import map\'s shared/', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'play-'));
  const web = path.join(out, 'web'), shared = path.join(out, 'shared');
  fs.mkdirSync(path.join(web, 'js'), { recursive: true });
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(web, 'index.html'), '<script></script>');
  for (const f of [...ROOM_ONLY, 'main.js']) fs.writeFileSync(path.join(web, 'js', f), '');
  fs.writeFileSync(path.join(shared, 'terrain.mjs'), '');
  const dest = path.join(out, 'shelf');
  copyPage({ web, shared, out: dest });
  assert.deepEqual(fs.readdirSync(path.join(dest, 'js')), ['main.js']);
  assert.ok(fs.existsSync(path.join(dest, 'shared', 'terrain.mjs')));
  fs.rmSync(out, { recursive: true, force: true });
});

test('the web pack names the same open sea as the islander', async () => {
  // pack-web.mjs may not import lib/paths.mjs (it moves an island on import), so it has a copy.
  const src = read('lib/paths.mjs');
  const at = src.match(/export const OPEN_SEA = '([^']+)'/);
  assert.equal(PACKED_SEA, at[1]);
  assert.doesNotMatch(read('scripts/pack-web.mjs'), /lib\/paths\.mjs'/, 'pack-web imports lib/paths.mjs');
  assert.doesNotMatch(read('scripts/pack-page.mjs'), /lib\/paths\.mjs'/);
});

test('the app keeps its own Rust and gate; the web asks only its shelf', () => {
  const main = read('web/js/main.js');
  assert.match(main, /const gate = APP \? updateGate\(/, 'the web could be handed the APK gate on a refusal');
  assert.match(main, /const gate = APP \? appGate\(\)/, 'the web could be handed the APK gate on a welcome');
  assert.match(main, /if \(WEB_PLAY\) \{ askShelf\(\); return; \}\n\s+const ipc/, 'the web reaches for latest_release');
  // The phone's layout rules that are for thumbs moved to body.touch; the app carries both.
  const css = read('web/css/ui.css');
  for (const rule of ['body.touch #toasts {', 'body.touch .chip {', 'body.touch .speech {']) assert.ok(css.includes(rule), rule);
  assert.doesNotMatch(css, /body\.standalone \.chip \{/, 'a thumb rule stayed on every page without an islander');
});

test('the nginx shelf serves modules as JavaScript and the door uncached', () => {
  const conf = read('deploy/play/nginx.conf');
  assert.match(conf, /\\\.mjs\$ \{\s*types \{ \}\s*default_type application\/javascript/);
  assert.match(conf, /location = \/play\/version\.json \{ add_header Cache-Control "no-cache"/);
  assert.match(conf, /gzip_static on/);
  assert.match(conf, /immutable/);
  const compose = read('docker-compose.play.yml');
  assert.match(compose, /pull_policy: build/, 'a webhook redeploy would fail on pull access denied');
  assert.match(read('.github/workflows/release.yml'), /refs\/heads\/play/);
});
