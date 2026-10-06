// Who says hello (web/js/greetings.js, Plans/meer-geluiden.md, "Begroeting op straat"): close, in
// front of you, once a while per settler and once a few seconds on the island; two of ours passing
// each other now and then; and a voice of their own off a stream nobody else reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);
const { createGreeter, voiceOf, GREET_R, GREET_AGAIN, GREET_GAP, PASS_GAP, PHRASES } = await import('../web/js/greetings.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const fig = (id, x, z, anim = 'still') => ({ id, pos: [x, z], y: 0, anim, visible: true, hidden: false });
const east = { x: 0, z: 0, fx: 1, fz: 0 };

test('only somebody close and in front of you', () => {
  const g = createGreeter();
  assert.deepEqual(g.pick({ now: 0, walker: east, figures: [fig('a', GREET_R + 0.2, 0)] }), [], 'too far');
  assert.deepEqual(g.pick({ now: 0, walker: east, figures: [fig('a', -2, 0)] }), [], 'behind you');
  assert.deepEqual(g.pick({ now: 0, walker: east, figures: [fig('a', 0.3, 2)] }), [], 'off to the side');
  const hidden = { ...fig('a', 2, 0), visible: false };
  assert.deepEqual(g.pick({ now: 0, walker: east, figures: [hidden] }), [], 'not drawn, not there');
  const [hi] = g.pick({ now: 0, walker: east, figures: [fig('far', 3, 0), fig('near', 1.5, 0.2)] });
  assert.equal(hi.id, 'near', 'the nearest of them');
  assert.equal(hi.to, 'you');
  assert.deepEqual(hi.at, [1.5, 1.1, 0.2], 'from their head');
});

test('once in a while per settler, and never two at once on the island', () => {
  const g = createGreeter();
  const a = fig('a', 2, 0), b = fig('b', 2.5, 0.4);
  assert.equal(g.pick({ now: 0, walker: east, figures: [a] }).length, 1);
  assert.equal(g.pick({ now: GREET_GAP + 1, walker: east, figures: [a] }).length, 0, 'not again soon');
  assert.equal(g.pick({ now: 1, walker: east, figures: [b] }).length, 0, 'and nobody else within the gap');
  assert.equal(g.pick({ now: GREET_GAP + 0.1, walker: east, figures: [b] }).length, 1, 'after it, the next one');
  assert.equal(g.pick({ now: GREET_AGAIN + 1, walker: east, figures: [a] }).length, 1, 'and the first again after a while');
});

test('two of ours passing in the street say something, rarely, the same one each time', () => {
  const g = createGreeter();
  const a = fig('house:b', 5, 5, 'walk'), b = fig('house:a', 5.8, 5.4, 'walk'), c = fig('house:c', 9, 9, 'still');
  const [say] = g.pick({ now: 0, walker: null, figures: [a, b, c], ear: [0, 0] });
  assert.equal(say.to, 'them');
  assert.equal(say.id, 'house:a', 'the lower id speaks');
  assert.equal(g.pick({ now: 5, walker: null, figures: [a, b], ear: [0, 0] }).length, 0);
  assert.equal(g.pick({ now: PASS_GAP + 1, walker: null, figures: [a, b], ear: [0, 0] }).length, 0, 'not the same two straight after');
  assert.equal(g.pick({ now: 0, walker: null, figures: [fig('x', 50, 0, 'walk'), fig('y', 50.5, 0, 'walk')], ear: [0, 0] }).length, 0);
  const g2 = createGreeter();
  assert.equal(g2.pick({ now: 0, walker: null, figures: [fig('s', 1, 1, 'still'), fig('t', 1.2, 1, 'still')], ear: [0, 0] }).length, 0, 'standing still is not passing');
});

test('a voice of their own: the same every time, different between settlers', () => {
  const a = voiceOf('house:s1');
  assert.deepEqual(voiceOf('house:s1'), a);
  const rates = new Set();
  for (let i = 0; i < 40; i++) {
    const v = voiceOf(`house:s${i}`);
    assert.ok(v.rate >= 0.8 && v.rate <= 1.35);
    assert.ok(Number.isInteger(v.phrase) && v.phrase >= 0 && v.phrase < PHRASES);
    rates.add(Math.round(v.rate * 100));
  }
  assert.ok(rates.size > 20, 'forty settlers are not four voices');
});

test('the voice comes off a stream of its own, never the walk\'s', () => {
  const code = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'greetings.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(code.includes('`${id}:voice`'));
  assert.ok(!/:walk`/.test(code), 'the walk\'s stream is ordered and load-bearing');
  assert.ok(!/document|window|fetch\(/.test(code), 'pure');
});
