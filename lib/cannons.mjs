// The galleon's guns on the sea (Plans/kanonnen.md): a ball fired on somebody's deck is flown here
// too - the same closed-form flight as on every page (shared/cannon.mjs ballAt / ballHit) - to see
// whom it hurts where it comes down. Everybody's page draws the ball and the blast itself from the
// `{t:'cannon', a:'fire'}` the roster passes on; what only the sea can say is who was standing there,
// so this answers with `hurt()` (lib/health.mjs, cause `cannon`) and, when the ball came down on a
// body rather than on the ground, `{t:'cannon', a:'boom'}` so every page ends that ball where it hit.
//
// Who can be hurt is the keeper's call of 8 October 2026: players too, but never on their own island
// (the rule of Plans/open-world-pvp.md: your own island is always safe), and the volcano's guards and
// Codex residents through lib/combat.mjs's own `strike`. Not the one who fired it. Ships take no
// damage of their own beyond that? Since the keeper's answer of 8 October they do: a hull takes
// HULL_HITS balls (a galleon five, a rowing boat two) and then sinks - `{t:'boat', ...her mooring,
// sunk: [x, z]}`, which every page takes as "she went down there and is back at her berth", and her
// crew is in the water where she was. Never in her own island's waters (her harbour is safe), never
// a wanderer's skiff (it has no mooring to come back to). A ball on a hull also bursts and hurts
// whoever stands within the blast, the crew on her deck among them.
//
// In memory, like everything the sea holds, and stepped on its beat. A ball lives BALL_LIFE at most.
import { ballHit, blastOn, BALL_LIFE, BLAST_R, BALL_HIT, HULL_HITS, HULL_MEND_MS, ROWBOAT_BOX } from '../shared/cannon.mjs';
import { kindOf } from '../shared/crafts.mjs';
import { OPEN_SEA } from '../shared/regions.mjs';
import { frameOf } from './boats.mjs';
import { POSE } from './players.mjs';

// How many balls may be in the air at once, the world over: a ceiling against a page that sends
// shots as fast as the bucket lets it, not a rule of the game (the roster already holds one gun to
// one shot per RECOIL_S).
export const MAX_FLYING = 64;

export function createCannons({ fleet, roster, health, combat, broadcast = () => {}, now = () => Date.now() }) {
  const flying = [];
  const hulls = new Map();   // boat id -> { hits, at }: how many balls she has taken, and when the last

  // The island a boat belongs to: `boat:<island>` and `boat:<island>-<side><k>` (shared/quay.mjs).
  const islandOfBoat = (id) => { const m = /^boat:([0-9a-z]+)(?:-|$)/.exec(id); return m ? fleet.get?.(m[1]) || fleet.all().find((i) => i.id === m[1]) || null : null; };
  // A ball on her side: one more hit, unless she is in her own island's waters; at HULL_HITS she sinks.
  function hitHull(id) {
    if (!/^boat:[0-9a-z]/.test(id) || /^boat:w-/.test(id)) return null;
    // A boat nobody has touched is at her mooring, which is her own harbour: safe.
    const pose = roster.boats.pose(id);
    if (!pose) return { id, safe: true };
    const home = islandOfBoat(id);
    if (pose && home && home.terrain) {
      const lx = pose.x - home.origin[0], lz = pose.z - home.origin[1], h = home.terrain.half;
      if (lx > -h && lx < h && lz > -h && lz < h) return { id, safe: true };
    }
    const t = now();
    const was = hulls.get(id);
    const hits = (was && t - was.at < HULL_MEND_MS ? was.hits : 0) + 1;
    const of = HULL_HITS[kindOf(id)] || HULL_HITS.rowboat;
    if (hits < of) {
      hulls.set(id, { hits, at: t });
      broadcast({ t: 'cannon', a: 'hull', id, hits, of });
      return { id, hits, of };
    }
    hulls.delete(id);
    const w = roster.boats.wreck(id);
    if (!w) return { id, hits, of };
    for (const p of roster.all()) if (w.aboard.includes(p.id)) p.deck = null;
    broadcast({ t: 'boat', ...w.state, sunk: w.at });
    return { id, sunk: true };
  }

  // The ground under a world point: the island whose grid it is on, else open sea.
  function height(x, z) {
    for (const island of fleet.all()) {
      const t = island.terrain;
      if (!t) continue;
      const lx = x - island.origin[0], lz = z - island.origin[1];
      if (lx > -t.half && lx < t.half && lz > -t.half && lz < t.half) return t.worldHeight(lx, lz);
    }
    return OPEN_SEA;
  }
  // Whose island a world point is on, if anybody's.
  function islandAt(x, z) {
    for (const island of fleet.all()) {
      const t = island.terrain;
      if (!t) continue;
      const lx = x - island.origin[0], lz = z - island.origin[1];
      if (lx > -t.half && lx < t.half && lz > -t.half && lz < t.half) return island;
    }
    return null;
  }
  // Who a ball can come down on: on their feet or on a deck, outdoors, posed, not asleep. Unlike the
  // guards' `afoot`, a crew is in it - a deck is exactly where a gun is aimed.
  const targets = () => roster.all().filter((p) => p.walking && !p.room && p.posed !== false && !(p.f & POSE.ASLEEP));

  // A shot from `p`, checked by the roster (shared/cannon.mjs parseShot). `n` is the page's own
  // number for it, echoed in a boom.
  function fire(p, shot) {
    if (flying.length >= MAX_FLYING) flying.shift();
    flying.push({ shot: { o: shot.o, v: shot.v, b: shot.b || null, by: p.id }, by: p.id, n: shot.n ?? null, at: now(), done: 0 });
  }

  function land(f, hit) {
    const by = roster.all().find((q) => q.id === f.by) || null;
    for (const q of targets()) {
      if (q.id === f.by) continue;
      const amount = hit.kind === 'body' && hit.id === q.id ? BALL_HIT : blastOn(hit.kind === 'body' ? 'blast' : hit.kind, hit.at, [q.x, q.y, q.z]);
      if (!(amount > 0)) continue;
      // Your own island is always safe.
      const home = islandAt(q.x, q.z);
      if (home && q.island && home.id === q.island) continue;
      health.hurt(q, amount, { kind: 'cannon', island: home ? home.bundle.island.name : null });
    }
    if (combat && combat.blast && hit.kind !== 'splash' && hit.kind !== 'lost') combat.blast(hit.at, BLAST_R, BALL_HIT);
    if (hit.kind === 'hull' && hit.id) hitHull(hit.id);
    if (hit.kind === 'body') broadcast({ t: 'cannon', a: 'boom', by: f.by, n: f.n, at: hit.at, kind: 'body' });
    return by;
  }

  function tick() {
    if (!flying.length) return 0;
    const t = now();
    const ships = roster.boats.snapshot().filter((b) => /^boat:[0-9a-z]/.test(b.id))
      .map((b) => ({ id: b.id, ...frameOf(b), y: 0, ...(kindOf(b.id) === 'galleon' ? {} : { box: ROWBOAT_BOX }) }));
    const bodies = targets().map((p) => ({ id: p.id, x: p.x, y: p.y, z: p.z }));
    const world = { height, hulls: ships, bodies };
    let landed = 0, k = 0;
    for (const f of flying) {
      const to = Math.min(BALL_LIFE, (t - f.at) / 1000);
      const hit = to > f.done ? ballHit(f.shot, world, f.done, to) : null;
      f.done = to;
      if (hit) { land(f, hit); landed++; continue; }
      if (to >= BALL_LIFE) continue;
      flying[k++] = f;
    }
    flying.length = k;
    return landed;
  }

  return { fire, tick, hitHull, flying: () => flying.length, height };
}
