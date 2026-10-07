// What a Blender model set is allowed to be, as numbers rather than as good intentions.
//
// `npm run models` checks every set against this the moment Blender has written it, and
// tests/models.test.mjs checks the same rules against the files committed here, so a
// .blend that outgrows its budget or invents a sheet cannot reach the island quietly.
// The prose behind these numbers - why the axes are what they are, what a slot means,
// how much room a yard has - is assets/README.md.
//
// One table, two readers, and no third copy: the exporter bakes without an opinion, and
// everything that could be wrong about the result is decided here.

// A material's name prefix says which of the island's texture sheets a face is drawn on,
// and these are the ids buildings.js already carries on the vertex (see SHEET there).
// `plain` is the default and the commonest: glass, ironwork, cloth and every small
// painted thing read better flat.
export const SHEETS = { plain: 0, wall: 1, roof: 2, stone: 3, plank: 4, plankZ: 5, ground: 6 };

// And two sheets no building is drawn on. A building has one material and carries the
// sheet as a number on the vertex; the forest cannot, because bark and needles have to
// be two materials with a texture each for an InstancedMesh to draw a trunk and a canopy
// off one geometry. So a flora material names one of these instead of a building sheet,
// and grouped() in web/js/models.js turns them into the geometry groups the material
// array lines up with. They are deliberately not in SHEETS: there is no vertex id for
// them, and a building part that asked for one would get `plain` and no explanation.
export const CANOPY = ['bark', 'foliage'];

// Every sheet a baked material may name, which is the union and not either half: the
// bake (scripts/export-models.py) and this file have to agree to the letter, or a .blend
// bakes clean and then fails its own check.
export const isSheet = (name) => name in SHEETS || CANOPY.includes(name);
export const sheetNames = () => [...Object.keys(SHEETS), ...CANOPY];

// Empties named `anchor.<name>` become the anchors main.js hangs smoke, flags and signs
// on. A name nothing reads is a typo rather than a feature. `waterline` is a ship's draught
// (scripts/build-batavia.py): she is modelled keel on the ground like everything else, and
// this is the one number the island lowers her by.
export const ANCHORS = ['smoke', 'flag', 'door', 'sign', 'waterline'];
// And what a ship measures of herself, for whoever walks or sails her later rather than for
// anything that hangs on her now: `deck.<name>.lo|hi`, opposite corners of a rectangle of
// planking at its height; `stair.<name>.lo|hi`, a ladder running fore and aft, `lo` the
// corner at its foot on the floor it starts from and `hi` the opposite corner at its head
// on the floor it reaches; and `mast.<name>`, where a mast stands. Corners come in pairs -
// checkSet refuses half of one - because a rectangle is the thing being carried, and an
// empty can only carry a point.
export const SHIP_ANCHOR = /^(?:(?:deck|stair)\.[a-z]+(?:-[a-z]+)*\.(?:lo|hi)|mast\.[a-z]+)$/;
// A building walked on (the Salty Kraken's stair, web/js/buildings.js pirateSurfaces/pirateSolids)
// uses the ship's deck and stair corners for its floors, and two more: `rail.<n>.a|b`, the two
// ends of one straight run of rail on the floor under it, and `solid.<name>.lo|hi`, opposite
// corners of a box walk mode may not enter, and `climb.<name>.lo|hi`, a rope ladder that is climbed
// rather than walked: `lo` where a climber stands at its foot, `hi` where they step off at its head,
// the way from one to the other along the ground being the way they face it (walk.js). All three come
// in pairs like the rest.
export const WALKED_ANCHOR = /^(?:rail\.[0-9]+\.(?:a|b)|(?:solid|climb)\.[a-z]+\.(?:lo|hi))$/;
export const isAnchor = (name) => ANCHORS.includes(name) || SHIP_ANCHOR.test(name) || WALKED_ANCHOR.test(name);
const PAIRED = /^((?:deck|stair|solid|climb|rail)\..+)\.(lo|hi|a|b)$/;
const OTHER_END = { lo: 'hi', hi: 'lo', a: 'b', b: 'a' };

// What an asset is for, taken from its name. A collection in a .blend has to start with
// one of these, so the budget below can be found without anyone writing it down twice.
export const CLASSES = ['house_', 'roof_', 'addon_', 'prop_', 'civic_', 'flora_', 'fauna_'];

// Triangles per asset, longest prefix first. The cost of a shape is not its own size but
// how often the island draws it: a rock is instanced by the thousand and a tavern stands
// once, so the rock gets forty triangles and the tavern gets everything left over.
export const BUDGETS = [
  ['flora_rock', 40],
  // A bush is a tree's cost with none of a tree's presence: it is undergrowth, seen for
  // a moment at the edge of a wood, and there are thousands of it. Forty is what a rock
  // gets for the same reason.
  ['flora_bush', 40],
  // A palm is not forest: it stands on the unclaimable islets (Plans/DONE/starter-eilanden.md),
  // one to a sandbank and a handful to a round one, never twenty thousand to a canopy. A
  // crown of fronds is also a shape sixty triangles cannot draw - five fronds at a dozen
  // each is the whole budget with no trunk. At 250 the fronds lost their serrated edges and
  // their fold, and it no longer looked like the model it came from; at 1000 the two cannot be
  // told apart. Twenty palms in reach, shadow pass included, is 40k - a fifth of the houses.
  // The `_lo` (250) is for the phone and the far ones.
  ['flora_palm', 1000],
  ['flora_', 60],
  ['prop_', 120],
  ['addon_', 150],
  ['roof_', 300],
  ['house_', 600],
  // The Salty Kraken's kit (scripts/build-krakenkit.py): the ship's parts its hall is furnished
  // with - a stern for a back bar, a mast, a hull for a counter. Each stands once, in a room drawn
  // with nobody's island in the scene and only while somebody is inside, looked at from a stool's
  // distance: the keeper's call (30 September 2026) was that indoors the triangle count must not
  // be what limits the design, so this is a ceiling against a runaway bake, not a budget to design to.
  ['civic_kraken_', 40000],
  ['civic_', 1500],
  // An animal: a horse in its paddock, a few sheep on a field, hens by a hut. Tens of them at
  // most - thirty at a thousand is 30k, under what the three hundred houses cost - each in a
  // handful of parts that move (body, head, tail, four legs), and never instanced. The animals
  // made from a picture (scripts/build-fauna.py) need the room: at 500 a cow's legs were sticks.
  // The rideable horse is inspected beside the player: closed joint rings, smooth head and tack.
  // 6500 since it got its anatomy (scripts/horse-model.py: muscle masses, a full mane and a tail
  // of strands, nostrils, chestnuts, feathering): ~6400 from ~3900. It is drawn once per rider and
  // per stable, skinned, in its ~7 draw calls - the triangles are the cheap part of it.
  ['fauna_horse', 6500],
  ['fauna_', 1200],
];

// A whole .blend authored as one building is a hero asset: it is drawn a handful of times
// at most and is worth looking at up close. The tavern sits at 2684 of these, and the
// ceiling is where tests/tavern.test.mjs already put it - bounded enough for a modest GPU.
export const HERO_BUDGET = 4000;
// Heroes allowed more. The pirate ship is a whole galleon a settler walks the deck of, one
// draw call, and a handful of them in the world at most. 14k was first chosen by eye against the
// source's 73k; the plank deck, the round cannon bores, the carriage wheels and the rigging
// kept since (scripts/build-pirateship.py, docs/galleon-render-inspection.md) come to about
// 29.8k, so the ceiling is 30k - still one mesh. The Batavia is the ship the village earns, up to
// three of her on the roads (civic:ship, :2, :3), modelled from nothing in
// scripts/build-batavia.py rather than decimated from a download, so she needs far less than
// the galleon for more ship: she came out near 6200, and 8000 leaves room for a boat on her
// waist, not for a second hull.
// The Salty Kraken is a galleon run aground on a rock, whole, with its stern castle, rigging, rock
// and stair (scripts/build-piratetavern.py). The ordinary 4000 was the old timber inn's; the keeper
// asked for render 17 built literally, at about 80k (a first design came to 13k, an HD one to 56k):
// every plank edge and bolt the picture shows has to be a triangle, since a building here has no
// texture of its own. 95k is a guard against a bake running away, not a target. It is one instance
// in each island's batch, so it costs triangles and no draw call - but it is drawn on every island
// that has reached rung 52.
// The Salty Kraken's hall (scripts/build-piratetavern-room.py): a whole cave tavern with two storeys
// and all its dressing, drawn only while somebody is inside and with nobody's island in the scene.
// The keeper's call was that indoors the triangle count must not limit the design; this is a ceiling
// against a runaway bake, not a budget.
export const HERO_BUDGETS = { pirateship: 30000, batavia: 8000, piratetavern: 95000, piratetavern_room: 400000 };

const GROUND = 0.002;      // how far off the ground an origin may sit before it is wrong
const CENTRED = 0.2;       // and how far off centre a prop or a plant may stand

export function budgetOf(asset, hero) {
  if (asset === hero) return HERO_BUDGETS[hero] ?? HERO_BUDGET;
  for (const [prefix, tris] of BUDGETS) if (asset.startsWith(prefix)) return tris;
  return null;             // not a class the island knows; checkSet says so
}

const trisOf = (part) => part.positions.length / 9;

// The box an asset stands in, in the set's own space: a part's triangles are stored
// around its own origin and `at` is where Blender had that origin.
function boxOf(data, names) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const name of names) {
    const part = data.parts[name];
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = part.positions[i + k] + part.at[k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
  }
  return { lo, hi };
}

// The assets of a set, whether it names them or is one itself. A .blend with no asset
// collections is a single hero asset called after the set, which is what the tavern is.
export function assetsOf(set, data) {
  if (data.assets) return data.assets;
  return { [set]: { parts: Object.keys(data.parts), anchors: data.anchors || {} } };
}

// Everything that could be wrong with one baked set, as sentences a person can act on.
// An empty list means the set may be committed.
export function checkSet(set, data) {
  const bad = [];
  if (!data || typeof data !== 'object') return [`${set}: not a baked set`];
  if (!data.parts || !Object.keys(data.parts).length) return [`${set}: no parts at all`];
  if (!(data.height > 0)) bad.push(`${set}: building_height is ${data.height}, which is not a height`);

  for (const [name, part] of Object.entries(data.parts)) {
    const where = `${set}/${name}`;
    if (!isSheet(part.sheet)) bad.push(`${where}: sheet "${part.sheet}" is not one of ${sheetNames().join(', ')}`);
    if (!Array.isArray(part.positions) || part.positions.length % 9) bad.push(`${where}: ${part.positions?.length} position numbers is not whole triangles`);
    if (part.colors.length !== part.positions.length) bad.push(`${where}: ${part.colors.length} colour numbers for ${part.positions.length} positions`);
    if (!Array.isArray(part.at) || part.at.length !== 3) bad.push(`${where}: no origin`);
    if (!part.positions.every(Number.isFinite) || !part.colors.every(Number.isFinite)) bad.push(`${where}: a number that is not a number`);
    if (part.emissive !== 0 && part.emissive !== 1) bad.push(`${where}: emissive is ${part.emissive}, and it is a switch`);
  }

  const assets = assetsOf(set, data);
  const hero = data.assets ? null : set;
  for (const [asset, info] of Object.entries(assets)) {
    const names = info.parts.filter((n) => data.parts[n]);
    for (const n of info.parts) if (!data.parts[n]) bad.push(`${set}/${asset}: names a part "${n}" that was not baked`);
    if (!names.length) { bad.push(`${set}/${asset}: no parts`); continue; }

    const budget = budgetOf(asset, hero);
    const tris = names.reduce((sum, n) => sum + trisOf(data.parts[n]), 0);
    if (budget === null) bad.push(`${set}/${asset}: "${asset}" starts with none of ${CLASSES.join(', ')}, so it has no budget`);
    else if (tris > budget) bad.push(`${set}/${asset}: ${tris} triangles over a budget of ${budget}`);

    // The island stands a model on the ground and the ground is y = 0. A model modelled
    // around its own middle sinks half of itself into the grass, and one modelled above
    // the floor of the Blender scene hovers - both only visible once it is on the island,
    // which is exactly too late.
    const { lo, hi } = boxOf(data, names);
    if (Math.abs(lo[1]) > GROUND) bad.push(`${set}/${asset}: sits ${lo[1].toFixed(3)} off the ground, not on it`);
    if (asset.startsWith('prop_') || asset.startsWith('flora_') || asset.startsWith('fauna_')) {
      for (const [k, axis] of [[0, 'x'], [2, 'z']]) {
        const middle = (lo[k] + hi[k]) / 2;
        if (Math.abs(middle) > CENTRED) bad.push(`${set}/${asset}: its middle is ${middle.toFixed(3)} off the ${axis} origin, and props are placed by their middle`);
      }
    }
    const anchors = info.anchors || {};
    for (const name of Object.keys(anchors)) {
      if (!isAnchor(name)) bad.push(`${set}/${asset}: anchor.${name} is not one of ${ANCHORS.join(', ')}, nor a ship's deck.<name>.lo|hi, stair.<name>.lo|hi or mast.<name>, nor a walked building's rail.<n>.a|b, solid.<name>.lo|hi or climb.<name>.lo|hi`);
      const pair = PAIRED.exec(name);
      if (pair && !(`${pair[1]}.${OTHER_END[pair[2]]}` in anchors)) bad.push(`${set}/${asset}: anchor.${name} is one corner of ${pair[1]} and the other is missing`);
    }
  }
  return bad;
}

// And the one thing no single set can see: two sets that both call a part `Barrel`. The
// register in web/js/models.js is flat, because a call site wants to say mesh('Barrel')
// and not remember which .blend it came out of.
export function checkAll(sets) {
  const bad = [];
  const seen = new Map();
  for (const [set, data] of Object.entries(sets)) {
    bad.push(...checkSet(set, data));
    for (const name of Object.keys(data?.parts || {})) {
      if (seen.has(name)) bad.push(`${set}/${name}: ${seen.get(name)} already baked a part with that name`);
      else seen.set(name, set);
    }
  }
  return bad;
}

// One line per set for the console: what came out, and how much of its budget it used.
export function describeSet(set, data) {
  const assets = assetsOf(set, data);
  const hero = data.assets ? null : set;
  const parts = Object.keys(data.parts).length;
  const tris = Object.values(data.parts).reduce((sum, p) => sum + trisOf(p), 0);
  const each = Object.entries(assets).map(([asset, info]) => {
    const used = info.parts.filter((n) => data.parts[n]).reduce((sum, n) => sum + trisOf(data.parts[n]), 0);
    const budget = budgetOf(asset, hero);
    return `${asset} ${used}/${budget ?? '?'}`;
  });
  return `${set}: ${parts} parts, ${tris} triangles — ${each.join(', ')}`;
}
