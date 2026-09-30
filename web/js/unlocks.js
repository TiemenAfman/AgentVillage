// What this browser's player has unlocked: the ids the quests hand out (shared/quests.mjs
// `grant.unlock`) and the inventory's locked tiles ask about (studio.js). Per browser and
// nothing else - like the avatar's own look it is decor, so it is not on the island, not on
// the sea and not worth an account: `promptholm.unlocks`.
//
// The page has to work without storage (a private window, storage switched off, a quota that
// is full), so nothing here may throw and nothing may depend on the write having worked: what
// was unlocked this session is kept in memory as well and the two are read as one set.
// Broken content is an empty set, and so is content written by a version that knows more than
// this one (`v` above VERSION) - which is then left as it is instead of being overwritten by
// a shorter list, since the newer page still needs it.
const KEY = 'promptholm.unlocks';
const VERSION = 1;

const memory = new Set();       // unlocked this session, whether or not the write succeeded
const listeners = new Set();
let readOnly = false;           // storage holds a newer format: read nothing, write nothing

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

function read() {
  readOnly = false;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.ids)) return new Set();
    if (typeof data.v === 'number' && data.v > VERSION) { readOnly = true; return new Set(); }
    return new Set(data.ids.filter(isId));
  } catch {
    return new Set();   // no storage, or nonsense in it
  }
}

function write(ids) {
  if (readOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, ids: [...ids] })); } catch { /* kept in memory */ }
}

// Read again on every question rather than cached for the page's life: a second tab may have
// unlocked something, and the questions are asked when a picker opens, not per frame.
function all() {
  return new Set([...read(), ...memory]);
}

export const isUnlocked = (id) => isId(id) && all().has(id);

// Every id owned, as a fresh array.
export const unlocked = () => [...all()];

// Unlock `id`. True when it is new - the caller's cue for a toast - and false for something
// already owned or not an id at all. Listeners hear only a new one.
export function unlock(id) {
  if (!isId(id)) return false;
  const have = all();
  if (have.has(id)) return false;
  memory.add(id);
  have.add(id);
  write(have);
  for (const cb of [...listeners]) {
    try { cb(id); } catch { /* one listener's fault is not another's */ }
  }
  return true;
}

// `cb(id)` on every new unlock; returns the function that stops it.
export function onUnlock(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// For tests: forget what this session unlocked and every listener. Storage is the test's own.
export function resetUnlocks() {
  memory.clear();
  listeners.clear();
  readOnly = false;
}
