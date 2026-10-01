// Every building's walk solids held against its own geometry (Plans/muren-met-hitboxes.md).
//
// What is held here, per building, in its own frame (nothing is turned):
//   no wall walked through   no place a body's middle can reach lies inside the drawn building,
//                            in the band a body stands in (a step up off the floor to head height)
//   no wall of air           the solids shut off little ground a body could have stood on had the
//                            solids been the building itself - the great castle's gate, the gold
//                            pit's mouth and the brewery's yard were blocks
//   the door                 a body gets as near the door's anchor as the stone lets it
//
// The drawn building is rasterised: every triangle, sampled, onto a grid, in the band. "Where a
// body can stand" is a flood from the edge of the field round everything grown by a body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, WALK_BODY_R: R, WALK_CLEARANCE, WALK_STEP, SHOPS, HARBOUR_HOUSES } = await import('../web/js/buildings.js');
delete globalThis.document;

const CIVICS = ['townhall', 'well', 'watertower', 'market', 'clocktower', 'statue', 'pirate', 'treasure', 'lamp', 'mailbox',
  'planter', 'bench', 'terrace', 'fountain', 'flowerbed', 'tavern', 'piratetavern', 'chapel', 'tables', 'school', 'sawmill',
  'smithy', 'stable', 'bakery', 'butcher', 'brewery', 'trainingfield', 'quarry', 'windmill', 'poldermill', 'lighthouse',
  'castle', 'chronicle', 'board', 'issues', 'office', 'bridge', 'crane', 'goldmine', 'goldsmith', 'goldpit',
  ...SHOPS, ...HARBOUR_HOUSES];
const SPECS = [
  ...CIVICS.map((c) => ({ id: `c:${c}`, kind: 'civic', civicType: c, style: 'unknown', plot: { w: 3, d: 3 } })),
  { id: 'c:greatcastle', kind: 'civic', civicType: 'castle', style: 'unknown', plot: { w: 7, d: 7 } },
  ...['tent', 'hut', 'cottage', 'house', 'manor', 'keep'].flatMap((tier) => ['claude', 'codex', 'unknown']
    .map((style) => ({ id: `house:${tier}-${style}`, kind: 'house', tier, style, sheds: [] }))),
  { id: 'house:hotel', kind: 'house', tier: 'house', style: 'unknown', hotel: true, sheds: [] },
  ...['explore', 'plan', 'code', 'other', 'review', 'test'].map((t) => ({ id: `shed:${t}`, kind: 'shed', shedType: t, style: 'unknown' })),
];
// The most ground a building's solids may shut off that a body could stand on, in square units.
// Most of what is left is the corners a rectangle grown by a body has and a round tower does not.
const AIR = 0.6;
// Four round towers, each in its square; and a field of practice posts and dummies, a hundred
// small things each with a rectangle's corners.
const AIR_OF = { 'c:greatcastle': 2.0, 'c:trainingfield': 1.0 };

const RES = 0.04, SPAN = 4.2, N = Math.round(SPAN * 2 / RES);
const cellOf = (x, z) => {
  const i = Math.floor((x + SPAN) / RES), j = Math.floor((z + SPAN) / RES);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : i + j * N;
};
const centre = (k) => [-SPAN + ((k % N) + 0.5) * RES, -SPAN + (Math.floor(k / N) + 0.5) * RES];

function drawn(parts, s, y0, y1) {
  const g = new Uint8Array(N * N);
  for (const p of parts) {
    if (p.userData.part?.group?.kind === 'porch') continue;
    if (String(p.userData.part?.args?.[0] || '').startsWith('addon_tent_mound')) continue;   // turf, walked on
    const pos = p.attributes.position, ix = p.index;
    const n = ix ? ix.count : pos.count;
    const at = (t) => { const k = ix ? ix.getX(t) : t; return [pos.getX(k) * s, pos.getY(k) * s, pos.getZ(k) * s]; };
    for (let t = 0; t + 2 < n; t += 3) {
      const a = at(t), b = at(t + 1), c = at(t + 2);
      if (Math.max(a[1], b[1], c[1]) < y0 || Math.min(a[1], b[1], c[1]) > y1) continue;
      const L = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
      const m = Math.min(300, Math.ceil(L / (RES * 0.5)) + 1);
      for (let i = 0; i <= m; i++) for (let j = 0; j <= m - i; j++) {
        const u = i / m, v = j / m, w = 1 - u - v;
        const y = a[1] * w + b[1] * u + c[1] * v;
        if (y < y0 || y > y1) continue;
        const k = cellOf(a[0] * w + b[0] * u + c[0] * v, a[2] * w + b[2] * u + c[2] * v);
        if (k >= 0) g[k] = 1;
      }
    }
  }
  return g;
}
function grown(g, r) {
  const k = Math.ceil(r / RES), out = new Uint8Array(N * N), offs = [];
  for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) if ((di * di + dj * dj) * RES * RES <= r * r) offs.push(di + dj * N);
  for (let c = 0; c < N * N; c++) if (g[c]) for (const o of offs) { const m = c + o; if (m >= 0 && m < N * N) out[m] = 1; }
  return out;
}
function solidGrid(solids) {
  const g = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) {
    const [x, z] = centre(c);
    g[c] = solids.some((r) => (r.r ? (x - r.x) ** 2 + (z - r.z) ** 2 < (r.r + R) ** 2
      : Math.abs(x - r.x) < r.hx + R && Math.abs(z - r.z) < r.hz + R)) ? 1 : 0;
  }
  return g;
}
function reach(shut) {
  const seen = new Uint8Array(N * N), q = [];
  for (let i = 0; i < N; i++) for (const k of [i, i + (N - 1) * N, i * N, i * N + N - 1]) if (!shut[k] && !seen[k]) { seen[k] = 1; q.push(k); }
  while (q.length) {
    const k = q.pop(), i = k % N;
    for (const m of [i + 1 < N ? k + 1 : -1, i > 0 ? k - 1 : -1, k + N < N * N ? k + N : -1, k - N]) {
      if (m >= 0 && !seen[m] && !shut[m]) { seen[m] = 1; q.push(m); }
    }
  }
  return seen;
}
const nearest = (free, x, z) => {
  let best = Infinity;
  for (let c = 0; c < N * N; c++) if (free[c]) { const [cx, cz] = centre(c); best = Math.min(best, Math.hypot(cx - x, cz - z)); }
  return best;
};

// Measured once, read by every test below. A building that is walked on as well as round (the
// Salty Kraken's stair up its rock: `surfaces`) measures its own solids against its own floors,
// and a band off the ground says nothing about it - pirate-stair-walk.test.mjs holds that one.
const MEASURED = SPECS.map((spec) => {
  const b = buildBuilding(spec, { keepParts: true });
  if (b.surfaces) { b.geometry.dispose(); for (const p of b.parts) p.dispose(); return null; }
  const s = b.scale || 1;
  // The band from the floor the building stands on: its porch, where it has one.
  const floor = b.porch ? b.porch.top : 0;    // the porch comes back in the scaled frame
  // A face has to reach 3 cm over the step to count as in the way (WALK_SLIVER in buildings.js).
  const real = drawn(b.parts, s, floor + WALK_STEP + 0.03, floor + WALK_CLEARANCE);
  // What stands in the yard is on the grass and not on the porch, so for what a body could have
  // stood on, the band off the ground is in the way as well.
  const onGround = b.porch ? drawn(b.parts, s, WALK_STEP + 0.03, WALK_CLEARANCE) : real;
  const either = onGround === real ? real : real.map((v, k) => v | onGround[k]);
  const shut = solidGrid(b.solids);
  const free = reach(shut), could = reach(grown(either, R));
  let through = 0, air = 0;
  for (let c = 0; c < N * N; c++) {
    if (real[c] && free[c]) through++;
    if (could[c] && shut[c]) air++;
  }
  const door = b.anchors.door;
  const out = {
    id: spec.id, solids: b.solids, through: through * RES * RES, air: air * RES * RES,
    door: door ? { at: nearest(free, door[0] * s, door[2] * s), stone: nearest(could, door[0] * s, door[2] * s) } : null,
    free,
  };
  b.geometry.dispose();
  for (const p of b.parts) p.dispose();
  return out;
}).filter(Boolean);

test('no building is walked through', () => {
  for (const m of MEASURED) assert.ok(m.through <= 0.02, `${m.id}: a body stands inside ${m.through.toFixed(3)} of it`);
});

test('no building shuts off ground a body could stand on', () => {
  for (const m of MEASURED) {
    const most = AIR_OF[m.id] ?? AIR;
    assert.ok(m.air <= most, `${m.id} is solid over ${m.air.toFixed(2)} of open ground (at most ${most})`);
  }
});

test('every door is reached as near as its stone lets a body', () => {
  let doors = 0;
  for (const m of MEASURED) {
    if (!m.door) continue;
    doors++;
    assert.ok(m.door.at <= m.door.stone + 0.1, `${m.id}: a body gets ${m.door.at.toFixed(2)} from the door, the stone allows ${m.door.stone.toFixed(2)}`);
  }
  assert.ok(doors > 20, `${doors} doors measured`);
});

test('the great castle is walked into at its gate, and the gold pit at its mouth', () => {
  const castle = MEASURED.find((m) => m.id === 'c:greatcastle');
  assert.ok(castle.door.at < 0.2, `a body gets ${castle.door.at.toFixed(2)} from the gate`);
  assert.ok(castle.solids.length > 1, 'the castle is more than one block');
  // The pit is open at the front (+z) for the barrow: its middle is ground to stand on.
  const pit = MEASURED.find((m) => m.id === 'c:goldpit');
  assert.ok(pit.free[cellOf(0, 0.3)], 'the gold pit is one block with no way in');
});

test('every solid says how high it stands, and goes down under the porch', () => {
  for (const m of MEASURED) {
    for (const r of m.solids) {
      if (r.r) continue;                                // round things keep the circle of old
      if (r.y0 == null) continue;                       // a building that measures its own (the ship)
      assert.ok(r.y0 < -0.5, `${m.id}: a solid starts at ${r.y0.toFixed(2)}, which a body on a slope walks under`);
      assert.ok(r.y1 > r.y0 && r.y1 >= WALK_STEP, `${m.id}: a solid stands ${r.y0.toFixed(2)}..${r.y1.toFixed(2)}`);
    }
  }
});
