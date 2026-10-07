// Holding your breath. Every beat, anybody on foot whose head is under the sea (pose says
// swimming, and y puts the head below the surface: shared/breath.mjs `submerged`) has their
// air run down by the time since the last beat; at the surface it comes back. When it is gone
// they are hurt through the one door (lib/health.mjs `hurt`, cause `drown`), a second at a
// time at DROWN_PER_S, and since every hurt is combat no health comes back while they stay
// down - and when that runs out they are sent back to their square or their skiff like any
// other capture, with `why: 'drown'` on the `evicted` so the page can say what happened.
// Plans/onderwater-zwemmen.md, section "Adem en verdrinken".
//
// Beside lib/lava.mjs and on the same filters (`afoot`): walking, outdoors, not at a tiller,
// posed, not asleep. Like the lava it is the sea's own business - only the sea knows who
// drowns - but `y` and the swimming bit are the client's claim, like every pose, so a page
// that lies about its depth can stay down for ever. That is no worse than every other thing
// a pose says.
//
// Like health it is kept per connection, in memory, and only while there is something to
// keep: a body is made when somebody first goes under, and dropped once they are dry and
// full again, so the map stays the size of the divers rather than of everybody ever seen.
import { afoot, pilotsOf } from './hostility.mjs';
import { AIR_S, REFILL_S, DROWN_PER_S, submerged, stepAir } from '../shared/breath.mjs';

// The most often somebody is told about going under or coming up. A pose beat is ten a second
// and a diver hanging at the head's own depth flips `submerged` on every pose; without this
// each flip is a message, up to one a beat to that one page for as long as they bob there,
// and every one of them says what the page's own sum already knows. What is sent at the end
// of the gap is where things stand *then*, so a flip that undid itself sends nothing.
const TELL_GAP_MS = 1000;

// `airS`, `refillS` and `drownPerS` are the shared numbers by default; a test passes shorter
// ones so it does not have to wait half a minute for somebody to run out.
export function createBreath({ roster, health, now = () => Date.now(), airS = AIR_S, refillS = REFILL_S, drownPerS = DROWN_PER_S }) {
  // player id -> { air, told, toldAt }: `told` is whether the page was last said to be under
  // water, which is what decides when it must be told again.
  const bodies = new Map();
  let last = null;

  // Privately, to the one it concerns: how much air is left and which way it is going. The
  // page does the same sum from that one message (`stepAir`, fed its own depth) and fills or
  // drains the bar smoothly by itself, so nothing is sent while it runs - only when the
  // page's own guess would be wrong without it: at the moment somebody goes under or comes
  // up, when the two clocks and the two poses differ by a beat, and after being sent home.
  // Seconds of air and a rate in seconds a second (-1 draining, refilling at a full lung per
  // REFILL_S, 0 full), never a time, because the sea's clock is somebody else's.
  function tell(p, b, wet, t) {
    b.told = wet;
    b.toldAt = t;
    const rate = wet ? -1 : b.air < airS ? airS / refillS : 0;
    p.conn?.send(JSON.stringify({ t: 'breath', air: Math.round(b.air * 100) / 100, max: airS, rate }));
  }

  // Returns how many were hurt on this beat, as the lava does.
  function tick() {
    const t = now();
    // Seconds since the last beat, so the air and the damage are rates and not counts of
    // beats. The cap is for a sea coming back from a suspended process owing minutes: nobody
    // was holding their breath while it was asleep that it should charge them for.
    const dt = last == null ? 0 : Math.min(0.5, Math.max(0, (t - last) / 1000));
    last = t;
    const players = roster.all();
    if (!players.length) { bodies.clear(); return 0; }
    const pilots = pilotsOf(roster);
    const here = new Set();
    let hurt = 0;
    for (const p of players) {
      here.add(p.id);
      const wet = afoot(p, pilots) && submerged(p.f, p.y);
      let b = bodies.get(p.id);
      let step = dt;
      if (!b) {
        if (!wet) continue;
        b = { air: airS, told: false, toldAt: -Infinity };
        bodies.set(p.id, b);
        // Nobody has been seen under for a beat yet: they went under some time in the last
        // one, and charging all of it would say they held their breath before they were
        // under. What they are told is a full lung, as it was.
        step = 0;
      }
      b.air = stepAir(b.air, wet, step, airS, refillS);
      if (wet && b.air <= 0) {
        const result = health.hurt(p, drownPerS * dt, { kind: 'drown' });
        if (result) hurt++;
        if (result === 'evicted') {
          // Home, whole and dry: the roster has already taken the swimming bit off the body
          // (players.mjs evict), so the next beat finds nobody under water. Said now and not
          // on the gap's schedule, because the page has just been told to start again from a
          // full lung and the two must not disagree about it.
          b.air = airS;
          tell(p, b, false, t);
          bodies.delete(p.id);
          continue;
        }
      }
      if (wet !== b.told && t - b.toldAt >= TELL_GAP_MS) tell(p, b, wet, t);
      // Dry, full and the page knows it: indistinguishable from never having gone under. Not
      // before the gap has run out, though: a body made afresh has told nobody anything and
      // says its first word at once, so dropping one a beat after it spoke would let a diver
      // who keeps popping up and down get past the limit above.
      if (!wet && !b.told && b.air >= airS && t - b.toldAt >= TELL_GAP_MS) bodies.delete(p.id);
    }
    for (const id of bodies.keys()) if (!here.has(id)) bodies.delete(id);
    return hurt;
  }

  // Seconds of air `p` has left, for a test; a body that was never under is full.
  const air = (p) => { const b = p && bodies.get(p.id); return b ? b.air : airS; };

  return { tick, air };
}
