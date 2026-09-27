// The marks the story animals leave (scripts/build-traces.py, web/js/traces.js,
// Plans/dierenverhalen.md, docs/animals-wire.md `traces`).
//
// The promises: every kind in TRACE_KINDS is baked, within a prop's budget and standing on its
// own middle; a list applied twice stands nothing twice, and a region's list never clears
// another's; the chronicle hides a mark until it was left; a region's origin moves its marks
// and the ground is asked where they stand in the scene; flat marks lie on the slope and
// upright ones never hover; a dozen marks on three islands are a draw call per kind shown; and
// only the bell and the glint move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader as it loads, and traces.js is built on buildings.js.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createTraces, traceAsset, MOVING, FLAT, LIFT, yawOfRot } = await import('../web/js/traces.js');
const models = await import('../web/js/models.js');
delete globalThis.document;
const { TRACES } = await import('../web/js/traces-mesh.js');
const { checkSet, budgetOf } = await import('../scripts/model-rules.mjs');
const { TRACE_KINDS } = await import('../shared/animals.mjs');

const material = () => new THREE.MeshBasicMaterial();
const flat = (y = 0) => () => y;

function boxOf(names) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const n of names) {
    const p = TRACES.parts[n];
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p.positions[i + k] + p.at[k]);
        hi[k] = Math.max(hi[k], p.positions[i + k] + p.at[k]);
      }
    }
  }
  return { lo, hi };
}
const trisOf = (names) => names.reduce((n, name) => n + TRACES.parts[name].positions.length / 9, 0);

// One of every kind, on the home island, left at a known moment each.
const AT = 1_790_000_000_000;
const ONE_OF_EACH = TRACE_KINDS.map((kind, i) => ({
  id: `trace:${kind}:t${i}`, kind, x: i * 2 - 6, z: (i % 3) - 1, rot: i % 4, name: `a ${kind}`, at: AT + i * 1000,
}));

test('every trace kind is baked, within the prop budget, standing on its own middle', () => {
  assert.deepEqual(checkSet('traces', TRACES), []);
  // One asset per kind and nothing else, so a kind added to shared/animals.mjs without a model
  // (or a model nobody draws) fails here rather than on the island.
  assert.deepEqual(Object.keys(TRACES.assets).sort(), TRACE_KINDS.map(traceAsset).sort());
  for (const kind of TRACE_KINDS) {
    const asset = traceAsset(kind);
    assert.ok(models.hasAsset(asset), `${asset} is not in the register (web/js/models.js)`);
    const names = TRACES.assets[asset].parts;
    assert.equal(budgetOf(asset), 120, `${asset} is a prop`);
    assert.ok(trisOf(names) <= 120, `${asset} is ${trisOf(names)} triangles`);
    const { lo, hi } = boxOf(names);
    assert.ok(Math.abs(lo[1]) < 1e-6, `${asset} stands ${lo[1]} off the ground`);
    for (const k of [0, 2]) assert.ok(Math.abs((lo[k] + hi[k]) / 2) < 0.06, `${asset} is off its middle on ${'xyz'[k]}`);
  }
  // The flat ones are flat: a print is pressed into the mud, not standing on it.
  assert.ok(boxOf(TRACES.assets.prop_trace_print.parts).hi[1] < 0.012);
  assert.ok(boxOf(TRACES.assets.prop_trace_nest.parts).hi[1] < 0.08);
  // And the tall one is a birdhouse on a pole, not a shed.
  const perch = boxOf(TRACES.assets.prop_trace_perch.parts);
  assert.ok(perch.hi[1] > 0.55 && perch.hi[1] < 0.7, `the perch is ${perch.hi[1]} tall`);
});

test('what moves is baked on its own pivot, the fronts face +z, and only the lamp and the glint glow', () => {
  for (const [kind, name] of Object.entries(MOVING)) {
    const parts = TRACES.assets[traceAsset(kind)].parts.filter((n) => n.startsWith(`${traceAsset(kind)} ${name}`));
    assert.ok(parts.length, `${kind} has no ${name}`);
    const at = TRACES.parts[parts[0]].at;
    for (const n of parts) assert.deepEqual(TRACES.parts[n].at, at, `${n} hangs on another pivot`);
    assert.ok(at[1] > 0.03, `the ${name} pivots at ${at[1]}, on the ground`);
  }
  // The bell hangs off the eave, beside the tray rather than in it.
  const bell = TRACES.parts[TRACES.assets.prop_trace_feeder.parts.find((n) => n.includes(' bell'))].at;
  assert.ok(bell[1] > 0.5 && bell[0] > 0.1, `the bell hangs at ${bell}`);

  const glow = Object.entries(TRACES.parts).filter(([, p]) => p.emissive === 1).map(([n]) => n.split(':')[0]).sort();
  assert.deepEqual([...new Set(glow)], ['prop_trace_cache lamp', 'prop_trace_find glint']);

  // The birdhouse's door and the chest's lock plate are parts of their own colour, and each lies
  // wholly in front: modelled on -z, a birdhouse would turn its back on the garden it is in.
  for (const [asset, front] of [['prop_trace_perch', 0.04], ['prop_trace_cache', 0.06]]) {
    const ahead = TRACES.assets[asset].parts.filter((n) => {
      const p = TRACES.parts[n];
      for (let i = 2; i < p.positions.length; i += 3) if (p.positions[i] + p.at[2] < front) return false;
      return true;
    });
    assert.ok(ahead.length >= 1, `${asset} has nothing wholly on its +z face`);
  }
});

test('apply() stands each trace once, and is idempotent by id', () => {
  const scene = new THREE.Scene();
  const traces = createTraces(scene, material());
  const list = ONE_OF_EACH.slice(0, 3);
  assert.deepEqual(traces.apply(list, { groundAt: flat(0.5) }), { added: 3, moved: 0, removed: 0, kept: 0 });
  const placed = traces.stats().placed;
  const where = list.map((t) => traces.positionOf(t.id));
  const nests = scene.getObjectByName('trace:nest');
  assert.equal(nests.count, 1);

  // The same list again, as new objects - which is how every herd message arrives.
  assert.deepEqual(traces.apply(list.map((t) => ({ ...t })), { groundAt: flat(0.5) }), { added: 0, moved: 0, removed: 0, kept: 3 });
  assert.equal(traces.stats().placed, placed, 'a trace that did not change was stood again');
  assert.deepEqual(list.map((t) => traces.positionOf(t.id)), where);
  assert.equal(scene.getObjectByName('trace:nest'), nests, 'the nest batch was rebuilt');

  // A rename is kept in place; a move stands that one again and nothing else; a gone one goes.
  const renamed = { ...list[1], name: 'Bram\'s lookout over the bay' };
  const moved = { ...list[0], x: list[0].x + 0.5 };
  assert.deepEqual(traces.apply([moved, renamed], { groundAt: flat(0.5) }), { added: 0, moved: 1, removed: 1, kept: 1 });
  assert.equal(traces.stats().placed, placed + 1);
  assert.equal(traces.positionOf(list[2].id), null);
  assert.equal(traces.positionOf(moved.id)[0], moved.x);
  assert.equal(traces.stats().traces, 2);

  // What the wire should never carry is skipped rather than drawn at the origin, and the
  // first of two with one id stands.
  const junk = [{ id: 'trace:x', kind: 'volcano', x: 0, z: 0 }, { id: 'trace:y', kind: 'nest', x: NaN, z: 0 }, { kind: 'nest', x: 0, z: 0 },
    { ...moved, x: 99 }];
  assert.deepEqual(traces.apply([moved, renamed, ...junk], { groundAt: flat(0.5) }), { added: 0, moved: 0, removed: 0, kept: 2 });
  traces.dispose();
  assert.equal(scene.getObjectByName('traces'), undefined);
});

test('the chronicle hides a trace until the moment it was left', () => {
  const traces = createTraces(new THREE.Scene(), material());
  const [nest, lookout] = ONE_OF_EACH;
  traces.apply([nest, lookout], { groundAt: flat() });
  assert.ok(traces.shownAt(nest.id) && traces.shownAt(lookout.id));
  traces.setTime(nest.at - 1);
  assert.ok(!traces.shownAt(nest.id) && !traces.shownAt(lookout.id));
  assert.equal(traces.stats().drawCalls, 0, 'an island with nothing left yet draws nothing');
  traces.setTime(nest.at);
  assert.ok(traces.shownAt(nest.id) && !traces.shownAt(lookout.id), 'left at `at`, so shown from `at`');
  traces.setTime(lookout.at + 5000);
  assert.ok(traces.shownAt(lookout.id));
  traces.setTime(nest.at - 1);
  traces.setTime(null);
  assert.ok(traces.shownAt(nest.id) && traces.shownAt(lookout.id), 'null is now');
  // A region's own filter narrows it further, and refresh() asks it again.
  let hide = true;
  traces.apply([nest, lookout], { groundAt: flat(), visibleAt: (t) => !(hide && t.kind === 'nest') });
  assert.ok(!traces.shownAt(nest.id) && traces.shownAt(lookout.id));
  hide = false;
  traces.refresh();
  assert.ok(traces.shownAt(nest.id));
});

test('a region\'s origin moves its traces, the ground is asked in the scene, and regions keep to themselves', () => {
  const scene = new THREE.Scene();
  const traces = createTraces(scene, material());
  const asked = [];
  const ground = (x, z) => { asked.push([x, z]); return 2; };
  const perch = { id: 'trace:perch:animal:3', kind: 'perch', x: 3, z: -4, rot: 1, name: 'a birdhouse', at: AT };
  const find = { id: 'trace:find:mystery:0', kind: 'find', x: -1, z: 1, rot: 0, name: 'a button', at: AT };
  traces.apply([ONE_OF_EACH[0]], { groundAt: flat() });                       // home
  traces.apply([perch, find], { region: 'guest:b', origin: [100, -40], groundAt: ground });
  assert.deepEqual(traces.positionOf(perch.id, 'guest:b'), [103, 2, -44]);
  const [fx, fy, fz] = traces.positionOf(find.id, 'guest:b');
  assert.deepEqual([fx, fz], [99, -39]);
  assert.ok(Math.abs(fy - (2 + LIFT)) < 1e-9, 'a flat mark rides LIFT over its ground');
  for (const [x, z] of asked) {
    assert.ok(Math.abs(x - 101) < 3 && Math.abs(z + 41.5) < 3, `the ground was asked at ${x}, ${z}, which is not in the scene frame`);
  }
  assert.equal(traces.positionOf(perch.id), null, 'the id is the guest\'s, not ours');
  assert.ok(traces.positionOf(ONE_OF_EACH[0].id), 'a guest\'s list cleared the home island');

  // A new berth stands the region's marks again where it now is.
  traces.apply([perch, find], { region: 'guest:b', origin: [200, 0], groundAt: ground });
  assert.deepEqual(traces.positionOf(perch.id, 'guest:b'), [203, 2, -4]);
  // And a guest taken down takes only its own.
  assert.equal(traces.drop('guest:b'), 2);
  assert.equal(traces.stats().traces, 1);
  assert.ok(traces.positionOf(ONE_OF_EACH[0].id));
  // reground() stands them again on new ground.
  let h = 0;
  traces.apply([ONE_OF_EACH[1]], { region: 'guest:c', origin: [0, 60], groundAt: () => h });
  h = 1.5;
  traces.reground('guest:c');
  assert.equal(traces.positionOf(ONE_OF_EACH[1].id, 'guest:c')[1], 1.5);
});

test('a trace faces the way a plot does, flat ones lie on the slope and upright ones never hover', () => {
  const scene = new THREE.Scene();
  const traces = createTraces(scene, material());
  const slope = (x) => 0.3 * x;
  traces.apply([
    { id: 'trace:nest:a', kind: 'nest', x: 0, z: 0, rot: 2, at: AT },
    { id: 'trace:lookout:a', kind: 'lookout', x: 0, z: 0, rot: 0, at: AT },
  ], { groundAt: slope });
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3();

  scene.getObjectByName('trace:nest').getMatrixAt(0, m);
  m.extractBasis(side, up, fwd);
  const want = new THREE.Vector3(-0.3, 1, 0).normalize();
  assert.ok(up.distanceTo(want) < 1e-6, `the nest's up is ${up.toArray()}, not the slope's normal`);
  assert.ok(FLAT.has('nest') && !FLAT.has('lookout'));

  scene.getObjectByName('trace:lookout').getMatrixAt(0, m);
  m.extractBasis(side, up, fwd);
  assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9, 'a cairn is stood level');
  // rot 0 is a plot's rot 0: its front (+z in the bake) out towards DOOR_DIR[0], which is -z.
  assert.ok(fwd.distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-9, `rot 0 faces ${fwd.toArray()}`);
  assert.equal(yawOfRot(1), Math.PI / 2);
  // Stood at the lowest ground under it, so its downhill edge touches and nothing hovers.
  const y = traces.positionOf('trace:lookout:a')[1];
  assert.ok(y < 0 && y > -0.1, `the cairn stands at ${y} on ground that is 0 under its middle`);
});

test('a dozen traces on three islands are a draw call per kind shown, plus one per moving part', () => {
  const scene = new THREE.Scene();
  const traces = createTraces(scene, material());
  traces.apply(ONE_OF_EACH.slice(0, 1), { groundAt: flat() });
  assert.equal(traces.stats().drawCalls, 1, 'one nest, one call');
  const regions = [['home', [0, 0]], ['guest:a', [180, 0]], ['guest:b', [0, -180]]];
  for (const [region, origin] of regions) {
    traces.apply(ONE_OF_EACH.map((t, i) => ({ ...t, id: `${t.id}:${region}`, x: t.x + i * 0.1 })), { region, origin, groundAt: flat() });
  }
  const s = traces.stats();
  assert.equal(s.traces, 3 * TRACE_KINDS.length);
  assert.equal(s.drawCalls, TRACE_KINDS.length + Object.keys(MOVING).length, 'traces are batched by kind, not by island');
  for (const kind of TRACE_KINDS) assert.equal(scene.getObjectByName(`trace:${kind}`).count, 3, kind);
  // Past the first capacity a batch grows rather than dropping anybody.
  traces.apply(Array.from({ length: 20 }, (_, i) => ({ id: `trace:nest:n${i}`, kind: 'nest', x: i, z: 3, rot: 0, at: AT })), { region: 'guest:c', origin: [0, 300], groundAt: flat() });
  assert.equal(scene.getObjectByName('trace:nest').count, 23);
  assert.equal(traces.stats().drawCalls, TRACE_KINDS.length + Object.keys(MOVING).length);
});

test('only the bell and the glint move, the same way on every page, and a ray names what it hit', () => {
  const run = () => {
    const scene = new THREE.Scene();
    const traces = createTraces(scene, material());
    traces.apply(ONE_OF_EACH, { groundAt: flat(1) });
    const read = (name) => { const m = new THREE.Matrix4(); scene.getObjectByName(name).getMatrixAt(0, m); return m.elements.slice(); };
    const still = TRACE_KINDS.map((k) => read(`trace:${k}`));
    const bell0 = read('trace:feeder:bell'), glint0 = read('trace:find:glint');
    const scales = [];
    for (let i = 0; i < 400; i++) {
      traces.update(1 / 60);
      const m = new THREE.Matrix4();
      scene.getObjectByName('trace:find:glint').getMatrixAt(0, m);
      scales.push(new THREE.Vector3().setFromMatrixScale(m).x);
    }
    return { traces, scene, still, stillAfter: TRACE_KINDS.map((k) => read(`trace:${k}`)), bell0, bell1: read('trace:feeder:bell'), glint0, glint1: read('trace:find:glint'), scales };
  };
  const a = run(), b = run();
  assert.deepEqual(a.stillAfter, a.still, 'a mark that stands moved');
  assert.notDeepEqual(a.bell1, a.bell0, 'the bell did not swing');
  assert.notDeepEqual(a.glint1, a.glint0, 'the glint did not turn');
  assert.ok(Math.min(...a.scales) < 0.4 && Math.max(...a.scales) > 1, `the glint never flashed: ${Math.min(...a.scales)}..${Math.max(...a.scales)}`);
  assert.deepEqual([a.bell1, a.glint1], [b.bell1, b.glint1], 'two pages disagree about the same bell');

  // A ray straight down onto the cache names the cache.
  const cache = ONE_OF_EACH.find((t) => t.kind === 'cache');
  const [x, , z] = a.traces.positionOf(cache.id);
  a.scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(new THREE.Vector3(x - 0.05, 5, z), new THREE.Vector3(0, -1, 0));
  const hit = ray.intersectObjects(a.traces.objects(), false)[0];
  assert.ok(hit, 'the ray went through the cache');
  assert.equal(a.traces.traceOf(hit).id, cache.id);
  assert.equal(a.traces.traceOf({ object: new THREE.Mesh(), instanceId: 0 }), null);
});
