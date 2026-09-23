// What time it is on the island, as far as its people are concerned: how dark, and whether
// it is Friday borrel.
//
// Here rather than in web/js/ because the sea walks every crowd, ours included, and the
// sea may not import web/. Before this lived here the two questions were the browser's -
// it stepped the settlers itself, called `setGather` and passed its own night in - and
// when the sea took the walking over (5bfd696) neither came along: the sea called
// `crowds.tick(0)`, so it was noon for ever and nobody went to the borrel again.
//
// Plain arithmetic, like the rest of shared/. The clock itself is read by whoever calls
// this - the sea, once a beat - and never by the walk, which counts ticks.

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

// Friday, half past four until five. One place, because this is the sort of thing that is
// asked for by the half hour and should be one line to move.
export const BORREL_DAY = 5;              // Sunday is 0, so Friday is 5
export const BORREL_FROM = 16.5;
export const BORREL_UNTIL = 17;

export function borrelAt(day, hour) {
  return day === BORREL_DAY && hour >= BORREL_FROM && hour < BORREL_UNTIL;
}

// Whose afternoon. A sea in a container keeps UTC, which would ring the bell at half past
// six in the summer; the village is Dutch, so its clock is. One zone for the whole world,
// on purpose: a sea with islands from two countries still has one borrel, the way it has
// one weather.
export const ISLAND_ZONE = 'Europe/Amsterdam';

// { day, hour } at `ms` in the island's zone - hour with its minutes as a fraction.
// The formatter is kept: the sea asks fifteen times a second, and building one is the
// expensive half of the question.
const formats = new Map();
export function islandClock(ms, zone = ISLAND_ZONE) {
  let fmt = formats.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    formats.set(zone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, hour: Number(get('hour')) + Number(get('minute')) / 60 };
}
