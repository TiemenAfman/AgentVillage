#!/usr/bin/env node
// Copies the island's code into a distillate (Plans/destillaat-eiland.md): a folder whose own
// entry points - serve.mjs, web/index.html, web/js/main.js, whatever it lists in DISTILL_ENTRIES -
// are its own, and every other file is exactly what those entries import, transitively, taken
// from this checkout. So "stripped" is a property of the import graph, not a hand-kept list, and
// running this again refreshes the copied modules from main without touching the entries.
//
//   node scripts/distill.mjs <target> [--dry]
//
// What it follows: static `import ... from '...'`, `export ... from '...'`, `import('...')` with a
// literal, and `new URL('...', import.meta.url)` (workers, wasm). `three` and `three/addons/...`
// are the vendor step's (web/vendor, scripts/vendor.mjs), `shared/...` is the import map's.
// A dynamic import built from a variable is not followed - that is the imp's and the HD pack's
// pattern, which the distillate leaves out on purpose - and is listed at the end as a warning
// when one is seen. Writes <target>/DISTILLED.txt: every file copied, and from which importer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const target = args.find((a) => !a.startsWith('--'));
if (!target) { console.error('usage: node scripts/distill.mjs <target> [--dry]'); process.exit(2); }
const TARGET = path.resolve(target);

// The distillate's own files: never overwritten. An `entries` file in the target may add more.
const OWN = new Set(['serve.mjs', 'web/index.html', 'web/js/main.js', 'package.json', 'README.md', 'CLAUDE.md']);
const listFile = path.join(TARGET, 'DISTILL_ENTRIES');
if (fs.existsSync(listFile)) {
  for (const line of fs.readFileSync(listFile, 'utf8').split(/\r?\n/)) {
    const l = line.trim();
    if (l && !l.startsWith('#')) OWN.add(l.replace(/\\/g, '/'));
  }
}
// Copied whole: data the page fetches by URL rather than imports.
const TREES = ['web/textures', 'web/icons', 'web/css', 'scripts/vendor.mjs'];

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const IMPORT = /(?:^|[\s;}])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(])import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/gm;
const DYNAMIC = /import\(\s*[^'"\s)]/g;

function resolve(spec, fromRel) {
  if (spec.endsWith('/')) return null; // a base URL (api.js, assets.js), not a module
  if (spec === 'three' || spec.startsWith('three/')) return null;
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('shared/')) return spec;
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = spec.startsWith('/') ? spec.slice(1) : path.posix.join(path.posix.dirname(fromRel), spec);
    return path.posix.normalize(base);
  }
  return null; // a bare package: there are none but three
}

// The scripts an html page starts, and its import map's targets.
function htmlImports(text) {
  const out = [];
  for (const m of text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/<link[^>]*\brel=["'](?:stylesheet|modulepreload)["'][^>]*\bhref=["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of text.matchAll(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["'](?:stylesheet|modulepreload)["']/g)) out.push(m[1]);
  return out.filter((s) => !/^https?:/.test(s));
}

const seen = new Map();   // rel -> importer
const dynamics = [];
const missing = [];
const queue = [];

function visit(fileRel, from) {
  if (seen.has(fileRel)) return;
  seen.set(fileRel, from);
  queue.push(fileRel);
}

function sourceOf(fileRel) {
  // An entry is read from the target (it is the distillate's own); everything else from here.
  const own = OWN.has(fileRel) ? path.join(TARGET, fileRel) : null;
  if (own && fs.existsSync(own) && fs.statSync(own).isFile()) return fs.readFileSync(own, 'utf8');
  const here = path.join(ROOT, fileRel);
  if (fs.existsSync(here) && fs.statSync(here).isFile()) return fs.readFileSync(here, 'utf8');
  return null;
}

for (const e of OWN) if (/\.(m?js|html)$/.test(e) && fs.existsSync(path.join(TARGET, e))) visit(e, '(entry)');
visit('scan.mjs', '(entry)');

while (queue.length) {
  const f = queue.shift();
  const text = sourceOf(f);
  if (text == null) { missing.push(`${f}  <- ${seen.get(f)}`); continue; }
  if (f.endsWith('.html')) {
    for (const s of htmlImports(text)) {
      const r = resolve(s.startsWith('/') ? s : './' + s, f);
      if (r) visit(r, f);
    }
    continue;
  }
  if (!/\.(m?js)$/.test(f)) continue;
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[1] || m[2] || m[3] || m[4];
    const r = resolve(spec, f.startsWith('shared/') || !f.startsWith('web/') ? f : f);
    if (!r) continue;
    // `shared/x` from the browser is the import map's, which points at the repo's shared/.
    visit(r, f);
  }
  if (DYNAMIC.test(text)) dynamics.push(f);
  DYNAMIC.lastIndex = 0;
}

// What the last run copied and this one does not need any more goes, so a module an entry stopped
// importing does not linger in the distillate. Only files the last DISTILLED.txt names: never an
// entry, never anything the distillate made itself.
const reportFile = path.join(TARGET, 'DISTILLED.txt');
const dropped = [];
if (fs.existsSync(reportFile)) {
  for (const line of fs.readFileSync(reportFile, 'utf8').split(/\r?\n/)) {
    const m = /^(\S+)\s+<- /.exec(line);
    if (!m || line.includes('<- (tree)')) continue;
    const f = m[1];
    if (OWN.has(f) || seen.has(f)) continue;
    const at = path.join(TARGET, f);
    if (!fs.existsSync(at)) continue;
    dropped.push(f);
    if (!DRY) fs.rmSync(at);
  }
}

const copied = [];
for (const [f, from] of [...seen].sort()) {
  if (OWN.has(f)) continue;
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
  copied.push(`${f}  <- ${from}`);
  if (DRY) continue;
  const dst = path.join(TARGET, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
for (const t of TREES) {
  const src = path.join(ROOT, t);
  if (!fs.existsSync(src)) continue;
  copied.push(`${t}  <- (tree)`);
  if (!DRY) fs.cpSync(src, path.join(TARGET, t), { recursive: true });
}

const report = [
  `# Distilled from ${ROOT} on ${new Date().toISOString()}`,
  `# ${copied.length} files; the entries (${[...OWN].join(', ')}) are the distillate's own.`,
  '', ...copied,
  '', '# Not found (an import of a file that does not exist):', ...missing,
  '', '# Dynamic imports from a variable, not followed:', ...dynamics,
].join('\n') + '\n';
if (!DRY) fs.writeFileSync(reportFile, report);
console.log(`${copied.length} files${DRY ? ' (dry run)' : ''}, ${dropped.length} no longer needed, ${missing.length} missing, ${dynamics.length} with dynamic imports`);
if (missing.length) console.log(missing.join('\n'));
