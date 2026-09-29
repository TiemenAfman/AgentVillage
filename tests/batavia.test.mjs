// The Batavia (Plans/DONE/batavia.md, scripts/build-batavia.py): the ship the village earns, lying
// at anchor on the roads.
//
// What is held here:
//   the contract   the sizes decided with Tiemen against the galleon every island already
//                  has - a hull of ~12 at the waterline, ~15 overall with the bowsprit, ~2.8 in
//                  the beam, the main truck ~11.5 above the water, the waist ~1.1 above it -
//                  read off the bake, and the triangles against her own budget
//   what a body    the decks and ladders the bake measured of itself: rectangles of planking,
//   walks on       and between them steps no taller than walk.js steps up
//   the flags      five of them, the only parts that move, flying aft from their hoists and
//                  left out of the hull; they wave, and the hoist stays on its staff
//   the plot       on a 4 by 16 plot, at every turn, she lies along its long side with her bow
//                  where the layout's rot says, the middle of her on the middle of it, all of
//                  her inside it, and afloat
//   the liveries   civic:ship, :2 and :3 are one hull in three colourings
//   her side       swimmers meet it as a wall, and a boat's bow - the Benchy's point, the
//                  galleon's probes - meets it as a bank and stops
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { checkSet, HERO_BUDGETS, SHIP_ANCHOR } from '../scripts/model-rules.mjs';
import { BATAVIA } from '../web/js/batavia-mesh.js';
import { CRAFTS } from '../shared/crafts.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { buildBuilding, shipDraught, shipLivery, shipSolids, isBataviaMoving, SHIP_LIVERIES } = await import('../web/js/buildings.js');
const { buildFlags, waveFlags, flagParts, floatingPose, attachBatavia, updateBatavia, disposeBatavia, swellAt, SWELL } = await import('../web/js/batavia.js');
const { housePlacement } = await import('../web/js/house-placement.js');
const { stepBoat, hullOver, BOAT_SCRAPE, BOW } = await import('../web/js/boat.js');
delete globalThis.document;

const WALK_SOURCE = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
const STEP_UP = Number(WALK_SOURCE.match(/const STEP_UP = ([0-9.]+);/)[1]);

const A = BATAVIA.anchors;
const W = A.waterline[1];
const parts = Object.entries(BATAVIA.parts);
const skin = parts.filter(([n]) => /^batavia (hull|livery)/.test(n));
const still = parts.filter(([n]) => !isBataviaMoving(n));
const flags = parts.filter(([n]) => isBataviaMoving(n));

// Every vertex of some parts, in the bake's frame (keel at y = 0).
function* verts(list) {
  for (const [, p] of list) {
    for (let i = 0; i < p.positions.length; i += 3) yield [p.positions[i] + p.at[0], p.positions[i + 1] + p.at[1], p.positions[i + 2] + p.at[2]];
  }
}
const extent = (list, k, keep = () => true) => {
  let lo = Infinity, hi = -Infinity;
  for (const v of verts(list)) if (keep(v)) { lo = Math.min(lo, v[k]); hi = Math.max(hi, v[k]); }
  return [lo, hi];
};
const spec = (id = 'civic:ship', plot) => ({ id, kind: 'civic', civicType: 'ship', tier: 'civic', style: 'unknown', ornaments: [], ...(plot ? { plot } : {}) });

test('she is the size decided: longer, slimmer and taller-rigged than the galleon', () => {
  assert.ok(W > 0.9 && W < 1.1, `a draught of ${W}`);
  assert.equal(shipDraught(), W, 'buildings.js lowers her by the bake\'s own waterline');
  // The hull at the waterline: her skin where it meets the sea.
  const [zs, zb] = extent(skin, 2, (v) => Math.abs(v[1] - W) < 0.01);
  assert.ok(Math.abs(zb - zs - 12) < 0.3, `${(zb - zs).toFixed(2)} long at the waterline`);
  // Overall with the bowsprit: everything that stands still, gallery to bowsprit tip.
  const [z0, z1] = extent(still, 2);
  assert.ok(Math.abs(z1 - z0 - 15) < 0.5, `${(z1 - z0).toFixed(2)} overall`);
  assert.ok(z1 - z0 > 13 + 1, 'overall she is longer than the galleon by more than a unit');
  const [x0, x1] = extent(skin, 0);
  assert.ok(Math.abs(x1 - x0 - 2.8) < 0.1, `${(x1 - x0).toFixed(2)} in the beam`);
  const [, top] = extent(still, 1);
  assert.ok(Math.abs(top - W - 11.5) < 0.2, `the main truck ${(top - W).toFixed(2)} above the water`);
  assert.ok(top - W > 10.8, 'higher than the galleon\'s top');
  assert.ok(Math.abs(A['deck.waist.lo'][1] - W - 1.1) < 0.05, 'the waist 1.1 above the water, the galleon\'s 1.108');
  // One hero, well within her own budget - and far under the galleon's.
  const tris = parts.reduce((n, [, p]) => n + p.positions.length / 9, 0);
  assert.ok(tris >= 5000 && tris <= HERO_BUDGETS.batavia, `${tris} triangles against ${HERO_BUDGETS.batavia}`);
  assert.ok(HERO_BUDGETS.batavia <= HERO_BUDGETS.pirateship);
  assert.deepEqual(checkSet('batavia', BATAVIA), []);
});

test('her decks are rectangles of planking, and every ladder between them is steps a body takes', () => {
  const decks = Object.keys(A).filter((k) => /^deck\..+\.lo$/.test(k)).map((k) => k.slice(5, -3));
  for (const name of ['waist', 'forecastle', 'quarterdeck', 'poop', 'gangway', 'float']) assert.ok(decks.includes(name), `deck.${name}`);
  for (const name of decks) {
    const lo = A[`deck.${name}.lo`], hi = A[`deck.${name}.hi`];
    assert.ok(lo[0] < hi[0] && lo[2] < hi[2], `deck.${name} is a rectangle`);
    assert.equal(lo[1], hi[1], `deck.${name} is level`);
  }
  // The decks step up from the waist: forecastle, quarterdeck, poop, as the galleon's do.
  const h = (n) => A[`deck.${n}.lo`][1] - W;
  assert.ok(h('forecastle') > h('waist') && h('quarterdeck') > h('waist') && h('poop') > h('quarterdeck'));
  const stairs = Object.keys(A).filter((k) => /^stair\..+\.lo$/.test(k)).map((k) => k.slice(6, -3));
  assert.equal(stairs.length, 7, 'two ladders at each break and the accommodation ladder');
  const fittings = parts.filter(([n]) => /^batavia (fittings|hull|livery)/.test(n));
  for (const name of stairs) {
    const lo = A[`stair.${name}.lo`], hi = A[`stair.${name}.hi`];
    assert.ok(hi[1] > lo[1], `stair.${name} climbs from its foot to its head`);
    // Each floor it joins is a deck the bake measured.
    const floors = decks.map((d) => A[`deck.${d}.lo`][1]);
    assert.ok(floors.includes(lo[1]) && floors.includes(hi[1]), `stair.${name} runs between two decks`);
    // The treads: every level of planking inside the ladder's rectangle between its foot and
    // its head, and none of the rises between them more than a step.
    const [xa, xb] = [Math.min(lo[0], hi[0]), Math.max(lo[0], hi[0])];
    const [za, zb] = [Math.min(lo[2], hi[2]), Math.max(lo[2], hi[2])];
    const levels = new Set([lo[1], hi[1]]);
    const e = 1e-4;
    for (const v of verts(fittings)) {
      if (v[0] > xa - e && v[0] < xb + e && v[2] > za - e && v[2] < zb + e && v[1] > lo[1] && v[1] < hi[1]) levels.add(Math.round(v[1] * 1000) / 1000);
    }
    const ys = [...levels].sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] <= STEP_UP, `stair.${name} rises ${(ys[i] - ys[i - 1]).toFixed(3)} in one step`);
    assert.ok(ys.length >= 4, `stair.${name} has treads`);
  }
  for (const m of ['fore', 'main', 'mizzen']) assert.ok(A[`mast.${m}`], `mast.${m}`);
  // The rule, both ways: a ship's anchor is legal, half of a pair is not.
  assert.ok(SHIP_ANCHOR.test('deck.forecastle-bow.lo') && !SHIP_ANCHOR.test('deck.waist'));
  const half = { ...BATAVIA, anchors: { ...A } };
  delete half.anchors['deck.float.hi'];
  assert.ok(checkSet('batavia', half).some((m) => /deck\.float\.lo is one corner of deck\.float/.test(m)));
});

test('her five flags fly aft from their hoists, wave, and are no part of the hull', () => {
  const names = new Set(flags.map(([n]) => n.replace(/:\d+$/, '')));
  assert.deepEqual([...names].sort(), ['batavia flag ensign', 'batavia flag jack', 'batavia flag main', 'batavia pennant fore', 'batavia pennant mizzen']);
  for (const [name, p] of flags) {
    const hoist = flags.find(([n]) => n.replace(/:\d+$/, '') === name.replace(/:\d+$/, ''))[1].at;
    assert.deepEqual(p.at, hoist, `${name} hangs from the one hoist its flag has`);
    for (let i = 2; i < p.positions.length; i += 3) assert.ok(p.positions[i] <= 1e-6, `${name} streams aft`);
  }
  assert.deepEqual(flagParts(), flags.map(([n]) => n));
  // The hull is built without them: nothing of her merged geometry reaches aft of the gallery.
  const built = buildBuilding(spec());
  const [z0] = extent(still, 2);
  assert.ok(built.bbox.min.z >= z0 - 1e-4, 'no flag in the hull');
  const [, flagEnd] = [0, Math.min(...flags.flatMap(([, p]) => { const out = []; for (let i = 2; i < p.positions.length; i += 3) out.push(p.positions[i] + p.at[2]); return out; }))];
  assert.ok(flagEnd < z0, 'the ensign flies out over the water astern');
  // They wave: the hoist stays where it is, the fly end swings, and never far.
  const f = buildFlags('civic:ship');
  const a = waveFlags(f, 0, new Float32Array(f.base.length));
  const b = waveFlags(f, 0.7, new Float32Array(f.base.length));
  let moved = 0;
  for (let v = 0; v < f.fly.length; v++) {
    const d = Math.hypot(a[v * 3] - b[v * 3], a[v * 3 + 1] - b[v * 3 + 1]);
    if (f.fly[v] === 0) assert.equal(d, 0, 'a hoist stays on its staff');
    else if (d > 1e-4) moved++;
    assert.ok(Math.abs(a[v * 3] - f.base[v * 3]) <= 0.2 * f.len[v] + 1e-6, 'a flag swings a fifth of its length at most');
  }
  assert.ok(moved > f.fly.length / 3, 'the flags fly');
  // And the swell is small and keeps her upright; on her own mesh, never the plot's group.
  const hull = new THREE.Mesh(built.geometry);
  const group = new THREE.Group();
  group.add(hull);
  group.rotation.y = 1.2;
  const s = attachBatavia(hull, 'civic:ship', null);
  for (let t = 0; t < 40; t++) {
    updateBatavia(s, 0.5);
    assert.ok(Math.abs(hull.rotation.z) <= SWELL.roll && Math.abs(hull.rotation.x) <= SWELL.pitch && Math.abs(hull.position.y) <= SWELL.heave);
  }
  assert.equal(group.rotation.y, 1.2, 'the plot\'s turn is untouched');
  assert.equal(hull.children.length, 1, 'the flags hang on the hull');
  disposeBatavia(s);
  assert.equal(hull.children.length, 0);
  // Two ships do not rock in step.
  const other = attachBatavia(new THREE.Mesh(), 'civic:ship:2', null);
  assert.notDeepEqual(swellAt(s, 3), swellAt(other, 3));
});

test('on a 4 by 16 plot, at every turn, she lies along it, bow the way it faces, afloat and inside it', () => {
  // rot 0 faces -z, 1 +x, 2 +z, 3 -x (makeRecord in web/js/main.js); at an odd rot the plot
  // is stamped 16 by 4.
  const FACING = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const half = 64;
  for (let rot = 0; rot < 4; rot++) {
    const plot = { gx: 40, gz: 50, w: rot % 2 ? 16 : 4, d: rot % 2 ? 4 : 16, rot };
    const built = buildBuilding(spec('civic:ship', plot));
    assert.equal(built.floats, true);
    const pose = floatingPose(plot, half, built.bbox);
    assert.equal(pose.y, 0, 'on the sea, not the bed');
    // The same turn housePlacement gives any plot that is not three by three.
    assert.ok(Math.abs(pose.yaw - housePlacement(spec('civic:ship', plot), built.bbox).yaw) < 1e-12);
    const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
    const world = (x, z) => [pose.x + x * c + z * s, pose.z - x * s + z * c];
    // Her bow, local +z, points where the plot faces.
    const [bx, bz] = world(0, 1);
    assert.ok(Math.abs(bx - pose.x - FACING[rot][0]) < 1e-9 && Math.abs(bz - pose.z - FACING[rot][1]) < 1e-9, `rot ${rot} faces ${FACING[rot]}`);
    // All of her hull inside the plot, and her length along its long side.
    const px0 = plot.gx - half, px1 = px0 + plot.w, pz0 = plot.gz - half, pz1 = pz0 + plot.d;
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    const b = built.bbox;
    for (const [x, z] of [[0, b.min.z], [0, b.max.z], ...built.solids.flatMap((r) => [[r.x - r.hx, r.z - r.hz], [r.x + r.hx, r.z + r.hz]])]) {
      const [wx, wz] = world(x, z);
      lo = [Math.min(lo[0], wx), Math.min(lo[1], wz)];
      hi = [Math.max(hi[0], wx), Math.max(hi[1], wz)];
    }
    assert.ok(lo[0] >= px0 - 1e-6 && hi[0] <= px1 + 1e-6 && lo[1] >= pz0 - 1e-6 && hi[1] <= pz1 + 1e-6,
      `rot ${rot}: bow to stern ${lo.map((v) => v.toFixed(2))}..${hi.map((v) => v.toFixed(2))} in a plot ${px0}..${px1} x ${pz0}..${pz1}`);
    const along = rot % 2 ? hi[0] - lo[0] : hi[1] - lo[1];
    assert.ok(along > 14.5, `rot ${rot}: ${along.toFixed(2)} of her along the plot's sixteen`);
    // The middle of all of her on the middle of the plot.
    const [mx, mz] = world((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    assert.ok(Math.abs(mx - (px0 + px1) / 2) < 1e-6 && Math.abs(mz - (pz0 + pz1) / 2) < 1e-6, `rot ${rot} centred`);
  }
});

test('civic:ship, :2 and :3 are one hull in three colourings', () => {
  assert.equal(shipLivery('civic:ship'), SHIP_LIVERIES[0]);
  assert.equal(shipLivery('civic:ship:2'), SHIP_LIVERIES[1]);
  assert.equal(shipLivery('civic:ship:3'), SHIP_LIVERIES[2]);
  const [a, b, c] = ['civic:ship', 'civic:ship:2', 'civic:ship:3'].map((id) => buildBuilding(spec(id)));
  assert.equal(a.geometry.attributes.position.count, b.geometry.attributes.position.count);
  assert.deepEqual([...a.geometry.attributes.position.array], [...c.geometry.attributes.position.array], 'the same hull');
  const colours = (g) => g.geometry.attributes.color.array;
  const differ = (x, y) => colours(x).some((v, i) => Math.abs(v - colours(y)[i]) > 1e-3);
  assert.ok(differ(a, b) && differ(b, c) && differ(a, c), 'three colourings');
  // One material still: the livery is vertex colour, nothing else.
  assert.equal(a.geometry.groups.length, b.geometry.groups.length);
  // The ensign is the Prinsenvlag on all three; the main flag is the livery's.
  const fa = buildFlags('civic:ship'), fb = buildFlags('civic:ship:2');
  assert.equal(fa.geometry.attributes.color.count, fb.geometry.attributes.color.count);
  assert.ok(fa.geometry.attributes.color.array.some((v, i) => Math.abs(v - fb.geometry.attributes.color.array[i]) > 1e-3));
});

// Her hull where the plot puts her, at rot 1 (bow to +x), as main.js's blockersOf hands it to
// walk mode.
function hullsAt(rot = 1) {
  const plot = { gx: 40, gz: 50, w: rot % 2 ? 16 : 4, d: rot % 2 ? 4 : 16, rot };
  const built = buildBuilding(spec('civic:ship', plot));
  const pose = floatingPose(plot, 64, built.bbox);
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  return built.solids.map((r) => ({
    x: pose.x + r.x * c + r.z * s, z: pose.z - r.x * s + r.z * c,
    hx: Math.abs(r.hx * c) + Math.abs(r.hz * s), hz: Math.abs(r.hx * s) + Math.abs(r.hz * c), hull: r.hull,
  }));
}
const insideAny = (hulls, x, z) => hulls.some((b) => Math.abs(x - b.x) < b.hx && Math.abs(z - b.z) < b.hz);

test('her side is a wall to a swimmer and a bank to a boat', () => {
  const solids = shipSolids();
  // The skin, slab by slab, and nothing of the float or the ladder beside her.
  const beam = Math.max(...solids.map((r) => r.hx));
  assert.ok(beam > 1.35 && beam < 1.45, `her side is ${beam.toFixed(2)} out`);
  assert.ok(solids.every((r) => r.hull > BOAT_SCRAPE), 'what a boat meets is above the scrape');
  assert.ok(Math.abs(solids[0].hull - 1.1) < 0.05, 'her main deck over the water');
  const [z0, z1] = [Math.min(...solids.map((r) => r.z - r.hz)), Math.max(...solids.map((r) => r.z + r.hz))];
  assert.ok(z1 - z0 > 12 && z1 - z0 < 13, `${(z1 - z0).toFixed(2)} of hull to swim round`);
  const hulls = hullsAt(1);
  assert.equal(hullOver(hulls, hulls[5].x, hulls[5].z, -2.5), solids[0].hull, 'inside her side, a boat reads her deck');
  assert.equal(hullOver(hulls, hulls[5].x, hulls[5].z + 3, -2.5), -2.5, 'beside her, the sea');

  // A Benchy under full throttle straight at her side, amidships: it stops with its bow at her
  // side and never inside it. The sea bed is open water (the archipelago's OPEN_SEA).
  const mid = hulls[Math.floor(hulls.length / 2)];
  const sea = (x, z) => hullOver(hulls, x, z, -2.5);
  const benchy = { x: mid.x, z: mid.z + mid.hz + 6, yaw: Math.PI, v: 0 };   // yaw PI heads -z
  for (let i = 0; i < 400; i++) {
    stepBoat(benchy, { throttle: 1 }, 1 / 30, sea);
    assert.ok(!insideAny(hulls, benchy.x + Math.sin(benchy.yaw) * BOW, benchy.z + Math.cos(benchy.yaw) * BOW), 'the bow stays out of her');
  }
  assert.equal(benchy.aground, true, 'and she stopped it');
  assert.ok(benchy.z - (mid.z + mid.hz) < BOW + 0.4, 'against her side, not short of it');

  // The galleon, at her bow: its probes find her before its middle is anywhere near.
  const bowOf = hulls.reduce((a, b) => (b.x > a.x ? b : a));
  const galleon = { x: bowOf.x + bowOf.hx + 9, z: bowOf.z, yaw: -Math.PI / 2, v: 0, craft: { spec: CRAFTS.galleon } };
  for (let i = 0; i < 600; i++) stepBoat(galleon, { throttle: 1 }, 1 / 30, sea);
  assert.equal(galleon.aground, true);
  assert.ok(galleon.x - (bowOf.x + bowOf.hx) > 5, `the galleon's middle stops ${(galleon.x - bowOf.x - bowOf.hx).toFixed(2)} off her bow`);

  // And walk.js hands every one of its hulls - at the helm, walking a deck, climbing her ladder
  // and running her out after you have jumped - this ground, not the bare terrain: a source
  // check, since walk.js cannot load under Node.
  assert.equal((WALK_SOURCE.match(/stepBoat\([^;]*boatGround\)/g) || []).length, 4);
  assert.match(WALK_SOURCE, /hullOver\(hulls, x, z, groundAt\(x, z, Infinity\)\)/);
});
