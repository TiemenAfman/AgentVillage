// The brewery, the training field and the quarry (scripts/build-workshops.py, web/js/quarry.js,
// Plans/DONE/ambachten.md): three trades in one Blender set, each a building and a yard.
//
// What is held here is what a trade is trusted with before `TRADES` in lib/layout.mjs hands it a
// three by three: that the whole of each bake fits half a lot either way from its middle (the
// training field's fence stands on the lot line, as the stable's paddock rail does, and pokes
// half a post past it and nothing else), that the brewery's chimney and copper and the field's
// flagpole carry the anchors main.js reads, and that the quarry's crane does what it is drawn
// doing - its tip over the block it picks up and over the tub it lets it down on, the block
// clear of the bench while it swings, the tub on its rail, the treadwheel turned by exactly the
// rope it winds. A crane that lowers a block through the rock is the kind of thing found on the
// island rather than here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { buildBuilding, meshAsset, isQuarryMoving } = await import('../web/js/buildings.js');
const { attachQuarry, updateQuarry, disposeQuarry, quarryGeometry, craneAt, tipAt, CYCLE, LIFT } = await import('../web/js/quarry.js');
const { WORKSHOPS } = await import('../web/js/workshops-mesh.js');
const models = await import('../web/js/models.js');
const THREE = await import('three');
delete globalThis.document;

const LOT = 3;
// Half of a fence post (0.036 square) standing centred on the lot line; the same allowance
// tests/trades.test.mjs gives the stable.
const POST = 0.02;
const SETTLER = 0.43;
const BUILDINGS = {
  brewery: ['civic_brewery', 'civic_brewery_copper', 'civic_brewery_yard'],
  trainingfield: ['civic_trainingfield', 'civic_trainingfield_yard'],
  quarry: ['civic_quarry', 'civic_quarry_yard'],
};
const spec = (civicType) => ({ id: `c:${civicType}`, kind: 'civic', civicType, tier: 'civic', style: 'unknown', ornaments: [] });
const tris = (names) => names.reduce((n, p) => n + WORKSHOPS.parts[p].positions.length / 9, 0);

// How far a building's assets reach from its middle, either way along either axis, the way
// tests/trades.test.mjs measures a trade: a lot is square and turned by quarters.
function reachOf(assets) {
  let far = 0;
  for (const asset of assets) {
    for (const name of WORKSHOPS.assets[asset].parts) {
      const p = WORKSHOPS.parts[name];
      for (let i = 0; i < p.positions.length; i += 3) {
        far = Math.max(far, Math.abs(p.positions[i] + p.at[0]), Math.abs(p.positions[i + 2] + p.at[2]));
      }
    }
  }
  return far;
}

test('each trade fits the three by three a trade is given, and only the fence reaches its line', () => {
  for (const [type, assets] of Object.entries(BUILDINGS)) {
    const reach = reachOf(assets);
    assert.ok(reach <= LOT / 2 + POST, `the ${type} reaches ${reach.toFixed(3)} from its middle on a lot ${LOT} wide`);
    if (type !== 'trainingfield') assert.ok(reach < LOT / 2, `the ${type} stands over its lot line (${reach.toFixed(3)})`);
  }
  // The field's fence is on the line, all four sides of it.
  assert.ok(reachOf(['civic_trainingfield']) > LOT / 2, 'the training field is fenced inside its lot, not on its line');
});

test('the three draw as civic buildings, each as tall as itself and not as the set', () => {
  stub();
  const heights = {};
  for (const type of Object.keys(BUILDINGS)) {
    const built = buildBuilding(spec(type));
    assert.ok(built.geometry.attributes.position.count > 0, `${type} drew nothing`);
    heights[type] = built.height;
    built.geometry.dispose();
  }
  delete globalThis.document;
  // The set's building_height is the brewery's chimney; a field is no such height.
  assert.equal(models.heightOf('civic_trainingfield'), WORKSHOPS.height);
  assert.ok(heights.brewery > heights.quarry && heights.quarry > heights.trainingfield, JSON.stringify(heights));
  assert.ok(Math.abs(models.topOf('civic_brewery') - WORKSHOPS.height) < 1e-6, 'the chimney is not the top of the set');
});

test('the brewery smokes from its chimney and steams from its copper', () => {
  stub();
  const built = buildBuilding(spec('brewery'));
  delete globalThis.document;
  const smoke = built.anchors.smoke, steam = built.animated.steam && built.animated.steam.at;
  assert.ok(smoke, 'no smoke out of the chimney');
  assert.ok(steam, 'no steam out of the copper');
  // Both off their own asset's anchor, lifted the same by the step the building stands on.
  const chimney = WORKSHOPS.assets.civic_brewery.anchors.smoke, copper = WORKSHOPS.assets.civic_brewery_copper.anchors.smoke;
  assert.ok(Math.abs((smoke[1] - chimney[1]) - (steam[1] - copper[1])) < 1e-9);
  // The chimney tops the brewhouse's ridge, and the steam leaves the copper's pipe above the
  // lean-to's roof rather than inside it.
  assert.ok(chimney[1] > models.topOf('civic_brewery') && chimney[1] - 1 > models.topOf('civic_brewery_copper'));
  assert.ok(copper[1] > models.topOf('civic_brewery_copper'), 'the steam starts inside the pipe');
  built.geometry.dispose();
});

test('the training field flies the island flag from its shelter, inside its fence', () => {
  const flag = WORKSHOPS.assets.civic_trainingfield.anchors.flag;
  assert.ok(flag, 'no flagpole');
  // main.js hangs a pennant 0.3 long off the anchor towards +x (createFlagMesh).
  assert.ok(flag[0] + 0.3 < LOT / 2 && Math.abs(flag[2]) < LOT / 2);
  // A settler stands under the shelter's roof, and walks through the gate.
  assert.ok(flag[1] > SETTLER * 2);
});

test('the quarry\'s moving parts are exactly the crane, its load and the tub, and drawn once', () => {
  const yard = WORKSHOPS.assets.civic_quarry_yard.parts;
  const moving = [...new Set(yard.filter(isQuarryMoving).map((n) => n.split(':')[0].replace('civic_quarry_yard ', '')))].sort();
  assert.deepEqual(moving, ['block', 'hook', 'jib', 'rope', 'tub', 'wheel']);
  assert.equal(WORKSHOPS.assets.civic_quarry.parts.filter(isQuarryMoving).length, 0);
  assert.ok(yard.some((n) => n.startsWith('civic_quarry_yard crane')) && !isQuarryMoving('civic_quarry_yard crane'));
  stub();
  const kept = meshAsset('civic_quarry_yard', 0xffffff, { skip: isQuarryMoving });
  const built = buildBuilding(spec('quarry'));
  delete globalThis.document;
  assert.equal(kept.reduce((n, g) => n + g.attributes.position.count / 3, 0), tris(yard.filter((n) => !isQuarryMoving(n))));
  assert.ok(built.animated.quarry, 'the quarry says nothing about its crane');
  const still = tris(WORKSHOPS.assets.civic_quarry.parts) + tris(yard.filter((n) => !isQuarryMoving(n)));
  const all = still + tris(yard.filter(isQuarryMoving));
  const merged = built.geometry.attributes.position.count / 3;
  assert.ok(merged >= still && merged < all, `${merged} triangles merged: the moving parts are in it, or the still ones are not`);
  built.geometry.dispose();
});

test('the crane\'s tip is over the block it picks up and over the tub it sets it down on', () => {
  const G = quarryGeometry();
  assert.ok(Math.hypot(G.tip[0] - G.block[0], G.tip[2] - G.block[2]) < 1e-6, 'the rope does not hang over the block');
  const [x, , z] = tipAt(G, G.slewTo);
  assert.ok(Math.hypot(x - G.tub[0], z - G.tub[2]) < 1e-3, `slewed round, the tip is ${Math.hypot(x - G.tub[0], z - G.tub[2]).toFixed(4)} off the tub`);
  assert.ok(Math.abs(G.reach - G.tubReach) < 1e-3);
  // Down at the pick the hook sits on the block; down at the drop the block sits on the tub.
  assert.ok(Math.abs(G.tip[1] - G.rope.pick - G.hookH - G.blockH - G.block[1]) < 1e-6);
  assert.ok(Math.abs(G.tip[1] - G.rope.drop - G.hookH - G.blockH - G.tubTop) < 1e-6);
  assert.ok(G.rope.up > 0 && G.rope.up < G.rope.pick && G.rope.up < G.rope.drop);
  // The treadwheel is one a settler could walk in, and its drum is a drum.
  const wheelR = Math.max(...models.assetParts('civic_quarry_yard').filter((n) => n.startsWith('civic_quarry_yard wheel'))
    .flatMap((n) => { const p = models.part(n).positions; const r = []; for (let i = 0; i < p.length; i += 3) r.push(Math.hypot(p[i + 1], p[i + 2])); return r; }));
  assert.ok(wheelR * 2 * 0.85 > SETTLER && G.drumR > 0.02 && G.drumR < wheelR / 4, `wheel ${wheelR}, drum ${G.drumR}`);
});

test('at work: the block clears the bench, the tub keeps to its rail, the wheel winds the rope', () => {
  const G = quarryGeometry();
  const railEnd = G.tub[2] + G.travel;
  for (let t = 0; t < CYCLE; t += 0.02) {
    const s = craneAt(t, G);
    for (const k of ['slew', 'carried', 'run', 'load']) assert.ok(s[k] >= 0 && s[k] <= 1, `${k} ${s[k]} at ${t}`);
    const bottom = G.tip[1] - s.rope - G.hookH - G.blockH;
    // Swinging round, a carried block is up clear of the bench it came off.
    if (s.carried > 0 && s.slew > 0 && s.slew < 1) assert.ok(bottom >= G.block[1] + LIFT - 1e-6, `the block swings through the bench at ${t}`);
    // The rope never lets the block below where it is going.
    if (s.carried > 0) assert.ok(bottom >= Math.min(G.block[1], G.tubTop) - 1e-6, `the block goes into the ground at ${t}`);
    // Nothing is on the tub unless the tub is under the crane or on its way.
    if (s.load > 0 && s.run === 0) assert.ok(s.slew === 1 || s.carried === 0);
  }
  // The block leaves the hook where the tub is, and at the tub's own height.
  const before = craneAt(8.199, G), after = craneAt(8.201, G);
  assert.ok(before.carried === 1 && after.carried === 0 && after.load === 1 && before.slew === 1);
  assert.ok(Math.abs((G.tip[1] - before.rope - G.hookH - G.blockH) - G.tubTop) < 1e-3);
  assert.ok(G.travel > 0.5 && railEnd <= 1.5, `the tub runs ${G.travel.toFixed(3)} to ${railEnd.toFixed(3)}`);

  // And the same frames make the same quarry, the wheel turned by the rope and the tub on the rail.
  stub();
  const run = () => {
    const material = new THREE.MeshBasicMaterial();
    const group = new THREE.Group();
    const q = attachQuarry(group, [0, 0.18, 0], material);
    const seen = [];
    for (let i = 0; i < 60 * CYCLE; i++) {
      updateQuarry(q, 1 / 60);
      const s = craneAt(q.time, G);
      assert.ok(Math.abs(q.wheel.rotation.x * G.drumR - (G.rope.pick - s.rope)) < 1e-9);
      assert.ok(q.tub.position.z >= G.tub[2] - 1e-9 && q.tub.position.z <= railEnd + 1e-9);
      if (i % 90 === 0) seen.push([q.jib.rotation.y, q.hook.position.toArray(), q.tub.position.z, q.block.visible, q.load.visible]);
    }
    disposeQuarry(q);
    assert.equal(group.children.length, 0);
    return seen;
  };
  const first = run();
  assert.deepEqual(run(), first);
  delete globalThis.document;
});
