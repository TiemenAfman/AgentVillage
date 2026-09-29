// The water patch is dense near the islands and coarse on the open sea between them.
//
// Measured on a page with the volcano and three starters in the sea: the patch used to be
// one PlaneGeometry over the box round every grid, a vertex per unit, and that was 2.53M of
// the page's 2.75M colour-pass triangles - nearly all of it open sea, where the depth the
// water shades by is one number. waterPatchPlan cuts it into tiles on one lattice and keeps
// the vertex per unit only round each grid. What is worth holding here rather than in a
// screenshot: that the cost follows the islands and not the box between them, that the tiles
// still cover the old outline exactly once (the patch is transparent: an overlap would blend
// twice), and that nothing coarse ever lies over depth that varies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// world.js reaches buildings.js, which asks for its texture sheets the moment it loads.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { waterPatchPlan, waterPatchSpan, nearWaterPlan, WATER_TILE, WATER_REACH, WATER_FADE, NEAR_CELLS, NEAR_RIM, OCEAN_DROP } = await import('../web/js/world.js');
delete globalThis.document;

const { makeTerrain } = await import('../shared/terrain.mjs');
const { placeIsland, createArchipelago, OPEN_SEA } = await import('../shared/regions.mjs');
const { smoothstep } = await import('../shared/rng.mjs');

const spanTris = (s) => s.segX * s.segZ * 2;
const step = (q) => (q.maxX - q.minX) / q.segX;

// The sea the measurement was taken on, in the page's frame: home at the origin, the volcano
// (a 192-grid) a starter's pitch west, and three 64-grid starters round it.
const LIVE = [
  { origin: [0, 0], half: 32 },
  { origin: [-432, 0], half: 96 },
  { origin: [-432, 432], half: 32 },
  { origin: [-432, -432], half: 32 },
  { origin: [-864, 0], half: 32 },
];
const spread = (list, k) => list.map((r) => ({ origin: [r.origin[0] * k, r.origin[1] * k], half: r.half }));

// The most dense water an island can be given: its square, WATER_REACH round it, and up to a
// tile more on each side where the lattice does not line up with it.
const denseBound = (list, modest) => list.reduce((n, r) => {
  const side = 2 * (r.half + WATER_REACH + WATER_TILE) / (modest ? 2 : 1);
  return n + 2 * side * side;
}, 0);

function denseTris(plan, modest) {
  let n = 0;
  for (const q of plan.quads) if (q.dense) n += 2 * q.segX * q.segZ;
  return n;
}

test('the outline is the one it always was', () => {
  for (const [half, list] of [[32, null], [32, LIVE], [64, [{ origin: [0, 0], half: 64 }, { origin: [208, 0], half: 64 }]]]) {
    const plan = waterPatchPlan(half, list, false);
    const gb = list && {
      minX: Math.min(...list.map((r) => r.origin[0] - r.half)), maxX: Math.max(...list.map((r) => r.origin[0] + r.half)),
      minZ: Math.min(...list.map((r) => r.origin[1] - r.half)), maxZ: Math.max(...list.map((r) => r.origin[1] + r.half)),
    };
    const span = waterPatchSpan(half, gb, false);
    assert.deepEqual([plan.span.minX, plan.span.maxX, plan.span.minZ, plan.span.maxZ], [span.minX, span.maxX, span.minZ, span.maxZ]);
  }
  // And the fade is the old formula, asked wherever a vertex is.
  const plan = waterPatchPlan(32, null, false);
  for (const [x, z] of [[-130, 0], [-120, 5], [-100, -100], [0, 0], [129, 90], [95, 130]]) {
    const edge = Math.min(x + 130, 130 - x, z + 130, 130 - z);
    assert.equal(plan.blendAt(x, z), smoothstep(0, 40, edge));
  }
});

test('the tiles cover the outline exactly once', () => {
  for (const modest of [false, true]) {
    const plan = waterPatchPlan(32, LIVE, modest);
    const s = plan.span;
    let area = 0;
    for (const q of plan.quads) {
      assert.ok(q.minX >= s.minX && q.maxX <= s.maxX && q.minZ >= s.minZ && q.maxZ <= s.maxZ, 'a tile outside the outline');
      assert.ok(q.maxX > q.minX && q.maxZ > q.minZ, 'an empty tile');
      area += (q.maxX - q.minX) * (q.maxZ - q.minZ);
    }
    assert.equal(area, s.width * s.depth, 'the tiles add up to the outline');
    // Adding up is not enough on its own: a gap and an overlap of the same size would too.
    const byRow = new Map();
    for (const q of plan.quads) {
      const k = `${q.minZ},${q.maxZ}`;
      if (!byRow.has(k)) byRow.set(k, []);
      byRow.get(k).push(q);
    }
    for (const row of byRow.values()) {
      row.sort((a, b) => a.minX - b.minX);
      assert.equal(row[0].minX, s.minX);
      for (let i = 1; i < row.length; i++) assert.equal(row[i].minX, row[i - 1].maxX, 'a gap or an overlap along a row');
      assert.equal(row[row.length - 1].maxX, s.maxX);
    }
  }
});

test('the cost follows the islands, not the box between them', () => {
  for (const modest of [false, true]) {
    const plan = waterPatchPlan(32, LIVE, modest);
    const box = spanTris(plan.span);
    const dense = denseTris(plan, modest);
    assert.ok(dense <= denseBound(LIVE, modest), `dense water ${dense} is more than the islands allow`);
    // The open sea costs next to nothing: the fade band and a quad per run.
    assert.ok(plan.triangles - dense < 0.05 * box, `the open sea costs ${plan.triangles - dense}`);
    assert.ok(plan.triangles < 0.12 * box, `${plan.triangles} triangles against ${box} for the box`);

    // Twice as far apart is four times the box, and the same islands.
    const far = waterPatchPlan(32, spread(LIVE, 2), modest);
    assert.ok(spanTris(far.span) > 3 * box);
    assert.equal(denseTris(far, modest), dense, 'the same islands cost the same dense water');
    assert.ok(far.triangles < plan.triangles * 1.5, `${far.triangles} against ${plan.triangles}: the empty sea is not free`);
  }
  // On the numbers that were measured: 2.53M full, which the page drew every frame.
  const full = waterPatchPlan(32, LIVE, false);
  assert.ok(spanTris(full.span) > 2.5e6);
  assert.ok(full.triangles < 2.5e5, `${full.triangles}`);
});

test('an island on its own keeps its vertex per unit and loses the empty square round it', () => {
  const plan = waterPatchPlan(32, null, false);
  assert.ok(plan.triangles < spanTris(plan.span) / 4, `${plan.triangles} against ${spanTris(plan.span)}`);
  const modest = waterPatchPlan(32, null, true);
  assert.ok(modest.triangles < plan.triangles / 3, 'modest machines still get every other vertex');
});

test('nothing coarse lies over depth that varies, and no coarse vertex carries the swell', () => {
  const sea = createArchipelago();
  const terrains = LIVE.map((r, i) => makeTerrain(1000 + i, { size: r.half * 2 }));
  LIVE.forEach((r, i) => sea.add(placeIsland(terrains[i], { id: `r${i}`, origin: r.origin })));
  for (const modest of [false, true]) {
    const plan = waterPatchPlan(32, sea.regions(), modest);
    const fine = modest ? 2 : 1;
    for (const q of plan.quads) {
      const dense = q.dense;
      if (dense) assert.equal(step(q), fine, 'a dense tile at the density the patch always had');
      // A vertex per unit (or two) wherever there is a grid: every corner of every tile that
      // touches a region is a dense tile's.
      if (!dense) {
        for (let j = 0; j <= q.segZ; j++) {
          for (let i = 0; i <= q.segX; i++) {
            const x = q.minX + (i / q.segX) * (q.maxX - q.minX);
            const z = q.minZ + (j / q.segZ) * (q.maxZ - q.minZ);
            assert.equal(sea.regionAt(x, z), null, `a coarse vertex at (${x},${z}) is over an island`);
            assert.equal(sea.height(x, z), OPEN_SEA);
            assert.equal(plan.waveAt(x, z), 0, `a coarse vertex at (${x},${z}) carries the swell`);
          }
        }
      }
    }
    // And the other way round: every point of every grid lies in a dense tile.
    for (const r of sea.regions()) {
      for (let z = r.origin[1] - r.half; z <= r.origin[1] + r.half; z += 7) {
        for (let x = r.origin[0] - r.half; x <= r.origin[0] + r.half; x += 7) {
          const q = plan.quads.find((t) => x >= t.minX && x <= t.maxX && z >= t.minZ && z <= t.maxZ && t.dense);
          assert.ok(q, `(${x},${z}) on ${r.id} is not under dense water`);
        }
      }
    }
    // The swell is whole on the grid itself.
    assert.equal(plan.waveAt(0, 0), 1);
    assert.equal(plan.waveAt(32 + WATER_REACH / 2, 0), 1);
  }
});

test('the plan knows when the sea has changed and when it has not', () => {
  const a = waterPatchPlan(32, LIVE, false);
  assert.equal(waterPatchPlan(32, [...LIVE].reverse(), false).key, a.key, 'the same islands in another order');
  // An island that joins inside the old outline moves no edge, and still needs its shallows.
  const inside = [...LIVE, { origin: [-216, 216], half: 32 }];
  const b = waterPatchPlan(32, inside, false);
  assert.deepEqual([b.span.minX, b.span.maxX, b.span.minZ, b.span.maxZ], [a.span.minX, a.span.maxX, a.span.minZ, a.span.maxZ]);
  assert.notEqual(b.key, a.key);
  assert.ok(b.triangles > a.triangles);
  assert.notEqual(waterPatchPlan(32, LIVE, true).key, a.key, 'modest is another patch');
});

test('the fade band is in the spare water, never across an island', () => {
  const plan = waterPatchPlan(32, LIVE, false);
  for (const r of LIVE) {
    for (const [x, z] of [[r.origin[0] - r.half - WATER_REACH, r.origin[1]], [r.origin[0] + r.half + WATER_REACH, r.origin[1]],
      [r.origin[0], r.origin[1] - r.half - WATER_REACH], [r.origin[0], r.origin[1] + r.half + WATER_REACH]]) {
      assert.equal(plan.blendAt(x, z), 1, `(${x},${z}) off ${r.origin} is fading`);
    }
  }
  assert.ok(WATER_FADE < Math.max(60, 130 - 32) - WATER_REACH);
});

// ---------------------------------------------------------------- the water that sails with you
// Past sixteen units off every coast the plan is flat coarse water, and past its outline only
// the ocean disc, 0.2 lower: a boat out there floated. nearWaterPlan is the dense, swelling
// patch that follows you instead; what has to hold is that it and the plan never draw the same
// water twice, that its swell meets flat water flat, and that past the outline it sinks to the
// disc rather than standing on a step.
test('the water that sails with you takes only the coarse cells, and swells to nothing at its edges', () => {
  const plan = waterPatchPlan(32, [{ origin: [0, 0], half: 32 }]);
  // Out on the open sea, well away from the island: every cell of the square is coarse.
  const out = nearWaterPlan(plan, 90, 90);
  const side = 2 * NEAR_CELLS + 1;
  assert.equal(out.cells.length, side * side);
  assert.equal(out.rect.maxX - out.rect.minX, side * WATER_TILE);
  assert.equal(out.rect.minX % WATER_TILE, 0, 'not on the plan\'s lattice');
  // Next to the island: the dense cells are left to the plan, and the rest are exactly the
  // cells the plan draws coarse - so between the two every cell is drawn once.
  const by = nearWaterPlan(plan, 40, 0);
  assert.ok(by.cells.length < side * side && by.cells.length > 0);
  for (const c of by.cells) assert.equal(plan.dense(c.minX, c.maxX, c.minZ, c.maxZ), false);
  for (let x = by.rect.minX; x < by.rect.maxX; x += WATER_TILE) {
    for (let z = by.rect.minZ; z < by.rect.maxZ; z += WATER_TILE) {
      const mine = by.cells.some((c) => c.minX === x && c.minZ === z);
      assert.equal(mine, !plan.dense(x, x + WATER_TILE, z, z + WATER_TILE), `cell ${x},${z}`);
    }
  }
  // Flat at its own rim and against every dense cell it leaves out, full swell inside.
  assert.equal(by.waveAt(by.rect.minX, by.rect.minZ + 40), 0);
  for (const c of by.cells) {
    const touches = !by.cells.some((d) => d.minX === c.minX - WATER_TILE && d.minZ === c.minZ)
      && c.minX > by.rect.minX;
    if (touches) assert.equal(by.waveAt(c.minX, (c.minZ + c.maxZ) / 2), 0, 'swell against a dense cell');
  }
  const mid = out.cells[Math.floor(out.cells.length / 2)];
  assert.equal(out.waveAt((mid.minX + mid.maxX) / 2, (mid.minZ + mid.maxZ) / 2), 1);
  // A new cell, a new patch; the same cell, the same one.
  assert.equal(nearWaterPlan(plan, 91, 89).key, out.key);
  assert.notEqual(nearWaterPlan(plan, 90 + WATER_TILE, 90).key, out.key);
});

test('past the outline it sinks to the ocean disc at its rim, and inside it lies on the water line', () => {
  const plan = waterPatchPlan(32, [{ origin: [0, 0], half: 32 }]);
  const inside = nearWaterPlan(plan, 0, plan.span.minZ + 60);
  assert.equal(inside.baseAt(inside.rect.minX, inside.rect.minZ + 30), 0);
  // Well past the outline: level with the water in the middle, down at the disc on the rim.
  const past = nearWaterPlan(plan, plan.span.maxX + 300, 0);
  assert.equal(past.baseAt((past.rect.minX + past.rect.maxX) / 2, 8), 0);
  assert.ok(Math.abs(past.baseAt(past.rect.minX, 8) + OCEAN_DROP) < 1e-9);
  assert.ok(Math.abs(past.baseAt(past.rect.minX + NEAR_RIM / 2, 8) + OCEAN_DROP / 2) < 1e-9);
});

test('the water shader lets the coarse plan step aside where the sailing water lies', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  assert.match(src, /if \(vCoarse > 0\.5 && vWorld\.x > uNear\.x && vWorld\.x < uNear\.z && vWorld\.z > uNear\.y && vWorld\.z < uNear\.w\) discard;/);
  // The ocean disc is never the one that steps aside, and its drop is the one copy.
  assert.match(src, /oceanGeo\.setAttribute\('aCoarse'/);
  assert.match(src, /ocean\.position\.y = -OCEAN_DROP;/);
});
