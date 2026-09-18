// The berths, and the four limits that are the whole of their safety.
//
// Everything here runs against a temp directory rather than the real data/guests/,
// because two of these tests sweep the lot and one of them fills it up.
//
// The assertion this file exists for is the last one: a berth never survives a restart.
// That is what keeps a visit a visit. An island that stayed put would be a permanent copy
// of somebody else's village on this disk, kept by a server nobody thinks of as holding
// their data, and nobody agreed to that. It is not a policy, it is the design - so it is
// asserted, not documented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createGuests, berthDirFor, BUCKET_SIZE, BUCKET_REFILL, MAX_GUEST_ISLANDS, MAX_BERTH_BYTES, MAX_TOTAL_BYTES,
} from '../lib/guests.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-berth-'));
}

// The shape park() stores, which is whatever parseBundle handed back. Nothing here
// validates it - lib/guests.mjs stores, lib/islandbundle.mjs decides - so a small stand-in
// is the honest fixture.
function bundle(name = 'Elsewhere', filler = 0) {
  return {
    v: 1,
    island: { id: 'a'.repeat(16), name, keeper: 'Somebody', seed: 7, gridSize: 64, terrainHash: 'deadbeef', foundedAt: null },
    grid: { size: 64 },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [], crops: [],
    // Ballast, for the tests that are about how much disk a harbour holds.
    props: filler ? [{ id: 'prop:1', kind: 'tree', note: 'x'.repeat(filler) }] : [],
  };
}

const id = (n) => String(n).repeat(16).slice(0, 16);

test('a bad id never becomes a path, and the path it does become stays in the harbour', () => {
  const root = tempDir();
  const guests = createGuests({ dir: root });

  // The regex first: an id is lowercase hex, eight to sixty-four of it, which is exactly
  // what a beacon id is (lib/neighbours.mjs:62).
  for (const bad of [
    '..', '../..', '../../etc/passwd', '..\\..\\windows', 'a/../../b', 'a\\b',
    'ABCDEF01', 'short', '', 'g'.repeat(16), 'a'.repeat(65), 'a'.repeat(16) + '/x',
    null, undefined, 42, {},
  ]) {
    assert.throws(() => berthDirFor(root, bad), /island id/, `${JSON.stringify(bad)} was taken for an id`);
    assert.throws(() => guests.park({ id: bad, address: '10.0.0.5', bundle: bundle() }), /island id/);
    assert.equal(guests.read(bad), null);
    assert.equal(guests.evict(bad), false);
  }

  // And the assertion behind the regex: whatever comes out resolves inside the harbour.
  // This one cannot fail while the regex stands, which is the point - it is what keeps
  // holding if somebody ever loosens the regex in a hurry.
  for (const good of ['a'.repeat(8), 'a'.repeat(64), '0123456789abcdef', 'deadbeefcafe1234']) {
    const d = berthDirFor(root, good);
    assert.ok(d.startsWith(path.resolve(root) + path.sep), `${good} resolved to ${d}`);
    assert.equal(path.basename(d), good);
  }

  // Nothing was created by any of that.
  assert.deepEqual(fs.readdirSync(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the bucket lets three through, then one every ten seconds', () => {
  const root = tempDir();
  const guests = createGuests({ dir: root });
  const who = '192.168.1.42';
  const t0 = 1_700_000_000_000;

  assert.equal(BUCKET_SIZE, 3);
  assert.equal(BUCKET_REFILL, 0.1);

  for (let i = 0; i < BUCKET_SIZE; i++) assert.equal(guests.take(who, t0), true, `upload ${i + 1} was refused`);
  assert.equal(guests.take(who, t0), false, 'a fourth upload went straight through');

  // Nine seconds is not a token.
  assert.equal(guests.take(who, t0 + 9000), false);
  // Ten is.
  assert.equal(guests.take(who, t0 + 10000), true);
  assert.equal(guests.take(who, t0 + 10000), false);
  // And it refills to the brim and no further: two minutes of quiet buys three, not twelve.
  for (let i = 0; i < BUCKET_SIZE; i++) assert.equal(guests.take(who, t0 + 130000), true);
  assert.equal(guests.take(who, t0 + 130000), false);

  // Per address, so one flooder does not shut the door on the rest of the office.
  assert.equal(guests.take('192.168.1.43', t0), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the fifth island is turned away, and the fourth is not', () => {
  const root = tempDir();
  const guests = createGuests({ dir: root });
  assert.equal(MAX_GUEST_ISLANDS, 4);

  for (let n = 1; n <= MAX_GUEST_ISLANDS; n++) {
    const berth = guests.park({ id: id(n), address: `10.0.0.${n}`, bundle: bundle(`Island ${n}`) });
    assert.equal(berth.id, id(n));
    assert.equal(berth.name, `Island ${n}`);
  }
  assert.equal(guests.list().length, MAX_GUEST_ISLANDS);

  const full = () => guests.park({ id: id(5), address: '10.0.0.5', bundle: bundle('One too many') });
  assert.throws(full, /harbour is full/);
  assert.throws(full, (e) => e.status === 503);
  assert.equal(guests.read(id(5)), null);

  // An island already moored may sail again - it is not a new berth - and evicting one
  // makes room for the next arrival.
  assert.ok(guests.park({ id: id(1), address: '10.0.0.1', bundle: bundle('Island 1 again') }));
  assert.equal(guests.read(id(1)).island.name, 'Island 1 again');
  assert.equal(guests.evict(id(2)), true);
  assert.ok(guests.park({ id: id(5), address: '10.0.0.5', bundle: bundle('Island 5') }));
  assert.equal(guests.list().length, MAX_GUEST_ISLANDS);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a berth belongs to the address that took it, for as long as it holds it', () => {
  const root = tempDir();
  const guests = createGuests({ dir: root });

  guests.park({ id: id(1), address: '10.0.0.7', bundle: bundle('Mine') });
  assert.throws(() => guests.park({ id: id(1), address: '10.0.0.8', bundle: bundle('Not yours') }), /already moored/);
  assert.throws(() => guests.park({ id: id(1), address: '10.0.0.8', bundle: bundle() }), (e) => e.status === 409);
  assert.equal(guests.read(id(1)).island.name, 'Mine');

  // Once it has gone, the id is anybody's again.
  guests.evict(id(1));
  assert.ok(guests.park({ id: id(1), address: '10.0.0.8', bundle: bundle('Yours now') }));
  assert.equal(guests.read(id(1)).island.name, 'Yours now');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the harbour has a size in bytes as well as in islands', () => {
  const root = tempDir();
  assert.equal(MAX_BERTH_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_TOTAL_BYTES, MAX_GUEST_ISLANDS * MAX_BERTH_BYTES);

  // One berth's own ceiling, at the real number.
  const big = createGuests({ dir: root });
  assert.throws(
    () => big.park({ id: id(1), address: '10.0.0.1', bundle: bundle('Enormous', MAX_BERTH_BYTES + 1) }),
    (e) => e.status === 413 && /a berth holds/.test(e.message),
  );
  assert.deepEqual(big.list(), []);

  // And the total, in a harbour small enough to fill. With the real numbers four berths of
  // two megabytes is exactly the eight-megabyte total, so the total assert can never be
  // the one that fires - it is the one that keeps holding if either of the other two is
  // ever raised on its own, which is what this checks.
  const small = createGuests({ dir: root, maxIslands: 4, maxBerthBytes: 4000, maxTotalBytes: 5000 });
  assert.ok(small.park({ id: id(1), address: '10.0.0.1', bundle: bundle('A', 2500) }));
  assert.throws(
    () => small.park({ id: id(2), address: '10.0.0.2', bundle: bundle('B', 2500) }),
    (e) => e.status === 413 && /room for/.test(e.message),
  );
  assert.equal(small.list().length, 1);
  // Re-parking the island that is already there is measured against its own size, not on
  // top of it, or an island could never be sent twice.
  assert.ok(small.park({ id: id(1), address: '10.0.0.1', bundle: bundle('A again', 2500) }));
  fs.rmSync(root, { recursive: true, force: true });
});

test('a berth never survives a restart', () => {
  const root = tempDir();

  // A berth parked by the run before this one, plus a stray that was never a berth at all.
  const first = createGuests({ dir: root });
  first.park({ id: id(1), address: '10.0.0.1', bundle: bundle('Yesterday') });
  first.park({ id: id(2), address: '10.0.0.2', bundle: bundle('Also yesterday') });
  fs.mkdirSync(path.join(root, id(3)), { recursive: true });
  fs.writeFileSync(path.join(root, id(3), 'island.json'), '{"not":"even a bundle"}');
  assert.equal(first.list().length, 2);
  assert.ok(fs.readdirSync(root).length >= 3);

  // Starting the server is the only thing that has to happen for them to be gone. There is
  // no call to remember to make: creating the manager is what sweeps the lot.
  const second = createGuests({ dir: root });
  assert.deepEqual(fs.readdirSync(root), [], 'something was left in the harbour after a restart');
  assert.deepEqual(second.list(), []);
  assert.equal(second.read(id(1)), null);

  // And the id is free, as it has to be: the address that held it is not remembered
  // either, or a visitor who reconnected from a new lease could never come back.
  assert.ok(second.park({ id: id(1), address: '10.9.9.9', bundle: bundle('Today') }));
  assert.equal(second.clearAll(), 1);
  assert.deepEqual(fs.readdirSync(root), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('what a berth looks like from the outside names no machine', () => {
  const root = tempDir();
  const guests = createGuests({ dir: root });
  const berth = guests.park({ id: id(1), address: '192.168.1.99', bundle: bundle('Elsewhere') });

  // Which machine on the network a visitor came from is the keeper's business, and this
  // list is public (lib/access.mjs puts /api/islands on PUBLIC_API).
  for (const row of [berth, ...guests.list()]) {
    assert.ok(!JSON.stringify(row).includes('192.168.1.99'), 'a berth published the address that parked it');
    assert.equal(row.name, 'Elsewhere');
    assert.equal(row.keeper, 'Somebody');
    assert.ok(row.bytes > 0);
    assert.ok(row.parkedAt);
  }
  fs.rmSync(root, { recursive: true, force: true });
});
