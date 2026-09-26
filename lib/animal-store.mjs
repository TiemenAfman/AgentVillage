// The story animals' journal on disk (docs/animal-story-storage.md).
//
// An explicit directory keeps tests and tooling away from the real island's home: nothing
// here finds DATA by itself, the caller (lib/animal-life.mjs) passes it. The journal is
// authoritative; the checkpoint is disposable. For a cast of six we replay the whole journal on
// open rather than trust a checkpoint that may be stale or damaged - a year of an active island
// is a few thousand lines, which is milliseconds.
import fs from 'node:fs';
import path from 'node:path';
import { emptyAnimalStories, applyAnimalEvent, decideAnimalEvent, entryOf, rulesFor } from './animal-stories.mjs';

// Whether the process that wrote a lock is still there. `kill(pid, 0)` sends nothing and
// only asks; ESRCH is "no such process", EPERM is "exists but not yours", which is alive.
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// `recoverStale`: take over a lock whose writer is provably gone - a pid that no longer runs,
// or a lock file left empty by a crash between creating and writing it and older than a
// minute. Never a live writer's: two writers would each append after the other's last line.
export function openAnimalStore(directory, { rules = rulesFor(1), recoverStale = false } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const journal = path.join(directory, 'animal-events.jsonl');
  const checkpoint = path.join(directory, 'animals.json');
  const lock = path.join(directory, 'animal-store.lock');
  let lockFd;
  const take = () => fs.openSync(lock, 'wx');
  try { lockFd = take(); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let stale = false;
    if (recoverStale) {
      try {
        const raw = fs.readFileSync(lock, 'utf8');
        const pid = raw.trim() ? JSON.parse(raw).pid : null;
        stale = pid == null ? Date.now() - fs.statSync(lock).mtimeMs > 60000 : !alive(pid);
      } catch { stale = false; }
    }
    if (!stale) throw new Error('Animal store is locked; verify its writer has stopped before removing animal-store.lock');
    fs.unlinkSync(lock);
    lockFd = take();
  }
  let state = emptyAnimalStories(), events = [], entries = [], closed = false, poisoned = false;
  const release = () => { fs.closeSync(lockFd); fs.unlinkSync(lock); };
  const remember = (before, e) => { const x = entryOf(e, before); if (x) entries.push(x); };
  try {
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
    const bytes = fs.existsSync(journal) ? fs.readFileSync(journal) : Buffer.alloc(0);
    const end = bytes.lastIndexOf(10) + 1;
    // A newline commits a record. Preserve a torn tail for inspection before truncating;
    // malformed newline-terminated records instead stop recovery without changing disk.
    for (const line of bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(line);
      const before = state;
      state = applyAnimalEvent(state, e);
      events.push(e);
      remember(before, e);
    }
    if (end < bytes.length) {
      fs.writeFileSync(`${journal}.interrupted`, bytes.subarray(end), { flag: 'wx', flush: true });
      fs.truncateSync(journal, end);
    }
  } catch (e) { release(); throw e; }

  const ready = () => {
    if (closed || poisoned) throw new Error('Animal store is closed or needs recovery');
  };
  return {
    // Whether this instance can still take a write: false once an append has failed (it must
    // not append after a line it may have left half-written) and after close. The caller's way
    // back is to close and open again, which replays the journal as far as it is whole.
    healthy: () => !closed && !poisoned,
    snapshot() { ready(); return structuredClone(state); },
    // The state itself, for a caller that only reads. Cheaper than snapshot() on every scan,
    // and the price is a promise: lib/animal-life.mjs never writes into it.
    peek() { ready(); return state; },
    history({ after = 0, limit = 50 } = {}) {
      ready();
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('Invalid animal history page');
      }
      return structuredClone(events.filter((e) => e.seq > after).slice(0, limit));
    },
    // The diary, newest first: everybody's, or one animal's. `before` pages back through it.
    story(animal = null, { before = Infinity, limit = 30 } = {}) {
      ready();
      const n = Math.max(1, Math.min(200, limit | 0 || 30));
      const out = [];
      let more = false;
      for (let i = entries.length - 1; i >= 0; i--) {
        const x = entries[i];
        if (x.seq >= before || (animal && x.animal !== animal)) continue;
        if (out.length >= n) { more = true; break; }
        out.push(x);
      }
      return { entries: structuredClone(out), more };
    },
    dispatch(command, at) {
      ready();
      const event = decideAnimalEvent(state, command, at, rules);
      if (!event) return null;
      const next = applyAnimalEvent(state, event);
      try {
        // flush closes the crash window between acknowledging a memory and putting it
        // on disk. If writing fails, this instance must not append after a partial line.
        fs.appendFileSync(journal, `${JSON.stringify(event)}\n`, { flush: true });
      } catch (e) { poisoned = true; throw e; }
      remember(state, event);
      state = next;
      events.push(event);
      return structuredClone(event);
    },
    checkpoint() {
      ready();
      const temp = `${checkpoint}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify(state)}\n`, { flush: true });
      fs.renameSync(temp, checkpoint);
    },
    close() {
      if (closed) return;
      closed = true;
      release();
    },
  };
}
