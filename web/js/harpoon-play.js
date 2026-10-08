// The harpoons in play on this page (Plans/harpoen.md): one line per manned harpoon of a ship we stand
// on, fired from walk mode's gun (main.js onGunFire, kind 'harpoon'), flown and reeled by
// web/js/harpoon-line.js, and what a hooked line does:
//
//   the statue   dragged to the gun's mouth over the water (treasure.js drag), and laid on the deck when
//                the reel has her in (reelAboard) - a line is how a ship takes a floating statue aboard
//   a player     the sea is told (`hook`), and their own page reels them in (walk.js pullTo); let go,
//                or at the gun, they are let go of (`free`)
//   a loose boat nobody at her helm and nobody aboard: drawn to us, and the sea told where (`tow`)
//   land         our own ship is drawn to it, and making way goes round it (harpoon-tow.js)
//   a ship       somebody is sailing: ours hangs on to hers and is drawn after her ("chase")
//
// Only our own hull is moved by our own line, and only while no other page is stepping her (followed):
// on the sea a boat goes where her pilot's page - or the page that just let go of her - says
// (lib/boats.mjs). Every line's state goes to the sea while it is out ({t:'harpoon', a:'line'}), so
// every other page draws it from that ship's harpoon (remote lines below), and a pilot whose crew has a
// line in land or a ship draws their own ship along it as if they were at the gun.
//
// The fire button with a line out lets go of it. Leaving the gun lets go of a line on the statue or a
// player (and the bolt is reeled home on its own); one made fast in land or a ship stays where it is,
// unreeled, as a way across (ropes(): walk.js takeRope) until it is let go of, or the ship drifts far
// enough to part it.
import * as THREE from 'three';
import { createHarpoonLine } from './harpoon-line.js';
import { towHull } from './harpoon-tow.js';
import { REEL_MIN } from 'shared/harpoon.mjs';

// How short the reel draws a line on each kind of hold: a statue to the mouth, a player to the rail, a
// ship to the length of the two hulls apart, land to where she would still float, a loose rowing boat
// alongside.
const HOLD = Object.freeze({ statue: REEL_MIN, player: 1.8, land: 6, galleon: 9, rowboat: 3 });
// How big each kind of target is to a bolt (its middle above the water, and a radius).
const HULL_R = Object.freeze({ galleon: 2.4, rowboat: 0.8 });
const HULL_Y = Object.freeze({ galleon: 1.6, rowboat: 0.4 });
const STATUE_R = 0.45;
const BODY_R = 0.35, BODY_MID = 0.25;
// How much further than the line is long the two ends may come apart before it parts (a ship drifting
// off a line nobody is reeling, a hooked player who jumped free).
const SNAP = 2.5;
// A statue the reel has within this of the gun's mouth is on board.
const ABOARD_AT = REEL_MIN + 0.4;
// How often a line out says where it is, and how long somebody else's lasts unheard.
const SEND_EVERY = 0.1;
const REMOTE_FOR = 1.5;
// How often a loose boat on our line has her place said to the sea.
const TOW_SEND_EVERY = 0.15;

// deps: scene, boats() (state.boats), sea() (state.sea: height(x, z)), hunt() (state.hunt), kindOf(b)
// ('galleon' | 'rowboat'), followed(b) (main.js hullFollowed), surfaceAt(x, z) the water's height,
// net() (state.net or null), peers() (peers.list(): other players as drawn), boatAt(id), stepping(b)
// (this page is sailing hull `b`: her pilot, not followed).
export function createHarpoonPlay(deps) {
  const lines = new Map();       // `${boat.id}:${i}` -> { line, boat, i, bolt, held, sent, ... }
  const remote = new Map();      // `${player}:${boat}:${i}` -> { line, boat, i, at, L, k, seen }
  const towing = new Set();      // ids of loose boats on one of our lines (main.js leaves their echoes)
  // What sound.js hears (its cue rule): a counter and the last few shots, ratchet clicks and creaks of
  // the line, each with where it was. Nothing here plays anything.
  const heard = { n: 0, list: [] };
  function hear(kind, p) {
    heard.n++;
    heard.list.push({ n: heard.n, kind, x: p.x, y: p.y, z: p.z });
    if (heard.list.length > 12) heard.list.shift();
  }
  const mouthL = new THREE.Vector3(), dirW = new THREE.Vector3(), q = new THREE.Quaternion();
  const net = () => (deps.net ? deps.net() : null);

  // Where gun `i` of hull `b` has its mouth this frame, in the scene, and where it points.
  function mouthOf(b, i, at = mouthL) {
    const m = b.craft && b.craft.gunMuzzle ? b.craft.gunMuzzle(i) : null;
    if (!m) return null;
    b.craft.object.updateMatrixWorld();
    b.craft.object.localToWorld(at.set(m.at[0], m.at[1], m.at[2]));
    b.craft.object.getWorldQuaternion(q);
    dirW.set(m.dir[0], m.dir[1], m.dir[2]).applyQuaternion(q).normalize();
    return { at, dir: dirW };
  }

  const ground = (x, z) => { const s = deps.sea(); return s ? s.height(x, z) : null; };
  // A boat nobody sails or stands on: ours to draw in (lib/boats.mjs tow says the same).
  const loose = (b) => !!b && !b.pilot && !(Array.isArray(b.crew) && b.crew.length) && !/^boat:w-/.test(b.id);
  // What a bolt fired from hull `own` can hook this frame.
  function targets(own) {
    const out = [];
    const hunt = deps.hunt();
    const st = hunt && hunt.loose ? hunt.loose() : null;
    if (st) {
      out.push({ id: 'statue', kind: 'statue', x: st.x, y: st.y + 0.25, z: st.z, r: STATUE_R,
        at(o) { const s = hunt.loose(); if (s) { o.x = s.x; o.y = s.y + 0.25; o.z = s.z; } return o; } });
    }
    for (const b of deps.boats() || []) {
      if (b === own || !b.craft) continue;
      const kind = deps.kindOf(b);
      out.push({ id: b.id, kind, x: b.x, y: HULL_Y[kind], z: b.z, r: HULL_R[kind],
        at(o) { o.x = b.x; o.y = HULL_Y[kind]; o.z = b.z; return o; } });
    }
    // Other players on foot or swimming (the keeper: "altijd"; the sea keeps their own island safe).
    for (const p of (deps.peers ? deps.peers() : []) || []) {
      if (p.sailing || (p.room && p.room !== 'boat')) continue;
      out.push({ id: p.id, kind: 'player', x: p.x, y: p.y + BODY_MID, z: p.z, r: BODY_R,
        at(o) {
          const now = (deps.peers() || []).find((x) => x.id === p.id);
          if (now) { o.x = now.x; o.y = now.y + BODY_MID; o.z = now.z; }
          return o;
        } });
    }
    return out;
  }

  function entry(b, i) {
    const key = `${b.id}:${i}`;
    let e = lines.get(key);
    if (!e) {
      const line = createHarpoonLine({ world: { ground, targets: () => targets(b) } });
      deps.scene.add(line.mesh);
      const bolt = b.craft.harpoonBoltClone ? b.craft.harpoonBoltClone(i) : null;
      if (bolt) { bolt.visible = false; deps.scene.add(bolt); }
      e = { line, boat: b, i, bolt, held: null, sentAt: 0, out: false, towAt: 0 };
      lines.set(key, e);
    }
    return e;
  }

  // The fire button at harpoon `i` of hull `b`: out it goes, or - with a line out - it is let go of.
  function fire(b, i) {
    const e = entry(b, i);
    if (e.line.state !== 'stowed') { letGoOf(e); return 'released'; }
    const m = mouthOf(b, i);
    if (!m) return null;
    const carry = { x: Math.sin(b.yaw) * (b.v || 0), z: Math.cos(b.yaw) * (b.v || 0) };
    if (!e.line.fire(m.at, m.dir, carry)) return null;
    hear('harpoon', m.at);
    e.sentAt = -Infinity;
    return 'fired';
  }
  function letGoOf(e) {
    if (e.held === 'statue') { const h = deps.hunt(); if (h && h.dragEnd) h.dragEnd(); }
    if (e.held === 'player' && e.heldId) { const n = net(); if (n && n.harpoonFree) n.harpoonFree({ b: e.boat.id, who: e.heldId }); }
    if (e.heldId) towing.delete(e.heldId);
    e.held = null;
    e.heldId = null;
    e.line.release();
  }
  // Leaving the gun: a line on land or a ship is left fast, and stops reeling; anything else is let go.
  function release(b, i) {
    const e = lines.get(`${b.id}:${i}`);
    if (!e || e.line.state === 'stowed') return;
    const h = e.line.hooked();
    if (h && (h.kind === 'land' || ((h.kind === 'galleon' || h.kind === 'rowboat') && !towing.has(h.id)))) e.line.reeling = false;
    else letGoOf(e);
  }
  // Back at it: the reel takes in again.
  function manned(b, i) {
    const e = lines.get(`${b.id}:${i}`);
    if (e) e.line.reeling = true;
  }

  // What our own hull is drawn along: a line that holds land, or a ship somebody sails.
  const pulls = (h) => h && (h.kind === 'land' || ((h.kind === 'galleon' || h.kind === 'rowboat') && !towing.has(h.id)));
  // Our hull, drawn along a line of hers (walk.js stepGun, onGunTow).
  function tow(b, gun, dt) {
    if (deps.followed(b)) return;
    const e = lines.get(`${b.id}:${gun.i}`);
    const h = e && e.line.hooked();
    if (!pulls(h)) return;
    strain(e, towHull(b, h, e.line.L, dt, !e.line.reeledIn()), h, dt);
  }
  // The line straining: a creak every so often while it pulls.
  function strain(e, taut, at, dt) {
    if (!taut) return;
    e.creak = (e.creak || 0) - dt;
    if (e.creak <= 0) { e.creak = 1.3 + Math.random() * 0.8; hear('creak', at); }
  }

  const at = new THREE.Vector3(), look = new THREE.Vector3();
  // Every frame, after walk mode has stepped (so the mouths are where the hulls are drawn).
  function frame(dt) {
    for (const [key, e] of lines) {
      const b = e.boat;
      if (!(deps.boats() || []).includes(b)) { dispose(key, e); continue; }
      const m = mouthOf(b, e.i, at);
      if (!m) continue;
      const { line } = e;
      const clicks = line.cues.clicks;
      line.update(m.at, dt);
      // The reel's pawl: one tick heard a frame however many it made, or a fast reel is a buzz.
      if (line.cues.clicks > clicks) hear('ratchet', m.at);
      const h = line.hooked();
      if (h && !e.held) hooked(e, h);
      if (h && h.kind === 'statue') haulStatue(e, m.at);
      else if (h && h.kind === 'player') haulPlayer(e, h, m.at);
      else if (h && towing.has(h.id)) haulBoat(e, h, m.at, dt);
      // A line nobody reels parts when its ends come too far apart.
      else if (h && !line.reeling && Math.hypot(h.x - m.at.x, h.y - m.at.y, h.z - m.at.z) > line.L + SNAP) letGoOf(e);
      if (!h && e.held) { if (e.heldId) towing.delete(e.heldId); e.held = null; e.heldId = null; }
      say(e, m.at, dt);
      if (b.craft.harpoonBolt) b.craft.harpoonBolt(e.i, line.state === 'stowed');
      if (e.bolt) {
        e.bolt.visible = line.state !== 'stowed';
        if (e.bolt.visible) {
          e.bolt.position.set(line.bolt.x, line.bolt.y, line.bolt.z);
          // Point first along its flight, then - held or coming home - away from the gun along the line.
          if (line.state === 'flying') look.set(line.bolt.x + line.bolt.vx, line.bolt.y + line.bolt.vy, line.bolt.z + line.bolt.vz);
          else look.set(2 * line.bolt.x - m.at.x, 2 * line.bolt.y - m.at.y, 2 * line.bolt.z - m.at.z);
          e.bolt.lookAt(look);
        }
      }
    }
    remoteFrame(dt);
  }

  // The moment a line takes hold: how short it will be reeled, and who has to know.
  function hooked(e, h) {
    e.held = h.kind;
    e.heldId = h.id ?? null;
    e.line.minL = HOLD[h.kind] ?? REEL_MIN;
    if (h.kind === 'player') { const n = net(); if (n && n.harpoonHook) n.harpoonHook({ b: e.boat.id, i: e.i, who: h.id }); }
    if ((h.kind === 'galleon' || h.kind === 'rowboat') && loose(deps.boatAt ? deps.boatAt(h.id) : null)) towing.add(h.id);
  }

  // Our line's state for everybody else, a few times a second while it is out, and once when it is in.
  function say(e, mouth, dt) {
    const n = net();
    if (!n || !n.harpoonLine) return;
    const out = e.line.state !== 'stowed';
    if (!out) {
      if (e.out) { e.out = false; n.harpoonLine({ b: e.boat.id, i: e.i, s: 'off' }); }
      return;
    }
    e.sentAt += dt;
    if (e.out && e.sentAt < SEND_EVERY) return;
    e.out = true;
    e.sentAt = 0;
    const h = e.line.hooked();
    const bo = e.line.bolt;
    n.harpoonLine({ b: e.boat.id, i: e.i, s: 'out', at: [bo.x, bo.y, bo.z], L: Math.min(e.line.L, 40), k: h ? h.kind : '' });
  }

  // A player on the line: their own page reels them in (walk.js pullTo, on the sea's `hooked`). Here the
  // line only follows them, and lets go once they are at the rail, or if they get away from it.
  function haulPlayer(e, h, mouth) {
    const d = Math.hypot(h.x - mouth.x, h.y - mouth.y, h.z - mouth.z);
    if (d <= HOLD.player + 0.4 || d > e.line.L + SNAP * 2) letGoOf(e);
  }

  // A loose boat on the line: drawn to us along the water (never further from the mouth than the line),
  // her bow turned to the pull, and the sea told where she is now.
  function haulBoat(e, h, mouth, dt) {
    const b2 = deps.boatAt ? deps.boatAt(h.id) : null;
    if (!loose(b2)) { towing.delete(h.id); return; }
    const dx = mouth.x - b2.x, dz = mouth.z - b2.z;
    const d = Math.hypot(dx, dz);
    if (d > e.line.L) {
      const k = (d - e.line.L) / d;
      b2.x += dx * k; b2.z += dz * k;
      const want = Math.atan2(dx, dz);
      const turn = want - b2.yaw - Math.round((want - b2.yaw) / (Math.PI * 2)) * Math.PI * 2;
      b2.yaw += Math.max(-0.6 * dt, Math.min(0.6 * dt, turn));
      strain(e, true, b2, dt);
    }
    e.towAt += dt;
    if (e.towAt >= TOW_SEND_EVERY) {
      e.towAt = 0;
      const n = net();
      if (n && n.towBoat) n.towBoat(b2.id, e.boat.id, b2.x, b2.z, b2.yaw);
    }
  }

  // The statue on the line: never further from the mouth than the line is long, along the water (or
  // the sand, if that is where the line drags her), and aboard once the reel has her in.
  function haulStatue(e, mouth) {
    const hunt = deps.hunt();
    const s = hunt && hunt.loose ? hunt.loose() : null;
    if (!s) { letGoOf(e); return; }
    const dx = mouth.x - s.x, dz = mouth.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d <= ABOARD_AT || e.line.reeledIn()) {
      if (hunt.reelAboard(e.boat)) { e.held = null; e.line.release(); }
      return;
    }
    if (d <= e.line.L) return;
    const k = (d - e.line.L) / d;
    const x = s.x + dx * k, z = s.z + dz * k;
    const g = ground(x, z);
    const afloat = !(g != null && g > 0);
    hunt.drag({ x, z, y: afloat ? (deps.surfaceAt ? deps.surfaceAt(x, z) : 0) : g, afloat });
  }

  // ---- somebody else's lines (net.js `harpoon` line) ----
  // Drawn from that ship's harpoon as drawn here to where their page says the bolt is, eased; gone when
  // they say 'off' or nothing for REMOTE_FOR. And if that ship is the one this page sails, a line of her
  // crew's that holds land or a ship draws her along it - the trek naar de schipper.
  function onLine(m) {
    if (!m || typeof m.id !== 'string' || typeof m.b !== 'string' || !Number.isInteger(m.i)) return;
    const key = `${m.id}:${m.b}:${m.i}`;
    let r = remote.get(key);
    if (m.s !== 'out' || !Array.isArray(m.at)) {
      if (r) { r.line.hide(); remote.delete(key); dropRemote(r); }
      return;
    }
    const boat = deps.boatAt ? deps.boatAt(m.b) : null;
    if (!boat) return;
    if (!r) {
      const line = createHarpoonLine({});
      deps.scene.add(line.mesh);
      r = { line, boat, i: m.i, at: { x: m.at[0], y: m.at[1], z: m.at[2] }, to: null, L: 0, k: '', seen: 0 };
      remote.set(key, r);
    }
    r.boat = boat;
    r.to = { x: m.at[0], y: m.at[1], z: m.at[2] };
    r.L = Number.isFinite(m.L) ? m.L : r.L;
    r.k = typeof m.k === 'string' ? m.k : '';
    r.seen = 0;
  }
  function dropRemote(r) { deps.scene.remove(r.line.mesh); r.line.mesh.geometry.dispose(); }
  const rm = new THREE.Vector3();
  function remoteFrame(dt) {
    for (const [key, r] of remote) {
      r.seen += dt;
      if (r.seen > REMOTE_FOR || !(deps.boats() || []).includes(r.boat)) { remote.delete(key); dropRemote(r); continue; }
      const k = Math.min(1, dt * 10);
      r.at.x += (r.to.x - r.at.x) * k; r.at.y += (r.to.y - r.at.y) * k; r.at.z += (r.to.z - r.at.z) * k;
      const m = mouthOf(r.boat, r.i, rm);
      if (!m) continue;
      r.line.show(m.at, r.at, Math.max(r.L, Math.hypot(r.at.x - m.at.x, r.at.y - m.at.y, r.at.z - m.at.z)));
    }
  }
  // Our ship drawn along her crew's line (main.js calls it where the helm steps her). The line's own
  // reel is theirs; its length comes with every message.
  function towByCrew(b, dt) {
    if (!deps.stepping || !deps.stepping(b)) return;
    for (const r of remote.values()) {
      if (r.boat !== b || (r.k !== 'land' && r.k !== 'galleon' && r.k !== 'rowboat')) continue;
      towHull(b, r.at, r.L, dt, true);
    }
  }

  function dispose(key, e) {
    deps.scene.remove(e.line.mesh);
    e.line.mesh.geometry.dispose();
    if (e.bolt) deps.scene.remove(e.bolt);
    if (e.heldId) towing.delete(e.heldId);
    lines.delete(key);
  }

  // For the sound and the HUD: the line at a gun, or null.
  const lineAt = (b, i) => { const e = lines.get(`${b.id}:${i}`); return e ? e.line : null; };
  const cues = () => {
    const out = { fired: 0, hooked: 0, clicks: 0 };
    for (const e of lines.values()) for (const k in out) out[k] += e.line.cues[k];
    return out;
  };

  // The lines that are a way across: made fast in land or a ship. Each as walk.js takeRope wants it:
  // `ends()` the gun's mouth (a) and the hook (b) in the scene now, or null once it has let go, and
  // `deck` where on her a body comes off it at the gun's end (the gunner's stand, in her frame).
  const ends = new Map();
  const isWay = (h) => h && (h.kind === 'land' || h.kind === 'galleon' || h.kind === 'rowboat');
  function ropeOf(e) {
    let r = ends.get(e);
    if (!r) {
      const spec = e.boat.craft && e.boat.craft.spec && e.boat.craft.spec.mounts ? e.boat.craft.spec.mounts[e.i] : null;
      const a = new THREE.Vector3();
      r = {
        key: `${e.boat.id}:${e.i}`,
        ends() {
          const h = e.line.hooked();
          if (!isWay(h) || !(deps.boats() || []).includes(e.boat)) return null;
          const m = mouthOf(e.boat, e.i, a);
          return m ? { a: { x: a.x, y: a.y, z: a.z }, b: { x: h.x, y: h.y, z: h.z } } : null;
        },
        deck: spec ? { boat: e.boat, x: spec.stand[0], z: spec.stand[1], y: spec.y } : null,
      };
      ends.set(e, r);
    }
    return r;
  }
  const ropes = () => [...lines.values()].filter((e) => isWay(e.line.hooked())).map(ropeOf);
  const ropeAt = (b, i) => { const e = lines.get(`${b.id}:${i}`); return e && isWay(e.line.hooked()) ? ropeOf(e) : null; };

  return {
    fire, release, manned, tow, frame, lineAt, cues, ropes, ropeAt, events: () => heard,
    onLine, towByCrew, towing: (id) => towing.has(id), remoteCount: () => remote.size,
  };
}
