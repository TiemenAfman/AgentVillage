// The Salty Kraken inside (Plans/piratenkroeg.md): the pirates' pub by the harbour, the third
// room in interior.js's ROOMS beside the tavern and the castle's rave. Its outside is one crooked
// inn on a three by three (scripts/build-piratetavern.py); in here it is as big as it wants, which
// is the principle at the top of interior.js.
//
// Not a box. The plan is four rectangles joined together, north up and the door south:
//
//   A  the hall, 9 x 7 under a 1.9 ceiling: the bar along the north wall, the hearth on the west,
//      three trestle tables down the middle, the snug walled off in the south-west corner
//   B  the rum cellar, a low vaulted niche behind the west end of the bar, through a stone arch:
//      a rack of kegs, a cask with a tap, and the open treasure chest behind iron bars
//   C  the captain's oriel, built out past the east wall: a deck of whole cells with a rail, the
//      chart table, the captain's chair, his heap of gold and the round window
//   D  the snug, the south-west corner behind a half wall under a low ceiling: the cannon, two
//      kegs for stools round a keg table, a sack of doubloons
//
// The camera is kept inside whichever of A, B and C you stand in (interior.js `areas`, the
// tavern's washroom); the snug is part of the hall to the camera, since a box that small left it
// nowhere to stand but in the rafters. Two parts have a low ceiling, and those ceilings are the
// room's `roof` like the rest of the lid: they go when the camera has to be above them.
//
// Three rules from the tavern that are not taste. **Exactly seven PointLights**: the number of
// lights is in the building material's program key, and the tavern has seven, so seven reuses a
// program already compiled and any other number is a stall in the doorway. **Nothing glows
// broader than a hand** (INDOOR_GLOW in interior.js): the niches' panels take 0.65 of the mask,
// flames take 1, and the gold shines because the lamps are on it, never on its own - only the
// gems glow. **Seats are never blockers**: sitting puts you at a seat's centre.
//
// What moves is `createCrewShow` below: the crew at their tables, drawn with the island's own
// instanced settlers sitting (settler-figures.js `'sit'`), nodding to the shanty, turning to look
// at you, and the quest mark over whoever the story is waiting on - plus Captain Spack Jarrow,
// the one of them who is a model of his own (captain.js).
import * as THREE from 'three';
import { box, cylinder, cone, sphere, dome, meshAsset } from './buildings.js';
import { createFigures, settlerLook } from './settler-figures.js';
import { createQuestMark, MARK_LIFT } from './quest-mark.js';
import { captainModel } from './captain.js';
import { SHANTY_SONG } from './sound.js';
import { CREW } from 'shared/quests.mjs';
import { lerpAngle } from 'shared/settlerwalk.mjs';

const HALF_W = 4.5;          // the hall, to the inner face of its east and west walls
const HALF_D = 3.5;          // and of its north and south walls
const WALL = 0.14;
const CEILING = 1.9;
const DOOR_HALF = 0.42;
const STAGE_H = 0.08;        // the step up onto the captain's deck
const TABLE_H = 0.2;
const BENCH_Y = 0.135;
const SEAT_H = 0.19;         // the bar stools, the tavern's

// The four parts, as the camera sees them (the snug is the hall's: see the top).
const A = { x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D };
const B = { x0: -4.5, x1: -1.6, z0: -4.9, z1: -HALF_D, ceiling: 1.2 };
const Cb = { x0: HALF_W, x1: 5.9, z0: -3.2, z1: -0.4 };
const D = { x0: -HALF_W, x1: -2.6, z0: 1.8, z1: HALF_D, ceiling: 1.25 };
const ARCH = [-3.8, -2.9];   // the way through into the cellar, in the hall's north wall
const STAGE = { x0: 3, x1: 6, z0: -4, z1: 0 };   // whole cells: the deck walk mode stands you on

const C = {
  tar: 0x2e241c, plaster: 0xbfa37a, floor: 0x4a3222, board: 0x2e1f15, darkWood: 0x3a261a,
  wood: 0x6b4a2f, oak: 0x845335, stone: 0x7d746a, flag: 0x5f5850, iron: 0x2c2d2f, brass: 0xc9a13b,
  copper: 0xb87333, gold: 0xd9a33d, goldHi: 0xe0b83c, silver: 0xc9ccd2, glass: 0xffc070,
  linen: 0xf0e2c8, flame: 0xffd23a, ember: 0xff8c3a, rope: 0xb89a68, net: 0x7a6a4c,
  float: 0x2ec4b6, purple: 0x5b3a8e, teal: 0x2ee6ff, bone: 0xece4d2, night: 0x24346e,
  curtain: 0x8e2f3a, rug: 0x6a2a2e, ruby: 0xc8323c, emerald: 0x2f9a58, sapphire: 0x2f5fc8,
  parchment: 0xe8d9b0, bottleGreen: 0x3e6a44, bottleBrown: 0x6a3e22, rum: 0x8a4a1a, black: 0x151417,
  sack: 0x9a7a4a,
};

// The crew's seats and looks. Every hat is one of HAT_SHAPES (`wide` reads as a tricorn, `band`
// as a bandana) and every outfit trousers - a skirt would show under a bench. HAT_SHAPES and the
// swatches are never added to here: the whole population draws from them.
const CREW_SEATS = {
  captain: { x: 4.75, z: -1.75, yaw: -0.8, stand: true,
    look: { hatShape: 'wide', hat: 0x17161a, tunic: 0x9c2b27, trim: 0xc9a13b, build: 1.14 } },
  navigator: { x: 3.55, z: -2.95, yaw: 0.93, seat: { h: SEAT_H, rest: 0.06 }, deck: true,
    look: { presentation: 'woman', hatShape: 'band', hat: 0x2e8b74, tunic: 0x2b4c7e, trim: 0x6b4a2f } },
  bosun: { x: -2.4, z: 0.68, yaw: 0, seat: { h: BENCH_Y },
    look: { hatShape: 'band', hat: 0xd94f3d, tunic: 0x5a3c28, trim: 0x3a3a3f, build: 1.25 } },
  lookout: { x: -1.8, z: 1.32, yaw: Math.PI, seat: { h: BENCH_Y },
    look: { hatShape: 'band', hat: 0xf5efe0, tunic: 0x3d7ed9, trim: 0x4c5566, build: 0.92 } },
  gunner: { x: 1.7, z: 0.78, yaw: 0, seat: { h: BENCH_Y },
    look: { presentation: 'woman', hatShape: 'none', tunic: 0x3a3a42, trim: 0x8a4b2a } },
  cook: { x: 1.2, z: -0.28, yaw: Math.PI, seat: { h: BENCH_Y },
    look: { hatShape: 'cap', hat: 0x3a3a3f, tunic: 0xf0e2c8, trim: 0x8a4b2a, build: 1.2 } },
};
// Where the quest mark hangs, over the feet: over a head at a table, and over the captain's hat.
const MARK_AT = { seated: 0.8, captain: 0.95 };

export function buildPirateTavern({ FLOOR, rect }) {
  const parts = [], roof = [], blockers = [], seats = [], lights = [], figures = [];
  const add = (...g) => parts.push(...g);
  const addRoof = (...g) => roof.push(...g);

  // ---- the shell ---------------------------------------------------------------------------
  // A wall is tarred planks to the waist and old plaster over them; every segment is a blocker
  // of exactly its own size, as the tavern lays its washroom walls.
  function wall(cx, cz, hx, hz, h = CEILING) {
    add(box(hx * 2, h, hz * 2, C.plaster, { x: cx, y: FLOOR, z: cz, sheet: 'wall' }));
    add(box(hx * 2 + 0.006, 0.55, hz * 2 + 0.006, C.tar, { x: cx, y: FLOOR, z: cz, sheet: 'plank' }));
    add(box(hx * 2 + 0.012, 0.03, hz * 2 + 0.012, C.darkWood, { x: cx, y: FLOOR + 0.55, z: cz }));
    blockers.push(rect(cx, cz, hx, hz));
  }
  // A wall along x from x0 to x1 at z, or along z from z0 to z1 at x.
  const wallX = (x0, x1, z, h) => wall((x0 + x1) / 2, z, (x1 - x0) / 2, WALL / 2, h);
  const wallZ = (z0, z1, x, h) => wall(x, (z0 + z1) / 2, WALL / 2, (z1 - z0) / 2, h);
  // The floor of one part: a slab built down to FLOOR, and boards (or flags) laid on it.
  function floorOf(a, { flags = false } = {}) {
    const w = a.x1 - a.x0, d = a.z1 - a.z0, mx = (a.x0 + a.x1) / 2, mz = (a.z0 + a.z1) / 2;
    add(box(w + WALL * 2, 0.24, d + WALL * 2, C.floor, { x: mx, y: FLOOR - 0.24, z: mz }));
    if (flags) {
      add(box(w, 0.008, d, C.flag, { x: mx, y: FLOOR - 0.004, z: mz, sheet: 'stone' }));
      return;
    }
    for (let z = a.z0 + 0.07; z < a.z1; z += 0.15) add(box(w, 0.008, 0.02, C.board, { x: mx, y: FLOOR - 0.004, z }));
  }
  // A ceiling over one part at its own height, and its beams across it.
  function lid(a, h, beamsAt = []) {
    const w = a.x1 - a.x0, d = a.z1 - a.z0, mx = (a.x0 + a.x1) / 2, mz = (a.z0 + a.z1) / 2;
    addRoof(box(w + WALL * 2, 0.1, d + WALL * 2, C.darkWood, { x: mx, y: FLOOR + h, z: mz, sheet: 'plank' }));
    for (const bz of beamsAt) addRoof(box(w, 0.1, 0.11, C.board, { x: mx, y: FLOOR + h - 0.1, z: bz }));
  }

  floorOf(A);
  floorOf(B, { flags: true });
  floorOf(Cb);
  const O = WALL / 2;
  // The hall: its north wall is broken by the cellar's arch, its east by the oriel, its south
  // by the door.
  wallX(-HALF_W - WALL, ARCH[0], -HALF_D - O);
  wallX(ARCH[1], HALF_W + WALL, -HALF_D - O);
  wallX(-HALF_W - WALL, -DOOR_HALF, HALF_D + O);
  wallX(DOOR_HALF, HALF_W + WALL, HALF_D + O);
  wallZ(-HALF_D - WALL, HALF_D + WALL, -HALF_W - O);
  wallZ(-HALF_D - WALL, Cb.z0, HALF_W + O);
  wallZ(Cb.z1, HALF_D + WALL, HALF_W + O);
  // Over the arch and over the oriel's opening, the wall goes on above head height.
  add(box(ARCH[1] - ARCH[0], CEILING - 0.95, WALL, C.plaster, { x: (ARCH[0] + ARCH[1]) / 2, y: FLOOR + 0.95, z: -HALF_D - O, sheet: 'wall' }));
  add(box(WALL, CEILING - 1.45, Cb.z1 - Cb.z0, C.plaster, { x: HALF_W + O, y: FLOOR + 1.45, z: (Cb.z0 + Cb.z1) / 2, sheet: 'wall' }));
  add(box(WALL + 0.06, 0.12, Cb.z1 - Cb.z0 + 0.1, C.darkWood, { x: HALF_W + O, y: FLOOR + 1.35, z: (Cb.z0 + Cb.z1) / 2 }));
  // The cellar's walls, to its own low ceiling.
  wallZ(B.z0 - WALL, B.z1, B.x0 - O, B.ceiling);
  wallX(B.x0 - WALL, B.x1 + WALL, B.z0 - O, B.ceiling);
  wallZ(B.z0 - WALL, B.z1, B.x1 + O, B.ceiling);
  // The oriel's.
  wallX(Cb.x0, Cb.x1 + WALL, Cb.z0 - O);
  wallX(Cb.x0, Cb.x1 + WALL, Cb.z1 + O);
  wallZ(Cb.z0, Cb.z1, Cb.x1 + O);
  // A lintel over the door and a worn step under it, as the tavern has.
  add(box(DOOR_HALF * 2 + 0.2, 0.2, WALL + 0.05, C.darkWood, { y: FLOOR + 1.0, z: HALF_D + O }));
  add(box(DOOR_HALF * 2 + 0.2, CEILING - 1.2, WALL, C.plaster, { y: FLOOR + 1.2, z: HALF_D + O, sheet: 'wall' }));
  add(box(DOOR_HALF * 2, 0.015, WALL + 0.12, C.stone, { y: FLOOR - 0.015, z: HALF_D + O }));

  // The stone arch into the cellar: two posts and a lintel of voussoirs.
  for (const x of ARCH) {
    add(box(0.14, 0.95, WALL + 0.06, C.stone, { x, y: FLOOR, z: -HALF_D - O, sheet: 'stone' }));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI, r = (ARCH[1] - ARCH[0]) / 2;
    add(box(0.12, 0.1, WALL + 0.07, C.stone, {
      x: (ARCH[0] + ARCH[1]) / 2 - Math.cos(a) * r, y: FLOOR + 0.8 + Math.sin(a) * 0.14, z: -HALF_D - O, rz: a - Math.PI / 2, sheet: 'stone',
    }));
  }

  // ---- ceilings: the hall's beams, the cellar's vault, the snug's low boards ----------------
  lid(A, CEILING, [-2.6, -1.3, 0, 1.3, 2.6]);
  lid(Cb, CEILING, [-2.4, -1.2]);
  // The cellar is a barrel vault: three ribs of short boxes over a low lid.
  lid(B, B.ceiling);
  for (const rx of [-4.1, -3.1, -2.1]) {
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * Math.PI, r = (B.z1 - B.z0) / 2;
      addRoof(box(0.08, 0.06, 0.2, C.stone, {
        x: rx, y: FLOOR + B.ceiling - 0.25 + Math.sin(a) * 0.2, z: (B.z0 + B.z1) / 2 - Math.cos(a) * r * 0.95, rx: a - Math.PI / 2,
      }));
    }
  }
  // The snug's low ceiling on its own posts, so it reads as a room inside the room.
  addRoof(box(D.x1 - D.x0, 0.06, D.z1 - D.z0, C.darkWood, { x: (D.x0 + D.x1) / 2, y: FLOOR + D.ceiling, z: (D.z0 + D.z1) / 2, sheet: 'plank' }));
  for (const bx of [-4.1, -3.4, -2.8]) addRoof(box(0.09, 0.08, D.z1 - D.z0, C.board, { x: bx, y: FLOOR + D.ceiling - 0.08, z: (D.z0 + D.z1) / 2 }));
  add(box(0.08, D.ceiling, 0.08, C.board, { x: D.x1, y: FLOOR, z: D.z0 }));
  blockers.push(rect(D.x1, D.z0, 0.04, 0.04));
  // Its half wall, with a rail along the top.
  add(box(D.x1 - D.x0, 0.5, 0.08, C.tar, { x: (D.x0 + D.x1) / 2, y: FLOOR, z: D.z0, sheet: 'plank' }));
  add(box(D.x1 - D.x0 + 0.04, 0.035, 0.12, C.darkWood, { x: (D.x0 + D.x1) / 2, y: FLOOR + 0.5, z: D.z0 }));
  blockers.push(rect((D.x0 + D.x1) / 2, D.z0, (D.x1 - D.x0) / 2, 0.04));

  // The hanging sloop over the middle of the hall, for a chandelier: a half hull of seven
  // strakes, two gunwales, three thwarts, four chains to the beam and six candles.
  const SLOOP = { x: 0.2, y: FLOOR + 1.3, z: 0.6 };
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI;
    addRoof(box(0.95, 0.02, 0.06, C.wood, { x: SLOOP.x, y: SLOOP.y - Math.sin(a) * 0.16, z: SLOOP.z - Math.cos(a) * 0.16, rx: a - Math.PI / 2 }));
  }
  for (const s of [-1, 1]) addRoof(box(1.0, 0.03, 0.03, C.darkWood, { x: SLOOP.x, y: SLOOP.y + 0.01, z: SLOOP.z + s * 0.16 }));
  for (const dx of [-0.3, 0, 0.3]) {
    addRoof(box(0.05, 0.015, 0.32, C.darkWood, { x: SLOOP.x + dx, y: SLOOP.y - 0.04, z: SLOOP.z }));
    for (const s of [-1, 1]) {
      addRoof(cylinder(0.009, 0.009, 0.04, 5, C.linen, { x: SLOOP.x + dx + s * 0.07, y: SLOOP.y - 0.025, z: SLOOP.z }));
      addRoof(sphere(0.012, C.flame, { x: SLOOP.x + dx + s * 0.07, y: SLOOP.y + 0.025, z: SLOOP.z, emissive: 1 }));
      addRoof(cone(0.008, 0.02, 4, C.linen, { x: SLOOP.x + dx + s * 0.07 + 0.008, y: SLOOP.y - 0.045, z: SLOOP.z, rx: Math.PI }));
    }
  }
  for (const [dx, dz] of [[-0.42, -0.15], [0.42, -0.15], [-0.42, 0.15], [0.42, 0.15]]) {
    const top = FLOOR + CEILING - 0.1, bottom = SLOOP.y + 0.02;
    addRoof(cylinder(0.005, 0.005, top - bottom, 4, C.iron, { x: SLOOP.x + dx, y: bottom, z: SLOOP.z + dz }));
  }
  // Lanterns on chains over the three tables and the bar.
  const LANTERN_Y = FLOOR + 1.35;
  const lantern = (lx, lz, y = LANTERN_Y) => {
    addRoof(cylinder(0.006, 0.006, FLOOR + CEILING - 0.1 - y, 4, C.iron, { x: lx, y, z: lz }));
    addRoof(cone(0.06, 0.05, 6, C.iron, { x: lx, y: y - 0.05, z: lz }));
    addRoof(sphere(0.035, C.glass, { x: lx, y: y - 0.09, z: lz, emissive: 1 }));
    addRoof(cylinder(0.04, 0.04, 0.012, 6, C.iron, { x: lx, y: y - 0.14, z: lz }));
  };
  for (const [lx, lz] of [[-2.0, -2.2], [-0.2, -2.2], [-2.1, 1.0], [1.9, 1.1], [1.2, -0.6]]) lantern(lx, lz);

  // ---- the bar, along the north wall --------------------------------------------------------
  // Shortened at its west end so there is a way round it into the cellar.
  const BAR_X = -0.9, BAR_HX = 1.7, BAR_Z = -2.55, BAR_HZ = 0.13, BAR_H = 0.28;
  const COUNTER_Y = FLOOR + BAR_H + 0.03;
  add(box(BAR_HX * 2, BAR_H, BAR_HZ * 2, C.darkWood, { x: BAR_X, y: FLOOR, z: BAR_Z, sheet: 'plank' }));
  add(box(BAR_HX * 2 + 0.08, 0.03, BAR_HZ * 2 + 0.08, C.wood, { x: BAR_X, y: FLOOR + BAR_H, z: BAR_Z }));
  blockers.push(rect(BAR_X, BAR_Z, BAR_HX, BAR_HZ));
  for (let i = -5; i <= 5; i++) add(box(0.05, BAR_H - 0.05, 0.02, C.board, { x: BAR_X + i * 0.31, y: FLOOR + 0.025, z: BAR_Z + BAR_HZ }));
  add(cylinder(0.014, 0.014, BAR_HX * 2, 6, C.brass, { x: BAR_X + BAR_HX, y: FLOOR + 0.08, z: BAR_Z + BAR_HZ + 0.055, rz: Math.PI / 2 }));
  // A keg with a tap on the counter's east end, a drip tray, tankards, coins and a dice cup.
  const kegAt = (x, y, z, o = {}) => {
    add(cylinder(0.06, 0.06, 0.16, 8, C.oak, { x, y, z, ...o }));
    for (const f of [0.03, 0.13]) add(cylinder(0.063, 0.063, 0.012, 8, C.iron, { x, y: y + f, z, ...o }));
  };
  kegAt(BAR_X + BAR_HX - 0.25, COUNTER_Y, BAR_Z - 0.02);
  add(box(0.04, 0.03, 0.08, C.brass, { x: BAR_X + BAR_HX - 0.25, y: COUNTER_Y + 0.05, z: BAR_Z + 0.08 }));
  add(box(0.3, 0.012, 0.09, C.iron, { x: BAR_X + 0.4, y: COUNTER_Y, z: BAR_Z + 0.02 }));
  for (const [dx, dz] of [[-1.2, 0.03], [-0.5, -0.04], [0.9, 0.02]]) add(cylinder(0.024, 0.022, 0.055, 7, C.wood, { x: BAR_X + dx, y: COUNTER_Y, z: BAR_Z + dz }));
  for (let i = 0; i < 6; i++) add(cylinder(0.012, 0.012, 0.004, 8, C.gold, { x: BAR_X - 0.2 + i * 0.03, y: COUNTER_Y + i * 0.004, z: BAR_Z - 0.03 }));
  add(cylinder(0.022, 0.026, 0.05, 8, C.darkWood, { x: BAR_X - 0.8, y: COUNTER_Y, z: BAR_Z - 0.05 }));

  // The back bar: a tall dresser against the north wall with three arched niches glowing purple,
  // teal and purple, bottles on its shelves.
  const SHELF_Z = -HALF_D + 0.1;
  add(box(3.6, 0.95, 0.2, C.darkWood, { x: BAR_X + 0.2, y: FLOOR, z: SHELF_Z, sheet: 'plank' }));
  blockers.push(rect(BAR_X + 0.2, SHELF_Z, 1.8, 0.1));
  for (const sy of [0.3, 0.55]) add(box(3.5, 0.02, 0.22, C.wood, { x: BAR_X + 0.2, y: FLOOR + sy, z: SHELF_Z + 0.02 }));
  const BOTTLES = [C.bottleGreen, C.bottleBrown, C.rum, C.bottleGreen, C.rum, C.bottleBrown];
  for (let i = 0; i < 32; i++) {
    const row = i >= 16 ? 1 : 0;
    const bx = BAR_X - 1.5 + (i % 16) * 0.22 + row * 0.08;
    if (Math.abs(bx - (BAR_X + 0.2)) < 0.28 && row) continue;
    const by = FLOOR + (row ? 0.57 : 0.32);
    add(cylinder(0.014, 0.018, 0.08, 6, BOTTLES[i % BOTTLES.length], { x: bx, y: by, z: SHELF_Z + 0.03 }));
    add(cylinder(0.006, 0.006, 0.03, 5, C.darkWood, { x: bx, y: by + 0.08, z: SHELF_Z + 0.03 }));
  }
  const NICHES = [[BAR_X - 0.9, C.purple], [BAR_X + 0.2, C.teal], [BAR_X + 1.3, C.purple]];
  for (const [nx, hex] of NICHES) {
    const NY = FLOOR + 0.95;
    add(box(0.34, 0.36, 0.06, C.black, { x: nx, y: NY, z: -HALF_D + 0.02 }));
    add(cylinder(0.17, 0.17, 0.06, 12, C.black, { x: nx, y: NY + 0.36, z: -HALF_D - 0.01, rx: Math.PI / 2 }));
    add(box(0.28, 0.3, 0.012, hex, { x: nx, y: NY + 0.03, z: -HALF_D + 0.055, emissive: 0.65 }));
    add(box(0.36, 0.03, 0.1, C.wood, { x: nx, y: NY - 0.02, z: -HALF_D + 0.04 }));
    for (const s of [-1, 1]) add(box(0.03, 0.4, 0.05, C.darkWood, { x: nx + s * 0.185, y: NY, z: -HALF_D + 0.04 }));
  }
  // In the middle niche a skull in a crown; in the others a ship in a bottle and an open jewel box.
  const SK = [BAR_X + 0.2, FLOOR + 1.06, -HALF_D + 0.12];
  add(sphere(0.05, C.bone, { x: SK[0], y: SK[1], z: SK[2] }));
  add(box(0.05, 0.03, 0.04, C.bone, { x: SK[0], y: SK[1] - 0.06, z: SK[2] + 0.01 }));
  for (const s of [-1, 1]) add(sphere(0.013, C.black, { x: SK[0] + s * 0.02, y: SK[1], z: SK[2] + 0.042 }));
  add(cylinder(0.042, 0.04, 0.03, 8, C.goldHi, { x: SK[0], y: SK[1] + 0.035, z: SK[2] }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    add(cone(0.01, 0.025, 4, C.goldHi, { x: SK[0] + Math.cos(a) * 0.036, y: SK[1] + 0.065, z: SK[2] + Math.sin(a) * 0.036 }));
  }
  add(sphere(0.008, C.ruby, { x: SK[0], y: SK[1] + 0.05, z: SK[2] + 0.04, emissive: 0.5 }));
  const SHIP = [BAR_X - 0.9, FLOOR + 1.0, -HALF_D + 0.12];
  add(cylinder(0.035, 0.035, 0.16, 8, C.bottleGreen, { x: SHIP[0] + 0.08, y: SHIP[1] + 0.035, z: SHIP[2], rz: Math.PI / 2 }));
  add(box(0.08, 0.02, 0.025, C.wood, { x: SHIP[0], y: SHIP[1] + 0.02, z: SHIP[2] }));
  add(box(0.003, 0.05, 0.003, C.darkWood, { x: SHIP[0], y: SHIP[1] + 0.04, z: SHIP[2] }));
  add(box(0.035, 0.03, 0.002, C.linen, { x: SHIP[0], y: SHIP[1] + 0.045, z: SHIP[2] }));
  const JB = [BAR_X + 1.3, FLOOR + 0.99, -HALF_D + 0.12];
  add(box(0.1, 0.05, 0.06, C.wood, { x: JB[0], y: JB[1], z: JB[2] }));
  add(box(0.1, 0.05, 0.008, C.wood, { x: JB[0], y: JB[1] + 0.05, z: JB[2] - 0.03, rx: -0.5 }));
  [C.ruby, C.emerald, C.sapphire, C.ruby, C.emerald, C.goldHi].forEach((hex, i) => {
    add(sphere(0.012, hex, { x: JB[0] - 0.035 + i * 0.014, y: JB[1] + 0.055, z: JB[2] + (i % 2 ? 0.01 : -0.01), emissive: hex === C.goldHi ? 0 : 0.5 }));
  });
  // The oil lamp hung in front of the middle niche.
  addRoof(cylinder(0.005, 0.005, 0.3, 4, C.iron, { x: BAR_X + 0.2, y: FLOOR + 1.5, z: -HALF_D + 0.3 }));
  addRoof(sphere(0.03, C.glass, { x: BAR_X + 0.2, y: FLOOR + 1.47, z: -HALF_D + 0.3, emissive: 1 }));

  // Five stools along the bar, facing it.
  const stoolZ = BAR_Z + BAR_HZ + 0.32;
  for (let i = 0; i < 5; i++) {
    const sx = -2.3 + i * 0.725;
    add(cylinder(0.022, 0.028, SEAT_H - 0.03, 7, C.darkWood, { x: sx, y: FLOOR, z: stoolZ }));
    add(cylinder(0.085, 0.078, 0.03, 10, C.wood, { x: sx, y: FLOOR + SEAT_H - 0.03, z: stoolZ }));
    add(cylinder(0.062, 0.062, 0.012, 8, C.iron, { x: sx, y: FLOOR + 0.06, z: stoolZ }));
    seats.push({
      id: `stool:${i}`, kind: 'seat', label: 'a bar stool', x: sx, z: stoolZ, y: FLOOR + SEAT_H, yaw: Math.PI, r: 0.42,
      beer: [sx - 0.07, COUNTER_Y, BAR_Z + 0.04], snack: [sx + 0.08, COUNTER_Y, BAR_Z + 0.045],
    });
  }

  // ---- the rum cellar ------------------------------------------------------------------------
  // A rack of six kegs on their sides, three-two-one, against the west wall; a cask on end with a
  // tap and a mug under it; and behind iron bars the open chest with its gold spilling out.
  const RACK = { x: -4.25, z: -4.2 };
  add(box(0.2, 0.04, 0.8, C.darkWood, { x: RACK.x, y: FLOOR, z: RACK.z }));
  for (const dz of [-0.36, 0.36]) add(box(0.2, 0.45, 0.04, C.darkWood, { x: RACK.x, y: FLOOR, z: RACK.z + dz }));
  for (const [row, n] of [[0, 3], [1, 2], [2, 1]]) {
    for (let i = 0; i < n; i++) {
      const kz = RACK.z + (i - (n - 1) / 2) * 0.13, ky = FLOOR + 0.1 + row * 0.115;
      // Laid on its side the cylinder is swung about z, which puts its centre at -h/2 in x.
      kegAt(RACK.x + 0.08, ky, kz, { rz: Math.PI / 2 });
    }
  }
  blockers.push(rect(RACK.x, RACK.z, 0.12, 0.4));
  add(cylinder(0.12, 0.13, 0.36, 10, C.oak, { x: -3.5, y: FLOOR, z: -4.6 }));
  for (const hy of [0.06, 0.28]) add(cylinder(0.133, 0.133, 0.02, 10, C.iron, { x: -3.5, y: FLOOR + hy, z: -4.6 }));
  add(box(0.03, 0.03, 0.08, C.brass, { x: -3.5, y: FLOOR + 0.12, z: -4.45 }));
  add(cylinder(0.022, 0.02, 0.05, 7, C.wood, { x: -3.5, y: FLOOR, z: -4.4 }));
  blockers.push(rect(-3.5, -4.6, 0.13, 0.13));
  // The cellar's lantern, on a hook.
  add(box(0.03, 0.03, 0.1, C.iron, { x: -2.9, y: FLOOR + 0.85, z: -4.85 }));
  add(sphere(0.03, C.glass, { x: -2.9, y: FLOOR + 0.8, z: -4.8, emissive: 1 }));
  // The treasure behind bars: the pirate's own sea chest with its lid thrown back, gold heaped
  // in it and over its edge, coins across the flags.
  const CH = { x: -2.2, z: -4.55 };
  add(...meshAsset('civic_pirate', 0xffffff, {
    x: CH.x, y: FLOOR, z: CH.z, sx: 1.2, sy: 1.2, sz: 1.2,
    skip: (n) => /mast|flag|skull|bone|chest lid|chest ridge|lid strap/.test(n),
  }));
  add(box(0.42, 0.06, 0.02, C.oak, { x: CH.x, y: FLOOR + 0.28, z: CH.z - 0.15, rx: -1.1 }));
  add(dome(0.11, C.gold, { x: CH.x, y: FLOOR + 0.2, z: CH.z }));
  for (let i = 0; i < 20; i++) {
    const a = i * 2.4, r = 0.12 + (i % 5) * 0.05;
    add(cylinder(0.012, 0.012, 0.003, 8, i % 3 ? C.gold : C.goldHi, { x: CH.x + Math.cos(a) * r, y: FLOOR + (i % 4) * 0.001, z: CH.z + 0.2 + Math.abs(Math.sin(a)) * r * 0.8 }));
  }
  add(sphere(0.012, C.ruby, { x: CH.x + 0.05, y: FLOOR + 0.27, z: CH.z + 0.03, emissive: 0.5 }));
  add(sphere(0.012, C.emerald, { x: CH.x - 0.06, y: FLOOR + 0.26, z: CH.z - 0.02, emissive: 0.5 }));
  const BARS_Z = -4.05;
  for (let x = -2.55; x <= -1.75; x += 0.09) add(box(0.016, B.ceiling - 0.05, 0.016, C.iron, { x, y: FLOOR, z: BARS_Z }));
  for (const y of [0.1, 0.6, 1.05]) add(box(0.84, 0.025, 0.025, C.iron, { x: -2.15, y: FLOOR + y, z: BARS_Z }));
  blockers.push(rect(-2.15, BARS_Z, 0.43, 0.03));

  // ---- the hearth, on the west wall ------------------------------------------------------------
  const FX = -4.25, FZ = 0.2;
  add(box(0.5, 0.95, 1.2, C.stone, { x: FX, y: FLOOR, z: FZ, sheet: 'stone' }));
  add(box(0.24, 0.42, 0.6, 0x1c1410, { x: FX + 0.14, y: FLOOR + 0.02, z: FZ }));
  add(box(0.6, 0.06, 1.3, C.darkWood, { x: FX + 0.04, y: FLOOR + 0.62, z: FZ }));
  add(box(0.3, CEILING - 0.95, 0.7, C.stone, { x: FX - 0.08, y: FLOOR + 0.95, z: FZ, sheet: 'stone' }));
  blockers.push(rect(FX, FZ, 0.25, 0.6));
  for (let i = 0; i < 3; i++) add(cylinder(0.02, 0.023, 0.26, 6, C.darkWood, { x: FX + 0.3, y: FLOOR + 0.035, z: FZ - 0.08 + i * 0.08, rz: Math.PI / 2 - 0.35 }));
  for (let i = 0; i < 5; i++) {
    const cz = FZ - 0.5 + i * 0.25;
    add(cylinder(0.011, 0.011, 0.06 + (i % 2) * 0.03, 6, C.linen, { x: FX + 0.2, y: FLOOR + 0.68, z: cz }));
    add(sphere(0.015, C.flame, { x: FX + 0.2, y: FLOOR + 0.76 + (i % 2) * 0.03, z: cz, emissive: 1 }));
  }
  // The ship's wheel over the mantel: a dark disc, eight handles out past the rim, a hub.
  const WH = [FX + 0.27, FLOOR + 1.2, FZ];
  add(cylinder(0.2, 0.2, 0.03, 12, C.wood, { x: WH[0] + 0.015, y: WH[1], z: WH[2], rz: Math.PI / 2 }));
  add(cylinder(0.14, 0.14, 0.034, 12, 0x1c1410, { x: WH[0] + 0.017, y: WH[1], z: WH[2], rz: Math.PI / 2 }));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(box(0.025, 0.06, 0.025, C.wood, { x: WH[0] - 0.005, y: WH[1] + Math.sin(a) * 0.24 - 0.03, z: WH[2] + Math.cos(a) * 0.24 }));
    add(box(0.02, 0.2, 0.02, C.wood, { x: WH[0], y: WH[1] - 0.1 + Math.sin(a) * 0.01, z: WH[2], rx: a }));
  }
  add(cylinder(0.04, 0.04, 0.05, 8, C.brass, { x: WH[0] + 0.03, y: WH[1], z: WH[2], rz: Math.PI / 2 }));
  // A jewelled cutlass and a flintlock crossed on the chimney breast, either side of the wheel.
  add(box(0.012, 0.018, 0.42, C.silver, { x: WH[0] - 0.02, y: WH[1] + 0.02, z: FZ - 0.52, rx: 0.5 }));
  add(box(0.02, 0.05, 0.05, C.goldHi, { x: WH[0] - 0.02, y: WH[1] - 0.12, z: FZ - 0.35 }));
  add(sphere(0.01, C.ruby, { x: WH[0] - 0.005, y: WH[1] - 0.1, z: FZ - 0.35, emissive: 0.5 }));
  add(box(0.02, 0.022, 0.28, C.iron, { x: WH[0] - 0.02, y: WH[1], z: FZ + 0.5, rx: -0.3 }));
  add(box(0.024, 0.08, 0.05, C.wood, { x: WH[0] - 0.02, y: WH[1] - 0.12, z: FZ + 0.38, rx: -0.3 }));
  // A rug, a wood pile and a red curtain beside it.
  add(box(0.9, 0.006, 1.1, C.rug, { x: FX + 0.9, y: FLOOR, z: FZ }));
  add(...meshAsset('prop_woodpile', 0xffffff, { x: -4.05, y: FLOOR, z: 1.25, ry: Math.PI / 2 }));
  blockers.push(rect(-4.05, 1.25, 0.2, 0.25));
  for (let i = 0; i < 6; i++) add(cylinder(0.03, 0.03, 1.2, 6, C.curtain, { x: -HALF_W + 0.05, y: FLOOR + 0.2, z: -1.7 + i * 0.07 }));
  // One-Eyed Finn, leaning on the chimney breast.
  figures.push({ style: 'unknown', look: { ...settlerLook('piratetavern:finn', 'unknown'), outfit: 'trousers', hatShape: 'wide', hat: 0x3a3a3f, tunic: 0x5b3a8e, trim: 0x6b4a2f }, at: [-3.8, FLOOR, -0.6], yaw: 0.9, seed: 2.1 });
  blockers.push(rect(-3.8, -0.6, 0.11, 0.11));

  // ---- three trestle tables, benches, and what is on them ----------------------------------
  const TABLES = [{ id: 't1', x: -2.1, z: 1.0 }, { id: 't2', x: 1.9, z: 1.1 }, { id: 't3', x: 1.2, z: -0.6 }];
  for (const t of TABLES) {
    add(box(1.5, 0.028, 0.5, C.oak, { x: t.x, y: FLOOR + TABLE_H, z: t.z, sheet: 'plank' }));
    for (const s of [-1, 1]) {
      add(box(0.04, TABLE_H, 0.4, C.darkWood, { x: t.x + s * 0.6, y: FLOOR, z: t.z, rz: s * 0.08 }));
      // A bench each side, and its two legs.
      const bz = t.z + s * 0.32;
      add(box(1.3, 0.025, 0.1, C.wood, { x: t.x, y: FLOOR + BENCH_Y - 0.025, z: bz, sheet: 'plank' }));
      for (const bx of [-0.5, 0.5]) add(box(0.035, BENCH_Y - 0.025, 0.08, C.darkWood, { x: t.x + bx, y: FLOOR, z: bz }));
    }
    // Thinner than the top: a bench seat is 0.32 off the middle, and a seat inside a blocker grown
    // by a body is one you cannot stand up from (walk.js steps nowhere that is blocked).
    blockers.push(rect(t.x, t.z, 0.75, 0.14));
    // A candle in a bottle, two tankards, three dice and a plate.
    const TOP = FLOOR + TABLE_H + 0.028;
    add(cylinder(0.02, 0.024, 0.07, 6, C.bottleGreen, { x: t.x, y: TOP, z: t.z }));
    add(cylinder(0.009, 0.009, 0.04, 6, C.linen, { x: t.x, y: TOP + 0.07, z: t.z }));
    add(sphere(0.015, C.flame, { x: t.x, y: TOP + 0.125, z: t.z, emissive: 1 }));
    for (const [dx, dz] of [[-0.35, -0.08], [0.4, 0.1]]) add(cylinder(0.024, 0.022, 0.055, 7, C.wood, { x: t.x + dx, y: TOP, z: t.z + dz }));
    for (let i = 0; i < 3; i++) add(box(0.018, 0.018, 0.018, C.bone, { x: t.x + 0.12 + i * 0.03, y: TOP, z: t.z - 0.1 + (i % 2) * 0.02, ry: i }));
    add(cylinder(0.05, 0.045, 0.008, 10, C.linen, { x: t.x - 0.15, y: TOP, z: t.z + 0.1 }));
  }
  // An oyster with a pearl on the second table.
  add(dome(0.03, 0x8a8a80, { x: 1.55, y: FLOOR + TABLE_H + 0.028, z: 1.0 }));
  add(sphere(0.012, C.linen, { x: 1.55, y: FLOOR + TABLE_H + 0.05, z: 1.0 }));
  // The free places on the benches, for the player. The crew's are theirs (CREW_SEATS).
  const TOP = FLOOR + TABLE_H + 0.028;
  for (const [id, x, z, yaw] of [
    ['bench:t1:s0', -2.45, 1.32, Math.PI], ['bench:t1:n1', -1.75, 0.68, 0],
    ['bench:t2:s0', 1.55, 1.42, Math.PI], ['bench:t2:s1', 2.2, 1.42, Math.PI], ['bench:t2:n1', 2.3, 0.78, 0],
    ['bench:t3:n0', 0.8, -0.92, 0], ['bench:t3:n1', 1.5, -0.92, 0], ['bench:t3:s1', 1.7, -0.28, Math.PI],
  ]) {
    const toward = yaw === 0 ? 1 : -1;
    seats.push({
      id, kind: 'seat', label: 'a bench', x, z, y: FLOOR + BENCH_Y, yaw, r: 0.4,
      beer: [x - 0.06, TOP, z + toward * 0.2], snack: [x + 0.08, TOP, z + toward * 0.2],
    });
  }

  // ---- the captain's oriel and its deck --------------------------------------------------------
  // The platform is drawn over the cells the deck covers that are floor: the hall's x 3 to 4.5
  // and the whole oriel.
  add(box(HALF_W - STAGE.x0, STAGE_H, HALF_D - STAGE.z1, C.wood, { x: (STAGE.x0 + HALF_W) / 2, y: FLOOR, z: (-HALF_D + STAGE.z1) / 2, sheet: 'plank' }));
  add(box(Cb.x1 - Cb.x0, STAGE_H, Cb.z1 - Cb.z0, C.wood, { x: (Cb.x0 + Cb.x1) / 2, y: FLOOR, z: (Cb.z0 + Cb.z1) / 2, sheet: 'plank' }));
  add(box(0.04, 0.015, HALF_D - STAGE.z1, C.darkWood, { x: STAGE.x0 + 0.02, y: FLOOR + STAGE_H, z: (-HALF_D + STAGE.z1) / 2 }));
  add(box(HALF_W - STAGE.x0, 0.015, 0.04, C.darkWood, { x: (STAGE.x0 + HALF_W) / 2, y: FLOOR + STAGE_H, z: STAGE.z1 - 0.02 }));
  // The rail along its west edge, with a gap at its south end to step up through.
  const RAIL_Z = [-HALF_D, -1.0];
  for (let z = RAIL_Z[0] + 0.1; z <= RAIL_Z[1]; z += 0.4) add(cylinder(0.02, 0.02, 0.3, 6, C.darkWood, { x: STAGE.x0 + 0.05, y: FLOOR + STAGE_H, z }));
  add(box(0.05, 0.04, RAIL_Z[1] - RAIL_Z[0], C.wood, { x: STAGE.x0 + 0.05, y: FLOOR + STAGE_H + 0.3, z: (RAIL_Z[0] + RAIL_Z[1]) / 2 }));
  blockers.push(rect(STAGE.x0 + 0.05, (RAIL_Z[0] + RAIL_Z[1]) / 2, 0.03, (RAIL_Z[1] - RAIL_Z[0]) / 2));
  const DECK = FLOOR + STAGE_H;
  // Quill's stool, at the chart table.
  const NAV = CREW_SEATS.navigator;
  add(cylinder(0.022, 0.028, SEAT_H - 0.03, 7, C.darkWood, { x: NAV.x, y: DECK, z: NAV.z }));
  add(cylinder(0.085, 0.078, 0.03, 10, C.wood, { x: NAV.x, y: DECK + SEAT_H - 0.03, z: NAV.z }));
  add(cylinder(0.062, 0.062, 0.012, 8, C.iron, { x: NAV.x, y: DECK + 0.06, z: NAV.z }));
  // The chart table: a chart, a compass, a silver candlestick and two gold goblets.
  const CT = { x: 4.15, z: -2.5 };
  add(box(0.64, 0.028, 0.42, C.oak, { x: CT.x, y: DECK + 0.2, z: CT.z }));
  for (const [dx, dz] of [[-0.28, -0.17], [0.28, -0.17], [-0.28, 0.17], [0.28, 0.17]]) add(box(0.04, 0.2, 0.04, C.darkWood, { x: CT.x + dx, y: DECK, z: CT.z + dz }));
  blockers.push(rect(CT.x, CT.z, 0.32, 0.21));
  const CTOP = DECK + 0.228;
  add(box(0.4, 0.004, 0.28, C.parchment, { x: CT.x - 0.04, y: CTOP, z: CT.z, ry: 0.1 }));
  add(cylinder(0.035, 0.035, 0.014, 10, C.brass, { x: CT.x + 0.2, y: CTOP, z: CT.z + 0.1 }));
  add(box(0.004, 0.004, 0.05, C.ruby, { x: CT.x + 0.2, y: CTOP + 0.015, z: CT.z + 0.1, ry: 0.6 }));
  add(cylinder(0.02, 0.028, 0.12, 6, C.silver, { x: CT.x - 0.25, y: CTOP, z: CT.z - 0.12 }));
  add(cylinder(0.008, 0.008, 0.04, 5, C.linen, { x: CT.x - 0.25, y: CTOP + 0.12, z: CT.z - 0.12 }));
  add(sphere(0.012, C.flame, { x: CT.x - 0.25, y: CTOP + 0.172, z: CT.z - 0.12, emissive: 1 }));
  for (const dx of [0.05, 0.14]) {
    add(cylinder(0.022, 0.012, 0.04, 8, C.goldHi, { x: CT.x + dx, y: CTOP + 0.03, z: CT.z - 0.13 }));
    add(cylinder(0.018, 0.018, 0.03, 6, C.goldHi, { x: CT.x + dx, y: CTOP, z: CT.z - 0.13 }));
  }
  // The captain's carved chair behind it, and his gold beside it: a heap, coins round it and a
  // goblet knocked over.
  const CHAIR = { x: 4.2, z: -3.05 };
  add(box(0.24, 0.03, 0.22, C.wood, { x: CHAIR.x, y: DECK + 0.16, z: CHAIR.z }));
  add(box(0.26, 0.5, 0.04, C.darkWood, { x: CHAIR.x, y: DECK, z: CHAIR.z - 0.12 }));
  for (const s of [-1, 1]) add(sphere(0.025, C.brass, { x: CHAIR.x + s * 0.12, y: DECK + 0.52, z: CHAIR.z - 0.12 }));
  add(cylinder(0.12, 0.14, 0.03, 8, C.darkWood, { x: CHAIR.x, y: DECK, z: CHAIR.z }));
  blockers.push(rect(CHAIR.x, CHAIR.z, 0.13, 0.13));
  const HEAP = { x: 5.3, z: -2.85 };
  add(dome(0.14, C.gold, { x: HEAP.x, y: DECK, z: HEAP.z }));
  for (let i = 0; i < 25; i++) {
    const a = i * 2.39996, r = 0.16 + (i % 6) * 0.03;
    add(cylinder(0.012, 0.012, 0.003, 8, i % 4 ? C.gold : C.goldHi, { x: HEAP.x + Math.cos(a) * r, y: DECK + (i % 3) * 0.001, z: HEAP.z + Math.sin(a) * r }));
  }
  add(cylinder(0.022, 0.012, 0.04, 8, C.goldHi, { x: HEAP.x - 0.2, y: DECK + 0.02, z: HEAP.z + 0.12, rx: Math.PI / 2 }));
  add(box(0.12, 0.05, 0.08, C.wood, { x: HEAP.x + 0.1, y: DECK, z: HEAP.z - 0.2 }));
  for (let i = 0; i < 4; i++) add(sphere(0.012, [C.ruby, C.sapphire, C.emerald, C.ruby][i], { x: HEAP.x + 0.07 + i * 0.02, y: DECK + 0.055, z: HEAP.z - 0.2, emissive: 0.5 }));
  blockers.push({ x: HEAP.x, z: HEAP.z, r: 0.18 });
  // A globe on a stand in the far corner, a string of pearls hung over it.
  const GL = { x: 5.5, z: -0.8 };
  add(cylinder(0.03, 0.06, 0.25, 6, C.darkWood, { x: GL.x, y: DECK, z: GL.z }));
  add(sphere(0.12, 0x3a6a7a, { x: GL.x, y: DECK + 0.37, z: GL.z }));
  for (let i = 0; i < 11; i++) {
    const a = (i / 10) * Math.PI;
    add(sphere(0.01, C.linen, { x: GL.x + Math.cos(a) * 0.125, y: DECK + 0.37 + Math.sin(a) * 0.125, z: GL.z + 0.01 }));
  }
  blockers.push({ x: GL.x, z: GL.z, r: 0.13 });
  // The round leaded window in the oriel's east wall, night-blue.
  const RW = [Cb.x1 - 0.005, FLOOR + 1.0, (Cb.z0 + Cb.z1) / 2];
  add(cylinder(0.32, 0.32, 0.03, 16, C.night, { x: RW[0] - 0.03, y: RW[1], z: RW[2], rz: Math.PI / 2, emissive: 0.5 }));
  add(cylinder(0.36, 0.36, 0.04, 16, C.darkWood, { x: RW[0] - 0.01, y: RW[1], z: RW[2], rz: Math.PI / 2 }));
  for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) add(box(0.012, 0.64, 0.012, C.iron, { x: RW[0] - 0.05, y: RW[1] - 0.32, z: RW[2], rx: a }));
  // The corner lantern.
  add(box(0.03, 0.03, 0.1, C.iron, { x: 3.2, y: FLOOR + 0.85, z: -3.45 }));
  add(sphere(0.035, C.glass, { x: 3.2, y: FLOOR + 0.8, z: -3.4, emissive: 1 }));

  // ---- the snug ------------------------------------------------------------------------------
  // The cannon, aimed at the door, on its carriage with a pyramid of shot.
  const CN = { x: -4.0, z: 3.0 };
  add(cylinder(0.05, 0.065, 0.5, 10, C.iron, { x: CN.x, y: FLOOR + 0.12, z: CN.z, rz: -Math.PI / 2 }));
  add(sphere(0.06, C.iron, { x: CN.x, y: FLOOR + 0.12, z: CN.z }));
  add(box(0.36, 0.08, 0.16, C.wood, { x: CN.x + 0.12, y: FLOOR + 0.03, z: CN.z }));
  for (const s of [-1, 1]) {
    for (const wx of [0, 0.26]) add(cylinder(0.05, 0.05, 0.03, 8, C.darkWood, { x: CN.x + wx, y: FLOOR + 0.05, z: CN.z + s * 0.1, rx: Math.PI / 2 }));
  }
  for (const [dx, dy, dz] of [[0, 0, 0], [0.05, 0, 0], [0.1, 0, 0], [0.025, 0.04, 0], [0.075, 0.04, 0], [0.05, 0.08, 0]]) add(sphere(0.025, C.black, { x: CN.x - 0.05 + dx, y: FLOOR + 0.025 + dy, z: CN.z - 0.28 + dz }));
  blockers.push(rect(CN.x + 0.12, CN.z, 0.3, 0.14));
  // Two kegs for stools round a keg for a table, a candle on it; a sack of doubloons; a crate of
  // bottles.
  const KT = { x: -3.3, z: 2.45 };
  add(cylinder(0.13, 0.13, 0.22, 10, C.oak, { x: KT.x, y: FLOOR, z: KT.z }));
  for (const hy of [0.04, 0.17]) add(cylinder(0.133, 0.133, 0.015, 10, C.iron, { x: KT.x, y: FLOOR + hy, z: KT.z }));
  add(cylinder(0.009, 0.009, 0.04, 6, C.linen, { x: KT.x, y: FLOOR + 0.22, z: KT.z }));
  add(sphere(0.013, C.flame, { x: KT.x, y: FLOOR + 0.275, z: KT.z, emissive: 1 }));
  blockers.push({ x: KT.x, z: KT.z, r: 0.14 });
  for (const [id, x, z, yaw] of [['keg:0', -2.9, 2.45, -Math.PI / 2], ['keg:1', -3.3, 2.88, Math.PI]]) {
    add(cylinder(0.09, 0.09, 0.14, 8, C.oak, { x, y: FLOOR, z }));
    add(cylinder(0.092, 0.092, 0.012, 8, C.iron, { x, y: FLOOR + 0.1, z }));
    const toward = [KT.x - x, KT.z - z], len = Math.hypot(...toward);
    seats.push({
      id, kind: 'seat', label: 'a keg', x, z, y: FLOOR + 0.16, yaw, r: 0.36,
      beer: [x + toward[0] / len * 0.2, FLOOR + 0.22, z + toward[1] / len * 0.2],
      snack: [KT.x + 0.04, FLOOR + 0.22, KT.z - 0.05],
    });
  }
  add(dome(0.12, C.sack, { x: -4.2, y: FLOOR, z: 2.15 }));
  add(cylinder(0.03, 0.05, 0.05, 6, C.sack, { x: -4.2, y: FLOOR + 0.15, z: 2.15 }));
  for (let i = 0; i < 6; i++) add(cylinder(0.012, 0.012, 0.003, 8, C.gold, { x: -4.05 + i * 0.03, y: FLOOR, z: 2.25 + (i % 2) * 0.03 }));
  blockers.push({ x: -4.2, z: 2.15, r: 0.13 });
  add(...meshAsset('prop_crate', 0xffffff, { x: -2.85, y: FLOOR, z: 3.2 }));
  for (let i = 0; i < 4; i++) add(cylinder(0.014, 0.018, 0.07, 6, BOTTLES[i], { x: -2.9 + (i % 2) * 0.06, y: FLOOR + 0.22, z: 3.15 + (i >> 1) * 0.06 }));
  blockers.push(rect(-2.85, 3.2, 0.14, 0.14));

  // ---- walls, windows and what hangs on them ---------------------------------------------------
  // Two fishing nets flat on the east wall, south of the oriel, with glass floats.
  for (const [nz, n] of [[0.7, 7], [2.2, 6]]) {
    for (let i = 0; i < n; i++) {
      for (const s of [-1, 1]) add(box(0.006, 1.0, 0.006, C.net, { x: HALF_W - 0.015, y: FLOOR + 0.5, z: nz - 0.45 + i * 0.15, rx: s * Math.PI / 4 }));
    }
    for (let i = 0; i < 3; i++) add(sphere(0.03, C.float, { x: HALF_W - 0.04, y: FLOOR + 0.7 + (i % 2) * 0.25, z: nz - 0.3 + i * 0.3, emissive: 0.3 }));
  }
  // Coils of rope.
  for (const [rx, rz] of [[4.3, 3.3], [-1.3, 3.35]]) {
    add(cylinder(0.1, 0.1, 0.05, 10, C.rope, { x: rx, y: FLOOR, z: rz }));
    add(cylinder(0.07, 0.07, 0.03, 10, C.rope, { x: rx, y: FLOOR + 0.05, z: rz }));
  }
  // The round leaded window in the south wall, two square ones west of the door, portholes east.
  const SW = [2.4, FLOOR + 1.0, HALF_D - 0.005];
  add(cylinder(0.32, 0.32, 0.03, 16, C.night, { x: SW[0], y: SW[1], z: SW[2] - 0.03, rx: Math.PI / 2, emissive: 0.5 }));
  add(cylinder(0.36, 0.36, 0.035, 16, C.darkWood, { x: SW[0], y: SW[1], z: SW[2] - 0.01, rx: Math.PI / 2 }));
  for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) add(box(0.012, 0.64, 0.012, C.iron, { x: SW[0], y: SW[1] - 0.32, z: SW[2] - 0.05, rz: a }));
  for (const wx of [-1.4, -2.2]) {
    add(box(0.34, 0.38, 0.03, C.night, { x: wx, y: FLOOR + 0.7, z: HALF_D - 0.012, emissive: 0.4 }));
    add(box(0.38, 0.04, 0.05, C.darkWood, { x: wx, y: FLOOR + 0.69, z: HALF_D - 0.03 }));
    add(box(0.04, 0.4, 0.05, C.darkWood, { x: wx, y: FLOOR + 0.69, z: HALF_D - 0.03 }));
    add(box(0.38, 0.04, 0.05, C.darkWood, { x: wx, y: FLOOR + 1.07, z: HALF_D - 0.03 }));
  }
  for (const px of [3.4, 4.0]) {
    add(cylinder(0.1, 0.1, 0.03, 10, C.brass, { x: px, y: FLOOR + 0.9, z: HALF_D - 0.02, rx: Math.PI / 2 }));
    add(cylinder(0.075, 0.075, 0.034, 10, C.night, { x: px, y: FLOOR + 0.9, z: HALF_D - 0.025, rx: Math.PI / 2, emissive: 0.4 }));
  }
  // WANTED by the door: a plank with three bills.
  add(box(0.5, 0.36, 0.02, C.wood, { x: 0.85, y: FLOOR + 0.55, z: HALF_D - 0.02 }));
  for (let i = 0; i < 3; i++) add(box(0.12, 0.16, 0.004, C.parchment, { x: 0.7 + i * 0.15, y: FLOOR + 0.62 - (i % 2) * 0.03, z: HALF_D - 0.032, rz: (i - 1) * 0.08 }));
  // Barrels and crates in the south-east corner, stacked.
  for (const [bx, bz] of [[3.65, 2.6], [3.95, 3.0], [4.2, 2.55]]) {
    add(...meshAsset('prop_barrel', 0xffffff, { x: bx, y: FLOOR, z: bz }));
    blockers.push({ x: bx, z: bz, r: 0.14 });
  }
  for (const [cx, cz, cy] of [[3.35, 3.15, 0], [3.35, 3.15, 0.2], [3.1, 3.2, 0]]) add(...meshAsset('prop_crate', 0xffffff, { x: cx, y: FLOOR + cy, z: cz, ry: cy ? 0.3 : 0 }));
  blockers.push(rect(3.22, 3.18, 0.28, 0.16));

  // ---- Old Meg, behind the bar -----------------------------------------------------------------
  figures.push({
    style: 'unknown',
    look: { ...settlerLook('piratetavern:keep', 'unknown'), presentation: 'woman', outfit: 'trousers', hatShape: 'band', hat: 0x9c2b27, tunic: 0x2a2a30, trim: 0xc9a13b, build: 1.16 },
    at: [BAR_X, FLOOR, -3.05], seed: 0.7, tends: true,
  });
  blockers.push(rect(BAR_X, -3.05, 0.11, 0.11));

  // ---- light: exactly seven (see the top) ------------------------------------------------------
  lights.push(
    { hex: 0xff8c3a, intensity: 1.6, dist: 2.6, at: [-4.0, FLOOR + 0.3, FZ], flicker: true },
    { hex: 0xffc98a, intensity: 1.3, dist: 3.0, at: [-2.4, FLOOR + 1.3, -2.2] },
    { hex: 0xffc98a, intensity: 1.3, dist: 3.0, at: [-0.2, FLOOR + 1.3, -2.2] },
    { hex: 0x8a5cff, intensity: 1.0, dist: 2.4, at: [-1.2, FLOOR + 0.55, -3.2] },
    { hex: 0xffd9a0, intensity: 1.5, dist: 3.6, at: [SLOOP.x, FLOOR + 1.35, SLOOP.z], flicker: true },
    { hex: 0xffd9a0, intensity: 1.1, dist: 2.6, at: [3.2, FLOOR + 0.9, -2.2] },
    { hex: 0x5a7cff, intensity: 0.9, dist: 2.8, at: [2.4, FLOOR + 1.0, 3.0] },
  );

  // ---- the crew ----------------------------------------------------------------------------------
  const byId = new Map(CREW.map((c) => [c.id, c]));
  const crew = Object.entries(CREW_SEATS).map(([who, s]) => {
    const c = byId.get(who);
    const y = s.deck || s.stand ? DECK : FLOOR;
    return { who, name: c.name, idle: c.idle, ...s, y };
  });
  const talkers = crew.map((m) => ({
    id: `crew:${m.who}`, kind: 'crew', who: m.who, name: m.name, idle: m.idle,
    x: m.x, z: m.z, r: 0.8, label: m.name,
  }));

  const layout = { FLOOR, DECK, crew };
  return {
    name: 'the Salty Kraken',
    parts, roof, blockers, seats, lights, figures, talkers,
    fireAt: [FX + 0.3, FLOOR + 0.03, FZ],
    stage: { ...STAGE, height: DECK },
    ceiling: CEILING,
    // The camera's rooms. The cellar carries its own low ceiling: from in there the lid comes off
    // as soon as the camera has to go above 1.2, not 1.9.
    areas: [A, B, Cb],
    spawn: { x: 0, z: HALF_D - 1.9 },
    doorway: { z: HALF_D + WALL, hx: DOOR_HALF + 0.02 },
    camera: { back: 2.3, up: 0.7, aim: 0.32 },
    background: 0x0d0806,
    fog: [6, 20],
    ambience: { sky: 0x4a3a30, ground: 0x160c08, hemi: 0.32, hex: 0xffd6b0, amb: 0.16 },
    music: 'shanty',
    show: (opts) => createCrewShow({ ...opts, layout }),
  };
}

// ------------------------------------------------------------------ the crew at their tables
const SPB = 60 / SHANTY_SONG.bpm;
const LOOP_S = SHANTY_SONG.bars * SHANTY_SONG.beatsPerBar * SPB;
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
    // A seated pirate does not step aside; neither does the captain.
    blockers: () => members.map(({ m }) => ({ x: m.x, z: m.z, r: 0.12 })),
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
