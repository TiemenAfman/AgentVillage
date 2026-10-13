// The sloop's ruler (scripts/measure-sloop.py, Plans/DONE/nieuwe-sloep.md chip 1): the shape of
// refs/sloop/measure.json, which scripts/build-sloop.py will read its numbers from. The bought model
// is never in git, so this runs only on a machine that has measured it and skips everywhere else -
// it holds the frame the script promises, not the model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'refs', 'sloop', 'measure.json');

test('measure.json is in the frame the build will assume', (t) => {
  if (!fs.existsSync(FILE)) { t.skip(`no measurement at ${FILE}`); return; }
  const m = JSON.parse(fs.readFileSync(FILE, 'utf8'));

  // 9 long at the rail, the bow at +z: the stem and the transom are half of it either way.
  assert.ok(Math.abs(m.length - 9) <= 0.01, `length ${m.length}`);
  assert.ok(Math.abs(m.stem_z - 4.5) <= 0.01 && Math.abs(m.transom_z + 4.5) <= 0.01, `ends ${m.stem_z} / ${m.transom_z}`);
  assert.ok(m.beam > 1 && m.beam < 9, `beam ${m.beam}`);

  // The keel on 0: the lowest point of the whole model, and nothing under it.
  const keels = Object.values(m.deck_profile).map((p) => p.keel).filter((k) => k != null);
  assert.ok(keels.length > 10, 'keels read');
  assert.ok(Math.min(...keels) >= -0.005, `keel below 0: ${Math.min(...keels)}`);
  assert.ok(Math.min(...keels) <= 0.11, `the keel is not on 0: ${Math.min(...keels)}`);

  // Stations sorted, from the transom to the stem, each section's rows by height.
  const zs = Object.keys(m.sections).map(Number);
  assert.ok(zs.length >= 37, `${zs.length} stations`);
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] > zs[i - 1], `stations out of order at ${zs[i]}`);
  assert.ok(zs[0] < -4.4 && zs[zs.length - 1] > 4.4, 'the stem and the transom are stations');
  for (const [z, rows] of Object.entries(m.sections)) {
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i][0] > rows[i - 1][0], `rows out of order at station ${z}`);
    for (const r of rows) assert.equal(r.length, 3, `a row is [h, xs, xp] at ${z}`);
  }
  assert.deepEqual(Object.keys(m.deck_profile), Object.keys(m.sections), 'one deck profile per station');

  // Bow at +z: the bowsprit's tip is the furthest thing forward, past every station.
  assert.ok(m.bowsprit && m.bowsprit.z_max > zs[zs.length - 1], 'the bowsprit reaches past the stem');
  assert.ok(m.bowsprit.z_max > 4.5, `bowsprit ends at ${m.bowsprit.z_max}`);

  // The decks, the mast and the draught candidates the build reads.
  const main = m.decks.find((d) => d.name === 'main');
  assert.ok(main && main.y > 0 && main.y < m.hull_top_max, 'a main deck under the rail');
  assert.ok(m.mast && Math.abs(m.mast.x) < 0.2 && m.mast.truck > main.y + 3, 'a mast on the centreline');
  for (const k of ['width90', 'h30', 'h35', 'h40']) assert.ok(m.draught_candidates[k] > 0 && m.draught_candidates[k] < main.y, `draught ${k}`);
  assert.equal(m.matrix.length, 4);
  assert.ok(m.matrix.every((row) => row.length === 4), 'a 4x4 matrix');
});
