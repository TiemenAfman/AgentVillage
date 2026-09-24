// The gold pit by the square: the keeper's five-hour usage window as a pile of bars, and
// every settler who sets to work walking over for one first (Plans/goudkuil.md).
//
// Five things are held here, each for the way it would fail without anybody noticing:
//
//   the count       a reading turned into bars, and no reading or a window that has run
//                   out being a full pit rather than an empty one;
//   the status line the one place Claude Code hands the window over. It must never cost
//                   anybody their own status line, and it must write the file only when
//                   the number moved;
//   the place       a three by three near the square, written once and never moved, and
//                   never on one of the civic lots the milestones are waiting for;
//   the errand      out, load, home with a bar, back to work - on the walk's own terms,
//                   with a stream of its own - and surviving the crowd being rebuilt once a
//                   minute, which is the whole reason `adopt` exists;
//   the drawing     one mesh for the silo, a hundred bars that fit inside it, and the sea's
//                   copy of where the heap is agreeing with the page's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import { goldOf, GOLD_BARS, GOLDPIT_ID } from '../shared/gold.mjs';
import { readingOf, readUsage, writeUsage, sameReading } from '../lib/usage.mjs';
import { installStatusLine, uninstallStatusLine, readStatusLine, statusLineCommand, ensureStatusLine } from '../lib/statusline.mjs';
import { emptyLayout, placeAll, outsideDoor } from '../lib/layout.mjs';
import { createCrowd, goldSite, GOLD_LOAD_IN, GOLD_PILE_BACK } from '../lib/crowd.mjs';
import { MAX_GOLD } from '../shared/settlerwalk.mjs';
import { encodeCrowd, decodeCrowd, ANIMS, MOVING } from '../shared/settlerwire.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding } = await import('../web/js/buildings.js');
const { pileSlots, attachGoldPile, goldBarGeometry, BAR, PILE_PITCH, PILE_Z } = await import('../web/js/goldpit.js');
const THREE = await import('three');
delete globalThis.document;

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'goldpit-'));

// ---- the count ------------------------------------------------------------------------

test('a reading comes to one bar a percent left, and no reading is a full pit', () => {
  const now = Date.UTC(2026, 8, 24, 12);
  const at = (used, resetsAt = now + 3600e3) => ({ fiveHour: { used, resetsAt }, at: now - 1000 });
  assert.equal(goldOf(at(27.4), now).bars, 73);
  assert.equal(goldOf(at(0), now).bars, GOLD_BARS);
  assert.equal(goldOf(at(100), now).bars, 0);
  assert.equal(goldOf(at(140), now).bars, 0, 'a percentage past 100 is an empty pit, not a negative one');
  assert.equal(goldOf(at(27.4), now).known, true);

  const none = goldOf(null, now);
  assert.equal(none.bars, GOLD_BARS);
  assert.equal(none.known, false, 'the dossier has to be able to tell "no reading" from "nothing used"');
  assert.equal(goldOf({ fiveHour: { used: 'lots' } }, now).known, false);

  // The window ran out after the reading was taken: that is a reset, and a reset is full.
  const reset = goldOf(at(88, now - 1), now);
  assert.equal(reset.bars, GOLD_BARS);
  assert.equal(reset.reset, true);
});

test('the status line JSON is read for the five-hour window and nothing is invented', () => {
  const now = 1790000000000;
  const r = readingOf({ rate_limits: { five_hour: { used_percentage: 23.46, resets_at: 1790003600 }, seven_day: { used_percentage: 41.2, resets_at: 1790400000 } } }, now);
  assert.deepEqual(r.fiveHour, { used: 23.5, resetsAt: 1790003600000 }, 'seconds become milliseconds, the percentage a tenth');
  assert.deepEqual(r.sevenDay, { used: 41.2, resetsAt: 1790400000000 });
  assert.equal(r.at, now);
  assert.equal(readingOf({ model: { id: 'x' } }), null, 'an API key has no window, and that is not a reading of nothing used');
  assert.equal(readingOf({ rate_limits: { seven_day: { used_percentage: 3, resets_at: 1 } } }), null);
  assert.equal(readingOf({ rate_limits: { five_hour: { used_percentage: 'x', resets_at: 1 } } }), null);
  assert.equal(readingOf(null), null);
});

test('usage.json is written only when the reading moved, and read back field by field', () => {
  const dir = scratch();
  const file = path.join(dir, 'usage.json');
  const r = readingOf({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 1790003600 } } }, 1);
  assert.equal(writeUsage(r, file), true);
  assert.equal(writeUsage({ ...r, at: 2 }, file), false, 'the same number again is not a write');
  assert.deepEqual(readUsage(file).fiveHour, r.fiveHour);
  assert.ok(sameReading(readUsage(file), r));
  const later = readingOf({ rate_limits: { five_hour: { used_percentage: 11, resets_at: 1790003600 } } }, 3);
  assert.equal(writeUsage(later, file), true);
  assert.equal(readUsage(file).fiveHour.used, 11);

  fs.writeFileSync(file, '{"fiveHour":{"used":"a lot"}}');
  assert.equal(readUsage(file), null, 'anything on this machine can write into data/, and the page draws what this returns');
  fs.writeFileSync(file, 'not json');
  assert.equal(readUsage(file), null);
  assert.equal(readUsage(path.join(dir, 'missing.json')), null);
});

// ---- the status line ------------------------------------------------------------------

// Run from a copy of the four files it needs, in a scratch folder: lib/paths.mjs puts data/
// beside the code it is loaded from, so run in place it would write into this checkout's own
// data/usage.json - the real island's.
const STATUS_LINE_FILES = ['hooks/statusline.mjs', 'lib/usage.mjs', 'lib/paths.mjs', 'shared/gold.mjs'];
function statusLine(input, args = []) {
  const home = scratch();
  for (const rel of STATUS_LINE_FILES) {
    fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(home, rel));
  }
  const r = spawnSync(process.execPath, [path.join(home, 'hooks', 'statusline.mjs'), ...args], {
    input, encoding: 'utf8', timeout: 20000,
  });
  return { ...r, home, usage: readUsage(path.join(home, 'data', 'usage.json')) };
}

test('the status line writes the window down and prints the pit', () => {
  const resets = Math.floor(Date.now() / 1000) + 3600;
  const input = JSON.stringify({ model: { display_name: 'Opus' }, cwd: '/x/farm', rate_limits: { five_hour: { used_percentage: 27.4, resets_at: resets } } });
  const r = statusLine(input);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^⛏ 73\/100 gold · full again at /);
  assert.equal(r.usage.fiveHour.used, 27.4);
  assert.equal(r.usage.fiveHour.resetsAt, resets * 1000);
});

test('in front of somebody else\'s status line it hands stdin on byte for byte', () => {
  const input = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 60 } }, extra: 'ü' });
  const r = statusLine(input, ['--pass']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, input, 'their command gets exactly the JSON it always got');
  assert.equal(r.usage.fiveHour.used, 5);
  // And garbage in is garbage out, never a crash and never a blank line of theirs.
  const junk = statusLine('not json at all', ['--pass']);
  assert.equal(junk.status, 0);
  assert.equal(junk.stdout, 'not json at all');
  assert.equal(junk.usage, null);
});

test('with no window the status line still says something useful', () => {
  const r = statusLine(JSON.stringify({ model: { display_name: 'Sonnet' }, workspace: { current_dir: '/home/me/farm' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'Sonnet · farm');
});

test('setup adds the status line, or puts it in front of one that was there, and takes it back out', () => {
  const script = 'C:\\promptholm\\hooks\\statusline.mjs';
  const ours = statusLineCommand(script);
  assert.equal(ours, 'node "C:/promptholm/hooks/statusline.mjs"', 'forward slashes: the command runs through Git Bash');

  const added = installStatusLine({ theme: 'dark' }, script);
  assert.equal(added.did, 'added');
  assert.deepEqual(added.settings.statusLine, { type: 'command', command: ours, padding: 0 });
  assert.equal(added.settings.theme, 'dark', 'everything else is left alone');

  const theirs = { type: 'command', command: 'bash ~/.claude/line.sh', padding: 2, refreshInterval: 5 };
  const wrapped = installStatusLine({ statusLine: theirs }, script);
  assert.equal(wrapped.did, 'wrapped');
  assert.equal(wrapped.settings.statusLine.command, `${ours} --pass | bash ~/.claude/line.sh`);
  assert.equal(wrapped.settings.statusLine.padding, 2);
  assert.equal(wrapped.settings.statusLine.refreshInterval, 5);
  assert.deepEqual(readStatusLine(wrapped.settings.statusLine), { ours: true, wraps: 'bash ~/.claude/line.sh' });

  // Twice is once, and a checkout that moved is pointed at, not wrapped a second time.
  assert.equal(installStatusLine(wrapped.settings, script).did, 'unchanged');
  const moved = installStatusLine(wrapped.settings, '/elsewhere/hooks/statusline.mjs');
  assert.equal(moved.did, 'updated');
  assert.equal(moved.settings.statusLine.command, 'node "/elsewhere/hooks/statusline.mjs" --pass | bash ~/.claude/line.sh');

  // A status line that is not a command has nothing a pipe can go in front of.
  assert.equal(installStatusLine({ statusLine: { type: 'static', text: 'hi' } }, script).did, 'kept');

  const back = uninstallStatusLine(wrapped.settings);
  assert.equal(back.did, 'unwrapped');
  assert.deepEqual(back.settings.statusLine, theirs, 'theirs comes back exactly as it was');
  const gone = uninstallStatusLine(added.settings);
  assert.equal(gone.did, 'removed');
  assert.equal('statusLine' in gone.settings, false);
  assert.equal(uninstallStatusLine({ statusLine: theirs }).did, 'absent', 'somebody else\'s is never taken out');
  // A script of their own that happens to share the file name is theirs.
  assert.equal(readStatusLine({ type: 'command', command: 'node ~/statusline.mjs' }).ours, false);
});

// ---- the place ------------------------------------------------------------------------

function village(settlers) {
  const startedAt = Date.UTC(2026, 0, 2);
  const districts = [{ id: 'p:d:\\git\\farm', kind: 'project', name: 'farm', population: settlers, firstSeenAt: startedAt }];
  const buildings = Array.from({ length: settlers }, (_, i) => ({
    id: `house:farm-${i}`, sessionId: `farm-${i}`, kind: 'house', district: districts[0].id, tier: 'hut', startedAt: startedAt + i * 1000,
  }));
  return { districts, buildings, milestones: [], furniture: [], stats: { settlers } };
}

for (const [seed, size, n] of [[1337, 128, 12], [7, 128, 40], [90210, 64, 5]]) {
  test(`the pit stands near the square, faces it, has a road, and stays put (seed ${seed})`, () => {
    const layout = emptyLayout(seed, size);
    const { unplaced } = placeAll(layout, village(n), { seed, size });
    assert.ok(!unplaced.includes(GOLDPIT_ID), 'there was room for the pit');
    const p = layout.plots[GOLDPIT_ID];
    assert.equal(p.w, 3);
    assert.equal(p.d, 3);
    const c = layout.town.centre;
    const mid = [p.gx + 1, p.gz + 1];
    assert.ok(Math.hypot(mid[0] - c[0], mid[1] - c[1]) <= 12, `the pit is ${Math.hypot(mid[0] - c[0], mid[1] - c[1]).toFixed(1)} cells from the square`);
    // Its open end towards the town: the door side is the one nearest the centre.
    const door = outsideDoor(p.gx, p.gz, p.rot);
    assert.ok(Math.hypot(door[0] - c[0], door[1] - c[1]) < Math.hypot(mid[0] - c[0], mid[1] - c[1]), 'the pit turns its back on the town');
    // Not on a lot the milestones are waiting for.
    for (const [gx, gz] of layout.town.lots || []) {
      assert.ok(gx + 3 <= p.gx || p.gx + 3 <= gx || gz + 3 <= p.gz || p.gz + 3 <= gz, `the pit took the civic lot at ${gx},${gz}`);
    }
    const road = layout.paths.find((q) => q.id === `path:${GOLDPIT_ID}`);
    assert.ok(road, 'a road to its mouth');

    placeAll(layout, village(n + 3), { seed, size });
    assert.deepEqual(layout.plots[GOLDPIT_ID], p, 'the pit never moves by itself');
    placeAll(layout, village(n + 3), { seed, size });
    const again = JSON.stringify(layout);
    placeAll(layout, village(n + 3), { seed, size });
    assert.equal(JSON.stringify(layout), again, 'a second scan changes nothing');
  });
}

test('the walk finds the pit\'s mouth where the layout laid its road', () => {
  const terrain = makeTerrain(1337, { size: 64 });
  for (let rot = 0; rot < 4; rot++) {
    const bundle = { buildings: [{ id: GOLDPIT_ID, kind: 'civic', civicType: 'goldpit', plot: { gx: 20, gz: 24, w: 3, d: 3, rot } }] };
    const site = goldSite(bundle, terrain);
    assert.deepEqual(site.cell, outsideDoor(20, 24, rot), `rot ${rot}`);
  }
  assert.equal(goldSite({ buildings: [] }, terrain), null, 'no pit, no errand');
});

// ---- the errand -----------------------------------------------------------------------

const SIZE = 64, SEED = 1337;
// A lane of houses along the middle of the island and the pit at its far end, open towards
// the lane, with a stub of road from the lane to the cell in front of its mouth.
function island({ active = [0], houses = 6, pit = true, shift = 0 } = {}) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, houses).map(([gx, gz], i) => ({
    id: `house:${String(i).padStart(3, '0')}`, kind: 'house', name: `H${i}`, style: 'opus', active: active.includes(i),
    plot: { gx: gx + (i === 0 ? shift : 0), gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  const end = lane[lane.length - 3];
  if (pit) buildings.push({ id: GOLDPIT_ID, kind: 'civic', civicType: 'goldpit', plot: { gx: end[0] - 1, gz: end[1] - 4, w: 3, d: 3, rot: 2 } });
  return {
    id: 'goldholm',
    terrain,
    bundle: {
      island: { name: 'Goldholm', seed: SEED, gridSize: SIZE, town: { paved: lane.slice(0, 3) } },
      buildings,
      paths: [{ id: 'lane', cells: lane }, { id: 'stub', cells: [[end[0], end[1] - 1]] }],
    },
  };
}

// Step a crowd a tick at a time and write down every change of what one settler is doing.
function watch(crowd, id, seconds, each = () => {}) {
  const seen = [];
  let last = '';
  for (let t = 0; t < seconds * 20; t++) {
    crowd.advance(1, 0);
    each(t);
    const f = crowd.figures.get(id);
    const s = `${f.mode}|${f.carry || '-'}`;
    if (s !== last) { seen.push({ t: t / 20, mode: f.mode, carry: f.carry, pos: [...f.pos] }); last = s; }
  }
  return seen;
}

test('a settler at work walks to the pit, loads, carries a bar home and goes back to work', () => {
  const it = island();
  const crowd = createCrowd(it);
  const seen = watch(crowd, 'house:000', 320);
  const modes = seen.map((s) => `${s.mode}${s.carry ? '+gold' : ''}`);
  const i = modes.indexOf('gold');
  assert.ok(i > 0, `never loaded: ${modes.join(' → ')}`);
  assert.equal(modes[i - 1], 'walk', 'walked to the pit');
  assert.equal(modes[i + 1], 'walk+gold', 'left it with a bar');
  assert.equal(modes[i + 2], 'hammer', 'and went back to work, bar put down');
  assert.ok(seen[i - 1].t <= 20, 'the first trip starts soon after setting to work');
  // Loading happens in the pit, at the loading spot, not at the road's end outside it.
  const site = goldSite(it.bundle, it.terrain);
  const load = seen[i].pos;
  assert.ok(Math.hypot(load[0] - site.at[0], load[1] - site.at[1]) < 0.45, 'loaded at the pile');
  assert.equal(crowd.walk.goldTrips(), 0, 'the trip counted itself back in');
  const f = crowd.figures.get('house:000');
  assert.ok(f.goldIn > 100, 'and the next one is minutes off');
});

test('nobody idle goes for gold, and without a pit the workers only hammer', () => {
  const crowd = createCrowd(island({ active: [0] }));
  watch(crowd, 'house:001', 60);
  const idle = crowd.figures.get('house:001');
  assert.equal(idle.goldIn, null);
  assert.equal(idle.carry, null);

  const bare = createCrowd(island({ pit: false }));
  const seen = watch(bare, 'house:000', 60);
  assert.deepEqual(seen.map((s) => s.mode), ['hammer'], 'an island from before the pit is the island it was');
});

test('the errand draws nothing from the walk\'s own stream', () => {
  // A worker only hammers without a pit, and hammering draws nothing. So after a whole trip
  // to the pit and back, the next number on their walk stream must be the one it would
  // have been had they never gone.
  const withPit = createCrowd(island());
  const without = createCrowd(island({ pit: false }));
  withPit.advance(20 * 320, 0);
  without.advance(20 * 320, 0);
  assert.equal(withPit.figures.get('house:000').rng.next(), without.figures.get('house:000').rng.next());
});

test('never more than MAX_GOLD out at once', () => {
  const houses = 16;
  const crowd = createCrowd(island({ active: Array.from({ length: houses }, (_, i) => i), houses }));
  let most = 0;
  for (let t = 0; t < 20 * 90; t++) {
    crowd.advance(1, 0);
    most = Math.max(most, crowd.walk.goldTrips());
    assert.ok(crowd.walk.goldTrips() <= MAX_GOLD);
  }
  assert.equal(most, MAX_GOLD, 'with sixteen at work the lane fills up to the cap');
});

test('a republish half-way to the pit does not stand them back at their door', () => {
  const it = island();
  let crowd = createCrowd(it);
  // Out on the lane, a bar in hand or not.
  let f = crowd.figures.get('house:000');
  for (let t = 0; t < 20 * 40 && f.mode !== 'walk'; t++) crowd.advance(1, 0);
  crowd.advance(20 * 10, 0);
  f = crowd.figures.get('house:000');
  assert.equal(f.mode, 'walk');
  const was = [...f.pos];
  const next = createCrowd(island(), { known: new Set(crowd.figures.keys()), before: crowd });
  const g = next.figures.get('house:000');
  assert.deepEqual(g.pos, was, 'where they were, not at their door');
  assert.equal(g.mode, 'walk');
  assert.deepEqual(g.after, f.after);
  assert.equal(next.walk.goldTrips(), 1);
  // And the rest of the trip happens in the new crowd.
  const seen = watch(next, 'house:000', 300);
  assert.ok(seen.some((s) => s.carry === 'gold'), 'the trip carried on with a bar');
  assert.equal(next.walk.goldTrips(), 0);

  // Hammering between trips, the countdown carries over instead of starting again.
  const worker = next.figures.get('house:000');
  assert.equal(worker.mode, 'hammer');
  const left = worker.goldIn;
  const third = createCrowd(island(), { known: new Set(next.figures.keys()), before: next });
  assert.equal(third.figures.get('house:000').goldIn, left);

  // A house that moved gets a settler at its new door, like everybody else.
  const movedCrowd = createCrowd(island({ shift: 2 }), { known: new Set(crowd.figures.keys()), before: crowd });
  assert.notDeepEqual(movedCrowd.figures.get('house:000').pos, was);
  assert.equal(movedCrowd.walk.goldTrips(), 0);
});

test('a bar carried home goes over the wire as the carry walk, at the walker rate', () => {
  // Develop_Tiemn's way for a walk with something in hand, the woodcutter's 'haul' beside it:
  // a word at the end of ANIMS - so an older page reads a number it does not know as 'still'
  // rather than misreading the ones it does - and in MOVING, so a carrier rides at the walker
  // rate and is not smeared over a ten-second keyframe.
  assert.equal(ANIMS[ANIMS.length - 1], 'carry', 'new words go on the end');
  assert.ok(MOVING.has('carry'));
  const it = island();
  const crowd = createCrowd(it);
  const idx = [...crowd.figures.keys()].indexOf('house:000');
  let row = null;
  for (let t = 0; t < 20 * 320 && !row; t++) {
    crowd.advance(1, 0);
    const { a } = encodeCrowd(crowd, { half: it.terrain.half });
    const got = decodeCrowd(a, it.terrain.half).get(idx);
    if (got && got.anim === 'carry') row = got;
  }
  assert.ok(row, 'the walk home with a bar was never sent as carry');
  const f = crowd.figures.get('house:000');
  assert.ok(Math.hypot(row.x - f.pos[0], row.z - f.pos[1]) < 0.1, 'and where they are rides with it');
});

test('the islander puts the status line in once, and leaves it alone after that', () => {
  const dir = scratch();
  const settingsFile = path.join(dir, 'claude', 'settings.json');
  const markerFile = path.join(dir, 'data', 'statusline.json');
  const script = '/island/hooks/statusline.mjs';
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'bash line.sh' } }));

  const first = ensureStatusLine({ settingsFile, script, markerFile, now: Date.UTC(2026, 8, 24) });
  assert.equal(first.did, 'wrapped');
  const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(after.statusLine.command, 'node "/island/hooks/statusline.mjs" --pass | bash line.sh');
  assert.equal(after.theme, 'dark', 'every other setting stays');
  assert.ok(fs.readdirSync(path.dirname(settingsFile)).some((n) => n.endsWith('.bak')), 'backed up before it was rewritten');
  assert.equal(JSON.parse(fs.readFileSync(markerFile, 'utf8')).asked, true);

  // Taken out again by hand: the next start does not put it back.
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }));
  assert.equal(ensureStatusLine({ settingsFile, script, markerFile }).did, 'asked-before');
  assert.equal('statusLine' in JSON.parse(fs.readFileSync(settingsFile, 'utf8')), false);

  // No settings.json at all is a fresh one; one that does not parse is never overwritten.
  const fresh = scratch();
  const r = ensureStatusLine({ settingsFile: path.join(fresh, 's.json'), script, markerFile: path.join(fresh, 'm.json') });
  assert.equal(r.did, 'added');
  const broken = scratch();
  fs.writeFileSync(path.join(broken, 's.json'), '{ "theme": "dark", oops');
  assert.equal(ensureStatusLine({ settingsFile: path.join(broken, 's.json'), script, markerFile: path.join(broken, 'm.json') }).did, 'unreadable');
  assert.equal(fs.readFileSync(path.join(broken, 's.json'), 'utf8'), '{ "theme": "dark", oops');
  assert.equal(fs.existsSync(path.join(broken, 'm.json')), false, 'and nothing is written down, so a fixed file gets it next time');
});

// ---- the drawing ----------------------------------------------------------------------

test('the silo is one mesh on its three by three, and publishes where the gold goes', () => {
  const b = buildBuilding({ id: GOLDPIT_ID, kind: 'civic', civicType: 'goldpit', style: 'unknown', plot: { gx: 0, gz: 0, w: 3, d: 3, rot: 0 } });
  assert.equal(b.geometry.groups.length, 0, 'a building is one draw call');
  assert.ok(b.bbox.max.x < 1.5 && b.bbox.min.x > -1.5, 'wider than its plot');
  assert.ok(b.bbox.max.z < 1.5 && b.bbox.min.z > -1.5);
  assert.ok(b.animated && b.animated.goldpile, 'the gold has to be hung on from outside the loaf');
});

test('a hundred bars, stacked inside the walls, the top going first', () => {
  const slots = pileSlots();
  assert.equal(slots.length, GOLD_BARS, 'one bar a percent');
  // The inner faces of the walls in buildings.js: sides at ±1.18 and back at -1.29, each
  // 0.14 thick.
  for (const [x, , z] of slots) {
    assert.ok(Math.abs(x) + BAR.l / 2 < 1.11, `a bar through a side wall at x ${x}`);
    assert.ok(z - BAR.w / 2 > -1.22, `a bar through the back wall at z ${z}`);
  }
  // Numbered bottom course first, so the first n are the pile with the top taken off.
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i][1] >= slots[i - 1][1], 'a higher course before a lower one');
  assert.equal(slots[slots.length - 1][1], 4 * BAR.h, 'the last bar is the top of the heap');
});

test('the sea stands a loader where the page drew the heap', () => {
  // lib/crowd.mjs may not import web/, so it carries its own copy of where the heap is.
  assert.equal(GOLD_PILE_BACK, -PILE_Z, 'the heap the loader faces is the heap that is drawn');
  const front = Math.max(...pileSlots().map(([, , z]) => z)) + BAR.w / 2;
  assert.ok(GOLD_LOAD_IN > front + 0.2, 'a loader stands clear of the gold, not in it');
  assert.ok(GOLD_LOAD_IN < 1.2, 'and inside the pit, not outside it');
  assert.ok(PILE_PITCH.x > BAR.l && PILE_PITCH.z > BAR.w, 'bars in one course do not overlap');
});

test('the pile shows as many bars as it is told, and none is no draw call', () => {
  const group = new THREE.Group();
  const pile = attachGoldPile(group, [0, 0.02, 0], new THREE.MeshStandardMaterial());
  assert.equal(pile.mesh.count, GOLD_BARS);
  pile.setBars(73);
  assert.equal(pile.mesh.count, 73);
  pile.setBars(-5);
  assert.equal(pile.mesh.count, 0);
  assert.equal(pile.mesh.visible, false);
  pile.setBars(1000);
  assert.equal(pile.mesh.count, GOLD_BARS);
  pile.setBars(NaN);
  assert.equal(pile.mesh.count, GOLD_BARS, 'a count that is not a number is a full pit');
  pile.dispose();
  assert.equal(group.children.length, 0);
  // The bar carries the attributes the building material reads.
  const g = goldBarGeometry();
  assert.ok(g.attributes.color && g.attributes.aEmissive);
});
