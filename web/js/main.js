// Boot, camera, the live feed and the animation queue that turns a data diff into
// something you can watch happen.
import * as THREE from 'three';
import { createRecovery } from './graphics-health.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTerrain } from 'shared/terrain.mjs';
import { createArchipelago, placeIsland, berthOf, MAX_BERTHS, nearestFirst } from 'shared/regions.mjs';
import { createCrowdView } from './crowd-view.js';
import { decodeCrowd } from 'shared/settlerwire.mjs';
import { quayFor, mooringFor } from 'shared/quay.mjs';
import { clamp, hash32, makeRng } from 'shared/rng.mjs';
import { createWorld, seasonOf } from './world.js';
import { createGuestIsland } from './guest-island.js';
import { createBoat, DECK_Y, BOW } from './boat.js';
import { housePlacement } from './house-placement.js';
import { projectVillage } from './history.js';
import {
  createBuildingMaterial, buildBuilding, buildScaffoldGeometry, buildBoatGeometry,
  buildCampfireGeometry, buildFlameGeometry, buildBladesGeometry, buildPierGeometry,
  buildBridgeGeometry, bridgeDeckHeights, createFlagMesh, QUAY_DECK, PALETTE, TIER_INDEX,
} from './buildings.js';
import { createSettlers } from './settlers.js';
import { createBoating } from './boating.js';
import { createNameplate } from './nameplate.js';
import { createUI } from './ui.js';
import { createWalkMode } from './walk.js';
import { createInterior, INDOOR_GLOW } from './interior.js';
import { createPeers } from './peers.js';
import { createNet } from './net.js';
import { createHorizon, RING } from './horizon.js';
import { createBoard } from './board.js';
import { createChat } from './chat.js';
import { createFaceToFace } from './facetoface.js';
import { createIslandChat } from './islandchat.js';
import { createOffice } from './office.js';
import { createNewSettler } from './newsettler.js';
import { createTownHall } from './townhall.js';
import { createProps } from './props.js';
import { createPanels } from './panels.js';
import { createCrops } from './crops.js';
import { attachClock, updateClock } from './clock.js';
import { attachFountain, updateFountain } from './fountain.js';
import { createMarket, answerOf } from './market.js';
import { createMailbox } from './mail.js';
import { attachMailFlag, setMailFlag, updateMailFlag } from './mailflag.js';
import { createBorrelTables, tableSetsFor } from './borrel.js';
import { createBuildMenu } from './buildmenu.js';
import { createGhost } from './ghost.js';
import { createAvatarStudio } from './studio.js';
import { loadAvatar } from './avatar.js';
import { createWaitingFlags } from './waiting.js';
import { createGamepad } from './gamepad.js';
import { createInput } from './input.js';
import { CROPS, CROP_KINDS, BED_SIZE, ripeIn } from 'shared/crops.mjs';
import { mine, mineUrl, sea, seaSocket, useSea, islanderHere, onIslanderChange } from './api.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const statsReadout = params.has('stats') ? document.createElement('output') : null;
if (statsReadout) {
  statsReadout.style.cssText = 'position:fixed;left:12px;bottom:8px;z-index:10000;padding:5px 9px;background:#14221ee8;color:#f4e8cd;font:12px monospace;pointer-events:none';
  document.body.appendChild(statsReadout);
}

// The boot watchdog in index.html waits on this: it is the one thing that tells it the
// module graph came up at all. Set before anything below can throw, so that a later crash
// stays main.js's own to report rather than something the watchdog has to guess at.
window.__islandRunning = true;

// Anything that goes wrong in the page is reported to the server, so a crash leaves a
// trace in data/server.log instead of only a blank tab.
// A visitor's crash is not ours to write into the log of a machine that is not theirs,
// and the server refuses it anyway - so they keep their troubles to the console. Its own
// flag rather than state.guest, because an error can fire before state exists.
//
// The first report tends to come before the server has said who we are, so anything said
// that early waits in the hall rather than going out and being refused.
let reported = 0;
// Written through setVisiting and nowhere else: that is where the queue below is
// drained, so assigning this directly leaves everything said during boot in the hall
// for good.
let visiting = null;          // null until the island answers
const held = [];
function post(message, stack) {
  try {
    const body = JSON.stringify({ message: String(message), stack: stack ? String(stack) : null });
    if (navigator.sendBeacon) navigator.sendBeacon(mineUrl('/api/log'), new Blob([body], { type: 'application/json' }));
    else mine('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
  } catch { /* nothing more we can do */ }
}
function setVisiting(guest) {
  // The hall is emptied once, by whoever settles this first. What the island says about
  // us still wins after that, even if it takes its time answering: a visitor found out
  // about late is still a visitor, and the rest of their session stays out of our log.
  const first = visiting === null;
  visiting = guest;
  if (!first) return;
  const queue = held.splice(0);
  if (!guest) for (const [m, s] of queue) post(m, s);
}
// An island that never answers is treated as our own, or a crash during boot would
// leave no trace at all. Only when nothing has answered: a real answer is not to be
// talked over by the clock.
setTimeout(() => { if (visiting === null) setVisiting(false); }, 4000);
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
const MAX_RETRIES = 4;
const recovery = createRecovery({
  getItem: (key) => sessionStorage.getItem(key),
  setItem: (key, value) => sessionStorage.setItem(key, value),
  removeItem: (key) => sessionStorage.removeItem(key),
});
let recoveryScheduled = false;
function recoverCanvas(error) {
  recovery.failed();
  if (recoveryScheduled) return;
  recoveryScheduled = true;
  const attempt = recovery.reserve();
  if (attempt === null) {
    showCanvasTrouble(error);
    return;
  }
  countdownReload(2 + (attempt - 1) * 2, attempt);
}

let renderer;
try {
  renderer = makeRenderer();
} catch (e) {
  console.error(e);
  report('could not create a webgl context', String(e && e.message));
  recoverCanvas(e);
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
// Cache GPU identity while the context is alive; querying after loss returns unknown.
const graphicsGpu = gpuName();
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  report('webgl context lost', `renderer: ${graphicsGpu}`);
  recoverCanvas(new Error('The island lost its 3D canvas.'));
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
  recoverCanvas(new Error('The island needs to rebuild its 3D canvas.'));
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
  try { village = await (await mine('/village.json', { cache: 'no-store' })).json(); } catch { /* board still opens */ }
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

const modest = params.has('modest') || MODEST_GPU.test(graphicsGpu);
report(`island drawing on: ${graphicsGpu}`);
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
  // maxDistance is the floor of a limit, not the limit: buildScene raises it to twice the
  // island's half-width once the terrain exists, because a 256 grid has to be framed from
  // further out than 200 units and the clamp was cropping the coast at boot.
  minDistance: 5, maxDistance: 200, minPolarAngle: 0.12, maxPolarAngle: 1.34,
  rotateSpeed: 0.62, panSpeed: 0.85, zoomSpeed: 0.9, zoomToCursor: true,
});
controls.target.set(0, 1, 0);

const buildingMat = createBuildingMaterial();
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false });

const state = {
  village: null, shot: null, terrain: null, world: null, settlers: null, ui: null,
  // `terrain` is this island, local and origin-centred, and stays exactly that: world.js
  // and hamlets.js build their own positions out of its `half`, so they need the raw one.
  // `sea` is every island there is, in world coordinates, and it is what the camera, the
  // haze and anything asking "is there ground here" read. For an island on its own the two
  // agree everywhere that matters; see shared/regions.mjs for why they are not one thing.
  sea: createArchipelago(), region: null, guests: [], boats: [], docks: [],
  bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
  byId: new Map(), districts: new Map(), pickables: [],
  filters: { code: true, cowork: true, apprentices: true },
  chronicle: { t: null, playing: false, speed: 'day' },
  hourOverride: params.has('hour') ? Number(params.get('hour')) : null,
  hover: null, selected: null, intro: null, tween: null, live: 'live',
  queue: [], running: false, flags: null, particles: null,
  walk: null, board: null, chat: null, pad: null, input: null, padSeen: false, mode: 'orbit',
  // The room you are standing in, if any. Walking and being indoors are not two modes:
  // you are still on foot, the room simply owns the camera and the keyboard while you
  // are in it.
  inside: null,
  peers: null, net: null, guest: false, horizon: null, sailing: null,
  // Whether the yard signs are standing. The island answers this at /api/hello before
  // anything is built, so a page that may not read them never makes them in the first
  // place; false until it does, because that is the answer that gives nothing away.
  signs: false, signMode: null,
  props: null, panels: null, buildMenu: null, ghost: null, islandchat: null,
  crops: null, market: null, garden: null,
  // What the postbox on the town hall pavement knows: one unread count per account, as the
  // last poll left it. Nothing else about anybody's mail is ever held on this side.
  mailbox: null, mailCounts: [], mailAt: 0, borrel: null,
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

// The camera that holds a settler in front of you while you talk to them. It needs
// nothing but the camera and the width of whatever is covering the island, so it is made
// here rather than waiting for a village to land on.
const faceToFace = createFaceToFace({
  camera,
  reserved: () => (state.chat ? state.chat.panelWidth() : 0),
});

// Where to stand to talk to somebody: out in front of them, on the side away from their
// own front door, which is the side the street is on. Their figure is what is approached,
// not their house - a settler on an errand is talked to where they are standing.
function standingSpotFor(fig, rec) {
  let dx = fig.pos[0] - rec.group.position.x, dz = fig.pos[1] - rec.group.position.z;
  let len = Math.hypot(dx, dz);
  // Somebody standing on their own plot centre gives no direction at all; arrive from
  // wherever you were looking at them from instead.
  if (len < 0.05) {
    dx = camera.position.x - fig.pos[0];
    dz = camera.position.z - fig.pos[1];
    len = Math.hypot(dx, dz) || 1;
  }
  const step = 1.3 / len;
  return [fig.pos[0] + dx * step, fig.pos[1] + dz * step];
}

// Look them in the eye for as long as the conversation lasts: they are held where they
// stand and turned towards you, and the camera drops into your own eyes. Nothing happens
// without a figure to look at and feet to look from - a conversation is still a
// conversation with the camera left where it was.
function faceUp(id, fig) {
  if (!fig || !fig.visible || state.inside || state.mode !== 'walk') return;
  const w = state.walk.state;
  state.settlers.attend(id, [w.pos.x, w.pos.z]);
  faceToFace.begin({
    subject: fig,
    viewer: { x: w.pos.x, z: w.pos.z, feetY: w.pos.y },
    onLetGo: () => state.settlers.unattend(id),
  });
}

// Addressing a settler opens their session and lets you carry it on.
function talkTo(id) {
  if (keeperOnly('carry on a settler’s session')) return;
  const rec = state.byId.get(id);
  if (!rec || rec.spec.kind === 'civic' || !rec.spec.sessionId) return;
  // Who you are actually addressing: the figure scurrying about that doorstep, not the
  // doorstep. Only settlers.js knows where they got to, and it is keyed by building id.
  const fig = state.settlers ? state.settlers.figures.get(id) : null;
  // From the sky there is nobody standing in front of you yet. The dossier's "Talk to
  // them" is a wish to speak to somebody, so it walks you over to them first and leaves
  // you standing there afterwards: the same conversation, in the same place, from the
  // same eyes as pressing E would have given you.
  if (fig && fig.visible && !state.inside && state.mode !== 'walk') {
    enterWalk({ at: standingSpotFor(fig, rec), facing: [fig.pos[0], fig.pos[1]] });
    state.walk.update(0);   // one settled frame, so there is a stance to come back to
  }
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
  // After the panel is up, not before: it is the panel's own width that decides how far
  // off the middle of the screen the face has to sit to stay out from under it.
  faceUp(id, fig);
}

// --------------------------------------------------------------- walking
// What walk mode cannot step through, for one thing standing in the world: its own solid
// rectangles, turned with the house and moved onto it. Enclosing bounds also
// cover the small free angles of residential buildings.
function blockersOf(rec) {
  const c = Math.cos(rec.group.rotation.y), s = Math.sin(rec.group.rotation.y);
  return rec.built.solids.map((r) => ({
    x: rec.group.position.x + r.x * c + r.z * s,
    z: rec.group.position.z - r.x * s + r.z * c,
    hx: Math.abs(r.hx * c) + Math.abs(r.hz * s),
    hz: Math.abs(r.hx * s) + Math.abs(r.hz * c),
    id: rec.id,
  }));
}

function walkableBlockers() {
  const out = [];
  for (const rec of state.byId.values()) {
    if (!rec.group.visible) continue;
    out.push(...blockersOf(rec));
  }
  // The flower bed in the middle of the square has a stone kerb, so you walk round it the
  // way you will walk round the fountain that replaces it. It is not a building and is not
  // in `state.byId`, so the loop above never sees it.
  if (squareBed && squareBed.group.visible) out.push(...blockersOf(squareBed));
  // A tree somebody asked for is as solid as a house. A bridge is not: it is walked over.
  if (state.props) out.push(...state.props.blockers());
  // And so are the houses on a guest island, which are not in state.byId - see
  // guest-island.js for why they are deliberately kept out of it.
  for (const g of state.guests) out.push(...g.blockers());
  return out;
}

function interactables() {
  const out = [];
  // One key does both. Aboard, E puts you ashore - but only where there is shore to put you
  // on, which is what makes it safe to be the same key: in open water there is nothing to
  // offer and the prompt simply is not there. On foot it is the dock that offers a boat, and
  // any hull somebody left lying about.
  const aboard = state.walk && state.walk.aboard();
  if (aboard) {
    const bx = aboard.x + Math.sin(aboard.yaw) * (BOW + 0.7);
    const bz = aboard.z + Math.cos(aboard.yaw) * (BOW + 0.7);
    // Ahead of the bow first, because that is where you are looking; then anywhere within a
    // hull's length, so coming alongside a dock sideways still lets you off.
    // Asked of walk mode, not of the archipelago: a quay is planks over water, so the sea
    // says -0.4 where your own dock is and stepping out onto your own dock would be refused.
    const under = (x, z) => state.walk.groundAt(x, z);
    const landAhead = under(bx, bz) >= 0.06;
    const landBeside = !landAhead && LAND_PROBE.some(([dx, dz]) =>
      under(aboard.x + dx * 1.6, aboard.z + dz * 1.6) >= 0.06);
    if (landAhead || landBeside) {
      out.push({
        id: aboard.id, kind: 'ashore', x: aboard.x, z: aboard.z, r: 99,
        label: 'the shore', prompt: 'step ashore',
      });
    }
    return out;
  }

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
    } else if (rec.spec.civicType === 'mailbox') {
      // The prompt says what the flag says, in words: a box with something in it is worth
      // stopping at, and one without is worth knowing you can walk past.
      const waiting = unreadTotal();
      out.push({
        id: rec.id, kind: 'mailbox', x: p.x, z: p.z, r: 2.0, label: 'the postbox',
        prompt: waiting ? `open the postbox — ${waiting} new` : 'open the postbox',
      });
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
  // The boards with a page on them. They come from the panel layer rather than from the
  // props, because that is the half that knows how wide a board is and whether its page
  // is up yet.
  if (state.panels) out.push(...state.panels.interactables());
  for (const d of state.docks) {
    const moored = state.boats.find((b) => Math.hypot(b.x - d.berth[0], b.z - d.berth[1]) < 3);
    out.push({
      id: d.id, kind: 'dock', x: d.head[0], z: d.head[1], r: 3.2,
      label: 'the quay', prompt: moored ? 'take the boat' : 'take a boat',
    });
  }
  for (const b of state.boats) {
    out.push({ id: b.id, kind: 'boat', x: b.x, z: b.z, r: 2.4, label: 'the boat', prompt: 'take the boat' });
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
  mine('/api/where', {
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
// --------------------------------------------------------------- what was built
async function refreshProps({ animate = true } = {}) {
  if (!state.props) return;
  try {
    const r = await mine('/api/props', { cache: 'no-store' });
    const body = await r.json();
    const before = state.props.count();
    state.props.apply(body.props || [], { animate });
    const after = state.props.count();
    // The same list, read a second time for its panels: props.js draws the woodwork and
    // panels.js hangs the page in front of it.
    if (state.panels) state.panels.apply(body.props || []);
    handOutDecks();                                   // a bridge that has just gone up
    if (state.mode === 'walk') {
      state.walk.setBlockers(walkableBlockers());
      state.walk.setInteractables(interactables());   // a board that has just gone up
    }
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
      const body = await answerOf(await mine('/api/crops', { cache: 'no-store' }));
      state.crops.apply(body.crops || [], { animate });
    } else {
      const garden = await answerOf(await mine('/api/garden', { cache: 'no-store' }));
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
    const answer = await answerOf(await mine('/api/garden', {
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

// --------------------------------------------------------------- building by hand
// The catalogue, and then a thing in your hand. Everything after the menu closes is
// web/js/ghost.js: the aiming, the wheel, and the one POST that puts it down.
//
// Pressing it again while something is already in hand puts that back, so the key is a
// toggle rather than a way to open a menu on top of a ghost.
function openBuild() {
  if (state.inside) { state.ui.toast('Nothing to build in here.'); return; }
  if (keeperOnly('build on this island')) return;
  if (state.buildMenu.isOpen()) return;
  if (state.ghost && state.ghost.holding()) { state.ghost.drop(); return; }
  if (state.mode === 'walk') state.walk.setPaused(true);
  state.ui.closeDossier();
  state.buildMenu.open();
}

// Which seed is in hand, one press at a time, in the order the stall lists them. The
// shoulder buttons go both ways round the pouch, so the step is a parameter.
function cycleSeed(step) {
  if (keeperOnly('go through this island’s seed pouch')) return;
  const g = state.garden;
  const have = g ? CROP_KINDS.filter((k) => (g.seeds || {})[k]) : [];
  if (!have.length) { state.ui.toast('The pouch is empty. The stall at the market sells seed.'); return; }
  const next = have[(have.indexOf(g.held) + step + have.length) % have.length];
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

// --------------------------------------------------------------- the postbox
// The box holds somebody's mail and the server will not hand a visitor a line of it. The
// refusal here is so that a guest is told so in a sentence rather than shown a panel that
// fails to load - the same courtesy the seed stall and the town hall do.

function openMailbox() {
  if (keeperOnly('open the postbox')) return;
  if (state.walk && state.mode === 'walk') state.walk.setPaused(true);
  state.ui.closeDossier();
  state.mailbox.open();
}

const unreadTotal = () => (state.mailCounts || []).reduce((n, c) => n + (c.unread || 0), 0);

// What the flag reads. Set from the poll below and from the panel, which knows sooner:
// reading the last unread message drops the flag then and there rather than at the next
// poll half a minute later.
function showMail(counts) {
  state.mailCounts = counts || [];
  const waiting = unreadTotal() > 0;
  for (const rec of state.byId.values()) {
    if (rec.mailFlag) setMailFlag(rec.mailFlag, waiting);
  }
  // The prompt over the keys carries the count, so it has to be rebuilt when the count
  // changes and not only when you walk up to something else.
  if (state.mode === 'walk' && state.walk) state.walk.setInteractables(interactables());
}

// Asked for on a timer, and only ever the counts - never a message, never a header. A
// server that is being left alone because it refused a password answers from lib/mail.mjs
// without going near the network, so this stays cheap even when something is wrong.
const MAIL_POLL_MS = 45000;
async function pollMail(force = false) {
  if (state.guest) return;
  if (document.hidden && !force) return;                 // nobody is looking at the flag
  if (!force && Date.now() - state.mailAt < MAIL_POLL_MS - 1000) return;
  state.mailAt = Date.now();
  try {
    const r = await answerOf(await mine(`/api/mail${force ? '?force=1' : ''}`, { cache: 'no-store' }));
    showMail(r.counts || []);
  } catch { /* no postbox on this island, or the server is older than the page */ }
}

// Every overlay is the same shape - `open`, `close`, `isOpen` - which is what lets the
// controller close all of them from one place instead of eight. Only one can be up at a
// time in practice, so the first one found is the one holding the screen.
const PANELS = () => [state.board, state.chat, state.market, state.mailbox,
  state.townHall, state.office, state.studio, state.newSettler, state.buildMenu];
const openPanel = () => PANELS().find((p) => p && p.isOpen()) || null;

// What the keys do while you are out on the island. Lifted out of `enterWalk` because
// stepping back out of a room re-enters walk mode, and a second copy of this list would
// drift away from the first one.
// Aboard. The boat is handed to walk mode, which steers it from there; nothing else about
// being on foot changes, which is why `blocked` and the wading rule are untouched.
// The quay's own key. This island has one boat and it is at its mooring, or it is wherever
// somebody left it - and if that is the far shore, then that is where it is. Nothing is
// summoned to reach you and you are not carried to it, which is the whole of what a boat
// belonging to nobody means.
function takeBoatAt(dockId) {
  const d = dockAt(dockId);
  if (!d) return;
  const b = boatFor(d.region);
  if (!b) return;
  if (Math.hypot(b.x - d.berth[0], b.z - d.berth[1]) > 4) {
    state.ui.toast('The boat is out on the water.');
    return;
  }
  if (b.pilot && state.net && b.pilot !== state.net.id()) {
    state.ui.toast('Somebody else has the tiller.');
    return;
  }
  takeBoat(b);
}

function takeBoat(which) {
  // The boat itself, or its id from the interactable that named it. Taking the object where
  // there is one is not a convenience: looking a boat up by id is exactly what went wrong
  // when two of them shared one.
  const b = typeof which === 'string' ? boatAt(which) : which;
  if (!b || !state.walk) return;
  state.walk.board(b);
  if (state.net) state.net.takeBoat(b.id);
  // Told as a room rather than as a flag. `room()` in lib/players.mjs:55 already accepts
  // this slug and tick() only sends slot [6] when it is set, so an older client sees
  // somebody walking and nothing worse - where a new flag bit would have needed the mask
  // at lib/players.mjs:162 widened on the server first.
  if (state.net) state.net.setRoom('boat', state.walk);
  state.walk.setInteractables(interactables());   // E means something else now
  state.ui.toast('You cast off. <b>W</b> and <b>S</b> for the oars, <b>A</b> and <b>D</b> for the tiller.');
}

// Off at the bow, which is the end pointing at whatever you have come alongside.
function stepAshore() {
  const b = state.walk && state.walk.aboard();
  if (!b) return;
  const at = [b.x + Math.sin(b.yaw) * (BOW + 0.6), b.z + Math.cos(b.yaw) * (BOW + 0.6)];
  if (!state.walk.unboard(at)) { state.ui.toast('Nowhere to land here.'); return; }
  if (state.net) { state.net.dropBoat(b.id); state.net.setRoom(null, state.walk); }
  state.walk.setInteractables(interactables());
}

function walkCallbacks() {
  return {
    onInteract: (it) => {
      if (it.kind === 'board') { if (keeperOnly('read the sprint board')) return; state.walk.setPaused(true); state.board.open('jira'); }
      else if (it.kind === 'issues') { if (keeperOnly('read the island board')) return; state.walk.setPaused(true); state.board.open('github'); }
      else if (it.kind === 'office') openOffice(it.id);
      else if (it.kind === 'townhall') openTownHall();
      else if (it.kind === 'market') openMarket();
      else if (it.kind === 'mailbox') openMailbox();
      else if (it.kind === 'tavern') enterInterior(it.room, it);
      else if (it.kind === 'bed') pullBed(it.id);
      else if (it.kind === 'panel') workPanel(it);
      else if (it.kind === 'boat') takeBoat(it.id);
      else if (it.kind === 'dock') takeBoatAt(it.id);
      else if (it.kind === 'ashore') stepAshore();
      else talkTo(it.id);
    },
    onSendAway: (it) => {
      if (it.kind === 'bed') { digBed(it.id); return; }
      if (!['board', 'issues', 'townhall', 'office', 'market', 'mailbox', 'tavern', 'boat', 'ashore', 'dock'].includes(it.kind)) askToSendAway(it.id);
    },
    onPlant: () => sowHere(),
    onNextSeed: () => cycleSeed(1),
    onPrevSeed: () => cycleSeed(-1),
    onBuild: () => openBuild(),
    onRelease: () => releasePanel(),
    onExit: () => exitWalk(),
  };
}

// --------------------------------------------------------------- standing at a board
// Stepping up to a panel: the page on it takes the mouse and, through walk.js, every
// key that is not a step. Nothing about this leaves the screen - what you do on a board
// is still yours alone, and the other people on the island see a settler standing still.
function workPanel(it) {
  if (!state.panels || !state.panels.take(it.id)) return;
  state.walk.setWorking(it);
}

// Called by walk mode, whichever way you left: Escape, a step away, the controller, or
// walking out of the mode altogether.
function releasePanel() {
  if (state.panels) state.panels.release();
}

// Who somebody is, by the id the island knows them under. Ours is not in the roster -
// the peers only hold other people - so it is named here.
function peerName(id) {
  if (state.net && id === state.net.id()) return playerName() || 'you';
  return state.peers ? state.peers.nameOf(id) : 'Somebody';
}

// What the island says the boards say. Everything that changes a panel comes through
// here - our own presses included, which went out as a request and come back as fact.
function applyPanelMessage(m) {
  if (!state.panels) return;
  if (m.kind === 'all') { state.panels.all(m.boards); return; }
  if (m.kind === 'ui') { state.panels.field(m.id, m.action, m.value); return; }
  if (m.kind === 'drove') {
    // The roster is where an id becomes a name, so the name is put on here rather than
    // in the panel layer, which has never heard of players.
    if (m.driver) state.panels.drivenBy(m.id, peerName(m.driver));
    const taken = state.panels.driven(m.id, m.driver);
    if (taken) {
      state.walk.setWorking(null);
      state.ui.toast(`<b>${escapeHtml(peerName(taken))}</b> is working that board. You can read over their shoulder.`);
    }
  }
}

// A board you are already working says how to let go of it, not how to take it.
function promptFor(near) {
  if (!near) return null;
  const held = state.walk.state.working;
  if (near.kind === 'panel' && held && held.id === near.id) {
    return { ...near, key: 'Esc', prompt: `step back from ${near.label}` };
  }
  return near;
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
  // The room is a place the others can be drawn in, and your pose now comes from its own
  // walk mode. Switching presence off instead -- which is what this used to do -- made the
  // tavern the one room on the island where nobody could keep you company.
  if (state.peers) state.peers.place(inside.room, { scene: inside.scene, terrain: inside.terrain });
  if (state.net) state.net.setRoom(inside.room, inside.walk);
}

function leaveInterior() {
  if (!state.inside) return;
  state.inside = null;
  state.ui.setIndoors(false);
  state.ui.setWalkPrompt(null);
  if (state.net) state.net.setRoom(null, state.walk);
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

// `spot` is where to be put down and what to face when you get there, for the times
// something has a place in mind - walking over to somebody you asked to talk to. Without
// one you arrive on the town square, which is where the island starts everybody.
function enterWalk(spot = null) {
  if (state.mode === 'walk') return;
  const board = state.byId.get('civic:board');
  const town = state.village.island.town;
  // Start on the town square, a couple of paces in front of the board, facing it.
  let at = [0, 0], facing = null;
  if (spot && spot.at) {
    at = spot.at;
    facing = spot.facing || null;
  } else if (board) {
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
    const r = await mine('/api/banish', {
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
    await mine('/api/banish', {
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
  // A conversation cannot outlive the feet it was had on: the camera is on its way to the
  // sky, so it is dropped rather than walked back down, and the settler is let go of.
  faceToFace.cancel();
  if (state.chat.isOpen()) state.chat.close();
  // Straight from a bar stool to the sky: leave the room on the way out, or the island
  // would still believe you were indoors when you next came down.
  if (state.inside) {
    const room = state.inside;
    state.inside = null;
    room.leave();
    state.ui.setIndoors(false);
  }
  state.mode = 'orbit';
  // Back outdoors as far as the others are concerned, and the pose comes from the island's
  // walk mode again. Leaving this pointed at a room you have left is how you come back down
  // from the sky invisible: the room's walk mode is no longer active, so nothing is sent.
  if (state.net) { state.net.setRoom(null, state.walk); state.net.setWalking(false); }
  state.walk.setPeerBlockers([]);
  reportWhere({ final: true });   // write down where you left off, and that you left
  state.walk.exit();
  state.board.close();
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
    const r = await mine('/api/neighbours').then((x) => x.json());
    applyNeighbours(r.neighbours || []);
  } catch { /* no beacon, no neighbours, no matter */ }
}

// How far the camera may stand back, and how far it may wander. Both come off the whole
// archipelago rather than off this island, because an island at a berth is a place you have
// to be able to look at: the orbit target used to be clamped to our own land every frame
// (see the clamp in `tick`), which meant a second island could be drawn and still be
// physically impossible to point the camera at.
//
// `bounds` is measured over the LAND, the way frameIsland does it - a grid square reaches
// several cells past the last beach, and a leash on the grid lets you drift out over empty
// water until the island falls off the bottom of the frame. Both numbers are floors, so an
// island on its own keeps exactly the framing it was tuned with.
function applyCameraRange() {
  state.bounds = state.sea.bounds();
  controls.maxDistance = Math.max(200, state.sea.radius() * 2);
}

// Where the haze begins and where it closes, and the only place that decides either.
// world.js makes the Fog object and tints it with the sky; these two distances were being
// set there as well, and this one - a flat 235 chosen for a grid of 64 - overwrote it on
// every neighbour sync, so a big island ended up with its far coast in full fog.
//
// Both ends come off the island's own half-width: the haze starts a little past your own
// beach and swallows the sea at three and a bit island widths. The exception is a
// neighbour. They lie out on a fixed ring whatever size you are, and on a small island
// that ring is well past your own fog - the sea around them was white long before you got
// there, and an island with no water behind it reads as one that fell off the edge of the
// world. There is sea out there; world.js lays a disc of it to 500. So while somebody is
// out there, hold the fog off until past the ring, and never closer in than the island
// itself asked for.
// A second island at a berth is the same problem as a neighbour on the ring, one step
// worse: a berth for two 64-grids is 112 out and its far coast is at 144, where the old far
// of half*3.4 = 109 put the whole thing behind the wall. So the far end is now the furthest
// of three things - our own island's own reach, the ring if anybody is still out on it, and
// the archipelago if anybody has come in off it.
//
// `near` stays tied to our own half on purpose. That near haze is what makes the distance
// read at all; open it up with the far end and the sea goes flat and the island loses its
// depth, which is the thing the reference picture has and a wide-open scene does not.
function applyFogRange() {
  if (!scene.fog) return;
  const half = state.terrain ? state.terrain.half : 64;
  // How far away the furthest thing that is NOT our own island lies. Our own island is
  // already covered by half*3.4, and the +110 was only ever about holding the haze off
  // something out on the water - so home must not count towards it. Taking the whole
  // archipelago's radius here instead looks right and is not: on an island with no
  // neighbours at all it would read 32 and open the far end from 109 to 142, quietly giving
  // every island a third more visible distance than it was drawn for.
  let out = state.horizon && state.horizon.ringCount() > 0 ? RING.far : 0;
  for (const r of state.sea.regions()) {
    if (r === state.region) continue;
    out = Math.max(out, Math.hypot(r.origin[0], r.origin[1]) + r.half);
  }
  scene.fog.near = half * 1.1;
  if (out <= 0) { scene.fog.far = half * 3.4; return; }

  // How far the eye actually is from the furthest coast it could be looking at. Without
  // this the haze is a fixed ring round the origin, and an archipelago cannot be framed:
  // with four berths taken it is 269 units across, so seeing it whole means standing back
  // most of the orbit leash - and at that distance a far end of `out + 110` has closed over
  // everything, islands, coasts and all. One island never showed this because you never
  // needed to pull that far back from it.
  //
  // It moves with the zoom, like the shadow frustum does (world.js followShadow) and for
  // the same reason: a number that has to cover both a walk along the beach and a look at
  // the whole sea cannot be one number. This is still the only place that decides it.
  let reach = 0;
  for (const r of state.sea.regions()) {
    const dx = camera.position.x - r.origin[0], dz = camera.position.z - r.origin[1];
    reach = Math.max(reach, Math.sqrt(dx * dx + dz * dz + camera.position.y * camera.position.y) + r.half);
  }
  scene.fog.far = Math.max(half * 3.4, out + 110, reach + 40);
}

// Islands that are not on the beacon: an island conjured by `?join=` so that the whole
// coordinate path - berth, region, haze, camera leash, picking - can be exercised with one
// server, no multicast and no second machine. They ride along with every beacon sync,
// because `apply` takes the whole list and whoever is not in it has gone home.
const debugJoins = [];

// ?join=self            our own island, again, at the berth due east
// ?join=seed:12345      a stranger's island of that seed, same grid as ours
//
// The point of `self` is that it is the one case where you know exactly what the answer
// should look like: if the island to the east is not the mirror of the one you are standing
// on, the offset is wrong rather than merely odd.
// Which berth a newcomer gets. Four of them, snapped to the compass, and the first free one
// wins - so the second island to arrive does not land on top of the first. berthOf works
// off both radii, which is what stops a 256-grid neighbour from coming ashore inside a
// 64-grid host: web/js/horizon.js:13-18 records that bug having happened once already.
function freeBerth(theirHalf) {
  const ours = state.region ? state.region.half : 32;
  for (let i = 0; i < MAX_BERTHS; i++) {
    const origin = berthOf(i, ours, theirHalf);
    const clash = state.sea.regions().some((r) => {
      const gapX = Math.abs(origin[0] - r.origin[0]) - (theirHalf + r.half);
      const gapZ = Math.abs(origin[1] - r.origin[1]) - (theirHalf + r.half);
      return gapX < 0 && gapZ < 0;
    });
    if (!clash) return origin;
  }
  return null;
}

// An island joins the sea. One way in for every kind of newcomer - the `?join=` debug
// parameter now, an uploaded bundle next - because the awkward parts are the same either
// way: the terrain has to be rebuilt from their seed rather than trusted, the hash has to be
// checked, a berth has to be free, and what comes back has to be a region the rest of the
// page can ask questions of.
//
// `polders` matters more than it looks. A polder is stamped into the heightfield rather than
// drawn on top of it, so an island that has drained one is a different shape - and leaving
// them out would put their coast in the wrong place and their houses in the water.
function joinIsland({ id, rev = 0, seed, gridSize, polders = [], terrainHash = null, name = null, village = null, origin = null }) {
  if (state.sea.get(id)) return state.sea.get(id);
  const terrain = makeTerrain(seed, { size: gridSize, polders });
  if (terrainHash && terrain.hash !== terrainHash) {
    // A warning here and not a refusal, the same as buildScene does for our own island
    // (main.js:1560): the two sides disagree about shared/terrain.mjs, which means one of
    // them is running older code. The server refuses the upload outright for the same
    // reason; by the time it reaches the page it is worth drawing and worth saying.
    console.warn(`island: ${id} hashes ${terrain.hash} here and ${terrainHash} there`);
  }
  // The sea decides where an island lies, and every client is told the same answer - that
  // is what makes two people looking at the same water see the same thing. freeBerth is
  // the fallback for the one case with no sea in it: the ?join= debug parameter, which
  // conjures an island out of a seed with nobody to ask.
  const at = Array.isArray(origin) ? origin : freeBerth(terrain.half);
  if (!at) { console.warn(`island: no berth free for ${id}`); return null; }
  let region;
  try {
    region = state.sea.add(placeIsland(terrain, { id, origin: at }));
  } catch (e) {
    console.warn(`island: ${e.message}`);
    return null;
  }
  // Hung on the region rather than passed around, because everything that later wants to
  // draw something of theirs - buildings now, paths and piers next - finds the region first.
  region.village = village;
  region.rev = rev;
  console.info(`island: ${name || id} joined at [${at}] (rev ${rev})`);
  return region;
}

// The debug way in: ?join=self, or ?join=seed:12345. It runs from buildScene, before the
// world is built, because the water is laid over the archipelago as it stands at that
// moment and an island that arrives afterwards would get no shallows.
//
// `self` is the one worth having: it is the only case where you already know what the answer
// should look like, so an island to the east that is not the mirror of the one under your
// feet is a wrong offset rather than merely an odd-looking coast.
function joinRegionsFromParams(homeTerrain, homeVillage) {
  const spec = params.get('join');
  if (!spec) return;
  const seed = spec === 'self' ? homeTerrain.seed
    : /^seed:-?\d+$/.test(spec) ? Number(spec.slice(5)) : null;
  if (seed === null) { console.warn(`island: cannot make sense of ?join=${spec}`); return; }
  const id = `debug-${seed}`;
  // With ?join=self it gets our own village too, which is the point of `self`: an island to
  // the east that is not house-for-house the one under your feet is a wrong offset rather
  // than a coast that merely looks odd. A different seed gets bare ground - their buildings
  // would be standing on plots their layout never planned.
  const region = joinIsland({
    id, seed, gridSize: homeTerrain.size, name: 'a test island',
    village: spec === 'self' ? homeVillage : null,
  });
  if (!region) return;
  debugJoins.push({
    id, name: 'a test island', island: `seed ${seed}`, seed, gridSize: homeTerrain.size,
    settlers: 0, url: location.href, address: null, port: 0,
  });
}

// Every island in the sea that is not ours gets ground you can stand on. Called from
// buildScene after the world - so the water is already laid over the whole archipelago and
// a guest coast rises out of real shallows rather than out of the flat open-ocean disc -
// and again whenever one joins later.
//
// Idempotent, and deliberately so: an island that is already standing is left exactly as it
// is rather than disposed and rebuilt, because somebody may be walking on it.
//
// Their ground goes into `state.pickables` so the existing raycast finds it. It does NOT go
// on the horizon: see the filter in applyNeighbours for why an island cannot be in both
// places at once.
// ---- the quay -------------------------------------------------------------------
// The derivation moved to shared/quay.mjs the moment there was a third caller: this file
// draws the planks and puts the hull in the water, serve.mjs hands lib/boats.mjs the
// moorings, and the browser across the channel has to find an untouched boat in the same
// place. Three sides agreeing without a message between them is only possible if all three
// do the same arithmetic, which is what shared/ is for.
function dockFor(region, village) {
  const v = village || region.village;
  const landing = v && v.island && v.island.landing;
  if (!landing) return null;
  // Local coordinates, because the mesh goes inside the island's own group - and world
  // coordinates for `head` and `berth`, because walk mode and the boat speak nothing else.
  // shared/quay.mjs names them apart for exactly this reason.
  const quay = quayFor(region.terrain, landing);
  if (!quay) return null;
  const [ox, oz] = region.origin;
  return {
    id: `dock:${region.id}`, region, cells: quay.cells, dir: quay.dir,
    from: quay.from,
    yaw: quay.yaw,
    head: [quay.head[0] + ox, quay.head[1] + oz],
    berth: [quay.berth[0] + ox, quay.berth[1] + oz],
    // The land cell the planks start from, in the island's OWN grid - which is what a
    // settler walking down to the water has to be routed to, because the roads stop on land
    // and the planks begin here. quaySite picks it, and it is not always the landing.
    shore: quay.shore,
  };
}

// The docks, built with the world so they are there to look at from the orbit camera too -
// a dock is scenery as much as it is a way off the island.
function buildDocks(homeVillage) {
  for (const d of state.docks) d.dispose();
  state.docks = [];
  for (const region of state.sea.regions()) {
    const spec = dockFor(region, region === state.region ? (homeVillage || state.village) : null);
    if (!spec) continue;
    const geo = buildPierGeometry(spec.cells, region.terrain, spec.from);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, buildingMat);
    // In the island's own frame: at the origin for home, inside the guest group otherwise.
    const parent = region === state.region
      ? scene
      : (state.guests.find((g) => g.region === region) || {}).group || scene;
    mesh.position.set(spec.from[0], 0, spec.from[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = spec.id;
    parent.add(mesh);
    state.docks.push({ ...spec, mesh, dispose: () => { parent.remove(mesh); geo.dispose(); } });
    state.pickables.push(mesh);
  }
}

function dockAt(id) { return state.docks.find((d) => d.id === id) || null; }
function boatAt(id) { return state.boats.find((b) => b.id === id) || null; }

// Every island's boat, put in the water with the island. Not when walk mode starts: a boat
// somebody across the channel is sailing has to be drawn whether or not you are on foot.
function launchBoats() {
  for (const region of state.sea.regions()) boatFor(region);
  for (let i = state.boats.length - 1; i >= 0; i--) {
    const b = state.boats[i];
    if (state.sea.regions().some((r) => b.id === `boat:${r.id}`)) continue;
    b.craft.dispose();
    state.boats.splice(i, 1);
  }
}

// This island's dock, which is the only one a settler of this island can walk to.
function homeDock() {
  return state.docks.find((d) => d.region === state.region) || null;
}

// The hull a settler takes out for the afternoon, and why it is not the island's own.
//
// It was, and it cannot be any more. There is one boat to an island now, its position is
// world state lib/boats.mjs holds and every browser agrees about, and only its pilot may
// write to it - so a settler moving it would be moving a hull nobody across the channel
// can see move, and, worse, would take away the one thing anybody has to cross with. The
// crossing outranks the outing.
//
// So an outing brings its own dinghy: the same baked Benchy drawn with the same material,
// made when somebody steps down into it and disposed of when they step back out, and never
// in `state.boats`. Nothing offers it to you, nothing reports it to the server, and the
// island's boat is at its mooring all afternoon whether or not anybody is out on the water.
// `deckY` is kept on it in the shape walk mode and settlers.js both read a deck height in.
const outingFleet = {
  take() {
    const d = homeDock();
    if (!d) return null;
    const craft = createBoat({ scene, material: buildingMat });
    // Alongside the head on the side the island's own boat is not, so the two are not drawn
    // through each other while one of them is at home.
    const x = d.head[0] + d.dir[1] * 1.3, z = d.head[1] - d.dir[0] * 1.3;
    const b = { id: `outing:${d.region.id}`, x, z, yaw: d.yaw, craft, deckY: DECK_Y };
    craft.place(x, z, d.yaw);
    return b;
  },
  release(b) {
    if (b) b.craft.dispose();
  },
  // The swell, and the deck the rider stands on. state.boats gets this in the frame loop;
  // a dinghy that is in no list has to be told.
  bob(b, time) {
    b.craft.place(b.x, b.z, b.yaw);
    b.craft.bob(time);
    b.deckY = b.craft.deck ? b.craft.deck() : DECK_Y;
  },
};

// Whether the last frame was spent afloat, so the frame you step off can notice.
let wasAboard = false;

// One boat per island, at the mooring shared/quay.mjs derives - the same arithmetic the
// server does for lib/boats.mjs and the same every other browser does, so an untouched
// boat is in the same water on every screen without a message being sent about it.
//
// One and not three. Three was mine and it was a way of never being stranded, but a boat
// that belongs to nobody cannot also be always to hand: if somebody has left the island's
// boat on the far shore, that is where it is, and the answer is the other island's boat and
// not a spare conjured at the jetty. The same reasoning lib/boats.mjs gives for putting
// them back at their moorings on a restart.
function boatFor(region) {
  const v = region === state.region ? state.village : region.village;
  const landing = v && v.island && v.island.landing;
  const m = landing ? mooringFor(region.id, region.terrain, landing, region.origin) : null;
  if (!m) return null;
  const had = state.boats.find((b) => b.id === m.id);
  if (had) return had;
  const craft = createBoat({ scene, material: buildingMat });
  craft.place(m.x, m.z, m.yaw);
  const b = { id: m.id, x: m.x, z: m.z, yaw: m.yaw, v: 0, aground: false, craft, deckY: DECK_Y, pilot: null };
  state.boats.push(b);
  return b;
}

// What the server says about a boat: taken, dropped, moved, or unmoored because its island
// has gone. A boat under somebody else's hand is theirs to place; ours is placed by us.
function onBoatFromServer(m) {
  const b = state.boats.find((x) => x.id === m.id);
  if (m.gone) {
    if (!b) return;
    b.craft.dispose();
    state.boats.splice(state.boats.indexOf(b), 1);
    if (state.walk && state.walk.aboard() === b) state.walk.unboard([b.x, b.z]);
    return;
  }
  const region = state.sea.regions().find((r) => m.id === `boat:${r.id}`);
  const craft = b || (region ? boatFor(region) : null);
  if (!craft) return;
  // Only when the message names one. A `moved` says where the hull is and nothing about
  // whose hand is on it, so taking `m.pilot` as authoritative there wiped the tiller ten
  // times a second - the boat moved for everybody and belonged to nobody.
  if ('pilot' in m) craft.pilot = m.pilot || null;
  const mine = state.net && craft.pilot && craft.pilot === state.net.id();
  // Somebody else has the tiller: their word is where it is. Our own boat we are steering
  // ourselves, and taking the server's echo of our own message would jitter it back a
  // fifth of a second on every reply.
  if (!mine) {
    craft.x = m.x; craft.z = m.z; craft.yaw = m.yaw;
    craft.v = 0;
  }
  // And if it was ours and now is not, we are no longer sailing it.
  if (state.walk && state.walk.aboard() === craft && craft.pilot && !mine) {
    state.walk.unboard([craft.x, craft.z]);
  }
}

// What is moored in the harbour, and putting it in the water.
//
// This is where the two halves meet. `/api/island` takes delivery of a bundle and parks it
// (lib/guests.mjs); `joinIsland` can place a region and `raiseGuestIslands` can draw one.
// Until now nothing joined them up, and the only island that ever appeared beside ours came
// from the `?join=` debug parameter.
//
// Two requests rather than one on purpose: the list is a name, a seed and a size each and
// costs a few hundred bytes, and the island whole is up to two megabytes. The SSE `guests`
// event carries the list, and the page comes back for the ones it has not got.
// Where the sea says this island lies, before anything is drawn with it. Also the first
// look at the fleet, so a page that boots into a busy world raises every coast in one go
// rather than watching them pop in one socket message at a time.
async function learnTheWorld() {
  state.homeOrigin = [0, 0];
  state.fleet = [];
  try {
    const world = await sea('/world').then((r) => r.json());
    state.fleet = world.islands || [];
    const me = state.fleet.find((i) => i.id === state.islandId);
    if (me && Array.isArray(me.origin)) state.homeOrigin = me.origin;
  } catch {
    // No sea, or one that is not up yet. An island at the origin on its own is exactly
    // what this was before there were seas, and the socket will bring the world when it
    // connects.
  }
}

// Bring the page's idea of the fleet up to the sea's. Everything except our own island,
// which we have already got and are standing on: the sea lists it too, and joining it a
// second time would put a duplicate coast on top of the one under our feet.
//
// The manifest is a few hundred bytes an island; an island whole is up to two megabytes,
// so the list arrives often and the islands are fetched once each.
// How many other islands are drawn whole. Past that they are silhouettes at their real
// berth - the same land from the same seed, every other vertex, no buildings and no
// collision - which is web/js/horizon.js doing the job it was already good at.
//
// The number is the draw budget and nothing else. CLAUDE.md records what one full guest
// island costs: 41 nameplates alone took the call count from 1.35x to 1.76x against a
// 1.6x budget, and that was with signs off, no forest and no settlers. Eight islands in
// full does not render, and the honest way to have eight in the world is to draw the near
// ones and suggest the rest.
const DETAILED = modest ? 2 : 4;

function farFrom(origin) {
  const home = state.homeOrigin || [0, 0];
  const dx = (origin ? origin[0] : 0) - home[0];
  const dz = (origin ? origin[1] : 0) - home[1];
  return Math.sqrt(dx * dx + dz * dz);
}

// The whole horizon, from both the things that can feed it: islands in our own sea that
// are too far to draw in full, and islands on the network that are in no sea of ours at
// all. One caller, because horizon.apply() removes whatever is not in the list it is
// given - two callers would each spend their turn deleting the other's islands.
function syncHorizon() {
  if (!state.horizon || state.guest) return [];
  const here = new Set(state.sea.regions().map((r) => r.id));
  const shown = new Map();
  for (const row of state.farFleet || []) {
    if (here.has(row.id)) continue;
    state.horizon.pin(row.id, row.origin);
    shown.set(row.id, { id: row.id, name: row.name, island: row.name, seed: row.seed, gridSize: row.gridSize, settlers: row.buildings || 0 });
  }
  for (const n of [...(state.neighbours || []), ...debugJoins]) {
    if (here.has(n.id) || shown.has(n.id)) continue;
    shown.set(n.id, n);
  }
  const arrived = state.horizon.apply([...shown.values()]);
  applyFogRange();
  return arrived;
}

// One at a time, and never lost.
//
// syncFleet awaits a fetch per island, and the sea says "island joined" once per island -
// so two arriving together started two runs that interleaved. The second saw a region the
// first had just dropped and was about to rebuild, decided it was gone, and the sweep took
// it out. It showed as one of two islands quietly refusing to redraw after it changed,
// which is not a symptom anybody would trace back to a race.
let syncing = null;
let syncAgain = false;
function syncFleet(rows) {
  if (rows) state.fleet = rows;
  if (syncing) { syncAgain = true; return syncing; }
  syncing = doSyncFleet().finally(() => {
    syncing = null;
    if (syncAgain) { syncAgain = false; syncFleet(); }
  });
  return syncing;
}

async function doSyncFleet() {
  if (!state.terrain) return;
  const moored = state.fleet || [];
  // Nearest first, so the ones you can actually see get the detail. Our own island is not
  // in the running: we are standing on it. The ordering lives in shared/regions.mjs with
  // the rest of the coordinate contract, and its tiebreak is load-bearing - see there.
  const others = nearestFirst(moored.filter((r) => r.id !== state.islandId), state.homeOrigin || [0, 0]);
  const near = others.slice(0, DETAILED);
  const nearIds = new Set(near.map((r) => r.id));
  state.farFleet = others.slice(DETAILED);

  // An island that has drifted out of the near set gives its ground back and becomes a
  // silhouette again. Done before the fetches below, so the budget is free by the time
  // anything new is raised.
  for (const region of state.sea.regions()) {
    if (region === state.region || region.id.startsWith('debug-')) continue;
    if (!nearIds.has(region.id)) dropRegion(region.id);
  }

  const arrived = [];
  for (const row of near) {
    const standing = state.sea.get(row.id);
    // Already here and unchanged: nothing to do. Changed - a house built, a district
    // founded - and it is fetched again and rebuilt. `rev` is the sea's own counter and
    // moves on every publish, so this is exactly "their island is not what we drew".
    if (standing && standing.rev === row.rev) continue;
    if (standing) dropRegion(row.id);
    let bundle;
    try {
      bundle = await sea(`/island/${encodeURIComponent(row.id)}`).then((r) => r.json());
    } catch { continue; }
    if (!bundle || !bundle.island) continue;
    const region = joinIsland({
      id: row.id,
      rev: row.rev,
      seed: bundle.island.seed,
      gridSize: bundle.grid ? bundle.grid.size : bundle.island.gridSize,
      polders: bundle.polders || [],
      terrainHash: bundle.island.terrainHash || null,
      name: bundle.island.name,
      village: bundle,
      origin: row.origin,
    });
    if (region) arrived.push(row.name);
  }
  syncHorizon();
  raiseGuestIslands();
  buildDocks();
  launchBoats();
  applyFogRange();
  applyCameraRange();
  // The quay's planks are a deck, and they are built here rather than with the village -
  // so the report that goes out with applyVillage has not seen them yet. Sent again from
  // here, and it costs nothing when nothing changed: reportPlacements compares first.
  reportPlacements();
  if (arrived.length) {
    state.walk && state.walk.setLevels && handOutDecks();
    state.ui.toast(`<b>${escapeHtml(arrived.join(', '))}</b> ${arrived.length === 1 ? 'is' : 'are'} in the water alongside.`);
  }
}

// Move this island to another world. The islander writes it down and actually does it -
// closes the sea it was in and joins the new one - and the page needs to do nothing about
// its own socket: net.js has been retrying since the old one dropped, and the new welcome
// carries the new fleet.
async function changeSea(what) {
  try {
    const r = await mine('/api/sea', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(what),
    });
    const said = await r.json().catch(() => ({}));
    if (!r.ok) { state.ui.toast(`The island stayed where it was: ${escapeHtml(said.error || r.statusText)}`); return; }
    // Every region except our own goes: the world we were in is not the world we are in.
    for (const region of state.sea.regions()) {
      if (region !== state.region) state.sea.remove(region.id);
    }
    state.fleet = [];
    syncFleet([]);
    state.ui.toast(what.mode === 'join' ? 'Setting out for another sea…' : what.mode === 'host' ? 'Hosting a sea. Others can join it now.' : 'On our own again.');
    setTimeout(() => state.ui.setSeas(null), 0);
    const fresh = await mine('/api/seas').then((x) => x.json()).catch(() => null);
    if (fresh) state.ui.setSeas(fresh);
  } catch { state.ui.toast('The island did not answer.'); }
}

// A roster that arrived before the island it names had been raised. The sea sends one the
// moment an island joins, and the ground for it is built on the next sync - a few hundred
// milliseconds later, because the bundle has to be fetched first. Kept rather than dropped:
// without the roster nobody on that island has a face.
const crowdRosters = new Map();

// Somebody else's settlers. The wire format is shared/settlerwire.mjs and the drawing is
// web/js/crowd-view.js; this only routes.
function onCrowdMessage(m) {
  const g = state.guests.find((x) => x.region.id === m.island);
  if (m.kind === 'roster') {
    if (g && g.crowd) g.crowd.roster(m.ids);
    else crowdRosters.set(m.island, m.ids);
    return;
  }
  if (!g || !g.crowd) return;
  // Positions travel in the island's own frame, so they are decoded against its own half
  // and the origin goes on inside the view. A message is walkers, or a slice of everybody
  // else, or both.
  const half = g.region.half;
  const rows = decodeCrowd(m.k, half, decodeCrowd(m.a, half));
  g.crowd.apply(rows, performance.now());
}

// Take an island's ground back out of the world: its region, its buildings, its crowd. The
// sweep below and the rebuild above both need it, and doing it in two places is how one of
// them ends up leaking a hundred meshes.
function dropRegion(id) {
  state.sea.remove(id);
  for (let i = state.guests.length - 1; i >= 0; i--) {
    if (state.guests[i].region.id !== id) continue;
    const g = state.guests[i];
    const k = state.pickables.indexOf(g.ground);
    if (k >= 0) state.pickables.splice(k, 1);
    if (g.crowd) g.crowd.dispose();
    if (g.props) g.props.dispose();
    if (g.crops) g.crops.dispose();
    g.dispose();
    state.guests.splice(i, 1);
  }
}

// The sea talking about its fleet: a welcome carrying the whole list, or one island
// arriving, going quiet or going home.
function onFleetNews(world, one, clock) {
  // The world's own clock, from the welcome. Kept as a skew rather than as a time, so it
  // survives this tab being asleep for an hour without anybody having to re-ask.
  if (clock && Number.isFinite(clock.now)) {
    state.seaSkewMs = clock.now - Date.now();
    if (Number.isFinite(clock.tz)) state.seaTz = clock.tz;
  }
  if (world) { state.fleet = world.islands || []; syncFleet(state.fleet); return; }
  if (!one) return;
  const { t, a, ...row } = one;
  const rows = (state.fleet || []).filter((r) => r.id !== one.id);
  // Sorted by id rather than by arrival, so "the fleet" is the same list on every machine
  // and in every order the messages happen to turn up in.
  state.fleet = (one.a === 'gone' ? rows : [...rows, row]).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  syncFleet(state.fleet);
}

function raiseGuestIslands() {
  // The water first, so a coast rises out of its own shallows rather than out of the flat
  // open sea. At boot this does nothing - the region was already in the sea when the world
  // was built - and it earns its keep the moment an island joins a page that is running.
  if (state.world) state.world.reshapeWater();
  const standing = new Set(state.guests.map((g) => g.region.id));
  for (const region of state.sea.regions()) {
    if (region === state.region || standing.has(region.id)) continue;
    const g = createGuestIsland({
      scene, region, month: new Date().getMonth(),
      buildings: (region.village && region.village.buildings) || [],
      material: buildingMat, modest,
    });
    for (const rec of g.records) attachExtras(rec, { mail: false, signs: false });
    // And the people. They are not simulated here - the sea walks them and sends where
    // they got to - but they are drawn by exactly the same eleven meshes ours are, so a
    // village of three hundred over there costs what a village of three hundred costs.
    g.crowd = createCrowdView({
      scene, material: buildingMat, region,
      buildings: (region.village && region.village.buildings) || [],
    });
    // Their scenery and their vegetable beds. Built into the island's own offset group
    // with its RAW local terrain, which is the rule from shared/regions.mjs: a module that
    // works out its own positions wants the local terrain and a group, not the world
    // facade - hand these the facade and every jetty and every bed sinks a metre.
    //
    // A bundle has carried both since it was written; they were arriving and being read by
    // nobody. No animation on the first pass: a hundred props rising out of the ground the
    // moment an island appears reads as a glitch rather than as somebody gardening.
    g.props = createProps({ scene: g.group, terrain: region.terrain, material: buildingMat });
    g.props.apply((region.village && region.village.props) || [], { animate: false });
    g.crops = createCrops({ scene: g.group, terrain: region.terrain, material: buildingMat });
    g.crops.apply((region.village && region.village.crops) || [], { animate: false });
    const waiting = crowdRosters.get(region.id);
    if (waiting) { g.crowd.roster(waiting); crowdRosters.delete(region.id); }
    state.guests.push(g);
    state.pickables.push(g.ground);
    console.info(`island: raised ${region.id} at [${region.origin}]`
      + `, ${g.triangles} triangles of ground and ${g.buildingCount} buildings`);
  }
  // A region that has gone takes its ground with it.
  for (let i = state.guests.length - 1; i >= 0; i--) {
    const g = state.guests[i];
    if (state.sea.get(g.region.id)) continue;
    const k = state.pickables.indexOf(g.ground);
    if (k >= 0) state.pickables.splice(k, 1);
    if (g.crowd) g.crowd.dispose();
    if (g.props) g.props.dispose();
    if (g.crops) g.crops.dispose();
    g.dispose();
    state.guests.splice(i, 1);
  }
}

function applyNeighbours(list) {
  if (!state.horizon || state.guest) return;
  // An island that is really here is not also a rumour on the horizon. Left in, it would
  // be drawn twice - once at half resolution and turned by a hashed angle - in the same
  // water, and clicking the silhouette would offer to sail to somewhere under your feet.
  // syncHorizon owns that filtering now, and the merge with the far half of our own fleet.
  state.neighbours = list || [];
  const arrived = syncHorizon();
  for (const n of arrived) {
    const mark = state.horizon.find(n.id);
    // No offer to sail over any more, because there is nowhere to go: an island on the
    // horizon is one that is in no sea of ours, and the way to reach it is to join the sea
    // it is in - which is a choice in Settings, not a boat. An island in *our* sea is not
    // a rumour on the horizon at all; it is water you can cross.
    state.ui.toast(`<b>${escapeHtml(n.name)}</b> is keeping an island off to the ${mark ? bearingWord(mark) : 'west'}.`);
  }
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
  return { puff, smoke, update, mat, count: () => live.length };
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

// --------------------------------------------------------------- the yard
// An apprentice's shed is the one building on the island without land of its own: the
// layout hands it a single cell of its master's 3x3 plot, and the master's house is
// standing in the middle of that same plot reaching most of the way across the cell. In
// the middle of its cell a shed is therefore 1.00 from the middle of the house, which is
// less than the two of them are wide - measured, 37 of 39 sheds in the yards with more
// than one apprentice had their master's doorstep drawn through them, by 0.25 in the
// median case. So a shed does not stand in the middle of its cell. It stands as far out
// on it as it can without putting a foot over the plot boundary, which puts every bit of
// the slack between the shed and the house, where the eye is, instead of splitting it
// between there and a plot edge nobody looks at.
const masterPlots = { village: null, map: new Map() };
function masterPlotOf(id) {
  if (masterPlots.village !== state.village) {
    masterPlots.village = state.village;
    masterPlots.map = new Map();
    for (const b of state.village.buildings) if (b.plot && b.plot.w === 3) masterPlots.map.set(b.id, b.plot);
  }
  return masterPlots.map.get(id) || null;
}
function yardNudge(spec, built) {
  if (spec.kind !== 'shed' || !spec.master || !spec.plot) return [0, 0];
  const mp = masterPlotOf(spec.master);
  if (!mp) return [0, 0];
  // Ring 1 of the master's plot is the yard. A shed that could not be seated there was
  // given a free cell further out, where there is no house beside it to make room for.
  const dx = Math.sign(spec.plot.gx - (mp.gx + 1)), dz = Math.sign(spec.plot.gz - (mp.gz + 1));
  if (Math.abs(spec.plot.gx - (mp.gx + 1)) > 1 || Math.abs(spec.plot.gz - (mp.gz + 1)) > 1) return [0, 0];
  // How far the shed reaches from its own centre, in world axes: the group is turned by a
  // quarter of a circle, so the two sides may have traded places.
  const b = built.bbox;
  const rx = Math.max(-b.min.x, b.max.x), rz = Math.max(-b.min.z, b.max.z);
  const swap = (spec.plot.rot || 0) % 2 === 1;
  const room = (r) => Math.max(0, 0.5 - r);
  return [dx * room(swap ? rz : rx), dz * room(swap ? rx : rz)];
}
function groundAt(x, z) { return state.terrain.worldHeight(x, z); }

// What time it is in the world, as opposed to on this computer.
//
// The sea's clock is the island's, and the two numbers it sends are both needed: `now`
// settles which moment it is and `tz` settles whose afternoon that is. An epoch on its own
// is not a time of day, and getHours() would give a player in another time zone a
// different sky over the same water - each of them certain the other was wrong.
//
// With no sea to ask, both fall back to this machine, which is exactly what the island did
// before there were any.
function timeNow() {
  if (state.chronicle.t != null) return state.chronicle.t;
  return Date.now() + (state.seaSkewMs || 0);
}
function currentHour() {
  if (state.hourOverride != null) return state.hourOverride;
  const d = new Date(timeNow());
  const tz = state.seaTz == null ? -d.getTimezoneOffset() : state.seaTz;
  // UTC plus the world's own offset, rather than this browser's idea of local time.
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes() + tz;
  return (((mins % 1440) + 1440) % 1440) / 60;
}

// Ground at or under this is shore: sea, shallows or beach. It is BEACH_MAX from
// shared/terrain.mjs, which is the same line the terrain itself uses to decide where the
// sand stops, so a house is treated as standing in the water by exactly the rule that
// draws the water.
const HARBOUR_WATERLINE = 0.35;
// Eight ways to look for a beach from a hull that has come alongside one.
const LAND_PROBE = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

// Whose settler stands on a deck rather than on the ground. `deckY` pins a figure to one
// height wherever it walks, which is right for a house built out over the water - there
// is nothing under it to stand on - and wrong for one on dry land, where it left the
// settlers of The Quay hanging in the air beside their own front doors. A house on land
// has ground under it like anyone else, so its settler uses the ground.
const overWater = (rec) => rec.spec.harbour && rec.group.position.y <= 0.05;

// --------------------------------------------------------------- records
function makeRecord(spec) {
  const group = new THREE.Group();
  // Built before it is set down, because where a shed goes on its cell depends on how
  // wide the shed came out - see yardNudge. `modest` goes in with it: a dormer and a
  // turret are luxuries drawn three hundred times over, and buildings.js leaves them off
  // when the card cannot afford them.
  const built = buildBuilding(spec, { modest });
  const nudge = yardNudge(spec, built);
  const pose = housePlacement(spec, built.bbox, state.village.buildings);
  const [x, z] = cellCentre(spec.plot).map((v, i) => v + nudge[i] + (i ? pose.z : pose.x));
  let y = groundAt(x, z);
  // A harbour house stands on stilts, and this pins its deck just above the waterline.
  // That is right for one built out over the water at the end of a pier, and ruinous for
  // one whose plot turned out to be dry land: The Quay's ground runs from 1.65 to 1.99
  // and all nineteen of its harbour houses were pinned at 0.05, which buried the house,
  // the stilts and everything but the ridge of the roof. From the air a district of them
  // reads as green wedges lying in the grass. So the clamp only applies where there is
  // actually water to stand in - anything above the beach line stands on the ground like
  // any other building, stilts and all, which is what a house on a quayside does anyway.
  if (spec.harbour && y <= HARBOUR_WATERLINE) y = Math.max(-0.35, Math.min(y, 0.05));
  group.position.set(x, y, z);
  // The layout's convention, shared by scan.mjs's doorOf and settlers.js's DOOR_DIR, is
  // that rot 0 faces -z, 1 faces +x, 2 faces +z, 3 faces -x. Turning by rot * 90 degrees
  // gets two of those four right: it sends a front on local +z to world +x at rot 1 and
  // to world -x at rot 3, which is correct, but to world +z at rot 0 and -z at rot 2 -
  // the opposite of what the layout asked for. So every building on a north-south plot
  // has stood with its back to the street, which is why the tavern's door opened onto
  // grass while the square was behind it. Mirroring the turn agrees with all four.
  group.rotation.y = pose.yaw;

  const mesh = new THREE.Mesh(built.geometry, buildingMat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.id = spec.id;
  group.add(mesh);
  scene.add(group);

  const rec = {
    id: spec.id, spec, group, mesh, built, visible: true, scaffold: null,
    flagIdx: -1, blades: null, beacon: null, clock: null, fountain: null,
    flame: null, fire: null, smokeT: 0,
  };
  attachExtras(rec);
  state.byId.set(spec.id, rec);
  state.pickables.push(mesh);
  return rec;
}

function attachExtras(rec, { mail = true, signs = true } = {}) {
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
  if (built.animated && built.animated.clock) {
    rec.clock = attachClock(group, built.animated.clock.at, buildingMat);
  }
  if (built.animated && built.animated.fountain) {
    rec.fountain = attachFountain(group, built.animated.fountain.at, buildingMat);
  }
  // A guest island's town hall gets no postbox flag. The count it would raise is OUR unread
  // mail, and hanging that on somebody else's wall is both wrong and a small leak.
  if (mail && built.animated && built.animated.mailflag) {
    rec.mailFlag = attachMailFlag(group, built.animated.mailflag.at, buildingMat);
    setMailFlag(rec.mailFlag, unreadTotal() > 0);
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

  // A yard sign with the session's own name, for the houses that have one. Written down
  // rather than built: whether it is standing is the keeper's to say, and signOn below is
  // what puts it up.
  //
  // `signs` off skips even the writing down, which is how a guest island gets none. That is
  // not a detail either: a nameplate is three meshes - a leg, a board and a lettered face -
  // and the face paints a canvas of its own. Forty-one of them measured at 1.76x this
  // island's whole draw-call count for a second island, against a 1.6x budget; with them off
  // it is 1.35x. Their houses stay hoverable, which says the same thing for a tenth of the
  // price, and the rule reads well enough: a yard sign is for the island you live on.
  if (signs && (spec.kind === 'house' || spec.kind === 'camp')) {
    rec.sign = {
      text: spec.title || spec.name,
      opts: { small: spec.kind === 'camp' },
      // front-left of the plot, clear of the door, facing the street like the house does
      at: [-0.52, 0, 0.66], turn: -0.22,
    };
  }

  // A signboard in front of the office carrying the repository's name.
  if (signs && spec.civicType === 'office' && spec.repoName) {
    rec.sign = { text: spec.repoName, opts: {}, at: [-0.02, 0, 0.72], turn: 0 };
  }
  if (rec.sign && state.signs) signOn(rec);
}

// Signs on and off. Built and thrown away rather than built and hidden, for two reasons.
// Each sign paints a canvas of its own, so a hidden one still costs a texture per house
// and three hundred houses is three hundred textures nobody is looking at. And a page
// that is not allowed to read the lettering should not be the page that rasterised it.
function signOn(rec) {
  if (!rec.sign || rec.nameplate) return;
  const plate = createNameplate(rec.sign.text, rec.sign.opts);
  plate.group.position.set(...rec.sign.at);
  plate.group.rotation.y = rec.sign.turn;
  rec.group.add(plate.group);
  rec.nameplate = plate;
}
function signOff(rec) {
  if (!rec.nameplate) return;
  rec.group.remove(rec.nameplate.group);
  rec.nameplate.dispose();
  rec.nameplate = null;
}
function applySigns() {
  for (const rec of state.byId.values()) (state.signs ? signOn : signOff)(rec);
}
function countFires() { let n = 0; for (const r of state.byId.values()) if (r.fire) n++; return n; }

function disposeRecord(rec) {
  rec.mesh.geometry.dispose();
  if (rec.fountain) {
    rec.fountain.surface.geometry.dispose();
    rec.fountain.jets.geometry.dispose();
  }
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
  state.world.setHouseFrontages(state.byId.values());
  return fresh;
}

// --------------------------------------------------------------- scene build
function buildScene(village) {
  const terrain = makeTerrain(village.island.seed, { size: village.grid.size, polders: village.polders });
  if (village.island.terrainHash && terrain.hash !== village.island.terrainHash) {
    console.warn(`terrain mismatch: viewer ${terrain.hash}, scanner ${village.island.terrainHash}`);
  }
  state.terrain = terrain;
  // This island becomes the first region, at the origin, so everything that asks the
  // archipelago a question gets the same answer it used to get from the terrain directly.
  // Rebuilt rather than mutated because buildScene runs again on a reseed.
  state.sea = createArchipelago();
  // Where the sea put us. It is [0, 0] for the first island into a world, which is every
  // single-player island and every host - but a joiner is placed somewhere else, and it
  // has to agree with everybody else about where that is. Poses travel in world
  // coordinates (lib/players.mjs), so a client that quietly kept itself at the origin
  // would see every other body in the wrong place and be seen in the wrong place itself.
  //
  // The local terrain is still origin-centred and layout.json is still local: only the
  // region's offset changes, which is exactly the asymmetry shared/regions.mjs was built
  // around, so a house still never moves.
  state.region = state.sea.add(placeIsland(terrain, { id: 'home', origin: state.homeOrigin || [0, 0] }));
  joinRegionsFromParams(terrain, village);   // has to be in the sea before the water is laid
  state.world = createWorld(scene, terrain, village, {
    month: new Date().getMonth(),
    shadowSize: modest ? 1024 : 2048,
    modest,
    // So the water is laid over everything there is, not over this island alone.
    sea: state.sea,
  });
  // The fog object arrives with the world; the distances are ours, and they are set here
  // rather than on the first neighbour sync so that no frame is ever drawn without them.
  applyFogRange();
  applyCameraRange();
  raiseGuestIslands();
  buildDocks(village);
  launchBoats();
  if (state.boating) state.boating.clear();
  state.settlers = createSettlers(scene, buildingMat, terrain);
  // Outings. Everything it needs is asked for rather than held, because a reseed replaces
  // the terrain and rebuilds the docks under it - see the note at the top of boating.js.
  state.boating = createBoating({
    terrain: () => state.terrain,
    settlers: state.settlers,
    dock: homeDock,
    fleet: outingFleet,
    rng: makeRng(hash32(`${village.island.name}:boating`)),
    eager: params.has('sail'),
  });
  syncBridges(village);
  state.settlers.setRoads(roadCells(village), state.world.squareCells(village));
  state.particles = createParticles();
  state.waitingFlags = createWaitingFlags(scene);
  state.flags = createFlagMesh(200);
  scene.add(state.flags);

  syncHamlets(village);
  // The world has just been built for the island as it is, which is what the chronicle
  // calls "live" - so record that as already drawn. Without it the first `setLiveMode` of
  // every page load re-lays the whole landscape it has this moment finished laying.
  shownKey = 'live';
  shownPolders = (village.polders || []).length;
  state.shot = village;
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
  handOutDecks();
}

// Everything that stands above the terrain and can be stood on: the crossings the layout
// laid, plus the ones somebody built by hand. Two sources, one map.
//
// Walk mode wants them as a list per cell, lowest first, because a cell can carry more
// than one surface - see the note on `levels` in web/js/walk.js. The settlers still walk
// the routes the layout plans and never leave the ground, so they keep the flat map they
// have always had.
//
// Called from both sides: the two lists arrive at different moments - the layout's with a
// village update, a built one with the props - and whichever came last used to win by
// replacing the other.
// The decks on THIS island, on the plain cell key, which is what a settler walking here
// uses and what an island bundle carries. handOutDecks below builds the same map and then
// adds the region stride for walk mode, which reads the whole archipelago; this is the half
// before that, kept apart so neither has to undo the other's work.
function deckMapForHome() {
  const flat = new Map(decks);
  if (state.props && state.terrain) {
    for (const [cell, y] of state.props.deckCells(state.terrain)) flat.set(cell, y);
  }
  for (const d of state.docks) {
    if (state.region && d.region !== state.region) continue;
    for (const [gx, gz] of d.cells) flat.set(gx + gz * d.region.size, QUAY_DECK);
  }
  return flat;
}

function handOutDecks() {
  const flat = new Map(decks);
  if (state.props && state.terrain) {
    for (const [cell, y] of state.props.deckCells(state.terrain)) flat.set(cell, y);
  }
  // Two consumers, two keyings, and they are not the same any more. The settlers walk this
  // island and nothing else, so they keep the plain `gx + gz*size` cell the bridges and the
  // props are recorded under. Walk mode reads the whole archipelago, where that number is
  // ambiguous - two islands of one size give corresponding cells identical keys - so every
  // region carries a stride and this island's has to be added on. It is zero today, because
  // home is the first region in the sea; writing it out anyway is what stops a second
  // island's bridge from appearing as a deck in the sky over ours.
  const base = state.region ? state.region.levelBase : 0;
  // Our own quay, for the settlers. They walk this island and no other, so they take the
  // plain cell key - and they need the planks for the same reason you do: without them a
  // settler on an outing wades out to the boat alongside the dock instead of walking out
  // along it. Only the home region's, because `flat` is this island's map.
  for (const d of state.docks) {
    if (state.region && d.region !== state.region) continue;
    for (const [gx, gz] of d.cells) flat.set(gx + gz * d.region.size, QUAY_DECK);
  }
  const stacked = new Map();
  for (const [cell, y] of flat) stacked.set(base + cell, [y]);
  // The quay's planks are a floor over water, exactly as a bridge deck is - without this
  // you wade alongside your own dock instead of walking out along it, which is both wrong
  // and the difference between a dock and a decoration. Keyed per region, so a guest
  // island's quay is its own storey and not a deck in the air over ours.
  for (const d of state.docks) {
    const r = d.region;
    for (const [gx, gz] of d.cells) {
      stacked.set(r.levelBase + gx + gz * r.size, [QUAY_DECK]);
    }
  }
  if (state.settlers) state.settlers.setDecks(flat);
  if (state.walk) state.walk.setLevels(stacked);
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

// Where a hamlet's road leaves its land - the gate the welcome sign stands over. Derived
// rather than recorded: the road id is `road:<district>:<lobe>`, so the cells are already
// on the wire, and the parcel says which of them are still on the hamlet's own ground.
// Deriving it also means the chronicle gets it for nothing, because it filters the roads
// it hands down and the gate follows whatever road is there.
function gateOf(village, d, li, lobe) {
  const lat = village.island && village.island.lattice;
  const road = (village.paths || []).find((r) => r.id === `road:${d.id}:${li}`);
  if (!lat || !road || road.cells.length < 2 || !lobe.parcel) return null;
  const own = new Set();
  const p = lobe.parcel;
  for (let r = 0; r < p.h; r++) {
    for (let c = 0; c < p.w; c++) if ((p.rows[r] || '')[c] === '1') own.add(`${p.i0 + c},${p.j0 + r}`);
  }
  const mine = ([gx, gz]) => own.has(
    `${Math.floor((gx - lat.anchor[0]) / lat.pitch)},${Math.floor((gz - lat.anchor[1]) / lat.pitch)}`);
  // The road starts inside and walks out, so the gate is the step where that stops
  // being true - and if it never was, the first cell is close enough to the edge.
  for (let i = 0; i < road.cells.length - 1; i++) {
    if (mine(road.cells[i]) && !mine(road.cells[i + 1])) {
      return { at: road.cells[i], next: road.cells[i + 1] };
    }
  }
  return { at: road.cells[0], next: road.cells[1] };
}

// ---- the middle of the square ----------------------------------------------
// The fountain stands dead centre of the plaza and is earned at forty-five settlers.
// Until then that cell is the one piece of bare stone in the middle of everything, which
// reads as a gap rather than as room, so the town keeps a flower bed there and gives the
// place up the day the water arrives.
//
// This is drawn rather than planned: the cell belongs to the fountain in the layout, and
// the bed is only what is standing on it while the fountain is still being earned. Giving
// it a plot of its own would mean a plot that has to be taken away again, and nothing in
// `lib/layout.mjs` is ever taken away. It is not a building either - no dossier, no
// settler, no name - so it stays out of `state.byId` and carries just enough of a record
// (`group`, `built`, `id`) for `blockersOf` to read.
let squareBed = null;

// The extra tables for the borrel, and where on the square they may stand: the town's own
// paving, minus every cell something is already built on, nearest the middle first. Worked
// out when the village changes rather than when the borrel starts, because a Friday
// afternoon is a bad moment to be walking a hundred and twenty cells.
function syncBorrelTables(village) {
  const town = village.island && village.island.town;
  if (!town || !town.paved || !state.terrain) return;
  if (!state.borrel) {
    const built = buildBuilding({ id: 'civic:tables', kind: 'civic', civicType: 'tables', style: 'unknown' });
    state.borrel = createBorrelTables(scene, built.geometry, buildingMat);
  }
  const taken = new Set();
  for (const b of village.buildings || []) {
    const p = b.plot;
    if (!p) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) taken.add(`${p.gx + x},${p.gz + z}`);
  }
  // The middle of the square is the flower bed or the fountain, and neither is a plot.
  if (town.centre) taken.add(`${town.centre[0]},${town.centre[1]}`);
  const centre = town.centre || [state.terrain.half, state.terrain.half];
  const free = town.paved
    .filter(([gx, gz]) => !taken.has(`${gx},${gz}`))
    .sort((a, b) => ((a[0] - centre[0]) ** 2 + (a[1] - centre[1]) ** 2)
      - ((b[0] - centre[0]) ** 2 + (b[1] - centre[1]) ** 2));
  state.borrel.setSpots(free, {
    cellWorld: (gx, gz) => state.terrain.cellWorld(gx, gz),
    groundAt,
  });
}

function syncSquareBed(village) {
  const town = village.island && village.island.town;
  if (!town || !town.centre || !state.terrain) return;
  if (!squareBed) {
    const built = buildBuilding({ id: 'civic:flowerbed', kind: 'civic', civicType: 'flowerbed', style: 'unknown' });
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(built.geometry, buildingMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    scene.add(group);
    squareBed = { id: 'civic:flowerbed', group, built };
  }
  const [x, z] = state.terrain.cellWorld(town.centre[0], town.centre[1]);
  squareBed.group.position.set(x, groundAt(x, z), z);
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
        // The mooring posts stand half a unit over the deck, and their shadows falling
        // across the planks and out onto the water are most of what makes a dock read as
        // standing in the sea rather than lying on it.
        pm.castShadow = true;
        pm.receiveShadow = true;
        hamletGroup.add(pm);
        hamletSigns.set(`pier:${d.id}`, { group: pm, dispose: () => pm.geometry.dispose() });
      }
    }
    if (!d.center || d.tier === 'farmstead') continue;
    for (const [li, lobe] of (d.lobes || []).entries()) {
      const key = `${d.id}#${li}`;
      live.add(key);
      // Over the road where it leaves the hamlet's land, square to it, so you read the
      // name walking through rather than passing a placard in a field. The green it used
      // to stand on is gone.
      const gate = gateOf(village, d, li, lobe);
      const [gx, gz] = gate ? gate.at : (lobe.green || d.center);
      const [x, z] = terrain.cellWorld(gx, gz);
      const sx = x, sz = z;
      const along = gate ? Math.abs(gate.next[0] - gate.at[0]) > Math.abs(gate.next[1] - gate.at[1]) : false;
      const have = hamletSigns.get(key);
      if (have && have.text === d.name && have.along === along) {
        have.group.position.set(sx, groundAt(sx, sz), sz);
        continue;
      }
      if (have) { hamletGroup.remove(have.group); have.dispose(); }
      const sign = createNameplate(titleCaseName(d.name), {
        width: 2.1, height: 0.62, canvasW: 768, band: d.hue, height0: 1.35, posts: 2, arch: 2.2,
      });
      // The arch straddles the road: its posts sit either side of the way through.
      sign.group.rotation.y = along ? Math.PI / 2 : 0;
      sign.group.position.set(sx, groundAt(sx, sz), sz);
      sign.group.userData.id = `district:${d.id}`;
      hamletGroup.add(sign.group);
      hamletSigns.set(key, { ...sign, text: d.name, along, popped: !have });
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
  // This measures OUR island, because that is the one the opening sweep frames: you arrive
  // home, not over the archipelago. What the camera is then leashed to is a different
  // question with a different answer - see applyCameraRange, which measures everything.
  // The two used to be the same line, and that is exactly why a second island could not be
  // looked at: framing home also decided how far you were allowed to wander from it.
  // fit the wider of the two spans, then pull in a little so the island fills the frame
  const r = 0.5 * Math.max(maxX - minX, maxZ - minZ) + 2;
  const fov = camera.fov * Math.PI / 180;
  // The ceiling was sized for a 64 grid - first 88, then 175 - and each time the island
  // grew it went on cropping the coast at boot, because the fit a 256 grid asks for is
  // about 235. Derived from the island instead of guessed again: 1.7 half-widths is the
  // distance a 45-degree lens needs to hold a round island with a little sea around it,
  // and 175 stays as the floor so a small island is framed exactly as it was.
  const dist = clamp((r / Math.tan(fov / 2)) * 0.82, 22, Math.max(175, t.half * 1.7));
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
// When the Friday borrel is on: half an hour, from half past four. One place rather than
// three numbers in the middle of the frame loop, because this is the sort of thing that
// gets asked for by the half hour and should be one line to move.
const BORREL_DAY = 5;              // Sunday is 0, so Friday is 5
const BORREL_FROM = 16.5;
const BORREL_UNTIL = 17;

function visibleAt(spec, t) {
  const start = new Date(spec.startedAt).getTime();
  return start <= t;
}
// How much of the island the village had built by a given moment. Until now the only
// thing the chronicle rewound was the buildings: scrub back to the founding day and every
// house went, while the polders, their dikes and the mill they earned all stayed - ground
// that would not exist for another six weeks. This is the landscape's side of `visibleAt`.
//
// Polders are the exact case, and the only one handled here. The ladder is a pure
// function of the settler count, the list is append-only, and the scanner now stamps each
// one with the moment it was drained - so the coast at time t is a prefix of the list.
// `history.js` projects the village onto the cursor's moment; this lays that projection
// out with the same functions that build the landscape from a live village, so there is
// no second description of what a hamlet looks like.
//
// Two costs to respect. Moving the coast means rebuilding the heightfield, because a
// polder is stamped into it rather than drawn on top - but the coast changes only once
// per polder, so it is keyed separately and touched almost never. Re-laying the land is
// the heavy one: `setOwnership` re-decodes ownership over the whole grid, re-plans the
// fields, re-tints the ground and rebuilds the boundaries. That cannot run per pointer move,
// so the projection's key says what would actually be drawn and the work is throttled -
// with a trailing pass, so the last position the slider stops at is always the one drawn.
const LANDSCAPE_MS = 120;
let shownKey = null, shownPolders = null, landscapePending = null, landscapeRan = 0;

function layLandscape(shot) {
  const w = state.world;
  if (shot.polders !== shownPolders) {
    shownPolders = shot.polders;
    const v = state.village;
    const next = makeTerrain(v.island.seed, { size: v.grid.size, polders: v.polders.slice(0, shot.polders) });
    state.terrain = next;
    // The region holds the terrain it was placed with, and the water patch now reads its
    // depths through the archipelago - so a coast that moves has to move here too, or the
    // shallows stay where the polder used to be while the ground under them has gone.
    state.region = state.sea.replace('home', placeIsland(next, { id: 'home', origin: state.homeOrigin || [0, 0] }));
    w.reshape(next);
  }
  state.shot = shot.village;
  w.setOwnership(shot.village);
  w.buildPaths(shot.village.paths, w.squareCells(shot.village));
  // The square goes along with the roads, the same as it does on the line above and at
  // the two other callers. It used to be left out here and that cost nothing, because
  // `setRoads` only folded the square into the road network - but the Friday borrel
  // remembers those cells separately as the place to walk to, so leaving them out empties
  // that list. The result was a borrel that worked until you touched the chronicle and
  // then silently never happened again, which is the worst shape a bug can have.
  if (state.settlers) state.settlers.setRoads(roadCells(shot.village), w.squareCells(shot.village));
  syncHamlets(shot.village);
}

function applyLandscape(force = false) {
  if (!state.world || !state.village) return;
  const shot = projectVillage(state.village, state.chronicle.t ?? NaN);
  if (shot.key === shownKey) return;
  const now = performance.now();
  if (!force && now - landscapeRan < LANDSCAPE_MS) {
    clearTimeout(landscapePending);
    landscapePending = setTimeout(() => applyLandscape(true), LANDSCAPE_MS - (now - landscapeRan));
    return;
  }
  clearTimeout(landscapePending);
  landscapePending = null;
  landscapeRan = now;
  shownKey = shot.key;
  layLandscape(shot);
}

function applyVisibility() {
  const t = timeNow();
  for (const rec of state.byId.values()) {
    const ok = passesFilter(rec.spec) && visibleAt(rec.spec, t) && !rec.popping;
    rec.group.visible = ok;
    if (state.settlers) state.settlers.setVisible(rec.id, ok && rec.spec.kind !== 'civic');
    if (rec.flagIdx >= 0) updateFlagInstance(rec, ok);
  }
  // The bed holds the middle of the square for exactly as long as the fountain is not
  // standing on it. Decided here, after the loop, rather than when the bed is built: that
  // way scrubbing the chronicle back past the fountain puts the bed back the same moment
  // it takes the fountain away, and a filter that hides the civic buildings hides both.
  if (squareBed) {
    const fountain = state.byId.get('civic:fountain');
    squareBed.group.visible = !(fountain && fountain.group.visible);
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
// A builder's frame stands around the walls and on the step, not around the step: the
// bounding box it used to be sized from already had the doorstep in it, so the frame came
// out a full 0.26 wider again than the widest stone on the plot - 1.97 across on a 3-wide
// plot - and the poles of a house still in the steigers went straight through the sheds in
// its own yard, which is what the complaint was about. Sizing it to the walkable
// rectangles instead puts it where a scaffold goes, inside the porch it stands on.
function addScaffold(rec) {
  if (rec.scaffold) return;
  const m = new THREE.Mesh(scaffoldGeo, buildingMat);
  const b = rec.built.bbox;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  // `walls` rather than `solids`: since a house puts a cart and a woodpile out in its own
  // yard, the rectangles walk mode blocks on reach most of the way to the plot edge, and
  // a frame round all of them would be back to standing in the neighbours - which is the
  // complaint this function already carries a paragraph about.
  for (const r of rec.built.walls || rec.built.solids) {
    x0 = Math.min(x0, r.x - r.hx); x1 = Math.max(x1, r.x + r.hx);
    z0 = Math.min(z0, r.z - r.hz); z1 = Math.max(z1, r.z + r.hz);
  }
  const walls = Number.isFinite(x0) ? { x: x1 - x0, z: z1 - z0 } : { x: b.max.x - b.min.x, z: b.max.z - b.min.z };
  // Room for the builders to stand, as a share of what is being built rather than a flat
  // 0.26 all round. That number is a fifth of a house and most of an apprentice's shed,
  // and it put a frame half again as wide as the hut inside it: three sheds in one yard
  // went back to touching through their own scaffolding while the huts had grass between
  // them. A house 1.24 across still gets its full 0.26.
  const room = (v) => { const w = Math.max(0.3, v); return w + Math.min(0.26, w * 0.21); };
  m.scale.set(room(walls.x), Math.max(0.6, rec.built.height + 0.2), room(walls.z));
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
    const r = await mine(`/village.json?ts=${Date.now()}`, { cache: 'no-store' });
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

  // Outside the `animate` guard on purpose: the boundaries and the tint have to be right on
  // a silent reload too, and only the falling trees are an animation.
  if (state.world && (!prev || next.districtsRev !== prev.districtsRev)) {
    state.world.setOwnership(next);
    syncHamlets(next);
  }
  syncSquareBed(next);
  syncBorrelTables(next);

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
      || before.kind !== spec.kind || (before.ornaments || []).join() !== (spec.ornaments || []).join()
      || JSON.stringify(before.sheds || []) !== JSON.stringify(spec.sheds || []);
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
  state.world.setHouseFrontages(state.byId.values());
  // The key is computed from the village, so a new one from the server invalidates it;
  // without this a changed island would keep the landscape drawn for the old one.
  shownKey = null;
  applyVisibility();
  refreshWaitingFlags();
  refreshUI();
  if (state.walk && state.mode === 'walk') {
    state.walk.setBlockers(walkableBlockers());
    state.walk.setInteractables(interactables());
  }

  if (!animate) { for (const e of events) applyEventInstantly(e); reportPlacements(); return; }
  for (const e of events) scheduleEvent(e);
  reportPlacements();
}

// Tell the island where the buildings actually ended up.
//
// Their positions are not their plots: housePlacement loosens the building line and
// yardNudge pushes a shed out to the edge of its master's yard, and *both measure the
// built geometry*, which exists nowhere but here. A settler stands outside its own front
// door, so the sea - which has a bundle and no meshes - would otherwise put apprentices
// inside their own sheds. Measured on this village: 259 of 274 buildings are nudged, by a
// median of a third of a cell.
//
// Only the keeper's page, and only when the answer has changed. A visitor drew the same
// island from the same bundle and has nothing to add; the islander refuses them anyway.
let toldPlacements = '';
function reportPlacements() {
  if (!islanderHere() || state.guest || !state.terrain) return;
  const at = {};
  for (const [id, rec] of state.byId) {
    if (!rec.group || !rec.spec || !rec.spec.plot) continue;
    at[id] = [Math.round(rec.group.position.x * 1000) / 1000, Math.round(rec.group.position.z * 1000) / 1000];
  }
  // And where the roads are carried over water. Same story: a bridge's deck height comes
  // out of its own built arch, so a sea working without it walks settlers along the
  // riverbed. Our own island's cells only, on the plain key the bridges are recorded
  // under - a bundle is one island and the region strides do not come into it.
  const decks = {};
  const size = state.terrain.size;
  for (const [cell, y] of deckMapForHome()) decks[cell] = Math.round(y * 1000) / 1000;
  const key = JSON.stringify([at, decks]);
  if (key === toldPlacements) return;
  toldPlacements = key;
  mine('/api/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ at, decks }),
  }).catch(() => { toldPlacements = ''; });   // it will be sent again on the next rebuild
}

function placeFigure(rec) {
  if (rec.spec.kind === 'civic') return;
  const p = rec.group.position;
  const f = state.settlers.add(rec.id, rec.spec, [p.x, p.y, p.z], { yaw: rec.group.rotation.y });
  if (f && overWater(rec)) f.deckY = p.y + 0.62;
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
  if (f) {
    f.spec = rec.spec;
    const reach = rec.spec.kind === 'shed' ? .46 : .85, yaw = rec.group.rotation.y;
    f.home = [rec.group.position.x + Math.sin(yaw)*reach, rec.group.position.z + Math.cos(yaw)*reach];
    if (overWater(rec)) f.deckY = rec.group.position.y + 0.62;
  }
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
  // The board you are standing at gets the mouse before the island does. It takes no
  // pointer events of its own - see the top of web/js/panels.js - so this is what lights
  // up a button under the cursor.
  if (state.panels) state.panels.point(pointer);
});
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; moved = 0; });
renderer.domElement.addEventListener('pointerup', (e) => {
  // Aimed from the event rather than from the last move: a tap on a touch screen never
  // sends one, and a click that lands a finger's width off a button is worse than none.
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  // A click on the board you are working is the board's, and never also picks whatever
  // building happens to stand behind it.
  if (moved < 5 && state.panels && state.panels.press(pointer)) { downAt = null; return; }
  if (moved < 5) {
    const hit = pick();
    // A silhouette on the horizon is not somewhere to go any more - see applyNeighbours -
    // so a click on one is a click on nothing, and closing the dossier is the right answer.
    if (hit && !String(hit).startsWith('neighbour:')) select(hit);
    else state.ui.closeDossier();
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
// The controller from up in the sky: right stick orbits, left stick pans, triggers zoom.
// A drops you onto the island, B clears whatever panel is hanging over it.
function orbitPad(a, dt) {
  if (a.hit('walk') || a.hit('walkAlt')) { enterWalk(); return; }
  if (a.hit('back')) state.ui.closeOverlays();
  const look = a.look, move = a.move;
  if (!(look.x || look.y || move.x || move.y || a.lt > 0.1 || a.rt > 0.1)) return;
  const off = camera.position.clone().sub(controls.target);
  const radius = off.length();
  let theta = Math.atan2(off.x, off.z), phi = Math.acos(clamp(off.y / radius, -1, 1));
  theta -= look.x * 1.7 * dt;
  phi = clamp(phi + look.y * 1.2 * dt, 0.14, 1.34);
  const r2 = clamp(radius * (1 + (a.lt - a.rt) * 1.1 * dt), controls.minDistance, controls.maxDistance);
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

function tick(nowMs) {
  if (!contextLost) {
    try {
      frame(nowMs);
      recovery.frame(nowMs, document.visibilityState === 'visible');
    } catch (e) {
      recovery.failed();
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
  // Who gets it is decided in input.js; here it is one line.
  if (state.input) state.input.frame(dt);

  // ---- the other people ---------------------------------------------------
  // Outside the walking branch on purpose: from up here you should be able to watch
  // somebody crossing the island.
  //
  // But not while you are looking at the past. Scrubbing the chronicle back is a view of
  // this island in May, and other people's bodies and other islands' settlers are here and
  // now - they would be wandering through a village that has not been built yet. One
  // condition rather than a second drawing path: `state.chronicle.t` is exactly "not on
  // Live", and it is the same test timeNow() already makes.
  const live = state.chronicle.t == null;
  if (state.peers) {
    state.peers.setVisible(live);
    state.peers.update(dt);
    // Only the people in the room you are standing in are people you can bump into.
    if (state.inside) state.inside.walk.setPeerBlockers(state.peers.blockers(state.inside.room));
    else if (state.mode === 'walk') state.walk.setPeerBlockers(state.peers.blockers());
  }

  // ---- walking ------------------------------------------------------------
  if (state.inside) {
    const w = state.inside.update(dt);
    state.ui.setWalkPrompt(w && w.near ? w.near : null);
    state.ui.setPouch(null);              // the purse is for the seed stall, not for the bar
  } else if (state.mode === 'walk') {
    const w = state.walk.update(dt);
    state.ui.setWalkPrompt(promptFor(w && w.near));
    state.ui.setPouch(state.guest ? null : pouch());
    reportWhere();
  }
  // A conversation borrows the camera, and this is where it writes it: after the feet,
  // because while it is running walk mode is paused and this is the only hand on it.
  faceToFace.update(dt);

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
    // The flight in is the one stretch where the camera moves without the controls, so it
    // has to hand the shadow frustum its own distance or the island lands in a shadowless
    // picture and only fills in once you touch the mouse.
    if (state.world) state.world.followShadow(s.cx, s.cz, dist);
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
  if (state.settlers) {
    // Friday afternoon: the whole village downs tools and heads for the square, and stays
    // there until closing time. Written as hours with the minutes as a fraction, because
    // that is what currentHour() hands out.
    const d = new Date(timeNow());
    const borrel = d.getDay() === BORREL_DAY && hour >= BORREL_FROM && hour < BORREL_UNTIL;
    state.settlers.setGather(borrel);
    // And the tables to stand at while it lasts: one set per ten islanders, of which the
    // set the village earned is the first, so the rest are carried out and taken back in
    // with the borrel itself.
    if (state.borrel) {
      state.borrel.show(borrel ? tableSetsFor(state.village && state.village.stats && state.village.stats.settlers) : 0);
    }
    // Whoever fancied an afternoon on the water, and they go first: an outing moves a hull
    // and settlers.update puts the body standing in it wherever that hull now is. The other
    // way round the rider reads last frame's position and trails the boat by one step -
    // measured, 0.15 of a unit at cruising speed, which is a settler standing in the wake.
    if (state.boating) state.boating.update(dt, state.world ? state.world.state.night : 0);
    state.settlers.update(dt, state.world ? state.world.state.night : 0);
  }
  if (state.horizon) state.horizon.update(dt, state.world ? state.world.state.night : 0);
  if (state.particles) state.particles.update(dt);
  if (state.waitingFlags) state.waitingFlags.tick(nowMs / 1000, state.world ? state.world.state.night : 0);
  if (state.props) state.props.update(dt);
  if (state.panels) {
    state.panels.setVisible(!state.inside);
    state.panels.update(dt);
  }
  if (state.crops) state.crops.update(dt);

  // The fleet. A boat somebody is sailing is being moved by walk mode, so this only has to
  // put the hull where that has left it; a moored one sits still and bobs.
  const mine = state.walk && state.walk.aboard();
  for (const b of state.boats) {
    // Only the hull under our own hands is reported; everybody else's arrives as a message.
    if (b === mine && state.net && (Math.abs(b.x - (b.sentX ?? 1e9)) > 0.05
      || Math.abs(b.z - (b.sentZ ?? 1e9)) > 0.05 || Math.abs(b.yaw - (b.sentYaw ?? 1e9)) > 0.03)) {
      state.net.movedBoat(b.id, b.x, b.z, b.yaw);
      b.sentX = b.x; b.sentZ = b.z; b.sentYaw = b.yaw;
    }
    b.craft.place(b.x, b.z, b.yaw);
    b.craft.bob(nowMs / 1000);
    b.deckY = b.craft.deck ? b.craft.deck() : DECK_Y;
  }
  // While you are sailing, whether there is anywhere to step out changes with every metre,
  // so the offer is rebuilt with it. Cheap because aboard a boat the whole list is that one
  // offer - there is nothing to talk to, nothing to sow and no door to open from the water.
  //
  // And once more on the way out, because the list a boat leaves behind is that same single
  // offer, or nothing at all in open water. Rebuilding only on the way ashore would have
  // been enough for the one route that goes that way and left every other route - a boat
  // taken away, a walk mode re-entered - standing on a quay with nothing in reach.
  if (state.mode === 'walk' && state.walk) {
    const aboard = !!state.walk.aboard();
    if (aboard || aboard !== wasAboard) state.walk.setInteractables(interactables());
    wasAboard = aboard;
  }

  // per-building animated bits
  const nightAmt = state.world ? state.world.state.night : 0;
  for (const rec of state.byId.values()) animateExtras(rec, dt, hour, nightAmt, nowMs);
  // The same hands turn the mills on somebody else's island. None of this is the server's:
  // it only ever said which building this is, and the turning, the clock, the fountain and
  // the chimney smoke have always been the browser's own. So a guest island gets them for
  // the price of walking a second list - it is a village over there too, and a village whose
  // mills have stopped reads as a diorama.
  for (const g of state.guests) {
    for (const rec of g.records) animateExtras(rec, dt, hour, nightAmt, nowMs);
    // Their people, drawn where the sea last said they were and interpolated between. The
    // ground they stand on is their own region's, which is what puts a body on a quay's
    // planks rather than in the water beside them.
    if (g.crowd) g.crowd.draw(dt, (x, z) => g.region.worldHeight(x, z), nowMs, live);
  }


  // The sky and the open sea ride with the eye, wherever the eye is. Once a frame, before
  // either camera branch below, because both of them move the camera and neither of them
  // owns the horizon.
  if (state.world) state.world.recentre(camera.position.x, camera.position.z);
  // The haze reaches as far as the eye has pulled back, so it has to be told where the eye
  // is. Only once there is a second island: on our own it is the fixed ring it always was,
  // and this then costs one comparison a frame.
  if (state.sea.count() > 1) applyFogRange();

  if (!state.intro && state.mode !== 'walk') {
    controls.update();
    // Whatever ground is under the camera, on whichever island - and out between them the
    // archipelago answers with open sea rather than with the nearest coast, so the camera
    // may come right down to the water in the channel instead of being held up at the
    // height of a beach it is nowhere near.
    const y = state.sea.height(camera.position.x, camera.position.z) + 0.9;
    if (camera.position.y < y) camera.position.y = y;
    const b = state.bounds;
    controls.target.x = clamp(controls.target.x, b.minX - 3, b.maxX + 3);
    controls.target.z = clamp(controls.target.z, b.minZ - 3, b.maxZ + 3);
    // Where the shadows have to reach, and how far: pulled back over the whole island the
    // frustum has to cover the whole island, and down among the houses it must not.
    if (state.world) state.world.followShadow(controls.target.x, controls.target.z, camera.position.distanceTo(controls.target));
  } else if (state.mode === 'walk' && state.world) {
    // On foot the shadows belong around your feet, at the tightest the frustum goes -
    // this is the one view where a shadow is a metre from the eye. It used to be left
    // wherever the orbit camera had put it, which on a walk to the coast meant walking
    // out of the shadow map.
    state.world.followShadow(camera.position.x, camera.position.z, 1);
  }

  // After the camera is settled, so the ray it casts is the one you are looking down.
  if (state.ghost) state.ghost.update(dt);
  // Hover labels and a ghost fight over the same pointer, and the ghost wins.
  if (state.mode !== 'walk' && !(state.ghost && state.ghost.holding())) updateLabels();
  state.ui.setClock(hour, state.world ? state.world.season() : seasonOf(month));
  renderer.render(state.inside ? state.inside.scene : scene, camera);
  if (statsReadout) {
    // Colour pass only: three.js resets renderer.info after the shadow pass, so the
    // shadow map's own calls and triangles are not in these numbers. Comparing two runs
    // is what they are for, and for that they are honest.
    const info = renderer.info.render;
    statsReadout.textContent = `${modest ? 'modest' : 'standard'} · ${info.calls} calls · ${info.triangles.toLocaleString()} tris · ${state.particles?.count() ?? 0} particles`;
  }
  // After the canvas, on its own layer above it. This one has no depth of its own - see
  // the top of web/js/panels.js for what that costs.
  if (state.panels) state.panels.render();
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
      const sub = `${m.island} · ${m.settlers} settler${m.settlers === 1 ? '' : 's'} · click to sail over`;
      if (hoverId === `neighbour:${m.id}`) {
        hoverItem = { name: m.name, sub: m.dev ? `${m.dev} · ${sub}` : sub, x, y };
      } else {
        // A working copy says which work it is, over its own name.
        items.push({ text: m.name, above: m.dev || null, x, y });
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
  const v = state.shot || state.village;
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
  applyLandscape();
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
  applyLandscape();
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
  navigator.serviceWorker.register(mineUrl('/sw.js')).catch(() => { /* not installable, no matter */ });
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
    // Only asks. The island writes the setting down and tells every open window, this
    // one included, so what is drawn always comes from the server's answer.
    onSigns: async (mode) => {
      try {
        const r = await mine('/api/display', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'nameplates', value: mode }),
        });
        if (!r.ok) state.ui.toast(`The signs stayed as they were: ${escapeHtml((await r.json().catch(() => ({}))).error || r.statusText)}`);
      } catch { state.ui.toast('The island did not answer.'); }
    },
    // The picker. Opening the panel asks the islander who is out there - it probes each
    // candidate's /health, so the list says whether anybody is home before you choose.
    onSettingsOpen: async () => {
      if (!islanderHere()) return;               // a phone has no islander and nothing to set
      try {
        state.ui.setSeas(await mine('/api/seas').then((r) => r.json()));
      } catch { state.ui.setSeas({ mode: 'single', seas: [] }); }
    },
    onSeaMode: (mode) => changeSea({ mode }),
    onJoinSea: (url) => changeSea({ mode: 'join', url }),
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
    onBuild: () => openBuild(),
  });

  state.buildMenu = createBuildMenu(document.body, {
    onPick: (spec) => { if (state.ghost) state.ghost.take(spec); },
    onDemolish: () => { if (state.ghost) state.ghost.demolish(); },
    // The menu is the only part of building that stops your feet. While a ghost is in
    // your hand you keep walking, which is what makes "two steps left, then down" work.
    onClose: () => { if (state.walk && state.mode === 'walk') state.walk.setPaused(false); },
  });

  state.market = createMarket(document.body, {
    onChange: (g) => {
      state.garden = g;
      if (state.crops) state.crops.apply(g.beds || [], { animate: true });
      if (state.mode === 'walk') state.walk.setInteractables(interactables());
    },
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });

  state.mailbox = createMailbox(document.body, {
    // The panel knows the counts before the poll does, because it is the thing that
    // changed them. Every route into the flag goes through showMail, so the box outside
    // and the tabs inside can never disagree.
    onCounts: (counts) => showMail(counts),
    onClose: () => { if (state.walk) state.walk.setPaused(false); },
  });
  // The flag is the whole reason for the timer: it is what tells you there is post
  // without your having to walk over and look. It is skipped while the tab is in the
  // background, and never runs for a visitor, who has no postbox to look at.
  pollMail(true);
  setInterval(() => pollMail(), MAIL_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollMail(); });

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

  state.chat = createChat(document.body, {
    onSendAway: (id) => askToSendAway(id),
    onClose: () => {
      // Your feet get their keys back only once the camera is home again: unpausing now
      // would let walk mode write the camera mid-flight, and its stance would win.
      const walkOn = () => { if (state.walk) state.walk.setPaused(false); };
      if (!faceToFace.end(walkOn)) walkOn();
      // whatever was said is in the transcript now, so let the island catch up
      mine('/api/rescan', { method: 'POST' }).catch(() => {});
    },
    onBusyChange: () => {},
  });

  state.pad = createGamepad({
    onConnect: (id) => {
      state.ui.setPad(true);
      state.ui.toast(`Controller ready: ${String(id).slice(0, 40)}`);
    },
  });

  // Who the controller is talking to. First one that says it is up, wins - a panel over
  // a room, a room over the island, the island over the sky.
  state.input = createInput(state.pad, {
    onFirstPad: () => {
      state.padSeen = true;
      state.ui.setPad(true);
      state.ui.toast('Controller connected. <b>A</b> to walk the island.');
    },
  });
  state.input.mode('panel', {
    active: () => !!openPanel(),
    handle: (a, dt) => {
      const p = openPanel();
      if (p.pad) p.pad(a, dt);              // the boards steer a cursor of their own
      else if (a.hit('back')) p.close();    // everything else: B is the way out
    },
  });
  state.input.mode('inside', {
    active: () => !!state.inside,
    handle: (a, dt) => state.inside.pad(a, dt),
  });
  state.input.mode('walk', {
    active: () => state.mode === 'walk' && !state.inside,
    handle: (a, dt) => state.walk.pad(a, dt),
  });
  state.input.mode('orbit', { active: () => true, handle: orbitPad });

  // Who are we here, and is there a machine under us at all? Those used to be one
  // question, because the island served the page and losing it meant the page was dead.
  // They are two now:
  //
  //   state.hasIslander  whether the machine with the files on it is answering. A page
  //                      on a phone or a second screen has no islander and never will,
  //                      and that is a mode rather than a failure: it can see the world
  //                      and walk in it, and it cannot touch anybody's disk.
  //   state.guest        who we are on an island that *is* answering.
  //
  // The page only uses either to decide what to offer; the server refuses the rest
  // whatever the page believes.
  state.hasIslander = true;
  try {
    const hello = await mine('/api/hello').then((r) => r.json());
    // Where the world is. An island always has a sea now - single player is a sea of one,
    // started in the islander's own process - but an island that says nothing still works:
    // useSea(null) leaves every world call pointed at this same server.
    useSea(hello.sea);
    state.islandId = hello.islandId || null;
    state.islandToken = hello.token || null;
    await learnTheWorld();
    state.guest = hello.role !== 'islander';
    state.signs = hello.signs !== false;
    state.signMode = hello.display ? hello.display.nameplates : null;
    state.ui.setKeeper(!state.guest);
    state.ui.setSigns(state.signMode);
    setVisiting(state.guest);
    if (state.guest) {
      state.ui.toast(`You are visiting <b>${escapeHtml(hello.islandName || 'this island')}</b>. Walk where you like — the tickets, the chat and the git belong to whoever lives here.`);
    }
  } catch (e) {
    if (e && e.name === 'IslanderUnreachable') {
      // Nobody home. Not ours, not a guest's - there is simply no machine here, so
      // everything that would write to one is off the table and the keeper's tools must
      // not be offered. Treating this as "our own island", which is what this did before
      // there was anywhere else to run, is what would put a Build button on a phone.
      state.hasIslander = false;
      state.guest = true;
      state.signs = true;
      state.ui.setKeeper(false);
      setVisiting(true);
      state.ui.toast('No island server on this machine. You can look around and walk about — the garden, the post and the tickets live on the keeper’s own screen.');
    } else {
      // An island that answers but will not say is treated as our own - including about
      // the signs. They start down so that a page which may not read them never builds
      // them, and silence must not be what leaves the keeper's own island bare.
      state.signs = true;
      state.ui.setKeeper(true);
    }
  }
  // And if it goes away later - the keeper restarting their own server, which happens
  // every time a file is saved - say so once rather than letting forty call sites each
  // fail quietly in their own way.
  onIslanderChange((ok) => {
    state.hasIslander = ok;
    if (!ok) state.ui.toast('The island server stopped answering. The world keeps going; anything that writes to this machine will wait.');
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
  state.walk = createWalkMode({
    scene, camera, terrain: state.terrain, ground: state.sea,
    material: buildingMat, dom: renderer.domElement,
  });
  handOutDecks();                    // buildScene ran before there was a walk mode to tell
  // The island is built, so there is ground for everyone else to stand on.
  state.peers = createPeers({
    scene, material: buildingMat, terrain: state.terrain, ground: state.sea,
    // Somebody else's hand on a board. It rides in with their pose, so it arrives here
    // rather than as a message of its own - see web/js/net.js.
    onCursor: (who, at) => { if (state.panels) state.panels.peerCursor(who, at); },
  });
  // Told how big we are, so the ring is exact rather than the default 64 it falls back to.
  // On a 64-grid our half is 32, so the default was putting every neighbour thirty-two
  // units further out than the gap it was computing asked for.
  state.horizon = createHorizon({ scene, pickables: state.pickables, half: state.terrain.half });
  if (!state.guest) refreshNeighbours();
  syncFleet();        // whatever was already in the water when this page opened
  // Talking to the people here rather than to the settlers - see web/js/islandchat.js
  // for which conversation is which. Made before the line is opened, so a first line
  // cannot arrive with nowhere to land.
  state.islandchat = createIslandChat(document.body, {
    say: (text) => !!(state.net && state.net.say(text)),
    // A board or the stall has the screen and the letters; T is not ours then.
    blocked: () => !!openPanel(),
  });
  state.net = createNet({
    onBoat: onBoatFromServer,
    peers: state.peers,
    walk: state.walk,
    url: seaSocket(),
    // Which world, and whose coast this body belongs over. A page with no islander of its
    // own sends no island and is a wanderer: it gets the world and a body, and nothing it
    // does can reach anybody's disk.
    join: { v: 1, as: 'client', island: state.islandId || null },
    onWorld: onFleetNews,
    onCrowd: onCrowdMessage,
    onRefused: (m) => state.ui.toast(`The sea would not have us: ${escapeHtml(String(m.why || 'no reason given'))}.`),
    name: playerName(),
    onStatus: () => {},
    onPanels: (m) => applyPanelMessage(m),
    onSaid: (m) => state.islandchat.said(m),
  });
  state.props = createProps({ scene, terrain: state.terrain, material: buildingMat });
  // What a shape looks like before anybody has agreed to it. Built after the world and
  // the props, because it aims at the ground mesh and measures against what is standing.
  state.ghost = createGhost({
    scene, camera, terrain: state.terrain, dom: renderer.domElement,
    groundMesh: state.world.ground,
    propsGroup: state.props.group,
    player: () => (state.mode === 'walk' && !state.inside ? state.walk.state.pos : null),
    blockers: () => walkableBlockers(),
    hud: (info) => state.ui.setBuildHud(info),
    toast: (html) => state.ui.toast(escapeHtml(html)),
  });
  // What a panel is allowed to know about the island: a handful of getters, so a face
  // can say something live without reaching into the scene.
  state.panels = createPanels({
    camera,
    terrain: state.terrain,
    element: document.getElementById('panels'),
    island: {
      name: () => (state.village && state.village.island ? state.village.island.name : 'Promptholm'),
      hour: () => currentHour(),
      season: () => (state.world ? state.world.season() : seasonOf(new Date(timeNow()).getMonth())),
      building: () => (state.village
        ? state.village.buildings.filter((b) => b.active && b.kind !== 'civic').map((b) => b.name)
        : []),
    },
    // Nothing a board says is decided here. A press asks the island, the island answers
    // every copy at once, and applyPanelMessage below is where the answer lands.
    onAction: (id, action, value) => { if (state.net) state.net.setPanelField(id, action, value); },
    onTake: (id) => { if (state.net) state.net.takePanel(id); },
    onDrop: (id) => { if (state.net) state.net.dropPanel(id); },
    onCursor: (at) => { if (state.net) state.net.setPanelCursor(at); },
    self: () => (state.net ? state.net.id() : null),
  });
  refreshProps({ animate: false });
  state.crops = createCrops({ scene, terrain: state.terrain, material: buildingMat });
  refreshGarden({ animate: false });
  applyVillage(village, { animate: false });
  setLiveMode();
  // Arriving from a neighbour replaces the usual opening sweep with a landing.
  startIntro();
  state.ui.boot(true);
  requestAnimationFrame(tick);
  connect();
  registerWorker();
}

function connect() {
  let es;
  const open = () => {
    es = new EventSource(mineUrl('/events'));
    // An island arriving in the harbour, or sailing home. Not localOnly: everybody standing
    // on this island should see it happen, which is the whole point of putting it there.
    // The berth event is the islander's old way of announcing a visiting island, and the
    // sea has taken that job over: the fleet arrives on the socket now. Kept as a nudge
    // rather than removed, so an islander still running the old route is not silently
    // ignored.
    es.addEventListener('guests', () => { syncFleet(); });
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
    // The keeper changed what the island shows - from this window or from another one.
    // A visitor is sent this too, and it is the only say they get in it.
    es.addEventListener('display', (e) => {
      try {
        const m = JSON.parse(e.data);
        state.signs = m.signs !== false;
        state.signMode = m.display ? m.display.nameplates : null;
        state.ui.setSigns(state.signMode);
        applySigns();
      } catch { /* malformed, ignore */ }
    });
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
// Everything on one building that moves. Split out of the tick so that our island and a
// guest island are animated by one piece of code rather than two that drift apart.
function animateExtras(rec, dt, hour, nightAmt, nowMs) {
  if (!rec.group.visible) return;
  if (rec.blades) rec.blades.rotation.z += dt * 0.55;
  if (rec.clock) updateClock(rec.clock, hour);
  if (rec.fountain) updateFountain(rec.fountain, dt);
  if (rec.mailFlag) updateMailFlag(rec.mailFlag, dt);
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
  const civicFire = rec.spec.civicType === 'tavern' || rec.spec.civicType === 'townhall';
  if (rec.smokeAnchor && (rec.spec.active || civicFire)
    && rec.group.position.distanceToSquared(camera.position) < 120 * 120) {
    rec.smokeT += dt;
    if (rec.smokeT > (rec.spec.active ? 0.34 : nightAmt > 0.5 ? 0.7 : 1.1)) {
      rec.smokeT = 0;
      const v = new THREE.Vector3(...rec.smokeAnchor).applyMatrix4(rec.group.matrixWorld);
      state.particles.smoke([v.x, v.y, v.z]);
    }
  }
  if (rec.flagIdx >= 0) updateFlagInstance(rec, true);
}

// The console's way in. `joinIsland` and `raiseGuestIslands` are here because an island
// arriving is the one thing in this page that is hard to get at from the outside and easy
// to want to try: ?join= only fires at boot, and a bundle needs a second machine.
window.settlers = {
  state, scene, camera, controls, renderer, THREE, frameIsland, focusOn,
  joinIsland, raiseGuestIslands, syncFleet, applyFogRange, applyCameraRange,
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  if (state.panels) state.panels.resize();
  if (state.particles) state.particles.mat.uniforms.uScale.value = innerHeight * 0.5;
});

boot();


