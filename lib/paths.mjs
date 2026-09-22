import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const WEB = path.join(ROOT, 'web');
export const SHARED = path.join(ROOT, 'shared');
// Always the user's real Claude home, even when the hook runs inside a Cowork task whose
// CLAUDE_CONFIG_DIR points at a private per-task home.
export const CLAUDE_HOME = process.env.SETTLERS_CLAUDE_HOME || path.join(os.homedir(), '.claude');
export const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
export const DESKTOP_DIR = path.join(APPDATA, 'Claude');

export function ensureData() { fs.mkdirSync(DATA, { recursive: true }); }

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// tmp + rename so readers never see a torn file. Windows can refuse the rename for a
// moment while another process has the target open; retry briefly.
export function writeJsonAtomic(file, obj, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.unlinkSync(tmp); } catch {} throw e; }
      const until = Date.now() + 40 * (attempt + 1);
      while (Date.now() < until) { /* short spin */ }
    }
  }
}

// How a ticket is worded when it is handed to an agent - one wording per noticeboard.
//
// Both lived in the module that uses them (lib/dispatch.mjs, lib/issues.mjs) and both moved
// down here, because DEFAULT_CONFIG below has to name the same values and paths.mjs is the
// one file dispatch.mjs, issues.mjs and sprint.mjs all already import from; the other
// direction would be a cycle. Naming them twice instead would drift, and a drifted copy
// here would quietly change the wording of every prompt the island sends out.
//
// They are two objects and not one with overrides because they are genuinely different
// sentences: the cork board hands over a key, the island's own repository hands over an
// issue number and a skill that triggers on that exact phrase.
export const DEFAULT_DISPATCH = { opening: 'Pick up {key}', skill: null, language: 'en', where: 'Jira' };

// `plain` is what an agent is told when the folder it works in does not carry the skill:
// the same route, spelled out, so a hand-over still lands somewhere sensible.
export const DEFAULT_GITHUB_DISPATCH = {
  opening: 'Pick up issue #{number}',
  skill: 'issue-oppakken',
  where: 'GitHub',
  plain: 'Read it with `gh issue view {number}`, branch from origin/main as <type>/{number}-<slug>, '
    + 'say on the issue that you have picked it up, and when the work is done push the branch and '
    + 'close the issue as completed, naming the branch in the closing comment.',
};

// Every setting this island has. This object is the only list of them: loadConfig fills a
// config.json in from it, `fillConfig` writes those additions back to the file on start,
// and tests/config-file.test.mjs checks config.example.json has grown the same keys.
//
// All three of those used to be kept by hand and by the time anyone looked they had drifted
// in both directions at once: the example promised `visitorGraceMs`, `dispatch` and
// `github` blocks this object had never heard of, said `gridSize: 128` where the code said
// 64 - a number that cannot be changed once a town stands on it - and had no
// `multiplayer.sea` at all, which by then was the setting that decided whether you were
// alone in the world. Nothing crashed, because every reader carries its own fallback; the
// settings were simply invisible to anyone who went looking in the file for them.
const DEFAULT_CONFIG = {
  islandName: 'Promptholm',
  foundedAt: null,
  founders: [],
  seed: 1337,
  port: 4747,
  gridSize: 64,
  codexIsland: { enabled: true, name: 'Codex', seed: 7331 },
  rescanIntervalMs: 60000,
  // How long a visitor's session stays on the island after it goes quiet. lib/village.mjs
  // has read this since long before it was written down anywhere a keeper could find it.
  visitorGraceMs: 30 * 60 * 1000,
  // Shut by default. Opening this listens on every interface, which is what lets other
  // people walk your island and what lets neighbours find you - see lib/access.mjs.
  // Open by default. This was `false`, and the island was a thing you had to unlock before
  // anybody could walk it - which was right while a visitor could only look. It is a
  // deliberate change now that visiting is what the island is for: a neighbour appears on
  // your horizon, you sail over, and your own island is moored beside theirs.
  //
  // What it costs is written out in docs/manual.md and above PUBLIC_API in lib/access.mjs,
  // and is worth reading before leaving it on: an open island answers on every address this
  // machine has, `POST /api/island` lets anyone on the subnet park two megabytes in
  // data/guests/, and an inviteCode now buys writes rather than a look. The one thing it
  // does not survive is a port forwarder in front of it - see the last paragraph of the
  // manual's "Visitors and neighbours", which is the failure this cannot defend against
  // from the inside.
  network: { public: true, inviteCode: null, hosts: [] },
  // `sea` is which world this island lives in, and it is the one setting that decides
  // whether you are alone. All three modes go through the same code: single player starts
  // a sea in this process bound to loopback with one island in it, hosting is the same sea
  // bound to the network, and joining is somebody else's address. There is no offline mode
  // to maintain, because being alone is a fleet of one.
  multiplayer: {
    enabled: true, maxPlayers: 16, tickMs: 66, guestView: 'redacted', name: null, discovery: true,
    sea: {
      mode: 'single', url: null, key: null, port: 4750, name: null,
      // Seas worth offering in the picker beyond whatever the network turns up: the one
      // that is always on, and anything the keeper has typed in and kept. Addresses
      // rather than code, because the always-on one moves.
      known: ['http://AgentVillage.freeddns.org:4750/'],
    },
  },
  // What the island shows, as opposed to who may reach it. 'keeper' is this block's
  // equivalent of network.public being false: a yard sign carries the session's own
  // title, which is its opening prompt, so an island that gets opened up should not
  // start by publishing it.
  display: { nameplates: 'keeper' },
  // The cork board's wording, and the island's own repository with a wording of its own.
  // Spread from the two objects above rather than written out again, so what a keeper reads
  // in config.json is by construction what lib/dispatch.mjs and lib/issues.mjs will use.
  dispatch: { ...DEFAULT_DISPATCH },
  github: { repo: null, dispatch: { ...DEFAULT_GITHUB_DISPATCH } },
};

// The settings /api/display may write, and what each one accepts. An allowlist because
// the value comes off a socket and lands in config.json: a free-form patch would let a
// post set a new port, or empty the founders, through a route meant for the scenery.
export const DISPLAY_SETTINGS = {
  nameplates: ['everyone', 'keeper', 'nobody'],
};

// The one place that says what those three words mean, so the server and the page can
// never disagree about who is allowed to read a sign.
export function nameplatesVisibleTo(mode, role) {
  if (mode === 'nobody') return false;
  if (mode === 'everyone') return true;
  return role === 'islander';
}

export const CONFIG_FILE = path.join(ROOT, 'config.json');

// Fills a config in from the defaults, block by block, however deep they go. Returns the
// finished config and the dotted names of everything that had to be added.
//
// This used to be a spread, then a hardcoded list of the nested blocks to merge key by key,
// then that list plus one more line for `multiplayer.sea` a level deeper. Walking it is not
// cleverness for its own sake: a setting added in a block nobody remembered to add to that
// list read as `undefined` however carefully it had been written down, which is half of how
// the drift above happened in the first place.
//
// Three rules, and each one is somebody's settings if it is broken:
//  - a key that is present on disk wins, `null` included. A keeper who wrote `null` chose it.
//  - a key the defaults do not know is kept exactly as it is. It may belong to a branch that
//    is not this one, or to a hand the keeper wrote in; either way it is not ours to drop.
//  - an array is a value, never something to merge into. Merging `founders` or `sea.known`
//    element by element would resurrect every entry the keeper has ever removed.
const isBlock = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function fillDefaults(onDisk, defaults, prefix = '', added = []) {
  const out = {};
  for (const [k, fallback] of Object.entries(defaults)) {
    const has = Object.prototype.hasOwnProperty.call(onDisk, k);
    const mine = onDisk[k];
    if (isBlock(fallback) && has && isBlock(mine)) out[k] = fillDefaults(mine, fallback, `${prefix}${k}.`, added);
    else if (has) out[k] = mine;
    // structuredClone, so nothing a caller does to the config it was handed can reach back
    // into DEFAULT_CONFIG and change what the next island starts from.
    else { out[k] = structuredClone(fallback); added.push(prefix + k); }
  }
  for (const [k, v] of Object.entries(onDisk)) if (!(k in out)) out[k] = v;
  return out;
}

export function loadConfig() {
  const onDisk = readJson(CONFIG_FILE, null);
  const cfg = fillDefaults(onDisk || {}, DEFAULT_CONFIG);
  // An island is founded once. Without writing the date back, every scan would move it
  // forward and the village could never contain anything.
  if (!cfg.foundedAt) {
    cfg.foundedAt = new Date().toISOString();
    try {
      writeJsonAtomic(CONFIG_FILE, { ...(onDisk || DEFAULT_CONFIG), foundedAt: cfg.foundedAt }, { pretty: true });
    } catch { /* read-only checkout: the island still runs, it just refounds each scan */ }
  }
  return cfg;
}

// Brings config.json itself up to date, and says what it added.
//
// loadConfig has always filled the gaps in memory, so a stale file costs nothing at runtime
// - which is exactly why one can sit there for months. What it costs is that a keeper who
// opens config.json to change a setting cannot see the setting: an island that had been
// updated a dozen times still had the file it was first given, and `multiplayer.sea` - by
// then the whole of how you reach anybody - simply was not in it.
//
// Deliberately not inside loadConfig, which is called from a dozen places per request and
// by every test that touches a village: a fill in there would rewrite the config.json of
// whoever ran `node --test`. This runs from serve.mjs and scan.mjs, which is what "on
// start" means. `file` is the same escape lib/paths.mjs gives forgetSea, and for the same
// reason - the alternative is a test that edits the real one.
//
// Only ever adds. A key this version has never heard of is left alone rather than tidied
// away, because the file is also the older island's, and the branch beside this one's.
export function fillConfig({ file = CONFIG_FILE } = {}) {
  const onDisk = readJson(file, null);
  if (!onDisk) return { added: [], written: false };   // no file yet: loadConfig founds it
  const added = [];
  const filled = fillDefaults(onDisk, DEFAULT_CONFIG, '', added);
  if (!added.length) return { added, written: false };
  try {
    writeJsonAtomic(file, filled, { pretty: true });
    return { added, written: true };
  } catch {
    // A read-only checkout still runs; it just keeps the file it has.
    return { added, written: false };
  }
}

// What this island is called out in the world, and what the world it hosts is called.
//
// Hosting is the one case where the machine's own name is the useful one. Everybody who
// runs this project starts out as `Promptholm`, so three of them in one sea is three
// islands by the same name, a join list of rows that all read alike, and no way to tell
// whose coastline you are moored beside. The computer name is the one thing the people
// being invited already have - it is in the address they were handed.
//
// Joining deliberately leaves the name alone: in somebody else's world the name in
// config.json is the one the keeper chose to be known by, and alone there is nobody to be
// told apart from. So the name follows the mode, and switching mode renames the island -
// which is why serve.mjs rescans when it switches, rather than leaving village.json
// carrying the name the island had in the world it just left.
//
// `multiplayer.sea.name` still wins for the sea, because that is a name somebody typed.
// The island's own is overridden while hosting: the point of the rule is that the host is
// recognisable, and a default nobody ever changed is exactly the case it is there for.
export function hostingSea(config) {
  return ((config && config.multiplayer && config.multiplayer.sea) || {}).mode === 'host';
}

export function islandNameOf(config) {
  return (hostingSea(config) ? machineName() : null)
    || (config && config.islandName)
    || DEFAULT_CONFIG.islandName;
}

export function seaNameOf(config) {
  const sea = (config && config.multiplayer && config.multiplayer.sea) || {};
  if (sea.name) return String(sea.name);
  // Host: the island and the world it holds go by one name, so the row in somebody's
  // picker and the coastline they arrive at say the same thing. Otherwise the possessive,
  // which is only ever seen on loopback or shouted at the local network.
  return hostingSea(config) ? islandNameOf(config) : `${islandNameOf(config)}'s sea`;
}

// os.hostname() hands back a fully-qualified name on a domain-joined machine, and the
// short one is the one anybody recognises - it is what Windows shows as the computer name.
function machineName() {
  return String(os.hostname() || '').trim().split('.')[0] || null;
}

// Adds or removes a founder — a session that lives on the island regardless of when it
// started. Rewrites config.json in place, keeping every other setting. Returns the new
// founders list, or throws if the file cannot be written (a read-only checkout).
export function setFounder(sessionId, present) {
  const UUID = /^[0-9a-f-]{36}$/i;
  if (!UUID.test(String(sessionId))) throw new Error('that is not a session id');
  const onDisk = readJson(CONFIG_FILE, null) || { ...DEFAULT_CONFIG };
  const founders = Array.isArray(onDisk.founders) ? onDisk.founders.slice() : [];
  const has = founders.includes(sessionId);
  if (present && !has) founders.push(sessionId);
  else if (!present && has) founders.splice(founders.indexOf(sessionId), 1);
  else return founders;                             // already in the wanted state
  writeJsonAtomic(CONFIG_FILE, { ...onDisk, founders }, { pretty: true });
  return founders;
}

// Changes one of the display settings and writes it back, keeping every other setting.
// Returns the whole display block, so the caller can hand the page the new truth without
// reading the file a second time. Throws on a read-only checkout, and on anything the
// allowlist above does not know.
export function setDisplay(key, value) {
  const allowed = DISPLAY_SETTINGS[key];
  if (!allowed) throw new Error(`there is no display setting called ${key}`);
  if (!allowed.includes(value)) throw new Error(`${key} is one of ${allowed.join(', ')}`);
  const onDisk = readJson(CONFIG_FILE, null) || { ...DEFAULT_CONFIG };
  const display = { ...DEFAULT_CONFIG.display, ...(onDisk.display || {}), [key]: value };
  writeJsonAtomic(CONFIG_FILE, { ...onDisk, display }, { pretty: true });
  return display;
}

// Which world this island lives in. An allowlist like setDisplay's, for the same reason:
// the value arrives on a socket and lands in config.json, so a free-form patch through a
// route meant for one setting could set a new port or empty the founders.
//
// `known` grows by itself. A url somebody picks once is a url they will want again, and
// keeping it is cheaper than making them find it twice - the whole point of the picker.
export function setSea({ mode, url = null, key = null }) {
  const modes = ['single', 'host', 'join'];
  if (!modes.includes(mode)) throw new Error(`a sea is ${modes.join(', ')}`);
  let at = null;
  if (mode === 'join') {
    if (typeof url !== 'string' || !url.trim()) throw new Error('joining needs an address');
    try { at = new URL(url.trim()).href; } catch { throw new Error(`${url} is not an address`); }
    if (!/^https?:$/.test(new URL(at).protocol)) throw new Error('a sea is reached over http');
  }
  const onDisk = readJson(CONFIG_FILE, null) || { ...DEFAULT_CONFIG };
  const was = { ...DEFAULT_CONFIG.multiplayer.sea, ...((onDisk.multiplayer || {}).sea || {}) };
  const known = [...new Set([...(was.known || []), ...(at ? [at] : [])])].slice(-12);
  const sea = { ...was, mode, url: at, key: key == null ? was.key : String(key) || null, known };
  const multiplayer = { ...DEFAULT_CONFIG.multiplayer, ...(onDisk.multiplayer || {}), sea };
  writeJsonAtomic(CONFIG_FILE, { ...onDisk, multiplayer }, { pretty: true });
  return sea;
}

// And out again.
//
// `known` grows by itself, which is the point of the picker - and that is also why it needs
// a way back: a typo, a machine that has gone, an address that moved. Without this the only
// way to shorten the list is to edit config.json, which is exactly the thing the picker was
// built to avoid.
//
// The sea this island is *in* is not forgotten, because that is not forgetting an address,
// it is leaving a world - and leaving is what the three cards are for. Refused rather than
// silently ignored, so the page can say why.
// `file` is for the tests and nothing else. It is the same escape lib/props.mjs gives
// itself, and it is here because the alternative is a test that edits the config.json of
// whoever ran it - this file's one job is to be the real one.
export function forgetSea(url, { file = CONFIG_FILE } = {}) {
  let at = null;
  try { at = new URL(String(url || '').trim()).href; } catch { throw new Error(`${url} is not an address`); }
  const onDisk = readJson(file, null) || { ...DEFAULT_CONFIG };
  const was = { ...DEFAULT_CONFIG.multiplayer.sea, ...((onDisk.multiplayer || {}).sea || {}) };
  const asUrl = (u) => { try { return new URL(String(u)).href; } catch { return null; } };
  if (was.mode === 'join' && asUrl(was.url) === at) throw new Error('this is the sea we are in; pick another world first');
  // Compared through URL() on both sides, not against the raw string. `new URL()` lowercases
  // a hostname, and the default list ships `http://AgentVillage.freeddns.org:4750/` with
  // capitals in it - so the one row somebody would most want rid of was the one row that
  // could not be removed, and it said "that address is not one of the saved ones" while
  // showing it to them. The surviving rows keep their own spelling.
  const same = (u) => { try { return new URL(String(u)).href === at; } catch { return false; } };
  const known = (was.known || []).filter((u) => !same(u));
  if (known.length === (was.known || []).length) throw new Error('that address is not one of the saved ones');
  const sea = { ...was, known };
  const multiplayer = { ...DEFAULT_CONFIG.multiplayer, ...(onDisk.multiplayer || {}), sea };
  writeJsonAtomic(file, { ...onDisk, multiplayer }, { pretty: true });
  return sea;
}

export function ms(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
}
export function iso(n) { return n == null ? null : new Date(n).toISOString(); }
