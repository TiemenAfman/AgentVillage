// Walking the island on foot. A third-person camera behind a settler you steer with
// WASD, terrain underfoot, buildings you cannot walk through, and a prompt when you
// come close to something you can interact with.
import { quayKade } from 'shared/quay-basin.mjs';
import * as THREE from 'three';
import { figureGeometry } from './settlers.js';
import { box, cylinder, cone, sphere, WALK_BODY_R as BODY_R, WALK_CLEARANCE } from './buildings.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';
import { loadAvatar, PLAYER_EYE } from './avatar.js';
import { createClassicAvatar, DROWN_SINK, DEATH_REST, horsebackOf, SEAT_FLESH } from './classic-avatar.js';
import { stepBoat, hullOver, DECK_Y, hullPointOf, hullTiltOf, cargoMesh } from './boat.js';
import { cameraFloor, applyCeiling } from './camera-floor.js';
import { cameraFixed } from './camera-prefs.js';
import { insideSolid, depthInSolid, surfaceHeight, topOf, createSolidIndex, segmentEntry, camBodyEntry, camSeesPastSolid } from './solids.js';
import { stepHull, nearestStand } from 'shared/hullwalk.mjs';
import { stepDive, canDive, headUnder, divePitch, swimPose, stepLie, lookRise, plungeSpeed, DIVE_DRIFT, DIVE_SPEED, DIVE_TURBO, BOTTOM_SPEED } from './diving.js';
import { stepDeck, toWorld, toLocal, dirToLocal, dirToWorld, deckAt, hullVelocity, ladderPath, pathAt, ladderUp, ladderDown, ladderHolding, aloftPath, aloftUp, aloftDown } from 'shared/deck.mjs';
import { climbWay, climbWayDown, climbAlong, onWay, topNear } from './ladder-way.js';
import { stepBike, bikeAt, createBicycle, RIDER, BIKE_SHORE, BIKE_TOP, stickTurn } from './bicycle.js';
import { stepMount, mountAt, createMount, MOUNT_SHORE, MOUNT_TOP, MOUNT_HEAD, MOUNT_NOSE, MOUNT_RUMP } from './mount.js';
import { createPool, stepPool, BODY, BOAT, HORSE } from './stamina.js';
import { createTipsy, drinkIn, stepTipsy } from './tipsy.js';
import { danceStep, wallBeat } from './dance.js';
import { canon, ctrlIsKey } from './keybinds.js';
// A field on a board takes its letters, so the feet keep out of it entirely - which is the whole of
// "type quit and you plant a tree".
import { typingInto } from './page-keys.js';
import { createZzz, bobZzz } from './zzz.js';

const PLANE_UP = new THREE.Vector3(0, 1, 0);
// How much of a hull's tilt the third-person camera takes on (placeCamera): 0 is a level camera
// over a deck that rocks under it, 1 is the deck held still on the screen and the whole sea rocking.
const CAM_TILT = 0.25;
// How far up a swimmer may look (camPitch, radians; negative is the camera below the head). About 63
// degrees: enough to see the surface from the bed and the sky from the top of a stroke.
const SWIM_PITCH_MIN = -1.1;
import { CROUCH_SPEED } from './avatar-gait.js';
const TURN_LERP = 0.18;
const CAM_BACK = 2.7;
// A finger's drag, turned the way the mouse turns: radians per px dragged (touchpad.js hands
// it over as `drag`). A little livelier than the mouse, because a phone is a short stroke.
const DRAG_YAW = 0.0055;
const DRAG_PITCH = 0.0042;
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
// How quickly the stick turns a jumper's way in the air, per second (walk mode's `airWay`): at
// 2.5 a standing jump pushed forward covers about half the ground a running one does.
const AIR_STEER = 2.5;
const GRAVITY = 12.5;
// Swimming goes anywhere, the open sea included. It used to be wading only - no step into
// water with no shore within SWIM_REACH - and that rule made a swimmer who ended up at sea
// by any other route (a bug, a respawn, a boat left from) a statue: every direction was
// open water, so every step was refused. The crossing is slow enough on its own (1.9
// against the boat's 9.5, tests/boat.test.mjs holds the ratio) to leave the boat its job.
// SWIM_REACH survives only for *putting* somebody down: stepping ashore and entering walk
// mode still want ground within reach of a shore. The sea surface is y = 0, matching the
// water plane in world.js, and the body sits a little way into it.
const SWIM_SPEED = 1.9;
// Shift in the water: a harder stroke, out of the same pool as a run (web/js/stamina.js).
// Well under a walk still, and a third of the boat's cruising speed, so six seconds of it
// gets you off a beach or away from somebody on the shore and does not make the hull
// pointless on a crossing.
const SWIM_TURBO = 3.2;
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
// The treasure statue in both arms (Plans/schatkaarten.md): a walk at this share of the ordinary one,
// no run (so no stamina spent either), no jump. Named because the gait's step rate follows it too.
const CARRY_SPEED = 0.55;
// Setting her down (H, `setDown`) puts her this far ahead of the feet - in front of the arms, where the
// rig holds her - and only where a body could stand: dry, within a step of the feet, nothing in the way.
// A fall of more than CARRY_FALL (a cell, four metres) with her in the arms throws her out of them.
export const SET_AHEAD = 0.6;
export const CARRY_FALL = 1.0;
// A dig (`dig`) takes this long unless the caller says otherwise, and the shovel goes in this far ahead
// of the feet - where `onDigDone` says the hole is, so a spot is found at the hole and not under the boots.
const DIG_SECONDS = 2.5;
const DIG_REACH = 0.6;
// The same refusal is told once a second at most: a key held against a ladder asks every frame.
const BLOCKED_TOAST_MS = 1000;

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
// How far a rider leans forward over the bars, about the hips (positive is head forward, the
// swimmer's sign). The arms do the rest of the reach - classic-avatar.js's RIDE_ARM.
const RIDE_PITCH = 0.28;
// How much higher a rider's head is than a walker's: the saddle lifts the whole figure.
const RIDE_HEAD = 0.07;
// A camera turned by hand is left alone for this much riding, then eases back behind the bike
// over the next RECENTRE_EASE seconds.
const RECENTRE_AFTER = 0.5;
const RECENTRE_EASE = 0.5;
const seatAt = new THREE.Vector3();
// What a full purple bar does to a walk (web/js/tipsy.js). The heading swings by up to this
// many radians either side of where you steer, the body rolls and nods with it, and all of
// it scales with the bar, so one beer is a slight lilt and seven are a zigzag. Two sines at
// unrelated rates for the heading, or the stagger is a metronome.
const STAGGER = 0.6;
const SWAY_ROLL = 0.16;
const SWAY_NOD = 0.05;
// How much room a settler needs over their feet. The same figure the buildings measure
// themselves against, so a gap you can walk under is a gap you can walk under.
const HEAD = WALK_CLEARANCE;
// The keys the feet use. Lifted out of onKeyDown because a board being worked hands
// every other key to the page and keeps only these.
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
// Every letter and digit, with ctrl: select all, save, print, find, bookmark, view source, open,
// history, downloads, address bar, reload, bold; new tab/window, close, tab <n>. On foot none
// of them is wanted (ctrl+A selected the whole page under the walker, ctrl+S sits beside the
// walking keys), so all are cancelled - see onKeyDown - and locked in fullscreen - see
// lockKeys(). A list of the ones that happened to hurt grew a letter at a time.
const BROWSER_KEYS = new Set([...'abcdefghijklmnopqrstuvwxyz0123456789', 'tab']);


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
  // The old body: the hat and satchel below are placed on its head and hip.
  const base = figureGeometry(style, { skinned: false });
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
  camBack = CAM_BACK, camUp = CAM_UP, camAim = EYE, clampCam = null, onSwing = null, onDrink = null,
  // What the camera's boom stops at besides the blockers (Plans/camera-botsing.md): the buildings,
  // as solids.js camBodyOf makes them, asked again whenever the blockers are handed over (main.js
  // cameraBodies). A room has none: its walls and furniture are its blockers.
  cameraBodies = null,
  // How high a blocker with no height of its own stands, to the camera. Outside, nothing without a
  // height is a camera's business - a tree's trunk, which leaves the crown to be looked through. A
  // room says its ceiling: every blocker in there (the bar, a post) stands floor to lid.
  camSolidTop = null,
  // The purple bar's pool. main.js hands the island's walk and the tavern's the same one and
  // steps it itself, so the beer outlasts the door and wears off from the sky too; a walk
  // mode given none (the workbench) keeps and steps its own.
  tipsy = null,
  // Whether F puts you on something to ride here: a bicycle for the Traveller (web/js/bicycle.js),
  // a horse for the Adventurer (web/js/mount.js). The island and the workbench say yes; a room does
  // not - there is no riding round the tavern.
  bikes = false,
  // Who is dancing and to what, when R is pressed (Plans/DONE/dansen.md): `{ id, beat }`, the id the
  // sea knows us by - so our own screen picks the move everybody else's does - and the beat of
  // whatever we hear (main.js danceBeat). Without one (the workbench) it is nobody in
  // particular on the wall clock.
  dance = null,
  // Whether somebody else is moving a hull we stand on (main.js: another player has the helm, or
  // is running her out after letting go): then her position is theirs to say and ours to follow,
  // and this walk mode must not step her under them as well.
  following = null,
  // Poses a hull for this frame - placed and swelled at this frame's clock, the transform that will
  // be drawn - so that what is stood on it is put on the plane as it is drawn and not as it was a
  // frame ago (main.js). Without one (the workbench has no ships) the hull is read as it stands.
  poseHull = null,
  // Carrying and digging (Plans/schatkaarten.md). `onDigDone(x, z, { from, yaw })` is a dig that ran its
  // whole time: the hole is at x, z (DIG_REACH ahead of the feet, `from`). `onDigCancelled(reason)` is
  // one that did not - 'moved', 'jump', 'crouch', 'hit' (main.js calls cancelDig('hit') when we are
  // struck), 'paused', 'reset' (a seat, a boat, leaving walk mode) or 'blocked'. `onBlocked('carry')`
  // is a thing refused because both hands are full - main.js turns it into a toast.
  onDigDone = null, onDigCancelled = null, onBlocked = null,
  // The hands letting go of what they carried, anywhere but onto a hull: `onLetGo(item, { x, y, z, why })`
  // with where it lies now - always dry ground, never the water. `why` is 'set' (H: set down on purpose,
  // ahead of the feet), 'water' (deep water: nobody swims with her), 'fall' (a drop of CARRY_FALL or
  // more), 'die' or 'home' (main.js sentHome: the body is taken somewhere else, and she stays). The
  // hunt keeps the spot (treasure.js letGo); `onBlocked('set')` is H refused here.
  onLetGo = null,
}) {
  const ownTipsy = !tipsy;
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
  // Over the head of the body left standing (park): in the scene, not on the avatar, so a
  // swimmer's tilt or a nap on the towel does not lay it on its side.
  const zzz = createZzz();
  scene.add(zzz);

  const keys = new Set();
  // How far the camera has gone over to a diver's rules (camera-floor.js), 0..1, eased in
  // afterMove: the head going under moves the floor and the ceiling two units, and the camera
  // must not jump with it. Space held is what swims a diver up (a key is not in `keys`, which
  // holds only the walking ones), and the pad's A is the same.
  let camDive = 0;
  // The time it takes: long enough that the two and a half units between the surface
  // swimmer's camera and the diver's are covered at a few units a second, not a jump.
  const CAM_DIVE_S = 0.8;
  let spaceHeld = false;
  let padJump = false;
  const state = {
    active: false,
    // The body left standing while the keeper is up in the sky (Plans/DONE/karakter-blijft-staan.md):
    // drawn, on the sea, stepped by update() - but by nobody's keys and moving no camera. It
    // walks only a `route` handed to it from above (goTo), and asleep otherwise.
    parked: false,
    route: null,
    pos: new THREE.Vector3(),
    yaw: 0,          // where the player faces
    camYaw: 0,       // where the camera looks from
    camPitch: 0.28,
    // Through the settler's own eyes: the wheel past its nearest stop, or V. The pose that
    // goes to the sea is the same either way - this is only where our own camera stands.
    firstPerson: false,
    bob: 0,
    lie: 1,             // how far into the stroke a swimmer lies, 1 prone, 0 treading water upright (diving.js swimPose)
    vy: 0,           // vertical speed; zero whenever the feet are down
    grounded: true,
    // The surface you are standing on, held for the whole of a jump. Which floor you
    // belong to has to be decided when you leave the ground and not recomputed as you
    // rise, or a swimmer under a bridge would climb into reach of the deck halfway up
    // and land on top of the thing they were swimming under.
    floor: 0,
    swimming: false,
    // On the rungs of a rope ladder: { rise } (how far the feet went up this frame, down negative),
    // for the rig's climb (classic-avatar.js); null off them, and on a climb's reach and step-over.
    climbing: null,
    // Diving (web/js/diving.js, Plans/onderwater-zwemmen.md). `dive`: the feet are free of the
    // surface - `pos.y` is stepDive's, not WATER_Y - SWIM_SINK - and a diver is still
    // `swimming` (grounded, in the water, no fight, no dance), so every reader of that word,
    // the sea's SWIMMING bit included, stays true. `diving`: the HEAD is under the surface,
    // which is what the camera's ceiling, the mist and the sea's air key on. `onBed`: standing
    // on the sand, where a diver walks instead of swims.
    dive: false,
    diving: false,
    onBed: false,
    // Dying (Plans/vallen-en-verdrinken.md): { kind: 'fall' | 'drown', t } between the sea's
    // `evicted` and the jump home main.js makes when it is over - see die().
    dying: null,
    crouching: false,
    lying: false,
    // Where you are sitting, or null. A seat carries its own height, so a bar stool holds
    // you above the floor rather than sinking you into it.
    sitting: null,
    // The bicycle under you, or null: bicycle.js's { x, y, z, yaw, v, steer, lean, wheel,
    // crank }. Deliberately not `vehicle`, which means the boat everywhere main.js and net.js
    // look at it (the hull sync, the berth, the boat's own stamina) - Plans/DONE/fiets.md.
    bike: null,
    // The horse under you, or null: mount.js's { x, y, z, yaw, v, rate, vy, air, floor }. The
    // Adventurer's ride, as the bicycle is the Traveller's (Plans/paard-in-plaats-van-fiets.md); one
    // of the two at most, and like `bike` never `vehicle`.
    mount: null,
    // The statue in both arms: its item name, or null. Like `bike`, never `vehicle`. net.js puts it in
    // the pose (CARRYING); aboard it is `cargo` instead, which the sea is not told about.
    carry: null,
    // The statue on a hull instead of in the arms: { item, hull }. A body aboard has no hands to spare.
    cargo: null,
    // A dig going on: { t, total } in seconds, or null. net.js puts it in the pose (DIGGING).
    digging: null,
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
    onGive: null,
    onAvatar: null,
    onExit: null,
    // Aboard a ship by her rope ladder, and off her again by jumping or by the ladder: the moment
    // each happens, for main.js to tell the sea (crew is the sea's to count, lib/boats.mjs).
    onBoarded: null,
    onLeftDeck: null,
    // The board you are standing at and working, or null. While one is held the page on
    // it owns the keyboard and the mouse; only the keys that walk you away are still the
    // island's. See setWorking.
    working: null,
    onRelease: null,
    moving: false,
    running: false,
    sprinting: false, // Shift with breath left: a sprint; running without it is the jog
    // Shift answered this frame: a run, a swimmer's turbo or the boat's, whichever applies.
    turbo: false,
    // What Shift spends. Running and swimming share the body's; the boat has its own, and
    // both fill whenever they are not being drawn on - see web/js/stamina.js.
    stamina: { body: createPool(BODY), boat: createPool(BOAT), horse: createPool(HORSE) },
    // What the beer has done so far, and the clock the stagger runs on.
    tipsy: tipsy || createTipsy(),
    sway: 0,
    dancing: false,  // R (Plans/DONE/dansen.md): on the spot, until the feet do anything else
    blocking: false, // a shield is up in either hand - what net.js puts in the pose
    guard: { leftArm: false, rightArm: false }, // which hand's shield is up
    shields: { left: false, right: false },     // which hands carry one at all: armour
    paused: false,   // true while an overlay owns the input
  };

  // Letting go of C ends a crouch, but not a nap: once the settler is down they stay
  // down, so the key can be released. Getting up is moving, or pressing C again.
  function releaseCrouch() {
    state.crouching = false;
    if (!state.lying) state.crouchSince = 0;
  }
  function standUp() {
    leaveDeckSeat();
    state.crouching = false;
    state.lying = false;
    state.sitting = null;
    state.crouchSince = 0;
    state.dancing = false;
    cancelDig('reset');   // every way of standing up, sitting, boarding or leaving ends a dig
    endDive();
  }
  // Back to floating at the surface (or to whatever the caller is about to make of the body:
  // a hull, a stool, a walk-mode exit). The height is left where it is; the next step puts the
  // body where the ordinary rules say.
  function endDive() {
    state.dive = false;
    state.diving = false;
    state.onBed = false;
  }

  // Jumping and crouching live here rather than in the key handler because the controller
  // does both as well, and two copies of "only from the ground" would drift apart.
  function jump() {
    if (state.digging) { cancelDig('jump'); return; }   // the press is the cancel; it does not also jump
    if (state.carry) return;                            // both hands are full
    if (rides()) { hopWanted = true; return; }   // taken by the next stepBike/stepMount, feet down
    if (climb) { climb.letGo = true; return; }     // a jump on a ladder is letting go of it
    if (state.deck) { deckJump = true; return; }   // stepDeck's, in the planks' own frame
    if (state.sitting) { standUp(); return; }   // stand before you jump, not off the stool
    if (state.grounded && !state.swimming) { state.vy = JUMP_V; state.grounded = false; }
  }
  function crouchToggle() {
    if (state.digging) { cancelDig('crouch'); return; }
    if (state.carry) return;                    // nor a crouch, nor (C being swim-down) a dive
    if (state.lying) standUp();               // pressing it again is how you get up
    else if (!state.crouching) { state.crouching = true; state.crouchSince = performance.now(); state.dancing = false; }
  }
  // Dancing, where you stand (Plans/DONE/dansen.md). A pose like sitting, held until you do anything
  // else: walk, jump, crouch, get on something, fight, or press R again. Only with both feet on
  // dry ground and nothing else going on - not on the bike, at a tiller, in the water, on a
  // stool or lying down. A crouch is stood up out of, the way a jump stands you off a stool.
  const canDance = () => state.active && !state.working && state.grounded && !state.swimming
    && !state.vehicle && !rides() && !state.sitting && !state.lying && !state.carry && !state.digging;
  function danceToggle() {
    if (state.dancing) { state.dancing = false; return; }
    if (!canDance()) return;
    state.crouching = false;
    state.crouchSince = 0;
    state.dancing = true;
  }

  // ---- carrying and digging (Plans/schatkaarten.md) -------------------------------------------
  // Two things done with the hands, both only on dry ground and on foot, and both a pose in the sea's
  // eyes (net.js CARRYING / DIGGING): `state.carry` and `state.digging`. Like the bicycle they are
  // their own state and never `vehicle`, which means the boat to every reader of it.
  //
  // The rig draws them (classic-avatar.js setCarry / dig); asked with `?.` because a rig from before
  // them just does not show either and everything here still holds.
  let lastBlockedAt = -Infinity;
  function blockedBy(reason) {
    const now = performance.now();
    if (now - lastBlockedAt < BLOCKED_TOAST_MS) return;
    lastBlockedAt = now;
    if (onBlocked) onBlocked(reason);
  }
  // Hands free to take hold of something: on foot on land, nothing else going on. Swimming is not:
  // lift() is never how a statue ends up in the water, only wading in with it (or stepping off a hull
  // into it, which unboard refuses) can.
  const canHandle = () => state.active && !state.paused && !state.working && !state.parked
    && !state.vehicle && !state.deck && !climb && !rides() && !state.swimming
    && !state.sitting && !state.lying && !state.digging;

  // At the oars of a rowing boat (boat.js `rowing`): drawn seated on her thwart, pulling with her
  // stroke. A ship's pilot stands at her wheel instead.
  const oarsman = () => !!(state.vehicle && !state.deck && state.vehicle.craft && state.vehicle.craft.rowing);
  const rowTilt = new THREE.Quaternion();

  // Take the statue (or whatever `item` names) in both arms. False when there is no room for it: the
  // hands are busy, or it is already in them or on a hull.
  function lift(item = 'statue') {
    if (!item || state.carry || state.cargo || !canHandle()) return false;
    state.carry = item;
    lastDry = dryHere();
    // Both hands: no shield up, no dance, no crouch, and the sprint toggle is dropped with the rest.
    lowerShields();
    state.dancing = false;
    releaseCrouch();
    stick.run = false;
    if (classicAvatar.setCarry) classicAvatar.setCarry(true);
    return true;
  }
  // Set it down: hands empty, and the item's name back so the caller can put it somewhere. Null when
  // nothing was in them. What is under the feet is main.js's to know, not the walk's.
  function putDown() {
    const item = state.carry;
    if (!item) return null;
    state.carry = null;
    if (classicAvatar.setCarry) classicAvatar.setCarry(false);
    return item;
  }
  // Letting go of her on the ground (Plans/schatkaarten.md, "Neerzetten en laten vallen"). Nothing a
  // body carries is ever lost: she lies on dry ground, and `onLetGo` says where, for the hunt to keep.
  // `lastDry` is where the feet last stood on dry ground with her in the arms - set by lift() and every
  // frame after - which is where she ends up when the hands give out somewhere she cannot lie: in
  // deep water she is back on the shore you waded in from, never on the bed.
  let lastDry = null;
  // Where a fall began (walked off an edge, or over a ship's side), for CARRY_FALL.
  let airTop = -Infinity;
  const DRY_ABOVE = WATER_Y + 0.02;
  // The feet's own spot, when it is one she may lie on.
  function dryHere() {
    if (!state.grounded || state.swimming || state.dive || state.vehicle || state.deck || climb) return null;
    const { x, y, z } = state.pos;
    return y >= DRY_ABOVE ? { x, y, z } : null;
  }
  function letGoAt(why, at) {
    const item = putDown();
    if (!item) return false;
    lastDry = null;
    if (onLetGo) onLetGo(item, { x: at.x, y: at.y, z: at.z, why });
    return true;
  }
  // The hands give out (deep water, a fall, a death, a jump home): where the feet are if that is dry
  // ground, else the last dry ground she was carried over.
  function letGo(why = 'drop') {
    if (!state.carry) return false;
    const at = dryHere() || lastDry || { x: state.pos.x, y: Math.max(state.pos.y, WATER_Y), z: state.pos.z };
    return letGoAt(why, at);
  }
  // H: set her down on purpose, a step ahead - on dry ground within a step of the feet, never in the
  // water, on a roof or a wall, and only from a body standing on its own two feet.
  const canSet = () => state.active && !state.paused && !state.working && !state.parked && state.grounded
    && !state.swimming && !state.dive && !state.vehicle && !state.deck && !climb && !rides()
    && !state.sitting && !state.lying && !state.dying;
  function setDown() {
    if (!state.carry) return false;
    if (!canSet()) { blockedBy('set'); return false; }
    const x = state.pos.x + Math.sin(state.yaw) * SET_AHEAD, z = state.pos.z + Math.cos(state.yaw) * SET_AHEAD;
    const y = groundAt(x, z, state.pos.y);
    if (!(y >= DRY_ABOVE) || Math.abs(y - state.pos.y) > STEP_UP || blocked(x, z, y, true)) { blockedBy('set'); return false; }
    return letGoAt('set', { x, y, z });
  }
  // Aboard nothing is held: the statue goes onto the hull instead (boat.js setCargo hangs it on the
  // deck, where it swells with her), and the arms are free for the tiller. board() does this itself for
  // whoever comes aboard carrying, so the pose never says CARRYING at the wheel.
  function putOnBoat(hull) {
    if (!state.carry || !hull) return false;
    const item = state.carry;
    state.carry = null;
    if (classicAvatar.setCarry) classicAvatar.setCarry(false);
    state.cargo = { item, hull };
    if (hull.craft && hull.craft.setCargo) hull.craft.setCargo(cargoMesh(item, material));
    return true;
  }
  // And back into the arms - once the body is not aboard. unboard() does it on the way ashore; this is
  // the same thing for a body that got off some other way (a jump, a ladder, walk mode left and
  // re-entered), standing wherever it now is.
  function takeOffBoat() {
    if (!state.cargo || state.vehicle || state.deck || climb) return false;
    cargoToArms();
    return true;
  }
  function cargoToArms() {
    const c = state.cargo;
    state.cargo = null;
    if (c.hull.craft && c.hull.craft.setCargo) c.hull.craft.setCargo(null);
    state.carry = c.item;
    if (classicAvatar.setCarry) classicAvatar.setCarry(true);
  }

  // The statue up a ship's side and down it again (Plans/roeiboot-en-schat.md, "de sloep van het
  // schip"). A rope ladder is climbed with her on the back (classic-avatar.js CARRIED_BACK): walked
  // into from the water or a quay in the arms, she goes onto the deck as cargo at the top, and a
  // climb down from a deck she is on takes her along. Besides that, from a rowing boat
  // lying at one of a ship's ladders, `hoistOnto` takes her up with you - her onto the ship's deck as
  // her cargo, you onto the planks where that ladder lands, crew from there (the caller tells the
  // sea). `lowerOff` is the way back: off her deck, her into the rowing boat `row` the caller has laid
  // at a ladder's foot; the caller then boards `row` (board()), and you are at the oars with her in
  // the stern. Both false when the statue is not where they start from.
  function hoistOnto(ship, ladder) {
    const row = state.vehicle;
    if (!row || !ship || !ladder || !state.cargo || state.cargo.hull !== row || state.deck) return false;
    const { item } = state.cargo;
    if (row.craft && row.craft.setCargo) row.craft.setCargo(null);
    state.cargo = { item, hull: ship };
    if (ship.craft && ship.craft.setCargo) ship.craft.setCargo(cargoMesh(item, material));
    const [lx, lz] = ladder.land;
    const floor = deckAt(specOf(ship), lx, lz) ?? ladder.top;
    const land = ship.craft && ship.craft.walk ? nearestStand(ship.craft.walk, lx, lz, floor + 0.2) : null;
    state.vehicle = null;
    climb = null;
    deckBoat = ship;
    const yaw = Math.atan2(-(ladder.x < 0 ? -1 : 1), 0);
    state.deck = { boat: ship.id, x: land ? land.x : lx, z: land ? land.z : lz, y: land ? land.y : floor, vy: 0, grounded: true, yaw };
    state.swimming = false;
    state.grounded = true;
    state.vy = 0;
    place(camBack * 1.5);
    return true;
  }
  function lowerOff(ship, row) {
    if (!state.deck || deckBoat !== ship || !row || !state.cargo || state.cargo.hull !== ship) return false;
    const { item } = state.cargo;
    if (ship.craft && ship.craft.setCargo) ship.craft.setCargo(null);
    if (row.craft && row.craft.setCargo) row.craft.setCargo(cargoMesh(item, material));
    state.cargo = { item, hull: row };
    state.sitting = null;
    offDeck();
    return true;
  }

  // Digging: standing still with a shovel for `seconds`. Refused unless the feet are on dry ground and
  // nothing else is going on, and with both hands full; the body must already be still, because moving
  // is what cancels it (in update, where the input is read). Returns whether it began.
  const canDig = () => state.active && !state.paused && !state.working && !state.parked && state.grounded
    && !state.swimming && !state.dive && !state.vehicle && !state.deck && !climb && !rides()
    && !state.sitting && !state.lying;
  function dig(seconds = DIG_SECONDS) {
    if (state.digging) return false;
    if (state.carry) { blockedBy('carry'); return false; }
    if (!canDig() || state.moving || state.crouching) return false;
    state.dancing = false;
    lowerShields();
    state.digging = { t: 0, total: Math.max(0.05, seconds) };
    if (classicAvatar.dig) classicAvatar.dig(true);
    return true;
  }
  // The dig is over before its time. Moving, a jump, a crouch and a panel do this themselves; what
  // only main.js knows - a blow from a guard - it calls with 'hit'.
  function cancelDig(reason = 'cancelled') {
    if (!state.digging) return false;
    state.digging = null;
    if (classicAvatar.dig) classicAvatar.dig(false);
    if (onDigCancelled) onDigCancelled(reason);
    return true;
  }
  function stepDig(dt) {
    const d = state.digging;
    d.t += dt;
    if (d.t < d.total) return;
    state.digging = null;
    if (classicAvatar.dig) classicAvatar.dig(false);
    if (!onDigDone) return;
    const px = state.pos.x, pz = state.pos.z;
    onDigDone(px + Math.sin(state.yaw) * DIG_REACH, pz + Math.cos(state.yaw) * DIG_REACH, { from: [px, pz], yaw: state.yaw });
  }

  // Take a seat: a stool, a bench, the edge of a table. The same shape as lying down - a
  // pose held until you walk out of it - except that it is entered deliberately, so
  // nothing counts down to it and the seat says how high you end up.
  function sitOn({ x, z, y, yaw = 0 }) {
    if (state.carry) { blockedBy('carry'); return; }   // nowhere to put it down on a stool
    cancelDig('reset');
    putBikeAway();
    endDive();
    state.crouching = false;
    state.lying = false;
    state.crouchSince = 0;
    state.dancing = false;
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
    // Rebound keys (keybinds.js) arrive as the default key of their action, so everything
    // below keeps testing the defaults. Not for a board being worked: its letters are typed.
    const typed = e.key.toLowerCase();
    const k = state.working ? typed : canon(typed);
    // A key with ctrl, meta or alt on it is not a game key - which also covers AltGr on a
    // Dutch layout, where it arrives as ctrl+alt. But on foot the browser's own shortcuts
    // are a hazard (ctrl+S next to the walking keys, ctrl+P beside the sowing one), so the
    // ones a page is allowed to cancel are cancelled here, unless somebody is typing into
    // a field. Chrome reserves ctrl+W, ctrl+T, ctrl+N and ctrl+<digit> and ignores
    // preventDefault on them: those only come to the page under the keyboard lock that
    // lockKeys() asks for, and only in fullscreen (the desktop window has no tab to lose and does not ask).
    //
    // Unless Ctrl is bound (keybinds.js): then it is somebody's crouch or swim-down, held
    // while the walking keys are pressed, and the press is a game key like any other. The
    // shortcut above is cancelled all the same - that is the price of using it.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !typingInto(e.target) && BROWSER_KEYS.has(typed)) e.preventDefault();
      if (!(e.ctrlKey && !e.metaKey && !e.altKey && ctrlIsKey())) return;
    }
    // A board being worked has the keyboard. Escape hands it back wherever the focus is,
    // and the feet keep their own keys so that walking away is still a way out - except
    // inside a field, where those keys are letters somebody is typing.
    if (k == null) return;
    if (state.working) {
      if (k === 'escape') { e.preventDefault(); release(); return; }
      const mk = canon(typed);
      if (!typingInto(e.target) && MOVE_KEYS.includes(mk)) { keys.add(mk); e.preventDefault(); }
      return;
    }
    if (MOVE_KEYS.includes(k)) {
      keys.add(k);
      e.preventDefault();
    }
    // On or off the bike. Not on a repeat, or holding F would bounce you on and off it.
    if (k === 'f' && !e.repeat) { e.preventDefault(); toggleBike(); }
    if (k === 'v' && !e.repeat) { e.preventDefault(); setFirstPerson(!state.firstPerson); }
    // Only from the ground, so holding space does not climb the sky. On the bike it is a hop.
    // Held, it swims a diver up (`spaceHeld`, read by update).
    if (k === ' ') { e.preventDefault(); spaceHeld = true; jump(); }
    // Not on a repeat: crouchToggle() is a toggle, and the OS keeps sending keydown for
    // 'c' the whole time it is held. Without this, holding C past LIE_AFTER_MS meant the
    // very next repeat found the settler just lain down and stood them straight back up
    // (crouchToggle's own "press it again to get up"), and the repeat after that started
    // the crouch over - an infinite loop that never spent a rendered frame lying down,
    // reachable only by physically releasing and re-pressing the key.
    if (k === 'c' && !e.repeat) { e.preventDefault(); if (!rides()) crouchToggle(); }
    // Not on a repeat either, or holding R would start and stop the dance every few frames.
    if (k === 'r' && !e.repeat) { e.preventDefault(); danceToggle(); }
    // Whatever E and X reach for - a door, a stool, a boat, a settler - is done on foot, so
    // they get you off the bike first; so does sowing, which happens where the feet are.
    if (k === 'e' && state.near && !climb) { e.preventDefault(); dismount(); state.onInteract && state.onInteract(state.near); }
    if (k === 'x' && state.near) { e.preventDefault(); dismount(); state.onSendAway && state.onSendAway(state.near); }
    // Sowing is the same kind of thing: it happens where the feet are, not at a door.
    if (k === 'p') { e.preventDefault(); dismount(); state.onPlant && state.onPlant(); }
    if (k === 'q') { e.preventDefault(); state.onNextSeed && state.onNextSeed(); }
    // The catalogue. Like a thought, it is about wherever you happen to be standing, so
    // it needs nothing within reach.
    if (k === 'b') { e.preventDefault(); state.onBuild && state.onBuild(); }
    // The wardrobe, same door the Avatar chip opens. Like Build, whoever is standing here
    // rather than something with the keyboard.
    if (k === 'i') { e.preventDefault(); state.onAvatar && state.onAvatar(); }
    // The radar: on by default, M cycles it to the chart of the sea and then to neither.
    if (k === 'm') { e.preventDefault(); state.onToggleMinimap && state.onToggleMinimap(); }
    // Hand the settler in front of you a beer, when there is a glass in your hand and
    // somebody within reach - main.js decides both and puts the offer on screen.
    if (k === 'g' && !e.repeat) { e.preventDefault(); state.onGive && state.onGive(); }
    // Set down what the arms carry (the statue), a step ahead of the feet.
    if (k === 'h' && !e.repeat) { e.preventDefault(); setDown(); }
    // The first Escape only frees the mouse (the browser ends the lock itself); the next one
    // leaves walk mode.
    if (k === 'escape') {
      e.preventDefault();
      if (document.pointerLockElement === dom || performance.now() - unlockedAt < 300) return;
      state.onExit && state.onExit();
    }
  };
  const onKeyUp = (e) => {
    const k = canon(e.key.toLowerCase());
    keys.delete(k);
    if (k === ' ') spaceHeld = false;
    if (k === 'c') releaseCrouch();
  };
  // A keyup that never arrives - the window losing focus with C held - would leave the
  // settler crouched for good, so anything that takes the keyboard away ends the crouch.
  // A nap survives it, the same as it survives letting go of the key.
  const onBlur = () => { spaceHeld = false; releaseCrouch(); };
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
  // on its way. The buttons themselves fight (Plans/DONE/aanvallen-en-blokkeren.md), one button per
  // hand: the left button is the left hand and the right button the right. A hand holding a
  // shield blocks for as long as its button is held; any other hand - a sword, a hammer, a
  // bare fist - attacks. It used to be the left button attacks and the right one blocks,
  // whatever you held, so a sword in the right hand raised an arm with nothing in it. The
  // right button never looks and acts on the press; the left attacks on the press under a
  // lock, and otherwise on a click that did not turn into a drag - and the one click that
  // takes the lock does not also swing. Its shield goes up on the press either way.
  let dragging = false, lastX = 0, lastY = 0, pressX = 0, pressY = 0, pressMoved = false, pressLocks = false;
  const CLICK_PX = 6;
  let lockRefused = !dom.requestPointerLock;
  // A click that asked for the lock and was turned down anyway. Some hosts refuse every
  // request with a WrongDocumentError (the desktop app's browser pane does, measured) and
  // that same error is also what an unfocused window gets, so it cannot mean "never" - but
  // after one refused click the next ones swing again, or the left button would do nothing
  // at all there. A lock that does arrive puts this back.
  let clickLockFailed = false;
  // Not with the arms already busy: swimming, lying down, sitting, or at a tiller.
  const canFight = () => state.active && !state.paused && !state.working && !state.swimming && !state.lying && !state.sitting
    && !state.vehicle && !rides() && !state.carry && !state.digging;
  // One swing of `side`'s hand, if it may fight at all. `onSwing` hears of every swing the
  // arm actually started - main.js puts it on the wire (net.js swing()), which is what makes
  // the button hit something on the sea rather than only move an arm - and of none it
  // refused, so a mashed button is not a volley the sea sees and nobody else does. A shield
  // up in the other hand is no reason not to: the sea takes a swing from a blocker.
  // `side` goes with it, so everybody else sees that arm come down (Plans/DONE/andere-spelers-zoals-jij.md).
  // A swing ends a dance: fighting is doing something else with your arms.
  const fight = (side) => {
    if (!canFight() || !classicAvatar.attack(side)) return;
    state.dancing = false;
    if (onSwing) onSwing(side);
  };
  const SIDE_OF = { 0: 'leftArm', 2: 'rightArm' };
  const shieldIn = (side) => classicAvatar.held(side) === 'shield';
  function guardUp(side, on) {
    if (on) state.dancing = false;              // and so does a shield going up
    state.guard[side] = on;
    state.blocking = state.guard.leftArm || state.guard.rightArm;
  }
  function lowerShields() { guardUp('leftArm', false); guardUp('rightArm', false); }
  // A beer's button drinks instead (Plans/DONE/bier-en-dronken.md) - its own hand's button, like
  // every hand's here. Everything that stops a fight stops a drink too, except a stool:
  // sitting at the bar is what a beer is for. A glass is no shield, so a drink never goes
  // near `guardUp` and never into `blocking`, which the sea would take for a raised guard.
  const canDrink = () => state.active && !state.paused && !state.working && !state.swimming && !state.lying
    && !state.vehicle && !rides() && !state.carry && !state.digging;
  const beerIn = (side) => classicAvatar.held(side) === 'beer';
  // What a hand's button does on the press or the click, for any hand that is not a shield
  // (whose button holds rather than acts - guardUp above).
  // A sip the rig actually took is told to `onDrink`, for everybody else to see it too.
  const act = (side) => { if (!beerIn(side)) fight(side); else if (canDrink() && classicAvatar.drink(side) && onDrink) onDrink(side); };
  const wantLock = () => state.active && !state.paused && !state.working && !lockRefused;
  function requestLock(fromClick = false) {
    if (document.pointerLockElement === dom) return;
    // Not while Escape is down: a panel closed with Escape asks for the lock inside that very
    // keydown, the browser grants it - and then handles the same Escape as the user leaving a
    // lock, which takes it straight back (measured in the desktop window: ok, then
    // pointerlockchange twice, lock gone, and the cooldown below started for nothing). Asked
    // after the key is up, it stays.
    if (escDown) { lockAfterEsc = true; return; }
    // A request without a user gesture is refused, except straight after a lock the page
    // itself let go of - which is exactly the close-a-panel and walk-off-a-board case. The
    // refusal is a rejected promise in current Chrome; only NotSupportedError means never.
    try {
      dom.requestPointerLock()?.catch?.((err) => {
        if (err?.name === 'NotSupportedError') lockRefused = true;
        else if (err?.name === 'SecurityError') lockAgainSoon();
        else if (fromClick) clickLockFailed = true;
      });
    } catch { lockRefused = true; }
  }
  // After the user's own Escape Chromium refuses a new lock for about 1.3 s ("cannot be
  // acquired immediately after the user has exited the lock", a SecurityError; measured in the
  // desktop window: refused at 0.3 s and 0.8 s, given at 1.5 s). So Escape and then a click
  // - or a panel's close button - at once did nothing at all. The click's activation lasts
  // five seconds, which outlasts the wait, so the request is simply made again when the
  // cooldown is over. Not a failed click: it must not turn later clicks into swings.
  let escDown = false, lockAfterEsc = false;
  addEventListener('keydown', (e) => { if (e.key === 'Escape') escDown = true; }, true);
  addEventListener('keyup', (e) => {
    if (e.key !== 'Escape') return;
    escDown = false;
    if (!lockAfterEsc) return;
    lockAfterEsc = false;
    setTimeout(() => { if (wantLock() && document.pointerLockElement !== dom) requestLock(); }, 60);
  }, true);
  addEventListener('blur', () => { escDown = false; lockAfterEsc = false; });
  const LOCK_COOLDOWN_MS = 1300;
  let lockAgain = null, lockAgainTries = 0;
  function lockAgainSoon() {
    if (lockAgain || lockAgainTries >= 4) return;
    lockAgainTries++;
    lockAgain = setTimeout(() => {
      lockAgain = null;
      if (wantLock() && document.pointerLockElement !== dom) requestLock();
    }, Math.max(150, LOCK_COOLDOWN_MS - (performance.now() - unlockedAt)) + 50);
  }
  function syncLock() {
    if (wantLock()) requestLock();
    else if (document.pointerLockElement === dom) document.exitPointerLock?.();
  }
  // When the lock went away, so the Escape that took it does not also leave walk mode: the
  // keydown can reach the page either side of the pointerlockchange that says it is gone.
  let unlockedAt = -Infinity;
  // Chrome's first pointermove after a lock is taken (and now and then one after focus moved)
  // carries the whole jump of the cursor since the last event as movementX/Y - hundreds of
  // pixels, which put camPitch straight on its limit: the camera looking at the sky after the
  // focus had been walked round the HUD (0.9.1). The first locked move is dropped, and so is any
  // single move bigger than a hand can make in one event.
  let freshLock = false;
  const LOOK_JUMP = 250;
  const onLockChange = () => {
    if (document.pointerLockElement === dom) { clickLockFailed = false; lockAgainTries = 0; freshLock = true; }
    else unlockedAt = performance.now();
  };
  document.addEventListener('pointerlockchange', onLockChange);
  const onDown = (e) => {
    if (!state.active) return;
    const side = SIDE_OF[e.button];
    if (!side) return;
    if (shieldIn(side) && canFight()) guardUp(side, true);
    if (e.button === 2) { if (!shieldIn(side)) act(side); return; }
    if (document.pointerLockElement === dom) { if (!shieldIn(side)) act(side); return; }
    pressLocks = wantLock() && !clickLockFailed;
    if (wantLock()) requestLock(true);
    dragging = true; pressMoved = false;
    lastX = pressX = e.clientX; lastY = pressY = e.clientY;
  };
  const onUp = (e) => {
    const side = SIDE_OF[e.button];
    if (!side) return;
    guardUp(side, false);
    if (e.button === 2) return;
    if (dragging && !pressMoved && !pressLocks && !shieldIn(side)) act(side);
    dragging = false; pressLocks = false;
  };
  // A second button pressed while one is already down is no pointerdown: Pointer Events
  // report it as a pointermove with `button` set (a "chorded" press), and its release the same
  // way, until the last button up is a real pointerup. Without this the shield held up in one
  // hand swallowed every swing of the other - you could block or fight, never both.
  const BUTTON_BIT = { 0: 1, 1: 4, 2: 2 };
  const onMove = (e) => {
    if (e.button >= 0 && BUTTON_BIT[e.button]) {
      if (e.buttons & BUTTON_BIT[e.button]) onDown(e); else onUp(e);
    }
    if (!state.active) return;
    const locked = document.pointerLockElement === dom;
    let dx = 0, dy = 0;
    if (locked) {
      dx = e.movementX; dy = e.movementY;
      if (freshLock || Math.abs(dx) > LOOK_JUMP || Math.abs(dy) > LOOK_JUMP) { freshLock = false; dx = dy = 0; }
    } else if (dragging) { dx = e.clientX - lastX; dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; }
    if (dragging && !pressMoved && Math.hypot(e.clientX - pressX, e.clientY - pressY) > CLICK_PX) pressMoved = true;
    if (!dx && !dy) return;
    if (dx) lookedAround();
    state.camYaw -= dx * 0.0042;
    state.camPitch = clamp(state.camPitch + dy * 0.0032, ...pitchRange());
  };
  // The wheel pulls the camera in and pushes it out, the same as it does from the sky. It
  // listens on the canvas and not the window, and gives up while an overlay owns the input,
  // so scrolling a panel of text never also zooms the island behind it.
  //
  // How far back is two things: `base`, what you are doing asks for (on foot, on the bike, at
  // a tiller), and `zoomPref`, what the wheel or a pinch asked for on top of it, which stays
  // yours from one to the next rather than being put back at every step ashore. At a tiller
  // it may go further out than on foot, since the base is already at the old limit there.
  let base = camBack, zoomPref = 1, back = camBack;
  const farthest = () => Math.max(camBack * 2.2, base * 1.4);
  function place(b) { base = b; back = clamp(base * zoomPref, camBack * 0.35, farthest()); }
  function zoomBy(f) {
    if (!Number.isFinite(f) || f <= 0) return;
    back = clamp(back * f, camBack * 0.35, farthest());
    zoomPref = back / base;
  }
  const onWheel = (e) => {
    if (!state.active || state.paused) return;
    e.preventDefault();
    // One notch past the nearest stop goes in behind the eyes, and the first notch out
    // comes back to that stop - never both in one notch, or a trackpad flick would flicker.
    if (state.firstPerson) { if (e.deltaY > 0) setFirstPerson(false); return; }
    if (e.deltaY < 0 && back <= camBack * 0.35 + 1e-9) { setFirstPerson(true); return; }
    zoomBy(Math.exp(clamp(e.deltaY, -240, 240) * 0.0016));
  };
  // From behind the eyes the camera may look nearly straight up and down; from behind the
  // back it may not, or it swings under the ground or over the head.
  // The mouse may look far up (SWIM_PITCH_MIN) in the water and on land alike: a swimmer sees where
  // they are heading with it, a diver climbs on it (diving.js lookRise), and a walker sees the sky
  // and the clouds. A camera that low would be under the ground, but cameraFloor holds it above and
  // placeCamera raises the aim by as much as it was pushed, so looking up still looks up - the body
  // slides down out of the frame instead, which is the price of the sky. It used to stop at -0.25 on
  // land; `relaxPitch` is what is left of that, easing a pitch back into a range that shrank.
  const pitchRange = () => (state.firstPerson ? [-1.35, 1.35] : [SWIM_PITCH_MIN, 0.95]);
  function relaxPitch(dt) {
    const lo = pitchRange()[0];
    if (state.camPitch < lo) state.camPitch = Math.min(lo, state.camPitch + (lo - state.camPitch) * (1 - Math.exp(-8 * dt)) + 1e-4);
  }
  // The island's camera keeps its near plane half a cell out, which in first person would
  // cut away the hands and everything in them. Pulled in only while we are looking out of
  // the head, since a near plane that close costs depth precision at the horizon.
  const FP_NEAR = 0.03, FP_BACK = 0.3;
  const fpEye = new THREE.Vector3(), fpLook = new THREE.Vector3();
  // The near plane the camera was made with. The boom (placeCamera) brings it in too while it is short.
  const nearBase = camera.near;
  function setFirstPerson(on) {
    if (state.firstPerson === on) return;
    state.firstPerson = on;
    if (on) camera.near = Math.min(nearBase, FP_NEAR);
    else {
      camera.near = nearBase;
      back = camBack * 0.35;
      zoomPref = back / base;
      state.camPitch = clamp(state.camPitch, -0.25, 0.95);
    }
    camera.updateProjectionMatrix();
  }
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
  const LOCKED_CODES = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => 'Key' + c)
    .concat('Tab', ...Array.from({ length: 9 }, (_, i) => 'Digit' + (i + 1)));
  function lockKeys(on) {
    // The desktop window has no tabs to lose and no HTML fullscreen for the lock to wait for.
    if (globalThis.PROMPTHOLM_DESKTOP) return;
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
  // And how far down one frame follows the ground before it is a fall: well over a quay's tread
  // (0.075) or a steep hillside at a run, well under a pier's height over the water.
  const STEP_DOWN = 0.35;

  // A room's floors and stairs as rectangles rather than cells (Plans/verdiepingen-binnen.md):
  // a cell is four metres, and a balcony is half of one deep and a stair a whole storey in one.
  // `{ x0, x1, z0, z1, y }` is a floor; `{ ..., y0, y1, axis: 'x' | 'z' }` a slope rising from y0
  // at the x0 (or z0) end to y1 at the other, which is how a stair is walked - drawn as treads,
  // stood on as a ramp, so every step up is a frame's worth and a stair down is simply followed.
  // A room hands over its storeys; the island hands over the planks that do not fill a cell - a
  // pier's ramp and the wings of its head (buildings.js pierSurfaces), the quay's finger jetties
  // (quay-basin.js kadeSurfaces) - which it drew and walk mode stood in the water beside. Those
  // carry `lid`: a floor over the water is also what a swimmer under it hits their head on, as
  // a cell of `levels` is (ceilingAt). A room's floors do not, which is how rooms always were.
  // Outside, the tops of the solids that have one join them (`top`: a crate, a boulder - web/js/solids.js),
  // and the whole lot is looked up through an index rather than scanned (Plans/hitboxes-en-looppaden.md).
  let surfaces = [];
  let tops = [];
  let surfaceIndex = createSolidIndex();
  const indexSurfaces = () => { surfaceIndex = createSolidIndex(surfaces.concat(tops)); };
  function surfaceY(s, x, z) {
    // a solid's top (solids.js topOf: round, or turned by `yaw`) has no corners of its own
    if (s.x0 == null) return surfaceHeight(s, x, z);
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
    if (s.y != null) return s.y;
    const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
    if (!s.steps) return s.y0 + (s.y1 - s.y0) * t;
    // A stair drawn as `steps` treads, each with its top on the slope at its own middle (the
    // Kraken's, scripts/krakenroom/shell.py stair()): stood on tread by tread, as drawn. On the
    // ramp the feet were half a riser into the front of every tread and half one over the back of
    // it. The camera takes the risers up smoothly (camStep).
    const lo = Math.min(s.y0, s.y1), hi = Math.max(s.y0, s.y1);
    const u = s.y1 >= s.y0 ? t : 1 - t;
    const i = Math.min(s.steps - 1, Math.max(0, Math.floor(u * s.steps)));
    return lo + (hi - lo) * (i + 0.5) / s.steps;
  }

  // A stair's sides, as walls (Plans/verdiepingen-binnen.md). From below: a `solid` stair is built
  // up to its treads (the Kraken's, a block of timber under every one), so it is a wall to feet more
  // than a step under it; one on stringers only where its boards would meet the body. From on it:
  // a side in its `rails` ('x0' | 'x1' | 'z0' | 'z1', the drawn handrail's edge) holds whoever is
  // on the treads, as a deck's rail does - you went off the side of a railed flight to the floor,
  // or walked in under it and stood in its treads. Only ever against a step into it, never out, so
  // whoever is somehow already in there is let go.
  const STAIR_RAIL = 0.35;
  function stairWall(s, x, z, from) {
    const px = state.pos.x, pz = state.pos.z;
    // The stair under a body's edge, not only under its middle: a body half into the flight is in it.
    const near = (qx, qz) => {
      const cx = Math.min(s.x1, Math.max(s.x0, qx)), cz = Math.min(s.z1, Math.max(s.z0, qz));
      return Math.abs(cx - qx) < BODY_R && Math.abs(cz - qz) < BODY_R ? surfaceY(s, cx, cz) : null;
    };
    const y = near(x, z);
    if (y != null) {
      const was = near(px, pz);
      const under = (h) => (s.solid ? h - from > STEP_UP : h - from > STEP_UP && h - from < HEAD);
      if (under(y) && !(was != null && under(was))) return true;
    }
    for (const side of s.rails || []) {
      const alongX = side[0] === 'z';                  // a rail on a z edge runs along x
      const edge = s[side], inward = side[1] === '0' ? 1 : -1;
      const e = ((alongX ? z : x) - edge) * inward, e0 = ((alongX ? pz : px) - edge) * inward;
      if (Math.abs(e) >= BODY_R || !(Math.abs(e) < Math.abs(e0) || Math.sign(e) !== Math.sign(e0))) continue;
      const a = alongX ? x : z;
      if (a < (alongX ? s.x0 : s.z0) || a > (alongX ? s.x1 : s.z1)) continue;
      const cx = alongX ? x : Math.min(s.x1, Math.max(s.x0, x)), cz = alongX ? Math.min(s.z1, Math.max(s.z0, z)) : z;
      const h = surfaceY(s, cx, cz);
      // The rail stands from the treads up: a wall to any body that span meets, on the flight or
      // beside it on the floor, where it would otherwise have stepped up onto the flight through it.
      if (h != null && from < h + STAIR_RAIL && from + HEAD > h) return true;
    }
    return false;
  }

  // The bridges, as the planks are drawn (buildings.js bridgeDeckOf, props.js deckShapesOf): a run
  // along any direction, straight between its stops, `w` either side of its line, with a rail
  // along both edges and, for an arch, stone under it outside its opening. Per cell (`levels`) an
  // arch was a staircase whose treads stood up to 0.2 above or below the boards, which you
  // climbed through going up and came down floating over, and wider than the deck: a hand past
  // the rails. What `setDecks` hands in is taken out of the levels by its caller.
  let decks = [];
  function takeDecks(list) {
    decks = (list || []).filter((d) => d && d.stops && d.stops.length > 1).map((d) => {
      const [ux, uz] = d.d, t1 = d.stops[d.stops.length - 1][0];
      const ends = [d.o, [d.o[0] + ux * t1, d.o[1] + uz * t1]];
      const pad = d.w + BODY_R + 0.05;
      return {
        ...d, t1,
        x0: Math.min(ends[0][0], ends[1][0]) - pad, x1: Math.max(ends[0][0], ends[1][0]) + pad,
        z0: Math.min(ends[0][1], ends[1][1]) - pad, z1: Math.max(ends[0][1], ends[1][1]) + pad,
      };
    });
  }
  // Along the run and across it, or null well off it.
  function deckFrame(d, x, z) {
    if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) return null;
    const rx = x - d.o[0], rz = z - d.o[1];
    return [rx * d.d[0] + rz * d.d[1], rx * d.d[1] - rz * d.d[0]];
  }
  function deckHeight(d, t) {
    const s = d.stops;
    if (t <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (t > s[i][0]) continue;
      const [ta, ya] = s[i - 1], [tb, yb] = s[i];
      return tb > ta ? ya + (yb - ya) * (t - ta) / (tb - ta) : yb;
    }
    return s[s.length - 1][1];
  }
  // The planks at (x, z), or null off them.
  function deckY(d, x, z) {
    const f = deckFrame(d, x, z);
    if (!f || f[0] < 0 || f[0] > d.t1 || Math.abs(f[1]) > d.w) return null;
    return deckHeight(d, f[0]);
  }
  // What a deck is underneath: the boards' own thickness, or under an arch its soffit.
  const DECK_THICK = 0.06;
  // A deck's rail and its stone, as a wall: only ever to a step that goes into it from outside,
  // or closer to a rail's line from beside it, so nobody who is somehow in one is held there (the
  // Kraken's stair taught that: "karakter zit vast"). A rail stops the storey its deck is on - the
  // feet on the boards, not a swimmer under them, whose head is below the boards plus RAIL_FROM.
  const RAIL_FROM = 0.2;
  function deckWall(d, x, z, from) {
    const f = deckFrame(d, x, z);
    if (!f) return false;
    const was = deckFrame(d, state.pos.x, state.pos.z) || [f[0], Infinity];
    const [t, w] = f;
    if (d.rail && t >= 0 && t <= d.t1) {
      const e = Math.abs(w) - d.w, e0 = Math.abs(was[1]) - d.w;
      if (Math.abs(e) < BODY_R && (Math.abs(e) < Math.abs(e0) || Math.sign(e) !== Math.sign(e0))) {
        const y = deckHeight(d, t);
        if (from < y + d.rail && from + BODY_H > y + RAIL_FROM) return true;
      }
    }
    if (d.open && Math.abs(w) < d.w + BODY_R) {
      const inStone = (tt) => (tt >= -BODY_R && tt < d.open[0]) || (tt > d.open[1] && tt <= d.t1 + BODY_R);
      const oldIn = Math.abs(was[1]) < d.w + BODY_R && inStone(was[0]);
      if (inStone(t) && !oldIn && from < deckHeight(d, t) - d.soffit) return true;
    }
    return false;
  }

  function levelsIn(x, z) {
    const key = cellKey(x, z);
    // Null out at sea: there is nothing there to be on a level of, and `levels.get(null)`
    // would quietly answer for whatever happened to be stored under it.
    return key === null ? undefined : levels.get(key);
  }

  // The highest surface that is not over your head. `from` is where your feet are now;
  // leaving it out asks for the topmost one, which is what something looking down from
  // outside the world wants.
  // The harbour's stone quay: the top of its wall over the foot cell (which the ground itself
  // draws as a slope from the bed) and the treads of its stairs - shared/quay-basin.mjs, the
  // same answer the sea gives its settlers - or null off it. So a swimmer meets a wall (blocked,
  // below) and climbs out by a stair.
  function kadeAt(x, z) {
    const region = ground?.regionAt?.(x, z);
    const kade = region && quayKade(region.village, region.terrain);
    return kade ? kade.height(...region.toLocal(x, z)) : null;
  }
  function groundAt(x, z, from = Infinity, withSurfaces = true) {
    const wall = kadeAt(x, z);
    let best = wall != null ? wall : heightUnder(x, z);
    const reach = from + STEP_UP;
    surfaceIndex.some(x, z, 0, (s) => {
      if (!withSurfaces && s.lid) return false;
      const y = surfaceY(s, x, z);
      if (y != null && y <= reach && y > best) best = y;
      return false;
    });
    for (const d of decks) {
      const y = deckY(d, x, z);
      if (y != null && y <= reach && y > best) best = y;
    }
    const above = levelsIn(x, z);
    if (!above) return best;
    for (const y of above) if (y <= reach && y > best) best = y;
    return best;
  }

  // The sea floor under a diver: what is DRAWN there, which is not what `groundAt` says. The
  // archipelago's `height()` is the logical water (an island's grid ramps to OPEN_SEA over its
  // outer four cells, and between islands it is flat), while `bedAt` is the bed the diver can
  // see and touch - the island mesh as it is drawn, the shoals, the banks and the trenches
  // (shared/seabed.mjs). Where the archipelago has none - a room, the workbench, a sea from
  // before it - it falls back to the height, so a diver simply finds the old flat floor. The
  // quay's wall and its stairs stand on that floor, as groundAt reads them.
  const bedOf = ground && ground.bedAt ? (x, z) => ground.bedAt(x, z) : heightUnder;
  function bedUnder(x, z) {
    const wall = kadeAt(x, z);
    return wall != null ? wall : bedOf(x, z);
  }

  // The lowest surface above you, or Infinity under the open sky. This is the half that
  // makes "under" mean anything: without it a swimmer below a deck jumps straight through
  // it and lands on top, and a tunnel is just a differently shaped hill.
  function ceilingAt(x, z, from) {
    let best = Infinity;
    const reach = from + STEP_UP;
    // A deck over your head: its boards' underside, or under an arch its soffit.
    for (const d of decks) {
      const y = deckY(d, x, z);
      if (y == null || y <= reach) continue;
      const lid = y - (d.open ? d.soffit : DECK_THICK);
      if (lid < best) best = lid;
    }
    // And an island plank over your head (a pier head, a finger jetty): the ones that carry `lid`.
    for (const s of surfaces) {
      if (!s.lid) continue;
      const y = surfaceY(s, x, z);
      if (y != null && y > reach && y < best) best = y;
    }
    const above = levelsIn(x, z);
    if (!above) return best;
    for (const y of above) if (y > reach && y < best) best = y;
    return best;
  }

  // Is there dry land within arm's reach? Only asked when placing somebody (see `blocked`),
  // so a step ashore or a walk-mode entry never sets you down out at sea.
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
  // One solid, grown by a body's radius: a circle for what is round (`r`, see ROUND in
  // buildings.js), a rectangle - turned by its `yaw` if it has one - for everything else
  // (web/js/solids.js insideSolid).
  // A blocker with a height (`y0`..`y1`, a room's upper floor: Plans/verdiepingen-binnen.md) is a
  // wall only to a body whose feet-to-head span meets it - the table below does not close the
  // gallery over it. `blocked` asks that (`atHeight`, which knows the feet); without the two
  // it is a wall at every height, as every blocker always was.
  const inside = insideSolid;

  const BODY_H = 0.45;
  // How high a solid's `top` may be over your feet and still be walked onto: a porch's step (0.18) or
  // a flat stone, not a crate or a bench - those take a jump (JUMP_V reaches 0.38). Not STEP_UP, which
  // is how far a *floor* is followed up (a bridge's deck over its bank) and would climb you onto every
  // bench you walked past.
  const STEP_ONTO = 0.2;
  const atHeight = (b, feet) => b.y0 == null || (feet < b.y1 && feet + BODY_H > b.y0
    && !(b.top && b.y1 - feet <= STEP_ONTO));

  // The blockers that are a ship's side (a Batavia at anchor: buildings.js shipSolids) are
  // kept apart as well, for the boats. Feet and swimmers meet every blocker as a wall at any
  // height, as they always have; a hull under way asks the ground, and a ship lying on the
  // roads is not in the ground - so the ground a boat is handed is the terrain and the levels
  // with her sides stood up out of the water on top (boat.js hullOver).
  let hulls = [];
  let blockerIndex = createSolidIndex();
  // A `floor` in the list (a building's porch: solids.js porchFloor) is only its top: stood on, never
  // bumped into.
  let camBodies = createSolidIndex();
  function takeBlockers(list) {
    camBodies = createSolidIndex(cameraBodies ? cameraBodies() : []);
    state.blockers = list || [];
    hulls = state.blockers.filter((b) => b.hull != null);
    blockerIndex = createSolidIndex(state.blockers.filter((b) => !b.floor));
    tops = state.blockers.filter((b) => (b.top || b.floor) && b.y1 != null).map(topOf);
    indexSurfaces();
  }
  // Without the island's surfaces: a hull has always met a pier as its cells, and the head's wings
  // reach out towards the berths either side of it - a boat lying there must not find itself aground.
  const boatGround = (x, z) => hullOver(hulls, x, z, groundAt(x, z, Infinity, false));

  // A blocker with `hop` is a low boundary - a rail, a paling fence (hamlets.js borderSolids) - that a
  // jump takes you over: in the air it is open, on the ground a wall. By height alone it could not be
  // done: at a walk a jump carries you 0.3 and stays over a rail's top for a fifth of that, and a
  // body and a rail together are 0.42 across. `hopping` asks as if in the air, which is how a parked
  // body on a route finds out that a jump would get it on (update below). And one you came down in
  // the middle of is one you walk out of, as out of a person: a jump that falls short lands astride it.
  // And any other solid you already stand in is one you may walk out of, never further in
  // (`leaving`, Plans/muren-met-hitboxes.md): a scan, an Apply or a guest island putting a building
  // up round you, or a jump coming down on a crate's side, used to leave every step blocked and you
  // stood in it until you left walk mode.
  // TEMPORARY: trees (world.js tags their trunks `tree`) and the low hamlet fences (hamlets.js
  // tags them `fence`, below HOP_H) are walked and ridden through - on the phone, riding across
  // the island ran into one every few metres. Rails and every other `hop` blocker stay walls.
  // Set PASS_TREES_AND_FENCES false to have them back.
  const PASS_TREES_AND_FENCES = true;
  const passedThrough = (b) => PASS_TREES_AND_FENCES && (b.tree === true || b.fence === true);
  function blocked(x, z, from = state.pos.y, placing = false, hopping = !state.grounded) {
    // Water is no wall to a swimmer any more (see SWIM_SPEED). Only a placement still wants
    // a shore close by - unboard's step-back loop relies on it to find the beach rather than
    // drop you in the channel beside the hull.
    if (placing && groundAt(x, z, from) < 0.06 && !shoreWithinReach(x, z, from)) return true;
    // The quay's wall is a wall to whoever is further below its top than a step: a swimmer beside
    // the face, a diver at its foot. groundAt reads the top absolutely, so without this a swimmer
    // pushing at the face was put on the quay in one frame, half a metre up, and a diver found the
    // quay's top as the bed under them. From the stairs (in front of the face, never a foot cell)
    // and from the quay itself it is a step, as before.
    const wall = kadeAt(x, z);
    if (wall != null && wall - from > STEP_UP) return true;
    const open = hopping && !placing;
    const astride = (b) => !placing && inside(b, state.pos.x, state.pos.z, BODY_R);
    // A `dry` blocker (the low block under the Salty Kraken's stair: buildings.js pirateSolids) keeps
    // feet from walking in under a flight; a swimmer goes under the planks as under a pier.
    const walls = (b) => !passedThrough(b) && !(b.dry && state.swimming) && atHeight(b, from);
    // Out of several at once, the way out of all of them together: the step has to lower the depth
    // summed over every solid you stand in, not each one's. Overlapping boxes each have their own
    // shortest way out, and a body that came down where they overlap (off the Salty Kraken's
    // boarding plank, into its rocks and a kraken arm: issue #89) found every step deeper into one
    // of them, and could not swim off. In a single solid this is the rule it always was.
    let inNow = null, depthNow = 0;
    const leaving = (b) => {
      if (placing) return false;
      if (!inNow) {
        inNow = [];
        blockerIndex.some(state.pos.x, state.pos.z, BODY_R, (c) => {
          if (walls(c) && depthInSolid(c, state.pos.x, state.pos.z, BODY_R) > 0) inNow.push(c);
          return false;
        });
        for (const c of inNow) depthNow += depthInSolid(c, state.pos.x, state.pos.z, BODY_R);
      }
      if (!inNow.includes(b)) return false;
      let depth = 0;
      for (const c of inNow) depth += Math.max(0, depthInSolid(c, x, z, BODY_R));
      return depth < depthNow - 1e-6;
    };
    if (blockerIndex.some(x, z, BODY_R, (b) => walls(b) && inside(b, x, z, BODY_R)
      && !(b.hop && (open || astride(b))) && !leaving(b))) return true;
    for (const d of decks) if (deckWall(d, x, z, from)) return true;
    for (const s of surfaces) if (s.axis && stairWall(s, x, z, from)) return true;
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
    putBikeAway();
    state.vehicle = boat;
    standUp();
    // A statue in the arms goes onto the hull: a pilot has both hands on the tiller.
    if (state.carry) putOnBoat(boat);
    // Both hands to the tiller: a shield held up on the way aboard is let go of, or it
    // would ride along in the pose (net.js drops the flag afloat, but the arm would not).
    lowerShields();
    state.crouching = false;
    state.lying = false;
    state.swimming = false;
    state.grounded = true;
    state.vy = 0;
    // Further back for a bigger hull: behind the wheel of a galleon at a rowing boat's
    // distance, all you see is the mizzen mast.
    place(camBack * ((boat.craft && boat.craft.camScale) || 2.2));
    // Straight behind the bow from the first stroke: a look from before you boarded is not
    // a look round the boat.
    riddenSinceLook = Infinity;
  }

  // Ashore at `at`, which is where the bow is pointing. The same step-back loop `enter`
  // uses, so you never land inside a wall or in the water you have just crossed - and if
  // forty tries find nothing legal you stay aboard, which is a stuck boat rather than a
  // drowned settler.
  // ---- on a deck (Plans/DONE/lopen-op-de-boot.md, fase 3) --------------------------------------
  // Walking a hull that may be moving: where you stand is kept in the hull's own frame
  // (state.deck, shared/deck.mjs) and the world position is worked out from it every frame,
  // so the planks carry you however the boat turns. Only on a hull whose craft has room for
  // more than its pilot (the galleon; the Benchy's whole deck is her helm). `deckBoat` is the
  // hull object itself, the same one state.boats and the fleet loop hold.
  let deckBoat = null;
  let deckJump = false;
  // On a rope ladder, up to a ship or down from her (see stepClimb), and the way a body that has
  // just gone over the side carries the hull's speed into the air and the water (`drift`).
  let climb = null;
  let drift = null;
  // The way a jumper took off with, in units a second (AIR_STEER); on the ground it is simply
  // the way the feet went this frame.
  const airWay = { x: 0, z: 0 };
  // Every boat there is, for the ladders at their sides: main.js hands it over (setBoats) and it
  // is read live, since boats come and go with the fleet.
  let boatsOf = () => [];
  const isFollowing = (b) => (following ? !!following(b) : false);
  const frameOf = (b) => ({ x: b.x, z: b.z, fx: Math.sin(b.yaw), fz: Math.cos(b.yaw) });
  const specOf = (b) => (b && b.craft && b.craft.spec) || null;
  function offDeck() { state.deck = null; deckBoat = null; deckJump = false; climb = null; }
  // A ship left running. Off her deck - over the rail, or off her ladder - a heavy hull has way on
  // her still, and nothing steps a boat that nobody is aboard: she froze where you jumped, which
  // is no run-out at all. So the page that was sailing her carries on doing it (`loose`; main.js
  // calls runOut(dt) every frame, in every mode) and says where she gets to on the same beat as
  // before - the sea takes the position of whoever let go of the wheel for her `runOut`
  // (lib/boats.mjs letGo). It steps her only while nothing else does: on her deck, at her wheel or
  // on her ladder update() is already at it. Escape is not this - exitWalk stops her on purpose.
  const RUNNING = 0.05;
  let loose = null;
  const heavy = (b) => { const s = specOf(b); return !!(s && s.sail && s.sail.runOut); };
  function letRun(b) { loose = b && heavy(b) && Math.abs(b.v || 0) > RUNNING ? b : null; }
  const onHull = (b) => b === deckBoat || b === state.vehicle || !!(climb && climb.boat === b);
  // The hull we are running out, or null: she is not once she has stopped, once somebody else has
  // the wheel, or while we are on her again.
  function runningOut() {
    const b = loose;
    if (!b) return null;
    if (Math.abs(b.v || 0) <= RUNNING || isFollowing(b)) { loose = null; return null; }
    return onHull(b) ? null : b;
  }
  function runOut(dt) {
    const b = runningOut();
    if (b) stepBoat(b, {}, dt, boatGround);
    return b;
  }
  // A hull is a reference plane (boat.js hullPointOf): where you stand on it is a point of its own
  // frame, and where that is in the world - height, and x and z too, because a hull that pitches
  // and rolls moves its deck sideways as well as up - is read off the transform it is drawn with
  // this frame, after main.js has posed it. `plane` is the plane's tilt while you are on one, for
  // the body to lean with it and the camera to ride it; it is null on the ground and in the water.
  const swellAt = new THREE.Vector3();
  const planeQ = new THREE.Quaternion();
  const camTilt = new THREE.Quaternion();
  const camOff = new THREE.Vector3();
  const planeUp = new THREE.Vector3();
  let plane = null;
  // The camera's share of a tread the feet have just taken (see afterMove), and where they stood.
  let camStep = 0, stepFrom = null;
  const CAM_STEP_RATE = 12;
  function hullPoint(b, lx, y, lz) {
    if (poseHull) poseHull(b);
    return hullPointOf(b, lx, y, lz, swellAt);
  }
  function planeOf(b) {
    plane = b && b.craft && b.craft.object ? hullTiltOf(b, planeQ) : null;
  }
  // From the helm onto the deck, a pace forward of the wheel.
  function leaveHelm() {
    const b = state.vehicle, spec = specOf(b);
    if (!b || !spec || spec.crew < 2) return false;
    let x = spec.helm[0], z = spec.helm[1] + 0.6;
    let y = deckAt(spec, x, z);
    if (y === null) return false;
    // A pace forward of the wheel, wherever the model has room for one: the plinth the wheel stands
    // on, the bulkhead and the ship's own props are all in the way of some of the places that are not.
    const surface = b.craft && b.craft.walk;
    if (surface) {
      const at = nearestStand(surface, x, z, y + 0.2);
      if (!at) return false;
      ({ x, z, y } = at);
    }
    state.vehicle = null;
    deckBoat = b;
    state.deck = { boat: b.id, x, z, y, vy: 0, grounded: true, yaw: 0 };
    state.swimming = false;
    place(camBack * 1.5);
    return true;
  }
  // Back to the wheel: the same board() as climbing in from the dock.
  function takeHelm() {
    const b = deckBoat;
    if (!b) return false;
    offDeck();
    board(b);
    return true;
  }
  // How far you are from the wheel. Nothing else is asked of a deck: there is no key for
  // stepping ashore or over the side - you jump, or you take the ladder - so the only thing
  // E does up here is the helm.
  function deckWhere() {
    const spec = specOf(deckBoat);
    if (!state.deck || !spec) return null;
    const d = state.deck;
    // And how far from the seat in her crow's nest, when you are up in it (craft.nest), and whether you
    // are sitting on it: E there sits you down or stands you up.
    const n = spec.nest;
    const away = n && !climb && d.y > n.floor ? Math.hypot(d.x - n.seat.x, d.z - n.seat.z) : Infinity;
    const nest = away <= (n ? n.reach : 0) ? away : null;
    return { helm: Math.hypot(d.x - spec.helm[0], d.z - spec.helm[1]), boat: deckBoat, nest, seat: n ? n.seat : null, seated: !!d.seat };
  }

  // ---- rope ladders (Plans/DONE/lopen-op-de-boot.md, "Instappen") --------------------------------
  // The way aboard a ship, and the way off her that is not a jump. No key: walk into the foot of
  // one from the water or a quay and you climb it, walk out over the side at the head of one on
  // the deck and you climb down. A climb is a *path* in the hull's frame (shared/deck.mjs
  // ladderPath), so a ship that pitches under you moves you with her and cannot shake you off -
  // but where you are on it is yours: pushing at the hull is a rung up, pushing away a rung
  // down, and with no push you hang where you are. Off the top is the deck, off the bottom the
  // water, and a jump lets go where you hang. The sea hears of it at the two ends
  // (`onBoarded`, `onLeftDeck`): before the top you are not crew, and after the foot you are not.
  // 0.45, not the 1.8 it was: a rope ladder is climbed by Mixamo's Climbing Up A Ladder on the
  // Adventurer, a cycle per 0.12 of height, and at 1.8 that was fifteen cycles a second (the keeper
  // chose slower over a body gliding past its hands, 6 Oct 2026). The ship's side now takes ~4 s.
  const CLIMB_SPEED = 0.29;
  // Onto a ladder and off it, where the body is drawn changes in one frame although the feet do
  // not move: a swimmer is drawn treading water TREAD_SINK under where the feet are reckoned
  // (diving.js swimPose), a climber at the feet - so the body dropped 0.28 coming off the foot of the
  // galleon's ladder into the water and rose as much taking it - and a swimmer is pitched forward. So
  // when a climb begins or ends, the body is drawn from where it was a frame ago and eased onto where
  // it now belongs over STEP_OFF_S, as the rig eases its pose (classic-avatar.js LADDER_FADE). Drawing
  // only: the feet, the camera and what the sea is told are where walk mode put them.
  const STEP_OFF_S = 0.5;
  let onRope = false, stepOff = 0;
  const drawnAt = new THREE.Vector3(), drawnQ = new THREE.Quaternion(), stepOffAt = new THREE.Vector3(), stepOffQ = new THREE.Quaternion(), stepOffTo = new THREE.Quaternion();
  function stepOffEase(dt) {
    if (!!climb !== onRope) {
      onRope = !!climb;
      stepOff = 1;
      stepOffAt.copy(drawnAt);
      stepOffQ.copy(drawnQ);
    }
    if (stepOff > 0) {
      stepOff = Math.max(0, stepOff - dt / STEP_OFF_S);
      const k = 1 - stepOff, t = k * k * (3 - 2 * k);
      avatar.position.lerpVectors(stepOffAt, avatar.position, t);
      avatar.quaternion.slerpQuaternions(stepOffQ, stepOffTo.copy(avatar.quaternion), t);
    }
    drawnAt.copy(avatar.position);
    drawnQ.copy(avatar.quaternion);
  }
  const CLIMB_DEAD = 0.3;
  const climbAt = { x: 0, z: 0, y: 0 }, climbWas = { x: 0, z: 0, y: 0 };
  // What the rig is to make of where a climb is (web/js/ladder-way.js): on the rungs - `rise` and `at`,
  // the height gained this frame and the height above the foot - and over the top, `top` 0..1 through
  // Mixamo's Climbing Up A Ladder To Standing; `floor` whether its foot is a floor to step onto it from
  // (classic-avatar.js plays Start Climbing Ladder there). Null on the reach to the foot and on from
  // the top: only on the rungs and over the top does the rig climb.
  function climbingAt(c, rise, at) {
    const on = onWay(c.way, c.d);
    return on ? { rise, at, top: on.top, floor: c.floor } : null;
  }
  // How hard the stick pushes along the hull's own x (+ to starboard), from where the camera
  // looks: the one number a ladder asks of it, since a ladder is on the side of the hull. What
  // takes you onto a ladder and what moves you on it are the same reading, or approaching one
  // backwards (S, camera turned away) would start a climb that the next frame calls a descent.
  function pushOnHull(frame, ix, iz) {
    const w = pushInWorld(ix, iz);
    return w ? dirToLocal(frame, w[0], w[1])[0] : 0;
  }
  // The stick as a push in the world, no longer than 1, or null when it is not pushed at all.
  function pushInWorld(ix, iz) {
    const len = Math.hypot(ix, iz);
    if (len < 0.05) return null;
    const push = Math.min(1, len);
    // The same turn from the camera's frame to the world's that the step itself makes.
    return [((Math.sin(state.camYaw) * iz - Math.cos(state.camYaw) * ix) / len) * push,
      ((Math.cos(state.camYaw) * iz + Math.sin(state.camYaw) * ix) / len) * push];
  }
  // How hard the stick pushes along a fixed ladder's `out` (away from what it hangs on), in the world.
  function pushOut(l, ix, iz) {
    const w = pushInWorld(ix, iz);
    return w ? w[0] * l.out[0] + w[1] * l.out[1] : 0;
  }

  // ---- rope ladders that stand still (issue #86) -------------------------------------------------
  // A building's (the Salty Kraken's, up its hull from the zigzag's landing: buildings.js
  // pirateClimbs, turned and placed by main.js): two ends in the world, `lo` where a climber stands at
  // the foot and `hi` where they step off at the head, the way from one to the other along the ground
  // being the way they face it. Taken and climbed exactly as a ship's (above) - walk into the foot
  // facing it, or out over the end at its head - with the hull's frame being the world's. The sea
  // hears nothing of it: a climber is a walker at a height, which every pose already carries.
  let fixedLadders = [];
  const FIXED_HW = 0.3;            // how far either side of the ropes' middle you may stand and take it
  function setClimbs(list) {
    fixedLadders = (list || []).map((l) => {
      const dx = l.lo.x - l.hi.x, dz = l.lo.z - l.hi.z;
      const len = Math.hypot(dx, dz) || 1;
      return { lo: l.lo, hi: l.hi, out: [dx / len, dz / len], onTop: l.onTop || null };
    });
  }
  // The fixed ladder a body standing here is at the foot of and pushing into (`dir` 1), or at the head
  // of and pushing out over (`dir` -1), or null. Out over the head is the harder push, as on a deck.
  function fixedAhead(ix, iz) {
    if (!fixedLadders.length || Math.hypot(ix, iz) < CLIMB_DEAD) return null;
    const { x, y, z } = state.pos;
    for (const l of fixedLadders) {
      for (const [end, dir] of [[l.lo, 1], [l.hi, -1]]) {
        if (Math.abs(y - end.y) > 0.3) continue;
        const dx = x - end.x, dz = z - end.z;
        const along = dx * l.out[0] + dz * l.out[1];
        const across = Math.abs(dx * l.out[1] - dz * l.out[0]);
        if (across > FIXED_HW) continue;
        // at the foot: in front of the rungs; at the head: on the plank, between where you step off
        // and its end (0.36 beyond), so that walking out to the end takes the ladder and not the drop
        if (dir > 0 ? along < -0.25 || along > 0.35 : along < -0.2 || along > 0.6) continue;
        const push = pushOut(l, ix, iz);
        // squarely, both ways: the foot stands on a landing people cross, and a diagonal across it
        // in front of the rungs is not a reach for them
        if (dir > 0 ? -push >= 0.7 : push >= 0.8) return { ladder: l, dir };
      }
    }
    return null;
  }
  function startFixedClimb(l, dir) {
    const at = { x: state.pos.x, y: state.pos.y, z: state.pos.z };
    const top = { x: l.lo.x, y: l.hi.y + 0.06, z: l.lo.z };
    const way = dir > 0 ? climbWay([l.lo, top, l.hi], at) : climbWayDown([l.lo, top, l.hi], at);
    standUp();
    lowerShields();
    state.crouching = false;
    state.swimming = false;
    state.grounded = true;
    state.vy = 0;
    drift = null;
    climb = { boat: null, fixed: l, way, path: way.path, len: way.len, d: dir > 0 ? 0 : way.len, floor: true, letGo: false };
  }
  function stepFixedClimb(dt, ix, iz) {
    const c = climb, l = c.fixed;
    stepPool(state.stamina.body, false, dt);
    state.turbo = false;
    // Towards what it hangs on is up, whichever way you are looking.
    const toward = -pushOut(l, ix, iz);
    const wish = toward > CLIMB_DEAD ? 1 : toward < -CLIMB_DEAD ? -1 : 0;
    const was = pathAt(c.path, c.d, climbWas).y;
    c.d = climbAlong(c.way, c.d, wish, dt, CLIMB_SPEED);
    const p = pathAt(c.path, c.d, climbAt);
    // `at`: how high on the ladder, from its foot - rung 0 - which is what puts the hands and feet of
    // the climb on its rungs (classic-avatar.js climbPhase).
    state.climbing = climbingAt(c, p.y - was, p.y - l.lo.y);
    state.pos.set(p.x, p.y, p.z);
    state.yaw = Math.atan2(-l.out[0], -l.out[1]);
    state.moving = wish !== 0;
    state.running = false;
    state.swimming = false;
    state.grounded = true;
    state.floor = state.pos.y;
    state.vy = 0;
    state.bob += dt * (wish !== 0 ? 7 : 1.5);
    const end = (q) => {
      climb = null;
      state.climbing = null;
      state.pos.set(q.x, q.y, q.z);
      state.floor = groundAt(q.x, q.z, q.y + 0.05);
      state.moving = false;
    };
    // A ladder that goes on through a hatch (the Salty Kraken's, up to her deck) is left at its
    // head by whoever owns the other side: `onTop`, with the body still on the top rung.
    if (wish > 0 && c.d >= c.len && l.onTop) { climb = null; state.climbing = null; l.onTop(); }
    else if (wish > 0 && c.d >= c.len) end(c.path[c.path.length - 1]);
    else if (wish < 0 && c.d <= 0) end(c.path[0]);
    else if (c.letGo) {
      // Let go where you hang: down onto whatever is under you.
      climb = null;
      state.climbing = null;
      state.grounded = false;
      state.moving = false;
      state.floor = groundAt(p.x, p.z, p.y);
    }
    return afterMove(dt);
  }
  // The ladder of any boat that a body pushing at the hull is standing at the foot of, or null.
  function ladderAhead(ix, iz) {
    if (Math.hypot(ix, iz) < CLIMB_DEAD) return null;
    for (const b of boatsOf()) {
      const spec = specOf(b);
      if (!spec || !spec.ladders || !spec.ladders.length) continue;
      // A ship is thirteen long and her ladders inside that: further than that is nowhere near one.
      if (Math.hypot(state.pos.x - b.x, state.pos.z - b.z) > 7) continue;
      const frame = frameOf(b);
      const [lx, lz] = toLocal(frame, state.pos.x, state.pos.z);
      const ly = state.pos.y - DECK_Y - (b.craft && b.craft.object ? b.craft.object.position.y : 0);
      const ladder = ladderUp(spec, lx, lz, ly, pushOnHull(frame, ix, iz));
      if (ladder) return { boat: b, ladder, from: { x: lx, z: lz, y: ly } };
    }
    return null;
  }
  // Whether somebody standing at x, y, z (scene coordinates, the feet) is hanging on a rope ladder
  // this page knows - a ship's or a fixed one - and which way they face it, or null. peers.js asks it
  // of every other player: a climber is a walker at a height (no pose bit), and it is the one place
  // a walker is drawn at the height they sent rather than on the ground under them.
  // On the step over a ladder's top (web/js/ladder-way.js) it says how far over (`top`), so the
  // other page plays the same clip there as this one.
  function ladderAt(x, y, z) {
    for (const l of fixedLadders) {
      const yaw = Math.atan2(-l.out[0], -l.out[1]);
      if (!l.way) l.way = climbWay([l.lo, { x: l.lo.x, y: l.hi.y + 0.06, z: l.lo.z }, l.hi]);
      const top = y > l.way.path[1].y - 0.01 ? topNear(l.way, { x, y, z }) : null;
      if (top !== null) return { yaw, at: y - l.lo.y, top, floor: true };
      if (Math.hypot(x - l.lo.x, z - l.lo.z) > 0.2) continue;
      if (y < l.lo.y + 0.15 || y > l.hi.y + 0.08) continue;
      return { yaw, at: y - l.lo.y, floor: true };
    }
    const sea = (WATER_Y - SWIM_SINK) - DECK_Y;
    for (const b of boatsOf()) {
      const spec = specOf(b);
      if (!spec || !spec.ladders || !spec.ladders.length) continue;
      if (Math.hypot(x - b.x, z - b.z) > 7) continue;
      const frame = frameOf(b);
      const [lx, lz] = toLocal(frame, x, z);
      const ly = y - DECK_Y - (b.craft && b.craft.object ? b.craft.object.position.y : 0);
      for (const q of spec.ladders) {
        const w = climbWay(ladderPath(spec, q, sea));
        const top = ly > w.path[1].y - 0.01 ? topNear(w, { x: lx, y: ly, z: lz }) : null;
        if (top === null) continue;
        const [fx, fz] = dirToWorld(frame, q.x < 0 ? 1 : -1, 0);
        return { yaw: Math.atan2(fx, fz), at: ly - q.foot, top, floor: false };
      }
      const l = ladderHolding(spec, lx, lz, ly, sea);
      if (!l) continue;
      const [fx, fz] = dirToWorld(frame, l.x < 0 ? 1 : -1, 0);
      return { yaw: Math.atan2(fx, fz), at: ly - l.foot, floor: false };
    }
    return null;
  }
  // Onto the rope: `dir` 1 to climb it from the water, -1 to go down it from the deck. The path
  // starts (or, on the way down, ends) where the body actually is, so the first step is a reach for
  // the rung and not a jump to it.
  function startClimb(b, ladder, dir, at) {
    const spec = specOf(b);
    const sea = (WATER_Y - SWIM_SINK) - DECK_Y;
    const rope = ladderPath(spec, ladder, sea);
    // Where the ladder lands is a place on the model, and the nearest free one is where you step
    // down: a cannon can stand where a table of numbers said there was nothing. Worked out here, as
    // the end of the way up, and not on arriving - found then, it moved the feet 0.14 in one frame.
    const last = rope[rope.length - 1];
    const land = b.craft && b.craft.walk ? nearestStand(b.craft.walk, last.x, last.z, last.y) : null;
    if (land) rope[rope.length - 1] = { x: land.x, z: land.z, y: land.y };
    const way = dir > 0 ? climbWay(rope, at) : climbWayDown(rope, at);
    offDeck();
    standUp();
    lowerShields();
    state.crouching = false;
    state.swimming = false;
    state.grounded = true;
    state.vy = 0;
    drift = null;
    // `crew`: whether the sea has us aboard, which is whether we came off the deck. Her ladder's foot is
    // in the water (or at a quay's edge), so there is no step onto it from a floor.
    climb = { boat: b, ladder, way, path: way.path, len: way.len, d: dir > 0 ? 0 : way.len, side: ladder.x < 0 ? -1 : 1, crew: dir < 0, floor: false, letGo: false };
  }
  function stepClimb(dt, ix, iz) {
    if (climb.fixed) return stepFixedClimb(dt, ix, iz);
    if (climb.aloft) return stepMastClimb(dt, ix, iz);
    const c = climb, b = c.boat;
    const frame = frameOf(b);
    if (!isFollowing(b)) stepBoat(b, {}, dt, boatGround);
    stepPool(state.stamina.body, false, dt);
    stepPool(state.stamina.boat, false, dt);
    state.turbo = false;
    // Towards the hull is up: the way you were pushing to get on, whichever way you are looking.
    const toward = -c.side * pushOnHull(frame, ix, iz);
    const wish = toward > CLIMB_DEAD ? 1 : toward < -CLIMB_DEAD ? -1 : 0;
    // The rise along the rope in the hull's frame, so her swell is not a climb.
    const was = pathAt(c.path, c.d, climbWas).y;
    c.d = climbAlong(c.way, c.d, wish, dt, CLIMB_SPEED);
    const p = pathAt(c.path, c.d, climbAt);
    state.climbing = climbingAt(c, p.y - was, p.y - c.ladder.foot);
    state.pos.copy(hullPoint(b, p.x, p.y, p.z));
    planeOf(b);
    const x = state.pos.x, z = state.pos.z;
    // Face the hull, up or down: a ladder is climbed looking at it.
    const [fx, fz] = dirToWorld(frame, -c.side, 0);
    state.yaw = Math.atan2(fx, fz);
    state.moving = wish !== 0;
    state.running = false;
    state.sprinting = false;
    state.swimming = false;
    state.grounded = true;
    state.floor = state.pos.y;
    state.vy = 0;
    state.bob += dt * (wish !== 0 ? 7 : 1.5);
    if (wish > 0 && c.d >= c.len) {
      // Off the top: on the deck, where the ladder lands, crew from here on.
      // (where the ladder lands: the nearest free place on her model, worked out in startClimb)
      const last = c.path[c.path.length - 1];
      climb = null;
      deckBoat = b;
      state.deck = { boat: b.id, x: last.x, z: last.z, y: last.y, vy: 0, grounded: true, yaw: state.yaw - b.yaw };
      place(camBack * 1.5);
      // Up with the statue on the back: on her deck as cargo, as a hull takes whatever comes aboard
      // carried (board()); `stowed` tells main.js the book wants to hear of it.
      const stowed = !!state.carry && putOnBoat(b);
      if (state.onBoarded) state.onBoarded(b, { stowed });
    } else if (c.letGo) {
      // Let go where you hang: falling from there, with the hull's way on you like any jump off her.
      const away = hullVelocity(frame, b.v || 0);
      // Over deep water the statue on the back stays with the ship (her cargo again), since nobody swims
      // with her (letGo 'water') and the shore she was carried from may be an islet away.
      if (state.carry && canDive(groundAt(x, z, WATER_Y), WATER_Y)) putOnBoat(b);
      climb = null;
      state.grounded = false;
      state.vy = 0;
      state.moving = false;
      state.floor = groundAt(x, z, WATER_Y);
      drift = away.vx || away.vz ? { x: away.vx, z: away.vz } : null;
      place(camBack);
      if (c.crew) letRun(b);
      if (c.crew && state.onLeftDeck) state.onLeftDeck(b);
    } else if (wish < 0 && c.d <= 0) {
      // Off the bottom: in the water beside her, or on the quay if that is what she lies at.
      const first = c.path[0];
      const [wx, wz] = toWorld(frame, first.x, first.z);
      const g = groundAt(wx, wz, WATER_Y);
      // Not into deep water with the statue on the back (nobody swims with her): you hang at the foot,
      // and up again she goes back on her deck. Lowered into the rowing boat (lowerOff) is the way down.
      if (state.carry && canDive(g, WATER_Y)) { blockedBy('carry'); return afterMove(dt); }
      climb = null;
      state.pos.set(wx, g < 0 ? WATER_Y - SWIM_SINK : g, wz);
      state.floor = g;
      state.swimming = g < 0;
      state.moving = false;
      place(camBack);
      if (c.crew) letRun(b);
      if (c.crew && state.onLeftDeck) state.onLeftDeck(b);
    }
    return afterMove(dt);
  }
  // ---- up the mast (Plans/DONE/kraaiennest.md) -----------------------------------------------------------
  // A ship's ladder to her crow's nest (craft.aloft, shared/deck.mjs aloftPath): taken from her deck by
  // pushing into its foot, and from the nest by pushing out over its head, climbed as her side's are.
  // Both ends are on her, so it is a climb that never leaves the deck: `deckBoat` stays hers, and
  // `state.deck` is kept on the point of the rope you hang at - which is what net.js sends (`on` + `d`),
  // so the sea and every other page have you on her, up her mast, with no new message. Let go and you
  // fall from there onto whatever of her is under you, as off any ledge of hers (stepHull).
  function startMastClimb(b, l, dir) {
    const d = state.deck;
    const at = { x: d.x, z: d.z, y: d.y };
    const rope = aloftPath(l);
    const way = dir > 0 ? climbWay(rope, at) : climbWayDown(rope, at);
    standUp();
    lowerShields();
    state.crouching = false;
    state.dancing = false;
    deckJump = false;
    climb = { boat: b, aloft: l, way, path: way.path, len: way.len, d: dir > 0 ? 0 : way.len, crew: true, floor: true, letGo: false };
  }
  function stepMastClimb(dt, ix, iz) {
    const c = climb, b = c.boat, l = c.aloft;
    const frame = frameOf(b);
    if (!isFollowing(b)) stepBoat(b, {}, dt, boatGround);
    stepPool(state.stamina.body, false, dt);
    stepPool(state.stamina.boat, false, dt);
    state.turbo = false;
    // Towards the mast is up, whichever way you are looking.
    const w = pushInWorld(ix, iz);
    const [px, pz] = w ? dirToLocal(frame, w[0], w[1]) : [0, 0];
    const toward = -(px * l.out[0] + pz * l.out[1]);
    const wish = toward > CLIMB_DEAD ? 1 : toward < -CLIMB_DEAD ? -1 : 0;
    const was = pathAt(c.path, c.d, climbWas).y;
    c.d = climbAlong(c.way, c.d, wish, dt, CLIMB_SPEED);
    const p = pathAt(c.path, c.d, climbAt);
    state.climbing = climbingAt(c, p.y - was, p.y - l.foot);
    state.pos.copy(hullPoint(b, p.x, p.y, p.z));
    planeOf(b);
    const [fx, fz] = dirToWorld(frame, -l.out[0], -l.out[1]);
    state.yaw = Math.atan2(fx, fz);
    state.moving = wish !== 0;
    state.running = false;
    state.sprinting = false;
    state.swimming = false;
    state.grounded = true;
    state.floor = state.pos.y;
    state.vy = 0;
    state.bob += dt * (wish !== 0 ? 7 : 1.5);
    deckJump = false;
    const surface = b.craft && b.craft.walk;
    // On her, where the rope is: what the sea and the other pages are told.
    state.deck = { boat: b.id, x: p.x, z: p.z, y: p.y, vy: 0, grounded: true, yaw: state.yaw - b.yaw };
    const off = (q) => {
      // Off an end of it: onto her, at the nearest place her model has room for a body.
      const at = surface ? nearestStand(surface, q.x, q.z, q.y + 0.05) : null;
      climb = null;
      state.climbing = null;
      state.moving = false;
      state.deck = { boat: b.id, x: at ? at.x : q.x, z: at ? at.z : q.z, y: at ? at.y : q.y, vy: 0, grounded: true, yaw: state.yaw - b.yaw };
    };
    if (wish > 0 && c.d >= c.len) off(c.path[c.path.length - 1]);
    else if (wish < 0 && c.d <= 0) off(c.path[0]);
    else if (c.letGo) {
      // Let go where you hang: falling, in her frame, onto her deck below - or past her side.
      climb = null;
      state.climbing = null;
      state.moving = false;
      state.grounded = false;
      state.deck.grounded = false;
    }
    return afterMove(dt);
  }

  // ---- sitting on a deck ---------------------------------------------------------------------------
  // A seat on a ship (her crow's nest, craft.nest): a place in her frame, so she carries you as she
  // carries anybody standing on her (hullPoint), and the sea is told the seat as your deck position,
  // with the SITTING bit every page already draws. Getting up puts you back where you stood to sit.
  function sitOnDeck(seat) {
    const d = state.deck, b = deckBoat;
    if (!d || !b || climb) return false;
    if (state.carry) { blockedBy('carry'); return false; }
    cancelDig('reset');
    state.crouching = false;
    state.lying = false;
    state.crouchSince = 0;
    state.dancing = false;
    const from = { x: d.x, z: d.z, y: d.y };
    Object.assign(d, { x: seat.x, z: seat.z, y: seat.y, vy: 0, grounded: true, yaw: seat.yaw, seat: { from } });
    state.sitting = { x: state.pos.x, z: state.pos.z, y: state.pos.y, yaw: b.yaw + seat.yaw, since: performance.now(), deck: true };
    keys.clear();
    deckJump = false;
    return true;
  }
  // Up off a deck's seat: onto where you stood before, if it is still somewhere to stand.
  function leaveDeckSeat() {
    const d = state.deck;
    if (!d || !d.seat) return;
    const { from } = d.seat;
    d.seat = null;
    d.x = from.x; d.z = from.z; d.y = from.y;
    d.vy = 0;
    d.grounded = true;
  }
  // One frame seated on a deck: carried by the hull, and up on the first step or a jump.
  function stepDeckSeat(dt, ix, iz) {
    const b = deckBoat, d = state.deck;
    if (!isFollowing(b)) stepBoat(b, {}, dt, boatGround);
    stepPool(state.stamina.body, false, dt);
    stepPool(state.stamina.boat, false, dt);
    state.turbo = false;
    const push = Math.min(1, Math.hypot(ix, iz));
    if (deckJump || (push > 0.02 && performance.now() - state.sitting.since > SIT_HOLD_MS)) {
      deckJump = false;
      standUp();
      return stepOnDeck(dt, ix, iz, false);
    }
    state.pos.copy(hullPoint(b, d.x, d.y, d.z));
    planeOf(b);
    state.yaw = b.yaw + d.yaw;
    Object.assign(state.sitting, { x: state.pos.x, z: state.pos.z, y: state.pos.y, yaw: state.yaw });
    state.moving = false;
    state.running = false;
    state.sprinting = false;
    state.swimming = false;
    state.grounded = true;
    state.floor = state.pos.y;
    state.vy = 0;
    frameDistance = 0;
    return afterMove(dt);
  }
  // One frame on the deck. The hull coasts on under nobody's hand (gas off, the same
  // stepBoat), the feet step in its frame, and the body is put back in the world from there.
  function stepOnDeck(dt, ix, iz, boost) {
    if (state.deck.seat && state.sitting) return stepDeckSeat(dt, ix, iz);
    const b = deckBoat, spec = specOf(b);
    if (!isFollowing(b)) stepBoat(b, {}, dt, boatGround);
    const push = Math.min(1, Math.hypot(ix, iz));
    const turbo = stepPool(state.stamina.body, boost && push > 0.02, dt);
    stepPool(state.stamina.boat, false, dt);
    state.turbo = turbo;
    let wx = 0, wz = 0;
    state.moving = push > 0.02;
    if (state.moving) {
      const len = Math.hypot(ix, iz);
      forward.set(Math.sin(state.camYaw), 0, Math.cos(state.camYaw));
      right.set(-Math.cos(state.camYaw), 0, Math.sin(state.camYaw));
      wx = ((forward.x * iz + right.x * ix) / len) * push;
      wz = ((forward.z * iz + right.z * ix) / len) * push;
    }
    const frame = frameOf(b);
    const [lx, lz] = dirToLocal(frame, wx, wz);
    const d = state.deck;
    const deckX = d.x, deckZ = d.z;
    // Out over the side at the head of a ladder: down it, rather than against the rail.
    if (d.grounded && state.moving) {
      const ladder = ladderDown(spec, d.x, d.z, lx);
      // With the statue on this hull she comes down too, on the back: a climber never leaves her
      // behind on a ship there is no other way back onto.
      if (ladder) {
        const taking = state.cargo && state.cargo.hull === b;
        startClimb(b, ladder, -1, { x: d.x, z: d.z, y: d.y });
        if (taking) cargoToArms();
        return stepClimb(dt, ix, iz);
      }
      // Into the foot of a ladder up her mast, or out over the head of one from her top. The statue on
      // her deck stays there: the mast is still her.
      const mast = aloftUp(spec, d.x, d.z, d.y, lx, lz) || aloftDown(spec, d.x, d.z, d.y, lx, lz);
      if (mast && state.carry) blockedBy('carry');   // a rope ladder wants both hands
      else if (mast) { startMastClimb(b, mast, d.y < mast.floor - 0.3 ? 1 : -1); return stepClimb(dt, ix, iz); }
    }
    // A ship is walked on her own model (shared/hullwalk.mjs), whatever has no model on the plain
    // rectangles of its craft.
    const surface = b.craft && b.craft.walk;
    // The body's own speeds (avatar-gait.js GAITS), and on a deck as on land: a sprint while the
    // pool lasts, a run once it is spent.
    const jog = boost && push > 0.02;
    const walking = { speed: turbo ? classicAvatar.speeds.sprint : jog ? classicAvatar.speeds.run : classicAvatar.speeds.walk, radius: BODY_R, jumpV: JUMP_V, gravity: GRAVITY };
    if (surface) stepHull(d, { x: lx, z: lz, jump: deckJump }, surface, dt, walking);
    else stepDeck(d, { x: lx, z: lz, jump: deckJump }, spec, dt, walking);
    deckJump = false;
    frameDistance = Math.hypot(d.x-deckX, d.z-deckZ);
    state.moving = frameDistance > 1e-6;
    // Facing: where you walk, and kept relative to the hull while you stand, so she can turn
    // under you without you spinning on the spot.
    if (state.moving) {
      state.yaw = Math.atan2(wx, wz);
      d.yaw = state.yaw - b.yaw;
    } else {
      state.yaw = b.yaw + d.yaw;
    }
    state.pos.copy(hullPoint(b, d.x, d.y, d.z));
    planeOf(b);
    const x = state.pos.x, z = state.pos.z;
    state.floor = state.pos.y;
    state.grounded = d.grounded;
    state.vy = d.vy;
    state.running = jog && state.moving;
    state.sprinting = turbo && state.moving;
    state.swimming = false;
    state.bob += dt * (state.moving ? 6 : 1);
    // Off the planks: over the bulwark on a jump, or through a gap in the rail. Nothing is
    // teleported - the body goes on from where it is, in the air, with the way the hull had on
    // her (the jump off a ship at speed is a splash ahead of where you stood, not beside it) and
    // lands on whatever is below: the water, or a quay she lies at.
    if (d.off) {
      const away = hullVelocity(frame, b.v || 0);
      offDeck();
      state.grounded = false;
      airTop = state.pos.y;
      state.swimming = false;
      state.vy = d.vy;
      state.floor = groundAt(x, z, WATER_Y);
      drift = away.vx || away.vz ? { x: away.vx, z: away.vz } : null;
      place(camBack);
      letRun(b);
      if (state.onLeftDeck) state.onLeftDeck(b);
      // Over the rail with the statue: it goes with you, in your arms, and not left on a hull you are
      // no longer on (there is no way back to it from the water).
      if (state.cargo) takeOffBoat();
    }
    return afterMove(dt);
  }

  // `water`: over the side instead, wherever the boat is - no shore wanted, and you come up
  // swimming beside the hull.
  function unboard(at, { water = false } = {}) {
    if (!state.vehicle && !state.deck) return false;
    let [x, z] = at;
    let ok = !blocked(x, z, undefined, !water);
    for (let i = 0; i < 40 && !ok; i++) {
      x += 0.25; z += 0.18;
      ok = !blocked(x, z, undefined, !water);
    }
    if (!ok) return false;
    if (water && groundAt(x, z) < WATER_Y) {
      // The statue is not put in the sea: it stays on the hull until there is a shore to carry it to.
      if (state.cargo) { blockedBy('carry'); return false; }
      state.vehicle = null;
      offDeck();
      place(camBack);
      state.pos.set(x, WATER_Y - SWIM_SINK, z);
      state.floor = groundAt(x, z);
      state.grounded = true;
      state.swimming = true;
      state.vy = 0;
      return true;
    }
    state.vehicle = null;
    offDeck();
    place(camBack);
    state.pos.set(x, groundAt(x, z), z);
    state.floor = state.pos.y;
    state.grounded = true;
    state.vy = 0;
    // Ashore, the statue comes with you - in the arms, since the hull is not under you any more.
    if (state.cargo) takeOffBoat();
    return true;
  }

  // On the bike. It appears under you facing the way you face - it comes out of the satchel
  // rather than standing anywhere, so nothing about it has to be remembered by anybody
  // (Plans/DONE/fiets.md) - and only from where a bike could stand: feet on dry ground, nothing
  // else in your hands' way. The camera pulls back a little; a bicycle is longer than a
  // settler and you steer it rather than walk it.
  let bikeMesh = null;
  let hopWanted = false;
  // Seconds ridden since the camera was last turned by hand (see the bike branch of update).
  let riddenSinceLook = Infinity;
  function lookedAround() { riddenSinceLook = 0; }
  // Which ride F gives the body you wear: the Adventurer and the Wanderer ride a horse, the Traveller his bicycle -
  // the keeper's choice of 6 October 2026 (Plans/paard-in-plaats-van-fiets.md).
  const rideKind = () => (classicAvatar.character !== 'traveller' ? 'horse' : 'bike');
  function rides() { return state.bike || state.mount; }
  let horse = null;
  function mount() {
    if (!bikes || !state.active || state.paused || state.working || state.vehicle || rides()) return false;
    if (state.carry) { blockedBy('carry'); return false; }
    if (state.digging) return false;
    if (!state.grounded || state.swimming || state.sitting || state.lying) return false;
    if (rideKind() === 'horse') {
      // The horse comes out of nowhere under you, as the bike comes out of the satchel - but only
      // where a horse fits: the middle, the chest and the rump on dry ground and in nothing solid.
      const x = state.pos.x, z = state.pos.z, y = state.pos.y;
      const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
      for (const d of [0, MOUNT_NOSE, -MOUNT_RUMP]) {
        const px = x + fx * d, pz = z + fz * d;
        if (groundAt(px, pz, y) < MOUNT_SHORE || blocked(px, pz, y, true)) return false;
      }
      if (!horse) horse = createMount({ scene, material, seed: 'mount:me' });
      if (!horse) return false;
      state.mount = mountAt(x, z, state.yaw, y);
      horse.visible = true;
    } else {
      if (groundAt(state.pos.x, state.pos.z, state.pos.y) < BIKE_SHORE) return false;
      if (!bikeMesh) bikeMesh = createBicycle({ scene, material });
      state.bike = bikeAt(state.pos.x, state.pos.z, state.yaw, state.pos.y);
      bikeMesh.visible = true;
    }
    lowerShields();
    state.crouching = false;
    state.crouchSince = 0;
    state.dancing = false;
    state.vy = 0;
    place(camBack * (state.mount ? 1.6 : 1.35));
    return true;
  }

  // Off it, and put away. Stepped off to the left, then the right, then where the saddle was,
  // whichever is somewhere to stand - the same "somewhere legal" test a landing from a boat uses.
  // A horse is wider than a frame: off it at 0.45 rather than 0.3.
  function dismount() {
    const b = rides();
    if (!b) return false;
    const reach = state.mount ? 0.45 : 0.3, shore = state.mount ? MOUNT_SHORE : BIKE_SHORE;
    const lx = Math.cos(b.yaw), lz = -Math.sin(b.yaw);   // the rider's left hand
    let at = [b.x, b.z];
    for (const side of [reach, -reach]) {
      const x = b.x + lx * side, z = b.z + lz * side;
      if (!blocked(x, z, b.y, true) && groundAt(x, z, b.y) >= shore) { at = [x, z]; break; }
    }
    putBikeAway();
    state.pos.set(at[0], groundAt(at[0], at[1], b.y), at[1]);
    state.floor = state.pos.y;
    state.grounded = true;
    state.vy = 0;
    return true;
  }

  function toggleBike() { if (rides()) dismount(); else mount(); }

  // The bike or the horse gone without a step: for leaving walk mode, boarding a boat, sitting
  // down, changing into the other body.
  function putBikeAway() {
    hopWanted = false;
    if (!rides()) return;
    state.bike = null;
    state.mount = null;
    if (bikeMesh) bikeMesh.visible = false;
    if (horse) horse.visible = false;
    place(camBack);
  }

  // `y` is the height the feet were at, for a room with storeys (main.js's room recall, web/js/
  // room-spot.js): the floor is found from there, as walking finds it, rather than the highest one
  // over (x, z) - which put a body remembered under a gallery on top of it.
  function enter({ at, y = Infinity, facing, pitch, blockers, interactables, onInteract, onSendAway, onPlant,
    onNextSeed, onPrevSeed, onBuild, onAvatar, onExit, onRelease, onToggleMinimap, onGive,
    onBoarded, onLeftDeck }) {
    takeBlockers(blockers);
    climb = null;
    drift = null;
    state.onBoarded = onBoarded || null;
    state.onLeftDeck = onLeftDeck || null;
    state.onGive = onGive;
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
    // step back until we are standing somewhere legal - judged from the height we would stand at
    // there, not from wherever the body last was: from the floor under it, a stair built solid is a
    // wall, and a spawn on its treads was walked off to the side of it.
    for (let i = 0; i < 40 && blocked(x, z, groundAt(x, z, y), true); i++) { x += 0.4; z += 0.25; }
    state.pos.set(x, groundAt(x, z, y), z);
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
    state.parked = false;
    state.route = null;
    zzz.visible = false;
    avatar.visible = true;
    camDive = 0;                             // whatever a dive left of the camera's rules
    armLen = Infinity;                       // and a boom from wherever we were before
    keys.clear();
    lockKeys(true);
    syncLock();
  }

  function exit() {
    revive();
    setFirstPerson(false);
    // The camera is somebody else's from here (the sky's, a room's): its near plane as it was made.
    setNear(nearBase);
    armLen = Infinity;
    plane = null;
    camera.up.copy(PLANE_UP);
    state.vehicle = null;
    offDeck();
    putBikeAway();
    place(camBack);
    // Inactive before the release, or release() would ask for the lock back on the way out.
    state.active = false;
    release();
    lowerShields();
    lockKeys(false);
    avatar.visible = false;
    lounge.visible = false;
    standUp();
    keys.clear();
    stick.x = 0; stick.z = 0; stick.run = false; padCrouch = false; spaceHeld = false; padJump = false;
    if (document.pointerLockElement === dom) document.exitPointerLock?.();
    state.parked = false;
    state.route = null;
    zzz.visible = false;
  }

  // Up into the sky, leaving the body where it stands: everything exit() lets go of (the
  // keys, the lock, the camera, the bike, a lounge) goes, but the figure stays drawn and
  // update() keeps stepping it - asleep, or walking a route given from above. `at` puts it
  // somewhere first: the islander's start (main.js parkOnSquare) has never walked yet.
  function park({ at = null, facing = null, blockers = null } = {}) {
    exit();
    state.dancing = false;
    // main.js hands the island's solids with every park. They were dropped here, so a body parked
    // at boot walked its routes - and its route search, blockedAt - through every house on the island.
    if (blockers) takeBlockers(blockers);
    if (at) {
      let [x, z] = at;
      for (let i = 0; i < 40 && blocked(x, z, undefined, true); i++) { x += 0.4; z += 0.25; }
      state.pos.set(x, groundAt(x, z), z);
      state.floor = state.pos.y;
      state.vy = 0;
      state.grounded = true;
      state.yaw = facing ? Math.atan2(facing[0] - x, facing[1] - z) : state.yaw;
    }
    state.parked = true;
    avatar.visible = true;
  }

  // Walk the parked body along `points` ([[x, z], ...], local coordinates - findPath's own
  // output). Null stops it where it is. Refused unless parked: on foot the feet are yours.
  function goTo(points) {
    if (!state.parked) return false;
    state.route = points && points.length ? points.map(([x, z]) => [x, z]) : null;
    state.routeBest = Infinity;
    state.routeSince = 0;
    return true;
  }
  // Where an A* over cells may not go, for main.js to hand findPath: the same test the feet
  // make, asked at a cell's middle.
  const blockedAt = (x, z) => blocked(x, z, undefined, true);
  // The floor a body standing at `from` finds at (x, z), or null when it could not be put there.
  const standFloor = (x, z, from = Infinity) => {
    const y = groundAt(x, z, from);
    return blocked(x, z, y, true) ? null : y;
  };

  function setBlockers(list) { takeBlockers(list); }
  function setPeerBlockers(list) { state.peerBlockers = list; }
  function setInteractables(list) { state.interactables = list; }

  // Re-dress the avatar in place. The mesh, its transform and everything driving it stay;
  // only the geometry is swapped, so a change made in the studio shows on your character
  // the instant you pick it, even mid-stride.
  function setAvatar(spec) {
    avatarLook = spec;
    classicAvatar.set(spec);
    // A body that does not ride what is under it gets off: the Traveller has no horse, the
    // Adventurer no bicycle.
    if (state.bike && rideKind() !== 'bike') dismount();
    if (state.mount && rideKind() !== 'horse') dismount();
    // A new look must not drop what the hands are doing: the rig starts from empty hands.
    if (state.carry && classicAvatar.setCarry) classicAvatar.setCarry(true, { quiet: true });
    if (state.digging && classicAvatar.dig) classicAvatar.dig(true);
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
    // A tap keeps you running until you stand still; holding it down works too. Afloat a
    // tap is one burst of turbo (update, aboard).
    if (!stick.x && !stick.z) stick.run = false;
    if (p.hit('sprint')) stick.run = !stick.run;
    if (p.down('sprint')) stick.run = true;
    if (Math.abs(p.look.x) > 0.05) lookedAround();
    state.camYaw -= p.look.x * 2.6 * dt;
    state.camPitch = clamp(state.camPitch + p.look.y * 1.7 * dt, ...pitchRange());
    // A finger on the glass (touchpad.js): a drag is a distance, turned like the mouse and
    // not by dt, and a pinch is a factor on how far back the camera sits.
    const raw = p.raw || p;
    if (raw.drag && (raw.drag.x || raw.drag.y)) {
      if (Math.abs(raw.drag.x) > 1) lookedAround();
      state.camYaw -= raw.drag.x * DRAG_YAW;
      state.camPitch = clamp(state.camPitch + raw.drag.y * DRAG_PITCH, ...pitchRange());
    }
    if (raw.zoom && raw.zoom !== 1) zoomBy(raw.zoom);
    if (p.hit('bike')) toggleBike();
    if (p.hit('jump')) jump();
    // Held, it swims a diver up - the pad's Space (update reads it).
    padJump = p.down('jump');
    if (p.hit('crouch') && !rides()) crouchToggle();
    if (p.hit('dance')) danceToggle();
    if (p.hit('putDown')) setDown();
    // Only the pad's own release stands you up again - a pad lying untouched on the desk
    // must not undo a crouch somebody started with C.
    const held = p.down('crouch');
    if (padCrouch && !held) releaseCrouch();
    padCrouch = held;
    // Off the bike first, as the keys do: these are all things done on foot.
    if (p.hit('interact') && state.near && !climb) { dismount(); state.onInteract && state.onInteract(state.near); }
    if (p.hit('secondary') && state.near) { dismount(); state.onSendAway && state.onSendAway(state.near); }
    if (p.hit('primary')) { dismount(); state.onPlant && state.onPlant(); }
    if (p.hit('nextTool')) state.onNextSeed && state.onNextSeed();
    if (p.hit('prevTool')) state.onPrevSeed && state.onPrevSeed();
    if (p.hit('exit') || p.hit('exitAlt')) state.onExit && state.onExit();
  }

  function setPaused(v) {
    state.paused = !!v;
    // The sprint toggle is state now, so it has to be dropped along with the rest - or you
    // come out of a conversation already running.
    if (v) { keys.clear(); stick.x = 0; stick.z = 0; stick.run = false; padCrouch = false; spaceHeld = false; padJump = false; }
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

  // A parked body's input: towards the next point of its route, as the (ix, iz) the keys
  // would give with the camera looking along +z (camYaw 0: forward is +z, right is -x).
  // A point is reached at ROUTE_NEAR; a body that has not got nearer for ROUTE_GIVE_UP
  // seconds (a wall the cell grid did not know about, another player) stops and sleeps.
  const ROUTE_NEAR = 0.35, ROUTE_GIVE_UP = 2;
  function routeInput(dt) {
    const r = state.route;
    while (r && r.length && Math.hypot(r[0][0] - state.pos.x, r[0][1] - state.pos.z) < (r.length > 1 ? ROUTE_NEAR : 0.15)) {
      r.shift();
      state.routeBest = Infinity;
    }
    if (!r || !r.length) { state.route = null; return [0, 0]; }
    const dx = r[0][0] - state.pos.x, dz = r[0][1] - state.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < state.routeBest - 0.02) { state.routeBest = d; state.routeSince = 0; }
    else if ((state.routeSince += dt) > ROUTE_GIVE_UP) { state.route = null; return [0, 0]; }
    return [-dx / d, dz / d];
  }

  // Sent home by the sea (`evicted` after a capture or a drowning), the body first goes down
  // where it stands: walk mode is held (paused, so no key or button does anything, while the
  // mouse still looks round), the rig plays its death (classic-avatar.js dyingPose, or Mixamo's
  // clip) and the poses we send keep it there, so everybody else sees it fall too (peers.js, on
  // the sea's `fell`). Returns how long it takes, lying still after included (DEATH_REST), for
  // main.js to jump home after; 0 when this
  // body cannot (a hull, a saddle, a ladder, a seat) and the jump should be at once. In the
  // water whatever did it, the body sinks: drowning or not, nobody falls over afloat.
  function die(kind) {
    // What the arms carry stays behind where the body goes down - before any answer, since a body
    // that cannot play a death is still taken home.
    if (state.carry) letGo('die');
    if (!state.active || state.parked || state.vehicle || rides() || state.deck || climb || state.sitting) return 0;
    cancelDig('hit');
    state.dancing = false;
    state.crouching = state.lying = false;
    state.guard.leftArm = state.guard.rightArm = false;
    state.blocking = false;
    keys.clear(); stick.x = 0; stick.z = 0; stick.run = false;
    state.paused = true;
    state.dying = { kind: state.swimming || kind === 'drown' ? 'drown' : 'fall', t: 0 };
    if (state.dying.kind === 'fall' && state.vy > 0) state.vy = 0;
    return (classicAvatar.dyingSeconds ? classicAvatar.dyingSeconds(state.dying.kind) : 0) + DEATH_REST;
  }
  function revive() {
    if (!state.dying) return;
    state.dying = null;
    state.paused = false;
  }
  function stepDying(dt) {
    const d = state.dying;
    d.t += dt;
    state.moving = state.running = state.sprinting = state.turbo = false;
    stepPool(state.stamina.body, false, dt);
    stepPool(state.stamina.boat, false, dt);
    const x = state.pos.x, z = state.pos.z;
    if (d.kind === 'drown') {
      // Slowly, from a standstill, to the bed and never through it.
      const sink = DROWN_SINK * dt * Math.min(1, d.t / 0.6);
      state.pos.y = Math.max(Math.min(state.pos.y, bedUnder(x, z) + 0.05), state.pos.y - sink);
      state.diving = headUnder(state.pos.y, WATER_Y);
    } else if (!state.grounded) {
      // Hit in the air: down onto whatever is under the feet first.
      state.vy -= GRAVITY * dt;
      state.pos.y += state.vy * dt;
      const g = groundAt(x, z, state.pos.y + STEP_UP);
      if (state.pos.y <= g) { state.pos.y = g; state.vy = 0; state.grounded = true; }
    }
    return afterMove(dt);
  }

  let frameDistance = 0;
  function update(dt) {
    frameDistance = 0;
    if (!state.active && !state.parked) return null;
    if (state.parked) {
      keys.clear();
      stick.x = 0; stick.z = 0;
      state.paused = false;
      state.camYaw = 0;
    }
    if (ownTipsy) stepTipsy(state.tipsy, dt);
    // The horse's pool fills whenever nobody is on it, whatever the body is doing meanwhile (as the
    // boat's does): ridden, stepMount below spends or fills it by the gait. One pool per walk mode,
    // not per horse - F always gives you the same one - so a horse left blown is blown when you
    // get back on, unless it has stood long enough.
    if (!state.mount) stepPool(state.stamina.horse, false, dt);
    if (state.dying) return stepDying(dt);
    // Quicker on the move and quicker still at a run, going by last frame's gait. A phase
    // that is added to rather than a time that is multiplied, or every change of gait would
    // jump the stagger to somewhere else in its swing.
    state.sway += dt * (state.running ? 1.4 : state.moving ? 1 : 0.55);
    if (state.paused) {
      stick.x = 0; stick.z = 0;
      cancelDig('paused');
      // A conversation is a rest: both pools go on filling behind it.
      stepPool(state.stamina.body, false, dt);
      stepPool(state.stamina.boat, false, dt);
      state.turbo = false;
      return { near: state.near, pos: state.pos, distance: 0 };
    }

    // Shift, or the pad's sprint toggle (which the phone's touchpad drives too). What it
    // means depends on where you are, and is decided below; this is only the asking.
    const boost = keys.has('shift') || stick.run;
    let ix = 0, iz = 0;
    if (keys.has('w') || keys.has('arrowup')) iz += 1;
    if (keys.has('s') || keys.has('arrowdown')) iz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
    // The keys' share of the bars apart, for the bike: a stick's steering is read differently
    // there (stickTurn in bicycle.js), or a thumb a few degrees off straight weaves the bike.
    const keyX = ix, stickX = stick.x, stickZ = stick.z;
    if (Math.abs(stick.x) > 0.01 || Math.abs(stick.z) > 0.01) { ix += stick.x; iz += stick.z; }
    stick.x = 0; stick.z = 0;   // the pad refills this every frame it is touched
    if (state.parked) [ix, iz] = routeInput(dt);

    plane = null;
    if (climb) return stepClimb(dt, ix, iz);
    if (state.deck && deckBoat) return stepOnDeck(dt, ix, iz, boost);

    // ---- aboard ------------------------------------------------------------
    // A boat is not feet, so `blocked` knows nothing about it: teaching it about vehicles
    // would have put a mode flag inside the collision test of every walking frame. The
    // vehicle simply steers instead of walking, and land is its wall. The sea is open to a
    // swimmer too, but at a fifth of the speed - that ratio is what the boat is for now.
    if (state.vehicle) {
      // Only ahead: the turbo lifts the top speed, and astern has nothing for it to lift.
      const turbo = stepPool(state.stamina.boat, boost && iz > 0.02, dt);
      // The pad's tapped sprint is one burst afloat. On foot it lasts until the stick is let
      // go, but at the helm the stick is the throttle and is never let go, so a tap held the
      // turbo open for good: the pool ran dry, refilled, and opened again. It ends when the
      // throttle comes off ahead or the pool runs dry - a held button (pad or touchpad) goes
      // on working like Shift, as pad() sets it again every frame it is down.
      if (iz <= 0.02 || state.stamina.boat.spent) stick.run = false;
      stepPool(state.stamina.body, false, dt);
      state.turbo = turbo;
      stepBoat(state.vehicle, { throttle: iz, turn: ix, turbo }, dt, boatGround);
      // At the helm, which on a ship is not the middle of the hull (boat.js SHIP_HELM): its
      // offset turned with the hull, forward being (sin, cos) of the yaw as everywhere here.
      const v = state.vehicle, h = v.craft && v.craft.helm;
      const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
      const hx = h ? h.x * c + h.z * s : 0, hz = h ? h.z * c - h.x * s : 0;
      // And on the plane at the wheel, swell and tilt and all (see hullPoint), not at the middle's
      // height over a flat frame.
      if (h && v.craft && v.craft.object) {
        state.pos.copy(hullPoint(v, h.x, h.y - DECK_Y, h.z));
        planeOf(v);
      } else state.pos.set(v.x + hx, v.deckY ?? DECK_Y, v.z + hz);
      state.yaw = state.vehicle.yaw;
      // The camera trails the bow rather than staying where the mouse left it. You steer
      // with a rudder here, not by walking towards what you are looking at, so a camera
      // that did not follow would leave you sailing sideways out of frame. But not while you
      // are looking round: like the bike, it waits until you have sailed RECENTRE_AFTER
      // without touching it and then eases back in. It used to pull every frame, which on a
      // phone - where looking is a drag and not a flick - meant you could not look at all.
      if (Math.abs(state.vehicle.v) > 0.05) riddenSinceLook += dt;
      const ease = clamp((riddenSinceLook - RECENTRE_AFTER) / RECENTRE_EASE, 0, 1);
      if (ease > 0) state.camYaw = lerpAngle(state.camYaw, state.vehicle.yaw, Math.min(1, dt * 2.5 * ease));
      state.moving = Math.abs(state.vehicle.v) > 0.05;
      state.running = false;
      state.sprinting = false;
    state.sprinting = false;
      state.grounded = true;
      state.swimming = false;
      state.floor = state.pos.y;
      state.vy = 0;
      state.bob += dt * 1.2;
      return afterMove(dt);
    }

    // ---- on the bike ------------------------------------------------------------
    // The boat's shape again - W and S are the pedals and the brakes, A and D the bars, the
    // camera trails the front wheel - but on the feet's ground: `blocked` is the same wall a
    // walker meets, and the edge of deep water (BIKE_WADE) is where it stops. Shift is standing on the pedals,
    // and it spends the body's pool the way a run does.
    if (state.bike) {
      const b = state.bike;
      const turbo = stepPool(state.stamina.body, boost && iz > 0.02, dt);
      stepPool(state.stamina.boat, false, dt);
      state.turbo = turbo;
      // In the air the ground is asked from the floor the hop left, as a jump's is, so a hop
      // cannot change which storey you are on; the lid is a deck overhead, less a rider's head.
      const turn = state.parked ? ix : keyX + stickTurn(stickX, stickZ);
      stepBike(b, { pedal: iz, turn, turbo, hop: hopWanted }, dt, {
        ground: (x, z) => groundAt(x, z, b.air ? b.floor : b.y),
        blocked: (x, z) => blocked(x, z, b.y),
        ceiling: (x, z) => ceilingAt(x, z, b.floor) - HEAD - RIDE_HEAD,
      });
      hopWanted = false;
      // Came down in the water: the bike goes back in the satchel and you are swimming where it
      // landed - the next frame's feet take it from there.
      if (b.splash) {
        putBikeAway();
        state.pos.set(b.x, WATER_Y - SWIM_SINK, b.z);
        state.floor = groundAt(b.x, b.z, b.y);
        state.grounded = true;
        state.swimming = true;
        state.vy = 0;
        return afterMove(dt);
      }
      state.pos.set(b.x, b.y, b.z);
      state.floor = b.floor;
      state.yaw = b.yaw;
      state.moving = Math.abs(b.v) > 0.05;
      // The camera is yours to turn, as it is on foot; it swings back behind the bike only
      // once you have ridden RECENTRE_AFTER without touching it, easing in over RECENTRE_EASE
      // and quicker the faster you go - the third-person vehicle camera most games have.
      // Standing still it stays wherever you left it, so you can look the bike over.
      if (state.moving) riddenSinceLook += dt;
      const ease = clamp((riddenSinceLook - RECENTRE_AFTER) / RECENTRE_EASE, 0, 1);
      if (ease > 0) {
        const pull = (0.8 + 2.2 * Math.min(1, Math.abs(b.v) / BIKE_TOP)) * ease;
        state.camYaw = lerpAngle(state.camYaw, b.yaw, Math.min(1, dt * pull));
      }
      state.running = false;
      state.sprinting = false;
    state.sprinting = false;
      state.grounded = !b.air;      // what net.js sends as AIRBORNE, so a peer's bike hops too
      state.swimming = false;
      state.vy = b.vy;
      state.bob += dt * 1.2;
      return afterMove(dt);
    }

    // ---- on horseback -----------------------------------------------------------------
    // The bicycle's shape, on four legs (web/js/mount.js): W and S the reins, A and D the turn,
    // Shift the gallop out of the horse's own pool (stamina.js HORSE, spent and filled by the gait in
    // stepMount); the rider sits and spends nothing, so both of his pools fill underneath. A rider's
    // head is MOUNT_HEAD higher than a walker's, so a lid low enough to duck under on foot (a deck,
    // the quay) stops the horse, not only a jump.
    if (state.mount) {
      const m = state.mount;
      stepPool(state.stamina.body, false, dt);
      stepPool(state.stamina.boat, false, dt);
      const turn = state.parked ? ix : keyX + stickTurn(stickX, stickZ);
      stepMount(m, { rein: iz, turn, gallop: boost && iz > 0.02, hop: hopWanted, pool: state.stamina.horse }, dt, {
        ground: (x, z) => groundAt(x, z, m.air ? m.floor : m.y),
        blocked: (x, z) => blocked(x, z, m.y),
        ceiling: (x, z) => ceilingAt(x, z, m.floor) - HEAD - MOUNT_HEAD,
      });
      hopWanted = false;
      state.turbo = m.gallop;
      if (m.splash) {
        putBikeAway();
        state.pos.set(m.x, WATER_Y - SWIM_SINK, m.z);
        state.floor = groundAt(m.x, m.z, m.y);
        state.grounded = true;
        state.swimming = true;
        state.vy = 0;
        return afterMove(dt);
      }
      state.pos.set(m.x, m.y, m.z);
      state.floor = m.floor;
      state.yaw = m.yaw;
      state.moving = Math.abs(m.v) > 0.05;
      if (state.moving) riddenSinceLook += dt;
      const ease = clamp((riddenSinceLook - RECENTRE_AFTER) / RECENTRE_EASE, 0, 1);
      if (ease > 0) {
        const pull = (0.8 + 2.2 * Math.min(1, Math.abs(m.v) / MOUNT_TOP)) * ease;
        state.camYaw = lerpAngle(state.camYaw, m.yaw, Math.min(1, dt * pull));
      }
      state.running = false;
      state.sprinting = false;
      state.grounded = !m.air;      // AIRBORNE on the wire, so a peer's horse jumps too
      state.swimming = false;
      state.vy = m.vy;
      state.bob += dt * 1.2;
      return afterMove(dt);
    }

    // ---- at the foot of a rope ladder --------------------------------------------------
    // From the water or a quay, pushing at the hull of a ship: no key, you just climb.
    if (state.grounded && !state.sitting && !state.lying && !state.parked) {
      // Carrying is no bar: the load goes on the back for the climb (classic-avatar.js CARRIED_BACK).
      const at = ladderAhead(ix, iz);
      if (at) { startClimb(at.boat, at.ladder, 1, at.from); return stepClimb(dt, ix, iz); }
      const still = !state.swimming && !state.dive && !rides() ? fixedAhead(ix, iz) : null;
      if (still) { startFixedClimb(still.ladder, still.dir); return stepClimb(dt, ix, iz); }
    }

    const push = Math.min(1, Math.hypot(ix, iz));
    // A dig is a stand: any step, or the ground going out from under it, ends it (a jump, a crouch, a
    // panel and a blow do so where they happen). Otherwise it just runs down its clock.
    if (state.digging) {
      if (push > 0.02) cancelDig('moved');
      else if (!canDig()) cancelDig('blocked');
      else stepDig(dt);
    }
    // Shift only spends while it does something: held standing still, crouched on land, or
    // on a stool, it is not a run and costs nothing. `swimming` is last frame's answer,
    // which is the one every other line here uses too. An empty pool is the ordinary gait -
    // a walk on land, a plain stroke in the water - until RECOVER_AT opens it again.
    // Walking on the bottom is not a stroke and spends nothing (BOTTOM_SPEED has no turbo).
    // Nor with the statue in your arms: it is a walk, at CARRY_SPEED, however hard Shift is held.
    const wants = boost && push > 0.02 && !state.lying && !state.sitting && (state.swimming || !state.crouching)
      && !(state.dive && state.onBed) && !state.carry;
    const turbo = stepPool(state.stamina.body, wants, dt);
    stepPool(state.stamina.boat, false, dt);
    state.turbo = turbo;
    // On land Shift is a sprint while the pool lasts and a run once it is spent (Plans/
    // tweede-avonturier.md): a body that is out of breath jogs, it does not drop to a walk - and
    // a spent pool held on Shift fills like a resting one (stamina.js), so the sprint comes back.
    // Steered from the sky (a route, walk.park), the body always sprints and spends no breath:
    // the pool is a game on foot, and from above it would only make a click across the island slow.
    const skyRoute = state.parked && !!state.route;
    const sprint = (turbo || skyRoute) && !state.swimming && !state.dive && !state.carry;
    const run = sprint || (wants && !state.swimming && !state.dive);
    const speeds = classicAvatar.speeds;
    const speed = (state.lying || state.sitting ? 0
      : state.dive ? (state.onBed ? BOTTOM_SPEED : turbo ? DIVE_TURBO : DIVE_SPEED)
      : state.swimming ? (turbo ? SWIM_TURBO : SWIM_SPEED)
        : state.crouching ? CROUCH_SPEED
          : sprint ? speeds.sprint : run ? speeds.run : speeds.walk) * push * dt * (state.carry ? CARRY_SPEED : 1);
    state.moving = push > 0.02;
    state.running = run && state.moving;   // the others need to know which gait to draw
    state.sprinting = sprint && state.moving;
    // In the air the body keeps the way it took off with (Plans/tweede-avonturier.md): a jump
    // from a sprint is a long leap, one from standing goes straight up, and the stick only
    // steers it by AIR_STEER. Before this the stick moved a jumper at full speed in any
    // direction, so a standing jump went as far as a running one.
    const inAir = !state.grounded && !state.swimming && !state.dive;
    let sx = 0, sz = 0;
    if (state.moving) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      // looking along +z with y up, the camera's right hand is -x: right = forward x up
      forward.set(Math.sin(state.camYaw), 0, Math.cos(state.camYaw));
      right.set(-Math.cos(state.camYaw), 0, Math.sin(state.camYaw));
      let vx = forward.x * iz + right.x * ix;
      let vz = forward.z * iz + right.z * ix;
      // A drink in you pulls the step off to one side and then the other. Turned before the
      // collision test below, so a stagger slides along a wall like any other step, and on
      // land only - the water holds a swimmer up whatever is in them.
      const drunk = state.tipsy.level;
      if (drunk > 0 && !state.swimming) {
        const s = state.sway;
        const a = drunk * STAGGER * (0.65 * Math.sin(s * 1.9) + 0.35 * Math.sin(s * 0.71 + 2));
        const c = Math.cos(a), sn = Math.sin(a);
        [vx, vz] = [vx * c + vz * sn, vz * c - vx * sn];
      }
      sx = vx * speed; sz = vz * speed;
      state.yaw = lerpAngle(state.yaw, Math.atan2(vx, vz), TURN_LERP);
    }
    if (dt > 0) {
      if (inAir) {
        const k = 1 - Math.exp(-AIR_STEER * dt);
        airWay.x += (sx / dt - airWay.x) * k; airWay.z += (sz / dt - airWay.z) * k;
        sx = airWay.x * dt; sz = airWay.z * dt;
      } else { airWay.x = sx / dt; airWay.z = sz / dt; }
    }
    if (sx || sz) {
      // try the full step, then each axis on its own, so you slide along walls
      const beforeX = state.pos.x, beforeZ = state.pos.z;
      const nx = beforeX + sx, nz = beforeZ + sz;
      if (!blocked(nx, nz)) { state.pos.x = nx; state.pos.z = nz; }
      else if (!blocked(nx, state.pos.z)) { state.pos.x = nx; airWay.z = 0; }
      else if (!blocked(state.pos.x, nz)) { state.pos.z = nz; airWay.x = 0; }
      else { airWay.x = 0; airWay.z = 0; }
      frameDistance = Math.hypot(state.pos.x-beforeX, state.pos.z-beforeZ);
      // A parked body walking its route into a rail jumps it, as you would: held up (sliding along
      // it is not getting on), and the step open to somebody in the air.
      if (state.moving && state.route && state.grounded && frameDistance < speed * 0.5 && blocked(nx, nz)
        && !blocked(nx, nz, undefined, false, true)) jump();
      if (!state.swimming && state.moving) {
        state.moving = frameDistance > 1e-6; state.running = run && state.moving; state.sprinting = sprint && state.moving;
      }
      state.bob += frameDistance * Math.PI * 2 / (run ? .40 : .29);
    } else {
      state.bob += dt * 1.5;
    }

    // What is left of the hull's way after a jump off her: it goes on in the air, and is killed by
    // the water in about a second, and at once by anything dry to land on. Only while it is
    // free to move - a wall in the way ends it.
    if (drift) {
      if (state.grounded && !state.swimming) drift = null;
      else {
        const dx = state.pos.x + drift.x * dt, dz = state.pos.z + drift.z * dt;
        if (blocked(dx, dz)) drift = null;
        else {
          state.pos.x = dx; state.pos.z = dz;
          if (state.swimming) {
            const k = Math.exp(-(state.dive ? DIVE_DRIFT : 3) * dt);
            drift.x *= k; drift.z *= k;
            if (Math.abs(drift.x) + Math.abs(drift.z) < 0.05) drift = null;
          }
        }
      }
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
    // Going under: a swimmer with C (or the pad's B) held, in water deep enough to hold a
    // body. Space (the pad's A) swims a diver back up. `crouching` is exactly "the key is
    // held" here - it is set on the press and dropped on the release - so both keyboard and pad
    // come through the one flag, and a rebound key follows for free.
    // And the view steers too (diving.js lookRise): stroking on while looking down sinks, looking
    // up climbs, by how far forward the stroke is - `iz` is a unit vector by now - so the keys
    // and the mouse add up and a stroke sideways or a body hanging still is not moved by it.
    const steer = state.moving && (state.dive || state.swimming) ? lookRise(state.camPitch, state.firstPerson) * iz : 0;
    const rise = clamp((spaceHeld || padJump ? 1 : 0) - (state.crouching ? 1 : 0) + steer, -1, 1);
    if (!state.dive && state.swimming && rise < 0 && !state.sitting && !state.lying && !state.carry
        && canDive(bedUnder(state.pos.x, state.pos.z), WATER_Y)) {
      state.dive = true;
      state.vy = -0.3;                       // a first push under; stepDive takes it from here
    }
    // The bed came up dry under a diver (they swam in to a beach): wade, as swimmers always did.
    if (state.dive && !inWater) endDive();
    if (state.sitting) {
      state.pos.y = state.sitting.y;         // the stool, not the floor
    } else if (state.dive) {
      const bed = bedUnder(state.pos.x, state.pos.z);
      const r = stepDive({ y: state.pos.y, vy: state.vy }, rise, dt, {
        bed, lid: ceilingAt(state.pos.x, state.pos.z, state.pos.y), surface: WATER_Y, sink: SWIM_SINK,
      });
      state.pos.y = r.y;
      state.vy = r.vy;
      state.onBed = r.onBed;
      state.floor = bed;
      state.grounded = true;                 // a diver is not airborne, whatever their height
      if (r.surfaced) endDive();             // floating again, at the very height this left
    } else if (state.grounded) {
      // Walked off an edge - a quay, a bridge, a rock, a stair's side: fall, the jump's own way,
      // instead of being set down on the ground below in the same frame. That was every drop on
      // the island, a hand or a storey alike (the keeper: "instant omlaag teleporteren ipv
      // vallen"). A step down within STEP_DOWN is still followed, so stairs, slopes and kerbs
      // are walked as they always were.
      if (state.pos.y - underfoot > STEP_DOWN) { state.grounded = false; state.vy = 0; airTop = state.pos.y; }
      else state.pos.y = underfoot;
    } else {
      state.vy -= GRAVITY * dt;
      state.pos.y += state.vy * dt;
      // Your head. Without this a swimmer under a bridge jumps clean through the deck and
      // lands on top of it, which is the same hole that would let anyone out of a tunnel.
      if (state.vy > 0) {
        const lid = ceilingAt(state.pos.x, state.pos.z, state.floor);
        if (state.pos.y + HEAD > lid) { state.pos.y = lid - HEAD; state.vy = 0; }
      }
      if (state.pos.y <= underfoot) {
        // Came down in deep water hard enough (off a rail, a rock, a ledge): the speed goes
        // under with you instead of being thrown away at the surface. The height is left where
        // the fall put it, a hair below the resting one, and stepDive takes it from the next frame.
        const plunge = inWater ? plungeSpeed(state.vy, bedUnder(state.pos.x, state.pos.z), WATER_Y) : 0;
        if (plunge) { state.dive = true; state.vy = plunge; }
        else { state.pos.y = underfoot; state.vy = 0; }
        state.grounded = true;
        // Down from too high with her in the arms: she is thrown out of them where you land (or, in
        // the water, onto the shore you came from - letGo).
        if (state.carry && airTop - state.pos.y > CARRY_FALL) letGo('fall');
        airTop = -Infinity;
      }
    }
    state.swimming = state.dive || (state.grounded && inWater && !state.sitting);
    state.diving = state.dive && headUnder(state.pos.y, WATER_Y);
    // The statue is too heavy to swim with: in water deep enough to dive in she slips out of the arms
    // and lies on the last dry ground she was carried over. Wading the shallows - the rowing boat lies
    // at ROW_DEPTH, well above that - keeps her.
    if (state.carry) {
      if (state.dive || (state.swimming && canDive(bedUnder(state.pos.x, state.pos.z), WATER_Y))) letGo('water');
      else { const d = dryHere(); if (d) lastDry = d; }
    }

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

  // The move and the beat for the rig while dancing, the same way peers.js works them out for
  // somebody else: danceStep off the dancer's id, on the beat we hear.
  function dancingNow() {
    if (!state.dancing) return null;
    const d = dance ? dance() : { id: 'me', beat: wallBeat(performance.now()) };
    return { ...danceStep(d.id, d.beat), beat: d.beat };
  }

  // What both a walker and a boat end with: the pose, the animation, where the camera sits
  // and what is within reach. Split out when the boat arrived, because a boat needs all of
  // it and none of the walking above it - and a second copy of the camera block would have
  // been two places to remember the next time the eye height changes.
  function afterMove(dt) {
    // Looking out of the head: on foot the body faces where you look, as it would; a boat
    // is its own thing, and sitting or lying down puts the camera back behind you.
    // A dance ends the way a nap does: the moment the feet do anything else, or the body is
    // somewhere it cannot dance (a hull, the saddle, the water).
    if (state.dancing && (state.moving || state.crouching || !canDance())) state.dancing = false;
    // Dying is seen from behind, whatever the view: the fall is the point.
    const fp = state.firstPerson && !state.vehicle && !state.lying && !state.sitting && !state.dying;
    if (fp && !rides()) state.yaw = state.camYaw;
    avatar.scale.setScalar(1);
    lounge.visible = state.lying;
    // The body's share of the beer, on its own axes (rotation order YXZ: a nod and a roll
    // about the settler's own forward): only upright, since lying down and swimming already
    // turn the whole body and would be knocked off their own poses by it.
    const drunk = state.tipsy.level;
    const nod = drunk * SWAY_NOD * Math.sin(state.sway * 1.3 + 0.4);
    const roll = drunk * SWAY_ROLL * Math.sin(state.sway * 1.9 + 0.6);
    if (state.dying) {
      // Upright and still: the rig does the falling (its root at the feet tips over them).
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(0, state.yaw, 0);
    } else if (state.lying) {
      // On the back with the head at -z, which is the end the parasol stands at. Negative
      // pitch turns the front face upwards; the positive one used for swimming is prone.
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(-1.5, state.yaw, 0);
      lounge.position.set(state.pos.x, state.pos.y + 0.01, state.pos.z);
      lounge.rotation.set(0, state.yaw, 0);
    } else if (state.bike) {
      // In the saddle: the hips on it, leaning into the corner with the frame and a little
      // forward over the bars. The saddle point is the bike's own (RIDER, measured off the
      // bake), carried through the bike's yaw and lean by its own matrix.
      const b = state.bike;
      bikeMesh.place(b.x, b.y, b.z, b.yaw);
      bikeMesh.pose(b);
      bikeMesh.object.updateMatrixWorld(true);
      // The hips of whichever body is riding (Plans/tweede-avonturier.md): the Adventurer's are higher.
      seatAt.set(RIDER.saddle[0], RIDER.saddle[1] - classicAvatar.hipY, RIDER.saddle[2]);
      bikeMesh.object.localToWorld(seatAt);
      avatar.position.copy(seatAt);
      avatar.rotation.set(RIDE_PITCH - b.pitch, b.yaw, b.lean + roll * 0.3);
    } else if (state.mount) {
      // In the saddle, on the horse's own back: posed first (its rock, its bob), then the rider's
      // hips put on the seat and the rest of him riding it (mount.js carry: part of the pitch in
      // the pelvis, the torso steady and on springs, a half seat in the gallop).
      const m = state.mount;
      horse.place(m.x, m.y, m.z, m.yaw);
      horse.pose({ speed: m.v, rate: m.rate, air: m.air }, dt);
      const fit = horsebackOf(classicAvatar.character);
      state.riderMotion = horse.carry(avatar, classicAvatar.hipY, fit.perch, dt, roll * 0.3);
    } else if (oarsman()) {
      // At the oars (Plans/roeiboot-en-schat.md): on the thwart, which is where the boat sets the
      // body (craft.deck()), facing aft as an oarsman does - so turned half round from the bow - and
      // pitching and rolling with her.
      const v = state.vehicle;
      avatar.position.set(state.pos.x, state.pos.y - classicAvatar.hipY + SEAT_FLESH, state.pos.z);
      avatar.rotation.set(0, v.yaw + Math.PI, roll * 0.3);
      if (v.craft.object) avatar.quaternion.premultiply(hullTiltOf(v, rowTilt));
    } else if (state.sitting) {
      // The rig provides its own seated pose; a drunk on a stool sways at half the reach.
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(nod * 0.5, state.yaw, roll * 0.5);
      // A seat on a hull (her crow's nest) leans with her as standing on her does.
      if (plane) avatar.quaternion.premultiply(plane);
    } else if (state.swimming) {
      // Prone and rolling with the stroke. The figure is one merged mesh, so there are no
      // limbs to animate - the whole body leans into it instead, which at this scale is
      // what reads as swimming.
      // A turbo stroke is a quicker one, by the same ratio as the speed it buys.
      state.bob += dt * (state.moving ? 6.5 * (state.turbo ? SWIM_TURBO / SWIM_SPEED : 1) : 1.4);
      // Positive pitch, so the head goes forward: rotating about local x maps +y (up,
      // towards the head) onto +z, which is the direction yaw points along. The other
      // sign swims feet first. A diver tips head-down on the way to the bottom and head-up on
      // the way to the top, off the vertical speed alone (diving.js divePitch) - which is
      // also all a peer has to go on (peers.js), so both screens draw the same body. At the
      // surface a swimmer going nowhere treads water upright (swimPose); a diver stays in the
      // stroke, so coming up from below rights the body from lying, as stopping does.
      state.lie = state.dive ? 1 : stepLie(state.lie, state.moving, dt);
      // A body that swims its own stroke (classic-avatar.js `strokes`: the Adventurer's Mixamo
      // breaststroke) already heaves and rolls with it, so it gets the lean and none of the beat:
      // the roll and nod were made for the Traveller, whose limbs did not swim, and over the clip
      // they were a wiggle on a clock of their own. A bob of 0 is swimPose without its beat.
      const beat = classicAvatar.strokes ? 0 : 1;
      const swim = swimPose(state.lie, state.bob * beat);
      avatar.position.set(state.pos.x, state.pos.y + swim.dy, state.pos.z);
      const pitch = state.dive ? divePitch(state.vy) + Math.sin(state.bob) * 0.1 * beat : swim.pitch;
      avatar.rotation.set(pitch, state.yaw, state.dive ? Math.sin(state.bob * 0.5) * 0.16 * beat : swim.roll);
    } else {
      avatar.position.set(state.pos.x, state.pos.y, state.pos.z);
      avatar.rotation.set(nod, state.yaw, roll);
      // On a hull: turned about the vertical as always, then tilted with the plane she is on.
      if (plane) avatar.quaternion.premultiply(plane);
      if (state.crouching) avatar.scale.set(1, 0.82, 1);
    }

    stepOffEase(dt);

    // C is "swim down" to a diver, not a crouch: the rig would fold its legs for it.
    const stoop = state.crouching && !state.dive;
    classicAvatar.update({
      moving: state.moving, running: state.running, sprinting: state.sprinting, grounded: state.grounded, distance: frameDistance,
      crouching: stoop, sitting: !!state.sitting || !!oarsman(), lying: state.lying,
      rowing: oarsman() ? { phase: state.vehicle.craft.rowing.phase() } : null,
      swimming: state.swimming, treading: state.swimming && !state.dive ? 1 - state.lie : 0, blocking: state.blocking ? state.guard : false, phase: state.bob, firstPerson: fp, pitch: state.camPitch,
      riding: state.bike ? { crank: state.bike.crank, standing: state.turbo && state.bike.v > 0.5 } : null,
      horseback: state.mount ? state.riderMotion || true : false,
      dancing: dancingNow(),
      dying: state.dying,
      climbing: climb ? state.climbing : null,
      // on a ladder's way at all - its reach, its rungs, its step over the top - which the rig eases
      // its pose across the ends of (classic-avatar.js LADDER_FADE)
      onLadder: !!climb,
    }, dt);
    // What the hands carry, for the pose: a shield is armour on the sea (net.js).
    state.shields.left = shieldIn('leftArm');
    state.shields.right = shieldIn('rightArm');
    // What the glass gave up this frame, if one is being drunk from.
    drinkIn(state.tipsy, classicAvatar.swallowed());

    // Parked, the sky's camera is the keeper's: the body is drawn, the camera left alone.
    zzz.visible = state.parked && !state.route;
    if (zzz.visible) {
      zzz.position.set(state.pos.x, 0, state.pos.z);
      bobZzz(zzz, performance.now() / 1000);
      zzz.position.y += state.pos.y;
    }
    // The camera goes over to a diver's rules (under the surface, floor at the sea bed) and back
    // over about 0.4 s, or the head going under would throw it two units.
    camDive = clamp(camDive + (state.diving ? dt : -dt) / CAM_DIVE_S, 0, 1);
    relaxPitch(dt);
    // The feet go up a stair tread by tread, as the treads are drawn (a stair's `steps`, the quay's
    // flights); the camera does not have to. What the feet rose or dropped this frame within a step
    // is taken back off the camera and eased out again, so a flight is climbed with a steady eye -
    // not jolted a riser at a time. A fall, a jump, the water or a hull is followed as it always was.
    const rose = stepFrom == null ? 0 : state.pos.y - stepFrom;
    const afoot = state.grounded && !state.swimming && !state.vehicle && !plane && !state.sitting;
    if (afoot && Math.abs(rose) <= STEP_UP) camStep = clamp(camStep - rose, -STEP_UP, STEP_UP);
    else camStep = 0;
    camStep *= Math.exp(-CAM_STEP_RATE * dt);
    stepFrom = state.pos.y;
    if (state.active) placeCamera(fp, dt);
    else armLen = Infinity;
    // A boom pulled in to within a head's width of the eye would put the lens inside the figure: the
    // body goes, as in first person, and comes back as the boom lets out again.
    classicAvatar.object.visible = !(state.active && !fp && armLen < ARM_HIDE);

    // what is within reach?
    return reach();
  }

  // ---- the boom (Plans/camera-botsing.md) --------------------------------------------------------
  // The camera hangs at the end of a boom from the point it looks at, and the boom stops at the
  // first thing it meets: the buildings' part boxes (`cameraBodies`), every blocker with a height,
  // and - sampled along it - the ground, the quay's stone, every floor of planks, a deck or a cell's
  // level as a slab, and the hull we stand on below her deck. Pulled in at once, so there is never a
  // frame with something between the camera and the body; let out again at ARM_OUT, so a camera
  // turned along a facade does not pump in and out with every window.
  const CAM_R = 0.15;           // the lens's own room, the boom's radius
  const ARM_MIN = 0.2;          // never closer than this to the point it looks at
  const ARM_HIDE = 0.45;        // closer than this the body is in the way of the lens: it goes
  const ARM_OUT = 3;            // how fast the boom lets out again, per second (exponential)
  const SLAB = 0.15;            // how thick a floor of planks is to the camera
  const NEAR_ARM = 1.25;        // a boom shorter than this brings the near plane in with it
  // The look to either side (placeCamera): how far round, in radians, and how much longer than
  // what it finds there the boom may still be, per radian round.
  const ARM_SIDES = [0.1, 0.2, 0.35];
  const ARM_SOFT = 3;
  // How fast the boom comes in towards what it sees to the side, per second (exponential). What is
  // straight down the boom it does not wait for.
  const ARM_IN = 12;
  let armLen = Infinity;
  // The near plane, brought in with a short boom from `nearBase`, or the wall beside the lens is cut
  // away by a plane half a unit out (the island's 0.5). First person has its own (setFirstPerson).
  function setNear(n) {
    if (Math.abs(camera.near - n) < 1e-4) return;
    camera.near = n;
    camera.updateProjectionMatrix();
  }
  // The hull we are on this frame, read for the boom: her frame, the height of her y = 0 and her
  // walk map (shared/hullwalk.mjs), or null off one. `reach` is how high a floor of hers counts as
  // the deck under the camera: no higher than half a unit over the point looked at, or the roof of
  // her castle - or her yards - would be floors to a camera on the waist.
  let camHull = null;
  function hullForCamera(pivotY) {
    const b = deckBoat || state.vehicle || (climb && climb.boat) || null;
    const walkMap = b && b.craft && b.craft.walk;
    if (!walkMap) return null;
    const base = hullPoint(b, 0, 0, 0).y;
    return { frame: frameOf(b), base, walk: walkMap, reach: pivotY - base + 0.5 };
  }
  const hullLocal = [0, 0];
  function hullDeckAt(h, x, z) {
    toLocal(h.frame, x, z, hullLocal);
    const f = h.walk.floorIn(hullLocal[0], hullLocal[1], h.reach, 0);
    return f == null ? null : h.base + f;
  }
  // Whether the point is inside something the boom must stop at, of what is sampled.
  function solidPoint(x, y, z) {
    const g = camDive > 0 ? Math.max(heightUnder(x, z), bedUnder(x, z)) : heightUnder(x, z);
    if (y < g + CAM_R * 0.5) return true;
    const k = kadeAt(x, z);
    if (k != null && y < k + CAM_R) return true;
    const plank = (h) => h != null && y < h + CAM_R && y > h - SLAB;
    if (surfaceIndex.some(x, z, 0, (sf) => plank(surfaceY(sf, x, z)))) return true;
    for (const d of decks) if (plank(deckY(d, x, z))) return true;
    const lv = levelsIn(x, z);
    if (lv) for (const h of lv) if (plank(h)) return true;
    if (camHull) {
      const deck = hullDeckAt(camHull, x, z);
      if (deck != null && y < deck + CAM_R * 0.5) return true;
    }
    return false;
  }
  // Only what stands up out of the ground - the buildings' boxes and the blockers - asked along a
  // direction: armReach's first half, and all the boom's look to either side (see placeCamera).
  // `pad` is the lens's room by default; the see-through's silhouette rays ask with none.
  function standingReach(ax, ay, az, dx, dy, dz, len, pad = CAM_R) {
    let best = len;
    const bx = ax + dx * len, bz = az + dz * len;
    camBodies.along(ax, az, bx, bz, pad, (b) => {
      const t = camBodyEntry(b, ax, ay, az, dx, dy, dz, best, pad);
      if (t != null && t < best) best = t;
      return false;
    });
    blockerIndex.along(ax, az, bx, bz, pad, (b) => {
      // A rail, a fence, a post: looked past, not stopped at (solids.js camSeesPast).
      if (camSeesPastSolid(b)) return false;
      let y0 = b.y0, y1 = b.y1;
      if (y1 == null) {
        if (camSolidTop == null) return false;
        y0 = -Infinity; y1 = camSolidTop;
      }
      const t = segmentEntry(b, ax, ay, az, dx, dy, dz, best, pad, y0, y1);
      if (t != null && t >= 0 && t < best) best = t;
      return false;
    });
    return best;
  }
  // How far along the unit direction d the boom from a may reach, up to len.
  function armReach(ax, ay, az, dx, dy, dz, len) {
    let best = standingReach(ax, ay, az, dx, dy, dz, len);
    // The rest is sampled. What the start is already in does not count until the boom has been out
    // of it: a pivot a hand over a gallery's boards is in that floor's slab and must not be stuck there.
    const step = Math.max(0.06, best / 80);
    let open = false;
    for (let t = 0; t <= best; t += step) {
      if (solidPoint(ax + dx * t, ay + dy * t, az + dz * t)) {
        if (open) { best = Math.max(0, t - step); break; }
      } else open = true;
    }
    return best;
  }
  const pivot = new THREE.Vector3(), armDir = new THREE.Vector3();
  function placeCamera(fp, dt = 0) {
    // camera sits behind and above, and never dips under the ground
    const dist = state.lying ? back * 1.7 : back;
    const cx = state.pos.x - Math.sin(state.camYaw) * dist * Math.cos(state.camPitch);
    const cz = state.pos.z - Math.cos(state.camYaw) * dist * Math.cos(state.camPitch);
    // Wheeled in, the lift comes in with the distance: a camera a third as far away but still
    // camUp over the head looked straight down on the hat, and never at a face. Wheeled out it
    // stays camUp, so the view from further back is the one it always was.
    const up = camUp * Math.min(1, back / camBack);
    // C is "swim down" to a diver, so it does not fold the eye (see `stoop` in afterMove).
    const stoop = state.crouching && !state.dive;
    const eyeDrop = state.lying ? up * 0.55 : stoop || state.sitting ? up * 0.3 : 0;
    // In the saddle the head is MOUNT_HEAD over a walker's (the feet's height is the horse's).
    const seatLift = state.mount ? MOUNT_HEAD : 0;
    const cy = state.pos.y + camStep + up - eyeDrop + seatLift + Math.sin(state.camPitch) * dist;
    // The aim follows the eye down as the body folds: crouching and sitting shorten the
    // figure by exactly these factors, so reusing them keeps the camera on the face rather
    // than on the air the settler has just vacated. Lying down there is no standing body
    // left to scale - the figure is flat on the towel, and a fifth of eye level is the
    // middle of what is left above the ground.
    const aim = state.lying ? camAim * LIE_AIM
      : stoop ? camAim * CROUCH_SCALE
        : state.sitting ? camAim * SIT_SCALE : camAim + seatLift;
    camHull = fp ? null : hullForCamera(state.pos.y + aim);
    // Over water the floor is the surface, not the sea bed - see camera-floor.js - until the
    // head goes under: then the camera belongs under it too, floored by the bed and held below
    // the surface (`camDive` eases the change). The bed a diver sees is `bedUnder`, which is
    // not always what the ground says at the rim of an island's grid, so the camera takes the
    // higher of the two.
    //
    // The ground only - the terrain, and on a ship her deck. What stands on the ground (a pier, a
    // bridge, the quay, a stair, a building's floor) is the boom's, below: as part of the floor it
    // lifted the camera in one frame wherever it came over the edge of one (0.24 at the foot of the
    // Salty Kraken's stair, half a unit over the quay's wall), and with `lift` the aim as well.
    // A smoothstep of the timer, so the camera starts and ends gently: the surface swimmer's
    // camera hangs 2.3 up and the diver's is under the surface, and a plain exponential ease
    // moved it 0.16 in the first frame (measured, tests/diving-walk.test.mjs).
    const blend = camDive * camDive * (3 - 2 * camDive);
    const heightAt = (x, z) => {
      let under = heightUnder(x, z);
      if (camDive > 0) under = Math.max(under, bedUnder(x, z));
      if (camHull) {
        const deck = hullDeckAt(camHull, x, z);
        if (deck != null) under = Math.max(under, deck);
      }
      const floor = cameraFloor({ ground: under, waterY: WATER_Y, blend });
      return applyCeiling(cy, { ground: under, waterY: WATER_Y, blend, floor });
    };
    let camX = cx, camZ = cz, camY = heightAt(cx, cz);
    // The floor above the water is what keeps the lens from sitting half under the sea (a swimmer
    // looking up used to put the camera below the surface, its top cutting the view in two). It must
    // not also flatten the view, nor bring the camera in: held up by the floor, the camera stays as
    // far from the eye as it was (on its sphere, round the point it orbits), so the further down the
    // mouse goes the further *back* along the ground it slides, never forward - pitched down by
    // cos(pitch) alone it came in over the grass at the body, the keeper's "spastisch" - and what is
    // left of the turn tilts the view up: it aims along the line it would have from where it wanted to
    // be, so looking up still looks up. Asked twice, because the ground further back can be higher.
    // Only upwards, and never in first person - the diver's ceiling pulling the camera down keeps its
    // old view of the diver.
    let lift = 0;
    if (!fp && camY > cy + 1e-6) {
      const hWant = dist * Math.cos(state.camPitch);
      const orbitY = cy - Math.sin(state.camPitch) * dist;
      let h = hWant;
      for (let i = 0; i < 2; i++) {
        const rise = camY - orbitY;
        h = Math.max(hWant, Math.sqrt(Math.max(0, dist * dist - rise * rise)));
        camX = state.pos.x - Math.sin(state.camYaw) * h;
        camZ = state.pos.z - Math.cos(state.camYaw) * h;
        camY = Math.max(camY, heightAt(camX, camZ));
      }
      // The point over the body on the line the camera would have looked along from (cx, cy, cz).
      const aimY = state.pos.y + camStep + aim;
      lift = hWant > 1e-6 ? Math.max(0, camY + (aimY - cy) * (h / hWant) - aimY) : camY - cy;
    }
    camera.position.set(camX, camY, camZ);
    // On a plane the camera stands in the plane's own frame: its offset from you turned with her tilt
    // and its up is hers, so the deck holds still on the screen and it is the sea that rocks, which
    // is what standing on a moving thing looks like. A level camera over a deck that tilts under it
    // swings everything about you, and you stand still in the middle of it.
    //
    // Only CAM_TILT of her tilt, though. All of it put the camera on a lever as long as its distance
    // (27 units behind a ship's wheel: her 0.04 of pitch is a metre of camera, ten times a second)
    // and rolled the horizon with every swell - the sea rocking on the screen was far more than a
    // ship's own 2 degrees. The body still leans with her all the way (avatar, below).
    if (plane) {
      camTilt.identity().slerp(plane, CAM_TILT);
      camOff.copy(camera.position).sub(state.pos).applyQuaternion(camTilt);
      camera.position.copy(state.pos).add(camOff);
      planeUp.copy(PLANE_UP).applyQuaternion(camTilt);
      camera.up.copy(planeUp);
      pivot.set(state.pos.x + planeUp.x * aim, state.pos.y + planeUp.y * aim, state.pos.z + planeUp.z * aim);
    } else {
      camera.up.copy(PLANE_UP);
      pivot.set(state.pos.x, state.pos.y + camStep + aim + lift, state.pos.z);
    }
    if (fp) {
      // The eye, carried through the body's own transform (a crouch, a swimmer's tilt, the
      // saddle's lean), and a little behind it so the hands are in front of the lens.
      avatar.updateMatrixWorld(true);
      const eye = avatar.localToWorld(fpEye.set(0, classicAvatar.eye, 0));
      const cp = Math.cos(state.camPitch);
      fpLook.set(Math.sin(state.camYaw) * cp, -Math.sin(state.camPitch), Math.cos(state.camYaw) * cp);
      if (plane) fpLook.applyQuaternion(plane);
      camera.position.set(eye.x - fpLook.x * FP_BACK, eye.y + camStep - fpLook.y * FP_BACK, eye.z - fpLook.z * FP_BACK);
      if (clampCam) clampCam(camera.position, { firstPerson: true });
      camera.lookAt(camera.position.x + fpLook.x, camera.position.y + fpLook.y, camera.position.z + fpLook.z);
      return;
    }
    if (clampCam) clampCam(camera.position);
    // The boom, from the point looked at out to where the camera would be. A room's clampCam has had
    // its say first (its walls, and the climb that looks down into a small room) and is told again
    // where the camera ended up, for its lid.
    armDir.copy(camera.position).sub(pivot);
    const want = armDir.length();
    // Settings -> On foot -> Fixed distance (camera-prefs.js, on by default): no boom at all.
    if (cameraFixed()) armLen = want;
    else if (want > 1e-6) {
      armDir.divideScalar(want);
      // How far it may reach this frame, at once: nothing between the camera and the body, ever.
      const hard = Math.max(ARM_MIN, Math.min(want, armReach(pivot.x, pivot.y, pivot.z, armDir.x, armDir.y, armDir.z, want) - 0.03));
      // And a look to either side of it, which the boom comes in towards ahead of time. Turned round
      // a corner it went from all its length to a stub in one frame (0.78 at the foot of the Kraken's
      // stair, a degree a frame; more beside a post close by): it ran into the wall all at once.
      // Asked a little way round to either side - and held shorter for what is there, the nearer the
      // side the shorter - it is already coming in over the last degrees before the corner. Only
      // what stands up is asked: floors and the ground do not come round a corner at you.
      let soft = hard;
      for (const a of ARM_SIDES) {
        const c = Math.cos(a), sn = Math.sin(a);
        for (const sign of [1, -1]) {
          const sx = armDir.x * c + armDir.z * sn * sign, sz = armDir.z * c - armDir.x * sn * sign;
          const side = standingReach(pivot.x, pivot.y, pivot.z, sx, armDir.y, sz, want) + ARM_SOFT * a;
          if (side < soft) soft = side;
        }
      }
      soft = Math.max(ARM_MIN, soft);
      if (armLen > hard) armLen = hard;
      else if (soft < armLen) armLen += (soft - armLen) * (1 - Math.exp(-ARM_IN * dt));
      else armLen = Math.min(soft, armLen + (soft - armLen) * (1 - Math.exp(-ARM_OUT * dt)));
      if (armLen < want) {
        camera.position.copy(pivot).addScaledVector(armDir, armLen);
        if (clampCam) clampCam(camera.position, { boomed: true });
      }
    } else armLen = want;
    setNear(armLen < NEAR_ARM ? Math.max(0.05, Math.min(nearBase, armLen * 0.4)) : nearBase);
    camera.lookAt(pivot);
  }

  function reach() {
    let near = null, bestD = Infinity;
    // Nothing is within reach of a body under the water: `it.x`/`it.z` are a flat distance, so a
    // diver two units down would be offered the dock's boat, and E would climb into it.
    // Surface first (swimming up to a hull from the water still boards it, as it always did).
    if (!state.dive) for (const it of state.interactables) {
      // One with a height (a seat, a pirate on a gallery) is out of reach from the floor below it.
      if (it.floor != null && Math.abs(it.floor - state.pos.y) > 0.5) continue;
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
    if (bikeMesh) bikeMesh.dispose();
    if (horse) horse.dispose();
    removeEventListener('keydown', onKeyDown);
    removeEventListener('keyup', onKeyUp);
    removeEventListener('blur', onBlur);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointermove', onMove);
    dom.removeEventListener('pointerdown', onDown);
    dom.removeEventListener('wheel', onWheel);
    document.removeEventListener('pointerlockchange', onLockChange);
    clearTimeout(lockAgain);
    scene.remove(avatar);
    classicAvatar.dispose();
  }

  // What stands above the terrain, per cell, lowest first. main.js merges the layout's
  // bridges with the ones somebody built before handing it over.
  function setLevels(map) { levels = map || new Map(); }
  function setSurfaces(list) { surfaces = list || []; indexSurfaces(); }
  function setDecks(list) { takeDecks(list); }

  // Is there room here for something wider than a person? Walk mode already knows what
  // cannot be walked through, so "can a vegetable bed go where I am standing" is that
  // same question asked with a bed's radius instead of a settler's.
  function roomFor(x, z, r) {
    return !blockerIndex.some(x, z, r, (b) => inside(b, x, z, r));
  }

  return { state, avatar, enter, exit, park, goTo, blockedAt, standFloor, parked: () => state.parked, update, pad, setPaused, setWorking, release, syncLock, setBlockers, setPeerBlockers, setInteractables, setAvatar, setLevels, setSurfaces, setClimbs, ladderAt, setDecks, sitOn, sitOnDeck, standUp, roomFor, board, unboard, aboard: () => state.vehicle, leaveHelm, takeHelm, deckWhere, runOut, runningOut,
    // The hull we stand on - or are climbing to or from, which is as much ours as her deck is.
    onDeck: () => (state.deck ? deckBoat : climb ? climb.boat : null),
    setBoats(fn) { boatsOf = typeof fn === 'function' ? fn : () => []; },
    mount, dismount, riding: () => rides(),
    // Which: 'horse' (the Adventurer's, web/js/mount.js) or 'bike' (the Traveller's) - what F gives this body.
    rideKind: () => rideKind(),
    // The statue in both arms (Plans/schatkaarten.md). `lift(item)` takes it - false if the hands are
    // busy or it is already carried; `putDown()` hands the item name back; `carrying()` is the item or
    // null. Aboard it is cargo: `putOnBoat(hull)` (board() does it for whoever boards carrying),
    // `takeOffBoat()` for a body already off the hull (unboard() does it on the way ashore), and
    // `cargo()` is { item, hull } or null.
    // Going down before the jump home (main.js sentHome): die('fall' | 'drown') -> seconds, 0 when
    // this body cannot; revive() ends it (exit() does too); dying() is { kind, t } or null.
    die, revive, dying: () => state.dying,
    // `setDown()` is H (false and onBlocked('set') where she may not lie); `letGo(why)` is the hands
    // giving out - both end in the constructor's onLetGo with where she lies.
    setDown, letGo,
    lift, putDown, carrying: () => state.carry, putOnBoat, takeOffBoat, cargo: () => state.cargo, hoistOnto, lowerOff,
    // A dig with the shovel. `dig(seconds = 2.5)` begins one (false if it may not); it ends in the
    // constructor's onDigDone(x, z, { from, yaw }) or onDigCancelled(reason). `cancelDig(reason)` is
    // for what only main.js sees (a blow: 'hit'); `digging()` says whether one is going and
    // `digProgress()` how far, 0..1 or null - for the mound of sand and the hole.
    dig, cancelDig, digging: () => !!state.digging,
    // Shovelfuls the rig has flung since this was last asked (classic-avatar.js digged), one grain
    // burst each for main.js; 0 from a rig that does not count them.
    digged: () => (classicAvatar.digged ? classicAvatar.digged() : 0),
    digProgress: () => (state.digging ? clamp(state.digging.t / state.digging.total, 0, 1) : null),
    // What is underfoot here, decks included. The archipelago alone answers with water
    // over a quay, because planks are a level rather than ground - and "can I step out
    // here" has to mean the same thing as "will my feet find something".
    groundAt: (x, z) => groundAt(x, z),
    // What a hand's button does right now - 'attack', 'block', 'drink', or 'relay' when both
    // hands hold a beer (classic-avatar.js drink) - for the key row.
    handAction: (side) => (beerIn(side) ? (beerIn(side === 'leftArm' ? 'rightArm' : 'leftArm') ? 'relay' : 'drink')
      : shieldIn(side) ? 'block' : 'attack'),
    // Which hand a beer could be handed over from, the right first, or null; and handing it
    // over (classic-avatar.js handOver), gone from the fist for `away` seconds.
    beerHand: () => (beerIn('rightArm') ? 'rightArm' : beerIn('leftArm') ? 'leftArm' : null),
    handOver: (side, away) => classicAvatar.handOver(side, away),
    // A hand's button from something that is not a mouse - the phone's hand buttons
    // (touchpad.js) - pressed and let go: a shield is held up while it is down, anything
    // else swings or sips on the press, exactly as onDown / onUp do for a mouse button.
    hand(side, down) {
      if (!state.active || state.paused) return;
      if (!down) { guardUp(side, false); return; }
      if (shieldIn(side)) { if (canFight()) guardUp(side, true); } else act(side);
    },
    // On foot and on land, which is when the hands have anything to do.
    onFoot: () => state.active && !state.paused && !state.vehicle && !rides() && !state.swimming,
    // In the water under your own power - the phone's B (down) and A (up) mean diving here,
    // so touchpad.js shows them although the hands and the bike stay hidden (onFoot is false).
    inWater: () => state.active && !state.paused && !state.vehicle && !rides() && state.swimming,
    // The head is under the surface: the mist, the sound and the sea's air (main.js).
    diving: () => state.diving,
    // The sea floor as a diver meets it (see bedUnder).
    bedAt: (x, z) => bedUnder(x, z),
    // How far back the camera sits against what it would for this mode: the wheel's or the pinch's.
    zoom: () => zoomPref,
    // Whether a building's part box or a blocker with a height stands between two points - the
    // boom's own test (standingReach), so what the camera looks past (a rail, a post, a crate)
    // counts as nothing here either. main.js asks it whether the walker is hidden from the
    // camera (see-through.js).
    standsBetween(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) return false;
      return standingReach(ax, ay, az, dx / len, dy / len, dz / len, len, 0) < len - 1e-3;
    },
    dispose, isActive: () => state.active };
}

export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}
