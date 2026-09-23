// projectToRadar and terrainColor, on their own. No THREE and no `document` at module load
// or call time - see the note at the top of web/js/minimap.js - so this needs neither the
// shared-loader registration nor a `globalThis.document` stub other test files in this
// suite use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectToRadar, terrainColor, districtColor } from '../web/js/minimap.js';

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

test('districtColor leaves ground nobody owns exactly as terrainColor draws it', () => {
  assert.equal(districtColor(0.2, -1, [0]), terrainColor(0.2));
  assert.equal(districtColor(0.2, null, [0]), terrainColor(0.2));
});

test('districtColor washes the town square a neutral grey, not a hamlet hue', () => {
  assert.equal(districtColor(0.2, -2, [0]), 'rgb(206,194,163)');
});

test('districtColor tints owned ground toward the hamlet hue, and two different hues differ', () => {
  const grass = terrainColor(0.5);
  const a = districtColor(0.5, 0, [0, 180]);   // district 0, hue 0 (red)
  const b = districtColor(0.5, 1, [0, 180]);   // district 1, hue 180 (cyan)
  assert.notEqual(a, grass, 'an owned cell should differ from the bare terrain colour');
  assert.notEqual(a, b, 'two districts on opposite hues should not read the same');
});

test('the chart fits every island in, north up, one scale for both axes', async () => {
  const { fitMap, mapBounds } = await import('../web/js/minimap.js');
  const regions = [{ origin: [0, 0], half: 32 }, { origin: [100, 0], half: 32 }];
  const b = mapBounds(regions, [{ x: 0, z: -80 }]);
  assert.deepEqual(b, { minX: -32, maxX: 132, minZ: -92, maxZ: 32 });
  const fit = fitMap(b, 1000, 600, 40);
  const [nx, ny] = fit.toPx(0, -80), [sx, sy] = fit.toPx(0, 0);
  assert.ok(ny < sy, 'north is up');
  for (const [x, z] of [[b.minX, b.minZ], [b.maxX, b.maxZ]]) {
    const [px, py] = fit.toPx(x, z);
    assert.ok(px >= 39.999 && px <= 960.001 && py >= 39.999 && py <= 560.001, 'inside the padding');
  }
  const [wx, wz] = fit.toWorld(...fit.toPx(17, -5));
  assert.ok(Math.abs(wx - 17) < 1e-9 && Math.abs(wz + 5) < 1e-9, 'toWorld inverts toPx');
  assert.equal(nx, sx);
});
