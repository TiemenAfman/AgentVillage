// The timber wagon and the yard's crew (Plans/DONE/houtkar.md): the sawmill's horse takes timber to
// the shipyard on the sea's clock, and three hands work the yard.
//
// Held here, each for the way it would fail without anybody noticing:
//
//   the loop       one closed way round, out on one side of the road and back on the other,
//                  so the horse's place is one number and never jumps;
//   the timetable  a function of the sea's clock alone - the same moment is the same place on
//                  every screen - and a horse that always walks, a long road getting a longer
//                  period rather than a bolting horse;
//   the crew       nobody jumps from one place to the next, not even the carrier stepping out
//                  of his round to unload the wagon and back into it;
//   the island     a real layout with a sawmill and a yard: a road between them, the whole trip
//                  driven without a NaN, and nothing at all when there is no yard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { emptyLayout, placeAll, plotDoor } from '../lib/layout.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const T = await import('../web/js/timberrun.js');
delete globalThis.document;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- the loop ---------------------------------------------------------------------------------

// An L of road: east ten cells, then north six.
const ROUTE = [];
for (let x = 0; x <= 10; x++) ROUTE.push([x, 0]);
for (let z = 1; z <= 6; z++) ROUTE.push([10, z]);

test('the trip is one closed loop, out on one side of the road and back on the other', () => {
  const loop = T.tripLoop(ROUTE);
  assert.ok(loop.total > 2 * 16 * 0.9, `a loop of ${loop.total} for a road of 16`);
  assert.ok(loop.atYard > 0 && loop.atYard < loop.total);
  // No step of the loop is longer than a corner's curve would make it: nothing jumps.
  for (let i = 1; i <= loop.pts.length; i++) {
    const d = dist(loop.pts[i - 1], loop.pts[i % loop.pts.length]);
    assert.ok(d <= 1.01, `a jump of ${d.toFixed(2)} at ${i}`);
  }
  // Outward the wagon keeps right of the road's middle. A figure facing +z has its right hand at
  // -x (classic-avatar.js); turned to face east (+x) that hand is at +z, so it drives at z > 0.
  const out = T.pointAt(loop, 3);
  assert.ok(out.dir[0] > 0.99, 'heading east on the way out');
  assert.ok(out.p[1] > 0.1 && out.p[1] < 0.3, `on the right of the road: ${out.p[1]}`);
  // And coming back west on the same stretch it is on the other side.
  const back = T.pointAt(loop, loop.total - 3);
  assert.ok(back.dir[0] < -0.99, 'heading west on the way back');
  assert.ok(back.p[1] < -0.1 && back.p[1] > -0.3, `on its own right coming back: ${back.p[1]}`);
  // Arc length wraps.
  assert.deepEqual(T.pointAt(loop, loop.total + 1).p, T.pointAt(loop, 1).p);
  assert.equal(T.tripLoop([[0, 0]]), null);
});

// ---- the timetable ----------------------------------------------------------------------------

test('the timetable is the sea clock\'s alone, and the horse always walks', () => {
  const plan = T.tripPlan(T.tripLoop(ROUTE));
  assert.equal(plan.speed, T.HORSE_SPEED);
  assert.equal(plan.period, T.TIMBER_EVERY, 'a short road leaves every TIMBER_EVERY');
  const phase = 123;
  const dep = (5000 * plan.period + phase) * 1000;
  const at = (s) => T.tripAt(plan, dep + s * 1000, phase);
  assert.equal(at(1).stage, 'load');
  assert.equal(at(T.LOAD_S + 1).stage, 'out');
  assert.equal(at(T.LOAD_S + plan.out + 1).stage, 'unload');
  assert.equal(at(T.LOAD_S + plan.out + T.UNLOAD_S + 1).stage, 'back');
  assert.equal(at(plan.length + 1).stage, 'parked');
  // The same moment is the same place, whichever trip it is in.
  assert.deepEqual({ ...at(40), trip: 0, start: 0 }, { ...T.tripAt(plan, dep + (plan.period + 40) * 1000, phase), trip: 0, start: 0 });
  // The horse moves continuously through the stops: out ends where the unload stands.
  const a = at(T.LOAD_S + plan.out - 0.01).s, b = at(T.LOAD_S + plan.out + 0.01).s;
  assert.ok(Math.abs(a - b) < 0.02);

  // A long road gets a longer period, never a quicker horse.
  const long = [];
  for (let x = 0; x <= 300; x++) long.push([x, 0]);
  const far = T.tripPlan(T.tripLoop(long));
  assert.equal(far.speed, T.HORSE_SPEED);
  assert.ok(far.period > T.TIMBER_EVERY && far.period >= far.length + 30, `period ${far.period} for a trip of ${far.length}`);
  assert.equal(T.tripAt(null, 0).stage, 'parked', 'no plan is a wagon standing still');
});

// ---- the island -------------------------------------------------------------------------------

const t0 = Date.UTC(2026, 0, 1);
function model(settlers) {
  const buildings = [];
  for (let i = 0; i < settlers; i++) {
    buildings.push({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: `p:${i % 6}`, harbour: false, tier: 'hut', startedAt: t0 + i * 1000 });
  }
  const districts = [];
  for (let d = 0; d < 6; d++) districts.push({ id: `p:${d}`, kind: 'project', name: `P${d}`, population: buildings.filter((b) => b.district === `p:${d}`).length, firstSeenAt: t0 + d });
  return {
    districts, buildings,
    milestones: MILESTONES.map((m) => {
      const unlocked = m.at <= settlers;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers },
  };
}
// A layout grown to a yard, and the records main.js would hand the run: each building's group on
// the middle of its plot, and its spec with the door scan.mjs gives it.
function island(settlers) {
  const seed = 2024;
  const layout = emptyLayout(seed, 128);
  placeAll(layout, model(settlers), { seed, size: 128 });
  placeAll(layout, model(settlers), { seed, size: 128 });
  const terrain = makeTerrain(seed, { size: layout.size, polders: layout.polders || [], fairway: layout.fairway || null, works: layout.works || null, grow: layout.grow || null });
  const rec = (id) => {
    const plot = layout.plots[id];
    if (!plot) return null;
    const group = new THREE.Group();
    const [x, z] = terrain.cellWorld(plot.gx + (plot.w >> 1), plot.gz + (plot.d >> 1));
    group.position.set(x, terrain.worldHeight(x, z), z);
    // Turned as makeRecord turns a building (web/js/shipyard.js turnLocal says the same).
    group.rotation.y = Math.PI - (plot.rot || 0) * Math.PI / 2;
    return { id, spec: { id, kind: 'civic', plot, door: plotDoor(id, plot).door, stage: 3 }, group };
  };
  const village = { paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] };
  return { layout, terrain, village, sawmill: rec('civic:sawmill'), yard: rec('civic:shipyard') };
}
function runOn(sites) {
  const scene = new THREE.Scene();
  const run = T.createTimberRun({ scene, material: new THREE.MeshBasicMaterial(), groundAt: (x, z) => sites.terrain.worldHeight(x, z) });
  run.setSites(sites);
  return { run, scene };
}

const BIG = island(110);

test('with a sawmill and a yard the wagon has a road between them, and drives all of it', (t) => {
  if (!BIG.yard || !BIG.sawmill) { t.skip('this seed grew no yard at 110'); return; }
  const { run } = runOn(BIG);
  const w = run.where(0);
  assert.ok(w, 'no trip between the sawmill and the yard');
  const dep = (1000 * w.period + w.phase) * 1000;
  const seen = new Set();
  let prev = null;
  for (let s = 0; s < w.period; s += 0.5) {
    const now = dep + s * 1000;
    run.update(0.05, now);
    const at = run.where(now);
    seen.add(at.stage);
    assert.ok(at.horse.every(Number.isFinite), `the horse is nowhere at ${s} s`);
    if (prev) assert.ok(dist(prev, at.horse) <= T.HORSE_SPEED * 0.5 + 1e-6, `the horse jumped at ${s} s`);
    prev = at.horse;
  }
  for (const stage of ['load', 'out', 'unload', 'back', 'parked']) assert.ok(seen.has(stage), `never ${stage}`);
  run.dispose();
});

test('the crew never jump, not even the carrier going out to meet the wagon', (t) => {
  if (!BIG.yard || !BIG.sawmill) { t.skip('this seed grew no yard at 110'); return; }
  const { run } = runOn(BIG);
  const w = run.where(0);
  const dep = (1000 * w.period + w.phase) * 1000;
  const hands = BIG.yard.group.children.filter((c) => c.isGroup);
  assert.equal(hands.length, 3, 'three hands at the yard');
  const last = new Map();
  // Through the whole trip, at a frame rate, from a standing start.
  for (let s = 0; s < w.period; s += 0.1) {
    run.update(0.1, dep + s * 1000);
    for (const g of hands) {
      if (!g.visible) continue;
      const p = [g.position.x, g.position.z];
      const q = last.get(g);
      // A walk of 0.5 a second, and no leg of the unload quicker than a brisk one (1 a second).
      if (q) assert.ok(dist(p, q) <= 0.1 + 1e-6, `a hand jumped ${dist(p, q).toFixed(2)} at ${s.toFixed(1)} s (${run.where(dep + s * 1000).stage})`);
      last.set(g, p);
      assert.ok(Number.isFinite(g.position.y));
    }
  }
  // And at the wagon while it unloads: the carrier (the one with a plank to carry) stands at
  // its tail, within a wagon's length of the horse, four and a half seconds after it came in.
  let arrive = null;
  for (let s = 0; s < w.period && arrive == null; s += 0.5) if (run.where(dep + s * 1000).stage === 'unload') arrive = dep + s * 1000;
  for (let s = -30; s <= 4.5; s += 0.1) run.update(0.1, arrive + s * 1000);
  const carrier = hands.find((g) => g.children.some((c) => c.isMesh));
  const at = carrier.getWorldPosition(new THREE.Vector3());
  const horse = run.where(arrive + 4500).horse;
  assert.ok(Math.hypot(at.x - horse[0], at.z - horse[1]) < 1.3, `the carrier is ${Math.hypot(at.x - horse[0], at.z - horse[1]).toFixed(2)} from the wagon while it unloads`);
  run.dispose();
  assert.equal(BIG.yard.group.children.filter((c) => c.isGroup).length, 0, 'disposing leaves hands behind');
});

test('the crew\'s round is continuous and comes back to where it started', () => {
  const round = { legs: [], length: 0 };
  // Built the way timberrun builds one, through crewAt only: two places four apart.
  const stops = [[[0, 0], [0, 1], 3], [[4, 0], [4, 1], 2]];
  let t = 0;
  for (let i = 0; i < stops.length; i++) {
    const [at, face, work] = stops[i], next = stops[(i + 1) % stops.length][0];
    round.legs.push({ at, face, from: t, work, walk: dist(at, next) / 0.5, next });
    t += work + dist(at, next) / 0.5;
  }
  round.length = t;
  let prev = T.crewAt(round, 0).pos;
  for (let s = 0.1; s <= round.length * 2; s += 0.1) {
    const p = T.crewAt(round, s).pos;
    assert.ok(dist(p, prev) <= 0.05 + 1e-9, `a jump at ${s}`);
    prev = p;
  }
});

test('no yard, no wagon and no crew; no sawmill, a crew and no wagon', () => {
  const small = island(40);
  assert.equal(small.yard, null);
  const { run, scene } = runOn(small);
  assert.equal(run.where(0), null);
  run.update(0.05, 1e12);
  const drawn = scene.children.filter((c) => c.visible);
  assert.equal(drawn.length, 0, 'something stands about with no yard to go to');

  if (!BIG.yard) return;
  const alone = runOn({ ...BIG, sawmill: null });
  assert.equal(alone.run.where(0), null, 'a wagon with no sawmill to come from');
  alone.run.update(0.05, 1e12);
  assert.equal(BIG.yard.group.children.filter((c) => c.isGroup).length, 3);
  alone.run.dispose();
});
