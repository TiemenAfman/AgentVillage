// Walking the island on foot. A third-person camera behind a settler you steer with
// WASD, terrain underfoot, buildings you cannot walk through, and a prompt when you
// come close to something you can interact with.
import { quayBasin } from 'shared/quay-basin.mjs';
import * as THREE from 'three';
import { figureGeometry } from './settlers.js';
import { box, cylinder, cone, sphere, WALK_BODY_R as BODY_R, WALK_CLEARANCE } from './buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';
import { loadAvatar, PLAYER_EYE } from './avatar.js';
import { createClassicAvatar } from './classic-avatar.js';
import { stepBoat, DECK_Y } from './boat.js';

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.6;
const TURN_LERP = 0.18;
const CAM_BACK = 2.7;
const CAM_UP = 1.6;
// Eye level, asked of the figure instead of written down here. This is the height the
// third-person camera looks at, so a wrong number tilts the whole frame: it used to be a
// flat 0.9, which the comments defended as head height for a settler "about 1.1 units
// tall". The settler you steer stands 0.54 - a plain settler is 0.48 and the player 1.12
// of that - so 0.9 aimed two thirds of a body above the crown, and since lookAt puts its
// target at the centre of the screen, the figure sank into the bottom third of the frame
// and sat behind the walking HUD.
const EYE = PLAYER_EYE;
// The settler you steer stands 0.54 units tall, and this jump peaks at about 0.38 - two
// thirds of its own height, which clears a doorstep and a low fence without turning the
// island into a platform game. Gravity is tuned to that arc rather than to reality: it
// puts the player back on the ground in about half a second.
const JUMP_V = 3.1;
const GRAVITY = 12.5;
// Wading, not open-water swimming: the shore has to stay within reach, so you can stand
// in the surf and cross a stream but you cannot set out to sea. The sea surface is y = 0,
// matching the water plane in world.js, and the body sits a little way into it.
const SWIM_SPEED = 1.9;
const SWIM_REACH = 2.0;
const WATER_Y = 0;
const SWIM_SINK = 0.07;
// C crouches. Keep holding it while standing still and the settler decides the day is
// over, lies down and puts up a parasol - so the countdown only runs while you are not
// moving, or a crouch-walk would end in a nap.
//
// It used to be Ctrl, which read well until you crouched and walked: that is ctrl+W, and
// Chrome closes the tab on it without letting the page object. A letter has no such owner.
const CROUCH_SCALE = 0.62;
const CROUCH_SPEED = 1.7;
const LIE_AFTER_MS = 2000;
// Where the camera looks once the settler is flat out: the reclining figure only stands
// about 0.18 clear of the towel, so a fifth of standing eye level is halfway up it.
const LIE_AIM = 0.22;
// Walking away is how you get off a seat, but you almost always sit down while still holding
// the key that walked you up to it: without a moment's grace the same press that sat you down
// stood you straight back up, and it looked as though the stools could not be sat on at all.
const SIT_HOLD_MS = 400;
// A seated settler is this much of a standing one. Named because the camera needs it too:
// the body folds down by this factor, so the eye the camera aims at folds with it.
const SIT_SCALE = 0.74;
// How much room a settler needs over their feet. The same figure the buildings measure
// themselves against, so a gap you can walk under is a gap you can walk under.
const HEAD = WALK_CLEARANCE;
// The keys the feet use. Lifted out of onKeyDown because a board being worked hands
// every other key to the page and keeps only these.
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
// The letters and digits the browser pairs with ctrl (save, print, find, bookmark, view
// source, open, history, downloads, address bar, reload, bold; new tab/window, close, tab
// <n>). Cancelled on foot - see onKeyDown - and locked in fullscreen - see lockKeys().
const BROWSER_KEYS = new Set([...'sptfduohjklegrbwn123456789', 'tab']);

// A field on a board takes its letters. In here w is a w, not a step, so the feet keep
// out of it entirely - which is the whole of "type quit and you plant a tree".
function typingInto(el) {
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const PROBE = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return [Math.cos(a) * SWIM_REACH, Math.sin(a) * SWIM_REACH];
});

// Everyone else walking the island is a settler with a satchel and a wide hat, built
// from this so you can pick them out of a crowd: the visitors and neighbours (see
// peers.js) are made of the same kit as the settlers, and the hat and satchel are what
// say "this one is somebody". The one you steer is the exception - it is composed by
// hand in avatar.js - but it still wears the satchel this puts on.
export function playerGeometry(style = 'sonnet') {
  const base = figureGeometry(style);
  base.deleteAttribute('normal');   // the kit parts carry none; normals come after the merge
  const parts = [
    base,
    box(0.16, 0.13, 0.07, 0x8a5a34, { x: 0.11, y: 0.14, z: -0.03, ry: 0.3 }),   // satchel
    cylinder(0.008, 0.008, 0.24, 4, 0x5a3c28, { x: 0.04, y: 0.1, z: -0.02, rz: 0.5 }),
    cylinder(0.17, 0.17, 0.018, 10, 0xc9a75c, { y: 0.4 }),                       // hat brim
    sphere(0.075, 0xc9a75c, { y: 0.415 }),
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  g.scale(1.12, 1.12, 1.12);
  return g;
}

// A striped towel and a parasol, for when the settler has had enough of the island.
// Sized off the figure, which is 0.55 tall and 0.4 across: lying down it is 0.55 long,
// so the towel runs along z with the head end at -z, which is where the lying pose puts
// it and where the parasol is planted.
function loungeGeometry() {
  const parts = [
    box(0.52, 0.03, 0.86, 0xf5efe0, { z: -0.25 }),               // the towel
    box(0.52, 0.04, 0.1, 0xc86b4a, { z: -0.06 }),                // its stripes, running across
    box(0.52, 0.04, 0.1, 0xc86b4a, { z: -0.46 }),
    cylinder(0.014, 0.017, 0.66, 6, 0x5a3c28, { z: -0.82 }),     // the pole, beyond the head
    cone(0.38, 0.15, 12, 0xd94f3d, { y: 0.58, z: -0.82 }),       // the canopy
    cone(0.29, 0.06, 12, 0xf5efe0, { y: 0.56, z: -0.82 }),       // a pale underside
    sphere(0.026, 0xd9a33d, { y: 0.74, z: -0.82 }),              // the finial
  ];
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// The camera sits this far behind the shoulder out on the island, where there is room for
// it, so both distances are options with the island's values as the default: a room indoors
// has a ceiling and four walls and wants it closer in.
//
// `clampCam` gets the camera position just before it is aimed, which is the one moment a
// room can pull it back inside its own walls and still have it looking at the right thing.
// Hold it off a wall any later and it ends up on top of the very thing it is aiming at,
// where `lookAt` has no direction left to choose and the whole view flips over.
//
// `camAim` is how high up the figure the camera looks, and `lookAt` puts that point in the
// middle of the screen - so out here it is the settler's own eye level, which is what keeps
// the whole figure in the middle of the frame and clear of the HUD along the bottom. The
// look down from above comes from `camUp` holding the camera well over its head, not from
// aiming past it. Under a ceiling the aim comes down to the chest, because a room wants the
// camera low and a low camera aiming at eye level is looking at the rafters.
export function createWalkMode({
  scene, camera, terrain, ground = null, material, dom, avatar: avatarSpec,
  camBack = CAM_BACK, camUp = CAM_UP, camAim = EYE, clampCam = null,
}) {
  // What is underfoot, and which cell of which island a surface belongs to.
  //
  // `terrain` is one island: local, origin-centred, and all a room or the workbench ever
  // needs - see the flat floor interior.js hands in. `ground` is an archipelago
  // (shared/regions.mjs): it answers in world coordinates, it says OPEN_SEA between islands
  // rather than handing back the nearest coast the way a single terrain's own clamp does,
  // and its level key carries a per-island stride. That stride is the point: two islands of
  // the same size produce identical `gx + gz*size` keys, so without it a bridge on one
  // island is a deck in mid-air on the other.
  //
  // Given a `ground` it wins; without one nothing changes at all, which is why interior.js
  // and demo.js are untouched.
  const heightUnder = ground
    ? (x, z) => ground.height(x, z)
    : (x, z) => terrain.worldHeight(x, z);
  const cellKey = ground
    ? (x, z) => ground.levelKey(x, z)
    : (x, z) => Math.round(x + terrain.half - 0.5) + Math.round(z + terrain.half - 0.5) * terrain.size;
  // Used to hold this and the rigged Kenney character below one parent, whichever was
  // selected; only the original figure remains, but movement, collisions and the camera
  // still address it through this same group.
  const avatar = new THREE.Group();
  let avatarLook = avatarSpec || loadAvatar();
  const classicAvatar = createClassicAvatar(avatarLook, material);
  avatar.add(classicAvatar.object);
  // Yaw first, then the swimmer's pitch about its own axis. The default XYZ order would
  // tip the body in world space and then spin it. With x = 0 both orders agree, so the
  // walk animation is untouched.
  avatar.rotation.order = 'YXZ';
  avatar.castShadow = true;
  avatar.visible = false;
  scene.add(avatar);

  const lounge = new THREE.Mesh(loungeGeometry(), material);
  lounge.castShadow = true;
  lounge.receiveShadow = true;
  lounge.visible = false;
  scene.add(lounge);

  const keys = new Set();
  const state = {
    active: false,
    pos: new THREE.Vector3(),
    yaw: 0,          // where the player faces
    camYaw: 0,       // where the camera looks from
    camPitch: 0.28,
    bob: 0,
    vy: 0,           // vertical speed; zero whenever the feet are down
    grounded: true,
    // The surface you are standing on, held for the whole of a jump. Which floor you
    // belong to has to be decided when you leave the ground and not recomputed as you
    // rise, or a swimmer under a bridge would climb into reach of the deck halfway up
    // and land on top of the thing they were swimming under.
    floor: 0,
    swimming: false,
    crouching: false,
    lying: false,
    // Where you are sitting, or null. A seat carries its own height, so a bar stool holds
    // you above the floor rather than sinking you into it.
    sitting: null,
    crouchSince: 0,
    blockers: [],
    // The other people, kept apart from the buildings on purpose: the building list is
    // only rebuilt when the village data changes, while this one moves every frame.
    peerBlockers: [],
    interactables: [],
    near: null,
    onInteract: null,
    onSendAway: null,
    onPlant: null,
    onNextSeed: null,
    onPrevSeed: null,
    onBuild: null,
    onAvatar: null,
    onExit: null,
    // The board you are standing at and working, or null. While one is held the page on
    // it owns the keyboard and the mouse; only the keys that walk you away are still the
    // island's. See setWorking.
    working: null,
    onRelease: null,
    moving: false,
    running: false,
    blocking: false, // the right mouse button is down: the shield arm is up
    paused: false,   // true while an overlay owns the input
  };

  // Letting go of C ends a crouch, but not a nap: once the settler is down they stay
  // down, so the key can be released. Getting up is moving, or pressing C again.
  function releaseCrouch() {
    state.crouching = false;
    if (!state.lying) state.crouchSince = 0;
  }
  function standUp() {
    state.crouching = false;
    state.lying = false;
    state.sitting = null;
    state.crouchSince = 0;
  }

  // Jumping and crouching live here rather than in the key handler because the controller
  // does both as well, and two copies of "only from the ground" would drift apart.
  function jump() {
    if (state.sitting) { standUp(); return; }   // stand before you jump, not off the stool
    if (state.grounded && !state.swimming) { state.vy = JUMP_V; state.grounded = false; }
  }
  function crouchToggle() {
    if (state.lying) standUp();                 // pressing it again is how you get up
    else if (!state.crouching) { state.crouching = true; state.crouchSince = performance.now(); }
  }

  // Take a seat: a stool, a bench, the edge of a table. The same shape as lying down - a
  // pose held until you walk out of it - except that it is entered deliberately, so
  // nothing counts down to it and the seat says how high you end up.
  function sitOn({ x, z, y, yaw = 0 }) {
    state.crouching = false;
    state.lying = false;
    state.crouchSince = 0;
    state.sitting = { x, z, y: y != null ? y : groundAt(x, z, state.pos.y), yaw, since: performance.now() };
    state.pos.set(x, state.sitting.y, z);
    keys.clear();                            // whatever walked you here is not walking you off
    state.vy = 0;
    state.grounded = true;
    state.swimming = false;
    state.yaw = yaw;
  }

  const onKeyDown = (e) => {
    if (!state.active || state.paused) return;   // the board has the keyboard
    const k = e.key.toLowerCase();
    // A key with ctrl, meta or alt on it is not a game key - which also covers AltGr on a
    // Dutch layout, where it arrives as ctrl+alt. But on foot the browser's own shortcuts
    // are a hazard (ctrl+S next to the walking keys, ctrl+P beside the sowing one), so the
    // ones a page is allowed to cancel are cancelled here, unless somebody is typing into
    // a field. Chrome reserves ctrl+W, ctrl+T, ctrl+N and ctrl+<digit> and ignores
    // preventDefault on them: those only come to the page under the keyboard lock that
    // lockKeys() asks for, and only in fullscreen.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typingInto(e.target) && BROWSER_KEYS.has(k)) e.preventDefault();
      return;
    }
    // A board being worked has the keyboard. Escape hands it back wherever the focus is,
    // and the feet keep their own keys so that walking away is still a way out - except
    // inside a field, where those keys are letters somebody is typing.
    if (state.working) {
      if (k === 'escape') { e.preventDefault(); release(); return; }
      if (!typingInto(e.target) && MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
      return;
    }
    if (MOVE_KEYS.includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
    // Only from the ground, so holding space does not climb the sky.
    if (k === ' ') { e.preventDefault(); jump(); }
    // Not on a repeat: crouchToggle() is a toggle, and the OS keeps sending keydown for
    // 'c' the whole time it is held. Without this, holding C past LIE_AFTER_MS meant the
    // very next repeat found the settler just lain down and stood them straight back up
    // (crouchToggle's own "press it again to get up"), and the repeat after that started
    // the crouch over - an infinite loop that never spent a rendered frame lying down,
    // reachable only by physically releasing and re-pressing the key.
    if (k === 'c' && !e.repeat) { e.preventDefault(); crouchToggle(); }
    if (k === 'e' && state.near) { e.preventDefault(); state.onInteract && state.onInteract(state.near); }
    if (k === 'x' && state.near) { e.preventDefault(); state.onSendAway && state.onSendAway(state.near); }
    // Sowing is the same kind of thing: it happens where the feet are, not at a door.
    if (k === 'p') { e.preventDefault(); state.onPlant && state.onPlant(); }
    if (k === 'q') { e.preventDefault(); state.onNextSeed && state.onNextSeed(); }
    // The catalogue. Like a thought, it is about wherever you happen to be standing, so
    // it needs nothing within reach.
    if (k === 'b') { e.preventDefault(); state.onBuild && state.onBuild(); }
    // The wardrobe, same door the Avatar chip opens. Like Build, whoever is standing here
    // rather than something with the keyboard.
    if (k === 'i') { e.preventDefault(); state.onAvatar && state.onAvatar(); }
    // The radar: on by default, M cycles it to the chart of the sea and then to neither.
    if (k === 'm') { e.preventDefault(); state.onToggleMinimap && state.onToggleMinimap(); }
    // The first Escape only frees the mouse (the browser ends the lock itself); the next one
    // leaves walk mode.
    if (k === 'escape') {
      e.preventDefault();
      if (document.pointerLockElement === dom || performance.now() - unlockedAt < 300) return;
      state.onExit && state.onExit();
    }
  };
  const onKeyUp = (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === 'c') releaseCrouch();
  };
  // A keyup that never arrives - the window losing focus with C held - would leave the
  // settler crouched for good, so anything that takes the keyboard away ends the crouch.
  // A nap survives it, the same as it survives letting go of the key.
  const onBlur = () => releaseCrouch();
  addEventListener('blur', onBlur);
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);

  // Mouse look is a pointer lock, taken as you step onto the island and held for as long as
  // nothing needs a cursor: a panel (setPaused) or a board (setWorking) gives it back, and
  // closing or walking away from them takes it again - see syncLock. Escape is the browser's
  // own way out of a lock and costs nothing but the lock; a single click on the island takes
  // it back. It used to wait for a double click, which nobody found.
  //
  // Where a lock is refused outright (an embedded webview, a page without the permission)
  // the old drag-to-look is still there, which is also what a press does while the lock is
  // on its way. The buttons themselves fight (Plans/aanvallen-en-blokkeren.md): the right one
  // blocks for as long as it is held and never looks; the left one attacks - on the press
  // under a lock, and otherwise on a click that did not turn into a drag. The one click that
  // takes the lock does not also swing.
  let dragging = false, lastX = 0, lastY = 0, pressX = 0, pressY = 0, pressMoved = false, pressLocks = false;
  const CLICK_PX = 6;
  let lockRefused = !dom.requestPointerLock;
  // A click that asked for the lock and was turned down anyway. Some hosts refuse every
  // request with a WrongDocumentError (the desktop app's browser pane does, measured) and
  // that same error is also what an unfocused window gets, so it cannot mean "never" - but
  // after one refused click the next ones swing again, or the left button would do nothing
  // at all there. A lock that does arrive puts this back.
  let clickLockFailed = false;
  // Not with the arms already busy: swimming, lying down or sitting.
  const canFight = () => state.active && !state.paused && !state.working && !state.swimming && !state.lying && !state.sitting;
  const wantLock = () => state.active && !state.paused && !state.working && !lockRefused;
  function requestLock(fromClick = false) {
    if (document.pointerLockElement === dom) return;
    // A request without a user gesture is refused, except straight after a lock the page
    // itself let go of - which is exactly the close-a-panel and walk-off-a-board case. The
    // refusal is a rejected promise in current Chrome; only NotSupportedError means never.
    try {
      dom.requestPointerLock()?.catch?.((err) => {
        if (err?.name === 'NotSupportedError') lockRefused = true;
        else if (fromClick) clickLockFailed = true;
      });
    } catch { lockRefused = true; }
  }
  function syncLock() {
    if (wantLock()) requestLock();
    else if (document.pointerLockElement === dom) document.exitPointerLock?.();
  }
  // When the lock went away, so the Escape that took it does not also leave walk mode: the
  // keydown can reach the page either side of the pointerlockchange that says it is gone.
  let unlockedAt = -Infinity;
  const onLockChange = () => {
    if (document.pointerLockElement === dom) clickLockFailed = false;
    else unlockedAt = performance.now();
  };
  document.addEventListener('pointerlockchange', onLockChange);
  const onDown = (e) => {
    if (!state.active) return;
    if (e.button === 2) { if (canFight()) state.blocking = true; return; }
    if (e.button !== 0) return;
    if (document.pointerLockElement === dom) { if (canFight()) classicAvatar.attack(); return; }
    pressLocks = wantLock() && !clickLockFailed;
    if (wantLock()) requestLock(true);
    dragging = true; pressMoved = false;
    lastX = pressX = e.clientX; lastY = pressY = e.clientY;
  };
  const onUp = (e) => {
    if (e.button === 2) { state.blocking = false; return; }
    if (e.button !== 0) return;
    if (dragging && !pressMoved && !pressLocks && canFight()) classicAvatar.attack();
    dragging = false; pressLocks = false;
  };
  const onMove = (e) => {
    if (!state.active) return;
    const locked = document.pointerLockElement === dom;
    let dx = 0, dy = 0;
    if (locked) { dx = e.movementX; dy = e.movementY; } else if (dragging) { dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
    if (dragging && !pressMoved && Math.hypot(e.clientX - pressX, e.clientY - pressY) > CLICK_PX) pressMoved = true;
    if (!dx && !dy) return;
    state.camYaw -= dx * 0.0042;
    state.camPitch = clamp(state.camPitch + dy * 0.0032, -0.25, 0.95);
  };
  // The wheel pulls the camera in and pushes it out, the same as it does from the sky. It
  // listens on the canvas and not the window, and gives up while an overlay owns the input,
  // so scrolling a panel of text never also zooms the island behind it.
  let back = camBack;
  const onWheel = (e) => {
    if (!state.active || state.paused) return;
    e.preventDefault();
    back = clamp(back * Math.exp(clamp(e.deltaY, -240, 240) * 0.0016), camBack * 0.35, camBack * 2.2);
  };
  dom.addEventListener('wheel', onWheel, { passive: false });

  dom.addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);
  addEventListener('pointermove', onMove);

  // Under a keyboard lock the browser hands the page even the shortcuts it otherwise keeps
  // for itself (ctrl+W closes the tab whatever a page says) - but only in fullscreen, which
  // is what makes the Fullscreen button the place where the island stops losing tabs. Asked
  // for on entering walk mode and given back on leaving it; the browser applies it whenever
  // the page is fullscreen in between. Escape is deliberately not in the list: locking it
  // turns leaving fullscreen into press-and-hold, and Escape already has a job here.
  const LOCKED_CODES = [...'WTNRSPFDUOHJKLEGB'].map((c) => 'Key' + c)
    .concat('Tab', ...Array.from({ length: 9 }, (_, i) => 'Digit' + (i + 1)));
  function lockKeys(on) {
    const kb = navigator.keyboard;
    if (!kb || !kb.lock) return;
    if (on) kb.lock(LOCKED_CODES).catch(() => {}); else kb.unlock();
  }

  // A cell can have more than one surface to stand on: the ground, and above it a bridge
  // deck, a floor, a roof, the lid of a tunnel. `levels` holds what is above the terrain,
  // lowest first; the terrain itself is always the bottom and is never in the list.
  //
  // Which of them is your floor depends on where you already are, and that is the whole
  // idea. Swim under a bridge and the deck is over your head, so the riverbed is your
  // floor; walk onto the same cell along the bank and the deck is within a step, so the
  // deck is. One number per cell could not tell those apart, which is why you could not
  // swim under a crossing, stand on a roof, or have a tunnel at all.
  //
  // This is also where the levels meet the wading rule, which is not obvious from either
  // end: a deck is never below WATER_Y, so while you are up on one `blocked` does not
  // treat the crossing as open water, `inWater` stays false and you walk over rather than
  // swim across. Step off the side and you are wading again.
  let levels = new Map();

  // The boat under you, or nothing. A plain object { x, z, yaw, v } that boat.js steps;
  // walk mode owns no boat of its own, it is handed one and hands it back.
  state.vehicle = null;

  // How far up you will take a surface without jumping. Wider than the 0.32 a deck rides
  // above its bank, so you walk onto a bridge rather than bump into it; well under a
  // storey, or you would step off the ground straight onto your own roof.
  const STEP_UP = 0.45;

  function levelsIn(x, z) {
    const key = cellKey(x, z);
    // Null out at sea: there is nothing there to be on a level of, and `levels.get(null)`
    // would quietly answer for whatever happened to be stored under it.
    return key === null ? undefined : levels.get(key);
  }

  // The highest surface that is not over your head. `from` is where your feet are now;
  // leaving it out asks for the topmost one, which is what something looking down from
  // outside the world wants.
  function groundAt(x, z, from = Infinity) {
    const region = ground?.regionAt?.(x, z);
    const basin = region && quayBasin(region.village, region.terrain);
    const local = region?.toLocal(x, z);
    const ramp = basin && basin.rampHeight(...local);
    if (ramp != null) return ramp;
    let best = basin?.contains(...local) ? basin.height(...local) : heightUnder(x, z);
    const above = levelsIn(x, z);
    if (!above) return best;
    const reach = from + STEP_UP;
    for (const y of above) if (y <= reach && y > best) best = y;
    return best;
  }

  // The lowest surface above you, or Infinity under the open sky. This is the half that
  // makes "under" mean anything: without it a swimmer below a deck jumps straight through
  // it and lands on top, and a tunnel is just a differently shaped hill.
  function ceilingAt(x, z, from) {
    const above = levelsIn(x, z);
    if (!above) return Infinity;
    let best = Infinity;
    const reach = from + STEP_UP;
    for (const y of above) if (y > reach && y < best) best = y;
    return best;
  }

  // Is there dry land within arm's reach? This is what keeps a swim to the coast and a
  // stream, and refuses the open sea, without needing to know where either of them is.
  // Asked from your own height, or the deck you are swimming under would count as a
  // shore you cannot possibly climb onto.
  function shoreWithinReach(x, z, from) {
    for (const [dx, dz] of PROBE) if (groundAt(x + dx, z + dz, from) >= 0.06) return true;
    return false;
  }

  // A blocker is an axis aligned rectangle: the part of a building that is low enough
  // to bump into, grown by half a settler so the avatar stops at the wall rather than
  // standing in it. Rectangles, not circles, or a market row would be a fat bollard.
  // People are the exception, and keep their circle: a person is round, and unlike the
  // buildings they move, so they arrive in their own list every frame.
  //
  // And a person you are already standing in is a person you may walk out of. Somebody can
  // walk into you, or be idling on the spot in front of the board where everybody steps
  // onto the square; with a plain "inside the circle" test every step from in there was
  // inside it too, and you stood locked in a stranger until they moved. So when moving, a
  // peer only blocks a step that brings you closer. Placing somebody (`placing`: stepping
  // onto the square, ashore) is still strict - the whole point there is to find a free spot.
  function blocked(x, z, from = state.pos.y, placing = false) {
    // You may wade in as long as the shore stays close; the open water is still a wall.
    if (groundAt(x, z, from) < 0.06 && !shoreWithinReach(x, z, from)) return true;
    for (const b of state.blockers) {
      if (Math.abs(x - b.x) < b.hx + BODY_R && Math.abs(z - b.z) < b.hz + BODY_R) return true;
    }
    for (const b of state.peerBlockers) {
      const dx = x - b.x, dz = z - b.z;
      const reach = (b.r + BODY_R) * (b.r + BODY_R);
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach) continue;
      if (placing) return true;
      const ox = state.pos.x - b.x, oz = state.pos.z - b.z;
      if (d2 <= ox * ox + oz * oz) return true;
    }
    return false;
  }

  // Aboard. The camera pulls back - a hull is longer than a settler and you are steering it
  // rather than walking it - and any pose that does not survive standing on a deck is
  // dropped: you cannot sit down in a rowing boat and then stand up on the water.
  function board(boat) {
    if (!boat) return;
    state.vehicle = boat;
    standUp();
    state.crouching = false;
    state.lying = false;
    state.swimming = false;
    state.grounded = true;
    state.vy = 0;
    back = camBack * 2.2;
  }

  // Ashore at `at`, which is where the bow is pointing. The same step-back loop `enter`
  // uses, so you never land inside a wall or in the water you have just crossed - and if
  // forty tries find nothing legal you stay aboard, which is a stuck boat rather than a
  // drowned settler.
  function unboard(at) {
    if (!state.vehicle) return false;
    let [x, z] = at;
    let ok = !blocked(x, z, undefined, true);
    for (let i = 0; i < 40 && !ok; i++) {
      x += 0.25; z += 0.18;
      ok = !blocked(x, z, undefined, true);
    }
    if (!ok) return false;
    state.vehicle = null;
    back = camBack;
    state.pos.set(x, groundAt(x, z), z);
    state.floor = state.pos.y;
    state.grounded = true;
    state.vy = 0;
    return true;
  }

  function enter({ at, facing, pitch, blockers, interactables, onInteract, onSendAway, onPlant,
    onNextSeed, onPrevSeed, onBuild, onAvatar, onExit, onRelease, onToggleMinimap }) {
    state.blockers = blockers || [];
    state.interactables = interactables || [];
    state.working = null;
    state.onInteract = onInteract;
    state.onRelease = onRelease;
    state.onSendAway = onSendAway;
    state.onPlant = onPlant;
    state.onNextSeed = onNextSeed;
    state.onPrevSeed = onPrevSeed;
    state.onBuild = onBuild;
    state.onAvatar = onAvatar;
    state.onExit = onExit;
    state.onToggleMinimap = onToggleMinimap;
    let [x, z] = at;
    // step back until we are standing somewhere legal
    for (let i = 0; i < 40 && blocked(x, z, undefined, true); i++) { x += 0.4; z += 0.25; }
    state.pos.set(x, groundAt(x, z), z);
    state.floor = state.pos.y;
    state.vy = 0;
    state.grounded = true;
    standUp();
    // look at whatever we were dropped in front of, so the camera stays behind us
    state.yaw = state.camYaw = facing ? Math.atan2(facing[0] - x, facing[1] - z) : 0;
    // High enough to look over the treetops. Out at sea there are none, and the one thing
    // worth seeing is a coast on the horizon, which 0.44 puts above the top of the screen.
    state.camPitch = pitch ?? 0.44;
    state.active = true;
    avatar.visible = true;
    keys.clear();
    lockKeys(true);
    syncLock();
  }

  function exit() {
    state.vehicle = null;
    back = camBack;
    // Inactive before the release, or release() would ask for the lock back on the way out.
    state.active = false;
    release();
    state.blocking = false;
    lockKeys(false);
    avatar.visible = false;
    lounge.visible = false;
    standUp();
    keys.clear();
    stick.x = 0; stick.z = 0; stick.run = false; padCrouch = false;
    if (document.pointerLockElement === dom) document.exitPointerLock?.();
  }

  function setBlockers(list) { state.blockers = list; }
  function setPeerBlockers(list) { state.peerBlockers = list; }
  function setInteractables(list) { state.interactables = list; }

  // Re-dress the avatar in place. The mesh, its transform and everything driving it stay;
  // only the geometry is swapped, so a change made in the studio shows on your character
  // the instant you pick it, even mid-stride.
  function setAvatar(spec) {
    avatarLook = spec;
    classicAvatar.set(spec);
  }

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  // Controller input, folded into the same movement the keyboard uses. The actions come in
  // by name, so this one function serves the island and the rooms indoors both: what a
  // room's map leaves out - sowing, sending anyone away - never fires there.
  const stick = { x: 0, z: 0, run: false };
  let padCrouch = false;
  function pad(p, dt) {
    if (!state.active || state.paused) return;   // an overlay has the controller
    // A board held with a controller can only be let go of: there is no cursor to press
    // anything on it with. The button that took it gives it back, and so does the one
    // that would otherwise fly you off the island.
    if (state.working) {
      if (p.hit('interact') || p.hit('exit')) release();
      return;
    }
    stick.x = p.move.x;
    stick.z = -p.move.y;                       // pushing up on the stick walks forward
    // A tap keeps you running until you stand still; holding it down works too.
    if (!stick.x && !stick.z) stick.run = false;
    if (p.hit('sprint')) stick.run = !stick.run;
    if (p.down('sprint')) stick.run = true;
    state.camYaw -= p.look.x * 2.6 * dt;
    state.camPitch = clamp(state.camPitch + p.look.y * 1.7 * dt, -0.25, 0.95);
    if (p.hit('jump')) jump();
    if (p.hit('crouch')) crouchToggle();
    // Only the pad's own release stands you up again - a pad lying untouched on the desk
    // must not undo a crouch somebody started with C.
    const held = p.down('crouch');
    if (padCrouch && !held) releaseCrouch();
    padCrouch = held;
    if (p.hit('interact') && state.near) state.onInteract && state.onInteract(state.near);
    if (p.hit('secondary') && state.near) state.onSendAway && state.onSendAway(state.near);
    if (p.hit('primary')) state.onPlant && state.onPlant();
    if (p.hit('nextTool')) state.onNextSeed && state.onNextSeed();
    if (p.hit('prevTool')) state.onPrevSeed && state.onPrevSeed();
    if (p.hit('exit') || p.hit('exitAlt')) state.onExit && state.onExit();
  }

  function setPaused(v) {
    state.paused = !!v;
    // The sprint toggle is state now, so it has to be dropped along with the rest - or you
    // come out of a conversation already running.
    if (v) { keys.clear(); stick.x = 0; stick.z = 0; stick.run = false; padCrouch = false; }
    // An overlay needs the cursor; closing it hands the mouse back to looking around.
    syncLock();
  }

  // Step up to a board and work it. Pointer lock is the thing that has to go: while the
  // pointer is locked no DOM element gets a mouse event at all, so a panel in front of
  // you would look alive and answer nothing. The keys are handed over in onKeyDown.
  //
  // Not setPaused: that is for an overlay that owns the whole screen, and standing at a
  // board is not that - you are still out on the island, and a step away is a way out.
  function setWorking(it) {
    state.working = it || null;
    if (state.working) keys.clear();
    syncLock();
  }

  function release() {
    if (!state.working) return;
    const was = state.working;
    state.working = null;
    if (state.onRelease) state.onRelease(was);
    syncLock();
  }

  function update(dt) {
    if (!state.active) return null;
    if (state.paused) { stick.x = 0; stick.z = 0; return { near: state.near, pos: state.pos, distance: 0 }; }

    const run = (keys.has('shift') || stick.run) && !state.swimming && !state.crouching;
    let ix = 0, iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    if (Math.abs(stick.x) > 0.01 || Math.abs(stick.z) > 0.01) { ix += stick.x; iz += stick.z; }
    stick.x = 0; stick.z = 0;   // the pad refills this every frame it is touched

    // ---- aboard ------------------------------------------------------------
    // A boat is not feet, so `blocked` is left exactly as it is. It refuses open water
    // unless a shore is within SWIM_REACH, which is what makes a strip of sea between two
    // islands a crossing rather than a paddle - that line turned from a limitation into the
    // reason the boat exists, and teaching it about vehicles would have put a mode flag
    // inside the collision test of every walking frame. The vehicle simply steers instead
    // of walking, and land is its wall the way water is ours.
    if (state.vehicle) {
      stepBoat(state.vehicle, { throttle: iz, turn: ix }, dt, (x, z) => groundAt(x, z, Infinity));
      state.pos.set(state.vehicle.x, state.vehicle.deckY ?? DECK_Y, state.vehicle.z);
      state.yaw = state.vehicle.yaw;
      // The camera trails the bow rather than staying where the mouse left it. You steer
      // with a rudder here, not by walking towards what you are looking at, so a camera
      // that did not follow would leave you sailing sideways out of frame. It lerps, so a
      // look around still works and simply drifts back.
      state.camYaw = lerpAngle(state.camYaw, state.vehicle.yaw, Math.min(1, dt * 2.5));
      state.moving = Math.abs(state.vehicle.v) > 0.05;
      state.running = false;
      state.grounded = true;
      state.swimming = false;
      state.floor = state.pos.y;
      state.vy = 0;
      state.bob += dt * 1.2;
      return afterMove(dt);
    }

    const push = Math.min(1, Math.hypot(ix, iz));
    const speed = (state.lying || state.sitting ? 0
      : state.swimming ? SWIM_SPEED
        : state.crouching ? CROUCH_SPEED
          : run ? RUN_SPEED : WALK_SPEED) * push * dt;
    state.moving = push > 0.02;
    state.running = run && state.moving;   // the others need to know which gait to draw
    if (state.moving) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      // looking along +z with y up, the camera's right hand is -x: right = forward x up
      forward.set(Math.sin(state.camYaw), 0, Math.cos(state.camYaw));
      right.set(-Math.cos(state.camYaw), 0, Math.sin(state.camYaw));
      const vx = forward.x * iz + right.x * ix;
      const vz = forward.z * iz + right.z * ix;
      // try the full step, then each axis on its own, so you slide along walls
      const nx = state.pos.x + vx * speed, nz = state.pos.z + vz * speed;
      if (!blocked(nx, nz)) { state.pos.x = nx; state.pos.z = nz; }
      else if (!blocked(nx, state.pos.z)) state.pos.x = nx;
      else if (!blocked(state.pos.x, nz)) state.pos.z = nz;
      state.yaw = lerpAngle(state.yaw, Math.atan2(vx, vz), TURN_LERP);
      state.bob += dt * (run ? 13 : 9);
    } else {
      state.bob += dt * 1.5;
    }

    // Off the ground the height is the jump's; on it, whatever is underfoot - the terrain,
    // or the water surface where the terrain is below it. A jump keeps its arc out over
    // the water and only starts swimming when it comes down, which is what lets you clear
    // a stream instead of paddling across it.
    // Feet down: whatever is within a step of where you stand. In the air: the floor you
    // left, so a jump cannot change which storey you are on.
    const ground = groundAt(state.pos.x, state.pos.z, state.grounded ? state.pos.y : state.floor);
    if (state.grounded) state.floor = ground;
    const inWater = ground < 0;
    const underfoot = inWater ? WATER_Y - SWIM_SINK : ground;
    if (state.sitting) {
      state.pos.y = state.sitting.y;         // the stool, not the floor
    } else if (state.grounded) {
      state.pos.y = underfoot;
    } else {
      state.vy -= GRAVITY * dt;
      state.pos.y += state.vy * dt;
      // Your head. Without this a swimmer under a bridge jumps clean through the deck and
      // lands on top of it, which is the same hole that would let anyone out of a tunnel.
      if (state.vy > 0) {
        const lid = ceilingAt(state.pos.x, state.pos.z, state.floor);
        if (state.pos.y + HEAD > lid) { state.pos.y = lid - HEAD; state.vy = 0; }
      }
      if (state.pos.y <= underfoot) { state.pos.y = underfoot; state.vy = 0; state.grounded = true; }
    }
    state.swimming = state.grounded && inWater && !state.sitting;

    // Standing still with C held long enough is a decision to stop for the day, and it
    // outlasts the key: once down, the settler stays down until they move or press C
    // again. While crouching, any movement puts the clock back to zero, so a crouch-walk
    // never ends in a nap.
    if (state.sitting) {
      // The first step off is how you get up, once you have actually sat down.
      if (state.moving && performance.now() - state.sitting.since > SIT_HOLD_MS) standUp();
    } else if (state.lying) {
      if (state.moving || !state.grounded || state.swimming) standUp();
    } else if (state.crouching && state.grounded && !state.swimming) {
      if (state.moving) state.crouchSince = performance.now();
      else if (performance.now() - state.crouchSince >= LIE_AFTER_MS) { state.lying = true; state.crouching = false; }
    }

    return afterMove(dt);
  }

  // What both a walker and a boat end with: the pose, the animation, where the camera sits
  // and what is within reach. Split out when the boat arrived, because a boat needs all of
  // it and none of the walking above it - and a second copy of the camera block would have
  // been two places to remember the next time the eye height changes.
  function afterMove(dt) {
    avatar.scale.setScalar(1);
    lounge.visible = state.lying;
    if (state.lying) {
      // On the back with the head at -z, which is the end the parasol stands at. Negative
      // pitch turns the front face upwards; the positive one used for swimming is prone.
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(-1.5, state.yaw, 0);
      lounge.position.set(state.pos.x, state.pos.y + 0.01, state.pos.z);
      lounge.rotation.set(0, state.yaw, 0);
    } else if (state.sitting) {
      // The rig provides its own seated pose.
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(0, state.yaw, 0);
    } else if (state.swimming) {
      // Prone and rolling with the stroke. The figure is one merged mesh, so there are no
      // limbs to animate - the whole body leans into it instead, which at this scale is
      // what reads as swimming.
      state.bob += dt * (state.moving ? 6.5 : 1.4);
      avatar.position.set(state.pos.x, state.pos.y + Math.sin(state.bob) * 0.03, state.pos.z);
      // Positive pitch, so the head goes forward: rotating about local x maps +y (up,
      // towards the head) onto +z, which is the direction yaw points along. The other
      // sign swims feet first.
      avatar.rotation.set(1.32 + Math.sin(state.bob) * 0.1, state.yaw, Math.sin(state.bob * 0.5) * 0.16);
    } else {
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(0, state.yaw, 0);
      if (state.crouching) avatar.scale.set(1, 0.82, 1);
    }

    classicAvatar.update({
      moving: state.moving, running: state.running, grounded: state.grounded,
      crouching: state.crouching, sitting: !!state.sitting, lying: state.lying,
      blocking: state.blocking, phase: state.bob,
    }, dt);

    // camera sits behind and above, and never dips under the ground
    const dist = state.lying ? back * 1.7 : back;
    const cx = state.pos.x - Math.sin(state.camYaw) * dist * Math.cos(state.camPitch);
    const cz = state.pos.z - Math.cos(state.camYaw) * dist * Math.cos(state.camPitch);
    const eyeDrop = state.lying ? camUp * 0.55 : state.crouching || state.sitting ? camUp * 0.3 : 0;
    const cy = state.pos.y + camUp - eyeDrop + Math.sin(state.camPitch) * dist;
    camera.position.set(cx, Math.max(cy, groundAt(cx, cz, cy) + 0.55), cz);
    if (clampCam) clampCam(camera.position);
    // The aim follows the eye down as the body folds: crouching and sitting shorten the
    // figure by exactly these factors, so reusing them keeps the camera on the face rather
    // than on the air the settler has just vacated. Lying down there is no standing body
    // left to scale - the figure is flat on the towel, and a fifth of eye level is the
    // middle of what is left above the ground.
    const aim = state.lying ? camAim * LIE_AIM
      : state.crouching ? camAim * CROUCH_SCALE
        : state.sitting ? camAim * SIT_SCALE : camAim;
    camera.lookAt(state.pos.x, state.pos.y + aim, state.pos.z);

    // what is within reach?
    let near = null, bestD = Infinity;
    for (const it of state.interactables) {
      const dx = it.x - state.pos.x, dz = it.z - state.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < (it.r || 2.6) && d < bestD) { bestD = d; near = it; }
    }
    state.near = near;
    // Walking out of reach of the board you are working is the other way out, and the
    // one you take without thinking about it. Compared by id, not by identity: the list
    // of what is within reach is rebuilt whenever the island changes, and a board that
    // was rebuilt is still the same board to stand at.
    if (state.working && (!near || near.id !== state.working.id)) release();
    return { near, pos: state.pos, distance: bestD };
  }

  function dispose() {
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('wheel', onWheel);
    document.removeEventListener('pointerlockchange', onLockChange);
    scene.remove(avatar);
    classicAvatar.dispose();
  }

  // What stands above the terrain, per cell, lowest first. main.js merges the layout's
  // bridges with the ones somebody built before handing it over.
  function setLevels(map) { levels = map || new Map(); }

  // Is there room here for something wider than a person? Walk mode already knows what
  // cannot be walked through, so "can a vegetable bed go where I am standing" is that
  // same question asked with a bed's radius instead of a settler's.
  function roomFor(x, z, r) {
    for (const b of state.blockers) {
      if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) return false;
    }
    return true;
  }

  return { state, avatar, enter, exit, update, pad, setPaused, setWorking, release, setBlockers, setPeerBlockers, setInteractables, setAvatar, setLevels, sitOn, standUp, roomFor, board, unboard, aboard: () => state.vehicle,
    // What is underfoot here, decks included. The archipelago alone answers with water
    // over a quay, because planks are a level rather than ground - and "can I step out
    // here" has to mean the same thing as "will my feet find something".
    groundAt: (x, z) => groundAt(x, z),
    dispose, isActive: () => state.active };
}

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
