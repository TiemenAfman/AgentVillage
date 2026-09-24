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
const { avatarPlayerGeometry, avatarFigureGeometry, avatarPlayerComponentGeometry, HAT_SHAPES,
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
    values.set('promptholm.avatar', '{broken');
    assert.deepEqual(loadAvatar(), DEFAULT_AVATAR);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('the original avatar keeps every triangle while its limbs animate independently', () => {
  const spec = { ...DEFAULT_AVATAR };
  const merged = avatarPlayerGeometry(spec);
  const material = new MeshBasicMaterial({ vertexColors: true });
  const animated = createClassicAvatar(spec, material);
  // Only what is actually shown: toggleable armour hangs off a pivot whose own .visible is
  // false by default (the same pattern the backpack already used), not the mesh's own flag,
  // so a flat traverse that only checks each mesh would still count a hidden piece - three.js
  // itself skips a whole subtree under an invisible parent when it renders, and this walk
  // has to match that or it is testing something the screen does not show.
  function countVisible(obj) {
    if (!obj.visible) return 0;
    let n = obj.isMesh ? obj.geometry.attributes.position.count : 0;
    for (const child of obj.children) n += countVisible(child);
    return n;
  }
  const vertices = countVisible(animated.object);
  // Everything the merged mesh carries that DEFAULT_AVATAR's own equip state leaves out:
  // the hammer (now a hand-held item, built fresh only when equipped) and the whole armour
  // set (Plans/uitrusting-en-vasthouden.md) - all baked 'gear'-variant parts, which
  // avatarPlayerGeometry always includes and the animated rig only shows once switched on.
  const hidden = avatarPlayerComponentGeometry(spec, [
    'Hammer handle', 'Hammer head',
    'Chestplate body', 'Chestplate trim', 'Left chestplate pauldron', 'Right chestplate pauldron',
    'Left legging', 'Left knee cop', 'Right legging', 'Right knee cop',
    'Left sabaton', 'Left sabaton trim', 'Right sabaton', 'Right sabaton trim',
    'Sword pommel', 'Sword grip', 'Sword crossguard', 'Sword blade',
    'Shield face', 'Shield rim top', 'Shield rim bottom', 'Shield boss', 'Shield grip',
  ]);
  assert.equal(vertices, merged.attributes.position.count - hidden.attributes.position.count);
  animated.update({ moving: true, running: false, grounded: true, crouching: false,
    sitting: false, lying: false, phase: Math.PI / 2 }, 1);
  const rotations = animated.object.children.slice(1).map((part) => part.rotation.x);
  assert.ok(rotations.some((angle) => Math.abs(angle) > 0.2));
  assert.ok(rotations.some((angle) => angle < 0) && rotations.some((angle) => angle > 0));
  animated.dispose();
  material.dispose();
  merged.dispose();
});

// The arm pivots are reached through the hand attach points, which are their children -
// the rig hands those out for held items and exposes nothing else of its skeleton.
test('a swing takes the weapon arm up behind the shoulder and back, a block turns the shield to the front', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const spec = { ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'sword', leftHandItem: 'shield' } };
  const rig = createClassicAvatar(spec, material);
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const rightArm = rig.handAttach.rightArm.parent, leftArm = rig.handAttach.leftArm.parent;
  const sword = rig.handAttach.rightArm.children[0], shield = rig.handAttach.leftArm.children[0];
  rig.update(still, 1);
  // At rest the sword arm is held out and the sword stands upright against it; the shield
  // arm hangs, its face turned a little forward (mirrored for the left hand: positive).
  assert.ok(Math.abs(rightArm.rotation.x + 1.3) < 0.02, 'sword held out');
  assert.ok(Math.abs(sword.rotation.x + rightArm.rotation.x) < 1e-9, 'sword upright');
  assert.ok(Math.abs(leftArm.rotation.x + 0.35) < 0.02, 'shield arm down');
  assert.ok(Math.abs(shield.rotation.y - 0.6) < 0.02, 'shield a little forward');
  assert.equal(shield.scale.x, -1, 'left-hand item mirrored');

  rig.attack();
  rig.update(still, 0.12);   // winding up
  assert.ok(rightArm.rotation.x < -2.0, 'wound up behind the shoulder: ' + rightArm.rotation.x);
  assert.ok(Math.abs(sword.rotation.x) < 0.3, 'the sword goes with the arm, not upright');
  rig.update(still, 0.12);   // striking
  assert.ok(rightArm.rotation.x > -2.0 && rightArm.rotation.x < -0.3, 'mid-strike: ' + rightArm.rotation.x);
  rig.update(still, 0.3);    // over
  rig.update(still, 1);
  assert.ok(Math.abs(rightArm.rotation.x + 1.3) < 0.05, 'back to holding it out');
  assert.ok(Math.abs(sword.rotation.x + rightArm.rotation.x) < 0.05, 'sword upright again');

  rig.update({ ...still, blocking: true }, 1);
  rig.update({ ...still, blocking: true }, 1);
  assert.ok(Math.abs(leftArm.rotation.x + 1.25) < 0.02, 'shield arm up in front');
  assert.ok(Math.abs(shield.rotation.y - Math.PI / 2) < 0.02, 'shield facing forward');
  assert.ok(Math.abs(rightArm.rotation.x + 1.3) < 0.02, 'the sword arm is not the one blocking');
  rig.update(still, 1);
  rig.update(still, 1);
  assert.ok(Math.abs(leftArm.rotation.x + 0.35) < 0.02, 'shield arm back down');
  rig.dispose();
});

// Plans/bier-en-dronken.md: a beer's hand drinks where any other would swing - each hand has
// its own mouse button (walk.js) - lifting the glass to the face and handing the swallow out
// a frame at a time: exactly one drink's worth, however the frames fall.
test('a beer is drunk from by its own hand, one swallow per drink', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const withHands = (rightHandItem, leftHandItem) => createClassicAvatar(
    { ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem, leftHandItem } }, material);

  // Only the hand with the glass in it drinks: not the sword beside it, not an empty fist.
  const lone = withHands('beer', null), armed = withHands('sword', 'beer');
  assert.equal(lone.held('rightArm'), 'beer');
  assert.equal(lone.drink('leftArm'), false, 'drank from an empty hand');
  assert.equal(armed.drink('rightArm'), false, 'drank from a sword');
  assert.equal(armed.drink('leftArm'), true, 'the left hand\'s beer');

  const rightArm = lone.handAttach.rightArm.parent, glass = lone.handAttach.rightArm.children[0];
  lone.update(still, 1);
  assert.ok(Math.abs(rightArm.rotation.x + 0.7) < 0.02, 'a beer is held in front of the chest: ' + rightArm.rotation.x);
  assert.ok(Math.abs(glass.rotation.x + rightArm.rotation.x) < 1e-9, 'and upright');
  assert.equal(lone.swallowed(), 0);

  assert.equal(lone.drink('rightArm'), true);
  assert.equal(lone.drink('rightArm'), false, 'a second click mid-drink started another');
  let down = 0;
  const step = 1 / 60;
  for (let t = 0; t < 0.9; t += step) { lone.update(still, step); down += lone.swallowed(); }
  // Mid-swallow: up at the face, turned in towards it, the glass rolled towards the mouth.
  assert.ok(rightArm.rotation.x < -1.9, 'glass at the face: ' + rightArm.rotation.x);
  assert.ok(rightArm.rotation.z < -0.3, 'turned inward: ' + rightArm.rotation.z);
  assert.ok(glass.rotation.z + rightArm.rotation.z > 0.8, 'glass tipped to the mouth');
  assert.ok(down > 0.3 && down < 0.8, 'half-way through the swallow: ' + down);
  for (let t = 0; t < 1.5; t += step) { lone.update(still, step); down += lone.swallowed(); }
  assert.ok(Math.abs(down - 1) < 1e-9, 'one drink is one swallow: ' + down);
  assert.ok(Math.abs(rightArm.rotation.x + 0.7) < 0.05, 'back in front of the chest');
  assert.ok(Math.abs(rightArm.rotation.z) < 0.05);
  assert.equal(lone.drink('rightArm'), true, 'could not drink again once the glass was down');

  // Into the water with it: the drink is put down, and what was not swallowed is not.
  lone.update(still, 0.5);
  lone.swallowed();
  lone.update({ ...still, swimming: true }, 0.2);
  assert.equal(lone.swallowed(), 0, 'swallowed while swimming');
  lone.update(still, 1);
  assert.equal(lone.swallowed(), 0);
  assert.equal(lone.drink('rightArm'), true, 'the interrupted drink was still going');

  for (const rig of [lone, armed]) rig.dispose();
  material.dispose();
});
