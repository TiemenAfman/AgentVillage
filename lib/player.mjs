// Where the person walking the island is standing.
//
// Everything else the island knows is about the sessions it draws. This is the one
// thing it knows about the reader, and it exists so that "here" means something: an
// agent asked to put a bridge here has to be able to find out where here is.
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic, loadConfig } from './paths.mjs';

export const PLAYER_FILE = path.join(DATA, 'player.json');

// How far from the middle of the island a reported position is believed. The island is
// `gridSize` cells across and centred on the origin, so the land ends at half of that,
// and the slack past it is the water you can stand on a jetty over. It used to be a flat
// eighty, which was the whole of a sixty-four cell island and a little over half of a
// two-hundred-and-fifty-six cell one: on the big island every step past the eightieth
// cell was clamped, so walking to the far coast slid you back towards the middle and
// "where am I" answered with somewhere you had left. Worked out once, because a change
// of `gridSize` is a restart anyway.
let reach = null;
function reachOf() {
  if (reach === null) reach = (loadConfig().gridSize || 64) / 2 + 40;
  return reach;
}

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
  const r = reachOf();
  current = {
    x: clean(where.x, -r, r),
    y: clean(where.y, -20, 60),
    z: clean(where.z, -r, r),
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
