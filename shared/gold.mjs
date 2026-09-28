// The gold pit: the current five-hour usage window drawn as a pile of bars by the square
// (Plans/goudkuil.md). This is the one copy of what the pile means - the islander works
// the count out with it, the page draws that many bars, and the sea finds the pit by its
// id - so none of the three can disagree about how much gold one percent is.
//
// Plain arithmetic and no clock of its own, like the rest of shared/: `now` is handed in.

// The pit's building id. One per island, placed once by lib/layout.mjs and never moved.
export const GOLDPIT_ID = 'civic:goldpit';

// How many bars a full pit holds: one per percent of the window, which is what makes "the
// pile shrinks as the limit is used" literal rather than a scale somebody has to read.
export const GOLD_BARS = 100;

// A usage reading, as lib/usage.mjs hands it over (currentUsage):
//   { fiveHour: { used, resetsAt }, at, source }
// `used` is Claude Code's own used_percentage (0..100), `resetsAt` the end of the window in
// milliseconds since the epoch, `at` when the reading was taken, and `source` which of the
// two places said so - 'statusline' (exact) or 'desktop' (the app's quarter-hourly sample,
// whose `resetsAt` is an estimate that errs late). Passed through for the dossier to say.
//
// What it comes to in bars. No reading at all, or a window that has run out since the
// reading was taken, is a full pit: a reset is exactly what an empty window means, and an
// island that has never been told a number is not a broken island - the same bargain as a
// sky with no weather in it being sunshine. `known` says which of the two it was, so the
// dossier can tell the keeper how to get a reading instead of implying they have used none.
export function goldOf(reading, now) {
  const w = reading && reading.fiveHour;
  const valid = w && Number.isFinite(w.used) && Number.isFinite(w.resetsAt);
  if (!valid) return { bars: GOLD_BARS, max: GOLD_BARS, used: null, resetsAt: null, at: null, known: false, reset: false, source: null };
  const source = reading.source ?? null;
  if (now >= w.resetsAt) {
    return { bars: GOLD_BARS, max: GOLD_BARS, used: 0, resetsAt: null, at: reading.at ?? null, known: true, reset: true, source };
  }
  const used = Math.min(100, Math.max(0, w.used));
  return {
    bars: Math.min(GOLD_BARS, Math.max(0, Math.round(GOLD_BARS - used * GOLD_BARS / 100))),
    max: GOLD_BARS,
    used,
    resetsAt: w.resetsAt,
    at: reading.at ?? null,
    known: true,
    reset: false,
    source,
  };
}

// ---- the gold mine and the goldsmith (Plans/goudmijn.md) ------------------------------
// The mine holds the week: the seven-day window as ore in its bin, one lump a percent, as
// the pit holds the five hours. When the five-hour window turns over and the pit may be
// full again, the page has that gold brought from the mine, by way of the goldsmith, rather
// than standing it back in the pit in one frame (web/js/goldrun.js). Placed once each by
// lib/layout.mjs, like the pit, and never moved by a scan.
export const GOLDMINE_ID = 'civic:goldmine';
export const GOLDSMITH_ID = 'civic:goldsmith';

// How many lumps a full mine holds: one per percent of the week.
export const MINE_ORE = 100;

// What the week comes to in ore, from the same reading goldOf takes. `sevenDay.resetsAt`
// may be null: the desktop app's history can show no reset at all (lib/usage.mjs
// weekResetOf), and then the number stands without a refill time. When the week came from
// the other source than the five hours did, `sevenDayAt` and `sevenDaySource` say so.
// No window, or one whose reset has gone by, is a full mine - goldOf's bargain again.
export function mineOf(reading, now) {
  const w = reading && reading.sevenDay;
  const at = reading ? (reading.sevenDayAt ?? reading.at ?? null) : null;
  const source = reading ? (reading.sevenDaySource ?? reading.source ?? null) : null;
  if (!w || !Number.isFinite(w.used)) {
    return { ore: MINE_ORE, max: MINE_ORE, used: null, resetsAt: null, at: null, known: false, reset: false, source: null };
  }
  const resetsAt = Number.isFinite(w.resetsAt) ? w.resetsAt : null;
  if (resetsAt != null && now >= resetsAt) {
    return { ore: MINE_ORE, max: MINE_ORE, used: 0, resetsAt: null, at, known: true, reset: true, source };
  }
  const used = Math.min(100, Math.max(0, w.used));
  return {
    ore: Math.min(MINE_ORE, Math.max(0, Math.round(MINE_ORE - used * MINE_ORE / 100))),
    max: MINE_ORE,
    used,
    resetsAt,
    at,
    known: true,
    reset: false,
    source,
  };
}
