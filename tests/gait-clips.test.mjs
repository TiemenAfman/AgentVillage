// The baked Mixamo clips (web/js/gait-clips.js, scripts/bake-mixamo-gait.py, the mixamo-clips skill):
// every clip assets/mixamo/clips.json lists is in the module, every row is a whole pose of unit
// quaternions, the gaits carry what playing by distance needs and the jumps their flight. The
// bake itself needs Blender; this holds what it wrote.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAIT_CLIPS, GAIT_JOINTS } from '../web/js/gait-clips.js';

const listed = JSON.parse(readFileSync(new URL('../assets/mixamo/clips.json', import.meta.url), 'utf8'));

// The FBX themselves are not in git (.gitignore: Mixamo's terms, a public repo), so only what
// was baked from them is held here.
test('every clip clips.json lists is baked, from its own file, and nothing else is', () => {
  assert.deepEqual(Object.keys(GAIT_CLIPS).sort(), Object.keys(listed).sort());
  for (const [name, file] of Object.entries(listed)) assert.equal(GAIT_CLIPS[name].source, file, name);
});

test('a row is a unit quaternion per joint and the hips\' drop', () => {
  for (const [name, clip] of Object.entries(GAIT_CLIPS)) {
    assert.ok(clip.rows.length >= 32, name);
    for (const row of clip.rows) {
      assert.equal(row.length, GAIT_JOINTS.length * 4 + 1, name);
      for (let j = 0; j < GAIT_JOINTS.length; j++) {
        const len = Math.hypot(row[j * 4], row[j * 4 + 1], row[j * 4 + 2], row[j * 4 + 3]);
        assert.ok(Math.abs(len - 1) < 2e-3, `${name} ${GAIT_JOINTS[j]}: ${len}`);
      }
      assert.ok(Number.isFinite(row[row.length - 1]));
    }
  }
});

test('the gaits stride and travel, faster each; the jumps know when they are in the air', () => {
  for (const name of ['walk', 'run', 'sprint']) {
    const c = GAIT_CLIPS[name];
    assert.ok(c.stride > 1 && c.speed > 1, `${name}: stride ${c.stride}, speed ${c.speed}`);
    assert.ok(c.contact >= 0 && c.contact < 1);
  }
  assert.ok(GAIT_CLIPS.walk.speed < GAIT_CLIPS.run.speed && GAIT_CLIPS.run.speed < GAIT_CLIPS.sprint.speed);
  for (const name of ['jump', 'standingJump']) {
    const [a, b] = GAIT_CLIPS[name].air;
    assert.ok(a >= 0 && a < b && b <= 1, `${name}: ${a}..${b}`);
  }
  for (const name of ['idle', 'swim', 'dig']) assert.ok(GAIT_CLIPS[name].seconds > 1, name);
});
