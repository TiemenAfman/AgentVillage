// What the quest playtest of 8 October 2026 found broken (Plans/speeltest-quests.md), each held:
// the goldsmith speaks in his own voice and not the pirate's, the gold mine's rope ladder - which both
// of the mine's words send you to - is a way out, and a civic that appears is not said to have
// pitched a tent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import.
const ctx2d = new Proxy({}, { get: () => () => ({}) });
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
};

const { createQuestLog } = await import('../web/js/quest-log.js');
const { giverSpeech, pirateSpeech, voiceOf } = await import('../web/js/pirate.js');
const { buildGoldMine, MINE_ROOM } = await import('../web/js/mine-room.js');
const { SPOTS } = await import('shared/mine.mjs');
const { createMineRun } = await import('../web/js/mine.js');

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the goldsmith asks and hands over in his own words, never the pirate\'s', () => {
  const log = createQuestLog({ storage: memory(), cardFor: () => null });
  const pitch = giverSpeech(log.view(), 'goldsmith');
  assert.equal(pitch.button, 'Accept');
  log.onTalked('goldsmith');
  log.applyEvent({ type: 'entered', where: 'goldmine' });
  log.applyEvent({ type: 'dug', kind: 'gem' });
  log.applyEvent({ type: 'sold', what: 'gems' });
  const ask = giverSpeech(log.view(), 'goldsmith');
  assert.equal(ask.hint, 'Talk to the goldsmith');
  assert.doesNotMatch(ask.lines[0], /matey/i);
  assert.notEqual(ask.button, 'Hand it over');
  assert.equal(ask.button, voiceOf('goldsmith').handOver);
  assert.notEqual(voiceOf('goldsmith').bye, 'Aye');
  // The pirate keeps his.
  assert.equal(voiceOf('pirate').handOver, 'Hand it over');
  assert.equal(voiceOf('captain').bye, 'Aye');
  assert.equal(pirateSpeech(log.view()).button, 'Accept');
});

test('the gold mine\'s rope ladder by the way in is a way out, a step in front of the door', () => {
  const run = createMineRun({ storage: memory(), island: () => 'isle', day: () => 1 });
  const rect = (x, z, hx, hz) => ({ x, z, hx, hz });
  const def = buildGoldMine({ FLOOR: 0, rect, run });
  const ladder = (def.exits || []).find((e) => e.kind === 'exit');
  assert.ok(ladder, 'the mine has an exit at its ladder');
  assert.equal(ladder.to, undefined, 'out by the door, not somewhere else');
  assert.match(ladder.prompt, /ladder/);
  // Within reach of somebody standing just inside the way in, and nowhere on the field to dig.
  assert.ok(Math.abs(ladder.x) < def.doorway.hx + 0.6);
  assert.ok(def.doorway.z - ladder.z < 1);
  assert.ok(ladder.z > def.spawn.z, 'between where you come in and the way out');
  // interior.js leaves the room for an exit with no `to`.
  assert.match(src('web/js/interior.js'), /if \(it\.kind === 'exit'\) \{ leave\(it\.to\); return; \}/);
});

test('a spot nobody has dug is not drawn, a dug one is; the mine is looked down into', async () => {
  const THREE = await import('three');
  const { MINE_PITCH } = await import('../web/js/mine-room.js');
  const run = createMineRun({ storage: memory(), island: () => 'isle', day: () => 1 });
  run.enter();
  const rect = (x, z, hx, hz) => ({ x, z, hx, hz });
  const def = buildGoldMine({ FLOOR: 0, rect, run });
  const scene = new THREE.Scene();
  const show = def.show({ scene, material: new THREE.MeshBasicMaterial() });
  const tris = () => {
    const m = scene.children.find((c) => c.isMesh);
    if (!m) return 0;
    const g = m.geometry;
    return (g.index ? g.index.count : g.attributes.position.count) / 3;
  };
  const rocks = () => run.plan().rock.reduce((a, b) => a + b, 0);
  // Every spot is a tile of the floor (12 triangles); what is left over is the rocks.
  const TILE = 12;
  show.enter();
  const perRock1 = (tris() - SPOTS * TILE) / rocks();
  // Down a floor (another count of rocks, another count of earth): the field is still flat tiles and
  // rocks - an undug spot is the floor, and nothing else.
  run.dig(run.plan().goal);
  run.descend();
  show.enter();
  assert.notEqual(rocks(), 0);
  assert.equal((tris() - SPOTS * TILE) / rocks(), perRock1, 'an undug spot adds nothing to the floor');
  // Nothing in the middle of a spot below the floor until it is dug: no bed, no hole.
  const sunk = (i) => {
    const { x, z } = MINE_ROOM.spotRoom(i);
    const p = scene.children.find((c) => c.isMesh).geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      if (Math.abs(p.getX(k) - x) < 0.15 && Math.abs(p.getZ(k) - z) < 0.15 && p.getY(k) < -0.01 && p.getY(k) > -0.2) return true;
    }
    return false;
  };
  const before = tris();
  const earth = [...run.plan().rock.keys()].find((i) => !run.plan().rock[i] && i !== run.plan().goal);
  assert.ok(!sunk(earth), 'an undug spot is flat floor');
  run.dig(earth);
  show.enter();
  assert.ok(tris() > before, 'a dug spot is a hole you can see');
  assert.ok(sunk(earth), 'and it goes down into the floor');
  // The way down is a shaft with its ladder, not a hatch on the floor.
  run.dig(run.plan().goal);
  show.enter();
  const g = run.plan().goal, { x: gx, z: gz } = MINE_ROOM.spotRoom(g);
  const p = scene.children.find((c) => c.isMesh).geometry.attributes.position;
  let low = 0, high = -1;
  for (let k = 0; k < p.count; k++) {
    if (Math.abs(p.getX(k) - gx) > 0.3 || Math.abs(p.getZ(k) - gz) > 0.3) continue;
    low = Math.min(low, p.getY(k));
    high = Math.max(high, p.getY(k));
  }
  assert.ok(low < -0.8, `the shaft goes down out of sight (${low})`);
  assert.ok(high > 0.15, `and its ladder stands up out of it (${high})`);
  assert.equal(def.camera.pitch, MINE_PITCH);
  assert.ok(MINE_PITCH > 0.6 && MINE_PITCH <= 0.95, 'well down, and inside what the mouse may reach');
  // interior.js hands a room's own pitch to the walk on the way in.
  assert.match(src('web/js/interior.js'), /walk\.state\.camPitch = back && back\.pitch != null \? back\.pitch : \(CAM\.pitch \?\? 0\.05\);/);
});

test('only somebody who comes to live here pitches a tent', () => {
  const main = src('web/js/main.js');
  const body = main.slice(main.indexOf('async function walkIn('), main.indexOf('async function sailIn('));
  assert.match(body, /if \(rec\.spec\.kind !== 'civic'\) state\.ui\.toast\(`<b>\$\{rec\.spec\.name\}<\/b> arrived and pitched a tent\.`\)/);
});
