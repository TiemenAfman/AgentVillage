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
  GRAPHICS_DEFAULTS, GRAPHICS_LIMITS, GRAPHICS_KEY, clampGraphic, loadGraphics, saveGraphics,
} from '../web/js/graphics-settings.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};

test('four distances, each with a default inside its own slider', () => {
  assert.deepEqual(Object.keys(GRAPHICS_DEFAULTS).sort(), Object.keys(GRAPHICS_LIMITS).sort());
  for (const [k, v] of Object.entries(GRAPHICS_DEFAULTS)) {
    const { min, max } = GRAPHICS_LIMITS[k];
    assert.ok(v >= min && v <= max, `${k} starts at ${v}, outside ${min}..${max}`);
  }
});

test('nothing remembered is the defaults, and a broken store is too', () => {
  assert.deepEqual(loadGraphics(memory()), GRAPHICS_DEFAULTS);
  assert.deepEqual(loadGraphics(memory({ [GRAPHICS_KEY]: '{not json' })), GRAPHICS_DEFAULTS);
  assert.deepEqual(loadGraphics(memory({ [GRAPHICS_KEY]: '7' })), GRAPHICS_DEFAULTS);
  // A private window whose storage throws on every read.
  assert.deepEqual(loadGraphics({ getItem() { throw new Error('denied'); } }), GRAPHICS_DEFAULTS);
});

test('what was left is what comes back, clamped, one field at a time', () => {
  const s = memory();
  saveGraphics({ ...GRAPHICS_DEFAULTS, viewDistance: 250 }, s);
  assert.equal(loadGraphics(s).viewDistance, 250);
  // One bad field keeps the other three.
  const kept = loadGraphics(memory({ [GRAPHICS_KEY]: JSON.stringify({ viewDistance: 'far', npcDistance: 120, objectDistance: 9999 }) }));
  assert.equal(kept.viewDistance, GRAPHICS_DEFAULTS.viewDistance);
  assert.equal(kept.npcDistance, 120);
  assert.equal(kept.objectDistance, GRAPHICS_LIMITS.objectDistance.max);
  assert.equal(kept.shadowDistance, GRAPHICS_DEFAULTS.shadowDistance);
  // Saving into storage that throws is not an error, only not remembered.
  saveGraphics(GRAPHICS_DEFAULTS, { setItem() { throw new Error('full'); } });
  // And no storage at all - Node has none, and neither does a page where it is blocked.
  saveGraphics(GRAPHICS_DEFAULTS, null);
  assert.deepEqual(loadGraphics(null), GRAPHICS_DEFAULTS);
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

test('the defaults are the old look, and leave the building shader as it was', async () => {
  const { fadeNeeded, cornerCos } = await import('../web/js/fade.js');
  // A far plane of 1400, which is what the island had before there were sliders (main.js adds
  // VIEW_MARGIN, 150, to View Distance).
  assert.equal(GRAPHICS_DEFAULTS.viewDistance + 150, 1400);
  // Object Distance at the default is past where the fog can ever close, even at the corner of
  // a wide frame, so the dither stays out of the shader every building shares.
  const cap = (GRAPHICS_DEFAULTS.viewDistance + 150) * 0.95;
  assert.equal(fadeNeeded(GRAPHICS_DEFAULTS.objectDistance, cap, cornerCos(45, 21 / 9)), false);
  // And the shadow box may grow to the widest world.js allows (SHADOW_SPAN[1] = 190, a half-width).
  const world = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const span = world.match(/const SHADOW_SPAN = \[(\d+), (\d+)\]/);
  assert.ok(span, 'SHADOW_SPAN moved');
  assert.equal(GRAPHICS_LIMITS.shadowDistance.max, 2 * Number(span[2]));
  assert.equal(GRAPHICS_DEFAULTS.shadowDistance, 2 * Number(span[2]));
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
