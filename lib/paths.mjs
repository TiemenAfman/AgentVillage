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

const DEFAULT_CONFIG = {
  islandName: 'Promptholm',
  foundedAt: null,
  founders: [],
  seed: 1337,
  port: 4747,
  gridSize: 64,
  rescanIntervalMs: 60000,
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

export function loadConfig() {
  const onDisk = readJson(CONFIG_FILE, null);
  const cfg = { ...DEFAULT_CONFIG, ...(onDisk || {}) };
  // The two nested blocks merge key by key, so a config naming only network.public keeps
  // the defaults for the rest instead of silently losing them.
  for (const k of ['network', 'multiplayer', 'display']) {
    cfg[k] = { ...DEFAULT_CONFIG[k], ...((onDisk && onDisk[k]) || {}) };
  }
  // One level deeper, for the same reason: a config that says only `{"sea":{"mode":"join"}}`
  // must keep the port and the key it did not mention.
  cfg.multiplayer.sea = { ...DEFAULT_CONFIG.multiplayer.sea, ...(cfg.multiplayer.sea || {}) };
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

export function ms(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
}
export function iso(n) { return n == null ? null : new Date(n).toISOString(); }
