// Inside the gold mine (Plans/goudmijn-zoektocht.md): a cave of rough rock and timber props, and in
// it the field of spots to dig - ROOMS.goldmine in interior.js. One room for every floor: going down
// the stair seeds the field again and puts you back at the way in; the cave stays, only darker.
//
// Primitives, not a bake: the field changes with every dig, and at seven by seven it is cheaper to
// merge it again (a few hundred triangles, on a dig) than to keep instanced meshes in step. The walls
// and the props are merged once, like every room's. The rules are web/js/mine.js's; this draws them
// and answers E.
import * as THREE from 'three';
import { box, cylinder, sphere, mergeParts } from './buildings.js';
import { makeRng } from 'shared/rng.mjs';
import { GRID, CELL, SPOTS, spotCentre, spotAt, MINE_DIG_SECONDS } from 'shared/mine.mjs';

const C = {
  earth: 0x5a4330, loose: 0x7a5a3a, dark: 0x1e1610, rock: 0x77726a, rockDark: 0x5b5751,
  timber: 0x6b4a2f, timberDark: 0x4a3220, iron: 0x3a3a3f, lamp: 0xffc65a, rope: 0xa88a5a,
  key: 0xb8923e, step: 0x5e4128,
};

// The cave: the field in its middle a little to the north, the way in at the south (+z) wall.
const FIELD = GRID * CELL;               // 4.2 across
const FIELD_Z = -0.5;                    // the field's middle
const HALF_W = FIELD / 2 + 1.0;
const HALF_D = FIELD / 2 + 1.6;
const NORTH = FIELD_Z - FIELD / 2 - 0.9; // the back wall's face
// The front wall's face, with the way in: far enough behind the field that the camera has its reach
// behind somebody standing at the field's edge - nearer, it climbed over your hat and looked down.
const SOUTH = FIELD_Z + FIELD / 2 + 2.6;
const SPAWN_Z = SOUTH - 2.0;
const WALL = 0.3;
const CEILING = 1.2;
const DOOR_HALF = 0.4;
// Where a dig's hole is, measured from the feet: walk.js DIG_REACH (0.6), which is one spot.
const AHEAD = 0.6;
// The spot under the field's (x, z), in room space.
const fieldSpot = (x, z) => spotAt(x, z - FIELD_Z);
const spotRoom = (i) => { const c = spotCentre(i); return { x: c.x, z: c.z + FIELD_Z }; };

// The still part: floor, walls, props, lamps, the ceiling (the lid).
function shellParts(FLOOR) {
  const parts = [], roof = [];
  const rng = makeRng('goldmine:cave');
  const w = HALF_W * 2, d = SOUTH - NORTH;
  const midZ = (SOUTH + NORTH) / 2;
  parts.push(box(w + WALL * 2, 0.24, d + WALL * 2, C.earth, { y: FLOOR - 0.24, z: midZ }));
  // Rough rock walls: overlapping boulders of a few sizes along each face, so the line is broken.
  const boulder = (x, z, s) => {
    const h = CEILING * (0.9 + rng.next() * 0.25);
    parts.push(box(s, h, s, rng.next() < 0.5 ? C.rock : C.rockDark, { x, y: FLOOR, z, ry: rng.next() * 0.6 }));
  };
  for (let x = -HALF_W; x <= HALF_W + 0.01; x += 0.45) {
    boulder(x, NORTH - WALL / 2 - rng.next() * 0.1, 0.5 + rng.next() * 0.2);
    if (Math.abs(x) > DOOR_HALF + 0.25) boulder(x, SOUTH + WALL / 2 + rng.next() * 0.1, 0.5 + rng.next() * 0.2);
  }
  for (let z = NORTH; z <= SOUTH + 0.01; z += 0.45) {
    boulder(-HALF_W - WALL / 2 - rng.next() * 0.1, z, 0.5 + rng.next() * 0.2);
    boulder(HALF_W + WALL / 2 + rng.next() * 0.1, z, 0.5 + rng.next() * 0.2);
  }
  // Timber sets along the side walls: two posts and a cap, every so often, and over the way in.
  const set = (z) => {
    for (const sx of [-1, 1]) parts.push(box(0.09, CEILING - 0.05, 0.09, C.timber, { x: sx * (HALF_W - 0.1), y: FLOOR, z }));
    roof.push(box(w - 0.1, 0.09, 0.1, C.timberDark, { y: FLOOR + CEILING - 0.14, z }));
  };
  for (let z = NORTH + 0.6; z < SOUTH - 0.3; z += 1.4) set(z);
  for (const sx of [-1, 1]) parts.push(box(0.11, 0.85, 0.11, C.timber, { x: sx * (DOOR_HALF + 0.06), y: FLOOR, z: SOUTH }));
  parts.push(box(DOOR_HALF * 2 + 0.3, 0.1, 0.13, C.timberDark, { y: FLOOR + 0.85, z: SOUTH }));
  // Lanterns on the posts: the glow is theirs, the light the lamps' below.
  for (const [x, z] of LAMPS) {
    parts.push(box(0.06, 0.08, 0.06, C.lamp, { x, y: FLOOR + 0.72, z, emissive: 1 }));
    parts.push(box(0.08, 0.015, 0.08, C.iron, { x, y: FLOOR + 0.8, z }));
  }
  // A rope ladder hanging in at the way in, the way back up - from any floor it is the way out.
  for (let y = 0.1; y < 0.8; y += 0.12) parts.push(box(0.28, 0.02, 0.03, C.rope, { x: LADDER.x, y: FLOOR + y, z: SOUTH - 0.1 }));
  // The lid: a ceiling of rock.
  roof.push(box(w + WALL * 2, 0.2, d + WALL * 2, C.rockDark, { y: FLOOR + CEILING, z: midZ }));
  return { parts, roof };
}
// The rope ladder by the way in: where it hangs, and where E at it is answered (a step in front).
const LADDER = { x: DOOR_HALF + 0.3, z: SOUTH - 0.45 };
const LAMPS = [[-HALF_W + 0.2, NORTH + 0.6], [HALF_W - 0.2, NORTH + 0.6], [-HALF_W + 0.2, SOUTH - 0.9], [HALF_W - 0.2, SOUTH - 0.9]];

// The field as it stands: a mound of loose earth on every spot not dug, a rock where there is one, a
// hole where there was a dig, and the stair (or the key) where the goal was dug open.
function fieldParts(FLOOR, run) {
  const parts = [];
  const f = run.plan();
  if (!f) return parts;
  const rng = makeRng(`goldmine:field:${run.floor()}`);
  const s = CELL * 0.82;
  for (let i = 0; i < SPOTS; i++) {
    const { x, z } = spotRoom(i);
    const jx = (rng.next() - 0.5) * 0.06, jz = (rng.next() - 0.5) * 0.06, turn = rng.next();
    if (f.rock[i]) {
      // A boulder: three blocks leaning into one another, so it reads as stone and not as a crate.
      parts.push(box(s * 0.85, 0.24, s * 0.8, C.rockDark, { x: x + jx, y: FLOOR - 0.04, z: z + jz, ry: turn, rx: 0.12, rz: -0.1 }));
      parts.push(box(s * 0.6, 0.3, s * 0.55, C.rock, { x: x - jx, y: FLOOR + 0.06, z: z - jz, ry: -turn * 2, rx: -0.25, rz: 0.2 }));
      parts.push(box(s * 0.35, 0.22, s * 0.35, C.rock, { x: x + jz * 2, y: FLOOR + 0.24, z: z + jx * 2, ry: turn * 3, rx: 0.3, rz: 0.35 }));
      continue;
    }
    if (!run.isDug(i)) {
      parts.push(box(s, 0.05, s, C.loose, { x, y: FLOOR, z, ry: turn * 0.2 }));
      parts.push(box(s * 0.6, 0.08, s * 0.55, C.loose, { x: x + jx, y: FLOOR, z: z + jz, ry: turn }));
      continue;
    }
    // A hole, and the earth thrown up beside it.
    parts.push(box(s * 0.78, 0.012, s * 0.78, C.dark, { x, y: FLOOR, z }));
    parts.push(box(s * 0.3, 0.05, s * 0.25, C.loose, { x: x + s * 0.42, y: FLOOR, z: z - s * 0.3, ry: turn }));
    if (i !== f.goal) continue;
    if (!f.bottom) {
      // The stair: treads going down into the dark, a post either side.
      for (let k = 0; k < 3; k++) parts.push(box(s * 0.6, 0.012, 0.06, C.step, { x, y: FLOOR + 0.004 + k * 0.001, z: z - 0.12 + k * 0.1 }));
      for (const sx of [-1, 1]) parts.push(box(0.04, 0.22, 0.04, C.timber, { x: x + sx * s * 0.36, y: FLOOR, z: z + s * 0.36 }));
    } else if (!run.keyTaken()) {
      // The key, old iron with a gleam of brass, on a little stone.
      parts.push(box(0.12, 0.05, 0.12, C.rockDark, { x, y: FLOOR, z }));
      parts.push(cylinder(0.035, 0.035, 0.012, 10, C.key, { x: x - 0.05, y: FLOOR + 0.05, z, emissive: 0.6 }));
      parts.push(box(0.1, 0.012, 0.016, C.key, { x: x + 0.02, y: FLOOR + 0.05, z, emissive: 0.6 }));
      parts.push(box(0.016, 0.012, 0.03, C.key, { x: x + 0.065, y: FLOOR + 0.05, z: z + 0.015, emissive: 0.6 }));
    }
  }
  return parts;
}

// The room. `run` is web/js/mine.js's createMineRun; `on` what the room tells main.js: `dug(what)` a
// dig that turned something up, `down(floor)` a floor reached, `key()` the key taken, `say(html)` a
// line for the toast, `drink()` a draught asked for (a promise), `out()` the attempt over.
export function buildGoldMine({ FLOOR, rect, run, on = {} }) {
  const { parts, roof } = shellParts(FLOOR);
  const blockers = [];
  const w = HALF_W * 2;
  // The walls, as blockers: the south one in two pieces with the way in between them.
  blockers.push(rect(0, NORTH - WALL / 2, HALF_W + WALL, WALL / 2));
  blockers.push(rect(-HALF_W - WALL / 2, (NORTH + SOUTH) / 2, WALL / 2, (SOUTH - NORTH) / 2 + WALL));
  blockers.push(rect(HALF_W + WALL / 2, (NORTH + SOUTH) / 2, WALL / 2, (SOUTH - NORTH) / 2 + WALL));
  const sideW = (w / 2 - DOOR_HALF) / 2;
  for (const sx of [-1, 1]) blockers.push(rect(sx * (DOOR_HALF + sideW), SOUTH + WALL / 2, sideW, WALL / 2));

  return {
    name: 'the gold mine',
    parts, roof, blockers, seats: [], figures: [], lights: [],
    ceiling: CEILING,
    background: 0x0b0806,
    fog: [6, 16],
    ambience: { sky: 0x6a5840, ground: 0x241a10, hemi: 0.7, hex: 0xffd9a0, amb: 0.3 },
    areas: [{ x0: -HALF_W, x1: HALF_W, z0: NORTH, z1: SOUTH }],
    spawn: { x: 0, z: SPAWN_Z },
    doorway: { z: SOUTH + WALL, hx: DOOR_HALF + 0.02 },
    // The rope ladder by the way in answers E as the way out (interior.js `exits`, no `to`: out by
    // the door like walking through it). Both of main.js's words for the mine send you to it, and it
    // was only drawn, so pressing E at it did nothing (Plans/speeltest-quests.md).
    exits: [{ id: 'goldmine:ladder', kind: 'exit', x: LADDER.x, z: LADDER.z, r: 0.55, label: 'the ladder', prompt: 'climb the ladder out of the mine' }],
    camera: { back: 1.8, up: 0.62, aim: 0.3 },
    show: (opts) => createMineShow({ ...opts, FLOOR, rect, run, on }),
  };
}

function createMineShow({ scene, material, FLOOR, rect, run, on }) {
  let field = null;
  let walk = null, refresh = null;
  // Four lamps, lit warm, and dimmer the deeper you go. A fixed count: it is in the program's key.
  const lamps = LAMPS.map(([x, z]) => {
    const l = new THREE.PointLight(0xffb85a, 2.4, 8, 1.6);
    l.position.set(x, FLOOR + 0.75, z);
    scene.add(l);
    return l;
  });
  function rebuild() {
    if (field) { scene.remove(field); field.geometry.dispose(); }
    const p = fieldParts(FLOOR, run);
    field = p.length ? new THREE.Mesh(mergeParts(p), material) : null;
    if (field) scene.add(field);
  }
  // The spot a dig would land on: one ahead of the feet, as walk.js puts the hole.
  const ahead = () => {
    if (!walk) return -1;
    const s = walk.state;
    return fieldSpot(s.pos.x + Math.sin(s.yaw) * AHEAD, s.pos.z + Math.cos(s.yaw) * AHEAD);
  };
  // What is under or ahead of the feet and answers E: the goal, once dug, wherever you stand on it;
  // else the spot ahead.
  const target = () => {
    if (!walk) return -1;
    const s = walk.state;
    const under = fieldSpot(s.pos.x, s.pos.z);
    const f = run.plan();
    if (f && under === f.goal && run.isDug(under)) return under;
    return ahead();
  };
  const PROMPTS = {
    dig: 'dig here', rock: 'a rock - nothing digs that', down: 'go down the stair', key: 'take the key',
    drink: 'too tired to dig - drink a draught', tired: 'too tired to dig, and no draught left',
  };
  // One interactable that is always where you stand when there is something to do ahead of you, so
  // walk mode's nearest-thing rule picks it over nothing, and its words follow the spot.
  const spotIt = {
    id: 'goldmine:spot', kind: 'minespot', r: 0.3,
    get x() { return walk && run.actionAt(target()) ? walk.state.pos.x : 1e6; },
    get z() { return walk && run.actionAt(target()) ? walk.state.pos.z : 1e6; },
    get prompt() { return PROMPTS[run.actionAt(target())] || null; },
    label: 'the earth',
  };
  let pending = -1;
  function interact() {
    const i = target();
    const what = run.actionAt(i);
    if (what === 'dig') {
      const { x, z } = spotRoom(i);
      const s = walk.state;
      if (Math.hypot(x - s.pos.x, z - s.pos.z) > 0.05) s.yaw = Math.atan2(x - s.pos.x, z - s.pos.z);
      if (walk.dig(MINE_DIG_SECONDS)) pending = i;
    } else if (what === 'rock') {
      on.say && on.say('A rock. Nothing digs through that.');
    } else if (what === 'down') {
      run.descend();
      pending = -1;
      rebuild();
      if (refresh) refresh();
      // Back at the way in, one floor deeper.
      walk.state.pos.set(0, FLOOR, SPAWN_Z);
      walk.state.yaw = Math.PI;
      dim();
      on.down && on.down(run.floor());
    } else if (what === 'key') {
      if (run.takeKey()) { rebuild(); on.key && on.key(); }
    } else if (what === 'drink') {
      on.drink && on.drink();
    } else if (what === 'tired') {
      on.out && on.out();
    }
  }
  function dim() {
    const deep = (run.floor() - 1) / 6;
    for (const l of lamps) l.intensity = 2.4 - 0.9 * deep;
  }
  return {
    // Every visit starts at the top (the keeper's rule), so the field is seeded here, not when built.
    enter() {
      pending = -1;
      rebuild();
      dim();
    },
    update() {},
    blockers() {
      const f = run.plan();
      const out = [];
      if (!f) return out;
      for (let i = 0; i < SPOTS; i++) {
        if (!f.rock[i]) continue;
        const { x, z } = spotRoom(i);
        out.push(rect(x, z, CELL * 0.36, CELL * 0.36));
      }
      return out;
    },
    interactables: () => [spotIt],
    // interior.js hands the room's walk mode over once it is made.
    bind(w, r) { walk = w; refresh = r; },
    onInteract(it) { if (it.kind !== 'minespot') return false; interact(); return true; },
    onDigDone() {
      const i = pending;
      pending = -1;
      if (i < 0) return;
      const what = run.dig(i);
      rebuild();
      if (what && on.dug) on.dug(what);
    },
    onDigCancelled() { pending = -1; },
    // A floor's rocks moved: the walk's solids again.
    refresh: () => refresh && refresh(),
    dispose() {
      if (field) { scene.remove(field); field.geometry.dispose(); }
      for (const l of lamps) scene.remove(l);
    },
  };
}

export const MINE_ROOM = { FIELD_Z, SOUTH, NORTH, HALF_W, spotRoom, fieldSpot };
