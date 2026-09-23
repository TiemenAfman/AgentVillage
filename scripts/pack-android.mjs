#!/usr/bin/env node
// Lays out what the Android app carries: src-android/dist/, which tauri.conf.json there
// names as its frontend.
//
//   dist/            a copy of web/ (three.js already vendored into it by npm install)
//     shared/        shared/, where web/index.html's import map looks for it
//     index.html     web/index.html with PROMPTHOLM_STANDALONE written into its head
//
// The desktop window deliberately bundles nothing (Plans/eiland-als-desktop-app.md): its
// page belongs to the islander on 4747. A phone has no islander and never will, so there
// the page has to travel inside the app, and web/js/api.js's STANDALONE is how it knows it
// is on its own - mine() refuses without asking, and the sea is the one written in here.
//
//   node scripts/pack-android.mjs [--sea <url>] [--key <key>]
//
// The key defaults to PROMPTHOLM_SEA_KEY, then to config.json's multiplayer.sea.key when
// that config is in the same sea. It is baked into the APK in plain text: an APK is a zip,
// so hand it only to people who could have been given the key anyway.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, HOME, WEB, SHARED, OPEN_SEA, readJson } from '../lib/paths.mjs';

const OUT = path.join(ROOT, 'src-android', 'dist');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

const sea = new URL(arg('sea') || OPEN_SEA).href;
const config = readJson(path.join(HOME, 'config.json'), {}) || {};
const mine = config.multiplayer && config.multiplayer.sea;
const key = arg('key') || process.env.PROMPTHOLM_SEA_KEY
  || (mine && mine.key && mine.url && new URL(mine.url).href === sea ? mine.key : null);

if (!fs.existsSync(path.join(WEB, 'vendor', 'three.module.js'))) {
  process.stderr.write('pack-android: web/vendor is empty - run `npm install` first (it vendors three.js)\n');
  process.exit(1);
}
const health = await fetch(new URL('health', sea)).then((r) => r.json()).catch(() => null);
if (health && health.keyed && !key) {
  process.stderr.write(`pack-android: ${sea} wants a key and none was found - pass --key or set PROMPTHOLM_SEA_KEY\n`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(WEB, OUT, { recursive: true });
fs.cpSync(SHARED, path.join(OUT, 'shared'), { recursive: true });

// Ahead of every other script in the head, so it is there before main.js's graph starts.
// JSON.stringify of plain strings, with `<` escaped so nothing in it can close the tag.
const inline = JSON.stringify({ sea, key }).replace(/</g, '\\u003c');
const index = path.join(OUT, 'index.html');
const html = fs.readFileSync(index, 'utf8');
const at = html.indexOf('<script');
if (at < 0) throw new Error('web/index.html has no <script> to go in front of');
fs.writeFileSync(index, `${html.slice(0, at)}<script>window.PROMPTHOLM_STANDALONE = ${inline};</script>\n${html.slice(at)}`);

process.stdout.write(`pack-android: ${path.relative(ROOT, OUT)} -> ${sea}${key ? ' (keyed)' : ''}\n`);
