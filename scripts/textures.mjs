#!/usr/bin/env node
// Fetch CC0 textures from ambientCG into godot/assets/.
//
// The maps themselves are **not** in git: thirty sets is sixty megabytes, and git keeps every
// version of every one of them forever. What is in git is this script and the manifest it
// writes, so a fresh checkout restores exactly the same textures with one command.
//
//   node scripts/textures.mjs                       restore whatever textures.json names
//   node scripts/textures.mjs --category Ground --count 30
//   node scripts/textures.mjs --add Rocks025,PavingStones138
//   node scripts/textures.mjs --list                what is on disk now
//
// Only three maps are kept per asset - colour, normal (OpenGL, which is what Godot wants) and
// roughness. Ambient occlusion and displacement are another 40% of the bytes and nothing here
// reads them.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../lib/paths.mjs';

const API = 'https://ambientcg.com/api/v2/full_json';
const OUT = path.join(ROOT, 'godot', 'assets', 'ambientcg');
const MANIFEST = path.join(ROOT, 'godot', 'assets', 'textures.json');
const KEEP = [
  ['_Color.jpg', 'col'],
  ['_NormalGL.jpg', 'nrm'],
  ['_Roughness.jpg', 'rgh'],
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

async function api(params) {
  const url = `${API}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'promptholm/1.0 (local tool)' } });
  if (!res.ok) throw new Error(`ambientCG said ${res.status} for ${url}`);
  return res.json();
}

/** The asset ids of a category, most popular first. */
async function popular(category, count) {
  const json = await api({ type: 'Material', category, sort: 'Popular', limit: String(count) });
  return (json.foundAssets || []).map((a) => a.assetId);
}

async function fetchAsset(id) {
  const dir = path.join(OUT, id.toLowerCase());
  if (fs.existsSync(path.join(dir, `${id.toLowerCase()}_col.jpg`))) return 'already here';

  const url = `https://ambientcg.com/get?file=${id}_1K-JPG.zip`;
  const res = await fetch(url, { headers: { 'User-Agent': 'promptholm/1.0 (local tool)' } });
  if (!res.ok) return `HTTP ${res.status}`;
  const zip = path.join(OUT, `${id}.zip`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  const staging = path.join(OUT, `.${id}`);
  fs.rmSync(staging, { recursive: true, force: true });
  // bsdtar ships with Windows and handles zip; unzip is there in a POSIX shell. Either will do.
  try {
    execFileSync('tar', ['-xf', zip, '-C', OUT === staging ? OUT : mk(staging)], { stdio: 'ignore' });
  } catch {
    execFileSync('unzip', ['-o', '-q', zip, '-d', mk(staging)], { stdio: 'ignore' });
  }

  fs.mkdirSync(dir, { recursive: true });
  let kept = 0;
  for (const [suffix, short] of KEEP) {
    const src = path.join(staging, `${id}_1K-JPG${suffix}`);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dir, `${id.toLowerCase()}_${short}.jpg`));
    kept++;
  }
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(zip, { force: true });
  return kept ? `${kept} maps` : 'no usable maps in the pack';
}

function mk(dir) { fs.mkdirSync(dir, { recursive: true }); return dir; }

function listOnDisk() {
  if (!fs.existsSync(OUT)) return [];
  return fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory() && !d.startsWith('.'));
}

async function main() {
  if (process.argv.includes('--list')) {
    const here = listOnDisk();
    process.stdout.write(`${here.length} texture sets in godot/assets/ambientcg/\n${here.join('\n')}\n`);
    return;
  }

  let wanted = [];
  const add = arg('add');
  const category = arg('category');
  if (add) wanted = add.split(',').map((s) => s.trim()).filter(Boolean);
  else if (category) wanted = await popular(category, Number(arg('count', '30')));
  else if (fs.existsSync(MANIFEST)) wanted = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).assets || [];
  else throw new Error('nothing to do: pass --category or --add, or commit a textures.json first');

  const existing = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).assets || [] : [];
  const all = [...new Set([...existing, ...wanted])].sort();

  process.stderr.write(`[textures] ${wanted.length} assets from ambientCG\n`);
  for (const id of wanted) {
    const what = await fetchAsset(id);
    process.stderr.write(`  ${id.padEnd(22)} ${what}\n`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify({
    source: 'https://ambientcg.com/',
    licence: 'CC0 1.0 Universal (public domain)',
    variant: '1K-JPG',
    maps: KEEP.map(([, short]) => short),
    note: 'The maps themselves are gitignored. `node scripts/textures.mjs` restores them.',
    assets: all,
  }, null, 2)}\n`);
  process.stderr.write(`[textures] ${listOnDisk().length} sets on disk, ${all.length} in the manifest\n`);
}

main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
