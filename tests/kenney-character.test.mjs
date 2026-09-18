import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MODEL = new URL('../web/models/kenney/character-male-a.glb', import.meta.url);
const TEXTURE = new URL('../web/models/kenney/Textures/colormap.png', import.meta.url);

function glbJson(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
}

test('the Kenney player model ships with locomotion loops', () => {
  const model = glbJson(MODEL);
  const animations = new Set(model.animations.map(({ name }) => name));
  for (const name of ['idle', 'walk', 'sprint', 'fall', 'crouch', 'sit']) {
    assert.ok(animations.has(name), `missing ${name} animation`);
  }
  assert.ok(model.skins?.length, 'character must stay rigged');
  assert.ok(fs.statSync(TEXTURE).size > 0, 'external character texture must be shipped');
  assert.deepEqual(model.images?.map(({ uri }) => uri), ['Textures/colormap.png']);
});
