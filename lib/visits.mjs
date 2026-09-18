// The journey home: the visitor's side of a visit.
//
// While a visit lasts, somebody is standing on a host's island changing things on their
// OWN island, and the host is writing those changes down (lib/journal.mjs). This is the
// loop that runs on the guest's own machine and brings them back.
//
// PULL, NOT PUSH, and that is the whole security story. The write happens on the machine
// that owns the file, through the same mutators the island's own buttons go through -
// which already validate, already cap, already refuse what will not fit - and nothing on
// the host ever needs a way to reach into the guest's machine. The host publishes a log
// over HTTP and the guest decides, on its own schedule, whether to replay it. There is no
// inbound route here, no listening socket, and no credential the host holds.
//
// WHAT CAN TRAVEL, and why it is only this: scan.mjs is the only writer of village.json
// and layout.json, and it builds them out of Claude transcripts that exist only on the
// owner's machine. The host can therefore never produce a newer village or a newer
// layout - it can only hold the copy it was handed - and data/layout.json never travels
// in either direction (lib/islandbundle.mjs). So the only state a visit can change is
// data/props.json (hand-placed scenery) and data/garden.json (the purse, the seed pouch
// and the beds), which are exactly the two files the scanner never touches. That is the
// entire design, and everything below is bookkeeping around it.
//
// AN OPERATION LOG, NOT A STATE SNAPSHOT. A snapshot of the purse would clobber whatever
// the gardener at home did while the visitor was away. `buy` and `sell` travel; the
// resulting balance does not. Each mutator does its own affordability check, so what is no
// longer affordable at home is SKIPPED AND REPORTED rather than forced, and the purse
// cannot be driven negative by anything that happened somewhere else. That is the whole of
// the conflict resolution, and it is honest: you cannot spend the same coin twice at home.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';
import { addProp, removeProp } from './props.mjs';
import { plantBed, harvestBed, digUpBed, buySeed, sellCrop } from './garden.mjs';
import { JOURNAL_OPS } from './journal.mjs';

// The same seven words lib/journal.mjs will accept, checked again on this side. Not
// because the host is expected to lie - because the host is *allowed* to lie, and this is
// the machine whose files are at stake. `layout.*` and `village.*` are not on the list and
// cannot be spelled: there is no key here they would match.
const ALLOWED = new Set(JOURNAL_OPS);

// How often the loop asks, when it is running. Slow on purpose: a visit is somebody
// wandering about, not a stream, and the host is answering this over a LAN it did not
// invite us onto.
export const PULL_MS = 4000;
// One answer's worth. A journal longer than this is not refused, it is taken a slice at a
// time - `since` advances with each slice, so the next ask picks up where this one left.
export const MAX_LINES = 500;
const FETCH_TIMEOUT_MS = 8000;

// A host as a filename. `<host>:<port>` is what a visitor types and what the beacon shows,
// and this is the only place it becomes a path, so it is the only place that has to be
// careful. Anything outside the class is replaced rather than rejected, and the result is
// asserted to resolve inside the visits directory - the same belt-and-braces berthDirFor()
// wears in lib/guests.mjs, and for the same reason.
export function hostIdFor(host, port) {
  const h = String(host || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const p = Math.max(0, Math.min(65535, Math.round(Number(port) || 0)));
  if (!h) throw new Error('a visit needs a host to come home from');
  return `${h}-${p}`;
}

function stateFileFor(dir, hostId) {
  const base = path.resolve(dir, 'visits');
  const file = path.resolve(base, `${hostId}.json`);
  if (!file.startsWith(base + path.sep)) throw new Error('that is not a host');
  return file;
}

// Where the host publishes its side. One function, and the request is one function below
// it, so a test can stub the whole of the network with `fetchImpl`.
export function journalUrl({ host, port, islandId, since = 0 }) {
  const u = new URL(`http://${host}:${Math.round(Number(port) || 0)}/api/island-journal`);
  u.searchParams.set('island', String(islandId));
  u.searchParams.set('since', String(Math.max(0, Math.floor(Number(since) || 0))));
  return u.toString();
}

// The only place this module touches the network. `fetchImpl` defaults to Node 22's own
// global fetch - no dependency, and nothing to vendor.
export async function fetchJournal({ host, port, islandId, since = 0, fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const url = journalUrl({ host, port, islandId, since });
  const stop = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetchImpl(url, { signal: stop, headers: { accept: 'application/json' } });
  if (!res || !res.ok) throw new Error(`the host answered ${res ? res.status : 'nothing'} for the journal`);
  const body = await res.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('that is not a journal');
  return body;
}

// ---- replaying ----------------------------------------------------------------------
// Each op named once, next to the local mutator it runs through. There is no lookup by
// string anywhere else in this file, so an op nobody wrote a line for here does not exist.
//
// Idempotency, honestly, per op:
//   unbuild, harvest, dig  - keyed on an id. removeProp returns null for an id that has
//        already gone (lib/props.mjs:86-93) and the two bed calls throw "there is no bed
//        there", which lands in `skipped`. Replaying these is free.
//   build, sow             - NOT idempotent on their own: addProp and plantBed mint a new
//        id every call, so a forced second apply would put down a second bench. What
//        makes them safe is the bookmark: a line whose seq is at or below `since` is never
//        handed to a mutator at all, and `since` only ever moves forward. That is the
//        mechanism, not a happy accident, which is why it is asserted in the tests.
//   buy, sell              - deltas, and deltas are never idempotent. Same bookmark, same
//        reason; and when they cannot be afforded they are skipped rather than forced.
//
// THE ID TRANSLATION, which is the one thing that is not obvious. addProp and plantBed
// mint an id of their own (`prop:1a2b3c4d`, `bed:9f8e7d6c`) and there is no way to ask
// them for a particular one - deliberately, since an id off a wire choosing its own name
// on this disk is how two things end up called the same thing. So the bench the host
// wrote down is NOT the bench that appears here, and an `unbuild` carrying the host's id
// would find nothing and quietly leave the bench standing forever.
//
// A table from the host's id to the local one, kept in the bookmark file beside `since`,
// is what closes that. `build` and `sow` record the pair; `unbuild`, `harvest` and `dig`
// look it up and fall back to the id as given - which is right for a prop that was already
// at home before the visit, whose id is the same on both sides because the host got it
// from this island's own bundle.
const APPLY = {
  build: (payload, o) => addProp(payload, o.props),
  unbuild: (payload, o) => removeProp(o.localId(payload.id), o.props),
  sow: (payload, o) => plantBed(payload, o.garden),
  harvest: (payload, o) => harvestBed(o.localId(payload.id), o.garden),
  dig: (payload, o) => digUpBed(o.localId(payload.id), o.garden),
  buy: (payload, o) => buySeed(payload.kind, payload.count == null ? 1 : payload.count, o.garden),
  sell: (payload, o) => sellCrop(payload.kind, payload.count == null ? 'all' : payload.count, o.garden),
};

// What a mutator minted, for the table. Only the two that mint anything answer.
function mintedBy(op, result) {
  if (op === 'build') return result && result.id ? result.id : null;
  if (op === 'sow') return result && result.bed && result.bed.id ? result.bed.id : null;
  return null;
}

// An island carries at most 500 props (lib/props.mjs) and 80 beds (shared/crops.mjs), so
// a visit cannot honestly need more pairs than this. The cap is a bound on a file that is
// written on every poll, not a second opinion about how long a visit may last.
const MAX_IDS = 1000;

function parseLine(line) {
  if (typeof line === 'string') {
    const s = line.trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { throw new Error('a journal line that is not a line'); }
  }
  if (!line || typeof line !== 'object' || Array.isArray(line)) throw new Error('a journal line that is not a line');
  return line;
}

// Strings, an array of entries, or one newline-separated blob - whichever the caller has.
function linesOf(lines) {
  const raw = typeof lines === 'string' ? lines.split('\n') : (Array.isArray(lines) ? lines : []);
  const out = [];
  for (const line of raw) {
    const row = parseLine(line);
    if (row) out.push(row);
  }
  return out;
}

/**
 * A live visit, from this machine's point of view.
 *
 *   host, port  - where the visit is happening.
 *   islandId    - which island in that harbour is ours. It is the beacon id, so it is the
 *                 same string lib/guests.mjs uses for the berth.
 *   dir         - the data directory this island keeps its files in. Everything else is
 *                 derived from it, so a test points this at a temp folder and the real
 *                 data/ is never touched.
 */
export function createVisit({
  host,
  port,
  islandId,
  dir = DATA,
  propsFile = null,
  gardenFile = null,
  // Extra options handed to every garden / props mutator. Only a test or an island whose
  // layout is not the one under data/ needs these; the defaults are this island.
  garden: gardenOpts = {},
  props: propsOpts = {},
  fetchImpl = globalThis.fetch,
  intervalMs = PULL_MS,
  log = () => {},
} = {}) {
  if (typeof islandId !== 'string' || !islandId) throw new Error('a visit needs to know which island is ours');
  const hostId = hostIdFor(host, port);
  const root = path.resolve(dir);
  const stateFile = stateFileFor(root, hostId);
  const files = {
    props: propsFile || path.join(root, 'props.json'),
    garden: gardenFile || path.join(root, 'garden.json'),
  };
  const options = {
    props: { file: files.props, ...propsOpts },
    garden: { file: files.garden, ...gardenOpts },
    localId: (id) => {
      const theirs = String(id == null ? '' : id);
      return Object.prototype.hasOwnProperty.call(state.ids, theirs) ? state.ids[theirs] : theirs;
    },
  };

  // The bookmark. Kept on disk so that a crash resumes instead of replaying: `since` is
  // the last seq this machine has actually applied, and every line at or below it is
  // already in props.json and garden.json. Losing it would not corrupt anything the host
  // can see - it would silently plant a second row of turnips here.
  function load() {
    const on = readJson(stateFile, null);
    const startedAt = (on && typeof on.startedAt === 'string') ? on.startedAt : new Date().toISOString();
    return {
      hostId,
      islandId: (on && typeof on.islandId === 'string') ? on.islandId : String(islandId),
      since: (on && Number.isFinite(Number(on.since))) ? Math.max(0, Math.floor(Number(on.since))) : 0,
      startedAt,
      // Names the pair of before-copies below. Derived from the bookmark rather than made
      // fresh each call, so a resumed visit keeps pointing at the undo it already wrote.
      visitId: (on && typeof on.visitId === 'string' && on.visitId) ? on.visitId : `${hostId}-${startedAt.replace(/[^0-9]/g, '').slice(0, 14)}`,
      // Built with no prototype, because the keys are ids off a wire and one of them
      // being `__proto__` should be a dead entry in a table rather than a surprise.
      ids: ids(on && on.ids),
    };
  }

  function ids(on) {
    const out = Object.create(null);
    if (!on || typeof on !== 'object' || Array.isArray(on)) return out;
    let n = 0;
    for (const [k, v] of Object.entries(on)) {
      if (typeof v !== 'string' || ++n > MAX_IDS) continue;
      out[k] = v;
    }
    return out;
  }

  let state = load();
  // A visit that has already applied something has already written its before-copies; one
  // that has not will write them before it touches anything.
  let copied = state.since > 0;
  let timer = null;
  let busy = false;

  function persist() {
    writeJsonAtomic(stateFile, {
      hostId: state.hostId,
      islandId: state.islandId,
      since: state.since,
      startedAt: state.startedAt,
      visitId: state.visitId,
      ids: { ...state.ids },
    }, { pretty: true });
  }

  // Both files are small - a few hundred props and eighty beds at the outside - so one
  // copy of each is a whole undo, and taking it costs nothing next to the reassurance. It
  // is taken ONCE, before the first line of a visit is applied, and not per line: the
  // point is "put my island back the way it was before I sailed", not a per-step history.
  function copyBefore() {
    if (copied) return;
    fs.mkdirSync(root, { recursive: true });
    for (const [what, from] of Object.entries(files)) {
      const to = path.join(root, `${what}.before-${state.visitId}.json`);
      // A garden nobody has opened yet has no file, and `{}` is an honest record of that:
      // restoring it gives back the same empty-handed garden readGarden() invents.
      const body = fs.existsSync(from) ? fs.readFileSync(from, 'utf8') : '{}';
      fs.writeFileSync(to, body);
    }
    copied = true;
  }

  /**
   * Replay a slice of the host's journal against THIS island's own files.
   *
   * `meta` is whatever envelope the lines arrived in (fetchJournal's answer, say). Two
   * things in it are checked rather than trusted: the host id, because a journal from a
   * different host replayed against this bookmark would apply somebody else's operations
   * with our numbering; and `since`, because a bookmark that goes backwards is either a
   * host that restarted its counter or one that is trying to make us replay a purchase.
   *
   * Returns { applied, skipped, since } - never throws for an operation that merely could
   * not be afforded. It throws only for the three structural refusals: a host that is not
   * ours, a journal that goes backwards, and an op that is not on the allowlist.
   */
  function applyLines(lines, meta = {}) {
    const rows = linesOf(lines);

    if (meta && meta.hostId != null && String(meta.hostId) !== state.hostId) {
      throw new Error(`that journal comes from ${String(meta.hostId).slice(0, 48)} and this visit is to ${state.hostId}`);
    }
    if (meta && meta.since != null) {
      const theirs = Math.floor(Number(meta.since));
      if (!Number.isFinite(theirs) || theirs < state.since) {
        throw new Error(`that journal starts at ${meta.since} and this island is already at ${state.since}: a bookmark does not go backwards`);
      }
    }

    // Structural checks over the whole slice BEFORE anything is written, so a bad line
    // halfway down does not leave the island half-visited.
    let walk = -Infinity;
    for (const row of rows) {
      if (row.hostId != null && String(row.hostId) !== state.hostId) {
        throw new Error(`a journal line claims to come from ${String(row.hostId).slice(0, 48)}`);
      }
      const seq = Number(row.seq);
      if (!Number.isFinite(seq) || Math.floor(seq) !== seq || seq < 1) throw new Error('a journal line without a sequence number');
      if (seq <= walk) throw new Error(`journal line ${seq} came after ${walk}: a journal does not go backwards`);
      walk = seq;
      const op = String(row.op || '');
      if (!ALLOWED.has(op)) {
        // Named in the refusal on purpose. `layout.move`, `village.rebuild` and anything
        // else of that shape land here, and a visitor who gets this message learns that
        // the answer is no rather than that nothing happened.
        throw new Error(`"${op.slice(0, 32)}" is not something a visit can bring home; a visit brings home ${JOURNAL_OPS.join(', ')} and nothing else`);
      }
      if (row.payload != null && (typeof row.payload !== 'object' || Array.isArray(row.payload))) {
        throw new Error(`journal line ${seq} carries a payload that is not an object`);
      }
    }
    if (rows.length > MAX_LINES) throw new Error(`${rows.length} lines is more than the ${MAX_LINES} a visit brings home at once`);

    const applied = [];
    const skipped = [];
    for (const row of rows) {
      const seq = Number(row.seq);
      // Already home. This is what makes a replayed journal a no-op, and it is the only
      // thing that makes `build`, `sow`, `buy` and `sell` safe to see twice.
      if (seq <= state.since) { skipped.push({ seq, op: row.op, why: 'already home' }); continue; }
      copyBefore();
      const payload = row.payload || {};
      try {
        const result = APPLY[row.op](payload, options);
        const mine = mintedBy(row.op, result);
        if (mine && payload.id && Object.keys(state.ids).length < MAX_IDS) state.ids[String(payload.id)] = mine;
        // removeProp answers null for something that was not there, which is a no-op and
        // not a failure - the island is in the state the line asked for either way.
        applied.push({ seq, op: row.op, result: result === undefined ? null : result });
      } catch (e) {
        // The affordability case, and every other refusal the local mutator makes. It is
        // reported and stepped over, never forced: the purse at home is the purse at home.
        skipped.push({ seq, op: row.op, why: e.message });
      }
      // Advanced whether it applied or was refused. A line that this island will not take
      // is not going to become acceptable on the next poll, and leaving the bookmark
      // behind it would retry it forever.
      state.since = seq;
    }
    if (rows.length) persist();
    return { applied, skipped, since: state.since };
  }

  async function pull() {
    const body = await fetchJournal({ host, port, islandId, since: state.since, fetchImpl });
    const rows = Array.isArray(body.entries) ? body.entries : (Array.isArray(body.lines) ? body.lines : []);
    return applyLines(rows, { hostId: body.hostId, since: body.since });
  }

  function tick() {
    // One at a time. The interval is four seconds and a poll is a round trip plus a pair
    // of small file writes, but a host that has gone quiet holds the fetch open for eight,
    // and two overlapping replays would apply the same slice twice.
    if (busy) return;
    busy = true;
    pull()
      .then(({ applied, skipped }) => {
        if (applied.length || skipped.length) log(`brought home ${applied.length} change(s) from ${hostId}, ${skipped.length} skipped`);
      })
      .catch((e) => log(`could not reach ${hostId}: ${e.message}`))
      .finally(() => { busy = false; });
  }

  function start() {
    if (timer) return false;
    persist();                       // the visit exists from the moment it is started
    timer = setInterval(tick, Math.max(500, Math.round(intervalMs)));
    // The loop is not a reason for the process to stay up: an island that is closing does
    // not owe a host one more poll.
    if (timer.unref) timer.unref();
    tick();
    return true;
  }

  function stop() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
  }

  // A copy, always. The bookmark is the one number that says what is already home, and
  // handing out the object it lives in is how it ends up edited from somewhere else.
  function stateOf() {
    return {
      ...state,
      ids: { ...state.ids },
      host: String(host),
      port: Math.round(Number(port) || 0),
      running: !!timer,
      stateFile,
      files: { ...files },
    };
  }

  return { start, stop, applyLines, pull, state: stateOf };
}
