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
import * as THREE from 'three';
import { GOLDPIT } from './goldpit-mesh.js';
import { LIGHTHOUSE } from './lighthouse-mesh.js';
import { CLOCKTOWER } from './clocktower-mesh.js';
import { STATUE } from './statue-mesh.js';
import { CASTLE } from './castle-mesh.js';
import { GREATCASTLE } from './greatcastle-mesh.js';
import { TAVERN } from './tavern-mesh.js';
import { COTTAGE } from './cottage-mesh.js';
import { HOUSE } from './house-mesh.js';
import { MANOR } from './manor-mesh.js';
import { HUT } from './hut-mesh.js';
import { WINDMILL } from './windmill-mesh.js';
import { SCHOOL } from './school-mesh.js';
import { TOWNHALL } from './townhall-mesh.js';
import { PROPS } from './props-mesh.js';
import { VILLAGE } from './village-mesh.js';
import { FLORA } from './flora-mesh.js';
import { RAIL } from './rail-mesh.js';
import { FENCE } from './fence-mesh.js';
import { HEDGE } from './hedge-mesh.js';
import { WALL } from './wall-mesh.js';
import { DOCKS } from './docks-mesh.js';
import { BOARDWALK } from './boardwalk-mesh.js';
import { QUAYSTEPS } from './quaysteps-mesh.js';
import { BUOYS } from './buoys-mesh.js';
import { BENCHY } from './benchy-mesh.js';
import { BICYCLE } from './bicycle-mesh.js';
import { SAWMILL } from './sawmill-mesh.js';
import { SMITHY } from './smithy-mesh.js';
import { FAUNA } from './fauna-mesh.js';
import { STABLE } from './stable-mesh.js';
import { FARMYARD } from './farmyard-mesh.js';
import { BAKERY } from './bakery-mesh.js';

const SETS = { goldpit: GOLDPIT, windmill: WINDMILL, boardwalk: BOARDWALK, quaysteps: QUAYSTEPS, manor: MANOR, house: HOUSE, cottage: COTTAGE, hut: HUT, school: SCHOOL, tavern: TAVERN, townhall: TOWNHALL, props: PROPS, village: VILLAGE, flora: FLORA, rail: RAIL, fence: FENCE, hedge: HEDGE, wall: WALL, docks: DOCKS, benchy: BENCHY, bicycle: BICYCLE, buoys: BUOYS, castle: CASTLE, greatcastle: GREATCASTLE, lighthouse: LIGHTHOUSE, clocktower: CLOCKTOWER, statue: STATUE, sawmill: SAWMILL, smithy: SMITHY, fauna: FAUNA, stable: STABLE, farmyard: FARMYARD, bakery: BAKERY };

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
// One asset as a single geometry with one material group per slot, in the order asked
// for. This is the other way a baked shape reaches the island, and it exists for exactly
// one caller: an InstancedMesh of twenty thousand trees, drawn with a material array so
// that bark takes the bark sheet and needles take the foliage one.
//
//   grouped('flora_pine_a', ['bark', 'foliage'])   ->  group 0 trunk, group 1 canopy
//
// A building goes the other way - mesh() in buildings.js, one material, the sheet as a
// number on the vertex - because a building is merged into the island's one geometry and
// a group there would be a draw call per part. A tree is its own mesh already, so the
// groups are free and the two textures are what a pine needs to look like a pine.
//
// A slot with nothing in it still gets a group, an empty one, so that the caller's
// material array keeps lining up whatever a .blend happens to hold: a rock is asked for
// with `['plain']` and a bush has no bark, and neither should have to know.
export function grouped(name, slots) {
  const parts = assetParts(name).map((n) => ({ name: n, ...part(n) }));
  if (!parts.length) return null;
  const order = slots.map((slot) => parts.filter((p) => p.sheet === slot));
  const missed = parts.filter((p) => !slots.includes(p.sheet));
  if (missed.length) console.warn(`[island] ${name}: ${missed.map((p) => p.name).join(', ')} on no slot of ${slots.join('+')}`);

  const total = order.flat().reduce((n, p) => n + p.positions.length, 0);
  const position = new Float32Array(total);
  const color = new Float32Array(total);
  const geometry = new THREE.BufferGeometry();
  let at = 0;
  for (const group of order) {
    const start = at;
    for (const p of group) {
      // Blender stored each part's triangles around its own origin, so putting the asset
      // back together means adding that origin back: a canopy is modelled where it grew,
      // a metre above the foot of the trunk.
      for (let i = 0; i < p.positions.length; i += 3) {
        position[at + i] = p.positions[i] + p.at[0];
        position[at + i + 1] = p.positions[i + 1] + p.at[1];
        position[at + i + 2] = p.positions[i + 2] + p.at[2];
      }
      color.set(p.colors, at);
      at += p.positions.length;
    }
    geometry.addGroup(start / 3, (at - start) / 3, geometry.groups.length);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('uv', project(position));
  // Flat, off the winding, the way merge() does it for the shapes world.js still builds
  // by hand. The exporter writes no normals at all and this is why it does not have to.
  geometry.computeVertexNormals();
  return geometry;
}

// Where a baked plant's texture lands. Decided here because Blender exports no UVs, and
// on purpose: an unwrapped model is one less thing that can be wrong in a .blend, and
// the sheets a plant wears are seamless grain - bark and needles - rather than a picture
// of anything that would need laying out by hand.
//
// So each triangle is projected flat, down whichever axis it faces most: the side of a
// trunk off the x or z plane, the underside of a bough off the y one. The same triplanar
// trick buildings.js plays with its four sheets, and the reason it is per triangle rather
// than one wrap round the y axis is the cap. A cylindrical u runs 0 to 1 round the tree,
// which is fine for the sides and impossible for the n-gon closing the bottom of a
// skirt: that face spans every angle at once, so its three corners are a third of a turn
// apart and no amount of shifting the seam makes them adjacent. Projected flat it is an
// ordinary hexagon of bark, which is what it looks like.
//
// The coordinates are the island's own units - a cell is one unit and four metres - so
// `tex.repeat` in world.js decides the grain in the same terms it does everywhere else.
function project(position) {
  const n = position.length / 3;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const [ax, ay, az] = [position[t * 3], position[t * 3 + 1], position[t * 3 + 2]];
    const [bx, by, bz] = [position[(t + 1) * 3], position[(t + 1) * 3 + 1], position[(t + 1) * 3 + 2]];
    const [cx, cy, cz] = [position[(t + 2) * 3], position[(t + 2) * 3 + 1], position[(t + 2) * 3 + 2]];
    // The face normal, unnormalised: only which component is biggest matters.
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const [mx, my, mz] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    // Which pair of axes to read the triangle off. Ties go to the upright projections,
    // because a triangle with no dominant axis at all is a sliver and the choice is moot.
    const plane = my > mx && my > mz ? 1 : (mx > mz ? 0 : 2);
    const pick = (x, y, z) => (plane === 1 ? [x, z] : plane === 0 ? [z, y] : [x, y]);
    for (const [k, p] of [[0, pick(ax, ay, az)], [1, pick(bx, by, bz)], [2, pick(cx, cy, cz)]]) {
      uv[(t + k) * 2] = p[0];
      uv[(t + k) * 2 + 1] = p[1];
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}

export const assetNames = () => [...assets.keys()];
// Every variant of one shape, in a fixed order: `variants('roof_gable')` answers
// `['roof_gable_a', 'roof_gable_b']`, which is what a caller hands to rng.pick(). Asking
// by prefix rather than by name is what lets a third gable be modelled tomorrow and be in
// the island's rotation the moment it is baked, with no line changed here or at the call
// site. Sorted, because the pick has to be the same pick on every machine: the register's
// insertion order follows whatever order Blender happened to have the collections in, and
// a house that reroofs itself when someone renames an object is not deterministic.
export const variants = (prefix) => [...assets.keys()].filter((n) => n.startsWith(prefix)).sort();
export const assetSet = (name) => (assets.get(name) || {}).set || null;
export const assetTris = (name) => assetParts(name).reduce((n, p) => n + part(p).positions.length / 9, 0);
export const setNames = () => Object.keys(SETS);





