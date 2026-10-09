// Over a harpoon's line walked flat (walk.js state.rope 'walk', Plans/harpoen.md): every body that plays
// Mixamo's clips walks Mixamo's Careful Walk (`ropeWalk`, one foot before the other, the arms out), played
// by distance through the bake's `along` so a planted foot stays where it was put; the Traveller, who
// plays none, keeps the gait with his arms held out (ROPE_SPREAD in classic-avatar.js); the clip's arms are lifted
// and stretched further (ROPE_CLIP_SPREAD, ROPE_CLIP_STRETCH), the keeper's ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import { Group, MeshBasicMaterial, Vector3 } from 'three';
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { normalizeAvatar, DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
const { loadWanderers } = await import('../web/js/player-bodies.js');
const { GAIT_CLIPS } = await import('../web/js/gait-clips.js');
const { ROPE_WALK } = await import('../shared/harpoon.mjs');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
await loadWanderers({ now: true });

const FRAME = 1 / 60;
const BODIES = {
  adventurer: { character: 'adventurer' },
  'wanderer-male': { character: 'adventurer', body: 'male' },
  'wanderer-female': { character: 'adventurer', body: 'female' },
};

test('the Careful Walk is baked to be played by distance: a stride, and how far along it each row is', () => {
  const c = GAIT_CLIPS.ropeWalk;
  assert.ok(c.stride > 1, `stride ${c.stride}`);
  assert.equal(c.along.length, c.rows.length);
  assert.equal(c.along[0], 0);
  for (let i = 1; i < c.along.length; i++) assert.ok(c.along[i] >= c.along[i - 1], `along goes back at ${i}`);
  assert.ok(c.along.at(-1) < 1);
});

// Walked along +z at ROPE_WALK: how far an ankle that is down (within a centimetre of its lowest) moves
// along the line in a frame, the worst and on average, after the fade onto the line.
function slide(look, frames = 300) {
  const material = new MeshBasicMaterial();
  const holder = new Group();
  const rig = createClassicAvatar(normalizeAvatar({ ...DEFAULT_AVATAR, ...look }), material);
  holder.add(rig.object);
  const step = ROPE_WALK * FRAME;
  const track = { leftLeg: [], rightLeg: [] };
  const at = new Vector3(), shoulder = new Vector3(), elbow = new Vector3();
  // how far the upper arms are lifted from hanging, on average: 0 hanging, 1 level (after the fade)
  let lift = 0, lifts = 0;
  for (let f = 0; f < frames; f++) {
    holder.position.z += step;
    rig.update({ moving: true, grounded: true, distance: step, roping: 'walk' }, FRAME);
    holder.updateMatrixWorld(true);
    for (const side of ['leftLeg', 'rightLeg']) {
      rig.joints[side].end.getWorldPosition(at);
      track[side].push(at.clone());
    }
    if (f >= 60) for (const side of ['leftArm', 'rightArm']) {
      rig.joints[side].root.getWorldPosition(shoulder);
      rig.joints[side].bend.getWorldPosition(elbow);
      lift += 1 + (elbow.y - shoulder.y) / elbow.distanceTo(shoulder); lifts++;
    }
  }
  let worst = 0, sum = 0, n = 0;
  for (const side of ['leftLeg', 'rightLeg']) {
    const t = track[side].slice(60);
    const low = Math.min(...t.map((p) => p.y));
    for (let i = 1; i < t.length; i++) {
      if (t[i].y > low + 0.01 || t[i - 1].y > low + 0.01) continue;
      const d = Math.abs(t[i].z - t[i - 1].z);
      worst = Math.max(worst, d); sum += d; n++;
    }
  }
  rig.dispose();
  material.dispose();
  return { worst, mean: sum / n, n, step, arms: lift / lifts };
}

for (const [name, look] of Object.entries(BODIES)) {
  test(`${name}: on the line it walks the Careful Walk, and a planted foot stays put`, () => {
    const { worst, mean, n, step, arms } = slide(look);
    // the arms stretched out to the sides, near level - over the clip's own, which are out some 37 degrees
    assert.ok(arms > 0.7, `arms lifted ${arms.toFixed(2)} of level`);
    assert.ok(n > 100, `a foot is down ${n} frames`);
    // The ankle of a foot that rolls heel to toe moves a little; the body goes `step` a frame.
    assert.ok(mean < step / 5, `a planted foot slid ${mean.toFixed(4)} a frame on average, the body ${step.toFixed(4)}`);
    assert.ok(worst < step / 2, `a planted foot slid ${worst.toFixed(4)} in a frame of ${step.toFixed(4)}`);
  });
}

test('played evenly, the same clip slides the planted foot about twice as far: `along` keeps it still', () => {
  const clip = GAIT_CLIPS.ropeWalk, along = clip.along;
  const kept = slide(BODIES.adventurer).mean;
  try {
    clip.along = along.map((_, i) => i / along.length);
    const even = slide(BODIES.adventurer).mean;
    assert.ok(kept < even * 0.7, `along ${kept.toFixed(4)}, evenly ${even.toFixed(4)}`);
  } finally {
    clip.along = along;
  }
});

test('the Traveller, who plays no clips, holds his arms out over his gait', () => {
  const material = new MeshBasicMaterial();
  const rig = createClassicAvatar(normalizeAvatar({ ...DEFAULT_AVATAR, character: 'traveller' }), material);
  const elbow = new Vector3(), shoulder = new Vector3();
  // how far the upper arm is lifted from hanging: 0 hanging straight down, 1 level
  const spread = () => {
    rig.object.updateMatrixWorld(true);
    rig.joints.leftArm.root.getWorldPosition(shoulder);
    rig.joints.leftArm.bend.getWorldPosition(elbow);
    return 1 + (elbow.y - shoulder.y) / elbow.distanceTo(shoulder);
  };
  for (let f = 0; f < 60; f++) rig.update({ moving: true, grounded: true, distance: ROPE_WALK * FRAME }, FRAME);
  const walking = spread();
  for (let f = 0; f < 60; f++) rig.update({ moving: true, grounded: true, distance: ROPE_WALK * FRAME, roping: 'walk' }, FRAME);
  assert.ok(spread() > walking + 0.1, `arms out ${spread().toFixed(2)} against ${walking.toFixed(2)} walking`);
  rig.dispose();
  material.dispose();
});
