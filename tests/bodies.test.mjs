// The Wanderer: a man and a woman in their underwear, clothes worn over them one garment at a time,
// hairstyles, hair and skin dyed (Plans/basislichamen-en-outfits.md). Held here: that a look names them the way an older page and
// an older sea can still read (the Adventurer), that the bake keeps the contract classic-avatar.js
// reads, that an outfit hides the skin under it and only that, that hair and skin follow the look
// and are as baked at its defaults, that both bodies stand and walk on the ground, and that the
// sea hands the new fields on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import { MeshBasicMaterial, Vector3, Color } from 'three';
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { CHARACTERS, CHARACTER_PICKS, DEFAULT_AVATAR, GARMENTS, HAIR_STYLES, PLAYER_SCALE, normalizeAvatar, avatarPlayerGeometry, avatarFigureGeometry,
  characterOf, bodyKey, pickOf, eyeOf, SWATCHES } = await import('../web/js/avatar.js');
const { createClassicAvatar, horsebackOf } = await import('../web/js/classic-avatar.js');
const { INVENTORY_SLOTS, slotIcon, optionIcon, characterIcon, dyeApplies, iconGeometry, slotPicks, slotOffers, lookOn,
  garmentOptions, garmentWorn, wearIn, garmentIcon, hairStyles, hairIcon } = await import('../web/js/inventory.js');
const { BODIES } = await import('../web/js/bodies-mesh.js');
const { PART_COLORS, loadWanderers } = await import('../web/js/player-bodies.js');
// Their triangles are loaded only when somebody wears one (tests/bodies-lazy.test.mjs); here, at once.
assert.equal(await loadWanderers({ now: true }), true);
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const WOMAN = normalizeAvatar({ ...DEFAULT_AVATAR, character: 'adventurer', body: 'female' });
const MAN = normalizeAvatar({ ...DEFAULT_AVATAR, character: 'adventurer', body: 'male' });
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a Wanderer goes out as the Adventurer with a body, which older readers draw as the Adventurer', () => {
  assert.deepEqual(CHARACTER_PICKS.map((c) => c.id), ['traveller', 'adventurer', 'wanderer']);
  assert.equal(WOMAN.character, 'adventurer');
  assert.equal(WOMAN.body, 'female');
  assert.equal(bodyKey(WOMAN), 'wanderer-female');
  assert.equal(characterOf(WOMAN).id, 'wanderer-female');
  assert.equal(pickOf(WOMAN), 'wanderer');
  // A page from before the Wanderer reads only `character`; its normalizeAvatar dropped `body`.
  const older = { ...WOMAN }; delete older.body;
  assert.equal(characterOf(older).id, 'adventurer');
  // Nonsense in `body` is no body; a body forces the character, so the wire always says Adventurer.
  for (const bad of [undefined, null, 'other', 1, { sex: 'female' }]) assert.equal(normalizeAvatar({ body: bad }).body, null);
  assert.equal(normalizeAvatar({ character: 'traveller', body: 'male' }).character, 'adventurer');
  assert.deepEqual(Object.keys(normalizeAvatar({}).wear), GARMENTS.map((g) => g.id));
  assert.equal(normalizeAvatar({ wear: { shirt: 'tuxedo' } }).wear.shirt, 'peasant', 'an unknown set is the default');
  assert.equal(normalizeAvatar({ wear: { shirt: null } }).wear.shirt, null, 'nothing is a choice');
  assert.equal(normalizeAvatar({ hairStyle: 'mohawk' }).hairStyle, null);
  // The ids the rig and the inventory use are never accepted as a `character` off the wire.
  assert.equal(normalizeAvatar({ character: 'wanderer-male' }).character, 'traveller');
});

test('the bakes are dyed against the look\'s own defaults', () => {
  // The Adventurer's: his hair and skin are as baked at the defaults. The Wanderer's are the kit's
  // tint maps over their own mean, so the default colours are simply what they are.
  for (const script of ['../scripts/build-adventurer.py']) {
    const src = read(script);
    assert.equal(Number(src.match(/DEFAULT_SKIN = (0x[0-9a-f]+)/)[1]), DEFAULT_AVATAR.skin, script);
    assert.equal(Number(src.match(/DEFAULT_HAIR = (0x[0-9a-f]+)/)[1]), DEFAULT_AVATAR.hair, script);
  }
  assert.equal(DEFAULT_AVATAR.hair, PART_COLORS.hair, "the Traveller's own hair is the default");
  assert.equal(SWATCHES.hair[0].hex, DEFAULT_AVATAR.hair);
});

test("each body's bake keeps the rig contract: chains, fingers, weights, a hide list in range", () => {
  for (const [sex, b] of Object.entries(BODIES)) {
    for (const k of ['leftLeg', 'rightLeg', 'leftArm', 'rightArm', 'head', 'grip']) assert.equal(b.rig[k]?.length, 3, `${sex} ${k}`);
    assert.ok(b.rig.leftArm[0] < 0 && b.rig.rightArm[0] > 0, 'the rig\'s left is at -x, like the Traveller\'s');
    for (const side of ['leftArm', 'rightArm']) assert.equal(b.fingers[side].length, 15);
    for (const p of b.parts) {
      const corners = p.positions.length / 3;
      assert.equal(p.normals.length, corners * 3, p.name);
      if (p.colors) assert.equal(p.colors.length, corners * 3, p.name);
      if (p.skinGroup) assert.equal(p.skin.length, corners * 2, p.name);
      if (p.skinIndices) {
        assert.equal(p.skinIndices.length, corners * 4, p.name);
        assert.ok(p.skinIndices.every((i) => i >= 0 && i < 23), p.name);
        for (let c = 0; c < corners; c++) {
          const sum = p.skinWeights.slice(c * 4, c * 4 + 4).reduce((a, w) => a + w, 0);
          assert.ok(Math.abs(sum - 1) < 1e-3, `${p.name}: weights sum to ${sum}`);
        }
      }
      for (const runs of Object.values(p.hide || {})) {
        for (let i = 0; i < runs.length; i += 2) assert.ok(runs[i] < runs[i + 1] && runs[i + 1] <= p.positions.length / 9 && (i === 0 || runs[i] > runs[i - 1]), p.name);
      }
      if (p.hide) assert.equal(p.slot === 'skin' || p.slot === 'underwear', true, `${p.name}: only the body hides`);
      if (p.skinGroup?.endsWith('Leg') && p.skinIndices) assert.ok(p.skinIndices.every((i) => i < 9), `${p.name}: a leg's chain, toe and torso`);
    }
  }
});

const NAKED = { shirt: null, trousers: null, shoes: null, straps: null };
test('each garment is baked on its own, hides the skin under it, and none of the face or the hands', () => {
  for (const spec of [WOMAN, MAN]) {
    const c = characterOf(spec);
    assert.deepEqual(GARMENTS.map((g) => g.id).filter((g) => c.parts.some((p) => p.variant === `garment:peasant-${g}`)),
      ['shirt', 'trousers', 'shoes', 'straps'], `${spec.body}: the peasant comes in four pieces`);
    const bare = avatarFigureGeometry({ ...spec, wear: NAKED }).attributes.position.count;
    for (const g of GARMENTS) {
      const one = avatarFigureGeometry({ ...spec, wear: { ...NAKED, [g.id]: 'peasant' } }).attributes.position.count;
      const own = c.parts.filter((p) => p.variant === `garment:peasant-${g.id}`).reduce((a, p) => a + p.positions.length / 3, 0);
      assert.ok(own > 0, `${spec.body} ${g.id}: a garment is parts of its own`);
      if (g.id !== 'straps') assert.ok(one < bare + own, `${spec.body} ${g.id}: the skin under it is left out`);
    }
    const hiddenBy = (p) => Object.values(p.hide || {}).flat().reduce((a, v, i, r) => (i % 2 ? a + v - r[i - 1] : a), 0);
    for (const p of c.parts.filter((x) => x.hide)) {
      const all = p.positions.length / 9;
      if (p.group === 'head') assert.ok(hiddenBy(p) / all < .05, `${p.name}: the face shows`);
    }
    // All of it on, and the hands still show.
    const arms = c.parts.filter((p) => /Arm$/.test(p.group) && p.slot === 'skin' && p.variant === 'body');
    for (const p of arms) {
      const keep = new Uint8Array(p.positions.length / 9).fill(1);
      for (const r of Object.values(p.hide || {})) for (let i = 0; i < r.length; i += 2) keep.fill(0, r[i], r[i + 1]);
      assert.ok(keep.reduce((a, v) => a + v, 0) > 300, `${p.name}: the hands show`);
    }
  }
});

test('a Wanderer chooses a hairstyle, and bald; every style is a head that renders', () => {
  for (const spec of [WOMAN, MAN]) {
    const id = characterOf(spec).id;
    const styles = hairStyles(id).map((h) => h.id);
    assert.ok(styles.length >= 4 && styles.includes('none'), `${spec.body}: ${styles}`);
    const counts = styles.map((h) => avatarFigureGeometry({ ...spec, hairStyle: h }).attributes.position.count);
    assert.equal(new Set(counts).size, counts.length, 'every style is its own hair');
    for (const h of styles) {
      const g = iconGeometry(hairIcon(h, id), spec);
      assert.ok(g.attributes.position.count > 0, h);
      g.dispose();
    }
  }
  assert.ok(HAIR_STYLES.every((h) => /^[a-z]+$/.test(h.id)));
});

test('hair and skin follow the look, and come out as baked at its defaults', () => {
  const tinted = (spec, slot) => {
    const name = characterOf(spec).parts.find((p) => p.tint && p.slot === slot).name;
    const g = avatarFigureGeometry({ ...spec });
    return { g, name };
  };
  for (const spec of [WOMAN, MAN, normalizeAvatar({ character: 'adventurer' })]) {
    const hairPart = characterOf(spec).parts.find((p) => p.tint && p.slot === 'hair');
    assert.ok(hairPart, `${bodyKey(spec)} has dyeable hair`);
    assert.ok(characterOf(spec).parts.some((p) => p.tint && p.slot === 'skin'), `${bodyKey(spec)} has dyeable skin`);
    // At the default the corner is the texel the bake divided: colour * default = texel.
    const base = new Color(DEFAULT_AVATAR.hair);
    const blond = new Color(0xe0c27a);
    const a = iconGeometry({ id: 'h', parts: [hairPart.name] }, spec).attributes.color.array;
    const b = iconGeometry({ id: 'h', parts: [hairPart.name] }, { ...spec, hair: 0xe0c27a }).attributes.color.array;
    assert.ok(Math.abs(a[0] / base.r - b[0] / blond.r) < 1e-4, 'a dye scales the same shading');
    assert.ok(b[0] > a[0], 'blond is lighter than brown');
    tinted(spec, 'skin').g.dispose();
  }
  for (const id of ['adventurer', 'wanderer-male', 'wanderer-female']) {
    assert.ok(dyeApplies('hair', id) && dyeApplies('skin', id), id);
  }
  assert.ok(!dyeApplies('tunic', 'wanderer-female'), 'an outfit is chosen, not dyed');
});

test('both Wanderers stand on the ground, a man a little taller, eyes in the head', () => {
  const tops = {};
  for (const spec of [WOMAN, MAN]) {
    const g = avatarPlayerGeometry(spec);
    assert.ok(Math.abs(g.boundingBox.min.y) < .004, `feet at ${g.boundingBox.min.y}`);
    assert.ok(g.boundingBox.max.y <= .55, `top at ${g.boundingBox.max.y}`);
    assert.ok(eyeOf(spec) < g.boundingBox.max.y && eyeOf(spec) > g.boundingBox.max.y * .8);
    tops[spec.body] = g.boundingBox.max.y;
    g.dispose();
  }
  assert.ok(tops.male > tops.female);
});

test("a Wanderer's feet meet the ground through walk and run, and the rig switches bodies in place", () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(WOMAN, material);
  assert.equal(rig.character, 'wanderer-female');
  for (const spec of [WOMAN, MAN]) {
    rig.set(spec);
    assert.equal(rig.character, bodyKey(spec));
    const legs = [];
    rig.object.traverse((o) => { if (o.isSkinnedMesh && (o.skeleton === rig.joints.leftLeg.skeleton || o.skeleton === rig.joints.rightLeg.skeleton)) legs.push(o); });
    assert.ok(legs.length >= 2);
    for (const running of [false, true]) {
      for (let frame = 0; frame < 150; frame++) {
        rig.update({ moving: true, running, grounded: true, distance: (running ? 1.10 : .65) / 60 }, 1 / 60);
        rig.object.updateMatrixWorld(true);
        let lowest = Infinity;
        for (const mesh of legs) {
          mesh.skeleton.update();
          const a = mesh.geometry.attributes;
          for (let i = 0; i < a.position.count; i += 3) {
            if (a.skinWeight.getZ(i) < .9) continue;
            const v = new Vector3().fromBufferAttribute(a.position, i);
            mesh.applyBoneTransform(i, v);
            v.applyMatrix4(mesh.matrixWorld);
            lowest = Math.min(lowest, v.y);
          }
        }
        assert.ok(lowest > -.015, `${spec.body}: sole in the ground: ${lowest}`);
        // The peasant's shoes have a heel, so the lowest sole corner at mid-stride stands a little
        // higher than the Adventurer's flat boot (.012 there).
        if (!running && frame > 110) assert.ok(lowest < .02, `${spec.body}: walking lost the ground: ${lowest}`);
      }
    }
    for (const chain of Object.values(rig.joints)) assert.ok(Math.abs(chain.bend.rotation.x) > .05);
  }
  assert.equal(horsebackOf('wanderer-female'), horsebackOf('adventurer'));
  rig.dispose();
  material.dispose();
});

// Martijn's choice (7 October 2026): CHEST, LEGS and FEET are the clothes, with the armour as a tile
// in their picker, ARMS the straps, and the Outfit is kept for a set worn over the clothes.
test('the inventory dresses a Wanderer through Chest, Arms, Legs and Feet, and draws every tile', () => {
  const slot = (id) => INVENTORY_SLOTS.find((s) => s.id === id);
  assert.deepEqual(['chest', 'arms', 'legs', 'feet'].map((id) => slot(id).garment), ['shirt', 'straps', 'trousers', 'shoes']);
  for (const spec of [WOMAN, MAN]) {
    const id = characterOf(spec).id;
    for (const s of INVENTORY_SLOTS) {
      const icons = [slotIcon(s, spec), ...(s.options || []).map((o) => optionIcon(s, o.id, id))];
      if (s.garment) {
        assert.ok(slotPicks(s, spec), s.id);
        icons.push(...garmentOptions(s, id).filter((o) => !o.armour).map((o) => garmentIcon(s.garment, o.id, id)));
      }
      for (const icon of icons) {
        const g = iconGeometry(icon, spec);
        assert.ok(g.attributes.position.count > 0, `${spec.body} ${icon.id}`);
        g.dispose();
      }
    }
    assert.ok(!slotOffers(slot('tunic'), spec), 'no outfit sets yet');
    const portrait = iconGeometry(characterIcon(bodyKey(spec)), spec);
    assert.ok(portrait.attributes.position.count > 0);
    portrait.dispose();
  }
  assert.ok(!slotPicks(slot('chest'), DEFAULT_AVATAR), "the Traveller's Chest is still the chestplate's toggle");
  assert.ok(!slotOffers(slot('arms'), DEFAULT_AVATAR));
  assert.equal(lookOn(DEFAULT_AVATAR, 'wanderer-male').body, 'male');
  assert.equal(lookOn(WOMAN, 'traveller').body, null);
});

test('the sea passes body, clothes, hairstyle and hair on, and nonsense as nothing', async () => {
  const { createRoster } = await import('../lib/players.mjs');
  const roster = createRoster();
  const conn = { id: 'aaaaaaaaaaaa', send() {}, close() {} };
  const p = roster.attach(conn, {});
  roster.message(conn, JSON.stringify({ t: 'look', character: 'adventurer', body: 'female', hairStyle: 'buns',
    wear: { shirt: 'peasant', trousers: null, shoes: 'peasant', straps: 'peasant', cape: 'x' }, hair: 0xe0c27a }));
  assert.equal(p.look.body, 'female');
  assert.equal(p.look.hairStyle, 'buns');
  assert.deepEqual(p.look.wear, { shirt: 'peasant', trousers: null, shoes: 'peasant', straps: 'peasant' });
  assert.equal(p.look.hair, 0xe0c27a);
  roster.message(conn, JSON.stringify({ t: 'look', character: 'adventurer', body: { evil: true }, hair: 'red' }));
  assert.equal(p.look.body, null);
  assert.equal(p.look.hair, null);
});

test('the CC0 source is credited beside the files made from it', () => {
  const credits = read('../assets/bodies/CREDITS.md');
  for (const needle of ['CC0', 'quaternius.itch.io/universal-base-characters', 'quaternius.itch.io/modular-character-outfits-fantasy']) {
    assert.ok(credits.includes(needle), needle);
  }
});

// Edit character (Plans/basislichamen-en-outfits.md): the shape's sliders. Bones carry height, hips,
// head, hands and feet - and whatever is worn on them; bust and build are worked into the geometry.
test('the shape sliders are numbers -1..1 in the look, and the sea hands them on clamped', async () => {
  const { SHAPES } = await import('../web/js/avatar.js');
  assert.deepEqual(SHAPES.map((s) => s.id), ['height', 'build', 'hips', 'bust', 'head', 'hands', 'feet']);
  const s = normalizeAvatar({ shape: { height: 3, bust: -0.333, head: 'big', feet: NaN } }).shape;
  assert.deepEqual(s, { height: 1, build: 0, hips: 0, bust: -0.33, head: 0, hands: 0, feet: 0 });
  const { createRoster } = await import('../lib/players.mjs');
  const roster = createRoster();
  const conn = { id: 'cccccccccccc', send() {}, close() {} };
  const p = roster.attach(conn, {});
  roster.message(conn, JSON.stringify({ t: 'look', shape: { height: 5, hips: -0.5, tail: 1, head: 'x' } }));
  assert.deepEqual(p.look.shape, { height: 1, hips: -0.5 });
});

test('height scales the figure and what walk mode reads off it; build and bust move the body, not the head', () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(WOMAN, material);
  const hip = rig.hipY, eye = rig.eye;
  rig.set({ ...WOMAN, shape: { ...WOMAN.shape, height: 1 } });
  assert.ok(Math.abs(rig.hipY - hip * 1.1) < 1e-9 && Math.abs(rig.eye - eye * 1.1) < 1e-9);
  assert.ok(rig.object.scale.x < 0, 'the mirror is kept');
  rig.set({ ...WOMAN, shape: { ...WOMAN.shape, height: 1, feet: 1, hands: 1, head: 1, hips: 1, build: 1 } });
  for (let frame = 0; frame < 120; frame++) rig.update({ moving: true, running: false, grounded: true, distance: .65 / 60 }, 1 / 60);
  rig.object.updateMatrixWorld(true);
  const box = new (rig.object.constructor)();
  let lowest = Infinity;
  rig.object.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 5) {
      const v = new Vector3().fromBufferAttribute(a, i);
      o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      lowest = Math.min(lowest, v.y);
    }
  });
  assert.ok(lowest > -.03, `big feet and a tall body stay out of the ground: ${lowest}`);
  rig.dispose();
  material.dispose();
  const head = (spec) => {
    const parts = characterOf(spec).parts.filter((p) => p.group === 'head' && p.variant === 'body').map((p) => p.name);
    return iconGeometry({ id: 'h', parts }, spec).attributes.position.array;
  };
  const torso = (spec) => iconGeometry({ id: 't', parts: characterOf(spec).parts.filter((p) => p.group === 'outfit' && p.slot === 'skin').map((p) => p.name) }, spec).attributes.position.array;
  const heavy = { ...WOMAN, wear: NAKED, shape: { ...WOMAN.shape, build: 1, bust: 1 } };
  // Above the neck's pivot: the neck itself goes with the build.
  const neckY = characterOf(WOMAN).rig.head[1] * PLAYER_SCALE;
  const face = (arr) => [...arr].filter((_, i, all) => i % 3 === 1 ? false : all[i - (i % 3) + 1] > neckY + .002);
  assert.deepEqual(face(head(heavy)), face(head({ ...WOMAN, wear: NAKED })), 'the face is the face');
  const a = torso({ ...WOMAN, wear: NAKED }), b = torso(heavy);
  let moved = 0;
  for (let i = 0; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i] - b[i]));
  assert.ok(moved > .003, `the torso changes shape: ${moved}`);
});

test('the armour is a piece of clothing in its slot: worn instead of the trousers, not over them', () => {
  const legs = INVENTORY_SLOTS.find((s) => s.id === 'legs');
  assert.deepEqual(garmentOptions(legs, 'wanderer-female').map((o) => o.id), ['peasant', 'armour', null]);
  const plated = wearIn(legs, WOMAN, 'armour');
  assert.equal(plated.wear.trousers, null);
  assert.equal(plated.equip.leggings, true);
  assert.equal(garmentWorn(legs, plated), 'armour');
  const back = wearIn(legs, plated, 'peasant');
  assert.equal(back.wear.trousers, 'peasant');
  assert.equal(back.equip.leggings, false);
  assert.equal(garmentWorn(legs, wearIn(legs, back, null)), null);
});
