// The Salty Kraken inside (Plans/piratenkroeg.md): the pirates' pub by the harbour, the third
// room in interior.js's ROOMS beside the tavern and the castle's rave. Its outside is one crooked
// inn on a three by three (scripts/build-piratetavern.py); in here it is as big as it wants, which
// is the principle at the top of interior.js.
//
// A tavern built into a sea cave, with a ground floor and two storeys over it (schets 4 in the
// keeper's refs; Plans/verdiepingen-binnen.md for how storeys are walked). Every number is in
// web/js/kraken-layout.js, which the bake reads too, so what you see and where you walk cannot
// drift apart:
//
//   the pit       the ground floor: the door, the hearth in the rock, three trestle tables under
//                 a boat hung full of candles, the mast standing where three levels meet
//   the terrace   one step up along the north: a galleon's stern for a back bar and a piece of her
//                 hull for a counter, the rum cellar through a stone arch in the rock
//   the cabin     the first floor over the east and the hold under it: the captain, his chart
//                 table, his gold, the stern windows; a balcony over the cellar's corner in the west
//   the lofts     the second floor: the crew's hammocks under the rock, the treasure loft over the
//                 cabin, the crow's nest and the rope bridge between them
//
// What is drawn comes from two bakes: the hall (`piratetavern_room`, scripts/build-piratetavern-room.py:
// the shell and all its dressing) and the ship's parts (`krakenkit`, scripts/build-krakenkit.py), each
// placed here. What is only data is here: the floors and stairs as walk mode's `surfaces`, the blockers
// (with the height range they stand in, so a crate upstairs does not wall off the pit), the seats, the
// crew and their show, the lights.
//
// Three rules from the tavern that are not taste. **Exactly seven PointLights**: the number of
// lights is in the building material's program key, and the tavern has seven, so seven reuses a
// program already compiled and any other number is a stall in the doorway. **Nothing glows
// broader than a hand** (INDOOR_GLOW in interior.js): a broad glow is drawn turned down (`place`
// below), flames and gems are small enough for all of it, and the gold shines because the lamps are
// on it. **Seats are never blockers**: sitting puts you at a seat's centre.
//
// What moves is `createCrewShow` below: the crew at their tables, drawn with the island's own
// instanced settlers sitting (settler-figures.js `'sit'`), nodding to the shanty, turning to look
// at you, and the quest mark over whoever the story is waiting on - plus Captain Spack Jarrow,
// the one of them who is a model of his own (captain.js).
import * as THREE from 'three';
import { meshAsset } from './buildings.js';
import { createFigures, settlerLook } from './settler-figures.js';
import { createQuestMark, MARK_LIFT } from './quest-mark.js';
import { captainModel } from './captain.js';
import { SHANTY_SONG } from './sound.js';
import { CREW } from 'shared/quests.mjs';
import { lerpAngle } from 'shared/settlerwalk.mjs';
import * as K from './kraken-layout.js';
import { halosOf } from './room-glow.js';
import { PROPS, FOOT, EXTRA_BLOCKERS } from './kraken-dressing.js';

const { LEVEL, HALL, CELLAR, WALL, DOOR_HALF } = K;
const TABLE_H = 0.2;
const BENCH_Y = 0.135;
const SEAT_H = 0.19;         // a barrel stool, the tavern's height
const BAR = { x: K.KIT.counter.x, z: K.KIT.counter.z, hx: 1.74, hz: 0.15 };
const COUNTER_Y = K.KIT.counter.y + 0.31;
const BODY = 0.45;           // how high a body reaches over its feet, for a blocker's range

// The crew's looks. Every hat is one of HAT_SHAPES (`wide` reads as a tricorn, `band` as a bandana)
// and every outfit trousers - a skirt would show under a bench. HAT_SHAPES and the swatches are never
// added to here: the whole population draws from them. Where they sit is kraken-layout.js CREW_PLACES.
const CREW_LOOKS = {
  captain: { hatShape: 'wide', hat: 0x17161a, tunic: 0x9c2b27, trim: 0xc9a13b, build: 1.14 },
  navigator: { presentation: 'woman', hatShape: 'band', hat: 0x2e8b74, tunic: 0x2b4c7e, trim: 0x6b4a2f },
  bosun: { hatShape: 'band', hat: 0xd94f3d, tunic: 0x5a3c28, trim: 0x3a3a3f, build: 1.25 },
  lookout: { hatShape: 'band', hat: 0xf5efe0, tunic: 0x3d7ed9, trim: 0x4c5566, build: 0.92 },
  gunner: { presentation: 'woman', hatShape: 'none', tunic: 0x3a3a42, trim: 0x8a4b2a },
  cook: { hatShape: 'cap', hat: 0x3a3a3f, tunic: 0xf0e2c8, trim: 0x8a4b2a, build: 1.2 },
};
// Where the quest mark hangs, over the feet: over a head at a table, and over the captain's hat.
const MARK_AT = { seated: 0.8, captain: 0.95 };

// A glow broader than a hand is drawn turned down: a niche's back brightest low down and fading
// towards its vault - the soft light in the niche the keeper asked for, not a lit panel - and a
// window's night, or the sea through the arch, at a steady 0.45.
const NICHE = /niche glow/, PANE = / pane /;
// How many treads the bake gives a stair: `n = max(3, round(rise / .1))` in
// scripts/krakenroom/shell.py stair(), every tread's top on the slope at its own middle - so walk
// mode stands you on those (a surface's `steps`) instead of on the slope between them, which put the
// feet half a riser into the front of each tread. tests/stair-walk.test.mjs holds the two sums together.
export const treadsOf = (s) => Math.max(3, Math.round(Math.abs(s.y1 - s.y0) / 0.1));
// What walk mode walls a way up with (walk.js stairWall), as the bake builds it: a stair is solid to
// the floor under it - a block of timber under every tread - except the one over the hold
// (`solid = s['id'] != 'bar-captain'` in shell.py stair()), and railed on its open sides
// (shell.py open_sides(): not against the hall's wall, nor beside a floor as high as its top, which
// rails the stairwell itself); a gangplank and a ship's ladder carry a handrail down both sides.
// Without them you walked off the side of every flight to the floor, and in under its treads.
export function stairWalls(s) {
  const [c0, c1] = s.axis === 'z' ? ['x0', 'x1'] : ['z0', 'z1'];
  if (s.kind !== 'stair') return { rails: [c0, c1] };
  const hi = Math.max(s.y0, s.y1);
  const open = (side) => {
    const c = s[side];
    if (s.axis === 'z' && (Math.abs(c - HALL.x0) < 0.06 || Math.abs(c - HALL.x1) < 0.06)) return false;
    if (s.axis === 'x' && (Math.abs(c - HALL.z0) < 0.06 || Math.abs(c - HALL.z1) < 0.06)) return false;
    const mx = (s.x0 + s.x1) / 2;
    return !(s.axis === 'x' && K.FLOORS.some((f) => f.y >= hi - 0.01 && f.x0 <= mx && mx <= f.x1
      && (Math.abs(f.z1 - c) < 0.02 || Math.abs(f.z0 - c) < 0.02)));
  };
  return { solid: s.id !== 'bar-captain', rails: [c0, c1].filter(open) };
}
function place(out, asset, { x = 0, y = 0, z = 0, ry = 0 } = {}, keep = () => true) {
  const at = { x, y, z, ry };
  out.push(...meshAsset(asset, 0xffffff, { ...at, skip: (n) => !keep(n) || NICHE.test(n) || PANE.test(n) }));
  // A pane as broad as the sea arch's opening glowed the whole arch a flat blue at 0.45, the
  // loudest thing in the room: past a unit across a pane is the night itself, and takes 0.18.
  for (const g of meshAsset(asset, 0xffffff, { ...at, emissive: 0.45, skip: (n) => !keep(n) || !PANE.test(n) })) {
    g.computeBoundingBox();
    const s = g.boundingBox.getSize(new THREE.Vector3());
    if (Math.max(s.x, s.y, s.z) > 1) g.attributes.aEmissive.array.fill(0.18);
    out.push(g);
  }
  for (const g of meshAsset(asset, 0xffffff, { ...at, emissive: 0.65, skip: (n) => !keep(n) || !NICHE.test(n) })) {
    g.computeBoundingBox();
    const { min, max } = g.boundingBox, pos = g.attributes.position, e = g.attributes.aEmissive;
    for (let i = 0; i < e.count; i++) e.array[i] = 0.65 * (1 - 0.7 * (pos.getY(i) - min.y) / Math.max(max.y - min.y, 1e-6));
    out.push(g);
  }
}

export function buildPirateTavern({ FLOOR, rect }) {
  const parts = [], roof = [], blockers = [], seats = [], figures = [];
  // A blocker that stands between two heights of feet (Plans/verdiepingen-binnen.md), or on every
  // storey when it is a wall.
  const block = (b, y0 = null, y1 = null) => blockers.push(y0 == null ? b : { ...b, y0, y1 });

  // ---- what is drawn ------------------------------------------------------------------------
  // The hall's bake: its lid (ceilings, beams, the rock overhead, whatever hangs) goes to `roof`.
  const ROOF = /^Kraken roof /;
  place(parts, 'piratetavern_room', {}, (n) => !ROOF.test(n));
  place(roof, 'piratetavern_room', {}, (n) => ROOF.test(n));
  // The ship's parts.
  const kit = (asset, at, out = parts) => place(out, asset, at);
  kit('civic_kraken_stern', K.KIT.stern);
  const KIT = K.KIT;
  kit('civic_kraken_counter', KIT.counter);
  kit('civic_kraken_mast', KIT.mast);
  kit('civic_kraken_jukebox', KIT.jukebox);
  kit('civic_kraken_bow', { ...KIT.bow, sx: KIT.bow.s, sy: KIT.bow.s, sz: KIT.bow.s });
  kit('civic_kraken_figurehead', KIT.figurehead);
  for (const sl of K.SLOOPS) kit('civic_kraken_sloop', { x: sl.x, y: sl.y - KIT.sloop.flame, z: sl.z }, roof);
  kit('civic_kraken_wheel', KIT.wheel, roof);
  kit('civic_kraken_rudder', KIT.rudder, roof);
  for (const g of KIT.gunports) kit('civic_kraken_gunport', { x: g.x, y: FLOOR + 0.62, z: HALL.z1, ry: Math.PI });
  for (const c of KIT.sconces) kit('civic_kraken_skullsconce', c);
  kit('civic_kraken_skulllamp', KIT.skulllamp, roof);
  kit('civic_kraken_firebasket', KIT.firebasket);
  const stools = KIT.stools;
  for (let i = 0; i < stools.n; i++) kit('civic_kraken_stool', { x: stools.x0 + i * stools.step, y: stools.y, z: stools.z });
  const nav = K.CREW_PLACES.navigator;
  kit('civic_kraken_stool', { x: nav.x, y: nav.y, z: nav.z });

  // ---- the walls ----------------------------------------------------------------------------
  // Every segment a blocker of exactly its own size, as the tavern lays its washroom walls; the
  // rock in front of the north and west walls stays behind these lines where a body can reach it.
  const O = WALL / 2;
  const wallX = (x0, x1, z) => block(rect((x0 + x1) / 2, z, (x1 - x0) / 2, O));
  const wallZ = (z0, z1, x) => block(rect(x, (z0 + z1) / 2, O, (z1 - z0) / 2));
  // The gap is the arch itself: its jambs' faces stand on ARCH (shell.py cellar_arch()), and a gap
  // 0.08 wider each side let a body stand with a shoulder in the stone.
  wallX(HALL.x0 - WALL, K.ARCH[0], HALL.z0 - O);
  wallX(K.ARCH[1], HALL.x1 + WALL, HALL.z0 - O);
  // Over the arch the wall is wall again, from the cellar's ceiling up: the west gallery's north end
  // stands against it a storey up, and with the gap open to the roof it walked you off the gallery
  // into the cellar's mouth.
  block(rect((K.ARCH[0] + K.ARCH[1]) / 2, HALL.z0 - O, (K.ARCH[1] - K.ARCH[0]) / 2, O), FLOOR + CELLAR.ceiling, K.TOP);
  wallX(HALL.x0 - WALL, -DOOR_HALF, HALL.z1 + O);
  wallX(DOOR_HALF, HALL.x1 + WALL, HALL.z1 + O);
  wallZ(HALL.z0 - WALL, HALL.z1 + WALL, HALL.x0 - O);
  wallZ(HALL.z0 - WALL, HALL.z1 + WALL, HALL.x1 + O);
  wallZ(CELLAR.z0 - WALL, CELLAR.z1, CELLAR.x0 - O);
  wallX(CELLAR.x0 - WALL, CELLAR.x1 + WALL, CELLAR.z0 - O);
  wallZ(CELLAR.z0 - WALL, CELLAR.z1, CELLAR.x1 + O);
  // The cellar's bars round the treasure and their return to the north wall, and the hearth (its
  // jambs stand out of the rock; the mantel and the hearthstone are over and under a body).
  const CB = K.CELLAR_BARS;
  block(rect((CB.x0 + CB.x1) / 2, CB.z, (CB.x1 - CB.x0) / 2, 0.03));
  block(rect(CB.x0, (CELLAR.z0 + CB.z) / 2, 0.03, (CB.z - CELLAR.z0) / 2));
  const HE = K.HEARTH;
  block(rect((HALL.x0 + HE.x + HE.face) / 2, HE.z, (HE.x + HE.face - HALL.x0) / 2, HE.half));
  // The pool, which the eye takes for water and the feet for a wall, with the jetty left open; only
  // up to the captain's deck, whose own south edge is its rail.
  const P = K.POOL, J = K.JETTY;
  const pool = (x0, x1, z0, z1) => block(rect((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2), -1, LEVEL.captain - 0.1);
  pool(P.x0, P.x1, P.z0, J.z0);
  pool(P.x0, P.x1, J.z1, P.z1);
  pool(J.x1, P.x1, J.z0, J.z1);

  // ---- the terraces -------------------------------------------------------------------------
  // A terrace built up solid is a wall to a body on a lower level (one whose feet are more than a
  // step below its top); a deck on posts has room under it and only its posts get in the way.
  for (const f of K.FLOORS) {
    if (f.solid) block(rect((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2, (f.x1 - f.x0) / 2, (f.z1 - f.z0) / 2), -1, f.y - 0.46);
  }
  // Where a deck on posts stands a storey up beside a solid terrace (the captain's deck beside the
  // bar), the terrace's edge goes on up to the deck as a knee wall (shell.py bar()): a wall to a body
  // on the terrace and to nobody under the deck or on it. Without it the bar ran on under the deck at
  // head height and dropped you into the hold, into the bar's own block down there.
  for (const t of K.FLOORS.filter((f) => f.solid)) {
    for (const d of K.FLOORS.filter((f) => !f.solid && f.y > t.y + 0.45)) {
      const z0 = Math.max(t.z0, d.z0), z1 = Math.min(t.z1, d.z1), x0 = Math.max(t.x0, d.x0), x1 = Math.min(t.x1, d.x1);
      const knee = (b) => block(b, t.y - 0.1, d.y);
      if (z1 > z0 && (Math.abs(d.x0 - t.x1) < 1e-6 || Math.abs(d.x1 - t.x0) < 1e-6)) {
        knee(rect(Math.abs(d.x0 - t.x1) < 1e-6 ? t.x1 : t.x0, (z0 + z1) / 2, 0.02, (z1 - z0) / 2));
      }
      if (x1 > x0 && (Math.abs(d.z0 - t.z1) < 1e-6 || Math.abs(d.z1 - t.z0) < 1e-6)) {
        knee(rect((x0 + x1) / 2, Math.abs(d.z0 - t.z1) < 1e-6 ? t.z1 : t.z0, (x1 - x0) / 2, 0.02));
      }
    }
  }
  for (const p of K.POSTS) block({ x: p.x, z: p.z, r: K.POST_R }, p.y0 - BODY, p.y1);
  for (const r of K.RAILS) {
    const [x0, z0, x1, z1] = r.line;
    block(rect((x0 + x1) / 2, (z0 + z1) / 2, Math.max(Math.abs(x1 - x0) / 2, 0.02), Math.max(Math.abs(z1 - z0) / 2, 0.02)), r.level - 0.1, r.level + BODY);
  }
  // The low end of the gangplank up to the west gallery, which a body on the ground would otherwise
  // walk into rather than onto (where it is between a step and a head high).
  block(rect(-6.65, 1.67, 0.35, 0.47), -1, 0.2);
  // The crow's nest is round (its rail at KIT.mast.nestR) and its RAILS a square round that: in the
  // square's corners a body stood on the rim, the rail through its middle. A post in each corner, out
  // to where the rim is, keeps the centre of a body as far inside the rail as the square's sides do.
  const nest = K.FLOORS.find((f) => f.id === 'crows-nest');
  for (const x of [nest.x0, nest.x1]) {
    for (const z of [nest.z0, nest.z1]) {
      block({ x, z, r: Math.hypot(x - KIT.mast.x, z - KIT.mast.z) - KIT.mast.nestR }, nest.y - 0.1, nest.y + BODY);
    }
  }
  // The mast through all of it, and what stands round its foot on the pit: the plinth, and along the
  // yard the feet of the two ladders up to the nest, which the ladders' rope went through a body at.
  block({ x: KIT.mast.x, z: KIT.mast.z, r: 0.14 });
  block(rect(KIT.mast.x, KIT.mast.z, KIT.mast.foot.hx, KIT.mast.foot.hz), KIT.mast.y - BODY, KIT.mast.y + BODY);

  // ---- the furniture ------------------------------------------------------------------------
  // Nothing that stands on a floor is anything to stand on, so nothing is lower than a body to the
  // feet in the air either: a jump rises 0.38, and over a table's 0.3 or a barrel's 0.29 it came down
  // on the floor inside the thing and could only jump out again.
  const upTo = (floor, top) => Math.max(top, floor + BODY);
  block(rect(KIT.stern.x, KIT.stern.z, 1.8, 0.15));
  block(rect(BAR.x, BAR.z, BAR.hx, BAR.hz));
  block(rect(KIT.jukebox.x, KIT.jukebox.z, 0.17, 0.12));
  for (const t of K.TABLES) block(rect(t.x, t.z, 0.75, 0.14), LEVEL.pit - 0.1, upTo(LEVEL.pit, LEVEL.pit + 0.3));
  block({ x: K.KEG_TABLE.x, z: K.KEG_TABLE.z, r: 0.14 }, -1, upTo(LEVEL.ground, LEVEL.ground + 0.3));
  block(rect(K.CHART.x, K.CHART.z, 0.32, 0.21), LEVEL.captain - 0.1, LEVEL.captain + BODY);
  block(rect(K.CHAIR.x, K.CHAIR.z, 0.13, 0.13), LEVEL.captain - 0.1, LEVEL.captain + BODY);
  // Everything the dressing stood about the place (kraken-dressing.js): each prop's footprint for its
  // kind, turned and scaled - a turned rectangle as the box round it - from its floor to its top.
  for (const p of PROPS) {
    const f = FOOT[p.kind], h = { y0: p.y, y1: upTo(p.y, p.y + f.h * p.s) };
    if (f.r != null) { blockers.push({ x: p.x, z: p.z, r: f.r * p.s, ...h }); continue; }
    const c = Math.abs(Math.cos(p.ry || 0)), sn = Math.abs(Math.sin(p.ry || 0));
    blockers.push({ x: p.x, z: p.z, hx: (f.hx * c + f.hz * sn) * p.s, hz: (f.hx * sn + f.hz * c) * p.s, ...h });
  }
  for (const b of EXTRA_BLOCKERS) blockers.push({ ...b, y1: upTo(b.y0, b.y1) });

  // ---- seats ---------------------------------------------------------------------------------
  // `floor` is the storey a seat is on: walk mode offers it only to somebody standing there.
  for (let i = 0; i < stools.n; i++) {
    const sx = stools.x0 + i * stools.step;
    seats.push({
      id: `stool:${i}`, kind: 'seat', label: 'a bar stool', x: sx, z: stools.z, y: stools.y + SEAT_H, yaw: Math.PI, r: 0.42, floor: stools.y,
      beer: [sx - 0.07, COUNTER_Y, BAR.z + 0.04], snack: [sx + 0.08, COUNTER_Y, BAR.z + 0.045],
    });
  }
  // The benches: four places at every table, less the ones the crew sit in.
  const crewAt = Object.values(K.CREW_PLACES);
  const PIT = LEVEL.pit, TOP = PIT + TABLE_H + 0.028;
  for (const t of K.TABLES) {
    for (const [side, yaw] of [[-1, 0], [1, Math.PI]]) {
      for (const dx of [-0.35, 0.35]) {
        const x = t.x + dx, z = t.z + side * 0.32;
        if (crewAt.some((c) => Math.hypot(c.x - x, c.z - z) < 0.25)) continue;
        const toward = -side;
        seats.push({
          id: `bench:${t.id}:${side < 0 ? 'n' : 's'}${dx < 0 ? 0 : 1}`, kind: 'seat', label: 'a bench',
          x, z, y: PIT + BENCH_Y, yaw, r: 0.4, floor: PIT,
          beer: [x - 0.06, TOP, z + toward * 0.2], snack: [x + 0.08, TOP, z + toward * 0.2],
        });
      }
    }
  }
  for (const k of K.KEG_SEATS) {
    const G = LEVEL.ground, toward = [K.KEG_TABLE.x - k.x, K.KEG_TABLE.z - k.z], len = Math.hypot(...toward);
    seats.push({
      id: k.id, kind: 'seat', label: 'a keg', x: k.x, z: k.z, y: G + 0.16, yaw: k.yaw, r: 0.36, floor: G,
      beer: [k.x + toward[0] / len * 0.2, G + 0.22, k.z + toward[1] / len * 0.2],
      snack: [K.KEG_TABLE.x + 0.04, G + 0.22, K.KEG_TABLE.z - 0.05],
    });
  }

  // ---- who else is here ---------------------------------------------------------------------
  const { finn, meg } = K.FIGURES;
  figures.push({ style: 'unknown', look: { ...settlerLook('piratetavern:finn', 'unknown'), outfit: 'trousers', hatShape: 'wide', hat: 0x3a3a3f, tunic: 0x5b3a8e, trim: 0x6b4a2f }, at: [finn.x, finn.y, finn.z], yaw: 0.9, seed: 2.1 });
  block(rect(finn.x, finn.z, 0.11, 0.11), finn.y - BODY, finn.y + BODY);
  figures.push({
    style: 'unknown',
    look: { ...settlerLook('piratetavern:keep', 'unknown'), presentation: 'woman', outfit: 'trousers', hatShape: 'band', hat: 0x9c2b27, tunic: 0x2a2a30, trim: 0xc9a13b, build: 1.16 },
    at: [meg.x, meg.y, meg.z], seed: 0.7, tends: true,
  });
  block(rect(meg.x, meg.z, 0.11, 0.11), meg.y - BODY, meg.y + BODY);

  // ---- the crew ------------------------------------------------------------------------------
  const byId = new Map(CREW.map((c) => [c.id, c]));
  const crew = Object.entries(K.CREW_PLACES).map(([who, s]) => {
    const c = byId.get(who);
    return {
      who, name: c.name, idle: c.idle, x: s.x, z: s.z, y: s.y, yaw: s.yaw, stand: !!s.stand, look: CREW_LOOKS[who],
      ...(s.seat ? { seat: { h: s.seat, ...(s.seat > 0.15 ? { rest: 0.06 } : {}) } } : {}),
    };
  });
  const talkers = crew.map((m) => ({
    id: `crew:${m.who}`, kind: 'crew', who: m.who, name: m.name, idle: m.idle,
    x: m.x, z: m.z, r: 0.8, label: m.name, floor: m.y,
  }));

  return {
    name: 'the Salty Kraken',
    parts, roof, blockers, seats, lights: K.LIGHTS.map((l) => ({ ...l, at: [...l.at] })), figures, talkers,
    // The glow round every flame and lit window, read off the parts themselves, and the moonlight
    // through the skylights (room-glow.js; the light plan is kraken-layout.js LIGHTS).
    halos: halosOf(parts), roofHalos: halosOf(roof),
    shafts: K.SHAFTS.map((f) => {
      const [x0, x1, z0, z1] = K.SKYLIGHTS[f.sky];
      return { x0, x1, z0, z1, top: K.EAVES + 0.3, bottom: f.bottom, hex: f.hex, strength: f.strength, lean: f.lean };
    }),
    // The hearth burns the ray-marched fire (hearth-fire.js), not the tavern's two cones.
    flame: { at: [K.HEARTH_FIRE.x, K.HEARTH_FIRE.y, K.HEARTH_FIRE.z], lift: K.HEARTH_FIRE.lift, w: K.HEARTH_FIRE.w, h: K.HEARTH_FIRE.h, bed: [...K.HEARTH_FIRE.bed] },
    // The storeys and their stairs, as walk mode's surfaces (Plans/verdiepingen-binnen.md).
    // A stair (not a gangplank or a ladder, whose planks and rungs lie on the slope) is stood on
    // tread by tread, as the bake draws it (treadsOf), and every way up is walled where it is drawn
    // so (stairWalls).
    surfaces: [...K.FLOORS, ...K.STAIRS.map((s) => ({ ...s, ...(s.kind === 'stair' ? { steps: treadsOf(s) } : {}), ...stairWalls(s) }))],
    ceiling: K.CEILING,
    // The camera's rooms. The cellar carries its own low ceiling: from in there the lid comes off
    // as soon as the camera has to go above 1.2, not the hall's.
    areas: [{ ...HALL }, { ...CELLAR }],
    // On the steps down to the door, where you come in: the pit is a step up from there.
    spawn: { x: 0, z: HALL.z1 - 0.9 },
    doorway: { z: HALL.z1 + WALL, hx: DOOR_HALF + 0.02 },
    camera: { back: 2.6, up: 0.8, aim: 0.32 },
    // A night that is not black: the haze a touch cool so the far galleries fade into the moonlit
    // dark instead of into soot, and a cool sky in the hemisphere as the moon's fill from above -
    // it lights what faces up (decks, beams, the tops of the rigging) and leaves the undersides and
    // the corners to the lamps, or to the dark.
    background: 0x0b0a0f,
    fog: [12, 40],
    ambience: { sky: 0x44557a, ground: 0x1a0f0a, hemi: 0.7, hex: 0xffc898, amb: 0.08 },
    music: 'shanty',
    show: (opts) => createCrewShow({ ...opts, layout: { FLOOR, crew } }),
  };
}

// ------------------------------------------------------------------ the crew at their tables
const SPB = 60 / SHANTY_SONG.bpm;
// The jukebox's loop: every tune in it runs at the same count, so one beat carries through them all.
const LOOP_S = SHANTY_SONG.counts * SPB;
const LOOK_R = 1.0;          // how near you have to be for one of them to turn and look
const LOOK_SPAN = 0.75;      // and how far round in the seat they will turn to do it
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function createCrewShow({ scene, material, camera = null, layout }) {
  const view = createFigures(scene, material);
  const figs = [];
  const members = [];
  for (const m of layout.crew) {
    const id = `piratetavern:${m.who}`;
    const f = {
      id, pos: [m.x, m.z], y: m.y, yaw: m.yaw, faceAngle: m.yaw, visible: true,
      anim: m.stand ? 'still' : 'sit', mode: 'idle', speed: 0, beat: 0,
      ...(m.seat ? { seat: m.seat } : {}),
    };
    const look = { ...settlerLook(id, 'unknown'), outfit: 'trousers', presentation: 'man', ...m.look };
    if (!view.enrol(f, look, 'adult')) continue;
    figs.push(f);
    members.push({ m, f, lag: (members.length * 0.037) % 0.12 });
  }

  // The quest mark over whoever the story is waiting on (shared/quests.mjs businessWith).
  let mark = null;
  try { mark = createQuestMark(); scene.add(mark.sprite); } catch { mark = null; }

  // Captain Spack Jarrow: his own model once it has arrived (captain.js), standing where his
  // stand-in stands and turning the same way.
  const captain = members.find((c) => c.m.who === 'captain') || null;
  let model = null;
  const landed = (root) => {
    if (!captain || model) return;
    model = root;
    model.position.set(captain.m.x, captain.m.y, captain.m.z);
    model.rotation.y = captain.f.faceAngle;
    scene.add(model);
    captain.f.visible = false;
  };

  let own = 0, beats = 0, seconds = 0;
  function keepTime(dt, clock) {
    own = (own + dt) % LOOP_S;
    const t = clock == null ? own : clock;
    if (clock != null) own = clock;
    beats = t / SPB;
  }

  function update(dt, { clock = null, business = null } = {}, player = null) {
    keepTime(dt, clock);
    seconds += dt;
    for (const c of members) {
      const { m, f } = c;
      f.beat = m.stand ? null : beats + c.lag;
      // Turn to look at whoever comes near and stands roughly in front, and back to the table.
      let want = m.yaw;
      if (player) {
        const dx = player.x - m.x, dz = player.z - m.z;
        if (Math.hypot(dx, dz) < LOOK_R || (m.stand && Math.hypot(dx, dz) < LOOK_R * 1.6)) {
          const d = wrap(Math.atan2(dx, dz) - m.yaw);
          const span = m.stand ? Math.PI : LOOK_SPAN;
          if (Math.abs(d) < span + 0.9) want = m.yaw + Math.max(-span, Math.min(span, d));
        }
      }
      f.faceAngle = lerpAngle(f.faceAngle, want, 0.08);
      if (!m.stand && Math.random() < dt * 0.02) view.drinkBeer(f);
    }
    if (captain && model) model.rotation.y = captain.f.faceAngle;
    view.draw(figs, dt);
    if (mark) {
      const who = members.find((c) => c.m.who === business);
      if (who && camera) {
        const lift = who.m.stand ? MARK_AT.captain : MARK_AT.seated;
        mark.place(who.m.x, who.m.y + lift - MARK_LIFT, who.m.z, camera, seconds);
      } else mark.hide();
    }
  }

  return {
    enter: () => {
      own = 0;
      // The first step in starts the captain's model, and nothing waits for it.
      const ready = captainModel(landed);
      if (ready) landed(ready);
    },
    // A seated pirate does not step aside; neither does the captain - on their own storey only.
    blockers: () => members.map(({ m }) => ({ x: m.x, z: m.z, r: 0.12, y0: m.y - 0.45, y1: m.y + 0.45 })),
    beat: () => beats,
    update,
    mark: () => mark,
    figures: () => figs,
    dispose() {
      view.dispose();
      if (mark) mark.dispose();
      if (model && model.parent) model.parent.remove(model);
    },
  };
}
