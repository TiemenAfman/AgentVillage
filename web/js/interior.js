// The rooms you can step into. Everything indoors on this island used to be a panel over
// the picture -- the sprint board, the market, the register in the town hall -- and this is
// the first place you actually stand in.
//
// A room is its own little scene: its own floor, its own lights, its own walk mode. That is
// what lets the hall be the size a hall should be. Hollowed out of the shell that stands on
// the plot, a bar you could walk around would make the tavern the largest thing on the
// island, towering over the village it belongs to; kept apart, the outside stays cottage
// sized and the inside is as roomy as it likes -- roomy enough, in particular, to keep the
// camera behind your shoulder, which is how you look at the island everywhere else.
//
// Adding a room is one entry in ROOMS.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, cone, sphere, dome } from './buildings.js';
import { figureGeometry } from './settlers.js';
import { createWalkMode } from './walk.js';
import { clamp } from 'shared/rng.mjs';

// Walk mode reads anything below 0.06 as water you cannot stand on, so an indoor floor
// stands at exactly that: the slab is built downwards to bring its top surface up to here.
const FLOOR = 0.06;
// Indoors the lamps are lit whatever the hour: a room with its shutters closed does not grow
// darker because it is noon outside. Read by whoever owns the shared building material.
//
// The shared shader scales the emissive mask by (0.25 + uNight * 1.7), so this doubles as the
// room's exposure. Half puts a fully lit face at about its own colour -- hot enough for a lamp
// globe or a candle flame, which is what should be hot -- and anything broader than a hand
// takes a fraction of the mask instead. At the island's night value the mirror over the bar
// came out as a plain white rectangle.
export const INDOOR_GLOW = 0.5;

const C = {
  plaster: 0xe6d7b8, wainscot: 0x6b4a2f, plank: 0xb07a4a, floor: 0x9c6b3f,
  darkWood: 0x5a3c28, wood: 0x8b5e3c, stone: 0xa8a59e, iron: 0x3a3a3f,
  copper: 0xb87333, brass: 0xd9a33d, glass: 0xffd27f, mirror: 0x9fb3bf,
  bottleGreen: 0x4a7a4a, bottleBrown: 0x7a4a2a, ale: 0xd9a33d, linen: 0xf5efe0,
  ember: 0xff8c3a, flame: 0xffd23a, brick: 0x9c5a44, slate: 0x2f3a33, seat: 0x8a3f36,
  curtain: 0x8e2f3a, tile: 0xd8e2e6, porcelain: 0xf4f7f8, croquette: 0x8a5a2a,
  mustard: 0xe8c33a, stageLamp: 0xd94fa8,
};

// What you cannot walk through, as a centre and half extents in room space. Given by hand
// rather than measured off the geometry with `footprintOf`: that helper glues rectangles that
// nearly touch, which is exactly right for a building seen from outside -- it stops a row of
// market stalls becoming a maze -- but indoors it would weld the four walls into one solid
// block with the room sealed inside it.
//
// Seats are deliberately absent from this list. A stool you can bump into is a stool you get
// stuck inside: sitting puts you at its centre, and the first step off would be a step into a
// wall. Nothing you are meant to sit on blocks, and neither does the stage -- you walk up
// onto that.
function rect(x, z, hx, hz) { return { x, z, hx, hz }; }

// ------------------------------------------------------------------ the tavern
// Bar along the north wall with the barman behind it, the fire on the west wall, the karaoke
// stage against the east, the toilets walled off in the south-west corner, tables down the
// middle with a clear run between them, and the door in the south wall.
//
// Everything is built at the scale the rest of the island uses, which is worth writing down
// because getting it wrong is what makes a room look like a doll's house with a giant in it.
// A settler is 0.45 tall (settlers.js) and the tables on the town square stand 0.2 high with
// a 0.42 top (buildings.js, `case 'tables'`), so a unit is about four metres and a table
// comes to a little under half a body. The first cut of this room had tables 0.9 across and
// 0.3 high -- three and a half metres wide, chest high on a grown settler -- and the hall
// read as a barn full of furniture for somebody else.
//
// The room itself is deliberately generous: six units by five, which is a hall rather than a
// snug, and leaves the camera somewhere to stand.
const HALF_W = 3.0;          // to the inner face of the east and west walls
const HALF_D = 2.5;          // to the inner face of the north and south walls
const WALL = 0.12;
const DOOR_HALF = 0.38;      // half the opening; a body is 0.32 across and needs the room
const CEILING = 1.25;        // about five metres, and well clear of the 0.38 a jump rises
const STAGE_H = 0.08;        // a step up onto the stage

function buildTavern() {
  const parts = [];          // everything that stands still, merged into one mesh
  const blockers = [];
  const seats = [];
  const lights = [];
  const figures = [];
  const add = (...g) => parts.push(...g);
  // Everything overhead goes in its own pile. The camera is allowed through the ceiling when a
  // room is too tight to get behind you any other way, and then this is what has to disappear:
  // the slabs, the beams, and every fixture hanging off them. The lights they stand for stay
  // on, so what you get is the room lit from above with its lid off.
  const roof = [];
  const addRoof = (...g) => roof.push(...g);

  const outer = (half) => half + WALL / 2;
  const face = (half) => half - 0.011;       // where something flat sits against a wall

  // ---- the shell -----------------------------------------------------------
  // The slab is built downwards so its top lands on FLOOR, which is where feet go.
  add(box(HALF_W * 2 + WALL * 2, 0.24, HALF_D * 2 + WALL * 2, C.floor, { y: FLOOR - 0.24 }));
  for (let i = -17; i <= 17; i++) {                                  // floorboards, laid across
    add(box(HALF_W * 2, 0.01, 0.028, C.darkWood, { y: FLOOR - 0.005, z: i * 0.145 }));
  }

  // The west wall comes in two pieces as well: the gap in it is the way through to the
  // washroom next door. A blocker grows by half a body on each side, so this 0.8 of plan is
  // 0.48 of daylight, which is what a doorway needs to be at this size.
  const WC_DOOR = [1.05, 1.85];
  for (const [x, z, hx, hz] of [
    [0, -outer(HALF_D), HALF_W + WALL, WALL / 2],                    // north, behind the bar
    [-outer(HALF_W), (-(HALF_D + WALL) + WC_DOOR[0]) / 2, WALL / 2, (WC_DOOR[0] + HALF_D + WALL) / 2],
    [-outer(HALF_W), (WC_DOOR[1] + HALF_D + WALL) / 2, WALL / 2, (HALF_D + WALL - WC_DOOR[1]) / 2],
    [outer(HALF_W), 0, WALL / 2, HALF_D + WALL],                     // east, the stage
  ]) {
    add(box(hx * 2, CEILING, hz * 2, C.plaster, { x, y: FLOOR, z }));
    add(box(hx * 2 - 0.006, 0.22, hz * 2 - 0.006, C.wainscot, { x, y: FLOOR, z }));
    blockers.push(rect(x, z, hx, hz));
  }
  // The south wall comes in two pieces, and the gap between them is the door.
  const segHalf = (HALF_W + WALL - DOOR_HALF) / 2;
  for (const s of [-1, 1]) {
    const cx = s * (DOOR_HALF + segHalf);
    add(box(segHalf * 2, CEILING, WALL, C.plaster, { x: cx, y: FLOOR, z: outer(HALF_D) }));
    add(box(segHalf * 2 - 0.006, 0.22, WALL - 0.006, C.wainscot, { x: cx, y: FLOOR, z: outer(HALF_D) }));
    blockers.push(rect(cx, outer(HALF_D), segHalf, WALL / 2));
  }
  // A lintel over the opening and a worn step under it, both clear of head height.
  add(box(DOOR_HALF * 2 + 0.16, 0.18, WALL + 0.05, C.darkWood, { y: FLOOR + CEILING - 0.18, z: outer(HALF_D) }));
  add(box(DOOR_HALF * 2, 0.015, WALL + 0.12, C.stone, { y: FLOOR - 0.015, z: outer(HALF_D) }));

  // Ceiling and the beams under it. Above head height, so neither is a blocker.
  addRoof(box(HALF_W * 2 + WALL * 2, 0.1, HALF_D * 2 + WALL * 2, C.plank, { y: FLOOR + CEILING }));
  for (let i = -3; i <= 3; i++) {
    addRoof(box(0.1, 0.085, HALF_D * 2, C.darkWood, { x: i * 0.9, y: FLOOR + CEILING - 0.085 }));
  }

  // Windows: two either side of the door, and one down the east wall clear of the stage.
  for (const wx of [-2.3, -1.2, 1.2, 2.3]) {
    add(box(0.34, 0.38, 0.04, C.glass, { x: wx, y: FLOOR + 0.42, z: face(HALF_D), emissive: 0.4 }));
    add(box(0.37, 0.04, 0.055, C.darkWood, { x: wx, y: FLOOR + 0.4, z: HALF_D - 0.03 }));
    add(box(0.04, 0.38, 0.055, C.darkWood, { x: wx, y: FLOOR + 0.42, z: HALF_D - 0.03 }));
  }
  add(box(0.04, 0.38, 0.34, C.glass, { x: face(HALF_W), y: FLOOR + 0.42, z: 1.75, emissive: 0.4 }));
  add(box(0.055, 0.04, 0.37, C.darkWood, { x: HALF_W - 0.03, y: FLOOR + 0.4, z: 1.75 }));
  add(box(0.055, 0.38, 0.04, C.darkWood, { x: HALF_W - 0.03, y: FLOOR + 0.42, z: 1.75 }));

  // ---- the bar -------------------------------------------------------------
  // The counter stops short of both side walls, so the walkway behind it is reachable from
  // either end and the barman is not walled in. A counter comes to the chest: 0.28 against a
  // body of 0.45, which is where a real one sits too.
  const BAR_X = 0.2, BAR_HX = 1.9, BAR_Z = -1.75, BAR_HZ = 0.13, BAR_H = 0.28;
  const COUNTER_Y = FLOOR + BAR_H + 0.03;
  add(box(BAR_HX * 2, BAR_H, BAR_HZ * 2, C.wood, { x: BAR_X, y: FLOOR, z: BAR_Z }));
  add(box(BAR_HX * 2 + 0.08, 0.03, BAR_HZ * 2 + 0.08, C.plank, { x: BAR_X, y: FLOOR + BAR_H, z: BAR_Z }));
  blockers.push(rect(BAR_X, BAR_Z, BAR_HX, BAR_HZ));
  for (let i = -6; i <= 6; i++) {                                    // panelling on the front
    add(box(0.045, BAR_H - 0.05, 0.02, C.darkWood, { x: BAR_X + i * 0.29, y: FLOOR + 0.025, z: BAR_Z + BAR_HZ }));
  }
  // A brass rail at boot height. Rotating a cylinder about z swings its centre to -h/2 in x,
  // so the length is added back on.
  add(cylinder(0.014, 0.014, BAR_HX * 2, 6, C.brass, {
    x: BAR_X + BAR_HX, y: FLOOR + 0.08, z: BAR_Z + BAR_HZ + 0.055, rz: Math.PI / 2,
  }));

  // The tap: four pulls and a drip tray, standing on the counter.
  for (const [i, hex] of [[-1.5, C.brass], [-0.5, C.copper], [0.5, C.brass], [1.5, C.copper]]) {
    const tx = BAR_X - 1.0 + i * 0.085;
    add(cylinder(0.014, 0.017, 0.13, 7, hex, { x: tx, y: COUNTER_Y, z: BAR_Z - 0.035 }));
    add(box(0.014, 0.014, 0.06, hex, { x: tx, y: COUNTER_Y + 0.08, z: BAR_Z + 0.01 }));
  }
  add(box(0.34, 0.014, 0.09, C.iron, { x: BAR_X - 1.0, y: COUNTER_Y, z: BAR_Z + 0.015 }));

  // The back shelf against the north wall, and the bottles on it.
  const SHELF_Z = -HALF_D + 0.07;
  add(box(4.4, 0.44, 0.14, C.darkWood, { y: FLOOR, z: SHELF_Z }));
  blockers.push(rect(0, SHELF_Z, 2.2, 0.07));
  for (const sy of [0.2, 0.38]) add(box(4.3, 0.02, 0.16, C.plank, { y: FLOOR + sy, z: SHELF_Z + 0.04 }));
  const BOTTLES = [C.bottleGreen, C.bottleBrown, C.ale, C.bottleGreen, C.bottleBrown, C.ale, C.bottleBrown];
  for (let i = 0; i < 46; i++) {
    const row = i > 22 ? 1 : 0;
    const bx = -2.05 + (i % 23) * 0.185 + row * 0.05;
    const by = FLOOR + (row ? 0.4 : 0.22);
    add(cylinder(0.013, 0.017, 0.075, 6, BOTTLES[i % BOTTLES.length], { x: bx, y: by, z: SHELF_Z + 0.04 }));
    add(cylinder(0.006, 0.006, 0.028, 5, C.darkWood, { x: bx, y: by + 0.075, z: SHELF_Z + 0.04 }));
  }
  // The mirror and the slate hang flat on the wall above the shelf, not out in the room: the
  // shelf is what stands proud of the plaster, and putting these at the same depth left them
  // floating a metre off it.
  add(box(1.5, 0.26, 0.015, C.mirror, { x: 0.6, y: FLOOR + 0.54, z: -face(HALF_D) }));
  add(box(1.56, 0.035, 0.035, C.darkWood, { x: 0.6, y: FLOOR + 0.53, z: -HALF_D + 0.03 }));
  add(box(0.5, 0.28, 0.015, C.slate, { x: -1.5, y: FLOOR + 0.53, z: -face(HALF_D) }));
  for (const [lw, lx, ly] of [[0.32, -1.56, 0.73], [0.24, -1.6, 0.67], [0.28, -1.58, 0.61], [0.19, -1.63, 0.55]]) {
    add(box(lw, 0.016, 0.01, C.linen, { x: lx, y: FLOOR + ly, z: -HALF_D + 0.022 }));
  }

  // ---- the stools ----------------------------------------------------------
  // Seven along the front of the bar, all facing it. Yaw is atan2(dx, dz), so facing -z --
  // into the bar -- is a yaw of pi. Each one carries the spot on the counter where whatever
  // it orders gets put down.
  const SEAT_H = 0.19;
  const seatZ = BAR_Z + BAR_HZ + 0.3;
  for (let i = 0; i < 7; i++) {
    const sx = -1.35 + i * 0.5;
    add(cylinder(0.022, 0.028, SEAT_H - 0.03, 7, C.darkWood, { x: sx, y: FLOOR, z: seatZ }));
    add(cylinder(0.085, 0.078, 0.03, 10, C.wood, { x: sx, y: FLOOR + SEAT_H - 0.03, z: seatZ }));
    add(cylinder(0.075, 0.075, 0.01, 10, C.seat, { x: sx, y: FLOOR + SEAT_H, z: seatZ }));
    add(cylinder(0.062, 0.062, 0.012, 8, C.iron, { x: sx, y: FLOOR + 0.06, z: seatZ }));   // the footring
    for (let f = 0; f < 3; f++) {                                    // three little feet
      const a = (f / 3) * Math.PI * 2 + 0.4;
      add(box(0.055, 0.014, 0.016, C.darkWood, {
        x: sx + Math.cos(a) * 0.038, y: FLOOR + 0.007, z: seatZ + Math.sin(a) * 0.038, ry: -a,
      }));
    }
    seats.push({
      id: `stool:${i}`, kind: 'seat', label: 'a bar stool',
      x: sx, z: seatZ, y: FLOOR + SEAT_H, yaw: Math.PI, r: 0.42,
      beer: [sx - 0.07, COUNTER_Y, BAR_Z + 0.04],
      snack: [sx + 0.08, COUNTER_Y, BAR_Z + 0.045],
    });
  }

  // ---- the fire, on the west wall -----------------------------------------
  const FX = -HALF_W + 0.14, FZ = -0.5;
  add(box(0.28, 0.6, 0.8, C.brick, { x: FX, y: FLOOR, z: FZ }));
  add(box(0.16, 0.36, 0.52, 0x241c18, { x: FX + 0.1, y: FLOOR + 0.015, z: FZ }));   // the opening
  add(box(0.36, 0.05, 0.9, C.stone, { x: FX, y: FLOOR + 0.6, z: FZ }));             // the mantel
  blockers.push(rect(FX, FZ, 0.14, 0.4));
  for (let i = 0; i < 3; i++) {                                                     // logs in the grate
    add(cylinder(0.02, 0.023, 0.26, 6, C.darkWood, {
      x: FX + 0.2, y: FLOOR + 0.035, z: FZ - 0.08 + i * 0.08, rz: Math.PI / 2 - 0.35,
    }));
  }
  add(dome(0.07, C.iron, { x: FX + 0.11, y: FLOOR + 0.35, z: FZ, rx: Math.PI }));   // the pot
  for (const cz of [FZ - 0.33, FZ + 0.33]) {                                        // candles on the mantel
    add(cylinder(0.011, 0.011, 0.075, 6, C.linen, { x: FX + 0.04, y: FLOOR + 0.65, z: cz }));
    add(sphere(0.018, C.flame, { x: FX + 0.04, y: FLOOR + 0.74, z: cz, emissive: 1 }));
  }

  // ---- the karaoke stage, against the east wall ---------------------------
  // One unit deep by two along the wall, and built to whole grid cells on purpose: walk mode
  // already knows how to stand on something above the floor -- that is how a bridge deck
  // works -- and its cells are one unit wide and land on integer boundaries. Snapping the
  // platform to them means the same map that carries a bridge carries a stage, and you walk
  // up onto it instead of bumping into it.
  const STAGE = { x0: 2, x1: HALF_W, z0: -1, z1: 1 };
  const sMidX = (STAGE.x0 + STAGE.x1) / 2, sMidZ = (STAGE.z0 + STAGE.z1) / 2;
  add(box(STAGE.x1 - STAGE.x0, STAGE_H, STAGE.z1 - STAGE.z0, C.plank, { x: sMidX, y: FLOOR, z: sMidZ }));
  add(box(0.04, 0.015, STAGE.z1 - STAGE.z0, C.darkWood, { x: STAGE.x0 + 0.02, y: FLOOR + STAGE_H, z: sMidZ }));
  // The curtain behind it, gathered into folds.
  for (let i = 0; i < 11; i++) {
    const cz = STAGE.z0 + 0.1 + i * ((STAGE.z1 - STAGE.z0 - 0.2) / 10);
    add(cylinder(0.035, 0.035, 0.74, 6, C.curtain, { x: face(HALF_W) - 0.02, y: FLOOR + STAGE_H, z: cz }));
  }
  add(box(0.07, 0.07, STAGE.z1 - STAGE.z0, C.darkWood, { x: HALF_W - 0.05, y: FLOOR + STAGE_H + 0.74, z: sMidZ }));
  // The microphone on its stand, at the front of the stage.
  const MIC = [sMidX - 0.28, FLOOR + STAGE_H, sMidZ + 0.22];
  add(cylinder(0.085, 0.1, 0.014, 10, C.iron, { x: MIC[0], y: MIC[1], z: MIC[2] }));
  add(cylinder(0.011, 0.014, 0.3, 7, C.iron, { x: MIC[0], y: MIC[1], z: MIC[2] }));
  add(cylinder(0.02, 0.02, 0.06, 8, C.iron, { x: MIC[0], y: MIC[1] + 0.3, z: MIC[2] }));
  add(sphere(0.03, 0x6f6f74, { x: MIC[0], y: MIC[1] + 0.375, z: MIC[2] }));
  // Two speakers, one each end, and the little screen the words come up on.
  for (const sz of [STAGE.z0 + 0.22, STAGE.z1 - 0.22]) {
    add(box(0.18, 0.34, 0.2, 0x2a2a2e, { x: STAGE.x1 - 0.2, y: FLOOR + STAGE_H, z: sz }));
    add(cylinder(0.065, 0.065, 0.015, 12, 0x4a4a50, { x: STAGE.x1 - 0.3, y: FLOOR + STAGE_H + 0.2, z: sz, rz: Math.PI / 2 }));
  }
  // The words hang from the ceiling over the front of the stage, with a lit face on each side:
  // the singer reads one from the boards, the room reads the other from the floor. On a stand
  // it faced whoever was standing on the stage and nobody else -- and before that it was drawn
  // at 0.42 up with nothing underneath it at all.
  const TV_Y = FLOOR + 0.82, TV_H = 0.2;
  addRoof(cylinder(0.012, 0.012, FLOOR + CEILING - TV_Y - TV_H, 4, C.iron, { x: STAGE.x0, y: TV_Y + TV_H, z: sMidZ }));
  addRoof(box(0.05, TV_H, 0.28, 0x1a2430, { x: STAGE.x0, y: TV_Y, z: sMidZ }));
  for (const sgn of [-1, 1]) {
    addRoof(box(0.012, TV_H - 0.04, 0.24, 0x4fd9c4, { x: STAGE.x0 + sgn * 0.029, y: TV_Y + 0.02, z: sMidZ, emissive: 0.55 }));
  }
  // A pair of coloured lamps over it, which is as far as the disco goes for now.
  for (const sz of [sMidZ - 0.42, sMidZ + 0.42]) {
    addRoof(cylinder(0.009, 0.009, 0.14, 4, C.iron, { x: sMidX + 0.15, y: FLOOR + CEILING - 0.14, z: sz }));
    addRoof(cone(0.06, 0.075, 8, C.iron, { x: sMidX + 0.15, y: FLOOR + CEILING - 0.14, z: sz, rx: Math.PI }));
    addRoof(sphere(0.038, C.stageLamp, { x: sMidX + 0.15, y: FLOOR + CEILING - 0.225, z: sz, emissive: 1 }));
  }

  // ---- the washroom, through the door in the west wall --------------------
  // Its own room rather than a screened-off corner of the hall, which is what lets it be shut
  // in properly: a corner walled to the ceiling strands the camera behind the wall, but a room
  // does not, because the camera is clipped to whichever room you are standing in.
  //
  // It runs deep rather than wide, and the cubicles are at the far end of that depth. A room
  // is only as good as the distance the camera can take in it, and 2.1 of that has to come
  // from somewhere: looking the short way across a washroom, it does not, and you end up with
  // a close-up of the back of your own head.
  const WC = { x0: -5.6, x1: -HALF_W - WALL, z0: -0.2, z1: HALF_D };   // its inner faces
  const wcMidX = (WC.x0 + WC.x1) / 2, wcMidZ = (WC.z0 + WC.z1) / 2;
  const wcW = WC.x1 - WC.x0, wcD = WC.z1 - WC.z0;
  add(box(wcW, 0.24, wcD + WALL * 2, C.floor, { x: wcMidX, y: FLOOR - 0.24, z: wcMidZ }));
  add(box(wcW, 0.015, wcD, C.tile, { x: wcMidX, y: FLOOR - 0.008, z: wcMidZ }));
  addRoof(box(wcW + WALL * 2, 0.1, wcD + WALL * 2, C.plank, { x: wcMidX, y: FLOOR + CEILING, z: wcMidZ }));
  for (const [x, z, hx, hz] of [
    [WC.x0 - WALL / 2, wcMidZ, WALL / 2, (wcD + WALL * 2) / 2],       // west
    [wcMidX, WC.z0 - WALL / 2, wcW / 2, WALL / 2],                    // north
    [wcMidX, WC.z1 + WALL / 2, wcW / 2, WALL / 2],                    // south
  ]) {
    add(box(hx * 2, CEILING, hz * 2, C.plaster, { x, y: FLOOR, z }));
    add(box(hx * 2 - 0.006, 0.22, hz * 2 - 0.006, C.tile, { x, y: FLOOR, z }));
    blockers.push(rect(x, z, hx, hz));
  }
  // The door frame between the two rooms, seen from both sides.
  for (const dz of WC_DOOR) {
    add(cylinder(0.045, 0.05, CEILING, 8, C.wainscot, { x: -outer(HALF_W), y: FLOOR, z: dz }));
  }
  add(box(WALL + 0.06, 0.09, WC_DOOR[1] - WC_DOOR[0], C.wainscot, {
    x: -outer(HALF_W), y: FLOOR + CEILING - 0.09, z: (WC_DOOR[0] + WC_DOOR[1]) / 2,
  }));

  // Two cubicles across the far end, shut. Side walls to 0.8 with a capping rail, a door on
  // each, and one of them standing open so the room is not two blank panels.
  const CUB = { x0: -5.5, x1: -3.9, z0: 1.95, z1: WC.z1, h: 0.8 };
  const cubMidZ = (CUB.z0 + CUB.z1) / 2, cubMidX = (CUB.x0 + CUB.x1) / 2;
  for (const dx of [CUB.x0, cubMidX, CUB.x1]) {
    add(box(0.05, CUB.h, CUB.z1 - CUB.z0, C.plaster, { x: dx, y: FLOOR, z: cubMidZ }));
    add(box(0.07, 0.03, CUB.z1 - CUB.z0, C.wainscot, { x: dx, y: FLOOR + CUB.h, z: cubMidZ }));
  }
  add(box(CUB.x1 - CUB.x0 + 0.07, 0.03, 0.07, C.wainscot, { x: cubMidX, y: FLOOR + CUB.h, z: CUB.z0 }));
  blockers.push(rect(cubMidX, cubMidZ, (CUB.x1 - CUB.x0) / 2, (CUB.z1 - CUB.z0) / 2));
  [[CUB.x0 + 0.4, 1], [CUB.x1 - 0.4, 0]].forEach(([cx, open]) => {
    if (open) {
      // ajar, swung back into the cubicle, with the pan showing behind it
      add(box(0.04, CUB.h - 0.1, 0.5, C.wainscot, { x: cx - 0.22, y: FLOOR + 0.06, z: CUB.z0 + 0.26, ry: 1.15 }));
      add(cylinder(0.075, 0.085, 0.14, 10, C.porcelain, { x: cx, y: FLOOR, z: CUB.z1 - 0.24 }));
      add(cylinder(0.085, 0.085, 0.022, 10, C.linen, { x: cx, y: FLOOR + 0.14, z: CUB.z1 - 0.24 }));
      add(box(0.16, 0.16, 0.1, C.porcelain, { x: cx, y: FLOOR + 0.28, z: CUB.z1 - 0.07 }));
      add(cylinder(0.01, 0.01, 0.14, 6, C.brass, { x: cx, y: FLOOR + 0.16, z: CUB.z1 - 0.12 }));
    } else {
      add(box(0.58, CUB.h - 0.1, 0.04, C.wainscot, { x: cx, y: FLOOR + 0.06, z: CUB.z0 }));
      add(sphere(0.018, C.brass, { x: cx + 0.22, y: FLOOR + 0.4, z: CUB.z0 - 0.04 }));
      add(box(0.06, 0.06, 0.02, C.tile, { x: cx, y: FLOOR + 0.58, z: CUB.z0 - 0.035, emissive: 0.3 }));
    }
  });

  // The basin under a mirror, on the wall you face coming in.
  add(box(0.28, 0.22, 0.19, C.porcelain, { x: -4.6, y: FLOOR, z: WC.z0 + 0.095 }));
  add(cylinder(0.1, 0.08, 0.045, 12, C.porcelain, { x: -4.6, y: FLOOR + 0.22, z: WC.z0 + 0.08 }));
  add(cylinder(0.011, 0.011, 0.075, 6, C.brass, { x: -4.6, y: FLOOR + 0.25, z: WC.z0 + 0.02 }));
  add(box(0.26, 0.22, 0.015, C.mirror, { x: -4.6, y: FLOOR + 0.4, z: WC.z0 + 0.011 }));
  add(box(0.3, 0.03, 0.03, C.wainscot, { x: -4.6, y: FLOOR + 0.39, z: WC.z0 + 0.03 }));
  blockers.push(rect(-4.6, WC.z0 + 0.095, 0.14, 0.095));
  // A towel on a ring, and a lamp over the mirror.
  add(cylinder(0.035, 0.035, 0.012, 10, C.brass, { x: -4.2, y: FLOOR + 0.38, z: WC.z0 + 0.03, rx: Math.PI / 2 }));
  add(box(0.1, 0.16, 0.03, C.linen, { x: -4.2, y: FLOOR + 0.22, z: WC.z0 + 0.04 }));
  add(box(0.3, 0.06, 0.05, C.glass, { x: -4.6, y: FLOOR + 0.66, z: WC.z0 + 0.03, emissive: 0.5 }));

  // ---- tables, benches, barrels -------------------------------------------
  // Six of them, kept out of the run between the door and the bar so the way in is a way in.
  // Nothing sits in front of the hearth: a table there and the fire is sealed off behind two
  // blockers that touch, and you cannot get within three metres of it.
  const TABLES = [[-2.2, 0.6], [-0.9, 1.6], [-0.75, 0.15], [1.0, 1.5], [1.55, 0.1], [2.5, 2.05]];
  for (const [tx, tz] of TABLES) {
    add(cylinder(0.115, 0.14, 0.018, 8, C.darkWood, { x: tx, y: FLOOR, z: tz }));   // the foot
    add(cylinder(0.032, 0.045, 0.2, 7, C.darkWood, { x: tx, y: FLOOR, z: tz }));
    add(cylinder(0.2, 0.2, 0.028, 12, C.plank, { x: tx, y: FLOOR + 0.2, z: tz }));
    blockers.push(rect(tx, tz, 0.2, 0.2));
    // a candle in the middle, a tankard, and a bowl
    add(cylinder(0.02, 0.024, 0.03, 6, C.brass, { x: tx, y: FLOOR + 0.228, z: tz }));
    add(cylinder(0.009, 0.009, 0.05, 6, C.linen, { x: tx, y: FLOOR + 0.255, z: tz }));
    add(sphere(0.017, C.flame, { x: tx, y: FLOOR + 0.32, z: tz, emissive: 1 }));
    add(cylinder(0.026, 0.023, 0.055, 8, C.brass, { x: tx + 0.1, y: FLOOR + 0.228, z: tz - 0.07 }));
    add(cylinder(0.045, 0.03, 0.028, 9, C.linen, { x: tx - 0.09, y: FLOOR + 0.228, z: tz + 0.08 }));
    for (const b of [-1, 1]) {                                                      // a bench each side
      const bz = tz + b * 0.32;
      add(box(0.42, 0.025, 0.1, C.plank, { x: tx, y: FLOOR + 0.11, z: bz }));
      for (const bx of [-0.15, 0.15]) add(box(0.032, 0.11, 0.085, C.darkWood, { x: tx + bx, y: FLOOR, z: bz }));
    }
  }
  // Barrels: one standing at each end of the room, and one on its side on a cradle in the
  // corridor round the end of the bar.
  for (const [bx, bz] of [[-2.82, -2.15], [2.85, 1.3]]) {
    add(cylinder(0.085, 0.098, 0.24, 10, C.wood, { x: bx, y: FLOOR, z: bz }));
    for (const hy of [0.05, 0.17]) add(cylinder(0.1, 0.1, 0.022, 10, C.iron, { x: bx, y: FLOOR + hy, z: bz }));
    add(cylinder(0.08, 0.08, 0.014, 10, C.darkWood, { x: bx, y: FLOOR + 0.24, z: bz }));
    blockers.push(rect(bx, bz, 0.1, 0.1));
  }
  // Laid on its side the cylinder is swung about z, which puts its centre at -h/2 in x.
  add(cylinder(0.08, 0.08, 0.23, 10, C.wood, { x: -2.7 + 0.115, y: FLOOR + 0.11, z: -1.15, rz: Math.PI / 2 }));
  for (const hx2 of [-0.07, 0.07]) {
    add(cylinder(0.086, 0.086, 0.02, 10, C.iron, { x: -2.7 + hx2 + 0.01, y: FLOOR + 0.11, z: -1.15, rz: Math.PI / 2 }));
  }
  for (const cz of [-0.08, 0.08]) add(box(0.2, 0.045, 0.045, C.darkWood, { x: -2.7, y: FLOOR, z: -1.15 + cz }));
  blockers.push(rect(-2.7, -1.15, 0.13, 0.11));

  // ---- lanterns, hanging from the beams -----------------------------------
  // The rod runs from the rim of the shade up to the ceiling, which is the whole point of a
  // rod: built downwards from the shade instead, it came out below the globe and left the lamp
  // hanging in mid air with a spike under it. The two over the bar sit on beam lines
  // (x = i * 0.9), so they hang off a beam rather than out of the plaster.
  const SHADE_Y = FLOOR + CEILING - 0.19;
  for (const [lx, lz] of [[-0.9, -1.3], [0.9, -1.3], ...TABLES]) {
    addRoof(cylinder(0.008, 0.008, 0.19, 4, C.iron, { x: lx, y: SHADE_Y, z: lz }));
    addRoof(cone(0.075, 0.06, 8, C.iron, { x: lx, y: SHADE_Y, z: lz, rx: Math.PI }));
    addRoof(sphere(0.048, C.glass, { x: lx, y: SHADE_Y - 0.075, z: lz, emissive: 1 }));
  }

  // ---- the barman ----------------------------------------------------------
  // Behind the tap, in the walkway between the counter and the shelf. He slides along to
  // whoever is ordering and otherwise shifts his weight; a blocker so you cannot stand inside
  // him if you walk round the end of the bar. Talking to him is not a thing yet.
  const BARMAN_Z = -2.12;
  figures.push({ style: 'opus', at: [BAR_X - 0.7, FLOOR, BARMAN_Z], scale: 1.05, seed: 0.7, tends: true });
  blockers.push(rect(BAR_X - 0.7, BARMAN_Z, 0.11, 0.11));

  lights.push(
    { hex: 0xffc98a, intensity: 1.5, dist: 3.2, at: [-0.9, FLOOR + 0.82, -1.3] },
    { hex: 0xffc98a, intensity: 1.4, dist: 3.0, at: [0.9, FLOOR + 0.82, -1.3] },
    { hex: 0xffd9a0, intensity: 1.2, dist: 3.0, at: [-1.1, FLOOR + 0.8, 0.9] },
    { hex: 0xffd9a0, intensity: 1.2, dist: 3.0, at: [1.2, FLOOR + 0.8, 1.1] },
    { hex: 0xff8c3a, intensity: 1.5, dist: 2.2, at: [FX + 0.22, FLOOR + 0.24, FZ], flicker: true },
    { hex: 0xd94fa8, intensity: 1.1, dist: 2.4, at: [sMidX + 0.15, FLOOR + CEILING - 0.28, sMidZ] },
    { hex: 0xcfe2ea, intensity: 1.2, dist: 3.2, at: [-4.4, FLOOR + 0.92, 1.1] },
  );

  return {
    name: 'the tavern',
    parts, roof, blockers, seats, lights, figures,
    fireAt: [FX + 0.24, FLOOR + 0.03, FZ],
    // The cells the stage covers, handed to walk mode as a deck to stand on.
    stage: { ...STAGE, height: FLOOR + STAGE_H },
    // The rooms, as the camera sees them: it is kept inside whichever one you are standing in,
    // so a wall between two of them never ends up between you and it.
    areas: [
      { x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D },
      { x0: WC.x0, x1: WC.x1, z0: WC.z0, z1: WC.z1 },
    ],
    // Far enough in that the camera behind your shoulder has its full reach from the first
    // frame -- a step inside the door left it pressed against the south wall and looking at
    // the back of your hat -- and facing the bar, which is what you came for.
    spawn: { x: 0, z: HALF_D - 2.3 },
    // Walking back out through the opening is how you leave, and so is Esc. The door is not
    // something you press: E belongs to what is in the room.
    doorway: { z: HALF_D + WALL, hx: DOOR_HALF + 0.02 },
    // How the camera sits in here: closer in than the island's 2.7, lower, and aiming at the
    // chest instead of over the head, because there is a ceiling.
    camera: { back: 2.1, up: 0.62, aim: 0.3 },
  };
}

const ROOMS = { tavern: buildTavern };

export const ROOM_KINDS = Object.keys(ROOMS);

// ---------------------------------------------------------------- what you order
// A pint, and a plate of bitterballen with a blob of mustard. Both are built about the origin
// and moved by their mesh, because they come and go.
function pintGeometry() {
  return mergeGeom([
    cylinder(0.024, 0.02, 0.062, 8, C.glass, { emissive: 0.6 }),
    cylinder(0.0235, 0.0235, 0.015, 8, C.linen, { y: 0.062 }),
    box(0.008, 0.03, 0.014, C.glass, { x: 0.03, y: 0.018, emissive: 0.4 }),
  ]);
}
function snackGeometry() {
  const parts = [cylinder(0.055, 0.05, 0.008, 12, C.linen)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    parts.push(sphere(0.016, C.croquette, { x: Math.cos(a) * 0.026, y: 0.02, z: Math.sin(a) * 0.026 }));
  }
  parts.push(cylinder(0.016, 0.016, 0.007, 8, C.porcelain, { y: 0.008 }));
  parts.push(sphere(0.013, C.mustard, { y: 0.019 }));
  return mergeGeom(parts);
}

// ------------------------------------------------------------------ the machinery
// Built once per room and kept: a visit is enter() and leave(), not another scene. Walk mode
// hangs listeners on the window, so churning one per visit would pile them up.
export function createInterior({ room = 'tavern', camera, material, dom, onLeave }) {
  const make = ROOMS[room];
  if (!make) throw new Error(`no such room: ${room}`);
  const def = make();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x140d09);
  scene.fog = new THREE.Fog(0x140d09, 9, 26);

  // One mesh for the whole room, the same trick the buildings use: a tavern is a few hundred
  // primitives and has no business being a few hundred draw calls.
  const shell = new THREE.Mesh(mergeGeom(def.parts), material);
  scene.add(shell);

  // The lid, kept apart so it can be taken off. In a room too small to get the camera behind
  // you, the only way out is up -- and a ceiling that stays put makes that useless, because
  // the camera stops a hand under it and stares down at your hat.
  const roofMesh = def.roof && def.roof.length ? new THREE.Mesh(mergeGeom(def.roof), material) : null;
  if (roofMesh) scene.add(roofMesh);

  // The fire is its own mesh because it is pulsed, and geometry that gets scaled has to be
  // built about the origin or it walks away from the hearth as it flickers.
  const fire = new THREE.Mesh(mergeGeom([
    cone(0.085, 0.24, 6, C.ember, { emissive: 1 }),
    cone(0.05, 0.155, 6, C.flame, { y: 0.035, emissive: 1 }),
  ]), material);
  fire.position.set(...def.fireAt);
  scene.add(fire);

  const figures = def.figures.map((f) => {
    const mesh = new THREE.Mesh(figureGeometry(f.style), material);
    mesh.position.set(...f.at);
    mesh.scale.setScalar(f.scale || 1);
    scene.add(mesh);
    return { mesh, seed: f.seed || 0, y: f.at[1], home: f.at[0], tends: !!f.tends };
  });
  const barman = figures.find((f) => f.tends) || null;
  let barmanX = barman ? barman.home : 0;

  // What has been ordered, per stool: one glass and one plate each, standing on the counter
  // until the barman clears them away.
  const pint = pintGeometry(), snack = snackGeometry();
  const served = def.seats.map((s) => {
    const beer = new THREE.Mesh(pint, material);
    beer.position.set(...s.beer);
    beer.visible = false;
    const plate = new THREE.Mesh(snack, material);
    plate.position.set(...s.snack);
    plate.visible = false;
    scene.add(beer, plate);
    return { beer, plate, step: 0 };
  });

  // Dim and warm, so the lamps and the fire are what you read the room by.
  scene.add(new THREE.HemisphereLight(0x6a5a44, 0x241a12, 0.4));
  scene.add(new THREE.AmbientLight(0xffe6c0, 0.2));
  const lamps = def.lights.map((l) => {
    const light = new THREE.PointLight(l.hex, l.intensity, l.dist, 2);
    light.position.set(...l.at);
    scene.add(light);
    return { light, base: l.intensity, flicker: !!l.flicker };
  });

  // A flat floor of its own, standing in for the island's terrain. Constant and above the
  // water line, or walk mode would call the whole room open sea.
  const SIZE = 32, HALF_CELLS = SIZE / 2;
  const terrain = {
    size: SIZE, half: HALF_CELLS,
    cellWorld: (gx, gz) => [gx - HALF_CELLS + 0.5, gz - HALF_CELLS + 0.5],
    worldHeight: () => FLOOR,
    heightAt: () => FLOOR,
    slope: () => 0,
    isLand: () => true, isWater: () => false, isBeach: () => false, isBuildable: () => true,
  };

  let left = true;
  function leave() {
    if (left) return;
    left = true;
    walk.exit();
    if (onLeave) onLeave();
  }

  // The camera lives in the room too. Rather than sliding it sideways off a wall -- which
  // reads as the wall vanishing -- it is pulled in along the line back to the player, so it
  // reads as a smaller room instead.
  //
  // The solve starts from a point that is certainly inside: standing in the doorway puts you
  // outside the box, and a ray that starts outside clips to a negative length, which is how a
  // camera ends up sitting on the very thing it is aiming at with no direction left to
  // choose -- the moment the whole view flips over.
  const CAM = def.camera || { back: 2.3, up: 1.0, aim: 0.3 };
  const AREAS = def.areas || [{ x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D }];
  const MARGIN = 0.2;
  const MIN_BACK = 0.5;                // never closer than this, so `lookAt` keeps its aim
  // Which room a point is in, or the nearest one if it is in a doorway between two.
  function areaAt(x, z) {
    let best = AREAS[0], bestD = Infinity;
    for (const a of AREAS) {
      const dx = Math.max(a.x0 - x, 0, x - a.x1), dz = Math.max(a.z0 - z, 0, z - a.z1);
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  function clampCam(v) {
    const p = walk.state.pos;
    const a = areaAt(p.x, p.z);
    const px = clamp(p.x, a.x0 + MARGIN, a.x1 - MARGIN);
    const pz = clamp(p.z, a.z0 + MARGIN, a.z1 - MARGIN);
    const dx = v.x - px, dz = v.z - pz;
    const len = Math.hypot(dx, dz);
    let t = 1;
    const clip = (o, d, lo, hi) => {
      if (d > 1e-6) t = Math.min(t, (hi - o) / d);
      else if (d < -1e-6) t = Math.min(t, (lo - o) / d);
    };
    clip(px, dx, a.x0 + MARGIN, a.x1 - MARGIN);
    clip(pz, dz, a.z0 + MARGIN, a.z1 - MARGIN);
    t = clamp(t, len > 0.001 ? Math.min(1, MIN_BACK / len) : 1, 1);
    // Only the sideways reach is shortened. Bringing the height in with it dropped the camera
    // below the point it aims at, which turned every step towards a wall into a look at the
    // rafters; the ceiling clamp below is what keeps it out of the beams instead.
    v.x = px + dx * t;
    v.z = pz + dz * t;
    // What the reach cannot give, the height does: the camera climbs by roughly what it lost
    // going sideways, so the distance to you stays about the same and the room simply gets
    // looked down into. Nothing caps the climb -- capping it under the ceiling was what left
    // the camera a hand's width over your head in the washroom -- and the floor of 0.18 above
    // the aim point keeps it from swinging under and staring at the rafters.
    const yNear = p.y + CAM.aim + 0.18;
    v.y = Math.max(yNear, v.y + (1 - t) * len * 0.8);
    // Once it is up through the ceiling, the ceiling is in the way of the only view there is.
    roofWanted = v.y < FLOOR + CEILING - 0.04;
  }

  // Over the shoulder, as everywhere else on the island, but closer in, lower, and aimed at
  // the chest rather than over the head: the island's camera looks down from 1.6 up and 2.7
  // back at a point 0.9 off the ground, and all three of those are taller than this room.
  const walk = createWalkMode({
    scene, camera, terrain, material, dom,
    camBack: CAM.back, camUp: CAM.up, camAim: CAM.aim, clampCam,
  });

  // The stage, as a deck to stand on. Walk mode looks a cell up in this map before it asks
  // the terrain, which is how a bridge carries you over a river; the platform was built to
  // whole cells so the step up lands exactly on its edge.
  if (def.stage) {
    const deck = new Map();
    const cell = (v) => Math.round(v + HALF_CELLS - 0.5);
    for (let gx = cell(def.stage.x0 + 0.5); gx <= cell(def.stage.x1 - 0.5); gx++) {
      for (let gz = cell(def.stage.z0 + 0.5); gz <= cell(def.stage.z1 - 0.5); gz++) {
        deck.set(gx + gz * SIZE, def.stage.height);
      }
    }
    walk.setDecks(deck);
  }

  // Sitting down is the first press; after that the same key is how you order, because
  // ordering a beer standing up in the middle of the room is not a thing. Walking away is
  // how you get off the stool, which walk mode already does on its own.
  function onInteract(it) {
    if (it.kind !== 'seat') return;
    if (!walk.state.sitting) { walk.sitOn({ x: it.x, z: it.z, y: it.y, yaw: it.yaw }); return; }
    const s = served[it.index];
    s.step = (s.step + 1) % 3;
    s.beer.visible = s.step >= 1;
    s.plate.visible = s.step >= 2;
    if (barman) barmanX = it.x;             // he comes along the bar to serve it
  }

  function enter({ avatar } = {}) {
    left = false;
    if (avatar) walk.setAvatar(avatar);
    for (const s of served) { s.step = 0; s.beer.visible = false; s.plate.visible = false; }
    if (barman) barmanX = barman.home;
    walk.enter({
      at: [def.spawn.x, def.spawn.z],
      facing: [def.spawn.x, def.spawn.z - 1],
      blockers: def.blockers,
      interactables: def.seats.map((s, i) => ({ ...s, index: i })),
      onInteract,
      onExit: leave,
    });
    walk.state.camPitch = 0.05;      // indoors you look across the room, not over the treetops
  }

  let t = 0;
  let roofWanted = true;
  function update(dt) {
    if (left) return null;
    roofWanted = true;
    const w = walk.update(dt);
    if (roofMesh) roofMesh.visible = roofWanted;

    // The doorway is a door: walk out through the gap and you are outside again.
    const p = walk.state.pos;
    if (p.z > def.doorway.z && Math.abs(p.x) < def.doorway.hx) { leave(); return w; }

    t += dt;
    const flick = 0.86 + 0.14 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7);
    fire.scale.set(flick, 1 + 0.16 * Math.sin(t * 9.1), flick);
    for (const l of lamps) if (l.flicker) l.light.intensity = l.base * flick;
    // The barman shifts his weight, and walks the length of the bar to whoever ordered.
    for (const f of figures) {
      if (f.tends) f.mesh.position.x += (barmanX - f.mesh.position.x) * Math.min(1, dt * 3.4);
      f.mesh.position.y = f.y + Math.abs(Math.sin(t * 0.9 + f.seed)) * 0.014;
      f.mesh.rotation.y = Math.sin(t * 0.55 + f.seed) * 0.28;
    }

    if (w && w.near) w.near.prompt = promptFor(w.near);
    return w;
  }

  function promptFor(near) {
    if (near.kind !== 'seat') return null;
    if (!walk.state.sitting) return 'sit down';
    const step = served[near.index].step;
    return step === 0 ? 'order a beer'
      : step === 1 ? 'order bitterballen'
        : 'let the barman clear it away';
  }

  function dispose() {
    walk.exit();
    walk.dispose();
    shell.geometry.dispose();
    if (roofMesh) roofMesh.geometry.dispose();
    fire.geometry.dispose();
    pint.dispose();
    snack.dispose();
    for (const f of figures) f.mesh.geometry.dispose();
  }

  return {
    name: def.name, room, scene, terrain, walk, enter, update, leave, dispose,
    setPaused: (v) => walk.setPaused(v),
    isInside: () => !left,
  };
}

function mergeGeom(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
