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

// A usage reading, as lib/usage.mjs keeps it in data/usage.json:
//   { fiveHour: { used, resetsAt }, at }
// `used` is Claude Code's own used_percentage (0..100), `resetsAt` the end of the window in
// milliseconds since the epoch, `at` when the reading was taken.
//
// What it comes to in bars. No reading at all, or a window that has run out since the
// reading was taken, is a full pit: a reset is exactly what an empty window means, and an
// island that has never been told a number is not a broken island - the same bargain as a
// sky with no weather in it being sunshine. `known` says which of the two it was, so the
// dossier can tell the keeper how to get a reading instead of implying they have used none.
export function goldOf(reading, now) {
  const w = reading && reading.fiveHour;
  const valid = w && Number.isFinite(w.used) && Number.isFinite(w.resetsAt);
  if (!valid) return { bars: GOLD_BARS, max: GOLD_BARS, used: null, resetsAt: null, at: null, known: false, reset: false };
  if (now >= w.resetsAt) {
    return { bars: GOLD_BARS, max: GOLD_BARS, used: 0, resetsAt: null, at: reading.at ?? null, known: true, reset: true };
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
  };
}
