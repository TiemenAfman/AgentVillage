// The sawmill (scripts/build-sawmill.py, web/js/sawmill.js, Plans/zagerij.md).
//
// What moves is baked inside the yard asset with its origin on its own axis, left out of the
// merged building and hung on its own pivot. So the promises worth a net are: the building
// never draws a moving part twice, every pivot sits where the work is (the blade in the bench,
// the log on it, the billet on the belt), and the animation keeps its parts where they belong
// - a log that slides off the end of the bench or a chip that flies when nothing is being cut
// is the kind of thing found on the island rather than here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, meshAsset, isSawmillMoving } = await import('../web/js/buildings.js');
const { attachSawmill, updateSawmill, disposeSawmill, sawmillGeometry, feedAt, FEED_S, REST_S, CHIPS } = await import('../web/js/sawmill.js');
const { SAWMILL } = await import('../web/js/sawmill-mesh.js');
delete globalThis.document;

const YARD = SAWMILL.assets.civic_sawmill_yard.parts;
const tris = (names) => names.reduce((n, p) => n + SAWMILL.parts[p].positions.length / 9, 0);
const FRAME = 1 / 60;

test('the moving parts are exactly the blade, the log, the rollers and the billet', () => {
  const moving = YARD.filter(isSawmillMoving).map((n) => n.split(':')[0].replace('civic_sawmill_yard ', ''));
  assert.deepEqual([...new Set(moving)].sort(), ['billet', 'blade', 'log', 'roller 0', 'roller 1', 'roller 2', 'roller 3']);
  // Nothing in the barn moves, and nothing still in the yard is caught by the rule by accident.
  assert.equal(SAWMILL.assets.civic_sawmill.parts.filter(isSawmillMoving).length, 0);
  assert.ok(YARD.some((n) => n.startsWith('civic_sawmill_yard bench')) && !isSawmillMoving('civic_sawmill_yard bench'));
});

test('the building merges everything but the moving parts, which are drawn once, by sawmill.js', () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  const built = buildBuilding({ id: 'c:sawmill', kind: 'civic', civicType: 'sawmill', tier: 'civic', style: 'unknown', ornaments: [] });
  assert.ok(built.animated.sawmill, 'the sawmill says nothing about its moving parts');
  assert.ok(built.anchors.smoke, 'no smoke out of the stovepipe');
  // The yard as the building merges it: every still part, and not one that moves.
  const kept = meshAsset('civic_sawmill_yard', 0xffffff, { skip: isSawmillMoving });
  assert.equal(kept.length, YARD.filter((n) => !isSawmillMoving(n)).length);
  assert.equal(kept.reduce((n, g) => n + g.attributes.position.count / 3, 0), tris(YARD.filter((n) => !isSawmillMoving(n))));
  // And `skip` stays out of what a part remembers of its options (the editor reads them back).
  assert.ok(kept.every((g) => !('skip' in g.userData.part.o)));
  delete globalThis.document;
  const still = tris(SAWMILL.assets.civic_sawmill.parts) + tris(YARD.filter((n) => !isSawmillMoving(n)));
  const merged = built.geometry.attributes.position.count / 3;
  assert.ok(merged >= still, `${merged} triangles merged, fewer than the ${still} still ones`);
  built.geometry.dispose();
});

test('every pivot sits where the work is', () => {
  const G = sawmillGeometry();
  // The log lies on the bench in front of the blade, and its travel ends as far past it.
  assert.ok(G.log[0] < G.blade[0] && G.travel > 2 * G.logHalf, 'the log never clears the blade');
  assert.ok(Math.abs(G.log[2] - G.blade[2]) < 1e-6, 'the log is not fed into the blade');
  // The blade stands up out of the bench far enough to cut through the log.
  assert.ok(G.blade[1] + G.bladeR > G.log[1] + G.logR * 0.5, 'the blade does not reach the log');
  // The rollers are one straight belt, climbing towards the barn, and the billet starts on it.
  assert.equal(G.rollers.length, 4);
  for (const r of G.rollers) {
    const t = (r[0] - G.rollers[0][0]) / (G.belt[0] * G.beltLength);
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(G.rollers[0][a] + G.belt[a] * G.beltLength * t - r[a]) < 1e-5);
  }
  assert.ok(G.belt[1] > 0 && G.belt[0] > 0, 'the belt does not climb into the barn');
  assert.ok(Math.abs(G.billet[0] - G.rollers[0][0]) < 1e-6 && G.billet[1] > G.rollers[0][1]);
});

test('the feed: a log goes all the way through, then the bench stands empty a moment', () => {
  assert.deepEqual(feedAt(0), { k: 0, scale: 0 });
  assert.equal(feedAt(FEED_S / 2).scale, 1);
  assert.ok(Math.abs(feedAt(FEED_S / 2).k - 0.5) < 1e-9);
  assert.equal(feedAt(FEED_S + REST_S / 2).scale, 0);
  // The cycle repeats, and a negative clock is not a crash.
  assert.deepEqual(feedAt(FEED_S / 3), feedAt(FEED_S / 3 + FEED_S + REST_S));
  assert.ok(Number.isFinite(feedAt(-1).k));
});

test('the mill at work: it cuts only with wood at the blade, keeps its log on the bench, and repeats itself', () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  const run = () => {
    const scene = new THREE.Scene();
    const mill = attachSawmill(scene, [0, 0, 0], new THREE.MeshBasicMaterial());
    const G = mill.G;
    let cut = 0, flew = 0, idleChips = 0;
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < Math.round((FEED_S + REST_S) * 2 / FRAME); i++) {
      updateSawmill(mill, FRAME);
      if (mill.cutting) cut++;
      const x = mill.log.position.x;
      assert.ok(x >= G.log[0] - 1e-9 && x <= G.log[0] + G.travel + 1e-9, `the log slid to ${x}`);
      let live = 0;
      for (let c = 0; c < CHIPS; c++) {
        mill.chips.getMatrixAt(c, m);
        m.decompose(p, q, s);
        if (s.x > 0) { live++; assert.ok(p.y > -0.01, 'a chip went through the ground'); }
      }
      flew += live;
      // Well after the last cut there is nothing in the air.
      if (!mill.log.visible && feedAt(mill.time).scale === 0 && (mill.time % (FEED_S + REST_S)) > FEED_S + 0.9) idleChips += live;
      for (const b of mill.billets) {
        const along = (b.position.x - G.billet[0]) / G.belt[0];
        assert.ok(along >= -1e-6 && along <= G.beltLength + 1e-6, 'a billet left the belt');
      }
    }
    assert.ok(cut > 0 && flew > 0, 'it never cut anything');
    assert.equal(idleChips, 0, 'chips still flying long after the cut');
    const out = { t: mill.time, x: mill.log.position.x, blade: mill.blade.rotation.z, chips: [...mill.chips.instanceMatrix.array] };
    disposeSawmill(mill);
    assert.equal(scene.children.length, 0);
    return out;
  };
  assert.deepEqual(run(), run());
  delete globalThis.document;
});
