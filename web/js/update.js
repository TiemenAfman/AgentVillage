// Who is behind: this page or the sea it is in.
//
// Kept DOM-free so tests/update.test.mjs can hold it without a browser. What is compared is
// the release version (package.json's, carried as `build.version`), never the commit: two
// players on the same release are on different commits all the time, and nagging either of
// them would be a banner nobody can make go away. The hard line is still the protocol
// (SEA_PROTOCOL, the page's copy of lib/sea.mjs's SEA_V): a sea on another number refuses
// the handshake, and refusalNotice below says which side has to move.

// The page's copy of SEA_V. Written out twice on purpose - the page may not import lib/ -
// and tests/update.test.mjs holds the two copies together.
export const SEA_PROTOCOL = 3;

// Where a new version is fetched from: the Windows zip and the Android APK both hang off
// the latest release (.github/workflows/release.yml).
export const RELEASES = 'https://github.com/TiemenAfman/AgentVillage/releases/latest';
// The APK itself, by the one URL GitHub keeps stable across releases: `latest/download/<asset>`
// always answers with the newest release's file. In the app a tap on it hands it to the
// phone's browser (web/js/ui.js), which downloads it; the phone installs it from there. The
// app does not fetch and install it itself any more: 0.7.1 to 0.8.1 did, and Play Protect
// blocked the app as harmful for asking to install other apps (REQUEST_INSTALL_PACKAGES).
export const APK_URL = `${RELEASES}/download/promptholm-android.apk`;

// -1 when a is older than b, 1 when newer, 0 when the same, null when either is unknown.
// Numeric per part, so 0.10.0 is newer than 0.9.3.
export function compareVersions(a, b) {
  const parse = (v) => (typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// The same, on the release line only - major.minor. A patch is compatible with the island and
// with the sea by promise (0.4.x runs on any 0.4.y's island and meets it on any sea; CLAUDE.md
// says what that forbids a patch to change), so a patch apart is nothing to tell anybody: it
// is a client-side fix, and a run of them would be a banner a day for everybody on the sea.
export function compareLines(a, b) {
  const line = (v) => (typeof v === 'string' ? v.split('.').slice(0, 2).join('.') : v);
  return compareVersions(line(a), line(b));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A link out of the page. In the Android app there is no second window to open, so a
// plain link is followed and src-android/src/lib.rs hands it to the phone's browser; in a
// browser or the desktop window a new tab (or the system browser, src-tauri) is right.
const link = (text, phone) => `<a href="${RELEASES}"${phone ? '' : ' target="_blank" rel="noopener"'}>${esc(text)}</a>`;

// What to say, or null when there is nothing worth saying. `mine` is this page's build
// ({ version, commit }), `sea` the sea's from its welcome, `phone` whether this is the app.
export function updateNotice({ mine, sea, phone = false }) {
  const order = compareLines(mine && mine.version, sea && sea.version);
  if (order === null || order === 0) return null;
  const me = phone ? 'this app' : 'this island';
  if (order < 0) {
    return {
      kind: 'behind',
      html: `<b>A newer Promptholm is out.</b> The sea runs v${esc(sea.version)} and ${me} v${esc(mine.version)}. `
        + `${link(`Get v${sea.version}`, phone)}${phone ? '' : ', or pull and restart if you run from a checkout'}.`,
    };
  }
  return {
    kind: 'sea-behind',
    html: `<b>The sea is behind.</b> It runs v${esc(sea.version)} and ${me} v${esc(mine.version)}, so what is new `
      + 'in yours may not reach anybody there until whoever keeps the sea updates it.',
  };
}

// The keeper's banner on a desktop island: what the sea says first (updateNotice above - a
// newer line on the sea is the one that matters, since what is new will not reach anybody
// there otherwise), and failing that a newer release on GitHub (`latest`, the islander's
// /api/latest-release, lib/latest-release.mjs). That second one is by the whole version, patch
// included, and says it is optional: the desktop window used to hear about a release only
// through the sea's welcome, by the line, so a patch was never announced at all and a minor
// only once the sea had moved. A checkout is told to pull, a release where to download.
//
// `canInstall` is the islander's word that it can put that release in place itself - an unpacked
// release on Windows (lib/selfupdate.mjs, Plans/zelf-bijwerken.md): then the banner carries an
// Install button (`data-update-install`, wired in main.js) instead of a download link, and the
// same button serves a newer line on the sea, since that is the same zip.
export function islandNotice({ mine = null, sea = null, latest = null, canInstall = false } = {}) {
  const install = canInstall && compareVersions(mine && mine.version, latest) === -1
    ? ` <button type="button" class="update-install" data-update-install>Install v${esc(latest)}</button>` : '';
  const seaSays = updateNotice({ mine, sea });
  if (seaSays) return install && seaSays.kind === 'behind' ? { ...seaSays, html: seaSays.html + install } : seaSays;
  if (compareVersions(mine && mine.version, latest) !== -1) return null;
  const patch = compareLines(mine.version, latest) === 0;
  return {
    kind: 'release',
    html: `<b>Promptholm v${esc(latest)} is out${patch ? ' - an optional patch' : ''}.</b> This island runs `
      + `v${esc(mine.version)}${patch ? ' and keeps working with everybody as it is' : ''}. `
      + (install ? `${link('What is new', false)}.${install}`
        : `${link(`Get v${latest}`, false)}, or pull and restart if you run from a checkout.`),
  };
}

// The app's gate: a whole-screen card with one big button, or null. The banner above is
// right for a desktop island, where "pull and restart" is somebody at a keyboard; on a phone
// that banner was a small box under two others, and a refused app can do nothing else at
// all - it has no island of its own, so a sea that will not have it is an empty screen. So
// a refusal over the protocol is `blocking` (no Later), and a newer release on the same
// protocol is the same card with a Later, since the app still works.
//
// The install hint is for one crossing only. Up to 0.3.1 every release was signed with a
// throwaway key of its own, and Android refuses to install a differently signed APK over
// the old one ("conflicts with an existing package"). From 0.3.2 the release workflow signs
// with one fixed key (the ANDROID_KEYSTORE secret), so coming from 0.3.1 or older needs the
// uninstall once and every update after that installs straight over the top.
//
// `latest` is the newest release on GitHub (src-android/src/lib.rs, latest_release), a bare
// version string. With it the card goes up as soon as there is a release, not only once the
// sea has been updated to it: the sea is behind the releases whenever nobody has got round to
// it yet, and that is no reason for the app to be.
export function updateGate({ speaks = null, mine = null, sea = null, latest = null } = {}) {
  const common = {
    download: APK_URL,
    notes: RELEASES,
    steps: 'Tap the button: your browser downloads the new version. When it is done, tap '
      + '"Open" in the browser (or open promptholm-android.apk from Downloads) and choose Install. '
      + 'The first time, Android asks you to allow your browser to install apps. '
      + 'Coming from v0.3.1 or older, Android may say the app cannot be installed: uninstall this one '
      + 'once and tap the button again. After that, updates install over the top.',
  };
  if (Number.isInteger(speaks) && speaks > SEA_PROTOCOL) {
    return {
      ...common,
      blocking: true,
      title: 'Update Promptholm to keep playing',
      body: 'This sea has moved on to a newer version and will not let this app in until it is updated.',
    };
  }
  // By the whole version, patch included - unlike the banner above. A phone cannot pull; this
  // card is the only way a client-side fix ever reaches it, and it has a Later. Comparing
  // lines here left every 0.x.y release unannounced on the phones it was mostly for.
  const seaAhead = compareVersions(mine && mine.version, sea && sea.version) === -1;
  const releaseAhead = compareVersions(mine && mine.version, latest) === -1;
  if (seaAhead || releaseAhead) {
    // The newer of the two is the one to name; the sea can be ahead of what GitHub said when
    // that answer is older than the sea's last restart.
    const newest = seaAhead && !(releaseAhead && compareVersions(latest, sea.version) === 1) ? sea.version : latest;
    return {
      ...common,
      blocking: false,
      title: `Promptholm v${newest} is out`,
      body: seaAhead
        ? `This app is v${mine.version}. The sea still lets it in, but what is new will not reach you until you update.`
        : `This app is v${mine.version}. It still works as it is; the update brings what is new.`,
    };
  }
  return null;
}

// A handshake refused over the protocol number: `speaks` is what the sea talks.
export function refusalNotice(speaks, { phone = false } = {}) {
  if (!Number.isInteger(speaks) || speaks === SEA_PROTOCOL) {
    return 'This sea speaks a different version of the protocol. One of the two machines needs its code updating.';
  }
  if (speaks > SEA_PROTOCOL) {
    return `<b>This sea has moved on</b> to a newer protocol and will not let ${phone ? 'this app' : 'this island'} in. `
      + `${link('Get the latest Promptholm', phone)}.`;
  }
  return '<b>This sea is behind</b> and speaks an older protocol. It lets nobody on the current version in until '
    + 'whoever keeps it updates it.';
}
