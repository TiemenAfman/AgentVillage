// The other people on the island. One mesh each, not an instanced pool: there are two to
// ten of them, capped at sixteen, and a mesh apiece is what lets a name hang above a head
// without any bookkeeping.
//
// Positions arrive about ten times a second and are drawn an eighth of a second in the
// past, interpolated between the last two we were told about. Rendering slightly behind
// is what turns a stream of samples into someone walking.
import * as THREE from 'three';
import { playerGeometry, lerpAngle } from './walk.js';

// How far behind the newest sample we draw. Two server ticks: enough to always have a
// pair to interpolate between, short enough that nobody feels remote.
const LAG_MS = 120;
const MAX_EXTRAPOLATE_MS = 200;
const FADE_S = 0.4;
const BODY_R = 0.35;

const FLAG_MOVING = 1;
const FLAG_SWIMMING = 2;
const FLAG_RUNNING = 4;
const FLAG_AIRBORNE = 8;

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
export function createPeers({ scene, material, terrain }) {
  const places = new Map([[null, { scene, terrain }]]);
  // One geometry per style, shared by everyone wearing it. Never disposed while the page
  // lives: handing it to a peer and then throwing it away when that peer leaves is how
  // the next arrival of the same style renders as garbage.
  const geoByStyle = new Map();
  function geometryFor(style) {
    if (!geoByStyle.has(style)) geoByStyle.set(style, playerGeometry(style));
    return geoByStyle.get(style);
  }

  const peers = new Map();   // id -> peer
  const byRoom = new Map();  // room -> the people in it you can bump into
  const blockersIn = (name) => {
    const key = name || null;
    if (!byRoom.has(key)) byRoom.set(key, []);
    return byRoom.get(key);
  };
  let selfId = null;

  function makePeer(info) {
    // The shared building material, not a copy: main.js writes the night factor into its
    // uniforms once a frame, and a clone would stand in permanent daylight.
    const mesh = new THREE.Mesh(geometryFor(info.style || 'unknown'), material);
    mesh.rotation.order = 'YXZ';       // yaw first, then the swimmer's pitch - as in walk.js
    mesh.castShadow = true;
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
      sprite,
      from: null,          // the two samples we interpolate between
      to: null,
      bob: Math.random() * 6.28,
      room: null,
      want: null,
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
    const from = places.get(p.room);
    if (from) from.scene.remove(p.mesh);
    p.mesh.remove(p.sprite);
    // Only what belongs to this one peer. The geometry and the material are shared.
    p.sprite.material.map.dispose();
    p.sprite.material.dispose();
    peers.delete(p.id);
  }

  // One snapshot: everybody currently on their feet. Anyone we know about who is not in
  // it has stepped back up to the map, so they simply stop being drawn.
  function snapshot(list, at = performance.now()) {
    const seen = new Set();
    for (const row of list || []) {
      const [id, x, y, z, yaw, f, r] = row;
      if (id === selfId) continue;
      const p = peers.get(id);
      if (!p) continue;              // unknown until the next join or roster: one creation path
      seen.add(id);
      p.leaving = false;
      p.fade = 0;
      p.want = typeof r === 'string' ? r : null;
      moveTo(p, p.want);
      const pose = { x, y, z, yaw, f: f | 0, at };
      // Timestamps are our own clock, never the server's: nothing to synchronise and
      // nothing to skew.
      p.from = p.to || pose;
      p.to = pose;
      p.shown = true;
    }
    for (const p of peers.values()) if (p.shown && !seen.has(p.id)) { p.shown = false; p.leaving = true; p.fade = FADE_S; }
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

  function update(dt) {
    const now = performance.now();
    const render = now - LAG_MS;
    for (const list of byRoom.values()) list.length = 0;

    for (const p of [...peers.values()]) {
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
      const span = Math.max(1, b.at - a.at);
      let k = (render - a.at) / span;
      // Past the newest sample we carry on along the last direction for a moment, then
      // hold. Better a step too far than a stutter every time a packet is late.
      if (k > 1) k = Math.min(1 + MAX_EXTRAPOLATE_MS / span, k);
      k = Math.max(0, k);

      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const yaw = lerpAngle(a.yaw, b.yaw, Math.min(1, Math.max(0, k)));
      const f = b.f;
      const moving = !!(f & FLAG_MOVING);
      const swimming = !!(f & FLAG_SWIMMING);
      const running = !!(f & FLAG_RUNNING);
      const airborne = !!(f & FLAG_AIRBORNE);

      // Standing on our own ground rather than on the height we were sent. If a visitor
      // generated the island from a different seed the two terrains disagree, and this is
      // what keeps everyone's feet on the floor instead of sunk or hovering. A jump is the
      // exception: that arc is not something the ground can tell us.
      // The ground of the room they are in, not of the island: indoors that is a flat
      // floor a little over the water line, and the island's terrain knows nothing of it.
      const floor = (places.get(p.room) || {}).terrain;
      const ground = floor ? floor.worldHeight(x, z) : 0;
      const base = airborne ? (a.y + (b.y - a.y) * k) : (ground < 0 ? -0.07 : ground);

      p.bob += dt * (swimming ? (moving ? 6.5 : 1.4) : moving ? (running ? 13 : 9) : 1.5);
      if (swimming) {
        p.mesh.position.set(x, base + Math.sin(p.bob) * 0.03, z);
        p.mesh.rotation.set(1.32 + Math.sin(p.bob) * 0.1, yaw, Math.sin(p.bob * 0.5) * 0.16);
      } else {
        const bobY = moving && !airborne ? Math.abs(Math.sin(p.bob)) * 0.045 : 0;
        p.mesh.position.set(x, base + bobY, z);
        p.mesh.rotation.set(0, yaw, moving ? Math.sin(p.bob) * 0.045 : 0);
      }

      // Somebody to bump into. Swimmers and jumpers are left out: a wall you cannot see
      // standing in open water is worse than walking through a swimmer.
      if (!swimming && !airborne) blockersIn(p.room).push({ x, z, r: BODY_R });
    }
  }

  return {
    join,
    leave,
    roster,
    snapshot,
    update,
    clear,
    place,
    blockers: (name = null) => blockersIn(name),
    setSelf: (id) => { selfId = id; if (peers.has(id)) drop(peers.get(id)); },
    count: () => peers.size,
    dispose: () => {
      clear();
      for (const g of geoByStyle.values()) g.dispose();
      geoByStyle.clear();
    },
  };
}
