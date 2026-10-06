import test from 'node:test';
import assert from 'node:assert/strict';
// avatar.js reaches shared/palette.mjs for the swatches now: they moved there so the walk
// can ask how tall somebody is from Node, without dragging three.js along.
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import { Color, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
// Imported dynamically, and it has to be: a static import is hoisted above the register()
// call and would resolve 'shared/…' before the loader that knows what that means exists.
// classic-avatar.js now reaches web/js/buildings.js for the held-item primitives, which
// starts a TextureLoader at import time - the same reason villagers.test.mjs stubs this.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { avatarPlayerGeometry, avatarFigureGeometry, avatarPlayerComponentGeometry, HAT_SHAPES,
  DEFAULT_AVATAR, PLAYER_EYE, loadAvatar, saveAvatar, saveCharacter } = await import('../web/js/avatar.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

// The refined hero reserves 24k triangles including every optional armour piece.
// Smooth normals retain curved surfaces without the concept's render subdivisions.
test('every Blender hat fits walking clearance and produces one complete material mesh', () => {
  for (const { id } of HAT_SHAPES) {
    const g = avatarPlayerGeometry({ ...DEFAULT_AVATAR, hatShape: id });
    assert.equal(g.groups.length, 0, id);
    assert.equal(g.boundingBox.min.y, 0, id);
    assert.ok(g.boundingBox.max.y <= .55, id);
    assert.ok(PLAYER_EYE < g.boundingBox.max.y, id);
    assert.ok(g.attributes.position.count / 3 < 24000, id);
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

test('the body picked is kept on its own, so a restart opens on the same character', () => {
  const original = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: (k) => values.get(k), setItem: (k,v) => values.set(k,v) };
  try {
    saveAvatar({ ...DEFAULT_AVATAR, hatShape: 'cap', tunic: 0x3d7ed9 });
    assert.equal(saveCharacter('adventurer').character, 'adventurer');
    // Only the body changed: the outfit saved before is still the one on it.
    assert.deepEqual(loadAvatar(), { ...DEFAULT_AVATAR, hatShape: 'cap', tunic: 0x3d7ed9, character: 'adventurer' });
    assert.equal(saveCharacter('nonsense').character, 'traveller');
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
  // The four limbs' own pivots: the legs hang from the pelvis and the arms from the collarbones
  // now (classic-avatar.js mounts), so they are no longer the root's direct children.
  const rotations = Object.values(animated.joints).map((chain) => chain.root.parent.parent.rotation.x);
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
  assert.ok(shield.scale.x < 0 && Math.abs(shield.scale.x) === shield.scale.y, 'left-hand item mirrored, not squashed');

  // Where the fist and the blade's far end are, in the body's own frame (+z is in front).
  sword.geometry.computeBoundingBox();
  const ends = () => {
    rig.object.updateMatrixWorld(true);
    const hand = new Vector3().setFromMatrixPosition(rig.handAttach.rightArm.matrixWorld);
    const tip = new Vector3(0, sword.geometry.boundingBox.max.y, 0).applyMatrix4(sword.matrixWorld);
    return { hand, tip };
  };
  const fromWrist = sword.rotation.x;
  rig.attack();
  rig.update(still, 1 / 60);
  assert.ok(Math.abs(sword.rotation.x - fromWrist) < 1e-9, 'the sword does not snap round as the swing starts');
  rig.update(still, 0.12);   // winding up
  assert.ok(rightArm.rotation.x < -2.0, 'arm raised: ' + rightArm.rotation.x);
  let { hand, tip } = ends();
  assert.ok(tip.z < hand.z - 0.1, 'blade cocked back behind the shoulder');
  rig.update(still, 0.12);   // striking
  assert.ok(rightArm.rotation.x > -2.0 && rightArm.rotation.x < -0.3, 'mid-strike: ' + rightArm.rotation.x);
  ({ hand, tip } = ends());
  // It used to go with the arm, which laid it back along the arm and struck upwards.
  assert.ok(tip.z > hand.z + 0.1 && tip.y < hand.y, 'blade comes down in front: ' + tip.toArray());
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

// Plans/DONE/bier-en-dronken.md: a beer's hand drinks where any other would swing - each hand has
// its own mouse button (walk.js) - lifting the glass to the face and handing the swallow out
// a frame at a time: exactly one drink's worth, however the frames fall.
test('a beer is drunk from by its own hand, one swallow per drink', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const withHands = (rightHandItem, leftHandItem) => createClassicAvatar(
    { ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem, leftHandItem } }, material);

  // Only the hand with the glass in it drinks: not the sword beside it, not an empty fist.
  const lone = withHands('beer', null), armed = withHands('sword', 'beer');
  // Both on one clock: the idle breath lifts the chest and the arms hanging from it, so two
  // rigs a second apart hold their glasses a breath apart. `lone` is stood for a second below.
  armed.update(still, 1);
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
  // Mid-swallow: the rim at the mouth (just under the nose, on the face's front), the glass
  // tipped back into the face - and never past level, which is what a roll about the arm
  // drew: the glass turned on its side beside the cheek, pouring the beer on the ground.
  for (let t = 0; t < 0.9; t += step) armed.update(still, step);
  for (const rig of [lone, armed]) rig.object.updateMatrixWorld(true);
  const rim = glass.localToWorld(new Vector3(-0.045, 0.047, 0));
  const up = new Vector3(0, 1, 0).transformDirection(glass.matrixWorld);
  assert.ok(Math.abs(rim.x) < 0.04 && Math.abs(rim.y - 0.365) < 0.02 && Math.abs(rim.z - 0.1) < 0.02,
    'rim at the mouth: ' + rim.toArray().map((v) => v.toFixed(3)));
  assert.ok(up.y > 0.2 && up.z < -0.5 && up.x * rim.x < 0, 'glass tipped back into the face, not poured out: ' + up.toArray().map((v) => v.toFixed(2)));
  // The left hand is the right one's mirror.
  const leftGlass = armed.handAttach.leftArm.children[0];
  const leftRim = leftGlass.localToWorld(new Vector3(-0.045, 0.047, 0));
  assert.ok(leftRim.distanceTo(new Vector3(-rim.x, rim.y, rim.z)) < 1e-6, 'left rim mirrors right: ' + leftRim.toArray());
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

// Handing the beer to a settler (main.js giveBeer): the arm reaches out, the glass leaves the
// fist while they drink it - no drinking from a glass that is not there - and a fresh one is
// back in the hand afterwards.
test('a beer handed over leaves the hand for as long as it is being drunk', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const rig = createClassicAvatar({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'beer' } }, material);
  const arm = rig.handAttach.rightArm.parent, glass = () => rig.handAttach.rightArm.children[0];
  rig.update(still, 1);
  assert.equal(rig.handOver('leftArm', 2), false, 'handed over a beer from an empty hand');
  assert.equal(rig.handOver('rightArm', 2), true);
  assert.equal(rig.handOver('rightArm', 2), false, 'handed over the same glass twice');
  rig.update(still, 0.3);
  assert.ok(arm.rotation.x < -1.2, 'the arm did not reach out: ' + arm.rotation.x);
  rig.update(still, 0.3);
  assert.equal(glass().visible, false, 'the glass is still in the hand after it was taken');
  assert.equal(rig.drink('rightArm'), false, 'drank from a glass somebody else has');
  rig.update(still, 1.5);
  assert.equal(glass().visible, true, 'no fresh glass once theirs was down');
  assert.equal(rig.drink('rightArm'), true);
  rig.dispose();
  material.dispose();
});

// Two pints are a beer relay (bierestafette), never two arms drinking in turn: the button's own
// hand drinks, the other pours its glass into that one, and both go down in the one swallow.
test('two beers are a relay: one glass pours into the other, two drinks in one swallow', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const RIM = new Vector3(-0.045, 0.047, 0);
  for (const side of ['rightArm', 'leftArm']) {
    const other = side === 'rightArm' ? 'leftArm' : 'rightArm';
    const rig = createClassicAvatar({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'beer', leftHandItem: 'beer' } }, material);
    rig.update(still, 1);
    assert.equal(rig.drink(side), true);
    assert.equal(rig.drink(other), false, 'the other hand drank on its own mid-relay');
    const step = 1 / 60;
    let down = 0, t = 0;
    for (; t < 1.3; t += step) { rig.update(still, step); down += rig.swallowed(); }
    rig.object.updateMatrixWorld(true);
    const mouth = rig.handAttach[side].children[0], pour = rig.handAttach[other].children[0];
    const into = mouth.localToWorld(RIM.clone()), from = pour.localToWorld(RIM.clone());
    const pourUp = new Vector3(0, 1, 0).transformDirection(pour.matrixWorld);
    // Stacked: the pouring glass's bottom lip rests on the drinking glass's top lip, one rim
    // width apart, both openings face the mouth, and the upper glass is tipped further.
    const mouthUp = new Vector3(0, 1, 0).transformDirection(mouth.matrixWorld);
    assert.ok(into.distanceTo(from) < 0.07, 'the upper rim is not on the lower glass: ' + into.distanceTo(from).toFixed(3));
    assert.ok(from.y > into.y + 0.01, 'the pouring rim is above the drinking one: ' + from.y.toFixed(3) + ' ' + into.y.toFixed(3));
    assert.ok(mouthUp.z < -0.8 && pourUp.z < -0.8, 'an opening turned away from the face: ' + mouthUp.z.toFixed(2) + ' ' + pourUp.z.toFixed(2));
    assert.ok(pourUp.y < mouthUp.y - 0.2, 'the upper glass is not tipped past the lower: ' + pourUp.y.toFixed(2) + ' ' + mouthUp.y.toFixed(2));
    // Drunk with the head tipped back: the stack has gone up with the mouth (0.37 head up).
    assert.ok(into.y > 0.385, 'the head is not tipped back: rim at ' + into.y.toFixed(3));
    // In line: both rims on the body's middle, and neither glass rolled to a side.
    assert.ok(Math.abs(into.x) < 0.01 && Math.abs(from.x) < 0.01, 'rims off the middle: ' + into.x.toFixed(3) + ' ' + from.x.toFixed(3));
    assert.ok(Math.abs(mouthUp.x) < 0.05 && Math.abs(pourUp.x) < 0.05, 'a glass rolled sideways: ' + mouthUp.x.toFixed(2) + ' ' + pourUp.x.toFixed(2));
    const stream = rig.object.children.find((c) => c.isMesh && c.visible && c.scale.y < 0.1);
    assert.ok(stream, 'no stream between the glasses');
    for (; t < 3; t += step) { rig.update(still, step); down += rig.swallowed(); }
    assert.ok(Math.abs(down - 2) < 1e-9, 'a relay is two drinks: ' + down);
    assert.ok(!rig.object.children.some((c) => c === stream && c.visible), 'the stream outlived the pour');
    assert.equal(rig.drink(other), true, 'could not start another relay from the other hand');
    // Into the water: both glasses are put down together.
    rig.update({ ...still, swimming: true }, step);
    assert.equal(rig.drink(side), true, 'the relay was still going after the swim');
    rig.dispose();
  }
  // One glass handed over leaves the other to drink on its own, the ordinary way.
  const rig = createClassicAvatar({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'beer', leftHandItem: 'beer' } }, material);
  rig.update(still, 1);
  assert.equal(rig.handOver('leftArm', 2), true);
  assert.equal(rig.drink('rightArm'), true);
  let down = 0;
  for (let t = 0; t < 1.7; t += 1 / 60) { rig.update(still, 1 / 60); down += rig.swallowed(); }
  assert.ok(Math.abs(down - 1) < 1e-9, 'one glass in hand is one drink: ' + down);
  rig.dispose();
  material.dispose();
});

// Our pints are straight, so the relay's two glasses lean on each other rim to rim rather than
// nesting: at no moment of it, from either hand, does one go into the other.
test('the two glasses of a relay never go through each other', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  // The pint's wall, foam cap and top, sampled in its own frame (beerGeometry: glass at x -0.045).
  const surface = [];
  for (let y = -0.035; y <= 0.054; y += 0.011) for (let a = 0; a < 16; a++) {
    surface.push(new Vector3(-0.045 + 0.03 * Math.cos(a / 8 * Math.PI), y, 0.03 * Math.sin(a / 8 * Math.PI)));
  }
  const depth = (p) => {
    const r = Math.hypot(p.x + 0.045, p.z);
    return r < 0.03 && p.y > -0.035 && p.y < 0.054 ? Math.min(0.03 - r, p.y + 0.035, 0.054 - p.y) : 0;
  };
  const into = (a, b) => {
    const m = b.matrixWorld.clone().invert().multiply(a.matrixWorld);
    return Math.max(...surface.map((s) => depth(s.clone().applyMatrix4(m))));
  };
  for (const side of ['rightArm', 'leftArm']) {
    const rig = createClassicAvatar({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'beer', leftHandItem: 'beer' } }, material);
    rig.update(still, 1);
    rig.drink(side);
    const a = rig.handAttach.rightArm.children[0], b = rig.handAttach.leftArm.children[0];
    for (let t = 0; t < 2.7; t += 1 / 60) {
      rig.update(still, 1 / 60);
      rig.object.updateMatrixWorld(true);
      const d = Math.max(into(a, b), into(b, a));
      assert.ok(d < 0.003, side + ': the glasses overlap by ' + (d * 1000).toFixed(1) + ' mm at ' + t.toFixed(2) + ' s');
    }
    rig.dispose();
  }
  material.dispose();
});

// Nor into the face: the head, the nose and the hat (the whole player geometry above the
// shoulders, turned with the head as it tips back). The drinking rim may touch the lips.
test('a relay keeps both glasses out of the face', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const still = { moving: false, running: false, grounded: true, crouching: false, sitting: false, lying: false, phase: 0 };
  const whole = avatarPlayerGeometry({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, backpack: false } });
  const head = [];
  for (let i = 0; i < whole.attributes.position.count; i++) {
    const v = new Vector3().fromBufferAttribute(whole.attributes.position, i);
    if (v.y > 0.335 && Math.abs(v.x) < 0.17) head.push(v);
  }
  const depth = (p) => {
    const r = Math.hypot(p.x + 0.045, p.z);
    return r < 0.031 && p.y > -0.035 && p.y < 0.072 ? Math.min(0.031 - r, p.y + 0.035, 0.072 - p.y) : 0;
  };
  const rig = createClassicAvatar({ ...DEFAULT_AVATAR, equip: { ...DEFAULT_AVATAR.equip, rightHandItem: 'beer', leftHandItem: 'beer' } }, material);
  let neck;
  rig.object.traverse((o) => { if (o.isGroup && o.position.x === 0 && Math.abs(o.position.y - 0.336) < 0.002) neck = o; });
  rig.update(still, 1);
  rig.drink('rightArm');
  const mouth = rig.handAttach.rightArm.children[0], pour = rig.handAttach.leftArm.children[0];
  let tipped = 0;
  for (let t = 0; t < 2.7; t += 1 / 60) {
    rig.update(still, 1 / 60);
    rig.object.updateMatrixWorld(true);
    tipped = Math.max(tipped, -neck.rotation.x);
    // The head's own vertices sit where the model has them; its pivot is at the neck.
    const face = neck.matrixWorld.clone().multiply(new Matrix4().makeTranslation(0, -neck.position.y, 0));
    const into = (glass) => {
      const m = glass.matrixWorld.clone().invert().multiply(face);
      return Math.max(...head.map((v) => depth(v.clone().applyMatrix4(m))));
    };
    const m = into(mouth), p = into(pour);
    assert.ok(m < 0.005, 'the drinking glass is in the face by ' + (m * 1000).toFixed(1) + ' mm at ' + t.toFixed(2) + ' s');
    assert.ok(p < 0.002, 'the pouring glass is in the face by ' + (p * 1000).toFixed(1) + ' mm at ' + t.toFixed(2) + ' s');
  }
  assert.ok(tipped > 0.3, 'the head never tipped back: ' + tipped);
  assert.ok(Math.abs(neck.rotation.x) < 1e-9, 'the head stayed tipped back after the relay');
  rig.dispose();
  whole.dispose();
  material.dispose();
});

test('the refined head preserves smooth Blender corner normals', () => {
  const head = avatarPlayerComponentGeometry(DEFAULT_AVATAR, ['Head']);
  const normals = head.attributes.normal;
  let smoothTriangles = 0;
  for (let i = 0; i < normals.count; i += 3) {
    const a = new Vector3().fromBufferAttribute(normals, i);
    const b = new Vector3().fromBufferAttribute(normals, i + 1);
    if (a.distanceTo(b) > .01) smoothTriangles++;
  }
  assert.ok(smoothTriangles > normals.count / 6, 'normals were flattened after export or merge');
  head.dispose();
});

test('the hero uses smooth shading without changing the shared island material', () => {
  const source = new MeshStandardMaterial({ vertexColors: true, flatShading: true });
  source.userData.uniforms = { uNight: { value: .7 } };
  source.onBeforeCompile = (shader) => { shader.uniforms.uNight = source.userData.uniforms.uNight; };
  const rig = createClassicAvatar(DEFAULT_AVATAR, source);
  const used = new Set();
  rig.object.traverse((o) => { if (o.isMesh) used.add(o.material); });
  assert.equal(used.size, 1);
  const smooth = [...used][0];
  assert.notEqual(smooth, source);
  assert.equal(smooth.flatShading, false);
  assert.equal(source.flatShading, true);
  const shader = { uniforms: {} }; smooth.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uNight, source.userData.uniforms.uNight);
  let smoothDisposed = false, sourceDisposed = false;
  smooth.addEventListener('dispose', () => { smoothDisposed = true; });
  source.addEventListener('dispose', () => { sourceDisposed = true; });
  rig.dispose();
  assert.ok(smoothDisposed);
  assert.equal(sourceDisposed, false);
  source.dispose();
});

test('Blender limb weights produce bending knees, ankles, elbows and wrists', () => {
  const material = new MeshBasicMaterial({ vertexColors:true });
  const rig = createClassicAvatar(DEFAULT_AVATAR, material);
  const pose = { moving:true, running:true, grounded:true, distance:.01, phase:0 };
  for(let i=0;i<80;i++)rig.update(pose,1/60);
  assert.deepEqual(Object.keys(rig.joints).sort(),['leftArm','leftLeg','rightArm','rightLeg']);
  for(const chain of Object.values(rig.joints)){
    // Root, bend and end, and a leg's toe at the ball of the foot.
    assert.equal(chain.skeleton.bones.length, chain.toe ? 4 : 3);
    assert.ok(Math.abs(chain.bend.rotation.x)>.1);
    assert.ok(Math.abs(chain.end.rotation.x)>.01);
  }
  let skinned=0;
  rig.object.updateMatrixWorld(true);
  rig.object.traverse(o=>{
    if(!o.isSkinnedMesh)return;
    skinned++;o.skeleton.update();
    const w=o.geometry.attributes.skinWeight;
    for(let i=0;i<w.count;i++){
      assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<2e-6);
      const p=new Vector3().fromBufferAttribute(o.geometry.attributes.position,i);
      o.applyBoneTransform(i,p);assert.ok(p.toArray().every(Number.isFinite));
    }
  });
  assert.ok(skinned>=8,'limbs and wearable leg armour must share skeletons');
  rig.dispose();material.dispose();
});

test('deformed shoe soles stay above the floor through walk and run cycles', () => {
 const material=new MeshBasicMaterial(),rig=createClassicAvatar(DEFAULT_AVATAR,material);
 const legs=[];rig.object.traverse(o=>{if(o.isSkinnedMesh && o.skeleton===rig.joints.leftLeg.skeleton || o.isSkinnedMesh && o.skeleton===rig.joints.rightLeg.skeleton)legs.push(o);});
 for(const running of [false,true])for(let frame=0;frame<180;frame++){
  rig.update({moving:true,running,grounded:true,distance:(running?1.10:.65)/60},1/60);
  rig.object.updateMatrixWorld(true);let lowest=Infinity;
  for(const mesh of legs){mesh.skeleton.update();const a=mesh.geometry.attributes;
   for(let i=0;i<a.position.count;i++){if(a.skinWeight.getZ(i)<.999)continue;const v=new Vector3().fromBufferAttribute(a.position,i);mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);lowest=Math.min(lowest,v.y);}
  }
  assert.ok(lowest>-.004, 'sole penetrates the ground: '+lowest);
  if(!running && frame>120)assert.ok(lowest<.004,'walking lost ground contact: '+lowest);
 }
 rig.dispose();material.dispose();
});
