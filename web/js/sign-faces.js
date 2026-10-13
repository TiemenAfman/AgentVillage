// How big is a yard sign's lettered face on the screen, and is it worth drawing?
//
// Every yard sign's frame is an instance in the island's batch, but its lettered face is a
// mesh of its own - a plane with a canvas of its own (nameplate.js) - so each is a draw call.
// From above on Hoogezand that was 520-575 of the ~990 calls in the colour pass, 6.5 ms a frame
// measured by switching them all off (Plans/cpu-van-boven.md), for faces a few pixels wide that
// nobody can read. So a face is drawn only where it is legible: full from FACE_FULL pixels wide,
// gone under FACE_GONE, faded through its material's opacity in between
// (Plans/naambord-gezichten-op-afstand.md). From far off the same cream spot stays on the board,
// because the frame's shape in the batch carries a cream patch of the face's size just behind it.
//
// In pixels, not units: a bigger window or another screen keeps the same legibility. No DOM and
// no three.js here, so tests/sign-faces.test.mjs asks it without a renderer.

export const FACE_FULL = 24;
export const FACE_GONE = 16;

// The width in CSS pixels of something `width` wide at `dist` from a camera with a vertical
// field of view of `fovDeg` degrees, on a viewport `viewH` pixels high. Measured on the
// distance, not the depth, like the fog (radial-fog.js): a face at the corner of the frame is
// no more legible than one at its middle.
export function screenWidth(width, dist, fovDeg, viewH) {
  if (!(dist > 0)) return Infinity;
  return width * viewH / (2 * Math.tan(fovDeg * Math.PI / 360) * dist);
}

// 1 drawn solid, 0 not drawn at all, a straight ramp in between.
export function faceOpacity(px, full = FACE_FULL, gone = FACE_GONE) {
  if (px >= full) return 1;
  if (px <= gone) return 0;
  return (px - gone) / (full - gone);
}

// Show or fade one face: `face` is the mesh and `mat` its own material. Writes only on a change,
// so ~400 signs standing still cost a distance and a division each, and nothing is written. The
// face's `visible` is this function's alone: the planner, the Signs setting and the Object
// Distance cut work on the sign's group and the record's layers, never on the face.
export function showFace(face, mat, opacity) {
  const on = opacity > 0;
  if (face.visible !== on) face.visible = on;
  if (on && mat.opacity !== opacity) mat.opacity = opacity;
}
