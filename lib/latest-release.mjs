// The newest Promptholm on GitHub, as the islander last heard it - for the keeper's "a newer
// release is out" banner (web/js/update.js, releaseNotice).
//
// The desktop window had no way to hear about a release at all: its banner compares lines with
// the *sea*, so a patch (which the sea never needs) said nothing, and a minor said nothing until
// whoever keeps the sea had updated it. The phone asks GitHub itself (src-android/src/lib.rs,
// latest_release); the desktop page cannot, because it lives on http://localhost and is meant
// to reach nothing it has not named (web/js/api.js), so the islander asks for it, the same
// question the phone asks.
//
// At most once an hour, in the background: GitHub allows sixty unauthenticated calls an hour
// per address, and a page's question is answered from what was last heard, never waited on.
// Out of reach is null and nothing is said; a version that does not parse is null too.

export const LATEST_API = 'https://api.github.com/repos/TiemenAfman/AgentVillage/releases/latest';
export const ASK_EVERY_MS = 3600e3;
const TIMEOUT_MS = 8000;

const VERSION = /^\d+(\.\d+)*$/;

// `fetchImpl` and `now` are for tests. The first `latest()` starts a question and answers
// null; every later one answers what was heard, and starts a new question once the last is an
// hour old.
export function createLatestRelease({ fetchImpl = globalThis.fetch, now = Date.now, log = () => {} } = {}) {
  let version = null;
  let askedAt = -Infinity;
  let asking = null;

  async function ask() {
    askedAt = now();
    try {
      const res = await fetchImpl(LATEST_API, {
        headers: { 'User-Agent': 'promptholm-island', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) { log(`latest release: GitHub answered ${res.status}`); return; }
      const body = await res.json();
      const tag = String((body && body.tag_name) || '').replace(/^v/, '');
      if (VERSION.test(tag)) version = tag;
    } catch (e) {
      log(`latest release: ${e && e.message ? e.message : e}`);
    } finally {
      asking = null;
    }
  }

  function latest() {
    if (!asking && now() - askedAt >= ASK_EVERY_MS) asking = ask();
    return version;
  }
  // For a test, or a caller that can afford to wait for the first answer.
  async function settled() { latest(); if (asking) await asking; return version; }

  return { latest, settled };
}
