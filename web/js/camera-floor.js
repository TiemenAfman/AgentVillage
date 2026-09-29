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
// the camera belongs under the water, and the floor is the sea bed like anywhere else.
export const WATER_CAM_MIN = 0.5;
const HAND = 0.55;

export function cameraFloor({ ground, waterY = 0, diving = false }) {
  const floor = ground + HAND;
  if (diving || ground >= waterY) return floor;
  return Math.max(floor, waterY + WATER_CAM_MIN);
}
