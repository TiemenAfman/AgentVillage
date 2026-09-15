import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Refuse to measure while the island is writing. `docs/branches.md` says this in prose and
// it still cost half a day once: serve.mjs rescans every 60 s, so a layout you sampled and a
// layout you compare it to can be two different scans. Worse, stopping the server is not
// enough - the SessionStart/SessionEnd hook in ~/.claude/settings.json runs a scan on every
// Claude session, including the one you are reading this in.
//
// A red test is the only version of this warning that works.
export async function requireIslandStopped(port = 4747) {
  const answered = await new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(300);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
  if (answered) {
    throw new Error(
      `the island server is answering on ${port} - stop it first (stop-island.cmd), or this ` +
      'measures its rescan interleaved with yours');
  }
}

// A scratch data directory, so nothing here can touch the real island. Every module that
// writes reads DATA from lib/paths.mjs, which honours SETTLERS_DATA.
export function scratchData(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `promptholm-${label}-`));
  process.env.SETTLERS_DATA = dir;
  return dir;
}

export function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows may hold a handle */ }
}
