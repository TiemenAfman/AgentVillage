// The face on the clock tower, and the two hands that make it a clock rather than a
// white disc. `buildings.js` has said `animated.clock = { at: [...] }` since the tower was
// first drawn, but nothing ever read it, so the tower has been standing on the square with
// a blank dial. This is the part that reads it.
//
// It lives on its own rather than in `buildings.js` because the hands have to turn, and a
// building is one merged geometry that cannot move a piece of itself. So the dial and each
// hand are their own small geometry, hung on the building's group as separate meshes by
// whoever is placing the tower - the island in `main.js`, the model sheet in `demo.js`.
// They share the building material, so a working clock costs three draw calls and no new
// state anywhere.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, C } from './buildings.js';
import { worldTime, localZone } from 'shared/worldclock.mjs';

// The baked clock dial publishes its centre as the anchor. Lift the marks and hands
// beyond its front surface so the depth buffer never chooses between them and plaster.
const FACE_R = 0.17;
const FACE_LIFT = 0.028;
const HAND = C.iron;

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Twelve marks around the rim, the four quarters longer than the rest, and the cap over
// the spindle. Without them the hands turn against nothing and there is no hour to read
// off the tower from across the square.
//
// `face` adds the white disc and a dark rim behind the marks. The tower does not want one -
// its dial is part of the baked tower - but the gold pit's clock hangs on a plastered gable
// with nothing round to sit on (see attachResetClock).
export function buildClockDialGeometry({ face = false } = {}) {
  const parts = [];
  if (face) {
    parts.push(cylinder(FACE_R, FACE_R, 0.014, 24, C.white, { rx: Math.PI / 2, z: -0.014 }));
    parts.push(cylinder(FACE_R + 0.014, FACE_R + 0.014, 0.010, 24, HAND, { rx: Math.PI / 2, z: -0.022 }));
  }
  for (let i = 0; i < 12; i++) {
    const quarter = i % 3 === 0;
    const len = quarter ? 0.036 : 0.020;
    // Built pointing at twelve and then swung to its own hour, so every mark stands
    // square to the rim above it.
    const m = box(quarter ? 0.016 : 0.010, len, 0.012, HAND, { y: FACE_R - 0.028 - len });
    m.rotateZ(-(i / 12) * Math.PI * 2);
    parts.push(m);
  }
  parts.push(cylinder(0.019, 0.019, 0.016, 8, HAND, { rx: Math.PI / 2, z: 0.018 }));
  return merge(parts);
}

// A hand, pointing at twelve with its pivot on the origin and a short tail past it so it
// reads as pinned rather than balanced there. The mesh turns about its own z.
export function buildClockHandGeometry(kind) {
  const minute = kind === 'minute';
  const len = minute ? 0.132 : 0.092;
  return merge([box(minute ? 0.013 : 0.021, len + 0.026, minute ? 0.010 : 0.012, HAND, { y: -0.026 })]);
}

// Where the hands stand at a given hour, as rotations about z.
//
// `hour` is the island's own clock - hours past midnight with the minutes as the fraction,
// the same number the HUD shows - so the tower agrees with the corner of the screen, and
// runs backwards with it when the timeline is scrubbed.
//
// Seen from outside, the face looks back along -z, which puts +x on the right of the dial.
// Turning about +z carries +y towards -x, so a hand going clockwise is turning by a
// negative angle: hence the minus on both.
export function clockAngles(hour) {
  const turns = (x) => -(((x % 1) + 1) % 1) * Math.PI * 2;
  return { hour: turns(hour / 12), minute: turns(hour) };
}

// Hangs a dial and two hands on a building group at the spot the builder marked, and hands
// back the object to tick. `at` is the anchor out of `built.animated.clock`.
//
// Nothing here casts a shadow. A tick is twelve millimetres of iron a centimetre in front
// of a white dial, and at the resolution the island's shadow map runs at, all it would
// throw onto that dial is noise.
//
// `radius` scales the whole clock from the tower's FACE_R; `face` is buildClockDialGeometry's.
export function attachClock(group, at, material, { face = false, radius = FACE_R } = {}) {
  const root = new THREE.Group();
  const k = radius / FACE_R;
  root.position.set(at[0], at[1], at[2] + FACE_LIFT * k);
  root.scale.setScalar(k);
  const dial = new THREE.Mesh(buildClockDialGeometry({ face }), material);
  const hourHand = new THREE.Mesh(buildClockHandGeometry('hour'), material);
  const minuteHand = new THREE.Mesh(buildClockHandGeometry('minute'), material);
  // The minute hand rides a hair in front of the hour hand, or the two fight over the same
  // plane every time they cross.
  hourHand.position.z = 0.004;
  minuteHand.position.z = 0.010;
  root.add(dial, hourHand, minuteHand);
  group.add(root);
  return { root, hourHand, minuteHand, at: null };
}

// Called every frame. The hands only move when the minute does, so scrubbing a year past
// the tower costs two rotation writes per minute rather than two per frame.
export function updateClock(clock, hour) {
  const tick = Math.round(hour * 60);
  if (tick === clock.at) return;
  clock.at = tick;
  const a = clockAngles(tick / 60);
  clock.hourHand.rotation.z = a.hour;
  clock.minuteHand.rotation.z = a.minute;
}

// ---- the gold pit's clock ---------------------------------------------------------------
// Not the time: the time the pit is full again (Plans/goudkuil.md). It hangs in the gable of
// the pit's office, over the door, and its hands stand at the hour the five-hour window
// turns over - so from across the square the pit says both how much is left (the heap) and
// when the rest comes back (this), without anybody opening anything.
//
// When there is nothing to say - no reading yet, the window already turned over, or somebody
// else's pit, whose count never leaves their machine - the hands come off rather than
// standing at twelve, because a clock at twelve says "noon", and that would be a lie with
// a very confident face.
export function attachResetClock(group, at, material, radius) {
  const clock = attachClock(group, at, material, { face: true, radius });
  clock.shows = undefined;
  setHands(clock, false);
  return clock;
}

function setHands(clock, on) {
  clock.hourHand.visible = on;
  clock.minuteHand.visible = on;
}

// The hour the pit fills again, on this browser's own clock (the same one the dossier's
// "Full again at 17:40" is written in), or null when there is no such hour to show. The
// one clock on the island that is deliberately the reader's and not the sea's: the window
// is this keeper's own and only ever reaches their own page - so the zone is named out loud
// (localZone) rather than read off a local getter, which tests/worldclock.test.mjs refuses.
export function refillHour(gold, now = Date.now()) {
  if (!gold || !gold.known || gold.reset || !gold.resetsAt || gold.resetsAt <= now) return null;
  return worldTime(gold.resetsAt, localZone(gold.resetsAt)).hour;
}

// Called every frame with the keeper's reading (null for a foreign pit). Cheap: nothing is
// written unless the minute shown changes or the hands come on or off.
export function updateResetClock(clock, gold, now = Date.now()) {
  const hour = refillHour(gold, now);
  const on = hour != null;
  if (on !== clock.shows) { setHands(clock, on); clock.shows = on; }
  if (on) updateClock(clock, hour);
}
