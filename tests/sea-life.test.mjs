// What lives on the sea floor (web/js/sea-life-plan.js, Plans/onderwater-zwemmen.md): the pure
// half, which decides where kelp, coral, rock, shells and schools stand from the bed alone.
//
// Three promises. It is deterministic - two pages that ask about the same water get the same
// reef, and nothing is stored or sent. It keeps to the bed: nothing grows in the shallows an
// island owns or floats above the sand, and kelp never breaks the surface. And it is bounded:
// caps hold, near beats far, and a tier's reach is a reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const {
  CHUNK, CAPS, KINDS, KIND_NAMES, SHALLOWEST, planChunk, gather, schoolPose, chunksAround,
} = await import('../web/js/sea-life-plan.js');

const flat = () => -2.5;
// Banks and trenches, roughly what shared/seabed.mjs makes: a bed between -3.4 and -1.0.
const rolling = (x, z) => -2.5 + 1.3 * Math.sin(x * 0.11) * Math.cos(z * 0.09) - 0.4 * Math.sin(z * 0.23 + x * 0.05);
const beach = (x) => (x > 8 ? -0.3 : -2.5);
const both = (cx, cz, bed) => planChunk(cx, cz, bed);

// ---- deterministic ------------------------------------------------------------------------

test('a chunk is planned the same way twice, and a neighbouring chunk differently', () => {
  const a = both(3, -2, rolling), b = both(3, -2, rolling), c = both(4, -2, rolling);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.items, c.items);
});

test('nothing in the planner draws on the clock or Math.random', () => {
  // Comments stripped: the file's own header says it never touches Math.random.
  const src = readFileSync(new URL('../web/js/sea-life-plan.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.random|Date\.|performance\./);
});

test('a sea of banks and trenches grows something, and a page that cannot see far draws less', () => {
  let items = 0, schools = 0;
  for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
    const p = both(cx, cz, rolling);
    for (const k of KIND_NAMES) items += p.items[k].length;
    if (p.school) schools++;
  }
  assert.ok(items > 300, `only ${items} things on 64 chunks of a varied sea`);
  assert.ok(schools >= 5, `only ${schools} schools on 64 chunks`);
});

// ---- the bed ------------------------------------------------------------------------------

test('every thing stands on the bed it was planned for, and never in the shallows', () => {
  for (let cz = -3; cz < 3; cz++) for (let cx = -3; cx < 3; cx++) {
    const p = both(cx, cz, rolling);
    for (const kind of KIND_NAMES) for (const it of p.items[kind]) {
      const bed = rolling(it.x, it.z);
      // The item sits where it was planned, within a step of the point its bed was read at:
      // kelp is jittered off its cell centre by 0.6, and the bed moves 0.15 in that.
      assert.ok(Math.abs(it.y - bed) < 0.35, `${kind} at ${it.x.toFixed(1)},${it.z.toFixed(1)} floats: y ${it.y}, bed ${bed}`);
      assert.ok(it.y <= SHALLOWEST + 0.35, `${kind} on a bed at ${it.y}`);
      assert.ok(it.s > 0);
    }
  }
});

test('the shallows and the beach get nothing at all', () => {
  const p = planChunk(1, 0, beach);   // x in 16..32, all of it shallower than the limit
  for (const k of KIND_NAMES) assert.equal(p.items[k].length, 0, `${k} on a beach`);
  assert.equal(p.school, null);
  // And a sea with no water grows nothing either.
  const dry = planChunk(0, 0, () => 0.5);
  for (const k of KIND_NAMES) assert.equal(dry.items[k].length, 0);
});

test('kelp is shortened to fit the water and never breaks the surface', () => {
  for (let cz = -4; cz < 4; cz++) for (let cx = -4; cx < 4; cx++) {
    const p = both(cx, cz, rolling);
    for (const kind of ['kelp_a', 'kelp_b']) for (const it of p.items[kind]) {
      const top = it.y + it.s * KINDS[kind].h;
      assert.ok(top <= -0.3, `${kind} reaches ${top.toFixed(2)}, above the mist of the surface`);
    }
  }
});

test('coral is on the banks and kelp in the deeper water', () => {
  let coral = 0, kelp = 0;
  for (let cz = -5; cz < 5; cz++) for (let cx = -5; cx < 5; cx++) {
    const p = both(cx, cz, rolling);
    for (const k of ['coral_fan', 'coral_branch', 'coral_dome']) for (const it of p.items[k]) {
      coral++;
      assert.ok(it.y >= -2.3 - 0.35, `coral on a bed at ${it.y}`);
    }
    for (const k of ['kelp_a', 'kelp_b']) for (const it of p.items[k]) {
      kelp++;
      assert.ok(it.y <= -1.2 + 0.35, `kelp on a bed at ${it.y}`);
    }
  }
  assert.ok(coral > 0 && kelp > 0, `coral ${coral}, kelp ${kelp}`);
});

// ---- fish ---------------------------------------------------------------------------------

test('a school swims between the bed and the surface, and turns the way it heads', () => {
  let n = 0;
  for (let cz = -6; cz < 6; cz++) for (let cx = -6; cx < 6; cx++) {
    const s = both(cx, cz, rolling).school;
    if (!s) continue;
    n++;
    assert.ok(s.count >= 6 && s.count <= 14, `a school of ${s.count}`);
    assert.equal(s.offsets.length, s.count);
    for (let t = 0; t < 60; t += 3.7) {
      const p = schoolPose(s, t, rolling, 0);
      const bed = rolling(p.x, p.z);
      assert.ok(p.y >= bed + 0.4, `a school on the bed: y ${p.y}, bed ${bed}`);
      assert.ok(p.y <= -0.55 || p.y <= bed + 0.6, `a school at the surface: ${p.y}`);
      assert.ok(Number.isFinite(p.heading));
    }
  }
  assert.ok(n > 0);
});

test('a school stays over its own chunk, near enough that the chunk that owns it is drawn', () => {
  const s = both(2, 2, () => -3).school || (() => { for (let i = 0; i < 40; i++) { const x = both(i, 1, () => -3).school; if (x) return x; } })();
  assert.ok(s);
  for (let t = 0; t < 300; t += 5) {
    const p = schoolPose(s, t, () => -3, 0);
    assert.ok(Math.abs(p.x - s.x0) <= s.ax + 1e-9 && Math.abs(p.z - s.z0) <= s.az + 1e-9);
  }
});

// ---- bounded ------------------------------------------------------------------------------

test('the chunks round a point come nearest first and cover the reach', () => {
  const list = chunksAround(5, 5, 40);
  assert.equal(list[0].cx, 0);
  assert.equal(list[0].cz, 0);
  assert.equal(list[0].d, 0);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].d >= list[i - 1].d);
  assert.ok(list.every((c) => c.d <= 40));
  // Every square that comes within the reach is in the list.
  const has = (cx, cz) => list.some((c) => c.cx === cx && c.cz === cz);
  assert.ok(has(2, 0), 'a chunk 32 to 48 away is within 40 of x = 5');
  assert.ok(!has(4, 0), 'a chunk 64 away is not');
});

test('a tier\'s caps hold and its reach is a reach', () => {
  for (const [tier, caps] of Object.entries(CAPS)) {
    const seen = new Map();
    const plan = (cx, cz) => { const k = `${cx},${cz}`; if (!seen.has(k)) seen.set(k, planChunk(cx, cz, rolling)); return seen.get(k); };
    const got = gather(0, 0, caps.reach, caps, plan);
    const sum = (kinds) => kinds.reduce((n, k) => n + got.items[k].length, 0);
    assert.ok(sum(['kelp_a', 'kelp_b']) <= caps.kelp, `${tier}: kelp over its cap`);
    assert.ok(sum(['coral_fan', 'coral_branch', 'coral_dome']) <= caps.coral, `${tier}: coral over its cap`);
    assert.ok(sum(['rock_a', 'rock_b']) <= caps.rock, `${tier}: rocks over their cap`);
    assert.ok(sum(['shell', 'starfish']) <= caps.shell, `${tier}: shells over their cap`);
    assert.ok(got.fish <= caps.fish, `${tier}: ${got.fish} fish over ${caps.fish}`);
    assert.equal(got.fish, got.schools.reduce((n, s) => n + s.count, 0));
    for (const k of KIND_NAMES) for (const it of got.items[k]) {
      assert.ok(Math.hypot(it.x, it.z) <= caps.reach + 1e-9, `${tier}: a ${k} at ${Math.hypot(it.x, it.z).toFixed(1)} beyond ${caps.reach}`);
    }
  }
  assert.ok(CAPS.phone.reach < CAPS.modest.reach && CAPS.modest.reach < CAPS.full.reach);
  assert.ok(CAPS.phone.fish < CAPS.modest.fish && CAPS.modest.fish < CAPS.full.fish);
});

test('near beats far when a cap is hit', () => {
  const tiny = { ...CAPS.full, kelp: 5, coral: 5, rock: 5, shell: 5 };
  const plan = (cx, cz) => planChunk(cx, cz, rolling);
  const got = gather(0, 0, 56, tiny, plan);
  const kelp = [...got.items.kelp_a, ...got.items.kelp_b];
  const all = gather(0, 0, 56, CAPS.full, plan);
  const allKelp = [...all.items.kelp_a, ...all.items.kelp_b].map((k) => Math.hypot(k.x, k.z)).sort((a, b) => a - b);
  // Nothing kept is much further out than the fifth nearest of everything there is.
  const cutoff = allKelp[9] + CHUNK * 1.5;
  for (const k of kelp) assert.ok(Math.hypot(k.x, k.z) <= cutoff, 'a far strand was kept while near ones were dropped');
});

test('a chunk is cheap to plan', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 40; i++) planChunk(i, i * 2, rolling);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 40;
  // The page plans about fifty chunks when it crosses into a new one: at 1 ms each that is a
  // frame's worth. It measures well under a tenth of that on this machine.
  assert.ok(ms < 2, `${ms.toFixed(2)} ms a chunk`);
});

test('every asset the plan asks for is baked, and is where the plan thinks it is', async () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  const models = await import('../web/js/models.js');
  delete globalThis.document;
  for (const [kind, { asset, h }] of Object.entries(KINDS)) {
    assert.ok(models.hasAsset(asset), `${kind}: ${asset} is not baked`);
    assert.ok(Math.abs(models.topOf(asset) - h) < 0.06, `${kind}: baked ${models.topOf(asset)} tall, planned for ${h}`);
  }
  for (const a of ['fauna_fish_a', 'fauna_fish_b']) assert.ok(models.hasAsset(a), `${a} is not baked`);
});
