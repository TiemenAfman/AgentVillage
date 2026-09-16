// Every shape Blender has baked for the island, in one register.
//
// A set is one .blend - assets/tavern, assets/props - baked by `npm run models` into a
// plain module of triangles, vertex colours and a sheet tag per part. This file puts them
// all behind one name, so `mesh('prop_barrel staves')` in buildings.js does not have to
// know which .blend that came out of, and so adding a set is one import here and nothing
// anywhere else.
//
// It is deliberately synchronous and deliberately dull. The baked modules are ordinary
// imports, which means the shapes are there before the first line of main.js runs: there
// is nothing to await on the boot path, nothing to fall back to while a loader works, and
// no chance of the island drawing itself once with placeholders and again with the real
// thing. That is the whole argument for baking rather than fetching a .glb, and it is the
// same route the settlers and the villagers already take.
//
// Adding a set: bake it, import it here, put it in SETS. Everything else - the workbench,
// the model sheet, the shape catalogue - reads it through this file.
import { TAVERN } from './tavern-mesh.js';
import { PROPS } from './props-mesh.js';

const SETS = { tavern: TAVERN, props: PROPS };

// name -> the part, flattened across sets. `npm run models` refuses two sets that use one
// name, so the flattening cannot quietly lose a shape; the warning below is for the
// moment between baking a clash and running the check.
const parts = new Map();
// asset -> { set, parts: [name], anchors }
const assets = new Map();

for (const [set, data] of Object.entries(SETS)) {
  for (const [name, part] of Object.entries(data.parts)) {
    if (parts.has(name)) console.warn(`[island] two baked sets call a part "${name}"; ${parts.get(name).set} keeps it`);
    else parts.set(name, { set, part });
  }
  // A .blend that names no assets is one asset: the tavern is a single building and every
  // part of it belongs to that building.
  const named = data.assets || { [set]: { parts: Object.keys(data.parts), anchors: data.anchors || {} } };
  for (const [name, info] of Object.entries(named)) {
    assets.set(name, { set, parts: info.parts, anchors: info.anchors || {} });
  }
}

export const has = (name) => parts.has(name);
export function part(name) {
  const found = parts.get(name);
  return found ? found.part : null;
}
export const setOf = (name) => (parts.get(name) || {}).set || null;

// What an asset is made of, in the order Blender had it. An unknown asset is an empty
// list rather than an error: a caller that wants to know asks hasAsset first, and one
// that does not gets nothing drawn instead of a broken island.
export const hasAsset = (name) => assets.has(name);
export const assetParts = (name) => (assets.get(name) || { parts: [] }).parts;
export const anchorsOf = (name) => (assets.get(name) || { anchors: {} }).anchors;
export const heightOf = (name) => (SETS[(assets.get(name) || {}).set] || {}).height || 0;

// Every asset there is, for the model sheet and for anything else that wants to lay the
// whole catalogue out rather than ask for one shape by name. The triangle count is the
// same sum scripts/model-rules.mjs holds an asset to, so the sheet can say what a shape
// costs beside the shape itself.
export const assetNames = () => [...assets.keys()];
export const assetSet = (name) => (assets.get(name) || {}).set || null;
export const assetTris = (name) => assetParts(name).reduce((n, p) => n + part(p).positions.length / 9, 0);
export const setNames = () => Object.keys(SETS);
