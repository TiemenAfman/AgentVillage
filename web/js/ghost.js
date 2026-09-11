// The thing in your hand, before it is a thing on the island.
//
// A ghost is a spec nobody has agreed to yet: no id, no record, nothing on the server.
// It follows where you aim, turns and stretches under the wheel, and goes red when it
// would not fit. Clicking posts it to /api/build and the island takes it from there -
// the server broadcasts, every open page refetches, and the real thing grows out of the
// ground half a second later. Nothing is drawn locally on success, on purpose: what you
// end up looking at came back from the island, like everybody else's copy.
//
// It also does the opposite. Demolish mode aims the same ray at the props that are
// already standing and takes one away.
//
// ---------------------------------------------------------------------------------
// Why the listeners are on `window` with { capture: true }
//
// OrbitControls and walk mode both listen on the canvas, in the bubble phase. A capture
// listener on window runs before either of them, so while something is in your hand this
// file can stop an event dead: the wheel turns the ghost instead of zooming the camera,
// a click puts the thing down instead of selecting a building, and Escape gives the ghost
// back instead of throwing you out of walk mode.
//
// What it deliberately does NOT swallow is everything else - w, a, s, d, shift, space.
// You keep walking with a ghost in your hand, which is what makes "two steps left, then
// put it down" work. That is also why walk mode is never paused while holding; only the
// menu pauses it.
import * as THREE from 'three';
import { propGeometry, propLift, propFootprint, propReach } from './props.js';
import { wheelsFor } from 'shared/shapes.mjs';

// How far you can reach on foot. From the sky there is no limit - you put it where you
// are looking - and this is the one place the two modes differ.
const REACH = 10;

// Anything shallower than this is ground you can stand on. The same figure walk.js uses
// to decide you are wading rather than walking.
const DRY = 0.06;

// Steeper than this and a thing would stand on its own edge. Beds refuse at 1.1 and
// buildings at 0.6; a tree on a hillside is fine, a bench on a cliff is not.
const STEEP = 1.4;

// One notch of the wheel. A twenty-fourth of a turn is 7.5 degrees, which is fine enough
// to line a fence up with a wall and coarse enough to get there in a few flicks.
const TURN = Math.PI / 24;
const SNAP = Math.PI / 4;      // with alt held, for a bridge you want square to the bank

// The bounds lib/props.mjs clamps to. Matched here so the ghost never shows a size the
// island would quietly change on the way in.
const SCALE_MIN = 0.15, SCALE_MAX = 6;
const LEN_MAX = 30;
// What a length may not go below, per shape - the same floors the builders in props.js
// apply with their own Math.max, so the ghost cannot show a bridge shorter than one.
const LEN_MIN = { bridge: 2, fence: 1, panel: 0.6 };
const LEN_START = { bridge: 6, fence: 4, panel: 1.5 };

// Translucent, and lit rather than flat so the form still reads. depthWrite off keeps it
// from carving a hole in whatever is behind it. Two materials, swapped on the fit result,
// so nothing is allocated per frame.
function ghostMaterial(hex) {
  return new THREE.MeshStandardMaterial({
    color: hex, transparent: true, opacity: 0.42, depthWrite: false,
    flatShading: true, roughness: 0.9, metalness: 0,
  });
}

export function createGhost({
  scene, camera, terrain, dom, groundMesh, propsGroup,
  mode = () => 'orbit', player = () => null, blockers = () => [],
  hud = () => {}, toast = () => {}, onOpenMenu = () => {},
}) {
  const OK = ghostMaterial(0x8fe0a8);
  const BAD = ghostMaterial(0xe0574a);
  const TAKE = new THREE.MeshBasicMaterial({ color: 0xe0574a, transparent: true, opacity: 0.3, depthWrite: false });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const at = new THREE.Vector3();

  let spec = null;          // what is in your hand, or null
  let taking = false;       // demolish mode
  let mesh = null;          // the ghost itself
  let geoKey = '';          // what the current geometry was built from
  let fits = null;          // null while it fits, a sentence when it does not
  let target = null;        // in demolish mode: the id under the cursor
  let hovering = false;     // the pointer is over the island at all
  let down = null;          // where a press started, for telling a click from a drag

  // Red overlays for demolish mode, pooled. The geometry is already in memory and shared
  // with the real prop, so this is a handful of cheap extra draws while the mode is on.
  const marks = [];

  function busy() { return !!spec || taking; }

  // ------------------------------------------------------------------ aiming
  // One ray against the ground mesh. That mesh spans the whole grid including the cells
  // below sea level - the river bed and the sea floor are real triangles under the water
  // plane - so this answers over land and over water alike, on a hillside, exactly under
  // the cursor. It is what lets walking and the sky share one code path.
  function aim() {
    // Pointer-locked there is no cursor, so the only thing that can work is a crosshair
    // straight out of the eye.
    if (document.pointerLockElement === dom) ndc.set(0, 0);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(groundMesh, false)[0];
    if (!hit) { hovering = false; return false; }
    hovering = true;
    at.copy(hit.point);

    // On foot you can only reach so far. Clamp along the line rather than refusing, so
    // the ghost stays in sight and follows the cursor instead of vanishing.
    const feet = player();
    if (feet) {
      const dx = at.x - feet.x, dz = at.z - feet.z;
      const d = Math.hypot(dx, dz);
      if (d > REACH) {
        at.x = feet.x + (dx / d) * REACH;
        at.z = feet.z + (dz / d) * REACH;
      }
    }
    return true;
  }

  // ------------------------------------------------------- would it stand there
  // A sentence, or null when it is fine. Modelled on whyNot() in lib/garden.mjs, which is
  // this island's idiom for a refusal - and like that one it is courtesy, not security:
  // the server checks none of this, so the command line can still put a tree in the sea.
  function whyNot(p) {
    if (Math.abs(p.x) > 60 || Math.abs(p.z) > 60) return 'that is off the map';
    const gx = Math.floor(p.x + terrain.half), gz = Math.floor(p.z + terrain.half);
    if (!terrain.inGrid(gx, gz)) return 'that is off the island';

    if (p.kind === 'bridge') {
      // A bridge is the one thing that belongs over water - but it has to land somewhere.
      // The same two samples bridgeDeck() takes to decide how high the deck rides.
      const len = Math.max(2, p.length || 6);
      const s = Math.sin(p.rot || 0) * (len / 2), c = Math.cos(p.rot || 0) * (len / 2);
      const a = terrain.worldHeight(p.x + s, p.z + c);
      const b = terrain.worldHeight(p.x - s, p.z - c);
      if (a < DRY && b < DRY) return 'a bridge needs a bank to land on';
    } else {
      if (terrain.worldHeight(p.x, p.z) < DRY) return 'that would be in the water';
      if (terrain.slope(gx, gz) > STEEP) return 'too steep to stand on';
    }

    // Against the very rectangles the walker will bump into later. Not walk.roomFor():
    // that takes a single radius, while a fence is a line of them, and its blocker list
    // is only refreshed while you are on foot - so from the sky it would be stale.
    const mine = propFootprint(p);
    for (const a of mine) {
      for (const b of blockers()) {
        if (Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.z - b.z) < a.hz + b.hz) {
          return 'there is no room for that here';
        }
      }
    }

    const feet = player();
    if (feet && Math.hypot(feet.x - p.x, feet.z - p.z) < propReach(p) + 0.35) return 'you are standing there';
    return null;
  }

  // ------------------------------------------------------------------ the ghost
  function shape() {
    // Only what the geometry actually reads. A bridge redrawn on every rotation would
    // rebuild a hundred geometries a second for nothing.
    const key = `${spec.kind}:${spec.length || 0}:${spec.label ? 1 : 0}`;
    if (!mesh) {
      mesh = new THREE.Mesh(propGeometry(spec), OK);
      mesh.castShadow = false;              // a hologram with a shadow reads as already built
      mesh.receiveShadow = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      geoKey = key;
      return;
    }
    if (key !== geoKey) {
      mesh.geometry.dispose();
      mesh.geometry = propGeometry(spec);
      geoKey = key;
    }
  }

  function clearGhost() {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
    geoKey = '';
  }

  function clearMarks() {
    for (const m of marks) scene.remove(m);
    marks.length = 0;
  }

  // The ghost is placed before the renderer runs too, and it is aimed at the ground mesh
  // - which never moves, so last frame's matrix is this frame's. Only the props need the
  // refresh above, because one can appear mid-frame.

  // ------------------------------------------------------------------ the wheel
  function onWheel(e) {
    if (!busy()) return;
    // Chrome reads ctrl+wheel as "zoom the page", and a trackpad pinch arrives as exactly
    // that, so the gesture has to be swallowed even when there is nothing to work: in
    // demolish mode the page would zoom out from under the thing you were aiming at.
    e.preventDefault();
    // The camera keeps the wheel while you are only pointing at something, though - there
    // is no shape to turn, and pulling the view back is how you find the next fence post.
    if (!spec) return;
    e.stopPropagation();
    const sign = Math.sign(e.deltaY) || 1;
    const w = wheelsFor(spec.kind);
    const what = e.shiftKey ? w.shift : e.ctrlKey || e.metaKey ? w.ctrl : w.wheel;
    if (!what) return;                      // this shape has nothing under that modifier
    if (what === 'rot') {
      spec.rot = (spec.rot || 0) - sign * (e.altKey ? SNAP : TURN);
      if (e.altKey) spec.rot = Math.round(spec.rot / SNAP) * SNAP;
    } else if (what === 'scale') {
      spec.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, (spec.scale || 1) * Math.exp(-sign * 0.08)));
    } else if (what === 'length') {
      const min = LEN_MIN[spec.kind] || 0.5;
      spec.length = Math.min(LEN_MAX, Math.max(min, (spec.length || min) - sign * 0.5));
    }
  }

  // ------------------------------------------------------------------ putting it down
  async function put() {
    if (!spec || fits) return;
    const w = wheelsFor(spec.kind);
    const body = { kind: spec.kind, x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100, by: 'a hand' };
    // Only the numbers this shape actually reads, so a bench never carries a length and a
    // tree never carries a rotation that means nothing.
    if (w.wheel === 'rot' || w.ctrl === 'rot') body.rot = Math.round((spec.rot || 0) * 1000) / 1000;
    if (w.wheel === 'scale' || w.ctrl === 'scale') body.scale = Math.round((spec.scale || 1) * 1000) / 1000;
    if (w.shift === 'length') body.length = Math.round((spec.length || 0) * 100) / 100;
    if (spec.face) body.face = spec.face;

    try {
      const r = await fetch('/api/build', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const text = await r.text();
      let answer = null;
      try { answer = text ? JSON.parse(text) : null; } catch { /* not JSON, which is itself the news */ }
      if (!r.ok) throw new Error((answer && answer.error) || `the island said ${r.status}`);
      // Nothing to draw. The server broadcasts 'props', every open page refetches, and
      // the thing grows out of the ground - ours included, like everybody else's.
    } catch (e) {
      toast(String(e.message || e));
    }
  }

  async function take(id) {
    try {
      const r = await fetch('/api/unbuild', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error(`the island said ${r.status}`);
    } catch (e) {
      toast(String(e.message || e));
    }
  }

  // ------------------------------------------------------------------ the listeners
  function onMove(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }

  function onDown(e) {
    if (!busy() || e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY };
  }

  function onUp(e) {
    if (!busy() || e.button !== 0) { down = null; return; }
    const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 0;
    down = null;
    if (moved > 5) return;                  // that was a drag to look around, not a press
    e.stopPropagation();                    // and never also pick a building behind it
    if (taking) { if (target) take(target); return; }
    put();
  }

  function onKey(e) {
    if (!busy()) return;
    // Alt snaps the turn to a notch, but on Windows a tap of Alt on its own sends Chrome
    // to its menu bar and the next key lands there instead of on the island. Holding it
    // over the wheel still works; it just never reaches the browser as a bare press.
    if (e.key === 'Alt') { e.preventDefault(); return; }   // keyup too: that is the half Chrome acts on
    if (e.type !== 'keydown') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); drop(); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (taking) { if (target) take(target); } else put(); }
  }

  // Right-clicking while you aim is a slip of the hand, not a request for Chrome's menu.
  function onContext(e) {
    if (!busy()) return;
    e.preventDefault();
    e.stopPropagation();
  }

  addEventListener('pointermove', onMove, { capture: true });
  addEventListener('pointerdown', onDown, { capture: true });
  addEventListener('pointerup', onUp, { capture: true });
  addEventListener('wheel', onWheel, { capture: true, passive: false });
  addEventListener('keydown', onKey, { capture: true });
  addEventListener('keyup', onKey, { capture: true });
  addEventListener('contextmenu', onContext, { capture: true });

  // ------------------------------------------------------------------ every frame
  function update() {
    if (!busy()) return;
    const got = aim();

    if (taking) {
      updateTaking(got);
      return;
    }

    shape();
    if (!got) {
      mesh.visible = false;
      fits = 'nothing to build on there';
      say();
      return;
    }
    mesh.visible = true;
    spec.x = at.x;
    spec.z = at.z;
    fits = whyNot(spec);
    mesh.material = fits ? BAD : OK;
    mesh.position.set(spec.x, propLift(spec, terrain), spec.z);
    mesh.rotation.y = spec.rot || 0;
    mesh.scale.setScalar(spec.scale || 1);
    say();
  }

  function updateTaking(got) {
    target = null;
    const feet = player();
    // This runs before the renderer does, so the matrices are last frame's - which is a
    // frame too old for a prop that has only just arrived over the wire.
    propsGroup.updateMatrixWorld(true);
    // Against the props themselves rather than a distance test, so a fence post as thin
    // as a finger is as easy to hit as a well. Every prop mesh already carries its id.
    const hit = got ? ray.intersectObjects(propsGroup.children, false)[0] : null;

    // The overlays are pooled and re-pointed, never rebuilt: this runs every frame the
    // mode is on, and a fresh mesh per prop per frame is a lot of rubbish for a tint.
    let n = 0;
    for (const m of propsGroup.children) {
      if (n >= marks.length && marks.length >= 24) break;
      if (feet && Math.hypot(m.position.x - feet.x, m.position.z - feet.z) > REACH) continue;
      let mark = marks[n];
      if (!mark) {
        mark = new THREE.Mesh(m.geometry, TAKE);
        mark.renderOrder = 3;
        marks.push(mark);
        scene.add(mark);
      }
      mark.geometry = m.geometry;   // shared with the real prop; never disposed here
      mark.position.copy(m.position);
      mark.rotation.copy(m.rotation);
      mark.scale.copy(m.scale).multiplyScalar(1.04);
      mark.visible = true;
      n++;
    }
    for (let i = n; i < marks.length; i++) marks[i].visible = false;

    if (hit && (!feet || Math.hypot(hit.object.position.x - feet.x, hit.object.position.z - feet.z) <= REACH)) {
      target = hit.object.userData.id || null;
    }
    say();
  }

  // What the strip along the bottom says. Goes through the UI's own once() cache, so
  // calling it every frame writes nothing when nothing has changed.
  function say() {
    if (taking) {
      hud({ taking: true, target, ready: !!target });
      return;
    }
    hud({ kind: spec.kind, spec, why: fits, wheels: wheelsFor(spec.kind) });
  }

  // ------------------------------------------------------------------ the handle
  function takeShape({ kind, face }) {
    taking = false;
    clearMarks();
    spec = {
      kind,
      x: 0, z: 0,
      rot: 0,
      scale: 1,
      length: LEN_START[kind] || 0,
      face: face || null,
    };
    fits = null;
    update();
  }

  function demolish() {
    spec = null;
    clearGhost();
    taking = true;
    target = null;
    say();
  }

  function drop() {
    spec = null;
    taking = false;
    target = null;
    clearGhost();
    clearMarks();
    hud(null);
  }

  function dispose() {
    drop();
    removeEventListener('pointermove', onMove, { capture: true });
    removeEventListener('pointerdown', onDown, { capture: true });
    removeEventListener('pointerup', onUp, { capture: true });
    removeEventListener('wheel', onWheel, { capture: true });
    removeEventListener('keydown', onKey, { capture: true });
    removeEventListener('keyup', onKey, { capture: true });
    removeEventListener('contextmenu', onContext, { capture: true });
    OK.dispose();
    BAD.dispose();
    TAKE.dispose();
  }

  return { take: takeShape, demolish, drop, holding: busy, update, dispose };
}
