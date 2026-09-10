// Boot, camera, the live feed and the animation queue that turns a data diff into
// something you can watch happen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTerrain } from 'shared/terrain.mjs';
import { clamp } from 'shared/rng.mjs';
import { createWorld, seasonOf } from './world.js';
import {
  createBuildingMaterial, buildBuilding, buildScaffoldGeometry, buildBoatGeometry,
  buildCampfireGeometry, buildFlameGeometry, buildBladesGeometry, buildPierGeometry,
  buildPlaqueGeometry, createFlagMesh, PALETTE, TIER_INDEX,
} from './buildings.js';
import { createSettlers } from './settlers.js';
import { createNameplate } from './nameplate.js';
import { createUI } from './ui.js';
import { createWalkMode } from './walk.js';
import { createBoard } from './board.js';
import { createChat } from './chat.js';
import { createOffice } from './office.js';
import { createNewSettler } from './newsettler.js';
import { createTownHall } from './townhall.js';
import { createGamepad, BTN } from './gamepad.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');

// Anything that goes wrong in the page is reported to the server, so a crash leaves a
// trace in data/server.log instead of only a blank tab.
let reported = 0;
function report(message, stack) {
  if (reported++ > 6) return;
  try {
    const body = JSON.stringify({ message: String(message), stack: stack ? String(stack) : null });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }));
    else fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { /* nothing more we can do */ }
}
addEventListener('error', (e) => report(e.message, e.error && e.error.stack));
addEventListener('unhandledrejection', (e) => report(`unhandled rejection: ${e.reason}`, e.reason && e.reason.stack));

// Asking for the discrete GPU can fail on a laptop that has powered it down, and a
// browser that has just lost a context hands out the next one grudgingly. So try the
// good settings first and walk down to the modest ones rather than giving up.
const RENDERER_TRIES = [
  { antialias: true, powerPreference: 'high-performance' },
  { antialias: true, powerPreference: 'default' },
  { antialias: false, powerPreference: 'default' },
  { antialias: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
];

function makeRenderer() {
  let last = null;
  for (const opts of RENDERER_TRIES) {
    try {
      const r = new THREE.WebGLRenderer({ canvas, ...opts });
      if (opts !== RENDERER_TRIES[0]) console.warn('island running with reduced graphics', opts);
      return r;
    } catch (e) { last = e; }
  }
  throw last || new Error('no WebGL');
}

// When Chrome's GPU process falls over, every WebGL page on the machine fails until it
// comes back. It usually respawns within seconds, so wait and reload rather than making
// the reader do it. A counter in sessionStorage keeps that from becoming a reload loop.
const RETRY_KEY = 'promptholm.canvasRetries';
const MAX_RETRIES = 4;

let renderer;
try {
  renderer = makeRenderer();
  try { sessionStorage.removeItem(RETRY_KEY); } catch { /* private window */ }
} catch (e) {
  console.error(e);
  let tries = 0;
  try { tries = Number(sessionStorage.getItem(RETRY_KEY) || 0); } catch { /* private window */ }
  report('could not create a webgl context', String(e && e.message));
  if (tries < MAX_RETRIES) {
    try { sessionStorage.setItem(RETRY_KEY, String(tries + 1)); } catch { /* private window */ }
    countdownReload(2 + tries * 2, tries + 1);
  } else {
    showCanvasTrouble(e);
  }
  throw e;
}

function countdownReload(seconds, attempt) {
  const boot = document.getElementById('boot');
  const text = document.getElementById('boot-text');
  if (!boot || !text) { setTimeout(() => location.reload(), seconds * 1000); return; }
  boot.hidden = false;
  boot.classList.remove('gone');
  let left = seconds;
  const draw = () => {
    text.innerHTML = `The browser's graphics process is not answering.<br>`
      + `<span class="muted">Trying again in ${left} s (attempt ${attempt} of ${MAX_RETRIES})</span><br>`
      + `<button class="btn" id="canvas-retry">Try now</button>`;
    const btn = document.getElementById('canvas-retry');
    if (btn) btn.addEventListener('click', () => location.reload());
  };
  draw();
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(timer); location.reload(); return; }
    draw();
  }, 1000);
}

// A lost context is recoverable: hold the frame, and rebuild when the browser gives it back.
let contextLost = false;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  report('webgl context lost', `renderer: ${gpuName()}`);
  showCanvasTrouble(new Error('The island lost its 3D canvas.'), true);
});

function gpuName() {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  } catch { return 'unknown'; }
}

// An integrated GPU driving a full-screen scene with a big shadow map is the most
// likely thing to fall over, so ask it for less.
const MODEST_GPU = /Intel|Radeon\(TM\)|UHD|Vega|610M|660M|Iris/i;
canvas.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  location.reload();
});

function showCanvasTrouble(err, recoverable = false) {
  const boot = document.getElementById('boot');
  const text = document.getElementById('boot-text');
  if (!boot || !text) return;
  boot.hidden = false;
  boot.classList.remove('gone');
  text.innerHTML = recoverable
    ? 'The island lost its 3D canvas. Waiting for the browser to hand it back…<br><button class="btn" id="canvas-retry">Reload now</button>'
    : 'The browser\'s graphics process keeps refusing a 3D canvas.<br>'
      + '<span class="muted">Restart the browser. If it happens often, open <b>chrome://gpu</b> '
      + 'and look for a crashed or disabled graphics process.</span><br>'
      + '<button class="btn" id="canvas-retry">Try again</button> '
      + '<button class="btn" id="board-only">Open the sprint board anyway</button>';
  const btn = document.getElementById('canvas-retry');
  if (btn) btn.addEventListener('click', () => location.reload());
  const only = document.getElementById('board-only');
  if (only) only.addEventListener('click', openBoardWithoutIsland);
  void err;
}

// The board is plain HTML, so it still works when the island cannot be drawn. Handing
// out work should not depend on a graphics driver.
async function openBoardWithoutIsland() {
  let village = { buildings: [], districts: [] };
  try { village = await (await fetch('/village.json', { cache: 'no-store' })).json(); } catch { /* board still opens */ }
  const districts = new Map((village.districts || []).map((d) => [d.id, d]));
  const board = createBoard(document.body, {
    getSettlers: () => (village.buildings || [])
      .filter((b) => (b.kind === 'house' || b.kind === 'camp') && b.cwd)
      .map((b) => ({
        id: b.id, name: b.name, cwd: b.cwd, model: b.model,
        jira: !!(b.skills && b.skills.jira),
        modelLabel: (PALETTE[b.style] || PALETTE.unknown).name,
        districtName: (districts.get(b.district) || {}).name || null,
      })),
    onDispatch: () => {},
    onClose: () => { document.getElementById('boot').hidden = false; },
  });
  document.getElementById('boot').hidden = true;
  board.open();
}

const modest = MODEST_GPU.test(gpuName());
report(`island drawing on: ${gpuName()}`);   // one line per load, so the log says which card
renderer.setPixelRatio(Math.min(devicePixelRatio, modest ? 1.15 : 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = modest ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (modest) console.info('island: integrated graphics detected, running lighter');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 1400);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, {
  enableDamping: true, dampingFactor: 0.075, screenSpacePanning: false,
  minDistance: 5, maxDistance: 95, minPolarAngle: 0.12, maxPolarAngle: 1.34,
  rotateSpeed: 0.62, panSpeed: 0.85, zoomSpeed: 0.9, zoomToCursor: true,
});
controls.target.set(0, 1, 0);

const buildingMat = createBuildingMaterial();
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false });

const state = {
  village: null, terrain: null, world: null, settlers: null, ui: null,
  byId: new Map(), districts: new Map(), pickables: [],
  filters: { code: true, cowork: true, apprentices: true },
  chronicle: { t: null, playing: false, speed: 'day' },
  hourOverride: params.has('hour') ? Number(params.get('hour')) : null,
  hover: null, selected: null, intro: null, tween: null, live: 'live',
  queue: [], running: false, flags: null, particles: null,
  walk: null, board: null, chat: null, pad: null, padSeen: false, mode: 'orbit',
};

// Walking into the office of a district shows what git has to say about that repo.
function openOffice(id) {
  const rec = state.byId.get(id);
  if (!rec || rec.spec.civicType !== 'office') return;
  const d = state.districts.get(rec.spec.district);
  if (!d) return;
  if (state.walk) state.walk.setPaused(true);
  state.ui.closeDossier();
  state.office.open({ id: d.id, name: d.name });
}

// Addressing a settler opens their session and lets you carry it on.
function talkTo(id) {
  const rec = state.byId.get(id);
  if (!rec || rec.spec.kind === 'civic' || !rec.spec.sessionId) return;
  if (state.walk) state.walk.setPaused(true);
  state.ui.closeDossier();
  state.chat.open({
    id: rec.id,
    sessionId: rec.spec.sessionId,
    agentId: rec.spec.kind === 'shed' ? String(rec.id).split(':')[2] : null,
    name: rec.spec.name,
    title: rec.spec.title,
    cwd: rec.spec.cwd,
    districtName: (state.districts.get(rec.spec.district) || {}).name || null,
  });
}

// --------------------------------------------------------------- walking
function walkableBlockers() {
  const out = [];
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const b = rec.built.bbox;
    const r = Math.max(0.45, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.5);
    out.push({ x: rec.group.position.x, z: rec.group.position.z, r, id: rec.id });
  }
  return out;
}

function interactables() {
  const out = [];
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const p = rec.group.position;
    if (rec.spec.civicType === 'board') {
      out.push({ id: rec.id, kind: 'board', x: p.x, z: p.z, r: 3.0, label: rec.spec.title || 'the sprint board' });
    } else if (rec.spec.civicType === 'office') {
      out.push({ id: rec.id, kind: 'office', x: p.x, z: p.z, r: 2.4, label: rec.spec.name });
    } else if (rec.spec.civicType === 'townhall') {
      out.push({ id: rec.id, kind: 'townhall', x: p.x, z: p.z, r: 3.2, label: 'the town hall' });
    } else if (rec.spec.kind !== 'civic') {
      out.push({ id: rec.id, kind: 'house', x: p.x, z: p.z, r: 1.9, label: rec.spec.name });
    }
  }
  return out;
}

function enterWalk() {
  if (state.mode === 'walk') return;
  const board = state.byId.get('civic:board');
  const town = state.village.island.town;
  // Start on the town square, a couple of paces in front of the board, facing it.
  let at = [0, 0], facing = null;
  if (board) {
    at = [board.group.position.x, board.group.position.z + 2.2];
    facing = [board.group.position.x, board.group.position.z];
  } else if (town && state.terrain) {
    at = state.terrain.cellWorld(town.centre[0], town.centre[1] + 2);
    facing = state.terrain.cellWorld(town.centre[0], town.centre[1]);
  }
  state.mode = 'walk';
  controls.enabled = false;
  state.intro = null;
  state.tween = null;
  state.ui.closeDossier();
  state.ui.setWalking(true, state.padSeen);
  state.walk.enter({
    at,
    facing,
    blockers: walkableBlockers(),
    interactables: interactables(),
    onInteract: (it) => {
      if (it.kind === 'board') { state.walk.setPaused(true); state.board.open(); }
      else if (it.kind === 'office') openOffice(it.id);
      else if (it.kind === 'townhall') openTownHall();
      else talkTo(it.id);
    },
    onSendAway: (it) => { if (it.kind !== 'board' && it.kind !== 'townhall' && it.kind !== 'office') askToSendAway(it.id); },
    onExit: () => exitWalk(),
  });
}

function foundSettler() {
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.newSettler.open();
}

// The town hall keeps the register of every session this machine remembers.
function openTownHall() {
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.townHall.open();
}

// --------------------------------------------------------------- sending someone away
// Two steps, always: nobody leaves the island on a single keypress.
let pendingExile = null;
function askToSendAway(id) {
  const rec = state.byId.get(id);
  if (!rec || rec.spec.kind === 'civic') return;
  if (pendingExile && pendingExile.id === id) { sendAway(id); return; }
  clearTimeout(pendingExile && pendingExile.timer);
  pendingExile = {
    id,
    name: rec.spec.name,
    timer: setTimeout(() => { pendingExile = null; state.ui.setConfirm(null); }, 6000),
  };
  state.ui.setConfirm({ name: rec.spec.name, kind: rec.spec.kind, pad: state.padSeen });
}

async function sendAway(id) {
  clearTimeout(pendingExile && pendingExile.timer);
  pendingExile = null;
  state.ui.setConfirm(null);
  const rec = state.byId.get(id);
  if (!rec) return;
  const name = rec.spec.name;
  const sheds = (rec.spec.sheds || []).length;
  const restore = leaveAnimation(rec);
  try {
    const r = await fetch('/api/banish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: id }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'that did not work');
    state.ui.toast(
      `<b>${name}</b> left the island${sheds ? `, with ${sheds} apprentice${sheds > 1 ? 's' : ''}` : ''}. `
      + `<button class="btn tiny" data-undo="${id}">Bring them back</button>`,
      (el) => el.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => bringBack(b.dataset.undo))),
    );
    const next = await fetchVillage();
    applyVillage(next, { animate: false });
  } catch (e) {
    restore();                                   // they are still here; put the house back
    state.ui.toast(`Could not send ${name} away: ${e.message}`);
  }
}

async function bringBack(id) {
  try {
    await fetch('/api/banish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buildingId: id, undo: true }),
    });
    const next = await fetchVillage();
    applyVillage(next, { animate: true });
    state.ui.toast('They are back, and building again.');
  } catch (e) {
    state.ui.toast(`Could not bring them back: ${e.message}`);
  }
}

// The house comes apart and blows away rather than blinking out of existence.
function leaveAnimation(rec) {
  const p = rec.group.position.clone();
  const scale0 = rec.group.scale.x;
  state.particles.puff([p.x, p.y + 0.3, p.z], 22, 0xcfc3aa);
  const anim = { t: 0 };
  const start = scale0;
  let cancelled = false;
  tickers.push((dt) => {
    if (cancelled) return true;
    anim.t += dt;
    const k = clamp(anim.t / 0.9, 0, 1);
    rec.group.scale.setScalar(start * (1 - k));
    rec.group.position.y = p.y - k * 0.35;
    if (k >= 1) { rec.group.visible = false; return true; }
    return false;
  });
  state.settlers.setVisible(rec.id, false);
  return function restore() {
    cancelled = true;
    rec.group.scale.setScalar(scale0);
    rec.group.position.copy(p);
    rec.group.visible = true;
    state.settlers.setVisible(rec.id, true);
  };
}

function exitWalk() {
  if (state.mode !== 'walk') return;
  state.mode = 'orbit';
  state.walk.exit();
  state.board.close();
  state.ui.setWalking(false);
  controls.enabled = true;
  frameIsland();
}

// --------------------------------------------------------------- particles
function createParticles() {
  const MAX = 2200;
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3), size = new Float32Array(MAX), alpha = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uScale: { value: innerHeight * 0.5 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying float vA; varying vec3 vC; uniform float uScale;
      void main(){ vA = aAlpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * uScale / max(0.001, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float m = smoothstep(0.5, 0.12, length(d));
        if (m <= 0.01) discard; gl_FragColor = vec4(vC, vA * m); }`,
    vertexColors: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);
  const live = [];
  let next = 0;
  function spawn(p, v, life, s0, s1, hex, a0) {
    const i = next++ % MAX;
    live.push({ i, p: [...p], v: [...v], t: 0, life, s0, s1, a0 });
    const c = new THREE.Color(hex);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    return i;
  }
  function puff(p, n = 12, hex = 0xd9c9a8) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, sp = 0.4 + Math.random() * 0.7;
      spawn(p, [Math.cos(a) * sp, 0.35 + Math.random() * 0.4, Math.sin(a) * sp], 0.55 + Math.random() * 0.35, 0.06, 0.22, hex, 0.75);
    }
  }
  function smoke(p) {
    spawn(p, [(Math.random() - 0.5) * 0.12, 0.36 + Math.random() * 0.12, (Math.random() - 0.5) * 0.12], 2.6, 0.09, 0.34, 0xcfcfcf, 0.42);
  }
  function update(dt) {
    for (let k = live.length - 1; k >= 0; k--) {
      const q = live[k];
      q.t += dt;
      const u = q.t / q.life;
      if (u >= 1) {
        alpha[q.i] = 0; size[q.i] = 0;
        live.splice(k, 1);
        continue;
      }
      q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      q.v[0] *= 0.97; q.v[2] *= 0.97; q.v[1] *= 0.985;
      pos[q.i * 3] = q.p[0]; pos[q.i * 3 + 1] = q.p[1]; pos[q.i * 3 + 2] = q.p[2];
      size[q.i] = q.s0 + (q.s1 - q.s0) * u;
      alpha[q.i] = q.a0 * (1 - u * u);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { puff, smoke, update, mat };
}

// --------------------------------------------------------------- helpers
const scaffoldGeo = buildScaffoldGeometry();
const boatGeo = buildBoatGeometry();
const campfireGeo = buildCampfireGeometry();
const flameGeo = buildFlameGeometry();
const bladesGeo = buildBladesGeometry();

function cellCentre(plot) {
  const t = state.terrain;
  const cx = plot.gx + plot.w / 2, cz = plot.gz + plot.d / 2;
  return [cx - t.half, cz - t.half];
}
function groundAt(x, z) { return state.terrain.worldHeight(x, z); }

function timeNow() {
  return state.chronicle.t == null ? Date.now() : state.chronicle.t;
}
function currentHour() {
  if (state.hourOverride != null) return state.hourOverride;
  const d = new Date(timeNow());
  return d.getHours() + d.getMinutes() / 60;
}

// --------------------------------------------------------------- records
function makeRecord(spec) {
  const group = new THREE.Group();
  const [x, z] = cellCentre(spec.plot);
  let y = groundAt(x, z);
  if (spec.harbour) y = Math.max(-0.35, Math.min(y, 0.05));
  group.position.set(x, y, z);
  group.rotation.y = (spec.plot.rot || 0) * Math.PI / 2;

  const built = buildBuilding(spec);
  const mesh = new THREE.Mesh(built.geometry, buildingMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.id = spec.id;
  group.add(mesh);
  scene.add(group);

  const rec = {
    id: spec.id, spec, group, mesh, built, visible: true, scaffold: null,
    flagIdx: -1, blades: null, beacon: null, flame: null, fire: null, smokeT: 0,
  };
  attachExtras(rec);
  state.byId.set(spec.id, rec);
  state.pickables.push(mesh);
  return rec;
}

function attachExtras(rec) {
  const { spec, built, group } = rec;
  if (built.animated && built.animated.blades) {
    const m = new THREE.Mesh(bladesGeo, buildingMat);
    m.castShadow = true;
    m.position.set(...built.animated.blades.at);
    group.add(m);
    rec.blades = m;
  }
  if (built.animated && built.animated.beacon) {
    const light = new THREE.SpotLight(0xfff2b0, 0, 60, 0.3, 0.6, 1.2);
    light.position.set(...built.animated.beacon.at);
    const target = new THREE.Object3D();
    target.position.set(14, -1, 0);
    group.add(light, target);
    light.target = target;
    rec.beacon = { light, target, a: 0 };
  }
  if (spec.kind === 'camp') {
    const fire = new THREE.Mesh(campfireGeo, buildingMat);
    fire.position.set(0.5, 0, 0.42);
    group.add(fire);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0.5, 0.06, 0.42);
    group.add(flame);
    rec.flame = flame;
    if (countFires() < 8) {
      const l = new THREE.PointLight(0xff9a40, 2.4, 5, 2);
      l.position.set(0.5, 0.35, 0.42);
      group.add(l);
      rec.fire = l;
    }
  }
  if (built.anchors && built.anchors.flag) rec.flagAnchor = built.anchors.flag;
  if (built.anchors && built.anchors.smoke) rec.smokeAnchor = built.anchors.smoke;

  // A yard sign with the session's own name, for the houses that have one.
  if (spec.kind === 'house' || spec.kind === 'camp') {
    const label = spec.title || spec.name;
    const plate = createNameplate(label, { small: spec.kind === 'camp' });
    // front-left of the plot, clear of the door, facing the street like the house does
    plate.group.position.set(-0.52, 0, 0.66);
    plate.group.rotation.y = -0.22;
    group.add(plate.group);
    rec.nameplate = plate;
  }

  // A signboard in front of the office carrying the repository's name.
  if (spec.civicType === 'office' && spec.repoName) {
    const plate = createNameplate(spec.repoName);
    plate.group.position.set(-0.02, 0, 0.72);
    group.add(plate.group);
    rec.nameplate = plate;
  }
}
function countFires() { let n = 0; for (const r of state.byId.values()) if (r.fire) n++; return n; }

function disposeRecord(rec) {
  rec.mesh.geometry.dispose();
  if (rec.nameplate) rec.nameplate.dispose();
  scene.remove(rec.group);
  const i = state.pickables.indexOf(rec.mesh);
  if (i >= 0) state.pickables.splice(i, 1);
}

function rebuild(rec, spec) {
  const wasVisible = rec.group.visible;
  disposeRecord(rec);
  state.byId.delete(rec.id);
  const fresh = makeRecord(spec);
  fresh.group.visible = wasVisible;
  return fresh;
}

// --------------------------------------------------------------- scene build
function buildScene(village) {
  const terrain = makeTerrain(village.island.seed, { size: village.grid.size, polders: village.polders });
  if (village.island.terrainHash && terrain.hash !== village.island.terrainHash) {
    console.warn(`terrain mismatch: viewer ${terrain.hash}, scanner ${village.island.terrainHash}`);
  }
  state.terrain = terrain;
  state.world = createWorld(scene, terrain, village, {
    month: new Date().getMonth(),
    shadowSize: modest ? 1024 : 2048,
  });
  state.settlers = createSettlers(scene, buildingMat, terrain);
  state.particles = createParticles();
  state.flags = createFlagMesh(200);
  scene.add(state.flags);

  // district plaques and piers
  const dgroup = new THREE.Group();
  scene.add(dgroup);
  for (const d of village.districts) {
    if (!d.center) continue;
    const [x, z] = terrain.cellWorld(d.center[0], d.center[1]);
    const plaque = new THREE.Mesh(buildPlaqueGeometry(d.hue), buildingMat);
    plaque.castShadow = true;
    plaque.position.set(x + 0.55, groundAt(x + 0.55, z + 0.55), z + 0.55);
    plaque.rotation.y = Math.PI * 0.15;
    plaque.userData.id = `district:${d.id}`;
    dgroup.add(plaque);
    state.districts.set(d.id, d);
    if (d.pier && d.pier.length) {
      const g = buildPierGeometry(d.pier, terrain, [x, z]);
      if (g) {
        const pm = new THREE.Mesh(g, buildingMat);
        pm.position.set(x, 0, z);
        pm.receiveShadow = true;
        dgroup.add(pm);
      }
    }
  }
  frameIsland();
}

function frameIsland() {
  const t = state.terrain;
  let minX = 99, maxX = -99, minZ = 99, maxZ = -99;
  for (const [gx, gz] of t.landCells) {
    const [x, z] = t.cellWorld(gx, gz);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  // fit the wider of the two spans, then pull in a little so the island fills the frame
  const r = 0.5 * Math.max(maxX - minX, maxZ - minZ) + 2;
  const fov = camera.fov * Math.PI / 180;
  const dist = clamp((r / Math.tan(fov / 2)) * 0.82, 22, 88);
  const az = 0.6, el = 0.72;
  controls.target.set(cx, 1, cz);
  camera.position.set(
    cx + Math.cos(el) * Math.sin(az) * dist,
    1 + Math.sin(el) * dist,
    cz + Math.cos(el) * Math.cos(az) * dist,
  );
  controls.update();
  return { cx, cz, dist, az, el };
}

function startIntro() {
  if (params.has('nointro')) return;
  const f = frameIsland();
  state.intro = { t: 0, dur: 3.2, startedAt: Date.now(), ...f };
  controls.enabled = false;
  // If the tab was in the background the animation never ran; never leave the
  // camera locked because of it.
  setTimeout(() => { if (state.intro) { state.intro = null; controls.enabled = true; frameIsland(); } }, 9000);
  const stop = () => { if (state.intro) { state.intro = null; controls.enabled = true; } };
  renderer.domElement.addEventListener('pointerdown', stop, { once: true });
  renderer.domElement.addEventListener('wheel', stop, { once: true, passive: true });
}

function focusOn(id) {
  const rec = state.byId.get(id);
  if (!rec) return;
  state.intro = null;
  controls.enabled = true;
  const p = rec.group.position;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const target = new THREE.Vector3(p.x, p.y + 0.6, p.z);
  const dist = Math.max(6, Math.min(11, camera.position.distanceTo(controls.target) * 0.45));
  state.tween = { t: 0, dur: 0.75, from: controls.target.clone(), to: target, fromPos: camera.position.clone(), toPos: target.clone().add(dir.multiplyScalar(dist)) };
  select(id);
}

// --------------------------------------------------------------- visibility
function passesFilter(spec) {
  if (spec.kind === 'civic') return true;
  if (spec.kind === 'shed') return state.filters.apprentices;
  if (spec.harbour) return state.filters.cowork;
  return state.filters.code;
}
function visibleAt(spec, t) {
  const start = new Date(spec.startedAt).getTime();
  return start <= t;
}
function applyVisibility() {
  const t = timeNow();
  for (const rec of state.byId.values()) {
    const ok = passesFilter(rec.spec) && visibleAt(rec.spec, t) && !rec.popping;
    rec.group.visible = ok;
    if (state.settlers) state.settlers.setVisible(rec.id, ok && rec.spec.kind !== 'civic');
    if (rec.flagIdx >= 0) updateFlagInstance(rec, ok);
  }
}

// --------------------------------------------------------------- flags
const flagMatrix = new THREE.Matrix4();
const flagObj = new THREE.Object3D();
function assignFlags() {
  const max = state.flags.instanceMatrix.count;   // writing past this corrupts silently
  let n = 0;
  for (const rec of state.byId.values()) {
    rec.flagIdx = rec.flagAnchor && n < max ? n++ : -1;
  }
  state.flags.count = n;
  for (const rec of state.byId.values()) if (rec.flagIdx >= 0) updateFlagInstance(rec, rec.group.visible);
}
const flagColour = new THREE.Color();
function updateFlagInstance(rec, visible) {
  if (rec.flagIdx < 0 || rec.flagIdx >= state.flags.instanceMatrix.count) return;
  if (!visible) {
    flagObj.position.set(0, -999, 0); flagObj.scale.setScalar(0.0001);
    flagObj.rotation.set(0, 0, 0);
  } else {
    const a = rec.flagAnchor;
    flagObj.position.set(a[0], a[1], a[2]);
    flagObj.rotation.set(0, 0, 0);
    flagObj.scale.setScalar(1);
    rec.group.updateMatrixWorld();
    flagObj.updateMatrix();
    flagMatrix.multiplyMatrices(rec.group.matrixWorld, flagObj.matrix);
    state.flags.setMatrixAt(rec.flagIdx, flagMatrix);
    const d = state.districts.get(rec.spec.district);
    state.flags.setColorAt(rec.flagIdx, flagColour.setHSL(((d && d.hue) || 40) / 360, 0.6, 0.5));
    state.flags.instanceMatrix.needsUpdate = true;
    if (state.flags.instanceColor) state.flags.instanceColor.needsUpdate = true;
    return;
  }
  flagObj.updateMatrix();
  state.flags.setMatrixAt(rec.flagIdx, flagObj.matrix);
  state.flags.instanceMatrix.needsUpdate = true;
}

// --------------------------------------------------------------- scaffold
function addScaffold(rec) {
  if (rec.scaffold) return;
  const m = new THREE.Mesh(scaffoldGeo, buildingMat);
  const b = rec.built.bbox;
  const w = Math.max(0.7, b.max.x - b.min.x) + 0.26;
  const d = Math.max(0.7, b.max.z - b.min.z) + 0.26;
  m.scale.set(w, Math.max(0.6, rec.built.height + 0.2), d);
  m.castShadow = true;
  rec.group.add(m);
  rec.scaffold = m;
}
function removeScaffold(rec, animate = true) {
  if (!rec.scaffold) return;
  const m = rec.scaffold;
  rec.scaffold = null;
  if (!animate) { rec.group.remove(m); return; }
  const y0 = m.scale.y;
  const anim = { t: 0 };
  const tick = (dt) => {
    anim.t += dt;
    const k = clamp(anim.t / 0.6, 0, 1);
    m.scale.y = y0 * (1 - k);
    if (k >= 1) { rec.group.remove(m); return true; }
    return false;
  };
  tickers.push(tick);
}
const tickers = [];

// --------------------------------------------------------------- animation queue
function enqueue(job) { state.queue.push(job); pump(); }
function pump() {
  if (state.running || !state.queue.length) return;
  if (state.queue.length > 14) {
    while (state.queue.length) { const j = state.queue.shift(); j.instant && j.instant(); }
    return;
  }
  const job = state.queue.shift();
  state.running = true;
  // A job that throws must not wedge the queue: without this the flag stays true and
  // nothing on the island ever animates again for the life of the tab.
  Promise.resolve()
    .then(() => job.run())
    .catch((e) => { report(`animation "${job.label || 'job'}" failed`, e && e.stack); })
    .then(() => { state.running = false; pump(); });
}
function wait(sec) { return new Promise((r) => setTimeout(r, sec * 1000)); }

function popIn(rec, delay = 0) {
  rec.popping = true;
  rec.group.visible = false;
  return wait(delay).then(() => new Promise((resolve) => {
    rec.group.visible = true;
    rec.popping = false;
    const anim = { t: 0 };
    const p = rec.group.position;
    state.particles.puff([p.x, p.y + 0.1, p.z], 14);
    tickers.push((dt) => {
      anim.t += dt;
      const k = clamp(anim.t / 0.55, 0, 1);
      const s = 1.7 * Math.pow(k, 3) - 2.2 * Math.pow(k, 2) + 1.5 * k;  // overshoot
      rec.group.scale.setScalar(Math.max(0.02, k >= 1 ? 1 : s));
      if (k >= 1) { rec.group.scale.setScalar(1); resolve(); return true; }
      return false;
    });
  }));
}

// --------------------------------------------------------------- data flow
async function fetchVillage(retry = true) {
  try {
    const r = await fetch(`/village.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (retry) { await wait(0.5); return fetchVillage(false); }
    throw e;
  }
}

function specById(village) {
  const m = new Map();
  for (const b of village.buildings) m.set(b.id, b);
  return m;
}

function applyVillage(next, { animate }) {
  const prev = state.village;
  state.village = next;
  for (const d of next.districts) state.districts.set(d.id, d);
  const nextSpecs = specById(next);

  // new cleared ground -> fell the trees that stood there
  if (prev && animate) {
    const before = new Set(prev.cleared.map((c) => c.join(',')));
    const fresh = next.cleared.filter((c) => !before.has(c.join(',')));
    if (fresh.length) state.world.fellTrees(fresh, true);
    if (next.paths.length !== prev.paths.length) state.world.buildPaths(next.paths);
  }

  const events = [];
  for (const [id, spec] of nextSpecs) {
    if (!spec.plot) continue;
    const rec = state.byId.get(id);
    if (!rec) {
      const fresh = makeRecord(spec);
      placeFigure(fresh);
      if (animate) events.push({ type: 'arrive', rec: fresh, spec });
      continue;
    }
    const before = rec.spec;
    rec.spec = spec;
    const tierChanged = before.tier !== spec.tier || before.style !== spec.style
      || before.kind !== spec.kind || (before.ornaments || []).join() !== (spec.ornaments || []).join();
    if (tierChanged) {
      const upgraded = TIER_INDEX[spec.tier] > TIER_INDEX[before.tier];
      events.push({ type: upgraded ? 'upgrade' : 'refit', id, spec, silent: !animate });
    }
    if (before.active !== spec.active) events.push({ type: spec.active ? 'start' : 'finish', id, silent: !animate });
  }

  // milestones and districts
  if (prev && animate) {
    const had = new Set(prev.milestones.filter((m) => m.unlocked).map((m) => m.id));
    for (const m of next.milestones) if (m.unlocked && !had.has(m.id)) events.push({ type: 'milestone', m });
    const hadD = new Set(prev.districts.map((d) => d.id));
    for (const d of next.districts) if (!hadD.has(d.id)) events.push({ type: 'district', d });
  }

  // Anyone no longer in the village has left: a visitor who finished, or someone sent
  // away. Take their building out of the scene rather than leaving a ghost standing.
  for (const [id, rec] of [...state.byId]) {
    if (nextSpecs.has(id)) continue;
    if (animate && rec.group.visible) leaveAnimation(rec);
    state.settlers.remove(id);
    setTimeout(() => { if (!specById(state.village).has(id)) disposeRecord(rec); }, animate ? 1000 : 0);
    state.byId.delete(id);
    if (state.selected === id) { state.selected = null; state.ui.closeDossier(); }
  }

  assignFlags();
  applyVisibility();
  refreshUI();
  if (state.walk && state.mode === 'walk') {
    state.walk.setBlockers(walkableBlockers());
    state.walk.setInteractables(interactables());
  }

  if (!animate) { for (const e of events) applyEventInstantly(e); return; }
  for (const e of events) scheduleEvent(e);
}

function placeFigure(rec) {
  if (rec.spec.kind === 'civic') return;
  const p = rec.group.position;
  const f = state.settlers.add(rec.id, rec.spec, [p.x, p.y, p.z]);
  if (f && rec.spec.harbour) f.deckY = p.y + 0.62;
  if (f && rec.spec.active) f.mode = 'hammer';
}

function applyEventInstantly(e) {
  if (e.type === 'upgrade' || e.type === 'refit') {
    const rec = state.byId.get(e.id);
    if (rec) { const fresh = rebuild(rec, e.spec); placeFigureRefresh(fresh); }
  } else if (e.type === 'start') { const r = state.byId.get(e.id); if (r) { addScaffold(r); state.settlers.setMode(e.id, 'hammer'); } }
  else if (e.type === 'finish') { const r = state.byId.get(e.id); if (r) { removeScaffold(r, false); state.settlers.setMode(e.id, 'idle'); } }
}
function placeFigureRefresh(rec) {
  const f = state.settlers.figures.get(rec.id);
  if (f) { f.spec = rec.spec; if (rec.spec.harbour) f.deckY = rec.group.position.y + 0.62; }
  else placeFigure(rec);
  if (rec.spec.active) { addScaffold(rec); state.settlers.setMode(rec.id, 'hammer'); }
}

function scheduleEvent(e) {
  if (e.type === 'arrive') {
    const rec = e.rec;
    rec.popping = true;
    rec.group.visible = false;
    const d = state.districts.get(rec.spec.district);
    if (rec.spec.harbour && d && d.pier && d.pier.length) {
      enqueue({ run: () => sailIn(rec, d), instant: () => { rec.popping = false; rec.group.visible = true; } });
    } else {
      enqueue({ run: () => walkIn(rec), instant: () => { rec.popping = false; rec.group.visible = true; } });
    }
    return;
  }
  if (e.type === 'upgrade') {
    enqueue({
      instant: () => applyEventInstantly(e),
      run: async () => {
        const rec = state.byId.get(e.id);
        if (!rec) return;
        addScaffold(rec);
        state.settlers.setMode(e.id, 'hammer');
        const p = rec.group.position;
        state.particles.puff([p.x, p.y + 0.3, p.z], 10);
        await wait(1.5);
        const fresh = rebuild(rec, e.spec);
        addScaffold(fresh);
        placeFigureRefresh(fresh);
        state.particles.puff([p.x, p.y + 0.3, p.z], 12);
        await wait(0.5);
        if (!e.spec.active) { removeScaffold(fresh); state.settlers.setMode(e.id, 'idle'); }
        assignFlags();
        state.ui.toast(`<b>${e.spec.name}</b> built a ${String(e.spec.tier)}.`);
      },
    });
    return;
  }
  if (e.type === 'refit') {
    const rec = state.byId.get(e.id);
    if (!rec) return;
    const fresh = rebuild(rec, e.spec);
    placeFigureRefresh(fresh);
    const p = fresh.group.position;
    state.particles.puff([p.x, p.y + 0.2, p.z], 7);
    assignFlags();
    return;
  }
  if (e.type === 'start') { applyEventInstantly(e); return; }
  if (e.type === 'finish') { const r = state.byId.get(e.id); if (r) { removeScaffold(r, true); state.settlers.setMode(e.id, 'idle'); } return; }
  if (e.type === 'milestone') { state.ui.toast(`Milestone at ${e.m.at} settlers — <b>${e.m.label}</b> is built.`); return; }
  if (e.type === 'district') { state.ui.toast(`A new district: <b>${e.d.name}</b>.`); return; }
}

async function walkIn(rec) {
  const landing = state.village.island.landing;
  const door = rec.spec.door || [rec.spec.plot.gx + 1, rec.spec.plot.gz + 1];
  const f = state.settlers.figures.get(rec.id);
  if (!landing || !f) { await popIn(rec); return; }
  const [hx, hz] = [f.home[0], f.home[1]];
  await new Promise((resolve) => {
    let settled = false;
    state.settlers.walkIn(rec.id, landing, door, () => { settled = true; resolve(); });
    setTimeout(() => { if (!settled) resolve(); }, 9000);
  });
  if (f) f.home = [hx, hz];
  await popIn(rec);
  state.ui.toast(`<b>${rec.spec.name}</b> arrived and pitched a tent.`);
}

async function sailIn(rec, district) {
  const t = state.terrain;
  const end = district.pier[district.pier.length - 1];
  const [ex, ez] = t.cellWorld(end[0], end[1]);
  const dirX = ex, dirZ = ez;
  const len = Math.hypot(dirX, dirZ) || 1;
  const start = [ex + (dirX / len) * 34, ez + (dirZ / len) * 34];
  const boat = new THREE.Mesh(boatGeo, buildingMat);
  boat.castShadow = true;
  scene.add(boat);
  await new Promise((resolve) => {
    const anim = { t: 0 };
    tickers.push((dt) => {
      anim.t += dt;
      const k = clamp(anim.t / 6, 0, 1);
      const e = k * k * (3 - 2 * k);
      const x = start[0] + (ex - start[0]) * e, z = start[1] + (ez - start[1]) * e;
      boat.position.set(x, 0.03 * Math.sin(anim.t * 2), z);
      boat.rotation.set(0.04 * Math.sin(anim.t * 1.7), Math.atan2(ex - start[0], ez - start[1]), 0.03 * Math.sin(anim.t * 1.3));
      if (k >= 1) { resolve(); return true; }
      return false;
    });
  });
  await popIn(rec, 0.2);
  state.ui.toast(`<b>${rec.spec.name}</b> came ashore at the quay.`);
  await new Promise((resolve) => {
    const anim = { t: 0 };
    tickers.push((dt) => {
      anim.t += dt;
      const k = clamp(anim.t / 7, 0, 1);
      const x = ex + (start[0] - ex) * k, z = ez + (start[1] - ez) * k;
      boat.position.set(x, 0.03 * Math.sin(anim.t * 2), z);
      if (k >= 1) { scene.remove(boat); resolve(); return true; }
      return false;
    });
  });
}

// --------------------------------------------------------------- UI wiring
function refreshUI() {
  const v = state.village;
  state.ui.setVillage(v);
  state.ui.buildLegend(v);
  const now = Date.now();
  const list = v.buildings
    .filter((b) => b.active && b.kind !== 'civic')
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .map((b) => ({
      id: b.id, name: b.name,
      where: b.kind === 'shed' ? `${b.agentType} apprentice` : (state.districts.get(b.district) || {}).name || 'Somewhere',
      since: humanSince(now - new Date(b.startedAt).getTime()),
    }));
  state.ui.setBuilding(list);
  if (state.selected) {
    const spec = specById(v).get(state.selected);
    if (spec) state.ui.showDossier(decorate(spec), { get: (id) => { const s = specById(v).get(id); return s ? decorate(s) : null; } });
  }
}
function humanSince(msv) {
  const m = Math.round(msv / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function decorate(spec) {
  const d = state.districts.get(spec.district);
  return { ...spec, districtName: d ? d.name : null };
}
function select(id) {
  state.selected = id;
  if (!id) return;
  const spec = specById(state.village).get(id);
  if (spec) state.ui.showDossier(decorate(spec), { get: (x) => { const s = specById(state.village).get(x); return s ? decorate(s) : null; } });
}

// --------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerScreen = { x: 0, y: 0 }, downAt = null, moved = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerScreen = { x: e.clientX, y: e.clientY };
  if (downAt) moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
});
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; moved = 0; });
renderer.domElement.addEventListener('pointerup', () => {
  if (moved < 5) {
    const hit = pick();
    if (hit) { select(hit); } else { state.ui.closeDossier(); }
  }
  downAt = null;
});
function pick() {
  ray.setFromCamera(pointer, camera);
  const hits = ray.intersectObjects(state.pickables.filter((m) => m.parent && m.parent.visible), false);
  return hits.length ? hits[0].object.userData.id : null;
}

// --------------------------------------------------------------- loop
let last = performance.now();
const projected = new THREE.Vector3();

// One bad frame must never stop the island: log it once and keep going.
let frameErrors = 0;
function tick(nowMs) {
  if (!contextLost) {
    try {
      frame(nowMs);
    } catch (e) {
      if (frameErrors++ < 3) console.error('frame failed', e);
    }
  }
  requestAnimationFrame(tick);
}

function frame(nowMs) {
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;

  if (state.chronicle.playing) advanceChronicle(dt);

  // ---- controller ---------------------------------------------------------
  const pad = state.pad ? state.pad.poll() : null;
  if (pad) {
    if (!state.padSeen) {
      state.padSeen = true;
      state.ui.toast(`Controller connected. <b>A</b> to walk the island.`);
      state.ui.setPad(true);
    }
    if (state.board && state.board.isOpen()) {
      state.board.pad(pad, dt);           // the stick drives a cursor over the cards
    } else if (state.mode === 'walk') {
      state.walk.pad(pad, dt);
      if (pad.hit(BTN.B) || pad.hit(BTN.START)) exitWalk();
    } else {
      if (pad.hit(BTN.A) || pad.hit(BTN.START)) enterWalk();
      // right stick orbits, left stick pans, triggers zoom
      const look = pad.look, move = pad.move;
      if (look.x || look.y || move.x || move.y || pad.lt > 0.1 || pad.rt > 0.1) {
        const off = camera.position.clone().sub(controls.target);
        const radius = off.length();
        let theta = Math.atan2(off.x, off.z), phi = Math.acos(clamp(off.y / radius, -1, 1));
        theta -= look.x * 1.7 * dt;
        phi = clamp(phi + look.y * 1.2 * dt, 0.14, 1.34);
        const r2 = clamp(radius * (1 + (pad.lt - pad.rt) * 1.1 * dt), controls.minDistance, controls.maxDistance);
        // stick right slides along the camera's right, stick up slides away from the camera
        const pan = radius * 0.5 * dt;
        controls.target.x += (Math.cos(theta) * move.x + Math.sin(theta) * move.y) * pan;
        controls.target.z += (-Math.sin(theta) * move.x + Math.cos(theta) * move.y) * pan;
        controls.target.x = clamp(controls.target.x, -40, 40);
        controls.target.z = clamp(controls.target.z, -40, 40);
        camera.position.set(
          controls.target.x + r2 * Math.sin(phi) * Math.sin(theta),
          controls.target.y + r2 * Math.cos(phi),
          controls.target.z + r2 * Math.sin(phi) * Math.cos(theta),
        );
        state.intro = null;
      }
    }
  }

  // ---- walking ------------------------------------------------------------
  if (state.mode === 'walk') {
    const w = state.walk.update(dt);
    state.ui.setWalkPrompt(w && w.near ? w.near : null);
  }

  for (let i = tickers.length - 1; i >= 0; i--) {
    if (tickers[i](dt)) tickers.splice(i, 1);
  }
  if (state.intro) {
    const s = state.intro;
    s.t += dt;
    const k = clamp(s.t / s.dur, 0, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const az = s.az + 0.55 * (1 - e), el = s.el + 0.14 * (1 - e), dist = s.dist * (1 + 0.32 * (1 - e));
    camera.position.set(s.cx + Math.cos(el) * Math.sin(az) * dist, 1 + Math.sin(el) * dist, s.cz + Math.cos(el) * Math.cos(az) * dist);
    camera.lookAt(s.cx, 1, s.cz);
    if (k >= 1) { state.intro = null; controls.enabled = true; controls.target.set(s.cx, 1, s.cz); controls.update(); }
  }
  if (state.tween) {
    const t = state.tween;
    t.t += dt;
    const k = clamp(t.t / t.dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(t.from, t.to, e);
    camera.position.lerpVectors(t.fromPos, t.toPos, e);
    if (k >= 1) state.tween = null;
  }

  const hour = currentHour();
  const month = new Date(timeNow()).getMonth();
  if (state.world) {
    state.world.update(dt, hour, month);
    buildingMat.userData.uniforms.uNight.value = state.world.state.night;
    if (state.flags) state.flags.material.userData.uniforms.uTime.value = nowMs / 1000;
  }
  if (state.settlers) state.settlers.update(dt, state.world ? state.world.state.night : 0);
  if (state.particles) state.particles.update(dt);

  // per-building animated bits
  const nightAmt = state.world ? state.world.state.night : 0;
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    if (rec.blades) rec.blades.rotation.z += dt * 0.55;
    if (rec.beacon) {
      rec.beacon.a += dt * 0.85;
      rec.beacon.target.position.set(Math.cos(rec.beacon.a) * 16, -2, Math.sin(rec.beacon.a) * 16);
      rec.beacon.light.intensity = 55 * nightAmt;
    }
    if (rec.flame) {
      const s = 1 + 0.16 * Math.sin(nowMs / 1000 * 17 + rec.id.length);
      rec.flame.scale.set(s, 1 + 0.22 * Math.sin(nowMs / 1000 * 13), s);
      if (rec.fire) rec.fire.intensity = 2.4 * (0.85 + 0.15 * Math.sin(nowMs / 1000 * 23));
    }
    if (rec.smokeAnchor && rec.spec.active) {
      rec.smokeT += dt;
      if (rec.smokeT > 0.34) {
        rec.smokeT = 0;
        const v = new THREE.Vector3(...rec.smokeAnchor).applyMatrix4(rec.group.matrixWorld);
        state.particles.smoke([v.x, v.y, v.z]);
      }
    }
    if (rec.flagIdx >= 0) updateFlagInstance(rec, true);
  }

  if (!state.intro && state.mode !== 'walk') {
    controls.update();
    const y = state.terrain ? state.terrain.worldHeight(camera.position.x, camera.position.z) + 0.9 : 0;
    if (camera.position.y < y) camera.position.y = y;
    controls.target.x = clamp(controls.target.x, -34, 34);
    controls.target.z = clamp(controls.target.z, -34, 34);
  }

  if (state.mode !== 'walk') updateLabels();
  state.ui.setClock(hour, state.world ? state.world.season() : seasonOf(month));
  renderer.render(scene, camera);
}

function updateLabels() {
  const items = [];
  let hoverItem = null;
  const hoverId = downAt ? null : pick();
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const isBuild = rec.spec.active && rec.spec.kind !== 'civic';
    if (!isBuild && rec.id !== hoverId) continue;
    projected.set(0, rec.built.height + 0.45, 0).applyMatrix4(rec.group.matrixWorld).project(camera);
    if (projected.z > 1) continue;
    const x = (projected.x + 1) / 2 * innerWidth, y = (1 - projected.y) / 2 * innerHeight;
    const dist = camera.position.distanceTo(rec.group.position);
    if (rec.id === hoverId) {
      hoverItem = { name: rec.spec.name, sub: labelSub(rec.spec), x, y };
    } else if (dist < 48 && items.length < 24) {
      items.push({ text: `${rec.spec.name} · building`, x, y, build: true });
    }
  }
  state.ui.labels(items);
  state.ui.setHover(hoverItem);
  document.body.style.cursor = hoverId ? 'pointer' : '';
}
function labelSub(spec) {
  if (spec.kind === 'civic') return spec.title || '';
  const d = state.districts.get(spec.district);
  const style = (PALETTE[spec.style] || PALETTE.unknown).name;
  return `${spec.kind === 'shed' ? `${spec.agentType} apprentice` : style}${d ? ` · ${d.name}` : ''}`;
}

// --------------------------------------------------------------- chronicle
function chronicleBounds() {
  const v = state.village;
  const start = new Date(v.island.foundedAt).getTime();
  return { start: Math.min(start, ...v.buildings.map((b) => new Date(b.startedAt).getTime())), end: Date.now() };
}
function advanceChronicle(dt) {
  const { start, end } = chronicleBounds();
  const span = Math.max(1, end - start);
  const rate = state.chronicle.speed === 'hour' ? 3600e3 : state.chronicle.speed === 'day' ? 86400e3 : span / 20;
  let t = (state.chronicle.t == null ? start : state.chronicle.t) + rate * dt;
  if (t >= end) { setLiveMode(); return; }
  setChronicleTime(t);
}
function setChronicleTime(t) {
  const { start, end } = chronicleBounds();
  state.chronicle.t = clamp(t, start, end);
  state.live = 'replay';
  state.ui.setLive('replay');
  applyVisibility();
  state.ui.setChronicle({
    fraction: (state.chronicle.t - start) / Math.max(1, end - start),
    date: new Date(state.chronicle.t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    playing: state.chronicle.playing, live: false,
  });
}
function setLiveMode() {
  state.chronicle.t = null;
  state.chronicle.playing = false;
  state.live = 'live';
  state.ui.setLive('live');
  applyVisibility();
  state.ui.setChronicle({ fraction: 1, date: 'Now', playing: false, live: true });
}

// --------------------------------------------------------------- boot
async function boot() {
  state.ui = createUI({
    onFilters: (f) => { state.filters = f; applyVisibility(); },
    onSelect: (id) => { state.selected = id; },
    onFocus: (id) => focusOn(id),
    onOverview: () => { state.intro = null; state.tween = null; controls.enabled = true; frameIsland(); },
    onScrub: (frac) => {
      const { start, end } = chronicleBounds();
      state.chronicle.playing = false;
      if (frac >= 0.999) setLiveMode(); else setChronicleTime(start + (end - start) * frac);
    },
    onPlay: () => {
      const { start } = chronicleBounds();
      state.chronicle.playing = !state.chronicle.playing;
      if (state.chronicle.playing && state.chronicle.t == null) setChronicleTime(start);
      state.ui.setChronicle({ fraction: null, date: state.chronicle.t ? new Date(state.chronicle.t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Now', playing: state.chronicle.playing, live: state.chronicle.t == null });
    },
    onLive: () => setLiveMode(),
    onSpeed: (s) => { state.chronicle.speed = s; },
    onToggleTime: () => {
      const hours = [null, 7, 12, 18.5, 22];
      const i = hours.indexOf(state.hourOverride);
      state.hourOverride = hours[(i + 1) % hours.length];
    },
    onToggleWalk: () => (state.mode === 'walk' ? exitWalk() : enterWalk()),
    onTalk: (id) => talkTo(id),
    onSendAway: (id) => askToSendAway(id),
    onFoundSettler: () => openTownHall(),
  });

  state.townHall = createTownHall(document.body, {
    onInvited: (r) => {
      state.ui.toast(r.adopted
        ? `<b>${r.name || 'A settler'}</b> is moving in.`
        : `<b>${r.name || 'A settler'}</b> left the register.`);
      fetchVillage().then((v) => applyVillage(v, { animate: true })).catch(() => {});
    },
    onFound: () => foundSettler(),
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.newSettler = createNewSettler(document.body, {
    onFounded: (r) => state.ui.toast(`<b>${r.settlerName}</b> is on the way to ${r.cwd.split(/[\/]/).pop()}.`),
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.board = createBoard(document.body, {
    getSettlers: () => state.village.buildings
      .filter((b) => b.kind === 'house' || b.kind === 'camp')
      .map((b) => ({
        id: b.id, name: b.name, cwd: b.cwd, model: b.model,
        jira: !!(b.skills && b.skills.jira),
        modelLabel: (PALETTE[b.style] || PALETTE.unknown).name,
        districtName: (state.districts.get(b.district) || {}).name || null,
      })),
    onDispatch: (r) => {
      state.ui.toast(`<b>${r.settlerName}</b> took ${r.issueKey}.`);
      setTimeout(() => fetchVillage().then((v) => applyVillage(v, { animate: true })).catch(() => {}), 2500);
    },
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.office = createOffice(document.body, {
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.chat = createChat(document.body, {
    onSendAway: (id) => askToSendAway(id),
    onClose: () => {
      if (state.walk) state.walk.setPaused(false);
      // whatever was said is in the transcript now, so let the island catch up
      fetch('/api/rescan', { method: 'POST' }).catch(() => {});
    },
    onBusyChange: () => {},
  });

  state.pad = createGamepad({
    onConnect: (id) => {
      state.ui.setPad(true);
      state.ui.toast(`Controller ready: ${String(id).slice(0, 40)}`);
    },
  });

  let village;
  try {
    village = await fetchVillage();
  } catch (e) {
    state.ui.boot(false, 'The island could not be reached. Is the server running?');
    console.error(e);
    return;
  }
  state.ui.boot(false, 'Raising the island…');
  buildScene(village);
  state.walk = createWalkMode({ scene, camera, terrain: state.terrain, material: buildingMat, dom: renderer.domElement });
  applyVillage(village, { animate: false });
  setLiveMode();
  startIntro();
  state.ui.boot(true);
  requestAnimationFrame(tick);
  connect();
}

function connect() {
  let es;
  const open = () => {
    es = new EventSource('/events');
    es.addEventListener('update', debounce(async () => {
      try {
        const next = await fetchVillage();
        if (state.village && next.generatedAt <= state.village.generatedAt) return;
        applyVillage(next, { animate: state.chronicle.t == null });
      } catch (e) { console.warn('update failed', e); }
    }, 250));
    es.addEventListener('open', () => { if (state.chronicle.t == null) state.ui.setLive('live'); });
    es.onerror = () => { state.ui.setLive('off'); };
  };
  open();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const next = await fetchVillage();
      if (state.village && next.generatedAt > state.village.generatedAt) applyVillage(next, { animate: false });
    } catch { /* ignore */ }
  });
}
function debounce(fn, msv) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), msv); };
}

// a handle for poking at the island from the console
window.settlers = { state, scene, camera, controls, renderer, THREE, frameIsland, focusOn };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  if (state.particles) state.particles.mat.uniforms.uScale.value = innerHeight * 0.5;
});

boot();
