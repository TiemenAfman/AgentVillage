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
// on. A name nothing reads is a typo rather than a feature.
export const ANCHORS = ['smoke', 'flag', 'door', 'sign'];

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
  ['flora_', 60],
  ['prop_', 120],
  ['addon_', 150],
  ['roof_', 300],
  ['house_', 600],
  ['civic_', 1500],
  // An animal: a horse in its paddock, a few sheep on a field, hens by a hut. Tens of them at
  // most - thirty at a thousand is 30k, under what the three hundred houses cost - each in a
  // handful of parts that move (body, head, tail, four legs), and never instanced. The animals
  // made from a picture (scripts/build-fauna.py) need the room: at 500 a cow's legs were sticks.
  ['fauna_', 1200],
];

// A whole .blend authored as one building is a hero asset: it is drawn a handful of times
// at most and is worth looking at up close. The tavern sits at 2684 of these, and the
// ceiling is where tests/tavern.test.mjs already put it - bounded enough for a modest GPU.
export const HERO_BUDGET = 4000;

const GROUND = 0.002;      // how far off the ground an origin may sit before it is wrong
const CENTRED = 0.2;       // and how far off centre a prop or a plant may stand

export function budgetOf(asset, hero) {
  if (asset === hero) return HERO_BUDGET;
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
    for (const name of Object.keys(info.anchors || {})) {
      if (!ANCHORS.includes(name)) bad.push(`${set}/${asset}: anchor.${name} is not one of ${ANCHORS.join(', ')}`);
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
