// Somebody else's island, standing where shared/regions.mjs put it.
//
// Not a second createWorld. The asymmetry is deliberate and it is the same one
// lib/guestview.mjs and `state.guest` already draw: **your island is a village, theirs is a
// place.** createWorld and applyVillage between them write state.village, state.districts,
// state.byId, the chronicle keys, the milestones, the flags, the dossier, the visibility
// filters and the waiting flags, and they own the one sky, the one sea and the one set of
// lights. Region-scoping all of that would mean touching the post, the market, the garden,
// the build menu and the chronicle to draw a coastline. So this module composes the
// existing pieces and stops at ground you can stand on.
//
// What it therefore does NOT draw, and what that costs: no forest, no fields, no ground
// wear, no hamlet dressing, no buildings, no settlers. Their coast, their hills, their lake
// and their rivers are all real, because all of that is in the heightfield their seed makes
// - and the heightfield is the whole reason their island can be drawn at all without asking
// them for anything (see lib/neighbours.mjs:5-8).
//
// The ground is painted by world.js's own `bandColour`, imported rather than copied: two
// islands in one frame that disagree about where sand becomes meadow is a seam you cannot
// unsee.
import * as THREE from 'three';
import { bandColour, seasonOf, SEASON, SHORE, SHORE_SAND } from './world.js';
import { buildBuilding, HARBOUR_PIN } from './buildings.js';
import { housePlacement } from './house-placement.js';
import { smoothstep } from 'shared/rng.mjs';
import { SEA_LEVEL } from 'shared/terrain.mjs';

// A visitor's harbour house is pinned exactly as ours is - floor on the planks, and only
// where there is water to stand in. The number itself comes from buildings.js now rather
// than being typed out again here: the two copies drifted once already, and a constant that
// is only right on one of the two islands puts a guest's quay under its own decking while
// ours lies flat. See makeRecord in main.js for what each half of the test is for.

// A vertex per grid corner, like our own ground - not the every-other-one the horizon draws
// a silhouette with (horizon.js:29). Once you can walk on it, half resolution is a cliff
// every other cell and a hill you slide off.
export function createGuestIsland({
  scene, region, buildings = [], material = null, modest = false,
  month = new Date().getMonth(),
}) {
  const terrain = region.terrain;
  const size = terrain.size, N = terrain.N, half = terrain.half;
  const season = seasonOf(month);

  // Drawn in the island's OWN coordinates inside a group at its origin. This is the rule
  // from shared/regions.mjs: a module that builds its positions out of `half` wants the raw
  // local terrain and an offset group, not the world facade. Doing it the other way - the
  // facade, everything in world space - would work here and then quietly sink every prop
  // and fence a later phase hangs on it, because those build their own positions too.
  const group = new THREE.Group();
  group.position.set(region.origin[0], 0, region.origin[1]);
  scene.add(group);

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3);
  const col = new Float32Array(N * N * 3);
  const tmp = new THREE.Color();
  const tint = new THREE.Color();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = i + j * N;
      const h = terrain.H[k];
      pos[k * 3] = i - half;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = j - half;
      // The shore crossfaded rather than stepped, the same way paintGround does it: the
      // rule at 0.35 is terrain.mjs's and is untouched, but the *painting* blends across
      // SHORE, which on these gradients is two to six cells of dune grass rather than a
      // contour line running round the island like a coastline on a map.
      if (h > SHORE[0] && h < SHORE[1]) {
        tmp.setHex(SHORE_SAND).lerp(tint.setHex(SEASON[season].meadow), smoothstep(SHORE[0], SHORE[1], h));
      } else {
        tmp.setHex(bandColour(h, season));
      }
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
  }

  // Only the quads that touch land, exactly as horizon.js:64-72 already has to: without it
  // the whole square grid is drawn and the island arrives as a raft - a flat sheet of sand
  // out to the corners of its own map. Ours gets away with drawing the lot because its
  // seabed is hidden under a water plane that reaches further than it does; a guest island
  // at a berth is inside that same plane, so the same trick would work - but drawing a
  // quarter of a million triangles of seabed to hide them under water is not a trick worth
  // keeping.
  const idx = [];
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = i + j * N, b = a + 1, c = a + N, d = c + 1;
      if (terrain.H[a] < 0 && terrain.H[b] < 0 && terrain.H[c] < 0 && terrain.H[d] < 0) continue;
      idx.push(a, c, b, b, c, d);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  // Its own material rather than a share of the building material: this is vertex-coloured
  // ground, and the building material carries a texture-sheet attribute every vertex has to
  // have. One draw call either way.
  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0,
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.castShadow = false;          // a heightfield casting on itself buys nothing here
  ground.name = `ground:${region.id}`;
  // So the existing raycast finds it and hovering says whose island this is. Namespaced the
  // way every guest id has to be: both islands have a `civic:board`, and an id that is not
  // namespaced quietly opens our own town hall's dossier when you click theirs.
  ground.userData.id = `guest:${region.id}`;
  group.add(ground);

  // ---- their village -------------------------------------------------------
  // Placed exactly the way makeRecord places ours - same buildBuilding, same
  // housePlacement, same yard nudge, same harbour clamp - because a house that stands a
  // hand's breadth differently on their island than it would on ours is a house that does
  // not match the plots their own layout.json recorded, and their paths would miss it.
  //
  // What is deliberately left off: nameplates, and the moving extras. The nameplates are
  // not a detail - 34 of them on our island are 102 draw calls and 17 MB of canvas, some
  // 40% of everything drawn - and the rule that replaces them reads well enough: a yard
  // sign is for the island you live on. Their houses are still hoverable, which is the same
  // information at a tenth of the cost. The extras (mill blades, a flag, a beacon, a clock,
  // a fountain, a chimney fire) are left off because each one needs a frame-by-frame update
  // and none of them changes what the place looks like from across the water.
  const records = [];
  const local = region.terrain;
  const plotCentre = (plot) => [plot.gx + plot.w / 2 - local.half, plot.gz + plot.d / 2 - local.half];
  const plotOf = (id) => {
    const b = buildings.find((x) => x.id === id);
    return b ? b.plot : null;
  };
  // Ring 1 of the master's plot is the yard; a shed seated there is pushed to the outside of
  // its cell so the house beside it has room. Lifted from main.js's yardNudge rather than
  // reached for, because guest-island.js may not import main.js.
  const yardNudge = (spec, built) => {
    if (spec.kind !== 'shed' || !spec.master || !spec.plot) return [0, 0];
    const mp = plotOf(spec.master);
    if (!mp) return [0, 0];
    const dx = Math.sign(spec.plot.gx - (mp.gx + 1)), dz = Math.sign(spec.plot.gz - (mp.gz + 1));
    if (Math.abs(spec.plot.gx - (mp.gx + 1)) > 1 || Math.abs(spec.plot.gz - (mp.gz + 1)) > 1) return [0, 0];
    const bb = built.bbox;
    const rx = Math.max(-bb.min.x, bb.max.x), rz = Math.max(-bb.min.z, bb.max.z);
    const swap = (spec.plot.rot || 0) % 2 === 1;
    const room = (r) => Math.max(0, 0.5 - r);
    return [dx * room(swap ? rz : rx), dz * room(swap ? rx : rz)];
  };

  if (material) {
    for (const spec of buildings) {
      if (!spec || !spec.plot) continue;
      let built;
      try {
        built = buildBuilding(spec, { modest });
      } catch (e) {
        // One building that will not build must not cost the island. Their bundle came off
        // another machine, which may be running a version of buildings.js that knows a kind
        // this one does not.
        console.warn(`island: ${region.id} cannot build ${spec.id}: ${e && e.message}`);
        continue;
      }
      const nudge = yardNudge(spec, built);
      const pose = housePlacement(spec, built.bbox, buildings);
      const c = plotCentre(spec.plot);
      const x = c[0] + nudge[0] + pose.x;
      const z = c[1] + nudge[1] + pose.z;
      let y = local.worldHeight(x, z);
      if (spec.harbour && y < SEA_LEVEL) y = HARBOUR_PIN;

      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = pose.yaw;
      const mesh = new THREE.Mesh(built.geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Namespaced, and it has to be. Both islands have a `civic:board`, a `civic:townhall`
      // and a `civic:tavern`, so a bare id put into state.byId would overwrite ours - and
      // clicking their town hall would quietly open the dossier of our own.
      mesh.userData.id = `guest:${region.id}:${spec.id}`;
      g.add(mesh);
      group.add(g);
      records.push({ id: spec.id, spec, group: g, built, mesh });
    }
  }

  // The same rectangles main.js's blockersOf makes, moved into world coordinates. The
  // buildings are drawn in the island's own frame inside an offset group, and a blocker is
  // read by walk mode in world coordinates - so this is the one place the origin has to be
  // added back on.
  function blockers() {
    const out = [];
    const [ox, oz] = region.origin;
    for (const rec of records) {
      const c = Math.cos(rec.group.rotation.y), s = Math.sin(rec.group.rotation.y);
      for (const r of rec.built.solids) {
        out.push({
          x: ox + rec.group.position.x + r.x * c + r.z * s,
          z: oz + rec.group.position.z - r.x * s + r.z * c,
          hx: Math.abs(r.hx * c) + Math.abs(r.hz * s),
          hz: Math.abs(r.hx * s) + Math.abs(r.hz * c),
          id: `guest:${region.id}:${rec.id}`,
        });
      }
    }
    return out;
  }

  return {
    group,
    ground,
    region,
    records,
    blockers,
    triangles: idx.length / 3,
    buildingCount: records.length,
    dispose: () => {
      scene.remove(group);
      geo.dispose();
      groundMat.dispose();
      for (const rec of records) rec.built.geometry.dispose();
    },
  };
}
