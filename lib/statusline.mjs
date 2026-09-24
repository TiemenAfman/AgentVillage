// Putting hooks/statusline.mjs into ~/.claude/settings.json, and taking it out again.
//
// Pure functions over a settings object, so scripts/setup.mjs does the reading, the backup
// and the writing and tests/statusline.test.mjs can hold every case without going near a
// real settings file.
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
