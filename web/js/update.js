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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A link out of the page. In the Android app there is no second window to open, so a
// plain link is followed and src-android/src/lib.rs hands it to the phone's browser; in a
// browser or the desktop window a new tab (or the system browser, src-tauri) is right.
const link = (text, phone) => `<a href="${RELEASES}"${phone ? '' : ' target="_blank" rel="noopener"'}>${esc(text)}</a>`;

// What to say, or null when there is nothing worth saying. `mine` is this page's build
// ({ version, commit }), `sea` the sea's from its welcome, `phone` whether this is the app.
export function updateNotice({ mine, sea, phone = false }) {
  const order = compareVersions(mine && mine.version, sea && sea.version);
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
