// Every building on an island in one draw call per pass: a three.js BatchedMesh, with each
// record's body as one instance in it (Plans/DONE/gebouwen-in-een-batch.md).
//
// Measured on Hoogezand (806 records): from above, the bodies were 806 calls in the colour
// pass and 806 in the shadow pass, and they cost ~7 ms of a 32 ms frame - on the CPU, in
// three's per-call path (renderBufferDirect, setProgram, uniformMatrix4fv), while the GPU
// barely noticed their 0.6 million triangles. With the yard signs' frames in the same batch
// (nameplate.js) the frame from above went from 28.5 to 15 ms, measured side by side with the
// loose meshes on the same afternoon (the plan has the table). Every house is a geometry of its own
// (buildBuilding seeds its rng on the id), so an InstancedMesh cannot hold them; a
// BatchedMesh can, and keeps a matrix and a visibility per house, culls each one against the
// frustum (and against the sun's camera in the shadow pass), and says which one a ray hit.
//
// The one decision everything else rests on: **the record keeps its scene graph, and the
// batch mirrors it.** Where the body's Mesh used to hang there is now a stand-in - an empty
// Object3D with the same `userData.id` - and in its own onBeforeRender, once per render (after
// three's updateMatrixWorld, before the shadow pass), the batch copies from every stand-in
// whether it is drawn and where. So everything that already shows, hides or moves a building
// goes on working without knowing the batch exists: applyVisibility writes `group.visible`,
// popIn and the leaving animation scale the group, the Object Distance cut (record-cull.js)
// sets `layers.mask = 0` on every object in the group, stand-in included, keepRegion masks a
// whole guest island, the Batavia's swell moves `rec.mesh` itself. The other way round -
// every one of those telling the batch - is exactly the kind of list that drifts
// (record-extras.js is what one of those looked like after a year).
//
// No DOM, and nothing but three: tests/record-batch.test.mjs drives it without a renderer.
import * as THREE from 'three';

// How much a full batch grows by. Growing copies the whole buffer and uploads it again, so
// not by little; the room it leaves is the only memory the batch costs over the loose meshes.
const GROW = 1.5;
// What a building costs in vertices, on average, for reserving room before the first load:
// Hoogezand's 806 records are 1.69 million (non-indexed; a harbour house or a civic is ten
// times a shed). Only a first guess - a batch that is short grows.
export const VERTICES_PER_BUILDING = 2400;

const WHITE = new THREE.Color(1, 1, 1);

// The id a raycast hit belongs to, whether it hit a loose mesh or an instance in a batch - the
// one reading pick() in main.js and pickBuilding in plan-mode.js share, as the settlers have
// figureAt(mesh, instanceId).
export function pickedId(hit) {
  if (!hit || !hit.object) return null;
  const o = hit.object;
  if (typeof o.recordIdAt === 'function') return o.recordIdAt(hit.batchId);
  return (o.userData && o.userData.id) ?? null;
}

// Whether a stand-in is drawn: every object from it up to the batch's own parent visible, and
// not cut by a layer mask (record-cull.js is the only thing in the project that writes layers,
// and it writes 0). A stand-in whose record is no longer under that parent - taken out of the
// scene, or never put in - is not drawn, exactly as its mesh would not have been.
function drawnUnder(stand, root) {
  if (stand.layers.mask === 0) return false;
  for (let o = stand; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === root) return true;
  }
  return false;
}

export function createRecordBatch({ material, parent, instances = 64, vertices = 64 * VERTICES_PER_BUILDING, name = 'buildings' }) {
  // Non-indexed like every building (finish() in buildings.js), so no index buffer at all.
  const mesh = new THREE.BatchedMesh(instances, vertices, 0, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // three works the whole batch's bounding sphere out once, the first time it is asked, and
  // never again - a village that grows past it would be culled whole. The per-instance
  // culling in onBeforeRender is the culling.
  mesh.frustumCulled = false;
  // r170's renderer compares `object.colorTexture`, a field BatchedMesh does not have (it is
  // `_colorsTexture`), and so asks for a program on every draw of a batch without a colour
  // texture. Having one - all white, which multiplies out - makes the comparison come true.
  // The instance does not exist; setColorAt makes the texture before it looks.
  mesh.setColorAt(0, WHITE);
  // Not drawn while it holds nothing: an empty batch has no position buffer, and three would
  // still bind a program for it before finding there is nothing to draw. The phone, which has
  // no island of its own, keeps an empty home batch for as long as it runs.
  mesh.visible = false;
  if (parent) parent.add(mesh);

  const cap = { vertices };
  let live = 0;
  // By instance id: the stand-in, what was last written for it, and its geometry.
  const slots = [];
  const slotOf = new WeakMap();
  // Geometries more than one instance draws (addShared), by key.
  const shared = new Map();
  // Vertices held by geometries that were taken out. r170's deleteGeometry frees the id and not
  // the range; optimize() compacts them away, and is only worth its copy when room is short.
  let dead = 0;

  mesh.recordIdAt = (i) => {
    const s = slots[i];
    return s ? s.stand.userData.id ?? null : null;
  };

  // Never by a little: a batch one house short that grew by one house would copy its buffer
  // for every newcomer.
  function room(verts) {
    if (mesh.unusedVertexCount >= verts) return;
    if (dead > 0) {
      mesh.optimize();
      dead = 0;
      if (mesh.unusedVertexCount >= verts) return;
    }
    const used = cap.vertices - mesh.unusedVertexCount;
    cap.vertices = Math.ceil(Math.max(cap.vertices * GROW, used + verts));
    mesh.setGeometrySize(cap.vertices, 0);
  }
  function seat(more = 1) {
    const want = mesh.instanceCount + more;
    if (want <= mesh.maxInstanceCount) return;
    mesh.setInstanceCount(Math.ceil(Math.max(mesh.maxInstanceCount * GROW, want)));
  }

  // The building material's attributes, all of them, on every geometry: a batch holds one
  // buffer per attribute, and a geometry without one is refused. `aSheet` is the one a
  // building may lack - a part says which sheet it wants only when it wants one - and zeroes
  // are what merge() in buildings.js fills in when some part of a building has one.
  function fit(geometry) {
    if (!geometry.attributes.aSheet) {
      geometry.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1));
    }
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    return geometry;
  }

  function enrol(gid, own) {
    seat();
    const inst = mesh.addInstance(gid);
    // Not drawn until the first sync has seen where it stands: a raycast between now and the
    // next render would otherwise find a house at the origin.
    mesh.setVisibleAt(inst, false);
    const stand = new THREE.Object3D();
    const slot = { stand, inst, gid, own, shown: false, last: new Float64Array(16).fill(NaN) };
    slots[inst] = slot;
    slotOf.set(stand, slot);
    mesh.visible = ++live > 0;
    return stand;
  }

  // Takes `geometry` into the batch and hands back its stand-in. The batch keeps the only copy:
  // the geometry is disposed here (it was never uploaded, so this frees nothing on the GPU),
  // because keeping both would hold every building on the island in memory twice - 74 MB on
  // Hoogezand.
  function add(geometry) {
    fit(geometry);
    room(geometry.attributes.position.count);
    const gid = mesh.addGeometry(geometry);
    geometry.dispose();
    return enrol(gid, true);
  }

  // One geometry for many instances - the two shapes of a yard sign's frame. `make` is asked
  // once per key, and what it makes is copied in and disposed like add()'s; the shape stays in
  // the batch for its life, however many of its instances come and go.
  function addShared(key, make) {
    let gid = shared.get(key);
    if (gid === undefined) {
      const geometry = fit(make());
      room(geometry.attributes.position.count);
      gid = mesh.addGeometry(geometry);
      geometry.dispose();
      shared.set(key, gid);
    }
    return enrol(gid, false);
  }

  function remove(stand) {
    const slot = stand && slotOf.get(stand);
    if (!slot) return;
    slotOf.delete(stand);
    slots[slot.inst] = null;
    mesh.visible = --live > 0;
    if (slot.own) {
      dead += mesh.getGeometryRangeAt(slot.gid).reservedVertexCount;
      mesh.deleteGeometry(slot.gid);     // and the instance on it
    } else {
      mesh.deleteInstance(slot.inst);
    }
  }

  // The mirror. Cheap enough to run per render: a parent chain of two or three steps and
  // sixteen numbers per record, and a write only for what changed - a house popping in, the
  // Batavia on her swell. A written matrix re-uploads the matrix texture (64 kB at ~1,000).
  const rel = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  function sync() {
    const root = mesh.parent;
    const e = mesh.matrixWorld.elements;
    const identity = e[0] === 1 && e[5] === 1 && e[10] === 1 && e[12] === 0 && e[13] === 0 && e[14] === 0
      && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0;
    if (!identity) inv.copy(mesh.matrixWorld).invert();
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s) continue;
      const shown = !!root && drawnUnder(s.stand, root);
      if (shown !== s.shown) { mesh.setVisibleAt(s.inst, shown); s.shown = shown; }
      if (!shown) continue;
      const w = identity ? s.stand.matrixWorld : rel.multiplyMatrices(inv, s.stand.matrixWorld);
      const we = w.elements, last = s.last;
      let same = true;
      for (let k = 0; k < 16; k++) if (we[k] !== last[k]) { same = false; break; }
      if (same) continue;
      for (let k = 0; k < 16; k++) last[k] = we[k];
      mesh.setMatrixAt(s.inst, w);
    }
  }

  // Once per render() - three counts them, before the shadow pass - whichever pass asks first:
  // the shadow pass calls onBeforeRender through onBeforeShadow, and on a frame the shadow map
  // is not redrawn (the quality governor's shadowEvery) the colour pass is first.
  //
  // Sorted front to back in the colour pass, where it saves the GPU shading what is behind a
  // house, and not in the shadow pass (which passes no scene): a depth map gains next to
  // nothing from it, and the sort was a third of what building the list cost.
  let syncedFrame = -1;
  const build = THREE.BatchedMesh.prototype.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, geometry, mat, group) {
    const frame = renderer && renderer.info ? renderer.info.render.frame : NaN;
    if (frame !== syncedFrame) { syncedFrame = frame; sync(); }
    this.sortObjects = !!scene;
    build.call(this, renderer, scene, camera, geometry, mat, group);
  };

  // A copy of one building's positions, for whatever needs its shape without drawing it in the
  // batch - the planner's ghosts. Its own geometry, to be disposed by whoever asked: sharing the
  // batch's buffers would free them on that dispose.
  function positionsOf(stand) {
    const slot = stand && slotOf.get(stand);
    if (!slot) return null;
    const r = mesh.getGeometryRangeAt(slot.gid);
    const src = mesh.geometry.attributes.position.array;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(src.slice(r.vertexStart * 3, (r.vertexStart + r.vertexCount) * 3), 3));
    g.boundingBox = mesh.getBoundingBoxAt(slot.gid, new THREE.Box3());
    g.boundingSphere = mesh.getBoundingSphereAt(slot.gid, new THREE.Sphere());
    return g;
  }

  // Room for this many more buildings before they are made, so a first load does not grow the
  // buffer (and copy it) five times over. A guess by the average; an add that finds it short
  // grows as usual.
  function reserve(more, verts = more * VERTICES_PER_BUILDING) {
    if (!(more > 0)) return;
    seat(more);
    room(verts);
  }

  return {
    mesh,
    add,
    addShared,
    remove,
    reserve,
    sync,
    positionsOf,
    has: (stand) => slotOf.has(stand),
    stats: () => ({
      instances: mesh.instanceCount, capacity: mesh.maxInstanceCount,
      vertices: cap.vertices - mesh.unusedVertexCount, room: cap.vertices, dead,
    }),
    dispose() {
      if (mesh.parent) mesh.parent.remove(mesh);
      mesh.dispose();
      slots.length = 0;
      shared.clear();
    },
  };
}
