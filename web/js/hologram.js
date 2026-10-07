// The island as a hologram on the desktop (`?hologram`, opened by hologram/main.cjs in a
// transparent, frameless window): only the island itself floats there. No sky, no ocean, no
// clouds, no haze, no HUD - the canvas is cleared to nothing, so whatever is behind the window
// shows through around the coast.
//
// What is left of the sea is the shallows: the water's own shader is taught to fade out over
// deep water (its depth varying, `vDepth`), so a coast keeps its rim of light water and its
// rivers and the open sea is gone. The ground under that is cut off below CUT by a clipping
// plane, or the flat seabed of the whole grid would show as a square plate under the island.
//
// Nothing here edits world.js (a copy from AgentVillage): the water's fragment shader is
// patched by string on the material this page already has, and every frame what world.js shows
// again by itself (the sun and the moon, the clouds) is put away after world.update.
import * as THREE from 'three';

export const HOLOGRAM = new URLSearchParams(location.search).has('hologram');

const CUT = -0.6;          // the ground below this is cut away (the sea's depth is -2.5)
const DEEP = [-1.4, -0.7]; // the water fades out over this range of depth, deepest first
const IDLE_S = 6;          // quiet this long and the island turns by itself
const FIT_EL = 0.75;       // radians over the horizon the island is first looked at from

export function createHologram({ renderer, scene, controls, camera, dom }) {
  if (!HOLOGRAM) return null;
  document.body.classList.add('hologram');
  renderer.setClearColor(0x000000, 0);
  renderer.setClearAlpha(0);
  renderer.localClippingEnabled = false;
  renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUT)];

  // Turn and zoom only: the island stays in the middle of its window, and the right button is
  // the window's own (hologram/main.cjs moves it).
  controls.enablePan = false;
  controls.mouseButtons.RIGHT = null;
  controls.autoRotateSpeed = 0.35;
  let idle = 0;
  const poke = () => { idle = 0; controls.autoRotate = false; };
  for (const type of ['pointerdown', 'wheel']) dom.addEventListener(type, poke, { passive: true });
  // The right button drags the window itself, in the hologram's own window only (window.holo, from
  // hologram/preload.cjs); the main process follows the cursor on the screen.
  let dragging = false;
  dom.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || !window.holo) return;
    dragging = true;
    dom.setPointerCapture(e.pointerId);
    window.holo.dragStart();
  });
  dom.addEventListener('pointermove', () => { if (dragging) window.holo.dragMove(); });
  const end = () => { if (!dragging) return; dragging = false; window.holo.dragEnd(); };
  dom.addEventListener('pointerup', end);
  dom.addEventListener('pointercancel', end);

  // Whether the camera director wanders off by itself (the tray's "Regisseur", hologram/main.cjs):
  // in the URL at load, and live from the window after that. Without it the island turns slowly.
  let wander = !/[?&]wander=0(?:&|$)/.test(location.search);
  if (window.holo && window.holo.onWander) window.holo.onWander((on) => { wander = !!on; if (!on) controls.autoRotate = false; });
  let world = null;
  let fit = 0;            // the distance the whole island fits the window from
  let keep = new Set();
  const patched = new WeakSet();

  // The water's fragment shader, faded out over deep water.
  function patchWater(mat) {
    if (!mat || patched.has(mat) || !mat.fragmentShader) return;
    const line = 'gl_FragColor = vec4(col, opacity * vBlend);';
    if (!mat.fragmentShader.includes(line)) { console.warn('hologram: the water shader changed; the sea stays whole'); return; }
    mat.fragmentShader = mat.fragmentShader.replace(line,
      `float holo = smoothstep(${DEEP[0].toFixed(2)}, ${DEEP[1].toFixed(2)}, vDepth);\n`
      + `        if (holo < 0.01) discard;\n`
      + `        gl_FragColor = vec4(col, opacity * vBlend * holo);`);
    mat.needsUpdate = true;
    patched.add(mat);
  }

  // The distance the whole island fits the window from, whichever of its two sides is the narrower.
  // Again on every resize: full screen is wide where the window was square.
  let radius = 0;
  function refit() {
    if (!radius) return;
    const v = (camera.fov * Math.PI) / 360;
    const h = Math.atan(Math.tan(v) * camera.aspect);
    fit = (radius * 1.08) / Math.sin(Math.min(v, h));
    controls.maxDistance = Math.max(controls.maxDistance, fit * 1.6);
  }

  // F11 asks the window for the whole screen and back (hologram/main.cjs).
  addEventListener('keydown', (e) => {
    if (e.key !== 'F11' || !window.holo || !window.holo.toggleFull) return;
    e.preventDefault();
    window.holo.toggleFull();
  });

  return {
    // The window changed size: the island is framed again at the same angle, whole.
    resize() {
      if (!radius) return;
      const before = fit;
      refit();
      const off = camera.position.clone().sub(controls.target);
      if (before && off.length() > 0) off.multiplyScalar(fit / before);
      camera.position.copy(controls.target).add(off);
      controls.update();
    },
    // After every buildScene: a new world has new meshes.
    setWorld(w, terrain) {
      world = w;
      // The whole of the land, not the grid: a grown island sits in the middle of a grid with sea
      // round it. Its radius from the middle, and the distance that fits it into the window
      // whichever of the two sides is the narrower, seen from FIT_EL over the horizon.
      radius = 8;
      for (const [gx, gz] of terrain.landCells || []) {
        const [x, z] = terrain.cellWorld(gx, gz);
        radius = Math.max(radius, Math.hypot(x, z));
      }
      refit();
      controls.target.set(0, 1, 0);
      camera.position.set(0, 1 + Math.sin(FIT_EL) * fit, Math.cos(FIT_EL) * fit);
      controls.update();
      keep = new Set();
      // What stays: the branch the ground hangs in (the whole landscape), the water patches, the fireflies.
      let n = w.ground;
      while (n && n.parent && n.parent !== w.group) n = n.parent;
      if (n) keep.add(n);
      for (const c of w.group.children) {
        const u = c.material && c.material.uniforms;
        if (c.isMesh && u && u.uNear && c.geometry && c.geometry.type !== 'CircleGeometry') { keep.add(c); patchWater(c.material); }
      }
      if (w.fireflies) keep.add(w.fireflies);
    },
    // Whether something on the water at this depth stands in the shallows that are still drawn;
    // a ship on the rede out past them would float in the air.
    afloat: (depth) => depth > DEEP[0] + 0.3,
    wanders: () => wander,
    // The director's view of the whole island between two shots: the same framing setWorld made.
    overview: () => (fit ? { target: [0, 1, 0], dist: fit, el: FIT_EL } : null),
    // Every frame, after world.update and the weather: whatever they showed again goes.
    frame(dt) {
      if (world) for (const c of world.group.children) if (!keep.has(c)) c.visible = false;
      scene.background = null;
      // The haze is pushed out of reach rather than taken away: world.js tints scene.fog every frame.
      if (scene.fog) { scene.fog.near = 1e5; scene.fog.far = 2e5; }
      // applyCameraRange sets the leash again after every fleet sync; the whole island stays in reach.
      if (fit) controls.maxDistance = Math.max(controls.maxDistance, fit * 1.6);
      idle += dt;
      if (idle > IDLE_S && !wander) controls.autoRotate = true;
    },
  };
}
