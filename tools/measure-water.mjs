#!/usr/bin/env node
// Measures the water of an island: the yardstick of Plans/quay-en-rivier.md, run before and
// after every phase of it.
//
//   node tools/measure-water.mjs [--home <dir>] [--layout <file>] [--village <file>]
//
// It reads `<home>/data/layout.json` and `<home>/data/village.json`, builds the terrain
// exactly as placeAll does (`makeTerrain(seed, { size, polders, fairway, works, grow })`) and says:
//   - whether that terrain still hashes to `layout.terrainHash` (if not, nothing else counts),
//   - how many bodies of water there are and which of them have no way to the open sea,
//   - whether the dredged fairway still reaches the sea,
//   - the stone quay (`works.kade`): at its level, and water all along its wall.
// Read-only, and it imports neither lib/paths.mjs nor lib/layout.mjs: paths.mjs settles a
// home on import (`settleHome`), which is not something a measuring tool may do. `<home>` is
// `--home`, else PROMPTHOLM_HOME, else `~/.promptholm` - the same order lib/paths.mjs uses
// outside a worktree. It writes nothing, but point it at a COPY of the live island anyway:
// the numbers are the same and the habit is cheap.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTerrain, funnelCells } from '../shared/terrain.mjs';
import { waterBodies, fairwayOpen } from '../tests/support/water-bodies.mjs';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return out;
}
const opt = args(process.argv.slice(2));
if (opt.help || opt.h) {
  console.log('usage: node tools/measure-water.mjs [--home <dir>] [--layout <file>] [--village <file>]');
  process.exit(0);
}
const HOME = path.resolve(opt.home || process.env.PROMPTHOLM_HOME || path.join(os.homedir(), '.promptholm'));
const LAYOUT = path.resolve(opt.layout || path.join(HOME, 'data', 'layout.json'));
const VILLAGE = path.resolve(opt.village || path.join(path.dirname(LAYOUT), 'village.json'));

const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const layout = readJson(LAYOUT);
if (!layout) { console.error(`no layout at ${LAYOUT}`); process.exit(1); }
const village = readJson(VILLAGE);

const { seed, size } = layout;
const opts = (grow) => ({ size, polders: layout.polders || [], fairway: layout.fairway || null, works: layout.works || null, grow });
const terrain = makeTerrain(seed, opts(layout.grow || null));
const line = (label, value) => console.log(`${label.padEnd(30)}${value}`);
const box = (b) => `x${b.x0}..${b.x1} z${b.z0}..${b.z1}`;

console.log(`island   seed ${JSON.stringify(seed)}, grid ${size}, home ${HOME}`);
const g = layout.grow;
const stepText = (s) => `r=${s.r} grid=${s.grid}${s.relief ? ` relief=${s.relief}` : ' (no relief)'}${s.water ? ` water=${s.water} lane=${(s.lane || []).length} ponds=${(s.ponds || []).length}${s.haven ? ' funnel' : ''}` : ''}`;
line('growth', g ? `base ${g.base}, ${g.steps.length} step(s): ${g.steps.map(stepText).join('; ')}` : 'none (founded on the whole grid)');
line('terrain hash', `${terrain.hash} vs layout ${layout.terrainHash}: ${terrain.hash === layout.terrainHash ? 'EQUAL' : 'DIFFERENT - the island would not recognise itself'}`);

// ---- water bodies ---------------------------------------------------------------
const bodies = waterBodies(terrain);
const shut = bodies.filter((b) => !b.open).sort((a, b) => b.size - a.size);
console.log('');
line('water bodies', `${bodies.length} (${bodies.length - shut.length} open, ${shut.length} enclosed)`);
line('enclosed cells', shut.reduce((n, b) => n + b.size, 0));
// Water that was open sea before the growth rings: what a ring shut in, as opposed to a lake
// the founding island always had. `before` is the same island with its steps left off.
const before = makeTerrain(seed, opts(g ? { base: g.base, steps: [] } : null));
const seaBefore = new Set();
for (const b of waterBodies(before)) if (b.open) for (const [x, z] of b.cells) seaBefore.add(x + z * size);
let shutByGrowth = 0, shutBodies = 0;
for (const b of shut) {
  const was = b.cells.filter(([x, z]) => seaBefore.has(x + z * size)).length;
  if (was) { shutByGrowth += was; shutBodies++; }
  console.log(`  enclosed  ${String(b.size).padStart(5)} cells  ${box(b.bbox)}  was open sea before growth: ${was}/${b.size}`);
}
line('shut in by growth', `${shutBodies} bodies, ${shutByGrowth} cells (the biggest is the river and fairway, cut off from the sea)`);
console.log("  (the founding island's own lake counts as enclosed too: compare against a baseline, not zero)");

// ---- the fairway ----------------------------------------------------------------
console.log('');
const fw = layout.fairway;
if (!fw) line('fairway', 'null (nobody has asked yet)');
else if (!(fw.cells || []).length) line('fairway', '{ cells: [] } (asked, nothing to dig)');
else {
  line('fairway', `${fw.cells.length} cells, line of ${(fw.line || []).length}`);
  line('fairway reaches open sea', fairwayOpen(terrain, fw) ? 'YES' : 'NO - landlocked');
  const label = new Map();
  bodies.forEach((b, i) => b.cells.forEach(([x, z]) => label.set(x + z * size, i)));
  const ids = new Set(fw.cells.map(([x, z]) => label.get(x + z * size)).filter((i) => i !== undefined));
  for (const i of ids) console.log(`  fairway lies in a body of ${bodies[i].size} cells, ${bodies[i].open ? 'open' : 'enclosed'}, ${box(bodies[i].bbox)}`);
  const dry = fw.cells.filter(([x, z]) => !terrain.isWater(x, z)).length;
  if (dry) line('fairway cells not water', dry);
}

// ---- the earthworks and the harbour funnel --------------------------------------
console.log('');
const w = layout.works;
if (!w) line('earthworks', 'none (layout.works is absent)');
else {
  line('earthworks', `v${w.v}: ${(w.dig || []).length} dig(s) of ${(w.dig || []).map((d) => `${d.cells.length} cells (holding ${d.hold.length})`).join(', ') || '-'}; fill ${w.fill === undefined ? 'not asked' : `${w.fill.length} cells`}`);
  if (w.haven === undefined) line('harbour funnel', 'not planned yet');
  else if (w.haven === null) line('harbour funnel', 'null (asked, nothing to plan)');
  else {
    const h = w.haven, cells = funnelCells(h, size);
    let water = 0, land = 0;
    for (const [x, z] of cells) { if (terrain.isWater(x, z)) water++; else land++; }
    const topBody = bodies.find((b) => b.cells.some(([x, z]) => x === h.top[0] && z === h.top[1]));
    line('harbour funnel', `head ${h.top} opening along ${h.dir}, half-width ${h.w0} + ${h.open}/cell up to ${h.max}, from step ${h.from} of ${g ? g.steps.length : 0}`);
    line('  cells', `${water} water, ${land} land; its head lies in ${topBody ? (topBody.open ? 'open sea' : 'an ENCLOSED body') : 'land'}`);
  }
}

// ---- the quay ------------------------------------------------------------------
// Since fase 3 the harbour is real water (a dig) with a stone quay along it (`works.kade`); the
// basin overlay that dug the parcel out of the ground on the page alone is gone.
console.log('');
const quay = ((village && village.districts) || []).find((d) => d.kind === 'quay');
const k = w && w.kade;
if (!k) line('stone quay', w && w.kade === null ? 'null (asked, no quay fits)' : 'none yet');
else {
  const own = new Set(k.cells.map(([x, z]) => x + z * size));
  const foot = k.cells.map(([x, z]) => [x - k.back[0], z - k.back[1]]).filter(([x, z]) => !own.has(x + z * size));
  const level = k.cells.filter(([x, z]) => terrain.heightAt(x, z) === k.level / 256).length;
  const wet = foot.filter(([x, z]) => terrain.isWater(x, z)).length;
  line('stone quay', `${k.cells.length} cells at ${k.level}/256 (${(k.level / 256).toFixed(4)}), land at ${k.back}, holding ${k.hold.length}`);
  line('  at its level', `${level} of ${k.cells.length}`);
  line('  water along the wall', `${wet} of ${foot.length} foot cells`);
}
if (quay) line('quay planks / deck cells', `${(quay.pier || []).length} / ${(quay.deck || []).length}`);
