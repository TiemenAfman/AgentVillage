// The sea kept out of the rowing boat (web/js/boat.js rowboatLid): her floorboards are 0.035 over
// still water and the swell is 0.09, so the water showed in the bottom of her and she looked to be
// sinking. A lid that writes depth and no colour, over her opening and under her gunwale, keeps it
// out. What is held: the lid is drawn after everything opaque (so not over the rower), lies inside
// her planking all round, under her sheer everywhere and over the highest the water reaches in her.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { rowboatLid, ROWBOAT_LID, createBoat } = await import('../web/js/boat.js');
const models = await import('../web/js/models.js');
const { DRAUGHT, FLOORBOARDS } = await import('../shared/hull.mjs');
delete globalThis.document;

// The swell's crest over still water (world.js aWave), and the hull's own bob and pitch over her
// half-length (boat.js BOB_RISE, BOB_PITCH): the highest the sea comes up inside her.
const CREST = 0.09 + 0.03 + 0.04 * 0.62;

const hullCorners = () => {
  const out = [];
  for (const n of models.assetParts('rowboat')) {
    if (/oar/.test(n)) continue;
    const part = models.part(n);
    const p = part.positions, at = part.at || [0, 0, 0];
    for (let i = 0; i < p.length; i += 3) out.push([p[i] + at[0], p[i + 1] + at[1], p[i + 2] + at[2]]);
  }
  return out;
};

test('the lid lies over the water inside her and under her gunwale', () => {
  const lid = rowboatLid();
  assert.ok(lid && lid.length >= 6, 'an outline');
  assert.ok(ROWBOAT_LID - DRAUGHT > CREST, `the lid at ${(ROWBOAT_LID - DRAUGHT).toFixed(3)} over the water is under a crest of ${CREST.toFixed(3)}`);
  assert.ok(ROWBOAT_LID > FLOORBOARDS + 0.05, 'and well over her floorboards');
  const corners = hullCorners();
  // Her sheer: at every slice of the lid's length, her planking reaches over the lid.
  for (const [x, z] of lid) {
    const near = corners.filter(([, , cz]) => Math.abs(cz - z) < 0.04);
    const sheer = Math.max(...near.map(([, y]) => y));
    assert.ok(sheer > ROWBOAT_LID, `at z ${z.toFixed(2)} her side stops at ${sheer.toFixed(3)}, under the lid`);
    // And inside her: as wide as her planking near the lid's height there, or less.
    const wide = Math.max(...near.filter(([, y]) => Math.abs(y - ROWBOAT_LID) < 0.04).map(([cx]) => Math.abs(cx)));
    assert.ok(Math.abs(x) <= wide + 1e-9, `at z ${z.toFixed(2)} the lid (${Math.abs(x).toFixed(3)}) is wider than she is (${wide.toFixed(3)})`);
  }
});

test('the boat carries it as a depth-only child drawn after everything opaque', () => {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial() });
  const lid = boat.object.children.find((c) => c.material && c.material.colorWrite === false);
  assert.ok(lid, 'a lid on the rowing boat');
  assert.ok(lid.renderOrder > 1, 'drawn after the opaque things in her, and with the water after it');
  assert.equal(lid.material.transparent, false);
  assert.equal(lid.material.depthWrite, true);
  assert.equal(lid.castShadow, false);
  const hits = [];
  lid.raycast(new THREE.Raycaster(), hits);
  assert.equal(hits.length, 0, 'nothing clicks on it');
  boat.dispose();
  const ship = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  assert.equal(ship.object.children.some((c) => c.material && c.material.colorWrite === false), false, 'the galleon has none');
  ship.dispose();
});
