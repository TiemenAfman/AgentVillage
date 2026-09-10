// The model sheet: every object the island can draw, laid out on one field so a shape
// can be judged and tuned without hunting for one on the map. Nothing here reads the
// village; it builds specs by hand, which is also the quickest way to see a piece that
// no village has unlocked yet.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createBuildingMaterial, buildBuilding, buildBladesGeometry, buildPlaqueGeometry,
  PALETTE, TIER_LABEL, WALK_CLEARANCE, WALK_BODY_R,
} from './buildings.js';
import { figureGeometry } from './settlers.js';

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
    tag(x, z + 1.1, 'District plaque', 'one per project');
  }
}, 'Odds');

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
