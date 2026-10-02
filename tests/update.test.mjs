// Who is behind, the page or the sea - and the one number that makes it a hard line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, compareLines, updateNotice, refusalNotice, updateGate, islandNotice, APK_URL, RELEASES, SEA_PROTOCOL } from '../web/js/update.js';
import { createLatestRelease, ASK_EVERY_MS } from '../lib/latest-release.mjs';
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
  // The phone is the exception: it cannot pull, so a patch reaches it only through the gate.
  assert.equal(updateGate({ mine: a, sea: b }).blocking, false, 'a patch never reached the phone');
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

  assert.match(updateGate({ mine, latest: '0.5.1' }).title, /0\.5\.1/, 'a patch never reached the phone');
  assert.equal(updateGate({ mine, latest: '0.5.1' }).blocking, false);
  assert.equal(updateGate({ mine: { version: '0.5.2' }, latest: '0.5.1' }), null);
  assert.equal(updateGate({ mine, latest: '0.5.0' }), null);
  assert.equal(updateGate({ mine, latest: null }), null, 'GitHub unreachable is nothing to say');

  // Both ahead: the newer of the two is the one named.
  assert.match(updateGate({ mine, sea: { version: '0.6.0' }, latest: '0.7.0' }).title, /0\.7\.0/);
  assert.match(updateGate({ mine, sea: { version: '0.7.0' }, latest: '0.6.0' }).title, /0\.7\.0/);
  // Refused still wins: that card has no Later.
  assert.equal(updateGate({ speaks: SEA_PROTOCOL + 1, mine, latest: '0.6.0' }).blocking, true);
});

test('a desktop island hears of a newer release from GitHub, a patch included, as optional', () => {
  // The keeper's report: the Windows window never said a patch was out. Its banner asked only
  // the sea, by the line - so a patch, which the sea never needs, was never announced.
  const mine = { version: '0.8.0' };
  const patch = islandNotice({ mine, sea: { version: '0.8.0' }, latest: '0.8.1' });
  assert.equal(patch.kind, 'release');
  assert.match(patch.html, /v0\.8\.1 is out - an optional patch/);
  assert.ok(patch.html.includes(RELEASES), 'it says where to get it');
  // A newer line is announced too, without "optional".
  const minor = islandNotice({ mine, latest: '0.9.0' });
  assert.equal(minor.kind, 'release');
  assert.doesNotMatch(minor.html, /optional/);
  // Nothing when it is up to date, ahead (a checkout past the last release), or GitHub is mute.
  assert.equal(islandNotice({ mine, latest: '0.8.0' }), null);
  assert.equal(islandNotice({ mine: { version: '0.8.2' }, latest: '0.8.1' }), null);
  assert.equal(islandNotice({ mine, latest: null }), null);
  assert.equal(islandNotice({ mine: null, latest: '0.8.1' }), null);
  // The sea's news comes first: a newer line on the sea is what keeps what is new from anybody.
  assert.equal(islandNotice({ mine, sea: { version: '0.9.0' }, latest: '0.8.1' }).kind, 'behind');
});

test('the islander asks GitHub at most once an hour and answers from what it heard', async () => {
  let t = 0, calls = 0, answer = { ok: true, json: async () => ({ tag_name: 'v0.8.1' }) };
  const releases = createLatestRelease({ now: () => t, fetchImpl: async () => { calls++; return answer; } });
  assert.equal(releases.latest(), null, 'the first question is not waited on');
  assert.equal(await releases.settled(), '0.8.1');
  assert.equal(calls, 1);
  t += ASK_EVERY_MS - 1;
  assert.equal(releases.latest(), '0.8.1');
  assert.equal(calls, 1, 'asked again within the hour');
  // GitHub out of reach, or answering nonsense, keeps the last good answer.
  t += 1;
  answer = { ok: false, status: 403 };
  assert.equal(await releases.settled(), '0.8.1');
  assert.equal(calls, 2);
  t += ASK_EVERY_MS;
  answer = { ok: true, json: async () => ({ tag_name: 'nightly' }) };
  assert.equal(await releases.settled(), '0.8.1');
});

test('a release that can put the update in place itself offers to, instead of a download', () => {
  // lib/selfupdate.mjs: an unpacked release on Windows. The button is wired in main.js by its data attribute.
  const mine = { version: '0.8.1' };
  const own = islandNotice({ mine, latest: '0.8.2', canInstall: true });
  assert.match(own.html, /data-update-install/);
  assert.match(own.html, /Install v0\.8\.2/);
  assert.doesNotMatch(own.html, /pull and restart/);
  // A checkout (canInstall false) still gets the link and the hint to pull.
  assert.doesNotMatch(islandNotice({ mine, latest: '0.8.2' }).html, /data-update-install/);
  // A newer line on the sea is the same zip: its banner carries the button too.
  assert.match(islandNotice({ mine, sea: { version: '0.9.0' }, latest: '0.9.0', canInstall: true }).html, /data-update-install/);
  // Nothing to install, no button.
  assert.equal(islandNotice({ mine, latest: '0.8.1', canInstall: true }), null);
});
