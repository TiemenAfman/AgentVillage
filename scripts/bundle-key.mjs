#!/usr/bin/env node
// Makes the key pair the phone app's page bundles are signed with (Plans/app-zonder-apk-bijwerken.md).
// Run once, by the keeper, on their own machine:
//
//   node scripts/bundle-key.mjs
//
// It writes the public half to src-android/bundle-key.pub (committed: every APK built after that
// carries it) and the private half to bundle-signing-key.pem in this folder (gitignored), which
// goes into the repository's BUNDLE_SIGNING_KEY secret and into a password manager - lose it and
// no phone takes a bundle again until it has an APK with a new public key.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PEM = path.join(ROOT, 'bundle-signing-key.pem');
const PUB = path.join(ROOT, 'src-android', 'bundle-key.pub');

if (fs.existsSync(PEM) && !process.argv.includes('--again')) {
  process.stderr.write(`bundle-key: ${PEM} already exists - a new pair makes every APK so far refuse new bundles. --again to do it anyway.\n`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
fs.writeFileSync(PEM, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
fs.writeFileSync(PUB, pub + '\n');
process.stdout.write(`bundle-key: public half ${pub}\n  -> ${path.relative(ROOT, PUB)} (commit it)\n`
  + `  private half -> ${path.relative(ROOT, PEM)}: paste its whole contents into the GitHub secret BUNDLE_SIGNING_KEY,\n`
  + `  keep a copy in a password manager, then delete the file.\n`);
