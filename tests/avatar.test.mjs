import test from 'node:test';
import assert from 'node:assert/strict';
// avatar.js reaches shared/palette.mjs for the swatches now: they moved there so the walk
// can ask how tall somebody is from Node, without dragging three.js along.
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import { Color, MeshBasicMaterial } from 'three';
// Imported dynamically, and it has to be: a static import is hoisted above the register()
// call and would resolve 'shared/…' before the loader that knows what that means exists.
// classic-avatar.js now reaches web/js/buildings.js for the held-item primitives, which
// starts a TextureLoader at import time - the same reason villagers.test.mjs stubs this.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { avatarPlayerGeometry, avatarFigureGeometry, HAT_SHAPES,
  DEFAULT_AVATAR, PLAYER_EYE, loadAvatar, saveAvatar } = await import('../web/js/avatar.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

test('every Blender hat fits walking clearance and produces one complete material mesh', () => {
  for (const { id } of HAT_SHAPES) {
    const g = avatarPlayerGeometry({ ...DEFAULT_AVATAR, hatShape: id });
    assert.equal(g.groups.length, 0, id);
    assert.equal(g.boundingBox.min.y, 0, id);
    assert.ok(g.boundingBox.max.y <= .55, id);
    assert.ok(PLAYER_EYE < g.boundingBox.max.y, id);
    assert.ok(g.attributes.position.count / 3 < 3000, id);
    for (const name of ['normal', 'color', 'aEmissive', 'aSheet']) {
      assert.equal(g.attributes[name].count, g.attributes.position.count, `${id}: ${name}`);
      assert.ok(g.attributes[name].array.every(Number.isFinite), `${id}: ${name}`);
    }
    for (let i = 0; i < g.attributes.normal.count; i++) {
      const n = g.attributes.normal;
      assert.ok(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > .99, `${id}: degenerate face`);
    }
    g.dispose();
  }
});

test('wardrobe recolours exported skin vertices and gear is included only for the player', () => {
  const skin = 0x8d5524;
  const g = avatarPlayerGeometry({ ...DEFAULT_AVATAR, skin });
  const color = new Color(skin);
  const c = g.attributes.color;
  let found = false;
  for (let i = 0; i < c.count; i++) {
    if (Math.abs(c.getX(i)-color.r) < 1e-6 && Math.abs(c.getY(i)-color.g) < 1e-6
      && Math.abs(c.getZ(i)-color.b) < 1e-6) found = true;
  }
  assert.ok(found);
  const figure = avatarFigureGeometry(DEFAULT_AVATAR);
  assert.ok(figure.attributes.position.count < g.attributes.position.count);
  figure.dispose();
  g.dispose();
});

test('existing browser looks survive the new mesh and corrupt storage falls back', () => {
  const original = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k), setItem: (k,v) => values.set(k,v) };
  try {
    const spec = { ...DEFAULT_AVATAR, hatShape: 'cap', tunic: 0x3d7ed9 };
    saveAvatar(spec);
    assert.deepEqual(JSON.parse(values.get('promptholm.avatar')), spec);
    assert.deepEqual(loadAvatar(), spec);
    assert.equal(saveAvatar({ ...spec, character: 'classic' }).character, 'classic');
    assert.equal(saveAvatar({ ...spec, character: 'unknown' }).character, DEFAULT_AVATAR.character);
    values.set('promptholm.avatar', '{broken');
    assert.deepEqual(loadAvatar(), DEFAULT_AVATAR);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('the original avatar keeps every triangle while its limbs animate independently', () => {
  const spec = { ...DEFAULT_AVATAR, character: 'classic' };
  const merged = avatarPlayerGeometry(spec);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const animated = createClassicAvatar(spec, material);
  let vertices = 0;
  animated.object.traverse((part) => { if (part.isMesh) vertices += part.geometry.attributes.position.count; });
  assert.equal(vertices, merged.attributes.position.count);
  animated.update({ moving: true, running: false, grounded: true, crouching: false,
    sitting: false, lying: false, phase: Math.PI / 2 }, 1);
  const rotations = animated.object.children.slice(1).map((part) => part.rotation.x);
  assert.ok(rotations.some((angle) => Math.abs(angle) > 0.2));
  assert.ok(rotations.some((angle) => angle < 0) && rotations.some((angle) => angle > 0));
  animated.dispose();
  material.dispose();
  merged.dispose();
});
