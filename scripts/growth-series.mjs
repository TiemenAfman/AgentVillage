#!/usr/bin/env node
// The island at three sizes, so you can see it grow.
//
// `lib/world/growth.mjs` publishes more of the baked envelope as the village earns it, and
// `lib/layout.mjs` hands each repository a rock of its own. Neither is visible in a single
// scan - the island you have is the island you have. This plants the same village at several
// populations and writes a data directory per size, which `village-map.mjs` then draws.
//
//   node scripts/growth-series.mjs --out build/growth
//   node scripts/growth-series.mjs --out build/growth --settlers 50,100,300
//   node scripts/growth-series.mjs --out build/growth --no-islets     # for a before picture
//
// It costs one bake (a few seconds) however many sizes you ask for: the envelope is baked
// once into `<out>/_bake` and copied, which is exactly what a real island does over its life.
import fs from 'node:fs';
import path from 'node:path';
import { publishWorld } from '../lib/world/publish.mjs';
import { growWorld, isletSpecs, isletsWanted } from '../lib/world/growth.mjs';
import { loadWorld } from '../lib/world/load.mjs';
import { makeLotField } from '../lib/world/lotfield.mjs';
import { emptyLayout, placeAll, saveLayout, MIN_HAMLET } from '../lib/layout.mjs';
import { makeModel } from '../tests/helpers/model.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const out = arg('out', path.join(process.cwd(), 'build', 'growth'));
const seed = Number(arg('seed', 1337));
const radiusM = Number(arg('radius', 208));
const sizes = arg('settlers', '50,100,300').split(',').map((s) => Number(s.trim())).filter(Boolean);
const withIslets = !process.argv.includes('--no-islets');

// The real island's district mix, as it stood at 104 settlers: one number per repository,
// biggest first. Scaling this rather than inventing a flat distribution matters, because what
// decides how many rocks are handed out is how many projects clear MIN_HAMLET - and a village
// of twelve equal districts would clear it all at once and answer a question nobody asked.
const MIX = [23, 18, 17, 14, 8, 8, 6, 3, 2, 2, 2, 1];
const MIX_TOTAL = MIX.reduce((a, b) => a + b, 0);

/** The same village at `settlers` heads: every project scaled, nobody dropped. */
function villageOf(settlers) {
  const scaled = MIX.map((n) => Math.max(1, Math.round((n * settlers) / MIX_TOTAL)));
  // Round-off lands on the biggest project, which is where it is least visible.
  scaled[0] += settlers - scaled.reduce((a, b) => a + b, 0);
  return scaled.map((houses, k) => ({ name: `repo-${String.fromCharCode(97 + k)}`, houses: Math.max(1, houses) }));
}

fs.mkdirSync(out, { recursive: true });
const bake = path.join(out, '_bake');
if (!fs.existsSync(path.join(bake, 'atlas.json'))) {
  const t0 = Date.now();
  const { atlas } = publishWorld(seed, bake, { radiusM });
  console.log(`baked seed ${seed}: ${atlas.chunks.length} chunks, ${atlas.islets.length} islets, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

for (const settlers of sizes) {
  const specs = villageOf(settlers);
  const model = makeModel(specs, { settlers });
  const hamlets = model.districts.filter((d) => d.population >= MIN_HAMLET).length;

  const dir = path.join(out, `n${String(settlers).padStart(3, '0')}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(bake, path.join(dir, 'world'), { recursive: true });
  growWorld(path.join(dir, 'world'), { settlers, hamlets });

  const { manifest, field } = loadWorld(path.join(dir, 'world'));
  const lots = makeLotField(field);
  const layout = emptyLayout(seed, lots.size);
  const islets = withIslets ? isletSpecs(manifest) : [];
  const { unplaced } = placeAll(layout, model, { lots, seed, worldRev: manifest.bakeRev, islets });
  saveLayout(path.join(dir, 'layout.json'), layout);

  const onIslets = Object.values(layout.districts).filter((r) => Number.isInteger(r.islet)).length;
  const commons = Object.values(layout.plots).filter((p) => p.commons).length;
  console.log(
    `${settlers} settlers, ${specs.length} districts (${hamlets} hamlets, ladder wants ${isletsWanted({ settlers, hamlets })})`
    + ` -> ${manifest.chunks.length} chunks, ${manifest.islets.length} islets above water,`
    + ` ${onIslets} districts on one, ${commons} lodging in town, ${unplaced.length} unplaced`);
  console.log(`   node scripts/village-map.mjs --data ${dir} --out ${path.join(out, `growth-${String(settlers).padStart(3, '0')}.png`)}`);
}
