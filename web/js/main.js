import { addScaffold as attachScaffold } from './scaffold.js';
// Boot, camera, the live feed and the animation queue that turns a data diff into
// something you can watch happen.
import * as THREE from 'three';
import { useRadialFog } from './radial-fog.js';
import { createRecovery } from './graphics-health.js';
import { createRenderStats, statsLine } from './render-stats.js';
import { createQualityGovernor, MIN_PIXEL_RATIO } from './quality.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTerrain } from 'shared/terrain.mjs';
import { quayDeckHeights } from 'shared/quay-basin.mjs';
import { createStandHeight } from 'shared/settlerwalk.mjs';
import { gatheringAt, raveAt } from 'shared/daylight.mjs';
import { keeperOf } from 'shared/palette.mjs';
import { createArchipelago, placeIsland, WORLD_HALF } from 'shared/regions.mjs';
import { kindOf } from 'shared/crafts.mjs';
import { createCrowdView, NPC_PAD } from './crowd-view.js';
import { decodeCrowd, decodeRides, decodeHeld } from 'shared/settlerwire.mjs';
import { quaysOf, mooringsFor, shipBerth, shipWater } from 'shared/quay.mjs';
import { clamp } from 'shared/rng.mjs';
import { createWorld } from './world.js';
import { worldTime, localZone } from 'shared/worldclock.mjs';
import { createBoat, DECK_Y } from './boat.js';
import { housePlacement } from './house-placement.js';
import { isShipyard, shipyardGround } from './shipyard.js';
import { isPirateTavern, pirateTavernGround, pirateGangway } from './pirate-ground.js';
import { projectVillage } from './history.js';
import { createBuildingMaterial, buildBuilding, buildBoatGeometry, buildCampfireGeometry, buildFlameGeometry, buildBladesGeometry, buildPierGeometry, buildBridgeGeometry, bridgeDeckHeights, bridgeDeckOf, createFlagMesh, buildDeckGeometry, resortParts, QUAY_DECK, HARBOUR_DECK, PALETTE, TIER_INDEX, setFadeEye } from './buildings.js';
import { fogCeilingOf, objectReachOf } from './fade.js';
import { keepRecord } from './record-cull.js';
import { createRecordBatch, pickedId } from './record-batch.js';
import { loadGraphics, saveGraphic, forgetGraphics, clampGraphic, graphicsTier, hazeOpening, objectDistanceOf, GRAPHICS_TIERS, loadPost, savePost, clampPost, postDefaults, forgetPost } from './graphics-settings.js';
import { createPost } from './post.js';
import { createNameplate } from './nameplate.js';
import { hamletSignSites, hamletEntrances } from './hamlet-sign-placement.js';
import { resortDressing } from './resort-dressing.js';
import { createUI } from './ui.js';
import { createHerds } from './herds.js';
import { createWatchNet } from './watch-net.js';
import { createHologram, HOLOGRAM } from './hologram.js';
import { keysOf } from './keybinds.js';
import { attachClock, updateClock, attachResetClock, updateResetClock } from './clock.js';
import { attachFountain, updateFountain } from './fountain.js';
import { attachSawmill, updateSawmill } from './sawmill.js';
import { attachPirateSign, updatePirateSign } from './piratesign.js';
import { attachKrakenMotion, updateKrakenMotion } from './kraken-motion.js';
import { attachBatavia, updateBatavia, floatingPose } from './batavia.js';
import { attachSmithy, updateSmithy } from './smithy.js';
// The stable's horse and hens, the bakery's oven and its baker (Plans/DONE/stal-en-veld.md).
import { attachStable, updateStable } from './stable.js';
// The beat a dancer keeps when there is no hall to keep it (Plans/DONE/dansen.md).
import { attachBakery, updateBakery } from './countryside.js';
import { attachBaker, updateBaker } from './bakery-keeper.js';
import { attachButcher, updateButcher } from './butcher.js';
import { attachQuarry, updateQuarry } from './quarry.js';
import { attachBeacon, updateBeacon } from './beacon.js';
import { attachMailFlag, setMailFlag, updateMailFlag } from './mailflag.js';
import { attachPlaque, setPlaque } from './treasure-plaque.js';
import { attachGoldPile } from './goldpit.js';
import { attachOrePile } from './goldmine.js';
import { attachFurnace } from './goldsmith.js';
import { createGoldRun } from './goldrun.js';
import { createTimberRun } from './timberrun.js';
import { createDirector } from './director.js';
import { attachFisher, updateFisher, fisherAt } from './fisher.js';
import { disposeExtras } from './record-extras.js';
import { GOLD_BARS, GOLDPIT_ID, GOLDMINE_ID, GOLDSMITH_ID, MINE_ORE } from 'shared/gold.mjs';
import { createBorrelTables, tableSetsFor } from './borrel.js';
import { createPlanMode } from './plan-mode.js';
import { createPlanOverlay } from './plan-overlay.js';
import { createPlanPanel } from './plan-panel.js';
import { createWaitingFlags } from './waiting.js';
import { createWeather, setSky, forceSky, haze, hazeRange } from './weather.js';
import { installPageKeys } from './page-keys.js';
import { installTooltips } from './tooltip.js';
import { mine, mineUrl, sea, seaSocket, useSea, islanderHere } from './api.js';
import { HANDHELD } from './device.js';
import { prefs as phonePrefs } from './phoneprefs.js';
import { captionCell } from './captions.js';


// Before any material compiles: the haze by distance, not depth (radial-fog.js), so a house
// cut at Object Distance is in full fog at every corner of the screen and not only in the
// middle of it. Logged rather than thrown if three's chunk ever changes under us.
if (!useRadialFog(THREE)) console.warn('island: three.js fog chunk changed; the haze is by depth again');

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

// Bloom and anti-aliasing as this browser chose them (Plans/bloom-en-aa.md). Anti-aliasing off
// starts the canvas without MSAA, which a canvas only takes when it is made: hence "after reload".
const postChoice = loadPost(postDefaults({ phone: HANDHELD }));
function makeRenderer() {
  let last = null;
  for (const opts of postChoice.aa === 'off' ? RENDERER_TRIES.filter((o) => !o.antialias) : RENDERER_TRIES) {
    try {
      // alpha: the boards' layer lies under the canvas and shows through where a board's
      // hole wrote alpha 0 (web/js/panels.js). Everything else is cleared opaque.
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, ...opts });
      r.setClearAlpha(1);
      if (opts !== RENDERER_TRIES[0] && postChoice.aa !== 'off') console.warn('island running with reduced graphics', opts);
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
// Between the frame and the screen where a room asks for bloom (post.js); a plain render elsewhere.
const postFx = createPost(renderer);
postFx.set(postChoice);

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
      + '<button class="btn" id="canvas-retry">Try again</button>';
  const btn = document.getElementById('canvas-retry');
  if (btn) btn.addEventListener('click', () => location.reload());
  void err;
}


// A phone draws the lighter island unless its player asked for the full one (phoneprefs.js):
// MODEST_GPU is a list of desktop names, and no Adreno, Mali or PowerVR is on it, so every
// phone used to be handed a desktop's pixel ratio, soft shadows and twenty-five thousand trees.
const modest = params.has('modest') || MODEST_GPU.test(graphicsGpu) || (HANDHELD && phonePrefs().quality !== 'full');
report(`island drawing on: ${graphicsGpu}`);
// The best this screen is drawn at; the quality governor below only ever takes from it.
// A phone that runs light draws at its CSS pixels: at a devicePixelRatio of 3 even 1.15 is a
// third more pixels to fill than 1, and fill is what a phone's GPU runs out of first.
const basePixelRatio = Math.min(devicePixelRatio, HANDHELD && modest ? 1 : modest ? 1.15 : 1.5);
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = modest ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
if (modest) console.info('island: integrated graphics detected, running lighter');
// ?stats counts the shadow pass too, and the frame time (render-stats.js).
const renderStats = statsReadout ? createRenderStats(renderer) : null;

// Drawing less while this machine cannot keep up (web/js/quality.js, Plans/DONE/sneller-tekenen.md):
// fed every frame from tick(), and what it answers is applied here and nowhere else. `modest`
// above is the boot-time guess off the GPU's name; this is the correction from what the frames
// actually do. ?quality=n pins rung n (0 full .. 4 lightest), to look at one.
const quality = createQualityGovernor();
let shadowEvery = 1, shadowFrame = 0;
function applyQuality(rung) {
  renderer.setPixelRatio(Math.min(basePixelRatio, Math.max(MIN_PIXEL_RATIO, basePixelRatio * rung.pixel)));
  renderer.setSize(innerWidth, innerHeight, false);
  // Every frame is three.js's own autoUpdate; any slower and frame() asks for the map by hand.
  shadowEvery = rung.shadowEvery;
  shadowFrame = 0;
  renderer.shadowMap.autoUpdate = shadowEvery === 1;
  renderer.shadowMap.needsUpdate = true;
  scalePoints();
  if (statsReadout) console.info(`island: drawing at quality "${rung.name}"`);
}
// gl_PointSize is in drawing-buffer pixels, so the smoke and the fireflies were sized for the
// pixel ratio the page booted with; at the lightest rung's 0.6 of it they would stand 1.7
// times bigger on the screen. Scaled by how far the ratio has come down, they stay the size
// they always were. On a resize too: the fireflies used to keep the height they were born at.
function scalePoints() {
  const v = innerHeight * 0.5 * (renderer.getPixelRatio() / basePixelRatio);
  if (state.particles) state.particles.mat.uniforms.uScale.value = v;
  if (state.world && state.world.fireflies) state.world.fireflies.material.uniforms.uScale.value = v;
}

const scene = new THREE.Scene();
// The far plane is View Distance plus 150, and the 150 is not a rounding. setFogRange closes
// the haze at `0.95 * camera.far`; whatever is past the far plane is cut off on a sphere
// round the eye, and a haze that is still thin out there draws that cut as a hard curved edge
// along the sea. The margin is what lets the fog finish the job the projection starts. It was
// a flat 1400 for as long as there was no slider, which meant the fog - and nothing else -
// decided what you could see, and nothing in the settings said so.
const VIEW_MARGIN = 150;
// How far inside the far plane the fog has closed, as a fraction of it (setFogRange). The
// one copy: applyObjectDistances asks the same number whether a cut could ever be seen.
const FOG_CAP = 0.95;
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 1400);
// The field of view is vertical, so a phone held upright at 45 degrees saw about 23 across:
// a boat and a strip of sea. On the phone it opens up in portrait until there is about 60
// across, and no further than 75 up and down, where the edges start to stretch.
function fitFov() {
  const aspect = innerWidth / innerHeight;
  const want = 45;
  if (camera.fov !== want) { camera.fov = want; camera.updateProjectionMatrix(); }
}
fitFov();
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

const buildingMat = createBuildingMaterial({ seeThrough: true });
// The crowd's own instance of the same material. Object Distance and NPC Distance are two
// numbers and a shared material has one uniform slot, so the people get their own set - and
// they are not seen through (see-through.js), so theirs is a program of its own, compiled
// once; the crowd still costs one draw call per body part exactly as it did.
const crowdMat = createBuildingMaterial();
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, fog: false });
// Every building body on this island, one draw call a pass (web/js/record-batch.js,
// Plans/DONE/gebouwen-in-een-batch.md). A record keeps a stand-in where its mesh used to hang, and
// the batch copies that stand-in's visibility and matrix every render - so what shows, hides or
// moves a house still does it to the record's group, and never has to know about this.
const homeBatch = createRecordBatch({ material: buildingMat, parent: scene });

// Object Distance is worked out from View Distance (graphics-settings.js OBJECT_RATIO), never
// stored or set: it is written into state.graphics here and again whenever View Distance moves,
// so the rest of this file reads it like it always did.
function withObjectDistance(g) {
  g.objectDistance = objectDistanceOf(g.viewDistance, graphicsTier({ modest, phone: HANDHELD }));
  return g;
}

const state = {
  village: null, shot: null, terrain: null, world: null, settlers: null, ui: null,
  // `terrain` is this island, local and origin-centred, and stays exactly that: world.js
  // and hamlets.js build their own positions out of its `half`, so they need the raw one.
  // `sea` is the archipelago - here our island alone - which the camera, the haze and anything
  // asking "is there ground here" read (shared/regions.mjs).
  sea: createArchipelago(), region: null, boats: [], docks: [], gangways: [],
  bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
  // The home batch is in from the start: one pickable for every house (pickedId turns a hit
  // on it back into the house's id).
  byId: new Map(), districts: new Map(), pickables: [homeBatch.mesh],
  // The graphics distances, as this browser last left them (web/js/graphics-settings.js);
  // onGraphicsSetting is the only thing that moves them.
  graphics: withObjectDistance(loadGraphics(GRAPHICS_TIERS[graphicsTier({ modest, phone: HANDHELD })])),
  filters: { code: true, cowork: true, apprentices: true },
  hourOverride: params.has('hour') ? Number(params.get('hour')) : null,
  hover: null, intro: null, tween: null, live: 'live',
  queue: [], running: false, flags: null, particles: null,
  // The weather over the world, as this island draws it. The sea keeps the word.
  sky: null,
  // 'orbit' or 'plan': there is nothing to walk in the distillate.
  mode: 'orbit',
  net: null, guest: false,
  // Whether the yard signs are standing, as /api/hello says.
  signs: false, signMode: null,
  // The planner (web/js/plan-mode.js): the island from above, with a hand on the hamlets.
  plan: null,
  borrel: null,
  // Nobody reads the gold pit's count here (no status line), so it is drawn full.
  gold: null,
};







// ctrl+A selects nothing on this page, in any mode (page-keys.js).
installPageKeys();
installTooltips();
// Captured on the window, and stopped dead, for the same reason the chat and the town hall
// stop theirs: walk.js listens on this window too, and the key that ends a conversation must
// not also be read as "back to the sky" or as E at whatever is nearest.


// ------------------------------------------------------------ a beer for a settler



// --------------------------------------------------------------- walking

















// The clock the swell runs on this frame (frame() below sets it), so that a hull can be posed early -
// by walk mode, for somebody standing on her, and by the peers - to exactly the transform the fleet
// loop draws her with at the end of the frame. Placing and swelling are pure functions of the hull's
// position and this clock, so posing twice is posing once.
let frameSeconds = 0;




// --------------------------------------------------------------- where you are





// --------------------------------------------------------------- having a thought
// --------------------------------------------------------------- what was built

// --------------------------------------------------------------- market gardening



// --------------------------------------------------------------- building by hand






// --------------------------------------------------------------- the postbox
// The box holds somebody's mail and the server will not hand a visitor a line of it. The
// refusal here is so that a guest is told so in a sentence rather than shown a panel that
// fails to load - the same courtesy the seed stall and the town hall do.





// --------------------------------------------------------------- the gold pit
// The keeper's five-hour usage window as a pile of bars by the square (Plans/DONE/goudkuil.md).
// Asked for once at boot and then told: serve.mjs sends `event: gold` whenever the status
// line or the desktop app writes a new reading down, or a window runs out. A visitor is told nothing - the
// server refuses /api/gold to anybody but the keeper - so their pit stays full, and so does
// every guest island's (attachExtras, `gold: false`): whose limit it is stays on their
// machine.

const goldBarsNow = () => (state.gold && Number.isFinite(state.gold.bars) ? state.gold.bars : GOLD_BARS);



function pitBars(n) {
  for (const rec of state.byId.values()) if (rec.goldPile && !rec.goldPile.foreign) rec.goldPile.setBars(n);
}

// --------------------------------------------------------------- the gold mine
// The keeper's week as ore in the mine's bin, and the run that brings the pit's gold out of it
// by way of the goldsmith whenever the five-hour window turns over (Plans/DONE/goudmijn.md). The
// week comes in with the pit's count - `mine` on /api/gold and on `event: gold` - under the
// same rule: the keeper's page only, a full mine for anybody else.
const oreNow = () => (state.gold && state.gold.mine && Number.isFinite(state.gold.mine.ore) ? state.gold.mine.ore : MINE_ORE);


// The run itself, made once the scene is there. A visitor gets one too, so the miner and the
// goldsmith are at work on the island they are looking at; they are never told a count
// (fetchGold), so nothing is ever delivered on their screen.
function goldRunOf() {
  if (!state.goldRun && state.terrain) {
    state.goldRun = createGoldRun({ scene, material: buildingMat, groundAt, onBars: pitBars });
    // /api/gold usually answers before the terrain is there, when showGold had no run to tell
    // and drew the pit itself. Without this the run's first word would be the next `event:
    // gold` - which comes only when the number moves, so the window turning over was taken
    // for a first reading and shown at once, and ?goldrun had no count to play up to.
    if (state.gold) state.goldRun.setGold(goldBarsNow());
  }
  return state.goldRun || null;
}
// ---- the director (web/js/director.js, Plans/DONE/regisseur.md) --------------------------------
// After a while with nobody touching the island, the camera goes to look at something happening
// and follows it. What there is to look at is asked for here, where all of it is to hand; any
// input stops it where it stands.
const ARRIVAL_MS = 90000;
// A settler, an animal or the fisherman is watched from this close; the wagon and the yard from
// the director's own SHOT_DIST.
const CLOSE = 5;
const TIMBER_WORDS = {
  load: 'Timber going onto the wagon at the sawmill',
  out: 'The timber wagon on its way to the shipyard',
  unload: 'Timber coming off the wagon at the shipyard',
  back: 'The timber wagon on its way back to the sawmill',
};
const WORK_WORDS = {
  hammer: 'A settler at work', hoe: 'A settler hoeing the field', weed: 'A settler weeding the garden',
  chop: 'A settler felling a tree', gather: 'A settler gathering wood', fish: 'A settler fishing',
  load: 'A settler loading gold at the pit', haul: 'A settler hauling wood home',
  carry: 'A settler bringing a bar of gold home', barrow: 'A settler off to fetch gold from the pit',
};
const TRADESMEN = [
  ['civic:smithy', 'smithy', 'smith', 'The smith at the anvil'],
  ['civic:bakery', 'baker', 'baker', 'The baker at the oven'],
  ['civic:butcher', 'butcher', 'butcher', 'The butcher at the counter'],
];
const atWork = (v) => !!(v && v.mode === 'work' && v.figure && v.figure.visible);
const figureSpot = new THREE.Vector3();
// Where a villager's rig stands, lifted to about the chest: they hang in their building's group.
function figureAt(fig) {
  fig.getWorldPosition(figureSpot);
  return [figureSpot.x, figureSpot.y + 0.35, figureSpot.z];
}
const CENTRE_EVERY = 120000;
const CENTRE_DIST = 22;
let centreShownAt = -Infinity;
// The middle of the square itself, not the board or the hall at its edge (townCentreScenePos).
function townSquareScenePos() {
  const town = state.village && state.village.island && state.village.island.town;
  if (town && town.centre && state.terrain) return state.terrain.cellWorld(town.centre[0], town.centre[1]);
  return townCentreScenePos();
}
state.arrivals = new Map();
function directorShots() {
  const out = [];
  const now = Date.now(), sea = timeNow();
  const lift = (xz, up = 0.35) => (xz && Number.isFinite(xz[0]) ? [xz[0], groundAt(xz[0], xz[1]) + up, xz[1]] : null);
  // Somebody just arrived: before anything else, for as long as they are still on their way.
  for (const [id, until] of state.arrivals) {
    if (until < now) { state.arrivals.delete(id); continue; }
    out.push({
      key: `arrive:${id}`, first: true, dist: CLOSE, label: 'A new settler arriving',
      where: () => { const f = state.settlers && state.settlers.figure(id); return f && f.visible && Date.now() < until ? lift(f.pos) : null; },
    });
  }
  const gold = state.goldRun;
  if (gold && gold.busy()) out.push({ key: 'gold', weight: 4, dist: CLOSE + 1, label: 'Gold on its way from the mine to the gold pit', where: () => (gold.busy() ? lift(gold.focus()) : null) });
  const timber = state.timberRun;
  if (timber) {
    const w = timber.where(sea);
    if (w && w.stage !== 'parked') {
      out.push({ key: 'timber', weight: 3, label: TIMBER_WORDS[w.stage], where: () => { const x = timber.where(timeNow()); return x && x.stage !== 'parked' ? lift(x.horse, 0.3) : null; } });
    }
    if (timber.handAt(sea)) out.push({ key: 'yard', weight: 2, label: 'Work on the ship at the shipyard', where: () => lift(timber.handAt(timeNow())) });
  }
  // One settler at work, picked now and followed for the whole shot even once they walk on.
  const workers = [];
  if (state.settlers) for (const f of state.settlers.figures().values()) if (f && f.visible && WORK_WORDS[f.anim]) workers.push(f);
  if (workers.length) {
    const f = workers[Math.floor(Math.random() * workers.length)];
    out.push({ key: `work:${f.id}`, weight: 3, dist: CLOSE, label: WORK_WORDS[f.anim], where: () => (f.visible ? lift(f.pos) : null) });
  }
  // The story animals, the goat most of all.
  const hut = state.byId.get('civic:fishery');
  if (hut && hut.fisher && fisherAt(hut.fisher)) out.push({ key: 'fisher', weight: 2, dist: CLOSE, label: 'The fisherman at his hut', where: () => lift(fisherAt(hut.fisher)) });
  // The smith at the anvil and the baker at the oven: the village's own tradesfolk, watched only
  // while at it (`mode` 'work'; in the evening they walk in and the shot goes with them).
  for (const [id, part, key, label] of TRADESMEN) {
    const rec = state.byId.get(id);
    if (rec && atWork(rec[part])) {
      // Watched from the side of the building they work on, so the building is behind them: from
      // wherever the camera happened to be, the smith was once a roof.
      const [fx, , fz] = figureAt(rec[part].figure);
      const az = Math.atan2(fx - rec.group.position.x, fz - rec.group.position.z);
      out.push({ key, weight: 2, dist: CLOSE, az, label, where: () => (atWork(rec[part]) ? figureAt(rec[part].figure) : null) });
    }
  }
  // The goldsmith between two gold runs, at the mould outside the shop - part of the gold run's
  // own cast (goldrun.js), so asked of it rather than of a record.
  const goldsmith = gold && gold.smithAt && gold.smithAt();
  if (goldsmith) {
    const az = Math.atan2(goldsmith.at[0] - goldsmith.shop[0], goldsmith.at[2] - goldsmith.shop[1]);
    out.push({ key: 'goldsmith', weight: 2, dist: CLOSE, az, label: 'The goldsmith at work',
      where: () => { const g = gold.smithAt(); return g ? g.at : null; } });
  }
  // Now and then the town centre, from high enough to take in the square and the ring round
  // it. Always there, so held back for CENTRE_EVERY after each showing - otherwise a quiet island
  // swapped between the square and the whole island, which is not "now and then".
  const centre = townSquareScenePos();
  if (centre && now - centreShownAt > CENTRE_EVERY) {
    out.push({ key: 'centre', weight: 1, dist: CENTRE_DIST, el: 0.75, label: 'The town centre',
      where: () => lift(townSquareScenePos(), 0.5) });
  }
  // Somebody out and about. When not even that is happening (a quiet island at night), the
  // director circles the whole island instead (`overview`).
  const walkers = [];
  if (state.settlers) for (const f of state.settlers.figures().values()) if (f && f.visible && (f.anim === 'walk' || f.anim === 'step')) walkers.push(f);
  if (walkers.length) {
    const f = walkers[Math.floor(Math.random() * walkers.length)];
    out.push({ key: `walk:${f.id}`, weight: 1, dist: CLOSE, label: 'A settler out and about', where: () => (f.visible ? lift(f.pos) : null) });
  }
  return out;
}
// ?director=5 wanders off after five seconds instead of IDLE_S, to try it without waiting.
const directorIdle = Number(params.get('director'));
// The whole island, circled between two shots and whenever nothing is happening.
// Asked every frame while it is on, and islandFrame walks every land cell, so kept per terrain:
// a grown island or a new polder is a new terrain object.
let overviewOf = null, overviewShot = null;
const directorOverview = () => {
  // The hologram's window is square and holds the whole island at its own distance.
  if (state.hologram && state.hologram.overview()) return state.hologram.overview();
  if (!state.terrain) return null;
  if (overviewOf !== state.terrain) {
    const f = islandFrame();
    overviewOf = state.terrain;
    overviewShot = { target: [f.cx, 1, f.cz], dist: f.dist, el: f.el };
  }
  return overviewShot;
};
// The hologram is looked at in passing rather than worked in, so it wanders off sooner.
state.director = createDirector({ sources: directorShots, overview: directorOverview, ...(directorIdle > 0 ? { idleS: directorIdle } : HOLOGRAM ? { idleS: 15 } : {}) });
const directorCaption = document.createElement('div');
directorCaption.id = 'director-caption';
directorCaption.hidden = true;
document.body.appendChild(directorCaption);
// Nothing open, looking from above, the live island, and switched on.
function directorMay() {
  // In the hologram the tray says whether it wanders (hologram.js wanders); otherwise it turns slowly.
  if (state.hologram && !state.hologram.wanders()) return false;
  if (state.mode !== 'orbit' || state.intro || state.tween || document.hidden) return false;
  if (state.ui && state.ui.directorEnabled && !state.ui.directorEnabled()) return false;
  if (state.sysmenu && state.sysmenu.isOpen()) return false;
  return !document.querySelector('aside.panel:not([hidden])');
}
function stepDirector(dt) {
  const pose = state.director.step(dt, directorMay(), { target: controls.target.toArray(), position: camera.position.toArray() });
  if (pose) {
    controls.target.set(...pose.target);
    camera.position.set(...pose.position);
  }
  // Counted from when it is watched, not when it is offered: pickShot asks every candidate's
  // `where` while choosing, so marking it there held the centre back without ever showing it.
  if (state.director.key() === 'centre') centreShownAt = Date.now();
  const words = state.director.caption();
  directorCaption.hidden = !words;
  if (words && directorCaption.textContent !== words) directorCaption.textContent = words;
}
// Any sign of somebody at the island stops it where it stands and starts the count again.
const pokeDirector = () => state.director.poke();
for (const type of ['pointerdown', 'pointermove', 'wheel', 'touchstart']) renderer.domElement.addEventListener(type, pokeDirector, { passive: true });
addEventListener('keydown', pokeDirector, { capture: true });

// The timber run (Plans/DONE/houtkar.md): made once the scene is there, like the gold run. Nothing
// in it is the keeper's, so a visitor gets the same wagon at the same moment.
function syncTimberRun() {
  // A wagon that cannot be drawn must never cost the island its boot: this runs inside
  // applyVillage, and an exception here once left the page on its loading screen.
  try {
    if (!state.timberRun && state.terrain) state.timberRun = createTimberRun({ scene, material: buildingMat, groundAt });
  } catch (err) {
    console.warn('[island] the timber run could not be made', err);
    state.timberRun = null;
  }
  if (!state.timberRun) return;
  try {
    state.timberRun.setSites({
      sawmill: state.byId.get('civic:sawmill') || null,
      yard: state.byId.get('civic:shipyard') || null,
      village: state.village,
      terrain: state.terrain,
    });
  } catch (err) {
    console.warn('[island] the timber run could not be set up', err);
    state.timberRun = null;
    return;
  }
  // ?timber: a departure now rather than within six minutes.
  if (params.has('timber') && !state.timberPlayed) { state.timberPlayed = true; state.timberRun.playNow(timeNow()); }
}
function syncGoldRun() {
  const run = goldRunOf();
  if (!run) return;
  run.setSites({
    mine: state.byId.get(GOLDMINE_ID) || null,
    smith: state.byId.get(GOLDSMITH_ID) || null,
    pit: state.byId.get(GOLDPIT_ID) || null,
    village: state.village,
    terrain: state.terrain,
  });
}







// --------------------------------------------------------------- standing at a board















// --------------------------------------------------------------- stepping inside

// ---- the castle on a Saturday night (Plans/DONE/rave-in-het-kasteel.md) ----
// The hours are shared/daylight.mjs's (RAVE, raveAt), asked of the world's clock like the
// borrel is, so it is the same Saturday night on every screen in the sea. `?rave` opens the
// gate whatever the hour, for trying it on a Tuesday.
const FORCE_RAVE = params.has('rave');
function raveOn() {
  return FORCE_RAVE || raveAt(worldNow().weekday, currentHour());
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





















// --------------------------------------------------------------- sending someone away
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
  if (state.mode === 'plan' || !state.plan) return;
  state.intro = null;
  state.tween = null;
  state.ui.closeOverlays();
  controls.enabled = false;
  state.mode = 'plan';
  state.ui.setPlanning(true);
  if (state.world && state.world.clouds) state.world.clouds.visible = false;
  hamletGroup.visible = false;
  for (const rec of state.byId.values()) if (rec.nameplate) rec.nameplate.group.visible = false;
  if (scene.fog) { planFog = [scene.fog.near, scene.fog.far]; scene.fog.near = 2000; scene.fog.far = 4000; }
  // The fog went to 4000 to show the whole island, so the two cuts go with it. leftPlan puts
  // both back.
  applyObjectDistances();
  state.plan.enter();
  if (!state.plan.active()) leftPlan();     // it refused: an island with no lattice yet
}
function exitPlan() { if (state.mode === 'plan' && state.plan) state.plan.exit(); }
function leftPlan() {
  if (state.mode !== 'plan') return;
  state.mode = 'orbit';
  state.ui.setPlanning(false);
  if (state.world && state.world.clouds) state.world.clouds.visible = true;
  hamletGroup.visible = true;
  for (const rec of state.byId.values()) if (rec.nameplate) rec.nameplate.group.visible = true;
  if (scene.fog && planFog) { scene.fog.near = planFog[0]; scene.fog.far = planFog[1]; planFog = null; }
  controls.enabled = true;
  controls.update();
  applyFogRange();
  // The fog was pushed to 4000 so the planner could see the island whole, and Object and NPC
  // Distance were switched off to match. Both come back here, in the order the fog settled in.
  applyObjectDistances();
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
// The leash also has a ceiling. With the volcano and the starters the archipelago's radius
// is several hundred, and twice that put the eye so far out that the island it orbits fell
// behind the far plane (1400) itself. 1000 still frames the whole ring.
const MAX_ORBIT = 1000;
function applyCameraRange() {
  state.bounds = state.sea.bounds();
  controls.maxDistance = Math.min(MAX_ORBIT, Math.max(200, state.sea.radius() * 2));
}

// ---------------------------------------------------------------- the four distances
// View Distance is the only one that touches the projection, and the fog follows on its own:
// setFogRange caps the haze at `FOG_CAP * camera.far`, so moving the far plane moves the
// horizon without this file having to say anything about the archipelago or the weather -
// and it deliberately does not know how big the world is: a world 4000 across is not a
// reason to draw 4000 of it.
function applyViewDistance() {
  withObjectDistance(state.graphics);
  camera.far = state.graphics.viewDistance + VIEW_MARGIN;
  camera.updateProjectionMatrix();
  // The sun and moon are fog-free discs, so they are the one part of the sky that has to be
  // told: they hang inside the far plane. The dome itself is drawn on it (world.js).
  if (state.world) state.world.setFar(camera.far);
  applyFogRange();
}

// The furthest the haze may close: inside the far plane, and nothing else. Object Distance is
// not the haze's business - it says how far houses, props and boats are drawn, and the two are
// separate sliders: View Distance is what you see, Object Distance is what is put in the picture.
// (It used to cap the haze too, so that a house was always cut in full fog and came out of the
// mist; the price of letting go is that a house cut nearer than the haze now leaves in clear
// air. On the default tiers the haze is closer in than Object Distance, so they never meet.)
function fogCeiling() {
  return camera.far * FOG_CAP;
}
// Object Distance as this frame uses it: the setting, floored from above by the orbit target's
// distance (fade.js objectReachOf), so pulling back never takes away the town being looked at.
// A parked walk is still orbit; only walking is on foot.
// The noclip camera has no target: it floors on its own height over the sea instead, so flying up
// to look at the whole island keeps the town, and low over the ground it is the setting.
function objectReach() {
  const orbit = state.mode === 'orbit' ? camera.position.distanceTo(controls.target)
    : state.mode === 'noclip' ? Math.max(0, camera.position.y) : null;
  return objectReachOf(state.graphics.objectDistance, orbit);
}
// And the furthest fogCeiling can go before the next slider, for what may not be decided per
// frame (the crowd's dither): the floor at the end of the leash, whatever the mode is now.
function widestFogCeiling() {
  return fogCeilingOf(camera.far * FOG_CAP, objectReachOf(state.graphics.objectDistance, controls.maxDistance), state.mode === 'plan');
}

// Object and NPC Distance. The houses need nothing here: the fog closes at Object Distance at
// the latest (fogCeiling), so keepRecord only ever cuts a record the haze has already covered,
// and the building shader stays exactly what it always was - no dither, no depth twin, no
// early depth test given up by every building on the island.
//
// The people are another matter: NPC Distance can lie well inside the haze, and there a
// settler would vanish in clear air. So the crowd's own material dithers over the last fifth
// (web/js/fade.js) while fadeNeeded says a cut could be seen - asked against fogCeiling(), the
// furthest the fog can ever close, not the fog of the moment, which applyFogRange moves with
// every zoom and every change of sky. So this runs when a slider, the window or the planner
// changes, never per frame. The crowd's meshes carry the material's depth twin from the moment
// they are made (settler-figures.js), so a faded settler takes their shadow with them.
//
// The planner draws everything - enterPlan pushes the fog to 4000 so the whole island is
// legible - and a town seen from above with half of it stippled away is worse than no slider
// at all. A range of 0 is how "off" is spelled everywhere in this file.
function applyObjectDistances() {
  const range = npcRange();
  // Against the widest the haze can close, not the fog of this zoom: the orbit floor moves the
  // ceiling out as the camera pulls back, and a dither decided close in would be missing then.
  crowdMat.userData.fade(range, widestFogCeiling());
  // The people are also cut on the CPU, and that one has to be told now: raising NPC Distance
  // puts them back within a frame, not whenever the sea next says where they are.
  const fading = crowdMat.userData.fadeOn;
  if (state.settlers) state.settlers.setRange(range, fading);
}
const npcRange = () => (state.mode === 'plan' ? 0 : state.graphics.npcDistance);

// What the settings panel calls. Four keys, four places, and the only way into all of them -
// the numbers in state.graphics are not written anywhere else, so there is no second path
// that could move one of these without the other three finding out. Remembered per browser,
// the one that moved and not the other three (graphics-settings.js saveGraphic), so the rest
// go on following this machine's defaults.
function onGraphicsSetting(key, value) {
  const v = clampGraphic(key, value);
  if (v == null) return;
  state.graphics[key] = v;
  saveGraphic(key, v);
  applyGraphics(key);
}
function applyGraphics(key = null) {
  if (!key || key === 'viewDistance') applyViewDistance();
  if (!key || key === 'shadowDistance') { if (state.world) state.world.setShadowDistance(state.graphics.shadowDistance); }
  if (key !== 'shadowDistance' && key !== 'detail') applyObjectDistances();
}
function onPostSetting(key, value) {
  const v = clampPost(key, value);
  if (v == null) return;
  savePost(key, v);
  postFx.set({ [key]: v });
}
// Settings → Graphics → "This machine's defaults": every choice forgotten, back to the tier.
function onGraphicsReset() {
  forgetGraphics();
  forgetPost();
  postFx.set(postDefaults({ phone: HANDHELD }));
  Object.assign(state.graphics, GRAPHICS_TIERS[graphicsTier({ modest, phone: HANDHELD })]);
  applyGraphics();
}

// Object Distance, on the CPU: a record past its range is taken out of the render list
// (web/js/record-cull.js keepRecord), so it costs no vertices, no triangles and no shadow, and
// its mill, clock and smoke stop - the frame loop skips animateExtras for it. Only CULL_PAD
// past Object Distance, where the fog (fogCeiling) has already closed over all of it: nothing
// pops on the way out, and on the way back the record is drawn again while it is still the
// colour of the fog, and comes out of it. The eye both it and the crowd's shadow fade measure
// from is the camera, copied once a frame.
const cullEye = new THREE.Vector3();
// Right before the render, once every branch of the frame has put the camera where it will be
// drawn from: taken earlier in the frame it measured from where the camera *was*, and a jump
// of more than the pad in one frame (a tween, a fast zoom) could draw a record a frame late
// or cut one a frame early inside the fog band. The animations read `rec.cull` from the
// frame before, which only ever decides whether a mill in full fog turns.
function cullRecords() {
  cullEye.copy(camera.position);
  setFadeEye(camera.position);
  // Object Distance and nothing else: the haze no longer waits for it (fogCeiling), so a cut
  // nearer than the haze is a house leaving in clear air, which is the slider's own doing.
  const reach = objectReach();
  const range = state.mode === 'plan' || !(reach > 0) ? 0 : reach;
  for (const rec of state.byId.values()) keepRecord(rec, range, cullEye);
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
  let out = 0;
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
  // View Distance past the default lets the haze out with it (hazeOpening): the far end moves
  // towards the far plane, and below the weather's own multiplier, so rain still closes it in.
  const open = state.mode === 'plan' ? 0 : hazeOpening(state.graphics.viewDistance);
  const thick = haze();
  const h = hazeRange({ near: half * 1.1, far: far + (camera.far * FOG_CAP - far) * open, half, out, thick });
  // Near the world's edge the haze closes in, so that whatever lies across it is behind the
  // fog before the jump and after it (wrapEye). Across the edge nothing is nearer than the
  // eye's own way to the edge plus the open water between the far edge and the fleet, and
  // far from the edge that is more than the haze reaches anyway.
  // That cap is a few thousand at most and did not move with View Distance, so it was the
  // wall the haze stopped at however far the slider went; the opening lifts it to the far
  // plane. The price is what it always protected: with the haze fully open, the sea across
  // the edge is empty water until the jump puts the far side of the world there.
  const edge = edgeReach();
  h.far = Math.min(h.far, edge + (camera.far - edge) * open);
  // Never past the far plane: whatever lies beyond it is cut off on a sphere round the eye,
  // and a haze that is still thin there shows that cut as a hard curved edge to the sea.
  // Closed just inside it, the cut is in full fog and the sea runs into the horizon colour.
  // And never past Object Distance, so the houses come out of the mist (fogCeiling).
  fogAt = fogCeiling();
  scene.fog.far = Math.min(h.far, fogAt);
  // The near end follows the far one out by the same opening - hazeRange holds it at four
  // tenths of the far end, which at the slider's end would still be a haze from 2400 out.
  const nearOut = h.near + (scene.fog.far * 0.8 - h.near) * open * Math.min(1, thick);
  scene.fog.near = Math.min(nearOut, scene.fog.far * 0.8);
  // The clouds go on as far as the haze lets anybody see (world.js setCloudReach).
  if (state.world) state.world.setCloudReach(scene.fog.far);
}
// The ceiling setFogRange last closed the haze under. From above it moves with the zoom (the
// orbit floor), so the frame loop asks again whenever it differs - on one island too, which
// otherwise sets the haze only when something changes.
let fogAt = null;

// How far the eye may see before something across the world's edge would come into view:
// its way to the nearest edge, plus the open water between the edge and the fleet on the
// other side. Infinity until there is a berth to measure from.
function edgeReach() {
  const home = state.homeOrigin;
  if (!home) return Infinity;
  const eye = state.mode === 'plan' && state.plan ? state.plan.camera : camera;
  const ex = eye.position.x + home[0], ez = eye.position.z + home[1];
  let fleet = 0;
  for (const r of state.fleet || []) {
    if (!r || !Array.isArray(r.origin)) continue;
    const half = r.reach ?? (r.gridSize || 64) / 2;
    fleet = Math.max(fleet, Math.abs(r.origin[0]) + half, Math.abs(r.origin[1]) + half);
  }
  const toEdge = WORLD_HALF - Math.max(Math.abs(ex), Math.abs(ez));
  return Math.max(120, toEdge + (WORLD_HALF - fleet) - 40);
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
  // And the Salty Kraken's gangway on every island whose Kraken stands in the sea
  // (Plans/kraken-op-zee.md): the dock set's planks from the beach to the foot of its stair, with
  // no head, since it ends at the landing in the bake. Built here because it is the same set, the
  // same frame and the same floor, but kept apart from `state.docks`, which are harbours - a dock is
  // a boat to take and a place on the chart, and a gangway is neither.
  for (const g of state.gangways) g.dispose();
  state.gangways = [];
  for (const region of state.sea.regions()) {
    for (const spec of gangwaysFor(region, region === state.region ? dockVillage : null)) {
      const geo = buildPierGeometry(spec.cells, region.terrain, spec.from, { head: false });
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, buildingMat);
      const parent = region === state.region
        ? scene
        : (state.guests.find((g) => g.region === region) || {}).group || scene;
      mesh.position.set(spec.from[0], 0, spec.from[1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      state.gangways.push({ ...spec, region, mesh, dispose: () => { parent.remove(mesh); geo.dispose(); } });
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




// The Kraken's gangway, if its Kraken stands in the sea (web/js/pirate-ground.js pirateGangway, the
// layout's own sum): `cells` from the shore outwards, the order buildPierGeometry lays a pier in, so
// its ramp comes down on the sand; `from` in the island's own frame, like a dock's; `lip` the
// rectangle at deck height that carries a walker from the last plank onto the landing in the bake.
function gangwaysFor(region, village) {
  const v = village || region.village;
  const t = region.terrain;
  const out = [];
  for (const b of (v && v.buildings) || []) {
    if (!isPirateTavern(b) || !b.plot) continue;
    const g = pirateGangway(b.plot, t);
    if (!g) continue;
    const [x, z] = t.cellWorld(g.cells[0][0], g.cells[0][1]);
    const [dx, dz] = g.dir;
    // The plank's own cell and 0.3 on towards the lot (which is behind `dir`), the deck's width across.
    const ex = dx ? 0.5 + 0.3 : 0.45, ez = dz ? 0.5 + 0.3 : 0.45;
    const lip = { x0: x - ex + (dx < 0 ? 0.3 : 0), x1: x + ex - (dx > 0 ? 0.3 : 0), z0: z - ez + (dz < 0 ? 0.3 : 0), z1: z + ez - (dz > 0 ? 0.3 : 0), y: QUAY_DECK };
    out.push({ id: `gangway:${b.id}`, cells: [...g.cells].reverse(), from: t.cellWorld(g.shore[0], g.shore[1]), lip });
  }
  return out;
}
const pubSig = (v) => JSON.stringify(((v && v.buildings) || []).filter(isPirateTavern).map((b) => b.plot));
const harbourSig = (v) => JSON.stringify((v && v.island && v.island.harbours) || []);


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
    if (wanted.has(b.id)) continue;
    b.craft.dispose();
    state.boats.splice(i, 1);
  }
}

// The sky's letters: O frames the island, L opens the legend, U the planner. Nothing else on
// the island has a key in the distillate - there is nothing to walk, build or open.
const ORBIT_KEYS = { o: 'reset-btn', l: 'legend-btn' };
addEventListener('keydown', (e) => {
  if (state.mode !== 'orbit' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const k = e.key.toLowerCase();
  const chip = keysOf('plan').includes(k) ? 'plan-btn' : ORBIT_KEYS[k];
  if (k !== 'escape' && state.sysmenu && state.sysmenu.isOpen()) return;
  if (chip && !booting()) {
    const b = document.getElementById(chip);
    if (b && !b.hidden) { e.preventDefault(); b.click(); }
  }
});
// The boot screen (ui.js boot) is still standing: `gone` is what boot(true) puts on it.
function booting() {
  const b = document.getElementById('boot');
  return !!b && !b.classList.contains('gone');
}

// Esc, from the sky, with nothing else to close: the menu (web/js/sysmenu.js). Every other
// Escape handler on the page closes its own thing and many of them do not stop the key, so
// "was anything open" is asked in the capture phase, before any of them has run - asked
// afterwards, the Escape that closed the legend would find nothing open and open the menu
// on top of the island it had just handed back. On foot the key keeps the job CLAUDE.md
// gives it (the mouse first, then up into the sky), and the planner steps back through its
// own levels; neither opens a menu.
let escHadWork = false;
function escapeHasWork() {
  return !!document.querySelector('aside.panel:not([hidden])') || state.mode !== 'orbit' || !!state.intro
    || !!document.querySelector('.popover:not([hidden])');
}
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') escHadWork = escapeHasWork();
}, true);
// A chip clicked with the menu open is a choice to go there: the menu gives way first, rather
// than staying on top of the panel or the planner it just opened (Plans/minder-browser-meer-spel.md).
document.getElementById('nav-chips')?.addEventListener('click', (e) => {
  if (e.target.closest('button') && state.sysmenu && state.sysmenu.isOpen()) state.sysmenu.close();
}, true);
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.repeat || !state.sysmenu) return;
  if (state.sysmenu.isOpen()) { e.preventDefault(); state.sysmenu.close(); return; }
  if (escHadWork || e.defaultPrevented) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  state.sysmenu.open();
});


// Every boat an island puts in the water, at the moorings shared/quay.mjs derives - the
// same arithmetic the sea does for lib/boats.mjs and the same every other browser does, so
// an untouched boat is in the same water on every screen without a message being sent
// about it.
//
// The first is the island's own and the rest are what its keeper has built at its harbours
// or its village has earned there (at most three a harbour, Plans/DONE/vier-havens.md and
// Plans/DONE/mijlpalen-tot-tweehonderd.md). None of them is conjured: a boat that
// belongs to nobody cannot also be always to hand, so if somebody has left one on the far
// shore, that is where it is. The same reasoning lib/boats.mjs gives for putting them back
// at their moorings on a restart.
//
// The galleon does not lie at her berth but out from it in deep water (`shipBerth`, in
// shared/quay.mjs now, because lib/layout.mjs keeps the rede clear of where she lies) - and on
// an island with a stone quay, in the big ships' water on the pirates' side (`shipWater`, from
// the island's own `works`, so every page and the layout lay her in the same cell).
function boatsFor(region) {
  const v = region === state.region ? state.village : region.village;
  const out = [];
  for (const m of v ? mooringsFor(region.id, region.terrain, v, region.origin) : []) {
    let b = state.boats.find((x) => x.id === m.id);
    if (!b) {
      const ship = kindOf(m.id) === 'galleon';
      const craft = createBoat({ scene, material: buildingMat, kind: ship ? 'ship' : 'benchy' });
      const at = ship ? shipBerth(m, state.sea.height, shipWater(v.works, region.terrain.half, region.origin || [0, 0])) : m;
      craft.place(at.x, at.z, m.yaw);
      b = { id: m.id, x: at.x, z: at.z, yaw: m.yaw, v: 0, aground: false, craft, deckY: DECK_Y, pilot: null };
      if (ship) { b.berth = { x: m.x, z: m.z }; b.shipAt = at; }
      state.boats.push(b);
    }
    out.push(b);
  }
  return out;
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
  // The distillate's sea holds our island and nobody else's, so a fleet change is only ever
  // ours: the docks and the moored boats are laid again, the haze and the leash follow.
  if (!state.terrain) return;
  buildDocks();
  launchBoats();
  applyFogRange();
  applyCameraRange();
  applyObjectDistances();
  reportPlacements();
}




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

// ---- the ambient animals (web/js/herds.js, Plans/DONE/stal-en-veld.md) -------------------------
// Not the story animals: sheep and cows on the fields, hens by the huts, ducks on the river,
// gulls over the quay - nobody's, placed from what every page has for an island and walked
// by this page alone. One batch of their own for every island (`state.ambientHerds`), a herd
// per island as `state.ambient` and `g.ambient`, made, updated and disposed beside `homeHerd`
// and `g.herd`.
function ambientFor(region, groundAt, fields = null) {
  if (!state.ambientHerds) state.ambientHerds = createHerds({ scene, material: buildingMat });
  return state.ambientHerds.forIsland({ region, groundAt, fields });
}
// What the dossier asks of our own animals as they are drawn now: what each is doing, and
// where, for "Show on the island".

// Where our own people are. Split out of the router because the join case has to be able
// to replay one.
function placeOurs(m) {
  if (!state.settlers || !state.region) return;
  const half = state.region.half;
  const now = performance.now();
  state.settlers.apply(decodeCrowd(m.k, half, decodeCrowd(m.a, half)), now);
  state.settlers.applyRides(decodeRides(m.b, half), now);
}

// Which islands' people this page draws, said to the sea so it sends only those
// (Plans/zee-stuurt-wat-je-ziet.md). Measured on the open sea: a page was sent every crowd in
// the world, 13.4 kB/s, of which it drew one or two islands' worth - a phone at NPC Distance 200
// on one island threw away nine bytes of every ten, on mobile data.
//
// An island is wanted while there is a crowd view for it (ours, or a guest drawn whole -
// DETAILED) and its box is within NPC Distance of the camera - the same flat distance and the
// same eye `beyond` in crowd-view.js cuts people at, so a body is never inside the range while
// its island is not wanted. Past the box: NPC_PAD (the shoulders) and WANT_PAD, for whoever
// is drawn off the island's own grid - a dinghy out on its circle (13 from the berth), a guard
// swimming off the coast. And WANT_HYST more before letting go of an island already wanted, so
// walking along the edge of the reach does not flap it in and out. A range of 0 (the planner)
// draws everybody, so wants every view.
//
// Letting go forgets: the view clears every position it holds (crowd-view.js forget), and
// rows still on their way are dropped in onCrowdMessage, so nothing stale is drawn on the way
// back. Wanting again is answered by the sea with everybody at once (sendCrowd in
// lib/sea.mjs) - the people appear where they are, not on the island's middle, which is where
// a roster stands a body nobody has placed (and why draw() hides those).
//
// Checked every WANT_MS on the frame, against the eye of that frame. A camera that jumps -
// the director's flight, noclip's go() - sees the island's people a round trip after it lands.
const WANT_PAD = 32;
const WANT_HYST = 48;
const WANT_MS = 400;
// What was last said: island id -> the crowd view it was said for, or null before the first
// word (the sea is then sending everything, as to a page from before `want`).
let crowdWant = null;
let wantedAt = -Infinity;
function crowdViews() {
  const out = [];
  if (state.settlers && state.region && state.islandId) out.push({ id: state.islandId, region: state.region, crowd: state.settlers });
  return out;
}
function syncWant(nowMs) {
  if (!state.net || nowMs - wantedAt < WANT_MS) return;
  wantedAt = nowMs;
  const range = npcRange();
  const eye = camera.position;
  const views = crowdViews();
  const next = new Map();
  for (const v of views) {
    const [x, z] = v.region.origin;
    const half = v.region.half;
    const dx = Math.max(0, Math.abs(eye.x - x) - half);
    const dz = Math.max(0, Math.abs(eye.z - z) - half);
    const reach = range + NPC_PAD + WANT_PAD + (crowdWant && crowdWant.has(v.id) ? WANT_HYST : 0);
    if (!range || dx * dx + dz * dz <= reach * reach) next.set(v.id, v.crowd);
  }
  // A view made again under an id already wanted - a reseed, a guest raised anew - holds no
  // positions, so it is let go of and wanted again: two messages, and the sea sends that
  // island whole. Rare, and otherwise its people stood undrawn until their slices came round.
  const fresh = crowdWant ? [...next].filter(([id, crowd]) => crowdWant.has(id) && crowdWant.get(id) !== crowd).map(([id]) => id) : [];
  const same = crowdWant && !fresh.length && next.size === crowdWant.size && [...next.keys()].every((id) => crowdWant.has(id));
  if (same) return;
  for (const v of views) if (!next.has(v.id) && (!crowdWant || crowdWant.has(v.id))) v.crowd.forget();
  const ids = [...next.keys()].sort();
  if (fresh.length) state.net.want(ids.filter((id) => !fresh.includes(id)));
  state.net.want(ids);
  crowdWant = next;
}


// Somebody else's settlers. The wire format is shared/settlerwire.mjs and the drawing is
// web/js/crowd-view.js; this only routes.
// Our settlers, off our own sea. The wire format is shared/settlerwire.mjs and the drawing is
// web/js/crowd-view.js; this only routes - and only ours, because nobody else is in this sea.
function onCrowdMessage(m) {
  if (!state.islandId || m.island !== state.islandId) return;
  if (m.kind === 'roster') { ourRoster(m.ids); return; }
  // Who is being spoken to (the sea's own conversations - a keeper and a passer-by).
  if (m.kind === 'held') {
    state.homeHeld = m.h;
    if (state.settlers && state.region) state.settlers.held(decodeHeld(m.h, state.region.half));
    return;
  }
  // Rows already on their way after we let go of the island (syncWant): only the boats count.
  if (crowdWant && !crowdWant.has(m.island)) {
    if (state.settlers && state.region) {
      state.settlers.applyRides(decodeRides(m.b, state.region.half), performance.now());
      state.settlers.forget();
    }
    return;
  }
  // Held rather than dropped while the roster is being translated (ourRoster).
  if (namingIds) { heldWhere = m; return; }
  placeOurs(m);
}




// The sea talking about its fleet: a welcome carrying the whole list, or one island
// arriving, going quiet or going home.
// The sea talking about its fleet - which in the distillate is our island alone - and its clock.
function onFleetNews(world, one, clock) {
  // The world's own clock, kept as a skew so it survives this tab sleeping for an hour.
  if (clock && Number.isFinite(clock.now)) {
    state.seaSkewMs = clock.now - Date.now();
    if (Number.isFinite(clock.tz)) state.seaTz = clock.tz;
    state.seaShiftMs = Number.isFinite(clock.shift) ? clock.shift : 0;
  }
  if (world) { state.fleet = world.islands || []; rehomeFrom(state.fleet); syncFleet(state.fleet); return; }
  if (!one || one.a === 'parcel' || one.a === 'codex') return;
  const { t, a, ...row } = one;
  const rows = (state.fleet || []).filter((r) => r.id !== one.id);
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
  // Our own sea raises no volcano, so our island is at [0, 0] and the page needs no translation.
  // Kept as the island's page keeps it, so a berth anywhere else is still drawn right.
  const home = state.homeOrigin;
  if (home && origin[0] === home[0] && origin[1] === home[1]) return false;
  state.homeOrigin = [origin[0], origin[1]];
  for (const b of state.boats) b.track = null;
  return true;
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


// --------------------------------------------------------------- records
// Where a building stands on its plot and which way it looks: the yard nudge, the loosened
// building line (house-placement.js) and the ground under it. One function because the
// planner draws a ghost of a building on a plot it does not stand on yet (`ghostPose`, for
// web/js/plan-mode.js), and a ghost worked out by a second copy of this would stand a hand's
// breadth from where the building then turns up.
// The shipyard and the Salty Kraken are the two buildings not stood on the middle of their plot:
// the yard's is over the sea, and it stands on the land at its landward end (shipyardGround in
// web/js/shipyard.js); the Kraken's rises from the beach, and its rock stands on the lowest point
// of its front so that the stair's foot meets the sand (pirateTavernGround, web/js/pirate-ground.js).
function poseOnPlot(spec, built) {
  // A ship floats: the middle of her plot, on the sea and not on the bed under her
  // (web/js/batavia.js, the one copy guest-island.js asks too).
  if (built.floats) return floatingPose(spec.plot, state.terrain.half, built.bbox);
  const nudge = yardNudge(spec, built);
  const pose = housePlacement(spec, built.bbox, state.village.buildings);
  const [x, z] = cellCentre(spec.plot).map((v, i) => v + nudge[i] + (i ? pose.z : pose.x));
  const y = isShipyard(spec) ? shipyardGround(spec.plot, [x, z], groundAt)
    : isPirateTavern(spec) ? pirateTavernGround(spec.plot, [x, z], groundAt, built, state.terrain) : groundAt(x, z);
  return { x, y, z, yaw: pose.yaw };
}
function ghostPose(id, plot) {
  const rec = state.byId.get(id);
  return rec && plot ? poseOnPlot({ ...rec.spec, plot }, rec.built) : null;
}

function makeRecord(spec) {
  const group = new THREE.Group();
  // Built before it is set down, because where a shed goes on its cell depends on how
  // wide the shed came out - see yardNudge. `modest` goes in with it: a dormer and a
  // turret are luxuries drawn three hundred times over, and buildings.js leaves them off
  // when the card cannot afford them.
  const built = buildBuilding(spec, { modest });
  const pose = poseOnPlot(spec, built);
  const { x, z } = pose;
  let y = pose.y;
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

  // The body goes into the island's batch (record-batch.js), and what hangs here is its
  // stand-in: an empty Object3D whose visibility and matrix the batch copies every render.
  // `rec.mesh` stays the name for it, because the Batavia's swell moves it and hangs her flags
  // on it, and the planner reads where it stands. The geometry itself is the batch's now.
  const mesh = homeBatch.add(built.geometry);
  built.geometry = null;
  mesh.userData.id = spec.id;
  group.add(mesh);
  scene.add(group);

  const rec = {
    id: spec.id, spec, group, mesh, built, visible: true, scaffold: null,
    flagIdx: -1, blades: null, beacon: null, clock: null, fountain: null,
    flame: null, fire: null, smokeT: 0,
  };
  attachExtras(rec);
  if (spec.active) addScaffold(rec);
  state.byId.set(spec.id, rec);
  return rec;
}

// `gold` follows `mail` unless it is said: a guest island's records come through here with
// the mail off, and the count its pit would show is OUR five-hour window.
function attachExtras(rec, { mail = true, signs = true, gold = mail, found = null } = {}) {
  const { spec, built, group } = rec;
  // The count on the treasure statue's plaque: our island's `village.treasure.found` (kept up to
  // date by applyVillage), and for a guest island's statue what the caller read off that
  // island's own village. One plane and one texture, so a neighbour's costs nothing worth a flag.
  if (spec.civicType === 'treasure' && built.anchors && built.anchors.sign) {
    const n = found ?? (mail && state.village && state.village.treasure ? state.village.treasure.found : 0);
    rec.plaque = attachPlaque(group, built.anchors.sign, n);
  }
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
  // The two trades (web/js/sawmill.js, web/js/smithy.js): what turns, pumps and walks there is
  // hung on the record's own group, so the plot's rotation is already theirs and yaw stays 0.
  // The smithy brings a light for its fire - one per island, so a neighbour with a smithy
  // costs one more light, which is a recompile when it arrives and not a price every frame.
  if (built.animated && built.animated.sawmill) {
    rec.sawmill = attachSawmill(group, built.animated.sawmill.at, buildingMat);
  }
  if (built.animated && built.animated.smithy) {
    rec.smithy = attachSmithy(group, built.animated.smithy.at, buildingMat);
  }
  // The Salty Kraken's hanging sign (web/js/piratesign.js): its board and lantern swing on the
  // sea's clock, so every screen has them at the same angle.
  if (built.animated && built.animated.piratesign && built.anchors && built.anchors.sign) {
    rec.pirateSign = attachPirateSign(group, buildingMat, { at: built.anchors.sign, yaw: built.animated.piratesign.yaw });
  }
  // And its flags, sails and hanging lanterns in the wind (web/js/kraken-motion.js), on the same clock.
  if (built.animated && built.animated.krakenMotion) rec.krakenMotion = attachKrakenMotion(group, buildingMat, { hd: false });
  // The Batavia (web/js/batavia.js): her swell goes on her own mesh rather than on the group,
  // whose position and turn blockersOf reads, and her flags hang on that mesh and lean with her.
  if (built.animated && built.animated.ship) {
    rec.ship = attachBatavia(rec.mesh, spec.id, buildingMat);
  }
  // The stable (a trade) and the bakery (a shop of the square), the same way. The stable's horse and hens are scenery out of
  // web/js/fauna.js moving on their own clock, like the bees - not story animals, which are
  // the sea's and web/js/animal-view.js's. The bakery brings its oven's light, as the smithy
  // does, and its baker (web/js/bakery-keeper.js), the smith's kind of passive settler.
  if (built.animated && built.animated.stable) {
    rec.stable = attachStable(group, built.animated.stable.at, buildingMat);
  }
  if (built.animated && built.animated.bakery) {
    rec.bakery = attachBakery(group, built.animated.bakery.at, buildingMat);
    rec.baker = attachBaker(group, built.animated.bakery.at, buildingMat);
  }
  // The butcher's (Plans/DONE/slagerij.md), a shop of the town's plan with something alive in it:
  // his awning, his hanging meat and his smokehouse (web/js/butcher.js).
  if (built.animated && built.animated.butcher) {
    rec.butcher = attachButcher(group, built.animated.butcher.at, buildingMat);
  }
  // The fisherman at the fisherman's hut (web/js/fisher.js, Plans/DONE/regisseur.md). Our own island
  // only: he finds the water's edge off the ground this page walks on, and a guest's hut stands
  // on a region whose ground is not `groundAt`'s.
  if (mail && spec.civicType === 'fishery') rec.fisher = attachFisher(group, buildingMat, groundAt, spec.harbour && spec.plot?.quay ? HARBOUR_DECK : null);
  // The quarry's treadwheel crane and its tub (Plans/DONE/ambachten.md, web/js/quarry.js), hung on the
  // record's group like the sawmill's blade. The brewery's copper steams from an anchor of its
  // own beside the chimney's smoke.
  if (built.animated && built.animated.quarry) {
    rec.quarry = attachQuarry(group, built.animated.quarry.at, buildingMat);
  }
  if (built.animated && built.animated.steam) rec.steamAnchor = built.animated.steam.at;
  // A guest island's town hall gets no postbox flag. The count it would raise is OUR unread
  // mail, and hanging that on somebody else's wall is both wrong and a small leak.
  if (mail && built.animated && built.animated.mailflag) {
    rec.mailFlag = attachMailFlag(group, built.animated.mailflag.at, buildingMat);
    setMailFlag(rec.mailFlag, false);
  }
  // The gold in the pit (web/js/goldpit.js): as many bars as the keeper's window has left on
  // our own island, and a full pit on anybody else's - see showGold.
  if (built.animated && built.animated.goldpile) {
    rec.goldPile = attachGoldPile(group, built.animated.goldpile.at, buildingMat);
    // What the run is showing if one is under way - a pit rebuilt mid-delivery keeps counting
    // from where it was, not from the number the barrow has not brought yet.
    const shown = state.goldRun ? state.goldRun.bars() : null;
    rec.goldPile.setBars(gold ? (shown ?? goldBarsNow()) : GOLD_BARS);
    if (!gold) rec.goldPile.foreign = true;
  }
  // The ore in the gold mine's bin (web/js/goldmine.js): the keeper's week on our island, and a
  // full bin on anybody else's, like the pit.
  if (built.animated && built.animated.orepile && built.animated.orepile.at) {
    rec.orePile = attachOrePile(group, built.animated.orepile.at);
    rec.orePile.setOre(gold ? oreNow() : MINE_ORE);
    if (!gold) rec.orePile.foreign = true;
  }
  // The goldsmith's furnace (web/js/goldsmith.js), which the gold run lights.
  if (built.animated && built.animated.goldsmith) rec.furnace = attachFurnace(group, built.animated.goldsmith.at, buildingMat);
  // And the clock over the office door, at the hour the pit is full again. Ours only, like
  // the count: on anybody else's pit it hangs there with no hands - see attachResetClock.
  if (built.animated && built.animated.resetclock) {
    const rc = built.animated.resetclock;
    rec.resetClock = attachResetClock(group, rc.at, buildingMat, rc.r);
    rec.resetClock.foreign = !gold;
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
  // Its frame into the island's batch with the buildings (nameplate.js): 395 signs on
  // Hoogezand were a call each in both passes. The lettered face stays a mesh of its own.
  const plate = createNameplate(rec.sign.text, { ...rec.sign.opts, batch: homeBatch });
  plate.group.position.set(...rec.sign.at);
  plate.group.rotation.y = rec.sign.turn;
  rec.group.add(plate.group);
  rec.nameplate = plate;
}
function countFires() { let n = 0; for (const r of state.byId.values()) if (r.fire) n++; return n; }

function disposeRecord(rec) {
  // Its body out of the batch; the range it held is compacted away when room runs short.
  homeBatch.remove(rec.mesh);
  // Everything attachExtras hung on it, from the one list guest-island.js also lowers by.
  disposeExtras(rec);
  scene.remove(rec.group);
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
  const terrain = makeTerrain(village.island.seed, { size: village.grid.size, polders: village.polders, fairway: village.fairway || null, works: village.works || null, grow: village.grow || null, open: !!village.island.open });
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
  // The relief of the sea floor is one field in the world's frame, and this archipelago speaks
  // the page's own (home at the origin): told where home is, so two pages berthed apart put a
  // bank in the same place. The default, [0, 0], is a host at the sea's origin.
  state.sea.setBedHome(state.homeOrigin || [0, 0]);
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
  // as the beacon's silhouette in the haze. Plans/DONE/wie-joint-ziet-de-host-als-mist.md.
  state.region = state.sea.add(placeIsland(terrain, { id: 'home', origin: [0, 0] }));
  state.region.village = village;
  state.world = createWorld(scene, terrain, village, {
    month: worldNow().month,
    // A phone's GPU runs out of fill before anything else, and its screen is small enough
    // that 512 texels over the shadow box still reads as a shadow.
    shadowSize: HANDHELD && modest ? 512 : modest ? 1024 : 2048,
    // The two graphics distances that are a property of the world rather than of this frame.
    // View Distance never comes here - it is the camera's own far plane - and the two cuts
    // are not here either: both are read every frame, not fixed when the world is built.
    shadowDistance: state.graphics.shadowDistance,
    modest,
    // So the water is laid over everything there is, not over this island alone.
    sea: state.sea,
  });


  // The far plane and the haze, once, before anything is drawn. createWorld made the Fog
  // object with the island's own numbers; this is the call that puts View Distance's far
  // plane (1250 + 150 by default) in front of it, and the fog closes itself inside that.
  // Nothing after this moves camera.far except onGraphicsSetting, which is the point.
  applyViewDistance();










  // The sky over the whole world, before the haze is measured: applyFogRange asks it what
  // it is doing. Built here rather than at boot because it borrows world.js's clouds, dome
  // and lights instead of drawing a second set, and thrown away with the scene on a reseed.
  if (state.sky) state.sky.dispose();
  state.sky = createWeather({
    scene, world: state.world, camera, onHaze: applyFogRange,
    // Planning looks straight down too: a box of rain from the planner's camera is a curtain.
    fromSky: () => state.mode === 'orbit' || state.mode === 'plan',
  });
  // The fog object arrives with the world; the distances are ours, and they are set here
  // rather than on the first neighbour sync so that no frame is ever drawn without them.
  applyFogRange();
  applyCameraRange();
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
    scene, material: crowdMat, region: state.region,
    buildings: village.buildings || [],
    // The eye and the range, because NPC Distance is about people. crowdMat is the building
    // shader with its own uniform, so the people can dither out at their own distance while
    // the houses go on into the fog.
    eye: () => camera.position,
    range: npcRange(),
    fading: crowdMat.userData.fadeOn,
  });
  // The last roster the sea sent, if it arrived before this scene existed - at boot it
  // always does, and after a reseed it is the scene that was rebuilt, not the island.
  // Without this nobody is drawn until the next time the village changes.
  if (state.homeRoster) state.settlers.roster(state.homeRoster);
  if (state.homeHeld) state.settlers.held(decodeHeld(state.homeHeld, state.region.half));
  // Now that there is a crowd to cut and a fog to cut it inside of. At the defaults this
  // decides the dither stays out of both shaders, which is the answer for a page that has
  // never touched a slider.
  applyObjectDistances();
  // And the ambient ones, walked here: on our own fields off this page's survey, and
  // re-planned by the herd itself whenever state.region's village or terrain is replaced.
  if (state.ambient) state.ambient.dispose();
  state.ambient = ambientFor(() => state.region,
    (x, z) => (homeStand ? homeStand(x, z) : state.region.worldHeight(x, z)),
    () => (state.world && state.world.workSites ? state.world.workSites().fields : null));
  syncBridges(village);
  state.particles = createParticles();
  // Both are born at the boot pixel ratio's size, and a ?quality pin was applied in boot()
  // before either existed - so its lighter ratio found nothing to scale.
  scalePoints();
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
  if (state.hologram) state.hologram.setWorld(state.world, terrain);
}

// ---- bridges ---------------------------------------------------------------
// A crossing is built once and recorded in the layout, so it is drawn the way the quay's
// planks are: keyed by id, added when it first appears, never rebuilt. `decks` is where
// every deck cell is and how high it rides, which is what lets a settler walk over a
// river instead of through it.
const bridgeGroup = new THREE.Group();
const bridgeMeshes = new Map();
let decks = new Map();
// The same crossings as the planks are drawn, for walk mode's feet (buildings.js bridgeDeckOf):
// `decks` gives a height per cell, which is right for the settlers and a staircase to a walker.
let bridgeShapes = [];
let bridgeCells = new Set();

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
  bridgeShapes = [];
  for (const [i, b] of list.entries()) {
    const key = `${b.id}#${i}`;
    for (const [gx, gz, y] of bridgeDeckHeights(b.cells, terrain, b.axis)) {
      decks.set(gx + gz * terrain.size, y);
    }
    const shape = bridgeDeckOf(b.cells, terrain, b.axis);
    if (shape) bridgeShapes.push(shape);
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
  // What walk mode stands on as the drawn planks instead: the cells the crossings carried out to,
  // less the quay's boardwalk, which wins a cell the two share (as it does in `decks`).
  bridgeCells = new Set();
  for (const s of bridgeShapes) for (const [gx, gz] of s.cells) bridgeCells.add(gx + gz * terrain.size);
  for (const [cell] of quayDeckHeights(village, terrain.size)) bridgeCells.delete(cell);
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
  for (const d of [...state.docks, ...state.gangways]) {
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
// The decks of this island - bridges, laid and built by hand, and the quay - by `gx + gz * size`, as
// handOutDecks last made them. What the route's dots ride on: at terrain height they went under the
// planks of a bridge and the way over it looked like the way through the river.
let deckHeights = null;

function handOutDecks() {
  // Nobody walks here but the settlers, so what the island's page hands walk mode is gone and
  // what is left is theirs: every deck on this island by its plain `gx + gz * size` cell - the
  // bridges and the quay's and the Kraken's planks - for the height they are drawn standing at.
  const flat = new Map(decks);
  for (const d of [...state.docks, ...state.gangways]) {
    if (state.region && d.region !== state.region) continue;
    for (const [gx, gz] of d.cells) flat.set(gx + gz * d.region.size, QUAY_DECK);
  }
  deckHeights = flat;
  // A bridge going up or coming down opens or closes a way into a hamlet: its sign, and the
  // gap in the fence.
  if (state.village && state.terrain && hamletGroup.parent) syncHamlets(state.village);
  homeStand = state.terrain && state.region && state.region.village
    ? createStandHeight(state.terrain, state.region.village, flat)
    : null;
}

// A hamlet's name, on a board beside its entrance, and the quay's planks. A lone farmstead gets
// neither: it is one house in the countryside, not a place with a name.
const hamletGroup = new THREE.Group();
const hamletSigns = new Map();

function titleCaseName(s) {
  return String(s || '').split(/[\s_]+/).filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
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

// The cells of the bridges built by hand: none in the distillate, which builds nothing by hand.
function bridgeRoadCells() {
  return [];
}

function syncHamlets(village) {
  if (!hamletGroup.parent) scene.add(hamletGroup);
  const terrain = state.terrain;
  const live = new Set();
  const bridges = bridgeRoadCells();
  const opened = [];              // cells the boundary fence is open at besides where a road crosses it
  const signSite = hamletSignSites(village, terrain, bridges);

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
      // The quay's resort on the sea brings its raft and its parasols into the same geometry
      // (resort-dressing.js: worked out from the deck and the houses, nothing on the wire).
      const dressing = d.kind === 'quay' ? resortDressing(d, village.buildings, terrain, village.paths) : null;
      const sig = d.deck.map((c) => `${c[0]},${c[1]}`).join(';') + (dressing ? `|${JSON.stringify(dressing)}` : '');
      const have = hamletSigns.get(key);
      if (have?.sig !== sig) {
        if (have) { hamletGroup.remove(have.group); have.dispose(); hamletSigns.delete(key); }
        const [px, pz] = terrain.cellWorld(d.center[0], d.center[1]);
        const g = buildDeckGeometry(d.deck, terrain, [px, pz], resortParts(dressing, terrain, [px, pz], groundAt));
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
    // One gateway per entrance: where a road crosses the edge of the hamlet's land, at most
    // one per side of the compass (hamletEntrances says which, and how many a place this big
    // has). The hamlet's aerial caption goes up once (captionCell in web/js/captions.js); on
    // foot you meet the arch at each way in, and with more than one it says which.
    for (const gate of hamletEntrances(village, d, bridges)) {
      // A gate the keeper set opens the fence where it stands, road or no road yet.
      if (gate.fixed) opened.push(gate.at, gate.next);
      const key = `${d.id}#${gate.side}`;
      const site = signSite(gate);
      if (!site) continue;
      live.add(key);
      const { gx, gz, turn } = site;
      // `fx`/`fz`: half a cell along the road, which is the fence's own line.
      const [cx, cz] = terrain.cellWorld(gx, gz);
      const sx = cx + (site.fx || 0), sz = cz + (site.fz || 0);
      const have = hamletSigns.get(key);
      if (have && have.text === d.name && have.label === gate.label) {
        have.group.rotation.y = turn;
        have.group.position.set(sx, groundAt(sx, sz), sz);
        continue;
      }
      if (have) { hamletGroup.remove(have.group); have.dispose(); }
      const sign = createNameplate(titleCaseName(d.name), {
        width: 2.1, height: gate.label ? 0.8 : 0.62, canvasW: 768, band: d.hue, height0: 1.35, posts: 2, arch: 2.2,
        sub: gate.label, subBack: gate.back,
      });
      // Face whoever walks in, with both posts on the cells beside the road.
      sign.group.rotation.y = turn;
      sign.group.position.set(sx, groundAt(sx, sz), sz);
      sign.group.userData.id = `district:${d.id}`;
      hamletGroup.add(sign.group);
      hamletSigns.set(key, { ...sign, text: d.name, label: gate.label, popped: !have });
    }
  }
  // The fence opens for a bridge built by hand and for a gate the keeper set, like for a road.
  if (state.world && state.world.setBridgeRoads) state.world.setBridgeRoads([...bridges, ...opened]);
  for (const [key, rec] of [...hamletSigns]) {
    if (live.has(key)) continue;
    hamletGroup.remove(rec.group);
    rec.dispose();
    hamletSigns.delete(key);
  }
}

// Where the whole island is seen from: the opening sweep's end (frameIsland) and the director's
// overview between two shots.
function islandFrame() {
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
  return { cx, cz, dist, el: 0.72 };
}
// `glide`: fly there over OVERVIEW_S through the same tween focusOn uses, instead of cutting.
// The Overview chip (and O) glides; the boot and the intro's fallbacks still cut, because
// they are setting a camera nobody has seen yet.
const OVERVIEW_S = 1.2;
function frameIsland({ glide = false } = {}) {
  const { cx, cz, dist } = islandFrame();
  const az = 0.6, el = 0.72;
  const target = new THREE.Vector3(cx, 1, cz);
  const pos = new THREE.Vector3(
    cx + Math.cos(el) * Math.sin(az) * dist,
    1 + Math.sin(el) * dist,
    cz + Math.cos(el) * Math.cos(az) * dist,
  );
  if (glide) {
    state.tween = { t: 0, dur: OVERVIEW_S, from: controls.target.clone(), to: target, fromPos: camera.position.clone(), toPos: pos };
  } else {
    controls.target.copy(target);
    camera.position.copy(pos);
    controls.update();
  }
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


// A house whose settler has gone (a tent packing up, somebody sent away) shrinks into the ground.
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
    // The earthworks are drawn on every day, like `grow`: they mend what a ring broke rather
    // than being a rung of the ladder (web/js/history.js dates only the polders and the fairway).
    const next = makeTerrain(v.island.seed, { size: v.grid.size, polders: v.polders.slice(0, shot.polders), fairway: shownFairway, works: v.works || null, grow: v.grow || null });
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

// What the heightfield is made of, as one string: the polders' three lists, the channel, the
// layout's earthworks (whole: a new funnel or dig changes the ground) and the growth.
// Compared between two villages to know whether the ground has to be built again.
const groundSig = (v) => JSON.stringify([(v.polders || []).map((p) => [p.cells, p.pools, p.dike]), v.fairway ? v.fairway.cells : null, v.works || null, v.grow || null]);

function applyLandscape(force = false) {
  if (!state.world || !state.village) return;
  const shot = projectVillage(state.village, NaN);
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
    // Nobody lives in a civic building, except the two who keep one (KEEPERS in
    // shared/palette.mjs): the innkeeper and the mayor stand at the door of theirs.
    if (state.settlers) state.settlers.setVisible(rec.id, ok && (rec.spec.kind !== 'civic' || !!keeperOf(rec.spec)));
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
function addScaffold(rec) { attachScaffold(rec, buildingMat); }
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
  // A chest dug up changes the plaque's number and nothing else about the village, so the
  // statue's record is not rebuilt for it; it is told.
  for (const rec of state.byId.values()) if (rec.plaque) setPlaque(rec.plaque, next.treasure ? next.treasure.found : 0);

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
  // And the Kraken's gangway, which comes and goes with where it stands.
  else if (prev && pubSig(next) !== pubSig(prev)) buildDocks(next);
  // The ground itself, when the polders or the channel changed under it - a polder the
  // keeper dug or gave back. Before the buildings below, because a house set down on new
  // land is built at the height of the terrain it finds. `shownPolders` is a count and a
  // plan can give one polder back and dig another in the same Apply, so it is forgotten
  // rather than trusted.
  if (prev && groundSig(prev) !== groundSig(next)) {
    shownPolders = null;
    shownKey = null;
    applyLandscape(true);
  }
  syncSquareBed(next);
  syncBorrelTables(next);

  const events = [];
  // Room in the batch for whoever is new, before they are built: the first village is every
  // house on the island, and growing the batch as it fills would copy its buffer five times.
  let arriving = 0;
  for (const [id, spec] of nextSpecs) if (spec.plot && !state.byId.has(id)) arriving++;
  homeBatch.reserve(arriving);
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
      || JSON.stringify(before.sheds || []) !== JSON.stringify(spec.sheds || [])
      // The ship on the yard's slipway, one stage further (web/js/shipyard.js): a refit, so the
      // yard is built again where it stands with a puff of dust rather than a scaffold.
      || (before.stage ?? 0) !== (spec.stage ?? 0);
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

  // Anyone no longer in the village has left: a visitor who finished, a tent nobody gave
  // anything to do (lib/village.mjs), or someone sent away. Take their building out of the
  // scene rather than leaving a ghost standing.
  for (const [id, rec] of [...state.byId]) {
    if (nextSpecs.has(id)) continue;
    if (animate && rec.group.visible) leaveAnimation(rec);
    setTimeout(() => { if (!specById(state.village).has(id)) disposeRecord(rec); }, animate ? 1000 : 0);
    state.byId.delete(id);
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

  // Where the mine, the goldsmith and the pit now stand, and the roads between them.
  syncGoldRun();
  // And the sawmill and the yard, for the timber wagon and the yard's crew (timberrun.js).
  syncTimberRun();

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
  // And where the work is: the fields, the kitchen gardens and the edge of the wood, which
  // only this page's own survey knows - the sea sends idle settlers out to them
  // (Plans/DONE/inwoners-aan-het-werk.md).
  const work = state.world && state.world.workSites ? state.world.workSites() : null;
  const key = JSON.stringify([at, decks, work]);
  if (key === toldPlacements) return;
  toldPlacements = key;
  mine('/api/placements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ at, decks, work }),
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
    // Somebody new: the director goes to watch them walk up for the next ARRIVAL_MS.
    state.arrivals.set(rec.spec.id, Date.now() + ARRIVAL_MS);
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
  // A house on the resort (Plans/quay-op-zee.md) is sailed to its own front deck, out at sea -
  // the harbour's planks are the quay's, and a settler coming ashore there would walk off
  // through the town to a house they had just sailed past.
  const own = rec.spec.plot?.quay && rec.spec.door;
  const end = own || district.pier[district.pier.length - 1];
  if (!end) { await popIn(rec); return; }
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
}
function humanSince(msv) {
  const m = Math.round(msv / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// --------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let pointerScreen = { x: 0, y: 0 }, downAt = null, moved = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (state.mode === 'plan') return;   // the planner has the pointer (web/js/plan-mode.js)
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointerScreen = { x: e.clientX, y: e.clientY };
  if (downAt) moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
});
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; moved = 0; });
// Nothing on the island answers a click in the distillate: it is there to be looked at. A
// press only ends the hover's pause, so a drag of the camera is not taken for a pick.
renderer.domElement.addEventListener('pointerup', () => { downAt = null; });
// The last ray hit that landed on a person rather than on a building, so the label can
// follow them down the street instead of sitting on the roof they came from.
let pickedFigure = null;
// Testing several hundred instanced people costs real time, and past this distance
// they are a couple of pixels anyway, so only look for them once the camera is close.
const PEOPLE_PICK_RANGE = 42;

function pick() {
  ray.setFromCamera(pointer, camera);
  // The houses are one pickable, the batch, whose raycast skips every house it did not draw
  // last frame - filtered out, not yet popped in, or past Object Distance - which is what the
  // `parent.visible` test did for a house of its own. pickedId reads which house was hit.
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
  return b ? pickedId(b) : null;
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
      recovery.frame(nowMs, document.visibilityState === 'visible');
      const rung = quality.frame(nowMs, document.visibilityState === 'visible');
      if (rung) applyQuality(rung);
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
  frameSeconds = nowMs / 1000;
  if (renderStats) renderStats.begin(nowMs);

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
    // The flight in moves the camera without the controls, so it hands the shadow frustum
    // its own distance or the island lands in a shadowless picture.
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
    // The clouds and the swell run on the sea's clock and in the sea's frame.
    state.world.setSeaHome(state.homeOrigin);
    state.world.update(dt, hour, month, { t: Date.now() + (state.seaSkewMs || 0), moon: calendar.moon });
    // Straight after it: the weather multiplies what the hour has just set.
    if (state.sky) state.sky.update(dt, month);
    buildingMat.userData.uniforms.uNight.value = state.world.state.night;
    if (state.flags) state.flags.material.userData.uniforms.uTime.value = nowMs / 1000;
  }
  if (state.settlers) {
    // A break, or the Friday borrel: the sea sends the village to the square, and the tables
    // come out for exactly the minutes the people are there.
    const gathering = gatheringAt(calendar.weekday, hour);
    if (state.borrel) {
      state.borrel.show(gathering ? tableSetsFor(state.village && state.village.stats && state.village.stats.settlers) : 0);
    }
    // Our own people, off the wire, at the height the sea walked them to.
    state.settlers.draw(dt, homeStand || ((x, z) => state.region.worldHeight(x, z)), nowMs, true);
    if (state.ambient) state.ambient.update(dt, { showing: true, eye: camera.position });
  }
  syncWant(nowMs);
  if (state.particles) state.particles.update(dt);
  if (state.waitingFlags) state.waitingFlags.tick(nowMs / 1000, state.world ? state.world.state.night : 0);

  // The moored boats bob; nobody sails them here.
  for (const b of state.boats) {
    b.craft.place(b.x, b.z, b.yaw);
    b.craft.bob(nowMs / 1000);
    b.deckY = b.craft.deck ? b.craft.deck() : DECK_Y;
    if (state.hologram) b.craft.object.visible = state.hologram.afloat(state.sea.height(b.x, b.z));
  }

  // per-building animated bits, for whatever the cut has left drawn
  const nightAmt = state.world ? state.world.state.night : 0;
  for (const rec of state.byId.values()) if (!rec.cull) animateExtras(rec, dt, hour, nightAmt, nowMs);
  if (state.goldRun) state.goldRun.update(dt);
  if (state.timberRun) {
    try { state.timberRun.update(dt, timeNow()); } catch (err) {
      console.warn('[island] the timber run stopped', err);
      state.timberRun = null;
    }
  }

  const eye = state.mode === 'plan' && state.plan ? state.plan.camera : camera;
  if (state.world) state.world.recentre(eye.position.x, eye.position.y, eye.position.z);
  if (state.world) state.world.setWaterFocus(controls.target.x, controls.target.z);
  if (state.mode !== 'plan' && fogCeiling() !== fogAt) applyFogRange();

  if (!state.intro && state.mode === 'orbit') {
    stepDirector(dt);
    controls.update();
    const y = state.sea.height(camera.position.x, camera.position.z) + 0.9;
    if (camera.position.y < y) camera.position.y = y;
    const b = state.bounds;
    controls.target.x = clamp(controls.target.x, b.minX - 3, b.maxX + 3);
    controls.target.z = clamp(controls.target.z, b.minZ - 3, b.maxZ + 3);
    if (state.world) state.world.followShadow(controls.target.x, controls.target.z, camera.position.distanceTo(controls.target));
  } else if (state.mode === 'plan' && state.plan) {
    state.plan.update(dt);
    if (state.world) state.world.followShadow(state.plan.view.cx, state.plan.view.cz, state.plan.view.hh * 2);
  }

  if (state.mode === 'orbit') updateLabels();
  state.ui.setClock(hour, state.world ? state.world.season() : calendar.season, {
    lens: state.hourOverride != null, host: false, shifted: !!state.seaShiftMs,
  });
  if (shadowEvery > 1 && ++shadowFrame >= shadowEvery) { shadowFrame = 0; renderer.shadowMap.needsUpdate = true; }
  if (!renderer.shadowMap.autoUpdate && !renderer.shadowMap.needsUpdate) renderer.info.render.frame++;
  if (state.hologram) state.hologram.frame(dt);
  cullRecords();
  // The hologram's canvas is see-through, which the post composer's targets are not.
  if (state.hologram) { renderer.render(scene, eye); holoHit(); }
  else postFx.render(scene, eye, { room: false });
  if (renderStats) {
    const s = renderStats.end(performance.now());
    statsReadout.textContent = `${modest ? 'modest' : 'standard'} · ${quality.rung().name}${quality.auto() ? '' : ' (fixed)'} · ${statsLine(s)} · ${state.particles?.count() ?? 0} particles`;
  }
}

// In the hologram's window (hologram/main.cjs) a click on bare desktop must reach the desktop: the
// window is told, every frame, whether the pixel under the pointer is island or nothing. Read
// straight after the render, while the drawing buffer still holds the frame. Never mid-drag, or a
// turn of the island would let go of it the moment the pointer crossed the sea.
let holoInside = null;
let holoDown = false;
addEventListener('pointerdown', () => { holoDown = true; }, true);
addEventListener('pointerup', () => { holoDown = false; }, true);
const holoPixel = new Uint8Array(4);
function holoHit() {
  if (!window.holo || holoDown) return;
  const gl = renderer.getContext();
  const r = renderer.getPixelRatio();
  const x = Math.floor(pointerScreen.x * r), y = Math.floor((innerHeight - pointerScreen.y) * r);
  if (x < 0 || y < 0 || x >= gl.drawingBufferWidth || y >= gl.drawingBufferHeight) return;
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, holoPixel);
  const inside = holoPixel[3] > 8;
  if (inside !== holoInside) { holoInside = inside; window.holo.setIgnore(!inside); }
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
    // A keeper shares the building's id, so without this the mayor would be labelled
    // "Promptholm Town Hall" - named for what they keep, with the building underneath.
    const keeper = keeperOf(spec);
    projected.set(who.pos[0], (who.y || 0) + 0.62, who.pos[1]).project(camera);
    if (projected.z <= 1) {
      hoverItem = {
        name: keeper ? keeper.name : spec.name,
        sub: keeper ? spec.name : labelSub(spec),
        x: (projected.x + 1) / 2 * innerWidth,
        y: (1 - projected.y) / 2 * innerHeight,
      };
    }
  }
  state.ui.labels(items);
  state.ui.hamletLabels(hamletCaptions());
  state.ui.setHover(hoverItem);
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

// --------------------------------------------------------------- boot




async function boot() {
  state.ui = createUI({
    onFilters: (f) => { state.filters = f; applyVisibility(); },
    // The graphics sliders in Settings, the only way into state.graphics.
    onGraphicsSetting,
    onGraphicsReset,
    onPostSetting,
    post: () => postFx.get(),
    graphics: () => state.graphics,
    onOverview: () => {
      if (state.mode === 'plan') { state.plan.frameIsland(); return; }
      state.intro = null; controls.enabled = true; frameIsland({ glide: true });
    },
    onTogglePlan: () => (state.mode === 'plan' ? exitPlan() : enterPlan()),
    onFocus: (id) => focusOn(id),
    // ui.js is the island's own and wires every control it has; in the distillate these lead
    // nowhere (the chips are hidden, nothing opens a dossier), but a call must not throw.
    ...Object.fromEntries(['onSelect', 'onToggleMap', 'onToggleWalk', 'onTalk', 'onSpeed', 'onSigns',
      'onSendAway', 'onSeaMode', 'onJoinSea', 'onForgetSea', 'onScrub', 'onPlay', 'onLive', 'onMarket',
      'onFoundSettler', 'onDismissWait', 'onCustomize', 'onBuild', 'onWalkHere', 'onIslandSize',
      'onHomeMove', 'onHdDir', 'onSettingsOpen'].map((k) => [k, () => {}])),
    buildLabel: () => {
      const b = state.build;
      const said = b ? [b.version, b.commit].filter(Boolean).join(' · ') : '';
      return said ? `Promptholm (destillaat) ${said}` : 'Promptholm (destillaat)';
    },
    onQualityAuto: (on) => {
      if (params.has('quality')) return;
      const rung = quality.setAuto(on);
      if (rung) applyQuality(rung);
    },
  });
  state.sysmenu = state.ui.sysmenu;
  if (params.has('quality')) applyQuality(quality.pin(Number(params.get('quality'))));
  else if (!state.ui.qualityAutoEnabled()) quality.setAuto(false);

  // The distillate always has its islander: it is the server that served this page.
  try {
    const hello = await mine('/api/hello').then((r) => r.json());
    useSea(hello.sea);
    state.islandId = hello.islandId || null;
    state.build = hello.build || null;
    await learnTheWorld();
    state.guest = false;
    state.signs = hello.signs !== false;
    state.signMode = hello.display ? hello.display.nameplates : null;
    state.ui.setKeeper(true);
    state.ui.setSigns(state.signMode);
    setVisiting(false);
  } catch {
    state.signs = true;
    state.ui.setKeeper(true);
  }

  let village;
  try {
    village = await fetchVillage();
  } catch (e) {
    state.ui.boot(false, 'The island could not be reached. Is the server running?');
    console.error(e);
    return;
  }
  state.ui.boot(false, 'Raising the island…');
  state.hologram = createHologram({ renderer, scene, controls, camera, dom: renderer.domElement });
  buildScene(village);
  // Our own sea, on loopback: the clock, the sky and the settlers, nothing else.
  state.net = createWatchNet({
    url: () => seaSocket(),
    join: () => ({ island: state.islandId || null, key: null }),
    onWorld: onFleetNews,
    onCrowd: onCrowdMessage,
    onWeather: setSky,
  });
  // The planner, after the world so its overlay can measure the ground. Everything it reads is
  // a getter, because the terrain and the village are both replaced under it by later scans.
  state.plan = createPlanMode({
    dom: renderer.domElement,
    terrain: () => state.terrain, village: () => state.village, byId: () => state.byId, bridges: bridgeRoadCells,
    pickables: () => state.pickables, bounds: () => state.bounds, ghostPose,
    overlay: createPlanOverlay({
      scene, terrain: () => state.terrain, village: () => state.village, byId: () => state.byId,
      shapeOf: (rec) => homeBatch.positionsOf(rec.mesh),
    }),
    panel: createPlanPanel({
      onTool: (t) => state.plan.setTool(t), onOverview: () => state.plan.frameIsland(), onDone: () => exitPlan(),
      onUndo: () => state.plan.undo(), onRedo: () => state.plan.redo(), onClear: () => state.plan.clear(),
      onApply: () => state.plan.apply(), onRestore: () => state.plan.restore(),
      onGrow: () => state.plan.grow(), onTurn: () => state.plan.turn(), onMerge: () => state.plan.merge(),
    }),
    toast: (html) => state.ui.toast(html),
    onExit: () => leftPlan(),
  });
  applyVillage(village, { animate: false });
  // No menu to choose a sea from: straight into the flight over the island - except in the
  // hologram, which has framed itself on the land (hologram.js setWorld).
  if (!HOLOGRAM) startIntro();
  state.ui.boot(true);
  requestAnimationFrame(tick);
  connect();
}







function connect() {
  let es;
  const open = () => {
    es = new EventSource(mineUrl('/events'));
    // The island grew (or the planner moved it): the scan wrote a new village.json.
    es.addEventListener('update', debounce(async () => {
      try {
        const next = await fetchVillage();
        if (state.village && next.generatedAt <= state.village.generatedAt) return;
        applyVillage(next, { animate: true });
      } catch (e) { console.warn('update failed', e); }
    }, 250));
    es.addEventListener('open', () => state.ui.setLive('live'));
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



// a handle for poking at the island from the console
// Everything on one building that moves. Split out of the tick so that our island and a
// guest island are animated by one piece of code rather than two that drift apart.
function animateExtras(rec, dt, hour, nightAmt, nowMs) {
  if (!rec.group.visible) return;
  if (rec.blades) rec.blades.rotation.z += dt * 0.55;
  if (rec.clock) updateClock(rec.clock, hour);
  // Real time, not `hour`: the refill is a fact about now, whatever the chronicle is showing.
  if (rec.resetClock) updateResetClock(rec.resetClock, rec.resetClock.foreign || state.guest ? null : state.gold, Date.now());
  if (rec.fountain) updateFountain(rec.fountain, dt);
  if (rec.sawmill) updateSawmill(rec.sawmill, dt);
  if (rec.smithy) updateSmithy(rec.smithy, dt);
  if (rec.pirateSign) updatePirateSign(rec.pirateSign, timeNow() / 1000, nightAmt);
  if (rec.krakenMotion) updateKrakenMotion(rec.krakenMotion, timeNow() / 1000);
  if (rec.furnace) rec.furnace.update(dt);
  if (rec.orePile) rec.orePile.update(dt);
  if (rec.ship) updateBatavia(rec.ship, dt);
  // Saturday night the paddock is empty: its horse and hens are at the rave (stableComes).
  if (rec.stable) updateStable(rec.stable, dt, { away: raveOn() });
  if (rec.bakery) updateBakery(rec.bakery, dt);
  if (rec.baker) updateBaker(rec.baker, dt);
  if (rec.butcher) updateButcher(rec.butcher, dt);
  if (rec.fisher) updateFisher(rec.fisher, dt);
  if (rec.quarry) updateQuarry(rec.quarry, dt);
  if (rec.mailFlag) updateMailFlag(rec.mailFlag, dt);
  if (rec.beacon) updateBeacon(rec.beacon, dt, nightAmt);
  if (rec.flame) {
    const s = 1 + 0.16 * Math.sin(nowMs / 1000 * 17 + rec.id.length);
    rec.flame.scale.set(s, 1 + 0.22 * Math.sin(nowMs / 1000 * 13), s);
    if (rec.fire) rec.fire.intensity = 2.4 * (0.85 + 0.15 * Math.sin(nowMs / 1000 * 23));
  }
  const civicFire = rec.spec.civicType === 'tavern' || rec.spec.civicType === 'townhall'
    // The Salty Kraken's hearth, lit whenever the pirates are in, which is always.
    || rec.spec.civicType === 'piratetavern'
    || rec.spec.civicType === 'smithy' || rec.spec.civicType === 'sawmill'
    // An oven and a brazier that are lit all day, like the smithy's fire.
    || rec.spec.civicType === 'bakery' || rec.spec.civicType === 'cauldron'
    // And the fisherman's smokehouse, whose fish are smoked all day (Plans/DONE/havengebouwen.md),
    // and the fire under the brewery's copper (Plans/DONE/ambachten.md).
    || rec.spec.civicType === 'fishery' || rec.spec.civicType === 'brewery';
  if (rec.smokeAnchor && (rec.spec.active || civicFire)
    && rec.group.position.distanceToSquared(camera.position) < 120 * 120) {
    rec.smokeT += dt;
    if (rec.smokeT > (rec.spec.active ? 0.34 : nightAmt > 0.5 ? 0.7 : 1.1)) {
      rec.smokeT = 0;
      const v = new THREE.Vector3(...rec.smokeAnchor).applyMatrix4(rec.group.matrixWorld);
      state.particles.smoke([v.x, v.y, v.z]);
    }
  }
  // The copper's steam, off the same particles and at twice the chimney's rate: a brew boils
  // all day. `|| 0` because a guest island's records are not made by makeRecord.
  if (rec.steamAnchor && rec.group.position.distanceToSquared(camera.position) < 120 * 120) {
    rec.steamT = (rec.steamT || 0) + dt;
    if (rec.steamT > 0.5) {
      rec.steamT = 0;
      const v = new THREE.Vector3(...rec.steamAnchor).applyMatrix4(rec.group.matrixWorld);
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
  applyFogRange, applyCameraRange, enterPlan, exitPlan, quality,
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fitFov();
  renderer.setSize(innerWidth, innerHeight, false);
  if (state.plan) state.plan.resize();
  if (state.hologram) state.hologram.resize();
  scalePoints();
});

boot();


