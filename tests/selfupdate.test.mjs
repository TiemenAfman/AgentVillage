// The Windows release bringing itself up to date (lib/selfupdate.mjs, Plans/zelf-bijwerken.md).
//
// Played on a fake release in a scratch folder, with GitHub and Windows' tar.exe handed in: the
// download is checked against its checksum, the zip has to say the version it was fetched as,
// the swap puts every piece in place with the old one kept aside, and a swap that fails halfway
// leaves the old release exactly as it was. What cannot run here - tar.exe, renaming a running
// exe, the tray - is Windows' own, and the tray's half is held to the same number below.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { install, installable, swapIn, shaOf, urlsOf, cleanup, RESTART_CODE, TRAY_RESTARTS, ASSET } from '../lib/selfupdate.mjs';

function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'selfupdate-')); }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const read = (file) => fs.readFileSync(file, 'utf8');

// A release folder as scripts/pack-release.mjs lays it out.
function release(dir, version, extra = {}) {
  write(path.join(dir, 'promptholm.exe'), `window ${version}`);
  write(path.join(dir, 'README.txt'), `readme ${version}`);
  write(path.join(dir, 'app', 'promptholm-island.exe'), `islander ${version}`);
  write(path.join(dir, 'app', 'serve.mjs'), `serve ${version}`);
  write(path.join(dir, 'app', 'lib', 'paths.mjs'), `paths ${version}`);
  write(path.join(dir, 'app', 'release.json'), JSON.stringify({ name: 'Promptholm', version }));
  for (const [rel, text] of Object.entries(extra)) write(path.join(dir, rel), text);
}

// GitHub, answering the two URLs of one release; `zip` is any bytes, standing in for the zip.
function github(version, zip, { sha = crypto.createHash('sha256').update(zip).digest('hex') } = {}) {
  const urls = urlsOf(version);
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url === urls.sha) return { ok: true, text: async () => `${sha}  ${ASSET}\n` };
    if (url === urls.zip) return { ok: true, arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) };
    return { ok: false, status: 404 };
  };
  return { fetchImpl, asked };
}

// tar.exe, played by copying a prepared release into the folder it is asked to unpack into.
const unpacksTo = (dir) => async (_zip, into) => fs.cpSync(dir, into, { recursive: true });

test('only an unpacked release on Windows installs, and only something newer', () => {
  const top = scratch(), root = path.join(top, 'app');
  release(top, '0.8.1');
  assert.equal(installable({ root, platform: 'win32', current: '0.8.1', latest: '0.8.2' }), true);
  assert.equal(installable({ root, platform: 'win32', current: '0.8.1', latest: '0.8.1' }), false);
  assert.equal(installable({ root, platform: 'win32', current: '0.8.2', latest: '0.8.1' }), false);
  assert.equal(installable({ root, platform: 'win32', current: '0.8.1', latest: null }), false);
  assert.equal(installable({ root, platform: 'linux', current: '0.8.1', latest: '0.8.2' }), false, 'the release is Windows\'');
  fs.rmSync(path.join(root, 'release.json'));
  assert.equal(installable({ root, platform: 'win32', current: '0.8.1', latest: '0.8.2' }), false, 'a checkout pulls');
});

test('the checksum is read as release.yml writes it', () => {
  const hex = 'a'.repeat(64);
  assert.equal(shaOf(`${hex}  ${ASSET}\n`), hex);
  assert.equal(shaOf(`${hex.toUpperCase()}  ${ASSET}`), hex);
  assert.equal(shaOf('not a hash'), null);
  assert.equal(shaOf(''), null);
  // By its own tag, never latest/download: a release made meanwhile must not pair one zip with another's hash.
  assert.match(urlsOf('0.8.2').zip, /\/download\/v0\.8\.2\/promptholm-windows-x64\.zip$/);
});

test('an update swaps every piece in and keeps the old release aside', async () => {
  const top = scratch(), root = path.join(top, 'app'), next = scratch();
  release(top, '0.8.1', { 'app/lib/gone.mjs': 'only in the old one' });
  release(next, '0.8.2');
  const zip = Buffer.from('the zip of 0.8.2');
  const { fetchImpl, asked } = github('0.8.2', zip);
  const version = await install({ root, current: '0.8.1', latest: '0.8.2', platform: 'win32', fetchImpl, extract: unpacksTo(next) });
  assert.equal(version, '0.8.2');
  assert.deepEqual(asked, [urlsOf('0.8.2').sha, urlsOf('0.8.2').zip]);
  assert.equal(read(path.join(top, 'promptholm.exe')), 'window 0.8.2');
  assert.equal(read(path.join(root, 'promptholm-island.exe')), 'islander 0.8.2');
  assert.equal(read(path.join(root, 'lib', 'paths.mjs')), 'paths 0.8.2');
  assert.equal(JSON.parse(read(path.join(root, 'release.json'))).version, '0.8.2');
  assert.ok(!fs.existsSync(path.join(root, 'lib', 'gone.mjs')), 'a folder is replaced whole');
  // The old release is kept beside it until the next start, the running exes among it.
  const kept = path.join(top, '.update-0.8.2', 'old');
  assert.equal(read(path.join(kept, 'app', 'promptholm-island.exe')), 'islander 0.8.1');
  assert.equal(read(path.join(kept, 'promptholm.exe')), 'window 0.8.1');
  assert.ok(!fs.existsSync(path.join(top, '.update-0.8.2', ASSET)), 'the zip itself is not kept');
  // And the next start clears it.
  cleanup(root);
  assert.ok(!fs.existsSync(path.join(top, '.update-0.8.2')));
  assert.equal(read(path.join(root, 'serve.mjs')), 'serve 0.8.2');
});

test('a download that does not match its checksum changes nothing', async () => {
  const top = scratch(), root = path.join(top, 'app'), next = scratch();
  release(top, '0.8.1');
  release(next, '0.8.2');
  const { fetchImpl } = github('0.8.2', Buffer.from('tampered'), { sha: 'b'.repeat(64) });
  let unpacked = false;
  await assert.rejects(
    install({ root, current: '0.8.1', latest: '0.8.2', platform: 'win32', fetchImpl, extract: async () => { unpacked = true; } }),
    /does not match its checksum/,
  );
  assert.equal(unpacked, false);
  assert.equal(read(path.join(root, 'serve.mjs')), 'serve 0.8.1');
});

test('a zip that is not the version it was fetched as changes nothing', async () => {
  const top = scratch(), root = path.join(top, 'app'), next = scratch();
  release(top, '0.8.1');
  release(next, '0.8.3');
  const zip = Buffer.from('zip');
  await assert.rejects(
    install({ root, current: '0.8.1', latest: '0.8.2', platform: 'win32', fetchImpl: github('0.8.2', zip).fetchImpl, extract: unpacksTo(next) }),
    /is not v0\.8\.2/,
  );
  assert.equal(read(path.join(top, 'promptholm.exe')), 'window 0.8.1');
});

test('a swap that fails halfway puts the old release back as it was', () => {
  const top = scratch(), fresh = scratch(), old = path.join(scratch(), 'old');
  release(top, '0.8.1');
  release(fresh, '0.8.2');
  // A piece that cannot be moved in: a file in the new release where the old has a folder
  // with something in it - rename refuses, as Windows refuses a locked one.
  fs.rmSync(path.join(fresh, 'app', 'lib'), { recursive: true });
  write(path.join(fresh, 'app', 'lib'), 'a file where a folder was');
  fs.mkdirSync(path.join(old, 'app', 'lib', 'paths.mjs'), { recursive: true });
  assert.throws(() => swapIn({ top, fresh, old }), /the old one is back/);
  assert.equal(read(path.join(top, 'promptholm.exe')), 'window 0.8.1');
  assert.equal(read(path.join(top, 'README.txt')), 'readme 0.8.1');
  assert.equal(read(path.join(top, 'app', 'lib', 'paths.mjs')), 'paths 0.8.1');
  assert.equal(read(path.join(top, 'app', 'serve.mjs')), 'serve 0.8.1');
});

test('the tray and serve.mjs agree on the code that means "start me again"', () => {
  // Two languages, one number (src-tauri/src/island.rs RESTART_CODE), and the word the tray
  // puts in node's environment so serve.mjs knows it will be started again.
  const rust = fs.readFileSync(new URL('../src-tauri/src/island.rs', import.meta.url), 'utf8');
  assert.equal(Number(rust.match(/pub const RESTART_CODE: i32 = (\d+);/)[1]), RESTART_CODE);
  assert.ok(rust.includes(`.env("${TRAY_RESTARTS}", "1")`), 'the tray says it restarts');
  const tray = fs.readFileSync(new URL('../src-tauri/src/bin/promptholm-island.rs', import.meta.url), 'utf8');
  assert.ok(tray.includes('island::RESTART_CODE'), 'the tray acts on it');
});
