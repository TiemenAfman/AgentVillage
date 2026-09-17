// The tables that come out for the Friday borrel, and go back in again at closing time.
//
// One set stands on the square all week - that is the `tables` civic the village earns,
// drawn in buildings.js - and it seats about ten people. A village of fifty needs five,
// so the rest are carried out at half past four and are gone by five, which is also the
// only honest way to draw them: a square permanently set for a party nobody is at reads
// as a stage set rather than as a place.
//
// They are one InstancedMesh sharing the civic's own geometry, so however many come out
// they cost one draw call and no new material. The spots are worked out once per village
// and the borrel only ever changes `count`, which is a number and not a matrix.
import * as THREE from 'three';

// As many as the island will carry out, whatever the population says. Past this the
// square is furniture and not a square, and a village that big has other problems.
const MOST = 16;

// How far a table may be nudged off the middle of its cell, and how far off square it may
// be turned. Tables carried out in a hurry are not laid out on a grid, and a row of them
// dead straight reads as a car park.
const NUDGE = 0.16;
const SKEW = 0.22;

// How much paving to leave between two sets, in cells. Tables on neighbouring cells read
// as one long table somebody has sawn in half, and a borrel wants room to stand between
// them with a glass - which is the whole point of carrying them out.
const APART = 3;

// The cells, thinned out so that no two are within `APART` of each other, and then the
// ones that were passed over added back in the same order. The second half matters: on a
// small square the spread alone would hand back two spots for five sets, and a table that
// cannot be carried out because the square is tidy is worse than two tables close together.
function spread(cells) {
  const kept = [];
  const rest = [];
  for (const c of cells) {
    const room = kept.every(([x, z]) => Math.max(Math.abs(x - c[0]), Math.abs(z - c[1])) >= APART);
    (room ? kept : rest).push(c);
  }
  return [...kept, ...rest];
}

// A small deterministic number from a cell, so the same table stands at the same angle on
// the same island every Friday rather than shuffling on every page load.
function wobble(gx, gz, salt) {
  const n = Math.sin((gx * 12.9898 + gz * 78.233 + salt * 37.719)) * 43758.5453;
  return n - Math.floor(n);
}

export function createBorrelTables(scene, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, MOST);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  // The instances are spread over the square rather than around the mesh's own origin,
  // so the bounding sphere three.js computes from the geometry is far too small and the
  // whole set flickers out as soon as the origin leaves the frustum.
  mesh.frustumCulled = false;
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  let spots = 0;

  return {
    // `cells` is [gx, gz] on the square, nearest the middle first; `cellWorld` turns one
    // into an [x, z] and `groundAt` says how high the paving is there. Written in the
    // order they arrive, so the first tables out are the ones nearest the middle and a
    // thin borrel still looks like it has a centre.
    setSpots(cells, { cellWorld, groundAt }) {
      const room = spread(cells);
      spots = Math.min(room.length, MOST);
      for (let i = 0; i < spots; i++) {
        const [gx, gz] = room[i];
        const [cx, cz] = cellWorld(gx, gz);
        const x = cx + (wobble(gx, gz, 1) - 0.5) * 2 * NUDGE;
        const z = cz + (wobble(gx, gz, 2) - 0.5) * 2 * NUDGE;
        dummy.position.set(x, groundAt(x, z), z);
        // A quarter turn from the cell plus a little off square: the quarter is what keeps
        // two neighbouring sets from reading as one long table.
        dummy.rotation.y = Math.round(wobble(gx, gz, 3) * 4) * (Math.PI / 2)
          + (wobble(gx, gz, 4) - 0.5) * 2 * SKEW;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count > spots) mesh.count = spots;
    },

    // How many are out. Called every frame with the same number nearly always, so it
    // returns on the first line rather than touching the mesh.
    show(n) {
      const want = Math.max(0, Math.min(n, spots, MOST));
      if (want === mesh.count) return;
      mesh.count = want;
    },

    get out() { return mesh.count; },

    dispose() {
      scene.remove(mesh);
      mesh.dispose();
    },
  };
}

// One set of tables per ten islanders, and the set standing on the square all week is the
// first of them - so a village of fifty-five carries four more out and sits at five.
export function tableSetsFor(settlers) {
  return Math.max(0, Math.floor((Number(settlers) || 0) / 10) - 1);
}
