#!/usr/bin/env node
// Starts the distillate on a home of its own (Plans/destillaat-eiland.md in the AgentVillage
// repo). PROMPTHOLM_HOME has to be set before lib/paths.mjs is imported - that import works HOME
// out once, and without the variable it would take the live island's ~/.promptholm (or move an
// island there), which is exactly what the distillate must not touch: two scanners on one
// layout.json, and a move in this planner would be a real move on the live island.
//
// So the home is ~/.promptholm-destillaat (or PROMPTHOLM_HOME), and the first start seeds it
// from the live island - config.json, layout.json, arrivals.jsonl - so it shows the same island
// and grows on from the same transcripts. Never the locks (they name the live islander's pid),
// never the logs; and the copy's sea is single player and its island not public, or it would
// publish under the live island's claim.
//
//   node start.mjs [--open] [--port 4848] [--fresh]     --fresh founds a new island instead
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const HOME = process.env.PROMPTHOLM_HOME || path.join(os.homedir(), '.promptholm-destillaat');
const LIVE = path.join(os.homedir(), '.promptholm');
process.env.PROMPTHOLM_HOME = HOME;

function seed() {
  if (fs.existsSync(path.join(HOME, 'config.json'))) return;
  fs.mkdirSync(path.join(HOME, 'data'), { recursive: true });
  // The live island may have moved to a drive of its own (~/.promptholm/home.txt).
  let live = LIVE;
  try {
    const named = fs.readFileSync(path.join(LIVE, 'home.txt'), 'utf8').trim();
    if (named && fs.existsSync(path.join(named, 'config.json'))) live = named;
  } catch { /* no pointer: ~/.promptholm itself */ }
  if (args.includes('--fresh') || !fs.existsSync(path.join(live, 'config.json'))) {
    console.log(`[destillaat] founding a new island in ${HOME}`);
    return;
  }
  const config = JSON.parse(fs.readFileSync(path.join(live, 'config.json'), 'utf8'));
  config.multiplayer = { ...(config.multiplayer || {}), sea: { mode: 'single', url: null, key: null, port: 0 } };
  config.network = { ...(config.network || {}), public: false };
  delete config.port;
  for (const f of ['layout.json', 'arrivals.jsonl', 'placements.json', 'banished.jsonl', 'waiting-dismissed.json', 'cache.json']) {
    const from = path.join(live, 'data', f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(HOME, 'data', f));
  }
  // config.json last: its presence is what says "this home is seeded".
  fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify(config, null, 2));
  console.log(`[destillaat] seeded ${HOME} from ${live}`);
}

seed();
await import('./serve.mjs');
