// Whose afternoon the world is having: the sea's time zone, by name, and what it comes to
// in minutes at any given moment.
//
// The welcome has always carried `tz`, and it used to be `-new Date().getTimezoneOffset()`
// on the sea's own machine. Two things were wrong with that. In a container the machine's
// zone is UTC - node:22-alpine sets no TZ - so the open sea ran two hours behind a Dutch
// summer afternoon, and the borrel at half past four was half past six on the wall. And it
// was one number taken at the moment of the welcome, so a page connected across the switch
// to or from summer time kept the old offset until it happened to reconnect.
//
// So the sea is told a zone by name (SEA_TZ, an IANA name like Europe/Amsterdam), works the
// offset out per moment through Intl - summer time is then the tz database's problem and
// not ours - and says so on the wire the moment it changes. The wire keeps speaking minutes:
// every page already understands a number, and a name would make the world's hour depend on
// the tz data in each viewer's browser, which on an old phone can be a year out of date.
//
// Not in shared/: a page never needs to turn a name into an offset, and Intl's zone data is
// exactly the kind of thing that differs between runtimes.

// How often the offset is looked at again. It changes twice a year, on the hour, so a
// minute late is nothing; asking Intl on every beat would be fifteen formatter calls a
// second to learn the same number.
const RECHECK_MS = 60 * 1000;
// The furthest the host may set the world's clock off the real one.
const MAX_SHIFT = 7 * 24 * 3600 * 1000;

// The zone this machine is in, as a name. 'UTC' in a container, which is the reason SEA_TZ
// exists; fine for the loopback sea an islander starts, which is in its keeper's own zone.
export function hostZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

const formatters = new Map();
function formatterFor(zone) {
  let f = formatters.get(zone);
  if (!f) {
    // Throws a RangeError for a name the tz database does not know, which is how
    // createSeaClock finds out it was handed nonsense.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

// Minutes east of UTC in `zone` at `epochMs`: the wall clock there, read back as if it were
// UTC, minus the moment itself. formatToParts rather than the `longOffset` zone name,
// because the parts are plain numbers in every Node there has been an Intl in.
export function zoneOffset(zone, epochMs) {
  const p = {};
  for (const part of formatterFor(zone).formatToParts(new Date(epochMs))) p[part.type] = part.value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const whole = Math.floor(epochMs / 1000) * 1000;   // the parts have no milliseconds
  return Math.round((wall - whole) / 60000);
}

export function createSeaClock({ now = () => Date.now(), zone = null, log = () => {} } = {}) {
  let name = zone || hostZone();
  try { zoneOffset(name, now()); } catch {
    // A typo in SEA_TZ must not keep a world from starting - but it must not pass for a
    // time zone either, so it is said once, here, and the machine's own zone stands in.
    log(`"${name}" is not a time zone this sea knows; using ${hostZone()} instead`);
    name = hostZone();
  }
  // How far the host has set the world's clock off the real one, in ms (Plans/zeetijd-van-de-host.md).
  // Zero for every sea nobody hosts - the open sea in its container has nobody who may move
  // it - and in memory only, like everything the sea holds: a restart is real time again.
  let shift = 0;
  const at = () => now() + shift;
  let tz = zoneOffset(name, at());
  let checkAt = now() + RECHECK_MS;

  return {
    zone: () => name,
    // The world's moment: the real one plus the host's shift. Everything that asks what hour
    // it is in the world goes through this - the welcome, the beat's night and borrel.
    at,
    shift: () => shift,
    // What the welcome carries: the moment and whose it is, read at the same instant, and how
    // far that is off the real clock (a page from before this ignores the field and follows
    // `now` all the same, which is what makes it a patch).
    current() { const t = at(); return { now: t, tz: zoneOffset(name, t), shift }; },
    // The offset as last looked at, for the beat's own question (is it night, is it the
    // borrel) - at most RECHECK_MS stale, and no formatter call fifteen times a second.
    offset: () => tz,
    // Sets the shift and hands back the clock to broadcast. Whole minutes, and never more
    // than a week either way: a number from a page is a number from a page.
    setShift(ms) {
      const n = Math.round(Number(ms) / 60000) * 60000;
      shift = Number.isFinite(n) ? Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, n)) : 0;
      tz = zoneOffset(name, at());
      return this.current();
    },
    // The shift that puts the world's wall clock on `hour` (0..24, fractions allowed) - the
    // nearest such moment to the real one, within half a day either way, so 07:00 asked at
    // 20:00 is tomorrow morning and 18:00 asked at 20:00 is two hours ago.
    shiftForHour(hour) {
      const t = now();
      const z = zoneOffset(name, t);
      const wallMin = (((Math.floor(t / 60000) + z) % 1440) + 1440) % 1440;
      let d = Math.round(Number(hour) * 60) - wallMin;
      d = ((d % 1440) + 1440) % 1440;
      if (d > 720) d -= 1440;
      return d * 60000;
    },
    // Called on the beat. Null almost always; the new clock on the one beat after the
    // offset moved, which is what the sea broadcasts.
    tick() {
      const real = now();
      if (real < checkAt) return null;
      checkAt = real + RECHECK_MS;
      const t = at();
      const next = zoneOffset(name, t);
      if (next === tz) return null;
      tz = next;
      return { now: t, tz };
    },
  };
}
