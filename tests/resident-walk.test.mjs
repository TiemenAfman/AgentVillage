// The skinned residents walk on their own stride (settler-figures.js walkCadence, walkSwing): the
// keeper's "haal het rare wiebelen uit het lopen" (12 October 2026). The old walk ran off a clock of
// its own - three and a half steps a second whatever the speed, the feet sliding a third ahead of the
// ground, the whole body rocking about its feet and bobbing highest with its legs apart. Held here:
// the stance foot stays put on the ground, the cadence is a person's, and the step is as long as the
// leg can make it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { walkCadence, walkSwing } = await import('../web/js/settler-figures.js');
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
