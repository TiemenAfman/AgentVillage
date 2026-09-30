// The harbour funnel (Plans/quay-en-rivier.md, fase 2 and "De haven als trechter"): water that no
// growth ring may close, narrow at the head of the inlet where the river comes in and wider towards
// the sea up to a most, planned once in `layout.works.haven = { top, dir, w0, open, max, from }`,
// its head dug open once with the profile, and copied onto every step taken after it.
//
// What is held here:
//   - its geometry: a ray from the head, widening by `open` per cell up to `max`, integers in and
//     one sqrt, so every side agrees on every cell;
//   - on the live island: planned at the bridge's place, opening the way the mouth opens, bounded
//     to three bays, its head dug open to the sea, nothing that stands dug under, asked once;
//   - it opens whichever way the ground says, on different coasts for different seeds;
//   - a ring taken after it builds nothing in it, meets it with a beach, shuts no pond in and never
//     digs - and a ring without it is bit for bit what it was;
//   - a real growStep past the live quay leaves the quay, the crane, the warehouse and the houses;
//   - its banks have fixed roles, worked out from the quay.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTerrain, funnelHas, funnelCells, havenBank, havenBanks, WATER_VERSION, BEACH_MAX, gridForCoast, FUNNEL_MAX,
} from '../shared/terrain.mjs';
import {
  emptyLayout, planFairway, planHaven, chooseHaven, growStep, growCanvas, havenKeys, keptWater,
  havenBridgeSite, nextCoast, fairwayReaches, repairFairway, fillRingPonds,
} from '../lib/layout.mjs';
import { clone } from './support/village.mjs';
import { HOOGEZAND } from './support/hoogezand-ground.mjs';
import { HOOGEZAND_QUAY } from './support/hoogezand-quay.mjs';
import { waterBodies, pondCount } from './support/water-bodies.mjs';

const stepOf = (r, grid, { relief = 1, water = WATER_VERSION, hold = [] } = {}) => ({
  r, grid, hold, ...(relief ? { relief } : {}), ...(water ? { water } : {}),
});

// ---- the funnel's geometry -------------------------------------------------------------------
test('the funnel widens from its head by `open` a cell up to `max`, and goes on as a ray', () => {
  const h = { top: [20, 20], dir: [0, 64], w0: 1.5, open: 0.25, max: 5 };   // due +z
  // At the head: three across.
  assert.ok(funnelHas(h, 19, 20) && funnelHas(h, 20, 20) && funnelHas(h, 21, 20));
  assert.ok(!funnelHas(h, 22, 20) && !funnelHas(h, 18, 20));
  // Ten cells on it is 1.5 + 2.5 = 4 either side: nine across.
  assert.ok(funnelHas(h, 24, 30) && funnelHas(h, 16, 30) && !funnelHas(h, 25, 30) && !funnelHas(h, 15, 30));
  // Past the most it is five either side, however far out - a ray, not a segment.
  for (const z of [60, 200, 900]) {
    assert.ok(funnelHas(h, 25, z) && funnelHas(h, 15, z), `z ${z}`);
    assert.ok(!funnelHas(h, 26, z) && !funnelHas(h, 14, z), `z ${z}`);
  }
  // Behind the head: a round cap of w0, and nothing beyond.
  assert.ok(funnelHas(h, 20, 19) && !funnelHas(h, 20, 18) && !funnelHas(h, 20, 5));
  // A slanting axis is exact too.
  const d = { top: [10, 10], dir: [45, 45], w0: 1, open: 0, max: 1 };
  assert.ok(funnelHas(d, 30, 30) && funnelHas(d, 31, 30), '0 and 0.7 from the axis');
  assert.ok(!funnelHas(d, 32, 30), '1.4 is past 1');
  // funnelCells is the same test over the grid, and a local head is a grid head less half.
  const size = 64;
  const set = new Set(funnelCells(h, size).map(([x, z]) => `${x},${z}`));
  for (let gz = 0; gz < size; gz++) for (let gx = 0; gx < size; gx++) assert.equal(set.has(`${gx},${gz}`), funnelHas(h, gx, gz));
  const local = { ...h, top: [h.top[0] - size / 2, h.top[1] - size / 2] };
  assert.deepEqual(funnelCells(local, size, size / 2), funnelCells(h, size));
});

test('a bigger grid moves the funnel\'s head and keeps its direction', () => {
  const layout = emptyLayout(1337, 128);
  layout.works = { v: 1, haven: { top: [60, 60], dir: [30, 67], w0: 1.5, open: 0.25, max: 8, from: 0 } };
  growCanvas(layout, 160);
  assert.deepEqual(layout.works.haven, { top: [76, 76], dir: [30, 67], w0: 1.5, open: 0.25, max: 8, from: 0 });
});

// ---- the live island -----------------------------------------------------------------------
function liveLayout({ haven = false } = {}) {
  const { seed, size, grow, polders } = HOOGEZAND;
  const layout = emptyLayout(seed, size, clone(grow));
  layout.size = size;
  layout.polders = clone(polders);
  layout.fairway = clone(HOOGEZAND_QUAY.fairway);
  layout.harbours = clone(HOOGEZAND_QUAY.harbours);
  layout.districts = { quay: { ...clone(HOOGEZAND_QUAY.quay), deck: [], paved: [], lobes: [] } };
  layout.plots = clone(HOOGEZAND_QUAY.plots);
  HOOGEZAND_QUAY.quayHouses.forEach((p, n) => { layout.plots[`house:quay-${n}`] = clone(p); });
  layout.landing = clone(HOOGEZAND_QUAY.landing);
  layout.town = { ...clone(HOOGEZAND_QUAY.town), lots: [], paved: [] };
  layout.lattice = clone(HOOGEZAND_QUAY.lattice);
  layout.paths = []; layout.bridges = []; layout.roads = [];
  layout.terrainHash = HOOGEZAND_QUAY.hash;
  if (haven) mend(layout);
  return layout;
}
const groundOf = (l) => makeTerrain(l.seed || HOOGEZAND.seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow });
// What placeAll does first on the live island: mend the mouth, fill the ponds, plan the funnel.
function mend(layout) {
  const o = { seed: HOOGEZAND.seed, size: layout.size };
  let T = groundOf(layout);
  T = repairFairway(layout, T, o) || T;
  T = fillRingPonds(layout, T, o) || T;
  return planHaven(layout, T, null, o) || T;
}
// Water reached from the funnel's head through the funnel's own water: does it get to the rim?
function funnelOpen(T, h) {
  const size = T.size, inF = new Set(funnelCells(h, size).map(([x, z]) => x + z * size));
  const seen = new Set(), q = [];
  for (const k of inF) {
    const x = k % size, z = (k - x) / size;
    if (Math.hypot(x - h.top[0], z - h.top[1]) <= 2 && T.isWater(x, z)) { seen.add(k); q.push(k); }
  }
  for (let i = 0; i < q.length; i++) {
    const x = q[i] % size, z = (q[i] - x) / size;
    if (x === 0 || z === 0 || x === size - 1 || z === size - 1) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = x + dx + (z + dz) * size;
      if (!T.inGrid(x + dx, z + dz) || seen.has(n) || !inF.has(n) || !T.isWater(x + dx, z + dz)) continue;
      seen.add(n); q.push(n);
    }
  }
  return false;
}

test('the funnel is planned on the live island at the bridge, its head dug open, once', () => {
  const layout = liveLayout();
  const T0 = groundOf(layout);
  assert.equal(T0.hash, HOOGEZAND_QUAY.hash, 'the fixture is not the ground it was recorded as');
  const standing = clone(layout.plots);
  const T = mend(layout);
  const h = layout.works.haven;
  assert.ok(h, 'no funnel was planned');
  assert.deepEqual(Object.keys(h).sort(), ['dir', 'from', 'max', 'open', 'top', 'w0']);
  assert.equal(h.from, HOOGEZAND.grow.steps.length);
  // Its head is the bridge's place, as wide as the river is there.
  const site = havenBridgeSite(T0, layout.fairway);
  assert.deepEqual(h.top, site.cell);
  assert.equal(h.w0, site.width / 2);
  // Bounded: three bays at the most, and never past what any funnel may be.
  assert.ok(h.max <= FUNNEL_MAX && h.max <= 3 * 7, `a funnel of half ${h.max}`);
  assert.ok(h.max >= 3 * h.w0, `a funnel of half ${h.max} is hardly wider than its head`);
  // It opens off the island, towards the sea: the town is behind the head.
  const town = HOOGEZAND_QUAY.town.centre;
  assert.ok(h.dir[0] * (town[0] - h.top[0]) + h.dir[1] * (town[1] - h.top[1]) < 0);
  // The head is open: from the head, through the funnel's own water, to the edge of the grid.
  assert.equal(funnelOpen(T0, h), false, 'the funnel was open before its head was dug, so this proves nothing');
  assert.ok(funnelOpen(T, h), 'the funnel\'s head is still closed');
  assert.equal(layout.terrainHash, T.hash, 'the hash on record is not the ground as dug');
  assert.equal(groundOf(layout).hash, T.hash);
  // Nothing that stands was dug under, except the crane in the way (lifted to be placed again).
  const lifted = Object.keys(standing).filter((id) => !layout.plots[id]);
  assert.ok(lifted.every((id) => id === 'civic:crane'), `${lifted.join(', ')} was lifted`);
  const N = T.N;
  for (const [id, p] of Object.entries(layout.plots)) {
    for (let z = 0; z <= p.d; z++) for (let x = 0; x <= p.w; x++) {
      const q = p.gx + x + (p.gz + z) * N;
      assert.ok(T.H[q] >= T0.H[q], `${id} had a corner dug under it`);
    }
  }
  // The quay's planks and shore lie in the funnel or beside it, where its profile keeps water.
  const held = (c) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dz]) => funnelHas(h, c[0] + dx, c[1] + dz));
  for (const c of [...layout.districts.quay.pier, layout.districts.quay.shore]) assert.ok(held(c), `quay ${c} is left out of the funnel`);
  // Asked once: nothing more is dug or written.
  const written = JSON.stringify(layout.works);
  assert.equal(planHaven(layout, T, null, { seed: HOOGEZAND.seed, size: layout.size }), null);
  assert.equal(JSON.stringify(layout.works), written);
});

test('the funnel waits for the harbours and for a channel that reaches the sea', () => {
  const o = { seed: HOOGEZAND.seed, size: HOOGEZAND.size };
  // No harbours yet (the channel is dug at 25 settlers, the harbours come later): not asked.
  const early = liveLayout();
  early.harbours = null;
  let T = groundOf(early);
  T = repairFairway(early, T, o) || T;
  assert.equal(planHaven(early, T, null, o), null);
  assert.equal(early.works.haven, undefined);
  // A channel that does not reach the sea yet: not asked either (repairFairway comes first).
  const shut = liveLayout();
  assert.equal(fairwayReaches(groundOf(shut), shut.fairway), false);
  assert.equal(planHaven(shut, groundOf(shut), null, o), null);
  assert.ok(!shut.works || shut.works.haven === undefined);
  // No river at all, or a channel with nothing to dig: asked once and answered null.
  const bare = emptyLayout(7, 128);
  bare.harbours = [];
  assert.equal(planHaven(bare, makeTerrain(7, { size: 128 }), null, { seed: 7, size: 128 }), null);
  assert.equal(bare.works, undefined, 'nothing dug, nothing to ask about');
  bare.fairway = { line: [], cells: [] };
  planHaven(bare, makeTerrain(7, { size: 128 }), null, { seed: 7, size: 128 });
  assert.equal(bare.works.haven, null);
});

// ---- the funnel's direction comes from the river, whichever coast it leaves by ---------------
function founded(seed, base, size) {
  const t0 = makeTerrain(seed, { size, grow: { base, steps: [] } });
  const layout = emptyLayout(seed, size, { base, steps: [] });
  layout.size = size;
  const fairway = planFairway(t0, layout);
  if (!fairway || !fairway.cells.length) return null;
  layout.fairway = fairway;
  layout.harbours = [];                      // planned, none of them here: the funnel may be asked
  const T = makeTerrain(seed, { size, fairway, grow: layout.grow });
  const dug = planHaven(layout, T, null, { seed, size }) || T;
  return layout.works && layout.works.haven ? { layout, T: dug, seed, base, size } : null;
}
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 16, 17, 18, 1337, 'harbour', 90210];
const quarter = ({ dir: [dx, dz] }) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : (dz > 0 ? 'south' : 'north'));

test('the funnel opens from the river\'s head out to the sea, on every coast a river can leave by', () => {
  const quarters = new Map();
  for (const seed of SEEDS) {
    const f = founded(seed, 64, 192);
    if (!f) continue;
    const { layout, T } = f, h = layout.works.haven, half = T.size / 2;
    // It opens away from the island's middle.
    assert.ok(h.dir[0] * (h.top[0] - half) + h.dir[1] * (h.top[1] - half) > 0, `${seed}: it opens back into the island`);
    // And it is open from its head to the edge of the grid.
    assert.ok(funnelOpen(T, h), `${seed}: the funnel does not reach the open sea`);
    assert.ok(h.max <= FUNNEL_MAX && h.max >= h.w0);
    quarters.set(quarter(h), (quarters.get(quarter(h)) || []).concat(seed));
  }
  // No compass point is written into the rule: the seeds open on three coasts at least.
  assert.ok(quarters.size >= 3, `the funnels only ever opened ${JSON.stringify([...quarters])}`);
});

// ---- rings drawn round the funnel ---------------------------------------------------------------
// A founded island with a funnel, taken ring by ring the way growStep takes a ring: the step carries
// the funnel (local) and its lanes and ponds are decided on the ground as drawn.
function rings(cfg, each) {
  const f = founded(cfg.seed, cfg.base, cfg.size);
  if (!f) return 0;
  const { layout } = f, h = layout.works.haven, size = cfg.size;
  const local = { top: [h.top[0] - size / 2, h.top[1] - size / 2], dir: h.dir, w0: h.w0, open: h.open, max: h.max };
  const base = { size, fairway: layout.fairway, works: layout.works };
  const channel = [...layout.fairway.cells, ...layout.works.dig.flatMap((d) => d.cells)];
  const steps = [], bare = [];
  let taken = 0;
  for (let k = 0; k < 4; k++) {
    const r = nextCoast({ base: cfg.base, steps }, size);
    if (gridForCoast(r) > size || (steps.length && r <= steps[steps.length - 1].r)) break;
    const before = makeTerrain(cfg.seed, { ...base, grow: { base: cfg.base, steps: steps.slice() } });
    const decide = (s, list) => {
      const all = [...list, s];
      const T = makeTerrain(cfg.seed, { ...base, grow: { base: cfg.base, steps: all }, settle: { index: all.length - 1, channel } });
      return { ...s, lane: T.settled.lane, ponds: T.settled.ponds };
    };
    steps.push(decide({ ...stepOf(r, size, { relief: cfg.relief }), haven: local }, steps));
    bare.push(decide(stepOf(r, size, { relief: cfg.relief }), bare));
    const after = makeTerrain(cfg.seed, { ...base, grow: { base: cfg.base, steps: steps.slice() } });
    const without = makeTerrain(cfg.seed, { ...base, grow: { base: cfg.base, steps: bare.slice() } });
    each({ before, after, without, h, k });
    taken++;
  }
  return taken;
}

const CONFIGS = [];
for (const seed of [1337, 7, 3, 'harbour', 'Hoogezand', 90210, 10, 16]) {
  for (const [base, size] of [[64, 192], [96, 256]]) for (const relief of [0, 1]) CONFIGS.push({ seed, base, size, relief });
}

test('a ring taken after the funnel builds nothing in it and shuts no pond in', () => {
  let rounds = 0, differed = 0;
  for (const cfg of CONFIGS) {
    rounds += rings(cfg, ({ before, after, without, h, k }) => {
      const why = `${cfg.seed} ${cfg.base}/${cfg.size} relief ${cfg.relief} ring ${k}`;
      let lost = 0;
      for (const [gx, gz] of funnelCells(h, cfg.size)) if (before.isWater(gx, gz) && !after.isWater(gx, gz)) lost++;
      assert.equal(lost, 0, `${why}: ${lost} cells of the funnel that were sea are land`);
      assert.ok(funnelOpen(after, h), `${why}: the funnel no longer runs open to the edge`);
      assert.equal(pondCount(after), pondCount(before), `${why}: the ring shut water in`);
      if (after.hash !== without.hash) differed++;
    });
  }
  assert.ok(rounds >= 40, `only ${rounds} rings were looked at`);
  assert.ok(differed >= 20, `only ${differed} rings drew differently for keeping the funnel`);
});

test('the same rings without the funnel do build into it', () => {
  let built = 0, rounds = 0;
  for (const cfg of CONFIGS) {
    rounds += rings(cfg, ({ before, without, h }) => {
      if (funnelCells(h, cfg.size).some(([gx, gz]) => before.isWater(gx, gz) && !without.isWater(gx, gz))) built++;
    });
  }
  assert.ok(built >= 10, `only ${built} of ${rounds} rings raised ground where the funnel is when it is not kept`);
});

test('a ring round the funnel keeps the promises a ring makes, and meets it with a beach', () => {
  for (const cfg of CONFIGS.filter((c) => c.size === 192)) {
    rings(cfg, ({ before, after, h, k }) => {
      for (let c = 0; c < before.H.length; c++) {
        if (before.H[c] >= BEACH_MAX) assert.equal(after.H[c], before.H[c], `${cfg.seed} ring ${k}: corner ${c} above the beach moved`);
        else assert.ok(after.H[c] >= before.H[c], `${cfg.seed} ring ${k}: corner ${c} was dug`);
      }
      // The ring's new land beside the funnel climbs like a coast: no cell at its edge steeper than
      // a building may stand on, where a wall of one cell used to be.
      const inF = new Set(funnelCells(h, cfg.size).map(([x, z]) => `${x},${z}`));
      let steep = 0, edge = 0;
      for (const k2 of inF) {
        const [x, z] = k2.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          if (inF.has(`${nx},${nz}`) || !after.inGrid(nx, nz) || after.isWater(nx, nz) || !before.isWater(nx, nz)) continue;
          edge++;
          if (after.slope(nx, nz) > 0.6) steep++;
        }
      }
      assert.ok(steep <= edge * 0.05, `${cfg.seed} ring ${k}: ${steep} of ${edge} new cells at the funnel's edge are steep`);
    });
  }
});

test('a ring without a funnel, or before one was planned, is what it was', () => {
  const f = founded(1337, 96, 256);
  assert.ok(f);
  const { layout } = f;
  const steps = [stepOf(70, 256), stepOf(90, 256)];
  const draw = (w) => makeTerrain(1337, { size: 256, fairway: layout.fairway, works: w, grow: { base: 96, steps } });
  // The funnel in `works` is read by nothing but the steps that carry a copy of it: a step taken
  // before it was planned has none and draws as it did.
  assert.equal(draw({ ...layout.works, dig: [] }).hash, draw({ v: 1 }).hash);
  // And a null funnel ("asked, nothing to plan") is the same as none.
  assert.equal(draw({ v: 1, haven: null }).hash, draw(null).hash);
});

test('the live island grown past the quay: quay, crane, warehouse and houses stay, the funnel stays sea', () => {
  const cap = 384;
  const layout = liveLayout({ haven: true });
  // Only the south harbour: the other three lie on coasts the ring drowns whatever the funnel does.
  layout.harbours = layout.harbours.map((h) => (h && h.side === 's' ? h : null));
  const before = clone(layout);
  const was = groundOf(before);
  const T = growStep(layout, { seed: HOOGEZAND.seed, size: layout.size, cap });
  assert.ok(T, 'the island could not grow');
  const k = (layout.size - before.size) / 2;
  assert.equal(layout.size, 384);
  const step = layout.grow.steps[1];
  assert.equal(step.water, WATER_VERSION);
  assert.deepEqual(step.haven, { top: [before.works.haven.top[0] - before.size / 2, before.works.haven.top[1] - before.size / 2], dir: before.works.haven.dir, w0: before.works.haven.w0, open: before.works.haven.open, max: before.works.haven.max });
  assert.equal(layout.terrainHash, T.hash);
  for (const id of ['civic:warehouse', 'civic:shipyard', ...Object.keys(before.plots).filter((i) => i.startsWith('house:'))]) {
    assert.ok(layout.plots[id], `${id} was taken off the map by the ring`);
    assert.equal(layout.plots[id].gx, before.plots[id].gx + k, id);
    assert.equal(layout.plots[id].gz, before.plots[id].gz + k, id);
  }
  assert.ok(layout.districts.quay && layout.districts.quay.pier.length, 'the quay district was unsettled');
  assert.deepEqual(layout.districts.quay.pier, before.districts.quay.pier.map(([x, z]) => [x + k, z + k]));
  assert.ok(layout.harbours && layout.harbours[2] && layout.harbours[2].side === 's', 'the south harbour was planned again');
  const bodies = waterBodies(T);
  const bodyOf = (gx, gz) => bodies.find((b) => b.cells.some(([x, z]) => x === gx && z === gz));
  for (const [gx, gz] of layout.districts.quay.pier) assert.ok(bodyOf(gx, gz) && bodyOf(gx, gz).open, `the plank ${gx},${gz} is no longer on the open sea`);
  // The funnel moved with the grid, and every cell of it that was sea is sea.
  const h = layout.works.haven;
  assert.deepEqual(h.top, before.works.haven.top.map((c) => c + k));
  let sea = 0, made = 0;
  for (const [gx, gz] of funnelCells(h, layout.size)) {
    const old = was.inGrid(gx - k, gz - k) ? was.isWater(gx - k, gz - k) : true;
    if (old) { sea++; if (!T.isWater(gx, gz)) made++; }
  }
  assert.ok(sea > 1000);
  assert.equal(made, 0, `${made} cells of the funnel that were sea are land now`);
  assert.ok(funnelOpen(T, h));
});

// ---- keeping the polders off it ------------------------------------------------------------------
test('the funnel is kept water: the ladder and the keeper may not wall it in', () => {
  const layout = liveLayout({ haven: true });
  const kept = keptWater(layout);
  for (const k of havenKeys(layout, 0)) assert.ok(kept.has(k), `${k} of the funnel is not kept water`);
  const ring = havenKeys(layout, 1);
  assert.ok(ring.size > havenKeys(layout, 0).size);
  for (const k of ring) assert.ok(kept.has(k));
  assert.equal(havenKeys(liveLayout(), 1).size, 0);
});

// ---- the banks and the bridge --------------------------------------------------------------------
test('the quay is on one bank of the funnel and the other bank is the pirates', () => {
  const layout = liveLayout({ haven: true });
  const T = groundOf(layout), h = layout.works.haven, size = T.size;
  const ref = layout.districts.quay.shore;
  const seen = { quay: 0, pirate: 0, none: 0 };
  for (const p of HOOGEZAND_QUAY.quayHouses) seen[havenBank(h, [p.gx, p.gz], ref, { reach: 60, behind: 60 }) || 'none']++;
  assert.equal(seen.pirate, 0, 'a quay house is on the pirates\' bank');
  assert.ok(seen.quay >= 6, `only ${seen.quay} of the quay's houses are on the quay's bank`);
  const taken = new Set();
  for (const p of Object.values(layout.plots)) for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) taken.add(`${p.gx + x},${p.gz + z}`);
  const dry = (gx, gz) => T.heightAt(gx, gz) >= BEACH_MAX && !T.isWater(gx, gz) && !taken.has(`${gx},${gz}`);
  const before = JSON.stringify(layout);
  const banks = havenBanks(h, size, ref, dry);
  assert.equal(JSON.stringify(layout), before, 'asking reserved something');
  assert.ok(banks.pirate.length >= 100, `the pirates' bank has only ${banks.pirate.length} dry cells within reach`);
  assert.ok(banks.quay.length > 0);
  assert.equal(havenBank(h, h.top, ref), null);
  assert.equal(havenBank(h, [0, 0], ref), null);
  const west = banks.pirate[0];
  assert.equal(havenBank(h, west, ref), 'pirate');
  assert.equal(havenBank(h, west, west), 'quay');
});

test('the bridge belongs at the head of the inlet, over the narrow river above the bay', () => {
  const layout = liveLayout();
  const T = groundOf(layout);
  const site = havenBridgeSite(T, layout.fairway);
  assert.ok(site, 'no place for a bridge');
  assert.ok(site.width <= 3);
  assert.ok(T.isWater(site.cell[0], site.cell[1]));
  assert.ok(site.axis === 'x' || site.axis === 'z');
  const tip = layout.fairway.line[layout.fairway.line.length - 1];
  assert.ok(Math.hypot(site.cell[0] - tip[0], site.cell[1] - tip[1]) < 16);
  assert.equal(havenBridgeSite(T, { line: [], cells: [] }), null);
  assert.equal(havenBridgeSite(T, null), null);
});

test('chooseHaven writes nothing', () => {
  const layout = liveLayout();
  let T = groundOf(layout);
  T = repairFairway(layout, T, { seed: HOOGEZAND.seed, size: layout.size }) || T;
  const before = JSON.stringify(layout);
  const c = chooseHaven(layout, T, null);
  assert.ok(c && c.haven);
  assert.equal(JSON.stringify(layout), before);
});
