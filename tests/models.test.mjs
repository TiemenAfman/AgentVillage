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
import { KINDS, knownShape } from '../shared/shapes.mjs';
import { TAVERN } from '../web/js/tavern-mesh.js';
import { PROPS } from '../web/js/props-mesh.js';
import { VILLAGE } from '../web/js/village-mesh.js';

// Every set there is, so that adding one to web/js/models.js and forgetting it here
// cannot leave a whole .blend unchecked.
const BAKED = { tavern: TAVERN, props: PROPS, village: VILLAGE };

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js builds a TextureLoader as it loads, and props.js is built on buildings.js.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { propGeometry, propFootprint, propReach } = await import('../web/js/props.js');
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');
const models = await import('../web/js/models.js');
delete globalThis.document;

// The six loose props, which is the whole props set. Written out rather than taken from
// models.variants('prop_'), so that a seventh has to be thought about here too.
const PROP_ASSETS = ['prop_barrel', 'prop_cart', 'prop_crate', 'prop_tent', 'prop_washline', 'prop_woodpile'];

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
  assert.deepEqual(checkAll(BAKED), []);
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

// The props, as a set. The barrel has two tests of its own below because it has to be the
// tavern's barrel; these are the rules the other five share with it.
test('every prop in the catalogue is a baked model, and every baked prop is in it', () => {
  // Where a kind in shared/shapes.mjs and a model in the .blend have to line up. A kind
  // with no model stands as a cairn and says nothing, which is right for a shape nobody
  // has drawn yet and wrong for one that was drawn and then renamed.
  for (const asset of PROP_ASSETS) {
    const kind = asset.slice('prop_'.length);
    assert.ok(knownShape(kind), `${asset} is baked but ${kind} is in no catalogue`);
    const g = propGeometry({ kind, x: 0, z: 0 });
    g.computeBoundingBox();
    const b = g.boundingBox;
    // Not the cairn, which is what a kind with no model falls back to. A cairn is 0.84
    // tall and every one of these is under it, so height alone would not tell them apart:
    // the cairn's stake stands 0.30 off the middle on x and nothing here does.
    assert.ok(Math.abs(b.min.x + b.max.x) < 0.02, `${kind} is off centre, or it is a cairn`);
    assert.ok(Math.abs(b.min.y) < 1e-6, `${kind} stands ${b.min.y} off the ground`);
    g.dispose();
  }
  for (const kind of KINDS) {
    if (!models.hasAsset(`prop_${kind}`)) continue;
    assert.ok(PROP_ASSETS.includes(`prop_${kind}`), `prop_${kind} is baked and unlisted here`);
  }
});

test('a prop is something walk mode can be got past', () => {
  for (const asset of PROP_ASSETS) {
    const kind = asset.slice('prop_'.length);
    const spec = { kind, x: 0, z: 0 };
    const rects = propFootprint(spec);
    assert.ok(rects.length >= 1, `${kind} blocks nothing at all`);
    // A long prop - the cart, the washing line - blocks as a line of small squares rather
    // than as one square big enough to hold it. The difference is not cosmetic: the cart
    // is 0.6 long, and a square that size in a lane a unit wide is a bollard nothing can
    // walk round. So no single rectangle may be wider than a settler can pass beside.
    for (const r of rects) {
      assert.ok(r.hx <= 0.46 && r.hz <= 0.46, `${kind} blocks a ${r.hx * 2} by ${r.hz * 2} square`);
    }
    assert.ok(propReach(spec) >= 0.4, `${kind} would be a target you have to hit dead centre`);
  }
});

test('the tent is walled up at the back and opens on +z', () => {
  // The axis check the whole -Y convention exists for, and the tent is where it bites: it
  // is the one prop with a front, it is the dwelling a session lives in before it builds
  // anything, and a tent whose opening came out on -z faces its own back garden.
  //
  // The canvas is one mesh of seven triangles and exactly one of them lies flat in a plane
  // of constant z: the gable that is walled up. Which end that is answers the question.
  const canvas = models.part('prop_tent canvas');
  const gables = [];
  for (let i = 0; i < canvas.positions.length; i += 9) {
    const z = [2, 5, 8].map((k) => canvas.positions[i + k]);
    if (Math.abs(z[0] - z[1]) < 1e-6 && Math.abs(z[1] - z[2]) < 1e-6) gables.push(z[0] + canvas.at[2]);
  }
  assert.equal(gables.length, 1, 'a tent with two gables has no door and one with none has no back');
  assert.ok(gables[0] < 0, `the gable is at z = ${gables[0]}, so the tent opens away from the path`);
  // And the band the island repaints with the style's trim is the piping round that
  // opening, so it is at the other end - see tentTint in buildings.js.
  for (const name of ['prop_tent band west', 'prop_tent band east']) {
    const part = models.part(name);
    assert.ok(part, `${name} is what carries the session's colour`);
    assert.ok(part.at[2] > 0, `${name} is behind the tent rather than round its door`);
  }
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
  assert.deepEqual(models.setNames().sort(), ['props', 'tavern', 'village']);
  assert.deepEqual(models.assetNames().sort(), [
    'addon_chimney_a', 'addon_dormer_a', 'addon_turret_a', 'civic_watertower',
    ...PROP_ASSETS, 'roof_cone_a', 'roof_gable_a', 'roof_gable_b', 'roof_hip_a', 'tavern',
  ]);
  assert.equal(models.assetSet('prop_barrel'), 'props');
  assert.equal(models.assetSet('tavern'), 'tavern');
  // A part is asked for by its own name; which .blend it came out of is not the caller's
  // business, and that is the whole point of the register.
  assert.ok(models.has('Plaster walls') && models.setOf('Plaster walls') === 'tavern');
  assert.ok(models.has('prop_barrel staves') && models.setOf('prop_barrel staves') === 'props');
  assert.equal(models.part('no such part'), null);
  assert.equal(models.heightOf('tavern'), TAVERN.height);
  assert.equal(models.assetTris('prop_barrel'), 112);
  // Asking for a shape by prefix is how a caller picks one with the rng without naming
  // the variants, so a third gable is in the island's rotation the moment it is baked.
  // Sorted, because a house that reroofs itself when an object is renamed in Blender is
  // not deterministic and every plot on the island is drawn from its own seed.
  assert.deepEqual(models.variants('roof_gable'), ['roof_gable_a', 'roof_gable_b']);
  assert.deepEqual(models.variants('roof_hip'), ['roof_hip_a']);
  assert.deepEqual(models.variants('flora_'), []);
  // Nothing in the register is unknown to the rules, which is what keeps `npm run models`
  // and this file from disagreeing about what a legal model is.
  assert.deepEqual(checkAll(Object.fromEntries(models.setNames().map((s) => [s, BAKED[s]]))), []);
});

// The composables, which are the one class of asset the rules cannot check on their own:
// the budget knows a roof_ may have 300 triangles, and nothing in scripts/model-rules.mjs
// knows that buildings.js is going to multiply it by the width of a wall.
test('a roof is modelled on the unit square it will be scaled by', () => {
  for (const name of [...models.variants('roof_'), 'addon_dormer_a', 'addon_turret_a', 'addon_chimney_a']) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of models.assetParts(name)) {
      const part = models.part(p);
      for (let i = 0; i < part.positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const v = part.positions[i + k] + part.at[k];
          lo[k] = Math.min(lo[k], v);
          hi[k] = Math.max(hi[k], v);
        }
      }
    }
    const reach = Math.max(hi[0], -lo[0], hi[2], -lo[2]);
    if (name.startsWith('roof_')) {
      // Exactly the unit square, or the overhang the caller thinks it is scaling by is
      // not the overhang it gets: buildings.js multiplies by dims.w + 0.14 and nothing
      // measures the answer.
      assert.ok(reach <= 0.5 + 1e-6, `${name} reaches ${reach} past the unit square`);
      assert.ok(reach > 0.45, `${name} reaches only ${reach}, so it would leave the wall showing`);
    } else {
      // And an add-on is a thing on a roof, so it has to be small enough to walk past
      // when it is a turret standing on the ground beside the house.
      assert.ok(reach < 0.55 / 2, `${name} reaches ${reach}, over half of WALK_CLEARANCE`);
    }
    // Every one of them stands on its own bottom, which is what lets mesh() place it by
    // the plane it meets - the eaves for a roof, the tiles for a chimney.
    assert.ok(Math.abs(lo[1]) < 0.002, `${name} sits ${lo[1]} off its own base`);
  }
});

// The yard, which is the one thing about these props that cannot be checked by looking at
// the models: what matters is not the cart but whether a house that has put one out is
// still a house a settler can walk up to. So it is checked the way it would be found by
// hand - every tier, every style, thirty seeds each, walking in along the door's own
// centre line and then right round the plot in the lane.
test('a house with a yard keeps its doorstep and its lane', () => {
  const TIERS = ['tent', 'hut', 'cottage', 'house', 'manor', 'keep'];
  const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];
  // Grown by half a settler, which is the line walk mode actually stops the player at.
  const blocked = (rects, x, z) => rects.some((r) => (
    Math.abs(x - r.x) < r.hx + WALK_BODY_R && Math.abs(z - r.z) < r.hz + WALK_BODY_R));
  let withYard = 0, houses = 0;
  for (const tier of TIERS) {
    for (const style of STYLES) {
      for (let i = 0; i < 30; i++) {
        const id = `yard:${tier}:${style}:${i}`;
        const built = buildBuilding({ id, kind: 'house', tier, style, ornaments: [] }, {});
        houses++;
        if (built.solids.length > built.walls.length) withYard++;
        // The plot edge is 1.50 from the middle and the lane is the cell beyond it.
        for (const r of built.solids) {
          const out = Math.max(Math.abs(r.x) + r.hx, Math.abs(r.z) + r.hz);
          assert.ok(out < 1.5, `${id} reaches ${out.toFixed(3)} from the middle of its plot`);
        }
        // In from the lane to the doorstep, which is the walk every settler makes.
        for (let z = 2.4; z > 0.85; z -= 0.05) {
          assert.ok(!blocked(built.solids, 0, z), `${id} has its own doorstep blocked at z = ${z.toFixed(2)}`);
        }
        // And all the way round the plot, one cell out, which is where the lane runs.
        for (let t = -2; t <= 2; t += 0.1) {
          for (const [x, z] of [[t, 2], [t, -2], [2, t], [-2, t]]) {
            assert.ok(!blocked(built.solids, x, z), `${id} stands in the lane at ${x}, ${z}`);
          }
        }
        // The scaffold is sized off `walls`, so those have to stay the walls: a frame
        // round the yard would be back inside the neighbours - see addScaffold in main.js.
        for (const r of built.walls) {
          assert.ok(Math.abs(r.x) + r.hx < 1.15, `${id} has walls reaching past the house's own allowance`);
        }
      }
    }
  }
  // Two houses in three put something out, which is rng.int(3) less the nothings. A run
  // that yards nothing at all would pass every assertion above and be the bug.
  assert.ok(withYard > houses * 0.5 && withYard < houses * 0.8, `${withYard} of ${houses} houses have a yard`);
});

test('the roof add-ons carry the anchors main.js hangs things on', () => {
  assert.deepEqual(Object.keys(models.anchorsOf('addon_chimney_a')), ['smoke']);
  assert.deepEqual(Object.keys(models.anchorsOf('addon_turret_a')), ['flag']);
  assert.deepEqual(Object.keys(models.anchorsOf('civic_watertower')), ['sign']);
  // The smoke leaves the pot rather than the middle of the stack, which is the whole
  // reason the chimney is an asset and not a box.
  const smoke = models.anchorsOf('addon_chimney_a').smoke;
  assert.ok(smoke[1] > 0.7, `smoke rises from ${smoke[1]}, which is inside the brickwork`);
});
