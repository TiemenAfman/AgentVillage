import test from 'node:test';
import assert from 'node:assert/strict';
import { hamletSignSites } from '../web/js/hamlet-sign-placement.js';

const terrain = { size: 40, isLand: () => true, cellWorld: (x, z) => [x, z], worldHeight: () => 1 };
const gate = { at: [20, 20], next: [20, 21] };
const road = Array.from({ length: 40 }, (_, z) => [20, z]);

test('both orientations keep the entire frame clear of the path', () => {
  for (const along of [false, true]) {
    const cells = along ? road.map(([x, z]) => [z, x]) : road;
    const place = hamletSignSites({ paths: [{ cells }] }, terrain);
    const site = place(along ? { at: [20, 20], next: [21, 20] } : gate);
    assert.equal(site.along, along);
    assert.ok(Math.abs((along ? site.gz : site.gx) - 20) >= 2);
    assert.equal(along ? site.gx : site.gz, 20);
  }
});

test('a junction and occupied plots cannot catch either post', () => {
  const cells = [...road, ...road.map(([x, z]) => [z, x])];
  const plot = { gx: 14, gz: 14, w: 6, d: 13 };
  const site = hamletSignSites({ paths: [{ cells }], buildings: [{ plot }] }, terrain)(gate);
  assert.ok(site.gx >= 22);
  assert.ok(Math.abs(site.gz - 20) >= 1);
  for (const dx of [-1, 0, 1]) assert.ok(!cells.some(([x, z]) => x === site.gx + dx && z === site.gz));
});

test('water, steep ground and an absent entrance never fall back onto the road', () => {
  assert.equal(hamletSignSites({}, terrain)(null), null);
  assert.equal(hamletSignSites({}, { ...terrain, isLand: () => false })(gate), null);
  assert.equal(hamletSignSites({}, { ...terrain, worldHeight: (x) => x })(gate), null);
});

test('neighbouring signs reserve separate footprints', () => {
  const place = hamletSignSites({ paths: [{ cells: road }] }, terrain);
  const a = place(gate), b = place(gate);
  assert.ok(Math.abs(a.gx - b.gx) >= 3 || a.gz !== b.gz);
});
