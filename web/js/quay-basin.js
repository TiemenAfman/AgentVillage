import * as THREE from 'three';
import { STAIR_LEN, STAIR_DEPTH, stairHeight } from 'shared/quay-basin.mjs';

// The stone face of the harbour's quay (shared/quay-basin.mjs `createQuayKade`), and the stairs
// down it. The quay itself is ground (`works.kade`): what the heightfield cannot draw is the
// wall, because the cell in front of the quay - its foot - is the mean of four corners and slopes
// from the harbour's bed up to the quay. So each foot cell gets a block of masonry standing on
// the bed with its face on the water side, a coping stone along the top, and every flight of
// stairs a block per tread in front of the face. One merged geometry, one material, one draw
// call for the whole quay however long it runs - the old basin was two meshes and a shader
// discard. Island-local, so a neighbour's quay is drawn from its own bundle the same way.
const BED = -0.9;                 // under the deepest the harbour is dug (-0.55) and its bank
const TOP = 0.01;                 // the masonry stands this proud of the quay's ground (feet: level)
const COPING = 0.05;
const STONE = [0x8f897b, 0x999181];
const COPE = 0xb3ab97;
const TREAD = 0x9d9584;
const PLANK = 0xb07a4a, PLANK_B = 0xa1744e, PILE = 0x5a3c28;   // the boardwalk set's own oak and piles

export function buildQuayKade(kade, terrain) {
  const group = new THREE.Group();
  group.name = 'quay-kade';
  if (!kade || !kade.foot.length) return group;
  const { half } = terrain;
  const positions = [], colours = [];
  // A box from (a0, y0, c0) to (a1, y1, c1) in the wall's own axes - `a` along the wall, `c`
  // across it - turned into x and z for the way the wall runs.
  const put = (a, y, c) => (kade.alongZ ? [c - half, y, a - half] : [a - half, y, c - half]);
  const quad = (p, q, r, s, col) => {
    positions.push(...p, ...q, ...r, ...p, ...r, ...s);
    for (let i = 0; i < 6; i++) colours.push(col.r, col.g, col.b);
  };
  const box = (a0, a1, y0, y1, c0, c1, hex) => {
    const col = new THREE.Color(hex);
    const [lo, hi] = c0 < c1 ? [c0, c1] : [c1, c0];
    const v = (a, y, c) => put(a, y, c);
    // Six faces; which winding faces out does not matter to a double-sided material.
    quad(v(a0, y1, lo), v(a1, y1, lo), v(a1, y1, hi), v(a0, y1, hi), col);          // top
    quad(v(a0, y0, lo), v(a1, y0, lo), v(a1, y1, lo), v(a0, y1, lo), col);          // one side across
    quad(v(a0, y0, hi), v(a1, y0, hi), v(a1, y1, hi), v(a0, y1, hi), col);          // the other
    quad(v(a0, y0, lo), v(a0, y0, hi), v(a0, y1, hi), v(a0, y1, lo), col);          // ends
    quad(v(a1, y0, lo), v(a1, y0, hi), v(a1, y1, hi), v(a1, y1, lo), col);
  };
  const [wx, wz] = kade.water;
  const sign = kade.alongZ ? wx : wz;          // + when the water lies towards + across
  const land = -sign;
  const top = kade.level + TOP;
  for (const f of kade.foot) {
    // The block over the foot cell: from the face back to the quay's own edge.
    box(f.along, f.along + 1, BED, top, f.face, f.face + land, STONE[(f.along + f.across) & 1]);
    // The coping: a little proud of the face, and over the top of it.
    box(f.along, f.along + 1, top, top + COPING, f.face + sign * 0.06, f.face + land * 0.32, COPE);
  }
  for (const s of kade.stairs) {
    // The same treads the feet stand on (stairHeight), one block each.
    for (let i = 0; i < s.steps; i++) {
      const a0 = s.a0 + (i * STAIR_LEN) / s.steps, a1 = s.a0 + ((i + 1) * STAIR_LEN) / s.steps;
      box(a0, a1, BED, stairHeight(s, (i + 0.5) * STAIR_LEN / s.steps), s.face, s.face + sign * STAIR_DEPTH, TREAD);
    }
  }
  // The finger jetties for the boats (shared/quay-basin.mjs `fingers`): a plank deck at the quay's
  // level, a pile each side under every cell and a mooring post at the end. In the wall's own
  // geometry, so they add no draw call.
  for (const fg of kade.fingers || []) {
    const a0 = fg.along + 0.18, a1 = fg.along + 0.82;
    fg.cells.forEach(([gx, gz], n) => {
      const c0 = kade.alongZ ? gx : gz;
      box(a0, a1, top - 0.06, top, c0, c0 + 1, n % 2 ? PLANK : PLANK_B);
      box(a0 + 0.04, a0 + 0.12, BED, top - 0.06, c0 + 0.45, c0 + 0.55, PILE);
      box(a1 - 0.12, a1 - 0.04, BED, top - 0.06, c0 + 0.45, c0 + 0.55, PILE);
    });
    const [ex, ez] = fg.cells[fg.cells.length - 1];
    const ce = kade.alongZ ? ex : ez;
    const far = sign > 0 ? ce + 0.9 : ce + 0.1;
    box(a0 - 0.04, a0 + 0.06, top, top + 0.22, far - 0.05, far + 0.05, PILE);
    box(a1 - 0.06, a1 + 0.04, top, top + 0.22, far - 0.05, far + 0.05, PILE);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
