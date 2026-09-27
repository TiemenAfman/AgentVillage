// The cloud layer is the sea's, not the page's: a cloud is where the sea's clock and its
// own place in the world say, whoever looks (Plans/klok-en-hemel-van-de-zee.md, fase 3).
//
// Two pages on the same sea draw their own island at the scene origin and translate the
// world by their berth, so the thing to hold is that the WORLD position is the same for
// both - and that the three images drawn round the camera move smoothly as the wind
// carries a cloud over a tile's edge, rather than one of them jumping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const { cloudNearest, CLOUD_TILE, WAVE_LOOP, WAVE_RATES } = await import('../web/js/world.js');

const images = (start, speed, t, focus) => {
  const a = cloudNearest(start, speed, t, focus);
  return [a - CLOUD_TILE, a, a + CLOUD_TILE];
};

test('a cloud is in the same place in the world for every camera that can see it', () => {
  const t = 1_790_000_000.25;   // an epoch in seconds, as the sea hands it round
  for (const [start, speed] of [[0, 0.35], [140.5, 0.6], [287.9, 0.75]]) {
    // Two players, one at home and one three rings out, both looking at the same patch.
    const a = images(start, speed, t, 100);
    const b = images(start, speed, t, 100 + 0.4);
    const near = (xs, p) => xs.reduce((m, x) => (Math.abs(x - p) < Math.abs(m - p) ? x : m));
    assert.ok(Math.abs(near(a, 100) - near(b, 100)) < 1e-6);
    // And far across the sea the images are the same lattice, a tile apart.
    const far = cloudNearest(start, speed, t, 5000);
    const k = (far - a[1]) / CLOUD_TILE;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${k} tiles`);
  }
});

test('the drawn images cover a tile and a half each way of the camera', () => {
  for (const focus of [-1234.5, 0, 77, 9999]) {
    for (const t of [0, 13.7, 1e9]) {
      const [lo, mid, hi] = images(50, 0.5, t, focus);
      assert.ok(mid >= focus - CLOUD_TILE / 2 && mid < focus + CLOUD_TILE / 2);
      assert.ok(lo < focus - CLOUD_TILE / 2 && hi >= focus + CLOUD_TILE / 2);
    }
  }
});

test('the wind carries a cloud over a tile edge without any image jumping near the camera', () => {
  const focus = 0, speed = 0.7;
  let prev = images(10, speed, 0, focus);
  for (let t = 0.05; t < CLOUD_TILE / speed + 5; t += 0.05) {
    const now = images(10, speed, t, focus);
    // Every image within a tile of the camera has a neighbour from the step before that is
    // one wind-step behind it; only an image a tile and a half out may appear.
    for (const x of now) {
      if (Math.abs(x - focus) > CLOUD_TILE) continue;
      assert.ok(prev.some((p) => Math.abs(x - p - speed * 0.05) < 1e-6), `jump at t=${t}`);
    }
    prev = now;
  }
});

test('the swell folds on the sea clock without a seam', () => {
  for (const rate of WAVE_RATES) {
    const turns = (WAVE_LOOP * rate) / (2 * Math.PI);
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `${rate} goes ${turns} times round`);
  }
});

test('every wave term in the water shader is one WAVE_LOOP knows about', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');
  const water = src.slice(src.indexOf('const waterMat'), src.indexOf('const water ='));
  const rates = [...water.matchAll(/uTime \* ([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(rates.length >= 3, 'found the wave terms');
  for (const r of rates) assert.ok(WAVE_RATES.includes(r), `uTime * ${r} is not in WAVE_RATES`);
});
