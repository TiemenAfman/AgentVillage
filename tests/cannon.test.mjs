// The galleon's guns (Plans/kanonnen.md): the ball's flight in shared/cannon.mjs, which the page and
// the sea both fly, and the gun as drawn - the keeper's cannons, however many her craft mounts, welded
// into the hull's one geometry, the barrel laid on its trunnions and the muzzle a ball leaves from where
// the bore is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const C = await import('../shared/cannon.mjs');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { DECK_Y } = await import('../shared/hull.mjs');
const { createBoat } = await import('../web/js/boat.js');
const { cannonShape, layPoint, muzzleOf, restLay, BARREL } = await import('../web/js/cannon.js');
const models = await import('../web/js/models.js');
const { PIRATESHIP } = await import('../web/js/pirateship-mesh.js');

test('shared/cannon.mjs keeps shared\'s rule: no trig, no clock, no three', () => {
  const src = readFileSync(new URL('../shared/cannon.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log|sqrt|hypot)\b/);
  assert.doesNotMatch(src, /Date\.now|performance\.now|from 'three'/);
});

test('a ball flies the closed form of a throw and comes down on water, land or a hull', () => {
  const shot = { o: [0, 2, 0], v: [30, 10, 0] };
  const at = C.ballAt(shot, 1);
  assert.deepEqual(at, [30, 2 + 10 - 0.5 * C.BALL_G, 0]);
  const sea = C.ballHit(shot, { height: () => -2.5 });
  assert.equal(sea.kind, 'splash');
  assert.ok(Math.abs(sea.at[1]) < 1e-9);
  // Its time is where y crosses 0: 2 + 10 t - g t^2 / 2 = 0.
  const t = (10 + Math.sqrt(100 + 4 * C.BALL_G)) / C.BALL_G;
  assert.ok(Math.abs(sea.t - t) <= C.BALL_STEP + 1e-9, `${sea.t} vs ${t}`);
  const land = C.ballHit(shot, { height: (x) => (x > 20 ? 8 : -2.5) });
  assert.equal(land.kind, 'blast');
  assert.ok(land.at[0] > 20 && land.at[0] < 21);
  const hull = { id: 'boat:x', x: 82, z: 0, fx: 0, fz: 1, y: 0 };
  const ship = C.ballHit(shot, { height: () => -2.5, hulls: [hull] });
  assert.equal(ship.kind, 'hull');
  assert.equal(ship.id, 'boat:x');
  // Its own ship is not hit by the ball leaving her, but is by one coming back down on her.
  const own = { ...shot, b: 'boat:x' };
  const near = C.ballHit({ ...own, o: [82, 1.5, 0] }, { height: () => -2.5, hulls: [hull] });
  assert.notEqual(near.kind === 'hull' && near.t < 0.03, true);
  const up = C.ballHit({ o: [82, 1.5, 0], v: [0, 20, 0.1], b: 'boat:x' }, { height: () => -2.5, hulls: [hull] });
  assert.equal(up.kind, 'hull');
});

test('the gun\'s range is a long shot, not a short one and not the whole sea', () => {
  const range = (pitch) => {
    const v = [0, C.BALL_SPEED * Math.sin(pitch), C.BALL_SPEED * Math.cos(pitch)];
    return C.ballHit({ o: [0, 1.5, 0], v }, { height: () => -2.5 }).at[2];
  };
  assert.ok(range(0) > 15 && range(0) < 30, `level: ${range(0)}`);
  assert.ok(range(C.GUN_PITCH_MAX) > 110 && range(C.GUN_PITCH_MAX) < 170, `highest: ${range(C.GUN_PITCH_MAX)}`);
});

test('a blast costs most at its heart and nothing past its edge; a body hit square costs the whole', () => {
  assert.ok(C.blastOn('blast', [0, 0.3, 0], [0, 0, 0]) > C.BALL_HIT * 0.99);
  const half = C.blastOn('blast', [0, 0.3, 0], [C.BLAST_R / 2, 0, 0]);
  assert.ok(Math.abs(half - C.BALL_HIT / 2) < 0.5, `${half}`);
  assert.equal(C.blastOn('blast', [0, 0.3, 0], [C.BLAST_R + 0.01, 0, 0]), 0);
  assert.equal(C.blastOn('body', [9, 9, 9], [0, 0, 0]), C.BALL_HIT);
  assert.equal(C.blastOn('splash', [0, 0, 0], [5, 0, 0]), 0);
});

test('a shot off the wire is believed for where and which way, not for how fast', () => {
  assert.deepEqual(C.parseShot({ o: [1, 2, 3], v: [C.BALL_SPEED, 0, 0] }, 3000), { o: [1, 2, 3], v: [C.BALL_SPEED, 0, 0] });
  assert.equal(C.parseShot({ o: [1, 2, 3], v: [C.BALL_SPEED, C.BALL_SPEED, 0] }, 3000), null);
  assert.equal(C.parseShot({ o: [1, 'x', 3], v: [1, 0, 0] }, 3000), null);
  assert.equal(C.parseShot({ o: [1e9, 2, 3], v: [1, 0, 0] }, 3000), null);
  assert.deepEqual(C.clampLay(5, -5), [C.GUN_TRAVERSE, C.GUN_PITCH_MIN]);
  assert.deepEqual(C.slewLay([0, 0], [1, -1], 0.1), [C.GUN_TURN * 0.1, -C.GUN_TURN * 0.1]);
});

test('the body\'s gravity in a flight out of the gun is walk mode\'s own', () => {
  const walk = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
  assert.equal(Number(/const GRAVITY = ([\d.]+);/.exec(walk)[1]), C.HUMAN_G);
});

test('the old guns are out of the galleon, and her own stand on her deck, cannons before harpoons', () => {
  // The source's guns stood out of her ports to 2.63 from the middle; nothing does any more below
  // the bulwark's height, between the ladders and the quarterdeck stairs. Measured on the old bake
  // only: the sloop (Plans/DONE/nieuwe-sloep.md) has her own open ports and this says nothing about her.
  const hull = PIRATESHIP.parts['pirateship hull'];
  if (hull && !PIRATESHIP.anchors.waterline) {
    const p = hull.positions;
    let out = 0;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) > 2.5 && p[i + 2] > -2.4 && p[i + 2] < 1.4 && p[i + 1] > 3 && p[i + 1] < 4) out++;
    assert.equal(out, 0, `${out} corners still stand out of the ports`);
  }
  // However many there are (the galleon two, the sloop one a side and a harpoon on the bow), every
  // cannon comes before every harpoon - the index is the mount's number on the wire - and the first
  // mount is a cannon on her starboard side, as it has been since Plans/kanonnen.md.
  const mounts = CRAFTS.galleon.mounts;
  const guns = mounts.filter((m) => m.kind === 'cannon');
  assert.ok(guns.length >= 1, 'no cannon');
  assert.equal(mounts[0].kind, 'cannon');
  assert.ok(mounts[0].x > 0, 'mount 0 is on her starboard side');
  const lastGun = mounts.map((m) => m.kind).lastIndexOf('cannon'), firstHarpoon = mounts.map((m) => m.kind).indexOf('harpoon');
  assert.ok(firstHarpoon < 0 || lastGun < firstHarpoon, 'a harpoon stands before a cannon in the list');
  if (guns.length >= 2) assert.ok(guns.some((g) => g.x > 0) && guns.some((g) => g.x < 0), 'guns on one side only');
  // Each on a stretch of her deck, inside the planking's edge, pointing out of her own side.
  for (const g of guns) {
    const on = CRAFTS.galleon.deck.find((d) => Math.abs(g.x - d.x) <= d.hx + 0.1 && Math.abs(g.z - d.z) <= d.hz);
    assert.ok(on, `gun at (${g.x}, ${g.z}) is on no deck`);
    assert.ok(Math.abs(g.y - (on.y + (on.slope || 0) * (g.z - on.z))) < 0.05, 'on the planking');
    assert.ok(Math.sign(Math.sin(g.yaw)) === Math.sign(g.x), 'points out of its own side');
  }
});

test('a laid barrel turns about its trunnions, and the muzzle a ball leaves from is the drawn bore\'s', () => {
  const s = cannonShape();
  assert.ok(s, 'the cannon set is baked');
  assert.ok(Math.abs(s.rest - 0.166) < 0.02, `rest elevation ${s.rest}`);
  const spec = CRAFTS.galleon.mounts.find((m) => m.kind === 'cannon');
  const pin = layPoint(spec, restLay(), 0, true, 0, 0, 0);
  for (const pitch of [C.GUN_PITCH_MIN, 0, C.GUN_PITCH_MAX]) {
    for (const yaw of [-C.GUN_TRAVERSE, 0, C.GUN_TRAVERSE]) {
      const m = muzzleOf(spec, [yaw, pitch]);
      const p = layPoint(spec, [yaw, pitch], 0, true, 0, 0, 0);
      assert.ok(Math.abs(Math.hypot(m.at[0] - p[0], m.at[1] - p[1], m.at[2] - p[2]) - s.length * (spec.scale || 1)) < 1e-9);
      assert.ok(Math.abs(p[1] - pin[1]) < 1e-9, 'the trunnions do not move');
      // Elevation of the bore is the laying; its heading is the gun's plus the traverse.
      assert.ok(Math.abs(Math.asin(m.dir[1]) - pitch) < 1e-6, `pitch ${pitch}: ${Math.asin(m.dir[1])}`);
      const heading = Math.atan2(m.dir[0], m.dir[2]);
      assert.ok(Math.abs(heading - (spec.yaw + yaw)) < 1e-6);
    }
  }
  // Square out of her starboard side at rest, over her cap rail (the sloop's, scripts/build-sloop.py: the
  // waist's bulwark 0.30 over the deck and its cap 0.035 on that): the muzzle out past her side, above it.
  const m = muzzleOf(spec, restLay());
  assert.ok(m.at[0] > 1.45 && m.at[0] < 2.1, `muzzle x ${m.at[0]}`);
  const over = m.at[1] - DECK_Y - spec.y;
  assert.ok(over > 0.335 && over < 0.7, `the bore ${over.toFixed(3)} over the deck: not over the cap rail`);
});

test('the guns are welded into the hull\'s one geometry and laying one moves only its own corners', () => {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  const mounts = CRAFTS.galleon.mounts;
  assert.equal(boat.guns, mounts.filter((m) => m.kind === 'cannon').length);
  assert.equal(scene.children.filter((o) => o.isMesh).length, 1, 'one mesh, one draw call');
  const pos = boat.object.geometry.attributes.position.array.slice();
  boat.layGun(mounts.findIndex((m) => m.kind === 'cannon'), [0.3, 0.3], 0.1);
  const now = boat.object.geometry.attributes.position.array;
  let moved = 0, first = Infinity;
  for (let i = 0; i < pos.length; i++) if (pos[i] !== now[i]) { moved++; first = Math.min(first, i); }
  assert.ok(moved > 1000);
  // Everything that moved lies in the last runs, the guns' (and after them her sail's and flag's,
  // ship-motion.js, which a laying does not touch); the hull and her ladders did not.
  const tail = boat.object.geometry.attributes.position.count * 3;
  assert.ok(first > tail * 0.5, `first moved number ${first} of ${tail}`);
  boat.dispose();
});

test("the sloop's guns, drawn at their scale, fire over her cap rail: no part of the barrel is in her bulwark", () => {
  // The keeper's choice (13 Oct 2026): no gun port, the guns larger, the barrel out over the cap. Every
  // corner of the laid barrel, at both ends of its elevation and its traverse, seen from its trunnions:
  // the line between them crosses no triangle of her hull - the bulwark, the cap rail, a closed port's lid.
  const hull = PIRATESHIP.parts['pirateship hull'].positions;
  const barrel = models.part(BARREL);
  const lift = PIRATESHIP.anchors.waterline[1];
  // layPoint answers in her frame over DECK_Y; the bake stands on her keel, the waterline over it.
  const toBake = (q) => [q[0], q[1] + lift, q[2]];
  const crosses = (a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    for (let t = 0; t < hull.length; t += 9) {
      const p0 = [hull[t], hull[t + 1], hull[t + 2]];
      const e1 = [hull[t + 3] - p0[0], hull[t + 4] - p0[1], hull[t + 5] - p0[2]];
      const e2 = [hull[t + 6] - p0[0], hull[t + 7] - p0[1], hull[t + 8] - p0[2]];
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-12) continue;
      const sv = [a[0] - p0[0], a[1] - p0[1], a[2] - p0[2]];
      const u = (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const qv = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const w = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
      if (w > 0 && w < 1) return [t / 9, a.map((v, i) => +(v + d[i] * w).toFixed(3))];
    }
    return false;
  };
  const bad = [];
  for (const spec of CRAFTS.galleon.mounts.filter((m) => m.kind === 'cannon')) {
    assert.ok(spec.scale > 1, 'the gun on her is drawn at its bake size');
    for (const pitch of spec.pitchLim) for (const yaw of [-spec.yawLim, 0, spec.yawLim]) {
      const pin = toBake(layPoint(spec, [yaw, pitch], 0, true, 0, 0, 0));
      const pts = barrel.positions;
      for (let i = 0; i < pts.length; i += 3) {
        const q = toBake(layPoint(spec, [yaw, pitch], 0, true, pts[i], pts[i + 1], pts[i + 2]));
        const hit = crosses(pin, q);
        if (hit) { bad.push(`gun at x ${spec.x}, laid ${yaw.toFixed(2)}/${pitch.toFixed(2)}: through her at ${hit[1].join(', ')}`); break; }
      }
    }
  }
  assert.deepEqual(bad, []);
});
