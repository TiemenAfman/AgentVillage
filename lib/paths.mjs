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
  network: { public: false, inviteCode: null, hosts: [] },
  multiplayer: { enabled: true, maxPlayers: 16, tickMs: 66, guestView: 'redacted', name: null, discovery: true },
};

export const CONFIG_FILE = path.join(ROOT, 'config.json');

export function loadConfig() {
  const onDisk = readJson(CONFIG_FILE, null);
  const cfg = { ...DEFAULT_CONFIG, ...(onDisk || {}) };
  // The two nested blocks merge key by key, so a config naming only network.public keeps
  // the defaults for the rest instead of silently losing them.
  for (const k of ['network', 'multiplayer']) {
    cfg[k] = { ...DEFAULT_CONFIG[k], ...((onDisk && onDisk[k]) || {}) };
  }
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

export function ms(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
}
export function iso(n) { return n == null ? null : new Date(n).toISOString(); }
