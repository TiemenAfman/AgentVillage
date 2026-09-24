// The gold in the gold pit, and the bar a settler carries home from it (Plans/goudkuil.md).
//
// The pit itself - a concrete trench silo, open towards the town - is an ordinary civic
// building in buildings.js, one merged geometry like every other. The gold cannot be part of
// that loaf: a merged mesh cannot lose a piece of itself, and this pile has to shrink by one
// bar for every percent of the keeper's five-hour window. So it is hung on the building's
// group as its own InstancedMesh, exactly the way the postbox flag and the clock hands are
// (mailflag.js, clock.js), and how many bars stand is its `count`: one draw call for the
// whole pile however full it is, and nothing to rebuild when a bar goes.
//
// Drawn with the island's own building material rather than one of its own. There is no
// environment map on the island for a metal to reflect, so a "real" gold material comes
// out brown; a warm vertex colour with a touch of the night-glow mask reads as gold at
// noon and glints after dark the way the lit windows do - and costs no extra shader.
import * as THREE from 'three';
import { GOLD_BARS } from 'shared/gold.mjs';

// One bar, in island units (4 m): oversized on purpose, like every prop on the island, or a
// pile of real ingots would be a yellow smudge from the camera's usual height. Long along x.
export const BAR = { l: 0.26, h: 0.075, w: 0.13, top: 0.78 };
const GOLD = 0xf0b92e;
// How much of the night-glow mask a bar takes: enough to catch the eye after dark, far
// below a window's full 1.
const GLINT = 0.22;

// A bar: a box whose top face is drawn in to `top` of the base, which is the shape everybody
// recognises as an ingot. Vertex-coloured, with the emissive attribute the building material
// reads (buildings.js createBuildingMaterial), and no `aSheet`: a flat colour.
export function goldBarGeometry({ l = BAR.l, h = BAR.h, w = BAR.w, top = BAR.top, hex = GOLD, glint = GLINT } = {}) {
  const g = new THREE.BoxGeometry(l, h, w);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * top); p.setZ(i, p.getZ(i) * top); }
  }
  g.translate(0, h / 2, 0);
  g.deleteAttribute('uv');
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; emi[i] = glint; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  return flat;
}

// Where each of the GOLD_BARS bars stands, as [x, y, z] of the middle of its base, in the
// building's own frame (its open end towards +z). A stepped pyramid of five courses,
// 5x8 + 4x7 + 3x6 + 2x5 + 1x4 = 100, stacked against the back wall - the far end of a
// trench silo is where the heap is, and the near end is where whoever is loading stands.
//
// Numbered from the bottom course up, and within a course from the back to the front, so
// that the first `n` are the pile with `100 - n` taken off it: the top goes first, and a
// course half gone keeps its back rows, which is the side nobody is reaching from.
export const PILE_PITCH = { x: 0.28, z: 0.145 };
export const PILE_Z = -0.55;        // the middle of the heap, behind the middle of the plot
export function pileSlots() {
  const out = [];
  for (let k = 0; k < 5; k++) {
    const nx = 5 - k, nz = 8 - k;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        out.push([(i - (nx - 1) / 2) * PILE_PITCH.x, k * BAR.h, PILE_Z + (j - (nz - 1) / 2) * PILE_PITCH.z]);
      }
    }
  }
  return out;
}

// Three batches of gold, a shade apart, so the heap reads as a heap of bars rather than as
// one yellow block with lines ruled on it. Picked per slot by arithmetic, not at random:
// every page draws the same pile.
const BATCHES = [1, 0.9, 1.08];

// Hang the pile on a building's group. `at` is where the heap's floor is in that group's
// frame (buildings.js publishes it as `animated.goldpile`). Returns the handle main.js
// keeps: `setBars(n)` shows the first n, clamped to the pile.
export function attachGoldPile(group, at, material) {
  const geo = goldBarGeometry();
  const mesh = new THREE.InstancedMesh(geo, material, GOLD_BARS);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const tint = new THREE.Color();
  pileSlots().forEach(([x, y, z], i) => {
    // A few degrees of slew per bar, the same few on every page, so the stack looks
    // stacked by hand.
    const slew = (((i * 37) % 11) - 5) * 0.012;
    m.makeRotationY(slew).setPosition(at[0] + x, at[1] + y, at[2] + z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, tint.setScalar(BATCHES[(i * 7) % BATCHES.length]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  const handle = {
    mesh,
    bars: GOLD_BARS,
    setBars(n) {
      const bars = Math.max(0, Math.min(GOLD_BARS, Math.round(Number.isFinite(n) ? n : GOLD_BARS)));
      handle.bars = bars;
      mesh.count = bars;
      // Nothing left is nothing drawn: an empty pit costs no draw call for its gold.
      mesh.visible = bars > 0;
    },
    dispose() {
      group.remove(mesh);
      geo.dispose();
      mesh.dispose?.();
    },
  };
  return handle;
}
