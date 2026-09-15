#!/usr/bin/env node
// Bundles the world generator into a single HTML page that runs it in the browser.
//
// The generator is plain JavaScript with no Node dependencies - only `publish.mjs` touches the
// filesystem - so the same code that writes the chunks can draw the island live. That matters:
// a preview built from a copy of the generator drifts from it within a week, and then you are
// tuning one thing and looking at another.
//
//   node scripts/preview.mjs --out docs/island-preview.html
import fs from 'node:fs';
import path from 'node:path';

const MODULES = [
  'shared/rng.mjs',
  'lib/world/noise.mjs',
  'lib/world/shape.mjs',
  'lib/world/relief.mjs',
  'lib/world/classify.mjs',
  'lib/world/erode.mjs',
  'lib/world/water.mjs',
  'lib/world/bake.mjs',
];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// A deliberately small bundler: strip the import lines, drop the `export` keyword, concatenate
// in dependency order. It works because the modules share no names - there is a test for that
// in spirit, and `node --check` on the result catches it if they ever do.
function bundle() {
  const parts = [];
  for (const rel of MODULES) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    const stripped = src
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm, '')
      .replace(/^export\s+\{[^}]*\};\s*$/gm, '')
      .replace(/^export\s+/gm, '');
    parts.push(`// ---- ${rel} ${'-'.repeat(Math.max(0, 66 - rel.length))}\n${stripped.trim()}\n`);
  }
  return parts.join('\n');
}

const out = arg('out', 'docs/island-preview.html');
const html = fs.readFileSync(path.join(root, 'scripts', 'preview-template.html'), 'utf8')
  .replace('/*__GENERATOR__*/', () => bundle());

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} kB`);
