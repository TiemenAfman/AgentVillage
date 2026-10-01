// A prop put down by hand is solid in its own shape (web/js/props.js propSolids,
// Plans/hitboxes-en-looppaden.md): everything of it below a settler's head is inside what walk mode
// bumps into, turned with the prop, and a crate, a barrel or a woodpile has a top to jump onto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const el = () => ({ addEventListener: noop, removeEventListener: noop, style: {}, getContext: () => null });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };
const { propGeometry, propSolids } = await import('../web/js/props.js');
const { insideSolid, surfaceHeight, topOf } = await import('../web/js/solids.js');

// Shapes walked through or over on purpose, and the two whose crown hangs past the trunk.
const NONE = new Set(['bush', 'bridge', 'archbridge', 'dock']);
const CROWN = new Set(['tree', 'pine']);
const KINDS = ['tree', 'pine', 'bush', 'rock', 'cairn', 'bench', 'barrel', 'cart', 'crate', 'woodpile', 'tent',
  'washline', 'lamp', 'signpost', 'well', 'statue', 'campfire', 'flag', 'fence', 'panel', 'bridge', 'dock'];
const HEAD = 0.45;            // what a body's span (walk.js BODY_H) runs into
const SKIN = 0.04;            // what a vertex may stick out of its solid: a hair, not a hand

function lowPoints(p) {
  const g = propGeometry(p);
  const pos = g.attributes.position;
  const out = [];
  const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), k = p.scale || 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) * k, y = pos.getY(i) * k, z = pos.getZ(i) * k;
    if (y > HEAD || y < 0) continue;
    // mesh.rotation.y = rot: the same turn blockersOf in main.js makes
    out.push([p.x + x * c + z * s, p.z - x * s + z * c]);
  }
  return out;
}

for (const kind of KINDS) {
  test(`${kind}: solid in its own shape, turned with it`, () => {
    for (const rot of [0, 0.7, Math.PI / 2]) {
      const p = { kind, x: 3, z: -2, rot, length: 4, scale: kind === 'rock' ? 1.3 : 1 };
      const solids = propSolids(p, 0.2);
      if (NONE.has(kind)) { assert.equal(solids.length, 0); continue; }
      assert.ok(solids.length > 0, 'no solid at all');
      if (CROWN.has(kind)) continue;
      const out = lowPoints(p).filter(([x, z]) => !solids.some((b) => insideSolid(b, x, z, SKIN)));
      assert.equal(out.length, 0, `${out.length} low points outside at rot ${rot}, e.g. ${out[0]}`);
    }
  });
}

test('a tree is its trunk and a pine the skirt of its lowest cone, not a square round the crown', () => {
  const [tree] = propSolids({ kind: 'tree', x: 0, z: 0 });
  assert.ok(tree.r && tree.r < 0.2, `tree r ${tree.r}`);
  assert.equal(insideSolid(tree, 0.3, 0.3, 0.16), false);
});

test('what has a top stands its height over where the prop stands', () => {
  const [crate] = propSolids({ kind: 'crate', x: 0, z: 0 }, 0.5);
  assert.equal(crate.top, true);
  assert.ok(Math.abs(crate.y1 - 0.73) < 1e-9);
  assert.equal(surfaceHeight(topOf(crate), 0.05, 0.05), crate.y1);
  const [bench] = propSolids({ kind: 'bench', x: 0, z: 0, rot: Math.PI / 4 }, 0);
  assert.equal(bench.yaw, Math.PI / 4);
  // Beside the seat's back, where its old square reached and the seat does not.
  assert.equal(insideSolid(bench, 0.45, 0.45, 0.16), false);
});
