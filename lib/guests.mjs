// The berths: where somebody else's island is parked while they are visiting.
//
// A bundle that arrives over the wire is written to data/guests/<id>/island.json and
// nothing else happens to it. It is never merged into this island's own village, it never
// touches layout.json, and the scanner does not know it exists - the same arrangement
// props.mjs and garden.mjs have with the scanner, for the same reason.
//
// The one rule that makes this a *visit* rather than an export is that a berth never
// survives a restart. createGuests() sweeps the whole directory the moment it is made,
// which happens once, when the server starts. That is deliberately not a line in
// serve.mjs somebody could forget to write: if this module exists at all, the berths are
// empty at boot.
//
// Everything arriving here came off a socket, so the limits are the interesting part: how
// fast one address may park (a token bucket), how many islands may be parked at once, how
// large the lot is, and who is allowed to write over an id once somebody holds it.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';

export const GUESTS_DIR = path.join(DATA, 'guests');

// Four is what the sea between two islands has room to show, and each one is capped at
// the same two megabytes the POST body is capped at, so the whole lot is eight.
export const MAX_GUEST_ISLANDS = 4;
export const MAX_BERTH_BYTES = 2 * 1024 * 1024;
export const MAX_TOTAL_BYTES = MAX_GUEST_ISLANDS * MAX_BERTH_BYTES;

// One upload per ten seconds, with three in hand for somebody who reloads a page twice
// while finding their feet. Deliberately far slower than the pose bucket in players.mjs:
// a pose is a few bytes ten times a second, an island is two megabytes and a terrain
// build, and the only legitimate reason to send one twice in a row is a mistake.
export const BUCKET_SIZE = 3;
export const BUCKET_REFILL = 0.1;
// A bucket per address is a map an address can be invented into. Nothing here is
// expensive, but a million of them is still a million, so the full ones - which are
// indistinguishable from never having asked - are swept when the map gets crowded.
const MAX_BUCKETS = 256;

// The exact pattern parseBeacon tests an id with at lib/neighbours.mjs:62, because this
// is the same id: the island on the horizon and the island in the berth are one island.
const ID = /^[a-f0-9]{8,64}$/;

const BERTH_FILE = 'island.json';

// Errors that carry the status the route should answer with, so the HTTP wording lives at
// the door and the reasoning lives here.
function refuse(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// The one place where a string off the network becomes a path on disk, which is why it is
// a function of its own and why it is tested on its own.
//
// The regex already makes `..`, a separator and a drive letter impossible, so the resolve
// check below can never fire. That is exactly why it is here: it costs one `resolve`, and
// it is the assertion that stays true if somebody ever loosens the regex in a hurry.
export function berthDirFor(root, id) {
  if (typeof id !== 'string' || !ID.test(id)) throw refuse(400, 'that is not an island id');
  const base = path.resolve(root);
  const d = path.resolve(base, id);
  if (!d.startsWith(base + path.sep)) throw refuse(400, 'that is not an island id');
  return d;
}

// The three ceilings are arguments rather than constants only so that a test can make a
// small harbour; nothing in the island passes them. Worth knowing about the defaults:
// four berths of two megabytes is exactly the eight-megabyte total, so the total assert
// can never be the one that fires. It is written anyway because it is the one that keeps
// holding when somebody raises MAX_GUEST_ISLANDS on its own.
export function createGuests({
  dir = GUESTS_DIR,
  maxIslands = MAX_GUEST_ISLANDS,
  maxBerthBytes = MAX_BERTH_BYTES,
  maxTotalBytes = maxIslands * maxBerthBytes,
  log = () => {},
} = {}) {
  const root = path.resolve(dir);
  // id -> { address, at, bytes }. First writer wins for as long as the berth is theirs:
  // two people behind one NAT are the same address and can hand the id back and forth,
  // which is right, but a stranger cannot overwrite an island somebody is standing on.
  const berths = new Map();
  const buckets = new Map();

  const berthDir = (id) => berthDirFor(root, id);

  function berthFile(id) {
    return path.join(berthDir(id), BERTH_FILE);
  }

  function sizeOf(id) {
    try { return fs.statSync(berthFile(id)).size; } catch { return 0; }
  }

  function totalBytes() {
    let sum = 0;
    for (const id of onDisk()) sum += sizeOf(id);
    return sum;
  }

  function onDisk() {
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && ID.test(e.name))
        .map((e) => e.name);
    } catch { return []; }          // no directory yet is the same thing as no guests
  }

  // ---- the door ---------------------------------------------------------------------
  // Asked before the body is read, not after. Reading two megabytes off a socket and then
  // deciding it was one too many is the work the bucket exists to avoid.
  function take(address, now = Date.now()) {
    const key = String(address || 'unknown');
    const b = buckets.get(key) || { tokens: BUCKET_SIZE, at: now };
    b.tokens = Math.min(BUCKET_SIZE, b.tokens + ((now - b.at) / 1000) * BUCKET_REFILL);
    b.at = now;
    if (buckets.size >= MAX_BUCKETS) {
      // A full bucket is indistinguishable from never having asked, so those go first.
      for (const [k, v] of buckets) if (v.tokens >= BUCKET_SIZE) buckets.delete(k);
      // And if a flood has left them all half spent, the oldest go too. Losing a bucket
      // hands that address three fresh tokens, which is what a new visitor gets anyway:
      // this is a bound on memory, not a second opinion about the rate limit.
      for (const k of buckets.keys()) {
        if (buckets.size < MAX_BUCKETS) break;
        buckets.delete(k);
      }
    }
    if (b.tokens < 1) { buckets.set(key, b); return false; }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  }

  // ---- parking --------------------------------------------------------------------
  // `bundle` is whatever parseBundle handed back and nothing else: this function does not
  // validate, it stores. Keeping those two apart is what lets the route answer 400 for a
  // bad island and 503 for a full harbour without either one guessing at the other.
  function park({ id, address, bundle }) {
    const file = berthFile(id);

    const held = berths.get(id);
    if (held && held.address !== String(address || '')) {
      throw refuse(409, 'another island is already moored there');
    }
    if (!held && berths.size >= maxIslands) {
      throw refuse(503, `the harbour is full: ${maxIslands} islands is all it holds`);
    }

    const record = { v: 1, id, parkedAt: new Date().toISOString(), bundle };
    const body = JSON.stringify(record);
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes > maxBerthBytes) {
      throw refuse(413, `that island is ${Math.round(bytes / 1024)} kB and a berth holds ${Math.round(maxBerthBytes / 1024)} kB`);
    }
    // Asserted before the write, and measured against what is actually on disk rather
    // than against what this process remembers putting there. The POST body limit counts
    // characters and a character can be four bytes, so this is the only place the eight
    // megabytes is a real number.
    const after = totalBytes() - sizeOf(id) + bytes;
    if (after > maxTotalBytes) {
      throw refuse(413, `the harbour has room for ${Math.round(maxTotalBytes / 1024)} kB of islands and that would make it ${Math.round(after / 1024)} kB`);
    }

    fs.mkdirSync(berthDir(id), { recursive: true });
    writeJsonAtomic(file, record);
    berths.set(id, { address: String(address || ''), at: Date.now(), bytes });
    log(`${bundle.island.name} moored in berth ${id} (${Math.round(bytes / 1024)} kB from ${address})`);
    return summary(id, record);
  }

  // What a berth looks like from the outside: enough to draw a shape on the horizon and
  // put a name under it. The address that parked it is not in here - which machine on the
  // network a visitor came from is the keeper's business and not a second visitor's.
  function summary(id, record) {
    const b = record && record.bundle;
    const island = (b && b.island) || {};
    return {
      id,
      name: island.name || 'an island',
      keeper: island.keeper || 'Someone',
      seed: island.seed ?? null,
      gridSize: island.gridSize ?? null,
      terrainHash: island.terrainHash || null,
      foundedAt: island.foundedAt || null,
      buildings: (b && b.buildings ? b.buildings.length : 0),
      props: (b && b.props ? b.props.length : 0),
      crops: (b && b.crops ? b.crops.length : 0),
      parkedAt: record ? record.parkedAt : null,
      bytes: sizeOf(id),
    };
  }

  // The berths as they stand, oldest first, so an island that has been there all along
  // does not jump about the horizon when a new one arrives.
  function list() {
    const out = [];
    for (const id of onDisk()) {
      const record = readJson(berthFile(id), null);
      if (!record || !record.bundle) continue;
      out.push(summary(id, record));
    }
    return out.sort((a, b) => String(a.parkedAt).localeCompare(String(b.parkedAt)));
  }

  // The whole island, for the page that has to draw it.
  function read(id) {
    let file;
    try { file = berthFile(id); } catch { return null; }
    const record = readJson(file, null);
    return record && record.bundle ? record.bundle : null;
  }

  function evict(id) {
    let d;
    try { d = berthDir(id); } catch { return false; }
    berths.delete(id);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { return false; }
    return true;
  }

  function clearAll() {
    let gone = 0;
    for (const id of onDisk()) if (evict(id)) gone++;
    berths.clear();
    return gone;
  }

  // Swept here, once, at construction. See the header: a berth that survived a restart
  // would make a visit into a permanent copy of somebody else's island on this disk, and
  // nobody agreed to that.
  const swept = clearAll();
  if (swept) log(`swept ${swept} guest island(s) left over from the last run`);

  // Which address parked an island. Deliberately not in `list()` - that is the summary the
  // page draws the harbour from, and where every visitor came from is nobody's business but
  // this server's. serve.mjs needs it for one thing: working out that a visit is over,
  // because a berth is keyed by an island and an address while a player is a connection.
  const parkedFrom = (id) => (berths.get(String(id)) || {}).address || null;

  return { take, park, list, read, evict, clearAll, parkedFrom, dir: root };
}
