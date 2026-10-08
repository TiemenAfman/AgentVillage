// The galleon's guns as drawn (Plans/kanonnen.md): the keeper's cannon (scripts/build-cannon.py,
// web/js/cannon-mesh.js) in two parts - a carriage that traverses and a barrel laid on its
// trunnions - and the one sum that puts a point of either where it is for a given laying. boat.js
// welds both guns into the hull's one geometry and moves their corners with `layPoint` when a gun is
// turned, the way it pulls the oars (`row`), so a ship with two guns is still one draw call; the
// muzzle a ball leaves from and the way it leaves are the same sum (`muzzleOf`), so a shot cannot
// come out of anywhere but the bore that is drawn.
//
// Everything here is in the hull's own frame: +z her bow, y above her waterline (where her geometry
// has its origin: boat.js drops the bake by SHIP_DRAUGHT), and a gun's spec is shared/crafts.mjs's
// a `kind: 'cannon'` of `CRAFTS.galleon.mounts` with its `y` above DECK_Y like every deck there.
import { mesh } from './buildings.js';
import * as models from './models.js';
import { DECK_Y } from 'shared/hull.mjs';
import { GUN_PITCH_REST, BALL_SPEED } from 'shared/cannon.mjs';

export const CARRIAGE = 'cannon carriage';
export const BARREL = 'cannon barrel';

// The two parts as geometries (around their own origins, as baked), where the barrel's origin - the
// trunnion axis - stands on the carriage, the muzzle's mouth from the trunnions, and the elevation the
// model was made at. Null when the set is not there (a checkout from before it).
let shape;
export function cannonShape() {
  if (shape !== undefined) return shape;
  if (!models.has(CARRIAGE) || !models.has(BARREL)) return (shape = null);
  const pin = models.part(BARREL).at.slice();
  const anchor = models.anchorsOf('cannon').muzzle;
  const mouth = [anchor[0] - pin[0], anchor[1] - pin[1], anchor[2] - pin[2]];
  // The bore's elevation as modelled: from the trunnions to the mouth (9.5 degrees).
  const rest = Math.atan2(mouth[1], mouth[2]);
  // The vent (touch hole) the fuse burns in: on top of the breech, a little ahead of its back end -
  // the highest point of the barrel between 3 and 8 cm in front of the cascabel, in the barrel's own
  // frame (around the trunnions).
  const p = models.part(BARREL).positions;
  let back = Infinity;
  for (let i = 2; i < p.length; i += 3) back = Math.min(back, p[i]);
  let vent = [0, 0, back + 0.05];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] > back + 0.03 && p[i + 2] < back + 0.08 && Math.abs(p[i]) < 0.02 && p[i + 1] > vent[1]) vent = [0, p[i + 1], p[i + 2]];
  }
  return (shape = { pin, mouth, rest, vent, length: Math.hypot(mouth[0], mouth[1], mouth[2]) });
}
export const carriageGeometry = () => mesh(CARRIAGE);
export const barrelGeometry = () => mesh(BARREL);

// A gun's laying: [traverse, elevation] (shared/cannon.mjs clampLay), and `kick` how far the whole
// gun has run back on its trucks after a shot.
export const restLay = () => [0, GUN_PITCH_REST];

// One point of a part, `p` around the part's own origin (as baked), to the hull's frame: the barrel
// turned about its trunnions by how far the laying is off the model's own elevation, stood on the
// carriage, the lot run back by `kick`, turned to the gun's heading plus its traverse and put on the
// deck. `barrel` says which part `p` belongs to.
export function layPoint(spec, lay, kick, barrel, px, py, pz, out = [0, 0, 0]) {
  const s = cannonShape();
  let x = px, y = py, z = pz;
  if (barrel) {
    // About x: up is a smaller angle off +z, so the turn is the negative of the change in elevation.
    const a = -(lay[1] - s.rest);
    const c = Math.cos(a), sn = Math.sin(a);
    const ny = y * c - z * sn, nz = y * sn + z * c;
    x += s.pin[0]; y = ny + s.pin[1]; z = nz + s.pin[2];
  }
  z -= kick;
  const yaw = spec.yaw + lay[0];
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  out[0] = spec.x + x * c + z * sn;
  out[1] = DECK_Y + spec.y + y;
  out[2] = spec.z - x * sn + z * c;
  return out;
}

// The muzzle's mouth and the way a ball leaves it, in the hull's frame: `at` the mouth, `dir` a unit
// vector down the bore.
export function muzzleOf(spec, lay, kick = 0) {
  const s = cannonShape();
  const back = s.mouth;
  const at = layPoint(spec, lay, kick, true, back[0], back[1], back[2]);
  // A unit further down the bore than the mouth, as modelled (the bore lies at the model's own
  // elevation), turned the same way: the difference is the way the ball leaves.
  const ahead = layPoint(spec, lay, kick, true, back[0], back[1] + Math.sin(s.rest), back[2] + Math.cos(s.rest));
  const dir = [ahead[0] - at[0], ahead[1] - at[1], ahead[2] - at[2]];
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  return { at, dir: [dir[0] / n, dir[1] / n, dir[2] / n] };
}

// A ball's velocity out of that muzzle, in the world: `toWorld(dir)` turns a hull-frame direction
// into the world's (the hull's heading and her swell), so the ball goes where the drawn bore points.
export const shotVelocity = (dirWorld, speed = BALL_SPEED) => dirWorld.map((d) => d * speed);
