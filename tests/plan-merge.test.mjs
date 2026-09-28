// Bringing a project that stands in pieces home onto one piece of land, and not letting it
// fall apart again (Plans/wijkjes-samenvoegen.md).
//
// What a merge has to be: every house of the project ends up on the one piece that stays,
// with its sheds; the other pieces are countryside again; nothing else moves and nobody is
// cut off from the square; the piece that stays is lobe 0 with its road and office to match;
// and the scan after it changes nothing. And what the scan itself has to be now: a project
// that is boxed in grows wider rather than founding an annex.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, Super, heldOf, registerLand, districtOrder, growLobe, NONE } from '../lib/layout.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { blockOf, centreOfCell, superOf } from '../shared/lattice.mjs';
import { village, stands, movedBetween, cutOff, overlaps } from './support/village.mjs';

const SEED = 1337, SIZE = 128;
const opts = { seed: SEED, size: SIZE };
const D = 'proj:0';
const k = (c) => `${c[0]},${c[1]}`;

function settled(n = 36) {
  const model = village(n);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout };
}
const groundOf = (l) => makeTerrain(SEED, { size: l.size, polders: l.polders, fairway: l.fairway, grow: l.grow });
function register(layout, model) {
  const sup = new Super(groundOf(layout), layout.lattice, heldOf(layout));
  registerLand(sup, layout, districtOrder(model).ordOf, null);
  return sup;
}
const houseOf = (layout, n) => `house:${D}:${n}`;
const onPiece = (layout, id, lobe) => { const p = layout.plots[id]; return !!p && p.district === D && !p.commons && p.lobe === lobe; };
const ownerOf = (layout, c) => Object.entries(layout.districts).find(([, d]) => d.lobes.some((l) => l.cells.some((x) => k(x) === k(c))));

// The island the scan used to make: proj:0 with one house out in an annex a few super-cells
// off, and one on the town's commons. Built by hand, because the scan no longer makes either,
// and settled by two ordinary scans so the annex has its road and every door its path.
function scattered() {
  const { model, layout } = settled();
  const rec = layout.districts[D];
  const lat = layout.lattice;
  const sup = register(layout, model);
  const own = rec.lobes[0].cells;
  const ordK = districtOrder(model).ordOf.get(D);
  // An annex: the nearest super-cell three to six away from proj:0's land that a scan could
  // have claimed for it, with a free 3x3 on it.
  let annex = null;
  for (let r = 3; r <= 6 && !annex; r++) {
    for (const [i0, j0] of own) {
      for (let dj = -r; dj <= r && !annex; dj++) for (let di = -r; di <= r && !annex; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const c = [i0 + di, j0 + dj];
        if (own.some((o) => Math.max(Math.abs(o[0] - c[0]), Math.abs(o[1] - c[1])) < 3)) continue;
        if (sup.eligible(c[0], c[1], ordK, false)) annex = c;
      }
      if (annex) break;
    }
  }
  assert.ok(annex, 'no room for an annex to build the test on');
  const away = houseOf(layout, 1), square = houseOf(layout, 2);
  const [gx, gz] = blockOf(lat, annex[0], annex[1]);
  rec.lobes.push({ seed: annex, cells: [annex], green: 0, square: null, centre: centreOfCell(lat, annex), paved: [], road: null });
  Object.assign(layout.plots[away], { gx, gz, rot: 0, cell: annex, lobe: 1 });
  // On the commons: its first empty lot, facing the square.
  const taken = new Set(Object.values(layout.plots).filter((p) => p.commons).map((p) => k(p.cell)));
  const lot = layout.town.commons.find((c) => {
    if (taken.has(k(c))) return false;
    const [x, z] = blockOf(lat, c[0], c[1]);
    for (const p of Object.values(layout.plots)) if (p.gx < x + 3 && p.gx + p.w > x && p.gz < z + 3 && p.gz + p.d > z) return false;
    return Math.abs(c[0]) + Math.abs(c[1]) > 2;
  });
  assert.ok(lot, 'no lot on the commons to build the test on');
  const [cx, cz] = blockOf(lat, lot[0], lot[1]);
  Object.assign(layout.plots[square], { gx: cx, gz: cz, rot: 0, cell: lot, lobe: -1, commons: true });
  for (const id of [away, square]) {
    layout.paths = layout.paths.filter((p) => p.id !== `path:${id}`);
    for (const [s, m] of Object.entries(layout.shedOf || {})) if (m === id) delete layout.plots[s];
  }
  layout.cleared = [];
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  assert.equal(layout.districts[D].lobes.length, 2, 'the annex was kept');
  assert.ok(onPiece(layout, away, 1) && layout.plots[square].commons, 'the two houses stand apart');
  return { model, layout, away, square, annex };
}

test('a merge brings a house home from an annex and one from the commons, and nothing else moves', () => {
  const { model, layout, away, square, annex } = scattered();
  const wasStanding = stands(layout);
  const plan = parsePlan({ ops: [{ op: 'merge', district: D, lobe: 0 }] });

  const dry = runPlan(layout, model, plan, { ...opts, dryRun: true });
  assert.ok(dry.ok, `dry run refused: ${dry.error}`);
  assert.deepEqual(stands(layout), wasStanding, 'a dry run moved something');

  const r = runPlan(layout, model, plan, opts);
  assert.ok(r.ok, `apply refused: ${r.error}`);
  assert.deepEqual(r.diff.plots.otherMoved, []);
  assert.deepEqual(r.diff.scattered, []);
  const moved = movedBetween(wasStanding, stands(layout));
  assert.ok(moved.includes(away) && moved.includes(square), 'both came home');
  assert.ok(moved.every((id) => id === away || id === square || id.startsWith(`shed:${D}:`)), `only the household moved: ${moved.join(', ')}`);

  const rec = layout.districts[D];
  assert.equal(rec.lobes.length, 1, 'one piece of land');
  for (const b of model.buildings) if (b.kind !== 'shed' && b.district === D) assert.ok(onPiece(layout, b.id, 0), `${b.id} is not on proj:0's land`);
  assert.equal(ownerOf(layout, annex), undefined, 'the annex is countryside again');
  assert.ok(!layout.paths.some((p) => p.id === `road:${D}:1`), "the annex's road went with it");
  assert.deepEqual(cutOff(layout, SIZE), [], 'somebody has no way to the square');
  assert.deepEqual(overlaps(layout), []);

  const once = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), once, 'the scan after the merge moved something');
});

test('the piece that stays becomes lobe 0, with its road renamed and the office at its gate', () => {
  const { model, layout, away } = scattered();
  const office = `civic:office:${D}`;
  assert.ok(layout.plots[office], 'proj:0 is a repository with an office');
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'merge', district: D, lobe: 1 }] }), opts);
  assert.ok(r.ok, `apply refused: ${r.error}`);
  const rec = layout.districts[D];
  assert.equal(rec.lobes.length, 1);
  assert.ok(onPiece(layout, away, 0), 'the house that stood in the annex stays and is on lobe 0 now');
  assert.equal(rec.lobes[0].road, `road:${D}:0`);
  assert.ok(layout.paths.some((p) => p.id === `road:${D}:0`), 'the road is on record under its new name');
  assert.ok(!layout.paths.some((p) => p.id === `road:${D}:1`), 'and not under its old one');
  assert.ok(layout.plots[office], 'the office stands again');
  const s = superOf(layout.lattice, layout.plots[office].gx, layout.plots[office].gz);
  const far = Math.min(...rec.lobes[0].cells.map((c) => Math.max(Math.abs(c[0] - s[0]), Math.abs(c[1] - s[1]))));
  assert.ok(far <= 1, `the office stands ${far} super-cells from the piece that stays`);
  for (const b of model.buildings) if (b.kind !== 'shed' && b.district === D) assert.ok(onPiece(layout, b.id, 0), `${b.id} is not on proj:0's land`);
  assert.deepEqual(cutOff(layout, SIZE), []);
  const once = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), once, 'the scan after the merge moved something');
});

test('a merge with no room to grow into is refused in words, and changes nothing', () => {
  const { model, layout, annex } = scattered();
  // Keep the annex - one super-cell - and give every free cell round it to a neighbour, so it
  // has nowhere to take the rest of the project in. Land, not a zone: a zone is a wall to the
  // roads as well, and would cut the annex off before the merge was ever asked.
  const sup = register(layout, model);
  const wall = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const c = [annex[0] + di, annex[1] + dj];
    if ((di || dj) && sup.at(c[0], c[1]) === NONE) wall.push(c);
  }
  assert.ok(wall.length, 'nothing to wall the annex in with');
  layout.districts['proj:1'].lobes.push({ seed: wall[0], cells: wall, green: 0, square: null, centre: centreOfCell(layout.lattice, wall[0]), paved: [], road: 'road:proj:1:wall' });
  const before = JSON.stringify(layout);
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'merge', district: D, lobe: 1 }] }), opts);
  assert.equal(r.ok, false);
  assert.match(r.verdicts[0].reason, /has room for 1 of its \d+ houses where it stands; move it somewhere roomier first/);
  assert.equal(JSON.stringify(layout), before, 'a refused merge changed the layout');
});

test('what a merge may say, and what it refuses', () => {
  assert.deepEqual(parsePlan({ ops: [{ op: 'merge', district: 'p:c:\\x', lobe: 2 }] }).ops[0], { op: 'merge', district: 'p:c:\\x', lobe: 2 });
  assert.deepEqual(parsePlan({ ops: [{ op: 'merge', district: 'p:c:\\x' }] }).ops[0].lobe, 0);
  assert.throws(() => parsePlan({ ops: [{ op: 'merge', district: '__proto__' }] }));
  assert.throws(() => parsePlan({ ops: [{ op: 'merge', district: 'x', lobe: 9 }] }), /out of range/);
  const { model, layout } = settled();
  const one = runPlan(layout, model, parsePlan({ ops: [{ op: 'merge', district: D, lobe: 0 }] }), { ...opts, dryRun: true });
  assert.equal(one.ok, false);
  assert.match(one.verdicts[0].reason, /already stands in one piece/);
  const none = runPlan(layout, model, parsePlan({ ops: [{ op: 'merge', district: D, lobe: 3 }] }), { ...opts, dryRun: true });
  assert.match(none.verdicts[0].reason, /has no lobe 3/);
});

test('a lobe boxed in by its neighbours grows up against them rather than falling apart', () => {
  const { layout } = settled();
  const lat = layout.lattice;
  const sup = new Super(groundOf(layout), lat, null);
  // A piece of land with a neighbour's all round it two super-cells out, so every cell beside
  // it is in the neighbour's belt and the ordinary rule has nowhere to go.
  let seed = null;
  for (let j = -12; j <= 12 && !seed; j++) {
    for (let i = -12; i <= 12 && !seed; i++) {
      if (Math.abs(i) < 4 && Math.abs(j) < 4) continue;
      let ok = true;
      for (let b = -2; b <= 2 && ok; b++) for (let a = -2; a <= 2 && ok; a++) ok = sup.usable(i + a, j + b, false);
      if (ok) seed = [i, j];
    }
  }
  assert.ok(seed, 'no open ground to build the test on');
  sup.claim(seed[0], seed[1], 0, null);
  for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (Math.max(Math.abs(a), Math.abs(b)) === 2) sup.claim(seed[0] + a, seed[1] + b, 1, null);
  const lobe = { seed, cells: [seed], green: 0, square: null, centre: centreOfCell(lat, seed), paved: [], road: null };
  assert.equal(sup.eligible(seed[0] + 1, seed[1], 0, false), false, 'the cell beside it is in the belt');
  assert.ok(growLobe(sup, lobe, 0, 4, 4, false, null), 'it grew');
  assert.equal(lobe.cells.length, 4);
  for (const c of lobe.cells) assert.ok(Math.max(Math.abs(c[0] - seed[0]), Math.abs(c[1] - seed[1])) <= 1, 'one piece, against the neighbour');
  for (const c of lobe.cells) assert.equal(sup.at(c[0], c[1]), 0, "and never on the neighbour's land");
});

test('a village that fills its island founds no annex for any project', () => {
  // Measured before this, on the same seed and settlers: nine projects in two or three pieces
  // and 26 of 231 houses on the commons.
  const layout = emptyLayout(SEED, SIZE);
  for (let n = 24; n <= 240; n += 24) placeAll(layout, village(n), opts);
  const pieces = Object.entries(layout.districts).filter(([id, d]) => id.startsWith('proj:') && d.lobes.length > 1).map(([id]) => id);
  assert.deepEqual(pieces, [], 'a project stands in more than one piece');
  const commons = Object.entries(layout.plots).filter(([id, p]) => id.startsWith('house:') && p.commons).length;
  assert.ok(commons <= 12, `${commons} houses on the commons`);
  assert.deepEqual(overlaps(layout), []);
});

test('on an island with room to grow, every project keeps all its houses on its own land', () => {
  // The live island's situation: founded small, room to grow, a settler or so per project a
  // scan. On this seed that now holds for every house; it took the beach rung of `growLobe`
  // (13 of proj:0's houses went to the commons without it), a house asking for land it can
  // stand on (`roomy`) and waiting for the ring when it got none. Not every seed gets there:
  // see the next test.
  const layout = emptyLayout(7, 256, { base: 32, steps: [] });
  for (let n = 12; n <= 240; n += 12) placeAll(layout, village(n), { seed: 7, size: 256 });
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!id.startsWith('house:')) continue;
    assert.ok(!p.commons, `${id} stands on the commons`);
    const d = id.split(':').slice(1, 3).join(':');
    assert.equal(p.district, d);
    assert.equal(p.lobe, 0, `${id} stands on piece ${p.lobe} of ${d}`);
  }
  assert.ok(Object.values(layout.districts).every((d) => d.lobes.length <= 1), 'a project stands in more than one piece');
});

test('a house goes to the commons only when its project is walled in', () => {
  // The seed where it does not all fit: the first two projects, founded beside the square
  // while the island was small, are walled in by the town and by neighbours that grew up
  // against them (`growLobe`'s belt-0 rung) before they needed the land themselves - 31 of
  // 240 houses on the commons, one to eight super-cells from home (Plans/wijkjes-samenvoegen.md,
  // still open). What must hold is that none of them had anywhere of its own to go: no free
  // 3x3 on its project's land, and none on the free ground beside it, when it was placed.
  const seed = 3;
  const layout = emptyLayout(seed, 256, { base: 32, steps: [] });
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const seen = new Set();
  for (let n = 12; n <= 240; n += 12) {
    const model = village(n);
    placeAll(layout, model, { seed, size: 256 });
    const lodgers = Object.entries(layout.plots).filter(([id, p]) => id.startsWith('house:') && p.commons && !seen.has(id));
    if (!lodgers.length) continue;
    const terrain = makeTerrain(seed, { size: layout.size, polders: layout.polders, fairway: layout.fairway, grow: layout.grow });
    const sup = new Super(terrain, layout.lattice, heldOf(layout));
    registerLand(sup, layout, districtOrder(model).ordOf, null);
    const used = new Set();
    for (const p of layout.paths) for (const c of p.cells) used.add(k(c));
    for (const p of Object.values(layout.plots)) for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) used.add(k([p.gx + x, p.gz + z]));
    const free = ([i, j]) => {
      const [gx, gz] = blockOf(layout.lattice, i, j);
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) if (used.has(k([gx + x, gz + z])) || !terrain.isBuildable(gx + x, gz + z)) return false;
      return true;
    };
    for (const [id, p] of lodgers) {
      seen.add(id);
      for (const lobe of layout.districts[p.district].lobes) {
        for (const c of lobe.cells) {
          assert.ok(!free(c), `${id} went to the commons with ${k(c)} of its own land free`);
          for (const [a, b] of N4) {
            const o = [c[0] + a, c[1] + b];
            if (sup.at(o[0], o[1]) === NONE && sup.usable(o[0], o[1], true)) assert.ok(!free(o), `${id} went to the commons with ${k(o)} free beside its land`);
          }
        }
      }
    }
  }
  assert.ok(seen.size > 0, 'this seed was chosen because not everything fits; if it all does now, tighten the test above');
  assert.ok(Object.values(layout.districts).every((d) => d.lobes.length <= 1), 'a project stands in more than one piece');
});
