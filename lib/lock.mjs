// Single-flight guard across processes: the hook and the server may both want to scan.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './paths.mjs';

export function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export async function withScanLock(fn, { file = path.join(DATA, 'scan.lock'), staleMs = 60000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let other = null;
      try { other = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      const fresh = other && Date.now() - (other.at || 0) < staleMs;
      if (fresh && isPidAlive(other.pid)) return { skipped: true, reason: `scan already running (pid ${other.pid})` };
      try { fs.unlinkSync(file); } catch {}
      if (attempt === 1) return { skipped: true, reason: 'could not acquire scan lock' };
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(file); } catch {} }
}
