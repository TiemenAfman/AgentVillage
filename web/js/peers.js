// The other people on the island. One figure each, not an instanced pool: there are two to
// ten of them, capped at sixteen, and a figure apiece is what lets a name hang above a head
// without any bookkeeping. The figure is the one you are drawn as yourself - classic-avatar.js,
// in their own look (web/js/avatar.js, sent by their page) and driven by the pose their page
// sends - so a body lies, crouches, sits, swings and drinks here as it does on its own screen
// (Plans/andere-spelers-zoals-jij.md). A handful of meshes each rather than one, which sixteen
// people can afford and three hundred settlers could not: those stay instanced.
//
// Positions arrive about ten times a second and are drawn an eighth of a second in the
// past, interpolated between the last two we were told about - web/js/timeline.js, the one
// timeline the boats somebody else is steering are drawn on too.
import * as THREE from 'three';
import { lerpAngle } from './walk.js';
import { createBicycle, RIDER, GEOMETRY as BIKE } from './bicycle.js';
import { createClassicAvatar, HIP_Y } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';
import { LAG_MS, progress } from './timeline.js';
import { toWorld } from 'shared/deck.mjs';

const FADE_S = 0.4;
const BODY_R = 0.35;

const FLAG_MOVING = 1;
const FLAG_SWIMMING = 2;
const FLAG_RUNNING = 4;
const FLAG_AIRBORNE = 8;
// The right mouse button held. net.js's FLAG_BLOCKING, copied rather than imported so this
// file keeps its one import of walk.js; lib/players.mjs's POSE is the sea's copy of all five.
const FLAG_BLOCKING = 16;
// In the saddle: net.js's FLAG_RIDING. The bicycle is drawn here from the pose alone - its
// wheels turn with how fast the peer is actually going, its bars and lean with how fast they
// are turning - because the sea only ever relays the one bit (Plans/fiets.md).
const FLAG_RIDING = 128;
// On their back, crouched, on a seat: net.js's FLAG_LYING, FLAG_CROUCHING, FLAG_SITTING.
const FLAG_LYING = 256;
const FLAG_CROUCHING = 512;
const FLAG_SITTING = 1024;
// A rider on the saddle, leaning over the bars as walk.js's own rider does (its RIDE_PITCH).
const RIDE_PITCH = 0.28;
// The rest of these poses are walk.js's numbers for our own figure, copied rather than
// imported so this file keeps its one import of walk.js: the tilt of somebody lying on their
// back (head at -z, front face up), and how far a crouch folds the whole body.
const LIE_PITCH = -1.5;
const CROUCH_FOLD = 0.82;
// How far somebody behind their shield leans back into it, on top of the raised arm.
const BRACE_LEAN = -0.1;

// The room a pilot's pose names (main.js `setRoom('boat')`). Not a place to be drawn in: a
// boat is out of doors. The sea reads the room as "not on foot" (`afoot` in
// lib/hostility.mjs), which is why it is sent at all; here it only says the body belongs
// on its hull. Taken as a room it named a place this page never builds, and `moveTo` then
// left the pilot hidden - everybody else saw the boat sail with nobody in it.
const BOAT_ROOM = 'boat';

const LABEL_W = 256;
const LABEL_H = 64;

function labelTexture(text) {
  const c = document.createElement('canvas');
  c.width = LABEL_W;
  c.height = LABEL_H;
  const g = c.getContext('2d');
  // The same painted plaque as the yard signs, so a name over a head belongs to the
  // same island as the name on a gate.
  const r = 12;
  g.fillStyle = '#f3e7cf';
  g.beginPath();
  g.moveTo(r, 2);
  g.arcTo(LABEL_W - 2, 2, LABEL_W - 2, LABEL_H - 2, r);
  g.arcTo(LABEL_W - 2, LABEL_H - 2, 2, LABEL_H - 2, r);
  g.arcTo(2, LABEL_H - 2, 2, 2, r);
  g.arcTo(2, 2, LABEL_W - 2, 2, r);
  g.closePath();
  g.fill();
  g.strokeStyle = '#5a3c28';
  g.lineWidth = 5;
  g.stroke();

  g.fillStyle = '#3a2a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const name = String(text || 'Someone').slice(0, 18);
  for (let size = 30; size >= 13; size -= 2) {
    g.font = `600 ${size}px "Iowan Old Style", "Palatino Linotype", Georgia, serif`;
    if (g.measureText(name).width <= LABEL_W - 34) break;
  }
  g.fillText(name, LABEL_W / 2, LABEL_H / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Where a room's people get drawn, and what they stand on. The island is the room with
// no name; a tavern registers itself under its own, and a peer moves between them as
// their pose says so. One peer list either way: the label, the geometry and the join
// bookkeeping are the same wherever somebody happens to be standing.
// `ground` is anything that answers `worldHeight(x, z)`: one island's terrain, or the whole
// archipelago's facade. It is what the outdoors stands on, and once there is more than one
// island it has to be the archipelago - otherwise a peer walking the island to the east is
// stood on the height our own coast happens to have at that x and z, which is the sea.
// `seatOf(id)` is where a pilot stands on the hull they are steering, in this scene's frame -
// { x, y, z, yaw }, from main.js, which owns the boats - or null when this page draws no such
// hull. The hull is drawn on the same timeline as everybody's pose (timeline.js), so a pilot
// put on it stays on it; their own pose, drawn separately, trails the hull by the lag.
//
// `hullOf(boatId)` is the same hull for somebody standing on its deck (Plans/lopen-op-de-boot.md):
// { x, y, z, yaw }, with y its deck. They are drawn as that hull plus where they are on it,
// and never from their own world position, for the same reason a pilot is.
export function createPeers({ scene, material, terrain, ground = null, onCursor = () => {}, seatOf = () => null, hullOf = () => null }) {
  const places = new Map([[null, { scene, terrain: ground || terrain }]]);

  const peers = new Map();   // id -> peer
  const byRoom = new Map();  // room -> the people in it you can bump into
  const blockersIn = (name) => {
    const key = name || null;
    if (!byRoom.has(key)) byRoom.set(key, []);
    return byRoom.get(key);
  };
  let selfId = null;

  // Somebody's look as their page sent it, through the wardrobe's own whitelist - the sea only
  // checked its shape (lib/players.mjs lookOf). A page from before looks were sent says
  // nothing, and gets the settler everybody starts as.
  const lookOf = (info) => normalizeAvatar((info && info.look) || {});

  function makePeer(info) {
    // The shared building material, not a copy: main.js writes the night factor into its
    // uniforms once a frame, and a clone would stand in permanent daylight.
    const look = lookOf(info);
    const avatar = createClassicAvatar(look, material);
    // `mesh` is the body as a whole - the group every pose moves and turns, with the rig in it
    // and the name over it - and kept under that name because that is what everything below
    // has always moved.
    const mesh = new THREE.Group();
    mesh.rotation.order = 'YXZ';       // yaw first, then the swimmer's pitch - as in walk.js
    mesh.add(avatar.object);
    mesh.visible = false;
    scene.add(mesh);                   // outdoors until a pose says otherwise

    const tex = labelTexture(info.name);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
    sprite.scale.set(0.9, 0.225, 1);
    sprite.position.set(0, 0.66, 0);
    mesh.add(sprite);

    return {
      id: info.id,
      name: info.name,
      style: info.style,
      keeper: !!info.keeper,
      mesh,
      avatar,
      look,
      lookKey: JSON.stringify(look),
      sprite,
      from: null,          // the two samples we interpolate between
      to: null,
      bob: Math.random() * 6.28,
      room: null,
      want: null,
      aboard: false,      // at a tiller: drawn on their hull (seatOf), not on the ground
      deckFrom: null,     // on a deck: the two samples of where on it, in the hull's frame
      deckTo: null,
      cursor: null,       // where their hand is on a board, if it is on one
      bike: null,         // their bicycle, made the first time they are seen riding
      ride: { wheel: 0, crank: 0, steer: 0, lean: 0, pitch: 0, x: 0, y: 0, z: 0, yaw: 0 },
      shown: false,
      fade: 0,             // seconds left of the leaving animation
      leaving: false,
    };
  }

  function join(info) {
    if (!info || !info.id || info.id === selfId) return;
    const have = peers.get(info.id);
    if (have) {
      // A join for someone we know is a rename.
      if (have.name !== info.name) {
        have.name = info.name;
        have.sprite.material.map.dispose();
        have.sprite.material.map = labelTexture(info.name);
      }
      // And a change of clothes, or of what is in their hands.
      const look = lookOf(info);
      const key = JSON.stringify(look);
      if (key !== have.lookKey) { have.avatar.set(look); have.look = look; have.lookKey = key; }
      have.leaving = false;
      return;
    }
    peers.set(info.id, makePeer(info));
  }

  function leave(id) {
    const p = peers.get(id);
    if (!p) return;
    // Not removed on the spot: someone blinking out mid-stride reads as a glitch, so
    // they shrink away over a moment instead.
    p.leaving = true;
    p.fade = FADE_S;
  }

  // A room the page has built and can draw. Registering one after the fact is normal:
  // the tavern is not built until somebody first opens its door.
  function place(name, where) {
    if (where) places.set(name || null, where);
    else places.delete(name);
  }

  // Somebody has walked through a door: their body goes with them. A room nobody has
  // built yet leaves them where they were, which is the honest answer -- there is no
  // scene to put them in.
  function moveTo(p, name) {
    const to = places.get(name || null);
    if (!to || p.room === (name || null)) return;
    const from = places.get(p.room);
    if (from) from.scene.remove(p.mesh);
    to.scene.add(p.mesh);
    p.room = name || null;
    p.from = null;                     // do not slide them in from the other room
  }

  function drop(p) {
    setCursor(p, null);
    if (p.bike) { p.bike.dispose(); p.bike = null; }
    const from = places.get(p.room);
    if (from) from.scene.remove(p.mesh);
    p.mesh.remove(p.sprite);
    // Only what belongs to this one peer: their figure's own geometry, and their name. The
    // material is the island's.
    p.avatar.dispose();
    p.sprite.material.map.dispose();
    p.sprite.material.dispose();
    peers.delete(p.id);
  }

  // One snapshot: everybody currently on their feet. Anyone we know about who is not in
  // it has stepped back up to the map, so they simply stop being drawn.
  function snapshot(list, at = performance.now(), decks = null) {
    const seen = new Set();
    // Who is on which deck (lib/players.mjs `d`): [id, boat, x, y, z, yaw] in that boat's own
    // frame. Kept as samples of their own, on the same clock, so a passenger walking along the
    // deck is interpolated along the deck while the deck is interpolated along the sea.
    const onDeck = new Map();
    for (const r of decks || []) if (Array.isArray(r) && r.length === 6) onDeck.set(r[0], r);
    for (const row of list || []) {
      const [id, x, y, z, yaw, f, r] = row;
      if (id === selfId) continue;
      const p = peers.get(id);
      if (!p) continue;              // unknown until the next join or roster: one creation path
      seen.add(id);
      p.leaving = false;
      p.fade = 0;
      p.aboard = r === BOAT_ROOM;
      p.want = typeof r === 'string' && !p.aboard ? r : null;
      moveTo(p, p.want);
      const pose = { x, y, z, yaw, f: f | 0, at };
      // Timestamps are our own clock, never the server's: nothing to synchronise and
      // nothing to skew.
      p.from = p.to || pose;
      p.to = pose;
      p.shown = true;
      const d = onDeck.get(id);
      if (d) {
        const s = { boat: d[1], x: d[2], y: d[3], z: d[4], yaw: d[5], at };
        p.deckFrom = p.deckTo && p.deckTo.boat === s.boat ? p.deckTo : s;
        p.deckTo = s;
      } else p.deckFrom = p.deckTo = null;
      // A seventh entry means their hand is on a board. It rides here rather than in a
      // message of its own - see the pose beat in web/js/net.js.
      // Slots 7 to 9 are their hand on a board, when there is one; slot 6 is the room,
      // read just above. The row this comes off is described in lib/players.mjs.
      setCursor(p, row.length > 7 ? { board: row[7], u: row[8], v: row[9] } : null);
    }
    for (const p of peers.values()) {
      if (p.shown && !seen.has(p.id)) { p.shown = false; p.leaving = true; p.fade = FADE_S; setCursor(p, null); }
    }
  }

  // Only on a change, so the panels are not handed the same position ten times a second.
  function setCursor(p, at) {
    const had = p.cursor;
    if (!had && !at) return;
    if (had && at && had.board === at.board && had.u === at.u && had.v === at.v) return;
    p.cursor = at;
    onCursor(p.id, at ? { ...at, name: p.name, style: p.style } : null);
  }

  function roster(list) {
    const ids = new Set();
    for (const info of list || []) { ids.add(info.id); join(info); }
    for (const p of peers.values()) if (p.id !== selfId && !ids.has(p.id)) leave(p.id);
  }

  function clear() {
    for (const p of [...peers.values()]) drop(p);
    for (const list of byRoom.values()) list.length = 0;
  }

  // Whether anybody is drawn at all. Off while the chronicle is scrubbed back: the other
  // people are here, now, and the island on the screen is the island in May. Letting them
  // wander through a village that has not been built yet is worse than an empty street.
  //
  // The poses keep arriving and keep being interpolated - only the meshes go - so coming
  // back to Live puts everybody where they actually are rather than where they were when
  // you left it.
  let showing = true;
  function setVisible(on) { showing = !!on; }

  function update(dt) {
    const now = performance.now();
    const render = now - LAG_MS;
    for (const list of byRoom.values()) list.length = 0;

    if (!showing) {
      for (const p of peers.values()) p.mesh.visible = false;
      return;
    }

    for (const p of [...peers.values()]) {
      if (p.bike) p.bike.visible = false;   // shown again below, by a pose that says so
      if (p.leaving) {
        p.fade -= dt;
        if (p.fade <= 0) { drop(p); continue; }
        const k = Math.max(0, p.fade / FADE_S);
        p.mesh.scale.setScalar(k);
        p.mesh.visible = true;
        continue;
      }
      if (!p.to) { p.mesh.visible = false; continue; }
      // Somewhere this page has not built. Better nowhere than standing outside a room
      // they are actually sitting in.
      if (p.room !== p.want) { p.mesh.visible = false; continue; }
      p.mesh.scale.setScalar(1);
      p.mesh.visible = true;

      const a = p.from || p.to, b = p.to;
      const k = progress(a, b, render);
      // Where they stand, if it is on something that moves: a deck first, then a helm.
      const seat = deckPose(p, render) || (p.aboard ? seatOf(p.id) : null);

      let x = a.x + (b.x - a.x) * k;
      let z = a.z + (b.z - a.z) * k;
      let yaw = lerpAngle(a.yaw, b.yaw, Math.min(1, k));
      if (seat) { x = seat.x; z = seat.z; yaw = seat.yaw; }
      const f = b.f;
      const moving = !!(f & FLAG_MOVING);
      const swimming = !!(f & FLAG_SWIMMING);
      const running = !!(f & FLAG_RUNNING);
      const airborne = !!(f & FLAG_AIRBORNE);
      const blocking = !!(f & FLAG_BLOCKING);
      const lying = !!(f & FLAG_LYING) && !swimming;
      const sitting = !!(f & FLAG_SITTING) && !swimming;
      const crouching = !!(f & FLAG_CROUCHING) && !lying && !swimming;

      // Standing on our own ground rather than on the height we were sent. If a visitor
      // generated the island from a different seed the two terrains disagree, and this is
      // what keeps everyone's feet on the floor instead of sunk or hovering. A jump is the
      // exception: that arc is not something the ground can tell us.
      // The ground of the room they are in, not of the island: indoors that is a flat
      // floor a little over the water line, and the island's terrain knows nothing of it.
      // Outdoors it is the whole archipelago, which is what finally makes the paragraph
      // above true rather than merely careful: a peer on the island to the east now stands
      // on THAT island's ground, and in the channel between them on nothing at all.
      const floor = (places.get(p.room) || {}).terrain;
      const ground = floor ? floor.worldHeight(x, z) : 0;
      // Aboard, the deck is what they stand on: the hull's own, or - for a hull this page
      // does not draw - the deck height their pose was sent with, rather than the sea bed.
      // A seat is the one other place the height they were sent is the truth: a bar stool
      // holds you above the floor, and the floor is all this page's ground knows of.
      const base = seat ? seat.y
        : p.aboard || airborne || sitting ? (a.y + (b.y - a.y) * k)
          : (ground < 0 ? -0.07 : ground);

      p.bob += dt * (swimming ? (moving ? 6.5 : 1.4) : moving ? (running ? 13 : 9) : 1.5);
      const riding = !!(f & FLAG_RIDING) && !swimming && !p.room;
      if (riding) {
        ride(p, x, base, z, yaw, dt);
      } else if (swimming) {
        p.mesh.position.set(x, base + Math.sin(p.bob) * 0.03, z);
        p.mesh.rotation.set(1.32 + Math.sin(p.bob) * 0.1, yaw, Math.sin(p.bob * 0.5) * 0.16);
      } else if (lying) {
        p.mesh.position.set(x, base, z);
        p.mesh.rotation.set(LIE_PITCH, yaw, 0);
      } else if (sitting) {
        p.mesh.position.set(x, base, z);
        p.mesh.rotation.set(0, yaw, 0);
      } else {
        // The legs walk now (the rig below), so the whole body only rocks a little with it.
        p.mesh.position.set(x, base, z);
        p.mesh.rotation.set(blocking ? BRACE_LEAN : 0, yaw, moving ? Math.sin(p.bob) * 0.02 : 0);
        if (crouching) p.mesh.scale.set(1, CROUCH_FOLD, 1);
      }
      // And the limbs, from the same pose our own figure is given by walk.js. The raised
      // shield is whichever hand holds one, as walk.js decides it for us.
      const eq = p.look.equip;
      p.avatar.update({
        moving: moving && !lying && !sitting, running, grounded: !airborne,
        crouching, sitting, lying, swimming,
        blocking: blocking ? { leftArm: eq.leftHandItem === 'shield', rightArm: eq.rightHandItem === 'shield' } : false,
        phase: p.bob, firstPerson: false, pitch: 0,
        riding: riding ? { crank: p.ride.crank, standing: false } : null,
      }, dt);

      // Somebody to bump into. Swimmers, jumpers and pilots are left out: a wall you cannot
      // see standing in open water is worse than walking through a swimmer.
      if (!swimming && !airborne && !p.aboard && !p.deckTo) blockersIn(p.room).push({ x, z, r: BODY_R });
    }
  }

  // Somebody on a deck, in this scene: their hull as hullOf has it this frame, plus where on
  // the deck they were at `render`, interpolated in the hull's own frame. Null when they are
  // on no deck, or on one this page is not drawing.
  const deckAt = [0, 0];
  function deckPose(p, render) {
    if (!p.deckTo) return null;
    const hull = hullOf(p.deckTo.boat);
    if (!hull) return null;
    const a = p.deckFrom || p.deckTo, b = p.deckTo;
    const k = progress(a, b, render);
    const lx = a.x + (b.x - a.x) * k, lz = a.z + (b.z - a.z) * k;
    const ly = a.y + (b.y - a.y) * Math.min(1, k);
    toWorld({ x: hull.x, z: hull.z, fx: Math.sin(hull.yaw), fz: Math.cos(hull.yaw) }, lx, lz, deckAt);
    return { x: deckAt[0], y: hull.y + ly, z: deckAt[1], yaw: hull.yaw + lerpAngle(a.yaw, b.yaw, Math.min(1, k)) };
  }

  // One frame of a peer on a bicycle. Everything the bike does is read off where the rider
  // has got to since the last frame: distance is the wheels, a turn is the bars and the lean.
  function ride(p, x, y, z, yaw, dt) {
    const r = p.ride;
    if (!p.bike) {
      p.bike = createBicycle({ scene, material });   // outdoors only: nobody rides indoors
      r.x = x; r.y = y; r.z = z; r.yaw = yaw;
    }
    const step = Math.hypot(x - r.x, z - r.z);
    // Forwards or backwards along the heading, and never a jump from a teleport or a respawn.
    const along = step < 1 ? Math.sign((x - r.x) * Math.sin(yaw) + (z - r.z) * Math.cos(yaw)) * step : 0;
    let turned = yaw - r.yaw;
    if (turned > Math.PI) turned -= Math.PI * 2;
    else if (turned < -Math.PI) turned += Math.PI * 2;
    const rate = dt > 0 ? -turned / dt : 0;      // right is a falling yaw
    const speed = dt > 0 ? Math.abs(along) / dt : 0;
    r.wheel = (r.wheel + along / BIKE.tyre) % (Math.PI * 2);
    if (along > 0) r.crank = (r.crank + along / BIKE.tyre / 4.5) % (Math.PI * 2);
    const k = 1 - Math.exp(-8 * dt);
    r.steer += (Math.max(-0.5, Math.min(0.5, rate * 0.25)) - r.steer) * k;
    r.lean += (Math.max(-0.3, Math.min(0.3, rate * speed * 0.03)) - r.lean) * k;
    // A hop (their pose says AIRBORNE and carries the height): nose up rising, down falling,
    // by bicycle.js's own 0.07 per unit of vertical speed.
    const climb = dt > 0 && Math.abs(y - r.y) < 1 ? (y - r.y) / dt : 0;
    r.pitch += (Math.max(-0.3, Math.min(0.3, climb * 0.07)) - r.pitch) * k;
    r.x = x; r.y = y; r.z = z; r.yaw = yaw;

    p.bike.visible = true;
    p.bike.place(x, y, z, yaw);
    p.bike.pose(r);
    p.bike.object.updateMatrixWorld(true);
    seat.set(RIDER.saddle[0], RIDER.saddle[1] - HIP_Y, RIDER.saddle[2]);
    p.bike.object.localToWorld(seat);
    p.mesh.position.copy(seat);
    p.mesh.rotation.set(RIDE_PITCH - r.pitch, yaw, r.lean);
  }
  const seat = new THREE.Vector3();

  // Somebody else's arm (net.js `swung`, `drank`): a swing coming down on the hand it was, a
  // glass going up to the mouth. The rig refuses what it cannot do - a drink from a hand with
  // no beer in it, a swing on top of one still winding up - exactly as it does for our own.
  function act(id, kind, side) {
    const p = peers.get(id);
    if (!p || p.leaving) return;
    if (kind === 'attack') p.avatar.attack(side || undefined);
    else if (kind === 'drink' && side) p.avatar.drink(side);
  }

  return {
    join,
    leave,
    roster,
    snapshot,
    update,
    act,
    setVisible,
    clear,
    place,
    blockers: (name = null) => blockersIn(name),
    // A player id is only a name in here, so anything that wants to say who somebody is
    // has to ask. Somebody who has already left keeps a placeholder rather than an id.
    nameOf: (id) => (peers.get(id) ? peers.get(id).name : 'Somebody'),
    setSelf: (id) => { selfId = id; if (peers.has(id)) drop(peers.get(id)); },
    count: () => peers.size,
    dispose: () => { clear(); },
  };
}
