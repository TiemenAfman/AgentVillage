// One island, packed small enough to carry to somebody else's machine.
//
// A visitor's island travels as a single JSON object. It is built here, on the visitor's
// own computer, and it is taken apart again here, on the host's - the same file on both
// ends, which is the point: the redaction runs on the side that holds the secrets, and
// the rebuilding runs on the side that has to survive a lie.
//
// Two rules shape everything below.
//
//   Nothing from the wire is ever spread or assigned wholesale. `parseBundle` is not a
//   checker that hands back the object it was given - it builds a brand new one, field by
//   field, out of a whitelist. A field this file has never heard of cannot reach the
//   host's disk, whatever the sender calls it.
//
//   `buildBundle` and `parseBundle` share the same rebuilders. They differ in what they do
//   when a value is wrong - the guest, whose own data this is, clamps and slices; the host
//   refuses - and, in exactly one place, in what they do to a *key*: `placedAt` renames the
//   ids of `placements` on the way out, because that map is written on this machine in this
//   machine's own names and everything else in a bundle has already been redacted by the
//   time it gets here. Nothing renames on the way in, where the keys arrived redacted
//   already. Both asymmetries are one-directional on purpose, which is why
//   `parseBundle(buildBundle(v))` still deep-equals `buildBundle(v)` - not because two
//   lists of field names were kept in step by hand, but because there is only one list and
//   the one translation runs once.
//
// What deliberately does NOT travel: data/layout.json. The host needs nothing out of it
// (village.json already carries every plot, door, path, bridge, cleared cell and polder
// it would ask for), and by never sending it the host is structurally incapable of
// writing it back. layout.json is the one irreplaceable file under data/ - a house never
// moves - so the cheapest safety property in this whole design is that a visitor's
// upload contains no layout at all. Do not add one.
import crypto from 'node:crypto';
import os from 'node:os';
import { makeTerrain, RELIEF_VERSION } from '../shared/terrain.mjs';
import { BOATS_PER_HARBOUR } from '../shared/quay.mjs';
import { VOLCANO, volcanoTerrain, guardhouseSpec, volcanoBridges, CODEX, CODEX_TIERS } from '../shared/volcano.mjs';
import { guestVillage } from './guestview.mjs';

export const BUNDLE_V = 1;

// The grid sizes this accepts.
export const GRID_MIN = 16;
export const GRID_MAX = 512;

// How many of each thing one island may carry. Every one of these counts something that
// becomes a draw call or a cell of ground on the host's machine.
export const CAPS = {
  buildings: 600,
  districts: 64,
  paths: 400,
  bridges: 64,
  polders: 64,
  cleared: 20000,
  props: 500,
  crops: 200,
  // Not asked for and here anyway: 400 paths of a million cells each is a modest JSON
  // document and an enormous amount of work. No run of paving can be longer than the
  // island has cells, and 4096 is a 64-cell island's entire surface.
  cells: 4096,
  ornaments: 12,
  lobes: 64,
  sizeSteps: 16,
  // Growth steps (Plans/eiland-laten-groeien.md). Each is a ring of coast; thirty-two of
  // them take a 32-grid island far past the biggest grid this accepts.
  growSteps: 32,
};

const BUILDING_KINDS = new Set(['house', 'shed', 'civic']);
const AXES = new Set(['x', 'z']);

// Every id in a village is a colon-joined slug: `house:s3`, `civic:office:p:d3`,
// `path:civic:clocktower`, `prop:1a2b3c4d`. Nothing in that grammar can hold a path
// separator, which is what makes this pattern the structural half of the promise that no
// absolute path travels: a district id in a raw village.json *is* its own full path
// (`p:d:\git\martijn\agentvillage`), and that string turns up again inside the id of its
// office. guestVillage() renames those - but only the ones it knew to look for, and a
// leftover would sail straight through a length check. It cannot get through this one.
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/;
// A small lowercase word looked up in a register in the browser: a kind, a tier, a style,
// a civic type, an ornament. Same shape props.mjs demands of a prop kind.
const SLUG = /^[a-z][a-z0-9-]{0,31}$/;
// What hashHeights() produces: eight hex digits, and never anything else.
const TERRAIN_HASH = /^[0-9a-f]{8}$/;
// An island id: what beaconId() below produces.
export const ISLAND_ID = /^[a-f0-9]{8,64}$/;

// An island's id, out of the machine and the port it answers on. Named after the LAN
// beacon that used to shout it; the beacon is gone and the id is not, because the sea
// knows every island by it and data/sea-token.json holds the claim under it.
export function beaconId(port, hostname = os.hostname()) {
  return crypto.createHash('sha1').update(`${hostname}:${port}`).digest('hex').slice(0, 16);
}

// ---- refusing, or clamping ----------------------------------------------------------
// One context object decides which of the two this is. `strict` is the host reading the
// wire; anything else is the guest packing its own village up.
function context(strict, size) {
  return {
    strict,
    size,
    // The slack past the shore. props.mjs and garden.mjs both let a jetty or a buoy stand
    // `gridSize / 2 + 20` out into the water, so a bundle has to allow the same reach or
    // the harbour furniture drowns on arrival.
    edge: size / 2 + 20,
    bad(what) {
      if (strict) throw new Error(what);
      return null;
    },
  };
}

// The characters that have no business in a name, a label or a note. Control characters
// are the C0 and C1 ranges; the invisible ones come from `clean()`
// in lib/players.mjs:31-40. The exposure this closes is not HTML - web/js/ui.js escapes
// everywhere - it is the canvas: a name is drawn into a texture, and one control
// character in it wrecks the text metrics for the whole sign.
function strip(s, max) {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const control = c < 0x20 || (c >= 0x7f && c <= 0x9f);
    const invisible = (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || c === 0xfeff;
    if (!control && !invisible) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

// Stripping is the guest's job, and only the guest's. By the time a string reaches the
// host it has already been through here once, so a string that would still change is a
// string that did not come out of buildBundle - and that is worth refusing rather than
// quietly repairing, because a repaired bundle is one nobody can reason about afterwards.
function text(v, max, ctx) {
  if (typeof v !== 'string') return ctx.bad('a name or label arrived as something that is not text');
  const out = strip(v, max);
  if (ctx.strict && out !== v) return ctx.bad('a name or label arrived with characters that do not belong in one');
  return out;
}

function textOrNull(v, max, ctx) {
  if (v === null || v === undefined) return null;
  return text(v, max, ctx) || null;
}

function idOf(v, ctx) {
  if (typeof v !== 'string' || !ID.test(v)) return ctx.bad('an id arrived that is not one');
  return v;
}

function idOrNull(v, ctx) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !ID.test(v)) return ctx.bad('an id arrived that is not one');
  return v;
}

function slug(v, ctx) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !SLUG.test(v)) return ctx.bad(`"${String(v).slice(0, 24)}" is not a kind, a tier or a style`);
  return v;
}

function oneOf(v, set, ctx, what) {
  if (typeof v !== 'string' || !set.has(v)) return ctx.bad(`${what} arrived as something this island does not have`);
  return v;
}

function bool(v) {
  return v === true;
}

// Insisting on an actual number, not something that merely converts to one - the reason
// num() in lib/players.mjs:46 does the same. JSON turns NaN and Infinity into null on the
// way out and Number(null) is a perfectly finite zero, so a coercing check would move a
// house to the corner of the island rather than reject the bundle. It is also what makes
// a gridSize of the string '64' a refusal instead of a silent success.
function whole(v, lo, hi, ctx) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ctx.bad('a whole number arrived as something else');
  const n = Math.round(v);
  if (ctx.strict && n !== v) return ctx.bad(`${v} was meant to be a whole number`);
  if (n < lo || n > hi) {
    if (ctx.strict) return ctx.bad(`${n} is outside ${lo}..${hi}`);
    return Math.min(hi, Math.max(lo, n));
  }
  return n;
}

// Three decimals, which is what props.mjs and garden.mjs already round their own
// coordinates to. Rounding on both sides is what keeps the round trip exact for a
// rotation nobody rounded when it was made.
function real(v, lo, hi, ctx) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ctx.bad('a measurement arrived as something that is not a number');
  const n = Math.round(v * 1000) / 1000;
  if (n < lo || n > hi) {
    if (ctx.strict) return ctx.bad(`${n} is outside ${lo}..${hi}`);
    return Math.min(hi, Math.max(lo, n));
  }
  return n;
}

// A grid cell, range-checked against the size the bundle declared for itself rather than
// against any fixed number. A pair outside it is dropped by the guest and refused by the
// host: clamping is wrong here, because a clamped cell is a piece of ground that moved.
function cell(v, ctx) {
  if (!Array.isArray(v) || v.length !== 2) return ctx.bad('a cell arrived that is not a pair');
  const gx = whole(v[0], 0, ctx.size - 1, ctx);
  const gz = whole(v[1], 0, ctx.size - 1, ctx);
  if (gx === null || gz === null) return null;
  if (ctx.strict && (gx !== v[0] || gz !== v[1])) return ctx.bad(`the cell ${v[0]},${v[1]} is not on a ${ctx.size}-cell island`);
  if (!ctx.strict && (gx !== v[0] || gz !== v[1])) return null;
  return [gx, gz];
}

function cellOrNull(v, ctx) {
  if (v === null || v === undefined) return null;
  return cell(v, ctx);
}

// Milliseconds since the epoch, the way a bed carries its planting. Not an ISO string:
// shared/crops.mjs works the growing out in arithmetic and never parses a date.
function epoch(v, ctx) {
  if (v === null || v === undefined) return null;
  return whole(v, 0, 1e15, ctx);
}

// An ISO timestamp, and exactly the spelling `iso()` in lib/paths.mjs produces. Anything
// else is normalised by the guest and refused by the host, so the round trip is exact.
function stamp(v, ctx) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return ctx.bad('a timestamp arrived as something that is not text');
  const n = Date.parse(v);
  if (!Number.isFinite(n)) return ctx.bad(`"${v.slice(0, 32)}" is not a date`);
  const out = new Date(n).toISOString();
  if (ctx.strict && out !== v) return ctx.bad(`"${v.slice(0, 32)}" is not a date written the way this island writes them`);
  return out;
}

function list(raw, cap, f, ctx, what) {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) { ctx.bad(`${what} arrived as something that is not a list`); return []; }
  if (raw.length > cap) { ctx.bad(`${raw.length} ${what} is more than the ${cap} an island carries`); }
  const out = [];
  for (const item of raw.slice(0, cap)) {
    const built = f(item, ctx);
    if (built !== null && built !== undefined) out.push(built);
  }
  return out;
}

const cells = (raw, ctx, what) => list(raw, CAPS.cells, cell, ctx, what);
// The bald patches under the village. Its own cap, because there are as many of these as
// there is ground, where a path is a line across it.
const clearedCells = (raw, ctx) => list(raw, CAPS.cleared, cell, ctx, 'cleared cells');

// A run-length parcel, as scan.mjs writes one. The coordinates here are super-cells
// counted from the lattice anchor, NOT grid cells, and they are routinely negative - see
// decodeOwnership in web/js/hamlets.js, which multiplies them by the pitch and adds the
// anchor. Range-checking these against 0..size would throw away half the hamlets on the
// island, which is exactly the bug this comment exists to stop somebody writing.
function parcel(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a parcel arrived that is not an object');
  const i0 = whole(raw.i0, -ctx.size, ctx.size, ctx);
  const j0 = whole(raw.j0, -ctx.size, ctx.size, ctx);
  const w = whole(raw.w, 1, ctx.size, ctx);
  const h = whole(raw.h, 1, ctx.size, ctx);
  if (i0 === null || j0 === null || w === null || h === null) return null;
  if (!Array.isArray(raw.rows) || raw.rows.length !== h) return ctx.bad('a parcel has a different number of rows than it says it has');
  const rows = [];
  for (const row of raw.rows) {
    if (typeof row !== 'string' || row.length !== w) return ctx.bad('a parcel row is not as wide as the parcel');
    if (!/^[01]*$/.test(row)) return ctx.bad('a parcel row is written in something other than ones and zeroes');
    rows.push(row);
  }
  return { i0, j0, w, h, rows };
}

// ---- the records --------------------------------------------------------------------
// Everything below is a whitelist. A field that is not named here does not exist as far
// as a bundle is concerned, in either direction.

// What is left of a building once it is only a thing to draw.
//
// Off the list on purpose, beyond the four the brief names (stats, tools, models,
// skills):
//   title, gitBranch, workOrders, commission, sessionId  - guestVillage already takes
//        these; they are named again here so that a change over there cannot quietly put
//        them back on somebody else's disk.
//   waiting      - carries `question`, which is a settler's own words, verbatim.
//        guestVillage does not strip it. It is the single most conversational field left
//        in a redacted village and it has no business crossing a network.
//   description  - a subagent's task description, which is the prompt that started it.
//   cwd, root    - guestVillage reduces these to a folder's own name and treats that as
//        the thing a visitor came to see. On a visit the district's name is already on
//        the sign over the hamlet, and a folder name per house adds nothing to the
//        picture, so the bundle does without.
//   repo, repoUrl, repoName, sprintName, cards, openIssues, totalIssues, run,
//   spawnDepth   - nothing draws any of them.
function building(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a building arrived that is not an object');
  const id = idOf(raw.id, ctx);
  const kind = oneOf(raw.kind, BUILDING_KINDS, ctx, 'a building');
  if (id === null || kind === null) return null;
  return {
    id,
    kind,
    civicType: slug(raw.civicType, ctx),
    shedType: slug(raw.shedType, ctx),
    // Not a slug: an agent is called `Plan` or `general-purpose`, capital and all.
    agentType: textOrNull(raw.agentType, 40, ctx),
    district: idOrNull(raw.district, ctx),
    master: idOrNull(raw.master, ctx),
    name: textOrNull(raw.name, 48, ctx),
    label: textOrNull(raw.label, 40, ctx),
    style: slug(raw.style, ctx),
    tier: slug(raw.tier, ctx),
    source: slug(raw.source, ctx),
    entrypoint: slug(raw.entrypoint, ctx),
    ornaments: list(raw.ornaments, CAPS.ornaments, slug, ctx, 'ornaments'),
    harbour: bool(raw.harbour),
    outpost: outpost(raw.outpost, ctx),
    founder: bool(raw.founder),
    visitor: bool(raw.visitor),
    hotel: bool(raw.hotel),
    active: bool(raw.active),
    archived: bool(raw.archived),
    plot: plot(raw.plot, ctx),
    door: cellOrNull(raw.door, ctx),
    startedAt: stamp(raw.startedAt, ctx),
    lastAt: stamp(raw.lastAt, ctx),
    // Filled in by linkSheds() below, on both sides, from the shed entries that actually
    // came along. Never read off the wire - see the comment there.
    sheds: [],
  };
}

function outpost(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('an outpost arrived that is not an object');
  const name = textOrNull(raw.name, 60, ctx);
  return name ? { name } : null;
}

function plot(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a plot arrived that is not an object');
  const gx = whole(raw.gx, 0, ctx.size - 1, ctx);
  const gz = whole(raw.gz, 0, ctx.size - 1, ctx);
  const w = whole(raw.w, 1, 16, ctx);
  const d = whole(raw.d, 1, 16, ctx);
  const rot = whole(raw.rot, 0, 3, ctx);
  if (gx === null || gz === null || w === null || d === null || rot === null) return null;
  return { gx, gz, w, d, rot, ...(raw.quay === true ? { quay: true } : {}) };
}

// Which sheds stand in which yard.
//
// This is derived rather than carried, and the reason is a bug worth knowing about:
// `sheds` on a building is a list of *ids* (strings), but guestVillage() at
// lib/guestview.mjs:84 destructures each entry as though it were an object, so every
// shed id comes out of a redacted village as `{0:'s',1:'h',2:'e',...}` - sixty keys of
// one character each, and the id gone. A guest island has been drawing its yards from
// that for as long as the guest view has existed.
//
// Deriving the list from the `master` link each shed already carries sidesteps it
// entirely, is computed from data that has been through the redaction, and cannot carry
// an id for a shed that did not come along. Both sides run this, so the wire value - if a
// sender bothers to put one there - is ignored rather than trusted.
function linkSheds(buildings) {
  const known = new Set(buildings.map((b) => b.id));
  const yards = new Map();
  for (const b of buildings) {
    if (b.kind !== 'shed' || !b.master || !known.has(b.master)) continue;
    const yard = yards.get(b.master) || [];
    yard.push(b.id);
    yards.set(b.master, yard);
  }
  for (const b of buildings) b.sheds = yards.get(b.id) || [];
  return buildings;
}

// A district id that names no district is dropped. On a village that has been through
// guestVillage every reference resolves; one that does not is either a bundle somebody
// wrote by hand or a district that fell off the end of the cap, and in the first case the
// unresolved id is the raw one - which is an absolute path.
function resolveRefs(buildings, districts) {
  const known = new Set(districts.map((d) => d.id));
  for (const b of buildings) if (b.district && !known.has(b.district)) b.district = null;
  return buildings;
}

function lobe(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a hamlet lobe arrived that is not an object');
  return {
    green: cellOrNull(raw.green, ctx),
    size: whole(raw.size, 0, CAPS.cells, ctx) ?? 0,
    paved: cells(raw.paved, ctx, 'paving'),
    parcel: parcel(raw.parcel, ctx),
  };
}

function district(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a district arrived that is not an object');
  const id = idOf(raw.id, ctx);
  if (id === null) return null;
  return {
    id,
    kind: slug(raw.kind, ctx),
    name: textOrNull(raw.name, 40, ctx),
    hue: whole(raw.hue, 0, 360, ctx) ?? 0,
    center: cellOrNull(raw.center, ctx),
    square: cellOrNull(raw.square, ctx),
    pier: cells(raw.pier, ctx, 'a pier'),
    // The pier's ramp cell. Whitelisted for the same reason as `pier`: a visiting island's
    // boat has to moor at the quay its village built, and shared/quay.mjs needs both to
    // find it. Unchecked against the guest's own ground here - runFromPlanks does that.
    shore: cellOrNull(raw.shore, ctx),
    // The quay's boardwalk. Whitelisted because the crowd is walked out on the sea now:
    // shared/roads.mjs reads it straight off the bundle, so a deck left out here is a
    // district whose settlers cannot step off their own front decks - on our island as
    // much as on a guest's, because the sea walks ours out of the same bundle a stranger
    // is handed. Cells on a grid, like `pier`, with nothing in them to redact.
    deck: cells(raw.deck, ctx, 'a deck'),
    tier: slug(raw.tier, ctx),
    guest: bool(raw.guest),
    paved: cells(raw.paved, ctx, 'paving'),
    lobes: list(raw.lobes, CAPS.lobes, lobe, ctx, 'hamlet lobes'),
    population: whole(raw.population, 0, 100000, ctx) ?? 0,
    firstSeenAt: stamp(raw.firstSeenAt, ctx),
  };
}

function path(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a path arrived that is not an object');
  const id = idOf(raw.id, ctx);
  if (id === null) return null;
  return { id, cells: cells(raw.cells, ctx, 'path cells') };
}

function bridge(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a bridge arrived that is not an object');
  const id = idOf(raw.id, ctx);
  const axis = oneOf(raw.axis, AXES, ctx, 'a bridge');
  if (id === null || axis === null) return null;
  return { id, axis, cells: cells(raw.cells, ctx, 'bridge cells') };
}

// `cells`, `pools` and `dike` are the three lists makeTerrain() reads to raise the ground
// (shared/terrain.mjs:243), so they decide the terrain hash and cannot be approximate.
// `road` is the causeway, which world.js keeps clear of trees. `supers` and `seed` are
// planning leftovers in super-cell coordinates that nothing draws, so they stay home.
//
// `pools` arrived after this whitelist did and was missed, which is the one omission here
// that is fatal rather than cosmetic: they are the puddles a sea wall corners off and
// `reclaim` fills, so an island that has any hashes its land with them and a bundle
// without them hashes it differently. `parseBundle` recomputes that hash and refuses a
// bundle whose land does not add up, so such an island could not sail at all - measured
// over forty seeds, twenty-eight of them grow a pooled polder somewhere on the ladder,
// the first of them usually at the second or third polder. The failure looks like two
// machines running different code, which is precisely what it is not.
// `manual`, `at`, `dugAt`, `supers` and `seed` are provenance and stay home: none of them
// moves a height, so none of them is in the hash a neighbour recomputes.
function polder(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a polder arrived that is not an object');
  return {
    cells: cells(raw.cells, ctx, 'polder cells'),
    pools: cells(raw.pools, ctx, 'pool cells'),
    dike: cells(raw.dike, ctx, 'dike cells'),
    road: cells(raw.road, ctx, 'causeway cells'),
    unlockedAt: stamp(raw.unlockedAt, ctx),
  };
}

// The dredged channel. `cells` is read by makeTerrain() and so decides the terrain hash,
// exactly like a polder's `cells` and `dike` above - get it wrong and the check at the
// bottom of parseBundle refuses the whole island rather than drawing a coast with a hole
// in it. `line` is the centreline, which no ground depends on; it is here because the
// beacons stand along it, and an island whose channel was marked on one machine and blank
// on the next reads as a rendering bug.
//
// A missing fairway is null and not an empty channel, the same distinction loadLayout
// keeps: an island that has never dredged and an island that dredged and found nothing to
// dig draw identically, but only one of them will ever try again.
function fairway(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a fairway arrived that is not an object');
  return { line: cells(raw.line, ctx, 'fairway centreline'), cells: cells(raw.cells, ctx, 'fairway cells') };
}

// How the island has grown - makeTerrain's `grow`, read by every side that builds its
// ground, so like a polder's cells it decides the hash and cannot be approximate. A radius
// is a whole number for exactly that reason: `real` rounds to three decimals, and a coast
// a thousandth further out is a different island. `hold` is in local coordinates (gx -
// half), so its range is the grid's half either way rather than `cell`'s 0..size-1.
function growth(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a growth arrived that is not an object');
  const base = whole(raw.base, GRID_MIN, ctx.size, ctx);
  if (base === null) return null;
  const half = ctx.size / 2;
  const local = (c) => {
    if (!Array.isArray(c) || c.length !== 2) return ctx.bad('a held cell arrived that is not a pair');
    const x = whole(c[0], -half, half - 1, ctx), z = whole(c[1], -half, half - 1, ctx);
    return x === null || z === null ? null : [x, z];
  };
  const step = (s) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return ctx.bad('a growth step arrived that is not an object');
    const r = whole(s.r, 1, ctx.size, ctx);
    const grid = whole(s.grid, GRID_MIN, ctx.size, ctx);
    if (r === null || grid === null) return null;
    const out = { r, grid, hold: list(s.hold, CAPS.cells, local, ctx, 'held cells') };
    // Which relief the ring was drawn with. Absent stays absent rather than becoming 0, so a
    // step from before relief round-trips to exactly what it was; present, it is 0 (which
    // draws like absent) or a version this code draws (up to RELIEF_VERSION), because a
    // newer one is ground we would draw differently from whoever took the step -
    // makeTerrain refuses it too.
    if (s.relief !== undefined) {
      const relief = whole(s.relief, 0, RELIEF_VERSION, ctx);
      if (relief === null) return null;
      out.relief = relief;
    }
    return out;
  };
  return { base, steps: list(raw.steps, CAPS.growSteps, step, ctx, 'growth steps') };
}

function prop(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a prop arrived that is not an object');
  const id = idOf(raw.id, ctx);
  const kind = slug(raw.kind, ctx);
  const x = real(raw.x, -ctx.edge, ctx.edge, ctx);
  const z = real(raw.z, -ctx.edge, ctx.edge, ctx);
  if (id === null || kind === null || x === null || z === null) return null;
  return {
    id,
    kind,
    x,
    z,
    rot: real(raw.rot, -Math.PI * 4, Math.PI * 4, ctx) ?? 0,
    scale: real(raw.scale, 0.15, 6, ctx) ?? 1,
    length: raw.length === null || raw.length === undefined ? null : real(raw.length, 0, 30, ctx),
    label: textOrNull(raw.label, 60, ctx),
    face: slug(raw.face, ctx),
    note: textOrNull(raw.note, 200, ctx),
    by: textOrNull(raw.by, 40, ctx),
    at: stamp(raw.at, ctx),
    unknown: bool(raw.unknown),
  };
}

// A bed: where it is, what is in it and how far along. cropsView() is already the view
// that names no purse (lib/garden.mjs:161), and this keeps it that way.
function crop(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a bed arrived that is not an object');
  const id = idOf(raw.id, ctx);
  const kind = slug(raw.kind, ctx);
  const x = real(raw.x, -ctx.edge, ctx.edge, ctx);
  const z = real(raw.z, -ctx.edge, ctx.edge, ctx);
  if (id === null || kind === null || x === null || z === null) return null;
  return {
    id,
    kind,
    x,
    z,
    rot: real(raw.rot, -Math.PI * 4, Math.PI * 4, ctx) ?? 0,
    plantedAt: epoch(raw.plantedAt, ctx),
    ripeAt: epoch(raw.ripeAt, ctx),
    crop: whole(raw.crop, 0, 10000, ctx) ?? 0,
    salt: bool(raw.salt),
  };
}

// One of the island's harbours (lib/layout.mjs planHarbours): which side it faces, its
// planks and the cell they start from, and how many boats its keeper has built there. The
// planks are what every other island draws the dock from and moors the boats at
// (shared/quay.mjs mooringsFor), so they are cells like a pier's; the count is capped at
// BOATS_PER_HARBOUR here as well as where it is made, because on the sea this arrives
// from a stranger and a hundred boats is a hundred hulls in everybody's water.
const HARBOUR_SIDES = new Set(['n', 'e', 's', 'w']);
function harbour(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a harbour arrived that is not an object');
  if (typeof raw.side !== 'string' || !HARBOUR_SIDES.has(raw.side)) return ctx.bad('a harbour arrived without a side it faces');
  const pier = cells(raw.pier, ctx, 'a harbour pier');
  if (!pier.length) return ctx.bad('a harbour arrived with no planks');
  return {
    side: raw.side,
    shore: cellOrNull(raw.shore, ctx),
    pier,
    boats: raw.boats === undefined ? 0 : whole(raw.boats, 0, BOATS_PER_HARBOUR, ctx) ?? 0,
  };
}

function town(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a town arrived that is not an object');
  return {
    square: cellOrNull(raw.square, ctx),
    centre: cellOrNull(raw.centre, ctx),
    lots: cells(raw.lots, ctx, 'civic lots'),
    paved: cells(raw.paved, ctx, 'paving'),
    // The shopping streets (Plans/knus-dorpscentrum.md): already in `paved`, named again so
    // the sea's crowd keeps its Friday gathering on the square (shared/roads.mjs gatherCells).
    // Absent from an island that predates them, which then gathers where it always did.
    streets: cells(raw.streets, ctx, 'streets'),
    size: whole(raw.size, 0, ctx.size, ctx) ?? 0,
    parcel: parcel(raw.parcel, ctx),
    coreR: whole(raw.coreR, 0, ctx.size, ctx) ?? 0,
    sizeSteps: list(raw.sizeSteps, CAPS.sizeSteps, (s, c) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return c.bad('a square step arrived that is not an object');
      const size = whole(s.size, 0, c.size, c);
      const at = whole(s.at, 0, 1000000, c);
      if (size === null || at === null) return null;
      return { size, at, unlockedAt: stamp(s.unlockedAt, c) };
    }, ctx, 'square steps'),
  };
}

function lattice(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a lattice arrived that is not an object');
  const anchor = cellOrNull(raw.anchor, ctx);
  const pitch = whole(raw.pitch, 1, 64, ctx);
  if (anchor === null || pitch === null) return null;
  return { anchor, pitch };
}

// ---- packing up ---------------------------------------------------------------------

// Everything the host needs to draw this island, and nothing else.
//
// `id` and `keeper` are optional because the running server already knows better answers
// than the config file does: serve.mjs hands over the id it publishes under and the
// name the island announces itself by. Without them this falls back to the
// config, which is what a test or a headless caller gets.
// `out` is the same favour guestVillage does, narrowed to the buildings that actually made
// it into the bundle: the caps and the field checks below drop some, and a map that names
// a house nobody was sent is a map with a wrong answer in it. Loopback only - see there.
export function buildBundle({ config, village, props = [], crops = [], placements = null, id = null, keeper = null } = {}, out = null) {
  if (!village || typeof village !== 'object') throw new Error('there is no village to pack up yet');
  // Without it the host has nothing to compare its own terrain against, and the whole
  // safety of the arrangement is that comparison. A village.json that has never been
  // through a scan has no hash, and the honest answer to that is to say so here rather
  // than to send a bundle the other end is obliged to reject.
  if (!village.island || !TERRAIN_HASH.test(String(village.island.terrainHash || ''))) {
    throw new Error('this village has no terrain hash yet; run a scan before sailing');
  }
  const cfg = config || {};

  // FIELD BY FIELD, and never `...config`. A config holds network.inviteCode,
  // network.hosts, the dispatch openings and github.repo; spreading it into something
  // that goes out over a wire is how a house key ends up in a postcard.
  // The village's own grid before the config's: an island that has grown is drawn on the
  // grid its layout says, which is no longer a setting (Plans/eiland-laten-groeien.md).
  const size = Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round((village.grid && Number(village.grid.size)) || Number(cfg.gridSize) || 64)));
  const ctx = context(false, size);

  // Unconditionally, and NOT behind config.multiplayer.guestView === 'full'. That setting
  // says who may LOOK at this island through this island's own server, where the keeper
  // can change their mind and the page reloads. It is not a licence to write raw session
  // titles, branch names and ticket summaries onto somebody else's disk, where they stay
  // until that somebody restarts a server they do not think of as holding your data.
  //
  // The table of what it renamed is asked for whether or not a caller wants it back, which
  // it did not used to be. It is no longer only a favour to serve.mjs: `placements` below
  // is keyed by building id and has to be translated into the names the buildings sail
  // under, so the table is now part of packing rather than an extra somebody asks for. The
  // whole of its cost is one Map of `buildings.length` entries.
  const named = {};
  const shown = guestVillage(village, named);

  const districts = list(shown.districts, CAPS.districts, district, ctx, 'districts');
  const buildings = linkSheds(resolveRefs(list(shown.buildings, CAPS.buildings, building, ctx, 'buildings'), districts));

  // `real id -> the name it travels under`, for the buildings that actually made it into
  // the bundle: the caps and the field checks above drop some, and a map that names a house
  // nobody was sent is a map with a wrong answer in it. Inverted from guestVillage's own
  // `renamed -> real` rather than assembled from a second notion of what an id becomes -
  // that derivation is what carries a rename added tomorrow for free, and two tables that
  // could disagree is exactly the bug this file keeps having.
  const sailsAs = new Map();
  for (const b of buildings) {
    const real = named.ids && named.ids.get(String(b.id));
    if (real) sailsAs.set(real, b.id);
  }

  // Loopback only - see the header of lib/guestview.mjs.
  if (out) {
    out.ids = {};
    for (const [real, shownId] of sailsAs) out.ids[shownId] = real;
  }

  const islandOf = shown.island || {};
  return {
    v: BUNDLE_V,
    island: {
      id: typeof id === 'string' && ISLAND_ID.test(id) ? id : beaconId(Math.round(Number(cfg.port) || 4747)),
      hostile: islandOf.hostile === true,
      // Beside `hostile`, and read by every makeTerrain call that builds ground out of a
      // bundle: the volcano is a different heightfield from the same seed, so a side that
      // dropped this flag would draw an ordinary island and fail the hash. Only the sea's
      // own island carries it (shared/volcano.mjs); lib/fleet.mjs refuses it from anybody else.
      volcano: islandOf.volcano === true,
      name: strip(String(islandOf.name || cfg.islandName || 'an island'), 32) || 'an island',
      keeper: strip(String(keeper || (cfg.multiplayer && cfg.multiplayer.name) || 'Someone'), 24) || 'Someone',
      seed: islandOf.volcano === true && typeof islandOf.seed === 'string' && SLUG.test(islandOf.seed) ? islandOf.seed
        : Number.isFinite(Number(islandOf.seed)) ? Number(islandOf.seed) : Number(cfg.seed) || 0,
      gridSize: size,
      // How big it may grow, which the sea keeps free round its berth. Never less than it is.
      room: islandOf.room == null ? size : whole(islandOf.room, size, GRID_MAX, ctx),
      terrainHash: String(islandOf.terrainHash || ''),
      foundedAt: stamp(islandOf.foundedAt ?? cfg.foundedAt ?? null, ctx),
      landing: cellOrNull(islandOf.landing, ctx),
      harbours: list(islandOf.harbours, HARBOUR_SIDES.size, harbour, ctx, 'harbours'),
      town: town(islandOf.town, ctx),
      lattice: lattice(islandOf.lattice, ctx),
    },
    // The same number as island.gridSize, written twice because half the viewer reads one
    // name and half reads the other. parseBundle refuses a bundle where the two disagree
    // rather than picking a winner: the two would draw two different islands.
    grid: { size },
    districts,
    buildings,
    paths: list(shown.paths, CAPS.paths, path, ctx, 'paths'),
    bridges: list(shown.bridges, CAPS.bridges, bridge, ctx, 'bridges'),
    cleared: clearedCells(shown.cleared, ctx),
    polders: list(shown.polders, CAPS.polders, polder, ctx, 'polders'),
    fairway: fairway(shown.fairway, ctx),
    grow: growth(shown.grow, ctx),
    props: list(props, CAPS.props, prop, ctx, 'props'),
    crops: list(crops, CAPS.crops, crop, ctx, 'beds'),
    // Where each building actually stands, as opposed to which cells it was surveyed
    // onto. Two renderer-side nudges move a building by up to half a cell, and a
    // settler stands outside its own door - so without this the sea puts apprentices
    // inside their own sheds. lib/placements.mjs has the measurements and the why.
    // Absent until a browser has drawn this island once, which is fine: the sea falls
    // back to the surveyed centre and corrects itself the moment anybody looks.
    placements: placedAt(placements && placements.at, ctx, sailsAs),
    decks: deckMap(placements && placements.decks, ctx),
    // Where the work is - see workMap.
    work: workMap(placements && placements.work, ctx),
  };
}

// Where the buildings stand. A plain map of id to [x, z], rebuilt key by key like
// everything else here, and capped by the same number of buildings a bundle may carry. The
// coordinates are LOCAL - the island's own -half..+half - like every other position in a
// bundle, so a berth costs nothing to translate.
//
// `rename` is the whole of the asymmetry between the two sides, and it is a parameter
// rather than something done to the map before it gets here because the keys are the only
// part of this that differs: whichever side we are on, the values are still a pair of
// numbers checked the same way.
//
// PACKING. The keys arrive in this machine's own names - data/placements.json is written by
// our own page under `house:<uuid>` and stays that way, because it is the file this machine
// reads back, and a translation stored on disk would be a second copy of the redaction to
// keep in step. So they are renamed here, at the moment of packing, to the names the
// buildings sail under. Leaving them raw was two defects in one line. It put 101 session
// uuids on the wire inside the one object whose entire purpose is that they do not travel;
// and it broke the feature, because lib/crowd.mjs on the sea looks each settler up by
// `spec.id`, which is the redacted name, so the lookups missed and a hundred settlers stood
// on their surveyed plot centre - the exact thing placements were added to fix.
//
// UNPACKING. The keys arrived renamed already, so `rename` is null and this is the identity
// it always was. Translating twice is what would break `parseBundle(buildBundle(v))`
// deep-equalling `buildBundle(v)`; the rename runs exactly once, on the one side that knows
// both names.
//
// A key with no counterpart is dropped rather than passed through raw - it is a row for a
// building that is not in this bundle (a house demolished since the page last looked, or one
// the caps above left behind), and the sea has nothing to do with it but leak it. A civic
// building is not renamed at all: guestVillage finds no uuid in `civic:lighthouse`, so the
// table maps it to itself and the lighthouse keeps its placement unchanged.
function placedAt(raw, ctx, rename = null) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= CAPS.buildings) break;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const id = text(key, 200, ctx);
    if (!id) continue;
    const name = rename ? rename.get(id) : id;
    if (!name) continue;
    const at = raw[key];
    if (!Array.isArray(at) || at.length !== 2) continue;
    const x = coord(at[0], ctx);
    const z = coord(at[1], ctx);
    if (x === null || z === null) continue;
    out[name] = [x, z];
    n++;
  }
  return out;
}

// Where a road is carried over water, and how high. Keyed by the plain cell number the
// bridges and the quay are recorded under - this is one island's own map, so the plain
// key is unambiguous and the region strides do not come into it.
//
// It is the map that sits beside `placements` and it takes no `rename`, which is worth
// saying out loud because it is the obvious next place to look after the placements leak:
// a deck is keyed by ground, not by a building, and `Number.isInteger` below is already a
// stricter filter than any id check would be. Nothing that is not a cell on this island's
// own grid can get through it, so there is no name in here to redact and never was. Do not
// add one by keying a deck off the bridge that carries it.
function deckMap(raw, ctx) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const most = ctx.size * ctx.size;
  let n = 0;
  for (const key of Object.keys(raw)) {
    if (n >= 4096) break;
    const cell = Number(key);
    if (!Number.isInteger(cell) || cell < 0 || cell >= most) continue;
    const y = coord(raw[key], ctx);
    if (y === null) continue;
    out[cell] = y;
    n++;
  }
  return out;
}

// Where the island's settlers go to work when they have nothing else to do: the fields and
// the kitchen gardens as [gx, gz, w, d] cells, the edge of the wood as [x, z] in the local
// frame (Plans/inwoners-aan-het-werk.md). Only a renderer has planned any of it, so the
// keeper's page reports it beside the placements and it travels the same way.
//
// Like `decks` it takes no `rename`: it is keyed by ground, not by a building, and every
// entry is numbers checked against this island's own grid. Null rather than empty when
// nothing was reported, so the sea can tell a page that has never looked from a village
// with no fields in it - it makes no difference to the walk today, and it costs nothing.
// The same caps as lib/placements.mjs, written twice because the sea imports this file and
// that one reaches node:fs.
const WORK_CAPS = { fields: 400, gardens: 1500, trees: 500 };
function workMap(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rects = (list, cap) => {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const r of list) {
      if (out.length >= cap) break;
      if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isInteger)) continue;
      const [gx, gz, w, d] = r;
      if (w < 1 || d < 1 || w > 16 || d > 16) continue;
      if (gx < 0 || gz < 0 || gx + w > ctx.size || gz + d > ctx.size) continue;
      out.push([gx, gz, w, d]);
    }
    return out;
  };
  const trees = [];
  for (const t of Array.isArray(raw.trees) ? raw.trees : []) {
    if (trees.length >= WORK_CAPS.trees) break;
    if (!Array.isArray(t) || t.length !== 2) continue;
    const x = coord(t[0], ctx), z = coord(t[1], ctx);
    if (x === null || z === null) continue;
    trees.push([x, z]);
  }
  return { fields: rects(raw.fields, WORK_CAPS.fields), gardens: rects(raw.gardens, WORK_CAPS.gardens), trees };
}

// A position in an island's own frame. Half a grid either way plus a little slack, because
// a building on the outermost cell still has a width.
function coord(v, ctx) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const limit = ctx.size / 2 + 8;
  if (v < -limit || v > limit) return null;
  return Math.round(v * 1000) / 1000;
}

// ---- taking it apart again ----------------------------------------------------------

// `__proto__` and friends cannot reach an output object through the rebuilders above -
// every key they write is a literal in this file. This walk is the belt to that pair of
// braces: a bundle carrying one is a bundle written by somebody probing for a way in, and
// a refusal says so plainly instead of leaving them to find out by other means.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// An island is eight levels deep at its deepest (a district's lobe's parcel's rows), so
// sixteen is generous and still stops a body that is nothing but brackets.
const MAX_DEPTH = 16;
// Above anything a two-megabyte body can express: the densest JSON there is - arrays of
// one-digit numbers - runs to about three quarters of a million nodes in that space. The
// point of that choice is that this walk is never the guard that fires on a legitimate
// bundle; the caps are, and their refusals say which cap and by how much.
const MAX_NODES = 1000000;

function refuseDangerousKeys(node, state = { n: 0 }, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('this bundle is nested deeper than an island can be');
  if (++state.n > MAX_NODES) throw new Error('this bundle has more pieces in it than an island has');
  if (Array.isArray(node)) {
    for (const item of node) refuseDangerousKeys(item, state, depth + 1);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`a bundle carrying a "${key}" key is not a bundle`);
    refuseDangerousKeys(node[key], state, depth + 1);
  }
}

// A brand new island, built out of a whitelist, or nothing at all.
//
// `terrainHash` is an optimisation, not a switch: pass the hash if you have already built
// the terrain and do not want it built twice. Leave it out and this builds it, because
// the check is not optional. web/js/main.js only console.warns when the hash it recomputes
// disagrees with the one village.json claims, and on one machine that is right - the land
// is drawn from the same file either way. Here the two hashes come from two machines, and
// a mismatch means they are not running the same shared/terrain.mjs. The houses would
// then stand in the sea, so it is fatal.
// The sending half of a parcel, and it is not optional.
//
// The two contexts are not the same door. buildBundle packs with context(false), which
// fills a missing field in rather than refusing the whole prop - a prop in props.json has
// only what whoever built it happened to give it, and `scale` is usually not among them.
// parseParcel unpacks with context(true), which refuses. So raw props sent straight down
// the parcel door are refused with "a measurement arrived as something that is not a
// number", and the tree simply never appears on anybody else's island.
//
// It is the same asymmetry buildBundle and parseBundle have always had; it only became
// possible to get wrong when a second, smaller door was cut beside them.
export function packParcel({ props = [], crops = [], gridSize = 64 } = {}) {
  const ctx = context(false, Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(Number(gridSize) || 64))));
  return {
    props: list(props, CAPS.props, prop, ctx, 'props'),
    crops: list(crops, CAPS.crops, crop, ctx, 'beds'),
  };
}

// The two lists that change without the village changing: what somebody has put on the
// island, and what is growing in the beds. They are the only parts of a bundle that move
// between scans, which is why they get a door of their own - a jetty should not cost the
// 206 kB of a whole island, nor make every settler on it walk back to their own front
// door, which is what rebuilding a crowd does.
//
// Same whitelist as the bundle's own, same caps, same island size as the yardstick. It is
// a door in the hull and it is treated like one.
export function parseParcel(obj, { gridSize } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('that is not a parcel');
  refuseDangerousKeys(obj);
  const sized = context(true, GRID_MAX);
  const size = whole(gridSize, GRID_MIN, GRID_MAX, sized);
  const ctx = context(true, size);
  return {
    props: list(obj.props, CAPS.props, prop, ctx, 'props'),
    crops: list(obj.crops, CAPS.crops, crop, ctx, 'beds'),
  };
}

export function parseBundle(obj, { terrainHash = null } = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('that is not an island');
  refuseDangerousKeys(obj);
  if (obj.v !== BUNDLE_V) throw new Error(`this island speaks version ${JSON.stringify(obj.v)} and we speak ${BUNDLE_V}`);

  const raw = obj.island;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('an island without an island in it');

  // The size has to be settled before anything else: every cell below is checked against
  // it, so a bundle that lies about it would have its own lie used as the yardstick.
  const sized = context(true, GRID_MAX);
  const size = whole(raw.gridSize, GRID_MIN, GRID_MAX, sized);
  const grid = obj.grid && typeof obj.grid === 'object' && !Array.isArray(obj.grid) ? obj.grid : null;
  if (!grid) throw new Error('an island without a grid');
  if (whole(grid.size, GRID_MIN, GRID_MAX, sized) !== size) throw new Error('this island cannot agree with itself about how big it is');

  const ctx = context(true, size);

  if (typeof raw.id !== 'string' || !ISLAND_ID.test(raw.id)) throw new Error('that is not an island id');
  if (typeof raw.terrainHash !== 'string' || !TERRAIN_HASH.test(raw.terrainHash)) throw new Error('that is not a terrain hash');
  // A number, always - except on the volcano, whose seed is a word (shared/volcano.mjs). The
  // word is held to SLUG so it is still nothing but a short lowercase token, and it is only
  // allowed beside `volcano: true`: every ordinary island keeps the strict number it had.
  const volcano = raw.volcano === true;
  const seedOk = (typeof raw.seed === 'number' && Number.isFinite(raw.seed))
    || (volcano && typeof raw.seed === 'string' && SLUG.test(raw.seed));
  if (!seedOk) throw new Error('an island without a seed draws no land');

  const districts = list(obj.districts, CAPS.districts, district, ctx, 'districts');
  const buildings = linkSheds(resolveRefs(list(obj.buildings, CAPS.buildings, building, ctx, 'buildings'), districts));
  const polders = list(obj.polders, CAPS.polders, polder, ctx, 'polders');
  const channel = fairway(obj.fairway, ctx);
  const grow = growth(obj.grow, ctx);

  const bundle = {
    v: BUNDLE_V,
    island: {
      id: raw.id,
      hostile: raw.hostile === true,
      volcano,
      name: text(raw.name, 32, ctx) || 'an island',
      keeper: text(raw.keeper, 24, ctx) || 'Someone',
      seed: raw.seed,
      gridSize: size,
      // Absent from a bundle packed before islands grew, which then asks for no more room
      // than it takes up - exactly what the sea gave every island before this.
      room: raw.room === undefined ? size : whole(raw.room, size, GRID_MAX, ctx),
      terrainHash: raw.terrainHash,
      foundedAt: stamp(raw.foundedAt ?? null, ctx),
      landing: cellOrNull(raw.landing, ctx),
      harbours: list(raw.harbours, HARBOUR_SIDES.size, harbour, ctx, 'harbours'),
      town: town(raw.town, ctx),
      lattice: lattice(raw.lattice, ctx),
    },
    grid: { size },
    districts,
    buildings,
    paths: list(obj.paths, CAPS.paths, path, ctx, 'paths'),
    bridges: list(obj.bridges, CAPS.bridges, bridge, ctx, 'bridges'),
    cleared: clearedCells(obj.cleared, ctx),
    polders,
    fairway: channel,
    grow,
    props: list(obj.props, CAPS.props, prop, ctx, 'props'),
    crops: list(obj.crops, CAPS.crops, crop, ctx, 'beds'),
    placements: placedAt(obj.placements, ctx),
    decks: deckMap(obj.decks, ctx),
    work: workMap(obj.work, ctx),
  };

  const actual = terrainHash || makeTerrain(bundle.island.seed, { size, polders, fairway: channel, grow, volcano }).hash;
  if (actual !== bundle.island.terrainHash) {
    throw new Error(`this island says its land hashes to ${bundle.island.terrainHash} and here it hashes to ${actual}: the two machines are not running the same terrain`);
  }
  return bundle;
}

// ---- the Codex settlers -------------------------------------------------------------
//
// The third door in the hull, beside the bundle and the parcel: an islander's Codex
// settlers, for the sea to house on the volcano (POST /island/:id/codex, lib/residents.mjs,
// Plans/vulkaan-in-het-midden.md section 8). It used to be a whole second island per
// islander - a Codex village published under an id of its own - and all that is left of it
// on the wire is this: who, in what colours, in how big a house, and whether they are at
// work right now. Where the house stands is the sea's to decide, so no plot, no door and no
// layout travel, and nothing that came out of a conversation does either.
//
// The same two halves as a parcel, for the same reason. packCodex is the islander's and
// forgiving: it fills in what a village left out and drops what it cannot use. parseCodex is
// the sea's and strict, and stricter than parseParcel in one respect - a field it does not
// know is a refusal, not something quietly left behind, because every one of these five is
// named and there is nothing a newer islander could usefully add that an older sea should
// pretend it did not see.

const CODEX_KINDS = new Set(['house', 'shed']);
const CODEX_TIER_SET = new Set(CODEX_TIERS);
const CODEX_FIELDS = new Set(['id', 'style', 'tier', 'kind', 'active']);
// What a redacted id looks like: a kind, a colon, and guestVillage's counter - `house:s3`,
// `shed:s3:x7`. Forty characters after the kind is room for a shed's agent part and keeps
// `codex:<island>:<id>` inside ID's 120 for any island id there is.
const CODEX_ID = /^[a-z]+:[A-Za-z0-9:._-]{1,40}$/;
// Belt to guestVillage's braces: its blunt pass already renames every uuid it meets, so a
// settler id carrying the start of one did not come out of it and is not let in.
const UUID_START = /[0-9a-f]{8}-[0-9a-f]{4}-/i;

function codexEntry(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a Codex settler arrived that is not an object');
  if (ctx.strict) {
    for (const k of Object.keys(raw)) {
      if (!CODEX_FIELDS.has(k)) return ctx.bad(`a Codex settler arrived carrying "${k.slice(0, 24)}", which is not something one carries`);
    }
  }
  if (typeof raw.id !== 'string' || !CODEX_ID.test(raw.id) || UUID_START.test(raw.id)) {
    return ctx.bad('a Codex settler arrived without an id that is one');
  }
  const kind = !ctx.strict && raw.kind === undefined ? 'house' : oneOf(raw.kind, CODEX_KINDS, ctx, 'a Codex settler');
  if (kind === null) return null;
  let tier = raw.tier;
  if (typeof tier !== 'string' || !CODEX_TIER_SET.has(tier)) {
    if (ctx.strict) return ctx.bad(`"${String(tier).slice(0, 24)}" is not a house anybody can build`);
    tier = 'hut';
  }
  let style = slug(raw.style, ctx);
  if (style === null) {
    if (ctx.strict) return ctx.bad('a Codex settler arrived without a style');
    style = 'unknown';
  }
  if (ctx.strict && typeof raw.active !== 'boolean') return ctx.bad('whether a Codex settler is at work arrived as something other than yes or no');
  return { id: raw.id, style, tier, kind, active: raw.active === true };
}

// The islander's half: its Codex village, as the list it may send.
//
// Redacted by guestVillage, the same pass buildBundle runs, so a settler travels under the
// name it would have in a bundle (`house:s3`) and no session uuid, prompt, branch or path can
// reach the door - there is no second redaction to keep in step. Capped at PER_ISLANDER, the
// busiest first and then the most recently seen, so a keeper with a year of archived Codex
// sessions sends the ones anybody would recognise. Sorted by id afterwards so the list is
// the same bytes whenever the village is, and the caller can tell "unchanged" by hashing it.
export function packCodex({ village } = {}) {
  if (!village || typeof village !== 'object' || !Array.isArray(village.buildings)) return { settlers: [] };
  const shown = guestVillage(village);
  const ctx = context(false, GRID_MAX);
  const lives = (shown.buildings || []).filter((b) => b && (b.kind === 'house' || b.kind === 'shed'));
  const at = (b) => String(b.lastAt || b.startedAt || '');
  lives.sort((a, b) => (b.active === true) - (a.active === true)
    || (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const settlers = [];
  const seen = new Set();
  for (const b of lives) {
    if (settlers.length >= CODEX.PER_ISLANDER) break;
    const e = codexEntry({
      id: b.id,
      style: b.style,
      // An apprentice gets the smallest house there is: the volcano has no yards to put a
      // shed in, and a shed with no master is a shape buildings.js does not raise.
      tier: b.kind === 'shed' ? 'tent' : b.tier,
      kind: b.kind,
      active: b.active === true,
    }, ctx);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    settlers.push(e);
  }
  settlers.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { settlers };
}

// The sea's half. The whole list or nothing: over the cap, a duplicate, a field nobody named,
// a number where a word goes - each is a refusal of the lot, because a list that had to be
// repaired is one nobody can reason about afterwards. An empty list is a real statement: this
// islander has no Codex settlers (any more), and their houses come down.
export function parseCodex(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('that is not a list of Codex settlers');
  refuseDangerousKeys(obj);
  for (const k of Object.keys(obj)) {
    if (k !== 'settlers') throw new Error(`a list of Codex settlers carrying "${k.slice(0, 24)}" is not one`);
  }
  if (!Array.isArray(obj.settlers)) throw new Error('the Codex settlers arrived as something that is not a list');
  const ctx = context(true, GRID_MAX);
  const settlers = list(obj.settlers, CODEX.PER_ISLANDER, codexEntry, ctx, 'Codex settlers');
  const seen = new Set();
  for (const e of settlers) {
    if (seen.has(e.id)) throw new Error(`${e.id} arrived twice`);
    seen.add(e.id);
  }
  return { settlers };
}

// A Codex house, as a building in the volcano's bundle. Through the same rebuilder every
// other building on the sea went through, with the strict context, so a page cannot tell it
// from a building that arrived in a bundle - there is one shape of building, not two.
export function codexHouse({ id, style, tier, active = false, plot, door }, gridSize = VOLCANO.size) {
  return building({
    id, kind: 'house', style, tier, active, plot, door, ornaments: [],
  }, context(true, gridSize));
}

// The sea's own island, as a bundle like any other.
//
// Built here and put straight through parseBundle, so the volcano reaches /world,
// /island/:id and every page by exactly the door everybody else's island does, and is held
// to exactly the same whitelist - there is no second shape of bundle for a page to know.
// Almost nothing on it: no landing (so no dock and no boat - shared/quay.mjs derives both
// from the landing, and a bundle without one gets none), no harbours, no town. One building,
// the guardhouse (shared/volcano.mjs), and the bridges over the lava, at spots worked out
// from the ground so they are the same on every start; the guards who live in it are the crowd's (lib/crowd.mjs), not this
// bundle's, because their number changes while the bundle - and `rev` - never does.
//
// `terrain` is only so the caller that already built it does not build it twice; the hash
// is then taken from it rather than recomputed, which is parseBundle's own optimisation.
export function volcanoBundle(terrain = volcanoTerrain()) {
  const bridges = volcanoBridges(terrain);
  const decks = {};
  for (const b of bridges) for (const [gx, gz, y] of b.decks) decks[gx + gz * terrain.size] = y;
  return parseBundle({
    v: BUNDLE_V,
    island: {
      id: VOLCANO.id,
      hostile: VOLCANO.hostile,
      volcano: VOLCANO.volcano,
      name: VOLCANO.name,
      keeper: VOLCANO.keeper,
      seed: VOLCANO.seed,
      gridSize: VOLCANO.size,
      terrainHash: terrain.hash,
      foundedAt: null,
      landing: null,
      harbours: [],
      town: null,
      lattice: null,
    },
    grid: { size: VOLCANO.size },
    buildings: [guardhouseSpec(terrain)].filter(Boolean),
    // The crossings over the lava (shared/volcano.mjs volcanoBridges), as any island's
    // bridges travel: the run in `bridges`, what height each deck cell rides at in `decks`.
    // The decks are what the sea's crowd stands on and what lib/lava.mjs lets off.
    bridges: bridges.map(({ id, axis, cells }) => ({ id, axis, cells })),
    decks,
  }, { terrainHash: terrain.hash });
}
