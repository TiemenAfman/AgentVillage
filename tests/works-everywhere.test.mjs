// `layout.works` (shared/terrain.mjs `checkWorks`) is ground: every makeTerrain() that builds an
// island's real ground has to be handed it, or that side draws another island - the layout
// plans on one coast and the page, the sea or the garden judges another, and the terrain hash
// says "two machines running different code". The polders' pools once missed exactly one such
// place (2bec709) and every sea refused the island. So the source is read here: any call that
// hands over the ground the layout decided (`polders`, `fairway` or `grow`) must hand over
// `works` too. A call that hands none of them (a starter island, the volcano, a founding
// ground) builds nothing the layout decided and is left alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
// Deliberate: the horizon draws a silhouette at a range where a polder, a channel or a dug
// mouth is less than a pixel, and it ignores the polders for the same reason (CLAUDE.md).
const EXEMPT = new Set(['web/js/horizon.js']);

function files() {
  const out = ['scan.mjs', 'serve.mjs', 'sea.mjs'].filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const dir of ['lib', 'shared', 'web/js', 'tools']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) { if (e.name !== 'vendor') walk(rel); } else if (/\.(mjs|js)$/.test(e.name) && !/-mesh\.js$/.test(e.name)) out.push(rel);
      }
    };
    walk(dir);
  }
  return out;
}

// The text of every `makeTerrain(...)` call, from the open paren to its match, comments skipped.
function calls(src) {
  const out = [];
  const code = src.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const re = /makeTerrain\(/g;
  let m;
  while ((m = re.exec(code))) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 16), m.index))) continue;   // the definition
    let depth = 0, i = m.index + 'makeTerrain'.length;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) break;
    }
    out.push({ at: code.slice(0, m.index).split('\n').length, text: code.slice(m.index, i + 1) });
  }
  return out;
}

test('every makeTerrain that builds the ground the layout decided is handed the earthworks', () => {
  const missing = [];
  let checked = 0;
  for (const f of files()) {
    if (EXEMPT.has(f)) continue;
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    // A file that builds its options in one helper (`const opts = (...) => ({ ... })`: growStep
    // and the measuring tool) is judged by that helper's line.
    const helper = (/^\s*const opts = .*$/m.exec(src) || [''])[0];
    for (const c of calls(src)) {
      const text = /\bopts\(/.test(c.text) ? c.text + helper : c.text;
      if (!/\b(polders|fairway|grow)\b/.test(text)) continue;
      checked++;
      if (!/\bworks\b/.test(text)) missing.push(`${f}:${c.at}  ${c.text.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  assert.ok(checked >= 20, `only ${checked} calls were found - has the pattern stopped matching?`);
  assert.deepEqual(missing, [], `these build an island's ground without its earthworks:\n${missing.join('\n')}`);
});

test('growStep hands the earthworks to every ground it builds through its own opts()', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/layout.mjs'), 'utf8');
  const opts = /const opts = \(steps\) => \((.*)\);\s*$/m.exec(src);
  assert.ok(opts, 'growStep no longer builds its terrain through opts()');
  assert.match(opts[1], /\bworks\b/);
});
