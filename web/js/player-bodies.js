// The bodies a player can choose (Plans/tweede-avonturier.md). Each is one Blender-baked set of
// parts with its own three-joint rig: the Traveller is scripts/build-settler.py, the
// Adventurer is scripts/build-adventurer.py, adapted from a CC-BY Sketchfab model (credits in
// assets/adventurer/CREDITS.md). Everything that dresses, rigs or draws a player asks here
// which parts, joints and eye height belong to `spec.character`, never a mesh module
// directly - that is what lets a wardrobe piece, a held item or a stride work on either body.
//
// Both modules are imported synchronously like every other bake (CLAUDE.md "Nothing is
// fetched at boot"): a player switching body in the inventory must not wait on a loader, and
// neither may a peer who arrives already wearing the other one.
import { SETTLER_PARTS, SETTLER_RIG, SETTLER_JOINTS, SETTLER_COLORS, SETTLER_EYE_Y } from './settler-mesh.js';
import { ADVENTURER_PARTS, ADVENTURER_RIG, ADVENTURER_JOINTS, ADVENTURER_EYE_Y, ADVENTURER_FINGERS } from './adventurer-mesh.js';
// The Wanderer's two bodies (Plans/basislichamen-en-outfits.md): a man and a woman in their
// underwear on the Adventurer's skeleton, from Quaternius's CC0 kit (assets/bodies/CREDITS.md),
// with outfits as parts of their own (`variant: 'outfit:<id>'`) worn over them.
import { BODIES } from './bodies-mesh.js';

// `gait` names its walk and run in avatar-gait.js GAITS: how fast, how long a stride, how
// the upper body carries itself.
// The order is the inventory's: the Traveller first, because it is who everybody already is.
export const CHARACTERS = [
  { id: 'traveller', name: 'Traveller', parts: SETTLER_PARTS, rig: SETTLER_RIG, joints: SETTLER_JOINTS, eyeY: SETTLER_EYE_Y, gait: 'traveller' },
  { id: 'adventurer', name: 'Adventurer', parts: ADVENTURER_PARTS, rig: ADVENTURER_RIG, joints: ADVENTURER_JOINTS, fingers: ADVENTURER_FINGERS, eyeY: ADVENTURER_EYE_Y, gait: 'athlete' },
  ...['male', 'female'].map((sex) => ({
    id: `wanderer-${sex}`, name: 'Wanderer', sex, wanderer: true, parts: BODIES[sex].parts, rig: BODIES[sex].rig,
    joints: BODIES[sex].joints, fingers: BODIES[sex].fingers, eyeY: BODIES[sex].eyeY, gait: 'athlete',
    hair: BODIES[sex].hair, hairStyles: BODIES[sex].hairStyles,
  })),
];
// The choice over the inventory's alcove: one portrait per kind of body, the Wanderer once - which
// of its two is the choice at the right (`spec.body`).
export const CHARACTER_PICKS = [
  { id: 'traveller', name: 'Traveller' },
  { id: 'adventurer', name: 'Adventurer' },
  { id: 'wanderer', name: 'Wanderer' },
];
export const SEXES = ['male', 'female'];
// What a Wanderer wears over the underwear, one garment a slot (scripts/build-bodies.py GARMENTS):
// each slot holds a set's piece (`garment:<set>-<slot>` parts) or nothing. Every garment is baked on
// its own, so a peasant's shirt goes with any trousers, and a new set is pieces in the same slots.
export const GARMENTS = [
  { id: 'shirt', name: 'Shirt' },
  { id: 'trousers', name: 'Trousers' },
  { id: 'shoes', name: 'Shoes' },
  { id: 'straps', name: 'Arm straps' },
];
export const GARMENT_SETS = [{ id: 'peasant', name: 'Peasant' }];
export const DEFAULT_WEAR = Object.fromEntries(GARMENTS.map((g) => [g.id, 'peasant']));
// A Wanderer's hairstyles (`hair:<id>` parts), 'none' being bald; a body that has no such style
// wears its own first one.
export const HAIR_STYLES = [
  { id: 'long', name: 'Long' }, { id: 'buns', name: 'Buns' }, { id: 'parted', name: 'Parted' },
  { id: 'buzzed', name: 'Buzzed' }, { id: 'none', name: 'Bald' },
];
export const DEFAULT_CHARACTER = 'traveller';
// The colour every fixed wardrobe slot (steel, brass, pack...) has, whichever body wears it:
// the Adventurer's gear is the Traveller's refitted, so it reads the same table. Its own body
// carries baked per-corner colours (`part.colors`) and reads none of it.
export const PART_COLORS = SETTLER_COLORS;

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
// Which body a look is drawn on. A Wanderer goes out as `character: 'adventurer', body: <sex>`:
// a page or a sea from before the Wanderer drops `body` and draws the Adventurer, not the
// Traveller an unknown character id would give (Plans/basislichamen-en-outfits.md, "De look").
// So `body` decides when it is there, and `character` only names the two older bodies. Anything
// that is not a known body is the Traveller, never an error: a wrong body is a cosmetic slip, a
// throw here would be an invisible player.
export const bodyKey = (spec) => (spec && typeof spec === 'object'
  ? (SEXES.includes(spec.body) ? `wanderer-${spec.body}` : characterId(spec.character))
  : characterId(spec));
export const characterId = (id) => (BY_ID.has(id) && !BY_ID.get(id).wanderer ? id : DEFAULT_CHARACTER);
// Takes a look or a body's id: every reader that has the look hands the look, so a Wanderer is
// told from the Adventurer it says it is.
export const characterOf = (x) => BY_ID.get(x && typeof x === 'object' ? bodyKey(x) : (BY_ID.has(x) ? x : DEFAULT_CHARACTER));
