// The marks the story animals leave on an island for good (Plans/dierenverhalen.md,
// docs/animals-wire.md `traces`): a hen's nest by a door, a goat's cairn, a sparrow's
// birdhouse, the Feathered Corner's feeder, and the mystery's print, find and cache.
//
// The shapes are baked (scripts/build-traces.py, `prop_trace_<kind>`); this only stands them
// where the islander put them. What it keeps in mind, in the order it bit:
//
// * One batch for every island, the way web/js/animal-view.js draws every island's animals:
//   one InstancedMesh per kind, plus one per moving part, on the buildings' own material. A
//   dozen marks on three islands are nine draw calls at most, and an island with none costs
//   nothing (a kind with no mark shown is not drawn at all). `stats().drawCalls` is the number.
// * Keyed by region and id. apply() is handed a region's whole list every time the herd is news
//   and does the difference: a mark it already stands where it stood is left exactly as it is,
//   a new one is placed once, a gone one is dropped, and another region's marks are never
//   touched - so the home island and a guest can share the batch without clearing each other.
// * Traces are island-local on the wire, like the animals' rows; the region's origin is added
//   here, once, and `groundAt(x, z)` is then asked at the *scene* position - the same
//   `groundAt` main.js hands animal-view, so one function serves every region.
// * A mark faces the way a plot does: `rot` quarter turns, yaw = PI - rot * PI/2
//   (web/js/house-placement.js), so a trace with a house's rot has its front (+z in the bake)
//   out of that house's door (DOOR_DIR[rot] in shared/settlerwalk.mjs).
// * Flat ones (the nest, the print, the find) are tilted to the slope and lifted by LIFT: a
//   6 mm slab of mud laid level on a hillside is half under it. Upright ones stand level at the
//   lowest ground under their footprint, so none of them hovers on a slope.
// * The chronicle: setTime(t) shows only what had been left by `t` (a trace's `at`, ms), and
//   null is now. `visibleAt(trace)` narrows it further per region - a filter, or false for an
//   island not drawn in detail.
//
// Two parts move, and each is baked apart on its own pivot (the sawmill's pattern): the
// feeder's seed bell swings from its eave, the find's glint flashes over the button every few
// seconds. update(dt) touches only those instances, and nothing at all when none is shown.
import * as THREE from 'three';
import { TRACE_KINDS } from 'shared/animals.mjs';
import { hash32 } from 'shared/rng.mjs';
import { mesh, meshAsset, mergeParts } from './buildings.js';
import * as models from './models.js';

export const traceAsset = (kind) => `prop_trace_${kind}`;

// The parts that move, by kind: the name after the asset's, as scripts/build-traces.py bakes
// it. A part with several colours bakes as `name:0`, `name:1`, which the tail allows.
export const MOVING = { feeder: 'bell', find: 'glint' };
export function isTraceMoving(kind) {
  const m = MOVING[kind];
  if (!m) return () => false;
  const base = `${traceAsset(kind)} ${m}`;
  return (n) => n === base || n.startsWith(`${base}:`);
}

// Laid on the slope rather than stood level on it.
export const FLAT = new Set(['nest', 'print', 'find']);
// How far a flat mark rides over the ground it is tilted to. A plane through four samples is
// not the terrain's own triangles, and on a gentle slope the two part by a few millimetres
// across a nest; this is more than that and less than the slab is thick, so the patch's own
// edge hides the gap.
export const LIFT = 0.004;
export const yawOfRot = (rot) => Math.PI - (rot | 0) * Math.PI / 2;

// The glint between flashes, as a fraction of its baked size, and at its brightest.
const GLINT_REST = 0.34;
const GLINT_FLASH = 1.2;
const FLASH_S = 0.4;
const CAPACITY = 8;

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _s = new THREE.Vector3();

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// `scene` is where the batch hangs (a THREE.Scene or any Object3D); `material` is the one the
// buildings are drawn with - a trace's colours, sheets and night glow are on its vertices.
export function createTraces(scene, material) {
  const group = new THREE.Group();
  group.name = 'traces';
  scene.add(group);

  const batches = new Map();       // kind -> { mesh, part, reach, slots }
  const records = new Map();       // `${region}\n${id}` -> the record drawn for it
  const regions = new Map();       // region id -> { origin, groundAt, visibleAt }
  let time = null;                 // the chronicle's moment, null for now
  let clock = 0;
  let placed = 0;                  // how many times a record was stood somewhere, for tests

  function instanced(geometry, capacity, name, cast) {
    const im = new THREE.InstancedMesh(geometry, material, capacity);
    im.name = name;
    im.count = 0;
    im.visible = false;
    im.castShadow = cast;
    im.receiveShadow = true;
    group.add(im);
    return im;
  }

  function batchOf(kind) {
    if (batches.has(kind)) return batches.get(kind);
    const asset = traceAsset(kind);
    let b = null;
    // A kind the bake does not have yet draws nothing rather than breaking the page.
    if (models.hasAsset(asset)) {
      const moving = isTraceMoving(kind);
      const still = mergeParts(meshAsset(asset, 0xffffff, { skip: moving }));
      const box = still.boundingBox;
      const reach = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
      // A 6 mm slab's shadow is nothing on the ground and a whole pass in the shadow map.
      const cast = !FLAT.has(kind) || kind === 'nest';
      b = { kind, geometry: still, mesh: instanced(still, CAPACITY, `trace:${kind}`, cast), reach, cast, slots: [], part: null };
      b.mesh.userData.traceKind = kind;
      const names = models.assetParts(asset).filter(moving);
      if (names.length) {
        // Built round the part's own origin - mesh() leaves a baked part where Blender had its
        // vertices relative to that origin - and hung back on it through `pivot`.
        const g = mergeParts(names.map((n) => mesh(n)));
        const pm = instanced(g, CAPACITY, `trace:${kind}:${MOVING[kind]}`, cast);
        pm.userData.traceKind = kind;
        pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        b.part = { geometry: g, mesh: pm, pivot: new THREE.Vector3(...models.part(names[0]).at), name: MOVING[kind] };
      }
    }
    batches.set(kind, b);
    return b;
  }

  // Room for n instances, by doubling: a new InstancedMesh, because an instance buffer cannot
  // grow in place. Rare - eight of one kind is already four islands' worth of nests.
  function ensure(b, n) {
    const grow = (im) => {
      if (n <= im.instanceMatrix.count) return im;
      let cap = im.instanceMatrix.count;
      while (cap < n) cap *= 2;
      const next = instanced(im.geometry, cap, im.name, im.castShadow);
      next.userData.traceKind = im.userData.traceKind;
      if (im.instanceMatrix.usage === THREE.DynamicDrawUsage) next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.remove(im);
      im.dispose();
      return next;
    };
    b.mesh = grow(b.mesh);
    if (b.part) b.part.mesh = grow(b.part.mesh);
  }

  function ground(reg, x, z) {
    const v = reg.groundAt ? reg.groundAt(x, z) : 0;
    return finite(v) ? v : 0;
  }

  // Where a record stands, worked out once: into rec.matrix, in the scene's frame.
  function place(rec, reg) {
    const b = batchOf(rec.kind);
    const sx = rec.x + reg.origin[0], sz = rec.z + reg.origin[1];
    const reach = b ? b.reach : 0.1;
    _q.setFromAxisAngle(UP, yawOfRot(rec.rot));
    let y;
    if (FLAT.has(rec.kind)) {
      const r = Math.max(0.05, reach * 0.8);
      const dx = (ground(reg, sx + r, sz) - ground(reg, sx - r, sz)) / (2 * r);
      const dz = (ground(reg, sx, sz + r) - ground(reg, sx, sz - r)) / (2 * r);
      _n.set(-dx, 1, -dz).normalize();
      _tilt.setFromUnitVectors(UP, _n);
      _q.premultiply(_tilt);
      y = ground(reg, sx, sz) + LIFT;
    } else {
      const r = reach * 0.7;
      y = Math.min(ground(reg, sx, sz), ground(reg, sx + r, sz), ground(reg, sx - r, sz),
        ground(reg, sx, sz + r), ground(reg, sx, sz - r));
    }
    rec.matrix.compose(_p.set(sx, y, sz), _q, ONE);
    placed++;
  }

  function shows(rec) {
    if (time != null && finite(rec.at) && rec.at > time) return false;
    const reg = regions.get(rec.region);
    return !(reg && reg.visibleAt && reg.visibleAt(rec.trace) === false);
  }

  // The moving part of one instance, at the clock's moment.
  function partMatrix(b, rec, out) {
    const t = clock + rec.phase;
    if (b.kind === 'feeder') {
      // Two sines at unrelated rates, so a bell never settles into a metronome; about x and z
      // both, because nothing holds a bell on a string to one plane.
      _e.set(0.11 * Math.sin(t * 1.9) + 0.04 * Math.sin(t * 4.3 + 1.1), 0, 0.08 * Math.sin(t * 1.37 + 0.6));
      _q.setFromEuler(_e);
      _s.copy(ONE);
    } else {
      // A flash every few seconds, each find on its own period, turning slowly between.
      const period = 3.4 + (rec.seed % 1000) / 1000 * 2.2;
      const into = ((t % period) + period) % period;
      const bump = into < FLASH_S ? Math.sin(Math.PI * into / FLASH_S) : 0;
      _q.setFromAxisAngle(UP, t * 0.9);
      _s.setScalar(GLINT_REST + (GLINT_FLASH - GLINT_REST) * bump);
    }
    _local.compose(b.part.pivot, _q, _s);
    return out.multiplyMatrices(rec.matrix, _local);
  }

  // Every shown record into its kind's slots. Cheap - a few dozen matrices - and only run when
  // something shown changed.
  function layout() {
    for (const b of batches.values()) if (b) b.slots.length = 0;
    for (const rec of records.values()) {
      rec.shown = shows(rec);
      if (!rec.shown) continue;
      const b = batchOf(rec.kind);
      if (b) b.slots.push(rec);
    }
    for (const b of batches.values()) {
      if (!b) continue;
      const n = b.slots.length;
      ensure(b, n);
      b.slots.forEach((rec, i) => b.mesh.setMatrixAt(i, rec.matrix));
      commit(b.mesh, n);
      if (b.part) {
        b.slots.forEach((rec, i) => b.part.mesh.setMatrixAt(i, partMatrix(b, rec, _m)));
        commit(b.part.mesh, n);
        // A bell swings and a glint grows past where its sphere was measured, by a hair.
        if (n) b.part.mesh.boundingSphere.radius += 0.05;
      }
    }
  }

  function commit(im, n) {
    im.count = n;
    im.visible = n > 0;
    im.instanceMatrix.needsUpdate = true;
    if (n) im.computeBoundingSphere();
  }

  // A region's whole list of marks, as the herd carries them: `{ id, kind, x, z, rot, name,
  // at }`, island-local. Options: `region` (an id, default 'home'), `origin` ([ox, oz] of that
  // region in the scene, [0, 0] for home), `groundAt(x, z)` (height at a scene position),
  // `visibleAt(trace)` (false hides one), `reground` (stand every one of them again, after the
  // ground under the region was rebuilt). Answers what it did, for anybody who cares.
  function apply(list, { region = 'home', origin = [0, 0], groundAt = null, visibleAt = null, reground = false } = {}) {
    const o = [finite(origin?.[0]) ? origin[0] : 0, finite(origin?.[1]) ? origin[1] : 0];
    const reg = { origin: o, groundAt, visibleAt };
    regions.set(region, reg);
    const done = { added: 0, moved: 0, removed: 0, kept: 0 };
    const seen = new Set();
    for (const t of Array.isArray(list) ? list : []) {
      if (!t || typeof t.id !== 'string' || !TRACE_KINDS.includes(t.kind) || !finite(t.x) || !finite(t.z)) continue;
      const key = `${region}\n${t.id}`;
      if (seen.has(key)) continue;           // the first of two with one id stands
      seen.add(key);
      const rot = [0, 1, 2, 3].includes(t.rot) ? t.rot : 0;
      const sig = `${t.kind}|${t.x}|${t.z}|${rot}|${o[0]}|${o[1]}`;
      const at = finite(t.at) ? t.at : null;
      const trace = { id: t.id, kind: t.kind, x: t.x, z: t.z, rot, name: typeof t.name === 'string' ? t.name : '', at, region };
      let rec = records.get(key);
      if (rec && rec.sig === sig && !reground) {
        rec.name = trace.name;
        rec.at = at;
        rec.trace = trace;
        done.kept++;
        continue;
      }
      if (rec) done.moved++;
      else {
        const seed = hash32(`trace:${t.id}`);
        rec = { key, region, id: t.id, matrix: new THREE.Matrix4(), seed, phase: (seed % 10007) / 10007 * 40, shown: false };
        records.set(key, rec);
        done.added++;
      }
      Object.assign(rec, { kind: t.kind, x: t.x, z: t.z, rot, name: trace.name, at, sig, trace });
      place(rec, reg);
    }
    for (const [key, rec] of records) {
      if (rec.region === region && !seen.has(key)) { records.delete(key); done.removed++; }
    }
    layout();
    return done;
  }

  // Everything drawn for a region goes: a guest island taken down, a herd dropped by the sweep.
  function drop(region) {
    regions.delete(region);
    let n = 0;
    for (const [key, rec] of records) if (rec.region === region) { records.delete(key); n++; }
    if (n) layout();
    return n;
  }

  // Stand a region's marks again on the ground as it is now (a grown island, a new polder).
  function reground(region) {
    const reg = regions.get(region);
    if (!reg) return 0;
    let n = 0;
    for (const rec of records.values()) if (rec.region === region) { place(rec, reg); n++; }
    if (n) layout();
    return n;
  }

  // The chronicle's moment, in the same ms as a trace's `at`; null (or undefined) is now.
  function setTime(t) {
    const next = finite(t) ? t : null;
    if (next === time) return;
    time = next;
    layout();
  }

  // Ask every region's visibleAt again: a filter changed, an island left DETAILED.
  const refresh = () => layout();

  function update(dt) {
    const step = finite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    if (!step) return;
    clock += step;
    for (const b of batches.values()) {
      if (!b || !b.part || !b.slots.length) continue;
      b.slots.forEach((rec, i) => b.part.mesh.setMatrixAt(i, partMatrix(b, rec, _m)));
      b.part.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function dispose() {
    scene.remove(group);
    for (const b of batches.values()) {
      if (!b) continue;
      b.mesh.dispose();
      b.geometry.dispose();
      if (b.part) { b.part.mesh.dispose(); b.part.geometry.dispose(); }
    }
    batches.clear();
    records.clear();
    regions.clear();
  }

  // For a raycaster: every mesh a trace is drawn in, and the trace a hit on one of them names
  // (`{ id, kind, x, z, rot, name, at, region }`, island-local as it came), or null.
  const objects = () => [...batches.values()].filter(Boolean).flatMap((b) => (b.part ? [b.mesh, b.part.mesh] : [b.mesh]));
  function traceOf(hit) {
    const kind = hit?.object?.userData?.traceKind;
    const b = kind ? batches.get(kind) : null;
    const rec = b && Number.isInteger(hit.instanceId) ? b.slots[hit.instanceId] : null;
    return rec ? rec.trace : null;
  }

  // Where one stands in the scene, [x, y, z] - for a camera sent to look at it, and for tests.
  function positionOf(id, region = 'home') {
    const rec = records.get(`${region}\n${id}`);
    if (!rec) return null;
    const e = rec.matrix.elements;
    return [e[12], e[13], e[14]];
  }
  const shownAt = (id, region = 'home') => !!records.get(`${region}\n${id}`)?.shown;

  function stats() {
    let shown = 0, drawCalls = 0;
    for (const rec of records.values()) if (rec.shown) shown++;
    for (const im of objects()) if (im.visible && im.count > 0) drawCalls++;
    return { traces: records.size, shown, placed, drawCalls };
  }

  return { group, apply, drop, reground, setTime, refresh, update, dispose, objects, traceOf, positionOf, shownAt, stats };
}
