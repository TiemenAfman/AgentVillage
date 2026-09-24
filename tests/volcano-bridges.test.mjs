// The bridges over the volcano's lava (shared/volcano.mjs volcanoBridges): where they are,
// that they travel as any island's bridges do, that they are ground to stand on for the
// sea's crowd, for the lava and for the guards' search - and that nothing is built on them.
// No loader and no document: all of this is the sea's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOLCANO, BRIDGES, volcanoTerrain, volcanoBridges, guardhouseSite, codexPlots,
} from '../shared/volcano.mjs';
import { volcanoBundle, parseBundle } from '../lib/islandbundle.mjs';
import { createCrowds } from '../lib/crowd.mjs';
import { createLava } from '../lib/lava.mjs';
import { createHealth } from '../lib/health.mjs';
import { DECK_CLEAR } from '../lib/hostility.mjs';
import { findPath } from '../shared/settlerwalk.mjs';

const terrain = volcanoTerrain();
const bundle = volcanoBundle(terrain);
const bridges = volcanoBridges(terrain);
const size = terrain.size;
const bank = new Set(terrain.lavaBankCells.map(([gx, gz]) => gx + gz * size));
const hot = (gx, gz) => terrain.isLava(gx, gz) || bank.has(gx + gz * size);

test('every flow has its crossings: one on the apron, the rest up the cone', () => {
  assert.equal(bridges.length, BRIDGES.PER_FLOW * terrain.lavaFlows.length, bridges.map((b) => b.id).join(' '));
  for (let f = 0; f < terrain.lavaFlows.length; f++) {
    const mine = bridges.filter((b) => b.id.startsWith(`bridge:lava:${f}:`));
    const heights = mine.map((b) => terrain.heightAt(...b.ends[0])).sort((p, q) => p - q);
    assert.ok(heights[0] < 4.6, `flow ${f}'s lowest crossing is ${heights[0].toFixed(1)} up, above the apron`);
    assert.ok(heights[heights.length - 1] > terrain.crater.top * 0.5, `flow ${f} has no crossing high on the cone`);
  }
});

test('a crossing is a straight run over exactly the lava and its bank, landing on plain ground', () => {
  for (const b of bridges) {
    const k = b.axis === 'x' ? 0 : 1;
    assert.ok(b.cells.length >= 2 && b.cells.length <= BRIDGES.MAX_RUN, `${b.id} is ${b.cells.length} long`);
    for (let i = 0; i < b.cells.length; i++) {
      const c = b.cells[i];
      assert.equal(c[1 - k], b.cells[0][1 - k], `${b.id} is not straight`);
      if (i) assert.equal(c[k] - b.cells[i - 1][k], 1, `${b.id} has a gap`);
      assert.ok(hot(...c), `${b.id} crosses (${c}), which is neither lava nor bank - longer than it needs to be`);
    }
    assert.ok(b.cells.some((c) => terrain.isLava(...c)), `${b.id} crosses no lava at all`);
    for (const e of b.ends) {
      assert.ok(terrain.isLand(...e) && !hot(...e), `${b.id} lands on (${e}), in the flow`);
    }
    // The planks ride over the flow, clear enough that the lava and the guards both call
    // them a floor, and over the lava's own surface too (web/js/lava.js floats it 0.1 up).
    // Every lava cell has a deck; a bank cell may not, where the planks run into the slope.
    for (const c of b.cells) {
      if (terrain.isLava(...c)) assert.ok(b.decks.some(([gx, gz]) => gx === c[0] && gz === c[1]), `${b.id} leaves the lava at (${c}) without a deck`);
    }
    for (const [gx, gz, y] of b.decks) {
      const [x, z] = terrain.cellWorld(gx, gz);
      assert.ok(y > terrain.worldHeight(x, z) + DECK_CLEAR + 0.1, `${b.id} rides ${y} over ground at ${terrain.worldHeight(x, z)}`);
    }
  }
});

test('they travel in the bundle like any island\'s bridges, and are the same on every start', () => {
  assert.equal(bundle.bridges.length, bridges.length);
  for (const [i, b] of bridges.entries()) {
    assert.deepEqual(bundle.bridges[i], { id: b.id, axis: b.axis, cells: b.cells });
    for (const [gx, gz, y] of b.decks) assert.equal(bundle.decks[gx + gz * size], Math.round(y * 1000) / 1000);
  }
  const again = parseBundle(JSON.parse(JSON.stringify(volcanoBundle())));
  assert.deepEqual(again.bridges, bundle.bridges);
  assert.deepEqual(again.decks, bundle.decks);
  assert.deepEqual(volcanoBridges(volcanoTerrain()).map((b) => b.cells), bridges.map((b) => b.cells));
});

test('no Codex house and not the guardhouse stands on a bridge or where one lands', () => {
  const foot = new Set();
  for (const b of bridges) for (const [gx, gz] of [...b.cells, ...b.ends]) foot.add(`${gx},${gz}`);
  const lots = [guardhouseSite(terrain).plot, ...codexPlots(terrain).map((p) => p.plot)];
  for (const p of lots) {
    for (let z = p.gz; z < p.gz + p.d; z++) for (let x = p.gx; x < p.gx + p.w; x++) {
      assert.ok(!foot.has(`${x},${z}`), `the lot at ${p.gx},${p.gz} takes (${x}, ${z}) off a bridge`);
    }
  }
});

// The sea's own crowd on the real bundle: its floor is the deck on a bridge and the ground
// beside one.
const crowd = createCrowds({ now: () => 1000 }).join({ id: VOLCANO.id, sea: true, live: true, bundle, terrain, origin: [0, 0], half: terrain.half });
const bridged = [];
for (const b of bridges) for (const [gx, gz, y] of b.decks) if (terrain.isLava(gx, gz)) bridged.push([gx, gz, y]);

test('the sea stands its crowd on the planks, not in the lava under them', () => {
  assert.ok(bridged.length >= bridges.length, 'a bridge over no lava');
  for (const [gx, gz, y] of bridged) {
    const [x, z] = terrain.cellWorld(gx, gz);
    assert.ok(Math.abs(crowd.walk.groundOrDeck(x, z) - y) < 0.01, `the floor at (${gx}, ${gz}) is not the deck`);
    assert.ok(crowd.walk.groundOrDeck(x, z) > terrain.worldHeight(x, z) + DECK_CLEAR);
  }
});

test('standing on a bridge over the lava does not hurt; stepping off it into the flow does', () => {
  const [gx, gz, y] = bridged[0];
  const ORIGIN = [300, -200];
  let time = 1000;
  const volcano = { id: VOLCANO.id, sea: true, bundle, terrain, origin: ORIGIN };
  const fleet = { all: () => [volcano], get: (id) => (id === VOLCANO.id ? volcano : null) };
  const [x, z] = terrain.cellWorld(gx, gz);
  const p = { id: 'walker', island: null, walking: true, posed: true, room: null, f: 0, x: x + ORIGIN[0], y, z: z + ORIGIN[1] };
  const roster = { all: () => [p], boats: { snapshot: () => [] }, evict() {} };
  const health = createHealth({ fleet, roster, now: () => time });
  const hurts = [];
  const lava = createLava({ fleet, crowds: { get: () => crowd }, roster, health: { hurt: (...a) => { hurts.push(a); return health.hurt(...a); } }, now: () => time });
  for (let i = 0; i < 5; i++) { time += 100; lava.tick(); }
  assert.equal(hurts.length, 0, 'burnt through the planks');
  // The same flow a little way down, where nothing is built over it.
  const flow = terrain.lavaFlows.find((c) => c.some(([cx, cz]) => cx === gx && cz === gz)) || terrain.lavaFlows[0];
  const open = terrain.lavaCells.find(([cx, cz]) => !bridged.some(([bx, bz]) => bx === cx && bz === cz)
    && flow.some(([fx, fz]) => fx === cx && fz === cz));
  const [ox, oz] = terrain.cellWorld(open[0], open[1]);
  Object.assign(p, { x: ox + ORIGIN[0], z: oz + ORIGIN[1], y: terrain.worldHeight(ox, oz) });
  time += 100; lava.tick();
  assert.equal(hurts.length, 1, 'the flow beside the bridge does not burn');
});

// The guards' search as lib/hostility.mjs gives it the ground: land, lava left out unless a
// deck rides over it. Across a flow, then, the way is the bridge - and without the bridges
// the same two banks are a long way round (over the crater's floor or out through the surf
// past the mouth), if there is a way at all.
test('across a flow the guards\' way is the bridge', () => {
  const decked = new Set(bridged.map(([gx, gz]) => gx + gz * size));
  const reach = (withBridges) => ({
    ...terrain,
    isLand: (gx, gz) => terrain.isLand(gx, gz) && (!terrain.isLava(gx, gz) || (withBridges && decked.has(gx + gz * size))),
  });
  let checked = 0;
  for (const b of bridges) {
    const [a, c] = b.ends;
    const over = findPath(reach(true), a, c, null);
    assert.ok(over, `no way over ${b.id}`);
    for (const [x, z] of over) {
      const gx = Math.floor(x + terrain.half), gz = Math.floor(z + terrain.half);
      if (terrain.isLava(gx, gz)) assert.ok(decked.has(gx + gz * size), `the way over ${b.id} wades the lava at (${gx}, ${gz})`);
    }
    assert.ok(over.length <= b.cells.length + 6, `the way over ${b.id} is ${over.length} cells, not the bridge`);
    // Without it, the long way: round the head of the flow over the crater's floor, or out
    // through the surf past its mouth. Three times as far at least from the apron; from the
    // top crossings, a few cells under the rim, the head of the flow is near enough that the
    // way round is merely longer.
    const round = findPath(reach(false), a, c, null);
    const low = terrain.heightAt(...a) < 5;
    assert.ok(!round || round.length > (low ? 3 * over.length : over.length + 4), `without ${b.id} the way round is only ${round && round.length} cells`);
    checked++;
  }
  assert.equal(checked, bridges.length);
});
