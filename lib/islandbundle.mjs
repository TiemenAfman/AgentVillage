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
//   `buildBundle` and `parseBundle` share the same rebuilders. They differ only in what
//   they do when a value is wrong: the guest, whose own data this is, clamps and slices;
//   the host refuses. That is why `parseBundle(buildBundle(v))` deep-equals
//   `buildBundle(v)` - not because two lists of field names were kept in step by hand,
//   but because there is only one list.
//
// What deliberately does NOT travel: data/layout.json. The host needs nothing out of it
// (village.json already carries every plot, door, path, bridge, cleared cell and polder
// it would ask for), and by never sending it the host is structurally incapable of
// writing it back. layout.json is the one irreplaceable file under data/ - a house never
// moves - so the cheapest safety property in this whole design is that a visitor's
// upload contains no layout at all. Do not add one.
import crypto from 'node:crypto';
import os from 'node:os';
import { makeTerrain } from '../shared/terrain.mjs';
import { guestVillage } from './guestview.mjs';

export const BUNDLE_V = 1;

// The grid sizes this accepts, which are exactly the ones `parseBeacon` already accepts
// (lib/neighbours.mjs:64). A neighbour announcing a size over UDP and a neighbour handing
// over a whole island should not disagree about what an island can be.
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
  // One per quay, and an island has one quay. The room is for a visitor from a version
  // that dug more than we do, not for a visitor that means it.
  basins: 8,
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
// The beacon id, and the same pattern parseBeacon tests at lib/neighbours.mjs:62.
export const ISLAND_ID = /^[a-f0-9]{8,64}$/;

// The same two lines as `instanceId` in lib/neighbours.mjs:36, and they have to stay the
// same two lines: an island on the horizon and an island parked in a berth must be one
// island, or a visitor arrives as a stranger to the neighbour they were already drawn as.
// It is copied rather than imported because this branch does not own neighbours.mjs;
// serve.mjs passes `neighbours.me()` in when the beacon is running, so this is the
// fallback for an island with discovery switched off rather than the usual path.
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
// come from `text()` in lib/neighbours.mjs:40-55; the invisible ones come from `clean()`
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
  return { gx, gz, w, d, rot };
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
  // `quay` rides along because a visitor's harbour is decked the same way ours is, and a
  // field this rebuilder does not name simply does not arrive: without it every lane over
  // a guest's basin would arch while the same lane at home lies flat.
  return { id, axis, cells: cells(raw.cells, ctx, 'bridge cells'), quay: raw.quay === true };
}

// `cells` and `dike` are the two lists makeTerrain() reads to raise the ground
// (shared/terrain.mjs:242), so they decide the terrain hash and cannot be approximate.
// `road` is the causeway, which world.js keeps clear of trees. `supers` and `seed` are
// planning leftovers in super-cell coordinates that nothing draws, so they stay home.
function polder(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a polder arrived that is not an object');
  return {
    cells: cells(raw.cells, ctx, 'polder cells'),
    dike: cells(raw.dike, ctx, 'dike cells'),
    road: cells(raw.road, ctx, 'causeway cells'),
    unlockedAt: stamp(raw.unlockedAt, ctx),
  };
}

// A basin is the polder's opposite number: `cells` is the only list makeTerrain() reads to
// drop the ground (shared/terrain.mjs), so it decides the terrain hash and cannot be
// approximate. Nothing else about it is drawn, so nothing else travels - the id it carries
// at home is how the scanner knows it has already dug that quay, which is not the visitor's
// business.
function basin(raw, ctx) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a basin arrived that is not an object');
  return { cells: cells(raw.cells, ctx, 'basin cells') };
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

function town(raw, ctx) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ctx.bad('a town arrived that is not an object');
  return {
    square: cellOrNull(raw.square, ctx),
    centre: cellOrNull(raw.centre, ctx),
    lots: cells(raw.lots, ctx, 'civic lots'),
    paved: cells(raw.paved, ctx, 'paving'),
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
// than the config file does: serve.mjs hands over `neighbours.me()` (the live beacon id)
// and the name the island announces itself by. Without them this falls back to the
// config, which is what a test or a headless caller gets.
export function buildBundle({ config, village, props = [], crops = [], id = null, keeper = null } = {}) {
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
  const size = Math.min(GRID_MAX, Math.max(GRID_MIN, Math.round(Number(cfg.gridSize) || (village.grid && village.grid.size) || 64)));
  const ctx = context(false, size);

  // Unconditionally, and NOT behind config.multiplayer.guestView === 'full'. That setting
  // says who may LOOK at this island through this island's own server, where the keeper
  // can change their mind and the page reloads. It is not a licence to write raw session
  // titles, branch names and ticket summaries onto somebody else's disk, where they stay
  // until that somebody restarts a server they do not think of as holding your data.
  const shown = guestVillage(village);

  const districts = list(shown.districts, CAPS.districts, district, ctx, 'districts');
  const buildings = linkSheds(resolveRefs(list(shown.buildings, CAPS.buildings, building, ctx, 'buildings'), districts));

  const islandOf = shown.island || {};
  return {
    v: BUNDLE_V,
    island: {
      id: typeof id === 'string' && ISLAND_ID.test(id) ? id : beaconId(Math.round(Number(cfg.port) || 4747)),
      name: strip(String(islandOf.name || cfg.islandName || 'an island'), 32) || 'an island',
      keeper: strip(String(keeper || (cfg.multiplayer && cfg.multiplayer.name) || 'Someone'), 24) || 'Someone',
      seed: Number.isFinite(Number(islandOf.seed)) ? Number(islandOf.seed) : Number(cfg.seed) || 0,
      gridSize: size,
      terrainHash: String(islandOf.terrainHash || ''),
      foundedAt: stamp(islandOf.foundedAt ?? cfg.foundedAt ?? null, ctx),
      landing: cellOrNull(islandOf.landing, ctx),
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
    basins: list(shown.basins, CAPS.basins, basin, ctx, 'basins'),
    props: list(props, CAPS.props, prop, ctx, 'props'),
    crops: list(crops, CAPS.crops, crop, ctx, 'beds'),
  };
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
  if (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed)) throw new Error('an island without a seed draws no land');

  const districts = list(obj.districts, CAPS.districts, district, ctx, 'districts');
  const buildings = linkSheds(resolveRefs(list(obj.buildings, CAPS.buildings, building, ctx, 'buildings'), districts));
  const polders = list(obj.polders, CAPS.polders, polder, ctx, 'polders');
  const basins = list(obj.basins, CAPS.basins, basin, ctx, 'basins');

  const bundle = {
    v: BUNDLE_V,
    island: {
      id: raw.id,
      name: text(raw.name, 32, ctx) || 'an island',
      keeper: text(raw.keeper, 24, ctx) || 'Someone',
      seed: raw.seed,
      gridSize: size,
      terrainHash: raw.terrainHash,
      foundedAt: stamp(raw.foundedAt ?? null, ctx),
      landing: cellOrNull(raw.landing, ctx),
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
    basins,
    props: list(obj.props, CAPS.props, prop, ctx, 'props'),
    crops: list(obj.crops, CAPS.crops, crop, ctx, 'beds'),
  };

  const actual = terrainHash || makeTerrain(bundle.island.seed, { size, polders, basins }).hash;
  if (actual !== bundle.island.terrainHash) {
    throw new Error(`this island says its land hashes to ${bundle.island.terrainHash} and here it hashes to ${actual}: the two machines are not running the same terrain`);
  }
  return bundle;
}
