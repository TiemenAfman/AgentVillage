// Who is behind, the page or the sea - and the one number that makes it a hard line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, updateNotice, refusalNotice, updateGate, APK_URL, RELEASES, SEA_PROTOCOL } from '../web/js/update.js';
import { SEA_V } from '../lib/sea.mjs';

test('the page speaks the protocol the sea does', () => {
  // Two copies on purpose (the page may not import lib/); this is what holds them together.
  // Bump both when an old peer would misread a message - see CLAUDE.md.
  assert.equal(SEA_PROTOCOL, SEA_V);
});

test('versions compare per number, not as text', () => {
  assert.equal(compareVersions('0.1.1', '0.2.0'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.3'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions(null, '0.2.0'), null, 'an unknown build was taken for an old one');
  assert.equal(compareVersions('dev', '0.2.0'), null);
});

test('behind, ahead, or nothing to say', () => {
  const old = { version: '0.1.1', commit: 'aaaaaaa' }, now = { version: '0.2.0', commit: 'bbbbbbb' };
  assert.equal(updateNotice({ mine: old, sea: now }).kind, 'behind');
  assert.equal(updateNotice({ mine: now, sea: old }).kind, 'sea-behind');
  assert.equal(updateNotice({ mine: old, sea: { ...old, commit: 'ccccccc' } }), null, 'a different commit on the same release nagged');
  assert.equal(updateNotice({ mine: old, sea: { version: null, commit: null } }), null, 'a sea that does not say its version nagged');
  // On the phone the link is followed rather than opened in a new window: src-android
  // hands it to the phone's browser.
  assert.doesNotMatch(updateNotice({ mine: old, sea: now, phone: true }).html, /target=/);
  assert.match(updateNotice({ mine: old, sea: now }).html, /target="_blank"/);
});

test('a refusal over the protocol says which side has to move', () => {
  assert.match(refusalNotice(SEA_PROTOCOL + 1), /moved on/);
  assert.match(refusalNotice(SEA_PROTOCOL - 1), /is behind/);
  assert.match(refusalNotice(undefined), /different version/);
});

test('the app gets a whole-screen gate: blocking when refused, with a Later when merely behind', () => {
  const refused = updateGate({ speaks: SEA_PROTOCOL + 1 });
  assert.equal(refused.blocking, true);
  assert.equal(refused.download, APK_URL);
  assert.ok(APK_URL.startsWith(RELEASES + '/download/') && APK_URL.endsWith('.apk'), 'the stable latest-download URL');
  assert.match(refused.steps, /uninstall/i, 'says how to get past a release signed with a different key');

  const behind = updateGate({ mine: { version: '0.2.0' }, sea: { version: '0.3.0' } });
  assert.equal(behind.blocking, false);
  assert.match(behind.title, /0\.3\.0/);

  assert.equal(updateGate({ mine: { version: '0.3.0' }, sea: { version: '0.3.0' } }), null);
  assert.equal(updateGate({ speaks: SEA_PROTOCOL - 1 }), null, 'an older sea is not for the app to fix');
  assert.equal(updateGate({}), null);
});
