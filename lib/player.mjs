// Where the person walking the island is standing.
//
// Everything else the island knows is about the sessions it draws. This is the one
// thing it knows about the reader, and it exists so that "here" means something: an
// agent asked to put a bridge here has to be able to find out where here is.
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';

export const PLAYER_FILE = path.join(DATA, 'player.json');

// The page reports every couple of seconds while you walk. Keeping the last one in
// memory and only writing it down now and then saves the disk a hundred rewrites for
// a stroll across the square, and loses nothing anyone would miss.
const WRITE_EVERY = 5000;

let current = null;
let writtenAt = 0;

function clean(v, lo, hi) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000)) : 0;
}

export function rememberPlayer(where = {}, { force = false } = {}) {
  current = {
    x: clean(where.x, -80, 80),
    y: clean(where.y, -20, 60),
    z: clean(where.z, -80, 80),
    yaw: clean(where.yaw, -100, 100),
    walking: !!where.walking,
    near: where.near ? String(where.near).slice(0, 80) : null,
    at: new Date().toISOString(),
  };
  const now = Date.now();
  if (force || now - writtenAt >= WRITE_EVERY) {
    writtenAt = now;
    try { writeJsonAtomic(PLAYER_FILE, current, { pretty: true }); } catch { /* a read-only checkout still walks */ }
  }
  return current;
}

// The last known spot, from memory if this server has seen you move, from disk if it
// has just started up.
export function whereIsPlayer() {
  if (current) return current;
  return readJson(PLAYER_FILE, null);
}
