import * as THREE from 'three';
import { buildScaffoldGeometry } from './buildings.js';

const scaffoldGeo = buildScaffoldGeometry();

// A builder's frame stands around the walls and on the step, not around the step: the
// bounding box it used to be sized from already had the doorstep in it, so the frame came
// out a full 0.26 wider again than the widest stone on the plot - 1.97 across on a 3-wide
// plot - and the poles of a house still in the steigers went straight through the sheds in
// its own yard, which is what the complaint was about. Sizing it to the walkable
// rectangles instead puts it where a scaffold goes, inside the porch it stands on.
export function addScaffold(rec, buildingMat) {
  if (rec.scaffold) return;
  const m = new THREE.Mesh(scaffoldGeo, buildingMat);
  const b = rec.built.bbox;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  // `walls` rather than `solids`: since a house puts a cart and a woodpile out in its own
  // yard, the rectangles walk mode blocks on reach most of the way to the plot edge, and
  // a frame round all of them would be back to standing in the neighbours - which is the
  // complaint this function already carries a paragraph about.
  for (const r of rec.built.walls || rec.built.solids) {
    x0 = Math.min(x0, r.x - r.hx); x1 = Math.max(x1, r.x + r.hx);
    z0 = Math.min(z0, r.z - r.hz); z1 = Math.max(z1, r.z + r.hz);
  }
  const walls = Number.isFinite(x0) ? { x: x1 - x0, z: z1 - z0 } : { x: b.max.x - b.min.x, z: b.max.z - b.min.z };
  // Room for the builders to stand, as a share of what is being built rather than a flat
  // 0.26 all round. That number is a fifth of a house and most of an apprentice's shed,
  // and it put a frame half again as wide as the hut inside it: three sheds in one yard
  // went back to touching through their own scaffolding while the huts had grass between
  // them. A house 1.24 across still gets its full 0.26.
  const room = (v) => { const w = Math.max(0.3, v); return w + Math.min(0.26, w * 0.21); };
  m.scale.set(room(walls.x), Math.max(0.6, rec.built.height + 0.2), room(walls.z));
  m.castShadow = true;
  rec.group.add(m);
  rec.scaffold = m;
}
