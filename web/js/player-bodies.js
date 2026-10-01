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
import { ADVENTURER_PARTS, ADVENTURER_RIG, ADVENTURER_JOINTS, ADVENTURER_EYE_Y } from './adventurer-mesh.js';

// The order is the inventory's: the Traveller first, because it is who everybody already is.
export const CHARACTERS = [
  { id: 'traveller', name: 'Traveller', parts: SETTLER_PARTS, rig: SETTLER_RIG, joints: SETTLER_JOINTS, eyeY: SETTLER_EYE_Y },
  { id: 'adventurer', name: 'Adventurer', parts: ADVENTURER_PARTS, rig: ADVENTURER_RIG, joints: ADVENTURER_JOINTS, eyeY: ADVENTURER_EYE_Y },
];
export const DEFAULT_CHARACTER = 'traveller';
// The colour every fixed wardrobe slot (steel, brass, pack...) has, whichever body wears it:
// the Adventurer's gear is the Traveller's refitted, so it reads the same table. Its own body
// carries baked per-corner colours (`part.colors`) and reads none of it.
export const PART_COLORS = SETTLER_COLORS;

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
// Anything that is not a known body - a page from before this, a newer page's third body, a
// stranger's nonsense - is the Traveller, never an error: a wrong body is a cosmetic slip, a
// throw here would be an invisible player.
export const characterId = (id) => (BY_ID.has(id) ? id : DEFAULT_CHARACTER);
export const characterOf = (id) => BY_ID.get(characterId(id));
