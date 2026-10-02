// The Windows release brings itself up to date (Plans/zelf-bijwerken.md).
//
// The islander is node, and node runs out of the very folder that is to be replaced - which is
// fine on Windows for everything but the two exes: node does not hold a module or a served file
// open (serve.mjs reads with readFileSync), so app\lib, app\web and the rest can be swapped
// while the island runs, and a running exe cannot be overwritten but can be renamed. So: fetch
// the zip of the newest release by its own tag, check it against the .sha256 beside it, unpack
// it next to the release, and swap it in piece by piece with the old pieces kept until the swap
// is done - any failure halfway puts back what was moved. Then serve.mjs restarts the island on
// the new code (RESTART_CODE). config.json and data\ live in ~/.promptholm and are never touched.
//
// Only an unpacked release on Windows: a checkout is brought up to date with git, and a linked
// worktree must never write over itself. Every outside effect comes in as an argument
// (`fetchImpl`, `extract`), so tests/selfupdate.test.mjs swaps a fake release on Linux.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

export const ASSET = 'promptholm-windows-x64.zip';
const DOWNLOAD = 'https://github.com/TiemenAfman/AgentVillage/releases/download';
// What serve.mjs exits with to ask the tray for a fresh node (promptholm-island.rs knows it as
// island::RESTART_CODE). 75 is EX_TEMPFAIL: "try again".
export const RESTART_CODE = 75;
// The tray that knows RESTART_CODE says so in node's environment (island.rs spawn_node). An older
// one does not, and serve.mjs then starts its own successor before it goes.
export const TRAY_RESTARTS = 'PROMPTHOLM_TRAY_RESTARTS';
// Where an update is unpacked and the old release kept, beside the release folder.
const WORK = '.update-';

const VERSION = /^\d+(\.\d+)*$/;
function newer(a, b) {
  if (!VERSION.test(a || '') || !VERSION.test(b || '')) return false;
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

export function isRelease(root) { return fs.existsSync(path.join(root, 'release.json')); }

// Can this island install `latest` over itself? `current` is BUILD.version.
export function installable({ root, platform = process.platform, current, latest }) {
  return platform === 'win32' && isRelease(root) && newer(latest, current);
}

export const urlsOf = (version) => ({
  zip: `${DOWNLOAD}/v${version}/${ASSET}`,
  sha: `${DOWNLOAD}/v${version}/${ASSET}.sha256`,
});

// `<hex>  <name>` as release.yml writes it (sha256sum's format); the first word is the hash.
export function shaOf(text) {
  const word = String(text || '').trim().split(/\s+/)[0] || '';
  return /^[0-9a-f]{64}$/i.test(word) ? word.toLowerCase() : null;
}

// Windows' own tar.exe (bsdtar, there since Windows 10 1803) unpacks a zip: no dependency.
export function windowsExtract(zip, into) {
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) => {
    execFile(tar, ['-xf', zip, '-C', into], { windowsHide: true }, (err, _out, stderr) => {
      if (err) reject(new Error(`could not unpack the release: ${String(stderr || err.message).trim().slice(0, 200)}`));
      else resolve();
    });
  });
}

async function fetchOk(fetchImpl, url, what) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { 'User-Agent': 'promptholm-island' }, signal: AbortSignal.timeout(120e3) });
  } catch (e) {
    throw new Error(`could not fetch the ${what}: ${e && e.message ? e.message : e}`);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the ${what}`);
  return res;
}

// The pieces of a release, as paths relative to the release folder (the one above app\): every
// entry at the top except app itself, and every entry inside app. Replaced whole, so a file a
// newer release left out of lib\ goes with the old lib\.
function piecesOf(dir) {
  const top = fs.readdirSync(dir).filter((n) => n !== 'app');
  const app = fs.existsSync(path.join(dir, 'app')) ? fs.readdirSync(path.join(dir, 'app')).map((n) => path.join('app', n)) : [];
  return [...top, ...app];
}

// Move the new pieces in, the old ones aside. All or nothing: on a failure everything moved so
// far goes back, last first, and the error is thrown on.
export function swapIn({ top, fresh, old }) {
  const done = [];
  try {
    for (const rel of piecesOf(fresh)) {
      const target = path.join(top, rel);
      const step = { rel, kept: false, placed: false };
      done.push(step);
      if (fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(path.join(old, rel)), { recursive: true });
        fs.renameSync(target, path.join(old, rel));
        step.kept = true;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(path.join(fresh, rel), target);
      step.placed = true;
    }
  } catch (e) {
    for (const step of done.reverse()) {
      const target = path.join(top, step.rel);
      try { if (step.placed) fs.renameSync(target, path.join(fresh, step.rel)); } catch { /* best effort */ }
      try { if (step.kept) fs.renameSync(path.join(old, step.rel), target); } catch { /* best effort */ }
    }
    throw new Error(`could not put the new release in place, the old one is back: ${e && e.message ? e.message : e}`);
  }
}

// The whole update. `root` is app\ (serve.mjs's ROOT); resolves with the version now in place.
export async function install({ root, current, latest, platform = process.platform, fetchImpl = globalThis.fetch, extract = windowsExtract, log = () => {} }) {
  if (!installable({ root, platform, current, latest })) {
    throw new Error(isRelease(root) ? `v${latest} is not newer than v${current}` : 'only an unpacked release can bring itself up to date - a checkout pulls');
  }
  const top = path.dirname(root);
  const work = path.join(top, `${WORK}${latest}`);
  fs.rmSync(work, { recursive: true, force: true });
  const fresh = path.join(work, 'new'), old = path.join(work, 'old'), zip = path.join(work, ASSET);
  fs.mkdirSync(fresh, { recursive: true });

  const urls = urlsOf(latest);
  log(`update: fetching v${latest}`);
  const want = shaOf(await (await fetchOk(fetchImpl, urls.sha, 'checksum')).text());
  if (!want) throw new Error('the release\'s checksum does not read as one');
  const body = Buffer.from(await (await fetchOk(fetchImpl, urls.zip, 'release')).arrayBuffer());
  const got = crypto.createHash('sha256').update(body).digest('hex');
  if (got !== want) throw new Error('the download does not match its checksum, so nothing was changed');
  fs.writeFileSync(zip, body);

  await extract(zip, fresh);
  let said = null;
  try { said = JSON.parse(fs.readFileSync(path.join(fresh, 'app', 'release.json'), 'utf8')).version; } catch { /* checked below */ }
  if (said !== latest) throw new Error(`the zip is not v${latest} (it says ${said || 'nothing'}), so nothing was changed`);
  for (const must of ['promptholm.exe', path.join('app', 'serve.mjs'), path.join('app', 'promptholm-island.exe')]) {
    if (!fs.existsSync(path.join(fresh, must))) throw new Error(`the zip has no ${must}, so nothing was changed`);
  }

  swapIn({ top, fresh, old });
  fs.rmSync(zip, { force: true });
  log(`update: v${latest} is in place, the old release is kept in ${path.relative(top, old)} until the next start`);
  return latest;
}

// At start: what an earlier update kept aside. A tray exe still running from there is busy and
// stays until the start after it has gone.
export function cleanup(root, log = () => {}) {
  if (!isRelease(root)) return;
  const top = path.dirname(root);
  let names = [];
  try { names = fs.readdirSync(top); } catch { return; }
  for (const name of names.filter((n) => n.startsWith(WORK))) {
    try { fs.rmSync(path.join(top, name), { recursive: true, force: true }); log(`update: cleared ${name}`); } catch { /* busy: next time */ }
  }
}
