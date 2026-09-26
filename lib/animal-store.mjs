// An explicit directory keeps tests and tooling away from the real island's home.
// The journal is authoritative; the checkpoint is disposable. For this first small
// cast we replay the whole journal, avoiding trust in a stale or corrupted checkpoint.
import fs from 'node:fs';
import path from 'node:path';
import { emptyAnimalStories, applyAnimalEvent, decideAnimalEvent } from './animal-stories.mjs';

export function openAnimalStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const journal = path.join(directory, 'animal-events.jsonl');
  const checkpoint = path.join(directory, 'animals.json');
  const lock = path.join(directory, 'animal-store.lock');
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); }
  catch (e) {
    if (e.code === 'EEXIST') throw new Error('Animal store is locked; verify its writer has stopped before removing animal-store.lock');
    throw e;
  }
  let state = emptyAnimalStories(), events = [], closed = false, poisoned = false;
  const release = () => { fs.closeSync(lockFd); fs.unlinkSync(lock); };
  try {
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
    const bytes = fs.existsSync(journal) ? fs.readFileSync(journal) : Buffer.alloc(0);
    const end = bytes.lastIndexOf(10) + 1;
    // A newline commits a record. Preserve a torn tail for inspection before truncating;
    // malformed newline-terminated records instead stop recovery without changing disk.
    for (const line of bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)) {
      const e = JSON.parse(line);
      state = applyAnimalEvent(state, e);
      events.push(e);
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
    snapshot() { ready(); return structuredClone(state); },
    history({ after = 0, limit = 50 } = {}) {
      ready();
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new Error('Invalid animal history page');
      }
      return structuredClone(events.filter((e) => e.seq > after).slice(0, limit));
    },
    dispatch(command, at) {
      ready();
      const event = decideAnimalEvent(state, command, at);
      if (!event) return null;
      const next = applyAnimalEvent(state, event);
      try {
        // flush closes the crash window between acknowledging a memory and putting it
        // on disk. If writing fails, this instance must not append after a partial line.
        fs.appendFileSync(journal, `${JSON.stringify(event)}\n`, { flush: true });
      } catch (e) { poisoned = true; throw e; }
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
