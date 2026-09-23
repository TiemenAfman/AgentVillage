#!/usr/bin/env node
// Lays out a release as one folder that can stand anywhere:
//
//   dist/Promptholm/
//     promptholm.exe           the viewer
//     promptholm-island.exe    the islander (tray)
//     README.txt
//     app/                     the island itself: what node runs, and nothing else
//       release.json           marks this as an unpacked release, not a checkout
//
// Both exes find app/ beside themselves (find_root in src-tauri/src/island.rs), and
// release.json is what makes lib/paths.mjs keep config.json and data/ in
// %LOCALAPPDATA%\Promptholm rather than in app/ - so unpacking the next version over this
// folder, or moving it, keeps the island. Run after `npm run app:build`; the release
// workflow zips what this leaves behind.
//
// app/ is a list, not the tree. The tree holds the Blender sources (32 MB), the tests,
// the Tauri crate and the docs, none of which a running island reads - the same reasoning
// as Dockerfile.sea copying the sea's folders by name. What node imports at runtime is
// node's own modules plus these folders; three.js reaches the browser from web/vendor.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitCommit } from '../lib/buildinfo.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'dist', 'Promptholm');
const APP = path.join(OUT, 'app');
const RELEASE = path.join(ROOT, 'src-tauri', 'target', 'release');

const FILES = ['serve.mjs', 'scan.mjs', 'package.json', 'config.example.json', 'scripts/setup.mjs'];
const DIRS = ['lib', 'shared', 'hooks', 'web', 'docs/screenshots'];
const EXES = ['promptholm.exe', 'promptholm-island.exe'];

function need(file, why) {
  if (!fs.existsSync(file)) {
    process.stderr.write(`pack-release: ${path.relative(ROOT, file)} is missing - ${why}\n`);
    process.exit(1);
  }
}

for (const exe of EXES) need(path.join(RELEASE, exe), 'run `npm run app:build` first');
need(path.join(ROOT, 'web', 'vendor', 'three.module.js'), 'run `npm install` first (it vendors three.js)');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

for (const exe of EXES) fs.copyFileSync(path.join(RELEASE, exe), path.join(OUT, exe));
fs.copyFileSync(path.join(ROOT, 'src-tauri', 'release-readme.txt'), path.join(OUT, 'README.txt'));
for (const f of FILES) {
  fs.mkdirSync(path.dirname(path.join(APP, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
}
for (const d of DIRS) fs.cpSync(path.join(ROOT, d), path.join(APP, d), { recursive: true });

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
// The commit too: an unpacked release has no .git, so this is the only place the tray and
// the island's own page can learn which code they are (lib/buildinfo.mjs).
const commit = gitCommit(ROOT);
fs.writeFileSync(path.join(APP, 'release.json'), `${JSON.stringify({ name: 'Promptholm', version, commit }, null, 2)}\n`);

let bytes = 0, files = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);
process.stdout.write(`pack-release: Promptholm ${version} in ${path.relative(ROOT, OUT)} - ${files} files, ${(bytes / 1048576).toFixed(1)} MB\n`);
