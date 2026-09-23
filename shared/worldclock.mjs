// What time it is in the world, worked out from the two numbers the sea sends.
//
// The sea's welcome carries `now` (which moment it is) and `tz` (whose afternoon that is,
// in minutes east of UTC), and everything a page draws off the calendar - the hour, and so
// the sun, the moon, the stars and the hands on the tower; the month, and so the season the
// meadows are painted in; the weekday, and so whether it is Friday - comes out of here.
// There is deliberately no second copy of "what time is it": before this, the hour came
// from the sea while the month and the weekday came from the browser's own `getMonth()` and
// `getDay()`, so a player in another time zone could stand in October on somebody else's
// September island, and at midnight on the first of a month even two players in the same
// room could.
//
// Only the `getUTC*` half of Date is used, and only on an epoch that has already been
// shifted by `tz`. Those are specified to the millisecond and agree between Node and every
// browser; the local-zone getters are the whole problem this module exists to take away,
// and tests/worldclock.test.mjs fails on any of them anywhere in web/js/ or shared/.
//
// No clock of its own, either. Every function takes the epoch it is asked about, so the
// sea can answer for its `now()` and a page for its own skewed one, and a test for any
// moment it likes.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// A new moon everybody agrees on - 6 January 2000, 18:14 UTC - and the mean length of a
// lunation. The real moon wanders up to about fourteen hours either side of the mean,
// which at the scale of a disc in the sky is nothing anybody could see.
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
const SYNODIC_MS = 29.530588853 * DAY;

export function seasonOf(month) {
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

// This machine's own offset at that moment, in the same sign as the wire's `tz`. The one
// fallback for a page that has no sea to ask - which is exactly what the island did before
// there were any - and kept here so the page never reaches for a local getter itself.
export function localZone(epochMs) {
  return -new Date(epochMs).getTimezoneOffset();
}

// The calendar at `epochMs`, as it reads `tz` minutes east of UTC.
//
//   hour     hours past midnight with the minutes as the fraction - whole minutes, as the
//            HUD has always shown and the tower's hands step
//   month    0..11, as Date counts them, because that is what seasonOf and every caller
//            already speak
//   weekday  0..6, Sunday first, the same
//   season   seasonOf(month)
//   moon     the phase, 0..1: 0 is new, 0.5 full. From the epoch alone - the moon is the
//            same moon whatever time zone you look at it from
export function worldTime(epochMs, tz) {
  const shifted = epochMs + (Number.isFinite(tz) ? tz : 0) * MINUTE;
  const d = new Date(shifted);
  const month = d.getUTCMonth();
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const lunation = (epochMs - NEW_MOON_MS) / SYNODIC_MS;
  return {
    hour: mins / 60,
    month,
    weekday: d.getUTCDay(),
    season: seasonOf(month),
    moon: lunation - Math.floor(lunation),
  };
}
