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
// No key by default: the open sea is open, and an APK is a zip anybody can read, so a key
// in it is a key handed to everybody who ever gets the file. Only for a private sea, and
// only when asked for by name (--key or PROMPTHOLM_SEA_KEY) - never lifted quietly out of
// this machine's config.json, which is how the first builds leaked it.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, WEB, SHARED, OPEN_SEA } from '../lib/paths.mjs';
import { readBuildInfo } from '../lib/buildinfo.mjs';

const OUT = path.join(ROOT, 'src-android', 'dist');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

const sea = new URL(arg('sea') || OPEN_SEA).href;
const key = arg('key') || process.env.PROMPTHOLM_SEA_KEY || null;

if (!fs.existsSync(path.join(WEB, 'vendor', 'three.module.js'))) {
  process.stderr.write('pack-android: web/vendor is empty - run `npm install` first (it vendors three.js)\n');
  process.exit(1);
}
const health = await fetch(new URL('health', sea)).then((r) => r.json()).catch(() => null);
if (health && health.keyed && !key) {
  process.stderr.write(`pack-android: ${sea} wants a key - pass --key (it goes into the APK in plain text) or open the sea\n`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(WEB, OUT, { recursive: true });
fs.cpSync(SHARED, path.join(OUT, 'shared'), { recursive: true });

// Ahead of every other script in the head, so it is there before main.js's graph starts.
// JSON.stringify of plain strings, with `<` escaped so nothing in it can close the tag.
// Which release this app is, for the "who is behind" banner (web/js/update.js): the app
// cannot ask an islander, so it carries its own answer from the moment it was packed.
const build = readBuildInfo(ROOT);
const inline = JSON.stringify(key ? { sea, key, build } : { sea, build }).replace(/</g, '\\u003c');
const index = path.join(OUT, 'index.html');
const html = fs.readFileSync(index, 'utf8');
const at = html.indexOf('<script');
if (at < 0) throw new Error('web/index.html has no <script> to go in front of');
fs.writeFileSync(index, `${html.slice(0, at)}<script>window.PROMPTHOLM_STANDALONE = ${inline};</script>\n${html.slice(at)}`);

process.stdout.write(`pack-android: ${path.relative(ROOT, OUT)} -> ${sea}${key ? ' (keyed)' : ''}\n`);
