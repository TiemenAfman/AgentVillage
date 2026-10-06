// The noclip camera's pure half (web/js/noclip.js, Plans/noclip-camera.md): the flying step, the
// mouse, the speed, the URL form and the pose a three.js camera is put in. No document: importing
// the module touches nothing, only createNoclip does.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  stepNoclip, turnBy, lookFrom, nudgeSpeed, parseCam, formatCam, camLink, mergePose,
  applyPose, poseOf, forwardOf, moveOf, wrapAngle, onFootOutdoors, SPEED, PITCH_MAX,
} from '../web/js/noclip.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const at = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 };

test('forward follows the view, pitch included', () => {
  const p = stepNoclip(at, { f: 1 }, 0.5, 4);
  assert.ok(near(p.x, 1) && near(p.y, 2) && near(p.z, 5));
  const up = stepNoclip({ ...at, pitch: Math.PI / 4 }, { f: 1 }, 1, 1);
  assert.ok(near(up.y - 2, Math.SQRT1_2) && near(up.z - 3, Math.SQRT1_2));
});

test('right is -x at yaw 0, as walk.js has it, and up is the world\'s', () => {
  const r = stepNoclip(at, { r: 1 }, 1, 1);
  assert.ok(near(r.x, 0) && near(r.z, 3));
  const u = stepNoclip({ ...at, pitch: 1 }, { u: -1 }, 1, 2);
  assert.ok(near(u.y, 0) && near(u.x, 1) && near(u.z, 3));
});

test('a diagonal is no faster than straight on, and nothing moves without input', () => {
  const d = stepNoclip(at, { f: 1, r: 1, u: 1 }, 1, 3);
  assert.ok(near(Math.hypot(d.x - at.x, d.y - at.y, d.z - at.z), 3));
  assert.deepEqual(stepNoclip(at, { f: 0 }, 1, 3), at);
  assert.deepEqual(stepNoclip(at, { f: 1 }, 0, 3), at);
});

test('keys held add up, opposite keys cancel', () => {
  assert.deepEqual(moveOf(new Set(['w', 'd', ' '])), { f: 1, r: 1, u: 1 });
  assert.deepEqual(moveOf(new Set(['w', 's', 'shift', 'e'])), { f: 0, r: 0, u: 0 });
  assert.deepEqual(moveOf(new Set(['x'])), { f: 0, r: 0, u: 0 });
});

test('the mouse turns right and looks down, never past straight up', () => {
  const t = turnBy(at, 100, 100);
  assert.ok(t.yaw < 0 && t.pitch < 0);
  assert.equal(turnBy(at, 0, -1e6).pitch, PITCH_MAX);
  assert.ok(Math.abs(wrapAngle(7 * Math.PI)) <= Math.PI + 1e-12);
});

test('lookFrom aims at the point, and keeps the aim for a point on the eye', () => {
  const l = lookFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 10 });
  assert.ok(near(l.yaw, 0) && near(l.pitch, Math.PI / 4));
  const back = lookFrom({ x: 0, y: 0, z: 0 }, { x: -5, y: 0, z: 0 });
  const [fx, , fz] = forwardOf(back.yaw, back.pitch);
  assert.ok(near(fx, -1) && near(fz, 0, 1e-12));
  assert.deepEqual(lookFrom(at, at, { yaw: 1, pitch: 0.2 }), { yaw: 1, pitch: 0.2 });
  assert.equal(lookFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 0 }).pitch, PITCH_MAX);
});

test('the wheel speeds up towards you and stays within bounds', () => {
  assert.ok(near(nudgeSpeed(10, -100), 10 * SPEED.notch));
  assert.ok(near(nudgeSpeed(10, 100), 10 / SPEED.notch));
  assert.equal(nudgeSpeed(10, 0), 10);
  assert.equal(nudgeSpeed(SPEED.max, -1), SPEED.max);
  assert.equal(nudgeSpeed(SPEED.min, 1), SPEED.min);
});

test('?cam reads three to five numbers and nothing else', () => {
  assert.deepEqual(parseCam('1,2,3'), { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 });
  assert.deepEqual(parseCam(' -4.5, 6 ,7,1.5,-0.25'), { x: -4.5, y: 6, z: 7, yaw: 1.5, pitch: -0.25 });
  assert.equal(parseCam('9,9,9,0,4').pitch, PITCH_MAX);
  for (const bad of [null, '', '1,2', '1,2,3,4,5,6', '1,,3', 'a,b,c', '1,2,Infinity', '1,2,3,NaN']) {
    assert.equal(parseCam(bad), null, String(bad));
  }
});

test('formatCam goes back through parseCam', () => {
  const p = { x: 12.3456, y: -0.5, z: 7, yaw: 2.71828, pitch: -0.4142 };
  const q = parseCam(formatCam(p));
  assert.equal(formatCam(p), '12.35,-0.5,7,2.718,-0.414');
  assert.ok(near(q.x, 12.35) && near(q.yaw, 2.718) && near(q.pitch, -0.414));
});

test('a link keeps the page and its other parameters, and names the room', () => {
  const pose = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0 };
  const a = new URL(camLink('http://localhost:4747/?nointro&noclip&cam=0,0,0&hour=21', pose, 'piratetavern'));
  assert.equal(a.searchParams.get('cam'), '1,2,3,0,0');
  assert.equal(a.searchParams.get('room'), 'piratetavern');
  assert.equal(a.searchParams.get('hour'), '21');
  assert.ok(a.searchParams.has('nointro') && !a.searchParams.has('noclip'));
  assert.ok(camLink('http://x/?room=rave', pose).includes('cam=1,2,3,0,0'));
  assert.ok(!new URL(camLink('http://x/?room=rave', pose)).searchParams.has('room'));
});

test('mergePose takes only finite numbers and keeps the angles in range', () => {
  const m = mergePose(at, { x: 9, y: 'up', z: NaN, pitch: 9, extra: 1 });
  assert.deepEqual(m, { x: 9, y: 2, z: 3, yaw: 0, pitch: PITCH_MAX });
});

test('a pose put on a three.js camera reads back the same, looking where it says', () => {
  const cam = new THREE.PerspectiveCamera();
  for (const p of [at, { x: -3, y: 40, z: 8, yaw: 2.2, pitch: -0.9 }, { x: 0, y: 1, z: 0, yaw: -1.1, pitch: 0.4 }]) {
    applyPose(cam, p);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const [fx, fy, fz] = forwardOf(p.yaw, p.pitch);
    assert.ok(near(dir.x, fx, 1e-6) && near(dir.y, fy, 1e-6) && near(dir.z, fz, 1e-6));
    const back = poseOf(cam);
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch']) assert.ok(near(back[k], p[k], 1e-6), `${k}: ${back[k]} vs ${p[k]}`);
  }
});

test('in noclip the body left standing holds its breath, not the camera (issue #90)', () => {
  const room = { room: 'tavern' };
  assert.equal(onFootOutdoors('walk', null, null), true);
  assert.equal(onFootOutdoors('walk', room, null), false);
  assert.equal(onFootOutdoors('orbit', null, null), false);
  // Flown off from a body under water: it is still there, so the air keeps running down.
  assert.equal(onFootOutdoors('noclip', null, { mode: 'walk', inside: null }), true);
  // A room peeked into is the camera's; the body is still outdoors.
  assert.equal(onFootOutdoors('noclip', room, { mode: 'walk', inside: null }), true);
  assert.equal(onFootOutdoors('noclip', room, { mode: 'walk', inside: room }), false);
  assert.equal(onFootOutdoors('noclip', null, { mode: 'orbit', inside: null }), false);
  assert.equal(onFootOutdoors('noclip', null, null), false);
});
