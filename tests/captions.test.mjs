import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// No shared-loader and no stubbed document, on purpose: captions.js imports nothing, and the
// last test below keeps it that way. The moment it needs a preamble it has reached back into
// three.js or the page, and the choice it makes can no longer be checked on its own.
import { lobeSupers, captionLobe, captionCell } from '../web/js/captions.js';

// A parcel the way scan.mjs's rleParcel sends it: a bounding box of '0'/'1' rows.
const parcel = (...rows) => ({ i0: 0, j0: 0, w: rows[0].length, h: rows.length, rows });
const lobe = (green, ...rows) => ({ green, size: 0, paved: [], parcel: parcel(...rows) });
const hamlet = (lobes, extra = {}) => ({ id: 'd1', name: 'claude', tier: 'hamlet', center: [10, 10], lobes, ...extra });

test('a lobe is as big as the ones in its parcel, not its bounding box', () => {
  assert.equal(lobeSupers(lobe([0, 0], '110', '010')), 3);
  assert.equal(lobeSupers(lobe([0, 0], '000')), 0);
  assert.equal(lobeSupers({ green: [0, 0] }), 0);
  assert.equal(lobeSupers(null), 0);
});

test('a grown hamlet gets one caption, over its biggest lobe', () => {
  const d = hamlet([
    lobe([10, 10], '11', '11'),          // the founding lobe: 4
    lobe([30, 10], '111', '111'),        // an annex that outgrew it: 6
    lobe([10, 30], '1'),                 // a small annex: 1
  ]);
  assert.equal(captionLobe(d), 1);
  assert.deepEqual(captionCell(d), [30, 10]);
});

test('a tie goes to the founding lobe, so the caption does not hop between rescans', () => {
  const d = hamlet([lobe([10, 10], '11'), lobe([30, 10], '11'), lobe([50, 10], '1')]);
  assert.equal(captionLobe(d), 0);
  assert.deepEqual(captionCell(d), [10, 10]);
  // ... and between two later lobes, the earlier one.
  const e = hamlet([lobe([10, 10], '1'), lobe([30, 10], '111'), lobe([50, 10], '111')]);
  assert.equal(captionLobe(e), 1);
});

test('a single-lobe hamlet keeps its caption where it always was', () => {
  assert.deepEqual(captionCell(hamlet([lobe([12, 14], '1')])), [12, 14]);
  // A lobe with no centre of its own falls back to the district's, as the per-lobe loop did.
  assert.deepEqual(captionCell(hamlet([{ parcel: parcel('1') }])), [10, 10]);
});

test('no caption for a farmstead, a hamlet with no centre, or one with no land', () => {
  assert.equal(captionCell(hamlet([lobe([1, 1], '1')], { tier: 'farmstead' })), null);
  assert.equal(captionCell(hamlet([lobe([1, 1], '1')], { center: null })), null);
  assert.equal(captionCell(hamlet([])), null);
  assert.equal(captionCell(hamlet(undefined)), null);
  assert.equal(captionLobe(hamlet([])), -1);
  assert.equal(captionCell(null), null);
});

test('captions.js stays free of imports, so it runs anywhere', () => {
  const src = readFileSync(new URL('../web/js/captions.js', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, '');                              // the header talks about the DOM
  assert.doesNotMatch(src, /^\s*import\b/m);
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|THREE/);
});
