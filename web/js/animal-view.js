// The island's story animals, drawn from what the sea says (Plans/dierenverhalen.md,
// docs/animals-wire.md).
//
// Nothing here decides where a hen goes. The sea walks every island's animals off
// shared/animalwalk.mjs and sends where they got to (`af`) and who they are (`herd`); this
// draws it, with web/js/fauna.js's joints on top. It is web/js/crowd-view.js's little sister
// and copies its rules for the same reasons, which that file's header gives at length: a
// body sets off from where it is *drawn* towards the newest word and gets there in about the
// time the next word takes to arrive; the first word about a body, and any word further than
// it could have walked (SNAP_U), is where it *is*, not where it is going; and nobody is drawn
// before the sea has said where they are.
//
// What is different is the drawing. A settler crowd is one set of instanced meshes per
// island; the animals are one set for *every* island (createAnimalBatch), because there are
// at most six of them on an island and three species, and a batch per island would be
// eighteen draw calls per neighbour for a couple of hens. So all the chickens of all the
// islands are one InstancedMesh per chicken part, all the goats one per goat part, and a view
// (one per region) only borrows slots in it. What that costs is measured, not assumed:
// `drawCalls(batch)` is the number, and tests/animal-view.test.mjs holds it to the same
// whether one hen is drawn or twelve animals on three islands.
//
// A slot is an animal's for as long as it is in the herd, and the same number in every part
// mesh of its species - the sparrow's too, across both its models - so a ray that hits a
// goat's head names the goat, and a retired animal's slot goes to the next one that arrives.
// One material for all of it, the buildings' own, and a part's baked colours on its
// vertices: CLAUDE.md's "one material, one draw call" is why there is no material per species.
import * as THREE from 'three';
import { ACTS, MOVING_ACTS, STORY_SPECIES } from 'shared/animals.mjs';
import { decodeAnimalRows } from 'shared/animalwalk.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';
import { hash32 } from 'shared/rng.mjs';
import { createPose, stepPose, jointEuler, animalParts, partGeometry, assetsOf, showsAsset } from './fauna.js';

// How many of one species the batch holds, across every island at once. Two of each species
// per island (ARRIVAL_ORDER in shared/animals.mjs) and only the islands drawn in detail, so
// 64 is room for thirty-two islands' worth before anybody goes undrawn - and a full batch
// leaves an animal in the herd, listed and pickable by name, just not drawn.
export const ANIMAL_CAPACITY = 64;
// Out of sight: the same parking spot settler-figures.js puts a hidden body in.
const HIDDEN = new THREE.Matrix4().compose(new THREE.Vector3(0, -999, 0), new THREE.Quaternion(),
  new THREE.Vector3(0.0001, 0.0001, 0.0001));

// The glide, as crowd-view.js has it and for the same reasons (see there): how long a body may
// take to reach the newest word, how far it carries on along its last direction when the next
// is late, and further than anybody walks between two words. A sparrow crossing the village
// is the fastest thing here, at MOTION.sparrow.hurry, and covers a quarter of a unit a word.
const WALK_TOOK_MS = 300;
const STAND_TOOK_MS = 600;
const MIN_TOOK_MS = 40;
const MAX_GUESS_MS = 150;
const SNAP_U = 6;
// Slower than this and a body is standing whatever word came with it. Lower than the
// settlers' 0.05: a sparrow's amble is 0.06, and a hen's 0.12 is a slow thing to begin with.
const STANDING_U_S = 0.03;
// The words that carry a body somewhere: MOVING_ACTS, plus the sparrow's amble, which is a
// string of hops (shared/animalwalk.mjs) and is extrapolated and glided like a walk.
const TRAVELS = new Set([...MOVING_ACTS, 'hop']);
// A sparrow the sea still calls flying while it has stopped going anywhere: higher than this
// it is hovering and keeps flapping, lower it has landed.
const HOVER_U = 0.02;
// How briskly an animal turns to where it is going or what it was told to face, per second.
// A bird on the wing turns faster than a goat on foot.
const TURN = 6;
const TURN_FLYING = 9;
// How quickly a sparrow settles onto a roof it has landed on (perchAt), per second. The sea
// knows nothing of roofs - a flight lands at h 0, always - so the page lifts a percher to the
// roof under it, eased so that landing does not read as a jump.
const PERCH_RATE = 6;
const PERCH_ACTS = new Set(['perch', 'chirp']);
// Moved further than this since the roof under a percher was last asked about, ask again.
const PERCH_REASK = 0.05;
const ACT_SET = new Set(ACTS);
const TAU = Math.PI * 2;

// Scratch, shared by every view: composing a part's matrix allocates nothing.
const root = new THREE.Object3D();
root.rotation.order = 'YXZ';
const euler = new THREE.Euler();
const local = new THREE.Matrix4();
const composed = new THREE.Matrix4();

// ---- the batch ------------------------------------------------------------------------------
// One InstancedMesh per (asset, part) of every story species that has a baked model, in
// `scene`, all on `material`. Built once for the page; every region's view takes slots in it.
export function createAnimalBatch(scene, material, { capacity = ANIMAL_CAPACITY, species = STORY_SPECIES } = {}) {
  const kinds = new Map();   // species -> { species, models: [{ asset, parts }], owners, high }
  const meshes = [];
  for (const sp of species) {
    const models = [];
    for (const asset of assetsOf(sp)) {
      const parts = [];
      for (const p of animalParts(asset)) {
        const geometry = partGeometry(p.name);
        if (!geometry) continue;
        const mesh = new THREE.InstancedMesh(geometry, material, capacity);
        mesh.name = `animals:${p.name}`;
        mesh.count = 0;
        mesh.castShadow = true;
        // The instances move every frame and the mesh's bounding sphere is cached from the
        // first time anybody asks, so culling on it would cull live animals; pickables()
        // brings the sphere up to date before a ray is cast against it.
        mesh.frustumCulled = false;
        mesh.visible = false;
        const part = { ...p, asset, species: sp, mesh, shown: new Uint8Array(capacity), showing: 0, stale: true };
        mesh.userData.animalPart = part;
        scene.add(mesh);
        meshes.push(mesh);
        parts.push(part);
      }
      if (parts.length) models.push({ asset, parts });
    }
    if (models.length) kinds.set(sp, { species: sp, models, owners: new Array(capacity).fill(null), high: 0 });
  }

  // Written straight, whatever the slot showed: a slot just taken still holds whatever the
  // last animal in it left, or the identity the mesh was made with.
  function park(part, slot) {
    part.mesh.setMatrixAt(slot, HIDDEN);
    part.mesh.instanceMatrix.needsUpdate = true;
    if (part.shown[slot]) { part.shown[slot] = 0; part.showing--; }
    part.mesh.visible = part.showing > 0;
    part.stale = true;
  }
  // Every part mesh of a species draws up to the highest slot in use. A mesh with nothing
  // showing is not drawn at all (`visible`), which is what keeps the flying sparrow's three
  // meshes off the bill while every sparrow sits.
  function counts(kind) {
    for (const m of kind.models) for (const part of m.parts) part.mesh.count = kind.high;
  }

  // A slot for `owner` in `species`, or -1: no model for it, or the batch is full. The lowest
  // free one, so the meshes' counts stay as short as the herds are.
  function take(species, owner) {
    const kind = kinds.get(species);
    if (!kind) return -1;
    const slot = kind.owners.indexOf(null);
    if (slot < 0) return -1;
    kind.owners[slot] = owner;
    for (const m of kind.models) for (const part of m.parts) park(part, slot);
    if (slot >= kind.high) { kind.high = slot + 1; counts(kind); }
    return slot;
  }
  function give(species, slot) {
    const kind = kinds.get(species);
    if (!kind || slot < 0 || !kind.owners[slot]) return;
    for (const m of kind.models) for (const part of m.parts) park(part, slot);
    kind.owners[slot] = null;
    let high = kind.high;
    while (high > 0 && !kind.owners[high - 1]) high--;
    if (high !== kind.high) { kind.high = high; counts(kind); }
  }
  function put(part, slot, matrix) {
    part.mesh.setMatrixAt(slot, matrix);
    part.mesh.instanceMatrix.needsUpdate = true;
    part.stale = true;
    if (!part.shown[slot]) {
      part.shown[slot] = 1;
      part.showing++;
      part.mesh.visible = true;
    }
  }
  // Out of sight, and a no-op for a slot already out of it - which is every hidden animal on
  // every frame, so it has to be.
  function hide(part, slot) {
    if (!part.shown[slot]) return;
    park(part, slot);
  }

  // What a ray is cast against: the bodies and the heads, as settler-figures.js offers the
  // torso and the head - a ray grazing a wing carries on into the body. One list for every
  // island's animals, rewritten rather than made, since the picker runs every frame in orbit.
  const pickList = [];
  function pickables() {
    pickList.length = 0;
    for (const m of meshes) {
      const part = m.userData.animalPart;
      if ((part.role !== 'body' && part.role !== 'head') || !m.visible || m.count === 0) continue;
      if (part.stale) { m.computeBoundingSphere(); part.stale = false; }
      pickList.push(m);
    }
    return pickList;
  }
  // The owner of an instance a ray hit: whichever view's animal that slot is, while shown.
  function ownerAt(object, instanceId) {
    const part = object && object.userData && object.userData.animalPart;
    if (!part || instanceId == null || !part.shown[instanceId]) return null;
    return kinds.get(part.species).owners[instanceId] || null;
  }

  function dispose() {
    for (const m of meshes) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    meshes.length = 0;
    kinds.clear();
  }

  return {
    capacity, meshes, kinds, take, give, put, hide, pickables, ownerAt, dispose,
    // Straight to the animal a ray hit, on whichever island it stands.
    animalAt: (object, instanceId) => { const o = ownerAt(object, instanceId); return o ? o.rec : null; },
  };
}

// How many draw calls the batch costs right now: the part meshes with anything to draw. The
// colour pass only, like ?stats - the shadow pass draws the same meshes once more.
export function drawCalls(batch) {
  let n = 0;
  for (const m of batch.meshes) if (m.visible && m.count > 0) n++;
  return n;
}

// For picking by arithmetic, as web/js/guest-pick.js picks a guest's settlers: how high an
// animal's middle is over its feet and how near the ray has to pass. More generous than the
// meshes - a sparrow is six centimetres of model, which no mouse hits by its triangles.
const REACH = { chicken: { lift: 0.09, radius: 0.12 }, goat: { lift: 0.2, radius: 0.2 }, sparrow: { lift: 0.04, radius: 0.1 } };
const REACH_DEFAULT = { lift: 0.1, radius: 0.15 };

const wrap = (d) => { d %= TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

// ---- a view ---------------------------------------------------------------------------------
// One region's animals. `region` is { id, origin: [ox, oz], half } - the home region's origin
// is [0, 0], a guest's is its berth in the scene - and every position here is in the scene's
// frame, like crowd-view's: the rows are island-local and the origin goes on once, in apply.
// `perchAt(x, z)` is the height of a roof at that scene position, or null for none; optional,
// and asked only for a sparrow perched or singing, and only when it has moved.
export function createAnimalView({ batch, region, perchAt = null }) {
  const [ox, oz] = region.origin;
  const bodies = new Map();   // animal id -> the body drawn for it
  let order = [];             // the last herd's index -> body, which is what a row counts in
  let lastSeq = -1;
  let traces = [];
  const decoded = new Map();  // reused by every apply, so a message makes only its rows

  // What the rest of the page reads about an animal - the hover label, the dossier, a filter:
  // the public fields the herd carries (docs/animals-wire.md), which island it is on, what the
  // sea last said it was doing, and where it is drawn. Read-only by convention: the sea owns
  // where it is, the islander who it is.
  function publicOf(a) {
    return {
      id: a.id, species: a.species, name: a.name, traits: a.traits || [], home: a.home || null,
      r: a.r, about: a.about ?? null, friends: a.friends || [], island: region.id,
      act: 'still', pos: [ox, oz], y: 0, h: 0, yaw: 0, visible: false, hidden: false,
    };
  }
  function refresh(rec, a) {
    rec.name = a.name;
    rec.traits = a.traits || [];
    rec.home = a.home || null;
    rec.r = a.r;
    rec.about = a.about ?? null;
    rec.friends = a.friends || [];
  }

  function enrol(a) {
    const rec = publicOf(a);
    // Hashed off the island and the id, because every island's first hen is `animal:1`: two
    // islands' hens nodding in step would give away that they are the same arithmetic.
    const key = `${region.id}:${a.id}`;
    const yaw = (hash32(`${key}:yaw`) / 4294967296) * TAU - Math.PI;
    rec.yaw = yaw;
    const b = {
      rec, slot: -1,
      pose: createPose(a.species, { phase: (hash32(`${key}:pose`) / 4294967296) * 100 }),
      // The glide: from where it was drawn when the last word landed to that word, over
      // `took` ms from `at`; `said` and `came` the last two words about what it was doing.
      from: [0, 0], to: [0, 0], heard: false, at: 0, took: 1, said: 'still', came: 'still',
      fromH: 0, toH: 0, h: 0,
      // The facing hint off the last row, and whether there was one.
      fx: 0, fz: 0, face: false,
      yaw, turn: 0, fresh: true, drawn: false,
      // A percher's roof: where it was last asked for, what it said, and how far up the bird
      // has settled so far.
      perchX: NaN, perchZ: NaN, perchY: null, perch: 0,
    };
    b.slot = batch.take(a.species, b);
    bodies.set(a.id, b);
    return b;
  }
  function conceal(b) {
    b.rec.visible = false;
    if (!b.drawn || b.slot < 0) return;
    b.drawn = false;
    const kind = batch.kinds.get(b.rec.species);
    for (const m of kind.models) for (const part of m.parts) batch.hide(part, b.slot);
  }
  function retire(b) {
    conceal(b);
    if (b.slot >= 0) batch.give(b.rec.species, b.slot);
    b.slot = -1;
    if (bodies.get(b.rec.id) === b) bodies.delete(b.rec.id);
  }

  // Who the animals are: `{ seq, animals, traces }` off the sea's `herd`. An older sequence
  // than the one already drawn is a message overtaken by its successor and is ignored - except
  // the empty one at 0, which is the sea's sweep saying the island has gone. Animals are
  // enrolled and retired by id, so one that stays keeps its body, its slot and its glide
  // however the list around it changes; only the index a row counts in is rebuilt.
  function herd(msg) {
    if (!msg || typeof msg !== 'object') return false;
    const seq = Number.isFinite(msg.seq) ? msg.seq : 0;
    const list = Array.isArray(msg.animals) ? msg.animals : [];
    if (seq < lastSeq && !(seq === 0 && list.length === 0)) return false;
    lastSeq = seq;
    const keep = new Set();
    order = list.map((a) => {
      if (!a || typeof a.id !== 'string' || typeof a.species !== 'string') return null;
      let b = bodies.get(a.id);
      // A species that changed is another animal under an old number.
      if (b && b.rec.species !== a.species) { retire(b); b = null; }
      if (!b) b = enrol(a);
      else {
        refresh(b.rec, a);
        // A batch that was full when this one arrived may have room now.
        if (b.slot < 0) b.slot = batch.take(a.species, b);
      }
      keep.add(a.id);
      return b;
    });
    for (const [id, b] of [...bodies]) if (!keep.has(id)) retire(b);
    traces = Array.isArray(msg.traces) ? msg.traces.slice() : [];
    return true;
  }

  // Where they are: the `r` of an `af` message (seven numbers a row, decoded by the sea's own
  // decodeAnimalRows), or a map of rows already decoded. Island-local in, scene frame out.
  function apply(rows, now) {
    let src = rows;
    if (!(rows instanceof Map)) {
      decoded.clear();
      src = decodeAnimalRows(rows, region.half, decoded);
    }
    for (const [idx, at] of src) {
      const b = order[idx];
      if (!b || !at) continue;
      const x = at.x + ox, z = at.z + oz;
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const act = typeof at.act === 'number' ? (ACTS[at.act] || 'still') : ACT_SET.has(at.act) ? at.act : 'still';
      const h = Number.isFinite(at.h) ? Math.max(0, at.h) : 0;
      const pos = b.rec.pos;
      // The first word is where it is, and so is one further than it could have come.
      const dx = x - pos[0], dz = z - pos[1];
      if (!b.heard || dx * dx + dz * dz > SNAP_U * SNAP_U) {
        pos[0] = x; pos[1] = z; b.h = h;
        b.fresh = true;
      }
      b.from[0] = pos[0]; b.from[1] = pos[1];
      b.to[0] = x; b.to[1] = z;
      b.fromH = b.h; b.toH = h;
      const cap = TRAVELS.has(act) ? WALK_TOOK_MS : STAND_TOOK_MS;
      b.took = b.heard ? Math.min(cap, Math.max(MIN_TOOK_MS, now - b.at)) : cap;
      b.at = now;
      b.heard = true;
      b.came = b.said;
      b.said = act;
      const face = at.face;
      b.face = !!(face && (face[0] || face[1]));
      if (b.face) { b.fx = face[0]; b.fz = face[1]; }
    }
  }

  // Draw everybody where they have got to. `now` is the same clock apply() was handed - see
  // the note on crowd-view's draw about what mixing two clocks looks like. `groundAt(x, z)`
  // is the height of the ground at a scene position. `showing` is false while the chronicle
  // is scrubbed back, or for an island not drawn in detail: hidden, but still told where
  // they are, so coming back puts everybody where they actually are.
  function draw(dt, groundAt, now, showing = true) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
    for (const b of bodies.values()) {
      const rec = b.rec;
      // Nobody before the sea has said where they are.
      if (!b.heard) { conceal(b); continue; }
      const age = now - b.at;
      const guess = TRAVELS.has(b.said) ? MAX_GUESS_MS : 0;
      const tMax = 1 + guess / b.took;
      const t = Math.max(0, Math.min(age / b.took, tMax));
      const gx = b.to[0] - b.from[0], gz = b.to[1] - b.from[1];
      const x = b.from[0] + gx * t, z = b.from[1] + gz * t;
      const h = b.fromH + (b.toH - b.fromH) * Math.min(t, 1);
      rec.pos[0] = x; rec.pos[1] = z;
      b.h = h;
      rec.h = h;
      rec.act = b.said;
      if (!showing || rec.hidden || b.slot < 0) { conceal(b); continue; }

      // Going anywhere on this screen: the glide's own speed, not this frame's step - see
      // crowd-view's draw for the hitch a frame's step makes.
      const speed = t >= tMax ? 0 : Math.sqrt(gx * gx + gz * gz) / (b.took / 1000);
      const moving = speed > STANDING_U_S;
      // What is shown is what the sea said, corrected by what this screen can see: a walk
      // that is not going anywhere is standing, a flight that has stopped over the ground has
      // landed, and the glide towards a word that she has *stopped* is the last stride of
      // the walk that brought her.
      let act = b.said;
      if (moving && !TRAVELS.has(act) && TRAVELS.has(b.came)) act = b.came;
      else if (!moving && MOVING_ACTS.has(act)) act = act === 'fly' && h > HOVER_U ? 'fly' : 'still';

      // The heading: the way she is going for a walk or a flight, or when the sea gave no
      // hint; otherwise the hint - the door she is pecking at, the settler she is watching.
      let want = null;
      if (moving && (MOVING_ACTS.has(act) || !b.face)) want = Math.atan2(gx, gz);
      else if (b.face && !MOVING_ACTS.has(act)) want = Math.atan2(b.fx, b.fz);
      let turn = 0;
      if (want != null) {
        if (b.fresh) b.yaw = want;
        else {
          const d = wrap(want - b.yaw) * (1 - Math.exp(-(act === 'fly' ? TURN_FLYING : TURN) * step));
          b.yaw = wrap(b.yaw + d);
          turn = step > 0 ? d / step : 0;
        }
      }
      b.turn = damp(b.turn, turn, 5, step);
      rec.yaw = b.yaw;

      const pose = stepPose(rec.species, b.pose, { act, moving, speed, turn: b.turn }, step);

      // Standing on the ground, or flying over it - over the water surface when the ground is
      // the bed of a bay she is crossing - and lifted onto a roof when she is perched on one.
      let ground = groundAt ? groundAt(x, z) : 0;
      if (h > 0 && ground < SEA_LEVEL) ground = SEA_LEVEL;
      let perchTo = 0;
      if (perchAt && PERCH_ACTS.has(act)) {
        if (!(Math.abs(x - b.perchX) + Math.abs(z - b.perchZ) < PERCH_REASK)) {
          b.perchX = x; b.perchZ = z;
          const roof = perchAt(x, z);
          b.perchY = Number.isFinite(roof) ? roof : null;
        }
        if (b.perchY != null) perchTo = Math.max(0, b.perchY - ground - h);
      }
      b.perch = b.fresh ? perchTo : damp(b.perch, perchTo, PERCH_RATE, step);
      const y = ground + h + b.perch;
      rec.y = y;
      b.fresh = false;

      // The whole animal, then each part hung on its joint: the animal's matrix times the
      // joint's own turn about its `at`. The body's `at` is its origin, so it is the animal.
      const yaw = b.yaw;
      root.position.set(x + Math.sin(yaw) * pose.surge, y + pose.bodyY, z + Math.cos(yaw) * pose.surge);
      root.rotation.set(pose.bodyX, yaw, pose.bodyZ);
      root.updateMatrix();
      const kind = batch.kinds.get(rec.species);
      for (let m = 0; m < kind.models.length; m++) {
        const model = kind.models[m];
        const on = showsAsset(rec.species, pose, model.asset);
        for (let i = 0; i < model.parts.length; i++) {
          const part = model.parts[i];
          if (!on) { batch.hide(part, b.slot); continue; }
          jointEuler(pose, part.role, part.index, euler);
          local.makeRotationFromEuler(euler);
          local.setPosition(part.at[0], part.at[1], part.at[2]);
          composed.multiplyMatrices(root.matrix, local);
          batch.put(part, b.slot, composed);
        }
      }
      b.drawn = true;
      rec.visible = true;
    }
  }

  // Taken out of sight without being forgotten - a filter. A separate word from `visible`,
  // which draw() writes every frame, exactly as crowd-view keeps `hidden` apart.
  function setVisible(id, on) {
    const b = bodies.get(id);
    if (b) b.rec.hidden = !on;
  }

  // The nearest drawn animal whose middle passes within reach of the ray from `o` along the
  // unit vector `d`, no further than `maxT`: { animal, t } or null. For a mouse over a
  // sparrow, which a triangle test almost never finds.
  function animalOnRay(o, d, maxT = Infinity) {
    let best = null, bestT = maxT;
    for (const b of bodies.values()) {
      const rec = b.rec;
      if (!rec.visible) continue;
      const s = REACH[rec.species] || REACH_DEFAULT;
      const vx = rec.pos[0] - o.x, vy = rec.y + s.lift - o.y, vz = rec.pos[1] - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t <= 0 || t >= bestT) continue;
      if (vx * vx + vy * vy + vz * vz - t * t > s.radius * s.radius) continue;
      best = rec;
      bestT = t;
    }
    return best ? { animal: best, t: bestT } : null;
  }

  function dispose() {
    for (const b of [...bodies.values()]) retire(b);
    order = [];
    traces = [];
    lastSeq = -1;
  }

  return {
    herd, apply, draw, setVisible, dispose, animalOnRay,
    region: region.id,
    // The last herd's sequence and marks, as sent: traces are island-local, like the rows.
    seq: () => lastSeq,
    traces: () => traces,
    count: () => bodies.size,
    // Every animal of this island in the herd's order, and one by id.
    animals: () => order.filter(Boolean).map((b) => b.rec),
    animal: (id) => (bodies.has(id) ? bodies.get(id).rec : null),
    // Picking with the mouse. The meshes are the batch's, shared by every island, so the list
    // is everybody's and animalAt answers only for this island's own - null for a neighbour's
    // hen, which that island's view will name. batch.animalAt names either.
    pickables: () => batch.pickables(),
    animalAt(object, instanceId) {
      const owner = batch.ownerAt(object, instanceId);
      return owner && bodies.get(owner.rec.id) === owner && owner.rec.visible ? owner.rec : null;
    },
  };
}
