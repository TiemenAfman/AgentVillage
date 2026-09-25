// The keeper moving and turning the town's own buildings, and giving the town more ground to
// do it on (Plans/gebouwen-verplaatsen.md): the `civic` and `commons` ops in lib/plan.mjs.
//
// What is asserted is the planner's usual bargain for these two: only the building named
// moves (the postbox of a town hall goes with it), the roads follow its door, the scan after
// an apply writes the same file, and every refusal says why in the island's own words.
// The bitmaps the planner colours a drag by (`civicSites`) are held to the op itself: a
// corner they call good is one `civicSite` accepts.
//
// No coordinate is written down: every seed lays its square out differently, so each test
// finds its own site on the island it has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll, facing, TOWN_CORE_R } from '../lib/layout.mjs';
import { runPlan, parsePlan, civicSite, civicSites } from '../lib/plan.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { blockOf } from '../shared/lattice.mjs';

const SIZE = 128;
const SEED = 2024;
const t0 = Date.UTC(2026, 0, 1);

function village(settlers) {
  const buildings = [];
  for (let i = 0; i < settlers; i++) {
    buildings.push({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: 'p:demo', harbour: false, tier: 'hut', startedAt: t0 + i * 1000 });
  }
  return {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: settlers, firstSeenAt: t0 }],
    buildings,
    milestones: MILESTONES.map((m) => {
      const unlocked = m.at <= settlers;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers },
  };
}

// Forty settlers: the hall and six three by three milestones round the square, one lot left
// free, and the gold pit off the lots.
const MODEL = village(40);
function island() {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, MODEL, { seed: SEED, size: SIZE });
  placeAll(layout, MODEL, { seed: SEED, size: SIZE });
  return layout;
}
const terrainOf = (layout) => makeTerrain(SEED, { size: layout.size, polders: layout.polders || [], fairway: layout.fairway || null, grow: layout.grow || null });
const plan = (layout, ops, dryRun = true) => runPlan(layout, MODEL, parsePlan({ ops }), { seed: SEED, size: SIZE, dryRun });
const copy = (o) => JSON.parse(JSON.stringify(o));

// The scan after an apply changes nothing: the promise every plan op keeps.
function assertSettled(layout) {
  const before = JSON.stringify(layout);
  placeAll(layout, MODEL, { seed: SEED, size: SIZE });
  assert.equal(JSON.stringify(layout), before, 'the scan after the plan rewrote the layout');
}

// Good corners for a building off the map, nearest the town centre first, each with a way
// its door may face there: [gx, gz, rot].
function goodCorners(layout, id, keepAway = 3) {
  const S = civicSites(layout, terrainOf(layout));
  const p = layout.plots[id];
  const out = [];
  S.sites[id].forEach((row, z) => [...row].forEach((c, x) => {
    const gx = S.gx + x, gz = S.gz + z, mask = parseInt(c, 16);
    if (!mask || (Math.abs(gx - p.gx) < keepAway && Math.abs(gz - p.gz) < keepAway)) return;
    // The way that faces the town, when the map allows it.
    const want = facing([gx + 1, gz + 1], layout.town.centre);
    out.push([gx, gz, (mask >> want) & 1 ? want : [0, 1, 2, 3].find((r) => (mask >> r) & 1)]);
  }));
  const [cx, cz] = layout.town.centre;
  return out.sort((a, b) => (a[0] - cx) ** 2 + (a[1] - cz) ** 2 - ((b[0] - cx) ** 2 + (b[1] - cz) ** 2));
}

test('the ops are parsed field by field and refused when they are not what they say', () => {
  assert.deepEqual(parsePlan({ ops: [{ op: 'civic', id: 'civic:tavern', gx: 3, gz: 4, rot: 2, extra: 1 }] }).ops,
    [{ op: 'civic', id: 'civic:tavern', gx: 3, gz: 4, rot: 2 }]);
  assert.throws(() => parsePlan({ ops: [{ op: 'civic', id: 'house:x', gx: 3, gz: 4, rot: 2 }] }), /not one of the town's buildings/);
  assert.throws(() => parsePlan({ ops: [{ op: 'civic', id: 'civic:tavern', gx: 3, gz: 4, rot: 4 }] }), /rot/);
  assert.throws(() => parsePlan({ ops: [{ op: 'commons', add: [] }] }), /adds nothing/);
  assert.deepEqual(parsePlan({ ops: [{ op: 'commons', add: [[3, 1], [2, 1], [3, 1]] }] }).ops, [{ op: 'commons', add: [[2, 1], [3, 1]] }]);
});

test('a building turned where it stands: nothing else moves, its road follows the new door', () => {
  const layout = island();
  const tavern = layout.plots['civic:tavern'];
  const rot = (tavern.rot + 2) % 4;
  const r = plan(layout, [{ op: 'civic', id: 'civic:tavern', gx: tavern.gx, gz: tavern.gz, rot }], false);
  assert.equal(r.ok, true, r.error || r.verdicts[0].reason);
  assert.deepEqual(r.diff.plots.otherMoved, []);
  assert.deepEqual(r.diff.plots.moved.map((m) => m.id), ['civic:tavern']);
  assert.equal(layout.plots['civic:tavern'].rot, rot);
  assert.match(r.verdicts[0].notes[0], /turns to face/);
  assertSettled(layout);
});

test('a building carried across the town: only it moves, and the map agrees with the op', () => {
  const layout = island();
  const corners = goodCorners(layout, 'civic:tavern').slice(0, 12);
  assert.ok(corners.length, 'the tavern has somewhere to go');
  // Every corner and way round the map offers is one the op itself accepts: the step's own
  // verdict, before the placement after it has had its say.
  for (const [gx, gz, rot] of corners) {
    const r = plan(copy(layout), [{ op: 'civic', id: 'civic:tavern', gx, gz, rot }]);
    assert.equal(r.verdicts[0].ok, true, `the map offers [${gx}, ${gz}] facing ${rot} and the op says: ${r.verdicts[0].reason}`);
  }
  let done = null;
  for (const c of corners) {
    const r = plan(copy(layout), [{ op: 'civic', id: 'civic:tavern', gx: c[0], gz: c[1], rot: c[2] }]);
    if (r.ok) { done = c; break; }
  }
  assert.ok(done, 'none of the good corners could be applied');
  const r = plan(layout, [{ op: 'civic', id: 'civic:tavern', gx: done[0], gz: done[1], rot: done[2] }], false);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.diff.plots.otherMoved, []);
  assert.deepEqual([layout.plots['civic:tavern'].gx, layout.plots['civic:tavern'].gz, layout.plots['civic:tavern'].rot], done);
  assert.ok(layout.paths.some((p) => p.id === 'path:civic:tavern') || layout.town.paved.some(([x, z]) => Math.abs(x - done[0] - 1) <= 2 && Math.abs(z - done[1] - 1) <= 2),
    'the tavern has a road to its door, or stands on the pavement');
  assertSettled(layout);
});

test('the town hall takes its postbox with it', () => {
  const layout = island();
  const box = copy(layout.plots['civic:mailbox']);
  let applied = null;
  for (const [gx, gz, rot] of goodCorners(layout, 'civic:townhall', 4)) {
    const r = plan(copy(layout), [{ op: 'civic', id: 'civic:townhall', gx, gz, rot }]);
    if (r.ok) { applied = plan(layout, [{ op: 'civic', id: 'civic:townhall', gx, gz, rot }], false); break; }
  }
  assert.ok(applied && applied.ok, 'the town hall found nowhere to go');
  assert.deepEqual(applied.diff.plots.otherMoved, []);
  assert.ok(layout.plots['civic:mailbox'], 'the postbox stands again');
  assert.notDeepEqual([layout.plots['civic:mailbox'].gx, layout.plots['civic:mailbox'].gz], [box.gx, box.gz], 'beside the new door, not the old one');
  assertSettled(layout);
});

test('a nudge takes the building\'s lot with it; a move leaves the lot free', () => {
  const layout = island();
  const terrain = terrainOf(layout);
  // A building standing exactly on a lot, and a one-cell shift it may make.
  let found = null;
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!(layout.town.lots || []).some(([x, z]) => x === p.gx && z === p.gz) || !/^civic:(market|tavern|clocktower|school|watertower|chapel|townhall)$/.test(id)) continue;
    const site = civicSite(layout, terrain, layout.lattice, id);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (site.check(p.gx + dx, p.gz + dz) === null) { found = { id, gx: p.gx + dx, gz: p.gz + dz, rot: p.rot, from: [p.gx, p.gz] }; break; }
    }
    if (found) {
      const r = plan(copy(layout), [{ op: 'civic', ...found, from: undefined }]);
      if (r.ok) break;
      found = null;
    }
  }
  assert.ok(found, 'no building round the square could be nudged a cell');
  const r = plan(layout, [{ op: 'civic', id: found.id, gx: found.gx, gz: found.gz, rot: found.rot }], false);
  assert.equal(r.ok, true, r.error);
  assert.match(r.verdicts[0].notes.join(' '), /lot round the square moves with it/);
  const lots = layout.town.lots.map((l) => l.join(','));
  assert.ok(lots.includes(`${found.gx},${found.gz}`), 'the lot moved to where the building stands');
  assert.ok(!lots.includes(found.from.join(',')), 'and is not left half under it');
  assertSettled(layout);
});

// Found on the live island: the school's door opened into the tavern's lot, which
// `nearestWalkable` lives with, and the first version of `civicSite` held that against the
// tavern - so it could not even be turned where it stood.
test('a lot that already covers a neighbour\'s doorstep may still be turned where it stands', () => {
  const layout = island();
  const tavern = layout.plots['civic:tavern'];
  // The school set down against the tavern's east wall, its door opening west into the tavern.
  layout.plots['civic:school'] = { gx: tavern.gx + 3, gz: tavern.gz, w: 3, d: 3, rot: 3 };
  const site = civicSite(layout, terrainOf(layout), layout.lattice, 'civic:tavern');
  assert.equal(site.check(tavern.gx, tavern.gz), null, 'its own ground is held against it');
  // Moved anywhere else, the same doorstep is still refused.
  assert.match(site.check(tavern.gx + 1, tavern.gz) || '', /doorstep of the school|stands there/);
});

test('refusals say why', () => {
  const layout = island();
  const why = (op) => plan(copy(layout), [op]).verdicts[0].reason;
  const market = layout.plots['civic:market'];
  const [cx, cz] = layout.town.centre;
  assert.match(why({ op: 'civic', id: 'civic:tavern', gx: market.gx, gz: market.gz, rot: 0 }), /the market stands there/);
  assert.match(why({ op: 'civic', id: 'civic:tavern', gx: cx - 1, gz: cz - 1, rot: 0 }), /town square/);
  assert.match(why({ op: 'civic', id: 'civic:tavern', gx: 20, gz: 20, rot: 0 }), /not the town's ground/);
  assert.match(why({ op: 'civic', id: 'civic:well', gx: 20, gz: 20, rot: 0 }), /belongs where it stands/);
  assert.match(why({ op: 'civic', id: 'civic:castle', gx: 20, gz: 20, rot: 0 }), /does not stand on the island/);
  const tavern = layout.plots['civic:tavern'];
  assert.match(why({ op: 'civic', id: 'civic:tavern', gx: tavern.gx, gz: tavern.gz, rot: tavern.rot }), /already stands there/);
  // Half on the free lot: some building, some one-cell offset from it, says exactly that.
  const terrain = terrainOf(layout);
  const used = new Set(Object.values(layout.plots).map((p) => `${p.gx},${p.gz}`));
  const free = layout.town.lots.find((l) => !used.has(l.join(',')));
  assert.ok(free, 'the island has a free lot to test against');
  let half = null;
  for (const id of ['civic:chapel', 'civic:tavern', 'civic:market', 'civic:school', 'civic:watertower', 'civic:clocktower']) {
    const site = civicSite(layout, terrain, layout.lattice, id);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]]) {
      const w = site.check(free[0] + dx, free[1] + dz);
      if (w && /half on a free lot/.test(w)) { half = w; break; }
    }
    if (half) break;
  }
  assert.ok(half, 'nothing was refused for standing half on the free lot');
});

test('the town can be given more ground, and the planner offers it to its buildings', () => {
  const layout = island();
  const have = new Set(layout.town.commons.map((c) => c.join(',')));
  for (let j = -TOWN_CORE_R; j <= TOWN_CORE_R; j++) for (let i = -TOWN_CORE_R; i <= TOWN_CORE_R; i++) have.add(`${i},${j}`);
  // Every super-cell next to the town's ground, and the first one the island will give.
  const edge = [];
  for (const k of have) {
    const [i, j] = k.split(',').map(Number);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!have.has(`${i + a},${j + b}`)) edge.push([i + a, j + b]);
  }
  let given = null;
  for (const c of edge) {
    const r = plan(copy(layout), [{ op: 'commons', add: [c] }]);
    if (r.ok) { given = c; break; }
  }
  assert.ok(given, 'no super-cell beside the town could be given to it');
  const r = plan(layout, [{ op: 'commons', add: [given] }], false);
  assert.equal(r.ok, true, r.error);
  assert.ok(layout.town.commons.some(([i, j]) => i === given[0] && j === given[1]));
  assertSettled(layout);

  // Refused: ground that is somebody's, and ground that does not touch the town.
  const hamlet = Object.values(layout.districts).flatMap((d) => d.lobes || []).flatMap((l) => l.cells)[0];
  if (hamlet) assert.match(plan(copy(layout), [{ op: 'commons', add: [hamlet] }]).verdicts[0].reason, /'s land|belt/);
  assert.match(plan(copy(layout), [{ op: 'commons', add: [...layout.town.commons.slice(0, 1)] }]).verdicts[0].reason, /already/);

  // And the bitmap now reaches onto it.
  const S = civicSites(layout, terrainOf(layout));
  const [bx, bz] = blockOf(layout.lattice, given[0], given[1]);
  assert.ok(bx >= S.gx && bz >= S.gz && bx < S.gx + S.w + 2 && bz < S.gz + S.h + 2, 'the new ground is inside the window the planner colours');
});

test('a dry run that moves a building hands back where the buildings may stand after it', () => {
  const layout = island();
  const hall = layout.plots['civic:townhall'];
  const [gx, gz, rot] = goodCorners(layout, 'civic:townhall', 4)[0];
  const r = plan(copy(layout), [{ op: 'civic', id: 'civic:townhall', gx, gz, rot }]);
  assert.ok(r.civics && r.civics.sites['civic:tavern'], 'no bitmaps with the dry run');
  // The hall's old lot is free in the draft: the tavern may be set down exactly on it now.
  const S = r.civics;
  const at = (id, x, z) => (S.sites[id][z - S.gz] || '').charAt(x - S.gx);
  if (r.ok) assert.notEqual(at('civic:tavern', hall.gx, hall.gz), '0', "the hall's lot is not offered to the tavern in the draft");
  const plain = plan(copy(layout), [{ op: 'zone', add: [[TOWN_CORE_R + 6, 0]] }]);
  assert.equal(plain.civics, undefined, 'a dry run that moves no building of the town pays nothing for bitmaps');
});
