// The Salty Kraken's hall as numbers, and the only copy of them (Plans/piratenkroeg.md, schets 4;
// Plans/verdiepingen-binnen.md). Two readers: web/js/pirate-tavern.js makes the room of it - where
// you walk, climb, sit and bump - and scripts/build-piratetavern-room.py bakes what you see there,
// reading this file through node (`node scripts/kraken-layout-json.mjs`). So a floor that moves
// here moves in both, and a stair cannot be drawn in one place and walked in another.
//
// Room coordinates: x east, y up, z south (the door), the ground's top at F. No imports: Node and
// the page both read it as it is.

export const F = 0.06;                       // interior.js FLOOR
// The storeys, as the height of the boards you stand on.
export const LEVEL = { ground: F, terrace: F + 0.2, first: F + 0.8, second: F + 1.55 };
export const CEILING = 2.35;                 // over F; the lid (interior.js ROOF_AT) is here
export const TOP = F + CEILING;
export const WALL = 0.14;
export const DOOR_HALF = 0.42;

// The camera's rooms (interior.js `areas`): the hall, the rum cellar through its arch, the oriel.
export const HALL = { x0: -4.5, x1: 4.5, z0: -3.5, z1: 3.5 };
export const CELLAR = { x0: -4.5, x1: -1.6, z0: -4.9, z1: -3.5, ceiling: 1.2 };
export const ORIEL = { x0: 4.5, x1: 5.9, z0: -3.2, z1: -0.4 };
export const ARCH = [-3.8, -2.9];            // the way into the cellar, in the north wall
export const SNUG = { x0: -4.5, x1: -2.6, z0: 2.0, z1: 3.5 };

// Where the walls are rock and where they are timber: the cave behind the bar and the hearth, the
// ship's side where the sea and the harbour are.
export const ROCK_WALLS = ['north', 'west'];
export const TIMBER_WALLS = ['south', 'east', 'oriel'];

const T = LEVEL.terrace, L1 = LEVEL.first, L2 = LEVEL.second;

// What you stand on above the ground. A floor has `y`; a stair or a ladder is a slope from y0 at
// its x0 (or z0) end to y1 at the other, walked as a ramp and drawn as treads or rungs.
export const FLOORS = [
  { id: 'terrace', x0: -3, x1: 3, z0: -3.5, z1: -1, y: T },                  // the bar, one step up
  { id: 'snug', ...SNUG, y: T },
  { id: 'balcony', x0: -4.5, x1: -3.85, z0: -3.5, z1: -2.3, y: L1 },         // over the cellar's corner
  { id: 'crew-loft', x0: -4.5, x1: -3.2, z0: -3.5, z1: -1.5, y: L2 },        // hammocks under the rock
  { id: 'cabin', x0: 3, x1: 4.5, z0: -3.5, z1: 1.6, y: L1 },                 // the captain's, over the hold
  { id: 'cabin-oriel', ...ORIEL, y: L1 },
  // The treasure loft over the cabin, out to the bridge's far rope (z -0.3) so the bridge lands on it.
  { id: 'lookout', x0: 3.8, x1: 5.9, z0: -3.2, z1: -0.3, y: L2 },
  // Round the mast, 1.3 across: a body is 0.16 wide each side and the mast 0.1, so a smaller nest
  // left nowhere to stand between the pole and the rail.
  { id: 'crows-nest', x0: 1.75, x1: 3.05, z0: -1.2, z1: 0.1, y: L2 },
  { id: 'rope-bridge', x0: 3.05, x1: 3.8, z0: -0.8, z1: -0.3, y: L2 },       // nest to lookout
];
export const STAIRS = [
  { id: 'west-stair', x0: -4.5, x1: -3.95, z0: -2.3, z1: -0.55, y0: L1, y1: F, axis: 'z', kind: 'stair' },
  { id: 'west-ladder', x0: -4.5, x1: -4.1, z0: -3.0, z1: -2.4, y0: L2, y1: L1, axis: 'z', kind: 'ladder' },
  { id: 'east-stair', x0: 1.8, x1: 3.0, z0: -2.0, z1: -1.4, y0: T, y1: L1, axis: 'x', kind: 'stair' },
  { id: 'east-ladder', x0: 3.2, x1: 3.8, z0: -1.4, z1: -1.0, y0: L1, y1: L2, axis: 'x', kind: 'ladder' },
];

// Railings round the open edges of the storeys, as [x0, z0, x1, z1] lines at the floor's height.
// Gaps are where a stair or the bridge comes in, at least 0.6 wide: a body is 0.32 across and a rail
// is grown by half of that on both sides. They are blockers on their own storey only.
export const RAILS = [
  { level: L1, line: [-3.85, -3.5, -3.85, -2.3] },           // balcony, east edge
  { level: L1, line: [-3.95, -2.3, -3.85, -2.3] },           // balcony, south edge beside the stair
  { level: L2, line: [-3.2, -3.5, -3.2, -1.5] },             // crew loft, east edge
  { level: L2, line: [-4.5, -1.5, -3.2, -1.5] },             // crew loft, south edge
  { level: L1, line: [3, -3.5, 3, -2.0] },                   // cabin, west edge north of the stair
  { level: L1, line: [3, -1.4, 3, 1.6] },                    // cabin, west edge south of it
  { level: L1, line: [3, 1.6, 4.5, 1.6] },                   // cabin, south edge over the pool
  { level: L2, line: [3.8, -3.2, 3.8, -1.5] },               // lookout, west edge; open from the ladder to the bridge
  { level: L2, line: [3.8, -0.3, 4.5, -0.3] },               // lookout, south edge over the cabin
  { level: L2, line: [3.8, -3.2, 4.5, -3.2] },               // and the gap to the hall's north wall
  { level: L2, line: [1.75, -1.2, 3.05, -1.2] },             // the crow's nest, round but for the bridge
  { level: L2, line: [1.75, 0.1, 3.05, 0.1] },
  { level: L2, line: [1.75, -1.2, 1.75, 0.1] },
  { level: L2, line: [3.05, -1.2, 3.05, -0.8] },
  { level: L2, line: [3.05, -0.3, 3.05, 0.1] },
  { level: L2, line: [3.05, -0.8, 3.8, -0.8] },              // the bridge's two ropes
  { level: L2, line: [3.05, -0.3, 3.8, -0.3] },
];

// The posts the storeys stand on, from y0 to y1 (a blocker between those heights). The balcony and
// the crew loft hang off the rock on beams and brackets, which is why they need few.
export const POSTS = [
  { x: 3.0, z: -3.42, y0: F, y1: L1 }, { x: 3.0, z: -1.33, y0: F, y1: L1 },
  { x: 3.0, z: 0.1, y0: F, y1: L1 }, { x: 3.0, z: 1.55, y0: F, y1: L1 }, { x: 4.45, z: 1.55, y0: F, y1: L1 },
  { x: 3.8, z: -3.15, y0: L1, y1: L2 }, { x: 3.8, z: -0.45, y0: L1, y1: L2 },
  { x: -3.2, z: -1.55, y0: F, y1: L2 },
];
export const POST_R = 0.06;

// The sea comes in under a rock arch in the east wall to a pool in the south-east corner: water to
// the eye, a blocker to the feet, with a jetty out into it you can walk.
export const POOL = { x0: 3.0, x1: 4.5, z0: 1.6, z1: 3.5, surface: F - 0.04, arch: [1.8, 3.2] };
export const JETTY = { x0: 3.05, x1: 3.95, z0: 2.4, z1: 2.72, y: F };

// The ship's parts (web/js/krakenkit-mesh.js), where they stand.
export const KIT = {
  stern: { x: -0.7, z: -3.35, y: T },                         // the back bar against the rock
  counter: { x: -0.9, z: -2.55, y: T },                       // the hull, the old bar's size
  stools: { x0: -2.3, step: 0.725, n: 5, z: -2.1, y: T },
  mast: { x: 2.4, z: -0.55, y: F, ry: Math.PI / 2 },          // its yard along z, clear of the cabin
  gunports: [{ x: -1.95 }, { x: -1.0 }, { x: 2.1 }],          // in the south wall, sill at F + 0.62
  jukebox: { x: -1.47, z: HALL.z1 - 0.13, y: F, ry: Math.PI },
  figurehead: { x: 3.0, z: 1.6, y: L1 + 0.05, ry: -Math.PI * 3 / 4 },   // off the cabin's corner post
  skulllamp: { x: -0.9, z: -2.55 },                          // hung from the rock over the counter
  sconces: [{ x: -4.47, z: -1.3, y: F + 0.75, ry: Math.PI / 2 }, { x: 4.47, z: 0.5, y: L1 + 0.35, ry: -Math.PI / 2 }],
};

// The tables in the pit, the hearth, the snug's things and the crew's places (pirate-tavern.js).
export const TABLES = [{ id: 't1', x: -2.0, z: 1.0 }, { id: 't2', x: 1.1, z: 1.95 }, { id: 't3', x: -0.4, z: -0.2 }];
export const HEARTH = { x: -4.25, z: 0.2 };                  // on the west wall, in the rock
export const SLOOP = { x: -0.45, y: F + 1.45, z: 0.85 };     // the chandelier over the pit
export const CHART = { x: 4.15, z: -2.5 };                   // on the cabin floor
export const CHAIR = { x: 4.2, z: -3.05 };
export const CANNON = { x: -4.0, z: 3.0 };                   // in the snug, at T
export const SNUG_TABLE = { x: -3.3, z: 2.45 };              // a keg for a table, at T
export const KEG_SEATS = [{ id: 'keg:0', x: -2.9, z: 2.45, yaw: -Math.PI / 2 }, { id: 'keg:1', x: -3.3, z: 2.88, yaw: Math.PI }];
// Where the crew sit and stand (their looks and lines are pirate-tavern.js's and shared/quests.mjs's).
// `seat` is the height of what they sit on above their floor; the captain stands.
export const CREW_PLACES = {
  captain: { x: 4.75, z: -1.75, y: L1, yaw: -0.8, stand: true },
  navigator: { x: 3.55, z: -2.95, y: L1, yaw: 0.93, seat: 0.19 },
  bosun: { x: -2.35, z: 0.68, y: F, yaw: 0, seat: 0.135 },
  lookout: { x: -1.7, z: 1.32, y: F, yaw: Math.PI, seat: 0.135 },
  gunner: { x: 0.8, z: 1.63, y: F, yaw: 0, seat: 0.135 },
  cook: { x: -0.7, z: 0.12, y: F, yaw: Math.PI, seat: 0.135 },
};
export const FIGURES = { finn: { x: -3.62, z: -0.62, y: F }, meg: { x: -0.9, z: -3.05, y: T } };
// Where the dressing (web/js/kraken-dressing.js) must leave the floor free: the ways people walk.
export const KEEP_CLEAR = [
  { why: 'the door', x0: -0.6, x1: 0.6, z0: 1.5, z1: 3.5, y: F },
  { why: 'in front of the stools', x0: -3.0, x1: 1.8, z0: -1.9, z1: -1.0, y: T },
  { why: 'behind the bar', x0: -2.5, x1: 1.1, z0: -3.2, z1: -2.72, y: T },
  { why: 'to the cellar', x0: -3.9, x1: -2.8, z0: -3.5, z1: -1.0, y: F },
  { why: 'in the cellar', x0: -3.8, x1: -2.9, z0: -4.05, z1: -3.5, y: F },
  { why: 'the west stair', x0: -4.5, x1: -3.8, z0: -2.3, z1: 0.0, y: F },
  { why: 'the east stair', x0: 1.3, x1: 3.0, z0: -2.05, z1: -1.35, y: T },
  { why: 'into the hold', x0: 3.0, x1: 4.5, z0: -1.0, z1: 1.5, y: F },
  { why: 'the jetty', x0: 3.0, x1: 3.95, z0: 2.4, z1: 2.72, y: F },
  { why: 'along the cabin', x0: 3.05, x1: 3.7, z0: -3.4, z1: 1.5, y: L1 },
  { why: 'to the captain', x0: 3.7, x1: 5.0, z0: -2.1, z1: -1.4, y: L1 },
  { why: 'across the lookout', x0: 3.8, x1: 4.6, z0: -1.5, z1: -0.45, y: L2 },
  { why: 'along the crew loft', x0: -4.5, x1: -3.95, z0: -3.1, z1: -1.55, y: L2 },
  { why: 'the balcony', x0: -4.5, x1: -3.85, z0: -3.1, z1: -2.3, y: L1 },
];

// The seven lights (pirate-tavern.js; exactly seven, the tavern's number, see its top): warm candles
// and lamps against the one cool light, the moon coming in over the pool under the sea arch.
export const LIGHTS = [
  { hex: 0xff8c3a, intensity: 1.6, dist: 2.6, at: [-4.0, F + 0.3, 0.2], flicker: true },          // the hearth
  { hex: 0xffc98a, intensity: 1.4, dist: 2.8, at: [-0.9, T + 1.05, -2.5] },                        // the skull lamp
  { hex: 0x8a5cff, intensity: 1.0, dist: 2.4, at: [-0.7, T + 0.75, -3.05] },                       // the niches
  { hex: 0xffd9a0, intensity: 1.6, dist: 3.8, at: [-0.45, F + 1.4, 0.85], flicker: true },         // the sloop
  { hex: 0xffd9a0, intensity: 1.2, dist: 2.8, at: [4.2, L1 + 0.45, -1.7] },                        // the cabin
  { hex: 0xff4040, intensity: 0.9, dist: 2.2, at: [-1.47, F + 0.45, 3.0] },                        // the jukebox's blood
  { hex: 0x6ad0e8, intensity: 1.1, dist: 3.2, at: [4.1, F + 0.5, 2.5] },                           // the moon on the pool
];
