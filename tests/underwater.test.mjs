// Being under the sea: web/js/underwater.js and the half of it that lives in world.js.
//
// Three promises here would break silently, so each is a test rather than a look.
//
//   The lens decides, with a margin. Going under and coming up have different thresholds, or a
//   camera bobbing through the surface flickers the whole sea between two pictures.
//
//   Nothing is left behind. The fog's range is main.js's, set only when something changes, so
//   it is stashed on the way in and put back exactly on the way out - including a range
//   somebody else wrote in the meantime - and the lights, which world.js rewrites every frame,
//   are multiplied and never compounded. A clear sky over a swimmer who has climbed out is the
//   island exactly as it was.
//
//   And the quad that draws the surface from below is a quad, invisible until it is needed,
//   writing its own depth: the reasons are in world.js and the shapes are checked here by
//   reading the source, because there is no GPU in this suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import * as THREE from 'three';
// Dynamic, after the register above: a static import is hoisted over it, and the module
// reaches shared/ through the import map the loader stands in for.
const {
  underwaterOf, stepUnderwater, fogFor, lightFactor, createUnderwater,
  ENTER_DEPTH, EXIT_DEPTH, EASE_S, FOG_NEAR, FOG_FAR_TOP, FOG_FAR_DEEP, FOG_DEEP_AT, OVERLAY_MAX, PROBE_Y,
} = await import('../web/js/underwater.js');

// world.js asks for its texture sheets the moment it loads; the stub tests/weather.test.mjs uses.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { swellAt, SWELL_MAX, WAVE_RATES } = await import('../web/js/world.js');
delete globalThis.document;

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---- when the lens is under ---------------------------------------------------------------

test('a camera is under only below the surface, and only over water', () => {
  assert.equal(underwaterOf({ cameraY: 1.6, surfaceY: 0, overWater: true }), 0);
  assert.equal(underwaterOf({ cameraY: -0.5, surfaceY: 0, overWater: true }), 1);
  // Under the water line of a hillside is inside a hill, not under the sea.
  assert.equal(underwaterOf({ cameraY: -0.5, surfaceY: 0, overWater: false }), 0);
  // The surface is where the swell has it: 0.05 under the mean but above a trough is not under.
  assert.equal(underwaterOf({ cameraY: 0.01, surfaceY: 0.09, overWater: true }), 1);
  assert.equal(underwaterOf({ cameraY: 0.01, surfaceY: -0.09, overWater: true }), 0);
});

test('coming up needs a larger margin than going under (hysteresis)', () => {
  // Just under the enter margin: not yet under; just over it: under.
  assert.equal(underwaterOf({ cameraY: -(ENTER_DEPTH - 0.005), surfaceY: 0 }), 0);
  assert.equal(underwaterOf({ cameraY: -(ENTER_DEPTH + 0.005), surfaceY: 0 }), 1);
  // Once under, a camera 0.03 above the water is still under; 0.09 above is out.
  assert.ok(EXIT_DEPTH < 0 && -EXIT_DEPTH > ENTER_DEPTH);
  assert.equal(underwaterOf({ cameraY: 0.03, surfaceY: 0, was: true }), 1);
  assert.equal(underwaterOf({ cameraY: -EXIT_DEPTH + 0.03, surfaceY: 0, was: true }), 0);
  // And the same camera, not under before, is not under now.
  assert.equal(underwaterOf({ cameraY: 0.03, surfaceY: 0, was: false }), 0);
});

test('a camera wobbling through the surface does not flicker the sea', () => {
  // +-0.03 around the water line, at the frame rate: the swimmer's bob. Started under, it must
  // never come out (the margin is 0.06); started above, it must never go under (0.02 needed on
  // top of the bob).
  let s = { amount: 0, under: true };
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    s = stepUnderwater(s, { dt: 1 / 60, cameraY: 0.03 * Math.sin(i * 0.9), surfaceY: 0 });
    seen.add(s.under);
  }
  assert.deepEqual([...seen], [true], 'a bob inside the margin brought the sea out');
  s = { amount: 0, under: false };
  seen.clear();
  for (let i = 0; i < 200; i++) {
    s = stepUnderwater(s, { dt: 1 / 60, cameraY: 0.015 * Math.sin(i * 0.9), surfaceY: 0 });
    seen.add(s.under);
  }
  assert.deepEqual([...seen], [false], 'a bob inside the margin put the sea on');
});

test('the amount eases in over about 0.15 s and arrives exactly', () => {
  let s = { amount: 0, under: false };
  let t = 0;
  const dt = 1 / 60;
  let at95 = null;
  for (let i = 0; i < 120; i++) {
    s = stepUnderwater(s, { dt, cameraY: -1, surfaceY: 0 });
    t += dt;
    if (at95 === null && s.amount >= 0.95) at95 = t;
    assert.ok(s.amount >= 0 && s.amount <= 1);
  }
  assert.equal(s.amount, 1, 'an exponential never arrives; the last percent has to be snapped');
  assert.ok(at95 > 2 * EASE_S && at95 < 4 * EASE_S, `95% took ${at95} s`);
  // The boolean does not wait for the ease: it is what the meshes follow.
  const first = stepUnderwater({ amount: 0, under: false }, { dt, cameraY: -1, surfaceY: 0 });
  assert.equal(first.under, true);
  assert.ok(first.amount < 0.5);
  // And it goes back down to exactly zero.
  s = { amount: 1, under: true };
  for (let i = 0; i < 120; i++) s = stepUnderwater(s, { dt, cameraY: 2, surfaceY: 0 });
  assert.equal(s.amount, 0);
  assert.equal(s.under, false);
});

// ---- the haze and the light -----------------------------------------------------------------

test('the fog: near 0.5, far 60 at the surface falling to 25 at the deepest', () => {
  const top = fogFor(0, 0);
  assert.equal(top.near, FOG_NEAR);
  assert.equal(top.far, FOG_FAR_TOP);
  const deep = fogFor(FOG_DEEP_AT, 0);
  assert.equal(deep.far, FOG_FAR_DEEP);
  assert.equal(FOG_NEAR, 0.5);
  assert.equal(FOG_FAR_TOP, 60);
  assert.equal(FOG_FAR_DEEP, 25);
  // Linear between, clamped beyond.
  const mid = fogFor(FOG_DEEP_AT / 2, 0);
  assert.ok(Math.abs(mid.far - (FOG_FAR_TOP + FOG_FAR_DEEP) / 2) < 1e-9);
  assert.equal(fogFor(20, 0).far, FOG_FAR_DEEP);
  assert.equal(fogFor(-3, 0).far, FOG_FAR_TOP);
});

test('the water is a teal that darkens with depth and with night', () => {
  const top = fogFor(0, 0).color, deep = fogFor(FOG_DEEP_AT, 0).color, night = fogFor(0, 1).color;
  for (const c of [top, deep, night]) {
    assert.ok(c.b > c.r && c.g > c.r, 'not teal');
    for (const v of [c.r, c.g, c.b]) assert.ok(v >= 0 && v <= 1);
  }
  assert.ok(deep.g < top.g && deep.b < top.b);
  assert.ok(night.g < top.g * 0.3 && night.b < top.b * 0.3);
  // Monotone in depth and in night.
  let prev = Infinity;
  for (let d = 0; d <= 5; d += 0.5) { const g = fogFor(d, 0).color.g; assert.ok(g <= prev); prev = g; }
  prev = Infinity;
  for (let n = 0; n <= 1; n += 0.1) { const g = fogFor(1, n).color.g; assert.ok(g <= prev); prev = g; }
});

test('the sea never hazes further out than the air did', () => {
  // The whole argument for leaving Object and NPC Distance alone (main.js fogCeiling): what
  // record-cull.js takes out of the picture is already in full fog, and this is what makes
  // that true whatever the air's own haze is doing - a fog sky closes it to 40.
  assert.equal(fogFor(0, 0, { near: 5, far: 40 }).far, 40);
  assert.equal(fogFor(0, 0, { near: 5, far: 400 }).far, FOG_FAR_TOP);
  const f = fogFor(0, 0, { near: 0.1, far: 2 });
  assert.ok(f.near <= f.far * 0.8 && f.far === 2);
});

test('the light: full at the surface, e^-0.18d below', () => {
  assert.equal(lightFactor(0), 1);
  assert.equal(lightFactor(-2), 1);
  assert.ok(Math.abs(lightFactor(3.5) - Math.exp(-0.63)) < 1e-12);
  assert.ok(lightFactor(1) > lightFactor(2));
});

// ---- the glue: nothing left behind ------------------------------------------------------------

function fixture() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdcefff, 70, 320);
  const key = new THREE.DirectionalLight(0xfff8ea, 3);
  const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x8f8a60, 0.85);
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  const calls = [];
  const world = {
    key, hemi, ambient, state: { night: 0 },
    setUnderwater: (amount, under, surfaceY) => calls.push([amount, under, surfaceY]),
  };
  // What world.update does every frame, and weather.js after it: fresh values, not multipliers.
  const refresh = () => {
    key.intensity = 3; key.color.set(0xfff8ea);
    hemi.intensity = 0.85; hemi.color.set(0xbfe0ff); hemi.groundColor.set(0x8f8a60);
    ambient.intensity = 0.4;
    scene.fog.color.set(0xdcefff);
  };
  refresh();
  const camera = { position: { y: 5 } };
  const overlay = { hidden: true, style: { opacity: '0' } };
  const heard = [];
  const sound = { setUnderwater: (a) => heard.push(a) };
  const rain = { visible: true };
  const weather = { precipitation: () => rain };
  let exits = 0;
  const uw = createUnderwater({ scene, camera, world, weather, overlay, sound, onExit: () => { exits++; } });
  return { scene, key, hemi, ambient, world, calls, refresh, camera, overlay, heard, rain, uw, exits: () => exits };
}

// Runs the frame the way main.js does: the world writes, then this.
function frames(fx, n, seen = { surfaceY: 0, overWater: true }, dt = 1 / 60) {
  for (let i = 0; i < n; i++) { fx.refresh(); fx.rain.visible = true; fx.uw.update(dt, seen); }
}

test('above the water nothing is touched and nothing is even asked', () => {
  const fx = fixture();
  let asked = 0;
  const seen = { surfaceY: () => { asked++; return 0; }, overWater: () => { asked++; return true; } };
  const before = [fx.key.intensity, fx.hemi.intensity, fx.ambient.intensity, fx.scene.fog.near, fx.scene.fog.far];
  fx.camera.position.y = 1.6;
  frames(fx, 30, seen);
  assert.equal(asked, 0, 'a camera up in the air must not cost a lookup');
  assert.deepEqual([fx.key.intensity, fx.hemi.intensity, fx.ambient.intensity, fx.scene.fog.near, fx.scene.fog.far], before);
  assert.equal(fx.calls.length, 0, 'the world was told about a sea that is not there');
  assert.equal(fx.overlay.hidden, true);
  assert.equal(fx.scene.background, null);
  assert.equal(fx.uw.active, false);
  assert.equal(fx.rain.visible, true);
  // Low enough to matter, it is asked.
  fx.camera.position.y = PROBE_Y - 0.01;
  frames(fx, 1, seen);
  assert.ok(asked > 0);
});

test('under: fog, light, veil, sound, sky - and the lights never compound', () => {
  const fx = fixture();
  fx.camera.position.y = -2;
  frames(fx, 60);
  assert.equal(fx.uw.under, true);
  assert.equal(fx.uw.amount, 1);
  // Fog: the sea's, the far end never past the air's, the colour teal.
  assert.equal(fx.scene.fog.near, FOG_NEAR);
  assert.ok(fx.scene.fog.far < FOG_FAR_TOP && fx.scene.fog.far > FOG_FAR_DEEP);
  const c = fx.scene.fog.color.getRGB({}, THREE.SRGBColorSpace);
  assert.ok(c.b > c.r && c.g > c.r, 'the fog is not teal');
  // Light: exactly the factor of the depth, however many frames ago it began.
  const f = lightFactor(2);
  assert.ok(Math.abs(fx.key.intensity - 3 * f) < 1e-9, `key ${fx.key.intensity}`);
  assert.ok(Math.abs(fx.hemi.intensity - 0.85 * f) < 1e-9);
  assert.ok(Math.abs(fx.ambient.intensity - 0.4 * f) < 1e-9);
  // The veil and the sound.
  assert.equal(fx.overlay.hidden, false);
  assert.equal(Number(fx.overlay.style.opacity), OVERLAY_MAX);
  assert.equal(fx.heard.at(-1), 1);
  // The world was told, with the boolean and where the surface is.
  assert.deepEqual(fx.calls.at(-1), [1, true, 0]);
  // The clear colour is the murk.
  assert.ok(fx.scene.background instanceof THREE.Color);
  assert.deepEqual(fx.scene.background.toArray(), fx.scene.fog.color.toArray());
  // The rain box is hidden after the weather has shown it.
  assert.equal(fx.rain.visible, false);
  // Night: darker.
  fx.world.state.night = 1;
  frames(fx, 2);
  const night = fx.scene.fog.color.getRGB({}, THREE.SRGBColorSpace);
  assert.ok(night.g < c.g * 0.4);
  // A deeper camera: dimmer and closer.
  fx.world.state.night = 0;
  fx.camera.position.y = -3.5;
  frames(fx, 60);
  assert.ok(fx.key.intensity < 3 * f);
  assert.ok(Math.abs(fx.scene.fog.far - FOG_FAR_DEEP) < 1e-6);
});

test('coming up puts everything back exactly - fog range, lights, background, veil, sound', () => {
  const fx = fixture();
  const range = [fx.scene.fog.near, fx.scene.fog.far];
  fx.camera.position.y = -2;
  frames(fx, 60);
  assert.notDeepEqual([fx.scene.fog.near, fx.scene.fog.far], range);
  fx.camera.position.y = 2;
  frames(fx, 60);
  assert.equal(fx.uw.active, false);
  assert.deepEqual([fx.scene.fog.near, fx.scene.fog.far], range, 'the ordinary haze was not restored to the digit');
  assert.equal(fx.scene.background, null);
  assert.equal(fx.overlay.hidden, true);
  assert.equal(fx.heard.at(-1), 0);
  assert.deepEqual(fx.calls.at(-1), [0, false, 0]);
  assert.equal(fx.exits(), 1, 'the ordinary range is asked for once on the way out');
  // The world writes fresh next frame and nobody multiplies it: identity.
  fx.refresh();
  fx.uw.update(1 / 60, { surfaceY: 0, overWater: true });
  assert.equal(fx.key.intensity, 3);
  assert.equal(fx.hemi.intensity, 0.85);
  assert.equal(fx.ambient.intensity, 0.4);
  assert.deepEqual(fx.key.color.toArray(), new THREE.Color(0xfff8ea).toArray());
  assert.deepEqual(fx.hemi.color.toArray(), new THREE.Color(0xbfe0ff).toArray());
  assert.deepEqual(fx.hemi.groundColor.toArray(), new THREE.Color(0x8f8a60).toArray());
});

test('a range applyFogRange wrote while under is the ordinary one when the sea comes out', () => {
  const fx = fixture();
  fx.camera.position.y = -1;
  frames(fx, 30);
  // A slider moved under water: main.js writes a new range.
  fx.scene.fog.near = 55;
  fx.scene.fog.far = 210;
  frames(fx, 3);
  assert.ok(fx.scene.fog.far < 210 && fx.scene.fog.far <= FOG_FAR_TOP, 'the sea did not keep its own');
  fx.camera.position.y = 3;
  frames(fx, 60);
  assert.deepEqual([fx.scene.fog.near, fx.scene.fog.far], [55, 210]);
});

test('reset (the planner) and dispose (a reseed) put it back at once, and leave a new fog alone', () => {
  const fx = fixture();
  const range = [fx.scene.fog.near, fx.scene.fog.far];
  fx.camera.position.y = -1;
  frames(fx, 30);
  fx.uw.reset();
  assert.deepEqual([fx.scene.fog.near, fx.scene.fog.far], range);
  assert.equal(fx.uw.active, false);
  assert.equal(fx.scene.background, null);
  assert.equal(fx.overlay.hidden, true);

  const again = fixture();
  again.camera.position.y = -1;
  frames(again, 30);
  // A reseed: the scene has a new fog by the time the old sea is thrown away.
  const fresh = new THREE.Fog(0x123456, 33, 99);
  again.scene.fog = fresh;
  again.uw.dispose();
  assert.deepEqual([fresh.near, fresh.far], [33, 99], "the old fog's numbers were written into the new one");
});

test('a camera over land is never under, however low', () => {
  const fx = fixture();
  fx.camera.position.y = -1;
  frames(fx, 30, { surfaceY: 0, overWater: false });
  assert.equal(fx.uw.active, false);
  assert.equal(fx.calls.length, 0);
});

// ---- the surface from below: the shapes in the source -------------------------------------------

test('the ceiling is one opaque quad that writes its own depth and is off by default', () => {
  const w = src('web/js/world.js');
  const from = w.indexOf('const ceilingMat');
  const to = w.indexOf('function surfaceAt');
  assert.ok(from > 0 && to > from, 'found the ceiling');
  const block = w.slice(from, to);
  assert.match(block, /transparent: false/);
  assert.match(block, /depthWrite: true/);
  assert.match(block, /gl_FragDepth = /);
  assert.match(block, /renderOrder = -1000/);
  assert.match(block, /ceiling\.visible = false/);
  assert.match(block, /frustumCulled = false/);
  // Rays that never reach the surface belong to the scene.
  assert.match(block, /discard/);
  // The three sea meshes that draw the top of the water are hidden while the lens is under, and
  // the sailing patch's own visibility respects it.
  assert.match(block, /water\.visible = !isUnder/);
  assert.match(block, /ocean\.visible = !isUnder/);
  assert.match(block, /sailWater\.visible = !isUnder && !!nearPlan/);
  assert.match(w, /sailWater\.visible = !!nearPlan && !underNow/);
});

test('the ceiling shares the sea\'s clock, sun and sky by reference', () => {
  const w = src('web/js/world.js');
  const block = w.slice(w.indexOf('Object.assign(ceilingMat.uniforms'), w.indexOf('const ceiling = new'));
  for (const name of ['uTime', 'uSunDir', 'uSunColor', 'uNight']) {
    assert.match(block, new RegExp(`${name}: waterMat\\.uniforms\\.${name}`));
  }
  assert.match(block, /uSkyTop: skyMat\.uniforms\.uTop/);
  assert.match(block, /uSkyHor: skyMat\.uniforms\.uHor/);
});

test('every wave term in the ceiling is one WAVE_LOOP folds without a seam', () => {
  const w = src('web/js/world.js');
  const frag = w.slice(w.indexOf('const ceilingMat'), w.indexOf('const ceiling = new'));
  const rates = [...frag.matchAll(/\bt \* ([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(rates.length >= 4, 'found the ripples');
  for (const r of rates) assert.ok(WAVE_RATES.includes(r), `t * ${r} is not in WAVE_RATES`);
  assert.doesNotMatch(frag, /uTime \* (?!1\.1\b|0\.9\b|1\.3\b)[0-9.]+/);
});

test('swellAt is the water shader\'s vertex term, and never higher than SWELL_MAX', () => {
  const w = src('web/js/world.js');
  const shader = w.slice(w.indexOf('const waterMat'), w.indexOf('const water ='));
  assert.match(shader, /float w1 = sin\(p\.x \* 1\.3 \+ uTime \* 1\.1\);/);
  assert.match(shader, /float w2 = sin\(p\.z \* 1\.7 - uTime \* 0\.9\);/);
  // The lift is capped over dry ground (issue #95, tests/swell-dry-ground.test.mjs); over
  // water, which is all a surface reading asks about, it is this term unchanged.
  assert.match(shader, /float lift = \(0\.05 \* w1 \+ 0\.04 \* w2\) \* aWave;/);
  // The twin, at points where the sines are known.
  assert.equal(Math.abs(swellAt(0, 0, 0)), 0);
  assert.ok(Math.abs(swellAt(Math.PI / 2 / 1.3, Math.PI / 2 / 1.7, 0) - 0.09) < 1e-12);
  // No wave, no swell (a -0 is still nothing).
  assert.equal(Math.abs(swellAt(1, 2, 3, 0)), 0);
  let top = 0;
  for (let i = 0; i < 4000; i++) top = Math.max(top, Math.abs(swellAt(i * 0.37, i * 0.53, i * 0.11)));
  assert.ok(top <= SWELL_MAX + 1e-12 && top > SWELL_MAX * 0.9, `swell peaks at ${top}`);
});

test('the frame runs it last: after the weather and the haze, before the cull and the render', () => {
  const m = src('web/js/main.js');
  const at = m.indexOf('function frame(nowMs)');
  const body = m.slice(at, m.indexOf('function updateLabels()'));
  const sky = body.indexOf('state.sky.update(');
  const haze = body.indexOf('applyFogRange();');
  const uw = body.indexOf('state.underwater.update(dt, underwaterSeen)');
  const cull = body.indexOf('cullRecords();');
  // The one render goes through post.js (bloom in rooms), a plain renderer.render before it.
  const render = body.search(/(renderer|postFx)\.render\(/);
  assert.ok(sky > 0 && haze > sky && uw > haze && cull > uw && render > cull, `order ${[sky, haze, uw, cull, render]}`);
  // Built with the world, thrown away with it, and reset before the planner stashes the haze.
  assert.match(m, /state\.underwater = createUnderwater\(/);
  assert.match(m, /if \(state\.underwater\) state\.underwater\.dispose\(\);/);
  const plan = m.slice(m.indexOf('function enterPlan()'), m.indexOf('function exitPlan()'));
  assert.ok(plan.indexOf('state.underwater.reset()') > 0 && plan.indexOf('state.underwater.reset()') < plan.indexOf('planFog = ['));
  // The sea's camera is asked in the page's frame, over water, and never in the planner or a room.
  assert.match(m, /state\.sea\.height\(camera\.position\.x, camera\.position\.z\) < 0/);
});

test('the veil is a layer of its own: never a filter on the canvas', () => {
  const html = src('web/index.html');
  assert.match(html, /<div id="underwater" hidden><\/div>/);
  assert.ok(html.indexOf('id="stage"') < html.indexOf('id="underwater"'), 'it must follow the canvas in the document');
  const css = src('web/css/ui.css');
  assert.match(css, /#underwater \{[^}]*pointer-events: none/);
  assert.doesNotMatch(src('web/js/underwater.js'), /\.filter\b|style\.filter/);
});

test('the sound goes through one lowpass on the master bus, and the weather hands over its rain', () => {
  const s = src('web/js/sound.js');
  assert.match(s, /listener\.setFilter\(muffle\)/);
  assert.match(s, /setUnderwater,/);
  assert.match(src('web/js/weather.js'), /precipitation: \(\) => drops/);
});
