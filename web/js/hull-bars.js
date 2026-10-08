// A hull's health over every boat a cannonball has hit (Plans/kanonnen.md; the keeper: "roeiboot
// krijgt ook een HP bar"): a rowing boat's two lives as two squares, a galleon's five as one bar
// that empties. What it says is the sea's last word on that hull - `{t:'cannon', a:'hull', id, hits,
// of}` (lib/cannons.mjs) - kept here per boat id until she sinks (`{t:'boat', sunk}` clears it) or
// mends (HULL_MEND_MS without a hit, the sea's own rule). A whole hull has no bar.
//
// agent-bars.js's way and for its reason: two InstancedMeshes for every bar on the screen, backs and
// fills, each instance turned to face the camera on the CPU - no draw call per boat.
import * as THREE from 'three';
import { HULL_MEND_MS } from 'shared/cannon.mjs';

export const HULL_BAR_LIMIT = 32;
// Out to how far a hurt hull shows its bar (island units).
export const HULL_BAR_RANGE = 90;
const BACK = 0x14100c, FILL = 0xe0a127, LOW = 0xd8281c;
// A galleon's bar over her deck, a rowing boat's over its thwart: width, height, gap between
// squares, and how high over the water.
const LOOK = { ship: { w: 2.6, h: 0.22, top: 4.2 }, boat: { w: 0.7, h: 0.12, top: 1.0 } };
const GAP = 0.08, BORDER = 0.04;

// The segments a hull's bar is drawn in: a hull that dies in a few hits shows each as a square
// (a rowing boat's two), one with more as one bar. Kept apart so a test can hold it.
export function hullSegments(hits, of) {
  if (of <= 3) return Array.from({ length: of }, (_, k) => (k < of - hits ? 1 : 0));
  return [Math.max(0, (of - hits) / of)];
}

export function createHullBars(scene, limit = HULL_BAR_LIMIT) {
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
  const unit = new THREE.PlaneGeometry(1, 1);
  const fillGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  const backs = new THREE.InstancedMesh(unit, mat(BACK, 0.75), limit);
  const fills = new THREE.InstancedMesh(fillGeo, mat(0xffffff, 1), limit);
  backs.renderOrder = 10;
  fills.renderOrder = 11;
  for (const m of [backs, fills]) {
    m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
    scene.add(m);
  }
  const colour = new THREE.Color();
  // The colour attribute made up front (three makes it on the first setColorAt), so a frame with no
  // bar and one with bars draw with the same program.
  fills.setColorAt(0, colour.setHex(FILL));
  const hurt = new Map();   // boat id -> { hits, of, at }
  const pos = new THREE.Vector3(), right = new THREE.Vector3(), scale = new THREE.Vector3(), matrix = new THREE.Matrix4();

  // `boats` are the page's hulls ({ id, x, z, craft }), `ship(b)` whether one is a galleon.
  function update(boats, camera, ship, now = Date.now()) {
    let n = 0;
    if (camera && hurt.size) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      const q = camera.quaternion;
      for (const b of boats) {
        const h = hurt.get(b.id);
        if (!h) continue;
        if (now - h.at > HULL_MEND_MS) { hurt.delete(b.id); continue; }
        const dx = b.x - camera.position.x, dz = b.z - camera.position.z;
        if (dx * dx + dz * dz > HULL_BAR_RANGE * HULL_BAR_RANGE) continue;
        const look = ship(b) ? LOOK.ship : LOOK.boat;
        const segs = hullSegments(h.hits, h.of);
        const sw = (look.w - GAP * (segs.length - 1)) / segs.length;
        const y = (b.craft && b.craft.object ? b.craft.object.position.y : 0) + look.top;
        segs.forEach((f, k) => {
          if (n >= limit) return;
          const off = -look.w / 2 + k * (sw + GAP);
          pos.set(b.x, y, b.z).addScaledVector(right, off + sw / 2);
          backs.setMatrixAt(n, matrix.compose(pos, q, scale.set(sw + BORDER * 2, look.h + BORDER * 2, 1)));
          pos.addScaledVector(right, -sw / 2);
          fills.setMatrixAt(n, matrix.compose(pos, q, scale.set(Math.max(1e-4, sw * f), look.h, 1)));
          fills.setColorAt(n, colour.setHex(segs.length === 1 && f <= 0.4 ? LOW : FILL));
          n++;
        });
      }
    }
    backs.count = fills.count = n;
    backs.instanceMatrix.needsUpdate = fills.instanceMatrix.needsUpdate = true;
    if (fills.instanceColor) fills.instanceColor.needsUpdate = true;
    return n;
  }

  return {
    update,
    // The sea's word on a hull: `hits` of `of`; and a hull gone down (or mended) has none.
    hit(id, hits, of, now = Date.now()) { hurt.set(id, { hits, of, at: now }); },
    clear(id) { hurt.delete(id); },
    hurt: (id) => hurt.get(id) || null,
    dispose() { for (const m of [backs, fills]) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose(); } },
  };
}
