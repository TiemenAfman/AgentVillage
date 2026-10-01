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
// How far the coping stands out over the water, and how far back over the foot it reaches.
const COPE_OUT = 0.06, COPE_IN = 0.32;
const STONE = [0x8f897b, 0x999181];
const COPE = 0xb3ab97;
const TREAD = 0x9d9584;
const PLANK = 0xb07a4a, PLANK_B = 0xa1744e, PILE = 0x5a3c28;   // the boardwalk set's own oak and piles
// A finger jetty's planks, along the wall: this far in from either side of its cell.
const FINGER_IN = 0.18;

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
    box(f.along, f.along + 1, top, top + COPING, f.face + sign * COPE_OUT, f.face + land * COPE_IN, COPE);
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
    const a0 = fg.along + FINGER_IN, a1 = fg.along + 1 - FINGER_IN;
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

// The finger jetties and the coping as walk mode stands on them (web/js/walk.js `surfaces`). The
// coping is a kerb along the top of the wall, COPING proud of the quay: `quayKade(...).height`
// says the quay's level over the whole foot, and the feet stood that far in the stone. It stays
// out of that answer because the sea's settlers read it too, and nothing they walk runs along the
// edge. The fingers: the planks drawn
// above, one rectangle per jetty in the terrain's own frame, at the height of their boards. They
// are dressing to the sea - nothing it walks goes out on them, so they are not in
// `quayKade(...).height` - and they are not ground either, because a diver swims under them and a
// swimmer beside them must meet their edge: so a floor with a lid, like a pier's cells, which it
// could not be as `levels` because a jetty is two thirds of its cell wide. Before this every one
// of them was open water underfoot (Hoogezand: all five).
export function kadeSurfaces(kade, terrain) {
  if (!kade) return [];
  const { half } = terrain;
  const top = kade.level + TOP;
  const out = [];
  const [wx, wz] = kade.water;
  const sign = kade.alongZ ? wx : wz;
  for (const f of kade.foot) {
    const [c0, c1] = [f.face + sign * COPE_OUT, f.face - sign * COPE_IN].sort((a, b) => a - b);
    const [x0, x1, z0, z1] = kade.alongZ ? [c0, c1, f.along, f.along + 1] : [f.along, f.along + 1, c0, c1];
    out.push({ x0: x0 - half, x1: x1 - half, z0: z0 - half, z1: z1 - half, y: top + COPING });
  }
  for (const fg of kade.fingers || []) {
    const cs = fg.cells.map(([gx, gz]) => (kade.alongZ ? gx : gz));
    const a0 = fg.along + FINGER_IN, a1 = fg.along + 1 - FINGER_IN;
    const c0 = Math.min(...cs), c1 = Math.max(...cs) + 1;
    const [x0, x1, z0, z1] = kade.alongZ ? [c0, c1, a0, a1] : [a0, a1, c0, c1];
    out.push({ x0: x0 - half, x1: x1 - half, z0: z0 - half, z1: z1 - half, y: top });
  }
  return out;
}
