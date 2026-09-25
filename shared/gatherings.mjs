// When the whole village downs tools and goes to the square.
//
// One list, read by both machines that need it. The sea decides whether anybody actually
// walks - lib/crowd.mjs rings `setGather` off this once a beat - and the page carries the
// extra tables out and back in (web/js/main.js). It used to be three constants in main.js,
// and when the walk moved out to the sea ("Laat de zee ook onze eigen bewoners lopen") the
// page's half kept the clock and the sea's half never got one: every Friday the tables came
// out and nobody came. So the schedule lives here, once, and both sides ask it.
//
// shared/ rules apply. Weekdays and hours are plain numbers handed in, never a Date, so
// this file has no clock and no locale of its own and does the same arithmetic in both
// runtimes. Whose afternoon it is - the sea's, see `worldClock` - is the caller's business.

// getDay()'s numbering: Sunday is 0, so the working week is 1..5.
export const WEEKDAYS = [1, 2, 3, 4, 5];
const FRIDAY = 5;

// `from` and `until` are hours of the day as decimals, so 12.5 is half past twelve. The end
// is exclusive: a quarter of an hour from ten is 10 to 10.25, and at 10:15 sharp everybody
// is already drifting home. `name` is what the sea's log calls it.
//
// The three breaks are the Friday borrel copied to every working day - a coffee at ten, a
// lunch at half past twelve, a cup of tea at three - because a village that only ever meets
// on Friday afternoon is empty the rest of the week. The borrel itself keeps its half hour.
export const GATHERINGS = [
  { id: 'coffee', name: 'the coffee break', days: WEEKDAYS, from: 10, until: 10.25 },
  { id: 'lunch', name: 'lunch', days: WEEKDAYS, from: 12.5, until: 13 },
  { id: 'tea', name: 'the afternoon break', days: WEEKDAYS, from: 15, until: 15.25 },
  { id: 'borrel', name: 'the Friday borrel', days: [FRIDAY], from: 16.5, until: 17 },
];

// The gathering that is on at this weekday and hour, or null. `day` is getDay()'s number
// and `hour` is decimal, the way `worldClock` hands them back.
export function gatheringAt(day, hour) {
  for (const g of GATHERINGS) {
    if (g.days.includes(day) && hour >= g.from && hour < g.until) return g;
  }
  return null;
}

// What time it is in the world, from the two numbers the sea's welcome carries: an epoch
// and a zone offset in minutes east of UTC (the sign `-getTimezoneOffset()` gives). An
// epoch on its own is not a time of day, and a Date's local getters would put a player in
// another zone at a different hour over the same water - so the offset is added to the
// epoch and the day and hour are read off the shifted number with integer arithmetic.
//
// Whole minutes, on purpose: the page has always turned the hour over on the minute, and
// the sea flipping a few hundred milliseconds earlier would be a bell nobody could see
// ring. 1970-01-01 was a Thursday, which is the 4 - and the double modulo is for a moment
// before it, which nothing sends but which must not come back negative.
export function worldClock(epochMs, tzMinutes) {
  const mins = Math.floor((epochMs + tzMinutes * 60000) / 60000);
  const dayIndex = Math.floor(mins / 1440);
  return {
    day: (((dayIndex + 4) % 7) + 7) % 7,
    hour: (mins - dayIndex * 1440) / 60,
  };
}
