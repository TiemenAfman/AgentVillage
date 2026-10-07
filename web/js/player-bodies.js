// The bodies a player can choose (Plans/tweede-avonturier.md). Each is one Blender-baked set of
// parts with its own three-joint rig: the Traveller is scripts/build-settler.py, the
// Adventurer is scripts/build-adventurer.py, adapted from a CC-BY Sketchfab model (credits in
// assets/adventurer/CREDITS.md). Everything that dresses, rigs or draws a player asks here
// which parts, joints and eye height belong to `spec.character`, never a mesh module
// directly - that is what lets a wardrobe piece, a held item or a stride work on either body.
//
// The Traveller and the Adventurer are imported synchronously like every other bake (CLAUDE.md
// "Nothing is fetched at boot"): a player switching body in the inventory must not wait on a
// loader, and neither may a peer who arrives already wearing the other one.
import { SETTLER_PARTS, SETTLER_RIG, SETTLER_JOINTS, SETTLER_COLORS, SETTLER_EYE_Y } from './settler-mesh.js';
import { ADVENTURER_PARTS, ADVENTURER_RIG, ADVENTURER_JOINTS, ADVENTURER_EYE_Y, ADVENTURER_FINGERS } from './adventurer-mesh.js';
import { offThread } from './lazy-module.js';
// The Wanderer's two bodies (Plans/basislichamen-en-outfits.md): a man and a woman in their
// underwear on the Adventurer's skeleton, from Quaternius's CC0 kit (assets/bodies/CREDITS.md),
// with outfits as parts of their own (`variant: 'garment:<id>'`) worn over them.
// Not like the other two: their geometry (bodies-mesh.js) is 19.5 MB, which every page parsed at
// boot, the phone and the web included, whether or not anybody on screen was a Wanderer. So only
// what the boot needs is imported here - the rig, the joints, the hairstyles and every part's
// name, slot, variant, group and hide list (bodies-meta.js, 39 kB, the same bake) - which is all
// the inventory and the look ask of a body. The triangles come by `loadWanderers`, parsed off the
// main thread like the Salty Kraken's hall (lazy-module.js), and are merged into these same part
// objects, so whoever holds a part holds it whole once it is in. Until then a Wanderer is drawn as
// the Adventurer it says it is on the wire (`drawnLook`, the same rig and size; what an older page
// draws too), and every rig wearing one is swapped onto the real body when the set lands
// (`onWanderers`, classic-avatar.js createClassicAvatar).
import { BODIES_META as BODIES } from './bodies-meta.js';

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

// ---- the Wanderer's geometry, loaded when somebody wears one ----------------------------------
// Asked for by whoever is about to draw a Wanderer: a rig made or set to one (classic-avatar.js,
// which covers our own body, a peer and the inventory's alcove) and the inventory opening (studio.js,
// so its portraits and picks are real ones). Nothing is fetched before `allowWanderers()`, which
// main.js calls after `state.ui.boot(true)` like the imp's `allowImp`: a request before it waits
// for it - except `{ now: true }`, which main.js uses for a Wanderer of our own at the top of the
// boot, and the workbench pages (/avatar-motion.html, /demo), which want every body at once.
// A failed load is said once; every Wanderer stays the Adventurer and the next request tries again.
const BODY_KEYS = ['positions', 'normals', 'colors', 'skin', 'skinIndices', 'skinWeights'];
let ready = false, allowed = false, asked = false, loading = null, failedSaid = false;
const listeners = new Set();
export const wanderersReady = () => ready;
// A look as it can be drawn now: a Wanderer whose body is not in yet is the Adventurer, as the
// wire says it is. Anything else passes through untouched (the same object).
export const drawnLook = (spec) => (!ready && spec && typeof spec === 'object' && SEXES.includes(spec.body)
  ? { ...spec, character: 'adventurer', body: null } : spec);
export const wantsWanderer = (spec) => !!(spec && typeof spec === 'object' && SEXES.includes(spec.body));
// `fn` once, when the bodies are in (at once if they are). Returns a function that forgets it.
export function onWanderers(fn) {
  if (ready) { fn(); return () => {}; }
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function allowWanderers() {
  allowed = true;
  if (asked && !ready) loadWanderers();
}
// For tests: whether anything has been fetched (or asked for while not allowed).
export const wanderersState = () => ({ ready, allowed, asked, loading: !!loading });
export function loadWanderers({ now = false } = {}) {
  if (ready) return Promise.resolve(true);
  asked = true;
  if (!allowed && !now) return null;
  if (!loading) {
    loading = offThread(new URL('./bodies-mesh.js', import.meta.url).href, 'BODIES', BODY_KEYS).then((full) => {
      for (const sex of SEXES) {
        const into = BODIES[sex].parts, from = full[sex].parts;
        if (from.length !== into.length) throw new Error(`bodies-mesh.js and bodies-meta.js disagree on the ${sex}'s parts`);
        from.forEach((part, i) => {
          if (part.name !== into[i].name) throw new Error(`bodies-mesh.js and bodies-meta.js disagree at ${into[i].name}`);
          for (const key of BODY_KEYS) if (part[key] !== undefined) into[i][key] = part[key];
        });
      }
      ready = true;
      for (const fn of [...listeners]) { listeners.delete(fn); try { fn(); } catch (e) { console.error(e); } }
      return true;
    }, (e) => {
      if (!failedSaid) { failedSaid = true; console.warn('[island] the Wanderer\'s bodies did not load; drawing the Adventurer instead', e); }
      loading = null;
      return false;
    });
  }
  return loading;
}
