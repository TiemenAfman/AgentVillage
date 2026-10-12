// The skinned residents walk on their own stride (settler-figures.js walkCadence, walkSwing): the
// keeper's "haal het rare wiebelen uit het lopen" (12 October 2026). The old walk ran off a clock of
// its own - three and a half steps a second whatever the speed, the feet sliding a third ahead of the
// ground, the whole body rocking about its feet and bobbing highest with its legs apart. Held here:
// the stance foot stays put on the ground, the cadence is a person's, and the step is as long as the
// leg can make it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { walkCadence, walkSwing, createFigures, settlerLook, eyeHeight } = await import('../web/js/settler-figures.js');
const { residentRig, JOINT } = await import('../web/js/resident-skin.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const legOf = (sex) => {
  const p = residentRig(sex).points;
  return p[JOINT.leftHip][1] - p[JOINT.leftAnkle][1];
};

test('a resident sets a foot down and leaves it there as the body goes over it', () => {
  for (const sex of ['male', 'female']) {
    for (const speed of [0.42, 0.5, 0.56, 1.1]) {
      for (const height of [0.92, 1, 1.08]) {
        const f = { sex, speed, look: { height }, baseScale: 1 };
        const leg = legOf(sex) * height, swing = walkSwing(f), w = walkCadence(f);
        // The left thigh's angle goes as sin(phase) and back is positive, so the left foot is planted
        // while the sine rises through zero. Its place on the ground is the body's plus its offset
        // under the hip: how far that slides, against how far the body went.
        const at = (t) => speed * t - leg * Math.sin(Math.sin(w * t) * swing);
        const half = Math.PI / w;
        const t0 = -half / 2, t1 = half / 2;
        const slid = Math.abs(at(t1) - at(t0)), went = speed * half;
        assert.ok(slid < went * 0.12, `${sex} at ${speed}, height ${height}: the foot slid ${slid.toFixed(3)} of ${went.toFixed(3)}`);
      }
    }
  }
});

test('a resident walks at a person\'s cadence, not at a clock of its own', () => {
  for (const sex of ['male', 'female']) {
    const walk = walkCadence({ sex, speed: 0.48, look: { height: 1 }, baseScale: 1 });
    const steps = walk / Math.PI;           // two steps a cycle
    assert.ok(steps > 1.6 && steps < 2.6, `${sex}: ${steps.toFixed(2)} steps a second at a walk`);
    // An apprentice is smaller and takes quicker steps at the same speed.
    assert.ok(walkCadence({ sex, speed: 0.48, look: { height: 1 }, baseScale: 0.62 }) > walk);
  }
});

// "Maak alle inwoners ook ongeveer even groot" (the keeper, 12 October 2026): the skinned body is drawn
// with a few percent of the look's height (settler-figures.js drawnLook - the look itself, and so the
// stride on the sea, stays), and an apprentice a little smaller rather than a child. Held on enrolled
// figures, through the reading the conversation camera uses (eyeHeight), so it stays a resident's eye.
test('every resident stands about as tall as every other', () => {
  const view = createFigures(new THREE.Scene(), new THREE.MeshBasicMaterial(), { skinned: true });
  const eyes = { male: [], female: [] };
  const kinds = ['adult', 'adult', 'sailor', 'apprentice'];
  for (let i = 0; i < 240; i++) {
    const id = `height:${i}`, kind = kinds[i % 4];
    const presentation = Math.floor(i / 4) % 2 ? 'woman' : 'man';      // every kind of either
    const f = { id, visible: true, pos: [0, 0], y: 0, yaw: 0, anim: 'still', mode: 'idle', speed: 0 };
    assert.ok(view.enrol(f, { ...settlerLook(id, 'sonnet', kind), presentation, outfit: 'trousers' }, kind));
    eyes[f.sex].push(eyeHeight(f));
  }
  for (const [sex, list] of Object.entries(eyes)) {
    const mid = list.reduce((a, b) => a + b, 0) / list.length;
    const spread = (Math.max(...list) - Math.min(...list)) / mid;
    assert.ok(spread < 0.12, `${sex}: eyes from ${Math.min(...list).toFixed(3)} to ${Math.max(...list).toFixed(3)}, ${(spread * 100).toFixed(1)}% apart`);
  }
  // A man and a woman may differ, but not by much.
  const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length;
  assert.ok(Math.abs(mean(eyes.male) - mean(eyes.female)) / mean(eyes.male) < 0.05);
});
