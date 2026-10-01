// How the follow camera on foot behaves, per browser (Settings -> This screen -> On foot).
//
// `fixed`: the camera keeps the distance the wheel gave it, always. The boom (walk.js placeCamera,
// Plans/camera-botsing.md) pulled it in to the head for whatever came between it and the body, and
// even looking past rails and crates (solids.js camSeesPast) it still zoomed in at a fountain, a
// noticeboard, a market stall - the keeper: "maak maar een default on setting die zegt camera
// distance always fixed". So fixed is the default and the boom is the choice: the body may be
// behind a wall for a moment, the camera never jumps. A room's own walls (clampCam) and the ground
// under the camera (cameraFloor) still hold either way: those are where the camera is, not how far.
//
// Kept in a module rather than handed to every createWalkMode, because the island and every room
// make their own walk mode, and a module-level cache means walk.js reads it every frame for free.
// localStorage may throw (a private window, a test under Node): then it is the default, for this page.
const KEY = 'promptholm.camera.fixed';

let fixed = null;

export function cameraFixed() {
  if (fixed == null) {
    try { fixed = localStorage.getItem(KEY) !== '0'; } catch { fixed = true; }
  }
  return fixed;
}

export function setCameraFixed(on) {
  fixed = !!on;
  try { if (fixed) localStorage.removeItem(KEY); else localStorage.setItem(KEY, '0'); } catch { /* kept for this page only */ }
  return fixed;
}
