// `npm run models`: bake every Blender model set, then read the result back and refuse
// to be quiet about anything wrong with it.
//
// Two halves on purpose. Blender bakes - it has the meshes, the materials and the
// modifiers, and it writes web/js/<set>-mesh.js. Node checks - it has the rules
// (scripts/model-rules.mjs), and the same function tests/models.test.mjs runs over the
// files in the repository. So the pipeline and the test suite cannot disagree about what
// a legal model is, and a budget lives in exactly one place.
//
//   npm run models                  bake and check every set
//   npm run models -- props         only this one
//   npm run models:preview          render a PNG of every asset
//   npm run models:preview -- props prop_barrel
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBlender } from './blender.mjs';
import { checkAll, describeSet } from './model-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const preview = argv.includes('--preview');
const names = argv.filter((a) => !a.startsWith('--'));

// Which sets exist, by the same rule the exporter uses: a folder under assets/ with one
// .blend in it. The figures are not ours - see SKIP in scripts/export-models.py.
function sets() {
  const out = [];
  for (const dir of fs.readdirSync(path.join(ROOT, 'assets'))) {
    if (dir === 'settler') continue;
    const full = path.join(ROOT, 'assets', dir);
    if (!fs.statSync(full).isDirectory()) continue;
    if (fs.readdirSync(full).some((f) => f.endsWith('.blend'))) out.push(dir);
  }
  return out.sort();
}

const script = preview ? 'scripts/preview-model.py' : 'scripts/export-models.py';
const status = runBlender(['--background', '--python', script, '--', ...names], { cwd: ROOT });
if (status !== 0) {
  console.error(`\nBlender stopped with ${status}, so nothing was checked.`);
  process.exit(status);
}
if (preview) process.exit(0);

// Read the modules back. An import rather than a parse: this is the file the browser
// will load, so if it cannot be imported here it will not load there either. Every set
// is read even when only one was baked, because two sets calling a part by the same name
// is a thing no single set can see - see checkAll.
const baked = {};
for (const set of sets()) {
  const file = path.join(ROOT, 'web/js', `${set}-mesh.js`);
  if (!fs.existsSync(file)) {
    console.error(`${set}: assets/${set} has a .blend but web/js/${set}-mesh.js was never baked`);
    process.exit(1);
  }
  const mod = await import(`file://${file.replace(/\\/g, '/')}`);
  const data = mod[set.toUpperCase()];
  if (!data) {
    console.error(`${set}: web/js/${set}-mesh.js exports no ${set.toUpperCase()}`);
    process.exit(1);
  }
  baked[set] = data;
}

for (const [set, data] of Object.entries(baked)) console.log(describeSet(set, data));

const problems = checkAll(baked);
if (problems.length) {
  console.error(`\n${problems.length} problem(s) with what Blender baked:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nThe rules are scripts/model-rules.mjs; what they mean is assets/README.md.');
  process.exit(1);
}
console.log(`${Object.keys(baked).length} set(s) within budget.`);
