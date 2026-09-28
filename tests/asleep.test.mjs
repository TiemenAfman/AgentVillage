// A body left standing while its keeper is up in the sky (Plans/karakter-blijft-staan.md):
// the page and the sea agree on its bit, and no guard or lava counts it as afoot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { POSE } from '../lib/players.mjs';
import { afoot } from '../lib/hostility.mjs';

test('the page sends ASLEEP by the number the sea keeps', () => {
  const net = fs.readFileSync(new URL('../web/js/net.js', import.meta.url), 'utf8');
  const peers = fs.readFileSync(new URL('../web/js/peers.js', import.meta.url), 'utf8');
  assert.match(net, new RegExp(`FLAG_ASLEEP = ${POSE.ASLEEP};`));
  assert.match(peers, new RegExp(`FLAG_ASLEEP = ${POSE.ASLEEP};`));
});

test('asleep is not afoot', () => {
  const p = { walking: true, room: null, posed: true, id: 'aabbccdd', f: 0 };
  assert.equal(afoot(p, new Set()), true);
  assert.equal(afoot({ ...p, f: POSE.ASLEEP }, new Set()), false, 'a guard may swing at a body nobody is steering');
});
