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
};

export function loadConfig() {
  const cfg = { ...DEFAULT_CONFIG, ...(readJson(path.join(ROOT, 'config.json'), {}) || {}) };
  if (!cfg.foundedAt) cfg.foundedAt = new Date().toISOString();
  return cfg;
}

export function ms(x) {
  if (x == null) return null;
  if (typeof x === 'number') return x;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
}
export function iso(n) { return n == null ? null : new Date(n).toISOString(); }
