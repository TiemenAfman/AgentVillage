// The keeper's usage limit, from the two places on this machine that know it
// (Plans/goudkuil.md).
//
// Claude Code puts the five-hour and seven-day windows in the JSON it pipes to a
// `statusLine` command - `rate_limits.five_hour.used_percentage` (0..100) and `resets_at`
// (Unix seconds) - and nowhere else: not in a hook's input, not in a transcript. So
// hooks/statusline.mjs is the one writer of data/usage.json, and this file is what both
// halves agree the file looks like.
//
// The desktop app never runs a status line, though, and a keeper who works only in its
// Code tab had a full pit for good - measured on 25 September: every session since the
// status line went in was `entrypoint: claude-desktop`, and data/usage.json did not exist.
// What the app does do is sample the same window itself, every quarter of an hour, into
// %APPDATA%\Claude\plan-usage-history.json (`fh` is the five-hour percentage). That is
// the second source, read-only and undocumented, and `currentUsage` takes whichever of the
// two spoke last. See readDesktopUsage for what it cannot tell us.
//
// The reading is this machine's alone. It is never written into village.json (a visitor
// may be shown that) or into a bundle (the sea is somebody else's machine), and serve.mjs
// hands it only to its own keeper - see /api/gold there.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, DESKTOP_DIR, writeJsonAtomic } from './paths.mjs';

export const USAGE_FILE = path.join(DATA, 'usage.json');
export const DESKTOP_USAGE_FILE = path.join(DESKTOP_DIR, 'plan-usage-history.json');

const WINDOW_MS = 5 * 3600e3;

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
  return { v: 1, fiveHour, sevenDay: win(raw.sevenDay), at: Number.isFinite(raw.at) ? raw.at : null, source: 'statusline' };
}

// The desktop app's last sample of the five-hour window, as a reading, or null.
//
// The file is `{ version, samples: [{ t, org, u: { fh, sd } }] }`, oldest first, one sample
// every fifteen minutes while the app is open. It has the percentage and not the reset, so
// `resetsAt` is worked out from the history: the current window is the run of samples back
// from the last one in which the number never went down, never was zero and never reached
// back further than five hours, and it cannot end later than five hours after the first of
// them - that sample already had usage in it, so the window was open by then. An upper
// bound, deliberately: while the app runs, the next sample shows the reset for itself, and
// the estimate only decides anything once it has stopped sampling, when a pit that fills a
// quarter of an hour late is better than one that fills while the window is still spent.
// Replayed over a month of one keeper's history (26 resets seen with the app open), it
// never put a reset before a sample that was still inside the window; it was at most a
// quarter of an hour late, and later only when the window had opened while the app was
// shut (or while `fh` still rounded to 0), which no rule on these samples can see.
//
// Only the last sample's `org`: the file keeps every account the app has been signed in
// to, and another account's window is not this one's. `sd` has no reset either, and nothing
// draws the seven-day window, so it is not guessed at.
export function readDesktopUsage(file = DESKTOP_USAGE_FILE) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  const samples = raw && Array.isArray(raw.samples) ? raw.samples : null;
  if (!samples) return null;
  const fhOf = (s) => (s && Number.isFinite(s.t) && s.u && Number.isFinite(s.u.fh)
    ? Math.min(100, Math.max(0, s.u.fh)) : null);
  let last = samples.length - 1;
  while (last >= 0 && fhOf(samples[last]) == null) last--;
  if (last < 0) return null;
  const latest = samples[last];
  let first = latest;
  for (let i = last - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.org !== latest.org) continue;
    const fh = fhOf(s);
    if (fh == null) continue;
    if (fh === 0 || fh > fhOf(first) || latest.t - s.t >= WINDOW_MS) break;
    first = s;
  }
  return {
    v: 1,
    fiveHour: { used: fhOf(latest), resetsAt: first.t + WINDOW_MS },
    sevenDay: null,
    at: latest.t,
    source: 'desktop',
  };
}

// The reading to draw: whichever source spoke last. The status line is exact and the app
// is up to fifteen minutes behind, but a status line writes only when its number moves and
// stops altogether when nobody is in a terminal, so its reading can be hours old while the
// app has sampled since - and the other way round when the app is shut. Newest wins; a tie
// goes to the status line, which knows its reset rather than estimating it.
export function currentUsage({ file = USAGE_FILE, desktopFile = DESKTOP_USAGE_FILE } = {}) {
  const line = readUsage(file);
  const app = readDesktopUsage(desktopFile);
  if (!line || !app) return line || app;
  return (app.at ?? -Infinity) > (line.at ?? -Infinity) ? app : line;
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
