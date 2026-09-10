// Boot, camera, the live feed and the animation queue that turns a data diff into
// something you can watch happen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTerrain } from 'shared/terrain.mjs';
import { clamp, hash32 } from 'shared/rng.mjs';
import { createWorld, seasonOf } from './world.js';
import {
  createBuildingMaterial, buildBuilding, buildScaffoldGeometry, buildBoatGeometry,
  buildCampfireGeometry, buildFlameGeometry, buildBladesGeometry, buildPierGeometry,
  buildBridgeGeometry, bridgeDeckHeights, createFlagMesh, PALETTE, TIER_INDEX,
} from './buildings.js';
import { createSettlers } from './settlers.js';
import { createNameplate } from './nameplate.js';
import { createUI } from './ui.js';
import { createWalkMode } from './walk.js';
import { createInterior, INDOOR_GLOW } from './interior.js';
import { createPeers } from './peers.js';
import { createNet } from './net.js';
import { createHorizon } from './horizon.js';
import { createBoard } from './board.js';
import { createChat } from './chat.js';
import { createOffice } from './office.js';
import { createNewSettler } from './newsettler.js';
import { createTownHall } from './townhall.js';
import { createProps } from './props.js';
import { createCrops } from './crops.js';
import { createMarket, answerOf } from './market.js';
import { createThink } from './think.js';
import { createAvatarStudio } from './studio.js';
import { loadAvatar } from './avatar.js';
import { createWaitingFlags } from './waiting.js';
import { createGamepad, BTN } from './gamepad.js';
import { CROPS, CROP_KINDS, BED_SIZE, ripeIn } from 'shared/crops.mjs';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');

// Anything that goes wrong in the page is reported to the server, so a crash leaves a
// trace in data/server.log instead of only a blank tab.
// A visitor's crash is not ours to write into the log of a machine that is not theirs,
// and the server refuses it anyway - so they keep their troubles to the console. Its own
// flag rather than state.guest, because an error can fire before state exists.
//
// The first report tends to come before the server has said who we are, so anything said
// that early waits in the hall rather than going out and being refused.
let reported = 0;
let visiting = null;          // null until the island answers
const held = [];
function post(message, stack) {
  try {
    const body = JSON.stringify({ message: String(message), stack: stack ? String(stack) : null });
    if (navigator.sendBeacon) navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' }));
    else fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { /* nothing more we can do */ }
}
function setVisiting(guest) {
  if (visiting !== null) return;
  visiting = guest;
  const queue = held.splice(0);
  if (!guest) for (const [m, s] of queue) post(m, s);
}
// An island that never answers is treated as our own, or a crash during boot would
// leave no trace at all.
setTimeout(() => setVisiting(false), 4000);
function report(message, stack) {
  if (reported++ > 6 || visiting === true) return;
  if (visiting === null) { held.push([message, stack]); return; }
  post(message, stack);
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
        skills: b.skills || {},
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
  minDistance: 5, maxDistance: 200, minPolarAngle: 0.12, maxPolarAngle: 1.34,
  rotateSpeed: 0.62, panSpeed: 0.85, zoomSpeed: 0.9, zoomToCursor: true,
});
controls.target.set(0, 1, 0);

const buildingMat = createBuildingMaterial();
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false });

const state = {
  village: null, terrain: null, world: null, settlers: null, ui: null,
  bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
  byId: new Map(), districts: new Map(), pickables: [],
  filters: { code: true, cowork: true, apprentices: true },
  chronicle: { t: null, playing: false, speed: 'day' },
  hourOverride: params.has('hour') ? Number(params.get('hour')) : null,
  hover: null, selected: null, intro: null, tween: null, live: 'live',
  queue: [], running: false, flags: null, particles: null,
  walk: null, board: null, chat: null, pad: null, padSeen: false, mode: 'orbit',
  // The room you are standing in, if any. Walking and being indoors are not two modes:
  // you are still on foot, the room simply owns the camera and the keyboard while you
  // are in it.
  inside: null,
  peers: null, net: null, guest: false, horizon: null, sailing: null,
  props: null, think: null,
  crops: null, market: null, garden: null,
};

// A visitor may walk anywhere and look at anything, but the doors that reach into this
// machine stay shut. The server refuses them regardless; this is so the refusal arrives
// as a sentence rather than as a panel that fails to load.
function keeperOnly(what) {
  if (!state.guest) return false;
  state.ui.toast(`Only whoever lives on this island can ${what}.`);
  return true;
}

// Walking into the office of a district shows what git has to say about that repo.
function openOffice(id) {
  if (keeperOnly('open the district office')) return;
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
  if (keeperOnly('carry on a settler’s session')) return;
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
// What walk mode cannot step through: the solid rectangles of everything standing,
// turned with the plot and moved onto it. A plot rotation is a quarter turn, so the
// rectangles stay axis aligned and only trade their sides.
function walkableBlockers() {
  const out = [];
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const c = Math.cos(rec.group.rotation.y), s = Math.sin(rec.group.rotation.y);
    for (const r of rec.built.solids) {
      out.push({
        x: rec.group.position.x + r.x * c + r.z * s,
        z: rec.group.position.z - r.x * s + r.z * c,
        hx: Math.abs(r.hx * c) + Math.abs(r.hz * s),
        hz: Math.abs(r.hx * s) + Math.abs(r.hz * c),
        id: rec.id,
      });
    }
  }
  // A tree somebody asked for is as solid as a house. A bridge is not: it is walked over.
  if (state.props) out.push(...state.props.blockers());
  return out;
}

function interactables() {
  const out = [];
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const p = rec.group.position;
    if (rec.spec.civicType === 'board') {
      out.push({ id: rec.id, kind: 'board', x: p.x, z: p.z, r: 3.0, label: rec.spec.title || 'the sprint board' });
    } else if (rec.spec.civicType === 'issues') {
      out.push({ id: rec.id, kind: 'issues', x: p.x, z: p.z, r: 3.0, label: rec.spec.title || 'the island board' });
    } else if (rec.spec.civicType === 'office') {
      out.push({ id: rec.id, kind: 'office', x: p.x, z: p.z, r: 2.4, label: rec.spec.name });
    } else if (rec.spec.civicType === 'townhall') {
      out.push({ id: rec.id, kind: 'townhall', x: p.x, z: p.z, r: 3.2, label: 'the town hall' });
    } else if (rec.spec.civicType === 'market') {
      out.push({ id: rec.id, kind: 'market', x: p.x, z: p.z, r: 2.8, label: 'the seed stall' });
    } else if (rec.spec.civicType === 'tavern') {
      out.push({
        id: rec.id, kind: 'tavern', room: 'tavern', x: p.x, z: p.z, r: 2.4,
        label: 'the tavern', prompt: 'step into the tavern',
      });
    } else if (rec.spec.kind !== 'civic') {
      out.push({ id: rec.id, kind: 'house', x: p.x, z: p.z, r: 1.9, label: rec.spec.name });
    }
  }
  // The vegetable beds. `label` names the place, for the panel and for "where am I";
  // the prompt above the keys counts the last minutes down on its own.
  if (state.crops) {
    for (const bed of state.crops.list()) {
      const c = CROPS[bed.kind];
      out.push({
        id: bed.id, kind: 'bed', crop: bed.kind, ripeAt: bed.ripeAt,
        x: bed.x, z: bed.z, r: 1.1,
        label: `a bed of ${c ? c.plural : bed.kind}`,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------- where you are
// The village is a picture of the sessions; this is the one thing the island knows
// about the reader. It is kept so that "here" means something: a thought asked to put
// a bridge here has to be able to find out where here is.
let whereSentAt = 0;
let whereLastX = null, whereLastZ = null;

function reportWhere({ final = false } = {}) {
  // Where the keeper stands is written down so an agent at the command line can find
  // them. A visitor is not who that is about, and the server refuses them anyway.
  if (state.guest) return;
  const w = state.walk && state.walk.state;
  if (!w || !w.pos) return;
  const now = performance.now();
  const moved = whereLastX == null || Math.hypot(w.pos.x - whereLastX, w.pos.z - whereLastZ) > 0.4;
  if (!final && (!moved || now - whereSentAt < 1500)) return;
  whereSentAt = now;
  whereLastX = w.pos.x;
  whereLastZ = w.pos.z;
  fetch('/api/where', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      x: w.pos.x, y: w.pos.y, z: w.pos.z, yaw: w.yaw,
      walking: state.mode === 'walk',
      near: whatIsNear(w),
      final,
    }),
  }).catch(() => { /* the island can lose track of you without any harm done */ });
}

// A name for where you are, for the prompt and the panel's subtitle. Whatever is
// within reach, then whatever is merely nearby, then the district you are standing in.
function whatIsNear(w) {
  if (w.near && w.near.label) return w.near.label;
  let best = null, bestD = 9;
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    const d = Math.hypot(rec.group.position.x - w.pos.x, rec.group.position.z - w.pos.z);
    if (d < bestD) { bestD = d; best = rec.spec.name; }
  }
  if (best) return best;
  const p = state.props && state.props.nearest(w.pos.x, w.pos.z, 5);
  if (p) return p.label || `a ${p.kind}`;
  const bed = state.crops && state.crops.nearest(w.pos.x, w.pos.z, 4);
  if (bed) return `a bed of ${(CROPS[bed.kind] || {}).plural || bed.kind}`;
  return null;
}

// --------------------------------------------------------------- having a thought
// Wherever you are standing, T opens a session in the island's own repository and
// tells it where you are. It can answer, and it can build.
function openThink() {
  if (keeperOnly('think out loud here')) return;   // it starts a session on this machine
  if (!state.think || state.think.isOpen()) return;
  if (state.walk) state.walk.setPaused(true);
  state.ui.closeDossier();
  reportWhere({ final: true });
  state.think.open();
}

// --------------------------------------------------------------- what was built
async function refreshProps({ animate = true } = {}) {
  if (!state.props) return;
  try {
    const r = await fetch('/api/props', { cache: 'no-store' });
    const body = await r.json();
    const before = state.props.count();
    state.props.apply(body.props || [], { animate });
    const after = state.props.count();
    if (state.mode === 'walk') state.walk.setBlockers(walkableBlockers());
    if (animate && after > before) {
      const n = after - before;
      state.ui.toast(`${n === 1 ? 'Something was' : `${n} things were`} built on the island.`);
    }
  } catch (e) {
    console.warn('could not read what has been built', e);
  }
}

// --------------------------------------------------------------- market gardening
// The purse and the pouch belong to whoever lives here, so the keeper reads the whole
// garden and a visitor reads only the beds - shapes and places, like the props.
let gardenComplaint = false;
async function refreshGarden({ animate = true } = {}) {
  if (!state.crops) return;
  try {
    if (state.guest) {
      const body = await answerOf(await fetch('/api/crops', { cache: 'no-store' }));
      state.crops.apply(body.crops || [], { animate });
    } else {
      const garden = await answerOf(await fetch('/api/garden', { cache: 'no-store' }));
      state.garden = garden;
      state.crops.apply(garden.beds || [], { animate });
    }
    if (state.mode === 'walk') state.walk.setInteractables(interactables());
  } catch (e) {
    // Said once. A page whose island cannot answer for the garden would otherwise
    // repeat itself on every update, and the thing to do about it does not change.
    console.warn('the garden could not be read', e);
    if (!gardenComplaint) {
      gardenComplaint = true;
      state.ui.toast(escapeHtml(e.message || 'the garden could not be read'));
    }
  }
}

// Every button and key that changes the garden comes through here, so a refusal is
// worded once and the beds, the purse and the prompts are brought back into line
// together.
async function tend(body, said) {
  if (keeperOnly('do the farming here')) return null;
  try {
    const answer = await answerOf(await fetch('/api/garden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    state.garden = answer.garden;
    state.crops.apply(answer.garden.beds || [], { animate: true });
    if (state.mode === 'walk') state.walk.setInteractables(interactables());
    if (said) state.ui.toast(said(answer));
    return answer;
  } catch (e) {
    state.ui.toast(escapeHtml(e.message || 'the island did not answer'));
    return null;
  }
}

// A bed goes in under the gardener's feet. Walk mode already refuses to let anyone
// stand inside a wall, so the only thing left to check here is that a bed - which is
// wider than a person - still fits; the island itself judges the ground.
function sowHere() {
  if (state.mode !== 'walk') return;
  if (keeperOnly('sow a bed on this island')) return;
  const w = state.walk.state;
  const g = state.garden;
  if (!g || !g.held) {
    state.ui.toast(g && Object.keys(g.seeds || {}).length
      ? 'No seed in hand. <b>Q</b> takes the next kind out of the pouch.'
      : 'Nothing to sow. The seed stall at the market sells turnip seed.');
    return;
  }
  const x = w.pos.x, z = w.pos.z;
  if (!state.walk.roomFor(x, z, BED_SIZE / 2 + 0.1)) {
    state.ui.toast('There is no room for a bed here. Try a step into the open.');
    return;
  }
  const c = CROPS[g.held];
  tend({ op: 'plant', kind: g.held, x, z, rot: w.yaw }, (a) => `<b>${escapeHtml(c.name)}</b> sown${a.salt ? ' in the salt air, which sets two extra pods' : ''}. Ready in ${escapeHtml(ripeIn(a.bed.ripeAt - Date.now()))}.`);
}

// Which seed is in hand, one press at a time, in the order the stall lists them.
function nextSeed() {
  if (keeperOnly('go through this island’s seed pouch')) return;
  const g = state.garden;
  const have = g ? CROP_KINDS.filter((k) => (g.seeds || {})[k]) : [];
  if (!have.length) { state.ui.toast('The pouch is empty. The stall at the market sells seed.'); return; }
  const next = have[(have.indexOf(g.held) + 1) % have.length];
  tend({ op: 'hold', kind: next }, () => `<b>${escapeHtml(CROPS[next].name)}</b> seed in hand — ${(g.seeds || {})[next]} left.`);
}

function pullBed(id) {
  const bed = state.crops && state.crops.list().find((b) => b.id === id);
  if (!bed) return;
  if (!bed.ripe) { state.ui.toast(`Another ${escapeHtml(ripeIn(bed.leftMs))} for those.`); return; }
  tend({ op: 'harvest', id }, (a) => {
    const c = CROPS[a.kind];
    return `${a.count} ${escapeHtml(a.count === 1 ? c.name.toLowerCase() : c.plural)} in the basket. The stall at the market buys them.`;
  });
}

function digBed(id) {
  tend({ op: 'dig', id }, (a) => `The ${escapeHtml(CROPS[a.kind].name.toLowerCase())} bed is turned back over.`);
}

// What the strip along the bottom says while you walk. The ripe count is recounted
// here rather than taken from the island: beds come ready while you are standing in
// the field, and nothing needs to be asked of the server when they do.
function pouch() {
  const g = state.garden;
  if (!g) return null;
  const c = CROPS[g.held];
  return {
    purse: g.purse,
    seeds: g.seeds || {},
    held: g.held,
    heldName: c ? c.name : g.held,
    ripe: state.crops ? state.crops.list().filter((b) => b.ripe).length : 0,
  };
}

function openMarket() {
  if (keeperOnly('trade at the seed stall')) return;
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.ui.closeDossier();
  state.market.open();
}

// What the keys do while you are out on the island. Lifted out of `enterWalk` because
// stepping back out of a room re-enters walk mode, and a second copy of this list would
// drift away from the first one.
function walkCallbacks() {
  return {
    onInteract: (it) => {
      if (it.kind === 'board') { if (keeperOnly('read the sprint board')) return; state.walk.setPaused(true); state.board.open('jira'); }
      else if (it.kind === 'issues') { if (keeperOnly('read the island board')) return; state.walk.setPaused(true); state.board.open('github'); }
      else if (it.kind === 'office') openOffice(it.id);
      else if (it.kind === 'townhall') openTownHall();
      else if (it.kind === 'market') openMarket();
      else if (it.kind === 'tavern') enterInterior(it.room, it);
      else if (it.kind === 'bed') pullBed(it.id);
      else talkTo(it.id);
    },
    onSendAway: (it) => {
      if (it.kind === 'bed') { digBed(it.id); return; }
      if (!['board', 'issues', 'townhall', 'office', 'market', 'tavern'].includes(it.kind)) askToSendAway(it.id);
    },
    onThink: () => openThink(),
    onPlant: () => sowHere(),
    onNextSeed: () => nextSeed(),
    onExit: () => exitWalk(),
  };
}

// --------------------------------------------------------------- stepping inside
// A room is built the first time you visit it and kept afterwards: its walk mode hangs
// listeners on the window, so a fresh one per visit would pile them up.
const rooms = new Map();
let cameFrom = null;

function enterInterior(room, at) {
  if (state.inside || state.mode !== 'walk') return;
  let inside = rooms.get(room);
  if (!inside) {
    try {
      inside = createInterior({
        room, camera, material: buildingMat, dom: renderer.domElement,
        onLeave: () => leaveInterior(),
      });
    } catch (e) {
      console.error('that room could not be built', e);
      state.ui.toast('That door does not open yet.');
      return;
    }
    rooms.set(room, inside);
  }
  // Where to put you back down, and what to face when you get there: the door you just
  // walked through.
  const w = state.walk.state;
  cameFrom = { at: [w.pos.x, w.pos.z], facing: at ? [at.x, at.z] : null };
  state.walk.exit();
  state.inside = inside;
  inside.enter({ avatar: loadAvatar() });
  state.ui.setIndoors(true);
  state.ui.setWalkPrompt(null);
  if (state.net) state.net.setWalking(false);   // nobody out on the island can see you in here
}

function leaveInterior() {
  if (!state.inside) return;
  state.inside = null;
  state.ui.setIndoors(false);
  state.ui.setWalkPrompt(null);
  if (state.net) state.net.setWalking(true);
  // Still on foot: walk mode picks up again on the step outside the door.
  state.walk.enter({
    at: (cameFrom && cameFrom.at) || [0, 0],
    facing: cameFrom && cameFrom.facing,
    blockers: walkableBlockers(),
    interactables: interactables(),
    ...walkCallbacks(),
  });
  reportWhere({ final: true });
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
  if (state.net) state.net.setWalking(true);
  state.walk.enter({
    at,
    facing,
    blockers: walkableBlockers(),
    interactables: interactables(),
    ...walkCallbacks(),
  });
  reportWhere({ final: true });   // "here" is worth knowing before you have taken a step
}

function foundSettler() {
  if (keeperOnly('send for a new settler')) return;
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.newSettler.open();
}

// Dressing the settler you walk as. Anyone may do it - it is your own look, on your own
// screen, and touches nothing that belongs to the island - so it is not behind keeperOnly.
function openStudio() {
  if (!state.studio || state.studio.isOpen()) return;
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.studio.open();
}

// The town hall keeps the register of every session this machine remembers.
function openTownHall() {
  if (keeperOnly('read the register')) return;
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.townHall.open();
}

// --------------------------------------------------------------- sending someone away
// Two steps, always: nobody leaves the island on a single keypress.
let pendingExile = null;
function askToSendAway(id) {
  if (keeperOnly('send a settler off the island')) return;
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
  // Straight from a bar stool to the sky: leave the room on the way out, or the island
  // would still believe you were indoors when you next came down.
  if (state.inside) {
    const room = state.inside;
    state.inside = null;
    room.leave();
    state.ui.setIndoors(false);
  }
  state.mode = 'orbit';
  if (state.net) state.net.setWalking(false);
  state.walk.setPeerBlockers([]);
  reportWhere({ final: true });   // write down where you left off, and that you left
  state.walk.exit();
  state.board.close();
  if (state.think) state.think.close();
  state.ui.setWalking(false);
  controls.enabled = true;
  frameIsland();
}

// --------------------------------------------------------------- neighbours
// Other islands on the network, lying out on the water. Only ever our own: the list names
// other machines, so the server tells nobody but the keeper.
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function bearingWord(n) {
  // Looking down the map, -z is north and +x is east.
  const a = Math.atan2(n.x, -n.z);
  return COMPASS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

async function refreshNeighbours() {
  try {
    const r = await fetch('/api/neighbours').then((x) => x.json());
    applyNeighbours(r.neighbours || []);
  } catch { /* no beacon, no neighbours, no matter */ }
}

function applyNeighbours(list) {
  if (!state.horizon || state.guest) return;
  const arrived = state.horizon.apply(list);
  // The haze normally swallows everything past 235 units, which is exactly where the
  // neighbours lie. Push it back only while there is somebody out there to see.
  if (scene.fog) scene.fog.far = state.horizon.count() ? 300 : 235;
  for (const n of arrived) {
    const mark = state.horizon.find(n.id);
    state.ui.toast(
      `<b>${escapeHtml(n.name)}</b> is keeping an island off to the ${mark ? bearingWord(mark) : 'west'}.`
      + ` <button class="act" type="button">Sail over</button>`
      + ` <button class="act ghost" type="button">Later</button>`,
      (card) => {
        const [go, later] = card.querySelectorAll('button');
        go.addEventListener('click', () => { card.remove(); visitNeighbour(n.id); });
        later.addEventListener('click', () => card.remove());
      },
    );
  }
}

// Clicking an island on the horizon does not simply take you there: it is somebody
// else's machine, and leaving is worth a moment's thought.
function askToVisit(pickId) {
  const n = state.horizon && state.horizon.find(pickId);
  if (!n) return;
  state.ui.toast(
    `Sail over to <b>${escapeHtml(n.name)}</b>?`
    + ` <span class="muted">You will be a visitor there.</span>`
    + ` <button class="act" type="button">Sail</button>`
    + ` <button class="act ghost" type="button">Stay</button>`,
    (card) => {
      const [go, stay] = card.querySelectorAll('button');
      go.addEventListener('click', () => { card.remove(); visitNeighbour(n.id); });
      stay.addEventListener('click', () => card.remove());
    },
  );
}

// Sailing over is a real crossing to their server: their island, their rules, and you
// arrive there as a visitor. The animation is the handover, not a trick - the page really
// does go there.
function visitNeighbour(id) {
  if (state.sailing) return;
  const n = state.horizon && state.horizon.find(id);
  if (!n) return;
  if (state.mode === 'walk') exitWalk();
  state.intro = null;
  state.tween = null;
  controls.enabled = false;
  state.ui.closeDossier();
  state.ui.toast(`Sailing to <b>${escapeHtml(n.name)}</b>…`);

  const target = new THREE.Vector3(n.x * 0.45, 16, n.z * 0.45);
  state.sailing = { t: 0, dur: 2.6, from: camera.position.clone(), target, to: n, gone: false };
  // The crossing is driven by the animation, and animation stops in a tab nobody is
  // looking at. Without this you could start a journey, switch away, and come back to a
  // frozen sea - so the arrival is on a clock as well, and whichever comes first wins.
  setTimeout(() => { if (state.sailing) cross(state.sailing); }, 2.6 * 1000 + 1500);
}

function cross(s) {
  if (s.gone) return;
  s.gone = true;
  const url = new URL(s.to.url);
  url.searchParams.set('arrive', state.village && state.village.island ? state.village.island.name : 'a neighbour');
  location.href = url.toString();
}

function sail(dt) {
  const s = state.sailing;
  s.t += dt;
  const k = clamp(s.t / s.dur, 0, 1);
  const e = k * k * (3 - 2 * k);
  camera.position.lerpVectors(s.from, s.target, e);
  camera.lookAt(s.to.x, 4, s.to.z);
  const veil = document.getElementById('veil');
  if (veil) veil.style.opacity = String(clamp((k - 0.5) / 0.5, 0, 1));
  if (k >= 1) cross(s);
}

// Coming in off the water onto somebody else's island, on the bearing we left on.
function comeAshore(from) {
  // Lift the water off the screen on a timer, not on an animation frame. A tab that is
  // not being looked at stops animating, and a veil that only clears on the next frame
  // would leave somebody staring at a black rectangle.
  const veil = document.getElementById('veil');
  if (veil) {
    veil.style.opacity = '1';
    veil.style.transition = 'opacity 1.1s ease';
    setTimeout(() => { veil.style.opacity = '0'; }, 40);
  }
  const a = (hash32(String(from)) / 4294967296) * Math.PI * 2;
  const cx = Math.sin(a) * 120, cz = Math.cos(a) * 120;
  camera.position.set(cx, 26, cz);
  controls.target.set(0, 1, 0);
  controls.enabled = false;
  state.tween = {
    t: 0, dur: 3.4,
    from: controls.target.clone(), to: new THREE.Vector3(0, 1, 0),
    fromPos: camera.position.clone(), toPos: new THREE.Vector3(cx * 0.28, 15, cz * 0.28),
    onDone: () => { controls.enabled = true; },
  };
  // The way back comes from the browser, not from our own URL: sessionStorage belongs to
  // the origin we just left, and a "from" parameter would be a link anyone could write
  // for us. The referrer is the one account of where we came from that we did not author.
  let home = null;
  try {
    const r = document.referrer && new URL(document.referrer);
    if (r && /^https?:$/.test(r.protocol) && r.origin !== location.origin) home = `${r.origin}/`;
  } catch { /* no referrer, no way home but the back button */ }
  state.ui.toast(
    `You have come ashore on <b>${escapeHtml(state.village && state.village.island ? state.village.island.name : 'this island')}</b>, from ${escapeHtml(from)}.`
    + (home ? ` <button class="act ghost" type="button">Sail home to ${escapeHtml(new URL(home).host)}</button>` : ''),
    home ? (card) => {
      const b = card.querySelector('button');
      b && b.addEventListener('click', () => { location.href = home; });
    } : null,
  );
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
    modest,
  });
  state.settlers = createSettlers(scene, buildingMat, terrain);
  syncBridges(village);
  state.settlers.setRoads(roadCells(village), state.world.squareCells(village));
  state.particles = createParticles();
  state.waitingFlags = createWaitingFlags(scene);
  state.flags = createFlagMesh(200);
  scene.add(state.flags);

  syncHamlets(village);
  frameIsland();
}

// ---- bridges ---------------------------------------------------------------
// A crossing is built once and recorded in the layout, so it is drawn the way the quay's
// planks are: keyed by id, added when it first appears, never rebuilt. `decks` is where
// every deck cell is and how high it rides, which is what lets a settler walk over a
// river instead of through it.
const bridgeGroup = new THREE.Group();
const bridgeMeshes = new Map();
let decks = new Map();

function syncBridges(village) {
  if (!bridgeGroup.parent) scene.add(bridgeGroup);
  const terrain = state.terrain;
  const list = village.bridges || [];
  decks = new Map();
  for (const [i, b] of list.entries()) {
    const key = `${b.id}#${i}`;
    for (const [gx, gz, y] of bridgeDeckHeights(b.cells, terrain, b.axis)) {
      decks.set(gx + gz * terrain.size, y);
    }
    if (bridgeMeshes.has(key)) continue;
    const [x, z] = terrain.cellWorld(b.cells[0][0], b.cells[0][1]);
    const g = buildBridgeGeometry(b.cells, terrain, [x, z], b.axis);
    if (!g) continue;
    const m = new THREE.Mesh(g, buildingMat);
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    bridgeGroup.add(m);
    bridgeMeshes.set(key, m);
  }
  if (state.settlers) state.settlers.setDecks(decks);
  if (state.walk) state.walk.setDecks(decks);
}

// The road network a settler may walk: the paths, the squares, and the decks - a bridge
// carries no road surface of its own, so without it every crossing is a hole in the graph
// and the hamlet on the far bank is unreachable on foot.
function roadCells(village) {
  return [...(village.paths || []), ...(village.bridges || [])];
}

// A hamlet's name, on a board at its green, and the quay's planks. A lone farmstead gets
// neither: it is one house in the countryside, not a place with a name.
const hamletGroup = new THREE.Group();
const hamletSigns = new Map();

function titleCaseName(s) {
  return String(s || '').split(/[\s_]+/).filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function syncHamlets(village) {
  if (!hamletGroup.parent) scene.add(hamletGroup);
  const terrain = state.terrain;
  const live = new Set();

  for (const d of village.districts) {
    state.districts.set(d.id, d);
    if (d.pier && d.pier.length && !hamletSigns.has(`pier:${d.id}`)) {
      const [px, pz] = terrain.cellWorld(d.center[0], d.center[1]);
      const g = buildPierGeometry(d.pier, terrain, [px, pz]);
      if (g) {
        const pm = new THREE.Mesh(g, buildingMat);
        pm.position.set(px, 0, pz);
        pm.receiveShadow = true;
        hamletGroup.add(pm);
        hamletSigns.set(`pier:${d.id}`, { group: pm, dispose: () => pm.geometry.dispose() });
      }
    }
    if (!d.center || d.tier === 'farmstead') continue;
    for (const [li, lobe] of (d.lobes || []).entries()) {
      const key = `${d.id}#${li}`;
      live.add(key);
      const [gx, gz] = lobe.green || d.center;
      const [x, z] = terrain.cellWorld(gx, gz);
      const half = ((lobe.size || 3) - 1) / 2;
      // On the green's edge facing away from its own middle, so it does not stand in the
      // way of the well and the settlers who gather there.
      const sx = x, sz = z + half + 0.2;
      const have = hamletSigns.get(key);
      if (have && have.text === d.name) { have.group.position.y = groundAt(sx, sz); continue; }
      if (have) { hamletGroup.remove(have.group); have.dispose(); }
      const sign = createNameplate(titleCaseName(d.name), {
        width: 2.1, height: 0.62, canvasW: 768, band: d.hue, height0: 0.95, posts: 2,
      });
      sign.group.position.set(sx, groundAt(sx, sz), sz);
      sign.group.userData.id = `district:${d.id}`;
      hamletGroup.add(sign.group);
      hamletSigns.set(key, { ...sign, text: d.name, popped: !have });
    }
  }
  for (const [key, rec] of [...hamletSigns]) {
    if (key.startsWith('pier:') || live.has(key)) continue;
    hamletGroup.remove(rec.group);
    rec.dispose();
    hamletSigns.delete(key);
  }
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
  // Measured once, here, so the fit above and the pan clamps below read one place rather
  // than three numbers that each have to be remembered when the island changes size.
  state.bounds = { minX, maxX, minZ, maxZ };
  // fit the wider of the two spans, then pull in a little so the island fills the frame
  const r = 0.5 * Math.max(maxX - minX, maxZ - minZ) + 2;
  const fov = camera.fov * Math.PI / 180;
  // The ceiling of 88 was sized for a 64 grid. On this island the computed fit is about
  // 122, so the coast was being cropped at boot.
  const dist = clamp((r / Math.tan(fov / 2)) * 0.82, 22, 175);
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
    if (next.paths.length !== prev.paths.length || (next.bridges || []).length !== (prev.bridges || []).length) {
      syncBridges(next);
      state.world.buildPaths(next.paths, state.world.squareCells(next));
      state.settlers.setRoads(roadCells(next), state.world.squareCells(next));
    }
  }

  // Outside the `animate` guard on purpose: the hedges and the tint have to be right on
  // a silent reload too, and only the falling trees are an animation.
  if (state.world && (!prev || next.districtsRev !== prev.districtsRev)) {
    state.world.setOwnership(next);
    syncHamlets(next);
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
  refreshWaitingFlags();
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
// A pole over every house whose session has stopped and is waiting on a person.
function refreshWaitingFlags() {
  if (!state.waitingFlags) return;
  const entries = [];
  for (const rec of state.byId.values()) {
    const w = rec.spec && rec.spec.waiting;
    if (!w || !rec.group.visible) continue;
    const p = rec.group.position;
    entries.push({ id: rec.id, x: p.x, y: p.y, z: p.z, height: rec.built.height + 0.15, asked: !!w.asked });
  }
  state.waitingFlags.update(entries);
}

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
  // Anyone who has stopped and is waiting on you, questions first, then whoever has
  // been standing there longest.
  const waiting = v.buildings
    .filter((b) => b.waiting)
    .sort((a, b) => (b.waiting.asked ? 1 : 0) - (a.waiting.asked ? 1 : 0) || b.waiting.quietFor - a.waiting.quietFor)
    .map((b) => ({
      id: b.id, name: b.name,
      asked: !!b.waiting.asked,
      question: b.waiting.question,
      since: humanSince(b.waiting.quietFor),
    }));
  state.ui.setBuilding(list, waiting);
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
  return { ...spec, districtName: d ? d.name : null, subPath: subPathOf(spec, d) };
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
    if (hit && String(hit).startsWith('neighbour:')) askToVisit(hit);
    else if (hit) { select(hit); } else { state.ui.closeDossier(); }
  }
  downAt = null;
});
// The last ray hit that landed on a person rather than on a building, so the label can
// follow them down the street instead of sitting on the roof they came from.
let pickedFigure = null;
// Testing several hundred instanced people costs real time, and past this distance
// they are a couple of pixels anyway, so only look for them once the camera is close.
const PEOPLE_PICK_RANGE = 42;

function pick() {
  ray.setFromCamera(pointer, camera);
  const buildings = ray.intersectObjects(state.pickables.filter((m) => m.parent && m.parent.visible), false);
  const b = buildings[0] || null;

  pickedFigure = null;
  if (state.settlers && controls.getDistance() < PEOPLE_PICK_RANGE) {
    const people = ray.intersectObjects(state.settlers.pickables(), false);
    const p = people[0];
    // A person standing in a doorway is nearer the eye than the wall behind them, and
    // is the smaller target, so give them the tie.
    if (p && (!b || p.distance <= b.distance + 0.5)) {
      const f = state.settlers.figureAt(p.object, p.instanceId);
      if (f) { pickedFigure = f; return f.id; }
    }
  }
  return b ? b.object.userData.id : null;
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
        const wb = state.bounds;
        controls.target.x = clamp(controls.target.x, wb.minX - 3, wb.maxX + 3);
        controls.target.z = clamp(controls.target.z, wb.minZ - 3, wb.maxZ + 3);
        camera.position.set(
          controls.target.x + r2 * Math.sin(phi) * Math.sin(theta),
          controls.target.y + r2 * Math.cos(phi),
          controls.target.z + r2 * Math.sin(phi) * Math.cos(theta),
        );
        state.intro = null;
      }
    }
  }

  // ---- the other people ---------------------------------------------------
  // Outside the walking branch on purpose: from up here you should be able to watch
  // somebody crossing the island.
  if (state.peers) {
    state.peers.update(dt);
    if (state.mode === 'walk') state.walk.setPeerBlockers(state.peers.blockers());
  }

  // ---- walking ------------------------------------------------------------
  if (state.inside) {
    const w = state.inside.update(dt);
    state.ui.setWalkPrompt(w && w.near ? w.near : null);
    state.ui.setPouch(null);              // the purse is for the seed stall, not for the bar
  } else if (state.mode === 'walk') {
    const w = state.walk.update(dt);
    state.ui.setWalkPrompt(w && w.near ? w.near : null);
    state.ui.setPouch(state.guest ? null : pouch());
    reportWhere();
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
    if (k >= 1) { const done = t.onDone; state.tween = null; if (done) done(); }
  }

  const hour = currentHour();
  const month = new Date(timeNow()).getMonth();
  if (state.world) {
    state.world.update(dt, hour, month);
    // The island keeps its clock while you are indoors - it is the same afternoon when
    // you come back out - but a room with its shutters closed does not brighten at noon.
    buildingMat.userData.uniforms.uNight.value = state.inside ? INDOOR_GLOW : state.world.state.night;
    if (state.flags) state.flags.material.userData.uniforms.uTime.value = nowMs / 1000;
  }
  if (state.settlers) state.settlers.update(dt, state.world ? state.world.state.night : 0);
  if (state.horizon) state.horizon.update(dt, state.world ? state.world.state.night : 0);
  if (state.sailing) sail(dt);
  if (state.particles) state.particles.update(dt);
  if (state.waitingFlags) state.waitingFlags.tick(nowMs / 1000, state.world ? state.world.state.night : 0);
  if (state.props) state.props.update(dt);
  if (state.crops) state.crops.update(dt);

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
    const b = state.bounds;
    controls.target.x = clamp(controls.target.x, b.minX - 3, b.maxX + 3);
    controls.target.z = clamp(controls.target.z, b.minZ - 3, b.maxZ + 3);
    if (state.world) state.world.followShadow(controls.target.x, controls.target.z);
  }

  if (state.mode !== 'walk') updateLabels();
  state.ui.setClock(hour, state.world ? state.world.season() : seasonOf(month));
  renderer.render(state.inside ? state.inside.scene : scene, camera);
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
  // If the hover landed on a person, name them where they stand. A settler out on an
  // errand can be streets away from the house the label would otherwise sit on.
  // hoverId is null while the pointer is down, and then pick() has not run, so the
  // figure it last found must not go on labelling the screen through a camera drag.
  const who = hoverId ? pickedFigure : null;
  if (who && who.visible) {
    const rec = state.byId.get(who.id);
    const spec = rec ? rec.spec : who.spec;
    projected.set(who.pos[0], (who.y || 0) + 0.62, who.pos[1]).project(camera);
    if (projected.z <= 1) {
      hoverItem = {
        name: spec.name,
        sub: labelSub(spec),
        x: (projected.x + 1) / 2 * innerWidth,
        y: (1 - projected.y) / 2 * innerHeight,
      };
    }
  }
  // The neighbours, named where they lie. They are far past the buildings' distance
  // cut-off, so they get their own pass rather than an exception in the one above.
  if (state.horizon) {
    for (const m of state.horizon.marks()) {
      projected.set(m.x, m.y, m.z).project(camera);
      if (projected.z > 1) continue;
      const x = (projected.x + 1) / 2 * innerWidth, y = (1 - projected.y) / 2 * innerHeight;
      if (hoverId === `neighbour:${m.id}`) {
        hoverItem = { name: m.name, sub: `${m.island} · ${m.settlers} settler${m.settlers === 1 ? '' : 's'} · click to sail over`, x, y };
      } else {
        items.push({ text: m.name, x, y });
      }
    }
  }

  state.ui.labels(items);
  state.ui.hamletLabels(hamletCaptions());
  state.ui.setHover(hoverItem);
  document.body.style.cursor = hoverId ? 'pointer' : '';
}

// Names over the greens, crossfaded against the wooden boards: readable from the air,
// gone by the time you can read the sign itself.
function hamletCaptions() {
  const v = state.village;
  if (!v || !state.terrain) return [];
  const dist = camera.position.distanceTo(controls.target);
  const t = clamp((dist - 30) / 16, 0, 1);
  const opacity = t * t * (3 - 2 * t);                        // smoothstep
  if (opacity < 0.02) return [];
  const out = [];
  for (const d of v.districts) {
    if (!d.center || d.tier === 'farmstead') continue;
    for (const lobe of d.lobes || []) {
      const [gx, gz] = lobe.green || d.center;
      const [x, z] = state.terrain.cellWorld(gx, gz);
      projected.set(x, groundAt(x, z) + 1.9, z).project(camera);
      if (projected.z > 1) continue;
      out.push({
        text: titleCaseName(d.name), hue: d.hue, opacity,
        x: (projected.x + 1) / 2 * innerWidth,
        y: (1 - projected.y) / 2 * innerHeight,
      });
    }
  }
  return out;
}
// Which folder inside the repository this session worked in, if it was not the root.
// One hamlet per repository is the point, but the detail should not be lost with it.
function subPathOf(spec, d) {
  if (!d || !d.root || !spec.cwd) return null;
  const root = d.root.toLowerCase(), cwd = spec.cwd.toLowerCase();
  if (cwd === root || !cwd.startsWith(`${root}\\`)) return null;
  return spec.cwd.slice(d.root.length + 1).split('\\').join('/');
}

function labelSub(spec) {
  if (spec.kind === 'civic') return spec.title || '';
  const d = state.districts.get(spec.district);
  const style = (PALETTE[spec.style] || PALETTE.unknown).name;
  const sub = subPathOf(spec, d);
  const where = d ? ` · ${d.name}${sub ? `/${sub}` : ''}` : '';
  return `${spec.kind === 'shed' ? `${spec.agentType} apprentice` : style}${where}`;
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
// The worker caches nothing; it exists so the browser will offer to install the island.
// Browsers only allow one on a secure origin, which is localhost or https - a visitor on
// http://msi:4747 can still add the page to their home screen by hand, and the manifest
// makes it open without any browser chrome around it.
function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not installable, no matter */ });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// A name you chose for yourself, if you ever did. Without one the island names you, the
// way it names its settlers.
function playerName() {
  try { return localStorage.getItem('promptholm.name') || null; } catch { return null; }
}

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
    onMarket: () => openMarket(),
    onCustomize: () => openStudio(),
  });

  state.market = createMarket(document.body, {
    onChange: (g) => {
      state.garden = g;
      if (state.crops) state.crops.apply(g.beds || [], { animate: true });
      if (state.mode === 'walk') state.walk.setInteractables(interactables());
    },
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.studio = createAvatarStudio(document.body, {
    // Re-dress the avatar the instant a swatch is picked, so if you are already walking
    // you watch yourself change; if you are up in the sky it waits, ready, for you to land.
    onApply: (spec) => { if (state.walk) state.walk.setAvatar(spec); },
    onClose: () => { if (state.walk && state.mode === 'walk') state.walk.setPaused(false); },
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
        skills: b.skills || {},
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

  state.think = createThink(document.body, {
    getWhere: () => {
      const w = state.walk && state.walk.state;
      if (!w || !w.pos) return null;
      return { x: w.pos.x, y: w.pos.y, z: w.pos.z, yaw: w.yaw, near: whatIsNear(w) };
    },
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
    onBuilt: () => refreshProps({ animate: true }),
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

  // Who are we here: the keeper of this island, or somebody visiting it? The page only
  // uses this to decide what to offer; the server refuses the rest either way.
  try {
    const hello = await fetch('/api/hello').then((r) => r.json());
    state.guest = visiting = hello.role !== 'islander';
    if (state.guest) {
      state.ui.toast(`You are visiting <b>${escapeHtml(hello.islandName || 'this island')}</b>. Walk where you like — the tickets, the chat and the git belong to whoever lives here.`);
    }
  } catch { /* an island that will not say is treated as our own */ }

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
  state.walk.setDecks(decks);        // buildScene ran before there was a walk mode to tell
  // The island is built, so there is ground for everyone else to stand on.
  state.peers = createPeers({ scene, material: buildingMat, terrain: state.terrain });
  state.horizon = createHorizon({ scene, pickables: state.pickables });
  if (!state.guest) refreshNeighbours();
  state.net = createNet({
    peers: state.peers,
    walk: state.walk,
    name: playerName(),
    onStatus: () => {},
  });
  state.props = createProps({ scene, terrain: state.terrain, material: buildingMat });
  refreshProps({ animate: false });
  state.crops = createCrops({ scene, terrain: state.terrain, material: buildingMat });
  refreshGarden({ animate: false });
  applyVillage(village, { animate: false });
  setLiveMode();
  // Arriving from a neighbour replaces the usual opening sweep with a landing.
  const from = params.get('arrive');
  if (from) comeAshore(from.slice(0, 40)); else startIntro();
  state.ui.boot(true);
  requestAnimationFrame(tick);
  connect();
  registerWorker();
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
    // Something was built by hand, most likely by a thought somebody had while walking.
    es.addEventListener('props', debounce(() => refreshProps({ animate: true }), 150));
    // A bed was sown, pulled or dug up - by another open page, or by whoever is walking.
    es.addEventListener('garden', debounce(() => refreshGarden({ animate: true }), 150));
    // The server can ask for a reload after its own code changed underneath us.
    es.addEventListener('reload', () => location.reload());
    // Somebody on the network raised or struck their flag. Only the keeper is sent this.
    es.addEventListener('neighbours', (e) => {
      try { applyNeighbours(JSON.parse(e.data).neighbours || []); } catch { /* malformed, ignore */ }
    });
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
