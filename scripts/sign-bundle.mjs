#!/usr/bin/env node
// Signs the phone app's page bundle (Plans/app-zonder-apk-bijwerken.md): the release workflow
// zips src-android/dist/ into promptholm-web.zip, and this writes promptholm-web.json beside it -
// the version (package.json), the lowest shell it runs on (src-android/shell-version), the zip's
// size and sha256, and an ed25519 signature over exactly those. The app (src-android/src/bundle.rs
// `verify`) believes nothing in the json without that signature under the key it carries.
//
//   BUNDLE_SIGNING_KEY=<pkcs8 pem> node scripts/sign-bundle.mjs promptholm-web.zip promptholm-web.json
//
// `message` is the one copy of the signed bytes on this side; bundle.rs `message` is the other,
// and tests/bundle-sign.test.mjs and bundle.rs's own test hold both to one signature.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function message({ version, shell, size, sha256 }) {
  return `promptholm-web:1\n${version}\n${shell}\n${size}\n${sha256}\n`;
}

export function signBundle(fields, privateKey) {
  const sig = crypto.sign(null, Buffer.from(message(fields)), privateKey);
  return { v: 1, ...fields, sig: sig.toString('hex') };
}

export function shellVersion() {
  return Number(fs.readFileSync(path.join(ROOT, 'src-android', 'shell-version'), 'utf8').trim());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [zip, out] = process.argv.slice(2);
  const pem = process.env.BUNDLE_SIGNING_KEY;
  if (!zip || !out) {
    process.stderr.write('usage: node scripts/sign-bundle.mjs <bundle.zip> <bundle.json>\n');
    process.exit(2);
  }
  if (!pem) {
    process.stderr.write('sign-bundle: BUNDLE_SIGNING_KEY is not set\n');
    process.exit(1);
  }
  const bytes = fs.readFileSync(zip);
  const fields = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    shell: shellVersion(),
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  const key = crypto.createPrivateKey(pem);
  // The public half must be the one the app carries, or every phone refuses this bundle.
  const pub = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
  const carried = fs.readFileSync(path.join(ROOT, 'src-android', 'bundle-key.pub'), 'utf8').trim();
  if (pub !== carried) {
    process.stderr.write(`sign-bundle: the signing key's public half (${pub}) is not src-android/bundle-key.pub (${carried || 'empty'})\n`);
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify(signBundle(fields, key), null, 2) + '\n');
  process.stdout.write(`sign-bundle: ${fields.version} (shell ${fields.shell}), ${fields.size} bytes, ${fields.sha256}\n`);
}
