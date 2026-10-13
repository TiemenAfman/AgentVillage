// The galleon's craft is read off her bake (scripts/build-craft.mjs -> shared/craft-galleon.mjs,
// Plans/DONE/nieuwe-sloep.md chip 2a): these hold the committed module to the bake and to the generator as
// they are now, and the generator to the anchor grammar it reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';
import { GALLEON } from '../shared/craft-galleon.mjs';
import { CRAFTS, SHIP_DRAUGHT } from '../shared/crafts.mjs';
import { DECK_Y } from '../shared/hull.mjs';
import { CLIMB_OUT } from '../shared/deck.mjs';
import { derive, sourceOf, MOUNT_LIMITS } from '../scripts/build-craft.mjs';
import { checkSet } from '../scripts/model-rules.mjs';

const SOURCE = readFileSync(new URL('../shared/craft-galleon.mjs', import.meta.url), 'utf8');

// A bake like the ship's, with its anchors changed: `edit` gets a copy of the anchors to work on.
function bakeWith(edit) {
  const anchors = JSON.parse(JSON.stringify(PIRATESHIP.anchors));
  edit(anchors);
  return { ...PIRATESHIP, anchors };
}
const lift = PIRATESHIP.anchors.waterline[1] + DECK_Y;

test('the committed craft was derived from the bake as it is now: re-bake the ship, and derive it again', () => {
  assert.equal(GALLEON.source, sourceOf(PIRATESHIP), 'shared/craft-galleon.mjs was derived from another bake - run: node scripts/build-craft.mjs');
  assert.deepEqual({ source: GALLEON.source, ...derive(PIRATESHIP) }, GALLEON, 'the generator derives a different craft than the one committed');
  // A different hull with the same anchors is a different source too: the probes and the ladders'
  // tops are cut from the triangles.
  const part = PIRATESHIP.parts['pirateship hull'];
  const moved = { ...PIRATESHIP, parts: { 'pirateship hull': { ...part, positions: [...part.positions.slice(0, 3), part.positions[3] + 0.5, ...part.positions.slice(4)] } } };
  assert.notEqual(sourceOf(moved), GALLEON.source);
  assert.notEqual(sourceOf(bakeWith((a) => { a.helm[2] += 0.1; })), GALLEON.source);
});

test('the module is literals only, as shared/ wants it: no arithmetic, no import, no clock', () => {
  const body = SOURCE.replace(/^\/\/.*$/gm, '').trim();
  assert.match(body, /^export const GALLEON = \{[\s\S]*\};$/);
  assert.doesNotMatch(body, /\b(?:import|Math|Date|require|function|=>)\b/);
  // What is between the braces is JSON: a reader with no JavaScript could take it.
  const json = JSON.parse(body.slice('export const GALLEON = '.length, -1));
  assert.deepEqual(json, GALLEON);
  // And the bake's anchors pass the grammar the generator reads.
  assert.deepEqual(checkSet('pirateship', PIRATESHIP), []);
});

test('the frame: an anchor less the waterline and DECK_Y is a height above the deck datum, and the draught is the waterline itself', () => {
  assert.equal(GALLEON.draught, PIRATESHIP.anchors.waterline[1]);
  assert.equal(SHIP_DRAUGHT, GALLEON.draught);
  assert.ok(Math.abs(GALLEON.tall - (PIRATESHIP.height - GALLEON.draught)) < 1e-4, 'her masthead over the water');
  const waist = PIRATESHIP.anchors['deck.waist.lo'];
  const r = GALLEON.deck.find((d) => d.hx > 1 && d.hz > 0.8 && !d.slope && Math.abs(d.z - (waist[2] + PIRATESHIP.anchors['deck.waist.hi'][2]) / 2) < 1e-4);
  assert.ok(Math.abs(r.y - (waist[1] - lift)) < 1e-4, `the waist at ${r.y}, the anchor ${waist[1] - lift} over the datum`);
  // A ramp: the middle of its foot and head, and its rise per unit of z, from the two corners.
  const lo = PIRATESHIP.anchors['stair.companion.lo'], hi = PIRATESHIP.anchors['stair.companion.hi'];
  const ramp = GALLEON.deck.find((d) => d.slope && Math.abs(d.z - (lo[2] + hi[2]) / 2) < 1e-6);
  assert.ok(Math.abs(ramp.y - (lo[1] + hi[1]) / 2 + lift) < 1e-4);
  assert.ok(Math.abs(ramp.slope - (hi[1] - lo[1]) / (hi[2] - lo[2])) < 1e-4);
  // A mast is a box nobody clears, a rail a bulwark on its floor (crafts.mjs puts the top on).
  const main = PIRATESHIP.anchors['mast.main'];
  assert.ok(GALLEON.rails.some((q) => q.x === main[0] && q.z === main[2] && q.floor === undefined && q.hx === q.hz));
  assert.ok(GALLEON.rails.every((q) => q.floor === undefined || q.floor > 0), 'every bulwark stands on a floor');
  assert.ok(CRAFTS.galleon.rails.every((q) => q.floor === undefined), 'crafts.mjs turns the floor into a top');
});

test('a mount is a pair: lo where the gunner stands, hi the carriage, and the bearing between them is the yaw', () => {
  assert.equal(GALLEON.mounts.length, 3);
  assert.deepEqual(GALLEON.mounts.map((m) => m.kind), ['cannon', 'cannon', 'harpoon'], 'cannons first, starboard before port, then the harpoon on the bow');
  const [sb, port] = GALLEON.mounts;
  assert.ok(sb.x > 0 && port.x < 0, 'the starboard gun is mount 0, as it has always been on the wire');
  for (const m of GALLEON.mounts) {
    const dx = m.x - m.stand[0], dz = m.z - m.stand[1];
    assert.ok(Math.abs(Math.atan2(dx, dz) - m.yaw) < 1e-6, `${m.kind}: yaw ${m.yaw} is not the bearing from its stand`);
    assert.equal(m.yawLim, MOUNT_LIMITS[m.kind].yawLim);
    assert.deepEqual(m.pitchLim, MOUNT_LIMITS[m.kind].pitchLim);
  }
  // A stand on the carriage points nowhere.
  assert.throws(() => derive(bakeWith((a) => { a['mount.cannon-s.lo'] = [...a['mount.cannon-s.hi']]; })), /points nowhere/);
  // A kind nothing can draw is refused by the grammar before the generator sees it.
  assert.ok(checkSet('pirateship', bakeWith((a) => { a['mount.swivel.lo'] = [0, 3, 0]; a['mount.swivel.hi'] = [0, 3, 1]; })).some((m) => /anchor\.mount\.swivel\.lo is not one of/.test(m)));
  // And so is half a pair.
  assert.ok(checkSet('pirateship', bakeWith((a) => { delete a['mount.harpoon.hi']; })).some((m) => /mount\.harpoon\.lo is one corner of mount\.harpoon/.test(m)));
});

test('a rope ladder over the side: ropes CLIMB_OUT inside the climber\'s stand, top the bulwark it is climbed over, or the deck through a port', () => {
  assert.equal(GALLEON.ladders.length, 2);
  const [sb] = GALLEON.ladders;
  const lo = PIRATESHIP.anchors['climb.side-starboard.lo'], hi = PIRATESHIP.anchors['climb.side-starboard.hi'];
  assert.ok(Math.abs(sb.x - (lo[0] - CLIMB_OUT)) < 1e-4 && sb.z === lo[2]);
  assert.ok(Math.abs(sb.foot - (lo[1] - lift)) < 1e-4);
  assert.deepEqual(sb.land, [hi[0], hi[2]]);
  // The sloop's ladders hang at her entry ports (`port.1|2`): the climber steps straight onto the deck.
  const waist = PIRATESHIP.anchors['deck.waist.lo'][1] - lift;
  const p1 = PIRATESHIP.anchors['port.1.lo'], p2 = PIRATESHIP.anchors['port.1.hi'];
  assert.ok(Math.abs(sb.top - waist) < 1e-4, `the deck at the port: ${sb.top} on a waist of ${waist}`);
  assert.ok(Math.abs(sb.port - Math.abs(p2[2] - p1[2]) / 2) < 1e-4, `half the port: ${sb.port}`);
  assert.equal(GALLEON.ladders[1].port, sb.port, 'a port on either side');
  // Her bulwark is cut down to the deck there, so a ladder with no port anchored beside it finds no rail
  // to go over: the bake and its anchors have to say the same thing.
  assert.throws(() => derive(bakeWith((a) => { for (const k of Object.keys(a)) if (/^port\./.test(k)) delete a[k]; })), /no bulwark/);
  // Ropes inside the hull's side at the water are a ladder through the planking.
  assert.throws(() => derive(bakeWith((a) => { a['climb.side-starboard.lo'][0] = 1.0; })), /inside the hull's side/);
  // And one up the mast: the ropes back from the climber towards the mast, the rim read off the nest.
  const [up] = GALLEON.aloft;
  const mlo = PIRATESHIP.anchors['climb.mast.lo'];
  assert.ok(Math.abs(Math.hypot(up.out[0], up.out[1]) - 1) < 1e-3, 'out is a unit vector');
  assert.ok(Math.abs(up.x + up.out[0] * CLIMB_OUT - mlo[0]) < 1e-4 && Math.abs(up.z + up.out[1] * CLIMB_OUT - mlo[2]) < 1e-4);
  // The sloop's goes up her mast's pins through a hole in the top: no rim, its top is the floor it comes
  // up through. A ladder outside the rim (the galleon's) had the rim read off the nest instead.
  if (up.hole) assert.equal(up.top, up.floor, 'through a hole, the top is the floor');
  else assert.ok(up.top > up.floor && up.top < up.floor + 0.5, `the rim ${up.top} over the landing's ${up.floor}`);
  assert.ok(Math.abs(GALLEON.nest.floor - (PIRATESHIP.anchors['deck.nest.lo'][1] - lift)) < 1e-4);
  assert.ok(!GALLEON.deck.some((d) => d.y > 5), 'the nest is no deck of the hull');
});

test('what is cut from the hull: her length at the water, the probes she sails by, her outline', () => {
  assert.ok(GALLEON.length >= 8.5 && GALLEON.length < GALLEON.overall, `${GALLEON.length} at the water, ${GALLEON.overall} overall`);
  assert.equal(GALLEON.near, Math.ceil(GALLEON.length / 2 + 1.5));
  assert.equal(GALLEON.probes.length, 5);
  assert.equal(GALLEON.probes[0][0], 0, 'the bow on the centreline');
  for (const [x, z] of GALLEON.probes.slice(1)) assert.ok(z > 0 && z < GALLEON.probes[0][1] && Math.abs(x) > 0.5, `a shoulder at ${x}, ${z}`);
  assert.ok(GALLEON.probes.slice(1).some((p) => p[0] > 0) && GALLEON.probes.slice(1).some((p) => p[0] < 0), 'both sides');
  assert.equal(GALLEON.box.y0, -GALLEON.draught);
  assert.equal(GALLEON.box.hz, GALLEON.length / 2);
  assert.ok(GALLEON.box.hx >= Math.max(...GALLEON.rails.filter((r) => r.floor !== undefined).map((r) => Math.abs(r.x))));
  assert.ok(CRAFTS.galleon.box.y1 > GALLEON.box.deck, 'crafts.mjs puts the bulwark on top of the highest rail\'s floor');
  // A bake with nothing at the water is no ship.
  assert.throws(() => derive(bakeWith((a) => { delete a.waterline; })), /waterline/);
});
