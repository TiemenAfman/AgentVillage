// What a skinned resident wears (Plans/inwoners-in-avonturierstijl.md, fase 4): shared/palette.mjs
// residentWardrobe, a stream of its own that never touches the one the stride is hashed from; the
// skin's bare pieces in one geometry, shown per outfit by a mask; and figureGeometry built from the
// same pieces for the rooms and the model sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { residentWardrobe, settlerLook, keeperLook, KEEPERS, RESIDENT_HAIR } = await import('shared/palette.mjs');
const skin = await import('../web/js/resident-skin.js');
const { figureGeometry } = await import('../web/js/settler-figures.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];
const KINDS = ['adult', 'sailor', 'apprentice'];

test('the wardrobe is its own stream: the same id dresses the same, and the look is untouched', () => {
  for (let i = 0; i < 200; i++) {
    const id = `house:${i}`, style = STYLES[i % 5], kind = KINDS[i % 3];
    const look = settlerLook(id, style, kind);
    const before = JSON.stringify(look);
    const a = residentWardrobe(id, look, kind), b = residentWardrobe(id, settlerLook(id, style, kind), kind);
    assert.deepEqual(a, b, `${id} dressed twice two ways`);
    assert.equal(JSON.stringify(look), before, 'the wardrobe wrote on the look');
  }
});

test('everybody wears a top, something on the legs and on the feet, from what the bake has', () => {
  const seen = new Set();
  for (let i = 0; i < 600; i++) {
    const id = `house:${i}`, kind = KINDS[i % 3];
    const look = { ...settlerLook(id, STYLES[i % 5], kind), presentation: i % 2 ? 'woman' : 'man' };
    const w = residentWardrobe(id, look, kind);
    assert.ok(['shirt', 'dress'].includes(w.top));
    assert.ok(w.top === 'dress' ? w.bottom === null : ['trousers', 'skirt'].includes(w.bottom));
    if (w.top === 'dress') assert.equal(w.sex, 'female', 'a dress on a man who is no priest');
    if (w.bottom === 'skirt') assert.equal(w.sex, 'female');
    assert.ok(RESIDENT_HAIR[w.sex].includes(w.hair));
    if (kind === 'sailor') assert.ok(w.scarf && w.over === null, 'a sailor out of uniform');
    for (const part of [w.top, w.bottom, w.feet, w.over, w.scarf ? 'scarf' : null, w.hair ? 'hair:' + w.hair : null]) {
      if (!part) continue;
      assert.ok(skin.residentPartOf(w.sex, part), `${w.sex} has no ${part} in the bake`);
      seen.add(part);
    }
    for (const c of Object.values(w.colors)) assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff);
  }
  for (const part of ['shirt', 'dress', 'trousers', 'skirt', 'shoes', 'clogs', 'vest', 'apron', 'scarf']) {
    assert.ok(seen.has(part), `nobody ever wears ${part}`);
  }
});

test('the keepers wear what their post asks', () => {
  const wear = (civicType) => residentWardrobe(`civic:${civicType}`, keeperLook({ kind: 'civic', civicType, id: `civic:${civicType}` }));
  assert.equal(wear('tavern').over, 'apron');
  assert.equal(wear('townhall').over, 'vest');
  assert.equal(wear('chapel').top, 'dress');
  assert.ok(wear('pirate').scarf);
  // And every one of them can be dressed from the bake: a colour put where a garment's name goes
  // once dressed the mayor in a shirt called 15263962, and the whole crowd failed to enrol.
  for (const civicType of Object.keys(KEEPERS)) {
    const w = wear(civicType);
    for (const part of [w.top, w.bottom, w.feet, w.over, w.scarf ? 'scarf' : null, w.hair ? 'hair:' + w.hair : null]) {
      if (part) assert.ok(skin.residentPartOf(w.sex, part), `the ${civicType} keeper wears ${part}, which the bake has not got`);
    }
    for (const c of Object.values(w.colors)) assert.ok(Number.isInteger(c), `the ${civicType} keeper is dyed ${c}`);
  }
});

test('the skin is one geometry, and each outfit shows its own bare pieces', () => {
  for (const sex of ['male', 'female']) {
    const g = skin.residentSkinGeometry(sex, 4);
    const mask = g.attributes.aMask.array;
    const pieces = skin.skinPieces(sex);
    let at = 0;
    for (const p of pieces) {
      const n = p.positions.length / 3;
      const want = p.shows.length === skin.SKIN_COMBOS.length ? 0 : p.mask;
      for (let i = at; i < at + n; i++) assert.equal(mask[i], want, `${sex} ${p.id}`);
      at += n;
    }
    assert.equal(at, g.attributes.position.count);
    // Every outfit shows the always part, and a bare piece exactly when its shows names it.
    for (const combo of skin.SKIN_COMBOS) {
      const [bottom, feet] = combo.split('/');
      const show = skin.skinShow(bottom, feet);
      for (const p of pieces) {
        assert.equal(p.shows.length === 4 || (p.mask & show) !== 0, p.shows.includes(combo), `${sex} ${p.id} for ${combo}`);
      }
    }
  }
});

test('a room figure is the crowd own pieces, standing at the look height', () => {
  for (const presentation of ['man', 'woman']) {
    const look = { ...settlerLook('room:1', 'sonnet'), presentation, height: 1.08, hatShape: 'none' };
    const g = figureGeometry('sonnet', { look, skinned: true, id: 'room:1' });
    g.computeBoundingBox();
    const sex = presentation === 'woman' ? 'female' : 'male';
    const tall = skin.residentRig(sex).height * 1.08;
    assert.ok(Math.abs(g.boundingBox.min.y) < 0.01, `the ${presentation} stands ${g.boundingBox.min.y} off the floor`);
    assert.ok(g.boundingBox.max.y > tall * 0.95 && g.boundingBox.max.y < tall + 0.04, `the ${presentation} is ${g.boundingBox.max.y} tall, not about ${tall}`);
    assert.ok(g.attributes.color && g.attributes.aEmissive);
  }
  // And without the flag it is the old figure, as walk.js's satchel and hat expect.
  assert.ok(figureGeometry('sonnet', { skinned: false }).attributes.position.count > 0);
});
