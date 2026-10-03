#!/usr/bin/env node
// Lays out the island for the browser: a page anybody can play without the app or an install,
// served by a small nginx on the keeper's home server (Plans/spelen-in-de-browser.md).
//
//   dist/play/
//     <id>/            a copy of web/ + shared/, exactly as the app carries it (pack-page.mjs),
//                      with PROMPTHOLM_STANDALONE = { sea, build, host: 'web', shelf: <id> }
//                      and a .gz beside every file worth compressing
//     version.json     { version, commit, path: <id> } - which shelf the door leads to
//     index.html       the door: a redirect to ./<id>/
//
//   node scripts/pack-web.mjs [--sea <url>] [--out <dir>]
//
// One folder a build, never one folder overwritten: a deploy must not mix this build's modules
// with the last one's in a browser that cached the last, and a tab opened yesterday still asks its
// own shelf for a lazy module (the imp, a GLB). Other shelves already in --out are left alone; the
// server keeps the newest few (deploy/play/shelf.sh).
//
// No key, ever: a page on the internet is read by everybody. A keyed sea is refused.
//
// Deliberately not lib/paths.mjs (it moves an island into ~/.promptholm on import, and this runs
// in a Docker build stage too), so the open sea's address is written out a second time here;
// tests/pack-web.test.mjs holds the two equal.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readBuildInfo } from '../lib/buildinfo.mjs';
import { copyPage, writeStandalone, shelfId, contentStamp, doorHtml, shelfJson, webManifest, GZIP_EXT, ROOM_ONLY } from './pack-page.mjs';

export const OPEN_SEA = 'https://agentvillage.xeroxmsj.freeddns.org/';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const SHARED = path.join(ROOT, 'shared');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

// Every file under dir, for the gzip pass.
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else yield p;
  }
}

export async function packWeb({ sea = OPEN_SEA, out = path.join(ROOT, 'dist', 'play'), log = (s) => process.stdout.write(s) } = {}) {
  sea = new URL(sea).href;
  if (!fs.existsSync(path.join(WEB, 'vendor', 'three.module.js'))) {
    throw new Error('web/vendor is empty - run `npm install` first (it vendors three.js)');
  }
  // Out of reach is no reason to stop (a build box may have no way out); a lock on the door is.
  const health = await fetch(new URL('health', sea), { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  if (health && health.keyed) throw new Error(`${sea} wants a key, and a page on the internet cannot keep one`);

  const build = readBuildInfo(ROOT);
  // Only hashed when there is no commit to name the build by (pack-page.mjs shelfId).
  const id = shelfId(build, build.commit ? null : contentStamp([WEB, SHARED], (p) => ROOM_ONLY.has(path.basename(p))));
  const shelf = path.join(out, id);
  copyPage({ web: WEB, shared: SHARED, out: shelf });
  writeStandalone(shelf, { sea, build, host: 'web', shelf: id });
  const manifest = path.join(shelf, 'manifest.webmanifest');
  fs.writeFileSync(manifest, webManifest(fs.readFileSync(manifest, 'utf8')));

  let raw = 0, packed = 0, boot = 0;
  for (const file of files(shelf)) {
    const size = fs.statSync(file).size;
    raw += size;
    if (!GZIP_EXT.has(path.extname(file)) || size < 1024) { packed += size; continue; }
    const gz = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
    fs.writeFileSync(`${file}.gz`, gz);
    packed += gz.length;
    boot += gz.length;
  }
  // The pointer last, after every file it points at is in place.
  fs.writeFileSync(path.join(out, 'version.json'), shelfJson(build, id));
  fs.writeFileSync(path.join(out, 'index.html'), doorHtml(id));
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  log(`pack-web: ${path.relative(ROOT, shelf) || shelf} -> ${sea} (${mb(raw)} raw, ${mb(packed)} served compressed)\n`);
  return { id, shelf, raw, packed, boot };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packWeb({ sea: arg('sea') || OPEN_SEA, out: arg('out') ? path.resolve(arg('out')) : undefined })
    .catch((e) => { process.stderr.write(`pack-web: ${e.message || e}\n`); process.exit(1); });
}
