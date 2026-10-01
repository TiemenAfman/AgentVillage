// The four graphics sliders: what they remember, and that they reach anything at all.
//
// The second half exists because of how this feature first shipped. Every slider moved its
// own label and nothing else: onGraphicsSetting was handed to createNet, which never calls
// it, and createUI - the only thing that does - never got it. Nothing failed, and there is no
// renderer under Node to notice, so this reads main.js's source for the one wiring that has
// to be right.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GRAPHICS_DEFAULTS, GRAPHICS_LIMITS, GRAPHICS_TIERS, GRAPHICS_KEY, clampGraphic, loadGraphics, saveGraphic,
  forgetGraphics, graphicsTier, hazeOpening, HAZE_OPEN_AT, OBJECT_RATIO, objectDistanceOf,
  GRAPHICS_CHOICES, hdWanted,
} from '../web/js/graphics-settings.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('three kinds of machine, each with four defaults inside their sliders', () => {
  assert.deepEqual(Object.keys(GRAPHICS_TIERS).sort(), ['full', 'modest', 'phone']);
  for (const [tier, d] of Object.entries(GRAPHICS_TIERS)) {
    assert.deepEqual(Object.keys(d).sort(), [...Object.keys(GRAPHICS_LIMITS), ...Object.keys(GRAPHICS_CHOICES)].sort(), tier);
    // The word settings start on one of their words (detail: 'auto' everywhere), the rest inside
    // their sliders.
    for (const [k, words] of Object.entries(GRAPHICS_CHOICES)) assert.ok(words.includes(d[k]), `${tier}.${k}`);
    for (const [k, v] of Object.entries(d)) {
      if (GRAPHICS_CHOICES[k]) continue;
      const { min, max } = GRAPHICS_LIMITS[k];
      assert.ok(v >= min && v <= max, `${tier}.${k} starts at ${v}, outside ${min}..${max}`);
    }
  }
  // Lighter as the machine gets smaller, every one of the four.
  for (const k of Object.keys(GRAPHICS_LIMITS)) {
    assert.ok(GRAPHICS_TIERS.modest[k] < GRAPHICS_TIERS.full[k], `modest ${k}`);
    assert.ok(GRAPHICS_TIERS.phone[k] < GRAPHICS_TIERS.modest[k], `phone ${k}`);
  }
  assert.equal(GRAPHICS_DEFAULTS, GRAPHICS_TIERS.full);
  assert.equal(graphicsTier({}), 'full');
  assert.equal(graphicsTier({ modest: true }), 'modest');
  // The app is modest too, and more so.
  assert.equal(graphicsTier({ modest: true, phone: true }), 'phone');
});

test('nothing remembered is the defaults, and a broken store is too', () => {
  for (const d of Object.values(GRAPHICS_TIERS)) assert.deepEqual(loadGraphics(d, memory()), d);
  assert.deepEqual(loadGraphics(GRAPHICS_DEFAULTS, memory({ [GRAPHICS_KEY]: '{not json' })), GRAPHICS_DEFAULTS);
  assert.deepEqual(loadGraphics(GRAPHICS_DEFAULTS, memory({ [GRAPHICS_KEY]: '7' })), GRAPHICS_DEFAULTS);
  assert.deepEqual(loadGraphics(GRAPHICS_DEFAULTS, memory({ [GRAPHICS_KEY]: '[1,2]' })), GRAPHICS_DEFAULTS);
  // A private window whose storage throws on every read, and no storage at all.
  assert.deepEqual(loadGraphics(GRAPHICS_DEFAULTS, { getItem() { throw new Error('denied'); } }), GRAPHICS_DEFAULTS);
  assert.deepEqual(loadGraphics(GRAPHICS_DEFAULTS, null), GRAPHICS_DEFAULTS);
});

test('only what somebody moved is kept; the rest follows the machine', () => {
  const s = memory();
  saveGraphic('shadowDistance', 120, s);
  // Stored: that one choice, not all four.
  assert.deepEqual(JSON.parse(s.m.get(GRAPHICS_KEY)), { shadowDistance: 120 });
  // So a modest machine keeps its own View Distance under it, and a full one its own.
  assert.equal(loadGraphics(GRAPHICS_TIERS.modest, s).viewDistance, GRAPHICS_TIERS.modest.viewDistance);
  assert.equal(loadGraphics(GRAPHICS_TIERS.full, s).viewDistance, GRAPHICS_TIERS.full.viewDistance);
  assert.equal(loadGraphics(GRAPHICS_TIERS.modest, s).shadowDistance, 120);
  saveGraphic('viewDistance', 250, s);
  assert.deepEqual(JSON.parse(s.m.get(GRAPHICS_KEY)), { shadowDistance: 120, viewDistance: 250 });
  // One bad field keeps the other three, and a remembered number outside its slider is clamped.
  const kept = loadGraphics(GRAPHICS_DEFAULTS, memory({ [GRAPHICS_KEY]: JSON.stringify({ viewDistance: 'far', npcDistance: 120, shadowDistance: 99999 }) }));
  assert.equal(kept.viewDistance, GRAPHICS_DEFAULTS.viewDistance);
  assert.equal(kept.npcDistance, 120);
  assert.equal(kept.shadowDistance, GRAPHICS_LIMITS.shadowDistance.max);
  // Not a slider, or not a number: not kept.
  saveGraphic('fov', 90, s);
  saveGraphic('npcDistance', NaN, s);
  assert.deepEqual(Object.keys(JSON.parse(s.m.get(GRAPHICS_KEY))).sort(), ['shadowDistance', 'viewDistance']);
  // Back to this machine's defaults.
  forgetGraphics(s);
  assert.deepEqual(loadGraphics(GRAPHICS_TIERS.phone, s), GRAPHICS_TIERS.phone);
  // Storage that throws or is missing is not an error, only not remembered.
  saveGraphic('viewDistance', 300, { getItem: () => null, setItem() { throw new Error('full'); } });
  saveGraphic('viewDistance', 300, null);
  forgetGraphics(null);
});

test('clampGraphic refuses what is not one of the four or not a number', () => {
  assert.equal(clampGraphic('viewDistance', 300), 300);
  assert.equal(clampGraphic('viewDistance', 5), GRAPHICS_LIMITS.viewDistance.min);
  assert.equal(clampGraphic('viewDistance', NaN), null);
  assert.equal(clampGraphic('viewDistance', null), null);
  assert.equal(clampGraphic('viewDistance', ''), null);
  assert.equal(clampGraphic('fov', 90), null);
  assert.equal(clampGraphic('viewDistance', true), null);
});

// Model detail (Plans/piratenkroeg.md, "The HD pack"): a word, remembered like a slider - only when chosen.
test('model detail is one of three words, kept only when chosen, and forgotten with the rest', () => {
  assert.deepEqual(GRAPHICS_CHOICES.detail, ['sd', 'auto', 'hd']);
  assert.equal(clampGraphic('detail', 'hd'), 'hd');
  assert.equal(clampGraphic('detail', 'HD'), null);
  assert.equal(clampGraphic('detail', 1), null);
  const s = memory();
  assert.equal(loadGraphics(GRAPHICS_TIERS.modest, s).detail, 'auto');
  saveGraphic('detail', 'sd', s);
  saveGraphic('detail', 'ultra', s);
  assert.deepEqual(JSON.parse(s.m.get(GRAPHICS_KEY)), { detail: 'sd' });
  assert.equal(loadGraphics(GRAPHICS_TIERS.full, s).detail, 'sd');
  assert.equal(loadGraphics(GRAPHICS_TIERS.full, memory({ [GRAPHICS_KEY]: '{"detail":"ultra"}' })).detail, 'auto');
  forgetGraphics(s);
  assert.equal(loadGraphics(GRAPHICS_TIERS.full, s).detail, 'auto');
});

test('Auto is HD on a full machine only; forced is forced', () => {
  assert.equal(hdWanted('auto', 'full'), true);
  assert.equal(hdWanted('auto', 'full', { deviceMemory: 8 }), true);
  assert.equal(hdWanted('auto', 'full', { deviceMemory: 4 }), false, 'a browser that says it is short of memory');
  assert.equal(hdWanted('auto', 'modest'), false);
  assert.equal(hdWanted('auto', 'phone'), false);
  assert.equal(hdWanted('hd', 'modest', { deviceMemory: 2 }), true);
  assert.equal(hdWanted('sd', 'full'), false);
});

test('the sliders are wired to the panel that has them', () => {
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  // ui.js calls it...
  assert.match(ui, /handlers\.onGraphicsSetting\(key, value\)/);
  // ...so createUI has to be handed it, and createNet must not be the one holding it.
  const call = (name) => {
    const at = main.indexOf(`${name}({`);
    assert.ok(at >= 0, `no ${name}({ in main.js`);
    let depth = 0;
    for (let i = at + name.length; i < main.length; i++) {
      if (main[i] === '{' || main[i] === '(') depth++;
      else if (main[i] === '}' || main[i] === ')') { depth--; if (depth === 0) return main.slice(at, i + 1); }
    }
    return '';
  };
  assert.match(call('createUI'), /\bonGraphicsSetting\b/, 'createUI is not handed onGraphicsSetting');
  assert.doesNotMatch(call('createNet'), /\bonGraphicsSetting\b/, 'onGraphicsSetting is handed to createNet again');
  // And the sliders are drawn from the same limits the frame clamps to.
  assert.match(ui, /GRAPHICS_LIMITS\[key\]/);
  // Model detail's chips are buttons, not sliders, and go the same one way in.
  assert.match(ui, /handlers\.onGraphicsSetting\('detail', b\.dataset\.detail\)/);
  assert.match(main, /if \(!key \|\| key === 'detail'\) applyDetail\(\)/);
});

test('the full defaults are the old look, and every tier cuts its houses inside the fog', async () => {
  const { fadeNeeded } = await import('../web/js/fade.js');
  // A far plane of 1400, which is what the island had before there were sliders (main.js adds
  // VIEW_MARGIN, 150, to View Distance).
  assert.equal(GRAPHICS_TIERS.full.viewDistance + 150, 1400);
  for (const [tier, d] of Object.entries(GRAPHICS_TIERS)) {
    // Object Distance is View Distance times the tier's ratio (objectDistanceOf), and the cut
    // lies inside the haze the far plane closes at, so the building dither is never needed.
    const object = objectDistanceOf(d.viewDistance, tier);
    const ceiling = Math.min((d.viewDistance + 150) * 0.95, object);
    assert.equal(fadeNeeded(object, ceiling), false, tier);
  }
  // And the shadow box may grow to the widest world.js allows (SHADOW_SPAN[1] = 190, a half-width).
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const span = world.match(/const SHADOW_SPAN = \[(\d+), (\d+)\]/);
  assert.ok(span, 'SHADOW_SPAN moved');
  assert.equal(GRAPHICS_LIMITS.shadowDistance.max, 2 * Number(span[2]));
  assert.equal(GRAPHICS_TIERS.full.shadowDistance, 2 * Number(span[2]));
});

test('the haze is the far plane alone and never waits for Object Distance, which only cuts', () => {
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  // The haze is the far plane's alone; Object Distance is only the cut (cullCeiling).
  const fogC = main.slice(main.indexOf('function fogCeiling()'), main.indexOf('function fogCeiling()') + 120);
  assert.match(fogC, /return camera\.far \* FOG_CAP;/);
  assert.doesNotMatch(fogC, /objectReach/);
  const ceil = main.slice(main.indexOf('function cullCeiling()'), main.indexOf('function cullCeiling()') + 200);
  assert.match(ceil, /fogCeilingOf\(camera\.far \* FOG_CAP, objectReach\(\), state\.mode === 'plan'\)/);
  // Object Distance as the frame reads it: floored by the orbit target only from above.
  const reach = main.slice(main.indexOf('function objectReach()'), main.indexOf('function objectReach()') + 700);
  assert.match(reach, /state\.mode === 'orbit' \? camera\.position\.distanceTo\(controls\.target\) : null/);
  assert.match(reach, /objectReachOf\(state\.graphics\.objectDistance, orbit\)/);
  const set = main.slice(main.indexOf('function setFogRange('), main.indexOf('function setFogRange(') + 3200);
  assert.match(set, /fogAt = fogCeiling\(\);\r?\n\s*scene\.fog\.far = Math\.min\(h\.far, fogAt\)/);
  // The floor moves with the zoom, so the frame asks again on one island too.
  assert.match(main, /state\.sea\.count\(\) > 1 \|\| \(state\.mode !== 'plan' && fogCeiling\(\) !== fogAt\)\) applyFogRange\(\)/);
  // There is no Object Distance slider: it follows View Distance whenever that moves.
  const view = main.slice(main.indexOf('function applyViewDistance('), main.indexOf('function applyViewDistance(') + 200);
  assert.match(view, /withObjectDistance\(state\.graphics\)/);
  assert.equal(GRAPHICS_LIMITS.objectDistance, undefined);
  // The page starts at its own machine's defaults.
  assert.match(main, /graphics: withObjectDistance\(loadGraphics\(GRAPHICS_TIERS\[graphicsTier\(\{ modest, phone: !!STANDALONE \}\)\]\)\)/);
});

test('the sky is drawn on the far plane, so a short view never shows the clear colour', () => {
  // A sphere of r1340 inside a far plane that View Distance can bring in to 250 was a black
  // void where the sky should be. z = w puts the dome at depth 1 whatever the far plane is.
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const sky = world.slice(world.indexOf('const skyMat'), world.indexOf('const sky = new THREE.Mesh'));
  assert.match(sky, /gl_Position = p\.xyww/);
  // Along the horizon the dome is the fog's own colour, by reference, so a fully fogged mast
  // standing against the sky is the colour of the sky behind it when it is cut.
  assert.match(sky, /col = mix\(uFog, col, smoothstep\(0\.0, 0\.14, d\.y\)\)/);
  // In the output colour space, as three hands the fog to every other material: the same
  // linear number written raw by this shader was a visibly different colour.
  assert.match(world, /scene\.fog\.color\.getRGB\(skyMat\.uniforms\.uFog\.value, renderer\.getRenderTarget\(\) \? THREE\.ColorManagement\.workingColorSpace : renderer\.outputColorSpace\)/);
  // The sun and moon carry no fog, so they are pulled inside the far plane instead.
  assert.match(world, /celestial = Math\.min\(CELESTIAL, far \* 0\.8\)/);
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const view = main.slice(main.indexOf('function applyViewDistance()'), main.indexOf('function applyViewDistance()') + 600);
  assert.match(view, /state\.world\.setFar\(camera\.far\)/);
});

test('the fireflies go out in the haze, and the cut is taken where the camera is drawn from', () => {
  // A fully fogged house cut at Object Distance showed the fireflies it had been hiding: they
  // were fog: false. Measured as the one break of "cut in full fog", at dusk and at night.
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const ff = world.slice(world.indexOf('const fireflies = new THREE.Points'), world.indexOf('fireflies.frustumCulled'));
  assert.match(ff, /fog: true/);
  assert.match(ff, /#include <fog_vertex>/);
  assert.match(ff, /a \*= 1\.0 - smoothstep\(fogNear, fogFar, vFogDepth\)/);
  // The cut runs right before the render, after every branch has moved the camera.
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /cullRecords\(\);\r?\n\s*renderer\.render\(state\.inside \? state\.inside\.scene : scene, eye\);/);
});

test('View Distance lets the haze out only past the desktop default, smoothly, and the far plane goes with it', () => {
  const { viewDistance: from } = GRAPHICS_TIERS.full, max = HAZE_OPEN_AT;
  // At and below the default the island's own haze is untouched: nothing here may change a tier.
  for (const v of [GRAPHICS_LIMITS.viewDistance.min, GRAPHICS_TIERS.phone.viewDistance, GRAPHICS_TIERS.modest.viewDistance, from]) {
    assert.equal(hazeOpening(v), 0, String(v));
  }
  assert.equal(hazeOpening(max), 1);
  assert.equal(hazeOpening(max * 2), 1);
  assert.ok(GRAPHICS_LIMITS.viewDistance.max >= max, 'the slider reaches the fully open haze');
  assert.ok(hazeOpening(from + 10) > 0 && hazeOpening(from + 10) < 0.01, 'a nudge is a nudge, not a jump');
  // The sea under the horizon and the clouds follow the same slider.
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /hazeOpening\(state\.graphics\.viewDistance\)/);
  assert.match(main, /state\.world\.setCloudReach\(scene\.fog\.far\)/);
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  assert.match(world, /ocean\.scale\.set\(spread, 1, spread\)/);
});

test('Object Distance is View Distance times its tier ratio, and a desktop draws past the far plane', () => {
  assert.equal(objectDistanceOf(1250, 'full'), 2000);
  assert.equal(objectDistanceOf(800, 'modest'), 560);
  assert.equal(objectDistanceOf(600, 'phone'), 390);
  assert.equal(objectDistanceOf(6000), 9600);
  assert.ok(OBJECT_RATIO.full > 1 && OBJECT_RATIO.modest < 1 && OBJECT_RATIO.phone < 1);
});
