// What a visitor did to their own island while they were standing on somebody else's.
//
// The host's side of the journey home. A visitor's island is parked at
// data/guests/<id>/island.json (lib/guests.mjs) and, while the visit lasts, they can
// change things on it from here: plant a bed, pull one, put a bench on their own quay.
// Those changes have to reach home, and this is the record of them.
//
// It is an append-only log of OPERATIONS, never a snapshot of state, and that choice is
// the whole of the conflict resolution. A snapshot of the purse would clobber whatever
// the gardener at home did in the meantime; `buy` and `sell` travelling as themselves
// merge with it, because the mutator at the other end does its own affordability check.
// You cannot spend the same coin twice at home, and nothing here pretends otherwise.
//
// WHY the set of ops below is this short, and hard-coded rather than derived: scan.mjs is
// the only writer of village.json and layout.json, and it builds them out of Claude
// transcripts that exist only on the owner's machine. A host can therefore never produce
// a newer village or a newer layout - it can only hold the copy it was handed, and
// layout.json does not travel in either direction (lib/islandbundle.mjs says so at
// length). So `layout.*` and `village.*` are deliberately NOT expressible here. There is
// no op that names them, no escape hatch that would let one be spelled, and an unknown op
// throws rather than being ignored - because an op that is silently dropped is a change a
// visitor believes they made. A house never moves, and this file is one of the reasons.
//
// jsonl and not JSON: this is appended to while somebody else may be reading it, and one
// line is one accepted mutation. writeJsonAtomic's tmp+rename would rewrite the whole
// file on every prop somebody puts down, which is both the wrong cost and the wrong
// promise - a torn *last line* is recoverable (skip it), a torn file is not.
import fs from 'node:fs';
import path from 'node:path';

// The allowlist, in the island's own words. `build`/`unbuild` are props.mjs; `sow`,
// `harvest` and `dig` are the three things that happen to a bed; `buy` and `sell` are the
// stall. Seven, and adding an eighth is meant to be a deliberate edit to this line.
export const JOURNAL_OPS = Object.freeze(['build', 'unbuild', 'sow', 'harvest', 'dig', 'buy', 'sell']);
const ALLOWED = new Set(JOURNAL_OPS);

export const JOURNAL_FILE = 'journal.jsonl';

// A payload is a small flat bag of values handed to a mutator, not a document. The cap is
// generous next to a bed (six numbers and a kind) and far under anything that would make
// a line awkward to read back.
const MAX_PAYLOAD_BYTES = 4096;
// `__proto__` and friends, for the same reason lib/islandbundle.mjs refuses them: every
// key this file writes is a literal, so they cannot reach an output object anyway. This is
// the belt, and it makes a probe a refusal rather than something to discover by other
// means.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function refusePayload(node, depth = 0) {
  if (depth > 4) throw new Error('a payload is a bag of values, not a document');
  if (Array.isArray(node)) {
    for (const item of node) refusePayload(item, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`a payload carrying a "${key}" key is not a payload`);
    refusePayload(node[key], depth + 1);
  }
}

// One line of the log, built field by field out of a whitelist - never spread from what
// the caller handed over. The same rule lib/islandbundle.mjs works by, and for the same
// reason: a field this file has never heard of cannot reach anybody's disk.
function entryOf(seq, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('that is not an operation');
  const op = String(raw.op || '');
  if (!ALLOWED.has(op)) {
    throw new Error(`"${op.slice(0, 32)}" is not something a visit can do; a visit does ${JOURNAL_OPS.join(', ')} and nothing else`);
  }
  const payload = raw.payload === undefined || raw.payload === null ? {} : raw.payload;
  if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error('a payload is an object');
  refusePayload(payload);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error(`that payload is ${Buffer.byteLength(body, 'utf8')} bytes and an operation carries ${MAX_PAYLOAD_BYTES}`);
  }
  return {
    seq,
    at: new Date().toISOString(),
    op,
    by: raw.by === null || raw.by === undefined ? null : String(raw.by).slice(0, 40),
    payload: JSON.parse(body),
  };
}

// Reads what is already there and hands back the highest seq in it. Resumed from the file
// rather than kept in a variable somewhere, because the server it runs in restarts and the
// visitor's own bookmark (lib/visits.mjs) is a number they will send back afterwards: if
// the counter began again at 1 after a restart, every line the visitor had already applied
// would look new and every line they had not would look old.
function readAll(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let row;
    // A half-written last line is the one failure appending can leave behind, and
    // skipping it is the whole recovery. Anything earlier that does not parse is not a
    // line this file wrote.
    try { row = JSON.parse(s); } catch { continue; }
    if (!row || typeof row !== 'object' || !Number.isFinite(row.seq) || !ALLOWED.has(row.op)) continue;
    out.push(row);
  }
  return out;
}

// `dir` is the berth: data/guests/<id>/, so a visitor's journal lives beside the island it
// is about and is swept with it when createGuests() clears the harbour at boot. A visit
// that is over leaves nothing behind, which is the same promise the berth itself makes.
export function createJournal({ dir } = {}) {
  if (typeof dir !== 'string' || !dir) throw new Error('a journal needs a directory to live in');
  const root = path.resolve(dir);
  const file = path.join(root, JOURNAL_FILE);

  const rows = readAll(file);
  let last = 0;
  for (const row of rows) if (row.seq > last) last = row.seq;

  function append(op) {
    const entry = entryOf(last + 1, op);
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
    // Only after the write. A seq handed out for a line that never reached the disk would
    // leave a permanent hole, and the visitor's `since` would step straight over the next
    // real line.
    last = entry.seq;
    return entry;
  }

  // Everything after the visitor's bookmark, oldest first. Read off disk each time rather
  // than served from memory: the berth is on disk, this is a poll every few seconds, and a
  // journal is at most a few hundred short lines.
  function since(seq = 0) {
    const from = Number.isFinite(Number(seq)) ? Math.max(0, Math.floor(Number(seq))) : 0;
    return readAll(file).filter((row) => row.seq > from).sort((a, b) => a.seq - b.seq);
  }

  return { append, since, seq: () => last, file, dir: root };
}
