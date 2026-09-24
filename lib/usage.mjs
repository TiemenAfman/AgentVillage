// The keeper's usage limit, as Claude Code tells it to a status line (Plans/goudkuil.md).
//
// Claude Code puts the five-hour and seven-day windows in the JSON it pipes to a
// `statusLine` command - `rate_limits.five_hour.used_percentage` (0..100) and `resets_at`
// (Unix seconds) - and nowhere else: not in a hook's input, not in a transcript. So
// hooks/statusline.mjs is the one writer of data/usage.json, and this file is what both
// halves agree the file looks like.
//
// The reading is this machine's alone. It is never written into village.json (a visitor
// may be shown that) or into a bundle (the sea is somebody else's machine), and serve.mjs
// hands it only to its own keeper - see /api/gold there.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, writeJsonAtomic } from './paths.mjs';

export const USAGE_FILE = path.join(DATA, 'usage.json');

// One window out of the status line's JSON, or null when it is not there - which is the
// ordinary case for an API-key user, and for the first moments of any session before its
// first answer has come back.
function windowOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const used = Number(raw.used_percentage);
  const resets = Number(raw.resets_at);
  if (!Number.isFinite(used) || !Number.isFinite(resets) || resets <= 0) return null;
  // Rounded to a tenth: the status line runs on every message, and a percentage that moved
  // in its fourth decimal is not a reason to rewrite a file or tell every open page.
  return { used: Math.round(Math.min(100, Math.max(0, used)) * 10) / 10, resetsAt: Math.round(resets * 1000) };
}

// What the status line's stdin comes to, or null when it says nothing about the five-hour
// window. The seven-day window rides along because it costs nothing and is the obvious
// next question; nothing draws it yet.
export function readingOf(payload, now = Date.now()) {
  const limits = payload && payload.rate_limits;
  const fiveHour = windowOf(limits && limits.five_hour);
  if (!fiveHour) return null;
  return { v: 1, fiveHour, sevenDay: windowOf(limits.seven_day), at: now };
}

// Whether two readings say the same thing, ignoring when they were taken.
export function sameReading(a, b) {
  const w = (r, k) => (r && r[k] ? `${r[k].used}@${r[k].resetsAt}` : '-');
  return !!a && !!b && w(a, 'fiveHour') === w(b, 'fiveHour') && w(a, 'sevenDay') === w(b, 'sevenDay');
}

// The last reading on disk, or null. Checked field by field rather than trusted: anything
// on this machine can write a file into data/, and the page draws what this returns.
export function readUsage(file = USAGE_FILE) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const win = (w) => (w && Number.isFinite(w.used) && Number.isFinite(w.resetsAt)
    ? { used: Math.min(100, Math.max(0, w.used)), resetsAt: w.resetsAt } : null);
  const fiveHour = win(raw.fiveHour);
  if (!fiveHour) return null;
  return { v: 1, fiveHour, sevenDay: win(raw.sevenDay), at: Number.isFinite(raw.at) ? raw.at : null };
}

// Written only when it says something new, so a status line that runs on every message
// does not rewrite the file - and wake every open page - forty times a minute. Returns
// whether it wrote.
export function writeUsage(reading, file = USAGE_FILE) {
  if (!reading) return false;
  if (sameReading(readUsage(file), reading)) return false;
  writeJsonAtomic(file, reading);
  return true;
}
