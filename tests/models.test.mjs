// The Blender pipeline, from both ends: the rules that say what a baked set may be, and
// a shape that came out of one standing up as an ordinary part of the island.
//
// These run the same checkAll() that `npm run models` runs, over the modules committed
// here rather than over whatever Blender just wrote. So a .blend that is edited by hand
// and baked with a rule broken fails in the test suite too, on a machine that has no
// Blender on it at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { checkSet, checkAll, SHEETS, BUDGETS, HERO_BUDGET } from '../scripts/model-rules.mjs';
import { TAVERN } from '../web/js/tavern-mesh.js';
import { PROPS } from '../web/js/props-mesh.js';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js builds a TextureLoader as it loads, and props.js is built on buildings.js.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { propGeometry, propFootprint, propReach } = await import('../web/js/props.js');
const models = await import('../web/js/models.js');
delete globalThis.document;

// One legal part: `n` triangles standing on the ground and centred on the origin, so a
// test can break exactly one rule and read one complaint.
function part(n, over = {}) {
  const positions = [];
  const colors = [];
  for (let i = 0; i < n; i++) {
    positions.push(-0.1, 0, -0.1, 0.1, 0, 0.1, 0, 0.2, 0);
    colors.push(1, 1, 1, 1, 1, 1, 1, 1, 1);
  }
  return { positions, colors, sheet: 'plank', emissive: 0, at: [0, 0, 0], ...over };
}
const set = (parts, assets) => ({ parts, anchors: {}, height: 1, ...(assets ? { assets } : {}) });
const one = (partOver, assetOver) => set(
  { 'prop_thing body': part(partOver.n ?? 1, partOver) },
  { prop_thing: { parts: ['prop_thing body'], anchors: {}, ...assetOver } },
);
const complains = (bad, re) => assert.ok(bad.some((m) => re.test(m)), `expected ${re} in:\n  ${bad.join('\n  ')}`);

test('what is committed is within the rules, and the tavern is the one hero', () => {
  assert.deepEqual(checkAll({ tavern: TAVERN, props: PROPS }), []);
  const tris = Object.values(TAVERN.parts).reduce((n, p) => n + p.positions.length / 9, 0);
  // A hero asset is something decided, not something a set becomes by growing: if the
  // tavern ever passes this, that is a conversation and not a number to raise.
  assert.ok(tris < HERO_BUDGET, `the tavern is ${tris} triangles against ${HERO_BUDGET}`);
  assert.equal(Object.keys(TAVERN.parts).length, 152);
});

test('a material that names no sheet is refused, with the six that exist', () => {
  const bad = checkSet('props', one({ sheet: 'walls' }));
  complains(bad, /sheet "walls" is not one of/);
  for (const sheet of Object.keys(SHEETS)) complains(bad, new RegExp(`\\b${sheet}\\b`));
  // And every sheet the island actually has is accepted, so the table cannot drift.
  for (const sheet of Object.keys(SHEETS)) assert.deepEqual(checkSet('props', one({ sheet })), []);
});

test('an asset over the budget for its name prefix is refused', () => {
  const budget = BUDGETS.find(([prefix]) => prefix === 'prop_')[1];
  assert.deepEqual(checkSet('props', one({ n: budget })), []);
  complains(checkSet('props', one({ n: budget + 1 })), new RegExp(`${budget + 1} triangles over a budget of ${budget}`));
  // A name that matches no prefix has no budget, which is its own kind of wrong: it is
  // how a shape would otherwise slip in with no ceiling at all.
  complains(checkSet('props', set({ thing: part(1) }, { thing: { parts: ['thing'] } })), /no budget/);
});

test('an origin off the ground, or off centre under a prop, is refused', () => {
  complains(checkSet('props', one({ at: [0, 0.5, 0] })), /sits 0\.500 off the ground/);
  complains(checkSet('props', one({ at: [0, -0.2, 0] })), /off the ground/);
  complains(checkSet('props', one({ at: [0.9, 0, 0] })), /off the x origin/);
  complains(checkSet('props', one({ at: [0, 0, 0.9] })), /off the z origin/);
});

test('an anchor nothing reads is a typo, and two sets cannot share a part name', () => {
  assert.deepEqual(checkSet('props', one({}, { anchors: { smoke: [0, 1, 0] } })), []);
  complains(checkSet('props', one({}, { anchors: { banner: [0, 1, 0] } })), /anchor\.banner is not one of/);
  complains(checkAll({ a: one({}), b: one({}) }), /already baked a part with that name/);
});

test('a baked prop builds as an ordinary island part, in one draw call', () => {
  const g = propGeometry({ kind: 'barrel' });
  const count = g.attributes.position.count;
  // One geometry, no material groups: ten barrels are ten meshes of one material, which
  // is what keeps them free. A group here would be a draw call per part of the barrel.
  assert.equal(g.groups.length, 0);
  for (const name of ['normal', 'color', 'aSheet', 'aEmissive']) {
    assert.equal(g.attributes[name].count, count, `${name} covers every vertex`);
    assert.ok(g.attributes[name].array.every(Number.isFinite));
  }
  // Staves and lid are drawn on the plank sheet, the iron hoops on none. Both have to
  // survive the merge: props.js used to weld with a copy of merge() that dropped the
  // sheet of any part that carried one, which left the whole barrel untextured.
  assert.ok(g.attributes.aSheet.array.includes(SHEETS.plank), 'the oak is on the plank sheet');
  assert.ok(g.attributes.aSheet.array.includes(0), 'the iron is on none');
  assert.ok(!g.attributes.aEmissive.array.some((v) => v !== 0), 'nothing on a barrel glows');
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.y) < 1e-6, 'it stands on the ground');
  // And it stays something walk mode can be got past: one small square, not a blob.
  assert.equal(propFootprint({ kind: 'barrel', x: 0, z: 0 }).length, 1);
  assert.ok(propReach({ kind: 'barrel' }) < 0.55);
  g.dispose();
});

test('the loose barrel is the tavern\'s barrel, not a second kind of barrel', () => {
  const g = propGeometry({ kind: 'barrel' });
  g.computeBoundingBox();
  const mine = g.boundingBox;
  // The tavern stands two of them, each of four parts. Measured in the barrel's own
  // space - x and z are already about its axis, and only y needs its origin adding -
  // both barrels fall on top of each other and all eight parts give one barrel's box.
  const theirs = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  let parts = 0;
  for (const [name, p] of Object.entries(TAVERN.parts)) {
    if (!name.startsWith('Barrel')) continue;
    parts++;
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k] + (k === 1 ? p.at[k] : 0);
        theirs.lo[k] = Math.min(theirs.lo[k], v);
        theirs.hi[k] = Math.max(theirs.hi[k], v);
      }
    }
  }
  assert.equal(parts, 8, 'the tavern still has its pair of barrels by the door');
  assert.ok(Math.abs((mine.max.y - mine.min.y) - (theirs.hi[1] - theirs.lo[1])) < 1e-6, 'same height');
  // Eight facets against the tavern's ten, so the widest point of the hoops sits at a
  // different angle - 0.011 of a unit, four centimetres. The barrel is the same barrel
  // to within that phase, and that is as close as a cheaper facet count can get.
  assert.ok(Math.abs((mine.max.x - mine.min.x) - (theirs.hi[0] - theirs.lo[0])) < 0.02, 'same width');
  // Same three colours, and that is what makes them read as a set rather than as a pair
  // of barrels and a stranger.
  assert.deepEqual(PROPS.parts['prop_barrel staves'].colors.slice(0, 3), TAVERN.parts.Barrel.colors.slice(0, 3));
  assert.deepEqual(PROPS.parts['prop_barrel lid'].colors.slice(0, 3), TAVERN.parts['Barrel lid'].colors.slice(0, 3));
  assert.deepEqual(PROPS.parts['prop_barrel hoop lower'].colors.slice(0, 3), TAVERN.parts['Barrel hoop'].colors.slice(0, 3));
  g.dispose();
});

test('the register spans every set and answers by part name alone', () => {
  assert.deepEqual(models.setNames().sort(), ['props', 'tavern']);
  assert.deepEqual(models.assetNames().sort(), ['prop_barrel', 'tavern']);
  assert.equal(models.assetSet('prop_barrel'), 'props');
  assert.equal(models.assetSet('tavern'), 'tavern');
  // A part is asked for by its own name; which .blend it came out of is not the caller's
  // business, and that is the whole point of the register.
  assert.ok(models.has('Plaster walls') && models.setOf('Plaster walls') === 'tavern');
  assert.ok(models.has('prop_barrel staves') && models.setOf('prop_barrel staves') === 'props');
  assert.equal(models.part('no such part'), null);
  assert.equal(models.heightOf('tavern'), TAVERN.height);
  assert.equal(models.assetTris('prop_barrel'), 112);
  // Nothing in the register is unknown to the rules, which is what keeps `npm run models`
  // and this file from disagreeing about what a legal model is.
  assert.deepEqual(checkAll(Object.fromEntries(models.setNames().map((s) => [s, s === 'tavern' ? TAVERN : PROPS]))), []);
});
