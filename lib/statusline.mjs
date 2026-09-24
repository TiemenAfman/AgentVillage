// Putting hooks/statusline.mjs into ~/.claude/settings.json, and taking it out again.
//
// Pure functions over a settings object, so scripts/setup.mjs does the reading, the backup
// and the writing and tests/goldpit.test.mjs can hold every case without going near a real
// settings file - and `ensureStatusLine` at the bottom, the one that does touch the file,
// which the islander runs on its own at startup so nobody has to.
//
// There is only one `statusLine`, and somebody may already have one. Replacing it would be
// taking away a thing they built; leaving the island without one would leave the gold pit
// without a reading. So a status line that is already there is put *behind* ours in a pipe:
//
//   node ".../hooks/statusline.mjs" --pass | <whatever they had>
//
// --pass writes the reading down and hands stdin on untouched, so their line still gets the
// exact JSON it always got and still prints exactly what it printed. A pipe reads the same
// in Git Bash, which is what Claude Code runs a command in on Windows, and in cmd. Taking
// the island back out peels the prefix off and leaves their command as it was.

import fs from 'node:fs';
import path from 'node:path';

// Ours, bare or in front of somebody else's. The path is matched by its tail rather than in
// full so that a checkout that moved, or a release unpacked somewhere new, still recognises
// the entry an older one wrote - and replaces it instead of wrapping it a second time.
const OURS = /^\s*node\s+"([^"]*hooks\/statusline\.mjs)"\s*(?:--pass\s*\|\s*([\s\S]*?))?\s*$/;

export function statusLineCommand(scriptPath) {
  // Forward slashes on purpose, as for the session hook: the command runs through Git Bash.
  return `node "${String(scriptPath).replace(/\\/g, '/')}"`;
}

// What an existing statusLine entry is, as far as the island is concerned:
//   { ours: false }                         somebody else's, or none
//   { ours: true, wraps: null }             ours on its own
//   { ours: true, wraps: '<their command>' } ours in front of theirs
export function readStatusLine(sl) {
  if (!sl || typeof sl !== 'object' || sl.type !== 'command' || typeof sl.command !== 'string') return { ours: false };
  const m = OURS.exec(sl.command);
  if (!m) return { ours: false };
  return { ours: true, wraps: m[2] ? m[2] : null };
}

// Install. Returns the new settings (a copy; the one handed in is left alone) and what was
// done, for setup to say out loud: 'added', 'wrapped', 'updated', 'unchanged', or 'kept' for
// a status line that is not a command and so has nothing a pipe can be put in front of.
export function installStatusLine(settings, scriptPath) {
  const out = { ...(settings || {}) };
  const ours = statusLineCommand(scriptPath);
  const sl = out.statusLine;
  if (!sl) {
    out.statusLine = { type: 'command', command: ours, padding: 0 };
    return { settings: out, did: 'added' };
  }
  if (typeof sl !== 'object' || sl.type !== 'command' || typeof sl.command !== 'string' || !sl.command.trim()) {
    return { settings: out, did: 'kept' };
  }
  const now = readStatusLine(sl);
  const command = now.ours
    ? (now.wraps ? `${ours} --pass | ${now.wraps}` : ours)
    : `${ours} --pass | ${sl.command.trim()}`;
  if (command === sl.command) return { settings: out, did: 'unchanged' };
  // Every other field they set - padding, a refresh interval - stays exactly as it was.
  out.statusLine = { ...sl, command };
  return { settings: out, did: now.ours ? 'updated' : 'wrapped' };
}

// Uninstall: ours on its own goes entirely, ours in front of theirs gives theirs back.
// Returns { settings, did: 'removed' | 'unwrapped' | 'absent' }.
export function uninstallStatusLine(settings) {
  const out = { ...(settings || {}) };
  const now = readStatusLine(out.statusLine);
  if (!now.ours) return { settings: out, did: 'absent' };
  if (now.wraps) {
    out.statusLine = { ...out.statusLine, command: now.wraps };
    return { settings: out, did: 'unwrapped' };
  }
  delete out.statusLine;
  return { settings: out, did: 'removed' };
}

// The islander puts the status line in by itself, so there is nothing to run by hand: serve.mjs
// calls this on every start, and it acts once per island. `markerFile` (data/statusline.json)
// is where it writes down that it did - and after that it never touches settings.json again,
// because somebody who takes the line out afterwards has said no, and a line that came back
// on every start would be arguing with them. The same bargain as the fairway's `{ cells: [] }`:
// "asked, and the answer stands" is kept apart from "never asked".
//
// A settings.json that exists but does not parse is left exactly as it is and nothing is
// written down, so the next start tries again once it has been fixed; overwriting it would
// throw away every other setting in it. The file is backed up beside itself before it is
// rewritten, like scripts/setup.mjs does. Returns what happened, for the log:
// { did: 'added' | 'wrapped' | 'updated' | 'unchanged' | 'kept' | 'asked-before' | 'unreadable' }.
export function ensureStatusLine({ settingsFile, script, markerFile, now = Date.now() } = {}) {
  let marker = null;
  try { marker = JSON.parse(fs.readFileSync(markerFile, 'utf8')); } catch { /* never asked */ }
  if (marker && marker.asked) return { did: 'asked-before' };

  let raw = null;
  try { raw = fs.readFileSync(settingsFile, 'utf8'); } catch { /* no settings.json yet: we make one */ }
  let settings = {};
  if (raw !== null && raw.trim()) {
    try { settings = JSON.parse(raw); } catch { return { did: 'unreadable' }; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { did: 'unreadable' };
  }

  const { settings: next, did } = installStatusLine(settings, script);
  if (did === 'added' || did === 'wrapped' || did === 'updated') {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    if (raw !== null) fs.writeFileSync(`${settingsFile}.${new Date(now).toISOString().replace(/[:.]/g, '-')}.bak`, raw);
    const tmp = `${settingsFile}.promptholm.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, settingsFile);
  }
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, `${JSON.stringify({ asked: true, did, at: new Date(now).toISOString() }, null, 2)}\n`);
  return { did, command: next.statusLine && next.statusLine.command };
}

