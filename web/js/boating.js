// Settlers take a boat out, for no reason at all.
//
// The quay already had everything this needs and none of it was being used by anybody but
// you. web/js/boat.js is a hull you can steer, main.js keeps three of them to a quay, and
// the planks are a deck a body can stand on. So an outing is not new machinery: it is a
// settler borrowed from settlers.js, walked down the lane and out along the dock, put in
// one of those same three boats, taken round the bay and brought back. When they are out
// there is one fewer boat at the berth for you, which is the whole of the integration and
// the reason it is worth having - the fleet is the village's, not the player's.
//
// Two decisions are worth writing down because the obvious alternative was tried first.
//
// **The hull is moved along a route, not sailed.** stepBoat() is right there and steering
// it with an autopilot would be the flattering thing to do, and it is how you get a settler
// wedged against a headland at half past four with no way out of it: a proportional helm
// that overshoots a waypoint circles it, and `aground` is a state the physics only leaves
// by backing off, which nothing here can decide to do. So the route is planned over water
// that has been checked, and the boat walks it at a steady three units a second with its
// bow lerped round to the heading. At the distance an outing is watched from, the
// difference is momentum on the turns, and the difference in failure modes is a boat that
// always comes home.
//
// **The route is a circle.** Out from the berth, once round, and back to it - the circle
// that passes through the berth with its centre out to sea, at a radius the rng picks.
// One shape covers "out and back" and "round the point" both, it cannot fold over on
// itself, and checking it is checking its own samples. A hand-drawn wander needed the same
// checks and could still corner itself against a bay it had sailed into.
//
// planVoyage is pure - a terrain, a point, a direction and an rng - which is what
// tests/boating.test.mjs sails a hundred voyages over a coast of its own making.
import { clamp } from 'shared/rng.mjs';

// How fast a settler potters. The boat you steer tops out at 9.5 (BOAT_TOP); this is a
// third of that, which is the speed the hull's own bow wave would sit right at and, more
// to the point, slow enough that an outing reads as an afternoon rather than an errand.
const CRUISE = 3.0;
// How quickly the bow comes round to the heading, as the fraction of the error taken per
// second. Loose enough that a turn is a turn and not a pivot.
const SWING = 2.4;

// How near a waypoint counts as reached. Half a ground cell: closer and the boat crabs
// sideways onto the exact point at the end of every leg, which no hull does.
const REACHED = 0.5;

// Stepping off the planks and down into the hull, and back up again. Boarding is the one
// moment the two heights the island keeps for a body - the quay's deck and a boat's - have
// to be reconciled, and a settler who simply appears in the boat drops half a metre in one
// frame. So it is a lerp, and it is nearly a second long because that is how long stepping
// down into a small boat takes.
const BOARDING = 0.9;

// How many outings at once, and how long the island waits between offering one. The cap is
// low on purpose: three boats to a quay means an island of settlers that all fancied a sail
// would leave you with nothing to take out, and a bay with two boats on it reads as a quiet
// afternoon where a bay with nine reads as a regatta.
const MAX_OUT = 2;
const WAIT_MIN = 50;
const WAIT_MAX = 210;

// Nobody goes out in the dark. The same number the stroll uses to start thinning errands
// out, read the other way: past this the quay is shut.
const NIGHT_SHUT = 0.45;

// An outing that has somehow stopped getting anywhere is abandoned rather than watched.
// Nothing here can deadlock - the route is checked and the steering has no state - but a
// village rebuild mid-voyage, a dock that moves, a tab asleep for an hour: the ceiling is
// what makes all of those end the same way instead of each in its own manner.
const VOYAGE_MAX = 600;

const TAU = Math.PI * 2;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * clamp(t, 0, 1);
}

// Water a hull fits in: the cell under the point and the eight round it. One cell would be
// enough for a boat drawn as a dot and is not enough for one a ground cell long, and the
// margin is what keeps a circle that grazes a headland from being planned at all rather
// than being sailed through it.
export function openWater(terrain, x, z) {
  const gx = Math.round(x + terrain.half - 0.5);
  const gz = Math.round(z + terrain.half - 0.5);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!terrain.isWater(gx + dx, gz + dz)) return false;
    }
  }
  return true;
}

// The circle out and back. `start` is the berth in world coordinates and `dir` is the way
// the dock points out to sea, so the centre is straight out in front of the boat and the
// first thing it does on leaving is turn - which is what a boat leaving a jetty does.
//
// Answers the waypoints, ending on the berth it started from, or null if no radius this
// rng picked would fit in open water. Null is a real answer: on an island whose only dock
// is up a creek there is nowhere to go, and the settler walks home again.
export function planVoyage(terrain, start, dir, rng, { samples = 20 } = {}) {
  const len = Math.hypot(dir[0], dir[1]) || 1;
  const out = [dir[0] / len, dir[1] / len];
  const turn = rng.chance(0.5) ? 1 : -1;
  // Big first, then smaller. A settler would rather have the long way round, and trying it
  // in that order means the bay is used for what it can hold instead of every voyage being
  // planned at the radius that fits everywhere.
  for (let tries = 0; tries < 5; tries++) {
    const r = rng.range(5, 13) * (1 - tries * 0.16);
    const cx = start[0] + out[0] * r, cz = start[1] + out[1] * r;
    const a0 = Math.atan2(start[1] - cz, start[0] - cx);
    const points = [];
    let ok = true;
    for (let i = 1; i <= samples && ok; i++) {
      const a = a0 + turn * (i / samples) * TAU;
      // The last point is the berth exactly - it is where the boat has to end up - so the
      // wobble that keeps a voyage from reading as a compass drawing stops short of it.
      const wob = i < samples ? rng.range(-0.09, 0.09) : 0;
      const x = cx + Math.cos(a) * r * (1 + wob);
      const z = cz + Math.sin(a) * r * (1 + wob);
      if (!openWater(terrain, x, z)) ok = false;
      else points.push([x, z]);
    }
    if (ok) return points;
  }
  return null;
}

// `settlers` is createSettlers(); `dock` answers the home dock spec built in main.js
// (cells, dir, berth, head, from) or null; `fleet` is take()/release(), which is main.js's
// own boat list so that a settler's boat is one of the three you could have taken. `terrain`
// answers the island, and both of the last two are asked for fresh every time rather than
// held, because a reseed replaces them under us.
// `eager` is `?sail` on the island: outings start at once and keep coming, because an
// hour is a long time to wait to see whether the boat still comes home. It shortens the
// timer and nothing else - the cap, the night and the checks on the route all still hold,
// so what it shows is the real thing happening more often.
export function createBoating({ terrain, settlers, dock, fleet, rng, eager = false }) {
  let wait = eager ? 2 : rng.range(20, WAIT_MAX);
  const trips = [];

  // The walk from the shore cell out to the end of the planks, in world points. Taken from
  // the dock's own cells rather than from anything remembered, so a dock rebuilt somewhere
  // else is walked to somewhere else.
  function planks(d) {
    return d.cells.map(([gx, gz]) => d.region.cellWorld(gx, gz));
  }

  function abandon(trip, why) {
    if (trip.boat) fleet.release(trip.boat);
    trip.boat = null;
    if (settlers.has(trip.id)) {
      settlers.carry(trip.id, null);
      settlers.release(trip.id);
    }
    trip.done = why || 'abandoned';
  }

  // Home again: back up the planks and down the lane they came by. The outbound route
  // reversed, with their own doorstep on the end of it - the same trick startStroll plays,
  // and for the same reason: a second route planned from the quay would not necessarily
  // come back to the door they left by.
  function walkHome(trip) {
    settlers.carry(trip.id, null);
    const back = [...trip.ashore].reverse().concat([trip.home]);
    settlers.sendOut(trip.id, back, () => {
      settlers.release(trip.id);
      trip.done = 'home';
    });
  }

  function begin() {
    const d = dock();
    const t = terrain();
    if (!d || !t) return false;
    const who = settlers.available(1, rng);
    if (!who.length) return false;
    const person = who[0];
    if (!settlers.charter(person.id)) return false;

    // The landing is a land cell by construction (lib/layout.mjs picks it off the coast),
    // so the walk is an ordinary walk and only the planks after it are not.
    const shore = d.landing;
    const lane = settlers.routeTo(person.id, shore);
    if (!lane) { settlers.release(person.id); return false; }
    const ashore = [...lane, ...planks(d)];
    const trip = {
      id: person.id, name: person.name, home: person.home,
      ashore, boat: null, path: null, i: 0, board: 0, age: 0, done: null,
      stage: 'walking', from: null,
    };
    trips.push(trip);
    settlers.sendOut(person.id, ashore, (arrived) => {
      if (!arrived || !settlers.has(trip.id)) { abandon(trip); return; }
      const boat = fleet.take(trip.id);
      const voyage = boat ? planVoyage(t, d.berth, d.dir, rng) : null;
      if (!boat || !voyage) {
        // No hull free, or nowhere this dock can go. Either way it is a walk to the end of
        // the pier and back, which is a perfectly good afternoon and is at least honest
        // about what happened.
        if (boat) fleet.release(boat);
        walkHome(trip);
        return;
      }
      trip.boat = boat;
      trip.path = voyage;
      trip.i = 0;
      trip.stage = 'boarding';
      trip.board = 0;
      // Where they step down from: wherever the walk left them, at whatever height that
      // was. Asked for rather than assumed, because the end of the planks and the end of
      // the lane are two very different heights and a stumble at the wrong one is the
      // whole of what the lerp below exists to avoid.
      const at = settlers.where(trip.id);
      trip.from = [[at.x, at.z], at.y];
      boat.x = d.berth[0];
      boat.z = d.berth[1];
      boat.yaw = d.yaw;
      settlers.carry(trip.id, () => rideOf(trip));
    });
    return true;
  }

  // Where the body riding this trip is, this frame. One function, three answers: stepping
  // down, standing in the cabin, stepping back up. `board` runs 0..1 on the way in and
  // 1..0 on the way out, so the same lerp does both ends of the trip.
  function rideOf(trip) {
    const b = trip.boat;
    if (!b) return null;
    const deck = b.deckY != null ? b.deckY : 0;
    if (trip.board >= 1) return { x: b.x, z: b.z, yaw: b.yaw, y: deck };
    const k = clamp(trip.board, 0, 1);
    const e = k * k * (3 - 2 * k);
    const [from, fromY] = trip.from;
    return {
      x: from[0] + (b.x - from[0]) * e,
      z: from[1] + (b.z - from[1]) * e,
      yaw: b.yaw,
      y: fromY + (deck - fromY) * e,
    };
  }

  function sail(trip, dt) {
    const b = trip.boat;
    const p = trip.path[trip.i];
    const dx = p[0] - b.x, dz = p[1] - b.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) {
      const step = Math.min(d, CRUISE * dt);
      b.x += (dx / d) * step;
      b.z += (dz / d) * step;
      b.yaw = lerpAngle(b.yaw, Math.atan2(dx, dz), 1 - Math.exp(-SWING * dt));
    }
    if (d < REACHED) trip.i++;
    return trip.i >= trip.path.length;
  }

  function update(dt, nightAmount = 0) {
    for (const trip of trips) {
      if (trip.done) continue;
      trip.age += dt;
      if (trip.age > VOYAGE_MAX) { abandon(trip, 'overdue'); continue; }
      if (trip.stage !== 'walking' && !settlers.has(trip.id)) { abandon(trip, 'gone'); continue; }
      if (trip.stage === 'boarding') {
        trip.board = Math.min(1, trip.board + dt / BOARDING);
        if (trip.board >= 1) trip.stage = 'sailing';
      } else if (trip.stage === 'sailing') {
        if (sail(trip, dt)) {
          trip.stage = 'landing';
          // Back onto the planks by the way they came down, so the step up is the step
          // down played backwards rather than a second set of numbers.
          trip.board = 1;
        }
      } else if (trip.stage === 'landing') {
        trip.board = Math.max(0, trip.board - dt / BOARDING);
        if (trip.board <= 0) {
          fleet.release(trip.boat);
          trip.boat = null;
          trip.stage = 'walking';
          walkHome(trip);
        }
      }
    }
    for (let i = trips.length - 1; i >= 0; i--) if (trips[i].done) trips.splice(i, 1);

    // And whether anybody new fancies it. The timer runs whatever the hour is, so a night
    // spent below decks does not bank a dozen outings for dawn - it is a decision not to
    // go, not a queue.
    wait -= dt;
    if (wait > 0) return;
    wait = eager ? 6 : rng.range(WAIT_MIN, WAIT_MAX);
    if (nightAmount > NIGHT_SHUT) return;
    if (trips.filter((t) => !t.done).length >= MAX_OUT) return;
    begin();
  }

  return {
    update,
    // Who is out, for anything that wants to know whether a hull has somebody in it.
    crews: () => trips.filter((t) => t.boat).map((t) => ({ id: t.id, boat: t.boat.id })),
    // Everybody back ashore, for a reseed: the village is about to be rebuilt under them.
    clear() {
      for (const trip of trips) if (!trip.done) abandon(trip, 'cleared');
      trips.length = 0;
    },
  };
}
