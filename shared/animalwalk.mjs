// Where the island's story animals are (Plans/dierenverhalen.md, docs/animals-wire.md).
//
// The sea's half of a hen: it steps her, lib/animal-crowd.mjs puts her on the wire, and the
// page (web/js/animal-view.js) draws whatever this says, with fauna.js's joints on top. Who
// she is, what she remembers and where she is sent is the islander's (lib/animal-stories.mjs);
// nothing here knows a name, a friend or a story - only a home, a radius, a few traits and,
// now and then, an errand: go *there*, do *that* for so long, facing *this*.
//
// It is shared/settlerwalk.mjs's little sister and keeps the same rules for the same reasons
// (the top of shared/rng.mjs has them): plain arithmetic, no Math.random, no transcendental
// functions, no clock, no three.js and nothing from the browser, and time counted in whole
// ticks of DT through `advance(n)` rather than a dt somebody accumulated. The walk-side test
// (tests/animal-walk.test.mjs) reads this source and fails on any of those. What that buys
// is the same thing it bought the settlers: a sea and a page stepping one hen from the same
// calls end up at the same millimetre, so if a page ever wants to run her forward between
// two rows it can, and a bug report about where she stood can be replayed.
//
// Three ways to move, and no fourth:
//
//   a leg on foot   a straight amble inside her patch, or - on an errand, or going home from
//                   one - the cells findPath gives from where she stands to where she is
//                   going, over land and round every building. A path that cannot be found is
//                   a straight line: a hen that cannot see a way round still goes, rather
//                   than standing for ever at the edge of a yard nobody fenced.
//   a hop           the sparrow's amble: a short straight leg, drawn as 'hop'. On the ground.
//   a flight        the sparrow's crossing: a straight line from here to there with a height
//                   arc 4k(1-k) on top - a parabola, so arithmetic - and never a path. Birds
//                   do not go round houses. It lands at h 0, always.
//
// What she is doing is `f.act`, a word out of ACTS (shared/animals.mjs), and which way she
// is turned is `f.face`, a direction [dx, dz] and never an angle - an angle needs atan2 and
// this file may not have one; the page turns a direction into a yaw with the atan2 it is
// entitled to. `f.h` is how high above the ground she is: a sparrow's flight, 0 on foot.
import { MOTION, motionOf, ACT_OF, STORY_SPECIES } from './animals.mjs';
import { findPath, dist, DT } from './settlerwalk.mjs';
import { GRID } from './settlerwire.mjs';
import { makeRng, hash32 } from './rng.mjs';

export { DT };

// How high a sparrow's crossing rises at its middle, in island units. Four metres a unit, so
// a little over two metres: above a hedge and below a roof ridge, which is where a sparrow
// crossing a village flies. A short hop of a flight inside its own garden rises less - see
// peakOf - or a bird going a metre would climb two to do it.
export const FLY_H = 0.6;
// How far one sparrow hop goes at most. Its amble is a string of these.
export const HOP_R = 0.3;
// How many paths may be planned in one tick. findPath is an A* with a 12000-expansion
// budget; six animals on an island make this a cap that almost never bites, and it is here
// so that a republish that sends every hen home at once still costs one tick what two
// searches cost. Whoever is over the cap stands still for a tick and asks again.
const PLANS_PER_TICK = 2;
// Closer than this to where she is going is there.
const ARRIVE = 0.02;
// A pause after an amble before the next decision, in seconds times `calm`: a hen that
// reaches the end of a stroll looks about before she does anything else.
const AFTER_AMBLE = [0.4, 1.4];

// One row on the wire (docs/animals-wire.md, `af`): seven numbers. Exported with its decoder
// so the page and the sea read one copy of the format.
export const AF_STRIDE = 7;
// How finely a facing hint travels: a direction as integers in -FACE_Q..FACE_Q. Sixteen is
// under four degrees at worst, far finer than a hen a few pixels high can show.
export const FACE_Q = 16;

// How high the arc of a flight of `len` units peaks. Proportional up to about two units and
// then flat, so a crossing of the village and a crossing of the street both look like birds.
function peakOf(len) {
  return FLY_H * Math.min(1, 0.3 + len / 3);
}

const quant = (v, half) => Math.round((v + half) * GRID);
const unquant = (q, half) => q / GRID - half;

// A figure as a row: [idx, qx, qz, act, qh, fx, fz]. `idx` is the caller's - the animal's
// place in the herd's list - because the walk does not know the order the wire speaks in.
export function animalRow(f, idx, half) {
  let fx = 0, fz = 0;
  if (f.face) {
    const d = dist(f.face[0], f.face[1]);
    if (d > 1e-9) {
      fx = Math.round((f.face[0] / d) * FACE_Q);
      fz = Math.round((f.face[1] / d) * FACE_Q);
    }
  }
  // `|| 0` folds -0 into 0: Math.round(-0.3) is -0, which JSON writes as 0 anyway but which
  // would make two identical rows compare unequal as strings on this side.
  return [idx, quant(f.pos[0], half) || 0, quant(f.pos[1], half) || 0, ACT_OF.get(f.act) ?? 0,
    Math.round(f.h * GRID) || 0, fx || 0, fz || 0];
}

// And back. Rows land in a map the far end keeps, by index, so an animal not in this message
// keeps whatever it was told last - the same bargain decodeCrowd makes. An act index a page
// has never heard of is the caller's to read as 'still' (ACTS[i] || 'still').
export function decodeAnimalRows(flat, half, into = new Map()) {
  if (!Array.isArray(flat)) return into;
  for (let i = 0; i + AF_STRIDE - 1 < flat.length; i += AF_STRIDE) {
    const row = flat.slice(i, i + AF_STRIDE);
    if (!row.every(Number.isFinite)) continue;
    into.set(row[0], {
      x: unquant(row[1], half),
      z: unquant(row[2], half),
      act: row[3],
      h: row[4] / GRID,
      face: row[5] || row[6] ? [row[5] / FACE_Q, row[6] / FACE_Q] : null,
    });
  }
  return into;
}

// `terrain` is the island's own (local coordinates, shared/terrain.mjs); `blocked` a Set of
// `gx + gz * size` cells nobody walks into - every building's plot, which lib/animal-crowd.mjs
// works out from the bundle. Both can be replaced while she walks (setGround), because an
// island republishes and a hen should not notice.
export function createAnimalWalk(terrain, { blocked = null } = {}) {
  const figures = new Map();   // animal id -> figure
  let ground = terrain;
  let walls = blocked || new Set();
  let finished = [];           // action ids completed since the last done()

  const cellOf = (x, z) => {
    const s = ground.size;
    const gx = Math.min(s - 1, Math.max(0, Math.round(x + ground.half - 0.5)));
    const gz = Math.min(s - 1, Math.max(0, Math.round(z + ground.half - 0.5)));
    return [gx, gz];
  };
  // Somewhere she may stand: land, and not inside anybody's walls. The sparrow is held to it
  // as well - she lands on the ground, at h 0, and a bird standing inside a house is a bird
  // inside a house on every screen.
  const standable = (x, z) => {
    const half = ground.half;
    if (x < -half || x > half || z < -half || z > half) return false;
    const [gx, gz] = cellOf(x, z);
    return ground.isLand(gx, gz) && !walls.has(gx + gz * ground.size);
  };

  // What her species and her traits make of her, recomputed whenever the islander says
  // something new about who she is (set). Unknown species walk like a hen: parseAnimals only
  // lets STORY_SPECIES through, so this is a belt and not a behaviour.
  function tune(f, a) {
    const species = STORY_SPECIES.includes(a.species) ? a.species : 'chicken';
    const m = MOTION[species];
    const t = motionOf(species, a.traits || []);
    f.species = species;
    f.traits = [...(a.traits || [])];
    f.home = [a.home[0], a.home[1]];
    f.r = a.r;
    f.motion = m;
    f.flies = !!m.flies;
    // The disc she lives in: the patch the islander gave her, widened or narrowed by her
    // species and her character (a restless goat wanders further than a homebody hen).
    f.roam = a.r * m.roam * t.roam;
    f.calm = t.calm;
    f.walkSpeed = m.walk * t.pace;
    f.hurrySpeed = m.hurry * t.pace;
  }

  // A point in her disc, drawn the way the settlers' idle wander draws one: a pair in the
  // square, kept when it falls inside the circle - uniform, and no cosine. Twelve tries, and
  // each is also held to `standable`, so a patch half in the sea still gets points on its
  // dry half; coming up empty means standing still for one more beat, never a point in the
  // water. Two draws a try, from her own stream, in this order.
  function pointAround(f, cx, cz, rad, within) {
    for (let tries = 0; tries < 12; tries++) {
      const u = f.rng.range(-1, 1);
      const v = f.rng.range(-1, 1);
      if (u * u + v * v > 1) continue;
      const x = cx + u * rad, z = cz + v * rad;
      if (within && dist(x - f.home[0], z - f.home[1]) > f.roam) continue;
      if (standable(x, z)) return [x, z];
    }
    return null;
  }

  function spawn(a) {
    // Her own stream, off her id. Ordered and load-bearing like a settler's `<id>:walk`: the
    // spot she starts on, her first pause and every decision after come out of it in turn,
    // so a line moved in here moves every animal on every island.
    const rng = makeRng(hash32(a.id + ':amble'));
    const f = {
      id: a.id,
      species: null, traits: [], home: null, r: 0, motion: null, flies: false,
      roam: 0, calm: 1, walkSpeed: 0, hurrySpeed: 0,
      rng,
      // ---- what the wire reads
      pos: null, h: 0, act: 'still', face: null,
      // ---- the idle life: how long she holds what she is doing, and what that is
      pause: 0, hold: 'still',
      // ---- going somewhere: the leg under her feet (or wings), and why
      leg: null, purpose: null,
      // A path she has asked for and not been given yet: 'go' or 'home' (PLANS_PER_TICK).
      plan: null,
      // ---- the errand: { id, act, dur, to, look, doing, left } or null
      errand: null,
      // The last action she finished. intend() of the same id again is nothing to walk - the
      // islander simply has not heard yet (lib/animal-crowd.mjs sends the done again).
      finished: null,
    };
    tune(f, a);
    f.pos = pointAround(f, f.home[0], f.home[1], f.roam, true) || [f.home[0], f.home[1]];
    f.pause = rng.range(0, 2) * f.calm;
    figures.set(f.id, f);
    return f;
  }

  // Who the animals are now: new ids are born inside their patch, known ones keep their
  // feet and take the new home, radius and traits (so an island republishing, or a trait
  // earned, never teleports anybody), and ids missing from the list are gone.
  function set(animals = []) {
    const want = new Map();
    for (const a of animals || []) if (a && typeof a.id === 'string' && Array.isArray(a.home)) want.set(a.id, a);
    for (const id of [...figures.keys()]) if (!want.has(id)) figures.delete(id);
    for (const a of want.values()) {
      const f = figures.get(a.id);
      if (f) tune(f, a);
      else spawn(a);
    }
  }

  // What the islander wants done now: at most one action per animal (parseAnimals holds the
  // sea to that). A new action - a different id from the one she is on - starts an errand
  // from wherever she is; the same id carries on; an animal whose errand is no longer in the
  // list lets it go quietly and walks home, and nothing is reported for it.
  function intend(actions = []) {
    const by = new Map();
    for (const a of actions || []) if (a && typeof a.animal === 'string' && !by.has(a.animal)) by.set(a.animal, a);
    for (const f of figures.values()) {
      const a = by.get(f.id);
      if (a && a.id === f.finished) continue;
      if (a && f.errand && f.errand.id === a.id) continue;
      if (a) {
        f.errand = {
          id: a.id, act: a.act, dur: a.dur,
          to: [a.to[0], a.to[1]],
          look: a.look ? [a.look[0], a.look[1]] : null,
          doing: false, left: a.dur,
        };
        f.leg = null; f.purpose = null; f.pause = 0;
        f.plan = 'go';
        continue;
      }
      if (f.errand) {
        f.errand = null;
        f.leg = null; f.purpose = null;
        f.plan = 'home';
      }
    }
  }

  // A leg: points to pass through, at a speed, drawn as an act. A flight carries its length
  // and its peak, and `h0` - the height she was at when it began, so a sparrow turned round
  // in mid-air eases down from where she is instead of dropping to the ground and climbing.
  function legOf(pts, speed, act, fly = false, h0 = 0) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return { pts, i: 0, speed, act, len, done: 0, peak: fly ? peakOf(len) : 0, h0: fly ? h0 : 0 };
  }

  // Over land and round the buildings, from where she stands to `to`. findPath works in
  // cells and answers cell middles; the first and last are swapped for her own feet and the
  // exact spot, so she neither steps back to the middle of her cell nor stops short.
  function footPath(f, to) {
    const from = cellOf(f.pos[0], f.pos[1]);
    const goal = cellOf(to[0], to[1]);
    if (from[0] === goal[0] && from[1] === goal[1]) return [[f.pos[0], f.pos[1]], [to[0], to[1]]];
    const cells = findPath(ground, from, goal, walls);
    if (!cells || cells.length < 2) return [[f.pos[0], f.pos[1]], [to[0], to[1]]];
    return [[f.pos[0], f.pos[1]], ...cells.slice(1, -1), [to[0], to[1]]];
  }

  // Set off: to the errand's spot at a hurry, or home at an amble. A bird flies either way.
  function depart(f, where, speed, purpose) {
    const to = where === 'home' ? f.home : f.errand.to;
    if (f.flies) f.leg = legOf([[f.pos[0], f.pos[1]], [to[0], to[1]]], f.hurrySpeed, 'fly', true, f.h);
    else f.leg = legOf(footPath(f, to), speed, 'walk');
    f.purpose = purpose;
  }

  // Along the leg by one tick's worth of distance. A corner reached part way through a tick
  // carries the rest of the tick round it, so a path of short cells is walked at the speed it
  // says. True when she has arrived.
  function stepLeg(f, dt) {
    const leg = f.leg;
    let budget = leg.speed * dt;
    while (budget > 0 && leg.i < leg.pts.length - 1) {
      const t = leg.pts[leg.i + 1];
      const dx = t[0] - f.pos[0], dz = t[1] - f.pos[1];
      const d = dist(dx, dz);
      if (d > 1e-6) f.face = [dx, dz];
      if (d <= budget) {
        f.pos = [t[0], t[1]];
        budget -= d;
        leg.done += d;
        leg.i++;
      } else {
        f.pos[0] += (dx / d) * budget;
        f.pos[1] += (dz / d) * budget;
        leg.done += budget;
        budget = 0;
      }
    }
    const there = leg.i >= leg.pts.length - 1;
    if (leg.peak || leg.h0) {
      const k = there || leg.len <= 0 ? 1 : Math.min(1, leg.done / leg.len);
      f.h = leg.h0 * (1 - k) + 4 * k * (1 - k) * leg.peak;
    }
    if (there) f.h = 0;
    f.act = leg.act;
    return there;
  }

  // Nothing to do, and the last thing is over: what next. One draw decides, and the draws
  // after it depend only on what it decided - so the stream stays in step with itself.
  function decide(f) {
    const m = f.motion;
    // Outside her patch - it moved (set), or she got there some other way: home first.
    if (dist(f.pos[0] - f.home[0], f.pos[1] - f.home[1]) > f.roam + 0.05) {
      f.plan = 'home';
      return;
    }
    const c = f.rng.next();
    if (f.flies) {
      if (c < 0.3) { f.hold = 'feed'; f.pause = f.rng.range(m.feed[0], m.feed[1]) * f.calm; return; }
      if (c < 0.6) {
        const p = pointAround(f, f.pos[0], f.pos[1], HOP_R, true);
        if (p) { f.leg = legOf([[f.pos[0], f.pos[1]], p], f.walkSpeed, 'hop'); f.purpose = 'amble'; return; }
      } else if (c < 0.8) {
        const p = pointAround(f, f.home[0], f.home[1], f.roam, true);
        if (p) { f.leg = legOf([[f.pos[0], f.pos[1]], p], f.hurrySpeed, 'fly', true, f.h); f.purpose = 'amble'; return; }
      }
      f.hold = 'still'; f.pause = f.rng.range(m.still[0], m.still[1]) * f.calm;
      return;
    }
    if (c < 0.35) { f.hold = 'feed'; f.pause = f.rng.range(m.feed[0], m.feed[1]) * f.calm; return; }
    if (c < 0.75) {
      const p = pointAround(f, f.home[0], f.home[1], f.roam, true);
      if (p) { f.leg = legOf([[f.pos[0], f.pos[1]], p], f.walkSpeed, 'walk'); f.purpose = 'amble'; return; }
    }
    f.hold = 'still'; f.pause = f.rng.range(m.still[0], m.still[1]) * f.calm;
  }

  function step(dt) {
    let planned = 0;
    for (const f of figures.values()) {
      // A path asked for: planned now if the tick has room, otherwise she stands a tick.
      if (f.plan) {
        if (planned >= PLANS_PER_TICK) { f.act = 'still'; continue; }
        planned++;
        const want = f.plan;
        f.plan = null;
        if (want === 'go' && f.errand) depart(f, 'errand', f.hurrySpeed, 'go');
        else depart(f, 'home', f.walkSpeed, 'home');
      }

      if (f.leg) {
        if (!stepLeg(f, dt)) continue;
        const why = f.purpose;
        f.leg = null; f.purpose = null;
        if (why === 'go' && f.errand) {
          f.errand.doing = true;
          f.errand.left = f.errand.dur;
          f.act = f.errand.act;
          if (f.errand.look) f.face = [f.errand.look[0] - f.pos[0], f.errand.look[1] - f.pos[1]];
        } else if (why === 'home') {
          f.hold = 'still'; f.act = 'still';
          f.pause = f.rng.range(f.motion.still[0], f.motion.still[1]) * f.calm;
        } else {
          f.hold = 'still'; f.act = 'still';
          f.pause = f.rng.range(AFTER_AMBLE[0], AFTER_AMBLE[1]) * f.calm;
        }
        continue;
      }

      if (f.errand && f.errand.doing) {
        // At it: the act, for its seconds, facing what she was told to face.
        f.act = f.errand.act;
        f.h = 0;
        if (f.errand.look) {
          const dx = f.errand.look[0] - f.pos[0], dz = f.errand.look[1] - f.pos[1];
          if (dist(dx, dz) > 1e-6) f.face = [dx, dz];
        }
        f.errand.left -= dt;
        if (f.errand.left <= 0) {
          finished.push(f.errand.id);
          f.finished = f.errand.id;
          f.errand = null;
          f.act = 'still';
          f.plan = 'home';
        }
        continue;
      }
      if (f.errand) {
        // An errand with no leg and no plan - arrived before it began (already standing on
        // the spot) or planned away by a republish. Ask again.
        f.plan = 'go';
        f.act = 'still';
        continue;
      }

      // Her own life, between errands.
      if (f.pause > 0) {
        f.pause -= dt;
        f.act = f.hold;
        continue;
      }
      f.act = 'still';
      decide(f);
    }
  }

  // Whole ticks of DT, the only way two machines agree - see shared/settlerwalk.mjs advance.
  function advance(ticks = 1) {
    for (let n = 0; n < ticks; n++) step(DT);
  }

  // The actions finished since the last call, in the order they finished. Drained, so each
  // is said once; lib/animal-crowd.mjs remembers them for the ones asked about again.
  function done() {
    const out = finished;
    finished = [];
    return out;
  }

  // A new island underneath - a republish (a house built on her patch, a polder, a grown
  // coast). Nobody moves: positions are local and stay meaningful on any grid the island
  // grows to, and a leg under way keeps its points. Only what comes next is planned on the
  // new ground.
  function setGround(t, b = null) {
    ground = t;
    walls = b || new Set();
  }

  function rows(order, half) {
    const out = [];
    (order || [...figures.keys()]).forEach((id, idx) => {
      const f = figures.get(id);
      if (f) out.push(animalRow(f, idx, half));
    });
    return out;
  }

  return {
    figures, set, intend, advance, step, done, setGround, rows,
    get: (id) => figures.get(id) || null,
    standable,
  };
}
