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
import { checkSet, checkAll, SHEETS, BUDGETS, HERO_BUDGET, budgetOf } from '../scripts/model-rules.mjs';
import { KINDS, knownShape } from '../shared/shapes.mjs';
import { GOLDPIT } from '../web/js/goldpit-mesh.js';
import { LIGHTHOUSE } from '../web/js/lighthouse-mesh.js';
import { CLOCKTOWER } from '../web/js/clocktower-mesh.js';
import { STATUE } from '../web/js/statue-mesh.js';
import { CASTLE } from '../web/js/castle-mesh.js';
import { GREATCASTLE } from '../web/js/greatcastle-mesh.js';
import { TAVERN } from '../web/js/tavern-mesh.js';
import { COTTAGE } from '../web/js/cottage-mesh.js';
import { HOUSE } from '../web/js/house-mesh.js';
import { MANOR } from '../web/js/manor-mesh.js';
import { HUT } from '../web/js/hut-mesh.js';
import { WINDMILL } from '../web/js/windmill-mesh.js';
import { SCHOOL } from '../web/js/school-mesh.js';
import { TOWNHALL } from '../web/js/townhall-mesh.js';
import { PROPS } from '../web/js/props-mesh.js';
import { VILLAGE } from '../web/js/village-mesh.js';
import { FLORA } from '../web/js/flora-mesh.js';
import { RAIL } from '../web/js/rail-mesh.js';
import { FENCE } from '../web/js/fence-mesh.js';
import { HEDGE } from '../web/js/hedge-mesh.js';
import { WALL } from '../web/js/wall-mesh.js';
import { DOCKS } from '../web/js/docks-mesh.js';
import { BOARDWALK } from '../web/js/boardwalk-mesh.js';
import { QUAYSTEPS } from '../web/js/quaysteps-mesh.js';
import { BUOYS } from '../web/js/buoys-mesh.js';
import { BENCHY } from '../web/js/benchy-mesh.js';
import { BICYCLE } from '../web/js/bicycle-mesh.js';
import { SAWMILL } from '../web/js/sawmill-mesh.js';
import { SMITHY } from '../web/js/smithy-mesh.js';
import { FAUNA } from '../web/js/fauna-mesh.js';
import { STABLE } from '../web/js/stable-mesh.js';
import { FARMYARD } from '../web/js/farmyard-mesh.js';
import { BAKERY } from '../web/js/bakery-mesh.js';

// Every set there is, so that adding one to web/js/models.js and forgetting it here
// cannot leave a whole .blend unchecked.
const BAKED = { goldpit: GOLDPIT, windmill: WINDMILL, boardwalk: BOARDWALK, quaysteps: QUAYSTEPS, manor: MANOR, house: HOUSE, cottage: COTTAGE, hut: HUT, school: SCHOOL, tavern: TAVERN, townhall: TOWNHALL, props: PROPS, village: VILLAGE, flora: FLORA, rail: RAIL, fence: FENCE, hedge: HEDGE, wall: WALL, docks: DOCKS, benchy: BENCHY, bicycle: BICYCLE, buoys: BUOYS, castle: CASTLE, greatcastle: GREATCASTLE, lighthouse: LIGHTHOUSE, clocktower: CLOCKTOWER, statue: STATUE, sawmill: SAWMILL, smithy: SMITHY, fauna: FAUNA, stable: STABLE, farmyard: FARMYARD, bakery: BAKERY };

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

// The four boundary sets, which are `prop_` too and are none of those. A bay of post and
// rail, of paling fence, of hedge or of dry stone is within a prop's budget and is put
// down by the hundred, so each is classed as one - but none is anybody's yard furniture
// and no shape in shared/shapes.mjs answers to them. They are the four rungs of the hamlet
// boundary, laid by modelled() in web/js/hamlets.js, which is why they are listed apart
// from the six above rather than being expected to pass the catalogue tests they would
// fail.
const BOUNDARY_ASSETS = [
  'prop_rail_a', 'prop_rail_b', 'prop_railpost',
  'prop_fence_a', 'prop_fence_b', 'prop_fencepost',
  'prop_hedge_a', 'prop_hedge_b',
  'prop_wall_a', 'prop_wall_b', 'prop_wallpier',
];

// And the quay's five, which are `prop_` for the same reason the boundary sets are: a bay
// of decking is within a prop's budget and is laid one per ground cell. Nothing in
// shared/shapes.mjs answers to any of them either - the catalogue's `dock` is a run of
// them, not one of them - so they are listed here rather than expected to pass the
// catalogue tests they would fail. What they have instead is tests/docks.test.mjs.
const DOCK_ASSETS = [
  'prop_boardwalk_a', 'prop_boardwalk_b', 'prop_boardwalk_join_x', 'prop_boardwalk_join_z',
  'prop_dock_deck_a', 'prop_dock_deck_b', 'prop_dock_head', 'prop_dock_ramp', 'prop_dock_post',
];

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

test('what is committed is within the rules, including civic hero assets', () => {
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
  // The canvas is one folded mesh and exactly one triangle lies flat in a plane
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
  assert.deepEqual(models.setNames().sort(), ['bakery', 'benchy', 'bicycle', 'boardwalk', 'buoys', 'castle', 'clocktower', 'cottage', 'docks', 'farmyard', 'fauna', 'fence', 'flora', 'goldpit', 'greatcastle', 'hedge', 'house', 'hut', 'lighthouse', 'manor', 'props', 'quaysteps', 'rail', 'sawmill', 'school', 'smithy', 'stable', 'statue', 'tavern', 'townhall', 'village', 'wall', 'windmill']);
  assert.deepEqual(models.assetNames().sort(), [
    'addon_chimney_a', 'addon_dormer_a', 'addon_quay_coping', 'addon_quay_tread', 'addon_tent_camp', 'addon_tent_mound', 'addon_turret_a',
    // The boat. A hero, because it is one hull authored as one thing and you ride in it -
    // scripts/build-benchy.py reduces the coloured Blender source to one painted mesh.
    'benchy',
    // The bicycle, for the same reason: one thing you ride, in seven parts that turn
    // (scripts/build-bicycle.py, Plans/fiets.md).
    'bicycle', 'castle',
    'civic_bakery', 'civic_chapel', 'civic_fountain', 'civic_goldpit', 'civic_quay_platform',
    // The sawmill is two, the barn and its yard; what turns is parts inside the yard
    // (scripts/build-sawmill.py, Plans/zagerij.md).
    'civic_sawmill', 'civic_sawmill_yard',
    'civic_seed_stall',
    // The smithy too: the house and the lean-to, with its bellows, fire and lantern inside the
    // lean-to's asset (scripts/build-smithy.py, Plans/smidse.md).
    'civic_smithy', 'civic_smithy_yard',
    // The stable and its paddock (scripts/build-stable.py); the horse is fauna_horse.
    'civic_stable', 'civic_stable_yard',
    'civic_tables', 'civic_watertower',
    // The mill is two assets, because its sails turn and the tower does not.
    'civic_windmill', 'civic_windmill_sails',
    'clocktower',
    // The animals, each in moving parts (scripts/build-fauna.py, web/js/fauna.js).
    'fauna_chicken', 'fauna_cow', 'fauna_duck', 'fauna_goat', 'fauna_gull', 'fauna_horse', 'fauna_pig', 'fauna_sheep', 'fauna_sparrow', 'fauna_sparrow_flying',
    'flora_bush_a', 'flora_grass_a', 'flora_oak_a', 'flora_oak_a_lo', 'flora_pine_a', 'flora_pine_a_lo',
    'flora_rock_a', 'flora_rock_b',
    // The castle on its seven by seven, built at that size rather than the castle drawn at 7/3
    // (scripts/build-greatcastle.py, Plans/groot-kasteel.md).
    'greatcastle',
    'house_cottage_a', 'house_house_a', 'house_hut_a', 'house_manor_a',
    'lighthouse',
    // All sets' `prop_` assets, sorted back together: the register is flat across sets
    // on purpose, and this is the one place that shows it.
    ...[...PROP_ASSETS, ...BOUNDARY_ASSETS, ...DOCK_ASSETS, 'prop_buoy_red', 'prop_buoy_green', 'prop_goldbar', 'prop_goldcoin',
      // The fields and the water's edge (scripts/build-farmyard.py).
      'prop_beehive', 'prop_haystack', 'prop_reeds', 'prop_scarecrow', 'prop_waterlily'].sort(),
    'roof_cone_a', 'roof_gable_a', 'roof_gable_b', 'roof_hip_a', 'school', 'statue', 'tavern', 'townhall',
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
  // The forest is asked for by name rather than by prefix, and this is why: variants()
  // would offer the modest GPU's cheap copy of a pine as a third kind of pine to plant.
  assert.deepEqual(models.variants('flora_pine'), ['flora_pine_a', 'flora_pine_a_lo']);
  assert.deepEqual(models.variants('flora_rock'), ['flora_rock_a', 'flora_rock_b']);
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

// The forest, which is the one set whose cost is not its own size. Everything here is
// multiplied by the number of stems on the island and then by two, because the shadow
// pass walks every instance as well - so these numbers are the card, not a detail of it.
test('a tree is two groups, bark before needles, in the order the materials come in', () => {
  for (const name of ['flora_pine_a', 'flora_pine_a_lo', 'flora_oak_a', 'flora_oak_a_lo']) {
    const g = models.grouped(name, ['bark', 'foliage']);
    // Two groups and in this order, because world.js hands the InstancedMesh
    // [barkMat, foliageMat] positionally. Swap them and the tree grows a wooden canopy
    // on a leafy trunk, and nothing in three.js will say a word about it.
    assert.equal(g.groups.length, 2, `${name} draws in two groups`);
    assert.deepEqual(g.groups.map((r) => r.materialIndex), [0, 1], `${name} groups are in slot order`);
    const [bark, foliage] = g.groups;
    assert.equal(bark.start, 0, `${name} starts with its trunk`);
    assert.equal(foliage.start, bark.count, `${name} canopy follows the trunk with no gap`);
    assert.equal(bark.count + foliage.count, g.attributes.position.count, `${name} has every vertex in a group`);
    assert.ok(bark.count > 0 && foliage.count > 0, `${name} has both wood and leaf`);

    // The trunk is the bottom of the tree and the canopy is the top. This is the check
    // that would have caught the first bake, where levelling every part onto the ground
    // pulled the oak's crown down around its own roots.
    const highest = (group) => {
      let y = -Infinity;
      const pos = g.attributes.position.array;
      for (let i = group.start; i < group.start + group.count; i++) y = Math.max(y, pos[i * 3 + 1]);
      return y;
    };
    assert.ok(highest(foliage) > highest(bark), `${name} wears its canopy above its trunk`);

    for (const attr of ['position', 'color', 'normal', 'uv']) {
      assert.ok(g.attributes[attr], `${name} carries ${attr}`);
      assert.ok(g.attributes[attr].array.every(Number.isFinite), `${name} ${attr} is all numbers`);
    }
    // Blender exports no UVs, so models.js projects each triangle flat itself. What has
    // to be true of the result is that no face is smeared or collapsed: a triangle with
    // no area in uv space wears one pixel of the sheet stretched over the whole of it,
    // which is how the first attempt failed - a cylindrical wrap gave the n-gon closing
    // each bough three corners a third of a turn apart.
    const uv = g.attributes.uv.array;
    const pos = g.attributes.position.array;
    for (let t = 0; t < g.attributes.position.count; t += 3) {
      const area = (b, c) => Math.abs(
        (uv[b * 2] - uv[t * 2]) * (uv[c * 2 + 1] - uv[t * 2 + 1])
        - (uv[b * 2 + 1] - uv[t * 2 + 1]) * (uv[c * 2] - uv[t * 2]),
      ) / 2;
      const flat = (b, c) => {
        const e1 = [pos[b * 3] - pos[t * 3], pos[b * 3 + 1] - pos[t * 3 + 1], pos[b * 3 + 2] - pos[t * 3 + 2]];
        const e2 = [pos[c * 3] - pos[t * 3], pos[c * 3 + 1] - pos[t * 3 + 1], pos[c * 3 + 2] - pos[t * 3 + 2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        return Math.hypot(...n) / 2;
      };
      const world = flat(t + 1, t + 2);
      // Projected onto a plane a face is foreshortened but never flattened away: a
      // third of its own area is the slackest a real triangle gets, and zero is a bug.
      assert.ok(area(t + 1, t + 2) > world / 3, `${name} has a triangle with no room on the sheet`);
    }
    g.computeBoundingBox();
    assert.ok(Math.abs(g.boundingBox.min.y) < 0.002, `${name} stands on the ground`);
    g.dispose();
  }
});

test('the plants are inside the budget that being instanced by the thousand earns them', () => {
  // Written out rather than looped, because these are the numbers the card is judged on
  // and a loop over whatever happens to be baked would assert nothing.
  for (const [name, tris] of [
    ['flora_pine_a', 50], ['flora_pine_a_lo', 30],
    ['flora_oak_a', 50], ['flora_oak_a_lo', 30],
    ['flora_bush_a', 40], ['flora_grass_a', 5], ['flora_rock_a', 20], ['flora_rock_b', 20],
  ]) {
    assert.equal(models.assetTris(name), tris, `${name} is ${models.assetTris(name)} triangles, not ${tris}`);
    assert.ok(models.assetTris(name) <= budgetOf(name, null), `${name} is over its budget`);
  }
  // The modest GPU has to come out cheaper than the island was before Blender, not
  // dearer: world.js drew a pine in 44 triangles and an oak in 40, and `_lo` is the
  // reason `?modest` lands under that baseline rather than over it.
  assert.ok(models.assetTris('flora_pine_a_lo') < 44, 'the modest pine undercuts the old one');
  assert.ok(models.assetTris('flora_oak_a_lo') < 40, 'the modest oak undercuts the old one');
  // A rock and a bush have no bark, and asking for the slots they do have is how the
  // caller gets a single-material geometry out of the same function.
  for (const [name, slots] of [['flora_rock_a', ['plain']], ['flora_rock_b', ['plain']], ['flora_bush_a', ['foliage']], ['flora_grass_a', ['foliage']]]) {
    const g = models.grouped(name, slots);
    assert.equal(g.groups.length, 1, `${name} draws in one group`);
    assert.equal(g.groups[0].count, g.attributes.position.count);
    g.dispose();
  }
  // An unknown plant is nothing rather than a crash: world.js asks hasAsset() first and
  // keeps the shapes it grew by hand as the fallback, so a renamed bake costs the island
  // its new trees and not its boot.
  assert.equal(models.grouped('flora_no_such_a', ['bark', 'foliage']), null);
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






test('a tent floor clears its mound and its camp has bedding and a night lamp', () => {
  const floor = models.part('prop_tent floor');
  const floorY = floor.positions.filter((_, i) => i % 3 === 1).map(y => y + floor.at[1]);
  assert.ok(Math.min(...floorY) > .01, 'groundsheet must not share the mound surface');
  const bag = models.part('addon_tent_camp sleeping bag');
  assert.ok(Math.min(...bag.positions.filter((_, i) => i % 3 === 1).map(y => y + bag.at[1])) > Math.max(...floorY));
  const lamp = models.part('addon_tent_camp lamp glass');
  assert.equal(lamp.emissive, 1, 'the lantern must glow through the shared night mask');
  assert.ok(lamp.at[2] > .36, 'the lantern is outside the entrance');
  const tent = buildBuilding({ id: 'camp-test', kind: 'house', tier: 'tent', style: 'sonnet', ornaments: [] }, { keepParts: true });
  const buried = tent.parts.filter(g => {
    g.computeBoundingBox();
    return g.boundingBox.min.y < -.5;
  });
  assert.ok(buried.length > 0, 'the mound needs a skirt on sloping ground');
  for (const g of buried) {
    assert.ok(!g.attributes.aSheet || g.attributes.aSheet.array.every(v => v !== 3), 'earth must not use the stone sheet');
  }
  assert.equal(tent.geometry.groups.length, 0, 'the camp is merged into the building');
  tent.geometry.dispose();
  for (const g of tent.parts) g.dispose();
});

test('the baked sleeping bag is closed and visible from every outside direction', async () => {
  const THREE = await import('three');
  const { mesh } = await import('../web/js/buildings.js');
  const geometry = mesh('addon_tent_camp sleeping bag');
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const bag = new THREE.Mesh(geometry, material);
  bag.updateMatrixWorld();
  for (const axis of [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]]) {
    const direction = new THREE.Vector3(...axis);
    const ray = new THREE.Raycaster(center.clone().add(direction), direction.negate());
    assert.ok(ray.intersectObject(bag).length > 0, `no outward face from ${axis}`);
  }
  geometry.dispose(); material.dispose();
});

test('the Blender mound carries ground textures and a continuous shoulder colour', () => {
  for (const name of models.assetParts('addon_tent_mound')) {
    assert.equal(models.part(name).sheet, 'ground', name);
  }
  const slope = models.part('addon_tent_mound slope');
  const colours = new Set();
  for (let i = 0; i < slope.colors.length; i += 3) colours.add(slope.colors.slice(i, i+3).join(','));
  assert.ok(colours.size >= 2, 'the shoulder must blend turf into earth');
});
