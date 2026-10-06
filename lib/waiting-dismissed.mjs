// Settlers the keeper has said they will not answer (issue #78, the dossier's Archive).
//
// Not a flag on the settler: a session that is archived out of "waiting for you" comes back
// the moment it says something new. So what is kept is *until when* - the `since` of the turn
// it was waiting on (lib/waiting.mjs, the timestamp of the last turn in its transcript) - and
// a wait whose last turn is newer than that is shown again. A new turn moves `since`, nothing
// else does, so a session that merely stays quiet stays archived.
//
// The word "archived" was already taken on a settler (`b.archived`: the desktop app's own
// archive, which says the session is over), hence "dismissed" in the code and the file.
//
// data/waiting-dismissed.json is `{ v: 1, sessions: { [sessionId]: untilMs } }`, written by
// one door (`dismissWaiting` / `undismissWaiting`, from serve.mjs) and read by the scan.
// Losing it costs nothing but a few flags back on the island.
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';

export const DISMISSED_FILE = path.join(DATA, 'waiting-dismissed.json');

export function readDismissed(file = DISMISSED_FILE) {
  const o = readJson(file, null);
  const out = new Map();
  const sessions = o && typeof o === 'object' && o.sessions && typeof o.sessions === 'object' ? o.sessions : {};
  for (const [sid, until] of Object.entries(sessions)) {
    if (Number.isFinite(until)) out.set(sid, until);
  }
  return out;
}

function save(map, file) {
  writeJsonAtomic(file, { v: 1, sessions: Object.fromEntries(map) });
}

// `until` is the wait's own `since`; with none known (a wait from a transcript with no
// timestamp), now - anything said after the click brings it back.
export function dismissWaiting(sessionId, until, { file = DISMISSED_FILE, now = Date.now() } = {}) {
  const map = readDismissed(file);
  map.set(String(sessionId), Number.isFinite(until) ? until : now);
  save(map, file);
  return map.get(String(sessionId));
}

export function undismissWaiting(sessionId, { file = DISMISSED_FILE } = {}) {
  const map = readDismissed(file);
  if (!map.delete(String(sessionId))) return;
  save(map, file);
}

// The one reading: is this wait one the keeper has already put away? A wait with no `since`
// cannot be told from a newer one, so it stays put away as long as there is an entry.
export function isDismissed(dismissed, sessionId, wait) {
  if (!dismissed || !wait) return false;
  const until = dismissed.get(sessionId);
  if (!Number.isFinite(until)) return false;
  return !Number.isFinite(wait.since) || wait.since <= until;
}
