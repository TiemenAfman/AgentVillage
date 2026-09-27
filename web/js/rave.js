// The castle's great hall on a Saturday night (Plans/rave-in-het-kasteel.md): a dark stone
// hall twice the height of the tavern, a stage with the DJ at the north end, a truss of
// lasers and moving heads over the floor, a mirror ball, a bar along the west wall, and the
// island's own settlers dancing.
//
// It is the second entry in interior.js's ROOMS and uses all of that machinery - the walk
// mode, the camera kept inside the walls, the stage as a deck to stand on, the stools and
// the barman - and adds what moves: `show` below, built once per room like everything else
// there, and driven by the music's own clock (sound.raveClock) when there is music, so the
// kick you hear and the kick you see are the same kick.
//
// Two rules about light that are not taste. **Nothing the whole screen does flashes faster
// than the beat** - 132 BPM is 2.2 a second, under the three a second WCAG 2.3.1 draws the
// line at - so the strobe fires on crotchets and never on the sixteenths a real one would;
// only the thin beams and the small LED wall move faster than that. And **every moving light
// is one InstancedMesh**: beams, cones, pools, specks and the wall's cells are five draw calls
// together, however many of each there are, with their own unlit additive materials so the
// building material gets no second variant.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, sphere } from './buildings.js';
import { createFigures, settlerLook } from './settler-figures.js';
import { RAVE_SONG } from './sound.js';
import { makeRng, hash32, clamp } from 'shared/rng.mjs';

const HALF_W = 5.0;          // to the inner face of the east and west walls
const HALF_D = 4.0;          // to the inner face of the north and south walls
const WALL = 0.16;
const CEILING = 2.4;         // nine and a half metres: a great hall, not a snug
const DOOR_HALF = 0.5;
const GATE_H = 1.05;         // the gate's opening; the wall runs on above it
const STAGE = { x0: -2, x1: 2, z0: -4, z1: -2 };   // whole cells, like the tavern's stage
const STAGE_H = 0.14;
const TRUSS_Z = -1.85;
const TRUSS_HALF = 3.3;
const MAX_DANCERS = 90;

const C = {
  floor: 0x26232b, stone: 0x4a4652, plinth: 0x2e2b33, beam: 0x2a1d15, iron: 0x2a2a30,
  stage: 0x17151b, black: 0x111115, grey: 0x3a3a42, wood: 0x5a3c28, darkWood: 0x3a261a,
  banner1: 0x3b1a5c, banner2: 0x6a1a2c, gold: 0xc99a3a, night: 0x24346e, linen: 0xf5efe0,
  silver: 0xd4d8e0, brass: 0xd9a33d, bottleGreen: 0x4a7a4a, bottleBrown: 0x7a4a2a, glass: 0xffd27f,
  neon: 0xff3fb4, cyan: 0x2ee6ff, magenta: 0xff2ed1,
};

// The colours the lights are allowed. Saturated on purpose: through the haze and the
// additive blend anything paler reads as white.
const GREEN = new THREE.Color(0x39ff6a), CYAN = new THREE.Color(0x2ee6ff), MAGENTA = new THREE.Color(0xff2ed1);
const RED = new THREE.Color(0xff2436), BLUE = new THREE.Color(0x3048ff), VIOLET = new THREE.Color(0x9b4dff);
const AMBER = new THREE.Color(0xffae2a), WHITE = new THREE.Color(0xffffff);
const GROOVE = [GREEN, CYAN, MAGENTA, VIOLET];

// Where the song is, in the words the lights care about. The shape is sound.js's
// (RAVE_SONG): twelve bars with a kick, of which the first two are the drop and the last four
// the laser sheet, then two of breakdown, one of flicker and one rising into the drop.
const { bpm: BPM, bars: BARS, build: BUILD } = RAVE_SONG;
const SPB = 60 / BPM;
const LOOP_S = BARS * 4 * SPB;
function sectionOf(bar) {
  if (bar < 2) return 'drop';
  if (bar < 8) return 'groove';
  if (bar < BUILD) return 'sheet';
  if (bar < BUILD + 2) return 'break';
  if (bar < BUILD + 3) return 'flick';
  return 'rise';
}

// ------------------------------------------------------------------ the hall
// `FLOOR` and `rect` are interior.js's, handed in rather than imported so the two files do
// not import each other.
export function buildRave({ FLOOR, rect }) {
  const parts = [], roof = [], blockers = [], seats = [], figures = [];
  const add = (...g) => parts.push(...g);
  const addRoof = (...g) => roof.push(...g);
  const outer = (half) => half + WALL / 2;
  const STAGE_TOP = FLOOR + STAGE_H;

  // ---- the shell ------------------------------------------------------------
  add(box(HALF_W * 2 + WALL * 2, 0.24, HALF_D * 2 + WALL * 2, C.floor, { y: FLOOR - 0.24, sheet: 'stone' }));
  const wall = (x, z, hx, hz, y = FLOOR, h = CEILING) => {
    add(box(hx * 2, h, hz * 2, C.stone, { x, y, z, sheet: 'stone' }));
    if (y === FLOOR) add(box(hx * 2 + 0.01, 0.16, hz * 2 + 0.01, C.plinth, { x, y, z, sheet: 'stone' }));
  };
  for (const [x, z, hx, hz] of [
    [0, -outer(HALF_D), HALF_W + WALL, WALL / 2],                      // north, behind the stage
    [-outer(HALF_W), 0, WALL / 2, HALF_D + WALL],                      // west, the bar
    [outer(HALF_W), 0, WALL / 2, HALF_D + WALL],                       // east
  ]) {
    wall(x, z, hx, hz);
    blockers.push(rect(x, z, hx, hz));
  }
  // The south wall in two, with the gate between them and the wall carried on over it.
  const segHalf = (HALF_W + WALL - DOOR_HALF) / 2;
  for (const s of [-1, 1]) {
    const cx = s * (DOOR_HALF + segHalf);
    wall(cx, outer(HALF_D), segHalf, WALL / 2);
    blockers.push(rect(cx, outer(HALF_D), segHalf, WALL / 2));
    // The gate's leaves, swung back flat against the inside of the wall.
    const lx = s * (DOOR_HALF + 0.29);
    add(box(0.54, GATE_H - 0.06, 0.05, C.darkWood, { x: lx, y: FLOOR, z: HALF_D - 0.04 }));
    for (const by of [0.22, 0.7]) add(box(0.56, 0.035, 0.06, C.iron, { x: lx, y: FLOOR + by, z: HALF_D - 0.045 }));
  }
  wall(0, outer(HALF_D), DOOR_HALF, WALL / 2, FLOOR + GATE_H, CEILING - GATE_H);
  add(box(DOOR_HALF * 2 + 0.2, 0.12, WALL + 0.06, C.plinth, { y: FLOOR + GATE_H - 0.06, z: outer(HALF_D), sheet: 'stone' }));
  add(box(DOOR_HALF * 2, 0.015, WALL + 0.14, C.plinth, { y: FLOOR - 0.015, z: outer(HALF_D), sheet: 'stone' }));

  // Tall windows either side of the gate, with the night behind them.
  for (const wx of [-2.6, 2.6]) {
    add(box(0.34, 0.66, 0.04, C.night, { x: wx, y: FLOOR + 1.35, z: HALF_D - 0.011, emissive: 0.35 }));
    add(box(0.42, 0.06, 0.07, C.plinth, { x: wx, y: FLOOR + 1.32, z: HALF_D - 0.03, sheet: 'stone' }));
    add(box(0.035, 0.66, 0.05, C.iron, { x: wx, y: FLOOR + 1.35, z: HALF_D - 0.03 }));
  }

  // Pillars down both long walls, and banners between them.
  for (const [px, pz] of [[-1, -2.6], [-1, 3.35], [1, -2.6], [1, 0.4], [1, 3.35]]) {
    const x = px * (HALF_W - 0.2);
    add(box(0.4, CEILING, 0.4, C.stone, { x, y: FLOOR, z: pz, sheet: 'stone' }));
    add(box(0.48, 0.12, 0.48, C.plinth, { x, y: FLOOR, z: pz, sheet: 'stone' }));
    add(box(0.48, 0.1, 0.48, C.plinth, { x, y: FLOOR + CEILING - 0.1, z: pz, sheet: 'stone' }));
    blockers.push(rect(x, pz, 0.2, 0.2));
  }
  for (const [side, bz, hex] of [[1, -1.1, C.banner1], [1, 1.9, C.banner2], [-1, -1.3, C.banner2]]) {
    const bx = side * (HALF_W - 0.03);
    add(box(0.03, 1.15, 0.55, hex, { x: bx, y: FLOOR + CEILING - 1.45, z: bz }));
    add(box(0.04, 0.05, 0.6, C.gold, { x: bx, y: FLOOR + CEILING - 1.46, z: bz }));
    add(box(0.035, 0.18, 0.18, C.gold, { x: bx - side * 0.005, y: FLOOR + CEILING - 0.95, z: bz, rx: Math.PI / 4 }));
    addRoof(cylinder(0.012, 0.012, 0.66, 5, C.iron, { x: bx - side * 0.03, y: FLOOR + CEILING - 0.3, z: bz - 0.33, rx: Math.PI / 2 }));
  }

  // The lid: a slab and the timbers under it, and two iron wheels of candles nobody has lit.
  addRoof(box(HALF_W * 2 + WALL * 2, 0.12, HALF_D * 2 + WALL * 2, C.beam, { y: FLOOR + CEILING }));
  for (let i = -3; i <= 3; i++) addRoof(box(HALF_W * 2, 0.13, 0.14, C.beam, { y: FLOOR + CEILING - 0.13, z: i * 1.05 }));
  for (const cx of [-2.6, 2.6]) {
    const cy = FLOOR + CEILING - 0.62;
    addRoof(cylinder(0.008, 0.008, 0.62, 4, C.iron, { x: cx, y: cy, z: 1.2 }));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      addRoof(box(0.2, 0.025, 0.025, C.iron, { x: cx + Math.cos(a) * 0.3, y: cy, z: 1.2 + Math.sin(a) * 0.3, ry: -a + Math.PI / 2 }));
      addRoof(cylinder(0.012, 0.012, 0.05, 5, C.linen, { x: cx + Math.cos(a + 0.4) * 0.3, y: cy + 0.025, z: 1.2 + Math.sin(a + 0.4) * 0.3 }));
    }
  }

  // ---- the stage -------------------------------------------------------------
  const sMidX = (STAGE.x0 + STAGE.x1) / 2, sMidZ = (STAGE.z0 + STAGE.z1) / 2;
  add(box(STAGE.x1 - STAGE.x0, STAGE_H, STAGE.z1 - STAGE.z0, C.stage, { x: sMidX, y: FLOOR, z: sMidZ }));
  add(box(STAGE.x1 - STAGE.x0, 0.025, 0.02, C.cyan, { x: sMidX, y: FLOOR + 0.05, z: STAGE.z1 + 0.005, emissive: 1 }));
  // The DJ's table, the decks and the mixer on it, and a glowing stripe along its front.
  const BOOTH_Z = -2.6;
  add(box(1.5, 0.3, 0.36, C.black, { y: STAGE_TOP, z: BOOTH_Z }));
  add(box(1.4, 0.028, 0.01, C.magenta, { y: STAGE_TOP + 0.19, z: BOOTH_Z + 0.182, emissive: 1 }));
  add(box(1.56, 0.025, 0.42, C.grey, { y: STAGE_TOP + 0.3, z: BOOTH_Z }));
  for (const dx of [-0.42, 0.42]) {
    add(cylinder(0.12, 0.12, 0.02, 14, C.grey, { x: dx, y: STAGE_TOP + 0.325, z: BOOTH_Z }));
    add(cylinder(0.1, 0.1, 0.006, 14, C.black, { x: dx, y: STAGE_TOP + 0.345, z: BOOTH_Z }));
    add(cylinder(0.012, 0.012, 0.012, 6, C.cyan, { x: dx, y: STAGE_TOP + 0.35, z: BOOTH_Z, emissive: 1 }));
  }
  add(box(0.26, 0.035, 0.24, C.black, { y: STAGE_TOP + 0.325, z: BOOTH_Z }));
  for (let k = 0; k < 6; k++) {
    add(sphere(0.011, k % 2 ? C.magenta : C.cyan, { x: -0.09 + (k % 3) * 0.09, y: STAGE_TOP + 0.365, z: BOOTH_Z - 0.05 + Math.floor(k / 3) * 0.09, emissive: 1 }));
  }
  blockers.push(rect(0, BOOTH_Z, 0.75, 0.2));
  // The LED wall's frame; its cells are the show's (they change colour every frame).
  const LED = { x: 0, y: STAGE_TOP + 0.4, z: -HALF_D + 0.035, cols: 18, rows: 7, cell: 0.2 };
  add(box(LED.cols * LED.cell + 0.1, LED.rows * LED.cell + 0.1, 0.05, C.black, { y: LED.y - 0.05, z: -HALF_D + 0.006 }));
  // Speaker stacks either side, on the floor.
  for (const sx of [-2.6, 2.6]) {
    for (let k = 0; k < 3; k++) {
      add(box(0.62, 0.4, 0.5, C.black, { x: sx, y: FLOOR + k * 0.41, z: -3.35 }));
      for (const [cx, cy, r] of k === 0 ? [[-0.14, 0.2, 0.12], [0.14, 0.2, 0.12]] : [[0, 0.21, 0.15]]) {
        add(cylinder(r, r, 0.02, 14, C.grey, { x: sx + cx, y: FLOOR + k * 0.41 + cy, z: -3.1, rx: Math.PI / 2 }));
        add(cylinder(r * 0.4, r * 0.4, 0.03, 10, C.black, { x: sx + cx, y: FLOOR + k * 0.41 + cy, z: -3.09, rx: Math.PI / 2 }));
      }
    }
    blockers.push(rect(sx, -3.35, 0.31, 0.25));
  }

  // ---- the truss -------------------------------------------------------------
  // Two chords with braces between them, on a leg at each end, and the fixtures hung off it:
  // the three laser heads and four moving heads, whose positions the show reads back.
  const TRUSS_Y = FLOOR + 1.95;
  for (const dy of [0, 0.22]) {
    add(cylinder(0.018, 0.018, TRUSS_HALF * 2, 6, C.grey, { x: TRUSS_HALF, y: TRUSS_Y + dy, z: TRUSS_Z, rz: Math.PI / 2 }));
  }
  for (let i = 0; i <= 12; i++) {
    const tx = -TRUSS_HALF + (i / 12) * TRUSS_HALF * 2;
    add(box(0.012, 0.3, 0.012, C.grey, { x: tx, y: TRUSS_Y, z: TRUSS_Z, rz: i % 2 ? 0.45 : -0.45 }));
  }
  for (const s of [-1, 1]) {
    add(box(0.08, TRUSS_Y + 0.24 - FLOOR, 0.08, C.grey, { x: s * TRUSS_HALF, y: FLOOR, z: TRUSS_Z }));
    add(box(0.3, 0.02, 0.3, C.black, { x: s * TRUSS_HALF, y: FLOOR, z: TRUSS_Z }));
    blockers.push(rect(s * TRUSS_HALF, TRUSS_Z, 0.06, 0.06));
  }
  const lasers = [-2.2, 0, 2.2].map((lx) => [lx, TRUSS_Y - 0.07, TRUSS_Z + 0.02]);
  for (const [lx, ly, lz] of lasers) {
    add(box(0.14, 0.08, 0.16, C.black, { x: lx, y: ly - 0.02, z: lz }));
    add(box(0.05, 0.03, 0.01, C.cyan, { x: lx, y: ly + 0.005, z: lz + 0.081, emissive: 0.6 }));
  }
  const heads = [-2.7, -1.0, 1.0, 2.7].map((hx) => [hx, TRUSS_Y - 0.1, TRUSS_Z]);
  for (const [hx, hy, hz] of heads) {
    add(box(0.12, 0.05, 0.12, C.black, { x: hx, y: hy + 0.06, z: hz }));
    add(sphere(0.06, C.black, { x: hx, y: hy, z: hz }));
  }
  const BALL = [0, FLOOR + CEILING - 0.52, 0.8];
  addRoof(cylinder(0.006, 0.006, 0.34, 4, C.iron, { x: BALL[0], y: BALL[1] + 0.17, z: BALL[2] }));

  // ---- the bar, along the west wall -----------------------------------------
  const BAR_X = -4.05, BAR_HX = 0.14, BAR_Z = 1.3, BAR_HZ = 1.5, BAR_H = 0.28;
  const COUNTER_Y = FLOOR + BAR_H + 0.03;
  add(box(BAR_HX * 2, BAR_H, BAR_HZ * 2, C.black, { x: BAR_X, y: FLOOR, z: BAR_Z }));
  add(box(BAR_HX * 2 + 0.08, 0.03, BAR_HZ * 2 + 0.08, C.wood, { x: BAR_X, y: FLOOR + BAR_H, z: BAR_Z }));
  add(box(0.012, 0.02, BAR_HZ * 2, C.neon, { x: BAR_X + BAR_HX + 0.004, y: FLOOR + 0.03, z: BAR_Z, emissive: 1 }));
  blockers.push(rect(BAR_X, BAR_Z, BAR_HX, BAR_HZ));
  const SHELF_X = -HALF_W + 0.08;
  add(box(0.16, 0.46, BAR_HZ * 2 + 0.2, C.darkWood, { x: SHELF_X, y: FLOOR, z: BAR_Z }));
  blockers.push(rect(SHELF_X, BAR_Z, 0.08, BAR_HZ + 0.1));
  for (const sy of [0.22, 0.4]) add(box(0.18, 0.02, BAR_HZ * 2 + 0.1, C.wood, { x: SHELF_X + 0.03, y: FLOOR + sy, z: BAR_Z }));
  const BOTTLES = [C.bottleGreen, C.bottleBrown, C.glass, C.bottleGreen, C.cyan, C.bottleBrown];
  for (let i = 0; i < 30; i++) {
    const row = i >= 15 ? 1 : 0;
    const bz = BAR_Z - 1.35 + (i % 15) * 0.19 + row * 0.06;
    add(cylinder(0.014, 0.017, 0.075, 6, BOTTLES[i % BOTTLES.length], { x: SHELF_X + 0.04, y: FLOOR + (row ? 0.42 : 0.24), z: bz, emissive: BOTTLES[i % BOTTLES.length] === C.cyan ? 0.6 : 0 }));
  }
  // The neon over it: a pink tube along the wall, bent round at both ends.
  add(box(0.03, 0.03, BAR_HZ * 2, C.neon, { x: -HALF_W + 0.03, y: FLOOR + 0.78, z: BAR_Z, emissive: 1 }));
  for (const e of [-1, 1]) add(box(0.03, 0.16, 0.03, C.neon, { x: -HALF_W + 0.03, y: FLOOR + 0.63, z: BAR_Z + e * BAR_HZ, emissive: 1 }));
  // Five stools, facing the counter - which is west, a yaw of -pi/2.
  const SEAT_H = 0.19;
  for (let i = 0; i < 5; i++) {
    const sz = 0.1 + i * 0.62;
    const sx = BAR_X + BAR_HX + 0.29;
    add(cylinder(0.022, 0.028, SEAT_H - 0.03, 7, C.iron, { x: sx, y: FLOOR, z: sz }));
    add(cylinder(0.08, 0.075, 0.03, 10, C.black, { x: sx, y: FLOOR + SEAT_H - 0.03, z: sz }));
    add(cylinder(0.062, 0.062, 0.012, 8, C.iron, { x: sx, y: FLOOR + 0.06, z: sz }));
    seats.push({
      id: `stool:${i}`, kind: 'seat', label: 'a bar stool',
      x: sx, z: sz, y: FLOOR + SEAT_H, yaw: -Math.PI / 2, r: 0.42,
      beer: [BAR_X + 0.03, COUNTER_Y, sz - 0.07],
      snack: [BAR_X + 0.05, COUNTER_Y, sz + 0.08],
    });
  }

  // The barman walks the length of his bar, which runs along z here; the bouncer stands
  // inside the gate watching who comes in. Both in black.
  const inBlack = (seed, extra = {}) => ({ ...settlerLook(seed, 'unknown'), tunic: 0x1a1a20, trim: 0x121216, hatShape: 'none', ...extra });
  figures.push({ style: 'unknown', look: inBlack('rave:barman'), at: [-4.55, FLOOR, BAR_Z], yaw: Math.PI / 2, seed: 0.4, tends: true, along: 'z' });
  blockers.push(rect(-4.55, BAR_Z, 0.11, BAR_HZ));
  figures.push({ style: 'unknown', look: inBlack('rave:bouncer', { build: 1.3, height: 1.08 }), at: [0.95, FLOOR, HALF_D - 0.45], yaw: -Math.PI / 2 + 0.3, seed: 1.9 });
  blockers.push(rect(0.95, HALF_D - 0.45, 0.13, 0.13));

  // Where the dancers stand: a jittered grid over the floor, thickest at the front, with the
  // run from the gate kept clear and nobody on a stool, a pillar or the truss's feet. From a
  // stream of its own so the floor is the same floor every visit.
  const rng = makeRng('rave:floor');
  const spots = [];
  for (let z = -1.45; z <= 3.1; z += 0.43) {
    for (let x = -3.5; x <= 3.9; x += 0.43) {
      const jx = x + rng.range(-0.13, 0.13), jz = z + rng.range(-0.13, 0.13);
      const keep = rng.next() < 0.97 - 0.13 * (jz + 1.45);
      if (!keep) continue;
      if (Math.abs(jx) < 0.6 && jz > 1.8) continue;                    // the way in
      if (jx < -3.25 && jz > -0.5) continue;                            // the stools
      if (Math.abs(Math.abs(jx) - TRUSS_HALF) < 0.3 && Math.abs(jz - TRUSS_Z) < 0.3) continue;
      if (jx > 4.4 && Math.abs(jz - 0.4) < 0.45) continue;              // the pillar
      spots.push([jx, jz]);
    }
  }
  spots.sort((a, b) => a[1] - b[1] || a[0] - b[0]);                     // the front fills first

  const layout = {
    FLOOR, STAGE_TOP, lasers, heads, BALL, LED, spots: spots.slice(0, MAX_DANCERS),
    dj: [0, STAGE_TOP, -3.05],
  };
  blockers.push(rect(0, -3.05, 0.1, 0.1));

  return {
    name: 'the castle',
    parts, roof, blockers, seats, figures, lights: [],
    ceiling: CEILING,
    background: 0x07050c,
    fog: [3.5, 17],
    ambience: { sky: 0x3a2a55, ground: 0x08050c, hemi: 0.3, hex: 0x2a1c3a, amb: 0.1 },
    stage: { ...STAGE, height: STAGE_TOP },
    areas: [{ x0: -HALF_W, x1: HALF_W, z0: -HALF_D, z1: HALF_D }],
    // Well in, on the run from the gate, facing the stage: the first thing you see is the
    // DJ with the lasers coming at you over the crowd.
    spawn: { x: 0, z: HALF_D - 1.5 },
    doorway: { z: HALF_D + WALL, hx: DOOR_HALF + 0.02 },
    camera: { back: 2.4, up: 0.8, aim: 0.32 },
    show: (opts) => createRaveShow({ ...opts, layout }),
  };
}

// ------------------------------------------------------------------ what moves
function createRaveShow({ scene, material, layout }) {
  const { FLOOR, lasers, heads, BALL, LED } = layout;
  const tmp = new THREE.Object3D();
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const v = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  const UP_Z = new THREE.Vector3(0, 0, 1), DOWN = new THREE.Vector3(0, -1, 0);

  // Light, for what the building material shows: dark over everything, four washes over the
  // floor that pulse with the kick, one on the DJ, the neon over the bar, and a strobe that
  // is an ambient light doing nothing until the song asks. PointLights are counted into the
  // shader, so their number is fixed here and only their colour and intensity ever change.
  const washes = [[-1.9, -0.4], [1.9, -0.4], [-1.9, 2.3], [1.9, 2.3]].map(([x, z]) => {
    const l = new THREE.PointLight(0xffffff, 0, 5.5, 2);
    l.position.set(x, FLOOR + 1.7, z);
    scene.add(l);
    return l;
  });
  const djLight = new THREE.PointLight(0xff2ed1, 1.2, 3.5, 2);
  djLight.position.set(0, FLOOR + 1.1, -2.3);
  const barLight = new THREE.PointLight(0xff5fb8, 1.1, 3.2, 2);
  barLight.position.set(-4.3, FLOOR + 0.9, 1.3);
  const strobe = new THREE.AmbientLight(0xffffff, 0);
  scene.add(djLight, barLight, strobe);

  const glow = (o = {}) => new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, ...o,
  });
  const paint = (g, fn) => {
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const k = fn(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  };
  const batch = (geo, mat, n) => {
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) mesh.setColorAt(i, col.setRGB(0, 0, 0));
    scene.add(mesh);
    return mesh;
  };

  // The beams: a bright core in a faint halo, one unit long down +z, stretched to the wall.
  const beamGeo = mergeGeometries([
    paint(new THREE.BoxGeometry(0.011, 0.011, 1).translate(0, 0, 0.5), () => 1),
    paint(new THREE.BoxGeometry(0.042, 0.042, 1).translate(0, 0, 0.5), () => 0.22),
  ], false);
  const FAN = 7;
  const beams = batch(beamGeo, glow({ opacity: 0.9 }), lasers.length * FAN);

  // The moving heads: a cone of light from the fixture to the floor, brightest at the lamp,
  // and a pool where it lands.
  const coneGeo = paint(new THREE.CylinderGeometry(0.02, 0.3, 1, 20, 1, true).translate(0, -0.5, 0), (x, y) => 0.12 + 0.88 * (1 + y));
  const cones = batch(coneGeo, glow({ opacity: 0.2, side: THREE.DoubleSide }), heads.length);
  const poolGeo = paint(new THREE.CircleGeometry(0.42, 24).rotateX(-Math.PI / 2), (x, y, z) => Math.max(0, 1 - Math.hypot(x, z) / 0.42));
  const pools = batch(poolGeo, glow({ opacity: 0.55 }), heads.length);

  // The mirror ball, turning, and the specks it throws round the walls.
  // finish() in buildings.js drops the normals, which a merged room gets back in one go
  // (interior.js mergeGeom); a mesh on its own has to ask.
  const ballGeo = sphere(0.17, C.silver, { emissive: 0.35 });
  ballGeo.computeVertexNormals();
  const ball = new THREE.Mesh(ballGeo, material);
  ball.position.set(...BALL);
  scene.add(ball);
  const SPECKS = 110;
  const speckRng = makeRng('rave:specks');
  const speckDirs = Array.from({ length: SPECKS }, () => {
    const y = speckRng.range(-0.85, 0.3), a = speckRng.range(0, Math.PI * 2), r = Math.sqrt(1 - y * y);
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  const specks = batch(paint(new THREE.PlaneGeometry(0.05, 0.05), () => 1), glow({ opacity: 0.85, side: THREE.DoubleSide }), SPECKS);

  // The LED wall behind the DJ, cell by cell. Not additive: it is a screen, not light.
  const cells = batch(paint(new THREE.PlaneGeometry(LED.cell * 0.86, LED.cell * 0.86), () => 1),
    new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), LED.cols * LED.rows);
  for (let r = 0; r < LED.rows; r++) {
    for (let c = 0; c < LED.cols; c++) {
      tmp.position.set(LED.x + (c - (LED.cols - 1) / 2) * LED.cell, LED.y + (r + 0.5) * LED.cell, LED.z);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.setScalar(1);
      tmp.updateMatrix();
      cells.setMatrixAt(r * LED.cols + c, tmp.matrix);
    }
  }

  // ---- the people --------------------------------------------------------------
  // The whole floor is one crowd of the island's own instanced batches (settler-figures.js),
  // dancing through `f.anim = 'dance'`. Rebuilt on every visit from whoever main.js says is
  // on the island tonight, which costs nothing: `free` hands the slots back.
  const view = createFigures(scene, material);
  const figs = [];
  let dancers = [];
  const faceStage = (x, z) => Math.atan2(0 - x, -2.6 - z);

  function dress(guests) {
    for (const d of dancers) view.free(d.f);
    dancers = [];
    figs.length = 0;
    const pool = (guests || []).filter((g) => g && g.id);
    const styles = pool.length ? pool.map((g) => g.style) : ['opus', 'sonnet', 'haiku', 'fable'];
    const join = (id, look, at, move) => {
      const rng = makeRng(`${id}:rave`);
      const f = {
        id, pos: [at[0], at[2]], y: at[1], yaw: 0, visible: true, anim: 'dance', mode: 'idle', speed: 0,
        faceAngle: move === 5 ? 0 : faceStage(at[0], at[2]) + rng.range(-0.45, 0.45),
        beat: 0, move, hype: 0,
      };
      if (!view.enrol(f, look, 'adult')) return;
      figs.push(f);
      dancers.push({
        f, home: [at[0], at[2]], off: [0, 0], lag: rng.range(0, 0.07),
        moves: [rng.int(5), rng.int(5)], eager: rng.next(), dj: move === 5,
      });
    };
    layout.spots.forEach(([x, z], i) => {
      // Somebody from this island, most active first; past the end of them, people who
      // came over from the other islands for it, in the island's own styles.
      const g = pool[i];
      const id = g ? g.id : `rave:guest:${i}`;
      const style = g ? g.style : styles[hash32(id) % styles.length];
      join(id, settlerLook(id, style, 'adult'), [x, FLOOR, z], 0);
    });
    const dj = { ...settlerLook('rave:dj', 'fable'), tunic: 0x18181e, trim: 0x22222a, hatShape: 'cap', hat: 0xff2ed1 };
    join('rave:dj', dj, layout.dj, 5);
  }

  // A dancer's move for this bar: two of their own, swapped every four bars; in the build
  // the hands go up one by one, and in its last bar everybody's are.
  function moveOf(d, bar) {
    if (d.dj) return 5;
    if (bar >= BUILD + 3) return 1;
    if (bar >= BUILD && (bar - BUILD + 1) / 3 > d.eager) return 1;
    return d.moves[Math.floor(bar / 4) % 2];
  }

  // Where the hall is in the song, worked out once a frame and read by everything below.
  let own = 0;
  const S = { beats: 0, bar: 0, u: 0, inBar: 0, section: 'drop', pulse: 0, hype: 0 };
  function keepTime(dt, clock) {
    own = (own + dt) % LOOP_S;
    const t = clock == null ? own : clock;
    if (clock != null) own = clock;
    S.beats = t / SPB;
    S.bar = Math.floor(S.beats / 4) % BARS;
    S.inBar = S.beats - S.bar * 4;
    S.u = S.beats - Math.floor(S.beats);
    S.section = sectionOf(S.bar);
    S.pulse = S.bar < BUILD ? Math.exp(-S.u * 6) : 0;
    S.hype = S.bar < 2 ? clamp(1 - S.beats / 8, 0, 1) : 0;
  }

  // A ray from `o` along `d` to the inside of the hall, and which wall it met.
  const hit = { t: 0, n: [0, 0, 0] };
  function toWall(o, d) {
    hit.t = 30;
    const test = (lo, hi, oo, dd, axis) => {
      if (dd > 1e-6) { const t = (hi - oo) / dd; if (t < hit.t) { hit.t = t; hit.n = axis === 0 ? [-1, 0, 0] : axis === 1 ? [0, -1, 0] : [0, 0, -1]; } }
      else if (dd < -1e-6) { const t = (lo - oo) / dd; if (t < hit.t) { hit.t = t; hit.n = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1]; } }
    };
    test(-HALF_W, HALF_W, o[0], d[0], 0);
    test(FLOOR, FLOOR + CEILING, o[1], d[1], 1);
    test(-HALF_D, HALF_D, o[2], d[2], 2);
    return hit;
  }

  function aimBeam(i, o, yaw, pitch, bright, colour) {
    const d = [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const len = toWall(o, d).t;
    v.set(d[0], d[1], d[2]);
    q.setFromUnitVectors(UP_Z, v);
    m.compose(tmp.position.set(o[0], o[1], o[2]), q, s.set(1, 1, len));
    beams.setMatrixAt(i, m);
    beams.setColorAt(i, col.copy(colour).multiplyScalar(bright));
  }

  function drawLasers() {
    const b = S.beats, sec = S.section;
    lasers.forEach((o, e) => {
      for (let j = 0; j < FAN; j++) {
        const i = e * FAN + j, k = (j - (FAN - 1) / 2) / ((FAN - 1) / 2);   // -1..1 across the fan
        let yaw = 0, pitch = 0.2, bright = 0, colour = GREEN;
        if (sec === 'drop') {
          yaw = 0.55 * Math.sin(Math.PI * b / 2 + e * 2.1) + k * 0.95;
          pitch = 0.2 + 0.1 * Math.sin(Math.PI * b + e);
          bright = 0.55 + 0.45 * (1 - (b * 2 - Math.floor(b * 2)));
          colour = Math.floor(b) % 2 ? WHITE : GREEN;
        } else if (sec === 'groove') {
          yaw = 0.45 * Math.sin(Math.PI * b / 4 + e * 1.3) + k * 0.6;
          pitch = 0.22 + 0.06 * Math.sin(Math.PI * b / 8 + j);
          bright = 0.7 + 0.3 * S.pulse;
          colour = GROOVE[Math.floor(S.bar / 2) % GROOVE.length];
        } else if (sec === 'sheet') {
          yaw = k * 1.2 + 0.1 * Math.sin(Math.PI * b / 4);
          pitch = 0.13 + 0.03 * Math.sin(Math.PI * b / 2 + e);
          bright = 0.75 + 0.25 * S.pulse;
          colour = S.bar % 2 ? MAGENTA : RED;
        } else if (sec === 'flick') {
          const eighth = Math.floor(b * 2), on = b * 2 - eighth < 0.35 && j === (hash32(`${e}:${eighth}`) % FAN);
          yaw = ((hash32(`${e}:${eighth}:y`) % 100) / 100 - 0.5) * 1.6;
          pitch = 0.1 + ((hash32(`${e}:${eighth}:p`) % 100) / 100) * 0.3;
          bright = on ? 1 : 0;
          colour = RED;
        }
        aimBeam(i, o, yaw, pitch, bright, colour);
      }
    });
    beams.instanceMatrix.needsUpdate = true;
    beams.instanceColor.needsUpdate = true;
  }

  function drawHeads() {
    const b = S.beats, sec = S.section;
    heads.forEach((o, i) => {
      const tx = clamp(Math.sin(Math.PI * b / 8 + i * 1.7) * 3.1, -HALF_W + 0.5, HALF_W - 0.5);
      const tz = 0.9 + Math.cos(Math.PI * b / 6 + i * 2.3) * 1.9;
      v.set(tx - o[0], FLOOR - o[1], tz - o[2]);
      const len = v.length();
      v.divideScalar(len);
      q.setFromUnitVectors(DOWN, v);
      m.compose(tmp.position.set(o[0], o[1], o[2]), q, s.set(len * 0.9, len, len * 0.9));
      cones.setMatrixAt(i, m);
      m.compose(tmp.position.set(tx, FLOOR + 0.004, tz), q.identity(), s.set(len * 0.62, 1, len * 0.62));
      pools.setMatrixAt(i, m);
      const colour = sec === 'break' ? BLUE : sec === 'rise' ? WHITE : sec === 'flick' ? RED
        : i % 2 ? AMBER : GROOVE[(Math.floor(S.bar / 2) + i) % GROOVE.length];
      const bright = sec === 'break' ? 0.55 : sec === 'rise' ? 0.4 + 0.6 * (S.inBar / 4) : sec === 'flick' ? 0.35 : 0.65 + 0.35 * S.pulse;
      col.copy(colour).multiplyScalar(bright);
      cones.setColorAt(i, col);
      pools.setColorAt(i, col);
    });
    for (const mesh of [cones, pools]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
  }

  function drawSpecks() {
    const turn = S.beats * 0.11;
    ball.rotation.y = turn;
    const on = S.section === 'groove' || S.section === 'sheet' || S.section === 'break';
    const cs = Math.cos(turn), sn = Math.sin(turn);
    for (let i = 0; i < SPECKS; i++) {
      const [dx, dy, dz] = speckDirs[i];
      const d = [dx * cs + dz * sn, dy, -dx * sn + dz * cs];
      const h = toWall(BALL, d);
      tmp.position.set(BALL[0] + d[0] * h.t + h.n[0] * 0.01, BALL[1] + d[1] * h.t + h.n[1] * 0.01, BALL[2] + d[2] * h.t + h.n[2] * 0.01);
      q.setFromUnitVectors(UP_Z, v.set(h.n[0], h.n[1], h.n[2]));
      m.compose(tmp.position, q, s.set(1, 1, 1));
      specks.setMatrixAt(i, m);
      specks.setColorAt(i, col.setRGB(1, 1, 1).multiplyScalar(on ? (S.section === 'break' ? 0.9 : 0.55) : 0));
    }
    specks.instanceMatrix.needsUpdate = true;
    specks.instanceColor.needsUpdate = true;
  }

  function drawWall() {
    const { cols, rows } = LED, sec = S.section, b = S.beats;
    const mid = (cols - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let k = 0.04;
        let colour = GROOVE[Math.floor(S.bar / 2) % GROOVE.length];
        if (sec === 'drop') {
          const ring = Math.hypot((c - mid) / 2, r - rows / 2);
          k = Math.abs(ring - (S.u * 8)) < 1.2 ? 1 : 0.08;
          colour = Math.floor(b) % 2 ? WHITE : GREEN;
        } else if (sec === 'groove') {
          // A spectrum: the low end on the left jumps with the kick, the top rattles along.
          const f = c / (cols - 1);
          const level = 0.15 + S.pulse * 0.8 * (1 - f) + 0.35 * f * (0.5 + 0.5 * Math.sin(Math.PI * b * 4 + c * 1.9));
          k = (r + 0.5) / rows < level ? 0.35 + 0.65 * (r / rows) : 0.04;
          if (r >= rows - 2 && k > 0.1) colour = WHITE;
        } else if (sec === 'sheet') {
          k = (c + r + Math.floor(b * 2)) % 6 < 2 ? 0.9 : 0.05;
          colour = S.bar % 2 ? MAGENTA : RED;
        } else if (sec === 'break') {
          k = 0.18 + 0.2 * Math.sin(c * 0.5 + r * 0.35 + b * 0.8);
          colour = BLUE;
        } else if (sec === 'flick') {
          k = hash32(`${c}:${r}:${Math.floor(b * 2)}`) % 9 === 0 ? 1 : 0.03;
          colour = RED;
        } else {
          k = r < Math.floor((S.inBar / 4) * (rows + 1)) ? (0.6 + 0.4 * Math.exp(-S.u * 5)) : 0.03;
          colour = WHITE;
        }
        cells.setColorAt(r * cols + c, col.copy(colour).multiplyScalar(k));
      }
    }
    cells.instanceColor.needsUpdate = true;
  }

  function drawLights() {
    const sec = S.section;
    washes.forEach((l, i) => {
      if (sec === 'break') { l.color.copy(BLUE); l.intensity = 0.5; }
      else if (sec === 'flick') { l.color.copy(RED); l.intensity = 0.25 + 0.9 * Math.exp(-S.u * 7); }
      else if (sec === 'rise') { l.color.copy(WHITE); l.intensity = 0.15 + 0.6 * (S.inBar / 4); }
      else {
        l.color.copy(GROOVE[(Math.floor(S.bar / 2) + i) % GROOVE.length]);
        l.intensity = 0.35 + 2.2 * S.pulse * (sec === 'drop' ? 1.3 : 1);
      }
    });
    djLight.intensity = sec === 'break' ? 0.6 : 1.0 + 0.8 * S.pulse;
    djLight.color.copy(sec === 'break' ? BLUE : MAGENTA);
    // The strobe: one hit on the drop, and a flash a beat through the last bar of the build.
    // Never faster than the beat (see the top of this file).
    strobe.intensity = S.bar === 0 && S.beats < 1 ? 2.4 * Math.exp(-S.beats * 5)
      : sec === 'rise' ? 1.4 * Math.exp(-S.u * 9) : 0;
  }

  function update(dt, { clock = null } = {}, player = null) {
    keepTime(dt, clock);
    drawLasers();
    drawHeads();
    drawSpecks();
    drawWall();
    drawLights();
    // The floor parts round you: anybody whose spot you are standing on steps aside, and
    // steps back once you have gone. Only on the floor - up on the stage you are nobody's way.
    const PART = 0.36;
    const onFloor = player && player.y < FLOOR + 0.05;
    for (const d of dancers) {
      let tx = 0, tz = 0;
      if (onFloor && !d.dj) {
        const dx = d.home[0] - player.x, dz = d.home[1] - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist < PART) {
          const ux = dist > 1e-3 ? dx / dist : 1, uz = dist > 1e-3 ? dz / dist : 0;
          tx = ux * (PART - dist); tz = uz * (PART - dist);
        }
      }
      const k = Math.min(1, dt * 7);
      d.off[0] += (tx - d.off[0]) * k;
      d.off[1] += (tz - d.off[1]) * k;
      d.f.pos[0] = d.home[0] + d.off[0];
      d.f.pos[1] = d.home[1] + d.off[1];
      d.f.beat = S.beats + d.lag;
      d.f.move = moveOf(d, S.bar);
      d.f.hype = S.hype;
      // Now and then somebody has a drink, and the glass is the crowd's own pint.
      if (!d.dj && Math.random() < dt * 0.004) view.drinkBeer(d.f);
    }
    view.draw(figs, dt);
  }

  function dispose() {
    view.dispose();
    for (const mesh of [beams, cones, pools, specks, cells]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    ball.geometry.dispose();
  }

  return { enter: ({ dancers: guests } = {}) => { own = 0; dress(guests); }, update, dispose };
}
