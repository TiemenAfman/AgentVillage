// The Salty Kraken's dressing: every crate, barrel, chest and hoard that stands on one of its floors
// (web/js/kraken-layout.js), and what of it a walker bumps into. Two readers: web/js/pirate-tavern.js
// makes a blocker of every prop from its kind's FOOT, and scripts/krakenroom/dressing.py draws PROPS
// at FOOT's sizes (both through scripts/kraken-layout-json.mjs, under DRESSING) - so a barrel moved
// here moves in both, blocker and all.
//
// A prop is { kind, x, z, y, ry, s }: y is the storey it stands on (kraken-layout LEVEL), ry its turn
// (radians about y), s its scale. A kind is a whole stack (`crate-stack` is three crates, `barrel-tall`
// two barrels), so y is always a floor and never the top of something else.
// FOOT is each kind's footprint at s = 1 and ry = 0: { hx, hz, h } a rectangle's half extents, or
// { r, h } a circle, h its height over the floor. A prop's blocker is that footprint scaled by s, and a
// rectangle turned by ry becomes the axis-aligned box round the turned rectangle
// (hx' = (hx |cos ry| + hz |sin ry|) s, hz' = (hx |sin ry| + hz |cos ry|) s; a circle ignores ry),
// from y0 = y to y1 = y + h s. A kind drawn bigger in dressing.py needs its FOOT grown with it.
// EXTRA_BLOCKERS are what stands in the way and is not a prop: the fire irons by the hearth. The
// hammocks hang higher than a head and block nobody. KEEP_CLEAR in kraken-layout.js is what none of it
// may stand on; coins, candles, bottles and gold lying flat are drawn by dressing.py alone, with
// nothing to bump into. No imports: Node and the page both read it as it is.
//
// The hall is big and open (the keeper: "a nice spacious view that does not need many decorations on
// every level"), so the dressing is a few groups with a reason to be where they are - cargo stacked
// against a wall or a rail, one heap of gold to a terrace, the hold packed - and the atrium's floor,
// the aisle and every way between the stairs left bare.

export const FOOT = {
  'barrel': { r: 0.125, h: 0.29 },
  'barrel-small': { r: 0.095, h: 0.21 },
  'barrel-tall': { r: 0.125, h: 0.56 },
  'barrel-skull': { r: 0.125, h: 0.42 },
  'barrel-rack': { hx: 0.27, hz: 0.16, h: 0.4 },
  'cask': { hx: 0.3, hz: 0.23, h: 0.46 },
  'keg-rack': { hx: 0.13, hz: 0.43, h: 0.43 },
  'crate': { hx: 0.145, hz: 0.145, h: 0.27 },
  'crate-small': { hx: 0.1, hz: 0.1, h: 0.19 },
  'crate-stack': { hx: 0.165, hz: 0.165, h: 0.66 },
  'crate-wide': { hx: 0.3, hz: 0.15, h: 0.53 },
  'crate-gold': { hx: 0.15, hz: 0.15, h: 0.32 },
  'crate-barrel': { hx: 0.15, hz: 0.15, h: 0.53 },
  'chest': { hx: 0.24, hz: 0.19, h: 0.43 },
  'chest-closed': { hx: 0.19, hz: 0.12, h: 0.25 },
  'hoard': { r: 0.26, h: 0.18 },
  'hoard-small': { r: 0.15, h: 0.1 },
  'ingots': { hx: 0.08, hz: 0.06, h: 0.07 },
  'sack': { r: 0.13, h: 0.22 },
  'sack-gold': { r: 0.13, h: 0.24 },
  'cannon': { hx: 0.32, hz: 0.15, h: 0.32 },
  'shot-pile': { r: 0.08, h: 0.09 },
  'woodpile': { hx: 0.15, hz: 0.26, h: 0.26 },
  'coil': { r: 0.11, h: 0.05 },
  'globe': { r: 0.13, h: 0.5 },
  'telescope': { r: 0.16, h: 0.6 },
  'candle-stand': { r: 0.08, h: 0.62 },
};

// The storeys, as kraken-layout.js LEVEL has them (ground, pit, bar, captain, top).
const G = 0.06, P = 0.66, B = 1.56, C = 2.16, U = 3.46;

export const PROPS = [
  // ---- the pit (+0.6) ----------------------------------------------------------------------
  // Against the bar's ship's side, west of the mast: the pit's one chest of gold, open, spilling
  // towards the tables, a skull lamp on a barrel beside it and a stack of crates.
  { kind: 'chest', x: -3.2, z: -2.92, y: P, ry: 0, s: 1.1 },
  { kind: 'hoard-small', x: -3.25, z: -2.42, y: P, ry: 0, s: 1 },
  { kind: 'barrel-skull', x: -3.82, z: -2.95, y: P, ry: 0, s: 1 },
  { kind: 'crate-stack', x: -2.38, z: -2.97, y: P, ry: 0.15, s: 1.1 },
  { kind: 'barrel-small', x: -2.03, z: -3.0, y: P, ry: 0, s: 1 },
  // And east of it, the same wall: barrels and a crate, a sack. Clear of the two open gun ports
  // (shell.py `muzzles`, x -2.8 and 1.8): their lids swing up and out over the pit and a muzzle is
  // run out under them, and a tall barrel's candles stood in the lid.
  { kind: 'barrel-tall', x: 2.3, z: -2.95, y: P, ry: 0, s: 1.1 },
  { kind: 'barrel', x: 2.66, z: -2.98, y: P, ry: 0, s: 1.1 },
  { kind: 'crate', x: 3.1, z: -2.95, y: P, ry: 0.2, s: 1.1 },
  { kind: 'sack', x: 2.62, z: -2.6, y: P, ry: 0, s: 1 },
  // By the west rail, between the two rows of tables.
  { kind: 'crate-stack', x: -5.2, z: 1.4, y: P, ry: 0.1, s: 1.1 },
  { kind: 'barrel-tall', x: -5.22, z: 1.88, y: P, ry: 0, s: 1.1 },
  { kind: 'barrel', x: -4.85, z: 1.62, y: P, ry: 0, s: 1 },
  { kind: 'coil', x: -4.88, z: 1.15, y: P, ry: 0, s: 1 },
  // By the east rail, north of the stair down to the jetty: a rack of barrels, crates on it.
  { kind: 'barrel-rack', x: 4.22, z: 0.5, y: P, ry: 1.571, s: 1 },
  { kind: 'crate-stack', x: 4.25, z: 1.1, y: P, ry: -0.1, s: 1 },
  { kind: 'barrel-small', x: 3.92, z: 1.3, y: P, ry: 0, s: 1 },
  // The two corners by the door steps' rail.
  { kind: 'barrel', x: -5.22, z: 5.22, y: P, ry: 0, s: 1 },
  { kind: 'crate', x: -4.86, z: 5.27, y: P, ry: 0.3, s: 1 },
  { kind: 'crate-wide', x: 4.1, z: 5.25, y: P, ry: 0, s: 1 },
  { kind: 'barrel-small', x: 3.64, z: 5.3, y: P, ry: 0, s: 1 },

  // ---- the bar terrace (+1.5) ------------------------------------------------------------------
  // West of the stern: the terrace's hoard, an open chest by it, stacks against the rock.
  { kind: 'hoard', x: -4.2, z: -6.45, y: B, ry: 0, s: 1.2 },
  { kind: 'chest', x: -3.5, z: -6.62, y: B, ry: 0.15, s: 1.15 },
  { kind: 'crate-gold', x: -2.85, z: -6.6, y: B, ry: 0.4, s: 1 },
  { kind: 'crate-stack', x: -5.2, z: -6.72, y: B, ry: 0.1, s: 1.2 },
  { kind: 'barrel-tall', x: -5.22, z: -6.2, y: B, ry: 0, s: 1.1 },
  { kind: 'barrel', x: -4.92, z: -5.82, y: B, ry: 0, s: 1 },
  // East of it: the bar's stores - a wide stack, a cask on its cradle, barrels.
  { kind: 'crate-wide', x: 3.0, z: -6.75, y: B, ry: 0, s: 1.1 },
  { kind: 'barrel-tall', x: 3.62, z: -6.72, y: B, ry: 0, s: 1.1 },
  { kind: 'cask', x: 4.42, z: -6.58, y: B, ry: 0, s: 1.1 },
  { kind: 'crate-stack', x: 5.18, z: -6.7, y: B, ry: -0.12, s: 1.1 },
  { kind: 'barrel', x: 5.2, z: -6.12, y: B, ry: 0, s: 1 },
  { kind: 'barrel-small', x: 2.56, z: -6.3, y: B, ry: 0, s: 1 },
  { kind: 'candle-stand', x: 5.2, z: -5.35, y: B, ry: 0, s: 1 },

  // ---- the captain's deck (+2.1) -----------------------------------------------------------------
  // His gold beside his chair, a chest of it by the stern windows, the globe by the navigator.
  { kind: 'hoard', x: 8.45, z: -6.45, y: C, ry: 0, s: 1.3 },
  { kind: 'chest', x: 8.55, z: -5.45, y: C, ry: -1.571, s: 1 },
  { kind: 'globe', x: 6.0, z: -6.55, y: C, ry: 0, s: 1 },
  // Out on the south end, over the jetty: cargo lashed down.
  { kind: 'crate-stack', x: 8.6, z: 1.1, y: C, ry: 0.1, s: 1.1 },
  { kind: 'barrel', x: 8.18, z: 1.2, y: C, ry: 0, s: 1 },
  { kind: 'barrel-small', x: 8.62, z: 0.6, y: C, ry: 0, s: 1 },
  { kind: 'coil', x: 7.85, z: 0.95, y: C, ry: 0, s: 1 },

  // ---- the galleries along the walls -----------------------------------------------------------
  // A few things each, against the wall behind the walkway (KEEP_CLEAR is the walkway) and clear of
  // the ladders' heads and feet: the west gallery (+2.1), stores and a sea chest at its north end.
  { kind: 'barrel-tall', x: -8.6, z: -6.62, y: C, ry: 0, s: 1 },
  { kind: 'crate-stack', x: -8.58, z: -6.1, y: C, ry: 0.15, s: 1 },
  { kind: 'chest', x: -8.55, z: -4.8, y: C, ry: 1.571, s: 0.9 },
  { kind: 'barrel', x: -8.6, z: 0.9, y: C, ry: 0, s: 1 },
  { kind: 'sack', x: -8.6, z: 1.4, y: C, ry: 0, s: 1 },
  // The west upper gallery (+3.4), under the eaves.
  { kind: 'crate-stack', x: -8.72, z: -6.6, y: U, ry: 0.2, s: 1 },
  { kind: 'barrel', x: -8.72, z: -6.1, y: U, ry: 0, s: 1 },
  { kind: 'chest-closed', x: -8.72, z: -4.7, y: U, ry: 1.571, s: 1 },
  { kind: 'barrel-small', x: -8.72, z: 2.2, y: U, ry: 0, s: 1 },
  // The east upper gallery (+3.4), over the captain: his glass looking out over the hall.
  { kind: 'telescope', x: 8.7, z: -1.0, y: U, ry: Math.PI, s: 1 },
  { kind: 'chest-closed', x: 8.74, z: -5.4, y: U, ry: 1.571, s: 1 },
  { kind: 'barrel', x: 8.74, z: -6.55, y: U, ry: 0, s: 1 },
  { kind: 'barrel-small', x: 8.74, z: 0.9, y: U, ry: 0, s: 1 },

  // ---- the ground ----------------------------------------------------------------------------------
  // Under the west gallery, against the wall (the hammock hangs between these).
  { kind: 'crate-stack', x: -8.62, z: -6.62, y: G, ry: -0.1, s: 1.2 },
  { kind: 'barrel-tall', x: -8.14, z: -6.68, y: G, ry: 0, s: 1.1 },
  { kind: 'barrel', x: -8.62, z: -3.55, y: G, ry: 0, s: 1 },
  { kind: 'sack', x: -8.6, z: -3.12, y: G, ry: 0, s: 1 },
  // Under the bar's west rail, by the cellar's mouth.
  { kind: 'barrel-rack', x: -5.85, z: -6.6, y: G, ry: 1.571, s: 1 },
  { kind: 'crate-stack', x: -5.8, z: -6.02, y: G, ry: 0.15, s: 1 },
  { kind: 'barrel', x: -5.8, z: -5.58, y: G, ry: 0, s: 1 },
  // The hearth's wood, between it and the foot of the rock stair.
  { kind: 'woodpile', x: -8.75, z: 3.38, y: G, ry: 0, s: 1 },
  // The cannon in the south-west corner, run out at the south wall, its shot by the hearth.
  { kind: 'cannon', x: -8.2, z: 6.3, y: G, ry: -1.27, s: 1.4 },
  { kind: 'shot-pile', x: -8.72, z: 5.55, y: G, ry: 0, s: 1.2 },
  { kind: 'barrel', x: -7.45, z: 6.78, y: G, ry: 0, s: 1 },
  { kind: 'barrel-small', x: -5.95, z: 6.8, y: G, ry: 0, s: 1 },
  // Along the south wall, under the gun ports' sills.
  { kind: 'barrel', x: -5.2, z: 6.78, y: G, ry: 0, s: 1 },
  { kind: 'crate', x: -4.86, z: 6.8, y: G, ry: 0.2, s: 1 },
  { kind: 'crate-stack', x: 3.5, z: 6.76, y: G, ry: 0.1, s: 1 },
  { kind: 'barrel-tall', x: 3.94, z: 6.78, y: G, ry: 0, s: 1 },
  { kind: 'barrel-small', x: 4.3, z: 6.8, y: G, ry: 0, s: 1 },
  // The hold, under the captain's deck: cargo packed to the walls, big casks and crates.
  { kind: 'cask', x: 6.25, z: -6.62, y: G, ry: 0, s: 1.3 },
  { kind: 'crate-wide', x: 7.22, z: -6.72, y: G, ry: 0, s: 1.3 },
  { kind: 'crate-stack', x: 7.98, z: -6.7, y: G, ry: 0.1, s: 1.4 },
  { kind: 'barrel-tall', x: 8.66, z: -6.7, y: G, ry: 0, s: 1.2 },
  { kind: 'barrel-rack', x: 8.65, z: -5.8, y: G, ry: 1.571, s: 1.2 },
  { kind: 'crate-stack', x: 8.66, z: -5.0, y: G, ry: -0.1, s: 1.3 },
  { kind: 'cask', x: 8.58, z: -4.1, y: G, ry: 1.571, s: 1.2 },
  { kind: 'barrel', x: 8.7, z: -3.3, y: G, ry: 0, s: 1.2 },
  { kind: 'crate-barrel', x: 8.68, z: -2.72, y: G, ry: 0.2, s: 1.2 },
  { kind: 'crate-stack', x: 7.2, z: -5.55, y: G, ry: 0.3, s: 1.3 },
  { kind: 'barrel-tall', x: 7.68, z: -5.6, y: G, ry: 0, s: 1.2 },
  { kind: 'crate', x: 7.3, z: -4.95, y: G, ry: -0.2, s: 1.2 },
  { kind: 'sack', x: 6.55, z: -5.7, y: G, ry: 0, s: 1.1 },
  { kind: 'sack', x: 6.3, z: -5.35, y: G, ry: 0, s: 1 },
  { kind: 'barrel', x: 6.0, z: -2.7, y: G, ry: 0, s: 1.1 },
  { kind: 'crate', x: 6.05, z: -2.2, y: G, ry: 0.3, s: 1.1 },
  { kind: 'barrel-small', x: 5.0, z: -2.9, y: G, ry: 0, s: 1 },
  { kind: 'crate-small', x: 4.8, z: -2.95, y: G, ry: 0.4, s: 1 },
  // The rum cellar: the keg rack against its west wall, a cask by the arch, and behind the bars the
  // Kraken's own treasure.
  { kind: 'keg-rack', x: -8.8, z: -8.2, y: G, ry: 0, s: 1 },
  { kind: 'cask', x: -8.25, z: -8.72, y: G, ry: 0, s: 1 },
  { kind: 'barrel', x: -8.25, z: -7.35, y: G, ry: 0, s: 1 },
  { kind: 'hoard', x: -6.15, z: -8.55, y: G, ry: 0, s: 1.1 },
  { kind: 'chest', x: -6.7, z: -8.7, y: G, ry: 0.1, s: 0.9 },
  { kind: 'crate-gold', x: -5.72, z: -8.78, y: G, ry: 0.3, s: 1 },
  { kind: 'ingots', x: -6.62, z: -8.3, y: G, ry: 0.5, s: 1 },
  { kind: 'sack-gold', x: -5.75, z: -8.3, y: G, ry: 0, s: 1 },
];

export const EXTRA_BLOCKERS = [
  // The fire irons on their stand by the hearth's south jamb (dressing.py hearth()).
  { x: -8.33, z: 4.95, r: 0.06, y0: G, y1: G + 0.36 },
];
