// A yard sign's lettered face is drawn only where it can be read, and from far off the same
// cream spot is left on the board (Plans/naambord-gezichten-op-afstand.md). Two halves: the
// arithmetic of web/js/sign-faces.js, and the patch in the frame's shape that stands in for the
// face - the part that would go wrong without anybody noticing, as brown boards from above.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { screenWidth, faceOpacity, showFace, FACE_FULL, FACE_GONE } = await import('../web/js/sign-faces.js');

test('a face is about 780 / distance pixels wide on an 800-high window', () => {
  // The plan's numbers: a yard sign's face is 0.81 wide; the island's camera is 45 degrees.
  const at = (d) => screenWidth(0.81, d, 45, 800);
  assert.ok(Math.abs(at(60) - 13) < 0.5);
  assert.ok(Math.abs(at(32) - 24.4) < 0.5);
  assert.ok(Math.abs(at(12) - 65) < 0.5);
  // Twice as high a window, twice the pixels: legibility is per pixel, not per unit.
  assert.ok(Math.abs(screenWidth(0.81, 32, 45, 1600) - 2 * at(32)) < 1e-9);
  // A camera standing in the face (first person, nose to the board) does not divide by zero.
  assert.equal(screenWidth(0.81, 0, 45, 800), Infinity);
});

test('full above the threshold, gone below it, a straight ramp between', () => {
  assert.equal(faceOpacity(FACE_FULL), 1);
  assert.equal(faceOpacity(500), 1);
  assert.equal(faceOpacity(Infinity), 1);
  assert.equal(faceOpacity(FACE_GONE), 0);
  assert.equal(faceOpacity(3), 0);
  assert.ok(Math.abs(faceOpacity((FACE_FULL + FACE_GONE) / 2) - 0.5) < 1e-9);
  assert.ok(FACE_GONE < FACE_FULL);
});

test('showFace writes only on a change', () => {
  const writes = [];
  const face = { _v: true, get visible() { return this._v; }, set visible(v) { writes.push(['visible', v]); this._v = v; } };
  const mat = { _o: 1, get opacity() { return this._o; }, set opacity(v) { writes.push(['opacity', v]); this._o = v; } };
  showFace(face, mat, 1);
  assert.deepEqual(writes, []);
  showFace(face, mat, 0.5);
  assert.deepEqual(writes, [['opacity', 0.5]]);
  showFace(face, mat, 0);
  assert.deepEqual(writes.at(-1), ['visible', false]);
  writes.length = 0;
  showFace(face, mat, 0);
  assert.deepEqual(writes, []);
  showFace(face, mat, 1);
  assert.deepEqual(writes, [['visible', true], ['opacity', 1]]);
});

// The frame's shape in the batch, with the patch. nameplate.js paints a canvas only for the face,
// so a document whose canvas draws nothing is enough to build one.
const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
const THREE = await import('three');
const { createNameplate } = await import('../web/js/nameplate.js');

function fakeBatch() {
  const shapes = new Map();
  return {
    shapes,
    addShared(key, make) { if (!shapes.has(key)) shapes.set(key, make()); return new THREE.Object3D(); },
    remove() {},
  };
}

test('the frame in the batch carries a cream, glowing patch the face covers exactly', () => {
  const batch = fakeBatch();
  const plate = createNameplate('Hoogezand', { batch });
  const [geo] = batch.shapes.values();
  const pos = geo.attributes.position, col = geo.attributes.color, emi = geo.attributes.aEmissive;
  const cream = new THREE.Color(0xf3e7cf);
  const patch = [];
  for (let i = 0; i < pos.count; i++) if (emi.getX(i) > 0) patch.push(i);
  assert.equal(patch.length, 6, 'one quad, non-indexed');
  for (const i of patch) {
    assert.ok(Math.abs(col.getX(i) - cream.r) < 1e-6 && Math.abs(col.getY(i) - cream.g) < 1e-6);
    assert.ok(Math.abs(pos.getZ(i) - 0.016) < 1e-6, 'behind the face at 0.017, in front of the board at 0.015');
  }
  // The same rectangle as the face, so from far off the spot is exactly where the face was.
  const xs = patch.map((i) => pos.getX(i)), ys = patch.map((i) => pos.getY(i));
  plate.face.geometry.computeBoundingBox();
  const fb = plate.face.geometry.boundingBox;
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - (fb.max.x - fb.min.x)) < 1e-6);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - (fb.max.y - fb.min.y)) < 1e-6);
  assert.ok(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - plate.face.position.y) < 1e-6);
  assert.ok(Math.abs(plate.faceWidth - (fb.max.x - fb.min.x)) < 1e-6);
  assert.ok(Math.abs(plate.face.position.z - 0.017) < 1e-9);
  // Nothing else on the frame glows: the wood is lit like every other building.
  assert.equal(patch.length, [...emi.array].filter((v) => v > 0).length);
  assert.equal(plate.faceMat.transparent, true, 'the fade is its opacity, so it must already be transparent');
});

test('a gateway gets no patch: it keeps its faces at every distance', () => {
  const batch = fakeBatch();
  createNameplate('Noord', { batch, width: 2.1, height: 0.62, posts: 2, arch: 2.2 });
  const [geo] = batch.shapes.values();
  assert.equal([...geo.attributes.aEmissive.array].some((v) => v > 0), false);
});

test('main.js fades the faces before the cut, from the camera it draws with', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const cull = src.slice(src.indexOf('function cullRecords()'));
  assert.ok(/^function cullRecords\(\) \{\s+fadeSignFaces\(\);/.test(cull));
  // Never `rec.group.visible` (state, applyVisibility's), never the sign's group (the planner's).
  const body = src.slice(src.indexOf('function fadeSignFaces()'), src.indexOf('function cullRecords()'));
  assert.ok(!/\.visible\s*=/.test(body));
});
