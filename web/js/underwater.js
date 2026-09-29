// What being under the sea looks like, decided by the CAMERA and not by the body.
//
// A diver in first person and a diver in third person are the same case: what matters is
// whether the lens is below the surface, because that is what the picture is of. A body
// treading water with its head under and a camera hung two units behind it and half a unit
// above the waves is not underwater, and a camera that has been wheeled down beside a
// swimmer is. Every input here is the camera's height against the water's, and nothing reads
// walk.js.
//
// The shape of the file follows web/js/weather.js, because it has the same problem and the
// same answer. world.js writes the lights, the fog colour and the sky fresh every frame, so
// whatever is multiplied on top of them *after* `world.update` and `weather.update` cannot
// compound - and it is nothing at all when the camera is above the water: every write here is
// behind `amount > 0`, and a frame spent above the sea is one comparison. So the order in
// main.js's frame is not negotiable either: it runs last, right before the render, once
// every branch of the frame has put the camera where it will be drawn from.
//
// What is NOT fresh every frame, and so has to be put back by hand, is the fog's range:
// world.js gives the fog its colour each frame, but `near` and `far` are main.js's
// (applyFogRange), which sets them only when something changed. So they are stashed on the
// way in and restored exactly on the way out, the way the planner does with the haze
// (main.js enterPlan / leftPlan) - and the stash re-reads whatever applyFogRange wrote in the
// meantime, or a slider moved under water would be undone on the way up.
//
// The pure half is exported and takes no scene: `underwaterOf`, `stepUnderwater`, `fogFor` and
// `lightFactor` are what tests/underwater.test.mjs holds. The rest is glue.
import * as THREE from 'three';
import { clamp, lerp } from 'shared/rng.mjs';

// ---- when the lens is under --------------------------------------------------------------
// Depth is `surfaceY - cameraY`, so positive is under. The swell is +-0.09 and slow (its
// fastest term goes round every 5.7 s), so it never flickers a camera that is holding still;
// what can is a swimmer's bob or a camera being eased through the surface, which crosses it
// a few times in a row. So going under needs a hair of depth and coming back up needs a
// larger hair of height: the surface has to be *clearly* left before the sea is put back.
export const ENTER_DEPTH = 0.02;
export const EXIT_DEPTH = -0.06;

// How fast the look follows: a time constant, so 95% of the way in three of them - 0.15 s.
// The geometry (the sky going, the surface changing sides) does not wait for it; it follows
// the boolean, because a sea that is drawn wrong for a tenth of a second is a flash, and a
// fog that arrives over a tenth of a second is a blink of the eyes.
export const EASE_S = 0.05;

// A camera can only be under if it is this low, whatever the water is doing: the highest
// crest is 0.09 and the enter margin sits on top of it. Above this the frame does not even
// ask where the surface is (`update` takes thunks for exactly that reason).
export const PROBE_Y = 0.25;

/**
 * Whether the lens is under the surface: 1 or 0, with a margin either side of it depending on
 * which side it was on (`was`). Never under over land - `overWater` is false where the ground
 * is above the sea, and a camera inside a hillside is not under anything.
 */
export function underwaterOf({ cameraY, surfaceY = 0, overWater = true, was = false }) {
  if (!overWater) return 0;
  const depth = surfaceY - cameraY;
  return depth > (was ? EXIT_DEPTH : ENTER_DEPTH) ? 1 : 0;
}

/**
 * One step of the smoothed state: `{ amount, under }` in, the same out (plus `target`).
 * `under` is the boolean with its hysteresis and is what decides what is drawn; `amount` is the
 * eased 0..1 that fades the fog, the light, the veil and the sound in and out. Pure, so a test
 * can walk a camera through the surface frame by frame.
 */
export function stepUnderwater(prev, { dt, cameraY, surfaceY = 0, overWater = true }) {
  const target = underwaterOf({ cameraY, surfaceY, overWater, was: prev.under });
  let amount = prev.amount + (target - prev.amount) * (1 - Math.exp(-Math.max(0, dt) / EASE_S));
  // An exponential never arrives; the last percent is where the sea would go on being
  // "a little bit on" for seconds, and every frame of it is a write.
  if (Math.abs(target - amount) < 0.01) amount = target;
  return { amount, under: target === 1, target };
}

// ---- the haze ------------------------------------------------------------------------------
// Where it starts, how far it reaches at the surface and at the deepest a diver goes, and how
// deep that is. 60 units is 240 m, which is a great deal further than water is clear but this
// is a toy sea in daylight, and what is under is worth seeing. At 3.5 - the deepest trench
// (Plans/onderwater-zwemmen.md) - it is 25.
export const FOG_NEAR = 0.5;
export const FOG_FAR_TOP = 60;
export const FOG_FAR_DEEP = 25;
export const FOG_DEEP_AT = 3.5;

// What the water is coloured, as it lands on screen (sRGB, 0..1): a clear turquoise at the
// surface going to a green-black at the bottom of a trench. Written as sRGB on purpose - the
// fog colour is converted for every material on the way out (three's refreshFogUniforms), so
// this is the number you would read off a screenshot.
const SURFACE = { r: 0.114, g: 0.502, b: 0.569 };
const DEEP = { r: 0.031, g: 0.184, b: 0.239 };
// How much of that is left at midnight. Not black: the sea is lit by a sky, and even a moon's
// worth is enough to see a hand by.
const NIGHT_LEFT = 0.16;

/**
 * The fog a diver at `depth` sees at `night` (0..1), as `{ color: {r,g,b}, near, far }`.
 * `baseFog` is what would be standing above water, `{ near, far }`: the underwater haze is
 * never further out than it. That is the whole argument for leaving Object and NPC Distance
 * alone (main.js fogCeiling, record-cull.js) - a house is only ever cut where the fog has
 * already closed over it, and the fog under water closes nearer than the fog over it, so
 * anything cut is already in full murk. Holding the far end under `baseFog.far` here turns
 * that from a fact about today's numbers into a property of the function.
 */
export function fogFor(depth, night = 0, baseFog = null) {
  const d = clamp(depth / FOG_DEEP_AT, 0, 1);
  const dark = lerp(1, NIGHT_LEFT, clamp(night, 0, 1));
  const color = {
    r: lerp(SURFACE.r, DEEP.r, d) * dark,
    g: lerp(SURFACE.g, DEEP.g, d) * dark,
    b: lerp(SURFACE.b, DEEP.b, d) * dark,
  };
  let far = lerp(FOG_FAR_TOP, FOG_FAR_DEEP, d);
  let near = FOG_NEAR;
  if (baseFog && baseFog.far > 0) far = Math.min(far, baseFog.far);
  if (baseFog && baseFog.near >= 0) near = Math.min(near, baseFog.near);
  near = Math.min(near, far * 0.8);
  return { color, near, far };
}

// How much of the sun's light gets down: the Beer-Lambert of a shallow sea, e^(-0.18 d). 0.53
// at the bottom of a trench, and 1 at the surface, which is what makes the effect continuous
// with the world above it.
export const LIGHT_K = 0.18;
export function lightFactor(depth) {
  return Math.exp(-LIGHT_K * Math.max(0, depth));
}

// The veil over the picture. Written on the canvas' own layer and never as a CSS filter on
// #stage: vitals.js already writes a blur there for the beer (setHaze), and two writers on
// one property would each undo the other.
export const OVERLAY_MAX = 0.35;

// The light and the water's colour on the lights, as they land (sRGB): the sun through a
// few metres of green water, and the sky-light off the bottom.
const KEY_TINT = { r: 0.45, g: 0.85, b: 0.9 };
const HEMI_TINT = { r: 0.25, g: 0.7, b: 0.8 };
const GROUND_TINT = { r: 0.08, g: 0.3, b: 0.36 };

const call = (v) => (typeof v === 'function' ? v() : v);

/**
 * `world` is createWorld's return (world.js): the lights, `setUnderwater` and `state.night`.
 * `weather` (optional) is createWeather's, for the rain box, which it shows or hides itself
 * every frame and which therefore has to be hidden here after it has had its say.
 * `overlay` is the `#underwater` element, `sound` anything with `setUnderwater(amount)`, and
 * `onExit` is what puts the ordinary haze back (main.js applyFogRange).
 */
export function createUnderwater({
  scene, camera, world, weather = null, overlay = null, sound = null, onExit = () => {},
} = {}) {
  let s = { amount: 0, under: false };
  let depth = 0;

  // The ordinary haze, stashed while the sea's stands in for it. `wrote` is what was put in
  // the fog last, so that a range somebody else has written since is recognised as theirs.
  // `fogRef` is which Fog it was: a reseed replaces the scene's fog with a new one, and the
  // numbers of the old one are nobody's to put back in it.
  let stash = null, wrote = null, fogRef = null;
  let background = null, ours = false;
  const bg = new THREE.Color();
  const scratch = new THREE.Color();
  let toldOverlay = 0, toldSound = 0;

  function restoreFog() {
    const fog = fogRef;
    if (fog && scene.fog === fog && stash && wrote && fog.near === wrote.near && fog.far === wrote.far) {
      fog.near = stash.near;
      fog.far = stash.far;
    }
    const had = !!stash;
    stash = wrote = fogRef = null;
    // The colour needs nothing: world.update writes it fresh. The range is put back exactly
    // as it was, and asked for again for good measure - this is what the planner does on its
    // way out too, and the second call costs nothing when there is nothing to change.
    if (had) onExit();
  }

  function fogStep(amount) {
    const fog = scene.fog;
    if (!fog) return;
    if (!stash || fogRef !== fog || !wrote || fog.near !== wrote.near || fog.far !== wrote.far) {
      stash = { near: fog.near, far: fog.far };
      fogRef = fog;
    }
    const night = world && world.state ? world.state.night || 0 : 0;
    const uw = fogFor(depth, night, stash);
    fog.near = lerp(stash.near, uw.near, amount);
    fog.far = lerp(stash.far, uw.far, amount);
    wrote = { near: fog.near, far: fog.far };
    scratch.setRGB(uw.color.r, uw.color.g, uw.color.b, THREE.SRGBColorSpace);
    fog.color.lerp(scratch, amount);
  }

  function lightStep(amount) {
    const f = lerp(1, lightFactor(depth), amount);
    const { key, hemi, ambient } = world;
    if (key) {
      key.intensity *= f;
      scratch.setRGB(KEY_TINT.r, KEY_TINT.g, KEY_TINT.b, THREE.SRGBColorSpace);
      key.color.lerp(scratch, 0.45 * amount);
    }
    if (hemi) {
      hemi.intensity *= f;
      scratch.setRGB(HEMI_TINT.r, HEMI_TINT.g, HEMI_TINT.b, THREE.SRGBColorSpace);
      hemi.color.lerp(scratch, 0.5 * amount);
      scratch.setRGB(GROUND_TINT.r, GROUND_TINT.g, GROUND_TINT.b, THREE.SRGBColorSpace);
      hemi.groundColor.lerp(scratch, 0.6 * amount);
    }
    // The ambient light's colour is a constant world.js never rewrites, so it is only ever
    // dimmed, never tinted: a tint written there would stay.
    if (ambient) ambient.intensity *= f;
  }

  // With the sky gone there is nothing behind whatever the sea does not cover - a ray that
  // looks down and finds no bed goes to the clear colour, which is black. The murk it should
  // be is the fog's own colour, so the background is the fog, taken after it has been blended.
  function backgroundStep(fog) {
    if (!ours) { background = scene.background; ours = true; }
    if (fog) { bg.copy(fog.color); scene.background = bg; }
  }
  function backgroundBack() {
    if (!ours) return;
    if (scene.background === bg) scene.background = background;
    background = null;
    ours = false;
  }

  function veil(amount) {
    if (!overlay) return;
    if (Math.abs(amount - toldOverlay) < 0.004 && (amount > 0) === (toldOverlay > 0)) return;
    toldOverlay = amount;
    overlay.hidden = amount <= 0;
    overlay.style.opacity = String(Math.round(amount * OVERLAY_MAX * 1000) / 1000);
  }

  function hear(amount) {
    if (!sound || !sound.setUnderwater) return;
    if (Math.abs(amount - toldSound) < 0.005 && (amount > 0) === (toldSound > 0)) return;
    toldSound = amount;
    sound.setUnderwater(amount);
  }

  function update(dt, { surfaceY = 0, overWater = false } = {}) {
    const cameraY = camera.position.y;
    // Asked for only when it can matter: a thunk is not evaluated for a camera that is up in
    // the air, which is nearly every frame of nearly every session. The sea's own height is
    // a lookup through the archipelago and the surface's a couple of sines.
    const low = cameraY < PROBE_Y || s.under || s.amount > 0;
    const surface = low ? call(surfaceY) : 0;
    const wet = low ? call(overWater) : false;
    const was = s;
    s = stepUnderwater(s, { dt, cameraY, surfaceY: surface, overWater: wet });
    if (!s.under && s.amount === 0) {
      // The tail of the last frame under: everything is put back once, and after that this
      // whole function is the four lines above.
      if (was.under || was.amount > 0) finish();
      return;
    }
    depth = Math.max(0, surface - cameraY);

    world.setUnderwater(s.amount, s.under, surface);
    if (s.under) {
      // Set fresh by weather.js every frame, so hidden fresh every frame.
      const rain = weather && weather.precipitation ? weather.precipitation() : null;
      if (rain) rain.visible = false;
    }
    lightStep(s.amount);
    fogStep(s.amount);
    if (s.under) backgroundStep(scene.fog); else backgroundBack();
    veil(s.amount);
    hear(s.amount);
  }

  // Everything back as it was, once.
  function finish() {
    world.setUnderwater(0, false, 0);
    backgroundBack();
    restoreFog();
    veil(0);
    hear(0);
  }

  return {
    update,
    // The eased 0..1, for whatever wants to fade with the sea (sound, the sea-bed's caustics).
    get amount() { return s.amount; },
    // Whether the lens is under the surface right now: the boolean, without the ease.
    get under() { return s.under; },
    // Whether anything of this is in force, tail included.
    get active() { return s.under || s.amount > 0; },
    // How far under, for the shaders that fade with depth: 0 above the water.
    get depth() { return s.under || s.amount > 0 ? depth : 0; },
    // Straight back to the sea as it is above: for the planner (whose fog it must not stash
    // as the ordinary one), a room, a reseed. Not eased.
    reset() {
      s = { amount: 0, under: false };
      finish();
    },
    dispose() {
      s = { amount: 0, under: false };
      finish();
    },
  };
}
