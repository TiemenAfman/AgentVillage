// Who is behind, the page or the sea - and the one number that makes it a hard line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, compareLines, updateNotice, refusalNotice, updateGate, APK_URL, RELEASES, SEA_PROTOCOL } from '../web/js/update.js';
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

test('a patch apart says nothing: 0.4.x is one line and keeps its island and its sea', () => {
  assert.equal(compareLines('0.4.0', '0.4.1231241'), 0);
  assert.equal(compareLines('0.4.9', '0.5.0'), -1);
  assert.equal(compareLines('1.0', '0.9.9'), 1);
  assert.equal(compareLines(null, '0.4.1'), null);
  const a = { version: '0.4.0' }, b = { version: '0.4.1' };
  assert.equal(updateNotice({ mine: a, sea: b }), null, 'a patch behind nagged');
  assert.equal(updateNotice({ mine: b, sea: a }), null, 'a sea a patch behind nagged');
  assert.equal(updateGate({ mine: a, sea: b }), null, 'the app was sent to update for a patch');
  assert.equal(updateNotice({ mine: { version: '0.4.3' }, sea: { version: '0.5.0' } }).kind, 'behind');
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

test('the gate goes up for a newer release on GitHub, whether or not the sea has it yet', () => {
  const mine = { version: '0.5.0' };
  const released = updateGate({ mine, sea: { version: '0.5.0' }, latest: '0.6.0' });
  assert.equal(released.blocking, false);
  assert.match(released.title, /0\.6\.0/);
  assert.doesNotMatch(released.body, /sea/, 'blamed the sea for a release it has nothing to do with');
  assert.equal(updateGate({ mine, latest: '0.6.0' }).blocking, false, 'needs no welcome to know');

  assert.equal(updateGate({ mine, latest: '0.5.1' }), null, 'the app was sent to update for a patch');
  assert.equal(updateGate({ mine, latest: '0.5.0' }), null);
  assert.equal(updateGate({ mine, latest: null }), null, 'GitHub unreachable is nothing to say');

  // Both ahead: the newer of the two is the one named.
  assert.match(updateGate({ mine, sea: { version: '0.6.0' }, latest: '0.7.0' }).title, /0\.7\.0/);
  assert.match(updateGate({ mine, sea: { version: '0.7.0' }, latest: '0.6.0' }).title, /0\.7\.0/);
  // Refused still wins: that card has no Later.
  assert.equal(updateGate({ speaks: SEA_PROTOCOL + 1, mine, latest: '0.6.0' }).blocking, true);
});
