// What time it is on the island, as far as its people are concerned: how dark, and whether
// the village is due on the square.
//
// Here rather than in web/js/ because the sea walks every crowd, ours included, and the
// sea may not import web/. Before this lived here the two questions were the browser's -
// it stepped the settlers itself, called `setGather` and passed its own night in - and
// when the sea took the walking over (5bfd696) neither came along: the sea called
// `crowds.tick(0)`, so it was noon for ever and nobody went to the borrel again.
//
// Plain arithmetic, like the rest of shared/. The clock itself is read by whoever calls
// this - the sea, once a beat - and never by the walk, which counts ticks. Which hour and
// which weekday it is comes from worldTime() in shared/worldclock.mjs on the sea's own zone
// (SEA_TZ, lib/seaclock.mjs), the one copy of "what time is it": this file only says what
// an hour means to the people, never what the hour is.

// The one number out of web/js/world.js's sky table that the people need: how much of the
// night has fallen, by the hour. The same rows as DAY there, and tests/daylight.test.mjs
// reads that file to keep the two in step - the sky may not be drawn dark over a village
// that thinks it is afternoon.
export const NIGHT_CURVE = [
  [0, 1], [5, 1], [6.5, 0.55], [8, 0], [12, 0], [17, 0.15], [18.5, 0.7], [20, 1], [24, 1],
];

export function nightAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < NIGHT_CURVE.length - 1; i++) {
    const [ha, a] = NIGHT_CURVE[i], [hb, b] = NIGHT_CURVE[i + 1];
    if (h >= ha && h <= hb) return hb === ha ? a : a + (b - a) * ((h - ha) / (hb - ha));
  }
  return 1;
}

// When the whole village downs tools and goes to the square. One list, because this is the
// sort of thing that is asked for by the quarter of an hour and should be one line to move -
// and because both machines that need it must read the same one. The sea decides who walks
// (it rings `crowds.setGather` off this, once a beat) and the page carries the extra tables
// out for exactly the same minutes; two clocks is how the borrel came to be furniture with
// nobody at it.
//
// Coffee at ten, lunch at half past twelve, tea at three, on every working day, and the
// Friday borrel keeping its own half hour. A village that only ever met on Friday afternoon
// was empty the rest of the week.
//
// getDay()'s numbering: Sunday is 0, so the working week is 1..5, and Friday is 5. `from`
// and `until` are hours with their minutes as a fraction, the way `worldTime` hands them
// back. The end is exclusive, so a quarter of an hour from ten is over at 10:15 sharp.
// `name` is what the sea's log calls it.
export const WEEKDAYS = [1, 2, 3, 4, 5];

export const GATHERINGS = [
  { id: 'coffee', name: 'the coffee break', days: WEEKDAYS, from: 10, until: 10.25 },
  { id: 'lunch', name: 'lunch', days: WEEKDAYS, from: 12.5, until: 13 },
  { id: 'tea', name: 'the afternoon break', days: WEEKDAYS, from: 15, until: 15.25 },
  { id: 'borrel', name: 'the Friday borrel', days: [5], from: 16.5, until: 17 },
];

// The gathering that is on at this weekday and hour, or null.
//
// Every edge is a quarter of an hour, and a quarter of an hour divides by sixty exactly in
// binary - so the minute the bell goes is the same minute on both machines and there is no
// epsilon anywhere in this comparison. tests/daylight.test.mjs holds that property.
export function gatheringAt(day, hour) {
  for (const g of GATHERINGS) {
    if (g.days.includes(day) && hour >= g.from && hour < g.until) return g;
  }
  return null;
}

// When the castle's great hall is a rave (Plans/rave-in-het-kasteel.md): Saturday night,
// from nine until three - which is Sunday by the calendar, and that wrap past midnight is
// the whole reason this is a table and not an `if` somebody writes again where it is needed.
// `day` is the night it belongs to, and `until` runs into the next morning. Hours with their
// minutes as a fraction, the end exclusive, like the gatherings above.
export const RAVE = { day: 6, from: 21, until: 3 };

// Whether the rave is on at this weekday and hour.
export function raveAt(day, hour) {
  if (day === RAVE.day && hour >= RAVE.from) return true;
  return day === (RAVE.day + 1) % 7 && hour < RAVE.until;
}
