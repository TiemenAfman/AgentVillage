// How low the follow camera may hang (walk.js placeCamera). Pure, so a test can hold it.
//
// Over the ground the floor is the ground plus a hand's width: the camera never dips into a
// hill. Over water it used to be the same sum - and the ground under open sea is OPEN_SEA
// (-2.5), so a boat seen from a camera wheeled out and looking up put the camera two units
// under the surface, looking up at the hull through the underside of the sea. So over water
// the floor is the surface plus `WATER_CAM_MIN`: above the swell (0.09 at most) and the
// near plane (0.5), or the surface itself is cut by it.
//
// Not while diving (`state.diving`, set by walk.js when the head is under the surface): there
// the camera belongs under the water, and the floor is the sea bed like anywhere else - and,
// since a camera left above the surface would look down on a diver through a sea that is
// opaque at depth, it is also held UNDER the surface (`applyCeiling`).
//
// `blend` (0..1) is how far the camera has gone over to the diver's rules. walk.js eases it
// over about 0.4 s, or the camera would jump two units the moment the head went under; left
// out it is the old boolean, 1 when `diving` and 0 when not.
export const WATER_CAM_MIN = 0.5;
// How far under the surface a diver's camera stays: clear of the swell and the near plane
// the other way, so the view is of the water and never of its top.
export const WATER_CAM_MAX = 0.25;
const HAND = 0.55;

export function cameraFloor({ ground, waterY = 0, diving = false, blend }) {
  const floor = ground + HAND;
  if (ground >= waterY) return floor;
  const b = blend ?? (diving ? 1 : 0);
  const overWater = Math.max(floor, waterY + WATER_CAM_MIN);
  // The ends are returned as they are, not through the sum: no rounding at 0 and 1.
  if (b <= 0) return overWater;
  if (b >= 1) return floor;
  return overWater + (floor - overWater) * b;
}

// How far over the bed a camera may hang when that is all the water leaves it.
export const BED_CLEAR = 0.12;

// The camera's final height: `cy` with the diver's ceiling on it, eased in by `blend`, and
// `floor` (cameraFloor's answer) under it. Only over water deep enough to have a bed to hang
// above (`ground`): at a beach the ground floor wins, and a ceiling under the surface there would
// be a camera inside the sand.
//
// The floor gives way to the ceiling where the two disagree, down to a hand's width over the
// bed: `floor` is a *ground* floor, a hand and a half over the sand, and over water shallower
// than that it lies above the surface - which put the camera of a diver at the foot of a shelf
// up in the air, looking down at the water from over the shore, with the diver hidden behind a
// sea that is opaque at depth (measured, tests/diving-walk.test.mjs). So it can be no higher than
// the ceiling, unless the bed itself is higher than that, and then BED_CLEAR over it.
export function applyCeiling(cy, { ground, waterY = 0, blend = 0, floor = -Infinity }) {
  if (blend <= 0 || ground >= waterY - WATER_CAM_MAX) return Math.max(cy, floor);
  const ceiling = waterY - WATER_CAM_MAX;
  const eased = cy + (Math.min(cy, ceiling) - cy) * Math.min(1, blend);
  const reach = Math.max(ceiling, ground + BED_CLEAR);
  return Math.max(eased, Math.min(floor, reach));
}
