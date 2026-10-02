// The phone app's page bundle is signed in Node (scripts/sign-bundle.mjs) and checked in Rust
// (src-android/src/bundle.rs `verify`). Both build the signed bytes themselves, so this holds
// Node to the one signature bundle.rs's own test holds Rust to (seed 32 x 0x07).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { message, signBundle, shellVersion } from '../scripts/sign-bundle.mjs';

const seed = Buffer.alloc(32, 7);
const key = crypto.createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der', type: 'pkcs8',
});
const FIELDS = { version: '0.8.3', shell: 1, size: 1234, sha256: 'ab'.repeat(32) };
const RUST = fs.readFileSync(new URL('../src-android/src/bundle.rs', import.meta.url), 'utf8');

test('Node signs the bytes bundle.rs checks, to the signature bundle.rs holds', () => {
  const json = signBundle(FIELDS, key);
  assert.equal(json.v, 1);
  const sig = RUST.match(/TEST_SIG: &str = "([0-9a-f]+)"/)[1];
  assert.equal(json.sig, sig, 'bundle.rs tests a different signature than Node makes');
  const pub = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  assert.equal(RUST.match(/TEST_KEY: &str = "([0-9a-f]+)"/)[1], pub);
  // And the message is written the same way on both sides.
  assert.equal(message(FIELDS), 'promptholm-web:1\n0.8.3\n1\n1234\n' + 'ab'.repeat(32) + '\n');
  assert.match(RUST, /format!\("promptholm-web:1\\n\{version\}\\n\{shell\}\\n\{size\}\\n\{sha256\}\\n"\)/);
});

test('the shell version is one whole number, read from the one file', () => {
  assert.ok(Number.isInteger(shellVersion()) && shellVersion() >= 1);
  assert.match(RUST, /include_str!\("\.\.\/shell-version"\)/);
});
