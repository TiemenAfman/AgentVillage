// Boot, camera, the live feed and the animation queue that turns a data diff into
// something you can watch happen.
import * as THREE from 'three';
import { createRecovery } from './graphics-health.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTerrain } from 'shared/terrain.mjs';
import { quayDeckHeights } from 'shared/quay-basin.mjs';
import { createStandHeight } from 'shared/settlerwalk.mjs';
import { createArchipelago, placeIsland, berthOf, MAX_BERTHS, worldToScene, nextOrigin } from 'shared/regions.mjs';
import { createCrowdView } from './crowd-view.js';
import { nearestOnRay, guestLabel } from './guest-pick.js';
import { allowImp, setImpNight } from './imp.js';
import { createAgentBars } from './agent-bars.js';
import { createMainMenu } from './mainmenu.js';
import { decodeCrowd, decodeRides } from 'shared/settlerwire.mjs';
import { drawnSignature } from './islandsig.js';
import { quaysOf, mooringsFor, BOATS_PER_HARBOUR } from 'shared/quay.mjs';
import { clamp } from 'shared/rng.mjs';
import { createWorld } from './world.js';
import { worldTime, localZone } from 'shared/worldclock.mjs';
import { createRoadDebug } from './road-debug.js';  
import { createGuestIsland } from './guest-island.js';
import { createBoat, DECK_Y, BOW } from './boat.js';
import { housePlacement } from './house-placement.js';
import { projectVillage } from './history.js';
import {
  createBuildingMaterial, buildBuilding, buildScaffoldGeometry, buildBoatGeometry,
  buildCampfireGeometry, buildFlameGeometry, buildBladesGeometry, buildPierGeometry,
  buildBridgeGeometry, bridgeDeckHeights, createFlagMesh, buildDeckGeometry,
  QUAY_DECK, HARBOUR_DECK, PALETTE, TIER_INDEX,
} from './buildings.js';
import { createNameplate } from './nameplate.js';
import { createUI } from './ui.js';
import { createSound } from './sound.js';
import { createWalkMode } from './walk.js';
import { createInterior, INDOOR_GLOW } from './interior.js';
import { createPeers } from './peers.js';
import { createNet } from './net.js';
import { createHorizon, RING } from './horizon.js';
import { createMinimap, createWorldMap } from './minimap.js';
import { decodeOwnership } from './hamlets.js';
import { createBoard } from './board.js';
import { createChat } from './chat.js';
import { createFaceToFace } from './facetoface.js';
import { createIslandChat } from './islandchat.js';
import { createOffice } from './office.js';
import { createNewSettler } from './newsettler.js';
import { createTownHall } from './townhall.js';
import { createProps } from './props.js';
import { createPanels } from './panels.js';
import { scopePanel as scopeBoard, ourPanel as ourBoard } from 'shared/panels.mjs';
import { createCrops } from './crops.js';
import { attachClock, updateClock } from './clock.js';
import { attachFountain, updateFountain } from './fountain.js';
import { attachBeacon, updateBeacon } from './beacon.js';
import { createMarket, answerOf } from './market.js';
import { createMailbox } from './mail.js';
import { attachMailFlag, setMailFlag, updateMailFlag } from './mailflag.js';
import { createBorrelTables, tableSetsFor } from './borrel.js';
import { createBuildMenu } from './buildmenu.js';
import { createGhost } from './ghost.js';
import { createPlanMode } from './plan-mode.js';
import { createPlanOverlay } from './plan-overlay.js';
import { createPlanPanel } from './plan-panel.js';
import { createAvatarStudio } from './studio.js';
import { loadAvatar } from './avatar.js';
import { createWaitingFlags } from './waiting.js';
import { createGamepad } from './gamepad.js';
import { createInput } from './input.js';
import { createWeather, setSky, forceSky, haze, hazeRange } from './weather.js';
import { CROPS, CROP_KINDS, BED_SIZE, ripeIn } from 'shared/crops.mjs';
import { mine, mineUrl, sea, seaSocket, useSea, islanderHere, onIslanderChange, STANDALONE } from './api.js';
import { createTouchPad, eitherPad } from './touchpad.js';
import { createVitals } from './vitals.js';
import { shownPool } from './stamina.js';
import { createTipsy, drinkIn, stepTipsy, hazePx, TIPSY } from './tipsy.js';
import { updateNotice, refusalNotice, updateGate, SEA_PROTOCOL } from './update.js';
import { installDesktopGuards } from './desktop.js';
import { captionCell } from './captions.js';

// In promptholm.exe, F5 and Alt+F4 ask first (web/js/desktop.js); a browser tab is untouched.
installDesktopGuards();

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
// ?sky=rain - hold this island in one sky whatever the sea says afterwards. The weather is
// a shared thing kept by the sea and turning over a quarter of an hour at a time, so
// without this the only way to look at three of the four is to sit and wait for them.
if (params.has('sky')) forceSky(params.get('sky'));
const statsReadout = params.has('stats') ? document.createElement('output') : null;
if (statsReadout) {
  statsReadout.style.cssText = 'position:fixed;left:12px;bottom:8px;z-index:10000;padding:5px 9px;background:#14221ee8;color:#f4e8cd;font:12px monospace;pointer-events:none';
  document.body.appendChild(statsReadout);
}

// The boot watchdog in index.html waits on this: it is the one thing that tells it the
// module graph came up at all. Set before anything below can throw, so that a later crash
// stays main.js's own to report rather than something the watchdog has to guess at.
window.__islandRunning = true;
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
      // alpha: the boards' layer lies under the canvas and shows through where a board's
      // hole wrote alpha 0 (web/js/panels.js). Everything else is cleared opaque.
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, ...opts });
      r.setClearAlpha(1);
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
// No browser menu over the island, in any mode.
//
// OrbitControls suppresses it for itself, because it uses the right button to pan - so from
// the sky the island has never had one, and in walk mode it did: right-click turned into a
// page menu over the view you were steering. Right-click is the island's own button now
// (ghost.js already takes it for cancelling a placement), and a menu is never the answer
// on the canvas. Only on the canvas: a menu on a text field or a board is somebody's own
// copy-and-paste and none of our business.
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

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
  // The weather over the whole world, as this island draws it. The sea keeps the word; see
  // web/js/weather.js for what the four of them look like.
  sky: null,
  walk: null, board: null, chat: null, pad: null, input: null, padSeen: false, mode: 'orbit',
  // The room you are standing in, if any. Walking and being indoors are not two modes:
  // you are still on foot, the room simply owns the camera and the keyboard while you
  // are in it.
  inside: null,
  // The health and stamina bars over the walking strip. Made with the state rather than at
  // boot, because the markup is already in the page and nothing about it waits on the sea.
  // Health stays full - and so out of sight - until the sea has a number for it to show.
  // The beer's blur goes on the canvas and the panels layer under it together.
  vitals: createVitals(document.getElementById('vitals'),
    { haze: [document.getElementById('stage'), document.getElementById('panels')] }),
  // The beer in you (web/js/tipsy.js): one pool for the page, handed to the island's walk and
  // every room's, and stepped once a frame in frame() - so it outlasts the tavern door and
  // wears off from the sky as well. `?tipsy=0.8` starts the page that drunk, for looking at
  // the blur and the stagger without seven trips to the bar.
  tipsy: drinkIn(createTipsy(), Number(params.get('tipsy')) / TIPSY.dose),
  peers: null, net: null, guest: false, horizon: null, sailing: null,
  // Whether the yard signs are standing. The island answers this at /api/hello before
  // anything is built, so a page that may not read them never makes them in the first
  // place; false until it does, because that is the answer that gives nothing away.
  signs: false, signMode: null,
  props: null, panels: null, buildMenu: null, ghost: null, islandchat: null,
  // The planner (web/js/plan-mode.js): the island from above, with a hand on the hamlets.
  // `mode` is 'plan' while it has the camera.
  plan: null,
  crops: null, market: null, garden: null,
  // What the postbox on the town hall pavement knows: one unread count per account, as the
  // last poll left it. Nothing else about anybody's mail is ever held on this side.
  mailbox: null, mailCounts: [], mailAt: 0, borrel: null, sound: null,
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
  if (state.net) state.net.attend(id, w.pos.x, w.pos.z);
  faceToFace.begin({
    subject: fig,
    viewer: { x: w.pos.x, z: w.pos.z, feetY: w.pos.y },
    onLetGo: () => { if (state.net) state.net.unattend(id); },
  });
}

// Addressing a settler opens their session and lets you carry it on.
function talkTo(id) {
  if (keeperOnly('carry on a settler’s session')) return;
  const rec = state.byId.get(id);
  if (!rec || rec.spec.kind === 'civic' || !rec.spec.sessionId) return;
  // Who you are actually addressing: the figure scurrying about that doorstep, not the
  // doorstep. Only settlers.js knows where they got to, and it is keyed by building id.
  const fig = state.settlers ? state.settlers.figure(id) : null;
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
    ...(r.r ? { r: r.r } : {}),       // a circle needs no turning
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
    // Within reach of the head, which is where all three of a harbour's berths are (see
    // berthOf in shared/quay.mjs) - the same test takeBoatAt makes.
    const moored = state.boats.find((b) => Math.hypot(b.x - d.head[0], b.z - d.head[1]) <= 4.5);
    out.push({
      id: d.id, kind: 'dock', x: d.head[0], z: d.head[1], r: 3.2,
      label: d.side ? `the ${SIDE_WORD[d.side]} harbour` : 'the quay',
      prompt: dockPrompt(d, moored),
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
    // panels.js hangs the page in front of it. Kept, because the boards on the neighbours'
    // islands go in the same list and arrive at a different moment.
    state.ownProps = body.props || [];
    syncBoards();
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
  // Off unless switched on under Settings -> Debug: the planner keeps the town now.
  if (!state.ui.buildEnabled()) {
    state.ui.toast('Building by hand is switched off. The town is kept from the planner (<b>Plan</b>); Settings → Debug brings Build back.');
    return;
  }
  if (state.mode === 'plan') exitPlan();
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
// being on foot changes, which is why `blocked` knows nothing about vehicles.
// The quay's own key. This island has one boat and it is at its mooring, or it is wherever
// somebody left it - and if that is the far shore, then that is where it is. Nothing is
// summoned to reach you and you are not carried to it, which is the whole of what a boat
// belonging to nobody means.
function takeBoatAt(dockId) {
  const d = dockAt(dockId);
  if (!d) return;
  // The boat lying at this dock, if one does, and the nearest free one if several do. With
  // four harbours "the island's boat is out on the water" was wrong three times out of
  // four: it was lying at another harbour, and this one never had one.
  boatsFor(d.region);
  const near = state.boats
    .map((x) => ({ x, d: Math.hypot(x.x - d.head[0], x.z - d.head[1]) }))
    .filter((e) => e.d <= 4.5)
    .sort((a, b) => (!!a.x.pilot - !!b.x.pilot) || a.d - b.d);
  const b = near.length ? near[0].x : null;
  if (!b) {
    state.ui.toast('No boat lies at this harbour.');
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
  state.ui.toast(STANDALONE
    ? 'You cast off. The stick on the left rows and steers.'
    : 'You cast off. <b>W</b> and <b>S</b> for the oars, <b>A</b> and <b>D</b> for the tiller.');
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
    // At a harbour B builds a boat; anywhere else it is the build menu it always was.
    onBuild: () => {
      const near = state.walk && state.walk.state.near;
      const d = near && near.kind === 'dock' ? dockAt(near.id) : null;
      if (d) buildBoatAt(d); else openBuild();
    },
    onAvatar: () => openStudio(),
    onRelease: () => releasePanel(),
    // Escape on the chart goes back to the radar rather than all the way up to the sky.
    onExit: () => { if (minimapMode === 'map') setMinimapMode('radar'); else exitWalk(); },
    onToggleMinimap: () => setMinimapMode(MINIMAP_NEXT[minimapMode]),
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
// A board's name on the wire, and the same board's name here. Both halves live in
// shared/panels.mjs, with the reasoning and the server's half of the contract.
const scopePanel = (id) => scopeBoard(state.islandId, id);
const ourPanel = (id) => ourBoard(state.islandId, id);

// Turned away at the sea's door.
//
// Once per reason, and not once per attempt. net.js keeps retrying - which is right, a
// refusal can stop being true the moment somebody fixes a config - but none of these
// reasons fix *themselves*, so the retry loop turned one problem into a toast every few
// seconds. What made it unreadable is that the message was also the bare word the wire
// uses: three lines of "The sea would not have us: key." says what is wrong to whoever
// wrote the protocol and nothing at all to whoever has to fix it.
const REFUSALS = {
  key: 'This sea wants a key. Put it in <b>multiplayer.sea.key</b> in config.json, or type it in the world picker.',
  version: 'This sea speaks a different version of the protocol. One of the two machines needs its code updating.',
  claimed: 'Another islander is already moored here under this island’s name.',
  full: 'This sea is full.',
};
let lastRefusal = null;
function onRefusedBySea(m) {
  const why = String((m && m.why) || 'no reason given');
  if (why === lastRefusal) return;
  lastRefusal = why;
  // Over the protocol it is worth saying which side has to move, and where the new
  // version is if it is us - and it goes in the banner, since nothing works until it is.
  // In the app it is the whole-screen gate with a download button instead: a refused app
  // has no island to fall back on, so nothing else on the screen is worth reaching.
  if (why === 'version') {
    const gate = STANDALONE ? updateGate({ speaks: m.speaks }) : null;
    if (gate) state.ui.setGate(gate);
    else state.ui.setUpdate(refusalNotice(m.speaks, { phone: !!STANDALONE }));
    return;
  }
  state.ui.toast(REFUSALS[why] || `The sea would not have us: ${escapeHtml(why)}.`);
}

function applyPanelMessage(m) {
  if (!state.panels) return;
  if (m.kind === 'all') {
    state.panels.all((m.boards || [])
      .map((b) => ({ ...b, id: ourPanel(b.id) }))
      .filter((b) => b.id));
    return;
  }
  if (m.kind === 'ui') {
    const id = ourPanel(m.id);
    if (id) state.panels.field(id, m.action, m.value);
    return;
  }
  if (m.kind === 'drove') {
    // The roster is where an id becomes a name, so the name is put on here rather than
    // in the panel layer, which has never heard of players.
    const id = ourPanel(m.id);
    if (!id) return;
    if (m.driver) state.panels.drivenBy(id, peerName(m.driver));
    const taken = state.panels.driven(id, m.driver);
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
        room, camera, material: buildingMat, dom: renderer.domElement, tipsy: state.tipsy,
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
// Where the minimap's town-centre marker belongs: the same fallback chain enterWalk uses to
// pick a starting spot (the board, then the town hall once one exists, then the bare square),
// just returning a position instead of somewhere to stand.
function townCentreScenePos() {
  const board = state.byId.get('civic:board');
  if (board) return [board.group.position.x, board.group.position.z];
  const hall = state.byId.get('civic:townhall');
  if (hall) return [hall.group.position.x, hall.group.position.z];
  const town = state.village.island.town;
  if (town && town.centre && state.terrain) return state.terrain.cellWorld(town.centre[0], town.centre[1]);
  return null;
}

// Which hamlet owns which ground cell, for the radar's district wash (minimap.js's
// districtColor - the same picture the planner paints, see Plans). decodeOwnership walks
// every cell of the grid, so it is built once per village rather than per frame; `state.
// terrain` rather than the region facade because the owner array is indexed in raw local
// grid coordinates, same as `own.owner` in world.js's own createLandscape.
let minimapOwnFor = null, minimapOwn = null;
function minimapDistrict() {
  if (!state.terrain || !state.village || !state.village.island) return null;
  if (state.village !== minimapOwnFor) {
    minimapOwn = decodeOwnership(state.village, state.terrain.size);
    minimapOwnFor = state.village;
  }
  return { owner: minimapOwn.owner, size: state.terrain.size, hues: state.village.districts.map((d) => d.hue || 0) };
}

// Everything the radar draws, read straight off state that is already kept live for other
// reasons - see the minimap section of the Promptholm plan for why none of this needs new
// plumbing. `state.walk.state` rather than `state.walk.update(dt)`'s return value: that
// return is only `{ near, pos, distance }`, no yaw.
// Where every island's harbour is, in world coordinates: the head of each dock's planks,
// where a boat is moored and the prompt to take it out appears.
function mapDocks() {
  return state.docks.map((d) => ({ x: d.head[0], z: d.head[1], region: d.region.id, side: d.side || null }));
}

function minimapData() {
  const w = state.walk.state;
  return {
    pos: w.pos, yaw: w.yaw,
    // The facade, not the raw terrain: it already turns "outside the grid" into open sea
    // and blends the last few cells into it (shared/regions.mjs), which is exactly what a
    // radar sampling well past the coast wants and the raw heightfield does not do.
    home: state.region,
    // The whole archipelago as well, so the radar has ground under it on every island and
    // not only on home - see drawTerrain in minimap.js.
    sea: state.sea,
    docks: mapDocks(),
    boats: state.boats,
    near: state.sea.regions().filter((r) => r !== state.region).map((r) => ({ x: r.origin[0], z: r.origin[1] })),
    far: state.horizon ? state.horizon.marks() : [],
    town: townCentreScenePos(),
    district: minimapDistrict(),
  };
}

// The chart's picture of the sea: every region with ground under it, named off the fleet
// (home off its own village), plus the horizon's marks for everything further out.
function worldMapData() {
  const w = state.walk.state;
  const names = new Map((state.fleet || []).map((r) => [r.id, r.name]));
  const homeName = state.village && state.village.island ? state.village.island.name : null;
  return {
    pos: w.pos, yaw: w.yaw,
    sea: state.sea,
    regions: state.sea.regions().filter((r) => !r.id.startsWith('debug-')).map((r) => ({
      id: r.id, origin: r.origin, half: r.half, region: r, home: r === state.region,
      name: r === state.region ? homeName : names.get(r.id) || null,
      // What stands on it - hamlets, landmarks, roads - for islandFeatures in minimap.js.
      // Home's village is state.village; a guest's rode in with its bundle.
      village: r === state.region ? state.village : r.village || null,
    })),
    docks: mapDocks(),
    far: state.horizon ? state.horizon.marks() : [],
    boats: state.boats,
    town: townCentreScenePos(),
    district: minimapDistrict(),
  };
}

function enterWalk(spot = null) {
  if (state.mode === 'walk') return;
  if (state.mode === 'plan') exitPlan();
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
  // The peers before the spot is chosen, not after. Out of walk mode the frame loop keeps
  // this list empty, so enter() found the spot in front of the board "free" with somebody
  // already standing on it, and the next frame put you inside them.
  if (state.peers) state.walk.setPeerBlockers(state.peers.blockers());
  state.walk.enter({
    at,
    facing,
    pitch: spot && spot.pitch,
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
// The planner: the third mode. Everything that is switched off here is switched back on
// in leftPlan, and the orbit camera and its controls are not among it - they are simply
// not updated while the plan camera has the scene, so the sky is exactly where you left
// it. What goes: the CSS3D boards (built for the perspective camera and drawn on their
// own layer, so they would float over the map at the wrong place), the clouds (whose
// shadows lie across the map), the hamlet arches (a bar across the road from above), the
// nameplates (41 of them are 123 draw calls the map does not need), and the haze - the
// plan camera is 300 up, which is deep in a fog whose far end is 3.4 half-widths.
let planFog = null;
function enterPlan() {
  if (STANDALONE) return;
  if (state.mode === 'plan' || !state.plan) return;
  if (keeperOnly('plan the island')) return;
  if (state.mode === 'walk') exitWalk();
  if (state.chronicle.t != null) setLiveMode();
  state.intro = null;
  state.tween = null;
  faceToFace.cancel();
  if (state.ghost) state.ghost.drop();
  state.ui.closeOverlays();
  controls.enabled = false;
  state.mode = 'plan';
  state.ui.setPlanning(true);
  if (state.panels && state.panels.setVisible) state.panels.setVisible(false);
  if (state.world && state.world.clouds) state.world.clouds.visible = false;
  hamletGroup.visible = false;
  for (const rec of state.byId.values()) if (rec.nameplate) rec.nameplate.group.visible = false;
  if (scene.fog) { planFog = [scene.fog.near, scene.fog.far]; scene.fog.near = 2000; scene.fog.far = 4000; }
  state.plan.enter();
  if (!state.plan.active()) leftPlan();     // it refused: an island with no lattice yet
}
function exitPlan() { if (state.mode === 'plan' && state.plan) state.plan.exit(); }
function leftPlan() {
  if (state.mode !== 'plan') return;
  state.mode = 'orbit';
  state.ui.setPlanning(false);
  if (state.panels && state.panels.setVisible) state.panels.setVisible(true);
  if (state.world && state.world.clouds) state.world.clouds.visible = true;
  hamletGroup.visible = true;
  for (const rec of state.byId.values()) if (rec.nameplate) rec.nameplate.group.visible = true;
  if (scene.fog && planFog) { scene.fog.near = planFog[0]; scene.fog.far = planFog[1]; planFog = null; }
  controls.enabled = true;
  controls.update();
  applyFogRange();
}

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

function exitWalk({ force = false } = {}) {
  if (state.mode !== 'walk') return;
  // The phone has no sky to go up to: walk mode is all there is. `force` is for the one
  // caller that goes straight back down again - being sent home - which without it found
  // walk mode still on, so enterWalk returned at once and you stayed where you were caught.
  if (STANDALONE && !force) return;
  showMinimap(false);   // M's own state (minimapMode) survives; only the sky hides it
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
  if (state.mode === 'plan') return;      // the planner holds the haze off; leftPlan puts it back
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
  if (out <= 0) { setFogRange(half, 0, half * 3.4); return; }

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
  setFogRange(half, out, Math.max(half * 3.4, out + 110, reach + 40));
}

// And the last word on it, which is the weather's. The sky the sea is keeping closes the
// haze in - a downpour is a smaller world than a clear afternoon - but it only ever
// multiplies what the paragraphs above decided, and hazeRange (web/js/weather.js) holds the
// floor that keeps the neighbours on this side of it. Clear weather is a multiplier of one
// and both floors are below what is passed in, so an island in the sunshine gets the two
// numbers it has always had, to the decimal.
function setFogRange(half, out, far) {
  const h = hazeRange({ near: half * 1.1, far, half, out, thick: haze() });
  scene.fog.near = h.near;
  scene.fog.far = h.far;
}

// Islands that are in no sea: an island conjured by `?join=` so that the whole coordinate
// path - berth, region, haze, camera leash, picking - can be exercised with one server and
// no second machine. They ride along with every horizon sync, because `apply` takes the
// whole list and whoever is not in it has gone home.
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
// them out would put their coast in the wrong place and their houses in the water. The
// dredged `fairway` is the same thing pointed the other way, and has to travel with them
// for the same reason: leave it out and a neighbour's river mouth silts back up on our
// screen, which the terrain hash on the next line reports as two machines running
// different code. `volcano` is the third of those and the bluntest: the sea's own island
// (shared/volcano.mjs) is a different heightfield from the same seed, and without the flag
// it would be drawn as an ordinary island and flagged as skew.
function joinIsland({ id, rev = 0, seed, gridSize, polders = [], fairway = null, grow = null, volcano = false, terrainHash = null, name = null, village = null, origin = null }) {
  if (state.sea.get(id)) return state.sea.get(id);
  const terrain = makeTerrain(seed, { size: gridSize, polders, fairway, grow, volcano });
  if (terrainHash && terrain.hash !== terrainHash) {
    // A warning here and not a refusal, the same as buildScene does for our own island
    // (main.js:1560): the two sides disagree about shared/terrain.mjs, which means one of
    // them is running older code. The server refuses the upload outright for the same
    // reason; by the time it reaches the page it is worth drawing and worth saying.
    console.warn(`island: ${id} hashes ${terrain.hash} here and ${terrainHash} there`);
    // And where somebody will see it. A console warning is where this used to stop, which
    // meant a neighbour drawn in the wrong shape was found by somebody sailing into it.
    if (state.ui) state.ui.setSkew(id, name || id);
  }
  // The sea decides where an island lies, and every client is told the same answer - that
  // is what makes two people looking at the same water see the same thing. What it says
  // is in the sea's frame, and this page draws in its own: home at the scene origin and
  // everything else moved by our berth - see `rehome`. freeBerth is the fallback for the
  // one case with no sea in it: the ?join= debug parameter, which conjures an island out
  // of a seed with nobody to ask, and answers in the scene's frame already.
  const at = Array.isArray(origin) ? worldToScene(origin, state.homeOrigin || [0, 0]) : freeBerth(terrain.half);
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
  region.drawn = drawnSignature(village);
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
// on the horizon: see syncHorizon for why an island cannot be in both places at once.
// ---- the quay -------------------------------------------------------------------
// The derivation moved to shared/quay.mjs the moment there was a third caller: this file
// draws the planks and puts the hull in the water, serve.mjs hands lib/boats.mjs the
// moorings, and the browser across the channel has to find an untouched boat in the same
// place. Three sides agreeing without a message between them is only possible if all three
// do the same arithmetic, which is what shared/ is for.
// Every dock an island has: its harbours, one per side of the coast (lib/layout.mjs
// planHarbours, carried as village.island.harbours), or the one quay of an island that has
// none on record - a guest whose bundle predates them, or whose islander is older than
// this page. shared/quay.mjs's quaysOf decides which, so this page and every other agree.
function docksFor(region, village) {
  const v = village || region.village;
  const landing = v && v.island && v.island.landing;
  if (!landing) return [];
  // Local coordinates, because the mesh goes inside the island's own group - and world
  // coordinates for `head` and `berth`, because walk mode and the boat speak nothing else.
  // shared/quay.mjs names them apart for exactly this reason.
  // The kade this village built, where it built one: the quay district's own planks are one
  // of the island's harbours, and the derivation off the landing is the fallback for an
  // island whose districts we do not have. Without this the island grew a second pier
  // somewhere else on its coast, and that one - not the kade - got the deck, the boat and
  // the prompt.
  const [ox, oz] = region.origin;
  return quaysOf(region.terrain, v, landing).map((quay) => ({
    // The side in the id, so a dock keeps its name when the list around it changes.
    id: quay.side ? `dock:${region.id}:${quay.side}` : `dock:${region.id}`,
    side: quay.side,
    region, cells: quay.cells, dir: quay.dir,
    from: quay.from,
    yaw: quay.yaw,
    head: [quay.head[0] + ox, quay.head[1] + oz],
    berth: [quay.berth[0] + ox, quay.berth[1] + oz],
    // The land cell the planks start from, in the island's OWN grid - which is what a
    // settler walking down to the water has to be routed to, because the roads stop on land
    // and the planks begin here. quaySite picks it, and it is not always the landing.
    shore: quay.shore,
  }));
}

// The village the home dock was last built from.
//
// Our own dock needs our own districts, because the kade is one of them - and the two
// callers that rebuild the docks for a reason of their own do not have a village to hand.
// syncFleet's rebuild is about who else is in the water, and at boot it runs *before*
// applyVillage has set state.village: so `homeVillage || state.village` was undefined,
// docksFor answered nothing, and the dock buildScene had just built correctly was torn down
// and not put back until the next publish. Remembering it is what makes a rebuild for
// somebody else's island harmless to ours.
let dockVillage = null;

// The docks, built with the world so they are there to look at from the orbit camera too -
// a dock is scenery as much as it is a way off the island.
function buildDocks(homeVillage) {
  dockVillage = homeVillage || state.village || dockVillage;
  for (const d of state.docks) d.dispose();
  state.docks = [];
  for (const region of state.sea.regions()) {
    for (const spec of docksFor(region, region === state.region ? dockVillage : null)) {
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
      // Out of the raycast as well as out of the scene. It used to only leave the group, and
      // the raycast's own `m.parent` filter covered for that - which was true and quiet right
      // up until buildDocks started running on every change of district instead of once.
      state.docks.push({
        ...spec,
        mesh,
        dispose: () => {
          parent.remove(mesh);
          const k = state.pickables.indexOf(mesh);
          if (k >= 0) state.pickables.splice(k, 1);
          geo.dispose();
        },
      });
      state.pickables.push(mesh);
    }
  }
  // The planks are a floor, and the floor is worked out from these docks - so whoever
  // rebuilds them has rebuilt the floor too, whether or not they were thinking about it.
  // Paired here rather than left to each caller, because the one caller that forgot
  // (syncFleet, which only re-handed them when a *guest* arrived) left the kade drawn and
  // unwalkable: planks in the picture, open water underfoot. A no-op before walk mode
  // exists, which is the order buildScene runs in.
  handOutDecks();
}

// What E and B do at a dock. B only at one of our own harbours, and only while it has room.
function dockPrompt(d, moored) {
  const take = moored ? 'take the boat' : 'no boat here';
  if (d.region !== state.region || !d.side || state.guest || !state.village) return take;
  const here = mooringsFor(d.region.id, d.region.terrain, state.village, d.region.origin).filter((m) => m.side === d.side).length;
  return here < BOATS_PER_HARBOUR ? `${take} · B build a boat (${here} of ${BOATS_PER_HARBOUR})` : take;
}

function dockAt(id) { return state.docks.find((d) => d.id === id) || null; }
const SIDE_WORD = { n: 'north', e: 'east', s: 'south', w: 'west' };
const harbourSig = (v) => JSON.stringify((v && v.island && v.island.harbours) || []);

// B at one of this island's own harbours: another boat, free, three a harbour
// (Plans/vier-havens.md). Counted here first so the answer is immediate, and again by the
// server (lib/boatyard.mjs), which is the one that is believed. The hull appears when the
// rescan that follows reaches this page as a new village - see harbourSig in applyVillage.
async function buildBoatAt(d) {
  if (d.region !== state.region || !d.side) { state.ui.toast("Only your own island's harbours are yours to build at."); return; }
  if (keeperOnly('build a boat')) return;
  const here = mooringsFor(d.region.id, d.region.terrain, state.village, d.region.origin).filter((m) => m.side === d.side).length;
  const word = SIDE_WORD[d.side];
  if (here >= BOATS_PER_HARBOUR) { state.ui.toast(`The ${word} harbour already moors ${BOATS_PER_HARBOUR} boats.`); return; }
  try {
    const r = await mine('/api/harbour/boat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side: d.side }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `the island said ${r.status}`);
    state.ui.toast(`A new boat is put in the water at the ${word} harbour.`);
  } catch (e) {
    state.ui.toast(`No boat built: ${e.message}`);
  }
}
function boatAt(id) { return state.boats.find((b) => b.id === id) || null; }

// Every island's boat, put in the water with the island. Not when walk mode starts: a boat
// somebody across the channel is sailing has to be drawn whether or not you are on foot.
function launchBoats() {
  const wanted = new Set();
  for (const region of state.sea.regions()) for (const b of boatsFor(region)) wanted.add(b.id);
  // Whatever no island moors any more - its island has gone, or a keeper's boat count fell -
  // is taken out of the water, unless somebody is sailing it: that one is theirs until they
  // step off, and the sea says `gone` for it when it is.
  for (let i = state.boats.length - 1; i >= 0; i--) {
    const b = state.boats[i];
    if (wanted.has(b.id) || (state.walk && state.walk.aboard() === b)) continue;
    if (isSkiff(b.id)) continue;   // nobody's island: only the sea's `gone` takes one away
    b.craft.dispose();
    state.boats.splice(i, 1);
  }
}

// Whether the last frame was spent afloat, so the frame you step off can notice.
let wasAboard = false;
// What M is showing, kept across a trip in and out of a building and up to the sky and
// back: the radar by default, then the chart of every island, then neither.
let minimapMode = 'radar';
const MINIMAP_NEXT = { radar: 'map', map: 'off', off: 'radar' };
function setMinimapMode(mode) {
  minimapMode = mode;
  showMinimap(state.mode === 'walk' && !state.inside);
}
function showMinimap(on) {
  state.minimap.setVisible(on && minimapMode === 'radar');
  state.worldMap.setVisible(on && minimapMode === 'map');
}

// Every boat an island puts in the water, at the moorings shared/quay.mjs derives - the
// same arithmetic the sea does for lib/boats.mjs and the same every other browser does, so
// an untouched boat is in the same water on every screen without a message being sent
// about it.
//
// The first is the island's own and the rest are what its keeper has built at its harbours
// (at most three a harbour, Plans/vier-havens.md). None of them is conjured: a boat that
// belongs to nobody cannot also be always to hand, so if somebody has left one on the far
// shore, that is where it is. The same reasoning lib/boats.mjs gives for putting them back
// at their moorings on a restart.
function boatsFor(region) {
  const v = region === state.region ? state.village : region.village;
  const out = [];
  for (const m of v ? mooringsFor(region.id, region.terrain, v, region.origin) : []) {
    let b = state.boats.find((x) => x.id === m.id);
    if (!b) {
      const craft = createBoat({ scene, material: buildingMat });
      craft.place(m.x, m.z, m.yaw);
      b = { id: m.id, x: m.x, z: m.z, yaw: m.yaw, v: 0, aground: false, craft, deckY: DECK_Y, pilot: null };
      state.boats.push(b);
    }
    out.push(b);
  }
  return out;
}

// The region a boat id belongs to: `boat:<region>` for an island's first, and
// `boat:<region>-<side><k>` for the ones built after it.
function regionOfBoat(id) {
  return state.sea.regions().find((r) => id === `boat:${r.id}` || id.startsWith(`boat:${r.id}-`)) || null;
}

// What the server says about a boat: taken, dropped, moved, or unmoored because its island
// has gone. A boat under somebody else's hand is theirs to place; ours is placed by us.
// A skiff - somebody's own boat, with no island behind it (lib/boats.mjs `skiffOf`) - has
// no mooring to be derived from, so the page first hears of it from the sea, and draws it
// then. Ours is already in the water by the time the sea echoes it.
const isSkiff = (id) => typeof id === 'string' && id.startsWith('boat:w-');
function skiffFor(m) {
  const craft = createBoat({ scene, material: buildingMat });
  craft.place(m.x, m.z, m.yaw);
  const b = { id: m.id, x: m.x, z: m.z, yaw: m.yaw, v: 0, aground: false, craft, deckY: DECK_Y, pilot: m.pilot || null };
  state.boats.push(b);
  return b;
}

function onBoatFromServer(m) {
  const b0 = state.boats.find((x) => x.id === m.id);
  const b = b0 || (isSkiff(m.id) && !m.gone && Number.isFinite(m.x) && Number.isFinite(m.z) ? skiffFor(m) : null);
  if (m.gone) {
    if (!b) return;
    b.craft.dispose();
    state.boats.splice(state.boats.indexOf(b), 1);
    if (state.walk && state.walk.aboard() === b) state.walk.unboard([b.x, b.z]);
    return;
  }
  const region = regionOfBoat(m.id);
  const craft = b || (region ? boatsFor(region).find((x) => x.id === m.id) || null : null);
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

// Where the sea says this island lies, before anything is drawn with it. Also the first
// look at the fleet, so a page that boots into a busy world raises every coast in one go
// rather than watching them pop in one socket message at a time.
async function learnTheWorld() {
  // Null until the sea has said where we are, and not [0, 0]. Everything that draws reads
  // `state.homeOrigin || [0, 0]` and is none the worse for it, but the pose beat reads this
  // raw (net.js `frame`) and sends nothing while it is null: [0, 0] in the sea's frame is
  // the middle of the volcano, and a walker reported there before its page knew its berth
  // was caught by the volcano's guards while standing on its own island.
  state.homeOrigin = null;
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

// Near to *whom*. It used to be near to our own berth, which never moves - so a silhouette
// stayed a silhouette however close you sailed, with no houses, no people and no ground to
// stand on: the hundredth island in a sea was a place you could see and never reach. So
// the ranking is taken from where the viewer is: the walker (or the boat under them) on
// foot, the orbit target otherwise. In the planner the last answer stands - it looks at
// home, and a reshuffle there would only cost a rebuild nobody is looking at.
//
// Scene coordinates, the frame everything on the page is drawn in (home at the origin).
let detailFocus = [0, 0];
function focusPoint() {
  if (state.mode === 'walk' && state.walk) {
    const p = state.walk.state.pos;
    detailFocus = [p.x, p.z];
  } else if (state.mode === 'orbit') {
    detailFocus = [controls.target.x, controls.target.z];
  }
  return detailFocus;
}

// How much nearer a newcomer has to be than an island already drawn before it takes that
// island's place. Raising one costs about half a second of frame (CLAUDE.md, islandsig.js),
// so two islands at nearly the same distance must not trade places every time the walker
// takes a step along the line between them. In world units: 60 is a sea gap and a half.
const DETAIL_HYSTERESIS = 60;

// Which islands are drawn whole, nearest to the focus first. Distance is to the island's
// box rather than its middle - a 512-grid island's middle can be 256 units off while you
// are standing on its beach - and the id breaks a tie, so every page with the same focus
// picks the same set.
function pickDetailed(others) {
  const [fx, fz] = focusPoint();
  const home = state.homeOrigin || [0, 0];
  const dist = (r) => {
    const [x, z] = worldToScene(r.origin || [0, 0], home);
    const half = (r.gridSize || 64) / 2;
    const dx = Math.max(0, Math.abs(fx - x) - half);
    const dz = Math.max(0, Math.abs(fz - z) - half);
    return Math.sqrt(dx * dx + dz * dz) - (state.sea.get(r.id) ? DETAIL_HYSTERESIS : 0);
  };
  const ranked = others.map((r) => ({ r, d: dist(r) }))
    .sort((a, b) => (a.d - b.d) || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
    .map((x) => x.r);
  return { near: ranked.slice(0, DETAILED), far: ranked.slice(DETAILED) };
}

// Asked every couple of seconds whether the viewer has moved far enough for the near set
// to be a different set. Cheap when it has not - a sort of at most sixteen rows - and when
// it has, it is the ordinary fleet sync that does the work, so there is one path that
// raises and drops islands rather than two.
let chosenNear = new Set();
function recheckDetail() {
  if (!state.terrain || !state.fleet || syncing) return;
  if (state.islandId && !state.fleet.some((r) => r.id === state.islandId)) return;   // not berthed yet
  const others = state.fleet.filter((r) => r.id !== state.islandId);
  if (others.length <= DETAILED) return;
  // Against what the last sync *chose*, not against what is standing: an island that would
  // not raise - a fetch that failed, a bundle that did not parse - would otherwise look
  // missing on every recheck and cost a 200 kB fetch every two seconds, for ever.
  const want = pickDetailed(others).near.map((r) => r.id);
  if (want.length === chosenNear.size && want.every((id) => chosenNear.has(id))) return;
  syncFleet();
}

function farFrom(origin) {
  const home = state.homeOrigin || [0, 0];
  const dx = (origin ? origin[0] : 0) - home[0];
  const dz = (origin ? origin[1] : 0) - home[1];
  return Math.sqrt(dx * dx + dz * dz);
}

// The whole horizon: islands in our own sea that are too far to draw in full, plus the
// `?join=` debug islands. Nothing else - there used to be a LAN beacon feeding it islands
// in no sea of ours, and it went, because the way to meet somebody is to join their sea
// from the main menu. An island that is really here (a region) is never also a
// silhouette, or it would be drawn twice in the same water. One caller, because
// horizon.apply() removes whatever is not in the list it is given.
function syncHorizon() {
  if (!state.horizon || state.guest) return [];
  const here = new Set(state.sea.regions().map((r) => r.id));
  const shown = new Map();
  for (const row of state.farFleet || []) {
    if (here.has(row.id)) continue;
    // A manifest row's origin is the sea's; the silhouette stands in our frame.
    state.horizon.pin(row.id, worldToScene(row.origin, state.homeOrigin || [0, 0]));
    // `beacons` is the one thing out here that is not derivable from a seed: where that
    // island's lighthouses stand on it. It rides the manifest row and nothing else does -
    // a row without that list gets no light, which is the same rule the rest of this file
    // keeps: nothing is invented.
    // `volcano` so a silhouette of the middle of the world is the volcano's shape and not an
    // ordinary island of the same seed - the row is all horizon.js ever sees of it.
    shown.set(row.id, { id: row.id, name: row.name, island: row.name, seed: row.seed, gridSize: row.gridSize, volcano: row.volcano === true, settlers: row.buildings || 0, beacons: row.beacons || [] });
  }
  for (const n of debugJoins) {
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
// Said once per wait, not once per sync - see `berthed` in doSyncFleet.
let waitingForBerth = false;
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
  // Our own island is not in the running: it is always drawn. Of the rest, the ones
  // nearest to the viewer get the detail - see pickDetailed.
  const others = moored.filter((r) => r.id !== state.islandId);
  // Nobody is raised before the sea has said where WE are. Every other island is placed
  // relative to our berth (see rehome), and a joiner's welcome usually arrives before its
  // own islander has published - so for a moment the fleet has everybody but us. Raising
  // the others against a berth we do not know yet put the host on top of home and had it
  // refused as overlapping, five warnings a join, and that warning is the very one that
  // sent an afternoon's debugging the wrong way. A page with no islander (islandId null)
  // has no berth to wait for and draws the world as it is.
  const berthed = !state.islandId || moored.some((r) => r.id === state.islandId);
  if (!berthed && !waitingForBerth) console.info('island: waiting for the sea to berth this island before raising the others');
  waitingForBerth = !berthed;
  const picked = pickDetailed(others);
  const near = berthed ? picked.near : [];
  const nearIds = new Set(near.map((r) => r.id));
  chosenNear = nearIds;
  state.farFleet = berthed ? picked.far : [];

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
    let bundle;
    try {
      bundle = await sea(`/island/${encodeURIComponent(row.id)}`).then((r) => r.json());
    } catch { continue; }
    if (!bundle || !bundle.island) continue;
    // Their bundle moved on; did their island? Almost always not - see drawnSignature. The
    // cheap path keeps the ground, the wood and the houses exactly where they are and only
    // takes the new village on board, which is what the boards and the props read.
    if (standing && standing.drawn === drawnSignature(bundle)) {
      standing.village = bundle;
      standing.rev = row.rev;
      syncBoards();
      continue;
    }
    if (standing) dropRegion(row.id);
    const region = joinIsland({
      id: row.id,
      rev: row.rev,
      seed: bundle.island.seed,
      gridSize: bundle.grid ? bundle.grid.size : bundle.island.gridSize,
      polders: bundle.polders || [],
      fairway: bundle.fairway || null,
      grow: bundle.grow || null,
      volcano: bundle.island.volcano === true,
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
    state.ui.toast(`<b>${escapeHtml(arrived.join(', '))}</b> ${arrived.length === 1 ? 'is' : 'are'} in the water alongside.`);
  }
}

// The island has been moved to another world; bring the page with it.
//
// This used to be a comment saying the page need do nothing, because net.js retries on its
// own and the new welcome carries the new fleet. That is true only while the world stays
// at the same address. `useSea` is called once at boot from /api/hello, so after a change
// the retry dialled the sea we had just left and the whole of that fleet came back on the
// next welcome - every region dropped here and then handed straight back. Going "on our
// own" was the plainest case: you end up alone in config.json and in a harbour full of
// other people's islands on screen.
//
// Asked of the islander rather than worked out from what was chosen: hosting and being
// alone are both "a sea of our own", and only the server knows which port it actually got
// - `putToSea` falls back to any free one when 4750 is taken by another island on this
// machine. The key comes back with it, because the sea being joined may want a different
// one, or none.
async function followSea() {
  const hello = await mine('/api/hello').then((r) => r.json()).catch(() => null);
  if (hello) {
    useSea(hello.sea);
    state.islandId = hello.islandId || null;
    state.seaKey = hello.seaKey || null;
  }
  // And dial again. Everything in net.js is already written to survive the line dropping,
  // so this is a close and a retry rather than a second socket.
  if (state.net) state.net.reconnect();
}

// Move this island to another world. The islander writes it down and actually does it -
// closes the sea it was in and joins the new one - and then followSea() points this page
// at wherever that turned out to be.
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
    await followSea();
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

// Our own roster, in the sea's names and then in ours.
//
// The bundle this island published is the redacted one - it is the same bundle everybody
// else is handed, and it has to be - so the sea knows our settlers as `house:s3` and this
// page drew their houses as `house:<uuid>`. The islander is the only thing that can join
// the two, because it did the renaming; it hands the map over loopback and never to
// anybody else (serve.mjs, /api/crowd-ids).
//
// Fetched when a roster arrives rather than kept in step: a roster is one message per
// scan, so this is a request a minute at the very most, and the alternative is a cache
// that is wrong for exactly as long as nobody notices.
let ourIds = null;
// The fetch, while it is out, and whatever the sea said about where everybody is while we
// were waiting for it.
//
// The sea sends a roster and then, immediately, one message placing the whole village -
// that pair is what stops a joiner watching the island fill up over ten seconds. But
// translating the roster means a round trip to our own islander, and positions land by
// index into figures that do not exist until that comes back, so the message would be
// dropped in full and the ten seconds would be back. It is the join case exactly: the one
// message big enough to matter is the one guaranteed to arrive at the wrong moment.
let namingIds = null;
let heldWhere = null;
async function ourRoster(ids) {
  const unknown = ids.some((id) => id && !state.byId.has(id) && !(ourIds && ourIds[id]));
  if (unknown) {
    namingIds = mine('/api/crowd-ids').then((r) => r.json()).then((x) => x.ids || {}).catch(() => null);
    const got = await namingIds;
    namingIds = null;
    // Kept only when it arrived. This used to assign the failure too, and the cost of that
    // was out of all proportion: with no map the roster falls back to the sea's redacted
    // names, every id differs from the one its figure was enrolled under, and crowd-view's
    // `ids[idx] !== f.id` retires and re-enrols the entire village - which then walks in
    // from the middle of the island (see apply() there). The next roster fetches the map
    // again, succeeds, and does the whole thing a second time in reverse. One missed
    // request, two hundred settlers marching out of the town square.
    //
    // An islander that is restarting is exactly when this request fails, and exactly when
    // somebody is watching. Holding on to the last good map costs nothing: it is the
    // inverse of a redaction that only changes when a house is built, and a name that has
    // gone stale costs that one settler their face until the next roster.
    if (got) ourIds = got;
  }
  // Untranslated ids are left as they are rather than dropped: an island whose islander
  // cannot be reached still has a crowd worth drawing, and a name nobody recognises only
  // costs that one settler their face.
  state.homeRoster = ourIds ? ids.map((id) => ourIds[id] || id) : ids;
  if (state.settlers) state.settlers.roster(state.homeRoster);
  // And now the positions that arrived while nobody had a name yet.
  if (heldWhere) { const held = heldWhere; heldWhere = null; placeOurs(held); }
}

// Where our own people are. Split out of the router because the join case has to be able
// to replay one.
function placeOurs(m) {
  if (!state.settlers || !state.region) return;
  const half = state.region.half;
  const now = performance.now();
  state.settlers.apply(decodeCrowd(m.k, half, decodeCrowd(m.a, half)), now);
  state.settlers.applyRides(decodeRides(m.b, half), now);
}

// Somebody else's settlers. The wire format is shared/settlerwire.mjs and the drawing is
// web/js/crowd-view.js; this only routes.
function onCrowdMessage(m) {
  // Our own island is on this wire like any other: the sea walks our crowd too, and this
  // page draws it rather than simulating it. The roster is kept as well as applied, because
  // a reseed throws the scene away and builds a new view, and the sea has no reason to say
  // it all again - see the note where that view is made.
  const home = state.islandId && m.island === state.islandId;
  const crowd = home ? state.settlers : null;
  const region = home ? state.region : null;
  const g = home ? null : state.guests.find((x) => x.region.id === m.island);
  if (m.kind === 'roster') {
    if (home) { ourRoster(m.ids); return; }
    if (g && g.crowd) g.crowd.roster(m.ids);
    else crowdRosters.set(m.island, m.ids);
    return;
  }
  if (home) {
    // Held rather than dropped while the roster is being translated - see there. Only the
    // last one: they are absolute positions, so an older one has nothing to add.
    if (namingIds) { heldWhere = m; return; }
    placeOurs(m);
    return;
  }
  if (!g || !g.crowd) return;
  // Positions travel in the island's own frame, so they are decoded against its own half
  // and the origin goes on inside the view. A message is walkers, or a slice of everybody
  // else, or both.
  const half = g.region.half;
  const now = performance.now();
  const rows = decodeCrowd(m.k, half, decodeCrowd(m.a, half));
  g.crowd.apply(rows, now);
  // And whoever is out on the water. Sent whole every beat, so this is handed the message
  // even when it is empty - an empty one is how a hull is taken back out of the water.
  g.crowd.applyRides(decodeRides(m.b, half), now);
}

// Something on an island was hit (lib/combat.mjs, `{t:'agent', a:'hit'}`) or started a
// swing (lib/hostility.mjs, `{t:'agent', a:'swing'}`): a guard or a Codex resident on the
// volcano, told to everybody who can see it. The crowd view of the island it names makes that
// body flinch - and keeps what is left for its health bar - or swing. Only guests: the sea
// knows our own settlers by redacted names (see ourRoster), and nothing on our own island can
// be hit. A fall needs nothing here - the roster's null hole takes the body away.
function onAgentMessage(m) {
  const g = state.guests.find((x) => x.region.id === m.i);
  if (!g || !g.crowd) return;
  if (m.a === 'hit') g.crowd.hit(m.id, m.hp, m.max);
  else if (m.a === 'swing') g.crowd.swing(m.id);
}

// The health bars over every hostile near enough to fight (agent-bars.js), made on the first
// frame that has any, since most islands never see the volcano. On foot and in orbit alike -
// a fight watched from above is still a fight - but not in the planner or indoors.
let agentBars = null;
const barCands = [];
function drawAgentBars(eye) {
  barCands.length = 0;
  if (state.mode !== 'plan' && !state.inside) for (const g of state.guests) if (g.crowd && g.crowd.bars) g.crowd.bars(barCands);
  if (!barCands.length && !agentBars) return;
  if (!agentBars) agentBars = createAgentBars(scene);
  agentBars.update(barCands, eye);
}

// Take an island's ground back out of the world: its region, its buildings, its crowd. The
// sweep below and the rebuild above both need it, and doing it in two places is how one of
// them ends up leaking a hundred meshes.
function dropRegion(id) {
  if (state.ui) state.ui.setSkew(id, null);
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
    syncBoards();
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
  // In at last - so the next refusal is news again rather than a repeat.
  if (world) { lastRefusal = null; state.fleet = world.islands || []; rehomeFrom(state.fleet); syncFleet(state.fleet); return; }
  if (!one) return;
  // A tree planted, a jetty put up, a bed sown on somebody else's island. Their coastline
  // is what it was, so this is not a fleet change and must not go anywhere near syncFleet:
  // that compares `rev`, and the whole point of a parcel is that `rev` did not move.
  //
  // The region's own copy is updated as well as the drawing, because raiseGuestIslands
  // builds from `region.village` and would otherwise put the old garden back the next time
  // that island is raised.
  if (one.a === 'parcel') {
    const g = state.guests.find((x) => x.region.id === one.i);
    if (!g) return;
    if (g.region.village) { g.region.village.props = one.props || []; g.region.village.crops = one.crops || []; }
    if (g.props) g.props.apply(one.props || [], { animate: true });
    if (g.crops) g.crops.apply(one.crops || [], { animate: true });
    syncBoards();
    return;
  }
  // The Codex houses on the volcano: every islander's, the whole set, whenever one of their
  // lists changed (lib/residents.mjs). The parcel's bargain again - `rev` did not move, so
  // this must not reach syncFleet, and the ground and the landscape stay exactly as they are:
  // the region takes the new list on board (so a later raise builds from it), the guest
  // raises and lowers only the houses that changed, and the crowd dresses whoever moved in
  // or out. The roster and everybody's position follow on the wire right behind this.
  if (one.a === 'codex') {
    const region = state.sea.get(one.i);
    if (!region || !region.village) return;
    const houses = Array.isArray(one.houses) ? one.houses : [];
    const keep = (region.village.buildings || []).filter((b) => !b.id.startsWith('codex:'));
    region.village.buildings = [...keep, ...houses];
    const g = state.guests.find((x) => x.region === region);
    if (!g) return;
    const { added } = g.applyBuildings(region.village.buildings);
    for (const rec of added) attachExtras(rec, { mail: false, signs: false });
    if (g.crowd) g.crowd.setBuildings(region.village.buildings);
    if (state.walk && state.mode === 'walk') state.walk.setBlockers(walkableBlockers());
    return;
  }
  const { t, a, ...row } = one;
  const rows = (state.fleet || []).filter((r) => r.id !== one.id);
  // Sorted by id rather than by arrival, so "the fleet" is the same list on every machine
  // and in every order the messages happen to turn up in.
  state.fleet = (one.a === 'gone' ? rows : [...rows, row]).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  rehomeFrom(state.fleet);
  syncFleet(state.fleet);
}

// Where the sea says we lie, read off the fleet every time the fleet is news - not once at
// boot. A joiner's page is usually connected before its own islander has published, so
// the welcome has no row for us and the berth only turns up in an `island joined` a moment
// later; a sea that restarts may berth us somewhere else; and changing seas is a new berth
// by definition. learnTheWorld() used to be the only reader, at boot, and for a joiner
// that left home at [0, 0] - where the host also was - for the life of the page.
function rehomeFrom(rows) {
  const me = state.islandId ? (rows || []).find((r) => r.id === state.islandId) : null;
  if (me && Array.isArray(me.origin) && me.origin.length === 2) rehome(me.origin);
}

// Move the world, not the island. Home stays at the scene origin (see buildScene); what
// changes is the translation every position from the sea goes through, so every region
// that was placed against the old berth is taken down here and raised again by the fleet
// sync that follows, where it now belongs. The other players' last two poses are in the
// old frame as well; they are cleared rather than slid across the water, and the sea's
// next roster - five seconds at most - puts them back where they are. Our own pose goes
// out in the new frame on the next beat: net.js reads the berth on every send.
function rehome(origin) {
  // An unknown berth always takes the first one offered - even [0, 0], which an
  // `|| [0, 0]` fallback here would call "no change", leaving the pose beat silent for good.
  // The regions dropped below were placed against that guess, so they go too.
  const home = state.homeOrigin;
  if (home && origin[0] === home[0] && origin[1] === home[1]) return false;
  state.homeOrigin = [origin[0], origin[1]];
  for (const region of state.sea.regions()) {
    if (region === state.region || region.id.startsWith('debug-')) continue;
    dropRegion(region.id);
  }
  if (state.peers) state.peers.clear();
  console.info(`island: home is berthed at [${state.homeOrigin}]; the world is drawn from there`);
  return true;
}

// Every board the page can see, ours and the neighbours', in one list.
//
// One panels layer and not one per island: it is a CSS3D renderer over the whole canvas,
// and a second of those is a second full-screen pass every frame for a board you cannot
// touch. What a foreign board needs instead is two things it can carry itself - world
// coordinates, and the ground under it, because this layer was handed our terrain when it
// was built and a neighbour's board does not stand on it.
//
// Their boards render blank with a sentence saying whose machine reads them. That is not
// a fallback: what a board says comes out of one islander's Jira token, GitHub token and
// git checkout, and none of those are going on the sea. An empty board with no explanation
// reads as broken, though, and the first thing anybody does with a broken board is report
// it - so it says so.
function syncBoards() {
  if (!state.panels) return;
  const list = [...(state.ownProps || [])];
  for (const g of state.guests) {
    const v = g.region.village;
    if (!v) continue;
    const [ox, oz] = g.region.origin;
    const keeper = (v.island && v.island.keeper) || true;
    for (const p of v.props || []) {
      if (p.kind !== 'panel') continue;
      const x = p.x + ox, z = p.z + oz;
      list.push({ ...p, id: `${g.region.id}:${p.id}`, x, z, y: g.region.worldHeight(x, z), away: keeper });
    }
  }
  state.panels.apply(list);
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
      scene, region, month: worldNow().month,
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
      // Only the volcano's crowd asks: its imps (web/js/imp.js) swing at a walker who comes
      // within reach, and the nearest IMP_LIMIT guards to the camera are the ones drawn as
      // imps. Scene frame, the same one the crowd's positions are in.
      player: () => (state.mode === 'walk' && !state.inside && state.walk ? state.walk.state.pos : null),
      eye: () => camera.position,
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
    syncBoards();
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
    syncBoards();
    state.guests.splice(i, 1);
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
//
// The month and the weekday come from the same place as the hour. They used to be
// `getMonth()` and `getDay()` - this browser's zone, not the world's - so the hour was the
// sea's while the season and the Friday were each viewer's own. shared/worldclock.mjs is
// the one copy, and tests/worldclock.test.mjs fails on a local getter anywhere in web/js/.
function timeNow() {
  if (state.chronicle.t != null) return state.chronicle.t;
  return Date.now() + (state.seaSkewMs || 0);
}
function worldNow() {
  const t = timeNow();
  return worldTime(t, state.seaTz == null ? localZone(t) : state.seaTz);
}
function currentHour() {
  if (state.hourOverride != null) return state.hourOverride;
  return worldNow().hour;
}

// Eight ways to look for a beach from a hull that has come alongside one.
const LAND_PROBE = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071],
  [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

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
  // The quay's ground is cut away by world.js, so its houses share the waterline instead
  // of sampling the former meadow that is deliberately no longer drawn. A harbour house
  // that overflowed onto the town commons keeps the ordinary ground under it.
  //
  // Dropped by the difference between the two decks rather than set to zero, the same way
  // buildPierGeometry drops the whole dock set by `QUAY_DECK - DOCK_DECK`: the model
  // carries its own floor at HARBOUR_DECK, and what has to line up is that floor and the
  // boardwalk outside the door, not the two origins. Getting this wrong is not subtle -
  // it is a step at every front door on the quay, in a district built out of nothing but
  // places where two pieces of decking meet.
  if (spec.harbour && spec.plot?.quay) y = QUAY_DECK - HARBOUR_DECK;
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
  // The lamp, its sweep and the bar of air it stands in - see web/js/beacon.js. It is a
  // module of its own because /demo builds the same tower without a village to hang it on,
  // and because a guest island's records come through this very call: a neighbour's
  // lighthouse lights up for the price of one line.
  if (built.animated && built.animated.beacon) rec.beacon = attachBeacon(group, built.animated.beacon.at);
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
  const terrain = makeTerrain(village.island.seed, { size: village.grid.size, polders: village.polders, fairway: village.fairway || null, grow: village.grow || null, open: !!village.island.open });
  if (village.island.terrainHash && terrain.hash !== village.island.terrainHash) {
    console.warn(`terrain mismatch: viewer ${terrain.hash}, scanner ${village.island.terrainHash}`);
    // Our own island, against our own scanner: the page is newer or older than the server
    // that packed village.json. Same banner, because it has the same consequence.
    if (state.ui) state.ui.setSkew('home', 'This island’s own scanner');
  }
  state.terrain = terrain;
  // This island becomes the first region, at the origin, so everything that asks the
  // archipelago a question gets the same answer it used to get from the terrain directly.
  // Rebuilt rather than mutated because buildScene runs again on a reseed.
  state.sea = createArchipelago();
  // Home is at the scene origin, always - whatever berth the sea gave us. The ground, the
  // houses, the hamlets and the quay of this island all hang straight in `scene` on local
  // coordinates, and there is no offset group to move them by; so instead of moving home
  // the page moves the world. `state.homeOrigin` is the berth the sea gave us, in the
  // sea's frame, and it is applied as a translation at the socket (web/js/net.js) and
  // wherever a fleet row's origin is turned into a region (joinIsland, syncHorizon). It
  // used to be [0, 0] - the identity - for every single-player island and every host,
  // because the first island into a world took the origin. The sea's volcano holds the
  // origin now (lib/fleet.mjs raiseVolcano), so a host is berthed on the ring round it and
  // translates exactly the way a joiner always has; there is one path and no special case.
  // shared/regions.mjs has the two lines and the argument.
  //
  // It used to be `origin: state.homeOrigin` here, on the theory that only the region's
  // offset needed to move. It did move, and nothing drawn moved with it: a joiner's own
  // settlers walked a berth's width east of their houses, and the host's island - at the
  // sea's origin, which was also this page's - was refused as overlapping home and shown
  // as the beacon's silhouette in the haze. Plans/wie-joint-ziet-de-host-als-mist.md.
  state.region = state.sea.add(placeIsland(terrain, { id: 'home', origin: [0, 0] }));
  state.region.village = village;
  joinRegionsFromParams(terrain, village);   // has to be in the sea before the water is laid
  state.world = createWorld(scene, terrain, village, {
    month: worldNow().month,
    shadowSize: modest ? 1024 : 2048,
    modest,
    // So the water is laid over everything there is, not over this island alone.
    sea: state.sea,
  });


  //roaddebug is a debug mesh that shows the road network, for development and testing.
  state.roadDebug = createRoadDebug({
    scene,
    terrain,
    // A getter, not the snapshot: state.village is swapped for a new object on every
    // scan (applyVillage), and this closure has to see that or /roads redraw draws
    // nothing but the island as it stood at boot.
    village: () => state.village,
  });

  window.addEventListener('island-command', async (event) => {
  const { action, data } = event.detail || {};

  switch (action) {
    case 'roads_wireframe_toggle':
      state.roadDebug?.setWireframe(!state.roadDebug?.wireframeEnabled);
      break;

    case 'roads_hide':
      state.roadDebug?.setWireframe(false);
      break;

    case 'roads_show':
      state.roadDebug?.setWireframe(true);
      break;

    case 'roads_connections_toggle':
      state.roadDebug?.setConnections(!state.roadDebug?.connectionsEnabled);
      break;

    case 'roads_redraw':
      // The /api/command response comes back as soon as the server's rescan has
      // finished, but this page's own state.village is only refreshed by the SSE
      // `update` listener, which is debounced 250ms behind it - rebuilding straight
      // off state.village here redrew whatever was already on screen before the
      // rescan, not the rescan that just ran. Fetching directly is what a redraw
      // actually promised.
      try {
        const next = await fetchVillage();
        if (next && (!state.village || next.generatedAt > state.village.generatedAt)) {
          // animate: true, not false - state.world.buildPaths (the worn-path texture, not
          // just the debug wireframe) only runs inside applyVillage's `animate` guard
          // (see the comment on it there). A silent `false` here left the ground exactly
          // as it was: setOwnership and the districts refreshed, the dirt paths did not.
          applyVillage(next, { animate: true });
        }
      } catch (e) { console.warn('[roads] redraw could not refetch the village', e); }
      // setWireframe(true) always rebuilds (buildWireframe clears the group first), so
      // this both shows the debug view and forces it to pick up whatever the village
      // looks like right now. refresh() alongside it, not instead: redraw only forces
      // the wireframe on, and a connections view already showing deserves the same fresh
      // data rather than being left to draw from whatever was true before the rescan.
      state.roadDebug?.setWireframe(true);
      state.roadDebug?.refresh();
      break;

    case 'roads_delete':
      // No setWireframe(true) here on purpose, unlike redraw/reroute above: delete does
      // not ask to be shown, only to be seen if a debug layer is already on. refresh()
      // respects whichever of wireframe/connections is currently enabled and rebuilds
      // only that - if connections is on, every house just lost its road and every one
      // gets its marker; if nothing is on, this is a quiet change until /roads status
      // or a debug view is switched on to look.
      try {
        const next = await fetchVillage();
        if (next && (!state.village || next.generatedAt > state.village.generatedAt)) {
          applyVillage(next, { animate: true });
        }
      } catch (e) { console.warn('[roads] delete could not refetch the village', e); }
      state.roadDebug?.refresh();
      break;

    // `/roads edit` had a command and no handler; the planner is what editing the roads
    // turned out to be - they are laid again around whatever the keeper moves.
    case 'roads_edit':
      enterPlan();
      break;

    case 'roads_status':
      console.log('[roads]', {
        wireframe: state.roadDebug?.wireframeEnabled ?? false,
        connections: state.roadDebug?.connectionsEnabled ?? false,
      });
      break;

    default:
      console.log('[command] unhandled action:', action, data);
      break;
  }
});









  // The sky over the whole world, before the haze is measured: applyFogRange asks it what
  // it is doing. Built here rather than at boot because it borrows world.js's clouds, dome
  // and lights instead of drawing a second set, and thrown away with the scene on a reseed.
  if (state.sky) state.sky.dispose();
  state.sky = createWeather({ scene, world: state.world, camera, onHaze: applyFogRange });
  // The fog object arrives with the world; the distances are ours, and they are set here
  // rather than on the first neighbour sync so that no frame is ever drawn without them.
  applyFogRange();
  applyCameraRange();
  raiseGuestIslands();
  buildDocks(village);
  launchBoats();
  // Our own people, drawn exactly the way everybody else's are. They are not simulated
  // here any more: the sea walks them - ours and the neighbours' in one loop, off the same
  // shared/settlerwalk.mjs - and sends where they got to. What that buys is a village that
  // carries on living while this page reloads, and a village doing the same thing on every
  // screen watching it. What it costs is a beat and a half of lag on our own doorstep,
  // which is the price of there being one answer instead of two.
  if (state.settlers) state.settlers.dispose();
  state.settlers = createCrowdView({
    scene, material: buildingMat, region: state.region,
    buildings: village.buildings || [],
  });
  // The last roster the sea sent, if it arrived before this scene existed - at boot it
  // always does, and after a reseed it is the scene that was rebuilt, not the island.
  // Without this nobody is drawn until the next time the village changes.
  if (state.homeRoster) state.settlers.roster(state.homeRoster);
  syncBridges(village);
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
  shownFairway = village.fairway || null;
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
  // Which crossings this village has, so the ones it does not can go. A bridge is built
  // once and never rebuilt, which was the whole of this function until the chronicle
  // learned to date one: scrub back past the day a crossing went up and the list shrinks,
  // and a deck that is only ever added would stand over the founding day's river for as
  // long as the page is open.
  const want = new Set(list.map((b, i) => `${b.id}#${i}`));
  for (const [key, mesh] of bridgeMeshes) {
    if (want.has(key)) continue;
    bridgeGroup.remove(mesh);
    mesh.geometry.dispose();
    bridgeMeshes.delete(key);
  }
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
  for (const [cell, y] of quayDeckHeights(village, terrain.size)) decks.set(cell, y);
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

// How high a settler stands anywhere on this island, for whoever draws them. Rebuilt in
// handOutDecks below rather than per frame: it walks the district list to find the quay's
// boardwalk, and handOutDecks is already where every change to what can be stood on
// arrives - a bridge going up, a prop being placed, a village being applied.
let homeStand = null;
// And one per neighbour, keyed by their region. Their decks travel in their bundle; ours
// are worked out here, which is the whole of why these are two lines and not one.
const guestStands = new WeakMap();
function standHeightFor(region) {
  const village = region && region.village;
  if (!village) return (x, z) => region.worldHeight(x, z);
  let have = guestStands.get(region);
  if (!have || have.village !== village) {
    const decking = new Map(Object.entries(village.decks || {}).map(([cell, y]) => [Number(cell), y]));
    const local = createStandHeight(region.terrain, village, decking);
    // Their crowd arrives in world coordinates and their terrain is origin-centred like
    // every other, so the berth comes off here - shared/regions.mjs, `toLocal`.
    have = { village, fn: (x, z) => local(...region.toLocal(x, z)) };
    guestStands.set(region, have);
  }
  return have.fn;
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
  // And a neighbour's bridges, off the decks their bundle carries - the same numbers the sea
  // stands their crowd on. Without them a walker crossing the volcano's lava bridges
  // (shared/volcano.mjs volcanoBridges, drawn by guest-island.js) would wade the flow under
  // the planks and burn for it. Each on its own region's storey, like the quays.
  for (const r of state.sea ? state.sea.regions() : []) {
    if (r === state.region || !r.village || !r.village.decks) continue;
    for (const [cell, y] of Object.entries(r.village.decks)) {
      if (!stacked.has(r.levelBase + Number(cell))) stacked.set(r.levelBase + Number(cell), [y]);
    }
  }
  if (state.walk) state.walk.setLevels(stacked);
  // The settlers' own copy. `flat` is already this island's decks on the plain cell key -
  // the same keying createStandHeight wants - and it is built above for walk mode anyway.
  homeStand = state.terrain && state.region && state.region.village
    ? createStandHeight(state.terrain, state.region.village, flat)
    : null;
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
    // The quay's PIER used to be drawn here, as scenery belonging to the district. It is a
    // dock now and buildDocks draws it, because those are the same planks the boat moors at
    // and walk mode floors - and two meshes over one run of water is a seam you can see
    // from the air.
    //
    // The boardwalk is the other half and does belong here: it is the district's streets,
    // not its harbour, and it goes nowhere near the water the boat lies in. It is rebuilt
    // when its cells change rather than once, because unlike the pier the deck is derived
    // on every scan and grows with the parcel - see lib/layout.mjs. Comparing the cells
    // rather than trusting a rebuild flag is what keeps a scan that changed nothing from
    // throwing away a mesh and building the same one again.
    if (d.deck && d.deck.length && d.center) {
      const key = `deck:${d.id}`;
      live.add(key);
      const sig = d.deck.map((c) => `${c[0]},${c[1]}`).join(';');
      const have = hamletSigns.get(key);
      if (have?.sig !== sig) {
        if (have) { hamletGroup.remove(have.group); have.dispose(); hamletSigns.delete(key); }
        const [px, pz] = terrain.cellWorld(d.center[0], d.center[1]);
        const g = buildDeckGeometry(d.deck, terrain, [px, pz]);
        if (g) {
          const pm = new THREE.Mesh(g, buildingMat);
          pm.position.set(px, 0, pz);
          pm.receiveShadow = true;
          hamletGroup.add(pm);
          hamletSigns.set(key, { group: pm, sig, dispose: () => pm.geometry.dispose() });
        }
      }
    }
    if (!d.center || d.tier === 'farmstead') continue;
    for (const [li, lobe] of (d.lobes || []).entries()) {
      const key = `${d.id}#${li}`;
      live.add(key);
      // Over the road where it leaves the hamlet's land, square to it, so you read the
      // name walking through rather than passing a placard in a field. The green it used
      // to stand on is gone. One per lobe, deliberately: each annex has its own way in and
      // you meet its arch there on foot - unlike the aerial caption, which goes up once per
      // hamlet (captionCell in web/js/captions.js).
      const gate = gateOf(village, d, li, lobe);
      const [gx, gz] = gate ? gate.at : (lobe.green || d.center);
      const [x, z] = terrain.cellWorld(gx, gz);
      const sx = x, sz = z;
      const along = gate ? Math.abs(gate.next[0] - gate.at[0]) > Math.abs(gate.next[1] - gate.at[1]) : false;
      const have = hamletSigns.get(key);
      if (have && have.text === d.name && have.along === along) {
        have.group.position.set(sx, d.kind === 'quay' ? QUAY_DECK : groundAt(sx, sz), sz);
        continue;
      }
      if (have) { hamletGroup.remove(have.group); have.dispose(); }
      const sign = createNameplate(titleCaseName(d.name), {
        width: 2.1, height: 0.62, canvasW: 768, band: d.hue, height0: 1.35, posts: 2, arch: 2.2,
      });
      // The arch straddles the road: its posts sit either side of the way through.
      sign.group.rotation.y = along ? Math.PI / 2 : 0;
      sign.group.position.set(sx, d.kind === 'quay' ? QUAY_DECK : groundAt(sx, sz), sz);
      sign.group.userData.id = `district:${d.id}`;
      hamletGroup.add(sign.group);
      hamletSigns.set(key, { ...sign, text: d.name, along, popped: !have });
    }
  }
  for (const [key, rec] of [...hamletSigns]) {
    if (live.has(key)) continue;
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

// The card that asks which sea, and the island's own answer to it. Both routes are real -
// /api/seas probes every candidate's /health, and POST /api/sea writes config.json and then
// actually closes the sea it was in and joins the new one - so this is a menu over working
// plumbing rather than a picture of one.
function openMainMenu() {
  const menu = createMainMenu({
    islandName: (state.village && state.village.island && state.village.island.name) || 'this island',
    hasIslander: islanderHere() && !state.guest,
    seas: async () => (await mine('/api/seas')).json(),
    // Off the saved list. Its own route rather than a field on /api/sea: that one moves the
    // island, and one route that both goes somewhere and forgets somewhere is a route where
    // a missing field means the wrong thing happened.
    forget: async (url) => {
      const r = await mine('/api/sea/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).error || 'that address would not go' };
      return { ok: true };
    },
    choose: async (what) => {
      const r = await mine('/api/sea', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(what),
      });
      const said = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: said.error || r.statusText };
      // The world we were in is not the world we are in. Everything but our own island
      // goes, and the socket brings the new fleet when it reconnects on its own.
      for (const region of state.sea.regions()) {
        if (region !== state.region) dropRegion(region.id);
      }
      state.fleet = [];
      syncFleet([]);
      await followSea();
      return { ok: true };
    },
    // Whatever was chosen, the opening sweep happens afterwards rather than under it.
    onDone: () => startIntro(),
  });
  menu.open();
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
let shownKey = null, shownPolders = null, shownFairway = null, landscapePending = null, landscapeRan = 0;

function layLandscape(shot) {
  const w = state.world;
  // The channel is a second reason to rebuild the ground, and it is compared by identity
  // rather than by depth: `fairwayAt` hands back the village's own object or null, so the
  // two only differ on the scrub across the day it was dug.
  if (shot.polders !== shownPolders || (shot.fairway || null) !== shownFairway) {
    shownPolders = shot.polders;
    shownFairway = shot.fairway || null;
    const v = state.village;
    const next = makeTerrain(v.island.seed, { size: v.grid.size, polders: v.polders.slice(0, shot.polders), fairway: shownFairway, grow: v.grow || null });
    state.terrain = next;
    // The region holds the terrain it was placed with, and the water patch now reads its
    // depths through the archipelago - so a coast that moves has to move here too, or the
    // shallows stay where the polder used to be while the ground under them has gone.
    state.region = state.sea.replace('home', placeIsland(next, { id: 'home', origin: [0, 0] }));
    w.reshape(next);
  }
  state.shot = shot.village;
  state.region.village = shot.village;
  w.setOwnership(shot.village);
  w.buildPaths(shot.village.paths, w.squareCells(shot.village));
  // The crossings go with the roads. They are dated on the wire now, so a scrub back past
  // the one the village built at ninety takes the planks away as well as the road over
  // them - and puts back the riverbed under anybody walking there, because `syncBridges`
  // hands out the deck heights on its way through.
  syncBridges(shot.village);
  // The square goes along with the roads, the same as it does on the line above and at
  // the two other callers. It used to be left out here and that cost nothing, because
  // `setRoads` only folded the square into the road network - but the Friday borrel
  // remembers those cells separately as the place to walk to, so leaving them out empties
  // that list. The result was a borrel that worked until you touched the chronicle and
  // then silently never happened again, which is the worst shape a bug can have.
  syncHamlets(shot.village);
}

// What the heightfield is made of, as one string: the polders' three lists and the channel.
// Compared between two villages to know whether the ground has to be built again.
const groundSig = (v) => JSON.stringify([(v.polders || []).map((p) => [p.cells, p.pools, p.dike]), v.fairway ? v.fairway.cells : null, v.grow || null]);

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
  // The grid itself grew (growCanvas in lib/layout.mjs): every grid index in the village is
  // somewhere else now, and the ground mesh, the water patch, the haze, the camera range and
  // the minimap were all built on the old one - `reshape` cannot take a different N. It
  // happens a handful of times in an island's life, so the page starts again rather than
  // growing a second, rarely-walked path through every one of those.
  if (prev && prev.grid && next.grid && prev.grid.size !== next.grid.size) {
    console.info(`[promptholm] the island's grid grew from ${prev.grid.size} to ${next.grid.size}; reloading`);
    location.reload();
    return;
  }
  state.village = next;
  if (state.region) state.region.village = next;
  for (const d of next.districts) state.districts.set(d.id, d);
  const nextSpecs = specById(next);

  // new cleared ground -> fell the trees that stood there
  if (prev && animate) {
    const before = new Set(prev.cleared.map((c) => c.join(',')));
    const fresh = next.cleared.filter((c) => !before.has(c.join(',')));
    if (fresh.length) state.world.fellTrees(fresh, true);
    // By content, not by count: a hamlet the keeper moved (lib/plan.mjs) is roaded again
    // with as many paths as it had, in other cells, and a length check left the old
    // roads drawn under the houses' new doors until the page was reloaded.
    if (JSON.stringify(next.paths) !== JSON.stringify(prev.paths) || JSON.stringify(next.bridges || []) !== JSON.stringify(prev.bridges || [])) {
      syncBridges(next);
      state.world.buildPaths(next.paths, state.world.squareCells(next));
      // The road network just changed - a house that gained (or lost) its way to the
      // square deserves its mark updated in the same update, not left stale until the
      // next explicit /roads command.
      state.roadDebug?.refresh();
    }
  }

  // Outside the `animate` guard on purpose: the boundaries and the tint have to be right on
  // a silent reload too, and only the falling trees are an animation.
  if (state.world && (!prev || next.districtsRev !== prev.districtsRev)) {
    state.world.setOwnership(next);
    syncHamlets(next);
    // The kade belongs to a district, so the dock changes when the districts do - the day a
    // village earns its quay, the planks have to appear under the reader's feet and not
    // only after a reload. Only on a *change*: the first village through here is the one
    // buildScene has just built the docks from, and disposing them to make the same ones
    // again is a rebuild nobody asked for. The fleet is left alone either way - a boat is
    // where somebody left it, and the server re-moors an untouched one from the same
    // shared/quay.mjs.
    if (prev) buildDocks(next);
  }
  // The harbours are not districts, so a new harbour - or a boat built at one, which comes
  // as a changed count and nothing else - would not show until a reload. Docks and fleet
  // both, because a new count is a new hull at a new berth (shared/quay.mjs mooringsFor).
  if (prev && harbourSig(next) !== harbourSig(prev)) { buildDocks(next); launchBoats(); }
  // The ground itself, when the polders or the channel changed under it - a polder the
  // keeper dug or gave back. Before the buildings below, because a house set down on new
  // land is built at the height of the terrain it finds. `shownPolders` is a count and a
  // plan can give one polder back and dig another in the same Apply, so it is forgotten
  // rather than trusted.
  if (prev && groundSig(prev) !== groundSig(next) && state.chronicle.t == null) {
    shownPolders = null;
    shownKey = null;
    applyLandscape(true);
  }
  syncSquareBed(next);
  syncBorrelTables(next);

  const events = [];
  for (const [id, spec] of nextSpecs) {
    if (!spec.plot) continue;
    const rec = state.byId.get(id);
    if (!rec) {
      const fresh = makeRecord(spec);
      if (animate) events.push({ type: 'arrive', rec: fresh, spec });
      continue;
    }
    const before = rec.spec;
    // A plot that moved is the keeper's planner at work (POST /api/plan): a building never
    // moves by itself. Built again where it now stands rather than slid there, because its
    // placement - the loosened building line, a shed's nudge to the edge of its yard - is
    // measured against its neighbours, and they may have moved with it. After the loop the
    // frontages are redone once for everybody and `reportPlacements` tells the sea.
    const p0 = before.plot, p1 = spec.plot;
    if (p0 && (p0.gx !== p1.gx || p0.gz !== p1.gz || p0.rot !== p1.rot || p0.w !== p1.w || p0.d !== p1.d)) {
      const shown = rec.group.visible;
      disposeRecord(rec);
      state.byId.delete(id);
      makeRecord(spec).group.visible = shown;
      continue;
    }
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
    setTimeout(() => { if (!specById(state.village).has(id)) disposeRecord(rec); }, animate ? 1000 : 0);
    state.byId.delete(id);
    if (state.selected === id) { state.selected = null; state.ui.closeDossier(); }
  }

  assignFlags();
  state.world.setHouseFrontages(state.byId.values());
  // A record built while planning comes with its nameplate up; the planner keeps them down.
  if (state.mode === 'plan') for (const rec of state.byId.values()) if (rec.nameplate) rec.nameplate.group.visible = false;
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

// Who lives where, and what they are doing, is the sea's answer now: it spawns a crowd out
// of the bundle this island published and sends a fresh roster with every republish. So
// nothing here adds, removes or poses anybody - a house built in this browser is drawn at
// once, and whoever lives in it turns up on the next roster, a beat later.
//
// The scaffolding is not part of that. It hangs on the building rather than on the person,
// it is this browser's own animation, and the sea has never known about it.
function applyEventInstantly(e) {
  if (e.type === 'upgrade' || e.type === 'refit') {
    const rec = state.byId.get(e.id);
    if (rec) rebuild(rec, e.spec);
  } else if (e.type === 'start') { const r = state.byId.get(e.id); if (r) addScaffold(r); }
  else if (e.type === 'finish') { const r = state.byId.get(e.id); if (r) removeScaffold(r, false); }
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
        const p = rec.group.position;
        state.particles.puff([p.x, p.y + 0.3, p.z], 10);
        await wait(1.5);
        const fresh = rebuild(rec, e.spec);
        addScaffold(fresh);
        state.particles.puff([p.x, p.y + 0.3, p.z], 12);
        await wait(0.5);
        if (!e.spec.active) removeScaffold(fresh);
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
    const p = fresh.group.position;
    state.particles.puff([p.x, p.y + 0.2, p.z], 7);
    assignFlags();
    return;
  }
  if (e.type === 'start') { applyEventInstantly(e); return; }
  if (e.type === 'finish') { const r = state.byId.get(e.id); if (r) removeScaffold(r, true); return; }
  if (e.type === 'milestone') { state.ui.toast(`Milestone at ${e.m.at} settlers — <b>${e.m.label}</b> is built.`); return; }
  if (e.type === 'district') { state.ui.toast(`A new district: <b>${e.d.name}</b>.`); return; }
}

// The tent going up. The newcomer walking to it from the landing beach is the sea's half
// now (lib/crowd.mjs): it compares the crowd it is building against the one that stood
// there before, and whoever is new comes up the beach. That happens on the publish after
// this scan rather than in this frame, so the two are not in step - the tent is up, and
// they are walking towards it a beat later - and in exchange everybody watching this
// island sees them arrive, instead of only this screen.
async function walkIn(rec) {
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
  if (state.mode === 'plan') return;       // the planner has the pointer (web/js/plan-mode.js)
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
  if (state.mode === 'plan') { downAt = null; return; }
  // Aimed from the event rather than from the last move: a tap on a touch screen never
  // sends one, and a click that lands a finger's width off a button is worse than none.
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  // A click on the board you are working is the board's, and never also picks whatever
  // building happens to stand behind it.
  if (moved < 5 && state.panels && state.panels.press(pointer)) { downAt = null; return; }
  if (moved < 5) {
    const hit = pick();
    // A silhouette on the horizon is not somewhere to go - a far island in our own sea is
    // water you cross - so a click on one is a click on nothing, and closing the dossier
    // is the right answer.
    // A body on a visiting island is the same: named on hover, but nothing to open.
    if (hit && !String(hit).startsWith('neighbour:') && !pickedGuest.f) select(hit);
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
// The same for somebody on a visiting island, and which island: one object, rewritten by
// every pick() rather than made by it, because pick() runs every frame in orbit.
const pickedGuest = { f: null, t: 0, g: null };
// How far along the ray a guest body is looked for when there is no building to stop at.
// The camera is within PEOPLE_PICK_RANGE of what it looks at, so this is past the target
// with room for a slope, and short of the next island's crowd.
const GUEST_PICK_T = PEOPLE_PICK_RANGE * 1.5;

function pick() {
  ray.setFromCamera(pointer, camera);
  const buildings = ray.intersectObjects(state.pickables.filter((m) => m.parent && m.parent.visible), false);
  const b = buildings[0] || null;

  pickedFigure = null;
  pickedGuest.f = null; pickedGuest.g = null;
  if (state.settlers && controls.getDistance() < PEOPLE_PICK_RANGE) {
    const people = ray.intersectObjects(state.settlers.pickables(), false);
    const p = people[0];
    // A person standing in a doorway is nearer the eye than the wall behind them, and
    // is the smaller target, so give them the tie.
    if (p && (!b || p.distance <= b.distance + 0.5)) {
      const f = state.settlers.figureAt(p.object, p.instanceId);
      if (f) { pickedFigure = f; return f.id; }
    }
    // Then everybody on a visiting island - the volcano's guards and Codex residents above
    // all. Not through their meshes: a guard close to the camera is a skinned imp rather
    // than an instance, so web/js/guest-pick.js finds the nearest drawn body to the ray by
    // arithmetic. Only when nobody of ours was nearer, and with the same tie as ours.
    const maxT = b ? b.distance + 0.5 : GUEST_PICK_T;
    for (const g of state.guests) {
      if (!g.crowd || !chronicleLive()) continue;
      const h = nearestOnRay(g.crowd.figures(), ray.ray.origin, ray.ray.direction, maxT);
      if (h.f && (!pickedGuest.f || h.t < pickedGuest.t)) {
        pickedGuest.f = h.f; pickedGuest.t = h.t; pickedGuest.g = g;
      }
    }
    if (pickedGuest.f) return `guest:${pickedGuest.g.region.id}:${pickedGuest.f.id}`;
  }
  return b ? b.object.userData.id : null;
}
// Guest crowds are hidden while the chronicle is scrubbed back (crowd-view draw), and the
// same test as the frame loop's `live` says so here.
const chronicleLive = () => !state.chronicle || state.chronicle.t == null;

// --------------------------------------------------------------- loop
let last = performance.now();
const projected = new THREE.Vector3();

// One bad frame must never stop the island: log it once and keep going.
let frameErrors = 0;
// The controller from up in the sky: right stick orbits, left stick pans, triggers zoom.
// A drops you onto the island, B clears whatever panel is hanging over it.
function orbitPad(a, dt) {
  if (state.mode !== 'orbit') return;
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
    state.vitals.setStamina(shownPool(state.inside.walk.state.stamina, false));
    state.ui.setMouse(state.inside.walk.handAction('leftArm'), state.inside.walk.handAction('rightArm'));
    state.ui.setPouch(null);              // the purse is for the seed stall, not for the bar
    showMinimap(false);                   // the radar is for the shore, not the tavern floor
  } else if (state.mode === 'walk') {
    const w = state.walk.update(dt);
    state.ui.setWalkPrompt(promptFor(w && w.near));
    state.vitals.setStamina(shownPool(state.walk.state.stamina, !!state.walk.aboard()));
    // What each mouse button does, for the key row: its hand's item picked up or put down in
    // the inventory changes it mid-walk, and ui.js redraws only on a change.
    state.ui.setMouse(state.walk.handAction('leftArm'), state.walk.handAction('rightArm'));
    state.ui.setPouch(state.guest ? null : pouch());
    reportWhere();
    showMinimap(true);
    if (minimapMode === 'radar') state.minimap.update(minimapData());
    else if (minimapMode === 'map') state.worldMap.update(worldMapData());
  }
  // Health is the sea's (net.js keeps its last word and fills the bar from it), whichever
  // walk mode has the feet - and in orbit too, where the strip is hidden and this costs one
  // string compare.
  state.vitals.setHealth(state.net ? state.net.health() : 1);
  // The beer wears off wherever you are, but only blurs the view from your own eyes: the sky
  // is not the settler's.
  stepTipsy(state.tipsy, dt);
  state.vitals.setTipsy(state.tipsy.level);
  state.vitals.setHaze(state.inside || state.mode === 'walk' ? hazePx(state.tipsy.level, nowMs / 1000) : 0);
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
  const calendar = worldNow();
  const month = calendar.month;
  if (state.world) {
    state.world.update(dt, hour, month);
    // Straight after it, and never before: the weather multiplies what the hour has just
    // set - the lights, the dome, the haze's colour - and world.js writes all of those
    // fresh every frame, which is exactly what stops a multiplier compounding.
    if (state.sky) state.sky.update(dt, month);
    // The island keeps its clock while you are indoors - it is the same afternoon when
    // you come back out - but a room with its shutters closed does not brighten at noon.
    buildingMat.userData.uniforms.uNight.value = state.inside ? INDOOR_GLOW : state.world.state.night;
    // The imps' lava by the same nightfall (web/js/imp.js): two shared uniforms, every imp.
    setImpNight(state.world.state.night);
    if (state.flags) state.flags.material.userData.uniforms.uTime.value = nowMs / 1000;
  }
  if (state.settlers) {
    // Friday afternoon: the whole village downs tools and heads for the square. Whether
    // they go is the sea's decision - it keeps the clock everybody shares - and what is
    // left here is the furniture, which is scenery and always was: one set of tables per
    // ten islanders, of which the set the village earned is the first, so the rest are
    // carried out and taken back in with the borrel itself.
    const borrel = calendar.weekday === BORREL_DAY && hour >= BORREL_FROM && hour < BORREL_UNTIL;
    if (state.borrel) {
      state.borrel.show(borrel ? tableSetsFor(state.village && state.village.stats && state.village.stats.settlers) : 0);
    }
    // And our own people, off the wire like any other island's. The height is the one the
    // sea walked them to - decks, stair treads and all - which is what stands somebody on a
    // quay's planks rather than in the water beside them. It used to be plain terrain here,
    // and the quay is the one place on the island where those two differ by a whole metre.
    state.settlers.draw(dt, homeStand || ((x, z) => state.region.worldHeight(x, z)), nowMs, live);
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
    // Every frame, and not only the ones that moved far enough: net.js coalesces this onto
    // the pose beat, so what is handed over here is the hull's position and not a message.
    // Deciding here whether it was worth sending is what made this sixty messages a second
    // and took the socket down under the pilot - see `hull` in net.js.
    if (b === mine && state.net) state.net.movedBoat(b.id, b.x, b.z, b.yaw);
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
    // And their ground: the season their wood is drawn in, and anything falling over on
    // it. Their island is built by the same createLandscape ours is, so it wants the same
    // one call a frame - without it a neighbour's forest would still be in the season it
    // was raised in while ours turned around it.
    if (g.update) g.update(dt, month);
    // Their people, drawn where the sea last said they were and interpolated between, at
    // the height their own island's decks and steps put them - which is what puts a body on
    // a quay's planks rather than in the water beside them.
    if (g.crowd) g.crowd.draw(dt, standHeightFor(g.region), nowMs, live);
  }


  // The sky and the open sea ride with the eye, wherever the eye is. Once a frame, before
  // either camera branch below, because both of them move the camera and neither of them
  // owns the horizon.
  const eye = state.mode === 'plan' && state.plan ? state.plan.camera : camera;
  if (state.world) state.world.recentre(eye.position.x, eye.position.z);
  // The haze reaches as far as the eye has pulled back, so it has to be told where the eye
  // is. Only once there is a second island: on our own it is the fixed ring it always was,
  // and this then costs one comparison a frame.
  if (state.sea.count() > 1) applyFogRange();

  if (!state.intro && state.mode === 'orbit') {
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
  } else if (state.mode === 'plan' && state.plan) {
    state.plan.update(dt);
    if (state.world) state.world.followShadow(state.plan.view.cx, state.plan.view.cz, state.plan.view.hh * 2);
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
  if (state.mode === 'orbit' && !(state.ghost && state.ghost.holding())) updateLabels();
  state.ui.setClock(hour, state.world ? state.world.season() : calendar.season);
  drawAgentBars(eye);
  renderer.render(state.inside ? state.inside.scene : scene, eye);
  if (statsReadout) {
    // Colour pass only: three.js resets renderer.info after the shadow pass, so the
    // shadow map's own calls and triangles are not in these numbers. Comparing two runs
    // is what they are for, and for that they are honest.
    const info = renderer.info.render;
    statsReadout.textContent = `${modest ? 'modest' : 'standard'} · ${info.calls} calls · ${info.triangles.toLocaleString()} tris · ${state.particles?.count() ?? 0} particles`;
  }
  // After the canvas, on its own layer above it. This one has no depth of its own - see
  // the top of web/js/panels.js for what that costs.
  if (state.panels && state.mode !== 'plan') state.panels.render();
  // And last of all, what the island sounds like. After the camera has settled, because
  // the listener rides on it; one line, because everything sound needs it asks for itself
  // through the snapshot handed to createSound.
  if (state.sound) state.sound.update(dt);
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
  // Or on somebody on a visiting island: a guard, a Codex resident, a neighbour's settler.
  // Over their head the same way, from what guest-pick.js can say without an id.
  const guest = hoverId ? pickedGuest.f : null;
  if (guest) {
    projected.set(guest.pos[0], (guest.y || 0) + 0.62, guest.pos[1]).project(camera);
    if (projected.z <= 1) {
      const v = pickedGuest.g.region.village;
      const said = guestLabel(guest, v && v.island, state.fleet);
      hoverItem = {
        name: said.name,
        sub: said.sub,
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
      // No "click to sail over" any more. It went with cross(): an island on the horizon
      // is one in a sea you have not joined, and joining is a choice in Settings rather
      // than something a click on the water can do. The click itself was already ignored
      // (see the `neighbour:` guard where a hit is selected), so the line was an offer
      // nothing on this page was still able to keep.
      const sub = `${m.island} · ${m.settlers} settler${m.settlers === 1 ? '' : 's'}`;
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

// Names over the hamlets, crossfaded against the wooden boards: readable from the air,
// gone by the time you can read the sign itself. One per hamlet, not one per lobe - the
// arches are per lobe on purpose, the caption is not (web/js/captions.js says why).
function hamletCaptions() {
  const v = state.shot || state.village;
  if (!v || !state.terrain) return [];
  const dist = camera.position.distanceTo(controls.target);
  const t = clamp((dist - 30) / 16, 0, 1);
  const opacity = t * t * (3 - 2 * t);                        // smoothstep
  if (opacity < 0.02) return [];
  const out = [];
  for (const d of v.districts) {
    const at = captionCell(d);
    if (!at) continue;
    const [x, z] = state.terrain.cellWorld(at[0], at[1]);
    projected.set(x, groundAt(x, z) + 1.9, z).project(camera);
    if (projected.z > 1) continue;
    out.push({
      text: titleCaseName(d.name), hue: d.hue, opacity,
      x: (projected.x + 1) / 2 * innerWidth,
      y: (1 - projected.y) / 2 * innerHeight,
    });
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
      try { state.ui.setIslandSize(await mine('/api/island-size').then((r) => r.json())); } catch { /* an older islander: no section */ }
    },
    // Only asks, like the signs: the island writes the setting down and says what it now is.
    onIslandSize: async (n) => {
      try {
        const r = await mine('/api/island-size', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: n }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) { state.ui.toast(`The island size stayed as it was: ${escapeHtml(body.error || r.statusText)}`); return; }
        state.ui.setIslandSize(body);
        state.ui.toast(`The island may now grow to <b>${body.max} × ${body.max}</b>.`);
      } catch { state.ui.toast('The island did not answer.'); }
    },
    onSeaMode: (mode) => changeSea({ mode }),
    onJoinSea: (url) => changeSea({ mode: 'join', url }),
    onSelect: (id) => { state.selected = id; },
    onFocus: (id) => focusOn(id),
    onOverview: () => {
      if (state.mode === 'plan') { state.plan.frameIsland(); return; }
      state.intro = null; state.tween = null; controls.enabled = true; frameIsland();
    },
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
    onTogglePlan: () => (state.mode === 'plan' ? exitPlan() : enterPlan()),
    onTalk: (id) => talkTo(id),
    onSendAway: (id) => askToSendAway(id),
    onFoundSettler: () => openTownHall(),
    onMarket: () => openMarket(),
    onCustomize: () => openStudio(),
    onBuild: () => openBuild(),
    // Switched off with something in hand or the catalogue open: both go, or the ghost
    // would stay on the cursor with no chip left to put it back with.
    onBuildMode: (on) => {
      if (on) return;
      if (state.buildMenu && state.buildMenu.isOpen()) state.buildMenu.close();
      if (state.ghost && state.ghost.holding()) state.ghost.drop();
    },
    onSound: () => state.ui.setSound(state.sound.toggle()),
  });

  // What the island sounds like. Made here and completely silent: web/js/sound.js builds
  // no AudioContext until the switch is thrown - which is both what a browser demands of
  // anything that wants to make a noise and what keeps the boot path clear of it.
  state.sound = createSound({ camera, scene, island: soundSnapshot });
  state.ui.setSound(state.sound.on, state.sound.possible);

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
      state.ui.toast(r.count
        ? `<b>${r.count} settlers</b> are moving in.`
        : r.adopted
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

  const gamepad = createGamepad({
    onConnect: (id) => {
      state.ui.setPad(true);
      state.ui.toast(`Controller ready: ${String(id).slice(0, 40)}`);
    },
  });
  // On a phone the screen is the controller: a stick and two buttons drawn over the
  // canvas that poll exactly like a pad, so walk mode and the boat need nothing new.
  state.pad = STANDALONE ? eitherPad(gamepad, createTouchPad(document.body)) : gamepad;

  // Who the controller is talking to. First one that says it is up, wins - a panel over
  // a room, a room over the island, the island over the sky.
  state.input = createInput(state.pad, {
    onFirstPad: () => {
      state.padSeen = true;
      state.ui.setPad(true);
      if (!STANDALONE) state.ui.toast('Controller connected. <b>A</b> to walk the island.');
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
  // The app on a phone. mine() refuses it outright, so the catch below is what makes it a
  // guest with no keeper's tools; the world and its key come from what the pack wrote in.
  if (STANDALONE) {
    useSea(STANDALONE.sea);
    state.seaKey = STANDALONE.key || null;
    // Which release this app is, written in at pack time (scripts/pack-android.mjs), for
    // the "who is behind" banner once the sea says its own.
    state.build = STANDALONE.build || null;
    state.ui.setStandalone();
  }
  try {
    const hello = await mine('/api/hello').then((r) => r.json());
    // Where the world is. An island always has a sea now - single player is a sea of one,
    // started in the islander's own process - but an island that says nothing still works:
    // useSea(null) leaves every world call pointed at this same server.
    useSea(hello.sea);
    state.islandId = hello.islandId || null;
    state.islandToken = hello.token || null;
    state.seaKey = hello.seaKey || null;
    // Which release this island's own code is (lib/buildinfo.mjs) - this page is served by
    // it, so it is this page's too.
    state.build = hello.build || null;
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
      if (!STANDALONE) state.ui.toast('No island server on this machine. You can look around and walk about — the garden, the post and the tickets live on the keeper’s own screen.');
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
    village = STANDALONE ? await standaloneHome() : await fetchVillage();
  } catch (e) {
    state.ui.boot(false, STANDALONE
      ? `The sea could not be reached. ${escapeHtml(String(e && e.message || e))}`
      : 'The island could not be reached. Is the server running?');
    console.error(e);
    return;
  }
  state.ui.boot(false, 'Raising the island…');
  buildScene(village);
  state.walk = createWalkMode({
    scene, camera, terrain: state.terrain, ground: state.sea,
    material: buildingMat, dom: renderer.domElement,
    // Every swing the arm starts goes to the sea, which decides what it reaches
    // (lib/combat.mjs). net.js refuses it anywhere but on foot on the sea. A function
    // because the line is opened after this.
    onSwing: () => { if (state.net) state.net.swing(); },
    tipsy: state.tipsy,
  });
  handOutDecks();                    // buildScene ran before there was a walk mode to tell
  // The island is built, so there is ground for everyone else to stand on.
  state.peers = createPeers({
    scene, material: buildingMat, terrain: state.terrain, ground: state.sea,
    // Somebody else's hand on a board. It rides in with their pose, so it arrives here
    // rather than as a message of its own - see web/js/net.js.
    // A hand on a board, scoped the same way take and drop are - and unscoped again on
    // the way in, so a hand on a neighbour's notice board is nobody's hand here rather
    // than a hand on whichever of ours happens to share its eight hex digits.
    onCursor: (who, at) => {
      if (!state.panels) return;
      const board = at ? ourPanel(at.board) : null;
      state.panels.peerCursor(who, board ? { ...at, board } : null);
    },
  });
  // Told how big we are, so the ring is exact rather than the default 64 it falls back to.
  // On a 64-grid our half is 32, so the default was putting every neighbour thirty-two
  // units further out than the gap it was computing asked for.
  state.horizon = createHorizon({ scene, pickables: state.pickables, half: state.terrain.half });
  state.minimap = createMinimap();
  state.worldMap = createWorldMap();
  syncFleet();        // whatever was already in the water when this page opened
  // And again as the viewer moves: which islands are near is a question of where you are.
  setInterval(recheckDetail, 2000);
  // Talking to the people here rather than to the settlers - see web/js/islandchat.js
  // for which conversation is which. Made before the line is opened, so a first line
  // cannot arrive with nowhere to land.
  state.islandchat = createIslandChat(document.body, {
    say: (text) => !!(state.net && state.net.say(text)),
    // A board or the stall has the screen and the letters; T is not ours then.
    blocked: () => !!openPanel(),
  });
  state.net = createNet({
    onEvicted: (m) => {
      exitWalk({ force: true });
      state.walk.setPaused(false);
      // A wanderer is sent back to their own skiff rather than to a square (lib/hostility.mjs);
      // it is climbed into at once, so a respawn is back at the oars and not treading water.
      const skiff = m.boat ? state.boats.find((b) => b.id === m.boat) : null;
      if (skiff) {
        enterWalk({ at: [skiff.x, skiff.z], facing: [skiff.x + Math.sin(skiff.yaw) * 10, skiff.z + Math.cos(skiff.yaw) * 10], pitch: 0.12 });
        takeBoat(skiff);
        state.ui.toast(`The people of ${m.island || 'that island'} put you back in your boat.`);
        return;
      }
      enterWalk({ at: [m.x, m.z] });
      state.ui.toast(`The people of ${m.island || 'that island'} sent you home.`);
    },
    onBoat: onBoatFromServer,
    // Only a phone owns a skiff; anybody else's page has nothing here to put back.
    onWelcome: (self, build) => {
      if (STANDALONE) relaunchSkiff(self);
      // The sea says which release it is on every welcome, so a sea updated under us is
      // noticed on the reconnect its restart causes.
      state.seaBuild = build;
      // In the app a newer release is the gate with a Later; on a desktop island, the banner.
      const gate = STANDALONE ? updateGate({ mine: state.build, sea: build }) : null;
      if (gate) state.ui.setGate(gate);
      else state.ui.setUpdate((updateNotice({ mine: state.build, sea: build, phone: !!STANDALONE }) || {}).html || null);
    },
    peers: state.peers,
    walk: state.walk,
    // Our berth in the sea's frame, read on every message: the socket is where the sea's
    // coordinates and this page's meet. See rehome() and shared/regions.mjs. Null while it
    // is not known yet (learnTheWorld), and net.js sends no pose until it is.
    frame: () => state.homeOrigin || null,
    // Functions, not values. This island can be moved to another world while the page is
    // open, and a captured address is the address of the world it booted into - see
    // followSea() and the note above createNet.
    url: () => seaSocket(),
    // Which world, and whose coast this body belongs over. A page with no islander of its
    // own sends no island and is a wanderer: it gets the world and a body, and nothing it
    // does can reach anybody's disk.
    // `key` is whatever the islander was given for this sea; a sea without one ignores it,
    // and a sea with one refuses everybody who cannot say it.
    join: () => ({ v: SEA_PROTOCOL, as: 'client', island: state.islandId || null, key: state.seaKey || null }),
    onWorld: onFleetNews,
    onCrowd: onCrowdMessage,
    onAgent: onAgentMessage,
    // The sky, straight through: it is one word for the whole world and nothing on this
    // side has an opinion about it. web/js/weather.js holds it whether or not the scene
    // has been built yet, which it has not when the welcome lands on a slow boot.
    onWeather: setSky,
    onRefused: onRefusedBySea,
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
    world: scene,
    island: {
      name: () => (state.village && state.village.island ? state.village.island.name : 'Promptholm'),
      hour: () => currentHour(),
      season: () => (state.world ? state.world.season() : worldNow().season),
      building: () => (state.village
        ? state.village.buildings.filter((b) => b.active && b.kind !== 'civic').map((b) => b.name)
        : []),
    },
    // Nothing a board says is decided here. A press asks the island, the island answers
    // every copy at once, and applyPanelMessage below is where the answer lands.
    onAction: (id, action, value) => { if (state.net) state.net.setPanelField(scopePanel(id), action, value); },
    onTake: (id) => { if (state.net) state.net.takePanel(scopePanel(id)); },
    onDrop: (id) => { if (state.net) state.net.dropPanel(scopePanel(id)); },
    onCursor: (at) => { if (state.net) state.net.setPanelCursor(at ? { ...at, id: scopePanel(at.id) } : null); },
    self: () => (state.net ? state.net.id() : null),
  });
  // The planner. After the world, so its overlay can measure the ground; after the
  // panels, so it can hide them. Everything it reads is a getter, because the terrain and
  // the village are both replaced under it by later scans.
  state.plan = createPlanMode({
    dom: renderer.domElement,
    terrain: () => state.terrain, village: () => state.village, byId: () => state.byId,
    pickables: () => state.pickables, bounds: () => state.bounds,
    overlay: createPlanOverlay({ scene, terrain: () => state.terrain, village: () => state.village, byId: () => state.byId }),
    panel: createPlanPanel({
      onTool: (t) => state.plan.setTool(t), onOverview: () => state.plan.frameIsland(), onDone: () => exitPlan(),
      onUndo: () => state.plan.undo(), onRedo: () => state.plan.redo(), onClear: () => state.plan.clear(),
      onApply: () => state.plan.apply(), onRestore: () => state.plan.restore(),
      onGrow: () => state.plan.grow(),
    }),
    toast: (html) => state.ui.toast(html),
    onExit: () => leftPlan(),
  });
  refreshProps({ animate: false });
  state.crops = createCrops({ scene, terrain: state.terrain, material: buildingMat });
  refreshGarden({ animate: false });
  applyVillage(village, { animate: false });
  setLiveMode();
  // Which world this island lives in, asked over the island now that there is one to look
  // at. The opening sweep waits for the answer: a camera flying over a village while a
  // card asks you something is two things happening at once and neither reads.
  //
  // ?nointro skips it along with the sweep. That parameter has always meant "just show me
  // the island", and it is what every measurement and every screenshot uses.
  if (STANDALONE) castOffOnArrival();
  else if (params.has('nointro')) startIntro();
  else openMainMenu();
  state.ui.boot(true);
  requestAnimationFrame(tick);
  // The one model that is fetched rather than baked - the volcano's imp - may start loading
  // from here on, and only if a volcano crowd asks for it. See the header of web/js/imp.js.
  allowImp();
  // No islander to hear from and none to install from: /events and sw.js are both its own.
  if (STANDALONE) return;
  connect();
  registerWorker();
}

// Where a phone stands: nowhere. It has no island, so its home is a berth of open water -
// the one a newcomer island would be given, which is by construction clear of everybody
// already at anchor - drawn through the same home-at-the-origin path as a real island, on
// a terrain that is sea from edge to edge (`open` in shared/terrain.mjs). Every island in
// the fleet is then somebody else's and joins as a guest, and the body joins as a wanderer
// (no island in `join`), which is also why no guard can send it home: there is none.
const OPEN_HOME = 64;
async function standaloneHome() {
  await learnTheWorld();
  const placed = state.fleet
    .filter((i) => i && Array.isArray(i.origin))
    .map((i) => ({ half: (i.gridSize || OPEN_HOME) / 2, origin: i.origin }));
  state.islandId = null;
  state.homeOrigin = nextOrigin(placed, OPEN_HOME / 2);
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    all: false,
    island: { id: 'open', name: 'The open sea', seed: 0, open: true, gridSize: OPEN_HOME, foundedAt: null, landing: null, town: null, lattice: null },
    grid: { size: OPEN_HOME },
    districts: [], districtsRev: 0, buildings: [], paths: [], bridges: [], cleared: [],
    zones: [], polders: [], fairway: null, props: [], crops: [], placements: null, decks: {},
    milestones: [], active: [], assignments: [],
    stats: { settlers: 0, apprentices: 0, districts: 0, founded: null },
  };
}

// Afloat from the first frame, in a boat of our own in the middle of that berth: a skiff,
// which the sea puts in the water on `launch`, names after this socket and lets nobody
// else sail (lib/boats.mjs), so everybody else sees the hull and not a rower on the waves.
// Held back until the welcome - the skiff's name is our player id, which the welcome is
// what hands us - and so that the fleet is in the water before you look up.
function castOffOnArrival(tries = 0) {
  if (!(state.net && state.net.id()) && tries < 50) { setTimeout(() => castOffOnArrival(tries + 1), 200); return; }
  // Bow towards the nearest coast, so the first thing on screen is somewhere to row to.
  // The boat steps along (sin yaw, cos yaw) - see stepAshore - hence atan2(x, z).
  let yaw = 0, near = Infinity;
  for (const row of state.fleet || []) {
    if (!Array.isArray(row.origin)) continue;
    const [x, z] = worldToScene(row.origin, state.homeOrigin || [0, 0]);
    const d = Math.hypot(x, z);
    if (d > 0 && d < near) { near = d; yaw = Math.atan2(x, z); }
  }
  const self = state.net && state.net.id();
  // Every phone is handed the same free berth, so without a scatter the second one to
  // arrive launches inside the first one's hull. Anywhere in the middle of it will do.
  const x = (Math.random() - 0.5) * 24, z = (Math.random() - 0.5) * 24;
  const craft = createBoat({ scene, material: buildingMat });
  craft.place(x, z, yaw);
  const b = { id: `boat:w-${self}`, x, z, yaw, v: 0, aground: false, craft, deckY: DECK_Y, pilot: self, own: true };
  state.boats.push(b);
  if (state.net) state.net.launchBoat(b.id, x, z, yaw);
  enterWalk({ at: [x, z], facing: [x + Math.sin(yaw) * 10, z + Math.cos(yaw) * 10], pitch: 0.12 });
  takeBoat(b);
}

// A reconnect is a new player id, and the sea sank the skiff named after the old one when
// that socket closed. Ours is put back in under the new name, where it floats now, and
// handed straight back if we are not in it - a launch always comes with the tiller.
function relaunchSkiff(self) {
  const b = state.boats.find((x) => x.own);
  if (!b || !state.net) return;
  const aboard = state.walk && state.walk.aboard() === b;
  b.id = `boat:w-${self}`;
  b.pilot = self;
  state.net.launchBoat(b.id, b.x, b.z, b.yaw);
  if (aboard) { state.net.takeBoat(b.id); state.net.setRoom('boat', state.walk); }
  else { state.net.dropBoat(b.id); b.pilot = null; }
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

// Everything web/js/sound.js is ever told about the island, taken six times a second. One
// function rather than a dozen setters, because what sound wants is a picture of the place
// and this is the only file that has one - and because it keeps the whole of sound's reach
// into main.js on one screen, where it can be read.
function soundSnapshot() {
  return {
    night: state.world ? state.world.state.night : 0,
    indoors: !!state.inside,
    // The archipelago rather than our own terrain, so the channel between two islands
    // answers "sea" instead of the height of the nearer coast - the OPEN_SEA rule in
    // shared/regions.mjs, which is exactly the question the bed is asking.
    depthAt: (x, z) => state.sea.height(x, z),
    // Ours and every visiting island's, because a hammer carries across the water the same
    // way a mill turns over there. sound picks the nearest few out of this with
    // nearestFirst() from shared/regions.mjs.
    crowds: [state.settlers, ...state.guests.map((g) => g.crowd)]
      .filter(Boolean).map((c) => c.figures()),
    quays: state.docks.map((d) => d.head),
    // Only ours: a foreign record set would have to be walked separately and a hum does
    // not cross sixty units of open water anyway.
    records: state.byId,
    tables: state.borrel ? state.borrel.out : 0,
  };
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
  if (rec.beacon) updateBeacon(rec.beacon, dt, nightAmt);
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
  joinIsland, raiseGuestIslands, syncFleet, applyFogRange, applyCameraRange, enterPlan, exitPlan,
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  if (state.panels) state.panels.resize();
  if (state.plan) state.plan.resize();
  if (state.particles) state.particles.mat.uniforms.uScale.value = innerHeight * 0.5;
});

boot();


