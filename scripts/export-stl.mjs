// A baked model set, out of the island and onto a print bed.
//
//   node scripts/export-stl.mjs tavern            -> data/print/tavern.stl
//   node scripts/export-stl.mjs tavern --height 80 --no-base
//
// The source is web/js/<set>-mesh.js, not the .blend, for two reasons. It needs no
// Blender, so anyone who cloned this can print the tavern; and it is by definition the
// shape the island actually draws, which is the shape somebody looking at the screen
// asked for a copy of.
//
// Three things stand between that module and a printable solid.
//
// The frame. The island is Y up with the front of a model facing +Z; every slicer ever
// written is Z up. So (x, y, z) -> (x, -z, y), which is a rotation and not a mirror -
// (x, z, y) would be the obvious swap and turns every facet inside out.
//
// The origin. Parts carry positions relative to their own `at`, exactly as
// scripts/export-models.py wrote them, so world space is position + at. Forgetting that
// piles all 158 parts on top of each other in a heap that still slices, which is why it
// is worth saying out loud.
//
// The loose props. The two barrels and the bench stand on the ground beside the tavern
// and touch nothing, so an STL of the building alone is four objects that arrive on the
// bed as four objects. A plinth underneath is what makes it one print - it is set to
// overlap the foot of everything standing on it by WELD_MM rather than merely meeting it,
// because two solids that share a plane exactly are not joined, they are adjacent, and a
// slicer is right to treat them as two.
//
// What comes out is 158 closed shells in one file rather than one unioned surface. That
// is deliberate and it is what every kitbashed model on the internet is: each part is
// watertight on its own, and PrusaSlicer, Orca, Bambu Studio and Cura all union
// overlapping volumes. A boolean pass would buy a tidier mesh and risk the coplanar faces
// that 158 axis-aligned boxes are made of.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// How tall the model stands, not counting the plinth. 120 mm is not a taste: the finest
// trim on the tavern (the chimney flue) is 0.006 island units, which at this height is
// 0.43 mm and survives a 0.4 mm nozzle. Below about 100 mm it is the first thing to go.
const HEIGHT_MM = 120;
const BASE_MM = 3;       // plinth thickness
const MARGIN_MM = 3;     // how far the plinth reaches past the footprint
const WELD_MM = 0.8;     // how far it swallows the foot of what stands on it
const NOZZLE_MM = 0.4;   // what counts as too thin to come out of the machine

// `--ratio 87` prints at a modeller's scale instead of at a height: 1:87 is HO, what a Roco
// or Marklin layout is built in. It is the one number in this file that is not arbitrary.
// assets/README.md fixes the island at four metres to the unit and says in as many words
// that a conversion to metres belongs there and nowhere else - a barrel is 0.23 across
// because that is 90 cm - so a ratio is a real measurement of a real building and not a
// taste in model sizes. The tavern turns out to be 6.8 m to the ridge, which is why it
// looks like a tavern.
const METRES_PER_UNIT = 4;

const argv = process.argv.slice(2);
const set = argv.find((a) => !a.startsWith('-')) || 'tavern';
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (argv.includes(`--no-${name}`)) return 0;
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const ratio = flag('ratio', 0);
const base = flag('base', BASE_MM);
const out = (() => {
  const i = argv.indexOf('--out');
  return i === -1 ? path.join(ROOT, 'data', 'print', `${set}.stl`) : path.resolve(argv[i + 1]);
})();

const src = path.join(ROOT, 'web', 'js', `${set}-mesh.js`);
if (!fs.existsSync(src)) {
  console.error(`No baked set at web/js/${set}-mesh.js.`);
  console.error('Sets: ' + fs.readdirSync(path.join(ROOT, 'web', 'js'))
    .filter((f) => f.endsWith('-mesh.js')).map((f) => f.replace('-mesh.js', '')).join(', '));
  process.exit(1);
}
// The modules export one const named after the set (TAVERN, HOUSE, ...), so take whatever
// in there looks like a model rather than guessing at the name.
const module_ = await import(pathToFileURL(src).href);
const model = Object.values(module_).find((v) => v && typeof v === 'object' && v.parts);
if (!model) { console.error(`${src} exports no { parts } object.`); process.exit(1); }

// ---- world-space triangles, still in island units and still Y up -----------------------
// Each part's own thinnest dimension is kept alongside, because at a modeller's scale that
// is the number that decides whether the model is worth printing at all - see the report
// at the end.
const tris = [];
const spans = [];
for (const [name, part] of Object.entries(model.parts)) {
  const [ax, ay, az] = part.at;
  const p = part.positions;
  const plo = [Infinity, Infinity, Infinity];
  const phi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 9) {
    const t = [
      [p[i]     + ax, p[i + 1] + ay, p[i + 2] + az],
      [p[i + 3] + ax, p[i + 4] + ay, p[i + 5] + az],
      [p[i + 6] + ax, p[i + 7] + ay, p[i + 8] + az],
    ];
    for (const v of t) for (let k = 0; k < 3; k++) {
      if (v[k] < plo[k]) plo[k] = v[k];
      if (v[k] > phi[k]) phi[k] = v[k];
    }
    tris.push(t);
  }
  spans.push({ name, thin: Math.min(phi[0] - plo[0], phi[1] - plo[1], phi[2] - plo[2]) });
}
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (const t of tris) for (const v of t) for (let k = 0; k < 3; k++) {
  if (v[k] < lo[k]) lo[k] = v[k];
  if (v[k] > hi[k]) hi[k] = v[k];
}
// mm per island unit, decided either by how tall you want it or by what scale it is in.
const scale = ratio ? METRES_PER_UNIT * 1000 / ratio : flag('height', HEIGHT_MM) / (hi[1] - lo[1]);
const height = (hi[1] - lo[1]) * scale;
const label = ratio ? `1:${ratio}` : `${height.toFixed(0)}mm`;

// ---- the plinth ------------------------------------------------------------------------
// Outward winding written out by hand rather than trusted: the volume check below is what
// proves it, and it would equally catch the axis map above being a mirror.
function box(x0, y0, z0, x1, y1, z1) {
  const c = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  const [o, X, XY, Y, Z, XZ, XYZ, YZ] =
    [c(0,0,0), c(1,0,0), c(1,1,0), c(0,1,0), c(0,0,1), c(1,0,1), c(1,1,1), c(0,1,1)];
  return [[o,Y,XY],[o,XY,X], [Z,XZ,XYZ],[Z,XYZ,YZ], [o,Z,YZ],[o,YZ,Y],
          [X,XY,XYZ],[X,XYZ,XZ], [o,X,XZ],[o,XZ,Z], [Y,YZ,XYZ],[Y,XYZ,XY]];
}
if (base > 0) {
  const m = MARGIN_MM / scale;
  tris.push(...box(lo[0] - m, lo[1] - base / scale, lo[2] - m,
                   hi[0] + m, lo[1] + WELD_MM / scale, hi[2] + m));
}

// ---- into print space: Z up, millimetres, centred on the bed, sitting on Z = 0 ---------
const flat = tris.map((t) => t.map(([x, y, z]) => [x * scale, -z * scale, y * scale]));
const PLO = [Infinity, Infinity, Infinity];
const PHI = [-Infinity, -Infinity, -Infinity];
for (const t of flat) for (const v of t) for (let k = 0; k < 3; k++) {
  if (v[k] < PLO[k]) PLO[k] = v[k];
  if (v[k] > PHI[k]) PHI[k] = v[k];
}
const shift = [-(PLO[0] + PHI[0]) / 2, -(PLO[1] + PHI[1]) / 2, -PLO[2]];
for (const t of flat) for (const v of t) for (let k = 0; k < 3; k++) v[k] += shift[k];

// ---- binary STL ------------------------------------------------------------------------
// Signed volume by the divergence theorem. Only the SIGN is trustworthy - the shells
// overlap, so the total counts the overlaps once per shell and reads high - but the sign
// is the whole point: positive means every facet faces out, which is the one property a
// slicer cannot repair silently and the one this file could get wrong in two independent
// places (the axis map being a mirror, the plinth being wound inside out).
let volume = 0;
const buf = Buffer.alloc(84 + flat.length * 50);
buf.write(`Promptholm ${set} - ${label} - island units x ${scale.toFixed(3)} mm`, 0, 79, 'ascii');
buf.writeUInt32LE(flat.length, 80);
let at = 84;
for (const [a, b, c] of flat) {
  const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
  const w = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
  const n = [u[1]*w[2]-u[2]*w[1], u[2]*w[0]-u[0]*w[2], u[0]*w[1]-u[1]*w[0]];
  const len = Math.hypot(...n) || 1;
  volume += (a[0]*n[0] + a[1]*n[1] + a[2]*n[2]) / 6;
  for (const v of [n.map((q) => q / len), a, b, c]) for (const q of v) {
    buf.writeFloatLE(q, at); at += 4;
  }
  buf.writeUInt16LE(0, at); at += 2;
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);

const size = PHI.map((h, k) => h - PLO[k]);
console.log(`${path.relative(ROOT, out)}  ${flat.length} triangles, ${(buf.length / 1024).toFixed(0)} kB`);
console.log(`  ${size[0].toFixed(1)} x ${size[1].toFixed(1)} mm on the bed, ${size[2].toFixed(1)} mm tall` +
            (base > 0 ? ` (${base} mm of that is plinth)` : ' (no plinth)'));
console.log(`  1 island unit = ${scale.toFixed(2)} mm; facets face outward` +
            ` (signed volume +${(volume / 1000).toFixed(0)} cm3, overlaps counted twice)`);
if (volume <= 0) console.error('  !! negative volume: the facets face inwards, do not print this');

// The real building, for anyone checking that a scale means what it says.
const m = (u) => (u * METRES_PER_UNIT).toFixed(2);
console.log(`  full size ${m(hi[0] - lo[0])} x ${m(hi[2] - lo[2])} x ${m(hi[1] - lo[1])} m` +
            (ratio ? ` at 1:${ratio}` : ` (1:${Math.round(METRES_PER_UNIT * 1000 / scale)})`));

// What the scale costs. A part thinner than the nozzle does not come out narrow, it comes
// out absent or fattened to one bead, and at a modeller's ratio that is the difference
// between a model and a blob - so it is named rather than left to be discovered on the bed.
const frail = spans.map((s) => ({ ...s, mm: s.thin * scale }))
  .filter((s) => s.mm < NOZZLE_MM).sort((a, b) => a.mm - b.mm);
if (!frail.length) {
  console.log(`  every part is at least ${NOZZLE_MM} mm thick`);
} else {
  console.log(`  ${frail.length} part(s) thinner than a ${NOZZLE_MM} mm nozzle:`);
  for (const s of frail.slice(0, 8)) console.log(`    ${s.mm.toFixed(2)} mm  ${s.name}`);
  if (frail.length > 8) console.log(`    ... and ${frail.length - 8} more`);
}
