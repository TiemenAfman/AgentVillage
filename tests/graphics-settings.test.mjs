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
  forgetGraphics, graphicsTier,
} from '../web/js/graphics-settings.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};

test('three kinds of machine, each with four defaults inside their sliders', () => {
  assert.deepEqual(Object.keys(GRAPHICS_TIERS).sort(), ['full', 'modest', 'phone']);
  for (const [tier, d] of Object.entries(GRAPHICS_TIERS)) {
    assert.deepEqual(Object.keys(d).sort(), Object.keys(GRAPHICS_LIMITS).sort(), tier);
    for (const [k, v] of Object.entries(d)) {
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
  saveGraphic('shadowDistance', 60, s);
  // Stored: that one choice, not all four.
  assert.deepEqual(JSON.parse(s.m.get(GRAPHICS_KEY)), { shadowDistance: 60 });
  // So a modest machine keeps its own View Distance under it, and a full one its own.
  assert.equal(loadGraphics(GRAPHICS_TIERS.modest, s).viewDistance, GRAPHICS_TIERS.modest.viewDistance);
  assert.equal(loadGraphics(GRAPHICS_TIERS.full, s).viewDistance, GRAPHICS_TIERS.full.viewDistance);
  assert.equal(loadGraphics(GRAPHICS_TIERS.modest, s).shadowDistance, 60);
  saveGraphic('viewDistance', 250, s);
  assert.deepEqual(JSON.parse(s.m.get(GRAPHICS_KEY)), { shadowDistance: 60, viewDistance: 250 });
  // One bad field keeps the other three, and a remembered number outside its slider is clamped.
  const kept = loadGraphics(GRAPHICS_DEFAULTS, memory({ [GRAPHICS_KEY]: JSON.stringify({ viewDistance: 'far', npcDistance: 120, objectDistance: 9999 }) }));
  assert.equal(kept.viewDistance, GRAPHICS_DEFAULTS.viewDistance);
  assert.equal(kept.npcDistance, 120);
  assert.equal(kept.objectDistance, GRAPHICS_LIMITS.objectDistance.max);
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
});

test('the full defaults are the old look, and every tier cuts its houses inside the fog', async () => {
  const { fadeNeeded } = await import('../web/js/fade.js');
  // A far plane of 1400, which is what the island had before there were sliders (main.js adds
  // VIEW_MARGIN, 150, to View Distance).
  assert.equal(GRAPHICS_TIERS.full.viewDistance + 150, 1400);
  for (const [tier, d] of Object.entries(GRAPHICS_TIERS)) {
    // The haze closes at the nearer of the far plane and Object Distance (main.js fogCeiling),
    // so the building dither is never needed: the houses come out of the mist.
    const ceiling = Math.min((d.viewDistance + 150) * 0.95, d.objectDistance);
    assert.equal(fadeNeeded(d.objectDistance, ceiling), false, tier);
  }
  // And the shadow box may grow to the widest world.js allows (SHADOW_SPAN[1] = 190, a half-width).
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const span = world.match(/const SHADOW_SPAN = \[(\d+), (\d+)\]/);
  assert.ok(span, 'SHADOW_SPAN moved');
  assert.equal(GRAPHICS_LIMITS.shadowDistance.max, 2 * Number(span[2]));
  assert.equal(GRAPHICS_TIERS.full.shadowDistance, 2 * Number(span[2]));
});

test('the haze never closes past Object Distance, and a slider change moves it', () => {
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const ceil = main.slice(main.indexOf('function fogCeiling()'), main.indexOf('function fogCeiling()') + 300);
  assert.match(ceil, /Math\.min\(view, state\.graphics\.objectDistance\)/);
  const set = main.slice(main.indexOf('function setFogRange('), main.indexOf('function setFogRange(') + 1600);
  assert.match(set, /scene\.fog\.far = Math\.min\(h\.far, fogCeiling\(\)\)/);
  const apply = main.slice(main.indexOf('function applyGraphics('), main.indexOf('function applyGraphics(') + 600);
  assert.match(apply, /key === 'objectDistance'\) applyFogRange\(\)/);
  // The page starts at its own machine's defaults.
  assert.match(main, /graphics: loadGraphics\(GRAPHICS_TIERS\[graphicsTier\(\{ modest, phone: !!STANDALONE \}\)\]\)/);
});

test('the sky is drawn on the far plane, so a short view never shows the clear colour', () => {
  // A sphere of r1340 inside a far plane that View Distance can bring in to 250 was a black
  // void where the sky should be. z = w puts the dome at depth 1 whatever the far plane is.
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const sky = world.slice(world.indexOf('const skyMat'), world.indexOf('const sky = new THREE.Mesh'));
  assert.match(sky, /gl_Position = p\.xyww/);
  // The sun and moon carry no fog, so they are pulled inside the far plane instead.
  assert.match(world, /celestial = Math\.min\(CELESTIAL, far \* 0\.8\)/);
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const view = main.slice(main.indexOf('function applyViewDistance()'), main.indexOf('function applyViewDistance()') + 600);
  assert.match(view, /state\.world\.setFar\(camera\.far\)/);
});
