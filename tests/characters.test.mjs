// The two bodies a player can choose (Plans/tweede-avonturier.md): the Traveller and the
// Adventurer. Held here: that a look names one and falls back to the Traveller for anything
// else, that the Adventurer's bake keeps the Traveller's contract (every wardrobe part under
// the same name, limbs skinned to three joints, feet on the ground), that one rig can change
// body without its caller noticing, and that the inventory draws every slot on either body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import { Group, MeshBasicMaterial, Vector3 } from 'three';
// Dynamic for the loader's sake, and with the document stub: classic-avatar.js reaches
// buildings.js, which builds a TextureLoader at import time (the avatar.test.mjs preamble).
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { CHARACTERS, DEFAULT_AVATAR, normalizeAvatar, loadAvatar, saveAvatar, avatarPlayerGeometry, eyeOf, HAT_SHAPES } =
  await import('../web/js/avatar.js');
const { createClassicAvatar, PIECE_PARTS } = await import('../web/js/classic-avatar.js');
const { INVENTORY_SLOTS, slotIcon, optionIcon, characterIcon, dyeApplies, iconGeometry } = await import('../web/js/inventory.js');
const { ADVENTURER_PARTS, ADVENTURER_RIG, ADVENTURER_EYE_Y } = await import('../web/js/adventurer-mesh.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const ADVENTURER = { ...DEFAULT_AVATAR, character: 'adventurer' };

test('both eyes retain dark pupils and coloured irises after the repeating UV bake', () => {
  const eyes = ADVENTURER_PARTS.filter((p) => p.name.includes('Eyeball'));
  assert.equal(eyes.length, 2);
  for (const eye of eyes) {
    let dark = 0, white = 0, iris = 0;
    for (let i = 0; i < eye.colors.length; i += 3) {
      const [r, g, b] = eye.colors.slice(i, i + 3);
      if (Math.max(r, g, b) < .15) dark++;
      if (Math.min(r, g, b) > .6) white++;
      if (g > b * 1.3 && g > .1) iris++;
    }
    assert.ok(dark > 10 && white > 10 && iris > 10, `${eye.name}: ${dark} pupil, ${white} white, ${iris} iris`);
  }
});

test('both hands have weighted knuckles, relax, grip independently and survive redressing', () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(ADVENTURER, material);
  for (const side of ['leftArm', 'rightArm']) {
    const chain = rig.joints[side];
    assert.equal(chain.fingers.length, 15);
    assert.equal(chain.skeleton.bones.length, 23);
    for (const f of chain.fingers) assert.ok(f.bone.quaternion.angleTo(chain.root.quaternion) > .05);
    const weighted = new Set();
    for (const part of ADVENTURER_PARTS.filter((p) => p.group === side && p.skinIndices)) {
      for (let i = 0; i < part.skinIndices.length; i++) {
        assert.ok(part.skinIndices[i] < 23);
        if (part.skinWeights[i] > .01) weighted.add(part.skinIndices[i]);
      }
    }
    for (let i = 8; i < 23; i++) assert.ok(weighted.has(i), `${side} knuckle ${i} has no vertices`);
  }
  const finger = rig.joints.rightArm.fingers[4];
  const relaxed = finger.bone.quaternion.clone();
  rig.set({ ...ADVENTURER, equip: { ...ADVENTURER.equip, rightHandItem: 'hammer' } });
  for (let i = 0; i < 90; i++) rig.update({ grounded: true }, 1 / 60);
  assert.ok(finger.bone.quaternion.angleTo(relaxed) > .5);
  assert.ok(rig.joints.leftArm.grasp < .001);
  rig.set(ADVENTURER);
  for (let i = 0; i < 90; i++) rig.update({ grounded: true }, 1 / 60);
  assert.ok(finger.bone.quaternion.angleTo(relaxed) < .001);
  rig.dispose(); material.dispose();
});

test('sleeve boundary vertices stay joined to the torso through idle and sprint poses', () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(ADVENTURER, material);
  const meshes = [];
  rig.object.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const core = meshes.find((o) => o.skeleton.bones[0].name === 'torso:pelvis' && o.parent.position.y === 0);
  const key = (v) => v.toArray().map((x) => Math.round(x * 1e5)).join(',');
  const vertices = new Map();
  for (let i = 0; i < core.geometry.attributes.position.count; i++) {
    vertices.set(key(new Vector3().fromBufferAttribute(core.geometry.attributes.position, i)), i);
  }
  const seams = [];
  for (const arm of meshes.filter((o) => /Arm:root/.test(o.skeleton.bones[0].name))) {
    const p = arm.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const at = new Vector3().fromBufferAttribute(p, i).add(arm.parent.position);
      const index = vertices.get(key(at));
      if (index !== undefined && at.y > .3) seams.push([arm, i, index]);
    }
  }
  assert.ok(seams.length > 20, `only ${seams.length} shared sleeve vertices`);
  const point = (mesh, i) => mesh.applyBoneTransform(i,
    new Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)).applyMatrix4(mesh.matrixWorld);
  for (let frame = 0; frame < 90; frame++) {
    rig.update({ grounded: true, moving: frame > 20, running: frame > 20, sprinting: frame > 20,
      distance: frame > 20 ? rig.speeds.sprint / 60 : 0 }, 1 / 60);
    rig.object.updateMatrixWorld(true);
    for (const [arm, i, j] of seams) assert.ok(point(arm, i).distanceTo(point(core, j)) < .00003,
      `sleeve split at frame ${frame}: distance ${point(arm, i).distanceTo(point(core, j))}, at ${new Vector3().fromBufferAttribute(core.geometry.attributes.position, j).toArray()}, arm weights ${[0,1,2,3].map(k=>[arm.geometry.attributes.skinIndex.array[i*4+k],arm.geometry.attributes.skinWeight.array[i*4+k]])}`);
  }
  rig.dispose(); material.dispose();
});

test('exactly two bodies, the Traveller first and the default', () => {
  assert.deepEqual(CHARACTERS.map((c) => c.id), ['traveller', 'adventurer']);
  assert.equal(DEFAULT_AVATAR.character, 'traveller');
});

test('a look names its body, and anything that is not one is the Traveller', () => {
  assert.equal(normalizeAvatar({ character: 'adventurer' }).character, 'adventurer');
  for (const bad of [undefined, null, '', 'wizard', 42, '<img>', { id: 'adventurer' }]) {
    assert.equal(normalizeAvatar({ character: bad }).character, 'traveller', String(bad));
  }
});

test('a look saved before there was a choice opens on the Traveller and keeps what it wore', () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    const old = { skin: 0x8d5a3b, tunic: 0x335577, trim: 0x6b4a2f, hat: 0xc9a75c, hatShape: 'cap', equip: { backpack: false } };
    store.set('promptholm.avatar', JSON.stringify(old));
    const loaded = loadAvatar();
    assert.equal(loaded.character, 'traveller');
    assert.equal(loaded.hatShape, 'cap');
    assert.equal(loaded.tunic, 0x335577);
    saveAvatar({ ...loaded, character: 'adventurer' });
    assert.equal(loadAvatar().character, 'adventurer');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("the Adventurer's bake carries every wardrobe part the rig and the inventory ask for", () => {
  const names = new Set(ADVENTURER_PARTS.map((p) => p.name));
  for (const [piece, parts] of Object.entries(PIECE_PARTS)) {
    for (const name of parts) assert.ok(names.has(name), `${piece}: ${name}`);
  }
  for (const { id } of HAT_SHAPES.filter((h) => h.id !== 'none')) assert.ok(ADVENTURER_PARTS.some((p) => p.variant === id), id);
  assert.ok(ADVENTURER_PARTS.some((p) => p.variant === 'helmet'), 'helmet');
  // The hand items are the Traveller's own in every hand, so the bake carries none.
  assert.ok(!ADVENTURER_PARTS.some((p) => /^(Sword|Shield|Torch|Hammer)/.test(p.name)));
  for (const group of ['head', 'outfit', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg']) {
    assert.ok(ADVENTURER_PARTS.some((p) => p.variant === 'body' && p.group === group), group);
  }
  for (const p of ADVENTURER_PARTS) {
    const corners = p.positions.length / 3;
    assert.equal(p.normals.length, p.positions.length, p.name);
    if (p.colors) assert.equal(p.colors.length, p.positions.length, p.name);
    if (p.skinGroup) assert.equal(p.skin.length, corners * 2, p.name);
    if (p.variant === 'body') assert.ok(p.colors, `${p.name}: the body is painted per corner`);
  }
});

test('the Adventurer stands on the ground, as tall as a walker may be, eyes in its head', () => {
  const g = avatarPlayerGeometry(ADVENTURER);
  assert.ok(Math.abs(g.boundingBox.min.y) < .002, `feet at ${g.boundingBox.min.y}`);
  assert.ok(g.boundingBox.max.y <= .55, `top at ${g.boundingBox.max.y}`);
  assert.ok(eyeOf(ADVENTURER) < g.boundingBox.max.y && eyeOf(ADVENTURER) > g.boundingBox.max.y * .8);
  assert.ok(ADVENTURER_EYE_Y > ADVENTURER_RIG.head[1], 'the eyes are below the neck');
  g.dispose();
});

test('one rig changes body in place: same parent, a new skeleton, its own hips', () => {
  const material = new MeshBasicMaterial({ vertexColors: true });
  const rig = createClassicAvatar(DEFAULT_AVATAR, material);
  const holder = new Group();
  holder.add(rig.object);
  const travellerRoot = rig.object, travellerHips = rig.hipY;
  assert.equal(rig.character, 'traveller');
  rig.set({ ...ADVENTURER, equip: { ...ADVENTURER.equip, rightHandItem: 'sword' } });
  assert.equal(rig.character, 'adventurer');
  assert.notEqual(rig.object, travellerRoot);
  assert.equal(rig.object.parent, holder);
  assert.equal(travellerRoot.parent, null);
  assert.equal(holder.children.length, 1);
  assert.notEqual(rig.hipY, travellerHips);
  assert.equal(rig.held('rightArm'), 'sword');
  assert.equal(rig.handAttach.rightArm.children.length, 1, 'the sword went into the new hand');
  // The same body again is a redress, not a rebuild.
  const root = rig.object;
  rig.set({ ...ADVENTURER, hatShape: 'cap' });
  assert.equal(rig.object, root);
  rig.set(DEFAULT_AVATAR);
  assert.equal(rig.character, 'traveller');
  assert.equal(rig.object.parent, holder);
  rig.dispose();
  material.dispose();
});

test("the Adventurer's feet meet the ground through walk and run, and its limbs bend", () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(ADVENTURER, material);
  const legs = [];
  rig.object.traverse((o) => { if (o.isSkinnedMesh && (o.skeleton === rig.joints.leftLeg.skeleton || o.skeleton === rig.joints.rightLeg.skeleton)) legs.push(o); });
  assert.ok(legs.length >= 2);
  for (const running of [false, true]) {
    for (let frame = 0; frame < 180; frame++) {
      rig.update({ moving: true, running, grounded: true, distance: (running ? 1.10 : .65) / 60 }, 1 / 60);
      rig.object.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const mesh of legs) {
        mesh.skeleton.update();
        const a = mesh.geometry.attributes;
        for (let i = 0; i < a.position.count; i++) {
          if (a.skinWeight.getZ(i) < .9) continue;
          const v = new Vector3().fromBufferAttribute(a.position, i);
          mesh.applyBoneTransform(i, v);
          v.applyMatrix4(mesh.matrixWorld);
          lowest = Math.min(lowest, v.y);
        }
      }
      assert.ok(lowest > -.01, `sole in the ground: ${lowest}`);
      if (!running && frame > 120) assert.ok(lowest < .012, `walking lost the ground: ${lowest}`);
    }
  }
  for (const chain of Object.values(rig.joints)) assert.ok(Math.abs(chain.bend.rotation.x) > .05);
  rig.dispose();
  material.dispose();
});

test('the inventory draws every slot and every tile on either body, and a portrait of each', () => {
  for (const spec of [DEFAULT_AVATAR, ADVENTURER]) {
    for (const s of INVENTORY_SLOTS) {
      const icons = [slotIcon(s, spec), ...(s.options || []).map((o) => optionIcon(s, o.id, spec.character))];
      for (const icon of icons) {
        const g = iconGeometry(icon, spec);
        assert.ok(g.attributes.position.count > 0, `${spec.character} ${icon.id}`);
        g.dispose();
      }
    }
    const portrait = iconGeometry(characterIcon(spec.character), spec);
    assert.ok(portrait.attributes.position.count > 0);
    portrait.dispose();
  }
  // A fitted hat is not the same thumbnail on the other body.
  const head = INVENTORY_SLOTS.find((s) => s.id === 'head');
  assert.notEqual(slotIcon(head, DEFAULT_AVATAR).id, slotIcon(head, ADVENTURER).id);
});

test("the Adventurer's own skin and cloth are painted, so only the gear's dyes are offered", () => {
  for (const dye of ['skin', 'tunic', 'trim', 'hat']) assert.ok(dyeApplies(dye, 'traveller'), dye);
  assert.ok(!dyeApplies('skin', 'adventurer'));
  assert.ok(!dyeApplies('tunic', 'adventurer'));
  assert.ok(dyeApplies('hat', 'adventurer'));
  assert.ok(dyeApplies('trim', 'adventurer'));
});

test('the sea passes a body on as a slug and nothing else', async () => {
  const { createRoster } = await import('../lib/players.mjs');
  const roster = createRoster();
  const conn = { id: 'aaaaaaaaaaaa', send() {}, close() {} };
  const p = roster.attach(conn, {});
  roster.message(conn, JSON.stringify({ t: 'look', character: 'adventurer' }));
  assert.equal(p.look.character, 'adventurer');
  roster.message(conn, JSON.stringify({ t: 'look', character: { evil: true } }));
  assert.equal(p.look.character, null);
});

test('the source model is credited beside the files made from it', () => {
  const credits = readFileSync(new URL('../assets/adventurer/CREDITS.md', import.meta.url), 'utf8');
  for (const needle of ['CC BY 4.0', 'sketchfab.com/3d-models/link-c14d3de2cfc546ad94c3c9be4f24496a', 'A_CAT564']) {
    assert.ok(credits.includes(needle), needle);
  }
});

// Two jumps (Plans/tweede-avonturier.md): from standing Mixamo's Standing Jump, from a run its
// running Jump - chosen at the take-off by the speed the body leaves the ground with. It was
// once chosen off an eased value still at 0 on the first frame in the air, and every jump was
// the standing one.
test('a jump from standing is the standing jump, a jump from a run the running one', async () => {
  const { GAIT_CLIPS, GAIT_JOINTS } = await import('../web/js/gait-clips.js');
  const { Quaternion } = await import('three');
  const hip = GAIT_JOINTS.indexOf('lHip'), AIR_S = 2 * 3.1 / 12.5, frames = 15;
  const expected = (clip) => {
    const [a, b] = clip.air, u = a + (b - a) * Math.min(1, frames / 60 / AIR_S);
    const row = clip.rows[Math.round(u * clip.rows.length) % clip.rows.length];
    return new Quaternion(row[hip * 4], row[hip * 4 + 1], row[hip * 4 + 2], row[hip * 4 + 3]);
  };
  const legInAir = (speed) => {
    const rig = createClassicAvatar(ADVENTURER, new MeshBasicMaterial());
    for (let i = 0; i < 90; i++) rig.update({ moving: speed > 0, running: speed > 1, grounded: true, distance: speed / 60 }, 1 / 60);
    for (let i = 0; i < frames; i++) rig.update({ moving: false, running: speed > 1, grounded: false, distance: speed / 60 }, 1 / 60);
    return rig.joints.leftLeg.root.parent.parent.quaternion.clone();
  };
  const standing = legInAir(0), running = legInAir(rigSpeeds().run);
  const off = (q, clip) => q.angleTo(expected(clip));
  assert.ok(off(standing, GAIT_CLIPS.standingJump) < off(standing, GAIT_CLIPS.jump), 'a standing jump drew the running one');
  assert.ok(off(running, GAIT_CLIPS.jump) < off(running, GAIT_CLIPS.standingJump), 'a running jump drew the standing one');
  assert.ok(off(running, GAIT_CLIPS.jump) < 0.3, `a running jump's thigh is ${off(running, GAIT_CLIPS.jump)} off the clip`);
});
const rigSpeeds = () => createClassicAvatar(ADVENTURER, new MeshBasicMaterial()).speeds;
