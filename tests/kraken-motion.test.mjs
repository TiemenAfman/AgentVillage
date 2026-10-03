// The Salty Kraken in the wind (web/js/kraken-motion.js, Plans/kraken-op-zee.md "Beweging"): its
// flags, sails and hanging lanterns are out of the merged body and in one moving geometry, every
// one of them, and nothing else; what is fixed stays fixed (a flag's luff on its staff, a sail's
// yard, a lantern's hook) and what is free moves, by no more than a hand; and two calls at the same
// sea time put every vertex in the same place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, isKrakenMoving } = await import('../web/js/buildings.js');
const { buildKrakenMotion, moveKraken, isKrakenGroup } = await import('../web/js/kraken-motion.js');
const models = await import('../web/js/models.js');
delete globalThis.document;

const names = models.assetParts('piratetavern');
const moving = names.filter(isKrakenMoving);

test('the flags, the set sails and the hung lanterns move, and nothing else', () => {
  assert.deepEqual(moving, names.filter(isKrakenGroup), 'buildings.js and kraken-motion.js disagree on what moves');
  for (const want of ['Salty great jolly roger', 'Salty fore jolly roger', 'Salty fore course', 'Salty fore topsail', 'Salty aft topsail']) {
    assert.ok(moving.includes(want), `${want} does not move`);
  }
  for (const lamp of ['stern', 'bow', 'fore top', 'door']) assert.ok(moving.includes(`Salty ${lamp} lantern glass`), `the ${lamp} lantern does not swing`);
  for (const still of names.filter((n) => /yard|post|bracket|arm|hook|roll|gasket|castle lantern|stair .* lantern|staff/.test(n))) {
    assert.ok(!isKrakenMoving(still), `${still} moves`);
  }
  const b = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
  assert.equal(b.animated.krakenMotion, true);
  b.geometry.dispose();
});

test('what is fixed stays, what is free moves a little, and the sea time decides where', () => {
  const m = buildKrakenMotion();
  assert.ok(m, 'no moving geometry');
  const n = m.base.length;
  const a = new Float32Array(n), b = new Float32Array(n), c = new Float32Array(n);
  let most = 0, moved = 0;
  for (const t of [0.3, 1.7, 4.1, 9.9]) {
    moveKraken(m, t, a);
    for (let i = 0; i < n; i += 3) {
      const d = Math.hypot(a[i] - m.base[i], a[i + 1] - m.base[i + 1], a[i + 2] - m.base[i + 2]);
      most = Math.max(most, d);
      if (d > 0.01) moved++;
    }
  }
  assert.ok(most < 0.6, `something swings ${most.toFixed(2)} out`);
  assert.ok(moved > n / 3 / 4, 'hardly anything moves');
  moveKraken(m, 12.5, b); moveKraken(m, 12.5, c);
  assert.deepEqual(b, c, 'the same sea time, two places');
  // The hooks, the yards and the luffs: the vertex nearest each group's fixed point barely moves.
  const kinds = { 0: 'flag', 1: 'sail', 2: 'lamp' };
  m.groups.forEach((G, gi) => {
    const fixed = kinds[G.kind] === 'flag' ? (v) => m.base[v * 3] - G.lo[0]
      : kinds[G.kind] === 'sail' ? (v) => G.hi[1] - m.base[v * 3 + 1]
        : (v) => Math.hypot(m.base[v * 3] - G.pivot[0], m.base[v * 3 + 1] - G.pivot[1], m.base[v * 3 + 2] - G.pivot[2]);
    let best = -1;
    for (let v = 0; v < m.group.length; v++) if (m.group[v] === gi && (best < 0 || fixed(v) < fixed(best))) best = v;
    moveKraken(m, 3.3, a);
    const d = Math.hypot(a[best * 3] - m.base[best * 3], a[best * 3 + 1] - m.base[best * 3 + 1], a[best * 3 + 2] - m.base[best * 3 + 2]);
    assert.ok(d < 0.02, `${G.key}: its fixed end moves ${d.toFixed(3)}`);
  });
  m.geometry.dispose();
});

// HD outside (web/js/kraken-motion.js setKrakenDetail): while the pack's flag flies, the bake's cloth,
// skull and bones are put on one point - the geometry and its one draw call stay - and everything
// else moves exactly as before.
test('a flag the pack stands in for is folded away, and nothing else changes', () => {
  const m = buildKrakenMotion();
  const n = m.base.length;
  const plain = moveKraken(m, 5.5, new Float32Array(n));
  const flags = m.groups.map((G, gi) => (G.key.startsWith('flag ') ? gi : -1)).filter((gi) => gi >= 0);
  assert.equal(flags.length, 2);
  for (const gi of flags) m.hide[gi] = 1;
  const hidden = moveKraken(m, 5.5, new Float32Array(n));
  for (let v = 0; v < m.group.length; v++) {
    const G = m.groups[m.group[v]], i = v * 3;
    if (flags.includes(m.group[v])) assert.deepEqual([hidden[i], hidden[i + 1], hidden[i + 2]], [...G.lo].map(Math.fround));
    else assert.deepEqual([hidden[i], hidden[i + 1], hidden[i + 2]], [plain[i], plain[i + 1], plain[i + 2]]);
  }
  m.geometry.dispose();
});
