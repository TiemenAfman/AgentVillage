// The model sheet: every object the island can draw, laid out on one field so a shape
// can be judged and tuned without hunting for one on the map. Nothing here reads the
// village; it builds specs by hand, which is also the quickest way to see a piece that
// no village has unlocked yet.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createBuildingMaterial, buildBuilding, buildBladesGeometry, buildPlaqueGeometry,
  buildBridgeGeometry, PALETTE, TIER_LABEL, WALK_CLEARANCE, WALK_BODY_R,
} from './buildings.js';
import { figureGeometry } from './settlers.js';
import { createNameplate } from './nameplate.js';
import { buildBorders, buildFieldDecals, orchardTrees, variantOf, NONE } from './hamlets.js';

const CIVIC = [
  ['townhall', 'Town hall', '1st settler'],
  ['board', 'Sprint board', 'always'],
  ['well', 'Well', '5 settlers'],
  ['market', 'Market stalls', '10'],
  ['tavern', 'Tavern', '15'],
  ['clocktower', 'Clock tower', '20'],
  ['tables', 'Tables', '25'],
  ['school', 'School', '25 apprentices'],
  ['windmill', 'Windmill', '30'],
  ['chapel', 'Chapel', '40'],
  ['fountain', 'Fountain', '45'],
  ['lighthouse', 'Lighthouse', '50'],
  ['statue', 'Statue', '70'],
  ['castle', 'Castle', '100'],
  ['poldermill', 'Polder mill', 'never yet'],
];

const FURNITURE = [
  ['planter', 'Flower bed', 'per 30 appr.'],
  ['lamp', 'Street lamp', 'per 45'],
  ['bench', 'Bench', 'per 60'],
  ['terrace', 'Terrace', 'per 110'],
];

const TIERS = ['tent', 'hut', 'cottage', 'house', 'manor', 'keep'];
const STYLES = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'];
const SHEDS = ['explore', 'plan', 'general', 'guide', 'other'];
const ORNAMENTS = [
  ['forge', 'heavy shell use'],
  ['lumber', 'lots of edits'],
  ['lantern', 'reading, searching'],
  ['weathervane', 'drove a browser'],
  ['pigeons', 'fetched the web'],
  ['banner', 'published an artifact'],
  ['lightningrod', 'repeated API errors'],
];

const PITCH = 3.6;                 // spacing between items on the field
const ROW = 5.0;                   // spacing between rows

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.2, 500);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, minDistance: 3, maxDistance: 120, maxPolarAngle: 1.45 });

const material = createBuildingMaterial();
const uniforms = material.userData.uniforms;

// ---- the field ---------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x8fae5a, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(200, 200 / PITCH * 2, 0x2f3d22, 0x2f3d22);
grid.position.y = 0.01;
grid.material.opacity = 0.25;
grid.material.transparent = true;
grid.visible = false;
scene.add(grid);

// The hitboxes walk mode actually blocks on, drawn where the shape stands. Amber is
// the solid part -- everything low enough to bump into, roofs and bell towers left out
// because you walk under them. Red is the line the player's middle stops at: the same
// box grown by half a settler. If something on the island cannot be walked past, this
// is the view that says why.
const hitboxes = new THREE.Group();
hitboxes.visible = false;
scene.add(hitboxes);

const solidLine = new THREE.LineBasicMaterial({ color: 0xffc247 });
const reachLine = new THREE.LineBasicMaterial({ color: 0xff5c4d, transparent: true, opacity: 0.6 });
const cubeEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
const ring = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
  [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3,
));

function drawHitbox(built, x, z) {
  for (const r of built.solids) {
    const solid = new THREE.LineSegments(cubeEdges, solidLine);
    solid.position.set(x + r.x, WALK_CLEARANCE / 2, z + r.z);
    solid.scale.set(Math.max(r.hx * 2, 0.004), WALK_CLEARANCE, Math.max(r.hz * 2, 0.004));
    const reach = new THREE.LineLoop(ring, reachLine);
    reach.position.set(x + r.x, 0.02, z + r.z);
    reach.scale.set((r.hx + WALK_BODY_R) * 2, 1, (r.hz + WALK_BODY_R) * 2);
    hitboxes.add(solid, reach);
  }
}

const key = new THREE.DirectionalLight(0xfff3dd, 2.1);
key.position.set(14, 22, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 90 });
scene.add(key, new THREE.HemisphereLight(0xbdd7ff, 0x54622f, 1.0), new THREE.AmbientLight(0xffffff, 0.35));

// ---- laying things out ---------------------------------------------------------
const labels = document.getElementById('demo-labels');
const tags = [];      // { el, world }
const spinners = [];  // things with turning blades
let row = 0;

function tag(x, z, name, note, cls = 'tag') {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = cls === 'group' ? name : `<b>${name}</b>${note ? `<i>${note}</i>` : ''}`;
  labels.appendChild(el);
  tags.push({ el, world: new THREE.Vector3(x, cls === 'group' ? 1.2 : 0, z) });
}

function place(spec, x, z, name, note) {
  const built = buildBuilding(spec, {});
  const mesh = new THREE.Mesh(built.geometry, material);
  mesh.position.set(x, 0, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  if (built.animated && built.animated.blades) {
    const blades = new THREE.Mesh(buildBladesGeometry(), material);
    blades.position.set(x + built.animated.blades.at[0], built.animated.blades.at[1], z + built.animated.blades.at[2]);
    blades.scale.setScalar(built.animated.blades.r / 0.5);
    scene.add(blades);
    spinners.push(blades);
  }
  drawHitbox(built, x, z);
  tag(x, z + 1.1, name, note);
  return built;
}

const HEADING_X = -PITCH * 4.2;
function heading(text, z) {
  if (text) tag(HEADING_X, z, text, '', 'group');
}

function line(items, draw, title) {
  const z = row * ROW;
  heading(title, z);
  items.forEach((item, i) => draw(item, (i - (items.length - 1) / 2) * PITCH, z));
  row++;
}

// houses, one row per tier, one column per model
for (const tier of TIERS) {
  line(STYLES, (style, x, z) => {
    place({ id: `h:${tier}:${style}`, kind: 'house', tier, style, ornaments: [] }, x, z,
      TIER_LABEL[tier], (PALETTE[style] || PALETTE.unknown).name || style);
  }, TIER_LABEL[tier]);
}

// the tower a session builds once it has run a crowd of apprentices
line([10, 24, 50, 100], (rooms, x, z) => {
  place({
    id: `t:${rooms}`, kind: 'house', tier: 'manor', style: 'opus', ornaments: [],
    hotel: { rooms, floors: Math.max(2, Math.min(14, Math.ceil(rooms / 5))) },
  }, x, z, `${rooms} rooms`, `${Math.max(2, Math.min(14, Math.ceil(rooms / 5)))} floors`);
}, 'Towers');

// a house on stilts, the sheds, and the ornaments in a row of their own
line(['harbour'], (_, x, z) => {
  place({ id: 'h:harbour', kind: 'house', tier: 'cottage', style: 'sonnet', harbour: true, ornaments: [] }, x, z, 'Quay house', 'arrives by boat');
}, 'Quay');

line(SHEDS, (shedType, x, z) => {
  place({ id: `s:${shedType}`, kind: 'shed', shedType, style: 'haiku', tier: 'shed', ornaments: [] }, x, z, shedType, 'apprentice');
}, 'Sheds');

line(ORNAMENTS, ([orn, why], x, z) => {
  place({ id: `o:${orn}`, kind: 'house', tier: 'house', style: 'opus', ornaments: [orn] }, x, z, orn, why);
}, 'Ornaments');

// the civic buildings, wrapped over two rows so they stay readable
for (let i = 0; i < CIVIC.length; i += 8) {
  const slice = CIVIC.slice(i, i + 8);
  line(slice, ([type, name, note], x, z) => {
    place({ id: `c:${type}`, kind: 'civic', civicType: type, tier: 'civic', style: 'unknown', ornaments: [], cards: 6 }, x, z, name, note);
  }, i === 0 ? 'Civic' : '');
}

line(FURNITURE, ([type, name, note], x, z) => {
  place({ id: `f:${type}`, kind: 'civic', civicType: type, tier: 'civic', style: 'unknown', ornaments: [] }, x, z, name, note);
}, 'On the square');

// the little people, and a district plaque for scale
line(STYLES, (style, x, z) => {
  for (const [k, kind] of [[-0.5, 'adult'], [0.5, 'apprentice']]) {
    const geo = figureGeometry(style, { sailor: false });
    if (kind === 'apprentice') geo.scale(0.62, 0.62, 0.62);
    const m = new THREE.Mesh(geo, material);
    m.position.set(x + k * 0.7, 0, z);
    m.castShadow = true;
    scene.add(m);
  }
  tag(x, z + 1.1, (PALETTE[style] || PALETTE.unknown).name || style, 'settler + apprentice');
}, 'Settlers');

line(['sailor', 'plaque'], (what, x, z) => {
  if (what === 'sailor') {
    const m = new THREE.Mesh(figureGeometry('unknown', { sailor: true }), material);
    m.position.set(x, 0, z);
    m.castShadow = true;
    scene.add(m);
    tag(x, z + 1.1, 'Sailor', 'crews the boat');
  } else {
    const m = new THREE.Mesh(buildPlaqueGeometry(200), material);
    m.position.set(x, 0, z);
    m.castShadow = true;
    scene.add(m);
    tag(x, z + 1.1, 'District plaque', 'retired — see Hamlet signs');
  }
}, 'Odds');

// ---- hamlet pieces -------------------------------------------------------------
// A hedge and a field decal both follow the ground, and on a flat plane you cannot tell
// whether they do it correctly - you would ship something that looks perfect here and
// floats on the island. So these rows get a gently rolling patch of their own, and they
// are built by calling the real code against a small stand-in terrain.
const bump = (x, z) => 0.34 * Math.sin(x / 3.1) + 0.22 * Math.cos(z / 2.4);
function demoTerrain(originX, originZ, cells) {
  const half = cells / 2;
  return {
    size: cells, half, seed: 1337,
    cellWorld: (gx, gz) => [gx - half + 0.5, gz - half + 0.5],
    worldHeight: (x, z) => bump(x + originX, z + originZ),
    heightAt: (gx, gz) => bump(gx - half + 0.5 + originX, gz - half + 0.5 + originZ),
    slope: () => 0.1,
    isLand: () => true,
    isWater: () => false,
    isBeach: () => false,
    isBuildable: () => true,
  };
}

// The visible ground under those rows, displaced by the same function.
function groundPatch(originX, originZ, cells) {
  const g = new THREE.PlaneGeometry(cells, cells, cells, cells);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, bump(pos.getX(i) + originX, pos.getZ(i) + originZ));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8fbf5a, roughness: 1, flatShading: true }));
  m.position.set(originX, 0.005, originZ);
  m.receiveShadow = true;
  scene.add(m);
}

const dressMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

// Hamlet signs: a short name, a long one, one that has to wrap, and a small variant.
line([
  ['Hawk', 200, 1],
  ['Sybolt Plc', 24, 1],
  ['Boikonfm Claude Interface', 96, 1],
  ['Plclab/src', 300, 0.6],
], ([text, hue, sc], x, z) => {
  const sign = createNameplate(text, {
    width: 2.1 * sc, height: 0.62 * sc, canvasW: 768, band: hue, height0: 0.95 * sc, posts: 2,
  });
  sign.group.position.set(x, 0, z);
  scene.add(sign.group);
  tag(x, z + 1.3, text, `hue ${hue}${sc < 1 ? ', 0.6x' : ''}`);
}, 'Hamlet signs');

// Boundaries: the three variants, each as a straight run, a corner, and a run with a gate
// in it. Built from a synthetic ownership grid so the real buildBorders does the work -
// which is the whole point of having a model sheet.
{
  const z = row * ROW;
  heading('Boundaries', z);
  groundPatch(0, z, 26);
  const CASES = [
    { name: 'straight', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], roads: [] },
    { name: 'corner', cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], roads: [] },
    { name: 'with a gate', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], roads: [[2, -1], [2, 0]] },
  ];
  ['hedge', 'rail', 'wall'].forEach((want, vi) => {
    CASES.forEach((c, ci) => {
      const cells = 26, mid = cells / 2;
      const ox = (ci - 1) * PITCH * 2.1;
      const oz = z + (vi - 1) * 1.8;
      const t = demoTerrain(ox, oz, cells);
      const owner = new Int16Array(cells * cells).fill(NONE);
      for (const [cx, cz] of c.cells) owner[(mid + cx) + (mid + cz) * cells] = 0;
      const roads = new Set(c.roads.map(([cx, cz]) => (mid + cx) + (mid + cz) * cells));
      // The variant comes from the district id's hash, so find an id that lands on the
      // one we want to show rather than reaching past the real rule.
      let id = 'a';
      for (let n = 0; n < 500 && variantOf(id).kind !== want; n++) id = `a${n}`;
      const fake = { districts: [{ id, hue: 30 + vi * 100 }] };
      const g = buildBorders(fake, t, owner, roads);
      if (g) {
        const m = new THREE.Mesh(g, dressMat());
        m.position.set(ox, 0, oz);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
      }
      if (vi === 2) tag(ox, oz + 1.5, c.name, '');
    });
  });
  tag(HEADING_X + PITCH * 1.1, z, 'hedge / rail / wall', 'one per hamlet, by hash');
  row += 2;
}

// Fields through the year, an orchard and a kitchen garden.
{
  const z = row * ROW;
  heading('Fields', z);
  groundPatch(0, z, 26);
  const items = [
    ['spring', 3, 4], ['summer', 3, 4], ['autumn', 3, 4], ['winter', 3, 4],
    ['orchard', 4, 4], ['garden', 1, 2],
  ];
  items.forEach(([what, w, d], i) => {
    const ox = (i - (items.length - 1) / 2) * PITCH * 1.5;
    const cells = 26, mid = cells / 2;
    const t = demoTerrain(ox, z, cells);
    const list = [];
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) list.push([mid + dx, mid + dz]);
    const patch = { cells: list, gx: mid, gz: mid, w, d };
    const plan = {
      patches: what === 'orchard' || what === 'garden' ? [] : [patch],
      gardens: what === 'garden' ? [patch] : [],
      orchards: what === 'orchard' ? [patch] : [],
    };
    const season = what === 'orchard' || what === 'garden' ? 'summer' : what;
    const g = buildFieldDecals(plan, t, season);
    if (g) {
      const m = new THREE.Mesh(g, dressMat());
      m.material.polygonOffset = true;
      m.material.polygonOffsetFactor = -2;
      m.position.set(ox, 0, z);
      m.receiveShadow = true;
      scene.add(m);
    }
    if (what === 'orchard') {
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x6fae4a, flatShading: true, roughness: 1 });
      for (const [tx, tz, sc] of orchardTrees(plan, t)) {
        const tree = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 6), treeMat);
        tree.position.set(ox + tx, bump(ox + tx, z + tz) + 0.45, z + tz);
        tree.scale.setScalar(sc / 0.5);
        tree.castShadow = true;
        scene.add(tree);
      }
    }
    tag(ox, z + d / 2 + 1.2, what, what === 'garden' ? 'inside a hamlet' : 'countryside');
  });
  row += 2;
}

// ---- bridges -------------------------------------------------------------------
// A deck is judged entirely by whether it meets the ground at both ends, so a flat plane
// is worse than useless here: it would hide the one thing that can be wrong. Each case
// therefore gets a real little valley, flooded to below sea level exactly as `terrain.mjs`
// floods a river, and the cells the deck spans are worked out from that valley the way
// the layout works them out - the run of cells between two banks that is not land.
const RIVER_BED = -0.55, RIVER_RISE = 1.5;

// The channel runs along x, so it is seen across from where the model sheet's camera
// stands rather than end on, and the deck that crosses it runs along z - the other of the
// two axes a recorded crossing can have.
function riverPatch(originX, originZ, cells, { w, tilt, base }) {
  const half = cells / 2;
  const land = (x, z) => base + tilt * z + 0.1 * Math.sin(x / 2.3);
  const wh = (x, z) => Math.min(land(x, z), RIVER_BED + RIVER_RISE * Math.max(0, Math.abs(z) - w));
  const corner = (i, j) => wh(i - half, j - half);
  const corners = (gx, gz) => [corner(gx, gz), corner(gx + 1, gz), corner(gx, gz + 1), corner(gx + 1, gz + 1)];
  const t = {
    size: cells, half, seed: 1337,
    cellWorld: (gx, gz) => [gx - half + 0.5, gz - half + 0.5],
    worldHeight: wh,
    heightAt: (gx, gz) => corners(gx, gz).reduce((a, b) => a + b, 0) / 4,
    slope: (gx, gz) => { const c = corners(gx, gz); return Math.max(...c) - Math.min(...c); },
    isLand: (gx, gz) => corners(gx, gz).every((h) => h >= 0),
    isWater: (gx, gz) => corners(gx, gz).reduce((a, b) => a + b, 0) / 4 < 0,
    isBeach: () => false,
    isBuildable: (gx, gz) => corners(gx, gz).every((h) => h >= 0.35),
  };

  // the ground, displaced by the same function
  const g = new THREE.PlaneGeometry(cells, cells, cells * 2, cells * 2);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, wh(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const gm = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x93b06a, roughness: 1, flatShading: true }));
  gm.position.set(originX, 0, originZ);
  gm.receiveShadow = true;
  scene.add(gm);

  // and the water in it, a flat sheet at sea level, which is all the island does either
  const reach = w - RIVER_BED / RIVER_RISE;
  const wg = new THREE.PlaneGeometry(cells, reach * 2);
  wg.rotateX(-Math.PI / 2);
  const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
    color: 0x4d95b0, roughness: 0.3, transparent: true, opacity: 0.85,
  }));
  wm.position.set(originX, 0, originZ);
  scene.add(wm);

  // the run the layout would have recorded: the cells across the middle that are not land
  const mid = Math.floor(half);
  const run = [];
  for (let gz = 0; gz < cells; gz++) if (!t.isLand(mid, gz)) run.push([mid, gz]);
  return { t, run };
}

{
  const z = row * ROW;
  heading('Bridges', z);
  const CASES = [
    ['narrow', { w: 0.6, tilt: 0, base: 0.7 }, 'the upper reach'],
    ['wide', { w: 1.3, tilt: 0, base: 0.7 }, 'as wide as one gets'],
    ['uneven banks', { w: 0.8, tilt: 0.075, base: 0.9 }, 'the deck ramps'],
  ];
  CASES.forEach(([name, opts, note], i) => {
    // The patches are as wide apart as they are deep; any closer and two of them overlap
    // and the ground z-fights along the seam.
    const CELLS = 13;
    const ox = (i - 1) * CELLS;
    const { t, run } = riverPatch(ox, z, CELLS, opts);
    const [cx, cz] = t.cellWorld(run[0][0], run[0][1]);
    const g = buildBridgeGeometry(run, t, [cx, cz], 'z');
    if (g) {
      const m = new THREE.Mesh(g, material);
      m.position.set(ox + cx, 0, z + cz);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
    tag(ox, z + 2.4, name, `${run.length} cells — ${note}`);
  });
  tag(HEADING_X + PITCH * 1.1, z, 'over a real valley', 'cells derived, not hand-listed');
  row += 2;
}

// How strong the ground tint should be: pick the one that still reads as farmland.
{
  const z = row * ROW;
  heading('Ground tint', z);
  const meadow = new THREE.Color(0x8fbf5a);
  const upland = new THREE.Color(0x6fa64a);
  const HUE = 24;
  [0, 0.06, 0.11, 0.16, 0.25, 'upland'].forEach((v, i) => {
    const ox = (i - 2.5) * PITCH * 1.15;
    const strength = v === 'upland' ? 0.11 : v;
    const c = (v === 'upland' ? upland : meadow).clone()
      .lerp(new THREE.Color().setHSL(HUE / 360, 0.3, 0.5), strength);
    if (strength > 0) c.offsetHSL(0, 0, 0.015);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(ox, 0.02, z);
    scene.add(m);
    tag(ox, z + 2.0, v === 'upland' ? 'upland' : String(strength), v === 'upland' ? 'at 0.11' : (strength === 0.11 ? 'shipped' : ''));
  });
  row++;
}

// ---- camera --------------------------------------------------------------------
const fieldDepth = (row - 1) * ROW;
controls.target.set(0, 0.6, fieldDepth / 2);
camera.position.set(0, 26, fieldDepth / 2 + 40);
controls.update();

// ---- controls ------------------------------------------------------------------
const nightInput = document.getElementById('d-night');
const nightVal = document.getElementById('d-night-v');
const spinInput = document.getElementById('d-spin');
const spinVal = document.getElementById('d-spin-v');

function applyNight() {
  const n = Number(nightInput.value);
  uniforms.uNight.value = n;
  nightVal.textContent = n.toFixed(2).replace(/0$/, '');
  const day = new THREE.Color(0x9fc3e8), night = new THREE.Color(0x0d1420);
  scene.background = day.clone().lerp(night, n);
  key.intensity = 2.1 * (1 - n) + 0.15;
  ground.material.color.setHex(0x8fae5a).multiplyScalar(1 - n * 0.72);
}
nightInput.addEventListener('input', applyNight);
spinInput.addEventListener('input', () => { spinVal.textContent = String(Number(spinInput.value)).replace(/^0/, ''); });
applyNight();

document.getElementById('d-grid').addEventListener('click', (e) => {
  grid.visible = !grid.visible;
  e.currentTarget.classList.toggle('on', grid.visible);
});
document.getElementById('d-wire').addEventListener('click', (e) => {
  material.wireframe = !material.wireframe;
  e.currentTarget.classList.toggle('on', material.wireframe);
});
document.getElementById('d-hits').addEventListener('click', (e) => {
  hitboxes.visible = !hitboxes.visible;
  e.currentTarget.classList.toggle('on', hitboxes.visible);
  document.getElementById('d-hits-key').hidden = !hitboxes.visible;
});
document.getElementById('d-top').addEventListener('click', () => {
  camera.position.set(0.01, 62, fieldDepth / 2 + 0.01);
  controls.target.set(0, 0, fieldDepth / 2);
  controls.update();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- frame ----------------------------------------------------------------------
const v = new THREE.Vector3();
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const spin = Number(spinInput.value);
  for (const s of spinners) s.rotation.z += dt * spin * 6;
  controls.update();
  renderer.render(scene, camera);

  // labels ride along with the objects they name
  for (const t of tags) {
    v.copy(t.world).project(camera);
    const on = v.z < 1;
    t.el.style.display = on ? '' : 'none';
    if (!on) continue;
    t.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    t.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
