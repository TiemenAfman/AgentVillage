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
// That line is about *state*, and it still holds. It is not a line about pixels, and for
// a long time it was read as one: this module drew a heightfield and a set of buildings and
// stopped, so an island across the water was a bare green hill with houses on it. No wood,
// no hedges, no ploughing, no district colour, no paving worn into the grass.
//
// Everything needed to draw it properly had been arriving all along. A bundle carries
// `cleared`, `paths`, `bridges`, `districts` with their lobes and hues, `lattice`,
// `polders` with their dikes and causeways, and `fairway`; there was simply no code on
// this side that read any of it. So the ground and everything standing on it now comes
// from `createLandscape`, which is the same call our own island is built with - see its
// header in world.js for where that seam is. A neighbour's island is drawn by our renderer
// out of their data, and the only thing that makes it a guest is the offset it stands at.
import * as THREE from 'three';
import { createLandscape, seasonOf } from './world.js';
import { buildBuilding } from './buildings.js';
import { housePlacement } from './house-placement.js';

// A harbour house stands on stilts, and this pins its deck just above the waterline - but
// only where there is actually water to stand in. The same number and the same reasoning as
// main.js:1511; see the comment there for the district of green wedges lying in the grass
// that got it written down.
const HARBOUR_WATERLINE = 0.35;

// An island with nothing on it. A region is built with its bundle already in hand, so in
// practice this is never what gets drawn - but main.js guards every read of
// `region.village` with a `&&`, and the landscape needs the lists rather than the guard.
// Rather than teach it to take null, hand it an island where nobody has built anything:
// the heightfield alone still gives a coast, hills, a lake and rivers.
const EMPTY_VILLAGE = {
  island: { town: null, lattice: null },
  districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
};

export function createGuestIsland({
  scene, region, buildings = [], material = null, modest = false,
  // The world's month, from main.js's worldNow(). No fallback to this machine's calendar:
  // a guest island only exists in a sea, and the sea says what month it is.
  month,
}) {
  const terrain = region.terrain;
  const season = seasonOf(month);

  // Drawn in the island's OWN coordinates inside a group at its origin. This is the rule
  // from shared/regions.mjs: a module that builds its positions out of `half` wants the raw
  // local terrain and an offset group, not the world facade. Doing it the other way - the
  // facade, everything in world space - would work here and then quietly sink every prop
  // and fence a later phase hangs on it, because those build their own positions too.
  const group = new THREE.Group();
  group.position.set(region.origin[0], 0, region.origin[1]);
  scene.add(group);

  // Their island, by the same call ours is built with. A hundred and fifty lines of ground
  // used to stand here - a heightfield, the shore crossfade, the meadow mottling - all of
  // it a second copy of what world.js already did, and all of it stopping short of the
  // wood and the fields because those were locked inside createWorld. Now there is one
  // copy, and a neighbour gets the lot: district colour, ploughing, walls, hedges, the
  // paving worn into the grass, the reeds, the withies down their channel.
  //
  // The `||` is main.js's own guard carried through - see EMPTY_VILLAGE above.
  const land = createLandscape({
    parent: group,
    terrain,
    village: region.village || EMPTY_VILLAGE,
    season,
    modest,
    // See createLandscape: a berth is inside the same water plane our own island hides its
    // seabed under, and drawing a quarter of a million triangles to hide them is not worth
    // it. Without this an island arrives as a raft.
    skipSeabed: true,
    groundName: `ground:${region.id}`,
    // Namespaced the way every guest id has to be: both islands have a `civic:board`, and
    // an id that is not namespaced quietly opens our own town hall's dossier when you
    // click theirs.
    pickId: `guest:${region.id}`,
  });
  const ground = land.ground;



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
      if (spec.harbour && y <= HARBOUR_WATERLINE) y = Math.max(-0.35, Math.min(y, 0.05));

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
    // Their season turns with ours and a tree felled over there falls rather than
    // vanishing. One call a frame; main.js walks the guests for the mills anyway.
    update: (dt, month2) => land.update(dt, month2),
    triangles: land.triangles,
    buildingCount: records.length,
    dispose: () => {
      land.dispose();
      scene.remove(group);
      for (const rec of records) rec.built.geometry.dispose();
    },
  };
}
