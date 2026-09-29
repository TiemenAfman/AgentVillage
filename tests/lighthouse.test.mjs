// The lighthouse at its real size (Plans/DONE/mijlpalen-tot-tweehonderd.md, "De vuurtoren";
// scripts/build-lighthouse.py).
//
// What is held here:
//   the height    about seven on the island: the tallest thing on land, well under the
//                 galleon's masthead, and tall by being built again rather than stretched -
//   the measure   so the door is the town hall's height, the windows the old ones and on every
//                 storey, the railing a metre, and a lantern somebody could stand in, lamp and all;
//   the taper     the foot wide enough that it is not a chimney, the shaft narrowing up it;
//   the lamp      the beam leaves the lens, inside the glass, at the glass's own width;
//   the ground    walked round as the round thing it is, and nothing an animal is sent to or a
//                 mark put down on is inside the stone or on its step, though it stands on one
//                 cell and is drawn past it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { islandPlaces, DRAWN_REACH } from '../lib/animal-places.mjs';
import { animalIsland } from './support/animal-island.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, BEACON_RISE, BEACON_THROAT, WALK_BODY_R } = await import('../web/js/buildings.js');
const models = await import('../web/js/models.js');

const civic = (civicType, plot) => buildBuilding({ id: `civic:${civicType}`, kind: 'civic', civicType, style: 'unknown', tier: 'civic', plot });
const tower = civic('lighthouse', { gx: 0, gz: 0, w: 1, d: 1, rot: 2 });
// The porch lifts the whole model onto its step; the step is the difference between the two.
const LIFT = tower.anchors.door[1];

// A baked part's extent in its own frame, and the parts called by one name.
function extent(name) {
  const p = models.part(name);
  assert.ok(p, `no baked part called "${name}"`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p.positions[i + k] + p.at[k]);
      hi[k] = Math.max(hi[k], p.positions[i + k] + p.at[k]);
    }
  }
  return { lo, hi, w: hi[0] - lo[0], h: hi[1] - lo[1], r: Math.max(hi[0], -lo[0], hi[2], -lo[2]) };
}
const named = (prefix) => models.assetParts('lighthouse').filter((n) => n === prefix || n.startsWith(`${prefix}.`));

test('it stands about seven high: over everything else on land, under a masthead', () => {
  assert.ok(tower.height >= 6.5 && tower.height <= 7.5, `the lighthouse stands ${tower.height.toFixed(2)} high`);
  // The rest of the skyline, the great castle on its seven by seven included.
  const others = [['castle', { gx: 0, gz: 0, w: 7, d: 7, rot: 2 }], ['townhall'], ['clocktower'], ['chapel'], ['watertower'], ['windmill'], ['school']];
  for (const [type, plot] of others) {
    const h = civic(type, plot).height;
    assert.ok(tower.height > h + 1, `the ${type} stands ${h.toFixed(2)} high, the lighthouse ${tower.height.toFixed(2)}`);
  }
  // The pirate galleon's masthead is 10.8 over the water (Plans/DONE/mijlpalen-tot-tweehonderd.md);
  // a tower on a coast cell is a quarter of a unit up to start with.
  assert.ok(tower.height + 0.5 < 10.8, 'the lighthouse is as tall as a ship\'s mast');
});

test('it is taller by being built again, not stretched: a door, windows and a rail on a person\'s measure', () => {
  // The door: the town hall's height, a single leaf.
  const door = extent('Lighthouse door recess'), hall = extent('Townhall door recess');
  assert.ok(Math.abs(door.h - hall.h) < 0.02, `the door is ${door.h.toFixed(2)} high against the town hall's ${hall.h.toFixed(2)}`);
  assert.ok(door.w >= 0.3 && door.w <= hall.w, `the door is ${door.w.toFixed(2)} across`);
  // The windows are the size they were (0.17 of glass in a 0.24 surround), and there is a pair
  // on every storey - eight bands where there were four.
  const panes = named('Lighthouse window pane').map(extent);
  for (const p of panes) assert.ok(Math.abs(p.h - 0.17) < 0.005, `a pane ${p.h.toFixed(3)} high`);
  const bands = named('Lighthouse painted band').map(extent);
  assert.equal(bands.length, 8);
  for (const b of bands) {
    assert.ok(b.h < 0.5, `a storey ${b.h.toFixed(2)} high`);
    const inBand = panes.filter((p) => p.lo[1] > b.lo[1] && p.hi[1] < b.hi[1]);
    assert.ok(inBand.length >= 2, `a band at ${b.lo[1].toFixed(2)} with ${inBand.length} windows`);
  }
  // The gallery rail is a metre (0.25).
  for (const post of named('Lighthouse gallery railing post').map(extent)) {
    assert.ok(post.h >= 0.22 && post.h <= 0.28, `a railing post ${post.h.toFixed(2)} high`);
  }
  // And the lantern is a room: glass 0.6 to 0.7 high, the lamp standing in the middle of it
  // with room beside it for somebody the player's size, under a roof they would not touch.
  const glass = extent('Lighthouse lantern glass'), lens = extent('Lighthouse lamp lens');
  assert.ok(glass.h >= 0.6 && glass.h <= 0.7, `the lantern glass is ${glass.h.toFixed(2)} high`);
  assert.ok(lens.lo[1] > glass.lo[1] && lens.hi[1] < glass.hi[1], 'the lamp is not behind the glass');
  assert.ok(glass.r - lens.r >= WALK_BODY_R, `${(glass.r - lens.r).toFixed(2)} between the lamp and the glass`);
  const floor = extent('Lighthouse gallery deck').hi[1], roof = extent('Lighthouse copper roof rim').lo[1];
  assert.ok(roof - floor >= 0.45 * 1.5, `${(roof - floor).toFixed(2)} from the lantern floor to its roof`);
});

test('it tapers from a foot wide enough not to be a chimney', () => {
  const foot = extent('Lighthouse stone foot');
  const ratio = tower.height / (2 * foot.r);
  assert.ok(ratio >= 4.5 && ratio <= 5, `${tower.height.toFixed(2)} high on a foot ${(2 * foot.r).toFixed(2)} across is ${ratio.toFixed(2)} to one`);
  const bands = named('Lighthouse painted band').map(extent).sort((a, b) => a.lo[1] - b.lo[1]);
  assert.ok(bands.at(-1).r < bands[0].r * 0.75, 'the shaft is as wide under the gallery as at the foot');
  // The widest thing on the tower is its foot, the gallery included.
  assert.ok(extent('Lighthouse gallery deck').r < foot.r, 'the gallery overhangs the foot');
});

test('the beam leaves the lamp, inside the glass, at the glass\'s own width', () => {
  const glass = extent('Lighthouse lantern glass');
  assert.equal(BEACON_RISE, models.part('Lighthouse lamp lens').at[1]);
  assert.ok(BEACON_RISE > glass.lo[1] && BEACON_RISE < glass.hi[1], `the lamp at ${BEACON_RISE} and the glass from ${glass.lo[1]} to ${glass.hi[1]}`);
  assert.ok(Math.abs(tower.animated.beacon.at[1] - (BEACON_RISE + LIFT)) < 1e-9, 'the lamp is not lifted with the tower');
  assert.ok(Math.abs(BEACON_THROAT - glass.r) < 0.02, `the beam opens at ${BEACON_THROAT.toFixed(3)} from a lantern ${glass.r.toFixed(3)} round`);
});

test('it is walked round as a round tower, and nothing is put down inside it or on its step', () => {
  // One solid, a circle, round the stone foot and the door in it.
  const foot = extent('Lighthouse stone foot');
  assert.equal(tower.solids.length, 1);
  const s = tower.solids[0];
  assert.ok(s.r >= foot.r - 0.03 && s.r <= foot.r + 0.1, `the tower is walked round at ${s.r}`);
  // Everything drawn - the plinth the porch makes under it included - is inside the reach the
  // animal places are told, from the middle of its one cell.
  const pos = tower.geometry.attributes.position;
  let reach = 0;
  for (let i = 0; i < pos.count; i++) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
  assert.ok(reach <= DRAWN_REACH.lighthouse, `the lighthouse is drawn ${reach.toFixed(3)} from its middle, past the ${DRAWN_REACH.lighthouse} the animals are told`);
  assert.ok(reach > 0.5, 'the lighthouse fits its one cell after all, and DRAWN_REACH can go');

  // And so the mystery's end is outside it: the doorstep a hen waits on, and every mark put
  // down there - from the doorstep, and from the middle, which is what landmark() falls back to.
  const { village, check } = animalIsland();
  const p = islandPlaces(village, { check: check() });
  const lh = village.buildings.find((b) => b.id === 'civic:lighthouse').plot;
  const mid = [lh.gx + 0.5 - p.half, lh.gz + 0.5 - p.half];
  const off = ([x, z]) => Math.hypot(x - mid[0], z - mid[1]);
  const lm = p.landmark();
  assert.equal(lm.label, 'lighthouse');
  assert.ok(off(lm.at) > reach + 0.2, `the landmark is ${off(lm.at).toFixed(2)} from the tower's middle`);
  for (const near of [lm.at, mid]) {
    const placed = [];
    for (let i = 0; i < 4; i++) {
      const at = p.traceSpot(near, placed);
      assert.ok(at, `no room for mark ${i}`);
      assert.ok(off([at.x, at.z]) > reach + 0.2, `a mark ${off([at.x, at.z]).toFixed(2)} from the tower's middle`);
      placed.push(at);
    }
  }
});
