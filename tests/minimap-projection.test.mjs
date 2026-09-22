// projectToRadar and terrainColor, on their own. No THREE and no `document` at module load
// or call time - see the note at the top of web/js/minimap.js - so this needs neither the
// shared-loader registration nor a `globalThis.document` stub other test files in this
// suite use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToRadar, terrainColor } from '../web/js/minimap.js';

test('a point inside the world radius scales proportionally and does not clamp', () => {
  const p = projectToRadar(10, 0, 100, 80);   // 10 units east, world radius 100, canvas radius 80
  assert.equal(p.clamped, false);
  assert.ok(Math.abs(p.x - 8) < 1e-9);
  assert.equal(p.y, 0);
});

test('north (-z) lands above centre and east (+x) lands to its right', () => {
  const north = projectToRadar(0, -10, 100, 80);
  const east = projectToRadar(10, 0, 100, 80);
  assert.ok(north.y < 0, 'north should be negative y (up) on a canvas where y grows downward');
  assert.ok(east.x > 0, 'east should be positive x (right)');
});

test('a point beyond the world radius clamps to the rim, bearing unchanged', () => {
  const dx = 300, dz = 400;                    // distance 500, well past worldRadius
  const p = projectToRadar(dx, dz, 100, 80);
  assert.equal(p.clamped, true);
  assert.ok(Math.abs(Math.hypot(p.x, p.y) - 80) < 1e-9, 'clamped point should sit exactly on the rim');
  const wantAngle = Math.atan2(dz, dx);
  const gotAngle = Math.atan2(p.y, p.x);
  assert.ok(Math.abs(wantAngle - gotAngle) < 1e-9, 'clamping must not change the bearing');
});

test('a point at the player is drawn at the centre, not dropped', () => {
  const p = projectToRadar(0, 0, 100, 80);
  assert.deepEqual(p, { x: 0, y: 0, clamped: false });
});

test('terrainColor bands match the height thresholds the horizon silhouette uses', () => {
  assert.equal(terrainColor(0.2), 'rgb(216,201,162)', 'below 0.35 is sand');
  assert.equal(terrainColor(4), 'rgb(138,133,119)', 'above 3.4 is rock');
  assert.equal(terrainColor(0.35), 'rgb(111,138,78)', 'right at the sand/grass line is grass');
});

test('terrainColor shades water darker the deeper it goes, never crossing into land colours', () => {
  const justUnderwater = terrainColor(-1e-6);
  const deep = terrainColor(-2.5);
  assert.equal(justUnderwater, 'rgb(101,196,181)', 'just under the waterline is the shallow shade');
  assert.equal(deep, 'rgb(33,94,120)', 'clamps to the deep shade rather than going past it');
});
