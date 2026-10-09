// TEMPORARY: the galleon's craft, now read off her bake (shared/craft-galleon.mjs), against the
// numbers shared/crafts.mjs carried by hand until Plans/nieuwe-sloep.md chip 2a - so that proving the
// pipeline moved nothing in the game. The old values are kept here word for word, as they were typed
// (the one `rail` helper included), and chip 4 - the sloop that replaces this hull - deletes this file.
//
// Two tolerances. 1e-3 on everything that is an anchor: the bake's own rounding (six decimals,
// scripts/export-models.py) through the waterline and DECK_Y. 1e-2 on the two heights the generator
// reads off the hull's triangles rather than off an anchor - the bulwark a side ladder is climbed over
// (the hand-typed 1.27 was itself a rounded reading of the same bake; it is 1.265) and the rim of the
// crow's nest (9.24, read 9.248). And one deliberate move: the harpooners' stands. The hand-typed stand
// was not on the bearing the gun was typed with (1.0 from (1.1, 3.25) to (0.78, 2.98) is 0.87), and
// in the bake the stand IS the bearing, so the stand was laid back along yaw 1.0 at the same distance:
// 4 cm from where it stood. The yaw is held exactly; the stand within 0.05.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAFTS, SHIP_DRAUGHT } from '../shared/crafts.mjs';

const BULWARK = 0.25;
const rail = (x, z, hx, hz, deckY) => Object.freeze({ x, z, hx, hz, top: deckY + BULWARK });

const OLD = {
  SHIP_TALL: 12.29,
  SHIP_DRAUGHT: 12.29 * 7 / 58.56,
  galleon: {
    crew: 5,
    helm: [0, -3.2],
    deck: [
      { x: 0, z: 0, hx: 1.75, hz: 2.3, y: 1.108 },
      { x: 0, z: 2.525, hx: 1.75, hz: 0.325, y: 1.212, slope: 0.31 },
      { x: 0, z: 3.125, hx: 1.35, hz: 0.275, y: 1.318 },
      { x: 0, z: 3.65, hx: 1.0, hz: 0.25, y: 1.318 },
      { x: 0, z: 4.25, hx: 0.6, hz: 0.35, y: 1.318 },
      { x: 0, z: 5.225, hx: 0.45, hz: 0.625, y: 1.77, slope: 0.4 },
      { x: 0, z: -3.45, hx: 1.8, hz: 1.15, y: 1.738 },
      ...[-1, 1].flatMap((s) => [
        { x: s * 1.5, z: -1.725, hx: 0.35, hz: 0.325, y: 1.425, slope: -0.97 },
        { x: s * 1.5, z: -2.175, hx: 0.35, hz: 0.125, y: 1.738 },
      ]),
      { x: 0, z: -5.35, hx: 1.8, hz: 0.75, y: 1.948 },
    ],
    rails: [
      ...[-1, 1].flatMap((s) => [
        rail(s * 1.9, 0, 0.05, 2.3, 1.108),
        rail(s * 1.55, 2.85, 0.05, 0.55, 1.318),
        rail(s * 1.2, 3.65, 0.05, 0.25, 1.318),
        rail(s * 0.8, 4.25, 0.05, 0.35, 1.318),
        rail(s * 0.6, 4.9, 0.05, 0.3, 1.5),
        { x: s * 0.95, z: -1.75, hx: 0.04, hz: 0.35 },
        rail(s * 1.95, -3.45, 0.05, 1.15, 1.738),
        rail(s * 1.95, -5.35, 0.05, 0.75, 1.948),
      ]),
      rail(0, -6.15, 1.95, 0.05, 1.948),
      rail(0, -2.3, 1.1, 0.06, 1.738),
      rail(0, 5.85, 0.5, 0.05, 1.89),
      ...[[0, 3.15], [0, 0], [0, -5.4]].map(([x, z]) => ({ x, z, hx: 0.15, hz: 0.15 })),
    ],
    ladders: [1, -1].map((s) => ({
      x: s * 2.42, z: 1.85, hw: 0.14, top: 1.27, foot: -0.65, land: [s * 1.35, 1.85],
    })),
    aloft: [{
      x: 0.8 * Math.SQRT1_2, z: -0.8 * Math.SQRT1_2, out: [Math.SQRT1_2, -Math.SQRT1_2], hw: 0.14,
      foot: 1.12, top: 9.24, land: [0.297, -0.297], floor: 8.96,
    }],
    nest: { seat: { x: 0, z: 0.17, y: 9.2, yaw: 0 }, reach: 0.65, floor: 8.6 },
    mounts: [
      ...[1, -1].map((s) => ({
        kind: 'cannon', x: s * 1.5, z: -1.0, y: 1.108, yaw: s * Math.PI / 2, stand: [s * 0.85, -1.0],
        yawLim: 0.61, pitchLim: [-0.12, 0.42],
      })),
      ...[1, -1].map((s) => ({
        kind: 'harpoon', x: s * 1.1, z: 3.25, y: 1.318, yaw: s * 1.0, stand: [s * 0.78, 2.98],
        yawLim: 0.95, pitchLim: [-0.45, 0.6],
      })),
    ],
    sail: {
      top: 13, accel: 2.2, turn: 0.7, turnMin: 0.12,
      drag: 0.1, creep: 0.15, bite: 0.1, astern: 1.2, yawLag: 1.0, runOut: 60,
      probes: [[0, 6.3], [1.9, 4.2], [-1.9, 4.2], [2.2, 1.5], [-2.2, 1.5]],
    },
    swell: {
      still: [0.008, 0.004, 0.008],
      way: [0.02, 0.014, 0.012],
      rates: [0.9, 0.7, 0.55],
    },
  },
  // And what web/js/boat.js typed beside it.
  boat: { HELM_AT: [0, -3.2], SHIP_NEAR: 7, beam: 3.5, cargoAt: { x: 0, z: 1.5 } },
};

const NEW = CRAFTS.galleon;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} against the old ${b}`);
// The fields of `b` that are numbers or arrays of numbers, each within `tol` of `a`'s.
function alike(a, b, tol, what, loose = {}) {
  for (const [k, v] of Object.entries(b)) {
    const t = loose[k] ?? tol;
    if (typeof v === 'number') near(a[k], v, t, `${what}.${k}`);
    else if (Array.isArray(v)) v.forEach((x, i) => near(a[k][i], x, t, `${what}.${k}[${i}]`));
    else if (typeof v === 'string') assert.equal(a[k], v, `${what}.${k}`);
    else alike(a[k], v, t, `${what}.${k}`);
  }
}
// The one rectangle of `list` standing where `r` stood.
const at = (list, r, what) => {
  const found = list.find((q) => Math.abs(q.x - r.x) < 1e-3 && Math.abs(q.z - r.z) < 1e-3);
  assert.ok(found, `${what}: nothing stands at (${r.x}, ${r.z})`);
  return found;
};

test('the draught is what it was', () => {
  near(SHIP_DRAUGHT, OLD.SHIP_DRAUGHT, 1e-5, 'SHIP_DRAUGHT');
  // SHIP_TALL was 12.29 by hand; the bake's height is 12.2886.
  near(NEW.tall, OLD.SHIP_TALL - OLD.SHIP_DRAUGHT, 2e-3, 'her masthead over the water');
});

test('every deck rectangle and every rail stands where it was typed, at the height it was typed', () => {
  assert.equal(NEW.deck.length, OLD.galleon.deck.length);
  for (const r of OLD.galleon.deck) {
    const q = at(NEW.deck, r, 'deck');
    alike(q, r, 1e-3, `deck (${r.x}, ${r.z})`);
    assert.equal('slope' in q, 'slope' in r, `deck (${r.x}, ${r.z}): a ramp is a ramp`);
  }
  assert.equal(NEW.rails.length, OLD.galleon.rails.length);
  for (const r of OLD.galleon.rails) {
    const q = at(NEW.rails, r, 'rail');
    alike(q, r, 1e-3, `rail (${r.x}, ${r.z})`);
    assert.equal('top' in q, 'top' in r, `rail (${r.x}, ${r.z}): a bulwark has a top, a wall has none`);
  }
});

test('the ladders, the mast ladder and the nest are where they were', () => {
  assert.equal(NEW.ladders.length, 2);
  for (const l of OLD.galleon.ladders) {
    const q = NEW.ladders.find((n) => Math.sign(n.x) === Math.sign(l.x));
    alike(q, l, 1e-3, `ladder ${l.x > 0 ? 'starboard' : 'port'}`, { top: 1e-2 });
    assert.equal(q.port, undefined);
  }
  assert.equal(NEW.aloft.length, 1);
  alike(NEW.aloft[0], OLD.galleon.aloft[0], 1e-3, 'aloft', { top: 1e-2 });
  alike(NEW.nest, OLD.galleon.nest, 1e-3, 'nest');
});

test('the mounts are the same four in the same order, pointing the same way', () => {
  assert.equal(NEW.mounts.length, OLD.galleon.mounts.length);
  OLD.galleon.mounts.forEach((m, i) => alike(NEW.mounts[i], m, 1e-3, `mount ${i} (${m.kind})`, { stand: 0.05 }));
});

test('crew, helm, how she handles and how she rides the swell are untouched', () => {
  assert.equal(NEW.crew, OLD.galleon.crew);
  assert.deepEqual([...NEW.helm], OLD.galleon.helm);
  assert.deepEqual(JSON.parse(JSON.stringify(NEW.sail)), OLD.galleon.sail);
  assert.deepEqual(JSON.parse(JSON.stringify(NEW.swell)), OLD.galleon.swell);
});

test('what boat.js typed beside the craft reads the same off it', () => {
  assert.deepEqual([...NEW.helm], OLD.boat.HELM_AT);
  assert.equal(NEW.near, OLD.boat.SHIP_NEAR);
  near(NEW.beam, OLD.boat.beam, 0.05, 'beam');
  assert.equal(NEW.cargo.x, OLD.boat.cargoAt.x);
  assert.equal(NEW.cargo.z, OLD.boat.cargoAt.z);
});
