// The plaque on the treasure statue's plinth: "Treasures found" and the number (Plans/schatkaarten.md).
//
// The bake gives the plinth a blank iron panel and an anchor on it (`civic_treasure` anchor `sign`,
// scripts/build-treasure.py). Lettering is the one thing a merged vertex-colour building cannot
// draw, so it is a lettered plane hung on that anchor, the way web/js/nameplate.js letters a yard
// sign - but not through `createNameplate`. That is a staked board: a leg, a frame two thirds of
// a unit wide and a cream field, made to stand in a garden. On a plinth it would be a stake
// driven into the stone, and its frame would cover the plaque the bake already framed. So this
// draws only the face, in the plaque's own iron and brass, and leaves the frame to the bake.
//
// One plane and one canvas texture per statue, and there is only ever one statue on an island.
// The number is redrawn only when it changes (`setPlaque`), which is once per chest dug up.
import * as THREE from 'three';

// The panel the bake leaves (0.28 x 0.20), less a hair so the lettering never reaches the frame.
const PANEL_W = 0.28;
const PANEL_H = 0.2;
const PX = 512;
const PY = Math.round(PX * PANEL_H / PANEL_W);
// Just proud of the panel's face, which is at the anchor. A gap this small z-fights at distance
// without the polygon offset on the material; with it the lettering wins at every range.
const LIFT = 0.002;

const IRON = '#1d2026';
const BRASS = '#d9b44a';
const BRASS_DIM = '#a98a34';

function paint(g, found) {
  g.fillStyle = IRON;
  g.fillRect(0, 0, PX, PY);
  g.strokeStyle = BRASS_DIM;
  g.lineWidth = 6;
  g.strokeRect(14, 14, PX - 28, PY - 28);
  g.fillStyle = BRASS;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 44px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
  g.fillText('TREASURES FOUND', PX / 2, PY * 0.27);
  // The count is the point of the plaque, so it takes whatever room is left and shrinks only
  // when a big number would not fit across it.
  const text = String(Math.max(0, Math.floor(found) || 0));
  let size = 190;
  for (; size > 40; size -= 6) {
    g.font = `700 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    if (g.measureText(text).width <= PX - 90) break;
  }
  g.fillText(text, PX / 2, PY * 0.63);
}

// `at` is the statue's `sign` anchor (built.anchors.sign): the middle of the panel's face, in the
// building's own frame, front towards +z. The group is the record's, so the plot's rotation is
// already the plaque's.
export function attachPlaque(group, at, found = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = PX;
  canvas.height = PY;
  const g = canvas.getContext('2d');
  paint(g, found);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const material = new THREE.MeshBasicMaterial({ map, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W * 0.96, PANEL_H * 0.96), material);
  mesh.position.set(at[0], at[1], at[2] + LIFT);
  group.add(mesh);
  return { mesh, map, material, g, found: Math.max(0, Math.floor(found) || 0) };
}

// Called when the village arrives, which is every minute or so; returns at once unless the number
// moved.
export function setPlaque(plaque, found) {
  if (!plaque) return;
  const n = Math.max(0, Math.floor(found) || 0);
  if (plaque.found === n) return;
  plaque.found = n;
  paint(plaque.g, n);
  plaque.map.needsUpdate = true;
}

export function disposePlaque(plaque) {
  if (!plaque) return;
  plaque.mesh.geometry.dispose();
  plaque.material.dispose();
  plaque.map.dispose();
}
