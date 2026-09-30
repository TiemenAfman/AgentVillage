// The Salty Kraken's hall as numbers, and the only copy of them (Plans/piratenkroeg.md, schets 6;
// Plans/verdiepingen-binnen.md). Two readers: web/js/pirate-tavern.js makes the room of it - where
// you walk, climb, sit and bump - and scripts/build-piratetavern-room.py bakes what you see there,
// reading this file through node (`node scripts/kraken-layout-json.mjs`). So a floor that moves
// here moves in both, and a stair cannot be drawn in one place and walked in another.
//
// The hall is two of the keeper's references mixed (Plans/piratenkroeg.md): at the bottom a cascade
// round an atrium - an open pit with the tables and a ship's mast, the bar a storey-and-a-bit up with a
// ship's side for its front, the ground round them with the cellar, the hearth, the cannon and a pool
// under an arch to the sea - and over it a tall hall built from wrecked ships, fieldstone below and
// timber above, a pitched roof on heavy trusses, galleries of broken ship's decks on old masts along
// the west and east walls at two heights, ships' ladders and gangplanks between them, and rope bridges
// across the open middle to the crow's nest. 18 by 14, the ridge 5.6 up. Nothing is ever lower than
// the ground: walk mode reads anything under 0.06 as water, so the lowest terrace is the floor.
//
// Room coordinates: x east, y up, z south (the door), the ground's top at F. No imports: Node and
// the page both read it as it is.

export const F = 0.06;                       // interior.js FLOOR
// The heights of the terraces, as the boards you stand on.
export const LEVEL = { ground: F, pit: F + 0.6, bar: F + 1.5, captain: F + 2.1, top: F + 3.4 };
export const CEILING = 5.6;                  // over F, at the ridge; the lid is here
// The roof: its ridge runs north-south over x = 0, its eaves on the west and east walls; the north
// and south walls are gables (the broken bow juts out of the north one, over the bar).
export const EAVES = F + 4.5;
// Fieldstone up to here on every wall, ship's timber above (the pool's arch cuts through both).
export const STONE_TOP = F + 1.6;
// Where the roof's trusses stand, along z (their tie beams at EAVES): the shell builds them, the dressing
// hangs its torn sails from them.
export const TRUSSES = [-6.4, -4.4, -2.4, -0.4, 1.6, 3.6, 5.6];
export const TOP = F + CEILING;
export const WALL = 0.14;
export const DOOR_HALF = 0.42;

// The camera's rooms (interior.js `areas`): the hall and the rum cellar through its arch.
export const HALL = { x0: -9, x1: 9, z0: -7, z1: 7 };
export const CELLAR = { x0: -9, x1: -5.5, z0: -9, z1: -7, ceiling: 1.4 };
export const ARCH = [-7.5, -6.6];            // the way into the cellar, in the north wall

const G = LEVEL.ground, P = LEVEL.pit, B = LEVEL.bar, C = LEVEL.captain, U = LEVEL.top;

// What you stand on above the ground. `solid` is a terrace built up on rubble and timber, which a body
// on a lower level walks into rather than under; the others are decks on posts with room beneath.
export const FLOORS = [
  { id: 'pit', x0: -5.5, x1: 4.5, z0: -3.2, z1: 5.5, y: P, solid: true },       // the atrium's floor
  { id: 'bar', x0: -5.5, x1: 5.5, z0: -7, z1: -3.2, y: B, solid: true },        // its front is a ship's side
  // The captain's deck over the hold, the east gallery at the first height, in three pieces round the
  // stairwell of the stair up from the bar.
  { id: 'captain', x0: 6.5, x1: 9, z0: -7, z1: 1.5, y: C },
  { id: 'captain-north', x0: 5.5, x1: 6.5, z0: -7, z1: -4.4, y: C },
  { id: 'captain-south', x0: 5.5, x1: 6.5, z0: -3.6, z1: 1.5, y: C },
  // The west gallery at the first height, and the landing where the gangplank comes up to it.
  { id: 'west-gallery', x0: -9, x1: -7.0, z0: -7, z1: 3.0, y: C },
  { id: 'west-landing', x0: -7.0, x1: -6.3, z0: -1.7, z1: -1.0, y: C },
  // The upper galleries on both walls, under the eaves.
  { id: 'west-upper', x0: -9, x1: -7.4, z0: -7, z1: 3.0, y: U },
  { id: 'east-upper', x0: 7.4, x1: 9, z0: -7, z1: 1.5, y: U },
  // Round the mast, 1.3 across: a body is 0.16 wide each side and the mast 0.13.
  { id: 'crows-nest', x0: -0.65, x1: 0.65, z0: -2.25, z1: -0.95, y: U },
  { id: 'bridge-west', x0: -7.4, x1: -0.65, z0: -1.85, z1: -1.35, y: U },       // across the atrium
  { id: 'bridge-east', x0: 0.65, x1: 7.4, z0: -1.85, z1: -1.35, y: U },
];
// Stairs and ladders: a slope from y0 at its x0 (or z0) end to y1 at the other, walked as a ramp and
// drawn as treads or rungs (a gangplank, a ship's ladder). Every one at least 0.6 wide, since a rail is
// grown by a body's half width.
export const STAIRS = [
  { id: 'door-steps', x0: -0.8, x1: 0.8, z0: 5.5, z1: 6.9, y0: P, y1: G, axis: 'z', kind: 'stair' },
  { id: 'pit-bar-west', x0: -5.5, x1: -4.5, z0: -3.2, z1: -1.2, y0: B, y1: P, axis: 'z', kind: 'stair' },
  { id: 'pit-bar-east', x0: 3.5, x1: 4.5, z0: -3.2, z1: -1.2, y0: B, y1: P, axis: 'z', kind: 'stair' },
  { id: 'pit-west', x0: -6.3, x1: -5.5, z0: -0.6, z1: 0.4, y0: G, y1: P, axis: 'x', kind: 'stair' },       // to the cellar's mouth
  { id: 'pit-southwest', x0: -6.3, x1: -5.5, z0: 3.8, z1: 4.8, y0: G, y1: P, axis: 'x', kind: 'stair' },   // to the hearth and the cannon
  { id: 'pit-east', x0: 4.5, x1: 5.5, z0: 2.0, z1: 3.0, y0: P, y1: G, axis: 'x', kind: 'stair' },           // down to the jetty
  { id: 'bar-captain', x0: 5.5, x1: 6.5, z0: -4.4, z1: -3.6, y0: B, y1: C, axis: 'x', kind: 'stair' },
  { id: 'west-gangplank', x0: -7.0, x1: -6.3, z0: -1.0, z1: 3.0, y0: C, y1: G, axis: 'z', kind: 'gangplank' },
  { id: 'west-ladder', x0: -9, x1: -8.4, z0: -3.0, z1: -2.2, y0: U, y1: C, axis: 'z', kind: 'ladder' },
  { id: 'east-ladder', x0: 6.8, x1: 7.4, z0: -3.0, z1: -2.2, y0: C, y1: U, axis: 'x', kind: 'ladder' },
];

// Railings round the open edges of the terraces and galleries, as [x0, z0, x1, z1] lines at the level's
// height; the gaps are where stairs and bridges come in. Blockers on their own level only.
export const RAILS = [
  // the pit, where it drops to the ground
  { level: P, line: [-5.5, -1.2, -5.5, -0.6] }, { level: P, line: [-5.5, 0.4, -5.5, 3.8] }, { level: P, line: [-5.5, 4.8, -5.5, 5.5] },
  { level: P, line: [-5.5, 5.5, -0.8, 5.5] }, { level: P, line: [0.8, 5.5, 4.5, 5.5] },
  { level: P, line: [4.5, -1.2, 4.5, 2.0] }, { level: P, line: [4.5, 3.0, 4.5, 5.5] },
  // the bar, where it drops to the pit and to the ground
  { level: B, line: [-4.5, -3.2, 3.5, -3.2] }, { level: B, line: [4.5, -3.2, 5.5, -3.2] }, { level: B, line: [-5.5, -7, -5.5, -3.2] },
  // the captain's deck, over the bar, the ground and the pool, and round its stairwell
  { level: C, line: [5.5, -7, 5.5, -4.4] }, { level: C, line: [5.5, -3.6, 5.5, 1.5] }, { level: C, line: [5.5, 1.5, 9, 1.5] },
  { level: C, line: [5.5, -4.4, 6.5, -4.4] }, { level: C, line: [5.5, -3.6, 6.5, -3.6] },
  // the west gallery and its landing
  { level: C, line: [-7.0, -7, -7.0, -1.7] }, { level: C, line: [-7.0, -1.0, -7.0, 3.0] }, { level: C, line: [-9, 3.0, -7.0, 3.0] },
  { level: C, line: [-7.0, -1.7, -6.3, -1.7] }, { level: C, line: [-6.3, -1.7, -6.3, -1.0] },
  // the upper galleries
  { level: U, line: [-7.4, -7, -7.4, -1.85] }, { level: U, line: [-7.4, -1.35, -7.4, 3.0] }, { level: U, line: [-9, 3.0, -7.4, 3.0] },
  { level: U, line: [7.4, -7, 7.4, -3.0] }, { level: U, line: [7.4, -2.2, 7.4, -1.85] }, { level: U, line: [7.4, -1.35, 7.4, 1.5] },
  { level: U, line: [7.4, 1.5, 9, 1.5] },
  // the crow's nest and the bridges' ropes
  { level: U, line: [-0.65, -2.25, 0.65, -2.25] }, { level: U, line: [-0.65, -0.95, 0.65, -0.95] },
  { level: U, line: [-0.65, -2.25, -0.65, -1.85] }, { level: U, line: [-0.65, -1.35, -0.65, -0.95] },
  { level: U, line: [0.65, -2.25, 0.65, -1.85] }, { level: U, line: [0.65, -1.35, 0.65, -0.95] },
  { level: U, line: [-7.4, -1.85, -0.65, -1.85] }, { level: U, line: [-7.4, -1.35, -0.65, -1.35] },
  { level: U, line: [0.65, -1.85, 7.4, -1.85] }, { level: U, line: [0.65, -1.35, 7.4, -1.35] },
];

// The posts the decks stand on, from y0 to y1 (a blocker between those heights). The gallery and the
// bridges' ends hang off the rock and the mast on beams and brackets besides.
export const POSTS = [
  // old masts under the captain's deck and the east upper gallery
  { x: 5.55, z: -3.1, y0: G, y1: C }, { x: 5.55, z: -1.3, y0: G, y1: C }, { x: 7.05, z: 1.45, y0: G, y1: C }, { x: 8.95, z: 1.45, y0: G, y1: C },
  { x: 7.45, z: -6.0, y0: C, y1: U }, { x: 7.45, z: -3.4, y0: C, y1: U }, { x: 7.45, z: 1.45, y0: C, y1: U },
  // under the west gallery and the west upper gallery
  { x: -7.05, z: -6.0, y0: G, y1: C }, { x: -7.05, z: -3.4, y0: G, y1: C }, { x: -7.05, z: 2.95, y0: G, y1: C },
  { x: -7.45, z: -6.0, y0: C, y1: U }, { x: -7.45, z: -3.4, y0: C, y1: U }, { x: -7.45, z: 0.4, y0: C, y1: U }, { x: -7.45, z: 2.95, y0: C, y1: U },
];
export const POST_R = 0.09;                  // an old mast stump

// The sea comes in under a rock arch in the east wall to a pool in the south-east corner: water to
// the eye, a blocker to the feet, with a jetty out into it you can walk.
export const POOL = { x0: 6.0, x1: 9, z0: 1.5, z1: 7, surface: F - 0.04, arch: [2.3, 6.0] };
export const JETTY = { x0: 6.0, x1: 7.6, z0: 4.2, z1: 4.6, y: G };
// The iron bars in the cellar round the treasure, and their return to the north wall.
export const CELLAR_BARS = { z: -8.1, x0: -7.0, x1: -5.5 };

// The ship's parts (web/js/krakenkit-mesh.js), where they stand.
export const KIT = {
  stern: { x: 0, z: -6.85, y: B },                            // the back bar against the rock
  counter: { x: 0, z: -5.9, y: B },
  stools: { x0: -1.45, step: 0.725, n: 5, z: -5.45, y: B },
  mast: { x: 0, z: -1.6, y: P, ry: Math.PI / 2, height: TOP - P, nest: U - P },   // its yard along z, up into the ridge
  gunports: [{ x: -4.2 }, { x: -2.4 }, { x: 2.4 }],           // in the south wall, sill at F + 0.62
  jukebox: { x: -1.5, z: HALL.z1 - 0.13, y: G, ry: Math.PI },
  // The broken bow jutting out of the north gable over the bar (scripts/krakenkit/bow.py: 1.4 deep,
  // its back flat on the wall), at 0.8 so it fits between the stern's top (B + 1.76) and the tie beam
  // over it at EAVES; its gunwale at 1.49 of its own, its stem's front 0.67 out.
  bow: { x: 0, z: HALL.z0 + 0.7 * 0.8, y: B + 1.74, s: 0.8 },
  // On the stem's front face under the gunwale (bow.py's STEM, 1.40 up, scaled), the carving 0.47 tall.
  figurehead: { x: 0, z: HALL.z0 + 0.7 * 0.8 + 0.67 * 0.8, y: B + 1.74 + 1.404 * 0.8 - 0.35, ry: 0 },
  skulllamp: { x: 0, z: -5.9, y: B + 1.19 },                  // hung from the foot of the bow's stem
  // The candle boat hung over each SLOOPS spot (scripts/krakenkit/sloop.py): its origin is the tip of
  // its longest drip, its flames FLAME_Y over that and its chain ends RING_TOP over it.
  sloop: { flame: 0.6325, ringTop: 1.174 },
  // The ship's wheel hung flat over the middle of the pit, before the mast, between the two sloops
  // (scripts/krakenkit/wheel.py: its lantern's foot is its origin, its flames 0.66 over that): the
  // flames 2.7 over the pit, clear of the aisle's heads and of the crow's nest.
  wheel: { x: -0.2, z: 0.6, y: P + 2.69 - 0.6638 },
  // The split rudder over the bar's front as the house's sign, west of the mast so the door sees it
  // (scripts/krakenkit/rudder.py: the blade's top 0.9 over its lowest splinter).
  rudder: { x: -2.7, z: -3.35, y: B + 2.45 - 0.9 },
  sconces: [{ x: -8.97, z: -3.0, y: G + 0.8, ry: Math.PI / 2 }, { x: 8.97, z: -4.0, y: C + 0.4, ry: -Math.PI / 2 }],
};

// The tables in the pit (two rows of three, the middle aisle from the door to the mast kept open),
// the hearth, the chandeliers, the captain's furniture and the crew's places (pirate-tavern.js).
export const TABLES = [
  { id: 't1', x: -3.2, z: 0.3 }, { id: 't2', x: 1.8, z: 0.3 },
  { id: 't3', x: -3.2, z: 2.6 }, { id: 't4', x: 1.8, z: 2.6 },
  { id: 't5', x: -3.2, z: 4.7 }, { id: 't6', x: 1.8, z: 4.7 },
];
export const HEARTH = { x: -8.75, z: 4.4 };                  // in the west rock, on the ground
export const SLOOPS = [{ x: -3.2, y: P + 2.6, z: 1.45 }, { x: 1.8, y: P + 2.6, z: 1.45 }];   // boats full of candles
export const CHART = { x: 7.3, z: -5.2 };                    // on the captain's deck
export const CHAIR = { x: 7.3, z: -6.1 };
export const CANNON = { x: -8.2, z: 6.3 };                   // in the south-west corner, on the ground
export const KEG_TABLE = { x: -6.8, z: 6.2 };                // a keg for a table by the cannon
export const KEG_SEATS = [{ id: 'keg:0', x: -6.4, z: 6.2, yaw: -Math.PI / 2 }, { id: 'keg:1', x: -6.8, z: 5.8, yaw: 0 }];
// Where the crew sit and stand (their looks and lines are pirate-tavern.js's and shared/quests.mjs's).
// `seat` is the height of what they sit on above their floor; the captain stands.
export const CREW_PLACES = {
  captain: { x: 8.2, z: -4.3, y: C, yaw: -Math.PI / 2 - 0.4, stand: true },
  navigator: { x: 6.4, z: -5.3, y: C, yaw: Math.PI / 2, seat: 0.19 },
  bosun: { x: -3.55, z: -0.02, y: P, yaw: 0, seat: 0.135 },
  lookout: { x: -2.85, z: 0.62, y: P, yaw: Math.PI, seat: 0.135 },
  gunner: { x: 1.45, z: -0.02, y: P, yaw: 0, seat: 0.135 },
  cook: { x: -3.55, z: 2.92, y: P, yaw: Math.PI, seat: 0.135 },
};
export const FIGURES = { finn: { x: -7.6, z: 3.0, y: G }, meg: { x: 0, z: -6.3, y: B } };
// Where the dressing (web/js/kraken-dressing.js) must leave the floor free: the ways people walk.
export const KEEP_CLEAR = [
  { why: 'the door and the aisle to the mast', x0: -1.4, x1: 1.0, z0: -0.9, z1: 7.0, y: P },
  { why: 'along the counter', x0: -2.6, x1: 2.6, z0: -5.2, z1: -3.3, y: B },
  { why: 'behind the bar', x0: -1.8, x1: 1.8, z0: -6.55, z1: -6.07, y: B },
  { why: 'the stairs to the bar', x0: -5.5, x1: -4.5, z0: -3.2, z1: -0.8, y: P },
  { why: 'the stairs to the bar', x0: 3.5, x1: 4.5, z0: -3.2, z1: -0.8, y: P },
  { why: 'to the cellar', x0: -7.8, x1: -6.3, z0: -7.0, z1: -1.2, y: G },
  { why: 'the gangplank', x0: -7.1, x1: -6.2, z0: -1.0, z1: 3.3, y: G },
  { why: 'the west stairs', x0: -6.4, x1: -5.5, z0: -0.8, z1: 5.0, y: G },
  { why: 'to the jetty', x0: 4.5, x1: 6.0, z0: -1.2, z1: 7.0, y: G },
  { why: 'the jetty', ...JETTY },
  { why: 'into the hold', x0: 5.5, x1: 7.0, z0: -1.0, z1: 1.5, y: G },
  { why: 'onto the captain\'s deck', x0: 5.5, x1: 8.5, z0: -4.6, z1: -3.3, y: C },
  { why: 'to the captain', x0: 6.5, x1: 8.6, z0: -4.8, z1: -2.6, y: C },
  { why: 'along the west gallery', x0: -8.0, x1: -7.0, z0: -6.8, z1: 2.8, y: C },
  { why: 'the west landing', x0: -7.0, x1: -6.3, z0: -1.7, z1: -1.0, y: C },
  { why: 'along the west upper gallery', x0: -8.4, x1: -7.4, z0: -6.8, z1: 2.8, y: U },
  { why: 'along the east upper gallery', x0: 7.4, x1: 8.4, z0: -6.8, z1: 1.3, y: U },
  { why: 'the ladders', x0: -9, x1: -8.4, z0: -3.1, z1: -2.1, y: C },
  { why: 'the ladders', x0: 6.7, x1: 7.5, z0: -3.1, z1: -2.1, y: C },
];

// The seven lights (pirate-tavern.js; exactly seven, the tavern's number, see its top), as a light
// plan (Plans/piratenkroeg.md, "Licht"): warm practical light low down - the sloops over the tables,
// the hearth the strongest and reddest, the skull lamp over the counter and the captain's lamp - at
// about 2000 K and with reach enough to light the tables, the floor and the people round them, not a
// ring round each flame; the niches' purple spilling onto the bar as the far focal point; one cool
// light, the moon, high over the atrium under the skylights with a gentle falloff (decay 1), so it
// finds the galleries, the beams and the rigging from above and leaves the floor to the lamps; the
// hemisphere (`ambience` in pirate-tavern.js) adds a little cool from above, and the corners stay out
// of every lamp's reach. The sea arch's glow and the shafts through the skylights are its visible source.
export const LIGHTS = [
  { hex: 0xff6a2c, intensity: 3.2, dist: 6.5, at: [-8.3, G + 0.35, 4.4], flicker: true },         // the hearth
  { hex: 0xffb070, intensity: 1.7, dist: 4.5, at: [0, B + 1.24, -5.85] },                          // the skull lamp
  { hex: 0x7a58ff, intensity: 1.5, dist: 4.8, at: [0, B + 0.8, -6.3] },                            // the niches
  { hex: 0xffa850, intensity: 4.2, dist: 8.5, at: [-3.2, P + 2.4, 1.45], flicker: true },          // the west sloop
  { hex: 0xffa850, intensity: 4.2, dist: 8.5, at: [1.8, P + 2.4, 1.45], flicker: true },           // the east sloop
  { hex: 0xffb068, intensity: 1.8, dist: 5.0, at: [7.4, C + 0.5, -4.4] },                          // the captain
  { hex: 0x8fb0d8, intensity: 1.6, dist: 14, decay: 1, at: [-0.6, EAVES - 0.2, 0.6] },             // the moon, from above
];

// The two skylights in the roof (x0, x1, z0, z1; shell.py cuts the boards round them), and the
// moonlight falling through them as broad, faint shafts (room-glow.js): leaning as if the moon
// stood to the south-west, onto the pit's tables and the bar's edge.
export const SKYLIGHTS = [[-5.1, -3.9, 1.95, 3.25], [3.0, 4.2, -4.05, -2.75]];
export const SHAFTS = [
  { sky: 0, bottom: P, hex: 0x9fc0e8, strength: 0.11, lean: [0.1, -0.06] },
  { sky: 1, bottom: B, hex: 0x9fc0e8, strength: 0.096, lean: [0.1, -0.06] },
];
