// The weather, as it is drawn. The sea decides what the sky is doing (lib/weather.mjs);
// everything here is what that word looks like on this island.
//
// Three rules shape the whole file.
//
// One: the weather never draws anything new. It reaches for what world.js has already
// built - the nine clouds, the sky dome's two colours, the three lights, the haze - and
// multiplies them. The single exception is the precipitation, which has nothing to borrow.
// That is why an overcast afternoon costs no draw calls at all.
//
// Two: everything it writes is written *after* world.js's own `update` has set it from the
// hour, and world.js sets those values with `copy` and `=` rather than accumulating. So a
// multiplier applied here is fresh every frame and can never compound - which is the one
// bug this arrangement could have had, and the reason the order in main.js's frame loop is
// not negotiable: `world.update` first, then this.
//
// Three: clear is exactly the island as it was before any of this existed. Every number in
// LOOK is 1 or 0 at `clear`, hazeRange is a no-op at thickness 1, and the precipitation
// mesh is invisible with `count` 0. A world with no weather in it - no sea, an older sea,
// a sky nobody recognises - is not a degraded island; it is the island.
import * as THREE from 'three';
import { lerp, clamp } from 'shared/rng.mjs';
import { seasonOf } from './world.js';

// The vocabulary, written out again here rather than imported from lib/weather.mjs: the
// browser must never reach into lib/, and the sea must never reach into web/. The two
// copies are joined by the fallback rather than by an import - anything not in this table
// is drawn as `clear` - so the pair cannot drift into an error, only into sunshine.
export const SKIES = ['clear', 'overcast', 'rain', 'fog'];

// What each sky does, as the numbers the frame loop actually multiplies by.
//
//   thick  what becomes of the haze distance main.js worked out. See hazeRange.
//   dark   how much of the sun is taken out, and how far the clouds go from white to slate.
//   drop   how far the cloud layer comes down, in island units (a cell is 4 m).
//   fall   how much precipitation, 0 to 1.
//   grey   how far the sky dome, the haze and the sky-light are drained of their colour.
//
// `fog` is the odd row: it is the thickest haze by a distance and yet barely dims the sun,
// because a sea fog is bright. Dimming it as well produced a scene that read as dusk at
// two in the afternoon, and the hour is the one thing the weather must not be able to lie
// about - there is a clock on the tower.
const LOOK = {
  clear: { thick: 1.00, dark: 0.00, drop: 0, fall: 0.00, grey: 0.00 },
  overcast: { thick: 0.86, dark: 0.50, drop: 7, fall: 0.00, grey: 0.38 },
  rain: { thick: 0.70, dark: 0.66, drop: 10, fall: 1.00, grey: 0.55 },
  fog: { thick: 0.42, dark: 0.22, drop: 4, fall: 0.00, grey: 0.72 },
};
const CLEAR = LOOK.clear;

// How long the sky takes to turn on screen. The sea changes it in one word; snapping from
// sunshine to a downpour between two frames reads as a glitch rather than as weather, and
// eight seconds is about as long as it can take before somebody who alt-tabbed back is sure
// nothing is happening.
const EASE_S = 8;
// Except at the very start. The welcome carrying the sky arrives a second or two after the
// scene is built, which is a turn this page did not miss - it arrived after it - and easing
// it in would tell a joiner the rain had just started when it has been coming down for ten
// minutes. So for the first stretch the sky snaps, and after it every change eases. One
// number rather than a flag per source, because "did this arrive with the welcome" is a
// question the drawing cannot actually answer and the clock can.
const SETTLE_S = 12;

const FAIR_CLOUD = new THREE.Color(0xfbfbf7);
const DARK_CLOUD = new THREE.Color(0x6e7480);

// ---- the one sky over this page --------------------------------------------------
// Module-level, and that is a statement rather than a shortcut: there is one world, one
// sea and one sky, and the page's own weather is not a property of any island in it. It
// also solves the ordering problem for free - the welcome arrives before buildScene has
// finished, so the sky is remembered here and the drawing picks it up whenever it is built,
// including after a reseed throws the whole scene away and makes a new one.
let wanted = { sky: 'clear', seed: 0, since: 0 };
let forced = false;
let live = null;

// What the sea says the sky is doing. Anything unrecognised is clear - see the note on the
// vocabulary above.
export function setSky(w) {
  if (forced) return;
  const sky = w && SKIES.includes(w.sky) ? w.sky : 'clear';
  wanted = { sky, seed: (w && Number(w.seed)) >>> 0, since: (w && Number(w.since)) || 0 };
  if (live) live.want(wanted);
}

// ?sky=rain - stand in one sky and stay in it whatever the sea says afterwards. The
// weather is a shared thing, so without this the only way to look at three of the four is
// to wait out somebody else's afternoon.
export function forceSky(name) {
  forced = false;
  setSky({ sky: name, seed: 0x5eed, since: Date.now() });
  forced = true;
}

// Where the haze has got to, for main.js's applyFogRange. One when there is no weather and
// one when the sky is clear, so the call site is the same either way.
export function haze() { return live ? live.thick() : 1; }

// How far the haze reaches once the weather has had its say, and - the part that carries
// the weight - how far in it is not allowed to come.
//
// applyFogRange in main.js deliberately holds the haze off until past the neighbours: an
// island with no water behind it reads as one that fell off the edge of the world, and the
// note there plus RING in web/js/horizon.js is the long version. Weather multiplies that
// distance, and the floor is what stops a downpour quietly undoing all of it.
//
// The floor is the far side of the outermost island plus 25 units, so the furthest coast in
// the world stays *inside* the haze rather than behind it: hazy, which is the whole point,
// and still there. With nobody else in the world there is no coast to protect and the floor
// is our own island at 2.2 half-widths - far enough that the orbit camera at its usual
// framing keeps the town in front of the wall, near enough that fog is unmistakably fog.
//
// Neither floor can bind at thickness 1: the lone-island far end is 3.4 half-widths and the
// company one is at least `out + 110`, both comfortably past. That is checked rather than
// assumed, in tests/weather.test.mjs, because "clear is the island exactly as it was" is
// the promise the whole file rests on.
export function hazeRange({ near, far, half, out = 0, thick = 1 }) {
  const floor = Math.max(half * 2.2, out > 0 ? out + 25 : 0);
  const f = Math.max(floor, far * thick);
  // The near end comes in with the far one, or the gradient flattens and a foggy day looks
  // like a clear one seen through dirty glass. Capped at four tenths of the far end, which
  // is where the island's own middle starts to go milky - and a cap that never binds while
  // the weather is clear, since near is 1.1 half-widths against a far of 3.4.
  return { near: Math.min(near * thick, f * 0.4), far: f };
}

// Grey is not a colour of its own: it is whatever is there with the life taken out of it.
// A fixed slate would be right at noon and a bright smear across a midnight sky, so this
// desaturates and darkens what the hour has just put in place, whatever that was.
function dull(c, k) {
  if (k <= 0) return;
  const l = c.r * 0.30 + c.g * 0.59 + c.b * 0.11;
  c.setRGB(lerp(c.r, l, k), lerp(c.g, l, k), lerp(c.b, l, k));
  c.multiplyScalar(1 - k * 0.2);
}

// ---- the precipitation ------------------------------------------------------------
// One InstancedMesh, one material, no shadow. Rain and snow are the same mesh with
// different numbers: a second system would be a second draw call and a second thing to
// keep in step with the camera, for a shape that differs only in how fast it falls.
//
// The field is a box that follows the eye, and each drop sits at a fixed world position
// modulo the box - so panning makes the rain flow past you instead of riding along with
// you, which is the difference between weather and a screensaver.
const MAX_DROPS = 1500;
// How big the box is, in island units - a cell is four metres, so this is a little over two
// hundred metres across. It started at 86 by 52 and read as scratches on the lens from the
// orbit camera: the count is what it can afford, so the only way to make rain look like
// rain is to put the same fifteen hundred drops in a smaller room. At 58 across it is three
// times as dense and still wider than the camera can see out of at any framing the island
// is looked at from.
const SPAN = 58;
// And how deep. Shorter than it is wide, and that is the eye-level fix rather than a
// budget: the box is hung above the eye (see `cy` below) so that on foot almost none of it
// is under the ground, where a quarter of the rain was falling invisibly while the other
// three quarters were a hundred metres overhead and a pixel long.
const TALL = 30;

// Rain and snow, as everything that differs between them.
const FALL = {
  // A streak is 12 cm across and five metres long. The width is the number that was got
  // wrong twice: at 22 cm the drops that happen to pass within a few units of the lens
  // project as white pillars the height of the screen, because a box that rides the eye
  // always has some right in front of it. Thin enough and the same near drop reads as the
  // streak it is meant to be, while a far one is still a pixel wide and visible.
  rain: { n: 1500, speed: 26, jitter: 0.25, w: 0.03, h: 1.3, colour: 0xa8c4d8, alpha: 0.55, wind: 6, flutter: 0 },
  // Snow is slower, fatter, brighter and wanders. Fewer of them, because a flake is twenty
  // times the area of a raindrop on screen and the same count reads as a whiteout.
  snow: { n: 900, speed: 3.4, jitter: 0.45, w: 0.19, h: 0.19, colour: 0xfdfdff, alpha: 0.85, wind: 2.2, flutter: 0.55 },
};

// A drop is two quads at right angles. Four triangles instead of two, and in exchange
// nothing has to be turned to face the camera: a billboard is a matrix recomposed per drop
// per frame, and there are fifteen hundred of them.
function dropGeometry() {
  const v = [
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

// Into [-span/2, +span/2]. This is what puts a drop at a fixed world position while its
// box rides the camera: the drop's own coordinate never changes, only which copy of it is
// the one in front of you.
const wrap = (v, span) => v - span * Math.round(v / span);

export function createWeather({ scene, world, camera, onHaze = () => {} } = {}) {
  // What the sky is easing towards, and where it has got to. Five scalars rather than a
  // blend between four whole looks: a crossfade between two skies is these same five
  // numbers meeting in the middle, and doing it this way means adding a sixth sky costs a
  // row in LOOK and nothing else.
  let target = { ...CLEAR };
  const at = { ...CLEAR };
  let name = 'clear';
  let seed = 0;
  let age = 0;
  let toldHaze = 1;

  const geo = dropGeometry();
  const mat = new THREE.MeshBasicMaterial({
    color: FALL.rain.colour,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    // Double-sided AND transparent is two draw calls in three.js unless you say otherwise:
    // it draws the back faces and then the front ones so a transparent shell sorts against
    // itself. Measured on this island before the flag went in - 29 calls clear against 31 in
    // rain, and 12,000 triangles reported for a mesh that has 6,000. A raindrop is an unlit
    // sliver with no inside, so there is nothing for the second pass to get right, and this
    // is the difference between the weather costing one draw call and costing two.
    forceSinglePass: true,
    // Through the haze like everything else, so rain at the far end of the island fades
    // into it instead of hanging in front of a wall of fog.
    fog: true,
  });
  const drops = new THREE.InstancedMesh(geo, mat, MAX_DROPS);
  // The one thing this must not do. A thousand shadow casters is a thousand entries in the
  // shadow pass for marks nobody could see at this map resolution anyway.
  drops.castShadow = false;
  drops.receiveShadow = false;
  // It is parked on the camera, so a bounding sphere taken at boot is meaningless.
  drops.frustumCulled = false;
  drops.renderOrder = 4;
  drops.visible = false;
  drops.count = 0;
  scene.add(drops);

  // Where each drop sits in its box, how fast it personally falls, and its flutter phase.
  // Drawn once: a drop is anonymous, so there is nothing to keep in step and nothing that
  // has to survive the sky turning.
  const bx = new Float32Array(MAX_DROPS);
  const by = new Float32Array(MAX_DROPS);
  const bz = new Float32Array(MAX_DROPS);
  const ph = new Float32Array(MAX_DROPS);
  for (let i = 0; i < MAX_DROPS; i++) {
    bx[i] = (Math.random() - 0.5) * SPAN;
    by[i] = (Math.random() - 0.5) * TALL;
    bz[i] = (Math.random() - 0.5) * SPAN;
    // One draw, doing double duty: the flutter phase, and - as its fractional part - how
    // much faster than the rest this one falls. Rain that all falls at one speed reads as a
    // sheet of wallpaper sliding down the screen.
    ph[i] = Math.random() * 6.283;
  }

  // The rotation and the scale are the same for every drop of a kind, so they are written
  // into the instance array once, when the kind or the wind changes, and the frame loop
  // touches only the three translation slots. Composing a matrix per drop per frame is what
  // fifteen hundred of anything costs; this is three float writes each.
  const basis = new THREE.Matrix4();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  let basisKey = '';
  function setBasis(kind, tilt) {
    const key = `${kind}:${tilt.toFixed(3)}`;
    if (key === basisKey) return;
    basisKey = key;
    const f = FALL[kind];
    tmpE.set(0, 0, tilt);
    basis.makeRotationFromEuler(tmpE).scale(tmpV.set(f.w, f.h, f.w));
    const e = basis.elements;
    const arr = drops.instanceMatrix.array;
    for (let i = 0; i < MAX_DROPS; i++) {
      const o = i * 16;
      for (let k = 0; k < 12; k++) arr[o + k] = e[k];
      arr[o + 15] = 1;
    }
  }

  let t = 0;

  function fall(dt, kind) {
    const f = FALL[kind];
    const amount = at.fall;
    const n = Math.round(f.n * amount);
    drops.count = n;
    drops.visible = n > 0;
    if (!n) return;
    t += dt;

    // Which way it leans, out of the spell's own seed, so one shower differs from the next
    // without the sea having to say anything about it. The streaks are tilted to match: rain
    // falling straight down under a wind that is plainly blowing it sideways is the detail
    // that gives the whole thing away.
    const wx = (((seed & 0xff) / 255) - 0.5) * 2 * f.wind;
    const wz = ((((seed >>> 8) & 0xff) / 255) - 0.5) * 2 * f.wind;
    setBasis(kind, Math.atan2(wx, f.speed));
    mat.color.set(f.colour);
    mat.opacity = f.alpha * amount;

    // The box rides the eye, pushed a third of its width the way the camera is looking -
    // centred exactly on the camera, a third of the drops are behind your head and paid for
    // in full. The forward vector is the camera matrix's third column negated, and it is a
    // frame old here because the controls have not run yet; a frame of lag on where a box of
    // rain is centred is not a thing anybody can see.
    const cx = camera.position.x - camera.matrix.elements[8] * SPAN * 0.33;
    // Hung above the eye rather than centred on it, so that standing on the ground the box
    // reaches from just under your feet to five houses up instead of burying a quarter of
    // the rain in the hillside you are standing on.
    const cy = camera.position.y + TALL * 0.28;
    const cz = camera.position.z - camera.matrix.elements[10] * SPAN * 0.33;

    // Nothing right against the lens. From the sky the whole box hangs around the camera, so
    // all anybody sees of the rain is the handful of drops within a few units of it - and a
    // 1.3-unit streak three units away is a white pole half the screen tall, which is what
    // the overview showed: poles standing out of the island. A drop inside this radius is
    // parked far below the box. It grows with height: 1.5 on foot, where rain all round you
    // is the point, and 14 in the sky, measured - at 8, from an overview camera 45 up, the
    // nearest streaks were still a quarter of the screen tall and six pixels wide. At 14 a
    // streak is two pixels by a hundred, which reads as rain, and it is 11% of the box.
    const near = clamp(camera.position.y * 0.25, 1.5, 14);
    const near2 = near * near;
    const px = camera.position.x, py = camera.position.y, pz = camera.position.z;
    const arr = drops.instanceMatrix.array;
    for (let i = 0; i < n; i++) {
      const fell = t * f.speed * (1 + (ph[i] % 1) * f.jitter);
      let x = bx[i] + wx * t;
      let z = bz[i] + wz * t;
      if (f.flutter) {
        x += f.flutter * Math.sin(t * 1.3 + ph[i]);
        z += f.flutter * Math.cos(t * 0.9 + ph[i] * 1.7);
      }
      const o = i * 16;
      const qx = cx + wrap(x - cx, SPAN), qy = cy + wrap(by[i] - fell - cy, TALL), qz = cz + wrap(z - cz, SPAN);
      const dx = qx - px, dy = qy - py, dz = qz - pz;
      arr[o + 12] = qx;
      arr[o + 13] = dx * dx + dy * dy + dz * dz < near2 ? qy - 1e4 : qy;
      arr[o + 14] = qz;
    }
    drops.instanceMatrix.needsUpdate = true;
  }

  // ---- the frame ------------------------------------------------------------------
  function update(dt, month) {
    // Ease towards the sky the sea last named - or snap, while the page is still arriving.
    age += dt;
    const k = age < SETTLE_S ? 1 : clamp(dt / EASE_S, 0, 1);
    for (const key of Object.keys(at)) at[key] = lerp(at[key], target[key], k);

    // The haze. main.js is still the only thing that decides a fog distance - this only
    // hands it a multiplier and asks it to decide again - so there is one place that knows
    // about the neighbours, the ring and the zoom, not two.
    if (Math.abs(at.thick - toldHaze) > 0.004) { toldHaze = at.thick; onHaze(); }

    if (!world) return;

    // The clouds: darker and lower, and never a second cloud layer. The whole mesh drops by
    // one number rather than each cloud's own drift being rewritten, which keeps their x
    // and z exactly where world.js put them - they cast shadows from a fixed box on purpose,
    // and a cloud shadow that slid as you panned would be worse than no cloud at all.
    if (world.clouds) {
      world.clouds.position.y = -at.drop;
      world.clouds.material.color.copy(FAIR_CLOUD).lerp(DARK_CLOUD, at.dark);
    }

    // The light. world.js has already set all three from the hour; these are multipliers on
    // top and cannot compound. The sun goes out of an overcast day and the flat light comes
    // up to meet it - a grey afternoon is flatter than a sunny one, not darker.
    if (world.key) world.key.intensity *= 1 - at.dark * 0.7;
    if (world.hemi) {
      world.hemi.intensity *= 1 - at.dark * 0.15;
      dull(world.hemi.color, at.grey);
    }
    if (world.ambient) world.ambient.intensity *= 1 + at.dark * 0.35;

    // The dome and the haze it fades into. Both are drained of colour rather than painted
    // slate, so this is as right at nine in the evening as it is at noon. The stars go with
    // it: you cannot see them through cloud, and leaving them lit under an overcast sky was
    // the first thing that looked wrong.
    const u = world.sky && world.sky.material && world.sky.material.uniforms;
    if (u) {
      dull(u.uTop.value, at.grey);
      dull(u.uHor.value, at.grey * 0.8);
      u.uStars.value *= 1 - at.grey;
    }
    if (scene.fog) dull(scene.fog.color, at.grey * 0.7);

    // And what is coming down. In winter the same system falls as snow - one field, one
    // mesh, one material; the season only changes the numbers it is stepped with.
    if (at.fall > 0.002) fall(dt, seasonOf(month) === 'winter' ? 'snow' : 'rain');
    else { drops.visible = false; drops.count = 0; }
  }

  const it = {
    update,
    thick: () => at.thick,
    // What the sea last said. Kept as the target rather than applied, so the easing above
    // is the only thing that ever moves the numbers.
    want(w) {
      name = LOOK[w.sky] ? w.sky : 'clear';
      target = LOOK[name];
      seed = w.seed >>> 0;
    },
    // What the sea last said, for the console and for anyone adding a line to the HUD.
    sky: () => name,
    dispose() {
      scene.remove(drops);
      geo.dispose();
      mat.dispose();
      drops.dispose();
      // Only if it is still the page's sky. A reseed builds the next one before it throws
      // this one away, and clearing the module's pointer then would leave the new drawing
      // unreachable to setSky and the island stuck in whatever it was raining when the
      // island was reseeded.
      if (live === it) live = null;
    },
  };
  it.want(wanted);
  live = it;
  return it;
}
